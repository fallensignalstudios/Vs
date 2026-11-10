import { afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CharacterVisual, CreatureArchetype, DeviceArchetype } from '@/core/api';
import {
  asCommandEmitter, asDevice, asDrone, asElite, asFrostAnchor, asScanHead, asWallrunner, asWeaver,
  CREATURE_ACTIONS, CREATURE_SOCKET_MAP,
} from '@/core/api/creatures';
import { createCreature, CREATURE_ARCHETYPES } from './index';
import { disposeTemplates } from './core/rig';

const ALL = CREATURE_ARCHETYPES;
const STEP = 1 / 60;

function run(v: CharacterVisual, seconds: number): void {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) v.update(STEP);
}

function mesh(v: CharacterVisual): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  v.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh; });
  if (!found) throw new Error('no skinned mesh');
  return found;
}

function finitePose(v: CharacterVisual): boolean {
  let ok = true;
  v.root.traverse((o) => {
    const p = o.position, q = o.quaternion, s = o.scale;
    if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].every(Number.isFinite)) ok = false;
  });
  return ok;
}

afterAll(() => disposeTemplates());

describe('creature + device visuals', () => {
  it('builds every archetype with a single skinned draw call inside budget', () => {
    expect(ALL.length).toBe(10);
    for (const a of ALL) {
      const v = createCreature(null, a);
      expect(v.archetype).toBe(a);
      expect(v.height).toBeGreaterThan(0.2);
      expect(v.radius).toBeGreaterThan(0.2);
      let meshes = 0;
      v.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
      expect(meshes).toBe(1); // spec: ≤ 3 draw calls
      const g = mesh(v).geometry;
      const tris = g.getAttribute('position').count / 3;
      expect(tris).toBeGreaterThan(200);
      expect(tris).toBeLessThan(a === 'elite' ? 30000 : 12000);
      for (const name of ['position', 'normal', 'color', 'aSurf', 'aPart', 'aSlide', 'skinIndex', 'skinWeight']) expect(g.getAttribute(name)).toBeTruthy();
      // every vertex is fully weighted to existing bones
      const sw = g.getAttribute('skinWeight'), si = g.getAttribute('skinIndex');
      const bones = mesh(v).skeleton.bones.length;
      for (let i = 0; i < sw.count; i += 97) {
        expect(sw.getX(i) + sw.getY(i)).toBeCloseTo(1, 4);
        expect(si.getX(i)).toBeLessThan(bones);
        expect(si.getY(i)).toBeLessThan(bones);
      }
      v.dispose();
    }
  });

  it('shares geometry between instances and keeps relay variants distinct', () => {
    const a = createCreature(null, 'secDrone'), b = createCreature(null, 'secDrone'), c = createCreature(null, 'contamDrone');
    expect(mesh(a).geometry).toBe(mesh(b).geometry);
    expect(mesh(a).geometry).not.toBe(mesh(c).geometry);
    expect(mesh(a).material).not.toBe(mesh(b).material);
    const r0 = createCreature(null, 'relayReceiver', { variant: 0 }), r1 = createCreature(null, 'relayReceiver', { variant: 1 });
    expect(mesh(r0).geometry).not.toBe(mesh(r1).geometry);
    expect(r1.height).toBeGreaterThan(r0.height);
    for (const v of [a, b, c, r0, r1]) v.dispose();
  });

  it('plays every documented action, any AnimAction and nonsense without throwing or producing NaN', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const extra = ['attackLight1', 'attackHeavy', 'hitLight', 'stagger', 'death', 'spawnBreach', 'linkedSync', 'frozen', 'hover', 'talk', 'definitely-not-an-action', ''];
    for (const a of ALL) {
      const v = createCreature(null, a, { seed: 3 });
      for (const action of [...CREATURE_ACTIONS[a], ...extra]) {
        const info = v.play(action);
        expect(info.duration).toBeGreaterThan(0);
        expect(Array.isArray(info.hitTimes)).toBe(true);
        expect(v.info(action).duration).toBeGreaterThan(0);
        expect(v.isPlaying(action)).toBe(true);
        run(v, 0.35);
        expect(finitePose(v)).toBe(true);
      }
      v.stop();
      run(v, 0.5);
      expect(v.isPlaying()).toBe(false);
      expect(finitePose(v)).toBe(true);
      v.dispose();
      v.dispose(); // idempotent
      v.update(STEP); // and inert afterwards
    }
    expect(warn).toHaveBeenCalled(); // unknown actions warn (once each) instead of throwing
    warn.mockRestore();
  });

  it('fires hit / release events at the advertised times and an end event', () => {
    const cases: [CreatureArchetype, string][] = [['elite', 'sweep'], ['elite', 'groundSlam'], ['elite', 'pulse'], ['secDrone', 'shoot'], ['weaver', 'pulse'], ['wallrunner', 'pounce']];
    for (const [a, action] of cases) {
      const v = createCreature(null, a);
      const events: [string, number][] = [];
      let t = 0;
      const info = v.play(action, { onEvent: (e) => events.push([e, t]) });
      const n = Math.ceil((info.duration + 0.2) / STEP);
      for (let i = 0; i < n; i++) { t += STEP; v.update(STEP); }
      const hits = events.filter(([e]) => e === 'hit' || e === 'release');
      expect(hits.length).toBe(info.hitTimes.length);
      hits.forEach(([, at], i) => expect(Math.abs(at - info.hitTimes[i]!)).toBeLessThan(0.04));
      expect(events.some(([e]) => e === 'end')).toBe(true);
      v.dispose();
    }
  });

  it('interrupted actions do not deliver their remaining hits; a throwing handler is contained', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createCreature(null, 'elite');
    let hits = 0;
    v.play('groundSlam', { onEvent: (e) => { if (e === 'hit') hits++; } });
    run(v, 0.5);
    v.play('stagger');
    run(v, 3);
    expect(hits).toBe(0);
    v.play('sweep', { onEvent: () => { throw new Error('boom'); } });
    expect(() => run(v, 2)).not.toThrow();
    v.dispose();
    warn.mockRestore();
  });

  it('exposes the documented sockets and falls back to the root', () => {
    for (const a of ALL) {
      const v = createCreature(null, a);
      v.update(STEP);
      for (const s of CREATURE_SOCKET_MAP[a]) {
        const o = v.socket(s);
        expect(o).not.toBe(v.root);
        expect(o).toBeInstanceOf(THREE.Object3D);
      }
      expect(v.socket('no-such-socket')).toBe(v.root);
      v.dispose();
    }
  });

  it('accepts garbage on every setter', () => {
    for (const a of ALL) {
      const v = createCreature(null, a, { scale: Number.NaN, seed: -5, corruption: 7 });
      expect(() => {
        v.setLocomotion(Number.NaN, Number.NaN);
        v.setLocomotion(-3, 99, { sprint: true });
        v.lookAt({ x: Number.NaN, y: 0, z: 0 });
        v.lookAt({ x: 4, y: 2, z: -6 });
        v.setAimPitch(Number.POSITIVE_INFINITY);
        v.flash(0xffffff, -1);
        v.setFrozen(Number.NaN); v.setFrozen(5);
        v.setCorruption(-2); v.setDissolve(9, 0xff00ff);
        v.setGlow(Number.NaN); v.setTelegraph(3, 0xff0000); v.setRim(-1);
        v.setExposed('nonsense', 4); v.setExposed('joint', 1); v.setExposed('vent', 1);
        v.setLoadout({ melee: true }); v.setVisible(false); v.setVisible(true);
        v.update(Number.NaN); v.update(-1); v.update(10);
        run(v, 0.3);
      }).not.toThrow();
      expect(finitePose(v)).toBe(true);
      v.dispose();
    }
  });

  it('never throws for an unknown archetype', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createCreature(null, 'notACreature' as unknown as DeviceArchetype);
    expect(v.root).toBeInstanceOf(THREE.Object3D);
    v.update(STEP);
    v.dispose();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('extensions', () => {
  it('as*() helpers match the right archetypes only', () => {
    const elite = createCreature(null, 'elite'), drone = createCreature(null, 'secDrone'), scan = createCreature(null, 'scanHead');
    expect(asElite(elite)).not.toBeNull();
    expect(asElite(drone)).toBeNull();
    expect(asDrone(drone)).not.toBeNull();
    expect(asWallrunner(drone)).toBeNull();
    expect(asWeaver(elite)).toBeNull();
    expect(asDevice(scan)).not.toBeNull();
    expect(asScanHead(scan)).not.toBeNull();
    expect(asDevice(elite)).toBeNull();
    expect(asCommandEmitter(scan)).toBeNull();
    expect(asFrostAnchor(null)).toBeNull();
    for (const v of [elite, drone, scan]) v.dispose();
  });

  it('wallrunner: cling lifts the body off the floor and a pounce brings it back down', () => {
    const v = createCreature(null, 'wallrunner');
    const w = asWallrunner(v)!;
    const core = v.socket('core');
    run(v, 0.2);
    const y0 = core.getWorldPosition(new THREE.Vector3()).y;
    w.setCling({ height: 4, wallYaw: 0 }, 0.2);
    expect(w.clinging).toBe(true);
    run(v, 0.6);
    const p1 = core.getWorldPosition(new THREE.Vector3());
    expect(p1.y).toBeGreaterThan(3);
    expect(p1.z).toBeLessThan(-0.2); // pushed off the wall along its outward normal (yaw 0 → −Z)
    w.setCling({ height: 5 }, 0.2); // ceiling
    run(v, 0.6);
    expect(core.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(5);
    expect(core.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(4);
    const events: string[] = [];
    v.play('pounce', { onEvent: (e) => events.push(e) });
    run(v, 1.6);
    expect(events).toEqual(expect.arrayContaining(['launch', 'hit', 'land', 'end']));
    expect(w.clinging).toBe(false);
    expect(Math.abs(core.getWorldPosition(new THREE.Vector3()).y - y0)).toBeLessThan(0.25);
    w.setCling({ height: Number.NaN });
    expect(w.clinging).toBe(false);
    v.dispose();
  });

  it('elite: fracture is sticky until cleared, footfalls report while walking, joint socket rides the shoulder', () => {
    const v = createCreature(null, 'elite');
    const e = asElite(v)!;
    expect(e.fractured).toBe(false);
    const steps: string[] = [];
    e.onFootfall = (side) => steps.push(side);
    v.setLocomotion(2.5, 0);
    run(v, 3);
    expect(steps.length).toBeGreaterThan(2);
    expect(steps).toContain('L');
    expect(steps).toContain('R');
    v.setLocomotion(0);
    const j0 = v.socket('joint').getWorldPosition(new THREE.Vector3());
    expect(j0.y).toBeGreaterThan(2.4);
    expect(j0.x).toBeGreaterThan(0.5); // the creature's right shoulder
    v.play('fracture');
    run(v, 3.6);
    expect(e.fractured).toBe(true);
    e.setFractured(false);
    expect(e.fractured).toBe(false);
    e.setRegenerating(1);
    run(v, 0.5);
    expect(finitePose(v)).toBe(true);
    v.dispose();
  });

  it('drone death drops the hull by its hover height; devices power down and break apart', () => {
    const d = createCreature(null, 'secDrone');
    asDrone(d)!.setHoverHeight(2);
    d.root.position.y = 2;
    d.update(STEP);
    d.play('death');
    run(d, 2.4);
    expect(d.socket('core').getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.4);
    expect(d.socket('core').getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(-0.05);
    d.dispose();

    for (const a of ['commandEmitter', 'relayReceiver', 'scanHead', 'weaverAnchor', 'frostAnchor'] as DeviceArchetype[]) {
      const v = createCreature(null, a);
      const dev = asDevice(v)!;
      expect(dev.disabled).toBe(false);
      dev.setDisabled(true);
      run(v, 1.5);
      expect(dev.disabled).toBe(true);
      dev.setDisabled(false);
      v.play('disabled');
      expect(dev.disabled).toBe(true);
      const top0 = v.socket('top').getWorldPosition(new THREE.Vector3());
      v.play('death');
      run(v, 2.4);
      expect(finitePose(v)).toBe(true);
      if (a !== 'frostAnchor' && a !== 'weaverAnchor') expect(v.socket('top').getWorldPosition(new THREE.Vector3()).distanceTo(top0)).toBeGreaterThan(0.3);
      v.dispose();
    }
  });

  it('weaver link arms reach for their targets; command emitter prongs track theirs', () => {
    const w = createCreature(null, 'weaver');
    run(w, 0.3);
    const hand = w.socket('handR');
    const target = new THREE.Vector3(-6, 1, -6);
    const d0 = hand.getWorldPosition(new THREE.Vector3()).distanceTo(target);
    asWeaver(w)!.setLinkTarget(0, target);
    asWeaver(w)!.setLinkTarget(9, target); // ignored
    run(w, 1.5);
    expect(hand.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(d0 - 0.4);
    asWeaver(w)!.setLinkTarget(0, null);
    asWeaver(w)!.setSlack(1);
    run(w, 1);
    expect(finitePose(w)).toBe(true);
    w.dispose();

    const e = createCreature(null, 'commandEmitter');
    const ce = asCommandEmitter(e)!;
    ce.setProngTarget(1, { x: 8, y: 1.8, z: -1 });
    ce.pulseSync();
    run(e, 1.5);
    const tip = e.socket('prongR').getWorldPosition(new THREE.Vector3());
    expect(tip.x).toBeGreaterThan(0.5); // swung toward +X
    e.dispose();
  });
});
