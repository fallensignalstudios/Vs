/**
 * Overlay texture families: the frozen atmosphere of Z03 (ice, rime) and the Eclipse layer (wet tissue,
 * appropriated cracked plate).
 */
import { type PbrLayers, linearRgb, newLayers } from '../bake';
import { cavity, cracks, veinFields, veins } from '../features';
import { fbm, sstep, warp, worley } from '../noise';

/**
 * `ice` — frozen atmosphere: faceted crystalline surface, white internal fracture planes, trapped cloud.
 * The mask channel stores CLOUD DENSITY (the frostIce shader parallax-samples it for internal depth and uses it
 * for opacity). Tile ≈ 2.5 m.
 */
export function ice(size: number): PbrLayers {
  const L = newLayers(size, 0.006);
  const [br, bg, bb] = linearRgb(0xbfe4f7);
  const facets = worley(size, 7, 131, 1);
  const lo = Math.min(size, 256);
  const wx = fbm(lo, { freq: 4, octaves: 3, seed: 132 });
  const wy = fbm(lo, { freq: 4, octaves: 3, seed: 133 });
  const f1 = warp(facets.f1, wx, wy, size * 0.05).data;
  const fid = warp(facets.id, wx, wy, size * 0.05).data;
  const crackA = cracks(size, 5, 134, 0.035, size * 0.03).data;
  const crackB = cracks(size, 11, 135, 0.022, size * 0.02).data;
  const cloud = fbm(size, { freq: 3, octaves: 5, gain: 0.6, seed: 136 }).data;
  const wisps = fbm(size, { freq: 5, freqY: 2, octaves: 4, gain: 0.6, seed: 137 }).data;
  const micro = fbm(size, { freq: 40, octaves: 3, gain: 0.6, seed: 138 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const crack = Math.min(1, crackA[i] * 0.9 + crackB[i] * 0.45 * sstep(0.4, 0.7, cloud[i]));
    const dens = Math.min(1, sstep(0.3, 0.8, cloud[i] * 0.65 + wisps[i] * 0.35) * 0.85 + crack * 0.6);
    const t = 0.72 + dens * 0.28;
    L.r[i] = Math.min(1, br * t + crack * 0.3);
    L.g[i] = Math.min(1, bg * t + crack * 0.22);
    L.b[i] = Math.min(1, bb * (0.9 + dens * 0.1) + crack * 0.1);
    L.height[i] = 0.35 + f1[i] * 0.45 + fid[i] * 0.2 + (micro[i] - 0.5) * 0.06 - crack * 0.25;
    L.rough[i] = 0.5 + (dens - 0.5) * 0.5 + crack * 0.4 + (micro[i] - 0.5) * 0.2;
    L.metal[i] = 1;
    L.ao[i] = 1 - crack * 0.2;
    L.mask[i] = dens;
  }
  return L;
}

/**
 * `rime` — hoar frost coating: clumped needle crystals, bright and rough, with denser drifts.
 * Mask = crystal tips (sparkle sites). Tile ≈ 1.2 m.
 */
export function rime(size: number): PbrLayers {
  const L = newLayers(size, 0.02);
  const [br, bg, bb] = linearRgb(0xe6f3fb);
  const needles = fbm(size, { freq: 20, octaves: 4, gain: 0.65, seed: 141, mode: 'ridged' }).data;
  const clump = fbm(size, { freq: 5, octaves: 4, gain: 0.55, seed: 142 }).data;
  const grain = fbm(size, { freq: 64, octaves: 2, gain: 0.7, seed: 143 }).data;
  const cells = worley(size, 26, 144, 1).f1.data;
  for (let i = 0; i < L.r.length; i++) {
    const c = sstep(0.25, 0.75, clump[i]);
    const h = needles[i] * (0.45 + c * 0.55) * (0.6 + 0.4 * (1 - Math.min(1, cells[i] * 1.3)));
    const t = 0.7 + h * 0.3 + (grain[i] - 0.5) * 0.08;
    L.r[i] = br * t; L.g[i] = bg * t; L.b[i] = bb * (0.85 + h * 0.15);
    L.height[i] = h * 0.9 + (grain[i] - 0.5) * 0.1;
    L.rough[i] = 0.5 + (0.5 - h) * 0.4 + (grain[i] - 0.5) * 0.3;
    L.metal[i] = 1;
    L.ao[i] = 0.55 + h * 0.45;
    L.mask[i] = sstep(0.72, 0.9, h + (grain[i] - 0.5) * 0.3);
  }
  return L;
}

/**
 * `tissue` — Eclipse growth: dark, wet, lumpy tissue pulled into sinew ridges, threaded with a branching vein
 * network. Mask = veins (the material makes them pulse violet under the surface). Tile ≈ 1.6 m.
 */
export function tissue(size: number): PbrLayers {
  const L = newLayers(size, 0.02);
  const [dr, dg, db] = linearRgb(0x16091c);
  const [hr, hg, hb] = linearRgb(0x4a1f3f);
  const lumps = fbm(size, { freq: 5, octaves: 4, gain: 0.5, seed: 151, mode: 'billow' }).data;
  const sinew = fbm(size, { freq: 4, freqY: 9, octaves: 4, gain: 0.55, seed: 152, mode: 'ridged' });
  const lo = Math.min(size, 256);
  const wx = fbm(lo, { freq: 3, octaves: 3, seed: 153 });
  const wy = fbm(lo, { freq: 3, octaves: 3, seed: 154 });
  const sw = warp(sinew, wx, wy, size * 0.12).data;
  const vf = veinFields(size, 155);
  const vA = veins(size, { freq: 4, seed: 155, warp: 0.18, width: 0.008, breakup: 0.35 }, vf).data;
  const vB = veins(size, { freq: 9, seed: 156, warp: 0.08, width: 0.0045, breakup: 0.6 }, vf).data;
  const pore = fbm(size, { freq: 48, octaves: 2, gain: 0.6, seed: 157 }).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = lumps[i] * 0.55 + sw[i] * 0.4 + (pore[i] - 0.5) * 0.06;
  const cav = cavity({ size, data: h }, size / 40, 3.2).data;
  for (let i = 0; i < h.length; i++) {
    const vein = Math.min(1, vA[i] + vB[i] * 0.6);
    const k = Math.min(1, h[i] * 0.9 + vein * 0.25);
    const shade = 0.55 + cav[i] * 0.45;
    L.r[i] = (dr + (hr - dr) * k) * shade + vein * 0.035;
    L.g[i] = (dg + (hg - dg) * k) * shade;
    L.b[i] = (db + (hb - db) * k) * shade + vein * 0.06;
    L.height[i] = h[i] + vein * 0.1;
    L.rough[i] = 0.5 + (cav[i] - 0.5) * 0.5 + (pore[i] - 0.5) * 0.25 - vein * 0.2;
    L.metal[i] = 1;
    L.ao[i] = cav[i];
    L.mask[i] = vein;
  }
  return L;
}

/**
 * `plate` — appropriated armour and remains: pale ceramic-bone shards, each sitting at a slightly different
 * level, split by a deep crack network with dark staining bleeding out of it. Mask = cracks (violet light in
 * the material). Tile ≈ 1.4 m.
 */
export function plate(size: number): PbrLayers {
  const L = newLayers(size, 0.014);
  const [br, bg, bb] = linearRgb(0xb9b2a4);
  const [sr, sg, sb] = linearRgb(0x1d1024);
  const shards = worley(size, 6, 161, 1);
  const lo = Math.min(size, 256);
  const wx = fbm(lo, { freq: 6, octaves: 3, seed: 162 });
  const wy = fbm(lo, { freq: 6, octaves: 3, seed: 163 });
  const big = new Float32Array(size * size);
  for (let i = 0; i < big.length; i++) big[i] = 1 - sstep(0, 0.07, shards.f2.data[i] - shards.f1.data[i]);
  const crackBig = warp({ size, data: big }, wx, wy, size * 0.035).data;
  const sid = warp(shards.id, wx, wy, size * 0.035).data;
  const crackFine = cracks(size, 15, 164, 0.03, size * 0.015).data;
  const gate = fbm(size, { freq: 4, octaves: 4, seed: 165 }).data;
  const stain = fbm(size, { freq: 7, octaves: 5, gain: 0.6, seed: 166 }).data;
  const fine = fbm(size, { freq: 34, octaves: 3, gain: 0.6, seed: 167 }).data;
  const spread = new Float32Array(size * size);
  const crack = new Float32Array(size * size);
  for (let i = 0; i < crack.length; i++) crack[i] = Math.min(1, crackBig[i] + crackFine[i] * sstep(0.45, 0.65, gate[i]) * 0.8);
  // staining = cracks dilated by the bevel of the distance-ish field (cheap: reuse the soft crack shoulders)
  for (let i = 0; i < spread.length; i++) {
    const near = 1 - sstep(0, 0.3, shards.f2.data[i] - shards.f1.data[i]);
    spread[i] = Math.min(1, near * (0.35 + stain[i] * 0.9));
  }
  for (let i = 0; i < crack.length; i++) {
    const c = crack[i];
    const st = Math.min(1, spread[i] * 0.75 + c);
    const t = (0.78 + sid[i] * 0.3) * (1 + (fine[i] - 0.5) * 0.14);
    L.r[i] = (br * t) * (1 - st) + sr * st;
    L.g[i] = (bg * t) * (1 - st) + sg * st;
    L.b[i] = (bb * t) * (1 - st) + sb * st;
    L.height[i] = 0.45 + sid[i] * 0.3 + (fine[i] - 0.5) * 0.06 - c * 0.45;
    L.rough[i] = 0.5 + (sid[i] - 0.5) * 0.4 + st * 0.3 + (fine[i] - 0.5) * 0.2;
    L.metal[i] = 1 - st * 0.8;
    L.ao[i] = 1 - c * 0.7 - spread[i] * 0.15;
    L.mask[i] = c;
  }
  return L;
}
