/**
 * A Deck plays one MusicDef: it owns the layer runtimes, a step clock scheduled ahead of the context time,
 * and one fader over its four outputs (tonal, drums, hall send, drum-room send) for leaving on a bar line.
 *
 * A deck is born at full level on its first downbeat — sustained layers bring their own attacks, and a drum
 * that enters on the bar must be heard on the bar. Only the *outgoing* deck fades.
 */
import { clamp, mulberry32 } from '@/core/mathx';
import type { Shared } from '../synth/shared';
import type { SampleBank } from '../synth/samples';
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

/** a layer that throws this many times is switched off (and reported once) rather than retried forever */
const LAYER_STRIKES = 3;
/** indices in `outs` of the struck buses (drums, drum room): cut on the boundary instead of faded */
const STRUCK_OUTS = [1, 3];
/** the scheduler always runs at least this far ahead: two beats, and never less than a second */
const MIN_HORIZON = 1.0;

export class Deck {
  /** when this deck stops scheduling new notes (set by fadeOut: the bar line it is leaving on) */
  endAt = Infinity;
  /** when its tails have faded and it can leave the graph */
  disposeAt = Infinity;
  private readonly outs: GainNode[];
  private readonly faders: Fader[];
  private readonly layers: LayerRt[];
  private readonly env: DeckEnv;
  private readonly stepsPerBar: number;
  private readonly lastGain: number[];
  private readonly stamps: number[];
  private readonly strikes: number[];
  private readonly lfos = new Map<number, OscillatorNode>();
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
    samples: SampleBank,
    readonly def: MusicDef,
    /** output gain reaching the def's target loudness */
    gain: number,
    readonly startAt: number,
    seed: number,
    private readonly shared: DeckShared,
    /** state name, for diagnostics */
    private readonly name = '',
  ) {
    const out = (to: AudioNode): GainNode => {
      const g = ac.createGain();
      g.connect(to);
      return g;
    };
    const tonal = out(mixer.music);
    const drums = out(mixer.musicDrums);
    const wet = out(mixer.scoreSend);
    const room = out(mixer.scoreRoom);
    this.outs = [tonal, drums, wet, room];
    this.faders = this.outs.map((g) => new Fader(g.gain, gain));
    const stepDur = 60 / def.bpm / 4;
    this.stepsPerBar = def.beats * 4;
    this.env = {
      ac, res, samples, rnd: mulberry32(seed), tonic: def.tonic, stepDur, barDur: stepDur * this.stepsPerBar,
      intensity: this.intensityNow(), irregular: shared.irregular, externalCadenceAt: shared.externalCadenceAt,
      lfo: (rate, depth, target) => {
        let o = this.lfos.get(rate);
        if (!o) {
          o = ac.createOscillator();
          o.frequency.value = rate;
          o.start(Math.max(startAt, ac.currentTime));
          this.lfos.set(rate, o);
        }
        const d = ac.createGain();
        d.gain.value = depth;
        o.connect(d);
        d.connect(target);
      },
    };
    this.layers = def.layers.map((l) => makeLayer(l, this.env, { tonal, drums, wet, room }, startAt));
    this.lastGain = this.layers.map(() => -1);
    this.stamps = this.layers.map(() => -1);
    this.strikes = this.layers.map(() => 0);
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

  /** one beat (s) */
  get beatDur(): number {
    return this.env.stepDur * 4;
  }

  /** how far this deck has already scheduled: nothing before this time can be un-played */
  get frontier(): number {
    return this.nextT;
  }

  /** The next bar line at or after `now` (the scheduler may already be past it: bar lines are a fixed grid). */
  nextBar(now: number): number {
    return this.nextOnGrid(now, this.env.barDur);
  }

  /** The next beat at or after `now`. */
  nextBeat(now: number): number {
    return this.nextOnGrid(now, this.beatDur);
  }

  private nextOnGrid(now: number, period: number): number {
    if (now <= this.startAt) return this.startAt;
    // lastBarT is a bar line (and so a beat); walk the grid from it in either direction
    const n = Math.ceil((now - this.lastBarT) / period - 1e-9);
    return this.lastBarT + n * period;
  }

  /**
   * Leave on the boundary `at`. Everything struck is cut there within a few milliseconds — including strokes
   * this deck had already scheduled beyond the boundary, so two tempi never overlap however far ahead the
   * scheduler runs — while the sustained layers and the hall fade over `seconds` under the incoming state.
   */
  fadeOut(now: number, at: number, seconds: number): void {
    this.faders.forEach((f, i) => f.fade(now, at, STRUCK_OUTS.includes(i) ? Math.min(seconds, 0.06) : seconds, 0));
    this.endAt = Math.max(now, at);
    this.disposeAt = this.endAt + seconds + 0.3;
  }

  /** Follow intensity / resolution with the per-layer levels. */
  applyLevels(now: number, immediate = false): void {
    const I = this.intensityNow();
    this.env.intensity = Number.isFinite(I) ? I : 0;
    this.env.irregular = Number.isFinite(this.shared.irregular) ? this.shared.irregular : 0;
    this.env.externalCadenceAt = this.shared.externalCadenceAt;
    const resolved = this.shared.resolved;
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      const off = l.def.when !== undefined && (l.def.when === 'resolved') !== resolved;
      const target = off ? 0 : layerGain(l.def.g, l.def.th, this.env.intensity);
      if (Math.abs(target - this.lastGain[i]) < 0.004) continue;
      this.lastGain[i] = target;
      if (immediate) l.level.gain.value = target;
      else l.level.gain.setTargetAtTime(target, now, 0.45);
    }
  }

  /** Run one layer callback; a layer that keeps throwing is retired instead of taking the deck with it. */
  private call(i: number, fn: () => void): void {
    if (this.strikes[i] >= LAYER_STRIKES) return;
    try {
      fn();
    } catch (err) {
      if (++this.strikes[i] === LAYER_STRIKES) {
        console.warn(`[audio] music layer "${this.layers[i].def.kind}" of ${this.name || 'a state'} disabled after repeated failures:`, err);
      }
    }
  }

  /**
   * Schedule every step that starts within the horizon: `lookahead` seconds, and never less than two beats
   * or one second — a zone build or a shader compile that stalls the main thread for most of a second
   * leaves no hole in the rhythm.
   */
  schedule(now: number, lookahead: number): void {
    if (this.disposed) return;
    const step = this.env.stepDur;
    if (this.nextT < now - 0.03) {
      // the scheduler was starved (hidden tab, a very long frame): skip whole steps, so the music picks up
      // IN TIME — the grid keeps its phase — instead of bursting or drifting
      const skip = Math.ceil((now + 0.02 - this.nextT) / step);
      this.stepIdx += skip;
      this.nextT += skip * step;
      this.lastBarT = this.nextT - (this.stepIdx % this.stepsPerBar) * step;
      this.needChord = true;
    }
    const resolved = this.shared.resolved;
    if (resolved !== this.wasResolved) {
      this.wasResolved = resolved;
      this.needChord = true;
    }
    const chords = resolved && this.def.resolved ? this.def.resolved : this.def.chords;
    const spb = this.stepsPerBar;
    const end = Math.min(now + Math.max(lookahead, this.beatDur * 2, MIN_HORIZON), this.endAt);
    while (this.nextT < end) {
      const t = this.nextT;
      const idx = this.stepIdx;
      // advance FIRST: whatever a layer does with this step, the clock has already left it behind
      this.stepIdx = idx + 1;
      this.nextT = t + step;
      const s = idx % spb;
      const bar = (idx - s) / spb;
      const at = chordAt(chords, bar);
      if (s === 0) this.lastBarT = t;
      if (s === 0 || this.needChord) {
        // harmony changed under us (resolution, recovery from a stall): re-voice now, not at the next bar
        if (this.needChord) this.stamps.fill(-1);
        this.needChord = false;
        // the bar this chord began on identifies it; a layer returning from a masked bar catches up
        const stamp = bar - (at.chord.bars - at.barsLeft);
        const remaining = at.barsLeft * this.env.barDur - s * step;
        for (let i = 0; i < this.layers.length; i++) {
          const l = this.layers[i];
          if (this.muted(l, bar)) continue;
          if (this.stamps[i] !== stamp) {
            this.stamps[i] = stamp;
            if (l.chord) this.call(i, () => l.chord!(at.chord, t, remaining));
          }
          if (s === 0 && l.bar) this.call(i, () => l.bar!(bar, t, at.chord));
        }
      }
      for (let i = 0; i < this.layers.length; i++) {
        const l = this.layers[i];
        if (l.step && !this.muted(l, bar)) this.call(i, () => l.step!(s, t, at.chord));
      }
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
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      if (!l.pulse) continue;
      this.env.externalCadenceAt = t;
      this.call(i, () => l.pulse!(t, irregular));
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
    for (const o of this.lfos.values()) {
      try {
        o.stop(now + 0.02);
      } catch {
        /* already stopped */
      }
    }
    this.lfos.clear();
    for (const g of this.outs) g.disconnect();
  }
}

/**
 * The musical boundary a state change should land on: the next bar line (next beat for very short fades),
 * never making the player wait long for a response.
 */
export function boundaryFor(deck: Deck | null, now: number, fadeSeconds: number): number {
  if (!deck) return now + 0.03;
  const quick = fadeSeconds < 0.35;
  const b = quick ? deck.nextBeat(now + 0.02) : deck.nextBar(now + 0.02);
  if (b - now <= (quick ? 0.6 : 2.6)) return b;
  const beat = deck.nextBeat(now + 0.02);
  return clamp(beat, now + 0.03, now + 1.0);
}
