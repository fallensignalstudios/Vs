/**
 * GeoBuilder — a small immediate-mode mesh builder for architectural / hull geometry.
 * Everything a scenic piece needs ends up in ONE BufferGeometry, so a whole megastructure is a single draw call.
 *
 * Vertex attributes:
 *   position, normal
 *   color   linear albedo
 *   aGlow   emissive multiplier on the albedo (0 = unlit surface … 6 = hot light strip)
 *   aLight  (sky visibility 0..1, local lamp light 0..1, lit-window density 0..1, panelling weight 0..1)
 *   aUv     surface coordinates in METRES (u along the surface, v up / along) for panel seams and windows
 *
 * Flat primitives (poly / quad / box / bevelBox / prism / loft / ring / sweep) are faceted; `lathe`, `tube`,
 * `skin`, `ball` and `sweepProfile` carry smooth normals with optional hard creases.
 */
import * as THREE from 'three';

export type P3 = readonly [number, number, number];
export type P2 = readonly [number, number];

/** A sweep frame: centre, unit side and unit up of the section, plus its width (along side) and depth (along up). */
export interface Frame { p: P3; side: P3; up: P3; w: number; d: number }

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export class GeoBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly glow: number[] = [];
  private readonly lit: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private flip = false;
  private readonly stack: Array<{ m: THREE.Matrix4; flip: boolean }> = [];
  private cr = 1;
  private cg = 1;
  private cb = 1;
  private cglow = 0;
  private lSky = 1;
  private lLamp = 0;
  private lWin = 0;
  private lPanel = 1;

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  /** Set the current paint: sRGB hex albedo (× shade) and emissive multiplier. */
  paint(hex: number, glow = 0, shade = 1): this {
    _c.setHex(hex);
    this.cr = _c.r * shade; this.cg = _c.g * shade; this.cb = _c.b * shade;
    this.cglow = glow;
    return this;
  }

  /**
   * Baked lighting for everything emitted from now on: `sky` = how much of the sky's key / fill light reaches the
   * surface (0 = deep interior), `lamp` = warm local light from nearby emissive seams (0..1).
   */
  light(sky: number, lamp = 0): this {
    this.lSky = Math.min(1, Math.max(0, sky));
    this.lLamp = Math.min(1, Math.max(0, lamp));
    return this;
  }

  /** Surface dressing: `windows` = density of lit openings (0 = none), `panel` = weight of the panel seams. */
  dress(windows: number, panel = 1): this {
    this.lWin = Math.min(1, Math.max(0, windows));
    this.lPanel = Math.min(1, Math.max(0, panel));
    return this;
  }

  push(): this {
    this.stack.push({ m: this.m.clone(), flip: this.flip });
    return this;
  }

  pop(): this {
    const s = this.stack.pop();
    if (s) { this.m = s.m; this.flip = s.flip; this.nm.getNormalMatrix(this.m); }
    return this;
  }

  /** Post-multiply a transform onto the current matrix (applies to everything emitted until pop()). */
  transform(t: THREE.Matrix4): this {
    this.m.multiply(t);
    this.flip = this.m.determinant() < 0;
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  translate(x: number, y: number, z: number): this { return this.transform(new THREE.Matrix4().makeTranslation(x, y, z)); }
  rotateX(a: number): this { return this.transform(new THREE.Matrix4().makeRotationX(a)); }
  rotateY(a: number): this { return this.transform(new THREE.Matrix4().makeRotationY(a)); }
  rotateZ(a: number): this { return this.transform(new THREE.Matrix4().makeRotationZ(a)); }
  scale(x: number, y: number, z: number): this { return this.transform(new THREE.Matrix4().makeScale(x, y, z)); }

  private vert(p: P3, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    _v.set(p[0], p[1], p[2]).applyMatrix4(this.m);
    this.pos.push(_v.x, _v.y, _v.z);
    this.nrm.push(nx, ny, nz);
    this.col.push(this.cr, this.cg, this.cb);
    this.glow.push(this.cglow);
    this.lit.push(this.lSky, this.lLamp, this.lWin, this.lPanel);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  /** Vertex with a LOCAL-space normal (transformed by the current matrix) — smooth primitives. */
  private svert(p: P3, nx: number, ny: number, nz: number, u: number, v: number): number {
    _n.set(nx, ny, nz).applyMatrix3(this.nm);
    const l = _n.length() || 1;
    return this.vert(p, _n.x / l, _n.y / l, _n.z / l, u, v);
  }

  /** Emit a triangle so that its geometric normal agrees with the stored normal of its first vertex. */
  private tri(a: number, b: number, c: number): void {
    const P = this.pos, N = this.nrm;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * gx + gy * gy + gz * gz < 1e-18) return; // degenerate (crease duplicates, collapsed caps)
    const d = gx * (N[a * 3] + N[b * 3] + N[c * 3]) + gy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + gz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /** Flat polygon fan (convex), counter-clockwise seen from outside. */
  poly(pts: readonly P3[]): this {
    if (pts.length < 3) return this;
    const base = this.pos.length / 3;
    for (const p of pts) this.vert(p, 0, 0, 0);
    // face normal from transformed positions (Newell) — robust for slightly non-planar quads
    let nx = 0, ny = 0, nz = 0;
    const P = this.pos;
    for (let i = 0; i < pts.length; i++) {
      const a = (base + i) * 3, b = (base + ((i + 1) % pts.length)) * 3;
      nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
      ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
      nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    const s = this.flip ? -1 : 1;
    nx = (nx / l) * s; ny = (ny / l) * s; nz = (nz / l) * s;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let i = 0; i < pts.length; i++) {
      const o = (base + i) * 3, t = (base + i) * 2;
      this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
      // planar surface coordinates in metres, picked by the dominant axis of the face
      if (ay > 0.6) { this.uv[t] = P[o]; this.uv[t + 1] = P[o + 2]; }
      else if (ax > az) { this.uv[t] = P[o + 2]; this.uv[t + 1] = P[o + 1]; }
      else { this.uv[t] = P[o]; this.uv[t + 1] = P[o + 1]; }
    }
    for (let i = 1; i < pts.length - 1; i++) {
      if (this.flip) this.idx.push(base, base + i + 1, base + i);
      else this.idx.push(base, base + i, base + i + 1);
    }
    return this;
  }

  quad(a: P3, b: P3, c: P3, d: P3): this { return this.poly([a, b, c, d]); }

  /** A quad wound so that it faces `toward` (reveals, soffits, anything where "outside" is easier to name). */
  quadFacing(a: P3, b: P3, c: P3, d: P3, toward: P3): this {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * (toward[0] - a[0]) + ny * (toward[1] - a[1]) + nz * (toward[2] - a[2]);
    return dot >= 0 ? this.poly([a, b, c, d]) : this.poly([d, c, b, a]);
  }

  /**
   * Axis-aligned box centred at (cx, cy, cz). `top` scales the +Y face about its centre ([x, z] or a number)
   * to make tapered blocks; `shift` slides the top face ([dx, dz]) to make raked / sheared blocks.
   */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts?: { top?: number | P2; shift?: P2; noBottom?: boolean; noTop?: boolean }): this {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const t = opts?.top;
    const tx = (typeof t === 'number' ? t : t ? t[0] : 1) * hx;
    const tz = (typeof t === 'number' ? t : t ? t[1] : 1) * hz;
    const dx = opts?.shift?.[0] ?? 0, dz = opts?.shift?.[1] ?? 0;
    const y0 = cy - hy, y1 = cy + hy;
    const b0: P3 = [cx - hx, y0, cz + hz], b1: P3 = [cx + hx, y0, cz + hz], b2: P3 = [cx + hx, y0, cz - hz], b3: P3 = [cx - hx, y0, cz - hz];
    const t0: P3 = [cx + dx - tx, y1, cz + dz + tz], t1: P3 = [cx + dx + tx, y1, cz + dz + tz];
    const t2: P3 = [cx + dx + tx, y1, cz + dz - tz], t3: P3 = [cx + dx - tx, y1, cz + dz - tz];
    this.quad(b0, b1, t1, t0); // +Z
    this.quad(b1, b2, t2, t1); // +X
    this.quad(b2, b3, t3, t2); // -Z
    this.quad(b3, b0, t0, t3); // -X
    if (!opts?.noTop && tx > 1e-6 && tz > 1e-6) this.quad(t0, t1, t2, t3);
    if (!opts?.noBottom) this.quad(b3, b2, b1, b0);
    return this;
  }

  /**
   * Box with every edge chamfered by `bevel` metres (hard-surface plates, plinths, blocks): the chamfers catch
   * the light, which is what makes a block read as manufactured rather than as a placeholder. 44 triangles.
   */
  bevelBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, bevel: number): this {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const b = Math.max(0, Math.min(bevel, hx * 0.49, hy * 0.49, hz * 0.49));
    if (b < 1e-5) return this.box(cx, cy, cz, sx, sy, sz);
    const h = [hx, hy, hz];
    // corner point for sign triple s, pulled in by the bevel along every axis except `keep`
    const pt = (s: readonly number[], keep: number): P3 => {
      const o = [0, 0, 0];
      for (let a = 0; a < 3; a++) o[a] = s[a] * (h[a] - (a === keep ? 0 : b));
      return [cx + o[0], cy + o[1], cz + o[2]];
    };
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3, w = (a + 2) % 3;
      for (const sa of [-1, 1]) {
        // face perpendicular to axis a
        const mk = (su: number, sw: number): P3 => { const s = [0, 0, 0]; s[a] = sa; s[u] = su; s[w] = sw; return pt(s, a); };
        const q = [mk(-1, -1), mk(1, -1), mk(1, 1), mk(-1, 1)];
        this.poly(sa > 0 ? q : [q[3], q[2], q[1], q[0]]);
      }
      // the four chamfers running along axis a
      for (const su of [-1, 1]) for (const sw of [-1, 1]) {
        const mk = (sa: number, keep: number): P3 => { const s = [0, 0, 0]; s[a] = sa; s[u] = su; s[w] = sw; return pt(s, keep); };
        const q = [mk(-1, u), mk(1, u), mk(1, w), mk(-1, w)];
        this.poly(su * sw > 0 ? [q[3], q[2], q[1], q[0]] : q);
      }
    }
    for (const sx2 of [-1, 1]) for (const sy2 of [-1, 1]) for (const sz2 of [-1, 1]) {
      const s = [sx2, sy2, sz2];
      const t = [pt(s, 0), pt(s, 1), pt(s, 2)];
      this.poly(sx2 * sy2 * sz2 > 0 ? t : [t[2], t[1], t[0]]);
    }
    return this;
  }

  /**
   * Vertical n-gon frustum from y0 (radius r0) to y1 (radius r1) centred on (cx, cz). r1 = 0 makes a spike.
   * `squash` scales the Z radius (blade-like sections), `rot` spins the polygon.
   */
  prism(cx: number, y0: number, cz: number, y1: number, r0: number, r1: number, sides: number, opts?: { rot?: number; squash?: number; caps?: boolean }): this {
    const rot = opts?.rot ?? Math.PI / sides, sq = opts?.squash ?? 1;
    const lo: P3[] = [], hi: P3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const x = Math.cos(a), z = -Math.sin(a) * sq;
      lo.push([cx + x * r0, y0, cz + z * r0]);
      hi.push([cx + x * r1, y1, cz + z * r1]);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (r1 > 1e-6) this.quad(lo[i], lo[j], hi[j], hi[i]);
      else this.poly([lo[i], lo[j], [cx, y1, cz]]);
    }
    if (opts?.caps !== false) {
      if (r1 > 1e-6) this.poly(hi);
      this.poly([...lo].reverse());
    }
    return this;
  }

  /**
   * Loft a closed profile through stations. Each station is a ring of points with identical count, ordered
   * counter-clockwise when seen looking from the first station toward the last. End caps are added.
   */
  loft(rings: readonly (readonly P3[])[], caps = true): this {
    for (let s = 0; s < rings.length - 1; s++) {
      const a = rings[s], b = rings[s + 1], n = a.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.quad(a[j], a[i], b[i], b[j]);
      }
    }
    if (caps && rings.length > 1) {
      this.poly(rings[0]);
      this.poly([...rings[rings.length - 1]].reverse());
    }
    return this;
  }

  /**
   * Annular sector (tier floor / ring wall slab): inner radius r0, outer r1, between heights y0..y1 and angles
   * a0..a1 (radians, 0 = +X, counter-clockwise seen from above), centred on (cx, cz). Faceted.
   */
  ring(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, a0: number, a1: number, segs: number): this {
    const at = (r: number, a: number, y: number): P3 => [cx + Math.cos(a) * r, y, cz - Math.sin(a) * r];
    for (let i = 0; i < segs; i++) {
      const u0 = a0 + ((a1 - a0) * i) / segs, u1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      this.quad(at(r0, u0, y1), at(r1, u0, y1), at(r1, u1, y1), at(r0, u1, y1)); // top
      this.quad(at(r0, u1, y0), at(r1, u1, y0), at(r1, u0, y0), at(r0, u0, y0)); // bottom
      this.quad(at(r1, u0, y0), at(r1, u1, y0), at(r1, u1, y1), at(r1, u0, y1)); // outer
      if (r0 > 1e-6) this.quad(at(r0, u1, y0), at(r0, u0, y0), at(r0, u0, y1), at(r0, u1, y1)); // inner
    }
    if (Math.abs(a1 - a0) < Math.PI * 2 - 1e-4) {
      this.quad(at(r1, a0, y0), at(r1, a0, y1), at(r0, a0, y1), at(r0, a0, y0));
      this.quad(at(r0, a1, y0), at(r0, a1, y1), at(r1, a1, y1), at(r1, a1, y0));
    }
    return this;
  }

  /**
   * Surface of revolution about the vertical axis through (cx, cz), smooth around the circumference.
   * `profile` = [radius, y] points; the surface normal lies to the RIGHT of the direction of travel (listing an
   * outer wall bottom → top faces outward; a closed section is listed counter-clockwise with radius to the
   * right and y up). Each profile segment is a hard-edged band unless `smoothProfile` is set (domes, bells).
   * Angles as in `ring` (0 = +X, counter-clockwise seen from above); a partial sweep gets no end caps.
   */
  lathe(cx: number, cz: number, profile: readonly P2[], segs: number, opts?: { a0?: number; a1?: number; closed?: boolean; smoothProfile?: boolean }): this {
    const a0 = opts?.a0 ?? 0, a1 = opts?.a1 ?? Math.PI * 2;
    const n = profile.length;
    const count = opts?.closed ? n : n - 1;
    if (count < 1 || segs < 1) return this;
    let rRef = 0;
    for (const p of profile) rRef = Math.max(rRef, Math.abs(p[0]));
    const segN = (k: number): [number, number] => {
      const p = profile[k % n], q = profile[(k + 1) % n];
      const dr = q[0] - p[0], dy = q[1] - p[1];
      const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    };
    let vAcc = 0;
    for (let k = 0; k < count; k++) {
      const p = profile[k % n], q = profile[(k + 1) % n];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      let np = segN(k), nq = np;
      if (opts?.smoothProfile) {
        const prev = k > 0 || opts.closed ? segN((k - 1 + count) % count) : np;
        const next = k < count - 1 || opts.closed ? segN((k + 1) % count) : np;
        np = [np[0] + prev[0], np[1] + prev[1]];
        nq = [nq[0] + next[0], nq[1] + next[1]];
      }
      const base = this.pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const a = a0 + ((a1 - a0) * i) / segs;
        const ca = Math.cos(a), sa = -Math.sin(a);
        this.svert([cx + ca * p[0], p[1], cz + sa * p[0]], ca * np[0], np[1], sa * np[0], a * rRef, vAcc);
        this.svert([cx + ca * q[0], q[1], cz + sa * q[0]], ca * nq[0], nq[1], sa * nq[0], a * rRef, vAcc + len);
      }
      for (let i = 0; i < segs; i++) {
        const o = base + i * 2;
        this.tri(o, o + 2, o + 3);
        this.tri(o, o + 3, o + 1);
      }
      vAcc += len;
    }
    return this;
  }

  /** Smooth round frustum (columns, tanks, barrels) — a two-point lathe with optional flat caps. */
  cyl(cx: number, y0: number, cz: number, y1: number, r0: number, r1: number, sides: number, caps = true): this {
    const prof: P2[] = [];
    if (caps && r0 > 1e-6) prof.push([0, y0]);
    prof.push([r0, y0], [r1, y1]);
    if (caps && r1 > 1e-6) prof.push([0, y1]);
    return this.lathe(cx, cz, prof, sides);
  }

  /** Smooth ellipsoid (pods, bells, canopies). `y0`/`y1` in −1..1 clip it to a band (e.g. 0..1 = upper dome). */
  ball(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, segs: number, rows: number, y0 = -1, y1 = 1): this {
    const base = this.pos.length / 3;
    const t0 = Math.asin(Math.max(-1, Math.min(1, y0))), t1 = Math.asin(Math.max(-1, Math.min(1, y1)));
    for (let j = 0; j <= rows; j++) {
      const t = t0 + ((t1 - t0) * j) / rows;
      const ct = Math.cos(t), st = Math.sin(t);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * ct, z = -Math.sin(a) * ct;
        this.svert([cx + x * rx, cy + st * ry, cz + z * rz], x / rx, st / ry, z / rz, a * rx, t * ry);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) {
      const o = base + j * (segs + 1) + i, p = o + segs + 1;
      this.tri(o, o + 1, p + 1);
      this.tri(o, p + 1, p);
    }
    return this;
  }

  /**
   * Smooth skin through stations (hull plating, fairings, canopies). Rings have identical point counts and are
   * ordered counter-clockwise when seen looking from the first station toward the last (as in `loft`).
   * `crease` lists ring indices that stay hard edges (chines); `caps` closes both ends with flat fans.
   */
  skin(rings: readonly (readonly P3[])[], opts?: { crease?: readonly number[]; caps?: boolean; open?: boolean }): this {
    const S = rings.length;
    if (S < 2) return this;
    const n = rings[0].length;
    const crease = new Set(opts?.crease ?? []);
    const open = !!opts?.open;
    const sub = (a: P3, b: P3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    // columns: [ring index, side] where side −1 = belongs to the segment before, +1 = after, 0 = both
    const cols: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const hard = crease.has(i) || (open && (i === 0 || i === n - 1));
      if (hard) { if (!(open && i === 0)) cols.push([i, -1]); if (!(open && i === n - 1)) cols.push([i, 1]); }
      else cols.push([i, 0]);
    }
    const base = this.pos.length / 3;
    const girth: number[] = [0];
    for (let i = 1; i <= n; i++) {
      const a = rings[0][i % n], b = rings[0][i - 1];
      girth.push(girth[i - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    let along = 0;
    for (let s = 0; s < S; s++) {
      const ring = rings[s];
      if (s > 0) { const a = rings[s][0], b = rings[s - 1][0]; along += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
      for (const [i, side] of cols) {
        const prev = ring[(i - 1 + n) % n], next = ring[(i + 1) % n], here = ring[i];
        let tu = side < 0 ? sub(here, prev) : side > 0 ? sub(next, here) : sub(next, prev);
        if (Math.hypot(tu[0], tu[1], tu[2]) < 1e-9) tu = sub(next, prev);
        const tl = sub(rings[Math.min(s + 1, S - 1)][i], rings[Math.max(s - 1, 0)][i]);
        // outward = along-the-length × around-the-ring for counter-clockwise rings (matches `loft`)
        const nx = tl[1] * tu[2] - tl[2] * tu[1], ny = tl[2] * tu[0] - tl[0] * tu[2], nz = tl[0] * tu[1] - tl[1] * tu[0];
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-12) this.svert(here, 0, 1, 0, girth[i], along);
        else this.svert(here, nx / l, ny / l, nz / l, girth[i], along);
      }
    }
    const C = cols.length;
    for (let s = 0; s < S - 1; s++) {
      for (let c = 0; c < C; c++) {
        const d = (c + 1) % C;
        if (open && c === C - 1) continue;
        if (cols[c][0] === cols[d][0]) continue; // the two halves of a crease
        const o = base + s * C;
        this.tri(o + c, o + C + c, o + C + d);
        this.tri(o + c, o + C + d, o + d);
      }
    }
    if (opts?.caps && !open) {
      this.poly(rings[0]);
      this.poly([...rings[S - 1]].reverse());
    }
    return this;
  }

  /**
   * Smooth tube along a polyline (rails, pipes, cables, barrels). `radius` may be one value or one per point.
   */
  tube(pts: readonly P3[], radius: number | readonly number[], sides: number, caps = true): this {
    if (pts.length < 2) return this;
    const rings: P3[][] = [];
    const t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), prev = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      if (i === 0) u.set(Math.abs(t.y) > 0.9 ? 1 : 0, Math.abs(t.y) > 0.9 ? 0 : 1, 0);
      else u.copy(prev);
      u.addScaledVector(t, -u.dot(t)).normalize(); // parallel transport: keep the previous up, re-orthogonalised
      prev.copy(u);
      w.crossVectors(t, u);
      const r = typeof radius === 'number' ? radius : radius[Math.min(i, radius.length - 1)];
      const ring: P3[] = [];
      for (let k = 0; k < sides; k++) {
        const a2 = (k / sides) * Math.PI * 2, c = Math.cos(a2) * r, s = Math.sin(a2) * r;
        ring.push([pts[i][0] + u.x * c + w.x * s, pts[i][1] + u.y * c + w.y * s, pts[i][2] + u.z * c + w.z * s]);
      }
      rings.push(ring);
    }
    // ring orientation depends on the frame; `skin` expects counter-clockwise seen from the first station
    return this.skin(rings.map((r) => [...r].reverse()), { caps });
  }

  /**
   * Sweep a rectangular section (width w across `side`, depth d across `up`) along a polyline of frames.
   * Used for ribs, arches and bent spans. Width/depth may vary per frame.
   */
  sweep(frames: readonly Frame[], caps = true): this {
    return this.sweepProfile(frames, [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], { caps });
  }

  /**
   * Sweep an arbitrary closed section along frames: `profile` points are (across `side`, across `up`) in units
   * of the frame's w / d, listed counter-clockwise with side to the right and up upward. Faces are flat across
   * the section and smooth along the path (so a curved rib has no kinks along its length).
   */
  sweepProfile(frames: readonly Frame[], profile: readonly P2[], opts?: { caps?: boolean }): this {
    if (frames.length < 2 || profile.length < 3) return this;
    const rings: P3[][] = frames.map((f) => profile.map(([x, y]): P3 => [
      f.p[0] + f.side[0] * f.w * x + f.up[0] * f.d * y,
      f.p[1] + f.side[1] * f.w * x + f.up[1] * f.d * y,
      f.p[2] + f.side[2] * f.w * x + f.up[2] * f.d * y,
    ]));
    // ring winding depends on the frame handedness; detect once from the first segment
    const f0 = frames[0], f1 = frames[1];
    const tx = f1.p[0] - f0.p[0], ty = f1.p[1] - f0.p[1], tz = f1.p[2] - f0.p[2];
    const cx = f0.side[1] * f0.up[2] - f0.side[2] * f0.up[1];
    const cy = f0.side[2] * f0.up[0] - f0.side[0] * f0.up[2];
    const cz = f0.side[0] * f0.up[1] - f0.side[1] * f0.up[0];
    const forward = cx * tx + cy * ty + cz * tz > 0;
    const ordered = forward ? rings.map((r) => [...r].reverse()) : rings;
    const all = profile.map((_, i) => i);
    return this.skin(ordered, { crease: all, caps: opts?.caps ?? true });
  }

  /** Raw arrays (for baking impostors). */
  raw(): { pos: readonly number[]; nrm: readonly number[]; col: readonly number[]; glow: readonly number[]; idx: readonly number[] } {
    return { pos: this.pos, nrm: this.nrm, col: this.col, glow: this.glow, idx: this.idx };
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const nrm = new Int8Array(n * 3);
    for (let i = 0; i < nrm.length; i++) nrm[i] = Math.round(Math.max(-1, Math.min(1, this.nrm[i])) * 127);
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    const lit = new Uint8Array(n * 4);
    for (let i = 0; i < lit.length; i++) lit[i] = Math.round(this.lit[i] * 255);
    g.setAttribute('aLight', new THREE.BufferAttribute(lit, 4, true));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
