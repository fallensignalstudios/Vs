/**
 * Regression tests for the remaining findings of the physics-nav review: bad input that must not become
 * geometry, trigger points that are not finite, floors that stop sight lines and shots, allocation-free query
 * variants, and the authoring checks of validate().
 */
import { describe, expect, it, vi } from 'vitest';
import type { ColliderHandle, GroundHit, PhysicsWorld, RayHit, Vec3Like } from '@/core/api';
import { RAY_GROUND, RAY_MOVE, RAY_SHOT, RAY_SIGHT } from '@/core/api/physics';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ05, buildZ08, fxBox, fxFloor, planPos } from './fixtures';

const world = (): PhysicsWorld => createPhysicsWorld(null);
const v = (x: number, y: number, z: number): Vec3Like => ({ x, y, z });

describe('bad input never becomes geometry (review: phantom boxes at the origin)', () => {
  it('invalid colliders and surfaces are not registered: one warning with the tag, an inert handle', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = world();
    const f = buildZ05(w); // the origin is the middle of the shaft bridge
    const counts = { ...w.counts };
    const rev = w.revision;
    const bad: ColliderHandle[] = [
      w.addCollider({ shape: { kind: 'box', hx: NaN, hy: 1, hz: 1 }, x: 0, y: 1, z: 0, tag: 'nan-size' }),
      w.addCollider({ shape: { kind: 'cyl', r: 1, hy: 1 }, x: 0, y: Infinity, z: 0, tag: 'inf-pos' }),
      w.addCollider({ shape: { kind: 'blob' } as never, x: 0, y: 1, z: 0, tag: 'blob' }),
      w.addCollider({ shape: { kind: 'box', hx: 1, hy: 1, hz: 1 }, x: 0, y: 1, z: 0, yaw: NaN, tag: 'nan-yaw' }),
      w.addCollider(null as never),
      w.addCollider({} as never),
    ];
    const badSurfaces = [
      w.addSurface({ shape: { kind: 'rect', hx: 5, hz: NaN }, x: 0, z: 0, y: 0.3, tag: 'nan-rect' }),
      w.addSurface({ shape: { kind: 'disc', r: 5 }, x: 0, z: 0, y: NaN, tag: 'nan-y' }),
      w.addSurface({ shape: { kind: 'tri' } as never, x: 0, z: 0, y: 0.3 }),
      w.addSurface({ shape: { kind: 'rect', hx: 5, hz: 5 }, x: 0, z: 0, y: 0, y1: NaN }),
      w.addSurface(undefined as never),
    ];
    expect(w.counts).toEqual(counts);
    expect(w.revision).toBe(rev);
    for (const h of [...bad, ...badSurfaces]) {
      expect(h.enabled).toBe(false);
      h.enabled = true; // inert, exactly like a removed handle
      expect(h.enabled).toBe(false);
      expect(() => h.remove()).not.toThrow();
    }
    bad[0].setPose(1, 1, 1);
    expect(w.counts).toEqual(counts);
    // nothing appeared at the origin: the walker on the bridge is not shoved, the ground is still the bridge
    const m = w.moveCharacter(v(0, 0, 0), 0.4, 0, 0);
    expect(m).toMatchObject({ x: 0, y: 0, z: 0, blocked: false });
    expect(w.groundAt(0, 0, 0)!.surface).toBe(f.shaftBridge);
    expect(w.queryColliders(0, 0, 3, -10, 10)).toEqual([]);
    expect(w.raycast(v(-2, 1, 0), v(1, 0, 0), 4, RAY_MOVE | RAY_SIGHT | RAY_SHOT)).toBeNull();
    const text = warn.mock.calls.map((c) => String(c[0])).join('\n');
    for (const tag of ['"nan-size"', '"inf-pos"', '"blob"', '"nan-yaw"', '"nan-rect"', '"nan-y"', '(untagged)']) expect(text).toContain(tag);
    expect(text).toContain('ignored');
    // warnings are bounded however much garbage arrives
    const n = warn.mock.calls.length;
    for (let i = 0; i < 50; i++) w.addCollider({ shape: { kind: 'box', hx: NaN, hy: 1, hz: 1 }, x: i, y: 1, z: 0, tag: `spam-${i}` });
    expect(warn.mock.calls.length).toBeLessThanOrEqual(n + 6);
    warn.mockRestore();
  });

  it('negative sizes are taken as magnitudes, not rejected', () => {
    const w = world();
    fxFloor(w, 0, 0, 10, 10, 0);
    const c = w.addCollider({ shape: { kind: 'box', hx: -1, hy: -1, hz: -1 }, x: 5, y: 1, z: -5 });
    expect(c.enabled).toBe(true);
    expect(w.canStand(5, 0, -5, 0.4)).toBe(false);
    expect(w.counts.colliders).toBe(1);
  });
});

describe('triggers (review: a NaN point fired exit)', () => {
  it('a non-finite tracked point leaves every trigger state untouched, like null', () => {
    const w = world();
    const log: string[] = [];
    const t = w.addTrigger({ kind: 'circle', x: 0, z: 0, r: 2 }, () => log.push('in'), () => log.push('out'));
    w.updateTriggers(v(0, 0, 0));
    for (const p of [v(NaN, 0, 0), v(0, NaN, 0), v(0, 0, Infinity), null]) {
      w.updateTriggers(p);
      expect(t.inside).toBe(true);
    }
    w.updateTriggers(v(0.5, 0, 0)); // the next good frame: still inside, nothing re-fires
    expect(log).toEqual(['in']);
    w.updateTriggers(v(5, 0, 0));
    w.updateTriggers(v(NaN, NaN, NaN));
    expect(t.inside).toBe(false);
    expect(log).toEqual(['in', 'out']);
    expect(t.contains(v(NaN, 0, 0))).toBe(false);
  });
});

describe('floors are physical for rays (review: sight and shots through decks)', () => {
  it('nothing is seen or hit through a deck or a bare ramp; glass and grating opt out', () => {
    const w = world();
    buildZ05(w);
    // eye 1.6 m above the platform → a point 5 m beneath it
    expect(w.lineOfSight(v(20, 1.6, 0), v(22, -5, 3))).toBe(false);
    expect(w.lineOfFire(v(20, 1.6, 0), v(22, -5, 3))).toBe(false);
    expect(w.lineOfSight(v(6, 1.6, 5), v(7, -5, 6))).toBe(true); // down the open shaft
    const down = w.raycast(v(20, 1.2, 0), v(0, -1, 0), 50)!; // default mask
    expect(down).toMatchObject({ ground: true, collider: null, distance: 1.2 });
    expect(down.surface!.desc.tag).toBe('platform');
    expect(down.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(w.raycast(v(20, 1.2, 0), v(0, -1, 0), 50, RAY_MOVE)).toBeNull();

    const r = world();
    fxFloor(r, -20, -20, 20, 20, 0);
    const ramp = r.addSurface({ shape: { kind: 'rect', hx: 3, hz: 5 }, x: 0, z: 0, y: 0, y1: 3, tag: 'bare-ramp' }); // no under-fill
    const above = v(0, 4, 2), below = v(0, 0.5, 2); // the ramp is at 2.1 m there
    expect(r.lineOfSight(above, below)).toBe(false);
    expect(r.lineOfFire(above, below)).toBe(false);
    expect(r.raycast(above, v(0, -1, 0), 10, RAY_SHOT)!.surface).toBe(ramp);
    expect(r.raycast(below, v(0, 1, 0), 10, RAY_SHOT)!.normal.y).toBeLessThan(0); // hit from underneath
    expect(r.lineOfSight(v(-6, 1, 2), v(6, 1, 2))).toBe(true); // UNDER a thin ramp is open air: add fill solids for a body
    ramp.desc.blocksSight = false; // a glass ramp
    expect(r.lineOfSight(above, below)).toBe(true);
    expect(r.lineOfFire(above, below)).toBe(false);
    ramp.desc.blocksShots = false; // open grating
    expect(r.lineOfFire(above, below)).toBe(true);
    expect(r.raycast(above, v(0, -1, 0), 10, RAY_SHOT)!.surface!.desc.tag).not.toBe('bare-ramp');
    expect(r.raycast(above, v(0, -1, 0), 10, RAY_GROUND)!.surface).toBe(ramp); // RAY_GROUND ignores the flags
  });

  it('the floor an endpoint rests on does not block the line to it', () => {
    const w = world();
    buildZ04(w);
    const eye = planPos(20, 10, 1.6);
    expect(w.lineOfSight(eye, planPos(26, 10, 0))).toBe(true); // someone's feet
    expect(w.lineOfFire(eye, planPos(26, 10, 0.02))).toBe(true);
    expect(w.lineOfSight(eye, planPos(26, 10, -0.5))).toBe(false); // a point under the floor
    // from the floor up to the balcony: its deck hides whoever stands back from the edge
    expect(w.lineOfSight(planPos(40, 28, 1.6), planPos(52, 28, 3))).toBe(false);
    expect(w.lineOfSight(planPos(52, 28, 4.6), planPos(52, 28, 3))).toBe(true);
    // a camera sweep meets floors only when asked to
    expect(w.sweepSphere(planPos(20, 10, 2), planPos(20, 10, -1), 0.25)).toBe(1);
    expect(w.sweepSphere(planPos(20, 10, 2), planPos(20, 10, -1), 0.25, RAY_SIGHT | RAY_GROUND)).toBeCloseTo((1.75 - 0.01) / 3, 6);
  });
});

describe('allocation-free query variants (review: hot paths allocate)', () => {
  it('raycast, groundAt, queryColliders and coverNear fill caller-owned results', () => {
    const w = world();
    const f = buildZ04(w);
    const hit: RayHit = { point: v(0, 0, 0), normal: v(0, 0, 0), distance: 0, collider: null, ground: false };
    const point = hit.point, normal = hit.normal;
    const a = w.raycast(planPos(30, 18, 1), v(1, 0, 0), 20, undefined, hit);
    expect(a).toBe(hit);
    expect(hit.point).toBe(point);
    expect(hit.normal).toBe(normal);
    expect(hit).toMatchObject({ collider: f.receiverA, ground: false, surface: null });
    expect(hit.distance).toBeCloseTo(4.3, 6);
    expect(w.raycast(planPos(30, 18, 1), v(1, 0, 0), 2, undefined, hit)).toBeNull(); // a miss leaves `out` alone
    expect(hit.collider).toBe(f.receiverA);
    w.raycast(planPos(5, 5, 1.6), v(0, -1, 0), 10, RAY_GROUND, hit);
    expect(hit).toMatchObject({ collider: null, ground: true });
    expect(hit.surface!.desc.tag).toBe('floor');

    const gh = {} as GroundHit;
    expect(w.groundAt(51, -30, 3, undefined, gh)).toBe(gh);
    expect(gh.y).toBe(3);
    expect(gh.surface).toBe(f.balcony);
    expect(w.groundAt(500, 0, 0, undefined, gh)).toBeNull();
    expect(gh.surface).toBe(f.balcony);

    const list: ColliderHandle[] = [];
    expect(w.queryColliders(30.5, -7.5, 1, 0, 2, list)).toBe(list);
    expect(list).toEqual([f.lowCover[2]]);
    expect(w.queryColliders(20, -8, 0.5, 0, 2, list)).toEqual([]); // cleared, not appended
    const near = w.coverNear(31, -12, 12, list);
    expect(near).toBe(list);
    expect(list[0]).toBe(f.lowCover[2]);
    expect(list.length).toBe(w.coverNear(31, -12, 12).length);
  });
});

describe('validate() — authoring checks', () => {
  it('the fixture blockouts are clean', () => {
    for (const build of [buildZ04, buildZ08, buildZ05] as const) {
      const w = world();
      (build as (w: PhysicsWorld) => unknown)(w);
      expect(w.validate()).toEqual([]);
    }
  });

  it('flags walk-through solids, unusable catwalks, absurd ramps and void strips, and nothing else', () => {
    const w = world();
    fxFloor(w, 0, 0, 30, 30, 0, 'hall');
    fxBox(w, 5, 5, 6, 6, 0, 0.4, { tag: 'crate' }); // ≤ step-up, no top: everyone walks through it
    fxBox(w, 8, 5, 9, 6, 0, 0.4, { tag: 'plinth' });
    fxFloor(w, 8, 5, 9, 6, 0.4, 'plinth-top'); // capped: a step
    fxBox(w, 11, 5, 12, 6, 0, 1.2, { tag: 'cover' }); // tall enough to block
    fxBox(w, 14, 5, 15, 6, 0, 0.4, { tag: 'decal-volume', blocksMove: false }); // does not claim to block
    w.addSurface({ shape: { kind: 'rect', hx: 0.2, hz: 6 }, x: 40, z: -10, y: 0, tag: 'catwalk' }); // 0.4 m wide over a void
    w.addSurface({ shape: { kind: 'rect', hx: 2, hz: 1 }, x: 20, z: -20, y: 0, y1: 5, tag: 'typo-ramp' });
    fxFloor(w, 30.3, 0, 35, 30, 0, 'annex'); // 0.3 m void strip beside the hall
    const issues = w.validate();
    const by = (kind: string): string[] => issues.filter((i) => i.kind === kind).map((i) => i.message);
    expect(by('low-solid')).toHaveLength(1);
    expect(by('low-solid')[0]).toContain('"crate"');
    expect(by('narrow')).toHaveLength(1);
    expect(by('narrow')[0]).toContain('"catwalk"');
    expect(by('steep')).toHaveLength(1);
    expect(by('steep')[0]).toContain('"typo-ramp"');
    expect(by('gap')).toHaveLength(1);
    expect(by('gap')[0]).toMatch(/"hall".*"annex"|"annex".*"hall"/);
    expect(issues).toHaveLength(4);
    const crate = issues.find((i) => i.kind === 'low-solid')!;
    expect(crate).toMatchObject({ x: 5.5, y: 0.4, z: -5.5 });
    // …and the crate really is the problem it is reported as
    const through = w.moveCharacter(planPos(3, 5.5), 0.4, 2.5, 0);
    expect(through.x).toBeCloseTo(5.5, 9);
    expect(through.blocked).toBe(false);
    // two modules that touch along part of their edge are joined: the sliver beside the junction is not a strip
    const j = world();
    fxFloor(j, 0, 0, 10, 10, 0, 'a');
    j.addSurface({ shape: { kind: 'rect', hx: 5, hz: 5 }, x: 15.2, z: -5, yaw: 0.04, y: 0, tag: 'b-askew' });
    expect(j.validate().filter((i) => i.kind === 'gap')).toEqual([]);
    expect(createPhysicsWorld(null).validate()).toEqual([]);
  });
});
