/**
 * Debug drawing of the collision world as one self-refreshing THREE.Group of named layers:
 *
 *   'surfaces'  floors tinted by height level (ramps shaded along their slope, with uphill chevrons)
 *   'solids'    red; cover blue (low light / high dark); sight-through orange; move-through violet; disabled
 *               grey. Structure under a walkable top (deck slabs, ramp fill, plinths) is outlined faintly.
 *   'nav'       the nav grid as merged strips, tinted by level, darker where nodes hug an obstacle or an edge
 *   'triggers'  yellow (grey when disabled)
 *   'issues'    magenta pins at every `validate()` finding
 *
 * Each layer is rebuilt only when what it shows has changed (and only while it is visible), so a collider that
 * animates every frame costs one small buffer, not the whole view. Eight draw calls in total.
 *
 * This is the only module of the physics subsystem that touches three.js.
 */
import * as THREE from 'three';
import { RAY_MOVE, RAY_SIGHT } from '@/core/api/physics';
import type { PhysicsIssue } from '@/core/api/physics';
import type { ColliderRec, SurfaceRec, TriggerRec } from './shapes';
import { validate } from './validate';
import type { PhysicsCore } from './world';
import type { NavGridImpl } from './nav';

/** The layer names, in drawing order. */
export const DEBUG_LAYERS = ['surfaces', 'nav', 'solids', 'triggers', 'issues'] as const;
export type DebugLayer = typeof DEBUG_LAYERS[number];

const COL = {
  solid: new THREE.Color(0xff4b4b),
  coverLow: new THREE.Color(0x7cc4ff),
  coverHigh: new THREE.Color(0x2f6dff),
  seeThrough: new THREE.Color(0xffa033),
  ghost: new THREE.Color(0xc070ff),
  disabled: new THREE.Color(0x4a505c),
  trigger: new THREE.Color(0xffd84a),
  issue: new THREE.Color(0xff3df0),
};
const DISC_SEGS = 64;
const CYL_SEGS = 20;
const LIFT = 0.03;
/** frames the world must hold still before the (comparatively costly) issue scan is repeated */
const ISSUE_SETTLE = 20;

const scratch = new THREE.Color();
/**
 * Tint of a height level: green at 0, through teal to blue going up, toward yellow going down — so a balcony,
 * the floor under it and a sunken court are told apart at a glance. `light` 0..1 brightens (ramps, nav).
 */
function levelColor(y: number, light: number): THREE.Color {
  const t = Math.max(-1, Math.min(1, y / 6));
  const hue = t >= 0 ? 0.39 + t * 0.2 : 0.39 + t * 0.24;
  return scratch.setHSL(hue, 0.62, 0.5 + light * 0.22);
}

/** Growable position / colour buffers for one primitive batch. */
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
  if (!(c.mask & RAY_MOVE)) return COL.ghost;
  if (!(c.mask & RAY_SIGHT)) return COL.seeThrough;
  return COL.solid;
}

function drawSurface(s: SurfaceRec, lines: Batch, fills: Batch): void {
  const dim = s.on ? 1 : 0.3;
  if (s.isDisc) {
    const y = s.yMid + LIFT;
    const c = levelColor(s.yMid, 0);
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
  const cr: number[] = [], cg: number[] = [], cb: number[] = [];
  const corners: Array<[number, number]> = [[-s.hx, -s.hz], [s.hx, -s.hz], [s.hx, s.hz], [-s.hx, s.hz]];
  for (const [lx, lz] of corners) {
    const h = s.yMid + s.k * lz;
    px.push(s.cx + lx * s.cos + lz * s.sin);
    pz.push(s.cz - lx * s.sin + lz * s.cos);
    py.push(h + LIFT);
    const c = levelColor(h, s.ramp ? 0.6 : 0); // a ramp runs through the tints of the levels it joins
    cr.push(c.r * dim); cg.push(c.g * dim); cb.push(c.b * dim);
  }
  const put = (b: Batch, i: number): void => { b.pos.push(px[i], py[i], pz[i]); b.col.push(cr[i], cg[i], cb[i]); };
  for (let i = 0; i < 4; i++) { put(lines, i); put(lines, (i + 1) % 4); }
  for (const i of [0, 3, 2, 0, 2, 1]) put(fills, i);
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
      const c = levelColor(tip[1], 1);
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
  // someone meets at its top: a faint top outline only, so stepped ramp fill does not read as noise.
  const cap = core.groundY(c.cx, c.cz, c.yMax, 0.55);
  const filler = cap === cap && cap >= c.yMax - 0.05;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (filler) { lines.line(a[0], y1, a[1], b[0], y1, b[1], col, 0.3); continue; }
    lines.line(a[0], y0, a[1], b[0], y0, b[1], col, 0.6);
    lines.line(a[0], y1, a[1], b[0], y1, b[1], col);
    if (i % posts === 0) lines.line(a[0], y0, a[1], a[0], y1, a[1], col, 0.6);
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

/** A pin with a diamond head over the spot, and a ring on the ground around it. */
function drawIssue(p: PhysicsIssue, lines: Batch): void {
  const c = COL.issue;
  const top = p.y + 2.6, r = 0.35;
  lines.line(p.x, p.y + LIFT, p.z, p.x, top - r, p.z, c);
  const d: Array<[number, number, number]> = [[r, 0, 0], [0, r, 0], [-r, 0, 0], [0, -r, 0], [0, 0, r], [0, r, 0], [0, 0, -r], [0, -r, 0]];
  for (let i = 0; i < 4; i++) {
    const a = d[i], b = d[(i + 1) % 4], e = d[4 + i], f = d[4 + ((i + 1) % 4)];
    lines.line(p.x + a[0], top + a[1], p.z + a[2], p.x + b[0], top + b[1], p.z + b[2], c);
    lines.line(p.x + e[0], top + e[1], p.z + e[2], p.x + f[0], top + f[1], p.z + f[2], c);
  }
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
    lines.line(p.x + Math.cos(a0) * 0.6, p.y + LIFT, p.z + Math.sin(a0) * 0.6, p.x + Math.cos(a1) * 0.6, p.y + LIFT, p.z + Math.sin(a1) * 0.6, c, 0.7);
  }
}

/** What `debugObject().userData` offers besides the layers themselves. */
export interface PhysicsDebugApi {
  /** show / hide one layer; false when there is no layer of that name */
  layer(name: string, visible: boolean): boolean;
  /** bring every visible layer up to date now (the group also does this by itself before it is rendered) */
  refresh(): void;
  /** the result of the last `validate()` scan (what the 'issues' layer shows) */
  issues: PhysicsIssue[];
  /** positions of all nav nodes as x, y, z triples (for overlays that colour the grid by some query) */
  navNodes(): number[];
}

/** Build the persistent debug group for a physics world. */
export function createPhysicsDebug(core: PhysicsCore, nav: NavGridImpl): THREE.Group {
  const group = new THREE.Group();
  group.name = 'physics-debug';

  const fillMat = (opacity: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, toneMapped: false,
  });
  const lineMat = (opacity: number): THREE.LineBasicMaterial =>
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, toneMapped: false });

  /** One layer: a named group holding an optional translucent fill and an optional line set. */
  const makeLayer = (name: DebugLayer, order: number, fillOpacity: number, lineOpacity: number): {
    root: THREE.Group; set(fills: Batch | null, lines: Batch | null): void;
  } => {
    const root = new THREE.Group();
    root.name = name;
    const fill = fillOpacity > 0 ? new THREE.Mesh(new THREE.BufferGeometry(), fillMat(fillOpacity)) : null;
    const line = lineOpacity > 0 ? new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(lineOpacity)) : null;
    if (fill) { fill.name = `${name}:fill`; fill.renderOrder = 900 + order * 2; fill.frustumCulled = false; root.add(fill); }
    if (line) { line.name = `${name}:lines`; line.renderOrder = 901 + order * 2; line.frustumCulled = false; root.add(line); }
    group.add(root);
    return {
      root,
      set(fills, lines): void {
        if (fill && fills) { fill.geometry.dispose(); fill.geometry = fills.geometry(); }
        if (line && lines) { line.geometry.dispose(); line.geometry = lines.geometry(); }
      },
    };
  };

  const surfaces = makeLayer('surfaces', 0, 0.12, 0.9);
  const navLayer = makeLayer('nav', 1, 0.34, 0);
  const solids = makeLayer('solids', 2, 0.13, 0.95);
  const triggers = makeLayer('triggers', 3, 0, 0.95);
  const issues = makeLayer('issues', 4, 0, 1);

  const api: PhysicsDebugApi = {
    layer(name, visible): boolean {
      const l = group.children.find((c) => c.name === name);
      if (!l) return false;
      l.visible = visible;
      return true;
    },
    refresh(): void { update(true); },
    issues: [],
    navNodes(): number[] {
      const out: number[] = [];
      nav.debugNodes(out);
      return out;
    },
  };

  let surfKey = -1, solidKey = '', trigKey = -1, navKey = -1;
  let issueKey = '', issueSeen = '', settled = 0;

  const update = (force: boolean): void => {
    if (surfaces.root.visible && surfKey !== core.surfaceRevision) {
      surfKey = core.surfaceRevision;
      const lb = new Batch(), fb = new Batch();
      for (const s of core.surfaces) drawSurface(s, lb, fb);
      surfaces.set(fb, lb);
    }
    // solids also depend on the surfaces: whether one is capped by a walkable top
    const sk = `${core.solidRevision}:${core.surfaceRevision}`;
    if (solids.root.visible && solidKey !== sk) {
      solidKey = sk;
      const lb = new Batch(), fb = new Batch();
      for (const c of core.colliders) drawCollider(core, c, lb, fb);
      solids.set(fb, lb);
    }
    if (triggers.root.visible && trigKey !== core.triggerRevision) {
      trigKey = core.triggerRevision;
      const lb = new Batch();
      for (const t of core.triggers) if (t.alive) drawTrigger(t, lb);
      triggers.set(null, lb);
    }
    if (navLayer.root.visible && navKey !== nav.buildId) {
      navKey = nav.buildId;
      const fb = new Batch();
      const half = nav.cellSize * 0.5, depth = nav.cellSize * 0.3;
      nav.debugStrips((x0, x1, z, y, tight) => {
        const c = levelColor(y, 0.25), k = tight ? 0.4 : 1, yy = y + LIFT * 2;
        const a = x0 - half + 0.05, b = x1 + half - 0.05;
        fb.v(a, yy, z - depth, c, k); fb.v(a, yy, z + depth, c, k); fb.v(b, yy, z + depth, c, k);
        fb.v(a, yy, z - depth, c, k); fb.v(b, yy, z + depth, c, k); fb.v(b, yy, z - depth, c, k);
      });
      navLayer.set(fb, null);
    }
    if (issues.root.visible && issueKey !== sk) {
      // the scan costs milliseconds: wait until the world has stopped changing (a door mid-swing would
      // otherwise trigger it every frame)
      if (issueSeen === sk) settled++; else { issueSeen = sk; settled = 0; }
      if (force || settled >= ISSUE_SETTLE) {
        issueKey = sk;
        api.issues = validate(core);
        const lb = new Batch();
        for (const p of api.issues) drawIssue(p, lb);
        issues.set(null, lb);
      }
    }
  };

  // Refresh just before the renderer walks the scene graph, so a held reference never goes stale.
  const base = group.updateMatrixWorld.bind(group);
  group.updateMatrixWorld = (force?: boolean): void => {
    if (group.visible) update(false);
    base(force);
  };
  Object.assign(group.userData, api);
  // `issues` is replaced on every scan: expose the live value, not the first array
  Object.defineProperty(group.userData, 'issues', { get: () => api.issues, enumerable: true, configurable: true });
  update(true);
  return group;
}
