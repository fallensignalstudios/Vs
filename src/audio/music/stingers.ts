/**
 * Musical stingers — short overlays in the key of whatever is playing, flavoured by the current identity.
 * They answer gameplay immediately (no quantising: a checkpoint or a severed link should be heard *now*).
 */
import type { Kit } from '../synth/kit';
import { brass, breath, glass, pure, struck, thump, wrong } from '../sfx/parts';
import { cadenceHit } from './instruments';
import { mtof } from './theory';
import type { Family, PercInst } from './types';

/** Strike a drum of the stinger (`at` relative to the stinger's start). */
export type Drum = (inst: PercInst, at: number, vel: number, tune?: number) => void;

export type StingerKind = 'checkpoint' | 'encounterStart' | 'encounterClear' | 'sever' | 'resonance' | 'revelation' | 'choice' | 'death';

export const STINGER_KINDS: readonly StingerKind[] = ['checkpoint', 'encounterStart', 'encounterClear', 'sever', 'resonance', 'revelation', 'choice', 'death'];

/** Target output peak of each stinger, dBFS at reference settings. */
export const STINGER_DB: Readonly<Record<StingerKind, number>> = {
  checkpoint: -16, encounterStart: -9, encounterClear: -13, sever: -11, resonance: -7, revelation: -10, choice: -15, death: -9,
};

/**
 * Build a stinger into `k` (kit start = now, output = stinger bus). `tonic` is the MIDI tonic of the current
 * state in the bass register; `family` picks the instrumentation; `drum` strikes its percussion.
 */
export function playStinger(kind: StingerKind, k: Kit, tonic: number, family: Family, drum: Drum): void {
  const hz = (semis: number, oct = 0): number => mtof(tonic + semis + 12 * oct);
  switch (kind) {
    case 'checkpoint': {
      // gold: fifth, then the octave settling above it. Route continuity confirmed.
      pure(k, hz(0, 2), { a: 0.02, d: 1.8, g: 0.8 }, { pan: -0.25 });
      pure(k, hz(7, 2), { a: 0.02, d: 2.0, g: 0.7 }, { at: 0.14, pan: 0.25 });
      pure(k, hz(0, 3), { a: 0.03, d: 2.2, g: 0.4 }, { at: 0.3 });
      k.noise('white', { a: 0.4, d: 1.2, g: 0.02 }, { hp: 8000 });
      return;
    }
    case 'encounterStart': {
      if (family === 'reformation') {
        // precise: a flam of clicks, a rising glass run, a clean low hit
        [0, 0.06, 0.11].forEach((at, i) => drum('rim', at, 0.6 + i * 0.2));
        [0, 2, 7, 12, 14].forEach((s, i) => glass(k, hz(s, 3), { a: 0.003, d: 0.5, g: 0.5 }, { at: 0.12 + i * 0.07, pan: -0.5 + i * 0.25 }));
        drum('kick', 0.5, 1);
        k.osc('sine', hz(0, -1) * 2, { a: 0.01, d: 0.9, g: 0.7 }, { at: 0.5 });
      } else if (family === 'eclipse') {
        // an intake of breath, the wrong chord, and the cadence announcing itself
        breath(k, { a: 0.5, d: 0.03, g: 0.7 }, 0.8);
        wrong(k, hz(0, 1), { a: 0.45, d: 0.6, g: 0.6 }, { rate: 17 });
        drum('odaiko', 0.52, 1, 46);
        [0.52, 0.82, 1.12].forEach((at) => cadenceHit(k, at, 1, 0));
      } else {
        // Dominion (and neutral): a rising brass fifth into one great drum
        brass(k, hz(0, 1), { a: 0.4, h: 0.05, d: 0.5, g: 0.6 }, 7);
        brass(k, hz(7, 1), { a: 0.3, h: 0.05, d: 0.6, g: 0.5 }, 8, { at: 0.18 });
        drum('odaiko', 0.45, 1, 49);
        drum('taiko', 0.45, 0.9, 73.4);
        drum('taiko', 0.7, 0.6, 73.4);
      }
      return;
    }
    case 'encounterClear': {
      // the pressure comes off: one low breath out and an open chord left ringing
      drum('boom', 0, 0.8, 36.7);
      const third = family === 'dominion' ? 3 : family === 'reformation' ? 2 : 7;
      pure(k, hz(0, 1), { a: 0.25, h: 0.3, d: 2.4, g: 0.6 }, { pan: -0.3 });
      pure(k, hz(7, 1), { a: 0.3, h: 0.3, d: 2.4, g: 0.5 }, { pan: 0.3 });
      pure(k, hz(third, 2), { a: 0.4, h: 0.2, d: 2.2, g: 0.35 }, { at: 0.2 });
      if (family === 'reformation') glass(k, hz(14, 2), { a: 0.02, d: 1.6, g: 0.25 }, { at: 0.5 });
      else brass(k, hz(0, 1), { a: 0.6, h: 0.1, d: 1.4, g: 0.25 }, 4);
      return;
    }
    case 'sever': {
      // a line parts: glass snap, a tone that falls out of tune, and two cadence beats that no longer agree
      struck(k, 'glass', hz(7, 4), 0.7, 0.6);
      k.fm([hz(0, 3), hz(-5, 2), 0.25], 1.5, [5, 0.4], { a: 0.002, d: 0.5, g: 0.5 });
      thump(k, 140, 60, 0.14, 0.5);
      cadenceHit(k, 0.3, 0.9, 1);
      cadenceHit(k, 0.3 + k.rr(0.31, 0.47), 0.7, 1);
      breath(k, { a: 0.08, d: 0.9, g: 0.35 }, 0.7, { at: 0.1 });
      return;
    }
    case 'resonance': {
      // Frost alone … Cinder alone … then, for once, the same chord
      glass(k, hz(7, 4), { a: 0.01, h: 0.4, d: 0.5, g: 0.5 }, { pan: 0.35 });
      glass(k, hz(14, 4), { a: 0.01, h: 0.4, d: 0.4, g: 0.3 }, { pan: 0.2 });
      const T = 0.5;
      drum('odaiko', T, 1, 36.7);
      drum('taiko', T, 1, 73.4);
      brass(k, hz(0, 0), { a: 0.02, h: 0.2, d: 1.4, g: 0.7 }, 9, { at: T, to: k.pan(-0.35) });
      brass(k, hz(7, 0), { a: 0.03, h: 0.2, d: 1.4, g: 0.5 }, 8, { at: T, to: k.pan(-0.2) });
      [0, 7, 12, 16, 19].forEach((s, i) => pure(k, hz(s, 2), { a: 0.3, h: 0.5, d: 2.4, g: 0.4 - i * 0.04 }, { at: T + 0.45 + i * 0.06, pan: -0.4 + i * 0.2 }));
      return;
    }
    case 'revelation': {
      // the King's bells, cascading upward in fifths and seconds, over a floor of sub
      k.osc('sine', hz(0, -1), { a: 1.0, h: 1.0, d: 3.0, g: 0.7 });
      [0, 7, 14, 9, 12, 19, 26, 21].forEach((s, i) => {
        const at = 0.25 * i + 0.02 * i * i;
        k.fm(hz(s, 2), 3.5, [2.4, 0.2], { a: 0.003, d: 3.2, g: 0.36 * Math.pow(0.93, i) }, { at, pan: Math.sin(i * 2.1) * 0.7 });
        k.osc('sine', hz(s, 2), { a: 0.004, d: 3.4, g: 0.3 * Math.pow(0.93, i) }, { at, pan: Math.sin(i * 2.1) * 0.7 });
      });
      pure(k, hz(0, 1), { a: 1.4, h: 1, d: 3, g: 0.3 }, { pan: -0.4 });
      pure(k, hz(7, 1), { a: 1.6, h: 1, d: 3, g: 0.25 }, { pan: 0.4 });
      return;
    }
    case 'choice': {
      // two tones that lean apart: low and warm to the west, high and cool to the east
      brass(k, hz(5, 1), { a: 0.5, h: 0.4, d: 1.4, g: 0.4 }, 4, { to: k.pan(-0.6) });
      pure(k, hz(5, 1), { a: 0.4, h: 0.5, d: 1.4, g: 0.4 }, { pan: -0.6 });
      glass(k, hz(14, 3), { a: 0.3, h: 0.5, d: 1.6, g: 0.45 }, { at: 0.35, pan: 0.6 });
      pure(k, hz(0, 2), { a: 0.6, h: 0.3, d: 1.6, g: 0.25 }, { at: 0.2 });
      return;
    }
    default: {
      // death: the line falls a semitone and the floor goes with it
      brass(k, hz(1, 1), { a: 0.03, h: 0.5, d: 1.2, g: 0.5 }, 5);
      brass(k, hz(0, 1), { a: 0.2, h: 0.6, d: 2.0, g: 0.5 }, 3.5, { at: 0.7 });
      k.osc('sine', [hz(0, 0), hz(0, -1), 2.2], { a: 0.05, d: 3.0, g: 0.8 });
      drum('boom', 0, 1, 34);
      k.noise('brown', { a: 0.4, d: 2.4, g: 0.3 }, { lp: [700, 90, 2.4] });
    }
  }
}
