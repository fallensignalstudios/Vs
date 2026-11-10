import { describe, expect, it } from 'vitest';
import { BARK_STALE_SECONDS, barkIsFresh, lineDuration } from './dialogue';
import { createTestWorld, idle, spawnAtStart, zoneOf } from './testkit';
import type { Routine, ZoneRuntime } from '@/core/api';

describe('dialogue duration', () => {
  it('is clamp(1.6 + 0.055 × chars, 2, 8)', () => {
    expect(lineDuration('')).toBe(2);
    expect(lineDuration('No.')).toBe(2);
    expect(lineDuration('x'.repeat(20))).toBeCloseTo(2.7, 6);
    expect(lineDuration('x'.repeat(60))).toBeCloseTo(4.9, 6);
    expect(lineDuration('x'.repeat(110))).toBeCloseTo(7.65, 6);
    expect(lineDuration('x'.repeat(400))).toBe(8);
  });

  it('never returns a non-finite duration for bad input', () => {
    expect(lineDuration(undefined as unknown as string)).toBe(2);
    expect(lineDuration(null as unknown as string)).toBe(2);
  });

  it('barks go stale after six seconds in the queue', () => {
    expect(barkIsFresh(10, 10 + BARK_STALE_SECONDS)).toBe(true);
    expect(barkIsFresh(10, 10.01 + BARK_STALE_SECONDS)).toBe(false);
  });
});

describe('dialogue in a zone', () => {
  const zone = (run: (z: ZoneRuntime) => Routine) => zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, run }, { id: 'b', run: idle }]);

  it('say blocks for the line duration, then clears', async () => {
    const w = createTestWorld({ zones: [zone(function* (z) { yield* z.say('Lyessa', 'x'.repeat(20)); z.setFlag('said', true); })] });
    await w.mission.gotoZone('Z00');
    w.tick(2.5);
    expect(w.ui.subtitles).toEqual(['x'.repeat(20)]);
    expect(w.mission.state.flags.said).toBeUndefined();
    w.tick(0.4);
    expect(w.mission.state.flags.said).toBe(true);
    expect(w.ui.subtitles.at(-1)).toBeNull();
    const line = w.eventsOf('dialogue:line')[0].line;
    expect(line.duration).toBeCloseTo(2.7, 6);
    expect(w.eventsOf('dialogue:clear')).toHaveLength(1);
  });

  it('an explicit duration wins, and confirm advances a line only after one second', async () => {
    const w = createTestWorld({ zones: [zone(function* (z) { yield* z.say('Tarrik', 'Hold.', { duration: 6 }); z.setFlag('said', true); })] });
    await w.mission.gotoZone('Z00');
    w.input.presses.add('confirm');
    w.tick(0.5);
    expect(w.mission.state.flags.said).toBeUndefined();
    w.tick(0.7);
    expect(w.mission.state.flags.said).toBe(true);
  });

  it('barks play one at a time, at most three wait, stale ones are dropped', async () => {
    const w = createTestWorld({
      zones: [zone(function* (z) {
        for (const n of ['one', 'two', 'three', 'four', 'five']) z.bark('Lyessa', n, { duration: 4 });
        yield 100;
      })],
    });
    await w.mission.gotoZone('Z00');
    w.tick(30);
    // "one" shows at once; "two" follows at 4 s; "three" would start at 8 s but has waited more than 6 s
    expect(w.ui.subtitles.filter((s) => s !== null)).toEqual(['one', 'two']);
  });

  it('a blocking line takes the stage from a bark', async () => {
    const w = createTestWorld({
      zones: [zone(function* (z) {
        z.bark('Lyessa', 'bark', { duration: 5 });
        yield 1;
        yield* z.say('Tarrik', 'line', { duration: 2 });
      })],
    });
    await w.mission.gotoZone('Z00');
    w.tick(4);
    expect(w.ui.subtitles).toEqual(['bark', null, 'line', null]);
  });
});

describe('voice-over hand-off', () => {
  function world(clipSeconds: number) {
    const calls: string[] = [];
    const audio = new Proxy({
      voice: (speaker: string, text: string, o?: { channel?: string }) => { calls.push(`voice:${speaker}:${text}:${o?.channel}`); return clipSeconds; },
      stopVoice: (fade?: number) => { calls.push(`stop:${fade}`); },
      speak: (speaker: string) => { calls.push(`speak:${speaker}`); },
    } as Record<string, unknown>, { get: (t, p) => (p in t ? t[p as string] : () => undefined) });
    const z = zoneOf('Z00', [{
      id: 'a',
      enter: spawnAtStart,
      *run(rt: ZoneRuntime): Routine {
        yield* rt.cinematic('scene', function* (): Routine {
          yield* rt.say('Selene', 'Hold the plane.', { channel: 'radio' });
          rt.setFlag('said', true);
        });
      },
    }]);
    return { w: createTestWorld({ zones: [z], overrides: { audio } }), calls };
  }

  it('a voiced line lasts as long as its clip plus a short tail and does not play the comm tick', async () => {
    const { w, calls } = world(5);
    await w.mission.gotoZone('Z00');
    w.tick(5.1);
    expect(calls).toEqual(['voice:Selene:Hold the plane.:radio']);
    expect(w.eventsOf('dialogue:line')[0].line.duration).toBeCloseTo(5.25, 6);
    expect(w.mission.state.flags.said).toBeUndefined();
    w.tick(0.4);
    expect(w.mission.state.flags.said).toBe(true);
    expect(calls).toHaveLength(1); // a line that ran its course does not call stopVoice
  });

  it('without a clip the comm tick plays and the text length sets the duration', async () => {
    const { w, calls } = world(0);
    await w.mission.gotoZone('Z00');
    w.tick(1);
    expect(calls).toEqual(['voice:Selene:Hold the plane.:radio', 'speak:Selene']);
    expect(w.eventsOf('dialogue:line')[0].line.duration).toBeCloseTo(lineDuration('Hold the plane.'), 6);
  });

  it('skipping the scene cuts the voice', async () => {
    const { w, calls } = world(5);
    await w.mission.gotoZone('Z00');
    w.tick(1);
    w.mission.skipCinematic();
    w.tick(0.2);
    expect(calls).toEqual(['voice:Selene:Hold the plane.:radio', 'stop:0.15']);
    expect(w.mission.state.flags.said).toBe(true);
  });
});
