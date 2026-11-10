/**
 * Layer runtimes. A deck asks each layer to react to chord changes, bar starts and 16th-note steps; the layer
 * schedules notes at the given absolute context time. Each layer ends in its own level gain, which the deck
 * drives from the smoothed intensity so combat layers cross-fade in and out.
 *
 * Routing: sustained/tonal layers go to the deck's `tonal` bus (tilt EQ + gentle levelling in the mixer);
 * everything struck — percussion, ostinati, stabs, the cadence — goes to `drums`, which nothing compresses
 * (the mixer only brightens it and rounds off coincident strokes).
 */
import { lerp } from '@/core/mathx';
import { Kit, setQ } from '../synth/kit';
import type { Shared } from '../synth/shared';
import type { SampleBank } from '../synth/samples';
import { mtof, openVoicing, parsePattern, tierFor, voicing, type Chord } from './theory';
import type { Layer } from './types';
import { brassNote, cadenceHit, motifNote, padNote, pulseNote, strike, stringNote } from './instruments';

/** Live state shared by every layer of a deck. Mutated by the deck/engine, read at scheduling time. */
export interface DeckEnv {
  readonly ac: BaseAudioContext;
  readonly res: Shared;
  readonly samples: SampleBank;
  readonly rnd: () => number;
  readonly tonic: number;
  readonly stepDur: number;
  readonly barDur: number;
  /** smoothed 0..1 */
  intensity: number;
  /** Eclipse cadence: 0 = stamped out, 1 = fully irregular */
  irregular: number;
  /** context time of the last cadence beat supplied by gameplay (AudioSystem.cadenceTick); −∞ if never */
  externalCadenceAt: number;
  /**
   * Slow modulation shared by the whole deck: one oscillator per rate, however many layers drift at it
   * (each use has its own depth). Lives and dies with the deck.
   */
  lfo(rate: number, depth: number, target: AudioParam): void;
}

/** The four places a layer can send to (all faded together by the deck). */
export interface DeckOut {
  tonal: AudioNode;
  drums: AudioNode;
  /** score hall */
  wet: AudioNode;
  /** short drum room */
  room: AudioNode;
}

export interface LayerRt {
  readonly def: Layer;
  readonly level: GainNode;
  chord?(c: Chord, t: number, dur: number): void;
  bar?(bar: number, t: number, c: Chord): void;
  step?(step: number, t: number, c: Chord): void;
  /** cadence layers only: sound one beat now (driven by the enemies' own cadence clock) */
  pulse?(t: number, irregular: boolean): void;
  dispose(at: number): void;
}

/** how long after the last gameplay-supplied beat the score waits before ticking by itself again (s) */
const EXTERNAL_CADENCE_HOLD = 3.2;

/** Fold a MIDI pitch into the bass-drone register (41–82 Hz: low, but present on small speakers too). */
export function subHz(m: number): number {
  let f = mtof(m);
  while (f >= 82) f /= 2;
  while (f < 41) f *= 2;
  return f;
}

/** Lowest chord root at or above `low`, and a consonant partner above it (the fifth when the chord has one). */
export function rootAndPartner(tonic: number, c: Chord, low: number): [number, number] {
  let r = tonic + c.root;
  while (r < low) r += 12;
  while (r - 12 >= low) r -= 12;
  const partner = c.iv.includes(7) ? r + 7 : r + (c.iv[1] ?? 7);
  return [mtof(r), mtof(partner)];
}

/**
 * Whether a layer is struck (→ drum bus: uncompressed, driven into a soft clipper) or sustained (→ tonal bus).
 * A bass ostinato is pitched low-frequency sustain, not a stroke: saturating it would only add mud.
 */
export const isStruck = (def: Layer): boolean =>
  def.kind === 'perc' || (def.kind === 'pulse' && def.voice !== 'bass') || def.kind === 'cadence' || (def.kind === 'brass' && !!def.pattern);

/**
 * A chord's worth of sustained notes shares one gain, so that when the harmony is re-voiced early (the
 * Meridian resolving mid-chord, recovery after a stall) the old voicing can be faded instead of clashing.
 */
class Generations {
  private prev: { g: GainNode; end: number } | null = null;

  constructor(private readonly ac: BaseAudioContext, private readonly to: AudioNode) {}

  next(t: number, dur: number): GainNode {
    const p = this.prev;
    if (p && t < p.end - 0.25) {
      p.g.gain.setValueAtTime(1, t);
      p.g.gain.linearRampToValueAtTime(0, t + 0.5);
    }
    const g = this.ac.createGain();
    g.connect(this.to);
    this.prev = { g, end: t + dur };
    return g;
  }
}

export function makeLayer(def: Layer, env: DeckEnv, out: DeckOut, start: number): LayerRt {
  const { ac, res, rnd } = env;
  const level = ac.createGain();
  level.gain.value = 0;
  level.connect(isStruck(def) ? out.drums : out.tonal);
  const send = (amount: number | undefined, to: AudioNode): void => {
    if (!amount) return;
    const w = ac.createGain();
    w.gain.value = amount;
    level.connect(w);
    w.connect(to);
  };
  send(def.wet, out.wet);
  send(def.room, out.room);
  const kit = (to: AudioNode, sustain = false): Kit => new Kit(ac, res, to, 0, 1, rnd, sustain);
  const none = (): void => {};

  switch (def.kind) {
    case 'sub': {
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      setQ(lp, 0.707);
      lp.connect(level);
      const k = kit(lp, true);
      const swell = k.gain(0.85, lp);
      env.lfo(0.083, 0.15, swell.gain);
      const f0 = subHz(env.tonic);
      // levels are deliberately modest: a drone that dominates the meter leaves no room for the score
      const o1 = k.osc('sine', f0, { a: 1.6, h: Infinity, d: 1, g: 0.2 }, { at: start, to: swell });
      const o2 = k.osc('triangle', f0 * 2, { a: 2.2, h: Infinity, d: 1, g: 0.12 }, { at: start, to: swell });
      return {
        def, level,
        chord: def.follow
          ? (c, t) => {
              const f = subHz(env.tonic + c.root);
              o1.frequency.setTargetAtTime(f, t, 0.3);
              o2.frequency.setTargetAtTime(f * 2, t, 0.3);
            }
          : undefined,
        dispose: (at) => k.stopAll(at),
      };
    }

    case 'pad': {
      const bright = def.bright ?? (def.voice === 'glass' ? [2400, 5000] : def.voice === 'felt' ? [1800, 2600] : [1300, 2800]);
      const filt = ac.createBiquadFilter();
      filt.type = 'lowpass';
      setQ(filt, 0.707);
      filt.frequency.value = lerp(bright[0], bright[1], env.intensity);
      filt.connect(level);
      const ks = kit(filt, true);
      if (def.voice !== 'air') env.lfo(0.083, bright[0] * 0.22, filt.frequency);
      // the choir sings through a slowly shifting vowel
      const input: AudioNode = def.voice === 'choir' ? ks.bank([560, 1020, 2350], 3.2, { to: filt, gains: [1, 0.55, 0.22], g: 2.2 }) : filt;
      const k = kit(input);
      const gens = new Generations(ac, input);
      return {
        def, level,
        chord: (c, t, dur) => {
          const notes = voicing(env.tonic, c, def.low, def.n);
          const vel = 1 / Math.sqrt(notes.length);
          const g = gens.next(t, dur);
          notes.forEach((m, i) => padNote(def.voice, k, t, mtof(m), dur, vel, (i % 2 ? 1 : -1) * Math.min(0.7, 0.3 + 0.12 * i), g));
          filt.frequency.setTargetAtTime(lerp(bright[0], bright[1], env.intensity), t, 0.8);
        },
        dispose: (at) => ks.stopAll(at),
      };
    }

    case 'strings': {
      const bright = def.bright ?? [1100, 2800];
      const filt = ac.createBiquadFilter();
      filt.type = 'lowpass';
      setQ(filt, 1.2);
      filt.frequency.value = lerp(bright[0], bright[1], env.intensity);
      // legato path and marcato (gated) path, cross-faded per bar by intensity tier
      const sustain = ac.createGain();
      const gate = ac.createGain();
      gate.gain.value = 0.05;
      const depth = ac.createGain();
      depth.gain.value = 0;
      filt.connect(sustain);
      sustain.connect(level);
      filt.connect(gate);
      gate.connect(depth);
      depth.connect(level);
      const ks = kit(filt, true);
      env.lfo(0.11, bright[0] * 0.25, filt.frequency);
      const k = kit(filt);
      // the bow's bite lands after the filter (it is noise from the string's surface, not its pitch)
      const bite = kit(level);
      const gens = new Generations(ac, filt);
      const gates = (def.gate ?? []).map(parsePattern);
      let pat: number[] | null = null;
      return {
        def, level,
        chord: (c, t, dur) => {
          const notes = openVoicing(env.tonic, c, def.low, def.n);
          const vel = 1 / Math.sqrt(notes.length);
          const g = gens.next(t, dur);
          notes.forEach((m) => stringNote(k, t, mtof(m), dur, vel, g));
        },
        bar: (_bar, t) => {
          const legato = def.legato !== false;
          const tier = gates.length ? tierFor(gates.length + (legato ? 1 : 0), env.intensity) + (legato ? 0 : 1) : 0;
          pat = tier > 0 ? gates[tier - 1] : null;
          const d = pat ? 1 : 0;
          depth.gain.setTargetAtTime(d * 1.5, t, 0.08);
          sustain.gain.setTargetAtTime(1 - d * 0.65, t, 0.08);
          filt.frequency.setTargetAtTime(lerp(bright[0], bright[1], env.intensity), t, 0.5);
        },
        step: (step, t) => {
          if (!pat) return;
          const v = pat[step % pat.length];
          if (v <= 0) return;
          gate.gain.setTargetAtTime(v, t, 0.005);
          gate.gain.setTargetAtTime(0.04, t + 0.035, env.stepDur * 0.6);
          strike(env.samples, rnd, 'bow', bite, t, v * 0.04);
        },
        dispose: (at) => ks.stopAll(at),
      };
    }

    case 'brass': {
      const k = kit(level);
      const pat = def.pattern ? parsePattern(def.pattern) : null;
      const offset = def.at ?? 0;
      let active = false;
      return {
        def, level,
        bar: (bar, t, c) => {
          active = bar % def.every === offset % def.every && rnd() < (def.prob ?? 1);
          if (!active || pat) return;
          const [f1, f2] = rootAndPartner(env.tonic, c, def.low);
          const dur = def.bars * env.barDur;
          const v = 0.7 + 0.3 * env.intensity;
          brassNote(k, t, f1, dur, v, false);
          brassNote(k, t + 0.04, f2, dur, v * 0.7, false);
          if (env.intensity > 0.55) brassNote(k, t + 0.08, f1 * 2, dur, v * 0.45, false);
        },
        step: pat
          ? (step, t, c) => {
              if (!active) return;
              const v = pat[step % pat.length];
              if (v <= 0) return;
              const [f1, f2] = rootAndPartner(env.tonic, c, def.low);
              brassNote(k, t, f1, 0, v, true);
              brassNote(k, t, f2, 0, v * 0.7, true);
            }
          : undefined,
        dispose: none,
      };
    }

    case 'pulse': {
      const k = kit(level);
      const tiers = def.tiers.map(parsePattern);
      let pat = tiers[0];
      let tones: number[] = [];
      let n = 0;
      return {
        def, level,
        chord: (c) => {
          tones = voicing(env.tonic, c, def.low, 8);
        },
        bar: () => {
          pat = tiers[tierFor(tiers.length, env.intensity)];
        },
        step: (step, t) => {
          const v = pat.length ? pat[step % pat.length] : 0;
          if (v <= 0 || !tones.length) return;
          const idx = def.notes[n % def.notes.length];
          const m = tones[((idx % tones.length) + tones.length) % tones.length];
          pulseNote(def.voice, k, t, mtof(m), v, env.stepDur, n % 2 ? 0.38 : -0.38);
          n++;
        },
        dispose: none,
      };
    }

    case 'perc': {
      const k = kit(level);
      const tiers = def.tiers.map(parsePattern);
      let pat = tiers[0];
      const human = def.human ?? 0;
      return {
        def, level,
        bar: () => {
          pat = tiers[tierFor(tiers.length, env.intensity)];
        },
        step: (step, t) => {
          const v = pat.length ? pat[step % pat.length] : 0;
          if (v <= 0) return;
          if (human > 0) strike(env.samples, rnd, def.inst, k, t + rnd() * human, v * (0.88 + rnd() * 0.2), def.tune);
          else strike(env.samples, rnd, def.inst, k, t, v, def.tune);
        },
        dispose: none,
      };
    }

    case 'motif': {
      const k = kit(level);
      const offset = def.at ?? 0;
      let turn = 0;
      return {
        def, level,
        bar: (bar, t) => {
          if (bar % def.every !== offset % def.every) return;
          if (rnd() >= (def.prob ?? 1)) return;
          // phrases come round in order: the first is the identity, the rest are its answers
          const phrase = def.phrases[turn++ % def.phrases.length];
          phrase.forEach((note, i) => {
            motifNote(def.voice, k, t + note[0] * env.stepDur, mtof(def.base + note[1]), note[3] ?? 0.8, note[2] * env.stepDur, i % 2 ? 0.22 : -0.22);
          });
        },
        dispose: none,
      };
    }

    case 'held': {
      const k = kit(level, true);
      def.notes.forEach((m, i) => {
        const f = mtof(m);
        const e = { a: 3.5, h: Infinity, d: 2, g: 0.5 };
        k.osc('sine', f, e, { at: start, pan: i % 2 ? 0.2 : -0.2 });
        // a partner a fraction of a hertz away: the tone breathes without ever moving
        k.osc('sine', f * 1.0006, { ...e, g: 0.3 }, { at: start, pan: i % 2 ? -0.2 : 0.2 });
        k.osc('sine', f * 2, { ...e, g: 0.03 }, { at: start });
      });
      return { def, level, dispose: (at) => k.stopAll(at) };
    }

    default: {
      const k = kit(level);
      const pat = parsePattern(def.pattern);
      return {
        def, level,
        // while gameplay is supplying the beat, the score's own grid stays out of its way: one clock only
        pulse: (t, irregular) => {
          if (irregular) cadenceHit(k, t, 0.75, 1);
          else strike(env.samples, rnd, 'cadence', k, t, 1);
        },
        step: (step, t) => {
          const v = pat[step % pat.length];
          if (v <= 0 || t - env.externalCadenceAt < EXTERNAL_CADENCE_HOLD) return;
          const irr = Number.isFinite(env.irregular) ? env.irregular : 0;
          if (irr <= 0.001) {
            strike(env.samples, rnd, 'cadence', k, t, v);
            return;
          }
          // severed: beats drop out, arrive late, and no two are alike
          if (rnd() < 0.24 * irr) return;
          cadenceHit(k, t + rnd() * env.stepDur * 2.4 * irr, v * (0.5 + rnd() * 0.55), irr);
        },
        dispose: none,
      };
    }
  }
}
