/**
 * Whole-subsystem tests in node. There is no WebAudio here, so:
 *  - the façade must be a silent no-op that still tracks requested state;
 *  - the engine is exercised against a strict fake context (testing/fake-context.ts) that validates every
 *    automation call and records source lifetimes — catching the bugs that only surface in a browser.
 * Audible verification (levels, spectra, clipping) is done by the sandbox through OfflineAudioContext.
 */
import { describe, expect, it, vi } from 'vitest';
import API from '../core/api/audio.ts?raw';
import type { DialogueLine, Game, GameEvents, MusicState } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { createAudioSystem } from './index';
import { AudioEngine } from './engine';
import { SFX } from './sfx';
import { MUSIC } from './music/defs';
import { STINGER_KINDS } from './music/stingers';
import { cycleBars, parsePattern } from './music/theory';
import { AMBIENCE } from './ambience/defs';
import { speakCue, speakerVoice } from './speak';
import { MAX_VOICES } from './voices';
import { FakeContext } from './testing/fake-context';

/** string literals of an exported union type in the api file */
function union(name: string): string[] {
  const m = new RegExp(`export type ${name} =([\\s\\S]*?);\\n`).exec(API);
  if (!m) throw new Error(`type ${name} not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

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

function engineOn(ctx: FakeContext): AudioEngine {
  return new AudioEngine(ctx.asContext(), { seed: 99 });
}

/** advance the fake clock, calling update like the game loop would */
function run(ctx: FakeContext, engine: AudioEngine, seconds: number, dt = 0.05, each?: (t: number) => void): void {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.currentTime += dt;
    each?.(ctx.currentTime);
    engine.update(dt);
  }
}

describe('contract coverage', () => {
  it('has a recipe for every SfxId in the api file', () => {
    const missing = union('SfxId').filter((id) => !(id in SFX));
    expect(missing).toEqual([]);
  });

  it('has a definition for every MusicState and AmbienceId', () => {
    expect(union('MusicState').filter((s) => s !== 'silence' && !(s in MUSIC))).toEqual([]);
    expect(union('AmbienceId').filter((s) => s !== 'none' && !(s in AMBIENCE))).toEqual([]);
  });

  it('documents exactly the loop-designed ids in the api header', () => {
    const m = /LOOPS: ids designed to sustain under loop\(\): ([^.]+)\./.exec(API);
    expect(m).not.toBeNull();
    const documented = m![1].replace(/\s*\*\s*/g, ' ').split(',').map((s) => s.trim()).sort();
    const actual = Object.keys(SFX).filter((id) => SFX[id].loop).sort();
    expect(documented).toEqual(actual);
  });
});

describe('definitions are well formed', () => {
  it('sfx recipes have sane mix metadata', () => {
    for (const [id, r] of Object.entries(SFX)) {
      expect(r.db, id).toBeLessThanOrEqual(-4);
      expect(r.db, id).toBeGreaterThanOrEqual(-34);
      expect(r.gap, id).toBeGreaterThan(0);
      expect(r.max, id).toBeGreaterThanOrEqual(1);
      expect(r.send, id).toBeLessThanOrEqual(1);
      expect([0, 1, 2, 3], id).toContain(r.prio);
    }
  });

  it('eclipse voices are unnaturally identical (no pitch variation)', () => {
    for (const id of ['eclipseBreath', 'eclipseLunge', 'eclipseDeath', 'wallrunnerSkitter', 'wallrunnerPounce', 'weaverChant', 'linkHum', 'eliteRoar', 'cadenceTick']) {
      expect(SFX[id].vary, id).toBe(0);
    }
  });

  it('music definitions: patterns fit the bar, masks and chords are valid', () => {
    for (const [state, def] of Object.entries(MUSIC)) {
      const steps = def.beats * 4;
      expect(def.bpm, state).toBeGreaterThan(30);
      expect(cycleBars(def.chords), state).toBeGreaterThan(0);
      if (def.resolved) expect(cycleBars(def.resolved), state).toBe(cycleBars(def.chords));
      for (const l of def.layers) {
        const patterns = l.kind === 'perc' || l.kind === 'pulse' ? l.tiers : l.kind === 'strings' ? (l.gate ?? []) : l.kind === 'cadence' ? [l.pattern] : l.kind === 'brass' && l.pattern ? [l.pattern] : [];
        for (const p of patterns) expect(parsePattern(p).length % steps, `${state}/${l.kind} "${p}"`).toBe(0);
        if (l.mask) expect(/^[x.]+$/.test(l.mask), `${state} mask`).toBe(true);
        const g = typeof l.g === 'number' ? [l.g] : l.g;
        for (const v of g) expect(v >= 0 && v <= 1.2, `${state}/${l.kind} gain`).toBe(true);
      }
    }
  });

  it('the King identity withholds the third until resolved', () => {
    // unresolved King cycles: no chord may contain a major or minor third above the tonic D (F or F#)
    for (const state of ['title', 'recognition', 'core', 'witness'] as const) {
      for (const c of MUSIC[state].chords) {
        const pcs = c.iv.map((iv) => (c.root + iv) % 12);
        expect(pcs.includes(3) || pcs.includes(4), `${state} unresolved has a third`).toBe(false);
      }
    }
    for (const state of ['recognition', 'core', 'witness'] as const) {
      const pcs = MUSIC[state].resolved!.flatMap((c) => c.iv.map((iv) => (c.root + iv) % 12));
      expect(pcs.includes(4), `${state} resolved has F#`).toBe(true);
    }
  });

  it('ambience events reference real sfx ids', () => {
    for (const [id, def] of Object.entries(AMBIENCE)) {
      for (const e of def.events ?? []) {
        expect(e.id in SFX, `${id} → ${e.id}`).toBe(true);
        expect(e.every[1]).toBeGreaterThanOrEqual(e.every[0]);
      }
    }
  });
});

describe('speak()', () => {
  it('maps speakers to faction ticks with stable pitches', () => {
    expect(speakerVoice('Tarrik')).toEqual({ faction: 'dominion', semis: 0 });
    expect(speakerVoice('Selene')).toEqual({ faction: 'reformation', semis: 7 });
    expect(speakerVoice('  lyessa ').faction).toBe('dominion');
    expect(speakerVoice('Terminal').faction).toBe('king');
    expect(speakerVoice('Somebody New').faction).toBe('civil');
    expect(speakCue('Tharne', 'radio').id).toBe('speakReformationRadio');
    expect(speakCue('Malik', 'voice').id).toBe('speakDominion');
    expect(speakCue('Narrator', 'narration')).toEqual({ id: 'speakNarration', pitch: 1 });
    expect(speakCue('Tarrik', 'system').id).toBe('speakKing');
    expect(speakCue('Lyric', 'voice')).toEqual(speakCue('Lyric', 'voice'));
    for (const id of ['speakDominion', 'speakDominionRadio', 'speakReformation', 'speakReformationRadio', 'speakCivil', 'speakCivilRadio', 'speakKing', 'speakNarration']) expect(id in SFX).toBe(true);
  });
});

describe('façade without WebAudio', () => {
  it('is a silent no-op that still tracks requested state and never throws', () => {
    const game = fakeGame();
    const audio = createAudioSystem(game);
    audio.unlock();
    expect(audio.unlocked).toBe(false);
    audio.setMusic('combatTarrik', 1);
    audio.setAmbience('pressureHall');
    audio.setIntensity(0.7);
    audio.setMuffle(2);
    expect(audio.music).toBe('combatTarrik');
    expect(audio.ambience).toBe('pressureHall');
    expect(audio.intensity).toBeCloseTo(0.7);
    expect(audio.muffle).toBe(1);
    audio.play('swingHeavy', { pos: { x: 1, y: 2, z: 3 }, volume: 0.5 });
    audio.play('definitely-not-a-sound');
    const h = audio.loop('droneHum');
    h.setPosition({ x: 0, y: 0, z: 0 });
    h.setVolume(0.5, 1);
    h.setPitch(1.2);
    h.stop();
    audio.stinger('sever');
    audio.speak('Tarrik');
    audio.duck(0.5, 2);
    audio.cadenceTick({ x: 0, y: 0, z: 0 }, true);
    audio.setListener({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    audio.setListener({ x: 0, y: 1, z: 2 }, { x: 0, y: 0, z: -1 });
    audio.applySettings();
    audio.update(0.016);
    audio.clear();
    expect(audio.debugInfo()).toMatchObject({ unlocked: false, contextState: 'none', voices: 0 });
  });

  it('reacts to game events without a context', () => {
    const game = fakeGame();
    const audio = createAudioSystem(game);
    const line: DialogueLine = { speaker: 'Lyessa', text: 'Three lanes. They are not guessing.', channel: 'radio' };
    game.events.emit('dialogue:line', { line });
    game.events.emit('game:paused', { paused: true });
    game.events.emit('game:phase', { phase: 'dead', prev: 'playing' });
    expect(audio.muffle).toBeGreaterThan(0.5);
    game.events.emit('game:phase', { phase: 'playing', prev: 'dead' });
    expect(audio.muffle).toBe(0);
    game.events.emit('checkpoint:saved', { id: 'CP1' });
    game.events.emit('encounter:started', { id: 'E1' });
    game.events.emit('zone:loading', { zone: 'Z01' });
    game.events.emit('zone:ready', { zone: 'Z01' });
    game.settings.set('musicVolume', 0.2);
    audio.play('meridianComplete');
    expect(audio.debugInfo().meridianResolved).toBe(true);
  });

  it('honours ?mute', () => {
    const game = fakeGame();
    (game.flags as { mute: boolean }).mute = true;
    const audio = createAudioSystem(game);
    audio.unlock();
    expect(audio.unlocked).toBe(false);
  });
});

describe('façade with a (fake) AudioContext', () => {
  it('applies everything requested before unlock, defers loops, and stays quiet while suspended', () => {
    const g = globalThis as unknown as { AudioContext?: unknown };
    const saved = g.AudioContext;
    let ctx: FakeContext | null = null;
    g.AudioContext = class extends FakeContext {
      constructor() {
        super();
        ctx = this;
        this.state = 'suspended'; // browsers start suspended until resume() inside a gesture
      }
    };
    try {
      const game = fakeGame();
      const audio = createAudioSystem(game);
      audio.setMusic('approachTarrik');
      audio.setAmbience('pressureHall');
      audio.setMuffle(0.3);
      const hum = audio.loop('emitterHum', { pos: { x: 4, y: 1, z: -8 } });
      hum.setVolume(0.5);
      const gone = audio.loop('relayHum');
      gone.stop();
      expect(audio.unlocked).toBe(false);

      audio.unlock();
      expect(ctx).not.toBeNull();
      const c = ctx as unknown as FakeContext;
      expect(c.state).toBe('running'); // unlock() resumed it
      expect(audio.unlocked).toBe(true);
      expect(audio.debugInfo()).toMatchObject({ unlocked: true, voices: 1, music: 'approachTarrik', ambience: 'pressureHall', muffle: 0.3 });

      // a suspended context must not queue one-shots (they would all fire at once on resume)
      for (let i = 0; i < 30; i++) audio.update(1 / 60); // past the post-unlock grace frames
      c.state = 'suspended';
      const before = c.spans.length;
      audio.play('explosionLarge');
      audio.stinger('death');
      audio.speak('Tarrik');
      audio.update(0.016);
      expect(c.spans.length).toBe(before);
      c.state = 'running';
      audio.play('explosionLarge');
      expect(c.spans.length).toBeGreaterThan(before);

      // the game loop drives scheduling; zone unload clears loops
      for (let i = 0; i < 120; i++) {
        c.currentTime += 1 / 60;
        audio.update(1 / 60);
      }
      audio.setAmbience('none', 0.1); // no more random events
      audio.clear();
      hum.setVolume(1); // stale handle: harmless
      for (let i = 0; i < 900; i++) {
        c.currentTime += 1 / 60;
        audio.update(1 / 60);
      }
      expect(audio.debugInfo().voices).toBe(0);
      expect(c.problems).toEqual([]);
    } finally {
      g.AudioContext = saved;
    }
  });
});

describe('engine on a strict fake context', () => {
  it('builds every sfx recipe with valid automation and a finite length', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    for (const id of Object.keys(SFX)) {
      ctx.currentTime += 20; // let rate limits and instance caps clear
      engine.update(0.05);
      const len = engine.play(id, { pos: { x: 3, y: 1, z: -4 } });
      expect(len, id).toBeGreaterThan(0.004);
      expect(len, id).toBeLessThan(13);
    }
    expect(ctx.problems).toEqual([]);
    // every scheduled source has a stop time: nothing leaks
    ctx.currentTime += 30;
    engine.update(0.05);
    expect(ctx.spans.filter((s) => s.stop === Infinity)).toHaveLength(0);
    expect(engine.voices.count).toBe(0);
  });

  it('loops sustain, follow their handle, and stop cleanly', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    for (const id of Object.keys(SFX).filter((k) => SFX[k].loop)) {
      const h = engine.loop(id, { pos: { x: 1, y: 1, z: 1 } });
      run(ctx, engine, 1);
      expect(engine.voices.count, id).toBe(1);
      h.setVolume(0.5, 0.2);
      h.setPitch(1.3);
      h.setPosition({ x: 2, y: 1, z: 0 });
      h.stop(0.2);
      h.stop(0.2);
      h.setVolume(1);
      run(ctx, engine, 1);
      expect(engine.voices.count, id).toBe(0);
    }
    // a one-shot id can be looped too (re-triggered), and clear() stops everything
    engine.loop('footStone');
    engine.loop('droneHum');
    run(ctx, engine, 2);
    expect(engine.voices.count).toBe(2);
    engine.clear();
    run(ctx, engine, 1.5);
    expect(engine.voices.count).toBe(0);
    expect(ctx.problems).toEqual([]);
    expect(ctx.spans.filter((s) => s.stop === Infinity)).toHaveLength(0);
  });

  it('rate-limits and caps voices: an encounter firing at once cannot exceed the budget', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    let played = 0;
    for (let i = 0; i < 40; i++) if (engine.play('droneBolt') > 0) played++;
    expect(played).toBe(1); // same instant: the per-id gap drops the rest
    for (let i = 0; i < 200; i++) {
      ctx.currentTime += 0.01;
      for (const id of ['droneBolt', 'droneVolley', 'explosionLarge', 'bladeHitMetal', 'footStone', 'shieldHit', 'axiomShot', 'hitConfirm', 'debrisFall', 'ambIceTick', 'verityHit', 'eclipseLunge']) engine.play(id);
      expect(engine.voices.count).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(engine.voices.count).toBeGreaterThan(10);
    expect(ctx.problems).toEqual([]);
  });

  it('unknown ids warn once and are ignored', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(engine.play('nope')).toBe(0);
    expect(engine.play('nope')).toBe(0);
    engine.loop('nope').stop();
    engine.setMusic('not-a-state' as MusicState);
    engine.setMusic('not-a-state' as MusicState);
    engine.setAmbience('not-a-place' as never);
    engine.stinger('not-a-stinger' as never);
    expect(engine.music.state).toBe('silence');
    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('plays every music state for 40 s with valid scheduling and bounded polyphony', () => {
    const report: string[] = [];
    for (const state of Object.keys(MUSIC) as Exclude<MusicState, 'silence'>[]) {
      const ctx = new FakeContext();
      const engine = engineOn(ctx);
      engine.setIntensity(1, true);
      engine.setMusic(state, 0.5);
      run(ctx, engine, 40, 1 / 30, (t) => {
        if (Math.abs(t - 20) < 0.017) engine.setIntensity(0.2);
        if (Math.abs(t - 25) < 0.017) engine.music.setResolved(true);
        if (Math.abs(t - 30) < 0.017) engine.stinger('sever');
      });
      expect(ctx.problems, state).toEqual([]);
      const poly = ctx.maxPolyphony(2, 40);
      report.push(`${state}:${poly}`);
      expect(poly, `${state} polyphony`).toBeLessThan(90);
      // switching away disposes the deck: after the fade nothing sustained remains
      engine.setMusic('silence', 0.5);
      run(ctx, engine, 6);
      expect(ctx.spans.filter((s) => s.stop === Infinity), state).toHaveLength(0);
    }
    console.log(`music polyphony (oscillators+noise sources): ${report.join(' ')}`);
  });

  it('cross-fades states on a bar line and survives a starved scheduler', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setMusic('approachTarrik', 1);
    run(ctx, engine, 5);
    engine.setMusic('combatTarrik', 2);
    engine.setMusic('combatSelene', 2); // immediately superseded
    run(ctx, engine, 6);
    expect(engine.music.state).toBe('combatSelene');
    // a hidden tab: 30 s without update(), then resume — must not burst-schedule the gap
    const before = ctx.spans.length;
    ctx.currentTime += 30;
    engine.update(0.05);
    expect(ctx.spans.length - before).toBeLessThan(120);
    run(ctx, engine, 4);
    engine.setMusic('silence', 0.2);
    run(ctx, engine, 4);
    expect(ctx.problems).toEqual([]);
    expect(ctx.spans.filter((s) => s.stop === Infinity)).toHaveLength(0);
  });

  it('runs every ambience bed, fires its events, and tears down', () => {
    for (const id of Object.keys(AMBIENCE) as (keyof typeof AMBIENCE)[]) {
      const ctx = new FakeContext();
      const engine = engineOn(ctx);
      engine.setListener({ x: 10, y: 2, z: -5 }, { x: 0, y: 0, z: -1 });
      engine.setAmbience(id, 1);
      const before = ctx.spans.length;
      run(ctx, engine, 45, 0.1);
      expect(ctx.spans.length, `${id} events`).toBeGreaterThan(before + 2);
      expect(engine.ambience.current).toBe(id);
      engine.setAmbience('none', 0.5);
      run(ctx, engine, 14, 0.1);
      expect(ctx.problems, id).toEqual([]);
      expect(ctx.spans.filter((s) => s.stop === Infinity), id).toHaveLength(0);
    }
  });

  it('stingers, speak, duck, muffle, pause and listener all schedule validly', () => {
    const ctx = new FakeContext();
    const engine = engineOn(ctx);
    engine.setMusic('breach', 0.2);
    run(ctx, engine, 2);
    for (const kind of STINGER_KINDS) {
      engine.stinger(kind);
      engine.stinger(kind); // rate-limited duplicate
      run(ctx, engine, 2);
    }
    for (const who of ['Tarrik', 'Selene', 'Lyessa', 'Tharne', 'Terminal', 'Narrator', 'Unknown']) {
      for (const chn of ['voice', 'radio', 'system', 'narration'] as const) {
        engine.speak(who, chn);
        run(ctx, engine, 0.2);
      }
    }
    engine.duck(0.5, 2);
    engine.duck(0.2, 1);
    engine.duck(NaN, NaN);
    engine.setMuffle(1, 0.2);
    engine.setMuffle(NaN);
    engine.setPaused(true);
    engine.setPaused(false);
    engine.setListener({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 });
    engine.cadenceTick({ x: 0, y: 0, z: 0 });
    engine.cadenceTick(undefined, true);
    engine.setVolumes({ master: 1, music: 0, sfx: 0.5 });
    engine.play('swingHeavy', { pos: { x: NaN, y: 0, z: 0 }, volume: NaN, pitch: -3, delay: NaN });
    run(ctx, engine, 8);
    expect(ctx.problems).toEqual([]);
  });
});
