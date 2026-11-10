import { describe, expect, it } from 'vitest';
import { TUNING } from '@/combat/tuning';
import { makeAiWorld } from './testkit';

describe('link system', () => {
  it('links give resistance and synchronisation; severing restores the body and staggers it', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, 25);
    const weaver = w.ai.spawnEnemy('weaver', { pos: { x: 0, y: 0, z: -20 }, dormant: true });
    const body = w.ai.spawnEnemy('linkbound', { pos: { x: 4, y: 0, z: -14 }, dormant: true });
    const link = w.ai.links.create(weaver, body);
    expect(link.alive).toBe(true);
    expect(body.linked).toBe(true);
    expect(body.poiseTakenScale).toBeCloseTo(TUNING.enemies.linkbound.linkedPoiseScale);
    expect(body.damageTakenScale).toBeCloseTo(TUNING.enemies.linkbound.linkedDamageScale);
    expect(w.ai.links.all.length).toBe(1);
    expect(w.ai.links.linksOf(body)).toEqual([link]);
    expect(w.seen['link:created']?.length).toBe(1);
    // creating the same link twice returns the first
    expect(w.ai.links.create(weaver, body)).toBe(link);

    const echo0 = w.player.echo;
    w.ai.links.sever(link, w.player.actor);
    expect(link.alive).toBe(false);
    expect(body.linked).toBe(false);
    expect(body.poiseTakenScale).toBe(1);
    expect(body.damageTakenScale).toBe(1);
    expect(body.staggered).toBe(true);
    expect(body.staggeredUntil - w.time.now).toBeCloseTo(1.5, 1);
    expect(w.ai.links.all.length).toBe(0);
    expect(w.seen['link:severed']?.[0]?.by).toBe(w.player.actor);
    // Selene's sever rule pays Echo
    expect(w.player.echo - echo0).toBe(TUNING.kits.selene.echo.sever);
    // severing twice is harmless
    expect(() => w.ai.links.sever(link, null)).not.toThrow();
    expect(w.seen['link:severed']?.length).toBe(1);
  });

  it('a link feeds the elite: phase A regenerates, cutting it isolates', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, 25);
    const elite = w.ai.spawnEnemy('elite', { pos: { x: 0, y: 0, z: -10 }, dormant: true });
    const feeder = w.ai.spawnEnemy('linkbound', { pos: { x: 8, y: 0, z: -14 }, dormant: true });
    const ctl = w.ai.elite(elite)!;
    expect(ctl).not.toBeNull();
    w.run(0.1);
    expect(ctl.phase).toBe('B');
    const link = w.ai.links.create(feeder, elite);
    w.run(0.1);
    expect(ctl.phase).toBe('A');
    expect(elite.regen).toBe(TUNING.enemies.elite.regen);
    elite.hp = 500;
    w.run(2);
    expect(elite.hp).toBeGreaterThan(540);
    w.ai.links.sever(link, null);
    w.run(0.1);
    expect(ctl.phase).toBe('B');
    expect(elite.regen).toBeLessThan(TUNING.enemies.elite.regen);
    // Thermal Fracture: no regeneration at all, 35 % of max health gone, core open
    elite.hp = elite.maxHp;
    ctl.fracture(w.player.actor);
    expect(ctl.fractured).toBe(true);
    expect(elite.hp).toBeCloseTo(elite.maxHp * 0.65, 0);
    w.run(1);
    expect(elite.regen).toBe(0);
    expect(elite.weakPoints.find((p) => p.id === 'core')?.exposed).toBe(true);
    expect(ctl.requestResonanceWindow()).toBe(false);
  });

  it('links die with their source, their target and their anchor', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 25);
    const weaver = w.ai.spawnEnemy('weaver', { pos: { x: 0, y: 0, z: -20 }, dormant: true });
    const a = w.ai.spawnEnemy('linkbound', { pos: { x: 4, y: 0, z: -14 }, dormant: true });
    const b = w.ai.spawnEnemy('linkbound', { pos: { x: -4, y: 0, z: -14 }, dormant: true });
    const c = w.ai.spawnEnemy('linkbound', { pos: { x: 0, y: 0, z: -12 }, dormant: true });
    const anchor = w.ai.devices.weaverAnchor({ id: 'anchor', pos: { x: 6, y: 0, z: -22 } });
    w.ai.links.create(weaver, a);
    w.ai.links.create(weaver, b, { anchor: anchor.actor });
    w.ai.links.create(weaver, c, { anchor: anchor.actor });
    expect(w.ai.links.all.length).toBe(3);
    // target dies
    w.actors.kill(a, null);
    expect(w.ai.links.all.length).toBe(2);
    // the anchor is destroyed: both of its links go, the bodies are freed
    w.actors.kill(anchor.actor, w.player.actor);
    expect(w.ai.links.all.length).toBe(0);
    expect(b.linked).toBe(false);
    expect(c.linked).toBe(false);
    expect(anchor.disabled).toBe(true);
    expect(w.seen['device:disabled']?.[0]?.id).toBe('anchor');
    // source dies
    const l = w.ai.links.create(weaver, b);
    expect(l.alive).toBe(true);
    w.actors.kill(weaver, null);
    expect(l.alive).toBe(false);
    expect(b.linked).toBe(false);
    // a link to something dead is a dead handle, not an exception
    expect(w.ai.links.create(weaver, b).alive).toBe(false);
  });

  it('hitTest finds a link by its line, and severAllFrom frees every body', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, 25);
    const weaver = w.ai.spawnEnemy('weaver', { pos: { x: -10, y: 0, z: 0 }, dormant: true });
    const body = w.ai.spawnEnemy('linkbound', { pos: { x: 10, y: 0, z: 0 }, dormant: true });
    const other = w.ai.spawnEnemy('linkbound', { pos: { x: -10, y: 0, z: 12 }, dormant: true });
    const link = w.ai.links.create(weaver, body);
    w.ai.links.create(weaver, other);
    w.run(0.05);
    const mid = link.midpoint(w.player.actor.pos.clone());
    expect(Math.abs(mid.x)).toBeLessThan(1);
    // a shot crossing the line
    expect(w.ai.links.hitTest({ x: 0, y: mid.y, z: -5 }, { x: 0, y: mid.y, z: 5 }, 0.3)).toBe(link);
    // a shot passing well above it
    expect(w.ai.links.hitTest({ x: 0, y: mid.y + 3, z: -5 }, { x: 0, y: mid.y + 3, z: 5 }, 0.3)).toBeNull();
    // a shot that stops short of it
    expect(w.ai.links.hitTest({ x: 0, y: mid.y, z: -5 }, { x: 0, y: mid.y, z: -1 }, 0.3)).toBeNull();
    w.ai.links.severAllFrom(weaver, null);
    expect(w.ai.links.all.length).toBe(0);
    expect(body.linked || other.linked).toBe(false);
  });

  it('cadence clock: one shared period, phase and time-to-beat agree', () => {
    const w = makeAiWorld();
    const c = w.ai.links.cadence;
    expect(c.period).toBeGreaterThan(0.5);
    w.run(c.period * 2.25);
    expect(c.phase()).toBeCloseTo(0.25, 1);
    expect(c.timeToBeat()).toBeCloseTo(c.period * 0.75, 1);
    w.run(c.timeToBeat() + 1 / 120);
    expect(c.phase()).toBeLessThan(0.05);
  });

  it('linked bodies begin their attacks on the same beat; freed bodies do not', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 0, 0);
    const weaver = w.ai.spawnEnemy('weaver', { pos: { x: 0, y: 0, z: -24 }, dormant: true });
    const enc = w.ai.createEncounter({ id: 'trio', maxActive: 6, meleeSlots: 3, waves: [] });
    enc.start();
    const bodies = [-1, 0, 1].map((i) => w.ai.spawnEnemy('linkbound', { pos: { x: i * 2.2, y: 0, z: -3.2 }, yaw: Math.PI }));
    for (const b of bodies) {
      enc.adopt(b);
      w.ai.links.create(weaver, b);
    }
    // record the sim time each body's telegraph starts
    const starts: number[][] = [[], [], []];
    const last = [false, false, false];
    for (let i = 0; i < 60 * 12; i++) {
      w.run(1 / 60);
      bodies.forEach((b, k) => {
        const brain = b.controller as unknown as { teleLeft: number };
        const on = brain.teleLeft > 0;
        if (on && !last[k]) starts[k]!.push(w.time.now);
        last[k] = on;
      });
    }
    expect(starts[0]!.length).toBeGreaterThan(1);
    const period = w.ai.links.cadence.period;
    for (const list of starts) {
      for (const t of list) {
        // every linked wind-up begins on a beat of the shared clock
        const off = t % period;
        expect(Math.min(off, period - off)).toBeLessThan(0.04);
      }
    }
    // at least one beat on which all three began together
    const together = starts[0]!.filter((t) => starts[1]!.some((u) => Math.abs(u - t) < 0.02) && starts[2]!.some((u) => Math.abs(u - t) < 0.02));
    expect(together.length).toBeGreaterThan(0);
    expect(hero.alive).toBe(true);
  });

  it('a Weaver links by itself, re-links six seconds after a cut, and falters when all are cut', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, 26);
    const weaver = w.ai.spawnEnemy('weaver', { pos: { x: 0, y: 0, z: -6 } });
    const bodies = [-1, 1].map((i) => w.ai.spawnEnemy('linkbound', { pos: { x: i * 3, y: 0, z: -2 }, dormant: true }));
    w.run(5);
    expect(w.ai.links.all.length).toBe(2);
    expect(bodies.every((b) => b.linked)).toBe(true);
    w.ai.links.severAllFrom(weaver, null);
    expect(weaver.staggered).toBe(true);
    expect(weaver.weakPoints.find((p) => p.id === 'core')?.exposed).toBe(true);
    w.run(4.5);
    expect(w.ai.links.all.length).toBe(0); // not yet: six seconds
    w.run(5);
    expect(w.ai.links.all.length).toBeGreaterThan(0);
  });
});
