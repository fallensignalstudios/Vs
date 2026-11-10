/**
 * Procedural sprite atlas — every particle sprite is a small signed-distance / noise function evaluated into one
 * RGBA8 DataTexture at boot (no canvas, no image files; also usable in headless unit tests).
 * RGB = luminance/shading (multiplied by the particle colour), A = coverage.
 * Layout: ATLAS_COLS × ATLAS_ROWS cells of CELL px; sprites fade to zero before the cell edge so mips do not bleed.
 */
import * as THREE from 'three';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
const CELL = 128;

/** Sprite names in atlas order (index = cell). */
export const SPRITES = [
  'dot', 'glow', 'spark', 'streak', 'ember', 'flake', 'ring', 'hex',
  'smoke0', 'smoke1', 'smoke2', 'smoke3', 'wisp0', 'wisp1', 'dust', 'flare',
  'shard0', 'shard1', 'shard2', 'chip0', 'chip1', 'glyph0', 'glyph1', 'glyph2',
  'glyph3', 'ringSoft', 'arc', 'star', 'sparkle', 'hexGrid', 'drop', 'diamond',
] as const;
export type SpriteName = (typeof SPRITES)[number];

const INDEX = new Map<string, number>(SPRITES.map((n, i) => [n, i]));
/** Atlas cell index of a sprite (0 = dot for unknown names). */
export function spriteIndex(name: SpriteName): number {
  return INDEX.get(name) ?? 0;
}

// ------------------------------------------------------------------------------------------------ noise helpers
function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, oct = 4): number {
  let f = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    f += amp * vnoise(x, y, s + i * 17);
    n += amp;
    x = x * 2.03 + 11.7; y = y * 2.03 - 5.3; amp *= 0.5;
  }
  return f / n;
}
const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number): number => {
  const t = sat((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** distance from (x,y) to segment a→b */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const h = sat((px * dx + py * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - dx * h, py - dy * h);
}
/** signed distance to a convex polygon given as CCW points (negative inside) */
function polyDist(x: number, y: number, pts: readonly number[]): number {
  let d = -1e9;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1];
    const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
    const ex = bx - ax, ey = by - ay;
    const l = Math.hypot(ex, ey) || 1;
    // outward normal for CCW winding = (ey, -ex)
    const dist = ((x - ax) * ey - (y - ay) * ex) / l;
    if (dist > d) d = dist;
  }
  return d;
}

// ------------------------------------------------------------------------------------------------ sprite functions
/** Writes luminance + alpha for a point in [-1,1]² (y up). */
type SpriteFn = (x: number, y: number, o: { l: number; a: number }) => void;

const smoke = (seed: number): SpriteFn => (x, y, o) => {
  const r = Math.hypot(x, y);
  const n = fbm(x * 1.9 + seed * 3.1, y * 1.9 - seed * 1.7, seed, 5);
  const n2 = fbm(x * 4.3 - seed, y * 4.3 + seed * 2.3, seed + 40, 4);
  const edge = r + (n - 0.5) * 0.75;
  const body = sstep(0.92, 0.22, edge);
  o.a = body * (0.5 + 0.5 * n2) * sstep(1.0, 0.8, r);
  // billow shading: brighter top-left lobes, darker crevices
  o.l = sat(0.52 + 0.5 * (n2 - 0.45) + 0.22 * (y - x) * body);
};

const wisp = (seed: number): SpriteFn => (x, y, o) => {
  const bend = 0.34 * Math.sin(y * 2.3 + seed * 2.1) + 0.12 * Math.sin(y * 5.1 + seed);
  const d = Math.abs(x - bend);
  const w = 0.05 + 0.16 * sstep(-1, 0.1, y) * sstep(1, 0.2, y);
  const n = fbm(x * 3.0 + seed, y * 2.0 - seed * 2.0, seed + 9, 4);
  const strand = Math.exp(-(d * d) / (w * w));
  const frays = Math.exp(-(d * d) / (w * w * 9)) * 0.35 * n;
  o.a = sat(strand * (0.55 + 0.6 * n) + frays) * sstep(1, 0.55, Math.abs(y)) * sstep(1, 0.7, Math.abs(x));
  o.l = 1;
};

const shard = (pts: readonly number[], ridge: readonly [number, number, number, number]): SpriteFn => (x, y, o) => {
  const d = polyDist(x, y, pts);
  o.a = sstep(0.012, -0.012, d);
  // two facets split by a ridge line, bright bevel at the silhouette, a specular streak along the ridge
  const side = (x - ridge[0]) * (ridge[3] - ridge[1]) - (y - ridge[1]) * (ridge[2] - ridge[0]);
  const rd = segDist(x, y, ridge[0], ridge[1], ridge[2], ridge[3]);
  const facet = side > 0 ? 0.42 : 0.74;
  const bevel = sstep(-0.09, 0, d) * 0.55;
  o.l = sat(facet + bevel + Math.exp(-rd * rd * 900) * 0.6);
};

const chip = (seed: number): SpriteFn => {
  // an irregular convex polygon: 5–6 vertices on a jittered ellipse
  const n = 5 + (seed % 2);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.6 * (hash2(i, seed, 9) - 0.5)) / n) * Math.PI * 2;
    const rr = 0.5 + 0.28 * hash2(i, seed, 4);
    pts.push(Math.cos(a) * rr * 1.1, Math.sin(a) * rr * 0.8);
  }
  return (x, y, o) => {
    const d = polyDist(x, y, pts);
    o.a = sstep(0.015, -0.015, d);
    const nz = fbm(x * 5 + seed, y * 5, seed + 3, 3);
    // one lit facet, one in shade, a chipped bright edge
    const facet = x * 0.6 + y * 0.8 > 0.05 * (seed - 4) ? 0.72 : 0.4;
    o.l = sat(facet + 0.3 * (nz - 0.5) + sstep(-0.07, 0, d) * 0.25);
  };
};

/** King-era glyph marks: orthogonal / 45° strokes with small terminal squares — "light as information". */
const GLYPHS: ReadonlyArray<readonly number[]> = [
  [-0.5, -0.55, -0.5, 0.55, -0.5, 0.55, 0.15, 0.55, 0.15, 0.55, 0.5, 0.2, -0.5, 0, 0.1, 0],
  [-0.55, 0.5, 0.55, 0.5, 0, 0.5, 0, -0.2, 0, -0.2, 0.4, -0.6, 0, -0.2, -0.4, -0.6],
  [-0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.1, 0.5, 0.1, 0.1, 0.5, 0.1, 0.5, -0.5, 0.5, -0.15, -0.1, -0.15, 0.15],
  [-0.55, 0, -0.15, 0, -0.15, 0, 0.15, 0.3, 0.15, 0.3, 0.55, 0.3, -0.15, 0, 0.15, -0.3, 0.15, -0.3, 0.55, -0.3],
];
const glyph = (segs: readonly number[]): SpriteFn => (x, y, o) => {
  let d = 1e9;
  for (let i = 0; i < segs.length; i += 4) d = Math.min(d, segDist(x, y, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]));
  // terminal squares on the first and last points
  const tx = segs[segs.length - 2], ty = segs[segs.length - 1];
  const sq = Math.max(Math.abs(x - tx), Math.abs(y - ty)) - 0.09;
  const line = sstep(0.065, 0.04, d);
  const glow = Math.exp(-d * d * 60) * 0.35;
  o.a = sat(Math.max(line, sstep(0.02, -0.02, sq)) + glow) * sstep(1, 0.8, Math.max(Math.abs(x), Math.abs(y)));
  o.l = 1;
};

function hexDist(x: number, y: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  return Math.max(ax * 0.8660254 + ay * 0.5, ay);
}
/** distance to the nearest cell edge of a pointy-top hex tiling with cell radius 1 */
function hexCellEdge(x: number, y: number): number {
  const sx = 1.7320508, sy = 3;
  const ax = ((x % sx) + sx) % sx - sx / 2, ay = ((y % sy) + sy) % sy - sy / 2;
  const bx = (((x - sx / 2) % sx) + sx) % sx - sx / 2, by = (((y - sy / 2) % sy) + sy) % sy - sy / 2;
  const da = hexDist(ay, ax), db = hexDist(by, bx);
  return 0.8660254 - Math.min(da, db);
}

const SPRITE_FNS: Record<SpriteName, SpriteFn> = {
  dot: (x, y, o) => { const r2 = x * x + y * y; o.a = Math.exp(-r2 * 5.2) * sstep(1, 0.7, Math.sqrt(r2)); o.l = 1; },
  glow: (x, y, o) => { const r = Math.hypot(x, y); o.a = Math.pow(sat(1 - r), 2.4); o.l = 1; },
  spark: (x, y, o) => {
    const r2 = x * x + y * y;
    const core = Math.exp(-r2 * 46);
    const rays = Math.exp(-Math.abs(x) * 34) * Math.exp(-Math.abs(y) * 3.6) + Math.exp(-Math.abs(y) * 34) * Math.exp(-Math.abs(x) * 3.6);
    o.a = sat(core + rays * 0.75 + Math.exp(-r2 * 9) * 0.07) * sstep(1, 0.75, Math.sqrt(r2));
    o.l = 1;
  },
  streak: (x, y, o) => {
    // head at +Y, tapering tail towards -Y
    const t = (y + 1) * 0.5;
    const w = 0.07 + 0.2 * t * t;
    const body = Math.exp(-(x * x) / (w * w)) * Math.pow(t, 1.6) * sstep(1, 0.86, y);
    const head = Math.exp(-((x * x) + (y - 0.72) * (y - 0.72)) * 22);
    o.a = sat(body * 0.85 + head) * sstep(-1, -0.9, y);
    o.l = 1;
  },
  ember: (x, y, o) => {
    const ang = Math.atan2(y, x), r = Math.hypot(x, y);
    const wob = 1 + 0.3 * (vnoise(ang * 1.6 + 4, 0.5, 21) - 0.5) + 0.2 * (vnoise(ang * 4 + 9, 1.5, 22) - 0.5);
    const rr = r / (0.5 * wob);
    o.a = sat(sstep(1, 0.35, rr) + Math.exp(-r * r * 6) * 0.3) * sstep(1, 0.75, r);
    o.l = sat(0.6 + 0.6 * sstep(0.9, 0, rr));
  },
  flake: (x, y, o) => {
    const r = Math.hypot(x, y);
    let ang = Math.atan2(y, x);
    const sector = Math.PI / 3;
    ang = Math.abs(((ang % sector) + sector) % sector - sector / 2);
    const fx = Math.cos(ang) * r, fy = Math.sin(ang) * r;
    let d = segDist(fx, fy, 0, 0, 0.8, 0);
    // side barbs along each arm
    for (const b of [0.3, 0.5, 0.66]) d = Math.min(d, segDist(fx, fy, b, 0, b + 0.16, 0.16 * (1.25 - b)));
    const line = sstep(0.045, 0.012, d);
    o.a = sat(line + Math.exp(-r * r * 30) * 0.9 + Math.exp(-d * d * 180) * 0.25) * sstep(0.95, 0.8, r);
    o.l = 1;
  },
  ring: (x, y, o) => {
    const r = Math.hypot(x, y), d = Math.abs(r - 0.8);
    o.a = sat(sstep(0.045, 0.012, d) + Math.exp(-d * d * 120) * 0.35) * sstep(1, 0.93, r);
    o.l = 1;
  },
  hex: (x, y, o) => {
    const d = hexDist(x, y) - 0.72;
    const edge = sstep(0.07, 0.02, Math.abs(d));
    o.a = sat(edge + (d < 0 ? 0.16 + 0.1 * sstep(-0.5, 0, d) : 0) + Math.exp(-d * d * 90) * 0.2) * sstep(0.98, 0.9, hexDist(x, y));
    o.l = 1;
  },
  smoke0: smoke(1), smoke1: smoke(2), smoke2: smoke(3), smoke3: smoke(4),
  wisp0: wisp(1), wisp1: wisp(2.7),
  dust: (x, y, o) => {
    const r = Math.hypot(x, y);
    const grain = fbm(x * 9 + 3, y * 9 - 7, 5, 3);
    const cloud = fbm(x * 2.2, y * 2.2, 7, 3);
    o.a = sat(sstep(0.5, 0.72, grain) * 0.8 + cloud * 0.22) * sstep(0.95, 0.25, r);
    o.l = 1;
  },
  flare: (x, y, o) => {
    const r2 = x * x + y * y;
    const bar = Math.exp(-y * y * 420) * Math.exp(-Math.abs(x) * 2.6);
    const bar2 = Math.exp(-x * x * 900) * Math.exp(-Math.abs(y) * 6) * 0.5;
    o.a = sat(bar + bar2 + Math.exp(-r2 * 30) * 0.9) * sstep(1, 0.8, Math.abs(x));
    o.l = 1;
  },
  shard0: shard([-0.12, -0.82, 0.3, -0.25, 0.14, 0.86, -0.28, 0.2], [-0.12, -0.82, 0.14, 0.86]),
  shard1: shard([-0.62, -0.3, 0.1, -0.52, 0.72, 0.05, -0.05, 0.4], [-0.62, -0.3, 0.72, 0.05]),
  shard2: shard([0, -0.9, 0.2, -0.1, 0.05, 0.9, -0.22, 0.05], [0, -0.9, 0.05, 0.9]),
  chip0: chip(3), chip1: chip(7),
  glyph0: glyph(GLYPHS[0]), glyph1: glyph(GLYPHS[1]), glyph2: glyph(GLYPHS[2]), glyph3: glyph(GLYPHS[3]),
  ringSoft: (x, y, o) => {
    const r = Math.hypot(x, y), d = r - 0.62;
    o.a = Math.exp(-d * d * 34) * sstep(1, 0.9, r);
    o.l = 1;
  },
  arc: (x, y, o) => {
    // crescent: bright outer edge, soft inner falloff, tapered ends (a slash, opening downwards)
    const r = Math.hypot(x, y), ang = Math.atan2(y, x);
    const span = sstep(0.25, 1.15, ang) * sstep(Math.PI - 0.25, Math.PI - 1.15, ang);
    const d = r - 0.82;
    const edge = sstep(0.05, 0, Math.abs(d));
    const inner = d < 0 ? Math.exp(d * 7) * 0.55 : Math.exp(-d * d * 300) * 0.4;
    o.a = sat(edge + inner) * span * sstep(1, 0.94, r);
    o.l = 1;
  },
  star: (x, y, o) => {
    const r = Math.hypot(x, y);
    let a = 0;
    for (let i = 0; i < 3; i++) {
      const c = Math.cos((i * Math.PI) / 3), s = Math.sin((i * Math.PI) / 3);
      const along = x * c + y * s, across = -x * s + y * c;
      a += Math.exp(-Math.abs(across) * 40) * Math.exp(-Math.abs(along) * (i === 0 ? 2.6 : 4.4));
    }
    o.a = sat(a * 0.8 + Math.exp(-r * r * 50)) * sstep(1, 0.8, r);
    o.l = 1;
  },
  sparkle: (x, y, o) => {
    let a = 0;
    for (let i = 0; i < 9; i++) {
      const px = (hash2(i, 1, 77) - 0.5) * 1.5, py = (hash2(i, 2, 77) - 0.5) * 1.5;
      const s = 180 + hash2(i, 3, 77) * 700;
      a += Math.exp(-((x - px) * (x - px) + (y - py) * (y - py)) * s);
    }
    o.a = sat(a) * sstep(1, 0.85, Math.hypot(x, y));
    o.l = 1;
  },
  hexGrid: (x, y, o) => {
    const r = Math.hypot(x, y);
    const e = hexCellEdge(x * 4.6, y * 4.6);
    const line = sstep(0.11, 0.03, e);
    o.a = sat(line + 0.07) * sstep(0.95, 0.35, r);
    o.l = 1;
  },
  drop: (x, y, o) => {
    // teardrop, round end down
    const t = sat((y + 0.7) / 1.5);
    const w = 0.36 * Math.sqrt(sat(1 - t)) * (0.35 + 0.65 * sstep(0, 0.25, t));
    const d = Math.abs(x) - w;
    o.a = sstep(0.03, -0.03, d) * sstep(-0.82, -0.7, y) * sstep(0.85, 0.7, y);
    o.l = sat(0.7 + 0.5 * (0.2 - x));
  },
  diamond: (x, y, o) => {
    const d = Math.abs(x) + Math.abs(y) - 0.7;
    o.a = sat(sstep(0.07, 0.015, Math.abs(d)) + (d < 0 ? 0.22 : 0) + Math.exp(-d * d * 70) * 0.25) * sstep(1.0, 0.9, Math.abs(x) + Math.abs(y));
    o.l = 1;
  },
};

/** Generate the atlas pixels (RGBA8, row 0 at the bottom as WebGL expects). Exposed for tests. */
export function buildAtlasPixels(): { data: Uint8Array; width: number; height: number } {
  const width = ATLAS_COLS * CELL, height = ATLAS_ROWS * CELL;
  const data = new Uint8Array(width * height * 4);
  const o = { l: 1, a: 0 };
  const SS = 2;
  for (let s = 0; s < SPRITES.length; s++) {
    const fn = SPRITE_FNS[SPRITES[s]];
    const cx = (s % ATLAS_COLS) * CELL, cy = Math.floor(s / ATLAS_COLS) * CELL;
    for (let py = 0; py < CELL; py++) {
      for (let px = 0; px < CELL; px++) {
        let la = 0, a = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const x = ((px + (sx + 0.5) / SS) / CELL) * 2 - 1;
            const y = ((py + (sy + 0.5) / SS) / CELL) * 2 - 1;
            fn(x, y, o);
            const av = sat(o.a);
            a += av;
            la += sat(o.l) * av;
          }
        }
        // hard window: two transparent texels around every cell
        const border = Math.min(px, py, CELL - 1 - px, CELL - 1 - py);
        const win = border < 2 ? 0 : 1;
        const alpha = (a / (SS * SS)) * win;
        const lum = a > 1e-5 ? la / a : 1;
        const i = ((cy + py) * width + cx + px) * 4;
        const l8 = Math.round(lum * 255);
        data[i] = l8; data[i + 1] = l8; data[i + 2] = l8;
        data[i + 3] = Math.round(alpha * 255);
      }
    }
  }
  return { data, width, height };
}

/** Build the shared sprite atlas texture. */
export function createAtlasTexture(): THREE.DataTexture {
  const { data, width, height } = buildAtlasPixels();
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'vfx-atlas';
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
