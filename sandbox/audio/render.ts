/**
 * Offline rendering of the real AudioEngine through OfflineAudioContext. Music and ambience are driven
 * exactly like the live game — `engine.update(dt)` at a fixed frame rate via suspend()/resume() — so the
 * look-ahead scheduler itself is what gets measured.
 *
 * Every render starts WARM: nothing is asked of the engine before `WARM` seconds of context time, because a
 * freshly built dynamics chain behaves differently in its first 150 ms than it ever will again in a running
 * game (the mixer bypasses it for that long; the report checks cold against warm).
 */
import { AudioEngine, type EngineOpts, type NormTables } from '@/audio/engine';
import { makeShared } from '@/audio/synth/shared';

export const SR = 44100;
/** context time at which renders start asking for sound */
export const WARM = 0.5;

export interface RenderOpts {
  /** seconds of sound AFTER the warm-up (the buffer is `WARM + seconds` long) */
  seconds: number;
  seed?: number;
  norm?: Partial<NormTables>;
  /** called at context time WARM (or 0 with `cold`) */
  setup(engine: AudioEngine): void;
  /** called every frame with the time since `setup` (scripted changes mid-render) */
  tick?(engine: AudioEngine, t: number): void;
  /** drive engine.update() during the render (music / ambience / loops). One-shot SFX do not need it. */
  stepped?: boolean;
  /** update rate while stepped (default 20; the perf probes use 60) */
  fps?: number;
  /** frames for which the main thread is "stalled" (no tick, no update) */
  stall?(t: number): boolean;
  /** false = live synthesis only: no pre-rendered samples, no ensemble loops */
  baked?: boolean;
  /** start at context time 0, on a chain that has not settled (cold-vs-warm check only) */
  cold?: boolean;
  /** called once with the engine before anything else (wiring taps for measurement) */
  tap?(engine: AudioEngine): void;
}

export interface Rendered {
  /** the whole render */
  buf: AudioBuffer;
  /** where `setup` happened in `buf` (s) */
  t0: number;
  engine: AudioEngine;
  /** wall-clock seconds the render took */
  wall: number;
}

/**
 * Pre-render samples and ensemble loops for the measurement sample rate. Await once before measuring:
 * afterwards every engine built at SR starts with them, exactly like a game a second after unlock.
 */
export async function prepare(): Promise<AudioEngine> {
  const e = new AudioEngine(new OfflineAudioContext(2, 128, SR), { seed: 7283 });
  await e.prerender();
  e.dispose();
  prepared = e;
  return e;
}

/** the engine `prepare()` pre-rendered on: its sample bank is what every later render plays from */
export let prepared: AudioEngine | null = null;

/** engines whose render has finished but whose result is still being read (released by the next render) */
const spent: AudioEngine[] = [];

export async function renderFull(o: RenderOpts): Promise<Rendered> {
  // Offline contexts are only freed by a major GC, which a small JS heap never triggers — and each one holds
  // five convolution reverbs. Release the previous render's reverbs by hand.
  for (const e of spent.splice(0)) e.dispose();
  const t0 = o.cold ? 0 : WARM;
  const total = t0 + o.seconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  const baked = o.baked !== false;
  const opts: EngineOpts = { seed: o.seed ?? 7283, norm: o.norm, samples: baked };
  const engine = new AudioEngine(ctx, opts);
  const waves = makeShared(ctx).waves;
  if (baked) await engine.prerender();
  waves.enabled = baked;
  o.tap?.(engine);
  const dt = 1 / (o.fps ?? 20);
  const begin = (): void => {
    o.setup(engine);
    engine.update(0);
  };
  if (o.cold) begin();
  else void ctx.suspend(t0).then(() => { begin(); void ctx.resume(); });
  if (o.stepped) {
    let last = 0;
    for (let i = 1; i * dt < o.seconds - 0.001; i++) {
      const t = i * dt;
      void ctx.suspend(t0 + t).then(() => {
        if (!o.stall?.(t)) {
          o.tick?.(engine, t);
          engine.update(t - last);
          last = t;
        }
        void ctx.resume();
      });
    }
  }
  const started = performance.now();
  try {
    const buf = await ctx.startRendering();
    return { buf, t0, engine, wall: (performance.now() - started) / 1000 };
  } finally {
    waves.enabled = true;
    spent.push(engine);
  }
}

/** The audible part of a render: the buffer from `setup` onward. */
export async function render(o: RenderOpts): Promise<AudioBuffer> {
  const r = await renderFull(o);
  return cut(r.buf, r.t0);
}

/** A copy of `buf` from `from` seconds on. */
export function cut(buf: AudioBuffer, from: number, to = buf.duration): AudioBuffer {
  const s0 = Math.floor(from * buf.sampleRate);
  const s1 = Math.min(buf.length, Math.floor(to * buf.sampleRate));
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: Math.max(1, s1 - s0), sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(s0, s1));
  return out;
}

/** Plain graph render without the engine (mix-chain transfer tests). */
export async function renderGraph(seconds: number, build: (ctx: OfflineAudioContext) => void): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  build(ctx);
  return ctx.startRendering();
}

/** Encode an AudioBuffer as a 16-bit WAV blob (download button). */
export function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let p = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, p += 2) out.setInt16(p, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  return new Blob([out], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------------------------------------
// instrumentation: how many source nodes are alive, how many nodes are created
// ---------------------------------------------------------------------------------------------------------

interface Span { s: number; e: number }

/**
 * Counts node creation and tracks source lifetimes by wrapping the WebAudio prototypes (sandbox only).
 * `reset()` before a render, then read `maxLive` / `created` after it.
 */
export class Probe {
  private static installed = false;
  private static spans: Span[] = [];
  private static counts: Record<string, number> = {};

  static install(): void {
    if (Probe.installed) return;
    Probe.installed = true;
    const proto = BaseAudioContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of ['createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner', 'createPanner', 'createDelay', 'createWaveShaper', 'createConvolver', 'createDynamicsCompressor']) {
      const orig = proto[name];
      proto[name] = function (this: BaseAudioContext, ...a: unknown[]): unknown {
        Probe.counts[name] = (Probe.counts[name] ?? 0) + 1;
        return orig.apply(this, a);
      };
    }
    type Src = AudioScheduledSourceNode & { __span?: Span };
    for (const P of [OscillatorNode.prototype, AudioBufferSourceNode.prototype, AudioScheduledSourceNode.prototype] as unknown as Array<Record<string, (...a: unknown[]) => unknown>>) {
      if (Object.prototype.hasOwnProperty.call(P, 'start')) {
        const orig = P.start;
        P.start = function (this: Src, ...a: unknown[]): unknown {
          const when = typeof a[0] === 'number' ? a[0] : 0;
          this.__span = { s: Math.max(when, this.context.currentTime), e: Infinity };
          Probe.spans.push(this.__span);
          return orig.apply(this, a);
        };
      }
      if (Object.prototype.hasOwnProperty.call(P, 'stop')) {
        const orig = P.stop;
        P.stop = function (this: Src, ...a: unknown[]): unknown {
          const when = typeof a[0] === 'number' ? a[0] : 0;
          if (this.__span) this.__span.e = Math.min(this.__span.e, Math.max(when, this.context.currentTime));
          return orig.apply(this, a);
        };
      }
    }
  }

  static reset(): void {
    Probe.spans = [];
    Probe.counts = {};
  }

  /** nodes created since reset() */
  static get created(): number {
    return Object.values(Probe.counts).reduce((a, b) => a + b, 0);
  }

  /** peak number of source nodes alive at once between two context times */
  static maxLive(from: number, to: number): number {
    const ev: Array<[number, number]> = [];
    for (const s of Probe.spans) {
      if (s.e <= from || s.s >= to) continue;
      ev.push([Math.max(s.s, from), 1], [Math.min(s.e, to), -1]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let n = 0, max = 0;
    for (const [, d] of ev) {
      n += d;
      if (n > max) max = n;
    }
    return max;
  }

  /** start times of every source between two context times, sorted */
  static starts(from: number, to: number): number[] {
    return Probe.spans.map((s) => s.s).filter((t) => t >= from && t < to).sort((a, b) => a - b);
  }
}
