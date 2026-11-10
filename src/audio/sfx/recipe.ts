/**
 * SFX recipe model. A recipe is a small layered synth patch built with the Kit; its level is authored as one
 * number (`db`) and reached through measured normalisation (see calibration.ts), so rebalancing the mix never
 * means re-tuning envelopes.
 *
 * `db` is the output peak, in dBFS at the reference settings, of an ordinary sound of that loudness — one
 * with a 9 dB crest. Calibration matches LOUDNESS (the loudest 100 ms, K-weighted) to `db − 9`, so a 5 ms
 * click and a 2 s roar authored at the same `db` are equally loud rather than equally tall: the click's
 * peak ends up above `db` (never more than 8 dB, never above −5 dBFS) and a pure tone's below it.
 */
import type { Kit } from '../synth/kit';

export interface Recipe {
  /** build the sound into the kit */
  make(k: Kit): void;
  /** level: nominal output peak, dBFS at reference volume settings (see the header) */
  db: number;
  /** minimum seconds between two plays of this id (rate limit) */
  gap: number;
  /** maximum simultaneous instances of this id */
  max: number;
  /** stealing priority 0 (ambient detail) … 3 (story / player-critical) */
  prio: number;
  bus: 'sfx' | 'ui';
  /** reverb send 0..1 */
  send: number;
  /** panner reference distance in metres — how large the source is */
  ref: number;
  /** random pitch variation in cents (0 = unnaturally identical, used for every Eclipse sound) */
  vary: number;
  /** designed as a sustaining bed: loop() holds it, play() gives a short excerpt */
  loop: boolean;
  /**
   * share of the reverb send that reaches the room's long tail (0..1); the rest goes to the early/short room.
   * Rapid cues (footsteps, combo hits, bolts) keep this low so a burst never smears into wash.
   */
  tail: number;
  /**
   * sample-identical on every play — same noise phase, same "random" choices, no level jitter. Every Eclipse
   * voice: the bodies do not merely sound alike, they are the same sound.
   */
  exact: boolean;
  /** pre-render this many variants when audio starts (frequent one-shots); 0 = always synthesised live */
  bake: number;
}

export type RecipeOpts = Partial<Omit<Recipe, 'make' | 'db'>>;

const DEFAULTS: Omit<Recipe, 'make' | 'db'> = { gap: 0.035, max: 4, prio: 1, bus: 'sfx', send: 0.3, ref: 4, vary: 35, loop: false, tail: 1, exact: false, bake: 0 };

/** Define a recipe: target peak dB, options, patch. */
export function sfx(db: number, opts: RecipeOpts, make: (k: Kit) => void): Recipe {
  return { ...DEFAULTS, ...opts, db, make };
}

export type RecipeTable = Record<string, Recipe>;

export const dbToGain = (d: number): number => Math.pow(10, d / 20);

/** the crest factor `db` assumes: loudness target = db − CREST_DB */
export const CREST_DB = 9;
/** a calibrated cue's true peak never exceeds its `db` by more than this … */
export const PEAK_OVER_DB = 8;
/** … nor this absolute ceiling (dBFS): nothing is authored into the limiter */
export const PEAK_CEILING_DB = -5;

/** Loudness target (dB, K-weighted loudest 100 ms) for an authored `db`. */
export const loudnessTarget = (db: number): number => db - CREST_DB;
/** True-peak ceiling (dBFS) for an authored `db`. */
export const peakCeiling = (db: number): number => Math.min(PEAK_CEILING_DB, db + PEAK_OVER_DB);
