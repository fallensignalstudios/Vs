import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, HitInfo } from '@/core/api';
import { buildZ08 } from '@/world/physics/fixtures';
import { makeAiWorld, type AiTestWorld } from './testkit';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
let allowWarnings = false;
afterEach(() => {
  // no brain may throw (the manager reports a throwing controller with a warning) and nothing may warn at all —
  // except in the test that feeds the API nonsense on purpose, where a warning (never a throw) is the contract
  const lines = warn.mock.calls.map((c: unknown[]) => String(c[0]));
  warn.mockRestore();
  if (allowWarnings) expect(lines.some((l: string) => /threw/.test(l))).toBe(false);
  else expect(lines).toEqual([]);
  allowWarnings = false;
});

function finite(w: AiTestWorld): boolean {
  return w.actors.all.every((a) => Number.isFinite(a.pos.x + a.pos.y + a.pos.z + a.yaw + a.hp));
}

function hitsOn(w: AiTestWorld, target: Actor): HitInfo[] {
  return (w.seen['actor:hit'] ?? []).filter((e) => e.target === target && !e.result.immune).map((e) => e.hit);
}

describe('brains', () => {
  it('secDrone: telegraphs, fires three bolts, opens its vent; bolts are stopped by cover', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 0, 10);
    w.actors.setHostile('player', 'reformation', true);
    const drone = w.ai.spawnEnemy('secDrone', { pos: { x: 0, y: 0, z: -10 } });
    let ventOpened = false;
    for (let i = 0; i < 60 * 12; i++) {
      w.run(1 / 60);
      if (drone.weakPoints[0]!.exposed) ventOpened = true;
    }
    expect(w.ai.stats.volleys).toBeGreaterThanOrEqual(2);
    expect(w.ai.stats.boltsFired).toBe(w.ai.stats.volleys * 3);
    expect(w.ai.stats.minTelegraph).toBeGreaterThanOrEqual(0.45);
    expect(ventOpened).toBe(true);
    const bolts = hitsOn(w, hero).filter((h) => h.kind === 'ranged');
    expect(bolts.length).toBeGreaterThan(2);
    expect(bolts[0]!.attacker).toBe(drone);
    // put high cover between them: no further hits arrive
    w.physics.addCollider({ shape: { kind: 'box', hx: 3, hy: 2, hz: 0.5 }, x: 0, y: 2, z: 8, cover: 'high' });
    w.run(1.5);
    const before = hitsOn(w, hero).length;
    w.run(10);
    expect(hitsOn(w, hero).length).toBe(before);
    expect(finite(w)).toBe(true);
  });

  it('enforcers: hold a wall with overlapping shields, bash and shoot, stay on the floor', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('selene', 0, 12);
    w.actors.setHostile('player', 'dominion', true);
    const line = [-1.5, 0, 1.5].map((x) => w.ai.spawnEnemy('enforcer', { pos: { x: x * 1.6, y: 0, z: -8 }, yaw: Math.PI }));
    let widest = 0;
    let guarded = 0;
    for (let i = 0; i < 60 * 25; i++) {
      w.run(1 / 60);
      for (const e of line) {
        widest = Math.max(widest, e.guardArc);
        if (e.guarding) guarded++;
      }
    }
    expect(widest).toBeGreaterThan(3.4); // 200° while shoulder to shoulder
    expect(guarded).toBeGreaterThan(60 * 25);
    expect(w.ai.stats.meleeAttacks + w.ai.stats.boltsFired).toBeGreaterThan(1);
    expect(hitsOn(w, hero).length).toBeGreaterThan(0);
    expect(w.ai.stats.minTelegraph).toBeGreaterThanOrEqual(0.45);
    for (const e of line) expect(w.physics.canStand(e.pos.x, e.pos.y, e.pos.z, 0.3)).toBe(true);
    // the wall has closed on its target and kept its shape
    expect(line.every((e) => e.distanceTo(hero) < 8)).toBe(true);
    expect(finite(w)).toBe(true);
  });

  it('enforcer front: holds its posts against drones (≤ 1 peeling), advances as a wall once the player is a target', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('selene', 0, 24);
    hero.targetable = false; // unseen: the front only has the drones to deal with
    w.actors.setHostile('player', 'dominion', true);
    const posts = [-4.5, -1.5, 1.5, 4.5].map((x) => ({ x, y: 0, z: -6 }));
    const line = posts.map((p) => w.ai.spawnEnemy('enforcer', { pos: p, post: p, yaw: Math.PI, front: { leash: 9 } }));
    for (const x of [-5, 5]) w.ai.spawnEnemy('contamDrone', { pos: { x, y: 1.8, z: 3 }, yaw: 0 });
    let maxOff = 0;
    let maxOut = 0;
    let overlapped = 0;
    const steps = 60 * 30;
    for (let i = 0; i < steps; i++) {
      w.run(1 / 60);
      if (i < 60 * 2) continue;
      let out = 0;
      line.forEach((e, k) => {
        if (!e.alive) return;
        const p = posts[k]!;
        const off = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
        maxOff = Math.max(maxOff, off);
        if (off > 2) out++;
        if (e.guardArc > 3.4) overlapped++;
      });
      maxOut = Math.max(maxOut, out);
    }
    expect(maxOut).toBeLessThanOrEqual(1); // at most one member out of the line at any moment
    expect(maxOff).toBeLessThan(6.5); // a peel is a short step out, never a chase
    expect(overlapped).toBeGreaterThan(steps); // the shields stay overlapped most of the time
    expect(w.ai.stats.boltsFired).toBeGreaterThan(0); // the drones and the sidearms trade fire
    // noticed: the wall advances on her as one, up to its leash
    hero.targetable = true;
    w.run(14);
    const alive = line.filter((e) => e.alive);
    const adv = alive.map((e) => e.pos.z - -6);
    expect(Math.min(...adv)).toBeGreaterThan(5);
    expect(Math.max(...adv)).toBeLessThan(9 + 1.5);
    expect(Math.max(...adv) - Math.min(...adv)).toBeLessThan(3); // kept its shape
    expect(finite(w)).toBe(true);
  });

  it('announces every attack as ai:telegraph (kind, target, lead time, landing point); captions name no role', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 20, 0);
    w.actors.setHostile('player', 'reformation', true);
    const drone = w.ai.spawnEnemy('secDrone', { pos: { x: 20, y: 0, z: -12 } });
    const wr = w.ai.spawnEnemy('wallrunner', { pos: { x: 14, y: 0, z: 6 } });
    w.run(25);
    const tele = w.seen['ai:telegraph'] ?? [];
    const of = (a: unknown, kind: string): typeof tele => tele.filter((e) => e.actor === a && e.kind === kind);
    expect(of(drone, 'lane').length).toBeGreaterThanOrEqual(2);
    expect(of(drone, 'laneLock').length).toBeGreaterThanOrEqual(2);
    const lane = of(drone, 'lane')[0]!;
    expect(lane.target).toBe(hero);
    expect(lane.seconds).toBeGreaterThanOrEqual(0.45);
    expect(of(drone, 'laneLock')[0]!.seconds).toBe(0);
    const pounce = of(wr, 'pounce');
    expect(pounce.length).toBe(w.ai.stats.pounces);
    expect(pounce[0]!.target).toBe(hero);
    expect(Math.hypot(pounce[0]!.pos!.x - hero.pos.x, pounce[0]!.pos!.z - hero.pos.z)).toBeLessThan(4);
    // every telegraph the AI counted was announced
    expect(tele.filter((e) => e.kind !== 'laneLock').length).toBeGreaterThanOrEqual(w.ai.stats.volleys + w.ai.stats.pounces);
    // on-screen text never names an enemy's role (STORY rule)
    for (const c of w.seen['caption'] ?? []) expect(c.text).not.toMatch(/weaver|linkbound|wall-?runner|elite|enforcer/i);
  });

  it('wallrunner: perches, announces, pounces, lies open on the ground, returns to a wall', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 20, 0);
    const wr = w.ai.spawnEnemy('wallrunner', { pos: { x: 14, y: 0, z: 6 } });
    let perched = 0;
    let open = 0;
    for (let i = 0; i < 60 * 30; i++) {
      w.run(1 / 60);
      if (wr.flying) perched++;
      if (wr.weakPoints[0]!.exposed) open++;
    }
    expect(perched).toBeGreaterThan(60);
    expect(w.ai.stats.pounces).toBeGreaterThanOrEqual(2);
    expect(open).toBeGreaterThan(60);
    expect(w.seen['caption']?.some((c) => c.kind === 'breach')).toBe(true);
    expect(hitsOn(w, hero).some((h) => h.tag === 'pounce')).toBe(true);
    expect(w.ai.stats.minTelegraph).toBeGreaterThanOrEqual(0.45);
    expect(finite(w)).toBe(true);
    // arrested on the wall: it comes down and can be hit on the floor
    for (let i = 0; i < 60 * 20 && !wr.flying; i++) w.run(1 / 60);
    expect(wr.flying).toBe(true);
    w.actors.freeze(wr, 3);
    w.run(0.1);
    expect(wr.flying).toBe(false);
    expect(wr.pos.y).toBeLessThan(0.2);
    expect(wr.weakPoints[0]!.exposed).toBe(true);
  });

  it('elite on the Z08 floor: phase A pressure, phase B joint exposure, never in a survivor recess', () => {
    const w = makeAiWorld();
    const fx = buildZ08(w.physics);
    w.physics.nav.rebuild();
    const hero = w.hero('selene', fx.marks.staging.x, fx.marks.staging.z);
    // survivor recesses W / E (plan x 3..15 / 62..69, n 35..45 → world z = −n)
    const noGo = [{ minX: 3, maxX: 15, minZ: -45, maxZ: -35 }, { minX: 62, maxX: 69, minZ: -45, maxZ: -35 }];
    const elite = w.ai.spawnEnemy('elite', { pos: fx.marks.courtMid, noGo });
    const feeder = w.ai.spawnEnemy('linkbound', { pos: fx.marks.northOfCourt, dormant: true });
    const link = w.ai.links.create(feeder, elite);
    const ctl = w.ai.elite(elite)!;
    let exposures = 0;
    ctl.onJointExposed = () => exposures++;
    let maxThreat = 0;
    let inRecess = false;
    const watch = (seconds: number): void => {
      for (let i = 0; i < 60 * seconds; i++) {
        w.run(1 / 60);
        maxThreat = Math.max(maxThreat, w.player.threat);
        for (const r of noGo) if (elite.pos.x > r.minX && elite.pos.x < r.maxX && elite.pos.z > r.minZ && elite.pos.z < r.maxZ) inRecess = true;
      }
    };
    watch(40);
    expect(ctl.phase).toBe('A');
    expect(w.ai.stats.pressurePulses).toBeGreaterThan(0);
    expect(maxThreat).toBeGreaterThan(0.1);
    expect(exposures).toBe(0); // the joint never opens while a link feeds it
    expect(w.seen['caption']?.some((c) => c.kind === 'pressure')).toBe(true);

    w.ai.links.sever(link, hero);
    watch(2);
    expect(ctl.phase).toBe('B');
    // pressure is relieved once the link is gone
    watch(4);
    expect(w.player.threat).toBe(0);
    watch(50);
    expect(exposures).toBeGreaterThan(0);
    expect(w.ai.stats.jointExposures).toBe(exposures);

    // the Resonance hooks
    expect(ctl.requestResonanceWindow(6)).toBe(true);
    for (let i = 0; i < 60 * 15 && !ctl.jointExposed; i++) w.run(1 / 60);
    expect(ctl.jointExposed).toBe(true);
    expect(elite.weakPoints.find((p) => p.id === 'joint')?.exposed).toBe(true);
    ctl.arrest(3);
    const hp = elite.hp;
    ctl.fracture(hero);
    expect(elite.hp).toBeLessThan(hp);
    expect(ctl.jointExposed).toBe(false);
    expect(elite.staggered).toBe(true);
    watch(12);
    expect(inRecess).toBe(false);
    expect(w.ai.stats.minTelegraph).toBeGreaterThanOrEqual(0.45);
    expect(finite(w)).toBe(true);
    expect(w.physics.canStand(elite.pos.x, elite.pos.y, elite.pos.z, 0.4)).toBe(true);
  });

  it('ceasefire stops every attack; dormant enemies wait for alert()', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 0, 4);
    w.actors.setHostile('player', 'reformation', true);
    w.ai.spawnEnemy('linkbound', { pos: { x: 0, y: 0, z: -2 } });
    w.ai.spawnEnemy('secDrone', { pos: { x: 6, y: 0, z: -8 } });
    const sleeper = w.ai.spawnEnemy('contamDrone', { pos: { x: -8, y: 0, z: -8 }, dormant: true, tags: ['z03Alert'] });
    w.ai.setCeasefire(true);
    expect(w.ai.ceasefire).toBe(true);
    w.run(10);
    expect(hitsOn(w, hero).length).toBe(0);
    expect(w.ai.stats.telegraphs).toBe(0);
    w.ai.setCeasefire(false);
    w.run(8);
    expect(hitsOn(w, hero).length).toBeGreaterThan(0);
    const volleys = w.ai.stats.volleys;
    expect((sleeper.controller as unknown as { dormant: boolean }).dormant).toBe(true);
    w.ai.alert('z03Alert');
    expect((sleeper.controller as unknown as { dormant: boolean }).dormant).toBe(false);
    w.run(8);
    expect(w.ai.stats.volleys).toBeGreaterThan(volleys);
    expect(w.ai.intensity).toBe(0); // no encounter is running
  });

  it('companions: follow, fight at support level, go down instead of dying, leave the last kill', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 0, 0);
    const selene = w.ai.spawnCompanion('selene', { pos: { x: 2, y: 0, z: 2 }, mode: 'follow' });
    const lyessa = w.ai.spawnCompanion('lyessa', { pos: { x: -2, y: 0, z: 2 }, mode: 'follow' });
    const tharne = w.ai.spawnNpc('tharne', { pos: { x: 0, y: 0, z: 6 }, pose: 'kneel' });
    expect(selene.actor.team).toBe('player');
    expect(tharne.actor.protectedNpc).toBe(true);
    expect(tharne.actor.fixed).toBe(true);
    // follow: the player moves 15 m, the companions come along
    w.player.teleport({ x: 0, y: 0, z: -15 });
    w.run(8);
    expect(selene.actor.distanceTo(hero)).toBeLessThan(6);
    expect(lyessa.actor.distanceTo(hero)).toBeLessThan(6);
    expect(selene.arrived).toBe(true);
    // ordered somewhere: arrival is reported
    selene.moveTo({ x: 10, y: 0, z: -10 }, { run: true, yaw: 0 });
    expect(selene.arrived).toBe(false);
    w.run(6);
    expect(selene.arrived).toBe(true);
    expect(selene.actor.distanceTo({ x: 10, y: 0, z: -10 })).toBeLessThan(1);

    // combat: one enemy in an encounter — they hurt it, they do not finish it
    const enc = w.ai.createEncounter({ id: 'last', maxActive: 2, waves: [{ spawns: [{ role: 'linkbound', at: { x: 4, y: 0, z: -22 }, opts: { dormant: true } }] }] });
    enc.start();
    const foe = enc.alive[0]!;
    selene.mode = 'combat';
    lyessa.mode = 'combat';
    w.run(40);
    expect(foe.alive).toBe(true);
    expect(foe.hp).toBeLessThan(foe.maxHp);
    expect(foe.hp).toBeLessThanOrEqual(foe.maxHp * 0.4 + 12);

    // downed, not dead
    w.actors.applyHit(lyessa.actor, { attacker: foe, damage: 9999, poise: 0, kind: 'melee', dir: { x: 0, y: 0, z: 1 }, point: lyessa.actor.pos.clone() });
    w.run(0.1);
    expect(lyessa.actor.alive).toBe(true);
    expect(lyessa.downed).toBe(true);
    expect(lyessa.disrupted).toBe(true);
    expect(lyessa.actor.targetable).toBe(false);
    w.run(4.2);
    expect(lyessa.downed).toBe(false);
    expect(lyessa.actor.hp).toBeGreaterThan(lyessa.actor.maxHp * 0.4);
    expect(lyessa.actor.targetable).toBe(true);

    // signature assists
    selene.assist(foe, 'frostArrest');
    expect(selene.assisting).toBe(true);
    w.run(0.6);
    expect(foe.frozen).toBe(true);
    expect(selene.assisting).toBe(false);
    const hp = foe.hp;
    lyessa.assist(foe, 'rifleShot');
    w.run(1);
    expect(foe.hp).toBeLessThan(hp);
    selene.remove();
    expect(w.ai.companions.length).toBe(2);
    expect(finite(w)).toBe(true);
  });

  it('companion face(): reports its facing; turns the body; looks at eye height, or keeps the gaze', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('selene', 0, 0);
    const c = w.ai.spawnCompanion('lyessa', { pos: { x: 4, y: 0, z: 0 }, mode: 'scripted' });
    const looks: Array<{ x: number; y: number; z: number } | null> = [];
    const v = c.actor.visual!;
    const orig = v.lookAt.bind(v);
    v.lookAt = (p) => {
      looks.push(p ? { x: p.x, y: p.y, z: p.z } : null);
      orig(p);
    };
    expect(c.facing).toBeNull();
    // a floor position (a marker, the lead's feet): the body turns to it, the eyes meet a standing head
    c.face(hero.pos);
    expect(c.facing).toEqual({ x: hero.pos.x, y: hero.pos.y, z: hero.pos.z });
    expect(looks.at(-1)!.y).toBeCloseTo(hero.pos.y + c.actor.height * 0.93, 3);
    w.run(1.5);
    expect(Math.abs(Math.atan2(-(hero.pos.x - c.actor.pos.x), -(hero.pos.z - c.actor.pos.z)) - c.actor.yaw) % (2 * Math.PI)).toBeLessThan(0.15);
    // a raised point is looked at as given
    c.face({ x: 0, y: 1.3, z: -3 });
    expect(looks.at(-1)).toEqual({ x: 0, y: 1.3, z: -3 });
    // turn only: the gaze another system set is kept
    const n = looks.length;
    c.face({ x: 9, y: 0, z: 9 }, { gaze: false });
    expect(looks.length).toBe(n);
    expect(c.facing).toEqual({ x: 9, y: 0, z: 9 });
    // turn one way, look at a given point
    c.face({ x: -9, y: 0, z: 0 }, { gaze: { x: 1, y: 1.6, z: 1 } });
    expect(looks.at(-1)).toEqual({ x: 1, y: 1.6, z: 1 });
    c.face(null);
    expect(c.facing).toBeNull();
    expect(looks.at(-1)).toBeNull();
  });

  it('companion orders: hold, teleport, suppress, cinderStrike, bad input', () => {
    allowWarnings = true;
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, 0);
    const tarrik = w.ai.spawnCompanion('tarrik', { pos: { x: 3, y: 0, z: 0 }, mode: 'scripted' });
    const lyessa = w.ai.spawnCompanion('lyessa', { pos: { x: -3, y: 0, z: 0 }, mode: 'follow' });
    const foe = w.ai.spawnEnemy('linkbound', { pos: { x: 0, y: 0, z: -14 }, dormant: true, hpScale: 4 });
    // hold: walks to the post and stays although the protagonist leaves
    lyessa.holdAt({ x: -8, y: 0, z: -4 }, Math.PI);
    expect(lyessa.mode).toBe('hold');
    w.run(5);
    expect(lyessa.arrived).toBe(true);
    expect(lyessa.actor.distanceTo({ x: -8, y: 0, z: -4 })).toBeLessThan(0.8);
    w.player.teleport({ x: 15, y: 0, z: 15 });
    w.run(3);
    expect(lyessa.actor.distanceTo({ x: -8, y: 0, z: -4 })).toBeLessThan(0.8);
    // suppress: six rounds, pressure only
    const hp0 = foe.hp;
    lyessa.assist(foe, 'suppress');
    w.run(3.2);
    expect(hp0 - foe.hp).toBeGreaterThan(0);
    expect(hp0 - foe.hp).toBeLessThanOrEqual(24);
    expect(lyessa.assisting).toBe(false);
    // cinderStrike: closes the distance, then one heavy blow
    const hp1 = foe.hp;
    tarrik.assist(foe, 'cinderStrike');
    w.run(5);
    expect(hp1 - foe.hp).toBeGreaterThanOrEqual(45);
    expect(tarrik.actor.distanceTo(foe)).toBeLessThan(4.5);
    expect(tarrik.assisting).toBe(false);
    // teleport and nonsense
    tarrik.teleport({ x: 10, y: 0, z: 10 }, 1);
    expect(tarrik.actor.pos.x).toBeCloseTo(10, 3);
    expect(tarrik.actor.yaw).toBe(1);
    expect(() => {
      tarrik.moveTo({ x: NaN, y: 0, z: 0 });
      tarrik.assist(foe, 'nonsense' as never);
      tarrik.mode = 'dance' as never;
      tarrik.focus(null);
      tarrik.face(null);
      tarrik.follow(null);
      tarrik.play('definitelyNotAnAction');
      tarrik.stopAction();
      w.ai.spawnEnemy('nope' as never, { pos: { x: NaN, y: 0, z: 0 } });
      w.ai.alert('nobody');
      w.run(1);
      w.ai.clear();
      w.ai.clear();
    }).not.toThrow();
    expect(w.ai.companions.length).toBe(0);
  });
});
