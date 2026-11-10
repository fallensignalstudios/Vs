import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { band, blob, box, computeNormals, cyl, lathe, plate, prism, shard, sphere, subdivide, T, torus, tube, xform, type Soup } from './geo';

/** signed volume of a closed, outward-wound triangle soup (positive when the winding faces out) */
function volume(s: Soup): number {
  let v = 0;
  const p = s.p;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i]!, ay = p[i + 1]!, az = p[i + 2]!, bx = p[i + 3]!, by = p[i + 4]!, bz = p[i + 5]!, cx = p[i + 6]!, cy = p[i + 7]!, cz = p[i + 8]!;
    v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

function wellFormed(s: Soup): void {
  expect(s.p.length % 9).toBe(0);
  expect(s.e.length).toBe(s.p.length / 3);
  if (s.u) expect(s.u.length).toBe(s.p.length / 3);
  for (const x of s.p) expect(Number.isFinite(x)).toBe(true);
}

describe('creature modelling primitives', () => {
  it('box: closed, outward, volume close to w·h·d and flags its bevels', () => {
    const plain = box(1, 2, 3);
    wellFormed(plain);
    expect(volume(plain)).toBeCloseTo(6, 5);
    const bev = box(1, 2, 3, 0.05);
    wellFormed(bev);
    expect(bev.p.length / 9).toBe(44);
    expect(volume(bev)).toBeGreaterThan(5.9);
    expect(volume(bev)).toBeLessThan(6);
    expect(bev.e.some((e) => e === 1)).toBe(true);
    expect(bev.e.some((e) => e === 0)).toBe(true);
  });

  it('prism: any outline winding yields an outward solid; concave outlines triangulate', () => {
    const ccw = prism([[0, 0], [2, 0], [2, 1], [0, 1]], 0.5);
    const cw = prism([[0, 1], [2, 1], [2, 0], [0, 0]], 0.5);
    expect(volume(ccw)).toBeCloseTo(1, 5);
    expect(volume(cw)).toBeCloseTo(1, 5);
    const lShape = prism([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 1, 0.05);
    wellFormed(lShape);
    expect(volume(lShape)).toBeGreaterThan(2.9);
    expect(volume(lShape)).toBeLessThan(3.0);
  });

  it('revolved, swept and organic primitives are outward-wound closed solids', () => {
    expect(volume(cyl(1, 1, 2, 32))).toBeGreaterThan(Math.PI * 2 * 0.98);
    expect(volume(cyl(0.5, 0.3, 1, 12, 0.03))).toBeGreaterThan(0);
    expect(volume(lathe([[0, -1], [1, -1], [1, 1], [0, 1]], 24))).toBeGreaterThan(6);
    expect(volume(band(1, 0.2, 0.1, 24, 0.02))).toBeGreaterThan(0);
    expect(volume(band(1, 0.2, 0.1, 24, 0.02, 4))).toBeGreaterThan(0);
    expect(volume(torus(1, 0.2, 24, 8))).toBeGreaterThan(0);
    expect(volume(sphere(1, 2))).toBeGreaterThan(3.9);
    expect(volume(blob(1, 2, 0.3, 5))).toBeGreaterThan(2);
    expect(volume(shard(1, 0.3, 0.2, 7))).toBeGreaterThan(0);
    const t = tube([[0, 0, 0], [0, 1, 0], [0.5, 2, 0]], 0.1, 8);
    wellFormed(t);
    expect(volume(t)).toBeGreaterThan(0);
    expect(Math.min(...t.u!)).toBe(0);
    expect(Math.max(...t.u!)).toBe(1);
  });

  it('plate bends and stays a solid; subdivide preserves volume', () => {
    const flat = prism([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], 0.1);
    const sub = subdivide(flat, 0.2);
    expect(sub.p.length).toBeGreaterThan(flat.p.length);
    expect(volume(sub)).toBeCloseTo(volume(flat), 5);
    const bent = plate([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], 0.1, 0.02, 0.8, 1.2);
    wellFormed(bent);
    expect(volume(bent)).toBeGreaterThan(0.05);
  });

  it('mirroring through xform keeps the winding outward', () => {
    const s = xform(box(1, 1, 1, 0.1), new THREE.Matrix4().makeScale(-1, 1, 1));
    expect(volume(s)).toBeGreaterThan(0.9);
  });

  it('computeNormals: unit length, flat faces stay flat, bevels blend, spheres are smooth', () => {
    const b = box(1, 1, 1, 0.05);
    const n = computeNormals(b.p, 60);
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!)).toBeCloseTo(1, 4);
    // a vertex on a big face (edge flag 0) keeps an axis-aligned normal despite the neighbouring bevel
    let checked = 0;
    for (let v = 0; v < b.e.length; v++) {
      if (b.e[v] !== 0) continue;
      const m = Math.max(Math.abs(n[v * 3]!), Math.abs(n[v * 3 + 1]!), Math.abs(n[v * 3 + 2]!));
      expect(m).toBeGreaterThan(0.97);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    const s = sphere(1, 2);
    const sn = computeNormals(s.p, 180);
    for (let v = 0; v < s.p.length / 3; v++) {
      const d = sn[v * 3]! * s.p[v * 3]! + sn[v * 3 + 1]! * s.p[v * 3 + 1]! + sn[v * 3 + 2]! * s.p[v * 3 + 2]!;
      expect(d).toBeGreaterThan(0.98);
    }
    const flat = computeNormals(b.p, 0);
    expect(flat.length).toBe(b.p.length);
  });

  it('T composes translate · rotate · scale', () => {
    const v = new THREE.Vector3(0, 1, 0).applyMatrix4(T(1, 2, 3, -Math.PI / 2, 0, 0, 2));
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(2, 5);
    expect(v.z).toBeCloseTo(1, 5); // +Y → −Z (the model's front), scaled ×2
  });
});
