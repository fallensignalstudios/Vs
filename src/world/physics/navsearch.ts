/**
 * A* over the nav grid's slot graph: binary min-heap with decrease-key, octile heuristic, search-stamped
 * scratch arrays (no per-search clearing or allocation). Pure TypeScript.
 */

/** slots per grid cell (must match nav.ts) */
export const LEVELS = 4;
/** 8-neighbour offsets: E, W, S, N, SE, SW, NE, NW (world +X = east, +Z = south) */
export const DIR_X: readonly number[] = [1, -1, 0, 0, 1, -1, 1, -1];
export const DIR_Z: readonly number[] = [0, 0, 1, -1, 1, 1, -1, -1];

const DIAG = Math.SQRT2;
const OCTILE = DIAG - 1;

export class GridSearch {
  private g = new Float32Array(0);
  private f = new Float32Array(0);
  private parent = new Int32Array(0);
  private mark = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private heap = new Int32Array(0);
  private pos = new Int32Array(0);
  private size = 0;
  private id = 0;
  /** nodes taken off the open list by the last run (a machine-independent measure of search effort) */
  expanded = 0;

  /** Make room for `slots` graph nodes (keeps arrays when already large enough). */
  resize(slots: number): void {
    if (this.g.length >= slots) return;
    this.g = new Float32Array(slots);
    this.f = new Float32Array(slots);
    this.parent = new Int32Array(slots);
    this.mark = new Uint32Array(slots);
    this.closed = new Uint32Array(slots);
    this.heap = new Int32Array(slots + 1);
    this.pos = new Int32Array(slots);
    this.id = 0;
  }

  private less(a: number, b: number): boolean {
    const fa = this.f[a], fb = this.f[b];
    return fa < fb || (fa === fb && this.g[a] > this.g[b]);
  }

  private up(i: number): void {
    const heap = this.heap, pos = this.pos;
    const n = heap[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pn = heap[p];
      if (!this.less(n, pn)) break;
      heap[i] = pn; pos[pn] = i;
      i = p;
    }
    heap[i] = n; pos[n] = i;
  }

  private down(i: number): void {
    const heap = this.heap, pos = this.pos, size = this.size;
    const n = heap[i];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && this.less(heap[c + 1], heap[c])) c++;
      const cn = heap[c];
      if (!this.less(cn, n)) break;
      heap[i] = cn; pos[cn] = i;
      i = c;
    }
    heap[i] = n; pos[n] = i;
  }

  /**
   * Cheapest path start → goal over `nbr` (8 links per slot, -1 = none). Fills `out` with the slot sequence
   * (start first) and returns true, or returns false when the goal is unreachable. `pass` (optional) vetoes
   * nodes the current agent does not fit on; `cost` (optional) is a per-node multiplier ≥ 1 on the step
   * into that node, so paths prefer open ground without ever being refused tight ground.
   */
  run(
    start: number, goal: number, nbr: Int32Array, cols: number, cell: number, out: number[],
    pass: ((slot: number) => boolean) | null = null, cost: Uint8Array | null = null,
  ): boolean {
    out.length = 0;
    this.expanded = 0;
    if (start < 0 || goal < 0 || start >= this.g.length || goal >= this.g.length) return false;
    if (start === goal) { out.push(start); return true; }
    if (++this.id >= 0xfffffff0) { this.mark.fill(0); this.closed.fill(0); this.id = 1; }
    const id = this.id;
    const g = this.g, f = this.f, parent = this.parent, mark = this.mark, closed = this.closed;
    const heap = this.heap, pos = this.pos;

    const goalCell = (goal / LEVELS) | 0;
    const gx = goalCell % cols, gz = (goalCell / cols) | 0;
    const diagCost = cell * DIAG;
    const hScale = cell * 1.0005; // tiny over-estimate breaks ties toward the goal

    g[start] = 0; f[start] = 0; parent[start] = -1; mark[start] = id;
    this.size = 1; heap[0] = start; pos[start] = 0;

    while (this.size > 0) {
      const cur = heap[0];
      const last = heap[--this.size];
      if (this.size > 0) { heap[0] = last; pos[last] = 0; this.down(0); }
      if (cur === goal) {
        for (let n = goal; n !== -1; n = parent[n]) out.push(n);
        out.reverse();
        return true;
      }
      closed[cur] = id;
      this.expanded++;
      const base = cur * 8;
      const gc = g[cur];
      for (let d = 0; d < 8; d++) {
        const nb = nbr[base + d];
        if (nb < 0 || closed[nb] === id) continue;
        if (pass !== null && !pass(nb)) continue;
        let step = d < 4 ? cell : diagCost;
        if (cost !== null && cost[nb] !== 0) step *= 1 + cost[nb] * 0.25;
        const ng = gc + step;
        if (mark[nb] === id) {
          if (ng >= g[nb]) continue;
          f[nb] += ng - g[nb];
          g[nb] = ng; parent[nb] = cur;
          this.up(pos[nb]);
          continue;
        }
        const nc = (nb / LEVELS) | 0;
        const ax = Math.abs((nc % cols) - gx), az = Math.abs(((nc / cols) | 0) - gz);
        const h = (ax > az ? ax + OCTILE * az : az + OCTILE * ax) * hScale;
        mark[nb] = id; g[nb] = ng; f[nb] = ng + h; parent[nb] = cur;
        heap[this.size] = nb; pos[nb] = this.size;
        this.up(this.size++);
      }
    }
    return false;
  }
}
