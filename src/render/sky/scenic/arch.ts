/**
 * King-era architectural vocabulary shared by the scenic megastructure pieces: spires, causeways, pylons.
 * Upper language = white-gold ceramic-metal with gold trim and warm light seams; lower language = polished
 * black stone with narrow gold channels. No heraldry — only structure and light.
 */
import { PALETTE } from '@/core/api';
import type { GeoBuilder } from './geo';
import type { LightCards } from './lights';

export const KING = {
  whiteGold: PALETTE.whiteGold,
  gold: PALETTE.gold,
  black: 0x202127,
  blackDeep: 0x121318,
  channel: 0xffc56b,
  light: PALETTE.goldLight,
  white: 0xfff6e6,
} as const;

export type SpireTone = 'white' | 'black' | 'mixed';

export interface SpireOpts {
  x: number; y: number; z: number;
  /** total height above y */
  h: number;
  /** shaft radius at the base */
  r: number;
  tone: SpireTone;
  /** 0..1 random numbers supplier */
  rand: () => number;
  /** position the spire is mostly seen from (light seams face it) */
  viewX?: number; viewZ?: number;
  /** extra detail for spires close to the viewer */
  hero?: boolean;
}

/**
 * A gothic needle spire: stepped plinth, tapering shaft in three lifts with gold collars, four flanking
 * buttress needles, a vertical light seam and a few lit openings. ≈ 110 triangles (≈ 220 for hero spires).
 */
export function addSpire(b: GeoBuilder, cards: LightCards, o: SpireOpts): void {
  const { x, y, z, h, r, rand } = o;
  const rot = Math.atan2(-((o.viewZ ?? 0) - z), (o.viewX ?? 0) - x) + Math.PI / 4; // a flat face toward the viewer
  const light = o.tone === 'white' ? 0.62 : 0.5;
  const plinth = o.tone === 'black' ? KING.black : KING.whiteGold;
  const shaft = o.tone === 'white' ? KING.whiteGold : KING.black;
  const upper = o.tone === 'black' ? KING.blackDeep : o.tone === 'mixed' ? KING.black : KING.whiteGold;
  const y1 = y + h * 0.05, y2 = y + h * 0.13, y3 = y + h * 0.52, y4 = y + h * 0.8;
  b.paint(plinth, 0, light * 0.9).prism(x, y, z, y1, r * 2.0, r * 1.85, 4, { rot });
  b.paint(plinth, 0, light).prism(x, y1, z, y2, r * 1.5, r * 1.22, 8, { rot });
  b.paint(shaft, 0, light).prism(x, y2, z, y3, r, r * 0.7, 4, { rot });
  b.paint(KING.gold, 0, 0.7).prism(x, y3, z, y3 + h * 0.012, r * 0.82, r * 0.78, 4, { rot });
  b.paint(upper, 0, light).prism(x, y3 + h * 0.012, z, y4, r * 0.62, r * 0.34, 4, { rot });
  b.paint(KING.gold, 0, 0.7).prism(x, y4, z, y4 + h * 0.01, r * 0.42, r * 0.4, 4, { rot });
  b.paint(upper, 0, light * 0.9).prism(x, y4 + h * 0.01, z, y + h, r * 0.28, 0, 4, { rot });
  // flanking buttress needles on the plinth corners
  const nh = h * (0.34 + rand() * 0.14);
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 2;
    const fx = x + Math.cos(a) * r * 1.45, fz = z - Math.sin(a) * r * 1.45;
    b.paint(plinth, 0, light * 0.95).prism(fx, y1, fz, y1 + nh * 0.72, r * 0.34, r * 0.2, 4, { rot });
    b.paint(shaft, 0, light * 0.9).prism(fx, y1 + nh * 0.72, fz, y1 + nh, r * 0.2, 0, 4, { rot });
    if (o.hero) {
      b.paint(KING.gold, 0, 0.7).prism(fx, y1 + nh * 0.72, fz, y1 + nh * 0.735, r * 0.26, r * 0.25, 4, { rot });
      b.paint(plinth, 0, light * 0.8).box((x + fx) / 2, y1 + nh * 0.3, (z + fz) / 2, r * 0.16, nh * 0.5, r * 0.16);
    }
  }
  if (o.hero) {
    // stepped setbacks on the shaft
    for (let i = 1; i <= 3; i++) {
      const t = i / 4, yy = y2 + (y3 - y2) * t;
      b.paint(plinth, 0, light * 0.85).prism(x, yy, z, yy + h * 0.008, r * (1.06 - 0.3 * t), r * (1.03 - 0.3 * t), 4, { rot });
    }
  }
  // light seam on the two faces toward the viewer + lit openings near the base
  const faceA = rot - Math.PI / 4;
  const seams = o.hero ? 2 : rand() < 0.55 ? 1 : 0;
  for (let i = 0; i < seams; i++) {
    const a = faceA + (i * Math.PI) / 2;
    const d = r * 0.62;
    const sx = x + Math.cos(a) * d, sz = z - Math.sin(a) * d;
    const sh = (y3 - y2) * (0.3 + rand() * 0.35);
    cards.strip(sx, y2 + (y3 - y2) * (0.08 + rand() * 0.2) + sh / 2, sz, Math.max(r * 0.045, 0.7), sh, KING.light, 1.3 + rand() * 1.2);
  }
  // lit openings: a few near the base, a sparse column climbing the shaft
  const n = o.hero ? 9 : 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = faceA + (rand() - 0.5) * 1.8;
    const d = r * (1.5 + rand() * 0.5);
    cards.point(x + Math.cos(a) * d, y + h * (0.02 + rand() * 0.1), z - Math.sin(a) * d, 1.6 + rand() * 1.6, KING.light, 3 + rand() * 3);
  }
  const col = o.hero ? 8 : Math.floor(rand() * 4);
  const ca = faceA + (rand() < 0.5 ? 0 : Math.PI / 2);
  for (let i = 0; i < col; i++) {
    const t = 0.16 + (i / Math.max(col, 1)) * 0.5 + rand() * 0.03;
    const rr = r * (1.0 - 0.55 * ((t - 0.13) / 0.4)) * 0.74;
    cards.point(x + Math.cos(ca) * Math.max(rr, r * 0.3), y + h * t, z - Math.sin(ca) * Math.max(rr, r * 0.3), 1.3, KING.light, 2.4 + rand() * 2);
  }
  if (h > 320 || o.hero) cards.point(x, y + h + 2, z, 3, KING.white, 4.5);
}

/**
 * A straight elevated causeway from (x0,z0) to (x1,z1) at deck height y: two black-stone deck halves either side
 * of a recessed gold channel, parapets, pylons descending into the abyss and regularly spaced edge lights.
 */
export function addCauseway(
  b: GeoBuilder, cards: LightCards,
  x0: number, z0: number, x1: number, z1: number, y: number, width: number,
  opts: { pylonEvery?: number; pylonDepth?: number; lightEvery?: number; channel?: number; rand: () => number },
): void {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const yaw = Math.atan2(-dx, -dz); // local −Z runs along the causeway
  const th = width * 0.3;
  const ch = Math.max(width * 0.04, 1.4);
  const half = (width - ch) / 2;
  b.push().translate((x0 + x1) / 2, y, (z0 + z1) / 2).rotateY(yaw);
  for (const s of [-1, 1]) {
    b.paint(KING.black, 0, 1).box(s * (ch / 2 + half / 2), -th / 2, 0, half, th, len);
    b.paint(KING.blackDeep, 0, 1.2).box(s * (width / 2 - 0.9), 1.6, 0, 1.8, 3.2, len);
  }
  b.paint(KING.channel, opts.channel ?? 1.7).box(0, -1.6 - th * 0.2, 0, ch, th * 0.4, len);
  const pe = opts.pylonEvery ?? 180, pd = opts.pylonDepth ?? 520;
  const np = Math.max(1, Math.floor(len / pe));
  for (let i = 0; i < np; i++) {
    const t = -len / 2 + ((i + 0.5) / np) * len;
    b.paint(KING.black, 0, 0.8).box(0, -th - pd / 2, t, width * 0.5, pd, width * 0.34, { top: [1.5, 1.6] });
  }
  b.pop();
  const le = opts.lightEvery ?? 60;
  const nl = Math.floor(len / le);
  const ux = dx / len, uz = dz / len, px = -uz, pz = ux;
  for (let i = 0; i <= nl; i++) {
    const t = (i / Math.max(nl, 1)) * len;
    for (const s of [-1, 1]) {
      cards.point(x0 + ux * t + px * s * width * 0.5, y + 4, z0 + uz * t + pz * s * width * 0.5, 1.8, KING.light, 3.4 + opts.rand() * 2);
    }
  }
}
