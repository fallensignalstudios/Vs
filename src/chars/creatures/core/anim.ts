/**
 * Procedural animation helpers: keyframe curves, impact envelopes, a two-bone IK limb and a cyclic gait.
 * Pure math + THREE.Bone posing; no allocation in the per-frame paths.
 */
import * as THREE from 'three';
import { clamp, clamp01, smoothstep } from '@/core/mathx';

/**
 * Piecewise curve through flat `[t0, v0, t1, v1, …]` keys with smoothstep easing between keys.
 * Clamps to the first/last value outside the key range.
 */
export function keys(t: number, k: readonly number[]): number {
  const n = k.length;
  if (n < 2) return 0;
  if (t <= k[0]!) return k[1]!;
  for (let i = 2; i < n; i += 2) {
    const t1 = k[i]!;
    if (t <= t1) {
      const t0 = k[i - 2]!;
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      const s = f * f * (3 - 2 * f);
      return k[i - 1]! + (k[i + 1]! - k[i - 1]!) * s;
    }
  }
  return k[n - 1]!;
}

/** 0 → 1 over [a, b], hold, 1 → 0 over [c, d] (smooth). */
export function win(t: number, a: number, b: number, c: number, d: number): number {
  return smoothstep(a, b, t) * (1 - smoothstep(c, d, t));
}

/** accelerating 0 → 1 over [a, b] (the swing INTO a strike) */
export function whip(t: number, a: number, b: number): number {
  const f = clamp01((t - a) / Math.max(1e-6, b - a));
  return f * f * f;
}

/** decelerating 0 → 1 over [a, b] (snap out, settle) */
export function snap(t: number, a: number, b: number): number {
  const f = 1 - clamp01((t - a) / Math.max(1e-6, b - a));
  return 1 - f * f * f;
}

/** impact envelope: 0 before t0, jumps to 1 and decays exponentially; `ring` adds a damped oscillation */
export function impact(t: number, t0: number, decay: number, ring = 0): number {
  if (t < t0) return 0;
  const x = t - t0;
  const e = Math.exp(-x / Math.max(1e-4, decay));
  return ring > 0 ? e * Math.cos(x * ring) : e;
}

/** cheap deterministic 1D value noise in [-1, 1] (idle drift, twitches) */
export function noise1(x: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const h = (n: number): number => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  return h(i) + (h(i + 1) - h(i)) * u;
}

/** additive euler rotation scaled by a weight */
export function rot(b: THREE.Object3D, x: number, y: number, z: number, w = 1): void {
  b.rotation.x += x * w;
  b.rotation.y += y * w;
  b.rotation.z += z * w;
}

/** additive translation scaled by a weight */
export function move(b: THREE.Object3D, x: number, y: number, z: number, w = 1): void {
  b.position.x += x * w;
  b.position.y += y * w;
  b.position.z += z * w;
}

// ---------------------------------------------------------------------------------------------------------
// two-bone IK
// ---------------------------------------------------------------------------------------------------------

const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _root = new THREE.Vector3(), _knee = new THREE.Vector3(), _dir = new THREE.Vector3(), _pole = new THREE.Vector3();
const _qp = new THREE.Quaternion(), _qu = new THREE.Quaternion(), _ql = new THREE.Quaternion(), _q = new THREE.Quaternion();

/** rotation matrix whose X column is axis `a` and Y column is `pole` orthogonalised against it */
function basis(out: THREE.Matrix4, a: THREE.Vector3, pole: THREE.Vector3): THREE.Matrix4 {
  _b.copy(pole).addScaledVector(a, -pole.dot(a));
  if (_b.lengthSq() < 1e-8) {
    _b.set(0, 1, 0).addScaledVector(a, -a.y);
    if (_b.lengthSq() < 1e-8) _b.set(1, 0, 0);
  }
  _b.normalize();
  _c.crossVectors(a, _b);
  return out.makeBasis(a, _b, _c);
}

/**
 * Solve the knee/elbow position of a two-segment limb. All vectors in one space.
 * Returns `out` = joint position. The target is clamped to the reachable shell.
 */
export function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  _dir.subVectors(target, root);
  let d = _dir.length();
  if (d < 1e-6) { _dir.set(0, -1, 0); d = 1e-6; } else _dir.multiplyScalar(1 / d);
  const dc = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const cos = clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  _pole.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_pole.lengthSq() < 1e-8) {
    _pole.set(0, 0, -1).addScaledVector(_dir, _dir.z);
    if (_pole.lengthSq() < 1e-8) _pole.set(1, 0, 0);
  }
  _pole.normalize();
  return out.copy(root).addScaledVector(_dir, l1 * cos).addScaledVector(_pole, l1 * sin);
}

/**
 * A two-bone limb (hip→knee→foot or shoulder→elbow→hand) posed by IK in MODEL space (the space of `space`,
 * normally the rig group). Bones must have identity rest rotation (RigBuilder guarantees it).
 */
export class Limb2 {
  readonly l1: number;
  readonly l2: number;
  private readonly axisU = new THREE.Vector3();
  private readonly axisL = new THREE.Vector3();
  private readonly poleRest = new THREE.Vector3();
  private readonly restU = new THREE.Matrix4();
  private readonly restL = new THREE.Matrix4();
  /** model-space end position at bind */
  readonly restEnd = new THREE.Vector3();
  /** last solved joint + end (model space), for attaching things / debugging */
  readonly joint = new THREE.Vector3();
  readonly end = new THREE.Vector3();

  /**
   * @param upperAt/lowerAt/endAt  model-space bind positions of the three joints
   * @param pole                   model-space bend direction hint (where the knee/elbow points)
   */
  constructor(private readonly space: THREE.Object3D, private readonly upper: THREE.Bone, private readonly lower: THREE.Bone,
    upperAt: THREE.Vector3, lowerAt: THREE.Vector3, endAt: THREE.Vector3, pole: THREE.Vector3) {
    this.axisU.subVectors(lowerAt, upperAt);
    this.l1 = this.axisU.length();
    this.axisU.normalize();
    this.axisL.subVectors(endAt, lowerAt);
    this.l2 = this.axisL.length();
    this.axisL.normalize();
    this.poleRest.copy(pole).normalize();
    basis(this.restU, this.axisU, this.poleRest).transpose();
    basis(this.restL, this.axisL, this.poleRest).transpose();
    this.restEnd.copy(endAt);
  }

  /**
   * Pose the limb so its end reaches `target` (model space), bending toward `pole` (model space).
   * The upper bone's ancestors must already be posed for this frame. `weight` < 1 blends from the bones'
   * current (FK) rotation toward the IK solution.
   */
  solve(target: THREE.Vector3, pole: THREE.Vector3, weight = 1): void {
    const parent = this.upper.parent;
    if (!parent || weight <= 0) return;
    parent.updateWorldMatrix(true, false);
    _mi.copy(this.space.matrixWorld).invert();
    _m.multiplyMatrices(_mi, parent.matrixWorld); // parent in model space
    _root.copy(this.upper.position).applyMatrix4(_m);
    _qp.setFromRotationMatrix(_m);
    solveTwoBone(_root, target, this.l1, this.l2, pole, _knee);
    // upper
    _a.subVectors(_knee, _root).normalize();
    basis(_m0, _a, pole).multiply(this.restU);
    _qu.setFromRotationMatrix(_m0);
    _q.copy(_qp).invert().multiply(_qu);
    if (weight >= 1) this.upper.quaternion.copy(_q);
    else this.upper.quaternion.slerp(_q, weight);
    // lower (reaches toward the clamped target)
    _a.subVectors(target, _knee);
    if (_a.lengthSq() < 1e-10) _a.copy(this.axisL);
    _a.normalize();
    basis(_m1, _a, pole).multiply(this.restL);
    _ql.setFromRotationMatrix(_m1);
    _q.copy(_qu).invert().multiply(_ql);
    if (weight >= 1) {
      this.lower.quaternion.copy(_q);
      this.joint.copy(_knee);
      this.end.copy(_knee).addScaledVector(_a, this.l2);
    } else this.lower.quaternion.slerp(_q, weight);
  }

  /** model-space orientation of the lower bone after solve() (to counter-rotate feet) */
  lowerQuat(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(_ql);
  }
}

// ---------------------------------------------------------------------------------------------------------
// gait
// ---------------------------------------------------------------------------------------------------------

export interface GaitOut {
  /** offset along the travel direction (metres, + = ahead) */
  along: number;
  /** foot lift (metres) */
  lift: number;
  /** 1 while planted, 0 in the air */
  planted: number;
}

/**
 * Sample a cyclic foot path. `phase` 0..1; the foot is planted for `duty` of the cycle travelling from
 * +stride/2 to −stride/2 (so it does not slide when the phase advances at speed·duty/stride), then swings.
 */
export function gaitFoot(phase: number, stride: number, lift: number, duty: number, out: GaitOut): GaitOut {
  const p = phase - Math.floor(phase);
  if (p < duty) {
    out.along = stride * (0.5 - p / duty);
    out.lift = 0;
    out.planted = 1;
  } else {
    const s = (p - duty) / (1 - duty);
    const e = s * s * (3 - 2 * s);
    out.along = stride * (-0.5 + e);
    out.lift = lift * Math.sin(Math.PI * s) * (0.75 + 0.25 * Math.sin(Math.PI * s));
    out.planted = 0;
  }
  return out;
}

/** phase advance per second for a no-slide gait */
export function gaitRate(speed: number, stride: number, duty: number): number {
  return stride > 1e-5 ? (speed * duty) / stride : 0;
}
