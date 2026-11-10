/**
 * Voice management for SFX: per-id rate limits and instance caps, a global voice budget with priority
 * stealing, positional strips (PannerNode + distance-aware reverb sends) and sustaining loops.
 * Six drones firing at once thin out here instead of clipping the mix.
 *
 * A voice is filled from the sample bank when the id has a pre-rendered or registered buffer (one source
 * node), and synthesised live from its recipe otherwise.
 *
 * Loops are *slots*: a slot always exists once requested and remembers its position / volume / pitch; it is
 * given a sounding voice while it is among the nearest that fit the caps and is silent ("virtual") otherwise.
 * Nothing a zone asked for is ever dropped for good — a hum that lost its voice gets it back when one frees.
 */
import { clamp, hashString, mulberry32 } from '@/core/mathx';
import type { LoopHandle, SfxOpts, Vec3Like } from '@/core/api';
import { Kit } from './synth/kit';
import type { Shared } from './synth/shared';
import { measureLoudness } from './synth/loudness';
import type { SampleBank, SampleOpts } from './synth/samples';
import type { Mixer } from './mixer';
import { dbToGain, loudnessTarget, peakCeiling, type Recipe, type RecipeTable } from './sfx/recipe';

/** hard budget of simultaneous SFX voices (loops included) */
export const MAX_VOICES = 28;
/** loops that may sound at once; further slots wait, silent, for one to free */
export const MAX_LOOPS = 14;
/** loop slots a zone may hold open */
export const MAX_LOOP_SLOTS = 64;
/** voices allowed to be mid steal-fade at once */
const STEAL_SLACK = 6;
const SCHEDULE_AHEAD = 0.004;
/** how often the loop slots are re-ranked by distance (s) */
const LOOP_REVIEW = 0.25;

/** Mix metadata for an id that exists only as a registered recording. */
const SAMPLE_ONLY: Omit<Recipe, 'make'> = { db: -14, gap: 0.05, max: 2, prio: 2, bus: 'sfx', send: 0.2, ref: 4, vary: 0, loop: false, tail: 0.4, exact: true, bake: 0 };

interface Voice {
  id: string;
  input: GainNode;
  pan: PannerNode | null;
  sends: GainNode[];
  /** absolute end time (Infinity while a loop sustains) */
  end: number;
  prio: number;
  kit: Kit;
  /** authored gain (before LoopHandle.setVolume) */
  base: number;
  /** loops built from one-shots re-trigger at this period */
  retrig: { recipe: Recipe; next: number; period: number } | null;
  /** LoopHandle.setPitch value, applied to re-triggers */
  pitchMul: number;
  /** a loop that has been told to stop: fading, no longer counted as a loop or as an instance of its id */
  stopped: boolean;
  /** stolen: fading out over a few milliseconds, no longer counted against the budget */
  dying: boolean;
}

const finite = (v: Vec3Like | undefined | null): v is Vec3Like =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** No-op handle returned when a loop can never exist (unknown id, muted, slot table full). */
export const NULL_LOOP: LoopHandle = Object.freeze({
  setPosition(): void {},
  setVolume(): void {},
  setPitch(): void {},
  stop(): void {},
});

/** A requested loop. Sounding while `voice` is set, virtual otherwise. */
class LoopSlot implements LoopHandle {
  voice: Voice | null = null;
  stopped = false;
  volume = 1;
  pitch = 1;
  readonly pos: { x: number; y: number; z: number } | null;
  readonly authoredVolume: number;
  readonly authoredPitch: number;

  constructor(private readonly owner: Voices, readonly id: string, readonly recipe: Recipe, opts: SfxOpts | undefined) {
    this.pos = finite(opts?.pos) ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : null;
    this.authoredVolume = clamp(Number.isFinite(opts?.volume) ? (opts!.volume as number) : 1, 0, 4);
    this.authoredPitch = clamp(Number.isFinite(opts?.pitch) ? (opts!.pitch as number) : 1, 0.25, 4);
  }

  setPosition(p: Vec3Like): void {
    if (this.stopped || !this.pos || !finite(p)) return;
    this.pos.x = p.x;
    this.pos.y = p.y;
    this.pos.z = p.z;
    this.owner.moveVoice(this.voice, p);
  }

  setVolume(v: number, fadeSeconds = 0.1): void {
    if (this.stopped || !Number.isFinite(v)) return;
    this.volume = clamp(v, 0, 4);
    this.owner.levelVoice(this.voice, this.volume, Number.isFinite(fadeSeconds) ? fadeSeconds : 0.1);
  }

  setPitch(p: number): void {
    if (this.stopped || !Number.isFinite(p)) return;
    this.pitch = clamp(p, 0.25, 4);
    this.owner.pitchVoice(this.voice, this.pitch);
  }

  stop(fadeSeconds = 0.25): void {
    if (this.stopped) return;
    this.stopped = true;
    this.owner.releaseSlot(this, Number.isFinite(fadeSeconds) ? fadeSeconds : 0.25);
  }
}

export class Voices {
  private readonly live: Voice[] = [];
  private readonly slots: LoopSlot[] = [];
  private readonly last = new Map<string, number>();
  private readonly warned = new Set<string>();
  private readonly lpos = { x: 0, y: 0, z: 0 };
  private loopsDirty = false;
  private nextReview = 0;

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly mixer: Mixer,
    private readonly res: Shared,
    private readonly rnd: () => number,
    private readonly recipes: RecipeTable,
    private readonly norm: Readonly<Record<string, number>>,
    private readonly samples: SampleBank,
  ) {}

  /** sounding voices (stolen voices in their last few milliseconds are not counted) */
  get count(): number {
    let n = 0;
    for (const v of this.live) if (!v.dying) n++;
    return n;
  }

  /** loops currently sounding / requested (sounding + virtual) */
  get loopCounts(): { sounding: number; requested: number } {
    let sounding = 0;
    for (const s of this.slots) if (s.voice) sounding++;
    return { sounding, requested: this.slots.length };
  }

  has(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.recipes, id);
  }

  setListener(pos: Vec3Like, forward: Vec3Like): void {
    if (!finite(pos)) return;
    this.lpos.x = pos.x;
    this.lpos.y = pos.y;
    this.lpos.z = pos.z;
    const l = this.ac.listener;
    const hasFwd = finite(forward) && Math.abs(forward.x) + Math.abs(forward.y) + Math.abs(forward.z) > 1e-6;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      if (hasFwd) {
        l.forwardX.value = forward.x;
        l.forwardY.value = forward.y;
        l.forwardZ.value = forward.z;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      }
    } else {
      // older Safari / Firefox
      l.setPosition(pos.x, pos.y, pos.z);
      if (hasFwd) l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /**
   * Register a recording for an id (see AudioEngine.registerSample). Its level is matched to the id's
   * authored `db` by the same rule the calibration uses, so a recording drops into the mix where the
   * procedural sound sat.
   */
  registerSample(id: string, buffer: AudioBuffer, opts: SampleOpts = {}): void {
    const r = this.has(id) ? this.recipes[id] : SAMPLE_ONLY;
    const chans: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const m = measureLoudness(chans, buffer.sampleRate);
    if (m.peakDb < -90) return; // silent buffer: keep the procedural sound
    const auto = dbToGain(Math.min(loudnessTarget(r.db) - m.loudDb, peakCeiling(r.db) - m.peakDb));
    const user = typeof opts.gain === 'number' && Number.isFinite(opts.gain) ? clamp(opts.gain, 0, 8) : 1;
    // strip() multiplies by norm × dbToGain(db); a recording needs neither, so both are divided out here
    const gain = (auto * user) / ((this.norm[id] ?? 1) * dbToGain(r.db));
    this.samples.register(id, buffer, { gain, loop: opts.loop }, r.loop);
  }

  private recipe(id: string): Recipe | null {
    if (this.has(id)) return this.recipes[id];
    if (this.samples.isRegistered(id)) return SAMPLE_ONLY as Recipe;
    if (!this.warned.has(id)) {
      this.warned.add(id);
      console.warn(`[audio] unknown sfx id "${id}" — ignored`);
    }
    return null;
  }

  private distance(p: Vec3Like): number {
    return Math.hypot(p.x - this.lpos.x, p.y - this.lpos.y, p.z - this.lpos.z);
  }

  /**
   * Reverb send. Inside a few reference distances a positional voice sends exactly what the same cue would
   * non-positionally; beyond that the send falls more slowly than the direct path, so distant sources are
   * mostly room.
   */
  private sendLevel(r: Recipe, pos: Vec3Like | undefined): number {
    if (!pos) return r.send;
    return r.send * Math.min(1, 1.6 / (1 + this.distance(pos) / (r.ref * 5)));
  }

  /** sounding instances of an id (a stopped loop fading out is not one) */
  private instances(id: string, now: number): number {
    let n = 0;
    for (const v of this.live) if (v.id === id && v.end > now && !v.dying && !v.stopped) n++;
    return n;
  }

  /** Free finished voices. */
  sweep(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i];
      if (v.end <= now) {
        v.input.disconnect();
        for (const s of v.sends) s.disconnect();
        v.pan?.disconnect();
        this.live.splice(i, 1);
      }
    }
  }

  /** Make room for a voice of priority `prio`. Returns false if the newcomer should be dropped instead. */
  private reserve(prio: number, now: number): boolean {
    const sounding = this.count;
    if (sounding < MAX_VOICES) return true;
    // a burst inside one steal-fade cannot pile up unbounded either
    if (this.live.length - sounding >= STEAL_SLACK) return false;
    let victim: Voice | null = null;
    for (const v of this.live) {
      if (v.dying || v.end === Infinity || v.end <= now) continue;
      if (v.prio > prio) continue;
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.end < victim.end)) victim = v;
    }
    if (!victim) return false;
    victim.input.gain.cancelScheduledValues(now);
    victim.input.gain.setTargetAtTime(0, now, 0.006);
    victim.end = now + 0.04;
    victim.dying = true;
    return true;
  }

  private strip(id: string, r: Recipe, pos: Vec3Like | undefined, volume: number, pitch: number, t0: number, sustain: boolean, crowd: number): Voice {
    const ac = this.ac;
    // several instances of one id share the loudness of ~one and a half; exact ids get no level jitter
    const jitter = r.exact ? 1 : 1 + (this.rnd() - 0.5) * 0.12;
    const base = (this.norm[id] ?? 1) * dbToGain(r.db) * volume * (1 / Math.sqrt(1 + 0.7 * crowd)) * jitter;
    const input = ac.createGain();
    input.gain.value = base;
    const ui = r.bus === 'ui';
    const bus = ui ? this.mixer.ui : this.mixer.sfx;
    let pan: PannerNode | null = null;
    if (pos && !ui) {
      pan = ac.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = r.ref;
      pan.rolloffFactor = 1;
      pan.maxDistance = 10000;
      pan.positionX.value = pos.x;
      pan.positionY.value = pos.y;
      pan.positionZ.value = pos.z;
      input.connect(pan);
      pan.connect(bus);
    } else {
      input.connect(bus);
    }
    const sends: GainNode[] = [];
    const send = (level: number, to: AudioNode): void => {
      if (level <= 0.001) return;
      const s = ac.createGain();
      s.gain.value = level;
      input.connect(s);
      s.connect(to);
      sends.push(s);
    };
    const level = this.sendLevel(r, pos);
    if (ui) {
      send(level, this.mixer.uiSend);
    } else {
      send(level * r.tail, this.mixer.room);
      send(level * (1 - r.tail), this.mixer.near);
    }

    const cents = r.vary > 0 && !r.exact ? (this.rnd() * 2 - 1) * r.vary : 0;
    // an exact id draws the same "random" numbers on every play
    const rnd = r.exact ? mulberry32(hashString(id)) : this.rnd;
    const kit = new Kit(ac, this.res, input, t0, pitch * Math.pow(2, cents / 1200), rnd, sustain);
    return { id, input, pan, sends, end: t0, prio: r.prio, kit, base, retrig: null, pitchMul: 1, stopped: false, dying: false };
  }

  /** Fill a kit with one instance of an id: a buffer when the bank has one, the live recipe otherwise. */
  private fill(id: string, r: Recipe, k: Kit): void {
    const s = this.samples.pick(id, this.rnd);
    // a pre-rendered LOOP is the steady state only: a one-shot excerpt of that id still needs the recipe's envelope
    if (s && !(s.loop && this.has(id) && !this.samples.isRegistered(id))) k.sample(s.buffer, { g: s.gain });
    else r.make(k);
  }

  /** Play a one-shot. Returns its scheduled length in seconds (0 if it was limited or unknown). */
  play(id: string, opts?: SfxOpts): number {
    const r = this.recipe(id);
    if (!r) return 0;
    const now = this.ac.currentTime;
    const delay = clamp(Number.isFinite(opts?.delay) ? (opts!.delay as number) : 0, 0, 30);
    // (never before the mix chain has settled: the very first sound of a session is at most 70 ms late)
    const t0 = Math.max(now + delay + SCHEDULE_AHEAD, this.mixer.readyAt);
    const last = this.last.get(id);
    if (last !== undefined && t0 - last < r.gap && t0 >= last) return 0;
    this.sweep(now);
    const crowd = this.instances(id, now);
    if (crowd >= r.max) return 0;
    if (!this.reserve(r.prio, now)) return 0;
    this.last.set(id, t0);

    const pos = finite(opts?.pos) ? opts.pos : undefined;
    const volume = clamp(Number.isFinite(opts?.volume) ? (opts!.volume as number) : 1, 0, 4);
    const pitch = clamp(Number.isFinite(opts?.pitch) ? (opts!.pitch as number) : 1, 0.25, 4);
    const v = this.strip(id, r, pos, volume, pitch, t0, false, crowd);
    this.fill(id, r, v.kit);
    v.kit.seal();
    v.end = t0 + v.kit.end + 0.08;
    this.live.push(v);
    return v.kit.end;
  }

  /** Place a one-shot at a random bearing `dist` metres from the listener (ambience events). */
  playAround(id: string, dist: number, volume: number): number {
    const a = this.rnd() * Math.PI * 2;
    const pos = { x: this.lpos.x + Math.cos(a) * dist, y: this.lpos.y + this.rnd() * dist * 0.2, z: this.lpos.z + Math.sin(a) * dist };
    return this.play(id, { pos, volume });
  }

  // -----------------------------------------------------------------------------------------------
  // loops
  // -----------------------------------------------------------------------------------------------

  /**
   * Request a sustaining loop. The handle is live at once; whether it is *sounding* is decided here and on
   * every update() — nearest first, within the per-id and global caps.
   */
  loop(id: string, opts?: SfxOpts): LoopHandle {
    const r = this.recipe(id);
    if (!r) return NULL_LOOP;
    if (this.slots.length >= MAX_LOOP_SLOTS) {
      if (!this.warned.has('#slots')) {
        this.warned.add('#slots');
        console.warn(`[audio] more than ${MAX_LOOP_SLOTS} loops requested — the rest are ignored (stop() the ones you no longer need)`);
      }
      return NULL_LOOP;
    }
    const slot = new LoopSlot(this, id, r, opts);
    this.slots.push(slot);
    this.assignLoops(this.ac.currentTime);
    return slot;
  }

  private slotDistance(s: LoopSlot): number {
    return s.pos ? this.distance(s.pos) : 0;
  }

  /** Give voices to the best slots, take them from the rest. */
  private assignLoops(now: number): void {
    this.loopsDirty = false;
    this.nextReview = now + LOOP_REVIEW;
    if (!this.slots.length) return;
    this.sweep(now);
    // rank: priority first, then distance; a slot that is already sounding is favoured so two hums at
    // nearly the same range do not trade places every review
    const key = (s: LoopSlot): number => this.slotDistance(s) * (s.voice ? 0.85 : 1) - (s.voice ? 1 : 0) - Math.max(s.recipe.prio, 1) * 1000;
    const ranked = [...this.slots].sort((a, b) => key(a) - key(b));
    const perId = new Map<string, number>();
    const chosen = new Set<LoopSlot>();
    for (const s of ranked) {
      if (chosen.size >= MAX_LOOPS) break;
      const n = perId.get(s.id) ?? 0;
      if (n >= Math.max(s.recipe.max, 1)) continue;
      perId.set(s.id, n + 1);
      chosen.add(s);
    }
    // release first so the newcomers find their voices free
    for (const s of this.slots) {
      if (s.voice && !chosen.has(s)) {
        this.stopVoice(s.voice, 0.3);
        s.voice = null;
      }
    }
    for (const s of ranked) if (!s.voice && chosen.has(s)) this.startSlot(s, now);
  }

  private startSlot(s: LoopSlot, now: number): void {
    const r = s.recipe;
    if (!this.reserve(Math.max(r.prio, 1), now)) return; // budget full of higher-priority voices: stay virtual
    const t0 = now + SCHEDULE_AHEAD;
    const sample = this.samples.pick(s.id, this.rnd);
    const sustains = sample ? sample.loop : r.loop;
    const v = this.strip(s.id, r, s.pos ?? undefined, s.authoredVolume, s.authoredPitch, t0, sustains, this.instances(s.id, now));
    // every voice of a loop starts somewhere else in it (two drones never phase-lock) — except the Eclipse
    if (sample) v.kit.sample(sample.buffer, { g: sample.gain, loop: sample.loop, fadeIn: 0.3, offset: r.exact ? 0 : this.rnd() * sample.buffer.duration });
    else r.make(v.kit);
    if (!sustains) {
      // a one-shot under loop(): re-trigger it end to end
      v.kit.seal();
      const period = Math.max(0.12, v.kit.end + 0.05);
      v.retrig = { recipe: r, next: t0 + period, period };
    }
    v.end = Infinity;
    this.live.push(v);
    s.voice = v;
    if (s.volume !== 1) this.levelVoice(v, s.volume, 0.01);
    if (s.pitch !== 1) this.pitchVoice(v, s.pitch);
  }

  /** LoopSlot → engine: the handle's setters, applied to whatever voice the slot currently has. */
  moveVoice(v: Voice | null, p: Vec3Like): void {
    if (!v || v.stopped || !v.pan) return;
    const t = this.ac.currentTime;
    v.pan.positionX.setTargetAtTime(p.x, t, 0.03);
    v.pan.positionY.setTargetAtTime(p.y, t, 0.03);
    v.pan.positionZ.setTargetAtTime(p.z, t, 0.03);
  }

  levelVoice(v: Voice | null, volume: number, fadeSeconds: number): void {
    if (!v || v.stopped) return;
    v.input.gain.setTargetAtTime(v.base * volume, this.ac.currentTime, clamp(fadeSeconds, 0.005, 30) / 3);
  }

  pitchVoice(v: Voice | null, pitch: number): void {
    if (!v || v.stopped) return;
    v.pitchMul = pitch;
    for (const q of v.kit.pitched) q.p.setTargetAtTime(q.base * pitch, this.ac.currentTime, 0.04);
  }

  releaseSlot(s: LoopSlot, fadeSeconds: number): void {
    if (s.voice) this.stopVoice(s.voice, fadeSeconds);
    s.voice = null;
    const i = this.slots.indexOf(s);
    if (i >= 0) this.slots.splice(i, 1);
    this.loopsDirty = true; // a waiting slot may take the freed voice on the next update
  }

  private stopVoice(v: Voice, fadeSeconds: number): void {
    if (v.stopped) return;
    v.stopped = true;
    const t = this.ac.currentTime;
    const f = clamp(fadeSeconds, 0.01, 10);
    v.input.gain.cancelScheduledValues(t);
    v.input.gain.setTargetAtTime(0, t, f / 4);
    v.kit.stopAll(t + f + 0.05);
    v.retrig = null;
    v.end = t + f + 0.1;
  }

  /** Per-tick upkeep: free finished voices, re-rank loop slots, keep re-triggered loops fed. */
  update(lookahead: number): void {
    const now = this.ac.currentTime;
    this.sweep(now);
    if (this.slots.length && (this.loopsDirty || now >= this.nextReview)) this.assignLoops(now);
    for (const v of this.live) {
      const rt = v.retrig;
      if (!rt) continue;
      if (rt.next < now) rt.next = now + SCHEDULE_AHEAD;
      while (rt.next < now + lookahead) {
        const exact = rt.recipe.exact;
        const vary = rt.recipe.vary > 0 && !exact ? Math.pow(2, ((this.rnd() * 2 - 1) * rt.recipe.vary) / 1200) : 1;
        const k = new Kit(this.ac, this.res, v.input, rt.next, v.kit.pitch * vary * v.pitchMul, exact ? mulberry32(hashString(v.id)) : this.rnd, false);
        this.fill(v.id, rt.recipe, k);
        k.seal();
        rt.next += rt.period;
      }
    }
  }

  /** Stop every loop (zone unload). One-shots are left to ring out. */
  stopLoops(fadeSeconds = 0.35): void {
    for (const s of [...this.slots]) s.stop(fadeSeconds);
  }
}
