/**
 * Small textures shared by every triplanar material:
 *
 *   macro   — four independent low-frequency fields, sampled at tens of metres per repeat to break up tiling
 *             (R, G brightness/roughness drift · B warm↔cool hue drift · A vertical streaks for drips)
 *   detail  — micro surface sampled at centimetres per repeat for close-ups
 *             (RG tangent normal · B roughness grain · A albedo speckle)
 *   veins   — the Eclipse corruption overlay
 *             (R vein network · G growth order: low values corrupt first · B tissue mottling · A pulse phase)
 */
import { normalsFromHeight, pits, scratches, veinFields, veins } from './features';
import { blur, fbm } from './noise';

const to8 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

export function bakeMacro(size: number): Uint8Array {
  const r = fbm(size, { freq: 3, octaves: 5, gain: 0.55, seed: 301 }).data;
  const g = fbm(size, { freq: 4, octaves: 5, gain: 0.55, seed: 302 }).data;
  const b = fbm(size, { freq: 2, octaves: 4, gain: 0.5, seed: 303 }).data;
  const a = fbm(size, { freq: 14, freqY: 2, octaves: 4, gain: 0.6, seed: 304 }).data;
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < r.length; i++) {
    const o = i * 4;
    out[o] = to8(r[i]); out[o + 1] = to8(g[i]); out[o + 2] = to8(b[i]); out[o + 3] = to8(a[i]);
  }
  return out;
}

export function bakeDetail(size: number): Uint8Array {
  const grain = fbm(size, { freq: 20, octaves: 4, gain: 0.65, seed: 311 }).data;
  const rough = fbm(size, { freq: 12, octaves: 5, gain: 0.7, seed: 312 }).data;
  const speck = fbm(size, { freq: 32, octaves: 3, gain: 0.7, seed: 313 }).data;
  const pit = pits(size, 30, 314, 0.35, 0.2).data;
  const scr = scratches(size, { count: Math.round(size * 0.3), minLen: size * 0.05, maxLen: size * 0.4, seed: 315 }).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = grain[i] * 0.6 - pit[i] * 0.5 - scr[i] * 0.35;
  const n = normalsFromHeight({ size, data: h }, 0.01);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < h.length; i++) {
    const o = i * 4, p = i * 3;
    out[o] = to8(n[p] * 0.5 + 0.5);
    out[o + 1] = to8(n[p + 1] * 0.5 + 0.5);
    out[o + 2] = to8(0.5 + (rough[i] - 0.5) * 0.8 + scr[i] * 0.35 + pit[i] * 0.2);
    out[o + 3] = to8(0.5 + (speck[i] - 0.5) * 0.9 - pit[i] * 0.3);
  }
  return out;
}

export function bakeVeins(size: number): Uint8Array {
  const vf = veinFields(size, 321);
  const vA = veins(size, { freq: 3, seed: 321, warp: 0.2, width: 0.01, breakup: 0.25 }, vf).data;
  const vB = veins(size, { freq: 7, seed: 322, warp: 0.1, width: 0.006, breakup: 0.5 }, vf).data;
  const vC = veins(size, { freq: 13, seed: 323, warp: 0.06, width: 0.004, breakup: 0.75 }, vf).data;
  const order = fbm(size, { freq: 3, octaves: 4, gain: 0.5, seed: 324 }).data;
  const mottle = fbm(size, { freq: 9, octaves: 4, gain: 0.6, seed: 325, mode: 'billow' }).data;
  const phase = fbm(size, { freq: 2, octaves: 3, seed: 326 }).data;
  const net = new Float32Array(size * size);
  for (let i = 0; i < net.length; i++) net[i] = Math.min(1, vA[i] + vB[i] * 0.7 + vC[i] * 0.4);
  // veins lead the growth front: texels near a vein corrupt earlier than the open surface between them
  const near = blur({ size, data: net }, size / 40, 2).data;
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < net.length; i++) {
    const o = i * 4;
    out[o] = to8(net[i]);
    out[o + 1] = to8(order[i] * 0.72 + (1 - Math.min(1, near[i] * 2.4)) * 0.28 - net[i] * 0.12);
    out[o + 2] = to8(mottle[i]);
    out[o + 3] = to8(phase[i]);
  }
  return out;
}
