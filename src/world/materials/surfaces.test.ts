/**
 * Integration wave: the photographic PBR sets (surfaces.ts) and how materials wear them.
 * Browser APIs (fetch, createImageBitmap, document) are faked; no GPU is involved.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMaterialLibrary } from './index';
import { MAT_DEFS, pbrParams, SURFACE_FINISH } from './defs';
import { findUniform, getHost } from './patch';
import { SET_DEFAULTS, SURFACE_SET_IDS, SurfaceSets, surfaceMapSize, type SurfaceSetId } from './surfaces';

const MANIFEST = Object.fromEntries(SURFACE_SET_IDS.map((id) => [id, {
  albedo: `${id}_albedo.webp`, normal: `${id}_normal.webp`, orm: `${id}_orm.webp`,
  ...(id === 'eclipse_tissue' ? { emissive: `${id}_emissive.webp` } : {}),
  tileMeters: SET_DEFAULTS[id].tileMeters, metal: SET_DEFAULTS[id].metal,
}]));

interface FakeBitmap { width: number; height: number; closed: boolean; close(): void }

function installBrowser(): { fetched: string[]; bitmaps: FakeBitmap[]; failFor: Set<string> } {
  const fetched: string[] = [];
  const bitmaps: FakeBitmap[] = [];
  const failFor = new Set<string>();
  vi.stubGlobal('document', {});
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if ([...failFor].some((f) => url.includes(f))) return { ok: false, status: 404 };
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => MANIFEST };
    return { ok: true, blob: async () => ({ url }) };
  });
  vi.stubGlobal('createImageBitmap', async (_blob: unknown, opts: { resizeWidth?: number; imageOrientation?: string; colorSpaceConversion?: string }) => {
    expect(opts.imageOrientation).toBe('flipY');
    expect(opts.colorSpaceConversion).toBe('none');
    const b: FakeBitmap = { width: opts.resizeWidth ?? 1024, height: opts.resizeWidth ?? 1024, closed: false, close() { this.closed = true; } };
    bitmaps.push(b);
    return b;
  });
  return { fetched, bitmaps, failFor };
}

function sets(size = 1024, anisotropy = 8): { s: SurfaceSets; zone: { loading(): void; ready(): void }; env: { count: number } } {
  const zone = { loading: () => {}, ready: () => {} };
  const env = { count: 0 };
  const s = new SurfaceSets({
    quality: () => ({ size, anisotropy }),
    onZone: (loading, ready) => { zone.loading = loading; zone.ready = ready; },
    refreshEnvironment: () => { env.count++; },
  }, '/');
  return { s, zone, env };
}

describe('surface sets', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('are never fetched where the page cannot load images (tests, tools)', async () => {
    const { s } = sets();
    expect(s.enabled).toBe(false);
    s.touch('marble_dark');
    expect(await s.settled(100)).toBe(true);
    expect(s.info().sets).toEqual([]);
    expect((s.uniforms('marble_dark').info.value as THREE.Vector4).x).toBe(0);
  });

  it('load lazily, only what is asked for: sRGB albedo / emissive, linear data maps, mips and anisotropy', async () => {
    const web = installBrowser();
    const { s } = sets(1024, 8);
    expect(web.fetched).toEqual([]);
    s.touch('eclipse_tissue');
    expect(await s.settled(2000)).toBe(true);
    expect(web.fetched.filter((u) => !u.endsWith('manifest.json')).sort()).toEqual([
      '/textures/eclipse_tissue_albedo.webp', '/textures/eclipse_tissue_emissive.webp', '/textures/eclipse_tissue_normal.webp',
      '/textures/eclipse_tissue_orm.webp',
    ]);
    const u = s.uniforms('eclipse_tissue');
    const info = u.info.value as THREE.Vector4;
    expect(info.x).toBe(1);
    expect(info.w).toBe(1); // emissive mask present
    const alb = u.albedo.value as THREE.Texture, nrm = u.normal.value as THREE.Texture, orm = u.orm.value as THREE.Texture, em = u.emissive.value as THREE.Texture;
    expect(alb.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(em.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(nrm.colorSpace).toBe(THREE.NoColorSpace);
    expect(orm.colorSpace).toBe(THREE.NoColorSpace);
    for (const t of [alb, nrm, orm, em]) {
      expect(t.generateMipmaps).toBe(true);
      expect(t.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(t.anisotropy).toBe(8);
      expect(t.wrapS).toBe(THREE.RepeatWrapping);
      expect(t.flipY).toBe(false); // flipped by createImageBitmap instead
    }
    const i = s.info();
    expect(i.loaded).toBe(1);
    expect(i.gpuBytes).toBe(Math.round(4 * 1024 * 1024 * 4 * (4 / 3)));
    // a metal set flags itself for the shader
    s.touch('bronze_plate');
    await s.settled(2000);
    expect((s.uniforms('bronze_plate').info.value as THREE.Vector4).z).toBe(1);
  });

  it('size their maps to the quality profile and never upscale', async () => {
    expect(surfaceMapSize(2048)).toBe(1024);
    expect(surfaceMapSize(1024)).toBe(1024);
    expect(surfaceMapSize(512)).toBe(512);
    expect(surfaceMapSize(256)).toBe(256);
    const web = installBrowser();
    const { s } = sets(512, 2);
    s.touch('frost');
    await s.settled(2000);
    expect(web.bitmaps.every((b) => b.width === 512)).toBe(true);
    expect(s.info().sets[0].size).toBe(512);
  });

  it('release what the next zone does not use, and refresh the environment for a late arrival', async () => {
    const web = installBrowser();
    const { s, zone, env } = sets();
    zone.loading(); // zone A builds
    s.touch('stone_pale'); s.touch('frost');
    await s.settled(2000);
    zone.ready();
    expect(env.count).toBe(0); // arrived during loading: the mission's zone:ready bake covers it
    zone.loading(); // zone B builds and uses only stone_pale
    s.touch('stone_pale');
    zone.ready();
    const frost = s.uniforms('frost');
    expect((frost.info.value as THREE.Vector4).x).toBe(0);
    expect((frost.albedo.value as THREE.Texture).name).toContain('placeholder');
    expect(web.bitmaps.filter((b) => b.closed).length).toBe(3);
    expect((s.uniforms('stone_pale').info.value as THREE.Vector4).x).toBe(1);
    // asked for again mid-zone: it comes back, and one probe bake follows
    s.touch('frost');
    await s.settled(2000);
    expect((frost.info.value as THREE.Vector4).x).toBe(1);
    await new Promise((r) => setTimeout(r, 120));
    expect(env.count).toBe(1);
  });

  it('polish 4: a set worn by a material still in the scene survives a zone change; a drawn material brings its set back', async () => {
    installBrowser();
    const zone = { loading: () => {}, ready: () => {} };
    const inScene = new Set<SurfaceSetId>();
    const s = new SurfaceSets({
      quality: () => ({ size: 1024, anisotropy: 8 }),
      onZone: (loading, ready) => { zone.loading = loading; zone.ready = ready; },
      inUse: () => inScene,
    }, '/');
    zone.loading();
    s.touch('bronze_plate'); s.touch('frost');
    await s.settled(2000);
    zone.ready();
    // zone B never asks for bronze, but a scenic hull cached across zones still wears it
    inScene.add('bronze_plate');
    zone.loading();
    zone.ready();
    expect((s.uniforms('bronze_plate').info.value as THREE.Vector4).x).toBe(1);
    expect((s.uniforms('frost').info.value as THREE.Vector4).x).toBe(0);
    // a released set is fetched again the moment a material wearing it is drawn
    s.drawn('frost');
    await s.settled(2000);
    expect((s.uniforms('frost').info.value as THREE.Vector4).x).toBe(1);
  });

  it('polish 4: a set with a size cap never loads larger than it (gold_inlay ≤ 512²)', async () => {
    installBrowser();
    const { s } = sets(1024);
    s.touch('gold_inlay'); s.touch('marble_slab');
    await s.settled(2000);
    const info = s.info().sets;
    expect(info.find((e) => e.id === 'gold_inlay')?.size).toBe(512);
    expect(info.find((e) => e.id === 'marble_slab')?.size).toBe(1024);
  });

  it('a set that fails to load keeps the procedural maps and warns once', async () => {
    const web = installBrowser();
    web.failFor.add('stone_worn_normal');
    const { s } = sets();
    s.touch('stone_worn');
    await s.settled(2000);
    expect((s.uniforms('stone_worn').info.value as THREE.Vector4).x).toBe(0);
    expect(s.info().sets[0]).toMatchObject({ id: 'stone_worn', status: 'failed' });
    s.touch('stone_worn'); // a failed set is not retried every frame
    expect(s.info().sets[0].status).toBe('failed');
  });
});

describe('materials wearing the sets', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('map the families the brief names onto the generated sets', () => {
    const want: Partial<Record<keyof typeof MAT_DEFS, SurfaceSetId>> = {
      // polish 4: the King-era walls are smooth marble slabs; the trims wear the engraved gold
      whiteGold: 'marble_slab', whiteGoldPanel: 'marble_slab', goldTrim: 'gold_inlay', whiteGoldFloor: 'marble_dark', blackStoneFloor: 'marble_dark',
      blackStone: 'marble_dark', goldDark: 'metal_blackgold', domBronze: 'bronze_plate', refNavy: 'panel_navy',
      frostRime: 'frost', eclipseTissue: 'eclipse_tissue',
    };
    for (const [id, set] of Object.entries(want)) expect(MAT_DEFS[id as keyof typeof MAT_DEFS].pbr?.set, id).toBe(set);
    expect(SURFACE_FINISH.stone_worn?.pbr.set).toBe('stone_worn');
    expect(SURFACE_FINISH.concrete_hangar?.pbr.set).toBe('concrete_hangar');
    // directional photos are never turned; organic ones may be
    expect(pbrParams({ set: 'stone_pale' }).isotropic).toBe(false);
    expect(pbrParams({ set: 'metal_blackgold' }).isotropic).toBe(false);
    expect(pbrParams({ set: 'marble_dark' }).isotropic).toBe(true);
    expect(pbrParams({ set: 'eclipse_tissue' }).emissiveMask).toBe(true);
    // polish 4: the ashlar, the wet floor and the slab marble are reachable as surfaces
    expect(SURFACE_FINISH.stone_pale?.pbr.set).toBe('stone_pale');
    expect(SURFACE_FINISH.floor_wet_grey?.pbr.set).toBe('floor_wet_grey');
    expect(SURFACE_FINISH.marble_slab?.pbr.set).toBe('marble_slab');
  });

  it('polish 4: pale walls are a dielectric with an even polish (the "tinfoil" fix)', () => {
    for (const id of ['whiteGold', 'whiteGoldPanel'] as const) {
      const d = MAT_DEFS[id];
      expect(d.props.metalness, id).toBe(0);
      expect(d.props.roughness as number, id).toBeGreaterThanOrEqual(0.35);
      // the roughness may only wander a little (a large smudge amplitude mirrored the probe in blobs)
      expect(d.tp?.roughAmp ?? 1, id).toBeLessThanOrEqual(0.12);
      expect(d.pbr?.normal ?? 1, id).toBeLessThanOrEqual(0.05);
      expect(d.pbr?.roughAmp ?? 1, id).toBeLessThanOrEqual(0.5);
    }
    // the ashlar clone is a dielectric too
    expect(SURFACE_FINISH.stone_pale?.props.metalness).toBe(0);
  });

  it('polish 4: the hangar deck turns and shifts by whole plates; the engraved gold loads at most 512²', () => {
    const p = pbrParams({ set: 'concrete_hangar' });
    expect(p.isotropic).toBe(true);
    expect(p.snap).toBe(6);
    expect(SET_DEFAULTS.gold_inlay.maxSize).toBe(512);
    expect(pbrParams({ set: 'marble_slab' }).snap).toBeUndefined();
  });

  it('a mapped material carries the photo layer and shares the set holders; the photo starts faded out', () => {
    const lib = createMaterialLibrary(null);
    const wall = lib.get('whiteGoldPanel'), rib = lib.get('whiteGold');
    expect(findUniform(wall, 'tpXAlbedo')).toBeDefined();
    expect(findUniform(wall, 'tpXAlbedo')).toBe(findUniform(rib, 'tpXAlbedo'));
    expect((findUniform(wall, 'tpXSet')?.value as THREE.Vector4).x).toBe(0);
    expect(getHost(wall)?.patches[0].defines?.AUR_PBR).toBe(1);
    expect(getHost(lib.get('eclipseTissue'))?.patches[0].defines?.AUR_PBR_EMIT).toBe(1);
    expect(getHost(lib.get('rubble'))?.patches[0].defines?.AUR_PBR).toBeUndefined();
    // `scale` keeps the photo's ratio to the family
    const c = lib.clone('whiteGold', { scale: 8 });
    const tpX = findUniform(c, 'tpX')?.value as THREE.Vector4;
    expect(1 / tpX.x).toBeCloseTo(8 * (pbrParams(MAT_DEFS.whiteGold.pbr!).scale / MAT_DEFS.whiteGold.tp!.scale), 5);
  });

  it('clone(id, { surface }) puts another set (and its finish) on a material; unknown names warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lib = createMaterialLibrary(null);
    const worn = lib.clone<THREE.MeshPhysicalMaterial>('whiteGoldFloor', { surface: 'stone_worn' });
    expect(findUniform(worn, 'tpXAlbedo')).toBeDefined();
    expect(findUniform(worn, 'tpXAlbedo')).not.toBe(findUniform(lib.get('whiteGoldFloor'), 'tpXAlbedo'));
    expect(worn.roughness).toBeCloseTo(SURFACE_FINISH.stone_worn!.props.roughness as number, 5);
    expect(worn.name).toContain('stone_worn');
    const caller = lib.clone<THREE.MeshPhysicalMaterial>('whiteGoldFloor', { surface: 'concrete_hangar', roughness: 0.5 });
    expect(caller.roughness).toBe(0.5); // the caller's own override wins over the finish
    const plain = lib.clone('whiteGold', { surface: 'none' });
    expect(findUniform(plain, 'tpXAlbedo')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    lib.clone('whiteGold', { surface: 'granite' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
