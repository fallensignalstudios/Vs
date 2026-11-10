/**
 * GeoBuilder — a tiny immediate-mode mesh builder for flat-shaded architectural / hull geometry.
 * Everything a scenic piece needs ends up in ONE BufferGeometry (position, normal, color, aGlow), so a whole
 * megastructure is a single draw call. `color` is the linear albedo, `aGlow` an emissive multiplier on it
 * (0 = unlit surface … 6 = hot light strip).
 */
import * as THREE from 'three';

export type P3 = readonly [number, number, number];
export type P2 = readonly [number, number];

const _c = new THREE.Color();
const _v = new THREE.Vector3();

export class GeoBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly glow: number[] = [];
  private readonly idx: number[] = [];
  private m = new THREE.Matrix4();
  private flip = false;
  private readonly stack: Array<{ m: THREE.Matrix4; flip: boolean }> = [];
  private cr = 1;
  private cg = 1;
  private cb = 1;
  private cglow = 0;

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  /** Set the current paint: sRGB hex albedo (× shade) and emissive multiplier. */
  paint(hex: number, glow = 0, shade = 1): this {
    _c.setHex(hex);
    this.cr = _c.r * shade; this.cg = _c.g * shade; this.cb = _c.b * shade;
    this.cglow = glow;
    return this;
  }

  push(): this {
    this.stack.push({ m: this.m.clone(), flip: this.flip });
    return this;
  }

  pop(): this {
    const s = this.stack.pop();
    if (s) { this.m = s.m; this.flip = s.flip; }
    return this;
  }

  /** Post-multiply a transform onto the current matrix (applies to everything emitted until pop()). */
  transform(t: THREE.Matrix4): this {
    this.m.multiply(t);
    this.flip = this.m.determinant() < 0;
    return this;
  }

  translate(x: number, y: number, z: number): this { return this.transform(new THREE.Matrix4().makeTranslation(x, y, z)); }
  rotateX(a: number): this { return this.transform(new THREE.Matrix4().makeRotationX(a)); }
  rotateY(a: number): this { return this.transform(new THREE.Matrix4().makeRotationY(a)); }
  rotateZ(a: number): this { return this.transform(new THREE.Matrix4().makeRotationZ(a)); }
  scale(x: number, y: number, z: number): this { return this.transform(new THREE.Matrix4().makeScale(x, y, z)); }

  private vert(p: P3, nx: number, ny: number, nz: number): number {
    _v.set(p[0], p[1], p[2]).applyMatrix4(this.m);
    this.pos.push(_v.x, _v.y, _v.z);
    this.nrm.push(nx, ny, nz);
    this.col.push(this.cr, this.cg, this.cb);
    this.glow.push(this.cglow);
    return this.pos.length / 3 - 1;
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
    for (let i = 0; i < pts.length; i++) {
      const o = (base + i) * 3;
      this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      if (this.flip) this.idx.push(base, base + i + 1, base + i);
      else this.idx.push(base, base + i, base + i + 1);
    }
    return this;
  }

  quad(a: P3, b: P3, c: P3, d: P3): this { return this.poly([a, b, c, d]); }

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
   * a0..a1 (radians, 0 = +X, counter-clockwise seen from above), centred on (cx, cz).
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
   * Sweep a rectangular section (width w across `side`, depth d across `up`) along a polyline of frames.
   * Used for ribs, arches and bent spans. Width/depth may vary per frame.
   */
  sweep(frames: readonly { p: P3; side: P3; up: P3; w: number; d: number }[], caps = true): this {
    const rings: P3[][] = frames.map((f) => {
      const hw = f.w / 2, hd = f.d / 2;
      const c = (sx: number, sy: number): P3 => [
        f.p[0] + f.side[0] * hw * sx + f.up[0] * hd * sy,
        f.p[1] + f.side[1] * hw * sx + f.up[1] * hd * sy,
        f.p[2] + f.side[2] * hw * sx + f.up[2] * hd * sy,
      ];
      return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    });
    // ring winding depends on the frame handedness; detect once from the first segment
    const f0 = frames[0], f1 = frames[1];
    const tx = f1.p[0] - f0.p[0], ty = f1.p[1] - f0.p[1], tz = f1.p[2] - f0.p[2];
    const cx = f0.side[1] * f0.up[2] - f0.side[2] * f0.up[1];
    const cy = f0.side[2] * f0.up[0] - f0.side[0] * f0.up[2];
    const cz = f0.side[0] * f0.up[1] - f0.side[1] * f0.up[0];
    const forward = cx * tx + cy * ty + cz * tz > 0;
    return this.loft(forward ? rings.map((r) => [...r].reverse()) : rings, caps);
  }

  /** Raw arrays (for baking impostors). */
  raw(): { pos: readonly number[]; nrm: readonly number[]; col: readonly number[]; glow: readonly number[]; idx: readonly number[] } {
    return { pos: this.pos, nrm: this.nrm, col: this.col, glow: this.glow, idx: this.idx };
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
