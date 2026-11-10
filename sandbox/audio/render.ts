/**
 * Offline rendering of the real AudioEngine through OfflineAudioContext. Music and ambience are driven
 * exactly like the live game — `engine.update(dt)` every 50 ms of context time via suspend()/resume() — so
 * the look-ahead scheduler itself is what gets measured.
 */
import { AudioEngine, type EngineOpts, type NormTables } from '@/audio/engine';

export const SR = 44100;
const STEP = 0.05;

export interface RenderOpts {
  seconds: number;
  seed?: number;
  norm?: Partial<NormTables>;
  /** called once before rendering starts */
  setup(engine: AudioEngine): void;
  /** called at each 50 ms step with the context time (scripted changes mid-render) */
  tick?(engine: AudioEngine, t: number): void;
  /** drive engine.update() during the render (music / ambience / loops). One-shot SFX do not need it. */
  stepped?: boolean;
}

export async function render(o: RenderOpts): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(o.seconds * SR), SR);
  const opts: EngineOpts = { seed: o.seed ?? 7283, norm: o.norm };
  const engine = new AudioEngine(ctx, opts);
  o.setup(engine);
  engine.update(0);
  if (o.stepped) {
    for (let t = STEP; t < o.seconds - 0.001; t += STEP) {
      void ctx.suspend(t).then(() => {
        o.tick?.(engine, t);
        engine.update(STEP);
        void ctx.resume();
      });
    }
  }
  return ctx.startRendering();
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
