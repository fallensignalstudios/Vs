/**
 * Floor inlays — "light as information": narrow angular emissive gold channels, grids, radial and crownmark
 * motifs laid flush into a floor. Everything is a flat ribbon on polygon-offset materials (no z-fighting), at
 * least 4 cm wide so lines stay continuous at grazing angles.
 */
import type { FloorOpts } from '@/core/api';
import type { V3 } from './geo';
import { bx, bz } from './geo';
import type { Part } from './core';

export type InlayStyle = NonNullable<FloorOpts['inlay']> | 'border';

/** height of inlay ribbons above the surface they lie on */
const LIFT = 0.006;
const CHANNEL_W = 0.055;
const TRIM_W = 0.045;

function ring(r: number, seg: number, y: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < seg; i++) out.push([bx((i / seg) * Math.PI * 2) * r, y, bz((i / seg) * Math.PI * 2) * r]);
  return out;
}

/** rectangle outline with 45° cut corners (angular, never rounded) */
function cutRect(hw: number, hd: number, cut: number, y: number): V3[] {
  const c = Math.min(cut, hw * 0.4, hd * 0.4);
  return [
    [-hw + c, y, -hd], [hw - c, y, -hd], [hw, y, -hd + c], [hw, y, hd - c],
    [hw - c, y, hd], [-hw + c, y, hd], [-hw, y, hd - c], [-hw, y, -hd + c],
  ];
}

function radial(part: Part, R: number, y: number, crown: boolean): void {
  const ch = part.g(part.ctx.inlay('goldChannel')), tr = part.g(part.ctx.inlay('goldTrim'));
  const seg = Math.max(32, Math.min(96, Math.round(R * 6)));
  if (crown) {
    // Crownmark: three rings, a five-pointed star, five depressions between the rings.
    ch.ribbon(ring(R, seg, y), CHANNEL_W, [0, 1, 0], true);
    tr.ribbon(ring(R * 0.62, seg, y), TRIM_W, [0, 1, 0], true);
    ch.ribbon(ring(R * 0.24, Math.max(20, seg >> 1), y), CHANNEL_W, [0, 1, 0], true);
    const tips: V3[] = [];
    for (let i = 0; i < 5; i++) tips.push([bx((i / 5) * Math.PI * 2) * R * 0.62, y, bz((i / 5) * Math.PI * 2) * R * 0.62]);
    for (let i = 0; i < 5; i++) {
      ch.ribbon([tips[i], tips[(i + 2) % 5]], CHANNEL_W);
      const a = (i / 5) * Math.PI * 2;
      tr.ribbon([[bx(a) * R * 0.62, y, bz(a) * R * 0.62], [bx(a) * R, y, bz(a) * R]], TRIM_W);
      const b = a + Math.PI / 5, rr = R * 0.82, dr = Math.min(0.42, R * 0.07);
      part.g(part.ctx.inlay('goldDark')).cap(0, dr, y, 14, 1, bx(b) * rr, bz(b) * rr);
      ch.ribbon(ring(dr, 14, y + 0.001).map((p): V3 => [p[0] + bx(b) * rr, p[1], p[2] + bz(b) * rr]), 0.04, [0, 1, 0], true);
    }
    return;
  }
  const rings = [1, 0.78, 0.5, 0.26];
  rings.forEach((k, i) => (i % 2 === 0 ? ch : tr).ribbon(ring(R * k, Math.max(20, Math.round(seg * Math.sqrt(k))), y), i % 2 === 0 ? CHANNEL_W : TRIM_W, [0, 1, 0], true));
  const spokes = R > 9 ? 16 : 8;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2, odd = i % 2 === 1;
    const r0 = R * (odd ? 0.5 : 0.26), r1 = R * (odd ? 0.78 : 1);
    (odd ? tr : ch).ribbon([[bx(a) * r0, y, bz(a) * r0], [bx(a) * r1, y, bz(a) * r1]], odd ? TRIM_W : CHANNEL_W);
  }
}

/** One angular lane along −Z…+Z at lateral offset x0, with 45° jogs toward `dir`. */
function lane(x0: number, hd: number, dir: number, rand: () => number, y: number, maxJog: number): V3[] {
  const pts: V3[] = [[x0, y, hd]];
  let x = x0, z = hd, side = dir;
  for (;;) {
    const run = 4 + rand() * 6;
    z -= run;
    if (z < -hd + 3) break;
    const jog = Math.min(maxJog, 0.5 + rand() * 0.9);
    pts.push([x, y, z]);
    x += side * jog; z -= jog;
    pts.push([x, y, z]);
    side = -side;
  }
  pts.push([x, y, -hd]);
  return pts;
}

/**
 * Draw an inlay into the top face of a rectangular floor (local centre, top at y = 0, half extents hw × hd) or,
 * with `radius`, a disc.
 */
export function drawInlay(part: Part, style: InlayStyle, hw: number, hd: number, radius: number | null = null): void {
  if (style === 'none') return;
  const ctx = part.ctx, y = LIFT;
  if (radius !== null) {
    if (style === 'border' || style === 'channels' || style === 'grid') {
      part.g(ctx.inlay('goldTrim')).ribbon(ring(Math.max(0.3, radius - 0.4), Math.max(32, Math.round(radius * 6)), y), TRIM_W, [0, 1, 0], true);
      if (style !== 'border') part.g(ctx.inlay('goldChannel')).ribbon(ring(radius * 0.6, Math.max(24, Math.round(radius * 4)), y), CHANNEL_W, [0, 1, 0], true);
      return;
    }
    radial(part, Math.max(0.5, radius - 0.5), y, style === 'crownmark');
    return;
  }
  const inset = Math.min(0.45, hw * 0.2, hd * 0.2);
  const tr = part.g(ctx.inlay('goldTrim'));
  tr.ribbon(cutRect(hw - inset, hd - inset, 0.5, y), TRIM_W, [0, 1, 0], true);
  if (style === 'border') return;
  if (style === 'radial' || style === 'crownmark') {
    radial(part, Math.max(0.5, Math.min(hw, hd) - inset - 0.5), y, style === 'crownmark');
    return;
  }
  if (style === 'grid') {
    const step = 4, dk = part.g(ctx.inlay('goldDark'));
    for (let x = step / 2; x < hw - inset - 0.2; x += step) for (const s of [-1, 1]) dk.ribbon([[s * x, y, -hd + inset], [s * x, y, hd - inset]], 0.04);
    for (let z = step / 2; z < hd - inset - 0.2; z += step) for (const s of [-1, 1]) dk.ribbon([[-hw + inset, y, s * z], [hw - inset, y, s * z]], 0.04);
    part.g(ctx.inlay('goldChannel')).ribbon(cutRect(hw - inset - 0.5, hd - inset - 0.5, 0.5, y), CHANNEL_W, [0, 1, 0], true);
    return;
  }
  // 'channels': mirrored angular lanes along the long axis, with short spurs ending in nodes
  const ch = part.g(ctx.inlay('goldChannel'));
  const alongX = hw > hd, hl = alongX ? hw : hd, hs = alongX ? hd : hw;
  const swap = (p: V3): V3 => (alongX ? [p[2], p[1], p[0]] : p);
  const lanes = Math.max(1, Math.min(3, Math.round(hs / 4)));
  for (let i = 0; i < lanes; i++) {
    const off = hs * (lanes === 1 ? 0.34 : 0.2 + (0.55 * i) / (lanes - 1));
    const base = lane(off, hl - inset, i % 2 === 0 ? -1 : 1, ctx.rand, y, Math.min(1.4, hs * 0.12));
    for (const s of [-1, 1]) {
      const pts = base.map((p): V3 => swap([p[0] * s, p[1], p[2]]));
      ch.ribbon(pts, CHANNEL_W);
      // a spur + node at every other jog
      for (let k = 2; k < base.length - 1; k += 4) {
        const p = base[k], len = 0.8 + ctx.rand() * 1.2, dir = p[0] > base[k - 1][0] ? 1 : -1;
        const a = swap([p[0] * s, y, p[2]]), b = swap([(p[0] + dir * len) * s, y, p[2]]);
        ch.ribbon([a, b], CHANNEL_W);
        const n = 0.11;
        ch.quadFacing([b[0] - n, y, b[2]], [b[0], y, b[2] - n], [b[0] + n, y, b[2]], [b[0], y, b[2] + n], [0, 1, 0]);
      }
    }
  }
  if (hs > 5) ch.ribbon([swap([0, y, hl - inset]), swap([0, y, -hl + inset])], CHANNEL_W);
}
