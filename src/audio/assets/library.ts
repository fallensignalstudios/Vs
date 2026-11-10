/**
 * Asset library: the recorded score and voice-over clips, fetched and decoded on demand.
 *
 *  - Nothing here ever rejects or throws: a missing manifest, a 404, a dev-server HTML fallback, a corrupt
 *    file or a context that cannot decode all end as "missing", and the caller falls back to synthesis.
 *  - Concurrent requests for one asset share one load. A missing asset is not asked for again.
 *  - Decoded music is large (a 95 s stereo track is ~35 MB of float samples), so tracks that nobody has
 *    pinned for a while are dropped; their compressed bytes are kept (1.5 MB each), so coming back to one
 *    costs a decode and no network. Decoded voice clips are kept up to a total length, least recent first out.
 *  - Decoding needs a context but not a running one: before the first user gesture the façade lends an
 *    OfflineAudioContext, so the title theme can be ready before the click that unlocks audio.
 */
import type { MusicManifest, TrackMeta, VoiceMeta } from './mapping';

/** The slice of `Response` the library uses (tests pass plain objects). */
export interface FetchResult {
  ok: boolean;
  headers?: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

export interface LibraryOpts {
  /** site base ('/' in dev, './' in the build); the assets live under `<base>audio/` */
  baseUrl?: string;
  /** network access (default: the global `fetch`) */
  fetcher?: (url: string) => Promise<FetchResult>;
  /** a context that can decode right now, or null when there is none (headless) */
  decoder: () => BaseAudioContext | null;
}

export type AssetState = 'unknown' | 'loading' | 'ready' | 'missing';

/** A decoded voice clip and the gain that brings its speech to the dialogue level. */
export interface VoiceClip {
  buffer: AudioBuffer;
  gain: number;
}

interface Entry<T> {
  state: AssetState;
  value: T | null;
  /** compressed file, kept so a dropped track can be decoded again without the network */
  bytes: ArrayBuffer | null;
  promise: Promise<T | null> | null;
  lastUsed: number;
}

/** decoded tracks kept at most (the one playing, the one fading or warming, one spare) */
const MAX_TRACKS = 3;
/** seconds a decoded track may sit unpinned before it is dropped */
const TRACK_IDLE = 75;
/** total seconds of decoded voice clips kept */
const MAX_VOICE_SECONDS = 240;
/** speech level the clips are brought to: dBFS RMS over the frames that carry speech */
const VOICE_TARGET_DB = -20;
const VOICE_PEAK = 0.84;

/** outcome of a load that could not be attempted yet (no context to decode with) */
const LATER = Symbol('later');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Wrap both the promise and the callback form of decodeAudioData; resolves null on any failure. */
function decode(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (b: AudioBuffer | null): void => {
      if (done) return;
      done = true;
      resolve(b && typeof b.getChannelData === 'function' && b.length > 0 ? b : null);
    };
    try {
      const p = ctx.decodeAudioData(bytes, (b) => finish(b), () => finish(null)) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then((b) => finish(b), () => finish(null));
    } catch {
      finish(null);
    }
  });
}

/**
 * Gain that brings a clip's speech to the dialogue level. Level is measured over the 20 ms frames that
 * actually carry sound, so a clip with long pauses is not turned up; the trim stays within ±12 dB and
 * never pushes the clip's own peak past the ceiling.
 */
export function voiceGain(channels: readonly Float32Array[], sampleRate: number): number {
  const n = channels.length ? channels[0].length : 0;
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  let sum = 0;
  let frames = 0;
  let peak = 0;
  for (let s = 0; s < n; s += frame) {
    const e = Math.min(n, s + frame);
    let p = 0;
    for (const ch of channels) {
      for (let i = s; i < e; i++) {
        const v = ch[i];
        p += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
    }
    p /= (e - s) * channels.length;
    if (p > 1e-5) { // −50 dBFS gate
      sum += p;
      frames++;
    }
  }
  if (!frames || !(peak > 0)) return 1;
  const rmsDb = 10 * Math.log10(sum / frames);
  const g = Math.pow(10, Math.max(-12, Math.min(12, VOICE_TARGET_DB - rmsDb)) / 20);
  return Math.min(g, VOICE_PEAK / peak);
}

export class AssetLibrary {
  private readonly base: string;
  private readonly fetcher: (url: string) => Promise<FetchResult>;
  private readonly decoder: () => BaseAudioContext | null;
  private readonly tracks = new Map<string, Entry<AudioBuffer>>();
  private readonly clips = new Map<string, Entry<VoiceClip>>();
  private readonly pinned = new Set<string>();
  private music: MusicManifest | null = null;
  private voices: Readonly<Record<string, VoiceMeta>> | null = null;
  private musicLoad: Promise<MusicManifest | null> | null = null;
  private voiceLoad: Promise<Readonly<Record<string, VoiceMeta>> | null> | null = null;
  private clock = 0;
  private sweepAt = 0;

  constructor(opts: LibraryOpts) {
    const b = opts.baseUrl ?? '/';
    this.base = b.endsWith('/') ? b : `${b}/`;
    this.decoder = opts.decoder;
    this.fetcher = opts.fetcher ?? ((url) => {
      const f = (globalThis as { fetch?: (u: string) => Promise<FetchResult> }).fetch;
      return typeof f === 'function' ? f(url) : Promise.reject(new Error('no fetch'));
    });
  }

  // --- network ---------------------------------------------------------------------------------------

  /** Fetch a file; null unless it really is that file (a dev server answers a missing one with index.html). */
  private async get(path: string): Promise<FetchResult | null> {
    try {
      const r = await this.fetcher(`${this.base}audio/${path}`);
      if (!r || !r.ok) return null;
      const type = r.headers?.get('content-type') ?? '';
      return type.includes('text/html') ? null : r;
    } catch {
      return null;
    }
  }

  private async manifest(path: string): Promise<Record<string, unknown> | null> {
    const r = await this.get(path);
    if (!r) return null;
    try {
      const j = await r.json();
      return isRecord(j) ? j : null;
    } catch {
      return null;
    }
  }

  /** Load `music/manifest.json` (once). Resolves null when there is no recorded score. */
  loadMusic(): Promise<MusicManifest | null> {
    this.musicLoad ??= this.manifest('music/manifest.json').then((j) => {
      const out: Record<string, TrackMeta> = {};
      for (const [name, v] of Object.entries(j ?? {})) {
        if (!isRecord(v) || typeof v.file !== 'string' || typeof v.seconds !== 'number' || !(v.seconds > 0)) continue;
        out[name] = {
          file: v.file, seconds: v.seconds,
          bpm: typeof v.bpm === 'number' ? v.bpm : 0,
          loopStart: typeof v.loopStart === 'number' ? v.loopStart : 0,
          meanDb: typeof v.meanDb === 'number' ? v.meanDb : -16,
          maxDb: typeof v.maxDb === 'number' ? v.maxDb : 0,
          loopBars: typeof v.loopBars === 'number' ? v.loopBars : undefined,
          key: typeof v.key === 'string' ? v.key : undefined,
          notes: typeof v.notes === 'string' ? v.notes : undefined,
        };
      }
      this.music = j ? out : {};
      return j ? out : null;
    });
    return this.musicLoad;
  }

  /** Load `vo/manifest.json` (once). Resolves null when no voice-over has been generated. */
  loadVoices(): Promise<Readonly<Record<string, VoiceMeta>> | null> {
    this.voiceLoad ??= this.manifest('vo/manifest.json').then((j) => {
      const out: Record<string, VoiceMeta> = {};
      for (const [id, v] of Object.entries(j ?? {})) {
        if (isRecord(v) && typeof v.file === 'string' && typeof v.seconds === 'number' && v.seconds > 0) out[id] = { file: v.file, seconds: v.seconds };
      }
      this.voices = out;
      return j ? out : null;
    });
    return this.voiceLoad;
  }

  /** One load per asset: fetch (unless the bytes are already here), decode, remember the outcome. */
  private load<T>(e: Entry<T>, path: string, keepBytes: boolean, finish: (buf: AudioBuffer) => T): Promise<T | null> {
    if (e.state === 'ready') return Promise.resolve(e.value);
    if (e.state === 'missing') return Promise.resolve(null);
    if (e.promise) return e.promise;
    e.state = 'loading';
    const work = async (): Promise<T | null | typeof LATER> => {
      if (!e.bytes) {
        const r = await this.get(path);
        try {
          e.bytes = r ? await r.arrayBuffer() : null;
        } catch {
          e.bytes = null;
        }
        if (!e.bytes || e.bytes.byteLength < 64) return null;
      }
      const ctx = this.decoder();
      // no context to decode with yet: not a verdict on the file — stay loadable
      if (!ctx) return LATER;
      // decodeAudioData detaches what it is given: hand it a copy and keep ours
      const buf = await decode(ctx, e.bytes.slice(0));
      return buf ? finish(buf) : null;
    };
    e.promise = work().catch(() => null).then((value) => {
      e.promise = null;
      if (value === LATER) {
        e.state = 'unknown';
        return null;
      }
      e.value = value;
      e.state = value ? 'ready' : 'missing';
      if (!value || !keepBytes) e.bytes = null;
      e.lastUsed = this.clock;
      return value;
    });
    return e.promise;
  }

  private entry<T>(map: Map<string, Entry<T>>, key: string): Entry<T> {
    let e = map.get(key);
    if (!e) {
      e = { state: 'unknown', value: null, bytes: null, promise: null, lastUsed: this.clock };
      map.set(key, e);
    }
    return e;
  }

  // --- music -----------------------------------------------------------------------------------------

  /** Manifest entry of a track, once the manifest has loaded. */
  trackMeta(name: string): TrackMeta | null {
    return this.music?.[name] ?? null;
  }

  /** The decoded track, if it is in memory right now. */
  track(name: string): AudioBuffer | null {
    const e = this.tracks.get(name);
    if (!e || e.state !== 'ready') return null;
    e.lastUsed = this.clock;
    return e.value;
  }

  /** 'missing' is final (no manifest, not in it, 404, undecodable); 'unknown' means it has not been asked for. */
  trackState(name: string): AssetState {
    if (this.music && !this.music[name]) return 'missing';
    return this.tracks.get(name)?.state ?? 'unknown';
  }

  /** Fetch and decode a track (shared between callers). Resolves null when it cannot be had. */
  async requestTrack(name: string): Promise<AudioBuffer | null> {
    const manifest = this.music ?? (await this.loadMusic());
    const meta = manifest?.[name];
    if (!meta) return null;
    const buf = await this.load(this.entry(this.tracks, name), `music/${meta.file}`, true, (b) => b);
    this.trim();
    return buf;
  }

  /** Declare the tracks in use right now (playing, fading, warming): they are never dropped. */
  pin(names: ReadonlyArray<string | null>): void {
    this.pinned.clear();
    for (const n of names) if (n) this.pinned.add(n);
  }

  /** Drop decoded tracks nobody needs: idle ones, and the least recent beyond the cap. */
  private trim(): void {
    const loose: Array<[string, Entry<AudioBuffer>]> = [];
    let ready = 0;
    for (const [name, e] of this.tracks) {
      if (e.state !== 'ready') continue;
      ready++;
      if (this.pinned.has(name)) e.lastUsed = this.clock;
      else loose.push([name, e]);
    }
    loose.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [, e] of loose) {
      if (ready <= MAX_TRACKS && this.clock - e.lastUsed < TRACK_IDLE) continue;
      e.value = null;
      e.state = 'unknown';
      ready--;
    }
  }

  /** Advance the housekeeping clock (seconds of play). Cheap: sweeps every few seconds. */
  tick(dt: number): void {
    if (Number.isFinite(dt) && dt > 0) this.clock += Math.min(dt, 1);
    if (this.clock < this.sweepAt) return;
    this.sweepAt = this.clock + 5;
    this.trim();
  }

  // --- voice-over ------------------------------------------------------------------------------------

  /** Manifest entry of a line id, once the voice manifest has loaded. */
  voiceMeta(id: string): VoiceMeta | null {
    return this.voices?.[id] ?? null;
  }

  /** True once the voice manifest has been read (or found absent). */
  get voicesKnown(): boolean {
    return this.voices !== null;
  }

  /** True when a listed clip turned out not to be loadable (file gone, not audio): the line has no recording. */
  clipMissing(id: string): boolean {
    return this.clips.get(id)?.state === 'missing';
  }

  /** The decoded clip, if it is in memory right now. */
  clip(id: string): VoiceClip | null {
    const e = this.clips.get(id);
    if (!e || e.state !== 'ready') return null;
    e.lastUsed = this.clock;
    return e.value;
  }

  /** Fetch and decode a voice clip (shared between callers). Resolves null when there is no such line. */
  async requestClip(id: string): Promise<VoiceClip | null> {
    const manifest = this.voices ?? (await this.loadVoices());
    const meta = manifest?.[id];
    if (!meta) return null;
    const clip = await this.load(this.entry(this.clips, id), `vo/${meta.file}`, false, (buffer) => {
      const chans: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
      return { buffer, gain: voiceGain(chans, buffer.sampleRate) };
    });
    if (clip) this.trimClips(id);
    return clip;
  }

  private trimClips(keep: string): void {
    let total = 0;
    const ready: Array<[string, Entry<VoiceClip>]> = [];
    for (const [id, e] of this.clips) {
      if (e.state !== 'ready' || !e.value) continue;
      total += e.value.buffer.duration;
      if (id !== keep) ready.push([id, e]);
    }
    ready.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id] of ready) {
      if (total <= MAX_VOICE_SECONDS) break;
      const e = this.clips.get(id);
      total -= e?.value?.buffer.duration ?? 0;
      this.clips.delete(id);
    }
  }

  /** What is in memory (debug overlays, the sandbox). */
  stats(): { tracks: Record<string, AssetState>; decodedTracks: number; clips: number; manifest: 'none' | 'loading' | 'ready' | 'missing'; voiceLines: number } {
    const tracks: Record<string, AssetState> = {};
    let decoded = 0;
    for (const [name, e] of this.tracks) {
      tracks[name] = e.state;
      if (e.state === 'ready') decoded++;
    }
    let clips = 0;
    for (const e of this.clips.values()) if (e.state === 'ready') clips++;
    const manifest = this.music ? (Object.keys(this.music).length ? 'ready' : 'missing') : this.musicLoad ? 'loading' : 'none';
    return { tracks, decodedTracks: decoded, clips, manifest, voiceLines: this.voices ? Object.keys(this.voices).length : 0 };
  }
}
