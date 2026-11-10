/**
 * Score definitions — the King / Meridian identity and the quiet end of the mission.
 * Open fifths and bell tones on D with the third withheld. While unresolved, harmony only ever moves between
 * D5, Asus4 and Gsus2; once `meridianComplete` fires the `resolved` cycles (with F♯) replace them.
 */
import { ch } from './theory';
import type { MusicDef } from './types';
import { KING, KING_RESOLVED, SELENE, SELENE_FRAGMENT, TARRIK, TARRIK_FRAGMENT, TOLL } from './motifs';

const D = 38; // D2

type KingState = 'title' | 'atrium' | 'quarantine' | 'recognition' | 'core' | 'witness' | 'consequence' | 'observation' | 'departure' | 'credits';

export const KING_MUSIC: Record<KingState, MusicDef> = {
  title: {
    family: 'king', bpm: 60, beats: 4, tonic: D, db: -21, fixedIntensity: 0.5,
    chords: [ch(0, '5', 4), ch(7, 'sus4', 2), ch(5, 'sus2', 2)],
    layers: [
      { kind: 'sub', g: 0.5 },
      { kind: 'pad', voice: 'choir', low: 50, n: 3, g: 0.2, bright: [1700, 3050], wet: 0.6 },
      { kind: 'pad', voice: 'glass', low: 62, n: 2, g: 0.16, wet: 0.6 },
      { kind: 'strings', low: 38, n: 2, g: 0.22, bright: [950, 1700], wet: 0.35 },
      { kind: 'motif', voice: 'bell', phrases: KING, every: 4, base: 62, g: 0.34, wet: 0.7 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK_FRAGMENT, every: 16, at: 6, base: 50, g: 0.2, wet: 0.55 },
      { kind: 'motif', voice: 'glass', phrases: SELENE_FRAGMENT, every: 16, at: 14, base: 74, g: 0.16, wet: 0.7 },
    ],
  },

  /** Z05: a room three hundred metres across. Mostly floor and air; the carrier's shadow is in the sub. */
  atrium: {
    family: 'king', bpm: 54, beats: 4, tonic: D, db: -22,
    chords: [ch(0, '5', 4), ch(10, '5', 4), ch(5, 'sus2', 4), ch(0, '5', 4)],
    layers: [
      { kind: 'sub', g: [0.6, 0.7], follow: true },
      { kind: 'pad', voice: 'choir', low: 38, n: 3, g: [0.16, 0.2], bright: [950, 1900], wet: 0.8 },
      { kind: 'strings', low: 38, n: 2, g: [0.24, 0.4], bright: [650, 1700], wet: 0.4 },
      { kind: 'pad', voice: 'air', low: 62, n: 2, g: 0.1, wet: 0.7 },
      { kind: 'motif', voice: 'bell', phrases: TOLL, every: 8, at: 2, base: 50, g: 0.2, wet: 0.9 },
      { kind: 'perc', inst: 'boom', tiers: ['................', 'X...............'], mask: 'x...', g: [0, 0.3], th: [0.4, 0.9], room: 0.2, wet: 0.35 },
    ],
  },

  /** Z09: the war is gone. One tone, held. */
  quarantine: {
    family: 'king', bpm: 60, beats: 4, tonic: D, db: -37, fixedIntensity: 0,
    chords: [ch(0, '5', 8)],
    layers: [
      { kind: 'held', notes: [69], g: 0.5, wet: 0.8 },
      { kind: 'sub', g: 0.12 },
    ],
  },

  /** Z09 five-depression recognition: the bells are heard for the first time, and do not resolve. */
  recognition: {
    family: 'king', bpm: 58, beats: 4, tonic: D, db: -24, fixedIntensity: 0.4,
    chords: [ch(0, '5', 4), ch(7, 'sus4', 2), ch(5, 'sus2', 2)],
    resolved: [ch(0, 'add9', 4), ch(7, 'sus4', 2), ch(5, 'M', 2)],
    layers: [
      { kind: 'sub', g: 0.35 },
      { kind: 'pad', voice: 'glass', low: 62, n: 2, g: 0.2, wet: 0.7 },
      { kind: 'pad', voice: 'air', low: 74, n: 2, g: 0.1, wet: 0.7 },
      { kind: 'motif', voice: 'bell', phrases: KING, every: 2, base: 62, g: 0.36, wet: 0.8, when: 'unresolved' },
      { kind: 'motif', voice: 'bell', phrases: KING_RESOLVED, every: 2, base: 62, g: 0.36, wet: 0.8, when: 'resolved' },
    ],
  },

  /** Z10 Crownmark chamber: fine mechanical alignment — a clockwork of pure tones finding its seat. */
  core: {
    family: 'king', bpm: 66, beats: 4, tonic: D, db: -22,
    chords: [ch(0, '5', 2), ch(7, 'sus4', 2), ch(0, '5', 2), ch(5, 'sus2', 2)],
    resolved: [ch(0, 'add9', 2), ch(7, 'sus4', 2), ch(0, 'add9', 2), ch(5, 'M', 2)],
    layers: [
      { kind: 'sub', g: 0.45, follow: true },
      { kind: 'pad', voice: 'choir', low: 50, n: 3, g: [0.16, 0.22], bright: [1500, 2850], wet: 0.6 },
      { kind: 'pulse', voice: 'clock', tiers: ['x.......x.......', 'x...x...x...x...', 'x.x.x.x.x.x.x.x.', 'x.xxx.x.x.xxx.x.'], notes: [0, 1, 2, 1, 3, 1, 2, 1], low: 74, g: [0.16, 0.34], room: 0.25, wet: 0.3 },
      { kind: 'strings', low: 38, n: 2, g: [0.14, 0.26], bright: [750, 1900], wet: 0.35 },
      { kind: 'motif', voice: 'bell', phrases: KING, every: 4, base: 62, g: 0.3, wet: 0.8, when: 'unresolved' },
      { kind: 'motif', voice: 'bell', phrases: KING_RESOLVED, every: 4, base: 62, g: 0.32, wet: 0.8, when: 'resolved' },
      { kind: 'perc', inst: 'metal', tiers: ['................', '........x.......'], g: [0, 0.12], th: [0.5, 1], room: 0.3, wet: 0.4 },
    ],
  },

  /** Witness V (~90 s): a choir that is not human, one deep bell, and all the time in the world. */
  witness: {
    family: 'king', bpm: 48, beats: 4, tonic: D, db: -21, fixedIntensity: 0.6,
    chords: [ch(0, '5', 4), ch(5, 'sus2', 4), ch(10, '5', 2), ch(7, 'sus4', 2)],
    resolved: [ch(0, 'M', 4), ch(5, 'add9', 4), ch(10, 'M', 2), ch(7, 'M', 2)],
    layers: [
      { kind: 'sub', g: 0.5, follow: true },
      { kind: 'pad', voice: 'choir', low: 50, n: 4, g: 0.3, bright: [1700, 3250], wet: 0.7 },
      { kind: 'pad', voice: 'air', low: 62, n: 2, g: 0.12, wet: 0.7 },
      { kind: 'strings', low: 38, n: 2, g: 0.2, bright: [750, 1700], wet: 0.4 },
      { kind: 'motif', voice: 'bell', phrases: TOLL, every: 4, base: 50, g: 0.3, wet: 0.85 },
      { kind: 'motif', voice: 'bell', phrases: KING, every: 4, at: 2, base: 62, g: 0.22, wet: 0.8, when: 'unresolved' },
      { kind: 'motif', voice: 'bell', phrases: KING_RESOLVED, every: 4, at: 2, base: 62, g: 0.26, wet: 0.8, when: 'resolved' },
    ],
  },

  /** After: what was decided cannot be undecided. Low strings, and each of them remembering their own tune. */
  consequence: {
    family: 'king', bpm: 56, beats: 4, tonic: D, db: -23, fixedIntensity: 0.4,
    chords: [ch(0, 'm', 2), ch(8, 'M', 2), ch(3, 'M', 2), ch(7, 'sus4', 2)],
    layers: [
      { kind: 'sub', g: 0.4, follow: true },
      { kind: 'strings', low: 38, n: 3, g: 0.34, bright: [950, 2100], wet: 0.4 },
      { kind: 'pad', voice: 'warm', low: 50, n: 3, g: 0.2, bright: [850, 1700], wet: 0.4 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK_FRAGMENT, every: 8, base: 50, g: 0.2, wet: 0.55 },
      { kind: 'motif', voice: 'glass', phrases: SELENE_FRAGMENT, every: 8, at: 4, base: 74, g: 0.16, wet: 0.7 },
      { kind: 'motif', voice: 'bell', phrases: KING_RESOLVED, every: 8, at: 6, base: 62, g: 0.18, wet: 0.8, when: 'resolved' },
    ],
  },

  /** Z11: room tone and unhurried voices. Sparse warm harmony on a soft keyboard, nothing that asks for attention. */
  observation: {
    family: 'neutral', bpm: 52, beats: 4, tonic: D, db: -27, fixedIntensity: 0.3,
    chords: [ch(3, 'M7', 2), ch(0, 'm7', 2), ch(8, 'M7', 2), ch(10, 'sus2', 2)],
    layers: [
      { kind: 'sub', g: 0.22, follow: true },
      { kind: 'pad', voice: 'felt', low: 53, n: 4, g: 0.4, bright: [2200, 3400], wet: 0.4 },
      { kind: 'pad', voice: 'warm', low: 50, n: 3, g: 0.1, bright: [750, 1350], wet: 0.4 },
      // the room itself: a little moving air above the keyboard
      { kind: 'pad', voice: 'air', low: 84, n: 2, g: 0.035, wet: 0.5 },
      { kind: 'motif', voice: 'felt', phrases: [[[4, 7, 8, 0.6], [14, 4, 10, 0.5]], [[6, 0, 8, 0.55], [16, 2, 6, 0.45], [22, 4, 10, 0.5]], [[8, 9, 12, 0.5]]], every: 4, at: 1, base: 65, g: 0.3, wet: 0.5 },
    ],
  },

  /** Z12: his line in D minor, hers over the same D with F♯. Open fifths underneath so neither is confirmed. */
  departure: {
    family: 'neutral', bpm: 60, beats: 4, tonic: D, db: -22, fixedIntensity: 0.4,
    chords: [ch(0, '5', 2), ch(5, 'sus2', 2), ch(0, '5', 2), ch(7, 'sus4', 2)],
    layers: [
      { kind: 'sub', g: 0.45, follow: true },
      { kind: 'strings', low: 38, n: 2, g: 0.3, bright: [850, 1900], wet: 0.4 },
      { kind: 'pad', voice: 'glass', low: 62, n: 2, g: 0.16, wet: 0.6 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK, every: 4, base: 50, g: 0.34, wet: 0.5 },
      { kind: 'motif', voice: 'glass', phrases: SELENE, every: 4, at: 2, base: 74, g: 0.3, wet: 0.65 },
    ],
  },

  /** Credits: the same counterpoint with both of their rhythm sections, still ending on a suspension. */
  credits: {
    family: 'neutral', bpm: 76, beats: 4, tonic: D, db: -20, fixedIntensity: 0.6,
    chords: [ch(0, '5', 2), ch(5, 'sus2', 2), ch(8, 'M', 2), ch(7, 'sus4', 2), ch(0, '5', 2), ch(5, 'sus2', 2), ch(9, 'm', 2), ch(7, 'sus4', 2)],
    layers: [
      { kind: 'sub', g: 0.5, follow: true },
      { kind: 'strings', low: 38, n: 3, gate: ['X.......x.......'], legato: false, g: 0.36, bright: [1150, 2650], wet: 0.35 },
      { kind: 'pad', voice: 'glass', low: 62, n: 3, g: 0.16, wet: 0.6 },
      { kind: 'pad', voice: 'warm', low: 50, n: 2, g: 0.14, wet: 0.4 },
      { kind: 'perc', inst: 'odaiko', tiers: ['X.........x.....'], g: 0.3, human: 0.01, room: 0.3, wet: 0.15 },
      { kind: 'perc', inst: 'rim', tiers: ['....x.......x...'], g: 0.24, room: 0.2 },
      { kind: 'perc', inst: 'shime', tiers: ['x...x...x...x...'], g: 0.1, human: 0.004, room: 0.2 },
      { kind: 'pulse', voice: 'pluck', tiers: ['x..x..x.x..x..x.'], notes: [0, 1, 2, 1, 3, 2, 1, 2], low: 62, g: 0.2, room: 0.15, wet: 0.15 },
      { kind: 'motif', voice: 'horn', phrases: TARRIK, every: 4, base: 50, g: 0.34, wet: 0.5 },
      { kind: 'motif', voice: 'glass', phrases: SELENE, every: 4, at: 2, base: 74, g: 0.3, wet: 0.65 },
    ],
  },
};
