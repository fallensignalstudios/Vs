/**
 * Shared sound-design building blocks. Faction identity lives here so every recipe that says "Dominion" or
 * "Frost" pulls the same timbral family:
 *   Reformation → servo / clean FM tones        Dominion → brass() + zap() (heavy, electric)
 *   Eclipse     → wrong() + breath() (identical) King-era → pure() (harmonic gold tones)
 *   Cinder      → roar() + embers()              Frost    → glass() (still, held, quiet)
 */
import type { Env, Kit, Pt, SrcOpts } from '../synth/kit';

/** Pitch-dropping sine body: the low-end weight of an impact. */
export function thump(k: Kit, f0: number, f1: number, d: number, g: number, at = 0): void {
  k.osc('sine', [f0, f1, Math.min(d * 0.4, 0.14)], { a: 0.003, d, g }, { at });
}

/** Broadband contact transient. */
export function crack(k: Kit, g: number, at = 0, hp = 1800, d = 0.012): void {
  k.noise('white', { a: 0.0005, d, g }, { at, hp });
}

/** Band-passed air movement following a frequency path (swings, dodges, passes). */
export function whoosh(k: Kit, path: readonly Pt[], env: Env, q = 1.4, o?: SrcOpts): void {
  k.noise('pink', env, { ...o, bp: path, q });
}

export type Modes = 'bar' | 'plate' | 'bell' | 'blade' | 'glass' | 'gold';

const MODES: Record<Modes, readonly number[]> = {
  bar: [1, 2.756, 5.404, 8.933, 13.34],
  plate: [1, 1.59, 2.14, 2.65, 3.16, 3.89, 4.72],
  bell: [0.5, 1, 1.2, 1.5, 2, 2.67, 3.01, 4.1],
  blade: [1, 2.32, 3.86, 5.18, 6.71, 9.2],
  glass: [1, 2.32, 4.25, 6.63, 9.38],
  gold: [1, 2, 3, 4.01],
};

/**
 * Struck modal body. Upper partials are quieter and die sooner; gains are randomised per strike so repeated
 * hits never sound stamped out. `tilt` > 1 darkens (faster roll-off of the upper partials).
 */
export function struck(k: Kit, mode: Modes, base: number, d: number, g: number, o?: SrcOpts & { tilt?: number; exact?: boolean }): void {
  const tilt = o?.tilt ?? 1;
  const spec = MODES[mode].map((r, i): readonly [number, number, number] => [
    r,
    (g / (1 + i * 0.75 * tilt)) * (o?.exact ? 1 : k.rr(0.7, 1.15)),
    d / (1 + i * 0.55),
  ]);
  k.partials(base, spec, { ...o, a: 0.0015, spread: o?.exact ? 0 : 0.004 });
}

/** King-era gold tone: a pure harmonic stack with a soft bloom. Recognition, route continuity, assent. */
export function pure(k: Kit, f: number, env: Env, o?: SrcOpts): void {
  const g = env.g ?? 1;
  k.osc('sine', f, env, o);
  k.osc('sine', f * 2, { ...env, d: env.d * 0.7, g: g * 0.2 }, o);
  k.osc('sine', f * 3, { ...env, d: env.d * 0.45, g: g * 0.07 }, o);
  // slow shimmer: a partner a fraction of a hertz away
  k.osc('sine', f * 1.0016, { ...env, g: g * 0.35 }, o);
}

/** Frost: still, glassy, slightly inharmonic, with a slow beat instead of vibrato. */
export function glass(k: Kit, f: number, env: Env, o?: SrcOpts): void {
  const g = env.g ?? 1;
  k.osc('sine', f, env, o);
  k.osc('sine', f * 1.003, { ...env, g: g * 0.5 }, o);
  k.osc('sine', f * 2.32, { ...env, d: env.d * 0.6, g: g * 0.22 }, o);
  k.osc('sine', f * 4.25, { ...env, d: env.d * 0.3, g: g * 0.08 }, o);
}

/** Dominion brass: detuned saws whose brightness opens with loudness, with a touch of rasp. */
export function brass(k: Kit, f: number, env: Env, bright = 6, o?: SrcOpts): void {
  const a = env.a ?? 0.03;
  const total = a + (env.h ?? 0) + env.d;
  const at = o?.at ?? 0;
  const lp = k.filter('lowpass', [[0, f * 1.4], [a, f * bright], [total, f * 1.6]], 1.1, { at, to: k.shaper('asym', 1.6, o?.to) });
  const g = env.g ?? 1;
  k.osc('sawtooth', f, { ...env, g: g * 0.5 }, { at, to: lp, detune: -7 });
  k.osc('sawtooth', f, { ...env, g: g * 0.5 }, { at, to: lp, detune: 8 });
  k.osc('square', f * 0.5, { ...env, g: g * 0.22 }, { at, to: lp });
}

/** Dominion electric arc: mains-rate buzz and spark crackle (shock baton, shield field). */
export function zap(k: Kit, d: number, g: number, at = 0, rate = 92): void {
  // buzz: mains-rate saw driven hard, then band-limited to the "bzzt" region; arc: crackle on top
  const band = k.filter('bandpass', 2100, 0.7, { at });
  const drive = k.shaper('hard', 9, band);
  k.osc('sawtooth', [rate * 1.15, rate * 0.9], { a: 0.002, d, g: g * 0.45 }, { at, to: drive, hp: 500 });
  k.osc('square', rate * 2.01, { a: 0.002, d: d * 0.8, g: g * 0.25 }, { at, to: drive, hp: 700 });
  k.noise('crackle', { a: 0.002, d: d * 1.1, g: g * 0.9 }, { at, hp: 2600 });
  k.noise('white', { a: 0.002, d: d * 0.5, g: g * 0.25 }, { at, bp: 4800, q: 2 });
}

/** Reformation servo: a clean stepped tone with a faint whine above it. */
export function servo(k: Kit, f0: number, f1: number, d: number, g: number, at = 0): void {
  k.osc('triangle', [f0, f1, d * 0.8], { a: 0.01, h: d * 0.5, d: d * 0.5, g }, { at });
  k.fm([f0 * 3, f1 * 3, d * 0.8], 2, 0.6, { a: 0.02, h: d * 0.4, d: d * 0.5, g: g * 0.18 }, { at });
  k.noise('white', { a: 0.02, h: d * 0.4, d: d * 0.4, g: g * 0.08 }, { at, bp: [f0 * 5, f1 * 5], q: 6 });
}

/** Eclipse "wrong" tone: an exact minor-second pair, ring-modulated. No randomness by design. */
export function wrong(k: Kit, f: number, env: Env, o?: SrcOpts & { rate?: number }): void {
  const ring = k.ac.createGain();
  ring.gain.value = 0.35;
  ring.connect(o?.to ?? k.out);
  k.lfo(o?.rate ?? 31, 0.65, ring.gain, { at: o?.at });
  const lp = k.filter('lowpass', f * 5, 0.9, { to: ring, at: o?.at, fixed: true });
  const g = env.g ?? 1;
  k.osc('sawtooth', f, { ...env, g: g * 0.5 }, { at: o?.at, to: lp, fixed: true });
  k.osc('sawtooth', f * 1.05946, { ...env, g: g * 0.5 }, { at: o?.at, to: lp, fixed: true });
}

/** Breath: pink noise through vowel formants. `open` 0 = closed "oo", 1 = open "ah". */
export function breath(k: Kit, env: Env, open = 0.5, o?: SrcOpts): void {
  const f1 = 320 + 420 * open;
  const f2 = 850 + 400 * open;
  const f3 = 2300 + 500 * open;
  const b = k.bank([f1, f2, f3], 7, { to: o?.to, gains: [1, 0.6, 0.25], g: 1.4, fixed: true });
  k.noise('pink', env, { at: o?.at, to: b, pan: o?.pan });
}

/** Cinder roar: distorted low noise with a flutter. */
export function roar(k: Kit, env: Env, lp: number, at = 0): void {
  const sh = k.shaper('soft', 2.2);
  const am = k.gain(0.75, sh);
  k.lfo(27, 0.25, am.gain, { at });
  k.noise('brown', env, { at, to: am, lp: [lp * 2.5, lp], q: 0.9 });
  k.noise('pink', { ...env, g: (env.g ?? 1) * 0.35 }, { at, to: am, bp: lp * 3, q: 0.8 });
}

/** Cinder embers: crackle that thins out. */
export function embers(k: Kit, d: number, g: number, at = 0, hp = 2200): void {
  k.noise('crackle', { a: 0.01, d, g }, { at, hp });
  k.noise('crackle', { a: 0.02, d: d * 0.6, g: g * 0.6 }, { at: at + 0.03, bp: 1200, q: 1.2, rate: 0.6 });
}

/** A scatter of small impacts (debris, rubble, casings). */
export function debris(k: Kit, count: number, span: number, g: number, at = 0, lo = 250, hi = 1400): void {
  for (let i = 0; i < count; i++) {
    const t = at + span * Math.pow(k.rnd(), 0.8);
    const f = k.rr(lo, hi);
    const a = g * k.rr(0.35, 1) * (1 - 0.5 * (t - at) / Math.max(span, 0.01));
    k.noise('brown', { a: 0.001, d: k.rr(0.03, 0.09), g: a }, { at: t, bp: f, q: 2.2, pan: k.jit(0.6) });
    if (k.rnd() < 0.5) k.osc('sine', [f * 0.5, f * 0.3], { a: 0.001, d: 0.05, g: a * 0.6 }, { at: t });
  }
}

/** Explosion core: crack + body + noise bloom + sub. `size` 0.5 small … 2 huge. */
export function blast(k: Kit, size: number, g: number, at = 0): void {
  const len = 0.5 * size + 0.25;
  const r = Math.sqrt(size);
  crack(k, g, at, 900, 0.022);
  // the punch sits at 60–90 Hz where speakers can deliver it; the true sub underneath is short
  thump(k, 190 / r, 66 / r, len * 0.8, g * 0.7, at);
  const sh = k.shaper('soft', 2.5);
  k.noise('brown', { a: 0.004, d: len * 1.4, g: g * 0.9 }, { at, to: sh, lp: [3600 / size, 420], q: 0.8 });
  k.noise('white', { a: 0.002, d: len * 0.7, g: g * 0.7 }, { at, to: sh, bp: [2600, 600], q: 0.7 });
  k.noise('pink', { a: 0.003, d: len * 0.4, g: g * 0.4 }, { at, hp: 700, lp: [6500, 1800] }); // air shock
  k.osc('square', [170 / r, 60 / r, len * 0.4], { a: 0.003, d: len * 0.6, g: g * 0.35 }, { at, to: sh, lp: 1700 });
  k.osc('sine', 46 / r, { a: 0.02, d: len * 0.7, g: g * 0.3 }, { at: at + 0.02 });
}
