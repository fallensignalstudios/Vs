/**
 * MeshBuilder — the procedural sculpting toolkit for humanoid figures.
 *
 * Everything a figure is made of (undersuit, plates, helmets, weapons, cloth panels) is emitted through this
 * builder into ONE indexed, skinned BufferGeometry with per-vertex material data:
 *   color      rgb albedo (linear)
 *   aEmissive  rgb emissive radiance (colour × intensity, >1 blooms)
 *   aMat       x roughness, y metalness, z code (zone*16 + part), w baked occlusion
 *   skinIndex / skinWeight   up to four influences
 *
 * Low-level primitives live here (Prim + commit); shape primitives are in ./prims.ts.
 */
import * as THREE from 'three';

/** Shader material families (see material.ts). */
export const PART = { plate: 0, cloth: 1, skin: 2, hair: 3, suit: 4, leather: 5, glow: 6, glass: 7, blade: 8, robe: 9 } as const;
/** Body zones addressable by setExposed(). */
export const ZONE = { body: 0, head: 1, chest: 2, back: 3, shield: 4, weapon: 5, arm: 6, leg: 7 } as const;

export interface Surf {
  /** sRGB hex albedo */
  color: number;
  rough?: number;
  metal?: number;
  part?: number;
  zone?: number;
  /** sRGB hex emissive colour */
  emissive?: number;
  /** emissive intensity (1.5 soft, 3 strip, 6 hot) */
  glow?: number;
  /** edge-wear brightening gain on bevels (default by metalness) */
  edge?: number;
}

export interface SkinOut { i0: number; w0: number; i1: number; w1: number; i2: number; w2: number; i3: number; w3: number }
export type SkinFn = (x: number, y: number, z: number, out: SkinOut) => void;
export type Skin = number | SkinFn;

interface SurfC { r: number; g: number; b: number; rough: number; metal: number; code: number; er: number; eg: number; eb: number; edge: number }

const _c = new THREE.Color();
function compileSurf(s: Surf): SurfC {
  _c.set(s.color);
  const r = _c.r, g = _c.g, b = _c.b;
  let er = 0, eg = 0, eb = 0;
  if (s.emissive !== undefined) {
    _c.set(s.emissive);
    const k = s.glow ?? 1.5;
    er = _c.r * k; eg = _c.g * k; eb = _c.b * k;
  }
  const metal = s.metal ?? 0;
  return {
    r, g, b,
    rough: s.rough ?? 0.6,
    metal,
    code: (s.zone ?? 0) * 16 + (s.part ?? 0),
    er, eg, eb,
    edge: s.edge ?? (metal > 0.5 ? 0.22 : 0.08),
  };
}

/** A primitive under construction: local-space vertices + triangles, committed through the builder. */
export class Prim {
  readonly p: number[] = [];
  /** surf slot per vertex (index into the slots passed to commit) */
  readonly s: number[] = [];
  /** edge-wear amount 0..1 */
  readonly e: number[] = [];
  /** baked occlusion 0..1 */
  readonly a: number[] = [];
  readonly t: number[] = [];
  /** optional explicit skin: 8 numbers per vertex (i0,w0,i1,w1,i2,w2,i3,w3); overrides the builder's binding */
  k: number[] | null = null;

  get count(): number { return this.s.length; }

  v(x: number, y: number, z: number, slot = 0, edge = 0, ao = 1): number {
    this.p.push(x, y, z);
    this.s.push(slot);
    this.e.push(edge);
    this.a.push(ao);
    return this.s.length - 1;
  }

  tri(a: number, b: number, c: number): void { this.t.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.t.push(a, b, c, a, c, d); }

  /** Triangle wound so that its face normal agrees with (nx,ny,nz). */
  triDir(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
    const p = this.p;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az;
    const vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
    const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (d >= 0) this.t.push(a, b, c); else this.t.push(a, c, b);
  }

  /** Quad (a,b,c,d in ring order) wound so that its face normal agrees with (nx,ny,nz). */
  quadDir(a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number): void {
    const p = this.p;
    // use the diagonal cross product: robust for degenerate (collapsed-edge) quads
    const ux = p[c * 3] - p[a * 3], uy = p[c * 3 + 1] - p[a * 3 + 1], uz = p[c * 3 + 2] - p[a * 3 + 2];
    const vx = p[d * 3] - p[b * 3], vy = p[d * 3 + 1] - p[b * 3 + 1], vz = p[d * 3 + 2] - p[b * 3 + 2];
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) this.t.push(a, b, c, a, c, d); else this.t.push(a, d, c, a, c, b);
  }
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const DEG = Math.PI / 180;

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly emi: number[] = [];
  private readonly mat: number[] = [];
  private readonly si: number[] = [];
  private readonly sw: number[] = [];
  private readonly idx: number[] = [];

  private readonly stack: THREE.Matrix4[] = [];
  private m = new THREE.Matrix4();
  private cur: SurfC = compileSurf({ color: 0x808080 });
  private curSurf: Surf = { color: 0x808080 };
  private skinning: Skin = 0;
  private readonly so: SkinOut = { i0: 0, w0: 1, i1: 0, w1: 0, i2: 0, w2: 0, i3: 0, w3: 0 };

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  /** Set the current surface. */
  surf(s: Surf): this { this.curSurf = s; this.cur = compileSurf(s); return this; }
  getSurf(): Surf { return this.curSurf; }
  /** Set the current skin binding: a bone index (rigid) or a weight function of the model-space position. */
  skin(s: Skin): this { this.skinning = s; return this; }

  push(): this { this.stack.push(this.m.clone()); return this; }
  pop(): this { const m = this.stack.pop(); if (m) this.m = m; return this; }
  /** Run fn inside a push/pop scope. */
  scope(fn: () => void): this { this.push(); fn(); this.pop(); return this; }
  translate(x: number, y: number, z: number): this { this.m.multiply(_m.makeTranslation(x, y, z)); return this; }
  /** Euler degrees, applied X then Y then Z (intrinsic). */
  rotate(xDeg: number, yDeg = 0, zDeg = 0): this {
    this.m.multiply(_m.makeRotationFromEuler(_e.set(xDeg * DEG, yDeg * DEG, zDeg * DEG, 'XYZ')));
    return this;
  }
  scale(x: number, y = x, z = x): this { this.m.multiply(_m.makeScale(x, y, z)); return this; }
  /** Mirror across the YZ plane (x → −x). Winding is fixed automatically at commit. */
  mirrorX(): this { return this.scale(-1, 1, 1); }
  /** Place at p with Euler rotation (degrees). */
  at(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    _q.setFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ'));
    this.m.multiply(_m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)));
    return this;
  }
  /** Current transform (read-only use). */
  get matrix(): THREE.Matrix4 { return this.m; }

  /**
   * Commit a primitive: transform, compute area-weighted smooth normals over shared vertices, bake attributes
   * and skin weights. `slots[0]` defaults to the current surf; other slots are for trims / alternates.
   */
  commit(prim: Prim, slots?: Array<Surf | undefined>): void {
    const n = prim.count;
    if (n === 0 || prim.t.length === 0) return;
    const base = this.pos.length / 3;
    const surfs: SurfC[] = [this.cur];
    if (slots) for (let i = 0; i < slots.length; i++) { const s = slots[i]; if (i === 0) { if (s) surfs[0] = compileSurf(s); } else surfs[i] = s ? compileSurf(s) : surfs[0]; }

    const P = new Float32Array(n * 3);
    const e = this.m.elements;
    for (let i = 0; i < n; i++) {
      const x = prim.p[i * 3], y = prim.p[i * 3 + 1], z = prim.p[i * 3 + 2];
      P[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const flip = this.m.determinant() < 0;
    const N = new Float32Array(n * 3);
    const t = prim.t;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k], b = flip ? t[k + 2] : t[k + 1], c = flip ? t[k + 1] : t[k + 2];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
      const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz < 1e-18) continue;
      N[a * 3] += nx; N[a * 3 + 1] += ny; N[a * 3 + 2] += nz;
      N[b * 3] += nx; N[b * 3 + 1] += ny; N[b * 3 + 2] += nz;
      N[c * 3] += nx; N[c * 3 + 1] += ny; N[c * 3 + 2] += nz;
      this.idx.push(base + a, base + b, base + c);
    }
    const so = this.so;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-12) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
      this.pos.push(x, y, z);
      this.nrm.push(nx, ny, nz);
      const s = surfs[prim.s[i]] ?? surfs[0];
      const ed = prim.e[i] * s.edge;
      this.col.push(Math.min(1, s.r * (1 + ed * 1.4) + ed * 0.05), Math.min(1, s.g * (1 + ed * 1.4) + ed * 0.05), Math.min(1, s.b * (1 + ed * 1.4) + ed * 0.05));
      this.emi.push(s.er, s.eg, s.eb);
      this.mat.push(Math.max(0.05, s.rough * (1 - ed * 0.35)), s.metal, s.code, prim.a[i]);
      if (prim.k) {
        const q = i * 8, K = prim.k;
        const sum = K[q + 1] + K[q + 3] + K[q + 5] + K[q + 7] || 1;
        this.si.push(K[q], K[q + 2], K[q + 4], K[q + 6]);
        this.sw.push(K[q + 1] / sum, K[q + 3] / sum, K[q + 5] / sum, K[q + 7] / sum);
      } else if (typeof this.skinning === 'number') {
        this.si.push(this.skinning, 0, 0, 0);
        this.sw.push(1, 0, 0, 0);
      } else {
        so.i0 = 0; so.w0 = 1; so.i1 = 0; so.w1 = 0; so.i2 = 0; so.w2 = 0; so.i3 = 0; so.w3 = 0;
        this.skinning(x, y, z, so);
        const sum = so.w0 + so.w1 + so.w2 + so.w3 || 1;
        this.si.push(so.i0, so.i1, so.i2, so.i3);
        this.sw.push(so.w0 / sum, so.w1 / sum, so.w2 / sum, so.w3 / sum);
      }
    }
  }

  /** Finish: produce the BufferGeometry (bounding volumes are set generously for animated figures). */
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const nv = this.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aEmissive', new THREE.Float32BufferAttribute(this.emi, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3.2);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-3, -0.5, -3), new THREE.Vector3(3, 3.4, 3));
    return g;
  }
}
