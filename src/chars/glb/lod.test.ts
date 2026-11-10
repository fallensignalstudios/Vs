import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LOD_SCREEN, LodSwitch, parseLodFile, setCharacterLodEnabled } from './lod';

/** a .lod.bin image: header + levels (u16 indices) */
function lodFile(vertexCount: number, levels: number[][], magic = 'ALOD'): ArrayBuffer {
  const words = 5 + levels.length;
  let bytes = words * 4;
  for (const l of levels) bytes += Math.ceil((l.length * 2) / 4) * 4;
  const buf = new ArrayBuffer(bytes), dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
  dv.setUint32(4, 1, true); dv.setUint32(8, vertexCount, true); dv.setUint32(12, 2, true); dv.setUint32(16, levels.length, true);
  levels.forEach((l, k) => dv.setUint32(20 + k * 4, l.length, true));
  let off = words * 4;
  for (const l of levels) { l.forEach((v, i) => dv.setUint16(off + i * 2, v, true)); off += Math.ceil((l.length * 2) / 4) * 4; }
  return buf;
}

function baseGeometry(n = 6): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setIndex([0, 1, 2, 3, 4, 5, 0, 2, 4]);
  return g;
}

describe('baked levels of detail', () => {
  it('parses levels as index buffers that share the base attributes', () => {
    const base = baseGeometry();
    const lods = parseLodFile(lodFile(6, [[0, 1, 2, 3, 4, 5], [0, 2, 4]]), base);
    expect(lods).not.toBeNull();
    expect(lods!.length).toBe(2);
    expect(lods![1].index!.count).toBe(3);
    expect(lods![0].getAttribute('position')).toBe(base.getAttribute('position'));
    expect(lods![0].getAttribute('normal')).toBe(base.getAttribute('normal'));
  });

  it('rejects a file baked for another mesh, a bad magic, an out-of-range index or a truncated file', () => {
    const base = baseGeometry();
    expect(parseLodFile(lodFile(7, [[0, 1, 2]]), base)).toBeNull();
    expect(parseLodFile(lodFile(6, [[0, 1, 2]], 'XLOD'), base)).toBeNull();
    expect(parseLodFile(lodFile(6, [[0, 1, 9]]), base)).toBeNull();
    expect(parseLodFile(lodFile(6, [[0, 1, 2]]).slice(0, 22), base)).toBeNull();
    expect(parseLodFile(new ArrayBuffer(3), base)).toBeNull();
  });

  it('picks levels by projected size with hysteresis', () => {
    const [t1, t2] = LOD_SCREEN;
    expect(LodSwitch.pick(0.6, 0, 1)).toBe(0);
    expect(LodSwitch.pick(t1 * 0.8, 0, 1)).toBe(1);
    expect(LodSwitch.pick(t2 * 0.5, 1, 1)).toBe(2);
    // just past a threshold the current level holds
    expect(LodSwitch.pick(t1 * 0.95, 0, 1)).toBe(0);
    expect(LodSwitch.pick(t1 * 1.05, 1, 1)).toBe(1);
    expect(LodSwitch.pick(t2 * 1.05, 2, 1)).toBe(2);
    // a coarser quality bias switches sooner
    expect(LodSwitch.pick(t1 * 1.1, 0, 1.7)).toBe(1);
  });

  it('swaps the governed geometry for the main camera only, and back to full when disabled', () => {
    const base = baseGeometry();
    const lods = parseLodFile(lodFile(6, [[0, 1, 2, 3, 4, 5], [0, 2, 4]]), base)!;
    const mesh = new THREE.Mesh(base);
    const cam = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
    const other = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
    const sw = new LodSwitch({ height: () => 1.9, mainCamera: () => cam, quality: () => 'high' });
    sw.govern(mesh, lods);
    const scene = new THREE.Scene();
    scene.add(sw, mesh, cam, other);
    const at = (c: THREE.PerspectiveCamera, d: number): void => { c.position.set(0, 0.95, d); c.updateMatrixWorld(true); };
    at(cam, 3.4); sw.updateMatrixWorld(true); sw.update(cam);
    expect(mesh.geometry).toBe(base);
    at(other, 60); sw.update(other);
    expect(mesh.geometry).toBe(base);
    at(cam, 60); sw.update(cam);
    expect(mesh.geometry).toBe(lods[1]);
    expect(sw.triangles).toBe(1);
    setCharacterLodEnabled(false);
    sw.update(cam);
    expect(mesh.geometry).toBe(base);
    setCharacterLodEnabled(true);
    sw.release();
    expect(mesh.geometry).toBe(base);
  });
});
