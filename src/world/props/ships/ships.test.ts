import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { asScenicShip } from '@/core/api';
import { ShipMaterials, buildShip } from '@/render/sky/scenic/ships';
import { createSharedUniforms } from '@/render/sky/shared';
import { createHeroProps } from '../index';
import { DepartureShip } from '../ship';
import { SHIP_MODELS, SHIP_MODEL_IDS, expandGlow, shipScale } from './catalog';
import { EscortFlight } from './escort';
import { buildGlow, patchHull } from './glow';
import { parseShipLod, requestShip, shipLoadingEnabled } from './loader';
import { GeneratedShip, ShipLod } from './model';
import { SILHOUETTE_LIGHTS, silhouette } from './silhouettes';
import { GeoBuilder } from '@/render/sky/scenic/geo';
import { PartSink, buildGeneratedCapital, paletteFor } from '@/render/sky/scenic/hulls';

/** node:fs without @types/node (tests run in node) */
type NodeFs = { readFileSync(p: URL): Uint8Array; existsSync(p: URL): boolean };
let fs: NodeFs;
beforeAll(async () => { fs = (await import(/* @vite-ignore */ String('node:fs'))) as NodeFs; });
const MODELS = new URL('../../../../public/models/', import.meta.url);
const file = (name: string): URL => new URL(name, MODELS);
function bytes(name: string): ArrayBuffer {
  const b = fs.readFileSync(file(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function finite(o: THREE.Object3D): boolean {
  let ok = true;
  o.updateMatrixWorld(true);
  o.traverse((c) => { for (const v of c.matrixWorld.elements) if (!Number.isFinite(v)) ok = false; });
  return ok;
}

/** vertex count of the main mesh's POSITION accessor, read from the GLB's JSON chunk (no decoding needed) */
function glbVertexCount(name: string): number {
  const buf = bytes(name);
  const len = new DataView(buf).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))) as { meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>; accessors: Array<{ count: number }> };
  return json.accessors[json.meshes[0].primitives[0].attributes.POSITION].count;
}

describe('generated ships: catalog', () => {
  it('names files that exist, with glow points on the hull and sane sizes', () => {
    for (const id of SHIP_MODEL_IDS) {
      const s = SHIP_MODELS[id];
      expect(fs.existsSync(file(s.file)), s.file).toBe(true);
      expect(fs.existsSync(file(s.lod)), s.lod).toBe(true);
      const els = expandGlow(s);
      expect(els.length).toBeGreaterThanOrEqual(s.glow.length);
      for (const e of els) {
        for (const v of [...e.p, ...e.axis, ...e.size, e.intensity]) expect(Number.isFinite(v), `${id} ${e.shape}`).toBe(true);
        for (const v of e.p) expect(Math.abs(v)).toBeLessThanOrEqual(0.52);
        expect(e.size[0]).toBeGreaterThan(0);
        expect(Math.hypot(...e.axis)).toBeGreaterThan(0.5);
      }
    }
  });

  it('mirrors elements across x = 0 and scales to the forge lengths', () => {
    const s = SHIP_MODELS.dominionShuttle;
    const els = expandGlow(s);
    expect(els.length).toBe(s.glow.length + s.glow.filter((g) => g.mirror).length);
    expect(shipScale('dominionShuttle')).toBeCloseTo(18 / 0.936, 3);
    expect(shipScale('dominionCapital')).toBe(600);
    expect(shipScale('reformationCarrier')).toBe(500);
    expect(shipScale('reformationDropship', 15)).toBe(15);
    expect(shipScale('reformationDropship', Number.NaN)).toBe(22);
  });

  it('ships baked LOD files that belong to their GLBs', () => {
    for (const id of SHIP_MODEL_IDS) {
      const s = SHIP_MODELS[id];
      const vc = glbVertexCount(s.file);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
      const levels = parseShipLod(bytes(s.lod), g);
      expect(levels, s.lod).not.toBeNull();
      expect(levels!.length).toBe(2);
      expect(levels![1].index!.count).toBeLessThan(levels![0].index!.count);
      // a geometry of another size is refused
      const other = new THREE.BufferGeometry();
      other.setAttribute('position', new THREE.BufferAttribute(new Float32Array((vc + 1) * 3), 3));
      expect(parseShipLod(bytes(s.lod), other)).toBeNull();
    }
  });
});

describe('generated ships: glow and hull', () => {
  it('puts every glow element in one additive mesh with finite attributes', () => {
    for (const id of SHIP_MODEL_IDS) {
      const s = SHIP_MODELS[id];
      const { mesh, uniforms } = buildGlow(s, { minPx: 2 });
      const n = expandGlow(s).length;
      expect(mesh.geometry.getAttribute('position').count).toBe(n * 4);
      expect(mesh.geometry.index!.count).toBe(n * 6);
      const mat = mesh.material as THREE.ShaderMaterial;
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mat.depthWrite).toBe(false);
      for (const name of Object.keys(mesh.geometry.attributes)) for (const v of mesh.geometry.getAttribute(name).array as Float32Array) expect(Number.isFinite(v)).toBe(true);
      expect(uniforms.uMinPx.value).toBe(2);
    }
  });

  it('patches the hull shader: engine texels, roughness floor, optional sky haze', () => {
    const base = new THREE.MeshStandardMaterial({ name: 'tpl' });
    const run = (m: THREE.MeshStandardMaterial): { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> } => {
      const lib = THREE.ShaderLib.physical;
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) } as unknown as THREE.WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
      return shader as unknown as { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> };
    };
    const near = patchHull(base, 'amber');
    expect(near.material).not.toBe(base);
    expect(near.material.fog).toBe(true);
    const sn = run(near.material);
    expect(sn.fragmentShader).toMatch(/uShipEmis/);
    expect(sn.fragmentShader).toMatch(/max\(roughnessFactor, uShipMinRough\)/);
    expect(sn.fragmentShader).not.toMatch(/skyHaze/);
    const far = patchHull(base, 'blue', { haze: { glsl: 'uniform vec3 uHaze;\nvec3 skyHaze(vec3 d) { return uHaze; }', uniforms: { uHaze: { value: new THREE.Color() }, uHazeDensity: { value: 0.001 } } } });
    expect(far.material.fog).toBe(false);
    const sf = run(far.material);
    expect(sf.fragmentShader).toMatch(/skyHaze\(hd/);
    expect(sf.vertexShader).toMatch(/vShipWorld = /);
    expect(sf.uniforms.uHazeDensity.value).toBe(0.001);
    expect(near.material.customProgramCacheKey()).not.toBe(far.material.customProgramCacheKey());
  });

  it('switches LOD levels by projected size with hysteresis', () => {
    expect(ShipLod.pick(0.5, 0)).toBe(0);
    expect(ShipLod.pick(0.05, 0)).toBe(1);
    expect(ShipLod.pick(0.01, 0)).toBe(2);
    // just under the level-0 threshold: a ship at level 0 stays there, one at level 1 stays at 1
    expect(ShipLod.pick(0.12 * 0.95, 0)).toBe(0);
    expect(ShipLod.pick(0.12 * 1.05, 1)).toBe(1);
  });
});

describe('generated ships: instances without a page', () => {
  it('stays procedural (loading disabled in tests) and never throws', async () => {
    expect(shipLoadingEnabled()).toBe(false);
    expect(await requestShip('dominionCapital')).toBeNull();
    const g = new GeneratedShip('dominionCapital', { frame: 'minusZ' });
    expect(await g.ready).toBe(false);
    expect(g.loaded).toBe(false);
    expect(g.object.children.length).toBe(0);
    g.engines = Number.NaN;
    expect(g.engines).toBe(0);
    g.engines = 9;
    expect(g.engines).toBe(1.5);
    expect(g.length).toBe(600);
    g.dispose();
  });

  it('escort: hidden at 0, in formation at 1, finite on garbage', () => {
    const e = new EscortFlight('dominionShuttle', 14.4, { count: 5 }, () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    expect(e.count).toBe(5);
    e.set(0, 0);
    for (const c of e.craft) expect(c.visible).toBe(false);
    e.set(1, 3);
    for (const c of e.craft) {
      expect(c.visible).toBe(true);
      expect(c.position.length()).toBeLessThan(14.4 * 4);
      expect(c.position.x).toBeLessThan(0); // astern of the escorted craft
    }
    e.set(0.3, 1);
    const far = e.craft.map((c) => c.position.length());
    e.set(0.9, 1);
    e.craft.forEach((c, i) => expect(c.position.length()).toBeLessThan(far[i]));
    for (const v of [Number.NaN, -3, 99, Number.POSITIVE_INFINITY]) { e.set(v, v); expect(finite(e.object)).toBe(true); }
    e.dispose();
  });

  it('departure craft: berth sockets and colliders, the escort param, dispose', () => {
    const hero = createHeroProps(null);
    for (const kind of ['dominionShuttle', 'reformationTransport'] as const) {
      const p = hero.departureShip(kind);
      expect(p).toBeInstanceOf(DepartureShip);
      expect(p.generated).toBe(false);
      expect(p.length).toBeGreaterThan(14);
      const top = p.socket('rampTop')!, bottom = p.socket('rampBottom')!;
      expect(top.position.y).toBeGreaterThan(0.9);
      expect(bottom.position.y).toBe(0);
      expect(bottom.position.z).toBeLessThan(top.position.z);
      expect(Math.abs(bottom.position.x - top.position.x)).toBeLessThan(1e-6);
      expect(p.colliders!.length).toBeGreaterThanOrEqual(2);
      p.configureEscort({ count: 3 });
      p.params.escort = 1;
      p.params.engines = 1;
      p.update(1 / 60, 0);
      p.snap();
      expect(p.escortCraft().length).toBe(3);
      for (const c of p.escortCraft()) expect(c.visible).toBe(true);
      expect(finite(p.object)).toBe(true);
      p.params.escort = 0;
      p.snap();
      for (const c of p.escortCraft()) expect(c.visible).toBe(false);
      p.dispose();
    }
  });

  it('scenic ships carry live controls and keep the procedural stand-in', async () => {
    const shared = createSharedUniforms();
    const mats = new ShipMaterials({} as never);
    for (const kind of ['dominionShuttle', 'reformationTransport', 'dominionCapital', 'reformationCapital'] as const) {
      const o = buildShip(shared, mats, kind, 2);
      const c = asScenicShip(o);
      expect(c, kind).not.toBeNull();
      expect(c!.kind).toBe(kind);
      expect(await c!.ready).toBe(false);
      expect(c!.generated).toBe(false);
      expect(c!.length).toBeGreaterThan(40);
      c!.engines = 1.2;
      expect(c!.engines).toBeCloseTo(1.2, 6);
      expect(o.scale.x).toBe(2);
      expect(o.getObjectByName(`scenic:${kind}:procedural`)?.visible).toBe(true);
    }
    expect(asScenicShip(new THREE.Group())).toBeNull();
    expect(asScenicShip(null)).toBeNull();
  });
});

describe('generated ships: synchronous silhouettes (fleet impostors, far stand-ins)', () => {
  it('decode into the hull frame at the forge lengths, nose toward −Z', () => {
    for (const [id, len] of [['dominionCapital', 600], ['reformationCarrier', 500]] as const) {
      const m = silhouette(id);
      expect(m.tris).toBeGreaterThan(1000);
      expect(m.idx.length).toBe(m.tris * 3);
      const box = new THREE.Box3();
      for (let i = 0; i < m.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) expect(Number.isFinite(m.pos[i + k])).toBe(true);
        box.expandByPoint(new THREE.Vector3(m.pos[i], m.pos[i + 1], m.pos[i + 2]));
      }
      const size = box.getSize(new THREE.Vector3());
      expect(size.z).toBeGreaterThan(len * 0.9); // the thin lance tip of the capital simplifies away
      expect(size.z).toBeLessThan(len * 1.05);
      expect(size.x).toBeLessThan(size.z * 0.5);
      for (const v of m.idx) expect(v).toBeLessThan(m.pos.length / 3);
      expect(m.faceGlow.some((g) => g > 0)).toBe(true);
      // the engines sit at the stern (+Z), inside the hull's extent
      for (const [, , z] of SILHOUETTE_LIGHTS[id].engines) expect(z).toBeGreaterThan(box.max.z * 0.6);
    }
  });

  it('emits as a vertex-coloured hull through a PartSink', () => {
    for (const kind of ['dominionCapital', 'reformationCapital'] as const) {
      const b = new GeoBuilder();
      buildGeneratedCapital(kind, PartSink.single(paletteFor(kind), b));
      expect(b.triangleCount).toBeGreaterThan(1000);
      const g = b.build();
      for (const v of g.getAttribute('position').array as Float32Array) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
