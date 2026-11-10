/**
 * Loudness measurement (pure functions over sample arrays, usable in node and in the browser).
 * "Loudness" here is the loudest 100 ms of the K-weighted signal (ITU-R BS.1770 pre-filter: a +4 dB shelf
 * above ~1.7 kHz and a 38 Hz high-pass), in dB re full scale. 100 ms is roughly the ear's integration time
 * for short sounds, so a 5 ms click reads far quieter than a sustained sound with the same sample peak —
 * which is exactly how the two are heard.
 */

interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
}

function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // stage 1: high shelf
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // stage 2: RLB high-pass
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sampleRate);
  const d = 1 + K1 / Q1 + K1 * K1;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / d, a2: (1 - K1 / Q1 + K1 * K1) / d };
  return [shelf, hp];
}

function filter(x: Float32Array, c: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o;
    y[i] = o;
  }
  return y;
}

const toDb = (power: number): number => (power > 1e-18 ? 10 * Math.log10(power) : -180);

export interface Loudness {
  /** loudest window, dB (K-weighted mean square across channels) */
  loudDb: number;
  /** absolute sample peak, dBFS */
  peakDb: number;
}

/**
 * Loudest `windowSec` of the K-weighted signal and the sample peak, between `from` and `to` seconds.
 * Channels are power-averaged (a centred mono sound reads the same as before it was duplicated to stereo).
 */
export function measureLoudness(channels: readonly Float32Array[], sampleRate: number, from = 0, to = Infinity, windowSec = 0.1): Loudness {
  const n = channels.length ? channels[0].length : 0;
  const s0 = Math.max(0, Math.floor(from * sampleRate));
  const s1 = Math.min(n, Number.isFinite(to) ? Math.floor(to * sampleRate) : n);
  if (s1 <= s0) return { loudDb: -180, peakDb: -180 };
  const [shelf, hp] = kWeighting(sampleRate);
  const len = s1 - s0;
  const power = new Float32Array(len);
  let peak = 0;
  for (const ch of channels) {
    const seg = ch.subarray(s0, s1);
    for (let i = 0; i < len; i++) {
      const a = seg[i] < 0 ? -seg[i] : seg[i];
      if (a > peak) peak = a;
    }
    const w = filter(filter(seg, shelf), hp);
    for (let i = 0; i < len; i++) power[i] += (w[i] * w[i]) / channels.length;
  }
  const win = Math.max(1, Math.min(len, Math.round(windowSec * sampleRate)));
  let acc = 0;
  let best = 0;
  for (let i = 0; i < len; i++) {
    acc += power[i];
    if (i >= win) acc -= power[i - win];
    if (acc > best) best = acc;
  }
  // a sound shorter than the window is still integrated over the whole window (that is the point)
  return { loudDb: toDb(best / Math.round(windowSec * sampleRate)), peakDb: peak > 1e-9 ? 20 * Math.log10(peak) : -180 };
}

/** The loudness of an AudioBuffer (see `measureLoudness`). */
export function bufferLoudness(buf: AudioBuffer, from = 0, to = Infinity): Loudness {
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  return measureLoudness(chans, buf.sampleRate, from, to);
}
