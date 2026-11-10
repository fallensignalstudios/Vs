/**
 * Score instruments. All take a music Kit (start time 0, so `at` is absolute context time) and schedule one
 * enveloped note. Percussion is tuned and layered (stick + skin + body) and kept SHORT — at 16th-note density
 * a drum that rings for half a second is a drone, not a rhythm. Pitched voices carry the identity timbres:
 * horn/brass (Dominion), glass (Reformation), bell (King-era), felt (the quiet room).
 */
import type { Kit } from '../synth/kit';
import type { SampleBank } from '../synth/samples';
import { struck } from '../sfx/parts';
import type { MotifVoice, PadVoice, PercInst, PulseVoice } from './types';

// ---------------------------------------------------------------------------------------------
// percussion
// ---------------------------------------------------------------------------------------------

/** chū-daiko: a hard stick attack, a short tuned body, the skin's slap. */
function taiko(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 2.4, f, 0.035], { a: 0.0015, d: 0.13 + 0.08 * v, g: v }, { at });
  k.osc('sine', [f * 3.6, f * 1.6, 0.03], { a: 0.0015, d: 0.09, g: v * 0.35 }, { at });
  k.noise('brown', { a: 0.001, d: 0.07, g: v * 0.7 }, { at, bp: f * 2.5, q: 1.3 });
  k.noise('pink', { a: 0.0008, d: 0.045, g: v * 0.75 }, { at, bp: f * 8, q: 1 }); // head slap
  k.noise('white', { a: 0.0008, d: 0.024, g: v * (0.5 + 0.5 * v) }, { at, hp: 2200, lp: 9000 }); // bachi
}

/** ō-daiko: the one great drum on the bar line. Longer, but still out of the way of the next beat. */
function odaiko(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 2, f, 0.06], { a: 0.003, d: 0.46 + 0.2 * v, g: v }, { at });
  k.osc('sine', [f * 3, f * 1.5, 0.05], { a: 0.003, d: 0.2, g: v * 0.25 }, { at });
  k.noise('brown', { a: 0.002, d: 0.16, g: v * 0.8 }, { at, lp: [f * 9, f * 2.5], q: 0.9 });
  k.noise('pink', { a: 0.001, d: 0.06, g: v * 0.5 }, { at, bp: f * 7, q: 1 });
  k.noise('white', { a: 0.0006, d: 0.02, g: v * v * 0.6 }, { at, hp: 1200, lp: 6500 });
}

/** shime-daiko: the small high drum that keeps the ensemble's time — almost all attack. */
function shime(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 1.5, f, 0.012], { a: 0.0008, d: 0.055, g: v * 0.7 }, { at });
  k.osc('triangle', f * 2.31, { a: 0.0008, d: 0.03, g: v * 0.22 }, { at });
  k.noise('white', { a: 0.001, d: 0.036, g: v * 0.8 }, { at, bp: 4300, q: 0.8 });
  k.noise('pink', { a: 0.0005, d: 0.035, g: v * 0.4 }, { at, bp: 1500, q: 1.2 });
}

/** atarigane: a small hand gong struck with a horn mallet — a bright, pitched "chin". */
function kane(k: Kit, at: number, v: number, f: number): void {
  struck(k, 'bar', f, 0.11, v * 0.5, { at });
  k.osc('sine', f * 1.504, { a: 0.0008, d: 0.07, g: v * 0.2 }, { at });
  k.noise('white', { a: 0.0005, d: 0.01, g: v * 0.45 }, { at, hp: 5200 });
}

function anvil(k: Kit, at: number, v: number, f: number): void {
  struck(k, 'plate', f, 0.3, v * 0.6, { at, tilt: 0.7 });
  k.noise('white', { a: 0.0008, d: 0.03, g: v * 0.6 }, { at, hp: 3200 });
}

function metal(k: Kit, at: number, v: number, f: number): void {
  struck(k, 'bar', f, 0.2, v * 0.5, { at });
  k.noise('white', { a: 0.0006, d: 0.012, g: v * 0.4 }, { at, hp: 4500 });
}

function hat(k: Kit, at: number, v: number): void {
  k.noise('white', { a: 0.0008, d: 0.02 + 0.03 * v, g: v }, { at, hp: 4800, lp: 11000 });
}

function shaker(k: Kit, at: number, v: number): void {
  k.noise('white', { a: 0.006, d: 0.03 + 0.025 * v, g: v }, { at, bp: 5600, q: 0.9 });
}

/** The rosin at the start of a marcato bow stroke: a soft "chff", never a click. */
function bow(k: Kit, at: number, v: number): void {
  k.noise('pink', { a: 0.012, d: 0.08, g: v }, { at, bp: 3400, q: 0.7 });
  k.noise('white', { a: 0.01, d: 0.05, g: v * 0.3 }, { at, bp: 6200, q: 1 });
}

/** Reformation's precise click: almost no tail. */
function rim(k: Kit, at: number, v: number): void {
  k.osc('sine', 1760, { a: 0.0006, d: 0.012, g: v * 0.7 }, { at });
  k.noise('white', { a: 0.0006, d: 0.012, g: v * 0.8 }, { at, bp: 3400, q: 2.6 });
  k.osc('sine', [420, 300], { a: 0.0006, d: 0.02, g: v * 0.35 }, { at });
}

function kick(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 3, f, 0.03], { a: 0.0015, d: 0.17, g: v }, { at });
  k.noise('white', { a: 0.0006, d: 0.008, g: v * 0.4 }, { at, hp: 900, lp: 5200 });
}

function boom(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 1.9, f, 0.12], { a: 0.008, d: 1.3, g: v }, { at });
  k.noise('brown', { a: 0.01, d: 0.9, g: v * 0.6 }, { at, lp: [420, 90, 0.8] });
}

function clack(k: Kit, at: number, v: number): void {
  k.noise('white', { a: 0.0008, d: 0.03, g: v }, { at, bp: 920, q: 5 });
  k.osc('sine', [460, 380], { a: 0.0008, d: 0.022, g: v * 0.5 }, { at });
  k.noise('white', { a: 0.0005, d: 0.008, g: v * 0.3 }, { at, hp: 3500 });
}

/** Each drum's fundamental when a layer does not tune it (Hz; 0 = unpitched). */
export const PERC_TUNE: Readonly<Record<PercInst, number>> = {
  taiko: 78, odaiko: 49, shime: 340, kane: 2700, anvil: 540, metal: 1150, hat: 0, shaker: 0, bow: 0, rim: 0, kick: 50, boom: 36.7, clack: 0, cadence: 0,
};

/**
 * Where each instrument stands on the stage (−1 left … 1 right). The big drums and anything below 100 Hz stay
 * in the middle; time-keepers and metal are set out to the sides, so the ensemble has width without reverb.
 */
export const PERC_PAN: Readonly<Record<PercInst, number>> = {
  taiko: -0.22, odaiko: 0, shime: 0.36, kane: -0.45, anvil: 0.32, metal: 0.48, hat: 0.3, shaker: -0.38, bow: 0, rim: -0.3, kick: 0, boom: 0, clack: 0.22, cadence: 0,
};

/** Velocities percussion is pre-rendered at: ghost, normal, accent (see theory.parsePattern). */
export const PERC_TIERS = [0.42, 0.72, 1] as const;

/** The pre-render tier for a velocity. */
export const percTier = (vel: number): number => (vel > 0.86 ? 2 : vel > 0.57 ? 1 : 0);

/** Sample-bank id of a pre-rendered stroke. */
export const percSampleId = (inst: PercInst, tune: number, tier: number): string => `perc:${inst}:${tune || PERC_TUNE[inst]}:${tier}`;

/** Strike a percussion instrument. `tune` is the drum's fundamental in Hz (0 = instrument default). */
export function hit(inst: PercInst, k: Kit, at: number, vel: number, tune = 0): void {
  const f = tune || PERC_TUNE[inst];
  switch (inst) {
    case 'taiko': return taiko(k, at, vel, f);
    case 'odaiko': return odaiko(k, at, vel, f);
    case 'shime': return shime(k, at, vel, f);
    case 'kane': return kane(k, at, vel, f);
    case 'anvil': return anvil(k, at, vel, f);
    case 'metal': return metal(k, at, vel, f);
    case 'hat': return hat(k, at, vel);
    case 'shaker': return shaker(k, at, vel);
    case 'bow': return bow(k, at, vel);
    case 'rim': return rim(k, at, vel);
    case 'kick': return kick(k, at, vel, f);
    case 'boom': return boom(k, at, vel, f);
    case 'cadence': return cadenceHit(k, at, vel, 0);
    default: return clack(k, at, vel);
  }
}

/** One percussion stroke: a pre-rendered buffer when the bank has one, the live instrument otherwise. */
export function strike(bank: SampleBank, rnd: () => number, inst: PercInst, k: Kit, at: number, vel: number, tune = 0): void {
  const tier = percTier(vel);
  const s = bank.pick(percSampleId(inst, tune, tier), rnd);
  if (s) k.sample(s.buffer, { at, g: (vel / PERC_TIERS[tier]) * s.gain });
  else hit(inst, k, at, vel, tune);
}

/**
 * The Eclipse cadence tick. With `wobble` 0 it is stamped out identically on every beat (as the 'cadence'
 * percussion instrument it is pre-rendered once, so the beats are the same samples); with wobble the pitch
 * and length drift — what a severed, no-longer-synchronised body sounds like.
 */
export function cadenceHit(k: Kit, at: number, vel: number, wobble: number): void {
  const p = wobble > 0 ? 1 + k.jit(0.18 * wobble) : 1;
  const d = wobble > 0 ? k.rr(0.6, 1.5) : 1;
  k.noise('white', { a: 0.001, d: 0.035 * d, g: vel * 0.3 }, { at, bp: 1400 * p, q: 6 });
  k.noise('white', { a: 0.0006, d: 0.012 * d, g: vel * 0.22 }, { at, bp: 4600 * p, q: 3 });
  k.osc('sine', 207.65 * p, { a: 0.002, d: 0.11 * d, g: vel * 0.6 }, { at });
  k.osc('sine', 220 * p, { a: 0.002, d: 0.11 * d, g: vel * 0.45 }, { at }); // the semitone rub
  k.noise('pink', { a: 0.004, d: 0.08 * d, g: vel * 0.1 }, { at, bp: 620, q: 5 });
}

// ---------------------------------------------------------------------------------------------
// pitched one-note voices
// ---------------------------------------------------------------------------------------------

export function pulseNote(voice: PulseVoice, k: Kit, at: number, f: number, vel: number, len: number, pan: number): void {
  switch (voice) {
    case 'pluck': {
      const lp = k.filter('lowpass', [f * (4 + 9 * vel) + 600, f * 2, 0.12], 1.4, { at, to: k.pan(pan) });
      k.ens('pluck', f, { a: 0.003, d: Math.min(len * 1.6, 0.35), g: vel }, { at, to: lp });
      return;
    }
    case 'bass': {
      const lp = k.filter('lowpass', [f * 7 + 200, f * 2, 0.1], 1.2, { at });
      k.osc('sawtooth', f, { a: 0.004, d: Math.min(len * 1.8, 0.4), g: vel * 0.5 }, { at, to: lp });
      k.osc('sine', f, { a: 0.004, d: Math.min(len * 2, 0.45), g: vel * 0.6 }, { at });
      return;
    }
    case 'tick':
      k.osc('sine', f * 2, { a: 0.001, d: 0.05, g: vel * 0.6 }, { at, pan });
      k.noise('white', { a: 0.0008, d: 0.012, g: vel * 0.4 }, { at, bp: 4200, q: 3, pan });
      return;
    case 'clock':
      // fine mechanism: a tiny escapement click with a pure pitched ping on top
      k.noise('white', { a: 0.0006, d: 0.008, g: vel * 0.5 }, { at, bp: 5200, q: 4, pan });
      k.osc('sine', f, { a: 0.002, d: 0.22, g: vel * 0.55 }, { at, pan });
      k.osc('sine', f * 3, { a: 0.001, d: 0.05, g: vel * 0.12 }, { at, pan });
      return;
    default: {
      const d = Math.max(0.35, len * 2.5);
      const dst = k.pan(pan);
      k.ens('glassy', f, { a: 0.003, d, g: vel * 0.6 }, { at, to: dst });
      // the inharmonic partial rings on the accents only: an ostinato does not need it on every 16th
      if (vel > 0.85) k.osc('sine', f * 2.32, { a: 0.003, d: d * 0.5, g: vel * 0.15 }, { at, to: dst });
    }
  }
}

export function motifNote(voice: MotifVoice, k: Kit, at: number, f: number, vel: number, len: number, pan: number): void {
  switch (voice) {
    case 'bell':
      k.fm(f, 3.5, [2.2 * vel + 0.6, 0.15], { a: 0.003, d: Math.max(2.2, len * 1.6), g: vel * 0.5 }, { at, pan });
      k.osc('sine', f, { a: 0.004, d: Math.max(2.6, len * 1.8), g: vel * 0.45 }, { at, pan });
      k.osc('sine', f * 0.5, { a: 0.02, d: Math.max(2.0, len * 1.4), g: vel * 0.2 }, { at, pan });
      // the strike itself: a breath of bright metal that the long partials grow out of
      k.noise('white', { a: 0.0008, d: 0.03, g: vel * 0.1 }, { at, bp: f * 5.4, q: 2.5, pan });
      return;
    case 'glass': {
      // the held body is one ensemble source; the inharmonic partial that makes it glass dies away over it
      const d = Math.max(0.9, len * 1.4);
      const dst = k.pan(pan);
      k.ens('glassy', f, { a: 0.004, h: len * 0.25, d, g: vel * 0.6 }, { at, to: dst });
      k.osc('sine', f * 2.32, { a: 0.004, h: len * 0.1, d: d * 0.5, g: vel * 0.15 }, { at, to: dst });
      k.noise('white', { a: 0.001, d: 0.012, g: vel * 0.12 }, { at, bp: f * 4, q: 3, to: dst });
      return;
    }
    case 'horn': {
      // solo low brass: brightness swells with the note, vibrato arrives late
      const dst = k.pan(pan);
      const a = Math.min(0.14, len * 0.25);
      const env = { a, h: len * 0.55, d: len * 0.45 + 0.25 };
      const lp = k.filter('lowpass', [[0, f * 2], [a * 1.6, 1000 + 2300 * vel], [len + 0.3, f * 2.5]], 0.9, { at, to: dst });
      const srcs = k.ens('horn', f, { ...env, g: vel }, { at, to: lp });
      k.osc('sine', f, { ...env, g: vel * 0.3 }, { at, to: dst });
      if (len > 0.5) for (const s of srcs) k.lfo(5.1, 7, s.detune, { at: at + 0.35, dur: len });
      return;
    }
    default:
      // felt: a soft, dark keyboard for the observation gallery — hammer, string, and the wood around them
      k.osc('triangle', f, { a: 0.006, d: Math.max(1.6, len * 1.5), g: vel * 0.6 }, { at, pan, lp: [f * 5, f * 1.5, 0.6] });
      k.osc('sine', f * 2, { a: 0.006, d: 0.7, g: vel * 0.12 }, { at, pan });
      k.osc('sine', f * 4.02, { a: 0.004, d: 0.25, g: vel * 0.035 }, { at, pan });
      k.noise('pink', { a: 0.002, d: 0.035, g: vel * 0.1 }, { at, bp: 2600, q: 0.8, pan });
  }
}

const PAD_ENSEMBLE = { warm: 'warm', glass: 'glass', choir: 'choir', wrong: 'wrong' } as const;

/** One sustained pad note into the layer's filter (the kit output). `dur` = chord length; overlaps the next. */
export function padNote(voice: PadVoice, k: Kit, at: number, f: number, dur: number, vel: number, pan: number, to?: AudioNode): void {
  const a = Math.min(2.4, dur * 0.38);
  const r = Math.min(1.6, dur * 0.4);
  const e = { a, h: Math.max(0.05, dur - a), d: r, g: vel, lin: true };
  switch (voice) {
    case 'warm':
    case 'glass':
    case 'wrong':
      k.ens(PAD_ENSEMBLE[voice], f, e, { at, to });
      return;
    case 'choir': {
      // a slow, slightly different vibrato on every singer
      const srcs = k.ens('choir', f, e, { at, to });
      k.lfo(4.3 + k.rnd() * 0.9, 6, srcs[0].detune, { at, dur: a + e.h + r });
      return;
    }
    case 'air':
      k.noise('pink', { ...e, g: vel * 0.22 }, { at, to, bp: f * 2, q: 30, pan });
      k.noise('pink', { ...e, g: vel * 0.11 }, { at, to, bp: f * 3, q: 34, pan: -pan });
      return;
    default:
      // felt chord: struck, then left to ring
      k.osc('triangle', f, { a: 0.012, d: Math.max(2.4, dur * 0.9), g: vel * 0.6 }, { at, to, pan, lp: [f * 4, f * 1.4, 0.8] });
      k.osc('sine', f * 2, { a: 0.012, d: 1.0, g: vel * 0.1 }, { at, to, pan });
      k.noise('pink', { a: 0.002, d: 0.04, g: vel * 0.07 }, { at, to, bp: 2400, q: 0.8, pan });
  }
}

/** One low string note (three desks, slightly apart) into the ensemble filter. */
export function stringNote(k: Kit, at: number, f: number, dur: number, vel: number, to?: AudioNode): void {
  const a = Math.min(0.9, dur * 0.25);
  k.ens('strings', f, { a, h: Math.max(0.05, dur - a), d: Math.min(1.2, dur * 0.35), g: vel, lin: true }, { at, to });
}

/** Brass section note: a slow swell over `dur`, or a short marcato stab. */
export function brassNote(k: Kit, at: number, f: number, dur: number, vel: number, stab: boolean): void {
  // brightness is a property of how hard the section plays, not of the pitch: open to ~1–4 kHz at forte
  const peak = stab ? 1300 + 3400 * vel : 1000 + 3000 * vel;
  const env = stab ? { a: 0.022, h: 0.06, d: 0.34, g: vel } : { a: dur * 0.5, h: dur * 0.12, d: dur * 0.42, g: vel };
  const total = env.a + env.h + env.d;
  const lp = k.filter('lowpass', [[0, f * 1.4], [env.a, peak], [total, f * 1.6]], 1.1, { at, to: k.shaper('asym', 1.6) });
  k.ens('brass', f, env, { at, to: lp });
}
