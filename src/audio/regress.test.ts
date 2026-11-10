/**
 * Regression tests for the faults found in review: sliders that did not silence their buses, loops that
 * failed silently, one NaN re-triggering the score every frame, the source budget, and the sample path.
 * (Levels and spectra are measured in the browser by the sandbox report; these run in node on the fake.)
 */
import { describe, expect, it, vi } from 'vitest';
import type { Game, GameEvents, LoopHandle } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { createAudioSystem } from './index';
import { AudioEngine } from './engine';
import { SFX } from './sfx';
import { MUSIC } from './music/defs';
import { PERC_TIERS, PERC_TUNE, percSampleId } from './music/instruments';
import { waveNeeds } from './prerender';
import { MAX_LOOPS, NULL_LOOP } from './voices';
import { SampleBank } from './synth/samples';
import { ENSEMBLES, waveOctave } from './synth/waves';
import { FakeBuffer, FakeContext, FakeNode, FakeSource } from './testing/fake-context';
import type { PercInst } from './music/types';

function engineOn(ctx: FakeContext): AudioEngine {
  return new AudioEngine(ctx.asContext(), { seed: 99 });
}

function run(ctx: FakeContext, engine: AudioEngine, seconds: number, dt = 0.05, each?: (t: number) => void): void {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.currentTime += dt;
    each?.(ctx.currentTime);
    engine.update(dt);
  }
}

const node = (n: AudioNode): FakeNode => n as unknown as FakeNode;
const buffer = (seconds: number, level = 0.5): AudioBuffer => {
  const b = new FakeBuffer(1, Math.floor(seconds * 44100), 44100);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = level * Math.sin((2 * Math.PI * 440 * i) / 44100);
  return b as unknown as AudioBuffer;
};

function fakeGame(): Game & { events: Emitter<GameEvents> } {
  const events = new Emitter<GameEvents>();
  const base = {
    events,
    settings: new SettingsStoreImpl(events),
    time: { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} },
    flags: { zone: null, beat: null, checkpoint: null, debug: false, autoplay: false, mute: false, nopost: false, quality: null, manual: true, seed: 1 },
    ai: nullObject('ai'),
    mission: nullObject('mission'),
  };
  return base as unknown as Game & { events: Emitter<GameEvents> };
}

/** Run `fn` with a fake AudioContext constructor installed; hands back the context the façade created. */
function withFakeAudio(fn: (ctx: () => FakeContext) => void): void {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const saved = g.AudioContext;
  let made: FakeContext | null = null;
  g.AudioContext = class extends FakeContext {
    constructor() {
      super();
      made = this;
    }
  };
  try {
    fn(() => made as unknown as FakeContext);
  } finally {
    g.AudioContext = saved;
  }
}

describe('every path to the output passes its bus fader', () => {
  it('mixer inputs are all pre-fader', () => {
    const ctx = new FakeContext();
    const m = engineOn(ctx).mixer;
    const f = m.faders;
    const cases: Array<[string, AudioNode, GainNode[]]> = [
      ['sfx', m.sfx, [f.world]], ['amb', m.amb, [f.world]], ['near', m.near, [f.world]], ['room', m.room, [f.world]],
      ['ui', m.ui, [f.ui]], ['uiSend', m.uiSend, [f.ui]],
      ['music', m.music, [f.music]], ['musicDrums', m.musicDrums, [f.music]], ['musicDirect', m.musicDirect, [f.music]], ['scoreSend', m.scoreSend, [f.music]], ['scoreRoom', m.scoreRoom, [f.music]],
      // dialogue's dry path and its room send both follow the SFX slider
      ['voice', m.voice, [f.voice, f.world]],
    ];
    for (const [name, input, faders] of cases) {
      expect(ctx.reaches(node(input), new Set()), `${name} is connected`).toBe(true);
      expect(ctx.reaches(node(input), new Set(faders.map(node))), `${name} bypasses its fader`).toBe(false);
      expect(ctx.reaches(node(input), new Set([node(f.master)])), `${name} bypasses the master`).toBe(false);
    }
  });

  it('no source in a busy scene can be heard with the four bus faders closed', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    engine.setIntensity(1, true);
    engine.setMusic('elite', 0.2);
    engine.setAmbience('crucible', 0.2);
    engine.loop('droneHum', { pos: { x: 2, y: 1, z: -3 } });
    engine.loop('footStone');
    run(ctx, engine, 3, 0.05, (t) => {
      if (Math.abs(t - 1) < 0.026) {
        engine.play('explosionLarge', { pos: { x: 5, y: 0, z: -9 } });
        engine.play('verityHit');
        engine.play('uiCheckpoint');
        engine.speak('Terminal', 'system');
        engine.stinger('revelation');
        engine.cadenceTick({ x: 1, y: 1, z: 1 });
      }
    });
    const f = engine.mixer.faders;
    const closed = new Set([f.world, f.ui, f.voice, f.music].map(node));
    const sources = ctx.all.filter((n) => n instanceof FakeSource);
    expect(sources.length).toBeGreaterThan(100);
    const leaks = sources.filter((s) => ctx.reaches(s, closed));
    expect(leaks.map((s) => s.nodeType)).toEqual([]);
    // and they ARE connected when the faders are open (the test would be vacuous otherwise)
    expect(sources.filter((s) => ctx.reaches(s, new Set())).length).toBeGreaterThan(sources.length * 0.5);
    expect(ctx.problems).toEqual([]);
  });

  it('a positional cue at the listener sends exactly what the same cue sends non-positionally', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setListener({ x: 4, y: 1, z: 2 }, { x: 0, y: 0, z: -1 });
    const sendsInto = (bus: AudioNode): number[] =>
      ctx.all.filter((n) => n.nodeType === 'GainNode' && n.outputs.has(node(bus))).map((n) => (n as unknown as GainNode).gain.value);
    const before = new Set(ctx.all);
    engine.play('explosionLarge');
    const flat = ctx.all.filter((n) => !before.has(n) && n.nodeType === 'GainNode' && n.outputs.has(node(engine.mixer.room))).map((n) => (n as unknown as GainNode).gain.value);
    ctx.currentTime += 5;
    const mid = new Set(ctx.all);
    engine.play('explosionLarge', { pos: { x: 4, y: 1, z: 2 } });
    const at = ctx.all.filter((n) => !mid.has(n) && n.nodeType === 'GainNode' && n.outputs.has(node(engine.mixer.room))).map((n) => (n as unknown as GainNode).gain.value);
    expect(flat).toHaveLength(1);
    expect(at).toEqual(flat);
    expect(sendsInto(engine.mixer.room).length).toBeGreaterThanOrEqual(2);
  });
});

describe('loops are never lost', () => {
  it('clear() then loop() in the same tick yields a voice', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    const ids = ['eliteRegen', 'liftMove', 'emitterHum'];
    ids.forEach((id) => engine.loop(id));
    run(ctx, engine, 1);
    expect(engine.voices.loopCounts.sounding).toBe(3);
    engine.clear();
    const again = ids.map((id) => engine.loop(id));
    expect(again.every((h) => h !== NULL_LOOP)).toBe(true);
    expect(engine.voices.loopCounts).toEqual({ sounding: 3, requested: 3 });
    run(ctx, engine, 2);
    expect(engine.voices.loopCounts).toEqual({ sounding: 3, requested: 3 });
    expect(ctx.problems).toEqual([]);
  });

  it('nine drone hums: six sound, and the other three take over when those stop', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const hums: LoopHandle[] = [];
    for (let i = 0; i < 9; i++) hums.push(engine.loop('droneHum', { pos: { x: 0, y: 1, z: -(3 + i * 4) } }));
    run(ctx, engine, 1);
    expect(SFX.droneHum.max).toBe(6);
    expect(engine.voices.loopCounts).toEqual({ sounding: 6, requested: 9 });
    // the six nearest are the ones sounding: stop exactly those
    for (let i = 0; i < 6; i++) hums[i].stop(0.2);
    run(ctx, engine, 1);
    expect(engine.voices.loopCounts).toEqual({ sounding: 3, requested: 3 });
    for (const h of hums) h.stop(0.1);
    run(ctx, engine, 1);
    expect(engine.voices.count).toBe(0);
    expect(ctx.spans.filter((s) => s.stop === Infinity)).toHaveLength(0);
  });

  it('over the global cap the nearest loops sound, and the ranking follows the listener', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    const ids = ['droneHum', 'linkHum', 'eclipseBreath', 'relayHum', 'scanSweep', 'emitterHum', 'weaverChant'];
    let n = 0;
    for (const id of ids) for (let i = 0; i < Math.min(SFX[id].max, 4); i++) engine.loop(id, { pos: { x: 0, y: 0, z: -(2 + 3 * n++) } });
    expect(n).toBeGreaterThan(MAX_LOOPS);
    run(ctx, engine, 1);
    expect(engine.voices.loopCounts).toEqual({ sounding: MAX_LOOPS, requested: n });
    const startsBefore = ctx.spans.length;
    // walk to the far end: the far loops must come alive, the near ones go quiet — and still only 14 sound
    engine.setListener({ x: 0, y: 0, z: -(2 + 3 * n) }, { x: 0, y: 0, z: -1 });
    run(ctx, engine, 2);
    expect(engine.voices.loopCounts.sounding).toBe(MAX_LOOPS);
    expect(ctx.spans.length).toBeGreaterThan(startsBefore + 10);
    engine.clear();
    run(ctx, engine, 1.5);
    expect(engine.voices.count).toBe(0);
    expect(ctx.problems).toEqual([]);
  });
});

describe('bad numbers never reach the scheduler', () => {
  it('NaN cadence irregularity is ignored and the score keeps its normal density', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setMusic('breach', 0.2);
    run(ctx, engine, 3, 1 / 60);
    const a = ctx.spans.length;
    run(ctx, engine, 2, 1 / 60);
    const normal = ctx.spans.length - a;
    engine.music.setIrregular(NaN);
    engine.setIntensity(NaN);
    const b = ctx.spans.length;
    run(ctx, engine, 2, 1 / 60);
    expect(ctx.spans.length - b).toBeLessThan(normal * 1.6 + 12);
    expect(engine.music.irregular).toBe(0);
    expect(ctx.problems).toEqual([]);
  });

  it('a layer that throws is retired; the clock, the other layers and the ambience carry on', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    engine.setIntensity(0.5, true);
    engine.setMusic('breach', 0.2);
    engine.setAmbience('breach', 0.2);
    run(ctx, engine, 2, 1 / 60);
    // poison the cadence layer the way a NaN would: every noise source it starts now throws
    const fake = ctx as unknown as { createBufferSource: () => FakeNode };
    const real = fake.createBufferSource.bind(ctx);
    let throwing = true;
    fake.createBufferSource = () => {
      if (throwing) throw new TypeError('non-finite');
      return real();
    };
    const before = ctx.spans.length;
    expect(() => run(ctx, engine, 3, 1 / 60)).not.toThrow();
    // oscillator-only layers kept playing, but nothing re-triggered every frame (180 frames went by)
    const during = ctx.spans.length - before;
    expect(during).toBeGreaterThan(0);
    expect(during).toBeLessThan(120);
    throwing = false;
    const after = ctx.spans.length;
    run(ctx, engine, 6, 1 / 60);
    expect(ctx.spans.length).toBeGreaterThan(after + 5);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('disabled after repeated failures'))).toBe(true);
    warn.mockRestore();
  });

  it('LoopHandle setters swallow non-finite input', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    const h = engine.loop('droneHum', { pos: { x: 1, y: 1, z: 1 } });
    run(ctx, engine, 0.5);
    expect(() => {
      h.setVolume(0.5, NaN);
      h.setVolume(0.5, Infinity);
      h.setVolume(NaN);
      h.setVolume(0.5, -3);
      h.setPitch(Infinity);
      h.setPosition({ x: NaN, y: 0, z: 0 });
      h.stop(NaN);
    }).not.toThrow();
    run(ctx, engine, 1);
    expect(ctx.problems).toEqual([]);
  });

  it('a starved scheduler skips whole steps: the beat keeps its phase and never bursts', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setIntensity(1, true);
    engine.setMusic('combatTarrik', 0.2);
    run(ctx, engine, 4, 1 / 60);
    const step = 60 / MUSIC.combatTarrik.bpm / 4;
    const grid = engine.music.activeDeck!.startAt;
    const offGrid = (from: number): number => {
      let worst = 0;
      // taiko strokes start on the grid (+ up to 8 ms of humanisation); bows and anvils exactly on it
      for (const s of ctx.spans) {
        if (s.start < from || s.kind !== 'buffer') continue;
        const p = ((s.start - grid) / step) % 1;
        worst = Math.max(worst, Math.min(p, 1 - p) * step);
      }
      return worst;
    };
    expect(offGrid(1)).toBeLessThan(0.012);
    // how many sources two beats of this music normally start (the live path: several per stroke)
    const mark = ctx.spans.length;
    run(ctx, engine, 2 * 4 * step, 1 / 60);
    const twoBeats = ctx.spans.length - mark;
    const before = ctx.spans.length;
    ctx.currentTime += 2.5; // far longer than the look-ahead: the scheduler is truly starved
    engine.update(2.5);
    // the catch-up schedules one horizon (two beats or so) plus a re-voicing of the harmony — not the 2.5 s it missed
    expect(ctx.spans.length - before).toBeLessThan(twoBeats * 2 + 40);
    const resumed = ctx.currentTime;
    run(ctx, engine, 3, 1 / 60);
    expect(offGrid(resumed)).toBeLessThan(0.012);
    expect(ctx.problems).toEqual([]);
  });

  it('schedules at least a second ahead, yet a state change still lands on the very next bar line', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setMusic('approachTarrik', 0.2);
    run(ctx, engine, 5.3, 1 / 60);
    const outgoing = engine.music.activeDeck!;
    expect(outgoing.frontier - ctx.currentTime).toBeGreaterThanOrEqual(1 - 0.05);
    const bar = outgoing.barDur;
    engine.setMusic('combatTarrik', 2);
    const incoming = engine.music.activeDeck!;
    // on the outgoing state's bar grid, and no further away than one bar (never waiting for the look-ahead)
    const bars = (incoming.startAt - outgoing.startAt) / bar;
    expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
    expect(incoming.startAt).toBeGreaterThan(ctx.currentTime);
    expect(incoming.startAt - ctx.currentTime).toBeLessThanOrEqual(Math.min(bar, 2.6) + 1e-3);
    // the outgoing deck stops scheduling at that bar line
    expect(outgoing.endAt).toBeCloseTo(incoming.startAt, 6);
  });
});

describe('sample path', () => {
  it('a registered recording replaces the recipe with one source, and can be removed again', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    const count = (): number => ctx.spans.length;
    let n = count();
    engine.play('eliteRoar');
    const live = count() - n;
    expect(live).toBeGreaterThan(3);
    ctx.currentTime += 10;
    engine.registerSample('eliteRoar', buffer(1.5));
    n = count();
    expect(engine.play('eliteRoar')).toBeCloseTo(1.5, 1);
    expect(count() - n).toBe(1);
    expect(ctx.spans[ctx.spans.length - 1].kind).toBe('buffer');
    ctx.currentTime += 10;
    engine.unregisterSample('eliteRoar');
    n = count();
    engine.play('eliteRoar');
    expect(count() - n).toBe(live);
    expect(ctx.problems).toEqual([]);
  });

  it('an id that only exists as a recording is playable; a silent buffer is refused', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(engine.play('vo:tarrik_3fa9c21e')).toBe(0);
    engine.registerSample('vo:tarrik_3fa9c21e', buffer(2.2));
    expect(engine.play('vo:tarrik_3fa9c21e', { pos: { x: 1, y: 1, z: -2 } })).toBeCloseTo(2.2, 1);
    engine.registerSample('footStone', buffer(0.2, 0));
    expect(engine.samples.isRegistered('footStone')).toBe(false);
    warn.mockRestore();
    expect(ctx.problems).toEqual([]);
  });

  it('a recording under loop() sustains as one looping source and stops cleanly', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.registerSample('droneHum', buffer(3));
    const n = ctx.spans.length;
    const h = engine.loop('droneHum', { pos: { x: 0, y: 1, z: -4 } });
    run(ctx, engine, 2);
    expect(ctx.spans.length - n).toBe(1);
    h.setPitch(1.4);
    h.stop(0.2);
    run(ctx, engine, 1);
    expect(ctx.spans.filter((s) => s.stop === Infinity)).toHaveLength(0);
    expect(ctx.problems).toEqual([]);
  });

  it('the bank never picks the same variant twice running, and recordings win over pre-renders', () => {
    const bank = new SampleBank();
    const bufs = [buffer(0.1), buffer(0.2), buffer(0.3)];
    bank.setBaked(new Map([['x', bufs]]));
    let seed = 1;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) % 1000) / 1000;
    let last: AudioBuffer | null = null;
    for (let i = 0; i < 60; i++) {
      const s = bank.pick('x', rnd)!;
      expect(s.buffer).not.toBe(last);
      last = s.buffer;
    }
    const rec = buffer(1);
    bank.register('x', rec);
    expect(bank.pick('x', rnd)!.buffer).toBe(rec);
    bank.unregister('x');
    expect(bufs).toContain(bank.pick('x', rnd)!.buffer);
    expect(bank.pick('nothing', rnd)).toBeNull();
  });

  it('exact (Eclipse) cues draw the same random numbers on every play', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    const shape = (id: string): string => {
      const n = ctx.spans.length;
      engine.play(id);
      const t0 = ctx.currentTime;
      const made = ctx.spans.slice(n).map((s) => `${s.kind}@${(s.start - t0).toFixed(5)}+${s.offset.toFixed(6)}-${(s.stop - t0).toFixed(5)}`);
      ctx.currentTime += 20;
      engine.update(0.05);
      return made.join('|');
    };
    for (const id of Object.keys(SFX).filter((k) => SFX[k].exact && !SFX[k].loop)) {
      const first = shape(id);
      engine.play('footStone'); // something else draws from the shared generator in between
      ctx.currentTime += 5;
      expect(shape(id), id).toBe(first);
    }
    // … whereas an ordinary cue is different every time
    expect(shape('footStone')).not.toBe(shape('footStone'));
  });
});

describe('source budget once pre-rendering has landed', () => {
  it('the score stays within ~40 live sources at full intensity', () => {
    const report: string[] = [];
    const ctx0 = new FakeContext();
    const waves = engineOn(ctx0).res.waves;
    try {
      for (const key of waveNeeds()) waves.set(key, { buffer: buffer(2), baseHz: 55 * Math.pow(2, Number(key.split('@')[1])) });
      const perc = new Map<string, AudioBuffer[]>();
      for (const inst of Object.keys(PERC_TUNE) as PercInst[]) {
        const tunes = new Set<number>([PERC_TUNE[inst]]);
        for (const def of Object.values(MUSIC)) for (const l of def.layers) if (l.kind === 'perc' && l.inst === inst && l.tune) tunes.add(l.tune);
        for (const tune of tunes) PERC_TIERS.forEach((_v, tier) => perc.set(percSampleId(inst, tune, tier), [buffer(inst === 'odaiko' || inst === 'boom' ? 0.8 : 0.3)]));
      }
      for (const state of ['combatTarrik', 'combatSelene', 'combatEclipse', 'elite', 'duel', 'carrier', 'witness', 'title'] as const) {
        const ctx = new FakeContext();
        const engine = engineOn(ctx);
        engine.samples.setBaked(perc);
        engine.setIntensity(1, true);
        engine.setMusic(state, 0.5);
        run(ctx, engine, 40, 1 / 30);
        expect(ctx.problems, state).toEqual([]);
        const poly = ctx.maxPolyphony(2, 40);
        report.push(`${state}:${poly}`);
        expect(poly, `${state} live sources`).toBeLessThanOrEqual(44);
      }
    } finally {
      waves.clear();
    }
    console.log(`score live sources with pre-rendered percussion and ensembles: ${report.join(' ')}`);
  });

  it('every ensemble the score asks for has a definition and a sane register', () => {
    const needs = [...waveNeeds()];
    expect(needs.length).toBeGreaterThan(6);
    for (const key of needs) {
      const [name, oct] = key.split('@');
      expect(name in ENSEMBLES, key).toBe(true);
      expect(Number(oct)).toBeGreaterThanOrEqual(0);
      expect(Number(oct)).toBeLessThanOrEqual(5);
    }
    expect(waveOctave(55)).toBe(0);
    expect(waveOctave(110)).toBe(1);
    expect(waveOctave(150)).toBe(1);
    expect(waveOctave(160)).toBe(2);
  });
});

describe('façade', () => {
  it('getters report what is actually playing, not an unknown id that was asked for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = createAudioSystem(fakeGame());
    audio.setMusic('bogus' as never);
    audio.setAmbience('nowhere' as never);
    audio.setMusic(undefined as never);
    expect(audio.music).toBe('silence');
    expect(audio.ambience).toBe('none');
    expect(audio.debugInfo()).toMatchObject({ music: 'silence', ambience: 'none' });
    audio.setMusic('title');
    expect(audio.music).toBe('title');
    warn.mockRestore();
  });

  it('remembers cadence state, loops and recordings requested before unlock', () => {
    withFakeAudio((made) => {
      const audio = createAudioSystem(fakeGame());
      audio.setMusic('combatEclipse');
      audio.stinger('sever');
      audio.registerSample('eliteRoar', buffer(1));
      const hum = audio.loop('linkHum', { pos: { x: 1, y: 1, z: -3 } });
      hum.setVolume(0.6);
      expect(audio.debugInfo()).toMatchObject({ cadenceIrregular: 1, loopsRequested: 1, samples: 1, loops: 0 });
      audio.unlock();
      expect(audio.debugInfo()).toMatchObject({ unlocked: true, music: 'combatEclipse', cadenceIrregular: 1, loops: 1, loopsRequested: 1, samples: 1 });
      audio.setCadenceIrregular(NaN);
      expect(audio.debugInfo().cadenceIrregular).toBe(1);
      audio.setCadenceIrregular(0);
      expect(audio.debugInfo().cadenceIrregular).toBe(0);
      expect(made().problems).toEqual([]);
    });
  });

  it('dispose() detaches from the game, closes the context and stays silent', () => {
    withFakeAudio((made) => {
      const game = fakeGame();
      const audio = createAudioSystem(game);
      audio.unlock();
      audio.setMusic('title');
      const spans = made().spans.length;
      audio.dispose();
      audio.dispose();
      expect(made().state).toBe('closed');
      expect(audio.unlocked).toBe(false);
      // events no longer reach it, calls are harmless
      game.events.emit('checkpoint:saved', { id: 'CP1' });
      game.events.emit('dialogue:line', { line: { speaker: 'Tarrik', text: 'Hold.' } });
      audio.play('swingHeavy');
      audio.setMusic('combatTarrik');
      audio.unlock();
      audio.update(0.016);
      expect(audio.loop('droneHum')).toBe(NULL_LOOP);
      expect(made().spans.length).toBe(spans);
    });
  });

  it('a zone that restarts its hums right after zone:loading gets them all back', () => {
    withFakeAudio((made) => {
      const game = fakeGame();
      const audio = createAudioSystem(game);
      audio.unlock();
      const ids = ['eliteRegen', 'emitterHum', 'liftMove'] as const;
      ids.forEach((id) => audio.loop(id));
      for (let i = 0; i < 30; i++) { made().currentTime += 1 / 60; audio.update(1 / 60); }
      expect(audio.debugInfo().loops).toBe(3);
      game.events.emit('zone:loading', { zone: 'Z08' });
      ids.forEach((id) => audio.loop(id));
      for (let i = 0; i < 60; i++) { made().currentTime += 1 / 60; audio.update(1 / 60); }
      expect(audio.debugInfo()).toMatchObject({ loops: 3, loopsRequested: 3 });
      expect(made().problems).toEqual([]);
    });
  });
});
