/**
 * Action state machine + robustness: terminal death, additive reactions, freeze / thaw, auto dissolve,
 * isPlaying semantics, and every bad-input path that used to latch a NaN pose.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CharacterVisual, CreatureArchetype } from '@/core/api';
import { asCommandEmitter, asCreature, asDevice, asElite } from '@/core/api/creatures';
import { createCreature, CREATURE_ARCHETYPES } from './index';
import type { StateUniforms } from './core/shader';
import { disposeTemplates } from './core/rig';
import { finitePose, run, STEP } from './testkit';

afterAll(() => disposeTemplates());

const dissolve = (v: CharacterVisual): number => (v as unknown as { u: StateUniforms }).u.uDissolve.value;
const frost = (v: CharacterVisual): number => (v as unknown as { u: StateUniforms }).u.uFrozen.value;
const y = (v: CharacterVisual, socket = 'core'): number => v.socket(socket).getWorldPosition(new THREE.Vector3()).y;

describe('death is terminal', () => {
  const bodies: CreatureArchetype[] = ['elite', 'weaver', 'wallrunner', 'secDrone'];

  it('late hits, stray actions, stop() and lookAt() leave a corpse exactly as it lies', () => {
    for (const a of bodies) {
      const v = createCreature(null, a);
      if (a === 'secDrone') v.root.position.y = 1.8;
      run(v, 0.3);
      const alive = y(v);
      v.play('death');
      run(v, 6);
      const lying = y(v), gone = dissolve(v);
      expect(lying, a).toBeLessThan(alive - 0.15);
      expect(gone, a).toBe(a === 'secDrone' ? 0 : 1); // Eclipse bodies dissolve; machines stay as wreckage
      for (const act of ['hitLight', 'hitHeavy', 'stagger', 'idle', 'sweep', 'shoot', 'talk']) v.play(act);
      v.stop();
      v.stop('death');
      v.lookAt({ x: 3, y: 2, z: -5 });
      run(v, 1.5);
      expect(y(v), a).toBeCloseTo(lying, 2);
      expect(dissolve(v), a).toBe(gone);
      expect(asCreature(v)!.dead, a).toBe(true);
      expect(v.isPlaying('death'), a).toBe(true);
      v.dispose();
    }
  });

  it('revive() and a spawn both bring it back standing, visible and idle', () => {
    for (const a of bodies) {
      const v = createCreature(null, a);
      if (a === 'secDrone') v.root.position.y = 1.8;
      run(v, 0.3);
      const alive = y(v);
      v.play('death');
      run(v, 6);
      asCreature(v)!.revive();
      run(v, 0.5);
      expect(asCreature(v)!.dead).toBe(false);
      expect(dissolve(v), a).toBe(0);
      expect(v.isPlaying(), a).toBe(false);
      expect(Math.abs(y(v) - alive), a).toBeLessThan(0.12);
      v.play('death');
      run(v, 6);
      v.play('spawnBreach'); // alias of spawn
      expect(asCreature(v)!.dead).toBe(false);
      run(v, 4);
      expect(dissolve(v), a).toBe(0);
      expect(Math.abs(y(v) - alive), a).toBeLessThan(0.12);
      v.dispose();
    }
  });

  it('a spawn interrupted by a hit keeps materialising; interrupted by another action it eases out, never snaps', () => {
    for (const a of ['weaver', 'wallrunner', 'elite'] as const) {
      const v = createCreature(null, a);
      v.play('spawn');
      run(v, 0.25);
      const mid = dissolve(v);
      expect(mid, a).toBeGreaterThan(0.4);
      v.play('hitLight'); // additive: the spawn carries on
      v.update(STEP);
      expect(Math.abs(dissolve(v) - mid), a).toBeLessThan(0.08);
      v.play('stagger'); // a main action: the spawn fades, and its dissolve fades with it
      let prev = dissolve(v), worst = 0;
      run(v, 1.2, () => { const d = dissolve(v); worst = Math.max(worst, prev - d); prev = d; });
      expect(worst, a).toBeLessThan(0.08);
      expect(dissolve(v), a).toBe(0);
      v.dispose();
    }
  });
});

describe('reactions are additive', () => {
  it('a boss that is chip-hit all the way through its slam still delivers the slam', () => {
    const v = createCreature(null, 'elite');
    const events: [string, number][] = [];
    let t = 0;
    v.play('groundSlam', { onEvent: (e) => events.push([e, t]) });
    run(v, 3.4, (dt) => {
      t = dt;
      if (Math.abs((t * 10) % 3) < STEP * 10 && t < 2.5) v.play(t % 0.6 < 0.3 ? 'hitLight' : 'hitHeavy');
    });
    const hit = events.find(([e]) => e === 'hit');
    expect(hit).toBeDefined();
    expect(Math.abs(hit![1] - 1.62)).toBeLessThan(0.03);
    expect(events.map(([e]) => e)).toEqual(expect.arrayContaining(['step', 'impact', 'end']));
    v.dispose();
  });

  it('a drone volley delivers all three bolts through hits; only a main action cancels them', () => {
    const fire = (interrupt: string): number => {
      const v = createCreature(null, 'secDrone');
      let n = 0;
      v.play('volley', { onEvent: (e) => { if (e === 'release') n++; } });
      run(v, 0.15);
      v.play(interrupt);
      run(v, 1.2);
      v.dispose();
      return n;
    };
    expect(fire('hitLight')).toBe(3);
    expect(fire('hitHeavy')).toBe(3);
    expect(fire('stagger')).toBe(1);
  });

  it('isPlaying: main actions only by default, idle is the absence of one, unknown gestures keep their own name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createCreature(null, 'elite');
    expect(v.isPlaying()).toBe(false);
    expect(v.isPlaying('idle')).toBe(true);
    for (const alias of ['frozen', 'hover', 'idle']) {
      v.play(alias);
      run(v, 3);
      expect(v.isPlaying(), alias).toBe(false); // an idle alias never leaves a slot running forever
    }
    v.play('sweep');
    expect(v.isPlaying()).toBe(true);
    expect(v.isPlaying('idle')).toBe(false);
    expect(v.isPlaying('attackLight1')).toBe(true); // alias of sweep
    v.play('hitLight');
    expect(v.isPlaying('hitLight')).toBe(true);
    expect(v.isPlaying('sweep')).toBe(true);
    v.play('idle'); // clears the main action
    run(v, 0.6);
    expect(v.isPlaying()).toBe(false);
    v.play('talk');
    expect(v.isPlaying('talk')).toBe(true);
    expect(v.isPlaying('salute')).toBe(false);
    expect(v.isPlaying()).toBe(false); // a gesture is a reaction, not a main action
    // rapid combos never pop: hammer it and require a continuous pose
    const core = v.socket('core'), p = new THREE.Vector3(), q = new THREE.Vector3();
    core.getWorldPosition(p);
    let jump = 0;
    for (let i = 0; i < 90; i++) {
      if (i % 4 === 0) v.play(['sweep', 'charge', 'roar', 'stagger', 'pulse'][(i / 4) % 5]!);
      v.update(STEP);
      core.getWorldPosition(q);
      jump = Math.max(jump, q.distanceTo(p));
      p.copy(q);
    }
    expect(jump).toBeLessThan(0.2);
    v.dispose();
    warn.mockRestore();
  });

  it('roar advertises its release; action steps reach onFootfall', () => {
    const v = createCreature(null, 'elite');
    expect(v.info('roar').hitTimes).toEqual([0.62]);
    const steps: string[] = [];
    asElite(v)!.onFootfall = (side) => steps.push(side);
    for (const act of ['sweep', 'groundSlam', 'roar', 'pulse', 'fracture']) {
      const before = steps.length;
      v.play(act);
      run(v, v.info(act).duration + 0.3);
      expect(steps.length, act).toBeGreaterThan(before);
    }
    v.dispose();
  });
});

describe('freeze', () => {
  it('a stasis kill dies on schedule: events fire, the body drops, the frost shatters, Eclipse bodies dissolve', () => {
    for (const a of ['wallrunner', 'elite', 'weaver', 'secDrone'] as const) {
      const v = createCreature(null, a);
      if (a === 'secDrone') v.root.position.y = 1.8;
      v.setFrozen(1);
      run(v, 0.5);
      const frozenY = y(v);
      const events: string[] = [];
      v.play('death', { onEvent: (e) => events.push(e) });
      run(v, 6, () => v.setFrozen(1)); // the AI keeps asking for the stasis: death must still win
      expect(events, a).toEqual(expect.arrayContaining(['impact', 'end']));
      expect(y(v), a).toBeLessThan(frozenY - 0.15);
      expect(frost(v), a).toBe(0);
      if (a !== 'secDrone') expect(dissolve(v), a).toBe(1);
      v.dispose();
    }
  });

  it('a hit on a fully frozen body recoils and recovers instead of sticking', () => {
    const v = createCreature(null, 'secDrone');
    v.setFrozen(1);
    run(v, 0.3);
    v.play('hitLight');
    run(v, 2);
    expect(v.isPlaying('hitLight')).toBe(false);
    v.dispose();
  });

  it('Thermal Fracture keeps its advertised timing with the joint arrested, and thaws it', () => {
    const v = createCreature(null, 'elite');
    v.setExposed('joint', 1);
    v.setFrozen(0.3);
    run(v, 0.5);
    expect(frost(v)).toBeCloseTo(0.3, 5);
    const events: [string, number][] = [];
    let t = 0;
    const info = v.play('fracture', { onEvent: (e) => events.push([e, t]) });
    run(v, 4, (dt) => { t = dt; });
    const at = (name: string): number => events.find(([e]) => e === name)![1];
    expect(Math.abs(at('impact') - 1.3)).toBeLessThan(0.03);
    expect(Math.abs(at('end') - info.duration)).toBeLessThan(0.03);
    expect(frost(v)).toBe(0);
    v.setFrozen(0); // release …
    v.setFrozen(0.5); // … and a fresh arrest shows again
    run(v, 0.2);
    expect(frost(v)).toBeCloseTo(0.5, 5);
    v.dispose();
  });
});

describe('bad input never latches', () => {
  const nan = Number.NaN;

  it('non-finite fade / speed / seconds and a null options bag', () => {
    for (const a of CREATURE_ARCHETYPES) {
      const v = createCreature(null, a);
      run(v, 0.1);
      expect(() => {
        v.play('hitLight', { fade: nan, speed: nan });
        v.play('stagger', { fade: nan });
        v.play('idle', { fade: nan });
        v.play('stagger', null as unknown as undefined);
        v.play('stagger', { fade: Number.POSITIVE_INFINITY, speed: -2, onEvent: 5 as unknown as () => void });
        v.stop(undefined, nan);
        v.flash(nan, nan);
        v.setRim(nan, nan); v.setTelegraph(nan, nan); v.setDissolve(nan, nan);
        run(v, 0.8);
      }).not.toThrow();
      expect(finitePose(v), a).toBe(true);
      const u = (v as unknown as { u: StateUniforms }).u;
      for (const vec of [u.uFlash.value, u.uRim.value, u.uTelegraph.value]) expect(Number.isFinite(vec.x + vec.y + vec.z + vec.w), a).toBe(true);
      v.dispose();
    }
  });

  it('non-finite world targets on every extension setter', () => {
    const e = createCreature(null, 'commandEmitter'), ce = asCommandEmitter(e)!;
    for (const bad of [{ x: nan, y: 0, z: 0 }, {} as { x: number; y: number; z: number }, { x: 1, y: Number.POSITIVE_INFINITY, z: 0 }]) {
      ce.setProngTarget(0, bad);
      ce.setProngTarget(1, bad);
      ce.pulseSync(nan);
      run(e, 0.4);
      expect(finitePose(e)).toBe(true);
    }
    ce.setProngTarget(0, null);
    run(e, 0.4);
    expect(finitePose(e)).toBe(true);
    const tip = e.socket('prongL').getWorldPosition(new THREE.Vector3());
    expect(Number.isFinite(tip.x + tip.y + tip.z)).toBe(true);
    e.dispose();
  });

  it('a root scaled to zero for a few frames (a spawn scale-in) leaves nothing broken behind', () => {
    for (const a of CREATURE_ARCHETYPES) {
      const v = createCreature(null, a);
      const holder = new THREE.Group();
      holder.add(v.root);
      run(v, 0.2);
      for (const s of [0, 0, 0, 1e-9, 0.2, 1]) {
        holder.scale.setScalar(s);
        v.root.scale.setScalar(s === 0 ? 0 : 1);
        v.update(STEP);
        v.update(STEP);
      }
      v.root.scale.setScalar(1);
      run(v, 0.5);
      expect(finitePose(v), a).toBe(true);
      v.dispose();
    }
  });

  it('a non-finite pose from any source is healed on the next update', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const a of ['elite', 'wallrunner', 'weaver', 'contamDrone', 'commandEmitter'] as const) {
      const v = createCreature(null, a);
      run(v, 0.2);
      // poison persistent animation state directly, as a future bug or a hostile caller might
      const inner = v as unknown as Record<string, unknown>;
      for (const k of ['gait', 'walk', 'slackNow', 'twitch', 'spin', 'headYaw']) if (typeof inner[k] === 'number') inner[k] = nan;
      (inner as { speed: number }).speed = nan;
      run(v, 0.3);
      expect(finitePose(v), a).toBe(true);
      v.dispose();
    }
    warn.mockRestore();
  });

  it('device disabled state survives stop(), and a dead device ignores everything', () => {
    const v = createCreature(null, 'relayReceiver');
    const d = asDevice(v)!;
    v.play('disabled');
    v.stop();
    run(v, 0.5);
    expect(d.disabled).toBe(true);
    d.setDisabled(false);
    v.play('death');
    run(v, 3);
    const dish = y(v, 'dish');
    v.play('hitLight'); v.play('idle'); v.stop();
    run(v, 1);
    expect(y(v, 'dish')).toBeCloseTo(dish, 3);
    v.dispose();
  });
});
