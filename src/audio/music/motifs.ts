/**
 * The melodic identities. Notes are `[step (16ths), semitones above the layer's base, length in steps, velocity]`.
 *
 * Tonal plan (everything orbits D):
 *   Tarrik / Dominion  — D minor. Rising fifth then a deliberate stepwise fall: D–A–G–F, E–D. Always F♮.
 *   Selene / Reformation — A, suspended. A precise 3+3+2 descent E–B–A–E answered by B–C♯: it never lands.
 *   King / Meridian — D with NO third: fifths and seconds only (D–A–E, B–A–E) until the Meridian completes,
 *     when F♯ is finally allowed and the same shape resolves.
 *   Played over D, Selene's answer becomes E–F♯ while Tarrik's line keeps F♮: the two never agree on the
 *   third, which is exactly why departure/credits stay unresolved.
 */
import type { MotifNote } from './types';

type Phrase = readonly MotifNote[];

/** base = D3 (50). Low brass / horn. */
export const TARRIK: readonly Phrase[] = [
  [[0, 0, 6, 0.85], [6, 7, 6, 1], [12, 5, 4, 0.8], [16, 3, 8, 0.9], [24, 2, 4, 0.75], [28, 0, 10, 0.85]],
  [[0, 0, 4, 0.8], [4, 3, 4, 0.8], [8, 7, 8, 1], [16, 5, 6, 0.85], [22, 2, 2, 0.7], [24, 0, 12, 0.85]],
  [[0, 7, 6, 0.9], [6, 8, 2, 0.7], [8, 7, 4, 0.85], [12, 3, 4, 0.8], [16, 0, 14, 0.9]],
];

/** The first four notes only — a remembered fragment. */
export const TARRIK_FRAGMENT: readonly Phrase[] = [
  [[0, 0, 6, 0.7], [6, 7, 10, 0.8]],
  [[0, 7, 6, 0.7], [6, 5, 4, 0.65], [10, 3, 12, 0.7]],
];

/** base = A4 (69). Glass. */
export const SELENE: readonly Phrase[] = [
  [[0, 7, 3, 0.9], [3, 2, 3, 0.8], [6, 0, 2, 0.8], [8, -5, 8, 0.85], [16, 2, 4, 0.8], [20, 4, 12, 0.9]],
  [[0, 0, 3, 0.8], [3, 2, 3, 0.8], [6, 7, 2, 0.9], [8, 4, 8, 0.85], [16, 2, 4, 0.75], [20, 7, 12, 0.85]],
  [[0, 12, 3, 0.85], [3, 7, 3, 0.8], [6, 4, 2, 0.75], [8, 2, 10, 0.85]],
];

export const SELENE_FRAGMENT: readonly Phrase[] = [
  [[0, 7, 3, 0.7], [3, 2, 3, 0.65], [6, 0, 10, 0.7]],
  [[0, 2, 4, 0.65], [4, 4, 12, 0.7]],
];

/** base = D4 (62). Bells. No third anywhere. */
export const KING: readonly Phrase[] = [
  [[0, 0, 8, 0.9], [8, 7, 8, 0.8], [16, 14, 16, 0.9]],
  [[0, 9, 8, 0.8], [8, 7, 8, 0.75], [16, 2, 16, 0.85]],
  [[0, 7, 8, 0.8], [8, 14, 8, 0.8], [16, 12, 16, 0.9]],
];

/** The same shapes with F♯ admitted — only heard once the Meridian is complete. */
export const KING_RESOLVED: readonly Phrase[] = [
  [[0, 0, 8, 0.9], [8, 4, 8, 0.85], [16, 7, 8, 0.85], [24, 12, 16, 0.95]],
  [[0, 9, 8, 0.8], [8, 7, 8, 0.8], [16, 4, 16, 0.9]],
  [[0, 7, 8, 0.8], [8, 16, 8, 0.85], [16, 12, 16, 0.9]],
];

/** One deep bell. */
export const TOLL: readonly Phrase[] = [[[0, 0, 24, 1]], [[0, 7, 24, 0.8]]];
