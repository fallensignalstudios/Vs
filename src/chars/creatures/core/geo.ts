/**
 * Procedural modelling primitives for creatures and devices.
 *
 * Everything is a "soup": an un-indexed triangle list with an edge-wear flag per vertex. Primitives only emit
 * outward-wound positions; normals are computed once, after placement, by `computeNormals` (area-weighted with a
 * crease angle), which gives hard-surface parts flat faces with soft highlighted bevels and organic parts
 * fully smooth shading from the same code path.
 */
import * as THREE from 'three';
import { rand, vnoise } from './meshutil';

export { computeNormals, rand, vnoise } from './meshutil';

export interface Soup {
  /** xyz triples, three vertices per triangle */
  p: number[];
  /** per-vertex edge-wear flag 0..1 (bevel strips = 1) */
  e: number[];
  /** optional per-vertex parameter 0..1 along the primitive's length (tubes) — used for skin weights */
  u?: number[];
}

export type Pt2 = readonly [number, number];
export type Pt3 = readonly [number, number, number];

const TAU = Math.PI * 2;

export function emptySoup(): Soup {
  return { p: [], e: [] };
}

function pushV(s: Soup, x: number, y: number, z: number, e: number): void {
  s.p.push(x, y, z);
  s.e.push(e);
}

/** push a triangle as-is */
function tri(s: Soup, a: Pt3, b: Pt3, c: Pt3, ea = 0, eb = ea, ec = ea): void {
  pushV(s, a[0], a[1], a[2], ea);
  pushV(s, b[0], b[1], b[2], eb);
  pushV(s, c[0], c[1], c[2], ec);
}

/** push a triangle, flipping it if needed so it faces away from interior point o */
function triOut(s: Soup, a: Pt3, b: Pt3, c: Pt3, o: Pt3, e = 0): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + c[0]) / 3 - o[0], my = (a[1] + b[1] + c[1]) / 3 - o[1], mz = (a[2] + b[2] + c[2]) / 3 - o[2];
  if (nx * mx + ny * my + nz * mz >= 0) tri(s, a, b, c, e);
  else tri(s, a, c, b, e);
}

function quadOut(s: Soup, a: Pt3, b: Pt3, c: Pt3, d: Pt3, o: Pt3, e = 0): void {
  triOut(s, a, b, c, o, e);
  triOut(s, a, c, d, o, e);
}

function quad(s: Soup, a: Pt3, b: Pt3, c: Pt3, d: Pt3, ea = 0, eb = ea, ec = ea, ed = ea): void {
  tri(s, a, b, c, ea, eb, ec);
  tri(s, a, c, d, ea, ec, ed);
}

// ---------------------------------------------------------------------------------------------------------
// hard-surface primitives
// ---------------------------------------------------------------------------------------------------------

/** Chamfered box centred on the origin. `top` scales the +Y face in x/z (wedges, tapered housings). */
export function box(w: number, h: number, d: number, bevel = 0, top: Pt2 = [1, 1]): Soup {
  const s = emptySoup();
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const b = Math.min(bevel, hx * 0.49, hy * 0.49, hz * 0.49);
  const o: Pt3 = [0, 0, 0];
  const sc = (p: Pt3): Pt3 => {
    const t = (p[1] + hy) / h;
    return [p[0] * (1 + (top[0] - 1) * t), p[1], p[2] * (1 + (top[1] - 1) * t)];
  };
  if (b <= 1e-5) {
    const c = (sx: number, sy: number, sz: number): Pt3 => sc([sx * hx, sy * hy, sz * hz]);
    for (const sgn of [-1, 1]) {
      quadOut(s, c(sgn, -1, -1), c(sgn, 1, -1), c(sgn, 1, 1), c(sgn, -1, 1), o);
      quadOut(s, c(-1, sgn, -1), c(1, sgn, -1), c(1, sgn, 1), c(-1, sgn, 1), o);
      quadOut(s, c(-1, -1, sgn), c(1, -1, sgn), c(1, 1, sgn), c(-1, 1, sgn), o);
    }
    return s;
  }
  const px = (sx: number, sy: number, sz: number): Pt3 => sc([sx * hx, sy * (hy - b), sz * (hz - b)]);
  const py = (sx: number, sy: number, sz: number): Pt3 => sc([sx * (hx - b), sy * hy, sz * (hz - b)]);
  const pz = (sx: number, sy: number, sz: number): Pt3 => sc([sx * (hx - b), sy * (hy - b), sz * hz]);
  for (const g of [-1, 1]) {
    quadOut(s, px(g, -1, -1), px(g, 1, -1), px(g, 1, 1), px(g, -1, 1), o);
    quadOut(s, py(-1, g, -1), py(1, g, -1), py(1, g, 1), py(-1, g, 1), o);
    quadOut(s, pz(-1, -1, g), pz(1, -1, g), pz(1, 1, g), pz(-1, 1, g), o);
  }
  for (const a of [-1, 1]) {
    for (const c of [-1, 1]) {
      quadOut(s, px(a, c, -1), px(a, c, 1), py(a, c, 1), py(a, c, -1), o, 1); // x-y edges (along z)
      quadOut(s, px(a, -1, c), px(a, 1, c), pz(a, 1, c), pz(a, -1, c), o, 1); // x-z edges (along y)
      quadOut(s, py(-1, a, c), py(1, a, c), pz(1, a, c), pz(-1, a, c), o, 1); // y-z edges (along x)
      for (const k of [-1, 1]) triOut(s, px(a, c, k), py(a, c, k), pz(a, c, k), o, 1);
    }
  }
  return s;
}

function polyArea(o: readonly Pt2[]): number {
  let a = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i], q = o[(i + 1) % o.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** inset a CCW polygon by distance d (miter join, clamped) */
function inset(o: readonly Pt2[], d: number): Pt2[] {
  const n = o.length;
  const out: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const p = o[(i + n - 1) % n], c = o[i], q = o[(i + 1) % n];
    let e1x = c[0] - p[0], e1y = c[1] - p[1];
    let e2x = q[0] - c[0], e2y = q[1] - c[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // inward normals of a CCW polygon: (-ey, ex)
    const n1x = -e1y, n1y = e1x, n2x = -e2y, n2y = e2x;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const cos = Math.max(0.35, mx * n1x + my * n1y);
    out.push([c[0] + (mx * d) / cos, c[1] + (my * d) / cos]);
  }
  return out;
}

/** cut every corner of a polygon (chamfer distance c along each edge, limited to 40% of the edge) */
export function chamfer(o: readonly Pt2[], c: number): Pt2[] {
  const n = o.length;
  const out: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const p = o[(i + n - 1) % n], v = o[i], q = o[(i + 1) % n];
    const l1 = Math.hypot(v[0] - p[0], v[1] - p[1]) || 1, l2 = Math.hypot(q[0] - v[0], q[1] - v[1]) || 1;
    const c1 = Math.min(c, l1 * 0.4), c2 = Math.min(c, l2 * 0.4);
    out.push([v[0] + ((p[0] - v[0]) / l1) * c1, v[1] + ((p[1] - v[1]) / l1) * c1]);
    out.push([v[0] + ((q[0] - v[0]) / l2) * c2, v[1] + ((q[1] - v[1]) / l2) * c2]);
  }
  return out;
}

/**
 * Extruded polygon: outline in XY (any winding, may be concave), centred on z, front face at +depth/2.
 * `bevel` chamfers the front rim, `backBevel` the back rim (default = bevel; pass 0 for hidden backs).
 */
export function prism(outline: readonly Pt2[], depth: number, bevel = 0, backBevel = bevel): Soup {
  const s = emptySoup();
  const o = polyArea(outline) < 0 ? [...outline].reverse() : [...outline];
  const n = o.length;
  const zf = depth / 2, zb = -depth / 2;
  const bf = Math.min(bevel, depth * 0.45), bb = Math.min(backBevel, depth * 0.45);
  const front = bf > 1e-5 ? inset(o, bf) : o;
  const back = bb > 1e-5 ? inset(o, bb) : o;
  const tris = THREE.ShapeUtils.triangulateShape(o.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const t of tris) {
    const [i, j, k] = t as [number, number, number];
    tri(s, [front[i]![0], front[i]![1], zf], [front[j]![0], front[j]![1], zf], [front[k]![0], front[k]![1], zf]);
    tri(s, [back[i]![0], back[i]![1], zb], [back[k]![0], back[k]![1], zb], [back[j]![0], back[j]![1], zb]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = o[i]!, b = o[j]!;
    if (bf > 1e-5) {
      quad(s, [front[i]![0], front[i]![1], zf], [a[0], a[1], zf - bf], [b[0], b[1], zf - bf], [front[j]![0], front[j]![1], zf], 1);
    }
    quad(s, [a[0], a[1], zf - bf], [a[0], a[1], zb + bb], [b[0], b[1], zb + bb], [b[0], b[1], zf - bf], 0);
    if (bb > 1e-5) {
      quad(s, [a[0], a[1], zb + bb], [back[i]![0], back[i]![1], zb], [back[j]![0], back[j]![1], zb], [b[0], b[1], zb + bb], 1);
    }
  }
  return s;
}

/**
 * Surface of revolution about Y. `profile` runs bottom → top as [radius, y]; consecutive points form bands.
 * Bands listed in `edges` (by index of their lower point) are flagged as bevel strips.
 * `arc` < TAU makes an open shell (no end caps).
 */
export function lathe(profile: readonly Pt2[], segs: number, edges: readonly number[] = [], arc = TAU, arcStart = 0): Soup {
  const s = emptySoup();
  const closed = arc >= TAU - 1e-6;
  const pt = (i: number, k: number): Pt3 => {
    const a = arcStart + (arc * k) / segs;
    const [r, y] = profile[i]!;
    return [Math.cos(a) * r, y, -Math.sin(a) * r];
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const e = edges.includes(i) ? 1 : 0;
    const r0 = profile[i]![0], r1 = profile[i + 1]![0];
    for (let k = 0; k < segs; k++) {
      const k1 = closed ? (k + 1) % segs : k + 1;
      const a = pt(i, k), b = pt(i, k1), c = pt(i + 1, k1), d = pt(i + 1, k);
      if (r0 > 1e-6 && r1 > 1e-6) quad(s, a, b, c, d, e);
      else if (r0 > 1e-6) tri(s, a, b, c, e);
      else if (r1 > 1e-6) tri(s, a, c, d, e);
    }
  }
  return s;
}

/** Cylinder / cone frustum along Y, centred, with chamfered rims. */
export function cyl(rBottom: number, rTop: number, h: number, segs = 12, bevel = 0, phase = 0): Soup {
  const hy = h / 2;
  const b = Math.min(bevel, h * 0.45, Math.max(rBottom, rTop) * 0.45);
  const prof: Pt2[] = [[0, -hy]];
  const edges: number[] = [];
  if (b > 1e-5 && rBottom > b) {
    prof.push([rBottom - b, -hy], [rBottom, -hy + b]);
    edges.push(1);
  } else prof.push([rBottom, -hy]);
  if (b > 1e-5 && rTop > b) {
    edges.push(prof.length);
    prof.push([rTop, hy - b], [rTop - b, hy]);
  } else prof.push([rTop, hy]);
  prof.push([0, hy]);
  return lathe(prof, segs, edges, TAU, phase);
}

/** Rectangular-section ring in the XZ plane (crown bands, bezels). */
export function band(radius: number, radial: number, height: number, segs = 24, bevel = 0, arc = TAU, arcStart = 0): Soup {
  const ri = radius - radial / 2, ro = radius + radial / 2, hy = height / 2;
  const b = Math.min(bevel, radial * 0.45, height * 0.45);
  const closed = arc >= TAU - 1e-6;
  const prof: Pt2[] = b > 1e-5
    ? [[ri + b, -hy], [ro - b, -hy], [ro, -hy + b], [ro, hy - b], [ro - b, hy], [ri + b, hy], [ri, hy - b], [ri, -hy + b], [ri + b, -hy]]
    : [[ri, -hy], [ro, -hy], [ro, hy], [ri, hy], [ri, -hy]];
  const edges = b > 1e-5 ? [1, 3, 5, 7] : [];
  const s = lathe(prof, segs, edges, arc, arcStart);
  if (!closed) {
    for (const k of [0, 1]) {
      const a = arcStart + arc * k;
      const cx = Math.cos(a), cz = -Math.sin(a);
      const q: Pt3[] = [[cx * ri, -hy, cz * ri], [cx * ro, -hy, cz * ro], [cx * ro, hy, cz * ro], [cx * ri, hy, cz * ri]];
      const mid = arcStart + arc * 0.5;
      quadOut(s, q[0]!, q[1]!, q[2]!, q[3]!, [Math.cos(mid) * radius, 0, -Math.sin(mid) * radius]);
    }
  }
  return s;
}

/** Torus in the XZ plane. */
export function torus(radius: number, tube: number, segs = 24, sides = 8, arc = TAU): Soup {
  const s = emptySoup();
  const closed = arc >= TAU - 1e-6;
  const pt = (k: number, j: number): Pt3 => {
    const a = (arc * k) / segs, b = (TAU * j) / sides;
    const r = radius + Math.cos(b) * tube;
    return [Math.cos(a) * r, Math.sin(b) * tube, -Math.sin(a) * r];
  };
  for (let k = 0; k < segs; k++) {
    const k1 = closed ? (k + 1) % segs : k + 1;
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      quad(s, pt(k, j), pt(k1, j), pt(k1, j1), pt(k, j1));
    }
  }
  return s;
}

/**
 * Irregular crystal / structural shard along +Y: base at the origin, tip at y = len.
 * A faceted prism with a pointed tip and a chiselled base; `seed` skews the facets for asymmetry.
 */
export function shard(len: number, width: number, thick: number, seed = 1, sides = 5, tip = 0.3): Soup {
  const s = emptySoup();
  const rnd = rand(seed);
  const ring: Pt3[] = [];
  const ring2: Pt3[] = [];
  const y0 = len * (0.12 + rnd() * 0.1), y1 = len * (1 - tip - rnd() * 0.12);
  for (let i = 0; i < sides; i++) {
    const a = (TAU * (i + rnd() * 0.5)) / sides;
    const r = 0.75 + rnd() * 0.5;
    ring.push([Math.cos(a) * width * 0.5 * r, y0 + (rnd() - 0.5) * len * 0.08, Math.sin(a) * thick * 0.5 * r]);
    const r2 = 0.7 + rnd() * 0.4;
    ring2.push([Math.cos(a) * width * 0.5 * r2 * 0.8, y1 + (rnd() - 0.5) * len * 0.12, Math.sin(a) * thick * 0.5 * r2 * 0.8]);
  }
  const base: Pt3 = [(rnd() - 0.5) * width * 0.2, 0, 0];
  const apex: Pt3 = [(rnd() - 0.5) * width * 0.35, len, (rnd() - 0.5) * thick * 0.3];
  const o: Pt3 = [0, len * 0.5, 0];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    triOut(s, base, ring[i]!, ring[j]!, o, 0.6);
    quadOut(s, ring[i]!, ring[j]!, ring2[j]!, ring2[i]!, o, 0);
    triOut(s, ring2[i]!, ring2[j]!, apex, o, 0.8);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------
// organic primitives
// ---------------------------------------------------------------------------------------------------------

/** Icosphere (smooth when normals are computed with a wide crease). */
export function sphere(r: number, detail = 1): Soup {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const arr = g.getAttribute('position').array as ArrayLike<number>;
  const s = emptySoup();
  for (let i = 0; i < arr.length; i += 3) pushV(s, arr[i]!, arr[i + 1]!, arr[i + 2]!, 0);
  g.dispose();
  return s;
}

/** Lumpy tissue mass: an icosphere displaced by value noise and squashed. */
export function blob(r: number, detail = 2, lump = 0.25, seed = 1, squash: Pt3 = [1, 1, 1]): Soup {
  const s = sphere(1, detail);
  const off = seed * 17.31;
  for (let i = 0; i < s.p.length; i += 3) {
    const x = s.p[i]!, y = s.p[i + 1]!, z = s.p[i + 2]!;
    const k = r * (1 + lump * (vnoise(x * 1.7 + off, y * 1.7 - off, z * 1.7 + off * 0.5) * 2 - 1) + lump * 0.4 * (vnoise(x * 4.1 - off, y * 4.1, z * 4.1 + off) * 2 - 1));
    s.p[i] = x * k * squash[0];
    s.p[i + 1] = y * k * squash[1];
    s.p[i + 2] = z * k * squash[2];
  }
  return s;
}

/**
 * Swept tube through `path` with per-point radius. Emits `u` (0..1 along the path) for skin weighting.
 * `flatten` squashes the cross-section along the frame binormal (straps, blades).
 */
export function tube(path: readonly Pt3[], radius: number | readonly number[] | ((t: number) => number), sides = 6, caps = true, flatten = 1): Soup {
  const s: Soup = { p: [], e: [], u: [] };
  const n = path.length;
  if (n < 2) return s;
  const rad = (i: number): number => {
    const t = i / (n - 1);
    return typeof radius === 'number' ? radius : typeof radius === 'function' ? radius(t) : radius[Math.min(i, radius.length - 1)]!;
  };
  const tan = new THREE.Vector3(), nor = new THREE.Vector3(), bin = new THREE.Vector3(), prevT = new THREE.Vector3(), q = new THREE.Quaternion();
  const rings: Pt3[][] = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(n - 1, i + 1)]!;
    tan.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    if (i === 0) {
      nor.set(0, 1, 0);
      if (Math.abs(tan.y) > 0.9) nor.set(1, 0, 0);
      nor.addScaledVector(tan, -nor.dot(tan)).normalize();
    } else {
      q.setFromUnitVectors(prevT, tan);
      nor.applyQuaternion(q);
      nor.addScaledVector(tan, -nor.dot(tan)).normalize();
    }
    prevT.copy(tan);
    bin.crossVectors(tan, nor);
    const r = rad(i);
    const c = path[i]!;
    const ring: Pt3[] = [];
    for (let j = 0; j < sides; j++) {
      const a2 = (TAU * j) / sides;
      const cx = Math.cos(a2) * r, cy = Math.sin(a2) * r * flatten;
      ring.push([c[0] + nor.x * cx + bin.x * cy, c[1] + nor.y * cx + bin.y * cy, c[2] + nor.z * cx + bin.z * cy]);
    }
    rings.push(ring);
  }
  const pushU = (u: number, count: number): void => {
    for (let k = 0; k < count; k++) s.u!.push(u);
  };
  for (let i = 0; i < n - 1; i++) {
    const u0 = i / (n - 1), u1 = (i + 1) / (n - 1);
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      const a = rings[i]![j]!, b = rings[i]![j1]!, c = rings[i + 1]![j1]!, d = rings[i + 1]![j]!;
      tri(s, a, b, c); s.u!.push(u0, u0, u1);
      tri(s, a, c, d); s.u!.push(u0, u1, u1);
    }
  }
  if (caps) {
    for (const end of [0, n - 1]) {
      const c = path[end]!, ring = rings[end]!;
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        if (end === 0) tri(s, c, ring[j1]!, ring[j]!);
        else tri(s, c, ring[j]!, ring[j1]!);
        pushU(end === 0 ? 0 : 1, 3);
      }
    }
  }
  return s;
}

/** points along a quadratic bezier (inclusive), handy for cables and limbs */
export function arcPath(a: Pt3, ctrl: Pt3, b: Pt3, n: number): Pt3[] {
  const out: Pt3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, k = 1 - t;
    out.push([k * k * a[0] + 2 * k * t * ctrl[0] + t * t * b[0], k * k * a[1] + 2 * k * t * ctrl[1] + t * t * b[1], k * k * a[2] + 2 * k * t * ctrl[2] + t * t * b[2]]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// soup operations
// ---------------------------------------------------------------------------------------------------------

/** Split triangles (1 → 4) until no edge is longer than maxLen. Needed before bending flat plates. */
export function subdivide(s: Soup, maxLen: number, maxPasses = 4): Soup {
  let cur = s;
  for (let pass = 0; pass < maxPasses; pass++) {
    const out: Soup = { p: [], e: [], u: cur.u ? [] : undefined };
    let split = false;
    const P = cur.p, E = cur.e;
    for (let i = 0; i < P.length; i += 9) {
      const vi = i / 3;
      const a: Pt3 = [P[i]!, P[i + 1]!, P[i + 2]!], b: Pt3 = [P[i + 3]!, P[i + 4]!, P[i + 5]!], c: Pt3 = [P[i + 6]!, P[i + 7]!, P[i + 8]!];
      const lab = dist(a, b), lbc = dist(b, c), lca = dist(c, a);
      const ea = E[vi]!, eb = E[vi + 1]!, ec = E[vi + 2]!;
      if (Math.max(lab, lbc, lca) <= maxLen) {
        tri(out, a, b, c, ea, eb, ec);
        if (out.u) out.u.push(cur.u![vi]!, cur.u![vi + 1]!, cur.u![vi + 2]!);
        continue;
      }
      split = true;
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      const eab = (ea + eb) / 2, ebc = (eb + ec) / 2, eca = (ec + ea) / 2;
      tri(out, a, ab, ca, ea, eab, eca);
      tri(out, ab, b, bc, eab, eb, ebc);
      tri(out, ca, bc, c, eca, ebc, ec);
      tri(out, ab, bc, ca, eab, ebc, eca);
      if (out.u) {
        const ua = cur.u![vi]!, ub = cur.u![vi + 1]!, uc = cur.u![vi + 2]!;
        const uab = (ua + ub) / 2, ubc = (ub + uc) / 2, uca = (uc + ua) / 2;
        out.u.push(ua, uab, uca, uab, ub, ubc, uca, ubc, uc, uab, ubc, uca);
      }
    }
    cur = out;
    if (!split) break;
  }
  return cur;
}

function dist(a: Pt3, b: Pt3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function mid(a: Pt3, b: Pt3): Pt3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** Apply an arbitrary position deformation in place. */
export function deform(s: Soup, fn: (x: number, y: number, z: number, out: [number, number, number]) => void): Soup {
  const o: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < s.p.length; i += 3) {
    fn(s.p[i]!, s.p[i + 1]!, s.p[i + 2]!, o);
    s.p[i] = o[0]; s.p[i + 1] = o[1]; s.p[i + 2] = o[2];
  }
  return s;
}

/**
 * Curve a plate lying in XY (thickness along Z) around the Y axis: x becomes arc length on a cylinder of the
 * given radius whose axis sits at z = -radius (the plate bulges toward +Z).
 */
export function bendX(s: Soup, radius: number): Soup {
  if (!isFinite(radius) || Math.abs(radius) < 1e-4) return s;
  return deform(s, (x, y, z, o) => {
    const a = x / radius, r = radius + z;
    o[0] = Math.sin(a) * r; o[1] = y; o[2] = Math.cos(a) * r - radius;
  });
}

/** Same as bendX but curving along Y (around the X axis). */
export function bendY(s: Soup, radius: number): Soup {
  if (!isFinite(radius) || Math.abs(radius) < 1e-4) return s;
  return deform(s, (x, y, z, o) => {
    const a = y / radius, r = radius + z;
    o[0] = x; o[1] = Math.sin(a) * r; o[2] = Math.cos(a) * r - radius;
  });
}

/**
 * Split edges (1 → 2 at the midpoint) until no edge spans more than maxLen along one axis (0 = x, 1 = y,
 * 2 = z). Far cheaper than `subdivide` when a plate only bends one way; shared edges are always cut at the
 * same midpoint, so the result stays watertight.
 */
export function subdivideAxis(s: Soup, axis: 0 | 1 | 2, maxLen: number, maxPasses = 12): Soup {
  let cur = s;
  for (let pass = 0; pass < maxPasses; pass++) {
    const out: Soup = { p: [], e: [], u: cur.u ? [] : undefined };
    let split = false;
    const P = cur.p, E = cur.e, U = cur.u;
    for (let i = 0; i < P.length; i += 9) {
      const vi = i / 3;
      const v: Pt3[] = [[P[i]!, P[i + 1]!, P[i + 2]!], [P[i + 3]!, P[i + 4]!, P[i + 5]!], [P[i + 6]!, P[i + 7]!, P[i + 8]!]];
      const e = [E[vi]!, E[vi + 1]!, E[vi + 2]!];
      const u = U ? [U[vi]!, U[vi + 1]!, U[vi + 2]!] : null;
      let best = -1, span = maxLen;
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(v[k]![axis] - v[(k + 1) % 3]![axis]);
        if (d > span + 1e-9) { span = d; best = k; }
      }
      if (best < 0) {
        tri(out, v[0]!, v[1]!, v[2]!, e[0], e[1], e[2]);
        if (out.u && u) out.u.push(u[0]!, u[1]!, u[2]!);
        continue;
      }
      split = true;
      const a = best, b = (best + 1) % 3, c = (best + 2) % 3;
      const m = mid(v[a]!, v[b]!), em = (e[a]! + e[b]!) / 2;
      tri(out, v[a]!, m, v[c]!, e[a], em, e[c]);
      tri(out, m, v[b]!, v[c]!, em, e[b], e[c]);
      if (out.u && u) {
        const um = (u[a]! + u[b]!) / 2;
        out.u.push(u[a]!, um, u[c]!, um, u[b]!, u[c]!);
      }
    }
    cur = out;
    if (!split) break;
  }
  return cur;
}

/** Curved armour plate: polygon outline in XY, bulging toward +Z. radiusX/radiusY = 0 keeps that axis flat. */
export function plate(outline: readonly Pt2[], thick: number, bevel: number, radiusX = 0, radiusY = 0, backBevel = 0): Soup {
  let s = prism(outline, thick, bevel, backBevel);
  // just enough cuts for the curvature: about 0.4 rad of arc per facet, along the bent axis only
  if (radiusX) s = subdivideAxis(s, 0, Math.max(0.03, Math.abs(radiusX) * 0.4));
  if (radiusY) s = subdivideAxis(s, 1, Math.max(0.03, Math.abs(radiusY) * 0.4));
  if (radiusX) bendX(s, radiusX);
  if (radiusY) bendY(s, radiusY);
  return s;
}

/** Battered-surface displacement along a pseudo-normal (radial from the soup centroid). */
export function batter(s: Soup, amp: number, freq: number, seed = 1): Soup {
  const off = seed * 9.17;
  return deform(s, (x, y, z, o) => {
    const k = amp * (vnoise(x * freq + off, y * freq - off, z * freq + off * 0.3) - 0.5);
    const k2 = amp * (vnoise(x * freq - off * 0.7, y * freq + off, z * freq) - 0.5);
    const k3 = amp * (vnoise(x * freq, y * freq + off * 0.4, z * freq - off) - 0.5);
    o[0] = x + k; o[1] = y + k2; o[2] = z + k3;
  });
}

export function xform(s: Soup, m: THREE.Matrix4): Soup {
  const e = m.elements;
  for (let i = 0; i < s.p.length; i += 3) {
    const x = s.p[i]!, y = s.p[i + 1]!, z = s.p[i + 2]!;
    s.p[i] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
    s.p[i + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
    s.p[i + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  }
  if (m.determinant() < 0) flip(s);
  return s;
}

/** reverse triangle winding */
export function flip(s: Soup): Soup {
  for (let i = 0; i < s.p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = s.p[i + 3 + k]!;
      s.p[i + 3 + k] = s.p[i + 6 + k]!;
      s.p[i + 6 + k] = t;
    }
    const vi = i / 3;
    const te = s.e[vi + 1]!;
    s.e[vi + 1] = s.e[vi + 2]!;
    s.e[vi + 2] = te;
    if (s.u) {
      const tu = s.u[vi + 1]!;
      s.u[vi + 1] = s.u[vi + 2]!;
      s.u[vi + 2] = tu;
    }
  }
  return s;
}

export function cloneSoup(s: Soup): Soup {
  return { p: s.p.slice(), e: s.e.slice(), u: s.u ? s.u.slice() : undefined };
}

export function merge(...parts: Soup[]): Soup {
  const out: Soup = { p: [], e: [] };
  const anyU = parts.some((s) => s.u);
  if (anyU) out.u = [];
  for (const s of parts) {
    for (let i = 0; i < s.p.length; i++) out.p.push(s.p[i]!);
    for (let i = 0; i < s.e.length; i++) out.e.push(s.e[i]!);
    if (anyU) for (let i = 0; i < s.e.length; i++) out.u!.push(s.u ? s.u[i]! : 0);
  }
  return out;
}

/** 4x4 from translation, XYZ euler rotation and scale (scalar or per-axis). */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sc: number | Pt3 = 1): THREE.Matrix4 {
  const s = typeof sc === 'number' ? new THREE.Vector3(sc, sc, sc) : new THREE.Vector3(sc[0], sc[1], sc[2]);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), s);
}

/** matrix that maps +Y to the direction a→b (for placing shards / struts between points), origin at a */
export function along(a: Pt3, b: Pt3, roll = 0): THREE.Matrix4 {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
  return new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1));
}
