/**
 * Regression tests for the movement findings of the physics-nav review: headroom after the ground snap (the
 * ramp-under-a-soffit softlock), actors that are not standing on anything, cracks between floor modules,
 * hops that must not skip a void, depenetration next to thin walls, lifts, and the extra MoveResult fields.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MoveOpts, MoveResult, PhysicsWorld, Vec3Like } from '@/core/api';
import { MOVE_DEFAULTS, RAY_MOVE } from '@/core/api/physics';
import { mulberry32 } from '@/core/mathx';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ08, fxBox, fxFloor, planPos } from './fixtures';

const R = 0.4;
const world = (): PhysicsWorld => createPhysicsWorld(null);

interface Run { pos: Vec3Like; blocked: number; last: MoveResult; path: Vec3Like[] }

/** `frames` calls of moveCharacter with a fixed per-frame displacement. */
function run(w: PhysicsWorld, from: Vec3Like, dx: number, dz: number, frames: number, opts?: MoveOpts, radius = R): Run {
  let pos = { ...from };
  let blocked = 0;
  let last: MoveResult = { x: pos.x, y: pos.y, z: pos.z, blocked: false, normal: null };
  const path: Vec3Like[] = [];
  for (let i = 0; i < frames; i++) {
    last = w.moveCharacter(pos, radius, dx, dz, opts);
    if (last.blocked) blocked++;
    pos = { x: last.x, y: last.y, z: last.z };
    path.push(pos);
  }
  return { pos, blocked, last, path };
}

/** Solids that block movement and overlap the body band of a character standing at p. */
function inSolid(w: PhysicsWorld, p: Vec3Like, radius = R, height = 1.8): string[] {
  return w.queryColliders(p.x, p.z, radius - 2e-3, p.y + 0.451, p.y + height - 1e-3)
    .filter((c) => c.desc.blocksMove !== false).map((c) => c.desc.tag ?? '?');
}

describe('headroom after the ground snap (review blocker)', () => {
  /** 12 m ramp rising 0 → 3 along +X under a slab whose underside is at 3.0. */
  const rampUnderCeiling = (): PhysicsWorld => {
    const w = world();
    w.addSurface({ shape: { kind: 'rect', hx: 30, hz: 30 }, x: 0, z: 0, y: 0 });
    w.addSurface({ shape: { kind: 'rect', hx: 2, hz: 6 }, x: 6, z: 0, yaw: Math.PI / 2, y: 0, y1: 3 });
    w.addCollider({ shape: { kind: 'box', hx: 6, hy: 0.2, hz: 2 }, x: 6, y: 3.2, z: 0, tag: 'ceiling' });
    return w;
  };

  it('climbing a ramp under a soffit stops where the head meets it, and the walker can leave again', () => {
    const w = rampUnderCeiling();
    const up = run(w, { x: -1, y: 0, z: 0 }, 5.2 / 60, 0, 100);
    // head (1.8 m) reaches the 3.0 m underside where the ramp is 1.2 m up: x = 4.8
    expect(up.pos.x).toBeGreaterThan(4.75);
    expect(up.pos.x).toBeLessThanOrEqual(4.8 + 1e-3);
    expect(up.pos.y).toBeCloseTo(up.pos.x / 4, 6);
    expect(up.last.blocked).toBe(true);
    expect(up.last.reason).toBe('solid');
    expect(up.last.normal!.x).toBeLessThan(-0.9);
    for (const p of up.path) expect(inSolid(w, p)).toEqual([]);
    expect(w.canStand(up.pos.x, up.pos.y, up.pos.z, R - 1e-3)).toBe(true);
    // pushing on changes nothing (no creep, no jitter)
    const push = run(w, up.pos, 5.2 / 60, 0, 30);
    expect(Math.hypot(push.pos.x - up.pos.x, push.pos.z - up.pos.z)).toBeLessThan(1e-3);
    // back down the ramp: free
    const down = run(w, up.pos, -5.2 / 60, 0, 40);
    expect(down.pos.x).toBeCloseTo(up.pos.x - 40 * 5.2 / 60, 3);
    expect(down.blocked).toBe(0);
    // strafing off the side from the stop: slides along the soffit line, then leaves the ramp (drop ≤ 0.7 m
    // further down) or stops at its edge — but is never frozen and never inside the slab
    const strafe = run(w, up.pos, 0, 5.2 / 60, 40);
    expect(Math.abs(strafe.pos.z - up.pos.z)).toBeGreaterThan(1);
    for (const p of strafe.path) expect(inSolid(w, p)).toEqual([]);
  });

  it('a taller body stops lower down the same ramp; a shorter one further up', () => {
    const w = rampUnderCeiling();
    const tall = run(w, { x: -3, y: 0, z: 0 }, 0.06, 0, 200, { height: 2.6 }, 0.6);
    expect(tall.pos.x).toBeLessThanOrEqual(1.6 + 1e-3); // 3.0 − 2.6 = 0.4 m up
    expect(tall.pos.x).toBeGreaterThan(1.5);
    const short = run(w, { x: -1, y: 0, z: 0 }, 0.06, 0, 200, { height: 1.2 });
    expect(short.pos.x).toBeLessThanOrEqual(7.2 + 1e-3); // 3.0 − 1.2 = 1.8 m up
    expect(short.pos.x).toBeGreaterThan(7.1);
  });

  it('a step under a low beam is a wall, not an endless step-up / push-out loop', () => {
    const w = world();
    w.addSurface({ shape: { kind: 'rect', hx: 30, hz: 30 }, x: 0, z: 0, y: 0 });
    w.addSurface({ shape: { kind: 'rect', hx: 3, hz: 3 }, x: 5, z: 0, y: 0.4 }); // platform x 2..8
    w.addCollider({ shape: { kind: 'box', hx: 3, hy: 0.2, hz: 3 }, x: 5, y: 0.2, z: 0 });
    w.addCollider({ shape: { kind: 'box', hx: 3, hy: 0.5, hz: 3 }, x: 5, y: 2.4, z: 0, tag: 'beam' }); // underside 1.9
    const r = run(w, { x: 0, y: 0, z: 0 }, 5.2 / 60, 0, 80);
    // on the floor the beam is overhead (1.9 > 1.8); on the platform the head would be at 2.2
    expect(r.pos.y).toBe(0);
    expect(r.pos.x).toBeLessThanOrEqual(2 + 1e-6);
    expect(r.pos.x).toBeGreaterThan(1.95);
    expect(r.last.reason).toBe('solid');
    for (const p of r.path) expect(inSolid(w, p)).toEqual([]);
    for (let i = 41; i < r.path.length; i++) expect(Math.abs(r.path[i].x - r.path[i - 1].x)).toBeLessThan(1e-6); // at rest
    // a 1.4 m body fits under the beam on the platform and steps up
    const small = run(w, { x: 0, y: 0, z: 0 }, 5.2 / 60, 0, 80, { height: 1.4 });
    expect(small.pos.y).toBeCloseTo(0.4);
    expect(small.pos.x).toBeGreaterThan(5);
  });

  it('a wide body leaving the Z04 ramp sideways never rests inside the ramp fill', () => {
    const w = world();
    buildZ04(w);
    for (const [dx, dz] of [[-0.05, -0.03], [-0.05, 0], [0.05, -0.02], [-0.03, -0.05]] as const) {
      const start = { x: dx < 0 ? 52.3 : 55.7, y: 0.05, z: -11.2 };
      const r = run(w, start, dx, dz, 80, { height: 3.6 }, 1.2);
      for (const p of r.path) {
        expect(inSolid(w, p, 1.2, 3.6)).toEqual([]);
        expect(w.groundAt(p.x, p.z, p.y, 1e-3)).not.toBeNull();
      }
    }
  });

  it('random worlds with overhead slabs over ramps and steps: every result is a place the body can rest', () => {
    let moved = 0;
    for (const [seed, radius, height] of [[5, R, 1.8], [17, R, 1.8], [29, 0.25, 1.2], [43, 1.2, 3.6], [61, 0.6, 2.4]] as const) {
      const w = world();
      const rng = mulberry32(seed);
      fxFloor(w, 0, 0, 40, 40, 0);
      // ramps and platforms, each with a slab hanging at a random height above part of it
      for (let i = 0; i < 14; i++) {
        const x = 4 + rng() * 32, z = -(4 + rng() * 32), yaw = rng() * Math.PI * 2;
        const hx = 1 + rng() * 2, hz = 2 + rng() * 3;
        if (rng() < 0.6) w.addSurface({ shape: { kind: 'rect', hx, hz }, x, z, yaw, y: 0, y1: 0.5 + rng() * 2.5 });
        else w.addSurface({ shape: { kind: 'rect', hx, hz }, x, z, yaw, y: 0.15 + rng() * 0.5 });
        const under = 1 + rng() * 3.2;
        w.addCollider({ shape: { kind: 'box', hx: hx * (0.4 + rng()), hy: 0.15, hz: hz * (0.4 + rng()) }, x: x + rng() - 0.5, y: under + 0.15, z: z + rng() - 0.5, yaw: yaw + rng() - 0.5, tag: 'slab' });
      }
      for (let i = 0; i < 25; i++) {
        const y0 = rng() < 0.5 ? 0 : 0.3 + rng() * 2.4;
        w.addCollider({ shape: { kind: 'box', hx: 0.1 + rng(), hy: 0.2 + rng() * 0.8, hz: 0.1 + rng() * 2 }, x: 2 + rng() * 36, y: y0 + 1, z: -(2 + rng() * 36), yaw: rng() * Math.PI, tag: 'clutter' });
      }
      const start = w.nearestStandable(20, 0, -20, radius, 20, height);
      expect(start).not.toBeNull();
      let pos: Vec3Like = start!;
      const opts: MoveOpts = { height };
      for (let i = 0; i < 9000;) {
        const a = rng() * Math.PI * 2;
        const speed = rng() < 0.15 ? 20 : 1 + rng() * 6;
        const dt = rng() < 0.08 ? 0.1 : 1 / 60;
        const hold = 1 + Math.floor(rng() * 40);
        for (let k = 0; k < hold; k++, i++) {
          const m = w.moveCharacter(pos, radius, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, opts);
          const g = w.groundAt(m.x, m.z, m.y, 1e-3);
          if (!Number.isFinite(m.x + m.y + m.z) || !g || Math.abs(g.y - m.y) > 1e-6
            || !w.canStand(m.x, m.y, m.z, radius - 1e-3, height)) {
            throw new Error(`seed ${seed} step ${i}: cannot rest at ${JSON.stringify(m)} coming from ${JSON.stringify(pos)}`);
          }
          if (m.reason === 'recovered' || m.reason === 'lost' || m.grounded !== true) {
            throw new Error(`seed ${seed} step ${i}: a valid start was treated as invalid (${m.reason}) at ${JSON.stringify(pos)}`);
          }
          moved += Math.hypot(m.x - pos.x, m.z - pos.z);
          pos = { x: m.x, y: m.y, z: m.z };
        }
      }
    }
    expect(moved).toBeGreaterThan(1500);
  });
});

describe('actors that are not standing on anything (review: ghost mode)', () => {
  it('a marker more than a step below the floor is put on it, with a warning — never roams under the map', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    w.addSurface({ shape: { kind: 'rect', hx: 10, hz: 10 }, x: 0, z: 0, y: 2 });
    w.addCollider({ shape: { kind: 'box', hx: 0.3, hy: 2, hz: 10 }, x: 9.3, y: 4, z: 0, tag: 'wall' }); // stands on the +2 floor
    const first = w.moveCharacter({ x: 0, y: 0, z: 0 }, R, 0.087, 0);
    expect(first.y).toBe(2);
    expect(first).toMatchObject({ blocked: true, reason: 'recovered', grounded: true });
    expect(first.stepDy).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('not on walkable ground');
    const r = run(w, first, 0.087, 0, 400);
    expect(r.pos.y).toBe(2);
    expect(r.pos.x).toBeCloseTo(9 - R, 3); // stopped by the wall that stands on that floor
    expect(warn).toHaveBeenCalledTimes(1); // one relocation, one warning
    warn.mockRestore();
  });

  it('a marker just outside the level is pulled back in; far outside it is held, blocked and not grounded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    buildZ04(w);
    // 0.5 m beyond the outer face of the exit stub's end wall (plan n = 44.3)
    const out = run(w, planPos(31, 44.8), 0, -0.087, 300);
    expect(-out.pos.z).toBeLessThan(43.7 - R + 1e-3); // back inside, against the wall's inner face
    expect(out.pos.y).toBe(0);
    expect(w.canStand(out.pos.x, out.pos.y, out.pos.z, R - 1e-3)).toBe(true);
    expect(out.path[0].z).toBeGreaterThan(-44.8 + 1); // relocated on the very first call
    // 30 m outside: nothing standable within 4 m
    const lost = run(w, { x: -30, y: 0, z: -19 }, 0.087, 0, 50);
    expect(lost.pos).toEqual({ x: -30, y: 0, z: -19 });
    expect(lost.blocked).toBe(50);
    expect(lost.last).toMatchObject({ blocked: true, reason: 'lost', grounded: false, surface: null, stepDy: 0 });
    // the escape hatch still exists
    const roam = w.moveCharacter({ x: -30, y: 0, z: -19 }, R, 0.5, 0, { freeRoam: true });
    expect(roam.x).toBeCloseTo(-29.5);
    expect(roam.grounded).toBe(false);
    warn.mockRestore();
  });

  it('a bridge that retracts under an actor: held when nothing is near, dropped onto the level below when there is', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const span = w.addSurface({ shape: { kind: 'rect', hx: 2, hz: 10 }, x: 0, z: 0, y: 5, tag: 'span' });
    const at = w.moveCharacter({ x: 0, y: 5, z: 0 }, R, 0, 0.1);
    expect(at.surface).toBe(span);
    span.enabled = false;
    const held = w.moveCharacter(at, R, 3, 0);
    expect(held).toMatchObject({ x: at.x, y: 5, z: at.z, blocked: true, reason: 'lost', grounded: false });
    span.enabled = true;
    expect(w.moveCharacter(held, R, 1, 0).blocked).toBe(false);

    const w8 = world();
    const f = buildZ08(w8);
    f.balcony.enabled = false;
    const fell = w8.moveCharacter(f.marks.balcony, R, 0, 0);
    expect(fell.y).toBe(0);
    expect(fell.reason).toBe('recovered');
    expect(fell.stepDy).toBe(-3);
    warn.mockRestore();
  });

  it('the start snap is symmetric: within step-up above and max-drop below, silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    fxFloor(w, 0, 0, 20, 20, 0);
    for (const y of [0.69, 0.3, -0.2, -0.44]) {
      const m = w.moveCharacter({ x: 10, y, z: -10 }, R, 0.1, 0);
      expect(m).toMatchObject({ y: 0, blocked: false, grounded: true, reason: null });
      expect(m.stepDy).toBeCloseTo(-y, 9);
    }
    expect(warn).not.toHaveBeenCalled();
    for (const y of [0.8, 3, -0.5, -3]) expect(w.moveCharacter({ x: 10, y, z: -10 }, R, 0.1, 0).reason).toBe('recovered');
    warn.mockRestore();
  });
});

describe('cracks between floor modules (review: speed-dependent invisible walls)', () => {
  const tiles = (gap: number): PhysicsWorld => {
    const w = world();
    w.addSurface({ shape: { kind: 'rect', hx: 5, hz: 5 }, x: 0, z: 0, y: 0, tag: 'west' });
    w.addSurface({ shape: { kind: 'rect', hx: 5, hz: 5 }, x: 10 + gap, z: 0, y: 0, tag: 'east' });
    return w;
  };

  it('a crack up to MOVE_DEFAULTS.gap is floor at every speed and phase; anything wider is a ledge at every speed', () => {
    expect(MOVE_DEFAULTS.gap).toBe(0.12);
    for (const gap of [0.01, 0.02, 0.05, 0.1, 0.12, 0.13, 0.15, 0.2, 0.35]) {
      const w = tiles(gap);
      const floor = gap <= MOVE_DEFAULTS.gap;
      for (const speed of [0.3, 1.2, 2.2, 5.2, 7.2, 20]) {
        for (let k = 0; k < 12; k++) {
          const frames = Math.ceil(4 / (speed / 60));
          const r = run(w, { x: 3 + k * 0.0173, y: 0, z: -1 + k * 0.1 }, speed / 60, 0, frames);
          if (floor) expect(r.pos.x).toBeGreaterThan(6);
          else expect(r.pos.x).toBeLessThanOrEqual(5 + 1e-6);
          if ((r.pos.x > 5.5) !== floor) throw new Error(`gap ${gap} at ${speed} m/s phase ${k}: ended at x = ${r.pos.x}`);
        }
      }
      // one long dodge / knock-back straight across
      expect(w.moveCharacter({ x: 3, y: 0, z: 0 }, R, 4, 0.3).x > 5.5).toBe(floor);
      // …and every other query agrees
      expect(w.canStand(5 + gap / 2, 0, 0, R) || w.canStand(5 + gap * 0.25, 0, 0, R)).toBe(floor);
      expect(w.groundAt(5 + gap * 0.5, 0, 0) !== null).toBe(floor);
      expect(w.nav.walkable({ x: 3, y: 0, z: 0 }, { x: 8, y: 0, z: 0 })).toBe(floor);
      expect(w.nav.findPath({ x: 3, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }) !== null).toBe(floor);
    }
  });

  it('a point in a crack takes the height of the nearer module; rotated tilings have no seams', () => {
    const w = world();
    fxFloor(w, 0, 0, 5, 5, 0);
    w.addSurface({ shape: { kind: 'rect', hx: 2.5, hz: 2.5 }, x: 7.6, z: -2.5, y: 0.3 }); // 0.1 m crack, 0.3 m step
    expect(w.groundAt(5.03, -2.5, 0)!.y).toBe(0);
    expect(w.groundAt(5.07, -2.5, 0)!.y).toBe(0.3);
    const up = run(w, { x: 3, y: 0, z: -2.5 }, 0.05, 0, 80);
    expect(up.pos.y).toBe(0.3);
    expect(up.blocked).toBe(0);
    // 2 m tiles with a 1.5 cm inset, the whole floor turned 27°
    const t = world();
    const c = Math.cos(0.47), s = Math.sin(0.47);
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        t.addSurface({ shape: { kind: 'rect', hx: 0.985, hz: 0.985 }, x: (i * c + j * s) * 2, z: (-i * s + j * c) * 2, yaw: 0.47, y: 0 });
      }
    }
    expect(t.validate()).toEqual([]);
    const rng = mulberry32(8);
    let pos: Vec3Like = { x: 0, y: 0, z: 0 };
    let blocked = 0;
    for (let i = 0; i < 4000; i++) {
      const a = rng() * Math.PI * 2;
      const m = t.moveCharacter(pos, R, Math.cos(a) * 0.09, Math.sin(a) * 0.09);
      if (m.blocked && Math.hypot(m.x, m.z) < 6) blocked++;
      pos = Math.hypot(m.x, m.z) < 6 ? { x: m.x, y: m.y, z: m.z } : { x: 0, y: 0, z: 0 };
    }
    expect(blocked).toBe(0);
  });

  it('validate() reports the void strip that is too wide to be a crack', () => {
    const issues = tiles(0.3).validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('gap');
    expect(issues[0].x).toBeCloseTo(5.15, 2);
    expect(issues[0].message).toContain('"west"');
    expect(issues[0].message).toContain('"east"');
    expect(tiles(0.1).validate()).toEqual([]);
    expect(tiles(2).validate()).toEqual([]); // a deliberate gap is not an authoring slip
  });
});

describe('no hop skips a void or a wall', () => {
  it('sliding along one edge does not carry a body across a void strip (bare feet-point rule, wide body)', () => {
    for (const gap of [0.2, 0.3, 0.5]) {
      const w = world();
      w.addSurface({ shape: { kind: 'rect', hx: 5, hz: 5 }, x: 5, z: 5, y: 0 }); // x 0..10, z 0..10
      w.addSurface({ shape: { kind: 'rect', hx: 5, hz: 5 }, x: 5, z: 15 + gap, y: 0 }); // z 10+gap..20+gap
      for (const [radius, margin] of [[1.2, 0], [1.2, undefined], [0.4, 0], [0.4, undefined]] as const) {
        // pushed diagonally into the east edge, sliding toward the strip
        const r = run(w, { x: 9.5, y: 0, z: 8 }, 0.3, 0.3, 60, { edgeMargin: margin }, radius);
        expect(r.pos.z).toBeLessThanOrEqual(10 + 1e-6);
        for (const p of r.path) expect(w.groundAt(p.x, p.z, p.y, 1e-3)).not.toBeNull();
      }
    }
  });

  it('a body pushed out of a solid never lands beyond a thin wall it was not in', () => {
    const w = world();
    w.addSurface({ shape: { kind: 'rect', hx: 30, hz: 30 }, x: 0, z: 0, y: 0 });
    w.addCollider({ shape: { kind: 'box', hx: 1.5, hy: 1.75, hz: 0.5 }, x: 0, y: 1.75, z: 0, tag: 'slab' });
    w.addCollider({ shape: { kind: 'box', hx: 5, hy: 2, hz: 0.15 }, x: 0, y: 2, z: 0.9, tag: 'thin' }); // z 0.75..1.05
    // nearest face of the slab is +Z (0.2 m away) but the thin wall stands 0.25 m beyond it
    const m = w.moveCharacter({ x: 0, y: 0, z: 0.3 }, R, 0, 0);
    expect(m.blocked).toBe(true);
    expect(m.z).toBeLessThan(0); // left through the far face instead
    expect(w.canStand(m.x, m.y, m.z, R - 1e-3)).toBe(true);
    expect(w.raycast({ x: 0, y: 1, z: 0.3 }, { x: m.x, y: 0, z: m.z - 0.3 }, Math.hypot(m.x, m.z - 0.3), RAY_MOVE)!.collider!.desc.tag).toBe('slab');
    const push = run(w, m, 0, 0.05, 20);
    expect(push.pos.z).toBeLessThan(0);
    // boxed in on every side with no exit: stays put, finite, reported
    const b = world();
    b.addSurface({ shape: { kind: 'rect', hx: 0.6, hz: 0.6 }, x: 0, z: 0, y: 0 });
    b.addCollider({ shape: { kind: 'box', hx: 5, hy: 2, hz: 5 }, x: 0, y: 2, z: 0 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stuck = b.moveCharacter({ x: 0, y: 0, z: 0 }, R, 1, 0);
    expect(Number.isFinite(stuck.x + stuck.y + stuck.z)).toBe(true);
    expect(stuck.blocked).toBe(true);
    warn.mockRestore();
  });
});

describe('MoveResult extras and moving surfaces', () => {
  it('reports the surface stood on, the height change and why a move was blocked', () => {
    const w = world();
    fxFloor(w, 0, 0, 30, 10, 0, 'hall');
    const kerb = w.addSurface({ shape: { kind: 'rect', hx: 2, hz: 5 }, x: 12, z: -5, y: 0.3, material: 'metal', tag: 'kerb' });
    fxBox(w, 10, 0, 14, 10, 0, 0.3);
    fxBox(w, 20, 0, 21, 10, 0, 3, { tag: 'wall' });
    const up = w.moveCharacter(planPos(9.9, 5), R, 0.3, 0);
    expect(up).toMatchObject({ blocked: false, reason: null, grounded: true, normal: null });
    expect(up.surface).toBe(kerb);
    expect(up.surface!.desc.material).toBe('metal');
    expect(up.stepDy).toBeCloseTo(0.3, 9);
    const down = w.moveCharacter(planPos(13.9, 5, 0.3), R, 0.6, 0);
    expect(down.stepDy).toBeCloseTo(-0.3, 9);
    expect(down.surface!.desc.tag).toBe('hall');
    const wall = w.moveCharacter(planPos(19, 5), R, 2, 0);
    expect(wall).toMatchObject({ blocked: true, reason: 'solid' });
    const edge = w.moveCharacter(planPos(29, 5), R, 2, 0);
    expect(edge).toMatchObject({ blocked: true, reason: 'edge' });
    expect(edge.normal!.x).toBeCloseTo(-1, 3);
    const capped = w.moveCharacter(planPos(15, 5), R, 0, -1e6);
    expect(capped.blocked).toBe(true); // truncated or stopped at the hall's edge, never NaN
    expect(Number.isFinite(capped.z)).toBe(true);
    const big = world();
    big.addSurface({ shape: { kind: 'disc', r: 400 }, x: 0, z: 0, y: 0 });
    const far = big.moveCharacter({ x: 0, y: 0, z: 0 }, R, 300, 0);
    expect(far).toMatchObject({ blocked: true, reason: 'limit' });
    expect(far.x).toBeCloseTo(512 * R * 0.5, 6);
  });

  it('a lift plate moved with setPose carries the actor standing on it, and nav follows', () => {
    const w = world();
    fxFloor(w, 0, 0, 10, 10, 0, 'low');
    fxFloor(w, 14, 0, 24, 10, 3, 'high');
    const lift = w.addSurface({ shape: { kind: 'rect', hx: 2, hz: 2 }, x: 12, z: -5, y: 0, material: 'grate', tag: 'lift' });
    const a = planPos(5, 5), b = planPos(20, 5, 3);
    expect(lift.setPose).toBeTypeOf('function');
    expect(w.nav.findPath(a, b)).toBeNull();
    let pos = w.moveCharacter(planPos(9, 5), R, 3, 0); // walk onto the plate
    expect(pos.surface).toBe(lift);
    for (let i = 1; i <= 30; i++) {
      lift.setPose!(12, i * 0.1, -5);
      pos = w.moveCharacter(pos, R, 0, 0);
      expect(pos.y).toBeCloseTo(i * 0.1, 9);
      expect(pos.stepDy).toBeCloseTo(0.1, 9);
      expect(pos.grounded).toBe(true);
    }
    expect(w.moveCharacter(pos, R, 4, 0).surface!.desc.tag).toBe('high'); // steps off at the top
    expect(w.nav.findPath(a, b)).toBeNull(); // the plate is at the top: no way up from below
    expect(w.nav.findPath(planPos(12, 5, 3), b)).not.toBeNull();
    lift.setPose!(12, 0, -5);
    expect(w.nav.findPath(a, planPos(12, 5))).not.toBeNull();
    // a ramp keeps its rise when moved
    const ramp = w.addSurface({ shape: { kind: 'rect', hx: 1, hz: 2 }, x: 5, z: -20, y: 1, y1: 2 });
    ramp.setPose!(5, 4, -20);
    expect(ramp.desc.y1).toBe(5);
    expect(w.groundAt(5, -20, 6)!.y).toBeCloseTo(4.5);
    ramp.setPose!(NaN, 0, 0); // ignored
    expect(ramp.desc.y).toBe(4);
  });
});
