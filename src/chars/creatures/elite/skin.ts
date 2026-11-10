/**
 * Elite skin — the generated hero mesh (meshy24 humanoid rig) worn over the elite's procedural animator.
 *
 * Every frame the driver's pose is retargeted in model space:
 *  - trunk, head and arms take the driver's world-space bone rotations (the driver's bones have identity rest
 *    rotation, so its model-space rotation IS its delta from bind) composed with an authored posture — the
 *    file binds upright in an A-pose; the imposed Eclipse hunch lives here;
 *  - legs are solved by IK to the driver's ankle positions, so feet plant, step and turn exactly as the
 *    driver's do; knees are kept off the floor;
 *  - a hand the driver has planted on the ground is planted here too: the generated arms are much shorter
 *    than the procedural club arm, so the body is lowered until they reach, then the arms are solved by IK.
 * The driver's sockets are re-parented onto the skin's bones, and the weak-point joint, eyes and chest core
 * are marked as bind-space regions for the state shader (core/shader.ts, CREATURE_SKIN).
 */
import * as THREE from 'three';
import { clamp, clamp01 } from '@/core/mathx';
import { aimQuat, solveTwoBone } from '../core/anim';
import { createSkinMaterial, type StateUniforms } from '../core/shader';
import { SkinInstance, type SkinTemplate } from '../core/skinlib';
import { EW } from './build';

/** driver hips bind position (model units) — the reference the driver's hips motion is measured from */
const HIPS_REST = EW.hips;

/** the slice of the driver the retarget reads */
export interface EliteDriver {
  hips: THREE.Bone; spine: THREE.Bone; chest: THREE.Bone; neck: THREE.Bone; head: THREE.Bone;
  shR: THREE.Bone; armR: THREE.Bone; foreR: THREE.Bone; shL: THREE.Bone; armL: THREE.Bone; foreL: THREE.Bone;
  legs: { limb: { end: THREE.Vector3 }; rest: THREE.Vector3; toe: number; plant: { phi: number; lift: number } }[];
  arms: { target: THREE.Vector3; w: number }[];
  fractureBlend: number;
  jointOpen: number;
  flare: number;
}

/** weak point in the skin's bind space (the file's left shoulder, mirrored onto the creature's RIGHT) */
const JOINT: readonly [number, number, number, number] = [0.62, 3.0, -0.02, 0.46];
const EYES: readonly (readonly [number, number, number, number])[] = [[0.062, 3.415, -0.165, 0.05], [-0.062, 3.415, -0.165, 0.05]];
const CORE: readonly [number, number, number, number] = [0, 2.66, -0.36, 0.32];

/**
 * The file is 3.6 m to the tips of its arch fragments standing bolt upright; hunched into the imposed posture it
 * would loom far less than the brief's ≈3.6 m organism, so the skin is worn a size up.
 */
export const ELITE_SKIN_SIZE = 1.16;

/** authored posture per bone: model-space XYZ euler (radians) composed over the bind pose */
const POSTURE: Readonly<Record<string, readonly [number, number, number]>> = {
  hips: [-0.14, 0, 0], spineA: [-0.3, 0, 0], spineB: [-0.48, 0, 0], spineC: [-0.64, 0, 0],
  neck: [-0.34, 0, 0.05], head: [-0.06, 0, 0.14],
  clavR: [-0.64, 0, -0.1], clavL: [-0.64, 0, 0.1],
  armR: [0.22, 0, 0.2], armL: [0.22, 0, -0.2],
  foreR: [0.72, 0, 0.1], foreL: [0.72, 0, -0.1],
  handR: [0.8, 0, 0], handL: [0.8, 0, 0],
};
const HIPS_DROP = 0.3, HIPS_BACK = 0.26, STANCE = 0.1, TOE_OUT = 0.2;
const HAND_FLOOR = 0.2, MIN_HIPS = 0.95;

interface SideRig {
  clav: number; arm: number; fore: number; hand: number; up: number; leg: number; foot: number;
  a1: number; a2: number; l1: number; l2: number;
  armDir: THREE.Vector3; foreDir: THREE.Vector3; handDir: THREE.Vector3; upDir: THREE.Vector3; legDir: THREE.Vector3;
  sign: number;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _knee = new THREE.Vector3(), _tgt = new THREE.Vector3(), _pole = new THREE.Vector3(), _hint = new THREE.Vector3();
const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _lat = new THREE.Vector3();
const _qd = Array.from({ length: 12 }, () => new THREE.Quaternion());

export class EliteSkin {
  readonly group: THREE.Group;
  readonly mesh: THREE.SkinnedMesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly inst: SkinInstance;
  private readonly bones: THREE.Bone[];
  /** posture ∘ bind, model space */
  private readonly base: THREE.Quaternion[];
  private readonly restLocalQ: THREE.Quaternion[];
  private readonly restLocalP: THREE.Vector3[];
  private readonly parent: number[];
  private readonly qm: THREE.Quaternion[];
  private readonly pm: THREE.Vector3[];
  /** bone index → slot in the per-frame driver quaternion table (−1 = follows its parent) */
  private readonly drive: Int8Array;
  private readonly sides: SideRig[];
  private readonly iHips: number;
  private readonly k: number;

  constructor(tpl: SkinTemplate, private readonly u: StateUniforms, sockets: Map<string, THREE.Object3D>) {
    this.material = createSkinMaterial(tpl.material, u);
    this.material.envMapIntensity = 0.7;
    this.inst = new SkinInstance(tpl, this.material);
    this.group = this.inst.group;
    this.mesh = this.inst.mesh;
    this.bones = this.inst.bones;
    const n = this.bones.length, I = (name: string): number => this.inst.index(name);
    const rp = this.inst.restPos, rq = this.inst.restQuat;
    this.k = tpl.height / 3.6;
    this.parent = tpl.bones.map((b) => b.parent);
    this.restLocalQ = this.bones.map((b) => b.quaternion.clone());
    this.restLocalP = this.bones.map((b) => b.position.clone());
    this.qm = this.bones.map(() => new THREE.Quaternion());
    this.pm = this.bones.map(() => new THREE.Vector3());
    this.drive = new Int8Array(n).fill(-1);
    this.base = rq.map((q) => q.clone());

    // the mirrored file's "Left" limbs sit on +X: resolve sides by where the bones actually are
    const pick = (stem: string, sign: number): number => {
      const a = I('Left' + stem), b = I('Right' + stem);
      if (a < 0 || b < 0) return Math.max(a, b);
      return (rp[a]!.x >= rp[b]!.x) === (sign > 0) ? a : b;
    };
    this.iHips = I('Hips');
    const side = (sign: number): SideRig => {
      const s: SideRig = {
        clav: pick('Shoulder', sign), arm: pick('Arm', sign), fore: pick('ForeArm', sign), hand: pick('Hand', sign),
        up: pick('UpLeg', sign), leg: pick('Leg', sign), foot: pick('Foot', sign),
        a1: 1, a2: 1, l1: 1, l2: 1, sign,
        armDir: new THREE.Vector3(), foreDir: new THREE.Vector3(), handDir: new THREE.Vector3(), upDir: new THREE.Vector3(), legDir: new THREE.Vector3(),
      };
      for (const i of [s.clav, s.arm, s.fore, s.hand, s.up, s.leg, s.foot]) if (i < 0) throw new Error('rig is not meshy24');
      s.a1 = s.armDir.subVectors(rp[s.fore]!, rp[s.arm]!).length(); s.armDir.normalize();
      s.a2 = s.foreDir.subVectors(rp[s.hand]!, rp[s.fore]!).length(); s.foreDir.normalize();
      s.handDir.copy(s.foreDir);
      s.l1 = s.upDir.subVectors(rp[s.leg]!, rp[s.up]!).length(); s.upDir.normalize();
      s.l2 = s.legDir.subVectors(rp[s.foot]!, rp[s.leg]!).length(); s.legDir.normalize();
      return s;
    };
    const R = side(1), L = side(-1);
    this.sides = [R, L];
    if (this.iHips < 0) throw new Error('rig is not meshy24');

    // driver table slots: 0 hips 1 spine 2 mid 3 chest 4 neck 5 head 6 shR 7 armR 8 foreR 9 shL 10 armL 11 foreL
    const map: [number, number, string][] = [
      [this.iHips, 0, 'hips'], [I('Spine02'), 1, 'spineA'], [I('Spine01'), 2, 'spineB'], [I('Spine'), 3, 'spineC'], [I('neck'), 4, 'neck'], [I('Head'), 5, 'head'],
      [R.clav, 6, 'clavR'], [R.arm, 7, 'armR'], [R.fore, 8, 'foreR'], [R.hand, 8, 'handR'],
      [L.clav, 9, 'clavL'], [L.arm, 10, 'armL'], [L.fore, 11, 'foreL'], [L.hand, 11, 'handL'],
    ];
    for (const [bone, slot, posture] of map) {
      if (bone < 0) continue;
      this.drive[bone] = slot;
      const po = POSTURE[posture];
      if (po) this.base[bone]!.copy(_q.setFromEuler(_e.set(po[0], po[1], po[2]))).multiply(rq[bone]!);
    }

    // shader regions + sockets (bind space of the skin)
    const k = this.k;
    u.uJoint.value.set(JOINT[0] * k, JOINT[1] * k, JOINT[2] * k, JOINT[3] * k);
    u.uEyeA.value.set(EYES[0]![0] * k, EYES[0]![1] * k, EYES[0]![2] * k, EYES[0]![3] * k);
    u.uEyeB.value.set(EYES[1]![0] * k, EYES[1]![1] * k, EYES[1]![2] * k, EYES[1]![3] * k);
    u.uCore.value.set(CORE[0] * k, CORE[1] * k, CORE[2] * k, CORE[3] * k);
    u.uFrostOrigin.value.set(JOINT[0] * k, JOINT[1] * k, JOINT[2] * k);
    u.uFrostRange.value = 3.4 * k;
    u.uVeinScale.value = 0.55;
    u.uSkin.value.set(1, 0.66, 0, 0);
    const iSpine = I('Spine'), iHead = I('Head');
    const seat = (name: string, bone: number, x: number, y: number, z: number): void => {
      const o = sockets.get(name);
      if (!o || bone < 0) return;
      const inv = _q.copy(rq[bone]!).invert();
      o.position.set(x * k, y * k, z * k).sub(rp[bone]!).applyQuaternion(inv);
      o.quaternion.copy(inv);
      this.bones[bone]!.add(o);
    };
    seat('joint', R.clav, JOINT[0], JOINT[1], JOINT[2] - 0.2);
    seat('core', iSpine, CORE[0], CORE[1], CORE[2] - 0.2);
    seat('chest', iSpine, 0, 2.8, -0.3);
    seat('back', iSpine, 0, 3.0, 0.5);
    seat('top', iSpine, 0, 3.78, 0.05);
    seat('head', iHead, 0, 3.38, -0.1);
    seat('eye', iHead, 0, 3.415, -0.2);
    seat('hips', this.iHips, rp[this.iHips]!.x / k, rp[this.iHips]!.y / k, rp[this.iHips]!.z / k);
    for (const s of this.sides) {
      const h = rp[s.hand]!, f = rp[s.fore]!, tag = s.sign > 0 ? 'R' : 'L';
      seat('hand' + tag, s.hand, (h.x + s.foreDir.x * 0.18) / k, (h.y + s.foreDir.y * 0.18) / k, (h.z + s.foreDir.z * 0.18) / k);
      if (s.sign > 0) {
        seat('weaponTip', s.hand, (h.x + s.foreDir.x * 0.5) / k, (h.y + s.foreDir.y * 0.5) / k, (h.z + s.foreDir.z * 0.5 - 0.1) / k);
        seat('weaponBase', s.fore, f.x / k, f.y / k, f.z / k);
        seat('weaponMid', s.fore, (f.x + h.x) / 2 / k, (f.y + h.y) / 2 / k, (f.z + h.z) / 2 / k);
      }
    }
  }

  /**
   * Retarget the driver's current pose.
   * @param ds     driver model units → metres
   * @param alive  1 alive … 0 dead (the posture's poise relaxes on a corpse)
   * @param lights 1 lit … 0 (violet seams fade with the death)
   */
  update(d: EliteDriver, ds: number, alive: number, lights: number): void {
    const { bones, qm, pm, parent, drive, base, restLocalQ, restLocalP } = this;
    const k = this.k;
    // ---- driver rotations in model space (its bones bind with identity rotation: local chain = delta)
    const Q = _qd;
    Q[0]!.copy(d.hips.quaternion);
    Q[1]!.copy(Q[0]!).multiply(d.spine.quaternion);
    Q[3]!.copy(Q[1]!).multiply(d.chest.quaternion);
    Q[2]!.copy(Q[1]!).slerp(Q[3]!, 0.5);
    Q[4]!.copy(Q[3]!).multiply(d.neck.quaternion);
    Q[5]!.copy(Q[4]!).multiply(d.head.quaternion);
    Q[6]!.copy(Q[3]!).multiply(d.shR.quaternion);
    Q[7]!.copy(Q[6]!).multiply(d.armR.quaternion);
    Q[8]!.copy(Q[7]!).multiply(d.foreR.quaternion);
    Q[9]!.copy(Q[3]!).multiply(d.shL.quaternion);
    Q[10]!.copy(Q[9]!).multiply(d.armL.quaternion);
    Q[11]!.copy(Q[10]!).multiply(d.foreL.quaternion);

    // ---- FK pass: model-space orientation + position of every bone
    const hipsRest = this.inst.restPos[this.iHips]!;
    for (let i = 0; i < bones.length; i++) {
      const p = parent[i]!, slot = drive[i]!;
      if (slot >= 0) qm[i]!.copy(Q[slot]!).multiply(base[i]!);
      else if (p >= 0) qm[i]!.copy(qm[p]!).multiply(restLocalQ[i]!);
      else qm[i]!.copy(restLocalQ[i]!);
      if (i === this.iHips) {
        pm[i]!.set(
          hipsRest.x + (d.hips.position.x - HIPS_REST[0]) * ds,
          hipsRest.y + (d.hips.position.y - HIPS_REST[1]) * ds - HIPS_DROP * k * (0.6 + 0.4 * alive),
          hipsRest.z + (d.hips.position.z - HIPS_REST[2]) * ds + HIPS_BACK * k,
        );
      } else if (p >= 0) pm[i]!.copy(restLocalP[i]!).applyQuaternion(qm[p]!).add(pm[p]!);
      else pm[i]!.copy(restLocalP[i]!);
    }

    // ---- planted hands: lower the body until the (short) arms can reach the floor
    let drop = 0;
    for (let s = 0; s < 2; s++) {
      const w = clamp01(d.arms[s]!.w);
      if (w <= 0.001) continue;
      const sd = this.sides[s]!;
      this.handTarget(d, s, ds, _tgt);
      const need = _tgt.distanceTo(pm[sd.arm]!) - (sd.a1 + sd.a2) * 0.97;
      if (need * w > drop) drop = need * w;
    }
    if (drop > 0) {
      drop = Math.min(drop, Math.max(0, pm[this.iHips]!.y - MIN_HIPS * k));
      for (let i = 0; i < bones.length; i++) { pm[i]!.y -= drop; pm[i]!.z -= drop * 0.3; }
    }

    // ---- legs: IK to the driver's ankles
    for (let s = 0; s < 2; s++) {
      const sd = this.sides[s]!, leg = d.legs[s]!;
      const ar = this.inst.restPos[sd.foot]!;
      _tgt.set(
        ar.x + sd.sign * STANCE * k + (leg.limb.end.x - leg.rest.x) * ds,
        ar.y + Math.max(0, leg.limb.end.y - leg.rest.y) * ds,
        ar.z + (leg.limb.end.z - leg.rest.z) * ds,
      );
      const c = Math.cos(leg.plant.phi), sn = Math.sin(leg.plant.phi);
      _pole.set(sd.sign * 0.3, 0.1, -1);
      _pole.set(_pole.x * c + _pole.z * sn, _pole.y, -_pole.x * sn + _pole.z * c);
      _hint.set(sd.sign * 0.3, 0.1, -1);
      solveTwoBone(pm[sd.up]!, _tgt, sd.l1, sd.l2, _pole, _knee);
      if (_knee.y < 0.32 * k) {
        _pole.y += 0.7 + (0.32 * k - _knee.y) * 4;
        solveTwoBone(pm[sd.up]!, _tgt, sd.l1, sd.l2, _pole, _knee);
      }
      qm[sd.up]!.copy(aimQuat(_q, sd.upDir, _hint, _dir.subVectors(_knee, pm[sd.up]!), _pole)).multiply(this.inst.restQuat[sd.up]!);
      qm[sd.leg]!.copy(aimQuat(_q, sd.legDir, _hint, _dir.subVectors(_tgt, _knee), _pole)).multiply(this.inst.restQuat[sd.leg]!);
      // foot stays level; it carries the yaw it was planted with, a little toe-out, and the swing's toe roll
      _e.set(leg.toe * 0.7 - leg.plant.lift * 0.25, leg.plant.phi + sd.sign * -TOE_OUT, 0, 'YXZ');
      qm[sd.foot]!.setFromEuler(_e).multiply(this.inst.restQuat[sd.foot]!);
      pm[sd.leg]!.copy(_knee);
      pm[sd.foot]!.copy(_tgt);
    }

    // ---- arms: IK for planted hands, blended over the retargeted swing
    for (let s = 0; s < 2; s++) {
      const w = clamp01(d.arms[s]!.w);
      if (w <= 0.001) continue;
      const sd = this.sides[s]!;
      this.handTarget(d, s, ds, _tgt);
      _pole.set(sd.sign * 0.8, 0.25, 0.8);
      solveTwoBone(pm[sd.arm]!, _tgt, sd.a1, sd.a2, _pole, _knee);
      _q2.copy(aimQuat(_q, sd.armDir, _pole, _dir.subVectors(_knee, pm[sd.arm]!), _pole)).multiply(this.inst.restQuat[sd.arm]!);
      qm[sd.arm]!.slerp(_q2, w);
      _q2.copy(aimQuat(_q, sd.foreDir, _pole, _dir.subVectors(_tgt, _knee), _pole)).multiply(this.inst.restQuat[sd.fore]!);
      qm[sd.fore]!.slerp(_q2, w);
      // the hand lies on the floor: fingers forward, back of the hand up
      _lat.set(sd.sign, 0, 0);
      _q2.copy(aimQuat(_q, sd.handDir, _lat, _dir.set(sd.sign * 0.12, -0.1, -1), _up)).multiply(this.inst.restQuat[sd.hand]!);
      qm[sd.hand]!.slerp(_q2, w);
    }

    // ---- write locals (parents precede children)
    for (let i = 0; i < bones.length; i++) {
      const p = parent[i]!, b = bones[i]!;
      if (p >= 0) b.quaternion.copy(_q.copy(qm[p]!).invert()).multiply(qm[i]!);
      else b.quaternion.copy(qm[i]!);
    }
    bones[this.iHips]!.position.copy(pm[this.iHips]!);

    // ---- presentation
    const us = this.u.uSkin.value;
    us.x = 1.15 * lights;
    us.z = d.jointOpen * 0.05 * k;
    us.w = d.fractureBlend;
    this.u.uHot.value.set(1.0, 0.62, 0.4, clamp(d.jointOpen * 0.35, 0, 1));
  }

  /** where a planted hand of the driver lands for this (smaller-armed) body, model space */
  private handTarget(d: EliteDriver, s: number, ds: number, out: THREE.Vector3): THREE.Vector3 {
    const t = d.arms[s]!.target;
    return out.set(t.x * ds * 0.8, HAND_FLOOR * this.k, t.z * ds * 0.72);
  }

  dispose(): void {
    this.inst.dispose();
  }
}
