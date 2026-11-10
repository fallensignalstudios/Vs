import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_ACTIONS, isHumanoidVisual, type HumanoidArchetype } from '@/core/api';
import { createHumanoid } from './index';
import { listActions, listArchetypes } from './debug';

const ALL: HumanoidArchetype[] = ['tarrik', 'selene', 'lyessa', 'tharne', 'lyric', 'malik', 'dominionSoldier', 'reformationSoldier',
  'reformationMarine', 'enforcer', 'medic', 'survivor', 'linkbound', 'kingWitness', 'cross', 'sol'];

function finite(root: THREE.Object3D): boolean {
  let ok = true;
  root.traverse((o) => {
    const e = o.matrixWorld.elements;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) ok = false;
  });
  return ok;
}

describe('humanoid figures', () => {
  it('registers every archetype in the contract', () => {
    expect(listArchetypes().sort()).toEqual([...ALL].sort());
  });

  it('builds every archetype within budget', () => {
    for (const a of ALL) {
      const v = createHumanoid(null, a);
      expect(isHumanoidVisual(v)).toBe(true);
      expect(v.archetype).toBe(a);
      expect(v.height).toBeGreaterThan(1.5);
      expect(v.height).toBeLessThan(2.2);
      expect(v.triangles).toBeGreaterThan(5000);
      expect(v.triangles).toBeLessThan(60000);
      // ≤ 3 draw calls per character including weapons: one level of detail, the shadow caster, an overlay
      let meshes = 0;
      v.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes++; });
      expect(meshes).toBeLessThanOrEqual(3);
      const g = (v.root.getObjectByName('body') as THREE.SkinnedMesh).geometry;
      const w = g.getAttribute('skinWeight');
      for (let i = 0; i < w.count; i += 37) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 4);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i += 11) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      v.dispose();
    }
  });

  it('plays every contract action on every archetype without NaN or throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const a of ALL) {
      const v = createHumanoid(null, a, { seed: 3 });
      const actions = new Set<string>([...HUMANOID_ACTIONS, ...listActions(a)]);
      for (const act of actions) {
        const events: string[] = [];
        const info = v.play(act, { onEvent: (n) => events.push(n) });
        expect(info.duration).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < 26; i++) v.update(1 / 20);
        expect(finite(v.root)).toBe(true);
        if (!info.loop && Number.isFinite(info.duration) && info.duration > 0 && info.duration < 1.3) expect(events).toContain('end');
        v.stop();
        v.update(0.3);
      }
      v.dispose();
    }
    warn.mockRestore();
  }, 120000);

  it('honours the combat timing contract', () => {
    const t = createHumanoid(null, 'tarrik');
    const near = (x: number, y: number, tol: number): void => expect(Math.abs(x - y)).toBeLessThanOrEqual(tol);
    near(t.info('attackLight1').duration, 0.55, 0.001);
    near(t.info('attackLight2').duration, 0.6, 0.001);
    near(t.info('attackLight3').duration, 0.75, 0.001);
    near(t.info('attackHeavy').duration, 1.05, 0.001);
    near(t.info('counter').duration, 0.5, 0.001);
    near(t.info('dodge').duration, 0.45, 0.001);
    for (const a of ['attackLight1', 'attackLight2', 'attackLight3']) near(t.info(a).hitTimes[0] / t.info(a).duration, 0.45, 0.02);
    near(t.info('attackHeavy').hitTimes[0] / 1.05, 0.55, 0.02);
    const s = createHumanoid(null, 'selene');
    for (const a of ['attackLight1', 'attackLight2', 'attackLight3', 'attackLight4']) {
      expect(s.info(a).duration).toBeGreaterThanOrEqual(0.32);
      expect(s.info(a).duration).toBeLessThanOrEqual(0.45);
      expect(s.info(a).hitTimes.length).toBeGreaterThan(0);
    }
    near(s.info('attackHeavy').duration, 0.7, 0.001);
    near(s.info('dodge').duration, 0.45, 0.001);
    expect(s.info('deflect').duration).toBeGreaterThanOrEqual(0.45);
    // play() reports speed-scaled timing
    const half = t.play('attackHeavy', { speed: 2 });
    near(half.duration, 0.525, 0.001);
  });

  it('fires hit / end events at the advertised times', () => {
    const t = createHumanoid(null, 'tarrik');
    const log: Array<[string, number]> = [];
    let clock = 0;
    const info = t.play('attackLight1', { onEvent: (n) => log.push([n, clock]) });
    for (let i = 0; i < 120; i++) { clock += 1 / 120; t.update(1 / 120); }
    const hit = log.find((e) => e[0] === 'hit');
    const end = log.find((e) => e[0] === 'end');
    expect(hit).toBeDefined();
    expect(Math.abs(hit![1] - info.hitTimes[0])).toBeLessThan(0.02);
    expect(Math.abs(end![1] - info.duration)).toBeLessThan(0.02);
    expect(t.isPlaying('attackLight1')).toBe(false);
  });

  it('falls back gracefully on bad input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createHumanoid(null, 'notAnArchetype' as HumanoidArchetype);
    expect(v.root).toBeInstanceOf(THREE.Object3D);
    const info = v.play('definitelyNotAnAction');
    expect(info.duration).toBeGreaterThan(0);
    expect(v.socket('nope')).toBe(v.root);
    v.setExposed('nope', 2);
    v.setFrozen(NaN); v.setDissolve(7); v.setCorruption(-3); v.setGlow(NaN); v.setRim(9); v.setTelegraph(NaN);
    v.setLocomotion(NaN, NaN); v.setAimPitch(NaN); v.lookAt({ x: NaN, y: 0, z: 0 }); v.update(NaN); v.update(-1); v.update(5);
    // @ts-expect-error deliberately wrong
    v.setLoadout(null);
    v.setLoadout({ prop: 'banana' as 'case' });
    v.update(1 / 60);
    expect(finite(v.root)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    v.dispose(); v.dispose(); v.update(0.1);
  });

  it('sockets follow equipment through loadout changes', () => {
    const t = createHumanoid(null, 'tarrik');
    t.update(1 / 60);
    const held = t.socket('weaponTip').getWorldPosition(new THREE.Vector3());
    t.setLoadout({ melee: false });
    t.update(1 / 60);
    const sheathed = t.socket('weaponTip').getWorldPosition(new THREE.Vector3());
    expect(held.distanceTo(sheathed)).toBeGreaterThan(0.4);
    // drawing the sidearm sheathes the sword even if melee stays true
    t.setLoadout({ melee: true, ranged: true });
    t.update(1 / 60);
    expect(t.socket('weaponTip').getWorldPosition(new THREE.Vector3()).distanceTo(sheathed)).toBeLessThan(0.25);
    const muzzle = t.socket('muzzle').getWorldPosition(new THREE.Vector3());
    const hand = t.socket('handR').getWorldPosition(new THREE.Vector3());
    expect(muzzle.distanceTo(hand)).toBeLessThan(0.5);
  });

  it('keeps the off hand on a two-handed weapon and pins hands to world targets', () => {
    const t = createHumanoid(null, 'tarrik');
    for (let i = 0; i < 30; i++) t.update(1 / 60);
    const l = t.socket('handL').getWorldPosition(new THREE.Vector3());
    const r = t.socket('handR').getWorldPosition(new THREE.Vector3());
    expect(l.distanceTo(r)).toBeLessThan(0.24); // both hands on the grip
    const s = createHumanoid(null, 'tharne');
    const target = new THREE.Vector3(0.1, 1.0, -0.45);
    s.setHandTarget('R', target);
    for (let i = 0; i < 90; i++) s.update(1 / 60);
    expect(s.socket('handR').getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(0.03);
    s.setHandTarget('R', null);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(s.socket('handR').getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeGreaterThan(0.3);
  });

  it('plants feet in world space while travelling (no skating)', () => {
    for (const [who, speed] of [['tarrik', 2.2], ['tarrik', 5.2], ['selene', 5.2], ['selene', 7.2], ['dominionSoldier', 3.6]] as const) {
      const v = createHumanoid(null, who);
      v.setLoadout({ melee: false, ranged: false });
      v.setLocomotion(speed, 0);
      const dt = 1 / 120;
      const toe = v.root.getObjectByName('toeL')!;
      const p = new THREE.Vector3(), prev = new THREE.Vector3();
      const drifts: number[] = [];
      let planted = 0;
      for (let i = 0; i < 120 * 4; i++) {
        v.root.position.z -= speed * dt;
        v.update(dt);
        toe.getWorldPosition(p);
        // the ball of the foot is down: it must stay where it is while the body passes over it
        if (i > 120 && p.y < 0.05 * (v.height / 1.85) && prev.y < 0.05 * (v.height / 1.85)) {
          drifts.push(Math.hypot(p.x - prev.x, p.z - prev.z) / dt);
          planted++;
        }
        prev.copy(p);
      }
      expect(planted).toBeGreaterThan(30);
      drifts.sort((a, b) => a - b);
      const median = drifts[Math.floor(drifts.length / 2)], p90 = drifts[Math.floor(drifts.length * 0.9)];
      expect(median).toBeLessThan(speed * 0.04);
      expect(p90).toBeLessThan(speed * 0.2);
      v.dispose();
    }
  }, 60000);

  it('holds its pose while frozen and resumes after', () => {
    const t = createHumanoid(null, 'selene');
    t.setLocomotion(5, 0);
    for (let i = 0; i < 30; i++) t.update(1 / 60);
    t.setFrozen(1);
    t.update(1 / 60);
    const a = t.socket('handL').getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 30; i++) t.update(1 / 60);
    expect(t.socket('handL').getWorldPosition(new THREE.Vector3()).distanceTo(a)).toBeLessThan(1e-4);
    t.setFrozen(0);
    for (let i = 0; i < 10; i++) t.update(1 / 60);
    expect(t.socket('handL').getWorldPosition(new THREE.Vector3()).distanceTo(a)).toBeGreaterThan(0.01);
  });

  it('is deterministic per seed and varies between seeds', () => {
    const count = (seed: number): number => createHumanoid(null, 'survivor', { seed }).triangles;
    expect(count(4)).toBe(count(4));
    const hs = new Set([1, 2, 3, 4, 5, 6].map((s) => createHumanoid(null, 'survivor', { seed: s }).height.toFixed(3)));
    expect(hs.size).toBeGreaterThan(3);
  });
});
