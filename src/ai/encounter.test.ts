import { describe, expect, it } from 'vitest';
import type { Actor, Encounter, EncounterDef } from '@/core/api';
import { makeAiWorld } from './testkit';

function killOne(w: ReturnType<typeof makeAiWorld>, enc: Encounter): void {
  const a = enc.alive[0] as Actor;
  w.actors.kill(a, null);
}

describe('encounter director', () => {
  it('enforces the hard cap with queued spawn slots', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero();
    const enc = w.ai.createEncounter({
      id: 'cap', maxActive: 4,
      waves: [{ spawns: Array.from({ length: 6 }, (_, i) => ({ role: 'linkbound' as const, at: { x: -10 + i * 3, y: 0, z: -15 } })) }],
    });
    expect(enc.state).toBe('idle');
    enc.start();
    expect(enc.state).toBe('active');
    expect(enc.aliveCount).toBe(4);
    expect(enc.queued).toBe(2);
    expect(enc.spawned).toBe(4);
    expect(enc.total).toBe(6);
    killOne(w, enc);
    w.run(0.1);
    expect(enc.aliveCount).toBe(4);
    expect(enc.queued).toBe(1);
    expect(enc.killed).toBe(1);
    for (let i = 0; i < 12 && !enc.cleared; i++) {
      if (enc.aliveCount) killOne(w, enc);
      w.run(0.1);
      expect(enc.aliveCount).toBeLessThanOrEqual(4);
    }
    expect(enc.cleared).toBe(true);
    expect(enc.spawned).toBe(6);
    expect(enc.killed).toBe(6);
    expect(enc.peakActive).toBe(4);
    expect(w.seen['encounter:cleared']?.length).toBe(1);
  });

  it('E1: four drones, two more only after formationBroken AND alive <= 2, cap 4', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 20);
    let spawnedSecond: Actor[] = [];
    let telegraphed = 0;
    const def: EncounterDef = {
      id: 'E1', maxActive: 4,
      resolve: (m) => ({ x: Number(m.slice(1)) * 4 - 6, y: 0, z: -18 }),
      waves: [
        { spawns: ['l0', 'l1', 'l2', 'l3'].map((at) => ({ role: 'secDrone' as const, at })) },
        {
          when: (e) => e.flags.formationBroken === true && e.aliveCount <= 2,
          telegraph: 1.5,
          onTelegraph: () => telegraphed++,
          onSpawn: (actors) => (spawnedSecond = actors),
          spawns: [
            { role: 'secDrone', at: { x: 6, y: 0, z: -22 }, opts: { via: 'aperture', from: { x: 6, y: 4, z: -28 } } },
            { role: 'secDrone', at: { x: -6, y: 0, z: -22 }, opts: { via: 'aperture', from: { x: -6, y: 4, z: -28 } } },
          ],
        },
      ],
    };
    const enc = w.ai.createEncounter(def);
    enc.start();
    expect(w.actors.teamsHostile('player', 'reformation')).toBe(true);
    expect(enc.aliveCount).toBe(4);
    expect(enc.wave).toBe(0);
    w.run(1);
    killOne(w, enc);
    killOne(w, enc);
    w.run(1);
    // two alive, but the formation flag is not set: nothing arrives
    expect(enc.aliveCount).toBe(2);
    expect(enc.wave).toBe(0);
    enc.flags.formationBroken = true;
    w.run(0.5);
    // condition met: the aperture telegraph runs first
    expect(telegraphed).toBe(1);
    expect(enc.wave).toBe(0);
    expect(enc.aliveCount).toBe(2);
    w.run(1.2);
    expect(enc.wave).toBe(1);
    expect(enc.aliveCount).toBe(4);
    expect(spawnedSecond.length).toBe(2);
    expect(enc.spawned).toBe(6);
    expect(enc.total).toBe(6);
    expect(enc.peakActive).toBe(4);
    expect(w.seen['encounter:wave']?.map((e) => e.wave)).toEqual([0, 1]);
    while (enc.aliveCount) killOne(w, enc);
    w.run(0.1);
    expect(enc.cleared).toBe(true);
    expect(enc.killed).toBe(6);
    // hostility the encounter switched on is restored
    expect(w.actors.teamsHostile('player', 'reformation')).toBe(false);
  });

  it('E1 variant: flag set first, wave waits for alive <= 2', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 20);
    const enc = w.ai.createEncounter({
      id: 'E1b', maxActive: 4,
      waves: [
        { spawns: [0, 1, 2, 3].map((i) => ({ role: 'secDrone' as const, at: { x: i * 4 - 6, y: 0, z: -18 } })) },
        { when: (e) => e.flags.formationBroken === true && e.aliveCount <= 2, spawns: [{ role: 'secDrone', at: { x: 0, y: 0, z: -22 } }, { role: 'secDrone', at: { x: 3, y: 0, z: -22 } }] },
      ],
    });
    enc.start();
    enc.flags.formationBroken = true;
    w.run(0.5);
    expect(enc.wave).toBe(0);
    killOne(w, enc);
    w.run(0.2);
    expect(enc.wave).toBe(0);
    killOne(w, enc);
    w.run(0.2);
    expect(enc.wave).toBe(1);
    expect(enc.aliveCount).toBe(4);
  });

  it('E3: second breach only when rescueOpen AND initial alive <= 3; peak 6, 7 committed', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 22);
    const enc = w.ai.createEncounter({
      id: 'E3', maxActive: 6, meleeSlots: 2,
      waves: [
        {
          spawns: [
            { role: 'linkbound', at: { x: -4, y: 0, z: -10 } }, { role: 'linkbound', at: { x: 0, y: 0, z: -12 } },
            { role: 'linkbound', at: { x: 4, y: 0, z: -10 } }, { role: 'wallrunner', at: { x: 8, y: 0, z: -14 } },
          ],
        },
        {
          when: (e) => e.flags.rescueOpen === true && e.aliveCount <= 3,
          spawns: [
            { role: 'linkbound', at: { x: -8, y: 0, z: -20 }, opts: { via: 'breach' } },
            { role: 'linkbound', at: { x: -5, y: 0, z: -22 }, opts: { via: 'breach' } },
            { role: 'weaver', at: { x: -7, y: 0, z: -25 }, opts: { via: 'breach' } },
          ],
        },
      ],
    });
    enc.start();
    expect(enc.aliveCount).toBe(4);
    expect(enc.total).toBe(7);
    enc.flags.rescueOpen = true;
    w.run(0.5);
    expect(enc.wave).toBe(0); // four initial enemies still alive
    killOne(w, enc);
    w.run(0.2);
    expect(enc.wave).toBe(1);
    expect(enc.aliveCount).toBe(6);
    expect(enc.spawned).toBe(7);
    w.run(3);
    expect(enc.peakActive).toBe(6);
    expect(enc.aliveCount).toBeLessThanOrEqual(6);
    enc.forceClear();
    expect(enc.cleared).toBe(true);
    expect(enc.aliveCount).toBe(0);
    expect(enc.killed).toBe(7);
  });

  it('accounts melee slots: 2, then 3 once linkLearned, reclaimed from the dead', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 25);
    const enc = w.ai.createEncounter({
      id: 'slots', maxActive: 6,
      waves: [{ spawns: [0, 1, 2, 3].map((i) => ({ role: 'linkbound' as const, at: { x: i * 3 - 5, y: 0, z: -20 }, opts: { dormant: true } })) }],
    });
    enc.start();
    const [a, b, c, d] = enc.alive as Actor[];
    expect(enc.meleeSlots).toBe(2);
    expect(enc.acquireMeleeSlot(a!)).toBe(true);
    expect(enc.acquireMeleeSlot(a!)).toBe(true); // idempotent
    expect(enc.acquireMeleeSlot(b!)).toBe(true);
    expect(enc.acquireMeleeSlot(c!)).toBe(false);
    expect(enc.meleeSlotsHeld).toBe(2);
    enc.flags.linkLearned = true;
    expect(enc.acquireMeleeSlot(c!)).toBe(true);
    expect(enc.acquireMeleeSlot(d!)).toBe(false);
    enc.releaseMeleeSlot(a!);
    expect(enc.acquireMeleeSlot(d!)).toBe(true);
    expect(enc.meleeSlotsHeld).toBe(3);
    w.actors.kill(b!, null);
    expect(enc.meleeSlotsHeld).toBe(2);
    expect(enc.acquireMeleeSlot(a!)).toBe(true);
  });

  it('never lets more bodies attack in melee than there are tokens', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 0, 0);
    const enc = w.ai.createEncounter({
      id: 'press', maxActive: 6,
      waves: [{ spawns: [0, 1, 2, 3, 4].map((i) => ({ role: 'linkbound' as const, at: { x: Math.cos(i * 1.2) * 6, y: 0, z: Math.sin(i * 1.2) * 6 } })) }],
    });
    enc.start();
    let worst = 0;
    for (let i = 0; i < 20 * 6; i++) {
      w.run(1 / 6);
      worst = Math.max(worst, enc.meleeSlotsHeld);
    }
    expect(worst).toBeLessThanOrEqual(2);
    expect(worst).toBeGreaterThan(0);
    expect(w.ai.stats.meleeAttacks).toBeGreaterThan(2);
    expect(hero.alive).toBe(true);
  });

  it('adopt, stop and unknown markers are safe', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero();
    const enc = w.ai.createEncounter({ id: 'adopt', maxActive: 3, waves: [] });
    enc.start();
    expect(enc.cleared).toBe(false);
    const stray = w.ai.spawnEnemy('linkbound', { pos: { x: 5, y: 0, z: 5 }, dormant: true });
    enc.adopt(stray);
    expect(enc.aliveCount).toBe(1);
    expect(w.ai.encounterOf(stray)).toBe(enc);
    w.actors.kill(stray, null);
    w.run(0.1);
    expect(enc.cleared).toBe(true);

    const bad = w.ai.createEncounter({ id: 'bad', maxActive: 2, waves: [{ spawns: [{ role: 'nope' as never, at: 'missing' }] }] });
    expect(() => bad.start()).not.toThrow();
    expect(bad.aliveCount).toBe(1);
    bad.stop();
    expect(bad.state).toBe('idle');
    expect(() => w.ai.clear()).not.toThrow();
    expect(w.ai.encounters.length).toBe(0);
  });
});
