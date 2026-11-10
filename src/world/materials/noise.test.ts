import { describe, expect, it } from 'vitest';
import { addValueNoise, blur, fbm, hash2, sampleBilinear, sstep, warp, worley } from './noise';

/** Largest difference between each edge texel and its wrapped neighbour, relative to interior differences. */
function seamRatio(data: Float32Array, size: number): number {
  let seam = 0, inner = 0;
  for (let y = 0; y < size; y++) {
    seam = Math.max(seam, Math.abs(data[y * size] - data[y * size + size - 1]));
    seam = Math.max(seam, Math.abs(data[y] - data[(size - 1) * size + y]));
    for (let x = 1; x < size; x++) inner = Math.max(inner, Math.abs(data[y * size + x] - data[y * size + x - 1]));
  }
  for (let x = 0; x < size; x++) for (let y = 1; y < size; y++) inner = Math.max(inner, Math.abs(data[y * size + x] - data[(y - 1) * size + x]));
  return seam / inner;
}

describe('noise toolkit', () => {
  it('hash2 is deterministic and in [0, 1)', () => {
    expect(hash2(3, 7, 11)).toBe(hash2(3, 7, 11));
    expect(hash2(3, 7, 11)).not.toBe(hash2(3, 7, 12));
    for (let i = 0; i < 500; i++) {
      const v = hash2(i * 13 - 200, i * 7 + 5, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hash2 is roughly uniform', () => {
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += hash2(i % 141, (i / 141) | 0, 5);
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it('fbm is normalised, deterministic and tiles seamlessly', () => {
    const a = fbm(64, { freq: 3, octaves: 4, seed: 9 });
    const b = fbm(64, { freq: 3, octaves: 4, seed: 9 });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    let lo = Infinity, hi = -Infinity;
    for (const v of a.data) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    expect(lo).toBeCloseTo(0, 6);
    expect(hi).toBeCloseTo(1, 6);
    // wrap-around steps are no larger than ordinary neighbour steps
    expect(seamRatio(a.data, 64)).toBeLessThanOrEqual(1.0001);
  });

  it('ridged and billow modes tile too', () => {
    for (const mode of ['ridged', 'billow'] as const) {
      const f = fbm(64, { freq: 4, octaves: 3, seed: 3, mode });
      expect(seamRatio(f.data, 64)).toBeLessThanOrEqual(1.0001);
    }
  });

  it('anisotropic noise is stretched along the low-frequency axis', () => {
    const out = new Float32Array(64 * 64);
    addValueNoise(out, 64, 2, 32, 5);
    let dx = 0, dy = 0;
    for (let y = 0; y < 63; y++) for (let x = 0; x < 63; x++) {
      dx += Math.abs(out[y * 64 + x + 1] - out[y * 64 + x]);
      dy += Math.abs(out[(y + 1) * 64 + x] - out[y * 64 + x]);
    }
    expect(dy).toBeGreaterThan(dx * 4);
  });

  it('worley distances are ordered and tile', () => {
    const w = worley(64, 6, 2);
    for (let i = 0; i < w.f1.data.length; i++) expect(w.f2.data[i]).toBeGreaterThanOrEqual(w.f1.data[i]);
    expect(seamRatio(w.f1.data, 64)).toBeLessThanOrEqual(1.0001);
    for (const v of w.id.data) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('bilinear sampling wraps', () => {
    const f = { size: 4, data: new Float32Array(16).map((_, i) => i) };
    expect(sampleBilinear(f, 0, 0)).toBe(0);
    expect(sampleBilinear(f, 4, 4)).toBe(0);
    expect(sampleBilinear(f, -1, 0)).toBe(3);
    expect(sampleBilinear(f, 0.5, 0)).toBe(0.5);
    expect(sampleBilinear(f, 3.5, 0)).toBe(1.5); // between texel 3 and wrapped texel 0
  });

  it('warp with zero amount is the identity; warped fields still tile', () => {
    const src = fbm(32, { freq: 3, octaves: 3, seed: 1 });
    const wx = fbm(32, { freq: 2, octaves: 2, seed: 2 });
    const wy = fbm(32, { freq: 2, octaves: 2, seed: 3 });
    const id = warp(src, wx, wy, 0);
    for (let i = 0; i < src.data.length; i++) expect(id.data[i]).toBeCloseTo(src.data[i], 6);
    const w = warp(src, wx, wy, 5);
    expect(seamRatio(w.data, 32)).toBeLessThanOrEqual(1.6);
  });

  it('blur preserves the mean and reduces variance', () => {
    const src = { size: 32, data: new Float32Array(32 * 32).map((_, i) => hash2(i % 32, (i / 32) | 0, 7)) };
    const b = blur(src, 2, 2);
    const mean = (a: Float32Array): number => a.reduce((s, v) => s + v, 0) / a.length;
    const variance = (a: Float32Array): number => { const m = mean(a); return a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length; };
    expect(mean(b.data)).toBeCloseTo(mean(src.data), 4);
    expect(variance(b.data)).toBeLessThan(variance(src.data) * 0.2);
  });

  it('sstep clamps and handles a degenerate edge', () => {
    expect(sstep(0, 1, -1)).toBe(0);
    expect(sstep(0, 1, 2)).toBe(1);
    expect(sstep(0, 1, 0.5)).toBe(0.5);
    expect(sstep(1, 1, 0.5)).toBe(0);
    expect(sstep(1, 1, 1.5)).toBe(1);
  });
});
