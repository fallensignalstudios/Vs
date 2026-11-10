/**
 * Humanoid rig: bone table, rest pose, skin-weight helpers and per-instance skeleton construction.
 *
 * The figure faces −Z (engine yaw 0), +X is its right. Every bone has identity rest rotation, so a bone's bind
 * matrix is a pure translation to its rest joint. Rest pose is a relaxed standing pose, arms hanging slightly
 * away from the body. All dimensions are authored for a REF_HEIGHT figure; archetype height is a uniform scale.
 */
import * as THREE from 'three';
import type { SkinFn, SkinOut } from './geo/builder';

export const REF_HEIGHT = 1.85;

export const BODY_BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'uArmL', 'fArmL', 'handL', 'fingAL', 'fingBL',
  'clavR', 'uArmR', 'fArmR', 'handR', 'fingAR', 'fingBR',
  'thighL', 'shinL', 'footL', 'toeL',
  'thighR', 'shinR', 'footR', 'toeR',
  'paulL', 'paulR',
  'weapon', 'gun', 'shield', 'prop', 'bladeA', 'bladeB',
] as const;
export type BoneName = (typeof BODY_BONES)[number];

const PARENTS: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', uArmL: 'clavL', fArmL: 'uArmL', handL: 'fArmL', fingAL: 'handL', fingBL: 'fingAL',
  clavR: 'chest', uArmR: 'clavR', fArmR: 'uArmR', handR: 'fArmR', fingAR: 'handR', fingBR: 'fingAR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', toeL: 'footL',
  thighR: 'hips', shinR: 'thighR', footR: 'shinR', toeR: 'footR',
  paulL: 'clavL', paulR: 'clavR',
  weapon: 'handR', gun: 'handR', shield: 'fArmL', prop: 'handL', bladeA: 'weapon', bladeB: 'weapon',
};

export interface Proportions {
  /** final standing height in metres */
  height: number;
  /** shoulder joint half-width at reference scale */
  shoulder: number;
  /** hip joint half-width at reference scale */
  hip: number;
  /** overall mass 0.8 (slight) .. 1.25 (heavy): scales limb and torso radii */
  bulk: number;
  /** feminine torso shaping 0..1 (narrower waist/shoulders, wider hip line) */
  fem: number;
}

export interface RigSpec {
  names: string[];
  parent: number[];
  /** model-space rest joint positions (xyz per bone) */
  rest: number[];
  index: Record<string, number>;
  prop: Proportions;
  /** uniform scale applied to the whole figure */
  scale: number;
}

/** Rest joint positions for the given proportions. */
export function buildRigSpec(prop: Proportions): RigSpec {
  const sw = prop.shoulder, hw = prop.hip;
  const J: Record<BoneName, [number, number, number]> = {
    root: [0, 0, 0],
    hips: [0, 0.99, 0],
    spine: [0, 1.11, 0.005],
    chest: [0, 1.29, 0.005],
    neck: [0, 1.535, 0.012],
    head: [0, 1.625, 0.0],
    clavL: [-0.03, 1.47, 0.0], uArmL: [-sw, 1.455, 0.0], fArmL: [-(sw + 0.03), 1.158, 0.012], handL: [-(sw + 0.045), 0.89, -0.012],
    fingAL: [-(sw + 0.047), 0.802, -0.016], fingBL: [-(sw + 0.047), 0.762, -0.016],
    clavR: [0.03, 1.47, 0.0], uArmR: [sw, 1.455, 0.0], fArmR: [sw + 0.03, 1.158, 0.012], handR: [sw + 0.045, 0.89, -0.012],
    fingAR: [sw + 0.047, 0.802, -0.016], fingBR: [sw + 0.047, 0.762, -0.016],
    thighL: [-hw, 0.945, 0.0], shinL: [-hw, 0.505, -0.012], footL: [-hw, 0.085, 0.018], toeL: [-hw, 0.03, -0.125],
    thighR: [hw, 0.945, 0.0], shinR: [hw, 0.505, -0.012], footR: [hw, 0.085, 0.018], toeR: [hw, 0.03, -0.125],
    paulL: [-sw, 1.455, 0.0], paulR: [sw, 1.455, 0.0],
    weapon: [sw + 0.024, 0.812, -0.03], gun: [sw + 0.024, 0.812, -0.03], shield: [-(sw + 0.04), 1.02, 0.0], prop: [-(sw + 0.024), 0.812, -0.03],
    bladeA: [sw + 0.024, 0.812, -0.03], bladeB: [sw + 0.024, 0.812, -0.03],
  };
  const names = [...BODY_BONES] as string[];
  const index: Record<string, number> = {};
  names.forEach((n, i) => (index[n] = i));
  const parent = BODY_BONES.map((n) => (PARENTS[n] ? index[PARENTS[n] as string] : -1));
  const rest: number[] = [];
  for (const n of BODY_BONES) rest.push(...J[n]);
  return { names, parent, rest, index, prop, scale: prop.height / REF_HEIGHT };
}

/** Append an extra bone (cloth particle, accessory) parented to `parentName`; returns its index. */
export function addBone(spec: RigSpec, name: string, parentName: string, x: number, y: number, z: number): number {
  const i = spec.names.length;
  spec.names.push(name);
  spec.parent.push(spec.index[parentName] ?? 0);
  spec.rest.push(x, y, z);
  spec.index[name] = i;
  return i;
}

/** Helper view over a RigSpec used by the part builders. */
export class RigView {
  constructor(readonly spec: RigSpec) {}
  /** bone index */
  i(name: string): number {
    const k = this.spec.index[name];
    return k === undefined ? 0 : k;
  }
  /** side-suffixed bone index: side −1 = L, +1 = R */
  si(base: string, side: number): number { return this.i(base + (side < 0 ? 'L' : 'R')); }
  x(name: string): number { return this.spec.rest[this.i(name) * 3]; }
  y(name: string): number { return this.spec.rest[this.i(name) * 3 + 1]; }
  z(name: string): number { return this.spec.rest[this.i(name) * 3 + 2]; }
  p(name: string): [number, number, number] { const k = this.i(name) * 3; return [this.spec.rest[k], this.spec.rest[k + 1], this.spec.rest[k + 2]]; }
  sp(base: string, side: number): [number, number, number] { return this.p(base + (side < 0 ? 'L' : 'R')); }
  get prop(): Proportions { return this.spec.prop; }
}

const ss = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Weight slides from bone A (at y ≥ yA) to bone B (at y ≤ yB) — or the reverse if yB > yA. */
export function blendY(a: number, b: number, yA: number, yB: number): SkinFn {
  return (_x, y, _z, o) => {
    const t = ss(yA, yB, y);
    o.i0 = a; o.w0 = 1 - t; o.i1 = b; o.w1 = t;
  };
}

/** Three-bone chain along Y: A above y1, B between, C below y2 (with soft bands of ±band). */
export function chainY(a: number, b: number, c: number, y1: number, y2: number, band1: number, band2 = band1): SkinFn {
  return (_x, y, _z, o) => {
    const t1 = ss(y1 + band1, y1 - band1, y);
    const t2 = ss(y2 + band2, y2 - band2, y);
    o.i0 = a; o.w0 = 1 - t1; o.i1 = b; o.w1 = t1 * (1 - t2); o.i2 = c; o.w2 = t1 * t2;
  };
}

/** Weight slides along Z (feet → toes). */
export function blendZ(a: number, b: number, zA: number, zB: number): SkinFn {
  return (_x, _y, z, o) => {
    const t = ss(zA, zB, z);
    o.i0 = a; o.w0 = 1 - t; o.i1 = b; o.w1 = t;
  };
}

/** Compose: run `inner`, then scale it by (1−t) and give t to `bone`, where t = fn(x,y,z). */
export function mixSkin(inner: SkinFn, bone: number, tf: (x: number, y: number, z: number) => number): SkinFn {
  return (x, y, z, o: SkinOut) => {
    inner(x, y, z, o);
    const t = Math.min(1, Math.max(0, tf(x, y, z)));
    o.w0 *= 1 - t; o.w1 *= 1 - t; o.w2 *= 1 - t;
    o.i3 = bone; o.w3 = t;
  };
}

export { ss as smooth01 };

/** Live skeleton for one figure instance. */
export interface RigInstance {
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  byName: Record<string, THREE.Bone>;
}

const invCache = new WeakMap<RigSpec, THREE.Matrix4[]>();

export function instantiateRig(spec: RigSpec): RigInstance {
  const bones: THREE.Bone[] = [];
  const byName: Record<string, THREE.Bone> = {};
  for (let i = 0; i < spec.names.length; i++) {
    const bone = new THREE.Bone();
    bone.name = spec.names[i];
    const p = spec.parent[i];
    const x = spec.rest[i * 3], y = spec.rest[i * 3 + 1], z = spec.rest[i * 3 + 2];
    if (p >= 0) {
      bone.position.set(x - spec.rest[p * 3], y - spec.rest[p * 3 + 1], z - spec.rest[p * 3 + 2]);
      bones[p].add(bone);
    } else bone.position.set(x, y, z);
    bones.push(bone);
    byName[bone.name] = bone;
  }
  let inv = invCache.get(spec);
  if (!inv || inv.length !== bones.length) {
    inv = [];
    for (let i = 0; i < spec.names.length; i++) inv.push(new THREE.Matrix4().makeTranslation(-spec.rest[i * 3], -spec.rest[i * 3 + 1], -spec.rest[i * 3 + 2]));
    invCache.set(spec, inv);
  }
  const skeleton = new THREE.Skeleton(bones, inv.map((m) => m.clone()));
  return { bones, skeleton, byName };
}
