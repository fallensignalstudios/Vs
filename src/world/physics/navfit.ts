/**
 * Per-agent fit caches for the nav grid. The grid itself is built for the default agent (0.45 m radius,
 * 1.8 m tall); a wider or taller agent — the 1.2 m / 3.6 m elite — may only use the nodes where ITS body
 * stands clear of solids, has headroom and keeps its own ledge margin. That is tested exactly, lazily, once per
 * node and agent profile, and remembered until the nodes are rebuilt.
 */

/** One agent profile and what is known about each node for it (0 = not tested yet, 1 = fits, 2 = does not). */
export interface Fit {
  radius: number;
  height: number;
  margin: number;
  ok: Uint8Array;
  /** the same three states per directed link (8 per node) between nodes at different heights */
  link: Uint8Array;
  /** last use (for eviction) */
  stamp: number;
}

/** profiles kept at once: the elite plus a few heavy variants is all a zone ever asks for */
const MAX_PROFILES = 4;

export class FitCache {
  private readonly list: Fit[] = [];
  private clock = 0;

  /** The (possibly new) profile for an agent; sizes are matched to the centimetre. */
  get(radius: number, height: number, margin: number, slots: number): Fit {
    const r = Math.round(radius * 100) / 100, h = Math.round(height * 100) / 100;
    for (const f of this.list) {
      if (f.radius === r && f.height === h) { f.stamp = ++this.clock; return f; }
    }
    let f: Fit;
    if (this.list.length < MAX_PROFILES) {
      f = { radius: r, height: h, margin, ok: new Uint8Array(slots), link: new Uint8Array(slots * 8), stamp: 0 };
      this.list.push(f);
    } else {
      f = this.list[0];
      for (const c of this.list) if (c.stamp < f.stamp) f = c;
      f.radius = r; f.height = h; f.margin = margin;
      f.ok.fill(0);
      f.link.fill(0);
    }
    f.stamp = ++this.clock;
    return f;
  }

  /** Forget everything (full rebuild); profiles are re-created at the new size on demand. */
  reset(): void {
    this.list.length = 0;
  }

  /** Forget the nodes of the cells in [x0..x1] × [z0..z1] (an incremental rebuild touched them). */
  clearCells(x0: number, z0: number, x1: number, z1: number, cols: number, levels: number): void {
    for (const f of this.list) {
      for (let iz = z0; iz <= z1; iz++) {
        const a = (iz * cols + x0) * levels, b = (iz * cols + x1 + 1) * levels;
        f.ok.fill(0, a, b);
        f.link.fill(0, a * 8, b * 8);
      }
    }
  }
}
