/** Data model of the generative score: a MusicDef per MusicState, built from typed layers. */
import type { Chord } from './theory';

/** Which of the four recurring identities a state belongs to (flavours stingers, selects cadence logic). */
export type Family = 'dominion' | 'reformation' | 'eclipse' | 'king' | 'neutral';

/** A layer gain: constant, or `[at intensity 0, at intensity 1]`. */
export type LayerLevel = number | readonly [number, number];

interface LayerBase {
  g: LayerLevel;
  /** intensity window the gain crosses over (`g` as a pair): smoothstep(th[0], th[1], intensity) */
  th?: readonly [number, number];
  /** bar mask over the chord cycle (`x` = play, `.` = rest), repeated — call-and-response between layers */
  mask?: string;
  /** extra reverb send for this layer (0..1) */
  wet?: number;
  /** only while the Meridian is unresolved / resolved */
  when?: 'unresolved' | 'resolved';
}

export type PadVoice = 'warm' | 'glass' | 'choir' | 'air' | 'wrong' | 'felt';
export type PulseVoice = 'pluck' | 'tick' | 'glass' | 'bass' | 'clock';
export type MotifVoice = 'bell' | 'glass' | 'horn' | 'felt';
export type PercInst = 'taiko' | 'odaiko' | 'metal' | 'anvil' | 'hat' | 'rim' | 'kick' | 'boom' | 'clack';

/** `[step, semitones above base, length in steps, velocity]` */
export type MotifNote = readonly [number, number, number, number?];

export type Layer =
  /** continuous sub drone on the tonic (or the chord root when `follow`) */
  | (LayerBase & { kind: 'sub'; follow?: boolean })
  /** evolving pad re-voiced per chord */
  | (LayerBase & { kind: 'pad'; voice: PadVoice; low: number; n: number; bright?: readonly [number, number] })
  /** low string ensemble: detuned saws through a moving filter; `gate` tiers add marcato rhythm with intensity */
  | (LayerBase & { kind: 'strings'; low: number; n: number; gate?: readonly string[]; /** false = always gated (no legato tier at low intensity) */ legato?: boolean; bright?: readonly [number, number] })
  /** brass swell (or short stab) every N bars on root + fifth */
  | (LayerBase & { kind: 'brass'; every: number; at?: number; bars: number; low: number; stab?: boolean; prob?: number; pattern?: string })
  /** pitched ostinato: `notes` are chord-tone indices per step (cycled), `tiers` gate patterns by intensity */
  | (LayerBase & { kind: 'pulse'; voice: PulseVoice; tiers: readonly string[]; notes: readonly number[]; low: number })
  /** percussion: pattern tiers ordered sparse → dense, chosen by intensity; `human` = timing looseness (s) */
  | (LayerBase & { kind: 'perc'; inst: PercInst; tiers: readonly string[]; human?: number; tune?: number })
  /** melodic identity: one of `phrases` every N bars */
  | (LayerBase & { kind: 'motif'; voice: MotifVoice; phrases: readonly (readonly MotifNote[])[]; every: number; at?: number; prob?: number; base: number })
  /** static held tones (quarantine's single tone) */
  | (LayerBase & { kind: 'held'; notes: readonly number[] })
  /** the Eclipse cadence: stamped-out identical ticks that stumble once a link has been severed */
  | (LayerBase & { kind: 'cadence'; pattern: string });

export interface MusicDef {
  family: Family;
  bpm: number;
  /** beats per bar (steps per bar = beats × 4) */
  beats: number;
  /** tonic as a MIDI note in the bass register */
  tonic: number;
  chords: readonly Chord[];
  /** chord cycle once `meridianComplete` has resolved the King identity */
  resolved?: readonly Chord[];
  layers: readonly Layer[];
  /** target bed loudness, dBFS RMS at reference settings (default −20) */
  db?: number;
  /** combat layers ignore setIntensity and sit at this value (title, credits, story beds) */
  fixedIntensity?: number;
}
