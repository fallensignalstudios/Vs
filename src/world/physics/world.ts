/**
 * PhysicsCore — registries + broadphase + the basic spatial queries (ground, standing, overlap, cover, triggers).
 * Character movement lives in move.ts, ray/sweep casting in ray.ts, navigation in nav.ts; all of them operate
 * on this core. Pure TypeScript math — no three.js.
 */
import type {
  ColliderDesc, ColliderHandle, GroundHit, SurfaceDesc, TriggerShape,
} from '@/core/api/physics';
import { RAY_MOVE } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import { SpatialHash } from './hash';
import {
  ColliderRec, SurfaceRec, TriggerRec, circlePen, footprintDist, maskOf, warnOnce,
} from './shapes';
import type { Contact, RecOwner } from './shapes';

export const DEF_STEP_UP = 0.45;
export const DEF_MAX_DROP = 0.7;
export const DEF_HEIGHT = 1.8;
/** vertical tolerance when testing solid overlap ranges (metres) */
export const Y_EPS = 1e-4;

const TAU = Math.PI * 2;
/** more dirty rects than this between nav builds → the next rebuild is a full one */
const MAX_DIRTY_RECTS = 24;

export class PhysicsCore implements RecOwner {
  readonly colliderHash = new SpatialHash<ColliderRec>(4);
  readonly surfaceHash = new SpatialHash<SurfaceRec>(4);
  /** insertion-ordered registries (debug drawing, nav bounds, deterministic iteration) */
  readonly colliders: ColliderRec[] = [];
  readonly surfaces: SurfaceRec[] = [];
  readonly triggers: TriggerRec[] = [];
  readonly counts = { colliders: 0, surfaces: 0, triggers: 0 };

  /** bumped on every structural change (add / remove / move / enable). Debug + nav staleness key off it. */
  revision = 0;
  /** bumped only when triggers change (debug redraw) */
  triggerRevision = 0;

  /** nav dirty tracking: flat [minX, minZ, maxX, maxZ] rects touched since the last nav build */
  readonly navDirty: number[] = [];
  navDirtyAll = false;
  /** set by the nav grid once built; dirty rects are only recorded while true */
  navTracking = false;
  /** called by clear() so the nav grid can drop its data */
  onClear: (() => void) | null = null;

  /** surface under the last successful groundY() (valid until the next call) */
  lastSurface: SurfaceRec | null = null;

  private nextId = 1;
  private readonly standScratch: ColliderRec[] = [];
  private readonly queryScratch: ColliderRec[] = [];
  private readonly contact: Contact = { nx: 0, nz: 0, depth: 0 };
  private standY = 0;
  private readonly ringOk = new Uint8Array(256);
  private iteratingTriggers = false;
  private triggersNeedCompact = false;

  // -------------------------------------------------------------------------------------------------------
  // registration
  // -------------------------------------------------------------------------------------------------------
  addCollider(desc: ColliderDesc): ColliderRec {
    const c = new ColliderRec(this.nextId++, desc ?? ({} as ColliderDesc), this);
    this.colliders.push(c);
    this.colliderHash.insert(c);
    this.counts.colliders++;
    this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
    return c;
  }

  addSurface(desc: SurfaceDesc): SurfaceRec {
    const s = new SurfaceRec(this.nextId++, desc ?? ({} as SurfaceDesc), this);
    this.surfaces.push(s);
    this.surfaceHash.insert(s);
    this.counts.surfaces++;
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
    if (c.on) {
      this.touch(oMinX, oMinZ, oMaxX, oMaxZ);
      this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
    } else this.revision++;
  }

  colliderToggled(c: ColliderRec): void {
    this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
  }

  colliderRemoved(c: ColliderRec): void {
    this.colliderHash.remove(c);
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
    this.counts.colliders = this.colliders.length;
    this.touch(c.minX, c.minZ, c.maxX, c.maxZ);
  }

  surfaceToggled(s: SurfaceRec): void {
    this.touch(s.minX, s.minZ, s.maxX, s.maxZ);
  }

  surfaceRemoved(s: SurfaceRec): void {
    this.surfaceHash.remove(s);
    const i = this.surfaces.indexOf(s);
    if (i >= 0) this.surfaces.splice(i, 1);
    this.counts.surfaces = this.surfaces.length;
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
    this.triggerRevision++;
    if (this.onClear) this.onClear();
  }

  // -------------------------------------------------------------------------------------------------------
  // ground
  // -------------------------------------------------------------------------------------------------------
  /**
   * Height of the highest enabled surface at (x,z) with height ≤ yRef + stepUp, or NaN. Allocation-free;
   * the surface is left in `lastSurface`.
   */
  groundY(x: number, z: number, yRef: number, stepUp: number): number {
    const limit = yRef + stepUp + 1e-6;
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

  groundAt(x: number, z: number, yRef: number, stepUp: number = DEF_STEP_UP): GroundHit | null {
    if (!(x === x) || !(z === z) || !(yRef === yRef)) return null;
    const y = this.groundY(x, z, yRef, stepUp === stepUp ? stepUp : DEF_STEP_UP);
    const s = this.lastSurface;
    return s ? { y, surface: s } : null;
  }

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
      if (!c.on || c.yMax <= lo || c.yMin >= hi) continue;
      if (c.maxX < x - radius || c.minX > x + radius || c.maxZ < z - radius || c.minZ > z + radius) continue;
      if (!(maskOf(c.desc) & RAY_MOVE)) continue;
      if (circlePen(c, x, z, radius, ct) && ct.depth > 1e-6) return false;
    }
    return true;
  }

  canStand(x: number, y: number, z: number, radius: number, height: number = DEF_HEIGHT): boolean {
    if (!(x === x) || !(y === y) || !(z === z)) return false;
    const gy = this.groundY(x, z, y, DEF_STEP_UP);
    if (gy !== gy || y - gy > DEF_MAX_DROP) return false;
    return this.standClear(x, z, gy, radius > 0 ? radius : 0, DEF_STEP_UP, height > 0 ? height : DEF_HEIGHT);
  }

  /** canStand variant used by the un-stick search; on success the ground height is left in `standY`. */
  private tryStand(x: number, z: number, y: number, radius: number, lenient: boolean): boolean {
    let gy: number;
    if (lenient) {
      gy = this.groundY(x, z, y, 2.0);
      if (gy !== gy) gy = this.groundY(x, z, Infinity, 0);
      if (gy !== gy) return false;
    } else {
      gy = this.groundY(x, z, y, DEF_STEP_UP);
      if (gy !== gy || y - gy > DEF_MAX_DROP) return false;
    }
    if (!this.standClear(x, z, gy, radius, DEF_STEP_UP, DEF_HEIGHT)) return false;
    this.standY = gy;
    return true;
  }

  /**
   * Spiral search for the nearest standable point. Pass 1 only accepts ground at the reference level
   * (within step-up / max-drop); pass 2 accepts any level so badly placed actors still recover.
   */
  nearestStandable(x: number, y: number, z: number, radius: number, maxDist = 4): Vec3Like | null {
    if (!(x === x) || !(y === y) || !(z === z)) return null;
    const r = radius > 0 ? radius : 0.05;
    const limit = maxDist > 0 ? Math.min(maxDist, 64) : 0;
    const step = Math.max(0.2, Math.min(0.5, r * 0.5));
    const ok = this.ringOk;
    for (let pass = 0; pass < 2; pass++) {
      const lenient = pass === 1;
      if (this.tryStand(x, z, y, r, lenient)) return { x, y: this.standY, z };
      for (let d = step; d <= limit + 1e-9; d += step) {
        const n = Math.min(256, Math.max(8, Math.ceil((TAU * d) / step)));
        let any = false;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU;
          ok[k] = this.tryStand(x + Math.cos(a) * d, z + Math.sin(a) * d, y, r, lenient) ? 1 : 0;
          if (ok[k]) any = true;
        }
        if (!any) continue;
        // The first ring that touches standable ground: every sample is equally far, so take the middle of
        // each valid arc (the direction of the closest edge) and pull it back toward the query point.
        let best: Vec3Like | null = null, bestD = Infinity;
        let start = 0;
        while (start < n && ok[start]) start++; // rotate so we begin on an invalid sample (or n if all valid)
        for (let i = 0; i < n; i++) {
          const k0 = (start + i) % n;
          if (!ok[k0] || (i > 0 && ok[(start + i - 1) % n])) continue;
          let run = 1;
          while (run < n && ok[(k0 + run) % n]) run++;
          const a = (((k0 + (run - 1) * 0.5) % n) / n) * TAU;
          const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
          if (!this.tryStand(px, pz, y, r, lenient)) continue;
          let lo = 0, hi = 1;
          let bx = px, bz = pz, by = this.standY;
          for (let it = 0; it < 7; it++) {
            const m = (lo + hi) * 0.5;
            const mx = x + (px - x) * m, mz = z + (pz - z) * m;
            if (this.tryStand(mx, mz, y, r, lenient)) { hi = m; bx = mx; bz = mz; by = this.standY; }
            else lo = m;
          }
          const dd = (bx - x) * (bx - x) + (bz - z) * (bz - z);
          if (dd < bestD) { bestD = dd; best = { x: bx, y: by, z: bz }; }
          if (start === n) break; // whole ring valid: one arc
        }
        if (best) return best;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------------------
  // overlap queries
  // -------------------------------------------------------------------------------------------------------
  queryColliders(x: number, z: number, radius: number, yMin: number, yMax: number): ColliderHandle[] {
    const out: ColliderRec[] = [];
    if (!(x === x) || !(z === z)) return out;
    const r = radius > 0 ? radius : 0;
    const list = this.queryScratch;
    const n = this.colliderHash.query(x - r, z - r, x + r, z + r, list);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.on || c.yMax < yMin || c.yMin > yMax) continue;
      if (footprintDist(c, x, z) <= r) out.push(c);
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  coverNear(x: number, z: number, radius: number): ColliderHandle[] {
    if (!(x === x) || !(z === z)) return [];
    const r = radius > 0 ? radius : 0;
    const list = this.queryScratch;
    const n = this.colliderHash.query(x - r, z - r, x + r, z + r, list);
    const found: Array<{ c: ColliderRec; d: number }> = [];
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.on || (c.desc.cover !== 'low' && c.desc.cover !== 'high')) continue;
      const d = footprintDist(c, x, z);
      if (d <= r) found.push({ c, d });
    }
    found.sort((a, b) => a.d - b.d || a.c.id - b.c.id);
    const out: ColliderHandle[] = new Array(found.length);
    for (let i = 0; i < found.length; i++) out[i] = found[i].c;
    return out;
  }

  // -------------------------------------------------------------------------------------------------------
  // triggers
  // -------------------------------------------------------------------------------------------------------
  /**
   * Edge-evaluate every enabled trigger against the tracked point. A null point (no live player) leaves all
   * states untouched, so dying inside a volume does not fire its exit callback.
   */
  updateTriggers(point: Vec3Like | null): void {
    if (!point || this.iteratingTriggers) return;
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
