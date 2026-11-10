import { describe, expect, it, vi } from 'vitest';
import type { PhysicsWorld } from '@/core/api';
import { createPhysicsWorld } from './index';
import { buildZ04, buildZ05, fxBox, fxFloor, planPos } from './fixtures';

const world = (): PhysicsWorld => createPhysicsWorld(null);

describe('surfaces / groundAt', () => {
  it('returns the highest surface within step-up of the reference height', () => {
    const w = world();
    const floor = fxFloor(w, 0, 0, 10, 10, 0);
    const dais = fxFloor(w, 4, 4, 6, 6, 0.3);
    const deck = fxFloor(w, 0, 0, 10, 10, 3);
    expect(w.groundAt(1, -1, 0)?.surface).toBe(floor);
    expect(w.groundAt(5, -5, 0)?.surface).toBe(dais);
    expect(w.groundAt(5, -5, 0)?.y).toBeCloseTo(0.3);
    expect(w.groundAt(5, -5, 3)?.surface).toBe(deck);
    expect(w.groundAt(5, -5, 2.5)?.surface).toBe(dais); // 3 > 2.5 + 0.45
    expect(w.groundAt(5, -5, 2.56)?.surface).toBe(deck);
    expect(w.groundAt(5, -5, 2.5, 1)?.surface).toBe(deck); // explicit step-up
    expect(w.groundAt(5, -5, -1)).toBeNull();
    expect(w.groundAt(11, -1, 0)).toBeNull();
  });

  it('treats surface edges as inclusive so adjoining floors have no crack', () => {
    const w = world();
    fxFloor(w, 0, 0, 10, 10, 0);
    fxFloor(w, 10, 0, 20, 10, 0);
    for (let n = 0; n <= 10; n += 0.37) expect(w.groundAt(10, -n, 0)).not.toBeNull();
    expect(w.groundAt(0, 0, 0)).not.toBeNull();
    expect(w.groundAt(20, -10, 0)).not.toBeNull();
    expect(w.groundAt(20.001, -10, 0)).toBeNull();
  });

  it('interpolates ramps from y (local -Z edge) to y1 (local +Z edge)', () => {
    const w = world();
    // yaw 0: local +Z is world +Z (south). North edge at 3, south edge at 0.
    w.addSurface({ shape: { kind: 'rect', hx: 3, hz: 6 }, x: 0, z: 0, y: 3, y1: 0 });
    expect(w.groundAt(0, -6, 5)?.y).toBeCloseTo(3);
    expect(w.groundAt(0, 6, 5)?.y).toBeCloseTo(0);
    expect(w.groundAt(2, 0, 5)?.y).toBeCloseTo(1.5);
    expect(w.groundAt(-1, 3, 5)?.y).toBeCloseTo(0.75);
    // yaw +90°: local +Z points to world +X (east). West edge y, east edge y1.
    const w2 = world();
    w2.addSurface({ shape: { kind: 'rect', hx: 3, hz: 6 }, x: 0, z: 0, yaw: Math.PI / 2, y: 0, y1: 3 });
    expect(w2.groundAt(-6, 0, 5)?.y).toBeCloseTo(0);
    expect(w2.groundAt(6, 0, 5)?.y).toBeCloseTo(3);
    expect(w2.groundAt(3, 2.9, 5)?.y).toBeCloseTo(2.25);
    expect(w2.groundAt(0, 3.1, 5)).toBeNull(); // hx (3) now spans world Z
    expect(w2.groundAt(5.9, 0, 5)).not.toBeNull();
  });

  it('supports oriented rects', () => {
    const w = world();
    w.addSurface({ shape: { kind: 'rect', hx: 5, hz: 1 }, x: 0, z: 0, yaw: Math.PI / 4, y: 0 });
    // long axis (local X) rotated 45°: local +X → world (cos, −sin)
    const k = Math.SQRT1_2;
    expect(w.groundAt(4 * k, -4 * k, 0)).not.toBeNull();
    expect(w.groundAt(4 * k, 4 * k, 0)).toBeNull();
    expect(w.groundAt(0.9 * k, 0.9 * k, 0)).not.toBeNull();
    expect(w.groundAt(1.1 * k, 1.1 * k, 0)).toBeNull();
  });

  it('supports discs with an inner hole (annulus)', () => {
    const w = world();
    const f = buildZ05(w);
    expect(w.groundAt(20, 0, 0)).not.toBeNull();
    expect(w.groundAt(36, 0, 0)).not.toBeNull();
    expect(w.groundAt(0, 36.5, 0)?.surface.desc.tag).toBe('bridge'); // approach bridge beyond the rim
    expect(w.groundAt(25.6, 25.6, 0)).toBeNull(); // r = 36.2
    expect(w.groundAt(8, 4, 0)).toBeNull(); // inside the shaft, off the bridge
    expect(w.groundAt(2, 5, 0)?.surface).toBe(f.shaftBridge);
    expect(w.groundAt(9, 0, 0)?.surface).toBe(f.platform);
  });

  it('ignores disabled and removed surfaces', () => {
    const w = world();
    const a = fxFloor(w, 0, 0, 10, 10, 0);
    const b = fxFloor(w, 0, 0, 10, 10, 0.2);
    expect(w.groundAt(5, -5, 0)?.surface).toBe(b);
    b.enabled = false;
    expect(w.groundAt(5, -5, 0)?.surface).toBe(a);
    b.enabled = true;
    expect(w.groundAt(5, -5, 0)?.surface).toBe(b);
    b.remove();
    expect(w.groundAt(5, -5, 0)?.surface).toBe(a);
    expect(w.counts.surfaces).toBe(1);
    b.remove(); // idempotent
    b.enabled = true; // inert
    expect(b.enabled).toBe(false);
    expect(w.counts.surfaces).toBe(1);
  });

  it('handles very large surfaces (oversize broadphase path)', () => {
    const w = world();
    w.addSurface({ shape: { kind: 'disc', r: 400 }, x: 0, z: 0, y: 0 });
    expect(w.groundAt(390, 0, 0)).not.toBeNull();
    expect(w.groundAt(-250, 250, 0)).not.toBeNull();
    expect(w.groundAt(300, 300, 0)).toBeNull();
    expect(w.canStand(-100, 0, 100, 0.4)).toBe(true);
  });
});

describe('canStand / nearestStandable', () => {
  it('requires ground under the feet and no overlapping solid', () => {
    const w = world();
    fxFloor(w, 0, 0, 20, 20, 0);
    fxBox(w, 9, 9, 11, 11, 0, 2.2);
    expect(w.canStand(5, 0, -5, 0.4)).toBe(true);
    expect(w.canStand(10, 0, -10, 0.4)).toBe(false); // inside
    expect(w.canStand(8.7, 0, -10, 0.4)).toBe(false); // overlapping the face
    expect(w.canStand(8.55, 0, -10, 0.4)).toBe(true);
    expect(w.canStand(25, 0, -5, 0.4)).toBe(false); // off the floor
    expect(w.canStand(5, 2, -5, 0.4)).toBe(false); // 2 m above the floor: not standing there
    expect(w.canStand(5, 0.5, -5, 0.4)).toBe(true); // within max drop
  });

  it('ignores solids below step height and above head height', () => {
    const w = world();
    fxFloor(w, 0, 0, 20, 20, 0);
    fxBox(w, 4, 4, 6, 6, 0, 0.4); // kerb
    fxBox(w, 14, 14, 16, 16, 2.6, 3); // slab overhead
    fxBox(w, 9, 9, 11, 11, 1.7, 3); // low beam
    expect(w.canStand(5, 0, -5, 0.4)).toBe(true);
    expect(w.canStand(15, 0, -15, 0.4)).toBe(true);
    expect(w.canStand(10, 0, -10, 0.4)).toBe(false);
    expect(w.canStand(10, 0, -10, 0.4, 1.6)).toBe(true); // a shorter character fits
  });

  it('finds the nearest standable point around obstacles and off-surface positions', () => {
    const w = world();
    fxFloor(w, 0, 0, 20, 20, 0);
    fxBox(w, 9, 9, 11, 11, 0, 2.2);
    const inside = w.nearestStandable(10.6, 0, -10, 0.4)!;
    expect(inside).not.toBeNull();
    expect(w.canStand(inside.x, inside.y, inside.z, 0.4)).toBe(true);
    expect(Math.hypot(inside.x - 10.6, inside.z + 10)).toBeLessThan(1.1); // exits through the near (east) face
    expect(inside.x).toBeGreaterThan(11.3);

    const off = w.nearestStandable(21.5, 0, -5, 0.4)!;
    expect(off.x).toBeLessThanOrEqual(20);
    expect(off.x).toBeGreaterThan(19.6);
    expect(Math.abs(off.z + 5)).toBeLessThan(0.3);

    const same = w.nearestStandable(3, 0, -3, 0.4)!;
    expect(same).toEqual({ x: 3, y: 0, z: -3 });
    expect(w.nearestStandable(60, 0, -60, 0.4, 4)).toBeNull();
  });

  it('prefers the reference level, then falls back to any level', () => {
    const w = world();
    const f = buildZ04(w, { rails: false });
    const onDeck = w.nearestStandable(f.marks.balcony.x, 3.1, f.marks.balcony.z, 0.4)!;
    expect(onDeck.y).toBeCloseTo(3);
    const below = w.nearestStandable(f.marks.balcony.x, 0, f.marks.balcony.z, 0.4)!;
    expect(below.y).toBeCloseTo(0);
    // hovering 1.6 m up over the open floor: no surface within step/drop → lenient pass lands on the floor
    const mid = w.nearestStandable(20, 1.6, -5, 0.4)!;
    expect(mid.y).toBeCloseTo(0);
  });
});

describe('colliders', () => {
  it('queryColliders filters by circle overlap and y range', () => {
    const w = world();
    const a = fxBox(w, 0, 0, 2, 2, 0, 1.2, { tag: 'a' });
    const b = fxBox(w, 5, 0, 7, 2, 3, 4, { tag: 'b' });
    const c = w.addCollider({ shape: { kind: 'cyl', r: 1, hy: 1 }, x: 10, y: 1, z: -1 });
    expect(w.queryColliders(1, -1, 0.1, 0, 2)).toEqual([a]);
    expect(w.queryColliders(3, -1, 1.01, 0, 2)).toEqual([a]);
    expect(w.queryColliders(3, -1, 0.9, 0, 2)).toEqual([]);
    expect(w.queryColliders(6, -1, 0.5, 0, 2)).toEqual([]);
    expect(w.queryColliders(6, -1, 0.5, 0, 3.5)).toEqual([b]);
    expect(w.queryColliders(5, -1, 20, -10, 10)).toEqual([a, b, c]);
    expect(w.queryColliders(12, -1, 1.05, 0, 2)).toEqual([c]);
    a.enabled = false;
    expect(w.queryColliders(1, -1, 0.1, 0, 2)).toEqual([]);
  });

  it('coverNear returns cover colliders nearest first', () => {
    const w = world();
    const f = buildZ04(w);
    const near = w.coverNear(31, -12, 12);
    expect(near.length).toBeGreaterThanOrEqual(3);
    expect(near.every((c) => c.desc.cover === 'low' || c.desc.cover === 'high')).toBe(true);
    expect(near[0]).toBe(f.lowCover[2]); // the 29..32 × 6..9 island
    const d = (c: { desc: { x: number; z: number } }): number => Math.hypot(c.desc.x - 31, c.desc.z + 12);
    for (let i = 1; i < near.length; i++) expect(d(near[i]) + 2.2).toBeGreaterThan(d(near[i - 1]));
    f.lowCover[2].enabled = false; // destroyed cover drops out
    expect(w.coverNear(31, -12, 12)[0]).not.toBe(f.lowCover[2]);
    expect(w.coverNear(31, -12, 0.5)).toEqual([]);
  });

  it('setPose moves a collider through the broadphase', () => {
    const w = world();
    fxFloor(w, 0, 0, 40, 10, 0);
    const c = fxBox(w, 4, 4, 6, 6, 0, 2);
    expect(w.canStand(5, 0, -5, 0.4)).toBe(false);
    c.setPose(30, 1, -5);
    expect(w.canStand(5, 0, -5, 0.4)).toBe(true);
    expect(w.canStand(30, 0, -5, 0.4)).toBe(false);
    expect(c.desc.x).toBe(30);
    c.setPose(30, 1, -5, Math.PI / 4); // rotated: corners reach 1.41 along the axes
    expect(w.canStand(31.6, 0, -5, 0.4)).toBe(false);
    expect(w.canStand(31.9, 0, -5, 0.4)).toBe(true);
    c.setPose(NaN, 0, 0); // ignored
    expect(c.desc.x).toBe(30);
    c.remove();
    expect(w.canStand(30, 0, -5, 0.4)).toBe(true);
    expect(w.counts.colliders).toBe(0);
  });

  it('copies descriptions and survives malformed input without throwing', () => {
    const w = world();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const desc = { shape: { kind: 'box' as const, hx: 1, hy: 1, hz: 1 }, x: 1, y: 1, z: 1 };
    const h = w.addCollider(desc);
    desc.x = 99;
    expect(h.desc.x).toBe(1);
    expect(() => w.addCollider({ shape: { kind: 'box', hx: NaN, hy: -1, hz: 1 }, x: NaN, y: 0, z: 0 })).not.toThrow();
    expect(() => w.addCollider(null as never)).not.toThrow();
    expect(() => w.addSurface({ shape: { kind: 'tri' } as never, x: 0, z: 0, y: 0 })).not.toThrow();
    expect(() => w.addSurface(undefined as never)).not.toThrow();
    expect(() => w.addTrigger({ kind: 'blob' } as never)).not.toThrow();
    expect(w.groundAt(NaN, 0, 0)).toBeNull();
    expect(w.canStand(NaN, 0, 0, 0.4)).toBe(false);
    expect(w.nearestStandable(NaN, 0, 0, 0.4)).toBeNull();
    expect(w.queryColliders(NaN, 0, 1, 0, 1)).toEqual([]);
    expect(w.coverNear(0, NaN, 5)).toEqual([]);
    expect(() => w.updateTriggers({ x: NaN, y: 0, z: 0 })).not.toThrow();
    warn.mockRestore();
  });

  it('clear() empties the world and bumps the revision', () => {
    const w = world();
    const f = buildZ04(w);
    w.nav.rebuild();
    expect(w.counts.colliders).toBeGreaterThan(30);
    expect(w.counts.surfaces).toBeGreaterThanOrEqual(6);
    const rev = w.revision;
    w.clear();
    expect(w.counts).toEqual({ colliders: 0, surfaces: 0, triggers: 0 });
    expect(w.revision).toBeGreaterThan(rev);
    expect(w.groundAt(31, -5, 0)).toBeNull();
    expect(w.nav.built).toBe(false);
    expect(w.nav.findPath(f.marks.entry, f.marks.floorMid)).toBeNull();
    expect(w.raycast(planPos(31, 5, 1), { x: 0, y: 0, z: -1 }, 100)).toBeNull();
    f.door.enabled = false; // inert handle
    f.door.setPose(0, 0, 0);
    f.door.remove();
    expect(w.counts.colliders).toBe(0);
    // the world is reusable after clear
    fxFloor(w, 0, 0, 5, 5, 0);
    expect(w.groundAt(2, -2, 0)).not.toBeNull();
  });
});

describe('triggers', () => {
  it('fires enter / exit on edges only', () => {
    const w = world();
    const log: string[] = [];
    const t = w.addTrigger({ kind: 'box', x: 5, z: -5, hx: 2, hz: 1 }, () => log.push('in'), () => log.push('out'));
    expect(t.inside).toBe(false);
    w.updateTriggers({ x: 0, y: 0, z: 0 });
    w.updateTriggers({ x: 4, y: 0, z: -5 });
    w.updateTriggers({ x: 5, y: 0, z: -5.5 });
    expect(t.inside).toBe(true);
    w.updateTriggers({ x: 5, y: 0, z: -6.5 });
    w.updateTriggers({ x: 9, y: 0, z: -6.5 });
    w.updateTriggers({ x: 6.9, y: 0, z: -4.1 });
    expect(log).toEqual(['in', 'out', 'in']);
    expect(w.counts.triggers).toBe(1);
  });

  it('supports circles, yaw and vertical ranges', () => {
    const w = world();
    const circle = w.addTrigger({ kind: 'circle', x: 0, z: 0, r: 2, yMin: 2.5, yMax: 4 });
    const box = w.addTrigger({ kind: 'box', x: 10, z: 0, hx: 4, hz: 0.5, yaw: Math.PI / 2 });
    w.updateTriggers({ x: 1, y: 0, z: 1 });
    expect(circle.inside).toBe(false); // under the balcony volume
    w.updateTriggers({ x: 1, y: 3, z: 1 });
    expect(circle.inside).toBe(true);
    w.updateTriggers({ x: 10, y: 0, z: 3.5 }); // long axis now runs along Z
    expect(box.inside).toBe(true);
    expect(circle.inside).toBe(false);
    w.updateTriggers({ x: 13.5, y: 0, z: 0 });
    expect(box.inside).toBe(false);
    expect(box.contains({ x: 10, y: 50, z: -3.9 })).toBe(true);
    expect(circle.contains({ x: 0, y: 5, z: 0 })).toBe(false);
  });

  it('keeps state on a null point, and handles disable / remove / re-entrancy', () => {
    const w = world();
    const log: string[] = [];
    const a = w.addTrigger({ kind: 'circle', x: 0, z: 0, r: 2 }, () => log.push('a+'), () => log.push('a-'));
    w.updateTriggers({ x: 0, y: 0, z: 0 });
    w.updateTriggers(null); // player dead: nothing fires
    expect(a.inside).toBe(true);
    expect(log).toEqual(['a+']);
    a.enabled = false; // silently leaves
    expect(a.inside).toBe(false);
    w.updateTriggers({ x: 0, y: 0, z: 0 });
    expect(log).toEqual(['a+']);
    a.enabled = true;
    w.updateTriggers({ x: 0, y: 0, z: 0 });
    expect(log).toEqual(['a+', 'a+']);

    // callbacks may remove themselves, add triggers, throw, or clear the world
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const once = w.addTrigger({ kind: 'circle', x: 20, z: 0, r: 2 }, () => { log.push('once'); once.remove(); });
    w.addTrigger({ kind: 'circle', x: 20, z: 0, r: 2 }, () => { throw new Error('zone script bug'); });
    w.addTrigger({ kind: 'circle', x: 20, z: 0, r: 2 }, () => {
      log.push('spawner');
      w.addTrigger({ kind: 'circle', x: 20, z: 0, r: 3 }, () => log.push('child'));
    });
    w.updateTriggers({ x: 20, y: 0, z: 0 });
    expect(log.slice(2)).toEqual(['a-', 'once', 'spawner', 'child']);
    expect(err).toHaveBeenCalledTimes(1);
    w.updateTriggers({ x: 50, y: 0, z: 0 });
    w.updateTriggers({ x: 20, y: 0, z: 0 });
    expect(log.filter((l) => l === 'once')).toHaveLength(1);
    expect(w.counts.triggers).toBe(5); // a, thrower, spawner + one child per spawner entry

    w.addTrigger({ kind: 'circle', x: 80, z: 0, r: 2 }, () => w.clear());
    expect(() => w.updateTriggers({ x: 80, y: 0, z: 0 })).not.toThrow();
    expect(w.counts.triggers).toBe(0);
    err.mockRestore();
  });
});
