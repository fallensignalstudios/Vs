/**
 * Kit core — the shared build context every kit module writes into, and `Part`, the per-piece mesh assembler.
 *
 * A builder call (`wall`, `prop`, `rib` …) creates one Part: a THREE.Group posed in the zone plus one geometry
 * buffer per material. `done()` turns the buffers into meshes flagged static; `finalize()` later bakes and merges
 * all static meshes by material. Dynamic parts (door leaves, barriers) are built with `local: true` so they use
 * the object-space materials and are never merged.
 */
import * as THREE from 'three';
import type { ColliderDesc, ColliderHandle, Game, MatId, PhysicsWorld, QualityProfile, SurfaceDesc, SurfaceFinish, SurfaceHandle, WallFinish } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { RENDER_LAYERS } from '@/core/api/render';
import { mulberry32 } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { Geo } from './geo';

export type MatRef = MatId | THREE.Material;

/**
 * A private PRNG for extra visual variation, seeded from numbers the caller already drew from the zone stream.
 * The zone's `rand` is ONE shared stream (prop variants, and so their colliders, depend on its position): a
 * piece that wants more randomness than it used to draw must take it from here, never from `ctx.rand`.
 */
export function localRand(...seeds: number[]): () => number {
  let h = 0x9e3779b9;
  for (const v of seeds) h = Math.imul(h ^ Math.floor((Number.isFinite(v) ? v : 0) * 4294967296), 0x85ebca6b) ^ (h >>> 13);
  return mulberry32(h >>> 0);
}

/** nominal width of the kit's thin light strips (channels, seams: 4.5–7 cm) for the glow's distance fade */
export const LINE_WIDTH = 0.06;

/** Materials that never cast shadows (light sources and see-through surfaces). */
const NO_CAST = new Set<string>([
  'goldChannel', 'whiteLight', 'domAmberGlow', 'refBlueGlow', 'eclipseVein', 'frostIce', 'glass', 'hologram',
  'shieldEnergy', 'quarantineBarrier',
]);

/** Flat stand-ins used when the material library is a null-object stub (colour, roughness, metalness, emissive). */
const FALLBACK: Partial<Record<MatId, [number, number, number, number?]>> = {
  whiteGold: [PALETTE.whiteGold, 0.42, 0.3], whiteGoldPanel: [PALETTE.whiteGold, 0.4, 0.3], whiteGoldFloor: [0xcfc8b6, 0.2, 0.25],
  goldTrim: [PALETTE.gold, 0.22, 1], goldDark: [PALETTE.goldDeep, 0.46, 1], blackStone: [0x101116, 0.15, 0], blackStoneFloor: [0x0b0c10, 0.1, 0],
  goldChannel: [0x5c4a22, 0.4, 0.6, 0xffc56b], whiteLight: [0x2a2620, 0.4, 0.6, 0xfff0d2],
  domBronze: [PALETTE.domBronze, 0.4, 1], domOxblood: [PALETTE.domOxblood, 0.5, 0], domBlack: [PALETTE.domBlack, 0.48, 0.75],
  domAmberGlow: [0x1c0e05, 0.4, 0.6, PALETTE.domAmber], domCloth: [0x4f1013, 0.92, 0],
  refNavy: [PALETTE.refNavy, 0.58, 0.35], refSlate: [PALETTE.refSlate, 0.62, 0.3], refSteel: [PALETTE.refSteel, 0.33, 1],
  refBlueGlow: [0x060a10, 0.4, 0.6, PALETTE.refBlue], refCloth: [0x1a2740, 0.8, 0],
  frostIce: [PALETTE.frost, 0.16, 0], frostRime: [0xe8f4fa, 0.66, 0], eclipseTissue: [0x1a1020, 0.3, 0],
  eclipseVein: [0x0c0514, 0.4, 0.6, PALETTE.eclipseViolet], eclipsePlate: [0x2a2030, 0.5, 0.45],
  glass: [0xdcecee, 0.04, 0], hologram: [PALETTE.refBlue, 1, 0], shieldEnergy: [PALETTE.domAmber, 1, 0], quarantineBarrier: [PALETTE.goldLight, 1, 0],
  darkWood: [0x2a1a10, 0.36, 0], agedLeather: [0x4a2e1c, 0.52, 0], rubble: [0x77736a, 0.86, 0], scorched: [0x3a332e, 0.9, 0],
  rubber: [0x121214, 0.82, 0], woundBlack: [0x000000, 1, 0],
};
const FALLBACK_TRANSPARENT = new Set<string>(['frostIce', 'glass', 'hologram', 'shieldEnergy', 'quarantineBarrier']);

const DEFAULT_QUALITY: QualityProfile = {
  level: 'high', resolutionScale: 1, maxPixelRatio: 1.5, shadows: true, shadowMapSize: 2048, ao: true, bloom: true, dof: true,
  reflections: true, volumetrics: true, particleScale: 1, maxShadowLights: 2, anisotropy: 8, textureSize: 1024,
};

/** Which substrate a piece belongs to: upper white-gold halls or the lower black-stone terminal. */
export interface Family { frame: MatId; panel: MatId; dark: boolean }
export function familyOf(mat: MatId | undefined): Family {
  return mat === 'blackStone' || mat === 'blackStoneFloor'
    ? { frame: 'blackStone', panel: 'blackStone', dark: true }
    : { frame: 'whiteGold', panel: 'whiteGoldPanel', dark: false };
}

export interface PartOpts {
  /** object-space materials + never merged (things that move) */
  local?: boolean;
  /** keep small dressing out of floor reflections / the reflection probe */
  noReflect?: boolean;
}

/** A light the builder may let cast shadows, in priority order. */
export interface ShadowCandidate { light: THREE.Light; wanted: boolean }

/**
 * Everything the kit modules share. Created once per ZoneBuilder.
 */
export class KitCtx {
  readonly physics: PhysicsWorld;
  /** objects whose geometry / material / texture the builder owns */
  readonly disposables = new Set<{ dispose(): void }>();
  readonly updaters: Array<(dt: number, time: number) => void> = [];
  readonly shadowLights: ShadowCandidate[] = [];
  readonly lights: THREE.Light[] = [];
  /** reflective floor meshes waiting for (or holding) a renderer registration: mesh → mirror height */
  readonly reflective = new Map<THREE.Mesh, number>();
  /** set by finalize(): from then on collider toggles (doors, barriers) refresh the nav grid themselves */
  finalized = false;
  private readonly warned = new Set<string>();
  private readonly fallbacks = new Map<string, THREE.Material>();
  private readonly inlays = new Map<string, THREE.Material>();
  private readonly templates = new Map<string, unknown>();
  private readonly matsOk: boolean;

  constructor(readonly game: Game, readonly root: THREE.Group, readonly rand: () => number) {
    this.physics = game.physics;
    this.matsOk = !isStub(game.mats) && typeof game.mats?.get === 'function';
  }

  /** plan → world (zone-local) */
  P(x: number, n: number, h = 0): THREE.Vector3 { return new THREE.Vector3(x, h, -n); }
  /** plan yaw degrees → world yaw radians */
  yaw(deg: number): number { return (-(deg || 0) * Math.PI) / 180; }

  warn(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[kit] ${msg}`);
  }

  /** finite number or the default — builder options never reach geometry as NaN */
  num(v: unknown, def: number, min = -Infinity, max = Infinity): number {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
    return n < min ? min : n > max ? max : n;
  }

  own<T extends { dispose(): void }>(d: T): T { this.disposables.add(d); return d; }

  /** shared material (world-space mapping) or its object-space twin for moving parts */
  mat(ref: MatRef, local = false): THREE.Material {
    if (typeof ref !== 'string') return ref;
    if (this.matsOk) {
      const m = local ? this.game.mats.getLocal(ref) : this.game.mats.get(ref);
      if (m && (m as THREE.Material).isMaterial) return m;
    }
    return this.fallback(ref);
  }

  private fallback(id: string): THREE.Material {
    let m = this.fallbacks.get(id);
    if (!m) {
      const f = FALLBACK[id as MatId] ?? [0x9a9488, 0.6, 0.2];
      const tr = FALLBACK_TRANSPARENT.has(id);
      m = this.own(new THREE.MeshStandardMaterial({
        color: f[0], roughness: f[1], metalness: f[2], emissive: f[3] ?? 0x000000, emissiveIntensity: f[3] !== undefined ? 3 : 0,
        transparent: tr, opacity: tr ? 0.3 : 1, depthWrite: !tr, side: tr ? THREE.DoubleSide : THREE.FrontSide,
      }));
      m.name = `kit-fallback:${id}`;
      this.fallbacks.set(id, m);
    }
    return m;
  }

  /** independent copy of a library material (owned and disposed by the builder) */
  clone<T extends THREE.Material = THREE.MeshStandardMaterial>(id: MatId, overrides?: Record<string, unknown>): T {
    if (this.matsOk) {
      const m = this.game.mats.clone<T>(id, overrides);
      if (m && (m as THREE.Material).isMaterial) return this.own(m);
    }
    const m = this.fallback(id).clone();
    const o = overrides ?? {};
    const vals: Record<string, unknown> = {};
    for (const k in o) if (k in m && o[k] !== undefined) vals[k] = o[k];
    m.setValues(vals as THREE.MaterialParameters);
    return this.own(m) as unknown as T;
  }

  /** set a named shader parameter on a material (no-op on fallback materials) */
  setParam(m: THREE.Material, name: string, value: number): void {
    if (this.matsOk) this.game.mats.setParam(m, name, value);
    else if (name === 'amount') m.opacity = 0.3 * value;
  }

  /** unlit-looking emissive of any colour (cached by the library) */
  emissive(color: number, intensity: number): THREE.Material {
    if (this.matsOk) {
      const m = this.game.mats.emissive(color, intensity);
      if (m && m.isMaterial) return m;
    }
    const key = `em:${color}:${intensity}`;
    let m = this.fallbacks.get(key);
    if (!m) {
      m = this.own(new THREE.MeshStandardMaterial({ color: 0, emissive: color, emissiveIntensity: intensity, roughness: 1 }));
      m.name = `emissive:${color.toString(16)}`;
      this.fallbacks.set(key, m);
    }
    return m;
  }

  /**
   * Polygon-offset twin of a material for geometry laid flush on another surface (floor inlays, wall strips):
   * no z-fighting at any distance. Cached per builder.
   */
  inlay(id: MatId, overrides?: Record<string, unknown>): THREE.Material {
    const key = overrides ? `${id}:${JSON.stringify(overrides)}` : id;
    let m = this.inlays.get(key);
    if (!m) {
      m = this.clone<THREE.Material>(id, overrides);
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -4;
      m.name = `kit-inlay:${key}`;
      this.inlays.set(key, m);
    }
    return m;
  }

  /** cached per-builder variation of a library material (dimmer seams, recoloured glows) — world-space mapped */
  variant(id: MatId, overrides: Record<string, unknown>): THREE.Material {
    const key = `v:${id}:${JSON.stringify(overrides)}`;
    let m = this.inlays.get(key);
    if (!m) {
      m = this.clone<THREE.Material>(id, overrides);
      m.name = `kit-glow:${id}`;
      this.inlays.set(key, m);
    }
    return m;
  }

  /**
   * the emissive gold channel as laid into floors: dimmer than a raw strip so long runs do not flood the bloom;
   * `lineWidth` fades a strip that has gone sub-pixel at distance instead of letting it shimmer
   */
  channel(): THREE.Material { return this.inlay('goldChannel', { emissiveIntensity: 1.9, lineWidth: LINE_WIDTH }); }
  /** architectural light seam (rib seams, pilaster strips): a calmer white-gold than a light panel */
  seam(dark = false): THREE.Material {
    return dark ? this.inlay('goldChannel', { emissiveIntensity: 2.2, lineWidth: LINE_WIDTH }) : this.inlay('whiteLight', { emissiveIntensity: 2.3, lineWidth: LINE_WIDTH });
  }

  /**
   * polish 3: the ivory of furniture-scale ancient pieces (consoles, pedestals, pylons, cover blocks): an aged,
   * slightly darker stone than the walls, so a desk under a spot models instead of reading as a white block
   */
  agedStone(): THREE.Material {
    const key = 'aged:whiteGold';
    let m = this.inlays.get(key);
    if (!m) {
      // (named apart from the kit-glow variants: this one is solid stone and casts shadows)
      // integration wave: a cool silver-grey, not a warm ivory (the paintings' furniture is pale grey marble)
      m = this.clone<THREE.Material>('whiteGold', { color: 0xc9ccd2 });
      m.name = 'kit-aged:whiteGold';
      this.inlays.set(key, m);
    }
    return m;
  }

  /**
   * ADDED (integration wave): the walking top of a floor / deck / ramp / bridge in a {@link SurfaceFinish}:
   * `'polished'` (or none) is the material itself; `'worn'` / `'hangar'` are cached per-builder clones wearing the
   * `stone_worn` / `concrete_hangar` photographic sets (rough: no mirror, no planar reflection).
   */
  finish(mat: MatId, finish: SurfaceFinish | undefined): MatRef {
    const surface = finish === 'worn' ? 'stone_worn' : finish === 'hangar' ? 'concrete_hangar' : finish === 'wet' ? 'floor_wet_grey' : null;
    if (!surface) {
      if (finish !== undefined && finish !== 'polished') this.warn(`finish:${String(finish)}`, `unknown finish "${String(finish)}" — using the polished top`);
      return mat;
    }
    return this.wearing(mat, surface, `finish:${mat}:${finish}`);
  }

  /**
   * ADDED (polish 4): a wall in a {@link WallFinish}: `'slab'` (default) is the material itself (white-gold = smooth
   * marble slabs now); `'ashlar'` is the coursed pale limestone of the integration wave (damaged and service areas).
   */
  wallFinish(mat: MatId, finish: WallFinish | undefined): MatRef {
    if (finish !== 'ashlar') {
      if (finish !== undefined && finish !== 'slab') this.warn(`wallFinish:${String(finish)}`, `unknown wall finish "${String(finish)}" — using the slab`);
      return mat;
    }
    if (mat === 'blackStone' || mat === 'blackStoneFloor') return mat;
    return this.wearing(mat, 'stone_pale', `wall:${mat}:ashlar`);
  }

  /** cached per-builder clone of `mat` wearing another photographic set */
  private wearing(mat: MatId, surface: string, key: string): THREE.Material {
    let m = this.inlays.get(key);
    if (!m) {
      m = this.clone<THREE.Material>(mat, { surface });
      m.name = `kit-${key}`;
      if (surface === 'floor_wet_grey') m.userData.kitWet = true;
      this.inlays.set(key, m);
    }
    return m;
  }

  /**
   * ADDED (polish 4): fine inlaid gold — the paintings' lines in floors, rails and frames: thin, polished, metallic,
   * NOT emissive (it shows by reflecting the room). Polygon-offset like every flush inlay. The glowing channel
   * ({@link channel}) is now an explicit opt-in.
   */
  goldLine(): THREE.Material {
    // a faint self-light (well under the bloom threshold) keeps the gold reading as gold in a dark room, the way the
    // paintings' gold lines catch the light — it never glows or blooms
    return this.inlay('goldTrim', { roughness: 0.16, emissive: 0xd0a04c, emissiveIntensity: 0.32 });
  }

  /**
   * ADDED (fix & ship): plain polished gold for tubes — pipes, conduits, frost conduits. The trims' engraved gold
   * (`goldTrim` wears the `gold_inlay` engraving) reads as a threaded rod on a round pipe; a pipe is smooth metal.
   * Solid (casts shadows, merges with every other plain-gold tube of the builder).
   */
  plainGold(): THREE.Material {
    const key = 'plain:goldTrim';
    let m = this.inlays.get(key);
    if (!m) {
      m = this.clone<THREE.Material>('goldTrim', { surface: 'none', roughness: 0.2 });
      m.name = 'kit-plain:goldTrim';
      this.inlays.set(key, m);
    }
    return m;
  }

  /** build-once cache (prop templates, shared textures) */
  cached<T>(key: string, make: () => T): T {
    if (!this.templates.has(key)) this.templates.set(key, make());
    return this.templates.get(key) as T;
  }

  castsShadow(ref: MatRef, m: THREE.Material): boolean {
    if (typeof ref === 'string' && NO_CAST.has(ref)) return false;
    if (m.transparent) return false;
    if (m.name.startsWith('emissive:') || m.name.startsWith('kit-inlay:') || m.name.startsWith('kit-glow:')) return false;
    return true;
  }

  // ---- physics pass-through (never throws; a stub physics world simply swallows the calls) ------------
  collider(desc: ColliderDesc): ColliderHandle { return this.physics.addCollider(desc); }
  surface(desc: SurfaceDesc): SurfaceHandle { return this.physics.addSurface(desc); }

  /** a door / barrier collider was toggled */
  navChanged(): void { if (this.finalized) this.rebuildNav(); }

  /** live quality profile (a permissive default while the render system is a stub) */
  quality(): QualityProfile {
    const q = this.game.render?.quality;
    return q && !isStub(q) && typeof q.maxShadowLights === 'number' ? q : DEFAULT_QUALITY;
  }

  volumetrics(): boolean { return this.quality().volumetrics !== false; }

  /** density of the scene's exponential haze (0 without fog or renderer) — additive light effects fade by it */
  fogDensity(): number {
    const fog = (this.game.render && !isStub(this.game.render) ? this.game.render.scene?.fog : null) as THREE.FogExp2 | null;
    return fog && typeof fog.density === 'number' && Number.isFinite(fog.density) ? fog.density : 0;
  }

  rebuildNav(): void {
    try { this.physics.nav.rebuild(); } catch (err) { this.warn('nav', `nav rebuild failed: ${String(err)}`); }
  }

  audio(id: string, pos: THREE.Vector3): void {
    try { this.game.audio.play(id, { pos: { x: pos.x, y: pos.y, z: pos.z } }); } catch { /* audio is optional */ }
  }
}

/** Pose of a piece in the zone: converts piece-local offsets into world collider positions. */
export class Pose {
  private readonly c: number;
  private readonly s: number;
  constructor(readonly x: number, readonly y: number, readonly z: number, readonly yaw: number) {
    this.c = Math.cos(yaw); this.s = Math.sin(yaw);
  }
  wx(lx: number, lz: number): number { return this.x + lx * this.c + lz * this.s; }
  wz(lx: number, lz: number): number { return this.z - lx * this.s + lz * this.c; }
  /** box collider description centred on the local point (lx, ly, lz) */
  box(lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, extra: Partial<ColliderDesc> = {}, localYaw = 0): ColliderDesc {
    return { shape: { kind: 'box', hx, hy, hz }, x: this.wx(lx, lz), y: this.y + ly, z: this.wz(lx, lz), yaw: this.yaw + localYaw, ...extra };
  }
  cyl(lx: number, ly: number, lz: number, r: number, hy: number, extra: Partial<ColliderDesc> = {}): ColliderDesc {
    return { shape: { kind: 'cyl', r, hy }, x: this.wx(lx, lz), y: this.y + ly, z: this.wz(lx, lz), ...extra };
  }
}

interface Slot { mat: THREE.Material; geo: Geo; cast: boolean; reflectY: number | null }

/** One kit piece: a posed group and a geometry buffer per material. */
export class Part {
  readonly group = new THREE.Group();
  readonly pose: Pose;
  private readonly slots = new Map<string, Slot>();
  private base: [number, number, number, number] | null = null;
  private readonly framed = new Set<Geo>();

  constructor(readonly ctx: KitCtx, name: string, pos: THREE.Vector3, yaw = 0, private readonly opts: PartOpts = {}) {
    this.group.name = name;
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    this.pose = new Pose(pos.x, pos.y, pos.z, yaw);
  }

  /**
   * Geometry buffer for a material. `reflectY` (world height) puts the geometry in a separate mesh that
   * `finalize()` registers with the renderer as a polished reflective floor.
   */
  g(ref: MatRef, reflectY: number | null = null): Geo {
    const m = this.ctx.mat(ref, this.opts.local);
    const key = reflectY === null ? m.uuid : `${m.uuid}|${reflectY.toFixed(3)}`;
    let s = this.slots.get(key);
    if (!s) {
      s = { mat: m, geo: new Geo(), cast: this.ctx.castsShadow(ref, m), reflectY };
      this.slots.set(key, s);
    }
    if (this.base && !this.framed.has(s.geo)) {
      s.geo.at(this.base[0], this.base[1], this.base[2], this.base[3]);
      this.framed.add(s.geo);
    }
    return s.geo;
  }

  /** Sub-frame for everything emitted until `unframe()`: local offset + yaw (wall segments, rail runs). */
  frame(x: number, y: number, z: number, ry = 0): Pose {
    this.unframe();
    this.base = [x, y, z, ry];
    return new Pose(this.pose.wx(x, z), this.pose.y + y, this.pose.wz(x, z), this.pose.yaw + ry);
  }

  unframe(): void {
    for (const g of this.framed) g.pop();
    this.framed.clear();
    this.base = null;
  }

  /** emit the meshes into the group (and the group into `parent`, default the zone root) */
  done(parent: THREE.Object3D | null = this.ctx.root): THREE.Group {
    this.unframe();
    for (const s of this.slots.values()) {
      if (s.geo.empty) continue;
      const mesh = new THREE.Mesh(this.ctx.own(s.geo.toGeometry()), s.mat);
      this.finishMesh(mesh, s.cast);
      if (s.reflectY !== null) mesh.userData.kitReflectY = s.reflectY;
      this.group.add(mesh);
    }
    this.slots.clear();
    if (!this.opts.local) this.group.userData.kitPart = true;
    if (parent) parent.add(this.group);
    return this.group;
  }

  /** the buffers as reusable geometry (prop templates): one entry per material */
  template(): PartTemplate {
    this.unframe();
    const out: PartTemplate = [];
    for (const s of this.slots.values()) {
      if (s.geo.empty) continue;
      const geometry = this.ctx.own(s.geo.toGeometry());
      geometry.userData.kitTemplate = true;
      out.push({ mat: s.mat, geometry, cast: s.cast });
    }
    this.slots.clear();
    return out;
  }

  /** instantiate a template into this part's group (geometry shared between placements) */
  place(t: PartTemplate, parent: THREE.Object3D | null = this.ctx.root): THREE.Group {
    for (const e of t) {
      const mesh = new THREE.Mesh(e.geometry, e.mat);
      this.finishMesh(mesh, e.cast);
      this.group.add(mesh);
    }
    return this.done(parent);
  }

  private finishMesh(mesh: THREE.Mesh, cast: boolean): void {
    mesh.castShadow = cast;
    mesh.receiveShadow = !(mesh.material as THREE.Material).transparent;
    mesh.userData.kitStatic = !this.opts.local;
    if (this.opts.noReflect) mesh.layers.set(RENDER_LAYERS.noReflect);
  }
}

export type PartTemplate = Array<{ mat: THREE.Material; geometry: THREE.BufferGeometry; cast: boolean }>;
