/**
 * Signature King-era architecture: the immense curved white-gold ribs and the columns.
 * A rib's local frame: the arch spans local X (feet at ±span/2), rises along Y, its depth runs along Z.
 */
import * as THREE from 'three';
import type { MatId, RibOpts } from '@/core/api';
import type { SweepFrame, V2, V3 } from './geo';
import { bx, bz } from './geo';
import { familyOf, KitCtx, localRand, Part, type PartTemplate } from './core';

type RibStyle = NonNullable<RibOpts['style']>;

/** Point on the arch: s = 0 left foot → 0.5 apex → 1 right foot. A super-ellipse: legs rise almost straight. */
function archPoint(s: number, a: number, b: number): [number, number] {
  const t = Math.PI * (1 - s), k = 2 / 2.6;
  const c = Math.cos(t), sn = Math.sin(t);
  return [a * Math.sign(c) * Math.pow(Math.abs(c), k), b * Math.pow(Math.max(0, sn), k)];
}

function archFrames(a: number, b: number, s0: number, s1: number, n: number, taper: number): SweepFrame[] {
  const out: SweepFrame[] = [];
  for (let i = 0; i <= n; i++) {
    // denser sampling near the feet where the super-ellipse turns fastest in parameter space
    const s = s0 + (s1 - s0) * (i / n);
    const p = archPoint(s, a, b), e = 1e-3;
    const p0 = archPoint(Math.max(0, s - e), a, b), p1 = archPoint(Math.min(1, s + e), a, b);
    let tx = p1[0] - p0[0], ty = p1[1] - p0[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    // outward normal in the arch plane (away from the arch's interior)
    let ux = ty, uy = -tx;
    if (ux * p[0] + uy * (p[1] - b * 0.3) < 0) { ux = -ux; uy = -uy; }
    const k = 1 - (1 - taper) * Math.pow(Math.sin(Math.PI * s), 1.4);
    out.push({ p: [p[0], p[1], 0], u: [ux, uy, 0], v: [0, 0, 1], su: k, sv: 0.82 + 0.18 * k });
  }
  return out;
}

function ribProfile(T: number, D: number): V2[] {
  // u = radial (outward +), v = along the hall. Broad outer flange narrowing to an inner keel.
  return [[T / 2, -D / 2], [T / 2, D / 2], [T * 0.12, D / 2], [-T / 2, D * 0.26], [-T / 2, -D * 0.26], [T * 0.12, -D / 2]];
}

interface RibDims { span: number; height: number; depth: number; leg: number }

function emitRib(part: Part, d: RibDims, style: RibStyle, lit: boolean, mat: MatId): void {
  const ctx = part.ctx, a = d.span / 2, b = d.height, T = d.leg, D = d.depth;
  const body = part.g(mat), trim = part.g('goldTrim'), dark = familyOf(mat).dark;
  const prof = ribProfile(T, D);
  const trimProf = (s: number): V2[] => [[T * 0.12 - 0.04, s * (D / 2)], [T * 0.12 + 0.04, s * (D / 2)], [T * 0.12 + 0.04, s * (D / 2 + 0.03)], [T * 0.12 - 0.04, s * (D / 2 + 0.03)]];
  // the light seam stands 4 cm proud of the inner keel and is swept on the SAME frames as the body, so it can
  // never sink into the faceted arch
  const seam: V2[] = [[-T / 2 - 0.04, -0.055], [-T / 2 - 0.04, 0.055], [-T / 2 + 0.01, 0.055], [-T / 2 + 0.01, -0.055]];
  const N = 32;
  const all = archFrames(a, b, 0, 1, N, 0.52);
  // fractured ends (polish 3): the section stays FULL where the rib broke — no pinching to a point. The last frame
  // shears a little; the break itself is a ragged face of blocky fragments standing proud of the cut.
  // (The zone stream `ctx.rand` is drawn exactly as before — five per sheared frame — the fragments use a
  // private stream seeded from those draws.)
  const breaks: Array<{ f: SweepFrame; prev: SweepFrame; seed: number[] }> = [];
  const jagged = (fr: SweepFrame[]): SweepFrame[] => {
    const seed: number[] = [];
    for (let i = 1; i <= 2; i++) {
      const f = fr[fr.length - i];
      const a = ctx.rand(), b = ctx.rand(), dx = ctx.rand(), dy = ctx.rand(), dz = ctx.rand();
      seed.push(a, b, dx);
      // barely thinner (the outer skin spalled off), sheared across the cut
      const k = i === 1 ? 0.9 : 0.97;
      f.su = (f.su ?? 1) * (k + a * 0.08); f.sv = (f.sv ?? 1) * (k + b * 0.06);
      f.p = [f.p[0] + (dx - 0.5) * 0.18 * (i === 1 ? 1 : 0.4), f.p[1] + (dy - 0.5) * 0.18 * (i === 1 ? 1 : 0.4), (dz - 0.5) * 0.12];
    }
    breaks.push({ f: fr[fr.length - 1], prev: fr[fr.length - 2], seed });
    return fr;
  };
  const fracture = (): void => {
    for (const { f, prev, seed } of breaks) {
      const lr = localRand(...seed);
      // tangent out of the break (from the previous frame to the last), section axes u (radial) and v (depth)
      const tx = f.p[0] - prev.p[0], ty = f.p[1] - prev.p[1], tz = f.p[2] - prev.p[2], tl = Math.hypot(tx, ty, tz) || 1;
      const t: V3 = [tx / tl, ty / tl, tz / tl];
      const su = (f.su ?? 1) * T, sv = (f.sv ?? 1) * D;
      const pieces = 5 + Math.floor(lr() * 3);
      for (let i = 0; i < pieces; i++) {
        const u = (lr() - 0.5) * su * 0.8, v = (lr() - 0.5) * sv * 0.8, out = (lr() - 0.2) * Math.min(T, D) * 0.45;
        const px = f.p[0] + f.u[0] * u + f.v[0] * v + t[0] * out;
        const py = f.p[1] + f.u[1] * u + f.v[1] * v + t[1] * out;
        const pz = f.p[2] + f.u[2] * u + f.v[2] * v + t[2] * out;
        const sz = Math.min(T, D) * (0.25 + lr() * 0.3);
        part.g(i % 3 === 2 ? 'goldDark' : mat).push().move(px, py, pz).rotY(lr() * 6.28).rotX((lr() - 0.5) * 1.2).rotZ((lr() - 0.5) * 1.2)
          .chunk(sz * 1.3, sz, sz * 1.1, 0.4, lr).pop();
      }
    }
  };
  // collars: every fourth segment is a slightly heavier band with a gold edge — the rib reads as built from
  // segments, which gives the eye a unit to measure its size by
  const collar = prof.map((q): V2 => [q[0] > 0 ? q[0] + 0.07 : q[0] * 1.02, q[1] * 1.09]);
  const collarEdge: V2[] = [[T / 2 + 0.07, -D * 0.545], [T / 2 + 0.1, -D * 0.545], [T / 2 + 0.1, D * 0.545], [T / 2 + 0.07, D * 0.545]];
  const run = (fr: SweepFrame[], capEnd: boolean): void => {
    body.sweep(prof, fr, false, capEnd);
    for (const s of [-1, 1]) trim.sweep(trimProf(s), fr, false, false);
    for (let i = 3; i + 2 < fr.length; i += 4) {
      const a0 = fr[i], a1 = fr[i + 1];
      // a quarter-segment band centred on the joint between two segments
      const mix = (t: number): SweepFrame => ({
        p: [a0.p[0] + (a1.p[0] - a0.p[0]) * t, a0.p[1] + (a1.p[1] - a0.p[1]) * t, a0.p[2] + (a1.p[2] - a0.p[2]) * t],
        u: a0.u, v: a0.v, su: (a0.su ?? 1) + ((a1.su ?? 1) - (a0.su ?? 1)) * t, sv: (a0.sv ?? 1) + ((a1.sv ?? 1) - (a0.sv ?? 1)) * t,
      });
      const band = [mix(0.3), mix(0.7)];
      body.sweep(collar, band, true, true);
      trim.sweep(collarEdge, band, true, true);
    }
  };
  const foot = (x: number): void => {
    part.g(mat).cboxOn(T * 1.5, 0.62, D * 1.22, 0.09, x, 0, 0);
    trim.boxOn(T * 1.53, 0.05, D * 1.25, x, 0.66, 0);
    part.g('goldDark').boxOn(T * 1.2, 0.2, D * 1.05, x, 0.71, 0);
  };
  const seamRun = (i0: number, i1: number): void => {
    if (lit && i1 - i0 >= 1) part.g(ctx.seam(dark)).sweep(seam, all.slice(i0, i1 + 1), true, true);
  };

  if (style === 'half') {
    run(all.slice(0, N / 2 + 1), true);
    foot(-a);
    seamRun(2, N / 2 - 1);
  } else if (style === 'broken') {
    const cut = Math.round(N * (0.56 + ctx.rand() * 0.1));
    const fr = jagged(all.slice(0, cut + 1).map((f) => ({ ...f })));
    run(fr, true);
    run(jagged(all.slice(N - 3).reverse().map((f) => ({ ...f }))), true);
    fracture();
    foot(-a); foot(a);
    seamRun(2, cut - 3);
    // rubble under the break
    const end = fr[fr.length - 1].p;
    for (let i = 0; i < 9; i++) {
      const r = 0.5 + ctx.rand() * Math.min(3, a * 0.4), ang = ctx.rand() * Math.PI * 2, sz = 0.25 + ctx.rand() * 0.55;
      part.g(i % 3 === 0 ? mat : 'rubble').push().move(end[0] + Math.cos(ang) * r, sz * 0.2, Math.sin(ang) * r * 0.7).rotY(ctx.rand() * 3).rotX((ctx.rand() - 0.5) * 0.5)
        .chunk(sz * 1.6, Math.min(0.4, sz * 0.6), sz, 0.45, ctx.rand).pop();
    }
  } else {
    run(all, false);
    foot(-a); foot(a);
    seamRun(2, N - 2);
    if (style === 'frozen') {
      // rime shell over the crown and icicles under it
      const shell = prof.map((q): V2 => [q[0] * 1.07 + 0.02, q[1] * 1.08]);
      part.g('frostRime').sweep(shell, all.slice(Math.round(N * 0.24), Math.round(N * 0.76) + 1), true, true);
      for (let i = 0; i < 16; i++) {
        const s = 0.26 + ctx.rand() * 0.48, p = archPoint(s, a, b), len = 0.5 + ctx.rand() * Math.min(2.4, b * 0.16);
        const k = 1 - 0.48 * Math.pow(Math.sin(Math.PI * s), 1.4);
        part.g('frostIce').band(0.05 + ctx.rand() * 0.09, p[1] - (T / 2) * k * 0.6, 0, p[1] - (T / 2) * k * 0.6 - len, 5, p[0] * (1 - 0.02), (ctx.rand() - 0.5) * D * 0.5);
      }
    }
  }
}

function ribDims(ctx: KitCtx, o: RibOpts): RibDims {
  const span = ctx.num(o.span, 20, 2), height = ctx.num(o.height, 14, 2);
  return { span, height, depth: ctx.num(o.depth, Math.max(0.9, span * 0.06), 0.3), leg: ctx.num(o.leg, Math.max(0.9, Math.min(2.6, span * 0.075)), 0.3) };
}

function ribColliders(part: Part, d: RibDims, style: RibStyle): void {
  const hy = Math.min(d.height * 0.45, 3.2), feet = style === 'half' ? [-1] : [-1, 1];
  for (const s of feet) part.ctx.collider(part.pose.box(s * (d.span / 2), hy, 0, d.leg * 0.72, hy, d.depth * 0.6, { tag: 'rib-leg' }));
}

export function buildRib(ctx: KitCtx, o: RibOpts): THREE.Object3D {
  const d = ribDims(ctx, o), style: RibStyle = o.style ?? 'arch';
  const part = new Part(ctx, 'rib', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0)), ctx.yaw(ctx.num(o.yawDeg, 0)));
  emitRib(part, d, style, o.lit !== false, o.mat ?? 'whiteGold');
  if (!o.noCollider) ribColliders(part, d, style);
  return part.done();
}

export function buildRibRow(ctx: KitCtx, o: RibOpts & { count: number; spacing: number; alongDeg?: number }): THREE.Object3D {
  const d = ribDims(ctx, o), style: RibStyle = o.style ?? 'arch';
  const count = Math.round(ctx.num(o.count, 4, 1, 64)), spacing = ctx.num(o.spacing, 8, 0.5);
  const yawDeg = ctx.num(o.yawDeg, 0), along = (ctx.num(o.alongDeg, yawDeg) * Math.PI) / 180, h = ctx.num(o.h, 0);
  const row = new THREE.Group();
  row.name = 'ribRow';
  ctx.root.add(row);
  let tpl: PartTemplate | null = null;
  for (let i = 0; i < count; i++) {
    const part = new Part(ctx, 'rib', ctx.P(ctx.num(o.x, 0) + Math.sin(along) * spacing * i, ctx.num(o.n, 0) + Math.cos(along) * spacing * i, h), ctx.yaw(yawDeg));
    if (!o.noCollider) ribColliders(part, d, style);
    if (style === 'broken') {
      // every broken rib fractures differently
      emitRib(part, d, style, o.lit !== false, o.mat ?? 'whiteGold');
      part.done(row);
      continue;
    }
    if (!tpl) {
      const proto = new Part(ctx, 'rib-proto', new THREE.Vector3());
      emitRib(proto, d, style, o.lit !== false, o.mat ?? 'whiteGold');
      tpl = proto.template();
    }
    part.place(tpl, row);
  }
  return row;
}

export function buildColumn(ctx: KitCtx, o: { x: number; n: number; h?: number; r?: number; height?: number; mat?: MatId; style?: 'round' | 'faceted' | 'pylon'; lit?: boolean }): THREE.Object3D {
  const r = ctx.num(o.r, 0.6, 0.15, 6), H = ctx.num(o.height, 8, 1), style = o.style ?? 'round';
  const mat = o.mat ?? 'whiteGold', dark = mat === 'blackStone' || mat === 'blackStoneFloor';
  const part = new Part(ctx, 'column', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0)));
  const body = part.g(mat), trim = part.g('goldTrim');
  const glow = ctx.seam(dark);
  if (style === 'pylon') {
    const w = r * 2;
    body.tbox(w * 1.35, 0.45, w * 1.35, 0.08, 0, 0, 0).taperOn(w, w, w * 0.74, w * 0.74, H - 0.75, 0, 0.45, 0, true);
    trim.boxOn(w * 1.05, 0.05, w * 1.05, 0, 0.45, 0).taperOn(w * 0.8, w * 0.8, w * 0.3, w * 0.3, 0.3, 0, H - 0.3, 0);
    if (o.lit !== false) {
      for (let i = 0; i < 4; i++) {
        const an = (i * Math.PI) / 2, k0 = 0.5 - 0.004, k1 = 0.37 + 0.004;
        const y0 = 0.9, y1 = H - 0.7, f = (y: number): number => (w * (k0 + ((k1 - k0) * (y - 0.45)) / (H - 0.75))) + 0.004;
        const p0: V3 = [bx(an) * f(y0), y0, bz(an) * f(y0)], p1: V3 = [bx(an) * f(y1), y1, bz(an) * f(y1)];
        part.g(glow).ribbon([p0, p1], 0.06, [bx(an), 0.02, bz(an)]);
      }
    }
    ctx.collider(part.pose.box(0, H / 2, 0, r * 1.05, H / 2, r * 1.05, { tag: 'column' }));
    return part.done();
  }
  const seg = style === 'faceted' ? 8 : 18, smooth = style !== 'faceted';
  body.tbox(r * 2.7, 0.3, r * 2.7, 0.05, 0, 0, 0);
  body.lathe([[r * 1.25, 0.3], [r * 1.25, 0.46], [r * 1.05, 0.62], [r, 0.7], [r * 0.86, H - 1.0], [r * 0.9, H - 0.9], [r * 1.38, H - 0.34]], seg, 0, 0, 0, smooth);
  body.boxOn(r * 3, 0.34, r * 3, 0, H - 0.34, 0);
  trim.band(r * 1.08, 0.6, r * 1.04, 0.72, seg, 0, 0, smooth).band(r * 0.9, H - 1.06, r * 0.93, H - 0.92, seg, 0, 0, smooth);
  trim.box(r * 3.04, 0.04, r * 3.04, 0, H - 0.36, 0);
  if (o.lit) {
    for (let i = 0; i < 4; i++) {
      const an = (i * Math.PI) / 2 + (style === 'faceted' ? Math.PI / 8 : 0), k = style === 'faceted' ? Math.cos(Math.PI / 8) : 1;
      const ra = (r * 0.985 + 0.004) * k, rb = (r * 0.875 + 0.004) * k;
      part.g(glow).ribbon([[bx(an) * ra, 1.2, bz(an) * ra], [bx(an) * rb, H - 1.4, bz(an) * rb]], 0.06, [bx(an), 0.02, bz(an)]);
    }
  }
  ctx.collider(part.pose.cyl(0, H / 2, 0, r * 1.1, H / 2, { tag: 'column' }));
  return part.done();
}
