/**
 * Recorded score + voice-over, tested in node: the line-id function, the state → track table, the loop
 * arithmetic, the library's failure handling, and the players against the strict fake context (which
 * records every source and rejects bad automation). What it sounds like is the sandbox's job.
 */
import { describe, expect, it } from 'vitest';
import API from '../../core/api/audio.ts?raw';
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
import {
  LOOP_XFADE, SCORE_PLAN, TRACKS, TRACK_NAMES, layerMatches, loopPeriod, loopSpec, overlayDef, planGain, planTone, scorePlan,
  type TrackMeta, type TrackName,
} from './mapping';
import { TrackPlayer } from './player';
import { canonicalLine, fnv1a32hex, speakerSlug, voLineId } from './voiceId';

const MANIFEST = JSON.parse(MANIFEST_JSON) as Record<TrackName, TrackMeta>;

const STATES = ((): MusicState[] => {
  const m = /export type MusicState =([\s\S]*?);\n/.exec(API);
  if (!m) throw new Error('MusicState not found');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1] as MusicState);
})();

describe('voLineId', () => {
  it('hashes with standard FNV-1a 32 over UTF-8', () => {
    expect(fnv1a32hex('')).toBe('811c9dc5');
    expect(fnv1a32hex('a')).toBe('e40c292c');
    expect(fnv1a32hex('foobar')).toBe('bf9cf968');
    // multi-byte: é is C3 A9, 😀 is F0 9F 98 80 — the same bytes TextEncoder produces
    const viaBytes = (s: string): string => {
      let h = 0x811c9dc5;
      for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193);
      return (h >>> 0).toString(16).padStart(8, '0');
    };
    for (const s of ['é', 'naïve façade', '😀 ok', '\ud800 lone']) expect(fnv1a32hex(s)).toBe(viaBytes(s));
  });

  it('has the documented shape: speaker slug, underscore, 8 hex digits', () => {
    expect(voLineId('Tarrik', 'Hold the line.')).toMatch(/^tarrik_[0-9a-f]{8}$/);
    expect(voLineId('Dominion Command', 'Report.')).toMatch(/^dominion_command_[0-9a-f]{8}$/);
    expect(voLineId('_test_', 'x')).toMatch(/^_test__[0-9a-f]{8}$/);
    expect(speakerSlug('Élise  d’Arc')).toBe('elise_d_arc');
    expect(speakerSlug('')).toBe('line');
    expect(voLineId('', '')).toBe(`line_${fnv1a32hex('')}`);
  });

  it('is pinned: these ids must never change (recordings on disk are named by them)', () => {
    expect(canonicalLine('Tarrik', 'Hold the line.')).toBe('tarrikhold the line');
    expect(voLineId('Tarrik', 'Hold the line.')).toBe(`tarrik_${fnv1a32hex('tarrikhold the line')}`);
    expect(voLineId('Tarrik', 'Hold the line.')).toBe('tarrik_40653c06');
    expect(voLineId('Selene', 'Three lanes. They are not guessing.')).toBe('selene_45b7ddea');
    expect(voLineId('Reformation Command', 'Relay A is down — 7,184 aboard.')).toBe('reformation_command_bef6c9dd');
  });

  it('ignores case, spacing and punctuation — and nothing else', () => {
    const id = voLineId('Selene', 'Hold the plane.');
    expect(voLineId('SELENE', '  hold   the\tplane  ')).toBe(id);
    expect(voLineId('Selene', 'Hold the plane!')).toBe(id);
    expect(voLineId('Selene', 'Hold — the “plane”…')).toBe(id);
    expect(voLineId('Selene', 'Hold\nthe plane')).toBe(id);
    expect(voLineId('Selene', 'Hold the planes.')).not.toBe(id);
    expect(voLineId('Tarrik', 'Hold the plane.')).not.toBe(id);
    // composed and decomposed accents are the same line; digits count
    expect(voLineId('Lyric', 'naïve')).toBe(voLineId('Lyric', 'naïve'));
    expect(voLineId('Terminal', '4 of 5')).not.toBe(voLineId('Terminal', '5 of 5'));
  });

  it('never throws on junk', () => {
    const junk = [undefined, null, 42, {}, []] as unknown as string[];
    for (const a of junk) for (const b of junk) expect(voLineId(a, b)).toMatch(/^[a-z0-9_]+_[0-9a-f]{8}$/);
  });
});

describe('state → track mapping', () => {
  it('scores every MusicState, and only existing tracks', () => {
    expect(Object.keys(SCORE_PLAN).sort()).toEqual([...STATES].sort());
    for (const s of STATES) {
      const p = scorePlan(s);
      if (p.track) expect(TRACK_NAMES).toContain(p.track);
      if (p.warm) expect(TRACK_NAMES).toContain(p.warm);
      expect(p.tone[0]).toBeGreaterThan(100);
      expect(p.tone[1]).toBeGreaterThanOrEqual(p.tone[0]);
      expect(p.gain[1]).toBeGreaterThanOrEqual(p.gain[0]);
      if (p.track) expect(p.gain[1]).toBeLessThanOrEqual(-16);
    }
    expect(scorePlan('nonsense' as MusicState)).toBe(SCORE_PLAN.silence);
  });

  it('is the table the task specifies', () => {
    const by = (t: TrackName | null): string[] => STATES.filter((s) => SCORE_PLAN[s].track === t).sort();
    expect(by('main_theme')).toEqual(['credits', 'departure', 'title']);
    expect(by('dominion_combat')).toEqual(['combatTarrik']);
    expect(by('frozen_stealth')).toEqual(['approachSelene', 'stealth']);
    expect(by('relay_combat')).toEqual(['combatSelene']);
    expect(by('atrium_carrier')).toEqual(['atrium', 'carrier', 'duel']);
    expect(by('eclipse_combat')).toEqual(['combatEclipse', 'elite', 'resonance']);
    expect(by('core_witness')).toEqual(['consequence', 'core', 'observation', 'recognition', 'witness']);
    expect(by(null)).toEqual(['approachTarrik', 'breach', 'context', 'decision', 'quarantine', 'silence']);
  });

  it('gives atrium_carrier its dynamics through the states: duel quieter, carrier louder', () => {
    expect(SCORE_PLAN.duel.gain[1]).toBeLessThan(SCORE_PLAN.atrium.gain[1]);
    expect(SCORE_PLAN.carrier.gain[0]).toBeGreaterThan(SCORE_PLAN.atrium.gain[1] + 2);
    expect(SCORE_PLAN.atrium.region).toBe('stillness');
    expect(SCORE_PLAN.carrier.region).toBe('swell');
  });

  it('selects generative layers that really exist in the state they are for', () => {
    for (const s of STATES) {
      const p = SCORE_PLAN[s];
      if (!p.track) {
        expect(p.generativeLayers).toEqual([]);
        continue;
      }
      const def = MUSIC[s as keyof typeof MUSIC];
      for (const sel of p.generativeLayers) expect(def.layers.some((l) => layerMatches(l, sel)), `${s}: ${sel}`).toBe(true);
      const over = overlayDef(def, p.generativeLayers);
      if (!p.generativeLayers.length) expect(over).toBeNull();
      else {
        expect(over!.layers.length).toBeGreaterThan(0);
        expect(over!.layers.length).toBeLessThan(def.layers.length);
        // nothing struck on the beat is ever laid over a recording (their beats are not on a grid)
        expect(over!.layers.filter((l) => l.kind === 'perc' || l.kind === 'cadence' || l.kind === 'strings')).toEqual([]);
        expect(over!.bpm).toBe(def.bpm);
      }
    }
    expect(overlayDef(MUSIC.core, ['motif:bell:resolved'])!.layers.every((l) => l.when === 'resolved')).toBe(true);
  });

  it('opens level and tone with intensity', () => {
    const p = SCORE_PLAN.combatTarrik;
    const loop = loopSpec('dominion_combat', MANIFEST.dominion_combat);
    expect(planGain(p, loop, 1)).toBeGreaterThan(planGain(p, loop, 0) * 1.5);
    expect(20 * Math.log10(planGain(p, loop, 1))).toBeCloseTo(p.gain[1] - MANIFEST.dominion_combat.meanDb, 5);
    expect(planTone(p, 0)).toBeCloseTo(3200, 5);
    expect(planTone(p, 1)).toBeCloseTo(20000, 5);
    expect(planTone(p, 0.5)).toBeCloseTo(Math.sqrt(3200 * 20000), 3);
    expect(planGain(p, loop, Number.NaN)).toBe(planGain(p, loop, 0));
    // every recording stays under the limiter at full intensity (file peak × gain ≤ −2.5 dBFS)
    for (const s of STATES) {
      const q = SCORE_PLAN[s];
      if (!q.track || q.region !== 'whole') continue;
      const m = MANIFEST[q.track];
      expect(m.maxDb + 20 * Math.log10(planGain(q, loopSpec(q.track, m), 1)), s).toBeLessThanOrEqual(-2.5);
    }
  });
});

describe('loop arithmetic (against the real manifest)', () => {
  it('lists every track the table uses', () => {
    for (const t of TRACK_NAMES) expect(MANIFEST[t], t).toBeDefined();
  });

  it('loops each whole track over a whole number of bars with a 2 s tail', () => {
    for (const t of TRACK_NAMES) {
      const m = MANIFEST[t];
      const l = loopSpec(t, m);
      expect(l.xfade).toBe(LOOP_XFADE);
      expect(l.to + l.xfade).toBeCloseTo(m.seconds, 9);
      const bars = (l.to - l.from) / (240 / m.bpm);
      expect(Math.abs(bars - Math.round(bars)), `${t}: ${bars} bars`).toBeLessThan(0.01);
      expect(Math.round(bars)).toBe(m.loopBars);
      expect(loopPeriod(l)).toBeCloseTo((m.seconds - 2) / Math.pow(2, TRACKS[t].tune / 12), 9);
    }
  });

  it('loops the regions of atrium_carrier inside the file, on bar lines, clear of the next section', () => {
    const m = MANIFEST.atrium_carrier;
    const bar = 240 / m.bpm;
    const still = loopSpec('atrium_carrier', m, 'stillness');
    const swell = loopSpec('atrium_carrier', m, 'swell');
    for (const l of [still, swell]) {
      expect((l.to - l.from) / bar).toBeCloseTo(Math.round((l.to - l.from) / bar), 6);
      expect(l.intro).toBe(l.from);
      expect(l.to + l.xfade).toBeLessThanOrEqual(m.seconds);
    }
    expect(still.to + still.xfade).toBeLessThan(36); // the swell starts at ~36 s
    expect(swell.from).toBeGreaterThanOrEqual(36);
    expect(swell.to + swell.xfade).toBeLessThan(76); // the decay starts at ~76 s
    // a region a track does not have means the whole track
    expect(loopSpec('main_theme', MANIFEST.main_theme, 'swell')).toEqual(loopSpec('main_theme', MANIFEST.main_theme));
  });

  it('survives degenerate metadata', () => {
    const l = loopSpec('main_theme', { file: 'x', seconds: 1, bpm: 0, loopStart: 5, meanDb: Number.NaN, maxDb: 0 });
    expect(l.xfade).toBeCloseTo(0.25, 9);
    expect(l.to).toBeGreaterThan(l.from);
    expect(Number.isFinite(l.meanDb)).toBe(true);
    const z = loopSpec('main_theme', { file: 'x', seconds: Number.NaN, bpm: 0, loopStart: 0, meanDb: -16, maxDb: 0 });
    expect(z.to - z.from).toBe(0); // the director refuses to play this
  });
});

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

const musicFiles = (names: readonly string[]): Record<string, () => FetchResult> => {
  const files: Record<string, () => FetchResult> = { 'music/manifest.json': () => ok(Object.fromEntries(names.map((n) => [n, { ...MANIFEST[n as TrackName], seconds: 20 }])), 'application/json') };
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
  async function world(tracks: readonly string[], vo: Record<string, number> = {}): Promise<{ ctx: FakeContext; lib: AssetLibrary; engine: AudioEngine }> {
    const ctx = new FakeContext();
    const files = musicFiles(tracks);
    files['vo/manifest.json'] = () => ok(Object.fromEntries(Object.entries(vo).map(([id, seconds]) => [id, { file: `${id}.mp3`, seconds }])), 'application/json');
    for (const id of Object.keys(vo)) files[`vo/${id}.mp3`] = () => ok(null);
    const { lib } = fakeLibrary(ctx, files, 20);
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
