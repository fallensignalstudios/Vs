/**
 * A Deck plays one MusicDef: it owns the layer runtimes, a step clock scheduled ahead of the context time,
 * and a pair of faders (dry + reverb send) for cross-fading against another deck on a bar line.
 */
import { clamp, mulberry32 } from '@/core/mathx';
import type { Shared } from '../synth/shared';
import type { Mixer } from '../mixer';
import { chordAt, layerGain } from './theory';
import type { MusicDef } from './types';
import { makeLayer, type DeckEnv, type LayerRt } from './layers';

/**
 * A linear fader that knows its own trajectory, so a new fade can start from wherever the last one is —
 * without `cancelAndHoldAtTime` (not universal) and without a jump.
 */
export class Fader {
  private t0 = 0;
  private v0: number;
  private t1 = 0;
  private v1: number;

  constructor(private readonly p: AudioParam, value: number) {
    p.value = value;
    this.v0 = this.v1 = value;
  }

  valueAt(t: number): number {
    if (t <= this.t0) return this.v0;
    if (t >= this.t1) return this.v1;
    return this.v0 + ((this.v1 - this.v0) * (t - this.t0)) / (this.t1 - this.t0);
  }

  /** From `startAt`, move to `target` over `seconds`. */
  fade(now: number, startAt: number, seconds: number, target: number): void {
    const s = Math.max(startAt, now);
    const vNow = this.valueAt(now);
    const vStart = this.valueAt(s);
    const end = s + Math.max(0.01, seconds);
    this.p.cancelScheduledValues(now);
    this.p.setValueAtTime(vNow, now);
    if (s > now) this.p.linearRampToValueAtTime(vStart, s);
    this.p.linearRampToValueAtTime(target, end);
    this.t0 = s;
    this.v0 = vStart;
    this.t1 = end;
    this.v1 = target;
  }
}

export interface DeckShared {
  /** smoothed intensity 0..1 */
  intensity: number;
  /** Eclipse cadence irregularity 0..1 */
  irregular: number;
  /** King identity resolved (meridianComplete) */
  resolved: boolean;
  /** context time of the last gameplay-supplied cadence beat */
  externalCadenceAt: number;
}

export class Deck {
  /** when this deck stops scheduling new notes (set by fadeOut: the bar line it is leaving on) */
  endAt = Infinity;
  /** when its tails have faded and it can leave the graph */
  disposeAt = Infinity;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly fDry: Fader;
  private readonly fWet: Fader;
  private readonly layers: LayerRt[];
  private readonly env: DeckEnv;
  private readonly stepsPerBar: number;
  private readonly lastGain: number[];
  private readonly stamps: number[];
  private nextT: number;
  private stepIdx = 0;
  private lastBarT: number;
  private needChord = false;
  private wasResolved: boolean;
  private disposed = false;

  constructor(
    private readonly ac: BaseAudioContext,
    res: Shared,
    mixer: Mixer,
    readonly def: MusicDef,
    /** output gain reaching the def's target loudness */
    private readonly gain: number,
    readonly startAt: number,
    seed: number,
    private readonly shared: DeckShared,
  ) {
    this.dry = ac.createGain();
    this.wet = ac.createGain();
    this.dry.connect(mixer.music);
    this.wet.connect(mixer.reverbIn);
    this.fDry = new Fader(this.dry.gain, 0);
    this.fWet = new Fader(this.wet.gain, 0);
    const stepDur = 60 / def.bpm / 4;
    this.stepsPerBar = def.beats * 4;
    this.env = {
      ac, res, rnd: mulberry32(seed), tonic: def.tonic, stepDur, barDur: stepDur * this.stepsPerBar,
      intensity: this.intensityNow(), irregular: shared.irregular, externalCadenceAt: shared.externalCadenceAt,
    };
    this.layers = def.layers.map((l) => makeLayer(l, this.env, this.dry, this.wet, startAt));
    this.lastGain = this.layers.map(() => -1);
    this.stamps = this.layers.map(() => -1);
    this.nextT = startAt;
    this.lastBarT = startAt;
    this.wasResolved = shared.resolved;
    this.applyLevels(Math.min(ac.currentTime, startAt), true);
  }

  private intensityNow(): number {
    return this.def.fixedIntensity ?? this.shared.intensity;
  }

  get barDur(): number {
    return this.env.barDur;
  }

  /** The next bar line at or after `now`. */
  nextBar(now: number): number {
    if (now <= this.startAt) return this.startAt;
    let t = this.lastBarT;
    while (t < now) t += this.env.barDur;
    return t;
  }

  /** The next beat at or after `now`. */
  nextBeat(now: number): number {
    if (now <= this.startAt) return this.startAt;
    const beat = this.env.stepDur * 4;
    let t = this.lastBarT;
    while (t < now) t += beat;
    return t;
  }

  fadeIn(now: number, at: number, seconds: number): void {
    this.fDry.fade(now, at, seconds, this.gain);
    this.fWet.fade(now, at, seconds, this.gain);
  }

  /**
   * Leave on the boundary `at`: rhythm stops there (two tempi never overlap), while whatever is already
   * sounding — pads, bells, drum tails — fades over `seconds` underneath the incoming state.
   */
  fadeOut(now: number, at: number, seconds: number): void {
    this.fDry.fade(now, at, seconds, 0);
    this.fWet.fade(now, at, seconds, 0);
    this.endAt = Math.max(now, at);
    this.disposeAt = this.endAt + seconds + 0.3;
  }

  /** Follow intensity / resolution with the per-layer levels. */
  applyLevels(now: number, immediate = false): void {
    const I = this.intensityNow();
    this.env.intensity = I;
    this.env.irregular = this.shared.irregular;
    this.env.externalCadenceAt = this.shared.externalCadenceAt;
    const resolved = this.shared.resolved;
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      const off = l.def.when !== undefined && (l.def.when === 'resolved') !== resolved;
      const target = off ? 0 : layerGain(l.def.g, l.def.th, I);
      if (Math.abs(target - this.lastGain[i]) < 0.004) continue;
      this.lastGain[i] = target;
      if (immediate) l.level.gain.value = target;
      else l.level.gain.setTargetAtTime(target, now, 0.45);
    }
  }

  /** Schedule every step that starts before `horizon`. */
  schedule(now: number, horizon: number): void {
    if (this.disposed) return;
    if (this.nextT < now - 0.03) {
      // the scheduler was starved (hidden tab, long frame): pick the music up in time instead of bursting
      this.nextT = now + 0.03;
      this.needChord = true;
    }
    const resolved = this.shared.resolved;
    if (resolved !== this.wasResolved) {
      this.wasResolved = resolved;
      this.needChord = true;
    }
    const chords = resolved && this.def.resolved ? this.def.resolved : this.def.chords;
    const spb = this.stepsPerBar;
    const end = Math.min(horizon, this.endAt);
    while (this.nextT < end) {
      const t = this.nextT;
      const s = this.stepIdx % spb;
      const bar = (this.stepIdx - s) / spb;
      const at = chordAt(chords, bar);
      if (s === 0) {
        this.lastBarT = t;
        if (this.needChord) this.stamps.fill(-1);
        this.needChord = false;
        // the bar this chord began on identifies it; a layer returning from a masked bar catches up
        const stamp = bar - (at.chord.bars - at.barsLeft);
        for (let i = 0; i < this.layers.length; i++) {
          const l = this.layers[i];
          if (this.muted(l, bar)) continue;
          if (this.stamps[i] !== stamp) {
            this.stamps[i] = stamp;
            l.chord?.(at.chord, t, at.barsLeft * this.env.barDur);
          }
          l.bar?.(bar, t, at.chord);
        }
      }
      for (const l of this.layers) {
        if (l.step && !this.muted(l, bar)) l.step(s, t, at.chord);
      }
      this.stepIdx++;
      this.nextT += this.env.stepDur;
    }
  }

  private muted(l: LayerRt, bar: number): boolean {
    const d = l.def;
    if (d.when !== undefined && (d.when === 'resolved') !== this.shared.resolved) return true;
    if (!d.mask) return false;
    return d.mask[bar % d.mask.length] !== 'x';
  }

  /** Sound the cadence layer now (a beat supplied by gameplay). Returns false if this deck has none. */
  pulseCadence(t: number, irregular: boolean): boolean {
    let any = false;
    for (const l of this.layers) {
      if (!l.pulse) continue;
      this.env.externalCadenceAt = t;
      l.pulse(t, irregular);
      any = true;
    }
    return any;
  }

  /** Stop everything and leave the graph. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ac.currentTime;
    for (const l of this.layers) l.dispose(now + 0.02);
    this.dry.disconnect();
    this.wet.disconnect();
  }
}

/** Seconds from `now` to the musical boundary a state change should land on. */
export function boundaryFor(deck: Deck | null, now: number, fadeSeconds: number): number {
  if (!deck) return now + 0.03;
  const quick = fadeSeconds < 0.35;
  const b = quick ? deck.nextBeat(now + 0.02) : deck.nextBar(now + 0.02);
  // never make the player wait long for a response: fall back to the beat, then to "now"
  if (b - now <= (quick ? 0.6 : 2.4)) return b;
  const beat = deck.nextBeat(now + 0.02);
  return clamp(beat, now + 0.03, now + 1.0);
}
