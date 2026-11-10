/**
 * Procedural PBR material library (OWNER: materials). Every surface in the game comes from here.
 *
 *  - `init()` synthesises tiling albedo / normal / ORM maps on the CPU for ~20 texture families (no image files)
 *  - materials are MeshStandard / MeshPhysical / MeshBasic instances patched for world- or object-space triplanar
 *    mapping, so kit geometry needs no UVs; patches chain with any other `onBeforeCompile` user (see patch.ts)
 *  - materials exist from construction (flat placeholder maps) and pick the real maps up when `init()` finishes,
 *    so factories that run before `Game.init()` can already call `get()`
 */
import * as THREE from 'three';
import type { Game, MaterialLibrary, MatId, MatTextureSet, Palette } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { isStub } from '@/core/stub';
import { clamp01 } from '@/core/mathx';
import { dataTexture, packLayers, placeholderSet, toTextureSet, type TextureSet } from './bake';
import { corruptPatch } from './corrupt';
import { MAT_DEFS, type EffectSpec, type MatDef } from './defs';
import { glassPatch, glowPatch, icePatch, sparklePatch, translucencyPatch } from './effects';
import { barrierPatch, hologramPatch, shieldPatch } from './effectsUnlit';
import { FAMILIES, FAMILY_IDS, familySize, type FamilyId } from './families';
import { AUR_TIME, ensureHost, findUniform, getHost, setPatchParam, type AurUniform, type SurfacePatch } from './patch';
import { bakeDetail, bakeMacro, bakeVeins } from './shared';
import { familyUniforms, triplanarPatch, type FamilyUniforms } from './triplanar';

const DEFAULT_TEXTURE_SIZE = 512;
const DEFAULT_ANISOTROPY = 4;
const FALLBACK_ID: MatId = 'whiteGold';

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[mats] ${msg}`);
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

/** Let the browser paint / handle input. Scheduling only — never used for gameplay timing. */
const yieldToHost = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function flatTexture(r: number, g: number, b: number, a: number, name: string): THREE.DataTexture {
  return dataTexture(new Uint8Array([r, g, b, a]), 1, false, 1, name);
}

interface CorruptHandle { amount: number }

class MaterialLibraryImpl implements MaterialLibrary {
  readonly palette: Palette = PALETTE;

  private readonly shared = new Map<string, THREE.Material>();
  private readonly emissives = new Map<string, THREE.MeshStandardMaterial>();
  private readonly families = new Map<FamilyId, { uniforms: FamilyUniforms; set: TextureSet }>();
  private readonly corrupted = new WeakMap<THREE.Material, CorruptHandle>();
  private readonly macro: AurUniform = { value: flatTexture(128, 128, 128, 128, 'macro.placeholder'), shared: true };
  private readonly detail: AurUniform = { value: flatTexture(128, 128, 128, 128, 'detail.placeholder'), shared: true };
  private readonly veins: AurUniform = { value: flatTexture(0, 255, 128, 128, 'veins.placeholder'), shared: true };
  private initPromise: Promise<void> | null = null;
  private clock = 0;
  private _ready = false;
  private _progress = 0;
  /** quality the current maps were baked at / the quality the renderer currently asks for */
  private bakedSize = 0;
  private bakedAniso = 0;
  private wantSize = DEFAULT_TEXTURE_SIZE;
  private wantAniso = DEFAULT_ANISOTROPY;
  private maxAniso = 0;
  private baking = false;

  constructor(private readonly game: Game | null) {
    for (const id of FAMILY_IDS) {
      const set = placeholderSet(id);
      this.families.set(id, { uniforms: familyUniforms(set), set });
    }
  }

  get ready(): boolean { return this._ready; }
  get progress(): number { return this._progress; }

  // ------------------------------------------------------------------------------------------- baking
  init(): Promise<void> {
    this.initPromise ??= this.bake().catch((err) => {
      // never take the game down: materials keep their flat placeholder maps
      console.error('[mats] texture synthesis failed; using flat fallbacks', err);
      this._ready = true;
      this._progress = 1;
    });
    return this.initPromise;
  }

  /** Read the renderer's current texture quality into `wantSize` / `wantAniso` (allocation free). */
  private readQuality(): void {
    let size = DEFAULT_TEXTURE_SIZE;
    let anisotropy = DEFAULT_ANISOTROPY;
    const render = this.game?.render;
    if (render && !isStub(render)) {
      const q = render.quality;
      if (q && !isStub(q)) {
        if (typeof q.textureSize === 'number' && q.textureSize >= 64) size = q.textureSize;
        if (typeof q.anisotropy === 'number' && q.anisotropy >= 1) anisotropy = q.anisotropy;
      }
      if (this.maxAniso === 0) {
        const r = render.renderer;
        this.maxAniso = r && !isStub(r) && r.capabilities ? Math.max(1, r.capabilities.getMaxAnisotropy()) : 16;
      }
      anisotropy = Math.min(anisotropy, this.maxAniso);
    }
    this.wantSize = size;
    this.wantAniso = Math.max(1, anisotropy);
  }

  private async bake(): Promise<void> {
    this.baking = true;
    try {
      await this.bakeAll();
    } finally {
      this.baking = false;
    }
  }

  private async bakeAll(): Promise<void> {
    this.readQuality();
    const size = this.wantSize, anisotropy = this.wantAniso;
    this.bakedSize = size;
    this.bakedAniso = anisotropy;
    const t0 = now();
    let last = t0;
    const steps = FAMILY_IDS.length + 3;
    let done = 0;
    const tick = async (): Promise<void> => {
      this._progress = ++done / steps;
      if (now() - last > 12) { await yieldToHost(); last = now(); }
    };

    const sharedSize = size >= 1024 ? 512 : 256;
    const swap = (u: AurUniform, data: Uint8Array, s: number, name: string): void => {
      const old = u.value as THREE.Texture;
      u.value = dataTexture(data, s, false, anisotropy, name);
      old.dispose();
    };
    swap(this.macro, bakeMacro(256), 256, 'aur.macro'); await tick();
    swap(this.detail, bakeDetail(sharedSize), sharedSize, 'aur.detail'); await tick();
    swap(this.veins, bakeVeins(sharedSize), sharedSize, 'aur.veins'); await tick();

    for (const id of FAMILY_IDS) {
      const def = FAMILIES[id];
      const entry = this.families.get(id);
      if (!entry) continue;
      try {
        const set = toTextureSet(packLayers(def.generate(familySize(def.tier, size))), anisotropy, id);
        const old = entry.set;
        entry.set = set;
        entry.uniforms.albedo.value = set.albedo;
        entry.uniforms.normal.value = set.normal;
        entry.uniforms.orm.value = set.orm;
        old.albedo.dispose(); old.normal.dispose(); old.orm.dispose();
      } catch (err) {
        warnOnce(`family "${id}" failed to bake (${String(err)}); keeping the flat fallback`);
      }
      await tick();
    }
    this._ready = true;
    this._progress = 1;
    if (this.game?.flags?.debug === true) console.info(`[mats] baked ${FAMILY_IDS.length} texture families at ${size}px in ${(now() - t0).toFixed(0)} ms`);
  }

  /**
   * Follow quality changes made after `init()`: anisotropy is applied to the live textures at once; a different
   * texture size re-bakes in place — but never while the game is being played (synthesis would hitch), only on
   * the title / pause / loading screens.
   */
  private followQuality(): void {
    this.readQuality();
    if (this.wantSize !== this.bakedSize) {
      if (this.game?.phase === 'playing') return;
      void this.bake().catch((err) => console.error('[mats] re-bake failed; keeping the previous textures', err));
      return;
    }
    if (this.wantAniso === this.bakedAniso) return;
    this.bakedAniso = this.wantAniso;
    const apply = (t: unknown): void => {
      const tex = t as THREE.Texture;
      if (tex.anisotropy !== this.wantAniso) { tex.anisotropy = this.wantAniso; tex.needsUpdate = true; }
    };
    apply(this.macro.value); apply(this.detail.value); apply(this.veins.value);
    for (const f of this.families.values()) { apply(f.set.albedo); apply(f.set.normal); apply(f.set.orm); }
  }

  // ------------------------------------------------------------------------------------------- construction
  private effectPatch(e: EffectSpec): SurfacePatch {
    switch (e.kind) {
      case 'glow': return glowPatch(e.mode, e.params);
      case 'ice': return icePatch(e.params);
      case 'sparkle': return sparklePatch(e.intensity, e.density, e.color);
      case 'glass': return glassPatch(e.rim);
      case 'translucency': return translucencyPatch(e.color, e.strength);
      case 'hologram': return hologramPatch(e.params);
      case 'shield': return shieldPatch(e.params);
      case 'barrier': return barrierPatch(this.macro, e.params);
    }
  }

  private build(id: MatId, def: MatDef, local: boolean): THREE.Material {
    const mat = def.base === 'basic' ? new THREE.MeshBasicMaterial()
      : def.base === 'physical' ? new THREE.MeshPhysicalMaterial()
        : new THREE.MeshStandardMaterial();
    mat.name = local === (def.local ?? false) ? id : `${id}${local ? ':local' : ':world'}`;
    mat.setValues(def.props as THREE.MaterialParameters);
    if (!def.family && !def.effects) return mat;
    const host = ensureHost(mat);
    host.local = local;
    const fam = def.family ? this.families.get(def.family) : undefined;
    if (def.family && def.tp && fam) host.add(triplanarPatch(def.family, fam.uniforms, { macro: this.macro, detail: this.detail }, def.tp));
    if (def.effects) for (const e of def.effects) host.add(this.effectPatch(e));
    return mat;
  }

  private def(id: MatId): { id: MatId; def: MatDef } {
    const def = (MAT_DEFS as Record<string, MatDef | undefined>)[id];
    if (def) return { id, def };
    warnOnce(`unknown material id "${String(id)}" — using "${FALLBACK_ID}"`);
    return { id: FALLBACK_ID, def: MAT_DEFS[FALLBACK_ID] };
  }

  private sharedInstance(rawId: MatId, local: boolean | undefined): THREE.Material {
    const { id, def } = this.def(rawId);
    const isLocal = local ?? def.local ?? false;
    const key = `${id}|${isLocal ? 'L' : 'W'}`;
    let m = this.shared.get(key);
    if (!m) { m = this.build(id, def, isLocal); this.shared.set(key, m); }
    return m;
  }

  get(id: MatId): THREE.Material {
    return this.sharedInstance(id, undefined);
  }

  getLocal(id: MatId): THREE.Material {
    return this.sharedInstance(id, true);
  }

  clone<T extends THREE.Material = THREE.MeshStandardMaterial>(rawId: MatId, overrides?: Record<string, unknown>): T {
    const { id, def } = this.def(rawId);
    const o = overrides ?? {};
    const local = typeof o.objectSpace === 'boolean' ? o.objectSpace : (def.local ?? false);
    const mat = this.build(id, def, local);
    const values: Record<string, unknown> = {};
    for (const k in o) {
      const v = o[k];
      if (k === 'objectSpace' || v === undefined) continue;
      if (k in mat) values[k] = v;
      else if (typeof v !== 'number' || !setPatchParam(mat, k, v)) warnOnce(`clone("${id}"): unknown override "${k}" ignored`);
    }
    mat.setValues(values as THREE.MaterialParameters);
    return mat as unknown as T;
  }

  emissive(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
    const c = Number.isFinite(color) ? color >>> 0 : 0xffffff;
    const i = Number.isFinite(intensity) ? Math.max(0, intensity) : 1.5;
    const key = `${c}:${i}`;
    let m = this.emissives.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i, roughness: 1, metalness: 0, envMapIntensity: 0 });
      m.name = `emissive:${c.toString(16).padStart(6, '0')}:${i}`;
      this.emissives.set(key, m);
    }
    return m;
  }

  corrupt(material: THREE.MeshStandardMaterial, opts?: { amount?: number; scale?: number }): CorruptHandle {
    if (!material || isStub(material) || material.isMeshStandardMaterial !== true) {
      warnOnce('corrupt(): needs a MeshStandardMaterial / MeshPhysicalMaterial instance — ignored');
      return { amount: clamp01(opts?.amount ?? 0) };
    }
    const existing = this.corrupted.get(material);
    if (existing) {
      if (opts?.amount !== undefined) existing.amount = opts.amount;
      return existing;
    }
    const scale = opts?.scale !== undefined && opts.scale > 0.01 ? opts.scale : 1.8;
    const patch = corruptPatch(this.veins, { amount: clamp01(opts?.amount ?? 0.5), scale, glow: PALETTE.eclipseViolet, dark: 0x1c1222, intensity: 2.4 });
    ensureHost(material).add(patch);
    const a = (patch.uniforms as Record<string, AurUniform>).corA.value as THREE.Vector4;
    const handle: CorruptHandle = {
      get amount(): number { return a.x; },
      set amount(v: number) { a.x = Number.isFinite(v) ? clamp01(v) : 0; },
    };
    this.corrupted.set(material, handle);
    return handle;
  }

  setParam(material: THREE.Material, name: string, value: number): void {
    if (!material || isStub(material) || !Number.isFinite(value)) return;
    if (!getHost(material) || !setPatchParam(material, name, value)) warnOnce(`setParam(): "${material.name || material.type}" has no parameter "${name}"`);
  }

  rippleShield(material: THREE.Material, localPoint: { x: number; y: number; z: number }, strength = 1): void {
    const hit = material && !isStub(material) ? findUniform(material, 'shieldHit') : undefined;
    const b = hit ? findUniform(material, 'shieldB') : undefined;
    if (!hit || !b) { warnOnce('rippleShield(): material is not a shieldEnergy clone — ignored'); return; }
    (hit.value as THREE.Vector4).set(localPoint.x, localPoint.y, localPoint.z, AUR_TIME.value as number);
    (b.value as THREE.Vector4).x = Math.max(0, strength);
  }

  textures(rawId: MatId): MatTextureSet | null {
    const { def } = this.def(rawId);
    const fam = def.family ? this.families.get(def.family) : undefined;
    return fam ? { albedo: fam.set.albedo, normal: fam.set.normal, orm: fam.set.orm, metresPerRepeat: def.tp?.scale ?? 1 } : null;
  }

  update(dt: number, time: number): void {
    this.clock = Number.isFinite(time) ? time : this.clock + (Number.isFinite(dt) ? dt : 0);
    AUR_TIME.value = this.clock;
    if (this._ready && !this.baking && this.game) this.followQuality();
  }
}

/**
 * Create the material library. `game` may be null (sandboxes / tests): texture size 512, anisotropy 4.
 */
export function createMaterialLibrary(game: Game | null): MaterialLibrary {
  return new MaterialLibraryImpl(game);
}
