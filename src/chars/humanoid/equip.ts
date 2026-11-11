/**
 * Equipment state of one figure: which items are in hand or sheathed and where their bones hang, the grip data
 * the solver needs, the weapon a dying hand lets go of, and Verity's blades — which shorten rather than cut
 * through their wielder.
 */
import * as THREE from 'three';
import type { RigInstance } from './rig';
import { mountQuat, type FigureDef, type ItemDef, type Loadout, type Mount } from './figure';
import type { HeldKey } from './anim/moveset';
import type { BodySolver } from './anim/solver';
import type { ClothCapsule } from './cloth';

const DEG = Math.PI / 180;
export const HIDDEN = 1e-4;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _p = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
/** samples along a Verity blade for the clearance test, and the blade's half-width */
const BLADE_SAMPLES = 16, BLADE_HALF = 0.035;
/** seconds a released weapon takes to reach the floor */
const DROP_TIME = 0.42;

interface Drop { bone: THREE.Bone; item: ItemDef; t: number; p0: THREE.Vector3; q0: THREE.Quaternion; p1: THREE.Vector3; q1: THREE.Quaternion }

export type LoadoutOpts = { melee?: boolean; ranged?: boolean; shield?: boolean; prop?: 'case' | 'rifle' | 'none'; hideSheathed?: boolean };

export class Equipment {
  readonly loadout: Loadout;
  heldR = false;
  heldL = false;
  rangedHeld = false;
  meleeHeld = false;
  /** carry-stance key for the current loadout */
  stanceKey: HeldKey = 'none';
  /** off-hand grip of the main item, in right-hand space (valid while hasGrip2) */
  readonly grip2 = new THREE.Vector3();
  readonly grip2Rot = new THREE.Quaternion();
  hasGrip2 = false;
  /** barrel axis of the drawn ranged weapon in right-hand space */
  barrel: THREE.Vector3 | null = null;
  /** blade tips of the held melee weapon in right-hand space (kept above the floor by the solver) */
  tips: THREE.Vector3[] | null = null;
  /** blade axis of a ring-hilted weapon in right-hand space (see SolveOpts.ring) */
  ring: THREE.Vector3 | null = null;
  private readonly ringV = new THREE.Vector3();
  /** current extension 0..1 of Verity's forward / rear blade */
  readonly bladeLen: [number, number] = [1, 1];
  private readonly barrelV = new THREE.Vector3();
  private readonly tipPool = [new THREE.Vector3(), new THREE.Vector3()];
  private emptyHands = false;
  /** a clip holds the ring hilt in the hand with its blades in (Verity collapsed in hand) */
  private collapse = false;
  private stow = false;
  private drop: Drop | null = null;
  private bladeExt = 1;
  private bladeTarget = 1;
  /** Verity is being put away: it stays in the hand until its blades have retracted */
  private sheathing = false;

  constructor(private readonly fig: FigureDef, private readonly rig: RigInstance) {
    this.loadout = { ...fig.loadout };
    this.apply(true);
  }

  /** true once the main-hand item has been let go (death) */
  get dropped(): boolean { return !!this.drop; }

  set(opts: LoadoutOpts): void {
    const lo = this.loadout;
    if (opts.melee !== undefined) lo.melee = !!opts.melee;
    if (opts.ranged !== undefined) lo.ranged = !!opts.ranged;
    if (opts.shield !== undefined) lo.shield = !!opts.shield;
    if (opts.prop !== undefined) lo.prop = opts.prop === 'case' || opts.prop === 'rifle' ? opts.prop : 'none';
    if (opts.hideSheathed !== undefined) lo.hideSheathed = !!opts.hideSheathed;
    this.apply(false);
  }

  /**
   * Follow the animator: `emptyHands` = the active action needs both hands (weapons go to their sheaths until
   * it ends), `dropped` = the hand has let go, `stow` = the figure sits, kneels or lies (long sheathed weapons
   * are set aside: a greatsword on the back does not fit a chair or the floor). Returns true when the carry
   * stance changed.
   */
  sync(emptyHands: boolean, dropped: boolean, stow: boolean, collapse = false): boolean {
    let changed = false;
    // (collapse only means something for a ring hilt with energy blades)
    const c = collapse && !!this.fig.items.melee?.blades;
    if (emptyHands !== this.emptyHands || stow !== this.stow || c !== this.collapse) { this.emptyHands = emptyHands; this.stow = stow; this.collapse = c; if (!this.drop) { this.apply(false); changed = true; } }
    if (dropped && !this.drop) changed = this.startDrop() || changed;
    else if (!dropped && this.drop) { this.drop = null; this.apply(true); changed = true; }
    return changed;
  }

  private mount(bone: THREE.Bone, m: Mount): void {
    const parent = this.rig.byName[m.parent] ?? this.rig.bones[0];
    if (bone.parent !== parent) parent.add(bone);
    bone.position.set(m.pos[0], m.pos[1], m.pos[2]);
    mountQuat(m, bone.quaternion);
    bone.scale.setScalar(1);
  }

  private place(item: ItemDef | undefined, held: boolean, long = false): void {
    if (!item) return;
    const bone = this.rig.byName[item.bone];
    if (held) this.mount(bone, item.held);
    else if (item.sheath && !this.loadout.hideSheathed && !(long && this.stow)) this.mount(bone, item.sheath);
    else bone.scale.setScalar(HIDDEN);
  }

  private apply(snap: boolean): void {
    const it = this.fig.items, lo = this.loadout;
    const free = !this.emptyHands;
    const rifleProp = lo.prop === 'rifle' && !!it.ranged?.rifle;
    const rangedHeld = (lo.ranged || rifleProp) && !!it.ranged && free;
    const meleeHeld = (lo.melee || this.collapse) && !!it.melee && !rangedHeld && free;
    // a bladed hilt goes to its sheath only once the blades are in (see update)
    this.sheathing = !snap && !meleeHeld && this.meleeHeld && !!it.melee?.blades && this.bladeExt > 0.1;
    if (!this.sheathing) this.place(it.melee, meleeHeld, !it.melee?.blades);
    this.place(it.ranged, rangedHeld, !!it.ranged?.rifle);
    this.place(it.shield, lo.shield);
    this.place(it.case, lo.prop === 'case');
    this.bladeTarget = meleeHeld && !this.collapse ? 1 : 0;
    if (snap) this.bladeExt = this.bladeTarget;

    this.rangedHeld = rangedHeld;
    this.meleeHeld = meleeHeld;
    const main = rangedHeld ? it.ranged : meleeHeld ? it.melee : undefined;
    this.heldR = !!main;
    this.heldL = (lo.prop === 'case' && !!it.case) || (lo.shield && !!it.shield);
    this.hasGrip2 = !!main?.grip2;
    if (main?.grip2) {
      // grip2 is authored in the item's frame; bring it into the hand frame through the held mount rotation
      mountQuat(main.held, this.grip2Rot);
      this.grip2.set(main.grip2[0], main.grip2[1], main.grip2[2]).applyQuaternion(this.grip2Rot);
      const g = main.grip2Rot ?? [0, 0, 0];
      this.grip2Rot.setFromEuler(_e.set(g[0] * DEG, g[1] * DEG, g[2] * DEG, 'XYZ'));
    }
    this.barrel = null;
    if (rangedHeld && it.ranged) this.barrel = this.barrelV.set(0, 0, -1).applyQuaternion(mountQuat(it.ranged.held, _q));
    this.ring = (meleeHeld || this.sheathing) && it.melee?.blades ? this.ringV.set(0, 0, -1).applyQuaternion(mountQuat(it.melee.held, _q)) : null;
    this.tips = null;
    // (energy blades are not held off the floor by the arm: they shorten on it, like on their wielder)
    if (meleeHeld && it.melee?.sockets && !it.melee.blades) {
      const m = it.melee.held, s = it.melee.sockets;
      mountQuat(m, _q);
      const tips: THREE.Vector3[] = [];
      for (const name of ['weaponTip', 'weaponTip2']) {
        const t = s[name];
        if (t) tips.push(this.tipPool[tips.length].set(t[0], t[1], t[2]).applyQuaternion(_q).add(_v.set(m.pos[0], m.pos[1], m.pos[2])));
      }
      if (tips.length) this.tips = tips;
    }
    this.stanceKey = rangedHeld ? 'ranged' : meleeHeld ? 'melee' : lo.prop === 'case' && it.case ? 'case' : 'none';
  }

  /** Let go of the main-hand item: it leaves the hand where it is and settles flat on the floor. */
  private startDrop(): boolean {
    const it = this.fig.items;
    const item = this.rangedHeld ? it.ranged : this.meleeHeld ? it.melee : undefined;
    if (!item) return false;
    const bone = this.rig.byName[item.bone], rootBone = this.rig.bones[0];
    rootBone.updateWorldMatrix(true, false);
    bone.updateWorldMatrix(true, false);
    _m.copy(rootBone.matrixWorld).invert().multiply(bone.matrixWorld);
    const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion();
    _m.decompose(p0, q0, _v);
    rootBone.add(bone);
    bone.position.copy(p0); bone.quaternion.copy(q0); bone.scale.setScalar(1);
    // lying flat: the long axis keeps its heading, the item's thin axis points up
    _z.set(0, 0, 1).applyQuaternion(q0); _z.y = 0;
    if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1);
    _z.normalize();
    const flat = item.blades ? _y : _x;
    _a.set(flat === _x ? 1 : 0, flat === _x ? 0 : 1, 0).applyQuaternion(q0);
    const up = _a.y >= 0 ? 1 : -1;
    if (flat === _x) { _x.set(0, up, 0); _y.crossVectors(_z, _x); } else { _y.set(0, up, 0); _x.crossVectors(_y, _z); }
    const q1 = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    const p1 = new THREE.Vector3(p0.x - _z.x * 0.1, item.rest ?? 0.02, p0.z - _z.z * 0.1);
    this.drop = { bone, item, t: 0, p0, q0, p1, q1 };
    this.heldR = false; this.hasGrip2 = false; this.tips = null; this.barrel = null; this.ring = null;
    this.meleeHeld = false; this.rangedHeld = false;
    this.bladeTarget = 0;
    this.stanceKey = 'none';
    return true;
  }

  /** Advance the falling weapon and the blades. `caps` = body capsules in model space (r = 0 entries skipped). */
  update(dt: number, solver: BodySolver, caps: ClothCapsule[], bladeCaps: readonly number[]): void {
    const d = this.drop;
    if (d && d.t < 1) {
      d.t = Math.min(1, d.t + dt / DROP_TIME);
      const u = d.t, s = u * u * (3 - 2 * u);
      d.bone.position.set(d.p0.x + (d.p1.x - d.p0.x) * s, d.p0.y + (d.p1.y - d.p0.y) * u * u, d.p0.z + (d.p1.z - d.p0.z) * s);
      d.bone.quaternion.copy(d.q0).slerp(d.q1, s);
    }
    const blades = this.fig.items.melee?.blades;
    if (!blades) return;
    this.bladeExt += (this.bladeTarget - this.bladeExt) * (1 - Math.exp(-(this.sheathing ? 22 : 14) * dt));
    if (this.sheathing && (this.bladeExt < 0.08 || this.meleeHeld)) {
      this.sheathing = false;
      if (!this.meleeHeld && !this.drop) { this.place(this.fig.items.melee, false, false); this.ring = null; }
    }
    const item = this.fig.items.melee as ItemDef;
    if (this.meleeHeld) {
      // blade axis and grip in model space, straight from the solve
      const I = solver.spec.index, hq = solver.wq[I.handR];
      const m = item.held;
      _p.set(m.pos[0], m.pos[1], m.pos[2]).applyQuaternion(hq).add(solver.wp[I.handR]);
      _a.set(0, 0, -1).applyQuaternion(_q1.copy(hq).multiply(mountQuat(m, _q)));
      for (let k = 0; k < 2; k++) {
        const sign = k === 0 ? 1 : -1;
        let allowed = 1;
        for (let j = 0; j <= BLADE_SAMPLES && allowed === 1; j++) {
          const s = blades[0] + blades[1] * (j / BLADE_SAMPLES);
          _v.copy(_p).addScaledVector(_a, sign * s);
          if (_v.y < 0.012) { allowed = Math.max(0, (j - 1) / BLADE_SAMPLES); break; }
          for (const ci of bladeCaps) {
            const c = caps[ci];
            if (c.r <= 0) continue;
            if (segDist2(_v, c.a, c.b) < (c.r + BLADE_HALF) * (c.r + BLADE_HALF)) { allowed = Math.max(0, (j - 1) / BLADE_SAMPLES); break; }
          }
        }
        const cur = this.bladeLen[k];
        // shorten at once (a blade is never drawn inside anything), grow back smoothly
        this.bladeLen[k] = allowed < cur ? allowed : cur + (allowed - cur) * (1 - Math.exp(-9 * dt));
      }
    } else { this.bladeLen[0] += (1 - this.bladeLen[0]) * 0.2; this.bladeLen[1] += (1 - this.bladeLen[1]) * 0.2; }
    this.rig.byName.bladeA.scale.set(1, 1, Math.max(HIDDEN, this.bladeExt * this.bladeLen[0]));
    this.rig.byName.bladeB.scale.set(1, 1, Math.max(HIDDEN, this.bladeExt * this.bladeLen[1]));
  }

  /**
   * Model-space segment of the melee weapon (held or sheathed) for cloth collision. Returns false when there is
   * none worth colliding with (no weapon, hidden, dropped).
   */
  weaponSegment(solver: BodySolver, a: THREE.Vector3, b: THREE.Vector3): boolean {
    const item = this.fig.items.melee;
    if (!item || !item.sockets || this.drop || item.blades) return false;
    const m = this.meleeHeld ? item.held : this.loadout.hideSheathed || this.stow ? null : item.sheath;
    const base = item.sockets.weaponBase, tip = item.sockets.weaponTip;
    if (!m || !base || !tip) return false;
    const pi = solver.spec.index[m.parent];
    if (pi === undefined) return false;
    const pq = solver.wq[pi], pp = solver.wp[pi];
    mountQuat(m, _q);
    a.set(base[0], base[1], base[2]).applyQuaternion(_q).add(_v.set(m.pos[0], m.pos[1], m.pos[2])).applyQuaternion(pq).add(pp);
    b.set(tip[0], tip[1], tip[2]).applyQuaternion(_q).add(_v).applyQuaternion(pq).add(pp);
    return true;
  }
}

/** squared distance from point p to segment a–b */
function segDist2(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-12 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / ab2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = p.x - (a.x + abx * t), dy = p.y - (a.y + aby * t), dz = p.z - (a.z + abz * t);
  return dx * dx + dy * dy + dz * dz;
}
