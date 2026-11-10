/**
 * Un-stick search: the nearest point where a body of a given radius and height can stand (valid ground with
 * headroom and ledge margin, clear of solids). Backs `PhysicsWorld.nearestStandable` and the recovery paths of
 * moveCharacter (an actor that starts inside a solid, off every surface, or at the wrong height).
 */
import type { Vec3Like } from '@/core/api/common';
import { DEF_MAX_DROP, DEF_STEP_UP } from './world';
import type { PhysicsCore } from './world';

const TAU = Math.PI * 2;
const ringOk = new Uint8Array(256);

/** One search (module-level: the search is not re-entrant). */
const Q = {
  x: 0, y: 0, z: 0, r: 0, h: 0, margin: 0,
  /** reject spots whose straight hop from the query point crosses a solid the query point is not inside */
  guard: false,
  /** ground height of the last accepted candidate */
  gy: 0,
};

function tryStand(w: PhysicsCore, x: number, z: number, lenient: boolean): boolean {
  let gy: number;
  if (lenient) {
    // any level: the closest one above within 2 m, else whatever is highest here
    gy = w.groundY(x, z, Q.y, 2.0);
    if (gy !== gy) gy = w.groundY(x, z, Infinity, 0);
    if (gy !== gy) return false;
    const s = w.lastSurface;
    if (!w.headroom(x, z, gy, DEF_STEP_UP, Q.h)) return false;
    if (Q.margin > 0 && !w.ledgeOk(x, z, gy, s, Q.margin, DEF_STEP_UP, DEF_MAX_DROP)) return false;
  } else {
    gy = w.place(x, z, Q.y, DEF_STEP_UP, DEF_MAX_DROP, Q.h, true, Q.margin);
    if (gy !== gy) return false;
  }
  if (!w.standClear(x, z, gy, Q.r, DEF_STEP_UP, Q.h)) return false;
  if (Q.guard && w.hopBlocked(Q.x, Q.z, x, z, Q.y, DEF_STEP_UP, Q.h)) return false;
  Q.gy = gy;
  return true;
}

/**
 * One spiral pass around the query point: the nearest spot that passes tryStand within `limit`, or null.
 * The query point itself is not tested here.
 */
function spiral(w: PhysicsCore, lenient: boolean, limit: number): Vec3Like | null {
  const x = Q.x, z = Q.z;
  const step = Math.max(0.2, Math.min(0.5, Q.r * 0.5));
  const ok = ringOk;
  for (let d = step; d <= limit + 1e-9; d += step) {
    const n = Math.min(256, Math.max(8, Math.ceil((TAU * d) / step)));
    let any = false;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      ok[k] = tryStand(w, x + Math.cos(a) * d, z + Math.sin(a) * d, lenient) ? 1 : 0;
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
      if (!tryStand(w, px, pz, lenient)) continue;
      let lo = 0, hi = 1;
      let bx = px, bz = pz, by = Q.gy;
      for (let it = 0; it < 7; it++) {
        const m = (lo + hi) * 0.5;
        const mx = x + (px - x) * m, mz = z + (pz - z) * m;
        if (tryStand(w, mx, mz, lenient)) { hi = m; bx = mx; bz = mz; by = Q.gy; }
        else lo = m;
      }
      const dd = (bx - x) * (bx - x) + (bz - z) * (bz - z);
      if (dd < bestD) { bestD = dd; best = { x: bx, y: by, z: bz }; }
      if (start === n) break; // whole ring valid: one arc
    }
    if (best) return best;
  }
  return null;
}

function begin(
  x: number, y: number, z: number, radius: number, height: number, margin: number, guard: boolean,
): void {
  Q.x = x; Q.y = y; Q.z = z; Q.r = radius > 0 ? radius : 0.05; Q.h = height; Q.margin = margin; Q.guard = guard;
}

/**
 * Nearest standable point within `maxDist` of (x,z). Pass 1 only accepts ground at the reference level
 * (within step-up / max-drop of y); pass 2 accepts any level so badly placed actors still recover. With
 * `guard`, spots on the far side of a wall are skipped (exits for a body trapped in a solid).
 */
export function findStand(
  w: PhysicsCore, x: number, y: number, z: number, radius: number, maxDist: number, height: number, margin: number,
  guard: boolean,
): Vec3Like | null {
  if (!(x === x) || !(y === y) || !(z === z)) return null;
  begin(x, y, z, radius, height, margin, guard);
  const limit = maxDist > 0 ? Math.min(maxDist, 64) : 0;
  for (let pass = 0; pass < 2; pass++) {
    const lenient = pass === 1;
    if (tryStand(w, x, z, lenient)) return { x, y: Q.gy, z };
    const p = spiral(w, lenient, limit);
    if (p) return p;
  }
  return null;
}

/**
 * Where to put an actor that is not standing on anything (wrong height, outside the level, floor removed):
 * the closer of "straight up / down onto the level at this XZ" and "sideways onto ground at the height it
 * thinks it has"; failing both, the nearest standable point on any level within `maxDist`.
 */
export function recoverStand(
  w: PhysicsCore, x: number, y: number, z: number, radius: number, maxDist: number, height: number, margin: number,
): Vec3Like | null {
  begin(x, y, z, radius, height, margin, false);
  if (tryStand(w, x, z, false)) return { x, y: Q.gy, z };
  if (!tryStand(w, x, z, true)) return findStand(w, x, y, z, radius, maxDist, height, margin, false);
  const vy = Q.gy;
  return spiral(w, false, Math.min(maxDist, Math.abs(vy - y))) ?? { x, y: vy, z };
}
