/**
 * Geometry helpers for the hero props (OWNER: hero-props).
 *
 * `Parts` collects transformed sub-geometries per material slot and merges each slot into ONE buffer — one draw
 * call per material, which is how every prop stays inside its draw-call budget. Everything leaving this module
 * is non-indexed with `position`, `normal` and `color` (vertex tint); slots that feed a reveal shader also carry
 * `aT` (0…1 order along the pattern).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mulberry32 } from '@/core/mathx';

/** A transform applied to a sub-geometry before merging: position, XYZ euler (radians), scale. */
export interface Xf {
  p?: readonly [number, number, number];
  r?: readonly [number, number, number];
  s?: number | readonly [number, number, number];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Compose an {@link Xf} into a matrix. */
export function xfMatrix(t: Xf | undefined, out: THREE.Matrix4 = new THREE.Matrix4()): THREE.Matrix4 {
  if (!t) return out.identity();
  _p.set(t.p?.[0] ?? 0, t.p?.[1] ?? 0, t.p?.[2] ?? 0);
  _e.set(t.r?.[0] ?? 0, t.r?.[1] ?? 0, t.r?.[2] ?? 0, 'XYZ');
  _q.setFromEuler(_e);
  if (typeof t.s === 'number') _s.setScalar(t.s);
  else _s.set(t.s?.[0] ?? 1, t.s?.[1] ?? 1, t.s?.[2] ?? 1);
  return out.compose(_p, _q, _s);
}

function flipWinding(g: THREE.BufferGeometry): void {
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name] as THREE.BufferAttribute;
    const arr = at.array as Float32Array;
    const n = at.itemSize;
    for (let i = 0; i + 3 * n <= arr.length; i += 3 * n) {
      for (let k = 0; k < n; k++) {
        const t = arr[i + n + k];
        arr[i + n + k] = arr[i + 2 * n + k];
        arr[i + 2 * n + k] = t;
      }
    }
  }
}

/**
 * Normalise a geometry for merging: non-indexed, only position / normal / color (/ aT), transformed and tinted.
 * `flat` recomputes face normals (crisp facets). The source geometry is consumed.
 */
export function prep(src: THREE.BufferGeometry, t?: Xf, tint = 0xffffff, flat = false): THREE.BufferGeometry {
  let g = src;
  if (g.index) {
    g = src.toNonIndexed();
    src.dispose();
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'aT') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  g.clearGroups();
  if (t) {
    xfMatrix(t, _m);
    g.applyMatrix4(_m);
    if (_m.determinant() < 0) flipWinding(g);
  }
  if (flat || !g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  const col = new Float32Array(count * 3);
  _c.setHex(tint);
  for (let i = 0; i < count; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Give every vertex the same reveal order value (or keep an existing `aT`). */
export function withT(g: THREE.BufferGeometry, t: number): THREE.BufferGeometry {
  if (!g.attributes.aT) {
    const arr = new Float32Array(g.attributes.position.count).fill(t);
    g.setAttribute('aT', new THREE.BufferAttribute(arr, 1));
  }
  return g;
}

/** Per-material geometry collector. */
export class Parts {
  private readonly slots = new Map<string, THREE.BufferGeometry[]>();

  /** add any geometry (consumed) */
  add(slot: string, geo: THREE.BufferGeometry, t?: Xf, tint?: number, flat?: boolean): this {
    let list = this.slots.get(slot);
    if (!list) this.slots.set(slot, (list = []));
    list.push(prep(geo, t, tint, flat));
    return this;
  }

  /** add a geometry that already went through {@link prep} (keeps its vertex tints) */
  raw(slot: string, prepped: THREE.BufferGeometry): this {
    let list = this.slots.get(slot);
    if (!list) this.slots.set(slot, (list = []));
    list.push(prepped);
    return this;
  }

  /** apply a further matrix to the geometry most recently added to a slot */
  xform(slot: string, m: THREE.Matrix4): this {
    const list = this.slots.get(slot);
    if (list && list.length) list[list.length - 1].applyMatrix4(m);
    return this;
  }

  box(slot: string, w: number, h: number, d: number, t?: Xf, tint?: number): this {
    return this.add(slot, new THREE.BoxGeometry(w, h, d), t, tint);
  }

  /** box with chamfered edges (catches highlights) */
  bevel(slot: string, w: number, h: number, d: number, c: number, t?: Xf, tint?: number): this {
    return this.add(slot, chamferBox(w, h, d, c), t, tint);
  }

  /** cylinder / cone / faceted prism along Y */
  cyl(slot: string, rTop: number, rBot: number, h: number, seg: number, t?: Xf, tint?: number, flat = false, open = false): this {
    return this.add(slot, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), t, tint, flat);
  }

  has(slot: string): boolean {
    return (this.slots.get(slot)?.length ?? 0) > 0;
  }

  /** merged geometry of a slot (an empty geometry if the slot has nothing). Call once per slot. */
  geometry(slot: string): THREE.BufferGeometry {
    const list = this.slots.get(slot);
    this.slots.delete(slot);
    if (!list || list.length === 0) return new THREE.BufferGeometry();
    const reveal = list.some((g) => !!g.attributes.aT);
    if (reveal) for (const g of list) withT(g, 0);
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!merged) {
      console.warn(`[props] could not merge slot "${slot}"`);
      return list[0];
    }
    if (merged !== list[0]) for (const g of list) g.dispose();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  /** merged mesh of a slot */
  mesh(slot: string, material: THREE.Material, shadows = true): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry(slot), material);
    m.name = slot;
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    return m;
  }
}

/** Triangle soup builder with flat normals; triangles are oriented by a hint normal or away from a centre. */
export class Soup {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly ts: number[] = [];
  private useT = false;

  /** `hint`: outward direction used to fix the winding (default: away from the origin). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hint?: THREE.Vector3, n?: THREE.Vector3): this {
    _a.subVectors(b, a);
    _b.subVectors(c, a);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-14) return this;
    _n.normalize();
    let flip: boolean;
    if (hint) flip = _n.dot(hint) < 0;
    else flip = _n.dot(_a.copy(a).add(b).add(c)) < 0;
    if (flip) _n.negate();
    const nn = n ?? _n;
    const p1 = flip ? c : b, p2 = flip ? b : c;
    this.pos.push(a.x, a.y, a.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    this.nrm.push(nn.x, nn.y, nn.z, nn.x, nn.y, nn.z, nn.x, nn.y, nn.z);
    this.ts.push(0, 0, 0);
    return this;
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hint?: THREE.Vector3): this {
    return this.tri(a, b, c, hint).tri(a, c, d, hint);
  }

  /** quad with per-corner reveal values (a,b at t0 — c,d at t1) */
  quadT(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t0: number, t1: number, hint: THREE.Vector3): this {
    this.useT = true;
    const before = this.ts.length;
    this.tri(a, b, c, hint).tri(a, c, d, hint);
    // recover which corner each emitted vertex was: compare positions
    const tOf = (i: number): number => {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const near = (v: THREE.Vector3): boolean => Math.abs(v.x - x) + Math.abs(v.y - y) + Math.abs(v.z - z) < 1e-9;
      return near(a) || near(b) ? t0 : t1;
    };
    for (let i = before; i < this.ts.length; i++) this.ts[i] = tOf(i);
    return this;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (this.useT) g.setAttribute('aT', new THREE.Float32BufferAttribute(this.ts, 1));
    return g;
  }
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Box with 45° chamfers of size `c` on every edge (44 triangles, flat faces). */
export function chamferBox(w: number, h: number, d: number, c: number): THREE.BufferGeometry {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const cc = Math.max(0.0005, Math.min(c, hx * 0.49, hy * 0.49, hz * 0.49));
  const s = new Soup();
  const sg = [-1, 1];
  // vertex pushed out along `axis` for corner signs (sx, sy, sz)
  const vert = (axis: number, sx: number, sy: number, sz: number): THREE.Vector3 =>
    V(sx * (hx - (axis === 0 ? 0 : cc)), sy * (hy - (axis === 1 ? 0 : cc)), sz * (hz - (axis === 2 ? 0 : cc)));
  for (const a of sg) for (const b of sg) {
    if (b < 0) {
      // faces: the four corners sharing sign `a` on the face axis
      s.quad(vert(0, a, -1, -1), vert(0, a, 1, -1), vert(0, a, 1, 1), vert(0, a, -1, 1), V(a, 0, 0));
      s.quad(vert(1, -1, a, -1), vert(1, 1, a, -1), vert(1, 1, a, 1), vert(1, -1, a, 1), V(0, a, 0));
      s.quad(vert(2, -1, -1, a), vert(2, 1, -1, a), vert(2, 1, 1, a), vert(2, -1, 1, a), V(0, 0, a));
    }
    // the twelve edge chamfers and eight corner triangles
    s.quad(vert(0, a, b, -1), vert(0, a, b, 1), vert(1, a, b, 1), vert(1, a, b, -1), V(a, b, 0));
    s.quad(vert(1, -1, a, b), vert(1, 1, a, b), vert(2, 1, a, b), vert(2, -1, a, b), V(0, a, b));
    s.quad(vert(0, a, -1, b), vert(0, a, 1, b), vert(2, a, 1, b), vert(2, a, -1, b), V(a, 0, b));
    for (const e of sg) s.tri(vert(0, a, b, e), vert(1, a, b, e), vert(2, a, b, e), V(a, b, e));
  }
  return s.geometry();
}

export interface SweepOpts {
  /** segments around the full circle (scaled down for partial arcs) */
  seg?: number;
  /** arc start / end in radians, measured from +X toward −Z (counter-clockwise seen from above) */
  a0?: number;
  a1?: number;
  /** close the profile polygon (last point connects to the first) */
  closed?: boolean;
  /** flat caps on the two ends of a partial arc (closed, convex profiles only) */
  caps?: boolean;
}

/**
 * Sweep a profile of (radius, height) points around the Y axis: smooth around the circumference, hard edges
 * across the profile. List the profile so the solid lies to the LEFT of the direction of travel (for an outer
 * wall going up, then inward over the top: counter-clockwise with radius to the right and height up).
 */
export function sweep(profile: ReadonlyArray<readonly [number, number]>, o: SweepOpts = {}): THREE.BufferGeometry {
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2;
  const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
  const seg = Math.max(3, Math.round((o.seg ?? 64) * Math.min(1, Math.abs(a1 - a0) / (Math.PI * 2))));
  const pos: number[] = [], nrm: number[] = [];
  const n = profile.length;
  const edges = o.closed ? n : n - 1;
  for (let k = 0; k < edges; k++) {
    const [r0, y0] = profile[k];
    const [r1, y1] = profile[(k + 1) % n];
    let nr = y1 - y0, ny = -(r1 - r0);
    const len = Math.hypot(nr, ny);
    if (len < 1e-9) continue;
    nr /= len; ny /= len;
    for (let j = 0; j < seg; j++) {
      const ta = a0 + ((a1 - a0) * j) / seg, tb = a0 + ((a1 - a0) * (j + 1)) / seg;
      const ca = Math.cos(ta), sa = -Math.sin(ta), cb = Math.cos(tb), sb = -Math.sin(tb);
      // quad corners: (k, a) (k+1, a) (k+1, b) (k, b)
      const P = [
        r0 * ca, y0, r0 * sa, r1 * ca, y1, r1 * sa, r1 * cb, y1, r1 * sb,
        r0 * ca, y0, r0 * sa, r1 * cb, y1, r1 * sb, r0 * cb, y0, r0 * sb,
      ];
      const N = [
        nr * ca, ny, nr * sa, nr * ca, ny, nr * sa, nr * cb, ny, nr * sb,
        nr * ca, ny, nr * sa, nr * cb, ny, nr * sb, nr * cb, ny, nr * sb,
      ];
      // winding: make the geometric normal agree with the analytic one (diagonals, so that quads which
      // collapse to a triangle on the axis are still judged correctly)
      _a.set(P[6] - P[0], P[7] - P[1], P[8] - P[2]);
      _b.set(P[15] - P[3], P[16] - P[4], P[17] - P[5]);
      _n.crossVectors(_a, _b);
      const ok = _n.x * N[0] + _n.y * N[1] + _n.z * N[2] >= 0;
      if (!ok) {
        for (let v = 0; v < 18; v += 9) {
          for (let c = 0; c < 3; c++) {
            const tp = P[v + 3 + c]; P[v + 3 + c] = P[v + 6 + c]; P[v + 6 + c] = tp;
            const tn = N[v + 3 + c]; N[v + 3 + c] = N[v + 6 + c]; N[v + 6 + c] = tn;
          }
        }
      }
      pos.push(...P);
      nrm.push(...N);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (o.caps && o.closed && !full) {
    const s = new Soup();
    for (const [ang, dir] of [[a0, -1], [a1, 1]] as const) {
      const c = Math.cos(ang), sn = -Math.sin(ang);
      const hint = V(sn * dir * Math.sign(a1 - a0), 0, -c * dir * Math.sign(a1 - a0));
      const pts = profile.map(([r, y]) => V(r * c, y, r * sn));
      for (let k = 1; k + 1 < pts.length; k++) s.tri(pts[0], pts[k], pts[k + 1], hint);
    }
    const merged = mergeGeometries([g, s.geometry()], false);
    if (merged) return merged;
  }
  return g;
}

/** Rectangular-section hoop around Y: centre radius `r`, centre height `y`, radial width `w`, height `h`. */
export function hoop(r: number, y: number, w: number, h: number, o: SweepOpts = {}): THREE.BufferGeometry {
  const a = r - w / 2, b = r + w / 2, lo = y - h / 2, hi = y + h / 2;
  return sweep([[b, lo], [b, hi], [a, hi], [a, lo]], { closed: true, caps: true, ...o });
}

/**
 * Flat mitred ribbon along a polyline on the XZ plane (facing +Y) at height `y`, carrying `aT` from `t0` at the
 * first point to `t1` at the last (by length). Points are [x, z].
 */
export function strip(points: ReadonlyArray<readonly [number, number]>, width: number, y: number, t0 = 0, t1 = 1): THREE.BufferGeometry {
  const s = new Soup();
  const up = V(0, 1, 0);
  const n = points.length;
  if (n < 2) return s.geometry();
  const lens: number[] = [0];
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = lens[n - 1] || 1;
  const left: THREE.Vector3[] = [], right: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    const pa = points[Math.max(0, i - 1)], pb = points[Math.min(n - 1, i + 1)];
    let d1x = x - pa[0], d1z = z - pa[1], d2x = pb[0] - x, d2z = pb[1] - z;
    let l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    if (l1 < 1e-9) { d1x = d2x; d1z = d2z; l1 = l2; }
    if (l2 < 1e-9) { d2x = d1x; d2z = d1z; l2 = l1; }
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    // miter: average of the two segment normals, lengthened so the ribbon keeps its width
    let mx = -(d1z + d2z), mz = d1x + d2x;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cos = Math.max(0.35, mx * -d1z + mz * d1x);
    const hw = width / 2 / cos;
    left.push(V(x + mx * hw, y, z + mz * hw));
    right.push(V(x - mx * hw, y, z - mz * hw));
  }
  for (let i = 0; i + 1 < n; i++) {
    const ta = t0 + ((t1 - t0) * lens[i]) / total, tb = t0 + ((t1 - t0) * lens[i + 1]) / total;
    s.quadT(left[i], right[i], right[i + 1], left[i + 1], ta, tb, up);
  }
  return s.geometry();
}

/** Thin tube along a smooth curve through `points`, carrying `aT` from `t0` to `t1` along its length. */
export function tube(points: THREE.Vector3[], radius: number, t0 = 0, t1 = 1, radial = 4): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const src = new THREE.TubeGeometry(curve, Math.max(2, (points.length - 1) * 6), radius, radial, false);
  const g = src.toNonIndexed();
  src.dispose();
  const uv = g.attributes.uv.array as Float32Array;
  const at = new Float32Array(g.attributes.position.count);
  for (let i = 0; i < at.length; i++) at[i] = t0 + (t1 - t0) * uv[i * 2];
  g.setAttribute('aT', new THREE.BufferAttribute(at, 1));
  g.deleteAttribute('uv');
  return g;
}

/** Flat annulus sector on the XZ plane facing +Y at height `y` (angles from +X toward −Z). */
export function flatRing(rIn: number, rOut: number, y: number, a0 = 0, a1 = Math.PI * 2, seg = 48): THREE.BufferGeometry {
  return sweep([[rOut, y], [rIn, y]], { a0, a1, seg });
}

/** Extruded polygon (profile in XY, extruded along Z, centred on Z), optionally with a chamfer. */
export function prism(profile: ReadonlyArray<readonly [number, number]>, depth: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, steps: 1, curveSegments: 4,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

/** Irregular convex chunk (rubble, shards, debris), roughly radius 1. Deterministic per seed. */
export function rock(seed: number, flatness = 1, points = 11): THREE.BufferGeometry {
  const rnd = mulberry32(seed * 7919 + 13);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < points; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 0.72 + rnd() * 0.36;
    const q = Math.sqrt(1 - u * u);
    pts.push(V(q * Math.cos(th) * r, u * r * flatness, q * Math.sin(th) * r));
  }
  return new ConvexGeometry(pts);
}

/** Convex hull of arbitrary points (flat shaded). */
export function hull(points: ReadonlyArray<readonly [number, number, number]>): THREE.BufferGeometry {
  return new ConvexGeometry(points.map(([x, y, z]) => V(x, y, z)));
}

/**
 * Faceted star in the XY plane: `tips[i]` is the radius of point i (point 0 straight up, then counter-clockwise),
 * valleys at `rIn`, the centre raised to ±`depth` along Z.
 */
export function starGeometry(tips: readonly number[], rIn: number, depth: number): THREE.BufferGeometry {
  const s = new Soup();
  const n = tips.length;
  const front = V(0, 0, -depth), back = V(0, 0, depth);
  for (let i = 0; i < n; i++) {
    const at = Math.PI / 2 + (i / n) * Math.PI * 2;
    const tip = V(Math.cos(at) * tips[i], Math.sin(at) * tips[i], 0);
    for (const side of [-1, 1]) {
      const av = at + (side * Math.PI) / n;
      const valley = V(Math.cos(av) * rIn, Math.sin(av) * rIn, 0);
      s.tri(front, tip, valley, V(0, 0, -1));
      s.tri(back, tip, valley, V(0, 0, 1));
    }
  }
  return s.geometry();
}

/** Angle (radians, standard XY orientation) of star point `i` of an `n`-pointed star whose point 0 is up. */
export const starAngle = (i: number, n = 5): number => Math.PI / 2 + (i / n) * Math.PI * 2;
