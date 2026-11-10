import { describe, expect, it } from 'vitest';
import type { Actor, HitInfo } from '@/core/api';
import { spawnPickup } from './index';
import { TUNING } from './tuning';
import { FakeVisual, makeWorld, type TestWorld } from './testkit';

function start(who: 'tarrik' | 'selene' = 'tarrik'): TestWorld {
  const w = makeWorld();
  w.player.setProtagonist(who, { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
  w.step(1 / 60);
  return w;
}

/** a sturdy target in front of the player (yaw 0 faces −Z) that never staggers */
function target(w: TestWorld, z = -1.8, extra: Parameters<TestWorld['dummy']>[0] = {}): Actor {
  return w.dummy({ z, hp: 5000, poise: 0, ...extra });
}

/** watch hp drops on an actor */
function drops(w: TestWorld, a: Actor): number[] {
  const out: number[] = [];
  w.events.on('actor:hit', (e) => {
    if (e.target === a && e.result.applied > 0) out.push(Math.round(e.result.applied * 100) / 100);
  });
  return out;
}

function hitPlayer(w: TestWorld, from: Actor, extra: Partial<HitInfo> = {}) {
  const p = w.player.actor;
  const dx = p.pos.x - from.pos.x;
  const dz = p.pos.z - from.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  return w.actors.applyHit(p, {
    attacker: from, damage: 20, poise: 10, kind: 'melee', dir: { x: dx / l, y: 0, z: dz / l },
    point: { x: p.pos.x, y: 1.1, z: p.pos.z }, ...extra,
  });
}

describe('protagonists', () => {
  it('spawns each kit, keeps Echo and ammo per protagonist, survives a stub character factory', () => {
    const w = makeWorld();
    const seen: string[] = [];
    w.events.on('player:protagonist', (e) => seen.push(e.id));
    expect(w.player.actor.alive).toBe(false);
    expect(() => w.step(0.1)).not.toThrow();
    w.player.setProtagonist('tarrik', { pos: { x: 1, y: 0, z: 2 }, yaw: 0.5 });
    const t = w.player.actor;
    expect([t.team, t.maxHp, t.maxPoise, t.tags.has('persist'), t.alive]).toEqual(['player', 140, 60, true, true]);
    expect(t.height).toBeCloseTo(1.9, 6);
    expect(w.player.getHudState().meleeName).toBe('Velkorran');
    w.player.addEcho(40, 'script');
    w.player.setAmmo(3, 10);
    w.player.setProtagonist('selene', { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const s = w.player.actor;
    expect(s).not.toBe(t);
    expect([s.maxHp, s.maxPoise, w.player.echo]).toEqual([100, 35, 0]);
    expect(s.height).toBeCloseTo(1.68, 6);
    expect(w.actors.all).not.toContain(t);
    const hud = w.player.getHudState();
    expect([hud.protagonist, hud.rangedName, hud.ammo, hud.magSize, hud.abilities[1].id]).toEqual(['selene', 'Axiom', 8, 8, 'dispatch']);
    expect(w.player.getHudState()).toBe(hud);
    w.player.setProtagonist('tarrik', { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
    expect([w.player.echo, w.player.getHudState().ammo, w.player.getHudState().reserve]).toEqual([40, 3, 10]);
    expect(seen).toEqual(['tarrik', 'selene', 'tarrik']);

    const bare = makeWorld({ chars: false });
    bare.player.setProtagonist('selene', { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
    expect(bare.player.actor.visual).toBeNull();
    bare.input.press('attack');
    expect(() => bare.step(1)).not.toThrow();
    expect(() => bare.player.setProtagonist('nobody' as never, { pos: { x: NaN, y: 0, z: 0 }, yaw: NaN })).not.toThrow();
  });
});

describe('melee', () => {
  it('Tarrik light combo 22 / 24 / 34, then it wraps; buffered presses are never dropped', () => {
    const w = start('tarrik');
    const d = target(w);
    const got = drops(w, d);
    // presses made while a swing is committed wait for its cancel window: every one of them comes out
    w.input.press('attack');
    w.step(0.05);
    w.input.press('attack');
    w.step(0.6);
    expect(got).toEqual([22, 24]);
    w.input.press('attack');
    w.step(0.1);
    w.input.press('attack');
    w.step(1.2);
    expect(got).toEqual([22, 24, 34, 22]);
    // the chain resets after a pause
    w.step(1);
    w.input.press('attack');
    w.step(0.6);
    expect(got).toEqual([22, 24, 34, 22, 22]);
  });

  it('Selene four-hit combo 14 / 14 / 16 / 22 and the 36 heavy', () => {
    const w = start('selene');
    const d = target(w, -1.5);
    const got = drops(w, d);
    for (let i = 0; i < 4; i++) {
      w.input.press('attack');
      w.step(0.3);
    }
    w.step(0.5);
    expect(got).toEqual([14, 14, 16, 22]);
    w.step(1);
    w.input.press('heavy');
    w.step(0.8);
    expect(got[4]).toBe(36);
  });

  it('one hit per target per swing, and only what the blade can reach', () => {
    const w = start('tarrik');
    const near = target(w, -1.8);
    const behind = target(w, 2);
    const far = target(w, -6);
    let hits = 0;
    w.events.on('actor:hit', (e) => { if (e.target === near) hits++; });
    w.input.press('attack');
    w.step(0.6);
    expect(hits).toBe(1);
    expect(behind.hp).toBe(5000);
    expect(far.hp).toBe(5000);
  });

  it('heavy: a tap is 55, a full charge is ×1.5', () => {
    const w = start('tarrik');
    const d = target(w);
    const got = drops(w, d);
    w.input.press('heavy');
    w.step(0.7);
    expect(got).toEqual([55]);
    w.step(1);
    w.input.hold('heavy', true);
    w.step(0.4);
    expect(w.player.action).toBe('charge');
    w.step(0.8);
    w.input.hold('heavy', false);
    w.step(0.7);
    expect(got[1]).toBeCloseTo(55 * TUNING.melee.chargeScale, 4);
  });

  it('lunges toward a nearby target but stops short of it', () => {
    const w = start('tarrik');
    const d = target(w, -3.2);
    w.input.press('attack');
    w.step(0.6);
    const gap = w.player.actor.distanceTo(d);
    expect(gap).toBeLessThan(3.2);
    expect(gap).toBeGreaterThan(0.4 + 0.4 + 0.5);
    expect(d.hp).toBe(5000 - 22);
  });
});

describe('Echo', () => {
  it('follows the brief exactly and never regenerates', () => {
    const w = start('tarrik');
    const gains: Array<[string, number]> = [];
    w.events.on('player:echo', (e) => gains.push([e.reason, e.delta]));
    const d = w.dummy({ z: -1.8, hp: 500, poise: 50 });
    w.input.press('attack');
    w.step(0.7);
    expect(w.player.echo).toBe(0);
    w.input.press('heavy');
    w.step(0.9);
    // heavy hit (+6) broke 50 poise (18 + 60 ≥ 50 → +15)
    expect(gains).toEqual([['poiseBreak', 15], ['heavyHit', 6]]);
    d.hp = 5;
    w.input.press('attack');
    w.step(0.7);
    expect(gains[gains.length - 1]).toEqual(['kill', 5]);
    const before = w.player.echo;
    w.step(20);
    expect(w.player.echo).toBe(before);
    // rule reasons pay from the protagonist's table whatever the caller passes
    w.player.addEcho(25, 'sever');
    expect(w.player.echo).toBe(before);
    w.player.addEcho(12, 'tutorial');
    expect(w.player.echo).toBe(before + 12);
    w.player.addEcho(500, 'debug');
    expect(w.player.echo).toBe(100);
    w.player.echo = -5;
    expect(w.player.echo).toBe(0);
  });

  it('Selene: hit +2, sever +25, device +20', () => {
    const w = start('selene');
    target(w, -1.5);
    w.input.press('attack');
    w.step(0.4);
    expect(w.player.echo).toBe(2);
    w.player.addEcho(0, 'sever');
    expect(w.player.echo).toBe(27);
    w.events.emit('device:disabled', { id: 'relayA', kind: 'relayReceiver', by: w.player.actor });
    expect(w.player.echo).toBe(47);
    w.events.emit('device:disabled', { id: 'relayB', kind: 'relayReceiver', by: null });
    expect(w.player.echo).toBe(47);
  });
});

describe('movement and dodge', () => {
  it('reaches run speed within 0.15 s and stops on release; sprint is faster', () => {
    const w = start();
    w.input.moveWorld = { x: 1, z: 0 };
    w.step(0.1);
    expect(w.player.actor.vel.x).toBeGreaterThan(3.5);
    w.step(0.5);
    expect(w.player.actor.vel.x).toBeCloseTo(TUNING.move.run, 3);
    w.input.hold('sprint', true);
    w.step(0.5);
    expect(w.player.actor.vel.x).toBeCloseTo(TUNING.move.sprint, 3);
    w.input.hold('sprint', false);
    w.input.moveWorld = null;
    w.step(0.4);
    expect(w.player.actor.vel.length()).toBe(0);
  });

  it('dodge covers 4.5 m in 0.45 s with 0.30 s of i-frames, backward without input', () => {
    const w = start();
    const p = w.player.actor;
    w.input.moveWorld = { x: 1, z: 0 };
    w.step(0.02);
    w.input.moveWorld = { x: 0, z: -1 };
    const z0 = p.pos.z;
    const x0 = p.pos.x;
    w.input.press('dodge');
    w.step(1 / 60);
    w.input.moveWorld = null;
    expect(w.player.action).toBe('dodge');
    const foe = w.dummy({ x: 30 });
    w.step(0.25);
    expect(hitPlayer(w, foe).immune).toBe(true);
    w.step(0.1);
    expect(hitPlayer(w, foe).immune).toBe(false);
    w.step(0.4);
    expect(Math.hypot(p.pos.x - x0, p.pos.z - z0)).toBeCloseTo(TUNING.dodge.distance, 2);
    expect(w.player.action).toBe('free');
    // no stick: straight back (facing −Z → moves +Z)
    const w2 = start();
    w2.input.press('dodge');
    w2.step(0.7);
    expect(w2.player.actor.pos.z).toBeCloseTo(TUNING.dodge.distance, 2);
  });

  it('ignores input while disabled or movement-locked', () => {
    const w = start();
    const d = target(w);
    w.player.enabled = false;
    w.input.moveWorld = { x: 1, z: 0 };
    w.input.press('attack');
    w.step(0.6);
    expect(w.player.actor.pos.x).toBe(0);
    expect(d.hp).toBe(5000);
    w.player.enabled = true;
    w.player.setMovementLocked(true);
    w.step(0.3);
    expect(w.player.actor.pos.x).toBe(0);
    w.input.moveWorld = null;
    w.input.press('attack');
    w.step(0.6);
    expect(d.hp).toBe(5000 - 22);
    expect(w.player.actor.pos.z).toBe(0);
    w.player.setMovementLocked(false);
    w.input.moveWorld = { x: 1, z: 0 };
    w.step(0.3);
    expect(w.player.actor.pos.x).toBeGreaterThan(0.5);
  });
});

describe('guard', () => {
  it('Tarrik: held guard blocks the front (+4 Echo), a timed press counters (+22) and the riposte is guaranteed', () => {
    const w = start('tarrik');
    const foe = w.dummy({ z: -1.8, hp: 300, poise: 40 });
    let guards: boolean[] = [];
    w.events.on('player:guard', (e) => guards.push(e.perfect));
    w.input.hold('guard', true);
    w.step(0.5);
    expect(w.player.getHudState().guarding).toBe(true);
    const r = hitPlayer(w, foe);
    expect([r.blocked, r.perfect, r.applied]).toEqual([true, false, 0]);
    expect(w.player.echo).toBe(4);
    expect(w.player.actor.hp).toBe(140);
    // release and press again just before the blow lands
    w.input.hold('guard', false);
    w.step(0.6);
    w.input.hold('guard', true);
    w.step(0.1);
    const r2 = hitPlayer(w, foe);
    expect(r2.perfect).toBe(true);
    expect(foe.staggered).toBe(true);
    expect(w.player.echo).toBe(4 + 22);
    expect(guards).toEqual([false, true]);
    expect(w.player.getHudState().context?.id).toBe('counter');
    w.input.hold('guard', false);
    w.input.press('attack');
    w.step(0.6);
    expect(foe.hp).toBe(300 - TUNING.guard.counterDamage);
    // hits from behind are not blocked
    const back = w.dummy({ z: 2 });
    w.input.hold('guard', true);
    w.step(0.5);
    expect(hitPlayer(w, back).blocked).toBe(false);
  });

  it('Selene: the deflect stance returns projectiles, parries timed melee and does not tank heavies', () => {
    const w = start('selene');
    const shooter = w.dummy({ z: -12, hp: 200, yaw: Math.PI });
    w.input.press('guard');
    w.step(0.3);
    expect(w.player.action).toBe('deflect');
    const r = hitPlayer(w, shooter, { kind: 'ranged', damage: 9 });
    expect(r.perfect).toBe(true);
    expect(shooter.hp).toBe(200 - 9 * TUNING.guard.reflectScale);
    // deflect +15, and the returned bolt is a hit (+2)
    expect(w.player.echo).toBe(17);
    // a heavy blow late in the stance lands in full
    const brute = w.dummy({ z: -1.6 });
    const heavy = hitPlayer(w, brute, { heavy: true, damage: 30 });
    expect([heavy.blocked, heavy.applied]).toEqual([false, 30]);
    // timed melee is parried
    w.step(1);
    w.input.press('guard');
    w.step(0.1);
    expect(hitPlayer(w, brute, { damage: 30 }).perfect).toBe(true);
    expect(brute.staggered).toBe(true);
    // the stance is short: holding the button does nothing more
    w.input.hold('guard', true);
    w.step(1.5);
    expect(w.player.action).toBe('free');
    expect(w.player.actor.guarding).toBe(false);
  });
});

describe('ranged', () => {
  it('fires along the aim ray, spends the magazine, reloads from the reserve', () => {
    const w = start('tarrik');
    const d = target(w, -10);
    const shots: number[] = [];
    w.events.on('player:shot', (e) => shots.push(e.ammo));
    w.input.hold('aim', true);
    w.step(0.2);
    expect(w.player.getHudState().aiming).toBe(true);
    for (let i = 0; i < 6; i++) {
      w.input.press('attack');
      w.step(0.7);
    }
    expect(shots).toEqual([5, 4, 3, 2, 1, 0]);
    expect(d.hp).toBe(5000 - 6 * 26);
    w.step(2.2);
    const hud = w.player.getHudState();
    expect([hud.ammo, hud.reserve, hud.reloading]).toEqual([6, 18, false]);
    // not aiming: the same button swings the sword instead
    w.input.hold('aim', false);
    w.step(0.2);
    w.input.press('attack');
    w.step(0.1);
    expect(w.player.action).toBe('attack');
  });

  it('Axiom: weak-point ×2.5 and Echo for precision', () => {
    const w = start('selene');
    const v = new FakeVisual('linkbound');
    v.setSocket('core', 0, 1.04, 0);
    const d = target(w, -8, { yaw: Math.PI, visual: v.asVisual(), weakPoints: [{ id: 'core', socket: 'core', radius: 0.3, multiplier: 2, exposed: false }] });
    const got = drops(w, d);
    w.input.hold('aim', true);
    w.step(0.2);
    w.input.press('attack');
    w.step(0.5);
    expect(got).toEqual([34]);
    expect(w.player.echo).toBe(2);
    (d.weakPoints[0] as { exposed: boolean }).exposed = true;
    w.input.press('attack');
    w.step(0.5);
    expect(got).toEqual([34, 85]);
    expect(w.player.echo).toBe(12);
    // behind the target: a flank shot also pays
    (d.weakPoints[0] as { exposed: boolean }).exposed = false;
    w.player.teleport({ x: 0, y: 0, z: -16 }, Math.PI);
    w.step(0.2);
    w.input.press('attack');
    w.step(0.5);
    expect(got).toEqual([34, 85, 34]);
    expect(w.player.echo).toBe(22);
  });
});

describe('aim assist and shot buffering', () => {
  it('bullet magnetism bends a near miss onto a hostile only when the setting is on', () => {
    const w = start('selene');
    const d = target(w, -30, { x: 0.62, yaw: Math.PI });
    w.input.hold('aim', true);
    w.step(0.2);
    w.game.settings.set('aimAssist', false);
    w.input.press('attack');
    w.step(0.5);
    expect(d.hp).toBe(5000);
    w.game.settings.set('aimAssist', true);
    w.input.press('attack');
    w.step(0.5);
    expect(d.hp).toBe(5000 - 34);
    // too far off the line: no bending
    d.pos.x = 1.6;
    w.input.press('attack');
    w.step(0.5);
    expect(d.hp).toBe(5000 - 34);
  });

  it('a shot pressed during the weapon cycle is fired as soon as it can', () => {
    const w = start('tarrik');
    const d = target(w, -10);
    w.input.hold('aim', true);
    w.step(0.2);
    w.input.press('attack');
    w.step(0.1);
    w.input.press('attack');
    w.step(0.7);
    expect(d.hp).toBe(5000 - 52);
    expect(w.player.getHudState().ammo).toBe(4);
  });
});

describe('abilities', () => {
  it('Cinder Slam: costs 35 Echo, hits everything within 5 m for 40, then cools down', () => {
    const w = start('tarrik');
    const a = target(w, -3);
    const b = target(w, 4);
    const far = target(w, -9);
    const used: string[] = [];
    w.events.on('player:ability', (e) => used.push(e.id));
    w.input.press('ability1');
    w.step(0.8);
    expect(used).toEqual([]);
    expect(a.hp).toBe(5000);
    w.player.addEcho(100, 'debug');
    w.input.press('ability1');
    w.step(0.8);
    expect(used).toEqual(['cinderSlam']);
    expect([a.hp, b.hp, far.hp]).toEqual([4960, 4960, 5000]);
    expect(w.player.echo).toBe(65);
    const st = w.player.getHudState().abilities[0];
    expect(st.cooldownLeft).toBeGreaterThan(4);
    expect(st.ready).toBe(false);
    w.input.press('ability1');
    w.step(0.8);
    expect(used.length).toBe(1);
    w.step(6);
    expect(w.player.getHudState().abilities[0].ready).toBe(true);
  });

  it('Sticky grenade sticks to the first actor and blasts after the fuse', () => {
    const w = start('tarrik');
    const d = target(w, -8);
    const beside = target(w, -8, { x: 2.5 });
    w.player.addEcho(100, 'debug');
    w.input.press('ability2');
    w.step(1);
    expect(d.hp).toBe(5000);
    w.step(1.5);
    expect(d.hp).toBe(5000 - 60);
    expect(beside.hp).toBeLessThan(5000);
    expect(beside.hp).toBeGreaterThanOrEqual(5000 - 60);
    expect(w.player.echo).toBe(70);
  });

  it('Stasis grenade arrests hostiles for 4 s; Dispatch blinks behind the target and doubles against the arrested', () => {
    const w = start('selene');
    const d = target(w, -7);
    const got = drops(w, d);
    w.player.addEcho(100, 'debug');
    w.input.press('ability2');
    w.step(0.8);
    expect(got).toEqual([55]);
    // landed on the far side (the target faces −Z, so "behind" is +Z … which is where we came from) — within reach
    expect(w.player.actor.distanceTo(d)).toBeLessThan(2);
    expect(w.player.echo).toBe(70 + 2);
    w.player.teleport({ x: 0, y: 0, z: 0 }, 0);
    w.step(6.5);
    w.input.press('ability1');
    w.step(1.2);
    expect(d.frozen).toBe(true);
    expect(d.frozenUntil - w.time.now).toBeGreaterThan(2.5);
    w.input.press('ability2');
    w.step(0.8);
    expect(got[1]).toBeCloseTo(110, 4);
    w.step(4);
    expect(d.frozen).toBe(false);
  });

  it('Dispatch needs a target in range', () => {
    const w = start('selene');
    target(w, -30);
    w.player.addEcho(100, 'debug');
    w.input.press('ability2');
    w.step(0.5);
    expect(w.player.echo).toBe(100);
    expect(w.player.actor.pos.z).toBe(0);
  });
});

describe('lock-on, scan, context actions, pickups, death', () => {
  it('lock-on picks the hostile ahead and drops when it dies', () => {
    const w = start();
    const ahead = w.dummy({ z: -6, hp: 10 });
    w.dummy({ x: 8, z: 3 });
    const events: Array<Actor | null> = [];
    w.events.on('player:lockon', (e) => events.push(e.target));
    w.input.press('lockOn');
    w.step(0.1);
    expect(w.player.lockTarget).toBe(ahead);
    w.actors.kill(ahead);
    w.step(0.1);
    expect(w.player.lockTarget).toBeNull();
    expect(events).toEqual([ahead, null]);
    w.input.press('scan');
    w.step(0.1);
    expect(w.player.scanning).toBe(true);
    w.step(3.1);
    expect(w.player.scanning).toBe(false);
  });

  it('flicking the look input switches the lock to the next target that way', () => {
    const w = start();
    const left = w.dummy({ x: -1, z: -8 });
    const right = w.dummy({ x: 4, z: -8 });
    w.input.press('lockOn');
    w.step(0.1);
    expect(w.player.lockTarget).toBe(left);
    w.input.look.x = -0.2; // look right
    w.step(1 / 60);
    w.input.look.x = 0;
    expect(w.player.lockTarget).toBe(right);
    w.step(0.5);
    w.input.look.x = 0.2;
    w.step(1 / 60);
    w.input.look.x = 0;
    expect(w.player.lockTarget).toBe(left);
    // the body squares up to the lock target while moving
    w.input.moveWorld = { x: 1, z: 0 };
    w.step(0.6);
    const a = w.player.actor;
    const want = Math.atan2(-(left.pos.x - a.pos.x), -(left.pos.z - a.pos.z));
    expect(Math.abs(a.yaw - want)).toBeLessThan(0.05);
    w.player.lockTarget = null;
    expect(w.player.lockTarget).toBeNull();
  });

  it('playScripted faces the point and returns the clip length; threat is clamped for the HUD', () => {
    const w = start();
    w.player.enabled = false;
    expect(w.player.playScripted('assent', { faceTo: { x: 5, y: 0, z: 0 } })).toBeCloseTo(0.5, 6);
    expect(w.player.actor.yaw).toBeCloseTo(-Math.PI / 2, 6);
    w.player.threat = 3;
    expect(w.player.getHudState().threat).toBe(1);
  });

  it('context action: confirm or expire, exactly once, window widened by difficulty', () => {
    const w = start();
    let confirmed = 0;
    let expired = 0;
    const mk = (window: number, auto = false) => ({
      id: 'resonance', prompt: 'Confirm', button: 'heavy' as const, window, autoConfirmable: auto,
      onConfirm: () => void confirmed++, onExpire: () => void expired++,
    });
    w.player.setContextAction(mk(1));
    w.step(0.5);
    w.input.press('heavy');
    w.step(0.2);
    expect([confirmed, expired, w.player.contextAction]).toEqual([1, 0, null]);
    // the confirming press did not also swing the sword
    expect(w.player.action).toBe('free');
    w.player.setContextAction(mk(1));
    w.step(1.2);
    expect([confirmed, expired]).toEqual([1, 1]);
    w.game.settings.set('difficulty', 'story');
    w.player.setContextAction(mk(1));
    expect(w.player.getHudState().context?.window).toBeCloseTo(1.6, 6);
    w.step(1.3);
    expect(expired).toBe(1);
    w.step(0.5);
    expect(expired).toBe(2);
    w.game.settings.set('difficulty', 'standard');
    w.game.settings.set('autoPrompts', true);
    w.player.setContextAction(mk(2, true));
    w.step(0.6);
    expect(confirmed).toBe(2);
    w.game.settings.set('autoPrompts', false);
    // replacing or clearing fires nothing
    w.player.setContextAction(mk(5));
    w.player.setContextAction(null);
    w.step(6);
    expect([confirmed, expired]).toEqual([2, 2]);
  });

  it('pickups: sustain +35 only when hurt, ammo refill, Echo +20', () => {
    const w = start();
    const kinds: string[] = [];
    w.events.on('player:pickup', (e) => kinds.push(e.kind));
    const full = spawnPickup(w.game, 'sustain', { x: 0, y: 0, z: 0 });
    w.step(0.2);
    expect(full.collected).toBe(false);
    w.player.actor.hp = 60;
    w.step(0.1);
    expect(full.collected).toBe(true);
    expect(w.player.actor.hp).toBe(95);
    w.player.setAmmo(1, 2);
    spawnPickup(w.game, 'ammo', { x: 0.5, y: 0, z: 0 });
    spawnPickup(w.game, 'echo', { x: 0, y: 0, z: 0.5 });
    const farAway = spawnPickup(w.game, 'echo', { x: 30, y: 0, z: 0 });
    w.step(0.1);
    const hud = w.player.getHudState();
    expect([hud.ammo, hud.reserve, hud.echo]).toEqual([6, 24, 20]);
    expect(kinds.slice().sort()).toEqual(['ammo', 'echo', 'sustain']);
    expect(farAway.collected).toBe(false);
    w.events.emit('zone:loading', { zone: 'Z01' });
    w.player.teleport({ x: 30, y: 0, z: 0 });
    w.step(0.2);
    expect(w.player.echo).toBe(20);
  });

  it('death fires once and the controller is reusable after a checkpoint reload', () => {
    const w = start();
    const foe = w.dummy({ z: -2 });
    let died = 0;
    w.events.on('player:died', () => died++);
    w.player.addEcho(50, 'debug');
    hitPlayer(w, foe, { damage: 999 });
    hitPlayer(w, foe, { damage: 999 });
    w.step(1);
    expect(died).toBe(1);
    expect([w.player.actor.alive, w.player.action]).toEqual([false, 'dead']);
    w.input.press('attack');
    w.step(5);
    expect(w.actors.all).toContain(w.player.actor);
    // what mission.reloadCheckpoint() does
    const same = w.player.actor;
    w.actors.clear();
    w.player.setProtagonist('tarrik', { pos: { x: 3, y: 0, z: 3 }, yaw: 1 });
    w.player.restoreForCheckpoint({ echo: 30 });
    expect(w.player.actor).toBe(same);
    expect([same.alive, same.targetable, same.hp, w.player.echo, w.player.action]).toEqual([true, true, 140, 30, 'free']);
    const d = w.dummy({ x: 3 + -Math.sin(1) * 1.8, z: 3 + -Math.cos(1) * 1.8, hp: 5000, poise: 0 });
    w.input.press('attack');
    w.step(0.6);
    expect(d.hp).toBe(5000 - 22);
  });
});
