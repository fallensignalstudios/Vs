/**
 * Adaptive music engine. One Deck plays the current MusicState; `setState` starts the next deck on a musical
 * boundary and cross-fades. Intensity is smoothed (quick to rise, slow to settle) and drives every deck's
 * layer levels. All scheduling happens in `update()` against `AudioContext.currentTime` — no timers.
 */
import { clamp, clamp01, mulberry32 } from '@/core/mathx';
import type { MusicState } from '@/core/api';
import { Kit } from '../synth/kit';
import type { Shared } from '../synth/shared';
import type { Mixer } from '../mixer';
import { dbToGain } from '../sfx/recipe';
import { MUSIC } from './defs';
import { Deck, boundaryFor, type DeckShared } from './deck';
import { STINGER_LEVEL, playStinger, type StingerKind } from './stingers';
import type { Family, MusicDef } from './types';

export type { StingerKind } from './stingers';

/** Bed gain used until a state has a measured normalisation. */
const UNCALIBRATED = 0.22;
const DEFAULT_DB = -20;
/** intensity slew (per second) */
const RISE = 1.4;
const FALL = 0.3;

export class MusicEngine {
  private current: MusicState = 'silence';
  private deck: Deck | null = null;
  private readonly fading: Deck[] = [];
  private readonly shared: DeckShared = { intensity: 0, irregular: 0, resolved: false };
  private target = 0;
  private readonly warned = new Set<string>();
  private readonly lastStinger = new Map<string, number>();
  private readonly stingerBus: GainNode;
  private serial = 0;
  private readonly rnd: () => number;
  private readonly stingers: Array<{ out: GainNode; end: number }> = [];

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly res: Shared,
    private readonly mixer: Mixer,
    private readonly seed: number,
    private readonly norm: Readonly<Record<string, number>>,
  ) {
    this.rnd = mulberry32(seed ^ 0x9e37);
    this.stingerBus = ac.createGain();
    this.stingerBus.connect(mixer.music);
    const send = ac.createGain();
    send.gain.value = 0.5;
    this.stingerBus.connect(send);
    send.connect(mixer.reverbIn);
  }

  get state(): MusicState {
    return this.current;
  }

  /** smoothed intensity actually applied to the layers */
  get intensity(): number {
    return this.shared.intensity;
  }

  get resolved(): boolean {
    return this.shared.resolved;
  }

  private def(state: MusicState): MusicDef | null {
    if (state === 'silence') return null;
    const d = (MUSIC as Record<string, MusicDef | undefined>)[state];
    if (!d && !this.warned.has(state)) {
      this.warned.add(state);
      console.warn(`[audio] unknown music state "${state}" — silence`);
    }
    return d ?? null;
  }

  private family(): Family {
    return this.deck?.def.family ?? 'neutral';
  }

  /** Cross-fade to a state on the next bar line (next beat for very short fades). */
  setState(state: MusicState, fadeSeconds = 2): void {
    if (state === this.current) return;
    const def = this.def(state);
    const now = this.ac.currentTime;
    const fade = clamp(Number.isFinite(fadeSeconds) ? fadeSeconds : 2, 0.05, 30);
    const at = boundaryFor(this.deck, now, fade);
    const wasEclipse = this.family() === 'eclipse';

    if (this.deck) {
      this.deck.fadeOut(now, at, fade);
      this.fading.push(this.deck);
      this.deck = null;
    }
    this.current = def ? state : 'silence';
    if (!def) return;

    // a fresh entrance into Eclipse territory starts with the cadence locked
    if (def.family === 'eclipse' && !wasEclipse) this.shared.irregular = 0;
    const gain = (this.norm[state] ?? UNCALIBRATED) * dbToGain(def.db ?? DEFAULT_DB);
    this.deck = new Deck(this.ac, this.res, this.mixer, def, gain, at, (this.seed + 7919 * ++this.serial) >>> 0, this.shared);
    this.deck.fadeIn(now, at, Math.min(fade, 6) * 0.6);
  }

  /** Target intensity 0..1; the audible value slews toward it. */
  setIntensity(n: number): void {
    this.target = clamp01(n);
  }

  /** The King identity resolves (meridianComplete) — or is reset for a reload before that beat. */
  setResolved(resolved: boolean): void {
    this.shared.resolved = resolved;
  }

  /** Eclipse cadence: 0 locks it back onto the grid, 1 lets it fall apart. */
  setIrregular(amount: number): void {
    this.shared.irregular = clamp01(amount);
  }

  stinger(kind: StingerKind): void {
    if (!(kind in STINGER_LEVEL)) {
      if (!this.warned.has(`stinger:${kind}`)) {
        this.warned.add(`stinger:${kind}`);
        console.warn(`[audio] unknown stinger "${kind}" — ignored`);
      }
      return;
    }
    const now = this.ac.currentTime;
    const last = this.lastStinger.get(kind);
    if (last !== undefined && now - last < 1.2) return;
    this.lastStinger.set(kind, now);

    if (kind === 'sever') this.shared.irregular = 1;
    if (kind === 'death') this.mixer.duck(0.75, 3.2);
    if (kind === 'resonance' || kind === 'revelation') this.mixer.duck(0.35, 2.5);

    const out = this.ac.createGain();
    out.gain.value = STINGER_LEVEL[kind];
    out.connect(this.stingerBus);
    const k = new Kit(this.ac, this.res, out, now + 0.01, 1, this.rnd, false);
    playStinger(kind, k, this.deck?.def.tonic ?? 38, this.family());
    k.seal();
    this.stingers.push({ out, end: now + k.end + 0.3 });
  }

  update(dt: number, lookahead: number): void {
    const now = this.ac.currentTime;
    if (Number.isFinite(dt) && dt > 0) {
      const d = this.target - this.shared.intensity;
      const step = (d > 0 ? RISE : FALL) * Math.min(dt, 0.5);
      this.shared.intensity = Math.abs(d) <= step ? this.target : this.shared.intensity + Math.sign(d) * step;
    }
    const horizon = now + lookahead;
    if (this.deck) {
      this.deck.applyLevels(now);
      this.deck.schedule(now, horizon);
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const d = this.fading[i];
      if (now >= d.endAt + 0.25) {
        d.dispose();
        this.fading.splice(i, 1);
      } else {
        d.applyLevels(now);
        d.schedule(now, horizon);
      }
    }
    for (let i = this.stingers.length - 1; i >= 0; i--) {
      if (now >= this.stingers[i].end) {
        this.stingers[i].out.disconnect();
        this.stingers.splice(i, 1);
      }
    }
  }
}
