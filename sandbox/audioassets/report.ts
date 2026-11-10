/**
 * Offline verification of the recorded score and the voice-over chains (→ window.__assetAudioReport).
 *
 * Music: for every recording (and loop region) the game uses, the real TrackPlayer is put on the real mix
 * chain of an OfflineAudioContext, started so that a loop hand-over falls SEAM seconds into a 12 s render,
 * at the level and tone its loudest state gives it at full intensity. Checked per track:
 *   decoded / durations     the file decodes and is as long as the manifest says
 *   BARS                    the loop is a whole number of bars at the manifest tempo
 *   SCHED                   the next pass starts exactly when the last one begins to fade, and fades in as
 *                           long as the other fades out (equal power)
 *   peak                    output peak of the render (dBFS) — CLIP at ≥ −0.3
 *   GAP                     no 50 ms of the seam is more than 6 dB under the quietest 50 ms around it
 *   XFADE                   the level of the cross-fade is what the file predicts: the power of its tail and
 *                           of its head under the two fade curves, computed from the decoded samples (the
 *                           same comparison on the 3 s before the seam removes the mix chain from it).
 *                           More than +2 dB = tail and head are the same sustained sound and add in phase
 *                           (wants an equal-gain fade); less than −2 dB = a hole.
 *   CLICK                   the largest sample-to-sample step in the seam is not out of scale with the rest
 * States: every state that has a recording is played for 8 s through the whole engine (score director,
 *   generative layers underneath, mix chain), the first half at intensity 0, the second at intensity 1.
 *   LEVEL = the output at intensity 1 is not the file's own level × the plan's gain (±1.5 dB; the reference is
 *   computed from the very samples that were played, so content does not matter). CLIP as above.
 * Transitions: title → context (recording out, generative in) → combatTarrik while its file is still
 *   loading (generative first, the recording arriving 2 s later). HOLE = half a second below −50 dBFS.
 * Voice: the test clip through each channel's chain — level, peak, where its energy sits.
 */
import { AudioEngine } from '@/audio/engine';
import { AssetLibrary } from '@/audio/assets/library';
import { SCORE_PLAN, TRACKS, TRACK_NAMES, loopPeriod, loopSpec, planGain, planTone, type RegionName, type ScorePlan, type TrackName } from '@/audio/assets/mapping';
import { TrackPlayer, type PassInfo } from '@/audio/assets/player';
import { voLineId } from '@/audio/assets/voiceId';
import type { MusicState } from '@/core/api';
import { analyze } from '../audio/analyze';

export const SR = 44100;
/** render length and where in it the loop hand-over falls (s) */
const SECONDS = 12;
const SEAM = 5;

/** The line the sandbox speaks: `public/audio/vo/<voLineId(...)>.mp3` must exist while testing voice-over. */
export const TEST_LINE: readonly [string, string] = ['_test_', 'Audio assets check. One, two, three.'];

const db = (v: number): number => (v > 1e-9 ? 20 * Math.log10(v) : -180);
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface TrackRow {
  track: TrackName;
  region: RegionName;
  /** the state whose plan set the level (the loudest one that uses this part of the track) */
  state: MusicState;
  states: MusicState[];
  decoded: boolean;
  manifestSeconds: number;
  decodedSeconds: number;
  channels: number;
  sampleRate: number;
  loop: { from: number; to: number; xfade: number; rate: number; periodHeard: number; bars: number };
  schedule: PassInfo[];
  /** render time of the hand-over and the length of the cross-fade as heard */
  seamAt: number;
  fadeHeard: number;
  peakDb: number;
  /** RMS of the 3 s before the seam, the seam itself, the 3 s after (dBFS, at the output) */
  beforeDb: number;
  seamDb: number;
  afterDb: number;
  /** quietest 50 ms inside the seam minus the quietest 50 ms around it (dB) */
  gapDb: number;
  /** level of the cross-fade as rendered minus what the file's tail and head predict (dB; 0 = ideal) */
  seamErrorDb: number;
  /** largest sample step inside the seam ÷ largest outside */
  clickRatio: number;
  flags: string[];
}

export interface VoiceRow {
  channel: string;
  seconds: number;
  returned: number;
  peakDb: number;
  rmsDb: number;
  loudDb: number;
  centroidHz: number;
  /** share of energy <80, 80–250, 250–2k, 2k–8k, >8k Hz */
  bands: number[];
  /** right minus left level (dB): the speaker stands 6 m to the listener's right */
  panDb: number;
  flags: string[];
}

export interface StateRow {
  state: MusicState;
  track: TrackName;
  /** what the engine reported as carrying the state */
  carriedBy: string | null;
  /** generative layers left playing underneath */
  generative: string[];
  /** output RMS (dBFS) over the half at intensity 0 and the half at intensity 1 */
  lowDb: number;
  highDb: number;
  /** the plan's level for intensity 1 (dBFS RMS over the whole looped part) */
  targetDb: number;
  /** output at intensity 1 minus (the played samples' own RMS × the plan's gain) */
  levelErrorDb: number;
  peakDb: number;
  flags: string[];
}

export interface TransitionRow {
  script: string;
  /** output RMS per half second (dBFS) */
  timeline: number[];
  /** what carried the music at each second */
  carriedBy: Array<string | null>;
  peakDb: number;
  flags: string[];
}

export interface AssetReport {
  manifest: 'ready' | 'missing';
  tracks: TrackRow[];
  states: StateRow[];
  transitions: TransitionRow[];
  voice: { id: string; found: boolean; rows: VoiceRow[] };
  mapping: Record<string, string>;
  flagged: string[];
}

/** Every (track, region) the score plan uses, with the loudest state that uses it. */
function usages(): Array<{ track: TrackName; region: RegionName; state: MusicState; plan: ScorePlan; states: MusicState[] }> {
  const out = new Map<string, { track: TrackName; region: RegionName; state: MusicState; plan: ScorePlan; states: MusicState[] }>();
  for (const [state, plan] of Object.entries(SCORE_PLAN) as Array<[MusicState, ScorePlan]>) {
    if (!plan.track) continue;
    const key = `${plan.track}:${plan.region}`;
    const u = out.get(key);
    if (!u) out.set(key, { track: plan.track, region: plan.region, state, plan, states: [state] });
    else {
      u.states.push(state);
      if (plan.gain[1] > u.plan.gain[1]) {
        u.state = state;
        u.plan = plan;
      }
    }
  }
  return [...out.values()].sort((a, b) => TRACK_NAMES.indexOf(a.track) - TRACK_NAMES.indexOf(b.track));
}

/** RMS (power-averaged over channels) of 50 ms windows hopping 25 ms between two times. */
function windows(buf: AudioBuffer, from: number, to: number): number[] {
  const w = Math.round(0.05 * buf.sampleRate);
  const hop = w >> 1;
  const s0 = Math.max(0, Math.round(from * buf.sampleRate));
  const s1 = Math.min(buf.length, Math.round(to * buf.sampleRate));
  const out: number[] = [];
  for (let s = s0; s + w <= s1; s += hop) {
    let p = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = s; i < s + w; i++) p += d[i] * d[i];
    }
    out.push(Math.sqrt(p / (w * buf.numberOfChannels)));
  }
  return out;
}

/** RMS of one channel between two times. */
function channelRms(buf: AudioBuffer, channel: number, from: number, to: number): number {
  const d = buf.getChannelData(Math.min(channel, buf.numberOfChannels - 1));
  const s0 = Math.max(0, Math.round(from * buf.sampleRate));
  const s1 = Math.min(buf.length, Math.round(to * buf.sampleRate));
  let p = 0;
  for (let i = s0; i < s1; i++) p += d[i] * d[i];
  return Math.sqrt(p / Math.max(1, s1 - s0));
}

/** Mean power of `seconds` of a buffer from `at`, each sample weighted by `w(0..1 through the stretch)`². */
function weightedPower(buf: AudioBuffer, at: number, seconds: number, w: (x: number) => number): number {
  const s0 = Math.max(0, Math.round(at * buf.sampleRate));
  const n = Math.max(1, Math.min(buf.length - s0, Math.round(seconds * buf.sampleRate)));
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const v = d[s0 + i] * w(i / n);
      p += v * v;
    }
  }
  return p / (n * buf.numberOfChannels);
}

const mean = (a: number[]): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

function maxStep(buf: AudioBuffer, from: number, to: number): number {
  const s0 = Math.max(1, Math.round(from * buf.sampleRate));
  const s1 = Math.min(buf.length, Math.round(to * buf.sampleRate));
  let m = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = s0; i < s1; i++) {
      const a = Math.abs(d[i] - d[i - 1]);
      if (a > m) m = a;
    }
  }
  return m;
}

export interface ReportOpts {
  onProgress?(text: string): void;
  /** receives each rendered buffer (`track:region` or `voice:channel`) for display */
  keep?(key: string, buf: AudioBuffer, seamAt?: number, fade?: number): void;
}

/**
 * Render `seconds` of the whole engine, driven like the game drives it: `tick(engine, t)` then
 * `engine.update()` twenty times a second (the context is suspended while a tick awaits).
 */
async function renderEngine(lib: AssetLibrary, seconds: number, tick: (engine: AudioEngine, t: number, frame: number) => void | Promise<void>): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const engine = new AudioEngine(ctx, { seed: 7283, samples: false, assets: lib });
  const dt = 1 / 20;
  let last = 0;
  for (let i = 0; i * dt < seconds - 0.001; i++) {
    const t = i * dt;
    const step = async (): Promise<void> => {
      await tick(engine, t, i);
      engine.update(t - last);
      last = t;
    };
    if (i === 0) await step();
    else void ctx.suspend(t).then(step).then(() => ctx.resume());
  }
  try {
    return await ctx.startRendering();
  } finally {
    engine.dispose();
  }
}

/** Play each recorded state through the engine and compare its output level with the plan. */
async function stateRows(lib: AssetLibrary, o: ReportOpts): Promise<StateRow[]> {
  const rows: StateRow[] = [];
  const HALF = 4;
  for (const [state, plan] of Object.entries(SCORE_PLAN) as Array<[MusicState, ScorePlan]>) {
    const track = plan.track;
    if (!track) continue;
    o.onProgress?.(`state ${state}…`);
    lib.pin([track]);
    const buffer = await lib.requestTrack(track);
    const meta = lib.trackMeta(track);
    if (!buffer || !meta) continue;
    let carriedBy: string | null = null;
    let generative: string[] = [];
    const out = await renderEngine(lib, HALF * 2, (engine, t, frame) => {
      if (frame === 0) {
        engine.setIntensity(0, true);
        engine.setMusic(state, 0.05);
      }
      if (Math.abs(t - HALF) < 1e-6) engine.setIntensity(1, true);
      if (Math.abs(t - 6) < 1e-6) {
        carriedBy = engine.score.track;
        generative = (engine.music.activeDeck?.def.layers ?? []).map((l) => ('voice' in l ? `${l.kind}:${l.voice}` : l.kind));
      }
    });
    const loop = loopSpec(track, meta, plan.region);
    // the second half: 1 s for the level and tone to finish moving, then 3 s to measure
    const from = HALF + 1;
    const played = Math.sqrt(weightedPower(buffer, loop.intro + from * loop.rate, (HALF * 2 - from) * loop.rate, () => 1)) * planGain(plan, loop, 1);
    const highDb = db(mean(windows(out, from, HALF * 2)));
    const m = analyze(out, 0.3);
    const flags: string[] = [];
    // (states that keep generative layers, or close the low-pass, are not expected to match the file alone)
    const plain = !plan.generativeLayers.length && plan.tone[1] >= 16000;
    const levelErrorDb = highDb - db(played);
    if (carriedBy !== track) flags.push('NOT-RECORDED');
    if (plain && Math.abs(levelErrorDb) > 1.5) flags.push('LEVEL');
    if (m.peakDb >= -0.3) flags.push('CLIP');
    if (m.silent) flags.push('SILENT');
    rows.push({ state, track, carriedBy, generative, lowDb: r1(db(mean(windows(out, 1, HALF)))), highDb: r1(highDb), targetDb: plan.gain[1], levelErrorDb: r1(levelErrorDb), peakDb: m.peakDb, flags });
    o.keep?.(`state:${state}`, out);
  }
  return rows;
}

/** A recording leaving for the generative score, and one arriving late over it. */
async function transitionRows(o: ReportOpts): Promise<TransitionRow[]> {
  o.onProgress?.('transitions…');
  // its own library, whose network holds dominion_combat back until the script lets it through
  const decoder = new OfflineAudioContext(2, 1, SR);
  let release = (): void => {};
  const gate = new Promise<void>((r) => { release = r; });
  const lib = new AssetLibrary({
    baseUrl: import.meta.env.BASE_URL, decoder: () => decoder,
    fetcher: async (url) => {
      if (url.includes('dominion_combat')) await gate;
      return fetch(url);
    },
  });
  await lib.loadMusic();
  await lib.requestTrack('main_theme');
  const carriedBy: Array<string | null> = [];
  const SECONDS_T = 16;
  const out = await renderEngine(lib, SECONDS_T, async (engine, t, frame) => {
    const at = (x: number): boolean => Math.abs(t - x) < 1e-6;
    if (frame === 0) {
      engine.setIntensity(0.6, true);
      engine.setMusic('title', 0.05);
    }
    if (at(4)) engine.setMusic('context', 2);
    if (at(8)) engine.setMusic('combatTarrik', 1);
    // the file arrives two seconds into the state
    if (at(10)) {
      release();
      await lib.requestTrack('dominion_combat');
    }
    if (frame % 20 === 0) carriedBy.push(engine.score.track);
  });
  const timeline: number[] = [];
  for (let t = 0; t + 0.5 <= SECONDS_T; t += 0.5) timeline.push(r1(db(mean(windows(out, t, t + 0.5)))));
  const m = analyze(out, 0.3);
  const flags: string[] = [];
  if (timeline.slice(1).some((v) => v < -50)) flags.push('HOLE');
  if (m.peakDb >= -0.3) flags.push('CLIP');
  if (carriedBy[2] !== 'main_theme' || carriedBy[6] !== null || carriedBy[9] !== null || carriedBy[11] !== 'dominion_combat') flags.push('ORDER');
  o.keep?.('transition:title→context→combatTarrik (late)', out);
  return [{ script: 'title 0 s → context 4 s → combatTarrik 8 s at intensity 0.6 (its file arrives at 10 s: generative until then)', timeline, carriedBy, peakDb: m.peakDb, flags }];
}

export async function buildAssetReport(o: ReportOpts = {}): Promise<AssetReport> {
  const decoder = new OfflineAudioContext(2, 1, SR);
  const lib = new AssetLibrary({ baseUrl: import.meta.env.BASE_URL, decoder: () => decoder });
  const manifest = await lib.loadMusic();
  const tracks: TrackRow[] = [];
  for (const u of usages()) {
    o.onProgress?.(`rendering ${u.track} (${u.region})…`);
    const meta = lib.trackMeta(u.track);
    lib.pin([u.track]);
    const buffer = await lib.requestTrack(u.track);
    const flags: string[] = [];
    if (!meta || !buffer) {
      tracks.push({
        track: u.track, region: u.region, state: u.state, states: u.states, decoded: false, manifestSeconds: meta?.seconds ?? 0, decodedSeconds: 0, channels: 0, sampleRate: 0,
        loop: { from: 0, to: 0, xfade: 0, rate: 1, periodHeard: 0, bars: 0 }, schedule: [], seamAt: 0, fadeHeard: 0, peakDb: -180, beforeDb: -180, seamDb: -180, afterDb: -180, gapDb: 0, seamErrorDb: 0, clickRatio: 0,
        flags: [meta ? 'UNDECODED' : 'MISSING'],
      });
      continue;
    }
    const loop = loopSpec(u.track, meta, u.region);
    const bars = meta.bpm > 0 ? (loop.to - loop.from) / (240 / meta.bpm) : 0;
    if (Math.abs(bars - Math.round(bars)) > 0.01) flags.push('BARS');
    if (Math.abs(buffer.duration - meta.seconds) > 0.15) flags.push('LENGTH');
    if (loop.to + loop.xfade > buffer.duration + 0.06) flags.push('SHORT');

    const ctx = new OfflineAudioContext(2, SECONDS * SR, SR);
    const engine = new AudioEngine(ctx, { seed: 1, samples: false });
    const player = new TrackPlayer(ctx, engine.mixer.musicDirect);
    // start late in the first pass, so its hand-over to the second falls SEAM seconds in
    player.play(`${u.track}:${u.region}`, buffer, { ...loop, intro: loop.to - SEAM * loop.rate }, planGain(u.plan, loop, 1), planTone(u.plan, 1), 0, 0.05);
    player.update(SECONDS + 4);
    const schedule = player.schedule();
    const fade = loop.xfade / loop.rate;
    const [a, b] = schedule;
    if (schedule.length !== 2 || Math.abs(b.startAt - a.handoverAt) > 1e-6 || Math.abs(b.fadeIn - fade) > 1e-6 || Math.abs(a.handoverAt - SEAM) > 1e-6
      || Math.abs(b.offset - loop.from) > 1e-9 || Math.abs(b.handoverAt - b.startAt - loopPeriod(loop)) > 1e-6 || a.stopAt < a.handoverAt + fade) flags.push('SCHED');
    const out = await ctx.startRendering();
    engine.dispose();

    const pad = 0.1;
    const before = windows(out, SEAM - 3, SEAM - pad);
    const seam = windows(out, SEAM - pad, SEAM + fade + pad);
    const after = windows(out, SEAM + fade + pad, SEAM + fade + 3);
    const around = Math.min(...before, ...after);
    const gapDb = db(Math.min(...seam)) - db(around);
    const peak = analyze(out, 0.5).peak;
    // what an equal-power fade of this tail into this head must measure, against what was rendered
    const gain = planGain(u.plan, loop, 1);
    const expectSeam = Math.sqrt(weightedPower(buffer, loop.to, loop.xfade, (x) => Math.cos((x * Math.PI) / 2)) + weightedPower(buffer, loop.from, loop.xfade, (x) => Math.sin((x * Math.PI) / 2))) * gain;
    const expectBefore = Math.sqrt(weightedPower(buffer, loop.to - 3 * loop.rate, 3 * loop.rate, () => 1)) * gain;
    const seamErrorDb = db(mean(windows(out, SEAM, SEAM + fade))) - db(expectSeam) - (db(mean(windows(out, SEAM - 3, SEAM))) - db(expectBefore));
    const clickRatio = maxStep(out, SEAM - pad, SEAM + fade + pad) / Math.max(1e-9, maxStep(out, 0.5, SEAM - pad), maxStep(out, SEAM + fade + pad, SECONDS));
    if (db(peak) >= -0.3) flags.push('CLIP');
    if (gapDb < -6) flags.push('GAP');
    if (Math.abs(seamErrorDb) > 2) flags.push('XFADE');
    if (clickRatio > 2) flags.push('CLICK');
    if (!(db(mean(before)) > -70) || !(db(mean(after)) > -70)) flags.push('SILENT');
    o.keep?.(`${u.track}:${u.region}`, out, SEAM, fade);
    tracks.push({
      track: u.track, region: u.region, state: u.state, states: u.states, decoded: true, manifestSeconds: meta.seconds, decodedSeconds: Math.round(buffer.duration * 1000) / 1000,
      channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate,
      loop: { from: r3(loop.from), to: r3(loop.to), xfade: loop.xfade, rate: Math.round(loop.rate * 1e4) / 1e4, periodHeard: Math.round(loopPeriod(loop) * 1000) / 1000, bars: Math.round(bars * 1000) / 1000 },
      schedule, seamAt: SEAM, fadeHeard: Math.round(fade * 1000) / 1000, peakDb: r1(db(peak)), beforeDb: r1(db(mean(before))), seamDb: r1(db(mean(seam))), afterDb: r1(db(mean(after))),
      gapDb: r1(gapDb), seamErrorDb: r1(seamErrorDb), clickRatio: Math.round(clickRatio * 100) / 100, flags,
    });
  }

  const states = manifest ? await stateRows(lib, o) : [];
  const transitions = manifest ? await transitionRows(o) : [];

  // --- voice-over: the test clip through each channel ---
  const id = voLineId(TEST_LINE[0], TEST_LINE[1]);
  await lib.loadVoices();
  const clip = await lib.requestClip(id);
  const rows: VoiceRow[] = [];
  if (clip) {
    for (const channel of ['voice', 'radio', 'system', 'narration'] as const) {
      o.onProgress?.(`rendering voice (${channel})…`);
      const seconds = clip.buffer.duration + 1;
      const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
      const engine = new AudioEngine(ctx, { seed: 1, samples: false, assets: lib });
      let returned = 0;
      void ctx.suspend(0.25).then(() => {
        // a speaker 6 m to the listener's right (the listener faces north)
        engine.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 });
        returned = engine.voice(TEST_LINE[0], TEST_LINE[1], { channel, pos: { x: 6, y: 1.6, z: 0 } });
        void ctx.resume();
      });
      const out = await ctx.startRendering();
      engine.dispose();
      const m = analyze(out, 0.25);
      const flags: string[] = [];
      if (!(returned > 0)) flags.push('NOT-PLAYED');
      if (m.silent) flags.push('SILENT');
      if (m.peakDb >= -0.3) flags.push('CLIP');
      const pan = db(channelRms(out, 1, 0.25, seconds)) - db(channelRms(out, 0, 0.25, seconds));
      // positional lines lean toward the speaker; system and narration stay centred
      if ((channel === 'voice' || channel === 'radio') && !(pan > 1 && pan < 12)) flags.push('PAN');
      if ((channel === 'system' || channel === 'narration') && Math.abs(pan) > 0.3) flags.push('PAN');
      if ((channel === 'radio' || channel === 'system') && m.bands[4] > 0.02) flags.push('WIDEBAND');
      rows.push({ channel, seconds: Math.round(clip.buffer.duration * 100) / 100, returned: Math.round(returned * 100) / 100, peakDb: m.peakDb, rmsDb: m.rmsDb, loudDb: m.loudDb, centroidHz: m.spectralCentroidHz, bands: m.bands, panDb: r1(pan), flags });
      o.keep?.(`voice:${channel}`, out);
    }
  }

  const mapping: Record<string, string> = {};
  for (const [state, plan] of Object.entries(SCORE_PLAN)) {
    mapping[state] = plan.track
      ? `${plan.track}${plan.region === 'whole' ? '' : `[${plan.region}]`} ${plan.gain[0]}…${plan.gain[1]} dB${TRACKS[plan.track].tune ? ` tune ${TRACKS[plan.track].tune > 0 ? '+' : ''}${TRACKS[plan.track].tune}` : ''}${plan.generativeLayers.length ? ` + ${plan.generativeLayers.join(', ')}` : ''}`
      : `generative${plan.generativeDb ? ` ${plan.generativeDb} dB` : ''}`;
  }
  const flagged = [
    ...tracks.filter((t) => t.flags.length).map((t) => `${t.track}:${t.region} ${t.flags.join(' ')}`),
    ...states.filter((t) => t.flags.length).map((t) => `state:${t.state} ${t.flags.join(' ')}`),
    ...transitions.filter((t) => t.flags.length).map((t) => `transition ${t.flags.join(' ')}`),
    ...rows.filter((v) => v.flags.length).map((v) => `voice:${v.channel} ${v.flags.join(' ')}`),
    ...(manifest ? [] : ['music manifest missing']),
    ...(clip ? [] : ['voice test clip missing']),
  ];
  return { manifest: manifest ? 'ready' : 'missing', tracks, states, transitions, voice: { id, found: !!clip, rows }, mapping, flagged };
}
