/**
 * HumanoidVisualImpl — the CharacterVisual for every humanoid archetype: one skinned mesh, one shared-program
 * material, a layered animator, cloth panels, equipment mounts and sockets.
 */
import * as THREE from 'three';
import type { ActionInfo, AnimAction, HumanoidArchetype, HumanoidVisual, PlayOpts, SocketName, Vec3Like } from '@/core/api';
import { ZONE } from './geo/builder';
import { instantiateRig, type RigInstance } from './rig';
import { createFigureMaterial, type FigureUniforms } from './material';
import { Animator } from './anim/animator';
import { resolveClip, resolveStance, type HeldKey } from './anim/moveset';
import type { StanceSet } from './anim/locomotion';
import { ClothSim, type ClothCapsule } from './cloth';
import type { FigureDef, ItemDef, Loadout, Mount } from './figure';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const _e = new THREE.Euler();
const HIDDEN = 1e-4;

const EXPOSE_ZONE: Record<string, number> = {
  head: ZONE.head, chest: ZONE.chest, core: ZONE.chest, back: ZONE.back, vent: ZONE.back, shield: ZONE.shield,
  weapon: ZONE.weapon, arm: ZONE.arm, leg: ZONE.leg, joint: ZONE.leg, body: ZONE.body,
};
const warned = new Set<string>();
function warnOnce(msg: string): void { if (!warned.has(msg)) { warned.add(msg); console.warn('[humanoid] ' + msg); } }

export class HumanoidVisualImpl implements HumanoidVisual {
  readonly archetype: HumanoidArchetype;
  readonly root = new THREE.Group();
  readonly height: number;
  readonly radius: number;
  readonly triangles: number;
  onFootstep: ((foot: 'L' | 'R', world: THREE.Vector3) => void) | null = null;

  private readonly model = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly rig: RigInstance;
  private readonly uniforms: FigureUniforms;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly animator: Animator;
  private readonly cloth: ClothSim[] = [];
  private readonly caps: ClothCapsule[] = [];
  private readonly sockets: Record<string, THREE.Object3D> = {};
  private readonly overlays: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number; with?: string }> = [];
  private readonly loadout: Loadout;
  private stance: StanceSet;
  private readonly grip2 = new THREE.Vector3();
  private readonly grip2Rot = new THREE.Quaternion();
  private hasGrip2 = false;
  private heldR = false;
  private heldL = false;
  private flashLeft = 0;
  private flashDur = 0.12;
  private frozen = 0;
  private glow = 1;
  private time = 0;
  private lastYaw = 0;
  private readonly lastPos = new THREE.Vector3();
  private first = true;
  private lookWorld: THREE.Vector3 | null = null;
  private readonly lookLocal = new THREE.Vector3();
  private readonly pins: Array<{ pos: THREE.Vector3; w: number; target: number } | null> = [null, null];
  private bladeExt = 1;
  private bladeTarget = 1;
  private disposed = false;

  constructor(private readonly fig: FigureDef, scale: number, seed: number) {
    this.archetype = fig.archetype;
    const s = fig.spec.scale * scale;
    this.height = fig.spec.prop.height * scale;
    this.radius = fig.radius * scale;
    this.triangles = fig.triangles;
    this.root.name = 'humanoid:' + fig.archetype;
    this.model.scale.setScalar(s);
    this.root.add(this.model);

    this.rig = instantiateRig(fig.spec);
    const fm = createFigureMaterial({ ghost: fig.ghost, luminous: fig.luminous });
    this.material = fm.material;
    this.uniforms = fm.uniforms;
    this.mesh = new THREE.SkinnedMesh(fig.geometry, this.material);
    this.mesh.name = 'body';
    this.mesh.castShadow = !fig.ghost;
    this.mesh.receiveShadow = !fig.ghost;
    this.mesh.frustumCulled = true;
    this.model.add(this.rig.bones[0]);
    this.model.add(this.mesh);
    this.mesh.bind(this.rig.skeleton, new THREE.Matrix4());

    this.animator = new Animator(fig.spec, (name) => resolveClip(fig.moveset, name));
    this.animator.headBias.set(fig.headBias[0] * DEG, fig.headBias[1] * DEG, fig.headBias[2] * DEG);
    this.animator.breath = fig.breath;
    this.animator.loco.onStep = (side) => {
      if (!this.onFootstep) return;
      const bone = this.rig.byName[side < 0 ? 'footL' : 'footR'];
      this.onFootstep(side < 0 ? 'L' : 'R', bone.getWorldPosition(_v));
    };

    for (let i = 0; i < fig.cloth.length; i++) this.cloth.push(new ClothSim(fig.cloth[i], this.rig.bones, seed * 3.1 + i));
    for (let i = 0; i < 9; i++) this.caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.1 });

    for (const o of fig.overlays) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color).multiplyScalar(o.intensity), transparent: true, opacity: o.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(o.geometry, mat);
      mesh.name = 'overlay:' + o.bone;
      (this.rig.byName[o.bone] ?? this.rig.bones[0]).add(mesh);
      this.overlays.push({ mesh, mat, base: o.opacity, with: o.with });
    }

    this.buildSockets();
    this.loadout = { ...fig.loadout };
    this.stance = resolveStance(fig.moveset, 'none');
    this.applyLoadout(true);

    this.setRim(fig.rim.amount, fig.rim.color);
    this.uniforms.uCorruption.value = fig.corruption;
    this.update(0);
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

  private mount(bone: THREE.Bone, m: Mount): void {
    const parent = this.rig.byName[m.parent] ?? this.rig.bones[0];
    if (bone.parent !== parent) parent.add(bone);
    bone.position.set(m.pos[0], m.pos[1], m.pos[2]);
    bone.quaternion.setFromEuler(_e.set(m.rot[0] * DEG, m.rot[1] * DEG, m.rot[2] * DEG, 'XYZ'));
    bone.scale.setScalar(1);
  }

  private place(item: ItemDef | undefined, held: boolean): void {
    if (!item) return;
    const bone = this.rig.byName[item.bone];
    if (held) this.mount(bone, item.held);
    else if (item.sheath) this.mount(bone, item.sheath);
    else bone.scale.setScalar(HIDDEN);
  }

  private applyLoadout(snap: boolean): void {
    const it = this.fig.items, lo = this.loadout;
    const rifleProp = lo.prop === 'rifle' && !!it.ranged?.rifle;
    const rangedHeld = (lo.ranged || rifleProp) && !!it.ranged;
    const meleeHeld = lo.melee && !!it.melee && !rangedHeld;
    this.place(it.melee, meleeHeld);
    this.place(it.ranged, rangedHeld);
    this.place(it.shield, lo.shield);
    this.place(it.case, lo.prop === 'case');
    for (const o of this.overlays) o.mesh.visible = o.with === 'shield' ? lo.shield : o.with === 'melee' ? meleeHeld : true;
    this.bladeTarget = meleeHeld ? 1 : 0;
    if (snap) this.bladeExt = this.bladeTarget;

    const main = rangedHeld ? it.ranged : meleeHeld ? it.melee : undefined;
    this.heldR = !!main;
    this.heldL = (lo.prop === 'case' && !!it.case) || (lo.shield && !!it.shield);
    this.hasGrip2 = !!main?.grip2;
    if (main?.grip2) {
      // grip2 is authored in the item's frame; bring it into the hand frame through the held mount rotation
      const r = main.held.rot;
      this.grip2Rot.setFromEuler(_e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ'));
      this.grip2.set(main.grip2[0], main.grip2[1], main.grip2[2]).applyQuaternion(this.grip2Rot);
      const g = main.grip2Rot ?? [0, 0, 0];
      this.grip2Rot.setFromEuler(_e.set(g[0] * DEG, g[1] * DEG, g[2] * DEG, 'XYZ'));
    }
    const key: HeldKey = rangedHeld ? 'ranged' : meleeHeld ? 'melee' : lo.prop === 'case' && it.case ? 'case' : 'none';
    this.stance = resolveStance(this.fig.moveset, key);
  }

  setLoadout(opts: { melee?: boolean; ranged?: boolean; shield?: boolean; prop?: 'case' | 'rifle' | 'none' }): void {
    if (!opts) return;
    const lo = this.loadout;
    if (opts.melee !== undefined) lo.melee = !!opts.melee;
    if (opts.ranged !== undefined) lo.ranged = !!opts.ranged;
    if (opts.shield !== undefined) lo.shield = !!opts.shield;
    if (opts.prop !== undefined) lo.prop = opts.prop === 'case' || opts.prop === 'rifle' ? opts.prop : 'none';
    this.applyLoadout(false);
  }

  // ---- animation ----------------------------------------------------------------------------------------

  setLocomotion(speed: number, moveYaw = 0, opts?: { sprint?: boolean; aiming?: boolean; guarding?: boolean; injured?: boolean }): void {
    // speeds arrive in world m/s; the rig works at reference scale
    this.animator.loco.setInput(speed / (this.model.scale.x || 1), moveYaw, opts);
  }

  play(action: AnimAction, opts?: PlayOpts): ActionInfo {
    const name = typeof action === 'string' && action ? action : 'idle';
    if (name === 'frozen') { this.animator.paused = true; return { duration: Infinity, hitTimes: [], loop: true }; }
    if (name === 'idle') { this.animator.stop(undefined, opts?.fade); return { duration: 0, hitTimes: [], loop: true }; }
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
    if (action === 'frozen') return { duration: Infinity, hitTimes: [], loop: true };
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
    this.mesh.castShadow = !this.fig.ghost && a < 0.35;
    this.mesh.visible = a < 0.999;
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

    // teleport / first frame: no leaning, no cloth whip
    _v.setFromMatrixPosition(mw);
    const yaw = root.rotation.y;
    let yawRate = 0;
    if (this.first || _v.distanceTo(this.lastPos) > 3) {
      this.animator.reset();
      for (const c of this.cloth) c.reset();
      this.first = false;
    } else if (dt > 1e-5) {
      let d = yaw - this.lastYaw;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      yawRate = d / dt;
    }
    this.lastPos.copy(_v);
    this.lastYaw = yaw;

    const adt = dt * (1 - this.frozen);
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      this.uniforms.uFlash.value.w = Math.max(0, this.flashLeft / this.flashDur);
    }

    // look target → model space
    if (this.lookWorld) {
      _m.copy(mw).invert();
      this.animator.setLook(this.lookLocal.copy(this.lookWorld).applyMatrix4(_m));
    } else this.animator.setLook(null);

    const an = this.animator;
    an.update(adt, this.stance, { heldL: this.heldL, heldR: this.heldR, grip2: this.hasGrip2 ? this.grip2 : null, grip2Rot: this.hasGrip2 ? this.grip2Rot : null, pins: this.pinsModel(mw, dt) }, this.rig.bones, yawRate);

    // Verity blades extend / retract
    if (this.fig.items.melee?.blades) {
      this.bladeExt += (this.bladeTarget - this.bladeExt) * (1 - Math.exp(-14 * dt));
      const k = Math.max(HIDDEN, this.bladeExt);
      this.rig.byName.bladeA.scale.set(1, 1, k);
      this.rig.byName.bladeB.scale.set(1, 1, k);
    }

    if (this.cloth.length) {
      this.updateCapsules();
      const sv = an.solver;
      for (const c of this.cloth) c.update(adt, mw, sv.wp, sv.wq, this.fig.spec.rest, this.caps, this.model.scale.x);
    }
    root.updateMatrixWorld(true);
  }

  private readonly pinOut: Array<{ pos: THREE.Vector3; w: number } | null> = [null, null];
  private readonly pinTmp = [new THREE.Vector3(), new THREE.Vector3()];

  private pinsModel(mw: THREE.Matrix4, dt: number): Array<{ pos: THREE.Vector3; w: number } | null> {
    let any = false;
    for (let s = 0; s < 2; s++) {
      const p = this.pins[s];
      if (!p) { this.pinOut[s] = null; continue; }
      p.w += (p.target - p.w) * (1 - Math.exp(-9 * dt));
      if (p.w < 0.004 && p.target === 0) { this.pins[s] = null; this.pinOut[s] = null; continue; }
      if (!any) { _m.copy(mw).invert(); any = true; }
      this.pinOut[s] = { pos: this.pinTmp[s].copy(p.pos).applyMatrix4(_m), w: p.w };
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
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.material.dispose();
    this.rig.skeleton.dispose();
    for (const o of this.overlays) o.mat.dispose();
  }
}

function clamp01(v: number): number { return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0; }
