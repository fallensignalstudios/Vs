/**
 * Voice management for SFX: per-id rate limits and instance caps, a global voice budget with priority
 * stealing, positional strips (PannerNode + distance-aware reverb send) and sustaining loop voices.
 * Six drones firing at once thin out here instead of clipping the mix.
 */
import { clamp } from '@/core/mathx';
import type { LoopHandle, SfxOpts, Vec3Like } from '@/core/api';
import { Kit } from './synth/kit';
import type { Shared } from './synth/shared';
import type { Mixer } from './mixer';
import { dbToGain, type Recipe, type RecipeTable } from './sfx/recipe';

/** hard budget of simultaneous SFX voices (loops included) */
export const MAX_VOICES = 28;
const MAX_LOOPS = 14;
/** voices allowed to be mid steal-fade at once */
const STEAL_SLACK = 6;
const SCHEDULE_AHEAD = 0.004;

interface Voice {
  id: string;
  input: GainNode;
  pan: PannerNode | null;
  send: GainNode;
  /** absolute end time (Infinity while a loop sustains) */
  end: number;
  prio: number;
  kit: Kit;
  /** authored gain (before LoopHandle.setVolume) */
  base: number;
  /** loops built from one-shot recipes re-trigger at this period */
  retrig: { recipe: Recipe; next: number; period: number } | null;
  /** a loop that has been told to stop (handle calls become no-ops) */
  stopped: boolean;
  /** stolen: fading out over a few milliseconds, no longer counted against the budget */
  dying: boolean;
}

const finite = (v: Vec3Like | undefined): v is Vec3Like =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** No-op handle returned when a loop cannot start (budget, unknown id, audio locked). */
export const NULL_LOOP: LoopHandle = Object.freeze({
  setPosition(): void {},
  setVolume(): void {},
  setPitch(): void {},
  stop(): void {},
});

export class Voices {
  private readonly live: Voice[] = [];
  private readonly last = new Map<string, number>();
  private readonly warned = new Set<string>();
  private readonly lpos = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly mixer: Mixer,
    private readonly res: Shared,
    private readonly rnd: () => number,
    private readonly recipes: RecipeTable,
    private readonly norm: Readonly<Record<string, number>>,
  ) {}

  /** sounding voices (stolen voices in their last few milliseconds are not counted) */
  get count(): number {
    let n = 0;
    for (const v of this.live) if (!v.dying) n++;
    return n;
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

  private recipe(id: string): Recipe | null {
    if (this.has(id)) return this.recipes[id];
    if (!this.warned.has(id)) {
      this.warned.add(id);
      console.warn(`[audio] unknown sfx id "${id}" — ignored`);
    }
    return null;
  }

  private distance(p: Vec3Like): number {
    return Math.hypot(p.x - this.lpos.x, p.y - this.lpos.y, p.z - this.lpos.z);
  }

  /** Reverb send falls off more slowly than the direct path, so distant sources are mostly room. */
  private sendLevel(r: Recipe, pos: Vec3Like | undefined): number {
    if (!pos) return r.send;
    const d = this.distance(pos);
    return r.send * (1.6 / (1 + d / (r.ref * 5)));
  }

  private instances(id: string, now: number): number {
    let n = 0;
    for (const v of this.live) if (v.id === id && v.end > now && !v.dying) n++;
    return n;
  }

  /** Free finished voices. */
  sweep(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i];
      if (v.end <= now) {
        v.input.disconnect();
        v.send.disconnect();
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

  private strip(id: string, r: Recipe, opts: SfxOpts | undefined, t0: number, sustain: boolean, crowd: number): Voice {
    const ac = this.ac;
    const pos = finite(opts?.pos) ? opts.pos : undefined;
    const vol = clamp(Number.isFinite(opts?.volume) ? (opts!.volume as number) : 1, 0, 4);
    // several instances of one id share the loudness of ~one and a half
    const base = (this.norm[id] ?? 1) * dbToGain(r.db) * vol * (1 / Math.sqrt(1 + 0.7 * crowd)) * (1 + (this.rnd() - 0.5) * 0.12);
    const input = ac.createGain();
    input.gain.value = base;
    const bus = r.bus === 'ui' ? this.mixer.ui : this.mixer.sfx;
    let pan: PannerNode | null = null;
    if (pos && r.bus !== 'ui') {
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
    const send = ac.createGain();
    send.gain.value = this.sendLevel(r, pos);
    input.connect(send);
    send.connect(r.bus === 'ui' ? this.mixer.reverbIn : this.mixer.sfxSend);

    const cents = r.vary > 0 ? (this.rnd() * 2 - 1) * r.vary : 0;
    const pitch = clamp(Number.isFinite(opts?.pitch) ? (opts!.pitch as number) : 1, 0.25, 4) * Math.pow(2, cents / 1200);
    const kit = new Kit(ac, this.res, input, t0, pitch, this.rnd, sustain);
    return { id, input, pan, send, end: t0, prio: r.prio, kit, base, retrig: null, stopped: false, dying: false };
  }

  /** Play a one-shot. Returns its scheduled length in seconds (0 if it was limited or unknown). */
  play(id: string, opts?: SfxOpts): number {
    const r = this.recipe(id);
    if (!r) return 0;
    const now = this.ac.currentTime;
    const delay = clamp(Number.isFinite(opts?.delay) ? (opts!.delay as number) : 0, 0, 30);
    const t0 = now + delay + SCHEDULE_AHEAD;
    const last = this.last.get(id);
    if (last !== undefined && t0 - last < r.gap && t0 >= last) return 0;
    this.sweep(now);
    const crowd = this.instances(id, now);
    if (crowd >= r.max) return 0;
    if (!this.reserve(r.prio, now)) return 0;
    this.last.set(id, t0);

    const v = this.strip(id, r, opts, t0, false, crowd);
    r.make(v.kit);
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

  /** Start a sustaining voice. One-shot recipes are re-triggered end-to-end. */
  loop(id: string, opts?: SfxOpts): LoopHandle {
    const r = this.recipe(id);
    if (!r) return NULL_LOOP;
    const now = this.ac.currentTime;
    this.sweep(now);
    let loops = 0;
    for (const v of this.live) if (v.end === Infinity) loops++;
    if (loops >= MAX_LOOPS || this.instances(id, now) >= Math.max(r.max, 1) || !this.reserve(Math.max(r.prio, 1), now)) return NULL_LOOP;

    const t0 = now + SCHEDULE_AHEAD;
    const v = this.strip(id, r, opts, t0, r.loop, this.instances(id, now));
    r.make(v.kit);
    if (!r.loop) {
      v.kit.seal();
      const period = Math.max(0.12, v.kit.end + 0.05);
      v.retrig = { recipe: r, next: t0 + period, period };
    }
    v.end = Infinity;
    this.live.push(v);
    return this.handle(v);
  }

  private handle(v: Voice): LoopHandle {
    const ac = this.ac;
    return {
      setPosition: (p: Vec3Like): void => {
        if (v.stopped || !v.pan || !finite(p)) return;
        const t = ac.currentTime;
        v.pan.positionX.setTargetAtTime(p.x, t, 0.03);
        v.pan.positionY.setTargetAtTime(p.y, t, 0.03);
        v.pan.positionZ.setTargetAtTime(p.z, t, 0.03);
      },
      setVolume: (vol: number, fadeSeconds = 0.1): void => {
        if (v.stopped || !Number.isFinite(vol)) return;
        v.input.gain.setTargetAtTime(v.base * clamp(vol, 0, 4), ac.currentTime, Math.max(0.005, fadeSeconds) / 3);
      },
      setPitch: (p: number): void => {
        if (v.stopped || !Number.isFinite(p)) return;
        const m = clamp(p, 0.25, 4);
        for (const q of v.kit.pitched) q.p.setTargetAtTime(q.base * m, ac.currentTime, 0.04);
      },
      stop: (fadeSeconds = 0.25): void => this.stopVoice(v, Number.isFinite(fadeSeconds) ? fadeSeconds : 0.25),
    };
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

  /** Per-tick upkeep: free finished voices, keep re-triggered loops fed. */
  update(lookahead: number): void {
    const now = this.ac.currentTime;
    this.sweep(now);
    for (const v of this.live) {
      const rt = v.retrig;
      if (!rt) continue;
      if (rt.next < now) rt.next = now + SCHEDULE_AHEAD;
      while (rt.next < now + lookahead) {
        const vary = rt.recipe.vary > 0 ? Math.pow(2, ((this.rnd() * 2 - 1) * rt.recipe.vary) / 1200) : 1;
        const k = v.kit.fork(v.input, rt.next, v.kit.pitch * vary);
        rt.recipe.make(k);
        k.seal();
        rt.next += rt.period;
      }
    }
  }

  /** Stop every loop (zone unload). One-shots are left to ring out. */
  stopLoops(fadeSeconds = 0.35): void {
    for (const v of this.live) if (v.end === Infinity) this.stopVoice(v, fadeSeconds);
  }
}
