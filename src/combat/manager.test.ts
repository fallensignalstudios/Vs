import { describe, expect, it } from 'vitest';
import type { Actor } from '@/core/api';
import { DEG } from '@/core/mathx';
import { createPhysicsWorld } from '@/world/physics';
import { rayVsCapsule, rayVsSphere } from './queries';
import { FakeVisual, makeWorld } from './testkit';

describe('hostility matrix', () => {
  it('defaults: eclipse and contaminated against everyone but neutral; factions only when an encounter says so', () => {
    const w = makeWorld();
    const mk = (team: Actor['team'], x: number) => w.dummy({ team, x });
    const player = mk('player', 0);
    const dom = mk('dominion', 1);
    const ref = mk('reformation', 2);
    const con = mk('contaminated', 3);
    const ecl = mk('eclipse', 4);
    const neu = mk('neutral', 5);
    const h = (a: Actor, b: Actor) => w.actors.areHostile(a, b);
    for (const x of [player, dom, ref, con]) expect(h(ecl, x)).toBe(true);
    for (const x of [player, dom, ref, ecl]) expect(h(con, x)).toBe(true);
    expect(h(ecl, neu)).toBe(false);
    expect(h(con, neu)).toBe(false);
    expect(h(player, dom)).toBe(false);
    expect(h(player, ref)).toBe(false);
    expect(h(dom, ref)).toBe(false);
    expect(h(ecl, w.dummy({ team: 'eclipse', x: 6 }))).toBe(false);
    expect(h(player, player)).toBe(false);
    w.actors.setHostile('player', 'reformation', true);
    expect(h(player, ref)).toBe(true);
    expect(h(ref, player)).toBe(true);
    expect(w.actors.teamsHostile('reformation', 'player')).toBe(true);
    w.actors.resetHostility();
    expect(h(player, ref)).toBe(false);
    expect(h(player, ecl)).toBe(true);
    // protected NPCs are hostile to nobody
    const npc = w.dummy({ team: 'eclipse', x: 7, protectedNpc: true });
    expect(h(player, npc)).toBe(false);
  });

  it('hostilesOf lists living targetable hostiles, nearest first', () => {
    const w = makeWorld();
    const me = w.dummy({ team: 'player' });
    const far = w.dummy({ x: 9 });
    const near = w.dummy({ x: 2 });
    const dead = w.dummy({ x: 1 });
    const hidden = w.dummy({ x: 1.5, targetable: false });
    w.dummy({ team: 'dominion', x: 3 });
    w.actors.kill(dead);
    expect(hidden.targetable).toBe(false);
    expect(w.actors.hostilesOf(me)).toEqual([near, far]);
  });
});

describe('queries', () => {
  it('ray vs sphere / capsule', () => {
    expect(rayVsSphere(0, 0, 0, 0, 0, -1, 0, 0, -5, 1)).toBeCloseTo(4, 6);
    expect(rayVsSphere(0, 0, 0, 0, 0, 1, 0, 0, -5, 1)).toBe(-1);
    expect(rayVsSphere(0, 0, -5, 1, 0, 0, 0, 0, -5, 1)).toBe(0);
    // body, both caps, above the head, origin inside, vertical ray
    expect(rayVsCapsule(0, 1, 5, 0, 0, -1, 0, 0, 1.8, 0, 0.4)).toBeCloseTo(4.6, 6);
    expect(rayVsCapsule(0, 1.75, 5, 0, 0, -1, 0, 0, 1.8, 0, 0.4)).toBeGreaterThan(4.6);
    expect(rayVsCapsule(0, 0.05, 5, 0, 0, -1, 0, 0, 1.8, 0, 0.4)).toBeGreaterThan(4.6);
    expect(rayVsCapsule(0, 1.9, 5, 0, 0, -1, 0, 0, 1.8, 0, 0.4)).toBe(-1);
    expect(rayVsCapsule(0, 1, 0, 0, 0, -1, 0, 0, 1.8, 0, 0.4)).toBe(0);
    expect(rayVsCapsule(0.1, 5, 0, 0, -1, 0, 0, 0, 1.8, 0, 0.4)).toBeGreaterThan(3.1);
    expect(rayVsCapsule(0.6, 5, 0, 0, -1, 0, 0, 0, 1.8, 0, 0.4)).toBe(-1);
  });

  it('raycast returns the nearest body and reports an exposed weak point', () => {
    const w = makeWorld();
    const front = w.dummy({ z: -4 });
    w.dummy({ z: -8 });
    const hit = w.actors.raycast({ x: 0, y: 1.1, z: 0 }, { x: 0, y: 0, z: -1 }, 30);
    expect(hit?.actor).toBe(front);
    expect(hit?.distance).toBeCloseTo(3.6, 3);
    expect(hit?.weakPoint).toBeNull();
    expect(w.actors.raycast({ x: 0, y: 1.1, z: 0 }, { x: 0, y: 0, z: -1 }, 3)).toBeNull();
    expect(w.actors.raycast({ x: 0, y: 1.1, z: 0 }, { x: 0, y: 0, z: -1 }, 30, (a) => a !== front)?.distance).toBeCloseTo(7.6, 3);
    // a drone with a rear vent: only a shot from behind finds it
    const v = new FakeVisual('secDrone', 0.7);
    v.setSocket('vent', 0, 0, 0.45);
    const drone = w.actors.spawn({
      archetype: 'secDrone', team: 'eclipse', hp: 60, pos: { x: 10, y: 1.8, z: 0 }, flying: true, hoverHeight: 1.8, radius: 0.45, height: 0.7,
      visual: v.asVisual(), weakPoints: [{ id: 'vent', socket: 'vent', radius: 0.2, multiplier: 2, exposed: true }],
    });
    w.step(1 / 60);
    const y = drone.pos.y;
    expect(w.actors.raycast({ x: 10, y, z: 6 }, { x: 0, y: 0, z: -1 }, 30)?.weakPoint?.id).toBe('vent');
    expect(w.actors.raycast({ x: 10, y, z: -6 }, { x: 0, y: 0, z: 1 }, 30)?.weakPoint ?? null).toBeNull();
  });

  it('inArc respects the arc across the ±π wrap, range and height; inRadius sorts by distance', () => {
    const w = makeWorld();
    const a = w.dummy({ x: 0, z: 2 });
    const b = w.dummy({ x: 1.2, z: 1.6 });
    const side = w.dummy({ x: -3, z: 0 });
    const high = w.dummy({ x: 0, z: 1.5 });
    high.pos.y = 5;
    // facing +Z is yaw = π: the wrap case
    const got = w.actors.inArc({ x: 0, y: 0, z: 0 }, Math.PI, 120 * DEG, 3);
    expect(got).toContain(a);
    expect(got).toContain(b);
    expect(got).not.toContain(side);
    expect(got).not.toContain(high);
    expect(w.actors.inArc({ x: 0, y: 0, z: 0 }, -Math.PI, 120 * DEG, 3).length).toBe(2);
    expect(w.actors.inArc({ x: 0, y: 0, z: 0 }, Math.PI, 120 * DEG, 1).length).toBe(0);
    expect(w.actors.inArc({ x: 0, y: 0, z: 0 }, 0, 360 * DEG, 3.5)).toEqual([b, a, side]);
    expect(w.actors.inRadius({ x: 0, y: 0, z: 0 }, 2.9)).toEqual([b, a, side]);
    expect(w.actors.nearest({ x: 0, y: 0, z: 0 }, 10)).toBe(b);
    expect(w.actors.nearest({ x: 0, y: 0, z: 0 }, 10, (x) => x !== b)).toBe(a);
  });

  it('query results survive nested queries', () => {
    const w = makeWorld();
    for (let i = 0; i < 6; i++) w.dummy({ x: i * 1.5, tags: ['pack'] });
    const outer = w.actors.inRadius({ x: 0, y: 0, z: 0 }, 50);
    let seen = 0;
    for (const o of outer) {
      expect(w.actors.inRadius(o.pos, 2).length).toBeGreaterThan(0);
      expect(w.actors.byTag('pack').length).toBe(6);
      seen++;
    }
    expect(seen).toBe(6);
  });
});

describe('update', () => {
  it('integrates desiredVel / carryVel, clears them, reports velocity', () => {
    const w = makeWorld();
    let go = true;
    const a = w.dummy({ controller: { update: (x) => { if (go) { x.desiredVel.set(2, 0, 0); x.carryVel?.set(0, 0, -1); } } } });
    w.step(1);
    expect(a.pos.x).toBeCloseTo(2, 4);
    expect(a.pos.z).toBeCloseTo(-1, 4);
    expect(a.vel.x).toBeCloseTo(2, 4);
    go = false;
    w.step(0.1);
    expect(a.pos.x).toBeCloseTo(2, 4);
    expect(a.desiredVel.lengthSq()).toBe(0);
  });

  it('a throwing controller is contained', () => {
    const w = makeWorld();
    const bad = w.dummy({ controller: { update() { throw new Error('boom'); } } });
    const good = w.dummy({ x: 5, controller: { update: (x) => x.desiredVel.set(1, 0, 0) } });
    expect(() => w.step(0.5)).not.toThrow();
    expect(bad.alive).toBe(true);
    expect(good.pos.x).toBeGreaterThan(5.4);
  });

  it('separates overlapping bodies, never moving protected NPCs or fixed actors', () => {
    const w = makeWorld();
    const a = w.dummy({ x: 0 });
    const b = w.dummy({ x: 0.3 });
    const npc = w.dummy({ x: 10, protectedNpc: true });
    const c = w.dummy({ x: 10.2 });
    const device = w.dummy({ x: 20, fixed: true });
    const d = w.dummy({ x: 20.1 });
    w.step(1.5);
    expect(b.pos.x - a.pos.x).toBeGreaterThan(0.75);
    expect(a.pos.x).toBeLessThan(0);
    expect(npc.pos.x).toBe(10);
    expect(c.pos.x - npc.pos.x).toBeGreaterThan(0.75);
    expect(device.pos.x).toBe(20);
    expect(d.pos.x - device.pos.x).toBeGreaterThan(0.75);
  });

  it('clear() keeps actors tagged persist; despawn removes immediately', () => {
    const w = makeWorld();
    const keep = w.dummy({ tags: ['persist'] });
    const gone = w.dummy({ x: 3 });
    const one = w.dummy({ x: 6 });
    w.actors.despawn(one);
    expect(w.actors.all).not.toContain(one);
    expect(one.alive).toBe(false);
    w.actors.clear();
    expect(w.actors.all).toEqual([keep]);
    expect(gone.alive).toBe(false);
  });

  it('revive brings a dead body back', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 50, corpseSeconds: Infinity });
    w.actors.kill(a);
    w.step(5);
    expect(w.actors.all).toContain(a);
    w.actors.revive(a);
    expect(a.alive).toBe(true);
    expect(a.targetable).toBe(true);
    expect(a.hp).toBe(50);
  });

  it('regenerates hp', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 900, regen: 25 });
    a.hp = 800;
    w.step(2);
    expect(a.hp).toBeCloseTo(850, 0);
    w.step(10);
    expect(a.hp).toBe(900);
  });
});

describe('update with the real physics world', () => {
  function room() {
    const physics = createPhysicsWorld(null);
    physics.addSurface({ shape: { kind: 'rect', hx: 10, hz: 10 }, x: 0, z: 0, y: 0 });
    physics.addCollider({ shape: { kind: 'box', hx: 0.5, hy: 1.5, hz: 6 }, x: 4, y: 1.5, z: 0 });
    return physics;
  }

  it('walls stop bodies, ledges are never crossed, knockback included', () => {
    const w = makeWorld({ physics: room() });
    const walker = w.dummy({ x: 0, z: 0, controller: { update: (x) => x.desiredVel.set(6, 0, 0) } });
    const faller = w.dummy({ x: 0, z: 8, controller: { update: (x) => x.desiredVel.set(0, 0, 6) } });
    const thrown = w.dummy({ x: -8, z: -8 });
    thrown.impulse.set(-30, 0, 0);
    w.step(3);
    expect(walker.pos.x).toBeLessThan(3.2);
    expect(walker.pos.x).toBeGreaterThan(2.9);
    expect(faller.pos.z).toBeLessThanOrEqual(10);
    expect(thrown.pos.x).toBeGreaterThanOrEqual(-10);
    expect(thrown.pos.y).toBe(0);
  });

  it('flying actors hover over the ground and pass over nothing solid at their height', () => {
    const w = makeWorld({ physics: room() });
    const drone = w.actors.spawn({
      archetype: 'secDrone', team: 'eclipse', hp: 60, pos: { x: 0, y: 0, z: 0 }, flying: true, hoverHeight: 1.8, radius: 0.45, height: 0.7,
      controller: { update: (x) => x.desiredVel.set(6, 0, 0) },
    });
    expect(drone.pos.y).toBeCloseTo(1.8, 6);
    w.step(3);
    expect(drone.pos.y).toBeCloseTo(1.8, 2);
    expect(drone.pos.x).toBeLessThan(3.1);
  });

  it('an actor spawned inside a solid is put somewhere it can stand; fixed actors are left alone', () => {
    const w = makeWorld({ physics: room() });
    const stuck = w.dummy({ x: 4, z: 0 });
    const mounted = w.dummy({ x: 4, z: 2, fixed: true });
    w.step(0.2);
    expect(Math.abs(stuck.pos.x - 4)).toBeGreaterThan(0.85);
    expect(mounted.pos.x).toBe(4);
  });
});
