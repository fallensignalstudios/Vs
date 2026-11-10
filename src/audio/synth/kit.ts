/**
 * Synth kit — a tiny declarative layer over the WebAudio graph used by every SFX recipe, the music instruments
 * and the ambience beds. A Kit is bound to a context (live or offline), a start time and an output node; every
 * helper schedules click-free enveloped sources relative to that start time.
 *
 * All sources created by a Kit are either scheduled to stop (one-shots) or tracked as "open" (loops, LFOs) and
 * stopped by `seal()` / `stopAll()`, so a finished voice leaves nothing running.
 */
import { clamp } from '@/core/mathx';
import type { CurveName, NoiseColor } from './buffers';
import type { Shared } from './shared';

/** [time offset (s), value] */
export type Pt = readonly [number, number];
/**
 * A parameter trajectory: a constant, `[from, to]` (exponential glide over the envelope length),
 * `[from, to, seconds]`, or an explicit list of `[time, value]` points (exponential segments).
 */
export type Sweep = number | readonly [number, number] | readonly [number, number, number] | readonly Pt[];

export interface Env {
  /** attack (s) */
  a?: number;
  /** hold at peak (s). `Infinity` = sustain until the voice is stopped (loops). */
  h?: number;
  /** decay to silence (s) */
  d: number;
  /** peak gain */
  g?: number;
  /** linear instead of exponential decay (pads, swells) */
  lin?: boolean;
}

export interface SrcOpts {
  /** start offset from the kit start (s) */
  at?: number;
  /** destination node (default: kit output) */
  to?: AudioNode;
  /** detune in cents */
  detune?: number;
  /** stereo position −1..1 */
  pan?: number;
  /** ignore the kit pitch multiplier (absolute frequencies) */
  fixed?: boolean;
  /** inline filters applied source → hp → bp → lp → envelope */
  hp?: Sweep;
  bp?: Sweep;
  lp?: Sweep;
  /** Q of the inline filters */
  q?: number;
}

const MIN = 1e-4;

/**
 * Set a biquad's resonance from a conventional (linear) Q. WebAudio takes Q in decibels for low-/high-pass
 * filters — a plain `Q = 0.707` there is a +0.7 dB resonance, not Butterworth, and inside a feedback loop
 * that difference is enough to make a comb run away. Everything in this subsystem speaks linear Q.
 */
export function setQ(f: BiquadFilterNode, q: number): void {
  f.Q.value = f.type === 'lowpass' || f.type === 'highpass' ? 20 * Math.log10(Math.max(q, 0.05)) : q;
}
/** preview length when a sustaining recipe is played as a one-shot */
const PREVIEW_HOLD = 1.1;

export class Kit {
  /** latest scheduled end, seconds after `t` */
  end = 0;
  /** sources with no scheduled stop (loops / LFOs) */
  readonly open: AudioScheduledSourceNode[] = [];
  /** parameters that follow LoopHandle.setPitch */
  readonly pitched: Array<{ p: AudioParam; base: number }> = [];
  private readonly panners = new WeakMap<AudioNode, Map<number, StereoPannerNode>>();

  constructor(
    readonly ac: BaseAudioContext,
    readonly res: Shared,
    readonly out: AudioNode,
    readonly t: number,
    readonly pitch: number,
    readonly rnd: () => number,
    /** true = `h: Infinity` envelopes really sustain (loop voices) */
    readonly sustain = false,
  ) {}

  /** A kit sharing this one's context/resources with a different output / start (music notes, sub-mixes). */
  fork(out: AudioNode, t = this.t, pitch = this.pitch): Kit {
    return new Kit(this.ac, this.res, out, t, pitch, this.rnd, this.sustain);
  }

  /** uniform random in [lo, hi) */
  rr(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rnd();
  }

  /** random sign-symmetric value in (−a, a) */
  jit(a: number): number {
    return (this.rnd() * 2 - 1) * a;
  }

  /** extend the voice life (resonator / echo tails) */
  hold(seconds: number): void {
    if (seconds > this.end) this.end = seconds;
  }

  // -------------------------------------------------------------------------------------------
  // parameter automation
  // -------------------------------------------------------------------------------------------

  /** Schedule a Sweep on a param starting at absolute time `t0`. `len` is the default glide length. */
  sweep(p: AudioParam, s: Sweep, t0: number, len: number, mul = 1): void {
    if (typeof s === 'number') {
      p.setValueAtTime(s * mul, t0);
      return;
    }
    const first = s[0];
    if (typeof first === 'number') {
      const b = s[1] as number;
      const tt = (s as readonly number[])[2] ?? len;
      p.setValueAtTime(Math.max(first * mul, MIN), t0);
      p.exponentialRampToValueAtTime(Math.max(b * mul, MIN), t0 + Math.max(tt, 0.002));
      return;
    }
    const pts = s as readonly Pt[];
    p.setValueAtTime(Math.max(pts[0][1] * mul, MIN), t0 + pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      p.exponentialRampToValueAtTime(Math.max(pts[i][1] * mul, MIN), t0 + Math.max(pts[i][0], pts[i - 1][0] + 0.002));
    }
  }

  private envLen(e: Env): number {
    const h = e.h === Infinity ? (this.sustain ? Infinity : PREVIEW_HOLD) : (e.h ?? 0);
    return Math.max(e.a ?? 0.002, 0.001) + h + Math.max(e.d, 0.005);
  }

  /** Apply an attack/hold/decay envelope. Returns the absolute stop time (Infinity when sustaining). */
  private applyEnv(g: AudioParam, t0: number, e: Env): number {
    const a = Math.max(e.a ?? 0.002, 0.001);
    const d = Math.max(e.d, 0.005);
    const peak = e.g ?? 1;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + a);
    if (e.h === Infinity && this.sustain) return Infinity;
    const h = e.h === Infinity ? PREVIEW_HOLD : (e.h ?? 0);
    if (e.lin) {
      g.setValueAtTime(peak, t0 + a + h);
      g.linearRampToValueAtTime(0, t0 + a + h + d);
    } else {
      // exponential decay reaching −60 dB at t0+a+h+d, where the source is stopped (inaudible step)
      g.setTargetAtTime(0, t0 + a + h, d / 6.9);
    }
    return t0 + a + h + d;
  }

  private finish(src: AudioScheduledSourceNode, stop: number): void {
    if (stop === Infinity) {
      this.open.push(src);
    } else {
      src.stop(stop + 0.02);
      const rel = stop - this.t;
      if (rel > this.end) this.end = rel;
    }
  }

  /** Stereo placement. Panners are stateless, so sources sharing a position and destination share one. */
  private dest(o?: SrcOpts): AudioNode {
    const to = o?.to ?? this.out;
    if (o?.pan === undefined) return to;
    const q = Math.round(clamp(o.pan, -1, 1) * 16);
    if (q === 0) return to;
    let byPan = this.panners.get(to);
    if (!byPan) this.panners.set(to, (byPan = new Map()));
    let p = byPan.get(q);
    if (!p) {
      p = this.ac.createStereoPanner();
      p.pan.value = q / 16;
      p.connect(to);
      byPan.set(q, p);
    }
    return p;
  }

  private inline(src: AudioNode, t0: number, len: number, mul: number, o?: SrcOpts): AudioNode {
    let n = src;
    if (!o) return n;
    const add = (type: BiquadFilterType, s: Sweep): void => {
      const f = this.ac.createBiquadFilter();
      f.type = type;
      setQ(f, o.q ?? (type === 'bandpass' ? 1 : 0.707));
      this.sweep(f.frequency, s, t0, len, mul);
      n.connect(f);
      n = f;
    };
    if (o.hp !== undefined) add('highpass', o.hp);
    if (o.bp !== undefined) add('bandpass', o.bp);
    if (o.lp !== undefined) add('lowpass', o.lp);
    return n;
  }

  // -------------------------------------------------------------------------------------------
  // sources
  // -------------------------------------------------------------------------------------------

  /** Enveloped oscillator. */
  osc(type: OscillatorType, f: Sweep, env: Env, o?: SrcOpts): OscillatorNode {
    const t0 = this.t + (o?.at ?? 0);
    const len = this.envLen(env);
    const mul = o?.fixed ? 1 : this.pitch;
    const osc = this.ac.createOscillator();
    osc.type = type;
    this.sweep(osc.frequency, f, t0, Number.isFinite(len) ? len : 1, mul);
    if (o?.detune) osc.detune.value = o.detune;
    const g = this.ac.createGain();
    this.inline(osc, t0, Number.isFinite(len) ? len : 1, mul, o).connect(g);
    g.connect(this.dest(o));
    const stop = this.applyEnv(g.gain, t0, env);
    osc.start(t0);
    if (stop === Infinity && typeof f === 'number') this.pitched.push({ p: osc.frequency, base: f * mul });
    this.finish(osc, stop);
    return osc;
  }

  /** Enveloped looping noise (random phase per play). `rate` scales playback (darker/slower when < 1). */
  noise(color: NoiseColor, env: Env, o?: SrcOpts & { rate?: number }): AudioBufferSourceNode {
    const t0 = this.t + (o?.at ?? 0);
    const len = this.envLen(env);
    const buf = this.res.noise[color];
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (o?.rate) src.playbackRate.value = o.rate;
    const g = this.ac.createGain();
    this.inline(src, t0, Number.isFinite(len) ? len : 1, o?.fixed ? 1 : this.pitch, o).connect(g);
    g.connect(this.dest(o));
    const stop = this.applyEnv(g.gain, t0, env);
    src.start(t0, this.rnd() * Math.max(0.01, buf.duration - 0.05));
    this.finish(src, stop);
    return src;
  }

  /**
   * Two-operator FM voice. `ratio` = modulator/carrier frequency, `index` = modulation index trajectory
   * (bright → mellow when it falls). Bells, metal, servos, screeches.
   */
  fm(f: Sweep, ratio: number, index: Sweep, env: Env, o?: SrcOpts & { type?: OscillatorType }): OscillatorNode {
    const t0 = this.t + (o?.at ?? 0);
    const len = this.envLen(env);
    const fin = Number.isFinite(len) ? len : 1;
    const mul = o?.fixed ? 1 : this.pitch;
    const car = this.ac.createOscillator();
    car.type = o?.type ?? 'sine';
    this.sweep(car.frequency, f, t0, fin, mul);
    if (o?.detune) car.detune.value = o.detune;
    const mod = this.ac.createOscillator();
    this.sweep(mod.frequency, f, t0, fin, mul * ratio);
    const f0 = (typeof f === 'number' ? f : typeof f[0] === 'number' ? f[0] : (f[0] as Pt)[1]) * mul * ratio;
    const depth = this.ac.createGain();
    this.sweep(depth.gain, index, t0, fin, f0);
    mod.connect(depth);
    depth.connect(car.frequency);
    const g = this.ac.createGain();
    this.inline(car, t0, fin, mul, o).connect(g);
    g.connect(this.dest(o));
    const stop = this.applyEnv(g.gain, t0, env);
    car.start(t0);
    mod.start(t0);
    if (stop === Infinity && typeof f === 'number') {
      this.pitched.push({ p: car.frequency, base: f * mul }, { p: mod.frequency, base: f * mul * ratio });
    }
    this.finish(car, stop);
    this.finish(mod, stop);
    return car;
  }

  /**
   * Additive modal body: decaying sine partials `[ratio, gain, decaySeconds]` over `base` Hz — struck metal,
   * bells, glass. `spread` randomly detunes each partial (fraction) so no two strikes are identical.
   */
  partials(base: number, spec: ReadonlyArray<readonly [number, number, number]>, o?: SrcOpts & { a?: number; g?: number; spread?: number }): void {
    const g = o?.g ?? 1;
    const spread = o?.spread ?? 0;
    for (const [ratio, gain, decay] of spec) {
      const f = base * ratio * (1 + this.jit(spread));
      if (f * (o?.fixed ? 1 : this.pitch) > 0.45 * this.ac.sampleRate) continue;
      this.osc('sine', f, { a: o?.a ?? 0.002, d: decay, g: gain * g }, o);
    }
  }

  /** Low-frequency oscillator into a param. `dur` omitted = lives until the voice ends. */
  lfo(rate: number, depth: number, target: AudioParam, o?: { type?: OscillatorType; at?: number; dur?: number }): OscillatorNode {
    const t0 = this.t + (o?.at ?? 0);
    const osc = this.ac.createOscillator();
    osc.type = o?.type ?? 'sine';
    osc.frequency.value = rate;
    const g = this.ac.createGain();
    g.gain.value = depth;
    osc.connect(g);
    g.connect(target);
    osc.start(t0);
    if (o?.dur !== undefined) osc.stop(t0 + o.dur);
    else this.open.push(osc);
    return osc;
  }

  // -------------------------------------------------------------------------------------------
  // processors (return the INPUT node; pass it as `to`)
  // -------------------------------------------------------------------------------------------

  gain(g: number, to?: AudioNode): GainNode {
    const n = this.ac.createGain();
    n.gain.value = g;
    n.connect(to ?? this.out);
    return n;
  }

  filter(type: BiquadFilterType, f: Sweep, q = 0.707, o?: { to?: AudioNode; at?: number; len?: number; fixed?: boolean; gain?: number }): BiquadFilterNode {
    const n = this.ac.createBiquadFilter();
    n.type = type;
    setQ(n, q);
    if (o?.gain !== undefined) n.gain.value = o.gain;
    this.sweep(n.frequency, f, this.t + (o?.at ?? 0), o?.len ?? 0.3, o?.fixed ? 1 : this.pitch);
    n.connect(o?.to ?? this.out);
    return n;
  }

  /** A stereo position as a destination node (shared per position — see `dest`). */
  pan(p: number, to?: AudioNode): AudioNode {
    return this.dest({ pan: p, to });
  }

  /** Waveshaper with input drive. Output is level-compensated so `drive` changes colour more than loudness. */
  shaper(curve: CurveName, drive = 1, to?: AudioNode): GainNode {
    const pre = this.ac.createGain();
    pre.gain.value = drive;
    const ws = this.ac.createWaveShaper();
    ws.curve = this.res.curves[curve];
    const post = this.ac.createGain();
    post.gain.value = 1 / Math.sqrt(Math.max(drive, 0.25));
    pre.connect(ws);
    ws.connect(post);
    post.connect(to ?? this.out);
    return pre;
  }

  /** Parallel band-pass resonator bank (excite with a click/noise burst for a struck body). */
  bank(freqs: readonly number[], q: number, o?: { to?: AudioNode; gains?: readonly number[]; g?: number; fixed?: boolean }): GainNode {
    const input = this.ac.createGain();
    const sum = this.ac.createGain();
    sum.gain.value = o?.g ?? 1;
    sum.connect(o?.to ?? this.out);
    const mul = o?.fixed ? 1 : this.pitch;
    const ny = 0.45 * this.ac.sampleRate;
    freqs.forEach((f, i) => {
      if (f * mul > ny) return;
      const b = this.ac.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.value = f * mul;
      b.Q.value = q;
      const g = this.ac.createGain();
      g.gain.value = o?.gains?.[i] ?? 1;
      input.connect(b);
      b.connect(g);
      g.connect(sum);
    });
    return input;
  }

  /** Feedback comb resonator (tube / plate body, ≥ 3 ms period). `ring` extends the voice for the tail. */
  comb(freq: number, feedback: number, o?: { to?: AudioNode; damp?: number; g?: number; ring?: number }): GainNode {
    const input = this.ac.createGain();
    const d = this.ac.createDelay(0.25);
    d.delayTime.value = clamp(1 / (freq * this.pitch), 128 / this.ac.sampleRate, 0.25);
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o?.damp ?? 3500;
    setQ(lp, 0.707); // maximally flat: loop gain can never exceed `feedback`
    const fb = this.ac.createGain();
    fb.gain.value = clamp(feedback, 0, 0.97);
    const out = this.ac.createGain();
    out.gain.value = o?.g ?? 1;
    input.connect(d);
    d.connect(lp);
    lp.connect(fb);
    fb.connect(d);
    d.connect(out);
    out.connect(o?.to ?? this.out);
    if (o?.ring) this.hold(o.ring);
    return input;
  }

  /** Feedback echo (slapback, sonar pings). Dry passes through; `mix` is the wet level. */
  echo(time: number, feedback: number, mix: number, to?: AudioNode): GainNode {
    const input = this.ac.createGain();
    const dst = to ?? this.out;
    const d = this.ac.createDelay(1);
    d.delayTime.value = clamp(time, 0.003, 1);
    const fb = this.ac.createGain();
    fb.gain.value = clamp(feedback, 0, 0.9);
    const wet = this.ac.createGain();
    wet.gain.value = mix;
    input.connect(dst);
    input.connect(d);
    d.connect(fb);
    fb.connect(d);
    d.connect(wet);
    wet.connect(dst);
    return input;
  }

  // -------------------------------------------------------------------------------------------
  // lifetime
  // -------------------------------------------------------------------------------------------

  /** One-shot voices: stop every open-ended source (LFOs) when the scheduled content has finished. */
  seal(): void {
    const at = this.t + this.end + 0.05;
    for (const s of this.open) s.stop(at);
    this.open.length = 0;
  }

  /** Stop every open-ended source at an absolute time (loop stop / deck disposal). */
  stopAll(at: number): void {
    for (const s of this.open) {
      try {
        s.stop(at);
      } catch {
        /* already stopped */
      }
    }
    this.open.length = 0;
    this.pitched.length = 0;
  }
}
