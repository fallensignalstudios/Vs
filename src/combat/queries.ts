/** Geometry tests and scratch buffers behind the ActorManager queries. Pure functions, no allocations. */
import * as THREE from 'three';
import type { Actor, ActorRayHit } from '@/core/api';

/** Ray (unit direction) vs sphere. Returns the entry distance (0 when the origin is inside) or -1. */
export function rayVsSphere(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  const h = b * b - c;
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}

/**
 * Ray (unit direction) vs a vertical capsule of radius `r` whose body spans y0..y1 around the axis (cx, cz).
 * Returns the entry distance (0 when the origin is inside) or -1.
 */
export function rayVsCapsule(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, y0: number, y1: number, cz: number, r: number,
): number {
  const len = y1 - y0 - 2 * r;
  if (len <= 1e-4) return rayVsSphere(ox, oy, oz, dx, dy, dz, cx, (y0 + y1) * 0.5, cz, Math.max(r, (y1 - y0) * 0.5));
  const ax = ox - cx;
  const ay = oy - (y0 + r);
  const az = oz - cz;
  const a = 1 - dy * dy;
  const c = ax * ax + az * az - r * r;
  if (a > 1e-9) {
    const b = ax * dx + az * dz;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const s = Math.sqrt(h);
    const t = (-b - s) / a;
    const y = ay + t * dy;
    if (y > 0 && y < len) {
      if (t >= 0) return t;
      return (-b + s) / a >= 0 ? 0 : -1;
    }
    // past the end of the cylinder: test the cap on that side
    return rayVsSphere(ox, oy, oz, dx, dy, dz, cx, y <= 0 ? y0 + r : y1 - r, cz, r);
  }
  // ray parallel to the axis
  if (c > 0) return -1;
  const lo = rayVsSphere(ox, oy, oz, dx, dy, dz, cx, y0 + r, cz, r);
  const hi = rayVsSphere(ox, oy, oz, dx, dy, dz, cx, y1 - r, cz, r);
  if (lo < 0) return hi >= 0 ? hi : ay > 0 && ay < len ? 0 : -1;
  if (hi < 0) return lo;
  return Math.min(lo, hi);
}

/** Squared distance from point p to segment a→b. */
export function distSqPointSegment(
  px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const ez = bz - az;
  const l2 = ex * ex + ey * ey + ez * ez;
  let t = l2 > 1e-12 ? ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + ex * t - px;
  const qy = ay + ey * t - py;
  const qz = az + ez * t - pz;
  return qx * qx + qy * qy + qz * qz;
}

/**
 * Ring of result arrays so queries allocate nothing: each call takes the next buffer. A result stays intact
 * through 15 further queries, which makes nested queries inside a loop over a result safe.
 */
export class ScratchLists {
  private readonly lists: Actor[][] = [];
  private readonly keys: Float64Array[] = [];
  private next = 0;

  constructor(private readonly size = 16) {
    for (let i = 0; i < size; i++) {
      this.lists.push([]);
      this.keys.push(new Float64Array(64));
    }
  }

  take(): Actor[] {
    const l = this.lists[this.next] as Actor[];
    this.next = (this.next + 1) % this.size;
    l.length = 0;
    return l;
  }

  /** insertion sort `list` by the parallel `key` values (ascending); lists are short */
  static sortByKey(list: Actor[], key: number[]): void {
    for (let i = 1; i < list.length; i++) {
      const a = list[i] as Actor;
      const k = key[i] as number;
      let j = i - 1;
      while (j >= 0 && (key[j] as number) > k) {
        list[j + 1] = list[j] as Actor;
        key[j + 1] = key[j] as number;
        j--;
      }
      list[j + 1] = a;
      key[j + 1] = k;
    }
  }
}

/** Ring of ray-hit records (see ScratchLists). */
export class ScratchHits {
  private readonly hits: ActorRayHit[] = [];
  private next = 0;

  constructor(size = 8) {
    for (let i = 0; i < size; i++) {
      this.hits.push({ actor: null as unknown as Actor, point: new THREE.Vector3(), distance: 0, weakPoint: null });
    }
  }

  take(): ActorRayHit {
    const h = this.hits[this.next] as ActorRayHit;
    this.next = (this.next + 1) % this.hits.length;
    return h;
  }
}
