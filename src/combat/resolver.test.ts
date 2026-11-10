import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Actor, HitInfo } from '@/core/api';
import { DEG, forwardX, forwardZ } from '@/core/mathx';
import { TUNING } from './tuning';
import { FakeVisual, makeWorld } from './testkit';

/** a melee hit travelling from `from` toward `target` */
function hitFrom(from: Actor | { x: number; z: number }, target: Actor, extra: Partial<HitInfo> = {}): HitInfo {
  const p = 'pos' in from ? from.pos : from;
  const dx = target.pos.x - p.x;
  const dz = target.pos.z - p.z;
  const l = Math.hypot(dx, dz) || 1;
  return {
    attacker: 'pos' in from ? (from as Actor) : null,
    damage: 10, poise: 0, kind: 'melee',
    dir: { x: dx / l, y: 0, z: dz / l },
    point: { x: target.pos.x, y: target.pos.y + 1.1, z: target.pos.z },
    ...extra,
  };
}

/** a point `dist` metres from the target at `angle` off its facing (positive = to its left) */
function around(target: Actor, angle: number, dist = 2): { x: number; z: number } {
  const yaw = target.yaw + angle;
  return { x: target.pos.x + forwardX(yaw) * dist, z: target.pos.z + forwardZ(yaw) * dist };
}

describe('applyHit — immunity', () => {
  it('ignores dead, untargetable, invulnerable, protected and i-framed targets', () => {
    const w = makeWorld();
    const src = { x: 0, z: 5 };
    const cases: Array<(a: Actor) => void> = [
      (a) => { a.targetable = false; },
      (a) => { a.invulnerable = true; },
      (a) => { a.protectedNpc = true; },
      (a) => { a.iframesUntil = w.time.now + 0.3; },
    ];
    for (const set of cases) {
      const a = w.dummy({});
      set(a);
      const r = w.actors.applyHit(a, hitFrom(src, a, { damage: 50, poise: 50 }));
      expect(r.immune).toBe(true);
      expect(r.applied).toBe(0);
      expect(a.hp).toBe(100);
      expect(a.poise).toBe(30);
    }
    const dead = w.dummy({});
    w.actors.kill(dead);
    expect(w.actors.applyHit(dead, hitFrom(src, dead)).immune).toBe(true);
  });

  it('i-frames end exactly when they should', () => {
    const w = makeWorld();
    const a = w.dummy({});
    a.iframesUntil = 0.3;
    w.time.now = 0.29;
    expect(w.actors.applyHit(a, hitFrom({ x: 0, z: 5 }, a)).immune).toBe(true);
    w.time.now = 0.31;
    const r = w.actors.applyHit(a, hitFrom({ x: 0, z: 5 }, a));
    expect(r.immune).toBe(false);
    expect(r.applied).toBe(10);
  });

  it('never throws on junk input', () => {
    const w = makeWorld();
    const a = w.dummy({});
    expect(() => w.actors.applyHit(a, null as unknown as HitInfo)).not.toThrow();
    expect(() => w.actors.applyHit(null as unknown as Actor, hitFrom({ x: 0, z: 1 }, a))).not.toThrow();
    const r = w.actors.applyHit(a, { attacker: null, damage: NaN, poise: NaN, kind: 'melee', dir: { x: NaN, y: 0, z: 0 }, point: { x: NaN, y: 0, z: 0 } });
    expect(r.applied).toBe(0);
    expect(a.hp).toBe(100);
  });
});

describe('applyHit — guard', () => {
  it('blocks inside the frontal arc only, for every facing including the ±π wrap', () => {
    const w = makeWorld();
    for (const yaw of [0, 1.3, Math.PI - 0.02, -Math.PI + 0.02, 3.5 * Math.PI, -2.9]) {
      for (const angle of [0, 30, 59, -59, 61, -61, 120, 180, -150]) {
        const a = w.dummy({ hp: 1000 });
        a.yaw = yaw;
        a.guarding = true;
        a.guardArc = 120 * DEG;
        const r = w.actors.applyHit(a, hitFrom(around(a, angle * DEG), a));
        expect(r.blocked, `yaw ${yaw} angle ${angle}`).toBe(Math.abs(angle) <= 60);
        expect(r.applied).toBe(Math.abs(angle) <= 60 ? 0 : 10);
      }
    }
  });

  it('uses the attacker position when the hit has no direction', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 1000 });
    a.guarding = true;
    const front = w.dummy({ x: 0, z: -2 });
    const back = w.dummy({ x: 0, z: 2 });
    const mk = (attacker: Actor): HitInfo => ({ attacker, damage: 10, poise: 0, kind: 'explosion', dir: { x: 0, y: 0, z: 0 }, point: a.pos });
    expect(w.actors.applyHit(a, mk(front)).blocked).toBe(true);
    expect(w.actors.applyHit(a, mk(back)).blocked).toBe(false);
  });

  it('perfect guard: no damage, melee attacker staggered, only inside the window', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 1000, poise: 60 });
    const foe = w.dummy({ x: 0, z: -2, poise: 30 });
    a.guarding = true;
    a.perfectGuardUntil = w.time.now + 0.22;
    w.time.now += 0.2;
    const r = w.actors.applyHit(a, hitFrom(foe, a, { damage: 30, poise: 40 }));
    expect(r.perfect).toBe(true);
    expect(r.blocked).toBe(true);
    expect(r.applied).toBe(0);
    expect(a.poise).toBe(60);
    expect(foe.staggered).toBe(true);
    // a perfectly guarded projectile does not stagger its shooter
    const shooter = w.dummy({ x: 0, z: -8 });
    expect(w.actors.applyHit(a, hitFrom(shooter, a, { kind: 'ranged' })).perfect).toBe(true);
    expect(shooter.staggered).toBe(false);
    // window over → an ordinary block with poise ×0.6
    w.time.now += 0.1;
    const late = w.actors.applyHit(a, hitFrom(shooter, a, { damage: 30, poise: 20 }));
    expect(late.perfect).toBe(false);
    expect(late.blocked).toBe(true);
    expect(late.applied).toBe(0);
    expect(a.poise).toBeCloseTo(60 - 20 * TUNING.hit.guardPoiseScale, 6);
  });

  it('guard break when blocked poise runs out', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 1000, poise: 30 });
    a.guarding = true;
    const src = around(a, 0);
    expect(w.actors.applyHit(a, hitFrom(src, a, { poise: 40 })).staggered).toBe(false);
    const r = w.actors.applyHit(a, hitFrom(src, a, { poise: 20 }));
    expect(r.staggered).toBe(true);
    expect(r.guardBroken).toBe(true);
    expect(a.guarding).toBe(false);
    expect(a.staggered).toBe(true);
    expect(a.poise).toBe(30);
    expect(a.staggeredUntil - w.time.now).toBeCloseTo(TUNING.actor.guardBreakSeconds, 6);
  });

  it('unblockable, heavy-through-guard, chip and deflect rules', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 1000 });
    a.guarding = true;
    const src = around(a, 0);
    expect(w.actors.applyHit(a, hitFrom(src, a, { unblockable: true })).blocked).toBe(false);
    a.guardStopsHeavy = false;
    expect(w.actors.applyHit(a, hitFrom(src, a, { heavy: true })).blocked).toBe(false);
    expect(w.actors.applyHit(a, hitFrom(src, a, { heavy: false })).blocked).toBe(true);
    a.guardChip = 0.35;
    expect(w.actors.applyHit(a, hitFrom(src, a, { damage: 20 })).applied).toBeCloseTo(7, 6);
    // deflect stance: every projectile is perfect, melee only inside the timed window
    a.deflectUntil = w.time.now + 0.5;
    a.perfectGuardUntil = w.time.now - 1;
    expect(w.actors.applyHit(a, hitFrom(src, a, { kind: 'ranged' })).perfect).toBe(true);
    expect(w.actors.applyHit(a, hitFrom(src, a, { kind: 'melee' })).perfect).toBe(false);
    // a frozen or staggered body cannot guard
    a.guardChip = 0;
    w.actors.freeze(a, 1);
    expect(w.actors.applyHit(a, hitFrom(src, a)).blocked).toBe(false);
  });
});

describe('applyHit — weak points, flanks, scaling', () => {
  function withWeakPoint(exposed: boolean): { w: ReturnType<typeof makeWorld>; a: Actor } {
    const w = makeWorld();
    const v = new FakeVisual('secDrone');
    v.setSocket('vent', 0, 1.2, 0.5);
    const a = w.dummy({ hp: 1000, visual: v.asVisual(), weakPoints: [{ id: 'vent', socket: 'vent', radius: 0.25, multiplier: 2, exposed }] });
    w.step(1 / 60);
    return { w, a };
  }

  it('multiplies damage when the point is inside an exposed weak-point sphere', () => {
    const { w, a } = withWeakPoint(true);
    const src = { x: 0, z: 5 };
    const on = w.actors.applyHit(a, hitFrom(src, a, { point: { x: 0.1, y: 1.25, z: 0.45 } }));
    expect(on.weakPoint).toBe(true);
    expect(on.applied).toBe(20);
    const off = w.actors.applyHit(a, hitFrom(src, a, { point: { x: 0, y: 0.4, z: 0 } }));
    expect(off.weakPoint).toBe(false);
    expect(off.applied).toBe(10);
    // the weapon's own minimum multiplier (Axiom ×2.5)
    expect(w.actors.applyHit(a, hitFrom(src, a, { point: { x: 0, y: 1.2, z: 0.5 }, weakPointScale: 2.5 })).applied).toBe(25);
  });

  it('ignores unexposed weak points unless forced; area hits can opt out', () => {
    const { w, a } = withWeakPoint(false);
    const src = { x: 0, z: 5 };
    const at = { x: 0, y: 1.2, z: 0.5 };
    expect(w.actors.applyHit(a, hitFrom(src, a, { point: at })).weakPoint).toBe(false);
    expect(w.actors.weakPointPosition(a, new THREE.Vector3())).toBeNull();
    const forced = hitFrom(src, a, { weakPoint: true });
    expect(w.actors.applyHit(a, forced).applied).toBe(20);
    (a.weakPoints[0] as { exposed: boolean }).exposed = true;
    expect(w.actors.weakPointPosition(a, new THREE.Vector3())?.y).toBeCloseTo(1.2, 6);
    expect(w.actors.applyHit(a, hitFrom(src, a, { point: at })).applied).toBe(20);
    const blast = w.actors.applyHit(a, hitFrom(src, a, { point: at, ignoreWeakPoints: true }));
    expect([blast.weakPoint, blast.applied]).toEqual([false, 10]);
  });

  it('flanks, link armour and poise resistance', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 1000, poise: 30 });
    a.flankMultiplier = 1.5;
    expect(w.actors.applyHit(a, hitFrom(around(a, 0), a)).flanked).toBe(false);
    const f = w.actors.applyHit(a, hitFrom(around(a, 170 * DEG), a));
    expect(f.flanked).toBe(true);
    expect(f.applied).toBe(15);
    expect(w.actors.isFlank(a, { x: forwardX(a.yaw), y: 0, z: forwardZ(a.yaw) })).toBe(true);
    // linked: half damage, a third of the poise damage
    const b = w.dummy({ hp: 100, poise: 30, x: 5 });
    b.linked = true;
    b.damageTakenScale = 0.5;
    b.poiseTakenScale = 1 / 3;
    const src = around(b, 0);
    const r = w.actors.applyHit(b, hitFrom(src, b, { damage: 20, poise: 30 }));
    expect(r.applied).toBe(10);
    expect(r.resisted).toBe(true);
    expect(r.staggered).toBe(false);
    w.actors.applyHit(b, hitFrom(src, b, { damage: 0, poise: 30 }));
    expect(b.staggered).toBe(false);
    expect(w.actors.applyHit(b, hitFrom(src, b, { damage: 0, poise: 31 })).staggered).toBe(true);
    // severed: individual stagger again
    b.poiseTakenScale = 1;
    w.time.now += 5;
    expect(w.actors.applyHit(b, hitFrom(src, b, { damage: 0, poise: 30 })).staggered).toBe(true);
  });

  it('super armour ignores poise damage for its duration', () => {
    const w = makeWorld();
    const a = w.dummy({ poise: 20 });
    a.superArmorUntil = w.time.now + 0.5;
    expect(w.actors.applyHit(a, hitFrom({ x: 0, z: 3 }, a, { poise: 100 })).staggered).toBe(false);
    w.time.now += 0.6;
    expect(w.actors.applyHit(a, hitFrom({ x: 0, z: 3 }, a, { poise: 100 })).staggered).toBe(true);
  });
});

describe('applyHit — poise, freeze, knockback, death', () => {
  it('staggers at zero poise, resets it, and recovers poise after 2.5 s', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 1000, poise: 30 });
    const src = { x: 0, z: 4 };
    let staggers = 0;
    w.events.on('actor:staggered', () => staggers++);
    expect(w.actors.applyHit(a, hitFrom(src, a, { poise: 29 })).staggered).toBe(false);
    expect(a.poise).toBe(1);
    const r = w.actors.applyHit(a, hitFrom(src, a, { poise: 1 }));
    expect(r.staggered).toBe(true);
    expect(a.poise).toBe(30);
    expect(a.staggeredUntil - w.time.now).toBeCloseTo(TUNING.actor.staggerSeconds, 6);
    expect(staggers).toBe(1);
    // recovery only after the delay
    w.actors.applyHit(a, hitFrom(src, a, { poise: 20 }));
    w.step(2.4);
    expect(a.poise).toBe(10);
    w.step(0.5);
    expect(a.poise).toBeGreaterThan(10);
    w.step(3);
    expect(a.poise).toBe(30);
    // no poise bar → never staggered by poise damage
    const d = w.dummy({ poise: 0 });
    expect(w.actors.applyHit(d, hitFrom(src, d, { poise: 999 })).staggered).toBe(false);
  });

  it('freeze: seconds, ×1.5 damage, immunity scale, thaw, no movement while frozen', () => {
    const w = makeWorld();
    const v = new FakeVisual('linkbound');
    const a = w.dummy({ hp: 1000, visual: v.asVisual(), controller: { update: (x) => x.desiredVel.set(3, 0, 0) } });
    let frozen = 0;
    w.events.on('actor:frozen', (e) => (frozen = e.seconds));
    const r = w.actors.applyHit(a, hitFrom({ x: 0, z: 4 }, a, { damage: 0, freeze: 4 }));
    expect(r.froze).toBe(true);
    expect(frozen).toBe(4);
    expect(a.frozen).toBe(true);
    expect(v.frozen).toBe(1);
    const x0 = a.pos.x;
    w.step(1);
    expect(a.pos.x).toBe(x0);
    expect(w.actors.applyHit(a, hitFrom({ x: 0, z: 4 }, a)).applied).toBeCloseTo(15, 6);
    w.step(3.2);
    expect(a.frozen).toBe(false);
    expect(v.frozen).toBe(0);
    expect(a.pos.x).toBeGreaterThan(x0);
    const elite = w.dummy({ x: 9 });
    elite.freezeScale = 0;
    expect(w.actors.applyHit(elite, hitFrom({ x: 9, z: 4 }, elite, { freeze: 4 })).froze).toBe(false);
    expect(elite.frozen).toBe(false);
  });

  it('knockback becomes a decaying impulse along the hit', () => {
    const w = makeWorld();
    const a = w.dummy({ hp: 1000 });
    w.actors.applyHit(a, hitFrom({ x: 0, z: 4 }, a, { knockback: 6 }));
    expect(a.impulse.z).toBeCloseTo(-6, 6);
    w.step(1.5);
    expect(a.pos.z).toBeLessThan(-0.5);
    expect(a.impulse.lengthSq()).toBe(0);
  });

  it('kills exactly once', () => {
    const w = makeWorld();
    let deaths = 0;
    let onDeath = 0;
    w.events.on('actor:died', () => deaths++);
    const a = w.dummy({ hp: 40, controller: { update() {}, onDeath: () => void onDeath++ } });
    const src = { x: 0, z: 3 };
    const first = w.actors.applyHit(a, hitFrom(src, a, { damage: 999 }));
    expect(first.killed).toBe(true);
    expect(first.applied).toBe(40);
    expect(a.alive).toBe(false);
    expect(a.targetable).toBe(false);
    const second = w.actors.applyHit(a, hitFrom(src, a, { damage: 999 }));
    expect(second.killed).toBe(false);
    expect(second.immune).toBe(true);
    w.actors.kill(a);
    w.actors.kill(a);
    expect(deaths).toBe(1);
    expect(onDeath).toBe(1);
    // the body is removed after its corpse time
    expect(w.actors.all).toContain(a);
    w.step(TUNING.actor.corpseSeconds + 0.1);
    expect(w.actors.all).not.toContain(a);
    expect(w.actors.byId(a.id)).toBeNull();
  });
});

describe('applyHit — the player', () => {
  it('god mode removes hp loss; difficulty scales damage taken', () => {
    const w = makeWorld();
    w.player.setProtagonist('tarrik', { pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const p = w.player.actor;
    const foe = w.dummy({ x: 0, z: -2 });
    w.game.settings.set('difficulty', 'standard');
    expect(w.actors.applyHit(p, hitFrom(foe, p, { damage: 20 })).applied).toBe(20);
    w.game.settings.set('difficulty', 'story');
    expect(w.actors.applyHit(p, hitFrom(foe, p, { damage: 20 })).applied).toBeCloseTo(12, 6);
    // difficulty never scales damage on other actors
    expect(w.actors.applyHit(foe, hitFrom(p, foe, { damage: 20 })).applied).toBe(20);
    w.player.godMode = true;
    const r = w.actors.applyHit(p, hitFrom(foe, p, { damage: 500, poise: 500 }));
    expect(r.applied).toBe(0);
    expect(r.killed).toBe(false);
    expect(p.alive).toBe(true);
    w.game.settings.set('difficulty', 'standard');
  });
});
