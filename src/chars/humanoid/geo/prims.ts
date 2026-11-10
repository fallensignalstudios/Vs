/**
 * Shape primitives for the MeshBuilder: superellipse lofts (closed limbs/torsos and open bevelled armour shells
 * with raised trims), lathes, chamfered boxes, tubes along paths, bevelled prisms and generic ring sweeps.
 * All winding is resolved against a known outward direction, so mirrored / inverted authoring cannot flip faces.
 *
 * Ring convention: theta 0° = front (−Z), 90° = +X (the figure's right), 180° = back (+Z), 270° = −X.
 */
import * as THREE from 'three';
import { MeshBuilder, Prim, type Surf } from './builder';

const DEG = Math.PI / 180;

/** One cross-section of a loft. Lengths in metres, angles in degrees. */
export interface Sec {
  y: number;
  /** half-width (X) */
  rx: number;
  /** half-depth toward the front (−Z) */
  rz: number;
  /** half-depth toward the back (+Z); defaults to rz */
  rzb?: number;
  cx?: number;
  cz?: number;
  /** superellipse exponent: 2 = ellipse, 3..5 = increasingly boxy */
  n?: number;
  /** ring tilt about X: positive raises the front */
  tilt?: number;
  /** ring tilt about Z: positive raises the +X side */
  roll?: number;
  /** per-section arc override (open shells that taper) */
  a0?: number;
  a1?: number;
  /** hard crease at this section (closed tubes) */
  hard?: boolean;
  /** surf slot for this ring (colour banding) */
  slot?: number;
}

export type Cap = 'none' | 'flat' | 'dome' | { dome: number; k?: number };

export interface Trim {
  /** band width in metres */
  w: number;
  /** how far the band stands proud of the panel (m) */
  raise?: number;
  /** surf slot used by the band (default 1) */
  slot?: number;
  v0?: boolean; v1?: boolean; u0?: boolean; u1?: boolean;
}

export interface LoftOpts {
  /** segments around the full arc */
  seg?: number;
  /** open arc [from,to] degrees; omit for a closed ring */
  arc?: [number, number];
  /** Catmull-Rom subdivisions per span (organic shapes) */
  smooth?: number;
  /** shell thickness (open arcs always get it; closed rings only when given) */
  thick?: number;
  bevel?: number;
  /** also build the inner face (visible undersides: cloaks, shields, skirts) */
  inner?: boolean;
  innerSlot?: number;
  capA?: Cap;
  capB?: Cap;
  trim?: Trim;
  /** radial multiplier (theta radians −π..π with 0 = front, v 0..1 along the loft, y of the section) */
  fn?: (theta: number, v: number, y: number) => number;
  /** surf slots: [0] overrides the current surf, [1..] trims / bands */
  slots?: Array<Surf | undefined>;
}

interface FullSec { y: number; rx: number; rz: number; rzb: number; cx: number; cz: number; n: number; tilt: number; roll: number; a0: number; a1: number; hard: boolean; slot: number }

function full(s: Sec, arc: [number, number] | undefined): FullSec {
  return {
    y: s.y, rx: s.rx, rz: s.rz, rzb: s.rzb ?? s.rz, cx: s.cx ?? 0, cz: s.cz ?? 0, n: s.n ?? 2, tilt: s.tilt ?? 0, roll: s.roll ?? 0,
    a0: s.a0 ?? (arc ? arc[0] : 0), a1: s.a1 ?? (arc ? arc[1] : 360), hard: !!s.hard, slot: s.slot ?? 0,
  };
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const NUM_KEYS = ['y', 'rx', 'rz', 'rzb', 'cx', 'cz', 'n', 'tilt', 'roll', 'a0', 'a1'] as const;

function expand(secs: Sec[], sub: number, arc: [number, number] | undefined): FullSec[] {
  const F = secs.map((s) => full(s, arc));
  if (sub <= 1 || F.length < 2) return F;
  const out: FullSec[] = [];
  for (let i = 0; i < F.length - 1; i++) {
    const p1 = F[i], p2 = F[i + 1];
    const p0 = i > 0 && !p1.hard ? F[i - 1] : p1;
    const p3 = i + 2 < F.length && !p2.hard ? F[i + 2] : p2;
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      if (k === 0) { out.push(p1); continue; }
      const s = { ...p1, hard: false } as FullSec;
      for (const key of NUM_KEYS) s[key] = cr(p0[key], p1[key], p2[key], p3[key], t);
      s.rx = Math.max(1e-4, s.rx); s.rz = Math.max(1e-4, s.rz); s.rzb = Math.max(1e-4, s.rzb);
      out.push(s);
    }
  }
  out.push(F[F.length - 1]);
  return out;
}

function lerpSec(a: FullSec, b: FullSec, t: number): FullSec {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const s = { ...a } as FullSec;
  for (const key of NUM_KEYS) s[key] = a[key] + (b[key] - a[key]) * t;
  return s;
}

const R = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

/** Point + approximate outward normal on a section ring. */
function ringPoint(sec: FullSec, theta: number, mul: number): typeof R {
  const s = Math.sin(theta), c = Math.cos(theta);
  const ex = 2 / sec.n, en = (2 * (sec.n - 1)) / sec.n;
  const as = Math.abs(s), ac = Math.abs(c);
  const rzz = c >= 0 ? sec.rz : sec.rzb;
  let lx = sec.rx * Math.sign(s) * Math.pow(as, ex) * mul;
  let ly = 0;
  let lz = -rzz * Math.sign(c) * Math.pow(ac, ex) * mul;
  let nx = (Math.sign(s) * Math.pow(as, en)) / Math.max(sec.rx, 1e-5);
  let ny = 0;
  let nz = (-Math.sign(c) * Math.pow(ac, en)) / Math.max(rzz, 1e-5);
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  if (sec.tilt !== 0) {
    const a = sec.tilt * DEG, ca = Math.cos(a), sa = Math.sin(a);
    ly = -lz * sa; lz = lz * ca;
    ny = -nz * sa; nz = nz * ca;
  }
  if (sec.roll !== 0) {
    const a = sec.roll * DEG, ca = Math.cos(a), sa = Math.sin(a);
    const x0 = lx, y0 = ly;
    lx = x0 * ca - y0 * sa; ly = x0 * sa + y0 * ca;
    const n0 = nx, n1 = ny;
    nx = n0 * ca - n1 * sa; ny = n0 * sa + n1 * ca;
  }
  R.x = lx + sec.cx; R.y = ly + sec.y; R.z = lz + sec.cz;
  R.nx = nx; R.ny = ny; R.nz = nz;
  return R;
}

function axisOf(sec: FullSec, out: THREE.Vector3): THREE.Vector3 {
  const a = sec.tilt * DEG, bz = sec.roll * DEG;
  return out.set(-Math.cos(a) * Math.sin(bz), Math.cos(a) * Math.cos(bz), Math.sin(a));
}

const _ax = new THREE.Vector3();

/**
 * Loft a list of sections. Closed ring + no thickness → solid tube (limbs, torsos) with optional caps.
 * Open arc or thickness → bevelled shell with edge walls and optional raised trim (armour plates).
 */
export function loft(b: MeshBuilder, secs: Sec[], o: LoftOpts = {}): void {
  const S = expand(secs, o.smooth ?? 1, o.arc);
  const open = !!o.arc || secs.some((s) => s.a0 !== undefined || s.a1 !== undefined);
  if (!open && o.thick === undefined) loftTube(b, S, o);
  else loftShell(b, S, o, !open);
}

function loftTube(b: MeshBuilder, S: FullSec[], o: LoftOpts): void {
  const seg = o.seg ?? 16;
  const prim = new Prim();
  const nrm: number[] = [];
  const fn = o.fn;
  const vAt = (j: number): number => (S.length > 1 ? j / (S.length - 1) : 0);
  const ring = (sec: FullSec, v: number, edge: number): number => {
    const start = prim.count;
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const r = ringPoint(sec, th, fn ? fn(th > Math.PI ? th - Math.PI * 2 : th, v, sec.y) : 1);
      prim.v(r.x, r.y, r.z, sec.slot, edge);
      nrm.push(r.nx, r.ny, r.nz);
    }
    return start;
  };
  const join = (a: number, c: number): void => {
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      prim.quadDir(a + k, a + k1, c + k1, c + k, nrm[(a + k) * 3], nrm[(a + k) * 3 + 1], nrm[(a + k) * 3 + 2]);
    }
  };
  const cap = (sec: FullSec, v: number, spec: Cap | undefined, dir: number, edgeRing: number): void => {
    if (!spec || spec === 'none') return;
    axisOf(sec, _ax).multiplyScalar(dir);
    if (spec === 'flat') {
      const r0 = ring(sec, v, 0.6);
      const c = prim.v(sec.cx, sec.y, sec.cz, sec.slot, 0, 0.9);
      nrm.push(_ax.x, _ax.y, _ax.z);
      for (let k = 0; k < seg; k++) prim.triDir(r0 + k, r0 + ((k + 1) % seg), c, _ax.x, _ax.y, _ax.z);
      return;
    }
    const h = spec === 'dome' ? Math.min(sec.rx, sec.rz) * 0.85 : spec.dome;
    const K = spec === 'dome' ? 3 : spec.k ?? 3;
    let prev = edgeRing;
    const ax = _ax.x, ay = _ax.y, az = _ax.z;
    for (let k = 1; k <= K; k++) {
      const phi = (k / (K + 1)) * (Math.PI / 2);
      const sc = Math.cos(phi), d = h * Math.sin(phi);
      const s2: FullSec = { ...sec, rx: sec.rx * sc, rz: sec.rz * sc, rzb: sec.rzb * sc, cx: sec.cx + ax * d, y: sec.y + ay * d, cz: sec.cz + az * d };
      const r1 = ring(s2, v, 0);
      // blend the radial normal toward the axis so winding tests stay valid near the pole
      for (let i = 0; i < seg; i++) { const q = (r1 + i) * 3; nrm[q] = nrm[q] * sc + ax * (1 - sc); nrm[q + 1] = nrm[q + 1] * sc + ay * (1 - sc); nrm[q + 2] = nrm[q + 2] * sc + az * (1 - sc); }
      join(prev, r1);
      prev = r1;
    }
    const pole = prim.v(sec.cx + ax * h, sec.y + ay * h, sec.cz + az * h, sec.slot);
    nrm.push(ax, ay, az);
    for (let k = 0; k < seg; k++) prim.triDir(prev + k, prev + ((k + 1) % seg), pole, ax, ay, az);
  };

  let prev = -1;
  let first = -1;
  for (let j = 0; j < S.length; j++) {
    const sec = S[j];
    let r0 = ring(sec, vAt(j), sec.hard ? 0.8 : 0);
    if (prev >= 0) join(prev, r0);
    if (first < 0) first = r0;
    if (sec.hard && j > 0 && j < S.length - 1) r0 = ring(sec, vAt(j), 0.8);
    prev = r0;
  }
  // caps: the axis must point away from the body of the tube
  const dirA = S.length > 1 && S[1].y < S[0].y ? 1 : -1;
  cap(S[0], 0, o.capA, dirA, first);
  cap(S[S.length - 1], 1, o.capB, -dirA, prev);
  b.commit(prim, o.slots);
}

interface Lat { t: number; kind: number }

/** Border lattice: positions in metres along a span of `len`, with bevel + optional trim at each end. */
function lattice(len: number, n: number, bevel: number, trim: number, lo: boolean, hi: boolean, trimLo: boolean, trimHi: boolean): Lat[] {
  const out: Lat[] = [];
  const step = Math.min(0.004, trim * 0.5 || 0.004);
  let a = 0, c = len;
  if (lo) {
    out.push({ t: 0, kind: 2 });
    if (trimLo && trim > 0) { out.push({ t: bevel, kind: 1 }, { t: bevel + trim, kind: 1 }); a = bevel + trim + step; }
    else a = bevel;
  }
  const tail: Lat[] = [];
  if (hi) {
    tail.push({ t: len, kind: 2 });
    if (trimHi && trim > 0) { tail.push({ t: len - bevel, kind: 1 }, { t: len - bevel - trim, kind: 1 }); c = len - bevel - trim - step; }
    else c = len - bevel;
  }
  if (c <= a) { a = len * 0.4; c = len * 0.6; }
  const m = Math.max(1, n);
  for (let i = 0; i <= m; i++) out.push({ t: a + ((c - a) * i) / m, kind: 0 });
  for (let i = tail.length - 1; i >= 0; i--) out.push(tail[i]);
  return out;
}

function loftShell(b: MeshBuilder, S: FullSec[], o: LoftOpts, wrap: boolean): void {
  const seg = o.seg ?? 12;
  const thick = o.thick ?? 0.012;
  const bevel = o.bevel ?? Math.min(0.005, thick * 0.45);
  const trim = o.trim;
  const tw = trim ? trim.w : 0;
  const raise = trim ? trim.raise ?? 0.003 : 0;
  const tslot = trim ? trim.slot ?? 1 : 0;
  const fn = o.fn;
  const prim = new Prim();
  const nrm: number[] = [];

  // cumulative length along the loft axis
  const L: number[] = [0];
  for (let j = 1; j < S.length; j++) {
    const a = S[j - 1], c = S[j];
    const dr = (c.rx + c.rz) * 0.5 - (a.rx + a.rz) * 0.5;
    L.push(L[j - 1] + Math.hypot(c.y - a.y, c.cx - a.cx, c.cz - a.cz, dr));
  }
  const total = L[L.length - 1] || 1e-3;
  const secAt = (len: number): FullSec => {
    if (S.length === 1) return S[0];
    let j = 0;
    while (j < S.length - 2 && L[j + 1] < len) j++;
    const span = L[j + 1] - L[j];
    return lerpSec(S[j], S[j + 1], span > 1e-9 ? (len - L[j]) / span : 0);
  };

  // v lattice: borders + every authored section in between
  const vb = lattice(total, 1, bevel, tw, true, true, trim ? trim.v0 !== false : false, trim ? trim.v1 !== false : false);
  const vLo = vb.findIndex((x) => x.kind === 0), vHi = vb.length - 1 - [...vb].reverse().findIndex((x) => x.kind === 0);
  const vs: Lat[] = vb.slice(0, vLo + 1);
  for (let j = 1; j < S.length - 1; j++) if (L[j] > vb[vLo].t + 1e-4 && L[j] < vb[vHi].t - 1e-4) vs.push({ t: L[j], kind: 0 });
  for (let i = vHi; i < vb.length; i++) vs.push(vb[i]);

  // u lattice
  const mid = S[Math.floor(S.length / 2)];
  const arcLen = Math.max(1e-3, Math.abs(mid.a1 - mid.a0) * DEG * (mid.rx + mid.rz) * 0.5);
  const us: Lat[] = wrap
    ? Array.from({ length: seg }, (_, k) => ({ t: (k / seg) * arcLen, kind: 0 }))
    : lattice(arcLen, seg, bevel, tw, true, true, trim ? trim.u0 !== false : false, trim ? trim.u1 !== false : false);

  const nu = us.length, nv = vs.length;
  const G: number[] = new Array(nu * nv);
  for (let vi = 0; vi < nv; vi++) {
    const sec = secAt(vs[vi].t);
    const vv = vs[vi].t / total;
    for (let ui = 0; ui < nu; ui++) {
      const u = us[ui].t / arcLen;
      const th = (sec.a0 + (sec.a1 - sec.a0) * u) * DEG;
      const r = ringPoint(sec, th, fn ? fn(th > Math.PI ? th - Math.PI * 2 : th, vv, sec.y) : 1);
      const kind = Math.max(us[ui].kind, vs[vi].kind);
      const h = kind === 2 ? -bevel * 0.7 + raise * 0.3 : kind === 1 ? raise : 0;
      const hasTrimNear = kind === 2 && tw > 0 && ((us[ui].kind === 2 && (ui === 0 ? trim!.u0 !== false : trim!.u1 !== false)) || (vs[vi].kind === 2 && (vi === 0 ? trim!.v0 !== false : trim!.v1 !== false)));
      const slot = kind === 1 || hasTrimNear ? tslot : sec.slot;
      G[vi * nu + ui] = prim.v(r.x + r.nx * h, r.y + r.ny * h, r.z + r.nz * h, slot, kind === 2 ? 1 : kind === 1 ? 0.35 : 0);
      nrm.push(r.nx, r.ny, r.nz);
    }
  }
  const uMax = wrap ? nu : nu - 1;
  for (let vi = 0; vi < nv - 1; vi++) {
    for (let ui = 0; ui < uMax; ui++) {
      const u1 = (ui + 1) % nu;
      const a = G[vi * nu + ui], c = G[vi * nu + u1], d = G[(vi + 1) * nu + u1], e = G[(vi + 1) * nu + ui];
      prim.quadDir(a, c, d, e, nrm[a * 3], nrm[a * 3 + 1], nrm[a * 3 + 2]);
    }
  }

  // edge walls
  const P = prim.p;
  const wallPair = (top: number): [number, number] => {
    const x = P[top * 3], y = P[top * 3 + 1], z = P[top * 3 + 2];
    const nx = nrm[top * 3], ny = nrm[top * 3 + 1], nz = nrm[top * 3 + 2];
    const t = prim.v(x, y, z, prim.s[top], 1, 0.85);
    nrm.push(nx, ny, nz);
    const bt = prim.v(x - nx * thick, y - ny * thick, z - nz * thick, prim.s[top], 0, 0.4);
    nrm.push(nx, ny, nz);
    return [t, bt];
  };
  const wall = (idx: number[], inward: number[]): void => {
    let prevT = -1, prevB = -1, prevI = -1;
    for (let i = 0; i < idx.length; i++) {
      const [t, bt] = wallPair(idx[i]);
      if (prevT >= 0) {
        // outward = away from the neighbouring interior vertex
        const a = idx[i - 1], q = inward[i - 1];
        prim.quadDir(prevT, t, bt, prevB, P[a * 3] - P[q * 3], P[a * 3 + 1] - P[q * 3 + 1], P[a * 3 + 2] - P[q * 3 + 2]);
      }
      prevT = t; prevB = bt; prevI = i;
    }
    void prevI;
  };
  const row = (vi: number): number[] => { const r: number[] = []; for (let ui = 0; ui < nu; ui++) r.push(G[vi * nu + ui]); if (wrap) r.push(G[vi * nu]); return r; };
  const colm = (ui: number): number[] => { const r: number[] = []; for (let vi = 0; vi < nv; vi++) r.push(G[vi * nu + ui]); return r; };
  wall(row(0), row(1));
  wall(row(nv - 1), row(nv - 2));
  if (!wrap) { wall(colm(0), colm(1)); wall(colm(nu - 1), colm(nu - 2)); }

  if (o.inner) {
    const islot = o.innerSlot ?? 0;
    const H: number[] = new Array(nu * nv);
    for (let i = 0; i < nu * nv; i++) {
      const g = G[i];
      H[i] = prim.v(P[g * 3] - nrm[g * 3] * thick, P[g * 3 + 1] - nrm[g * 3 + 1] * thick, P[g * 3 + 2] - nrm[g * 3 + 2] * thick, islot, 0, 0.5);
      nrm.push(nrm[g * 3], nrm[g * 3 + 1], nrm[g * 3 + 2]);
    }
    for (let vi = 0; vi < nv - 1; vi++) {
      for (let ui = 0; ui < uMax; ui++) {
        const u1 = (ui + 1) % nu;
        const a = H[vi * nu + ui], c = H[vi * nu + u1], d = H[(vi + 1) * nu + u1], e = H[(vi + 1) * nu + ui];
        prim.quadDir(a, c, d, e, -nrm[a * 3], -nrm[a * 3 + 1], -nrm[a * 3 + 2]);
      }
    }
  }
  b.commit(prim, o.slots);
}

/** Revolve a profile [radius, y] around Y. Repeat a point to crease. */
export function lathe(b: MeshBuilder, profile: Array<[number, number]>, o: LoftOpts = {}): void {
  const secs: Sec[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i];
    const dup = i > 0 && profile[i - 1][0] === r && profile[i - 1][1] === y;
    if (dup) { secs[secs.length - 1].hard = true; continue; }
    secs.push({ y, rx: Math.max(r, 1e-4), rz: Math.max(r, 1e-4) });
  }
  loft(b, secs, o);
}

/** Ellipsoid centred on the origin. */
export function ball(b: MeshBuilder, rx: number, ry: number, rz: number, seg = 12, rows = 7): void {
  const secs: Sec[] = [];
  for (let k = 1; k < rows; k++) {
    const phi = (k / rows) * Math.PI;
    secs.push({ y: -ry * Math.cos(phi), rx: rx * Math.sin(phi), rz: rz * Math.sin(phi) });
  }
  const h = ry * (1 - Math.cos(Math.PI / rows));
  loft(b, secs, { seg, capA: { dome: h, k: 0 }, capB: { dome: h, k: 0 } });
}

export interface BoxOpts {
  bevel?: number;
  /** scale of the +Y face in x / z (trapezoids) */
  taper?: [number, number];
  slots?: Array<Surf | undefined>;
  edge?: number;
}

/** Chamfered box centred on the origin. */
export function box(b: MeshBuilder, sx: number, sy: number, sz: number, o: BoxOpts = {}): void {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const bv = Math.min(o.bevel ?? Math.min(sx, sy, sz) * 0.12, hx * 0.95, hy * 0.95, hz * 0.95);
  const tx = o.taper ? o.taper[0] : 1, tz = o.taper ? o.taper[1] : 1;
  const ed = o.edge ?? 0.6;
  const prim = new Prim();
  const id = (ix: number, iy: number, iz: number, f: number): number => ((ix * 2 + iy) * 2 + iz) * 3 + f;
  for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
    const X = ix ? 1 : -1, Y = iy ? 1 : -1, Z = iz ? 1 : -1;
    const kx = Y > 0 ? tx : 1, kz = Y > 0 ? tz : 1;
    // lerp taper for the vertices lowered by the bevel on Y
    const kxb = 1 + (kx - 1) * (1 - bv / sy), kzb = 1 + (kz - 1) * (1 - bv / sy);
    prim.v(X * hx * kxb, Y * (hy - bv), Z * (hz - bv) * kzb, 0, ed);
    prim.v(X * (hx - bv) * kx, Y * hy, Z * (hz - bv) * kz, 0, ed);
    prim.v(X * (hx - bv) * kxb, Y * (hy - bv), Z * hz * kzb, 0, ed);
  }
  for (let s = 0; s < 2; s++) {
    const S = s ? 1 : -1;
    prim.quadDir(id(s, 0, 0, 0), id(s, 1, 0, 0), id(s, 1, 1, 0), id(s, 0, 1, 0), S, 0, 0);
    prim.quadDir(id(0, s, 0, 1), id(1, s, 0, 1), id(1, s, 1, 1), id(0, s, 1, 1), 0, S, 0);
    prim.quadDir(id(0, 0, s, 2), id(1, 0, s, 2), id(1, 1, s, 2), id(0, 1, s, 2), 0, 0, S);
  }
  for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) {
    const A = p ? 1 : -1, B = q ? 1 : -1;
    prim.quadDir(id(p, q, 0, 0), id(p, q, 1, 0), id(p, q, 1, 1), id(p, q, 0, 1), A, B, 0);
    prim.quadDir(id(p, 0, q, 0), id(p, 1, q, 0), id(p, 1, q, 2), id(p, 0, q, 2), A, 0, B);
    prim.quadDir(id(0, p, q, 1), id(1, p, q, 1), id(1, p, q, 2), id(0, p, q, 2), 0, A, B);
  }
  for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
    prim.triDir(id(ix, iy, iz, 0), id(ix, iy, iz, 1), id(ix, iy, iz, 2), ix ? 1 : -1, iy ? 1 : -1, iz ? 1 : -1);
  }
  b.commit(prim, o.slots);
}

export type V3 = readonly [number, number, number];

export interface TubeOpts { seg?: number; closed?: boolean; caps?: boolean; slots?: Array<Surf | undefined>; /** flatten factor along the frame normal */ flat?: number }

/** Round tube along a polyline (cables, straps, hoses, halo rings). `r` may vary per point. */
export function tube(b: MeshBuilder, pts: V3[], r: number | number[], o: TubeOpts = {}): void {
  const n = pts.length;
  if (n < 2) return;
  const seg = o.seg ?? 6;
  const closed = !!o.closed;
  const prim = new Prim();
  const rad = (i: number): number => (typeof r === 'number' ? r : r[Math.min(i, r.length - 1)]);
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), prevT = new THREE.Vector3(), tmp = new THREE.Vector3();
  const P = (i: number): V3 => pts[((i % n) + n) % n];
  const tangent = (i: number, out: THREE.Vector3): THREE.Vector3 => {
    const a = closed ? P(i - 1) : pts[Math.max(0, i - 1)], c = closed ? P(i + 1) : pts[Math.min(n - 1, i + 1)];
    return out.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
  };
  tangent(0, T);
  N.set(0, 1, 0);
  if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
  N.sub(tmp.copy(T).multiplyScalar(N.dot(T))).normalize();
  const dirs: number[] = [];
  const rings: number[] = [];
  const flat = o.flat ?? 1;
  for (let i = 0; i < n; i++) {
    prevT.copy(T);
    tangent(i, T);
    // parallel transport
    tmp.crossVectors(prevT, T);
    const s = tmp.length();
    if (s > 1e-6) { tmp.divideScalar(s); N.applyAxisAngle(tmp, Math.atan2(s, prevT.dot(T))); }
    N.sub(tmp.copy(T).multiplyScalar(N.dot(T))).normalize();
    B.crossVectors(T, N);
    rings.push(prim.count);
    const p = pts[i], ri = rad(i);
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a) * flat, sa = Math.sin(a);
      const dx = N.x * ca + B.x * sa, dy = N.y * ca + B.y * sa, dz = N.z * ca + B.z * sa;
      prim.v(p[0] + dx * ri, p[1] + dy * ri, p[2] + dz * ri);
      dirs.push(dx, dy, dz);
    }
  }
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = rings[i], c = rings[(i + 1) % n];
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      prim.quadDir(a + k, a + k1, c + k1, c + k, dirs[(a + k) * 3], dirs[(a + k) * 3 + 1], dirs[(a + k) * 3 + 2]);
    }
  }
  if (!closed && o.caps !== false) {
    for (const end of [0, n - 1]) {
      tangent(end, T);
      if (end === 0) T.negate();
      const c = prim.v(pts[end][0], pts[end][1], pts[end][2]);
      const a = rings[end];
      for (let k = 0; k < seg; k++) prim.triDir(a + k, a + ((k + 1) % seg), c, T.x, T.y, T.z);
    }
  }
  b.commit(prim, o.slots);
}

export interface PrismOpts { bevel?: number; slots?: Array<Surf | undefined>; /** slot for the front/back faces */ faceSlot?: number; edge?: number }

/** Extrude a 2D outline (XY, any winding) along Z, centred, with chamfered rims. */
export function prism(b: MeshBuilder, outline: Array<readonly [number, number]>, depth: number, o: PrismOpts = {}): void {
  const n = outline.length;
  if (n < 3) return;
  const bv = Math.min(o.bevel ?? depth * 0.2, depth * 0.49);
  const fs = o.faceSlot ?? 0;
  const ed = o.edge ?? 0.7;
  let cx = 0, cy = 0;
  for (const p of outline) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let rad = 0;
  for (const p of outline) rad += Math.hypot(p[0] - cx, p[1] - cy);
  rad /= n;
  const k = Math.max(0.2, 1 - bv / Math.max(rad, 1e-4));
  const prim = new Prim();
  const hz = depth / 2;
  const ringAt = (z: number, sc: number, slot: number, e: number): number => {
    const s = prim.count;
    for (const p of outline) prim.v(cx + (p[0] - cx) * sc, cy + (p[1] - cy) * sc, z, slot, e);
    return s;
  };
  const f0 = ringAt(hz, k, fs, ed * 0.5), s0 = ringAt(hz - bv, 1, 0, ed), s1 = ringAt(-hz + bv, 1, 0, ed), f1 = ringAt(-hz, k, fs, ed * 0.5);
  const P = prim.p;
  const joinRings = (a: number, c: number): void => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mx = (P[(a + i) * 3] + P[(a + j) * 3]) * 0.5 - cx, my = (P[(a + i) * 3 + 1] + P[(a + j) * 3 + 1]) * 0.5 - cy;
      const mz = (P[(a + i) * 3 + 2] + P[(c + i) * 3 + 2]) * 0.5;
      prim.quadDir(a + i, a + j, c + j, c + i, mx, my, mz * 0.6);
    }
  };
  joinRings(f0, s0); joinRings(s0, s1); joinRings(s1, f1);
  const contour = outline.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const t of tris) {
    prim.triDir(f0 + t[0], f0 + t[1], f0 + t[2], 0, 0, 1);
    prim.triDir(f1 + t[0], f1 + t[1], f1 + t[2], 0, 0, -1);
  }
  b.commit(prim, o.slots);
}

export interface SweepPoint { x: number; y: number; z: number; slot?: number; edge?: number }

/** Connect consecutive closed rings of equal vertex count (blades, bespoke profiles). Flat-capped. */
export function sweep(b: MeshBuilder, rings: SweepPoint[][], o: { slots?: Array<Surf | undefined>; caps?: boolean } = {}): void {
  if (rings.length < 2) return;
  const m = rings[0].length;
  const prim = new Prim();
  const starts: number[] = [];
  const cen: number[] = [];
  for (const ring of rings) {
    starts.push(prim.count);
    let x = 0, y = 0, z = 0;
    for (const p of ring) { prim.v(p.x, p.y, p.z, p.slot ?? 0, p.edge ?? 0); x += p.x; y += p.y; z += p.z; }
    cen.push(x / m, y / m, z / m);
  }
  const P = prim.p;
  for (let i = 0; i < rings.length - 1; i++) {
    const a = starts[i], c = starts[i + 1];
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      const mx = (P[(a + k) * 3] + P[(a + k1) * 3]) * 0.5 - cen[i * 3], my = (P[(a + k) * 3 + 1] + P[(a + k1) * 3 + 1]) * 0.5 - cen[i * 3 + 1], mz = (P[(a + k) * 3 + 2] + P[(a + k1) * 3 + 2]) * 0.5 - cen[i * 3 + 2];
      prim.quadDir(a + k, a + k1, c + k1, c + k, mx, my, mz);
    }
  }
  if (o.caps !== false) {
    const last = rings.length - 1;
    for (const [ri, other] of [[0, 1], [last, last - 1]] as const) {
      const dx = cen[ri * 3] - cen[other * 3], dy = cen[ri * 3 + 1] - cen[other * 3 + 1], dz = cen[ri * 3 + 2] - cen[other * 3 + 2];
      const a = prim.count;
      for (const p of rings[ri]) prim.v(p.x, p.y, p.z, p.slot ?? 0, p.edge ?? 0);
      const c = prim.v(cen[ri * 3], cen[ri * 3 + 1], cen[ri * 3 + 2], rings[ri][0].slot ?? 0);
      for (let k = 0; k < m; k++) prim.triDir(a + k, a + ((k + 1) % m), c, dx, dy, dz);
    }
  }
  b.commit(prim, o.slots);
}

/** Flat ring / torus around Y at the origin (hilt rings, collars, halos). */
export function torus(b: MeshBuilder, R0: number, r: number, o: { seg?: number; tubeSeg?: number; arc?: [number, number]; flat?: number; slots?: Array<Surf | undefined> } = {}): void {
  const seg = o.seg ?? 24;
  const a0 = (o.arc ? o.arc[0] : 0) * DEG, a1 = (o.arc ? o.arc[1] : 360) * DEG;
  const closed = !o.arc;
  const pts: V3[] = [];
  const cnt = closed ? seg : seg + 1;
  for (let i = 0; i < cnt; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pts.push([Math.sin(a) * R0, 0, -Math.cos(a) * R0]);
  }
  tube(b, pts, r, { seg: o.tubeSeg ?? 6, closed, flat: o.flat, slots: o.slots });
}
