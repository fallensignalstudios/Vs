/**
 * Grounded character movement: sub-stepped circle-vs-solid resolution with sliding, step-up, ramp following and
 * fall protection (never leaves the walkable surfaces, never drops more than `maxDrop`).
 *
 * Guarantees (given a finite input):
 *  - the result is finite;
 *  - a sub-step is only accepted when the circle is clear of every relevant solid and (when grounded) stands on
 *    valid ground, otherwise the character stays at the last accepted position — so a move that starts valid
 *    ends valid;
 *  - no tunnelling: sub-steps are ≤ radius/2 and an accepted sub-step never displaces the centre by ≥ 2·radius,
 *    which is the minimum needed to cross even a zero-thickness wall with both endpoints clear.
 */
import type { MoveOpts, MoveResult } from '@/core/api/physics';
import { RAY_MOVE } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import { circlePen, maskOf, warnOnce } from './shapes';
import type { ColliderRec, Contact, SurfaceRec } from './shapes';
import { DEF_HEIGHT, DEF_MAX_DROP, DEF_STEP_UP, Y_EPS } from './world';
import type { PhysicsCore } from './world';

/** hard cap on sub-steps per call; longer moves are truncated (≈ 100 m for a 0.4 m radius) */
const MAX_SUBSTEPS = 512;
const MAX_ITERS = 4;
/** penetration below this is treated as touching */
const PEN_EPS = 1e-6;
/** extra push so a resolved circle is strictly clear */
const SKIN = 1e-5;
/** ring samples used to estimate the outward normal of a walkable edge */
const RING = 12;
const RING_COS: number[] = [];
const RING_SIN: number[] = [];
for (let i = 0; i < RING; i++) {
  RING_COS.push(Math.cos((i / RING) * Math.PI * 2));
  RING_SIN.push(Math.sin((i / RING) * Math.PI * 2));
}
/** how far a slide candidate may be pulled back inside a convex edge */
const EDGE_PULL = 0.08;

/** Mutable state of one moveCharacter call (module-level: the solver is not re-entrant and never yields). */
const S = {
  // resolve output
  rx: 0, rz: 0,
  // last contact normal
  nx: 0, nz: 0, hasN: false,
  // edge normal output (walkable → void)
  ox: 0, oz: 0,
};
const scratch: ColliderRec[] = [];
const contact: Contact = { nx: 0, nz: 0, depth: 0 };

/**
 * Push a circle out of the relevant solids (≤ 4 iterations, deepest contact first).
 * Returns 0 = was clear, 1 = pushed and now clear, 2 = still penetrating (wedged).
 * The resolved position is left in S.rx / S.rz, the last contact normal in S.nx / S.nz.
 */
function resolve(w: PhysicsCore, x: number, z: number, r: number, lo: number, hi: number): 0 | 1 | 2 {
  let pushed = false;
  for (let iter = 0; iter <= MAX_ITERS; iter++) {
    const n = w.colliderHash.query(x - r, z - r, x + r, z + r, scratch);
    let deep = PEN_EPS, dnx = 0, dnz = 0;
    for (let i = 0; i < n; i++) {
      const c = scratch[i];
      if (!c.on || c.yMax <= lo || c.yMin >= hi) continue;
      if (c.maxX < x - r || c.minX > x + r || c.maxZ < z - r || c.minZ > z + r) continue;
      if (!(maskOf(c.desc) & RAY_MOVE)) continue;
      if (circlePen(c, x, z, r, contact) && contact.depth > deep) {
        deep = contact.depth; dnx = contact.nx; dnz = contact.nz;
      }
    }
    if (deep <= PEN_EPS) {
      S.rx = x; S.rz = z;
      return pushed ? 1 : 0;
    }
    if (iter === MAX_ITERS) break;
    x += dnx * (deep + SKIN);
    z += dnz * (deep + SKIN);
    S.nx = dnx; S.nz = dnz; S.hasN = true;
    pushed = true;
  }
  S.rx = x; S.rz = z;
  return 2;
}

/**
 * Outward unit normal (walkable → void) of the walkable edge crossed near (ex,ez), left in S.ox / S.oz.
 * Exact from the geometry of `surf` (the surface under the last valid point); when that is inconclusive it
 * falls back to a ring of validity samples, and finally to the direction of travel.
 */
function edgeNormal(
  w: PhysicsCore, surf: SurfaceRec | null, ex: number, ez: number, y: number, stepUp: number, maxDrop: number,
  height: number, head: boolean, r: number, fx: number, fz: number,
): void {
  if (surf) {
    const dx = ex - surf.cx, dz = ez - surf.cz;
    if (surf.isDisc) {
      const d = Math.hypot(dx, dz);
      if (d > 1e-9) {
        if (d >= surf.r - 1e-3) { S.ox = dx / d; S.oz = dz / d; return; }
        if (surf.inner > 0 && d <= surf.inner + 1e-3) { S.ox = -dx / d; S.oz = -dz / d; return; }
      }
    } else {
      const lx = dx * surf.cos - dz * surf.sin, lz = dx * surf.sin + dz * surf.cos;
      const overX = Math.abs(lx) - surf.hx, overZ = Math.abs(lz) - surf.hz;
      if (overX > -1e-3 || overZ > -1e-3) {
        let nlx = 0, nlz = 0;
        if (overX >= overZ) nlx = lx < 0 ? -1 : 1; else nlz = lz < 0 ? -1 : 1;
        S.ox = nlx * surf.cos + nlz * surf.sin;
        S.oz = -nlx * surf.sin + nlz * surf.cos;
        return;
      }
    }
  }
  const eps = Math.min(0.12, r * 0.5);
  let ox = 0, oz = 0;
  for (let k = 0; k < RING; k++) {
    const g = w.walkY(ex + RING_COS[k] * eps, ez + RING_SIN[k] * eps, y, stepUp, maxDrop, height, head);
    if (g !== g) { ox += RING_COS[k]; oz += RING_SIN[k]; }
  }
  let ol = Math.hypot(ox, oz);
  if (ol < 1e-6) { ox = fx; oz = fz; ol = Math.hypot(ox, oz); }
  if (ol < 1e-12) { S.ox = 1; S.oz = 0; return; }
  S.ox = ox / ol; S.oz = oz / ol;
}

function fill(out: MoveResult, x: number, y: number, z: number, blocked: boolean): MoveResult {
  out.x = x; out.y = y; out.z = z;
  out.blocked = blocked;
  if (S.hasN) {
    if (out.normal) { out.normal.x = S.nx; out.normal.z = S.nz; }
    else out.normal = { x: S.nx, z: S.nz };
  } else out.normal = null;
  return out;
}

export function moveCharacter(
  w: PhysicsCore, from: Vec3Like, radius: number, dx: number, dz: number, opts?: MoveOpts,
): MoveResult {
  const out: MoveResult = opts?.out ?? { x: 0, y: 0, z: 0, blocked: false, normal: null };
  S.hasN = false;

  let x = from ? from.x : NaN, y = from ? from.y : NaN, z = from ? from.z : NaN;
  if (!(x === x) || !(y === y) || !(z === z) || !Number.isFinite(x + y + z)) {
    warnOnce('move-nan', 'moveCharacter called with a non-finite position; holding at a finite fallback');
    return fill(out, Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0, true);
  }
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = 0; dz = 0; }

  const r = radius > 0.02 ? radius : 0.02;
  const stepUp = opts?.stepUp !== undefined && opts.stepUp >= 0 ? opts.stepUp : DEF_STEP_UP;
  const maxDrop = opts?.maxDrop !== undefined && opts.maxDrop >= 0 ? opts.maxDrop : DEF_MAX_DROP;
  const height = opts?.height !== undefined && opts.height > 0 ? opts.height : DEF_HEIGHT;
  const flying = opts?.flying === true;

  // Ground state at the start. An actor that begins off every surface moves freely (solids only) until it
  // reaches ground again — the graceful recovery for a badly placed spawn.
  // `head` enables the headroom rule; it is waived for an actor that already stands somewhere without
  // headroom (shoved or spawned under a ramp) so it can always walk back out.
  let grounded = false, head = false;
  if (!flying) {
    const gy = w.groundY(x, z, y, stepUp);
    if (gy === gy) { y = gy; grounded = true; head = w.headroom(x, z, gy, stepUp, height); }
  }

  let blocked = false;
  const twoR = 2 * r - 1e-6;

  // Initial depenetration (a door closed on the actor, a barrier raised, a bad spawn). `clear` tracks whether
  // the current position is known to be free of solids; the anti-tunnelling guard only applies when it is.
  let clear = false;
  {
    const lo = flying ? y + Y_EPS : y + stepUp + Y_EPS;
    const st = resolve(w, x, z, r, lo, y + height - Y_EPS);
    if (st === 0) clear = true;
    else {
      blocked = true;
      if (st === 1) {
        if (flying || !grounded) { x = S.rx; z = S.rz; clear = true; }
        else {
          const g = w.walkY(S.rx, S.rz, y, stepUp, maxDrop, height, head);
          if (g === g) { x = S.rx; z = S.rz; y = g; clear = true; }
        }
      }
    }
  }

  const len = Math.hypot(dx, dz);
  const maxStep = r * 0.5;
  let n = len > 1e-9 ? Math.ceil(len / maxStep) : 0;
  let sx = 0, sz = 0;
  if (n > MAX_SUBSTEPS) {
    n = MAX_SUBSTEPS;
    sx = (dx / len) * maxStep; sz = (dz / len) * maxStep;
    blocked = true;
  } else if (n > 0) { sx = dx / n; sz = dz / n; }

  for (let i = 0; i < n; i++) {
    const lo = flying ? y + Y_EPS : y + stepUp + Y_EPS;
    const hi = y + height - Y_EPS;
    const status = resolve(w, x + sx, z + sz, r, lo, hi);
    if (status !== 0) blocked = true;
    if (status === 2) break;
    const qx = S.rx, qz = S.rz;
    const mdx = qx - x, mdz = qz - z;
    if (clear && mdx * mdx + mdz * mdz >= twoR * twoR) { blocked = true; break; }
    if (mdx * mdx + mdz * mdz < 1e-14) break; // pinned head-on: further sub-steps are identical

    if (flying || !grounded) {
      x = qx; z = qz; clear = true;
      if (!flying) {
        const gy = w.groundY(x, z, y, stepUp);
        if (gy === gy) { y = gy; grounded = true; head = w.headroom(x, z, gy, stepUp, height); }
      }
    } else {
      const gy = w.walkY(qx, qz, y, stepUp, maxDrop, height, head);
      if (gy === gy) {
        x = qx; z = qz; y = gy; clear = true;
      } else {
        // ---- fall protection: stop at the edge, then slide along it ----
        blocked = true;
        // last valid fraction along p → q
        let tLo = 0, tHi = 1;
        for (let it = 0; it < 6; it++) {
          const m = (tLo + tHi) * 0.5;
          const g = w.walkY(x + mdx * m, z + mdz * m, y, stepUp, maxDrop, height, head);
          if (g === g) tLo = m; else tHi = m;
        }
        let bx = x, bz = z, by = y;
        if (tLo > 0) {
          const cx = x + mdx * tLo, cz = z + mdz * tLo;
          if (resolve(w, cx, cz, r, lo, hi) === 0) {
            const g = w.walkY(cx, cz, y, stepUp, maxDrop, height, head);
            if (g === g) { bx = cx; bz = cz; by = g; }
          }
        }
        w.groundY(bx, bz, by, stepUp);
        edgeNormal(w, w.lastSurface, x + mdx * tHi, z + mdz * tHi, y, stepUp, maxDrop, height, head, r, mdx, mdz);
        const ox = S.ox, oz = S.oz;
        S.nx = -ox; S.nz = -oz; S.hasN = true;
        // tangential remainder of this sub-step
        let tx = qx - bx, tz = qz - bz;
        const dot = tx * ox + tz * oz;
        if (dot > 0) { tx -= dot * ox; tz -= dot * oz; }
        if (tx * tx + tz * tz > 1e-10 && resolve(w, bx + tx, bz + tz, r, lo, hi) !== 2) {
          let cx = S.rx, cz = S.rz;
          let g = w.walkY(cx, cz, by, stepUp, maxDrop, height, head);
          let ok = g === g;
          if (!ok) {
            // a convex edge curves away from the tangent: pull the candidate back in to the closest valid point
            const ix = cx - ox * EDGE_PULL, iz = cz - oz * EDGE_PULL;
            g = w.walkY(ix, iz, by, stepUp, maxDrop, height, head);
            if (g === g) {
              let kLo = 0, kHi = 1;
              for (let it = 0; it < 5; it++) {
                const m = (kLo + kHi) * 0.5;
                const gm = w.walkY(ix + (cx - ix) * m, iz + (cz - iz) * m, by, stepUp, maxDrop, height, head);
                if (gm === gm) { kLo = m; g = gm; } else kHi = m;
              }
              cx = ix + (cx - ix) * kLo; cz = iz + (cz - iz) * kLo;
              ok = resolve(w, cx, cz, r, lo, hi) === 0;
            }
          }
          const ddx = cx - x, ddz = cz - z;
          if (ok && ddx * ddx + ddz * ddz < twoR * twoR) { bx = cx; bz = cz; by = g; }
          S.nx = -ox; S.nz = -oz;
        }
        if (bx === x && bz === z) { y = by; break; }
        x = bx; z = bz; y = by;
      }
    }
  }

  return fill(out, x, y, z, blocked);
}
