/**
 * Authoring checks for an assembled zone (`PhysicsWorld.validate()`): the mistakes that do not crash and do
 * not look wrong in the editor, but make a level misbehave quietly — a void strip between floor modules, a
 * crate everybody walks through, a catwalk nobody can use, a ramp with a typo for a height.
 */
import type { PhysicsIssue } from '@/core/api/physics';
import { RAY_MOVE } from '@/core/api/physics';
import { GAP_TOL } from './shapes';
import type { SurfaceRec } from './shapes';
import { DEF_MAX_DROP, DEF_STEP_UP, edgeMarginFor } from './world';
import type { PhysicsCore } from './world';

/** boundary sampling interval (metres) and cap per surface */
const EDGE_STEP = 0.5;
const MAX_EDGE_SAMPLES = 400;
/** a void strip wider than this is a deliberate ledge, not a mis-laid module */
const GAP_MAX = 0.5;
/** issues reported per kind before the rest is summarised */
const MAX_PER_KIND = 40;

const label = (tag: string | undefined, id: number): string => (tag ? `"${tag}"` : `#${id}`);

/** Visit points on the boundary of a surface with the outward direction there. */
function eachEdgePoint(s: SurfaceRec, visit: (x: number, z: number, nx: number, nz: number) => void): void {
  if (s.isDisc) {
    for (const [rad, sign] of [[s.r, 1], [s.inner, -1]] as const) {
      if (rad <= 0) continue;
      const n = Math.min(MAX_EDGE_SAMPLES, Math.max(8, Math.ceil((Math.PI * 2 * rad) / EDGE_STEP)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        visit(s.cx + c * rad, s.cz + sn * rad, c * sign, sn * sign);
      }
    }
    return;
  }
  // local frame: X = (cos, −sin), Z = (sin, cos)
  const side = (lx0: number, lz0: number, lx1: number, lz1: number, nlx: number, nlz: number): void => {
    const len = Math.hypot(lx1 - lx0, lz1 - lz0);
    const n = Math.min(MAX_EDGE_SAMPLES / 4, Math.max(1, Math.ceil(len / EDGE_STEP)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const lx = lx0 + (lx1 - lx0) * t, lz = lz0 + (lz1 - lz0) * t;
      visit(
        s.cx + lx * s.cos + lz * s.sin, s.cz - lx * s.sin + lz * s.cos,
        nlx * s.cos + nlz * s.sin, -nlx * s.sin + nlz * s.cos,
      );
    }
  };
  side(-s.hx, -s.hz, s.hx, -s.hz, 0, -1);
  side(s.hx, -s.hz, s.hx, s.hz, 1, 0);
  side(s.hx, s.hz, -s.hx, s.hz, 0, 1);
  side(-s.hx, s.hz, -s.hx, -s.hz, -1, 0);
}

export function validate(core: PhysicsCore): PhysicsIssue[] {
  const out: PhysicsIssue[] = [];
  const counts: Record<string, number> = {};
  const add = (kind: PhysicsIssue['kind'], x: number, y: number, z: number, message: string): void => {
    const n = counts[kind] = (counts[kind] ?? 0) + 1;
    if (n <= MAX_PER_KIND) out.push({ kind, x, y, z, message });
  };

  // ---- surfaces: void strips, unusable widths, implausible slopes ------------------------------------------
  const pairs = new Set<number>();
  const human = edgeMarginFor(0.4);
  for (const s of core.surfaces) {
    if (!s.on) continue;
    const name = label(s.desc.tag, s.id);
    if (s.ramp && Math.abs(s.k) > 1) {
      add('steep', s.cx, s.yMid, s.cz, `ramp ${name} rises ${Math.abs(s.yHi - s.yLo).toFixed(2)} m over ${(2 * s.hz).toFixed(2)} m (steeper than 45°): check y / y1`);
    }
    // free width: can a human-sized body stand on its middle at all?
    const mx = s.isDisc ? s.cx + (s.inner + s.r) * 0.5 : s.cx, mz = s.cz;
    const width = s.isDisc ? s.r - s.inner : 2 * Math.min(s.hx, s.hz);
    if (width < 2 * human + 0.1) {
      const h = s.heightAt(mx, mz);
      if (h === h && core.groundY(mx, mz, h, 1e-3) === h && core.lastSurface === s
        && !core.ledgeOk(mx, mz, h, s, human, DEF_STEP_UP, DEF_MAX_DROP)) {
        add('narrow', mx, h, mz, `surface ${name} is ${width.toFixed(2)} m wide: too narrow to walk with the ${human} m ledge margin (needs > ${(2 * human).toFixed(1)} m)`);
      }
    }
    eachEdgePoint(s, (x, z, nx, nz) => {
      const h = s.heightNear(x, z);
      // nothing just past the edge (so the crack is not closed) …
      const d0 = GAP_TOL + 0.03;
      const g0 = core.groundY(x + nx * d0, z + nz * d0, h, DEF_STEP_UP);
      if (g0 === g0 && h - g0 <= DEF_STEP_UP) return;
      // … yet floor at the same level a little further out: a void strip
      for (let d = d0 + 0.05; d <= GAP_MAX + GAP_TOL; d += 0.05) {
        const g = core.groundY(x + nx * d, z + nz * d, h, DEF_STEP_UP);
        if (g !== g || h - g > DEF_STEP_UP) continue;
        const other = core.lastSurface;
        if (!other || other === s) return;
        const key = Math.min(s.id, other.id) * 0x100000 + Math.max(s.id, other.id);
        if (pairs.has(key)) return;
        pairs.add(key);
        const gap = other.outside(x, z);
        add('gap', x + nx * gap * 0.5, h, z + nz * gap * 0.5,
          `${gap.toFixed(2)} m void between surfaces ${name} and ${label(other.desc.tag, other.id)}: wider than the ${GAP_TOL} m crack tolerance, nobody can cross (close it or overlap them)`);
        return;
      }
    });
  }

  // ---- solids: low blockers without a top ------------------------------------------------------------------
  for (const c of core.colliders) {
    if (!c.on || !(c.mask & RAY_MOVE)) continue;
    // the floor it stands on: the highest level at or just above its underside
    const base = core.groundY(c.cx, c.cz, c.yMin, 0.3);
    if (base !== base) continue;
    const rise = c.yMax - base;
    if (rise <= 0.05 || rise > DEF_STEP_UP) continue;
    const top = core.groundY(c.cx, c.cz, c.yMax, DEF_STEP_UP);
    if (top === top && top >= c.yMax - 0.1) continue; // capped by a walkable top: a step, a plinth, ramp fill
    add('low-solid', c.cx, c.yMax, c.cz,
      `solid ${label(c.desc.tag, c.id)} is only ${rise.toFixed(2)} m tall (≤ step-up) with no surface on top: characters walk through it — add a top surface, make it taller, or set blocksMove: false`);
  }

  for (const kind of Object.keys(counts)) {
    if (counts[kind] > MAX_PER_KIND) {
      out.push({ kind: kind as PhysicsIssue['kind'], x: 0, y: 0, z: 0, message: `… and ${counts[kind] - MAX_PER_KIND} more '${kind}' issues` });
    }
  }
  return out;
}
