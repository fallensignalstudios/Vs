/**
 * Tiling noise toolkit for CPU texture synthesis.
 *
 * Every generator returns a square, power-of-two, seamlessly TILING scalar field stored row-major in a
 * Float32Array (`data[y * size + x]`). Lattice noise is evaluated separably (one horizontal pass per lattice
 * row, one vertical pass per pixel) with cubic B-spline weights: C2-continuous, so the normals derived from it
 * have no lattice creases, and roughly an order of magnitude cheaper than per-pixel gradient noise — which is
 * what lets a whole material library bake in about a second.
 */

/** Square tiling scalar field, row-major, `size` is a power of two. */
export interface Field {
  readonly size: number;
  readonly data: Float32Array;
}

/** Integer lattice hash → [0, 1). Deterministic across platforms. */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Per-column lattice taps for cubic B-spline interpolation of an `f`-periodic lattice across `size` texels. */
function splineTaps(size: number, f: number): { idx: Int32Array; w: Float32Array } {
  const idx = new Int32Array(size * 4);
  const w = new Float32Array(size * 4);
  for (let x = 0; x < size; x++) {
    const t = (x * f) / size;
    const i = Math.floor(t);
    const u = t - i;
    const u2 = u * u, u3 = u2 * u;
    const o = x * 4;
    idx[o] = wrap(i - 1, f); idx[o + 1] = wrap(i, f); idx[o + 2] = wrap(i + 1, f); idx[o + 3] = wrap(i + 2, f);
    const iu = 1 - u;
    w[o] = (iu * iu * iu) / 6;
    w[o + 1] = (3 * u3 - 6 * u2 + 4) / 6;
    w[o + 2] = (-3 * u3 + 3 * u2 + 3 * u + 1) / 6;
    w[o + 3] = u3 / 6;
  }
  return { idx, w };
}

/**
 * One octave of smooth tiling lattice noise, ADDED into `out` scaled by `amp`. Output range before scaling is
 * roughly [-1, 1] (σ ≈ 0.5). `fx`/`fy` are lattice cells across the tile (integers; they may differ, which gives
 * stretched/anisotropic noise for brushed metal, wood grain and drips).
 */
export function addValueNoise(out: Float32Array, size: number, fx: number, fy: number, seed: number, amp = 1): void {
  fx = Math.max(1, Math.min(size, Math.round(fx)));
  fy = Math.max(1, Math.min(size, Math.round(fy)));
  const tx = splineTaps(size, fx);
  const ty = splineTaps(size, fy);
  // horizontal pass: each lattice row resampled to full width
  const rows = new Float32Array(fy * size);
  const lat = new Float32Array(fx);
  for (let j = 0; j < fy; j++) {
    for (let i = 0; i < fx; i++) lat[i] = (hash2(i, j, seed) * 2 - 1) * 1.75;
    const ro = j * size;
    for (let x = 0; x < size; x++) {
      const o = x * 4;
      rows[ro + x] = lat[tx.idx[o]] * tx.w[o] + lat[tx.idx[o + 1]] * tx.w[o + 1]
        + lat[tx.idx[o + 2]] * tx.w[o + 2] + lat[tx.idx[o + 3]] * tx.w[o + 3];
    }
  }
  // vertical pass
  for (let y = 0; y < size; y++) {
    const o = y * 4;
    const r0 = ty.idx[o] * size, r1 = ty.idx[o + 1] * size, r2 = ty.idx[o + 2] * size, r3 = ty.idx[o + 3] * size;
    const w0 = ty.w[o] * amp, w1 = ty.w[o + 1] * amp, w2 = ty.w[o + 2] * amp, w3 = ty.w[o + 3] * amp;
    const yo = y * size;
    for (let x = 0; x < size; x++) {
      out[yo + x] += rows[r0 + x] * w0 + rows[r1 + x] * w1 + rows[r2 + x] * w2 + rows[r3 + x] * w3;
    }
  }
}

export interface FbmOpts {
  /** lattice cells across the tile for the first octave */
  freq: number;
  /** vertical frequency of the first octave (defaults to `freq`); differing values give anisotropic noise */
  freqY?: number;
  octaves?: number;
  /** amplitude falloff per octave (default 0.5) */
  gain?: number;
  /** frequency multiplier per octave — integer so every octave tiles (default 2) */
  lacunarity?: number;
  seed: number;
  /** 'fbm' smooth sum · 'ridged' sharp crests (veins, creases) · 'billow' rounded lumps */
  mode?: 'fbm' | 'ridged' | 'billow';
}

/** Fractal noise normalised to [0, 1]. */
export function fbm(size: number, o: FbmOpts): Field {
  const out = new Float32Array(size * size);
  const octaves = o.octaves ?? 5;
  const gain = o.gain ?? 0.5;
  const lac = Math.max(2, Math.round(o.lacunarity ?? 2));
  const mode = o.mode ?? 'fbm';
  let fx = o.freq, fy = o.freqY ?? o.freq, amp = 1;
  const tmp = mode === 'fbm' ? null : new Float32Array(size * size);
  for (let k = 0; k < octaves; k++) {
    if (fx > size / 2 && fy > size / 2) break; // beyond Nyquist: would only alias
    const seed = o.seed * 7919 + k * 104729;
    if (tmp === null) {
      addValueNoise(out, size, fx, fy, seed, amp);
    } else {
      tmp.fill(0);
      addValueNoise(tmp, size, fx, fy, seed, 1);
      if (mode === 'ridged') {
        for (let i = 0; i < tmp.length; i++) { const r = 1 - Math.min(1, Math.abs(tmp[i]) * 1.6); out[i] += r * r * amp; }
      } else {
        for (let i = 0; i < tmp.length; i++) out[i] += Math.min(1, Math.abs(tmp[i]) * 1.6) * amp;
      }
    }
    fx *= lac; fy *= lac; amp *= gain;
  }
  normalize(out);
  return { size, data: out };
}

/** Rescale in place to exactly [0, 1]. A constant field becomes all 0.5. */
export function normalize(a: Float32Array): void {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const d = hi - lo;
  if (!(d > 1e-12)) { a.fill(0.5); return; }
  const k = 1 / d;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
}

export interface WorleyResult {
  /** distance to the nearest feature point, in cell units (≈ 0 … 1.2) */
  f1: Field;
  /** distance to the second nearest feature point */
  f2: Field;
  /** random value in [0, 1) identifying the nearest cell (flat per cell) */
  id: Field;
  /** only with `vectors`: offset from the texel to its nearest feature point, in cell units */
  dx?: Field;
  dy?: Field;
}

/**
 * Tiling cellular (Worley) noise with `cells` × `cells` feature points. `jitter` 0 = grid, 1 = fully random.
 * `vectors` additionally returns the offset to the nearest feature point (for per-cell gradients / facets).
 */
export function worley(size: number, cells: number, seed: number, jitter = 1, vectors = false): WorleyResult {
  cells = Math.max(1, Math.min(size, Math.round(cells)));
  // feature points on a grid padded by one wrapped cell each side, stored in absolute cell coordinates, so the
  // hot loop needs no modulo
  const pw = cells + 2;
  const px = new Float32Array(pw * pw);
  const py = new Float32Array(pw * pw);
  const pid = new Float32Array(pw * pw);
  for (let j = -1; j <= cells; j++) {
    const wj = wrap(j, cells);
    for (let i = -1; i <= cells; i++) {
      const wi = wrap(i, cells);
      const c = (j + 1) * pw + (i + 1);
      px[c] = i + 0.5 + (hash2(wi, wj, seed) - 0.5) * jitter;
      py[c] = j + 0.5 + (hash2(wi, wj, seed + 101) - 0.5) * jitter;
      pid[c] = hash2(wi, wj, seed + 202);
    }
  }
  const f1 = new Float32Array(size * size);
  const f2 = new Float32Array(size * size);
  const id = new Float32Array(size * size);
  const vx = vectors ? new Float32Array(size * size) : null;
  const vy = vectors ? new Float32Array(size * size) : null;
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    const v = y * k;
    const r0 = Math.floor(v) * pw; // padded row of cell (cy - 1)
    const yo = y * size;
    for (let x = 0; x < size; x++) {
      const u = x * k;
      const c0 = r0 + Math.floor(u); // padded index of cell (cx - 1, cy - 1)
      let d1 = 1e9, d2 = 1e9, best = c0;
      for (let oy = 0; oy < 3; oy++) {
        const row = c0 + oy * pw;
        for (let c = row; c < row + 3; c++) {
          const dx = px[c] - u, dy = py[c] - v;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = c; } else if (d < d2) d2 = d;
        }
      }
      f1[yo + x] = Math.sqrt(d1);
      f2[yo + x] = Math.sqrt(d2);
      id[yo + x] = pid[best];
      if (vx && vy) { vx[yo + x] = px[best] - u; vy[yo + x] = py[best] - v; }
    }
  }
  const out: WorleyResult = { f1: { size, data: f1 }, f2: { size, data: f2 }, id: { size, data: id } };
  if (vx && vy) { out.dx = { size, data: vx }; out.dy = { size, data: vy }; }
  return out;
}

/** Bilinear wrapped lookup at fractional texel coordinates. */
export function sampleBilinear(f: Field, x: number, y: number): number {
  const s = f.size, m = s - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const xa = x0 & m, xb = (x0 + 1) & m, ya = (y0 & m) * s, yb = ((y0 + 1) & m) * s;
  const d = f.data;
  const a = d[ya + xa] + (d[ya + xb] - d[ya + xa]) * tx;
  const b = d[yb + xa] + (d[yb + xb] - d[yb + xa]) * tx;
  return a + (b - a) * ty;
}

/**
 * Domain warp: returns src sampled at (x + (wx-0.5)·amount, y + (wy-0.5)·amount). `amount` is in texels of the
 * OUTPUT field; warp fields may be any (power of two) resolution. Result tiles because all inputs tile.
 */
export function warp(src: Field, wx: Field, wy: Field, amount: number, outSize = src.size): Field {
  const out = new Float32Array(outSize * outSize);
  const ks = src.size / outSize;
  const kx = wx.size / outSize, ky = wy.size / outSize;
  for (let y = 0; y < outSize; y++) {
    for (let x = 0; x < outSize; x++) {
      const ox = (sampleBilinear(wx, x * kx, y * kx) - 0.5) * amount;
      const oy = (sampleBilinear(wy, x * ky, y * ky) - 0.5) * amount;
      out[y * outSize + x] = sampleBilinear(src, (x + ox) * ks, (y + oy) * ks);
    }
  }
  return { size: outSize, data: out };
}

/** Separable wrapped box blur, `passes` iterations (3 ≈ Gaussian). Radius in texels. Returns a new field. */
export function blur(src: Field, radius: number, passes = 2): Field {
  const s = src.size, m = s - 1;
  const r = Math.max(1, Math.round(radius));
  const a = new Float32Array(src.data);
  const b = new Float32Array(s * s);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    // horizontal a → b
    for (let y = 0; y < s; y++) {
      const yo = y * s;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[yo + (k & m)];
      for (let x = 0; x < s; x++) {
        b[yo + x] = sum * inv;
        sum += a[yo + ((x + r + 1) & m)] - a[yo + ((x - r) & m)];
      }
    }
    // vertical b → a
    for (let x = 0; x < s; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += b[(k & m) * s + x];
      for (let y = 0; y < s; y++) {
        a[y * s + x] = sum * inv;
        sum += b[((y + r + 1) & m) * s + x] - b[((y - r) & m) * s + x];
      }
    }
  }
  return { size: s, data: a };
}

/** Hermite smoothstep on scalars. */
export function sstep(a: number, b: number, v: number): number {
  if (a === b) return v < a ? 0 : 1;
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
