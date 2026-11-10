/**
 * AI — enemy brains, the encounter director, the Eclipse link system, encounter devices, companions and NPCs.
 * Contract: src/core/api/ai.ts. Behaviour numbers: ./tune.ts; health / damage: TUNING.enemies.
 *
 * Tick: `ai.update` runs before `actors.update`, so the systems here (encounters, links, devices, projectiles,
 * companions' downed rule, intensity) advance first and the brains — which are the actors' controllers — think
 * afterwards, inside the ActorManager.
 */
import type {
  Actor, ActorDesc, AiStats, AiSystem, Companion, CompanionMode, DeviceSystem, EliteController, Encounter, EncounterDef,
  EnemyRole, Game, HumanoidArchetype, LinkSystem, SpawnOpts, Team, Vec3Like, WeakPoint,
} from '@/core/api';
import { TUNING } from '@/combat/tuning';
import { Brain } from './brain';
import { CompanionImpl } from './companion';
import { companionHealth } from './companionKit';
import { emptyStats, resetStats, type AiCore } from './core';
import { DeviceSystemImpl } from './devices';
import { EncounterImpl, type EncounterHost } from './encounter';
import { LinkSystemImpl } from './links';
import { Projectiles } from './projectiles';
import { DroneBrain } from './roles/drone';
import { EliteBrain } from './roles/elite';
import { EnforcerBrain } from './roles/enforcer';
import { LinkboundBrain } from './roles/linkbound';
import { WallrunnerBrain } from './roles/wallrunner';
import { WeaverBrain } from './roles/weaver';
import { AI } from './tune';
import { fin, guarded, live, playerActor, vec, warnOnce } from './util';

export { AI } from './tune';
export type { EliteBrain } from './roles/elite';

const ROLE_TEAM: Record<EnemyRole, Team> = {
  secDrone: 'reformation', contamDrone: 'contaminated', enforcer: 'dominion',
  linkbound: 'eclipse', wallrunner: 'eclipse', weaver: 'eclipse', elite: 'eclipse',
};

const ROLE_NAME: Record<EnemyRole, string> = {
  secDrone: 'Security drone', contamDrone: 'Contaminated drone', enforcer: 'Enforcer', linkbound: 'Linkbound',
  wallrunner: 'Wallrunner', weaver: 'Weaver', elite: 'Breach organism',
};

function weakPointsFor(role: EnemyRole): WeakPoint[] {
  const E = TUNING.enemies;
  switch (role) {
    case 'secDrone':
    case 'contamDrone':
      return [{ id: 'vent', socket: 'vent', radius: 0.26, multiplier: E[role].ventMultiplier, exposed: false }];
    case 'wallrunner':
    case 'weaver':
      return [{ id: 'core', socket: 'core', radius: 0.38, multiplier: 2, exposed: false }];
    case 'elite':
      return [
        { id: 'joint', socket: 'joint', radius: 0.6, multiplier: E.elite.jointMultiplier, exposed: false },
        { id: 'core', socket: 'core', radius: 0.55, multiplier: 2, exposed: false },
      ];
    default:
      return [];
  }
}

class AiSystemImpl implements AiSystem, AiCore, EncounterHost {
  readonly links: LinkSystemImpl;
  readonly devices: DeviceSystemImpl;
  readonly projectiles: Projectiles;
  readonly stats: AiStats = emptyStats();
  ceasefire = false;
  intensity = 0;
  private readonly encs: EncounterImpl[] = [];
  private readonly comps: CompanionImpl[] = [];
  private readonly brains = new Map<Actor, Brain>();
  private readonly membership = new Map<Actor, EncounterImpl>();
  private heat = 0;
  private spawnSeq = 0;

  constructor(readonly game: Game) {
    this.links = new LinkSystemImpl(this);
    this.devices = new DeviceSystemImpl(this);
    this.projectiles = new Projectiles(game);
    game.events.on('zone:loading', () => this.clear());
  }

  // ---- AiCore -----------------------------------------------------------------------------------------------------

  brainOf(actor: Actor | null | undefined): Brain | null {
    return actor ? this.brains.get(actor) ?? null : null;
  }

  memberOf(actor: Actor): EncounterImpl | null {
    return this.membership.get(actor) ?? null;
  }

  noteAttack(weight = 1): void {
    this.heat = Math.min(1, this.heat + 0.12 * weight);
  }

  noteTelegraph(seconds: number): void {
    this.stats.telegraphs++;
    if (seconds < this.stats.minTelegraph) this.stats.minTelegraph = seconds;
  }

  // ---- EncounterHost ------------------------------------------------------------------------------------------------

  defaultTeam(role: EnemyRole): Team {
    return ROLE_TEAM[role] ?? 'eclipse';
  }

  bind(actor: Actor, enc: EncounterImpl | null): void {
    if (enc) this.membership.set(actor, enc);
    else this.membership.delete(actor);
    const b = this.brains.get(actor);
    if (b) b.enc = enc;
  }

  // ---- AiSystem -------------------------------------------------------------------------------------------------------

  get encounters(): readonly Encounter[] {
    return this.encs;
  }

  get companions(): readonly Companion[] {
    return this.comps;
  }

  spawnEnemy(role: EnemyRole, opts: SpawnOpts): Actor {
    const game = this.game;
    if (!(role in ROLE_TEAM)) {
      warnOnce(`role:${String(role)}`, `spawnEnemy("${String(role)}") is not a known role — spawning a linkbound`);
      role = 'linkbound';
    }
    const o: SpawnOpts = { ...(opts ?? ({} as SpawnOpts)) };
    o.pos = vec(o.pos);
    const seed = fin(o.seed, 101 + this.spawnSeq * 37);
    this.spawnSeq++;
    const stat = TUNING.enemies[role] as { hp: number; poise: number; radius: number; height: number; hover?: number };
    const flying = role === 'secDrone' || role === 'contamDrone';
    let brain: Brain;
    switch (role) {
      case 'secDrone':
      case 'contamDrone':
        brain = new DroneBrain(this, role, o);
        break;
      case 'enforcer':
        brain = new EnforcerBrain(this, o);
        break;
      case 'wallrunner':
        brain = new WallrunnerBrain(this, o);
        break;
      case 'weaver':
        brain = new WeaverBrain(this, o);
        break;
      case 'elite':
        brain = new EliteBrain(this, o);
        break;
      default:
        brain = new LinkboundBrain(this, o);
    }
    const visual = game.chars.create(role, { seed });
    const desc: ActorDesc = {
      archetype: role, name: o.name ?? ROLE_NAME[role], team: o.team ?? ROLE_TEAM[role],
      pos: o.pos, yaw: fin(o.yaw, 0),
      hp: Math.max(1, stat.hp * Math.max(0.05, fin(o.hpScale, 1))), poise: stat.poise,
      radius: stat.radius, height: stat.height, flying, hoverHeight: fin(stat.hover, 1.8),
      visual: live(visual) ? visual : null, controller: brain,
      tags: ['enemy', role, ...(Array.isArray(o.tags) ? o.tags : [])],
      weakPoints: weakPointsFor(role),
      guardArc: role === 'enforcer' ? TUNING.enemies.enforcer.guardArc : undefined,
      corpseSeconds: flying ? 6 : role === 'elite' ? 5 : undefined,
    };
    const actor = game.actors.spawn(desc);
    if (role === 'enforcer') {
      // the tower shield stops rounds and light blows; heavy blows go through, and the back is open
      actor.guardStopsHeavy = false;
      actor.flankMultiplier = TUNING.enemies.enforcer.flankMultiplier;
    }
    if (role === 'elite') actor.freezeScale = AI.elite.freezeScale;
    this.brains.set(actor, brain);
    this.stats.spawned++;
    guarded(`ai.attach:${role}`, () => brain.attach(actor));
    return actor;
  }

  private spawnHumanoid(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; name?: string; seed?: number }, npc: boolean, mode: CompanionMode): CompanionImpl {
    const game = this.game;
    const c = new CompanionImpl(this, who, npc, mode, this.comps.filter((x) => !x.npc).length, (x) => {
      const i = this.comps.indexOf(x);
      if (i >= 0) this.comps.splice(i, 1);
    });
    const visual = game.chars.create(who, opts?.seed !== undefined ? { seed: opts.seed } : undefined);
    const health = companionHealth(who);
    const name = opts?.name ?? String(who).charAt(0).toUpperCase() + String(who).slice(1);
    const actor = game.actors.spawn({
      archetype: who, name, team: npc ? 'neutral' : 'player', pos: vec(opts?.pos), yaw: fin(opts?.yaw, 0),
      hp: health.hp, poise: npc ? 0 : health.poise,
      visual: live(visual) ? visual : null, controller: c,
      protectedNpc: npc, invulnerable: npc, targetable: !npc,
      tags: npc ? ['npc'] : ['companion'], corpseSeconds: Infinity, dissolveOnDeath: false,
    });
    c.attach(actor);
    this.comps.push(c);
    return c;
  }

  spawnCompanion(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; mode?: CompanionMode; name?: string }): Companion {
    return this.spawnHumanoid(who, opts, false, opts?.mode ?? 'follow');
  }

  spawnNpc(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; pose?: string; name?: string; seed?: number }): Companion {
    const c = this.spawnHumanoid(who, opts, true, 'scripted');
    if (opts?.pose) c.play(opts.pose, { loop: true });
    return c;
  }

  createEncounter(def: EncounterDef): Encounter {
    const enc = new EncounterImpl(this, def ?? ({ id: 'encounter', maxActive: 4, waves: [] } as EncounterDef));
    this.encs.push(enc);
    return enc;
  }

  alert(tag: string): void {
    for (const [actor, brain] of this.brains) {
      if (actor.alive && brain.dormant && actor.tags.has(tag)) brain.wake();
    }
  }

  setCeasefire(on: boolean): void {
    this.ceasefire = on === true;
  }

  elite(actor: Actor | null): EliteController | null {
    const b = this.brainOf(actor);
    return b instanceof EliteBrain && b.actor.alive ? b : null;
  }

  encounterOf(actor: Actor): Encounter | null {
    return this.memberOf(actor);
  }

  telegraphOf(actor: Actor): number {
    const b = this.brainOf(actor);
    return b && actor.alive ? b.telegraphLeft : 0;
  }

  update(dt: number): void {
    const d = fin(dt, 0);
    const game = this.game;
    for (const [actor] of this.brains) {
      // brains of removed actors are forgotten a while after death (links / encounters may still ask about them)
      if (!actor.alive && game.actors.byId(actor.id) === null) {
        this.brains.delete(actor);
        this.membership.delete(actor);
      }
    }
    for (let i = 0; i < this.encs.length; i++) (this.encs[i] as EncounterImpl).update(d);
    this.links.update(d);
    this.devices.update(d);
    this.projectiles.update(d);
    for (let i = this.comps.length - 1; i >= 0; i--) (this.comps[i] as CompanionImpl).tick();
    this.updateIntensity(d);
  }

  /** 0..1 combat intensity: how many members are alive under active encounters, plus recent attacks */
  private updateIntensity(dt: number): void {
    let alive = 0;
    let cap = 0;
    for (const e of this.encs) {
      if (e.state !== 'active') continue;
      alive += e.aliveCount;
      cap += e.maxActive;
    }
    this.heat = Math.max(0, this.heat - dt * 0.12);
    const player = playerActor(this.game);
    let target = 0;
    if (alive > 0 && player && !this.ceasefire) target = Math.min(1, 0.4 + 0.35 * (alive / Math.max(1, cap)) + 0.35 * this.heat);
    // quick to rise, slow to settle
    const rate = target > this.intensity ? 1.6 : 0.45;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-rate * dt));
    if (this.intensity < 0.003 && target === 0) this.intensity = 0;
    this.game.audio.setIntensity(this.intensity);
  }

  clear(): void {
    const game = this.game;
    for (const e of this.encs) guarded('ai.clear.encounter', () => e.stop());
    this.encs.length = 0;
    this.links.clear();
    this.projectiles.clear();
    this.devices.clear();
    for (const c of this.comps.slice()) guarded('ai.clear.companion', () => c.remove());
    this.comps.length = 0;
    for (const [actor] of this.brains) guarded('ai.clear.enemy', () => game.actors.despawn(actor));
    this.brains.clear();
    this.membership.clear();
    this.ceasefire = false;
    this.intensity = 0;
    this.heat = 0;
    this.spawnSeq = 0;
    resetStats(this.stats);
    if (live(game.player)) game.player.threat = 0;
  }
}

/** the AI system's links / devices as their contract types (the implementation classes are internal) */
export type { LinkSystem, DeviceSystem };

export function createAiSystem(game: Game): AiSystem {
  return new AiSystemImpl(game);
}
