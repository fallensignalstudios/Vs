/**
 * Score definitions — the two protagonists and the scenes where their sound worlds meet.
 * Dominion/Tarrik: D minor, warm, brass-weighted, taiko, deliberate. Reformation/Selene: A suspended, glass,
 * precise clicks and ostinati, no drums with skins.
 */
import { ch } from './theory';
import type { MusicDef } from './types';
import { SELENE, SELENE_FRAGMENT, TARRIK, TARRIK_FRAGMENT } from './motifs';

const D = 38; // D2
const A = 45; // A2

const TAIKO = ['X.......x.......', 'X..x....X.x.....', 'X..x..x.X.x.x.xx'] as const;

export const FACTION_MUSIC: Record<'context' | 'approachTarrik' | 'combatTarrik' | 'approachSelene' | 'stealth' | 'combatSelene' | 'duel' | 'carrier', MusicDef> = {
  /** Z00 opening: the fleet battle heard through a hull. Dark, slow, a horn that only half remembers its theme. */
  context: {
    family: 'dominion', bpm: 56, beats: 4, tonic: D, db: -23, fixedIntensity: 0.3,
    chords: [ch(0, 'm', 4), ch(8, 'M', 4)],
    layers: [
      { kind: 'sub', g: 0.6 },
      { kind: 'pad', voice: 'warm', low: 50, n: 3, g: 0.26, bright: [360, 700], wet: 0.4 },
      { kind: 'strings', low: 38, n: 2, g: 0.2, bright: [320, 700], wet: 0.3 },
      { kind: 'brass', every: 4, at: 2, bars: 2, low: 38, g: 0.2, wet: 0.5 },
      { kind: 'perc', inst: 'odaiko', tiers: ['X...............'], mask: 'x.', g: 0.4, human: 0.01, wet: 0.8 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK_FRAGMENT, every: 8, at: 4, prob: 0.8, base: 50, g: 0.22, wet: 0.6 },
    ],
  },

  approachTarrik: {
    family: 'dominion', bpm: 72, beats: 4, tonic: D, db: -22,
    chords: [ch(0, 'm', 2), ch(8, 'M', 2), ch(5, 'm', 2), ch(7, '5', 2)],
    layers: [
      { kind: 'sub', g: [0.5, 0.6], follow: true },
      { kind: 'pad', voice: 'warm', low: 50, n: 3, g: [0.3, 0.22], bright: [500, 1100], wet: 0.35 },
      { kind: 'strings', low: 38, n: 2, g: [0.28, 0.5], gate: ['X...o...X...o...'], th: [0.1, 0.8], bright: [420, 1200], wet: 0.3 },
      { kind: 'brass', every: 4, at: 2, bars: 2, low: 38, g: [0.14, 0.38], prob: 0.9, wet: 0.45 },
      { kind: 'perc', inst: 'odaiko', tiers: ['X...............', 'X.........o.....', 'X.....o...x.....'], g: [0.14, 0.6], th: [0, 0.7], human: 0.012, wet: 0.6 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK, every: 8, at: 4, prob: 0.85, base: 50, g: [0.3, 0.36], wet: 0.5 },
    ],
  },

  combatTarrik: {
    family: 'dominion', bpm: 96, beats: 4, tonic: D, db: -19,
    chords: [ch(0, 'm', 2), ch(8, 'M', 1), ch(10, 'M', 1), ch(0, 'm', 2), ch(5, 'm', 1), ch(7, '5', 1)],
    layers: [
      { kind: 'sub', g: 0.6, follow: true },
      { kind: 'strings', low: 38, n: 3, g: [0.42, 0.62], gate: ['X..x..x.X..x..x.', 'X.xxX.xxX.xxX.xx'], bright: [700, 2200], wet: 0.25 },
      { kind: 'perc', inst: 'taiko', tiers: TAIKO, g: [0.5, 0.85], human: 0.008, wet: 0.45 },
      { kind: 'perc', inst: 'odaiko', tiers: ['X...............', 'X...............', 'X.........X.....'], g: [0.4, 0.7], human: 0.008, wet: 0.5 },
      { kind: 'perc', inst: 'anvil', tiers: ['................', '....x.......x...', '....X.......X..x'], g: [0, 0.36], th: [0.35, 0.8], wet: 0.4 },
      { kind: 'perc', inst: 'clack', tiers: ['................', '..x...x...x...x.'], g: [0, 0.2], th: [0.5, 0.9], human: 0.004 },
      { kind: 'brass', every: 1, bars: 1, low: 38, stab: true, pattern: 'X.........x.....', g: [0, 0.46], th: [0.3, 0.8], wet: 0.4 },
      { kind: 'brass', every: 4, at: 3, bars: 1, low: 38, g: [0.24, 0.5], wet: 0.45 },
      { kind: 'pad', voice: 'warm', low: 50, n: 3, g: [0.2, 0.14], wet: 0.3 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK, every: 4, at: 2, base: 50, g: [0, 0.4], th: [0.5, 0.9], wet: 0.45 },
    ],
  },

  approachSelene: {
    family: 'reformation', bpm: 80, beats: 4, tonic: A, db: -22,
    chords: [ch(0, 'sus2', 2), ch(9, 'sus4', 2), ch(5, 'sus2', 2), ch(7, 'sus4', 2)],
    layers: [
      { kind: 'sub', g: [0.4, 0.5], follow: true },
      { kind: 'pad', voice: 'glass', low: 57, n: 4, g: [0.32, 0.28], bright: [1400, 3200], wet: 0.5 },
      { kind: 'pad', voice: 'air', low: 69, n: 2, g: [0.1, 0.16], wet: 0.6 },
      { kind: 'pulse', voice: 'tick', tiers: ['x.......x.......', 'x...x...x...x...', 'x.x.x.x.x.x.x.x.'], notes: [0, 2, 1, 2], low: 69, g: [0.08, 0.3], th: [0.1, 0.8], wet: 0.35 },
      { kind: 'motif', voice: 'glass', phrases: SELENE, every: 4, prob: 0.9, base: 69, g: [0.32, 0.36], wet: 0.6 },
      { kind: 'perc', inst: 'rim', tiers: ['................', '........x.......', '....x.......x..x'], g: [0, 0.25], th: [0.3, 0.8], wet: 0.25 },
    ],
  },

  /** Z03 scan planes: almost nothing. A tick that counts, air that tightens as detection nears. */
  stealth: {
    family: 'reformation', bpm: 66, beats: 4, tonic: A, db: -26,
    chords: [ch(0, '5', 4), ch(5, 'sus2', 4)],
    layers: [
      { kind: 'sub', g: 0.5 },
      { kind: 'pad', voice: 'glass', low: 57, n: 2, g: [0.18, 0.2], bright: [500, 900], wet: 0.5 },
      { kind: 'pulse', voice: 'tick', tiers: ['x...............', 'x.......x.......', 'x...x...x...x.x.'], notes: [0], low: 69, g: [0.12, 0.28], wet: 0.4 },
      { kind: 'pad', voice: 'air', low: 81, n: 2, g: [0, 0.22], th: [0.3, 1], wet: 0.6 },
      { kind: 'perc', inst: 'kick', tiers: ['................', 'X.......X.......', 'X..x....X..x....'], g: [0, 0.35], th: [0.4, 0.9] },
      { kind: 'motif', voice: 'glass', phrases: SELENE_FRAGMENT, every: 8, at: 4, prob: 0.6, base: 69, g: [0.16, 0.1], wet: 0.7 },
    ],
  },

  combatSelene: {
    family: 'reformation', bpm: 112, beats: 4, tonic: A, db: -19,
    chords: [ch(0, 'sus2', 2), ch(9, 'sus4', 2), ch(5, 'sus2', 2), ch(7, 'sus4', 1), ch(7, '5', 1)],
    layers: [
      { kind: 'sub', g: 0.5, follow: true },
      { kind: 'pulse', voice: 'pluck', tiers: ['x..x..x.x..x..x.', 'x.xx.xx.x.xx.xx.', 'xXxxxXxxxXxxxXxx'], notes: [0, 1, 2, 3, 2, 1, 4, 2], low: 57, g: [0.3, 0.45], wet: 0.3 },
      { kind: 'pulse', voice: 'bass', tiers: ['x.......x.......', 'x..x....x..x..x.', 'x..x..x.x..x..x.'], notes: [0], low: 33, g: [0.35, 0.5] },
      { kind: 'perc', inst: 'kick', tiers: ['X.......X.......', 'X.....x.X.......', 'X..x..x.X..x..x.'], g: [0.4, 0.7] },
      { kind: 'perc', inst: 'rim', tiers: ['....x.......x...', '....x..x....x...', '..x.x..x..x.x.xx'], g: [0.25, 0.5], wet: 0.2 },
      { kind: 'perc', inst: 'hat', tiers: ['..x...x...x...x.', 'x.x.x.x.x.x.x.x.', 'XoxoXoxoXoxoXoxo'], g: [0.08, 0.2] },
      { kind: 'perc', inst: 'metal', tiers: ['................', '..........x.....'], g: [0, 0.2], th: [0.6, 1], wet: 0.4 },
      { kind: 'pad', voice: 'glass', low: 57, n: 3, g: [0.22, 0.2], bright: [1500, 4000], wet: 0.4 },
      { kind: 'strings', low: 45, n: 2, g: [0, 0.3], th: [0.4, 0.9], gate: ['X.x.X.x.X.x.X.x.'], bright: [900, 2600], wet: 0.3 },
      { kind: 'motif', voice: 'glass', phrases: SELENE, every: 4, at: 2, base: 69, g: [0.2, 0.34], th: [0.2, 0.8], wet: 0.5 },
    ],
  },

  /**
   * Z05 restrained duel: two bars of his music, two bars of hers, trading the floor. Neither is allowed to
   * finish a phrase over the other.
   */
  duel: {
    family: 'neutral', bpm: 104, beats: 4, tonic: D, db: -19,
    chords: [ch(0, 'm', 2), ch(7, 'sus4', 2), ch(8, 'M', 2), ch(7, 'sus2', 2)],
    layers: [
      { kind: 'sub', g: 0.5, follow: true },
      { kind: 'perc', inst: 'odaiko', tiers: ['X...............'], g: 0.5, human: 0.006, wet: 0.5 },
      { kind: 'perc', inst: 'taiko', tiers: ['X..x....X.x.....', 'X..x..x.X.x.x.xx'], mask: 'xx..', g: [0.5, 0.8], human: 0.008, wet: 0.4 },
      { kind: 'brass', every: 1, bars: 1, low: 38, stab: true, pattern: 'X.....x...X.....', mask: 'xx..', g: [0.3, 0.5], wet: 0.4 },
      { kind: 'strings', low: 38, n: 2, gate: ['X.xxX.xxX.xxX.xx'], legato: false, mask: 'xx..', g: 0.45, bright: [800, 2000], wet: 0.25 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK, every: 4, base: 50, g: 0.3, wet: 0.45 },
      { kind: 'pulse', voice: 'pluck', tiers: ['x.xx.xx.x.xx.xx.', 'xXxxxXxxxXxxxXxx'], notes: [0, 2, 1, 3, 2, 4, 3, 2], low: 57, mask: '..xx', g: [0.34, 0.46], wet: 0.3 },
      { kind: 'perc', inst: 'kick', tiers: ['X.......X.......', 'X..x..x.X..x..x.'], mask: '..xx', g: 0.5 },
      { kind: 'perc', inst: 'rim', tiers: ['....x..x....x...', '..x.x..x..x.x.xx'], mask: '..xx', g: 0.4, wet: 0.2 },
      { kind: 'motif', voice: 'glass', phrases: SELENE, every: 4, at: 2, base: 69, g: 0.3, wet: 0.5 },
    ],
  },

  /** Z05 carrier rescue: 7,184 people and 1:31 on the readout. A clock, a rising bass line, no way back down. */
  carrier: {
    family: 'neutral', bpm: 120, beats: 4, tonic: D, db: -19,
    chords: [ch(0, 'm', 2), ch(2, 'sus4', 2), ch(3, 'M', 2), ch(5, 'sus2', 2), ch(7, 'sus4', 2), ch(8, 'M', 2), ch(10, 'M', 2), ch(7, '5', 2)],
    layers: [
      { kind: 'sub', g: 0.55, follow: true },
      { kind: 'pulse', voice: 'bass', tiers: ['x.x.x.x.x.x.x.x.'], notes: [0], low: 26, g: [0.4, 0.5] },
      { kind: 'pulse', voice: 'clock', tiers: ['x...x...x...x...', 'x.x.x.x.x.x.x.x.'], notes: [0, 2], low: 74, g: [0.2, 0.28], wet: 0.4 },
      { kind: 'strings', low: 50, n: 3, gate: ['X.x.X.x.X.x.X.x.'], legato: false, g: [0.36, 0.5], bright: [800, 2400], wet: 0.3 },
      { kind: 'perc', inst: 'taiko', tiers: ['X.......X.......', 'X.....x.X.....x.', 'X..x..x.X..x.xxx'], g: [0.3, 0.7], human: 0.006, wet: 0.4 },
      { kind: 'perc', inst: 'odaiko', tiers: ['X...............'], g: 0.5, wet: 0.5 },
      { kind: 'perc', inst: 'clack', tiers: ['................', 'x.x.x.x.x.x.x.x.'], g: [0, 0.16] },
      { kind: 'brass', every: 2, at: 1, bars: 1, low: 38, g: [0.2, 0.5], wet: 0.45 },
      { kind: 'pad', voice: 'glass', low: 62, n: 2, g: 0.14, wet: 0.5 },
    ],
  },
};
