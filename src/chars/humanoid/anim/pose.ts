/**
 * Pose — the blendable description of a humanoid body configuration.
 *
 * Torso and (optionally) arms are FK local quaternions; legs are always IK (ankle targets in model space, so
 * feet stay planted through any blend); arms can be IK with palm targets in model space. Everything is stored
 * in flat Float32Arrays so blending allocates nothing.
 *
 * Model space: figure faces −Z, +X is its right, units = reference-scale metres (see rig.ts).
 */

/** FK quaternion channel indices. */
export const FK = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  clavL: 5, clavR: 6,
  uArmL: 7, fArmL: 8, handL: 9,
  uArmR: 10, fArmR: 11, handR: 12,
} as const;
export const FK_COUNT = 13;

/** channels below this index (hips) belong to the lower body mask */
const UPPER_START = FK.spine;

export class Pose {
  /** FK local quaternions (xyzw × FK_COUNT) */
  readonly q = new Float32Array(FK_COUNT * 4);
  /** hips offset from rest (model units) */
  readonly hip = new Float32Array(3);
  /** per hand [L,R]: palm target position (3) + hand orientation quaternion (4), model space */
  readonly hand = new Float32Array(14);
  /** per arm elbow pole direction (model space) */
  readonly elbow = new Float32Array(6);
  /** per arm IK weight (0 = FK) */
  readonly armIk = new Float32Array(2);
  /** per hand: how much the target rides additive chest motion (aim pitch, hit reactions) */
  readonly follow = new Float32Array(2);
  /** per foot [L,R]: ankle position (3) + foot orientation quaternion (4), model space */
  readonly foot = new Float32Array(14);
  /** per leg knee pole direction (model space) */
  readonly knee = new Float32Array(6);
  /** per foot toe bend (radians, positive = toes up relative to the foot) */
  readonly toe = new Float32Array(2);
  /** per hand finger curl request 0 (flat) .. 1 (fist); hands holding equipment always close */
  readonly fist = new Float32Array(2);
  /** two-handed weapon: left hand rides the weapon's secondary grip (0..1) */
  grip = 0;

  constructor() { this.identity(); }

  identity(): this {
    this.q.fill(0);
    for (let i = 0; i < FK_COUNT; i++) this.q[i * 4 + 3] = 1;
    this.hip.fill(0);
    this.hand.fill(0); this.hand[6] = 1; this.hand[13] = 1;
    this.elbow.fill(0);
    this.armIk.fill(0);
    this.follow.fill(0);
    this.foot.fill(0); this.foot[6] = 1; this.foot[13] = 1;
    this.knee.fill(0);
    this.toe.fill(0);
    this.fist[0] = 0.3; this.fist[1] = 0.3;
    this.grip = 0;
    return this;
  }

  copy(o: Pose): this {
    this.q.set(o.q); this.hip.set(o.hip); this.hand.set(o.hand); this.elbow.set(o.elbow); this.armIk.set(o.armIk);
    this.follow.set(o.follow); this.foot.set(o.foot); this.knee.set(o.knee); this.toe.set(o.toe); this.fist.set(o.fist);
    this.grip = o.grip;
    return this;
  }

  clone(): Pose { return new Pose().copy(this); }

  /**
   * Blend toward `o`: upper-body channels by `wu`, lower-body channels (hips, legs) by `wl`.
   * Quaternions use shortest-path nlerp.
   */
  mix(o: Pose, wu: number, wl: number = wu): this {
    if (wl > 0) {
      nlerpN(this.q, o.q, 0, UPPER_START, wl);
      lerpN(this.hip, o.hip, wl);
      for (let s = 0; s < 2; s++) {
        const k = s * 7;
        for (let i = 0; i < 3; i++) this.foot[k + i] += (o.foot[k + i] - this.foot[k + i]) * wl;
        nlerp4(this.foot, o.foot, k + 3, wl);
      }
      lerpN(this.knee, o.knee, wl);
      lerpN(this.toe, o.toe, wl);
    }
    if (wu > 0) {
      nlerpN(this.q, o.q, UPPER_START, FK_COUNT, wu);
      for (let s = 0; s < 2; s++) {
        const k = s * 7;
        // an FK arm has no meaningful target: adopt the other pose's target outright instead of sweeping through it
        if (this.armIk[s] < 1e-3 && o.armIk[s] > 0) {
          for (let i = 0; i < 7; i++) this.hand[k + i] = o.hand[k + i];
          for (let i = 0; i < 3; i++) this.elbow[s * 3 + i] = o.elbow[s * 3 + i];
          this.follow[s] = o.follow[s];
        } else if (o.armIk[s] > 1e-3) {
          for (let i = 0; i < 3; i++) this.hand[k + i] += (o.hand[k + i] - this.hand[k + i]) * wu;
          nlerp4(this.hand, o.hand, k + 3, wu);
          for (let i = 0; i < 3; i++) this.elbow[s * 3 + i] += (o.elbow[s * 3 + i] - this.elbow[s * 3 + i]) * wu;
          this.follow[s] += (o.follow[s] - this.follow[s]) * wu;
        }
      }
      lerpN(this.armIk, o.armIk, wu);
      lerpN(this.fist, o.fist, wu);
      this.grip += (o.grip - this.grip) * wu;
    }
    return this;
  }
}

function lerpN(a: Float32Array, b: Float32Array, w: number): void {
  for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * w;
}

function nlerp4(a: Float32Array, b: Float32Array, k: number, w: number): void {
  let bx = b[k], by = b[k + 1], bz = b[k + 2], bw = b[k + 3];
  if (a[k] * bx + a[k + 1] * by + a[k + 2] * bz + a[k + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const x = a[k] + (bx - a[k]) * w, y = a[k + 1] + (by - a[k + 1]) * w, z = a[k + 2] + (bz - a[k + 2]) * w, ww = a[k + 3] + (bw - a[k + 3]) * w;
  const l = Math.hypot(x, y, z, ww) || 1;
  a[k] = x / l; a[k + 1] = y / l; a[k + 2] = z / l; a[k + 3] = ww / l;
}

function nlerpN(a: Float32Array, b: Float32Array, from: number, to: number, w: number): void {
  for (let i = from; i < to; i++) nlerp4(a, b, i * 4, w);
}

export { nlerp4 };
