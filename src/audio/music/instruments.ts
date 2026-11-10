/**
 * Score instruments. All take a music Kit (start time 0, so `at` is absolute context time) and schedule one
 * enveloped note. Percussion is tuned and layered (stick + skin + body); pitched voices carry the identity
 * timbres: horn/brass (Dominion), glass (Reformation), bell (King-era), felt (the quiet room).
 */
import type { Kit } from '../synth/kit';
import { brass, glass, struck } from '../sfx/parts';
import type { MotifVoice, PadVoice, PercInst, PulseVoice } from './types';

// ---------------------------------------------------------------------------------------------
// percussion
// ---------------------------------------------------------------------------------------------

function taiko(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 2.2, f, 0.05], { a: 0.002, d: 0.34 + 0.22 * v, g: v }, { at });
  k.osc('sine', [f * 3.4, f * 1.53, 0.04], { a: 0.002, d: 0.15, g: v * 0.32 }, { at });
  k.noise('brown', { a: 0.001, d: 0.11, g: v * 0.75 }, { at, bp: f * 2.5, q: 1.3 });
  k.noise('pink', { a: 0.001, d: 0.05, g: v * 0.6 }, { at, bp: f * 7, q: 1.1 }); // head slap
  k.noise('white', { a: 0.0006, d: 0.018, g: v * v * 0.8 }, { at, hp: 900, lp: 5200 }); // bachi
}

function odaiko(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 2, f, 0.07], { a: 0.003, d: 0.85 + 0.3 * v, g: v }, { at });
  k.osc('sine', [f * 3, f * 1.5, 0.05], { a: 0.003, d: 0.3, g: v * 0.25 }, { at });
  k.noise('brown', { a: 0.002, d: 0.22, g: v * 0.8 }, { at, lp: [f * 9, f * 2.5], q: 0.9 });
  k.noise('pink', { a: 0.001, d: 0.07, g: v * 0.45 }, { at, bp: f * 7, q: 1 });
  k.noise('white', { a: 0.0008, d: 0.022, g: v * v * 0.5 }, { at, hp: 500, lp: 3600 });
}

function anvil(k: Kit, at: number, v: number, f: number): void {
  struck(k, 'plate', f, 0.32, v * 0.6, { at, tilt: 0.8 });
  k.noise('white', { a: 0.0006, d: 0.02, g: v * 0.5 }, { at, hp: 2500 });
}

function metal(k: Kit, at: number, v: number, f: number): void {
  struck(k, 'bar', f, 0.2, v * 0.5, { at });
  k.noise('white', { a: 0.0006, d: 0.012, g: v * 0.35 }, { at, hp: 4500 });
}

function hat(k: Kit, at: number, v: number): void {
  k.noise('white', { a: 0.0008, d: 0.02 + 0.03 * v, g: v }, { at, hp: 7200 });
}

/** Reformation's precise click: almost no tail. */
function rim(k: Kit, at: number, v: number): void {
  k.osc('sine', 1760, { a: 0.0006, d: 0.012, g: v * 0.7 }, { at });
  k.noise('white', { a: 0.0006, d: 0.012, g: v * 0.8 }, { at, bp: 3400, q: 2.6 });
  k.osc('sine', [420, 300], { a: 0.0006, d: 0.02, g: v * 0.35 }, { at });
}

function kick(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 3, f, 0.03], { a: 0.0015, d: 0.17, g: v }, { at });
  k.noise('white', { a: 0.0006, d: 0.006, g: v * 0.25 }, { at, lp: 2600 });
}

function boom(k: Kit, at: number, v: number, f: number): void {
  k.osc('sine', [f * 1.9, f, 0.12], { a: 0.008, d: 1.5, g: v }, { at });
  k.noise('brown', { a: 0.01, d: 1.1, g: v * 0.6 }, { at, lp: [420, 90, 0.8] });
}

function clack(k: Kit, at: number, v: number): void {
  k.noise('white', { a: 0.0008, d: 0.03, g: v }, { at, bp: 920, q: 5 });
  k.osc('sine', [460, 380], { a: 0.0008, d: 0.022, g: v * 0.5 }, { at });
}

/** Strike a percussion instrument. `tune` is the drum's fundamental in Hz (0 = instrument default). */
export function hit(inst: PercInst, k: Kit, at: number, vel: number, tune = 0): void {
  switch (inst) {
    case 'taiko': return taiko(k, at, vel, tune || 78);
    case 'odaiko': return odaiko(k, at, vel, tune || 49);
    case 'anvil': return anvil(k, at, vel, tune || 540);
    case 'metal': return metal(k, at, vel, tune || 1150);
    case 'hat': return hat(k, at, vel);
    case 'rim': return rim(k, at, vel);
    case 'kick': return kick(k, at, vel, tune || 50);
    case 'boom': return boom(k, at, vel, tune || 36.7);
    default: return clack(k, at, vel);
  }
}

/**
 * The Eclipse cadence tick. With `wobble` 0 it is stamped out bit-identical on every beat; with wobble the
 * pitch and length drift — what a severed, no-longer-synchronised body sounds like.
 */
export function cadenceHit(k: Kit, at: number, vel: number, wobble: number): void {
  const p = wobble > 0 ? 1 + k.jit(0.18 * wobble) : 1;
  const d = wobble > 0 ? k.rr(0.6, 1.5) : 1;
  k.noise('white', { a: 0.001, d: 0.035 * d, g: vel * 0.7 }, { at, bp: 1400 * p, q: 6 });
  k.osc('sine', 207.65 * p, { a: 0.002, d: 0.11 * d, g: vel * 0.6 }, { at });
  k.osc('sine', 220 * p, { a: 0.002, d: 0.11 * d, g: vel * 0.45 }, { at }); // the semitone rub
  k.noise('pink', { a: 0.004, d: 0.08 * d, g: vel * 0.3 }, { at, bp: 620, q: 5 });
}

// ---------------------------------------------------------------------------------------------
// pitched one-note voices
// ---------------------------------------------------------------------------------------------

export function pulseNote(voice: PulseVoice, k: Kit, at: number, f: number, vel: number, len: number, pan: number): void {
  switch (voice) {
    case 'pluck': {
      const lp = k.filter('lowpass', [f * (4 + 9 * vel) + 600, f * 2, 0.12], 1.4, { at, to: k.pan(pan) });
      k.osc('sawtooth', f, { a: 0.003, d: Math.min(len * 1.6, 0.35), g: vel * 0.5 }, { at, to: lp, detune: -5 });
      k.osc('square', f, { a: 0.003, d: Math.min(len * 1.4, 0.3), g: vel * 0.25 }, { at, to: lp, detune: 6 });
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
    default:
      glass(k, f, { a: 0.003, d: Math.max(0.35, len * 2.5), g: vel * 0.6 }, { at, pan });
  }
}

export function motifNote(voice: MotifVoice, k: Kit, at: number, f: number, vel: number, len: number, pan: number): void {
  switch (voice) {
    case 'bell':
      k.fm(f, 3.5, [2.2 * vel + 0.6, 0.15], { a: 0.003, d: Math.max(2.2, len * 1.6), g: vel * 0.5 }, { at, pan });
      k.osc('sine', f, { a: 0.004, d: Math.max(2.6, len * 1.8), g: vel * 0.45 }, { at, pan });
      k.osc('sine', f * 0.5, { a: 0.02, d: Math.max(2.0, len * 1.4), g: vel * 0.2 }, { at, pan });
      return;
    case 'glass':
      glass(k, f, { a: 0.004, h: len * 0.25, d: Math.max(0.9, len * 1.4), g: vel * 0.6 }, { at, pan });
      k.noise('white', { a: 0.001, d: 0.012, g: vel * 0.12 }, { at, bp: f * 4, q: 3, pan });
      return;
    case 'horn': {
      // solo low brass: brightness swells with the note, vibrato arrives late
      const dst = k.pan(pan);
      const a = Math.min(0.14, len * 0.25);
      const lp = k.filter('lowpass', [[0, f * 2], [a * 1.6, 900 + 1900 * vel], [len + 0.3, f * 2.5]], 0.9, { at, to: dst });
      const o1 = k.osc('sawtooth', f, { a, h: len * 0.55, d: len * 0.45 + 0.25, g: vel * 0.42 }, { at, to: lp, detune: -4 });
      const o2 = k.osc('sawtooth', f, { a, h: len * 0.55, d: len * 0.45 + 0.25, g: vel * 0.42 }, { at, to: lp, detune: 5 });
      k.osc('sine', f, { a, h: len * 0.55, d: len * 0.45 + 0.25, g: vel * 0.3 }, { at, to: dst });
      if (len > 0.5) {
        k.lfo(5.1, f * 0.004, o1.frequency, { at: at + 0.35, dur: len });
        k.lfo(5.1, f * 0.004, o2.frequency, { at: at + 0.35, dur: len });
      }
      return;
    }
    default:
      // felt: a soft, dark keyboard for the observation gallery
      k.osc('triangle', f, { a: 0.006, d: Math.max(1.6, len * 1.5), g: vel * 0.6 }, { at, pan, lp: [f * 5, f * 1.5, 0.6] });
      k.osc('sine', f * 2, { a: 0.006, d: 0.7, g: vel * 0.12 }, { at, pan });
      k.noise('pink', { a: 0.002, d: 0.03, g: vel * 0.06 }, { at, lp: 1500, pan });
  }
}

/** One sustained pad note into the layer's filter (the kit output). `dur` = chord length; overlaps the next. */
export function padNote(voice: PadVoice, k: Kit, at: number, f: number, dur: number, vel: number, pan: number): void {
  const a = Math.min(2.4, dur * 0.38);
  const r = Math.min(2.2, dur * 0.45);
  const e = { a, h: Math.max(0.05, dur - a), d: r, g: vel, lin: true };
  switch (voice) {
    case 'warm':
      k.osc('sawtooth', f, { ...e, g: vel * 0.4 }, { at, pan, detune: -8 });
      k.osc('sawtooth', f, { ...e, g: vel * 0.4 }, { at, pan: -pan, detune: 9 });
      k.osc('triangle', f * 0.5, { ...e, g: vel * 0.35 }, { at });
      return;
    case 'glass':
      k.osc('sine', f, { ...e, g: vel * 0.6 }, { at, pan });
      k.osc('sine', f * 1.0025, { ...e, g: vel * 0.4 }, { at, pan: -pan });
      k.osc('triangle', f * 2.003, { ...e, g: vel * 0.14 }, { at, pan });
      return;
    case 'choir': {
      const o1 = k.osc('sawtooth', f, { ...e, g: vel * 0.45 }, { at, pan, detune: -6 });
      k.osc('sawtooth', f, { ...e, g: vel * 0.45 }, { at, pan: -pan, detune: 7 });
      k.lfo(4.7, f * 0.004, o1.frequency, { at, dur: a + e.h + r });
      return;
    }
    case 'air':
      k.noise('pink', { ...e, g: vel * 2.2 }, { at, bp: f * 2, q: 30, pan });
      k.noise('pink', { ...e, g: vel * 1.1 }, { at, bp: f * 3, q: 34, pan: -pan });
      return;
    case 'wrong':
      // an exact quarter-tone pair: it never beats the same way twice against the chord
      k.osc('sawtooth', f, { ...e, g: vel * 0.4 }, { at, pan });
      k.osc('sawtooth', f * 1.0293, { ...e, g: vel * 0.4 }, { at, pan: -pan });
      k.osc('sine', f * 0.5 * 1.0595, { ...e, g: vel * 0.25 }, { at });
      return;
    default:
      // felt chord: struck, then left to ring
      k.osc('triangle', f, { a: 0.012, d: Math.max(2.4, dur * 0.9), g: vel * 0.6 }, { at, pan, lp: [f * 4, f * 1.4, 0.8] });
      k.osc('sine', f * 2, { a: 0.012, d: 1.0, g: vel * 0.1 }, { at, pan });
  }
}

/** One low string note (three desks, slightly apart) into the ensemble filter. */
export function stringNote(k: Kit, at: number, f: number, dur: number, vel: number, pan: number): void {
  const a = Math.min(0.9, dur * 0.25);
  const e = { a, h: Math.max(0.05, dur - a), d: Math.min(1.6, dur * 0.4), lin: true };
  k.osc('sawtooth', f, { ...e, g: vel * 0.36 }, { at, pan, detune: -9 });
  k.osc('sawtooth', f, { ...e, g: vel * 0.36 }, { at, pan: -pan * 0.6, detune: 11 });
  // violas an octave above the cellos: the part of the section that carries on small speakers
  k.osc('sawtooth', f * 2, { ...e, g: vel * 0.36 }, { at, pan: pan * 0.3, detune: 4 });
}

/** Brass section note: a slow swell over `dur`, or a short marcato stab. */
export function brassNote(k: Kit, at: number, f: number, dur: number, vel: number, stab: boolean): void {
  // brightness is a property of how hard the section plays, not of the pitch: open to ~1–3 kHz at forte
  const bright = (800 + 2400 * vel) / f;
  if (stab) brass(k, f, { a: 0.025, h: 0.07, d: 0.42, g: vel }, bright * 1.2, { at });
  else brass(k, f, { a: dur * 0.5, h: dur * 0.12, d: dur * 0.42, g: vel }, bright, { at });
}
