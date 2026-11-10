/**
 * Recorded score + voice-over in node: the library's failure handling, and the players and the score
 * director against the strict fake context (which records every source and rejects bad automation).
 * The line id and the state table have their own files; what it all sounds like is the sandbox's job.
 */
import { describe, expect, it } from 'vitest';
import MANIFEST_JSON from '../../../public/audio/music/manifest.json?raw';
import type { Game, GameEvents, MusicState } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { createAudioSystem } from '../index';
import { AudioEngine } from '../engine';
import { MUSIC } from '../music/defs';
import { FakeBuffer, FakeContext } from '../testing/fake-context';
import { AssetLibrary, voiceGain, type FetchResult } from './library';
import { TRACKS, type TrackMeta, type TrackName } from './mapping';
import { TrackPlayer } from './player';
import { voLineId } from './voiceId';

const MANIFEST = JSON.parse(MANIFEST_JSON) as Record<TrackName, TrackMeta>;

// ---------------------------------------------------------------------------------------------------------

const ok = (body: unknown, type = 'audio/mpeg'): FetchResult => ({
  ok: true,
  headers: { get: (n) => (n === 'content-type' ? type : null) },
  arrayBuffer: async () => new ArrayBuffer(4096),
  json: async () => body,
});

/** A library over a fake network: `files` maps a path under audio/ to a response (absent = 404). */
function fakeLibrary(ctx: FakeContext | null, files: Record<string, () => FetchResult | Promise<FetchResult>>, seconds = 20): { lib: AssetLibrary; fetched: string[]; fetcher: (url: string) => Promise<FetchResult> } {
  const fetched: string[] = [];
  const decoding = ctx as unknown as { decodeAudioData?: (b: ArrayBuffer) => Promise<FakeBuffer> } | null;
  if (decoding) {
    decoding.decodeAudioData = async (b: ArrayBuffer): Promise<FakeBuffer> => {
      if (b.byteLength !== 4096) throw new Error('not audio');
      const buf = new FakeBuffer(1, Math.round(seconds * 44100), 44100);
      buf.getChannelData(0).fill(0.05);
      return buf;
    };
  }
  const fetcher = async (url: string): Promise<FetchResult> => {
    const path = url.replace(/^\/audio\//, '');
    fetched.push(path);
    const f = files[path];
    if (!f) return { ok: false, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
    return f();
  };
  const lib = new AssetLibrary({ baseUrl: '/', decoder: () => (ctx ? ctx.asContext() : null), fetcher });
  return { lib, fetched, fetcher };
}

const musicFiles = (names: readonly string[], seconds = 20): Record<string, () => FetchResult> => {
  const files: Record<string, () => FetchResult> = { 'music/manifest.json': () => ok(Object.fromEntries(names.map((n) => [n, { ...MANIFEST[n as TrackName], seconds }])), 'application/json') };
  for (const n of names) files[`music/${n}.mp3`] = () => ok(null);
  return files;
};

describe('asset library', () => {
  it('shares one load between concurrent requests and remembers the result', async () => {
    const { lib, fetched } = fakeLibrary(new FakeContext(), musicFiles(['main_theme']));
    const [a, b, c] = await Promise.all([lib.requestTrack('main_theme'), lib.requestTrack('main_theme'), lib.requestTrack('main_theme')]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(await lib.requestTrack('main_theme')).toBe(a);
    expect(fetched).toEqual(['music/manifest.json', 'music/main_theme.mp3']);
    expect(lib.track('main_theme')).toBe(a);
    expect(lib.trackState('main_theme')).toBe('ready');
  });

  it('treats every kind of failure as "missing" without rejecting, and does not retry', async () => {
    const files = musicFiles(['main_theme', 'relay_combat', 'core_witness', 'frozen_stealth']);
    delete files['music/main_theme.mp3']; // 404
    files['music/relay_combat.mp3'] = () => ok('<!doctype html>', 'text/html'); // dev-server fallback page
    files['music/core_witness.mp3'] = () => ({ ...ok(null), arrayBuffer: async () => new ArrayBuffer(100) }); // not decodable
    files['music/frozen_stealth.mp3'] = () => { throw new Error('network down'); };
    const { lib, fetched } = fakeLibrary(new FakeContext(), files);
    for (const t of ['main_theme', 'relay_combat', 'core_witness', 'frozen_stealth', 'not_in_manifest']) {
      await expect(lib.requestTrack(t)).resolves.toBeNull();
      expect(lib.trackState(t)).toBe('missing');
      expect(lib.track(t)).toBeNull();
    }
    const n = fetched.length;
    await lib.requestTrack('main_theme');
    expect(fetched.length).toBe(n);
  });

  it('means "no recorded score" when there is no manifest, an HTML page instead of one, or junk in it', async () => {
    for (const files of [
      {},
      { 'music/manifest.json': () => ok('<html>', 'text/html') },
      { 'music/manifest.json': () => ({ ...ok(null, 'application/json'), json: async () => { throw new SyntaxError('bad json'); } }) },
      { 'music/manifest.json': () => ok([1, 2, 3], 'application/json') },
    ] as Array<Record<string, () => FetchResult>>) {
      const { lib } = fakeLibrary(new FakeContext(), files);
      await expect(lib.loadMusic()).resolves.toBeNull();
      await expect(lib.requestTrack('main_theme')).resolves.toBeNull();
      expect(lib.trackState('main_theme')).toBe('missing');
      await expect(lib.loadVoices()).resolves.toBeNull();
      await expect(lib.requestClip('tarrik_00000000')).resolves.toBeNull();
    }
    const { lib } = fakeLibrary(new FakeContext(), { 'music/manifest.json': () => ok({ a: 1, b: { file: 3 }, c: { file: 'c.mp3', seconds: -1 }, main_theme: { file: 'm.mp3', seconds: 9 } }, 'application/json') });
    expect(Object.keys((await lib.loadMusic()) ?? {})).toEqual(['main_theme']);
  });

  it('keeps a track loadable when there was no context to decode with yet', async () => {
    let ctx: FakeContext | null = null;
    const net = fakeLibrary(null, musicFiles(['main_theme']));
    const lib = new AssetLibrary({ baseUrl: '/', decoder: () => (ctx ? ctx.asContext() : null), fetcher: net.fetcher });
    await expect(lib.requestTrack('main_theme')).resolves.toBeNull();
    expect(lib.trackState('main_theme')).toBe('unknown');
    ctx = new FakeContext();
    (ctx as unknown as { decodeAudioData: unknown }).decodeAudioData = async () => new FakeBuffer(2, 44100 * 20, 44100);
    expect(await lib.requestTrack('main_theme')).not.toBeNull();
    // the compressed bytes were kept: the file was fetched once
    expect(net.fetched.filter((p) => p.endsWith('.mp3'))).toHaveLength(1);
  });

  it('drops decoded tracks nobody pins — beyond three at once, or after sitting idle — and gets them back without the network', async () => {
    const names = ['main_theme', 'dominion_combat', 'frozen_stealth', 'relay_combat', 'atrium_carrier'];
    const { lib, fetched } = fakeLibrary(new FakeContext(), musicFiles(names));
    lib.pin(['main_theme']);
    for (const n of names) {
      await lib.requestTrack(n);
      lib.tick(1);
    }
    expect(lib.stats().decodedTracks).toBe(3);
    expect(lib.track('main_theme')).not.toBeNull(); // pinned, although the oldest
    expect(lib.track('dominion_combat')).toBeNull();
    for (let t = 0; t < 100; t++) lib.tick(1);
    expect(lib.stats().decodedTracks).toBe(1);
    expect(lib.track('main_theme')).not.toBeNull();
    const n = fetched.length;
    expect(await lib.requestTrack('dominion_combat')).not.toBeNull();
    expect(fetched.length).toBe(n);
  });

  it('loads voice clips by line id and levels them', async () => {
    const id = voLineId('Tarrik', 'Hold the line.');
    const { lib, fetched } = fakeLibrary(new FakeContext(), {
      'vo/manifest.json': () => ok({ [id]: { file: `${id}.mp3`, seconds: 1.5 }, broken: { file: 'broken.mp3' } }, 'application/json'),
      [`vo/${id}.mp3`]: () => ok(null),
    }, 1.5);
    expect(lib.voiceMeta(id)).toBeNull();
    expect(lib.voicesKnown).toBe(false);
    const clip = await lib.requestClip(id);
    expect(lib.voicesKnown).toBe(true);
    expect(lib.voiceMeta(id)).toEqual({ file: `${id}.mp3`, seconds: 1.5 });
    expect(lib.voiceMeta('broken')).toBeNull();
    expect(clip!.buffer.duration).toBeCloseTo(1.5, 3);
    // the fake clip is a constant 0.05 (−26 dBFS): brought up 6 dB to the dialogue level
    expect(20 * Math.log10(clip!.gain)).toBeCloseTo(6, 1);
    expect(lib.clip(id)).toBe(clip);
    await expect(lib.requestClip('selene_ffffffff')).resolves.toBeNull();
    expect(fetched.filter((p) => p.includes('ffffffff'))).toEqual([]); // not in the manifest: never asked for
  });

  it('levels speech by its sounding frames, within ±12 dB and under the peak ceiling', () => {
    const sr = 16000;
    const tone = (a: number, seconds: number, silence = 0): Float32Array => {
      const x = new Float32Array(Math.round((seconds + silence) * sr));
      for (let i = 0; i < seconds * sr; i++) x[i] = a * Math.sin((2 * Math.PI * 220 * i) / sr);
      return x;
    };
    const db = (g: number): number => 20 * Math.log10(g);
    const quiet = voiceGain([tone(0.02, 1)], sr); // −37 dB RMS
    expect(db(quiet)).toBeCloseTo(12, 1);
    // pauses do not make a clip "quieter"
    expect(voiceGain([tone(0.1, 1, 3)], sr)).toBeCloseTo(voiceGain([tone(0.1, 1)], sr), 2);
    // a hot clip comes down, and a peaky one is held under the ceiling
    expect(db(voiceGain([tone(0.9, 1)], sr))).toBeLessThan(-12 + 0.01);
    const peaky = tone(0.05, 1);
    peaky[100] = 1;
    expect(voiceGain([peaky], sr)).toBeLessThanOrEqual(0.84);
    expect(voiceGain([new Float32Array(100)], sr)).toBe(1);
    expect(voiceGain([], sr)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------

function step(ctx: FakeContext, seconds: number, each: (dt: number) => void, dt = 0.05): void {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.currentTime += dt;
    each(dt);
  }
}

describe('track player', () => {
  const loop = { intro: 0, from: 0, to: 18, xfade: 2, rate: 1, meanDb: -16 };

  it('hands each pass over to the next exactly one loop period later, with overlapping tails', () => {
    const ctx = new FakeContext();
    const p = new TrackPlayer(ctx.asContext(), ctx.asContext().createGain());
    const buf = new FakeBuffer(2, 44100 * 20, 44100) as unknown as AudioBuffer;
    p.play('a:whole', buf, loop, 0.5, 20000, 1, 2);
    const seen = new Map<number, ReturnType<TrackPlayer['schedule']>[number]>();
    step(ctx, 60, () => {
      p.update(1.5);
      for (const s of p.schedule()) seen.set(s.k, s);
    });
    const passes = [...seen.values()].sort((a, b) => a.k - b.k);
    expect(passes.length).toBe(4);
    passes.forEach((s, i) => {
      expect(s.startAt).toBeCloseTo(1 + 18 * i, 9);
      expect(s.offset).toBe(0);
      expect(s.handoverAt).toBeCloseTo(s.startAt + 18, 9);
      expect(s.stopAt).toBeGreaterThan(s.handoverAt + 2);
      expect(s.fadeIn).toBe(i === 0 ? 0 : 2);
    });
    // never more than the pass and the tail of the one before it
    expect(ctx.maxPolyphony(0, 60)).toBe(2);
    expect(ctx.problems).toEqual([]);
  });

  it('loops a region from its own start, and a tuned track faster', () => {
    const ctx = new FakeContext();
    const p = new TrackPlayer(ctx.asContext(), ctx.asContext().createGain());
    const buf = new FakeBuffer(2, 44100 * 30, 44100) as unknown as AudioBuffer;
    const rate = Math.pow(2, 2 / 12);
    p.play('a:mid', buf, { intro: 4, from: 4, to: 14, xfade: 2, rate, meanDb: -16 }, 0.5, 20000, 0, 1);
    const starts = new Map<number, number>();
    step(ctx, 30, () => {
      p.update(1.5);
      for (const s of p.schedule()) {
        starts.set(s.k, s.startAt);
        expect(s.offset).toBe(4);
      }
    });
    const t = [...starts.values()].sort((a, b) => a - b);
    expect(t[1] - t[0]).toBeCloseTo(10 / rate, 9);
    expect(t[2] - t[1]).toBeCloseTo(10 / rate, 9);
    expect(ctx.problems).toEqual([]);
  });

  it('cross-fades to another recording, keeps the same one, and brings back one that is still fading', () => {
    const ctx = new FakeContext();
    const p = new TrackPlayer(ctx.asContext(), ctx.asContext().createGain());
    const a = new FakeBuffer(2, 44100 * 20, 44100) as unknown as AudioBuffer;
    const b = new FakeBuffer(2, 44100 * 20, 44100) as unknown as AudioBuffer;
    p.play('a', a, loop, 0.5, 20000, 0, 2);
    step(ctx, 3, () => p.update(1.5));
    const sources = ctx.spans.length;
    p.play('a', a, loop, 0.2, 3000, ctx.currentTime, 2); // same recording: only level and tone move
    expect(ctx.spans.length).toBe(sources);
    expect(p.sounding).toBe(1);
    p.play('b', b, loop, 0.5, 20000, ctx.currentTime, 2);
    expect(p.key).toBe('b');
    expect(p.sounding).toBe(2);
    step(ctx, 1, () => p.update(1.5));
    p.play('a', a, loop, 0.5, 20000, ctx.currentTime, 2); // back before it has gone: no restart
    expect(ctx.spans.length).toBe(sources + 1);
    expect(p.key).toBe('a');
    step(ctx, 4, () => p.update(1.5));
    expect(p.sounding).toBe(1);
    p.stop(ctx.currentTime, 1);
    step(ctx, 2, () => p.update(1.5));
    expect(p.sounding).toBe(0);
    expect(p.key).toBeNull();
    expect(ctx.maxPolyphony(ctx.currentTime, Infinity)).toBe(0);
    expect(ctx.problems).toEqual([]);
  });

  it('comes back in phase after the scheduler was starved across a seam', () => {
    const ctx = new FakeContext();
    const p = new TrackPlayer(ctx.asContext(), ctx.asContext().createGain());
    const buf = new FakeBuffer(2, 44100 * 20, 44100) as unknown as AudioBuffer;
    p.play('a', buf, loop, 0.5, 20000, 0, 1);
    step(ctx, 10, () => p.update(1.5));
    ctx.currentTime = 23; // 5 s after the hand-over at 18 s, nothing was scheduled meanwhile
    p.update(1.5);
    const late = p.schedule().find((s) => s.k === 1)!;
    expect(late.startAt).toBeCloseTo(23, 9);
    expect(late.handoverAt).toBeCloseTo(36, 9);
    expect(ctx.spans[ctx.spans.length - 1].offset).toBeCloseTo(5, 6);
    ctx.currentTime = 80; // a whole pass missed: it is skipped, not played late
    p.update(1.5);
    step(ctx, 1, () => p.update(1.5));
    expect(ctx.problems).toEqual([]);
  });
});

describe('score director and voice-over on the engine', () => {
  async function world(tracks: readonly string[], vo: Record<string, number> = {}, seconds = 20): Promise<{ ctx: FakeContext; lib: AssetLibrary; engine: AudioEngine }> {
    const ctx = new FakeContext();
    const files = musicFiles(tracks, seconds);
    files['vo/manifest.json'] = () => ok(Object.fromEntries(Object.entries(vo).map(([id, seconds]) => [id, { file: `${id}.mp3`, seconds }])), 'application/json');
    for (const id of Object.keys(vo)) files[`vo/${id}.mp3`] = () => ok(null);
    const { lib } = fakeLibrary(ctx, files, seconds);
    await lib.loadMusic();
    await lib.loadVoices();
    return { ctx, lib, engine: new AudioEngine(ctx.asContext(), { seed: 5, assets: lib }) };
  }
  const run = (ctx: FakeContext, engine: AudioEngine, seconds: number): void => step(ctx, seconds, (dt) => engine.update(dt));
  /** let the fake network and decoder (microtasks) finish */
  const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

  it('plays the generative score until the recording arrives, then hands the state over to it', async () => {
    const { ctx, engine } = await world(['dominion_combat']);
    engine.setMusic('combatTarrik', 1);
    expect(engine.music.state).toBe('combatTarrik');
    expect(engine.score.track).toBeNull();
    expect(engine.music.activeDeck).not.toBeNull(); // the full generative state
    run(ctx, engine, 1);
    await settle();
    run(ctx, engine, 0.2);
    expect(engine.score.track).toBe('dominion_combat');
    expect(engine.music.state).toBe('combatTarrik');
    expect(engine.music.activeDeck).toBeNull(); // nothing generative under this recording
    run(ctx, engine, 30);
    expect(ctx.problems).toEqual([]);
  });

  it('uses a decoded recording at once, and keeps only the selected generative layers under it', async () => {
    const { ctx, lib, engine } = await world(['frozen_stealth', 'core_witness']);
    await lib.requestTrack('frozen_stealth');
    await lib.requestTrack('core_witness');
    engine.setMusic('stealth', 1);
    expect(engine.score.track).toBe('frozen_stealth');
    expect(engine.music.activeDeck!.def.layers.map((l) => l.kind)).toEqual(['pad']);
    run(ctx, engine, 2);
    engine.setMusic('core', 2);
    expect(engine.score.track).toBe('core_witness');
    expect(engine.music.activeDeck!.def.layers.map((l) => l.kind).sort()).toEqual(['motif', 'pulse']);
    run(ctx, engine, 6);
    expect(engine.score.player.sounding).toBe(1);
    expect(ctx.problems).toEqual([]);
  });

  it('keeps one recording running across the states that share it', async () => {
    const { ctx, lib, engine } = await world(['eclipse_combat', 'atrium_carrier']);
    await lib.requestTrack('eclipse_combat');
    await lib.requestTrack('atrium_carrier');
    engine.setMusic('combatEclipse', 0.5);
    run(ctx, engine, 3);
    const first = engine.score.player.schedule();
    expect(first).toHaveLength(1);
    engine.setMusic('elite', 1);
    engine.setMusic('resonance', 1);
    run(ctx, engine, 3);
    expect(engine.score.player.schedule()).toEqual(first); // the same pass plays on: only its level and tone moved
    expect(engine.score.player.sounding).toBe(1);
    expect(engine.score.player.key).toBe('eclipse_combat:whole');
    expect(engine.music.activeDeck!.def.layers.map((l) => l.kind).sort()).toEqual(['brass', 'pad', 'pad']);
    // … but the atrium and the carrier are different parts of their recording
    engine.setMusic('atrium', 1);
    run(ctx, engine, 3);
    expect(engine.score.player.key).toBe('atrium_carrier:stillness');
    engine.setMusic('carrier', 1);
    expect(engine.score.player.key).toBe('atrium_carrier:swell');
    run(ctx, engine, 3);
    expect(ctx.problems).toEqual([]);
  });

  it('skips the introduction of a combat recording when the fight is already on', async () => {
    for (const [intensity, offset] of [[0.2, 0], [0.9, TRACKS.dominion_combat.body]] as const) {
      const { ctx, lib, engine } = await world(['dominion_combat'], {}, 93.2);
      await lib.requestTrack('dominion_combat');
      engine.setIntensity(intensity); // just asked for: the audible value has not moved yet
      engine.setMusic('combatTarrik', 0.5);
      run(ctx, engine, 0.5);
      expect(engine.score.player.schedule()[0].offset).toBe(offset);
      expect(ctx.problems).toEqual([]);
    }
  });

  it('falls back to the generative score for good when the file is missing, and for states without one', async () => {
    const { ctx, engine } = await world([]);
    for (const s of ['title', 'combatSelene', 'approachTarrik', 'quarantine'] as MusicState[]) {
      engine.setMusic(s, 0.5);
      await settle();
      run(ctx, engine, 3);
      expect(engine.score.track).toBeNull();
      expect(engine.music.state).toBe(s);
      expect(engine.music.activeDeck!.def.layers.length).toBe(MUSIC[s as keyof typeof MUSIC].layers.length);
    }
    engine.setMusic('silence', 0.5);
    run(ctx, engine, 2);
    expect(engine.music.activeDeck).toBeNull();
    expect(ctx.problems).toEqual([]);
  });

  it('fades the recording out when the next state is generative', async () => {
    const { ctx, lib, engine } = await world(['main_theme']);
    await lib.requestTrack('main_theme');
    engine.setMusic('title', 0.5);
    run(ctx, engine, 2);
    expect(engine.score.track).toBe('main_theme');
    engine.setMusic('context', 1);
    expect(engine.score.track).toBeNull();
    expect(engine.music.activeDeck).not.toBeNull();
    run(ctx, engine, 3);
    expect(engine.score.player.sounding).toBe(0);
    expect(ctx.problems).toEqual([]);
  });

  it('speaks a line that has a recording, once, and reports 0 for one that has none', async () => {
    const id = voLineId('Selene', 'Hold the plane.');
    const { ctx, lib, engine } = await world([], { [id]: 20 });
    expect(engine.voice('Tarrik', 'No recording for this.')).toBe(0);
    expect(engine.vo.speaking).toBeNull();
    await lib.requestClip(id);
    const before = ctx.spans.length;
    for (const channel of ['voice', 'radio', 'system', 'narration'] as const) {
      const n = ctx.spans.length;
      expect(engine.voice('Selene', 'Hold the plane.', { channel, pos: { x: 4, y: 0, z: -2 } })).toBeCloseTo(20, 6);
      expect(engine.voice('SELENE', 'hold the plane')).toBeCloseTo(20, 6); // the dialogue event announcing the same line
      expect(ctx.spans.length).toBe(n + 1);
      expect(engine.vo.speaking).toBe(id);
      run(ctx, engine, 1);
    }
    engine.stopVoice(0.1);
    expect(engine.vo.speaking).toBeNull();
    run(ctx, engine, 1);
    expect(ctx.maxPolyphony(ctx.currentTime, Infinity)).toBe(0);
    expect(ctx.spans.length).toBe(before + 4);
    engine.stopVoice();
    expect(ctx.problems).toEqual([]);
  });

  it('starts a listed line as soon as its clip decodes, and gives up on one that takes too long', async () => {
    const id = voLineId('Lyessa', 'On your left.');
    const { ctx, engine } = await world([], { [id]: 20 });
    const n = ctx.spans.length;
    expect(engine.voice('Lyessa', 'On your left.')).toBe(20); // the manifest's length, before the clip is here
    expect(ctx.spans.length).toBe(n);
    await settle();
    expect(ctx.spans.length).toBe(n + 1);
    engine.stopVoice(0.05);
    run(ctx, engine, 1);

    const slow = voLineId('Malik', 'Still here.');
    const w = await world([], { [slow]: 20 });
    w.engine.voice('Malik', 'Still here.');
    w.ctx.currentTime += 2; // the clip lands two seconds late
    const m = w.ctx.spans.length;
    await settle();
    expect(w.ctx.spans.length).toBe(m);
    expect(w.engine.vo.speaking).toBeNull();
  });

  it('holds the spoken line while the game is paused and picks it up a moment earlier', async () => {
    const id = voLineId('Tharne', 'Two planes. Count them.');
    const { ctx, lib, engine } = await world([], { [id]: 20 });
    await lib.requestClip(id);
    engine.voice('Tharne', 'Two planes. Count them.', { pos: { x: 3, y: 0, z: 0 } });
    run(ctx, engine, 5);
    const n = ctx.spans.length;
    engine.setPaused(true);
    engine.setPaused(true);
    run(ctx, engine, 3);
    expect(ctx.maxPolyphony(ctx.currentTime - 2, ctx.currentTime)).toBe(0); // nothing sounds while paused
    expect(engine.vo.speaking).toBe(id);
    engine.setPaused(false);
    expect(ctx.spans.length).toBe(n + 1);
    expect(ctx.spans[n].offset).toBeCloseTo(4.8, 1); // 5 s in, less the fifth of a second it backs up
    run(ctx, engine, 1);
    expect(engine.vo.speaking).toBe(id);
    // a line cut while held does not come back
    engine.setPaused(true);
    engine.stopVoice();
    engine.setPaused(false);
    expect(ctx.spans.length).toBe(n + 1);
    expect(engine.vo.speaking).toBeNull();
    run(ctx, engine, 16);
    expect(ctx.problems).toEqual([]);
  });

  it('treats a line whose listed file is gone as unrecorded from then on', async () => {
    const ctx = new FakeContext();
    const id = voLineId('Cross', 'Door is sealed.');
    const { lib } = fakeLibrary(ctx, { 'vo/manifest.json': () => ok({ [id]: { file: `${id}.mp3`, seconds: 2 } }, 'application/json') });
    await lib.loadVoices();
    const engine = new AudioEngine(ctx.asContext(), { seed: 3, assets: lib });
    expect(engine.voice('Cross', 'Door is sealed.')).toBe(2); // listed: believed until the file answers
    await settle();
    expect(engine.vo.speaking).toBeNull();
    ctx.currentTime += 1;
    expect(engine.voice('Cross', 'Door is sealed.')).toBe(0); // now known to be missing: the caller ticks instead
    expect(ctx.spans.filter((s) => s.kind === 'buffer' && s.stop - s.start > 1.5)).toEqual([]);
  });

  it('has nothing to say and nothing recorded without a library', () => {
    const ctx = new FakeContext();
    const engine = new AudioEngine(ctx.asContext(), { seed: 1 });
    expect(engine.voice('Tarrik', 'Hold.')).toBe(0);
    engine.stopVoice();
    engine.setMusic('title', 0.5);
    step(ctx, 2, (dt) => engine.update(dt));
    expect(engine.score.track).toBeNull();
    expect(engine.music.activeDeck).not.toBeNull();
    expect(ctx.problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the AudioSystem façade', () => {
  function fakeGame(flags: Partial<Game['flags']> = {}): Game & { events: Emitter<GameEvents> } {
    const events = new Emitter<GameEvents>();
    return {
      events,
      settings: new SettingsStoreImpl(events),
      time: { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} },
      flags: { zone: null, beat: null, checkpoint: null, debug: false, autoplay: false, mute: false, nopost: false, quality: null, manual: true, seed: 1, ...flags },
      ai: nullObject('ai'),
      mission: nullObject('mission'),
    } as unknown as Game & { events: Emitter<GameEvents> };
  }

  it('without WebAudio: voice() is 0, stopVoice() is harmless and preloadVoices() resolves', async () => {
    const game = fakeGame();
    const audio = createAudioSystem(game);
    expect(audio.voice('Tarrik', 'Hold the line.', { channel: 'radio', pos: { x: 1, y: 0, z: 2 } })).toBe(0);
    audio.stopVoice();
    audio.stopVoice(0.15);
    await expect(audio.preloadVoices([['Tarrik', 'Hold the line.'], ['Selene', 'Hold the plane.']])).resolves.toBeUndefined();
    await expect(audio.preloadVoices(null as unknown as Array<[string, string]>)).resolves.toBeUndefined();
    game.events.emit('dialogue:line', { line: { speaker: 'Tarrik', text: 'Hold the line.' } });
    audio.setMusic('title');
    audio.update(0.016);
    expect(audio.debugInfo()).toMatchObject({ recordedTrack: null, voiceLine: null, music: 'title' });
  });

  it('with audio but no reachable files: everything is as before, nothing rejects', async () => {
    const g = globalThis as unknown as { AudioContext?: unknown; fetch?: unknown };
    const saved = { ctx: g.AudioContext, fetch: g.fetch };
    let made: FakeContext | null = null;
    g.AudioContext = class extends FakeContext {
      constructor() {
        super();
        made = this;
      }
    };
    const asked: string[] = [];
    g.fetch = async (url: string): Promise<never> => {
      asked.push(url);
      throw new TypeError('offline');
    };
    try {
      const game = fakeGame({ manual: false });
      const audio = createAudioSystem(game);
      await new Promise((r) => setTimeout(r, 0));
      // the manifests are asked for at boot — once
      expect(asked.filter((u) => u.endsWith('music/manifest.json'))).toHaveLength(1);
      expect(asked.filter((u) => u.endsWith('vo/manifest.json'))).toHaveLength(1);
      audio.setMusic('title');
      audio.unlock();
      const ctx = made as unknown as FakeContext;
      for (const s of ['title', 'combatTarrik', 'stealth', 'carrier', 'witness'] as MusicState[]) {
        audio.setMusic(s, 0.5);
        for (let i = 0; i < 40; i++) { ctx.currentTime += 0.05; audio.update(0.05); }
        await new Promise((r) => setTimeout(r, 0));
        expect(audio.music).toBe(s);
        expect(audio.debugInfo().recordedTrack).toBeNull();
      }
      expect(audio.voice('Tarrik', 'Hold the line.')).toBe(0);
      game.events.emit('dialogue:line', { line: { speaker: 'Tarrik', text: 'Hold the line.', channel: 'radio' } });
      await expect(audio.preloadVoices([['Tarrik', 'Hold the line.']])).resolves.toBeUndefined();
      expect(asked.length).toBe(2);
      expect(ctx.problems).toEqual([]);
      audio.dispose();
    } finally {
      g.AudioContext = saved.ctx;
      g.fetch = saved.fetch;
    }
  });

  it('fetches nothing at all when muted', async () => {
    const g = globalThis as unknown as { fetch?: unknown };
    const saved = g.fetch;
    let asked = 0;
    g.fetch = async (): Promise<never> => {
      asked++;
      throw new TypeError('offline');
    };
    try {
      const audio = createAudioSystem(fakeGame({ mute: true, manual: false }));
      audio.setMusic('title');
      await audio.preloadVoices([['Tarrik', 'Hold the line.']]);
      expect(audio.voice('Tarrik', 'Hold the line.')).toBe(0);
      expect(asked).toBe(0);
    } finally {
      g.fetch = saved;
    }
  });
});
