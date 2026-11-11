/**
 * Score director: decides, per MusicState, whether a recording or the generative engine carries the music,
 * and keeps the two from ever fighting.
 *
 *  - A state with a recording that is decoded: the recording comes in on the generative engine's own
 *    boundary (next bar line) with an equal-power fade, and the generative engine drops to the plan's
 *    `generativeLayers` (usually nothing).
 *  - A state whose recording is not there yet: the generative score plays exactly as it always did while the
 *    track loads; when it arrives the two cross-fade. If it never arrives, nothing else happens.
 *  - A state with no recording: the generative score, and any recording fades out.
 * Intensity moves the recording's level and opens its low-pass; a combat state entered while intensity is
 * already high starts its recording past the introduction.
 *  - POLISH 4, `setMusic(state, fade, { once: true })`: the recording plays once, to the end of its file, and the
 *    state then holds a quiet bed (mapping.ts BED_*) — its own generative pads and held tones — until it changes.
 */
import { clamp } from '@/core/mathx';
import type { MusicOpts, MusicState } from '@/core/api';
import type { Mixer } from '../mixer';
import type { MusicEngine } from '../music/engine';
import { MUSIC } from '../music/defs';
import type { MusicDef } from '../music/types';
import type { AssetLibrary } from './library';
import { BED_DB, BED_FADE, BED_LAYERS, BED_LEAD, TRACKS, loopSpec, onceSpec, overlayDef, planGain, planTone, scorePlan, type ScorePlan, type TrackName } from './mapping';
import { TrackPlayer } from './player';

/** cross-fade when a recording arrives after its state has already begun (s) */
const ARRIVAL_FADE = 2.5;
/** a state entered at or above this intensity skips its recording's introduction (see TrackInfo.body) */
const HOT_ENTRY = 0.5;
/** intensity change worth re-aiming the level and filter for */
const INTENSITY_STEP = 0.01;

const defOf = (state: MusicState): MusicDef | null => (MUSIC as Record<string, MusicDef | undefined>)[state] ?? null;

export class RecordedScore {
  readonly player: TrackPlayer;
  private state: MusicState = 'silence';
  private plan: ScorePlan = scorePlan('silence');
  /** the recording that carries the current state right now (null: the generative score does) */
  private covering: TrackName | null = null;
  private applied = -1;
  /** POLISH 4: the current state was asked for with `once` */
  private once = false;
  /** POLISH 4: the once-played recording has ended and the bed is on */
  private bed = false;

  constructor(
    ac: BaseAudioContext,
    mixer: Mixer,
    private readonly music: MusicEngine,
    private readonly library: AssetLibrary | null,
  ) {
    this.player = new TrackPlayer(ac, mixer.musicDirect);
  }

  /** the recording heard for the current state, or null while the generative score plays */
  get track(): TrackName | null {
    return this.covering;
  }

  /** Change the music state (see AudioSystem.setMusic). */
  setState(state: MusicState, fadeSeconds = 2, opts?: MusicOpts): void {
    // (a script may assert its state every frame: only a change does anything)
    if (state === this.state) return;
    const fade = clamp(Number.isFinite(fadeSeconds) ? fadeSeconds : 2, 0.05, 30);
    const plan = scorePlan(state);
    this.state = state;
    this.plan = plan;
    this.once = opts?.once === true;
    this.bed = false;
    const lib = this.library;
    if (lib) {
      lib.pin([plan.track, plan.warm, this.covering]);
      if (plan.warm) void lib.requestTrack(plan.warm);
    }
    if (this.enter(fade)) return;
    // no recording (yet): the generative score carries the state
    const def = defOf(state);
    const at = this.music.setState(state, fade, plan.generativeDb && def ? { key: `gen:${plan.generativeDb}`, def, trimDb: plan.generativeDb } : null);
    this.player.stop(at, fade);
    this.covering = null;
    if (plan.track && lib) void lib.requestTrack(plan.track);
  }

  /** Put the plan's recording on if it is decoded. False = it is not available (now). */
  private enter(fade: number): boolean {
    const plan = this.plan;
    const lib = this.library;
    if (!plan.track || !lib) return false;
    const buffer = lib.track(plan.track);
    const meta = lib.trackMeta(plan.track);
    const def = defOf(this.state);
    if (!buffer || !meta || !def) return false;
    // (the audible intensity lags the one just asked for: either says the fight is on)
    const hot = Math.max(this.music.intensity, this.music.targetIntensity) >= HOT_ENTRY;
    const looped = loopSpec(plan.track, meta, plan.region, hot);
    if (!(looped.to - looped.from >= 1) || !(looped.to <= buffer.duration + 0.5)) return false;
    // (polish 4) played once: to the end of the file, then the bed (update)
    const loop = this.once ? onceSpec(looped, meta, buffer.duration) : looped;
    const at = this.music.setState(this.state, fade, {
      key: `rec:${plan.track}`, def: overlayDef(def, plan.generativeLayers), tonic: TRACKS[plan.track].tonic,
    });
    const i = this.music.intensity;
    this.player.play(`${plan.track}:${plan.region}${this.once ? ':once' : ''}`, buffer, loop, planGain(plan, loop, i), planTone(plan, i), at, fade);
    this.covering = plan.track;
    this.applied = i;
    lib.pin([plan.track, plan.warm]);
    return true;
  }

  /** Per-frame upkeep: late arrivals, intensity, loop scheduling, library housekeeping. */
  update(dt: number, lookahead: number): void {
    this.library?.tick(dt);
    if (this.plan.track && !this.covering) this.enter(ARRIVAL_FADE);
    if (this.covering && this.once && !this.bed) {
      // (polish 4) the once-played recording is about to end: its state's quiet bed comes in under the last of it
      const ac = this.player.ac;
      if (ac.currentTime >= this.player.endsAt - BED_LEAD) {
        this.bed = true;
        const def = defOf(this.state);
        const bed = def ? overlayDef(def, [...this.plan.generativeLayers, ...BED_LAYERS]) : null;
        if (bed) this.music.setState(this.state, BED_FADE, { key: `bed:${this.covering}`, def: bed, tonic: TRACKS[this.covering].tonic, trimDb: BED_DB });
      }
    }
    if (this.covering) {
      const i = this.music.intensity;
      if (Math.abs(i - this.applied) >= INTENSITY_STEP) {
        this.applied = i;
        const meta = this.library?.trackMeta(this.covering);
        if (meta) {
          // (once or looped: the level is set the same way, by the looped part's mean)
          const loop = loopSpec(this.covering, meta, this.plan.region);
          this.player.setLevel(planGain(this.plan, loop, i), planTone(this.plan, i));
        }
      }
    }
    this.player.update(Math.max(1, Number.isFinite(lookahead) ? lookahead : 0) + 0.5);
  }

  dispose(): void {
    this.player.dispose();
  }
}
