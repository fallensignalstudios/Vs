/**
 * ADDED (polish 4): architectural relief and detail density — the dressing the four paintings are full of and the
 * kit lacked: pipe runs with brackets and collars, tall lit slots (and window glow), deep portals with stepped
 * jambs, and tiered balconies / galleries with stairs for distant, non-walkable tiers.
 *
 * Everything here is COLLIDER-FREE scenery and merges by material in finalize() (the glow panels too: one
 * vertex-coloured material per builder), so a zone pays a handful of draw calls for any amount of it.
 *
 * Wall-mounted pieces (`slot`, `portal`, `tiers`) are posed like props: (x, n, h) is a point on the wall face (or the
 * front of the stack) and `yawDeg` is the direction the piece FACES — into the room, away from the wall. In the
 * piece's frame the wall face is z = 0 and the room is toward −Z.
 */
import * as THREE from 'three';
import type { PipeOpts, PortalOpts, SlotOpts, TiersOpts } from '@/core/api';
import type { V2, V3 } from './geo';
import { filletPath } from './geo';
import { familyOf, type KitCtx, Part } from './core';
import { HazeWriter } from './vault';

// ------------------------------------------------------------------------------------------------ shared glow
/** One unlit, vertex-coloured, fogged glow material per builder and brightness (merges across every slot). */
export function glowMesh(ctx: KitCtx, hz: HazeWriter, glow: number, parent: THREE.Object3D): void {
  if (hz.empty) return;
  const mat = ctx.cached(`relief-glow:${glow.toFixed(2)}`, () => {
    const m = ctx.own(new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
    m.color.setScalar(glow);
    m.name = `kit-relief-glow:${glow.toFixed(2)}`;
    return m;
  });
  const mesh = new THREE.Mesh(ctx.own(hz.geometry()), mat);
  mesh.name = 'relief-glow';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.kitStatic = true;
  parent.add(mesh);
}

const facingDir = (deg: number): V3 => { const a = (deg * Math.PI) / 180; return [Math.sin(a), 0, -Math.cos(a)]; };
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ------------------------------------------------------------------------------------------------ pipes

/**
 * Pipe runs with brackets, collars and junction boxes along a path of PLAN points [x, n, h] laid on a wall face.
 * Parallel pipes are spread across the run (horizontally on a vertical run, vertically on a horizontal one), bends
 * are filleted, each bracket is a clamp ring round every pipe with a stem back to a base plate on the wall.
 */
export function buildPipes(ctx: KitCtx, points: Array<[number, number, number]>, o: PipeOpts = {}): THREE.Object3D {
  const r = ctx.num(o.r, 0.05, 0.015, 0.6), count = Math.round(ctx.num(o.count, 2, 1, 6));
  const spacing = ctx.num(o.spacing, r * 3, r * 2.1, 2), standoff = ctx.num(o.standoff, r + 0.07, r, 3);
  const f = facingDir(ctx.num(o.facing, 0)), bracket = ctx.num(o.bracket, 1.7, 0, 50);
  const pts = (points ?? []).filter((p) => Array.isArray(p) && p.every((v) => Number.isFinite(v))).map((p): V3 => [p[0], p[2], -p[1]]);
  const part = new Part(ctx, 'pipes', new THREE.Vector3());
  if (pts.length < 2) { ctx.warn('pipes-pts', 'pipes(): needs at least two points — skipped'); return part.done(); }
  const pipe = part.g(o.mat ?? 'goldTrim'), dark = part.g('goldDark'), trim = part.g('goldTrim');
  const n = pts.length;
  // the across direction at each vertex: perpendicular to the run and to the facing
  const across: V3[] = pts.map((_, i) => {
    const t = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const a = cross(t, f);
    return len(a) < 1e-4 ? [0, 1, 0] : norm(a);
  });
  const seg = r > 0.12 ? 12 : 8;
  const offs = Array.from({ length: count }, (_, k) => (k - (count - 1) / 2) * spacing);
  for (const off of offs) {
    const path = pts.map((p, i) => add(add(p, f, standoff), across[i], off));
    pipe.tube(filletPath(path, Math.max(r * 4, Math.abs(off) + r * 3), 5), r, seg, true);
    // collars at the authored bends
    for (let i = 1; i < n - 1; i++) dark.ball(r * 1.55, 8, path[i][0], path[i][1], path[i][2]);
  }
  // brackets along the straights
  for (let i = 0; i + 1 < n && bracket > 0; i++) {
    const a = pts[i], b = pts[i + 1], L = len(sub(b, a));
    const k = Math.max(1, Math.round(L / bracket));
    const t = norm(sub(b, a)), ax = across[i];
    for (let j = 0; j < k; j++) {
      const u = (j + 0.5) / k;
      if (L * Math.min(u, 1 - u) < r * 6) continue;
      const c = add(a, sub(b, a), u);
      for (const off of offs) {
        const p = add(add(c, f, standoff), ax, off);
        dark.tube([add(p, t, -r * 0.9), add(p, t, r * 0.9)], r * 1.3, seg, true);
        // stem back to the wall
        dark.tube([add(p, f, -r), add(c, ax, off)], r * 0.32, 6, false);
      }
      // the base plate across the pair
      const span = (count - 1) * spacing + r * 3.4;
      const q0 = add(add(c, ax, -span / 2), f, 0.012), q1 = add(add(c, ax, span / 2), f, 0.012);
      dark.tube([q0, q1], r * 0.75, 6, true);
    }
  }
  // junction boxes against the wall
  const boxAt = o.boxes === true ? pts.map((_, i) => i).slice(1, -1) : Array.isArray(o.boxes) ? o.boxes : n >= 3 ? [1] : [];
  const yaw = Math.atan2(-f[0], -f[2]);
  for (const i of boxAt) {
    const p = pts[Math.max(0, Math.min(n - 1, Math.round(i)))];
    if (!p) continue;
    const w = Math.max(0.36, (count - 1) * spacing + r * 5);
    dark.push().move(p[0], p[1], p[2]).rotY(yaw).cbox(w, w * 1.3, standoff * 2 + r * 1.6, 0.025, 0, 0, -(standoff + r * 0.8)).pop();
    trim.push().move(p[0], p[1], p[2]).rotY(yaw).box(w + 0.02, 0.025, standoff * 2 + r * 1.6 + 0.02, 0, w * 0.45, -(standoff + r * 0.8)).pop();
  }
  return part.done();
}

// ------------------------------------------------------------------------------------------------ slots

/**
 * A tall lit slot — or, wider, a window full of daylight haze: a narrow opening in a stone frame whose back is a
 * soft glow, brightest down the middle and fading at the edges and ends (never a hard neon line), with its reveals
 * lit by it and a thin gold line round the frame.
 */
export function buildSlot(ctx: KitCtx, o: SlotOpts): THREE.Object3D {
  const W = ctx.num(o.width, 0.38, 0.06, 12), H = ctx.num(o.height, 5, 0.3, 40), D = ctx.num(o.depth, 0.26, 0.04, 3);
  const glow = ctx.num(o.intensity, 1.05, 0, 12), color = ctx.num(o.color, 0xf3efe6);
  const part = new Part(ctx, 'slot', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0.6)), ctx.yaw(ctx.num(o.yawDeg, 0)));
  const fam = familyOf(o.mat), stone = part.g(fam.frame);
  const jw = Math.min(0.2, Math.max(0.1, W * 0.35));
  for (const s of [-1, 1]) stone.vbox(jw, H + 0.3, D, 0.02, s * (W / 2 + jw / 2), -0.15, -D / 2);
  stone.tbox(W + jw * 2 + 0.06, 0.16, D + 0.04, 0.02, 0, H, -D / 2 - 0.02);
  stone.box(W + jw * 2 + 0.06, 0.16, D + 0.04, 0, -0.23, -D / 2 - 0.02);
  // gold line round the opening on the frame's face
  const zf = -D - 0.002, gx = W / 2 + 0.03;
  part.g(ctx.goldLine()).ribbon([[-gx, -0.03, zf], [-gx, H + 0.03, zf], [gx, H + 0.03, zf], [gx, -0.03, zf]], 0.022, [0, 0, -1], true);
  if (o.mullions) {
    const m = Math.round(ctx.num(o.mullions, 0, 0, 12));
    for (let i = 1; i <= m; i++) part.g('goldDark').box(W, 0.04, 0.04, 0, (H * i) / (m + 1), -0.06);
  }
  // the light: a soft panel (3 × 6 grid of vertex brightness) and its lit reveals
  const hz = new HazeWriter(color);
  // (a soft column of light: the middle third at full strength, the edges a fifth of it, dimmer toward both ends)
  const kx = [0.18, 0.9, 0.9, 0.18], xs = [-W / 2, -W * 0.16, W * 0.16, W / 2];
  const ky = [0.35, 0.75, 0.95, 1, 0.85, 0.45], ys = [0, H * 0.1, H * 0.3, H * 0.7, H * 0.9, H];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 5; j++) {
      const z = -0.012;
      hz.quad([xs[i], ys[j], z], [xs[i + 1], ys[j], z], [xs[i + 1], ys[j + 1], z], [xs[i], ys[j + 1], z], [0, 0, -1],
        [kx[i] * ky[j], kx[i + 1] * ky[j], kx[i + 1] * ky[j + 1], kx[i] * ky[j + 1]]);
    }
  }
  for (const s of [-1, 1]) {
    const x = s * W / 2;
    hz.quad([x, 0, -0.012], [x, 0, -D], [x, H, -D], [x, H, -0.012], [-s, 0, 0], [0.32, 0.06, 0.06, 0.32]);
  }
  glowMesh(ctx, hz, glow, part.group);
  if (o.light) {
    const light = new THREE.PointLight(color, 3 * Math.max(0.2, glow), Math.max(4, H * 1.4), 2);
    light.position.set(0, H * 0.5, -D - 0.6);
    light.userData.kitFixture = true;
    part.group.add(light);
    ctx.lights.push(light);
  }
  return part.done();
}

// ------------------------------------------------------------------------------------------------ portals

/** The inner outline of a doorway head (open polyline from the left foot, over the head, to the right foot). */
function portalOutline(w: number, h: number, head: 'flat' | 'pointed' | 'round'): V2[] {
  const hw = w / 2;
  if (head === 'round') {
    const out: V2[] = [[-hw, 0]];
    const cy = Math.max(0.1, h - hw), seg = 14;
    for (let i = 0; i <= seg; i++) { const a = Math.PI * (1 - i / seg); out.push([Math.cos(a) * hw, cy + Math.sin(a) * hw]); }
    out.push([hw, 0]);
    return out;
  }
  if (head === 'pointed') {
    const sh = Math.max(0.2, h - w * 0.45);
    return [[-hw, 0], [-hw, sh], [-hw * 0.45, h - w * 0.12], [0, h], [hw * 0.45, h - w * 0.12], [hw, sh], [hw, 0]];
  }
  const c = Math.min(0.5, w * 0.16);
  return [[-hw, 0], [-hw, h - c], [-hw + c, h], [hw - c, h], [hw, h - c], [hw, 0]];
}

/** Offset an open outline outward (away from the opening's centre) by `d`, mitred. */
function offsetOutline(p: V2[], d: number, cy: number): V2[] {
  const n = p.length;
  const edgeN = (a: V2, b: V2): V2 => {
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - cy;
    return nx * mx + ny * my < 0 ? [-nx, -ny] : [nx, ny];
  };
  return p.map((q, i) => {
    const e0 = i > 0 ? edgeN(p[i - 1], q) : edgeN(q, p[i + 1]);
    const e1 = i < n - 1 ? edgeN(q, p[i + 1]) : e0;
    let vx = e0[0] + e1[0], vy = e0[1] + e1[1];
    const l = Math.hypot(vx, vy) || 1;
    vx /= l; vy /= l;
    const k = d / Math.max(0.35, vx * e0[0] + vy * e0[1]);
    // the feet stay on the floor
    return [q[0] + vx * k, i === 0 || i === n - 1 ? q[1] : q[1] + vy * k];
  });
}

/**
 * A deep, sculpted doorway frame: `steps` concentric jambs, each wider than the last and standing further out of
 * the wall, so the door sits at the back of a stepped funnel; a fine gold line runs round every step's inner edge,
 * a gold medallion crowns it. The inner aperture is 6 cm wider than the opening on each side: it never narrows
 * the doorway.
 */
export function buildPortal(ctx: KitCtx, o: PortalOpts): THREE.Object3D {
  const W = ctx.num(o.width, 3, 0.6, 30), H = ctx.num(o.height, 3.5, 0.6, 40);
  const steps = Math.round(ctx.num(o.steps, 3, 1, 8)), depth = ctx.num(o.depth, 1.1, 0.1, 8), st = ctx.num(o.step, 0.32, 0.08, 2);
  const head = o.head === 'pointed' || o.head === 'round' ? o.head : 'flat';
  const part = new Part(ctx, 'portal', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0)), ctx.yaw(ctx.num(o.yawDeg, 0)));
  const fam = familyOf(o.mat), stone = part.g(fam.frame), gold = part.g(ctx.goldLine());
  const sides = o.both ? [1, -1] : [1];
  const t2 = ctx.num(o.thickness, 0.6, 0, 6) / 2;
  let outerTop = H;
  for (const side of sides) {
    // side 1 = the facing side (−Z); side −1 = the back face of the wall (+Z beyond the thickness)
    const z0 = side === 1 ? 0 : 2 * t2, dirZ = side === 1 ? -1 : 1;
    for (let i = 0; i < steps; i++) {
      const inner = offsetOutline(portalOutline(W + 0.12, H + 0.06, head), i * st, H / 2);
      const outer = offsetOutline(inner, st, H / 2);
      const zf = z0 + dirZ * depth * ((i + 1) / steps);
      outerTop = Math.max(outerTop, ...outer.map((q) => q[1]));
      for (let k = 0; k + 1 < inner.length; k++) {
        const a = inner[k], b = inner[k + 1], c = outer[k + 1], d = outer[k];
        // front face
        stone.quadFacing([a[0], a[1], zf], [b[0], b[1], zf], [c[0], c[1], zf], [d[0], d[1], zf], [0, 0, dirZ]);
        // inner reveal (faces the opening) and outer side (faces away from it)
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - H / 2;
        stone.quadFacing([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], zf], [a[0], a[1], zf], [-mx, -my, 0]);
        stone.quadFacing([d[0], d[1], z0], [c[0], c[1], z0], [c[0], c[1], zf], [d[0], d[1], zf], [mx, my, 0]);
      }
      // the gold line along the step's inner edge, on its front face
      const g = offsetOutline(inner, 0.045, H / 2).map((q): V3 => [q[0], q[1] + 0.001, zf + dirZ * 0.002]);
      gold.ribbon(g, 0.022, [0, 0, dirZ]);
    }
    if (o.crest !== false) {
      const cy = outerTop + 0.5, zc = z0 + dirZ * depth * 0.6;
      part.g('goldDark').push().move(0, cy, zc).rotX(Math.PI / 2).cyl(0.34, 0.34, depth * 0.5, 16, 0, -depth * 0.25, 0).pop();
      part.g('goldTrim').push().move(0, cy, zc + dirZ * depth * 0.25).rotX(Math.PI / 2).band(0.4, -0.02, 0.4, 0.04, 20).pop();
      part.g('goldTrim').push().move(0, cy, zc + dirZ * (depth * 0.25 + 0.02)).rotZ(Math.PI / 4).box(0.24, 0.24, 0.04).pop();
    }
  }
  return part.done();
}

// ------------------------------------------------------------------------------------------------ tiers

/**
 * Tiered galleries for the far walls of a hall (the quarantine painting's balconies and stairs): each level a
 * slab on corbels behind a balustrade with a fine gold line on its fascia, a back wall of gold-framed dark
 * doorways with tall lit slots between them, pilasters, and stair flights climbing the front from level to level.
 * NOT walkable and collider-free: place it beyond the playable footprint (or high enough that nobody reaches it).
 */
export function buildTiers(ctx: KitCtx, o: TiersOpts): THREE.Object3D {
  const W = ctx.num(o.width, 24, 4, 200), levels = Math.round(ctx.num(o.levels, 3, 1, 8));
  const LH = ctx.num(o.levelHeight, 4.2, 2.6, 12), D = ctx.num(o.depth, 3.2, 1.2, 20), S = ctx.num(o.setback, 0, 0, 10);
  const part = new Part(ctx, 'tiers', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0)), ctx.yaw(ctx.num(o.yawDeg, 0)));
  const fam = familyOf(o.mat), stone = part.g(fam.frame), panel = part.g(fam.panel), trim = part.g('goldTrim');
  const gold = part.g(ctx.goldLine()), dark = part.g(fam.dark ? 'goldDark' : 'blackStone');
  const hw = W / 2, rail = o.rail ?? 'balusters', stairs = o.stairs ?? 'right';
  const hz = new HazeWriter(0xf1ece2);
  // frame: z = 0 is the front edge of the lowest gallery, the back wall stands at z = D; gallery i has its floor at
  // y = (i + 1)·LH and its front at z = i·S (upper galleries step back by the setback)
  const backWall = (y0: number, wh: number): void => {
    panel.box(W, wh, 0.3, 0, y0 + wh / 2, D + 0.15);
    const bays = Math.max(1, Math.round(W / 3.6)), bw = W / bays;
    for (let k = 0; k < bays; k++) {
      const cx = -hw + bw * (k + 0.5);
      const dw = Math.min(1.6, bw * 0.45), dh = Math.min(2.7, wh * 0.68);
      dark.box(dw, dh, 0.05, cx, y0 + dh / 2, D - 0.02);
      gold.ribbon([[cx - dw / 2 - 0.05, y0, D - 0.048], [cx - dw / 2 - 0.05, y0 + dh + 0.05, D - 0.048], [cx + dw / 2 + 0.05, y0 + dh + 0.05, D - 0.048], [cx + dw / 2 + 0.05, y0, D - 0.048]], 0.024, [0, 0, -1]);
      stone.vbox(0.34, wh, 0.16, 0.02, -hw + bw * k, y0, D - 0.08);
      if (o.slots !== false && wh > 2.4 && k > 0) {
        const sx = -hw + bw * k + 0.45, sh = wh * 0.62;
        hz.quad([sx - 0.07, y0 + 0.5, D - 0.01], [sx + 0.07, y0 + 0.5, D - 0.01], [sx + 0.07, y0 + 0.5 + sh, D - 0.01], [sx - 0.07, y0 + 0.5 + sh, D - 0.01], [0, 0, -1], [0.4, 0.4, 0.7, 0.7]);
      }
    }
    stone.vbox(0.34, wh, 0.16, 0.02, hw, y0, D - 0.08);
    stone.box(W + 0.1, 0.24, 0.4, 0, y0 + wh + 0.06, D + 0.1);
    trim.box(W + 0.12, 0.025, 0.42, 0, y0 + wh - 0.06, D + 0.1);
  };
  backWall(0, LH - 0.36);
  for (let i = 0; i < levels; i++) {
    const y = (i + 1) * LH, zf = Math.min(D - 1, i * S), dz = D - zf;
    // gallery slab + fascia with a gold line
    stone.box(W, 0.36, dz, 0, y - 0.18, (zf + D) / 2);
    stone.box(W + 0.1, 0.55, 0.14, 0, y - 0.3, zf - 0.07);
    gold.ribbon([[-hw, y - 0.3, zf - 0.142], [hw, y - 0.3, zf - 0.142]], 0.024, [0, 0, -1]);
    trim.box(W + 0.12, 0.03, 0.16, 0, y - 0.03, zf - 0.07);
    if (o.corbels !== false) {
      // corbels under the front, flaring up into the slab
      for (let x = -hw + 1.5; x <= hw - 1.4; x += 3) stone.taperOn(0.3, 0.24, 0.34, 0.9, 0.95, x, y - 1.31, zf + 0.45);
    }
    // the front rail
    const rh = 1.05;
    if (rail === 'parapet') {
      stone.boxOn(W, rh, 0.22, 0, y, zf + 0.11);
      for (let x = -hw; x <= hw + 0.01; x += 3) {
        const px = Math.min(hw - 0.15, Math.max(-hw + 0.15, x));
        stone.vbox(0.3, rh + 0.14, 0.26, 0.02, px, y, zf + 0.11);
        hz.quad([px - 0.03, y + rh - 0.38, zf - 0.025], [px + 0.03, y + rh - 0.38, zf - 0.025], [px + 0.03, y + rh - 0.08, zf - 0.025], [px - 0.03, y + rh - 0.08, zf - 0.025], [0, 0, -1], [0.7, 0.7, 1, 1]);
      }
      gold.ribbon([[-hw, y + rh - 0.12, zf - 0.002], [hw, y + rh - 0.12, zf - 0.002]], 0.018, [0, 0, -1]);
    } else {
      stone.tbox(W, 0.1, 0.2, 0.02, 0, y + rh - 0.1, zf + 0.12);
      stone.boxOn(W, 0.14, 0.2, 0, y, zf + 0.12);
      trim.box(W, 0.02, 0.21, 0, y + rh - 0.13, zf + 0.12);
      if (rail === 'glass') {
        part.g(ctx.variant('glass', { color: 0xffffff, opacity: 0.05, envMapIntensity: 0.5, rim: 0.2 })).box(W, rh - 0.24, 0.02, 0, y + 0.14 + (rh - 0.24) / 2, zf + 0.12);
      } else {
        for (let x = -hw + 0.15; x <= hw - 0.1; x += 0.24) stone.cyl(0.04, 0.035, rh - 0.24, 6, x, y + 0.14, zf + 0.12, false);
      }
      for (let x = -hw; x <= hw + 0.01; x += 3) stone.vbox(0.22, rh + 0.06, 0.24, 0.02, Math.min(hw - 0.11, Math.max(-hw + 0.11, x)), y, zf + 0.12);
    }
    backWall(y, LH - 0.36);
  }
  // stair flights: ground → first gallery up the front of the stack, then one flight inside each gallery along
  // its back wall climbing to the gallery above
  const flight = (side: number, i: number): void => {
    const y0 = i * LH, y1 = (i + 1) * LH, nst = Math.max(4, Math.round((y1 - y0) / 0.19)), tread = 0.3, sw = 1.4;
    const run = nst * tread, zLine = i === 0 ? -sw / 2 - 0.15 : D - sw / 2 - 0.35;
    const xEnd = side * (hw - 0.4), xStart = xEnd - side * run;
    for (let k = 0; k < nst; k++) {
      const x0 = xStart + side * k * tread, yk = y0 + (y1 - y0) * ((k + 1) / nst), th = Math.min(0.22, yk - y0);
      stone.box(tread + 0.02, th, sw, x0 + side * tread / 2, yk - th / 2, zLine);
    }
    const zr = zLine - side * 0 - sw / 2 - 0.05;
    const p0: V3 = [xStart, y0 - 0.12, zr], p1: V3 = [xEnd, y1 - 0.12, zr];
    stone.tube([p0, p1], 0.11, 4, true);
    trim.tube([[p0[0], p0[1] + 1.05, zr], [p1[0], p1[1] + 1.05, zr]], 0.024, 6, true);
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      stone.cyl(0.028, 0.028, 1.0, 5, p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u + 0.05, zr, false);
    }
  };
  for (let i = 0; i < levels; i++) {
    if (stairs === 'right' || stairs === 'both') flight(1, i);
    if (stairs === 'left' || stairs === 'both') flight(-1, i);
  }
  glowMesh(ctx, hz, 1.3, part.group);
  return part.done();
}
