/**
 * Audio subsystem façade — implements the AudioSystem contract over an AudioEngine.
 *
 * Browser concerns live here: the AudioContext only exists after `unlock()` (a user gesture), so until then
 * every call is a silent no-op that merely *remembers* the requested music / ambience / mix state and applies
 * it the moment audio becomes available. With no WebAudio (node, old browsers) or `?mute`, it stays silent
 * forever and never throws.
 */
import { clamp01 } from '@/core/mathx';
import { isStub } from '@/core/stub';
import type {
  AmbienceId, AudioDebugInfo, AudioSystem, Game, LoopHandle, MusicState, SfxId, SfxOpts, Vec3Like,
} from '@/core/api';
import { AudioEngine } from './engine';
import { NULL_LOOP } from './voices';
import type { Volumes } from './mixer';
import type { StingerKind } from './music/engine';
import { wireEvents } from './wiring';

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

/**
 * A loop handle that outlives the lack of an AudioContext: it remembers what was asked for and starts the
 * real voice once audio is unlocked (a zone can build its device hums before the first user gesture).
 */
class DeferredLoop implements LoopHandle {
  real: LoopHandle | null = null;
  stopped = false;
  private volume = 1;
  private pitch = 1;
  private readonly opts: SfxOpts;

  constructor(readonly id: SfxId, opts: SfxOpts | undefined, private readonly forget: (l: DeferredLoop) => void) {
    this.opts = { ...opts, pos: opts?.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : undefined };
  }

  /** Start on a live engine, applying everything requested so far. */
  start(engine: AudioEngine): void {
    if (this.stopped || this.real) return;
    this.real = engine.loop(this.id, this.opts);
    if (this.volume !== 1) this.real.setVolume(this.volume, 0.01);
    if (this.pitch !== 1) this.real.setPitch(this.pitch);
  }

  setPosition(p: Vec3Like): void {
    if (this.stopped || !p) return;
    this.opts.pos = { x: p.x, y: p.y, z: p.z };
    this.real?.setPosition(p);
  }

  setVolume(v: number, fadeSeconds?: number): void {
    if (this.stopped || !Number.isFinite(v)) return;
    this.volume = v;
    this.real?.setVolume(v, fadeSeconds);
  }

  setPitch(p: number): void {
    if (this.stopped || !Number.isFinite(p)) return;
    this.pitch = p;
    this.real?.setPitch(p);
  }

  stop(fadeSeconds?: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.real?.stop(fadeSeconds);
    this.real = null;
    this.forget(this);
  }
}

function contextCtor(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

class AudioSystemImpl implements AudioSystem {
  private engine: AudioEngine | null = null;
  private ctx: AudioContext | null = null;
  private failed = false;
  private readonly warned = new Set<string>();
  private readonly loops = new Set<DeferredLoop>();
  /** frames after unlock() during which a still-resuming context may be scheduled on */
  private graceFrames = 0;

  // requested state (applied on unlock, and kept so getters are meaningful while silent)
  private wantMusic: MusicState = 'silence';
  private wantAmbience: AmbienceId = 'none';
  private wantIntensity = 0;
  private wantMuffle = 0;
  private wantResolved = false;
  private paused = false;
  private lead: 'tarrik' | 'selene' = 'tarrik';
  private readonly lpos = { x: 0, y: 0, z: 0 };
  private readonly lfwd = { x: 0, y: 0, z: -1 };

  constructor(private readonly game: Game) {
    wireEvents(game, this);
    // Browsers only allow audio after a gesture: the first key or pointer press anywhere unlocks, so the title
    // screen already has its music by the time a menu button is chosen.
    const w = globalThis as unknown as { addEventListener?: (t: string, f: () => void, o?: unknown) => void; removeEventListener?: (t: string, f: () => void, o?: unknown) => void };
    if (typeof w.addEventListener === 'function' && !game.flags.mute) {
      const first = (): void => {
        w.removeEventListener?.('pointerdown', first, true);
        w.removeEventListener?.('keydown', first, true);
        this.unlock();
      };
      w.addEventListener('pointerdown', first, true);
      w.addEventListener('keydown', first, true);
    }
    const doc = (globalThis as unknown as { document?: Document }).document;
    doc?.addEventListener?.('visibilitychange', () => {
      // a hidden tab stops calling update(): suspend rather than let the sustained layers drone on alone
      if (!this.ctx) return;
      if (doc.hidden) void this.ctx.suspend().catch(() => undefined);
      else void this.ctx.resume().catch(() => undefined);
    });
  }

  /**
   * Run an engine call; any failure is reported once and swallowed (audio must never take the mission down).
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
      if (!this.warned.has(what)) {
        this.warned.add(what);
        console.warn(`[audio] ${what} failed:`, err);
      }
    }
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
    if (this.failed || this.game.flags.mute) return;
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
      this.engine = new AudioEngine(this.ctx, { seed: (this.game.flags.seed ?? 1) ^ 0x5a17 });
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
      e.setPaused(this.paused);
      e.music.setLead(this.lead === 'selene' ? 'reformation' : 'dominion');
      for (const l of this.loops) l.start(e);
    });
  }

  play(id: SfxId, opts?: SfxOpts): void {
    if (id === 'meridianComplete') this.setMeridianResolved(true);
    this.run('play', (e) => void e.play(id, opts), true);
  }

  loop(id: SfxId, opts?: SfxOpts): LoopHandle {
    if (this.failed || this.game.flags.mute || this.loops.size >= MAX_PENDING_LOOPS) return NULL_LOOP;
    const l = new DeferredLoop(id, opts, (x) => this.loops.delete(x));
    this.loops.add(l);
    this.run('loop', (e) => l.start(e));
    return l;
  }

  setMusic(state: MusicState, fadeSeconds?: number): void {
    this.wantMusic = state;
    this.run('setMusic', (e) => e.setMusic(state, fadeSeconds));
  }

  get music(): MusicState {
    return this.wantMusic;
  }

  setAmbience(id: AmbienceId, fadeSeconds?: number): void {
    this.wantAmbience = id;
    this.run('setAmbience', (e) => e.setAmbience(id, fadeSeconds));
  }

  get ambience(): AmbienceId {
    return this.wantAmbience;
  }

  setIntensity(n: number): void {
    this.wantIntensity = clamp01(Number.isFinite(n) ? n : 0);
  }

  get intensity(): number {
    return this.engine ? this.engine.music.intensity : this.wantIntensity;
  }

  stinger(kind: StingerKind): void {
    this.run('stinger', (e) => e.stinger(kind), true);
  }

  speak(speaker: string, channel: 'voice' | 'radio' | 'system' | 'narration' = 'voice'): void {
    this.run('speak', (e) => e.speak(speaker, channel), true);
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
    this.wantResolved = resolved;
    this.run('setMeridianResolved', (e) => e.music.setResolved(resolved));
  }

  setCadenceIrregular(amount: number): void {
    this.run('setCadenceIrregular', (e) => e.music.setIrregular(amount));
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
    // combat intensity: whichever is higher of the scripted value and the AI director's own reading
    let n = this.wantIntensity;
    const ai = this.game.ai;
    if (ai && !isStub(ai)) {
      const a = ai.intensity;
      if (typeof a === 'number' && Number.isFinite(a) && a > n) n = clamp01(a);
    }
    this.run('update', (eng) => {
      eng.setIntensity(n);
      eng.update(dt);
    });
  }

  clear(): void {
    for (const l of [...this.loops]) l.stop(0.35);
    this.loops.clear();
    this.run('clear', (e) => e.clear());
  }

  debugInfo(): AudioDebugInfo {
    const e = this.engine;
    return {
      unlocked: this.unlocked,
      contextState: this.ctx ? this.ctx.state : 'none',
      voices: e ? e.voices.count : 0,
      music: this.wantMusic,
      ambience: this.wantAmbience,
      intensity: this.intensity,
      muffle: this.wantMuffle,
      meridianResolved: this.wantResolved,
    };
  }
}

/** loops a zone may hold open at once (the engine sounds at most 14; the rest wait their turn silently) */
const MAX_PENDING_LOOPS = 64;

/** Factory used by Game. Never throws; returns a silent system when audio is unavailable. */
export function createAudioSystem(game: Game): AudioSystem {
  return new AudioSystemImpl(game);
}

export { AudioEngine } from './engine';
