/**
 * DeviceBase — shared behaviour of the encounter devices: a smoothed powered-down state (`setDisabled`),
 * a hit wobble spring on the mast, and a deterministic break-apart for 'death'.
 *
 * Break-apart: every registered chunk (a bone with everything it carries) is released from wherever the live
 * pose left it and flies ballistically in MODEL space — the frame in which "down" really is down, whatever its
 * parent bone is doing. Each chunk is an oriented box (the bind bounds of its geometry); its centre can never
 * come closer to the floor than the box's current vertical half-extent, so wreckage cannot float or sink, and it
 * settles lying on its flattest side. The motion is a pure function of the action time (no persistent
 * integration), so it is identical at any frame rate.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { DeviceVisual } from '@/core/api/creatures';
import { clamp01, damp } from '@/core/mathx';
import { CreatureBase, type ActionDef, type CreatureSpec, type Slot } from '../core/base';

export const DEVICE_ACTIONS: Record<string, ActionDef> = {
  idle: { dur: 2, loop: true },
  hitLight: { dur: 0.45, fade: 0.02, react: true, ignoreFreeze: true },
  hitHeavy: { dur: 0.7, fade: 0.02, react: true, ignoreFreeze: true },
  stagger: { dur: 1.4, fade: 0.05, out: 0.3 },
  disabled: { dur: 1.2, hold: true, fade: 0.1 },
  death: { dur: 2.2, hold: true, fade: 0.02, ignoreFreeze: true, thaw: true, events: [[0.55, 'impact']] },
  generic: { dur: 0.5, react: true, ignoreFreeze: true },
};

export const DEVICE_ALIASES: Record<string, string> = {
  hover: 'idle', frozen: 'idle', linkedSync: 'idle', guardHit: 'hitLight', guardBreak: 'stagger', knockdown: 'stagger', disable: 'disabled', interact: 'hitLight',
};

interface Chunk {
  bone: THREE.Bone;
  /** box centre relative to the bone pivot (model axes at bind), box orientation at bind, half extents in box axes */
  c: THREE.Vector3;
  rb: THREE.Quaternion;
  h: THREE.Vector3;
  /** index of the thinnest axis: the side the chunk comes to rest on */
  thin: 0 | 1 | 2;
  /** launch velocity (model space, m/s) and spin */
  v: THREE.Vector3;
  axis: THREE.Vector3;
  rate: number;
  delay: number;
  // captured when the device dies
  p0: THREE.Vector3;
  q0: THREE.Quaternion;
  qRest: THREE.Quaternion;
  tLand: number;
}

const GRAVITY = 9.8;
const ALIGN_BEFORE = 0.2, ALIGN_TIME = 0.3;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _pp = new THREE.Vector3(), _qp = new THREE.Quaternion(), _a = new THREE.Vector3(), _up = new THREE.Vector3();
const _qs = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _me = new THREE.Matrix4();

/**
 * Orthonormal principal axes of a symmetric 3×3 covariance matrix (cyclic Jacobi), as a right-handed basis.
 * Degenerate inputs (a point, a perfect sphere) return the model axes.
 */
function principalAxes(xx: number, xy: number, xz: number, yy: number, yz: number, zz: number): THREE.Vector3[] {
  const a = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) {
    let offd = 0;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) offd += a[p]![q]! * a[p]![q]!;
    if (!(offd > 1e-18)) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const th = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k]![p]!, akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq; a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p]![k]!, aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk; a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k]![p]!, vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq; v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const e0 = new THREE.Vector3(v[0]![0]!, v[1]![0]!, v[2]![0]!), e1 = new THREE.Vector3(v[0]![1]!, v[1]![1]!, v[2]![1]!);
  if (!Number.isFinite(e0.lengthSq() + e1.lengthSq()) || e0.lengthSq() < 0.5 || e1.lengthSq() < 0.5) return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  e0.normalize();
  e1.addScaledVector(e0, -e1.dot(e0)).normalize();
  return [e0, e1, new THREE.Vector3().crossVectors(e0, e1)];
}

export abstract class DeviceBase extends CreatureBase implements DeviceVisual {
  private isDisabled = false;
  /** 0 = live, 1 = fully powered down (smoothed) */
  protected off = 0;
  /** mast wobble spring (radians) */
  protected wobX = 0;
  protected wobZ = 0;
  private wobVX = 0;
  private wobVZ = 0;
  private readonly chunks: Chunk[] = [];
  private captured = false;
  private kickN = 0;

  protected constructor(game: Game | null, spec: CreatureSpec, opts?: CharacterCreateOpts) {
    super(game, spec, opts);
  }

  setDisabled(disabled: boolean): void {
    this.isDisabled = !!disabled;
  }

  get disabled(): boolean {
    return this.isDisabled;
  }

  /** 1 = powered and alive, 0 = dark */
  protected get power(): number {
    return (1 - this.off) * (this.dead ? 0 : 1);
  }

  /**
   * Register a bone as a chunk of the break-apart. The chunk is the bone plus every descendant bone that is
   * not itself a chunk; register parents before children. `dir` is the rough throw direction (model space),
   * `speed` its strength, `spin` a multiplier on the tumble. Chunk bones must hang under unscaled parents.
   */
  protected addChunk(bone: THREE.Bone, dir: readonly [number, number, number], index: number, speed = 2.6, spin = 1): void {
    const r = (c: number): number => this.rnd(index * 7 + c) - 0.5;
    const axis = new THREE.Vector3(r(4), r(5) * 0.6, r(6));
    if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
    this.chunks.push({
      bone, c: new THREE.Vector3(), rb: new THREE.Quaternion(), h: new THREE.Vector3(0.05, 0.05, 0.05), thin: 1,
      v: new THREE.Vector3(dir[0] * speed + r(1) * 1.2, Math.max(0.4, dir[1] * speed + 1.2 + r(2)), dir[2] * speed + r(3) * 1.2),
      axis: axis.normalize(), rate: (3 + Math.abs(r(7)) * 8) * spin, delay: Math.abs(r(10)) * 0.1,
      p0: new THREE.Vector3(), q0: new THREE.Quaternion(), qRest: new THREE.Quaternion(), tLand: 0,
    });
    this.measureChunks();
  }

  /**
   * (re)compute every chunk's oriented box: principal axes of the vertices the chunk carries at bind, so a
   * diagonal strut gets a tight box along its own length rather than a fat axis-aligned one.
   */
  private measureChunks(): void {
    const rig = this.rig, bones = rig.bones;
    const owner = new Int32Array(bones.length).fill(-1);
    // the deepest registered ancestor-or-self owns each bone
    for (let i = 0; i < bones.length; i++) {
      for (let o: THREE.Object3D | null = bones[i]!; o; o = o.parent) {
        const k = this.chunks.findIndex((ch) => ch.bone === o);
        if (k >= 0) { owner[i] = k; break; }
      }
    }
    const pos = rig.template.geometry.getAttribute('position'), skin = rig.template.geometry.getAttribute('skinIndex');
    const n = this.chunks.length;
    const sum = new Float64Array(n * 10); // count, mean xyz, covariance xx xy xz yy yz zz
    for (let v = 0; v < pos.count; v++) {
      const k = owner[skin.getX(v)]!;
      if (k < 0) continue;
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v), o = k * 10;
      sum[o]!++; sum[o + 1]! += x; sum[o + 2]! += y; sum[o + 3]! += z;
      sum[o + 4]! += x * x; sum[o + 5]! += x * y; sum[o + 6]! += x * z; sum[o + 7]! += y * y; sum[o + 8]! += y * z; sum[o + 9]! += z * z;
    }
    const axes: THREE.Vector3[][] = [];
    for (let k = 0; k < n; k++) {
      const o = k * 10, c = Math.max(1, sum[o]!);
      const mx = sum[o + 1]! / c, my = sum[o + 2]! / c, mz = sum[o + 3]! / c;
      axes.push(principalAxes(sum[o + 4]! / c - mx * mx, sum[o + 5]! / c - mx * my, sum[o + 6]! / c - mx * mz, sum[o + 7]! / c - my * my, sum[o + 8]! / c - my * mz, sum[o + 9]! / c - mz * mz));
    }
    const lo = new Float64Array(n * 3).fill(Infinity), hi = new Float64Array(n * 3).fill(-Infinity);
    for (let v = 0; v < pos.count; v++) {
      const k = owner[skin.getX(v)]!;
      if (k < 0) continue;
      _p.set(pos.getX(v), pos.getY(v), pos.getZ(v));
      for (let a = 0; a < 3; a++) {
        const d = _p.dot(axes[k]![a]!);
        if (d < lo[k * 3 + a]!) lo[k * 3 + a] = d;
        if (d > hi[k * 3 + a]!) hi[k * 3 + a] = d;
      }
    }
    for (let k = 0; k < n; k++) {
      const ch = this.chunks[k]!, ax = axes[k]!;
      rig.restOf(rig.indexOf(ch.bone), _p);
      ch.c.set(0, 0, 0);
      for (let a = 0; a < 3; a++) {
        const l = lo[k * 3 + a]!, h = hi[k * 3 + a]!;
        const ok = l <= h;
        ch.c.addScaledVector(ax[a]!, ok ? (l + h) / 2 : _p.dot(ax[a]!));
        // a little slack for sub-parts that swivel inside the chunk (dish nod, sensor pitch)
        ch.h.setComponent(a, (ok ? (h - l) / 2 : 0.04) + 0.012);
      }
      ch.c.sub(_p);
      ch.rb.setFromRotationMatrix(_m.makeBasis(ax[0]!, ax[1]!, ax[2]!));
      ch.thin = ch.h.x <= ch.h.y && ch.h.x <= ch.h.z ? 0 : ch.h.y <= ch.h.z ? 1 : 2;
    }
  }

  protected override onPlay(name: string, _slot: Slot): void {
    if (name === 'hitLight') this.kick(2.2);
    else if (name === 'hitHeavy') this.kick(4.2);
    else if (name === 'stagger') this.kick(5.5);
    else if (name === 'disabled') this.isDisabled = true;
    else if (name === 'death') this.captured = false;
  }

  protected override onStop(key: string | null): void {
    // stop('disabled') powers the device back up; a bare stop() leaves the disabled STATE alone
    if (key === 'disabled') this.isDisabled = false;
  }

  protected override onRevive(): void {
    this.captured = false;
    this.isDisabled = false;
    this.off = 0;
    this.rig.setBoundsCenter(this.rig.template.center.x, this.rig.template.center.y, this.rig.template.center.z, 1.5);
  }

  protected override heal(): void {
    this.wobX = 0; this.wobZ = 0; this.wobVX = 0; this.wobVZ = 0; this.off = this.isDisabled ? 1 : 0;
  }

  private kick(strength: number): void {
    this.kickN++;
    const a = this.rnd(40 + this.kickN) * Math.PI * 2;
    this.wobVX += Math.cos(a) * strength;
    this.wobVZ += Math.sin(a) * strength;
  }

  /** advance the shared device state; call first in pose() */
  protected stepDevice(adt: number, dt: number): void {
    this.off = damp(this.off, this.isDisabled ? 1 : 0, 3.2, dt);
    // damped spring, semi-implicit
    const k = 150, c = 7.5;
    const steps = Math.max(1, Math.ceil(adt / 0.012));
    const h = adt / steps;
    for (let i = 0; i < steps; i++) {
      this.wobVX += (-k * this.wobX - c * this.wobVX) * h;
      this.wobVZ += (-k * this.wobZ - c * this.wobVZ) * h;
      this.wobX += this.wobVX * h;
      this.wobZ += this.wobVZ * h;
    }
  }

  /** model-space matrix of a bone as currently posed */
  private modelMatrix(o: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    o.updateWorldMatrix(true, false);
    return out.multiplyMatrices(this.rig.toModel, o.matrixWorld);
  }

  /** vertical half-extent of a chunk's box when its bone has model-space orientation q */
  private extentY(ch: Chunk, q: THREE.Quaternion): number {
    const e = _me.makeRotationFromQuaternion(_qe.copy(q).multiply(ch.rb)).elements;
    return ch.h.x * Math.abs(e[1]!) + ch.h.y * Math.abs(e[5]!) + ch.h.z * Math.abs(e[9]!);
  }

  private capture(): void {
    this.captured = true;
    for (const ch of this.chunks) {
      this.modelMatrix(ch.bone, _m).decompose(_p, ch.q0, _s);
      ch.p0.copy(ch.c).applyQuaternion(ch.q0).add(_p); // box centre, model space
      // flight time down to the height the box rests at on its flattest side
      const rest = Math.min(ch.h.x, ch.h.y, ch.h.z);
      const drop = Math.max(0, ch.p0.y - rest);
      ch.tLand = (ch.v.y + Math.sqrt(ch.v.y * ch.v.y + 2 * GRAVITY * drop)) / GRAVITY;
      // resting orientation: the flat pose nearest to how it arrives
      _qs.setFromAxisAngle(ch.axis, ch.rate * ch.tLand).multiply(ch.q0);
      _a.set(ch.thin === 0 ? 1 : 0, ch.thin === 1 ? 1 : 0, ch.thin === 2 ? 1 : 0).applyQuaternion(ch.rb).applyQuaternion(_qs);
      _up.set(0, _a.y >= 0 ? 1 : -1, 0);
      ch.qRest.setFromUnitVectors(_a.normalize(), _up).multiply(_qs);
    }
    // wreckage travels: widen the culling sphere around the whole debris field
    this.rig.setBounds(0, 0.6, 0, 5.5);
  }

  /** throw the registered chunks; `t` = seconds since death started. Call after the live pose of the frame. */
  protected breakApart(t: number): void {
    if (!this.captured) this.capture();
    for (const ch of this.chunks) {
      const tt = t - ch.delay;
      if (tt <= 0) continue;
      const tf = Math.min(tt, ch.tLand);
      // orientation: tumble, then roll onto the flattest side as it comes down
      _q.setFromAxisAngle(ch.axis, ch.rate * tf).multiply(ch.q0);
      const al = clamp01((tt - (ch.tLand - ALIGN_BEFORE)) / ALIGN_TIME);
      if (al > 0) _q.slerp(ch.qRest, al * al * (3 - 2 * al));
      // position of the box centre: ballistic, a short slide after landing, never below its own extent
      const slide = tt > ch.tLand ? (1 - Math.exp(-(tt - ch.tLand) * 5)) * 0.1 : 0;
      const x = ch.p0.x + ch.v.x * (tf + slide), z = ch.p0.z + ch.v.z * (tf + slide);
      let y = ch.p0.y + ch.v.y * tf - 0.5 * GRAVITY * tf * tf;
      const floorY = this.extentY(ch, _q);
      if (y < floorY) y = floorY;
      if (tt > ch.tLand) {
        const hop = (tt - ch.tLand) / 0.2;
        if (hop < 1) y += Math.sin(Math.PI * hop) * Math.min(0.1, 0.012 * GRAVITY * ch.tLand);
      }
      // back to the bone's pivot, then into its parent's frame
      _p.copy(ch.c).applyQuaternion(_q).multiplyScalar(-1);
      _p.x += x; _p.y += y; _p.z += z;
      const parent = ch.bone.parent;
      if (parent && parent !== this.rig.group) {
        this.modelMatrix(parent, _m).decompose(_pp, _qp, _s);
        _qp.invert();
        ch.bone.position.copy(_p.sub(_pp).applyQuaternion(_qp));
        ch.bone.quaternion.copy(_qp.multiply(_q));
      } else {
        ch.bone.position.copy(_p);
        ch.bone.quaternion.copy(_q);
      }
    }
  }

  /** flicker multiplier while powering down / staggered (1 = steady) */
  protected flickerLight(seedOffset = 0): number {
    const st = this.weight('stagger');
    const dying = this.off > 0.02 && this.off < 0.98 ? 1 : 0;
    const f = Math.sin(this.time * 47 + seedOffset) * Math.sin(this.time * 31.7 + seedOffset * 2);
    const flick = f > 0.1 ? 1 : 0.15;
    return 1 - Math.max(st, dying) * (1 - flick);
  }
}
