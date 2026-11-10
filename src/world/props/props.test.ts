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
  });
});
