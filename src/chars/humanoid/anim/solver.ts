/**
 * BodySolver — turns a blended Pose (+ additive torso motion) into bone rotations:
 * torso FK → arm FK/IK blend → two-handed grip → leg IK → fingers/toes/pauldrons.
 * Works entirely in model space on preallocated temporaries.
 */
import * as THREE from 'three';
import type { RigSpec } from '../rig';
import { FK, type Pose } from './pose';
import { alignPair, makeTwoBoneRest, solveTwoBone, type TwoBoneRest } from './ik';

/** Additive motion layered on top of the blended pose (look-at, aim pitch, hit reactions, breathing). */
export class Additive {
  readonly hip = new THREE.Vector3();
  readonly hips = new THREE.Quaternion();
  readonly spine = new THREE.Quaternion();
  readonly chest = new THREE.Quaternion();
  readonly neck = new THREE.Quaternion();
  readonly head = new THREE.Quaternion();
  /** chest-space offset applied to chest-following hand targets (recoil) */
  readonly handKick = new THREE.Vector3();
  reset(): void {
    this.hip.set(0, 0, 0);
    this.hips.identity(); this.spine.identity(); this.chest.identity(); this.neck.identity(); this.head.identity();
    this.handKick.set(0, 0, 0);
  }
}

export interface SolveOpts {
  /** [L,R] hand holds equipment → fingers close fully */
  heldL: boolean;
  heldR: boolean;
  /** secondary grip point of the right-hand item, in right-hand space relative to the palm (null = none) */
  grip2: THREE.Vector3 | null;
  /** off-hand rotation relative to the right hand */
  grip2Rot: THREE.Quaternion | null;
  /** [L,R] model-space palm pins (console holds, lifting, hand-overs) */
  pins: Array<{ pos: THREE.Vector3; w: number } | null> | null;
  /** barrel axis of the drawn ranged weapon in right-hand space (null = none); the aim loop measures it */
  barrel: THREE.Vector3 | null;
  /** points on the right-hand item, in right-hand space, that must stay above the floor (blade tips) */
  tips: THREE.Vector3[] | null;
  /**
   * Ring grip (Verity): axis of the double blade in right-hand space. The fist sits inside the hilt ring, so the
   * blade line stays within RING_SLACK of perpendicular to the forearm — the rear blade can never run back
   * along the arm that holds it. null = ordinary grip.
   */
  ring: THREE.Vector3 | null;
}

const V = (): THREE.Vector3 => new THREE.Vector3();
const Q = (): THREE.Quaternion => new THREE.Quaternion();

const _q = Q(), _q2 = Q(), _qa = Q(), _qb = Q(), _qh = Q(), _delta = Q(), _inv = Q(), _gq = Q();
const _v = V(), _v2 = V(), _t = V(), _pole = V(), _end = V(), _c0 = V(), _c1 = V(), _g = V();
const _fe = V(), _fw = V(), _fp = V(), _ft = V(), _fk = V(), _fq = Q();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const IDENT = new THREE.Quaternion();
/** ring grip: largest |cos| between the blade line and the forearm (≈ 20° of wrist play) */
const RING_SLACK = 0.34;
/** the floor is the plane y = 0 of model space: lowest a palm / a blade tip may go */
const FLOOR_HAND = 0.03, FLOOR_TIP = 0.015;
/** ankle → ball of the foot (the toe joint, 3 cm above the sole), heel bottom, toe tip from the ball */
const BALL = new THREE.Vector3(0, -0.055, -0.143), HEEL = new THREE.Vector3(0, -0.085, 0.06), TOE_TIP = new THREE.Vector3(0, -0.028, -0.085);

export class BodySolver {
  private readonly idx: Record<string, number>;
  private readonly off: THREE.Vector3[] = [];
  /** model-space joint positions / rotations, indexed like the rig */
  readonly wp: THREE.Vector3[] = [];
  readonly wq: THREE.Quaternion[] = [];
  private readonly arm: [TwoBoneRest, TwoBoneRest];
  private readonly leg: [TwoBoneRest, TwoBoneRest];
  /** palm (grip) point in hand space [L,R] */
  readonly palm: [THREE.Vector3, THREE.Vector3];
  /** current finger curl [L,R] 0..1 (smoothed by the animator) */
  readonly curl = new Float32Array([0.3, 0.3]);
  private readonly restHips: THREE.Vector3;
  readonly bodyCount: number;
  /** radius of the pelvis / ribcage including armour: neither sinks into the floor when the figure lies down */
  torsoRadius = 0.13;
  /** bones apply() writes, in hierarchy order */
  private readonly body: number[];
  /** chest transform before additives (for follow hands) */
  private readonly chest0p = V();
  private readonly chest0q = Q();
  /** scratch per-arm results */
  private readonly ua = Q(); private readonly fa = Q(); private readonly ha = Q();
  /** chest-space orientation of a pinned (reaching) hand: fingers forward, palm down */
  private readonly pinRot: [THREE.Quaternion, THREE.Quaternion] = [
    alignPair(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -0.25, -1), new THREE.Vector3(0, -1, 0), Q()),
    alignPair(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -0.25, -1), new THREE.Vector3(0, -1, 0), Q()),
  ];

  constructor(readonly spec: RigSpec) {
    this.idx = spec.index;
    const n = spec.names.length;
    for (let i = 0; i < n; i++) {
      const p = spec.parent[i];
      const o = new THREE.Vector3(spec.rest[i * 3], spec.rest[i * 3 + 1], spec.rest[i * 3 + 2]);
      if (p >= 0) o.sub(_v.set(spec.rest[p * 3], spec.rest[p * 3 + 1], spec.rest[p * 3 + 2]));
      this.off.push(o);
      this.wp.push(new THREE.Vector3(spec.rest[i * 3], spec.rest[i * 3 + 1], spec.rest[i * 3 + 2]));
      this.wq.push(new THREE.Quaternion());
    }
    this.bodyCount = n;
    const I = this.idx;
    this.restHips = this.off[I.hips].clone();
    const back = new THREE.Vector3(0, 0, 1), fwd = new THREE.Vector3(0, 0, -1);
    this.arm = [
      makeTwoBoneRest(this.off[I.fArmL], this.off[I.handL], back),
      makeTwoBoneRest(this.off[I.fArmR], this.off[I.handR], back),
    ];
    this.leg = [
      makeTwoBoneRest(this.off[I.shinL], this.off[I.footL], fwd),
      makeTwoBoneRest(this.off[I.shinR], this.off[I.footR], fwd),
    ];
    this.palm = [this.off[I.prop].clone(), this.off[I.weapon].clone()];
    this.body = [I.hips, I.spine, I.chest, I.neck, I.head, I.clavL, I.uArmL, I.fArmL, I.handL, I.clavR, I.uArmR, I.fArmR, I.handR,
      I.thighL, I.shinL, I.footL, I.toeL, I.thighR, I.shinR, I.footR, I.toeR];
  }

  private fk(child: number, parent: number, local: THREE.Quaternion): void {
    this.wp[child].copy(this.off[child]).applyQuaternion(this.wq[parent]).add(this.wp[parent]);
    this.wq[child].copy(this.wq[parent]).multiply(local);
  }

  private torso(pose: Pose, add: Additive | null): void {
    const I = this.idx, q = pose.q;
    this.wp[I.hips].copy(this.restHips).add(_v.set(pose.hip[0], pose.hip[1], pose.hip[2]));
    this.wq[I.hips].fromArray(q, FK.hips * 4);
    if (add) { this.wp[I.hips].add(add.hip); this.wq[I.hips].multiply(add.hips); }
    _q.fromArray(q, FK.spine * 4); if (add) _q.multiply(add.spine);
    this.fk(I.spine, I.hips, _q);
    _q.fromArray(q, FK.chest * 4); if (add) _q.multiply(add.chest);
    this.fk(I.chest, I.spine, _q);
    // lying poses: lift the whole torso until pelvis and ribcage rest on the floor instead of in it
    const low = Math.min(this.wp[I.hips].y, this.wp[I.chest].y) - this.torsoRadius;
    if (low < 0) { this.wp[I.hips].y -= low; this.wp[I.spine].y -= low; this.wp[I.chest].y -= low; }
  }

  /**
   * Solve the full body. After this call `wp`/`wq` hold model-space transforms for every body bone;
   * call apply() to write them to the skeleton.
   */
  solve(pose: Pose, add: Additive | null, opts: SolveOpts): void {
    const I = this.idx, q = pose.q;
    this.wp[I.root].set(0, 0, 0); this.wq[I.root].identity();

    // torso without additives → reference chest frame for following hand targets
    this.torso(pose, null);
    this.chest0p.copy(this.wp[I.chest]); this.chest0q.copy(this.wq[I.chest]);
    if (add) this.torso(pose, add);
    // delta = chest1 * chest0^-1
    _inv.copy(this.chest0q).invert();
    _delta.copy(this.wq[I.chest]).multiply(_inv);
    _c0.copy(this.chest0p); _c1.copy(this.wp[I.chest]);

    _q.fromArray(q, FK.neck * 4); if (add) _q.multiply(add.neck);
    this.fk(I.neck, I.chest, _q);
    _q.fromArray(q, FK.head * 4); if (add) _q.multiply(add.head);
    this.fk(I.head, I.neck, _q);

    // right arm first (the left may ride its weapon)
    const pinR = opts.pins ? opts.pins[1] : null, pinL = opts.pins ? opts.pins[0] : null;
    this.solveArm(pose, 1, add, null, null, 0, pinR, opts.tips, opts.ring);
    if (pose.grip > 1e-3 && opts.grip2) {
      const hr = I.handR;
      _g.copy(this.palm[1]).add(opts.grip2).applyQuaternion(this.wq[hr]).add(this.wp[hr]);
      _gq.copy(this.wq[hr]);
      if (opts.grip2Rot) _gq.multiply(opts.grip2Rot);
      this.solveArm(pose, 0, add, _g, _gq, pose.grip, pinL, null, null);
    } else this.solveArm(pose, 0, add, null, null, 0, pinL, null, null);

    this.solveLeg(pose, 0);
    this.solveLeg(pose, 1);

    // fingers
    for (let s = 0; s < 2; s++) {
      const held = s === 0 ? opts.heldL : opts.heldR;
      const want = held ? 1 : pose.fist[s];
      this.curl[s] = want;
    }
  }

  private solveArm(pose: Pose, s: number, add: Additive | null, gripPos: THREE.Vector3 | null, gripRot: THREE.Quaternion | null, gripW: number, pin: { pos: THREE.Vector3; w: number } | null, tips: THREE.Vector3[] | null, ring: THREE.Vector3 | null): void {
    const I = this.idx, q = pose.q;
    const L = s === 0;
    const clav = L ? I.clavL : I.clavR, ua = L ? I.uArmL : I.uArmR, fa = L ? I.fArmL : I.fArmR, ha = L ? I.handL : I.handR;
    const fkc = L ? FK.clavL : FK.clavR, fku = L ? FK.uArmL : FK.uArmR, fkf = L ? FK.fArmL : FK.fArmR, fkh = L ? FK.handL : FK.handR;
    const chest = I.chest;
    _q.fromArray(q, fkc * 4);
    this.fk(clav, chest, _q);
    this.wp[ua].copy(this.off[ua]).applyQuaternion(this.wq[clav]).add(this.wp[clav]);
    // FK world rotations
    _q.fromArray(q, fku * 4); this.ua.copy(this.wq[clav]).multiply(_q);
    _q.fromArray(q, fkf * 4); this.fa.copy(this.ua).multiply(_q);
    _q.fromArray(q, fkh * 4); this.ha.copy(this.fa).multiply(_q);

    const rest = this.arm[s];
    const w = pose.armIk[s];
    if (w > 1e-3) {
      const k = s * 7;
      _t.set(pose.hand[k], pose.hand[k + 1], pose.hand[k + 2]);
      _qh.set(pose.hand[k + 3], pose.hand[k + 4], pose.hand[k + 5], pose.hand[k + 6]);
      _pole.set(pose.elbow[s * 3], pose.elbow[s * 3 + 1], pose.elbow[s * 3 + 2]);
      const f = pose.follow[s];
      if (f > 1e-3 && add) {
        // ride the additive chest motion: p' = c1 + delta * (p - c0) (+ recoil kick in chest space)
        _v.copy(_t).sub(_c0).applyQuaternion(_delta).add(_c1);
        _v2.copy(add.handKick).applyQuaternion(this.wq[chest]);
        _v.add(_v2);
        _t.lerp(_v, f);
        _q2.copy(_delta).multiply(_qh);
        _qh.slerp(_q2, f);
        _pole.applyQuaternion(_q2.copy(IDENT).slerp(_delta, f));
      }
      this.ikArm(s, rest, ua, _t, _qh, _pole, w);
    }
    if (gripPos && gripRot && gripW > 1e-3) {
      _pole.set(-0.35, -0.75, 0.35).applyQuaternion(this.wq[chest]);
      this.ikArm(s, rest, ua, gripPos, gripRot, _pole, gripW);
    }
    if (pin && pin.w > 1e-3) {
      // keep the current hand orientation if it is already IK-driven, otherwise a neutral reaching hand
      if (w > 0.5) _qh.copy(this.ha);
      else _qh.copy(this.wq[chest]).multiply(this.pinRot[s]);
      _pole.set(L ? -0.5 : 0.5, -0.7, 0.35).applyQuaternion(this.wq[chest]);
      this.ikArm(s, rest, ua, pin.pos, _qh, _pole, pin.w);
    }
    if (ring) this.ringGrip(s, rest, ua, fa, ha, ring);
    this.floorArm(s, rest, ua, fa, ha, gripW > 0.5 ? null : tips, gripW > 0.5);
    this.wq[ua].copy(this.ua);
    this.wp[fa].copy(this.off[fa]).applyQuaternion(this.ua).add(this.wp[ua]);
    this.wq[fa].copy(this.fa);
    this.wp[ha].copy(this.off[ha]).applyQuaternion(this.fa).add(this.wp[fa]);
    this.wq[ha].copy(this.ha);
  }

  /** Blend this.ua/fa/ha toward the IK solution for palm target `palmT` with hand rotation `rot`. */
  private ikArm(s: number, rest: TwoBoneRest, ua: number, palmT: THREE.Vector3, rot: THREE.Quaternion, pole: THREE.Vector3, w: number): void {
    // wrist = palm − rot * palmOffset
    _v.copy(this.palm[s]).applyQuaternion(rot);
    _end.copy(palmT).sub(_v);
    if (pole.lengthSq() < 1e-6) pole.set(s === 0 ? -0.5 : 0.5, -0.7, 0.4);
    solveTwoBone(rest, this.wp[ua], _end, pole, _qa, _qb);
    if (w >= 0.999) { this.ua.copy(_qa); this.fa.copy(_qb); this.ha.copy(rot); }
    else { this.ua.slerp(_qa, w); this.fa.slerp(_qb, w); this.ha.slerp(rot, w); }
  }

  /** wrist (→ _fw) and palm (→ _fp) of the arm as currently solved; _fe = elbow */
  private armPoints(s: number, ua: number, fa: number, ha: number): void {
    _fe.copy(this.off[fa]).applyQuaternion(this.ua).add(this.wp[ua]);
    _fw.copy(this.off[ha]).applyQuaternion(this.fa).add(_fe);
    _fp.copy(this.palm[s]).applyQuaternion(this.ha).add(_fw);
  }

  /**
   * Ring grip (see SolveOpts.ring): keep the blade line near perpendicular to the forearm, and turn the hand
   * about the blade line until the forearm passes straight through the ring — whatever the pose authored.
   */
  private ringGrip(s: number, rest: TwoBoneRest, ua: number, fa: number, ha: number, axis: THREE.Vector3): void {
    for (let pass = 0; pass < 3; pass++) {
      this.armPoints(s, ua, fa, ha);
      _ft.copy(_fw).sub(_fe).normalize();
      _fk.copy(axis).applyQuaternion(this.ha);
      _fq.copy(this.ha);
      let moved = false;
      const c = _fk.dot(_ft);
      if (Math.abs(c) > RING_SLACK) {
        const cur = Math.acos(Math.max(-1, Math.min(1, c)));
        const want = c > 0 ? Math.acos(RING_SLACK) : Math.PI - Math.acos(RING_SLACK);
        // swing the blade line away from the forearm in their common plane
        _v.crossVectors(_ft, _fk);
        if (_v.lengthSq() < 1e-8) _v.set(1, 0, 0).applyQuaternion(this.ha);
        _q.setFromAxisAngle(_v.normalize(), want - cur);
        _fq.premultiply(_q);
        _fk.applyQuaternion(_q);
        moved = true;
      }
      // twist about the blade line: fingers (hand −Y) continue the forearm
      _v.set(0, -1, 0).applyQuaternion(_fq).addScaledVector(_fk, -_v.dot(_fk));
      _v2.copy(_ft).addScaledVector(_fk, -_ft.dot(_fk));
      if (_v.lengthSq() > 1e-6 && _v2.lengthSq() > 1e-6) {
        _v.normalize(); _v2.normalize();
        const tw = Math.atan2(_end.crossVectors(_v, _v2).dot(_fk), _v.dot(_v2));
        if (Math.abs(tw) > 0.02) { _fq.premultiply(_q.setFromAxisAngle(_fk, tw)); moved = true; }
      }
      if (!moved) return;
      _pole.copy(_fe).sub(this.wp[ua]);
      this.ikArm(s, rest, ua, _fp, _fq, _pole, 1);
    }
  }

  /**
   * Ground constraint: a palm never sinks below the floor, and neither does a point of the held weapon — a steep
   * blade lifts the hand, a shallow one pitches up about the grip (the stroke stops ON the stone, not in it).
   */
  private floorArm(s: number, rest: TwoBoneRest, ua: number, fa: number, ha: number, tips: THREE.Vector3[] | null, riding: boolean): void {
    this.armPoints(s, ua, fa, ha);
    if (_fp.y < FLOOR_HAND && !riding) {
      _fp.y = FLOOR_HAND;
      _pole.copy(_fe).sub(this.wp[ua]);
      this.ikArm(s, rest, ua, _fp, _fq.copy(this.ha), _pole, 1);
    }
    if (!tips) return;
    for (let pass = 0; pass < 2; pass++) {
      for (const tip of tips) {
        this.armPoints(s, ua, fa, ha);
        _ft.copy(tip).applyQuaternion(this.ha).add(_fw);
        const deficit = FLOOR_TIP - _ft.y;
        if (deficit <= 1e-5) continue;
        _ft.sub(_fp);
        const L = _ft.length();
        if (L < 1e-4) continue;
        const steep = Math.min(1, Math.max(0, (-_ft.y / L - 0.8) / 0.15));
        const pitchUp = deficit * (1 - steep);
        _fq.copy(this.ha);
        if (pitchUp > 1e-5) {
          _fk.crossVectors(_ft, Y_AXIS);
          if (_fk.lengthSq() > 1e-10) {
            const e0 = Math.asin(Math.max(-1, Math.min(1, _ft.y / L))), e1 = Math.asin(Math.max(-1, Math.min(1, (_ft.y + pitchUp) / L)));
            _fq.setFromAxisAngle(_fk.normalize(), e1 - e0).multiply(this.ha);
          }
        }
        _fp.y += deficit * steep;
        _pole.copy(_fe).sub(this.wp[ua]);
        this.ikArm(s, rest, ua, _fp, _fq, _pole, 1);
      }
    }
  }

  private solveLeg(pose: Pose, s: number): void {
    const I = this.idx;
    const L = s === 0;
    const th = L ? I.thighL : I.thighR, sh = L ? I.shinL : I.shinR, ft = L ? I.footL : I.footR, toe = L ? I.toeL : I.toeR;
    const hips = I.hips;
    this.wp[th].copy(this.off[th]).applyQuaternion(this.wq[hips]).add(this.wp[hips]);
    const k = s * 7;
    _t.set(pose.foot[k], pose.foot[k + 1], pose.foot[k + 2]);
    // no part of the foot goes through the floor, whatever the pose asked for
    _q.set(pose.foot[k + 3], pose.foot[k + 4], pose.foot[k + 5], pose.foot[k + 6]);
    _v.copy(BALL).applyQuaternion(_q);
    _q2.setFromAxisAngle(X_AXIS, pose.toe[s]).premultiply(_q);
    _v2.copy(TOE_TIP).applyQuaternion(_q2);
    const low = Math.min(_t.y + _v.y - 0.03, _t.y + _v.y + _v2.y, _t.y + _g.copy(HEEL).applyQuaternion(_q).y);
    if (low < 0) _t.y -= low;
    _pole.set(pose.knee[s * 3], pose.knee[s * 3 + 1], pose.knee[s * 3 + 2]);
    if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, -1);
    solveTwoBone(this.leg[s], this.wp[th], _t, _pole, _qa, _qb, _end);
    this.wq[th].copy(_qa);
    this.wp[sh].copy(this.off[sh]).applyQuaternion(_qa).add(this.wp[th]);
    this.wq[sh].copy(_qb);
    this.wp[ft].copy(this.off[ft]).applyQuaternion(_qb).add(this.wp[sh]);
    this.wq[ft].set(pose.foot[k + 3], pose.foot[k + 4], pose.foot[k + 5], pose.foot[k + 6]);
    _q.setFromAxisAngle(X_AXIS, pose.toe[s]);
    this.fk(toe, ft, _q);
  }

  /** Write the solved transforms into the live skeleton (local rotations; hips also get position). */
  apply(bones: THREE.Bone[]): void {
    const I = this.idx, P = this.spec.parent, body = this.body;
    for (let n = 0; n < body.length; n++) {
      const i = body[n], p = P[i];
      _inv.copy(this.wq[p]).invert();
      bones[i].quaternion.copy(_inv).multiply(this.wq[i]);
    }
    bones[I.hips].position.copy(this.wp[I.hips]);
    // pauldrons take a fraction of the upper-arm motion so plates ride the shoulder without clipping
    bones[I.paulL].quaternion.copy(IDENT).slerp(bones[I.uArmL].quaternion, 0.42);
    bones[I.paulR].quaternion.copy(IDENT).slerp(bones[I.uArmR].quaternion, 0.42);
    // finger curl about the grip axis
    for (let s = 0; s < 2; s++) {
      const c = this.curl[s];
      const sign = s === 0 ? 1 : -1;
      _q.setFromAxisAngle(Z_AXIS, sign * c * 1.35);
      bones[s === 0 ? I.fingAL : I.fingAR].quaternion.copy(_q);
      _q.setFromAxisAngle(Z_AXIS, sign * c * 1.5);
      bones[s === 0 ? I.fingBL : I.fingBR].quaternion.copy(_q);
    }
  }
}
