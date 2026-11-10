import { describe, expect, it } from 'vitest';
import type { PhysicsWorld, Vec3Like } from '@/core/api';
import { RAY_GROUND, RAY_MOVE, RAY_SHOT, RAY_SIGHT } from '@/core/api/physics';
import { mulberry32 } from '@/core/mathx';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ05, buildZ08, fxBox, fxFloor, planPos } from './fixtures';

const world = (): PhysicsWorld => createPhysicsWorld(null);
const v = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });

describe('raycast vs boxes and cylinders', () => {
  it('reports distance, point and face normal for an axis-aligned box', () => {
    const w = world();
    const box = fxBox(w, 4, 4, 6, 6, 0, 2.2); // world x 4..6, z −6..−4
    const east = w.raycast(v(0, 1, -5), v(1, 0, 0), 50)!;
    expect(east.distance).toBeCloseTo(4, 9);
    expect(east.point).toEqual({ x: 4, y: 1, z: -5 });
    expect(east.normal).toEqual({ x: -1, y: 0, z: 0 });
    expect(east.collider).toBe(box);
    expect(east.ground).toBe(false);

    const down = w.raycast(v(5, 10, -5), v(0, -1, 0), 50)!;
    expect(down.distance).toBeCloseTo(7.8, 9);
    expect(down.normal).toEqual({ x: 0, y: 1, z: 0 });

    const south = w.raycast(v(5, 1, -10), v(0, 0, 1), 50)!;
    expect(south.distance).toBeCloseTo(4, 9);
    expect(south.normal.z).toBe(-1);

    const west = w.raycast(v(9, 0.5, -4.5), v(-1, 0, 0), 50)!;
    expect(west.distance).toBeCloseTo(3, 9);
    expect(west.normal.x).toBe(1);

    // un-normalised direction: distance is still metres
    const diag = w.raycast(v(0, 1, -1), v(10, 0, -10), 50)!;
    expect(diag.distance).toBeCloseTo(Math.hypot(4, 4), 9);
    expect(diag.point.x).toBeCloseTo(4);
    expect(diag.point.z).toBeCloseTo(-5);

    expect(w.raycast(v(0, 1, -5), v(1, 0, 0), 3.9)).toBeNull(); // out of range
    expect(w.raycast(v(0, 3, -5), v(1, 0, 0), 50)).toBeNull(); // over the top
    expect(w.raycast(v(0, 1, -5), v(-1, 0, 0), 50)).toBeNull(); // facing away
    expect(w.raycast(v(0, 1, -5), v(0, 0, 0), 50)).toBeNull(); // degenerate
    expect(w.raycast(v(NaN, 1, -5), v(1, 0, 0), 50)).toBeNull();
  });

  it('handles rotated boxes', () => {
    const w = world();
    w.addCollider({ shape: { kind: 'box', hx: 1, hy: 1, hz: 1 }, x: 0, y: 1, z: 0, yaw: Math.PI / 4 });
    const h = w.raycast(v(-5, 1, 0.5), v(1, 0, 0), 20)!;
    expect(h.distance).toBeCloseTo(5 - (Math.SQRT2 - 0.5), 6);
    expect(h.normal.x).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(h.normal.z).toBeCloseTo(Math.SQRT1_2, 6);
    expect(h.normal.y).toBe(0);
    const tip = w.raycast(v(0, 1, -5), v(0, 0, 1), 20)!;
    expect(tip.distance).toBeCloseTo(5 - Math.SQRT2, 6);
  });

  it('handles cylinder sides and caps', () => {
    const w = world();
    const f = buildZ04(w);
    const side = w.raycast(planPos(30, 18, 1), v(1, 0, 0), 20)!;
    expect(side.collider).toBe(f.receiverA);
    expect(side.distance).toBeCloseTo(4.3, 6);
    expect(side.normal.x).toBeCloseTo(-1, 6);
    const off = w.raycast(planPos(30, 18.35, 1), v(1, 0, 0), 20)!;
    expect(off.distance).toBeCloseTo(5 - Math.sqrt(0.49 - 0.35 * 0.35), 6);
    expect(off.normal.x).toBeCloseTo(-Math.sqrt(0.49 - 0.35 * 0.35) / 0.7, 6);
    expect(off.normal.z).toBeCloseTo(-0.5, 6);
    const cap = w.raycast(planPos(35, 18, 5), v(0, -1, 0), 20)!;
    expect(cap.distance).toBeCloseTo(2.6, 6);
    expect(cap.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(w.raycast(planPos(30, 18.71, 1), v(1, 0, 0), 4)).toBeNull(); // grazes past
    expect(w.raycast(planPos(30, 18, 2.5), v(1, 0, 0), 8)).toBeNull(); // over it
  });

  it('a ray starting inside a solid hits at distance 0 with the reversed direction as normal', () => {
    const w = world();
    fxBox(w, 4, 4, 6, 6, 0, 2.2);
    const h = w.raycast(v(5, 1, -5), v(1, 0, 0), 10)!;
    expect(h.distance).toBe(0);
    expect(h.normal.x).toBe(-1);
    // starting exactly on a face and leaving is a miss
    expect(w.raycast(v(6, 1, -5), v(1, 0, 0), 10)).toBeNull();
  });

  it('filters by mask and ignores disabled colliders', () => {
    const w = world();
    const rail = fxBox(w, 4, 0, 4.1, 10, 0, 1.1, { blocksSight: false, blocksShots: false });
    const glass = fxBox(w, 8, 0, 8.1, 10, 0, 3, { blocksSight: false });
    const curtain = fxBox(w, 12, 0, 12.1, 10, 0, 3, { blocksMove: false, blocksShots: false });
    const wall = fxBox(w, 16, 0, 16.3, 10, 0, 3);
    const o = v(0, 0.8, -5), d = v(1, 0, 0);
    expect(w.raycast(o, d, 50)!.collider).toBe(glass); // default: anything physical
    expect(w.raycast(o, d, 50, RAY_MOVE)!.collider).toBe(rail);
    expect(w.raycast(o, d, 50, RAY_SIGHT)!.collider).toBe(curtain);
    expect(w.raycast(o, d, 50, RAY_SHOT)!.collider).toBe(glass);
    glass.enabled = false;
    expect(w.raycast(o, d, 50, RAY_SHOT)!.collider).toBe(wall);
    wall.desc.blocksShots = false; // flags are read live
    expect(w.raycast(o, d, 50, RAY_SHOT)).toBeNull();
    expect(w.raycast(o, d, 50, 0)).toBeNull();
  });
});

describe('raycast vs walkable surfaces (RAY_GROUND)', () => {
  it('hits flat floors, ramps (with slope normal) and reports ground hits', () => {
    const w = world();
    buildZ04(w);
    const floor = w.raycast(planPos(5, 5, 1.6), v(0, -1, 0), 10, RAY_GROUND)!;
    expect(floor.distance).toBeCloseTo(1.6, 9);
    expect(floor.ground).toBe(true);
    expect(floor.collider).toBeNull();
    expect(floor.surface?.desc.tag).toBe('floor');
    expect(floor.normal).toEqual({ x: 0, y: 1, z: 0 });
    // floors are physical: sight and shot rays meet them too; a movement-only ray does not
    expect(w.raycast(planPos(5, 5, 1.6), v(0, -1, 0), 10)!.ground).toBe(true);
    expect(w.raycast(planPos(5, 5, 1.6), v(0, -1, 0), 10, RAY_SHOT)!.distance).toBeCloseTo(1.6, 9);
    expect(w.raycast(planPos(5, 5, 1.6), v(0, -1, 0), 10, RAY_MOVE)).toBeNull();

    // south ramp: 0 at n = 11 → 3 at n = 23; at n = 17 the surface is at 1.5
    const ramp = w.raycast(planPos(54, 17, 5), v(0, -1, 0), 10, RAY_GROUND)!;
    expect(ramp.distance).toBeCloseTo(3.5, 6);
    expect(ramp.surface?.desc.tag).toBe('ramp');
    const nl = Math.hypot(1, 0.25);
    expect(ramp.normal.x).toBeCloseTo(0, 9);
    expect(ramp.normal.y).toBeCloseTo(1 / nl, 6);
    expect(ramp.normal.z).toBeCloseTo(0.25 / nl, 6); // leans south (downhill)

    // horizontal ray at 1 m flying north meets the ramp where it reaches 1 m (n = 15)
    const level = w.raycast(planPos(54, 5, 1), v(0, 0, -1), 30, RAY_GROUND)!;
    expect(level.distance).toBeCloseTo(10, 6);
    expect(level.ground).toBe(true);

    // rotated west ramp: 0 at x = 32 → 3 at x = 44; normal leans west
    const wr = w.raycast(planPos(38, 30, 6), v(0, -1, 0), 10, RAY_GROUND)!;
    expect(wr.distance).toBeCloseTo(4.5, 6);
    expect(wr.normal.x).toBeCloseTo(-0.25 / nl, 6);
    expect(wr.normal.z).toBeCloseTo(0, 6);

    // combined with solids the nearest of both wins
    const both = w.raycast(planPos(30.5, 7.5, 4), v(0, -1, 0), 10, RAY_GROUND | RAY_SHOT)!;
    expect(both.ground).toBe(false);
    expect(both.surface).toBeNull();
    expect(both.distance).toBeCloseTo(2.8, 6); // top of the 1.2 m cover
    // the balcony deck is hit from below as well (floors are two-sided)
    const below = w.raycast(planPos(51, 30, 1), v(0, 1, 0), 10, RAY_GROUND)!;
    expect(below.distance).toBeCloseTo(2, 6);
    expect(below.normal.y).toBe(-1);
    // a ray leaving the floor it starts on does not hit it
    expect(w.raycast(planPos(5, 5, 0), v(0.6, 0.8, 0), 2, RAY_GROUND)).toBeNull();
  });

  it('respects disc holes', () => {
    const w = world();
    buildZ05(w);
    expect(w.raycast(v(6, 3, 5), v(0, -1, 0), 20, RAY_GROUND)).toBeNull(); // down the shaft
    expect(w.raycast(v(1, 3, 5), v(0, -1, 0), 20, RAY_GROUND)!.distance).toBeCloseTo(3); // bridge
    expect(w.raycast(v(20, 3, 5), v(0, -1, 0), 20, RAY_GROUND)!.distance).toBeCloseTo(3); // platform
    expect(w.raycast(v(40, 3, 20), v(0, -1, 0), 20, RAY_GROUND)).toBeNull(); // beyond the rim
  });
});

describe('lineOfSight / lineOfFire', () => {
  it('sees over low cover from eye height but not through high cover', () => {
    const w = world();
    buildZ04(w);
    // 29..32 × 6..9 low cover (1.2 m)
    expect(w.lineOfSight(planPos(30.5, 4, 1.6), planPos(30.5, 12, 1.6))).toBe(true);
    expect(w.lineOfSight(planPos(30.5, 4, 0.9), planPos(30.5, 12, 0.9))).toBe(false); // crouched behind it
    expect(w.lineOfSight(planPos(30.5, 4, 1.6), planPos(30.5, 9.6, 0.5))).toBe(false); // target hugging the far side
    // 24..27 × 14..17 high cover (2.2 m)
    expect(w.lineOfSight(planPos(25.5, 12, 1.6), planPos(25.5, 19, 1.6))).toBe(false);
    expect(w.lineOfSight(planPos(25.5, 12, 1.6), planPos(31, 15.5, 1.6))).toBe(true); // around the side
    expect(w.lineOfFire(planPos(25.5, 12, 1.6), planPos(25.5, 19, 1.6))).toBe(false);
    // symmetric
    expect(w.lineOfSight(planPos(25.5, 19, 1.6), planPos(25.5, 12, 1.6))).toBe(false);
    // degenerate segment
    expect(w.lineOfSight(planPos(5, 5, 1.6), planPos(5, 5, 1.6))).toBe(true);
  });

  it('separates sight from fire for rails, kerbs and glass', () => {
    const w = world();
    const f8 = buildZ08(w);
    // court kerb: 1 m, see-through but stops shots
    const a = planPos(29, 14, 0.6), b = planPos(29, 20, 0.6);
    expect(w.lineOfSight(a, b)).toBe(true);
    expect(w.lineOfFire(a, b)).toBe(false);
    expect(w.lineOfFire(planPos(29, 14, 1.4), planPos(29, 20, 1.4))).toBe(true); // over the kerb
    expect(f8.courtBarriers.every((c) => !c.enabled)).toBe(true);

    const w4 = world();
    buildZ04(w4);
    // balcony rail at x = 58 (y 3..4.1): neither sight nor shots are blocked, movement is
    const p = planPos(57, 30, 3.8), q = planPos(60, 30, 3.8);
    expect(w4.lineOfSight(p, q)).toBe(true);
    expect(w4.lineOfFire(p, q)).toBe(true);
    expect(w4.raycast(p, { x: 1, y: 0, z: 0 }, 5, RAY_MOVE)!.distance).toBeCloseTo(0.95, 6);
  });

  it('is blocked by the balcony slab from directly below but open from the floor at range', () => {
    const w = world();
    const f = buildZ04(w);
    expect(w.lineOfSight(planPos(51, 30, 1.6), planPos(51, 30, 4.6))).toBe(false);
    // from the low route looking up at someone at the west balcony edge
    expect(w.lineOfSight(planPos(30, 22, 1.6), planPos(44.6, 25, 4.6))).toBe(true);
    // the +3 m overlook has the oblique shot at receiver B (plan 16,27) ~35 m away
    const eye = { x: f.marks.overlook.x, y: 4.6, z: f.marks.overlook.z };
    expect(Math.hypot(eye.x - f.marks.receiverB.x, eye.z - f.marks.receiverB.z)).toBeGreaterThan(30);
    expect(w.lineOfFire(eye, f.marks.receiverB)).toBe(true);
  });

  it('ignores solids that contain an endpoint (aiming at a device centre)', () => {
    const w = world();
    const f = buildZ04(w);
    const eye = planPos(31, 4, 1.6);
    expect(w.lineOfSight(eye, f.marks.receiverA)).toBe(true); // the receiver's own collider does not block
    expect(w.lineOfSight(f.marks.receiverA, eye)).toBe(true);
    // …but other solids still do: high cover 24..27 × 14..17 sits between this eye and receiver A
    expect(w.lineOfSight(planPos(15, 13, 1.6), f.marks.receiverA)).toBe(false);
    // a raw raycast still reports the device surface
    const dir = { x: f.marks.receiverA.x - eye.x, y: 0, z: f.marks.receiverA.z - eye.z };
    expect(w.raycast(eye, dir, 50)!.collider).toBe(f.receiverA);
  });
});

describe('sweepSphere', () => {
  it('returns the allowed fraction with shapes inflated by the radius', () => {
    const w = world();
    fxFloor(w, 0, 0, 20, 20, 0);
    fxBox(w, 4, 4, 6, 6, 0, 2.2);
    w.addCollider({ shape: { kind: 'cyl', r: 0.7, hy: 1.2 }, x: 15, y: 1.2, z: -15 });
    const f = w.sweepSphere(v(0, 1, -5), v(10, 1, -5), 0.25);
    expect(f).toBeCloseTo((4 - 0.25 - 0.01) / 10, 6);
    expect(w.sweepSphere(v(0, 1, -8), v(10, 1, -8), 0.25)).toBe(1); // clear lane
    expect(w.sweepSphere(v(0, 1, -6.2), v(10, 1, -6.2), 0.25)).toBeLessThan(1); // radius clips the corner
    expect(w.sweepSphere(v(0, 1, -6.3), v(10, 1, -6.3), 0.25)).toBe(1);
    // starts overlapping: only motion that goes deeper in is stopped
    expect(w.sweepSphere(v(3.9, 1, -5), v(6, 1, -5), 0.25)).toBe(0);
    expect(w.sweepSphere(v(3.9, 1, -5), v(0, 1, -5), 0.25)).toBe(1); // backing out
    expect(w.sweepSphere(v(3.9, 1, -5), v(3.9, 1, -2), 0.25)).toBe(1); // sliding along the face
    expect(w.sweepSphere(v(3.9, 1, -5), v(3.9, 3, -5), 0.25)).toBe(1);
    expect(w.sweepSphere(v(14.2, 1.2, -15), v(10, 1.2, -15), 0.25)).toBe(1); // same for cylinders
    expect(w.sweepSphere(v(14.2, 1.2, -15), v(15, 1.2, -15), 0.25)).toBe(0);
    expect(w.sweepSphere(v(1, 1, -1), v(1, 1, -1), 0.25)).toBe(1); // zero length
    expect(w.sweepSphere(v(10, 1.2, -15), v(16, 1.2, -15), 0.25)).toBeCloseTo((5 - 0.7 - 0.25 - 0.01) / 6, 6);
    // over the top of the box with clearance, and too low
    expect(w.sweepSphere(v(0, 2.5, -5), v(10, 2.5, -5), 0.25)).toBe(1);
    expect(w.sweepSphere(v(0, 2.4, -5), v(10, 2.4, -5), 0.25)).toBeLessThan(0.5);
    // floors only when asked
    expect(w.sweepSphere(v(10, 2, -10), v(10, -1, -10), 0.25)).toBe(1);
    expect(w.sweepSphere(v(10, 2, -10), v(10, -1, -10), 0.25, RAY_SIGHT | RAY_GROUND)).toBeCloseTo((1.75 - 0.01) / 3, 6);
    // default mask stops at glass and invisible blockers too; RAY_SIGHT alone passes them
    const glass = fxBox(w, 12, 17, 12.1, 20, 0, 3, { blocksSight: false });
    const blocker = fxBox(w, 16, 17, 16.1, 20, 0, 3, { blocksSight: false, blocksShots: false });
    expect(w.sweepSphere(v(10, 1.5, -18.5), v(19, 1.5, -18.5), 0.25)).toBeCloseTo((2 - 0.25 - 0.01) / 9, 6);
    expect(w.sweepSphere(v(10, 1.5, -18.5), v(19, 1.5, -18.5), 0.25, RAY_SIGHT)).toBe(1);
    glass.enabled = false;
    expect(w.sweepSphere(v(10, 1.5, -18.5), v(19, 1.5, -18.5), 0.25)).toBeCloseTo((6 - 0.25 - 0.01) / 9, 6);
    blocker.enabled = false;
    expect(w.sweepSphere(v(10, 1.5, -18.5), v(19, 1.5, -18.5), 0.25)).toBe(1);
    expect(w.sweepSphere(v(NaN, 2, -10), v(10, -1, -10), 0.25)).toBe(0);
  });

  it('keeps a follow camera out of walls but lets it pass rails', () => {
    const w = world();
    buildZ04(w);
    // player backed against the west wall (inner face x = 0.3); camera wants to sit 3.4 m behind
    const pivot = planPos(2, 10, 1.55), want = planPos(-1.4, 10, 1.9);
    const f = w.sweepSphere(pivot, want, 0.25);
    const camX = pivot.x + (want.x - pivot.x) * f;
    expect(camX).toBeGreaterThanOrEqual(0.3 + 0.25);
    expect(camX).toBeLessThan(0.3 + 0.25 + 0.03);
    // stopping there and sweeping again never starts inside
    const again = w.sweepSphere(v(camX, 1.8, -10), v(camX, 1.8, -14), 0.25);
    expect(again).toBe(1);
    // on the balcony a camera at head height clears the 1.1 m rail (x = 58); the outer wall (x = 61.7) stops it
    const p2 = planPos(56, 30, 4.55), w2 = planPos(59.4, 30, 4.9);
    expect(w.sweepSphere(p2, w2, 0.25)).toBe(1);
    expect(w.sweepSphere(p2, planPos(63, 30, 4.9), 0.25)).toBeCloseTo((61.7 - 0.25 - 0.01 - 56) / 7, 3);
    // a low camera (looking up) is held inside the rail; RAY_SIGHT alone ignores the see-through rail
    expect(w.sweepSphere(planPos(56, 30, 3.9), planPos(59.4, 30, 3.9), 0.25)).toBeCloseTo((57.95 - 0.25 - 0.01 - 56) / 3.4, 6);
    expect(w.sweepSphere(planPos(56, 30, 3.9), planPos(59.4, 30, 3.9), 0.25, RAY_SIGHT)).toBe(1);
  });
});

describe('ray broadphase', () => {
  it('grid-walked rays agree with box-queried sweeps of negligible radius', () => {
    const w = world();
    buildZ08(w);
    const rng = mulberry32(99);
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      const from = v(rng() * 80 - 5, rng() * 5, -(rng() * 60 - 6));
      const to = v(rng() * 80 - 5, rng() * 5, -(rng() * 60 - 6));
      const dir = v(to.x - from.x, to.y - from.y, to.z - from.z);
      const len = Math.hypot(dir.x, dir.y, dir.z);
      const mask = i % 3 === 0 ? RAY_SIGHT | RAY_GROUND : i % 3 === 1 ? RAY_SHOT : RAY_MOVE;
      const ray = w.raycast(from, dir, len, mask);
      // a sweep meets floors only with RAY_GROUND; a ray masked for sight / shots always does
      const frac = w.sweepSphere(from, to, 1e-9, mask === RAY_MOVE ? mask : mask | RAY_GROUND);
      if (ray && ray.distance === 0) continue; // a ray born inside a solid hits it; a sweep may still leave it
      if (ray) {
        hits++;
        const expected = Math.max(0, ray.distance - 0.01) / len;
        if (Math.abs(frac - expected) > 1e-6) throw new Error(`ray ${i}: grid ${ray.distance} vs sweep ${frac * len}`);
        const nl = Math.hypot(ray.normal.x, ray.normal.y, ray.normal.z);
        expect(nl).toBeCloseTo(1, 6);
        if (ray.distance > 0) expect(ray.normal.x * dir.x + ray.normal.y * dir.y + ray.normal.z * dir.z).toBeLessThanOrEqual(1e-9);
      } else if (frac !== 1) throw new Error(`ray ${i}: grid missed, sweep stopped at ${frac * len}`);
    }
    expect(hits).toBeGreaterThan(1500);
  });
});
