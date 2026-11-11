/**
 * Photographic PBR surface sets (integration wave): the generated maps in `public/textures/` (see its
 * manifest.json: albedo / normal / ORM WebP per set, `tileMeters`, `metal`, and an emissive vein mask for
 * `eclipse_tissue`).
 *
 *  - LAZY, PER ZONE. A set is fetched the first time a material that maps onto it is requested (`get()` /
 *    `clone()` touch it), which during a zone load is the zone's own build. Sets no material of the new zone
 *    touched are released on `zone:ready` (GPU memory back; their materials quietly fall back to the procedural
 *    maps until something asks for them again).
 *  - NEVER BLOCKING. Until a set has arrived its materials render the procedural family exactly as before (the
 *    shader blends on a uniform, so the swap needs no recompile). A set that arrives after `zone:ready` asks the
 *    renderer for one fresh environment probe so reflections pick the new surfaces up.
 *  - TEXTURES. Decoded off the main thread with `createImageBitmap` (flipped like an <img> upload, no colour
 *    conversion, no premultiplication), sized to the quality profile (`textureSize` 1024 → 1024² maps, 512 → 512²,
 *    lower → 256²), mip-mapped on the GPU, anisotropy from the quality profile (4–8 at high). Albedo and the
 *    emissive mask are sRGB; normal and ORM are linear data. Normals are OpenGL (+Y up), like the procedural ones.
 *  - Where the page cannot load images (unit tests, server tooling) the sets are simply never loaded.
 */
import * as THREE from 'three';
import type { AurUniform } from './patch';

export const SURFACE_SET_IDS = [
  'marble_dark', 'stone_pale', 'stone_worn', 'bronze_plate', 'panel_navy', 'metal_blackgold', 'frost', 'eclipse_tissue',
  'concrete_hangar',
  // ADDED (polish 4): large smooth white-silver marble slab, light wet grey floor marble, fine engraved gold
  'marble_slab', 'floor_wet_grey', 'gold_inlay',
] as const;
export type SurfaceSetId = (typeof SURFACE_SET_IDS)[number];

export function isSurfaceSetId(v: unknown): v is SurfaceSetId {
  return typeof v === 'string' && (SURFACE_SET_IDS as readonly string[]).includes(v);
}

/** One entry of public/textures/manifest.json (the fields the engine reads). */
export interface SurfaceManifestEntry {
  albedo: string;
  normal: string;
  orm: string;
  emissive?: string;
  tileMeters: number;
  metal: boolean;
}
export type SurfaceManifest = Partial<Record<SurfaceSetId, SurfaceManifestEntry>>;

/**
 * Mean of each set's ORM green channel (its typical roughness), measured on the delivered maps. Materials keep
 * their own `roughness` as the mean and add the map's variation around this value, so a set never drags a
 * tuned material (a mirror-polished floor, a satin wall) away from its authored gloss.
 */
export const SET_ROUGHNESS_MEAN: Record<SurfaceSetId, number> = {
  marble_dark: 0.17, stone_pale: 0.8, stone_worn: 0.68, bronze_plate: 0.45, panel_navy: 0.37, metal_blackgold: 0.62,
  frost: 0.61, eclipse_tissue: 0.32, concrete_hangar: 0.73, marble_slab: 0.23, floor_wet_grey: 0.15, gold_inlay: 0.28,
};

/**
 * What the engine knows about each set before its manifest arrives (materials are built synchronously): the
 * manifest's `tileMeters` and `metal`, whether the photo is isotropic (may be turned per slab: marble, frost,
 * tissue, hammered bronze — not coursed stone, panels, chevrons or deck plates) and whether it has a mask.
 */
export const SET_DEFAULTS: Record<SurfaceSetId, { tileMeters: number; metal: boolean; isotropic: boolean; emissive: boolean; maxSize?: number; snap?: number }> = {
  marble_dark: { tileMeters: 2.5, metal: false, isotropic: true, emissive: false },
  stone_pale: { tileMeters: 2.5, metal: false, isotropic: false, emissive: false },
  stone_worn: { tileMeters: 3, metal: false, isotropic: false, emissive: false },
  bronze_plate: { tileMeters: 1.5, metal: true, isotropic: true, emissive: false },
  panel_navy: { tileMeters: 4, metal: true, isotropic: false, emissive: false },
  metal_blackgold: { tileMeters: 2, metal: true, isotropic: false, emissive: false },
  frost: { tileMeters: 1.5, metal: false, isotropic: true, emissive: false },
  eclipse_tissue: { tileMeters: 2, metal: false, isotropic: true, emissive: true },
  // polish 4: the deck is a square 6 × 6 grid of 1 m plates, so it may be turned by quarter turns and shifted by whole
  // plates (`snap`: offsets in 1/6 of a tile) — the plate seams stay aligned and the tyre marks stop repeating
  concrete_hangar: { tileMeters: 6, metal: false, isotropic: true, emissive: false, snap: 6 },
  marble_slab: { tileMeters: 4, metal: false, isotropic: true, emissive: false },
  floor_wet_grey: { tileMeters: 5, metal: false, isotropic: true, emissive: false },
  // (fine engraving on thin trims: 512² is all it can show, and it is in every zone)
  gold_inlay: { tileMeters: 0.6, metal: true, isotropic: false, emissive: false, maxSize: 512 },
};

/** Map edge (px) for a quality profile's `textureSize`: the delivered maps are 1024², never upscaled. */
export function surfaceMapSize(textureSize: number): number {
  return textureSize >= 1024 ? 1024 : textureSize >= 512 ? 512 : 256;
}

/** Mean linear luminance of each set's albedo, measured on the delivered maps (the pivot of `contrast`). */
export const SET_LUMINANCE_MEAN: Record<SurfaceSetId, number> = {
  marble_dark: 0.0151, stone_pale: 0.497, stone_worn: 0.0681, bronze_plate: 0.1155, panel_navy: 0.0365,
  metal_blackgold: 0.0477, frost: 0.2242, eclipse_tissue: 0.0183, concrete_hangar: 0.143, marble_slab: 0.7818,
  floor_wet_grey: 0.4003, gold_inlay: 0.471,
};

/** Shared uniform holders of one set (every material mapped onto it reads these). */
export interface SurfaceSetUniforms {
  albedo: AurUniform;
  normal: AurUniform;
  orm: AurUniform;
  emissive: AurUniform;
  /** x = 1 once the maps are in (0 = procedural fallback) · y = map mean roughness · z = 1 for a metal set · w = 1 with an emissive mask */
  info: AurUniform;
}

type Status = 'idle' | 'loading' | 'ready' | 'failed';

interface Entry {
  id: SurfaceSetId;
  uniforms: SurfaceSetUniforms;
  status: Status;
  /** zone epoch of the last material request */
  lastUse: number;
  textures: THREE.Texture[];
  bitmaps: ImageBitmap[];
  size: number;
  gpuBytes: number;
  loadMs: number;
  /** bumps on every (re)load or release so a stale load cannot install itself */
  token: number;
  error?: string;
  /** the 1×1 maps bound while the set is not loaded */
  fallback: Pick<SurfaceSetUniforms, 'albedo' | 'normal' | 'orm' | 'emissive'>;
}

export interface SurfaceSetsHost {
  /** current texture quality: map edge in px and anisotropy */
  quality(): { size: number; anisotropy: number };
  /** subscribe to zone lifecycle events (returns nothing; the library lives as long as the game) */
  onZone?(loading: () => void, ready: () => void): void;
  /** ask the renderer for one fresh environment probe */
  refreshEnvironment?(): void;
  /** ADDED (polish 4): the sets worn by materials that are in the scene right now (checked on `zone:ready`) */
  inUse?(): Set<SurfaceSetId>;
  debug?: boolean;
}

/** Public, debug-friendly description of one set (`game.mats.surfaces.info()`). */
export interface SurfaceSetInfo {
  id: SurfaceSetId;
  status: Status;
  size: number;
  /** estimated GPU memory of its maps incl. mips (bytes) */
  gpuBytes: number;
  /** fetch + decode + texture creation, ms */
  loadMs: number;
  error?: string;
}

const LUM_FALLBACK = (name: string, rgba: [number, number, number, number], srgb: boolean): THREE.DataTexture => {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
};

/** placeholder maps bound until a set arrives (the shader ignores them while info.x is 0) */
function placeholders(id: string): Pick<SurfaceSetUniforms, 'albedo' | 'normal' | 'orm' | 'emissive'> {
  return {
    albedo: { value: LUM_FALLBACK(`${id}.albedo.placeholder`, [128, 128, 128, 255], true), shared: true },
    normal: { value: LUM_FALLBACK(`${id}.normal.placeholder`, [128, 128, 255, 255], false), shared: true },
    orm: { value: LUM_FALLBACK(`${id}.orm.placeholder`, [255, 128, 0, 255], false), shared: true },
    emissive: { value: LUM_FALLBACK(`${id}.emissive.placeholder`, [0, 0, 0, 255], true), shared: true },
  };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SurfaceSets {
  private readonly entries = new Map<SurfaceSetId, Entry>();
  private readonly base: string;
  private manifestPromise: Promise<SurfaceManifest | null> | null = null;
  private epoch = 0;
  /** true between zone:ready and the next zone:loading (a late swap then needs a fresh env probe) */
  private live = false;
  private envQueued = false;
  private aniso = 0;
  private readonly warned = new Set<string>();

  constructor(private readonly host: SurfaceSetsHost, base?: string) {
    let b = base;
    if (b === undefined) {
      try { b = (import.meta.env?.BASE_URL as string | undefined) ?? '/'; } catch { b = '/'; }
    }
    this.base = (b.endsWith('/') ? b : b + '/') + 'textures/';
    for (const id of SURFACE_SET_IDS) {
      const fallback = placeholders(id);
      this.entries.set(id, {
        id, status: 'idle', lastUse: -1, textures: [], bitmaps: [], size: 0, gpuBytes: 0, loadMs: 0, token: 0, fallback,
        uniforms: {
          albedo: { ...fallback.albedo }, normal: { ...fallback.normal }, orm: { ...fallback.orm }, emissive: { ...fallback.emissive },
          info: { value: new THREE.Vector4(0, SET_ROUGHNESS_MEAN[id], 0, 0), shared: true },
        },
      });
    }
    host.onZone?.(() => this.zoneLoading(), () => this.zoneReady());
  }

  /** false where nothing can be loaded (unit tests, server tooling) */
  get enabled(): boolean {
    return typeof document !== 'undefined' && typeof fetch === 'function' && typeof createImageBitmap === 'function';
  }

  uniforms(id: SurfaceSetId): SurfaceSetUniforms {
    return (this.entries.get(id) as Entry).uniforms;
  }

  /** A material mapped onto `id` was requested: remember it for this zone and fetch the set if needed. */
  touch(id: SurfaceSetId): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.lastUse = this.epoch;
    if (e.status === 'idle' && this.enabled) void this.load(e);
  }

  /**
   * ADDED (polish 4): a material wearing `id` is being DRAWN (its `onBeforeRender`). Cheap enough to run per draw.
   * A material cached across zones by another subsystem (scenic hulls, props built once) is drawn without ever
   * being requested again: this keeps its set alive for the zone, and reloads it if a zone change released it.
   */
  drawn(id: SurfaceSetId): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.lastUse !== this.epoch) e.lastUse = this.epoch;
    if (e.status === 'idle' && this.enabled) void this.load(e);
  }

  /** Resolves once no set is loading (or after `timeoutMs`). For captures and tests. */
  async settled(timeoutMs = 15000): Promise<boolean> {
    const t0 = now();
    for (;;) {
      let busy = false;
      for (const e of this.entries.values()) if (e.status === 'loading') busy = true;
      if (!busy) return true;
      if (now() - t0 > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  info(): { sets: SurfaceSetInfo[]; gpuBytes: number; loaded: number } {
    const sets: SurfaceSetInfo[] = [];
    let gpuBytes = 0, loaded = 0;
    for (const e of this.entries.values()) {
      if (e.status === 'idle') continue;
      sets.push({ id: e.id, status: e.status, size: e.size, gpuBytes: e.gpuBytes, loadMs: Math.round(e.loadMs), error: e.error });
      gpuBytes += e.gpuBytes;
      if (e.status === 'ready') loaded++;
    }
    return { sets, gpuBytes, loaded };
  }

  /** Follow a quality change: new anisotropy at once; a new map size reloads the live sets in place. */
  followQuality(allowReload: boolean): void {
    const q = this.host.quality();
    if (q.anisotropy !== this.aniso) {
      this.aniso = q.anisotropy;
      for (const e of this.entries.values()) {
        for (const t of e.textures) if (t.anisotropy !== q.anisotropy) { t.anisotropy = q.anisotropy; t.needsUpdate = true; }
      }
    }
    if (!allowReload) return;
    for (const e of this.entries.values()) {
      const want = Math.min(q.size, SET_DEFAULTS[e.id].maxSize ?? q.size);
      if (e.status === 'ready' && e.size !== want && this.enabled) void this.load(e);
    }
  }

  // ------------------------------------------------------------------------------------------- zone lifecycle
  private zoneLoading(): void {
    this.epoch++;
    this.live = false;
  }

  private zoneReady(): void {
    // the new zone is built and compiled: anything it never asked for goes — except sets a material that is still
    // in the scene wears (polish 4: cached across zones by another subsystem, see `drawn()`)
    const inUse = this.host.inUse?.();
    for (const e of this.entries.values()) {
      if (inUse?.has(e.id)) e.lastUse = this.epoch;
      if (e.lastUse < this.epoch && (e.status === 'ready' || e.status === 'loading')) this.release(e);
    }
    this.live = true;
  }

  // ------------------------------------------------------------------------------------------- loading
  private manifest(): Promise<SurfaceManifest | null> {
    this.manifestPromise ??= fetch(this.base + 'manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<SurfaceManifest>) : Promise.reject(new Error('HTTP ' + r.status))))
      .then((m) => (m && typeof m === 'object' ? m : null))
      .catch((err: unknown) => {
        this.warnOnce('manifest', `surface manifest unavailable (${String((err as Error)?.message ?? err)}) — procedural surfaces only`);
        return null;
      });
    return this.manifestPromise;
  }

  private async bitmap(file: string, size: number): Promise<ImageBitmap> {
    const res = await fetch(this.base + file);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const blob = await res.blob();
    // flipped like an <img> upload (row 0 = v 0), raw values (normal / ORM are data), sized to the quality
    return createImageBitmap(blob, {
      imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      resizeWidth: size, resizeHeight: size, resizeQuality: 'high',
    });
  }

  private texture(bmp: ImageBitmap, srgb: boolean, anisotropy: number, name: string): THREE.Texture {
    const t = new THREE.Texture(bmp);
    t.name = name;
    t.flipY = false; // already flipped by createImageBitmap
    t.premultiplyAlpha = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.max(1, anisotropy);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  private async load(e: Entry): Promise<void> {
    const token = ++e.token;
    const t0 = now();
    e.status = 'loading';
    e.error = undefined;
    try {
      const man = await this.manifest();
      const m = man?.[e.id];
      if (!m) throw new Error('not in the manifest');
      const q = this.host.quality();
      const size = Math.min(q.size, SET_DEFAULTS[e.id].maxSize ?? q.size), anisotropy = q.anisotropy;
      const files: Array<[string, boolean]> = [[m.albedo, true], [m.normal, false], [m.orm, false]];
      if (m.emissive) files.push([m.emissive, true]);
      const bitmaps = await Promise.all(files.map(([f]) => this.bitmap(f, size)));
      if (token !== e.token) { for (const b of bitmaps) b.close(); return; } // released or reloaded meanwhile
      const tex = bitmaps.map((b, i) => this.texture(b, files[i][1], anisotropy, `surface:${e.id}.${['albedo', 'normal', 'orm', 'emissive'][i]}`));
      const old = e.textures, oldBitmaps = e.bitmaps;
      e.textures = tex;
      e.bitmaps = bitmaps;
      const u = e.uniforms;
      u.albedo.value = tex[0];
      u.normal.value = tex[1];
      u.orm.value = tex[2];
      if (tex[3]) u.emissive.value = tex[3];
      (u.info.value as THREE.Vector4).set(1, SET_ROUGHNESS_MEAN[e.id], m.metal ? 1 : 0, tex[3] ? 1 : 0);
      for (const t of old) t.dispose();
      for (const b of oldBitmaps) b.close();
      e.size = size;
      e.gpuBytes = Math.round(tex.length * size * size * 4 * (4 / 3));
      e.loadMs = now() - t0;
      e.status = 'ready';
      this.aniso = anisotropy;
      if (this.host.debug) console.info(`[mats] surface set ${e.id} ${size}² in ${e.loadMs.toFixed(0)} ms`);
      if (this.live) this.queueEnvRefresh();
    } catch (err) {
      if (token !== e.token) return;
      e.status = 'failed';
      e.error = String((err as Error)?.message ?? err);
      this.warnOnce(`load:${e.id}`, `surface set "${e.id}" failed to load (${e.error}) — keeping the procedural maps`);
    }
  }

  /** Back to the procedural fallback and free the GPU maps (a later request loads the set again). */
  private release(e: Entry): void {
    e.token++;
    const u = e.uniforms;
    (u.info.value as THREE.Vector4).x = 0;
    const ph = e.fallback;
    u.albedo.value = ph.albedo.value;
    u.normal.value = ph.normal.value;
    u.orm.value = ph.orm.value;
    u.emissive.value = ph.emissive.value;
    for (const t of e.textures) t.dispose();
    for (const b of e.bitmaps) b.close();
    e.textures = [];
    e.bitmaps = [];
    e.gpuBytes = 0;
    e.status = 'idle';
    if (this.host.debug) console.info(`[mats] surface set ${e.id} released (unused by this zone)`);
  }

  private queueEnvRefresh(): void {
    if (this.envQueued || !this.host.refreshEnvironment) return;
    this.envQueued = true;
    // batch the sets of one zone into a single probe bake
    setTimeout(() => {
      this.envQueued = false;
      try { this.host.refreshEnvironment?.(); } catch { /* renderer gone */ }
    }, 60);
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[mats] ${msg}`);
  }
}
