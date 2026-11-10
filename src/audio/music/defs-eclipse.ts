/**
 * Score definitions — the Eclipse identity and the scenes it presses on.
 * Tonic C♯: a semitone under the Dominion's D, so Tarrik's drums (tuned D) grind against it. The cadence layer
 * ticks on every beat with no humanisation at all; `stinger('sever')` makes it stumble.
 */
import { ch } from './theory';
import type { MusicDef } from './types';
import { SELENE_FRAGMENT, TARRIK_FRAGMENT } from './motifs';

const CS = 37; // C♯2
const D = 38;

const CADENCE = 'X...X...X...X...';

export const ECLIPSE_MUSIC: Record<'breach' | 'combatEclipse' | 'elite' | 'decision' | 'resonance', MusicDef> = {
  /** Z06 approach: matched cadence before any threat is visible. */
  breach: {
    family: 'eclipse', bpm: 100, beats: 4, tonic: CS, db: -23,
    chords: [ch(0, 'b2', 4), ch(6, 'tri', 2), ch(1, '5', 2)],
    layers: [
      { kind: 'sub', g: 0.45 },
      { kind: 'pad', voice: 'wrong', low: 49, n: 2, g: [0.2, 0.26], bright: [950, 2100], wet: 0.45 },
      { kind: 'pad', voice: 'air', low: 61, n: 2, g: [0.16, 0.2], wet: 0.6 },
      { kind: 'cadence', pattern: CADENCE, g: [0.4, 0.5], room: 0.35, wet: 0.2 },
      { kind: 'perc', inst: 'boom', tiers: ['................', 'X...............'], mask: 'x...', g: [0, 0.3], room: 0.2, wet: 0.3 },
      { kind: 'perc', inst: 'odaiko', tiers: ['................', 'X.......x.......'], g: [0, 0.26], th: [0.4, 0.9], tune: 49, human: 0.01, room: 0.3, wet: 0.15 },
    ],
  },

  /** E3: Tarrik's drums against the cadence. */
  combatEclipse: {
    family: 'eclipse', bpm: 100, beats: 4, tonic: CS, db: -21,
    chords: [ch(0, 'b2', 2), ch(6, 'tri', 1), ch(1, '5', 1), ch(0, 'b2', 2), ch(8, 'm', 1), ch(7, 'tri', 1)],
    layers: [
      { kind: 'sub', g: 0.7, follow: true },
      { kind: 'cadence', pattern: CADENCE, g: 0.5, room: 0.3, wet: 0.15 },
      { kind: 'pad', voice: 'wrong', low: 49, n: 3, g: 0.42, bright: [1250, 3000], wet: 0.4 },
      { kind: 'strings', low: 37, n: 2, gate: ['X..x..x.X..x..x.', 'X.xxX.xxX.xxX.xx'], g: [0.6, 0.84], bright: [1400, 4600], wet: 0.2 },
      { kind: 'perc', inst: 'taiko', tiers: ['X.......x.......', 'X..x....X.x.....', 'X..x..x.X.x.x.xx'], tune: 73.4, g: [0.28, 0.48], human: 0.008, room: 0.3 },
      { kind: 'perc', inst: 'odaiko', tiers: ['X...............', 'X.........X.....'], tune: 49, g: 0.32, human: 0.008, room: 0.3, wet: 0.1 },
      // a tick that is too even to be played by anyone: no humanisation, no accents
      { kind: 'perc', inst: 'hat', tiers: ['x.x.x.x.x.x.x.x.', 'xxxxxxxxxxxxxxxx'], g: [0.2, 0.42], room: 0.1 },
      { kind: 'perc', inst: 'shime', tiers: ['................', 'x...x...x...x...', 'x.oxx.oxx.oxx.ox'], g: [0.08, 0.53], th: [0.2, 0.9], human: 0.004, room: 0.2 },
      { kind: 'perc', inst: 'anvil', tiers: ['................', '....x.......x...'], g: [0.06, 0.4], th: [0.3, 0.9], room: 0.3, wet: 0.1 },
      { kind: 'brass', every: 1, bars: 1, low: 37, stab: true, pattern: 'X...............', g: [0.26, 0.52], room: 0.2, wet: 0.15 },
      // the wrong chord again, two octaves up, where it cannot be mistaken for warmth
      { kind: 'pad', voice: 'wrong', low: 73, n: 2, g: [0.05, 0.2], bright: [3000, 6500], wet: 0.4 },
    ],
  },

  /** E4: the elite. 3+3+2 accents, low brass clusters, both protagonists' percussion; Selene's glass joins late. */
  elite: {
    family: 'eclipse', bpm: 108, beats: 4, tonic: CS, db: -20,
    chords: [ch(0, 'b2', 2), ch(6, 'tri', 2), ch(1, '5', 2), ch(0, 'dim', 2)],
    layers: [
      { kind: 'sub', g: 0.7, follow: true },
      { kind: 'cadence', pattern: CADENCE, g: 0.44, room: 0.3, wet: 0.15 },
      { kind: 'perc', inst: 'taiko', tiers: ['X..X..X.X..X..X.', 'X.oX.oX.X.oX.oXo'], tune: 73.4, g: [0.3, 0.46], human: 0.008, room: 0.3 },
      { kind: 'perc', inst: 'odaiko', tiers: ['X.......X.......'], tune: 49, g: 0.26, human: 0.008, room: 0.3, wet: 0.1 },
      { kind: 'perc', inst: 'boom', tiers: ['X...............'], mask: 'x.', g: 0.2, room: 0.2, wet: 0.25 },
      { kind: 'perc', inst: 'anvil', tiers: ['....X.......X...', '....X..x....X..x'], g: [0.16, 0.44], room: 0.3, wet: 0.1 },
      { kind: 'perc', inst: 'shime', tiers: ['x...x...x...x...', 'x.oxx.oxx.oxx.ox'], g: [0.26, 0.7], human: 0.004, room: 0.2 },
      { kind: 'perc', inst: 'hat', tiers: ['..x...x...x...x.', 'x.x.x.x.x.x.x.x.'], g: [0.16, 0.46], room: 0.1 },
      { kind: 'perc', inst: 'rim', tiers: ['................', '..x...x...x...x.'], g: [0, 0.4], th: [0.5, 1], room: 0.15 },
      { kind: 'brass', every: 2, bars: 2, low: 37, g: [0.34, 0.58], wet: 0.35 },
      { kind: 'brass', every: 1, bars: 1, low: 37, stab: true, pattern: 'X..X..X.........', g: [0.26, 0.52], room: 0.2, wet: 0.15 },
      { kind: 'strings', low: 37, n: 2, gate: ['X..X..X.X..X..X.'], legato: false, g: [0.64, 0.9], bright: [1800, 6000], wet: 0.2 },
      { kind: 'pulse', voice: 'glass', tiers: ['................', 'x..x..x.x..x..x.'], notes: [0, 2, 1, 3], low: 73, g: [0, 0.34], th: [0.5, 1], room: 0.1, wet: 0.3 },
      { kind: 'pad', voice: 'wrong', low: 49, n: 2, g: 0.22, wet: 0.4 },
      // the wrong chord two octaves up: the top of the texture, where corruption cannot pass for warmth
      { kind: 'pad', voice: 'wrong', low: 73, n: 2, g: [0.14, 0.46], bright: [3400, 7500], wet: 0.4 },
    ],
  },

  /** Z07: the one choice. Time held open; a low warm tone to the west, a high cool one to the east. */
  decision: {
    family: 'neutral', bpm: 50, beats: 4, tonic: D, db: -24, fixedIntensity: 0.4,
    chords: [ch(0, 'sus2', 4), ch(0, 'sus4', 4)],
    layers: [
      { kind: 'sub', g: 0.45 },
      { kind: 'pad', voice: 'glass', low: 62, n: 3, g: 0.2, bright: [1200, 2400], wet: 0.5 },
      { kind: 'pad', voice: 'warm', low: 50, n: 2, g: 0.18, bright: [750, 1500], wet: 0.4 },
      { kind: 'pad', voice: 'air', low: 86, n: 2, g: 0.05, wet: 0.5 },
      { kind: 'perc', inst: 'kick', tiers: ['X..x............'], g: 0.24, room: 0.15 },
      { kind: 'motif', voice: 'horn', phrases: [[[0, 5, 24, 0.8]], [[0, 0, 24, 0.8]]], every: 4, base: 50, g: 0.22, wet: 0.5 },
      { kind: 'motif', voice: 'glass', phrases: [[[0, 2, 24, 0.8]], [[0, 7, 24, 0.8]]], every: 4, at: 2, base: 74, g: 0.2, wet: 0.6 },
    ],
  },

  /**
   * The Resonance window (Thermal Fracture): Frost held perfectly still above, Cinder's brass pedal swelling
   * below, and nothing in between — the two stay audibly separate until stinger('resonance') joins them.
   */
  resonance: {
    family: 'neutral', bpm: 60, beats: 4, tonic: D, db: -21, fixedIntensity: 0.7,
    chords: [ch(0, '5', 4)],
    layers: [
      { kind: 'sub', g: 0.55 },
      { kind: 'pad', voice: 'glass', low: 81, n: 2, g: 0.24, bright: [4000, 6000], wet: 0.6 },
      { kind: 'pad', voice: 'air', low: 81, n: 2, g: 0.12, wet: 0.6 },
      { kind: 'brass', every: 2, bars: 2, low: 38, g: 0.34, wet: 0.4 },
      { kind: 'perc', inst: 'boom', tiers: ['X.......X.......'], g: 0.24, room: 0.2, wet: 0.25 },
      { kind: 'motif', voice: 'glass', phrases: SELENE_FRAGMENT, every: 4, at: 1, base: 81, g: 0.14, wet: 0.7 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK_FRAGMENT, every: 4, at: 3, base: 38, g: 0.2, wet: 0.4 },
    ],
  },
};
