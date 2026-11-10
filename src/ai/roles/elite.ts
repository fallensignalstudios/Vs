/**
 * The elite — regenerative breach organism (E4). Contract and phase description: EliteController in
 * src/core/api/ai.ts. Attacks (all on the creature's own long wind-ups, with ground telegraphs):
 *   sweep        frontal 150° arc, blockable
 *   groundSlam   ring telegraph, heavy inside, shockwave outside                                  (heavy attack)
 *   charge       announced, along a clear line across the court, heavy                            (heavy attack)
 *   pulse        phase A only: the announced corruption pressure field
 * Phase B opens the joint after every heavy attack; a granted Resonance window holds it open.
 */
import * as THREE from 'three';
import type { Actor, EliteController, LoopHandle, NoGoRect, SpawnOpts } from '@/core/api';
import { asElite } from '@/core/api';
import { TUNING, windowScale } from '@/combat/tuning';
import { angleDelta, forwardX, forwardZ, yawTo } from '@/core/mathx';
import { Brain } from '../brain';
import type { AiCore } from '../core';
import { AI } from '../tune';
import { caption, carry, cooldownScale, difficultyOf, fin, live, physicsOf, playerActor, socketPos } from '../util';

type State = 'hunt' | 'sweep' | 'slam' | 'charge' | 'pulse' | 'expose' | 'held';

const RED = 0xff3b2a;
const VIOLET = 0x8a4cff;
const _goal = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _end = { x: 0, y: 0, z: 0 };

function inRect(r: NoGoRect, x: number, z: number, pad: number): boolean {
  return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
}

export class EliteBrain extends Brain implements EliteController {
  actor!: Actor;
  onJointExposed: ((elite: Actor) => void) | null = null;
  onPhase: ((phase: 'A' | 'B') => void) | null = null;
  fractured = false;

  private state: State = 'hunt';
  private t = 0;
  private hitAt = 0;
  private endAt = 0;
  private struck = false;
  private cd: number;
  private pulseCd: number;
  private pressureUntil = 0;
  private exposeLeft = 0;
  private resonance = 0;
  private holding = false;
  private lowPressureUntil = 0;
  private arrestUntil = 0;
  private arrested = false;
  private noGo: NoGoRect[];
  private regenLoop: LoopHandle | null = null;
  private lastPhase: 'A' | 'B' | null = null;
  private readonly center = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private runFrom = 0;
  private runSpeed = 0;
  private stalled = 0;
  private readonly hitOnce = new Set<Actor>();
  private jointSaid = false;

  constructor(core: AiCore, opts: SpawnOpts) {
    super(core, 'elite', opts);
    this.cd = 1.5;
    this.pulseCd = this.rand(6, 9);
    this.noGo = Array.isArray(opts.noGo) ? opts.noGo.slice() : [];
  }

  // ---- EliteController ----------------------------------------------------------------------------------------

  get phase(): 'A' | 'B' {
    return !this.fractured && this.actor && this.core.links.feeding(this.actor) > 0 ? 'A' : 'B';
  }

  get jointExposed(): boolean {
    return this.exposeLeft > 0;
  }

  get pressureActive(): boolean {
    return this.now < this.pressureUntil;
  }

  requestResonanceWindow(seconds?: number): boolean {
    const a = this.actor;
    if (!a || !a.alive || this.fractured || this.phase === 'A') return false;
    this.resonance = Math.max(1, fin(seconds, AI.elite.resonanceSeconds));
    if (this.exposeLeft > 0) {
      // already open: hold it
      this.exposeLeft = Math.max(this.exposeLeft, this.resonance);
      this.holding = true;
      if (this.state === 'hunt') this.state = 'held';
    }
    return true;
  }

  cancelResonanceWindow(): void {
    const a = this.actor;
    this.resonance = 0;
    this.holding = false;
    if (this.arrested && a) a.visual?.setFrozen(0);
    this.arrested = false;
    this.arrestUntil = 0;
    if (a && this.exposeLeft > 0) this.closeJoint(a);
    this.lowPressureUntil = this.now + AI.elite.lowPressure;
    if (this.state === 'held') this.state = 'hunt';
  }

  arrest(seconds?: number): void {
    const a = this.actor;
    if (!a || !a.alive || this.fractured) return;
    const s = Math.max(0.5, fin(seconds, 3));
    // a second arrest (Selene's tether landing inside a longer scripted hold) extends, never shortens, the hold
    this.arrestUntil = Math.max(this.arrested ? this.arrestUntil : 0, this.now + s);
    this.arrested = true;
    if (this.exposeLeft <= 0 && this.phase === 'B') this.openJoint(a);
    this.exposeLeft = Math.max(this.exposeLeft, this.arrestUntil - this.now + 1.5);
    this.cancelAttack(a);
    this.state = 'held';
    this.holding = true;
    a.visual?.setFrozen(0.3);
  }

  fracture(by: Actor | null = null): void {
    const a = this.actor;
    if (!a || !a.alive || this.fractured) return;
    const S = TUNING.enemies.elite;
    this.fractured = true;
    this.resonance = 0;
    this.holding = false;
    this.arrested = false;
    this.arrestUntil = 0;
    this.cancelAttack(a);
    this.closeJoint(a);
    a.regen = 0;
    a.data.linkRegen = 0;
    // 35 % of max health, never the last sliver: the kill stays with ordinary damage
    a.hp = Math.max(a.maxHp * 0.05, a.hp - a.maxHp * S.fractureFraction);
    a.visual?.play('fracture');
    asElite(a.visual)?.setRegenerating(0);
    this.regenLoop?.stop(0.4);
    this.regenLoop = null;
    // the cauterised stump no longer protects the core
    const core = a.weakPoints.find((w) => w.id === 'core');
    if (core) core.exposed = true;
    a.visual?.setExposed('core', 1);
    this.game.actors.stagger(a, AI.elite.fractureStagger, live(by) ? by : null);
    this.state = 'hunt';
    this.cd = 1.2;
    this.pressureUntil = 0;
  }

  setNoGo(rects: NoGoRect[]): void {
    this.noGo = Array.isArray(rects) ? rects.filter((r) => r && Number.isFinite(r.minX + r.maxX + r.minZ + r.maxZ)) : [];
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------------

  override attach(a: Actor): void {
    this.actor = a;
    super.attach(a);
  }

  protected override onActive(a: Actor): void {
    this.regenLoop = this.game.audio.loop('eliteRegen', { pos: a.pos, volume: 0 });
    const v = asElite(a.visual);
    if (v) {
      v.onFootfall = (_side, strength) => {
        const p = playerActor(this.game);
        const d = p ? a.distanceTo(p) : 30;
        const k = Math.max(0, 1 - d / 26) * fin(strength, 0.5);
        if (k > 0.03) this.game.camera.shake(0.22 * k, 0.22);
        this.game.audio.play('enforcerStep', { pos: a.pos, volume: 0.5 + 0.6 * fin(strength, 0.5), pitch: 0.55 });
      };
    }
  }

  protected override cleanup(a: Actor): void {
    this.regenLoop?.stop(0.3);
    this.regenLoop = null;
    const v = asElite(a.visual);
    if (v) v.onFootfall = null;
    if (live(this.game.player)) this.game.player.threat = 0;
    this.pressureUntil = 0;
  }

  protected override onAttackCancelled(_a: Actor): void {
    if (this.state !== 'held' && this.state !== 'expose') this.state = 'hunt';
    this.hitOnce.clear();
  }

  protected override targetWeight(_a: Actor, t: Actor): number {
    return t.flying ? 2.5 : 1;
  }

  protected override canTarget(a: Actor, t: Actor): boolean {
    if (!super.canTarget(a, t)) return false;
    for (const r of this.noGo) if (inRect(r, t.pos.x, t.pos.z, 0)) return false;
    return true;
  }

  /** phase, regeneration and the pressure field run whatever the body is doing (also while staggered) */
  override update(a: Actor, dt: number): void {
    this.ambient(a, dt);
    super.update(a, dt);
  }

  private ambient(a: Actor, dt: number): void {
    const E = AI.elite;
    const now = this.now;
    const phase = this.phase;
    if (phase !== this.lastPhase) {
      const first = this.lastPhase === null;
      this.lastPhase = phase;
      if (!first) {
        caption(this.game, phase === 'A' ? 'Linked — it regenerates' : 'Isolated — heavy blows open the joint', 'link', a.pos);
        const cb = this.onPhase;
        if (cb) {
          try {
            cb(phase);
          } catch {
            /* a script callback must never stop the brain */
          }
        }
      }
    }
    a.regen = this.fractured ? 0 : phase === 'A' ? Math.max(1, fin(a.data.linkRegen as number, TUNING.enemies.elite.regen)) : E.selfRegen;
    // link armour while it is fed, knitting plates while it is isolated; the fracture ends both
    a.damageTakenScale = this.fractured ? E.armorFractured : phase === 'A' ? E.armorLinked : E.armorIsolated;
    // a Resonance hold seals the joint in frost: it is held open for the Thermal Fracture, not for free ×3 blows
    // (the confirm is the strike that counts; ordinary hits meanwhile land at the plates' value)
    const sealed = this.arrested || this.holding;
    for (let i = 0; i < a.weakPoints.length; i++) {
      const w = a.weakPoints[i];
      if (w && w.id === 'joint') w.multiplier = sealed ? 1 : TUNING.enemies.elite.jointMultiplier;
    }
    asElite(a.visual)?.setRegenerating(this.fractured ? 0 : phase === 'A' ? 1 : 0.2);
    this.regenLoop?.setPosition(a.pos);
    this.regenLoop?.setVolume(phase === 'A' ? 1 : 0.25, 0.4);

    // corruption pressure: a relationship, never a timer — it only rises inside the field while a link feeds it
    const player = live(this.game.player) ? this.game.player : null;
    const pa = playerActor(this.game);
    if (player) {
      const inField = !!pa && now < this.pressureUntil && phase === 'A' && !this.core.ceasefire && a.distanceTo(pa) <= E.pulseField;
      let threat = fin(player.threat, 0);
      threat += (inField ? E.threatRise : -E.threatFall) * dt;
      if (threat >= 1 && pa) {
        const dx = pa.pos.x - a.pos.x;
        const dz = pa.pos.z - a.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        pa.aimPoint(_pt);
        this.game.vfx.spawn('violetBurst', _pt);
        this.game.actors.applyHit(pa, {
          attacker: a, damage: E.threatHit, poise: 20, kind: 'ability', element: 'violet', unblockable: true,
          dir: { x: dx / l, y: 0, z: dz / l }, point: { x: _pt.x, y: _pt.y, z: _pt.z }, tag: 'pressure',
        });
        threat = 0.35;
      }
      player.threat = Math.max(0, Math.min(1, threat));
    }

    if (this.arrested && now >= this.arrestUntil) {
      this.arrested = false;
      a.visual?.setFrozen(0);
    }
    if (this.exposeLeft > 0 && !this.arrested) {
      this.exposeLeft -= dt;
      if (this.exposeLeft <= 0) {
        this.closeJoint(a);
        if (this.holding) {
          // the window passed unused: a short low-pressure pattern, then it can be set up again
          this.holding = false;
          this.resonance = 0;
          this.lowPressureUntil = now + E.lowPressure;
          if (this.state === 'held') this.state = 'hunt';
        }
      }
    }
  }

  private openJoint(a: Actor): void {
    const wp = a.weakPoints.find((w) => w.id === 'joint');
    if (wp) wp.exposed = true;
    a.visual?.setExposed('joint', 1);
    this.game.audio.play('eliteExpose', { pos: a.pos });
    this.core.stats.jointExposures++;
    if (!this.jointSaid) {
      this.jointSaid = true;
      caption(this.game, 'The joint is exposed', 'alert', socketPos(a, 'joint', _pt));
    }
    const hold = this.resonance > 0;
    this.exposeLeft = hold ? this.resonance : AI.elite.exposeSeconds * windowScale(difficultyOf(this.game));
    this.holding = hold;
    const cb = this.onJointExposed;
    if (cb) {
      try {
        cb(a);
      } catch {
        /* a script callback must never stop the brain */
      }
    }
  }

  private closeJoint(a: Actor): void {
    this.exposeLeft = 0;
    const wp = a.weakPoints.find((w) => w.id === 'joint');
    if (wp) wp.exposed = false;
    a.visual?.setExposed('joint', 0);
  }

  // ---- brain ------------------------------------------------------------------------------------------------------

  private blockedByNoGo(x: number, z: number, pad: number): boolean {
    for (const r of this.noGo) if (inRect(r, x, z, pad)) return true;
    return false;
  }

  /** is the straight run from the elite to (ex, ez) open ground for its whole body? */
  private clearRun(a: Actor, ex: number, ez: number): boolean {
    for (let i = 1; i <= 6; i++) {
      const k = i / 6;
      if (this.blockedByNoGo(a.pos.x + (ex - a.pos.x) * k, a.pos.z + (ez - a.pos.z) * k, a.radius + 0.5)) return false;
    }
    const physics = physicsOf(this.game);
    if (!physics) return true;
    _end.x = ex;
    _end.y = a.pos.y;
    _end.z = ez;
    try {
      return physics.nav.walkableFor(a.pos, _end, a.radius, a.height);
    } catch {
      return false;
    }
  }

  protected think(a: Actor, dt: number): void {
    const E = AI.elite;
    const S = TUNING.enemies.elite;
    const now = this.now;
    const t = this.target;
    const valid = this.validTarget(a, t);
    if (this.arrested) {
      this.nav.halt(a);
      return;
    }

    switch (this.state) {
      case 'hunt': {
        if (this.resonance > 0 && this.exposeLeft <= 0 && this.phase === 'B' && !this.fractured) {
          this.startExpose(a);
          break;
        }
        if (!valid) {
          this.nav.halt(a);
          break;
        }
        const dist = a.distanceTo(t);
        const reach = E.sweepRange + t.radius;
        _goal.copy(t.pos);
        this.nav.moveTo(a, _goal, E.speed, dt, { big: true, turn: E.turn, stop: Math.max(1.5, reach - 1.2), faceTo: dist < reach + 2 ? t.pos : null });
        // never into a survivor recess, whatever the path says
        if (this.blockedByNoGo(a.pos.x + a.desiredVel.x * 0.6, a.pos.z + a.desiredVel.z * 0.6, a.radius + 0.4)) a.desiredVel.set(0, 0, 0);
        this.cd -= dt;
        if (this.phase === 'A') this.pulseCd -= dt;
        if (this.cd > 0) break;
        const facing = Math.abs(angleDelta(a.yaw, yawTo(a.pos.x, a.pos.z, t.pos.x, t.pos.z)));
        const low = now < this.lowPressureUntil;
        if (this.phase === 'A' && this.pulseCd <= 0 && dist < 18 && !low) this.startPulse(a);
        else if (dist <= reach && facing < 0.9) {
          if (!low && dist > E.slamRange[0] && this.rand(0, 1) < 0.35) this.startSlam(a, t);
          else this.startSweep(a);
        } else if (!low && dist >= E.slamRange[0] && dist <= E.slamRange[1] && facing < 0.7 && this.rand(0, 1) < 0.6) this.startSlam(a, t);
        else if (!low && dist >= E.chargeRange[0] && dist <= E.chargeRange[1] && facing < 0.5) this.tryCharge(a, t, dist);
        break;
      }
      case 'sweep': {
        this.t += dt;
        if (valid && this.t < this.hitAt * 0.5) a.face(t.pos, E.turn * dt);
        this.tickTelegraph(a, dt);
        if (!this.struck && this.t >= this.hitAt) {
          this.struck = true;
          this.endTelegraph(a);
          this.marks.length = 0;
          this.game.audio.play('swingHeavy', { pos: a.pos, pitch: 0.6 });
          this.hitArc(a, E.sweepArc, E.sweepReach, S.sweep, 45, 6, false);
        }
        if (this.t >= this.endAt) this.afterAttack(a, false);
        break;
      }
      case 'slam': {
        this.t += dt;
        if (valid && this.t < this.hitAt * 0.4) a.face(t.pos, E.turn * dt);
        this.tickTelegraph(a, dt);
        if (!this.struck && this.t >= this.hitAt) {
          this.struck = true;
          this.endTelegraph(a);
          this.marks.length = 0;
          this.slamLand(a);
        }
        if (this.t >= this.endAt) this.afterAttack(a, true);
        break;
      }
      case 'charge': {
        this.t += dt;
        if (this.t < this.runFrom) {
          this.tickTelegraph(a, dt);
        } else if (this.t < this.hitAt && !this.struck) {
          if (this.teleLeft > 0) {
            this.endTelegraph(a);
            this.marks.length = 0;
          }
          // committed: straight down the announced line
          carry(a, this.dir.x * this.runSpeed, this.dir.z * this.runSpeed);
          this.chargeHits(a);
          const moved = Math.hypot(a.vel.x, a.vel.z);
          this.stalled = moved < this.runSpeed * 0.3 && this.t > this.runFrom + 0.12 ? this.stalled + dt : 0;
          if (this.stalled > 0.12) {
            // it ran into something solid: the charge is over
            this.struck = true;
            this.game.camera.shake(0.5, 0.3);
            this.game.audio.play('eliteSlam', { pos: a.pos, volume: 0.6 });
          }
        }
        if (this.t >= this.endAt) this.afterAttack(a, true);
        break;
      }
      case 'pulse': {
        this.t += dt;
        this.tickTelegraph(a, dt);
        if (!this.struck && this.t >= this.hitAt) {
          this.struck = true;
          this.endTelegraph(a);
          this.marks.length = 0;
          this.game.vfx.spawn('pressurePulse', a.pos);
          this.game.audio.play('elitePulse', { pos: a.pos });
          this.pressureUntil = now + E.pulseSeconds;
          this.core.stats.pressurePulses++;
        }
        if (this.t >= this.endAt) {
          this.pulseCd = this.rand(E.pulseEvery[0], E.pulseEvery[1]);
          this.afterAttack(a, false);
        }
        break;
      }
      case 'expose': {
        this.t += dt;
        this.nav.halt(a);
        if (!this.struck && this.t >= this.hitAt) {
          this.struck = true;
          this.openJoint(a);
        }
        if (this.t >= this.endAt) {
          this.state = 'held';
          this.t = 0;
        }
        break;
      }
      case 'held': {
        this.nav.halt(a);
        this.t += dt;
        if (valid) a.face(t.pos, E.turn * 0.4 * dt);
        // an ordinary exposure: it gathers itself, then hunts again with the joint still open for a while
        if (!this.holding && this.t >= 1.2) {
          this.state = 'hunt';
          this.cd = Math.max(this.cd, 0.6);
        }
        break;
      }
    }
  }

  private begin(a: Actor, state: State, action: string, fallbackHit: number, fallbackDur: number): void {
    const info = a.visual?.play(action);
    this.hitAt = Math.max(AI.minTelegraph, fin(info?.hitTimes?.[0], fallbackHit));
    this.endAt = Math.max(this.hitAt + 0.3, fin(info?.duration, fallbackDur));
    this.t = 0;
    this.struck = false;
    this.stalled = 0;
    this.state = state;
    this.hitOnce.clear();
    // a committed attack is not interrupted by chip poise damage
    a.superArmorUntil = this.now + this.endAt;
  }

  private startSweep(a: Actor): void {
    this.begin(a, 'sweep', 'sweep', 0.82, 1.75);
    this.beginTelegraph(a, this.hitAt, RED);
    this.marks.push(this.game.vfx.telegraph({ kind: 'cone', pos: a.pos, yaw: a.yaw, arc: AI.elite.sweepArc, r: AI.elite.sweepReach }, this.hitAt, RED));
    this.game.audio.play('eclipseBreath', { pos: a.pos, pitch: 0.5, volume: 1.3 });
    this.core.stats.meleeAttacks++;
  }

  private startSlam(a: Actor, t: Actor): void {
    const E = AI.elite;
    this.begin(a, 'slam', 'groundSlam', 1.62, 3.1);
    this.beginTelegraph(a, this.hitAt, RED);
    // the strike point: toward the target, never further than the arms reach
    const d = Math.min(3.2, Math.max(1.6, a.distanceTo(t) - 0.5));
    const yaw = yawTo(a.pos.x, a.pos.z, t.pos.x, t.pos.z);
    this.center.set(a.pos.x + forwardX(yaw) * d, a.pos.y, a.pos.z + forwardZ(yaw) * d);
    this.marks.push(this.game.vfx.telegraph({ kind: 'circle', pos: this.center, r: E.slamOuter }, this.hitAt, RED));
    this.game.audio.play('eliteRoar', { pos: a.pos, volume: 0.7 });
    this.core.stats.meleeAttacks++;
  }

  private tryCharge(a: Actor, t: Actor, dist: number): void {
    const E = AI.elite;
    const dx = (t.pos.x - a.pos.x) / dist;
    const dz = (t.pos.z - a.pos.z) / dist;
    let len = Math.min(E.chargeMax, dist + 3);
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      ok = this.clearRun(a, a.pos.x + dx * len, a.pos.z + dz * len);
      if (!ok) len *= 0.75;
    }
    if (!ok || len < 6) {
      this.cd = 0.4;
      return;
    }
    this.begin(a, 'charge', 'charge', 1.7, 2.5);
    this.dir.set(dx, 0, dz);
    a.face(t.pos);
    this.runFrom = Math.max(AI.minTelegraph * 1.5, this.hitAt * 0.5);
    this.runSpeed = len / Math.max(0.2, this.hitAt - this.runFrom);
    this.beginTelegraph(a, this.runFrom, RED);
    _end.x = a.pos.x + dx * len;
    _end.y = a.pos.y;
    _end.z = a.pos.z + dz * len;
    this.marks.push(this.game.vfx.telegraph({ kind: 'line', from: a.pos, to: _end, width: E.chargeWidth }, this.runFrom, RED));
    this.game.audio.play('eliteRoar', { pos: a.pos });
    caption(this.game, 'It lowers its head — it will charge', 'alert', a.pos);
    this.core.stats.meleeAttacks++;
  }

  private startPulse(a: Actor): void {
    const E = AI.elite;
    this.begin(a, 'pulse', 'pulse', 1.45, 2.7);
    this.beginTelegraph(a, this.hitAt, VIOLET);
    this.marks.push(this.game.vfx.telegraph({ kind: 'circle', pos: a.pos, r: E.pulseField }, this.hitAt, VIOLET));
    this.game.audio.play('eliteRoar', { pos: a.pos, pitch: 0.8, volume: 0.8 });
    caption(this.game, 'Pressure building — cut a link or leave its field', 'pressure', a.pos);
  }

  private startExpose(a: Actor): void {
    this.begin(a, 'expose', 'exposeJoint', 0.55, 2.2);
    this.hitAt = Math.min(this.hitAt, 0.6);
    a.superArmorUntil = 0;
  }

  /** after an attack: phase B answers every heavy attack by opening the joint */
  private afterAttack(a: Actor, heavy: boolean): void {
    this.cd = this.rand(AI.elite.cooldown[0], AI.elite.cooldown[1]) * cooldownScale(this.game) * (this.now < this.lowPressureUntil ? 1.5 : 1);
    this.hitOnce.clear();
    if ((heavy || this.resonance > 0) && this.phase === 'B' && !this.fractured && this.exposeLeft <= 0) this.startExpose(a);
    else this.state = 'hunt';
  }

  private hitArc(a: Actor, arc: number, reach: number, damage: number, poise: number, knockback: number, heavy: boolean): void {
    const actors = this.game.actors;
    const victims = actors.inArc(a.pos, a.yaw, arc, reach, (o) => o !== a && o.targetable && !o.flying && actors.areHostile(a, o));
    if (victims.length) this.game.camera.shake(0.45, 0.25);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i] as Actor;
      if (this.blockedByNoGo(v.pos.x, v.pos.z, 0)) continue;
      this.strike(a, v, damage, poise, knockback, heavy, 'sweep');
    }
  }

  private slamLand(a: Actor): void {
    const E = AI.elite;
    const S = TUNING.enemies.elite;
    const game = this.game;
    const actors = game.actors;
    game.vfx.shockwave(this.center, E.slamOuter, RED, 0.55);
    game.vfx.spawn('dustPuff', this.center, { scale: 2.2 });
    game.vfx.decal('crack', this.center, { size: 4.5 });
    game.audio.play('eliteSlam', { pos: this.center });
    const p = playerActor(game);
    if (p) game.camera.shake(Math.max(0.25, 0.9 - a.distanceTo(p) / 30), 0.5);
    const victims = actors.inRadius(this.center, E.slamOuter, (o) => o !== a && o.targetable && !o.flying && actors.areHostile(a, o));
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i] as Actor;
      if (this.blockedByNoGo(v.pos.x, v.pos.z, 0)) continue;
      const inner = Math.hypot(v.pos.x - this.center.x, v.pos.z - this.center.z) <= E.slamInner;
      // heavy at the point of impact, a blockable shockwave outside it
      _c.copy(this.center);
      this.strike(a, v, inner ? S.slam : S.slam * E.slamOuterDamage, inner ? 70 : 30, inner ? 8 : 5, inner, 'slam', _c);
    }
  }

  private chargeHits(a: Actor): void {
    const actors = this.game.actors;
    const victims = actors.inRadius(a.pos, a.radius + 0.9, (o) => o !== a && o.targetable && !o.flying && actors.areHostile(a, o));
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i] as Actor;
      if (this.hitOnce.has(v)) continue;
      // only what is in its path, not what it has already passed
      if ((v.pos.x - a.pos.x) * this.dir.x + (v.pos.z - a.pos.z) * this.dir.z < -0.3) continue;
      this.hitOnce.add(v);
      this.game.camera.shake(0.7, 0.35);
      this.strike(a, v, TUNING.enemies.elite.charge, 80, 9, true, 'charge');
    }
  }

  private strike(a: Actor, v: Actor, damage: number, poise: number, knockback: number, heavy: boolean, tag: string, from?: THREE.Vector3): void {
    const ox = from ? from.x : a.pos.x;
    const oz = from ? from.z : a.pos.z;
    let dx = v.pos.x - ox;
    let dz = v.pos.z - oz;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) {
      dx = forwardX(a.yaw);
      dz = forwardZ(a.yaw);
    } else {
      dx /= l;
      dz /= l;
    }
    v.aimPoint(_pt);
    this.game.actors.applyHit(v, {
      attacker: a, damage, poise, kind: 'melee', element: 'kinetic', heavy,
      dir: { x: dx, y: 0, z: dz }, point: { x: _pt.x, y: _pt.y, z: _pt.z }, knockback, tag,
    });
  }
}
