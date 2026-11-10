/**
 * AudioEngine — the whole audio system over ONE BaseAudioContext (live or offline). The public AudioSystem
 * façade (index.ts) owns the browser/game concerns (unlock, settings, events); everything audible is here so
 * the sandbox can render the exact same graph through an OfflineAudioContext for measurement.
 */
import { clamp, clamp01, mulberry32 } from '@/core/mathx';
import type { AmbienceId, LoopHandle, MusicState, SfxOpts, Vec3Like } from '@/core/api';
import { makeShared, type Shared } from './synth/shared';
import { Mixer, type Volumes } from './mixer';
import { Voices } from './voices';
import { SFX } from './sfx';
import { AMB_NORM, MUSIC_NORM, SFX_NORM } from './calibration';
import { MusicEngine, type StingerKind } from './music/engine';
import { AmbienceEngine } from './ambience/engine';
import { speakTick, type SpeakChannel } from './speak';

export interface EngineOpts {
  /** seed for all non-gameplay variation (deterministic offline renders) */
  seed?: number;
  /** output node (default: context destination) */
  destination?: AudioNode;
  /** ignore the measured normalisation tables (used by the calibration pass itself) */
  raw?: boolean;
}

const MIN_LOOKAHEAD = 0.2;
const MAX_LOOKAHEAD = 1.2;

export class AudioEngine {
  readonly res: Shared;
  readonly mixer: Mixer;
  readonly voices: Voices;
  readonly music: MusicEngine;
  readonly ambience: AmbienceEngine;
  private readonly rnd: () => number;
  private avgDt = 1 / 60;

  constructor(readonly ac: BaseAudioContext, opts: EngineOpts = {}) {
    const seed = opts.seed ?? 20260907;
    this.rnd = mulberry32(seed);
    this.res = makeShared(ac);
    this.mixer = new Mixer(ac, this.res, opts.destination);
    this.voices = new Voices(ac, this.mixer, this.res, this.rnd, SFX, opts.raw ? {} : SFX_NORM);
    this.music = new MusicEngine(ac, this.res, this.mixer, seed ^ 0x51ed, opts.raw ? {} : MUSIC_NORM);
    this.ambience = new AmbienceEngine(ac, this.res, this.mixer, seed ^ 0x2c1b, opts.raw ? {} : AMB_NORM);
  }

  /** scheduling horizon: grows when frames are long so rhythm survives a slow renderer */
  private get lookahead(): number {
    return clamp(this.avgDt * 3 + 0.1, MIN_LOOKAHEAD, MAX_LOOKAHEAD);
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

  setIntensity(n: number): void {
    this.music.setIntensity(clamp01(Number.isFinite(n) ? n : 0));
  }

  stinger(kind: StingerKind): void {
    this.music.stinger(kind);
  }

  speak(speaker: string, channel: SpeakChannel = 'voice'): void {
    speakTick(this, speaker, channel);
  }

  duck(amount: number, seconds: number): void {
    this.mixer.duck(amount, seconds);
  }

  setMuffle(amount: number, fadeSeconds?: number): void {
    this.mixer.setMuffle(amount, fadeSeconds);
  }

  cadenceTick(pos?: Vec3Like, irregular = false): void {
    this.voices.play(irregular ? 'cadenceTickOff' : 'cadenceTick', pos ? { pos } : undefined);
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

  /** Drive all look-ahead scheduling. `dt` is real seconds since the previous call. */
  update(dt: number): void {
    if (Number.isFinite(dt) && dt > 0) this.avgDt += (Math.min(dt, 1) - this.avgDt) * 0.1;
    const ahead = this.lookahead;
    this.voices.update(ahead);
    this.music.update(dt, ahead);
    this.ambience.update(ahead);
  }

  /** Zone unload: stop loops. Music and ambience are left to the next zone's setEnv to change. */
  clear(): void {
    this.voices.stopLoops();
  }

  /** Live counts for debug overlays and the sandbox meter. */
  stats(): { voices: number; music: MusicState; ambience: AmbienceId; intensity: number } {
    return { voices: this.voices.count, music: this.music.state, ambience: this.ambience.current, intensity: this.music.intensity };
  }
}
