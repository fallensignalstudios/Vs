/**
 * Regression tests for the navigation findings of the physics-nav review: agent height (the elite under the
 * balcony), nav that follows the world without an explicit rebuild, exact path endpoints, ledge margins, and
 * paths that the movement solver can actually walk.
 */
import { describe, expect, it } from 'vitest';
import type { NavPath, PhysicsWorld, Vec3Like } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ05, buildZ08, fxBox, fxFloor, planPos } from './fixtures';

const world = (): PhysicsWorld => createPhysicsWorld(null);
const ELITE = { radius: 1.2, height: 3.6 };

/** Sample a path polyline every `step` metres. */
function samples(path: NavPath, step = 0.2): Vec3Like[] {
  const out: Vec3Like[] = [{ ...path.points[0] }];
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** Walk a path with the real movement solver, steering straight at each waypoint in turn. */
function follow(
  w: PhysicsWorld, path: NavPath, radius = 0.4, height = 1.8, speed = 5,
): { reached: boolean; blocked: number; pos: Vec3Like } {
  const dt = 1 / 60;
  let pos: Vec3Like = { ...path.points[0] };
  let leg = 1, blocked = 0;
  let frames = Math.ceil((path.length / speed) * 60 * 1.5) + 120;
  while (leg < path.points.length && frames-- > 0) {
    const tgt = path.points[leg];
    const dx = tgt.x - pos.x, dz = tgt.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) { leg++; continue; }
    const step = Math.min(d, speed * dt);
    const m = w.moveCharacter(pos, radius, (dx / d) * step, (dz / d) * step, { height });
    if (m.blocked) blocked++;
    pos = { x: m.x, y: m.y, z: m.z };
  }
  return { reached: leg >= path.points.length, blocked, pos };
}

const last = (p: NavPath): Vec3Like => p.points[p.points.length - 1];

describe('big agents: radius AND height (review: the elite under the balcony)', () => {
  // Z08: balcony deck over plan x 54..63, n 16..30 at +3 m (slab underside 2.6 m); ramps x 54..60 south and north of it
  const underDeck = (p: Vec3Like): boolean => p.y < 2 && p.x > 54 - 1.2 && p.x < 63 + 1.2 && -p.z > 16 - 1.2 && -p.z < 30 + 1.2;

  it('a 3.6 m body is never routed under the +3 m balcony, and walks its path without touching anything', () => {
    const w = world();
    const f = buildZ08(w);
    w.nav.rebuild();
    const from = f.marks.eastLoop, east = planPos(66.5, 23);
    // a body of default height, however wide, takes the straight line under the deck…
    const low = w.nav.findPathFor(from, east, ELITE.radius)!;
    expect(low.points.length).toBe(2);
    expect(samples(low).some(underDeck)).toBe(true);
    expect(w.nav.walkableFor(from, east, ELITE.radius)).toBe(true);
    // …the elite goes round the ramps
    const p = w.nav.findPathFor(from, east, ELITE.radius, ELITE.height)!;
    expect(p).not.toBeNull();
    expect(w.nav.walkableFor(from, east, ELITE.radius, ELITE.height)).toBe(false);
    expect(p.length).toBeGreaterThan(low.length + 20);
    expect(last(p)).toEqual({ x: east.x, y: 0, z: east.z });
    for (const q of samples(p)) {
      expect(underDeck(q)).toBe(false);
      const g = w.groundAt(q.x, q.z, q.y, 0.4)!;
      if (!w.canStand(q.x, g.y, q.z, ELITE.radius, ELITE.height)) throw new Error(`elite does not fit at ${JSON.stringify(q)}`);
    }
    const walk = follow(w, p, ELITE.radius, ELITE.height, 4);
    expect(walk.reached).toBe(true);
    expect(walk.blocked).toBe(0);
    // the same answer every time, and the default agent is not disturbed by the big one's bookkeeping
    expect(w.nav.findPathFor(from, east, ELITE.radius, ELITE.height)).toEqual(p);
    expect(w.nav.findPath(from, east)!.points.length).toBe(2);
  });

  it('a goal the body cannot reach ends at the nearest place it can — on that level, beside the obstacle', () => {
    const w = world();
    const f = buildZ08(w);
    w.nav.rebuild();
    const goal = f.marks.underBalcony; // plan (58.5, 23), under the middle of the deck
    const p = w.nav.findPathFor(f.marks.eastLoop, goal, ELITE.radius, ELITE.height)!;
    expect(p).not.toBeNull();
    const end = last(p);
    expect(end.y).toBe(0); // not on top of the balcony above the goal
    expect(end.x).toBeLessThanOrEqual(54 - 1.2); // beside the deck, on the side the elite came from
    expect(Math.hypot(end.x - goal.x, end.z - goal.z)).toBeLessThan(6.5);
    expect(p.length).toBeLessThan(4);
    expect(w.canStand(end.x, end.y, end.z, ELITE.radius, ELITE.height)).toBe(true);
    expect(follow(w, p, ELITE.radius, ELITE.height, 4)).toMatchObject({ reached: true, blocked: 0 });
    // from the far side it stops on the far side rather than walking 40 m round for the same distance
    const fromEast = w.nav.findPathFor(planPos(66.5, 23), goal, ELITE.radius, ELITE.height)!;
    expect(last(fromEast).x).toBeGreaterThanOrEqual(63 + 1.2);
    expect(fromEast.length).toBeLessThan(4);
    // a goal ON the balcony is a different request: up the ramp
    const top = w.nav.findPathFor(f.marks.eastLoop, f.marks.balcony, ELITE.radius, ELITE.height)!;
    expect(last(top).y).toBeCloseTo(3);
    // a sealed room stays unreachable for any body, and the default agent keeps its strict null
    expect(w.nav.findPathFor(f.marks.eastLoop, f.marks.roomW, ELITE.radius, ELITE.height)).toBeNull();
    expect(w.nav.findPath(f.marks.eastLoop, f.marks.roomW)).toBeNull();
  });

  it('clearance, nearestStandable and coverPoint take the body height too', () => {
    const w = world();
    const f = buildZ08(w);
    const u = f.marks.underBalcony;
    expect(w.nav.clearance(u.x, 0, u.z)).toBe(3);
    expect(w.nav.clearance(u.x, 0, u.z, ELITE.height)).toBe(0);
    expect(w.canStand(u.x, 0, u.z, ELITE.radius)).toBe(true);
    expect(w.canStand(u.x, 0, u.z, ELITE.radius, ELITE.height)).toBe(false);
    expect(w.nearestStandable(u.x, 0, u.z, ELITE.radius, 8)).toEqual({ x: u.x, y: 0, z: u.z });
    const spot = w.nearestStandable(u.x, 0, u.z, ELITE.radius, 8, ELITE.height)!;
    expect(spot).not.toBeNull();
    expect(w.canStand(spot.x, spot.y, spot.z, ELITE.radius, ELITE.height)).toBe(true);
    expect(Math.abs(spot.x - u.x)).toBeGreaterThanOrEqual(4.5 + 1.2 - 0.05);
    expect(w.nearestStandable(u.x, 0, u.z, ELITE.radius, 4, ELITE.height)).toBeNull(); // nothing that close
    // cover under a soffit: fine for a human, not for a 2.4 m body
    const c = world();
    fxFloor(c, 0, 0, 20, 20, 0);
    const cover = fxBox(c, 9, 9, 11, 10, 0, 2.2, { cover: 'high' });
    fxBox(c, 8, 10, 12, 13, 2.0, 2.4, { tag: 'soffit' });
    const threat = planPos(10, 2, 1.6);
    expect(c.coverPoint(cover, threat)).not.toBeNull();
    expect(c.coverPoint(cover, threat, 0.4, 2.4)).toBeNull();
  });

  it('wide bodies do not cut corners or squeeze: random Z08 routes are walked without a single contact', () => {
    const w = world();
    buildZ08(w);
    w.nav.rebuild();
    const rng = mulberry32(21);
    let walked = 0;
    for (let i = 0; i < 400 && walked < 120; i++) {
      const a = w.nav.randomPoint(planPos(35, 24), 60, Math.floor(rng() * 1e9));
      const b = w.nav.randomPoint(planPos(35, 24), 60, Math.floor(rng() * 1e9));
      // start somewhere the elite has room to stand; the goal may be anywhere
      if (!a || !b || w.nav.clearance(a.x, a.y, a.z, ELITE.height) < 1.6 || !w.canStand(a.x, a.y, a.z, ELITE.radius, ELITE.height)) continue;
      const p = w.nav.findPathFor(a, b, ELITE.radius, ELITE.height);
      if (!p) continue;
      walked++;
      const r = follow(w, p, ELITE.radius, ELITE.height, 4);
      if (!r.reached || r.blocked > 0) {
        throw new Error(`elite ${r.reached ? 'scraped' : 'stuck'} (${r.blocked} blocked frames) on ${JSON.stringify(p.points)}`);
      }
    }
    expect(walked).toBeGreaterThan(80);
  });
});

describe('nav follows the world without rebuild() (review: stale nav)', () => {
  it('live flag edits on a collider description reach nav, movement, rays and cover queries', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    const a = f.marks.floorMid, b = f.marks.exitOutside;
    expect(w.nav.findPath(a, b)).toBeNull();
    const builds = w.nav.stats.builds;
    f.door.desc.blocksMove = false; // the door becomes a hologram: walk through, still opaque
    expect(w.nav.stale).toBe(true);
    expect(w.nav.findPath(a, b)).not.toBeNull();
    expect(w.nav.stats.builds).toBe(builds + 1);
    expect(w.nav.stats.lastBuildFull).toBe(false);
    expect(w.nav.walkable(f.marks.exitInside, f.marks.exitOutside)).toBe(true);
    expect(w.nav.isWalkable(31, 0, -38)).toBe(true); // in the doorway
    expect(w.moveCharacter(f.marks.exitInside, 0.4, 0, -5).z).toBeCloseTo(-40);
    expect(w.lineOfSight({ ...f.marks.exitInside, y: 1.6 }, { ...b, y: 1.6 })).toBe(false);
    f.door.desc.blocksSight = false; // sight-only edit: nothing for nav to do
    expect(w.lineOfSight({ ...f.marks.exitInside, y: 1.6 }, { ...b, y: 1.6 })).toBe(true);
    expect(w.nav.findPath(a, b)).not.toBeNull();
    expect(w.nav.stats.builds).toBe(builds + 1);
    expect(w.nav.stale).toBe(false);
    f.door.desc.blocksMove = true;
    expect(w.nav.findPath(a, b)).toBeNull();
    expect(w.nav.randomPoint(f.marks.exitInside, 8, 3)!.z).toBeGreaterThan(-37.8);
    // cover classification is live as well
    const before = w.coverNear(31, -7.5, 4).length;
    f.lowCover[2].desc.cover = undefined;
    expect(w.coverNear(31, -7.5, 4).length).toBe(before - 1);
  });

  it('every kind of query refreshes a stale grid, and removal / moves are picked up', () => {
    const w = world();
    fxFloor(w, 0, 0, 30, 6, 0);
    const crate = fxBox(w, 14, 0, 16, 6, 0, 2);
    const a = planPos(3, 3), b = planPos(27, 3), mid = planPos(15, 3);
    expect(w.nav.isWalkable(mid.x, 0, mid.z)).toBe(false); // first query builds
    crate.enabled = false;
    expect(w.nav.isWalkable(mid.x, 0, mid.z)).toBe(true);
    crate.enabled = true;
    expect(w.nav.walkable(a, b)).toBe(false);
    crate.setPose(15, 1, -20);
    expect(w.nav.walkable(a, b)).toBe(true);
    crate.setPose(15, 1, -3);
    expect(w.nav.nearest(mid.x, 0, mid.z)!.x).not.toBeCloseTo(15, 1);
    expect(w.nav.clearance(13, 0, -3)).toBeCloseTo(1, 5);
    crate.remove();
    expect(w.nav.clearance(13, 0, -3)).toBe(3);
    expect(w.nav.findPathFor(a, b, 1.2)!.points.length).toBe(2);
    expect(w.nav.stale).toBe(false);
  });

  it('a query issued while a zone is still being assembled does not freeze a partial grid', () => {
    const w = world();
    fxFloor(w, 0, 0, 10, 10, 0);
    const a = planPos(5, 5), b = planPos(35, 5);
    expect(w.nav.findPath(a, b)).toBeNull(); // builds a grid of the first room only
    fxFloor(w, 10, 3, 30, 7, 0); // corridor …
    fxFloor(w, 30, 0, 40, 10, 0); // … and second room, added afterwards
    for (let i = 0; i < 30; i++) fxBox(w, 12 + i * 0.5, 3, 12.2 + i * 0.5, 3.3, 0, 1); // more changes than the dirty list holds
    const p = w.nav.findPath(a, b)!;
    expect(p).not.toBeNull();
    expect(p.length).toBeCloseTo(30, 6); // straight down the corridor
    expect(w.nav.stats.lastBuildFull).toBe(true);
    expect(w.nav.nodeCount).toBeGreaterThan(900);
  });

  it('warm() front-loads the per-node fit of a big agent without changing any answer', () => {
    const cold = world(), warm = world();
    const fc = buildZ08(cold), fw = buildZ08(warm);
    cold.nav.rebuild();
    warm.nav.rebuild();
    warm.nav.warm(ELITE.radius, ELITE.height);
    warm.nav.warm(NaN); // ignored
    warm.nav.warm(0.3); // nothing to do for a body the default agent covers
    for (const [a, b] of [[fc.marks.staging, fc.marks.underBalcony], [fc.marks.eastLoop, planPos(66.5, 23)], [fc.marks.westLoop, fc.marks.balcony]] as const) {
      expect(warm.nav.findPathFor(a, b, ELITE.radius, ELITE.height)).toEqual(cold.nav.findPathFor(a, b, ELITE.radius, ELITE.height));
    }
    expect(fw.marks.staging).toEqual(fc.marks.staging);
    const empty = world();
    expect(() => empty.nav.warm(1.2, 3.6)).not.toThrow();
  });

  it('incremental rebuilds leave exactly the grid a full build would (random edits near ramps and decks)', () => {
    // every structural edit is recorded so a second world can replay it and build once, in full
    type Edit = (w: PhysicsWorld, f: ReturnType<typeof buildZ04>, extra: Array<{ enabled: boolean }>) => void;
    const edits: Edit[] = [];
    const w = world();
    const f = buildZ04(w);
    const extra: Array<{ enabled: boolean }> = [];
    w.nav.rebuild();
    const rng = mulberry32(11);
    let incremental = 0;
    for (let round = 0; round < 24; round++) {
      const r = rng(), x = 8 + rng() * 48, n = 4 + rng() * 30, yaw = rng() * 3, top = 0.3 + rng() * 2.4, i = Math.floor(rng() * 4);
      let e: Edit;
      if (r < 0.3) e = (ww, ff) => { ff.highCover[i].enabled = !ff.highCover[i].enabled; };
      else if (r < 0.5) e = (ww, ff) => { const c = ff.lowCover[i]; c.setPose(c.desc.x + (x - 30) * 0.05, c.desc.y, c.desc.z + (n - 19) * 0.05, yaw); };
      else if (r < 0.6) e = (ww, ff) => { ff.door.desc.blocksMove = ff.door.desc.blocksMove === false; };
      else if (r < 0.7) e = (ww, ff) => { ff.westRamp.enabled = !ff.westRamp.enabled; };
      else if (r < 0.8) e = (ww, ff) => { ff.southRamp.setPose!(ff.southRamp.desc.x + (yaw - 1.5) * 0.1, ff.southRamp.desc.y, ff.southRamp.desc.z); };
      else if (r < 0.9 || extra.length === 0) e = (ww, ff, ex) => { ex.push(ww.addCollider({ shape: { kind: 'box', hx: 0.6, hy: top / 2, hz: 1.4 }, x, y: top / 2 + (i === 0 ? 2 : 0), z: -n, yaw })); };
      else e = (ww, ff, ex) => { ex[i % ex.length].enabled = !ex[i % ex.length].enabled; };
      edits.push(e);
      e(w, f, extra);
      w.nav.rebuild();
      if (!w.nav.stats.lastBuildFull) incremental++;
      const w2 = world();
      const f2 = buildZ04(w2);
      const extra2: Array<{ enabled: boolean }> = [];
      for (const ed of edits) ed(w2, f2, extra2);
      w2.nav.rebuild();
      expect(w.nav.nodeCount).toBe(w2.nav.nodeCount);
      for (let q = 0; q < 14; q++) {
        const a = w2.nav.randomPoint(f.marks.floorMid, 40, round * 64 + q * 2), b = w2.nav.randomPoint(f.marks.floorMid, 40, round * 64 + q * 2 + 1);
        expect(w.nav.randomPoint(f.marks.floorMid, 40, round * 64 + q * 2)).toEqual(a);
        if (!a || !b) continue;
        expect(w.nav.findPath(a, b)).toEqual(w2.nav.findPath(a, b));
        expect(w.nav.walkable(a, b)).toBe(w2.nav.walkable(a, b));
        if (q % 4 === 0) expect(w.nav.findPathFor(a, b, ELITE.radius, ELITE.height)).toEqual(w2.nav.findPathFor(a, b, ELITE.radius, ELITE.height));
      }
    }
    expect(incremental).toBeGreaterThan(18);
  });

  it('a wide agent\'s cached fit is refreshed only around what changed', () => {
    const w = world();
    const f = buildZ08(w);
    w.nav.rebuild();
    const a = f.marks.staging, b = f.marks.northOfCourt;
    const open = w.nav.findPathFor(a, b, ELITE.radius, ELITE.height)!;
    expect(open.points.length).toBe(2); // straight through the court
    for (const c of f.courtBarriers) c.enabled = true;
    const shut = w.nav.findPathFor(a, b, ELITE.radius, ELITE.height)!;
    expect(shut.length).toBeGreaterThan(open.length + 6);
    expect(w.nav.stats.lastBuildFull).toBe(false);
    for (const c of f.courtBarriers) c.enabled = false;
    expect(w.nav.findPathFor(a, b, ELITE.radius, ELITE.height)).toEqual(open);
  });
});

describe('path endpoints are exact (review: cell-granular goals)', () => {
  it('isWalkable is the exact standing test for the default agent', () => {
    const w = world();
    fxFloor(w, 0, 0, 20, 10, 0);
    fxBox(w, 9.9, 0, 10.1, 10, 0, 3); // wall, faces at x = 9.9 / 10.1
    w.nav.rebuild();
    expect(w.nav.isWalkable(9.4, 0, -5)).toBe(true); // 0.5 m clear
    expect(w.nav.isWalkable(9.46, 0, -5)).toBe(false); // 0.44 m: the cell has a node, the point does not fit
    expect(w.canStand(9.46, 0, -5, 0.4)).toBe(true); // …although a 0.4 m body does
    expect(w.nav.nearest(9.46, 0, -5)).toEqual({ x: 9.25, y: 0, z: -4.75 }); // the node centre of that cell
    expect(w.nav.isWalkable(0.2, 0, -5)).toBe(false); // inside the ledge margin of the floor's west edge
    expect(w.nav.isWalkable(0.26, 0, -5)).toBe(true);
  });

  it('every path can be completed by a 0.4 m body and keeps the agent radius clear of solids', () => {
    for (const name of ['z04', 'z08', 'z05'] as const) {
      const w = world();
      let centre: Vec3Like, span = 60;
      if (name === 'z04') centre = buildZ04(w).marks.floorMid;
      else if (name === 'z08') { const f = buildZ08(w); f.doorW.enabled = false; f.doorE.enabled = false; centre = f.marks.courtMid; }
      else { centre = buildZ05(w).marks.ringEast; span = 80; }
      w.nav.rebuild();
      const rng = mulberry32(99);
      let n = 0;
      for (let i = 0; i < 260; i++) {
        const a = w.nav.randomPoint(centre, span, i * 2 + 5), b = w.nav.randomPoint(centre, span, i * 2 + 6);
        if (!a || !b) continue;
        // endpoints anywhere in their cells, including right up against cover, walls and ledges
        a.x += (rng() - 0.5) * 0.48; a.z += (rng() - 0.5) * 0.48; b.x += (rng() - 0.5) * 0.48; b.z += (rng() - 0.5) * 0.48;
        if (!w.canStand(a.x, a.y, a.z, 0.4)) continue;
        const p = w.nav.findPath(a, b);
        if (!p) continue;
        n++;
        expect(p.points[0].x).toBe(a.x); // the caller's own position (its y corrected to the ground there)
        expect(p.points[0].z).toBe(a.z);
        expect(p.points[0].y).toBeCloseTo(w.groundAt(a.x, a.z, a.y)!.y, 9);
        const end = last(p);
        // the goal itself when the agent can stand there; otherwise a nav point within the same neighbourhood
        if (w.nav.isWalkable(b.x, b.y, b.z)) expect(Math.hypot(end.x - b.x, end.z - b.z)).toBeLessThan(1e-9);
        else expect(Math.hypot(end.x - b.x, end.z - b.z)).toBeLessThan(1.2);
        for (let k = 1; k < p.points.length; k++) {
          const q = p.points[k];
          if (!w.nav.isWalkable(q.x, q.y, q.z)) throw new Error(`${name}: path point ${k} is not walkable: ${JSON.stringify(p.points)}`);
          expect(w.nav.clearance(q.x, q.y, q.z)).toBeGreaterThanOrEqual(0.45 - 1e-6);
        }
        const r = follow(w, p);
        if (!r.reached) throw new Error(`${name}: walker stopped at ${JSON.stringify(r.pos)} on ${JSON.stringify(p.points)}`);
        expect(Math.hypot(r.pos.x - end.x, r.pos.z - end.z)).toBeLessThan(0.011);
      }
      expect(n).toBeGreaterThan(150);
    }
  });

  it('a straight walk is returned as a straight path, without hooks at either end', () => {
    const w = world();
    buildZ08(w);
    w.nav.rebuild();
    const rng = mulberry32(3);
    let direct = 0;
    for (let i = 0; i < 400; i++) {
      const a = w.nav.randomPoint(planPos(35, 24), 50, i * 2 + 1)!, b = w.nav.randomPoint(planPos(35, 24), 50, i * 2 + 2)!;
      a.x += (rng() - 0.5) * 0.4; a.z += (rng() - 0.5) * 0.4; b.x += (rng() - 0.5) * 0.4; b.z += (rng() - 0.5) * 0.4;
      // (legs that climb onto a ramp keep a waypoint at its foot so the polyline follows the ground)
      if (a.y !== 0 || b.y !== 0 || !w.nav.isWalkable(a.x, 0, a.z) || !w.nav.isWalkable(b.x, 0, b.z) || !w.nav.walkable(a, b)) continue;
      direct++;
      const p = w.nav.findPath(a, b)!;
      if (p.points.length !== 2) throw new Error(`directly walkable pair got ${p.points.length} points: ${JSON.stringify(p.points)}`);
    }
    expect(direct).toBeGreaterThan(40);
  });
});

describe('links are walkable, not just their two ends (the nav side of the soffit blocker)', () => {
  it('a soffit edge over a ramp: both nodes beside it are fine, the walk between them is not', () => {
    const w = world();
    w.addSurface({ shape: { kind: 'rect', hx: 30, hz: 30 }, x: 0, z: 0, y: 0 });
    w.addSurface({ shape: { kind: 'rect', hx: 2, hz: 6 }, x: 6, z: 0, yaw: Math.PI / 2, y: 0, y1: 3, tag: 'ramp' }); // x 0..12, rises 0 → 3
    // slab over the ramp's first 1.78 m, underside 2.25: a 1.8 m head fits under it only below x = 1.8
    const slab = w.addCollider({ shape: { kind: 'box', hx: 2, hy: 0.2, hz: 2.5 }, x: -0.22, y: 2.45, z: 0, tag: 'soffit' });
    const foot = { x: -1, y: 0, z: 0 }, up = { x: 6, y: 1.5, z: 0 };
    // the node just under the slab's edge (head clear) and the node just past it (clear of the slab) both exist
    expect(w.nav.isWalkable(1.75, 0.4375, 0)).toBe(true);
    expect(w.nav.isWalkable(2.25, 0.5625, 0)).toBe(true);
    // …but coming down the ramp the body meets the slab's edge with its head still 10 cm too high
    let pos: Vec3Like = up;
    let last = w.moveCharacter(pos, 0.4, 0, 0);
    for (let i = 0; i < 120; i++) { last = w.moveCharacter(pos, 0.4, -0.08, 0); pos = { x: last.x, y: last.y, z: last.z }; }
    expect(pos.x).toBeGreaterThan(2.17);
    expect(last).toMatchObject({ blocked: true, reason: 'solid' });
    // so nav must not link the two nodes (links are two-way), and with the ramp's sides more than a step up
    // beyond that line there is no other way
    expect(w.nav.walkable({ x: 2.25, y: 0.5625, z: 0 }, { x: 1.75, y: 0.4375, z: 0 })).toBe(false);
    expect(w.nav.findPath(up, foot)).toBeNull();
    expect(w.nav.findPath(foot, up)).toBeNull();
    expect(w.nav.findPathFor(up, foot, 0.6, 2.2)).toBeNull();
    slab.enabled = false;
    const p = w.nav.findPath(up, foot)!;
    expect(p).not.toBeNull();
    expect(follow(w, p)).toMatchObject({ reached: true, blocked: 0 });
    expect(follow(w, w.nav.findPath(foot, up)!)).toMatchObject({ reached: true, blocked: 0 });
    slab.enabled = true;
    expect(w.nav.findPath(up, foot)).toBeNull();
    // raised 30 cm the slab clears a 1.8 m head everywhere, but not a 2.2 m one: same cut, for that body only
    slab.setPose(-0.22, 2.45 + 0.3, 0);
    expect(w.nav.findPath(up, foot)).not.toBeNull();
    expect(w.nav.findPathFor(up, foot, 0.5, 2.2)).toBeNull();
    expect(w.nav.findPathFor(up, { x: 4, y: 1, z: 0 }, 0.5, 2.2)).not.toBeNull(); // above the line is still fine
  });

  it('a straight link squeezed between a solid tip and a ledge is not offered', () => {
    const w = world();
    fxFloor(w, 0, 0, 30, 10, 0); // the south edge (z = 0) is a bare ledge: feet stay 0.25 m in
    // a thin fin pointing at the ledge: its tip is 0.385 m from the row of nodes along the margin line —
    // 0.45 m clear of both neighbouring cell centres, yet 1.5 cm too close for a 0.4 m body walking between them
    w.addCollider({ shape: { kind: 'box', hx: 0.01, hy: 1, hz: 2 }, x: 13.5, y: 1, z: -0.25 - 0.385 - 2 });
    const a = planPos(12.75, 0.25), b = planPos(14.75, 0.25);
    expect(w.nav.isWalkable(13.25, 0, -0.25)).toBe(true);
    expect(w.nav.isWalkable(13.75, 0, -0.25)).toBe(true);
    const direct = w.moveCharacter(a, 0.4, 2, 0); // the body cannot pass along the margin line
    expect(direct.blocked).toBe(true);
    expect(direct.x).toBeLessThan(13.5);
    expect(w.nav.walkable(a, b)).toBe(false);
    const p = w.nav.findPath(a, b)!; // round the fin's far end instead
    expect(p).not.toBeNull();
    expect(p.length).toBeGreaterThan(9);
    expect(follow(w, p)).toMatchObject({ reached: true, blocked: 0 });
  });

  it('a thin raised strip without a solid (headroom rule only) is routed around', () => {
    const w = world();
    fxFloor(w, 0, 0, 30, 40, 0);
    // 0.2 m wide strip 0.8 m up, x 13.4..13.6, n 20..30: no cell centre lies under it
    w.addSurface({ shape: { kind: 'rect', hx: 0.1, hz: 5 }, x: 13.5, z: -25, y: 0.8, tag: 'strip' });
    const a = planPos(11, 25), b = planPos(16, 25);
    expect(w.nav.isWalkable(13.25, 0, -25)).toBe(true);
    expect(w.nav.isWalkable(13.75, 0, -25)).toBe(true);
    const straight = w.moveCharacter(a, 0.4, 5, 0);
    expect(straight).toMatchObject({ blocked: true, reason: 'edge' });
    expect(straight.x).toBeLessThanOrEqual(13.4 + 1e-6);
    expect(w.nav.walkable(a, b)).toBe(false);
    const p = w.nav.findPath(a, b)!;
    expect(p).not.toBeNull();
    expect(p.length).toBeGreaterThan(10); // round an end of the strip
    expect(follow(w, p)).toMatchObject({ reached: true, blocked: 0 });
    expect(w.validate().some((i) => i.kind === 'narrow')).toBe(true); // and the strip itself is reported
  });
});

describe('ledges (review: paths skimming the void)', () => {
  it('nav keeps the ledge margin from the Z05 shaft and never hangs a waypoint over an edge', () => {
    const w = world();
    const f = buildZ05(w);
    w.nav.rebuild();
    const round = w.nav.findPath(f.marks.ringEast, f.marks.ringWest)!;
    let min = Infinity;
    for (const p of samples(round, 0.05)) if (Math.abs(p.x) > 3) min = Math.min(min, Math.hypot(p.x, p.z) - 9);
    expect(min).toBeGreaterThanOrEqual(0.25 - 1e-6);
    expect(follow(w, round)).toMatchObject({ reached: true, blocked: 0 });
    // nothing walkable within the margin of the rim, the shaft, the bridge sides or the broken span's end
    expect(w.nav.isWalkable(9.2, 0, 0)).toBe(false);
    expect(w.nav.isWalkable(9.3, 0, 0)).toBe(true);
    expect(w.nav.isWalkable(35.8, 0, 3.5)).toBe(false);
    expect(w.nav.isWalkable(2.8, 0, 5)).toBe(false); // bridge side over the shaft
    expect(w.nav.isWalkable(2.7, 0, 5)).toBe(true);
    expect(w.nav.isWalkable(47.8, 0, 0)).toBe(false);
    expect(w.nav.nearest(47.9, 0, 0)!.x).toBeLessThanOrEqual(47.75);
    // a ledge with a drop of no more than max-drop is not a ledge
    const s = world();
    fxFloor(s, 0, 0, 10, 10, 0);
    fxFloor(s, 10, 0, 20, 10, 0.4);
    expect(s.nav.isWalkable(10.1, 0.4, -5)).toBe(true);
    expect(s.nav.findPath(planPos(15, 5, 0.4), planPos(5, 5))).not.toBeNull();
  });
});
