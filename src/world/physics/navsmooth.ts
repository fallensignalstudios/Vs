/**
 * Path post-processing for the nav grid: string-pulling a node chain down to its corner waypoints and turning
 * the result into a NavPath. Pure functions over parallel coordinate arrays.
 */
import type { NavPath } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';

/**
 * String-pull in place. `visible(i, j)` says whether waypoint j can be walked to directly from waypoint i
 * (indices into the ORIGINAL arrays). For each anchor the furthest visible waypoint is found by galloping then
 * bisecting; a final pass prunes any waypoint whose neighbours see each other.
 */
export function stringPull(px: number[], py: number[], pz: number[], visible: (i: number, j: number) => boolean): void {
  const n = px.length;
  if (n <= 2) return;
  const keep: number[] = [0];
  let i = 0;
  while (i < n - 1) {
    let good = i + 1, step = 1, bad = -1;
    while (bad < 0) {
      const probe = Math.min(n - 1, good + step);
      if (probe === good) break;
      if (visible(i, probe)) { good = probe; step *= 2; } else bad = probe;
    }
    while (bad - good > 1) {
      const mid = (good + bad) >> 1;
      if (visible(i, mid)) good = mid; else bad = mid;
    }
    keep.push(good);
    i = good;
  }
  for (let pass = 0; pass < 3 && keep.length > 2; pass++) {
    let removed = false;
    for (let k = 1; k < keep.length - 1; k++) {
      if (visible(keep[k - 1], keep[k + 1])) { keep.splice(k, 1); removed = true; k--; }
    }
    if (!removed) break;
  }
  for (let k = 0; k < keep.length; k++) { px[k] = px[keep[k]]; py[k] = py[keep[k]]; pz[k] = pz[keep[k]]; }
  px.length = keep.length; py.length = keep.length; pz.length = keep.length;
}

/** Build the public path: drops zero-length hops (always keeping a distinct start and goal entry). */
export function toNavPath(px: number[], py: number[], pz: number[]): NavPath {
  const points: Vec3Like[] = [];
  let length = 0;
  const last = px.length - 1;
  for (let i = 0; i <= last; i++) {
    const prev = points.length > 0 ? points[points.length - 1] : null;
    if (prev) {
      const d = Math.hypot(px[i] - prev.x, py[i] - prev.y, pz[i] - prev.z);
      if (d < 1e-6 && (i < last || points.length > 1)) {
        if (i === last) { prev.x = px[i]; prev.y = py[i]; prev.z = pz[i]; }
        continue;
      }
      length += d;
    }
    points.push({ x: px[i], y: py[i], z: pz[i] });
  }
  return { points, length };
}
