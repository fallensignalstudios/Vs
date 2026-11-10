/**
 * Analytic two-bone IK (arms and legs). Works on bones whose REST rotation is identity: each bone is described
 * by its rest offset to the next joint, and the solver returns the world rotations that place the end joint on
 * the (reach-clamped) target with the middle joint bent toward a pole direction.
 */
import * as THREE from 'three';

const _dT = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _end = new THREE.Vector3();
const _d = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qr = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _tmp = new THREE.Vector3();

/** Rotation taking the frame (dir, normal) to itself as a quaternion of the orthonormal basis x=n⊥, y=dir, z=x×y. */
function basis(dir: THREE.Vector3, normal: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _x.copy(normal).addScaledVector(dir, -normal.dot(dir));
  if (_x.lengthSq() < 1e-10) {
    // degenerate: pick any perpendicular
    _x.set(1, 0, 0).addScaledVector(dir, -dir.x);
    if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).addScaledVector(dir, -dir.z);
  }
  _x.normalize();
  _z.crossVectors(_x, dir);
  _m.makeBasis(_x, dir, _z);
  return out.setFromRotationMatrix(_m);
}

export interface TwoBoneRest {
  /** rest offset joint A → joint B */
  a: THREE.Vector3;
  /** rest offset joint B → joint C (end) */
  b: THREE.Vector3;
  /** rest hinge axis (plane normal of the bend) */
  hinge: THREE.Vector3;
  la: number;
  lb: number;
  /** cached inverse rest frames */
  qaRestInv: THREE.Quaternion;
  qbRestInv: THREE.Quaternion;
}

/**
 * Precompute rest data. `restPole` is the direction the middle joint points at rest
 * (knee: forward (0,0,−1); elbow: backward (0,0,1)).
 */
export function makeTwoBoneRest(a: THREE.Vector3, b: THREE.Vector3, restPole: THREE.Vector3): TwoBoneRest {
  const chain = new THREE.Vector3().addVectors(a, b).normalize();
  const hinge = new THREE.Vector3().crossVectors(chain, restPole).normalize();
  const qa = basis(new THREE.Vector3().copy(a).normalize(), hinge, new THREE.Quaternion()).clone().invert();
  const qb = basis(new THREE.Vector3().copy(b).normalize(), hinge, new THREE.Quaternion()).clone().invert();
  return { a: a.clone(), b: b.clone(), hinge, la: a.length(), lb: b.length(), qaRestInv: qa, qbRestInv: qb };
}

/**
 * Solve. All vectors in the same space. Writes world rotations for bone A and B and the resulting end position.
 * Returns the reach ratio (target distance / chain length) before clamping, for callers that want to know.
 */
export function solveTwoBone(
  rest: TwoBoneRest, root: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3,
  outA: THREE.Quaternion, outB: THREE.Quaternion, outEnd?: THREE.Vector3, outMid?: THREE.Vector3,
): number {
  const la = rest.la, lb = rest.lb;
  _dT.subVectors(target, root);
  let D = _dT.length();
  const reach = D / (la + lb);
  if (D < 1e-6) { _dT.set(0, -1, 0); D = 1e-6; } else _dT.divideScalar(D);
  const maxD = (la + lb) * 0.999, minD = Math.abs(la - lb) * 1.02 + 1e-4;
  D = D > maxD ? maxD : D < minD ? minD : D;

  // bend plane normal n = dT × pole
  _n.crossVectors(_dT, pole);
  if (_n.lengthSq() < 1e-8) {
    _tmp.set(0, 0, -1);
    _n.crossVectors(_dT, _tmp);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0);
  }
  _n.normalize();
  _bend.crossVectors(_n, _dT).normalize();

  const cosA = Math.min(1, Math.max(-1, (la * la + D * D - lb * lb) / (2 * la * D)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _mid.copy(root).addScaledVector(_dT, la * cosA).addScaledVector(_bend, la * sinA);
  _end.copy(root).addScaledVector(_dT, D);

  _d.subVectors(_mid, root).normalize();
  basis(_d, _n, _qc);
  outA.copy(_qc).multiply(rest.qaRestInv);
  _d.subVectors(_end, _mid).normalize();
  basis(_d, _n, _qc);
  outB.copy(_qc).multiply(rest.qbRestInv);
  if (outEnd) outEnd.copy(_end);
  if (outMid) outMid.copy(_mid);
  return reach;
}

/**
 * Quaternion that maps the reference pair (a0 primary, b0 secondary) onto (a1, b1): the primary axes align
 * exactly, the secondaries as closely as orthogonality allows. Inputs need not be normalised or orthogonal.
 */
export function alignPair(a0: THREE.Vector3, b0: THREE.Vector3, a1: THREE.Vector3, b1: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const da = _d.copy(a0).normalize();
  basis(da, b0, _qr);
  _qr.invert();
  const db = _tmp.copy(a1).normalize();
  basis(db, b1, _qc);
  return out.copy(_qc).multiply(_qr);
}
