/**
 * Camera maths shared by the follow / cinematic / feel layers: pose blending, look-at orientation with roll,
 * critically damped smoothing and deterministic smooth noise. No allocations in any per-frame path.
 */
import * as THREE from 'three';
import type { EaseName, Vec3Like } from '@/core/api';
import { DEG, EASE, angleDelta, type EaseFn } from '@/core/mathx';

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

/** A resolved camera pose: where it is, how it is oriented, and its vertical FOV in degrees. */
export class Pose {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  fov = 62;

  copy(o: Pose): this {
    this.pos.copy(o.pos);
    this.quat.copy(o.quat);
    this.fov = o.fov;
    return this;
  }

  /** this = a → b at t (position lerp, orientation slerp, FOV lerp) */
  mix(a: Pose, b: Pose, t: number): this {
    this.pos.lerpVectors(a.pos, b.pos, t);
    this.quat.slerpQuaternions(a.quat, b.quat, t);
    this.fov = a.fov + (b.fov - a.fov) * t;
    return this;
  }
}

/** Engine convention: yaw 0 looks toward −Z, positive pitch looks up. Writes the unit view direction. */
export function viewDir(out: THREE.Vector3, yaw: number, pitch: number): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Orientation for a camera with the given view yaw / pitch (radians) and optional roll. */
export function quatFromYawPitch(out: THREE.Quaternion, yaw: number, pitch: number, roll = 0): THREE.Quaternion {
  return out.setFromEuler(tmpE.set(pitch, yaw, roll, 'YXZ'));
}

/** Orientation of a camera at `pos` looking at `look`, rolled by `rollDeg` about its view axis. */
export function quatLookAt(out: THREE.Quaternion, pos: Vec3Like, look: Vec3Like, rollDeg = 0): THREE.Quaternion {
  tmpM.lookAt(pos as THREE.Vector3, look as THREE.Vector3, UP);
  out.setFromRotationMatrix(tmpM);
  if (rollDeg !== 0) out.multiply(tmpQ.setFromAxisAngle(Z_AXIS, rollDeg * DEG));
  return out;
}

export const isFiniteVec = (p: Vec3Like | null | undefined): p is Vec3Like =>
  !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

const warnedEase = new Set<string>();
/** Easing by contract name; unknown names warn once and fall back to inOut. */
export function easeFn(name: EaseName | undefined): EaseFn {
  if (name === undefined) return EASE.inOut;
  const fn = EASE[name];
  if (fn) return fn;
  if (!warnedEase.has(name)) {
    warnedEase.add(name);
    console.warn(`[camera] unknown ease "${String(name)}" — using inOut`);
  }
  return EASE.inOut;
}

/** Critically damped follower (the classic SmoothDamp): reaches the target without overshoot. */
export class Damped {
  value: number;
  velocity = 0;

  constructor(value = 0) {
    this.value = value;
  }

  snap(v: number): void {
    this.value = v;
    this.velocity = 0;
  }

  /** Advance toward `target`; `smoothTime` ≈ time to cover most of the gap. */
  step(target: number, smoothTime: number, dt: number): number {
    if (!(dt > 0)) return this.value;
    const omega = 2 / Math.max(1e-4, smoothTime);
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - target;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * decay;
    let next = target + (change + temp) * decay;
    if (target - this.value > 0 === next > target) {
      next = target;
      this.velocity = 0;
    }
    this.value = next;
    return next;
  }

  /** Same, treating value/target as angles (takes the short way round). */
  stepAngle(target: number, smoothTime: number, dt: number): number {
    return this.step(this.value + angleDelta(this.value, target), smoothTime, dt);
  }
}

function hash(i: number, seed: number): number {
  let h = Math.imul(i ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

/**
 * Smooth deterministic 1-D noise in [−1, 1] (two octaves of quintic value noise).
 * `seed` selects an independent channel.
 */
export function noise1(t: number, seed: number): number {
  let sum = 0;
  let amp = 0.68;
  let f = t;
  for (let o = 0; o < 2; o++) {
    const i = Math.floor(f);
    const u = f - i;
    const s = u * u * u * (u * (u * 6 - 15) + 10);
    const a = hash(i, seed + o * 131);
    const b = hash(i + 1, seed + o * 131);
    sum += (a + (b - a) * s) * amp;
    amp *= 0.47;
    f = f * 2.03 + 17.3;
  }
  return sum;
}
