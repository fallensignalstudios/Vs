/**
 * Walkable structure: floors, discs, ramps, decks, bridges, rails, blockers — each registers the surfaces and
 * solids that match its visuals (decks get a slab solid, ramps an under-fill, exposed edges rails).
 */
import * as THREE from 'three';
import type { ColliderHandle, DiscOpts, FloorOpts, MatId, RampOpts, RectOpts, SurfaceDesc } from '@/core/api';
import { yawTo } from '@/core/mathx';
import type { V2 } from './geo';
import { familyOf, KitCtx, Part, type Family } from './core';
import { drawInlay, type InlayStyle } from './inlay';

type Side = 'n' | 's' | 'e' | 'w';

/** Extra options accepted by `ZoneBuilder.deck` (documented in api/kit.ts). */
export interface DeckExtras {
  thickness?: number;
  solidBelow?: boolean;
  rails?: Side[];
  inlay?: FloorOpts['inlay'];
  railGaps?: Array<{ side: Side; at: number; width: number }>;
  supports?: boolean;
  base?: number;
}

function surfaceKind(mat: MatId, given?: SurfaceDesc['material']): SurfaceDesc['material'] {
  if (given) return given;
  if (mat === 'frostIce' || mat === 'frostRime') return 'ice';
  if (mat === 'glass') return 'glass';
  if (mat.startsWith('dom') || mat.startsWith('ref') || mat === 'goldDark' || mat === 'goldTrim') return 'metal';
  return 'stone';
}

function defaultInlay(o: { inlay?: FloorOpts['inlay'] }, area: number): InlayStyle {
  return o.inlay ?? (area >= 60 ? 'border' : 'none');
}

export function buildFloor(ctx: KitCtx, o: FloorOpts): THREE.Object3D {
  const w = ctx.num(o.w, 10, 0.2), d = ctx.num(o.d, 10, 0.2), h = ctx.num(o.h, 0), th = ctx.num(o.thickness, 0.5, 0.05);
  const mat = o.mat ?? 'whiteGoldFloor';
  const part = new Part(ctx, 'floor', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h), ctx.yaw(ctx.num(o.yawDeg, 0)));
  part.g(mat, o.reflective ? h : null).tbox(w, th, d, 0.02, 0, -th, 0);
  drawInlay(part, defaultInlay(o, w * d), w / 2, d / 2);
  if (!o.noSurface) {
    ctx.surface({ shape: { kind: 'rect', hx: w / 2, hz: d / 2 }, x: part.pose.x, z: part.pose.z, yaw: part.pose.yaw, y: h, material: surfaceKind(mat, o.surfaceMaterial), tag: 'floor' });
  }
  return part.done();
}

export function buildDisc(ctx: KitCtx, o: DiscOpts): THREE.Object3D {
  const r = ctx.num(o.r, 8, 0.3), inner = ctx.num(o.inner, 0, 0, r - 0.2), h = ctx.num(o.h, 0), th = ctx.num(o.thickness, 0.5, 0.05);
  const mat = o.mat ?? 'whiteGoldFloor';
  const part = new Part(ctx, 'disc', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h));
  const seg = Math.max(32, Math.min(128, Math.round(r * 5)));
  part.g(mat, o.reflective ? h : null).arcBand(inner, r, 0, Math.PI * 2, -th, 0, seg);
  drawInlay(part, defaultInlay(o, Math.PI * r * r), r, r, r);
  if (!o.noSurface) {
    ctx.surface({ shape: { kind: 'disc', r, inner: inner > 0 ? inner : undefined }, x: part.pose.x, z: part.pose.z, y: h, material: surfaceKind(mat), tag: 'disc' });
  }
  if (o.rim) {
    const rh = ctx.num(o.rim.height, 1.1, 0.2, 6), low = rh <= 1.1;
    const gaps = (o.rim.gapsDeg ?? []).map(([a, b]): [number, number] => [((a % 360) + 360) % 360, ((b % 360) + 360) % 360]);
    for (const [a0, a1] of solidArcs(gaps)) {
      const A0 = (a0 * Math.PI) / 180, A1 = (a1 * Math.PI) / 180;
      const n = Math.max(1, Math.ceil(((A1 - A0) * r) / 2.4));
      part.g(familyOf(mat).frame).arcBand(r - 0.26, r, A0, A1, 0, rh - 0.08, n * 2);
      part.g('goldTrim').arcBand(r - 0.3, r + 0.04, A0, A1, rh - 0.08, rh, n * 2);
      part.g(ctx.channel()).arcBand(r - 0.3, r - 0.262, A0 + 0.01, A1 - 0.01, 0.16, 0.21, n * 2, { top: false, ends: false });
      for (let i = 0; i < n; i++) {
        const am = A0 + ((A1 - A0) * (i + 0.5)) / n, chord = 2 * (r - 0.13) * Math.sin((A1 - A0) / n / 2);
        ctx.collider({
          shape: { kind: 'box', hx: chord / 2 + 0.05, hy: rh / 2, hz: 0.14 },
          x: part.pose.x + Math.sin(am) * (r - 0.13), y: h + rh / 2, z: part.pose.z - Math.cos(am) * (r - 0.13), yaw: -am,
          blocksSight: !low, blocksShots: !low, tag: 'rim',
        });
      }
    }
  }
  return part.done();
}

/** complement of a list of [start, end] degree gaps on the circle, as ascending [a0, a1] arcs (a1 may exceed 360) */
export function solidArcs(gaps: Array<[number, number]>): Array<[number, number]> {
  if (!gaps.length) return [[0, 360]];
  const g = gaps.map(([a, b]): [number, number] => (b <= a ? [a, b + 360] : [a, b])).sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < g.length; i++) {
    const end = g[i][1], next = i + 1 < g.length ? g[i + 1][0] : g[0][0] + 360;
    if (next - end > 0.5) out.push([end, next]);
  }
  return out;
}

/** Emit a rail run between two local points of `part` (visual + collider). */
export function railRun(part: Part, ax: number, az: number, bx_: number, bz_: number, y: number, height: number, style: 'ancient' | 'glass', fam: Family = familyOf(undefined)): void {
  const ctx = part.ctx, dx = bx_ - ax, dz = bz_ - az, len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const ry = Math.atan2(-dz, dx);
  const pose = part.frame(ax, y, az, ry);
  const posts = Math.max(1, Math.round(len / 3));
  if (style === 'glass') {
    // polish 3: a dark-stone balustrade framing a CLEAR screen (the overlook paintings: black stone, a gold line,
    // lit posts). The pane is nearly invisible face-on and only glints at grazing angles, so the view beyond keeps
    // its own colour instead of being washed blue by the sky's reflection. Same footprint and collider as before.
    const stone = part.g('blackStone'), trim = part.g('goldTrim');
    const kerb = 0.22, capH = 0.09, capY = height - capH;
    stone.tbox(len, kerb, 0.2, 0.025, len / 2, 0, 0);
    trim.box(len, 0.018, 0.204, len / 2, kerb - 0.035, 0);
    part.g(ctx.variant('glass', { color: 0xffffff, opacity: 0.035, envMapIntensity: 0.4, rim: 0.16 }))
      .box(len, capY - kerb + 0.02, 0.02, len / 2, (kerb + capY) / 2, 0);
    stone.tbox(len, capH, 0.15, 0.03, len / 2, capY, 0);
    trim.box(len, 0.014, 0.154, len / 2, capY + 0.012, 0);
    const lit = part.g(ctx.seam(true));
    for (let i = 0; i <= posts; i++) {
      const px = (len * i) / posts;
      stone.vbox(0.13, height + 0.05, 0.22, 0.025, px, 0, 0);
      trim.boxOn(0.15, 0.025, 0.24, px, height + 0.05, 0);
      // a short warm slot high on each face of the post: the paintings' small lanterns, emissive only
      for (const sd of [-1, 1]) lit.ribbon([[px, height - 0.5, sd * 0.112], [px, height - 0.16, sd * 0.112]], 0.03, [0, 0, sd]);
    }
  } else {
    const body = part.g(fam.frame);
    body.boxOn(len, 0.16, 0.3, len / 2, 0, 0).boxOn(len, height - 0.3, 0.14, len / 2, 0.16, 0);
    body.tbox(len, 0.1, 0.28, 0.03, len / 2, height - 0.1, 0);
    part.g('goldTrim').box(len, 0.04, 0.17, len / 2, height - 0.16, 0);
    for (let i = 0; i <= posts; i++) {
      const px = (len * i) / posts;
      body.vbox(0.3, height + 0.04, 0.34, 0.04, px, 0, 0).tbox(0.36, 0.07, 0.4, 0.03, px, height + 0.06, 0);
      part.g('goldTrim').boxOn(0.32, 0.02, 0.36, px, height + 0.04, 0);
      if (fam.dark) for (const s of [-1, 1]) part.g(ctx.seam(true)).ribbon([[px, 0.22, s * 0.174], [px, height - 0.12, s * 0.174]], 0.05, [0, 0, s]);
    }
  }
  const low = height <= 1.1;
  ctx.collider(pose.box(len / 2, height / 2, 0, len / 2, height / 2, 0.1, { blocksSight: !low && style !== 'glass', blocksShots: !low, tag: 'rail' }));
  part.unframe();
}

export function buildRail(ctx: KitCtx, o: { from: [number, number]; to: [number, number]; h?: number; height?: number; style?: 'ancient' | 'glass'; mat?: MatId }): THREE.Object3D {
  const h = ctx.num(o.h, 0), a = ctx.P(o.from[0], o.from[1], h), b = ctx.P(o.to[0], o.to[1], h);
  const part = new Part(ctx, 'rail', a);
  railRun(part, 0, 0, b.x - a.x, b.z - a.z, 0, ctx.num(o.height, 1.1, 0.3, 6), o.style === 'glass' ? 'glass' : 'ancient', familyOf(o.mat));
  return part.done();
}

export function buildRamp(ctx: KitCtx, o: RampOpts): THREE.Object3D {
  const w = ctx.num(o.w, 4, 0.5), d = ctx.num(o.d, 10, 0.5), h0 = ctx.num(o.h0, 0), h1 = ctx.num(o.h1, 3);
  const base = Math.min(h0, h1), a = h0 - base, b = h1 - base;
  const part = new Part(ctx, 'ramp', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), base), ctx.yaw(ctx.num(o.yawDeg, 0)));
  const hw = w / 2, hd = d / 2, top = o.mat ?? 'whiteGoldFloor', fam = familyOf(top);
  // low end at +Z (local south), high end at −Z (local north)
  part.g(top).quad([-hw, a, hd], [hw, a, hd], [hw, b, -hd], [-hw, b, -hd]);
  const body = part.g(fam.panel);
  const corners: V2[] = [[hd, 0], [hd, a], [-hd, b], [-hd, 0]];
  const side = corners.filter((p, i, arr) => i === 0 || p[1] !== arr[i - 1][1] || p[0] !== arr[i - 1][0]);
  if (side.length >= 3) for (const s of [-1, 1]) body.prismX(side, 0.02, s * (hw - 0.01));
  if (b > 0.01) body.quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, b, -hd], [hw, b, -hd]);
  if (a > 0.01) body.quad([-hw, 0, hd], [hw, 0, hd], [hw, a, hd], [-hw, a, hd]);
  // kerbs with a gold line and a guide light on the inside
  const slope = (y: number): V2[] => [[hd, a + y], [hd, a + y + 0.12], [-hd, b + y + 0.12], [-hd, b + y]];
  for (const s of [-1, 1]) {
    part.g(fam.frame).prismX(slope(0), 0.16, s * (hw - 0.08));
    part.g(ctx.inlay('goldTrim')).ribbon([[s * (hw - 0.08), a + 0.126, hd], [s * (hw - 0.08), b + 0.126, -hd]], 0.05, [0, 1, 0]);
    part.g(ctx.channel()).ribbon([[s * (hw - 0.24), a + 0.008, hd - 0.15], [s * (hw - 0.24), b + 0.008, -hd + 0.15]], 0.05, [0, 1, 0]);
  }
  const railH = 1.1;
  if (o.rails) {
    for (const s of [-1, 1]) {
      part.g(fam.frame).prismX([[hd, a + 0.12], [hd, a + railH - 0.08], [-hd, b + railH - 0.08], [-hd, b + 0.12]], 0.14, s * (hw - 0.08));
      part.g('goldTrim').prismX([[hd, a + railH - 0.08], [hd, a + railH], [-hd, b + railH], [-hd, b + railH - 0.08]], 0.2, s * (hw - 0.08));
    }
  }
  ctx.surface({ shape: { kind: 'rect', hx: hw, hz: hd }, x: part.pose.x, z: part.pose.z, yaw: part.pose.yaw, y: h1, y1: h0, material: surfaceKind(top), tag: 'ramp' });
  // under-fill (stepped, never above the walking surface) + stepped rail solids
  const steps = Math.max(2, Math.round(d / 2));
  for (let i = 0; i < steps; i++) {
    const z0 = hd - (d * i) / steps, z1 = hd - (d * (i + 1)) / steps;
    const ya = a + ((b - a) * i) / steps, yb = a + ((b - a) * (i + 1)) / steps, lo = Math.min(ya, yb), hi = Math.max(ya, yb);
    if (lo >= 0.3) ctx.collider(part.pose.box(0, lo / 2, (z0 + z1) / 2, hw, lo / 2, Math.abs(z0 - z1) / 2, { tag: 'ramp-fill' }));
    if (o.rails) {
      for (const s of [-1, 1]) {
        ctx.collider(part.pose.box(s * (hw - 0.08), (lo + hi + railH) / 2, (z0 + z1) / 2, 0.1, (hi + railH - lo) / 2, Math.abs(z0 - z1) / 2, { blocksSight: false, blocksShots: false, tag: 'rail' }));
      }
    }
  }
  return part.done();
}

export function buildDeck(ctx: KitCtx, o: RectOpts & DeckExtras): THREE.Object3D {
  const w = ctx.num(o.w, 8, 0.5), d = ctx.num(o.d, 8, 0.5), h = ctx.num(o.h, 3), th = ctx.num(o.thickness, 0.4, 0.1, 2);
  const base = Math.min(ctx.num(o.base, 0), h - th), drop = h - base;
  const mat = o.mat ?? 'whiteGoldFloor', hw = w / 2, hd = d / 2, fam = familyOf(mat);
  const part = new Part(ctx, 'deck', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h), ctx.yaw(ctx.num(o.yawDeg, 0)));
  part.g(mat).tbox(w, th, d, 0.02, 0, -th, 0);
  // fascia band, gold line, warm under-lip strip
  const fy = -th - 0.12, fh = th + 0.08;
  for (const s of [-1, 1]) {
    part.g(fam.frame).box(w + 0.12, fh, 0.08, 0, fy + fh / 2, s * (hd + 0.02)).box(0.08, fh, d + 0.12, s * (hw + 0.02), fy + fh / 2, 0);
    part.g('goldTrim').box(w + 0.16, 0.045, 0.1, 0, -0.14, s * (hd + 0.02)).box(0.1, 0.045, d + 0.16, s * (hw + 0.02), -0.14, 0);
    if (!o.solidBelow) {
      part.g(ctx.seam(fam.dark)).quadFacing([-hw + 0.3, fy - 0.004, s * (hd - 0.22)], [hw - 0.3, fy - 0.004, s * (hd - 0.22)], [hw - 0.3, fy - 0.004, s * (hd - 0.1)], [-hw + 0.3, fy - 0.004, s * (hd - 0.1)], [0, -1, 0]);
    }
  }
  if (o.solidBelow) {
    part.g(fam.panel).box(w - 0.04, drop - th, d - 0.04, 0, -th - (drop - th) / 2, 0, true);
    part.g(fam.frame).boxOn(w + 0.1, 0.3, d + 0.1, 0, -drop, 0);
    part.g('goldTrim').boxOn(w + 0.12, 0.035, d + 0.12, 0, -drop + 0.3, 0);
    ctx.collider(part.pose.box(0, -drop / 2, 0, hw, drop / 2, hd, { tag: 'deck-block' }));
  } else {
    part.g(mat).quad([-hw, -th, -hd], [hw, -th, -hd], [hw, -th, hd], [-hw, -th, hd]);
    ctx.collider(part.pose.box(0, -th / 2, 0, hw, th / 2, hd, { tag: 'deck-slab' }));
    if (o.supports !== false && drop - th > 1.5) {
      const nx = Math.max(2, Math.round(w / 10) + 1), nz = Math.max(2, Math.round(d / 10) + 1), sh = drop - th;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
        const px = nx === 1 ? 0 : -hw + 0.8 + ((w - 1.6) * i) / (nx - 1), pz = nz === 1 ? 0 : -hd + 0.8 + ((d - 1.6) * j) / (nz - 1);
        part.g(fam.frame).vbox(0.62, sh - 0.4, 0.62, 0.08, px, -drop, pz).taperOn(0.62, 0.62, 1.05, 1.05, 0.4, px, -th - 0.4, pz, true);
        part.g(fam.frame).tbox(0.9, 0.28, 0.9, 0.06, px, -drop, pz);
        part.g('goldTrim').boxOn(0.66, 0.05, 0.66, px, -th - 0.48, pz);
        ctx.collider(part.pose.cyl(px, -th - sh / 2, pz, 0.42, sh / 2, { tag: 'support' }));
      }
    }
  }
  drawInlay(part, defaultInlay(o, w * d), hw, hd);
  // rails with gaps
  for (const side of o.rails ?? []) {
    const along = side === 'n' || side === 's' ? w : d;
    const gaps = (o.railGaps ?? []).filter((g) => g.side === side).map((g): [number, number] => [g.at - g.width / 2, g.at + g.width / 2]).sort((p, q) => p[0] - q[0]);
    let t = 0;
    const runs: Array<[number, number]> = [];
    for (const [g0, g1] of gaps) { if (g0 - t > 0.3) runs.push([t, g0]); t = Math.max(t, g1); }
    if (along - t > 0.3) runs.push([t, along]);
    for (const [r0, r1] of runs) {
      // distances run from the west end (n / s sides) or the south end (e / w sides)
      if (side === 'n' || side === 's') { const z = side === 'n' ? -hd + 0.17 : hd - 0.17; railRun(part, -hw + r0, z, -hw + r1, z, 0, 1.1, 'ancient', fam); }
      else { const x = side === 'e' ? hw - 0.17 : -hw + 0.17; railRun(part, x, hd - r0, x, hd - r1, 0, 1.1, 'ancient', fam); }
    }
  }
  ctx.surface({ shape: { kind: 'rect', hx: hw, hz: hd }, x: part.pose.x, z: part.pose.z, yaw: part.pose.yaw, y: h, material: surfaceKind(mat), tag: 'deck' });
  return part.done();
}

export function buildBridge(ctx: KitCtx, o: { from: [number, number]; to: [number, number]; h?: number; width?: number; mat?: MatId; broken?: 'none' | 'far' | 'mid' }): THREE.Object3D {
  const h = ctx.num(o.h, 0), width = ctx.num(o.width, 4, 1), a = ctx.P(o.from[0], o.from[1], h), b = ctx.P(o.to[0], o.to[1], h);
  const L = Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z)), yaw = yawTo(a.x, a.z, b.x, b.z), mat = o.mat ?? 'whiteGoldFloor';
  const part = new Part(ctx, 'bridge', a, yaw);
  const spans: Array<[number, number, boolean, boolean]> = o.broken === 'far' ? [[0, L * 0.62, false, true]]
    : o.broken === 'mid' ? [[0, L * 0.4, false, true], [L * 0.6, L, true, false]] : [[0, L, false, false]];
  const hw = width / 2, fam = familyOf(mat);
  for (const [s0, s1, jagStart, jagEnd] of spans) {
    const len = s1 - s0, zc = -(s0 + s1) / 2;
    part.g(mat).tbox(width, 0.35, len, 0.02, 0, -0.35, zc);
    for (const s of [-1, 1]) {
      part.g(fam.frame).box(0.34, 0.75, len, s * (hw - 0.17), -0.72, zc);
      part.g('goldTrim').box(0.05, 0.05, len, s * (hw + 0.005), -0.2, zc);
      part.g(ctx.channel()).ribbon([[s * (hw - 0.5), 0.006, -s0 - 0.1], [s * (hw - 0.5), 0.006, -s1 + 0.1]], 0.05);
      railRun(part, s * (hw - 0.17), -s0, s * (hw - 0.17), -s1, 0, 1.1, 'ancient', fam);
    }
    for (let z = s0 + 1.5; z < s1 - 0.5; z += 3) part.g(fam.frame).box(width - 0.7, 0.4, 0.3, 0, -0.55, -z);
    for (const [jag, z] of [[jagStart, s0], [jagEnd, s1]] as const) {
      if (!jag) continue;
      for (let i = 0; i < 6; i++) {
        const cw = 0.4 + ctx.rand() * 0.8;
        part.g(i % 2 ? 'rubble' : fam.frame).chunk(cw, 0.2 + ctx.rand() * 0.3, 0.5 + ctx.rand() * 1.1, 0.5, ctx.rand, -hw + 0.4 + (width - 0.8) * ctx.rand(), -0.2, -z);
      }
    }
    ctx.surface({ shape: { kind: 'rect', hx: hw, hz: len / 2 }, x: part.pose.wx(0, zc), z: part.pose.wz(0, zc), yaw, y: h, material: surfaceKind(mat), tag: 'bridge' });
    ctx.collider(part.pose.box(0, -0.4, zc, hw, 0.4, len / 2, { tag: 'bridge-slab' }));
  }
  return part.done();
}

export function buildBlocker(ctx: KitCtx, o: RectOpts & { height?: number }): ColliderHandle {
  const w = ctx.num(o.w, 2, 0.05), d = ctx.num(o.d, 2, 0.05), h = ctx.num(o.h, 0), height = ctx.num(o.height, 4, 0.2);
  const p = ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h);
  return ctx.collider({
    shape: { kind: 'box', hx: w / 2, hy: height / 2, hz: d / 2 }, x: p.x, y: h + height / 2, z: p.z, yaw: ctx.yaw(ctx.num(o.yawDeg, 0)),
    blocksSight: false, blocksShots: false, tag: 'blocker',
  });
}
