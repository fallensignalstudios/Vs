/**
 * Navigation queries over the grid built in navgrid.ts: straight-line tests, point queries, and A* paths with
 * string-pull smoothing.
 *
 * Straight lines (`walkable`, smoothing) need all four cell centres around every sample to be mutually linked
 * nodes on the tracked level; the union of their clearance discs covers the agent disc anywhere between them.
 * Next to an endpoint, where that test is too coarse, the hop is swept exactly instead (`sweepTo`: the same
 * ground / headroom / ledge / solid rules as movement, sampled finer than the narrowest crack).
 */
import type { NavGrid, NavPath } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import { mulberry32 } from '@/core/mathx';
import { DEF_HEIGHT, DEF_STEP_UP } from './world';
import { LEVELS } from './navsearch';
import { stringPull, toNavPath } from './navsmooth';
import { CLEARANCE_CAP, GROUND_FOLLOW, LEVEL_TOL, NavGridBase } from './navgrid';

/** re-snap distance for endpoints stranded in a disconnected pocket, in agent radii (must stay < 2) */
const POCKET_SNAP = 1.9;
/**
 * How far a big agent's endpoint may be moved ON ITS OWN LEVEL before another level is considered: a body
 * that stands where it does not fit is put beside the obstacle, not on the balcony above it.
 */
const SAME_LEVEL_SNAP = 12;
const TAU = Math.PI * 2;
const E = 0, S = 2;

export class NavGridImpl extends NavGridBase implements NavGrid {
  // -------------------------------------------------------------------------------------------------------
  // straight-line tests
  // -------------------------------------------------------------------------------------------------------
  /**
   * Interpolated level height at (x,z) when the four cell centres around it are mutually linked, fitting
   * nodes on the level of `cur`; NaN otherwise.
   */
  private quad(x: number, z: number, cur: number, tol: number): number {
    const inv = 1 / this.cell;
    const u = (x - this.minX) * inv - 0.5, v = (z - this.minZ) * inv - 0.5;
    const ix = Math.floor(u), iz = Math.floor(v);
    const s00 = this.fitSlot(ix, iz, cur, tol);
    if (s00 < 0) return NaN;
    const s10 = this.fitSlot(ix + 1, iz, cur, tol);
    if (s10 < 0) return NaN;
    const s01 = this.fitSlot(ix, iz + 1, cur, tol);
    if (s01 < 0) return NaN;
    const s11 = this.fitSlot(ix + 1, iz + 1, cur, tol);
    if (s11 < 0) return NaN;
    const nbr = this.nbr, ny = this.ny;
    if (nbr[s00 * 8 + E] !== s10 || nbr[s00 * 8 + S] !== s01 || nbr[s10 * 8 + S] !== s11 || nbr[s01 * 8 + E] !== s11) return NaN;
    const fu = u - ix, fv = v - iz;
    return (ny[s00] * (1 - fu) + ny[s10] * fu) * (1 - fv) + (ny[s01] * (1 - fu) + ny[s11] * fu) * fv;
  }

  /**
   * Walk a straight line over the grid on the level of `ay`. Returns the level height reached at b, or NaN
   * when the line leaves nav. Every sample must pass the four-centre test (see `quad`); within one cell of an
   * end, where that test is too coarse, the hops on either side of the sample are swept exactly instead.
   * `lenient` relaxes that at the START only, to "its own cell holds a node": a path begins wherever the
   * caller happens to be, even where the agent could not stand. `follow` additionally requires the ground to
   * stay within GROUND_FOLLOW of the straight a→b height (used by path smoothing).
   */
  private lineWalk(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, follow: boolean, lenient: boolean,
  ): number {
    const cell = this.cell, inv = 1 / cell;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / (cell * 0.5)));
    const tol = DEF_STEP_UP + 0.05;
    let cur = ay, px = ax, pz = az;
    /** how the previous sample was accepted: 0 four-centre test, 1 exact test, 2 lenient start */
    let prev = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + dx * t, z = az + dz * t;
      const lt = i === 0 ? LEVEL_TOL : tol;
      let h = this.quad(x, z, cur, lt);
      let how = 0;
      if (h !== h) {
        const dA = len * t, dB = len - dA;
        if (dA >= cell && dB >= cell) return NaN;
        if (lenient && dA < cell) {
          const s = this.fitSlot(Math.floor((x - this.minX) * inv), Math.floor((z - this.minZ) * inv), cur, lt);
          if (s < 0) return NaN;
          h = this.ny[s];
          how = 2;
        } else how = 1;
      }
      if (i === 0) {
        if (how === 1) { h = this.exactAt(x, cur, z, lt); if (h !== h) return NaN; }
      } else if (how === 1 || prev === 1) {
        // the four-centre test does not vouch for this hop: sweep it (only a lenient start is left unjudged)
        const g = this.sweepTo(px, cur, pz, x, z, prev === 2, NaN, NaN);
        if (g !== g) return NaN;
        if (how === 1) h = g;
      }
      if (follow && Math.abs(h - (ay + (by - ay) * t)) > GROUND_FOLLOW) return NaN;
      cur = h; px = x; pz = z; prev = how;
    }
    return cur;
  }

  /** sweepTo as a yes / no test of the straight leg a → b (which must also end on the level of b). */
  private sweep(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, skipStart: boolean,
  ): boolean {
    const g = this.sweepTo(ax, ay, az, bx, bz, skipStart, ay, by);
    return g === g && Math.abs(g - by) <= DEF_STEP_UP;
  }

  walkable(a: Vec3Like, b: Vec3Like): boolean {
    return this.straight(a, b, 0, 0);
  }

  walkableFor(a: Vec3Like, b: Vec3Like, radius: number, height = 0): boolean {
    return this.straight(a, b, radius, height);
  }

  warm(radius: number, height = 0): void {
    if (!(radius > 0) || !this.begin(radius, height) || this.fit === null) return;
    const ny = this.ny, slots = this.cols * this.rows * LEVELS;
    for (let s = 0; s < slots; s++) if (ny[s] === ny[s]) this.passes(s);
    this.fit = null;
  }

  private straight(a: Vec3Like, b: Vec3Like, radius: number, height: number): boolean {
    if (!a || !b || !Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z) || !this.begin(radius, height)) return false;
    let ax = a.x, ay = this.exactAt(a.x, a.y, a.z, LEVEL_TOL), az = a.z;
    let bx = b.x, by = this.exactAt(b.x, b.y, b.z, LEVEL_TOL), bz = b.z;
    let ok = true;
    // an endpoint the agent cannot stand on exactly is replaced by the nearest node within a metre
    if (ay !== ay) {
      const s = this.nodeNear(a.x, a.y, a.z, 1);
      if (s >= 0) { ax = this.slotX(s); az = this.slotZ(s); ay = this.ny[s]; } else ok = false;
    }
    if (ok && by !== by) {
      const e = this.nodeNear(b.x, b.y, b.z, 1);
      if (e >= 0) { bx = this.slotX(e); bz = this.slotZ(e); by = this.ny[e]; } else ok = false;
    }
    if (ok) {
      const end = this.lineWalk(ax, ay, az, bx, by, bz, false, false);
      ok = end === end && Math.abs(end - by) <= DEF_STEP_UP;
    }
    this.fit = null;
    return ok;
  }

  clearance(x: number, y: number, z: number, height = DEF_HEIGHT): number {
    this.fit = null;
    if (!Number.isFinite(x + y + z) || !this.ensure()) return 0;
    const s = this.slotAt(x, y, z, LEVEL_TOL);
    if (s < 0) return 0;
    return this.core.solidDistance(x, z, this.ny[s], CLEARANCE_CAP, DEF_STEP_UP, height > DEF_HEIGHT ? height : DEF_HEIGHT);
  }

  isWalkable(x: number, y: number, z: number): boolean {
    this.fit = null;
    if (!Number.isFinite(x + y + z) || !this.ensure()) return false;
    const g = this.exactAt(x, y, z, LEVEL_TOL);
    return g === g;
  }

  nearest(x: number, y: number, z: number, maxDist = 4): Vec3Like | null {
    this.fit = null;
    if (!Number.isFinite(x + y + z) || !this.ensure()) return null;
    const s = this.nodeNear(x, y, z, maxDist > 0 ? Math.min(maxDist, 64) : 0);
    if (s < 0) return null;
    const h = this.ny[s];
    if (s === this.slotAt(x, y, z, LEVEL_TOL)) {
      const g = this.standAt(x, z, h);
      if (g === g) return { x, y: g, z };
    }
    return { x: this.slotX(s), y: h, z: this.slotZ(s) };
  }

  /** exact ground height at (x,z) near a node height (ramps), falling back to the node height */
  private groundNear(x: number, z: number, h: number): number {
    const g = this.core.groundY(x, z, h, DEF_STEP_UP);
    return g === g && Math.abs(g - h) <= DEF_STEP_UP ? g : h;
  }

  randomPoint(center: Vec3Like, radius: number, seed: number): Vec3Like | null {
    this.fit = null;
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
    return this.route(from, to, 0, 0);
  }

  findPathFor(from: Vec3Like, to: Vec3Like, radius: number, height = 0): NavPath | null {
    return this.route(from, to, radius, height);
  }

  private route(from: Vec3Like, to: Vec3Like, radius: number, height: number): NavPath | null {
    if (!from || !to || !Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z) || !this.begin(radius, height)) return null;
    const path = this.solve(from, to);
    this.fit = null;
    return path;
  }

  private solve(from: Vec3Like, to: Vec3Like): NavPath | null {
    const fit = this.fit;
    const slots = this.pathSlots;
    const search = this.search;
    let s: number, t: number;
    if (fit === null) {
      s = this.nodeNear(from.x, from.y, from.z, 3);
      t = this.nodeNear(to.x, to.y, to.z, 3);
      if (s < 0 || t < 0) return null;
      if (this.comp[s] !== this.comp[t]) {
        // An endpoint that snapped into a stray pocket (a marker nudged inside dressing, an actor shoved into
        // a nook) may still have connected nav within arm's reach. The reach is below the node spacing across
        // any solid (2 · agentRadius + thickness), so this never bridges a wall or a closed door.
        const reach = Math.min(0.85, this.agentRadius * POCKET_SNAP);
        const t2 = this.nodeNear(to.x, to.y, to.z, reach, this.comp[s]);
        if (t2 >= 0) t = t2;
        else {
          const s2 = this.nodeNear(from.x, from.y, from.z, reach, this.comp[t]);
          if (s2 < 0) return null;
          s = s2;
        }
      }
      const found = search.run(s, t, this.nbr, this.cols, this.cell, slots, null, this.crowd);
      this.stats.lastSearchExpanded = search.expanded;
      if (!found) return null;
    } else {
      // Where an ordinary agent would start and end up: the big body's own endpoints are the nearest nodes it
      // fits on in those same connected areas (never one behind a wall), looked for on the same level first.
      this.fit = null;
      const s0 = this.nodeNear(from.x, from.y, from.z, 3);
      const t0 = this.nodeNear(to.x, to.y, to.z, 3);
      this.fit = fit;
      const snap = 3 + fit.radius;
      s = this.nodeNear(from.x, from.y, from.z, snap, s0 >= 0 ? this.comp[s0] : -1, Math.max(snap, SAME_LEVEL_SNAP));
      if (s < 0) return null;
      t = this.nodeNear(to.x, to.y, to.z, snap, t0 >= 0 ? this.comp[t0] : -1);
      const inv = 1 / this.cell;
      const refX = (to.x - this.minX) * inv - 0.5, refZ = (to.z - this.minZ) * inv - 0.5;
      const refY = t0 >= 0 ? this.ny[t0] : to.y;
      // the nearest node that fits, when it is on the goal's own level and in the area the body is in
      const direct = t >= 0 && this.comp[t] === this.comp[s] && Math.abs(this.ny[t] - refY) <= 2;
      const found = direct
        && search.run(s, t, this.nbr, this.cols, this.cell, slots, this.pass, this.crowd, this.ny, refX, refZ, refY, this.passLink);
      this.stats.lastSearchExpanded = direct ? search.expanded : 0;
      if (!found) {
        // The goal is somewhere this body cannot go (under a balcony, down a corridor narrower than itself):
        // end at the place nearest to it that the body CAN reach — but only when an ordinary agent could
        // have walked there from here, so a sealed room stays unreachable.
        if (t0 < 0 || this.comp[t0] !== this.comp[s] || this.passes(t0)) return null;
        if (!direct) {
          search.run(s, t0, this.nbr, this.cols, this.cell, slots, this.pass, this.crowd, this.ny, refX, refZ, refY, this.passLink);
          this.stats.lastSearchExpanded = search.expanded;
        }
        if (search.nearest < 0) return null;
        t = search.nearest;
        search.trace(t, slots);
      }
    }

    const ny = this.ny;
    const px: number[] = [], py: number[] = [], pz: number[] = [];
    px.push(from.x); pz.push(from.z);
    py.push(this.slotAt(from.x, from.y, from.z, LEVEL_TOL) >= 0 ? this.groundNear(from.x, from.z, ny[s]) : from.y);
    for (let i = 0; i < slots.length; i++) {
      px.push(this.slotX(slots[i])); py.push(ny[slots[i]]); pz.push(this.slotZ(slots[i]));
    }
    // the goal itself only when the agent can stand exactly there and step to it from the last node;
    // otherwise the path ends on that node
    const g = this.standAt(to.x, to.z, ny[t]);
    if (g === g && this.sweep(this.slotX(t), ny[t], this.slotZ(t), to.x, g, to.z, false)) {
      px.push(to.x); py.push(g); pz.push(to.z);
    }
    // the first leg starts wherever the caller is; it is only exempt from the exact test when the agent could
    // not stand there in the first place (a body pressed against a wall, a start inside the ledge margin)
    const stuck = this.exactAt(from.x, from.y, from.z, LEVEL_TOL);
    const lenient = stuck !== stuck;
    stringPull(px, py, pz, (i, j) => this.visible(px, py, pz, i, j, lenient));
    this.tighten(px, py, pz);
    return toNavPath(px, py, pz);
  }

  private visible(px: number[], py: number[], pz: number[], i: number, j: number, lenient: boolean): boolean {
    const end = this.lineWalk(px[i], py[i], pz[i], px[j], py[j], pz[j], true, lenient && i === 0);
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

  /**
   * The grid visibility test is conservative, which can leave a short hook next to either end (node centre →
   * exact goal) or a needless bend in a path that is really one straight walk. Remove those with the exact
   * swept test.
   */
  private tighten(px: number[], py: number[], pz: number[]): void {
    const cut = (k: number): void => { px.splice(k, 1); py.splice(k, 1); pz.splice(k, 1); };
    let n = px.length;
    if (n < 3) return;
    const walk = (i: number, j: number): boolean => this.sweep(px[i], py[i], pz[i], px[j], py[j], pz[j], i === 0);
    if (n <= 4 && walk(0, n - 1)) { px.splice(1, n - 2); py.splice(1, n - 2); pz.splice(1, n - 2); return; }
    if (walk(n - 3, n - 1)) { cut(n - 2); n--; }
    if (n >= 3 && walk(0, 2)) cut(1);
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
            const tight = crowd[base + l] !== 0 ? 1 : 0; // beside an obstacle / edge, or with a cut link
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
