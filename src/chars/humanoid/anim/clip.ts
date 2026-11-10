/**
 * Clip authoring + sampling.
 *
 * Actions are authored as a handful of keyed PoseSpecs in friendly units (degrees; positions as
 * [right, up, forward] metres at reference scale). Each key inherits everything it does not mention from the
 * previous key (the first from the clip's base stance), so a swing reads as "wind-up, hit, follow-through".
 * Hand targets are interpolated on arcs around the shoulder line in chest space, so two keys already give a
 * sweeping weapon path; they are converted to model space after interpolation.
 */
import * as THREE from 'three';
import { EASE, type EaseFn } from '@/core/mathx';
import { FK, Pose } from './pose';
import { alignPair } from './ik';

export type V3 = readonly [number, number, number];

export interface ArmSpec {
  /** IK palm target [right, up, fwd] (chest space unless the clip says root) */
  p?: V3;
  /** weapon axis + cutting-edge direction (melee grip) */
  blade?: V3;
  edge?: V3;
  /** open hand: finger direction + palm normal */
  fingers?: V3;
  palm?: V3;
  /** firearm: barrel direction + sight-up direction */
  barrel?: V3;
  up?: V3;
  /** elbow pole [right, up, fwd] (same space as p) */
  pole?: V3;
  /** FK: shoulder [swing fwd, abduct, twist-in] degrees */
  sh?: V3;
  /** FK: elbow flexion degrees */
  el?: number;
  /** FK: wrist [flex, deviate, twist] degrees */
  wr?: V3;
  /** finger curl 0 flat .. 1 fist */
  fist?: number;
  /** force FK (drop an inherited IK target) */
  fk?: boolean;
}

export interface LegSpec {
  /** foot contact [right(absolute x), lift above ground, fwd] */
  p?: V3;
  /** toe-up positive (heel plant); negative lifts the heel and keeps the ball planted */
  pitch?: number;
  /** toe-out positive */
  yaw?: number;
  roll?: number;
  /** knee pole [right, up, fwd]; default follows the foot's heading */
  knee?: V3;
  /** foot in the air: do not pivot on ball/heel, do not bend toes */
  air?: boolean;
}

export interface PoseSpec {
  /** hips offset [right, up, fwd] */
  hips?: V3;
  /** hips rotation [pitch fwd, yaw left, roll right] degrees */
  hipsR?: V3;
  /** [bend fwd, twist left, lean right] degrees */
  spine?: V3;
  chest?: V3;
  neck?: V3;
  head?: V3;
  /** [shrug up, forward] degrees */
  clavL?: readonly [number, number];
  clavR?: readonly [number, number];
  armL?: ArmSpec;
  armR?: ArmSpec;
  legL?: LegSpec;
  legR?: LegSpec;
  /** two-handed grip weight */
  grip?: number;
}

export interface KeySpec extends PoseSpec {
  /** time as a fraction of the clip (0..1) */
  t: number;
  /** easing INTO this key from the previous one */
  ease?: keyof typeof EASE | EaseFn;
}

export interface ClipSpec {
  duration: number;
  loop?: boolean;
  /** default mask when the caller does not say (true = legs keep locomotion) */
  upperOnly?: boolean;
  /** base stance the first key inherits from */
  base?: PoseSpec;
  /** hand target space per hand (default chest) */
  space?: { L?: 'chest' | 'root'; R?: 'chest' | 'root' };
  keys: KeySpec[];
  /** [fraction, name] */
  events?: Array<readonly [number, string]>;
  /** blend-out seconds when a one-shot ends (default 0.18) */
  fadeOut?: number;
  /** default blend-in seconds (default 0.12) */
  fadeIn?: number;
  /** hold the last key instead of blending out (poses entered by a transition, e.g. death) */
  hold?: boolean;
}

export interface Clip {
  name: string;
  duration: number;
  loop: boolean;
  upperOnly: boolean;
  hold: boolean;
  fadeIn: number;
  fadeOut: number;
  times: number[];
  eases: EaseFn[];
  poses: Pose[];
  rootSpace: [boolean, boolean];
  events: Array<{ t: number; name: string }>;
  hitTimes: number[];
}

// ---- reference torso geometry (identical for every archetype; see rig.ts) ------------------------------------
const HIPS_Y = 0.99;
const SPINE_OFF = new THREE.Vector3(0, 0.12, 0.005);
const CHEST_OFF = new THREE.Vector3(0, 0.18, 0);
/** arc pivot in chest space (middle of the shoulder line) */
const PIVOT = new THREE.Vector3(0, 0.15, 0);
/** rest ankle height / ankle→ball / ankle→heel offsets */
export const ANKLE_Y = 0.085;
const BALL = new THREE.Vector3(0, -0.055, -0.143);
const HEEL = new THREE.Vector3(0, -0.085, 0.06);

const DEG = Math.PI / 180;
const _e = new THREE.Euler();
const _qx = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qz = new THREE.Quaternion(), _q = new THREE.Quaternion();
const _a0 = new THREE.Vector3(), _b0 = new THREE.Vector3(), _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _cp = new THREE.Vector3();
const _cq = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _sq = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** [bend fwd, twist left, lean right] → quaternion (Y · X · Z). */
function torsoQuat(v: V3, out: THREE.Quaternion): THREE.Quaternion {
  _qy.setFromAxisAngle(Y, v[1] * DEG);
  _qx.setFromAxisAngle(X, -v[0] * DEG);
  _qz.setFromAxisAngle(Z, -v[2] * DEG);
  return out.copy(_qy).multiply(_qx).multiply(_qz);
}

/** Foot placement from a ground contact: returns ankle position + rotation + toe bend. */
export function footFromContact(
  side: number, x: number, lift: number, fwd: number, pitchDeg: number, yawDeg: number, rollDeg: number, air: boolean,
  outPos: Float32Array, outQuat: Float32Array, k: number, toe: Float32Array, toeIdx: number,
): void {
  _qy.setFromAxisAngle(Y, -side * yawDeg * DEG);
  _qx.setFromAxisAngle(X, pitchDeg * DEG);
  _qz.setFromAxisAngle(Z, -side * rollDeg * DEG);
  _q.copy(_qy).multiply(_qx).multiply(_qz);
  let ax = x, ay = ANKLE_Y + lift, az = -fwd;
  let toeBend = 0;
  if (!air && pitchDeg < 0) {
    // heel raised: pivot about the ball of the foot, toes stay flat
    _v.copy(BALL).applyQuaternion(_qy);
    _v2.copy(BALL).applyQuaternion(_q);
    ax += _v.x - _v2.x; ay += _v.y - _v2.y; az += _v.z - _v2.z;
    toeBend = -pitchDeg * DEG;
  } else if (!air && pitchDeg > 0) {
    _v.copy(HEEL).applyQuaternion(_qy);
    _v2.copy(HEEL).applyQuaternion(_q);
    ax += _v.x - _v2.x; ay += _v.y - _v2.y; az += _v.z - _v2.z;
  }
  outPos[k] = ax; outPos[k + 1] = ay; outPos[k + 2] = az;
  outQuat[k + 3] = _q.x; outQuat[k + 4] = _q.y; outQuat[k + 5] = _q.z; outQuat[k + 6] = _q.w;
  toe[toeIdx] = toeBend;
}

interface Resolved {
  hips: V3; hipsR: V3; spine: V3; chest: V3; neck: V3; head: V3; clavL: readonly [number, number]; clavR: readonly [number, number];
  armL: ArmSpec; armR: ArmSpec; legL: LegSpec; legR: LegSpec; grip: number;
}

const Z3: V3 = [0, 0, 0];
function defaults(): Resolved {
  return {
    hips: Z3, hipsR: Z3, spine: Z3, chest: Z3, neck: Z3, head: Z3, clavL: [0, 0], clavR: [0, 0],
    armL: { sh: [2, 6, 0], el: 14, wr: [0, 0, 0], fist: 0.3 },
    armR: { sh: [2, 6, 0], el: 14, wr: [0, 0, 0], fist: 0.3 },
    legL: { p: [-0.115, 0, 0.0], pitch: 0, yaw: 8, roll: 0 },
    legR: { p: [0.115, 0, 0.0], pitch: 0, yaw: 8, roll: 0 },
    grip: 0,
  };
}

function mergeArm(base: ArmSpec, s: ArmSpec | undefined): ArmSpec {
  if (!s) return base;
  const out: ArmSpec = { ...base, ...s };
  // choosing one orientation style drops the others
  if (s.blade || s.edge) { delete out.fingers; delete out.palm; delete out.barrel; delete out.up; if (!out.blade) out.blade = [0, 0, 1]; }
  else if (s.fingers || s.palm) { delete out.blade; delete out.edge; delete out.barrel; delete out.up; }
  else if (s.barrel || s.up) { delete out.blade; delete out.edge; delete out.fingers; delete out.palm; }
  if (s.fk || (s.sh && !s.p)) { delete out.p; delete out.fk; }
  return out;
}

function merge(base: Resolved, s: PoseSpec): Resolved {
  return {
    hips: s.hips ?? base.hips, hipsR: s.hipsR ?? base.hipsR, spine: s.spine ?? base.spine, chest: s.chest ?? base.chest,
    neck: s.neck ?? base.neck, head: s.head ?? base.head, clavL: s.clavL ?? base.clavL, clavR: s.clavR ?? base.clavR,
    armL: mergeArm(base.armL, s.armL), armR: mergeArm(base.armR, s.armR),
    legL: s.legL ? { ...base.legL, ...s.legL } : base.legL, legR: s.legR ? { ...base.legR, ...s.legR } : base.legR,
    grip: s.grip ?? base.grip,
  };
}

function armToPose(a: ArmSpec, side: number, pose: Pose): void {
  const s = side < 0 ? 0 : 1;
  const fku = s === 0 ? FK.uArmL : FK.uArmR, fkf = s === 0 ? FK.fArmL : FK.fArmR, fkh = s === 0 ? FK.handL : FK.handR;
  const sh = a.sh ?? [2, 6, 0], el = a.el ?? 14, wr = a.wr ?? Z3;
  _qx.setFromAxisAngle(X, sh[0] * DEG);
  _qz.setFromAxisAngle(Z, side * sh[1] * DEG);
  _qy.setFromAxisAngle(Y, side * sh[2] * DEG);
  _q.copy(_qx).multiply(_qz).multiply(_qy).toArray(pose.q, fku * 4);
  _q.setFromAxisAngle(X, el * DEG).toArray(pose.q, fkf * 4);
  _e.set(wr[0] * DEG, side * wr[2] * DEG, side * wr[1] * DEG, 'XZY');
  _q.setFromEuler(_e).toArray(pose.q, fkh * 4);
  pose.fist[s] = a.fist ?? 0.3;
  if (!a.p) { pose.armIk[s] = 0; return; }
  pose.armIk[s] = 1;
  const k = s * 7;
  pose.hand[k] = a.p[0]; pose.hand[k + 1] = a.p[1]; pose.hand[k + 2] = -a.p[2];
  // orientation from a reference pair
  if (a.blade) {
    _a0.set(0, 0, -1); _b0.set(0, -1, 0);
    _a1.set(a.blade[0], a.blade[1], -a.blade[2]);
    const e = a.edge ?? [0, -1, 0];
    _b1.set(e[0], e[1], -e[2]);
  } else if (a.barrel) {
    _a0.set(0, -1, 0); _b0.set(0, 0, -1);
    _a1.set(a.barrel[0], a.barrel[1], -a.barrel[2]);
    const u = a.up ?? [0, 1, 0];
    _b1.set(u[0], u[1], -u[2]);
  } else {
    _a0.set(0, -1, 0); _b0.set(-side, 0, 0);
    const f = a.fingers ?? [0, -1, 0.2];
    _a1.set(f[0], f[1], -f[2]);
    const p = a.palm ?? [-side, 0, 0];
    _b1.set(p[0], p[1], -p[2]);
  }
  alignPair(_a0, _b0, _a1, _b1, _q);
  pose.hand[k + 3] = _q.x; pose.hand[k + 4] = _q.y; pose.hand[k + 5] = _q.z; pose.hand[k + 6] = _q.w;
  const pole = a.pole ?? [side * 0.55, -0.7, -0.4];
  pose.elbow[s * 3] = pole[0]; pose.elbow[s * 3 + 1] = pole[1]; pose.elbow[s * 3 + 2] = -pole[2];
}

function legToPose(l: LegSpec, side: number, pose: Pose): void {
  const s = side < 0 ? 0 : 1;
  const p = l.p ?? [side * 0.115, 0, 0];
  const yaw = l.yaw ?? 8;
  footFromContact(side, p[0], p[1], p[2], l.pitch ?? 0, yaw, l.roll ?? 0, !!l.air, pose.foot, pose.foot, s * 7, pose.toe, s);
  if (l.knee) { pose.knee[s * 3] = l.knee[0]; pose.knee[s * 3 + 1] = l.knee[1]; pose.knee[s * 3 + 2] = -l.knee[2]; }
  else {
    // knee points where the toes point, slightly outward
    const a = -side * yaw * DEG;
    pose.knee[s * 3] = -Math.sin(a) + side * 0.12; pose.knee[s * 3 + 1] = 0.05; pose.knee[s * 3 + 2] = -Math.cos(a);
  }
}

/** Compile a fully resolved spec into a Pose (hand targets still in their authoring space). */
function toPose(r: Resolved): Pose {
  const pose = new Pose();
  pose.hip[0] = r.hips[0]; pose.hip[1] = r.hips[1]; pose.hip[2] = -r.hips[2];
  torsoQuat(r.hipsR, _q).toArray(pose.q, FK.hips * 4);
  torsoQuat(r.spine, _q).toArray(pose.q, FK.spine * 4);
  torsoQuat(r.chest, _q).toArray(pose.q, FK.chest * 4);
  torsoQuat(r.neck, _q).toArray(pose.q, FK.neck * 4);
  torsoQuat(r.head, _q).toArray(pose.q, FK.head * 4);
  // clavicles: shrug = rotate about Z (raise the shoulder), forward = about Y
  _qz.setFromAxisAngle(Z, -r.clavL[0] * DEG); _qy.setFromAxisAngle(Y, -r.clavL[1] * DEG);
  _q.copy(_qy).multiply(_qz).toArray(pose.q, FK.clavL * 4);
  _qz.setFromAxisAngle(Z, r.clavR[0] * DEG); _qy.setFromAxisAngle(Y, r.clavR[1] * DEG);
  _q.copy(_qy).multiply(_qz).toArray(pose.q, FK.clavR * 4);
  armToPose(r.armL, -1, pose);
  armToPose(r.armR, 1, pose);
  legToPose(r.legL, -1, pose);
  legToPose(r.legR, 1, pose);
  pose.grip = r.grip;
  return pose;
}

/** Compile a stack of PoseSpecs (later ones override earlier ones) into a Pose with model-space hand targets. */
export function compilePose(specs: PoseSpec[], space?: ClipSpec['space']): Pose {
  let r = defaults();
  for (const s of specs) r = merge(r, s);
  const pose = toPose(r);
  toModelSpace(pose, [space?.L === 'root', space?.R === 'root']);
  return pose;
}

export function compileClip(name: string, spec: ClipSpec): Clip {
  let r = defaults();
  if (spec.base) r = merge(r, spec.base);
  const times: number[] = [], eases: EaseFn[] = [], poses: Pose[] = [];
  const keys = spec.keys.length ? spec.keys : [{ t: 0 }];
  for (const k of keys) {
    r = merge(r, k);
    times.push(Math.min(1, Math.max(0, k.t)) * spec.duration);
    eases.push(typeof k.ease === 'function' ? k.ease : EASE[k.ease ?? 'inOut'] ?? EASE.inOut);
    poses.push(toPose(r));
  }
  const events = (spec.events ?? []).map(([t, n]) => ({ t: t * spec.duration, name: n })).sort((a, b) => a.t - b.t);
  return {
    name, duration: spec.duration, loop: !!spec.loop, upperOnly: !!spec.upperOnly, hold: !!spec.hold,
    fadeIn: spec.fadeIn ?? 0.12, fadeOut: spec.fadeOut ?? 0.18,
    times, eases, poses,
    rootSpace: [spec.space?.L === 'root', spec.space?.R === 'root'],
    events,
    hitTimes: events.filter((e) => e.name === 'hit' || e.name === 'release').map((e) => e.t),
  };
}

/** Convert chest-space hand targets / poles of a pose to model space using the pose's own torso. */
function toModelSpace(pose: Pose, rootSpace: readonly [boolean, boolean]): void {
  const q = pose.q;
  _hq.fromArray(q, FK.hips * 4);
  _sq.fromArray(q, FK.spine * 4).premultiply(_hq);
  _cq.fromArray(q, FK.chest * 4).premultiply(_sq);
  _cp.set(pose.hip[0], HIPS_Y + pose.hip[1], pose.hip[2]);
  _cp.add(_v.copy(SPINE_OFF).applyQuaternion(_hq)).add(_v.copy(CHEST_OFF).applyQuaternion(_sq));
  for (let s = 0; s < 2; s++) {
    if (pose.armIk[s] <= 0) { pose.follow[s] = 0; continue; }
    const k = s * 7;
    if (rootSpace[s]) { pose.follow[s] = 0; continue; }
    _v.set(pose.hand[k], pose.hand[k + 1], pose.hand[k + 2]).applyQuaternion(_cq).add(_cp);
    pose.hand[k] = _v.x; pose.hand[k + 1] = _v.y; pose.hand[k + 2] = _v.z;
    _q.set(pose.hand[k + 3], pose.hand[k + 4], pose.hand[k + 5], pose.hand[k + 6]).premultiply(_cq);
    pose.hand[k + 3] = _q.x; pose.hand[k + 4] = _q.y; pose.hand[k + 5] = _q.z; pose.hand[k + 6] = _q.w;
    _v.set(pose.elbow[s * 3], pose.elbow[s * 3 + 1], pose.elbow[s * 3 + 2]).applyQuaternion(_cq);
    pose.elbow[s * 3] = _v.x; pose.elbow[s * 3 + 1] = _v.y; pose.elbow[s * 3 + 2] = _v.z;
    pose.follow[s] = 1;
  }
}

/** Interpolate a hand target on an arc about the shoulder-line pivot (chest space). */
function arcLerp(a: Float32Array, b: Float32Array, k: number, t: number, out: Float32Array, ko: number): void {
  _a0.set(a[k] - PIVOT.x, a[k + 1] - PIVOT.y, a[k + 2] - PIVOT.z);
  _a1.set(b[k] - PIVOT.x, b[k + 1] - PIVOT.y, b[k + 2] - PIVOT.z);
  const ra = _a0.length(), rb = _a1.length();
  if (ra < 1e-4 || rb < 1e-4) {
    out[ko] = a[k] + (b[k] - a[k]) * t; out[ko + 1] = a[k + 1] + (b[k + 1] - a[k + 1]) * t; out[ko + 2] = a[k + 2] + (b[k + 2] - a[k + 2]) * t;
    return;
  }
  _a0.divideScalar(ra); _a1.divideScalar(rb);
  const d = Math.min(1, Math.max(-1, _a0.dot(_a1)));
  const om = Math.acos(d);
  let wa = 1 - t, wb = t;
  if (om > 0.02 && om < 3.0) { const so = Math.sin(om); wa = Math.sin((1 - t) * om) / so; wb = Math.sin(t * om) / so; }
  const r = ra + (rb - ra) * t;
  _v.set(_a0.x * wa + _a1.x * wb, _a0.y * wa + _a1.y * wb, _a0.z * wa + _a1.z * wb);
  const l = _v.length() || 1;
  out[ko] = PIVOT.x + (_v.x / l) * r; out[ko + 1] = PIVOT.y + (_v.y / l) * r; out[ko + 2] = PIVOT.z + (_v.z / l) * r;
}

const _save = new Float32Array(6);

/** Sample a clip at `time` seconds into `out` (model-space targets). */
export function sampleClip(clip: Clip, time: number, out: Pose): void {
  const n = clip.poses.length;
  if (n === 1) { out.copy(clip.poses[0]); toModelSpace(out, clip.rootSpace); return; }
  const dur = clip.duration;
  let t = clip.loop ? ((time % dur) + dur) % dur : Math.min(Math.max(time, 0), dur);
  let i = 0;
  while (i < n - 1 && clip.times[i + 1] <= t) i++;
  let j = i + 1, t0 = clip.times[i], t1: number;
  if (j >= n) {
    if (!clip.loop) { out.copy(clip.poses[n - 1]); toModelSpace(out, clip.rootSpace); return; }
    j = 0; t1 = dur + clip.times[0];
  } else t1 = clip.times[j];
  if (t < clip.times[0]) {
    // before the first key
    if (clip.loop) { i = n - 1; j = 0; t0 = clip.times[n - 1] - dur; t1 = clip.times[0]; }
    else { out.copy(clip.poses[0]); toModelSpace(out, clip.rootSpace); return; }
  }
  const span = t1 - t0;
  const u = clip.eases[j](span > 1e-6 ? (t - t0) / span : 1);
  const A = clip.poses[i], B = clip.poses[j];
  out.copy(A);
  // hand positions on arcs (chest space only), saved around the generic mix
  for (let s = 0; s < 2; s++) {
    const k = s * 7;
    if (A.armIk[s] > 0 && B.armIk[s] > 0 && !clip.rootSpace[s]) arcLerp(A.hand, B.hand, k, u, _save, s * 3);
  }
  out.mix(B, u, u);
  for (let s = 0; s < 2; s++) {
    const k = s * 7;
    if (A.armIk[s] > 0 && B.armIk[s] > 0 && !clip.rootSpace[s]) { out.hand[k] = _save[s * 3]; out.hand[k + 1] = _save[s * 3 + 1]; out.hand[k + 2] = _save[s * 3 + 2]; }
  }
  toModelSpace(out, clip.rootSpace);
}
