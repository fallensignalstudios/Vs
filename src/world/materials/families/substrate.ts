/**
 * King-era substrate texture families: warm ivory ceramic-metal (upper terminal), worn ceramic floor,
 * mirror-polished black stone (lower terminal), polished and aged gold.
 * Each generator returns linear PBR layers for one seamless tile.
 */
import { type PbrLayers, linearRgb, newLayers } from '../bake';
import { cavity, hammered, pits, scratches, veinFields, veins } from '../features';
import { blur, fbm, sstep } from '../noise';

/**
 * `ceramic` — the white-gold of ribs, spans and walls. A cast ceramic-metal: soft cloudy mottling, faint warm-grey
 * mineral veining with a hairline web inside it, and a polish that varies in broad smudges (the roughness
 * variation is what stops it reading as plastic). Tile ≈ 4 m.
 */
export function ceramic(size: number): PbrLayers {
  const L = newLayers(size, 0.0022);
  // polish 3: a greyer, darker marble (the relay-route painting) — grey veins that read at room scale, a
  // hairline web, etched relief and a little grime settled into the low spots
  const [br, bg, bb] = linearRgb(0xd0c9b8);
  const cloud = fbm(size, { freq: 3, octaves: 5, gain: 0.55, seed: 11 }).data;
  const drift = fbm(size, { freq: 2, octaves: 3, seed: 12 }).data;
  const fine = fbm(size, { freq: 28, octaves: 4, gain: 0.6, seed: 13 }).data;
  const smudge = fbm(size, { freq: 5, octaves: 4, gain: 0.6, seed: 14 }).data;
  const web = fbm(size, { freq: 9, octaves: 4, gain: 0.6, seed: 19, mode: 'ridged' }).data;
  const vf = veinFields(size, 15);
  const v1 = veins(size, { freq: 3, seed: 15, warp: 0.22, width: 0.02, breakup: 0.5, swell: 0.85, flow: [1, 2], amp: 0.9 }, vf).data;
  const v2 = veins(size, { freq: 5, seed: 16, warp: 0.14, width: 0.0026, breakup: 0.8, swell: 0.7, flow: [2, -1], amp: 1.2 }, vf).data;
  const v3 = veins(size, { freq: 4, seed: 17, warp: 0.2, width: 0.006, breakup: 0.7, swell: 0.8, flow: [1, 3], amp: 1.1 }, vf).data;
  const wear = fbm(size, { freq: 9, octaves: 5, gain: 0.62, seed: 18 }).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    const w = Math.pow(web[i], 9) * sstep(0.45, 0.75, cloud[i]);
    h[i] = 0.5 + (cloud[i] - 0.5) * 0.3 + (fine[i] - 0.5) * 0.06 - w * 0.14 - v2[i] * 0.08 - v3[i] * 0.06;
  }
  const cav = cavity({ size, data: h }, size / 64, 9).data;
  for (let i = 0; i < L.r.length; i++) {
    const c = cloud[i] - 0.5, f = fine[i] - 0.5, d = drift[i] - 0.5;
    // broad veins are soft smoky bands eroded by the fine noise; a hairline web shows only in cloudier regions
    const band = v1[i] * (0.55 + fine[i] * 0.9);
    const w = Math.pow(web[i], 9) * sstep(0.45, 0.75, cloud[i]);
    const vein = Math.min(1, band * 0.5 + v2[i] * 0.5 + v3[i] * 0.42 + w * 0.45);
    // grime: the etched veins and the low spots hold a little dirt
    const grime = 1 - (1 - cav[i]) * 0.55;
    const lum = (1 + c * 0.2 + f * 0.06) * grime;
    // veins pull toward a cool grey; drift shifts the tile between cooler ivory and warmer cream
    L.r[i] = br * (1 + d * 0.04) * lum * (1 - vein * 0.5);
    L.g[i] = bg * lum * (1 - vein * 0.5);
    L.b[i] = bb * (1 - d * 0.08) * lum * (1 - vein * 0.44);
    L.height[i] = h[i];
    L.rough[i] = 0.5 + (smudge[i] - 0.5) * 0.7 + f * 0.2 - band * 0.12 + w * 0.2 + (1 - cav[i]) * 0.3;
    L.metal[i] = 1 - vein * 0.3;
    L.ao[i] = cav[i] * (1 - w * 0.08);
    L.mask[i] = sstep(0.42, 0.68, wear[i]) * (0.65 + 0.7 * (fine[i] - 0.15));
  }
  return L;
}

/**
 * `ceramicFloor` — walkable upper floor: the same ceramic, greyer and more marbled, traffic-polished in lanes,
 * with hairline scratches and scuffs. Tile ≈ 4 m.
 */
export function ceramicFloor(size: number): PbrLayers {
  const L = newLayers(size, 0.0024);
  // polish 3: polished grey marble (relay-route painting) — darker than the walls, dark smoky veins plus the
  // pale hairline fractures that catch the light, wear in lanes, grime in the scratches
  const [br, bg, bb] = linearRgb(0xaca9a1);
  const cloud = fbm(size, { freq: 3, octaves: 5, gain: 0.58, seed: 21 }).data;
  const fine = fbm(size, { freq: 30, octaves: 4, gain: 0.6, seed: 22 }).data;
  const polish = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 23 }).data;
  const scuff = fbm(size, { freq: 6, freqY: 26, octaves: 3, gain: 0.6, seed: 24 }).data;
  const web = fbm(size, { freq: 8, octaves: 4, gain: 0.6, seed: 28, mode: 'ridged' }).data;
  const vf = veinFields(size, 25);
  const v1 = veins(size, { freq: 3, seed: 25, warp: 0.24, width: 0.018, breakup: 0.45, swell: 0.8, flow: [2, 1], amp: 0.9 }, vf).data;
  const v2 = veins(size, { freq: 6, seed: 26, warp: 0.14, width: 0.003, breakup: 0.8, swell: 0.7, flow: [1, -2], amp: 1.2 }, vf).data;
  const v3 = veins(size, { freq: 4, seed: 27, warp: 0.26, width: 0.0022, breakup: 0.8, flow: [3, 2], amp: 1.5 }, vf).data;
  const scr = scratches(size, { count: Math.round(size * 0.22), minLen: size * 0.02, maxLen: size * 0.22, seed: 29 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const c = cloud[i] - 0.5, f = fine[i] - 0.5;
    const band = v1[i] * (0.5 + fine[i]);
    const w = Math.pow(web[i], 8) * sstep(0.4, 0.7, cloud[i]);
    const dark = Math.min(1, band * 0.6 + v2[i] * 0.65 + w * 0.4);
    const pale = Math.min(1, v3[i] * 0.9);
    const lum = 1 + c * 0.34 + f * 0.06 - scr[i] * 0.08;
    L.r[i] = (br * lum * (1 - dark * 0.55)) + pale * 0.26;
    L.g[i] = (bg * lum * (1 - dark * 0.55)) + pale * 0.26;
    L.b[i] = (bb * lum * (1 - dark * 0.52)) + pale * 0.27;
    L.height[i] = 0.5 + c * 0.2 + f * 0.05 - v3[i] * 0.1 - w * 0.12 - scr[i] * 0.06 - band * 0.04;
    L.rough[i] = 0.5 + (polish[i] - 0.5) * 0.75 + (scuff[i] - 0.5) * 0.32 + f * 0.16 + scr[i] * 0.3 - band * 0.1 + w * 0.2;
    L.metal[i] = 1 - dark * 0.3;
    L.ao[i] = 1 - v3[i] * 0.06 - w * 0.12 - scr[i] * 0.1;
    L.mask[i] = sstep(0.45, 0.7, polish[i]) * (0.6 + 0.8 * fine[i] * 0.5);
  }
  return L;
}

/**
 * `blackStone` — near-black polished stone: almost no diffuse, so everything is in the specular response.
 * Smoky clouding, pale veins that swell, pinch and break up along a prevailing direction, a finer fracture web,
 * a polish that hazes very slightly in broad patches, hairline scratches, and a gentle sub-millimetre undulation
 * so mirror reflections wobble like real honed stone instead of looking like a perfect CG plane. Tile ≈ 5 m.
 */
export function blackStone(size: number): PbrLayers {
  const L = newLayers(size, 0.0007);
  const [br, bg, bb] = linearRgb(0x0c0d11);
  const cloud = fbm(size, { freq: 3, octaves: 5, gain: 0.6, seed: 31 }).data;
  const fine = fbm(size, { freq: 26, octaves: 4, gain: 0.6, seed: 32 }).data;
  const haze = fbm(size, { freq: 4, octaves: 4, gain: 0.55, seed: 33 }).data;
  const wob = fbm(size, { freq: 7, octaves: 3, gain: 0.5, seed: 34 }).data;
  const web = fbm(size, { freq: 7, octaves: 4, gain: 0.62, seed: 38, mode: 'ridged' }).data;
  const vf = veinFields(size, 35);
  const v1 = veins(size, { freq: 3, seed: 35, warp: 0.26, width: 0.0045, breakup: 0.85, swell: 0.9, flow: [1, 2], amp: 0.9 }, vf).data;
  const v2 = veins(size, { freq: 6, seed: 36, warp: 0.16, width: 0.0016, breakup: 0.9, swell: 0.7, flow: [3, -1], amp: 1.3 }, vf).data;
  const v3 = veins(size, { freq: 4, seed: 37, warp: 0.3, width: 0.0011, breakup: 0.9, swell: 0.5, flow: [-2, 3], amp: 1.6 }, vf).data;
  const halo = blur({ size, data: v1 }, size / 110, 2).data;
  const scr = scratches(size, { count: Math.round(size * 0.1), minLen: size * 0.03, maxLen: size * 0.3, seed: 39 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const c = cloud[i], f = fine[i] - 0.5;
    const w = Math.pow(web[i], 10) * sstep(0.5, 0.8, c);
    const vein = Math.min(1, v1[i] * 0.9 + v2[i] * 0.6 + v3[i] * 0.45 + w * 0.45);
    // base stays near black; veins lift to a cool grey with a soft feathered halo, clouding adds a faint bloom
    const lift = vein * 0.17 + halo[i] * 0.03 + c * c * c * 0.012;
    L.r[i] = br * (0.6 + c * 0.9) + lift * 0.93;
    L.g[i] = bg * (0.6 + c * 0.9) + lift * 0.96;
    L.b[i] = bb * (0.6 + c * 0.9) + lift * 1.05;
    L.height[i] = 0.5 + (wob[i] - 0.5) * 0.5 + f * 0.03 - vein * 0.1 - scr[i] * 0.12;
    L.rough[i] = 0.5 + (haze[i] - 0.5) * 0.55 + f * 0.12 + vein * 0.3 + scr[i] * 0.45;
    L.metal[i] = 1;
    L.ao[i] = 1 - vein * 0.1;
    L.mask[i] = vein;
  }
  return L;
}

/**
 * `polished` — bright polished metal in neutral grey (tinted by the material colour → gold trim, chrome…):
 * finger-smudged roughness, faint buffing arcs, slight orange-peel in the reflection. Hairline scratches are
 * finer than this map can hold — they come from the shared detail layer. Tile ≈ 1.5 m.
 */
export function polished(size: number): PbrLayers {
  const L = newLayers(size, 0.0009);
  const smudge = fbm(size, { freq: 4, octaves: 5, gain: 0.6, seed: 41 }).data;
  const peel = fbm(size, { freq: 22, octaves: 3, gain: 0.5, seed: 42 }).data;
  const tone = fbm(size, { freq: 3, octaves: 3, seed: 43 }).data;
  const buff = fbm(size, { freq: 3, freqY: 40, octaves: 3, gain: 0.55, seed: 44 }).data;
  const wear = fbm(size, { freq: 10, octaves: 5, gain: 0.62, seed: 45 }).data;
  for (let i = 0; i < L.r.length; i++) {
    const t = 0.94 + (tone[i] - 0.5) * 0.08;
    L.r[i] = t; L.g[i] = t * (0.985 + (smudge[i] - 0.5) * 0.03); L.b[i] = t * (0.96 + (smudge[i] - 0.5) * 0.08);
    L.height[i] = 0.5 + (peel[i] - 0.5) * 0.35 + (buff[i] - 0.5) * 0.08;
    L.rough[i] = 0.5 + (smudge[i] - 0.5) * 0.75 + (buff[i] - 0.5) * 0.3 + (peel[i] - 0.5) * 0.1;
    L.mask[i] = sstep(0.5, 0.75, wear[i]);
  }
  return L;
}

/**
 * `goldAged` — recessed structural gold: cast, lightly hammered, dark oxide settled in the low spots and
 * blotched across the faces; brighter where it has been touched. Tile ≈ 2 m.
 */
export function goldAged(size: number): PbrLayers {
  const L = newLayers(size, 0.0025);
  const [gr, gg, gb] = linearRgb(0xb8924c);
  const [pr, pg, pb] = linearRgb(0x2c2013);
  const cast = hammered(size, 46, 51).data;
  const blot = fbm(size, { freq: 4, octaves: 5, gain: 0.6, seed: 52 }).data;
  const streak = fbm(size, { freq: 3, freqY: 14, octaves: 3, gain: 0.6, seed: 55 }).data;
  const fine = fbm(size, { freq: 30, octaves: 3, gain: 0.6, seed: 53 }).data;
  const pit = pits(size, 60, 54, 0.07, 0.3).data;
  for (let i = 0; i < L.r.length; i++) {
    const low = 1 - cast[i];
    const pat = Math.min(1, sstep(0.4, 0.75, blot[i] * 0.7 + streak[i] * 0.3) * 0.75 + low * low * 0.2 + pit[i] * 0.7);
    const k = pat * 0.78;
    const t = 1 + (fine[i] - 0.5) * 0.1;
    L.r[i] = (gr + (pr - gr) * k) * t;
    L.g[i] = (gg + (pg - gg) * k) * t;
    L.b[i] = (gb + (pb - gb) * k) * t;
    L.height[i] = 0.5 + (cast[i] - 0.5) * 0.16 + (fine[i] - 0.5) * 0.1 - pit[i] * 0.35 - pat * 0.05;
    L.rough[i] = 0.42 + pat * 0.45 + (fine[i] - 0.5) * 0.2;
    L.metal[i] = 1 - pat * 0.55;
    L.ao[i] = 1 - pit[i] * 0.5 - low * 0.1;
    L.mask[i] = pat;
  }
  return L;
}
