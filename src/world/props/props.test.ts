import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { HeroProp, HologramKind } from '@/core/api';
import { createMaterialLibrary } from '@/world/materials';
import { evalPiece, toppleCurve, type Piece } from './breakup';
import { chamferBox, hoop, Parts, strip, sweep } from './geo';
import { HoloCanvas, glyphMask } from './holo/canvas';
import { createHeroProps } from './index';

type Any = HeroProp<Record<string, number>>;

function drawCalls(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; });
  return n;
}

function finite(o: THREE.Object3D): boolean {
  let ok = true;
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    for (const v of c.matrixWorld.elements) if (!Number.isFinite(v)) ok = false;
    const im = c as THREE.InstancedMesh;
    if (im.isInstancedMesh) for (const v of im.instanceMatrix.array) if (!Number.isFinite(v)) ok = false;
    const g = (c as THREE.Mesh).geometry;
    if (g?.attributes.position) for (const v of g.attributes.position.array) if (!Number.isFinite(v)) { ok = false; break; }
  });
  return ok;
}

const HOLO: HologramKind[] = ['trajectory', 'threatStreams', 'diagnostic', 'forecast', 'casualtyLog', 'contaminationRecord', 'sensorReconstruction'];

function all(hero = createHeroProps(null)): Array<[string, Any, number]> {
  return [
    ['crownmarkFive', hero.crownmarkFive() as Any, 6],
    ['nestedRings', hero.nestedRings() as Any, 10],
    ['assentTarrik', hero.assentInterface('tarrik') as Any, 6],
    ['assentSelene', hero.assentInterface('selene') as Any, 6],
    ['stabilizer', hero.stabilizer() as Any, 6],
    ['observationSet', hero.observationSet() as Any, 6],
    ['recognitionThreshold', hero.recognitionThreshold() as Any, 6],
    ['cageDominion', hero.containmentCage('dominion') as Any, 6],
    ['cageReformation', hero.containmentCage('reformation') as Any, 6],
    ['fallenPlate', hero.fallenPlate() as Any, 6],
    ['shuttle', hero.departureShip('dominionShuttle') as Any, 6],
    ['transport', hero.departureShip('reformationTransport') as Any, 6],
    ...HOLO.map((k): [string, Any, number] => [`holo.${k}`, hero.hologram(k) as Any, 2]),
  ];
}

describe('hero props', () => {
  it('builds every prop inside its draw-call budget with finite geometry', () => {
    for (const [name, p, budget] of all()) {
      p.update(1 / 60, 0);
      expect(drawCalls(p.object), name).toBeLessThanOrEqual(budget);
      expect(drawCalls(p.object), name).toBeGreaterThan(0);
      expect(finite(p.object), name).toBe(true);
      p.dispose();
    }
  });

  it('builds with the real material library too', () => {
    const lib = createMaterialLibrary(null);
    const hero = createHeroProps({ mats: lib } as never);
    for (const [name, p] of all(hero)) {
      p.update(1 / 60, 0);
      expect(finite(p.object), name).toBe(true);
      p.dispose();
    }
  });

  it('survives every parameter at 0, 1 and garbage, and long steps', () => {
    for (const [name, p] of all()) {
      for (const v of [0, 1, NaN, -5, 99, Infinity]) {
        for (const k of Object.keys(p.params)) p.params[k] = v;
        for (let i = 0; i < 40; i++) p.update(i % 7 === 0 ? 0.5 : 1 / 30, i * 0.1);
        expect(finite(p.object), `${name} @ ${v}`).toBe(true);
      }
      p.update(NaN, NaN);
      p.snap();
      expect(finite(p.object), name).toBe(true);
      p.dispose();
      p.update(0.016, 1); // after dispose: no-op
    }
  });

  it('applies params instantly on the first update and on snap(), eases afterwards', () => {
    const plate = createHeroProps(null).fallenPlate() as HeroProp<{ lift: number }> & { tilt: number };
    plate.params.lift = 1;
    plate.update(1 / 60, 0);
    const lifted = plate.tilt;
    expect(lifted).toBeCloseTo(0.64, 2);
    plate.params.lift = 0;
    plate.update(1 / 60, 0.02);
    expect(plate.tilt).toBeLessThan(lifted);
    expect(plate.tilt).toBeGreaterThan(0.5);
    plate.snap();
    expect(plate.tilt).toBeCloseTo(0.14, 3);
  });

  it('exposes the documented sockets and warns once for unknown ones', () => {
    const hero = createHeroProps(null);
    const need: Array<[Any, string[]]> = [
      [hero.crownmarkFive() as Any, ['core', 'top']],
      [hero.assentInterface('tarrik') as Any, ['hand', 'stand']],
      [hero.stabilizer() as Any, ['stand', 'handL', 'handR', 'planeCenter']],
      [hero.fallenPlate() as Any, ['gripL', 'gripR', 'marine']],
      [hero.observationSet() as Any, ['seat0', 'seat1', 'seat2', 'seat3', 'seat4', 'seat5', 'tableTop', 'itemA', 'itemB']],
      [hero.departureShip('dominionShuttle') as Any, ['rampTop', 'rampBottom']],
      [hero.recognitionThreshold() as Any, ['depression0', 'depression4', 'approach', 'beyond']],
    ];
    for (const [p, names] of need) for (const n of names) expect(p.socket(n), `${p.object.name}.${n}`).toBeInstanceOf(THREE.Object3D);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = hero.crownmarkFive();
    expect(p.socket('nope')).toBeNull();
    expect(p.socket('nope')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('stand sockets sit in front of the prop and face it', () => {
    const p = createHeroProps(null).assentInterface('selene');
    const stand = p.socket('stand')!;
    expect(stand.position.z).toBeCloseTo(-0.7, 5);
    // engine yaw: forward = (−sin, 0, −cos) → yaw π faces +Z, toward the pedestal at the origin
    expect(-Math.cos(stand.rotation.y)).toBeCloseTo(1, 5);
    const seats = createHeroProps(null).observationSet();
    for (let i = 0; i < 6; i++) {
      const s = seats.socket(`seat${i}`)!;
      const fz = -Math.cos(s.rotation.y);
      expect(Math.sign(fz), `seat${i}`).toBe(-Math.sign(s.position.z)); // faces the table
    }
  });

  it('provides colliders where the spec asks for them', () => {
    const hero = createHeroProps(null);
    expect(hero.fallenPlate().colliders?.length).toBeGreaterThan(0);
    expect(hero.observationSet().colliders?.length).toBe(7);
    expect(hero.departureShip('reformationTransport').colliders?.length).toBeGreaterThan(0);
  });

  it('keeps inner rings clear of the walkable platform', () => {
    const hero = createHeroProps(null);
    const rings = hero.nestedRings({ radius: 24, height: 9, clearRadius: 30, clearHeight: 6 }) as Any;
    for (let i = 0; i < 400; i++) rings.update(0.25, i * 0.25);
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    let lowest = Infinity;
    rings.object.traverse((c) => {
      const im = c as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !im.name.endsWith('body')) return;
      im.geometry.computeBoundingBox();
      const m = new THREE.Matrix4();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        box.copy(im.geometry.boundingBox!).applyMatrix4(m);
        lowest = Math.min(lowest, box.min.y);
      }
    });
    expect(lowest).toBeGreaterThan(5.5);
    expect(p.x).toBe(0);
  });

  it('falls back for unknown kinds without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hero = createHeroProps(null);
    expect(() => hero.hologram('nope' as HologramKind).update(0.1, 0)).not.toThrow();
    expect(() => hero.containmentCage('nope' as 'dominion').update(0.1, 0)).not.toThrow();
    expect(() => hero.nestedRings({ radius: NaN, height: -1 } as never).update(0.1, 0)).not.toThrow();
    warn.mockRestore();
  });

  it('hologram text accepts anything', () => {
    for (const k of HOLO) {
      const h = createHeroProps(null).hologram(k);
      h.update(0.016, 0);
      expect(() => { h.setText('02:11:43'); h.setText('héllo ☃ {}'); h.setText(''); h.setText(undefined as never); h.setText('X'.repeat(500)); }).not.toThrow();
      h.params.visible = 0;
      h.snap();
      expect(h.object.visible).toBe(false);
      h.dispose();
    }
  });
});

describe('polish 3 additions', () => {
  it('effect shaders are cut by the global clipping planes (debug planView)', () => {
    const cage = createHeroProps(null).containmentCage('dominion');
    let n = 0;
    cage.object.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (!m || Array.isArray(m) || !m.isShaderMaterial) return;
      n++;
      expect(m.clipping).toBe(true);
      expect(m.vertexShader).toContain('#include <clipping_planes_vertex>');
      expect(m.fragmentShader).toContain('#include <clipping_planes_fragment>');
    });
    expect(n).toBeGreaterThan(0);
  });

  it('hologram pools hold the long headers and labels (40 / 32 characters)', () => {
    for (const k of HOLO) {
      const h = createHeroProps(null).hologram(k);
      const canvas = (h as unknown as { canvas: HoloCanvas }).canvas;
      // every quad the display asked for fitted in its pool (a full pool refuses quads silently)
      const max = (canvas as unknown as { max: number }).max;
      expect(canvas.count, k).toBeLessThan(max);
      h.setText('A'.repeat(40));
      h.update(0.016, 0);
      h.dispose();
    }
  });

  it('long header lines shrink to the nominal width instead of being cut off', () => {
    const c = new HoloCanvas(800);
    const fit = (26 * 4 - 1) * 0.011;
    const t = c.text('SHORT', 0, 0, 0.011, 0xffffff, 1, 0, 1, 40, fit);
    const mesh = c.mesh(new THREE.MeshBasicMaterial());
    const pos = mesh.geometry.attributes.position;
    const right = (): number => {
      let x = -Infinity;
      for (let i = 0; i < 40 * 15 * 4; i++) if (mesh.geometry.attributes.color.getW(i) > 0) x = Math.max(x, pos.getX(i));
      return x;
    };
    expect(right()).toBeLessThan(fit * 0.3);
    t.set('A'.repeat(40));
    c.commit();
    expect(right()).toBeLessThanOrEqual(fit + 0.011);
    expect(right()).toBeGreaterThan(fit * 0.9);
    t.set('B'.repeat(26));
    c.commit();
    expect(right()).toBeGreaterThan(fit * 0.9);
  });

  it('threatStreams labels are configurable; unknown slots warn once and do nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = createHeroProps(null).hologram('threatStreams');
    expect(() => {
      h.setLabel('top', 'CROWNWATCH TRACK');
      h.setLabel('bottom', 'RECOVERY TRACK');
      h.setLabel('status', 'SHARED TARGETS');
      h.setLabel('header', 'TRACK EXCHANGE');
      h.update(0.016, 1);
    }).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    h.setLabel('nope', 'X');
    h.setLabel('nope', 'X');
    expect(warn).toHaveBeenCalledTimes(1);
    const f = createHeroProps(null).hologram('forecast');
    expect(() => f.setLabel('header', 'MARGIN')).not.toThrow();
    warn.mockRestore();
    h.dispose(); f.dispose();
  });

  it('containmentCage opts: no fog anywhere, and a brighter distant read', () => {
    const lib = createMaterialLibrary(null);
    const hero = createHeroProps({ mats: lib } as never);
    const near = hero.containmentCage('dominion');
    const far = hero.containmentCage('dominion', { fog: false, distant: true });
    for (const p of [near, far]) p.update(1 / 60, 0);
    let fogged = 0;
    far.object.traverse((o) => {
      const m = (o as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined;
      if (m && m.fog) fogged++;
    });
    expect(fogged).toBe(0);
    const light = (p: typeof near): THREE.PointLight => p.object.getObjectByName('prop.cage.light') as THREE.PointLight;
    expect(light(far).intensity).toBeGreaterThan(light(near).intensity);
    near.dispose(); far.dispose();
  });
});

describe('break-up', () => {
  const piece = (motion: Piece['motion']): Piece => ({ set: 0, slot: 0, pos: new THREE.Vector3(1, 4, 0), quat: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1), motion });
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();

  it('is the rest pose at 0 and lands on the floor by 1', () => {
    const fly = piece({ kind: 'fly', t0: 0.1, vel: new THREE.Vector3(3, 4, 0), spinAxis: new THREE.Vector3(1, 0, 0), spin: 3, floor: 0.2 });
    evalPiece(fly, 0, 2.8, m).decompose(p, q, s);
    expect(p.toArray()).toEqual([1, 4, 0]);
    evalPiece(fly, 1, 2.8, m).decompose(p, q, s);
    expect(p.y).toBeCloseTo(0.2, 5);
    expect(p.x).toBeGreaterThan(3);
    // never below the floor on the way
    for (let d = 0; d <= 1; d += 0.01) {
      evalPiece(fly, d, 2.8, m).decompose(p, q, s);
      expect(p.y).toBeGreaterThanOrEqual(0.2 - 1e-6);
    }
  });

  it('hidden debris has no size before it starts; vanishing pieces shrink away', () => {
    const debris = piece({ kind: 'fly', t0: 0.3, vel: new THREE.Vector3(1, 1, 1), spinAxis: new THREE.Vector3(0, 1, 0), spin: 1, floor: 0, hidden: true, vanish: 1 });
    expect(evalPiece(debris, 0.2, 2.8, m).elements[0]).toBe(0);
    evalPiece(debris, 0.35, 2.8, m).decompose(p, q, s);
    expect(s.x).toBeGreaterThan(0.5);
    expect(Math.abs(evalPiece(debris, 1, 2.8, m).determinant())).toBeLessThan(1e-9);
  });

  it('topples about its hinge and settles at the authored angle', () => {
    const t = piece({ kind: 'topple', t0: 0, hinge: new THREE.Vector3(1, 3, 0), axis: new THREE.Vector3(0, 0, -1), angle: Math.PI / 2, seconds: 1 });
    evalPiece(t, 1, 2.8, m).decompose(p, q, s);
    expect(p.x).toBeCloseTo(2, 4);
    expect(p.y).toBeCloseTo(3, 4);
    expect(toppleCurve(0)).toBe(0);
    expect(toppleCurve(1)).toBe(1);
    expect(toppleCurve(5)).toBe(1);
  });
});

describe('geometry helpers', () => {
  const outward = (g: THREE.BufferGeometry): boolean => {
    // every triangle's geometric normal agrees with its vertex normal
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 9) {
      a.fromArray(pos, i); b.fromArray(pos, i + 3); c.fromArray(pos, i + 6);
      n.crossVectors(b.sub(a), c.sub(a));
      if (n.x * nrm[i] + n.y * nrm[i + 1] + n.z * nrm[i + 2] < -1e-9) return false;
    }
    return true;
  };

  it('chamferBox is a closed, outward-facing 44-triangle solid', () => {
    const g = chamferBox(2, 1, 3, 0.1);
    expect(g.attributes.position.count).toBe(44 * 3);
    expect(outward(g)).toBe(true);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.toArray()).toEqual([1, 0.5, 1.5]);
  });

  it('sweeps wind outward for full rings, partial arcs and reversed arcs', () => {
    expect(outward(hoop(2, 0, 0.2, 0.1))).toBe(true);
    expect(outward(hoop(2, 0, 0.2, 0.1, { a0: 1, a1: 4 }))).toBe(true);
    expect(outward(sweep([[1, 0], [1, 1], [0, 1]], { seg: 12 }))).toBe(true);
  });

  it('strip carries the reveal order along its length', () => {
    const g = strip([[0, 0], [1, 0], [1, 1]], 0.1, 0, 0.2, 0.8);
    const t = Array.from(g.attributes.aT.array);
    expect(Math.min(...t)).toBeCloseTo(0.2, 5);
    expect(Math.max(...t)).toBeCloseTo(0.8, 5);
  });

  it('Parts merges a slot into one geometry and mirrors with correct winding', () => {
    const P = new Parts();
    P.add('a', chamferBox(1, 1, 1, 0.1).translate(2, 0, 0));
    P.add('a', chamferBox(1, 1, 1, 0.1).translate(2, 0, 0), { s: [-1, 1, 1] });
    const g = P.geometry('a');
    expect(g.attributes.position.count).toBe(88 * 3);
    expect(g.attributes.color).toBeDefined();
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(-2.5, 5);
    expect(outward(g)).toBe(true);
  });
});

describe('holo canvas', () => {
  it('font masks and text fields', () => {
    expect(glyphMask('1')).toBe(0b010110010010111);
    expect(glyphMask('?')).toBe(0);
    const c = new HoloCanvas(64);
    const t = c.text('A', 0, 0, 0.01, 0xffffff, 1, 0, 1, 2);
    expect(t.range[1]).toBe(30);
    expect(c.quad(new Array(12).fill(0), 0xffffff)).toBe(30);
    for (let i = 0; i < 40; i++) c.rect(0, 0, 1, 1, 0xffffff); // overflow is refused, not thrown
    expect(c.count).toBe(64);
    expect(c.rect(0, 0, 1, 1, 0xffffff)).toBe(-1);
    t.set('ZZZZZZ');
    c.setAlpha(-1, 1);
    c.setAlpha(9999, 1);
    // fading a text range never lights the cells its glyphs leave dark
    const c2 = new HoloCanvas(64);
    const t2 = c2.text('1', 0, 0, 0.01, 0xffffff, 1);
    c2.fade(t2.range, 0.5);
    const mesh = c2.mesh(new THREE.MeshBasicMaterial());
    const alpha = (id: number): number => mesh.geometry.attributes.color.getW(id * 4);
    expect(alpha(0)).toBe(0);
    expect(alpha(1)).toBe(0.5);
  });
});

describe('polish 4 additions', () => {
  const ringBox = (rings: Any): { lowest: number; maxTilt: number; heights: number[] } => {
    let lowest = Infinity, maxTilt = 0;
    const heights: number[] = [];
    const box = new THREE.Box3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3();
    rings.object.traverse((c) => {
      const im = c as THREE.InstancedMesh;
      if (!im.isInstancedMesh || !im.name.endsWith('body')) return;
      im.geometry.computeBoundingBox();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        box.copy(im.geometry.boundingBox!).applyMatrix4(m);
        lowest = Math.min(lowest, box.min.y);
        m.decompose(p, q, s);
        heights.push(p.y);
        maxTilt = Math.max(maxTilt, up.set(0, 1, 0).applyQuaternion(q).angleTo(new THREE.Vector3(0, 1, 0)));
      }
    });
    return { lowest, maxTilt, heights };
  };

  it("nestedRings 'concentric' keeps the rings near level and stacked, still clear of the platform; 'chrome' is polished metal", () => {
    const hero = createHeroProps({ mats: createMaterialLibrary(null) } as never);
    const rings = hero.nestedRings({ radius: 24, height: 9, clearRadius: 30, clearHeight: 6, layout: 'concentric', finish: 'chrome', column: 3 }) as Any;
    for (let i = 0; i < 200; i++) rings.update(0.25, i * 0.25);
    const r = ringBox(rings);
    expect(r.maxTilt).toBeLessThan((5.5 * Math.PI) / 180);
    expect(r.lowest).toBeGreaterThan(5.5);
    expect(new Set(r.heights.map((h) => h.toFixed(2))).size).toBeGreaterThan(3);
    let body: THREE.MeshStandardMaterial | null = null;
    rings.object.traverse((c) => { const im = c as THREE.InstancedMesh; if (im.isInstancedMesh && im.name.endsWith('s0.body')) body = im.material as THREE.MeshStandardMaterial; });
    expect(body!.metalness).toBe(1);
    expect(body!.roughness).toBeLessThan(0.1);
    // align still brings every ring into one plane
    rings.params.align = 1;
    for (let i = 0; i < 120; i++) rings.update(0.25, 60 + i * 0.25);
    const a = ringBox(rings);
    expect(Math.max(...a.heights) - Math.min(...a.heights)).toBeLessThan(0.05);
  });

  it('crownmarkFive: `steady` lights the core without folding the claws; `scale` grows object and collider together', () => {
    const hero = createHeroProps(null);
    const mark = hero.crownmarkFive() as Any;
    mark.update(0.016, 0);
    const claws = (o: THREE.Object3D): Float32Array => { let a = new Float32Array(); o.traverse((c) => { const im = c as THREE.InstancedMesh; if (im.isInstancedMesh) a = Float32Array.from(im.instanceMatrix.array); }); return a; };
    const before = claws(mark.object);
    let light = 0;
    mark.object.traverse((c) => { if ((c as THREE.PointLight).isPointLight) light = (c as THREE.PointLight).intensity; });
    mark.params.steady = 1;
    mark.snap();
    mark.update(0.016, 1);
    let lit = 0;
    mark.object.traverse((c) => { if ((c as THREE.PointLight).isPointLight) lit = (c as THREE.PointLight).intensity; });
    expect(lit).toBeGreaterThan(light + 20);
    expect(Array.from(claws(mark.object))).toEqual(Array.from(before));
    const big = hero.crownmarkFive({ scale: 1.6 }) as Any;
    expect(big.object.scale.x).toBeCloseTo(1.6);
    const c = big.colliders![0];
    expect((c.shape as { r: number }).r).toBeCloseTo(1.78 * 1.6);
  });
});
