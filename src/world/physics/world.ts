/**
 * PhysicsCore — registries + broadphase + the basic spatial queries (ground, standing, overlap, cover, triggers).
 * Character movement lives in move.ts, the un-stick search in stand.ts, ray/sweep casting in ray.ts and
 * navigation in nav.ts; all of them operate on this core. Pure TypeScript math — no three.js.
 *
 * THE GROUND MODEL (shared by movement, canStand, the nav grid and every other query):
 *  - a point is on the ground when a surface contains it, or when it lies in a crack no wider than GAP_TOL
 *    between two surfaces (floor modules laid with a small inset are one continuous floor);
 *  - a character additionally needs headroom under overhanging surfaces and must keep its feet an edge margin
 *    away from any void or drop deeper than max-drop (`place`), so bodies do not hang over unrailed ledges.
 */
import type {
  ColliderDesc, ColliderHandle, GroundHit, SurfaceDesc, TriggerShape,
} from '@/core/api/physics';
import { MOVE_DEFAULTS, RAY_MOVE } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import { SpatialHash } from './hash';
import {
  ColliderRec, GAP_TOL, SURF_OUT, SurfaceRec, TriggerRec, circlePen, colliderProblem, footprintDist,
  segmentHitsFootprint, surfaceProblem, warnOnce, warnSome,
} from './shapes';
import type { Contact, RecOwner } from './shapes';

export const DEF_STEP_UP: number = MOVE_DEFAULTS.stepUp;
export const DEF_MAX_DROP: number = MOVE_DEFAULTS.maxDrop;
export const DEF_HEIGHT: number = MOVE_DEFAULTS.height;
/** vertical tolerance when testing solid overlap ranges (metres) */
export const Y_EPS = 1e-4;

/** candidate directions (radians off "directly behind the cover") tried by coverPoint, best first */
const COVER_FAN = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05];
/** more dirty rects than this between nav builds → the next rebuild is a full one */
const MAX_DIRTY_RECTS = 24;
/** march step when looking for the far side of a crack */
const GAP_STEP = 0.02;
/** samples on the ledge ring (multiple of 4, so the surface axes are always sampled) */
const LEDGE_RING = 16;
const RING_COS: number[] = [];
const RING_SIN: number[] = [];
for (let i = 0; i < LEDGE_RING; i++) {
  RING_COS.push(Math.cos((i / LEDGE_RING) * Math.PI * 2));
  RING_SIN.push(Math.sin((i / LEDGE_RING) * Math.PI * 2));
}

/**
 * Default ledge margin for a body radius: 0.25 m or half the radius, whichever is larger, never more than
 * the radius itself (0.25 m for every human-sized body up to 0.5 m, 0.6 m for the 1.2 m elite).
 */
export function edgeMarginFor(radius: number): number {
  if (!(radius > 0)) return 0;
  const m = Math.max(MOVE_DEFAULTS.edgeMargin, MOVE_DEFAULTS.edgeMarginScale * radius);
  return m < radius ? m : radius;
}

export class PhysicsCore implements RecOwner {
  readonly colliderHash = new SpatialHash<ColliderRec>(4);
  readonly surfaceHash = new SpatialHash<SurfaceRec>(4);
  /** insertion-ordered registries (debug drawing, nav bounds, deterministic iteration) */
  readonly colliders: ColliderRec[] = [];
  readonly surfaces: SurfaceRec[] = [];
  readonly triggers: TriggerRec[] = [];
  readonly counts = { colliders: 0, surfaces: 0, triggers: 0 };

  /** bumped on every structural change (add / remove / move / enable / flag edit). Nav staleness keys off it. */
  revision = 0;
  /** bumped when solids / surfaces / triggers change — the debug view rebuilds only the layer that moved */
  solidRevision = 0;
  surfaceRevision = 0;
  triggerRevision = 0;

  /** nav dirty tracking: flat [minX, minZ, maxX, maxZ] rects touched since the last nav build */
  readonly navDirty: number[] = [];
  navDirtyAll = false;
  /** set by the nav grid once built; dirty rects are only recorded while true */
  navTracking = false;
  /** called by clear() so the nav grid can drop its data */
  onClear: (() => void) | null = null;

  /** surface under the last successful groundY() / place() (valid until the next call) */
  lastSurface: SurfaceRec | null = null;

  private nextId = 1;
  private readonly standScratch: ColliderRec[] = [];
  private readonly queryScratch: ColliderRec[] = [];
  private readonly coverScratch: Array<{ c: ColliderRec; d: number }> = [];
  private readonly contact: Contact = { nx: 0, nz: 0, depth: 0 };
  private iteratingTriggers = false;
  private triggersNeedCompact = false;

  // -------------------------------------------------------------------------------------------------------
  // registration
  // -------------------------------------------------------------------------------------------------------
  addCollider(desc: ColliderDesc): ColliderRec {
    const why = colliderProblem(desc);
    const c = new ColliderRec(this.nextId++, desc ?? ({} as ColliderDesc), this);
    if (why) {
      // never live geometry at a made-up place: the handle is inert, exactly like one that was removed
      const tag = desc && typeof desc.tag === 'string' ? desc.tag : '(untagged)';
      warnSome('collider-invalid', `${tag}:${why}`, `collider "${tag}" ignored: ${why}`);
      c.alive = false; c.on = false;
      return c;
    }
    this.colliders.push(c);
    this.colliderHash.insert(c);
    this.counts.colliders++;
    this.solidRevision++;
    this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
    return c;
  }

  addSurface(desc: SurfaceDesc): SurfaceRec {
    const why = surfaceProblem(desc);
    const s = new SurfaceRec(this.nextId++, desc ?? ({} as SurfaceDesc), this);
    if (why) {
      const tag = desc && typeof desc.tag === 'string' ? desc.tag : '(untagged)';
      warnSome('surface-invalid', `${tag}:${why}`, `surface "${tag}" ignored: ${why}`);
      s.alive = false; s.on = false;
      return s;
    }
    this.surfaces.push(s);
    this.surfaceHash.insert(s);
    this.counts.surfaces++;
    this.surfaceRevision++;
    this.touch(s.minX, s.minZ, s.maxX, s.maxZ);
    return s;
  }

  addTrigger(shape: TriggerShape, onEnter?: () => void, onExit?: () => void): TriggerRec {
    if (!shape || (shape.kind !== 'box' && shape.kind !== 'circle')) {
      warnOnce('trigger-shape', 'trigger with unknown shape will never fire');
    }
    const t = new TriggerRec(shape ?? ({ kind: 'circle', x: 0, z: 0, r: 0 } as TriggerShape), onEnter, onExit, this);
    this.triggers.push(t);
    this.counts.triggers++;
    this.triggerRevision++;
    return t;
  }

  // RecOwner ----------------------------------------------------------------------------------------------
  colliderMoved(c: ColliderRec, oMinX: number, oMinZ: number, oMaxX: number, oMaxZ: number): void {
    this.colliderHash.update(c);
    this.solidRevision++;
    if (c.on) {
      this.touch(oMinX, oMinZ, oMaxX, oMaxZ);
      this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
    } else this.revision++;
  }

  colliderToggled(c: ColliderRec): void {
    this.solidRevision++;
    this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
  }

  colliderFlagged(c: ColliderRec, nav: boolean): void {
    this.solidRevision++;
    if (nav && c.on) this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
    else this.revision++;
  }

  colliderRemoved(c: ColliderRec): void {
    this.colliderHash.remove(c);
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
    this.counts.colliders = this.colliders.length;
    this.solidRevision++;
    this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
  }

  surfaceMoved(s: SurfaceRec, oMinX: number, oMinZ: number, oMaxX: number, oMaxZ: number): void {
    this.surfaceHash.update(s);
    this.surfaceRevision++;
    if (s.on) {
      this.touch(oMinX, oMinZ, oMaxX, oMaxZ);
      this.touch(s.minX, s.minZ, s.maxX, s.maxZ);
    } else this.revision++;
  }

  surfaceToggled(s: SurfaceRec): void {
    this.surfaceRevision++;
    this.touch(s.minX, s.minZ, s.maxX, s.maxZ);
  }

  surfaceRemoved(s: SurfaceRec): void {
    this.surfaceHash.remove(s);
    const i = this.surfaces.indexOf(s);
    if (i >= 0) this.surfaces.splice(i, 1);
    this.counts.surfaces = this.surfaces.length;
    this.surfaceRevision++;
    this.touch(s.minX, s.minZ, s.maxX, s.maxZ);
  }

  triggerRemoved(t: TriggerRec): void {
    this.counts.triggers = Math.max(0, this.counts.triggers - 1);
    this.triggerRevision++;
    if (this.iteratingTriggers) { this.triggersNeedCompact = true; return; }
    const i = this.triggers.indexOf(t);
    if (i >= 0) this.triggers.splice(i, 1);
  }

  /** Record a structural change over an XZ rect. */
  private touch(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.revision++;
    if (!this.navTracking || this.navDirtyAll) return;
    if (this.navDirty.length >= MAX_DIRTY_RECTS * 4) { this.navDirtyAll = true; this.navDirty.length = 0; return; }
    this.navDirty.push(minX, minZ, maxX, maxZ);
  }

  /** Remove everything (zone unload). Outstanding handles become inert. */
  clear(): void {
    for (const c of this.colliders) { c.alive = false; c.on = false; c.slot = -1; }
    for (const s of this.surfaces) { s.alive = false; s.on = false; s.slot = -1; }
    for (const t of this.triggers) { t.alive = false; t.on = false; t.in = false; }
    this.colliders.length = 0;
    this.surfaces.length = 0;
    this.triggers.length = 0;
    this.colliderHash.clear();
    this.surfaceHash.clear();
    this.counts.colliders = 0; this.counts.surfaces = 0; this.counts.triggers = 0;
    this.navDirty.length = 0;
    this.navDirtyAll = false;
    this.navTracking = false;
    this.lastSurface = null;
    this.revision++;
    this.solidRevision++; this.surfaceRevision++; this.triggerRevision++;
    if (this.onClear) this.onClear();
  }

  // -------------------------------------------------------------------------------------------------------
  // ground
  // -------------------------------------------------------------------------------------------------------
  /** Highest enabled surface that contains (x,z) with height ≤ limit, or NaN. Leaves it in `lastSurface`. */
  private exactY(x: number, z: number, limit: number): number {
    let best = NaN;
    let bestS: SurfaceRec | null = null;
    const list = this.surfaceHash.cellAt(x, z);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s.on || s.yLo > limit) continue;
        const h = s.heightAt(x, z);
        if (h !== h || h > limit) continue;
        if (bestS === null || h > best || (h === best && s.id < bestS.id)) { best = h; bestS = s; }
      }
    }
    const big = this.surfaceHash.big;
    for (let i = 0; i < big.length; i++) {
      const s = big[i];
      if (!s.on || s.yLo > limit) continue;
      const h = s.heightAt(x, z);
      if (h !== h || h > limit) continue;
      if (bestS === null || h > best || (h === best && s.id < bestS.id)) { best = h; bestS = s; }
    }
    this.lastSurface = bestS;
    return best;
  }

  /**
   * Ground for a point inside a crack: a surface edge within half the tolerance whose far side — walking
   * straight out across the crack — is floor again within GAP_TOL of that edge. A crack is therefore either
   * closed over its whole width or left alone, never narrowed to a sliver. `below` is the height exactY()
   * just found here (a lower level under the crack, or NaN); only a crack above it is of interest.
   */
  private crackY(x: number, z: number, limit: number, stepUp: number, below: number): number {
    let best = below;
    let bestS = this.lastSurface;
    const list = this.surfaceHash.cellAt(x, z);
    const big = this.surfaceHash.big;
    const n0 = list ? list.length : 0;
    for (let i = 0; i < n0 + big.length; i++) {
      const s = i < n0 ? list![i] : big[i - n0];
      if (!s.on || s.yLo > limit) continue;
      const a = s.outside(x, z);
      if (a <= 0 || a > GAP_TOL * 0.5) continue;
      const h = s.heightNear(x, z);
      if (h > limit || h <= best) continue;
      const nx = SURF_OUT.x, nz = SURF_OUT.z;
      const reach = GAP_TOL - a;
      for (let t = GAP_STEP; ; t += GAP_STEP) {
        const tt = t < reach ? t : reach;
        const far = this.exactY(x + nx * tt, z + nz * tt, h + stepUp + 1e-6);
        if (far === far && h - far <= stepUp + 1e-6) { best = h; bestS = s; break; }
        if (tt >= reach) break;
      }
    }
    this.lastSurface = bestS;
    return best;
  }

  /**
   * Height of the highest enabled surface at (x,z) with height ≤ yRef + stepUp, or NaN. Cracks up to GAP_TOL
   * wide count as floor. Allocation-free; the surface is left in `lastSurface`.
   */
  groundY(x: number, z: number, yRef: number, stepUp: number): number {
    const limit = yRef + stepUp + 1e-6;
    const g = this.exactY(x, z, limit);
    // ground at the reference level is the common case; otherwise (nothing here, or only a level further
    // down) the point may be in a crack of the level it was asked about
    if (g === g && yRef - g <= stepUp + 1e-6) return g;
    return this.crackY(x, z, limit, stepUp, g);
  }

  /**
   * Headroom rule: false when another surface hangs over (x,z) between step height and body height above the
   * ground height g — the body would intersect it (the low end of a ramp, the edge of a raised dais). This is
   * what stops characters walking "under" a surface that has no solid beneath it.
   */
  headroom(x: number, z: number, g: number, stepUp: number, height: number): boolean {
    const lo = g + stepUp + 1e-6, hi = g + height - 1e-6;
    const list = this.surfaceHash.cellAt(x, z);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s.on || s.yHi <= lo || s.yLo >= hi) continue;
        const h = s.heightAt(x, z);
        if (h > lo && h < hi) return false;
      }
    }
    const big = this.surfaceHash.big;
    for (let i = 0; i < big.length; i++) {
      const s = big[i];
      if (!s.on || s.yHi <= lo || s.yLo >= hi) continue;
      const h = s.heightAt(x, z);
      if (h > lo && h < hi) return false;
    }
    return true;
  }

  /**
   * Ledge rule: true when the ground continues (no void, no drop deeper than maxDrop) all the way round a
   * ring of radius `m` about (x,z). `s` is the surface under the point at height g. The ring is aligned with
   * that surface, so a straight or circular edge is held off by exactly `m`; a point well inside its own
   * surface never samples at all.
   */
  ledgeOk(x: number, z: number, g: number, s: SurfaceRec | null, m: number, stepUp: number, maxDrop: number): boolean {
    let ax = 1, az = 0;
    if (s !== null) {
      if (s.inset(x, z) >= m) return true;
      if (s.isDisc) {
        const dx = x - s.cx, dz = z - s.cz;
        const d = Math.hypot(dx, dz);
        if (d > 1e-9) { ax = dx / d; az = dz / d; }
      } else { ax = s.cos; az = -s.sin; }
    }
    for (let k = 0; k < LEDGE_RING; k++) {
      const ux = RING_COS[k] * ax - RING_SIN[k] * az, uz = RING_COS[k] * az + RING_SIN[k] * ax;
      const gy = this.groundY(x + ux * m, z + uz * m, g, stepUp);
      if (gy !== gy || g - gy > maxDrop) return false;
    }
    return true;
  }

  /**
   * Ground height a character at height yRef may move onto at (x,z), or NaN: ground must exist, be no more
   * than maxDrop below, have headroom (when `head` is set) and keep `margin` from any ledge (when > 0).
   * The surface is left in `lastSurface`.
   */
  place(
    x: number, z: number, yRef: number, stepUp: number, maxDrop: number, height: number, head: boolean, margin: number,
  ): number {
    const g = this.groundY(x, z, yRef, stepUp);
    if (g !== g || yRef - g > maxDrop) return NaN;
    const s = this.lastSurface;
    if (head && !this.headroom(x, z, g, stepUp, height)) return NaN;
    if (margin > 0 && !this.ledgeOk(x, z, g, s, margin, stepUp, maxDrop)) return NaN;
    this.lastSurface = s;
    return g;
  }

  groundAt(x: number, z: number, yRef: number, stepUp: number = DEF_STEP_UP, out?: GroundHit): GroundHit | null {
    if (!(x === x) || !(z === z) || !(yRef === yRef)) return null;
    const y = this.groundY(x, z, yRef, stepUp === stepUp ? stepUp : DEF_STEP_UP);
    const s = this.lastSurface;
    if (!s) return null;
    if (out) { out.y = y; out.surface = s; return out; }
    return { y, surface: s };
  }

  // -------------------------------------------------------------------------------------------------------
  // solids
  // -------------------------------------------------------------------------------------------------------
  /**
   * Is a circle at (x,z) standing at height y free of movement-blocking solids overlapping
   * (y + stepUp, y + height)?
   */
  standClear(x: number, z: number, y: number, radius: number, stepUp: number, height: number): boolean {
    const lo = y + stepUp + Y_EPS, hi = y + height - Y_EPS;
    const list = this.standScratch;
    const n = this.colliderHash.query(x - radius, z - radius, x + radius, z + radius, list);
    const ct = this.contact;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.on || c.yMax <= lo || c.yMin >= hi || !(c.mask & RAY_MOVE)) continue;
      if (c.maxX < x - radius || c.minX > x + radius || c.maxZ < z - radius || c.minZ > z + radius) continue;
      if (circlePen(c, x, z, radius, ct) && ct.depth > 1e-6) return false;
    }
    return true;
  }

  /**
   * Distance in XZ from a point standing at height y to the nearest movement-blocking solid overlapping
   * (y + stepUp, y + height), capped at maxR.
   */
  solidDistance(x: number, z: number, y: number, maxR: number, stepUp: number, height: number): number {
    const lo = y + stepUp + Y_EPS, hi = y + height - Y_EPS;
    const list = this.standScratch;
    const n = this.colliderHash.query(x - maxR, z - maxR, x + maxR, z + maxR, list);
    let best = maxR;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.on || c.yMax <= lo || c.yMin >= hi || !(c.mask & RAY_MOVE)) continue;
      if (c.maxX < x - best || c.minX > x + best || c.maxZ < z - best || c.minZ > z + best) continue;
      const d = footprintDist(c, x, z);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Does the straight XZ hop a → b cross a movement-blocking solid (in the band of a body standing at y) that
   * the start is not already inside? Used to keep un-stick teleports on the near side of thin walls.
   */
  hopBlocked(ax: number, az: number, bx: number, bz: number, y: number, stepUp: number, height: number): boolean {
    const lo = y + stepUp + Y_EPS, hi = y + height - Y_EPS;
    const list = this.standScratch;
    const n = this.colliderHash.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), list);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.on || c.yMax <= lo || c.yMin >= hi || !(c.mask & RAY_MOVE)) continue;
      if (footprintDist(c, ax, az) <= 0) continue;
      if (segmentHitsFootprint(c, ax, az, bx, bz)) return true;
    }
    return false;
  }

  canStand(x: number, y: number, z: number, radius: number, height: number = DEF_HEIGHT, edgeMargin?: number): boolean {
    if (!(x === x) || !(y === y) || !(z === z)) return false;
    const h = height > 0 ? height : DEF_HEIGHT;
    const r = radius > 0 ? radius : 0;
    const m = edgeMargin !== undefined && edgeMargin >= 0 ? Math.min(edgeMargin, r) : edgeMarginFor(r);
    const gy = this.place(x, z, y, DEF_STEP_UP, DEF_MAX_DROP, h, true, m);
    if (gy !== gy) return false;
    return this.standClear(x, z, gy, r, DEF_STEP_UP, h);
  }

  // -------------------------------------------------------------------------------------------------------
  // overlap queries
  // -------------------------------------------------------------------------------------------------------
  queryColliders(x: number, z: number, radius: number, yMin: number, yMax: number, out?: ColliderHandle[]): ColliderHandle[] {
    const res = (out ?? []) as ColliderRec[];
    res.length = 0;
    if (!(x === x) || !(z === z)) return res;
    const r = radius > 0 ? radius : 0;
    const list = this.queryScratch;
    const n = this.colliderHash.query(x - r, z - r, x + r, z + r, list);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.on || c.yMax < yMin || c.yMin > yMax) continue;
      if (footprintDist(c, x, z) > r) continue;
      // insertion sort by id: results are few, and this keeps the query allocation-free with `out`
      let j = res.length;
      res.push(c);
      while (j > 0 && res[j - 1].id > c.id) { res[j] = res[j - 1]; j--; }
      res[j] = c;
    }
    return res;
  }

  coverNear(x: number, z: number, radius: number, out?: ColliderHandle[]): ColliderHandle[] {
    const res = out ?? [];
    res.length = 0;
    if (!(x === x) || !(z === z)) return res;
    const r = radius > 0 ? radius : 0;
    const list = this.queryScratch;
    const n = this.colliderHash.query(x - r, z - r, x + r, z + r, list);
    const found = this.coverScratch;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.on || (c.desc.cover !== 'low' && c.desc.cover !== 'high')) continue;
      const d = footprintDist(c, x, z);
      if (d > r) continue;
      if (m === found.length) found.push({ c, d });
      let j = m++;
      while (j > 0 && (found[j - 1].d > d || (found[j - 1].d === d && found[j - 1].c.id > c.id))) {
        found[j].c = found[j - 1].c; found[j].d = found[j - 1].d; j--;
      }
      found[j].c = c; found[j].d = d;
    }
    for (let i = 0; i < m; i++) res.push(found[i].c);
    return res;
  }

  /**
   * Standing point behind a cover collider that hides a character from `threat` (an eye / muzzle position).
   * Tries the spot directly opposite the threat first, then fans out along the far side. `hidden` is supplied
   * by the caller (a line-of-fire test) so this module stays free of the ray code.
   */
  coverPoint(
    cover: ColliderHandle, threat: Vec3Like, radius: number, height: number,
    hidden: (from: Vec3Like, to: Vec3Like) => boolean,
  ): Vec3Like | null {
    if (!(cover instanceof ColliderRec) || !cover.alive || !threat || !Number.isFinite(threat.x + threat.y + threat.z)) return null;
    const r = radius > 0 ? radius : 0.4;
    const h = height > 0 ? height : DEF_HEIGHT;
    const margin = edgeMarginFor(r);
    let dx = cover.cx - threat.x, dz = cover.cz - threat.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) { dx = 1; dz = 0; } else { dx /= len; dz /= len; }
    const base = Math.atan2(dz, dx);
    // low cover only hides a crouched body; high cover hides a standing one
    const hideH = cover.desc.cover === 'low' ? Math.min(0.9, cover.yMax - cover.yMin - 0.2) : 1.5;
    const probe = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < COVER_FAN.length; i++) {
      const a = base + COVER_FAN[i];
      const ex = Math.cos(a), ez = Math.sin(a);
      // support distance of the footprint along this direction
      let ext = cover.r;
      if (cover.isBox) {
        const lx = ex * cover.cos - ez * cover.sin, lz = ex * cover.sin + ez * cover.cos;
        ext = Math.abs(lx) * cover.hx + Math.abs(lz) * cover.hz;
      }
      const d = ext + r + 0.12;
      const px = cover.cx + ex * d, pz = cover.cz + ez * d;
      const gy = this.place(px, pz, cover.yMin, DEF_STEP_UP, DEF_MAX_DROP, h, true, margin);
      if (gy !== gy) continue;
      if (!this.standClear(px, pz, gy, r, DEF_STEP_UP, h)) continue;
      probe.x = px; probe.y = gy + hideH; probe.z = pz;
      if (hidden(threat, probe)) return { x: px, y: gy, z: pz };
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------------------
  // triggers
  // -------------------------------------------------------------------------------------------------------
  /**
   * Edge-evaluate every enabled trigger against the tracked point. A null or non-finite point (no live
   * player, a position that went NaN for a frame) leaves all states untouched, so dying inside a volume does
   * not fire its exit callback.
   */
  updateTriggers(point: Vec3Like | null): void {
    if (!point || this.iteratingTriggers) return;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return;
    const list = this.triggers;
    this.iteratingTriggers = true;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.alive || !t.on) continue;
      const now = t.contains(point);
      if (now === t.in) continue;
      t.in = now;
      const cb = now ? t.onEnter : t.onExit;
      if (!cb) continue;
      try { cb(); } catch (err) { console.error('[physics] trigger callback failed', err); }
    }
    this.iteratingTriggers = false;
    if (this.triggersNeedCompact) {
      this.triggersNeedCompact = false;
      let w = 0;
      for (let i = 0; i < list.length; i++) if (list[i].alive) list[w++] = list[i];
      list.length = w;
    }
  }
}
