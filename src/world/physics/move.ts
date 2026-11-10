/**
 * Grounded character movement: sub-stepped circle-vs-solid resolution with sliding, step-up, ramp following and
 * fall protection (never leaves the walkable surfaces, never drops more than `maxDrop`, keeps the feet an edge
 * margin away from ledges).
 *
 * Guarantees (given a finite input):
 *  - the result is finite;
 *  - a position is only accepted when the body can REST there: valid ground (see `PhysicsCore.place`) and the
 *    circle clear of every solid overlapping the body's band AT THAT GROUND HEIGHT — so climbing a ramp or a
 *    step under a low soffit stops where the head would enter it, and a move that starts valid ends valid;
 *  - no tunnelling: sub-steps are ≤ radius/2 and an accepted sub-step never displaces the centre by ≥ 2·radius,
 *    which is the minimum needed to cross even a zero-thickness wall with both endpoints clear;
 *  - no speed-dependent floor: the ground is sampled every GROUND_SAMPLE (< GAP_TOL) along each sub-step, and
 *    cracks are either closed over their whole width or not at all, so a void can never hide between samples;
 *  - an actor that starts in an invalid state (inside a solid, off every surface, at the wrong height) is put
 *    on the nearest spot where it can stand, with a console warning — it never roams through the void.
 */
import type { MoveBlockReason, MoveOpts, MoveResult } from '@/core/api/physics';
import { RAY_MOVE } from '@/core/api/physics';
import type { Vec3Like } from '@/core/api/common';
import { GAP_TOL, circlePen, warnOnce, warnSome } from './shapes';
import type { ColliderRec, Contact } from './shapes';
import { findStand, recoverStand } from './stand';
import { DEF_HEIGHT, DEF_MAX_DROP, DEF_STEP_UP, Y_EPS, edgeMarginFor } from './world';
import type { PhysicsCore } from './world';

/** hard cap on sub-steps per call; longer moves are truncated (≈ 100 m for a 0.4 m radius) */
const MAX_SUBSTEPS = 512;
const MAX_ITERS = 4;
/** penetration below this is treated as touching */
const PEN_EPS = 1e-6;
/** extra push so a resolved circle is strictly clear */
const SKIN = 1e-5;
/** ground sampling interval along a sub-step; must stay below GAP_TOL (the narrowest possible void) */
const GROUND_SAMPLE = GAP_TOL * 0.8;
/** how far a slide candidate may be pulled back inside a convex edge */
const EDGE_PULL = 0.08;
/** how far an actor in an invalid state may be relocated to recover */
const RECOVER_DIST = 4;
/** ring samples used to estimate the outward normal of a blocking boundary */
const RING = 16;
const RING_COS: number[] = [];
const RING_SIN: number[] = [];
for (let i = 0; i < RING; i++) {
  RING_COS.push(Math.cos((i / RING) * Math.PI * 2));
  RING_SIN.push(Math.sin((i / RING) * Math.PI * 2));
}

/** Mutable state of one moveCharacter call (module-level: the solver is not re-entrant and never yields). */
const S = {
  // resolve output
  rx: 0, rz: 0,
  // last contact normal
  nx: 0, nz: 0, hasN: false,
  // boundary normal output (walkable → blocked)
  ox: 0, oz: 0,
  // track() output
  tOk: 0, gOk: 0, tBad: -1,
  reason: null as MoveBlockReason | null,
};
/** The body being moved. */
let W: PhysicsCore;
let R = 0.4, STEP = DEF_STEP_UP, DROP = DEF_MAX_DROP, H = DEF_HEIGHT, MARGIN = 0;
/** headroom / ledge rules armed? Each is waived while the body stands somewhere that already violates it. */
let HEAD = false, LEDGE = false;

const scratch: ColliderRec[] = [];
const contact: Contact = { nx: 0, nz: 0, depth: 0 };
/** the normal object handed out with each caller-owned result, so contact never allocates */
const normals = new WeakMap<MoveResult, { x: number; z: number }>();

/**
 * Push a circle out of the solids overlapping (lo, hi) (≤ 4 iterations, deepest contact first).
 * Returns 0 = was clear, 1 = pushed and now clear, 2 = still penetrating (wedged).
 * The resolved position is left in S.rx / S.rz, the last contact normal in S.nx / S.nz.
 */
function resolve(x: number, z: number, lo: number, hi: number): 0 | 1 | 2 {
  const r = R;
  let pushed = false;
  for (let iter = 0; iter <= MAX_ITERS; iter++) {
    const n = W.colliderHash.query(x - r, z - r, x + r, z + r, scratch);
    let deep = PEN_EPS, dnx = 0, dnz = 0;
    for (let i = 0; i < n; i++) {
      const c = scratch[i];
      if (!c.on || c.yMax <= lo || c.yMin >= hi || !(c.mask & RAY_MOVE)) continue;
      if (c.maxX < x - r || c.minX > x + r || c.maxZ < z - r || c.minZ > z + r) continue;
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

/** Ground height the feet may move onto at (x,z) coming from height yRef, or NaN (void, drop, headroom, ledge). */
function ground(x: number, z: number, yRef: number): number {
  return W.place(x, z, yRef, STEP, DROP, H, HEAD, LEDGE ? MARGIN : 0);
}

/** ground(), and the body is clear of solids when standing at that height: a spot where it can rest. */
function rest(x: number, z: number, yRef: number): number {
  const g = ground(x, z, yRef);
  return g === g && W.standClear(x, z, g, R, STEP, H) ? g : NaN;
}

/**
 * Follow the ground from (ax,az) at height ay to (bx,bz), sampling every GROUND_SAMPLE. Returns the height
 * reached at b, or NaN when the ground gives out on the way; S.tOk / S.gOk hold the last good sample and
 * S.tBad the first bad one (as fractions of the hop).
 */
function track(ax: number, az: number, ay: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const k = Math.max(1, Math.ceil(Math.hypot(dx, dz) / GROUND_SAMPLE));
  S.tOk = 0; S.gOk = ay; S.tBad = -1;
  for (let j = 1; j <= k; j++) {
    const t = j / k;
    const g = ground(ax + dx * t, az + dz * t, S.gOk);
    if (g !== g) { S.tBad = t; return NaN; }
    S.tOk = t; S.gOk = g;
  }
  return S.gOk;
}

/**
 * track() from a to b, and the body can rest at b: the height there, or NaN. Used for every hop the solver
 * makes besides the sub-step itself (the push clear of a riser, the slide along a boundary), so those can no
 * more skip a void than the sub-step can.
 */
function reach(ax: number, az: number, ay: number, bx: number, bz: number): number {
  const g = track(ax, az, ay, bx, bz);
  return g === g && W.standClear(bx, bz, g, R, STEP, H) ? g : NaN;
}

/** Re-arm the waived rules as soon as the body stands somewhere that satisfies them again. */
function rearm(x: number, z: number, y: number): void {
  if (!HEAD) HEAD = W.headroom(x, z, y, STEP, H);
  if (!LEDGE && MARGIN > 0) {
    W.groundY(x, z, y, 1e-3);
    LEDGE = W.ledgeOk(x, z, y, W.lastSurface, MARGIN, STEP, DROP);
  }
}

/**
 * Outward unit normal (restable → blocked) of the boundary crossed at (ex,ez), left in S.ox / S.oz.
 * `bx,bz` is the last restable point. For a walkable edge the normal is exact from the geometry of the
 * surface underfoot (inset by the ledge margin) when that edge really is a ledge; everything else — headroom
 * under a ramp, a soffit over a step, an edge made by several surfaces — uses a ring of validity samples,
 * and finally the direction of travel.
 */
function boundaryNormal(
  solid: boolean, ex: number, ez: number, bx: number, bz: number, yRef: number, fx: number, fz: number,
): void {
  if (!solid) {
    W.groundY(bx, bz, yRef, 1e-3);
    const surf = W.lastSurface;
    if (surf) {
      const m = LEDGE ? MARGIN : 0;
      const dx = ex - surf.cx, dz = ez - surf.cz;
      let nx = 0, nz = 0, found = false;
      if (surf.isDisc) {
        const d = Math.hypot(dx, dz);
        if (d > 1e-9) {
          if (d >= surf.r - m - 1e-3) { nx = dx / d; nz = dz / d; found = true; }
          else if (surf.inner > 0 && d <= surf.inner + m + 1e-3) { nx = -dx / d; nz = -dz / d; found = true; }
        }
      } else {
        const lx = dx * surf.cos - dz * surf.sin, lz = dx * surf.sin + dz * surf.cos;
        const overX = Math.abs(lx) - (surf.hx - m), overZ = Math.abs(lz) - (surf.hz - m);
        if (overX > -1e-3 || overZ > -1e-3) {
          let nlx = 0, nlz = 0;
          if (overX >= overZ) nlx = lx < 0 ? -1 : 1; else nlz = lz < 0 ? -1 : 1;
          nx = nlx * surf.cos + nlz * surf.sin;
          nz = -nlx * surf.sin + nlz * surf.cos;
          found = true;
        }
      }
      if (found) {
        // only trust it when the floor really ends just past that edge (it may continue on a neighbour)
        const reach = m + GAP_TOL + 0.03;
        const g = W.groundY(ex + nx * reach, ez + nz * reach, yRef, STEP);
        if (g !== g || yRef - g > DROP) { S.ox = nx; S.oz = nz; return; }
      }
    }
  }
  const eps = Math.min(0.12, R * 0.5);
  let ox = 0, oz = 0;
  for (let k = 0; k < RING; k++) {
    const px = ex + RING_COS[k] * eps, pz = ez + RING_SIN[k] * eps;
    const g = solid ? rest(px, pz, yRef) : ground(px, pz, yRef);
    if (g !== g) { ox += RING_COS[k]; oz += RING_SIN[k]; }
  }
  let ol = Math.hypot(ox, oz);
  if (ol < 1e-6) { ox = fx; oz = fz; ol = Math.hypot(ox, oz); }
  if (ol < 1e-12) { S.ox = 1; S.oz = 0; return; }
  S.ox = ox / ol; S.oz = oz / ol;
}

function fill(
  out: MoveResult, x: number, y: number, z: number, blocked: boolean, y0: number, grounded: boolean,
): MoveResult {
  out.x = x; out.y = y; out.z = z;
  out.blocked = blocked;
  if (S.hasN) {
    let n = normals.get(out);
    if (!n) { n = out.normal ?? { x: 0, z: 0 }; normals.set(out, n); }
    n.x = S.nx; n.z = S.nz;
    out.normal = n;
  } else out.normal = null;
  out.grounded = grounded;
  out.surface = null;
  if (grounded) {
    W.groundY(x, z, y, 1e-3);
    out.surface = W.lastSurface;
  }
  out.stepDy = y - y0;
  out.reason = blocked ? S.reason : null;
  return out;
}

const tag = (x: number, y: number, z: number): string => `(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;

export function moveCharacter(
  w: PhysicsCore, from: Vec3Like, radius: number, dx: number, dz: number, opts?: MoveOpts,
): MoveResult {
  const out: MoveResult = opts?.out ?? { x: 0, y: 0, z: 0, blocked: false, normal: null };
  W = w;
  S.hasN = false; S.reason = null;

  let x = from ? from.x : NaN, y = from ? from.y : NaN, z = from ? from.z : NaN;
  if (!(x === x) || !(y === y) || !(z === z) || !Number.isFinite(x + y + z)) {
    warnOnce('move-nan', 'moveCharacter called with a non-finite position; holding at a finite fallback');
    S.reason = 'lost';
    return fill(out, Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0, true, 0, false);
  }
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) { dx = 0; dz = 0; }
  const y0 = y;

  const r = radius > 0.02 ? radius : 0.02;
  R = r;
  STEP = opts?.stepUp !== undefined && opts.stepUp >= 0 ? opts.stepUp : DEF_STEP_UP;
  DROP = opts?.maxDrop !== undefined && opts.maxDrop >= 0 ? opts.maxDrop : DEF_MAX_DROP;
  H = opts?.height !== undefined && opts.height > 0 ? opts.height : DEF_HEIGHT;
  MARGIN = opts?.edgeMargin !== undefined && opts.edgeMargin >= 0 ? Math.min(opts.edgeMargin, r) : edgeMarginFor(r);
  const flying = opts?.flying === true;
  HEAD = false; LEDGE = false;

  let blocked = false;
  const twoR = 2 * r - 1e-6;

  // ---- ground state at the start ---------------------------------------------------------------------------
  let grounded = false;
  if (!flying) {
    const gy = w.groundY(x, z, y, STEP);
    if (gy === gy && y - gy <= DROP + 1e-6) { y = gy; grounded = true; }
    else if (opts?.freeRoam !== true) {
      // Not standing on anything (a marker at the wrong height or outside the level, a bridge that retracted):
      // never roam through the void — stand on the nearest valid spot, or hold still when there is none.
      const p = recoverStand(w, x, y, z, r, RECOVER_DIST, H, MARGIN);
      const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
      if (!p) {
        warnSome('move-lost', key, `actor at ${tag(x, y, z)} is not on walkable ground and nothing standable lies within ${RECOVER_DIST} m; holding position`);
        S.reason = 'lost';
        return fill(out, x, y, z, true, y0, false);
      }
      warnSome('move-recovered', key, `actor at ${tag(x, y, z)} was not on walkable ground; moved to ${tag(p.x, p.y, p.z)}`);
      x = p.x; y = p.y; z = p.z;
      grounded = true; blocked = true; S.reason = 'recovered';
    }
    if (grounded) {
      // each rule is waived for an actor that already stands somewhere violating it (shoved under a ramp,
      // spawned on a rim) so it can always walk back out; see rearm()
      HEAD = w.headroom(x, z, y, STEP, H);
      rearm(x, z, y);
    }
  }

  // ---- initial depenetration (a door closed on the actor, a barrier raised, a bad spawn) -------------------
  // `clear` tracks whether the current position is known to be free of solids; the anti-tunnelling guard only
  // applies when it is.
  let clear = false;
  {
    const lo = flying ? y + Y_EPS : y + STEP + Y_EPS;
    const st = resolve(x, z, lo, y + H - Y_EPS);
    if (st === 0) clear = true;
    else {
      blocked = true; S.reason = 'solid';
      if (!grounded) {
        if (st === 1) { x = S.rx; z = S.rz; clear = true; }
      } else {
        // nearest face first — unless that exit is not restable or lies beyond a wall the actor was not in
        let g = NaN;
        if (st === 1 && !w.hopBlocked(x, z, S.rx, S.rz, y, STEP, H)) g = rest(S.rx, S.rz, y);
        if (g === g) { x = S.rx; z = S.rz; y = g; clear = true; }
        else {
          const m = LEDGE ? MARGIN : 0;
          const p = findStand(w, x, y, z, r, RECOVER_DIST, H, m, true) ?? findStand(w, x, y, z, r, RECOVER_DIST, H, m, false);
          if (p) { x = p.x; y = p.y; z = p.z; clear = true; S.reason = 'recovered'; }
        }
        if (clear) rearm(x, z, y);
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
    blocked = true; S.reason = 'limit';
  } else if (n > 0) { sx = dx / n; sz = dz / n; }

  for (let i = 0; i < n; i++) {
    const lo = flying ? y + Y_EPS : y + STEP + Y_EPS;
    const hi = y + H - Y_EPS;
    const status = resolve(x + sx, z + sz, lo, hi);
    if (status !== 0) { blocked = true; S.reason = 'solid'; }
    if (status === 2) break;
    const qx = S.rx, qz = S.rz;
    const mdx = qx - x, mdz = qz - z;
    const d2 = mdx * mdx + mdz * mdz;
    if (clear && d2 >= twoR * twoR) { blocked = true; S.reason = 'solid'; break; }
    if (d2 < 1e-14) break; // pinned head-on: further sub-steps are identical

    if (!grounded) {
      // flying, or explicit free roam until ground is reached
      x = qx; z = qz; clear = true;
      if (!flying) {
        const gy = w.groundY(x, z, y, STEP);
        if (gy === gy && y - gy <= DROP + 1e-6) { y = gy; grounded = true; HEAD = w.headroom(x, z, y, STEP, H); rearm(x, z, y); }
      }
      continue;
    }

    // ---- ground continuity along p → q ----
    track(x, z, y, qx, qz);
    let tOk = S.tOk, gOk = S.gOk, tBad = S.tBad;
    let solid = false;
    if (tBad < 0) {
      // q stands on valid ground; resolve() only cleared the band of the OLD height, so re-test at the new one
      if (gOk === y || w.standClear(qx, qz, gOk, r, STEP, H)) {
        x = qx; z = qz; y = gOk; clear = true;
        if (!HEAD || !LEDGE) rearm(x, z, y);
        continue;
      }
      // A solid occupies the body's band at the new height. Stepping off a ledge, that is the ledge's own
      // riser: let it push the body clear, and keep the result when it is a restable spot further along the
      // move. Anything else (a soffit over a ramp or a step) is a block at the last restable point.
      const hadN: boolean = S.hasN, pnx: number = S.nx, pnz: number = S.nz;
      if (resolve(qx, qz, gOk + STEP + Y_EPS, gOk + H - Y_EPS) === 1) {
        const hx = S.rx, hz = S.rz;
        const ex = hx - x, ez = hz - z;
        if (ex * mdx + ez * mdz > 0 && ex * ex + ez * ez < twoR * twoR) {
          const g = reach(qx, qz, gOk, hx, hz);
          if (g === g) {
            S.hasN = hadN; S.nx = pnx; S.nz = pnz;
            x = hx; z = hz; y = g; clear = true;
            if (!HEAD || !LEDGE) rearm(x, z, y);
            continue;
          }
        }
      }
      S.hasN = hadN; S.nx = pnx; S.nz = pnz;
      tOk = 0; gOk = y; tBad = 1; solid = true;
    }

    // ---- blocked between tOk and tBad: stop at the last restable point, then slide along the boundary ----
    blocked = true;
    let bt = 0, by = y, tLo = tOk, tHi = tBad;
    if (tOk > 0) {
      const g = rest(x + mdx * tOk, z + mdz * tOk, gOk);
      if (g === g) { bt = tOk; by = g; }
      else { tLo = 0; tHi = tOk; gOk = y; solid = true; }
    }
    for (let it = 0; it < 6; it++) {
      const m = (tLo + tHi) * 0.5;
      const g = rest(x + mdx * m, z + mdz * m, gOk);
      if (g === g) { tLo = m; bt = m; by = g; } else tHi = m;
    }
    S.reason = solid ? 'solid' : 'edge';
    let bx = x + mdx * bt, bz = z + mdz * bt;
    boundaryNormal(solid, x + mdx * tHi, z + mdz * tHi, bx, bz, by, mdx, mdz);
    const ox = S.ox, oz = S.oz;
    S.nx = -ox; S.nz = -oz; S.hasN = true;
    // tangential remainder of this sub-step
    let tx = qx - bx, tz = qz - bz;
    const dot = tx * ox + tz * oz;
    if (dot > 0) { tx -= dot * ox; tz -= dot * oz; }
    if (tx * tx + tz * tz > 1e-10 && resolve(bx + tx, bz + tz, by + STEP + Y_EPS, by + H - Y_EPS) !== 2) {
      let cx = S.rx, cz = S.rz;
      let g = reach(bx, bz, by, cx, cz);
      if (g !== g) {
        // a convex boundary curves away from the tangent: pull the candidate back in to the closest valid point
        const ix = cx - ox * EDGE_PULL, iz = cz - oz * EDGE_PULL;
        const gi = rest(ix, iz, by);
        if (gi === gi) {
          let kLo = 0, kHi = 1;
          for (let it = 0; it < 5; it++) {
            const m = (kLo + kHi) * 0.5;
            const gm = rest(ix + (cx - ix) * m, iz + (cz - iz) * m, by);
            if (gm === gm) kLo = m; else kHi = m;
          }
          cx = ix + (cx - ix) * kLo; cz = iz + (cz - iz) * kLo;
          g = reach(bx, bz, by, cx, cz);
        }
      }
      const ddx = cx - x, ddz = cz - z;
      if (g === g && ddx * ddx + ddz * ddz < twoR * twoR) { bx = cx; bz = cz; by = g; }
      S.nx = -ox; S.nz = -oz;
    }
    if (bx === x && bz === z) { y = by; break; }
    x = bx; z = bz; y = by; clear = true;
    if (!HEAD || !LEDGE) rearm(x, z, y);
  }

  return fill(out, x, y, z, blocked, y0, grounded);
}
