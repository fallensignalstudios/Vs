/**
 * Which recording carries which MusicState — the table, and the pure arithmetic around it (loop regions,
 * levels, the generative layers that keep playing underneath). No WebAudio in this file.
 *
 * The recorded score is seven tracks in `public/audio/music/` (see its manifest.json). Three facts about
 * them shape this table; all three were measured from the files, not assumed:
 *  - Their beats do NOT sit on the nominal tempo grid tightly enough to lock generative percussion to
 *    (onset energy folded on the manifest tempo is flat for every track). So no generative rhythm is ever
 *    laid against a recording's beat; `setIntensity` opens the recording's level and low-pass instead.
 *    What may stay underneath is free-time material only: an air pad, a bell phrase, a held brass pedal,
 *    the alignment clockwork ticking by itself over a drone.
 *  - `atrium_carrier` is one piece with three scenes in it: a still opening (0–36 s, about −17 dB), the
 *    emergency swell (36–76 s, about −12.5 dB) and a quiet coda. The atrium and the duel loop the still
 *    part, the carrier rescue loops the swell — each at its own level.
 *  - `core_witness` is a C drone (C 0 dB, G −11, E♭ −14) that never resolves, while every King-era story
 *    cue in the game — both assent tones, recognitionTone, meridianComplete — is tuned in D. It is played
 *    a whole tone up (rate 2^(2/12)), which puts the drone on D/A under those cues, and the Meridian's
 *    resolution is carried by the generative `resolved` bell phrase over it.
 */
import { clamp, clamp01, lerp } from '@/core/mathx';
import type { MusicState } from '@/core/api';
import type { Layer, MusicDef } from '../music/types';

export const TRACK_NAMES = ['main_theme', 'dominion_combat', 'frozen_stealth', 'relay_combat', 'atrium_carrier', 'eclipse_combat', 'core_witness'] as const;
export type TrackName = (typeof TRACK_NAMES)[number];

/** One entry of `public/audio/music/manifest.json`. */
export interface TrackMeta {
  file: string;
  /** length of the audio in the file (s); the final LOOP_XFADE seconds repeat under the next pass */
  seconds: number;
  bpm: number;
  /** where passes after the first begin (s) */
  loopStart: number;
  /** mean (RMS) level of the whole file, dBFS */
  meanDb: number;
  /** sample peak, dBFS */
  maxDb: number;
  loopBars?: number;
  key?: string;
  notes?: string;
}

export type MusicManifest = Readonly<Partial<Record<string, TrackMeta>>>;

/** One entry of `public/audio/vo/manifest.json` (keyed by `voLineId`). */
export interface VoiceMeta {
  file: string;
  seconds: number;
  /**
   * Zone the line is first spoken in ('Z07'). Clips of the zone being loaded and of the next one are fetched
   * (compressed) on `zone:loading`; entries without a zone are fetched after those, once. Optional.
   */
  zone?: string;
}

/** Seconds at the end of each track that cross-fade (equal power) under the start of the next pass. */
export const LOOP_XFADE = 2;

export type RegionName = 'whole' | 'stillness' | 'swell';

/** A part of a track that can loop on its own: bar-aligned bounds (s) and its measured mean level. */
interface Region {
  from: number;
  to: number;
  meanDb: number;
}

/** What the engine knows about each recording beyond its manifest entry. */
export interface TrackInfo {
  /** key centre as heard (after `tune`), MIDI in the bass register — stingers are played in it */
  tonic: number;
  /** transposition in semitones, by playback rate (tempo follows) */
  tune: number;
  /**
   * where the piece is in full flow (s, on a bar line): a state entered at high intensity starts its first
   * pass here instead of sitting through a sparse introduction while the fight is already on
   */
  body?: number;
  regions?: Readonly<Partial<Record<RegionName, Region>>>;
}

const BAR_ATRIUM = 240 / 72;

export const TRACKS: Readonly<Record<TrackName, TrackInfo>> = {
  main_theme: { tonic: 38, tune: 0 },
  // sparse low hits for the first 20 s; the ostinato is in from bar 9 (19.2 s)
  dominion_combat: { tonic: 36, tune: 0, body: 19.2 },
  frozen_stealth: { tonic: 38, tune: 0 },
  // a lighter arpeggio for 15 s (8 bars), then the drive
  relay_combat: { tonic: 38, tune: 0, body: 15 },
  atrium_carrier: {
    tonic: 33, tune: 0,
    regions: {
      // bars 1–10: past the file's own fade-in, and its tail (to 35.3 s) ends before the swell arrives
      stillness: { from: BAR_ATRIUM, to: 10 * BAR_ATRIUM, meanDb: -17 },
      // bars 11–22: the tail (to 75.3 s) ends before the decay at 76 s
      swell: { from: 11 * BAR_ATRIUM, to: 22 * BAR_ATRIUM, meanDb: -12.5 },
    },
  },
  eclipse_combat: { tonic: 38, tune: 0 },
  core_witness: { tonic: 38, tune: 2 },
};

/** How a MusicState is scored. */
export interface ScorePlan {
  /** the recording that carries the state; null = the generative score plays alone, as it always did */
  track: TrackName | null;
  /** part of the track that loops */
  region: RegionName;
  /**
   * level of the recording: dBFS RMS at the output with the reference volume settings, at intensity 0 and
   * at intensity 1 (the generative states sit between −27 and −19 by the same measure)
   */
  gain: readonly [number, number];
  /** low-pass on the recording (Hz) at intensity 0 and at intensity 1 */
  tone: readonly [number, number];
  /**
   * layers of the state's own generative definition that stay under the recording, as
   * `kind[:voice or instrument][:when]` selectors (`pad:air`, `motif:bell:resolved`, `brass`). Empty =
   * the generative score is silent while the recording plays. Ignored when `track` is null.
   */
  generativeLayers: readonly string[];
  /** trim (dB) on the generative score when it plays alone */
  generativeDb: number;
  /** a recording to have decoded while this state lasts — the state that usually comes next */
  warm: TrackName | null;
}

const OPEN = [20000, 20000] as const;

const gen = (generativeDb = 0, warm: TrackName | null = null): ScorePlan =>
  ({ track: null, region: 'whole', gain: [-120, -120], tone: OPEN, generativeLayers: [], generativeDb, warm });

const rec = (
  track: TrackName, gain: number | readonly [number, number],
  o: { tone?: readonly [number, number]; region?: RegionName; layers?: readonly string[]; warm?: TrackName } = {},
): ScorePlan => ({
  track, region: o.region ?? 'whole', gain: typeof gain === 'number' ? [gain, gain] : gain, tone: o.tone ?? OPEN,
  generativeLayers: o.layers ?? [], generativeDb: 0, warm: o.warm ?? null,
});

/** The Meridian's resolution over the (never resolving) recording: the generative bell phrase with the third. */
const RESOLVED_BELL = ['motif:bell:resolved'] as const;

export const SCORE_PLAN: Readonly<Record<MusicState, ScorePlan>> = {
  silence: gen(),
  title: rec('main_theme', -20),
  credits: rec('main_theme', -19),
  departure: rec('main_theme', -22),

  context: gen(),
  // generative and held back, so the recorded battle cue arrives as a step up
  approachTarrik: gen(-3, 'dominion_combat'),
  combatTarrik: rec('dominion_combat', [-22, -17.5], { tone: [3200, 20000] }),

  // the recording is dark (little above 3 kHz): the generative air is the top end, and tightens with intensity
  approachSelene: rec('frozen_stealth', [-24, -21], { layers: ['pad:air'], warm: 'relay_combat' }),
  stealth: rec('frozen_stealth', [-25, -21.5], { layers: ['pad:air'], warm: 'relay_combat' }),
  combatSelene: rec('relay_combat', [-22, -18], { tone: [3600, 20000] }),

  // one recording, three scenes: dynamics come from the region and the state level, not from the file
  atrium: rec('atrium_carrier', [-23, -21], { region: 'stillness' }),
  duel: rec('atrium_carrier', [-25, -22], { region: 'stillness' }),
  carrier: rec('atrium_carrier', [-18, -16.5], { region: 'swell' }),

  breach: gen(0, 'eclipse_combat'),
  combatEclipse: rec('eclipse_combat', [-22, -17.5], { tone: [3000, 20000] }),
  elite: rec('eclipse_combat', [-20.5, -17], { tone: [4000, 20000] }),
  // the Resonance window: the fight sinks under water; Frost's glass above and Cinder's pedal below stay generative
  resonance: rec('eclipse_combat', -28, { tone: [650, 650], layers: ['pad:glass', 'pad:air', 'brass'] }),
  decision: gen(0, 'eclipse_combat'),

  quarantine: gen(0, 'core_witness'),
  recognition: rec('core_witness', -25, { layers: RESOLVED_BELL }),
  // the clockwork of the alignment is free-time ticking over the drone, and follows intensity
  core: rec('core_witness', [-24, -21.5], { layers: ['motif:bell:resolved', 'pulse:clock'] }),
  witness: rec('core_witness', -21, { layers: RESOLVED_BELL }),
  consequence: rec('core_witness', -24, { layers: RESOLVED_BELL }),
  // under unhurried voices: the drone far back and dark, the soft keyboard in front of it
  observation: rec('core_witness', -29, { tone: [2400, 2400], layers: ['pad:felt', 'motif:felt'] }),
};

/** The plan for a state (an unknown state is scored like `silence`). */
export function scorePlan(state: MusicState): ScorePlan {
  return Object.prototype.hasOwnProperty.call(SCORE_PLAN, state) ? SCORE_PLAN[state] : SCORE_PLAN.silence;
}

/** How a recording loops: all times in seconds OF THE FILE; `rate` converts them to seconds heard. */
export interface LoopSpec {
  /** where the first pass starts */
  intro: number;
  /** where every later pass starts */
  from: number;
  /** where a pass hands over to the next (it keeps sounding `xfade` longer, fading) */
  to: number;
  xfade: number;
  /** playback rate (1 = as recorded) */
  rate: number;
  /** mean level of the looped part, dBFS */
  meanDb: number;
}

/**
 * The loop of `region` in a track. For the whole track that is the manifest's own convention: the next pass
 * starts `LOOP_XFADE` before the end of the file — a whole number of bars after the start — and the two
 * cross-fade. `hot` starts the first pass at the track's `body` (later passes are the whole piece again).
 * Degenerate metadata (a file shorter than its fades) shrinks the fade rather than failing.
 */
export function loopSpec(track: TrackName, meta: TrackMeta, region: RegionName = 'whole', hot = false): LoopSpec {
  const info = TRACKS[track];
  const seconds = Number.isFinite(meta.seconds) && meta.seconds > 0 ? meta.seconds : 0;
  const r = region === 'whole' ? undefined : info.regions?.[region];
  const rate = Math.pow(2, info.tune / 12);
  if (r && r.to + LOOP_XFADE <= seconds + 1e-6) return { intro: r.from, from: r.from, to: r.to, xfade: LOOP_XFADE, rate, meanDb: r.meanDb };
  const xfade = Math.min(LOOP_XFADE, seconds / 4);
  const from = clamp(Number.isFinite(meta.loopStart) ? meta.loopStart : 0, 0, Math.max(0, seconds - 2 * xfade));
  const to = seconds - xfade;
  const intro = hot && info.body !== undefined && info.body < to - 2 * xfade ? info.body : 0;
  return { intro, from, to, xfade, rate, meanDb: Number.isFinite(meta.meanDb) ? meta.meanDb : -16 };
}

/** Seconds heard between the start of one pass and the next (after the first). */
export const loopPeriod = (l: LoopSpec): number => (l.to - l.from) / l.rate;

/** dB → linear amplitude. */
const amp = (db: number): number => Math.pow(10, db / 20);

/** Linear gain that puts the looped part of the recording at the plan's level for `intensity`. */
export function planGain(plan: ScorePlan, loop: LoopSpec, intensity: number): number {
  const db = lerp(plan.gain[0], plan.gain[1], clamp01(Number.isFinite(intensity) ? intensity : 0));
  // a quiet file is never boosted by more than 6 dB: its noise floor and its peaks come up with it
  return amp(Math.min(6, db - loop.meanDb));
}

/** Low-pass frequency (Hz) for `intensity`: opens exponentially, the way it is heard. */
export function planTone(plan: ScorePlan, intensity: number): number {
  const [a, b] = plan.tone;
  return a * Math.pow(b / a, clamp01(Number.isFinite(intensity) ? intensity : 0));
}

/** Does a layer match a `kind[:voice or instrument][:when]` selector? */
export function layerMatches(layer: Layer, selector: string): boolean {
  const [kind, voice, when] = selector.split(':');
  if (layer.kind !== kind) return false;
  if (voice && voice !== '*') {
    const v = 'voice' in layer ? layer.voice : 'inst' in layer ? layer.inst : undefined;
    if (v !== voice) return false;
  }
  return !when || layer.when === when;
}

/**
 * The part of a generative definition that keeps playing under a recording: the same tempo, harmony and
 * levels, only the selected layers. Null when nothing is selected (the generative score is silent).
 */
export function overlayDef(def: MusicDef, selectors: readonly string[]): MusicDef | null {
  if (!selectors.length) return null;
  const layers = def.layers.filter((l) => selectors.some((s) => layerMatches(l, s)));
  return layers.length ? { ...def, layers } : null;
}
