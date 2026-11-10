import { describe, expect, it, vi } from 'vitest';
import type { MoveOpts, MoveResult, PhysicsWorld, Vec3Like } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ05, buildZ08, fxBox, fxFloor, planPos } from './fixtures';

const R = 0.4;
/** default ledge margin of a human-sized body */
const M = 0.25;
const world = (): PhysicsWorld => createPhysicsWorld(null);

interface Walk { pos: Vec3Like; blocked: number; last: MoveResult; maxDy: number; path: Vec3Like[] }

/** Walk in a fixed direction at `speed` for `seconds`, one moveCharacter per frame. */
function walk(
  w: PhysicsWorld, from: Vec3Like, dx: number, dz: number, speed: number, seconds: number, dt = 1 / 60,
  opts?: MoveOpts, radius = R,
): Walk {
  const len = Math.hypot(dx, dz) || 1;
  let pos = { ...from };
  let blocked = 0, maxDy = 0;
  let last: MoveResult = { x: pos.x, y: pos.y, z: pos.z, blocked: false, normal: null };
  const path: Vec3Like[] = [];
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    last = w.moveCharacter(pos, radius, (dx / len) * speed * dt, (dz / len) * speed * dt, opts);
    if (last.blocked) blocked++;
    maxDy = Math.max(maxDy, Math.abs(last.y - pos.y));
    pos = { x: last.x, y: last.y, z: last.z };
    path.push(pos);
  }
  return { pos, blocked, last, maxDy, path };
}

describe('moveCharacter — walls', () => {
  it('slides along a wall keeping the tangential motion', () => {
    const w = world();
    buildZ04(w);
    // west wall inner face at x = 0.3; walk north-west for 2 s at 5 m/s
    const r = walk(w, planPos(3, 10), -1, -1, 5, 2);
    expect(r.pos.x).toBeCloseTo(0.3 + R, 3);
    expect(r.pos.z).toBeCloseTo(-10 - 10 * Math.SQRT1_2, 2); // full tangential distance north
    expect(r.last.blocked).toBe(true);
    expect(r.last.normal!.x).toBeCloseTo(1, 5);
    expect(r.last.normal!.z).toBeCloseTo(0, 5);
    expect(r.pos.y).toBe(0);
  });

  it('reports unblocked free movement exactly', () => {
    const w = world();
    buildZ04(w);
    const m = w.moveCharacter(planPos(5, 5), R, 1.25, -0.75);
    expect(m.x).toBeCloseTo(6.25, 9);
    expect(m.z).toBeCloseTo(-5.75, 9);
    expect(m.blocked).toBe(false);
    expect(m.normal).toBeNull();
  });

  it('settles in a right-angle corner without jitter', () => {
    const w = world();
    buildZ04(w);
    const r = walk(w, planPos(3, 3), -1, 1, 6, 2); // into the south-west corner
    expect(r.pos.x).toBeCloseTo(0.3 + R, 3);
    expect(r.pos.z).toBeCloseTo(-(0.3 + R), 3);
    const again = walk(w, r.pos, -1, 1, 6, 0.5);
    expect(Math.hypot(again.pos.x - r.pos.x, again.pos.z - r.pos.z)).toBeLessThan(1e-4);
    expect(w.canStand(again.pos.x, again.pos.y, again.pos.z, R - 1e-3)).toBe(true);
  });

  it('never ends inside a solid when wedged into an acute corner', () => {
    const w = world();
    fxFloor(w, -20, -20, 20, 20, 0);
    // two long thin walls meeting at ~25° at the origin, opening toward +X
    w.addCollider({ shape: { kind: 'box', hx: 6, hy: 2, hz: 0.15 }, x: 6 * Math.cos(0.22), y: 2, z: -6 * Math.sin(0.22), yaw: 0.22 });
    w.addCollider({ shape: { kind: 'box', hx: 6, hy: 2, hz: 0.15 }, x: 6 * Math.cos(0.22), y: 2, z: 6 * Math.sin(0.22), yaw: -0.22 });
    for (const speed of [3, 7, 20]) {
      const r = walk(w, { x: 9, y: 0, z: 0.3 }, -1, 0.02, speed, 3);
      expect(Number.isFinite(r.pos.x + r.pos.z)).toBe(true);
      expect(w.canStand(r.pos.x, 0, r.pos.z, R - 1e-3)).toBe(true);
      expect(r.pos.x).toBeGreaterThan(1.5); // stopped in the throat, did not squeeze through the apex
      expect(Math.abs(r.pos.z)).toBeLessThan(1);
      const again = walk(w, r.pos, -1, 0.02, speed, 0.5);
      expect(Math.hypot(again.pos.x - r.pos.x, again.pos.z - r.pos.z)).toBeLessThan(0.05);
    }
  });

  it('slides around box corners and cylinders', () => {
    const w = world();
    const f = buildZ04(w);
    // walk north into receiver A (cylinder r 0.7 at plan 35,18) slightly off-centre: must flow around it
    const r = walk(w, planPos(35.2, 14), 0, -1, 5, 2);
    expect(r.pos.z).toBeLessThan(-20);
    expect(r.blocked).toBeGreaterThan(0);
    for (const p of r.path) {
      expect(Math.hypot(p.x - f.receiverA.desc.x, p.z - f.receiverA.desc.z)).toBeGreaterThan(0.7 + R - 1e-3);
    }
    // walk east past the corner of the 24..27 × 14..17 high cover: clips the corner, slides off it
    const c = walk(w, planPos(22, 17.2), 1, 0, 5, 2);
    expect(c.pos.x).toBeGreaterThan(29);
    expect(c.pos.z).toBeLessThan(-17.39);
  });

  it('cannot tunnel through a 0.3 m wall at 20 m/s (any frame time)', () => {
    const w = world();
    fxFloor(w, -50, -50, 50, 50, 0);
    fxBox(w, -0.15, -40, 0.15, 40, 0, 3); // wall on the line x = 0
    w.addCollider({ shape: { kind: 'box', hx: 20, hy: 1.5, hz: 0.05 }, x: 20, y: 1.5, z: 10, yaw: 0.6, blocksSight: false }); // thin rail
    for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1, 0.25, 1]) {
      for (const start of [-6, -3.17, -1.03, -0.56]) {
        for (const dz of [0, 0.4, -1.7]) {
          const r = walk(w, { x: start, y: 0, z: 2 }, 1, dz, 20, 2, dt);
          expect(r.pos.x).toBeLessThanOrEqual(-0.15 - R + 1e-3);
          expect(r.last.blocked).toBe(true);
        }
      }
    }
    // one enormous move
    const big = w.moveCharacter({ x: -5, y: 0, z: 0 }, R, 500, 3);
    expect(big.x).toBeLessThanOrEqual(-0.15 - R + 1e-3);
    // thin rotated rail, small and large radii
    for (const radius of [0.15, 0.4, 0.9]) {
      const r = walk(w, { x: 12, y: 0, z: 20 }, 0.3, -1, 20, 1.5, 1 / 30, undefined, radius);
      const side = (p: Vec3Like): number => (p.x - 20) * Math.sin(0.6) + (p.z - 10) * Math.cos(0.6);
      expect(side(r.pos)).toBeGreaterThan(0.05 + radius - 1e-3); // still on the starting side
    }
  });
});

describe('moveCharacter — steps, ramps and levels', () => {
  it('steps up small ledges but is blocked by tall ones', () => {
    const w = world();
    fxFloor(w, 0, 0, 30, 10, 0);
    fxFloor(w, 10, 0, 14, 10, 0.3); fxBox(w, 10, 0, 14, 10, 0, 0.3); // kerb
    fxFloor(w, 20, 0, 24, 10, 0.6); fxBox(w, 20, 0, 24, 10, 0, 0.6); // ledge
    const up = walk(w, planPos(8, 5), 1, 0, 4, 1);
    expect(up.pos.x).toBeCloseTo(12, 5);
    expect(up.pos.y).toBeCloseTo(0.3);
    const on = walk(w, up.pos, 1, 0, 4, 1); // step back down the far side
    expect(on.pos.y).toBe(0);
    const wall = walk(w, on.pos, 1, 0, 4, 2);
    expect(wall.pos.x).toBeCloseTo(20 - R, 3);
    expect(wall.pos.y).toBe(0);
    expect(wall.last.normal!.x).toBeCloseTo(-1, 5);
    const tall = walk(w, on.pos, 1, 0, 4, 2, 1 / 60, { stepUp: 0.7 });
    expect(tall.pos.y).toBeCloseTo(0.6);
    // dropping off the 0.6 ledge is within maxDrop; with a small maxDrop it is an edge
    const guarded = walk(w, tall.pos, 1, 0, 4, 2, 1 / 60, { maxDrop: 0.3 });
    expect(guarded.pos.x).toBeLessThanOrEqual(24 + 1e-6);
    expect(guarded.pos.y).toBeCloseTo(0.6);
    const drop = walk(w, tall.pos, 1, 0, 4, 2);
    expect(drop.pos.x).toBeGreaterThan(26);
    expect(drop.pos.y).toBe(0);
  });

  it('follows the 12 m south ramp up to the balcony and back down continuously', () => {
    const w = world();
    const f = buildZ04(w);
    const up = walk(w, f.marks.rampFoot, 0, -1, 5, 4);
    expect(up.pos.y).toBeCloseTo(3);
    expect(-up.pos.z).toBeGreaterThan(24);
    expect(up.blocked).toBe(0);
    expect(up.maxDy).toBeLessThan(0.25 * 5 / 60 + 1e-6); // slope 3/12 × per-frame distance
    let prev = 0;
    for (const p of up.path) { expect(p.y).toBeGreaterThanOrEqual(prev - 1e-9); prev = p.y; }
    const mid = up.path.find((p) => -p.z >= 17)!;
    expect(mid.y).toBeCloseTo(((-mid.z - 11) / 12) * 3, 5);

    const down = walk(w, up.pos, 0, 1, 5, 4);
    expect(down.pos.y).toBe(0);
    expect(down.blocked).toBe(0);
    expect(down.maxDy).toBeLessThan(0.25 * 5 / 60 + 1e-6);
  });

  it('follows the west down-ramp (rotated ramp surface)', () => {
    const w = world();
    const f = buildZ04(w);
    const r = walk(w, planPos(45, 30, 3), -1, 0, 5, 3.2);
    expect(r.pos.x).toBeLessThan(31);
    expect(r.pos.y).toBe(0);
    expect(r.maxDy).toBeLessThan(0.25 * 5 / 60 + 1e-6);
    expect(f.westRamp.desc.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('distinguishes standing under the balcony from standing on it', () => {
    const w = world();
    const f = buildZ04(w);
    const under = w.moveCharacter(f.marks.underBalcony, R, 0, 0);
    const over = w.moveCharacter(f.marks.balcony, R, 0, 0);
    expect(under.y).toBe(0);
    expect(over.y).toBe(3);
    // walk east under the deck from the open floor: the slab and deck never capture or block the walker
    const a = walk(w, planPos(40, 25.5), 1, 0, 5, 2.4);
    expect(a.pos.x).toBeGreaterThan(49);
    expect(a.path.every((p) => p.y === 0)).toBe(true);
    // the same XZ track on the deck stays on the deck
    const b = walk(w, planPos(45, 30, 3), 1, 0, 5, 1.5);
    expect(b.path.every((p) => p.y === 3)).toBe(true);
    // the ramp body blocks a walker on the floor beside its tall end
    const side = walk(w, planPos(47, 20), 1, 0, 5, 2);
    expect(side.pos.x).toBeCloseTo(51 - R, 2);
    expect(side.pos.y).toBe(0);
  });
});

describe('moveCharacter — headroom (surfaces without solids beneath)', () => {
  // bare ramp: no under-fill colliders at all. Rises 0 → 3 m going north over n 10..22, x 10..16.
  const bare = (): PhysicsWorld => {
    const w = world();
    fxFloor(w, 0, 0, 30, 30, 0);
    w.addSurface({ shape: { kind: 'rect', hx: 3, hz: 6 }, x: 13, z: -16, y: 3, y1: 0 });
    return w;
  };

  it('cannot walk through the low part of a ramp from the floor beside it', () => {
    const w = bare();
    // at n = 14 the ramp is 1 m up: the body would be cut in half → blocked at the ramp's side
    const mid = walk(w, planPos(5, 14), 1, 0, 5, 3);
    expect(mid.pos.x).toBeLessThanOrEqual(10 + 1e-6);
    expect(mid.pos.x).toBeGreaterThan(9.95);
    expect(mid.pos.y).toBe(0);
    expect(mid.last.blocked).toBe(true);
    expect(mid.last.normal!.x).toBeLessThan(-0.9);
    // at n = 11 it is 0.25 m up: a step → walks onto the ramp
    const low = walk(w, planPos(5, 11), 1, 0, 5, 1.6);
    expect(low.pos.x).toBeCloseTo(13, 5);
    expect(low.pos.y).toBeCloseTo(0.25, 5);
    // at n = 20 it is 2.5 m up: clear headroom → walks underneath
    const under = walk(w, planPos(5, 20), 1, 0, 5, 3);
    expect(under.pos.x).toBeCloseTo(20, 5);
    expect(under.path.every((p) => p.y === 0)).toBe(true);
    expect(under.blocked).toBe(0);
    // walking south underneath it: stopped where the headroom runs out (ramp at 1.8 m ↔ n = 17.2)
    const squeeze = walk(w, planPos(13, 21), 0, 1, 5, 3);
    expect(-squeeze.pos.z).toBeGreaterThanOrEqual(17.2 - 1e-3);
    expect(-squeeze.pos.z).toBeLessThan(17.25);
    // a 3.6 m creature does not fit under it anywhere
    const big = walk(w, planPos(5, 20), 1, 0, 4, 3, 1 / 60, { height: 3.6 }, 1.2);
    expect(big.pos.x).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('agrees with canStand and the nav grid, and lets a trapped actor walk out', () => {
    const w = bare();
    expect(w.canStand(13, 0, -14, 0.4)).toBe(false); // under the 1 m part
    expect(w.canStand(13, 0, -20, 0.4)).toBe(true); // under the 2.5 m part
    expect(w.canStand(13, 1, -14, 0.4)).toBe(true); // on the ramp
    w.nav.rebuild();
    expect(w.nav.isWalkable(13, 0, -14)).toBe(false);
    expect(w.nav.isWalkable(13, 1, -14)).toBe(true);
    expect(w.nav.isWalkable(13, 0, -20)).toBe(true);
    expect(w.nav.isWalkable(13, 2.5, -20)).toBe(true);
    // floor route from west to east of the ramp passes north of n = 17.2 (under the tall end) or around it
    const p = w.nav.findPath(planPos(6, 14), planPos(20, 14))!;
    expect(p).not.toBeNull();
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], b = p.points[i];
      for (let t = 0; t <= 1; t += 0.05) {
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
        expect(w.canStand(x, w.groundAt(x, z, y, 0.4)!.y, z, 0.4)).toBe(true);
      }
    }
    // an actor that somehow stands under the low part is not frozen: it can leave, then cannot re-enter
    const out = walk(w, { x: 12, y: 0, z: -14 }, -1, 0, 4, 1.5);
    expect(out.pos.x).toBeCloseTo(6, 5);
    const back = walk(w, out.pos, 1, 0, 4, 2);
    expect(back.pos.x).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('a raised dais taller than a step is an obstacle from the floor', () => {
    const w = world();
    fxFloor(w, 0, 0, 20, 20, 0);
    w.addSurface({ shape: { kind: 'disc', r: 4 }, x: 10, z: -10, y: 0.6 });
    const r = walk(w, planPos(2, 10), 1, 0, 5, 3);
    expect(r.pos.x).toBeLessThanOrEqual(6 + 1e-3);
    expect(r.pos.x).toBeGreaterThan(5.9);
    expect(r.pos.y).toBe(0);
    // glancing push slides round the dais rim instead of sticking
    const g = walk(w, planPos(2, 8.5), 1, 0.25, 5, 4);
    expect(g.pos.x).toBeGreaterThan(12);
    expect(g.path.every((p) => p.y === 0 && Math.hypot(p.x - 10, p.z + 10) >= 4 - 1e-3)).toBe(true);
    // from on top you may step down (0.6 ≤ maxDrop); the floor's own east edge then holds the feet 0.25 m in
    const down = walk(w, { x: 10, y: 0.6, z: -10 }, 1, 0, 5, 2);
    expect(down.pos.y).toBe(0);
    expect(down.pos.x).toBeCloseTo(20 - M, 5);
    expect(walk(w, { x: 10, y: 0.6, z: -10 }, 1, 0, 5, 2, 1 / 60, { edgeMargin: 0 }).pos.x).toBeCloseTo(20, 5);
  });
});

describe('moveCharacter — fall protection', () => {
  it('stops at a balcony edge and slides along it', () => {
    const w = world();
    buildZ04(w, { rails: false });
    const stop = walk(w, planPos(50, 25, 3), -1, 0, 5, 3); // west edge at x = 44, no ramp at n = 25
    expect(stop.pos.x).toBeGreaterThanOrEqual(44 + M - 1e-9); // feet held a ledge margin back from the drop
    expect(stop.pos.x).toBeLessThan(44 + M + 0.02);
    expect(stop.pos.y).toBe(3);
    expect(stop.last.blocked).toBe(true);
    expect(stop.last.reason).toBe('edge');
    expect(stop.last.grounded).toBe(true);
    expect(stop.last.surface?.desc.tag).toBe('balcony');
    expect(stop.last.normal!.x).toBeCloseTo(1, 2);
    expect(Math.abs(stop.last.normal!.z)).toBeLessThan(0.05);
    // the bare feet-point rule is still available
    const bare = walk(w, planPos(50, 25, 3), -1, 0, 5, 3, 1 / 60, { edgeMargin: 0 });
    expect(bare.pos.x).toBeGreaterThanOrEqual(44 - 1e-6);
    expect(bare.pos.x).toBeLessThan(44.02);

    // push diagonally into the same edge: slides north along it, then down the west ramp (n 27..33)
    const slide = walk(w, planPos(46, 24, 3), -1, -0.5, 5, 1.2);
    expect(slide.path.every((p) => p.x >= 44 + M - 1e-9 || p.y < 3)).toBe(true);
    const late = walk(w, slide.pos, -1, -0.5, 5, 3);
    expect(late.pos.y).toBeLessThan(2);
    expect(late.pos.x).toBeLessThan(40);
    for (const p of [...slide.path, ...late.path]) expect(w.groundAt(p.x, p.z, p.y, 0.01)).not.toBeNull();

    // south edge at n = 23 beside the ramp mouth
    const south = walk(w, planPos(47, 26, 3), 0, 1, 5, 2);
    expect(-south.pos.z).toBeCloseTo(23 + M, 3);
    expect(south.pos.y).toBe(3);
  });

  it('blocks the shaft, the outer rim and the bridge sides in the atrium, sliding along curved edges', () => {
    const w = world();
    const f = buildZ05(w);
    const rad = (p: Vec3Like): number => Math.hypot(p.x, p.z);
    const shaft = walk(w, f.marks.ringEast, -1, -0.05, 5, 4);
    expect(rad(shaft.pos)).toBeGreaterThanOrEqual(9 + M - 1e-6); // 0.15 m of a 0.8 m body over the void, not 0.4
    expect(shaft.last.blocked).toBe(true);

    // slide around the shaft rim: pushing west-north-west from the east side travels around the hole
    const around = walk(w, { x: 12, y: 0, z: -0.5 }, -1, -0.6, 5, 5);
    for (const p of around.path) {
      const onBridge = Math.abs(p.x) <= 3 - M + 1e-6 && Math.abs(p.z) <= 9.5 + 1e-6;
      expect(rad(p) >= 9 + M - 0.01 || onBridge).toBe(true);
    }
    expect(around.pos.z).toBeLessThan(-6); // made real progress around the rim instead of sticking
    expect(around.pos.x).toBeLessThan(8);

    // outer rim (convex): a mostly tangential push hugs the arc smoothly, a radial push comes to rest
    const rim = walk(w, { x: 30, y: 0, z: 10 }, 0.5, 1, 6, 4);
    const hug = rim.path.filter((p) => p.z > 20);
    expect(hug.length).toBeGreaterThan(60);
    for (const p of hug) { expect(rad(p)).toBeLessThanOrEqual(36 - M + 1e-6); expect(rad(p)).toBeGreaterThan(36 - M - 0.01); }
    expect(rim.pos.z).toBeGreaterThan(22); // travelled ~15° round the rim
    for (let i = 1; i < hug.length; i++) expect(hug[i].z).toBeGreaterThan(hug[i - 1].z); // no stutter
    const rest = walk(w, { x: 30, y: 0, z: 10 }, 1, 0.3, 6, 12);
    expect(rad(rest.pos)).toBeGreaterThan(36 - M - 0.01);
    expect(Math.atan2(rest.pos.z, rest.pos.x)).toBeCloseTo(Math.atan2(0.3, 1), 2); // where the push is purely radial
    expect(rest.last.normal!.x).toBeCloseTo(-rest.pos.x / (36 - M), 2);
    expect(rest.last.normal!.z).toBeCloseTo(-rest.pos.z / (36 - M), 2);

    const across = walk(w, f.marks.southRim, 0, -1, 5, 8.4);
    expect(across.pos.z).toBeCloseTo(-22, 1); // crossed the shaft on the bridge
    expect(across.blocked).toBe(0);
    const offSide = walk(w, { x: 0, y: 0, z: 0 }, 1, 0, 5, 2);
    expect(offSide.pos.x).toBeLessThanOrEqual(3 - M + 1e-6);
    expect(offSide.pos.x).toBeGreaterThan(3 - M - 0.01);

    const broken = walk(w, f.marks.ringEast, 1, 0, 6, 8);
    expect(broken.pos.x).toBeLessThanOrEqual(48 - M + 1e-6);
    expect(broken.pos.x).toBeGreaterThan(48 - M - 0.01);
    const approach = walk(w, f.marks.southRim, 0, 1, 6, 8);
    expect(approach.pos.z).toBeLessThanOrEqual(56 - M + 1e-6);
    expect(approach.pos.z).toBeGreaterThan(56 - M - 0.01);

    // the elite keeps half its radius on the deck; with no margin the old feet-point rule applies
    const elite = walk(w, f.marks.ringEast, -1, 0, 4, 4, 1 / 60, { height: 3.6 }, 1.2);
    expect(rad(elite.pos)).toBeCloseTo(9 + 0.6, 2);
    const feet = walk(w, f.marks.ringEast, -1, 0, 5, 4, 1 / 60, { edgeMargin: 0 });
    expect(rad(feet.pos)).toBeGreaterThanOrEqual(9 - 1e-6);
    expect(rad(feet.pos)).toBeLessThan(9.01);
  });

  it('with freeRoam, an actor that starts off every surface walks back onto one', () => {
    const w = world();
    fxFloor(w, 0, 0, 10, 10, 0);
    const lost = walk(w, { x: -1.5, y: 0.2, z: -5 }, 1, 0, 4, 1, 1 / 60, { freeRoam: true });
    expect(lost.pos.x).toBeCloseTo(2.5, 5);
    expect(lost.pos.y).toBe(0);
    expect(lost.last.grounded).toBe(true);
    const first = w.moveCharacter({ x: -1.5, y: 0.2, z: -5 }, R, 0.05, 0, { freeRoam: true });
    expect(first.grounded).toBe(false);
    expect(first.surface).toBeNull();
    expect(first.blocked).toBe(false);
    const stay = walk(w, lost.pos, -1, 0, 4, 2); // now grounded: the edge holds
    expect(stay.pos.x).toBeGreaterThanOrEqual(M - 1e-9);
  });
});

describe('moveCharacter — doors, flying, robustness', () => {
  it('a door collider blocks until disabled', () => {
    const w = world();
    const f = buildZ04(w);
    const shut = walk(w, f.marks.exitInside, 0, -1, 5, 2);
    expect(-shut.pos.z).toBeCloseTo(37.8 - R, 3);
    f.door.enabled = false;
    const open = walk(w, shut.pos, 0, -1, 5, 1);
    expect(-open.pos.z).toBeGreaterThan(41);
    f.door.enabled = true;
    const back = walk(w, open.pos, 0, 1, 5, 2);
    expect(-back.pos.z).toBeCloseTo(38.2 + R, 3);
  });

  it('pushes an actor out of a solid that appears on top of it', () => {
    const w = world();
    const f = buildZ04(w);
    f.door.enabled = false;
    const at = planPos(31, 37.9); // standing in the doorway
    expect(w.moveCharacter(at, R, 0, 0).blocked).toBe(false);
    f.door.enabled = true;
    const out = w.moveCharacter(at, R, 0, 0);
    expect(out.blocked).toBe(true);
    expect(w.canStand(out.x, out.y, out.z, R - 1e-3)).toBe(true);
    expect(-out.z).toBeCloseTo(37.8 - R, 3); // nearest face
    // deep inside a big solid: still escapes (anti-tunnel guard does not trap it)
    const w2 = world();
    fxFloor(w2, 0, 0, 20, 20, 0);
    fxBox(w2, 5, 5, 15, 15, 0, 3);
    const deep = w2.moveCharacter(planPos(7, 10), R, 0, 0);
    expect(w2.canStand(deep.x, deep.y, deep.z, R - 1e-3)).toBe(true);
    expect(deep.x).toBeCloseTo(5 - R, 3);
  });

  it('flying actors ignore surfaces and collide only at their altitude', () => {
    const w = world();
    const f = buildZ04(w);
    const fly: MoveOpts = { flying: true, height: 0.6 };
    // 29..32 × 6..9 low cover (1.2 m): a drone at 1.5 m passes over, a walker is blocked
    const over = walk(w, planPos(30.5, 3, 1.5), 0, -1, 6, 1.5, 1 / 60, fly);
    expect(-over.pos.z).toBeCloseTo(12, 5);
    expect(over.pos.y).toBe(1.5);
    expect(over.blocked).toBe(0);
    const foot = walk(w, planPos(30.5, 3), 0, -1, 6, 1.5);
    expect(-foot.pos.z).toBeCloseTo(6 - R, 3);
    // 24..27 × 14..17 high cover (2.2 m) stops the drone
    const high = walk(w, planPos(25.5, 10, 1.5), 0, -1, 6, 1.5, 1 / 60, fly);
    expect(-high.pos.z).toBeCloseTo(14 - R, 3);
    // …and so does the perimeter wall
    const wall = walk(w, planPos(5, 5, 1.5), -1, 0, 6, 2, 1 / 60, fly);
    expect(wall.pos.x).toBeCloseTo(0.3 + R, 3);
    // no fall protection: crosses the atrium shaft
    const w2 = world();
    buildZ05(w2);
    const shaft = walk(w2, { x: 15, y: 1.8, z: 6 }, -1, 0, 6, 5, 1 / 60, fly);
    expect(shaft.pos.x).toBeCloseTo(-15, 5);
    expect(shaft.pos.y).toBe(1.8);
    expect(f.lowCover.length).toBe(5);
  });

  it('never returns NaN and never throws on bad input', () => {
    const w = world();
    buildZ04(w);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = (m: MoveResult): boolean => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z);
    expect(ok(w.moveCharacter({ x: NaN, y: 0, z: 0 }, R, 1, 1))).toBe(true);
    expect(ok(w.moveCharacter({ x: 5, y: Infinity, z: -5 }, R, 1, 1))).toBe(true);
    expect(ok(w.moveCharacter(null as never, R, 1, 1))).toBe(true);
    const still = w.moveCharacter(planPos(5, 5), R, NaN, Infinity);
    expect(still).toMatchObject({ x: 5, y: 0, z: -5 });
    expect(ok(w.moveCharacter(planPos(5, 5), 0, 1, 0))).toBe(true);
    expect(ok(w.moveCharacter(planPos(5, 5), -3, 1, 0))).toBe(true);
    expect(ok(w.moveCharacter(planPos(5, 5), NaN, 1, 0))).toBe(true);
    expect(ok(w.moveCharacter(planPos(5, 5), R, 1e9, -1e9))).toBe(true);
    expect(ok(w.moveCharacter(planPos(5, 5), R, 1, 0, { stepUp: NaN, maxDrop: -1, height: 0 }))).toBe(true);
    warn.mockRestore();
  });

  it('fills opts.out instead of allocating', () => {
    const w = world();
    buildZ04(w);
    const out: MoveResult = { x: 0, y: 0, z: 0, blocked: false, normal: null };
    const a = w.moveCharacter(planPos(1, 10), R, -3, 0, { out });
    expect(a).toBe(out);
    expect(out.blocked).toBe(true);
    const n = out.normal;
    expect(n).not.toBeNull();
    w.moveCharacter(planPos(1, 12), R, -3, 0.5, { out });
    expect(out.normal).toBe(n); // normal object reused
    w.moveCharacter(planPos(10, 12), R, 1, 0, { out });
    expect(out.normal).toBeNull();
    expect(out.blocked).toBe(false);
  });
});

describe('moveCharacter — invariants under random input', () => {
  const fixtures: Array<[string, (w: PhysicsWorld) => Vec3Like]> = [
    ['Z04', (w) => buildZ04(w, { rails: false }).marks.floorMid],
    ['Z08', (w) => buildZ08(w).marks.staging],
    ['Z05', (w) => buildZ05(w).marks.southRim],
  ];
  for (const [name, build] of fixtures) {
    it(`${name}: stays on valid ground, outside solids, and is deterministic`, () => {
      const run = (): Vec3Like[] => {
        const w = world();
        let pos = build(w);
        const rng = mulberry32(1234);
        const trail: Vec3Like[] = [];
        let heading = 0, speed = 5;
        for (let i = 0; i < 6000; i++) {
          if (i % 20 === 0) { heading = rng() * Math.PI * 2; speed = rng() < 0.15 ? 20 : 2 + rng() * 6; }
          const dt = rng() < 0.05 ? 0.1 : 1 / 60;
          const m = w.moveCharacter(pos, R, Math.cos(heading) * speed * dt, Math.sin(heading) * speed * dt);
          expect(Number.isFinite(m.x + m.y + m.z)).toBe(true);
          const g = w.groundAt(m.x, m.z, m.y, 1e-3);
          if (!g || Math.abs(g.y - m.y) > 1e-6 || !w.canStand(m.x, m.y, m.z, R - 1e-3)) {
            throw new Error(`${name} step ${i}: invalid position ${JSON.stringify(m)} from ${JSON.stringify(pos)}`);
          }
          expect(Math.abs(m.y - pos.y)).toBeLessThanOrEqual(0.7 + 1e-6);
          pos = { x: m.x, y: m.y, z: m.z };
          if (i % 50 === 0) trail.push(pos);
        }
        return trail;
      };
      const a = run();
      const b = run();
      expect(a).toEqual(b);
      const spread = Math.max(...a.map((p) => p.x)) - Math.min(...a.map((p) => p.x));
      expect(spread).toBeGreaterThan(10); // the walker actually explored
    });
  }
});

describe('moveCharacter — random worlds', () => {
  it('never tunnels, never ends inside a solid, never leaves the ground (dense random clutter)', () => {
    let runs = 0;
    for (const [seed, radius, count] of [[11, R, 220], [23, R, 220], [37, R, 220], [41, 0.2, 260], [53, 1.1, 60]] as const) {
      const w = world();
      const rng = mulberry32(seed);
      fxFloor(w, 0, 0, 60, 60, 0);
      w.addSurface({ shape: { kind: 'disc', r: 8, inner: 3 }, x: 30, z: -30, y: 0.3 }); // low annular dais
      w.addSurface({ shape: { kind: 'rect', hx: 5, hz: 2 }, x: 12, z: -45, yaw: 0.5, y: 0, y1: 2.5 }); // skew ramp
      for (let i = 0; i < count; i++) {
        const x = 2 + rng() * 56, z = -(2 + rng() * 56);
        const tall = rng() < 0.7;
        const y0 = rng() < 0.15 ? 0.5 + rng() * 1.5 : 0;
        const hy = (tall ? 1 + rng() * 2 : 0.1 + rng() * 0.5) / 2;
        if (rng() < 0.25) {
          w.addCollider({ shape: { kind: 'cyl', r: 0.15 + rng() * 1.2, hy }, x, y: y0 + hy, z });
        } else {
          const thin = rng() < 0.4;
          w.addCollider({
            shape: { kind: 'box', hx: thin ? 0.03 + rng() * 0.1 : 0.2 + rng() * 1.5, hy, hz: 0.3 + rng() * 3 },
            x, y: y0 + hy, z, yaw: rng() * Math.PI,
          });
        }
      }
      const start = w.nearestStandable(30, 0, -12, radius, 25);
      if (!start) continue;
      runs++;
      let pos: Vec3Like = start;
      let moved = 0;
      for (let i = 0; i < 12000; i++) {
        const a = rng() * Math.PI * 2;
        const speed = rng() < 0.2 ? 25 : 1 + rng() * 7;
        const dt = rng() < 0.1 ? 0.1 : 1 / 60;
        const hold = 1 + Math.floor(rng() * 30);
        for (let k = 0; k < hold; k++, i++) {
          const m = w.moveCharacter(pos, radius, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt);
          const g = w.groundAt(m.x, m.z, m.y, 1e-3);
          if (!Number.isFinite(m.x + m.y + m.z) || !g || Math.abs(g.y - m.y) > 1e-6 || !w.canStand(m.x, m.y, m.z, radius - 1e-3)) {
            throw new Error(`seed ${seed} step ${i}: invalid ${JSON.stringify(m)} from ${JSON.stringify(pos)}`);
          }
          // Oracle: replay the move as single sub-step calls. For one sub-step the chord p → q cannot touch a
          // solid (both ends clear by r, |pq| < 2r), so a chest-height ray along it must be clear — and the
          // replay must land exactly where the big move did (the solver's early-outs are pure shortcuts).
          const mx = Math.cos(a) * speed * dt, mz = Math.sin(a) * speed * dt;
          const n = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (radius * 0.5)));
          let q: Vec3Like = pos;
          for (let j = 0; j < n; j++) {
            const s1 = w.moveCharacter(q, radius, mx / n, mz / n);
            const d = { x: s1.x - q.x, y: 0, z: s1.z - q.z };
            const dl = Math.hypot(d.x, d.z);
            if (dl > 1e-9) {
              const hit = w.raycast({ x: q.x, y: Math.max(q.y, s1.y) + 1, z: q.z }, d, dl, 1);
              if (hit) throw new Error(`seed ${seed} step ${i}.${j}: tunnelled through collider ${hit.collider?.id} moving ${JSON.stringify(q)} → ${JSON.stringify(s1)}`);
            }
            q = { x: s1.x, y: s1.y, z: s1.z };
          }
          if (Math.hypot(q.x - m.x, q.z - m.z) > 1e-6 || Math.abs(q.y - m.y) > 1e-6) {
            throw new Error(`seed ${seed} step ${i}: sub-stepped replay diverged ${JSON.stringify(q)} vs ${JSON.stringify(m)} from ${JSON.stringify(pos)}`);
          }
          const len = Math.hypot(m.x - pos.x, m.z - pos.z);
          moved += len;
          pos = { x: m.x, y: m.y, z: m.z };
        }
      }
      expect(moved).toBeGreaterThan(150);
    }
    expect(runs).toBeGreaterThanOrEqual(4);
  });
});
