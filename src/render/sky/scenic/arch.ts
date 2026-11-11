/**
 * King-era architectural vocabulary shared by the scenic megastructure pieces: spire families, piers, arched
 * viaducts, pointed-arch wall panels. Upper language = white-gold ceramic-metal with gold trim and warm light
 * seams; lower language = polished black stone with narrow gold channels. No heraldry — only structure and light.
 */
import { PALETTE } from '@/core/api';
import type { Frame, GeoBuilder, P3 } from './geo';
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
export type SpireStyle = 'needle' | 'blade' | 'cluster' | 'stepped' | 'crown' | 'rib';

export interface SpireOpts {
  x: number; y: number; z: number;
  /** total height above y */
  h: number;
  /** shaft radius at the base */
  r: number;
  tone: SpireTone;
  /** 0..1 random numbers supplier */
  rand: () => number;
  /** 0 = far silhouette (≈ 60 triangles), 1 = mid (≈ 300), 2 = hero (≈ 2–4k: fins, pinnacles, light slots) */
  detail?: 0 | 1 | 2;
  style?: SpireStyle;
  /** spin about the vertical axis (default: a flat face toward +Z, the usual viewer side) */
  rot?: number;
  /** false = no emissive seams or light points (silhouettes that must stay dark) */
  lit?: boolean;
}

const LIGHT = { white: 0.60, mixed: 0.52, black: 0.5 } as const;

/**
 * One tower body, read as a stack of lifts rather than a cone: plinth, lit base lift, an octagonal shaft, a
 * corbelled gallery ringed with pinnacles, a slimmer upper lift, a crown of small pinnacles and a long needle.
 * Even the far silhouette (detail 0) keeps the gallery and the crown, so a skyline steps instead of tapering.
 */
function tower(b: GeoBuilder, cards: LightCards, o: SpireOpts, x: number, z: number, y: number, h: number, r: number, detail: number, rot: number): void {
  const { rand, tone } = o;
  const lit = o.lit !== false;
  const gg = lit ? 0.12 : 0; // gold catches a glint even in shadow
  const light = LIGHT[tone];
  const plinth = tone === 'black' ? KING.black : KING.whiteGold;
  const shaft = tone === 'white' ? KING.whiteGold : KING.black;
  const upper = tone === 'black' ? KING.blackDeep : KING.whiteGold;
  const y1 = y + h * 0.05, y2 = y + h * 0.14, y3 = y + h * (0.46 + rand() * 0.08), y4 = y + h * (0.70 + rand() * 0.06);
  const win = lit ? 0.6 : 0;
  b.dress(0, 1).paint(plinth, 0, light * 0.9).prism(x, y, z, y1, r * 1.8, r * 1.7, 8, { rot });
  if (detail >= 1) {
    b.dress(0.6 * win, 1).paint(plinth, 0, light).prism(x, y1, z, y2, r * 1.4, r * 1.3, 8, { rot });
    b.dress(0, 1).paint(KING.gold, gg, 0.7).prism(x, y2 - h * 0.006, z, y2 + h * 0.004, r * 1.36, r * 1.34, 8, { rot });
  }
  // the shaft rises nearly straight: a tower, not a cone
  b.dress(0.22 * win, 1).paint(shaft, 0, light).prism(x, detail >= 1 ? y2 : y1, z, y3, r, r * 0.9, 8, { rot });
  // the gallery: a corbelled band wider than the shaft, gold-lipped, with pinnacles on its corners
  b.dress(0, 1).paint(plinth, 0, light * 0.95).prism(x, y3, z, y3 + h * 0.025, r * 0.92, r * 1.1, 8, { rot });
  b.paint(KING.gold, gg, 0.7).prism(x, y3 + h * 0.025, z, y3 + h * 0.031, r * 1.11, r * 1.08, 8, { rot });
  const gp = detail >= 1 ? 8 : 4;
  for (let i = 0; i < gp; i++) {
    const a = rot + (i / gp) * Math.PI * 2;
    b.paint(plinth, 0, light * 0.9).prism(x + Math.cos(a) * r * 0.92, y3 + h * 0.031, z - Math.sin(a) * r * 0.92, y3 + h * (0.09 + (i % 2) * 0.03), r * 0.1, 0, 4, { rot });
  }
  b.dress(0.14 * win, 1).paint(upper, 0, light).prism(x, y3 + h * 0.031, z, y4, r * 0.66, r * 0.56, 8, { rot });
  b.dress(0, 1).paint(KING.gold, gg, 0.7).prism(x, y4, z, y4 + h * 0.008, r * 0.62, r * 0.6, 8, { rot });
  // crown of small pinnacles round the foot of the needle
  const cp = detail >= 1 ? 6 : 3;
  for (let i = 0; i < cp; i++) {
    const a = rot + (i / cp) * Math.PI * 2 + 0.3;
    b.paint(upper, 0, light * 0.9).prism(x + Math.cos(a) * r * 0.52, y4 + h * 0.008, z - Math.sin(a) * r * 0.52, y4 + h * 0.08, r * 0.08, 0, 4, { rot });
  }
  b.paint(upper, 0, light * 0.9).prism(x, y4 + h * 0.008, z, y4 + h * 0.05, r * 0.4, r * 0.3, 8, { rot });
  b.paint(upper, 0, light * 0.9).prism(x, y4 + h * 0.05, z, y + h, r * 0.2, 0, 6, { rot });
  if (detail < 1) return;

  // corner buttresses leaning into the shaft, each crowned by a pinnacle
  const nh = h * (0.30 + rand() * 0.12);
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 2;
    const ca = Math.cos(a), sa = -Math.sin(a);
    const fx = x + ca * r * 1.42, fz = z + sa * r * 1.42;
    b.paint(plinth, 0, light * 0.95).prism(fx, y1, fz, y1 + nh * 0.72, r * 0.32, r * 0.2, 4, { rot });
    b.paint(shaft, 0, light * 0.9).prism(fx, y1 + nh * 0.72, fz, y1 + nh, r * 0.2, 0, 4, { rot });
    if (detail >= 2) {
      b.paint(KING.gold, gg, 0.7).prism(fx, y1 + nh * 0.72, fz, y1 + nh * 0.735, r * 0.26, r * 0.25, 4, { rot });
      // flying web between buttress and shaft
      b.push().translate((x + fx) / 2, y1 + nh * 0.34, (z + fz) / 2).rotateY(a);
      b.paint(plinth, 0, light * 0.8).box(0, 0, 0, r * 0.9, nh * 0.5, r * 0.14, { top: [0.25, 1], shift: [-r * 0.3, 0] });
      b.pop();
      const qx = x + ca * r * 1.2, qz = z + sa * r * 1.2;
      b.paint(plinth, 0, light).prism(qx, y2, qz, y2 + h * 0.07, r * 0.14, 0, 4, { rot });
    }
  }
  if (detail >= 2) {
    // setback string courses up the shaft
    for (let i = 1; i <= 4; i++) {
      const t = i / 5, yy = y2 + (y3 - y2) * t;
      b.paint(plinth, 0, light * 0.85).prism(x, yy, z, yy + h * 0.006, r * (1.03 - 0.2 * t), r * (1.01 - 0.2 * t), 8, { rot });
    }
  }
  if (!lit) return;
  // vertical light seams set into the shaft faces ("light as information"): narrow gold slits, not office windows
  const faceA = rot - Math.PI / 8;
  const seams = detail >= 2 ? 4 : rand() < 0.55 ? 1 : 0;
  for (let i = 0; i < seams; i++) {
    const a = faceA + (i * Math.PI) / 2;
    const t0 = 0.10 + rand() * 0.16, t1 = t0 + 0.34 + rand() * 0.3;
    const ya = y2 + (y3 - y2) * t0, yb = y2 + (y3 - y2) * Math.min(t1, 0.94);
    const rad = (r * (1 - 0.2 * ((t0 + t1) / 2))) * 0.93 + 0.25;
    if (detail >= 2) {
      b.push().translate(x + Math.cos(a) * rad, (ya + yb) / 2, z - Math.sin(a) * rad).rotateY(a);
      b.dress(0, 0).paint(KING.light, 1.0).box(0, 0, 0, 0.5, yb - ya, Math.max(r * 0.045, 0.8));
      b.paint(KING.gold, gg, 0.7).box(-0.2, 0, 0, 0.5, (yb - ya) * 1.04, Math.max(r * 0.15, 1.5));
      b.pop().dress(0, 1);
    } else {
      cards.strip(x + Math.cos(a) * rad, (ya + yb) / 2, z - Math.sin(a) * rad, Math.max(r * 0.045, 0.6), yb - ya, KING.light, 0.8 + rand() * 0.6);
    }
  }
  // lit openings near the base, a beacon on the tallest
  const n = detail >= 2 ? 8 : 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = faceA + (rand() - 0.5) * 2.6;
    const d = r * (1.5 + rand() * 0.5);
    cards.point(x + Math.cos(a) * d, y + h * (0.02 + rand() * 0.1), z - Math.sin(a) * d, 1.6 + rand() * 1.6, KING.light, 2.6 + rand() * 2.6);
  }
  if (h > 320 || detail >= 2) cards.point(x, y + h + 2, z, 3, KING.white, 4.5);
}

/**
 * Stepped crown: a square shaft with ribbed faces rising straight (barely tapering), capped by a lantern — a
 * crown of tall pinnacles round a shorter central spire. Reads as a gothic tower, never as a cone.
 */
function crownTower(b: GeoBuilder, cards: LightCards, o: SpireOpts, x: number, z: number, y: number, h: number, r: number, detail: number, rot: number): void {
  const { rand, tone } = o;
  const lit = o.lit !== false;
  const gg = lit ? 0.12 : 0; // gold catches a glint even in shadow
  const light = LIGHT[tone];
  const pale = tone === 'black' ? KING.black : KING.whiteGold;
  const body = tone === 'white' ? KING.whiteGold : tone === 'mixed' ? KING.whiteGold : KING.black;
  const yb = y + h * 0.06, yc = y + h * (0.62 + rand() * 0.08), yl = yc + h * 0.1;
  b.dress(0, 1).paint(KING.black, 0, 1).prism(x, y, z, yb, r * 1.9, r * 1.7, 4, { rot });
  b.paint(KING.gold, gg, 0.7).prism(x, yb, z, yb + h * 0.006, r * 1.72, r * 1.7, 4, { rot });
  b.dress(lit ? 0.12 : 0, 1).paint(body, 0, light).prism(x, yb, z, yc, r * 1.2, r * 1.06, 4, { rot });
  // ribs on each face: tall shallow fins that run the shaft and stop under the crown
  const ribs = detail >= 1 ? 2 : 1;
  for (let f = 0; f < 4; f++) {
    const a = rot + Math.PI / 4 + (f * Math.PI) / 2;
    for (let k = 0; k < ribs; k++) {
      const off = ribs === 1 ? 0 : (k - 0.5) * r * 0.7;
      const ca = Math.cos(a), sa = -Math.sin(a);
      const px = x + ca * r * 0.86 - sa * off, pz = z + sa * r * 0.86 + ca * off;
      b.push().translate(px, (yb + yc) / 2, pz).rotateY(a);
      b.paint(pale, 0, light * 0.92).box(0, 0, 0, r * 0.22, yc - yb, r * 0.12);
      b.pop();
    }
  }
  // the crown: a corbelled cornice, pinnacles round it, a lantern and its spire
  b.paint(pale, 0, light).prism(x, yc, z, yc + h * 0.02, r * 1.08, r * 1.32, 4, { rot });
  b.paint(KING.gold, gg, 0.7).prism(x, yc + h * 0.02, z, yc + h * 0.026, r * 1.33, r * 1.3, 4, { rot });
  const pins = detail >= 1 ? 8 : 4;
  for (let i = 0; i < pins; i++) {
    const a = rot + Math.PI / 4 + (i / pins) * Math.PI * 2;
    const k = i % 2 === 0 ? 1.18 : 1.05;
    const ph = h * (i % 2 === 0 ? 0.17 : 0.11);
    b.paint(pale, 0, light * 0.9).prism(x + Math.cos(a) * r * k, yc + h * 0.026, z - Math.sin(a) * r * k, yc + h * 0.026 + ph, r * 0.13, 0, 4, { rot });
  }
  b.paint(body, 0, light).prism(x, yc + h * 0.026, z, yl, r * 0.62, r * 0.5, 8, { rot });
  b.paint(KING.gold, gg, 0.7).prism(x, yl, z, yl + h * 0.006, r * 0.54, r * 0.52, 8, { rot });
  b.paint(body, 0, light * 0.9).prism(x, yl + h * 0.006, z, y + h, r * 0.34, 0, 6, { rot });
  if (!lit) return;
  // a lit lantern under the spire and a few lights at the foot
  cards.point(x, yl - h * 0.03, z + r * 0.6, Math.max(r * 0.35, 1.2), KING.light, 3.2);
  const n = detail >= 2 ? 8 : 2 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = rot + (rand() - 0.5) * 3;
    cards.point(x + Math.cos(a) * r * 2.1, y + h * (0.01 + rand() * 0.05), z - Math.sin(a) * r * 2.1, 1.6 + rand(), KING.light, 2.6 + rand() * 2.4);
  }
  if (detail >= 1 && rand() < 0.6) cards.strip(x, (yb + yc) / 2, z + r * 1.1, Math.max(r * 0.05, 0.6), (yc - yb) * 0.7, KING.light, 1.1);
  if (h > 320 || detail >= 2) cards.point(x, y + h + 2, z, 3, KING.white, 4.5);
}

/**
 * Ribs: three or four curved blades springing from a podium and leaning in until they nearly meet — the
 * Crownmark's own rib language at city scale. Pale stone with a gold edge on the inner face; a thread of light
 * where they converge.
 */
function ribTower(b: GeoBuilder, cards: LightCards, o: SpireOpts, x: number, z: number, y: number, h: number, r: number, detail: number, rot: number): void {
  const { rand, tone } = o;
  const lit = o.lit !== false;
  const gg = lit ? 0.12 : 0; // gold catches a glint even in shadow
  const light = LIGHT[tone];
  const pale = tone === 'black' ? KING.black : KING.whiteGold;
  b.dress(0, 1).paint(KING.black, 0, 1).prism(x, y, z, y + h * 0.05, r * 2.6, r * 2.3, 8, { rot });
  b.paint(KING.gold, gg, 0.7).prism(x, y + h * 0.05, z, y + h * 0.056, r * 2.32, r * 2.3, 8, { rot });
  const n = rand() < 0.5 ? 3 : 4;
  const segs = detail >= 1 ? 9 : 5;
  const y0 = y + h * 0.056;
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2;
    const ca = Math.cos(a), sa = -Math.sin(a);
    const hk = h * (k === 0 ? 1 : 0.84 + rand() * 0.1);
    const frames: Frame[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // out then in: a pointed, slightly bellied curve whose tip leans past the axis
      const rad = r * (2.0 * (1 - t) + 0.9 * Math.sin(Math.PI * t * 0.85)) * (1 - 0.92 * t * t) - r * 0.25 * t * t;
      const yy = y0 + (hk - h * 0.056) * t;
      const dt = 1 / segs;
      const t2 = Math.min(t + dt, 1), t1 = Math.max(t - dt, 0);
      const r2 = r * (2.0 * (1 - t2) + 0.9 * Math.sin(Math.PI * t2 * 0.85)) * (1 - 0.92 * t2 * t2) - r * 0.25 * t2 * t2;
      const r1 = r * (2.0 * (1 - t1) + 0.9 * Math.sin(Math.PI * t1 * 0.85)) * (1 - 0.92 * t1 * t1) - r * 0.25 * t1 * t1;
      // tangent in the (radial, up) plane → the section's "up" is the in-plane normal
      const tr = r2 - r1, ty = (hk - h * 0.056) * (t2 - t1);
      const tl = Math.hypot(tr, ty) || 1;
      const nr = -ty / tl, ny = tr / tl;
      frames.push({
        p: [x + ca * rad, yy, z + sa * rad],
        side: [-sa, 0, ca],
        up: [ca * nr, ny, sa * nr],
        w: r * (0.55 * (1 - t) + 0.12),
        d: r * (0.95 * (1 - t) + 0.16),
      });
    }
    b.dress(lit ? 0.1 : 0, 1).paint(pale, 0, light).sweep(frames);
    if (detail >= 1) {
      // gold edge along the inner face
      const edge = frames.map((f) => ({ ...f, p: [f.p[0] - f.up[0] * f.d * 0.52, f.p[1] - f.up[1] * f.d * 0.52, f.p[2] - f.up[2] * f.d * 0.52] as P3, w: f.w * 0.35, d: f.d * 0.08 }));
      b.paint(KING.gold, gg, 0.7).sweep(edge);
    }
  }
  if (!lit) return;
  cards.strip(x, y0 + h * 0.4, z, Math.max(r * 0.12, 0.8), h * 0.55, KING.light, 1.3);
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    cards.point(x + Math.cos(a) * r * 2.6, y + h * 0.06, z - Math.sin(a) * r * 2.6, 1.7, KING.light, 2.6 + rand() * 2);
  }
  if (h > 320 || detail >= 2) cards.point(x, y + h + 2, z, 3, KING.white, 4.5);
}

/**
 * A gothic spire from one of six families so a skyline has rhythm instead of one needle repeated:
 *  needle  — plinth, lit base, octagonal lifts with a pinnacled gallery and a crown, a long needle
 *  crown   — a ribbed square shaft capped by a lantern inside a crown of tall pinnacles (stepped crown)
 *  rib     — three or four curved blades leaning in until they nearly meet (the Crownmark's rib language)
 *  blade   — two dark slabs with a continuous seam of light between them
 *  cluster — a main needle with satellite needles on a shared podium
 *  stepped — a ziggurat of lit setbacks carrying a short needle
 */
export function addSpire(b: GeoBuilder, cards: LightCards, o: SpireOpts): void {
  const { x, y, z, h, r, rand } = o;
  const detail = o.detail ?? 1;
  const rot = (o.rot ?? 0) + Math.PI / 4;
  const style = o.style ?? 'needle';
  const lit = o.lit !== false;
  b.light(1, 0);
  if (style === 'crown') {
    crownTower(b, cards, o, x, z, y, h, r, detail, rot);
    return;
  }
  if (style === 'rib') {
    ribTower(b, cards, o, x, z, y, h, r, detail, rot);
    return;
  }
  if (style === 'needle' || detail === 0) {
    tower(b, cards, o, x, z, y, h, r, detail, rot);
    return;
  }
  const light = LIGHT[o.tone];
  const pale = o.tone === 'black' ? KING.black : KING.whiteGold;
  if (style === 'cluster') {
    b.dress(lit ? 0.7 : 0, 1).paint(pale, 0, light * 0.9).prism(x, y, z, y + h * 0.06, r * 3.3, r * 3.0, 8);
    b.dress(0, 1).paint(KING.gold, 0, 0.7).prism(x, y + h * 0.06, z, y + h * 0.066, r * 3.05, r * 3.0, 8);
    tower(b, cards, o, x, z, y + h * 0.06, h * 0.94, r, detail, rot);
    const n = 3 + Math.floor(rand() * 2);
    const a0 = rand() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const hh = h * (0.36 + rand() * 0.3);
      tower(b, cards, o, x + Math.cos(a) * r * 2.25, z - Math.sin(a) * r * 2.25, y + h * 0.06, hh, r * 0.5, Math.max(detail - 1, 0), rot);
    }
    return;
  }
  if (style === 'stepped') {
    const tiers = 3;
    let yy = y, rr = r * 2.3;
    for (let i = 0; i < tiers; i++) {
      const th = h * (0.12 - i * 0.02);
      b.dress(lit ? 0.85 : 0, 1).paint(i === 0 ? pale : o.tone === 'white' ? KING.whiteGold : KING.black, 0, light).prism(x, yy, z, yy + th, rr, rr * 0.92, 8, { rot });
      b.dress(0, 1).paint(KING.gold, 0, 0.7).prism(x, yy + th, z, yy + th + h * 0.006, rr * 0.95, rr * 0.93, 8, { rot });
      if (detail >= 2) {
        for (let k = 0; k < 8; k++) {
          const a = rot + (k / 8) * Math.PI * 2;
          b.paint(pale, 0, light).prism(x + Math.cos(a) * rr * 0.9, yy + th, z - Math.sin(a) * rr * 0.9, yy + th + h * 0.05, r * 0.14, 0, 4, { rot });
        }
      }
      yy += th + h * 0.006;
      rr *= 0.7;
    }
    tower(b, cards, o, x, z, yy, y + h - yy, rr * 0.8, detail, rot);
    return;
  }
  // blade: two slabs either side of a seam of light
  const dark = o.tone === 'white' ? KING.whiteGold : KING.black;
  b.push().translate(x, y, z).rotateY(rot - Math.PI / 4);
  b.dress(lit ? 0.6 : 0, 1).paint(pale, 0, light * 0.9).bevelBox(0, h * 0.03, 0, r * 4.2, h * 0.06, r * 2.6, r * 0.18);
  b.dress(0, 1).paint(KING.gold, 0, 0.7).box(0, h * 0.063, 0, r * 3.9, h * 0.006, r * 2.3);
  for (const s of [-1, 1]) {
    const top = s > 0 ? h : h * (0.86 + rand() * 0.08);
    const slab: P3[][] = [
      [[s * r * 0.34, h * 0.066, r * 1.05], [s * r * 1.7, h * 0.066, r * 0.8], [s * r * 1.7, h * 0.066, -r * 0.8], [s * r * 0.34, h * 0.066, -r * 1.05]],
      [[s * r * 0.30, h * 0.55, r * 0.72], [s * r * 1.12, h * 0.55, r * 0.5], [s * r * 1.12, h * 0.55, -r * 0.5], [s * r * 0.30, h * 0.55, -r * 0.72]],
      [[s * r * 0.26, top, r * 0.06], [s * r * 0.34, top, r * 0.04], [s * r * 0.34, top, -r * 0.04], [s * r * 0.26, top, -r * 0.06]],
    ];
    b.dress(lit ? 0.16 : 0, 1).paint(dark, 0, light).loft(slab.map((ring) => (s > 0 ? [...ring].reverse() : ring)));
    if (detail >= 2) {
      // outer buttress wedge + gold edge
      b.dress(0, 1).paint(pale, 0, light * 0.9).box(s * r * 2.0, h * 0.2, 0, r * 0.7, h * 0.28, r * 0.5, { top: [0.2, 0.6], shift: [-s * r * 0.4, 0] });
      b.paint(KING.gold, 0, 0.7).box(s * r * 0.31, h * 0.3, r * 0.92, r * 0.1, h * 0.46, r * 0.1);
    }
  }
  if (lit) {
    b.dress(0, 0).paint(KING.light, 1.6).box(0, h * 0.36, 0, r * 0.22, h * 0.56, r * 1.1);
    b.dress(0, 1);
    for (let i = 0; i < 6; i++) cards.point(x + (rand() - 0.5) * r * 4, y + h * (0.01 + rand() * 0.05), z + r * 1.5, 1.8, KING.light, 3 + rand() * 3);
    if (h > 300 || detail >= 2) cards.point(x, y + h + 2, z, 3, KING.white, 4.5);
  }
  b.pop();
}

/**
 * A pier rising out of the abyss under a spire: a lit arcade band at deck level, then fluted black stone
 * widening with depth. `deck` = height of its top.
 */
export function addPier(b: GeoBuilder, cards: LightCards, x: number, z: number, deck: number, r: number, depth: number, rand: () => number, detail = 1, lit = true): void {
  b.light(1, 0).dress(lit ? 0.8 : 0, 1).paint(KING.black, 0, 1).prism(x, deck - 14, z, deck, r * 3.0, r * 2.7, 8);
  b.dress(0, 1).paint(KING.gold, 0, 0.6).prism(x, deck - 15.2, z, deck - 14, r * 2.72, r * 2.72, 8, { caps: false });
  b.paint(KING.blackDeep, 0, 1.2).prism(x, deck - 90, z, deck - 15.2, r * 2.3, r * 2.5, 8, { caps: false });
  b.paint(KING.black, 0, 0.8).prism(x, deck - depth, z, deck - 90, r * 3.4, r * 2.1, 8, { caps: false });
  if (detail >= 1) {
    // flutes: fins running down the pier catch the key light and give the abyss a vertical grain
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.push().translate(x + Math.cos(a) * r * 2.45, deck - 15 - (depth - 15) / 2, z - Math.sin(a) * r * 2.45).rotateY(a);
      b.paint(KING.black, 0, 1.1).box(0, 0, 0, r * 0.5, depth - 15, r * 0.36, { top: [0.6, 1], shift: [-r * 0.35, 0] });
      b.pop();
    }
  }
  if (!lit) return;
  const n = 6 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand();
    cards.point(x + Math.cos(a) * r * 2.8, deck + 2, z + Math.sin(a) * r * 2.8, 1.7, KING.light, 2.6 + rand() * 2);
  }
}

/** Half of a pointed arch: t = 0 at the springing (x = half, y = 0) → 1 at the apex (0, rise). */
export function lancet(t: number, half: number, rise: number): [number, number] {
  const q = rise / Math.max(half, 1e-6);
  if (q > 1.02) {
    // a true two-centred arch: each side is a circular arc struck from beyond the opposite springing
    const k = (q * q - 1) / 2;
    const r = half * (1 + k);
    const phi = t * Math.acos(Math.min(1, (half * k) / r));
    return [-half * k + r * Math.cos(phi), r * Math.sin(phi)];
  }
  const a = t * Math.PI * 0.5;
  return [half * Math.pow(Math.cos(a), 0.75), rise * Math.pow(Math.sin(a), 0.9)];
}

export interface ArchPanelOpts {
  x0: number; x1: number; y0: number; y1: number;
  /** z of the front face (the panel faces +Z) and how far the opening's reveal runs back */
  z: number; depth: number;
  /** solid width left either side of the opening */
  pier: number;
  /** springing height as a fraction of the opening's clear height, and solid left above the apex (m) */
  spring: number; crown: number;
  segs?: number;
  /** baked light for the front face and for the reveal / intrados: [sky, lamp] */
  front?: readonly [number, number];
  inside?: readonly [number, number];
}

/** A wall panel in the local XY plane pierced by a pointed arch, with reveals and intrados (arcades, viaducts). */
export function archPanel(b: GeoBuilder, o: ArchPanelOpts): void {
  const N = o.segs ?? 6;
  const xm = (o.x0 + o.x1) / 2, hw = (o.x1 - o.x0) / 2 - o.pier;
  if (hw <= 0.01) { b.quad([o.x0, o.y0, o.z], [o.x1, o.y0, o.z], [o.x1, o.y1, o.z], [o.x0, o.y1, o.z]); return; }
  const yA = o.y1 - o.crown, ys = o.y0 + (yA - o.y0) * o.spring;
  const zf = o.z, zb = o.z - o.depth;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const [dx, dy] = lancet(i / N, hw, yA - ys);
    pts.push([dx, ys + dy]);
  }
  const front = o.front ?? [1, 0], inside = o.inside ?? front;
  b.light(front[0], front[1]);
  for (const s of [-1, 1]) {
    const xe = s < 0 ? o.x0 : o.x1, xo = xm + s * hw;
    // pier, full height
    const pier: [P3, P3, P3, P3] = [[Math.min(xe, xo), o.y0, zf], [Math.max(xe, xo), o.y0, zf], [Math.max(xe, xo), o.y1, zf], [Math.min(xe, xo), o.y1, zf]];
    b.quad(...pier);
    for (let i = 0; i < N; i++) {
      const p: P3 = [xm + s * pts[i][0], pts[i][1], zf], q: P3 = [xm + s * pts[i + 1][0], pts[i + 1][1], zf];
      const pt: P3 = [p[0], o.y1, zf], qt: P3 = [q[0], o.y1, zf];
      if (s < 0) b.quad(p, q, qt, pt);
      else b.quad(q, p, pt, qt);
    }
  }
  b.light(inside[0], inside[1]);
  const centre: P3 = [xm, ys, (zf + zb) / 2];
  for (const s of [-1, 1]) {
    const xo = xm + s * hw;
    b.quadFacing([xo, o.y0, zf], [xo, ys, zf], [xo, ys, zb], [xo, o.y0, zb], centre);
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[i + 1];
      b.quadFacing([xm + s * p[0], p[1], zf], [xm + s * q[0], q[1], zf], [xm + s * q[0], q[1], zb], [xm + s * p[0], p[1], zb], centre);
    }
  }
  b.light(front[0], front[1]);
}

/**
 * A straight elevated viaduct from (x0,z0) to (x1,z1) at deck height y: two black-stone deck halves either side
 * of a recessed gold channel, parapets with posts, pylons descending into the abyss joined by pointed arches
 * under the deck, regularly spaced edge lights and a lantern under each pylon head.
 */
export function addCauseway(
  b: GeoBuilder, cards: LightCards,
  x0: number, z0: number, x1: number, z1: number, y: number, width: number,
  opts: { pylonEvery?: number; pylonDepth?: number; lightEvery?: number; channel?: number; arches?: boolean; edgeGlow?: number; rand: () => number },
): void {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const yaw = Math.atan2(-dx, -dz); // local −Z runs along the causeway
  const th = width * 0.22;
  const ch = Math.max(width * 0.04, 1.4);
  const half = (width - ch) / 2;
  b.light(1, 0).dress(0, 1);
  b.push().translate((x0 + x1) / 2, y, (z0 + z1) / 2).rotateY(yaw);
  for (const s of [-1, 1]) {
    b.paint(KING.black, 0, 1).box(s * (ch / 2 + half / 2), -th / 2, 0, half, th, len);
    b.paint(KING.blackDeep, 0, 1.2).box(s * (width / 2 - 0.9), 1.6, 0, 1.8, 3.2, len);
    // (polish pass 4: the gold edges glow faintly, so from afar every avenue is a fine lit line, as in the overlook painting)
    b.paint(KING.gold, opts.edgeGlow ?? 0.5, 0.55).box(s * (width / 2 + 0.3), -th * 0.2, 0, 0.6, th * 0.16, len);
  }
  b.dress(0, 0).paint(KING.channel, opts.channel ?? 1.7).box(0, -1.6 - th * 0.2, 0, ch, th * 0.4, len);
  b.dress(0, 1);
  const pe = opts.pylonEvery ?? 180, pd = opts.pylonDepth ?? 520;
  const np = Math.max(1, Math.floor(len / pe));
  const bay = len / np;
  const pw = Math.min(width * 0.34, bay * 0.16);
  for (let i = 0; i < np; i++) {
    const t = -len / 2 + (i + 0.5) * bay;
    b.dress(0.35, 1).paint(KING.black, 0, 0.8).box(0, -th - pd / 2, t, width * 0.5, pd, pw, { top: [1.5, 1.5] });
    b.dress(0, 1).paint(KING.blackDeep, 0, 1.1).bevelBox(0, -th - 3, t, width * 0.86, 6, pw * 1.7, 1.2);
  }
  if (opts.arches !== false && bay > pw * 3) {
    // the web under the deck: one pointed arch per bay, on both faces of the viaduct
    const rise = Math.min(bay * 0.7, pd * 0.4);
    for (let i = 0; i <= np; i++) {
      const za = -len / 2 + (i - 0.5) * bay, zb = za + bay;
      const a0 = Math.max(za, -len / 2), a1 = Math.min(zb, len / 2);
      if (a1 - a0 < bay * 0.98) continue; // half bays at the ends stay open
      for (const s of [-1, 1]) {
        b.push().translate(s * width * 0.25, -th, (a0 + a1) / 2).rotateY((s * Math.PI) / 2);
        b.paint(KING.black, 0, 0.9);
        archPanel(b, { x0: -bay / 2, x1: bay / 2, y0: -rise - 30, y1: 0, z: 0, depth: width * 0.5, pier: pw * 0.75, spring: 0.25, crown: 5, segs: 6 });
        b.pop();
      }
    }
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
  for (let i = 0; i < np; i++) {
    const t = (i + 0.5) * bay;
    cards.point(x0 + ux * t, y - th - 9, z0 + uz * t, 3.2, KING.light, 2.4);
  }
}
