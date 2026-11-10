/**
 * Internal records behind the public handles (colliders, surfaces, triggers) plus the exact 2.5D geometry tests
 * they need. Pure TypeScript math — no three.js.
 *
 * Rotation convention (engine-wide): yaw about +Y, local -Z is "forward".
 *   local → world:  wx = cx + lx·cos + lz·sin      wz = cz − lx·sin + lz·cos
 *   world → local:  lx = dx·cos − dz·sin           lz = dx·sin + dz·cos
 */
import { RAY_MOVE, RAY_SHOT, RAY_SIGHT } from '@/core/api/physics';
import type {
  ColliderDesc, ColliderHandle, SurfaceDesc, SurfaceHandle, TriggerHandle, TriggerShape,
} from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import type { HashItem } from './hash';

/** Tolerance on surface edges so adjoining floors never leave a crack (metres). */
export const EDGE_EPS = 1e-6;
/**
 * Widest crack between two walkable surfaces that still counts as continuous floor (metres). Anything wider is
 * a void that fall protection, the nav grid and every other ground query treat as an edge — at any speed.
 */
export const GAP_TOL = 0.12;
/** Surfaces are bucketed with this much padding so a point in a crack still finds both of its neighbours. */
const SURFACE_PAD = GAP_TOL;

const warned = new Set<string>();
const warnCounts = new Map<string, number>();
/** console.warn once per key (bad input must never throw or spam). */
export function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[physics] ${msg}`);
}
/** warnOnce, but at most `max` distinct keys per group — for warnings that carry coordinates. */
export function warnSome(group: string, key: string, msg: string, max = 6): void {
  const n = warnCounts.get(group) ?? 0;
  if (n >= max || warned.has(`${group}:${key}`)) return;
  warnCounts.set(group, n + 1);
  warnOnce(`${group}:${key}`, n + 1 === max ? `${msg} (further "${group}" warnings suppressed)` : msg);
}

const fin = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optNum = (v: unknown): boolean => v === undefined || isNum(v);

/** Why a collider description cannot be registered, or null when it is usable. */
export function colliderProblem(d: ColliderDesc | null | undefined): string | null {
  if (!d || typeof d !== 'object') return 'missing description';
  const s = d.shape as { kind?: string; hx?: unknown; hy?: unknown; hz?: unknown; r?: unknown } | undefined;
  if (!s || (s.kind !== 'box' && s.kind !== 'cyl')) return 'unknown shape';
  if (s.kind === 'box' ? !(isNum(s.hx) && isNum(s.hy) && isNum(s.hz)) : !(isNum(s.r) && isNum(s.hy))) return 'non-finite size';
  if (!(isNum(d.x) && isNum(d.y) && isNum(d.z)) || !optNum(d.yaw)) return 'non-finite position';
  return null;
}

/** Why a surface description cannot be registered, or null when it is usable. */
export function surfaceProblem(d: SurfaceDesc | null | undefined): string | null {
  if (!d || typeof d !== 'object') return 'missing description';
  const s = d.shape as { kind?: string; hx?: unknown; hz?: unknown; r?: unknown; inner?: unknown } | undefined;
  if (!s || (s.kind !== 'rect' && s.kind !== 'disc')) return 'unknown shape';
  if (s.kind === 'rect' ? !(isNum(s.hx) && isNum(s.hz)) : !(isNum(s.r) && optNum(s.inner))) return 'non-finite size';
  if (!(isNum(d.x) && isNum(d.y) && isNum(d.z)) || !optNum(d.yaw) || !optNum(d.y1)) return 'non-finite position';
  return null;
}

/** The world callbacks a record needs to keep the broadphase / nav dirty tracking in sync. */
export interface RecOwner {
  colliderMoved(c: ColliderRec, oMinX: number, oMinZ: number, oMaxX: number, oMaxZ: number): void;
  colliderToggled(c: ColliderRec): void;
  /** a live `desc.blocks*` / `desc.cover` edit; `nav` is true when what blocks movement changed */
  colliderFlagged(c: ColliderRec, nav: boolean): void;
  colliderRemoved(c: ColliderRec): void;
  surfaceMoved(s: SurfaceRec, oMinX: number, oMinZ: number, oMaxX: number, oMaxZ: number): void;
  surfaceToggled(s: SurfaceRec): void;
  surfaceRemoved(s: SurfaceRec): void;
  triggerRemoved(t: TriggerRec): void;
}

/** RAY_* bit mask of what a collider description blocks. */
export function maskOf(d: ColliderDesc): number {
  return (d.blocksMove !== false ? RAY_MOVE : 0)
    | (d.blocksSight !== false ? RAY_SIGHT : 0)
    | (d.blocksShots !== false ? RAY_SHOT : 0);
}

/** Result slot for circle-vs-solid penetration tests (reused, never allocated per test). */
export interface Contact { nx: number; nz: number; depth: number }

// ---------------------------------------------------------------------------------------------------------
// Collider
// ---------------------------------------------------------------------------------------------------------
export class ColliderRec implements ColliderHandle, HashItem {
  readonly id: number;
  readonly desc: ColliderDesc;
  /** live enabled flag (false once removed) */
  on = true;
  alive = true;
  isBox = true;
  /** RAY_* bits this collider blocks — kept in sync with `desc.blocks*` by the live flag setters */
  mask = RAY_MOVE | RAY_SIGHT | RAY_SHOT;
  cx = 0; cz = 0; cos = 1; sin = 0;
  /** box half extents; for cylinders hx = hz = r */
  hx = 0; hz = 0; r = 0;
  yMin = 0; yMax = 0;
  minX = 0; maxX = 0; minZ = 0; maxZ = 0;
  c0x = 0; c0z = 0; c1x = 0; c1z = 0; stamp = 0; slot = -1;
  private readonly owner: RecOwner;

  constructor(id: number, desc: ColliderDesc, owner: RecOwner) {
    this.id = id;
    this.owner = owner;
    const src = desc.shape as { kind?: string; hx?: number; hy?: number; hz?: number; r?: number } | undefined;
    const shape = src && src.kind === 'cyl'
      ? { kind: 'cyl' as const, r: Math.abs(fin(src.r, 0.5)), hy: Math.abs(fin(src.hy, 1)) }
      : { kind: 'box' as const, hx: Math.abs(fin(src?.hx, 0.5)), hy: Math.abs(fin(src?.hy, 1)), hz: Math.abs(fin(src?.hz, 0.5)) };
    const d: ColliderDesc = { ...desc, shape, x: fin(desc.x, 0), y: fin(desc.y, 0), z: fin(desc.z, 0), yaw: fin(desc.yaw, 0) };
    this.mask = maskOf(d);
    // `desc.blocks*` / `desc.cover` may be edited live: route the edits through setters so the cached mask,
    // the nav grid and the debug view all notice.
    const flag = (key: 'blocksMove' | 'blocksSight' | 'blocksShots', bit: number): void => {
      let raw = d[key];
      Object.defineProperty(d, key, {
        enumerable: true, configurable: true,
        get: () => raw,
        set: (v: boolean | undefined) => {
          raw = v;
          const m = v !== false ? this.mask | bit : this.mask & ~bit;
          if (m === this.mask) return;
          this.mask = m;
          if (this.alive) this.owner.colliderFlagged(this, bit === RAY_MOVE);
        },
      });
    };
    flag('blocksMove', RAY_MOVE); flag('blocksSight', RAY_SIGHT); flag('blocksShots', RAY_SHOT);
    let cover = d.cover;
    Object.defineProperty(d, 'cover', {
      enumerable: true, configurable: true,
      get: () => cover,
      set: (v: ColliderDesc['cover']) => {
        if (v === cover) return;
        cover = v;
        if (this.alive) this.owner.colliderFlagged(this, false);
      },
    });
    this.desc = d;
    this.derive();
  }

  get enabled(): boolean { return this.on; }
  set enabled(v: boolean) {
    const b = !!v;
    if (!this.alive || b === this.on) return;
    this.on = b;
    this.owner.colliderToggled(this);
  }

  setPose(x: number, y: number, z: number, yaw?: number): void {
    if (!this.alive) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      warnOnce('collider-pose-nan', 'setPose ignored: non-finite position');
      return;
    }
    const d = this.desc;
    const nyaw = yaw !== undefined && Number.isFinite(yaw) ? yaw : (d.yaw ?? 0);
    if (d.x === x && d.y === y && d.z === z && (d.yaw ?? 0) === nyaw) return;
    const oMinX = this.minX, oMinZ = this.minZ, oMaxX = this.maxX, oMaxZ = this.maxZ;
    d.x = x; d.y = y; d.z = z; d.yaw = nyaw;
    this.derive();
    this.owner.colliderMoved(this, oMinX, oMinZ, oMaxX, oMaxZ);
  }

  remove(): void {
    if (!this.alive) return;
    this.alive = false;
    this.on = false;
    this.owner.colliderRemoved(this);
  }

  /** Recompute the cached frame + AABB from `desc`. */
  derive(): void {
    const d = this.desc;
    const s = d.shape;
    this.cx = d.x; this.cz = d.z;
    this.yMin = d.y - s.hy; this.yMax = d.y + s.hy;
    if (s.kind === 'cyl') {
      this.isBox = false;
      this.r = s.r; this.hx = s.r; this.hz = s.r;
      this.cos = 1; this.sin = 0;
      this.minX = d.x - s.r; this.maxX = d.x + s.r;
      this.minZ = d.z - s.r; this.maxZ = d.z + s.r;
      return;
    }
    this.isBox = true;
    const yaw = d.yaw ?? 0;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    this.cos = c; this.sin = sn;
    this.hx = s.hx; this.hz = s.hz; this.r = Math.hypot(s.hx, s.hz);
    const ex = Math.abs(c) * s.hx + Math.abs(sn) * s.hz;
    const ez = Math.abs(sn) * s.hx + Math.abs(c) * s.hz;
    this.minX = d.x - ex; this.maxX = d.x + ex;
    this.minZ = d.z - ez; this.maxZ = d.z + ez;
  }
}

/**
 * Penetration of a circle (centre px,pz radius r) into a collider footprint. Returns false when clear.
 * On overlap fills `out` with the push-out normal (unit, world xz) and depth. A centre inside a box is pushed
 * out through the nearest face.
 */
export function circlePen(c: ColliderRec, px: number, pz: number, r: number, out: Contact): boolean {
  const dx = px - c.cx, dz = pz - c.cz;
  if (!c.isBox) {
    const rr = r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return false;
    if (d2 > 1e-18) {
      const d = Math.sqrt(d2);
      out.nx = dx / d; out.nz = dz / d; out.depth = rr - d;
    } else {
      out.nx = 1; out.nz = 0; out.depth = rr;
    }
    return true;
  }
  const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
  const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
  const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
  const ex = lx - qx, ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  if (d2 >= r * r) return false;
  let nlx: number, nlz: number;
  if (d2 > 1e-18) {
    const d = Math.sqrt(d2);
    nlx = ex / d; nlz = ez / d; out.depth = r - d;
  } else {
    // centre inside the box: leave through the nearest face
    const fx = c.hx - Math.abs(lx), fz = c.hz - Math.abs(lz);
    if (fx < fz) { nlx = lx < 0 ? -1 : 1; nlz = 0; out.depth = r + fx; }
    else { nlx = 0; nlz = lz < 0 ? -1 : 1; out.depth = r + fz; }
  }
  out.nx = nlx * c.cos + nlz * c.sin;
  out.nz = -nlx * c.sin + nlz * c.cos;
  return true;
}

/** Distance from a point to a collider footprint in XZ (0 when inside). */
export function footprintDist(c: ColliderRec, px: number, pz: number): number {
  const dx = px - c.cx, dz = pz - c.cz;
  if (!c.isBox) {
    const d = Math.hypot(dx, dz) - c.r;
    return d > 0 ? d : 0;
  }
  const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
  const ex = Math.abs(lx) - c.hx, ez = Math.abs(lz) - c.hz;
  const ox = ex > 0 ? ex : 0, oz = ez > 0 ? ez : 0;
  return Math.hypot(ox, oz);
}

/** Does the XZ segment a → b touch the collider footprint? */
export function segmentHitsFootprint(c: ColliderRec, ax: number, az: number, bx: number, bz: number): boolean {
  const pax = ax - c.cx, paz = az - c.cz, dx = bx - ax, dz = bz - az;
  if (!c.isBox) {
    const len2 = dx * dx + dz * dz;
    let t = len2 > 1e-18 ? -(pax * dx + paz * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = pax + dx * t, qz = paz + dz * t;
    return qx * qx + qz * qz <= c.r * c.r;
  }
  const lx = pax * c.cos - paz * c.sin, lz = pax * c.sin + paz * c.cos;
  const ldx = dx * c.cos - dz * c.sin, ldz = dx * c.sin + dz * c.cos;
  let t0 = 0, t1 = 1;
  if (Math.abs(ldx) > 1e-12) {
    let a = (-c.hx - lx) / ldx, b = (c.hx - lx) / ldx;
    if (a > b) { const k = a; a = b; b = k; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
  } else if (Math.abs(lx) > c.hx) return false;
  if (Math.abs(ldz) > 1e-12) {
    let a = (-c.hz - lz) / ldz, b = (c.hz - lz) / ldz;
    if (a > b) { const k = a; a = b; b = k; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
  } else if (Math.abs(lz) > c.hz) return false;
  return t0 <= t1;
}

/** Is a 3D point inside the collider volume (inclusive)? */
export function colliderContains(c: ColliderRec, x: number, y: number, z: number): boolean {
  if (y < c.yMin || y > c.yMax) return false;
  const dx = x - c.cx, dz = z - c.cz;
  if (!c.isBox) return dx * dx + dz * dz <= c.r * c.r;
  const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
  return Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz;
}

// ---------------------------------------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------------------------------------
/** Outward direction (unit, world xz) left by the last SurfaceRec.outside() call. */
export const SURF_OUT = { x: 0, z: 0 };

export class SurfaceRec implements SurfaceHandle, HashItem {
  readonly id: number;
  readonly desc: SurfaceDesc;
  on = true;
  alive = true;
  isDisc = false;
  cx = 0; cz = 0; cos = 1; sin = 0;
  hx = 0; hz = 0;
  /** disc outer / inner radius */
  r = 0; inner = 0;
  /** ramp: height = yMid + k·lz (k = 0 for flats) */
  ramp = false; k = 0; yMid = 0;
  /** lowest / highest point of the surface */
  yLo = 0; yHi = 0;
  /** broadphase AABB: the footprint padded by the crack tolerance */
  minX = 0; maxX = 0; minZ = 0; maxZ = 0;
  c0x = 0; c0z = 0; c1x = 0; c1z = 0; stamp = 0; slot = -1;
  private readonly owner: RecOwner;

  constructor(id: number, desc: SurfaceDesc, owner: RecOwner) {
    this.id = id;
    this.owner = owner;
    const src = desc.shape as { kind?: string; hx?: number; hz?: number; r?: number; inner?: number } | undefined;
    let shape: SurfaceDesc['shape'];
    if (src && src.kind === 'disc') {
      const r = Math.abs(fin(src.r, 1));
      const inner = Math.min(r, Math.abs(fin(src.inner, 0)));
      shape = inner > 0 ? { kind: 'disc', r, inner } : { kind: 'disc', r };
    } else shape = { kind: 'rect', hx: Math.abs(fin(src?.hx, 0.5)), hz: Math.abs(fin(src?.hz, 0.5)) };
    this.desc = { ...desc, shape, x: fin(desc.x, 0), z: fin(desc.z, 0), y: fin(desc.y, 0), yaw: fin(desc.yaw, 0) };
    if (desc.y1 !== undefined && Number.isFinite(desc.y1)) this.desc.y1 = desc.y1; else delete this.desc.y1;
    if (shape.kind === 'disc' && this.desc.y1 !== undefined && this.desc.y1 !== this.desc.y) {
      warnOnce('disc-ramp', 'y1 is ignored on disc surfaces (ramps are rect only)');
    }
    this.derive();
  }

  get enabled(): boolean { return this.on; }
  set enabled(v: boolean) {
    const b = !!v;
    if (!this.alive || b === this.on) return;
    this.on = b;
    this.owner.surfaceToggled(this);
  }

  /** Move the surface (lift plate, sliding bridge). `y` is the new `desc.y`; a ramp keeps its rise. */
  setPose(x: number, y: number, z: number, yaw?: number): void {
    if (!this.alive) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      warnOnce('surface-pose-nan', 'surface setPose ignored: non-finite position');
      return;
    }
    const d = this.desc;
    const nyaw = yaw !== undefined && Number.isFinite(yaw) ? yaw : (d.yaw ?? 0);
    if (d.x === x && d.y === y && d.z === z && (d.yaw ?? 0) === nyaw) return;
    const oMinX = this.minX, oMinZ = this.minZ, oMaxX = this.maxX, oMaxZ = this.maxZ;
    if (d.y1 !== undefined) d.y1 += y - d.y;
    d.x = x; d.y = y; d.z = z; d.yaw = nyaw;
    this.derive();
    this.owner.surfaceMoved(this, oMinX, oMinZ, oMaxX, oMaxZ);
  }

  remove(): void {
    if (!this.alive) return;
    this.alive = false;
    this.on = false;
    this.owner.surfaceRemoved(this);
  }

  /** Recompute the cached frame + AABB from `desc`. */
  derive(): void {
    const d = this.desc;
    const s = d.shape;
    this.cx = d.x; this.cz = d.z;
    this.yMid = d.y; this.yLo = d.y; this.yHi = d.y;
    this.ramp = false; this.k = 0;
    if (s.kind === 'disc') {
      this.isDisc = true;
      this.r = s.r; this.inner = s.inner ?? 0;
      this.hx = s.r; this.hz = s.r;
      this.cos = 1; this.sin = 0;
      this.minX = d.x - s.r - SURFACE_PAD; this.maxX = d.x + s.r + SURFACE_PAD;
      this.minZ = d.z - s.r - SURFACE_PAD; this.maxZ = d.z + s.r + SURFACE_PAD;
      return;
    }
    this.isDisc = false;
    this.hx = s.hx; this.hz = s.hz;
    const yaw = d.yaw ?? 0;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    this.cos = c; this.sin = sn;
    if (d.y1 !== undefined && d.y1 !== d.y && s.hz > 0) {
      this.ramp = true;
      this.k = (d.y1 - d.y) / (2 * s.hz);
      this.yMid = (d.y + d.y1) * 0.5;
      this.yLo = Math.min(d.y, d.y1); this.yHi = Math.max(d.y, d.y1);
    }
    const ex = Math.abs(c) * s.hx + Math.abs(sn) * s.hz + SURFACE_PAD;
    const ez = Math.abs(sn) * s.hx + Math.abs(c) * s.hz + SURFACE_PAD;
    this.minX = d.x - ex; this.maxX = d.x + ex;
    this.minZ = d.z - ez; this.maxZ = d.z + ez;
  }

  /** Surface height at (x,z), or NaN when the point is outside the surface. */
  heightAt(x: number, z: number): number {
    const dx = x - this.cx, dz = z - this.cz;
    if (this.isDisc) {
      const d2 = dx * dx + dz * dz;
      const ro = this.r + EDGE_EPS;
      if (d2 > ro * ro) return NaN;
      if (this.inner > 0) {
        const ri = this.inner - EDGE_EPS;
        if (d2 < ri * ri) return NaN;
      }
      return this.yMid;
    }
    const lx = dx * this.cos - dz * this.sin;
    if (lx < -this.hx - EDGE_EPS || lx > this.hx + EDGE_EPS) return NaN;
    const lz = dx * this.sin + dz * this.cos;
    if (lz < -this.hz - EDGE_EPS || lz > this.hz + EDGE_EPS) return NaN;
    return this.ramp ? this.yMid + this.k * lz : this.yMid;
  }

  /**
   * How far (x,z) lies outside the footprint (0 when on it). The outward direction — from the nearest point
   * of the footprint to (x,z) — is left in SURF_OUT.
   */
  outside(x: number, z: number): number {
    const dx = x - this.cx, dz = z - this.cz;
    if (this.isDisc) {
      const d = Math.hypot(dx, dz);
      if (d > this.r) { SURF_OUT.x = dx / d; SURF_OUT.z = dz / d; return d - this.r; }
      if (d < this.inner) {
        if (d > 1e-9) { SURF_OUT.x = -dx / d; SURF_OUT.z = -dz / d; } else { SURF_OUT.x = 1; SURF_OUT.z = 0; }
        return this.inner - d;
      }
      return 0;
    }
    const lx = dx * this.cos - dz * this.sin, lz = dx * this.sin + dz * this.cos;
    const ex = Math.abs(lx) - this.hx, ez = Math.abs(lz) - this.hz;
    if (ex <= 0 && ez <= 0) return 0;
    let nlx = ex > 0 ? (lx < 0 ? -ex : ex) : 0, nlz = ez > 0 ? (lz < 0 ? -ez : ez) : 0;
    const d = Math.hypot(nlx, nlz);
    nlx /= d; nlz /= d;
    SURF_OUT.x = nlx * this.cos + nlz * this.sin;
    SURF_OUT.z = -nlx * this.sin + nlz * this.cos;
    return d;
  }

  /** Height at the footprint point nearest to (x,z) — the surface height for a point in a crack beside it. */
  heightNear(x: number, z: number): number {
    if (!this.ramp) return this.yMid;
    const lz = (x - this.cx) * this.sin + (z - this.cz) * this.cos;
    return this.yMid + this.k * (lz < -this.hz ? -this.hz : lz > this.hz ? this.hz : lz);
  }

  /** Distance from (x,z) to the footprint boundary, measured inwards (negative when the point is outside). */
  inset(x: number, z: number): number {
    const dx = x - this.cx, dz = z - this.cz;
    if (this.isDisc) {
      const d = Math.hypot(dx, dz);
      const o = this.r - d;
      return this.inner > 0 && d - this.inner < o ? d - this.inner : o;
    }
    const ix = this.hx - Math.abs(dx * this.cos - dz * this.sin), iz = this.hz - Math.abs(dx * this.sin + dz * this.cos);
    return ix < iz ? ix : iz;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------------------
export class TriggerRec implements TriggerHandle {
  readonly shape: TriggerShape;
  on = true;
  alive = true;
  /** current edge state */
  in = false;
  readonly onEnter: (() => void) | undefined;
  readonly onExit: (() => void) | undefined;
  private readonly owner: RecOwner;

  constructor(shape: TriggerShape, onEnter: (() => void) | undefined, onExit: (() => void) | undefined, owner: RecOwner) {
    this.shape = { ...shape };
    this.onEnter = typeof onEnter === 'function' ? onEnter : undefined;
    this.onExit = typeof onExit === 'function' ? onExit : undefined;
    this.owner = owner;
  }

  get enabled(): boolean { return this.on; }
  set enabled(v: boolean) {
    const b = !!v;
    if (!this.alive) return;
    this.on = b;
    if (!b) this.in = false;
  }

  get inside(): boolean { return this.in; }

  contains(p: Vec3Like): boolean {
    const s = this.shape;
    if (!p || !(p.x === p.x) || !(p.z === p.z)) return false;
    if (s.yMin !== undefined && p.y < s.yMin) return false;
    if (s.yMax !== undefined && p.y > s.yMax) return false;
    const dx = p.x - s.x, dz = p.z - s.z;
    if (s.kind === 'circle') return dx * dx + dz * dz <= s.r * s.r;
    if (s.kind !== 'box') return false;
    const yaw = s.yaw ?? 0;
    if (yaw === 0) return Math.abs(dx) <= s.hx && Math.abs(dz) <= s.hz;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return Math.abs(dx * c - dz * sn) <= s.hx && Math.abs(dx * sn + dz * c) <= s.hz;
  }

  remove(): void {
    if (!this.alive) return;
    this.alive = false;
    this.on = false;
    this.in = false;
    this.owner.triggerRemoved(this);
  }
}
