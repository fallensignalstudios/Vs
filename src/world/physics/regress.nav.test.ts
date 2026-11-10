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
