/**
 * HumanoidVisualImpl — the CharacterVisual for every humanoid archetype: a skinned figure at up to three levels
 * of detail on one skeleton (plus a low-poly shadow caster), one shared-program material, a layered animator,
 * cloth panels, equipment mounts and sockets. With a geometry mask it is a mesh-less (or cloth / weapon only)
 * animation DRIVER for another body, e.g. a generated GLB.
 */
import * as THREE from 'three';
import type { ActionInfo, AnimAction, HumanoidArchetype, HumanoidLoadout, HumanoidVisual, PlayOpts, SocketName, Vec3Like } from '@/core/api';
import { ZONE } from './geo/builder';
import { instantiateRig, type RigInstance } from './rig';
import { createFigureMaterial, type FigureUniforms } from './material';
import { Animator } from './anim/animator';
import { hasClip, resolveClip, resolveStance } from './anim/moveset';
import type { StanceSet } from './anim/locomotion';
import type { SolveOpts } from './anim/solver';
import { ClothSim, type ClothCapsule } from './cloth';
import { releaseFigure, retainFigure, type FigureDef } from './figure';
import { Equipment } from './equip';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3.2);
const BOUNDS_BOX = new THREE.Box3(new THREE.Vector3(-3.2, -0.6, -3.2), new THREE.Vector3(3.2, 3.6, 3.2));
/** capsule slots: body for cloth + blade clearance, then the melee weapon (cloth only) */
const CAP_COUNT = 13, CAP_WEAPON = 12;
const BLADE_CAPS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11];

const EXPOSE_ZONE: Record<string, number> = {
  head: ZONE.head, chest: ZONE.chest, core: ZONE.chest, back: ZONE.back, vent: ZONE.back, shield: ZONE.shield,
  weapon: ZONE.weapon, arm: ZONE.arm, leg: ZONE.leg, joint: ZONE.leg, body: ZONE.body,
};
const warned = new Set<string>();
function warnOnce(msg: string): void { if (!warned.has(msg)) { warned.add(msg); console.warn('[humanoid] ' + msg); } }
function hash01(n: number): number { const s = Math.sin(n * 91.345 + 17.13) * 43758.5453; return s - Math.floor(s); }

export interface VisualOpts {
  scale: number;
  seed: number;
  /** squad variation on shared geometry: per-instance height and tint from the seed */
  vary: boolean;
}

export class HumanoidVisualImpl implements HumanoidVisual {
  readonly archetype: HumanoidArchetype;
  readonly root = new THREE.Group();
  readonly height: number;
  readonly radius: number;
  readonly triangles: number;
  onFootstep: ((foot: 'L' | 'R', world: THREE.Vector3) => void) | null = null;

  private readonly model = new THREE.Group();
  /** level-of-detail switch holding the body meshes (null for a mesh-less driver) */
  private readonly lod: THREE.LOD | null = null;
  private readonly rig: RigInstance;
  private readonly uniforms: FigureUniforms;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private shadowMaterial: THREE.Material | null = null;
  private readonly animator: Animator;
  private readonly equip: Equipment;
  private readonly cloth: ClothSim[] = [];
  private readonly caps: ClothCapsule[] = [];
  private readonly sockets: Record<string, THREE.Object3D> = {};
  private readonly overlays: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number; with?: string }> = [];
  private stance: StanceSet;
  private flashLeft = 0;
  private flashDur = 0.12;
  private frozen = 0;
  private glow = 1;
  private time = 0;
  private lastYaw = 0;
  private readonly lastPos = new THREE.Vector3();
  private first = true;
  private hidden = false;
  private lookWorld: THREE.Vector3 | null = null;
  private readonly lookLocal = new THREE.Vector3();
  private readonly pins: Array<{ pos: THREE.Vector3; w: number; target: number } | null> = [null, null];
  private disposed = false;

  constructor(private readonly fig: FigureDef, opts: VisualOpts) {
    retainFigure(fig);
    this.archetype = fig.archetype;
    const seed = opts.seed;
    const jitter = opts.vary ? 1 + (hash01(seed) - 0.5) * 0.05 : 1;
    const scale = opts.scale * jitter;
    const s = fig.spec.scale * scale;
    this.height = fig.spec.prop.height * scale;
    this.radius = fig.radius * scale;
    this.triangles = fig.triangles;
    this.root.name = 'humanoid:' + fig.archetype;
    this.model.scale.setScalar(s);
    this.root.add(this.model);

    this.rig = instantiateRig(fig.spec);
    const fm = createFigureMaterial({ ghost: fig.ghost, luminous: fig.luminous, seed });
    this.material = fm.material;
    this.depthMaterial = fm.depth;
    this.uniforms = fm.uniforms;
    if (opts.vary) {
      // same body, different day: value and a touch of warm / cool
      const v = 0.9 + hash01(seed * 1.9 + 3) * 0.2, w = (hash01(seed * 3.1 + 7) - 0.5) * 0.08;
      this.uniforms.uTint.value.setRGB(v * (1 + w), v, v * (1 - w));
    }
    this.model.add(this.rig.bones[0]);
    if (fig.geometry) this.lod = this.buildMeshes();

    this.animator = new Animator(fig.spec, { resolve: (name) => resolveClip(fig.moveset, name), has: (name) => hasClip(fig.moveset, name) });
    this.animator.headBias.set(fig.headBias[0] * DEG, fig.headBias[1] * DEG, fig.headBias[2] * DEG);
    this.animator.breath = fig.breath;
    this.animator.loco.onStep = (side) => {
      if (!this.onFootstep) return;
      const bone = this.rig.byName[side < 0 ? 'footL' : 'footR'];
      this.onFootstep(side < 0 ? 'L' : 'R', bone.getWorldPosition(_v));
    };

    for (let i = 0; i < fig.cloth.length; i++) this.cloth.push(new ClothSim(fig.cloth[i], this.rig.bones, seed * 3.1 + i));
    for (let i = 0; i < CAP_COUNT; i++) this.caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0 });

    for (const o of fig.overlays) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color).multiplyScalar(o.intensity), transparent: true, opacity: o.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(o.geometry, mat);
      mesh.name = 'overlay:' + o.bone;
      (this.rig.byName[o.bone] ?? this.rig.bones[0]).add(mesh);
      this.overlays.push({ mesh, mat, base: o.opacity, with: o.with });
    }

    this.buildSockets();
    this.equip = new Equipment(fig, this.rig);
    this.stance = resolveStance(fig.moveset, this.equip.stanceKey);
    this.syncOverlays();

    this.setRim(fig.rim.amount, fig.rim.color);
    this.uniforms.uCorruption.value = fig.corruption;
    // pose the skeleton once so sockets are valid before the first tick; cloth and motion smoothing stay
    // un-seeded until the owner has placed the root and calls update()
    this.animator.update(0, 0, this.stance, this.fillSolveOpts(null), this.rig.bones, 0);
    this.root.updateMatrixWorld(true);
  }

  // ---- meshes -------------------------------------------------------------------------------------------

  private skinned(geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.SkinnedMesh {
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = name;
    mesh.bind(this.rig.skeleton, new THREE.Matrix4());
    // generous fixed bounds in model space: swings, capes and corpses stay inside; nothing is skinned on the CPU
    mesh.boundingSphere = BOUNDS.clone();
    mesh.boundingBox = BOUNDS_BOX.clone();
    mesh.frustumCulled = true;
    return mesh;
  }

  private buildMeshes(): THREE.LOD {
    const fig = this.fig;
    const geos = [fig.geometry as THREE.BufferGeometry, ...fig.lods];
    const proxy = !fig.ghost && fig.lods.length > 0;
    const lod = new THREE.LOD();
    lod.name = 'lod';
    const s = this.model.scale.x;
    for (let i = 0; i < geos.length; i++) {
      const mesh = this.skinned(geos[i], this.material, i === 0 ? 'body' : 'body:lod' + i);
      mesh.castShadow = !fig.ghost && !proxy;
      mesh.receiveShadow = !fig.ghost;
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.visible = i === 0;
      lod.addLevel(mesh, i === 0 ? 0 : fig.lodDist[Math.min(i - 1, fig.lodDist.length - 1)] * (s > 0 ? 1 : 1), 0.08);
    }
    this.model.add(lod);
    if (proxy) {
      // the shadow is cast by the cheapest level: drawn without colour or depth in the main pass
      this.shadowMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
      const caster = this.skinned(geos[geos.length - 1], this.shadowMaterial, 'shadow');
      caster.castShadow = true;
      caster.customDepthMaterial = this.depthMaterial;
      caster.renderOrder = -1;
      this.model.add(caster);
    }
    return lod;
  }

  // ---- sockets + equipment ------------------------------------------------------------------------------

  private addSocket(name: string, bone: string, x: number, y: number, z: number): void {
    const o = new THREE.Object3D();
    o.name = 'socket:' + name;
    o.position.set(x, y, z);
    (this.rig.byName[bone] ?? this.rig.bones[0]).add(o);
    this.sockets[name] = o;
  }

  private buildSockets(): void {
    const spec = this.fig.spec, I = spec.index, R = spec.rest;
    const rel = (a: string, b: string): [number, number, number] => [R[I[a] * 3] - R[I[b] * 3], R[I[a] * 3 + 1] - R[I[b] * 3 + 1], R[I[a] * 3 + 2] - R[I[b] * 3 + 2]];
    this.sockets.root = this.root;
    this.addSocket('hips', 'hips', 0, 0, 0);
    this.addSocket('chest', 'chest', 0, 0.1, -0.02);
    this.addSocket('core', 'chest', 0, 0.1, -0.02);
    this.addSocket('back', 'chest', 0, 0.12, 0.17);
    this.addSocket('head', 'head', 0, 0.1, 0);
    this.addSocket('eye', 'head', 0, 0.105, -0.095);
    this.addSocket('handR', 'handR', ...rel('weapon', 'handR'));
    this.addSocket('handL', 'handL', ...rel('prop', 'handL'));
    this.addSocket('shield', 'shield', 0, 0, -0.08);
    // weapon / muzzle sockets ride the equipment bones
    const melee = this.fig.items.melee, ranged = this.fig.items.ranged;
    const ws = melee?.sockets ?? {};
    this.addSocket('weaponBase', 'weapon', ...(ws.weaponBase ?? [0, 0, -0.08]));
    this.addSocket('weaponMid', 'weapon', ...(ws.weaponMid ?? [0, 0, -0.5]));
    this.addSocket('weaponTip', 'weapon', ...(ws.weaponTip ?? [0, 0, -1]));
    if (ws.weaponTip2) this.addSocket('weaponTip2', 'weapon', ...ws.weaponTip2);
    const m = ranged?.sockets?.muzzle;
    if (m) this.addSocket('muzzle', 'gun', ...m);
    else this.addSocket('muzzle', 'handR', ...rel('weapon', 'handR'));
  }

  private syncOverlays(): void {
    const lo = this.equip.loadout;
    for (const o of this.overlays) o.mesh.visible = o.with === 'shield' ? lo.shield : o.with === 'melee' ? this.equip.meleeHeld : true;
  }

  setLoadout(opts: HumanoidLoadout): void {
    if (!opts) return;
    this.equip.set(opts);
    this.stance = resolveStance(this.fig.moveset, this.equip.stanceKey);
    this.syncOverlays();
  }

  // ---- animation ----------------------------------------------------------------------------------------

  setLocomotion(speed: number, moveYaw = 0, opts?: { sprint?: boolean; aiming?: boolean; guarding?: boolean; injured?: boolean }): void {
    // speeds arrive in world m/s; the rig works at reference scale
    this.animator.loco.setInput(speed / (this.model.scale.x || 1), moveYaw, opts);
  }

  play(action: AnimAction, opts?: PlayOpts): ActionInfo {
    const name = typeof action === 'string' && action ? action : 'idle';
    if (name === 'frozen') { this.animator.paused = true; return { duration: 0, hitTimes: [], loop: true }; }
    if (name === 'idle') { this.animator.stop(undefined, opts?.fade); this.animator.paused = false; return { duration: 0, hitTimes: [], loop: true }; }
    return this.animator.play(name, opts);
  }

  stop(action?: AnimAction, fade?: number): void {
    if (action === undefined || action === 'frozen') this.animator.paused = false;
    if (action === 'frozen') return;
    this.animator.stop(action as string | undefined, fade);
  }

  isPlaying(action?: AnimAction): boolean {
    if (action === 'frozen') return this.animator.paused;
    return this.animator.isPlaying(action as string | undefined);
  }

  info(action: AnimAction): ActionInfo {
    if (action === 'frozen' || action === 'idle') return { duration: 0, hitTimes: [], loop: true };
    return this.animator.info(String(action));
  }

  lookAt(target: Vec3Like | null): void {
    if (!target) { this.lookWorld = null; return; }
    (this.lookWorld ??= new THREE.Vector3()).set(target.x, target.y, target.z);
  }

  setAimPitch(pitch: number): void { this.animator.setAimPitch(pitch); }

  setHandTarget(hand: 'L' | 'R', target: Vec3Like | null, weight = 1): void {
    const s = hand === 'L' ? 0 : 1;
    if (!target) { const p = this.pins[s]; if (p) p.target = 0; return; }
    const p = (this.pins[s] ??= { pos: new THREE.Vector3(), w: 0, target: 0 });
    p.pos.set(target.x, target.y, target.z);
    p.target = Math.max(0, Math.min(1, weight));
  }

  socket(name: SocketName): THREE.Object3D {
    return this.sockets[name] ?? this.root;
  }

  // ---- shader state -------------------------------------------------------------------------------------

  flash(color: number, seconds = 0.12): void {
    _c.set(color);
    this.uniforms.uFlash.value.set(_c.r, _c.g, _c.b, 1);
    this.flashDur = Math.max(0.01, seconds);
    this.flashLeft = this.flashDur;
  }

  setFrozen(amount: number): void {
    this.frozen = clamp01(amount);
    this.uniforms.uFrozen.value = this.frozen;
  }

  setCorruption(amount: number): void { this.uniforms.uCorruption.value = clamp01(amount); }

  setDissolve(amount: number, color?: number): void {
    const a = clamp01(amount);
    this.uniforms.uDissolve.value = a;
    if (color !== undefined) this.uniforms.uDissolveColor.value.set(color);
    if (this.lod) this.lod.visible = a < 0.999;
    for (const o of this.overlays) o.mat.opacity = o.base * (1 - a);
  }

  setGlow(amount: number): void {
    this.glow = Math.max(0, Number.isFinite(amount) ? amount : 1);
    this.uniforms.uGlow.value = this.glow;
  }

  setTelegraph(amount: number, color = 0xff5a2a): void {
    _c.set(color);
    this.uniforms.uTelegraph.value.set(_c.r, _c.g, _c.b, clamp01(amount));
  }

  setExposed(part: string, amount: number): void {
    let zone = EXPOSE_ZONE[part];
    if (zone === undefined) { warnOnce(`setExposed: unknown part "${part}" on ${this.archetype}`); zone = ZONE.chest; }
    this.uniforms.uExposed.value.set(zone, clamp01(amount));
  }

  setRim(amount: number, color?: number): void {
    const u = this.uniforms.uRim.value;
    if (color !== undefined) { _c.set(color); u.x = _c.r; u.y = _c.g; u.z = _c.b; }
    u.w = clamp01(amount) * 1.6;
  }

  setVisible(v: boolean): void { this.root.visible = !!v; }

  teleported(): void {
    this.first = true;
  }

  // ---- update -------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (this.disposed) return;
    if (!(dt >= 0) || !Number.isFinite(dt)) dt = 0;
    dt = Math.min(dt, 0.25);
    const root = this.root;
    root.updateWorldMatrix(true, false);
    this.model.updateWorldMatrix(false, false);
    const mw = this.model.matrixWorld;
    const scale = this.model.scale.x || 1;
    const an = this.animator;

    // teleport / first frame: no leaning, no cloth whip, feet re-plant
    _v.setFromMatrixPosition(mw);
    const yaw = root.rotation.y;
    let yawRate = 0;
    const moved = _v.distanceTo(this.lastPos);
    if (this.first || !(moved <= 3) || (dt > 1e-4 && moved > 0.4 && moved / dt > 45)) {
      an.reset();
      an.loco.setRoot(0, 0, yaw);
      for (const c of this.cloth) c.reset();
      this.first = false;
    } else {
      an.loco.setRoot((_v.x - this.lastPos.x) / scale, (_v.z - this.lastPos.z) / scale, yaw);
      if (dt > 1e-5) {
        let d = yaw - this.lastYaw;
        d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        yawRate = d / dt;
      }
    }
    this.lastPos.copy(_v);
    this.lastYaw = yaw;

    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      this.uniforms.uFlash.value.w = Math.max(0, this.flashLeft / this.flashDur);
    }

    // look target → model space
    if (this.lookWorld) {
      _m.copy(mw).invert();
      an.setLook(this.lookLocal.copy(this.lookWorld).applyMatrix4(_m));
    } else an.setLook(null);

    // equipment follows the action (two-handed work sheathes the weapon, a dying hand lets go)
    if (this.equip.sync(an.emptyHands, an.dropped)) { this.stance = resolveStance(this.fig.moveset, this.equip.stanceKey); this.syncOverlays(); }
    const lf = an.loco.flags;
    an.setAuto(lf.guarding ? 'guard' : lf.aiming && this.equip.rangedHeld ? 'aim' : null);

    // invisible figures keep their clocks and events but skip posing, IK and cloth
    const visible = root.visible;
    an.update(dt * (1 - this.frozen), dt, this.stance, this.fillSolveOpts(this.pinsModel(mw, dt)), this.rig.bones, yawRate, visible);
    if (!visible) { this.hidden = true; return; }
    if (this.hidden) { this.hidden = false; for (const c of this.cloth) c.reset(); }

    const sv = an.solver;
    const needCaps = this.cloth.length > 0 || !!this.fig.items.melee?.blades;
    if (needCaps) this.updateCapsules();
    this.equip.update(dt, sv, this.caps, BLADE_CAPS);
    if (this.cloth.length) {
      const carry = an.paused ? 1 : this.frozen;
      const seat = an.seat;
      for (const c of this.cloth) {
        if (seat > 0.08) { const h = sv.wp[this.fig.spec.index.hips]; c.seat.x = h.x; c.seat.z = h.z; c.seat.y = seat; c.seat.r = 0.34; } else c.seat.r = 0;
        c.update(dt, mw, sv.wp, sv.wq, this.fig.spec.rest, this.caps, scale, carry);
      }
    }
    root.updateMatrixWorld(true);
  }

  private readonly solveOpts: SolveOpts = { heldL: false, heldR: false, grip2: null, grip2Rot: null, pins: null, barrel: null, tips: null };
  private readonly pinOut: Array<{ pos: THREE.Vector3; w: number } | null> = [null, null];
  private readonly pinSlots = [{ pos: new THREE.Vector3(), w: 0 }, { pos: new THREE.Vector3(), w: 0 }];

  private fillSolveOpts(pins: SolveOpts['pins']): SolveOpts {
    const so = this.solveOpts, eq = this.equip;
    so.heldL = eq.heldL; so.heldR = eq.heldR;
    so.grip2 = eq.hasGrip2 ? eq.grip2 : null; so.grip2Rot = eq.hasGrip2 ? eq.grip2Rot : null;
    so.barrel = eq.barrel; so.tips = eq.tips;
    so.pins = pins;
    return so;
  }

  private pinsModel(mw: THREE.Matrix4, dt: number): Array<{ pos: THREE.Vector3; w: number } | null> | null {
    if (!this.pins[0] && !this.pins[1]) return null;
    let any = false;
    for (let s = 0; s < 2; s++) {
      const p = this.pins[s];
      if (!p) { this.pinOut[s] = null; continue; }
      p.w += (p.target - p.w) * (1 - Math.exp(-9 * dt));
      if (p.w < 0.004 && p.target === 0) { this.pins[s] = null; this.pinOut[s] = null; continue; }
      if (!any) { _m.copy(mw).invert(); any = true; }
      const slot = this.pinSlots[s];
      slot.pos.copy(p.pos).applyMatrix4(_m); slot.w = p.w;
      this.pinOut[s] = slot;
    }
    return this.pinOut;
  }

  private updateCapsules(): void {
    const sv = this.animator.solver, I = this.fig.spec.index, g = this.fig.girth, k = this.fig.spec.prop.bulk;
    const set = (i: number, a: number, b: number, r: number, lift = 0): void => {
      const c = this.caps[i];
      c.a.copy(sv.wp[a]); c.b.copy(sv.wp[b]); c.b.y += lift; c.r = r;
    };
    set(0, I.hips, I.chest, 0.15 * k * g);
    set(1, I.chest, I.neck, 0.165 * k * g, -0.06);
    set(2, I.thighL, I.shinL, 0.1 * k);
    set(3, I.thighR, I.shinR, 0.1 * k);
    set(4, I.shinL, I.footL, 0.075 * k);
    set(5, I.shinR, I.footR, 0.075 * k);
    set(6, I.uArmL, I.fArmL, 0.07 * k * g);
    set(7, I.uArmR, I.fArmR, 0.07 * k * g);
    set(8, I.hips, I.hips, 0.19 * k * g, -0.06);
    set(9, I.fArmL, I.handL, 0.055 * k);
    set(10, I.fArmR, I.handR, 0.055 * k);
    // the weapon hand's own forearm stops short of the wrist, where the hilt lives
    this.caps[10].b.lerp(this.caps[10].a, 0.2);
    const head = this.caps[11];
    head.a.copy(sv.wp[I.head]); head.b.set(0, 0.14, -0.01).applyQuaternion(sv.wq[I.head]).add(head.a); head.r = 0.115;
    const w = this.caps[CAP_WEAPON];
    w.r = this.equip.weaponSegment(sv, w.a, w.b) ? 0.03 : 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.shadowMaterial?.dispose();
    this.rig.skeleton.dispose();
    for (const o of this.overlays) o.mat.dispose();
    releaseFigure(this.fig);
  }
}

function clamp01(v: number): number { return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0; }
