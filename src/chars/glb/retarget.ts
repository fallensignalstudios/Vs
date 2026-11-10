/**
 * Retarget: copies the procedural humanoid's solved pose onto a generated skeleton, every frame.
 *
 * World-space delta retarget. The driver rig has identity rest rotations, so a driver bone's model-space
 * rotation D is already its delta from rest. For each target bone:  W = D · C · R,  where R is the target's
 * rest (A-pose) world rotation and C a calibration computed once that turns the target's rest bone direction
 * onto the driver's (shortest arc, so no twist is invented). Hands are calibrated on a measured palm frame and
 * feet in yaw only, so soles stay flat. Then two corrections that rotation copying cannot give:
 *  - legs are re-solved (two-bone IK) so each ankle sits exactly where the driver planted its foot — the driver
 *    is scaled so both have the same leg length, which keeps the stride and the knee bend;
 *  - a hand can be pulled onto a point (the off-hand grip of the visible weapon, a pinned console).
 *
 * All maths is in the wrapper's ROOT space (metres, Y up, facing −Z): driver model space × its uniform scale.
 */
import * as THREE from 'three';
import type { RigSpec } from '../humanoid/rig';
import type { HandInfo, LimbRole, RigInfo } from './analyze';

interface Node {
  role: string;
  bone: THREE.Bone;
  /** driver bone index, or −1 for a spine blend */
  src: number;
  /** spine blend 0 (driver spine) .. 1 (driver chest) */
  spineT: number;
  parent: number;
  restPos: THREE.Vector3;
  restInv: THREE.Quaternion;
  /** inverse of the bone's rest world matrix */
  restMatInv: THREE.Matrix4;
  /** C · R */
  cr: THREE.Quaternion;
  /** rest offset from the parent node (root space) */
  off: THREE.Vector3;
  /** current world rotation, world delta (W · R⁻¹) and position */
  w: THREE.Quaternion;
  d: THREE.Quaternion;
  p: THREE.Vector3;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _h = new THREE.Vector3();
const _knee = new THREE.Vector3(), _end = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _mx = new THREE.Vector3(), _my = new THREE.Vector3(), _mz = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Middle joint of a two-bone chain from `a` toward `t` (segment lengths l1, l2), bending toward `hint`.
 * `outEnd` is the reachable end point (t clamped to the chain's reach).
 */
export function solveJoint(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, hint: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3): void {
  _d.copy(t).sub(a);
  let dist = _d.length();
  if (dist < 1e-6) { _d.set(0, -1, 0); dist = 1e-6; } else _d.multiplyScalar(1 / dist);
  const lo = Math.abs(l1 - l2) + 1e-4, hi = (l1 + l2) * 0.9995;
  const dc = Math.min(hi, Math.max(lo, dist));
  outEnd.copy(a).addScaledVector(_d, dc);
  const x = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _h.copy(hint).sub(a);
  _h.addScaledVector(_d, -_h.dot(_d));
  if (_h.lengthSq() < 1e-10) { _h.set(0, 0, -1).addScaledVector(_d, _d.z); if (_h.lengthSq() < 1e-10) _h.set(1, 0, 0); }
  _h.normalize();
  outMid.copy(a).addScaledVector(_d, x).addScaledVector(_h, y);
}

/** Rotation that takes the orthonormal frame (a1, a2) onto (b1, b2); the second axes are re-orthogonalised. */
export function alignFrames(a1: THREE.Vector3, a2: THREE.Vector3, b1: THREE.Vector3, b2: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const basis = (x: THREE.Vector3, y: THREE.Vector3, q: THREE.Quaternion): THREE.Quaternion => {
    _mx.copy(x).normalize();
    _my.copy(y).addScaledVector(_mx, -y.dot(_mx)).normalize();
    _mz.crossVectors(_mx, _my);
    return q.setFromRotationMatrix(_m.makeBasis(_mx, _my, _mz));
  };
  basis(a1, a2, _q2);
  basis(b1, b2, out);
  return out.multiply(_q2.invert());
}

export class Retargeter {
  /** uniform scale the driver's model must have so its legs are as long as the target's */
  readonly driverScale: number;
  private readonly nodes: Node[] = [];
  private readonly index: Record<string, number> = {};
  private readonly parentQ = new THREE.Quaternion();
  private readonly parentInv = new THREE.Matrix4();
  private readonly pelvisOff = new THREE.Vector3();
  /** how much higher the target's ankle joint sits above its sole than the (scaled) driver's */
  private readonly ankleLift: number;
  private readonly srcThigh: [number, number];
  private readonly srcShin: [number, number];
  private readonly srcFoot: [number, number];
  private readonly srcSpine: number;
  private readonly srcChest: number;
  private readonly gripOff: [THREE.Vector3, THREE.Vector3];
  private readonly curl: Array<{ a: THREE.Bone; b: THREE.Bone; axis: THREE.Vector3 } | null> = [null, null];
  /** role names of the lowest and the highest spine bone (the highest carries arms and neck) */
  readonly waistRole: string;
  readonly chestRole: string;

  /**
   * `instance` is the model instance root — not yet parented, uniform scale already applied, matrices current.
   * `rig` is the template analysis (scale 1); `scale` the instance's uniform scale; `spec` the driver's rig.
   */
  constructor(instance: THREE.Object3D, rig: RigInfo, scale: number, private readonly spec: RigSpec) {
    instance.updateMatrixWorld(true);
    const I = spec.index, R = spec.rest;
    const srcRest = (name: string, out: THREE.Vector3): THREE.Vector3 => out.fromArray(R, I[name] * 3);
    const find = (name: string | undefined): THREE.Bone | null => (name ? (instance.getObjectByName(name) as THREE.Bone | undefined) ?? null : null);

    const add = (role: string, bone: THREE.Bone, src: number, parent: number, spineT = -1): number => {
      const restPos = new THREE.Vector3(), restQ = new THREE.Quaternion();
      bone.matrixWorld.decompose(restPos, restQ, _c);
      const n: Node = {
        role, bone, src, spineT, parent, restPos, restInv: restQ.clone().invert(), restMatInv: bone.matrixWorld.clone().invert(), cr: restQ.clone(),
        off: parent >= 0 ? restPos.clone().sub(this.nodes[parent].restPos) : new THREE.Vector3(),
        w: restQ.clone(), d: new THREE.Quaternion(), p: restPos.clone(),
      };
      this.index[role] = this.nodes.length;
      this.nodes.push(n);
      return this.nodes.length - 1;
    };
    const limb = (role: LimbRole, parent: number): number => {
      const b = find(rig.names[role]);
      return b ? add(role, b, I[role], parent) : -1;
    };

    const hips = limb('hips', -1);
    const hipsBone = this.nodes[hips].bone;
    if (hipsBone.parent) {
      hipsBone.parent.matrixWorld.decompose(_a, this.parentQ, _c);
      this.parentInv.copy(hipsBone.parent.matrixWorld).invert();
    }
    let top = hips;
    rig.spine.forEach((name, k) => {
      const b = find(name);
      if (b) top = add('spine' + k, b, -1, top, rig.spine.length === 1 ? 1 : k / (rig.spine.length - 1));
    });
    this.chestRole = this.nodes[top].role;
    this.waistRole = this.nodes[Math.min(1, this.nodes.length - 1)].role;
    const neck = limb('neck', top);
    limb('head', neck >= 0 ? neck : top);
    for (const s of ['L', 'R'] as const) {
      const clav = limb(`clav${s}`, top);
      const ua = limb(`uArm${s}`, clav >= 0 ? clav : top);
      const fa = limb(`fArm${s}`, ua);
      limb(`hand${s}`, fa);
      const th = limb(`thigh${s}`, hips);
      const sh = limb(`shin${s}`, th);
      const ft = limb(`foot${s}`, sh);
      limb(`toe${s}`, ft);
    }

    // ---- calibration ----------------------------------------------------------------------------------
    const dirCal = (role: string, child: string): void => {
      const n = this.node(role), c = this.node(child);
      if (!n || !c) return;
      _a.copy(c.restPos).sub(n.restPos).normalize();
      srcRest(child, _b).sub(srcRest(role, _c)).normalize();
      n.cr.setFromUnitVectors(_a, _b).multiply(n.restInv.clone().invert());
    };
    const hands = [rig.hands.L, rig.hands.R];
    this.gripOff = [new THREE.Vector3(), new THREE.Vector3()];
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? 'L' : 'R';
      dirCal(`clav${s}`, `uArm${s}`);
      dirCal(`uArm${s}`, `fArm${s}`);
      dirCal(`fArm${s}`, `hand${s}`);
      dirCal(`thigh${s}`, `shin${s}`);
      dirCal(`shin${s}`, `foot${s}`);
      const hand = this.node(`hand${s}`) as Node, fore = this.node(`fArm${s}`) as Node, info: HandInfo = hands[si];
      if (info.ok) {
        // measured palm frame → the driver's: fingers along its finger bone, palm toward the body
        srcRest(`fingA${s}`, _a).sub(srcRest(`hand${s}`, _b)).normalize();
        alignFrames(info.f, info.n, _a, _b.set(si === 0 ? 1 : -1, 0, 0), _q);
        hand.cr.copy(_q).multiply(hand.restInv.clone().invert());
      } else hand.cr.copy(fore.cr).multiply(fore.restInv).multiply(hand.restInv.clone().invert());
      this.gripOff[si].copy(info.grip).multiplyScalar(scale).sub(hand.restPos);
      // feet: heading only, so a flat driver foot is a flat target foot
      const foot = this.node(`foot${s}`) as Node, toe = this.node(`toe${s}`);
      if (toe) {
        _a.copy(toe.restPos).sub(foot.restPos); _a.y = 0;
        if (_a.lengthSq() > 1e-8) {
          _q.setFromAxisAngle(UP, Math.atan2(_a.x, -_a.z));
          foot.cr.copy(_q).multiply(foot.restInv.clone().invert());
          toe.cr.copy(_q).multiply(toe.restInv.clone().invert());
        }
      }
      // curl bones
      if (info.fingers) {
        const a = find(info.fingers[0]), b = find(info.fingers[1]);
        if (a && b) this.curl[si] = { a, b, axis: info.curlAxis.clone() };
      }
    }

    // ---- proportions ----------------------------------------------------------------------------------
    const len = (a: string, b: string): number => (this.node(b) as Node).restPos.distanceTo((this.node(a) as Node).restPos);
    const srcLen = (a: string, b: string): number => srcRest(a, _a).distanceTo(srcRest(b, _b));
    const tgtLeg = (len('thighL', 'shinL') + len('shinL', 'footL') + len('thighR', 'shinR') + len('shinR', 'footR')) / 2;
    const srcLeg = (srcLen('thighL', 'shinL') + srcLen('shinL', 'footL') + srcLen('thighR', 'shinR') + srcLen('shinR', 'footR')) / 2;
    this.driverScale = srcLeg > 1e-4 && tgtLeg > 1e-4 ? tgtLeg / srcLeg : 1;
    const ground = rig.groundY * scale;
    const tgtAnkle = ((this.node('footL') as Node).restPos.y + (this.node('footR') as Node).restPos.y) / 2 - ground;
    this.ankleLift = tgtAnkle - ((R[I.footL * 3 + 1] + R[I.footR * 3 + 1]) / 2) * this.driverScale;
    this.pelvisOff.copy((this.node('thighL') as Node).restPos).add((this.node('thighR') as Node).restPos).multiplyScalar(0.5).sub(this.nodes[hips].restPos);
    this.srcThigh = [I.thighL, I.thighR]; this.srcShin = [I.shinL, I.shinR]; this.srcFoot = [I.footL, I.footR];
    this.srcSpine = I.spine; this.srcChest = I.chest;
  }

  private node(role: string): Node | null {
    const i = this.index[role];
    return i === undefined ? null : this.nodes[i];
  }

  /** true when the skeleton has this role */
  has(role: string): boolean { return this.index[role] !== undefined; }

  /** Turn an offset given in the DRIVER's rest frame (root space) into the target's rest pose for `role`. */
  toRest(role: string, v: THREE.Vector3): THREE.Vector3 {
    const n = this.node(role);
    return n ? v.applyQuaternion(_q.copy(n.cr).multiply(n.restInv).invert()) : v;
  }

  /** Current root-space position of a role's joint (after pose()); `out` is returned untouched if unknown. */
  pos(role: string, out: THREE.Vector3): THREE.Vector3 {
    const n = this.node(role);
    return n ? out.copy(n.p) : out;
  }

  /** Rest-pose root-space position of a role's joint. */
  restPos(role: string, out: THREE.Vector3): THREE.Vector3 {
    const n = this.node(role);
    return n ? out.copy(n.restPos) : out;
  }

  /** Where a point given in the rest pose (root space) is now, carried rigidly by `role`. */
  carry(role: string, restPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const n = this.node(role);
    if (!n) return out.copy(restPoint);
    return out.copy(restPoint).sub(n.restPos).applyQuaternion(n.d).add(n.p);
  }

  /** Grip centre of a hand (0 = L, 1 = R) in root space. */
  grip(side: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.node(side === 0 ? 'handL' : 'handR') as Node;
    return out.copy(this.gripOff[side]).applyQuaternion(n.d).add(n.p);
  }

  /**
   * Parent `target` to `role`'s bone so that it sits at `restPoint` (root space, rest pose) and always has the
   * DRIVER bone's orientation and unit scale — the convention of every humanoid socket. False if the role is
   * missing.
   */
  attachSocket(role: string, restPoint: THREE.Vector3, target: THREE.Object3D): boolean {
    const n = this.node(role);
    if (!n) return false;
    // world rest matrix of the socket: rotation C⁻¹ (so that W·R⁻¹ = D·C turns it into D), unit scale
    _q.copy(n.cr).multiply(n.restInv).invert();
    _m.compose(restPoint, _q, _c.set(1, 1, 1)).premultiply(n.restMatInv);
    _m.decompose(target.position, target.quaternion, target.scale);
    n.bone.add(target);
    return true;
  }

  /**
   * Compute the target pose from the driver's solved pose (`wp` / `wq`: model-space joints, `scale`: the
   * driver model's uniform scale). Nothing is written to the bones until apply().
   */
  pose(wp: THREE.Vector3[], wq: THREE.Quaternion[], scale: number): void {
    const nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.src >= 0) _q.copy(wq[n.src]);
      else _q.copy(wq[this.srcSpine]).slerp(wq[this.srcChest], n.spineT);
      n.w.copy(_q).multiply(n.cr);
      n.d.copy(n.w).multiply(n.restInv);
    }
    // pelvis: the mid-point of the hip joints follows the driver's, lifted by the ankle difference
    const hips = nodes[0];
    _a.copy(wp[this.srcThigh[0]]).add(wp[this.srcThigh[1]]).multiplyScalar(0.5 * scale);
    _a.y += this.ankleLift;
    hips.p.copy(_a).sub(_b.copy(this.pelvisOff).applyQuaternion(hips.d));
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i], par = nodes[n.parent];
      n.p.copy(n.off).applyQuaternion(par.d).add(par.p);
    }
    // legs: ankles exactly where the driver planted them
    for (let s = 0; s < 2; s++) {
      const th = this.node(s === 0 ? 'thighL' : 'thighR') as Node, sh = this.node(s === 0 ? 'shinL' : 'shinR') as Node, ft = this.node(s === 0 ? 'footL' : 'footR') as Node;
      _t.copy(wp[this.srcFoot[s]]).multiplyScalar(scale).add(_b.set(0, this.ankleLift, 0).applyQuaternion(wq[this.srcFoot[s]]));
      _c.copy(wp[this.srcShin[s]]).multiplyScalar(scale); _c.y += this.ankleLift;
      this.twoBone(th, sh, ft, _t, _c);
      const toe = this.node(s === 0 ? 'toeL' : 'toeR');
      if (toe) toe.p.copy(toe.off).applyQuaternion(ft.d).add(ft.p);
    }
  }

  /** Re-aim a two-bone chain so `end` reaches `target` (clamped), bending toward `hint`. */
  private twoBone(up: Node, mid: Node, end: Node, target: THREE.Vector3, hint: THREE.Vector3): void {
    const l1 = mid.off.length(), l2 = end.off.length();
    solveJoint(up.p, target, l1, l2, hint, _knee, _end);
    _a.copy(mid.off).applyQuaternion(up.d).normalize();
    _b.copy(_knee).sub(up.p).normalize();
    _q.setFromUnitVectors(_a, _b);
    up.w.premultiply(_q); up.d.premultiply(_q);
    mid.p.copy(_knee);
    _a.copy(end.off).applyQuaternion(mid.d).normalize();
    _b.copy(_end).sub(_knee).normalize();
    _q.setFromUnitVectors(_a, _b);
    mid.w.premultiply(_q); mid.d.premultiply(_q);
    end.p.copy(_end);
  }

  /**
   * Pull a hand (0 = L, 1 = R) so its grip centre moves a fraction `weight` of the way to `target` (root
   * space). The hand keeps its orientation; the elbow keeps its side. Call between pose() and apply().
   */
  pullHand(side: number, target: THREE.Vector3, weight: number): void {
    if (!(weight > 1e-3)) return;
    const s = side === 0 ? 'L' : 'R';
    const ua = this.node(`uArm${s}`) as Node, fa = this.node(`fArm${s}`) as Node, ha = this.node(`hand${s}`) as Node;
    // wrist target = grip target − (grip − wrist)
    _t.copy(this.gripOff[side]).applyQuaternion(ha.d);
    _t.subVectors(target, _t);
    if (weight < 0.999) _t.lerp(ha.p, 1 - weight);
    _c.copy(fa.p);
    this.twoBone(ua, fa, ha, _t, _c);
  }

  /** Finger curl 0 (open, as modelled) .. 1 (fist). No-op for hands without curl bones. */
  setCurl(side: number, amount: number): void {
    const c = this.curl[side];
    if (!c) return;
    const k = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    c.a.quaternion.setFromAxisAngle(c.axis, k * 1.2);
    c.b.quaternion.setFromAxisAngle(c.axis, k * 1.4);
  }

  /** Write the pose to the skeleton (local rotations; the hips also get their position). */
  apply(): void {
    const nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      _q.copy(n.parent >= 0 ? nodes[n.parent].w : this.parentQ).invert();
      n.bone.quaternion.copy(_q).multiply(n.w);
    }
    nodes[0].bone.position.copy(nodes[0].p).applyMatrix4(this.parentInv);
  }
}
