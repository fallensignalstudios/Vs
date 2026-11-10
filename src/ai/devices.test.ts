import { describe, expect, it } from 'vitest';
import { makeAiWorld } from './testkit';

describe('devices', () => {
  it('relay network: one receiver down interrupts for six seconds, both down takes it down', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, 25);
    const a = w.ai.devices.relayReceiver({ id: 'rxA', pos: { x: -8, y: 0, z: -10 }, network: 'z04' });
    const b = w.ai.devices.relayReceiver({ id: 'rxB', pos: { x: 8, y: 0, z: -10 }, network: 'z04' });
    const drone = w.ai.spawnEnemy('contamDrone', { pos: { x: 0, y: 0, z: -14 }, network: 'z04' });
    const net = w.ai.devices.network('z04');
    expect(net.receivers.length).toBe(2);
    expect(net.down).toBe(false);
    expect(w.ai.devices.byId('rxA')).toBe(a);
    expect(a.actor.tags.has('device')).toBe(true);
    w.run(0.5);

    // destroyed through the damage path
    w.actors.kill(a.actor, w.player.actor);
    expect(a.disabled).toBe(true);
    expect(net.down).toBe(false);
    expect(net.interruptedUntil - w.time.now).toBeCloseTo(6, 1);
    expect(w.seen['device:disabled']?.[0]).toMatchObject({ id: 'rxA', kind: 'relayReceiver', by: w.player.actor });
    const volleysBefore = w.ai.stats.volleys;
    w.run(5.5);
    // stunned drift: nothing fired while interrupted
    expect(w.ai.stats.volleys).toBe(volleysBefore);
    w.run(8);
    expect(w.time.now).toBeGreaterThan(net.interruptedUntil);
    expect(w.ai.stats.volleys).toBeGreaterThan(volleysBefore);

    // the close-interaction route on the other one
    b.disable(w.player.actor);
    expect(b.disabled).toBe(true);
    expect(b.actor.alive).toBe(true);
    expect(b.actor.targetable).toBe(false);
    expect(net.down).toBe(true);
    expect(w.seen['device:disabled']?.length).toBe(2);
    // disabling twice emits nothing new
    b.disable(null);
    expect(w.seen['device:disabled']?.length).toBe(2);
    // network down: the drone gives up by itself within ~10 s
    expect(drone.alive).toBe(true);
    w.run(10.5);
    expect(drone.alive).toBe(false);
  });

  it('command emitter: synchronised volleys, 8 s desync on stagger, individual timing once destroyed', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 14);
    const d1 = w.ai.spawnEnemy('secDrone', { pos: { x: -6, y: 0, z: -12 } });
    const d2 = w.ai.spawnEnemy('secDrone', { pos: { x: 6, y: 0, z: -12 } });
    w.actors.setHostile('player', 'reformation', true);
    const em = w.ai.devices.commandEmitter({ id: 'emitter', pos: { x: 0, y: 0, z: -20 }, drones: [d1, d2] });
    const sync = w.ai.devices.syncOf(d1)!;
    expect(sync.synced).toBe(true);
    expect(w.ai.devices.syncOf(d2)!.emitter).toBe(em);

    const starts = (seconds: number): [number[], number[]] => {
      const out: [number[], number[]] = [[], []];
      const last = [false, false];
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        w.run(1 / 60);
        [d1, d2].forEach((d, k) => {
          const on = (d.controller as unknown as { teleLeft: number }).teleLeft > 0;
          if (on && !last[k]) out[k]!.push(w.time.now);
          last[k] = on;
        });
      }
      return out;
    };

    const [s1, s2] = starts(12);
    expect(s1.length).toBeGreaterThanOrEqual(2);
    expect(s1.length).toBe(s2.length);
    // same instant, every time
    s1.forEach((t, i) => expect(Math.abs(t - s2[i]!)).toBeLessThan(1e-6));
    expect(w.ai.stats.syncVolleys).toBeGreaterThanOrEqual(2);
    expect(w.ai.stats.minTelegraph).toBeGreaterThanOrEqual(0.45);

    // stagger the emitter: out of step for eight seconds
    w.actors.applyHit(em.actor, {
      attacker: w.player.actor, damage: 5, poise: 100, kind: 'melee', dir: { x: 0, y: 0, z: -1 }, point: em.actor.pos.clone(),
    });
    expect(em.actor.staggered).toBe(true);
    expect(sync.synced).toBe(false);
    const [u1, u2] = starts(7);
    expect(u1.length + u2.length).toBeGreaterThan(1);
    const same = u1.filter((t) => u2.some((u) => Math.abs(u - t) < 1e-6));
    expect(same.length).toBe(0);
    w.run(1.5);
    expect(sync.synced).toBe(true);

    // destroyed: permanently individual
    w.actors.kill(em.actor, w.player.actor);
    expect(sync.broken).toBe(true);
    expect(sync.synced).toBe(false);
    expect(w.seen['device:disabled']?.some((e) => e.id === 'emitter')).toBe(true);
    w.run(30);
    expect(sync.synced).toBe(false);
  });

  it('scan plane: detects the player inside the plane only with sight from the source', () => {
    const w = makeAiWorld();
    w.arena();
    // a 2.2 m high cover block between the source (north) and the corridor
    w.physics.addCollider({ shape: { kind: 'box', hx: 1.5, hy: 1.1, hz: 0.5 }, x: 0, y: 1.1, z: -4, cover: 'high' });
    const hero = w.hero('selene', 0, -2.4);
    let hits = 0;
    const plane = w.ai.devices.scanPlane({
      id: 'plane1', from: { x: -8, y: 0, z: -2.4 }, to: { x: 8, y: 0, z: -2.4 }, width: 6, height: 3, period: 4,
      source: { x: 0, y: 2.0, z: -12 }, onDetect: () => hits++,
    });
    // behind the block: the plane sweeps over the player twice, sight is blocked both times
    w.run(4);
    expect(plane.detections).toBe(0);
    // step out of cover into the plane's path
    w.player.teleport({ x: 4, y: 0, z: -2.4 });
    w.run(4);
    expect(plane.detections).toBeGreaterThanOrEqual(1);
    expect(hits).toBe(plane.detections);
    expect(w.seen['scan:detected']?.[0]?.source).toBe('plane1');
    expect(w.seen['caption']?.some((c) => c.kind === 'scan')).toBe(true);
    // outside the plane's width: never detected, cover or not
    const before = plane.detections;
    w.player.teleport({ x: 4, y: 0, z: 9 });
    w.run(4);
    expect(plane.detections).toBe(before);
    // switched off
    w.player.teleport({ x: 4, y: 0, z: -2.4 });
    plane.setActive(false);
    w.run(4);
    expect(plane.detections).toBe(before);
    // faster sweep = more passes
    plane.setActive(true);
    plane.setRate(3);
    w.run(8);
    expect(plane.detections).toBeGreaterThan(before + 1);
    plane.remove();
    expect(plane.active).toBe(false);
    expect(hero.alive).toBe(true);
  });

  it('scan head: sweeps, sees the player in the open, not behind cover', () => {
    const w = makeAiWorld();
    w.arena();
    w.physics.addCollider({ shape: { kind: 'box', hx: 1.5, hy: 1.5, hz: 0.5 }, x: 0, y: 1.5, z: -6, cover: 'high' });
    w.hero('selene', 0, -4.6);
    let seen = 0;
    const head = w.ai.devices.scanHead({ id: 'head', pos: { x: 0, y: 0, z: -14 }, yaw: Math.PI, arcDeg: 80, range: 20, period: 4, onDetect: () => seen++ });
    w.run(8);
    expect(seen).toBe(0);
    w.player.teleport({ x: 5, y: 0, z: -6 });
    w.run(8);
    expect(seen).toBeGreaterThan(0);
    const n = seen;
    head.disable(null);
    w.run(8);
    expect(seen).toBe(n);
  });

  it('frost anchor and clear() are inert and safe', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero();
    const f = w.ai.devices.frostAnchor({ id: 'frost', pos: { x: 3, y: 0, z: 3 } });
    expect(f.actor.targetable).toBe(false);
    f.disable(null);
    expect(f.disabled).toBe(false);
    expect(w.ai.devices.all.length).toBe(1);
    w.ai.clear();
    expect(w.ai.devices.all.length).toBe(0);
    expect(w.ai.devices.byId('frost')).toBeNull();
    expect(w.actors.byId(f.actor.id)).toBeNull();
  });
});
