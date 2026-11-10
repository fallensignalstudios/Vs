/**
 * King-era substrate texture families: warm ivory ceramic-metal (upper terminal), worn ceramic floor,
 * mirror-polished black stone (lower terminal), polished and aged gold.
 * Each generator returns linear PBR layers for one seamless tile.
 */
import { type PbrLayers, linearRgb, newLayers } from '../bake';
import { hammered, pits, scratches, veinFields, veins } from '../features';
import { fbm, sstep } from '../noise';

/**
 * `ceramic` — the white-gold of ribs, spans and walls. A cast ceramic-metal: soft cloudy mottling, the faintest
 * mineral veining, sparse micro pitting, and a polish that varies in broad smudges (the roughness variation is
 * what stops it reading as plastic). Tile ≈ 4 m.
 */
export function ceramic(size: number): PbrLayers {
  const L = newLayers(size, 0.0018);
  const [br, bg, bb] = linearRgb(0xdcd5c3);
  const cloud = fbm(size, { freq: 3, octaves: 5, gain: 0.55, seed: 11 }).data;
  const drift = fbm(size, { freq: 2, octaves: 3, seed: 12 }).data;
  const fine = fbm(size, { freq: 28, octaves: 4, gain: 0.6, seed: 13 }).data;
  const smudge = fbm(size, { freq: 5, octaves: 4, gain: 0.6, seed: 14 }).data;
  const vf = veinFields(size, 15);
  const v1 = veins(size, { freq: 3, seed: 15, warp: 0.16, width: 0.006, breakup: 0.8 }, vf).data;
  const v2 = veins(size, { freq: 5, seed: 16, warp: 0.09, width: 0.0018, breakup: 0.9 }, vf).data;
  const pit = pits(size, 56, 17, 0.1, 0.22).data;
  const wear = fbm(size, { freq: 9, octaves: 5, gain: 0.62, seed: 18 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const c = cloud[i] - 0.5, f = fine[i] - 0.5, d = drift[i] - 0.5;
    const vein = Math.min(1, v1[i] * 0.3 + v2[i] * 0.55);
    const lum = 1 + c * 0.11 + f * 0.05 - pit[i] * 0.25;
    // veins pull toward a warm grey-beige; drift shifts the tile between cooler ivory and warmer cream
    L.r[i] = (br * (1 + d * 0.035)) * lum * (1 - vein * 0.34);
    L.g[i] = bg * lum * (1 - vein * 0.37);
    L.b[i] = (bb * (1 - d * 0.07)) * lum * (1 - vein * 0.42);
    L.height[i] = 0.5 + c * 0.22 + f * 0.07 - v2[i] * 0.16 - pit[i] * 0.4;
    L.rough[i] = 0.5 + (smudge[i] - 0.5) * 0.62 + f * 0.2 - v1[i] * 0.14 + pit[i] * 0.35;
    L.metal[i] = 1 - pit[i] * 0.7 - vein * 0.25;
    L.ao[i] = 1 - pit[i] * 0.45 - v2[i] * 0.08;
    L.mask[i] = sstep(0.42, 0.68, wear[i]) * (0.65 + 0.7 * (fine[i] - 0.15));
  }
  return L;
}

/**
 * `ceramicFloor` — walkable upper floor: the same ceramic, greyer and more marbled, traffic-polished in lanes,
 * with hairline scratches, scuffs and dust settled in the pits. Tile ≈ 4 m.
 */
export function ceramicFloor(size: number): PbrLayers {
  const L = newLayers(size, 0.0022);
  const [br, bg, bb] = linearRgb(0xcfcabd);
  const cloud = fbm(size, { freq: 3, octaves: 5, gain: 0.58, seed: 21 }).data;
  const fine = fbm(size, { freq: 30, octaves: 4, gain: 0.6, seed: 22 }).data;
  const polish = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 23 }).data;
  const scuff = fbm(size, { freq: 6, freqY: 26, octaves: 3, gain: 0.6, seed: 24 }).data;
  const vf = veinFields(size, 25);
  const v1 = veins(size, { freq: 3, seed: 25, warp: 0.18, width: 0.008, breakup: 0.7 }, vf).data;
  const v2 = veins(size, { freq: 6, seed: 26, warp: 0.1, width: 0.0025, breakup: 0.85 }, vf).data;
  const v3 = veins(size, { freq: 4, seed: 27, warp: 0.22, width: 0.0016, breakup: 0.9 }, vf).data;
  const pit = pits(size, 64, 28, 0.16, 0.24).data;
  const scr = scratches(size, { count: Math.round(size * 0.22), minLen: size * 0.02, maxLen: size * 0.22, seed: 29 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const c = cloud[i] - 0.5, f = fine[i] - 0.5;
    const vein = Math.min(1, v1[i] * 0.42 + v2[i] * 0.6 + v3[i] * 0.75);
    const lum = 1 + c * 0.16 + f * 0.06 - pit[i] * 0.3 - scr[i] * 0.05;
    L.r[i] = br * lum * (1 - vein * 0.5);
    L.g[i] = bg * lum * (1 - vein * 0.5);
    L.b[i] = bb * lum * (1 - vein * 0.47);
    L.height[i] = 0.5 + c * 0.18 + f * 0.06 - v2[i] * 0.12 - v3[i] * 0.2 - pit[i] * 0.4 - scr[i] * 0.22;
    L.rough[i] = 0.5 + (polish[i] - 0.5) * 0.7 + (scuff[i] - 0.5) * 0.3 + f * 0.16 + scr[i] * 0.5 + pit[i] * 0.4 - v1[i] * 0.1;
    L.metal[i] = 1 - pit[i] * 0.8 - vein * 0.3;
    L.ao[i] = 1 - pit[i] * 0.5 - v3[i] * 0.12;
    L.mask[i] = sstep(0.45, 0.7, polish[i]) * (0.6 + 0.8 * fine[i] * 0.5);
  }
  return L;
}

/**
 * `blackStone` — near-black polished stone: almost no diffuse, so everything is in the specular response.
 * Faint smoky clouding, thin pale veins that break up along their length, a polish that hazes very slightly in
 * broad patches, hairline scratches, and a gentle sub-millimetre undulation so mirror reflections wobble like
 * real honed stone instead of looking like a perfect CG plane. Tile ≈ 5 m.
 */
export function blackStone(size: number): PbrLayers {
  const L = newLayers(size, 0.0011);
  const [br, bg, bb] = linearRgb(0x0c0d11);
  const cloud = fbm(size, { freq: 3, octaves: 5, gain: 0.6, seed: 31 }).data;
  const fine = fbm(size, { freq: 26, octaves: 4, gain: 0.6, seed: 32 }).data;
  const haze = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 33 }).data;
  const wob = fbm(size, { freq: 7, octaves: 3, gain: 0.5, seed: 34 }).data;
  const vf = veinFields(size, 35);
  const v1 = veins(size, { freq: 3, seed: 35, warp: 0.22, width: 0.0022, breakup: 0.92 }, vf).data;
  const v2 = veins(size, { freq: 5, seed: 36, warp: 0.12, width: 0.0012, breakup: 0.95 }, vf).data;
  const smoke = veins(size, { freq: 2, seed: 37, warp: 0.26, width: 0.03, breakup: 0.6 }, vf).data;
  const fleck = pits(size, 90, 38, 0.05, 0.16).data;
  const scr = scratches(size, { count: Math.round(size * 0.1), minLen: size * 0.03, maxLen: size * 0.3, seed: 39 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const c = cloud[i], f = fine[i] - 0.5;
    const vein = Math.min(1, v1[i] * 0.85 + v2[i] * 0.6);
    // base stays near black; veins lift to a cool grey, smoke adds a barely-there blue-grey bloom
    const lift = vein * 0.16 + smoke[i] * 0.012 + c * c * 0.008;
    L.r[i] = br * (0.7 + c * 0.7) + lift * 0.92;
    L.g[i] = bg * (0.7 + c * 0.7) + lift * 0.95;
    L.b[i] = bb * (0.7 + c * 0.7) + lift * 1.05;
    L.height[i] = 0.5 + (wob[i] - 0.5) * 0.5 + f * 0.03 - vein * 0.1 - scr[i] * 0.12;
    L.rough[i] = 0.5 + (haze[i] - 0.5) * 0.55 + f * 0.12 + vein * 0.3 + scr[i] * 0.45;
    L.metal[i] = 1;
    L.ao[i] = 1 - vein * 0.1;
    L.mask[i] = fleck[i];
  }
  return L;
}

/**
 * `polished` — bright polished metal in neutral grey (tinted by the material colour → gold trim, chrome…):
 * finger-smudged roughness, a web of hairline scratches, slight orange-peel in the reflection. Tile ≈ 1.5 m.
 */
export function polished(size: number): PbrLayers {
  const L = newLayers(size, 0.0012);
  const smudge = fbm(size, { freq: 4, octaves: 5, gain: 0.6, seed: 41 }).data;
  const peel = fbm(size, { freq: 22, octaves: 3, gain: 0.5, seed: 42 }).data;
  const tone = fbm(size, { freq: 3, octaves: 3, seed: 43 }).data;
  const scr = scratches(size, { count: Math.round(size * 0.5), minLen: size * 0.02, maxLen: size * 0.25, seed: 44 }).data;
  const wear = fbm(size, { freq: 10, octaves: 5, gain: 0.62, seed: 45 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const t = 0.93 + (tone[i] - 0.5) * 0.1 - scr[i] * 0.04;
    L.r[i] = t; L.g[i] = t * (0.985 + (smudge[i] - 0.5) * 0.03); L.b[i] = t * (0.96 + (smudge[i] - 0.5) * 0.08);
    L.height[i] = 0.5 + (peel[i] - 0.5) * 0.35 - scr[i] * 0.3;
    L.rough[i] = 0.5 + (smudge[i] - 0.5) * 0.7 + scr[i] * 0.55 + (peel[i] - 0.5) * 0.1;
    L.mask[i] = sstep(0.5, 0.75, wear[i]);
  }
  return L;
}

/**
 * `goldAged` — recessed structural gold: cast, lightly hammered, dark oxide settled in the low spots and
 * blotched across the faces; brighter where it has been touched. Tile ≈ 2 m.
 */
export function goldAged(size: number): PbrLayers {
  const L = newLayers(size, 0.004);
  const [gr, gg, gb] = linearRgb(0xb08a45);
  const [pr, pg, pb] = linearRgb(0x2c2013);
  const cast = hammered(size, 22, 51).data;
  const blot = fbm(size, { freq: 4, octaves: 5, gain: 0.6, seed: 52 }).data;
  const fine = fbm(size, { freq: 30, octaves: 3, gain: 0.6, seed: 53 }).data;
  const pit = pits(size, 44, 54, 0.3, 0.3).data;
  for (let i = 0; i < L.r.length; i++) {
    const low = 1 - cast[i];
    const pat = Math.min(1, sstep(0.42, 0.72, blot[i]) * 0.7 + low * low * 0.55 + pit[i] * 0.8);
    const k = pat * 0.82;
    const t = 1 + (fine[i] - 0.5) * 0.12;
    L.r[i] = (gr + (pr - gr) * k) * t;
    L.g[i] = (gg + (pg - gg) * k) * t;
    L.b[i] = (gb + (pb - gb) * k) * t;
    L.height[i] = 0.5 + (cast[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.12 - pit[i] * 0.4;
    L.rough[i] = 0.42 + pat * 0.45 + (fine[i] - 0.5) * 0.2;
    L.metal[i] = 1 - pat * 0.55;
    L.ao[i] = 1 - pit[i] * 0.5 - low * 0.15;
    L.mask[i] = pat;
  }
  return L;
}
