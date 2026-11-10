import { describe, expect, it } from 'vitest';
import type { NavPath, PhysicsWorld, Vec3Like } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ05, buildZ08, fxBox, fxFloor, planPos } from './fixtures';

const R = 0.4;
const world = (): PhysicsWorld => createPhysicsWorld(null);

/** Sample a path polyline every `step` metres. */
function samples(path: NavPath, step = 0.25): Vec3Like[] {
  const out: Vec3Like[] = [];
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

/** Every sample of the path stands on ground near the polyline height, clear of solids for an actor. */
function expectPathValid(w: PhysicsWorld, path: NavPath, skipEnds = 0): void {
  const pts = samples(path);
  for (let i = skipEnds; i < pts.length - skipEnds; i++) {
    const p = pts[i];
    const g = w.groundAt(p.x, p.z, p.y, 0.4);
    if (!g || Math.abs(g.y - p.y) > 0.4 || !w.canStand(p.x, g.y, p.z, R)) {
      throw new Error(`path sample ${i}/${pts.length} invalid at ${JSON.stringify(p)} (ground ${g?.y})`);
    }
  }
}

/** Walk a path with the real movement solver. */
function follow(w: PhysicsWorld, path: NavPath, speed = 5): { reached: boolean; blocked: number; time: number; pos: Vec3Like } {
  const dt = 1 / 60;
  let pos: Vec3Like = { ...path.points[0] };
  let i = 1, time = 0, blocked = 0;
  const limit = (path.length / speed) * 1.25 + 1;
  while (i < path.points.length && time < limit) {
    const tgt = path.points[i];
    const dx = tgt.x - pos.x, dz = tgt.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.02) { i++; continue; }
    const step = Math.min(d, speed * dt);
    const m = w.moveCharacter(pos, R, (dx / d) * step, (dz / d) * step);
    if (m.blocked) blocked++;
    pos = { x: m.x, y: m.y, z: m.z };
    time += dt;
  }
  return { reached: i >= path.points.length, blocked, time, pos };
}

const inRect = (p: Vec3Like, x0: number, n0: number, x1: number, n1: number): boolean =>
  p.x >= x0 && p.x <= x1 && -p.z >= n0 && -p.z <= n1;

describe('nav grid build', () => {
  it('builds Z04 with separate nodes under and on the balcony', () => {
    const w = world();
    const f = buildZ04(w);
    expect(w.nav.built).toBe(false);
    w.nav.rebuild();
    expect(w.nav.built).toBe(true);
    expect(w.nav.stale).toBe(false);
    expect(w.nav.cellSize).toBe(0.5);
    expect(w.nav.nodeCount).toBeGreaterThan(8000);
    expect(w.nav.nodeCount).toBeLessThan(12000);
    expect(w.nav.isWalkable(f.marks.balcony.x, 3, f.marks.balcony.z)).toBe(true);
    expect(w.nav.isWalkable(f.marks.underBalcony.x, 0, f.marks.underBalcony.z)).toBe(true);
    expect(w.nav.isWalkable(f.marks.balcony.x, 1.5, f.marks.balcony.z)).toBe(false); // mid-air between levels
    expect(w.nav.isWalkable(30.5, 0, -7.5)).toBe(false); // inside low cover
    expect(w.nav.isWalkable(28.8, 0, -7.5)).toBe(false); // within agent radius of it
    expect(w.nav.isWalkable(28.2, 0, -7.5)).toBe(true);
    expect(w.nav.isWalkable(51.2, 3, -25.8)).toBe(false); // inside the balcony cover
    expect(w.nav.isWalkable(100, 0, 0)).toBe(false);
    expect(w.nav.isWalkable(NaN, 0, 0)).toBe(false);
  });

  it('rebuilds a 70 × 48 m zone within budget', () => {
    const w = world();
    buildZ08(w);
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      w.nav.rebuild({ cell: i % 2 === 0 ? 0.5 : 0.5000001 }); // alternate the option to force full rebuilds
      const t0 = performance.now();
      w.nav.rebuild({ cell: i % 2 === 0 ? 0.5000001 : 0.5 });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.info(`[nav] Z08 full rebuild: best ${times[0].toFixed(2)} ms, median ${times[3].toFixed(2)} ms, nodes ${w.nav.nodeCount}`);
    expect(times[0]).toBeLessThan(40);
    expect(w.nav.nodeCount).toBeGreaterThan(11000);
  });

  it('honours cell size and agent radius options', () => {
    const w = world();
    fxFloor(w, 0, 0, 20, 10, 0);
    fxBox(w, 9.5, 0, 10.5, 4.3, 0, 3);
    fxBox(w, 9.5, 5.7, 10.5, 10, 0, 3); // 1.4 m gap at n 4.3..5.7
    w.nav.rebuild();
    const fine = w.nav.nodeCount;
    const a = planPos(3, 5), b = planPos(17, 5);
    expect(w.nav.findPath(a, b)).not.toBeNull(); // 0.45 agent fits a 1.4 m gap
    w.nav.rebuild({ agentRadius: 0.8 });
    expect(w.nav.findPath(a, b)).toBeNull(); // a 1.6 m wide agent does not
    w.nav.rebuild({ agentRadius: 0.45, cell: 1 });
    expect(w.nav.cellSize).toBe(1);
    expect(w.nav.nodeCount).toBeLessThan(fine / 3);
    w.nav.rebuild(); // options persist
    expect(w.nav.cellSize).toBe(1);
  });

  it('builds lazily on first query and copes with an empty world', () => {
    const w = world();
    expect(w.nav.findPath({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(w.nav.nearest(0, 0, 0)).toBeNull();
    expect(w.nav.randomPoint({ x: 0, y: 0, z: 0 }, 5, 1)).toBeNull();
    expect(w.nav.walkable({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(false);
    w.nav.rebuild();
    expect(w.nav.built).toBe(true);
    expect(w.nav.nodeCount).toBe(0);
    const f = buildZ04(w);
    w.nav.rebuild();
    expect(w.nav.findPath(f.marks.entry, f.marks.floorMid)).not.toBeNull();

    const w2 = world();
    const f2 = buildZ04(w2);
    expect(w2.nav.findPath(f2.marks.entry, f2.marks.floorMid)).not.toBeNull(); // no explicit rebuild
    expect(w2.nav.built).toBe(true);
  });
});

describe('nav paths — Z04', () => {
  it('finds a path up a ramp to the balcony that the movement solver can walk unobstructed', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    const path = w.nav.findPath(f.marks.floorMid, f.marks.balcony)!;
    expect(path).not.toBeNull();
    expect(path.points[0]).toEqual(f.marks.floorMid);
    const end = path.points[path.points.length - 1];
    expect(end.x).toBeCloseTo(f.marks.balcony.x);
    expect(end.z).toBeCloseTo(f.marks.balcony.z);
    expect(end.y).toBeCloseTo(3);
    const pts = samples(path);
    const onSouthRamp = pts.some((p) => inRect(p, 51, 12, 57, 22) && p.y > 0.3 && p.y < 2.8);
    const onWestRamp = pts.some((p) => inRect(p, 33, 27, 43, 33) && p.y > 0.3 && p.y < 2.8);
    expect(onSouthRamp || onWestRamp).toBe(true);
    const direct = Math.hypot(end.x - f.marks.floorMid.x, end.z - f.marks.floorMid.z);
    expect(path.length).toBeGreaterThan(direct);
    expect(path.length).toBeLessThan(direct * 1.45);
    expect(path.points.length).toBeLessThan(14); // string-pulled, not a cell staircase
    expectPathValid(w, path);
    const walk = follow(w, path);
    expect(walk.reached).toBe(true);
    expect(walk.blocked).toBe(0);
    expect(walk.pos.y).toBeCloseTo(3);
    expect(walk.time).toBeLessThan(path.length / 5 + 0.5);
  });

  it('routes to the level asked for at the same XZ', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    const low = w.nav.findPath(f.marks.floorMid, f.marks.underBalcony)!;
    const high = w.nav.findPath(f.marks.floorMid, f.marks.balcony)!;
    expect(low.points[low.points.length - 1].y).toBeCloseTo(0);
    expect(high.points[high.points.length - 1].y).toBeCloseTo(3);
    expect(high.length).toBeGreaterThan(low.length + 3);
    expect(samples(low).every((p) => p.y < 0.01)).toBe(true);
    // down the west ramp and round to the pocket through the 2 m link at the balcony's north-west corner
    const pocket = w.nav.findPath(f.marks.westRampFoot, f.marks.pocket)!;
    expect(pocket).not.toBeNull();
    expectPathValid(w, pocket);
    expect(follow(w, pocket).reached).toBe(true);
  });

  it('keeps waypoints at ramp ends so the polyline follows the ground', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    const path = w.nav.findPath(f.marks.rampFoot, f.marks.rampTop)!;
    for (const p of samples(path)) {
      const g = w.groundAt(p.x, p.z, p.y, 0.5)!;
      expect(Math.abs(g.y - p.y)).toBeLessThan(0.31);
    }
  });

  it('door state changes reachability after rebuild (incremental == full)', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    expect(w.nav.findPath(f.marks.floorMid, f.marks.exitOutside)).toBeNull();
    expect(w.nav.walkable(f.marks.exitInside, f.marks.exitOutside)).toBe(false);

    f.door.enabled = false;
    expect(w.nav.stale).toBe(true);
    expect(w.nav.findPath(f.marks.floorMid, f.marks.exitOutside)).toBeNull(); // not rebuilt yet
    const t0 = performance.now();
    w.nav.rebuild();
    const ms = performance.now() - t0;
    console.info(`[nav] Z04 incremental door rebuild: ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(10);
    expect(w.nav.stale).toBe(false);
    const open = w.nav.findPath(f.marks.floorMid, f.marks.exitOutside)!;
    expect(open).not.toBeNull();
    expect(w.nav.walkable(f.marks.exitInside, f.marks.exitOutside)).toBe(true);
    expect(follow(w, open).reached).toBe(true);

    // identical to a world built from scratch with the door open
    const w2 = world();
    const f2 = buildZ04(w2);
    f2.door.enabled = false;
    w2.nav.rebuild();
    expect(w2.nav.nodeCount).toBe(w.nav.nodeCount);
    expect(w2.nav.findPath(f2.marks.floorMid, f2.marks.exitOutside)).toEqual(open);

    f.door.enabled = true;
    w.nav.rebuild();
    expect(w.nav.findPath(f.marks.floorMid, f.marks.exitOutside)).toBeNull();
    const before = w.nav.nodeCount;
    w.nav.rebuild(); // nothing changed: no-op
    expect(w.nav.nodeCount).toBe(before);
  });

  it('moving and removing colliders updates nav incrementally', () => {
    const w = world();
    fxFloor(w, 0, 0, 30, 6, 0);
    const crate = fxBox(w, 14, 0, 16, 6, 0, 2); // seals the corridor
    w.nav.rebuild();
    const a = planPos(3, 3), b = planPos(27, 3);
    expect(w.nav.findPath(a, b)).toBeNull();
    crate.setPose(15, 1, -8); // slid out of the corridor (off the floor)
    w.nav.rebuild();
    const p = w.nav.findPath(a, b)!;
    expect(p.length).toBeCloseTo(24, 1);
    expect(p.points.length).toBe(2);
    crate.setPose(15, 1, -3);
    w.nav.rebuild();
    expect(w.nav.findPath(a, b)).toBeNull();
    crate.remove();
    w.nav.rebuild();
    expect(w.nav.findPath(a, b)).not.toBeNull();
    // surfaces too: a bridge segment switched off splits the grid
    const w2 = world();
    fxFloor(w2, 0, 0, 10, 6, 0);
    const span = fxFloor(w2, 10, 1, 20, 5, 0);
    fxFloor(w2, 20, 0, 30, 6, 0);
    w2.nav.rebuild();
    expect(w2.nav.findPath(a, b)).not.toBeNull();
    span.enabled = false;
    w2.nav.rebuild();
    expect(w2.nav.findPath(a, b)).toBeNull();
    span.enabled = true;
    w2.nav.rebuild();
    expect(w2.nav.findPath(a, b)).not.toBeNull();
  });
});

describe('nav paths — Z08', () => {
  it('goes through the open court and around it once the isolation barriers rise', () => {
    const w = world();
    const f = buildZ08(w);
    w.nav.rebuild();
    const through = w.nav.findPath(f.marks.staging, f.marks.northOfCourt)!;
    expect(through).not.toBeNull();
    expect(samples(through).some((p) => inRect(p, 27, 18, 43, 30))).toBe(true);
    expect(through.length).toBeLessThan(40);
    expectPathValid(w, through);

    for (const b of f.courtBarriers) b.enabled = true;
    w.nav.rebuild();
    const around = w.nav.findPath(f.marks.staging, f.marks.northOfCourt)!;
    expect(around).not.toBeNull();
    const pts = samples(around);
    expect(pts.some((p) => inRect(p, 26.5, 17.5, 43.5, 30.5))).toBe(false);
    expect(around.length).toBeGreaterThan(through.length + 6);
    expect(pts.some((p) => inRect(p, 15, 17, 26, 31) || inRect(p, 44, 17, 54, 31))).toBe(true); // W or E loop
    expectPathValid(w, around);
    const walk = follow(w, around);
    expect(walk.reached).toBe(true);
    expect(walk.blocked).toBe(0);
    // the court interior is now its own island
    expect(w.nav.findPath(f.marks.staging, f.marks.courtMid)).toBeNull();
    expect(w.nav.findPath(f.marks.courtMid, planPos(30, 20))).not.toBeNull();
  });

  it('returns null for sealed rooms until their doors open', () => {
    const w = world();
    const f = buildZ08(w);
    w.nav.rebuild();
    expect(w.nav.findPath(f.marks.staging, f.marks.roomW)).toBeNull();
    expect(w.nav.findPath(f.marks.staging, f.marks.roomE)).toBeNull();
    expect(w.nav.findPath(f.marks.staging, f.marks.exitOutside)).toBeNull();
    expect(w.nav.findPath(f.marks.staging, { x: 300, y: 0, z: 300 })).toBeNull(); // off the map
    expect(w.nav.findPath(f.marks.roomW, planPos(12, 43))).not.toBeNull(); // inside the room is fine
    f.doorW.enabled = false;
    w.nav.rebuild();
    const p = w.nav.findPath(f.marks.staging, f.marks.roomW)!;
    expect(p).not.toBeNull();
    expect(samples(p).some((s) => inRect(s, 6, 34.5, 11, 35.5))).toBe(true); // through the S-W doorway
    expectPathValid(w, p);
    expect(w.nav.findPath(f.marks.staging, f.marks.roomE)).toBeNull();
  });

  it('reaches the east balcony by either ramp and is deterministic', () => {
    const run = (): NavPath[] => {
      const w = world();
      const f = buildZ08(w);
      w.nav.rebuild();
      const out = [
        w.nav.findPath(f.marks.staging, f.marks.balcony)!,
        w.nav.findPath(f.marks.northOfCourt, f.marks.balcony)!,
        w.nav.findPath(f.marks.balcony, f.marks.westLoop)!,
        w.nav.findPath(f.marks.underBalcony, f.marks.balcony)!,
      ];
      for (const p of out) { expect(p).not.toBeNull(); expectPathValid(w, p); expect(follow(w, p).reached).toBe(true); }
      // repeated queries on the same grid are stable
      expect(w.nav.findPath(f.marks.staging, f.marks.balcony)).toEqual(out[0]);
      return out;
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(samples(a[0]).some((p) => inRect(p, 54, 7, 60, 15))).toBe(true); // south ramp from the entry
    expect(samples(a[1]).some((p) => inRect(p, 54, 31, 60, 39))).toBe(true); // north ramp from the exit side
    expect(a[3].length).toBeGreaterThan(15); // directly underneath is a long way round
  });

  it('typical queries are fast', () => {
    const w = world();
    buildZ08(w);
    w.nav.rebuild();
    const rng = mulberry32(5);
    const pts: Vec3Like[] = [];
    while (pts.length < 300) {
      const p = w.nav.randomPoint(planPos(35, 24), 40, Math.floor(rng() * 1e9));
      if (p) pts.push(p);
    }
    for (let i = 0; i + 1 < 60; i += 2) w.nav.findPath(pts[i], pts[i + 1]); // warm-up
    let found = 0, total = 0;
    const t0 = performance.now();
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const p = w.nav.findPath(pts[i], pts[i + 1]);
      if (p) { found++; total += p.length; }
    }
    const ms = (performance.now() - t0) / (pts.length / 2);
    console.info(`[nav] Z08 findPath: ${ms.toFixed(3)} ms avg over ${pts.length / 2} random pairs (mean length ${(total / found).toFixed(1)} m)`);
    expect(found).toBe(pts.length / 2);
    expect(ms).toBeLessThan(1.5);
  });
});

describe('nav paths — Z05', () => {
  it('crosses the shaft on the bridge and walks round it otherwise', () => {
    const w = world();
    const f = buildZ05(w);
    w.nav.rebuild();
    const across = w.nav.findPath(f.marks.southApproach, f.marks.northApproach)!;
    expect(across).not.toBeNull();
    expect(across.length).toBeCloseTo(108, 0);
    expect(across.points.length).toBeLessThanOrEqual(3);
    expectPathValid(w, across);

    const round = w.nav.findPath(f.marks.ringEast, f.marks.ringWest)!;
    expect(round).not.toBeNull();
    expect(round.length).toBeGreaterThan(40.5);
    expect(round.length).toBeLessThan(52);
    for (const p of samples(round)) {
      const onBridge = Math.abs(p.x) <= 3 && Math.abs(p.z) <= 9.5;
      expect(Math.hypot(p.x, p.z) >= 9 || onBridge).toBe(true);
    }
    expectPathValid(w, round);
    const walk = follow(w, round);
    expect(walk.reached).toBe(true);
    expect(walk.blocked).toBe(0);

    const span = w.nav.findPath(f.marks.southRim, f.marks.brokenSpanEnd)!;
    expect(span).not.toBeNull();
    expect(follow(w, span).reached).toBe(true);
  });
});

describe('nav point queries', () => {
  it('nearest snaps off-nav points and keeps on-nav points', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    expect(w.nav.nearest(10, 0, -10)).toEqual({ x: 10, y: 0, z: -10 });
    const inCover = w.nav.nearest(30.5, 0, -6.4)!; // inside the low cover near its south face
    expect(w.nav.isWalkable(inCover.x, inCover.y, inCover.z)).toBe(true);
    expect(-inCover.z).toBeLessThan(6);
    expect(Math.hypot(inCover.x - 30.5, inCover.z + 6.4)).toBeLessThan(1.5);
    const outside = w.nav.nearest(-1.5, 0, -20)!; // beyond the west wall
    expect(outside.x).toBeGreaterThan(0.7);
    expect(outside.x).toBeLessThan(1.3);
    expect(w.nav.nearest(-30, 0, -20)).toBeNull();
    expect(w.nav.nearest(-30, 0, -20, 40)).not.toBeNull();
    // level aware: just off the balcony edge at deck height snaps back onto the deck, not the floor below
    const deck = w.nav.nearest(43.6, 3, -25)!;
    expect(deck.y).toBeCloseTo(3);
    expect(deck.x).toBeGreaterThanOrEqual(44);
    // exact ground height on a ramp
    const ramp = w.nav.nearest(54.1, 1.4, -17.1)!;
    expect(ramp.y).toBeCloseTo(((17.1 - 11) / 12) * 3, 5);
    expect(f.balcony.desc.y).toBe(3);
  });

  it('randomPoint is deterministic, in range and reachable', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    const c = f.marks.floorMid;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const p = w.nav.randomPoint(c, 12, seed)!;
      expect(p).toEqual(w.nav.randomPoint(c, 12, seed));
      expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeLessThanOrEqual(12 + 0.36);
      expect(w.nav.isWalkable(p.x, p.y, p.z)).toBe(true);
      expect(w.nav.findPath(c, p)).not.toBeNull();
      seen.add(`${p.x},${p.z}`);
    }
    expect(seen.size).toBeGreaterThan(30);
    // around the exit: never lands behind the closed door
    for (let seed = 1; seed <= 40; seed++) {
      const p = w.nav.randomPoint(f.marks.exitInside, 8, seed)!;
      expect(-p.z).toBeLessThan(37.8);
    }
    // on the balcony the points stay reachable (deck or ramps), never mid-air
    for (let seed = 1; seed <= 20; seed++) {
      const p = w.nav.randomPoint(f.marks.balcony, 6, seed)!;
      expect(w.groundAt(p.x, p.z, p.y, 0.1)!.y).toBeCloseTo(p.y, 5);
    }
    expect(w.nav.randomPoint({ x: 500, y: 0, z: 500 }, 5, 1)).toBeNull();
  });

  it('walkable is true only for genuinely clear straight walks', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    expect(w.nav.walkable(planPos(5, 5), planPos(20, 9))).toBe(true);
    expect(w.nav.walkable(planPos(30.5, 3), planPos(30.5, 12))).toBe(false); // low cover in the way
    expect(w.nav.walkable(planPos(33.6, 3), planPos(33.6, 12))).toBe(true); // lane beside it
    expect(w.nav.walkable(planPos(32.6, 3), planPos(32.6, 12))).toBe(false); // would clip the corner
    expect(w.nav.walkable(f.marks.rampFoot, f.marks.rampTop)).toBe(true); // straight up the ramp
    expect(w.nav.walkable(planPos(47, 30), f.marks.balcony)).toBe(false); // floor → deck without a ramp
    expect(w.nav.walkable(f.marks.underBalcony, f.marks.balcony)).toBe(false);
    expect(w.nav.walkable(planPos(50, 25, 3), planPos(42, 25, 0))).toBe(false); // off the deck edge
    expect(w.nav.walkable(planPos(5, 5), planPos(-5, 5))).toBe(false); // through the perimeter wall
    expect(w.nav.walkable({ x: NaN, y: 0, z: 0 }, planPos(5, 5))).toBe(false);
    // walkable lines really are clear for the movement solver
    const rng = mulberry32(77);
    let clear = 0;
    for (let i = 0; i < 400; i++) {
      const a = w.nav.randomPoint(planPos(31, 19), 30, i * 2 + 1)!, b = w.nav.randomPoint(planPos(31, 19), 30, i * 2 + 2)!;
      if (rng() < 0 || !w.nav.walkable(a, b)) continue;
      clear++;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const m = w.moveCharacter(a, R, b.x - a.x, b.z - a.z);
      if (m.blocked || Math.hypot(m.x - b.x, m.z - b.z) > 1e-6) {
        throw new Error(`walkable line ${JSON.stringify(a)} → ${JSON.stringify(b)} (${d.toFixed(1)} m) was blocked at ${JSON.stringify(m)}`);
      }
    }
    expect(clear).toBeGreaterThan(40);
  });

  it('handles degenerate path requests', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    const same = w.nav.findPath(f.marks.floorMid, f.marks.floorMid)!;
    expect(same.length).toBeLessThan(1e-6);
    expect(same.points.length).toBeGreaterThanOrEqual(1);
    expect(w.nav.findPath({ x: NaN, y: 0, z: 0 }, f.marks.floorMid)).toBeNull();
    expect(w.nav.findPath(null as never, f.marks.floorMid)).toBeNull();
    // start hugging a wall (off the node lattice) still paths; first point is the true start
    const hug = planPos(0.72, 10.3);
    const p = w.nav.findPath(hug, f.marks.floorMid)!;
    expect(p.points[0]).toEqual(hug);
    expect(follow(w, p).reached).toBe(true);
    // goal inside cover: ends at the nearest nav point beside it
    const q = w.nav.findPath(f.marks.floorMid, planPos(30.5, 7.5))!;
    const end = q.points[q.points.length - 1];
    expect(w.nav.isWalkable(end.x, end.y, end.z)).toBe(true);
    expect(Math.hypot(end.x - 30.5, end.z + 7.5)).toBeLessThan(2.6);
  });
});
