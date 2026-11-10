/**
 * Feature generators layered on the noise toolkit: the recognisable marks that make a surface read as a real
 * material — panel seams and bevelled plates, hairline scratches, brushed streaks, stone veining, pitting,
 * hammered dimples, crack networks, cloth weaves — plus the height → normal / cavity conversions.
 * Everything tiles.
 */
import { type Field, blur, fbm, hash2, sstep, warp, worley } from './noise';

export interface PlateOpts {
  cols: number;
  rows: number;
  /** half width of the seam groove, texels */
  seam: number;
  /** width of the bevel that rises from the groove to the plate top, texels */
  bevel: number;
  seed: number;
  /** offset every other row by half a plate (brick bond) */
  stagger?: boolean;
  /** probability that a plate is split in two (adds irregular rhythm) */
  split?: number;
}

export interface PlateResult {
  /** 0 in the groove → 1 on the plate top, smooth bevel between */
  height: Field;
  /** flat random value per plate */
  id: Field;
  /** distance to the nearest seam in texels (capped at 255) */
  edge: Field;
  /** 0 at the bottom seam of the plate → 1 at its top seam (for drip / grime gradients) */
  v01: Field;
}

/** Rectangular plate layout with grooves, bevels and optional random splits. */
export function plates(size: number, o: PlateOpts): PlateResult {
  const height = new Float32Array(size * size);
  const id = new Float32Array(size * size);
  const edge = new Float32Array(size * size);
  const v01 = new Float32Array(size * size);
  const cw = size / o.cols, ch = size / o.rows;
  const split = o.split ?? 0;
  const m = size - 1;
  // fill one plate rectangle [x0, x1) × [y0, y1) given in (possibly staggered) texel space
  const fill = (x0: number, x1: number, y0: number, y1: number, pid: number, shift: number): void => {
    for (let y = Math.ceil(y0); y < y1; y++) {
      const yo = (y & m) * size;
      const dyMin = Math.min(y - y0, y1 - y);
      const v = (y - y0) / (y1 - y0);
      for (let xs = Math.ceil(x0); xs < x1; xs++) {
        const d = Math.min(xs - x0, x1 - xs, dyMin);
        const i = yo + ((xs - shift) & m);
        edge[i] = d < 255 ? d : 255;
        height[i] = sstep(o.seam, o.seam + o.bevel, d);
        id[i] = pid;
        v01[i] = v;
      }
    }
  };
  for (let cy = 0; cy < o.rows; cy++) {
    const shift = o.stagger && (cy & 1) ? Math.round(cw * 0.5) : 0;
    for (let cx = 0; cx < o.cols; cx++) {
      const x0 = cx * cw, x1 = x0 + cw, y0 = cy * ch, y1 = y0 + ch;
      const pid = hash2(cx, cy, o.seed);
      if (split > 0 && pid < split) {
        const cut = 0.35 + hash2(cx, cy, o.seed + 31) * 0.3;
        const idA = hash2(cx, cy, o.seed + 47), idB = hash2(cx, cy, o.seed + 59);
        if (hash2(cx, cy, o.seed + 17) < 0.5) {
          const xm = Math.round(x0 + cw * cut);
          fill(x0, xm, y0, y1, idA, shift); fill(xm, x1, y0, y1, idB, shift);
        } else {
          const ym = Math.round(y0 + ch * cut);
          fill(x0, x1, y0, ym, idA, shift); fill(x0, x1, ym, y1, idB, shift);
        }
      } else {
        fill(x0, x1, y0, y1, pid, shift);
      }
    }
  }
  return { height: { size, data: height }, id: { size, data: id }, edge: { size, data: edge }, v01: { size, data: v01 } };
}

export interface ScratchOpts {
  count: number;
  /** length range in texels */
  minLen: number;
  maxLen: number;
  seed: number;
  /** mean direction (radians) and ± spread; omit `spread` for fully random directions */
  angle?: number;
  spread?: number;
  /** how much each scratch wanders (radians per texel) */
  curl?: number;
}

/** Sparse hairline scratches, 0 … 1 (max-accumulated, anti-aliased, tapered at both ends). */
export function scratches(size: number, o: ScratchOpts): Field {
  const out = new Float32Array(size * size);
  const m = size - 1;
  const spread = o.spread ?? Math.PI;
  const curl = o.curl ?? 0.004;
  for (let k = 0; k < o.count; k++) {
    let x = hash2(k, 1, o.seed) * size;
    let y = hash2(k, 2, o.seed) * size;
    let a = (o.angle ?? 0) + (hash2(k, 3, o.seed) * 2 - 1) * spread;
    const len = o.minLen + hash2(k, 4, o.seed) * (o.maxLen - o.minLen);
    const strength = 0.35 + hash2(k, 5, o.seed) * 0.65;
    const bend = (hash2(k, 6, o.seed) * 2 - 1) * curl;
    const steps = Math.max(2, Math.round(len * 1.5));
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      const v = strength * Math.min(1, Math.min(t, 1 - t) * 6);
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const ya = (y0 & m) * size, yb = ((y0 + 1) & m) * size, xa = x0 & m, xb = (x0 + 1) & m;
      const w00 = v * (1 - fx) * (1 - fy), w10 = v * fx * (1 - fy), w01 = v * (1 - fx) * fy, w11 = v * fx * fy;
      if (w00 > out[ya + xa]) out[ya + xa] = w00;
      if (w10 > out[ya + xb]) out[ya + xb] = w10;
      if (w01 > out[yb + xa]) out[yb + xa] = w01;
      if (w11 > out[yb + xb]) out[yb + xb] = w11;
      x += Math.cos(a) / 1.5;
      y += Math.sin(a) / 1.5;
      a += bend;
    }
  }
  // bilinear splats peak at ~0.25–1 depending on sub-texel phase; lift so hairlines stay visible
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] * 2);
  return { size, data: out };
}

export interface VeinOpts {
  /** winding scale: lattice cells across the tile */
  freq: number;
  seed: number;
  /** domain-warp distance as a fraction of the tile (more = more meander) */
  warp: number;
  /** vein half-thickness as a fraction of the tile (0.0015 hairline … 0.01 broad) */
  width: number;
  /** 0 … 1: how much veins fade in and out along their length */
  breakup?: number;
}

/** Full-resolution warp and fade fields shared by all vein layers of one texture (see {@link veins}). */
export interface VeinFields {
  wx: Field;
  wy: Field;
  fade: Field;
}

export function veinFields(size: number, seed: number): VeinFields {
  return {
    wx: fbm(size, { freq: 3, octaves: 4, gain: 0.5, seed: seed + 11 }),
    wy: fbm(size, { freq: 3, octaves: 4, gain: 0.5, seed: seed + 23 }),
    fade: fbm(size, { freq: 5, octaves: 3, gain: 0.5, seed: seed + 37 }),
  };
}

/**
 * Stone veining: the 0.5 iso-line of a smooth noise field looked up through a domain warp. The distance to the
 * iso-line is estimated from the field gradient, so veins keep a controlled width instead of ballooning where
 * the field is flat. Thin, meandering, occasionally branching where the field saddles. Returns 0 … 1.
 * Pass the same {@link VeinFields} to several calls to layer vein systems cheaply.
 */
export function veins(size: number, o: VeinOpts, fields: VeinFields = veinFields(size, o.seed)): Field {
  const bs = Math.min(size, 256), bm = bs - 1;
  const base = fbm(bs, { freq: o.freq, octaves: 2, gain: 0.45, seed: o.seed }).data;
  const out = new Float32Array(size * size);
  const m = size - 1;
  const k = bs / size;
  const warpPx = o.warp * size;
  const widthPx = Math.max(0.6, o.width * size);
  const breakup = o.breakup ?? 0.7;
  // decorrelate layers that share warp fields by reading them at a per-seed offset
  const ox = Math.floor(hash2(o.seed, 1, 77) * size), oy = Math.floor(hash2(o.seed, 2, 77) * size);
  const wx = fields.wx.data, wy = fields.wy.data, fade = fields.fade.data;
  for (let y = 0; y < size; y++) {
    const wo = ((y + oy) & m) * size;
    for (let x = 0; x < size; x++) {
      const wi = wo + ((x + ox) & m);
      const sx = (x + (wx[wi] - 0.5) * warpPx) * k;
      const sy = (y + (wy[wi] - 0.5) * warpPx) * k;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const tx = sx - x0, ty = sy - y0;
      const xa = x0 & bm, xb = (x0 + 1) & bm, ya = (y0 & bm) * bs, yb = ((y0 + 1) & bm) * bs;
      const a = base[ya + xa], b = base[ya + xb], c = base[yb + xa], d = base[yb + xb];
      const top = a + (b - a) * tx, bot = c + (d - c) * tx;
      const n = top + (bot - top) * ty;
      // gradient in output texels
      const gx = ((b - a) + ((d - c) - (b - a)) * ty) * k;
      const gy = (bot - top) * k;
      const dist = Math.abs(n - 0.5) / Math.sqrt(gx * gx + gy * gy + 1e-12);
      if (dist >= widthPx) continue;
      const t = 1 - dist / widthPx;
      const f = fade[y * size + x];
      out[y * size + x] = t * t * (3 - 2 * t) * (1 - breakup + breakup * sstep(0.3, 0.7, f));
    }
  }
  return { size, data: out };
}

/**
 * Sparse round pits: 1 at the pit centre → 0 outside. One candidate per lattice cell; `density` = fraction of
 * cells that hold a pit; `radius` in cell units. Discs are splatted directly (cost ∝ pit area).
 */
export function pits(size: number, cells: number, seed: number, density: number, radius: number): Field {
  cells = Math.max(1, Math.min(size, Math.round(cells)));
  const out = new Float32Array(size * size);
  const m = size - 1;
  const cs = size / cells;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const idv = hash2(i, j, seed + 202);
      if (idv >= density) continue;
      const cx = (i + hash2(i, j, seed)) * cs, cy = (j + hash2(i, j, seed + 101)) * cs;
      const r = radius * (0.45 + 0.55 * (idv / density)) * cs;
      const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
      for (let y = y0; y <= y1; y++) {
        const yo = (y & m) * size;
        for (let x = x0; x <= x1; x++) {
          const t = 1 - Math.hypot(x - cx, y - cy) / r;
          if (t <= 0) continue;
          const v = t * t * (3 - 2 * t);
          const o = yo + (x & m);
          if (v > out[o]) out[o] = v;
        }
      }
    }
  }
  return { size, data: out };
}

/** Hand-hammered dimple field (height 0 … 1): shallow bowls separated by soft ridges. */
export function hammered(size: number, cells: number, seed: number): Field {
  const w = worley(size, cells, seed, 0.9);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const a = Math.min(1, w.f1.data[i] / 0.75);
    out[i] = a * a * (0.8 + 0.4 * w.id.data[i]);
  }
  return blur({ size, data: out }, Math.max(1, size / 512), 1);
}

/** Crack network (1 on a crack → 0), from warped cell borders. `width` in cell units (≈ 0.02 … 0.1). */
export function cracks(size: number, cells: number, seed: number, width: number, warpTexels = 0): Field {
  const w = worley(size, cells, seed);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = 1 - sstep(0, width, w.f2.data[i] - w.f1.data[i]);
  const f: Field = { size, data: out };
  if (warpTexels <= 0) return f;
  const lo = Math.min(size, 256);
  return warp(f, fbm(lo, { freq: cells * 2, octaves: 3, seed: seed + 5 }), fbm(lo, { freq: cells * 2, octaves: 3, seed: seed + 9 }), warpTexels);
}

/** Brushed-metal streak field in [0, 1]: long along +u, fine across. `across` = streak count across the tile. */
export function brushed(size: number, seed: number, across = size / 2, along = 3): Field {
  return fbm(size, { freq: along, freqY: across, octaves: 3, gain: 0.6, seed });
}

/** Woven cloth height (0 … 1). `threads` = thread pairs across the tile. */
export function weave(size: number, threads: number, kind: 'plain' | 'twill' | 'ripstop'): Field {
  const out = new Float32Array(size * size);
  const k = (threads * 2) / size;
  for (let y = 0; y < size; y++) {
    const v = y * k;
    const cy = Math.floor(v);
    const fy = v - cy;
    const py = Math.sin(Math.PI * fy);
    for (let x = 0; x < size; x++) {
      const u = x * k;
      const cx = Math.floor(u);
      const fx = u - cx;
      const px = Math.sin(Math.PI * fx);
      const over = kind === 'twill' ? ((cx + cy) & 3) < 2 : ((cx + cy) & 1) === 0;
      // the thread on top runs along u (weft) when `over`, else along v (warp); it bulges where it crosses
      let h = over ? py * (0.55 + 0.45 * px) : px * (0.55 + 0.45 * py) * 0.9;
      if (kind === 'ripstop') {
        const period = 8;
        if (cx % period === 0 || cy % period === 0) h = Math.min(1, h * 1.15 + 0.25);
        else h *= 0.7;
      }
      out[y * size + x] = h;
    }
  }
  return { size, data: out };
}

/**
 * Cavity / ambient-occlusion estimate from a height field: 1 = open, lower inside grooves and pits.
 * `radius` in texels, `strength` scales how dark cavities get.
 */
export function cavity(height: Field, radius: number, strength: number): Field {
  const b = blur(height, radius, 2);
  const out = new Float32Array(height.data.length);
  for (let i = 0; i < out.length; i++) {
    const d = b.data[i] - height.data[i];
    out[i] = 1 - Math.min(1, Math.max(0, d) * strength);
  }
  return { size: height.size, data: out };
}

/**
 * Edge-wear mask from a height field: 1 on exposed convex edges (where the surface stands proud of its
 * blurred neighbourhood), broken up by `breakup` noise. Used for chipped coatings and gold-leaf wear.
 */
export function edgeWear(height: Field, radius: number, breakup: Field, amount: number): Field {
  const b = blur(height, radius, 2);
  const out = new Float32Array(height.data.length);
  const s = height.size, bs = breakup.size, k = bs / s, bm = bs - 1;
  for (let y = 0; y < s; y++) {
    const by = (Math.floor(y * k) & bm) * bs;
    for (let x = 0; x < s; x++) {
      const i = y * s + x;
      const convex = Math.max(0, height.data[i] - b.data[i]) * 4;
      const n = breakup.data[by + (Math.floor(x * k) & bm)];
      out[i] = sstep(1 - amount, 1 - amount + 0.25, convex * (0.4 + n) + (n - 0.5) * 0.5);
    }
  }
  return { size: s, data: out };
}

/**
 * Tangent-space normal map from a height field (central differences, wrapped).
 * `relief` = feature height ÷ tile width (both in metres): 0.001 is a hairline, 0.01 is deep.
 * Returns interleaved xyz floats (unit length), +Z out of the surface, +X along u, +Y along v.
 */
export function normalsFromHeight(height: Field, relief: number): Float32Array {
  const s = height.size, m = s - 1;
  const h = height.data;
  const out = new Float32Array(s * s * 3);
  const k = relief * s * 0.5;
  for (let y = 0; y < s; y++) {
    const yu = ((y + 1) & m) * s, yd = ((y - 1) & m) * s, yo = y * s;
    for (let x = 0; x < s; x++) {
      const nx = -(h[yo + ((x + 1) & m)] - h[yo + ((x - 1) & m)]) * k;
      const ny = -(h[yu + x] - h[yd + x]) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (yo + x) * 3;
      out[o] = nx * inv; out[o + 1] = ny * inv; out[o + 2] = inv;
    }
  }
  return out;
}
