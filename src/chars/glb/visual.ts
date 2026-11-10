/**
 * GlbHumanoidVisual — a HumanoidVisual that LOOKS like a generated mesh and MOVES like the procedural figure.
 *
 * The procedural humanoid is the animation DRIVER: it owns the root, the animator, the events, the equipment
 * state and the cloth-free skeleton; every CharacterVisual call is delegated to it. Each update the driver's
 * solved pose is retargeted onto the generated skeleton (retarget.ts), the generated props are placed in the
 * visible hands / on the visible body, and sockets follow the visible mesh.
 *
 * Until the model is loaded the driver is simply the procedural figure, drawn as itself; the generated body
 * takes over on the first update after it arrives (animation state, loadout and callbacks carry over because
 * the driver never changes). A model that cannot be loaded leaves the procedural figure in place for good.
 */
import * as THREE from 'three';
import type { ActionInfo, AnimAction, CharacterCreateOpts, Game, HumanoidArchetype, HumanoidLoadout, HumanoidVisual, PlayOpts, SocketName, Vec3Like } from '@/core/api';
import { createHumanoid } from '../humanoid';
import { HumanoidVisualImpl, type HumanoidRetargetAccess } from '../humanoid/visual';
import { ARCHETYPES } from '../humanoid/archetypes';
import { getFigure, mountQuat, releaseFigure, retainFigure, type FigureDef, type ItemDef, type Mount } from '../humanoid/figure';
import { GENERIC } from '../humanoid/clips/generic';
import { createFigureMaterial, type FigureMaterial } from '../humanoid/material';
import { ITEM_SLOTS, MASK_NONE, type GlbArchetype, type ItemSlot } from './config';
import type { ModelInstance, ModelLibrary } from './library';
import { createGlbMaterial, createSharedUniforms, type GlbMaterial, type SharedUniforms } from './material';
import { generatedProp, proceduralProp, type PropRig } from './props';
import { Retargeter } from './retarget';
import { flashStrength } from '@/chars/flash';
import type { RigInfo } from './analyze';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _v = new THREE.Vector3();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qh = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _rootInv = new THREE.Matrix4();
const _col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
/** how much a thigh holster follows the leg (the rest follows the pelvis) */
const HOLSTER_LEG = 0.55;
/** generated ranged props longer than this (metres) are slung on the back instead of holstered on the thigh */
const LONG_GUN = 0.45;
/** orientation of a slung long gun in the chest frame: grip up toward the right shoulder, flat against the back */
const SLING = mountQuat({ parent: 'chest', pos: [0, 0, 0], axes: { z: [0.42, 0.9, -0.05], x: [0, 0.06, 1] } }, new THREE.Quaternion());
const warned = new Set<string>();
function warnOnce(msg: string): void { if (!warned.has(msg)) { warned.add(msg); console.warn('[glb] ' + msg); } }
function hash01(n: number): number { const s = Math.sin(n * 91.345 + 17.13) * 43758.5453; return s - Math.floor(s); }
const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/** exposed "parts" as bands of body height (fraction from the sole) */
const EXPOSE_BAND: Record<string, [number, number]> = {
  head: [0.86, 1.05], chest: [0.6, 0.83], core: [0.6, 0.83], back: [0.6, 0.83], vent: [0.6, 0.83],
  arm: [0.45, 0.8], leg: [0.08, 0.5], joint: [0.2, 0.34], body: [0, 1.1], shield: [0, 1.1], weapon: [0, 1.1],
};

/** the procedural item drawn for a slot that has no generated prop: its own geometry on the driver's skeleton */
interface Fallback { mesh: THREE.SkinnedMesh; fig: FigureDef; fm: FigureMaterial }

interface PropState {
  rig: PropRig;
  item: ItemDef;
  fallback: Fallback | null;
  /** driver bone the item last hung from ('' = hidden) */
  parent: string;
  /** offset that is still being blended away after the item changed hands */
  carry: THREE.Vector3;
  /** rest-pose mount point on the generated body per driver parent bone */
  mounts: Map<string, THREE.Vector3>;
}

interface Body {
  inst: ModelInstance;
  retarget: Retargeter;
  materials: GlbMaterial[];
  /** root-space group holding prop holders */
  attach: THREE.Group;
  sockets: Record<string, THREE.Object3D>;
  props: PropState[];
  extras: Array<{ dispose(): void }>;
  height: number;
}

export class GlbHumanoidVisual implements HumanoidVisual {
  readonly archetype: HumanoidArchetype;
  readonly root: THREE.Object3D;
  private readonly driver: HumanoidVisualImpl;
  private readonly acc: HumanoidRetargetAccess;
  private readonly shared: SharedUniforms;
  private readonly scale: number;
  private readonly seed: number;
  private readonly variant: number;
  private readonly tint = new THREE.Color(1, 1, 1);
  private body: Body | null = null;
  private gaveUp = false;
  private seenVersion = -1;
  private flashLeft = 0;
  private flashDur = 0.12;
  private flashPeak = 1;
  private readonly pins: Array<{ pos: THREE.Vector3; w: number; target: number } | null> = [null, null];
  private exposed: { part: string; amount: number } | null = null;
  private disposed = false;

  constructor(game: Game | null, archetype: HumanoidArchetype, private readonly cfg: GlbArchetype, private readonly lib: ModelLibrary, opts: CharacterCreateOpts = {}) {
    this.archetype = archetype;
    this.seed = Number.isFinite(opts.seed) ? Math.floor(opts.seed as number) : 0;
    this.variant = Number.isFinite(opts.variant) ? Math.floor(opts.variant as number) : 0;
    const jitter = cfg.vary ? 1 + (hash01(this.seed * 1.31 + 2.7) - 0.5) * 0.06 : 1;
    this.scale = (opts.scale && opts.scale > 0 ? opts.scale : 1) * jitter;
    if (cfg.tint) this.tint.setRGB(cfg.tint[0], cfg.tint[1], cfg.tint[2]);
    if (cfg.vary) {
      const v = 0.9 + hash01(this.seed * 1.9 + 3) * 0.2, w = (hash01(this.seed * 3.1 + 7) - 0.5) * 0.08;
      this.tint.r *= v * (1 + w); this.tint.g *= v; this.tint.b *= v * (1 - w);
    }
    const ready = this.ready();
    // with the model in hand the driver needs no geometry of its own; otherwise it is the figure until it arrives
    this.driver = createHumanoid(game, archetype, { seed: opts.seed, variant: opts.variant, scale: opts.scale, driverOnly: ready }) as HumanoidVisualImpl;
    this.acc = this.driver.retargetAccess();
    this.root = this.driver.root;
    this.root.name = 'glbHumanoid:' + archetype;
    this.shared = createSharedUniforms(this.seed);
    const rim = this.acc.fig.rim;
    _col.set(rim.color);
    this.shared.uRim.value.set(_col.r, _col.g, _col.b, clamp01(rim.amount) * 1.6);
    if (opts.corruption !== undefined) this.setCorruption(opts.corruption);
    if (ready) this.attach();
  }

  /** body and every prop it uses are loaded (or known to be unobtainable, which means "use the fallback") */
  private ready(): boolean {
    const lib = this.lib;
    if (!lib.has(this.cfg.model)) return false;
    for (const slot of ITEM_SLOTS) {
      const p = this.cfg.props[slot];
      if (p && !lib.has(p) && !lib.unavailable(p)) return false;
    }
    return true;
  }

  get height(): number { return this.body ? this.body.height : this.driver.height; }
  get radius(): number { return this.driver.radius; }
  get triangles(): number {
    const b = this.body;
    if (!b) return this.driver.triangles;
    let n = b.inst.template.triangles;
    for (const p of b.props) n += p.rig.triangles;
    return n;
  }
  /** true once the generated body is what is being drawn */
  get generated(): boolean { return !!this.body; }
  /** what was measured from the generated mesh (debug overlays, sandbox); null while procedural */
  get rigInfo(): RigInfo | null { return this.body?.inst.template.rig ?? null; }

  get onFootstep(): ((foot: 'L' | 'R', world: THREE.Vector3) => void) | null { return this.driver.onFootstep; }
  set onFootstep(fn: ((foot: 'L' | 'R', world: THREE.Vector3) => void) | null) { this.driver.onFootstep = fn; }

  // ---- taking over from the procedural figure -------------------------------------------------------------

  private attach(): void {
    const cfg = this.cfg, g = this.scale;
    const inst = this.lib.instantiate(cfg.model);
    const rig = inst?.template.rig;
    if (!inst || !inst.mesh || !rig) { this.gaveUp = true; return; }
    let retarget: Retargeter;
    try {
      inst.root.scale.setScalar(g);
      retarget = new Retargeter(inst.root, rig, g, this.acc.fig.spec);
    } catch (err) {
      warnOnce(`"${cfg.model}" could not be bound to the ${this.archetype} animator (${String((err as Error)?.message ?? err)}) — procedural figure stays`);
      this.gaveUp = true;
      return;
    }
    // the procedural body steps aside; its skeleton keeps animating at the generated body's leg length
    const model = this.acc.model;
    for (const c of model.children) if (c.name === 'lod' || c.name === 'shadow') c.visible = false;
    model.scale.setScalar(retarget.driverScale);
    this.driver.teleported();

    const materials: GlbMaterial[] = [];
    inst.meshes.forEach((mesh, i) => {
      const gm = createGlbMaterial(inst.template.materials[i] ?? inst.template.materials[0], this.shared, {
        mask: cfg.mask, rest: rig.restMatrix, albedoCap: cfg.albedoCap, envIntensity: cfg.env, doubleSided: true,
      });
      gm.own.uTint.value.copy(this.tint);
      mesh.material = gm.material;
      mesh.customDepthMaterial = gm.depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      materials.push(gm);
    });
    const attach = new THREE.Group();
    attach.name = 'equipment';
    const body: Body = { inst, retarget, materials, attach, sockets: {}, props: [], extras: [], height: (inst.template.entry.height ?? rig.height) * g };
    this.buildSockets(body);
    this.buildProps(body);
    this.buildExtras(body);
    this.root.add(inst.root, attach);
    this.body = body;
    if (this.exposed) this.setExposed(this.exposed.part, this.exposed.amount);
  }

  private buildSockets(body: Body): void {
    const rt = body.retarget, rig = body.inst.template.rig!, g = this.scale;
    const make = (name: string, role: string, at: THREE.Vector3): void => {
      const o = new THREE.Object3D();
      o.name = 'socket:' + name;
      if (rt.attachSocket(role, at, o)) body.sockets[name] = o;
    };
    const neckRole = rt.has('neck') ? 'neck' : 'head';
    const hips = rt.restPos('hips', new THREE.Vector3()), neck = rt.restPos(neckRole, new THREE.Vector3()), head = rt.restPos('head', new THREE.Vector3());
    const skull = Math.max(0.08, body.height - head.y);
    const chest = hips.clone().lerp(neck, 0.73);
    chest.z -= 0.02 * g;
    make('hips', 'hips', hips);
    make('chest', rt.chestRole, chest);
    make('core', rt.chestRole, chest);
    make('back', rt.chestRole, new THREE.Vector3(chest.x, chest.y + 0.02 * g, neck.z + (rig.metrics.backDepth + 0.03) * g));
    make('head', 'head', new THREE.Vector3(head.x, head.y + skull * 0.45, head.z));
    make('eye', 'head', new THREE.Vector3(head.x, head.y + skull * 0.47, head.z - skull * 0.42));
    make('handL', 'handL', rig.hands.L.grip.clone().multiplyScalar(g));
    make('handR', 'handR', rig.hands.R.grip.clone().multiplyScalar(g));
  }

  private buildProps(body: Body): void {
    const items = this.acc.fig.items, s = body.retarget.driverScale;
    for (const slot of ITEM_SLOTS) {
      const item = items[slot];
      if (!item) continue;
      const name = this.cfg.props[slot];
      let rig = name ? generatedProp(this.lib, name, slot, this.shared, this.scale) : null;
      let fallback: Fallback | null = null;
      if (!rig) {
        rig = proceduralProp(slot, item, s);
        fallback = this.buildFallback(slot);
      }
      body.attach.add(rig.holder);
      for (const k of Object.keys(rig.sockets)) body.sockets[k] = rig.sockets[k];
      body.props.push({ rig, item, fallback, parent: '', carry: new THREE.Vector3(), mounts: new Map() });
    }
    // the driver exposes weapon / shield sockets even for figures that carry neither: keep them, in the visible hand
    const spec = this.acc.fig.spec, I = spec.index, R = spec.rest;
    const restOffset = (bone: string, parent: string): [number, number, number] => [R[I[bone] * 3] - R[I[parent] * 3], R[I[bone] * 3 + 1] - R[I[parent] * 3 + 1], R[I[bone] * 3 + 2] - R[I[parent] * 3 + 2]];
    const ghosts: Array<[ItemSlot, ItemDef]> = [];
    if (!items.melee) ghosts.push(['melee', { bone: 'weapon', held: { parent: 'handR', pos: restOffset('weapon', 'handR') }, sheath: null, sockets: { weaponBase: [0, 0, -0.08], weaponMid: [0, 0, -0.5], weaponTip: [0, 0, -1] } }]);
    if (!items.shield) ghosts.push(['shield', { bone: 'shield', held: { parent: 'fArmL', pos: restOffset('shield', 'fArmL') }, sheath: null }]);
    for (const [slot, item] of ghosts) {
      const rig = proceduralProp(slot, item, s);
      rig.tip = null;
      body.attach.add(rig.holder);
      for (const k of Object.keys(rig.sockets)) body.sockets[k] = rig.sockets[k];
      body.props.push({ rig, item, fallback: null, parent: '', carry: new THREE.Vector3(), mounts: new Map() });
    }
    // energy fields and the like ride the item they belong to, not the driver's bone
    for (const bone of this.acc.rig.bones) {
      for (const child of bone.children.slice()) {
        if (!child.name.startsWith('overlay:')) continue;
        const st = body.props.find((p) => p.item.bone === bone.name);
        if (!st) continue;
        st.rig.holder.add(child);
        child.scale.setScalar(s);
      }
    }
    if (!body.sockets.muzzle && body.sockets.handR) body.sockets.muzzle = body.sockets.handR;
  }

  /** The archetype's own procedural item for `slot`, skinned to the driver's skeleton and drawn where the holder is. */
  private buildFallback(slot: ItemSlot): Fallback | null {
    const def = ARCHETYPES[this.archetype];
    if (!def) return null;
    const fig = getFigure(this.archetype, def, GENERIC, this.seed, this.variant, new Set<string>([slot]));
    if (!fig.geometry || fig.spec.names.length !== this.acc.fig.spec.names.length) return null;
    retainFigure(fig);
    const fm = createFigureMaterial({ seed: this.seed });
    const mesh = new THREE.SkinnedMesh(fig.geometry, fm.material);
    mesh.name = 'fallback:' + slot;
    // detached: the skeleton already carries the figure's world transform; the mesh's own matrix is only the
    // offset between the driver's hand and the visible one
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.bind(this.acc.rig.skeleton, new THREE.Matrix4());
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.customDepthMaterial = fm.depth;
    this.root.add(mesh);
    const u = fm.uniforms, sh = this.shared;
    u.uFrozen.value = sh.uFrozen.value; u.uCorruption.value = sh.uCorruption.value; u.uDissolve.value = sh.uDissolve.value;
    u.uDissolveColor.value.copy(sh.uDissolveColor.value); u.uGlow.value = sh.uGlow.value;
    u.uTelegraph.value.copy(sh.uTelegraph.value); u.uRim.value.copy(sh.uRim.value);
    return { mesh, fig, fm };
  }

  private buildExtras(body: Body): void {
    const rt = body.retarget, rig = body.inst.template.rig!, g = this.scale;
    if (this.cfg.extra === 'satchel') {
      // a medic's side bag on the left hip, its strap implied by the jacket
      const gm = createGlbMaterial(new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.82, metalness: 0.02 }), this.shared, { mask: MASK_NONE });
      const geo = new THREE.BoxGeometry(0.1 * g, 0.2 * g, 0.26 * g, 2, 2, 2);
      const bag = new THREE.Mesh(geo, gm.material);
      bag.name = 'satchel';
      bag.castShadow = true;
      bag.customDepthMaterial = gm.depth;
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.104 * g, 0.03 * g, 0.12 * g), gm.material);
      cross.position.y = 0.02 * g;
      bag.add(cross);
      const mid = rt.restPos('thighL', new THREE.Vector3());
      const holder = new THREE.Object3D();
      if (rt.attachSocket('hips', new THREE.Vector3(-(rig.metrics.hipHalfWidth + 0.055) * g, mid.y - 0.04 * g, mid.z + 0.02 * g), holder)) {
        holder.add(bag);
        body.extras.push({ dispose() { holder.removeFromParent(); geo.dispose(); cross.geometry.dispose(); gm.dispose(); } });
      } else { geo.dispose(); cross.geometry.dispose(); gm.dispose(); }
    }
  }

  // ---- delegation: animation ----------------------------------------------------------------------------------

  setLocomotion(speed: number, moveYaw?: number, opts?: { sprint?: boolean; aiming?: boolean; guarding?: boolean; injured?: boolean }): void { this.driver.setLocomotion(speed, moveYaw, opts); }
  play(action: AnimAction, opts?: PlayOpts): ActionInfo { return this.driver.play(action, opts); }
  stop(action?: AnimAction, fade?: number): void { this.driver.stop(action, fade); }
  isPlaying(action?: AnimAction): boolean { return this.driver.isPlaying(action); }
  info(action: AnimAction): ActionInfo { return this.driver.info(action); }
  lookAt(target: Vec3Like | null): void { this.driver.lookAt(target); }
  setAimPitch(pitch: number): void { this.driver.setAimPitch(pitch); }
  setSpeaking(amount: number): void { this.driver.setSpeaking(amount); }
  setLoadout(opts: HumanoidLoadout): void { this.driver.setLoadout(opts); }

  setHandTarget(hand: 'L' | 'R', target: Vec3Like | null, weight = 1): void {
    this.driver.setHandTarget(hand, target, weight);
    const s = hand === 'L' ? 0 : 1;
    if (!target) { const p = this.pins[s]; if (p) p.target = 0; return; }
    const p = (this.pins[s] ??= { pos: new THREE.Vector3(), w: 0, target: 0 });
    p.pos.set(target.x, target.y, target.z);
    p.target = clamp01(weight);
  }

  teleported(): void {
    this.driver.teleported();
    if (this.body) for (const p of this.body.props) p.carry.set(0, 0, 0);
  }

  socket(name: SocketName): THREE.Object3D {
    const b = this.body;
    if (!b) return this.driver.socket(name);
    if (name === 'root') return this.root;
    return b.sockets[name] ?? this.root;
  }

  // ---- state effects ----------------------------------------------------------------------------------------

  flash(color: number, seconds = 0.12, strength?: number): void {
    _col.set(Number.isFinite(color) ? color : 0xffffff);
    this.flashPeak = flashStrength(strength);
    this.shared.uFlash.value.set(_col.r, _col.g, _col.b, this.flashPeak);
    this.flashDur = Number.isFinite(seconds) ? Math.max(0.01, seconds) : 0.12;
    this.flashLeft = this.flashDur;
    if (!this.body) this.driver.flash(color, seconds, strength);
    this.eachFallback((f) => { f.fm.uniforms.uFlash.value.copy(this.shared.uFlash.value); });
  }

  setFrozen(amount: number): void {
    const a = clamp01(amount);
    this.shared.uFrozen.value = a;
    // always forwarded: the driver's clocks slow with it
    this.driver.setFrozen(a);
    this.eachFallback((f) => { f.fm.uniforms.uFrozen.value = a; });
  }

  setCorruption(amount: number): void {
    const a = clamp01(amount);
    this.shared.uCorruption.value = a;
    if (!this.body) this.driver.setCorruption(a);
    this.eachFallback((f) => { f.fm.uniforms.uCorruption.value = a; });
  }

  setDissolve(amount: number, color?: number): void {
    const a = clamp01(amount);
    this.shared.uDissolve.value = a;
    if (color !== undefined) this.shared.uDissolveColor.value.set(color);
    // (after the take-over the driver's own meshes stay hidden: its setDissolve would show them again)
    if (!this.body) this.driver.setDissolve(a, color);
    else {
      for (const m of this.body.inst.meshes) m.visible = a < 0.999;
      this.eachFallback((f) => { f.fm.uniforms.uDissolve.value = a; if (color !== undefined) f.fm.uniforms.uDissolveColor.value.set(color); });
    }
  }

  setGlow(amount: number): void {
    const a = Math.max(0, Number.isFinite(amount) ? amount : 1);
    this.shared.uGlow.value = a;
    if (!this.body) this.driver.setGlow(a);
    this.eachFallback((f) => { f.fm.uniforms.uGlow.value = a; });
  }

  setTelegraph(amount: number, color = 0xff5a2a): void {
    _col.set(color);
    this.shared.uTelegraph.value.set(_col.r, _col.g, _col.b, clamp01(amount));
    if (!this.body) this.driver.setTelegraph(amount, color);
    this.eachFallback((f) => { f.fm.uniforms.uTelegraph.value.copy(this.shared.uTelegraph.value); });
  }

  setExposed(part: string, amount: number): void {
    this.exposed = { part, amount };
    const b = this.body;
    if (!b) { this.driver.setExposed(part, amount); return; }
    let band = EXPOSE_BAND[part];
    if (!band) { warnOnce(`setExposed: unknown part "${part}" on ${this.archetype}`); band = EXPOSE_BAND.chest; }
    const h = b.height / this.scale;
    for (const m of b.materials) { m.own.uExposed.value.set(band[0] * h, band[1] * h); m.own.uParams.value.w = clamp01(amount); }
  }

  setRim(amount: number, color?: number): void {
    const u = this.shared.uRim.value;
    if (color !== undefined) { _col.set(color); u.x = _col.r; u.y = _col.g; u.z = _col.b; }
    u.w = clamp01(amount) * 1.6;
    if (!this.body) this.driver.setRim(amount, color);
    this.eachFallback((f) => { f.fm.uniforms.uRim.value.copy(u); });
  }

  setVisible(v: boolean): void { this.driver.setVisible(v); }

  private eachFallback(fn: (f: Fallback) => void): void {
    if (!this.body) return;
    for (const p of this.body.props) if (p.fallback) fn(p.fallback);
  }

  // ---- update -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (this.disposed) return;
    if (!(dt >= 0) || !Number.isFinite(dt)) dt = 0;
    dt = Math.min(dt, 0.25);
    if (!this.body && !this.gaveUp && this.lib.version !== this.seenVersion) {
      this.seenVersion = this.lib.version;
      if (this.ready()) this.attach();
      else if (this.lib.unavailable(this.cfg.model)) this.gaveUp = true;
    }
    this.driver.update(dt);
    const b = this.body;
    if (!b) return;
    this.shared.uTime.value += dt;
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      this.shared.uFlash.value.w = Math.max(0, this.flashLeft / this.flashDur) * this.flashPeak;
    }
    for (const p of b.props) {
      if (!p.fallback) continue;
      const u = p.fallback.fm.uniforms;
      u.uTime.value = this.shared.uTime.value;
      u.uFlash.value.w = this.shared.uFlash.value.w;
    }
    if (!this.root.visible) return;

    const acc = this.acc, sv = acc.solver, I = acc.fig.spec.index, rt = b.retarget, eq = acc.equip;
    const s = acc.model.scale.x || 1;
    rt.pose(sv.wp, sv.wq, s);
    this.root.updateWorldMatrix(true, false);
    _rootInv.copy(this.root.matrixWorld).invert();

    // pinned palms reach the same world points as the driver's
    for (let side = 0; side < 2; side++) {
      const pin = this.pins[side];
      if (!pin) continue;
      pin.w += (pin.target - pin.w) * (1 - Math.exp(-9 * dt));
      if (pin.w < 0.004 && pin.target === 0) { this.pins[side] = null; continue; }
      rt.pullHand(side, _t.copy(pin.pos).applyMatrix4(_rootInv), pin.w);
    }
    // two-handed items: the off hand closes on the visible weapon, which sits in the visible right hand
    if (eq.hasGrip2 && eq.heldR) {
      const hR = I.handR, hL = I.handL;
      _a.copy(sv.palm[1]).add(eq.grip2).applyQuaternion(sv.wq[hR]).add(sv.wp[hR]);
      _b.copy(sv.palm[0]).applyQuaternion(sv.wq[hL]).add(sv.wp[hL]);
      const w = 1 - smooth(0.02, 0.1, _a.distanceTo(_b));
      if (w > 0) {
        _c.copy(sv.palm[1]).applyQuaternion(sv.wq[hR]).add(sv.wp[hR]).multiplyScalar(s);
        rt.grip(1, _t).sub(_c).addScaledVector(_a, s);
        rt.pullHand(0, _t, w);
      }
    }
    rt.setCurl(0, sv.curl[0]);
    rt.setCurl(1, sv.curl[1]);
    rt.apply();
    this.placeProps(b, dt, s);
    this.root.updateMatrixWorld(true);
  }

  /**
   * Root-space position of the visible item for its current driver parent (`bonePos` / `boneQuat`: the driver's
   * equipment bone in root space; `boneQuat` is replaced where the generated item is carried differently).
   */
  private mountPoint(b: Body, p: PropState, parent: string, bonePos: THREE.Vector3, boneQuat: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
    const rt = b.retarget;
    if (parent === 'handR') return rt.grip(1, out);
    if (parent === 'handL') return rt.grip(0, out);
    if (p.rig.slot === 'ranged' && p.rig.length > LONG_GUN * this.scale && parent.startsWith('thigh')) {
      // a carbine does not fit a thigh holster: it is slung across the back, grip toward the right shoulder
      let m = p.mounts.get('sling');
      if (!m) {
        const g = this.scale, met = b.inst.template.rig!.metrics;
        m = rt.restPos(rt.has('neck') ? 'neck' : 'head', new THREE.Vector3());
        m.x += 0.13 * g; m.y -= 0.1 * g; m.z += (met.backDepth + 0.06) * g;
        p.mounts.set('sling', m);
      }
      boneQuat.copy(this.acc.solver.wq[this.acc.fig.spec.index.chest]).multiply(SLING);
      return rt.carry(rt.chestRole, m, out);
    }
    const role = parent === 'chest' ? rt.chestRole : parent === 'spine' ? rt.waistRole : parent;
    const mount = p.item.held.parent === parent ? p.item.held : p.item.sheath && p.item.sheath.parent === parent ? p.item.sheath : null;
    if (!mount || !rt.has(role)) return out.copy(bonePos);
    let m = p.mounts.get(parent);
    if (!m) { m = this.restMount(b, parent, role, mount); p.mounts.set(parent, m); }
    rt.carry(role, m, out);
    if (parent.startsWith('thigh')) {
      // a holster hangs from the belt as much as it is strapped to the leg: skin this high on the thigh only
      // half follows the bone, and a gun that swung with it alone would leave the body in a deep stride
      const I = this.acc.fig.spec.index, wq = this.acc.solver.wq;
      out.lerp(rt.carry('hips', m, _v), 1 - HOLSTER_LEG);
      _q2.copy(wq[I.hips]).multiply(_qh.copy(wq[I[parent]]).invert()).multiply(boneQuat);
      boneQuat.copy(_q2.slerp(boneQuat, HOLSTER_LEG));
    }
    return out;
  }

  /** Where a driver mount belongs on the generated body, in its rest pose: same landmark, real body thickness. */
  private restMount(b: Body, parent: string, role: string, mount: Mount): THREE.Vector3 {
    const rt = b.retarget, spec = this.acc.fig.spec, I = spec.index, R = spec.rest, s = rt.driverScale, g = this.scale;
    const met = b.inst.template.rig!.metrics;
    const src = (name: string, out: THREE.Vector3): THREE.Vector3 => out.fromArray(R, I[name] * 3).multiplyScalar(s);
    const m = new THREE.Vector3(mount.pos[0], mount.pos[1], mount.pos[2]).multiplyScalar(s);
    const side = Math.sign(mount.pos[0]);
    if (parent === 'chest' || parent === 'spine') {
      // landmark: the neck joint; carried gear sits just clear of the real back
      const neckRole = rt.has('neck') ? 'neck' : 'head';
      m.add(src(parent, _a)).sub(src('neck', _b));
      if (mount.pos[2] > 0.1) m.z = (met.backDepth + 0.05) * g;
      return m.add(rt.restPos(neckRole, _a));
    }
    if (parent === 'hips') {
      // landmark: mid-point of the hip joints; hip-hung gear sits on the real hip line
      m.add(src('hips', _a)).sub(src('thighL', _b).add(src('thighR', _c)).multiplyScalar(0.5));
      if (Math.abs(mount.pos[0]) > 0.05) m.x = side * (met.hipHalfWidth + 0.03) * g;
      return m.add(rt.restPos('thighL', _a).add(rt.restPos('thighR', _b)).multiplyScalar(0.5));
    }
    if (parent === 'thighL' || parent === 'thighR') {
      if (Math.abs(mount.pos[0]) > 0.03) m.x = side * (met.thighOuter[parent === 'thighL' ? 0 : 1] + 0.03) * g;
    } else if (parent === 'fArmL' || parent === 'fArmR') {
      // along the forearm in proportion, outside it by its real radius
      const si = parent === 'fArmL' ? 0 : 1, hand = si === 0 ? 'handL' : 'handR';
      const dl = src(parent, _a).distanceTo(src(hand, _b)), tl = rt.restPos(parent, _a).distanceTo(rt.restPos(hand, _b));
      if (dl > 1e-4) m.y *= tl / dl;
      if (Math.abs(mount.pos[0]) > 0.03) m.x = side * (met.forearmRadius[si] + 0.025) * g;
    }
    return rt.toRest(role, m).add(rt.restPos(role, _a));
  }

  private placeProps(b: Body, dt: number, s: number): void {
    const bones = this.acc.rig.byName;
    const decay = Math.exp(-14 * dt);
    for (const p of b.props) {
      const bone = bones[p.item.bone];
      const shown = !!bone && bone.scale.x > 0.01;
      p.rig.holder.visible = shown;
      if (p.fallback) p.fallback.mesh.visible = shown;
      if (!shown || !bone) { p.parent = ''; continue; }
      _m.multiplyMatrices(_rootInv, bone.matrixWorld).decompose(_p, _q, _s);
      const parent = bone.parent ? bone.parent.name : 'root';
      this.mountPoint(b, p, parent, _p, _q, _t);
      const holder = p.rig.holder;
      if (p.parent !== parent) {
        if (p.parent !== '') p.carry.copy(holder.position).sub(_t); else p.carry.set(0, 0, 0);
        p.parent = parent;
      } else p.carry.multiplyScalar(decay);
      holder.position.copy(_t).add(p.carry);
      holder.quaternion.copy(_q);

      // a long blade meets the floor where the driver's does, and never goes through it
      const tip = p.rig.tip, dtip = p.item.sockets?.weaponTip;
      if (tip && parent === 'handR') {
        const driverY = dtip ? _p.y + _v.set(dtip[0], dtip[1], dtip[2]).multiplyScalar(s).applyQuaternion(_q).y : Infinity;
        _v.copy(tip).applyQuaternion(_q);
        const len = _v.length(), mine = holder.position.y + _v.y;
        let want = mine;
        if (driverY < 0.35) want = mine + (Math.max(driverY, 0.015) - mine) * smooth(0.35, 0.06, driverY);
        if (want < 0.015) want = 0.015;
        if (len > 0.2 && Math.abs(want - mine) > 1e-4) {
          const e0 = Math.asin(Math.max(-1, Math.min(1, _v.y / len))), e1 = Math.asin(Math.max(-1, Math.min(1, (_v.y + want - mine) / len)));
          _ax.crossVectors(_v, UP);
          if (_ax.lengthSq() > 1e-8) holder.quaternion.premultiply(_q2.setFromAxisAngle(_ax.normalize(), e1 - e0));
        }
      }
      // energy blades are as long as the driver says (they shorten on their wielder and when sheathed)
      if (p.rig.blade) {
        const ba = bones.bladeA, bb = bones.bladeB;
        p.rig.blade.value.z = p.rig.bladeLength * (ba ? Math.max(0, Math.min(1, ba.scale.z)) : 1);
        p.rig.blade.value.w = p.rig.bladeLength * (bb ? Math.max(0, Math.min(1, bb.scale.z)) : 1);
      }
      if (p.fallback) {
        // world-space offset between the visible item and the driver's
        _a.copy(holder.position).applyMatrix4(this.root.matrixWorld);
        _b.copy(_p).applyMatrix4(this.root.matrixWorld);
        p.fallback.mesh.matrixWorld.makeTranslation(_a.x - _b.x, _a.y - _b.y, _a.z - _b.z);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const b = this.body;
    if (b) {
      for (const p of b.props) {
        p.rig.dispose();
        if (p.fallback) { p.fallback.mesh.removeFromParent(); p.fallback.fm.material.dispose(); p.fallback.fm.depth.dispose(); releaseFigure(p.fallback.fig); }
      }
      for (const e of b.extras) e.dispose();
      for (const m of b.materials) m.dispose();
      b.inst.mesh?.skeleton.dispose();
      b.inst.root.removeFromParent();
      b.attach.removeFromParent();
      this.body = null;
    }
    this.driver.dispose();
  }
}
