/**
 * Dressing with meaning: gold channels, conduit runs, the white-point landmark, frozen atmosphere, corruption.
 */
import * as THREE from 'three';
import type { RectOpts } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { RENDER_LAYERS } from '@/core/api/render';
import type { Geo, V2, V3 } from './geo';
import { filletPath } from './geo';
import { KitCtx, Part } from './core';

export interface ChannelOpts { h?: number; width?: number; color?: number; intensity?: number; pulse?: boolean; vertical?: boolean }

export function buildChannel(ctx: KitCtx, points: Array<[number, number]>, o: ChannelOpts = {}): THREE.Object3D {
  const h = ctx.num(o.h, 0), width = ctx.num(o.width, 0.055, 0.04, 2);
  const pts = (points ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const part = new Part(ctx, 'channel', new THREE.Vector3());
  if (pts.length < 2) { ctx.warn('channel-pts', 'channel(): needs at least two points — skipped'); return part.done(); }
  const over: Record<string, unknown> = {};
  if (o.color !== undefined) over.emissive = o.color;
  if (o.intensity !== undefined) over.emissiveIntensity = ctx.num(o.intensity, 3, 0, 40);
  if (o.pulse === false) over.pulse = 0;
  const mat = Object.keys(over).length ? ctx.inlay('goldChannel', over) : ctx.channel();
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
  const r = ctx.rand, alongX = w >= d, L = alongX ? w : d, Wd = alongX ? d : w;
  const ice = part.g('frostIce'), rime = part.g('frostRime');
  // glowing conduits the ice has grown around
  const nc = Math.max(1, Math.round(L / 3.5));
  for (let i = 0; i < nc; i++) {
    const t = -L / 2 + (L * (i + 0.5)) / nc + (r() - 0.5) * 0.6, x = alongX ? t : 0, z = alongX ? 0 : t;
    part.g('goldTrim').cyl(0.05, 0.05, H, 6, x, 0, z);
    part.g('whiteLight').cyl(0.062, 0.062, H * 0.5, 6, x, H * (0.18 + r() * 0.2), z);
  }
  // sheets: standing from the floor and hanging from above, with jagged free edges
  const n = Math.max(2, Math.round(L * density * 1.1));
  for (let i = 0; i < n; i++) {
    const t = -L / 2 + (L * (i + r() * 0.8)) / n, off = (r() - 0.5) * Math.max(0, Wd - 0.3);
    const pw = 0.9 + r() * 1.5, ph = H * (0.45 + r() * 0.55), hang = i % 3 === 2;
    const outline: V2[] = [];
    const teeth = 5 + Math.floor(r() * 3);
    outline.push([-pw / 2, 0], [pw / 2, 0]);
    for (let k = teeth; k >= 0; k--) outline.push([-pw / 2 + (pw * k) / teeth + (r() - 0.5) * 0.12, ph * (0.6 + 0.4 * r() * (k % 2 ? 1 : 0.55))]);
    ice.push().move(alongX ? t : off, hang ? H : 0, alongX ? off : t).rotY((alongX ? 0 : Math.PI / 2) + (r() - 0.5) * 0.5);
    if (hang) ice.rotZ(Math.PI);
    ice.rotX((r() - 0.5) * 0.12).prismZ(outline, 0.05 + r() * 0.08).pop();
    if (!hang) rime.push().move(alongX ? t : off, 0.08, alongX ? off : t).rotY(r() * 3).chunk(pw * 0.9, 0.22, 0.5 + r() * 0.4, 0.5, r).pop();
  }
  // icicles from the top line
  for (let i = 0; i < n * 2; i++) {
    const t = -L / 2 + L * r(), off = (r() - 0.5) * Wd * 0.6, len = 0.3 + r() * H * 0.3;
    ice.band(0.03 + r() * 0.05, H, 0, H - len, 5, alongX ? t : off, alongX ? off : t);
  }
  const solid = o.collider ?? Math.min(w, d) <= 1.5;
  if (solid) ctx.collider(part.pose.box(0, H / 2, 0, w / 2, H / 2, d / 2, { blocksSight: false, tag: 'frost' }));
  return part.done();
}

export function buildCorruption(ctx: KitCtx, o: { x: number; n: number; h?: number; r: number; intensity?: number; onWall?: boolean; yawDeg?: number }): THREE.Object3D {
  const R = ctx.num(o.r, 2, 0.3, 40), k = ctx.num(o.intensity, 1, 0, 4), rnd = ctx.rand;
  const pos = ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0));
  const part = new Part(ctx, 'corruption', pos, ctx.yaw(ctx.num(o.yawDeg, 0)));
  const used: Geo[] = [];
  const G = (g: Geo): Geo => {
    if (!used.includes(g)) { g.push(); if (o.onWall) g.rotX(-Math.PI / 2); used.push(g); }
    return g;
  };
  const tissue = G(part.g('eclipseTissue')), vein = G(part.g(ctx.inlay('eclipseVein', { emissiveIntensity: 2.4 * Math.max(0.2, k) })));
  // tissue mat: an irregular low mound stretched along the flow direction (local −Z)
  const lobes = 22, rim: V3[] = [];
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2, stretch = 1 + 0.5 * Math.max(0, Math.cos(a));
    const rr = R * (0.55 + 0.45 * rnd()) * stretch * 0.8;
    rim.push([Math.sin(a) * rr, 0.012, -Math.cos(a) * rr]);
  }
  for (let i = 0; i < lobes; i++) {
    const a = rim[i], b = rim[(i + 1) % lobes];
    const ma: V3 = [a[0] * 0.5, 0.05 + R * 0.03, a[2] * 0.5], mb: V3 = [b[0] * 0.5, 0.05 + R * 0.03, b[2] * 0.5];
    tissue.quadFacing(a, b, mb, ma, [0, 1, 0]);
    tissue.quadFacing(ma, mb, [0, 0.07 + R * 0.04, 0], [0, 0.07 + R * 0.04, 0], [0, 1, 0]);
  }
  for (let i = 0; i < 4 + Math.round(R); i++) {
    const a = rnd() * Math.PI * 2, rr = rnd() * R * 0.55, s = 0.12 + rnd() * 0.22 * Math.min(2, R * 0.5);
    tissue.ball(s, 8, Math.sin(a) * rr, s * 0.35, -Math.cos(a) * rr, s * 0.6);
  }
  // veins creep outward, most of them along the flow direction, branching as they go
  const veins = 5 + Math.round(R);
  for (let i = 0; i < veins; i++) {
    let a = i < veins * 0.6 ? (rnd() - 0.5) * 1.3 : rnd() * Math.PI * 2;
    let x = 0, z = 0;
    const path: V3[] = [[0, 0.02, 0]], reach = R * (i < veins * 0.6 ? 1.1 + rnd() * 0.7 : 0.5 + rnd() * 0.5), steps = 5 + Math.floor(rnd() * 4);
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.9;
      x += (Math.sin(a) * reach) / steps; z -= (Math.cos(a) * reach) / steps;
      path.push([x, 0.016, z]);
      if (s > 1 && rnd() < 0.3) {
        const ba = a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5), bl = reach * 0.25;
        vein.ribbon([[x, 0.016, z], [x + Math.sin(ba) * bl * 0.5, 0.016, z - Math.cos(ba) * bl * 0.5], [x + Math.sin(ba + 0.4) * bl, 0.016, z - Math.cos(ba + 0.4) * bl]], 0.03);
      }
    }
    vein.ribbon(path, 0.035 + rnd() * 0.02);
  }
  for (const g of used) g.pop();
  const group = part.done();
  const light = new THREE.PointLight(PALETTE.eclipseViolet, 5 * k, Math.max(5, R * 3), 2);
  light.position.set(0, o.onWall ? 0 : 0.7, o.onWall ? -0.5 : 0);
  group.add(light);
  ctx.lights.push(light);
  return group;
}
