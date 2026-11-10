/**
 * Autoplay bot — plays the mission through `game.input.virtual` (the same paths as a player), plus
 * `ActiveChoice.select()` / `Interactable.complete()` where a human would use UI. It is the project's soft-lock
 * detector, so it never fakes progress: every last-resort teleport and every interaction it had to force is
 * recorded (`teleports`, `forced`, `log`) and surfaces in `DebugApi.runTo()`.
 *
 * Priority each frame: cinematic (skip) → open choice → hostile actors (objective-tagged first) → nearest
 * enabled required interaction → objective marker → idle.
 */
import * as THREE from 'three';
import type { Actor, Game, Interactable, Vec3Like } from '@/core/api';
import { angleDelta } from '@/core/mathx';
import { isStub } from '@/core/stub';

export interface BotOptions {
  choice?: 'WestStretchers' | 'EastWalkers';
  skipCinematics?: boolean;
  god?: boolean;
}

const LOG_MAX = 400;
/** no improvement toward the goal for this long → nudge sideways; the same again → teleport (recorded) */
const STUCK_SECONDS = 6;
const NUDGE_SECONDS = 1.2;
const REPATH_SECONDS = 0.6;
const WAYPOINT_REACH = 0.55;
const ARRIVE_DIST = 1.25;
/** a target that takes no damage for this long is set aside for a while */
const NO_DAMAGE_SECONDS = 20;
const BLACKLIST_SECONDS = 15;
/** in range of an interaction this long without completing it → complete() it and record that */
const FORCE_INTERACT_SECONDS = 8;
const RANGED_MAX = 24;
/** the aim ray must be within this of the target (radians, ≈ 0.6°) before the bot fires */
const AIM_TOLERANCE = 0.01;

const d2 = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.z - b.z);

export class AutoplayBot {
  running = false;
  status = '';
  teleports = 0;
  /** bumps whenever the bot measurably advances (closer to its goal, damage dealt, interaction progress) */
  progress = 0;
  readonly log: string[] = [];
  readonly forced: string[] = [];

  private opts: Required<Pick<BotOptions, 'skipCinematics' | 'god'>> & { choice: string } = { choice: 'WestStretchers', skipCinematics: true, god: true };
  private prevGod = false;

  private goalKey = '';
  private path: Vec3Like[] | null = null;
  private pathIndex = 0;
  private pathAge = Infinity;
  private readonly pathGoal = new THREE.Vector3();
  private best = Infinity;
  /** remaining distance at the last `progress` bump (one bump per metre gained) */
  private progressMark = Infinity;
  private stall = 0;
  private stuckStage = 0;
  private nudge = 0;
  private nudgeSign = 1;
  private readonly nudgeDir = { x: 0, z: 0 };

  private target: Actor | null = null;
  private retarget = 0;
  private watchHp = 0;
  private watchTime = 0;
  private readonly blacklist = new Map<number, number>();
  private attackTimer = 0;
  private abilityTimer = 0;
  private swings = 0;

  private interactTime = 0;
  private interactId = '';
  private lastProgress = 0;
  private deathHandled = false;
  private lastNow = 0;

  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly dir = { x: 0, z: 0 };

  constructor(private readonly game: Game) {}

  start(opts?: BotOptions): void {
    const g = this.game;
    this.opts = { choice: opts?.choice ?? 'WestStretchers', skipCinematics: opts?.skipCinematics !== false, god: opts?.god !== false };
    if (!this.running) this.prevGod = g.player.godMode === true;
    this.running = true;
    this.teleports = 0;
    this.forced.length = 0;
    this.resetGoal('');
    this.lastNow = g.time.now;
    g.player.godMode = this.opts.god;
    g.input.virtual.active = true;
    this.say(`autoplay started (choice ${this.opts.choice}, skip ${this.opts.skipCinematics}, god ${this.opts.god})`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.status = '';
    const g = this.game;
    g.input.virtual.clear();
    g.player.godMode = this.prevGod;
    this.say('autoplay stopped');
  }

  /**
   * Called once per frame BEFORE game.tick (so virtual presses land on this frame's input update).
   * All of the bot's timers run on SIM time elapsed since its previous update: a slow real frame (software
   * rendering) or hit-stop must not look like "six seconds without progress".
   */
  update(_frameDt: number): void {
    if (!this.running) return;
    const g = this.game;
    const { mission, player, input } = g;
    const v = input.virtual;
    const now = g.time.now;
    const dt = Math.max(0, Math.min(0.25, now - this.lastNow));
    this.lastNow = now;
    v.active = true;
    if (mission.loading === true || g.paused) return this.rest('loading');
    if (g.phase === 'dead') return this.onDeath();
    this.deathHandled = false;
    if (g.phase !== 'playing') return this.rest(`phase ${g.phase}`);
    if (isStub(player)) return this.rest('no player controller');
    if (player.godMode !== this.opts.god) player.godMode = this.opts.god;

    if (mission.cinematicActive === true) {
      this.rest('cinematic');
      if (this.opts.skipCinematics && mission.cinematicSkippable === true) {
        mission.skipCinematic();
        this.progress++;
      }
      return;
    }
    const choice = mission.activeChoice;
    if (choice && !isStub(choice)) {
      const pick = choice.options.includes(this.opts.choice) ? this.opts.choice : choice.options[0];
      this.rest(`choosing ${pick}`);
      choice.select(pick);
      this.progress++;
      this.say(`choice "${choice.id}" → ${pick}`);
      return;
    }
    const actor = player.actor;
    if (!actor || isStub(actor) || actor.alive === false) return this.rest('no live player');
    if (player.enabled === false) return this.rest('waiting — player input is disabled by a script');

    const ctx = player.contextAction;
    if (ctx && !isStub(ctx)) v.press(ctx.button);

    this.attackTimer -= dt;
    this.abilityTimer -= dt;
    const target = this.pickTarget(actor, dt);
    if (target) return this.fight(actor, target, dt);
    v.hold('aim', false);

    const it = this.pickInteractable(actor);
    if (it) return this.useInteractable(actor, it, dt);
    v.hold('interact', false);

    const marker = mission.objectiveMarker;
    if (marker) {
      if (this.travel(actor, marker, 'objective', dt, ARRIVE_DIST)) this.rest('at the objective marker — waiting');
      else this.status = `walking to the objective (${d2(actor.pos, marker).toFixed(0)} m)`;
      return;
    }
    this.rest(
      this.blacklist.size > 0
        ? 'idle — the remaining hostiles were set aside (no damage landed), no required interaction, no objective marker'
        : 'idle — no hostiles, no required interaction, no objective marker',
    );
  }

  // ---------------------------------------------------------------------------------------------
  // combat
  // ---------------------------------------------------------------------------------------------

  private pickTarget(actor: Actor, dt: number): Actor | null {
    const g = this.game;
    if (isStub(g.actors)) return null;
    const now = g.time.now;
    this.retarget -= dt;
    const cur = this.target;
    if (cur && cur.alive && cur.targetable && this.retarget > 0 && !this.blacklisted(cur, now)) return cur;
    this.retarget = 0.4;
    let best: Actor | null = null;
    let bestScore = Infinity;
    for (const h of g.actors.hostilesOf(actor)) {
      if (!h.alive || !h.targetable || h.invulnerable || h.protectedNpc || this.blacklisted(h, now)) continue;
      const score = d2(actor.pos, h.pos) - (h.tags.has('objective') ? 1000 : 0);
      if (score < bestScore) {
        best = h;
        bestScore = score;
      }
    }
    if (best !== cur) {
      this.watchHp = best ? best.hp : 0;
      this.watchTime = 0;
    }
    this.target = best;
    return best;
  }

  private blacklisted(a: Actor, now: number): boolean {
    const until = this.blacklist.get(a.id);
    if (until === undefined) return false;
    if (now >= until) {
      this.blacklist.delete(a.id);
      return false;
    }
    return true;
  }

  private fight(actor: Actor, t: Actor, dt: number): void {
    const g = this.game;
    const { input, camera, physics, player } = g;
    const v = input.virtual;
    v.hold('interact', false);

    // is the fight getting anywhere?
    if (t.hp < this.watchHp - 0.5) {
      this.watchHp = t.hp;
      this.watchTime = 0;
      this.progress++;
    } else {
      this.watchHp = Math.max(this.watchHp, t.hp);
      this.watchTime += dt;
      if (this.watchTime > NO_DAMAGE_SECONDS) {
        this.blacklist.set(t.id, g.time.now + BLACKLIST_SECONDS);
        this.say(`no damage on ${t.name || t.archetype} #${t.id} for ${NO_DAMAGE_SECONDS} s — setting it aside`);
        this.target = null;
        this.retarget = 0;
        return;
      }
    }

    const aim = t.aimPoint(this.a);
    const chest = actor.aimPoint(this.b);
    const dist = d2(actor.pos, t.pos);
    const dx = (t.pos.x - actor.pos.x) / Math.max(dist, 1e-3);
    const dz = (t.pos.z - actor.pos.z) / Math.max(dist, 1e-3);
    const sight = isStub(physics) || physics.lineOfFire(chest, aim) === true;
    const hud = player.getHudState();
    const hasAmmo = isStub(hud) || hud.ammo > 0 || hud.reserve > 0 || hud.reloading === true;
    const grounded = !t.flying && Math.abs(t.pos.y - actor.pos.y) < 1.3;
    const melee = grounded || !hasAmmo;
    const label = `${t.name || t.archetype} #${t.id}`;

    if (melee) {
      camera.aimAt(aim);
      v.hold('aim', false);
      const reach = 1.5 + t.radius;
      if (dist > reach) {
        this.travel(actor, t.pos, this.actorKey(t), dt, reach * 0.8);
        this.status = `closing on ${label} (${dist.toFixed(0)} m)`;
        return;
      }
      // keep leaning into the target so the lead faces it, then swing
      this.dir.x = dx * 0.25;
      this.dir.z = dz * 0.25;
      v.setMoveWorld(this.dir);
      v.hold('sprint', false);
      this.resetStall();
      if (this.attackTimer <= 0) {
        this.attackTimer = 0.42;
        this.swings++;
        v.press(this.swings % 4 === 0 ? 'heavy' : 'attack');
      }
      this.useAbilities();
      this.status = `melee on ${label} (hp ${Math.round(t.hp)})`;
      return;
    }

    if (!sight || dist > RANGED_MAX) {
      v.hold('aim', false);
      this.travel(actor, t.pos, this.actorKey(t), dt, 2);
      this.status = `moving for a line of fire on ${label} (${dist.toFixed(0)} m)`;
      return;
    }
    v.setMoveWorld(null);
    v.setMove(0, 0);
    v.hold('sprint', false);
    v.hold('aim', true);
    this.resetStall();
    const aligned = this.steerAim(aim);
    if (aligned && this.attackTimer <= 0) {
      this.attackTimer = 0.5;
      v.press('attack');
    }
    this.useAbilities();
    this.status = `firing on ${label} (hp ${Math.round(t.hp)}, ${dist.toFixed(0)} m)`;
  }

  /**
   * Turn the view with look input (as a player would) until the aim ray through the screen centre passes
   * through `point`. Closed loop on the real aim ray, so shoulder offset and aim framing are accounted for.
   */
  private steerAim(point: Vec3Like): boolean {
    const { camera, input } = this.game;
    const o = this.o;
    const d = this.d;
    camera.getAimRay(o, d);
    const tx = point.x - o.x;
    const ty = point.y - o.y;
    const tz = point.z - o.z;
    const flat = Math.hypot(tx, tz);
    if (flat < 1e-3 || !Number.isFinite(d.x)) return false;
    const dyaw = angleDelta(Math.atan2(-d.x, -d.z), Math.atan2(-tx, -tz));
    const dpitch = Math.atan2(ty, flat) - Math.asin(Math.max(-1, Math.min(1, d.y)));
    if (Math.abs(dyaw) > 0.6) {
      camera.aimAt(point);
      return false;
    }
    input.virtual.addLook(dyaw * 0.7, dpitch * 0.7);
    return Math.abs(dyaw) < AIM_TOLERANCE && Math.abs(dpitch) < AIM_TOLERANCE;
  }

  private useAbilities(): void {
    if (this.abilityTimer > 0) return;
    this.abilityTimer = 1.5;
    const { player, input } = this.game;
    const hud = player.getHudState();
    if (isStub(hud) || !Array.isArray(hud.abilities)) return;
    for (let i = 0; i < 2; i++) {
      const a = hud.abilities[i];
      if (a && a.ready && hud.echo >= a.cost) {
        input.virtual.press(i === 0 ? 'ability1' : 'ability2');
        return;
      }
    }
  }

  private actorKey(t: Actor): string {
    return `actor:${t.id}:${Math.round(t.pos.x / 3)}:${Math.round(t.pos.z / 3)}`;
  }

  // ---------------------------------------------------------------------------------------------
  // interactions
  // ---------------------------------------------------------------------------------------------

  private pickInteractable(actor: Actor): Interactable | null {
    let best: Interactable | null = null;
    let bestDist = Infinity;
    for (const it of this.game.mission.interactables) {
      if (isStub(it) || it.done || !it.enabled) continue;
      const d = d2(actor.pos, it.pos);
      if (d < bestDist) {
        best = it;
        bestDist = d;
      }
    }
    return best;
  }

  private useInteractable(actor: Actor, it: Interactable, dt: number): void {
    const v = this.game.input.virtual;
    if (it.id !== this.interactId) {
      this.interactId = it.id;
      this.interactTime = 0;
      this.lastProgress = 0;
    }
    if (it.progress > this.lastProgress + 0.01) {
      this.lastProgress = it.progress;
      this.progress++;
    }
    const arrived = this.travel(actor, it.pos, `interact:${it.id}`, dt, ARRIVE_DIST) || it.progress > 0;
    if (!arrived) {
      v.hold('interact', false);
      this.interactTime = 0;
      this.status = `walking to interaction "${it.id}" (${d2(actor.pos, it.pos).toFixed(0)} m)`;
      return;
    }
    // face it, then press / hold through the real input path
    const d = d2(actor.pos, it.pos);
    if (d > 0.35) {
      this.dir.x = ((it.pos.x - actor.pos.x) / d) * 0.2;
      this.dir.z = ((it.pos.z - actor.pos.z) / d) * 0.2;
      v.setMoveWorld(this.dir);
    } else {
      v.setMoveWorld(null);
    }
    v.hold('sprint', false);
    this.interactTime += dt;
    // a fresh press edge every 0.8 s while nothing is happening (press-type prompts need the edge)
    const pulseOff = it.progress === 0 && this.interactTime % 0.8 < dt * 1.5;
    v.hold('interact', !pulseOff);
    this.status = `using "${it.id}" (${Math.round(it.progress * 100)} %)`;
    if (this.interactTime > FORCE_INTERACT_SECONDS) {
      this.forced.push(it.id);
      this.say(`FORCED interaction "${it.id}": in place for ${FORCE_INTERACT_SECONDS} s (${d.toFixed(1)} m away) but input did not complete it — complete() used`);
      it.complete();
      this.progress++;
      this.interactTime = 0;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // movement
  // ---------------------------------------------------------------------------------------------

  /**
   * Walk toward `goal` along the nav path. Returns true when there (within `stop`, or at the end of the path
   * and as close as the nav grid allows).
   */
  private travel(actor: Actor, goal: Vec3Like, key: string, dt: number, stop: number): boolean {
    const g = this.game;
    const v = g.input.virtual;
    const nav = g.physics.nav;
    if (key !== this.goalKey) this.resetGoal(key);
    const straight = d2(actor.pos, goal);
    if (straight <= stop && Math.abs(actor.pos.y - goal.y) < 2.5) {
      this.resetStall();
      return true;
    }

    this.pathAge += dt;
    if (!this.path || this.pathAge > REPATH_SECONDS || d2(this.pathGoal, goal) > 1) {
      const p = isStub(g.physics) ? null : nav.findPath(actor.pos, goal);
      this.path = p && Array.isArray(p.points) && p.points.length > 1 ? p.points : null;
      this.pathIndex = 1;
      this.pathAge = 0;
      this.pathGoal.set(goal.x, goal.y, goal.z);
    }
    const pts = this.path;
    let aimAt: Vec3Like = goal;
    let remaining = straight;
    if (pts) {
      while (this.pathIndex < pts.length - 1 && d2(actor.pos, pts[this.pathIndex]) < WAYPOINT_REACH) this.pathIndex++;
      const i = Math.min(this.pathIndex, pts.length - 1);
      aimAt = pts[i];
      remaining = d2(actor.pos, aimAt);
      for (let k = i; k < pts.length - 1; k++) remaining += d2(pts[k], pts[k + 1]);
      // the path ends as close as an agent can stand: arriving there is arriving
      if (i === pts.length - 1 && remaining < 0.3 && straight < stop + 2.5) {
        this.resetStall();
        return true;
      }
    }

    // progress / stuck bookkeeping on the remaining path length
    if (remaining < this.progressMark - 1) {
      this.progressMark = remaining;
      this.progress++;
    }
    if (remaining < this.best - 0.3) {
      this.best = remaining;
      this.stall = 0;
      this.stuckStage = 0;
    } else {
      this.stall += dt;
    }
    if (this.stall > STUCK_SECONDS) this.unstick(actor, goal, aimAt, key);

    let dx = aimAt.x - actor.pos.x;
    let dz = aimAt.z - actor.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    if (this.nudge > 0) {
      this.nudge -= dt;
      dx = this.nudgeDir.x;
      dz = this.nudgeDir.z;
    }
    this.dir.x = dx;
    this.dir.z = dz;
    v.setMoveWorld(this.dir);
    v.hold('sprint', remaining > 9);
    return false;
  }

  private unstick(actor: Actor, goal: Vec3Like, next: Vec3Like, key: string): void {
    const g = this.game;
    const where = `${actor.pos.x.toFixed(1)}, ${actor.pos.y.toFixed(1)}, ${actor.pos.z.toFixed(1)}`;
    this.stall = 0;
    if (this.stuckStage === 0) {
      this.stuckStage = 1;
      const dx = next.x - actor.pos.x;
      const dz = next.z - actor.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.nudgeSign = -this.nudgeSign;
      this.nudgeDir.x = (-dz / len) * this.nudgeSign;
      this.nudgeDir.z = (dx / len) * this.nudgeSign;
      this.nudge = NUDGE_SECONDS;
      this.path = null;
      this.say(`no progress for ${STUCK_SECONDS} s toward ${key} at (${where}) — nudging sideways`);
      return;
    }
    // last resort: jump to the next point of the path (or the nearest nav point to the goal) and say so
    this.stuckStage = 0;
    let to: Vec3Like | null = this.path && this.path.length > 1 ? this.path[Math.min(this.pathIndex, this.path.length - 1)] : null;
    if (!to || d2(to, actor.pos) < 0.5) {
      const near = isStub(g.physics) ? null : g.physics.nav.nearest(goal.x, goal.y, goal.z, 6);
      to = near && !isStub(near) ? near : goal;
    }
    this.teleports++;
    this.say(`TELEPORT #${this.teleports}: stuck at (${where}) heading for ${key} — moved to (${to.x.toFixed(1)}, ${to.y.toFixed(1)}, ${to.z.toFixed(1)})`);
    g.player.teleport(to);
    this.path = null;
    this.best = Infinity;
    this.progressMark = Infinity;
  }

  private resetGoal(key: string): void {
    this.goalKey = key;
    this.path = null;
    this.pathAge = Infinity;
    this.best = Infinity;
    this.progressMark = Infinity;
    this.stall = 0;
    this.stuckStage = 0;
    this.nudge = 0;
  }

  private resetStall(): void {
    this.stall = 0;
    this.stuckStage = 0;
  }

  private rest(status: string): void {
    const v = this.game.input.virtual;
    v.setMoveWorld(null);
    v.setMove(0, 0);
    v.hold('sprint', false);
    v.hold('aim', false);
    v.hold('interact', false);
    this.resetStall();
    this.status = status;
  }

  private onDeath(): void {
    this.rest('dead');
    if (this.deathHandled) return;
    this.deathHandled = true;
    const g = this.game;
    this.say('player died — returning to the last checkpoint');
    g.ui.hideDeath();
    g.setPhase('playing');
    g.input.setContext('game');
    void g.mission.reloadCheckpoint();
  }

  private say(msg: string): void {
    this.log.push(`${this.game.time.now.toFixed(1)}s ${msg}`);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
  }
}
