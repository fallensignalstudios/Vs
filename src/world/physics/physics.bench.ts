/**
 * Wall-clock benchmarks of the physics / nav hot paths:  npx vitest bench src/world/physics
 *
 * Timings depend on the machine and on what else it is doing, so nothing here is asserted — the unit tests
 * assert machine-independent effort instead (`nav.stats`: cells evaluated per build, nodes expanded per
 * search). Reference numbers on the dev container, warm, timed directly: full nav build 12–28 ms (Z04 / Z08 /
 * Z05), door-toggle rebuild ≈ 0.5 ms, findPath ≈ 0.3–0.4 ms, moveCharacter ≈ 1 µs (≈ 5 µs pressed against a
 * ledge), lineOfSight over 35 m ≈ 1.5 µs. Under `vitest bench` the module runner adds overhead to every
 * imported constant (it says so itself), so the build figures printed here read about twice as high.
 *
 * The FIRST full build of a session runs before the JIT has warmed up and takes 2–4× as long: do it on the
 * loading screen (`nav.rebuild()` in the zone's finalize step), never on the first AI query.
 */
import { describe, test } from 'vitest';
import type { MoveResult, PhysicsWorld, RayHit, Vec3Like } from '@/core/api';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ05, buildZ08, planPos } from './fixtures';

const builders: Array<[string, (w: PhysicsWorld) => unknown]> = [['Z04', buildZ04], ['Z08', buildZ08], ['Z05', buildZ05]];

/** One benchmark = one test that measures `fn` for a fixed slice of time and reports it. */
function run(name: string, fn: () => void): void {
  test(name, async ({ bench }) => { await bench(name, fn).run({ time: 250, warmupTime: 60 }); });
}

describe('nav build', () => {
  for (const [name, build] of builders) {
    const w = createPhysicsWorld(null);
    build(w);
    let flip = false;
    run(`${name} full rebuild`, () => {
      flip = !flip;
      w.nav.rebuild({ cell: flip ? 0.5 : 0.5000001 }); // a changed option forces a full build
    });
  }
  const w = createPhysicsWorld(null);
  const f = buildZ08(w);
  w.nav.rebuild();
  run('Z08 door toggle (incremental)', () => {
    f.exitDoor.enabled = !f.exitDoor.enabled;
    w.nav.rebuild();
  });
});

describe('nav queries (Z08)', () => {
  const w = createPhysicsWorld(null);
  const f = buildZ08(w);
  w.nav.rebuild();
  const pts: Vec3Like[] = [];
  for (let i = 1; pts.length < 256; i++) {
    const p = w.nav.randomPoint(f.marks.courtMid, 40, i);
    if (p) pts.push(p);
  }
  let i = 0;
  run('findPath, random cross-zone pair', () => {
    i = (i + 2) & 255;
    w.nav.findPath(pts[i], pts[i + 1]);
  });
  run('findPathFor elite (r 1.2, h 3.6), random pair', () => {
    i = (i + 2) & 255;
    w.nav.findPathFor(pts[i], pts[i + 1], 1.2, 3.6);
  });
  run('findPathFor elite, goal under the balcony (nearest reachable: floods its area)', () => {
    w.nav.findPathFor(f.marks.staging, f.marks.underBalcony, 1.2, 3.6);
  });
  run('walkable, random pair', () => {
    i = (i + 2) & 255;
    w.nav.walkable(pts[i], pts[i + 1]);
  });
});

describe('movement and rays (Z04)', () => {
  const w = createPhysicsWorld(null);
  const f = buildZ04(w);
  const out: MoveResult = { x: 0, y: 0, z: 0, blocked: false, normal: null };
  const pos = { ...f.marks.floorMid };
  let a = 0;
  run('moveCharacter, free run (allocation-free with opts.out)', () => {
    a += 0.001;
    const m = w.moveCharacter(pos, 0.4, Math.cos(a) * 0.087, Math.sin(a) * 0.087, { out });
    pos.x = m.x; pos.y = m.y; pos.z = m.z;
  });
  const wall = planPos(0.75, 10);
  run('moveCharacter, sliding along a wall', () => {
    const m = w.moveCharacter(wall, 0.4, -0.087, 0.01, { out });
    wall.x = m.x; wall.z = m.z > -30 ? m.z : -10;
  });
  const edge = planPos(50, 25, 3);
  run('moveCharacter, pressed against a balcony ledge', () => {
    const m = w.moveCharacter(edge, 0.4, -0.08, 0.002, { out });
    edge.x = m.x; edge.z = m.z;
  });
  const eye = planPos(51, 28, 4.6), target = f.marks.receiverB;
  run('lineOfSight, 35 m', () => { w.lineOfSight(eye, target); });
  const hit: RayHit = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, distance: 0, collider: null, ground: false };
  const dir = { x: -0.9, y: -0.05, z: 0.4 };
  run('raycast, 60 m (allocation-free with out)', () => { w.raycast(eye, dir, 60, undefined, hit); });
  const pivot = planPos(2, 10, 1.55), cam = planPos(-1.4, 10, 1.9);
  run('sweepSphere, 3.4 m camera boom', () => { w.sweepSphere(pivot, cam, 0.25); });
  const gh = { y: 0, surface: f.balcony };
  run('groundAt (allocation-free with out)', () => { w.groundAt(20, -8, 1, undefined, gh); });
});
