/**
 * AudioEngine — the whole audio system over ONE BaseAudioContext (live or offline). The public AudioSystem
 * façade (index.ts) owns the browser/game concerns (unlock, settings, events); everything audible is here so
 * the sandbox can render the exact same graph through an OfflineAudioContext for measurement.
 */
import { clamp, clamp01, mulberry32 } from '@/core/mathx';
import type { AmbienceId, LoopHandle, MusicState, SfxOpts, Vec3Like } from '@/core/api';
import { makeShared, type Shared } from './synth/shared';
import { SampleBank, type SampleOpts } from './synth/samples';
import { Mixer, type Volumes } from './mixer';
import { Voices } from './voices';
import { SFX } from './sfx';
import { AMB_NORM, MUSIC_NORM, SFX_NORM } from './calibration';
import { MusicEngine, type StingerKind } from './music/engine';
import { AmbienceEngine } from './ambience/engine';
import { prerender } from './prerender';
import { speakCue, type SpeakChannel } from './speak';

export interface EngineOpts {
  /** seed for all non-gameplay variation (deterministic offline renders) */
  seed?: number;
  /** output node (default: context destination) */
  destination?: AudioNode;
  /** override the measured normalisation tables (the calibration pass iterates on these) */
  norm?: Partial<NormTables>;
  /** false = never use pre-rendered buffers on this engine (A/B measurement of the live recipes) */
  samples?: boolean;
}

/** Normalisation gains per id — see calibration.ts. */
export interface NormTables {
  sfx: Readonly<Record<string, number>>;
  music: Readonly<Record<string, number>>;
  amb: Readonly<Record<string, number>>;
}

const MIN_LOOKAHEAD = 0.2;
const MAX_LOOKAHEAD = 1.2;
/** extra scheduling horizon while the game says it is busy (zone build, loading) */
const BUSY_LOOKAHEAD = 1.5;
/** seconds between repeats of the same "update failed" warning */
const REWARN = 5;

export class AudioEngine {
  readonly res: Shared;
  readonly mixer: Mixer;
  readonly voices: Voices;
  readonly music: MusicEngine;
  readonly ambience: AmbienceEngine;
  /** pre-rendered and registered buffers that stand in for recipes */
  readonly samples = new SampleBank();
  private readonly rnd: () => number;
  private readonly useSamples: boolean;
  private avgDt = 1 / 60;
  private busy = false;
  private ready: Promise<void> | null = null;
  private readonly warnedAt = new Map<string, number>();

  constructor(readonly ac: BaseAudioContext, opts: EngineOpts = {}) {
    const seed = opts.seed ?? 20260907;
    this.rnd = mulberry32(seed);
    this.useSamples = opts.samples !== false;
    this.res = makeShared(ac);
    this.mixer = new Mixer(ac, this.res, opts.destination);
    this.voices = new Voices(ac, this.mixer, this.res, this.rnd, SFX, opts.norm?.sfx ?? SFX_NORM, this.samples);
    this.music = new MusicEngine(ac, this.res, this.mixer, seed ^ 0x51ed, opts.norm?.music ?? MUSIC_NORM, this.samples);
    this.ambience = new AmbienceEngine(ac, this.res, this.mixer, this.voices, seed ^ 0x2c1b, opts.norm?.amb ?? AMB_NORM);
  }

  /**
   * Pre-render the frequent sounds (see prerender.ts) and switch to them as they land. Call once after
   * construction; the engine is fully usable before the promise resolves — it just synthesises live.
   */
  prerender(): Promise<void> {
    if (!this.useSamples) return Promise.resolve();
    this.ready ??= prerender(this.ac.sampleRate, this.res.waves).then((p) => this.samples.setBaked(p.samples));
    return this.ready;
  }

  /**
   * Play a decoded recording wherever `id` is played or looped, through the same strip, bus, panner, sends,
   * rate limits and level as the procedural recipe it replaces (which stays the fallback for every other id).
   * An id with no recipe becomes playable too. Several buffers for one id are rotated.
   */
  registerSample(id: string, buffer: AudioBuffer, opts?: SampleOpts): void {
    this.voices.registerSample(id, buffer, opts);
  }

  /** Go back to the procedural sound for an id. */
  unregisterSample(id: string): void {
    this.samples.unregister(id);
  }

  /** scheduling horizon: grows when frames are long so rhythm survives a slow renderer */
  private get lookahead(): number {
    return clamp(this.avgDt * 3 + 0.1, MIN_LOOKAHEAD, MAX_LOOKAHEAD) + (this.busy ? BUSY_LOOKAHEAD : 0);
  }

  /** The game expects long frames (zone build): schedule further ahead until told otherwise. */
  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  play(id: string, opts?: SfxOpts): number {
    if (id === 'meridianComplete') this.music.setResolved(true);
    return this.voices.play(id, opts);
  }

  loop(id: string, opts?: SfxOpts): LoopHandle {
    return this.voices.loop(id, opts);
  }

  setMusic(state: MusicState, fadeSeconds?: number): void {
    this.music.setState(state, fadeSeconds);
  }

  setAmbience(id: AmbienceId, fadeSeconds?: number): void {
    this.ambience.set(id, fadeSeconds);
  }

  /** `snap` skips the slew (offline renders, state restore). */
  setIntensity(n: number, snap = false): void {
    this.music.setIntensity(clamp01(Number.isFinite(n) ? n : 0), snap);
  }

  stinger(kind: StingerKind): void {
    this.music.stinger(kind);
  }

  speak(speaker: string, channel: SpeakChannel = 'voice'): void {
    const cue = speakCue(speaker, channel);
    this.voices.play(cue.id, { pitch: cue.pitch });
  }

  duck(amount: number, seconds: number): void {
    this.mixer.duck(amount, seconds);
  }

  setMuffle(amount: number, fadeSeconds?: number): void {
    this.mixer.setMuffle(amount, fadeSeconds);
  }

  cadenceTick(pos?: Vec3Like, irregular = false): void {
    this.voices.play(irregular ? 'cadenceTickOff' : 'cadenceTick', pos ? { pos } : undefined);
    this.music.cadencePulse(irregular);
  }

  setListener(pos: Vec3Like, forward: Vec3Like): void {
    this.voices.setListener(pos, forward);
  }

  setVolumes(v: Volumes, fade?: number): void {
    this.mixer.setVolumes(v, fade);
  }

  setPaused(paused: boolean): void {
    this.mixer.setPaused(paused);
  }

  /**
   * Run one part of the update. A failure in one part never starves the others, and is reported again every
   * few seconds for as long as it persists (a single warning at minute one is no help at minute thirty).
   */
  private part(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const now = this.ac.currentTime;
      const last = this.warnedAt.get(what);
      if (last === undefined || now - last >= REWARN) {
        this.warnedAt.set(what, now);
        console.warn(`[audio] ${what} update failed:`, err);
      }
    }
  }

  /** Drive all look-ahead scheduling. `dt` is real seconds since the previous call. */
  update(dt: number): void {
    if (Number.isFinite(dt) && dt > 0) this.avgDt += (Math.min(dt, 1) - this.avgDt) * 0.1;
    const ahead = this.lookahead;
    this.part('voices', () => this.voices.update(ahead));
    this.part('music', () => this.music.update(dt, ahead));
    this.part('ambience', () => this.ambience.update());
    this.part('mixer', () => this.mixer.update(dt));
  }

  /** Zone unload: stop loops. Music and ambience are left to the next zone's setEnv to change. */
  clear(): void {
    this.voices.stopLoops();
  }

  /** Release the heavy native resources of a context that is being discarded. The engine is dead afterwards. */
  dispose(): void {
    this.mixer.dispose();
  }
}
