/**
 * Procedural locomotion: idle weight-shift → walk → run → sprint, any movement direction.
 *
 * The stride phase advances with distance travelled and stance feet travel backwards at exactly body speed, so
 * feet do not skate. Feet are IK targets (heel strike → flat → heel-off on the ball → swing arc); hips bob, sway,
 * yaw and roll around them; the torso counter-rotates; arms swing from whatever carry stance is active.
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
 * walk into a run with a flight phase.
 */
export function dutyFactor(s: number): number {
  if (s < 0.05) return 0.62;
  return Math.min(0.62, MAX_STANCE_TRAVEL / (s * cycleTime(s)));
}

/** distance a planted foot travels under the body during one stance */
export function stanceTravel(s: number): number {
  return s * dutyFactor(s) * cycleTime(s);
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

export class Locomotion {
  /** stride phase 0..1 (left heel strike at 0, right at 0.5) */
  phase = 0;
  /** smoothed speed (reference m/s) */
  speed = 0;
  /** smoothed movement direction relative to facing (rad, + = left) */
  moveYaw = 0;
  private targetSpeed = 0;
  private targetYaw = 0;
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

  setInput(speed: number, moveYaw: number, flags: Partial<LocoFlags> | undefined): void {
    this.targetSpeed = Math.max(0, Number.isFinite(speed) ? speed : 0);
    if (Number.isFinite(moveYaw)) this.targetYaw = moveYaw;
    this.flags.sprint = !!flags?.sprint; this.flags.aiming = !!flags?.aiming; this.flags.guarding = !!flags?.guarding; this.flags.injured = !!flags?.injured;
  }

  /** Snap smoothing state (after teleports / spawns). */
  snap(): void { this.speed = this.targetSpeed; this.moveYaw = this.targetYaw; this.accelLean = 0; this.turnLean = 0; }

  update(dt: number): void {
    const k = 1 - Math.exp(-12 * dt);
    const prev = this.speed;
    this.speed += (this.targetSpeed - this.speed) * k;
    if (this.targetSpeed > 0.05) {
      let d = this.targetYaw - this.moveYaw;
      d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
      this.moveYaw += d * (1 - Math.exp(-10 * dt));
    }
    const accel = dt > 1e-5 ? (this.speed - prev) / dt : 0;
    this.accelLean += (Math.max(-8, Math.min(10, accel * 0.9)) * DEG - this.accelLean) * (1 - Math.exp(-6 * dt));
    const a = 1 - Math.exp(-8 * dt);
    this.guardW += ((this.flags.guarding ? 1 : 0) - this.guardW) * a;
    this.aimW += ((this.flags.aiming ? 1 : 0) - this.aimW) * a;
    this.limpW += ((this.flags.injured ? 1 : 0) - this.limpW) * a;
    this.idleT += dt;
    if (this.speed > 0.05) {
      const T = cycleTime(this.speed) * (1 + this.limpW * 0.25);
      const before = this.phase;
      this.phase = (this.phase + dt / T) % 1;
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

    const d = dutyFactor(s);
    const travel = stanceTravel(s);
    // a walker's foot lands as far ahead as it leaves behind; a runner lands under the body and pushes off long
    const front = mixn(0.47, 0.37, run);
    const ph = this.phase;
    const my = this.moveYaw;
    // hips twist toward the travel direction when strafing; the chest untwists
    const hy = Math.sin(my) * 48 * DEG * mv;
    const dx = -Math.sin(my), dz = -Math.cos(my);
    const fwdness = Math.cos(my - hy);
    const width = (st.width ?? 0.105) + guard * 0.035 + (1 - mv) * 0.01;
    const chy = Math.cos(hy), shy = Math.sin(hy);

    // ---- feet -------------------------------------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      let p = (ph + (i === 0 ? 0 : 0.5)) % 1;
      let di = d;
      if (limp > 0 && i === 1) di = d * (1 - 0.28 * limp);
      // home under the hip, rotated with the hips twist
      const hxm = side * width * chy, hzm = -side * width * shy;
      let along: number, lift = 0, pitch: number, toeScale = 1;
      if (p < di) {
        const u = p / di;
        along = (front - u) * travel;
        const strike = mixn(15, 7, run) * (1 - ss(0, 0.24, u));
        const heelOff = -mixn(36, 50, run) * ss(0.52, 1, u);
        pitch = (strike + heelOff) * Math.max(0, fwdness);
      } else {
        const w = (p - di) / (1 - di);
        const e = w * w * (3 - 2 * w);
        along = (front - 1 + mixn(e, w, 0.35)) * travel;
        const H = mixn(0.075, 0.2, run) + spr * 0.07 - guard * 0.02;
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
      const k3 = i * 3;
      if (mv >= 0.999) {
        for (let c = 0; c < 7; c++) out.foot[i * 7 + c] = _foot[i * 7 + c];
        out.knee[k3] = kx; out.knee[k3 + 1] = 0.05; out.knee[k3 + 2] = kz;
        out.toe[i] = _toe[i];
      } else if (mv > 0) {
        const k = i * 7;
        for (let c = 0; c < 3; c++) out.foot[k + c] += (_foot[k + c] - out.foot[k + c]) * mv;
        _q.set(out.foot[k + 3], out.foot[k + 4], out.foot[k + 5], out.foot[k + 6]);
        _q2.set(_foot[k + 3], _foot[k + 4], _foot[k + 5], _foot[k + 6]);
        _q.slerp(_q2, mv);
        out.foot[k + 3] = _q.x; out.foot[k + 4] = _q.y; out.foot[k + 5] = _q.z; out.foot[k + 6] = _q.w;
        out.knee[k3] += (kx - out.knee[k3]) * mv; out.knee[k3 + 1] += (0.05 - out.knee[k3 + 1]) * mv; out.knee[k3 + 2] += (kz - out.knee[k3 + 2]) * mv;
        out.toe[i] += (_toe[i] - out.toe[i]) * mv;
      }
    }

    // ---- hips -------------------------------------------------------------------------------------------
    const c2 = Math.cos(TAU * 2 * (ph - d / 2));
    const c1 = Math.cos(TAU * (ph - d / 2));
    const c0 = Math.cos(TAU * ph);
    const quiet = 1 - aim * 0.45 - guard * 0.3;
    const bob = mixn(0.02 * c2, -0.04 * c2, run) * quiet;
    const crouch = (st.crouch ?? 0) + guard * 0.055 + aim * 0.02;
    out.hip[1] += (bob - (0.014 + 0.03 * run + 0.02 * spr)) * mv - crouch;
    const swayAmp = mixn(0.024, 0.01, run) * quiet;
    out.hip[0] += -swayAmp * c1 * mv * chy;
    out.hip[2] += -swayAmp * c1 * mv * -shy;
    // idle weight shift + breathing sink
    const idle = 1 - mv;
    const ws = Math.sin(this.idleT * 0.55) + 0.35 * Math.sin(this.idleT * 0.21 + 1.3);
    out.hip[0] += ws * 0.012 * idle;
    out.hip[1] += -Math.abs(ws) * 0.004 * idle;
    // limp: dip onto the good leg, hurry off the bad one
    const pr = (ph + 0.5) % 1;
    const badStance = pr < d * 0.72 ? Math.sin((Math.PI * pr) / (d * 0.72)) : 0;
    out.hip[1] -= limp * mv * (0.02 + 0.03 * badStance);

    const lean = ((2 + 6 * run + 5 * spr) * DEG * mv + this.accelLean * mv) * Math.max(0.3, fwdness) + guard * 3 * DEG;
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
