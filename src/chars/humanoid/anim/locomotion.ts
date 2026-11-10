/**
 * Procedural locomotion: idle weight-shift → walk → run → sprint, any movement direction.
 *
 * The stride phase advances with the DISTANCE the root really travelled (the speed input only picks the gait), and
 * a foot in stance is locked to the spot it landed on in world space until toe-off — so feet do not skate through
 * starts, stops, turns or when the body is blocked. At rest the same lock makes the figure take small turn /
 * settle steps instead of swivelling on the spot. Feet are IK targets (heel strike → flat → heel-off on the ball →
 * swing arc); hips bob, sway, yaw and roll around them; the torso counter-rotates; arms swing from whatever carry
 * stance is active.
 *
 * A figure whose root nobody moves (sandbox previews, unit tests) runs on a virtual treadmill driven by the speed
 * input; the first real displacement switches it to measured travel for good.
 */
import * as THREE from 'three';
import { FK, Pose } from './pose';
import { footFromContact } from './clip';

export interface StanceSet {
  idle: Pose;
  walk: Pose;
  run: Pose;
  /** arm swing multipliers [L,R] (a weapon arm swings less) */
  swing: readonly [number, number];
  /** extra knee bend / hip drop in metres (heavy or hunched figures) */
  crouch?: number;
  /** stance half-width */
  width?: number;
}

export interface LocoFlags { sprint: boolean; aiming: boolean; guarding: boolean; injured: boolean }

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const ss = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixn = (a: number, b: number, t: number): number => a + (b - a) * t;
const wrap = (a: number): number => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

/** seconds per full stride (two steps) for a planar speed in reference-scale m/s */
export function cycleTime(s: number): number {
  if (s <= 0.3) return 1.3;
  if (s < 1.2) return mixn(1.3, 1.0, (s - 0.3) / 0.9);
  if (s < 2.2) return mixn(1.0, 0.8, (s - 1.2) / 1.0);
  if (s < 5.2) return mixn(0.8, 0.66, (s - 2.2) / 3.0);
  if (s < 7.2) return mixn(0.66, 0.56, (s - 5.2) / 2.0);
  return 0.56;
}

/** longest distance a planted foot can travel under the hips with this leg length */
export const MAX_STANCE_TRAVEL = 0.95;

/**
 * Fraction of the stride a foot spends on the ground. Walking keeps double support (> 0.5); as speed rises the
 * contact shortens so the foot never has to reach farther than the leg allows — which is exactly what turns a
 * walk into a run with a flight phase. `T` overrides the cycle time (aim-walk / limp cadence).
 */
export function dutyFactor(s: number, T = cycleTime(s)): number {
  if (s < 0.05) return 0.62;
  return Math.min(0.62, MAX_STANCE_TRAVEL / (s * T));
}

/** distance a planted foot travels under the body during one stance */
export function stanceTravel(s: number, T = cycleTime(s)): number {
  return s * dutyFactor(s, T) * T;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _qx = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qz = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _foot = new Float32Array(14);
const _toe = new Float32Array(2);

function mulFk(pose: Pose, ch: number, pre: THREE.Quaternion | null, post: THREE.Quaternion | null): void {
  _q.fromArray(pose.q, ch * 4);
  if (pre) _q.premultiply(pre);
  if (post) _q.multiply(post);
  _q.toArray(pose.q, ch * 4);
}

function ypr(pitchFwd: number, yawLeft: number, rollRight: number, out: THREE.Quaternion): THREE.Quaternion {
  _qy.setFromAxisAngle(Y, yawLeft);
  _qx.setFromAxisAngle(X, -pitchFwd);
  _qz.setFromAxisAngle(Z, -rollRight);
  return out.copy(_qy).multiply(_qx).multiply(_qz);
}

/** World-space plant of one foot, and the offset it currently adds to the nominal gait. */
interface FootLock {
  on: boolean;
  /** planted contact in travel space + the root yaw it was planted under */
  x: number; z: number; yaw: number;
  /** current offset from the nominal foot (model space) */
  ex: number; ez: number; eyaw: number;
  /** offset at release / step start, decaying to zero */
  sx: number; sz: number; syaw: number;
  /** corrective step progress 0..1 (−1 = none) */
  step: number;
}

const newLock = (): FootLock => ({ on: false, x: 0, z: 0, yaw: 0, ex: 0, ez: 0, eyaw: 0, sx: 0, sz: 0, syaw: 0, step: -1 });
/** a planted foot may trail its nominal spot by this much before it is dragged (m / rad) */
const MAX_DRIFT = 0.3, MAX_TWIST = 1.2;
/** at rest, a foot this far off its spot takes a step (m / rad) */
const STEP_DIST = 0.11, STEP_TWIST = 0.6, STEP_TIME = 0.26;

export class Locomotion {
  /** stride phase 0..1 (left heel strike at 0, right at 0.5) */
  phase = 0;
  /** smoothed speed of travel actually covered by walking (reference m/s) */
  speed = 0;
  /** smoothed movement direction relative to facing (rad, + = left) */
  moveYaw = 0;
  private targetSpeed = 0;
  private targetYaw = 0;
  private inSpeed = 0;
  private idleT = 0;
  private accelLean = 0;
  /** lean into turns (rad, + = right), fed by the animator from the root's yaw rate */
  turnLean = 0;
  readonly flags: LocoFlags = { sprint: false, aiming: false, guarding: false, injured: false };
  /** called at each heel strike with side −1 (L) / +1 (R) */
  onStep: ((side: number) => void) | null = null;
  private guardW = 0;
  private aimW = 0;
  private limpW = 0;
  /** stride period in use (cadence shortens when aiming, lengthens with a limp) */
  private cycle = 1.3;

  // root odometry: displacement reported since the last advance (reference metres, world axes) + facing
  private pendX = 0;
  private pendZ = 0;
  private rootYaw = 0;
  private ox = 0;
  private oz = 0;
  private travelling = false;
  private legsFree = true;
  private dt = 0;
  private readonly feet: [FootLock, FootLock] = [newLock(), newLock()];

  /** what the driver last asked for (reference m/s, rad) */
  get inputSpeed(): number { return this.targetSpeed; }
  get inputYaw(): number { return this.targetYaw; }

  setInput(speed: number, moveYaw: number, flags: Partial<LocoFlags> | undefined): void {
    this.targetSpeed = Math.max(0, Number.isFinite(speed) ? speed : 0);
    if (Number.isFinite(moveYaw)) this.targetYaw = moveYaw;
    this.flags.sprint = !!flags?.sprint; this.flags.aiming = !!flags?.aiming; this.flags.guarding = !!flags?.guarding; this.flags.injured = !!flags?.injured;
  }

  /** Report how the root moved since the last frame (reference metres along world X / Z) and its facing. */
  setRoot(dx: number, dz: number, yaw: number): void {
    if (Number.isFinite(dx + dz)) { this.pendX += dx; this.pendZ += dz; }
    if (Number.isFinite(yaw)) this.rootYaw = yaw;
  }

  /** Snap smoothing state and release the feet (after teleports / spawns). */
  snap(): void {
    this.speed = this.inSpeed = this.targetSpeed; this.moveYaw = this.targetYaw; this.accelLean = 0; this.turnLean = 0;
    this.pendX = 0; this.pendZ = 0;
    for (const f of this.feet) { f.on = false; f.ex = f.ez = f.eyaw = 0; f.step = -1; }
  }

  /** Treadmill step (no root motion reported): kept for previews and tests. */
  update(dt: number): void { this.advance(dt, true); }

  /** Advance by `dt`; `legsFree` = locomotion owns the legs this frame (no full-body clip over them). */
  advance(dt: number, legsFree: boolean): void {
    this.dt = dt;
    this.legsFree = legsFree;
    this.inSpeed += (this.targetSpeed - this.inSpeed) * (1 - Math.exp(-12 * dt));
    const mx = this.pendX, mz = this.pendZ;
    this.pendX = 0; this.pendZ = 0;
    const md = Math.hypot(mx, mz);
    if (md > 1e-6) this.travelling = true;
    // split the root's motion into walking (drives the stride) and carry (shoves, dodges, platforms: feet ride along)
    let wx = 0, wz = 0, cx = 0, cz = 0;
    if (!this.travelling) {
      const a = this.rootYaw + this.moveYaw, d = this.inSpeed * dt;
      wx = -Math.sin(a) * d; wz = -Math.cos(a) * d;
    } else if (md > 1e-7) {
      const expect = Math.max(this.targetSpeed, this.inSpeed) * dt * 1.6;
      const share = legsFree ? Math.min(1, expect / md) : 0;
      wx = mx * share; wz = mz * share; cx = mx - wx; cz = mz - wz;
    }
    this.ox += wx + cx; this.oz += wz + cz;
    if (cx !== 0 || cz !== 0) for (const f of this.feet) { f.x += cx; f.z += cz; }
    const wd = Math.hypot(wx, wz);

    const prev = this.speed;
    if (dt > 1e-6) this.speed += (wd / dt - this.speed) * (1 - Math.exp(-(this.travelling ? 14 : 80) * dt));
    let ty = this.targetYaw;
    if (this.travelling && wd > 1e-5 && this.speed > 0.25) {
      const s = Math.sin(this.rootYaw), c = Math.cos(this.rootYaw);
      ty = Math.atan2(-wx * c + wz * s, -wx * s - wz * c);
    }
    if (this.targetSpeed > 0.05 || this.speed > 0.05) this.moveYaw += wrap(ty - this.moveYaw) * (1 - Math.exp(-10 * dt));
    const accel = dt > 1e-5 ? (this.speed - prev) / dt : 0;
    this.accelLean += (Math.max(-8, Math.min(10, accel * 0.9)) * DEG - this.accelLean) * (1 - Math.exp(-6 * dt));
    const a = 1 - Math.exp(-8 * dt);
    this.guardW += ((this.flags.guarding ? 1 : 0) - this.guardW) * a;
    this.aimW += ((this.flags.aiming ? 1 : 0) - this.aimW) * a;
    this.limpW += ((this.flags.injured ? 1 : 0) - this.limpW) * a;
    this.idleT += dt;
    for (const f of this.feet) if (f.step >= 0) f.step += dt / STEP_TIME;
    // aiming shortens the stride (quicker, flatter steps); a limp slows the cadence
    this.cycle = cycleTime(this.speed) * (1 + this.limpW * 0.25) * (1 - this.aimW * 0.2 * ss(0.3, 1.5, this.speed));
    if (this.speed > 0.05 && wd > 0) {
      const stride = Math.max(0.35, this.speed * this.cycle);
      const before = this.phase;
      this.phase = (this.phase + Math.min(0.45, wd / stride)) % 1;
      if (this.onStep && this.speed > 0.4) {
        if (this.phase < before) this.onStep(-1);
        else if (before < 0.5 && this.phase >= 0.5) this.onStep(1);
      }
    }
  }

  /** Write the locomotion pose into `out`. */
  evaluate(out: Pose, st: StanceSet): void {
    const s = this.speed;
    const mv = ss(0.08, 0.7, s);
    const run = ss(2.4, 4.4, s);
    const spr = ss(5.8, 7.0, s);
    const guard = this.guardW, aim = this.aimW, limp = this.limpW;

    out.copy(st.idle);
    if (mv > 0) { out.mix(st.walk, mv * (1 - run)); if (run > 0) out.mix(st.run, mv * run); }

    const T = this.cycle;
    const d = dutyFactor(s, T);
    const travel = stanceTravel(s, T);
    // a walker's foot lands as far ahead as it leaves behind; a runner lands under the body and pushes off long
    const front = mixn(0.47, 0.37, run);
    const ph = this.phase;
    const my = this.moveYaw;
    // hips twist toward the travel direction when strafing; the chest untwists
    const hy = Math.sin(my) * 48 * DEG * mv;
    const dx = -Math.sin(my), dz = -Math.cos(my);
    const fwdness = Math.cos(my - hy);
    const width = (st.width ?? 0.105) + guard * 0.035 + aim * 0.015 + (1 - mv) * 0.01;
    const chy = Math.cos(hy), shy = Math.sin(hy);
    const sinR = Math.sin(this.rootYaw), cosR = Math.cos(this.rootYaw);

    // ---- feet -------------------------------------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const p = (ph + (i === 0 ? 0 : 0.5)) % 1;
      let di = d;
      if (limp > 0 && i === 1) di = d * (1 - 0.28 * limp);
      // home under the hip, rotated with the hips twist
      const hxm = side * width * chy, hzm = -side * width * shy;
      let along: number, lift = 0, pitch: number, toeScale = 1, swing = -1;
      if (p < di) {
        const u = p / di;
        along = (front - u) * travel;
        const strike = mixn(15, 7, run) * (1 - ss(0, 0.24, u));
        const heelOff = -mixn(36, 50, run) * ss(0.52, 1, u);
        pitch = (strike + heelOff) * Math.max(0, fwdness);
      } else {
        const w = (p - di) / (1 - di);
        swing = w;
        const e = w * w * (3 - 2 * w);
        along = (front - 1 + mixn(e, w, 0.35)) * travel;
        const H = mixn(0.075, 0.2, run) + spr * 0.07 - guard * 0.02 - aim * 0.02 * (1 - run);
        // early high heel (back-kick) then reach
        lift = H * Math.sin(Math.PI * Math.pow(w, 0.8)) + run * 0.1 * Math.sin(Math.PI * Math.min(1, w * 1.7));
        const pEnd = -mixn(36, 50, run), pMid = -mixn(42, 78, run), pStrike = mixn(15, 7, run);
        const a = ss(0, 0.3, w), b2 = ss(0.35, 1, w);
        pitch = (mixn(mixn(pEnd, pMid, a), pStrike, b2)) * Math.max(0.15, fwdness);
        toeScale = 1 - ss(0, 0.3, w);
      }
      const bias = mixn(0.035, -0.01, run) * mv;
      const fx = hxm + dx * (along + bias) * mv;
      const fz = hzm + dz * (along + bias) * mv;
      const toeOut = mixn(8, 3, mv) - side * (hy / DEG);
      footFromContact(side, fx, lift * mv, -fz, pitch * mv, toeOut, 0, false, _foot, _foot, i * 7, _toe, i);
      _toe[i] *= toeScale;
      // knee pole: where the foot heads, opened slightly outward
      const head = -(-side * toeOut * DEG);
      const kx = -Math.sin(-head) + side * 0.1, kz = -Math.cos(-head);
      const k3 = i * 3, k = i * 7;
      // contact reference the world lock compares against (the flat-foot spot, blended like the foot itself)
      const cxm = out.foot[k] + (fx - out.foot[k]) * mv, czm = out.foot[k + 2] + (fz - out.foot[k + 2]) * mv;
      if (mv >= 0.999) {
        for (let c = 0; c < 7; c++) out.foot[k + c] = _foot[k + c];
        out.knee[k3] = kx; out.knee[k3 + 1] = 0.05; out.knee[k3 + 2] = kz;
        out.toe[i] = _toe[i];
      } else if (mv > 0) {
        for (let c = 0; c < 3; c++) out.foot[k + c] += (_foot[k + c] - out.foot[k + c]) * mv;
        _q.set(out.foot[k + 3], out.foot[k + 4], out.foot[k + 5], out.foot[k + 6]);
        _q2.set(_foot[k + 3], _foot[k + 4], _foot[k + 5], _foot[k + 6]);
        _q.slerp(_q2, mv);
        out.foot[k + 3] = _q.x; out.foot[k + 4] = _q.y; out.foot[k + 5] = _q.z; out.foot[k + 6] = _q.w;
        out.knee[k3] += (kx - out.knee[k3]) * mv; out.knee[k3 + 1] += (0.05 - out.knee[k3 + 1]) * mv; out.knee[k3 + 2] += (kz - out.knee[k3 + 2]) * mv;
        out.toe[i] += (_toe[i] - out.toe[i]) * mv;
      }

      // ---- world lock: a foot on the ground stays where it landed ------------------------------------------
      const f = this.feet[i], other = this.feet[1 - i];
      const grounded = mv < 0.02 || swing < 0;
      if (!this.legsFree) { f.on = false; f.ex = f.ez = f.eyaw = 0; f.step = -1; }
      else if (f.step >= 0) {
        // corrective / turn step: lift, swing onto the nominal spot, plant
        if (f.step >= 1 || mv > 0.5) { f.step = -1; f.ex = f.ez = f.eyaw = 0; }
        else {
          const u = f.step * f.step * (3 - 2 * f.step);
          f.ex = f.sx * (1 - u); f.ez = f.sz * (1 - u); f.eyaw = f.syaw * (1 - u);
          out.foot[k + 1] += 0.055 * Math.sin(Math.PI * f.step) * (1 - mv);
        }
      } else if (grounded) {
        if (!f.on) {
          // plant where the foot is right now (nominal + whatever offset it still carries)
          const px = cxm + f.ex, pz = czm + f.ez;
          f.x = this.ox + cosR * px + sinR * pz; f.z = this.oz - sinR * px + cosR * pz;
          f.yaw = this.rootYaw + f.eyaw;
          f.on = true;
        }
        const rx = f.x - this.ox, rz = f.z - this.oz;
        f.ex = cosR * rx - sinR * rz - cxm; f.ez = sinR * rx + cosR * rz - czm;
        f.eyaw = wrap(f.yaw - this.rootYaw);
        let drag = false;
        const e = Math.hypot(f.ex, f.ez);
        if (e > MAX_DRIFT) { f.ex *= MAX_DRIFT / e; f.ez *= MAX_DRIFT / e; drag = true; }
        if (Math.abs(f.eyaw) > MAX_TWIST) { f.eyaw = Math.sign(f.eyaw) * MAX_TWIST; drag = true; }
        if (drag) {
          const px = cxm + f.ex, pz = czm + f.ez;
          f.x = this.ox + cosR * px + sinR * pz; f.z = this.oz - sinR * px + cosR * pz; f.yaw = this.rootYaw + f.eyaw;
        }
        // at rest: step back under the body once the plant has drifted or twisted too far (one foot at a time)
        if (mv < 0.3 && other.step < 0) {
          const need = Math.max(Math.hypot(f.ex, f.ez) / STEP_DIST, Math.abs(f.eyaw) / STEP_TWIST);
          const otherNeed = other.on ? Math.max(Math.hypot(other.ex, other.ez) / STEP_DIST, Math.abs(other.eyaw) / STEP_TWIST) : 0;
          if (need > 1 && need >= otherNeed) { f.step = 0; f.on = false; f.sx = f.ex; f.sz = f.ez; f.syaw = f.eyaw; }
        }
      } else {
        // swing: let go and ease back onto the nominal arc
        if (f.on) { f.on = false; f.sx = f.ex; f.sz = f.ez; f.syaw = f.eyaw; }
        const u = 1 - ss(0, 0.55, swing);
        f.ex = f.sx * u; f.ez = f.sz * u; f.eyaw = f.syaw * u;
      }
      if (f.ex !== 0 || f.ez !== 0 || f.eyaw !== 0) {
        out.foot[k] += f.ex; out.foot[k + 2] += f.ez;
        _qy.setFromAxisAngle(Y, f.eyaw);
        _q.set(out.foot[k + 3], out.foot[k + 4], out.foot[k + 5], out.foot[k + 6]).premultiply(_qy);
        out.foot[k + 3] = _q.x; out.foot[k + 4] = _q.y; out.foot[k + 5] = _q.z; out.foot[k + 6] = _q.w;
        const c = Math.cos(f.eyaw * 0.6), sn = Math.sin(f.eyaw * 0.6);
        const px = out.knee[k3], pz = out.knee[k3 + 2];
        out.knee[k3] = c * px + sn * pz; out.knee[k3 + 2] = -sn * px + c * pz;
      }
    }

    // ---- hips -------------------------------------------------------------------------------------------
    const c2 = Math.cos(TAU * 2 * (ph - d / 2));
    const c1 = Math.cos(TAU * (ph - d / 2));
    const c0 = Math.cos(TAU * ph);
    const quiet = 1 - aim * 0.45 - guard * 0.3;
    const bob = mixn(0.02 * c2, -0.04 * c2, run) * quiet;
    const crouch = (st.crouch ?? 0) + guard * 0.055 + aim * 0.045;
    out.hip[1] += (bob - (0.014 + 0.03 * run + 0.02 * spr)) * mv - crouch;
    const swayAmp = mixn(0.024, 0.01, run) * quiet;
    out.hip[0] += -swayAmp * c1 * mv * chy;
    out.hip[2] += -swayAmp * c1 * mv * -shy;
    // idle weight shift + breathing sink
    const idle = 1 - mv;
    const ws = Math.sin(this.idleT * 0.55) + 0.35 * Math.sin(this.idleT * 0.21 + 1.3);
    out.hip[0] += ws * 0.012 * idle;
    out.hip[1] += -Math.abs(ws) * 0.004 * idle;
    // planted feet that trail the body pull the hips a little toward them (and down, so the legs can reach)
    const f0 = this.feet[0], f1 = this.feet[1];
    out.hip[0] += (f0.ex + f1.ex) * 0.25; out.hip[2] += (f0.ez + f1.ez) * 0.25;
    out.hip[1] -= Math.min(0.06, (Math.hypot(f0.ex, f0.ez) + Math.hypot(f1.ex, f1.ez)) * 0.12);
    // limp: dip onto the good leg, hurry off the bad one
    const pr = (ph + 0.5) % 1;
    const badStance = pr < d * 0.72 ? Math.sin((Math.PI * pr) / (d * 0.72)) : 0;
    out.hip[1] -= limp * mv * (0.02 + 0.03 * badStance);

    // lean with the direction of travel: forward when advancing, a little back on the heels when backing up
    const leanDir = fwdness >= 0 ? Math.max(0.3, fwdness) : 0.55 * fwdness;
    const lean = ((2 + 6 * run + 5 * spr) * DEG * mv + this.accelLean * mv) * leanDir * (1 - aim * 0.4) + guard * 3 * DEG + aim * 2 * DEG;
    const sideLean = Math.sin(my - hy) * 3 * DEG * mv;
    const yawOsc = -mixn(5, 9, run) * DEG * c0 * mv * quiet;
    const roll = mixn(3, 2, run) * DEG * c1 * mv * quiet + ws * 1.2 * DEG * idle + this.turnLean * mv - sideLean + limp * mv * 5 * DEG * badStance;
    ypr(lean * 0.55, hy + yawOsc, roll, _q2);
    mulFk(out, FK.hips, null, _q2);

    // ---- torso counter-motion ---------------------------------------------------------------------------
    ypr(lean * 0.3, -(hy * 0.55 + yawOsc * 0.9), -roll * 0.55, _q2);
    mulFk(out, FK.spine, null, _q2);
    ypr(lean * 0.15, -(hy * 0.45 + yawOsc * 0.85), -roll * 0.3 + this.turnLean * 0.4 * mv, _q2);
    mulFk(out, FK.chest, null, _q2);
    ypr(-lean * 0.45, yawOsc * 0.5, -roll * 0.1, _q2);
    mulFk(out, FK.neck, null, _q2);
    ypr(-lean * 0.4, yawOsc * 0.25, 0, _q2);
    mulFk(out, FK.head, null, _q2);

    // ---- arms -------------------------------------------------------------------------------------------
    const amp = (mixn(17, 36, run) + spr * 9) * DEG * mv * (1 - aim * 0.6);
    const lag = 0.035;
    const cArm = Math.cos(TAU * (ph - lag));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const sw = st.swing[i];
      // contralateral: left arm forward with the right leg (phase 0.5)
      const swing = (i === 0 ? -cArm : cArm) * amp * sw;
      if (out.armIk[i] < 0.5) {
        _qx.setFromAxisAngle(X, swing + run * 6 * DEG * mv * sw);
        mulFk(out, i === 0 ? FK.uArmL : FK.uArmR, _qx, null);
        const flex = (mixn(6, 58, run) + spr * 10) * DEG * mv * sw + Math.max(0, swing) * 0.5;
        _qx.setFromAxisAngle(X, flex);
        mulFk(out, i === 0 ? FK.fArmL : FK.fArmR, null, _qx);
        _qz.setFromAxisAngle(Z, side * run * 5 * DEG * mv * sw);
        mulFk(out, i === 0 ? FK.uArmL : FK.uArmR, _qz, null);
      } else {
        // IK-carried hands: ride the bob and a little fore-aft pump
        const k = i * 7;
        out.hand[k + 1] += bob * 0.5 * mv;
        out.hand[k + 2] += -Math.sin(swing) * 0.12 * sw;
      }
      // clavicles roll with the swing
      _qy.setFromAxisAngle(Y, side * -swing * 0.12);
      mulFk(out, i === 0 ? FK.clavL : FK.clavR, _qy, null);
    }
  }
}
