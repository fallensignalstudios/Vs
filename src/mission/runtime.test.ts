import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CineCtx, Interactable, Routine, StoryFlag, ZoneRuntime } from '@/core/api';
import { shotPose, twoShotPose } from './cinematic';
import { guarded } from './guard';
import { pickWaypoint } from './guidance';
import { createTestWorld, idle, spawnAtStart, zoneOf } from './testkit';

const errors = (): string[] => ((globalThis as { __aurelionErrors?: string[] }).__aurelionErrors ??= []);
afterEach(() => {
  errors().length = 0;
});

describe('cinematics', () => {
  /** a scene that changes state between waits, then gameplay continues */
  function sceneZone() {
    return zoneOf('Z00', [{
      id: 'a',
      enter: spawnAtStart,
      *run(z: ZoneRuntime): Routine {
        yield* z.cinematic('scene', function* (c: CineCtx): Routine {
          z.setFlag('step', 1);
          yield* c.move({ pos: z.P(0, 0, 2), look: z.P(0, 5, 1) }, 3);
          z.story('carrierRescued');
          yield* z.say('Tarrik', 'A line nobody sees when skipping.', { duration: 4 });
          yield [2, (function* (): Routine { yield 1; z.setFlag('parallel', true); })()];
          z.setFlag('step', 2);
          yield* z.fadeOut(1);
          z.setFlag('counter', (Number(z.flag('counter')) || 0) + 1);
          yield* z.fadeIn(1);
        });
        z.setFlag('after', true);
      },
    }]);
  }

  it('sets the stage for the scene and restores everything afterwards', async () => {
    const w = createTestWorld({ zones: [sceneZone()] });
    await w.mission.gotoZone('Z00');
    w.tick(0.5);
    expect(w.mission.cinematicActive).toBe(true);
    expect(w.mission.cinematicSkippable).toBe(true);
    expect([w.player.enabled, w.input.context, w.ui.hud, w.ui.letterbox, w.player.actor!.invulnerable]).toEqual([false, 'cinematic', false, true, true]);
    w.tick(14);
    expect(w.mission.cinematicActive).toBe(false);
    expect([w.player.enabled, w.input.context, w.ui.hud, w.ui.letterbox, w.player.actor!.invulnerable]).toEqual([true, 'game', true, false, false]);
    expect(w.eventsOf('cinematic:end')).toEqual([{ id: 'scene', skipped: false }]);
  });

  it('skipping applies exactly the state that watching does', async () => {
    const watched = createTestWorld({ zones: [sceneZone()] });
    await watched.mission.gotoZone('Z00');
    watched.tick(20);

    const skipped = createTestWorld({ zones: [sceneZone()] });
    await skipped.mission.gotoZone('Z00');
    skipped.tick(0.5);
    skipped.mission.skipCinematic();
    skipped.tick(0.2);

    expect(skipped.mission.cinematicActive).toBe(false);
    expect(skipped.mission.state.flags).toEqual(watched.mission.state.flags);
    expect(skipped.mission.state.flags).toEqual({ step: 2, carrierRescued: true, parallel: true, counter: 1, after: true });
    expect(skipped.eventsOf('cinematic:end')).toEqual([{ id: 'scene', skipped: true }]);
    expect([skipped.player.enabled, skipped.input.context, skipped.ui.hud, skipped.ui.fade]).toEqual([true, 'game', true, 0]);
    // the watched run showed the line; the skipped run never did
    expect(watched.ui.subtitles.filter(Boolean)).toHaveLength(1);
    expect(skipped.ui.subtitles.filter(Boolean)).toHaveLength(0);
  });

  it('holding skip for 0.8 s skips; an unskippable scene ignores it', async () => {
    const w = createTestWorld({ zones: [sceneZone()] });
    await w.mission.gotoZone('Z00');
    w.tick(0.3);
    w.input.held.skip = 0.5;
    w.tick(0.1);
    expect(w.mission.cinematicActive).toBe(true);
    w.input.held.skip = 0.85;
    w.tick(0.2);
    expect(w.mission.cinematicActive).toBe(false);

    const locked = createTestWorld({
      zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { yield* z.cinematic('held', function* (): Routine { yield 5; }, { skippable: false }); } }])],
    });
    await locked.mission.gotoZone('Z00');
    locked.tick(0.3);
    locked.input.held.skip = 2;
    locked.mission.skipCinematic();
    locked.tick(1);
    expect(locked.mission.cinematicActive).toBe(true);
    expect(locked.mission.cinematicSkippable).toBe(false);
  });

  it('a scene whose body throws still restores control', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = createTestWorld({
      zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { yield* z.cinematic('bad', function* (): Routine { yield 0.2; throw new Error('scene broke'); }); z.setFlag('after', true); } }])],
    });
    await w.mission.gotoZone('Z00');
    w.tick(1);
    spy.mockRestore();
    expect(w.mission.state.flags.after).toBe(true);
    expect([w.player.enabled, w.input.context, w.ui.letterbox]).toEqual([true, 'game', false]);
    expect(errors().some((e) => e.includes('cinematic:bad'))).toBe(true);
  });

  it('unloading the zone mid-scene restores control too', async () => {
    const w = createTestWorld({
      zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { yield* z.cinematic('long', function* (): Routine { yield 60; }); } }]), zoneOf('Z01', [{ id: 'a', enter: spawnAtStart, run: idle }])],
    });
    await w.mission.gotoZone('Z00');
    w.tick(0.5);
    await w.mission.gotoZone('Z01');
    expect([w.player.enabled, w.input.context, w.ui.letterbox, w.mission.cinematicActive]).toEqual([true, 'game', false, false]);
  });

  it('handoff swaps the lead inside a scene and emits handoff once, skipped or not', async () => {
    for (const skip of [false, true]) {
      const w = createTestWorld({ zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { yield* z.handoff('selene'); z.setFlag('after', true); yield* z.handoff('selene'); } }])] });
      await w.mission.gotoZone('Z00');
      w.tick(0.2);
      if (skip) w.mission.skipCinematic();
      w.tick(skip ? 0.3 : 6);
      expect(w.player.protagonist).toBe('selene');
      expect(w.eventsOf('handoff')).toEqual([{ from: 'tarrik', to: 'selene' }]);
      expect(w.mission.state.flags.after).toBe(true);
      expect(w.player.enabled).toBe(true);
    }
  });
});

describe('choice', () => {
  const choiceZone = () => zoneOf('Z07', [{
    id: 'choice',
    checkpoint: 'CP4b' as const,
    enter: spawnAtStart,
    *run(z: ZoneRuntime): Routine {
      const pick = yield* z.choice({ id: 'rescue', title: 'Local priority', prompt: 'Where?', options: [{ id: 'WestStretchers', label: 'West', detail: '' }, { id: 'EastWalkers', label: 'East', detail: '' }] });
      z.commitRescuePriority(pick as 'WestStretchers' | 'EastWalkers');
      z.commitRescuePriority(pick === 'EastWalkers' ? 'WestStretchers' : 'EastWalkers'); // a second commit must not flip it
      z.setFlag('acknowledged', pick);
      yield 1000;
    },
  }]);

  it('waits for the player with input disabled, records the answer and emits choice:made', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = createTestWorld({ zones: [choiceZone()] });
    await w.mission.gotoZone('Z07');
    w.tick(30);
    expect(w.mission.activeChoice).toMatchObject({ id: 'rescue', options: ['WestStretchers', 'EastWalkers'] });
    expect(w.player.enabled).toBe(false);
    expect(w.mission.state.rescuePriority).toBe('pending');
    w.mission.activeChoice!.select('nonsense');
    w.tick(0.2);
    expect(w.mission.activeChoice).not.toBeNull();
    w.mission.activeChoice!.select('EastWalkers');
    w.tick(0.2);
    warn.mockRestore();
    expect(w.mission.activeChoice).toBeNull();
    expect(w.player.enabled).toBe(true);
    expect(w.mission.state.rescuePriority).toBe('EastWalkers');
    expect(w.mission.state.flags).toMatchObject({ 'choice:rescue': 'EastWalkers', acknowledged: 'EastWalkers' });
    expect(w.eventsOf('choice:made')).toEqual([{ id: 'rescue', option: 'EastWalkers' }]);
  });

  it('commit happens exactly once and survives a checkpoint retry without asking again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = createTestWorld({ zones: [choiceZone()] });
    await w.mission.gotoZone('Z07');
    w.tick(0.2);
    w.mission.activeChoice!.select('WestStretchers');
    w.tick(0.2);
    expect(w.ui.choices).toHaveLength(1);
    await w.mission.reloadCheckpoint();
    w.tick(1);
    warn.mockRestore();
    expect(w.ui.choices).toHaveLength(1); // the panel was not shown again
    expect(w.mission.activeChoice).toBeNull();
    expect(w.mission.state.rescuePriority).toBe('WestStretchers');
    expect(w.eventsOf('choice:made')).toHaveLength(1);
    expect(w.mission.state.flags.acknowledged).toBe('WestStretchers');
  });

  it('a cinematic skip stops at an open choice, never answers it, and the scene resumes at normal speed', async () => {
    const zone = zoneOf('Z08', [{
      id: 'phaseB',
      enter: spawnAtStart,
      *run(z: ZoneRuntime): Routine {
        yield* z.cinematic('officer', function* (): Routine {
          yield* z.say('Tarrik', 'A line before the panel.', { duration: 4 });
          yield 6;
          const pick = yield* z.choice({ id: 'officerFate', title: 'The officer', prompt: '…', options: [{ id: 'killed', label: 'K', detail: '' }, { id: 'spared', label: 'S', detail: '' }] });
          z.setFlag('afterPick', pick);
          z.setFlag('skippingAfter', z.skipping);
          yield 3;
          z.setFlag('tail', true);
        });
      },
    }]);
    const w = createTestWorld({ zones: [zone] });
    await w.mission.gotoZone('Z08');
    w.tick(0.5);
    w.mission.skipCinematic();
    w.tick(30);
    // the skip ran up to the panel and stopped there: still in the scene, nothing answered
    expect(w.mission.cinematicActive).toBe(true);
    expect(w.mission.activeChoice).toMatchObject({ id: 'officerFate' });
    expect(w.mission.cinematicSkippable).toBe(false);
    w.input.held.skip = 2; // holding skip does nothing while the panel is open
    w.mission.skipCinematic();
    w.tick(1);
    w.input.held.skip = 0;
    expect(w.mission.activeChoice).not.toBeNull();
    expect(w.mission.state.flags.afterPick).toBeUndefined();
    w.mission.activeChoice!.select('spared');
    w.tick(0.2);
    // the rest of the scene plays normally (it can be skipped again)
    expect(w.mission.state.flags).toMatchObject({ afterPick: 'spared', skippingAfter: false, 'choice:officerFate': 'spared' });
    expect(w.mission.state.flags.tail).toBeUndefined();
    expect(w.mission.cinematicSkippable).toBe(true);
    w.tick(3.5);
    expect(w.mission.state.flags.tail).toBe(true);
    expect(w.mission.cinematicActive).toBe(false);
    expect(w.eventsOf('choice:made')).toEqual([{ id: 'officerFate', option: 'spared' }]);
  });

  it('automatic prompts never answer a choice', async () => {
    const w = createTestWorld({ zones: [choiceZone()] });
    const get = w.game.settings.get.bind(w.game.settings);
    (w.game.settings as { get: (k: string) => unknown }).get = (k: string) => (k === 'autoPrompts' ? true : get(k as never));
    await w.mission.gotoZone('Z07');
    w.tick(60);
    expect(w.mission.activeChoice).toMatchObject({ id: 'rescue' });
    expect(w.mission.state.rescuePriority).toBe('pending');
    expect(w.eventsOf('choice:made')).toHaveLength(0);
  });

  it('story() accepts only fixed story flags; setFlag cannot forge a recorded choice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = createTestWorld({
      zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine {
        z.story('pactAgreed');
        z.story('madeUp' as StoryFlag);
        z.setFlag('choice:rescue', 'EastWalkers');
        z.setFlag('local', 3);
        z.setFlag('meridianComplete', true);
        z.optionalDone('O2');
        z.optionalDone('O2');
      } }])],
    });
    await w.mission.gotoZone('Z00');
    w.tick(0.2);
    warn.mockRestore();
    expect(w.mission.state.flags).toEqual({ pactAgreed: true, local: 3, meridianComplete: true });
    expect(w.mission.state.optional).toEqual({ O1: false, O2: true, O3: false, O4: false });
    expect(w.ui.toasts).toHaveLength(1);
  });
});

describe('interactions, objectives, markers', () => {
  let handle: Interactable | null = null;
  const interactZone = (hold?: number) => zoneOf('Z00', [{
    id: 'a',
    enter: spawnAtStart,
    *run(z: ZoneRuntime): Routine {
      z.objective('Use the thing', 'far');
      handle = z.interact({ id: 'thing', at: z.P(1, 1), prompt: 'Use', hold, required: true, interruptible: true });
      yield z.untilInteract(handle);
      z.setFlag('used', true);
      z.objective(null);
    },
  }]);

  it('press interaction: prompt in range, completes on the button, emits interact:done', async () => {
    const w = createTestWorld({ zones: [interactZone()] });
    await w.mission.gotoZone('Z00');
    w.tick(0.2);
    expect(w.mission.interactables.map((i) => i.id)).toEqual(['thing']);
    expect(w.mission.objectiveText).toBe('Use the thing');
    expect(w.mission.objectiveMarker).toMatchObject({ x: 20, y: 0, z: -20 });
    expect(w.ui.prompts.at(-1)).toBe('Use');
    w.input.presses.add('interact');
    w.tick(0.2);
    expect(w.mission.state.flags.used).toBe(true);
    expect(w.eventsOf('interact:done')).toEqual([{ id: 'thing' }]);
    expect(w.mission.interactables).toHaveLength(0);
    expect(w.mission.objectiveText).toBeNull();
    expect(w.ui.prompts.at(-1)).toBeNull();
  });

  it('out of range or facing away shows no prompt and takes no input', async () => {
    const w = createTestWorld({ zones: [interactZone()] });
    await w.mission.gotoZone('Z00');
    w.player.actor!.pos.set(10, 0, 0);
    w.input.presses.add('interact');
    w.tick(0.2);
    expect(w.ui.prompts.filter(Boolean)).toHaveLength(0);
    w.player.actor!.pos.set(1, 0, 1.2); // south of it, facing north → facing it
    w.player.actor!.yaw = Math.PI; // turned round
    w.tick(0.2);
    expect(w.mission.state.flags.used).toBeUndefined();
    w.player.actor!.yaw = 0;
    w.tick(0.2);
    expect(w.mission.state.flags.used).toBe(true);
  });

  it('hold interaction fills, drains on release, is interrupted by damage, and complete() finishes it', async () => {
    const w = createTestWorld({ zones: [interactZone(2)] });
    await w.mission.gotoZone('Z00');
    w.tick(0.1);
    w.input.down.add('interact');
    w.tick(1);
    expect(handle!.progress).toBeGreaterThan(0.4);
    expect(handle!.done).toBe(false);
    w.game.events.emit('player:damaged', { amount: 5, dir: { x: 0, y: 0, z: 1 }, hit: {} as never });
    expect(handle!.progress).toBe(0);
    expect(w.input.down.has('interact')).toBe(false); // the latch was released
    w.input.down.add('interact');
    w.tick(1);
    w.input.down.delete('interact');
    w.tick(0.6);
    expect(handle!.progress).toBe(0);
    handle!.complete();
    handle!.complete();
    w.tick(0.1);
    expect(w.mission.state.flags.used).toBe(true);
    expect(w.eventsOf('interact:done')).toHaveLength(1);
  });

  it('unknown markers resolve to the player instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let at = { x: 1, y: 1, z: 1 };
    const w = createTestWorld({ zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { z.player.pos.set(3, 0, -4); at = z.m('missing'); yield z.untilNear('missing', 1); z.setFlag('near', true); } }])] });
    await w.mission.gotoZone('Z00');
    w.tick(0.2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(at).toMatchObject({ x: 3, y: 0, z: -4 });
    expect(w.mission.state.flags.near).toBe(true);
    expect(errors()).toEqual([]);
  });

  it('untilInRect uses plan coordinates (centre + size)', async () => {
    const w = createTestWorld({ zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { yield z.untilInRect(10, 20, 4, 6); z.setFlag('in', true); } }])] });
    await w.mission.gotoZone('Z00');
    w.player.actor!.pos.set(12.5, 0, -20);
    w.tick(0.2);
    expect(w.mission.state.flags.in).toBeUndefined();
    w.player.actor!.pos.set(11.9, 0, -22.9);
    w.tick(0.2);
    expect(w.mission.state.flags.in).toBe(true);
  });
});

describe('helpers', () => {
  it('shotPose places the camera on the requested compass bearing', () => {
    const north = shotPose({ x: 5, y: 0, z: -5 }, { yawDeg: 0, distance: 3, height: 1.5 });
    expect(north.pos).toMatchObject({ x: 5, y: 1.5 });
    expect(north.pos.z).toBeCloseTo(-8, 6); // north = −Z
    const east = shotPose({ x: 5, y: 0, z: -5 }, { yawDeg: 90, distance: 3 });
    expect(east.pos.x).toBeCloseTo(8, 6);
    expect(east.pos.z).toBeCloseTo(-5, 6);
    expect(east.look).toMatchObject({ x: 5, y: 1.45, z: -5 });
  });

  it('twoShotPose sits behind and beside `over`, at eye level, looking toward the subject', () => {
    const subject = { x: 0, y: 0, z: -4 };
    const over = { x: 0, y: 0, z: 0 };
    const right = twoShotPose(subject, over);
    expect(right.pos.z).toBeGreaterThan(1); // behind `over` as seen from the subject
    expect(right.pos.x).toBeGreaterThan(0.4); // right shoulder
    expect(right.pos.y).toBeCloseTo(1.62, 6);
    expect(right.look.z).toBeCloseTo(-4, 6);
    expect(right.look.x).toBeLessThan(0); // subject pushed onto the far third
    const left = twoShotPose(subject, over, { side: -1 });
    expect(left.pos.x).toBeCloseTo(-right.pos.x, 6);
    // coincident points do not produce NaN
    const same = twoShotPose(over, over);
    expect(Number.isFinite(same.pos.x) && Number.isFinite(same.look.z)).toBe(true);
  });

  it('pickWaypoint returns the first real corner, never the goal', () => {
    const p = (x: number, z: number) => ({ x, y: 0, z });
    expect(pickWaypoint([p(0, 0), p(10, 0)])).toBeNull();
    expect(pickWaypoint([p(0, 0), p(1, 0), p(6, 0), p(6, 8)])).toMatchObject({ x: 6, z: 0 });
    expect(pickWaypoint([p(0, 0), p(1, 0), p(1.5, 1)])).toBeNull();
  });

  it('guarded isolates a throwing nested routine and still runs finally blocks when stopped', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    function* bad(): Routine { yield 1; throw new Error('nested'); }
    function* outer(): Routine {
      try {
        yield bad();
        seen.push('continued');
        yield 5;
      } finally {
        seen.push('finally');
      }
    }
    const g = guarded(outer(), 'test');
    let r = g.next();
    // drive the yielded (guarded) child by hand the way the runner would
    const child = r.value as Generator<unknown, unknown, unknown>;
    child.next();
    expect(child.next().done).toBe(true);
    r = g.next();
    expect(seen).toEqual(['continued']);
    g.return(undefined);
    spy.mockRestore();
    expect(seen).toEqual(['continued', 'finally']);
    expect(errors().some((e) => e.includes('nested'))).toBe(true);
  });
});
