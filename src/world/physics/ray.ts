/**
 * Ray and swept-sphere casting against solids (oriented boxes / vertical cylinders) and the walkable surface
 * planes. Rays walk the spatial hash with a 2D DDA so long sight lines stay cheap; sweeps are short and use
 * one broadphase box query. Pure TypeScript math — no three.js.
 *
 * Floors are physical: a ray masked RAY_SIGHT / RAY_SHOT also stops at every surface that blocks sight /
 * shots (the default), so a deck or a bare ramp hides what is beneath it without needing a slab solid.
 * RAY_GROUND adds every surface regardless of its flags. Sweeps only meet floors when RAY_GROUND is set.
 *
 * Swept spheres are tested as rays against shapes inflated by the sphere radius (boxes inflate to boxes, so
 * box edges/corners are conservative by at most (√2 − 1)·radius — a camera never clips, it may stop a few
 * centimetres early at a sharp corner). A sweep that starts overlapping a shape is only stopped by it when
 * the motion goes deeper in; moving out of it, or along it, is free.
 */
import { RAY_GROUND, RAY_MOVE, RAY_SHOT, RAY_SIGHT } from '@/core/api/physics';
import type { RayHit } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import { colliderContains } from './shapes';
import type { ColliderRec, SurfaceRec } from './shapes';
import type { PhysicsCore } from './world';

const SOLID_MASK = 7;
const MAX_RAY = 4000;
const MAX_WALK_CELLS = 2048;
/** distance a sweep stops short of contact so the next sweep starts outside the shape */
const SWEEP_SKIN = 0.01;
/** a sight / fire line ignores a floor that one of its endpoints is resting on (within this, vertically) */
const FLOOR_TOUCH = 0.05;
/** a ray that starts this close beneath a floor does not hit its underside */
const FLOOR_BACK = 0.02;

/** Result of the last internal cast (module-level; casting never re-enters). */
const HIT = {
  t: 0, nx: 0, ny: 0, nz: 0,
  collider: null as ColliderRec | null,
  surface: null as SurfaceRec | null,
};
/** normal of the last primitive test */
let tnx = 0, tny = 0, tnz = 0;

const walkIx: number[] = [];
const walkIz: number[] = [];
const walkT: number[] = [];
const sweepC: ColliderRec[] = [];
const sweepS: SurfaceRec[] = [];

/** Ray vs oriented box inflated by `rad`. Returns the entry distance (0 when starting inside) or -1. */
function rayBox(c: ColliderRec, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, rad: number): number {
  const px = ox - c.cx, pz = oz - c.cz;
  const lox = px * c.cos - pz * c.sin, loz = px * c.sin + pz * c.cos;
  const loy = oy - (c.yMin + c.yMax) * 0.5;
  const ldx = dx * c.cos - dz * c.sin, ldz = dx * c.sin + dz * c.cos;
  const ex = c.hx + rad, ey = (c.yMax - c.yMin) * 0.5 + rad, ez = c.hz + rad;
  let tIn = -Infinity, tOut = Infinity, axis = -1, sign = 0;

  if (Math.abs(ldx) > 1e-12) {
    const inv = 1 / ldx;
    let t0 = (-ex - lox) * inv, t1 = (ex - lox) * inv, s = -1;
    if (t0 > t1) { const k = t0; t0 = t1; t1 = k; s = 1; }
    if (t0 > tIn) { tIn = t0; axis = 0; sign = s; }
    if (t1 < tOut) tOut = t1;
  } else if (lox <= -ex || lox >= ex) return -1;

  if (Math.abs(dy) > 1e-12) {
    const inv = 1 / dy;
    let t0 = (-ey - loy) * inv, t1 = (ey - loy) * inv, s = -1;
    if (t0 > t1) { const k = t0; t0 = t1; t1 = k; s = 1; }
    if (t0 > tIn) { tIn = t0; axis = 1; sign = s; }
    if (t1 < tOut) tOut = t1;
  } else if (loy <= -ey || loy >= ey) return -1;

  if (Math.abs(ldz) > 1e-12) {
    const inv = 1 / ldz;
    let t0 = (-ez - loz) * inv, t1 = (ez - loz) * inv, s = -1;
    if (t0 > t1) { const k = t0; t0 = t1; t1 = k; s = 1; }
    if (t0 > tIn) { tIn = t0; axis = 2; sign = s; }
    if (t1 < tOut) tOut = t1;
  } else if (loz <= -ez || loz >= ez) return -1;

  if (tIn > tOut || tOut <= 1e-9) return -1;
  if (tIn < 0) {
    if (rad <= 0) { tnx = -dx; tny = -dy; tnz = -dz; return 0; }
    // a sphere that starts overlapping: the nearest face is the way out — only motion into it is blocked
    const fx = ex - Math.abs(lox), fy = ey - Math.abs(loy), fz = ez - Math.abs(loz);
    if (fy <= fx && fy <= fz) {
      const sgn = loy < 0 ? -1 : 1;
      if (dy * sgn >= 0) return -1;
      tnx = 0; tny = sgn; tnz = 0;
    } else if (fx <= fz) {
      const sgn = lox < 0 ? -1 : 1;
      if (ldx * sgn >= 0) return -1;
      tnx = sgn * c.cos; tny = 0; tnz = -sgn * c.sin;
    } else {
      const sgn = loz < 0 ? -1 : 1;
      if (ldz * sgn >= 0) return -1;
      tnx = sgn * c.sin; tny = 0; tnz = sgn * c.cos;
    }
    return 0;
  }
  if (axis === 1) { tnx = 0; tny = sign; tnz = 0; }
  else if (axis === 0) { tnx = sign * c.cos; tny = 0; tnz = -sign * c.sin; }
  else { tnx = sign * c.sin; tny = 0; tnz = sign * c.cos; }
  return tIn;
}

/** Ray vs vertical cylinder inflated by `rad`. Returns the entry distance (0 when starting inside) or -1. */
function rayCyl(c: ColliderRec, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, rad: number): number {
  const px = ox - c.cx, pz = oz - c.cz;
  const py = oy - (c.yMin + c.yMax) * 0.5;
  const R = c.r + rad, H = (c.yMax - c.yMin) * 0.5 + rad;
  let s0 = -Infinity, s1 = Infinity;
  const a = dx * dx + dz * dz;
  const cc = px * px + pz * pz - R * R;
  if (a > 1e-12) {
    const b = px * dx + pz * dz;
    const disc = b * b - a * cc;
    if (disc <= 0) return -1;
    const sq = Math.sqrt(disc);
    s0 = (-b - sq) / a; s1 = (-b + sq) / a;
  } else if (cc >= 0) return -1;
  let y0 = -Infinity, y1 = Infinity, ys = -1;
  if (Math.abs(dy) > 1e-12) {
    const inv = 1 / dy;
    y0 = (-H - py) * inv; y1 = (H - py) * inv;
    if (y0 > y1) { const k = y0; y0 = y1; y1 = k; ys = 1; }
  } else if (py <= -H || py >= H) return -1;
  const tIn = s0 > y0 ? s0 : y0;
  const tOut = s1 < y1 ? s1 : y1;
  if (tIn > tOut || tOut <= 1e-9) return -1;
  if (tIn < 0) {
    if (rad <= 0) { tnx = -dx; tny = -dy; tnz = -dz; return 0; }
    // overlapping start (see rayBox): leave through the nearer of the side and the caps
    const d = Math.sqrt(px * px + pz * pz);
    if (H - Math.abs(py) <= R - d) {
      const sgn = py < 0 ? -1 : 1;
      if (dy * sgn >= 0) return -1;
      tnx = 0; tny = sgn; tnz = 0;
    } else {
      const ux = d > 1e-9 ? px / d : 1, uz = d > 1e-9 ? pz / d : 0;
      if (dx * ux + dz * uz >= 0) return -1;
      tnx = ux; tny = 0; tnz = uz;
    }
    return 0;
  }
  if (s0 >= y0) {
    tnx = (px + dx * tIn) / R; tny = 0; tnz = (pz + dz * tIn) / R;
  } else { tnx = 0; tny = ys; tnz = 0; }
  return tIn;
}

/** Ray vs a walkable surface plane (two-sided), footprint inflated by `rad`. Returns distance or -1. */
function raySurface(s: SurfaceRec, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, rad: number): number {
  const px = ox - s.cx, pz = oz - s.cz;
  if (s.isDisc || !s.ramp) {
    const dist = oy - s.yMid;
    const side = dist >= 0 ? 1 : -1;
    if (side * dy >= -1e-9) return -1; // parallel or moving away from the plane
    let t = (side * rad - dist) / dy;
    if (t < 0) t = 0; // sphere already overlapping the plane
    const hx = px + dx * t, hz = pz + dz * t;
    if (s.isDisc) {
      const d2 = hx * hx + hz * hz;
      const ro = s.r + rad;
      if (d2 > ro * ro) return -1;
      const ri = s.inner - rad;
      if (ri > 0 && d2 < ri * ri) return -1;
    } else {
      const lx = hx * s.cos - hz * s.sin, lz = hx * s.sin + hz * s.cos;
      if (Math.abs(lx) > s.hx + rad || Math.abs(lz) > s.hz + rad) return -1;
    }
    tnx = 0; tny = side; tnz = 0;
    return t;
  }
  // ramp: plane  Y − k·lz = yMid  in the surface frame
  const lox = px * s.cos - pz * s.sin, loz = px * s.sin + pz * s.cos;
  const ldx = dx * s.cos - dz * s.sin, ldz = dx * s.sin + dz * s.cos;
  const denom = dy - s.k * ldz; // rate of change of the (un-normalised) height above the plane
  const dist = oy - s.k * loz - s.yMid;
  const side = dist >= 0 ? 1 : -1;
  if (side * denom >= -1e-9) return -1;
  const nl = Math.sqrt(1 + s.k * s.k);
  let t = (side * rad * nl - dist) / denom;
  if (t < 0) t = 0;
  const lx = lox + ldx * t, lz = loz + ldz * t;
  if (Math.abs(lx) > s.hx + rad || Math.abs(lz) > s.hz + rad) return -1;
  const nlz = (-s.k / nl) * side, ny = side / nl;
  tnx = nlz * s.sin; tny = ny; tnz = nlz * s.cos;
  return t;
}

function testCollider(
  c: ColliderRec, mask: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  rad: number, a: Vec3Like | null, b: Vec3Like | null,
): void {
  if (!c.on || !(c.mask & mask)) return;
  const t = c.isBox ? rayBox(c, ox, oy, oz, dx, dy, dz, rad) : rayCyl(c, ox, oy, oz, dx, dy, dz, rad);
  if (t < 0 || t >= HIT.t) return;
  if (a && (colliderContains(c, a.x, a.y, a.z) || (b !== null && colliderContains(c, b.x, b.y, b.z)))) return;
  HIT.t = t; HIT.nx = tnx; HIT.ny = tny; HIT.nz = tnz;
  HIT.collider = c; HIT.surface = null;
}

/** Is `p` resting on the surface (over its footprint, within FLOOR_TOUCH of its height)? */
function touches(s: SurfaceRec, p: Vec3Like): boolean {
  const h = s.heightAt(p.x, p.z);
  return h === h && Math.abs(p.y - h) <= FLOOR_TOUCH;
}

function testSurface(
  s: SurfaceRec, mask: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  rad: number, a: Vec3Like | null, b: Vec3Like | null,
): void {
  if (!s.on) return;
  if (!(mask & RAY_GROUND)) {
    const bits = (s.desc.blocksSight !== false ? RAY_SIGHT : 0) | (s.desc.blocksShots !== false ? RAY_SHOT : 0);
    if (!(bits & mask)) return;
  }
  const t = raySurface(s, ox, oy, oz, dx, dy, dz, rad);
  if (t < 0 || t >= HIT.t) return;
  if (rad <= 0) {
    if (a) { if (touches(s, a) || (b !== null && touches(s, b))) return; }
    else if (tny < 0 && t <= FLOOR_BACK) return;
  }
  HIT.t = t; HIT.nx = tnx; HIT.ny = tny; HIT.nz = tnz;
  HIT.collider = null; HIT.surface = s;
}

/** Record the hash cells a ray crosses in order (Amanatides–Woo). Returns the cell count. */
function walkCells(cell: number, ox: number, oz: number, dx: number, dz: number, maxDist: number): number {
  let ix = Math.floor(ox / cell), iz = Math.floor(oz / cell);
  const stepX = dx > 1e-12 ? 1 : dx < -1e-12 ? -1 : 0;
  const stepZ = dz > 1e-12 ? 1 : dz < -1e-12 ? -1 : 0;
  const tDX = stepX !== 0 ? cell / Math.abs(dx) : Infinity;
  const tDZ = stepZ !== 0 ? cell / Math.abs(dz) : Infinity;
  let tMX = stepX > 0 ? ((ix + 1) * cell - ox) / dx : stepX < 0 ? (ix * cell - ox) / dx : Infinity;
  let tMZ = stepZ > 0 ? ((iz + 1) * cell - oz) / dz : stepZ < 0 ? (iz * cell - oz) / dz : Infinity;
  let t = 0, n = 0;
  while (t <= maxDist && n < MAX_WALK_CELLS) {
    walkIx[n] = ix; walkIz[n] = iz; walkT[n] = t; n++;
    if (tMX < tMZ) { t = tMX; tMX += tDX; ix += stepX; }
    else { t = tMZ; tMZ += tDZ; iz += stepZ; }
  }
  return n;
}

/**
 * Core cast. `d` must be unit length. Leaves the nearest hit in HIT and returns true, or returns false.
 * `a`/`b`: when given, colliders containing either point are ignored (line-of-sight endpoints).
 */
function cast(
  w: PhysicsCore, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  maxDist: number, mask: number, rad: number, a: Vec3Like | null, b: Vec3Like | null,
): boolean {
  HIT.t = maxDist + 1e-9;
  HIT.collider = null; HIT.surface = null;
  const solids = (mask & SOLID_MASK) !== 0;
  // sweeps meet floors only on request; rays also meet every floor that blocks what they are masked for
  const ground = (mask & (rad > 0 ? RAY_GROUND : RAY_GROUND | RAY_SIGHT | RAY_SHOT)) !== 0;
  const ch = w.colliderHash, sh = w.surfaceHash;

  if (rad > 0) {
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const minX = Math.min(ox, ex) - rad, maxX = Math.max(ox, ex) + rad;
    const minZ = Math.min(oz, ez) - rad, maxZ = Math.max(oz, ez) + rad;
    if (solids) {
      const n = ch.query(minX, minZ, maxX, maxZ, sweepC);
      for (let i = 0; i < n; i++) testCollider(sweepC[i], mask, ox, oy, oz, dx, dy, dz, rad, a, b);
    }
    if (ground) {
      const n = sh.query(minX, minZ, maxX, maxZ, sweepS);
      for (let i = 0; i < n; i++) testSurface(sweepS[i], mask, ox, oy, oz, dx, dy, dz, rad, null, null);
    }
    return HIT.collider !== null || HIT.surface !== null;
  }

  const cells = walkCells(ch.cell, ox, oz, dx, dz, maxDist);
  if (solids) {
    const big = ch.big;
    for (let i = 0; i < big.length; i++) testCollider(big[i], mask, ox, oy, oz, dx, dy, dz, 0, a, b);
    const stamp = ch.nextStamp();
    for (let k = 0; k < cells; k++) {
      if (walkT[k] > HIT.t) break;
      const list = ch.bucket(walkIx[k], walkIz[k]);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.stamp === stamp) continue;
        c.stamp = stamp;
        testCollider(c, mask, ox, oy, oz, dx, dy, dz, 0, a, b);
      }
    }
  }
  if (ground) {
    const big = sh.big;
    for (let i = 0; i < big.length; i++) testSurface(big[i], mask, ox, oy, oz, dx, dy, dz, 0, a, b);
    const stamp = sh.nextStamp();
    for (let k = 0; k < cells; k++) {
      if (walkT[k] > HIT.t) break;
      const list = sh.bucket(walkIx[k], walkIz[k]);
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.stamp === stamp) continue;
        s.stamp = stamp;
        testSurface(s, mask, ox, oy, oz, dx, dy, dz, 0, a, b);
      }
    }
  }
  return HIT.collider !== null || HIT.surface !== null;
}

const finite3 = (v: Vec3Like | null | undefined): v is Vec3Like =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * Nearest hit along a ray. Default mask: anything physical (RAY_SIGHT | RAY_SHOT). With `out`, that object
 * (and its point / normal) is filled and returned instead of allocating a new hit.
 */
export function raycast(
  w: PhysicsCore, origin: Vec3Like, dir: Vec3Like, maxDist: number, mask: number = RAY_SIGHT | RAY_SHOT,
  out?: RayHit,
): RayHit | null {
  if (!finite3(origin) || !finite3(dir) || !(maxDist > 0)) return null;
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-12) return null;
  const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
  const dist = Math.min(maxDist, MAX_RAY);
  if (!cast(w, origin.x, origin.y, origin.z, dx, dy, dz, dist, mask, 0, null, null)) return null;
  const t = HIT.t;
  const hit: RayHit = out ?? {
    point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, distance: 0, collider: null, ground: false, surface: null,
  };
  hit.point.x = origin.x + dx * t; hit.point.y = origin.y + dy * t; hit.point.z = origin.z + dz * t;
  hit.normal.x = HIT.nx; hit.normal.y = HIT.ny; hit.normal.z = HIT.nz;
  hit.distance = t;
  hit.collider = HIT.collider;
  hit.ground = HIT.surface !== null;
  hit.surface = HIT.surface;
  return hit;
}

/**
 * Is the segment a→b free of solids and floors matching `mask`? Colliders that contain either endpoint are
 * ignored, so a sight line to (or from) a device is not blocked by the device's own collision volume; so is a
 * floor that either endpoint rests on, so aiming at someone's feet or a spot on the ground is not blocked by
 * that ground.
 */
export function segmentClear(w: PhysicsCore, a: Vec3Like, b: Vec3Like, mask: number): boolean {
  if (!finite3(a) || !finite3(b)) return false;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return true;
  const dist = Math.min(len, MAX_RAY);
  if (!cast(w, a.x, a.y, a.z, dx / len, dy / len, dz / len, dist, mask & SOLID_MASK, 0, a, b)) return true;
  return HIT.t >= dist - 1e-6;
}

/**
 * Allowed fraction 0..1 of a sphere sweep from→to. Default mask: RAY_SIGHT | RAY_MOVE — everything a camera
 * must stay out of (walls, cover, glass, barriers, blocking volumes).
 */
export function sweepSphere(
  w: PhysicsCore, from: Vec3Like, to: Vec3Like, radius: number, mask: number = RAY_SIGHT | RAY_MOVE,
): number {
  if (!finite3(from) || !finite3(to)) return 0;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return 1;
  const rad = radius > 0 ? radius : 0;
  const dist = Math.min(len, MAX_RAY);
  if (!cast(w, from.x, from.y, from.z, dx / len, dy / len, dz / len, dist, mask, rad, null, null)) return dist / len;
  const t = HIT.t - SWEEP_SKIN;
  return t <= 0 ? 0 : t >= len ? 1 : t / len;
}
