/**
 * Dressing with meaning: gold channels, conduit runs, the white-point landmark, frozen atmosphere, corruption.
 */
import * as THREE from 'three';
import type { CrystalOpts, RectOpts } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { RENDER_LAYERS } from '@/core/api/render';
import type { Geo, V2, V3 } from './geo';
import { filletPath } from './geo';
import { KitCtx, LINE_WIDTH, Part, localRand } from './core';
import { buildCrystals } from './crystal';

export interface ChannelOpts { h?: number; width?: number; color?: number; intensity?: number; pulse?: boolean; vertical?: boolean; glow?: boolean }

export function buildChannel(ctx: KitCtx, points: Array<[number, number]>, o: ChannelOpts = {}): THREE.Object3D {
  const h = ctx.num(o.h, 0);
  const pts = (points ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const part = new Part(ctx, 'channel', new THREE.Vector3());
  if (pts.length < 2) { ctx.warn('channel-pts', 'channel(): needs at least two points — skipped'); return part.done(); }
  // polish 4: a fine, non-glowing inlaid gold line unless the zone opts in to light (`glow: true`, or `pulse: true`)
  if (!(o.glow ?? o.pulse === true)) {
    const w = ctx.num(o.width, 0.034, 0.016, 2) * 0.65;
    const path = pts.map((p): V3 => [p[0], h + (o.vertical ? 0 : 0.007), -p[1]]);
    if (o.vertical) {
      const a = path[0], b = path[path.length - 1], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      part.g(ctx.goldLine()).ribbon(path, Math.max(0.018, w), [-dz / l, 0, dx / l], false, true);
    } else {
      part.g(ctx.goldLine()).ribbon(path, Math.max(0.02, w));
    }
    return part.done();
  }
  const width = ctx.num(o.width, 0.055, 0.04, 2);
  const over: Record<string, unknown> = {};
  if (o.color !== undefined) over.emissive = o.color;
  if (o.intensity !== undefined) over.emissiveIntensity = ctx.num(o.intensity, 3, 0, 40);
  if (o.pulse === false) over.pulse = 0;
  // no overrides = the kit's floor channel (intensity 1.9); either way the strip fades by its own width far away
  if (!Object.keys(over).length) over.emissiveIntensity = 1.9;
  over.lineWidth = width;
  const mat = width === LINE_WIDTH && Object.keys(over).length === 2 && over.emissiveIntensity === 1.9 ? ctx.channel() : ctx.inlay('goldChannel', over);
  const path = pts.map((p): V3 => [p[0], h + (o.vertical ? 0 : 0.007), -p[1]]);
  if (o.vertical) {
    // a strip standing on edge at height h (drawn on a wall): normal = across the run
    const a = path[0], b = path[path.length - 1], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
    part.g(mat).ribbon(path, width, [-dz / l, 0, dx / l], false, true);
  } else {
    part.g(mat).ribbon(path, width);
  }
  return part.done();
}

/**
 * ADDED (polish 4): a fine gold line laid on a WALL face along PLAN points [x, n, h] — vertical pilaster lines,
 * frames, any direction (the request: `channel({ vertical })` only runs horizontally). `facing` = the direction the
 * wall face looks (plan degrees); the line sits 4 mm proud of it. Non-glowing gold by default, `glow: true` for a
 * light line (`color`, `intensity` then apply).
 */
export function buildWallLine(ctx: KitCtx, points: Array<[number, number, number]>, o: { facing?: number; width?: number; glow?: boolean; color?: number; intensity?: number; closed?: boolean } = {}): THREE.Object3D {
  const part = new Part(ctx, 'wallLine', new THREE.Vector3());
  const a = (ctx.num(o.facing, 0) * Math.PI) / 180, f: V3 = [Math.sin(a), 0, -Math.cos(a)];
  const pts = (points ?? []).filter((p) => Array.isArray(p) && p.every((v) => Number.isFinite(v))).map((p): V3 => [p[0] + f[0] * 0.004, p[2], -p[1] + f[2] * 0.004]);
  if (pts.length < 2) { ctx.warn('wallLine-pts', 'wallLine(): needs at least two points — skipped'); return part.done(); }
  const glow = o.glow === true;
  const over: Record<string, unknown> = { lineWidth: ctx.num(o.width, 0.03, 0.01, 1) };
  if (glow) {
    over.emissiveIntensity = ctx.num(o.intensity, 1.9, 0, 40);
    if (o.color !== undefined) over.emissive = o.color;
  }
  const mat = glow ? ctx.inlay('goldChannel', over) : ctx.goldLine();
  part.g(mat).ribbon(pts, ctx.num(o.width, 0.03, 0.01, 1), f, o.closed === true);
  return part.done();
}

export function buildConduit(ctx: KitCtx, points: Array<[number, number, number]>, o: { r?: number; glow?: boolean; collider?: boolean } = {}): THREE.Object3D {
  const r = ctx.num(o.r, 0.07, 0.02, 1.5);
  const pts = (points ?? []).filter((p) => Array.isArray(p) && p.every((v) => Number.isFinite(v))).map((p): V3 => [p[0], p[2], -p[1]]);
  const part = new Part(ctx, 'conduit', new THREE.Vector3());
  if (pts.length < 2) { ctx.warn('conduit-pts', 'conduit(): needs at least two points — skipped'); return part.done(); }
  const seg = r > 0.2 ? 12 : 7;
  part.g('goldTrim').tube(filletPath(pts, r * 3.2, 4), r, seg, true);
  // collars at the authored vertices, brackets and glowing bands along the straights
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0 && i < pts.length - 1) part.g('goldDark').ball(r * 1.7, 8, p[0], p[1], p[2]);
    if (i === pts.length - 1) break;
    const q = pts[i + 1], len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    const n = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, e = (r * 2.2) / len;
      const at = (u: number): V3 => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
      if (len > r * 12) {
        part.g('goldDark').tube([at(t - e * 0.5), at(t + e * 0.5)], r * 1.35, seg, true);
        if (o.glow) part.g('whiteLight').tube([at(t + e * 0.7), at(Math.min(0.98, t + e * 3.2))], r * 1.08, seg);
      }
    }
    if (o.collider && Math.abs(q[1] - p[1]) < 0.3 && len > 0.5) {
      const ry = Math.atan2(-(q[2] - p[2]), q[0] - p[0]);
      ctx.collider({ shape: { kind: 'box', hx: len / 2, hy: r, hz: r }, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, z: (p[2] + q[2]) / 2, yaw: ry, blocksSight: false, tag: 'conduit' });
    }
  }
  return part.done();
}

/** Soft star texture for the white point: bright core, wide halo, a horizontal streak. */
function flareTexture(): THREE.DataTexture {
  const S = 96, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v);
      const halo = Math.pow(Math.max(0, 1 - r), 5) * 0.4;
      const core = Math.exp(-r * r * 260);
      const streak = Math.exp(-v * v * 2400) * Math.pow(Math.max(0, 1 - Math.abs(u)), 3) * 0.9 + Math.exp(-u * u * 2400) * Math.pow(Math.max(0, 1 - Math.abs(v)), 3) * 0.45;
      const a = Math.min(1, halo + core + streak);
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function buildWhitePoint(ctx: KitCtx, o: { x: number; n: number; h: number; intensity?: number }): THREE.Object3D {
  const k = ctx.num(o.intensity, 1, 0, 8);
  const pos = ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 4));
  const group = new THREE.Group();
  group.name = 'whitePoint';
  group.position.copy(pos);
  ctx.root.add(group);
  // a small faceted lantern: the physical thing the light comes from
  const body = new Part(ctx, 'whitePoint-body', pos.clone());
  body.g(ctx.emissive(0xfff6e4, 9)).ball(0.11, 10, 0, 0, 0, 0.16);
  body.g('goldTrim').band(0.19, -0.03, 0.19, 0.03, 12, 0, 0).taperOn(0.05, 0.05, 0.05, 0.05, 0.5, 0, 0.16, 0);
  body.done();
  const tex = ctx.cached('flare', () => ctx.own(flareTexture()));
  const mat = ctx.own(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(3.2 * k, 3.1 * k, 2.8 * k), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  const flare = new THREE.Sprite(mat);
  flare.scale.setScalar(2.2);
  flare.layers.set(RENDER_LAYERS.noReflect);
  group.add(flare);
  const light = new THREE.PointLight(0xfff4e0, 12 * k, 24, 2);
  group.add(light);
  ctx.lights.push(light);
  ctx.updaters.push((_dt, time) => {
    const s = 1 + 0.06 * Math.sin(time * 1.7 + pos.x) + 0.03 * Math.sin(time * 4.3 + pos.z);
    flare.scale.setScalar(2.2 * s);
    light.intensity = 12 * k * (0.94 + 0.06 * s);
  });
  return group;
}

export function buildFrost(ctx: KitCtx, o: RectOpts & { height?: number; density?: number; collider?: boolean }): THREE.Object3D {
  const w = ctx.num(o.w, 6, 0.3), d = ctx.num(o.d, 0.8, 0.2), H = ctx.num(o.height, 4, 0.5), density = ctx.num(o.density, 0.6, 0.05, 2);
  const part = new Part(ctx, 'frost', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0)), ctx.yaw(ctx.num(o.yawDeg, 0)));
  // `r` is the zone's shared stream: the draws below keep exactly the count and order they always had (prop
  // variants later in the zone depend on it); the new crystal detail draws from `lr`, a private stream
  const r = ctx.rand, alongX = w >= d, L = alongX ? w : d, Wd = alongX ? d : w;
  const ice = part.g('frostIce'), rime = part.g('frostRime');
  const at = (g: Geo, t: number, off: number, y: number): Geo => g.push().move(alongX ? t : off, y, alongX ? off : t);
  const across = Math.max(0.05, Wd / 2 - 0.12);
  // glowing conduits the ice has grown around
  const nc = Math.max(1, Math.round(L / 3.5));
  for (let i = 0; i < nc; i++) {
    const t = -L / 2 + (L * (i + 0.5)) / nc + (r() - 0.5) * 0.6, x = alongX ? t : 0, z = alongX ? 0 : t;
    part.g('goldTrim').cyl(0.05, 0.05, H, 6, x, 0, z);
    part.g('whiteLight').cyl(0.062, 0.062, H * 0.5, 6, x, H * (0.18 + r() * 0.2), z);
  }
  // crystalline growth (polish 3): thick faceted slabs — standing from the floor, hanging from above — each
  // fringed with prism crystals along its free edge, a cluster of crystals fanning out of its root, a rime crust
  const n = Math.max(2, Math.round(L * density * 1.1));
  for (let i = 0; i < n; i++) {
    const t = -L / 2 + (L * (i + r() * 0.8)) / n, off0 = (r() - 0.5) * Math.max(0, Wd - 0.3);
    const pw = 0.9 + r() * 1.5, ph = H * (0.45 + r() * 0.55), hang = i % 3 === 2;
    const off = Math.max(-across, Math.min(across, off0));
    const outline: V2[] = [];
    const teeth = 5 + Math.floor(r() * 3);
    outline.push([-pw / 2, 0], [pw / 2, 0]);
    for (let k = teeth; k >= 0; k--) outline.push([-pw / 2 + (pw * k) / teeth + (r() - 0.5) * 0.12, ph * (0.6 + 0.4 * r() * (k % 2 ? 1 : 0.55))]);
    const turn = (alongX ? 0 : Math.PI / 2) + (r() - 0.5) * 0.5, lean = (r() - 0.5) * 0.16, depth0 = r();
    const lr = localRand(t, off0, pw, ph, depth0);
    // the slab: thick, leaning a little, so its edges catch the rim light and show depth
    const thick = 0.16 + depth0 * 0.16;
    at(ice, t, off, hang ? H : 0).rotY(turn);
    if (hang) ice.rotZ(Math.PI);
    ice.rotX(lean).prismZ(outline, thick);
    // crystals along the jagged edge: tilted out of the slab plane, every one different
    const tips = 3 + Math.floor(pw * 2.2);
    for (let k = 0; k < tips; k++) {
      const u = -pw / 2 + pw * ((k + 0.5) / tips) + (lr() - 0.5) * 0.1;
      const top = ph * (0.6 + 0.3 * lr());
      const cr = 0.05 + lr() * 0.07, chh = 0.15 + lr() * 0.35;
      ice.push().move(u, top - chh * 0.45, (lr() - 0.5) * thick).rotZ((lr() - 0.5) * 0.9).rotX((lr() - 0.5) * 0.9)
        .crystal(cr, chh, cr * (2 + lr() * 2), 5 + Math.floor(lr() * 2), lr).pop();
    }
    ice.pop();
    // a cluster fanning out of the root (floor slabs) or the crown (hanging ones)
    const cluster = 3 + Math.floor(lr() * 4);
    for (let k = 0; k < cluster; k++) {
      const a = lr() * Math.PI * 2, rr = 0.1 + lr() * 0.35;
      const cr = 0.06 + lr() * 0.1, chh = 0.25 + lr() * 0.7;
      at(ice, t + Math.cos(a) * rr * (alongX ? 1.4 : 0.5), Math.max(-across, Math.min(across, off + Math.sin(a) * rr * 0.6)), hang ? H : 0).rotY(lr() * 6.28);
      if (hang) ice.rotZ(Math.PI);
      ice.rotZ((lr() - 0.5) * 1.1).rotX((lr() - 0.5) * 0.8).crystal(cr, chh, cr * (2.5 + lr() * 2), 5 + Math.floor(lr() * 3), lr).pop();
    }
    if (!hang) {
      rime.push().move(alongX ? t : off0, 0.08, alongX ? off0 : t).rotY(r() * 3).chunk(pw * 0.9, 0.22, 0.5 + r() * 0.4, 0.5, r).pop();
      // opaque rime-white crystals at the root give the translucent growth a solid base
      for (let k = 0; k < 2; k++) {
        at(rime, t + (lr() - 0.5) * pw * 0.8, off + (lr() - 0.5) * 0.2, 0.05).rotY(lr() * 6.28).rotZ((lr() - 0.5) * 0.7)
          .crystal(0.05 + lr() * 0.05, 0.12 + lr() * 0.25, 0.12 + lr() * 0.12, 5, lr).pop();
      }
    }
  }
  // icicles from the top line: faceted, pointing down
  for (let i = 0; i < n * 2; i++) {
    const t = -L / 2 + L * r(), off = (r() - 0.5) * Wd * 0.6, len = 0.3 + r() * H * 0.3, rad = 0.03 + r() * 0.05;
    const lr = localRand(t, off, len);
    at(ice, t, off, H).rotZ(Math.PI).rotX((lr() - 0.5) * 0.2).crystal(rad, len * 0.55, len * 0.45, 5, lr).pop();
  }
  const solid = o.collider ?? Math.min(w, d) <= 1.5;
  if (solid) ctx.collider(part.pose.box(0, H / 2, 0, w / 2, H / 2, d / 2, { blocksSight: false, tag: 'frost' }));
  return part.done();
}

/**
 * Advance the zone stream exactly as the original (pre-polish-3) corruption patch did, and return a hash of what
 * it drew: the patch now draws its shape from a private stream, but everything built after it in the zone must
 * see the shared stream where it always was.
 */
function skipCorruptionDraws(rnd: () => number, R: number): number[] {
  const got: number[] = [];
  const d = (): number => { const v = rnd(); if (got.length < 6) got.push(v); return v; };
  for (let i = 0; i < 22; i++) d();
  for (let i = 0; i < 4 + Math.round(R); i++) { d(); d(); d(); }
  const veins = 5 + Math.round(R);
  for (let i = 0; i < veins; i++) {
    d(); d();
    const steps = 5 + Math.floor(d() * 4);
    for (let s = 0; s < steps; s++) {
      d();
      if (s > 1 && d() < 0.3) { d(); d(); }
    }
    d();
  }
  return got;
}

export function buildCorruption(ctx: KitCtx, o: { x: number; n: number; h?: number; r: number; intensity?: number; onWall?: boolean; yawDeg?: number; style?: 'growth' | 'crystal'; size?: CrystalOpts['size']; light?: boolean }): THREE.Object3D {
  const R = ctx.num(o.r, 2, 0.3, 40), k = ctx.num(o.intensity, 1, 0, 4);
  const pos = ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0));
  const drawn = skipCorruptionDraws(ctx.rand, R);
  if (o.style === 'crystal') {
    // polish 4: grounded violet crystal clusters (see crystal.ts); the zone stream is advanced exactly as before
    return buildCrystals(ctx, { x: o.x, n: o.n, h: o.h, r: R * 0.6, size: o.size, intensity: Math.min(3, k), onWall: o.onWall, yawDeg: o.yawDeg, light: o.light !== false });
  }
  const rnd = localRand(...drawn, pos.x, pos.z);
  const part = new Part(ctx, 'corruption', pos, ctx.yaw(ctx.num(o.yawDeg, 0)));
  const used: Geo[] = [];
  const G = (g: Geo): Geo => {
    if (!used.includes(g)) { g.push(); if (o.onWall) g.rotX(-Math.PI / 2); used.push(g); }
    return g;
  };
  // polish 3: violet-black GROWTH, raised and organic — a lumpy body heaped toward the source, tendrils that
  // climb out of it along the flow (local −Z), nodules and splinters of dark plate, violet veins threading all of it
  const tissue = G(part.g('eclipseTissue')), plate = G(part.g('eclipsePlate'));
  const vein = G(part.g(ctx.inlay('eclipseVein', { emissiveIntensity: 2.4 * Math.max(0.2, k) })));
  const H = Math.min(1.1, 0.22 + Math.sqrt(R) * 0.26);
  // a wall patch may sit on a narrow face (a rib, a pilaster): its tendrils and creeping veins stop at the edge of a
  // compact footprint instead of running on past the face into thin air (the draws stay the same either way)
  const onFace = (p: V3): boolean => !o.onWall || (Math.abs(p[0]) <= R * 0.5 && p[2] >= -R * 1.25 && p[2] <= R * 0.35);
  const clip = (path: V3[]): V3[] => { const i = path.findIndex((p) => !onFace(p)); return i < 0 ? path : path.slice(0, i); };
  // the body: a few overlapping lumps, the biggest at the source, smaller ones trailing along the flow
  const lumps = 3 + Math.round(Math.min(6, R * 1.2));
  for (let i = 0; i < lumps; i++) {
    const along = i === 0 ? 0 : (0.15 + rnd() * 0.7) * R, side = (rnd() - 0.5) * R * 0.7 * (i === 0 ? 0 : 1);
    const sz = (i === 0 ? 0.62 : 0.28 + rnd() * 0.3) * R;
    tissue.push().move(side, 0, -along).rotY(rnd() * 6.28)
      .blob(sz * (0.8 + rnd() * 0.4), H * (i === 0 ? 1 : 0.4 + rnd() * 0.5), sz * (0.7 + rnd() * 0.4), 0.9, rnd, 12, 5).pop();
  }
  // tendrils: tapering tubes that leave the body and creep outward, lifting off the floor in arches
  const tendrils = 5 + Math.round(R * 1.5);
  for (let i = 0; i < tendrils; i++) {
    let a = i < tendrils * 0.6 ? (rnd() - 0.5) * 1.3 : rnd() * Math.PI * 2;
    const reach = R * (i < tendrils * 0.6 ? 1.1 + rnd() * 0.7 : 0.5 + rnd() * 0.5), steps = 6;
    const r0 = Math.min(0.12, 0.035 + R * 0.02) * (0.6 + rnd() * 0.6);
    let x = Math.sin(a) * R * 0.25, z = -Math.cos(a) * R * 0.25;
    const path: V3[] = [[x * 0.5, H * 0.35, z * 0.5]];
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.8;
      x += (Math.sin(a) * reach) / steps; z -= (Math.cos(a) * reach) / steps;
      const lift = Math.sin(((s + 1) / steps) * Math.PI) * r0 * 2.2 + r0 * 0.6;
      path.push([x, lift, z]);
    }
    // the tube tapers in three stages (a cheap taper: thinner tubes for the outer runs)
    const run = clip(path);
    for (const [a0, a1, k, sg] of [[0, 3, 1, 6], [2, 5, 0.7, 6], [4, 7, 0.45, 5]] as const) {
      const seg = run.slice(a0, a1);
      if (seg.length >= 2) tissue.tube(seg, r0 * k, sg, true);
    }
    // a vein riding on top of the tendril
    if (run.length >= 2) vein.ribbon(run.map((p): V3 => [p[0], p[1] + r0 * 0.75, p[2]]), Math.max(0.02, r0 * 0.5));
    if (rnd() < 0.5) {
      const p = path[3 + Math.floor(rnd() * 2)];
      if (onFace(p)) tissue.ball(r0 * 2.2, 8, p[0], p[1], p[2], r0 * 1.6);
    }
  }
  // nodules on the body with a violet core showing through
  for (let i = 0; i < 4 + Math.round(R); i++) {
    const a = rnd() * Math.PI * 2, rr = rnd() * R * 0.45, s = 0.08 + rnd() * 0.16 * Math.min(2, R * 0.5);
    const y = H * (1 - Math.min(1, rr / (R * 0.62))) * 0.85;
    tissue.ball(s, 8, Math.sin(a) * rr, y, -Math.cos(a) * rr, s * 0.8);
    vein.ball(s * 0.45, 6, Math.sin(a) * rr, y + s * 0.55, -Math.cos(a) * rr, s * 0.3);
  }
  // splinters of appropriated plate breaking through the growth
  for (let i = 0; i < 2 + Math.round(R * 0.8); i++) {
    const a = rnd() * Math.PI * 2, rr = rnd() * R * 0.5;
    plate.push().move(Math.sin(a) * rr, H * 0.3, -Math.cos(a) * rr).rotY(rnd() * 6.28).rotZ((rnd() - 0.5) * 1.2).rotX((rnd() - 0.5) * 0.8)
      .crystal(0.05 + rnd() * 0.06, 0.2 + rnd() * H * 0.6, 0.1 + rnd() * 0.15, 4, rnd).pop();
  }
  // veins creeping out over the clean floor ahead of the growth, branching as they go
  const veins = 5 + Math.round(R);
  for (let i = 0; i < veins; i++) {
    let a = i < veins * 0.6 ? (rnd() - 0.5) * 1.3 : rnd() * Math.PI * 2;
    let x = 0, z = 0;
    const path: V3[] = [[0, 0.02, 0]], reach = R * (i < veins * 0.6 ? 1.3 + rnd() * 0.8 : 0.6 + rnd() * 0.5), steps = 5 + Math.floor(rnd() * 4);
    for (let st = 0; st < steps; st++) {
      a += (rnd() - 0.5) * 0.9;
      x += (Math.sin(a) * reach) / steps; z -= (Math.cos(a) * reach) / steps;
      path.push([x, 0.016, z]);
      if (st > 1 && rnd() < 0.3) {
        const ba = a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5), bl = reach * 0.25;
        const branch = clip([[x, 0.016, z], [x + Math.sin(ba) * bl * 0.5, 0.016, z - Math.cos(ba) * bl * 0.5], [x + Math.sin(ba + 0.4) * bl, 0.016, z - Math.cos(ba + 0.4) * bl]]);
        if (branch.length >= 2) vein.ribbon(branch, 0.03);
      }
    }
    const run = clip(path), w = 0.035 + rnd() * 0.02;
    if (run.length >= 2) vein.ribbon(run, w);
  }
  for (const g of used) g.pop();
  const group = part.done();
  const light = new THREE.PointLight(PALETTE.eclipseViolet, 5 * k, Math.max(5, R * 3), 2);
  light.position.set(0, o.onWall ? 0 : 0.7, o.onWall ? -0.5 : 0);
  light.userData.kitFixture = true;
  group.add(light);
  ctx.lights.push(light);
  return group;
}
