/**
 * Procedural animation helpers: keyframe curves, impact envelopes, a two-bone IK limb and a cyclic gait.
 * Pure math + THREE.Bone posing; no allocation in the per-frame paths. Key tables passed to `keys` must be
 * module constants (an array literal at the call site would allocate every frame).
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

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** cheap deterministic 1D value noise in [-1, 1] (idle drift, twitches) */
export function noise1(x: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i);
  return a + (hash1(i + 1) - a) * u;
}

/** true when every component of a vector-like value is a finite number (guards every world-target setter) */
export function finite3(v: { x: number; y: number; z: number } | null | undefined): v is { x: number; y: number; z: number } {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
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

// ---------------------------------------------------------------------------------------------------------
// aiming + ground helpers (model space)
// ---------------------------------------------------------------------------------------------------------

const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4();

function frame(out: THREE.Matrix4, dir: THREE.Vector3, hint: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3): THREE.Matrix4 {
  x.copy(dir).normalize();
  y.copy(hint).addScaledVector(x, -hint.dot(x));
  if (y.lengthSq() < 1e-8) {
    y.set(0, 1, 0).addScaledVector(x, -x.y);
    if (y.lengthSq() < 1e-8) y.set(1, 0, 0);
  }
  y.normalize();
  z.crossVectors(x, y);
  return out.makeBasis(x, y, z);
}

/**
 * Rotation that carries the frame (restDir, restHint) onto (dir, hint): the segment points along `dir` and its
 * bend plane follows `hint`, so there is no free twist. All vectors in one space; none need to be normalised.
 */
export function aimQuat(out: THREE.Quaternion, restDir: THREE.Vector3, restHint: THREE.Vector3, dir: THREE.Vector3, hint: THREE.Vector3): THREE.Quaternion {
  frame(_ma, restDir, restHint, _ax, _ay, _az).transpose();
  frame(_mb, dir, hint, _bx, _by, _bz).multiply(_ma);
  return out.setFromRotationMatrix(_mb);
}

/**
 * Keeps a planted foot where it is in the WORLD while the root yaws in place, and re-plants it with a short
 * step once it has been dragged too far — so a creature tracking a target shuffles round instead of spinning
 * like a turntable. `phi` is the yaw (about the root's Y axis) to apply to the foot's model-space target.
 */
export class PlantYaw {
  phi = 0;
  /** 0..1 while the foot is in the air on a turn step, −1 while planted */
  step = -1;
  /** 0..1 lift envelope of the current step */
  lift = 0;
  /** true only on the update in which a turn step lands */
  landed = false;
  private from = 0;
  private to = 0;

  get stepping(): boolean {
    return this.step >= 0;
  }

  /**
   * @param dyaw     root yaw change this frame (radians)
   * @param dt       seconds
   * @param mayStep  false while another foot of the same group is stepping
   * @param release  0..1 — how strongly the gait is re-planting feet anyway (the offset bleeds away)
   * @param limit    drift (radians) that triggers a step
   * @param seconds  step duration
   */
  update(dyaw: number, dt: number, mayStep: boolean, release: number, limit: number, seconds: number): void {
    this.landed = false;
    if (this.step >= 0) {
      this.step += dt / Math.max(0.05, seconds);
      if (this.step >= 1) {
        this.step = -1; this.phi = this.to; this.lift = 0; this.landed = true;
      } else {
        const s = this.step, e = s * s * (3 - 2 * s);
        this.phi = this.from + (this.to - this.from) * e;
        this.lift = Math.sin(Math.PI * s);
      }
      return;
    }
    this.phi -= dyaw;
    if (release > 0) this.phi *= Math.exp(-10 * release * dt);
    if (!Number.isFinite(this.phi)) this.phi = 0;
    if (mayStep && Math.abs(this.phi) > limit) {
      this.step = 0; this.from = this.phi;
      // land a little ahead of the turn so a continuous turn alternates feet instead of stuttering
      this.to = clamp(dt > 1e-5 ? (dyaw / dt) * 0.12 : 0, -0.25, 0.25);
    }
  }

  reset(): void {
    this.phi = 0; this.step = -1; this.lift = 0; this.landed = false;
  }

  /** rotate a model-space point about the root's Y axis by phi (in place) */
  apply(v: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.phi), s = Math.sin(this.phi);
    const x = v.x * c + v.z * s, z = -v.x * s + v.z * c;
    v.x = x; v.z = z;
    return v;
  }
}

/** a point carried by a bone that must stay above the floor (model-space y ≥ radius) */
export interface GroundProbe {
  bone: THREE.Object3D;
  /** offset in the bone's own frame (= model axes at bind) */
  x: number; y: number; z: number;
  /** clearance kept between the point and the floor */
  r: number;
}

/** build a probe from a model-space bind point carried by `bone` (whose bind position is `at`) */
export function probe(bone: THREE.Object3D, at: readonly [number, number, number], point: readonly [number, number, number], r: number): GroundProbe {
  return { bone, x: point[0] - at[0], y: point[1] - at[1], z: point[2] - at[2], r };
}

const _pv = new THREE.Vector3();

/**
 * How far the lowest probe sits below the floor (model-space metres, ≥ 0). `toModel` is the inverse of the
 * rig group's world matrix; the probes' bones must have up-to-date world matrices.
 */
export function groundDeficit(probes: readonly GroundProbe[], toModel: THREE.Matrix4, floor = 0): number {
  let d = 0;
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i]!;
    _pv.set(p.x, p.y, p.z).applyMatrix4(p.bone.matrixWorld).applyMatrix4(toModel);
    const below = floor + p.r - _pv.y;
    if (below > d) d = below;
  }
  return d;
}

/** model-space position of one probe (after its bone's world matrix is current) */
export function probeModel(p: GroundProbe, toModel: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
  return out.set(p.x, p.y, p.z).applyMatrix4(p.bone.matrixWorld).applyMatrix4(toModel);
}
