/**
 * Melee: light combo chains, the heavy with hold-to-charge, root-motion lunges with soft target magnetism, the
 * damage sweep on the animation's hit times (one hit per target per swing), blade-vs-link tests and trails.
 */
import * as THREE from 'three';
import type { Actor, HitInfo, TrailHandle, VfxHandle } from '@/core/api';
import { clamp01, forwardX, forwardZ, lerp, turnToward, yawTo } from '@/core/mathx';
import { TUNING, type MeleeStep } from '../tuning';
import { live } from '../safe';
import type { PlayerControllerImpl } from './controller';

interface Swing {
  step: MeleeStep;
  heavy: boolean;
  /** damage / poise multiplier (charge) */
  mult: number;
  t: number;
  dur: number;
  hitTimes: number[];
  hitIdx: number;
  /** time from which the recovery may be cancelled into the next action */
  comboAt: number;
  /** time at which a still-held heavy becomes a charge (-1 = no) */
  chargeGate: number;
  target: Actor | null;
  /** fallback facing when there is no target */
  wantYaw: number;
  lungeFrom: number;
  lungeTo: number;
  lungeLeft: number;
  trailOn: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _wp = new THREE.Vector3();

export class Melee {
  private swing: Swing | null = null;
  private readonly struck = new Set<Actor>();
  private combo = 0;
  private lastEndAt = -1e9;
  private chargeT = 0;
  private chargeFull = false;
  private chargeFx: VfxHandle | null = null;
  private trails: TrailHandle[] = [];

  constructor(private readonly p: PlayerControllerImpl) {}

  /** (re)create weapon trails for the current figure */
  bindVisual(): void {
    this.unbindVisual();
    const p = this.p;
    const v = p.visual;
    const vfx = p.game.vfx;
    if (!v || !live(vfx)) return;
    const base = v.socket('weaponBase');
    const opts = { color: p.kit.trailColor, length: p.kit.id === 'selene' ? 0.16 : 0.24 };
    for (const tipName of p.kit.id === 'selene' ? ['weaponTip', 'weaponTip2'] : ['weaponTip']) {
      const tip = v.socket(tipName);
      if (tip === v.root || base === v.root) continue;
      const tr = vfx.trail(base, tip, opts);
      if (live(tr)) this.trails.push(tr);
    }
  }

  unbindVisual(): void {
    for (const t of this.trails) t.remove();
    this.trails.length = 0;
    this.stopChargeFx();
  }

  reset(): void {
    this.swing = null;
    this.struck.clear();
    this.combo = 0;
    this.chargeT = 0;
    this.setTrails(false);
    this.stopChargeFx();
  }

  private setTrails(on: boolean): void {
    for (const t of this.trails) t.setActive(on);
  }

  private stopChargeFx(): void {
    if (this.chargeFx) this.chargeFx.stop();
    this.chargeFx = null;
    this.p.visual?.setGlow(1);
  }

  /** the recovery of the current swing may be cancelled */
  get cancellable(): boolean {
    const s = this.swing;
    return !s || s.t >= s.comboAt;
  }

  // ---- starting attacks -----------------------------------------------------------------------------------

  startLight(): boolean {
    const p = this.p;
    const steps = p.kit.light;
    if (p.now - this.lastEndAt > TUNING.melee.comboReset && !this.swing) this.combo = 0;
    const step = steps[this.combo % steps.length] as MeleeStep;
    this.combo = (this.combo + 1) % steps.length;
    this.begin(step, false, 1, false);
    return true;
  }

  startHeavy(): boolean {
    this.combo = 0;
    this.begin(this.p.kit.heavy, true, 1, false);
    return true;
  }

  /** nearest hostile inside the magnetism cone around the intent (or facing) direction */
  private pickTarget(range: number): Actor | null {
    const p = this.p;
    const a = p.actor;
    const lock = p.lockTarget;
    if (lock && lock.alive && a.distanceTo(lock) - lock.radius <= range + 2.5) return lock;
    const M = TUNING.melee;
    const yaw = p.move.imag > 0.3 ? yawTo(0, 0, p.move.ix, p.move.iz) : a.yaw;
    const list = p.actors.inArc(a.pos, yaw, M.magnetHalfAngle * 2, M.magnetRange, p.attackable);
    return list.length ? (list[0] as Actor) : null;
  }

  private begin(step: MeleeStep, heavy: boolean, mult: number, fromCharge: boolean): void {
    const p = this.p;
    const a = p.actor;
    const M = TUNING.melee;
    const info = p.playAction(step.action, step.duration, step.hitAt);
    const hits = info.hitTimes;
    const first = hits[0] as number;
    const last = hits[hits.length - 1] as number;
    const target = this.pickTarget(step.range);
    this.struck.clear();
    this.swing = {
      step, heavy, mult,
      t: 0,
      dur: info.duration,
      hitTimes: hits,
      hitIdx: 0,
      comboAt: Math.min(info.duration, last + M.comboCancel),
      chargeGate: heavy && !fromCharge ? Math.max(0.05, first - M.chargeGate) : -1,
      target,
      wantYaw: p.move.imag > 0.3 ? yawTo(0, 0, p.move.ix, p.move.iz) : a.yaw,
      lungeFrom: fromCharge ? 0 : first * 0.3,
      lungeTo: Math.max(first * 0.95, 0.04),
      lungeLeft: step.lunge,
      trailOn: false,
    };
    a.guarding = false;
    // a committed greatsword blow is not interrupted by chip damage
    if (heavy && p.kit.id === 'tarrik') a.superArmorUntil = p.now + first + 0.05;
    const audio = p.game.audio;
    const delay = Math.max(0, first - 0.16);
    if (p.kit.id === 'selene') audio.play('verityWhirl', { pos: a.pos, delay, pitch: heavy ? 0.85 : 1 + 0.06 * this.combo });
    else audio.play(heavy ? 'swingHeavy' : 'swingLight', { pos: a.pos, delay });
    p.setState('attack');
  }

  // ---- per-tick -------------------------------------------------------------------------------------------

  updateAttack(dt: number): void {
    const p = this.p;
    const s = this.swing;
    if (!s) {
      p.setState('free');
      return;
    }
    const a = p.actor;
    const M = TUNING.melee;
    const first = s.hitTimes[0] as number;
    const last = s.hitTimes[s.hitTimes.length - 1] as number;
    s.t += dt;
    p.move.brake(dt, 60);

    // wind-up: turn onto the target (or the stick direction), then the blow is committed
    if (s.t < first) {
      const t = s.target;
      if (t && t.alive) a.face(t.pos, M.windupTurn * dt);
      else a.yaw = turnToward(a.yaw, s.wantYaw, M.windupTurn * dt);
    }

    // root-motion lunge, stopping short of the target
    if (s.t >= s.lungeFrom && s.t - dt < s.lungeTo && s.lungeLeft > 0 && !p.movementLocked && dt > 1e-6) {
      const span = Math.max(0.03, s.lungeTo - s.lungeFrom);
      let step = (s.step.lunge / span) * dt;
      const t = s.target;
      if (t && t.alive) {
        const gap = a.distanceTo(t) - t.radius - a.radius - M.lungeStandOff;
        step = Math.min(step, Math.max(0, gap));
      }
      step = Math.min(step, s.lungeLeft);
      s.lungeLeft -= step;
      a.carryVel.x += (forwardX(a.yaw) * step) / dt;
      a.carryVel.z += (forwardZ(a.yaw) * step) / dt;
    }

    // a heavy that is still held at the coil becomes a charge
    if (s.chargeGate >= 0 && s.hitIdx === 0 && s.t >= s.chargeGate && p.down('heavy') && p.game.input.heldTime('heavy') >= s.t - 0.06) {
      this.enterCharge();
      return;
    }

    // blade trail only across the stroke itself
    const wantTrail = s.t >= first - 0.14 && s.t <= last + 0.1;
    if (wantTrail !== s.trailOn) {
      s.trailOn = wantTrail;
      this.setTrails(wantTrail);
    }

    while (s.hitIdx < s.hitTimes.length && s.t >= (s.hitTimes[s.hitIdx] as number)) {
      this.sweep(s);
      s.hitIdx++;
      if (this.swing !== s) return;
    }

    if (s.t >= s.comboAt) {
      if (p.active && p.consumeBuffered()) return;
      // moving out of the tail of the recovery
      const tail = s.comboAt + (s.dur - s.comboAt) * M.moveCancel;
      if (s.t >= s.dur || (s.t >= tail && p.move.imag > 0.3)) this.end();
    }
  }

  /** leave the attack state (also used when something interrupts the swing) */
  end(): void {
    const p = this.p;
    if (this.swing) this.lastEndAt = p.now;
    this.swing = null;
    this.setTrails(false);
    this.stopChargeFx();
    if (p.action === 'attack' || p.action === 'charge') p.setState('free');
  }

  private enterCharge(): void {
    const p = this.p;
    this.swing = null;
    this.setTrails(false);
    this.chargeT = 0;
    this.chargeFull = false;
    p.visual?.play('attackHeavyCharge');
    const v = p.visual;
    if (v) {
      const tip = v.socket('weaponMid');
      this.chargeFx = p.game.vfx.spawn(p.kit.id === 'tarrik' ? 'cinderEmbers' : 'frostBurst', p.actor.aimPoint(_a), {
        attachTo: tip, duration: TUNING.melee.chargeMaxHold + 0.3, scale: 0.8,
      });
      if (!live(this.chargeFx)) this.chargeFx = null;
    }
    if (p.kit.id === 'tarrik') p.game.audio.play('cinderIgnite', { pos: p.actor.pos });
    p.setState('charge');
  }

  updateCharge(dt: number): void {
    const p = this.p;
    const M = TUNING.melee;
    this.chargeT += dt;
    const k = clamp01(this.chargeT / M.chargeFull);
    p.move.locomotion(dt, 'charge');
    p.visual?.setGlow(1 + 2.2 * k);
    if (k >= 1 && !this.chargeFull) {
      this.chargeFull = true;
      p.visual?.flash(p.kit.color, 0.18);
      p.game.audio.play('echoGain', { pos: p.actor.pos, volume: 0.6 });
      p.game.input.rumble(0.3, 0.6, 90);
    }
    if (p.active && p.buffered === 'dodge' && p.consumeBuffered()) {
      p.visual?.stop('attackHeavyCharge');
      this.stopChargeFx();
      return;
    }
    if (!p.down('heavy') || !p.active || this.chargeT >= M.chargeMaxHold) {
      this.stopChargeFx();
      this.begin(p.kit.heavy, true, lerp(1, M.chargeScale, k), true);
    }
  }

  /** the player was hit hard enough to lose the action */
  interrupt(): void {
    const p = this.p;
    if (p.action === 'charge') p.visual?.stop('attackHeavyCharge');
    this.end();
  }

  // ---- the hit --------------------------------------------------------------------------------------------

  private sweep(s: Swing): void {
    const p = this.p;
    const a = p.actor;
    const step = s.step;
    const M = TUNING.melee;
    const physics = p.physics;
    a.aimPoint(_a);
    const cx = _a.x;
    const cy = _a.y;
    const cz = _a.z;
    const list = p.actors.inArc(a.pos, a.yaw, step.arc, step.range, p.attackable);
    const charged = s.mult > 1.05;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Actor;
      if (this.struck.has(t)) continue;
      t.aimPoint(_b);
      _a.set(cx, cy, cz);
      if (physics && !physics.lineOfFire(_a, _b)) continue;
      this.struck.add(t);
      let dx = t.pos.x - a.pos.x;
      let dz = t.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        dx /= d;
        dz /= d;
      } else {
        dx = forwardX(a.yaw);
        dz = forwardZ(a.yaw);
      }
      // a blade reaches an exposed weak point when it is inside the swing
      const wp = p.actors.weakPointPosition(t, _wp);
      const reach = wp !== null && Math.hypot(_wp.x - a.pos.x, _wp.z - a.pos.z) <= step.range + 0.4 && _wp.y <= a.pos.y + M.reachUp;
      const point = reach ? _wp.clone() : new THREE.Vector3(_b.x - dx * t.radius, Math.min(_b.y, a.pos.y + 1.6), _b.z - dz * t.radius);
      const hit: HitInfo = {
        attacker: a,
        damage: step.damage * s.mult,
        poise: step.poise * s.mult,
        kind: 'melee',
        element: charged ? (p.kit.id === 'tarrik' ? 'cinder' : 'frost') : 'kinetic',
        dir: { x: dx, y: 0, z: dz },
        point,
        heavy: s.heavy,
        knockback: step.knockback * (charged ? 1.3 : 1),
        weakPoint: reach,
      };
      const res = p.actors.applyHit(t, hit);
      p.onDealt(t, hit, res);
    }
    this.cutLinks(step, cx, cy, cz);
  }

  /** a swing through a visible link severs it: probe a fan of segments across the arc */
  private cutLinks(step: MeleeStep, cx: number, cy: number, cz: number): void {
    const p = this.p;
    const ai = p.game.ai;
    if (!live(ai) || !live(ai.links)) return;
    const a = p.actor;
    const rays = step.arc > Math.PI * 1.5 ? 8 : 5;
    const half = Math.min(Math.PI, step.arc * 0.5);
    _a.set(cx, cy, cz);
    for (let i = 0; i < rays; i++) {
      const u = rays === 8 ? i / rays : i / (rays - 1);
      const yaw = a.yaw + (rays === 8 ? u * Math.PI * 2 : lerp(-half, half, u));
      // the blade sweeps from hip to above the head across the arc
      _b.set(cx + forwardX(yaw) * step.range, cy + lerp(-0.5, 0.9, u), cz + forwardZ(yaw) * step.range);
      const link = ai.links.hitTest(_a, _b, TUNING.melee.linkRadius);
      if (live(link) && link.alive === true) {
        ai.links.sever(link, a);
        return;
      }
    }
  }
}
