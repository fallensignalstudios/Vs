/**
 * Polish 4 (audio): music played once with a quiet bed after it, the wound_vista level, the voice-over envelope.
 */
import { describe, expect, it } from 'vitest';
import MANIFEST_JSON from '../../../public/audio/music/manifest.json?raw';
import { AudioEngine } from '../engine';
import { FakeBuffer, FakeContext } from '../testing/fake-context';
import { AssetLibrary, type FetchResult } from './library';
import { mpegDuration } from './sniff';
import { BED_LAYERS, BED_LEAD, loopSpec, onceSpec, planGain, SCORE_PLAN, type TrackMeta, type TrackName } from './mapping';
import { TrackPlayer } from './player';
import { envelopeOf } from './voice';
import { voLineId } from './voiceId';

const MANIFEST = JSON.parse(MANIFEST_JSON) as Record<TrackName, TrackMeta>;

const ok = (body: unknown, type = 'audio/mpeg', bytes: () => ArrayBuffer = () => new ArrayBuffer(4096)): FetchResult => ({
  ok: true,
  headers: { get: (n) => (n === 'content-type' ? type : null) },
  arrayBuffer: async () => bytes(),
  json: async () => body,
});

function fakeMp3(seconds: number): ArrayBuffer {
  const frames = Math.max(2, Math.round((seconds * 44100) / 1152));
  const b = new Uint8Array(frames * 417);
  for (let f = 0; f < frames; f++) b.set([0xff, 0xfb, 0x90, 0x00], f * 417);
  return b.buffer;
}

/** an engine over a fake network: music tracks `seconds` long, voice lines (id → seconds) with a 1 s burst at 0.5 s */
async function world(tracks: readonly TrackName[], vo: Record<string, number> = {}, seconds = 20): Promise<{ ctx: FakeContext; lib: AssetLibrary; engine: AudioEngine }> {
  const ctx = new FakeContext();
  const files: Record<string, () => FetchResult> = {
    'music/manifest.json': () => ok(Object.fromEntries(tracks.map((n) => [n, { ...MANIFEST[n], seconds }])), 'application/json'),
    'vo/manifest.json': () => ok(Object.fromEntries(Object.entries(vo).map(([id, s]) => [id, { file: `${id}.mp3`, seconds: s }])), 'application/json'),
  };
  for (const n of tracks) files[`music/${n}.mp3`] = () => ok(null);
  for (const [id, s] of Object.entries(vo)) files[`vo/${id}.mp3`] = () => ok(null, 'audio/mpeg', () => fakeMp3(s));
  (ctx as unknown as { decodeAudioData: (b: ArrayBuffer) => Promise<FakeBuffer> }).decodeAudioData = async (b: ArrayBuffer) => {
    const voice = b.byteLength !== 4096;
    if (voice && !(mpegDuration(b) > 0)) throw new Error('not audio');
    const len = voice ? Math.round(mpegDuration(b) * 44100) : Math.round(seconds * 44100);
    const buf = new FakeBuffer(1, len, 44100);
    const d = buf.getChannelData(0);
    if (voice) for (let i = Math.round(0.5 * 44100); i < Math.min(len, Math.round(1.5 * 44100)); i++) d[i] = Math.sin(i * 0.05) * 0.5;
    else d.fill(0.05);
    return buf;
  };
  const fetcher = async (url: string): Promise<FetchResult> => {
    const f = files[url.replace(/^\/audio\//, '')];
    return f ? f() : { ok: false, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
  };
  const lib = new AssetLibrary({ baseUrl: '/', decoder: () => ctx.asContext(), fetcher });
  await lib.loadMusic();
  await lib.loadVoices();
  return { ctx, lib, engine: new AudioEngine(ctx.asContext(), { seed: 5, assets: lib }) };
}

function run(ctx: FakeContext, each: (dt: number) => void, seconds: number, dt = 0.05): void {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.currentTime += dt;
    each(dt);
  }
}

describe('music played once (setMusic … { once: true })', () => {
  it('the player schedules one pass to the end of the file and nothing after it', () => {
    const ctx = new FakeContext();
    const p = new TrackPlayer(ctx.asContext(), ctx.asContext().createGain());
    const buf = new FakeBuffer(2, 44100 * 20, 44100) as unknown as AudioBuffer;
    const loop = onceSpec({ intro: 0, from: 0, to: 18, xfade: 2, rate: 1, meanDb: -16 }, { ...MANIFEST.witness_elegy, seconds: 20 }, 20);
    expect(loop.once).toBe(true);
    expect(loop.end).toBe(20);
    p.play('witness_elegy:whole:once', buf, loop, 0.5, 20000, 1, 1);
    const seen = new Set<number>();
    run(ctx, () => { p.update(1.5); for (const s of p.schedule()) seen.add(s.k); }, 60);
    expect([...seen]).toEqual([0]);
    expect(p.endsAt).toBeCloseTo(21, 9); // starts at 1, plays the whole 20 s file
    expect(ctx.problems).toEqual([]);
  });

  it('the state then holds a quiet bed of its own pads and held tones, and stays the same state', async () => {
    const { ctx, lib, engine } = await world(['witness_elegy']);
    await lib.requestTrack('witness_elegy');
    engine.setMusic('witness', 1, { once: true });
    expect(engine.score.track).toBe('witness_elegy');
    expect(engine.score.player.key).toBe('witness_elegy:whole:once');
    expect(engine.music.activeDeck).toBeNull(); // the elegy plays alone
    const passes = new Set<number>();
    const each = (dt: number): void => { engine.update(dt); for (const s of engine.score.player.schedule()) passes.add(s.k); };
    run(ctx, each, 20 - BED_LEAD - 2);
    expect(engine.music.activeDeck).toBeNull();
    run(ctx, each, 30);
    expect([...passes]).toEqual([0]); // never came round again
    const kinds = engine.music.activeDeck!.def.layers.map((l) => l.kind);
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(BED_LAYERS).toContain(k);
    expect(engine.music.state).toBe('witness');
    // asking for the same state again does not restart the piece
    engine.setMusic('witness', 1, { once: true });
    run(ctx, each, 5);
    expect([...passes]).toEqual([0]);
    expect(ctx.problems).toEqual([]);
  });

  it('without `once` the recording loops as before', async () => {
    const { ctx, lib, engine } = await world(['farewell_departure']);
    await lib.requestTrack('farewell_departure');
    engine.setMusic('farewell', 1);
    const passes = new Set<number>();
    run(ctx, (dt) => { engine.update(dt); for (const s of engine.score.player.schedule()) passes.add(s.k); }, 45);
    expect(passes.size).toBeGreaterThanOrEqual(2);
    expect(engine.score.player.key).toBe('farewell_departure:whole');
    expect(ctx.problems).toEqual([]);
  });
});

describe('wound_vista level', () => {
  it('is set by its looped section (−15.7 dB), not by the whole file with its sparse reveal (−16.8 dB)', () => {
    const l = loopSpec('wound_vista', MANIFEST.wound_vista);
    expect(MANIFEST.wound_vista.meanDb).toBeCloseTo(-16.8, 6);
    expect(l.meanDb).toBeCloseTo(-15.7, 6);
    // later passes now sit at the plan's −23 dB: 1.1 dB under what the whole-file mean gave
    const g = planGain(SCORE_PLAN.woundVista, l, 0);
    const before = planGain(SCORE_PLAN.woundVista, { ...l, meanDb: MANIFEST.wound_vista.meanDb }, 0);
    expect(20 * Math.log10(before / g)).toBeCloseTo(1.1, 6);
    // the other tracks keep their manifest means
    expect(loopSpec('witness_elegy', MANIFEST.witness_elegy).meanDb).toBe(MANIFEST.witness_elegy.meanDb);
  });
});

describe('voice-over envelope (head motion while speaking)', () => {
  it('follows the clip: loud in the burst, silent around it', () => {
    const buf = new FakeBuffer(1, 44100 * 2, 44100);
    const d = buf.getChannelData(0);
    for (let i = 22050; i < 66150; i++) d[i] = Math.sin(i * 0.05) * 0.5;
    const env = envelopeOf(buf as unknown as AudioBuffer);
    expect(env.length).toBe(200);
    expect(env[10]).toBe(0);
    expect(Math.max(...env)).toBeCloseTo(1, 6);
    expect(env[100]).toBeGreaterThan(0.9);
    expect(envelopeOf(buf as unknown as AudioBuffer)).toBe(env); // cached per clip
  });

  it('VoicePlayer.level is −1 with nothing said, follows the line while it sounds', async () => {
    const id = voLineId('Selene', 'Hold the plane.');
    const { ctx, lib, engine } = await world([], { [id]: 3 });
    await lib.requestClip(id);
    expect(engine.vo.level()).toBe(-1);
    expect(engine.voice('Selene', 'Hold the plane.')).toBeGreaterThan(2);
    run(ctx, (dt) => engine.update(dt), 0.2);
    expect(engine.vo.level()).toBeCloseTo(0, 3);
    run(ctx, (dt) => engine.update(dt), 0.6);
    expect(engine.vo.level()).toBeGreaterThan(0.8);
    run(ctx, (dt) => engine.update(dt), 3);
    expect(engine.vo.level()).toBe(-1);
  });
});
