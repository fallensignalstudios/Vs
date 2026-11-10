/**
 * Uniform spatial hash over the XZ plane (broadphase for colliders and walkable surfaces).
 * Items are bucketed by their world AABB. Items spanning an unreasonable number of cells live in an
 * "oversize" list that every query visits. Pure TypeScript, no allocations on the query paths.
 */

/** Anything storable in the hash: a world-space XZ AABB plus bookkeeping the hash owns. */
export interface HashItem {
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** cell range the item currently occupies (hash-owned) */
  c0x: number; c0z: number; c1x: number; c1z: number;
  /** query de-duplication stamp (hash-owned) */
  stamp: number;
  /** -1 not inserted, 0 bucketed, 1 oversize (hash-owned) */
  slot: number;
}

const OFFSET = 0x8000;
const LIMIT = 0x7fff;
/** items covering more cells than this go to the oversize list */
const MAX_CELLS = 4096;

const clampCell = (v: number): number => (v < -LIMIT ? -LIMIT : v > LIMIT ? LIMIT : v);

export class SpatialHash<T extends HashItem> {
  readonly cell: number;
  private readonly inv: number;
  private readonly map = new Map<number, T[]>();
  /** oversize items; always visited */
  readonly big: T[] = [];
  private stampGen = 0;

  constructor(cell = 4) {
    this.cell = cell;
    this.inv = 1 / cell;
  }

  /** integer cell coordinate of a world coordinate */
  coord(v: number): number {
    return clampCell(Math.floor(v * this.inv));
  }

  private static key(ix: number, iz: number): number {
    return (ix + OFFSET) * 0x10000 + (iz + OFFSET);
  }

  insert(item: T): void {
    if (item.slot !== -1) this.remove(item);
    const c0x = this.coord(item.minX), c1x = this.coord(item.maxX);
    const c0z = this.coord(item.minZ), c1z = this.coord(item.maxZ);
    item.c0x = c0x; item.c1x = c1x; item.c0z = c0z; item.c1z = c1z;
    if ((c1x - c0x + 1) * (c1z - c0z + 1) > MAX_CELLS) {
      item.slot = 1;
      this.big.push(item);
      return;
    }
    item.slot = 0;
    for (let ix = c0x; ix <= c1x; ix++) {
      for (let iz = c0z; iz <= c1z; iz++) {
        const k = SpatialHash.key(ix, iz);
        const list = this.map.get(k);
        if (list) list.push(item);
        else this.map.set(k, [item]);
      }
    }
  }

  remove(item: T): void {
    if (item.slot === -1) return;
    if (item.slot === 1) {
      const i = this.big.indexOf(item);
      if (i >= 0) this.big.splice(i, 1);
    } else {
      for (let ix = item.c0x; ix <= item.c1x; ix++) {
        for (let iz = item.c0z; iz <= item.c1z; iz++) {
          const k = SpatialHash.key(ix, iz);
          const list = this.map.get(k);
          if (!list) continue;
          const i = list.indexOf(item);
          if (i >= 0) {
            list[i] = list[list.length - 1];
            list.pop();
          }
          if (list.length === 0) this.map.delete(k);
        }
      }
    }
    item.slot = -1;
  }

  /** Re-bucket after the item's AABB changed (cheap no-op when the cell range is unchanged). */
  update(item: T): void {
    if (item.slot === 0
      && this.coord(item.minX) === item.c0x && this.coord(item.maxX) === item.c1x
      && this.coord(item.minZ) === item.c0z && this.coord(item.maxZ) === item.c1z) return;
    this.remove(item);
    this.insert(item);
  }

  clear(): void {
    this.map.clear();
    this.big.length = 0;
  }

  /** Bucket for the cell containing a world point (may be undefined). Callers must also visit `big`. */
  cellAt(x: number, z: number): T[] | undefined {
    return this.map.get(SpatialHash.key(this.coord(x), this.coord(z)));
  }

  /** Bucket by integer cell coordinates. */
  bucket(ix: number, iz: number): T[] | undefined {
    return this.map.get(SpatialHash.key(ix, iz));
  }

  /** Fresh stamp for manual de-duplicated traversals (see ray casting). */
  nextStamp(): number {
    return ++this.stampGen;
  }

  /**
   * Collect the unique items whose cells touch the AABB into `out` (overwritten from index 0).
   * Returns the count. Candidates only — callers run the exact test.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: T[]): number {
    let n = 0;
    const big = this.big;
    for (let i = 0; i < big.length; i++) out[n++] = big[i];
    const c0x = this.coord(minX), c1x = this.coord(maxX);
    const c0z = this.coord(minZ), c1z = this.coord(maxZ);
    if (c0x === c1x && c0z === c1z) {
      const list = this.map.get(SpatialHash.key(c0x, c0z));
      if (list) for (let i = 0; i < list.length; i++) out[n++] = list[i];
      return n;
    }
    const stamp = ++this.stampGen;
    if ((c1x - c0x + 1) * (c1z - c0z + 1) > this.map.size * 2) {
      // Huge query box: walking the occupied buckets is cheaper than walking the cell range.
      for (const list of this.map.values()) {
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (it.stamp === stamp) continue;
          it.stamp = stamp;
          if (it.c1x >= c0x && it.c0x <= c1x && it.c1z >= c0z && it.c0z <= c1z) out[n++] = it;
        }
      }
      return n;
    }
    for (let ix = c0x; ix <= c1x; ix++) {
      for (let iz = c0z; iz <= c1z; iz++) {
        const list = this.map.get(SpatialHash.key(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (it.stamp === stamp) continue;
          it.stamp = stamp;
          out[n++] = it;
        }
      }
    }
    return n;
  }
}
