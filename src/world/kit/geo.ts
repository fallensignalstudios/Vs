/**
 * Geo — the kit's immediate-mode geometry writer.
 *
 * Every kit piece is authored by pushing primitives (bevelled boxes, prisms, lathes, tubes, sweeps, ribbons)
 * through a small transform stack into flat position / normal arrays. Geometry is non-indexed with positions and
 * normals only (the material library maps textures triplanar, so no UVs), which makes the per-material merge in
 * `finalize()` a plain array copy.
 *
 * Local frame = three.js: +X right (east), +Y up, +Z south. "Bearing" angles used by ring helpers follow the plan
 * convention: 0 = north (−Z), increasing clockwise seen from above (toward +X).
 */
import * as THREE from 'three';

export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];

/** A cross-section frame for {@link Geo.sweep}: origin + the two unit axes the 2D profile is drawn in. */
export interface SweepFrame {
  p: V3;
  /** axis of profile coordinate 0 */
  u: V3;
  /** axis of profile coordinate 1 */
  v: V3;
  /** scale of profile coordinate 0 / 1 at this frame (default 1) */
  su?: number;
  sv?: number;
}

const _m = new THREE.Matrix4();
const _v2a: THREE.Vector2[] = [];

/** x of a plan bearing (0 = north, clockwise) on the unit circle */
export const bx = (a: number): number => Math.sin(a);
/** z of a plan bearing on the unit circle */
export const bz = (a: number): number => -Math.cos(a);

function signedArea(p: readonly V2[]): number {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

/** Counter-clockwise copy of a 2D polygon. */
function ccw(p: readonly V2[]): V2[] {
  return signedArea(p) < 0 ? p.slice().reverse() : p.slice();
}

function triangulate(p: readonly V2[]): number[][] {
  _v2a.length = 0;
  for (const q of p) _v2a.push(new THREE.Vector2(q[0], q[1]));
  return THREE.ShapeUtils.triangulateShape(_v2a, []);
}

/** Round the corners of a polyline with `steps` segments of radius `r` (pipes, conduits). */
export function filletPath(pts: readonly V3[], r: number, steps = 3): V3[] {
  if (pts.length < 3 || r <= 0) return pts.slice();
  const out: V3[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], d1 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const l0 = Math.hypot(d0[0], d0[1], d0[2]), l1 = Math.hypot(d1[0], d1[1], d1[2]);
    const k = Math.min(r, l0 * 0.45, l1 * 0.45);
    if (k < 1e-4) { out.push(b); continue; }
    const p0: V3 = [b[0] - (d0[0] / l0) * k, b[1] - (d0[1] / l0) * k, b[2] - (d0[2] / l0) * k];
    const p1: V3 = [b[0] + (d1[0] / l1) * k, b[1] + (d1[1] / l1) * k, b[2] + (d1[2] / l1) * k];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push([
        u * u * p0[0] + 2 * u * t * b[0] + t * t * p1[0],
        u * u * p0[1] + 2 * u * t * b[1] + t * t * p1[1],
        u * u * p0[2] + 2 * u * t * b[2] + t * t * p1[2],
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export class Geo {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  private m = new THREE.Matrix4();
  private readonly stack: THREE.Matrix4[] = [];

  get vertexCount(): number { return this.pos.length / 3; }
  get empty(): boolean { return this.pos.length === 0; }

  // ---- transform stack --------------------------------------------------------------------------------
  push(): this { this.stack.push(this.m.clone()); return this; }
  pop(): this { const m = this.stack.pop(); if (m) this.m = m; return this; }
  move(x: number, y: number, z: number): this { this.m.multiply(_m.makeTranslation(x, y, z)); return this; }
  rotX(a: number): this { this.m.multiply(_m.makeRotationX(a)); return this; }
  rotY(a: number): this { this.m.multiply(_m.makeRotationY(a)); return this; }
  rotZ(a: number): this { this.m.multiply(_m.makeRotationZ(a)); return this; }
  scl(x: number, y = x, z = x): this { this.m.multiply(_m.makeScale(x, y, z)); return this; }
  /** push + move (+ rotY): pair with pop() */
  at(x: number, y: number, z: number, ry = 0): this {
    this.push().move(x, y, z);
    return ry ? this.rotY(ry) : this;
  }

  // ---- raw emit ---------------------------------------------------------------------------------------
  private P(x: number, y: number, z: number): void {
    const e = this.m.elements;
    this.pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
  }

  private N(x: number, y: number, z: number): void {
    const e = this.m.elements;
    const nx = e[0] * x + e[4] * y + e[8] * z, ny = e[1] * x + e[5] * y + e[9] * z, nz = e[2] * x + e[6] * y + e[10] * z;
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nor.push(nx / l, ny / l, nz / l);
  }

  /** flat-shaded triangle, counter-clockwise seen from outside; degenerate triangles are dropped */
  tri(a: V3, b: V3, c: V3): this {
    const p = this.pos, i = p.length;
    this.P(a[0], a[1], a[2]); this.P(b[0], b[1], b[2]); this.P(c[0], c[1], c[2]);
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { p.length = i; return this; }
    for (let k = 0; k < 3; k++) this.nor.push(nx / l, ny / l, nz / l);
    return this;
  }

  quad(a: V3, b: V3, c: V3, d: V3): this { return this.tri(a, b, c).tri(a, c, d); }

  /** convex polygon (fan) */
  poly(pts: readonly V3[]): this {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1]);
    return this;
  }

  /** flat quad wound so that it faces `dir` (local) */
  quadFacing(a: V3, b: V3, c: V3, d: V3, dir: V3): this {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * dir[0] + (uz * vx - ux * vz) * dir[1] + (ux * vy - uy * vx) * dir[2];
    return dot >= 0 ? this.quad(a, b, c, d) : this.quad(a, d, c, b);
  }

  /** smooth-shaded triangle with explicit normals, wound to agree with them */
  triN(a: V3, na: V3, b: V3, nb: V3, c: V3, nc: V3): this {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-18) return this;
    const flip = cx * (na[0] + nb[0] + nc[0]) + cy * (na[1] + nb[1] + nc[1]) + cz * (na[2] + nb[2] + nc[2]) < 0;
    this.P(a[0], a[1], a[2]); this.N(na[0], na[1], na[2]);
    if (flip) {
      this.P(c[0], c[1], c[2]); this.N(nc[0], nc[1], nc[2]);
      this.P(b[0], b[1], b[2]); this.N(nb[0], nb[1], nb[2]);
    } else {
      this.P(b[0], b[1], b[2]); this.N(nb[0], nb[1], nb[2]);
      this.P(c[0], c[1], c[2]); this.N(nc[0], nc[1], nc[2]);
    }
    return this;
  }

  quadN(a: V3, na: V3, b: V3, nb: V3, c: V3, nc: V3, d: V3, nd: V3): this {
    return this.triN(a, na, b, nb, c, nc).triN(a, na, c, nc, d, nd);
  }

  /** convex solid from its faces: each face is wound automatically to point away from `centre` */
  hull(faces: readonly (readonly V3[])[], centre: V3): this {
    for (const f of faces) {
      if (f.length < 3) continue;
      let mx = 0, my = 0, mz = 0;
      for (const p of f) { mx += p[0]; my += p[1]; mz += p[2]; }
      mx = mx / f.length - centre[0]; my = my / f.length - centre[1]; mz = mz / f.length - centre[2];
      // Newell normal
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < f.length; i++) {
        const p = f[i], q = f[(i + 1) % f.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
      }
      this.poly(nx * mx + ny * my + nz * mz >= 0 ? f : f.slice().reverse());
    }
    return this;
  }

  // ---- boxes ------------------------------------------------------------------------------------------
  /** plain box centred on (cx, cy, cz); `noBottom` skips the face nobody sees */
  box(w: number, h: number, d: number, cx = 0, cy = 0, cz = 0, noBottom = false): this {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (!noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    return this;
  }

  /** plain box standing on y0 (cx, cz = footprint centre), no bottom face */
  boxOn(w: number, h: number, d: number, cx = 0, y0 = 0, cz = 0): this {
    return this.box(w, h, d, cx, y0 + h / 2, cz, true);
  }

  /** box with all twelve edges chamfered by `c`, centred on (cx, cy, cz) */
  cbox(w: number, h: number, d: number, c: number, cx = 0, cy = 0, cz = 0): this {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    c = Math.max(0.001, Math.min(c, hw * 0.49, hh * 0.49, hd * 0.49));
    const VX = (sx: number, sy: number, sz: number): V3 => [cx + sx * hw, cy + sy * (hh - c), cz + sz * (hd - c)];
    const VY = (sx: number, sy: number, sz: number): V3 => [cx + sx * (hw - c), cy + sy * hh, cz + sz * (hd - c)];
    const VZ = (sx: number, sy: number, sz: number): V3 => [cx + sx * (hw - c), cy + sy * (hh - c), cz + sz * hd];
    const faces: V3[][] = [];
    for (const s of [-1, 1]) {
      faces.push([VX(s, -1, -1), VX(s, 1, -1), VX(s, 1, 1), VX(s, -1, 1)]);
      faces.push([VY(-1, s, -1), VY(1, s, -1), VY(1, s, 1), VY(-1, s, 1)]);
      faces.push([VZ(-1, -1, s), VZ(1, -1, s), VZ(1, 1, s), VZ(-1, 1, s)]);
      for (const t of [-1, 1]) {
        faces.push([VX(s, t, -1), VX(s, t, 1), VY(s, t, 1), VY(s, t, -1)]);
        faces.push([VX(s, -1, t), VX(s, 1, t), VZ(s, 1, t), VZ(s, -1, t)]);
        faces.push([VY(-1, s, t), VY(1, s, t), VZ(1, s, t), VZ(-1, s, t)]);
        for (const r of [-1, 1]) faces.push([VX(s, t, r), VY(s, t, r), VZ(s, t, r)]);
      }
    }
    return this.hull(faces, [cx, cy, cz]);
  }

  /** chamfered box standing on y0 */
  cboxOn(w: number, h: number, d: number, c: number, cx = 0, y0 = 0, cz = 0): this {
    return this.cbox(w, h, d, c, cx, y0 + h / 2, cz);
  }

  /** box standing on y0 whose four TOP edges are chamfered by `c` (slabs, plinths, lids); no bottom face */
  tbox(w: number, h: number, d: number, c: number, cx = 0, y0 = 0, cz = 0): this {
    c = Math.max(0.001, Math.min(c, w * 0.49, d * 0.49, h * 0.95));
    return this.taperOn(w, d, w, d, h - c, cx, y0, cz, true).taperOn(w, d, w - 2 * c, d - 2 * c, c, cx, y0 + h - c, cz, false);
  }

  /** frustum standing on y0: bottom w0 × d0, top w1 × d1 (optionally shifted by ox, oz); no bottom face */
  taperOn(w0: number, d0: number, w1: number, d1: number, h: number, cx = 0, y0 = 0, cz = 0, noTop = false, ox = 0, oz = 0): this {
    const y1 = y0 + h;
    const b: V3[] = [[cx - w0 / 2, y0, cz - d0 / 2], [cx + w0 / 2, y0, cz - d0 / 2], [cx + w0 / 2, y0, cz + d0 / 2], [cx - w0 / 2, y0, cz + d0 / 2]];
    const t: V3[] = [[cx + ox - w1 / 2, y1, cz + oz - d1 / 2], [cx + ox + w1 / 2, y1, cz + oz - d1 / 2], [cx + ox + w1 / 2, y1, cz + oz + d1 / 2], [cx + ox - w1 / 2, y1, cz + oz + d1 / 2]];
    const faces: V3[][] = [];
    for (let i = 0; i < 4; i++) faces.push([b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]]);
    if (!noTop) faces.push(t);
    return this.hull(faces, [cx + ox / 2, y0 + h / 2, cz + oz / 2]);
  }

  /** irregular rubble block: a box whose corners are jittered by `j` (0..0.5 of the half size) */
  chunk(w: number, h: number, d: number, j: number, rand: () => number, cx = 0, cy = 0, cz = 0): this {
    const c: V3[] = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      c.push([cx + sx * (w / 2) * (1 - j * rand()), cy + sy * (h / 2) * (1 - j * rand()), cz + sz * (d / 2) * (1 - j * rand())]);
    }
    const q = (a: number, b: number, e: number, f: number, dir: V3): void => {
      this.triFacing(c[a], c[b], c[e], dir); this.triFacing(c[a], c[e], c[f], dir);
    };
    q(0, 1, 3, 2, [0, -1, 0]); q(4, 5, 7, 6, [0, 1, 0]);
    q(0, 1, 5, 4, [0, 0, -1]); q(2, 3, 7, 6, [0, 0, 1]);
    q(0, 2, 6, 4, [-1, 0, 0]); q(1, 3, 7, 5, [1, 0, 0]);
    return this;
  }

  private triFacing(a: V3, b: V3, c: V3, dir: V3): this {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * dir[0] + (uz * vx - ux * vz) * dir[1] + (ux * vy - uy * vx) * dir[2];
    return dot >= 0 ? this.tri(a, b, c) : this.tri(a, c, b);
  }

  // ---- prisms -----------------------------------------------------------------------------------------
  /** extrude an XY polygon (any winding, may be concave) along Z, centred on cz */
  prismZ(profile: readonly V2[], depth: number, cz = 0, caps = true): this {
    const p = ccw(profile), n = p.length, z0 = cz - depth / 2, z1 = cz + depth / 2;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
    }
    if (caps) {
      for (const t of triangulate(p)) {
        const a = p[t[0]], b = p[t[1]], c = p[t[2]];
        this.triFacing([a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1], [0, 0, 1]);
        this.triFacing([a[0], a[1], z0], [b[0], b[1], z0], [c[0], c[1], z0], [0, 0, -1]);
      }
    }
    return this;
  }

  /** extrude a ZY polygon along X, centred on cx */
  prismX(profile: readonly V2[], width: number, cx = 0, caps = true): this {
    this.push().move(cx, 0, 0).rotY(Math.PI / 2);
    this.prismZ(profile.map((q): V2 => [-q[0], q[1]]), width, 0, caps);
    return this.pop();
  }

  /** extrude a plan outline (x, z) from y0 up to y1 */
  prismY(outline: readonly V2[], y0: number, y1: number, top = true, bottom = false): this {
    const p = ccw(outline), n = p.length;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      this.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]]);
    }
    if (top || bottom) {
      for (const t of triangulate(p)) {
        const a = p[t[0]], b = p[t[1]], c = p[t[2]];
        if (top) this.triFacing([a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], [0, 1, 0]);
        if (bottom) this.triFacing([a[0], y0, a[1]], [b[0], y0, b[1]], [c[0], y0, c[1]], [0, -1, 0]);
      }
    }
    return this;
  }

  /** box standing on y0 with its four VERTICAL edges chamfered (pilasters, posts, pylons) */
  vbox(w: number, h: number, d: number, c: number, cx = 0, y0 = 0, cz = 0): this {
    c = Math.max(0.001, Math.min(c, w * 0.49, d * 0.49));
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    return this.prismY([[x0 + c, z0], [x1 - c, z0], [x1, z0 + c], [x1, z1 - c], [x1 - c, z1], [x0 + c, z1], [x0, z1 - c], [x0, z0 + c]], y0, y0 + h);
  }

  // ---- round things -----------------------------------------------------------------------------------
  /** conical band between two rings (y0, r0) → (y1, r1) about the Y axis at (cx, cz) */
  band(r0: number, y0: number, r1: number, y1: number, seg: number, cx = 0, cz = 0, smooth = true, a0 = 0, a1 = Math.PI * 2): this {
    const dy = y1 - y0, dr = r0 - r1, l = Math.hypot(dy, dr) || 1;
    // outward normal: radial part always ≥ 0, whichever way the band is traversed
    const ny = (dr / l) * (dy < 0 ? -1 : 1), nr = Math.abs(dy) / l;
    for (let i = 0; i < seg; i++) {
      const ta = a0 + ((a1 - a0) * i) / seg, tb = a0 + ((a1 - a0) * (i + 1)) / seg;
      const ca = bx(ta), sa = bz(ta), cb = bx(tb), sb = bz(tb);
      const p0: V3 = [cx + ca * r0, y0, cz + sa * r0], p1: V3 = [cx + cb * r0, y0, cz + sb * r0];
      const q0: V3 = [cx + ca * r1, y1, cz + sa * r1], q1: V3 = [cx + cb * r1, y1, cz + sb * r1];
      const na: V3 = [ca * nr, ny, sa * nr], nb: V3 = [cb * nr, ny, sb * nr];
      if (smooth) this.quadN(p0, na, q0, na, q1, nb, p1, nb);
      else {
        const tm = (ta + tb) / 2, nm: V3 = [bx(tm) * nr, ny, bz(tm) * nr];
        this.quadN(p0, nm, q0, nm, q1, nm, p1, nm);
      }
    }
    return this;
  }

  /** flat disc (or ring sector) facing up (dir = 1) or down (dir = −1) */
  cap(rIn: number, rOut: number, y: number, seg: number, dir: 1 | -1 = 1, cx = 0, cz = 0, a0 = 0, a1 = Math.PI * 2): this {
    const up: V3 = [0, dir, 0];
    for (let i = 0; i < seg; i++) {
      const ta = a0 + ((a1 - a0) * i) / seg, tb = a0 + ((a1 - a0) * (i + 1)) / seg;
      const o0: V3 = [cx + bx(ta) * rOut, y, cz + bz(ta) * rOut], o1: V3 = [cx + bx(tb) * rOut, y, cz + bz(tb) * rOut];
      if (rIn <= 1e-6) this.triFacing([cx, y, cz], o0, o1, up);
      else this.quadFacing([cx + bx(ta) * rIn, y, cz + bz(ta) * rIn], o0, o1, [cx + bx(tb) * rIn, y, cz + bz(tb) * rIn], up);
    }
    return this;
  }

  /** cylinder / cone standing on y0 (r0 bottom, r1 top) with a top cap */
  cyl(r0: number, r1: number, h: number, seg: number, cx = 0, y0 = 0, cz = 0, smooth = true, bottom = false): this {
    this.band(r0, y0, r1, y0 + h, seg, cx, cz, smooth);
    if (r1 > 1e-6) this.cap(0, r1, y0 + h, seg, 1, cx, cz);
    if (bottom && r0 > 1e-6) this.cap(0, r0, y0, seg, -1, cx, cz);
    return this;
  }

  /** surface of revolution from a (radius, y) profile; consecutive points form bands */
  lathe(profile: readonly V2[], seg: number, cx = 0, y0 = 0, cz = 0, smooth = true): this {
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i], b = profile[i + 1];
      if (Math.abs(a[1] - b[1]) < 1e-6) this.cap(Math.min(a[0], b[0]), Math.max(a[0], b[0]), y0 + a[1], seg, b[0] < a[0] ? 1 : -1, cx, cz);
      else this.band(a[0], y0 + a[1], b[0], y0 + b[1], seg, cx, cz, smooth);
    }
    return this;
  }

  /** sphere (or vertically squashed ellipsoid) centred on (cx, cy, cz) */
  ball(r: number, seg: number, cx = 0, cy = 0, cz = 0, ry = r): this {
    const rings = Math.max(3, seg >> 1), prof: V2[] = [];
    for (let i = 0; i <= rings; i++) {
      const t = -Math.PI / 2 + (Math.PI * i) / rings;
      prof.push([Math.max(0, Math.cos(t)) * r, Math.sin(t) * ry]);
    }
    for (let i = 0; i < rings; i++) {
      // per-ring normals from the true sphere, not the band slope
      const a = prof[i], b = prof[i + 1];
      for (let s = 0; s < seg; s++) {
        const ta = (Math.PI * 2 * s) / seg, tb = (Math.PI * 2 * (s + 1)) / seg;
        const P = (q: V2, t: number): V3 => [cx + bx(t) * q[0], cy + q[1], cz + bz(t) * q[0]];
        const Nn = (q: V2, t: number): V3 => [bx(t) * q[0], (q[1] * r) / ry, bz(t) * q[0]];
        this.quadN(P(a, ta), Nn(a, ta), P(b, ta), Nn(b, ta), P(b, tb), Nn(b, tb), P(a, tb), Nn(a, tb));
      }
    }
    return this;
  }

  /** solid annular sector between bearings a0..a1 (plan convention), y0..y1 */
  arcBand(rIn: number, rOut: number, a0: number, a1: number, y0: number, y1: number, seg: number, opts: { top?: boolean; bottom?: boolean; ends?: boolean; flat?: boolean } = {}): this {
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
    this.band(rOut, y0, rOut, y1, seg, 0, 0, !opts.flat, a0, a1);
    if (rIn > 1e-6) {
      for (let i = 0; i < seg; i++) {
        const ta = a0 + ((a1 - a0) * i) / seg, tb = a0 + ((a1 - a0) * (i + 1)) / seg;
        const na: V3 = [-bx(ta), 0, -bz(ta)], nb: V3 = [-bx(tb), 0, -bz(tb)];
        this.quadN([bx(ta) * rIn, y0, bz(ta) * rIn], na, [bx(ta) * rIn, y1, bz(ta) * rIn], na, [bx(tb) * rIn, y1, bz(tb) * rIn], nb, [bx(tb) * rIn, y0, bz(tb) * rIn], nb);
      }
    }
    if (opts.top !== false) this.cap(rIn, rOut, y1, seg, 1, 0, 0, a0, a1);
    if (opts.bottom) this.cap(rIn, rOut, y0, seg, -1, 0, 0, a0, a1);
    if (!full && opts.ends !== false) {
      for (const [t, s] of [[a0, -1], [a1, 1]] as const) {
        const dir: V3 = [s * Math.cos(t), 0, s * Math.sin(t)];
        this.quadFacing([bx(t) * rIn, y0, bz(t) * rIn], [bx(t) * rOut, y0, bz(t) * rOut], [bx(t) * rOut, y1, bz(t) * rOut], [bx(t) * rIn, y1, bz(t) * rIn], dir);
      }
    }
    return this;
  }

  // ---- paths ------------------------------------------------------------------------------------------
  /** round pipe along a polyline (smooth-shaded, mitred at the joints) */
  tube(path: readonly V3[], r: number, seg = 8, caps = false): this {
    const n = path.length;
    if (n < 2) return this;
    const T = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3(), prev = new THREE.Vector3(), tmp = new THREE.Vector3();
    const rings: Array<{ p: V3[]; n: V3[] }> = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], c = path[i];
      T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      if (i === 0) {
        U.set(0, 1, 0);
        if (Math.abs(T.y) > 0.9) U.set(1, 0, 0);
        U.sub(tmp.copy(T).multiplyScalar(U.dot(T))).normalize();
      } else {
        // parallel transport of the previous frame
        tmp.crossVectors(prev, T);
        const s = tmp.length();
        if (s > 1e-6) U.applyAxisAngle(tmp.divideScalar(s), Math.atan2(s, prev.dot(T)));
        U.sub(tmp.copy(T).multiplyScalar(U.dot(T))).normalize();
      }
      prev.copy(T);
      V.crossVectors(T, U);
      const ring = { p: [] as V3[], n: [] as V3[] };
      for (let k = 0; k < seg; k++) {
        const t = (Math.PI * 2 * k) / seg, cu = Math.cos(t), sv = Math.sin(t);
        const nx = U.x * cu + V.x * sv, ny = U.y * cu + V.y * sv, nz = U.z * cu + V.z * sv;
        ring.p.push([c[0] + nx * r, c[1] + ny * r, c[2] + nz * r]);
        ring.n.push([nx, ny, nz]);
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) {
      const A = rings[i], B = rings[i + 1];
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        this.quadN(A.p[k], A.n[k], B.p[k], B.n[k], B.p[k1], B.n[k1], A.p[k1], A.n[k1]);
      }
    }
    if (caps) {
      for (const [ring, i, j] of [[rings[0], 0, 1], [rings[n - 1], n - 1, n - 2]] as const) {
        const c = path[i], o = path[j], dir: V3 = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
        for (let k = 1; k < seg - 1; k++) this.triFacing(ring.p[0], ring.p[k], ring.p[k + 1], dir);
      }
    }
    return this;
  }

  /**
   * Flat strip of `width` along a polyline, lying in the plane ⟂ `up` and facing `up`, mitred at the joints.
   * `double` also emits the back face (free-standing strips on walls).
   */
  ribbon(path: readonly V3[], width: number, up: V3 = [0, 1, 0], closed = false, double = false): this {
    const n = path.length;
    if (n < 2) return this;
    const L: V3[] = [], R: V3[] = [];
    const dir = (a: V3, b: V3): [number, number, number] => {
      const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    for (let i = 0; i < n; i++) {
      const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
      const d0 = hasPrev ? dir(path[(i - 1 + n) % n], path[i]) : dir(path[i], path[i + 1]);
      const d1 = hasNext ? dir(path[i], path[(i + 1) % n]) : d0;
      let tx = d0[0] + d1[0], ty = d0[1] + d1[1], tz = d0[2] + d1[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // side = t × up
      let sx = ty * up[2] - tz * up[1], sy = tz * up[0] - tx * up[2], sz = tx * up[1] - ty * up[0];
      const sl = Math.hypot(sx, sy, sz) || 1;
      const cosHalf = Math.max(0.35, tx * d1[0] + ty * d1[1] + tz * d1[2]);
      const k = width / 2 / cosHalf / sl;
      sx *= k; sy *= k; sz *= k;
      const p = path[i];
      L.push([p[0] - sx, p[1] - sy, p[2] - sz]);
      R.push([p[0] + sx, p[1] + sy, p[2] + sz]);
    }
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      this.quadFacing(L[i], R[i], R[j], L[j], up);
      if (double) this.quadFacing(L[i], R[i], R[j], L[j], [-up[0], -up[1], -up[2]]);
    }
    return this;
  }

  /**
   * Sweep a closed 2D profile along frames. Shading is smooth along the sweep and hard across profile edges.
   * `capStart` / `capEnd` close the ends.
   */
  sweep(profile: readonly V2[], frames: readonly SweepFrame[], capStart = true, capEnd = true): this {
    const prof = ccw(profile), n = prof.length, f = frames.length;
    if (f < 2 || n < 3) return this;
    const pt = (fr: SweepFrame, q: V2): V3 => {
      const a = q[0] * (fr.su ?? 1), b = q[1] * (fr.sv ?? 1);
      return [fr.p[0] + fr.u[0] * a + fr.v[0] * b, fr.p[1] + fr.u[1] * a + fr.v[1] * b, fr.p[2] + fr.u[2] * a + fr.v[2] * b];
    };
    const nm = (fr: SweepFrame, du: number, dv: number): V3 => {
      // outward 2D normal of a CCW edge (du, dv) is (dv, −du)
      const a = dv, b = -du;
      return [fr.u[0] * a + fr.v[0] * b, fr.u[1] * a + fr.v[1] * b, fr.u[2] * a + fr.v[2] * b];
    };
    for (let i = 0; i < f - 1; i++) {
      const A = frames[i], B = frames[i + 1];
      for (let k = 0; k < n; k++) {
        const p = prof[k], q = prof[(k + 1) % n];
        const na = nm(A, q[0] - p[0], q[1] - p[1]), nb = nm(B, q[0] - p[0], q[1] - p[1]);
        this.quadN(pt(A, p), na, pt(A, q), na, pt(B, q), nb, pt(B, p), nb);
      }
    }
    const tris = capStart || capEnd ? triangulate(prof) : [];
    const capAt = (fr: SweepFrame, other: SweepFrame): void => {
      const dir: V3 = [fr.p[0] - other.p[0], fr.p[1] - other.p[1], fr.p[2] - other.p[2]];
      for (const t of tris) this.triFacing(pt(fr, prof[t[0]]), pt(fr, prof[t[1]]), pt(fr, prof[t[2]]), dir);
    };
    if (capStart) capAt(frames[0], frames[1]);
    if (capEnd) capAt(frames[f - 1], frames[f - 2]);
    return this;
  }

  // ---- output -----------------------------------------------------------------------------------------
  /** append another buffer (already in this buffer's space) */
  append(o: Geo): this {
    for (let i = 0; i < o.pos.length; i++) { this.pos.push(o.pos[i]); this.nor.push(o.nor[i]); }
    return this;
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
