/**
 * Navigation grid, storage and build — nodes keyed by (ix, iz, level) over the walkable surfaces minus solids,
 * with 8-neighbour links (no corner cutting). The queries on top of it (straight-line tests, A* paths) live in
 * nav.ts.
 *
 * Storage is slot based: every cell owns LEVELS height slots (sorted ascending, NaN = empty), so a balcony over
 * a floor is two nodes in one cell and a door toggle can be re-evaluated for just the cells it touches
 * (`rebuild()` is incremental when only a few colliders/surfaces changed since the last build). Queries
 * refresh a stale grid themselves (`ensure`), so nav never answers from out-of-date geometry.
 *
 * A node exists exactly where the default agent could stand by the movement rules: ground (cracks up to
 * GAP_TOL count), headroom, the ledge margin, and an `agentRadius` circle clear of solids. Wider / taller
 * agents use the subset of nodes where their own body fits (`passes`, navfit.ts).
 */
import { GAP_TOL, warnOnce } from './shapes';
import type { SurfaceRec } from './shapes';
import { DEF_HEIGHT, DEF_MAX_DROP, DEF_STEP_UP, edgeMarginFor } from './world';
import type { PhysicsCore } from './world';
import { DIR_X, DIR_Z, GridSearch, LEVELS } from './navsearch';
import { FitCache } from './navfit';
import type { Fit } from './navfit';

/** grid cells before the cell size is doubled (keeps the link table ≤ ~20 MB) */
const MAX_CELLS = 160_000;
/** level tolerance when mapping an arbitrary point onto a node of its cell */
export const LEVEL_TOL = 0.9;
/** solid clearance is measured up to this distance (the widest agent radius supported) */
export const CLEARANCE_CAP = 3;
/**
 * Extra clearance a wide / tall agent keeps on top of the radius it asks for — the same skin the default
 * agent has (0.45 m nodes for 0.4 m bodies), so a body steered a few centimetres off its path does not scrape.
 */
const WIDE_SKIN = 0.05;
/** smoothed paths stay within this of the true ground height (keeps waypoints at ramp ends) */
export const GROUND_FOLLOW = 0.3;
/** ground sampling of the exact swept test (below GAP_TOL, so no void hides between samples) */
const SWEEP_STEP = GAP_TOL * 0.75;
/** a height change between two sweep samples larger than this is a step (both bands are tested across it) */
const SWEEP_RISE = 0.05;
/** links between nodes whose heights differ by more than this are verified by an exact sweep */
const LINK_FLAT = 1e-3;
/** opposite of each of the 8 link directions (E W S N SE SW NE NW) */
const REV: readonly number[] = [1, 0, 3, 2, 7, 6, 5, 4];
/** the four "forward" directions: every undirected link is E, S, SE or SW of exactly one of its two cells */
const FORWARD: readonly boolean[] = [true, false, true, false, true, true, false, false];

export class NavGridBase {
  built = false;
  /** bumped on every (re)build — debug drawing keys off it */
  buildId = 0;
  /** machine-independent effort counters (tests and the debug HUD read these instead of wall-clock time) */
  readonly stats = { builds: 0, lastBuildFull: false, lastBuildCells: 0, lastSearchExpanded: 0 };

  protected cell = 0.5;
  protected agentRadius = 0.45;
  /** ledge margin of the default agent: nodes keep this far from voids and deep drops */
  protected margin = 0.25;
  protected minX = 0;
  protected minZ = 0;
  protected cols = 0;
  protected rows = 0;
  protected ny = new Float32Array(0);
  protected nbr = new Int32Array(0);
  protected comp = new Int32Array(0);
  /**
   * Non-zero for nodes A* steers around when it can: 1 = next to an obstacle or an edge (a neighbouring cell
   * has no node to link to), 2 = only because one of its links was cut by verifyLinks.
   */
  protected crowd = new Uint8Array(0);
  /**
   * per CELL: 1 when the boundary of a surface that could take the headroom of a node here (it hangs between
   * step height and body height above the node) runs close enough to cross one of the cell's links
   */
  protected edge = new Uint8Array(0);
  protected readonly rimSurf: Array<SurfaceRec | null> = new Array<SurfaceRec | null>(8).fill(null);
  protected nodes = 0;
  protected builtRevision = -1;
  protected readonly search = new GridSearch();
  protected readonly pathSlots: number[] = [];
  protected readonly heights = new Float64Array(16);
  protected readonly hsurf: Array<SurfaceRec | null> = new Array<SurfaceRec | null>(16).fill(null);
  protected queue = new Int32Array(0);
  protected readonly fits = new FitCache();
  /** profile every node touched by the current query must fit (null = the default agent) */
  protected fit: Fit | null = null;
  protected readonly pass = (slot: number): boolean => this.passes(slot);
  protected readonly passLink = (from: number, dir: number, to: number): boolean => this.linkFits(from, dir, to);

  constructor(protected readonly core: PhysicsCore) {
    core.onClear = () => this.reset();
  }

  get stale(): boolean { return this.built && this.builtRevision !== this.core.revision; }
  get nodeCount(): number { return this.nodes; }
  get cellSize(): number { return this.cell; }

  protected reset(): void {
    this.built = false;
    this.cols = 0; this.rows = 0; this.nodes = 0;
    this.fits.reset();
    this.buildId++;
  }

  // -------------------------------------------------------------------------------------------------------
  // build
  // -------------------------------------------------------------------------------------------------------
  rebuild(opts?: { cell?: number; agentRadius?: number }): void {
    const core = this.core;
    let cell = opts?.cell !== undefined && opts.cell > 0 ? opts.cell : this.cell;
    cell = Math.min(4, Math.max(0.2, cell));
    let agentRadius = opts?.agentRadius !== undefined && opts.agentRadius > 0 ? opts.agentRadius : this.agentRadius;
    agentRadius = Math.min(3, Math.max(0.05, agentRadius));

    // bounds of the enabled surfaces, snapped to the cell lattice so node positions are stable across builds
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const s of core.surfaces) {
      if (!s.on) continue;
      if (s.minX < minX) minX = s.minX;
      if (s.minZ < minZ) minZ = s.minZ;
      if (s.maxX > maxX) maxX = s.maxX;
      if (s.maxZ > maxZ) maxZ = s.maxZ;
    }
    let cols = 0, rows = 0, ox = 0, oz = 0;
    if (minX <= maxX) {
      for (;;) {
        ox = Math.floor(minX / cell) * cell; oz = Math.floor(minZ / cell) * cell;
        cols = Math.max(1, Math.ceil((maxX - ox) / cell - 1e-9));
        rows = Math.max(1, Math.ceil((maxZ - oz) / cell - 1e-9));
        if (cols * rows <= MAX_CELLS) break;
        cell *= 2;
        warnOnce('nav-huge', `walkable area too large for the nav cell size; using ${cell} m cells`);
      }
    }

    const full = !this.built || cell !== this.cell || agentRadius !== this.agentRadius || core.navDirtyAll
      || ox !== this.minX || oz !== this.minZ || cols !== this.cols || rows !== this.rows;
    const dirty = core.navDirty;
    if (!full && dirty.length === 0) { this.builtRevision = core.revision; return; }

    let incremental = !full;
    if (incremental) {
      let area = 0;
      for (let i = 0; i < dirty.length; i += 4) {
        area += ((dirty[i + 2] - dirty[i]) / cell + 4) * ((dirty[i + 3] - dirty[i + 1]) / cell + 4);
      }
      if (area > cols * rows * 0.4) incremental = false;
    }

    let cells = 0;
    if (!incremental) {
      this.cell = cell; this.agentRadius = agentRadius;
      this.margin = edgeMarginFor(agentRadius);
      this.minX = ox; this.minZ = oz; this.cols = cols; this.rows = rows;
      const slots = cols * rows * LEVELS;
      if (this.ny.length !== slots) {
        this.ny = new Float32Array(slots);
        this.nbr = new Int32Array(slots * 8);
        this.comp = new Int32Array(slots);
        this.crowd = new Uint8Array(slots);
        this.edge = new Uint8Array(cols * rows);
        this.queue = new Int32Array(slots);
      }
      this.search.resize(slots);
      this.fits.reset();
      for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < cols; ix++) this.computeCell(ix, iz);
      for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < cols; ix++) this.linkCell(ix, iz);
      this.verifyLinks(0, 0, cols - 1, rows - 1);
      cells = cols * rows;
    } else {
      const inv = 1 / cell;
      // a changed solid moves nodes within the agent radius of it; a changed surface also moves ledges
      const pad = Math.max(agentRadius, this.margin + GAP_TOL) + cell;
      const wide = Math.ceil(CLEARANCE_CAP * inv);
      for (let i = 0; i < dirty.length; i += 4) {
        const x0 = Math.max(0, Math.floor((dirty[i] - pad - ox) * inv));
        const z0 = Math.max(0, Math.floor((dirty[i + 1] - pad - oz) * inv));
        const x1 = Math.min(cols - 1, Math.floor((dirty[i + 2] + pad - ox) * inv));
        const z1 = Math.min(rows - 1, Math.floor((dirty[i + 3] + pad - oz) * inv));
        if (x1 < x0 || z1 < z0) continue;
        for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) this.computeCell(ix, iz);
        const lx0 = Math.max(0, x0 - 1), lz0 = Math.max(0, z0 - 1);
        const lx1 = Math.min(cols - 1, x1 + 1), lz1 = Math.min(rows - 1, z1 + 1);
        for (let iz = lz0; iz <= lz1; iz++) for (let ix = lx0; ix <= lx1; ix++) this.linkCell(ix, iz);
        this.verifyLinks(lx0, lz0, lx1, lz1);
        cells += (x1 - x0 + 1) * (z1 - z0 + 1);
        this.fits.clearCells(
          Math.max(0, x0 - wide), Math.max(0, z0 - wide), Math.min(cols - 1, x1 + wide), Math.min(rows - 1, z1 + wide),
          cols, LEVELS,
        );
      }
    }
    this.labelComponents();

    dirty.length = 0;
    core.navDirtyAll = false;
    core.navTracking = true;
    this.built = true;
    this.builtRevision = core.revision;
    this.buildId++;
    this.stats.builds++;
    this.stats.lastBuildFull = !incremental;
    this.stats.lastBuildCells = cells;
  }

  /** Evaluate the height slots of one cell: stable surface levels where the default agent can stand. */
  protected computeCell(ix: number, iz: number): void {
    const core = this.core;
    const x = this.minX + (ix + 0.5) * this.cell, z = this.minZ + (iz + 0.5) * this.cell;
    const hs = this.heights, hf = this.hsurf;
    let n = 0;
    const list = core.surfaceHash.cellAt(x, z);
    const big = core.surfaceHash.big;
    const n0 = list ? list.length : 0, total = n0 + big.length;
    let near = false, rims = 0;
    const rim = this.rimSurf;
    const band = this.cell * 0.75;
    for (let i = 0; i < total && n < 16; i++) {
      const s = i < n0 ? list![i] : big[i - n0];
      if (!s.on) continue;
      const h = s.heightAt(x, z);
      if (h === h) { hs[n] = h; hf[n++] = s; } else near = true;
      if (rims < 8) {
        const inset = s.inset(x, z);
        if (inset < band && inset > -band) rim[rims++] = s;
      }
    }
    if (near) {
      // the centre may sit in a crack between two surfaces: that is floor too
      for (let i = 0; i < total && n < 16; i++) {
        const s = i < n0 ? list![i] : big[i - n0];
        if (!s.on) continue;
        const a = s.outside(x, z);
        if (a <= 0 || a > GAP_TOL * 0.5) continue;
        const h = s.heightNear(x, z);
        const g = core.groundY(x, z, h, 1e-3);
        if (g === g && Math.abs(g - h) < 1e-6 && core.lastSurface === s) { hs[n] = h; hf[n++] = s; }
      }
    }
    // insertion sort ascending
    for (let i = 1; i < n; i++) {
      const v = hs[i], vs = hf[i];
      let j = i - 1;
      while (j >= 0 && hs[j] > v) { hs[j + 1] = hs[j]; hf[j + 1] = hf[j]; j--; }
      hs[j + 1] = v; hf[j + 1] = vs;
    }
    const base = (iz * this.cols + ix) * LEVELS;
    const ny = this.ny;
    let used = 0;
    for (let i = 0; i < n; i++) {
      const h = hs[i];
      // a level is only stable if nothing sits within step-up above it (the character would snap up),
      // and only usable with headroom to the next surface above
      if (i + 1 < n && (hs[i + 1] <= h + DEF_STEP_UP + 1e-6 || hs[i + 1] < h + DEF_HEIGHT - 1e-6)) continue;
      if (!core.standClear(x, z, h, this.agentRadius, DEF_STEP_UP, DEF_HEIGHT)) continue;
      if (this.margin > 0 && !core.ledgeOk(x, z, h, hf[i], this.margin, DEF_STEP_UP, DEF_MAX_DROP)) continue;
      if (used === LEVELS) { warnOnce('nav-levels', `more than ${LEVELS} walkable levels in one nav cell; extra levels ignored`); break; }
      ny[base + used++] = h;
    }
    for (let i = used; i < LEVELS; i++) ny[base + i] = NaN;
    // does the edge of an overhanging surface cross this cell's links? (see verifyLinks)
    let flag = 0;
    for (let k = 0; k < rims && flag === 0; k++) {
      const s = rim[k]!;
      for (let l = 0; l < used; l++) {
        const h = ny[base + l];
        if (s.yHi > h + DEF_STEP_UP + 1e-6 && s.yLo < h + DEF_HEIGHT - 1e-6) { flag = 1; break; }
      }
    }
    this.edge[iz * this.cols + ix] = flag;
  }

  /** Slot of cell (ix,iz) whose height is closest to y within tol, or -1. */
  protected findSlot(ix: number, iz: number, y: number, tol: number): number {
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1;
    const base = (iz * this.cols + ix) * LEVELS;
    const ny = this.ny;
    let best = -1, bestD = tol;
    for (let l = 0; l < LEVELS; l++) {
      const h = ny[base + l];
      if (h !== h) break;
      const d = h > y ? h - y : y - h;
      if (d <= bestD) { bestD = d; best = base + l; }
    }
    return best;
  }

  /** Does the agent of the current query fit on this node? (Exact test, remembered per profile.) */
  protected passes(slot: number): boolean {
    const f = this.fit;
    if (f === null) return true;
    const known = f.ok[slot];
    if (known !== 0) return known === 1;
    const core = this.core;
    const x = this.slotX(slot), z = this.slotZ(slot), y = this.ny[slot];
    let ok = core.standClear(x, z, y, f.radius, DEF_STEP_UP, f.height);
    if (ok && f.height > DEF_HEIGHT) ok = core.headroom(x, z, y, DEF_STEP_UP, f.height);
    if (ok && f.margin > this.margin) {
      core.groundY(x, z, y, 1e-3);
      ok = core.ledgeOk(x, z, y, core.lastSurface, f.margin, DEF_STEP_UP, DEF_MAX_DROP);
    }
    f.ok[slot] = ok ? 1 : 2;
    return ok;
  }

  /** findSlot restricted to nodes the current agent fits on. */
  protected fitSlot(ix: number, iz: number, y: number, tol: number): number {
    const s = this.findSlot(ix, iz, y, tol);
    return s >= 0 && this.fit !== null && !this.passes(s) ? -1 : s;
  }

  protected linkCell(ix: number, iz: number): void {
    const base = (iz * this.cols + ix) * LEVELS;
    const ny = this.ny, nbr = this.nbr;
    const tol = DEF_STEP_UP + 1e-4;
    for (let l = 0; l < LEVELS; l++) {
      const slot = base + l;
      const o = slot * 8;
      const y = ny[slot];
      if (y !== y) { for (let d = 0; d < 8; d++) nbr[o + d] = -1; this.crowd[slot] = 0; continue; }
      let open = 0;
      for (let d = 0; d < 4; d++) {
        const t = nbr[o + d] = this.findSlot(ix + DIR_X[d], iz + DIR_Z[d], y, tol);
        if (t >= 0) open++;
      }
      for (let d = 4; d < 8; d++) {
        const a = nbr[o + (DIR_X[d] > 0 ? 0 : 1)], b = nbr[o + (DIR_Z[d] > 0 ? 2 : 3)];
        let t = -1;
        if (a >= 0 && b >= 0) {
          t = this.findSlot(ix + DIR_X[d], iz + DIR_Z[d], y, tol);
          if (t >= 0) {
            const ty = ny[t];
            if (Math.abs(ny[a] - ty) > tol || Math.abs(ny[b] - ty) > tol) t = -1;
          }
        }
        nbr[o + d] = t;
        if (t >= 0) open++;
      }
      this.crowd[slot] = open < 8 ? 1 : 0;
    }
  }

  /**
   * Exact swept test a → b for the current agent, by the rules of movement: the ground is followed every
   * SWEEP_STEP (never up or down more than a step: nav links are two-way) with headroom and the ledge margin,
   * and the body is tested against solids often enough that the discs overlap to within a centimetre — at
   * every sample on a slope, and in the height band of BOTH sides wherever the ground steps, because the body
   * changes height somewhere between the two samples. Returns the ground height at b, or NaN.
   * `skipStart` leaves the start position itself unjudged. With `lineA` / `lineB` (heights of the a→b line at
   * its ends) the ground must also stay within GROUND_FOLLOW of that line. `groundOnly` skips the solids (for
   * hops whose ends are known to cover them).
   */
  protected sweepTo(
    ax: number, ay: number, az: number, bx: number, bz: number, skipStart: boolean, lineA: number, lineB: number,
    groundOnly = false,
  ): number {
    const f = this.fit, core = this.core;
    const r = f ? f.radius : this.agentRadius, hh = f ? f.height : DEF_HEIGHT, m = f ? f.margin : this.margin;
    const dx = bx - ax, dz = bz - az;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / SWEEP_STEP));
    const follow = lineA === lineA;
    let cur = ay, px = ax, pz = az;
    /** was the previous sample position tested against solids (at its own height)? */
    let tested = false;
    /** may the previous sample position be judged at all? (not the caller's own start) */
    let judge = false;
    for (let i = skipStart ? 1 : 0; i <= n; i++) {
      const t = i / n;
      const x = ax + dx * t, z = az + dz * t;
      const g = core.place(x, z, cur, DEF_STEP_UP, DEF_MAX_DROP, hh, true, m);
      if (g !== g || cur - g > DEF_STEP_UP + 1e-6) return NaN;
      if (follow && Math.abs(g - (lineA + (lineB - lineA) * t)) > GROUND_FOLLOW) return NaN;
      if (groundOnly) { cur = g; continue; }
      const rise = g > cur ? g - cur : cur - g;
      if (rise > SWEEP_RISE && judge) {
        if (!tested && !core.standClear(px, pz, cur, r, DEF_STEP_UP, hh)) return NaN;
        if (!core.standClear(px, pz, g, r, DEF_STEP_UP, hh) || !core.standClear(x, z, cur, r, DEF_STEP_UP, hh)) return NaN;
      }
      if ((i & 1) === 0 || i === n || rise > 1e-9) {
        if (!core.standClear(x, z, g, r, DEF_STEP_UP, hh)) return NaN;
        tested = true;
      } else tested = false;
      cur = g; px = x; pz = z; judge = true;
    }
    return cur;
  }

  /**
   * Two nodes at different heights (a ramp, a step) are individually standable, but the body changes height
   * on the way between them: a soffit, a low solid or a jump in the ground can make the transit impossible
   * although both ends are fine. Every such link of the cells in [x0..x1] × [z0..z1] is swept exactly, once
   * per pair, and cut in both directions when the default agent cannot make the walk.
   *
   * Links between nodes at the same height are cheaper to vouch for:
   *  - solids: two agent discs one cell apart cover a body of √(r² − (cell/2)²) between them — 0.37 m for the
   *    defaults, 3 cm short of a 0.4 m body — so next to an obstacle the midpoint of a straight link is tested
   *    too (diagonal links are covered by the four nodes the corner rule demands);
   *  - ground: where the edge of a surface that hangs over the nodes' level (between step and body height)
   *    runs between the two cells, the ground rules are followed across the hop: the corner of a bare ramp
   *    or a thin raised strip has no headroom beneath it for the feet, although both cell centres stand
   *    clear of it. (Voids need no such test: with the ledge margin on both sides no link spans one.)
   */
  protected verifyLinks(x0: number, z0: number, x1: number, z1: number): number {
    const { cols, ny, nbr, crowd, cell, edge } = this;
    let swept = 0;
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const base = (iz * cols + ix) * LEVELS;
        const x = this.minX + (ix + 0.5) * cell, z = this.minZ + (iz + 0.5) * cell;
        for (let l = 0; l < LEVELS; l++) {
          const slot = base + l;
          const y = ny[slot];
          if (y !== y) break;
          for (let d = 0; d < 8; d++) {
            const t = nbr[slot * 8 + d];
            if (t < 0) continue;
            const ty = ny[t];
            const jx = ix + DIR_X[d], jz = iz + DIR_Z[d];
            const flat = ty - y <= LINK_FLAT && y - ty <= LINK_FLAT;
            const rim = edge[iz * cols + ix] !== 0 || edge[jz * cols + jx] !== 0;
            const tight = d < 4 && (crowd[slot] === 1 || crowd[t] === 1);
            if (flat && !rim && !tight) continue;
            // a pair inside the rect is judged from its forward side only; across the border, from here
            if (!FORWARD[d] && jx >= x0 && jx <= x1 && jz >= z0 && jz <= z1) continue;
            const tx = x + DIR_X[d] * cell, tz = z + DIR_Z[d] * cell;
            let ok = true;
            if (!flat || rim) {
              // always swept in the forward direction, so both sides of a border agree
              const end = FORWARD[d] ? this.sweepTo(x, y, z, tx, tz, flat, NaN, NaN, flat) : this.sweepTo(tx, ty, tz, x, z, flat, NaN, NaN, flat);
              const want = FORWARD[d] ? ty : y;
              swept++;
              ok = end === end && end - want <= LINK_FLAT && want - end <= LINK_FLAT;
            }
            if (ok && flat && tight) ok = this.core.standClear((x + tx) * 0.5, (z + tz) * 0.5, y, this.agentRadius, DEF_STEP_UP, DEF_HEIGHT);
            if (ok) continue;
            nbr[slot * 8 + d] = -1; nbr[t * 8 + REV[d]] = -1;
          }
        }
      }
    }
    // flag 2 = "has a cut link", derived afresh for every node whose links may have changed (the rect and the
    // ring around it), so an incremental rebuild leaves exactly the flags a full build would
    const rows = this.rows;
    for (let iz = Math.max(0, z0 - 1); iz <= Math.min(rows - 1, z1 + 1); iz++) {
      for (let ix = Math.max(0, x0 - 1); ix <= Math.min(cols - 1, x1 + 1); ix++) {
        const base = (iz * cols + ix) * LEVELS;
        for (let l = 0; l < LEVELS; l++) {
          const slot = base + l;
          if (ny[slot] !== ny[slot]) break;
          if (crowd[slot] === 1) continue;
          let cut = 0;
          for (let d = 0; d < 8; d++) if (nbr[slot * 8 + d] < 0) { cut = 2; break; }
          crowd[slot] = cut;
        }
      }
    }
    return swept;
  }

  /**
   * Can the big agent of the current query make the hop between two linked nodes? Same question as
   * verifyLinks answers for the default agent, asked lazily per link and remembered in the fit profile: with
   * the ends at different heights the body must clear every solid in the band of BOTH heights, at both ends
   * and half way.
   */
  protected linkFits(a: number, d: number, b: number): boolean {
    const f = this.fit;
    if (f === null) return true;
    const ya = this.ny[a], yb = this.ny[b];
    if (ya - yb <= LINK_FLAT && yb - ya <= LINK_FLAT) return true;
    const known = f.link[a * 8 + d];
    if (known !== 0) return known === 1;
    const lo = ya < yb ? ya : yb, h = f.height + (ya < yb ? yb - ya : ya - yb);
    const ax = this.slotX(a), az = this.slotZ(a), bx = this.slotX(b), bz = this.slotZ(b);
    const core = this.core;
    const ok = core.standClear(ax, az, lo, f.radius, DEF_STEP_UP, h)
      && core.standClear(bx, bz, lo, f.radius, DEF_STEP_UP, h)
      && core.standClear((ax + bx) * 0.5, (az + bz) * 0.5, lo, f.radius, DEF_STEP_UP, h);
    f.link[a * 8 + d] = ok ? 1 : 2;
    f.link[b * 8 + REV[d]] = ok ? 1 : 2;
    return ok;
  }

  protected labelComponents(): void {
    const ny = this.ny, nbr = this.nbr, comp = this.comp, queue = this.queue;
    const slots = this.cols * this.rows * LEVELS;
    comp.fill(-1, 0, slots);
    let label = 0, nodes = 0;
    for (let s = 0; s < slots; s++) {
      if (comp[s] !== -1 || ny[s] !== ny[s]) continue;
      let head = 0, tail = 0;
      queue[tail++] = s; comp[s] = label;
      while (head < tail) {
        const c = queue[head++];
        nodes++;
        const o = c * 8;
        for (let d = 0; d < 8; d++) {
          const nb = nbr[o + d];
          if (nb >= 0 && comp[nb] === -1) { comp[nb] = label; queue[tail++] = nb; }
        }
      }
      label++;
    }
    this.nodes = nodes;
  }

  /** Make sure the grid reflects the world as it is now. False when there is nothing to query. */
  protected ensure(): boolean {
    if (!this.built) {
      if (this.core.surfaces.length === 0) return false;
      this.rebuild();
    } else if (this.builtRevision !== this.core.revision) this.rebuild();
    return this.cols > 0;
  }

  /** Arm the query for an agent (default agent when it is no wider / taller). False when unbuildable. */
  protected begin(radius: number, height: number): boolean {
    this.fit = null;
    if (!this.ensure()) return false;
    const r = radius > this.agentRadius ? Math.min(radius + WIDE_SKIN, CLEARANCE_CAP) : this.agentRadius;
    const h = height > DEF_HEIGHT ? height : DEF_HEIGHT;
    if (r > this.agentRadius || h > DEF_HEIGHT) {
      this.fit = this.fits.get(r, h, Math.max(this.margin, edgeMarginFor(r)), this.cols * this.rows * LEVELS);
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------------------
  // point ↔ node mapping
  // -------------------------------------------------------------------------------------------------------
  protected slotX(slot: number): number {
    return this.minX + ((((slot / LEVELS) | 0) % this.cols) + 0.5) * this.cell;
  }

  protected slotZ(slot: number): number {
    return this.minZ + (((((slot / LEVELS) | 0) / this.cols) | 0) + 0.5) * this.cell;
  }

  /** Node of the cell containing (x,z) at the level of y, or -1. */
  protected slotAt(x: number, y: number, z: number, tol: number): number {
    const inv = 1 / this.cell;
    return this.findSlot(Math.floor((x - this.minX) * inv), Math.floor((z - this.minZ) * inv), y, tol);
  }

  /**
   * Exact standing test for the current agent at (x,z) on the level of node height `h`: the ground height
   * there, or NaN when the body does not fit (solid, headroom, ledge, different level).
   */
  protected standAt(x: number, z: number, h: number): number {
    const f = this.fit, core = this.core;
    const r = f ? f.radius : this.agentRadius, hh = f ? f.height : DEF_HEIGHT, m = f ? f.margin : this.margin;
    const g = core.place(x, z, h, DEF_STEP_UP, DEF_MAX_DROP, hh, true, m);
    if (g !== g || h - g > DEF_STEP_UP + 1e-6) return NaN;
    return core.standClear(x, z, g, r, DEF_STEP_UP, hh) ? g : NaN;
  }

  /** standAt for an arbitrary point: its cell must hold a fitting node on the level of y. */
  protected exactAt(x: number, y: number, z: number, tol: number): number {
    const s = this.slotAt(x, y, z, tol);
    if (s < 0 || !this.passes(s)) return NaN;
    return this.standAt(x, z, this.ny[s]);
  }

  /**
   * Nearest fitting node to a point, preferring the point's own level (within 2 m of y, searched out to
   * `sameLevel`) over other levels (searched out to maxDist). -1 when there is none.
   * `comp` ≥ 0 restricts the search to one connected component.
   */
  protected nodeNear(x: number, y: number, z: number, maxDist: number, comp = -1, sameLevel = maxDist): number {
    const here = this.slotAt(x, y, z, LEVEL_TOL);
    const comps = this.comp, fit = this.fit;
    if (here >= 0 && this.passes(here) && (comp < 0 || comps[here] === comp)) return here;
    const inv = 1 / this.cell;
    const cx = Math.floor((x - this.minX) * inv), cz = Math.floor((z - this.minZ) * inv);
    const ny = this.ny, cols = this.cols, rows = this.rows;
    for (let pass = 0; pass < 2; pass++) {
      const dyLimit = pass === 0 ? 2 : Infinity;
      const reachMax = pass === 0 ? sameLevel : maxDist;
      const R = Math.ceil(reachMax * inv);
      const max2 = reachMax * reachMax;
      let best = -1, bestD = Infinity;
      for (let r = 0; r <= R; r++) {
        const reach = (r - 1) * this.cell;
        if (best >= 0 && reach > 0 && reach * reach > bestD) break;
        for (let dz = -r; dz <= r; dz++) {
          const iz = cz + dz;
          if (iz < 0 || iz >= rows) continue;
          const edge = dz === -r || dz === r;
          for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r || 1) {
            const ix = cx + dx;
            if (ix < 0 || ix >= cols) continue;
            const base = (iz * cols + ix) * LEVELS;
            const px = this.minX + (ix + 0.5) * this.cell - x, pz = this.minZ + (iz + 0.5) * this.cell - z;
            const d2 = px * px + pz * pz;
            if (d2 > max2) continue;
            for (let l = 0; l < LEVELS; l++) {
              const h = ny[base + l];
              if (h !== h) break;
              const dy = Math.abs(h - y);
              if (dy > dyLimit || (comp >= 0 && comps[base + l] !== comp)) continue;
              const score = d2 + dy * dy * 2.25;
              if (score >= bestD || (fit !== null && !this.passes(base + l))) continue;
              bestD = score; best = base + l;
            }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
}
