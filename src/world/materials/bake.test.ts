import { describe, expect, it } from 'vitest';
import { linearRgb, newLayers, packLayers, toSrgb8 } from './bake';
import { cavity, cracks, normalsFromHeight, pits, plates, scratches, veins, weave } from './features';
import { FAMILIES, FAMILY_IDS, familySize } from './families';
import { bakeDetail, bakeMacro, bakeVeins } from './shared';
import { MAT_DEFS, MAT_IDS } from './defs';

/** Max wrap-around step relative to the max interior step, per channel of an RGBA8 image. */
function seamRatio8(data: Uint8Array, size: number, ch: number): number {
  let seam = 0, inner = 1;
  const at = (x: number, y: number): number => data[(y * size + x) * 4 + ch];
  for (let i = 0; i < size; i++) {
    seam = Math.max(seam, Math.abs(at(0, i) - at(size - 1, i)), Math.abs(at(i, 0) - at(i, size - 1)));
    for (let j = 1; j < size; j++) inner = Math.max(inner, Math.abs(at(j, i) - at(j - 1, i)), Math.abs(at(i, j) - at(i, j - 1)));
  }
  return seam / inner;
}

describe('colour helpers', () => {
  it('sRGB encode / decode round-trips', () => {
    expect(toSrgb8(0)).toBe(0);
    expect(toSrgb8(1)).toBe(255);
    expect(toSrgb8(2)).toBe(255);
    expect(toSrgb8(-1)).toBe(0);
    const [r, g, b] = linearRgb(0xd9d2c0);
    expect(toSrgb8(r)).toBeCloseTo(0xd9, -0.5);
    expect(toSrgb8(g)).toBeCloseTo(0xd2, -0.5);
    expect(toSrgb8(b)).toBeCloseTo(0xc0, -0.5);
  });
});

describe('features', () => {
  it('normalsFromHeight: flat → +Z, slope tilts against the gradient, unit length', () => {
    const flat = normalsFromHeight({ size: 8, data: new Float32Array(64).fill(0.3) }, 0.01);
    expect(flat[0]).toBeCloseTo(0, 6); expect(flat[1]).toBeCloseTo(0, 6); expect(flat[2]).toBeCloseTo(1, 6);
    const ramp = new Float32Array(64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) ramp[y * 8 + x] = Math.sin((x / 8) * Math.PI * 2) * 0.5 + 0.5;
    const n = normalsFromHeight({ size: 8, data: ramp }, 0.2);
    const i = (1 * 8 + 0) * 3; // x = 0: height rising along +u → normal leans toward −u
    expect(n[i]).toBeLessThan(0);
    for (let k = 0; k < 64; k++) expect(Math.hypot(n[k * 3], n[k * 3 + 1], n[k * 3 + 2])).toBeCloseTo(1, 5);
  });

  it('plates: grooves at 0, tops at 1, ids flat per plate', () => {
    const p = plates(64, { cols: 2, rows: 2, seam: 1, bevel: 2, seed: 1 });
    expect(p.height.data[0]).toBe(0); // corner sits in a seam
    expect(p.height.data[16 * 64 + 16]).toBe(1); // plate centre
    expect(p.id.data[10 * 64 + 10]).toBe(p.id.data[20 * 64 + 20]);
    expect(p.id.data[10 * 64 + 10]).not.toBe(p.id.data[10 * 64 + 50]);
    expect(p.v01.data[16 * 64 + 16]).toBeCloseTo(0.5, 5);
  });

  it('generators stay inside [0, 1]', () => {
    const fields = [
      scratches(64, { count: 20, minLen: 4, maxLen: 30, seed: 1 }),
      veins(64, { freq: 3, seed: 2, warp: 0.12, width: 0.03 }),
      pits(64, 8, 3, 0.5, 0.3),
      cracks(64, 5, 4, 0.05, 2),
      weave(64, 8, 'twill'),
      weave(64, 8, 'ripstop'),
      cavity(weave(64, 8, 'plain'), 2, 2),
    ];
    for (const f of fields) for (const v of f.data) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1.0001); }
  });

  it('scratches actually draws something', () => {
    const s = scratches(64, { count: 10, minLen: 10, maxLen: 30, seed: 5 });
    expect(Math.max(...s.data)).toBeGreaterThan(0.3);
  });
});

describe('packLayers', () => {
  it('packs neutral layers to the documented encoding', () => {
    const l = newLayers(4, 0.01);
    const p = packLayers(l);
    expect(Array.from(p.albedo.slice(0, 4))).toEqual([255, 255, 255, 128]);
    expect(Array.from(p.normal.slice(0, 4))).toEqual([128, 128, 255, 255]);
    expect(Array.from(p.orm.slice(0, 4))).toEqual([255, 128, 255, 0]);
  });
});

describe('texture families', () => {
  it('familySize tiers', () => {
    expect(familySize('hero', 1024)).toBe(1024);
    expect(familySize('mid', 1024)).toBe(512);
    expect(familySize('small', 1024)).toBe(256);
    expect(familySize('hero', 2048)).toBe(2048);
    expect(familySize('mid', 2048)).toBe(1024);
    expect(familySize('small', 2048)).toBe(512);
    expect(familySize('mid', 256)).toBe(256);
    expect(familySize('hero', 64)).toBe(256);
  });

  it('every family bakes finite, seamless maps with usable contrast', () => {
    for (const id of FAMILY_IDS) {
      const layers = FAMILIES[id].generate(64);
      for (const ch of [layers.r, layers.g, layers.b, layers.height, layers.rough, layers.metal, layers.ao, layers.mask]) {
        for (const v of ch) if (!Number.isFinite(v)) throw new Error(`${id}: non-finite texel`);
      }
      const p = packLayers(layers);
      expect(p.albedo.length).toBe(64 * 64 * 4);
      // tiling: the wrap-around step must not stand out from interior steps (all three maps, main channels)
      for (const [img, ch] of [[p.albedo, 0], [p.albedo, 3], [p.normal, 0], [p.normal, 1], [p.orm, 1]] as const) {
        expect(seamRatio8(img, 64, ch), `${id} seam`).toBeLessThanOrEqual(1.5);
      }
      // normals mostly point out of the surface
      let nz = 0;
      for (let i = 0; i < 64 * 64; i++) nz += p.normal[i * 4 + 2];
      expect(nz / (64 * 64), `${id} mean normal z`).toBeGreaterThan(150);
      // roughness carries real variation (micro-detail in roughness, not just albedo)
      let lo = 255, hi = 0;
      for (let i = 0; i < 64 * 64; i++) { lo = Math.min(lo, p.orm[i * 4 + 1]); hi = Math.max(hi, p.orm[i * 4 + 1]); }
      expect(hi - lo, `${id} roughness range`).toBeGreaterThan(24);
    }
  });

  it('families are deterministic', () => {
    const a = packLayers(FAMILIES.blackStone.generate(64));
    const b = packLayers(FAMILIES.blackStone.generate(64));
    const same = (x: Uint8Array, y: Uint8Array): boolean => x.length === y.length && x.every((v, i) => v === y[i]);
    expect(same(a.albedo, b.albedo)).toBe(true);
    expect(same(a.orm, b.orm)).toBe(true);
  });

  it('shared maps have the right size and tile', () => {
    for (const bake of [bakeMacro, bakeDetail, bakeVeins]) {
      const d = bake(64);
      expect(d.length).toBe(64 * 64 * 4);
      expect(seamRatio8(d, 64, 0)).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('material table', () => {
  it('every textured material names an existing family and a sane scale', () => {
    expect(MAT_IDS.length).toBe(36);
    for (const id of MAT_IDS) {
      const d = MAT_DEFS[id];
      if (d.family) {
        expect(FAMILIES[d.family], `${id} family`).toBeDefined();
        expect(d.tp, `${id} triplanar params`).toBeDefined();
        expect(d.tp?.scale ?? 0).toBeGreaterThan(0.05);
      }
    }
  });

  it('the mirror floor is in the specified roughness window', () => {
    const r = MAT_DEFS.blackStoneFloor.props.roughness as number;
    const amp = MAT_DEFS.blackStoneFloor.tp?.roughAmp ?? 0;
    expect(r - amp / 2).toBeGreaterThanOrEqual(0.045);
    expect(r + amp / 2).toBeLessThanOrEqual(0.16);
    expect(r).toBeGreaterThanOrEqual(0.06);
    expect(r).toBeLessThanOrEqual(0.15);
  });
});
