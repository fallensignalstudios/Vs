/**
 * Ambience beds per zone family. Each is a handful of filtered-noise layers and faint tones (continuous),
 * plus randomly scheduled distant events placed in the world around the listener. Every bed also sets how
 * reverberant the space is (`room`) and how dark its tail is (`tone`).
 *
 * Sound by phase (plan p.17): Z00–Z04 muffled pressure + intermittent fleet impacts; Z05 carrier shadow and
 * low structural groan; Z06–Z08 identical Eclipse timing (the breath in `breach`/`crucible` runs at exactly
 * the rate every Eclipse body breathes); Z09 no war sound at all; Z10 fine mechanical alignment; Z11 room tone
 * and distant stellar rumble.
 */
import type { AmbienceId } from '@/core/api';
import type { NoiseColor } from '../synth/buffers';

export interface BedLayer {
  color: NoiseColor;
  type: 'lowpass' | 'bandpass' | 'highpass';
  f: number;
  q?: number;
  g: number;
  /** slow level movement `[rate Hz, depth 0..1]` */
  am?: readonly [number, number];
  /** slow filter movement `[rate Hz, depth Hz]` */
  fm?: readonly [number, number];
  /** noise playback rate (< 1 = coarser, slower) */
  rate?: number;
}

export interface ToneLayer {
  wave: OscillatorType;
  f: number;
  g: number;
  /** a second oscillator this many Hz away, panned opposite: slow beating */
  beat?: number;
  am?: readonly [number, number];
  lp?: number;
}

export interface AmbEvent {
  /** SFX id to place in the world */
  id: string;
  /** seconds between occurrences `[min, max]` */
  every: readonly [number, number];
  /** distance from the listener in metres `[min, max]` */
  dist: readonly [number, number];
  /** volume multiplier `[min, max]` */
  vol?: readonly [number, number];
}

export interface AmbDef {
  /** target bed loudness, dBFS RMS at reference settings */
  db: number;
  /** reverb amount applied to SFX in this space (0 dry … 1.4 cathedral) */
  room: number;
  /** reverb tail brightness (Hz) */
  tone: number;
  beds: readonly BedLayer[];
  tones?: readonly ToneLayer[];
  events?: readonly AmbEvent[];
}

const FLEET: AmbEvent = { id: 'fleetImpact', every: [6, 14], dist: [140, 380], vol: [0.6, 1] };
const GROAN: AmbEvent = { id: 'structuralGroan', every: [16, 32], dist: [40, 110], vol: [0.6, 1] };

export const AMBIENCE: Readonly<Record<Exclude<AmbienceId, 'none'>, AmbDef>> = {
  /** Z00 broken landing: fire, a hull open to wind, hot metal ticking, the battle overhead. */
  crash: {
    db: -30, room: 0.9, tone: 5000,
    beds: [
      { color: 'brown', type: 'lowpass', f: 140, g: 1, am: [0.05, 0.3] },
      { color: 'pink', type: 'bandpass', f: 420, q: 0.6, g: 0.35, fm: [0.07, 150], am: [0.11, 0.4] },
      { color: 'crackle', type: 'highpass', f: 1800, g: 0.22, rate: 0.7, am: [0.31, 0.5] },
      { color: 'pink', type: 'highpass', f: 4500, g: 0.05 },
    ],
    events: [
      FLEET,
      { id: 'ambMetalTick', every: [1.5, 5], dist: [4, 12] },
      { id: 'ambEmberPop', every: [0.8, 2.6], dist: [3, 9] },
      { id: 'structuralGroan', every: [18, 36], dist: [30, 70], vol: [0.5, 0.9] },
      { id: 'debrisFall', every: [20, 42], dist: [14, 30], vol: [0.3, 0.6] },
    ],
  },
  /** Z01 pressure hall: muffled pressure in a very large room. */
  pressureHall: {
    db: -31, room: 1.1, tone: 5500,
    beds: [
      { color: 'brown', type: 'lowpass', f: 110, g: 1, am: [0.04, 0.25] },
      { color: 'pink', type: 'bandpass', f: 260, q: 0.5, g: 0.4, fm: [0.05, 80] },
      { color: 'pink', type: 'bandpass', f: 1800, q: 0.8, g: 0.06, am: [0.09, 0.5] },
    ],
    tones: [{ wave: 'sine', f: 55, g: 0.12, am: [0.08, 0.5] }, { wave: 'sine', f: 82.5, g: 0.05 }],
    events: [{ ...FLEET, every: [5, 12] }, GROAN, { id: 'ambDust', every: [6, 14], dist: [5, 16] }, { id: 'ambServoFar', every: [7, 16], dist: [18, 40] }],
  },
  /** Z02 survivor bend: close, hushed; people behind a partition. */
  survivorBend: {
    db: -33, room: 0.6, tone: 4000,
    beds: [
      { color: 'brown', type: 'lowpass', f: 160, g: 0.7 },
      { color: 'pink', type: 'bandpass', f: 600, q: 0.7, g: 0.2, am: [0.13, 0.3] },
    ],
    tones: [{ wave: 'sine', f: 120, g: 0.04 }],
    events: [
      { id: 'ambMurmur', every: [3, 8], dist: [5, 10] },
      { id: 'ambDrip', every: [2, 6], dist: [3, 9] },
      { id: 'ambMedBeep', every: [4, 9], dist: [4, 8] },
      { ...FLEET, every: [9, 20], vol: [0.4, 0.6] },
    ],
  },
  /** Z03 frozen sensor access: thin air, ice under strain, everything small and high. */
  frozenCorridor: {
    db: -32, room: 0.8, tone: 7500,
    beds: [
      { color: 'pink', type: 'highpass', f: 5000, g: 0.12, am: [0.07, 0.4] },
      { color: 'pink', type: 'bandpass', f: 900, q: 2.5, g: 0.22, fm: [0.06, 300], am: [0.1, 0.5] },
      { color: 'brown', type: 'lowpass', f: 90, g: 0.6 },
    ],
    tones: [{ wave: 'sine', f: 2093, g: 0.012, beat: 1.3, am: [0.05, 0.8] }, { wave: 'sine', f: 3136, g: 0.006, am: [0.07, 0.8] }],
    events: [
      { id: 'ambIceTick', every: [0.6, 2.4], dist: [2, 10] },
      { id: 'ambIceCreak', every: [5, 12], dist: [6, 20] },
      { ...FLEET, every: [12, 25], vol: [0.3, 0.5] },
    ],
  },
  /** Z04 relay overlook: open air over a drop, cold relay hum, other people's radios. */
  relayOverlook: {
    db: -31, room: 1.0, tone: 6000,
    beds: [
      { color: 'brown', type: 'lowpass', f: 120, g: 0.8 },
      { color: 'pink', type: 'bandpass', f: 380, q: 0.5, g: 0.4, fm: [0.08, 160], am: [0.1, 0.35] },
    ],
    tones: [{ wave: 'triangle', f: 140, g: 0.05, beat: 0.7 }, { wave: 'sine', f: 280, g: 0.02 }, { wave: 'sine', f: 840, g: 0.006, am: [0.2, 0.6] }],
    events: [{ id: 'ambCommBlip', every: [4, 10], dist: [10, 25] }, { id: 'ambServoFar', every: [6, 14], dist: [15, 35] }, { ...FLEET, every: [7, 16] }, { ...GROAN, every: [20, 40] }],
  },
  /** Z05 meeting atrium: three hundred metres of air; the carrier's shadow as a throb in the floor. */
  atrium: {
    db: -29, room: 1.4, tone: 4500,
    beds: [
      { color: 'brown', type: 'lowpass', f: 80, g: 1, am: [0.03, 0.3] },
      { color: 'brown', type: 'lowpass', f: 200, g: 0.5, fm: [0.04, 60] },
      { color: 'pink', type: 'bandpass', f: 1500, q: 0.4, g: 0.05, am: [0.06, 0.5] },
    ],
    tones: [
      { wave: 'sine', f: 36.7, g: 0.25, am: [0.05, 0.4] },
      { wave: 'sine', f: 55, g: 0.1, beat: 0.4 },
      { wave: 'sawtooth', f: 48, g: 0.05, lp: 140, am: [0.5, 0.3] },
    ],
    events: [{ id: 'structuralGroan', every: [8, 18], dist: [60, 150] }, { ...FLEET, every: [10, 22] }, { id: 'ambDust', every: [8, 18], dist: [8, 25] }],
  },
  /** Z06 breach rescue: the Eclipse is in the walls. The air itself breathes — at exactly their rate. */
  breach: {
    db: -30, room: 1.0, tone: 3800,
    beds: [
      { color: 'brown', type: 'lowpass', f: 130, g: 0.8 },
      { color: 'pink', type: 'bandpass', f: 500, q: 1.2, g: 0.3, am: [0.42, 0.8] },
      { color: 'pink', type: 'bandpass', f: 2400, q: 2, g: 0.04, am: [0.42, 0.9] },
      { color: 'crackle', type: 'bandpass', f: 700, q: 1, g: 0.08, rate: 0.4 },
    ],
    tones: [{ wave: 'sawtooth', f: 69.3, g: 0.04, lp: 300, beat: 4.1 }],
    events: [
      { id: 'ambDrip', every: [1.5, 4], dist: [3, 10] },
      { id: 'ambWhisper', every: [6, 14], dist: [6, 16] },
      { id: 'screamsBelow', every: [25, 50], dist: [40, 80], vol: [0.4, 0.6] },
      { ...GROAN, every: [15, 30] },
      { id: 'debrisFall', every: [18, 36], dist: [12, 28], vol: [0.3, 0.5] },
    ],
  },
  /** Z07 capture-control gallery: two cages from two factions humming against each other. */
  gallery: {
    db: -32, room: 0.7, tone: 5000,
    beds: [
      { color: 'brown', type: 'lowpass', f: 150, g: 0.6 },
      { color: 'pink', type: 'bandpass', f: 700, q: 0.6, g: 0.15 },
    ],
    tones: [
      { wave: 'sawtooth', f: 100, g: 0.03, lp: 600 },
      { wave: 'sine', f: 200, g: 0.02 },
      { wave: 'triangle', f: 98, g: 0.03, beat: 2 },
      { wave: 'sine', f: 1480, g: 0.004, am: [0.3, 0.7] },
    ],
    events: [
      { id: 'ambRelayClick', every: [2, 6], dist: [3, 10] },
      { id: 'ambCommBlip', every: [5, 12], dist: [6, 14] },
      { id: 'ambZapFar', every: [6, 15], dist: [6, 16] },
      { ...FLEET, every: [10, 20], vol: [0.4, 0.6] },
    ],
  },
  /** Z08 quarantine crucible: a pit. Something very large is breathing in it. */
  crucible: {
    db: -29, room: 1.2, tone: 3500,
    beds: [
      { color: 'brown', type: 'lowpass', f: 70, g: 1, am: [0.05, 0.3] },
      { color: 'pink', type: 'bandpass', f: 300, q: 1, g: 0.35, am: [0.17, 0.85] },
      { color: 'pink', type: 'highpass', f: 3000, g: 0.03, am: [0.17, 0.9] },
    ],
    tones: [{ wave: 'sine', f: 34.6, g: 0.2, am: [0.17, 0.5] }, { wave: 'sawtooth', f: 51.9, g: 0.04, lp: 200, beat: 3.3 }],
    events: [
      { id: 'ambChain', every: [3, 9], dist: [6, 18] },
      { id: 'ambDrip', every: [2, 5], dist: [4, 12] },
      { id: 'ambWhisper', every: [5, 12], dist: [8, 20] },
      { ...GROAN, every: [12, 26] },
    ],
  },
  /** Z09 wound gallery: quarantine has stripped the war away. What is left is almost nothing — and the Wound. */
  woundGallery: {
    db: -38, room: 1.3, tone: 3000,
    beds: [
      { color: 'pink', type: 'bandpass', f: 400, q: 0.5, g: 0.12, am: [0.03, 0.5] },
      { color: 'brown', type: 'lowpass', f: 60, g: 0.4 },
    ],
    tones: [
      { wave: 'sine', f: 110, g: 0.03, beat: 0.13 },
      { wave: 'sine', f: 164.8, g: 0.012, am: [0.021, 1] },
      { wave: 'sine', f: 1661, g: 0.003, am: [0.04, 0.9] },
    ],
    events: [{ id: 'ambVoid', every: [10, 22], dist: [20, 60] }],
  },
  /** Z10 Crownmark chamber: a mechanism the size of a cathedral aligning by hairs; a gold fifth in the air. */
  coreChamber: {
    db: -34, room: 1.2, tone: 8000,
    beds: [
      { color: 'pink', type: 'bandpass', f: 500, q: 0.5, g: 0.12 },
      { color: 'brown', type: 'lowpass', f: 100, g: 0.5 },
    ],
    tones: [
      { wave: 'sine', f: 146.83, g: 0.03, beat: 0.2 },
      { wave: 'sine', f: 220, g: 0.02, beat: 0.3 },
      { wave: 'sine', f: 880, g: 0.003, am: [0.07, 0.8] },
    ],
    events: [
      { id: 'ambAlignClick', every: [0.8, 3], dist: [3, 14] },
      { id: 'ambGoldPing', every: [5, 12], dist: [8, 24] },
      { id: 'meridianAlign', every: [14, 30], dist: [12, 24], vol: [0.3, 0.5] },
    ],
  },
  /** Z11 observation gallery: room tone, ventilation, and a star too far away to be anything but a rumble. */
  observation: {
    db: -35, room: 0.35, tone: 3500,
    beds: [
      { color: 'pink', type: 'lowpass', f: 500, g: 0.25 },
      { color: 'pink', type: 'bandpass', f: 2200, q: 0.6, g: 0.03 },
      { color: 'brown', type: 'lowpass', f: 55, g: 0.9, am: [0.025, 0.5] },
    ],
    tones: [{ wave: 'sine', f: 60, g: 0.03 }, { wave: 'sine', f: 41, g: 0.12, am: [0.03, 0.6] }],
    events: [
      { id: 'ambConsoleTick', every: [4, 11], dist: [2, 5] },
      { id: 'ambStellar', every: [12, 28], dist: [80, 200] },
      { id: 'chairSettle', every: [18, 40], dist: [2, 4], vol: [0.4, 0.7] },
    ],
  },
  /** Z12 outer-ring hangar: two factions' engines idling at opposite berths. */
  hangar: {
    db: -30, room: 1.1, tone: 5500,
    beds: [
      { color: 'brown', type: 'lowpass', f: 140, g: 0.9 },
      { color: 'pink', type: 'bandpass', f: 350, q: 0.6, g: 0.4, fm: [0.06, 100] },
      { color: 'pink', type: 'highpass', f: 4000, g: 0.04, am: [0.2, 0.4] },
    ],
    tones: [
      { wave: 'sawtooth', f: 55, g: 0.08, lp: 220, am: [6, 0.15] },
      { wave: 'triangle', f: 220, g: 0.02, beat: 1.1 },
      { wave: 'sine', f: 1320, g: 0.004, am: [0.11, 0.5] },
    ],
    events: [
      { id: 'ambCommBlip', every: [4, 9], dist: [8, 20] },
      { id: 'ambMetalTick', every: [3, 8], dist: [5, 14] },
      { id: 'ambServoFar', every: [5, 12], dist: [10, 24] },
      { id: 'ventHiss', every: [6, 14], dist: [6, 16] },
      { id: 'ambPA', every: [10, 22], dist: [18, 40] },
    ],
  },
};

export const AMBIENCE_IDS = ['none', ...Object.keys(AMBIENCE)] as readonly AmbienceId[];
