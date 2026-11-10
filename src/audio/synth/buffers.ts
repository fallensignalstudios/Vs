/**
 * Pure sample generators (no WebAudio types) — noise colours, waveshaper curves and the convolution impulse.
 * Kept free of the DOM so they can be unit-tested in node.
 */
import { mulberry32 } from '@/core/mathx';

export type NoiseColor = 'white' | 'pink' | 'brown' | 'crackle';
export type CurveName = 'soft' | 'hard' | 'fold' | 'asym' | 'ceiling';

/** Scale `a` in place so its absolute peak equals `peak`. */
export function normalize(a: Float32Array, peak = 1): void {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m <= 1e-9) return;
  const k = peak / m;
  for (let i = 0; i < a.length; i++) a[i] *= k;
}

/** Remove any DC component (mean) in place. */
export function removeDc(a: Float32Array): void {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  const m = s / Math.max(1, a.length);
  for (let i = 0; i < a.length; i++) a[i] -= m;
}

/**
 * Fill a buffer with one noise colour, loopable without a seam (the tail is equal-power crossfaded into the
 * head). `crackle` is sparse decaying impulses (embers, ice, static).
 */
export function fillNoise(out: Float32Array, color: NoiseColor, sampleRate: number, seed: number): void {
  const rnd = mulberry32(seed);
  const n = out.length;
  const xf = Math.min(2048, n >> 3);
  const raw = new Float32Array(n + xf);
  const m = raw.length;
  if (color === 'white') {
    for (let i = 0; i < m; i++) raw[i] = rnd() * 2 - 1;
  } else if (color === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < m; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else if (color === 'brown') {
    let v = 0;
    for (let i = 0; i < m; i++) {
      v = (v + (rnd() * 2 - 1) * 0.04) * 0.996;
      raw[i] = v;
    }
  } else {
    // crackle: Poisson impulses (~220/s) with random amplitude and a sub-millisecond decay
    const density = 220 / sampleRate;
    const decay = Math.exp(-1 / (0.0004 * sampleRate));
    let v = 0;
    for (let i = 0; i < m; i++) {
      v *= decay;
      if (rnd() < density) {
        const a = rnd();
        v += (rnd() < 0.5 ? -1 : 1) * a * a;
      }
      raw[i] = v;
    }
  }
  removeDc(raw);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    out[i] = raw[i] * Math.sqrt(t) + raw[n + i] * Math.sqrt(1 - t);
  }
  normalize(out, 0.95);
}

/** Waveshaper transfer curves over x ∈ [-1, 1]. */
export function makeCurve(name: CurveName, n = 2049): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    switch (name) {
      case 'soft':
        y = Math.tanh(1.6 * x) / Math.tanh(1.6);
        break;
      case 'hard':
        y = Math.tanh(5 * x);
        break;
      case 'fold':
        y = Math.sin(x * Math.PI * 1.5) * 0.9;
        break;
      case 'asym':
        // even harmonics: softer on the negative half (brass rasp)
        y = x >= 0 ? Math.tanh(2.4 * x) : Math.tanh(1.2 * x) * 0.85;
        break;
      default: {
        // 'ceiling': transparent below 0.75, then a smooth knee that can never exceed ~0.97
        const a = Math.abs(x);
        const knee = 0.75;
        const top = 0.97;
        const yy = a <= knee ? a : knee + (top - knee) * Math.tanh((a - knee) / (top - knee));
        y = Math.sign(x) * yy;
      }
    }
    c[i] = y;
  }
  return c;
}

export interface HallOpts {
  /** total impulse length (s) */
  seconds: number;
  /** RT60 of the low band (s) */
  rt60: number;
  /** high-frequency damping: cutoff the tail closes down to (Hz) */
  dampHz: number;
  /** pre-delay before the first reflection (s) */
  preDelay: number;
  /** number of discrete early reflections (default 11) */
  taps?: number;
  /** window the early reflections are spread over (s, default 0.135) */
  erWindow?: number;
  /** time the diffuse tail takes to build to full density (s, default 0.06) */
  build?: number;
}

export type RoomName = 'small' | 'hall' | 'vast' | 'stage';

/**
 * The spaces of the mission. Three sizes for the world — the ambience bed picks a blend — and a scoring stage
 * that only the music uses:
 *   small  a 24 × 16 m gallery / a hushed bend: dense early reflections, half a second of tail
 *   hall   a 50 m combat hall: 1.6 s
 *   vast   the 300 m atrium and the Wound overlook: late, sparse first reflections and a 3.4 s tail
 *   stage  the score's own room: brighter and smoother than any place in the fiction
 */
export const ROOMS: Readonly<Record<RoomName, HallOpts>> = {
  small: { seconds: 0.62, rt60: 0.5, dampHz: 2600, preDelay: 0.005, taps: 9, erWindow: 0.032, build: 0.012 },
  hall: { seconds: 1.9, rt60: 1.6, dampHz: 1500, preDelay: 0.016, taps: 11, erWindow: 0.085, build: 0.04 },
  vast: { seconds: 3.6, rt60: 3.4, dampHz: 900, preDelay: 0.058, taps: 7, erWindow: 0.24, build: 0.13 },
  stage: { seconds: 2.5, rt60: 2.1, dampHz: 2400, preDelay: 0.02, taps: 12, erWindow: 0.07, build: 0.05 },
};

/** The largest space (kept under its original name for callers that want "the" stone hall). */
export const STONE_HALL: HallOpts = ROOMS.vast;

/**
 * Generate a stereo impulse response for a stone space: a handful of discrete early reflections followed by
 * decorrelated exponentially decaying noise whose top end closes down over time (stone absorbs little, air
 * absorbs highs). Each channel is normalised to unit energy so a send gain maps to a level.
 */
export function makeHallIR(sampleRate: number, opts: HallOpts = STONE_HALL, seed = 9173): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.max(64, Math.floor(opts.seconds * sampleRate));
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)];
  const pre = Math.floor(opts.preDelay * sampleRate);
  const k = Math.log(1000) / opts.rt60; // amplitude decay rate for −60 dB at rt60
  const taps = opts.taps ?? 11;
  const window = opts.erWindow ?? 0.135;
  const buildTime = opts.build ?? 0.06;
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(seed + ch * 7919);
    const a = out[ch];
    // early reflections: sparse taps inside the early window
    for (let i = 0; i < taps; i++) {
      const dt = Math.pow(rnd(), 1.4) * window;
      const idx = Math.floor((opts.preDelay + 0.004 + dt) * sampleRate);
      if (idx < n) a[idx] += (rnd() < 0.5 ? -1 : 1) * (0.9 - 0.55 * (dt / window)) * (0.6 + 0.4 * rnd());
    }
    // diffuse tail: noise → time-varying one-pole low-pass → exponential decay, fading in as density builds
    let lp = 0;
    let hp = 0;
    let prev = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sampleRate;
      const cutoff = opts.dampHz + (11000 - opts.dampHz) * Math.exp((-t * 7.8) / opts.rt60);
      const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      lp += alpha * ((rnd() * 2 - 1) - lp);
      // DC blocker (~40 Hz) so the tail never builds sub rumble
      hp = 0.9943 * (hp + lp - prev);
      prev = lp;
      const build = Math.min(1, t / buildTime);
      a[i] += hp * Math.exp(-k * t) * build * 0.55;
    }
    // fade the last 5% to exact zero
    const fade = Math.floor(n * 0.05);
    for (let i = 0; i < fade; i++) a[n - 1 - i] *= i / fade;
    let e = 0;
    for (let i = 0; i < n; i++) e += a[i] * a[i];
    const g = e > 0 ? 1 / Math.sqrt(e) : 0;
    for (let i = 0; i < n; i++) a[i] *= g;
  }
  return out;
}
