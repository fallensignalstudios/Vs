/**
 * Miscellaneous texture families: dark wood, aged leather, rubble, rubber, skin, hair.
 * `rubber`, `skin` and `hair` are neutral and tinted by the material colour.
 */
import { type PbrLayers, linearRgb, newLayers } from '../bake';
import { cavity, cracks, pits, scratches } from '../features';
import { blur, fbm, sstep, warp, worley } from '../noise';

/** `wood` — dark oiled hardwood: long grain along +u with slow figure, open pores, hand-polished. Tile ≈ 1.2 m. */
export function wood(size: number): PbrLayers {
  const L = newLayers(size, 0.0022);
  const [lr, lg, lb] = linearRgb(0x2e1c12);
  const [dr, dg, db] = linearRgb(0x120a06);
  const grainBase = fbm(size, { freq: 2, freqY: 40, octaves: 4, gain: 0.6, seed: 171 });
  const lo = Math.min(size, 256);
  const wx = fbm(lo, { freq: 2, octaves: 3, seed: 172 });
  const wy = fbm(lo, { freq: 3, octaves: 3, seed: 173 });
  const grain = warp(grainBase, wx, wy, size * 0.06).data;
  const figure = fbm(size, { freq: 2, freqY: 5, octaves: 3, seed: 174 }).data;
  const pore = scratches(size, { count: Math.round(size * 5), minLen: size * 0.004, maxLen: size * 0.02, seed: 175, angle: 0, spread: 0.05, curl: 0 }).data;
  const polish = fbm(size, { freq: 4, octaves: 4, seed: 176 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const g = sstep(0.2, 0.85, grain[i] * 0.7 + figure[i] * 0.3);
    const k = Math.min(1, g * 0.8 + pore[i] * 0.35);
    L.r[i] = lr + (dr - lr) * k;
    L.g[i] = lg + (dg - lg) * k;
    L.b[i] = lb + (db - lb) * k;
    L.height[i] = 0.6 - g * 0.2 - pore[i] * 0.2;
    L.rough[i] = 0.5 + (polish[i] - 0.5) * 0.5 + pore[i] * 0.4 + (g - 0.5) * 0.2;
    L.metal[i] = 1;
    L.ao[i] = 1 - pore[i] * 0.25;
    L.mask[i] = sstep(0.5, 0.8, polish[i]);
  }
  return L;
}

/**
 * `leather` — age-polished hide: pebbled cells divided by creases, deep oxblood-brown, lighter and glossier where
 * hands and backs have rubbed it for decades. Tile ≈ 0.3 m.
 */
export function leather(size: number): PbrLayers {
  const L = newLayers(size, 0.007);
  const [br, bg, bb] = linearRgb(0x3b1c14);
  const [dr, dg, db] = linearRgb(0x140907);
  const cells = worley(size, 46, 181, 0.95);
  const crease = cracks(size, 4, 182, 0.03, size * 0.06).data;
  const polish = fbm(size, { freq: 3, octaves: 4, gain: 0.55, seed: 183 }).data;
  const fine = fbm(size, { freq: 48, octaves: 2, gain: 0.6, seed: 184 }).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    const border = sstep(0, 0.3, cells.f2.data[i] - cells.f1.data[i]);
    h[i] = border * (0.75 + cells.id.data[i] * 0.25) - crease[i] * 0.25 + (fine[i] - 0.5) * 0.08;
  }
  const cav = cavity({ size, data: h }, Math.max(1, size / 100), 2.5).data;
  for (let i = 0; i < h.length; i++) {
    const worn = sstep(0.45, 0.8, polish[i]);
    const k = Math.min(1, (1 - cav[i]) * 0.45 + crease[i] * 0.25 + (1 - worn) * 0.1);
    const t = 1 + (fine[i] - 0.5) * 0.1 + worn * 0.12;
    L.r[i] = (br + (dr - br) * k) * t;
    L.g[i] = (bg + (dg - bg) * k) * t;
    L.b[i] = (bb + (db - bb) * k) * t;
    L.height[i] = 0.4 + h[i] * 0.6;
    L.rough[i] = 0.55 - worn * 0.3 + (1 - cav[i]) * 0.4 + (fine[i] - 0.5) * 0.15;
    L.metal[i] = 1;
    L.ao[i] = Math.min(1, cav[i] + 0.1) * (1 - crease[i] * 0.4);
    L.mask[i] = worn;
  }
  return L;
}

/**
 * `rubble` — broken King-era ceramic and stone: a rough fracture surface of angular facets (each shard a tilted
 * plane), conchoidal ridges, grit and dust, cut by a few real cracks. Mask = the cracks (the `scorched` material
 * lets embers show in them). Tile ≈ 2 m.
 */
export function rubble(size: number): PbrLayers {
  const L = newLayers(size, 0.022);
  const [br, bg, bb] = linearRgb(0xa8a295);
  const big = worley(size, 6, 191, 1, true);
  const small = worley(size, 15, 192, 1, true);
  const ridge = fbm(size, { freq: 6, octaves: 4, gain: 0.55, seed: 195, mode: 'ridged' }).data;
  const grit = fbm(size, { freq: 36, octaves: 3, gain: 0.65, seed: 193 }).data;
  const tone = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 194 }).data;
  const crack = cracks(size, 4, 196, 0.035, size * 0.05).data;
  const frac = (v: number): number => v - Math.floor(v);
  const facet = (w: typeof big, i: number): number => {
    const id = w.id.data[i];
    // a tilted plane through the shard's seed point: level from the id, slope from two more hashes of it
    return id * 0.6 + ((w.dx as { data: Float32Array }).data[i] * (frac(id * 17.3) - 0.5) + (w.dy as { data: Float32Array }).data[i] * (frac(id * 41.7) - 0.5)) * 1.4;
  };
  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i++) raw[i] = facet(big, i) * 0.4 + facet(small, i) * 0.2 + ridge[i] * 0.25;
  // one texel of blur keeps the facet steps from aliasing into dotted lines
  const h = blur({ size, data: raw }, 1, 1).data;
  for (let i = 0; i < h.length; i++) h[i] += (grit[i] - 0.5) * 0.07 - crack[i] * 0.2;
  const cav = cavity({ size, data: h }, size / 40, 2.4).data;
  for (let i = 0; i < h.length; i++) {
    const dust = (1 - cav[i]) * 0.5;
    const t = (0.72 + small.id.data[i] * 0.2 + (tone[i] - 0.5) * 0.3 + (grit[i] - 0.5) * 0.2) * (0.62 + cav[i] * 0.38) * (1 - crack[i] * 0.55);
    L.r[i] = br * t; L.g[i] = bg * t; L.b[i] = bb * t * 0.97;
    L.height[i] = h[i];
    L.rough[i] = 0.5 + (grit[i] - 0.5) * 0.4 + dust * 0.3 + (small.id.data[i] - 0.5) * 0.25;
    L.metal[i] = 1;
    L.ao[i] = Math.min(1, cav[i] * 0.8 + 0.2) * (1 - crack[i] * 0.5);
    L.mask[i] = crack[i];
  }
  return L;
}

/** `rubber` — moulded matte rubber: fine parallel ribbing, mould grain, a little chalky bloom. Tile ≈ 0.3 m. */
export function rubber(size: number): PbrLayers {
  const L = newLayers(size, 0.02);
  const grain = fbm(size, { freq: 40, octaves: 3, gain: 0.65, seed: 201 }).data;
  const bloom = fbm(size, { freq: 4, octaves: 4, seed: 202 }).data;
  const ribs = 24;
  for (let y = 0; y < size; y++) {
    const rib = 0.5 + 0.5 * Math.sin((y / size) * ribs * Math.PI * 2);
    const r = rib * rib;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = 0.75 + r * 0.2 + (grain[i] - 0.5) * 0.12 + sstep(0.55, 0.85, bloom[i]) * 0.25;
      L.r[i] = t; L.g[i] = t; L.b[i] = t;
      L.height[i] = 0.3 + r * 0.55 + (grain[i] - 0.5) * 0.15;
      L.rough[i] = 0.5 + (grain[i] - 0.5) * 0.35 + (bloom[i] - 0.5) * 0.3 - r * 0.1;
      L.ao[i] = 0.7 + r * 0.3;
      L.mask[i] = sstep(0.55, 0.85, bloom[i]);
    }
  }
  return L;
}

/** `skin` — neutral skin detail: pores, fine crease lines, faint blotchy tone variation. Tile ≈ 0.25 m. */
export function skin(size: number): PbrLayers {
  const L = newLayers(size, 0.01);
  const pore = pits(size, 46, 211, 0.75, 0.3).data;
  const crease = cracks(size, 20, 212, 0.05, size * 0.02).data;
  const blotch = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 213 }).data;
  const fine = fbm(size, { freq: 40, octaves: 2, gain: 0.6, seed: 214 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const b = blotch[i] - 0.5;
    const t = 0.92 + b * 0.1 - pore[i] * 0.08 - crease[i] * 0.06;
    L.r[i] = Math.min(1, t * (1 + b * 0.06)); L.g[i] = t * (1 - b * 0.05); L.b[i] = t * (1 - b * 0.08);
    L.height[i] = 0.6 - pore[i] * 0.3 - crease[i] * 0.25 + (fine[i] - 0.5) * 0.08;
    L.rough[i] = 0.5 + (fine[i] - 0.5) * 0.3 + b * 0.25 + pore[i] * 0.2;
    L.ao[i] = 1 - pore[i] * 0.2 - crease[i] * 0.15;
    L.mask[i] = sstep(0.55, 0.8, blotch[i]);
  }
  return L;
}

/** `hair` — neutral strand detail running along +v (hair falls down the v axis). Tile ≈ 0.12 m. */
export function hair(size: number): PbrLayers {
  const L = newLayers(size, 0.03);
  const strand = fbm(size, { freq: size / 4, freqY: 2, octaves: 2, gain: 0.6, seed: 221 }).data;
  const lock = fbm(size, { freq: 10, freqY: 2, octaves: 3, gain: 0.55, seed: 222 }).data;
  const band = fbm(size, { freq: 3, freqY: 6, octaves: 3, seed: 223 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const s = strand[i], k = lock[i];
    const t = 0.55 + s * 0.3 + k * 0.25;
    L.r[i] = t; L.g[i] = t; L.b[i] = t;
    L.height[i] = k * 0.6 + s * 0.4;
    L.rough[i] = 0.5 + (0.5 - s) * 0.3 + (band[i] - 0.5) * 0.5;
    L.ao[i] = 0.6 + k * 0.4;
    L.mask[i] = sstep(0.6, 0.85, band[i]);
  }
  return L;
}
