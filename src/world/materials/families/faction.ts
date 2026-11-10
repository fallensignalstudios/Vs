/**
 * Faction equipment texture families. Dominion: hammered bronze, lacquer, heavy twill.
 * Reformation: coated modular panels, sterile brushed steel, technical ripstop.
 * Neutral-albedo families (`lacquer`, `coated`, `brushed`, cloths) are tinted by the material colour so several
 * MatIds can share one set of maps.
 */
import { type PbrLayers, linearRgb, newLayers } from '../bake';
import { brushed as brushedStreaks, cavity, edgeWear, hammered, pits, plates, scratches, weave } from '../features';
import { fbm, sstep } from '../noise';

/**
 * `bronze` — Dominion plate: hand-hammered dimples, dark patina pooled between them and along the plate seams,
 * bright warm metal on the high spots. Tile ≈ 1.6 m.
 */
export function bronze(size: number): PbrLayers {
  const L = newLayers(size, 0.006);
  const [br, bg, bb] = linearRgb(0xa06a36);
  const [pr, pg, pb] = linearRgb(0x21140d);
  const dimple = hammered(size, 64, 61).data;
  const pl = plates(size, { cols: 2, rows: 2, seam: size / 480, bevel: size / 130, seed: 62, split: 0.45 });
  const blot = fbm(size, { freq: 5, octaves: 5, gain: 0.6, seed: 63 }).data;
  const fine = fbm(size, { freq: 32, octaves: 3, gain: 0.6, seed: 64 }).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = pl.height.data[i] * 0.6 + dimple[i] * 0.14 + (fine[i] - 0.5) * 0.05;
  const cav = cavity({ size, data: h }, size / 90, 5).data;
  for (let i = 0; i < h.length; i++) {
    const seam = 1 - pl.height.data[i];
    const low = 1 - dimple[i];
    const pat = Math.min(1, low * low * 0.22 + seam * 0.9 + sstep(0.45, 0.8, blot[i]) * 0.5 + (1 - cav[i]) * 0.7);
    const k = pat * 0.8;
    const t = (1 + (fine[i] - 0.5) * 0.14) * (0.94 + pl.id.data[i] * 0.12);
    L.r[i] = (br + (pr - br) * k) * t;
    L.g[i] = (bg + (pg - bg) * k) * t;
    L.b[i] = (bb + (pb - bb) * k) * t;
    L.height[i] = h[i];
    L.rough[i] = 0.4 + pat * 0.5 + (fine[i] - 0.5) * 0.2 + (pl.id.data[i] - 0.5) * 0.1;
    L.metal[i] = 1 - pat * 0.5;
    L.ao[i] = Math.min(1, cav[i] + 0.15) * (1 - seam * 0.5);
    L.mask[i] = pat;
  }
  return L;
}

/**
 * `lacquer` — thick ceremonial lacquer (tinted oxblood by the material): glassy with a faint orange-peel, dust
 * nibs, broad polishing smudges; the mask marks chips where the coat has broken through to the metal. Tile ≈ 1.2 m.
 */
export function lacquer(size: number): PbrLayers {
  const L = newLayers(size, 0.0016);
  const peel = fbm(size, { freq: 36, octaves: 3, gain: 0.5, seed: 71 }).data;
  const smudge = fbm(size, { freq: 4, octaves: 5, gain: 0.6, seed: 72 }).data;
  const depth = fbm(size, { freq: 3, octaves: 4, seed: 73 }).data;
  const chipA = fbm(size, { freq: 26, octaves: 4, gain: 0.65, seed: 74 }).data;
  const chipB = fbm(size, { freq: 4, octaves: 3, seed: 75 }).data;
  const nib = pits(size, 40, 76, 0.08, 0.14).data;
  const scr = scratches(size, { count: Math.round(size * 0.12), minLen: size * 0.02, maxLen: size * 0.14, seed: 77 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const chip = sstep(0.76, 0.82, chipA[i]) * sstep(0.74, 0.82, chipB[i]);
    const t = 0.82 + (depth[i] - 0.5) * 0.36 - chip * 0.2;
    L.r[i] = t; L.g[i] = t * (0.92 + (depth[i] - 0.5) * 0.2); L.b[i] = t * (0.92 + (depth[i] - 0.5) * 0.2);
    L.height[i] = 0.5 + (peel[i] - 0.5) * 0.3 + nib[i] * 0.35 - chip * 0.45 - scr[i] * 0.15;
    L.rough[i] = 0.5 + (smudge[i] - 0.5) * 0.55 + chip * 0.6 + scr[i] * 0.4;
    L.ao[i] = 1 - chip * 0.25;
    L.mask[i] = chip;
  }
  return L;
}

/**
 * `coated` — Reformation modular panelling (also Dominion black iron): matte powder-coat grain over bevelled
 * plates with visible seams; pale dust in the grooves; the mask marks edges rubbed through to bare metal.
 * Tile ≈ 1.6 m.
 */
export function coated(size: number): PbrLayers {
  const L = newLayers(size, 0.005);
  const pl = plates(size, { cols: 2, rows: 2, seam: size / 420, bevel: size / 200, seed: 81, split: 0.35 });
  const grain = fbm(size, { freq: 96, octaves: 2, gain: 0.6, seed: 82 }).data;
  const tone = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 83 }).data;
  const smudge = fbm(size, { freq: 6, octaves: 4, gain: 0.6, seed: 84 }).data;
  const breakup = fbm(size, { freq: 14, octaves: 4, gain: 0.65, seed: 85 });
  const wear = edgeWear(pl.height, size / 140, breakup, 0.3).data;
  const scr = scratches(size, { count: Math.round(size * 0.04), minLen: size * 0.02, maxLen: size * 0.1, seed: 86 }).data;
  const streak = fbm(size, { freq: 30, freqY: 2, octaves: 3, gain: 0.6, seed: 87 }).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = pl.height.data[i] * 0.7 + (grain[i] - 0.5) * 0.1 - wear[i] * 0.05;
  const cav = cavity({ size, data: h }, size / 120, 4).data;
  for (let i = 0; i < h.length; i++) {
    const seam = 1 - pl.height.data[i];
    const dust = (1 - cav[i]) * 0.4 * smudge[i];
    // grime gradient: streaks that start under each plate's top seam and thin out as they run down
    const v = pl.v01.data[i];
    const grime = v * v * v * sstep(0.4, 0.85, streak[i]) * 0.55;
    const t = (0.84 + (tone[i] - 0.5) * 0.2 + (pl.id.data[i] - 0.5) * 0.1) * (1 - seam * 0.7) * (1 - grime * 0.4) + dust * 0.08 - scr[i] * 0.06;
    L.r[i] = t; L.g[i] = t; L.b[i] = t;
    L.height[i] = h[i] - scr[i] * 0.05;
    L.rough[i] = 0.5 + (smudge[i] - 0.5) * 0.4 + (grain[i] - 0.5) * 0.2 + dust * 0.3 + grime * 0.35 - wear[i] * 0.2 + scr[i] * 0.2;
    L.metal[i] = 1;
    L.ao[i] = Math.min(1, cav[i] + 0.2) * (1 - seam * 0.55);
    L.mask[i] = Math.min(1, wear[i] * (1 - seam) + scr[i] * 0.12);
  }
  return L;
}

/**
 * `brushed` — sterile brushed steel: long horizontal streaks in both roughness and normal (reads as anisotropy),
 * a few polishing arcs and scratches, panel breaks. Tile ≈ 1.2 m.
 */
export function brushed(size: number): PbrLayers {
  const L = newLayers(size, 0.0016);
  const streak = brushedStreaks(size, 91, size / 2, 3).data;
  const streak2 = brushedStreaks(size, 92, size / 6, 2).data;
  const smudge = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 93 }).data;
  const pl = plates(size, { cols: 1, rows: 2, seam: size / 420, bevel: size / 220, seed: 94, split: 0.5 });
  const scr = scratches(size, { count: Math.round(size * 0.1), minLen: size * 0.04, maxLen: size * 0.3, seed: 95, angle: 0, spread: 0.5 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const s = (streak[i] - 0.5) * 0.7 + (streak2[i] - 0.5) * 0.5;
    const seam = 1 - pl.height.data[i];
    const t = (0.9 + s * 0.1 + (smudge[i] - 0.5) * 0.06) * (1 - seam * 0.5);
    L.r[i] = t; L.g[i] = t; L.b[i] = t * 1.01;
    L.height[i] = 0.5 + s * 0.22 + pl.height.data[i] * 0.4 - scr[i] * 0.2;
    L.rough[i] = 0.5 + s * 0.75 + (smudge[i] - 0.5) * 0.35 + scr[i] * 0.35;
    L.ao[i] = 1 - seam * 0.6;
    L.mask[i] = scr[i];
  }
  return L;
}

function cloth(size: number, kind: 'twill' | 'ripstop', threads: number, seed: number): PbrLayers {
  const L = newLayers(size, kind === 'twill' ? 0.03 : 0.018);
  const w = weave(size, threads, kind);
  const fuzz = fbm(size, { freq: size / 4, octaves: 2, gain: 0.7, seed }).data;
  const thread = fbm(size, { freq: 3, freqY: threads * 2, octaves: 2, gain: 0.5, seed: seed + 1 }).data;
  const fade = fbm(size, { freq: 3, octaves: 4, gain: 0.55, seed: seed + 2 }).data;
  const cav = cavity(w, Math.max(1, size / threads / 3), 2.2).data;
  for (let i = 0; i < L.r.length; i++) {
    const h = w.data[i];
    const t = (0.62 + h * 0.3 + (thread[i] - 0.5) * 0.14 + (fuzz[i] - 0.5) * 0.1) * (0.9 + (fade[i] - 0.5) * 0.25);
    L.r[i] = t; L.g[i] = t; L.b[i] = t;
    L.height[i] = h * 0.85 + (fuzz[i] - 0.5) * 0.15;
    L.rough[i] = 0.5 + (0.5 - h) * 0.3 + (fuzz[i] - 0.5) * 0.3 + (fade[i] - 0.5) * 0.2;
    L.metal[i] = 1;
    L.ao[i] = Math.min(1, cav[i] * 0.75 + 0.25 + h * 0.2);
    L.mask[i] = sstep(0.55, 0.8, fade[i]);
  }
  return L;
}

/** `clothTwill` — heavy diagonal-rib ceremonial cloth (Dominion capes, banners, tarps). Tile ≈ 0.18 m. */
export const clothTwill = (size: number): PbrLayers => cloth(size, 'twill', Math.max(8, size / 16), 101);

/** `clothTech` — fine technical ripstop with a reinforcement grid (Reformation). Tile ≈ 0.16 m. */
export const clothTech = (size: number): PbrLayers => cloth(size, 'ripstop', Math.max(8, size / 8), 111);
