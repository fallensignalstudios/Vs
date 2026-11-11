/**
 * Audio subsystem façade — implements the AudioSystem contract over an AudioEngine.
 *
 * Browser concerns live here: the AudioContext only exists after `unlock()` (a user gesture), so until then
 * every call is a silent no-op that merely *remembers* the requested music / ambience / mix / cadence state,
 * loops and registered recordings, and applies them the moment audio becomes available. With no WebAudio
 * (node, old browsers) or `?mute`, it stays silent forever and never throws.
 */
import { clamp01 } from '@/core/mathx';
import { ZONE_ORDER } from '@/core/api/common';
import { isStub } from '@/core/stub';
import type {
  AmbienceId, AudioDebugInfo, AudioSampleOpts, AudioSystem, Game, LoopHandle, MusicState, SfxId, SfxOpts, Vec3Like, VoiceOpts,
} from '@/core/api';
import { AudioEngine } from './engine';
import { forgetPrerender, prerender } from './prerender';
import { forgetShared, makeShared } from './synth/shared';
import { MAX_LOOP_SLOTS, NULL_LOOP } from './voices';
import type { Volumes } from './mixer';
import type { StingerKind } from './music/engine';
import { MUSIC } from './music/defs';
import { AMBIENCE } from './ambience/defs';
import { wireEvents } from './wiring';
import { AssetLibrary } from './assets/library';
import { scorePlan } from './assets/mapping';
import { preloadLines } from './assets/voice';

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

/**
 * The sample rate the boot-time preparation falls back on when the device will not say. Only ever one rate:
 * the pre-rendered set is tens of megabytes, and a second, speculative copy is not worth it.
 */
const PREWARM_RATES = [48000] as const;
/** gestures that can unlock audio (which of them counts as a user activation differs between browsers) */
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;

/**
 * A loop handle that outlives the lack of an AudioContext: it remembers what was asked for and hands it to
 * the engine once audio is unlocked (a zone can build its device hums before the first user gesture). From
 * then on the engine's own loop slot decides when it actually sounds (nearest first, within the caps).
 */
class DeferredLoop implements LoopHandle {
  real: LoopHandle | null = null;
  stopped = false;
  private volume = 1;
  private pitch = 1;
  private readonly opts: SfxOpts;

  constructor(readonly id: SfxId, opts: SfxOpts | undefined, private readonly forget: (l: DeferredLoop) => void) {
    const p = opts?.pos;
    this.opts = { ...opts, pos: p ? { x: p.x, y: p.y, z: p.z } : undefined };
  }

  /** Start on a live engine, applying everything requested so far. */
  start(engine: AudioEngine): void {
    if (this.stopped || this.real) return;
    this.real = engine.loop(this.id, this.opts);
    if (this.volume !== 1) this.real.setVolume(this.volume, 0.01);
    if (this.pitch !== 1) this.real.setPitch(this.pitch);
  }

  setPosition(p: Vec3Like): void {
    if (this.stopped || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    if (this.opts.pos) this.opts.pos = { x: p.x, y: p.y, z: p.z };
    this.real?.setPosition(p);
  }

  setVolume(v: number, fadeSeconds?: number): void {
    if (this.stopped || !Number.isFinite(v)) return;
    this.volume = v;
    this.real?.setVolume(v, Number.isFinite(fadeSeconds) ? fadeSeconds : undefined);
  }

  setPitch(p: number): void {
    if (this.stopped || !Number.isFinite(p)) return;
    this.pitch = p;
    this.real?.setPitch(p);
  }

  stop(fadeSeconds?: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.real?.stop(Number.isFinite(fadeSeconds) ? fadeSeconds : undefined);
    this.real = null;
    this.forget(this);
  }
}

/** Site base the assets are served under ('/' in dev, './' beside index.html in the build). */
function baseUrl(): string {
  try {
    return (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  } catch {
    return '/';
  }
}

function contextCtor(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

type Target = { addEventListener?: (t: string, f: () => void, o?: unknown) => void; removeEventListener?: (t: string, f: () => void, o?: unknown) => void };

class AudioSystemImpl implements AudioSystem {
  private engine: AudioEngine | null = null;
  private ctx: AudioContext | null = null;
  private failed = false;
  private disposed = false;
  private readonly failures = new Map<string, number>();
  private readonly warned = new Set<string>();
  private readonly loops = new Set<DeferredLoop>();
  private readonly pendingSamples: Array<{ id: string; buffer: AudioBuffer; opts?: AudioSampleOpts }> = [];
  private readonly cleanup: Array<() => void> = [];
  private gestureOff: (() => void) | null = null;
  /** frames after unlock() during which a still-resuming context may be scheduled on */
  private graceFrames = 0;
  /** sample rates the boot-time preparation was done for */
  private readonly prewarmed: number[] = [];
  /** recorded score + voice-over clips (null: muted, or no WebAudio to play them with) */
  private readonly library: AssetLibrary | null;
  /** lends its decoder to the library until the real context exists */
  private offline: BaseAudioContext | null = null;

  // requested state (applied on unlock, and reported by the getters while there is no engine)
  private wantMusic: MusicState = 'silence';
  private wantAmbience: AmbienceId = 'none';
  private wantIntensity = 0;
  private wantMuffle = 0;
  private wantResolved = false;
  /** cadence irregularity asked for before audio existed (null = never asked) */
  private wantIrregular: number | null = null;
  private paused = false;
  private lead: 'tarrik' | 'selene' = 'tarrik';
  private readonly lpos = { x: 0, y: 0, z: 0 };
  private readonly lfwd = { x: 0, y: 0, z: -1 };

  constructor(private readonly game: Game) {
    this.library = game.flags.mute || !contextCtor() ? null : new AssetLibrary({ baseUrl: baseUrl(), decoder: () => this.decoder() });
    // The voice manifest is read at boot, always: a line spoken before it has loaded could not be voiced.
    // (The score is not fetched in manual/headless mode until something actually asks for it.)
    if (this.library) {
      void this.library.loadVoices();
      if (!game.flags.manual) void this.library.loadMusic();
    }
    this.cleanup.push(...wireEvents(game, this));
    // Browsers only allow audio after a gesture: the first key or pointer press anywhere unlocks, so the title
    // screen already has its music by the time a menu button is chosen. Not every such event is a user
    // activation everywhere (Esc, a touch pointerdown), so the listeners stay until the context really runs.
    const w = globalThis as unknown as Target;
    if (typeof w.addEventListener === 'function' && typeof w.removeEventListener === 'function' && !game.flags.mute) {
      const onGesture = (): void => {
        this.unlock();
        if (this.ctx?.state === 'running' || this.failed) this.gestureOff?.();
      };
      for (const t of UNLOCK_EVENTS) w.addEventListener(t, onGesture, true);
      this.gestureOff = (): void => {
        for (const t of UNLOCK_EVENTS) w.removeEventListener?.(t, onGesture, true);
        this.gestureOff = null;
      };
    }
    // (not in manual/headless mode: there the page is stepped by a test and nothing will be listened to)
    if (!game.flags.mute && !game.flags.manual) this.prewarm();
    const doc = (globalThis as unknown as { document?: Document }).document;
    if (doc && typeof doc.addEventListener === 'function') {
      const onVisibility = (): void => {
        // a hidden tab stops calling update(): suspend rather than let the sustained layers drone on alone
        if (!this.ctx) return;
        if (doc.hidden) void this.ctx.suspend().catch(() => undefined);
        else void this.ctx.resume().catch(() => undefined);
      };
      doc.addEventListener('visibilitychange', onVisibility);
      this.cleanup.push(() => doc.removeEventListener('visibilitychange', onVisibility));
    }
  }

  /**
   * Everything that can be prepared without an AudioContext is prepared while the game boots: the noise
   * buffers and room impulses, and the pre-render of frequent sounds (OfflineAudioContext needs no user
   * gesture). It is done for the device's own sample rate, read from a context that is opened and closed
   * again without ever running; if that fails, for the rate most outputs use. Should the real context still
   * come up at another rate, the boot-time set is dropped at unlock and the work happens then, as it would
   * have anyway. With this, the first click after loading builds a mixer and nothing else — and what it
   * plays is already pre-rendered.
   */
  private prewarm(): void {
    type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
    const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
    const Offline = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
    const AC = contextCtor();
    if (!Offline || !AC) return;
    // Ask the device for its rate with a context that is closed again at once (it never runs: no gesture yet).
    // Without an answer, bet on the most common rate.
    const rates: number[] = [...PREWARM_RATES];
    try {
      const probe = new AC();
      if (probe.sampleRate >= 8000 && probe.sampleRate <= 192000) rates[0] = probe.sampleRate;
      void probe.close().catch(() => undefined);
    } catch {
      /* no context before a gesture here: keep the bet */
    }
    let chain: Promise<unknown> = Promise.resolve();
    for (const rate of rates) {
      // one after the other: the second must not compete with the first for the cores the game is loading on
      chain = chain.then(() => {
        if (this.ctx || this.disposed) return undefined; // unlocked meanwhile: unlock() does what is still needed
        try {
          const shared = makeShared(new Offline(1, 1, rate));
          this.prewarmed.push(rate);
          return prerender(rate, shared.waves);
        } catch {
          return undefined; // no offline rendering at that rate here
        }
      });
    }
  }

  /** A context the asset library can decode with: the live one, or — before the first gesture — an offline one. */
  private decoder(): BaseAudioContext | null {
    if (this.ctx) return this.ctx;
    if (this.failed || this.disposed) return null;
    if (!this.offline) {
      type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
      const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
      const Offline = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
      if (!Offline) return null;
      try {
        this.offline = new Offline(2, 1, PREWARM_RATES[0]);
      } catch {
        return null;
      }
    }
    return this.offline;
  }

  /**
   * Run an engine call; any failure is swallowed (audio must never take the mission down) and reported — the
   * first time, and again every few hundred repeats so a persistent fault stays visible.
   * `live` = only while the context is actually running: one-shots scheduled on a suspended context would all
   * fire together the moment it resumed. (The few frames right after unlock() are let through, so the very
   * click that unlocked audio still gets its own UI sound once resume() lands.)
   */
  private run(what: string, fn: (e: AudioEngine) => void, live = false): void {
    const e = this.engine;
    if (!e || (live && this.ctx?.state !== 'running' && this.graceFrames <= 0)) return;
    try {
      fn(e);
    } catch (err) {
      const n = (this.failures.get(what) ?? 0) + 1;
      this.failures.set(what, n);
      if (n === 1 || n % 300 === 0) console.warn(`[audio] ${what} failed${n > 1 ? ` (${n} times)` : ''}:`, err);
    }
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  private volumes(): Volumes {
    const s = this.game.settings;
    return { master: s.get('masterVolume'), music: s.get('musicVolume'), sfx: s.get('sfxVolume') };
  }

  // ---------------------------------------------------------------------------------------------

  get unlocked(): boolean {
    return this.engine !== null && this.ctx !== null && this.ctx.state === 'running';
  }

  unlock(): void {
    if (this.failed || this.disposed || this.game.flags.mute) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const AC = contextCtor();
    if (!AC) {
      this.failed = true;
      return;
    }
    try {
      this.graceFrames = 20;
      this.ctx = new AC({ latencyHint: 'interactive' });
      for (const rate of this.prewarmed.splice(0)) {
        if (rate === this.ctx.sampleRate) continue;
        // the device does not run at this rate: its boot-time buffers are of no use
        forgetPrerender(rate);
        forgetShared(rate);
      }
      this.engine = new AudioEngine(this.ctx, { seed: (this.game.flags.seed ?? 1) ^ 0x5a17, assets: this.library });
      this.offline = null;
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch (err) {
      console.warn('[audio] could not start WebAudio — continuing silent:', err);
      this.failed = true;
      this.engine = null;
      this.ctx = null;
      return;
    }
    // bring the fresh engine to the state the game already asked for
    this.run('restore', (e) => {
      e.setVolumes(this.volumes(), 0);
      e.setListener(this.lpos, this.lfwd);
      e.setMuffle(this.wantMuffle, 0);
      e.music.setResolved(this.wantResolved);
      e.setIntensity(this.wantIntensity);
      e.setAmbience(this.wantAmbience, 1.5);
      e.setMusic(this.wantMusic, 1.5);
      if (this.wantIrregular !== null) e.music.setIrregular(this.wantIrregular);
      e.setPaused(this.paused);
      e.music.setLead(this.lead === 'selene' ? 'reformation' : 'dominion');
      for (const s of this.pendingSamples) e.registerSample(s.id, s.buffer, s.opts);
      this.pendingSamples.length = 0;
      for (const l of this.loops) l.start(e);
      // frequent sounds are rendered once, off the main thread; until they land everything is synthesised live
      void e.prerender();
    });
  }

  play(id: SfxId, opts?: SfxOpts): void {
    if (id === 'meridianComplete') this.setMeridianResolved(true);
    this.run('play', (e) => void e.play(id, opts), true);
  }

  loop(id: SfxId, opts?: SfxOpts): LoopHandle {
    if (this.failed || this.disposed || this.game.flags.mute) return NULL_LOOP;
    if (this.loops.size >= MAX_LOOP_SLOTS) {
      this.warnOnce('#loops', `[audio] more than ${MAX_LOOP_SLOTS} loops requested — the rest are ignored (stop() the ones you no longer need)`);
      return NULL_LOOP;
    }
    const l = new DeferredLoop(id, opts, (x) => this.loops.delete(x));
    this.loops.add(l);
    this.run('loop', (e) => l.start(e));
    return l;
  }

  setMusic(state: MusicState, fadeSeconds?: number): void {
    let s = state;
    if (s !== 'silence' && !Object.prototype.hasOwnProperty.call(MUSIC, s)) {
      this.warnOnce(`music:${String(s)}`, `[audio] unknown music state "${String(s)}" — silence`);
      s = 'silence';
    }
    this.wantMusic = s;
    // before audio is unlocked: have the state's recording decoded by the time it is (the title theme)
    if (!this.engine && this.library && !this.game.flags.manual) {
      const track = scorePlan(s).track;
      if (track) void this.library.requestTrack(track);
    }
    this.run('setMusic', (e) => e.setMusic(s, fadeSeconds));
  }

  get music(): MusicState {
    return this.engine ? this.engine.music.state : this.wantMusic;
  }

  setAmbience(id: AmbienceId, fadeSeconds?: number): void {
    let a = id;
    if (a !== 'none' && !Object.prototype.hasOwnProperty.call(AMBIENCE, a)) {
      this.warnOnce(`amb:${String(a)}`, `[audio] unknown ambience "${String(a)}" — none`);
      a = 'none';
    }
    this.wantAmbience = a;
    this.run('setAmbience', (e) => e.setAmbience(a, fadeSeconds));
  }

  get ambience(): AmbienceId {
    return this.engine ? this.engine.ambience.current : this.wantAmbience;
  }

  setIntensity(n: number): void {
    this.wantIntensity = clamp01(Number.isFinite(n) ? n : 0);
  }

  get intensity(): number {
    return this.engine ? this.engine.music.intensity : this.wantIntensity;
  }

  stinger(kind: StingerKind): void {
    // the cadence consequence of a sever must survive even if nothing can sound yet
    if (kind === 'sever') this.wantIrregular = 1;
    this.run('stinger', (e) => e.stinger(kind), true);
    if (kind === 'sever' && this.ctx?.state !== 'running') this.run('sever', (e) => e.music.setIrregular(1));
  }

  speak(speaker: string, channel: 'voice' | 'radio' | 'system' | 'narration' = 'voice'): void {
    this.run('speak', (e) => e.speak(speaker, channel), true);
  }

  voice(speaker: string, text: string, opts?: VoiceOpts): number {
    let seconds = 0;
    this.run('voice', (e) => {
      seconds = e.voice(String(speaker ?? ''), String(text ?? ''), opts);
    }, true);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  stopVoice(fadeSeconds?: number): void {
    this.run('stopVoice', (e) => e.stopVoice(fadeSeconds));
  }

  preloadVoices(lines: ReadonlyArray<readonly [string, string]>): Promise<void> {
    if (!this.library || this.disposed) return Promise.resolve();
    return preloadLines(this.library, lines);
  }

  /**
   * `zone:loading`: fetch the compressed voice-over of this zone and the next one (lines without a zone follow
   * once). Decoding happens line by line as they are spoken. Never rejects; nothing when muted.
   */
  prefetchZoneVoices(zone: string): Promise<void> {
    if (!this.library || this.disposed || typeof zone !== 'string') return Promise.resolve();
    const i = (ZONE_ORDER as readonly string[]).indexOf(zone);
    const next = i >= 0 && i + 1 < ZONE_ORDER.length ? ZONE_ORDER[i + 1] : null;
    return this.library.prefetchVoices([zone, next]).catch(() => undefined);
  }

  duck(amount: number, seconds: number): void {
    this.run('duck', (e) => e.duck(amount, seconds));
  }

  setMuffle(amount: number, fadeSeconds?: number): void {
    this.wantMuffle = clamp01(Number.isFinite(amount) ? amount : 0);
    this.run('setMuffle', (e) => e.setMuffle(this.wantMuffle, fadeSeconds));
  }

  get muffle(): number {
    return this.wantMuffle;
  }

  cadenceTick(pos?: Vec3Like, irregular?: boolean): void {
    this.run('cadenceTick', (e) => e.cadenceTick(pos, irregular), true);
  }

  setMeridianResolved(resolved: boolean): void {
    this.wantResolved = resolved === true;
    this.run('setMeridianResolved', (e) => e.music.setResolved(this.wantResolved));
  }

  setCadenceIrregular(amount: number): void {
    if (!Number.isFinite(amount)) return;
    this.wantIrregular = clamp01(amount);
    this.run('setCadenceIrregular', (e) => e.music.setIrregular(clamp01(amount)));
  }

  setListener(pos: Vec3Like, forward: Vec3Like): void {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    this.lpos.x = pos.x;
    this.lpos.y = pos.y;
    this.lpos.z = pos.z;
    if (forward && Number.isFinite(forward.x) && Number.isFinite(forward.y) && Number.isFinite(forward.z)) {
      this.lfwd.x = forward.x;
      this.lfwd.y = forward.y;
      this.lfwd.z = forward.z;
    }
    this.run('setListener', (e) => e.setListener(this.lpos, this.lfwd));
  }

  applySettings(): void {
    this.run('applySettings', (e) => e.setVolumes(this.volumes()));
  }

  registerSample(id: SfxId, buffer: AudioBuffer, opts?: AudioSampleOpts): void {
    if (this.failed || this.disposed || !buffer || typeof buffer.getChannelData !== 'function') return;
    if (this.engine) this.run('registerSample', (e) => e.registerSample(id, buffer, opts));
    else if (this.pendingSamples.length < 512) this.pendingSamples.push({ id, buffer, opts });
  }

  unregisterSample(id: SfxId): void {
    for (let i = this.pendingSamples.length - 1; i >= 0; i--) if (this.pendingSamples[i].id === id) this.pendingSamples.splice(i, 1);
    this.run('unregisterSample', (e) => e.unregisterSample(id));
  }

  /** Current protagonist (wired to `player:protagonist` / `handoff`): flavours encounter stingers. */
  setLead(id: 'tarrik' | 'selene'): void {
    this.lead = id;
    this.run('setLead', (e) => e.music.setLead(id === 'selene' ? 'reformation' : 'dominion'));
  }

  /** Pause gate (wired to `game:paused`): the world freezes, music drops back, UI stays crisp. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.run('setPaused', (e) => e.setPaused(paused));
  }

  update(dt: number): void {
    if (this.graceFrames > 0) this.graceFrames--;
    const e = this.engine;
    if (!e || !this.ctx || this.ctx.state !== 'running') return;
    this.gestureOff?.();
    // combat intensity: whichever is higher of the scripted value and the AI director's own reading
    let n = this.wantIntensity;
    const ai = this.game.ai;
    if (ai && !isStub(ai)) {
      const a = ai.intensity;
      if (typeof a === 'number' && Number.isFinite(a) && a > n) n = clamp01(a);
    }
    // a zone being built means long frames: schedule the score further ahead while it lasts
    const mission = this.game.mission;
    const busy = !!mission && !isStub(mission) && mission.loading === true;
    this.run('update', (eng) => {
      eng.setBusy(busy);
      eng.setIntensity(n);
      eng.update(dt);
    });
  }

  clear(): void {
    for (const l of [...this.loops]) l.stop(0.35);
    this.loops.clear();
    this.run('clear', (e) => e.clear());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.cleanup) {
      try {
        off();
      } catch {
        /* a listener that is already gone */
      }
    }
    this.cleanup.length = 0;
    this.gestureOff?.();
    for (const l of [...this.loops]) l.stop(0.05);
    this.loops.clear();
    this.pendingSamples.length = 0;
    const ctx = this.ctx;
    this.run('dispose', (e) => e.dispose());
    this.engine = null;
    this.ctx = null;
    if (ctx && typeof ctx.close === 'function') {
      try {
        void ctx.close().catch(() => undefined);
      } catch {
        /* already closed */
      }
    }
  }

  debugInfo(): AudioDebugInfo {
    const e = this.engine;
    const loops = e ? e.voices.loopCounts : { sounding: 0, requested: this.loops.size };
    return {
      unlocked: this.unlocked,
      contextState: this.ctx ? this.ctx.state : 'none',
      voices: e ? e.voices.count : 0,
      music: this.music,
      ambience: this.ambience,
      intensity: this.intensity,
      muffle: this.wantMuffle,
      meridianResolved: this.wantResolved,
      loops: loops.sounding,
      loopsRequested: loops.requested,
      cadenceIrregular: e ? e.music.irregular : (this.wantIrregular ?? 0),
      prerendered: e ? e.samples.bakedCount : 0,
      samples: e ? e.samples.registeredCount : this.pendingSamples.length,
      recordedTrack: e ? e.score.track : null,
      voiceLine: e ? e.vo.speaking : null,
      voiceOver: this.library ? this.library.voiceStats() : { listed: 0, fetched: 0, decoded: 0, broken: [] },
    };
  }
}

/** Factory used by Game. Never throws; returns a silent system when audio is unavailable. */
export function createAudioSystem(game: Game): AudioSystem {
  return new AudioSystemImpl(game);
}

export { AudioEngine } from './engine';
