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

const warned = new Set<string>();
/** console.warn once per key (bad input must never throw or spam). */
export function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[physics] ${msg}`);
}

const fin = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The world callbacks a record needs to keep the broadphase / nav dirty tracking in sync. */
export interface RecOwner {
  colliderMoved(c: ColliderRec, oMinX: number, oMinZ: number, oMaxX: number, oMaxZ: number): void;
  colliderToggled(c: ColliderRec): void;
  colliderRemoved(c: ColliderRec): void;
  surfaceToggled(s: SurfaceRec): void;
  surfaceRemoved(s: SurfaceRec): void;
  triggerRemoved(t: TriggerRec): void;
}

/** RAY_* bit mask of what a collider blocks. Read live so `desc.blocks*` may be changed at runtime. */
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
    const shape = desc.shape && desc.shape.kind === 'cyl'
      ? { kind: 'cyl' as const, r: Math.abs(fin(desc.shape.r, 0.5)), hy: Math.abs(fin(desc.shape.hy, 1)) }
      : {
        kind: 'box' as const,
        hx: Math.abs(fin((desc.shape as { hx?: number } | undefined)?.hx, 0.5)),
        hy: Math.abs(fin((desc.shape as { hy?: number } | undefined)?.hy, 1)),
        hz: Math.abs(fin((desc.shape as { hz?: number } | undefined)?.hz, 0.5)),
      };
    if (!desc.shape || (desc.shape.kind !== 'box' && desc.shape.kind !== 'cyl')) {
      warnOnce('collider-shape', 'collider with unknown shape registered as a 1 m box');
    }
    this.desc = { ...desc, shape, x: fin(desc.x, 0), y: fin(desc.y, 0), z: fin(desc.z, 0), yaw: fin(desc.yaw, 0) };
    if (this.desc.x !== desc.x || this.desc.y !== desc.y || this.desc.z !== desc.z) {
      warnOnce('collider-nan', 'collider with a non-finite position was moved to 0');
    }
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
  minX = 0; maxX = 0; minZ = 0; maxZ = 0;
  c0x = 0; c0z = 0; c1x = 0; c1z = 0; stamp = 0; slot = -1;
  private readonly owner: RecOwner;

  constructor(id: number, desc: SurfaceDesc, owner: RecOwner) {
    this.id = id;
    this.owner = owner;
    const x = fin(desc.x, 0), z = fin(desc.z, 0), y = fin(desc.y, 0);
    if (x !== desc.x || z !== desc.z || y !== desc.y) warnOnce('surface-nan', 'surface with a non-finite position was moved to 0');
    const yaw = fin(desc.yaw, 0);
    let shape: SurfaceDesc['shape'];
    if (desc.shape && desc.shape.kind === 'disc') {
      const r = Math.abs(fin(desc.shape.r, 1));
      const inner = Math.min(r, Math.abs(fin(desc.shape.inner, 0)));
      shape = inner > 0 ? { kind: 'disc', r, inner } : { kind: 'disc', r };
      this.isDisc = true;
      this.r = r; this.inner = inner;
    } else {
      const s = desc.shape as { hx?: number; hz?: number } | undefined;
      if (!desc.shape || desc.shape.kind !== 'rect') warnOnce('surface-shape', 'surface with unknown shape registered as a 1 m rect');
      shape = { kind: 'rect', hx: Math.abs(fin(s?.hx, 0.5)), hz: Math.abs(fin(s?.hz, 0.5)) };
      this.hx = shape.hx; this.hz = shape.hz;
    }
    this.desc = { ...desc, shape, x, z, y, yaw };
    const y1 = desc.y1 !== undefined && Number.isFinite(desc.y1) ? desc.y1 : undefined;
    if (y1 === undefined) delete this.desc.y1; else this.desc.y1 = y1;
    this.cx = x; this.cz = z;
    this.yMid = y; this.yLo = y; this.yHi = y;
    if (this.isDisc) {
      this.minX = x - this.r; this.maxX = x + this.r;
      this.minZ = z - this.r; this.maxZ = z + this.r;
      if (y1 !== undefined && y1 !== y) warnOnce('disc-ramp', 'y1 is ignored on disc surfaces (ramps are rect only)');
      return;
    }
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    this.cos = c; this.sin = sn;
    if (y1 !== undefined && y1 !== y && this.hz > 0) {
      this.ramp = true;
      this.k = (y1 - y) / (2 * this.hz);
      this.yMid = (y + y1) * 0.5;
      this.yLo = Math.min(y, y1); this.yHi = Math.max(y, y1);
    }
    const ex = Math.abs(c) * this.hx + Math.abs(sn) * this.hz;
    const ez = Math.abs(sn) * this.hx + Math.abs(c) * this.hz;
    this.minX = x - ex; this.maxX = x + ex;
    this.minZ = z - ez; this.maxZ = z + ez;
  }

  get enabled(): boolean { return this.on; }
  set enabled(v: boolean) {
    const b = !!v;
    if (!this.alive || b === this.on) return;
    this.on = b;
    this.owner.surfaceToggled(this);
  }

  remove(): void {
    if (!this.alive) return;
    this.alive = false;
    this.on = false;
    this.owner.surfaceRemoved(this);
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
