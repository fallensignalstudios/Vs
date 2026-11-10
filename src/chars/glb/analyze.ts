/**
 * One-time analysis of a generated humanoid: which bone plays which role, where the hands really are and how
 * they are oriented (the rig has no finger bones and nothing marks the palm), how thick the body is where
 * equipment hangs — all measured from bones, skin weights and vertices so a replaced file needs no edits.
 * It also gives the rigid hands two curl bones each (knuckles, mid joints) by re-weighting the finger vertices,
 * so a fist can close around a grip.
 *
 * Everything is expressed in the template's root space at scale 1: metres, Y up, the figure facing −Z.
 */
import * as THREE from 'three';

/** Driver bone names a target bone can stand in for (see retarget.ts); the spine is a separate chain. */
export const LIMB_ROLES = [
  'hips', 'neck', 'head',
  'clavL', 'uArmL', 'fArmL', 'handL', 'clavR', 'uArmR', 'fArmR', 'handR',
  'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR',
] as const;
export type LimbRole = (typeof LIMB_ROLES)[number];

const ALIASES: Record<LimbRole, readonly string[]> = {
  hips: ['hips', 'pelvis'], neck: ['neck', 'neck01'], head: ['head'],
  clavL: ['leftshoulder', 'leftclavicle'], uArmL: ['leftarm', 'leftupperarm'], fArmL: ['leftforearm', 'leftlowerarm'], handL: ['lefthand'],
  clavR: ['rightshoulder', 'rightclavicle'], uArmR: ['rightarm', 'rightupperarm'], fArmR: ['rightforearm', 'rightlowerarm'], handR: ['righthand'],
  thighL: ['leftupleg', 'leftthigh'], shinL: ['leftleg', 'leftshin', 'leftlowerleg'], footL: ['leftfoot'], toeL: ['lefttoebase', 'lefttoe'],
  thighR: ['rightupleg', 'rightthigh'], shinR: ['rightleg', 'rightshin', 'rightlowerleg'], footR: ['rightfoot'], toeR: ['righttoebase', 'righttoe'],
};
/** roles a rig can lack without being rejected */
const OPTIONAL: ReadonlySet<string> = new Set(['neck', 'clavL', 'clavR', 'toeL', 'toeR']);

export interface HandInfo {
  /** false: the hand could not be measured; frames below are estimates from the arm and there are no curl bones */
  ok: boolean;
  wrist: THREE.Vector3;
  /** unit vectors (rest pose): wrist → fingertips, out of the palm, and f × n (a positive turn about it closes the fist) */
  f: THREE.Vector3;
  n: THREE.Vector3;
  s: THREE.Vector3;
  /** wrist → fingertip distance */
  length: number;
  /** centre line of a ~3 cm handle held in the fist (rest pose) */
  grip: THREE.Vector3;
  /** names of the added curl bones [knuckles, mid joints], or null */
  fingers: [string, string] | null;
  /** curl axis in the curl bones' own frame */
  curlAxis: THREE.Vector3;
}

export interface BodyMetrics {
  /** how far the upper back stands behind the neck joint */
  backDepth: number;
  /** half-width of the body at the hip joints, from the centre line */
  hipHalfWidth: number;
  /** how far the outside of each thigh stands from its hip joint, ~14 cm below it [L, R] */
  thighOuter: [number, number];
  /** radius of each forearm around its bone, mid-way [L, R] */
  forearmRadius: [number, number];
  /** half-width of the shoulders (outermost upper-arm surface) */
  shoulderHalfWidth: number;
}

export interface RigInfo {
  /** bone name per role */
  names: Partial<Record<LimbRole, string>>;
  /** spine chain between the hips and the neck / shoulders, lowest first */
  spine: string[];
  hands: { L: HandInfo; R: HandInfo };
  metrics: BodyMetrics;
  /** lowest point of the mesh (the sole) and its top */
  groundY: number;
  height: number;
  /**
   * Raw vertex attribute → rest position in root space. (Not the node transform: quantised files keep their
   * de-quantisation in the inverse bind matrices, so the raw `position` values are in no useful space.)
   */
  restMatrix: THREE.Matrix4;
  triangles: number;
}

const norm = (s: string): string => s.toLowerCase().replace(/^mixamorig:?/, '').replace(/[^a-z0-9]/g, '');

/** Jacobi eigen-decomposition of a symmetric 3×3 matrix (rows of `a`); eigenvectors are the columns of `vectors`. */
export function eigenSym3(a: number[][]): { values: number[]; vectors: number[][] } {
  const m = a.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const pairs: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];
  for (let sweep = 0; sweep < 32; sweep++) {
    if (Math.abs(m[0][1]) + Math.abs(m[0][2]) + Math.abs(m[1][2]) < 1e-14) break;
    for (const [p, q] of pairs) {
      if (Math.abs(m[p][q]) < 1e-18) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const kp = m[k][p], kq = m[k][q]; m[k][p] = c * kp - s * kq; m[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 3; k++) { const pk = m[p][k], qk = m[q][k]; m[p][k] = c * pk - s * qk; m[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 3; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  return { values: [m[0][0], m[1][1], m[2][2]], vectors: v };
}

/** value at quantile q (0..1) of an unsorted list */
export function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Resolve roles against a bone list; null when a required role is missing or the limb hierarchy is not a chain. */
export function resolveRoles(bones: THREE.Object3D[]): { names: Partial<Record<LimbRole, string>>; spine: string[] } | null {
  const byNorm = new Map<string, THREE.Object3D>();
  for (const b of bones) if (!byNorm.has(norm(b.name))) byNorm.set(norm(b.name), b);
  const names: Partial<Record<LimbRole, string>> = {};
  const obj: Partial<Record<LimbRole, THREE.Object3D>> = {};
  for (const role of LIMB_ROLES) {
    for (const alias of ALIASES[role]) {
      const b = byNorm.get(alias);
      if (b) { names[role] = b.name; obj[role] = b; break; }
    }
    if (!obj[role] && !OPTIONAL.has(role)) return null;
  }
  // limbs must hang together the way the retarget walks them
  const chain = (...roles: LimbRole[]): boolean => {
    for (let i = 1; i < roles.length; i++) { const c = obj[roles[i]], p = obj[roles[i - 1]]; if (c && p && c.parent !== p) return false; }
    return true;
  };
  for (const s of ['L', 'R'] as const) {
    if (!chain(`uArm${s}`, `fArm${s}`, `hand${s}`) || !chain(`thigh${s}`, `shin${s}`, `foot${s}`)) return null;
    if (obj[`clav${s}`] && !chain(`clav${s}`, `uArm${s}`)) return null;
    if (obj[`toe${s}`] && !chain(`foot${s}`, `toe${s}`)) return null;
    if (obj[`thigh${s}`]?.parent !== obj.hips) return null;
  }
  if (obj.neck && obj.head?.parent !== obj.neck) return null;
  // spine: walk up from whatever carries the arms until the hips
  const top = (obj.clavL ?? obj.uArmL)?.parent;
  if (!top || top !== (obj.clavR ?? obj.uArmR)?.parent) return null;
  if ((obj.neck ?? obj.head)?.parent !== top) return null;
  const spine: string[] = [];
  for (let b: THREE.Object3D | null = top; b && b !== obj.hips; b = b.parent) {
    spine.unshift(b.name);
    if (spine.length > 8 || !b.parent) return null;
  }
  if (!spine.length) return null;
  return { names, spine };
}

const _v = new THREE.Vector3();

interface MeshData {
  count: number;
  /** rest positions in root space */
  pos: Float32Array;
  /** four bone indices and weights per vertex */
  idx: Uint16Array;
  wgt: Float32Array;
  /** bone with the largest weight */
  dom: Uint16Array;
}

function readMesh(mesh: THREE.SkinnedMesh): MeshData | null {
  const g = mesh.geometry;
  const P = g.getAttribute('position'), SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight');
  if (!P || !SI || !SW) return null;
  const count = P.count;
  const pos = new Float32Array(count * 3), idx = new Uint16Array(count * 4), wgt = new Float32Array(count * 4), dom = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld);
    pos[i * 3] = _v.x; pos[i * 3 + 1] = _v.y; pos[i * 3 + 2] = _v.z;
    let sum = 0, best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(i, k), b = SI.getComponent(i, k);
      idx[i * 4 + k] = b; wgt[i * 4 + k] = w; sum += w;
      if (w > bw) { bw = w; best = b; }
    }
    if (sum > 1e-6) for (let k = 0; k < 4; k++) wgt[i * 4 + k] /= sum;
    dom[i] = best;
  }
  return { count, pos, idx, wgt, dom };
}

function weightOf(d: MeshData, i: number, bone: number): number {
  let w = 0;
  for (let k = 0; k < 4; k++) if (d.idx[i * 4 + k] === bone) w += d.wgt[i * 4 + k];
  return w;
}

/** curl pivots of a measured hand: knuckle line, mid joints, and the fingers' lateral span */
interface HandPivots { k: THREE.Vector3; m: THREE.Vector3; span: [number, number] }

function analyzeHand(d: MeshData, bone: number, wrist: THREE.Vector3, elbow: THREE.Vector3, side: -1 | 1): { hand: HandInfo; pivots: HandPivots | null } {
  const arm = wrist.clone().sub(elbow).normalize();
  // without a measurement: the hand continues the forearm, palm turned down / toward the body
  const refN = new THREE.Vector3().crossVectors(arm, new THREE.Vector3(0, 0, -1)).multiplyScalar(-side);
  if (refN.lengthSq() < 1e-6) refN.set(-side, 0, 0);
  refN.normalize();
  const guess: { hand: HandInfo; pivots: HandPivots | null } = {
    hand: {
      ok: false, wrist: wrist.clone(), f: arm.clone(), n: refN.clone(), s: new THREE.Vector3().crossVectors(arm, refN).normalize(), length: 0.18,
      grip: wrist.clone().addScaledVector(arm, 0.085).addScaledVector(refN, 0.025), fingers: null, curlAxis: new THREE.Vector3(1, 0, 0),
    },
    pivots: null,
  };
  const sel: number[] = [];
  for (let i = 0; i < d.count; i++) if (weightOf(d, i, bone) >= 0.5) sel.push(i);
  if (sel.length < 40) return guess;
  const c = new THREE.Vector3();
  for (const i of sel) c.add(_v.fromArray(d.pos, i * 3));
  c.multiplyScalar(1 / sel.length);
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of sel) {
    const x = d.pos[i * 3] - c.x, y = d.pos[i * 3 + 1] - c.y, z = d.pos[i * 3 + 2] - c.z;
    cov[0][0] += x * x; cov[0][1] += x * y; cov[0][2] += x * z; cov[1][1] += y * y; cov[1][2] += y * z; cov[2][2] += z * z;
  }
  cov[1][0] = cov[0][1]; cov[2][0] = cov[0][2]; cov[2][1] = cov[1][2];
  const eig = eigenSym3(cov);
  const order = [0, 1, 2].sort((p, q) => eig.values[q] - eig.values[p]);
  const axis = (k: number): THREE.Vector3 => new THREE.Vector3(eig.vectors[0][order[k]], eig.vectors[1][order[k]], eig.vectors[2][order[k]]).normalize();
  const f = axis(0), n = axis(2);
  // a hand is longer than it is wide and wider than it is thick; anything else is not a hand we can read
  if (!(eig.values[order[0]] > eig.values[order[1]] * 1.3) || !(eig.values[order[1]] > eig.values[order[2]] * 1.3)) return guess;
  if (f.dot(c.clone().sub(wrist)) < 0) f.negate();
  if (f.dot(arm) < 0.3) return guess;
  n.addScaledVector(f, -n.dot(f)).normalize();
  if (n.dot(refN) < 0) n.negate();
  const s = new THREE.Vector3().crossVectors(f, n).normalize();

  const u: number[] = [], pn: number[] = [], ps: number[] = [];
  for (const i of sel) {
    _v.fromArray(d.pos, i * 3).sub(wrist);
    u.push(_v.dot(f)); pn.push(_v.dot(n)); ps.push(_v.dot(s));
  }
  const length = quantile(u, 0.995);
  if (!(length > 0.08 && length < 0.6)) return guess;
  const palmN: number[] = [], fingS: number[] = [], palmS: number[] = [];
  for (let k = 0; k < u.length; k++) {
    if (u[k] > 0.2 * length && u[k] < 0.5 * length) palmN.push(pn[k]);
    if (u[k] > 0.15 * length && u[k] < 0.62 * length) palmS.push(ps[k]);
    if (u[k] > 0.72 * length) fingS.push(ps[k]);
  }
  if (palmN.length < 8 || fingS.length < 8) return guess;
  let sLo = quantile(fingS, 0.03), sHi = quantile(fingS, 0.97);
  // the thumb settles which face is the palm: seen from the palm, a right hand's thumb is on +s, a left hand's on −s
  const over = (quantile(palmS, 0.985) - sHi) - (sLo - quantile(palmS, 0.015));
  let flip = 1;
  if (Math.abs(over) > 0.012 && Math.sign(over) !== side) {
    flip = -1;
    n.negate(); s.negate();
    const lo = -sHi; sHi = -sLo; sLo = lo;
  }
  const nA = quantile(palmN, 0.92) * flip, nB = quantile(palmN, 0.08) * flip;
  const nFront = Math.max(nA, nB), nMid = (nA + nB) / 2, sMid = (sLo + sHi) / 2;
  const uK = 0.5 * length, uM = 0.74 * length;
  const at = (uu: number, nn: number, ss: number): THREE.Vector3 => wrist.clone().addScaledVector(f, uu).addScaledVector(n, nn).addScaledVector(s, ss);
  return {
    hand: { ok: true, wrist: wrist.clone(), f, n, s, length, grip: at(uK - 0.012, nFront + 0.013, sMid), fingers: null, curlAxis: new THREE.Vector3(1, 0, 0) },
    pivots: { k: at(uK, nMid, sMid), m: at(uM, nMid, sMid), span: [sLo, sHi] },
  };
}

/**
 * Give one hand its two curl bones and move finger-vertex weight onto them. Returns the new bones (already
 * parented under the hand bone) or null if the hand was not measurable.
 */
function addFingerBones(d: MeshData, hand: HandInfo, priv: HandPivots | null, handBone: THREE.Bone, boneIndex: number, firstNew: number): [THREE.Bone, THREE.Bone] | null {
  if (!hand.ok || !priv) return null;
  const a = new THREE.Bone(), b = new THREE.Bone();
  a.name = handBone.name + '_curlA';
  b.name = handBone.name + '_curlB';
  handBone.add(a);
  a.add(b);
  a.position.copy(handBone.worldToLocal(priv.k.clone()));
  b.position.copy(handBone.worldToLocal(priv.m.clone())).sub(a.position);
  a.updateMatrixWorld(true);
  const rest = new THREE.Quaternion();
  handBone.getWorldQuaternion(rest);
  hand.curlAxis.copy(hand.s).applyQuaternion(rest.invert()).normalize();
  hand.fingers = [a.name, b.name];

  const L = hand.length, band = 0.055 * L, uK = 0.5 * L, uM = 0.74 * L;
  const [sLo, sHi] = priv.span;
  const ss = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const slot: Array<[number, number]> = [];
  for (let i = 0; i < d.count; i++) {
    const wh = weightOf(d, i, boneIndex);
    if (wh < 0.02) continue;
    _v.fromArray(d.pos, i * 3).sub(hand.wrist);
    const u = _v.dot(hand.f), sv = _v.dot(hand.s);
    let t1 = ss(uK - band, uK + band, u);
    if (t1 <= 0) continue;
    // the thumb lies outside the fingers' span and ends before their mid joints: it stays with the palm
    if (u < 0.8 * L) t1 *= 1 - Math.max(ss(sHi + 0.002, sHi + 0.012, sv), ss(sLo - 0.002, sLo - 0.012, sv));
    if (t1 <= 0) continue;
    const t2 = ss(uM - band, uM + band, u);
    slot.length = 0;
    for (let k = 0; k < 4; k++) {
      const bi = d.idx[i * 4 + k], w = d.wgt[i * 4 + k];
      if (w > 0 && bi !== boneIndex) slot.push([bi, w]);
    }
    slot.push([boneIndex, wh * (1 - t1)], [firstNew, wh * t1 * (1 - t2)], [firstNew + 1, wh * t1 * t2]);
    slot.sort((p, q) => q[1] - p[1]);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += slot[k] ? slot[k][1] : 0;
    for (let k = 0; k < 4; k++) {
      d.idx[i * 4 + k] = slot[k] ? slot[k][0] : 0;
      d.wgt[i * 4 + k] = slot[k] && sum > 0 ? slot[k][1] / sum : 0;
    }
  }
  return [a, b];
}

function measureBody(d: MeshData, index: Map<string, number>, pos: (role: LimbRole) => THREE.Vector3 | null, spine: number[]): BodyMetrics {
  const roleIndex = (role: LimbRole): number => index.get(role) ?? -1;
  const m: BodyMetrics = { backDepth: 0.13, hipHalfWidth: 0.17, thighOuter: [0.09, 0.09], forearmRadius: [0.05, 0.05], shoulderHalfWidth: 0.24 };
  const neck = pos('neck') ?? pos('head'), tL = pos('thighL'), tR = pos('thighR');
  const torso = new Set(spine);
  if (neck) {
    const back: number[] = [];
    for (let i = 0; i < d.count; i++) {
      if (!torso.has(d.dom[i])) continue;
      const x = d.pos[i * 3], y = d.pos[i * 3 + 1], z = d.pos[i * 3 + 2];
      if (Math.abs(x - neck.x) < 0.13 && y < neck.y - 0.06 && y > neck.y - 0.3 && z > neck.z) back.push(z - neck.z);
    }
    if (back.length > 12) m.backDepth = quantile(back, 0.9);
  }
  if (tL && tR) {
    const cx = (tL.x + tR.x) / 2, cy = (tL.y + tR.y) / 2;
    const hipSet = new Set([spine[0], roleIndex('hips'), roleIndex('thighL'), roleIndex('thighR')]);
    const wide: number[] = [];
    for (let i = 0; i < d.count; i++) {
      if (!hipSet.has(d.dom[i])) continue;
      const y = d.pos[i * 3 + 1];
      if (y > cy - 0.03 && y < cy + 0.1) wide.push(Math.abs(d.pos[i * 3] - cx));
    }
    if (wide.length > 12) m.hipHalfWidth = quantile(wide, 0.95);
    for (const s of [0, 1] as const) {
      const t = s === 0 ? tL : tR, bi = roleIndex(s === 0 ? 'thighL' : 'thighR'), out: number[] = [];
      const sign = s === 0 ? -1 : 1;
      for (let i = 0; i < d.count; i++) {
        if (d.dom[i] !== bi) continue;
        const y = d.pos[i * 3 + 1];
        // the flank of the thigh where a holster hangs — not the plates in front of or behind it
        if (y < t.y - 0.1 && y > t.y - 0.19 && Math.abs(d.pos[i * 3 + 2] - t.z) < 0.06) out.push((d.pos[i * 3] - t.x) * sign);
      }
      if (out.length > 12) m.thighOuter[s] = Math.max(0.04, quantile(out, 0.85));
    }
  }
  for (const s of [0, 1] as const) {
    const e = pos(s === 0 ? 'fArmL' : 'fArmR'), w = pos(s === 0 ? 'handL' : 'handR'), bi = roleIndex(s === 0 ? 'fArmL' : 'fArmR');
    if (!e || !w) continue;
    const ax = w.clone().sub(e), len = ax.length();
    ax.normalize();
    const rad: number[] = [];
    for (let i = 0; i < d.count; i++) {
      if (d.dom[i] !== bi) continue;
      _v.fromArray(d.pos, i * 3).sub(e);
      const along = _v.dot(ax);
      if (along > 0.3 * len && along < 0.7 * len) rad.push(_v.addScaledVector(ax, -along).length());
    }
    if (rad.length > 12) m.forearmRadius[s] = quantile(rad, 0.9);
  }
  const uL = pos('uArmL'), uR = pos('uArmR');
  if (uL && uR) {
    const biL = roleIndex('uArmL'), biR = roleIndex('uArmR'), cx = (uL.x + uR.x) / 2, wide: number[] = [];
    for (let i = 0; i < d.count; i++) {
      if (d.dom[i] !== biL && d.dom[i] !== biR) continue;
      if (d.pos[i * 3 + 1] > uL.y - 0.08) wide.push(Math.abs(d.pos[i * 3] - cx));
    }
    m.shoulderHalfWidth = wide.length > 12 ? quantile(wide, 0.9) : Math.abs(uL.x - uR.x) / 2 + 0.06;
  }
  return m;
}

/**
 * The affine map from raw vertex attributes to rest positions (root space), from four well-spread vertices.
 * In the rest pose every bone applies the same de-quantisation, so the map is exact.
 */
export function fitRestMatrix(mesh: THREE.SkinnedMesh, d: { count: number; pos: Float32Array }): THREE.Matrix4 {
  const P = mesh.geometry.getAttribute('position');
  const out = new THREE.Matrix4().copy(mesh.matrixWorld);
  if (!P || d.count < 4) return out;
  const pick = [0, 0, 0, 0];
  for (let i = 0; i < d.count; i++) {
    if (d.pos[i * 3] < d.pos[pick[0] * 3]) pick[0] = i;
    if (d.pos[i * 3] > d.pos[pick[1] * 3]) pick[1] = i;
    if (d.pos[i * 3 + 1] > d.pos[pick[2] * 3 + 1]) pick[2] = i;
    if (d.pos[i * 3 + 2] > d.pos[pick[3] * 3 + 2]) pick[3] = i;
  }
  const raw = pick.map((i) => new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)));
  const world = pick.map((i) => new THREE.Vector3().fromArray(d.pos, i * 3));
  const cols = (v: THREE.Vector3[]): THREE.Matrix3 => {
    const a = v[1].clone().sub(v[0]), b = v[2].clone().sub(v[0]), c = v[3].clone().sub(v[0]);
    return new THREE.Matrix3().set(a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z);
  };
  const rm = cols(raw);
  if (Math.abs(rm.determinant()) < 1e-12) return out;
  const a = cols(world).multiply(rm.invert());
  const t = world[0].clone().sub(raw[0].clone().applyMatrix3(a));
  const e = a.elements;
  return out.set(e[0], e[3], e[6], t.x, e[1], e[4], e[7], t.y, e[2], e[5], e[8], t.z, 0, 0, 0, 1);
}

/**
 * Analyse a humanoid template. `root` is the template wrapper (already turned to face −Z, matrices current),
 * `mesh` its main skinned mesh. Adds the curl bones to the skeleton and rewrites the skin attributes.
 * Returns null when the skeleton cannot play a humanoid.
 */
export function analyzeHumanoid(root: THREE.Object3D, mesh: THREE.SkinnedMesh): RigInfo | null {
  root.updateMatrixWorld(true);
  const skeleton = mesh.skeleton;
  const roles = resolveRoles(skeleton.bones);
  if (!roles) return null;
  skeleton.update();
  const data = readMesh(mesh);
  if (!data) return null;

  const bone = (role: LimbRole): THREE.Bone | null => (roles.names[role] ? skeleton.getBoneByName(roles.names[role] as string) ?? null : null);
  const cache = new Map<string, THREE.Vector3>();
  const pos = (role: LimbRole): THREE.Vector3 | null => {
    const hit = cache.get(role);
    if (hit) return hit;
    const b = bone(role);
    if (!b) return null;
    const p = b.getWorldPosition(new THREE.Vector3());
    cache.set(role, p);
    return p;
  };
  const idxMap = new Map<string, number>();
  for (const r of LIMB_ROLES) { const b = bone(r); if (b) idxMap.set(r, skeleton.bones.indexOf(b)); }

  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < data.count; i++) { const y = data.pos[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }

  const measured = {
    L: analyzeHand(data, idxMap.get('handL') as number, pos('handL') as THREE.Vector3, pos('fArmL') as THREE.Vector3, -1),
    R: analyzeHand(data, idxMap.get('handR') as number, pos('handR') as THREE.Vector3, pos('fArmR') as THREE.Vector3, 1),
  };
  const hands = { L: measured.L.hand, R: measured.R.hand };
  const metrics = measureBody(data, idxMap, pos, roles.spine.map((n) => skeleton.bones.findIndex((b) => b.name === n)));

  const restMatrix = fitRestMatrix(mesh, data);

  // curl bones
  const bones = skeleton.bones.slice();
  const inverses = skeleton.boneInverses.map((m) => m.clone());
  let changed = false;
  for (const s of ['L', 'R'] as const) {
    const hb = bone(`hand${s}`) as THREE.Bone;
    const made = addFingerBones(data, hands[s], measured[s].pivots, hb, idxMap.get(`hand${s}`) as number, bones.length);
    if (!made) continue;
    // the existing inverses are relative to the space the mesh was bound in: derive the hand's bind-space world
    // matrix from its inverse and hang the new bones off it
    const handBind = inverses[idxMap.get(`hand${s}`) as number].clone().invert();
    const a = handBind.clone().multiply(made[0].matrix);
    made[1].updateMatrix();
    const b = a.clone().multiply(made[1].matrix);
    bones.push(made[0], made[1]);
    inverses.push(a.invert(), b.invert());
    changed = true;
  }
  if (changed) {
    const g = mesh.geometry;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.idx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.wgt, 4));
    mesh.bind(new THREE.Skeleton(bones, inverses), mesh.bindMatrix);
    skeleton.dispose();
  }

  const g = mesh.geometry;
  return {
    names: roles.names, spine: roles.spine, hands, metrics,
    groundY: Number.isFinite(minY) ? minY : 0, height: Number.isFinite(maxY) && Number.isFinite(minY) ? maxY - minY : 1.8,
    restMatrix,
    triangles: Math.round((g.index ? g.index.count : g.getAttribute('position').count) / 3),
  };
}
