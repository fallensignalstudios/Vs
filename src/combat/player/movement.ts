/** Locomotion, facing and the dodge. Camera-relative, with acceleration curves and strafe-facing modes. */
import * as THREE from 'three';
import type { Vec3Like } from '@/core/api';
import { forwardX, forwardZ, lerp, turnToward, wrapAngle, yawTo } from '@/core/mathx';
import { TUNING } from '../tuning';
import { live } from '../safe';
import type { PlayerControllerImpl } from './controller';

export type MoveMode = 'free' | 'aim' | 'guard' | 'charge' | 'none';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _dodgeOpts: { dir: number } = { dir: Math.PI };

export class Movement {
  /** world-space move intent this tick (|i| ≤ 1) */
  ix = 0;
  iz = 0;
  imag = 0;
  /** current locomotion velocity */
  vx = 0;
  vz = 0;
  sprinting = false;

  private dodgeT = 0;
  private dodgeX = 0;
  private dodgeZ = -1;
  private dodgeReadyAt = 0;

  constructor(private readonly p: PlayerControllerImpl) {}

  reset(): void {
    this.vx = this.vz = 0;
    this.ix = this.iz = this.imag = 0;
    this.dodgeT = 0;
    this.dodgeReadyAt = 0;
    this.sprinting = false;
  }

  /** read the move intent in world space (autoplay's moveWorld wins over the camera basis) */
  readIntent(active: boolean): void {
    this.ix = this.iz = this.imag = 0;
    if (!active) return;
    const input = this.p.game.input;
    const mw = input.moveWorld;
    let x = 0;
    let z = 0;
    if (mw && typeof mw.x === 'number' && typeof mw.z === 'number') {
      x = mw.x;
      z = mw.z;
    } else {
      const m = input.move;
      const mx = typeof m?.x === 'number' ? m.x : 0;
      const my = typeof m?.y === 'number' ? m.y : 0;
      if (mx !== 0 || my !== 0) {
        const cam = this.p.game.camera;
        _f.set(0, 0, -1);
        _r.set(1, 0, 0);
        cam.getForward(_f);
        cam.getRight(_r);
        x = _r.x * mx + _f.x * my;
        z = _r.z * mx + _f.z * my;
      }
    }
    const len = Math.hypot(x, z);
    if (!(len > 1e-4)) return;
    const mag = Math.min(1, len);
    this.ix = (x / len) * mag;
    this.iz = (z / len) * mag;
    this.imag = mag;
  }

  /**
   * Yaw the body squares up to in strafe modes. Aiming: along the aim ray, so the muzzle points where the
   * reticle does. Guarding / charging: the follow orbit's yaw — the view itself is toed in toward the hero's
   * side for composition, and a guard should face what is ahead of the hero, not ahead of the lens.
   */
  cameraYaw(aim: boolean): number {
    const a = this.p.actor;
    const cam = this.p.game.camera;
    if (!aim && typeof cam.yaw === 'number' && Number.isFinite(cam.yaw)) return cam.yaw;
    _o.set(0, 0, 0);
    _d.set(forwardX(a.yaw), 0, forwardZ(a.yaw));
    cam.getAimRay(_o, _d);
    return Math.hypot(_d.x, _d.z) > 1e-4 ? yawTo(0, 0, _d.x, _d.z) : a.yaw;
  }

  /**
   * Turn the follow orbit so the aim ray (screen centre) passes through `point`, correcting the parallax of the
   * shoulder offset. Uses where the lens sits relative to the pivot right now; converges in 2–3 frames.
   */
  aimCameraAt(point: Vec3Like): void {
    const cam = this.p.game.camera;
    if (!live(cam) || cam.mode !== 'follow' || !point || !Number.isFinite(point.x + point.y + point.z)) return;
    const a = this.p.actor;
    _o.set(a.pos.x, a.pos.y, a.pos.z);
    _d.set(0, 0, -1);
    cam.getAimRay(_o, _d);
    const fl = Math.hypot(_d.x, _d.z);
    if (!(fl > 1e-4)) return;
    const fx = _d.x / fl;
    const fz = _d.z / fl;
    // lens position in its own flattened frame (constant while the orbit turns)
    const side = (_o.x - a.pos.x) * -fz + (_o.z - a.pos.z) * fx;
    const back = (_o.x - a.pos.x) * fx + (_o.z - a.pos.z) * fz;
    const dx = point.x - a.pos.x;
    const dz = point.z - a.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < Math.abs(side) + 0.05) return;
    const off = Math.asin(Math.max(-1, Math.min(1, side / len)));
    cam.yaw = Math.atan2(-dx, -dz) + off;
    cam.pitch = Math.atan2(point.y - _o.y, Math.max(0.2, len * Math.cos(off) - back));
  }

  /** walk / run / sprint with acceleration; writes actor.desiredVel and turns the body */
  locomotion(dt: number, mode: MoveMode): void {
    const p = this.p;
    const a = p.actor;
    const M = TUNING.move;
    const mag = p.movementLocked || mode === 'none' ? 0 : this.imag;
    const lock = p.lockTarget;
    this.sprinting = mode === 'free' && mag > 0.2 && p.engaged('sprint');
    let top = 0;
    if (mag > 0.02) {
      if (mode === 'aim') top = M.aim * mag;
      else if (mode === 'guard') top = M.guard * mag;
      else if (mode === 'charge') top = M.charge * mag;
      else if (this.sprinting) top = M.sprint;
      else top = mag < 0.5 ? M.walk * (mag / 0.5) : lerp(M.walk, M.run, (mag - 0.5) / 0.5);
    }
    const tx = mag > 0.02 ? (this.ix / this.imag) * top : 0;
    const tz = mag > 0.02 ? (this.iz / this.imag) * top : 0;
    const dvx = tx - this.vx;
    const dvz = tz - this.vz;
    const dist = Math.hypot(dvx, dvz);
    if (dist > 1e-5) {
      // speeding up (or steering) is snappy; coasting to a stop is slightly softer
      const rate = (top > 0.01 ? M.accel : M.decel) * dt;
      if (dist <= rate) {
        this.vx = tx;
        this.vz = tz;
      } else {
        this.vx += (dvx / dist) * rate;
        this.vz += (dvz / dist) * rate;
      }
    }
    a.desiredVel.set(this.vx, 0, this.vz);
    a.loco.sprint = this.sprinting;
    a.loco.aiming = mode === 'aim';

    // facing
    const speed = Math.hypot(this.vx, this.vz);
    if (mode === 'aim') a.yaw = turnToward(a.yaw, this.cameraYaw(true), M.strafeTurnRate * dt);
    else if (lock && lock.alive && !this.sprinting) a.face(lock.pos, M.strafeTurnRate * dt);
    else if (mode === 'guard' || mode === 'charge') a.yaw = turnToward(a.yaw, this.cameraYaw(false), (mode === 'charge' ? 5 : M.strafeTurnRate) * dt);
    else if (mag > 0.05 && speed > 0.2) a.yaw = turnToward(a.yaw, yawTo(0, 0, this.ix, this.iz), M.turnRate * dt);
  }

  /** bleed locomotion speed while an action owns the body */
  brake(dt: number, rate = TUNING.move.decel): void {
    const s = Math.hypot(this.vx, this.vz);
    if (s < 1e-4) {
      this.vx = this.vz = 0;
      return;
    }
    const k = Math.max(0, s - rate * dt) / s;
    this.vx *= k;
    this.vz *= k;
  }

  canDodge(): boolean {
    return !this.p.movementLocked && this.p.now >= this.dodgeReadyAt;
  }

  /** 4.5 m in 0.45 s with i-frames; direction = input, or straight back when there is none */
  startDodge(): boolean {
    const p = this.p;
    if (!this.canDodge()) return false;
    const a = p.actor;
    const D = TUNING.dodge;
    if (this.imag > 0.2) {
      this.dodgeX = this.ix / this.imag;
      this.dodgeZ = this.iz / this.imag;
    } else {
      this.dodgeX = -forwardX(a.yaw);
      this.dodgeZ = -forwardZ(a.yaw);
    }
    this.dodgeT = 0;
    a.iframesUntil = Math.max(a.iframesUntil, p.now + D.iframes);
    p.setState('dodge');
    _dodgeOpts.dir = wrapAngle(yawTo(0, 0, this.dodgeX, this.dodgeZ) - a.yaw);
    p.visual?.play('dodge', _dodgeOpts);
    p.game.audio.play('dodge', { pos: a.pos });
    p.game.camera.fovPunch(2.5, 0.5);
    p.game.vfx.spawn('footDust', a.pos);
    return true;
  }

  updateDodge(dt: number): void {
    const p = this.p;
    const a = p.actor;
    const D = TUNING.dodge;
    if (this.dodgeT < D.time && dt > 1e-6) {
      // front-loaded burst; the midpoint rule on a linear profile integrates to exactly D.distance
      const step = Math.min(dt, D.time - this.dodgeT);
      const u = (this.dodgeT + step * 0.5) / D.time;
      const speed = (D.distance / D.time) * (1.6 - 1.2 * u) * (step / dt);
      a.carryVel.x += this.dodgeX * speed;
      a.carryVel.z += this.dodgeZ * speed;
    }
    this.dodgeT += dt;
    this.vx = this.vz = 0;
    if (this.dodgeT >= D.time) {
      // recovery: a buffered action may cut it short
      if (this.dodgeT >= D.time + D.recovery || p.consumeBuffered()) {
        this.finishDodge();
      }
    }
  }

  private finishDodge(): void {
    const p = this.p;
    this.dodgeReadyAt = p.now + TUNING.dodge.cooldown;
    // carry a little momentum out of the roll when the stick is still held that way
    if (this.imag > 0.3) {
      const keep = TUNING.move.run * 0.7;
      this.vx = this.dodgeX * keep;
      this.vz = this.dodgeZ * keep;
    }
    if (p.action === 'dodge') p.setState('free');
  }

  /** true while the roll itself (not its recovery) is in progress */
  get rolling(): boolean {
    return this.p.action === 'dodge' && this.dodgeT < TUNING.dodge.time;
  }
}
