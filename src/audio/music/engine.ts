/**
 * Adaptive music engine. One Deck plays the current MusicState; `setState` starts the next deck — at full
 * level — on a musical boundary while the outgoing one fades underneath. Intensity is smoothed (quick to
 * rise, slow to settle) and drives every deck's layer levels. All scheduling happens in `update()` against
 * `AudioContext.currentTime` — no timers.
 */
import { clamp, clamp01, mulberry32 } from '@/core/mathx';
import type { MusicState } from '@/core/api';
import { Kit } from '../synth/kit';
import type { Shared } from '../synth/shared';
import type { SampleBank } from '../synth/samples';
import type { Mixer } from '../mixer';
import { dbToGain } from '../sfx/recipe';
import { MUSIC } from './defs';
import { Deck, boundaryFor, type DeckShared } from './deck';
import { STINGER_DB, playStinger, type StingerKind } from './stingers';
import { strike } from './instruments';
import type { Family, MusicDef } from './types';

export type { StingerKind } from './stingers';

/**
 * What plays in place of a state's own definition while something else carries the state — a recorded
 * track (assets/score.ts), or the same definition at a trimmed level.
 */
export interface Cover {
  /** identity: asking for the cover that is already on changes nothing */
  key: string;
  /** the definition that plays instead (usually a few layers of the state's own); null = nothing */
  def: MusicDef | null;
  /** key centre of what is heard (MIDI, bass register): stingers are played in it */
  tonic?: number;
  /** gain trim on the generative deck, dB */
  trimDb?: number;
}

/** Bed gain used until a state has a measured normalisation. */
const UNCALIBRATED = 0.22;
const DEFAULT_DB = -20;
/** intensity slew (per second) */
const RISE = 1.4;
const FALL = 0.3;

export class MusicEngine {
  private current: MusicState = 'silence';
  /** definition of the current state (its identity even while a cover plays instead of it) */
  private stateDef: MusicDef | null = null;
  private cover: Cover | null = null;
  private deck: Deck | null = null;
  private readonly fading: Deck[] = [];
  private readonly shared: DeckShared = { intensity: 0, irregular: 0, resolved: false, externalCadenceAt: -Infinity };
  private target = 0;
  private readonly warned = new Set<string>();
  private readonly lastStinger = new Map<string, number>();
  private readonly stingerBus: GainNode;
  private serial = 0;
  private lead: 'dominion' | 'reformation' = 'dominion';
  private readonly rnd: () => number;
  private readonly stingers: Array<{ out: GainNode; end: number }> = [];

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly res: Shared,
    private readonly mixer: Mixer,
    private readonly seed: number,
    private readonly norm: Readonly<Record<string, number>>,
    private readonly samples: SampleBank,
  ) {
    this.rnd = mulberry32(seed ^ 0x9e37);
    // stingers are whole little pieces (drums + tones): they take the uncompressed path, and their hall
    // send returns into the music path like everything else in the score
    this.stingerBus = ac.createGain();
    this.stingerBus.connect(mixer.musicDirect);
    const send = ac.createGain();
    send.gain.value = 0.4;
    this.stingerBus.connect(send);
    send.connect(mixer.scoreSend);
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

  /** the deck now playing (diagnostics and the sandbox) */
  get activeDeck(): Deck | null {
    return this.deck;
  }

  private family(): Family {
    return this.stateDef?.family ?? 'neutral';
  }

  /** Instrumentation for a stinger: the bed's own identity, or the current protagonist's over a shared bed. */
  private stingerFamily(): Family {
    const f = this.family();
    return f === 'neutral' || f === 'king' ? this.lead : f;
  }

  /** Whose mission this currently is — flavours encounter stingers when the bed itself is neutral. */
  setLead(lead: 'dominion' | 'reformation'): void {
    this.lead = lead;
  }

  /**
   * Change state on the next bar line (next beat for very short fades). With a `cover`, that plays instead
   * of the state's own definition — the state, its family and its stingers stay what they are. Calling
   * again with the same state and another cover swaps what plays, on the same kind of boundary.
   * Returns the context time the change lands on.
   */
  setState(state: MusicState, fadeSeconds = 2, cover: Cover | null = null): number {
    const now = this.ac.currentTime;
    const same = state === this.current;
    if (same && (cover?.key ?? '') === (this.cover?.key ?? '')) return now;
    const stateDef = this.def(state);
    const def = stateDef && cover ? cover.def : stateDef;
    const fade = clamp(Number.isFinite(fadeSeconds) ? fadeSeconds : 2, 0.05, 30);
    const at = boundaryFor(this.deck, now, fade);
    const wasEclipse = this.family() === 'eclipse';

    if (this.deck) {
      if (this.deck.frontier <= this.deck.startAt + 1e-6) {
        // superseded before it played a note: nothing to fade
        this.deck.dispose();
      } else {
        this.deck.fadeOut(now, at, fade);
        this.fading.push(this.deck);
      }
      this.deck = null;
    }
    this.current = stateDef ? state : 'silence';
    this.stateDef = stateDef;
    this.cover = stateDef ? cover : null;
    if (!stateDef) return at;

    // a fresh entrance into Eclipse territory starts with the cadence locked
    if (!same && stateDef.family === 'eclipse' && !wasEclipse) this.shared.irregular = 0;
    if (!def) return at;
    const gain = (this.norm[state] ?? UNCALIBRATED) * dbToGain((stateDef.db ?? DEFAULT_DB) + (cover?.trimDb ?? 0));
    this.deck = new Deck(this.ac, this.res, this.mixer, this.samples, def, gain, at, (this.seed + 7919 * ++this.serial) >>> 0, this.shared, state);
    return at;
  }

  /** Target intensity 0..1; the audible value slews toward it. */
  setIntensity(n: number, snap = false): void {
    this.target = clamp01(Number.isFinite(n) ? n : 0);
    if (snap) this.shared.intensity = this.target;
  }

  /** The King identity resolves (meridianComplete) — or is reset for a reload before that beat. */
  setResolved(resolved: boolean): void {
    this.shared.resolved = resolved;
  }

  /** Eclipse cadence: 0 locks it back onto the grid, 1 lets it fall apart. */
  setIrregular(amount: number): void {
    if (!Number.isFinite(amount)) return; // e.g. severed / total with no links: keep what we had
    this.shared.irregular = clamp01(amount);
  }

  /** current cadence irregularity 0..1 */
  get irregular(): number {
    return this.shared.irregular;
  }

  /**
   * A cadence beat from gameplay (the linked bodies' shared clock). In an Eclipse state the score's cadence
   * layer sounds it and stops ticking on its own grid, so music and enemies never run two clocks.
   */
  cadencePulse(irregular: boolean): void {
    if (!this.deck) return;
    const t = this.ac.currentTime + 0.005;
    // several bodies report the same beat: sound it once
    if (t - this.shared.externalCadenceAt < 0.12) return;
    if (this.deck.pulseCadence(t, irregular)) this.shared.externalCadenceAt = t;
  }

  stinger(kind: StingerKind): void {
    if (!(kind in STINGER_DB)) {
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
    out.gain.value = (this.norm[`stinger:${kind}`] ?? 0.2) * dbToGain(STINGER_DB[kind]);
    out.connect(this.stingerBus);
    const k = new Kit(this.ac, this.res, out, now + 0.01, 1, this.rnd, false);
    const family = kind === 'encounterStart' || kind === 'encounterClear' ? this.stingerFamily() : this.family();
    playStinger(kind, k, this.cover?.tonic ?? this.stateDef?.tonic ?? 38, family, (inst, at, vel, tune) => strike(this.samples, this.rnd, inst, k, at, vel, tune));
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
    if (this.deck) {
      this.deck.applyLevels(now);
      this.deck.schedule(now, lookahead);
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const d = this.fading[i];
      if (now >= d.disposeAt) {
        d.dispose();
        this.fading.splice(i, 1);
      } else {
        d.applyLevels(now);
        d.schedule(now, lookahead);
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
