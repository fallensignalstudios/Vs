/**
 * Navigation grid — nodes keyed by (ix, iz, level) over the walkable surfaces minus solids, 8-neighbour links
 * (no corner cutting), A* + string-pull smoothing.
 *
 * Storage is slot based: every cell owns LEVELS height slots (sorted ascending, NaN = empty), so a balcony over
 * a floor is two nodes in one cell and a door toggle can be re-evaluated for just the cells it touches
 * (`rebuild()` is incremental when only a few colliders/surfaces changed since the last build).
 *
 * Clearance guarantee: a node exists only where an `agentRadius` circle stands clear of solids. The public
 * `walkable()` (and the smoothing) requires all four cell centres around every interior sample to be nodes on
 * the tracked level; the union of their clearance discs covers the agent disc anywhere between them, so a
 * walkable straight line is genuinely free of solids for the agent radius.
 */
import type { NavGrid, NavPath } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import { mulberry32 } from '@/core/mathx';
import { warnOnce } from './shapes';
import { DEF_HEIGHT, DEF_STEP_UP } from './world';
import type { PhysicsCore } from './world';
import { DIR_X, DIR_Z, GridSearch, LEVELS } from './navsearch';
import { stringPull, toNavPath } from './navsmooth';

/** grid cells before the cell size is doubled (keeps the link table ≤ ~20 MB) */
const MAX_CELLS = 160_000;
/** level tolerance when mapping an arbitrary point onto a node of its cell */
const LEVEL_TOL = 0.9;
/** smoothed paths stay within this of the true ground height (keeps waypoints at ramp ends) */
const GROUND_FOLLOW = 0.3;
/** re-snap distance for endpoints stranded in a disconnected pocket, in agent radii (must stay < 2) */
const POCKET_SNAP = 1.9;
/** solid clearance is measured up to this distance (the widest agent radius supported) */
const CLEARANCE_CAP = 3;
const TAU = Math.PI * 2;

export class NavGridImpl implements NavGrid {
  built = false;
  /** bumped on every (re)build — debug drawing keys off it */
  buildId = 0;

  private cell = 0.5;
  private agentRadius = 0.45;
  private minX = 0;
  private minZ = 0;
  private cols = 0;
  private rows = 0;
  private ny = new Float32Array(0);
  private nbr = new Int32Array(0);
  private comp = new Int32Array(0);
  private nodes = 0;
  private builtRevision = -1;
  private readonly search = new GridSearch();
  private readonly pathSlots: number[] = [];
  private readonly heights = new Float64Array(16);
  private queue = new Int32Array(0);
  /** per-node distance to the nearest movement-blocking solid (lazy; valid when clrBuild === buildId) */
  private clr = new Float32Array(0);
  private clrBuild = -1;
  /** clearance every node touched by the current query must have (0 = default agent) */
  private need = 0;

  constructor(private readonly core: PhysicsCore) {
    core.onClear = () => this.reset();
  }

  get stale(): boolean { return this.built && this.builtRevision !== this.core.revision; }
  get nodeCount(): number { return this.nodes; }
  get cellSize(): number { return this.cell; }

  private reset(): void {
    this.built = false;
    this.cols = 0; this.rows = 0; this.nodes = 0;
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

    if (!incremental) {
      this.cell = cell; this.agentRadius = agentRadius;
      this.minX = ox; this.minZ = oz; this.cols = cols; this.rows = rows;
      const slots = cols * rows * LEVELS;
      if (this.ny.length !== slots) {
        this.ny = new Float32Array(slots);
        this.nbr = new Int32Array(slots * 8);
        this.comp = new Int32Array(slots);
        this.queue = new Int32Array(slots);
      }
      this.search.resize(slots);
      for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < cols; ix++) this.computeCell(ix, iz);
      for (let iz = 0; iz < rows; iz++) for (let ix = 0; ix < cols; ix++) this.linkCell(ix, iz);
    } else {
      const inv = 1 / cell;
      const pad = agentRadius + cell;
      for (let i = 0; i < dirty.length; i += 4) {
        const x0 = Math.max(0, Math.floor((dirty[i] - pad - ox) * inv));
        const z0 = Math.max(0, Math.floor((dirty[i + 1] - pad - oz) * inv));
        const x1 = Math.min(cols - 1, Math.floor((dirty[i + 2] + pad - ox) * inv));
        const z1 = Math.min(rows - 1, Math.floor((dirty[i + 3] + pad - oz) * inv));
        for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) this.computeCell(ix, iz);
        const lx0 = Math.max(0, x0 - 1), lz0 = Math.max(0, z0 - 1);
        const lx1 = Math.min(cols - 1, x1 + 1), lz1 = Math.min(rows - 1, z1 + 1);
        for (let iz = lz0; iz <= lz1; iz++) for (let ix = lx0; ix <= lx1; ix++) this.linkCell(ix, iz);
      }
    }
    this.labelComponents();

    dirty.length = 0;
    core.navDirtyAll = false;
    core.navTracking = true;
    this.built = true;
    this.builtRevision = core.revision;
    this.buildId++;
  }

  /** Evaluate the height slots of one cell: stable surface levels where the agent circle stands clear. */
  private computeCell(ix: number, iz: number): void {
    const core = this.core;
    const x = this.minX + (ix + 0.5) * this.cell, z = this.minZ + (iz + 0.5) * this.cell;
    const hs = this.heights;
    let n = 0;
    const list = core.surfaceHash.cellAt(x, z);
    if (list) {
      for (let i = 0; i < list.length && n < 16; i++) {
        const s = list[i];
        if (!s.on) continue;
        const h = s.heightAt(x, z);
        if (h === h) hs[n++] = h;
      }
    }
    const big = core.surfaceHash.big;
    for (let i = 0; i < big.length && n < 16; i++) {
      const s = big[i];
      if (!s.on) continue;
      const h = s.heightAt(x, z);
      if (h === h) hs[n++] = h;
    }
    // insertion sort ascending
    for (let i = 1; i < n; i++) {
      const v = hs[i];
      let j = i - 1;
      while (j >= 0 && hs[j] > v) { hs[j + 1] = hs[j]; j--; }
      hs[j + 1] = v;
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
      if (used === LEVELS) { warnOnce('nav-levels', `more than ${LEVELS} walkable levels in one nav cell; extra levels ignored`); break; }
      ny[base + used++] = h;
    }
    for (let i = used; i < LEVELS; i++) ny[base + i] = NaN;
  }

  /** Slot of cell (ix,iz) whose height is closest to y within tol, or -1. */
  private findSlot(ix: number, iz: number, y: number, tol: number): number {
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

  /** findSlot restricted to nodes wide enough for the current query. */
  private wideSlot(ix: number, iz: number, y: number, tol: number): number {
    const s = this.findSlot(ix, iz, y, tol);
    return s >= 0 && this.need > 0 && this.clr[s] < this.need ? -1 : s;
  }

  /** Fill the per-node solid clearance (exact distance from each node centre, capped at CLEARANCE_CAP). */
  private ensureClearance(): void {
    if (this.clrBuild === this.buildId) return;
    const slots = this.cols * this.rows * LEVELS;
    if (this.clr.length !== slots) this.clr = new Float32Array(slots);
    const ny = this.ny, clr = this.clr, core = this.core;
    for (let s = 0; s < slots; s++) {
      const h = ny[s];
      clr[s] = h === h ? core.solidDistance(this.slotX(s), this.slotZ(s), h, CLEARANCE_CAP, DEF_STEP_UP, DEF_HEIGHT) : 0;
    }
    this.clrBuild = this.buildId;
  }

  private linkCell(ix: number, iz: number): void {
    const base = (iz * this.cols + ix) * LEVELS;
    const ny = this.ny, nbr = this.nbr;
    const tol = DEF_STEP_UP + 1e-4;
    for (let l = 0; l < LEVELS; l++) {
      const slot = base + l;
      const o = slot * 8;
      const y = ny[slot];
      if (y !== y) { for (let d = 0; d < 8; d++) nbr[o + d] = -1; continue; }
      for (let d = 0; d < 4; d++) nbr[o + d] = this.findSlot(ix + DIR_X[d], iz + DIR_Z[d], y, tol);
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
      }
    }
  }

  private labelComponents(): void {
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

  private ensure(): boolean {
    if (!this.built) {
      if (this.core.surfaces.length === 0) return false;
      this.rebuild();
    }
    return this.cols > 0;
  }

  // -------------------------------------------------------------------------------------------------------
  // point ↔ node mapping
  // -------------------------------------------------------------------------------------------------------
  private slotX(slot: number): number {
    return this.minX + ((((slot / LEVELS) | 0) % this.cols) + 0.5) * this.cell;
  }

  private slotZ(slot: number): number {
    return this.minZ + (((((slot / LEVELS) | 0) / this.cols) | 0) + 0.5) * this.cell;
  }

  /** Node of the cell containing (x,z) at the level of y, or -1. */
  private slotAt(x: number, y: number, z: number, tol: number): number {
    const inv = 1 / this.cell;
    return this.findSlot(Math.floor((x - this.minX) * inv), Math.floor((z - this.minZ) * inv), y, tol);
  }

  /**
   * Nearest node to a point, preferring the point's own level. -1 when none within maxDist.
   * `comp` ≥ 0 restricts the search to one connected component.
   */
  private nodeNear(x: number, y: number, z: number, maxDist: number, comp = -1): number {
    const here = this.slotAt(x, y, z, LEVEL_TOL);
    const need = this.need, clr = this.clr, comps = this.comp;
    if (here >= 0 && (need <= 0 || clr[here] >= need) && (comp < 0 || comps[here] === comp)) return here;
    const inv = 1 / this.cell;
    const cx = Math.floor((x - this.minX) * inv), cz = Math.floor((z - this.minZ) * inv);
    const R = Math.ceil(maxDist * inv);
    const ny = this.ny, cols = this.cols, rows = this.rows;
    const max2 = maxDist * maxDist;
    for (let pass = 0; pass < 2; pass++) {
      const dyLimit = pass === 0 ? 2 : Infinity;
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
              if (dy > dyLimit || (need > 0 && clr[base + l] < need) || (comp >= 0 && comps[base + l] !== comp)) continue;
              const score = d2 + dy * dy * 2.25;
              if (score < bestD) { bestD = score; best = base + l; }
            }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // -------------------------------------------------------------------------------------------------------
  // straight-line tests
  // -------------------------------------------------------------------------------------------------------
  /**
   * Walk a straight line over the grid on the level of `ay`. Returns the level height reached at b, or NaN
   * when the line leaves nav. Interior samples need all four surrounding cell centres to be nodes (see file
   * header); samples within one cell of either end only need their own cell. `follow` additionally requires
   * the ground to stay within GROUND_FOLLOW of the straight a→b height (used by path smoothing).
   */
  private lineWalk(ax: number, ay: number, az: number, bx: number, by: number, bz: number, follow: boolean): number {
    const cell = this.cell, inv = 1 / cell;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / (cell * 0.5)));
    const ny = this.ny;
    const tol = DEF_STEP_UP + 0.05;
    let cur = ay;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + dx * t, z = az + dz * t;
      const dA = len * t, dB = len - dA;
      let h: number;
      if (dA < cell || dB < cell) {
        const s = this.wideSlot(Math.floor((x - this.minX) * inv), Math.floor((z - this.minZ) * inv), cur, i === 0 ? LEVEL_TOL : tol);
        if (s < 0) return NaN;
        h = ny[s];
      } else {
        const u = (x - this.minX) * inv - 0.5, v = (z - this.minZ) * inv - 0.5;
        const ix = Math.floor(u), iz = Math.floor(v);
        const s00 = this.wideSlot(ix, iz, cur, tol);
        if (s00 < 0) return NaN;
        const s10 = this.wideSlot(ix + 1, iz, cur, tol);
        if (s10 < 0) return NaN;
        const s01 = this.wideSlot(ix, iz + 1, cur, tol);
        if (s01 < 0) return NaN;
        const s11 = this.wideSlot(ix + 1, iz + 1, cur, tol);
        if (s11 < 0) return NaN;
        const fu = u - ix, fv = v - iz;
        h = (ny[s00] * (1 - fu) + ny[s10] * fu) * (1 - fv) + (ny[s01] * (1 - fu) + ny[s11] * fu) * fv;
      }
      if (follow && Math.abs(h - (ay + (by - ay) * t)) > GROUND_FOLLOW) return NaN;
      cur = h;
    }
    return cur;
  }

  walkable(a: Vec3Like, b: Vec3Like): boolean {
    return this.straight(a, b, 0);
  }

  walkableFor(a: Vec3Like, b: Vec3Like, radius: number): boolean {
    return this.straight(a, b, radius);
  }

  /** Arm the clearance requirement for an agent radius (0 for the default agent). False when unbuildable. */
  private begin(radius: number): boolean {
    this.need = 0;
    if (!this.ensure()) return false;
    if (radius > this.agentRadius) {
      this.ensureClearance();
      this.need = Math.min(radius, CLEARANCE_CAP);
    }
    return true;
  }

  private straight(a: Vec3Like, b: Vec3Like, radius: number): boolean {
    if (!a || !b || !Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z) || !this.begin(radius)) return false;
    let ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    let ok = false;
    let s = this.slotAt(ax, ay, az, LEVEL_TOL);
    if (s < 0 || (this.need > 0 && this.clr[s] < this.need)) {
      s = this.nodeNear(ax, ay, az, 1);
      if (s >= 0) { ax = this.slotX(s); az = this.slotZ(s); }
    }
    let e = this.slotAt(bx, by, bz, LEVEL_TOL);
    if (e < 0 || (this.need > 0 && this.clr[e] < this.need)) {
      e = this.nodeNear(bx, by, bz, 1);
      if (e >= 0) { bx = this.slotX(e); bz = this.slotZ(e); }
    }
    if (s >= 0 && e >= 0) {
      ay = this.ny[s]; by = this.ny[e];
      const end = this.lineWalk(ax, ay, az, bx, by, bz, false);
      ok = end === end && Math.abs(end - by) <= DEF_STEP_UP;
    }
    this.need = 0;
    return ok;
  }

  clearance(x: number, y: number, z: number): number {
    if (!Number.isFinite(x + y + z) || !this.ensure()) return 0;
    const s = this.slotAt(x, y, z, LEVEL_TOL);
    if (s < 0) return 0;
    return this.core.solidDistance(x, z, this.ny[s], CLEARANCE_CAP, DEF_STEP_UP, DEF_HEIGHT);
  }

  isWalkable(x: number, y: number, z: number): boolean {
    if (!Number.isFinite(x + y + z) || !this.ensure()) return false;
    return this.slotAt(x, y, z, LEVEL_TOL) >= 0;
  }

  nearest(x: number, y: number, z: number, maxDist = 4): Vec3Like | null {
    if (!Number.isFinite(x + y + z) || !this.ensure()) return null;
    const s = this.nodeNear(x, y, z, maxDist > 0 ? Math.min(maxDist, 64) : 0);
    if (s < 0) return null;
    const h = this.ny[s];
    if (s === this.slotAt(x, y, z, LEVEL_TOL)) return { x, y: this.groundNear(x, z, h), z };
    return { x: this.slotX(s), y: h, z: this.slotZ(s) };
  }

  /** exact ground height at (x,z) near a node height (ramps), falling back to the node height */
  private groundNear(x: number, z: number, h: number): number {
    const g = this.core.groundY(x, z, h, DEF_STEP_UP);
    return g === g && Math.abs(g - h) <= DEF_STEP_UP ? g : h;
  }

  randomPoint(center: Vec3Like, radius: number, seed: number): Vec3Like | null {
    if (!center || !Number.isFinite(center.x + center.y + center.z) || !this.ensure()) return null;
    const r = radius > 0 ? radius : 0;
    const c = this.nodeNear(center.x, center.y, center.z, Math.max(2, r));
    if (c < 0) return null;
    const cy = this.ny[c];
    const rng = mulberry32((Number.isFinite(seed) ? Math.floor(seed) : 0) ^ 0x9e3779b9);
    const inv = 1 / this.cell;
    for (let i = 0; i < 32; i++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * r;
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      const s = this.findSlot(Math.floor((x - this.minX) * inv), Math.floor((z - this.minZ) * inv), cy, 4);
      if (s >= 0 && this.comp[s] === this.comp[c]) return { x: this.slotX(s), y: this.ny[s], z: this.slotZ(s) };
    }
    return { x: this.slotX(c), y: cy, z: this.slotZ(c) };
  }

  // -------------------------------------------------------------------------------------------------------
  // path finding
  // -------------------------------------------------------------------------------------------------------
  findPath(from: Vec3Like, to: Vec3Like): NavPath | null {
    return this.route(from, to, 0);
  }

  findPathFor(from: Vec3Like, to: Vec3Like, radius: number): NavPath | null {
    return this.route(from, to, radius);
  }

  private route(from: Vec3Like, to: Vec3Like, radius: number): NavPath | null {
    if (!from || !to || !Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z) || !this.begin(radius)) return null;
    const path = this.solve(from, to);
    this.need = 0;
    return path;
  }

  private solve(from: Vec3Like, to: Vec3Like): NavPath | null {
    const wide = this.need > 0;
    let s = this.nodeNear(from.x, from.y, from.z, wide ? 3 + this.need : 3);
    let t = this.nodeNear(to.x, to.y, to.z, wide ? 3 + this.need : 3);
    if (s < 0 || t < 0) return null;
    if (this.comp[s] !== this.comp[t]) {
      // An endpoint that snapped into a stray pocket (a marker nudged inside dressing, an actor shoved into a
      // nook) may still have connected nav within arm's reach. The reach is below the node spacing across any
      // solid (2 · agentRadius + thickness), so this never bridges a wall or a closed door.
      const reach = Math.min(0.85, this.agentRadius * POCKET_SNAP);
      const t2 = this.nodeNear(to.x, to.y, to.z, reach, this.comp[s]);
      if (t2 >= 0) t = t2;
      else {
        const s2 = this.nodeNear(from.x, from.y, from.z, reach, this.comp[t]);
        if (s2 < 0) return null;
        s = s2;
      }
    }
    const slots = this.pathSlots;
    if (!this.search.run(s, t, this.nbr, this.cols, this.cell, slots, wide ? this.clr : null, this.need)) return null;

    const ny = this.ny;
    const px: number[] = [], py: number[] = [], pz: number[] = [];
    px.push(from.x); pz.push(from.z);
    py.push(this.slotAt(from.x, from.y, from.z, LEVEL_TOL) >= 0 ? this.groundNear(from.x, from.z, ny[s]) : from.y);
    for (let i = 0; i < slots.length; i++) {
      px.push(this.slotX(slots[i])); py.push(ny[slots[i]]); pz.push(this.slotZ(slots[i]));
    }
    if (this.slotAt(to.x, to.y, to.z, LEVEL_TOL) === t) {
      px.push(to.x); py.push(this.groundNear(to.x, to.z, ny[t])); pz.push(to.z);
    }
    stringPull(px, py, pz, (i, j) => this.visible(px, py, pz, i, j));
    return toNavPath(px, py, pz);
  }

  private visible(px: number[], py: number[], pz: number[], i: number, j: number): boolean {
    const end = this.lineWalk(px[i], py[i], pz[i], px[j], py[j], pz[j], true);
    if (end === end && Math.abs(end - py[j]) <= DEF_STEP_UP) return true;
    // One-node-wide corridors can never pass the four-centre test; a run of path nodes that is already a
    // straight grid line (constant step, constant slope) is still safe to collapse.
    if (j - i < 2) return false;
    let sx = NaN, sz = 0;
    const span = j - i;
    for (let k = i + 1; k <= j; k++) {
      const dx = px[k] - px[k - 1], dz = pz[k] - pz[k - 1];
      if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) continue; // duplicate point (start on a node centre)
      if (sx !== sx) { sx = dx; sz = dz; }
      else if (Math.abs(dx - sx) > 1e-6 || Math.abs(dz - sz) > 1e-6) return false;
      if (Math.abs(py[k] - (py[i] + ((py[j] - py[i]) * (k - i)) / span)) > GROUND_FOLLOW) return false;
    }
    return sx === sx;
  }

  /** Append every node position as x,y,z triples (debug drawing). */
  debugNodes(out: number[]): void {
    if (!this.built) return;
    const slots = this.cols * this.rows * LEVELS;
    for (let s = 0; s < slots; s++) {
      const h = this.ny[s];
      if (h === h) out.push(this.slotX(s), h, this.slotZ(s));
    }
  }
}
