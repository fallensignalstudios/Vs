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
  /** 1 for nodes next to an obstacle or an edge (fewer than 8 links): A* steers around them when it can */
  protected crowd = new Uint8Array(0);
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
        this.queue = new Int32Array(slots);
      }
      this.search.resize(slots);
      this.fits.reset();
      for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < cols; ix++) this.computeCell(ix, iz);
      for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < cols; ix++) this.linkCell(ix, iz);
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
    let near = false;
    for (let i = 0; i < total && n < 16; i++) {
      const s = i < n0 ? list![i] : big[i - n0];
      if (!s.on) continue;
      const h = s.heightAt(x, z);
      if (h === h) { hs[n] = h; hf[n++] = s; } else near = true;
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

  // -------------------------------------------------------------------------------------------------------
  // debug
  // -------------------------------------------------------------------------------------------------------
  /** Append every node position as x,y,z triples (debug drawing, tests). */
  debugNodes(out: number[]): void {
    if (!this.built) return;
    const slots = this.cols * this.rows * LEVELS;
    for (let s = 0; s < slots; s++) {
      const h = this.ny[s];
      if (h === h) out.push(this.slotX(s), h, this.slotZ(s));
    }
  }

  /**
   * Report the nodes as merged strips: every maximal run of east–west neighbours at one height becomes one
   * call `emit(x0, x1, z, y, tight)` (x0..x1 = cell centres of its ends; `tight` = nodes hugging an obstacle
   * or an edge). A flat hall collapses to a few hundred strips instead of ten thousand cells.
   */
  debugStrips(emit: (x0: number, x1: number, z: number, y: number, tight: boolean) => void): void {
    if (!this.built) return;
    const { cols, rows, ny, crowd, cell } = this;
    const runH = new Float64Array(LEVELS), runX = new Int32Array(LEVELS), runT = new Uint8Array(LEVELS);
    const live = new Uint8Array(LEVELS), seen = new Uint8Array(LEVELS);
    for (let iz = 0; iz < rows; iz++) {
      const z = this.minZ + (iz + 0.5) * cell;
      live.fill(0);
      for (let ix = 0; ix <= cols; ix++) {
        seen.fill(0);
        if (ix < cols) {
          const base = (iz * cols + ix) * LEVELS;
          for (let l = 0; l < LEVELS; l++) {
            const h = ny[base + l];
            if (h !== h) break;
            const tight = crowd[base + l];
            let r = -1;
            for (let k = 0; k < LEVELS; k++) if (live[k] && runH[k] === h && runT[k] === tight) { r = k; break; }
            if (r < 0) {
              for (let k = 0; k < LEVELS; k++) if (!live[k] && !seen[k]) { r = k; break; }
              if (r < 0) continue;
              live[r] = 1; runH[r] = h; runX[r] = ix; runT[r] = tight;
            }
            seen[r] = 1;
          }
        }
        for (let k = 0; k < LEVELS; k++) {
          if (!live[k] || seen[k]) continue;
          emit(this.minX + (runX[k] + 0.5) * cell, this.minX + (ix - 0.5) * cell, z, runH[k], runT[k] === 1);
          live[k] = 0;
        }
      }
    }
  }
}
