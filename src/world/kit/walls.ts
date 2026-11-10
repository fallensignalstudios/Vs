/**
 * Walls, ring walls and ceilings — King-era surfaces with skirting, cornice, pilasters, conduits and glass.
 * A wall segment's local frame: +X runs from `from` to `to`, Y up from the base height, Z across the thickness.
 */
import * as THREE from 'three';
import type { MatId, RectOpts, WallOpts } from '@/core/api';
import { familyOf, KitCtx, Part } from './core';
import { solidArcs } from './structure';

type Style = NonNullable<WallOpts['style']>;

interface SegOpts {
  height: number;
  thickness: number;
  mat: MatId;
  style: Style;
  doors: Array<{ at: number; width: number; height: number }>;
  noCollider: boolean;
  /** extension past each end so corners close (m) */
  ext0: number;
  ext1: number;
  /** ribbed walls: put pilasters only at the segment start (ring walls) */
  jointPilasters?: boolean;
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
  const body = part.g(o.mat), wg = part.g(fam.frame), trim = part.g('goldTrim');
  const cornice = H >= 3;
  for (const [a, b] of spans) {
    const len = b - a, cx = (a + b) / 2;
    if (glass) {
      wg.boxOn(len, 0.28, t, cx, 0, 0).box(len, 0.3, t, cx, H - 0.15, 0);
      trim.box(len, 0.035, t + 0.03, cx, 0.3, 0).box(len, 0.035, t + 0.03, cx, H - 0.32, 0);
      part.g('glass').box(len, H - 0.58, 0.05, cx, H / 2 - 0.01, 0);
      const n = Math.max(1, Math.round(len / 3));
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
        // black stone reads through light: a gold channel outlines the wall where it meets floor and cornice
        for (const s of [-1, 1]) {
          const z = s * (t / 2 + 0.004), up: [number, number, number] = [0, 0, s];
          part.g(ctx.seam(true)).ribbon([[a + 0.05, 0.62, z], [b - 0.05, 0.62, z]], 0.045, up);
          if (cornice) part.g(ctx.seam(true)).ribbon([[a + 0.05, H - 0.42, z], [b - 0.05, H - 0.42, z]], 0.045, up);
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
          part.g(ctx.seam(fam.dark)).ribbon([[px, 0.86, z], [px, ph - 0.75, z]], 0.07, up);
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
        part.g(ctx.seam(fam.dark)).ribbon([[px, 1.95, s * (t / 2 + 0.012)], [px, top - 0.35, s * (t / 2 + 0.012)]], 0.06, [0, 0, s]);
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

function segOpts(ctx: KitCtx, o: Omit<WallOpts, 'from' | 'to'>, ext0: number, ext1: number): SegOpts {
  const style: Style = o.style === 'ribbed' || o.style === 'panelled' || o.style === 'conduit' || o.style === 'glass' ? o.style : 'plain';
  return {
    height: ctx.num(o.height, 8, 0.3), thickness: ctx.num(o.thickness, 0.6, 0.1, 4), mat: o.mat ?? 'whiteGoldPanel', style,
    doors: (o.doors ?? []).map((d) => ({ at: ctx.num(d.at, 0), width: ctx.num(d.width, 3, 0), height: ctx.num(d.height, 3.5, 0.5) })),
    noCollider: !!o.noCollider, ext0, ext1,
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

export function buildRingWall(ctx: KitCtx, o: { x: number; n: number; r: number; h?: number; height?: number; mat?: MatId; gapsDeg?: Array<[number, number]>; segments?: number; style?: WallOpts['style']; noCollider?: boolean; thickness?: number }): THREE.Object3D {
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

export function buildCeiling(ctx: KitCtx, o: RectOpts & { style?: 'vault' | 'flat' | 'lattice' | 'glass' }): THREE.Object3D {
  const w0 = ctx.num(o.w, 20, 1), d0 = ctx.num(o.d, 20, 1), h = ctx.num(o.h, 8);
  // author along the longer side: local Z = long axis
  const turn = w0 > d0, w = turn ? d0 : w0, d = turn ? w0 : d0;
  const part = new Part(ctx, 'ceiling', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h), ctx.yaw(ctx.num(o.yawDeg, 0)) + (turn ? Math.PI / 2 : 0));
  const mat = o.mat ?? 'whiteGoldPanel', hw = w / 2, hd = d / 2;
  const style = o.style ?? 'flat';
  const wg = part.g(familyOf(o.mat).frame), trim = part.g('goldTrim'), light = part.g('whiteLight');
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
    // apex light seam + springing strips
    light.quadFacing([-0.22, rise - 0.03, -hd + 0.4], [0.22, rise - 0.03, -hd + 0.4], [0.22, rise - 0.03, hd - 0.4], [-0.22, rise - 0.03, hd - 0.4], [0, -1, 0]);
    for (const s of [-1, 1]) {
      wg.box(0.5, 0.4, d, s * (hw - 0.2), 0.1, 0);
      light.quadFacing([s * (hw - 0.4), -0.105, -hd + 0.4], [s * (hw - 0.12), -0.105, -hd + 0.4], [s * (hw - 0.12), -0.105, hd - 0.4], [s * (hw - 0.4), -0.105, hd - 0.4], [0, -1, 0]);
    }
    return part.done();
  }
  if (style === 'flat') {
    part.g(mat).box(w, 0.4, d, 0, 0.2, 0);
    for (let k = 0; k <= bays; k++) {
      const z = -hd + (d * k) / bays;
      wg.box(w, 0.4, 0.5, 0, -0.2, z);
      trim.box(w, 0.03, 0.54, 0, -0.405, z);
    }
    for (const s of [-1, 1]) {
      wg.box(0.5, 0.4, d, s * (hw - 0.25), -0.2, 0);
      const lx = s * hw * 0.42;
      wg.box(0.5, 0.12, d - 0.6, lx, -0.06, 0);
      light.quadFacing([lx - 0.16, -0.125, -hd + 0.5], [lx + 0.16, -0.125, -hd + 0.5], [lx + 0.16, -0.125, hd - 0.5], [lx - 0.16, -0.125, hd - 0.5], [0, -1, 0]);
    }
    return part.done();
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
