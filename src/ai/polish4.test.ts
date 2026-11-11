/**
 * Polish pass 4 (AI): Varo's rifle kit, the scripted hold (`play(…, { persist: true })`), every look option
 * forwarded to the factory, scan-plane colour and centre, and the passive scan head.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterVisual, PlayOpts, ScanPlaneVisual } from '@/core/api';
import { HELD_POSES, kitFor } from './companionKit';
import { scanPlaneVisual } from './scanplane';
import { makeAiWorld } from './testkit';

afterEach(() => {
  vi.restoreAllMocks();
});

/** upper-body poses of the fake: one replaces another (as a held upper-body pose does on a real figure) */
const UPPER = new Set(['verityCollapsed', 'talk', 'aim', 'aimRifle', 'guard']);

/**
 * Give a test-world visual a memory of what it plays: `persist` poses survive stop() without an action (what
 * PlayOpts.persist promises), a new upper-body pose replaces the old one. `honourPersist: false` models a figure
 * whose stop() clears everything.
 */
function track(v: CharacterVisual, honourPersist = true) {
  const playing = new Map<string, boolean>();
  const log: Array<[string, PlayOpts | undefined]> = [];
  const loadouts: unknown[] = [];
  v.play = ((a: string, o?: PlayOpts) => {
    log.push([a, o]);
    if (UPPER.has(a)) for (const k of [...playing.keys()]) if (UPPER.has(k)) playing.delete(k);
    playing.set(a, o?.persist === true);
    return { duration: 0.8, hitTimes: [], loop: false };
  }) as CharacterVisual['play'];
  v.stop = ((a?: string) => {
    if (a === undefined) {
      for (const [k, p] of [...playing]) if (!p || !honourPersist) playing.delete(k);
    } else playing.delete(a);
  }) as CharacterVisual['stop'];
  v.isPlaying = ((a?: string) => (a === undefined ? playing.size > 0 : playing.has(a))) as CharacterVisual['isPlaying'];
  v.setLoadout = ((l: unknown) => {
    loadouts.push(l);
  }) as CharacterVisual['setLoadout'];
  return { playing, log, loadouts };
}

describe('Varo carries his rifle (polish 4)', () => {
  it('varo has the rifle kit: in hand as an NPC and again after stopAction()', () => {
    expect(kitFor('varo').style).toBe('ranged');
    expect(kitFor('varo').loadout).toEqual({ ranged: true });
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 0);
    const loadouts: unknown[] = [];
    const chars = w.game.chars as unknown as { create: (a: string, o?: unknown) => CharacterVisual };
    const create = chars.create.bind(chars);
    chars.create = (a: string, o?: unknown) => {
      const v = create(a, o);
      v.setLoadout = ((l: unknown) => loadouts.push(l)) as CharacterVisual['setLoadout'];
      return v;
    };
    const varo = w.ai.spawnNpc('varo', { pos: { x: 3, y: 0, z: 0 }, pose: 'idle' });
    expect(loadouts.at(-1)).toEqual({ ranged: true });
    varo.play('aimRifle', { loop: true });
    varo.stopAction();
    expect(loadouts.at(-1)).toEqual({ ranged: true });
  });
});

describe('scripted hold: play(action, { persist: true }) (polish 4)', () => {
  it('survives stopAction(), mode changes and follow; the body does not fight while it holds', () => {
    const w = makeAiWorld();
    w.arena();
    const hero = w.hero('tarrik', 0, 0);
    const selene = w.ai.spawnCompanion('selene', { pos: { x: 2, y: 0, z: 2 }, mode: 'follow' });
    const t = track(selene.actor.visual!);
    selene.play('verityCollapsed', { persist: true });
    expect(t.log.at(-1)).toEqual(['verityCollapsed', { persist: true }]);
    expect(selene.heldPose).toBe('verityCollapsed');
    // what the Z09 scenes do around her
    selene.stopAction();
    selene.mode = 'follow';
    selene.follow(hero);
    expect(selene.heldPose).toBe('verityCollapsed');
    expect(t.playing.has('verityCollapsed')).toBe(true);
    w.player.teleport({ x: 0, y: 0, z: -12 });
    w.run(6);
    expect(selene.actor.distanceTo(hero)).toBeLessThan(6);
    expect(t.playing.has('verityCollapsed')).toBe(true);
    // a fight breaks out: in combat mode she stands down while the hold lasts
    const foe = w.ai.spawnEnemy('linkbound', { pos: { x: 3, y: 0, z: -18 }, dormant: true, hpScale: 3 });
    w.actors.setHostile('player', 'eclipse', true);
    selene.mode = 'combat';
    const hp = foe.hp;
    w.run(6);
    expect(foe.hp).toBe(hp);
    expect(t.log.some(([a]) => a === 'aim')).toBe(false);
    expect(selene.heldPose).toBe('verityCollapsed');
    // naming the hold ends it: the blades may come out again
    selene.stopAction('verityCollapsed');
    expect(selene.heldPose).toBeNull();
    expect(t.playing.has('verityCollapsed')).toBe(false);
    w.run(6);
    expect(t.log.some(([a]) => a === 'aim')).toBe(true);
    expect(foe.hp).toBeLessThan(hp);
  });

  it('ends when the zone plays another upper-body pose over it, or with a scripted assist', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 0);
    const selene = w.ai.spawnCompanion('selene', { pos: { x: 2, y: 0, z: 2 }, mode: 'follow' });
    const t = track(selene.actor.visual!);
    selene.play('verityCollapsed', { persist: true });
    selene.actor.visual!.play('talk', { loop: true });
    w.run(0.1);
    expect(selene.heldPose).toBeNull();
    selene.play('verityCollapsed', { persist: true });
    const foe = w.ai.spawnEnemy('linkbound', { pos: { x: 0, y: 0, z: -6 }, dormant: true });
    selene.assist(foe, 'frostArrest');
    expect(selene.heldPose).toBeNull();
    expect(t.playing.has('verityCollapsed')).toBe(false);
  });

  it('a figure whose stop() clears everything gets the held pose back at its end frame', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 0);
    const selene = w.ai.spawnCompanion('selene', { pos: { x: 2, y: 0, z: 2 }, mode: 'follow' });
    const t = track(selene.actor.visual!, false);
    selene.play('verityCollapsed', { persist: true });
    selene.stopAction();
    expect(t.playing.has('verityCollapsed')).toBe(true);
    const [name, opts] = t.log.at(-1)!;
    expect(name).toBe('verityCollapsed');
    expect(opts?.persist).toBe(true);
    expect(opts?.startAt).toBeCloseTo(0.5, 6); // the fake's info() duration: the held end pose, no second collapse
    expect(selene.heldPose).toBe('verityCollapsed');
  });

  it('stopAction(action) stops only that action; knockdown is a held pose that pins the body', () => {
    expect(HELD_POSES.has('knockdown')).toBe(true);
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 0);
    const c = w.ai.spawnNpc('dominionSoldier', { pos: { x: 3, y: 0, z: 0 } });
    const t = track(c.actor.visual!);
    c.play('knockdown');
    expect(c.actor.fixed).toBe(true);
    c.play('point');
    c.stopAction('point');
    expect(t.playing.has('point')).toBe(false);
    expect(c.actor.fixed).toBe(true);
    c.stopAction('knockdown');
    expect(c.actor.fixed).toBe(false);
    expect(t.playing.has('knockdown')).toBe(false);
  });
});

describe('look options reach the factory (polish 4)', () => {
  it('spawnNpc / spawnCompanion forward every look option, drop wrong kinds and unknown keys', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('tarrik', 0, 10);
    const asked: Array<[string, unknown]> = [];
    const chars = w.game.chars as unknown as { create: (a: string, o?: unknown) => unknown };
    const create = chars.create.bind(chars);
    chars.create = (a: string, o?: unknown): unknown => {
      asked.push([a, o]);
      return create(a, o);
    };
    w.ai.spawnNpc('kingWitness', {
      pos: { x: 3, y: 0, z: 0 },
      look: { wounded: true, woundSide: 'right', scale: 1.05, halo: true, corruption: Number.NaN, bareHead: 'yes', driverOnly: true, bogus: 1 } as never,
    });
    w.ai.spawnCompanion('lyric', { pos: { x: -3, y: 0, z: 0 }, seed: 4, look: { corruption: 0.24, woundSide: 'up' } as never });
    w.ai.spawnNpc('linkbound' as never, { pos: { x: 0, y: 0, z: 4 }, look: { halfHuman: true, variant: 2 } });
    expect(asked[0]).toEqual(['kingWitness', { wounded: true, woundSide: 'right', scale: 1.05, halo: true }]);
    expect(asked[1]).toEqual(['lyric', { corruption: 0.24, seed: 4 }]);
    expect(asked[2]).toEqual(['linkbound', { halfHuman: true, variant: 2 }]);
  });
});

describe('scan planes and scan heads (polish 4)', () => {
  function fakePlaneVisual() {
    const uColor = { value: new THREE.Vector3(0.7, 0.9, 1.1) };
    const mat = new THREE.ShaderMaterial({ uniforms: { uColor } });
    const object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const v: ScanPlaneVisual = { object, setPose() {}, setAlert() {}, remove() {} };
    return { v, uColor };
  }

  it('color: a hex goes to the effect as is; a linear triple is written to the sheet (HDR allowed)', () => {
    const asked: Array<number | undefined> = [];
    const made = fakePlaneVisual();
    const vfx = { scanPlane: (c?: number) => (asked.push(c), made.v) };
    scanPlaneVisual(vfx, 0x3d8fff);
    expect(asked).toEqual([0x3d8fff]);
    scanPlaneVisual(vfx, [0.12, 0.5, 1.8]);
    expect(asked.at(-1)).toBeUndefined();
    expect(made.uColor.value.toArray()).toEqual([0.12, 0.5, 1.8]);
    // nonsense keeps the effect's default colour
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = fakePlaneVisual();
    scanPlaneVisual({ scanPlane: () => other.v }, [1, Number.NaN, 2] as never);
    expect(other.uColor.value.toArray()).toEqual([0.7, 0.9, 1.1]);
    scanPlaneVisual({ scanPlane: () => other.v }, undefined);
    expect(other.uColor.value.toArray()).toEqual([0.7, 0.9, 1.1]);
  });

  it('center: the plane reports where it stands, between from and to', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, 20);
    const plane = w.ai.devices.scanPlane({
      id: 'p', from: { x: -8, y: 0, z: -2 }, to: { x: 8, y: 0, z: -2 }, width: 6, height: 3, period: 4,
      source: { x: 0, y: 2, z: -12 }, color: [0.12, 0.5, 1.8],
    });
    expect(plane.center.x).toBeCloseTo(-8, 3);
    w.run(1);
    expect(plane.center.x).toBeCloseTo(0, 0);
    expect(plane.center.z).toBeCloseTo(-2, 6);
    w.run(1);
    expect(plane.center.x).toBeCloseTo(8, 0);
    plane.setActive(false);
    const x = plane.center.x;
    w.run(1);
    expect(plane.center.x).toBe(x);
  });

  it('a passive scan head is a destructible source with no beams and no detection of its own', () => {
    const w = makeAiWorld();
    w.arena();
    w.hero('selene', 0, -8);
    let seen = 0;
    const head = w.ai.devices.scanHead({
      id: 'z03-source', pos: { x: 0, y: 0, z: -14 }, yaw: Math.PI, passive: true, name: 'Scan projector', radius: 0.45,
      tags: ['z03Source'], onDetect: () => seen++,
    });
    const a = head.actor;
    expect(a.name).toBe('Scan projector');
    expect(a.radius).toBeCloseTo(0.45, 6);
    expect(a.targetable).toBe(true);
    for (const tag of ['device', 'objective', 'source', 'scanHead', 'z03Source']) expect(a.tags.has(tag)).toBe(true);
    // standing right in front of it in the open: nothing sees her
    w.run(8);
    expect(seen).toBe(0);
    expect(w.ai.stats.detections).toBe(0);
    expect(w.seen['scan:detected'] ?? []).toHaveLength(0);
    // a close interaction powers it down: once, as a scanHead
    head.disable(w.player.actor);
    head.disable(w.player.actor);
    expect(head.disabled).toBe(true);
    expect(a.targetable).toBe(false);
    expect(a.tags.has('objective')).toBe(false);
    expect((w.seen['device:disabled'] ?? []).filter((e) => e.id === 'z03-source')).toEqual([{ id: 'z03-source', kind: 'scanHead', by: w.player.actor }]);
    // destroyed through the damage path: the same single event
    const other = w.ai.devices.scanHead({ id: 'other', pos: { x: 6, y: 0, z: -14 }, yaw: 0, passive: true });
    w.actors.kill(other.actor, null);
    w.run(0.1);
    expect((w.seen['device:disabled'] ?? []).filter((e) => e.id === 'other')).toHaveLength(1);
    // the active head keeps its old behaviour (and its required numbers still work)
    const active = w.ai.devices.scanHead({ id: 'active', pos: { x: 0, y: 0, z: 14 }, yaw: 0, arcDeg: 80, range: 20, period: 4 });
    expect(active.actor.tags.has('scanHead')).toBe(true);
  });
});
