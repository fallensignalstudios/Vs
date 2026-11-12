/**
 * Walls, ring walls and ceilings — King-era surfaces with skirting, cornice, pilasters, conduits and glass.
 * A wall segment's local frame: +X runs from `from` to `to`, Y up from the base height, Z across the thickness.
 */
import * as THREE from 'three';
import type { CeilingOpts, MatId, WallOpts } from '@/core/api';
import { familyOf, KitCtx, Part, type MatRef } from './core';
import { solidArcs } from './structure';
import { emitClosedVault, HazeWriter } from './vault';
import { glowMesh } from './relief';
import { buildHaze, emitSkylight } from './atmos';

type Style = NonNullable<WallOpts['style']>;

interface SegOpts {
  height: number;
  thickness: number;
  mat: MatId;
  /** polish 4: the wall body (the material, or an ashlar clone with `finish: 'ashlar'`) */
  body: MatRef;
  /** polish 4: light strips on pilasters / conduits / dark-stone outlines (default false: fine gold lines) */
  lit: boolean;
  style: Style;
  doors: Array<{ at: number; width: number; height: number }>;
  noCollider: boolean;
  /** extension past each end so corners close (m) */
  ext0: number;
  ext1: number;
  /** ribbed walls: put pilasters only at the segment start (ring walls) */
  jointPilasters?: boolean;
  /** glass walls: mullion spacing, metres (0 = frames at the span ends only) */
  mullion: number;
}

/** Emit one straight wall into `part`, starting at local (ox, oz) and running along local yaw `ry`. */
function emitWall(part: Part, ox: number, oz: number, ry: number, L: number, o: SegOpts): void {
  const ctx = part.ctx, H = o.height, t = o.thickness;
  const pose = part.frame(ox, 0, oz, ry);
  const glass = o.style === 'glass';
  // solid spans between door openings
  const doors = o.doors.filter((d) => d.width > 0.1 && d.at + d.width / 2 > 0 && d.at - d.width / 2 < L).sort((a, b) => a.at - b.at);
  const spans: Array<[number, number]> = [];
  let x = -o.ext0;
  for (const d of doors) {
    const a = d.at - d.width / 2;
    if (a - x > 0.02) spans.push([x, a]);
    x = d.at + d.width / 2;
  }
  if (L + o.ext1 - x > 0.02) spans.push([x, L + o.ext1]);

  const fam = familyOf(o.mat);
  const body = part.g(o.body), wg = part.g(fam.frame), trim = part.g('goldTrim');
  // polish 4: light strips are an opt-in (`lit: true`); by default the same lines are fine inlaid gold
  const line = (dark: boolean): MatRef => (o.lit ? ctx.seam(dark) : ctx.goldLine());
  const cornice = H >= 3;
  for (const [a, b] of spans) {
    const len = b - a, cx = (a + b) / 2;
    if (glass) {
      wg.boxOn(len, 0.28, t, cx, 0, 0).box(len, 0.3, t, cx, H - 0.15, 0);
      trim.box(len, 0.035, t + 0.03, cx, 0.3, 0).box(len, 0.035, t + 0.03, cx, H - 0.32, 0);
      part.g('glass').box(len, H - 0.58, 0.05, cx, H / 2 - 0.01, 0);
      const n = o.mullion > 0 ? Math.max(1, Math.round(len / o.mullion)) : 1;
      for (let i = 0; i <= n; i++) {
        const mx = a + (len * i) / n;
        part.g('goldDark').boxOn(0.14, H - 0.58, t * 0.5, mx, 0.28, 0);
        trim.boxOn(0.04, H - 0.58, t * 0.5 + 0.03, mx, 0.28, 0);
      }
    } else {
      body.boxOn(len, H, t, cx, 0, 0);
      wg.tbox(len, 0.42, t + 0.12, 0.04, cx, 0, 0);
      trim.box(len, 0.035, t + 0.13, cx, 0.46, 0);
      if (cornice) {
        wg.box(len, 0.26, t + 0.18, cx, H - 0.13, 0);
        trim.box(len, 0.04, t + 0.2, cx, H - 0.3, 0);
      }
      if (fam.dark) {
        // black stone: a gold line outlines the wall where it meets floor and cornice (polish 4: inlaid gold that
        // reflects the room; `lit: true` makes it the old light channel)
        for (const s of [-1, 1]) {
          const z = s * (t / 2 + 0.004), up: [number, number, number] = [0, 0, s], w = o.lit ? 0.045 : 0.03;
          part.g(line(true)).ribbon([[a + 0.05, 0.62, z], [b - 0.05, 0.62, z]], w, up);
          if (cornice) part.g(line(true)).ribbon([[a + 0.05, H - 0.42, z], [b - 0.05, H - 0.42, z]], w, up);
        }
      }
    }
    if (!o.noCollider) ctx.collider(pose.box(cx, H / 2, 0, len / 2, H / 2, t / 2, { blocksSight: !glass, tag: glass ? 'glass' : 'wall' }));
  }
  for (const d of doors) {
    const dh = Math.min(d.height, H);
    if (H - dh < 0.05) continue;
    (glass ? wg : body).box(d.width, H - dh, t, d.at, (H + dh) / 2, 0);
    if (cornice && !glass) {
      wg.box(d.width, 0.26, t + 0.18, d.at, H - 0.13, 0);
      trim.box(d.width, 0.04, t + 0.2, d.at, H - 0.3, 0);
    }
    if (!o.noCollider) ctx.collider(pose.box(d.at, (H + dh) / 2, 0, d.width / 2, (H - dh) / 2, t / 2, { tag: 'lintel' }));
  }
  if (glass || o.style === 'plain') { part.unframe(); return; }
  if (o.style === 'slab' || o.style === 'framed') {
    emitRelief(part, o, spans, doors, L, cornice);
    part.unframe();
    return;
  }

  // positions of repeated vertical features: kept clear of door openings
  const clear = (px: number, half: number): boolean => doors.every((d) => Math.abs(px - d.at) > d.width / 2 + half + 0.15);
  const repeat = (spacing: number): number[] => {
    if (o.jointPilasters) return [0];
    const n = Math.max(1, Math.round(L / spacing)), out: number[] = [];
    for (let i = 0; i < n; i++) out.push((L * (i + 0.5)) / n);
    return out;
  };

  if (o.style === 'ribbed') {
    const ph = H - (cornice ? 0.3 : 0);
    for (const px of repeat(4.2)) {
      if (!clear(px, 0.5)) continue;
      wg.vbox(0.84, ph, t + 0.46, 0.09, px, 0, 0).tbox(1.04, 0.56, t + 0.62, 0.07, px, 0, 0);
      trim.box(0.9, 0.04, t + 0.5, px, 0.62, 0).box(0.9, 0.04, t + 0.5, px, ph - 0.5, 0);
      if (ph > 2.4) {
        for (const s of [-1, 1]) {
          const z = s * (t / 2 + 0.232), up: [number, number, number] = [0, 0, s];
          part.g(line(fam.dark)).ribbon([[px, 0.86, z], [px, ph - 0.75, z]], o.lit ? 0.07 : 0.035, up);
          trim.ribbon([[px - 0.085, 0.8, z], [px - 0.085, ph - 0.7, z]], 0.028, up).ribbon([[px + 0.085, 0.8, z], [px + 0.085, ph - 0.7, z]], 0.028, up);
        }
      }
    }
  } else if (o.style === 'panelled') {
    for (const [a, b] of spans) {
      const len = b - a, cx = (a + b) / 2;
      part.g('goldDark').box(len, 0.34, t + 0.05, cx, 1.3, 0);
      trim.box(len, 0.03, t + 0.07, cx, 1.49, 0).box(len, 0.03, t + 0.07, cx, 1.11, 0);
      if (H > 4.5) trim.box(len, 0.03, t + 0.03, cx, H - 1.1, 0);
    }
    for (const px of repeat(3.6)) {
      if (!clear(px, 0.15)) continue;
      wg.vbox(0.2, H - (cornice ? 0.3 : 0) - 0.42, t + 0.1, 0.03, px, 0.42, 0);
    }
  } else if (o.style === 'conduit') {
    const top = H - (cornice ? 0.45 : 0.1);
    for (const px of repeat(3.4)) {
      if (!clear(px, 0.3)) continue;
      for (const s of [-1, 1]) {
        const z = s * (t / 2 + 0.07);
        for (const dx of [-0.11, 0.11]) trim.cyl(0.042, 0.042, top - 0.44, 6, px + dx, 0.44, z);
        for (let y = 1.1; y < top - 0.3; y += 1.9) part.g('goldDark').box(0.4, 0.09, 0.11, px, y, z);
        part.g('goldDark').cbox(0.36, 0.5, 0.15, 0.03, px, 1.55, z + s * 0.02);
        part.g(line(fam.dark)).ribbon([[px, 1.95, s * (t / 2 + 0.012)], [px, top - 0.35, s * (t / 2 + 0.012)]], o.lit ? 0.06 : 0.03, [0, 0, s]);
        part.g('whiteLight').box(0.1, 0.05, 0.02, px, 1.62, z + s * 0.1);
      }
    }
    for (const [a, b] of spans) {
      for (const s of [-1, 1]) {
        trim.push().move(a, top - 0.25, s * (t / 2 + 0.07)).rotZ(-Math.PI / 2).cyl(0.05, 0.05, b - a, 6, 0, 0, 0).pop();
      }
    }
  }
  part.unframe();
}

/** fix & ship: the vault / flat ceilings' light troughs at this fraction of `glow` (they still read as light bars) */
const TROUGH_DIM = 0.45;

/**
 * Polish 4: a soft light trough along local Z (centred on x, at height y, facing `dir` on Y): three strips across
 * (dim edges, bright middle) and fades at both ends — a recessed soft light, not a neon bar.
 */
function softStrip(hz: HazeWriter, x: number, y: number, w: number, len: number, dir: 1 | -1): void {
  // (fix & ship: a softer fall-off across: the edges barely lit, so the trough reads as a glow, not a bar)
  const xs = [x - w / 2, x - w * 0.12, x + w * 0.12, x + w / 2], kx = [0.08, 1, 1, 0.08];
  const zs = [-len / 2, -len / 2 + Math.min(1.2, len * 0.15), len / 2 - Math.min(1.2, len * 0.15), len / 2], kz = [0.35, 1, 1, 0.35];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    hz.quad([xs[i], y, zs[j]], [xs[i + 1], y, zs[j]], [xs[i + 1], y, zs[j + 1]], [xs[i], y, zs[j + 1]], [0, dir, 0],
      [kx[i] * kz[j], kx[i + 1] * kz[j], kx[i + 1] * kz[j + 1], kx[i] * kz[j + 1]]);
  }
}

/**
 * Polish 4: walls with real relief.
 *  - `'slab'`: the face is clad in large smooth marble slabs (≈ 2.6 × 3.4 m, 6 cm proud, chamfered) with a dark
 *    shadow gap between them, and a fine gold line run in the first course joint.
 *  - `'framed'`: stiles every ≈ 3.2 m and, between them, recessed panels in a stone moulding with a thin gold frame
 *    (a low dado panel and a tall upper panel on walls over 4 m).
 * Both faces get the treatment; bays that would cut into a door opening are left plain. Geometry only (merged
 * by material in finalize); the collider is the plain wall's.
 */
function emitRelief(part: Part, o: SegOpts, spans: Array<[number, number]>, doors: Array<{ at: number; width: number; height: number }>, L: number, cornice: boolean): void {
  const ctx = part.ctx, H = o.height, t = o.thickness, fam = familyOf(o.mat);
  const stone = part.g(fam.frame), trim = part.g('goldTrim'), gold = part.g(ctx.goldLine());
  const y0 = 0.5, top = H - (cornice ? 0.34 : 0.05), A = top - y0;
  if (A < 0.8) return;
  const free = (x0: number, x1: number): boolean => doors.every((d) => x1 < d.at - d.width / 2 - 0.05 || x0 > d.at + d.width / 2 + 0.05);
  for (const [a0, b0] of spans) {
    const a = Math.max(a0, 0), b = Math.min(b0, L), len = b - a;
    if (len < 0.6) continue;
    for (const s of [-1, 1]) {
      const zf = s * (t / 2);
      if (o.style === 'slab') {
        const gap = 0.035, d = 0.06;
        const n = Math.max(1, Math.round(len / 2.6)), m = Math.max(1, Math.round(A / 3.4));
        const sw = len / n, sh = A / m;
        for (let i = 0; i < n; i++) {
          const x0 = a + sw * i, x1 = x0 + sw;
          if (!free(x0, x1)) continue;
          for (let j = 0; j < m; j++) {
            const yb = y0 + sh * j;
            stone.cbox(sw - gap, sh - gap, d, 0.012, (x0 + x1) / 2, yb + sh / 2, zf + s * d / 2);
          }
          // the first course joint carries a fine gold line (the paintings' thin gold bands)
          if (m > 1) gold.ribbon([[x0 + 0.02, y0 + sh, zf + s * 0.002], [x1 - 0.02, y0 + sh, zf + s * 0.002]], 0.022, [0, 0, s]);
        }
      } else {
        // 'framed': stiles, then a moulded recess with a thin gold frame in every bay
        const n = Math.max(1, Math.round(len / 3.2)), bw = len / n, stile = 0.36, sd = 0.12, md = 0.07, mw = 0.13;
        for (let i = 0; i <= n; i++) {
          const px = a + bw * i;
          if (free(px - stile / 2, px + stile / 2)) {
            stone.vbox(stile, A + 0.02, sd, 0.03, px, y0 - 0.02, zf + s * sd / 2);
            trim.box(stile + 0.02, 0.03, sd + 0.01, px, y0 + 0.18, zf + s * sd / 2);
          }
        }
        const tiers: Array<[number, number]> = A > 4 ? [[y0 + 0.2, y0 + 1.15], [y0 + 1.45, top - 0.3]] : [[y0 + 0.2, top - 0.2]];
        for (let i = 0; i < n; i++) {
          const x0 = a + bw * i + stile / 2 + 0.16, x1 = a + bw * (i + 1) - stile / 2 - 0.16;
          if (x1 - x0 < 0.5 || !free(x0, x1)) continue;
          const cx = (x0 + x1) / 2, w = x1 - x0;
          for (const [ya, yb] of tiers) {
            if (yb - ya < 0.4) continue;
            const cy = (ya + yb) / 2, h = yb - ya, z = zf + s * md / 2;
            // stone moulding round the recess
            stone.box(w, mw, md, cx, yb - mw / 2, z).box(w, mw, md, cx, ya + mw / 2, z);
            stone.box(mw, h - 2 * mw, md, x0 + mw / 2, cy, z).box(mw, h - 2 * mw, md, x1 - mw / 2, cy, z);
            // the thin gold frame on the moulding's inner edge, corners cut at 45°
            const gx0 = x0 + mw + 0.012, gx1 = x1 - mw - 0.012, gy0 = ya + mw + 0.012, gy1 = yb - mw - 0.012, c = Math.min(0.14, (gx1 - gx0) * 0.2, (gy1 - gy0) * 0.2);
            const zg = zf + s * 0.004;
            gold.ribbon([
              [gx0 + c, gy0, zg], [gx1 - c, gy0, zg], [gx1, gy0 + c, zg], [gx1, gy1 - c, zg],
              [gx1 - c, gy1, zg], [gx0 + c, gy1, zg], [gx0, gy1 - c, zg], [gx0, gy0 + c, zg],
            ], 0.026, [0, 0, s], true);
          }
        }
      }
    }
  }
}

function segOpts(ctx: KitCtx, o: Omit<WallOpts, 'from' | 'to'>, ext0: number, ext1: number): SegOpts {
  const style: Style = o.style === 'ribbed' || o.style === 'panelled' || o.style === 'conduit' || o.style === 'glass' || o.style === 'slab' || o.style === 'framed' ? o.style : 'plain';
  const mat = o.mat ?? 'whiteGoldPanel';
  return {
    height: ctx.num(o.height, 8, 0.3), thickness: ctx.num(o.thickness, 0.6, 0.1, 4), mat, style,
    body: ctx.wallFinish(mat, o.finish), lit: o.lit === true,
    doors: (o.doors ?? []).map((d) => ({ at: ctx.num(d.at, 0), width: ctx.num(d.width, 3, 0), height: ctx.num(d.height, 3.5, 0.5) })),
    noCollider: !!o.noCollider, ext0, ext1,
    mullion: ctx.num(o.mullionSpacing, 3, 0, 1000),
  };
}

export function buildWall(ctx: KitCtx, o: WallOpts): THREE.Object3D {
  const h = ctx.num(o.h, 0), a = ctx.P(o.from[0], o.from[1], h), b = ctx.P(o.to[0], o.to[1], h);
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const part = new Part(ctx, 'wall', a);
  if (L < 0.05) { ctx.warn('wall-len', 'wall(): from and to coincide — skipped'); return part.done(); }
  const so = segOpts(ctx, o, 0, 0);
  so.ext0 = so.ext1 = so.thickness / 2;
  emitWall(part, 0, 0, Math.atan2(-(b.z - a.z), b.x - a.x), L, so);
  return part.done();
}

export function buildWalls(ctx: KitCtx, points: Array<[number, number]>, o: Omit<WallOpts, 'from' | 'to'> & { closed?: boolean } = {}): THREE.Object3D {
  const h = ctx.num(o.h, 0);
  const pts = (points ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) { ctx.warn('walls-pts', 'walls(): needs at least two points — skipped'); return new Part(ctx, 'walls', ctx.P(0, 0, h)).done(); }
  const origin = ctx.P(pts[0][0], pts[0][1], h);
  const part = new Part(ctx, 'walls', origin);
  const n = o.closed ? pts.length : pts.length - 1;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const a = ctx.P(p[0], p[1], h), b = ctx.P(q[0], q[1], h), L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 0.05) continue;
    const so = segOpts(ctx, o, 0, 0);
    so.ext0 = so.ext1 = so.thickness / 2;
    // door distances are measured along the whole polyline
    so.doors = so.doors.map((d) => ({ ...d, at: d.at - run })).filter((d) => d.at > -d.width / 2 && d.at < L + d.width / 2);
    emitWall(part, a.x - origin.x, a.z - origin.z, Math.atan2(-(b.z - a.z), b.x - a.x), L, so);
    run += L;
  }
  return part.done();
}

export function buildRingWall(ctx: KitCtx, o: { x: number; n: number; r: number; h?: number; height?: number; mat?: MatId; gapsDeg?: Array<[number, number]>; segments?: number; style?: WallOpts['style']; noCollider?: boolean; thickness?: number; mullionSpacing?: number; finish?: WallOpts['finish']; lit?: boolean }): THREE.Object3D {
  const r = ctx.num(o.r, 10, 1), h = ctx.num(o.h, 0);
  const part = new Part(ctx, 'ringWall', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h));
  const segments = Math.round(ctx.num(o.segments, Math.max(16, Math.min(72, Math.round((Math.PI * 2 * r) / 4.5))), 6, 180));
  const stepDeg = 360 / segments;
  const gaps = (o.gapsDeg ?? []).map(([a, b]): [number, number] => [((a % 360) + 360) % 360, ((b % 360) + 360) % 360]);
  for (const [a0, a1] of solidArcs(gaps)) {
    const n = Math.max(1, Math.round((a1 - a0) / stepDeg));
    for (let i = 0; i < n; i++) {
      const b0 = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180, b1 = ((a0 + ((a1 - a0) * (i + 1)) / n) * Math.PI) / 180;
      const ax = Math.sin(b0) * r, az = -Math.cos(b0) * r, bx = Math.sin(b1) * r, bz = -Math.cos(b1) * r;
      const so = segOpts(ctx, o, 0, 0);
      const ext = (so.thickness / 2) * Math.tan((b1 - b0) / 2) + 0.01;
      so.ext0 = i === 0 ? 0 : ext; so.ext1 = i === n - 1 ? 0 : ext;
      so.jointPilasters = true;
      so.doors = [];
      emitWall(part, ax, az, Math.atan2(-(bz - az), bx - ax), Math.hypot(bx - ax, bz - az), so);
    }
  }
  return part.done();
}

export function buildCeiling(ctx: KitCtx, o: CeilingOpts): THREE.Object3D {
  const w0 = ctx.num(o.w, 20, 1), d0 = ctx.num(o.d, 20, 1), h = ctx.num(o.h, 8);
  // author along the longer side: local Z = long axis
  const turn = w0 > d0, w = turn ? d0 : w0, d = turn ? w0 : d0;
  const part = new Part(ctx, 'ceiling', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h), ctx.yaw(ctx.num(o.yawDeg, 0)) + (turn ? Math.PI / 2 : 0));
  const style = o.style ?? 'flat';
  if (style === 'vaultClosed') {
    emitClosedVault(ctx, part, o, w, d, h);
    return part.done();
  }
  if (style === 'skylight') {
    emitSkylight(ctx, part, o, w, d);
    const group = part.done();
    // polish 4: the upper hall fills with the light that comes through the coffers
    if (o.hazeBelow !== false) {
      const drop = ctx.num(o.hazeDepth, Math.min(10, h * 0.7), 1, 60);
      buildHaze(ctx, { x: ctx.num(o.x, 0), n: ctx.num(o.n, 0), h: h - drop, w: w0 * 0.96, d: d0 * 0.96, height: drop, yawDeg: o.yawDeg,
        color: ctx.num(o.hazeColor, 0xf2eee6), density: 0.05, intensity: 0.9, falloff: -0.8, soft: 0.3 });
    }
    return group;
  }
  const mat = o.mat ?? 'whiteGoldPanel', hw = w / 2, hd = d / 2;
  const wg = part.g(familyOf(o.mat).frame), trim = part.g('goldTrim');
  const bays = Math.max(1, Math.round(d / 6));
  if (style === 'vault') {
    const rise = w * 0.24, n = 14, th = 0.35;
    const arc = (i: number, off: number): [number, number] => {
      const t = Math.PI * (i / n);
      return [-Math.cos(t) * (hw + off), Math.sin(t) * (rise + off)];
    };
    const shell = part.g(mat);
    for (let i = 0; i < n; i++) {
      const a = arc(i, 0), b = arc(i + 1, 0), c = arc(i, th), e = arc(i + 1, th);
      const mid: [number, number, number] = [-(a[0] + b[0]) / 2, -1, 0];
      shell.quadFacing([a[0], a[1], -hd], [b[0], b[1], -hd], [b[0], b[1], hd], [a[0], a[1], hd], mid);
      shell.quadFacing([c[0], c[1], -hd], [e[0], e[1], -hd], [e[0], e[1], hd], [c[0], c[1], hd], [(c[0] + e[0]) / 2, 1, 0]);
      for (const s of [-1, 1]) shell.quadFacing([a[0], a[1], s * hd], [b[0], b[1], s * hd], [e[0], e[1], s * hd], [c[0], c[1], s * hd], [0, 0, s]);
    }
    // transverse ribs + gold edge lines
    for (let k = 0; k <= bays; k++) {
      const z = -hd + (d * k) / bays;
      for (let i = 0; i < n; i++) {
        const a = arc(i, -0.42), b = arc(i + 1, -0.42), c = arc(i, 0.02), e = arc(i + 1, 0.02);
        wg.hull([
          [[a[0], a[1], z - 0.36], [b[0], b[1], z - 0.36], [b[0], b[1], z + 0.36], [a[0], a[1], z + 0.36]],
          [[a[0], a[1], z - 0.36], [b[0], b[1], z - 0.36], [e[0], e[1], z - 0.36], [c[0], c[1], z - 0.36]],
          [[a[0], a[1], z + 0.36], [b[0], b[1], z + 0.36], [e[0], e[1], z + 0.36], [c[0], c[1], z + 0.36]],
        ], [(c[0] + e[0]) / 2, (c[1] + e[1]) / 2 + 0.3, z]);
        const g0 = arc(i, -0.43), g1 = arc(i + 1, -0.43);
        trim.ribbon([[g0[0], g0[1], z], [g1[0], g1[1], z]], 0.08, [-(g0[0] + g1[0]) / 2, -1, 0]);
      }
    }
    // apex light seam + springing strips (polish 4: soft light troughs — bright down the middle, fading to the
    // edges and the ends — instead of flat neon bars; `glow` sets their brightness, default 1.6)
    const soft = new HazeWriter(ctx.num(o.hazeColor, 0xf6f0e6));
    softStrip(soft, 0, rise - 0.03, 0.44, d - 0.8, -1);
    for (const s of [-1, 1]) {
      wg.box(0.5, 0.4, d, s * (hw - 0.2), 0.1, 0);
      softStrip(soft, s * (hw - 0.26), -0.105, 0.28, d - 0.8, -1);
    }
    const group = part.done();
    glowMesh(ctx, soft, ctx.num(o.glow, 1.6, 0, 20) * TROUGH_DIM, group);
    return group;
  }
  if (style === 'flat') {
    part.g(mat).box(w, 0.4, d, 0, 0.2, 0);
    for (let k = 0; k <= bays; k++) {
      const z = -hd + (d * k) / bays;
      wg.box(w, 0.4, 0.5, 0, -0.2, z);
      trim.box(w, 0.03, 0.54, 0, -0.405, z);
    }
    const soft = new HazeWriter(ctx.num(o.hazeColor, 0xf6f0e6));
    for (const s of [-1, 1]) {
      wg.box(0.5, 0.4, d, s * (hw - 0.25), -0.2, 0);
      const lx = s * hw * 0.42;
      wg.box(0.5, 0.12, d - 0.6, lx, -0.06, 0);
      softStrip(soft, lx, -0.125, 0.32, d - 1, -1);
    }
    const group = part.done();
    glowMesh(ctx, soft, ctx.num(o.glow, 1.6, 0, 20) * TROUGH_DIM, group);
    return group;
  }
  // lattice / glass: open grid of beams, optionally glazed
  const nx = Math.max(2, Math.round(w / 5)), nz = Math.max(2, Math.round(d / 5));
  for (let i = 0; i <= nx; i++) {
    const x = -hw + (w * i) / nx;
    wg.box(0.32, 0.55, d, x, 0.27, 0);
    trim.box(0.36, 0.03, d, x, -0.01, 0);
  }
  for (let k = 0; k <= nz; k++) {
    const z = -hd + (d * k) / nz;
    wg.box(w, 0.4, 0.26, 0, 0.3, z);
    trim.box(w, 0.03, 0.3, 0, 0.09, z);
  }
  if (style === 'glass') part.g('glass').box(w, 0.05, d, 0, 0.5, 0);
  return part.done();
}
