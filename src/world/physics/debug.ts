/**
 * Debug drawing of the collision world as one self-refreshing THREE.Group (4 draw calls in total):
 * surfaces green (ramps lighter, with an uphill chevron), solids red, cover blue (low light / high dark),
 * sight-through solids orange, disabled solids grey, triggers yellow, nav nodes as dots.
 *
 * This is the only module of the physics subsystem that touches three.js.
 */
import * as THREE from 'three';
import { RAY_MOVE, RAY_SIGHT } from '@/core/api/physics';
import { maskOf } from './shapes';
import type { ColliderRec, SurfaceRec, TriggerRec } from './shapes';
import type { PhysicsCore } from './world';
import type { NavGridImpl } from './nav';

const COL = {
  surface: new THREE.Color(0x2fd27a),
  ramp: new THREE.Color(0x9af2c0),
  solid: new THREE.Color(0xff4b4b),
  coverLow: new THREE.Color(0x7cc4ff),
  coverHigh: new THREE.Color(0x2f6dff),
  seeThrough: new THREE.Color(0xffa033),
  ghost: new THREE.Color(0xc070ff),
  disabled: new THREE.Color(0x4a505c),
  trigger: new THREE.Color(0xffd84a),
  nav: new THREE.Color(0x8fe6ff),
};
const DISC_SEGS = 64;
const CYL_SEGS = 20;
const LIFT = 0.03;

/** Growable position/colour buffers for one primitive batch. */
class Batch {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  v(x: number, y: number, z: number, c: THREE.Color, k = 1): void {
    this.pos.push(x, y, z);
    this.col.push(c.r * k, c.g * k, c.b * k);
  }
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: THREE.Color, k = 1): void {
    this.v(ax, ay, az, c, k); this.v(bx, by, bz, c, k);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function colliderColor(c: ColliderRec): THREE.Color {
  if (!c.on) return COL.disabled;
  if (c.desc.cover === 'low') return COL.coverLow;
  if (c.desc.cover === 'high') return COL.coverHigh;
  const m = c.mask;
  if (!(m & RAY_MOVE)) return COL.ghost;
  if (!(m & RAY_SIGHT)) return COL.seeThrough;
  return COL.solid;
}

function drawSurface(s: SurfaceRec, lines: Batch, fills: Batch): void {
  const c = s.ramp ? COL.ramp : COL.surface;
  const dim = s.on ? 1 : 0.3;
  if (s.isDisc) {
    const y = s.yMid + LIFT;
    for (let i = 0; i < DISC_SEGS; i++) {
      const a0 = (i / DISC_SEGS) * Math.PI * 2, a1 = ((i + 1) / DISC_SEGS) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const ox0 = s.cx + c0 * s.r, oz0 = s.cz + s0 * s.r, ox1 = s.cx + c1 * s.r, oz1 = s.cz + s1 * s.r;
      const ix0 = s.cx + c0 * s.inner, iz0 = s.cz + s0 * s.inner, ix1 = s.cx + c1 * s.inner, iz1 = s.cz + s1 * s.inner;
      lines.line(ox0, y, oz0, ox1, y, oz1, c, dim);
      if (s.inner > 0) lines.line(ix0, y, iz0, ix1, y, iz1, c, dim);
      fills.v(ix0, y, iz0, c, dim); fills.v(ox0, y, oz0, c, dim); fills.v(ox1, y, oz1, c, dim);
      if (s.inner > 0) { fills.v(ix0, y, iz0, c, dim); fills.v(ox1, y, oz1, c, dim); fills.v(ix1, y, iz1, c, dim); }
    }
    return;
  }
  // rect corners: local (±hx, ±hz) → world; local -Z edge is at height y, +Z edge at y1
  const px: number[] = [], py: number[] = [], pz: number[] = [];
  const corners: Array<[number, number]> = [[-s.hx, -s.hz], [s.hx, -s.hz], [s.hx, s.hz], [-s.hx, s.hz]];
  for (const [lx, lz] of corners) {
    px.push(s.cx + lx * s.cos + lz * s.sin);
    pz.push(s.cz - lx * s.sin + lz * s.cos);
    py.push(s.yMid + s.k * lz + LIFT);
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    lines.line(px[i], py[i], pz[i], px[j], py[j], pz[j], c, dim);
  }
  fills.v(px[0], py[0], pz[0], c, dim); fills.v(px[3], py[3], pz[3], c, dim); fills.v(px[2], py[2], pz[2], c, dim);
  fills.v(px[0], py[0], pz[0], c, dim); fills.v(px[2], py[2], pz[2], c, dim); fills.v(px[1], py[1], pz[1], c, dim);
  if (s.ramp) {
    // chevrons pointing uphill
    const up = s.k > 0 ? 1 : -1;
    const n = Math.max(2, Math.round(s.hz / 1.5));
    for (let i = 0; i < n; i++) {
      const lz = (-s.hz + ((i + 0.5) / n) * 2 * s.hz);
      const tipZ = lz + up * Math.min(0.6, s.hz / n), wing = Math.min(s.hx * 0.6, 1.2);
      const pt = (lx: number, z: number): [number, number, number] =>
        [s.cx + lx * s.cos + z * s.sin, s.yMid + s.k * z + LIFT, s.cz - lx * s.sin + z * s.cos];
      const tip = pt(0, tipZ), l = pt(-wing, lz), r = pt(wing, lz);
      lines.line(l[0], l[1], l[2], tip[0], tip[1], tip[2], c, dim);
      lines.line(r[0], r[1], r[2], tip[0], tip[1], tip[2], c, dim);
    }
  }
}

function drawCollider(core: PhysicsCore, c: ColliderRec, lines: Batch, fills: Batch): void {
  const col = colliderColor(c);
  const y0 = c.yMin, y1 = c.yMax;
  const ring: Array<[number, number]> = [];
  if (c.isBox) {
    const corners: Array<[number, number]> = [[-c.hx, -c.hz], [c.hx, -c.hz], [c.hx, c.hz], [-c.hx, c.hz]];
    for (const [lx, lz] of corners) ring.push([c.cx + lx * c.cos + lz * c.sin, c.cz - lx * c.sin + lz * c.cos]);
  } else {
    for (let i = 0; i < CYL_SEGS; i++) {
      const a = (i / CYL_SEGS) * Math.PI * 2;
      ring.push([c.cx + Math.cos(a) * c.r, c.cz + Math.sin(a) * c.r]);
    }
  }
  const n = ring.length;
  const posts = c.isBox ? 1 : 5;
  // A solid capped by a walkable surface (deck slab, ramp under-fill, plinth) is structure, not an obstacle
  // someone meets at its top: dimmed outline, no faces.
  const cap = core.groundY(c.cx, c.cz, c.yMax, 0.55);
  const filler = cap === cap && cap >= c.yMax - 0.05;
  const k = filler ? 0.45 : 1;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    lines.line(a[0], y0, a[1], b[0], y0, b[1], col, 0.6 * k);
    lines.line(a[0], y1, a[1], b[0], y1, b[1], col, k);
    if (i % posts === 0) lines.line(a[0], y0, a[1], a[0], y1, a[1], col, 0.6 * k);
    if (filler) continue;
    // top cap fan + side quads (translucent)
    if (i > 0 && i < n - 1) {
      fills.v(ring[0][0], y1, ring[0][1], col); fills.v(b[0], y1, b[1], col); fills.v(a[0], y1, a[1], col);
    }
    fills.v(a[0], y0, a[1], col, 0.5); fills.v(b[0], y0, b[1], col, 0.5); fills.v(b[0], y1, b[1], col, 0.5);
    fills.v(a[0], y0, a[1], col, 0.5); fills.v(b[0], y1, b[1], col, 0.5); fills.v(a[0], y1, a[1], col, 0.5);
  }
}

function drawTrigger(t: TriggerRec, lines: Batch): void {
  const s = t.shape;
  const col = t.on ? COL.trigger : COL.disabled;
  const y0 = s.yMin ?? 0, y1 = s.yMax ?? y0 + 2;
  const ring: Array<[number, number]> = [];
  if (s.kind === 'circle') {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      ring.push([s.x + Math.cos(a) * s.r, s.z + Math.sin(a) * s.r]);
    }
  } else if (s.kind === 'box') {
    const yaw = s.yaw ?? 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const corners: Array<[number, number]> = [[-s.hx, -s.hz], [s.hx, -s.hz], [s.hx, s.hz], [-s.hx, s.hz]];
    for (const [lx, lz] of corners) ring.push([s.x + lx * cs + lz * sn, s.z - lx * sn + lz * cs]);
  }
  const n = ring.length;
  const posts = n > 4 ? 8 : 1;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    lines.line(a[0], y0 + LIFT, a[1], b[0], y0 + LIFT, b[1], col);
    lines.line(a[0], y1, a[1], b[0], y1, b[1], col, 0.5);
    if (i % posts === 0) lines.line(a[0], y0 + LIFT, a[1], a[0], y1, a[1], col, 0.5);
  }
}

/** Build the persistent debug group for a physics world. */
export function createPhysicsDebug(core: PhysicsCore, nav: NavGridImpl): THREE.Group {
  const group = new THREE.Group();
  group.name = 'physics-debug';

  const fillMat = (opacity: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, toneMapped: false,
  });
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, toneMapped: false });
  const navMat = new THREE.PointsMaterial({
    color: COL.nav, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false,
  });
  const floors = new THREE.Mesh(new THREE.BufferGeometry(), fillMat(0.14));
  const solids = new THREE.Mesh(new THREE.BufferGeometry(), fillMat(0.13));
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  const dots = new THREE.Points(new THREE.BufferGeometry(), navMat);
  floors.name = 'surfaces'; solids.name = 'solids'; lines.name = 'lines'; dots.name = 'nav';
  floors.renderOrder = 900; dots.renderOrder = 901; solids.renderOrder = 902; lines.renderOrder = 903;
  for (const o of [floors, solids, lines, dots]) o.frustumCulled = false;
  group.add(floors, solids, lines, dots);

  let key = '';
  const refresh = (): void => {
    const k = `${core.revision}:${core.triggerRevision}:${nav.buildId}`;
    if (k === key) return;
    key = k;
    const lb = new Batch(), fb = new Batch(), sb = new Batch();
    for (const s of core.surfaces) drawSurface(s, lb, fb);
    for (const c of core.colliders) drawCollider(core, c, lb, sb);
    for (const t of core.triggers) if (t.alive) drawTrigger(t, lb);
    floors.geometry.dispose();
    solids.geometry.dispose();
    lines.geometry.dispose();
    dots.geometry.dispose();
    floors.geometry = fb.geometry();
    solids.geometry = sb.geometry();
    lines.geometry = lb.geometry();
    const pts: number[] = [];
    nav.debugNodes(pts);
    for (let i = 1; i < pts.length; i += 3) pts[i] += LIFT * 2;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    dots.geometry = dg;
  };

  // Refresh just before the renderer walks the scene graph, so a held reference never goes stale.
  const base = group.updateMatrixWorld.bind(group);
  group.updateMatrixWorld = (force?: boolean): void => {
    if (group.visible) refresh();
    base(force);
  };
  group.userData.refresh = refresh;
  refresh();
  return group;
}
