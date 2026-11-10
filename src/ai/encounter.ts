/**
 * Encounter director: waves with release conditions and telegraphs, a hard cap on simultaneously alive
 * members with queued spawn slots, melee attack tokens, accounting, hostility for the roles it contains and
 * the `encounter:*` events.
 */
import type { Actor, Encounter, EncounterDef, EnemyRole, SpawnOpts, Team, Vec3Like, WaveDef, WaveSpawn } from '@/core/api';
import { fin, guarded, live, warnOnce } from './util';

/** what the director needs from the AI system */
export interface EncounterHost {
  readonly game: import('@/core/api').Game;
  spawnEnemy(role: EnemyRole, opts: SpawnOpts): Actor;
  defaultTeam(role: EnemyRole): Team;
  /** bind / unbind an actor's brain to its encounter (melee tokens, accounting) */
  bind(actor: Actor, enc: EncounterImpl | null): void;
}

interface WaveState {
  def: WaveDef;
  released: boolean;
  /** seconds of telegraph left; < 0 = not started */
  telegraph: number;
  /** spawns of this wave still waiting for a slot */
  pending: number;
  actors: Actor[];
  announced: boolean;
}

interface QueuedSpawn {
  wave: number;
  spawn: WaveSpawn;
}

const ROLES: ReadonlySet<string> = new Set(['secDrone', 'contamDrone', 'enforcer', 'linkbound', 'wallrunner', 'weaver', 'elite']);

export class EncounterImpl implements Encounter {
  readonly id: string;
  state: 'idle' | 'active' | 'cleared' = 'idle';
  flags: Record<string, boolean> = {};
  meleeSlots: number;
  readonly maxActive: number;
  peakActive = 0;
  spawned = 0;
  killed = 0;
  wave = -1;

  private readonly members: Actor[] = [];
  private readonly aliveList: Actor[] = [];
  private readonly waves: WaveState[];
  private readonly queue: QueuedSpawn[] = [];
  private readonly holders: Actor[] = [];
  private readonly flipped: Team[] = [];
  private adopted = 0;
  private definedTotal = 0;

  constructor(private readonly host: EncounterHost, private readonly def: EncounterDef) {
    this.id = String(def?.id ?? 'encounter');
    this.maxActive = Math.max(1, Math.floor(fin(def?.maxActive, 4)));
    this.meleeSlots = Math.max(1, Math.floor(fin(def?.meleeSlots, 2)));
    const waves = Array.isArray(def?.waves) ? def.waves : [];
    this.waves = waves.map((w) => ({
      def: w, released: false, telegraph: -1, pending: 0, actors: [], announced: false,
    }));
    for (const w of waves) this.definedTotal += Array.isArray(w?.spawns) ? w.spawns.length : 0;
  }

  // ---- accounting ---------------------------------------------------------------------------------------

  get alive(): readonly Actor[] {
    this.prune();
    return this.aliveList;
  }
  get aliveCount(): number {
    this.prune();
    return this.aliveList.length;
  }
  get total(): number {
    return this.definedTotal + this.adopted;
  }
  get queued(): number {
    return this.queue.length;
  }
  get cleared(): boolean {
    return this.state === 'cleared';
  }
  get meleeSlotsHeld(): number {
    this.pruneHolders();
    return this.holders.length;
  }

  has(actor: Actor): boolean {
    return this.members.indexOf(actor) >= 0;
  }

  /** how many of wave `index`'s actors are alive (wave conditions such as "initial alive ≤ 3") */
  aliveOfWave(index: number): number {
    const w = this.waves[index];
    if (!w) return 0;
    let n = 0;
    for (const a of w.actors) if (a.alive) n++;
    return n + w.pending;
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------

  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'active';
    // the player becomes hostile to every faction team this encounter fields (restored when it ends)
    const actors = this.host.game.actors;
    for (const w of this.waves) {
      for (const s of w.def.spawns ?? []) {
        const team = s?.opts?.team ?? this.host.defaultTeam(s?.role);
        if ((team === 'dominion' || team === 'reformation') && !actors.teamsHostile('player', team)) {
          actors.setHostile('player', team, true);
          this.flipped.push(team);
        }
      }
    }
    this.host.game.events.emit('encounter:started', { id: this.id });
    this.update(0);
  }

  adopt(actor: Actor): void {
    if (!live(actor) || this.has(actor)) return;
    this.members.push(actor);
    this.adopted++;
    this.spawned++;
    if (actor.alive) this.aliveList.push(actor);
    else this.killed++;
    this.host.bind(actor, this);
    this.peakActive = Math.max(this.peakActive, this.aliveList.length);
  }

  forceClear(): void {
    if (this.state === 'cleared') return;
    if (this.state === 'idle') this.state = 'active';
    const actors = this.host.game.actors;
    for (const a of this.aliveList.slice()) guarded('encounter.forceClear', () => actors.kill(a, null));
    // everything not yet committed counts as spawned and dead
    for (const w of this.waves) {
      if (!w.released) {
        w.released = true;
        const n = Array.isArray(w.def.spawns) ? w.def.spawns.length : 0;
        this.spawned += n;
        this.killed += n;
      }
    }
    this.spawned += this.queue.length;
    this.killed += this.queue.length;
    this.queue.length = 0;
    for (const w of this.waves) w.pending = 0;
    this.wave = this.waves.length - 1;
    this.prune();
    this.finish();
  }

  stop(): void {
    if (this.state === 'active') this.state = 'idle';
    this.queue.length = 0;
    this.holders.length = 0;
    for (const a of this.members) this.host.bind(a, null);
    this.restoreHostility();
  }

  private restoreHostility(): void {
    const actors = this.host.game.actors;
    for (const t of this.flipped) actors.setHostile('player', t, false);
    this.flipped.length = 0;
  }

  private finish(): void {
    if (this.state === 'cleared') return;
    this.state = 'cleared';
    this.holders.length = 0;
    this.restoreHostility();
    this.host.game.events.emit('encounter:cleared', { id: this.id });
    const cb = this.def.onCleared;
    if (typeof cb === 'function') guarded(`encounter:${this.id}.onCleared`, () => cb(this));
  }

  // ---- melee tokens -------------------------------------------------------------------------------------

  /** tokens available right now */
  private slotLimit(): number {
    const base = Math.max(1, Math.floor(fin(this.meleeSlots, 2)));
    return this.flags.linkLearned ? Math.max(base, 3) : base;
  }

  private pruneHolders(): void {
    for (let i = this.holders.length - 1; i >= 0; i--) {
      const h = this.holders[i] as Actor;
      if (!h.alive) this.holders.splice(i, 1);
    }
  }

  acquireMeleeSlot(actor: Actor): boolean {
    if (!live(actor) || !actor.alive) return false;
    if (this.holders.indexOf(actor) >= 0) return true;
    this.pruneHolders();
    if (this.holders.length >= this.slotLimit()) return false;
    this.holders.push(actor);
    return true;
  }

  releaseMeleeSlot(actor: Actor): void {
    const i = this.holders.indexOf(actor);
    if (i >= 0) this.holders.splice(i, 1);
  }

  // ---- tick ---------------------------------------------------------------------------------------------

  private prune(): void {
    for (let i = this.aliveList.length - 1; i >= 0; i--) {
      const a = this.aliveList[i] as Actor;
      if (a.alive) continue;
      this.aliveList.splice(i, 1);
      this.killed++;
    }
  }

  private resolve(at: string | Vec3Like): Vec3Like {
    if (typeof at === 'string') {
      const r = this.def.resolve;
      if (typeof r === 'function') {
        try {
          const p = r(at);
          if (p && Number.isFinite(p.x + p.y + p.z)) return p;
        } catch {
          /* fall through to the warning */
        }
      }
      warnOnce(`marker:${this.id}:${at}`, `encounter "${this.id}": marker "${at}" could not be resolved — spawning at the origin`);
      return { x: 0, y: 0, z: 0 };
    }
    return at && Number.isFinite(at.x + at.y + at.z) ? at : { x: 0, y: 0, z: 0 };
  }

  private spawnOne(q: QueuedSpawn): void {
    const w = this.waves[q.wave] as WaveState;
    const s = q.spawn;
    const role: EnemyRole = ROLES.has(String(s?.role)) ? s.role : 'linkbound';
    if (role !== s?.role) warnOnce(`role:${String(s?.role)}`, `encounter "${this.id}": unknown role "${String(s?.role)}" — spawning a linkbound`);
    const pos = this.resolve(s?.at);
    const o = s?.opts ?? {};
    const opts: SpawnOpts = { ...o, pos: o.pos ?? pos };
    // marker names are allowed wherever a position is expected inside opts
    const anyOpts = o as unknown as Record<string, unknown>;
    if (typeof anyOpts.from === 'string') opts.from = this.resolve(anyOpts.from);
    if (typeof anyOpts.post === 'string') opts.post = this.resolve(anyOpts.post);
    let actor: Actor | null = null;
    try {
      actor = this.host.spawnEnemy(role, opts);
    } catch (err) {
      warnOnce(`spawn:${this.id}`, `encounter "${this.id}": spawn failed: ${String(err)}`);
    }
    w.pending = Math.max(0, w.pending - 1);
    this.spawned++;
    if (!live(actor)) {
      // a spawn that could not be made counts as dead so the encounter can still clear
      this.killed++;
      return;
    }
    this.members.push(actor);
    this.aliveList.push(actor);
    w.actors.push(actor);
    this.host.bind(actor, this);
  }

  update(dt: number): void {
    if (this.state !== 'active') return;
    this.prune();

    // release the next wave when its condition holds (one wave at a time, in order)
    const next = this.waves[this.wave + 1];
    if (next && !next.released) {
      let go = next.telegraph >= 0;
      if (!go) {
        const when = next.def.when;
        go = typeof when !== 'function';
        if (!go) {
          try {
            go = when!(this) === true;
          } catch (err) {
            warnOnce(`when:${this.id}:${this.wave + 1}`, `encounter "${this.id}": wave condition threw: ${String(err)}`);
          }
        }
        if (go) {
          next.telegraph = Math.max(0, fin(next.def.telegraph, 0));
          if (!next.announced) {
            next.announced = true;
            const cb = next.def.onTelegraph;
            if (typeof cb === 'function') guarded(`encounter:${this.id}.onTelegraph`, () => cb(this));
          }
        }
      }
      if (go) {
        next.telegraph -= dt;
        if (next.telegraph <= 0) {
          next.released = true;
          this.wave++;
          const spawns = Array.isArray(next.def.spawns) ? next.def.spawns : [];
          next.pending = spawns.length;
          for (const s of spawns) this.queue.push({ wave: this.wave, spawn: s });
          this.host.game.events.emit('encounter:wave', { id: this.id, wave: this.wave });
        }
      }
    }

    // spawn slots: never more than maxActive alive at once; the rest wait in the queue
    while (this.queue.length && this.aliveList.length < this.maxActive) {
      const q = this.queue.shift() as QueuedSpawn;
      this.spawnOne(q);
      const w = this.waves[q.wave] as WaveState;
      if (w.pending === 0) {
        const cb = w.def.onSpawn;
        if (typeof cb === 'function') guarded(`encounter:${this.id}.onSpawn`, () => cb(w.actors.slice(), this));
      }
    }
    this.peakActive = Math.max(this.peakActive, this.aliveList.length);

    // an encounter without waves exists for adopt(): it clears once something adopted has died
    if (!this.waves.length && this.spawned === 0) return;
    if (this.wave >= this.waves.length - 1 && !this.queue.length && !this.aliveList.length) {
      const last = this.waves[this.waves.length - 1];
      if (!last || last.released) this.finish();
    }
  }
}
