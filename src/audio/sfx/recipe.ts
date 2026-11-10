/**
 * SFX recipe model. A recipe is a small layered synth patch built with the Kit; its loudness is authored as a
 * target output peak (`db`, dBFS at the reference settings) and reached through measured normalisation
 * (see calibration.ts), so rebalancing the mix never means re-tuning envelopes.
 */
import type { Kit } from '../synth/kit';

export interface Recipe {
  /** build the sound into the kit */
  make(k: Kit): void;
  /** target output peak, dBFS at reference volume settings */
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
}

export type RecipeOpts = Partial<Omit<Recipe, 'make' | 'db'>>;

const DEFAULTS: Omit<Recipe, 'make' | 'db'> = { gap: 0.035, max: 4, prio: 1, bus: 'sfx', send: 0.3, ref: 4, vary: 35, loop: false };

/** Define a recipe: target peak dB, options, patch. */
export function sfx(db: number, opts: RecipeOpts, make: (k: Kit) => void): Recipe {
  return { ...DEFAULTS, ...opts, db, make };
}

export type RecipeTable = Record<string, Recipe>;

export const dbToGain = (d: number): number => Math.pow(10, d / 20);
