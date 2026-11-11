/**
 * Track player: one recording at a time, looping by cross-fading its tail under the start of the next pass,
 * with an equal-power cross-fade to the next recording when the state changes.
 *
 *   pass (buffer source) ─► pass gain (loop cross-fade) ─┐
 *   next pass ─────────────► pass gain ──────────────────┴─► level ─► [low shelf] ─► tone (low-pass) ─► fader ─► music bus
 *
 * A "slot" is one recording (and one loop region of it) with its own level, tone and fader; a state change
 * to another recording fades a new slot in while the old one fades out and is then discarded. Returning to
 * a slot that is still fading brings it back instead of starting the piece over.
 *
 * Everything is scheduled against the context clock from `update()` — no timers — and passes are scheduled
 * well ahead, so a long frame cannot open a hole at the seam.
 */
import { clamp } from '@/core/mathx';
import { setQ } from '../synth/kit';
import type { LoopSpec } from './mapping';

/** linear segments an equal-power fade is drawn with (within 0.05 dB of the true curve) */
const SEGMENTS = 12;
const HALF_PI = Math.PI / 2;
const power = (x: number): number => Math.sin(clamp(x, 0, 1) * HALF_PI);

/**
 * Schedule an equal-power fade on a gain: amplitude sin(π/2·x) while x moves evenly from `x0` to `x1`
 * (0 = silent, 1 = full). Two such fades in opposite directions always sum to constant power.
 */
export function powerRamp(p: AudioParam, at: number, seconds: number, x0: number, x1: number): void {
  const d = Math.max(0.005, seconds);
  p.setValueAtTime(power(x0), at);
  for (let i = 1; i <= SEGMENTS; i++) p.linearRampToValueAtTime(power(x0 + ((x1 - x0) * i) / SEGMENTS), at + (d * i) / SEGMENTS);
}

/** An equal-power fader that knows where it is, so a new fade can start from the middle of the last one. */
class PowerFader {
  private t0 = 0;
  private x0: number;
  private t1 = 0;
  private x1: number;

  constructor(private readonly p: AudioParam, x: number) {
    p.value = power(x);
    this.x0 = this.x1 = x;
  }

  private at(t: number): number {
    if (t <= this.t0) return this.x0;
    if (t >= this.t1) return this.x1;
    return this.x0 + ((this.x1 - this.x0) * (t - this.t0)) / (this.t1 - this.t0);
  }

  /** From `startAt`, move to `target` (0..1) over `seconds`. */
  fade(now: number, startAt: number, seconds: number, target: number): void {
    const s = Math.max(startAt, now);
    const xNow = this.at(now);
    const xStart = this.at(s);
    const d = Math.max(0.005, seconds);
    this.p.cancelScheduledValues(now);
    this.p.setValueAtTime(power(xNow), now);
    if (s > now && xStart !== xNow) this.p.linearRampToValueAtTime(power(xStart), s);
    powerRamp(this.p, s, d, xStart, target);
    this.t0 = s;
    this.x0 = xStart;
    this.t1 = s + d;
    this.x1 = target;
  }
}

/** One scheduled pass of a recording (diagnostics; times are context seconds). */
export interface PassInfo {
  k: number;
  /** when it starts sounding */
  startAt: number;
  /** position in the file it starts from (s) */
  offset: number;
  /** when the next pass starts and this one begins to fade */
  handoverAt: number;
  /** when its fade is over and the source stops */
  stopAt: number;
  /** length of its fade-in (0 for the first pass: the slot's own fader brings it in) */
  fadeIn: number;
}

interface Pass extends PassInfo {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

class Slot {
  readonly passes: Pass[] = [];
  /** context time after which the slot is gone (Infinity while it is the current one) */
  disposeAt = Infinity;
  private readonly level: GainNode;
  private readonly tone: BiquadFilterNode;
  private shelf: BiquadFilterNode | null = null;
  private readonly out: GainNode;
  private readonly fader: PowerFader;
  private nextAt: number;
  private k = 0;

  constructor(
    private readonly ac: BaseAudioContext, to: AudioNode, readonly key: string, readonly buffer: AudioBuffer,
    readonly loop: LoopSpec, startAt: number, level: number, toneHz: number,
  ) {
    this.level = ac.createGain();
    this.level.gain.value = level;
    this.tone = ac.createBiquadFilter();
    this.tone.type = 'lowpass';
    setQ(this.tone, 0.707);
    this.tone.frequency.value = this.hz(toneHz);
    this.out = ac.createGain();
    this.fader = new PowerFader(this.out.gain, 0);
    // a track that came out boomy gets its gentle low-shelf cut here (TrackInfo.lowShelf)
    const ls = loop.lowShelf;
    if (ls && Number.isFinite(ls.hz) && Number.isFinite(ls.db) && ls.db !== 0) {
      const shelf = ac.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = clamp(ls.hz, 30, 2000);
      shelf.gain.value = clamp(ls.db, -18, 6);
      this.level.connect(shelf);
      shelf.connect(this.tone);
      this.shelf = shelf;
    } else this.level.connect(this.tone);
    this.tone.connect(this.out);
    this.out.connect(to);
    this.nextAt = startAt;
  }

  private hz(v: number): number {
    return clamp(Number.isFinite(v) ? v : 20000, 120, this.ac.sampleRate * 0.45);
  }

  fade(now: number, at: number, seconds: number, target: number): void {
    this.fader.fade(now, at, seconds, target);
    this.disposeAt = target > 0 ? Infinity : Math.max(now, at) + Math.max(0.005, seconds) + 0.1;
  }

  set(level: number, toneHz: number, seconds: number): void {
    const now = this.ac.currentTime;
    const tc = Math.max(0.02, seconds) / 3;
    if (Number.isFinite(level)) this.level.gain.setTargetAtTime(Math.max(0, level), now, tc);
    this.tone.frequency.setTargetAtTime(this.hz(toneHz), now, tc);
  }

  /** Start every pass that begins within `horizon` seconds, and drop the ones that have finished. */
  update(now: number, horizon: number): void {
    for (let n = 0; n < 4 && this.nextAt < this.disposeAt && this.nextAt - now < horizon; n++) this.startPass(now);
    for (let i = this.passes.length - 1; i >= 0; i--) {
      if (now < this.passes[i].stopAt + 0.1) continue;
      this.passes[i].gain.disconnect();
      this.passes.splice(i, 1);
    }
  }

  private startPass(now: number): void {
    const l = this.loop;
    const k = this.k++;
    const at = this.nextAt;
    const offset = k === 0 ? l.intro : l.from;
    const body = Math.max(0.5, (l.to - offset) / l.rate);
    const xfade = l.xfade / l.rate;
    const handoverAt = at + body;
    this.nextAt = handoverAt;
    // starved (hidden tab, a stalled main thread): come in late at the right place rather than out of phase
    const late = Math.max(0, now - at);
    if (late >= body) return;
    const src = this.ac.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = l.rate;
    const gain = this.ac.createGain();
    src.connect(gain);
    gain.connect(this.level);
    const startAt = at + late;
    // the first pass is brought in by the slot's fader; later ones cross-fade with the tail of the last
    const fadeIn = k === 0 ? (late > 0 ? 0.03 : 0) : Math.max(0.03, xfade - late);
    if (fadeIn > 0) {
      gain.gain.value = 0;
      powerRamp(gain.gain, startAt, fadeIn, k > 0 && late < xfade ? late / xfade : 0, 1);
    }
    powerRamp(gain.gain, Math.max(handoverAt, startAt + fadeIn), xfade, 1, 0);
    const stopAt = handoverAt + xfade + 0.05;
    src.start(startAt, Math.max(0, offset + late * l.rate));
    src.stop(stopAt);
    this.passes.push({ src, gain, k, startAt, offset, handoverAt, stopAt, fadeIn });
  }

  dispose(now: number): void {
    for (const p of this.passes) {
      try {
        p.src.stop(now);
      } catch {
        /* already stopped */
      }
      p.gain.disconnect();
    }
    this.passes.length = 0;
    this.shelf?.disconnect();
    this.out.disconnect();
  }
}

export class TrackPlayer {
  private slot: Slot | null = null;
  private readonly leaving: Slot[] = [];

  constructor(private readonly ac: BaseAudioContext, private readonly to: AudioNode) {}

  /** key of the recording that is current (it may still be fading in), or null */
  get key(): string | null {
    return this.slot ? this.slot.key : null;
  }

  /** recordings sounding right now, fading ones included */
  get sounding(): number {
    return (this.slot ? 1 : 0) + this.leaving.length;
  }

  /**
   * Make `buffer` the current recording from context time `at`, cross-fading (equal power) with whatever
   * plays now over `fade` seconds. Asking for the recording that is already current only moves its level
   * and tone; asking for one that is still fading out brings it back where it is.
   */
  play(key: string, buffer: AudioBuffer, loop: LoopSpec, level: number, toneHz: number, at: number, fade: number): void {
    const now = this.ac.currentTime;
    const f = Math.max(0.02, Number.isFinite(fade) ? fade : 2);
    if (this.slot && this.slot.key === key && this.slot.buffer === buffer) {
      this.slot.set(level, toneHz, f);
      return;
    }
    const start = Math.max(Number.isFinite(at) ? at : now, now);
    this.stop(start, f);
    const back = this.leaving.findIndex((s) => s.key === key && s.buffer === buffer);
    let slot: Slot;
    if (back >= 0) {
      slot = this.leaving.splice(back, 1)[0];
      slot.set(level, toneHz, f);
    } else {
      slot = new Slot(this.ac, this.to, key, buffer, loop, start, level, toneHz);
    }
    slot.fade(now, start, f, 1);
    this.slot = slot;
    slot.update(now, 1);
  }

  /** Level (linear) and low-pass of the current recording, reached smoothly over `seconds`. */
  setLevel(level: number, toneHz: number, seconds = 0.3): void {
    this.slot?.set(level, toneHz, seconds);
  }

  /** Fade the current recording out from `at` over `fade` seconds. */
  stop(at: number, fade: number): void {
    const s = this.slot;
    if (!s) return;
    const now = this.ac.currentTime;
    s.fade(now, Math.max(Number.isFinite(at) ? at : now, now), Math.max(0.02, Number.isFinite(fade) ? fade : 2), 0);
    this.leaving.push(s);
    this.slot = null;
  }

  /** Keep the loops fed: schedule passes that start within `horizon` seconds, discard what has faded. */
  update(horizon: number): void {
    const now = this.ac.currentTime;
    this.slot?.update(now, horizon);
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const s = this.leaving[i];
      if (now >= s.disposeAt) {
        s.dispose(now);
        this.leaving.splice(i, 1);
      } else {
        s.update(now, horizon);
      }
    }
  }

  /** The passes scheduled for the current recording (the sandbox checks the seam arithmetic with this). */
  schedule(): PassInfo[] {
    return (this.slot?.passes ?? []).map(({ k, startAt, offset, handoverAt, stopAt, fadeIn }) => ({ k, startAt, offset, handoverAt, stopAt, fadeIn }));
  }

  /** Stop everything at once (context being discarded). */
  dispose(): void {
    const now = this.ac.currentTime;
    this.slot?.dispose(now);
    this.slot = null;
    for (const s of this.leaving) s.dispose(now);
    this.leaving.length = 0;
  }
}
