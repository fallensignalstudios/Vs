/** Minimal music theory for the generative score: pitch, chords, step patterns. Pure functions. */

/** MIDI note → Hz (A4 = 69 = 440 Hz). */
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export type Quality =
  | '5' | 'm' | 'M' | 'sus2' | 'sus4' | 'm7' | 'M7' | 'add9' | 'madd9' | 'q' | 'b2' | 'tri' | 'dim' | 'M9' | '69';

/** Chord intervals in semitones above the chord root. */
export const QUALITY: Readonly<Record<Quality, readonly number[]>> = {
  '5': [0, 7],
  m: [0, 3, 7],
  M: [0, 4, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  m7: [0, 3, 7, 10],
  M7: [0, 4, 7, 11],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  /** quartal stack — open, unresolved */
  q: [0, 5, 10],
  /** Phrygian cluster: root, flat second, fifth — the Eclipse "wrong" chord */
  b2: [0, 1, 7],
  /** bare tritone */
  tri: [0, 6],
  dim: [0, 3, 6],
  M9: [0, 4, 7, 11, 14],
  '69': [0, 4, 7, 9, 14],
};

export interface Chord {
  /** chord root in semitones above the tonic */
  root: number;
  /** intervals above the chord root */
  iv: readonly number[];
  /** length in bars */
  bars: number;
}

export const ch = (root: number, q: Quality, bars = 1): Chord => ({ root, iv: QUALITY[q], bars });

/** The i-th chord tone (extended upward over octaves, downward for negative i) in semitones above the tonic. */
export function chordTone(c: Chord, i: number): number {
  const n = c.iv.length;
  const oct = Math.floor(i / n);
  const k = ((i % n) + n) % n;
  return c.root + c.iv[k] + 12 * oct;
}

/**
 * A close voicing of `count` chord tones as MIDI notes, starting from the lowest chord tone at or above `low`.
 * Keeps voices in one register across chord changes so pads move smoothly instead of leaping.
 */
export function voicing(tonic: number, c: Chord, low: number, count: number): number[] {
  const pcs = c.iv.map((iv) => (((tonic + c.root + iv) % 12) + 12) % 12);
  const out: number[] = [];
  let m = Math.ceil(low);
  let guard = 0;
  while (out.length < count && guard++ < 64) {
    if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
    m++;
  }
  return out;
}

/** Total bars of a chord cycle. */
export const cycleBars = (chords: readonly Chord[]): number => chords.reduce((s, c) => s + c.bars, 0);

/** Which chord is sounding in bar `bar` of the cycle, and whether this bar begins it. */
export function chordAt(chords: readonly Chord[], bar: number): { chord: Chord; index: number; first: boolean; barsLeft: number } {
  const total = cycleBars(chords);
  let b = ((bar % total) + total) % total;
  for (let i = 0; i < chords.length; i++) {
    if (b < chords[i].bars) return { chord: chords[i], index: i, first: b === 0, barsLeft: chords[i].bars - b };
    b -= chords[i].bars;
  }
  return { chord: chords[0], index: 0, first: true, barsLeft: chords[0].bars };
}

/**
 * Step pattern → velocities. `.` rest, `o` ghost (0.42), `x` normal (0.72), `X` accent (1).
 * Spaces and `|` are layout only.
 */
export function parsePattern(p: string): number[] {
  const out: number[] = [];
  for (const c of p) {
    if (c === ' ' || c === '|') continue;
    out.push(c === 'X' ? 1 : c === 'x' ? 0.72 : c === 'o' ? 0.42 : 0);
  }
  return out;
}

/** Pick the pattern tier for an intensity (tiers are ordered sparse → dense). */
export function tierFor(tiers: number, intensity: number): number {
  if (tiers <= 1) return 0;
  return Math.min(tiers - 1, Math.max(0, Math.floor(intensity * tiers * 0.999)));
}

/** Layer gain for an intensity: lerp(lo, hi, smoothstep(th0, th1, intensity)). */
export function layerGain(g: number | readonly [number, number], th: readonly [number, number] | undefined, intensity: number): number {
  if (typeof g === 'number') return g;
  const a = th ? th[0] : 0;
  const b = th ? th[1] : 1;
  let t = b === a ? (intensity >= b ? 1 : 0) : (intensity - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  t = t * t * (3 - 2 * t);
  return g[0] + (g[1] - g[0]) * t;
}
