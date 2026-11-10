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
/** cost multiplier of a step onto a node flagged in `cost` (next to an obstacle or an edge) */
const CROWDED = 1.25;
/** distance handicap (m) of nodes on another level when looking for the nearest reachable node */
const OTHER_LEVEL = 1e4;
/** metres of closer approach a reachable node must offer per metre of extra walking to be preferred */
const DETOUR = 0.05;

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
  /**
   * Of the nodes the last run expanded, the one closest to its reference point (see `run`), or -1 when the
   * run did not track one. `trace` turns it into a path after a run that could not reach its goal.
   */
  nearest = -1;

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
   * nodes the current agent does not fit on (and diagonal steps past such a node); `cost` (optional) flags
   * nodes whose step-in costs CROWDED times as much, so paths prefer open ground without ever being refused
   * tight ground.
   *
   * With `ny` (node heights) the run also remembers which expanded node lies closest to a reference point —
   * (refX, refZ) in fractional cell coordinates, where an integer is a cell centre, at height refY — so a
   * search whose goal turns out to be unreachable still yields "as near as it gets". Nodes more than 2 m
   * above or below the reference only count when nothing on its own level was reached, and a longer walk
   * must buy a proportionally closer approach (DETOUR), so of two equally near spots the nearer one wins.
   * `link` (optional, with `pass`) vetoes individual hops the current agent cannot make.
   */
  run(
    start: number, goal: number, nbr: Int32Array, cols: number, cell: number, out: number[],
    pass: ((slot: number) => boolean) | null = null, cost: Uint8Array | null = null,
    ny: Float32Array | null = null, refX = 0, refZ = 0, refY = 0,
    link: ((from: number, dir: number, to: number) => boolean) | null = null,
  ): boolean {
    out.length = 0;
    this.expanded = 0;
    this.nearest = -1;
    if (start < 0 || goal < 0 || start >= this.g.length || goal >= this.g.length) return false;
    if (start === goal) { out.push(start); this.nearest = start; return true; }
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
    let nearD = Infinity;

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
      if (ny !== null) {
        const cc = (cur / LEVELS) | 0;
        const ex = ((cc % cols) - refX) * cell, ez = (((cc / cols) | 0) - refZ) * cell, ey = ny[cur] - refY;
        const d = Math.sqrt(ex * ex + ez * ez + ey * ey * 2.25) + DETOUR * g[cur] + (ey > 2 || ey < -2 ? OTHER_LEVEL : 0);
        if (d < nearD) { nearD = d; this.nearest = cur; }
      }
      const base = cur * 8;
      const gc = g[cur];
      for (let d = 0; d < 8; d++) {
        const nb = nbr[base + d];
        if (nb < 0 || closed[nb] === id) continue;
        if (pass !== null) {
          if (!pass(nb)) continue;
          // no corner cutting for THIS agent either: a diagonal link only proves the default agent fits on
          // the two cells beside it (they exist whenever the link does)
          if (d >= 4 && (!pass(nbr[base + (DIR_X[d] > 0 ? 0 : 1)]) || !pass(nbr[base + (DIR_Z[d] > 0 ? 2 : 3)]))) continue;
          if (link !== null && !link(cur, d, nb)) continue;
        }
        let step = d < 4 ? cell : diagCost;
        if (cost !== null && cost[nb] !== 0) step *= CROWDED;
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

  /** Fill `out` with the slot sequence from the last run's start to `node` (one of the nodes it reached). */
  trace(node: number, out: number[]): void {
    out.length = 0;
    for (let n = node; n !== -1; n = this.parent[n]) out.push(n);
    out.reverse();
  }
}
