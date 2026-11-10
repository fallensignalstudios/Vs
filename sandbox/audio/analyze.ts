/**
 * Signal analysis for the audio sandbox ("verification without ears"): level, duration, spectrum, and a
 * log-frequency spectrogram so a rendered sound can be read from a screenshot.
 */
import { bufferLoudness } from '@/audio/synth/loudness';

export interface Metrics {
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  /**
   * the level only one sample in ten thousand exceeds (dBFS): where the peaks of a long render really are.
   * The absolute maximum of 8 s of generative music is one chance alignment and moves by a decibel or two
   * with any change to the patch; this does not.
   */
  crestPeakDb: number;
  /** loudest 100 ms, K-weighted (dB) — what SFX levels are balanced on */
  loudDb: number;
  /** p95 − p50 of the 20 ms level envelope (dB): how far the hits stand out of the bed */
  punchDb: number;
  /** time of the last sample above −60 dBFS */
  durationMs: number;
  spectralCentroidHz: number;
  /** share of spectral energy per band: <80, 80–250, 250–2k, 2k–8k, >8k Hz */
  bands: [number, number, number, number, number];
  dc: number;
  /** L/R correlation: 1 = mono, 0 = fully wide */
  stereo: number;
  silent: boolean;
  clipped: boolean;
  nan: boolean;
}

const db = (v: number): number => (v > 1e-9 ? 20 * Math.log10(v) : -180);

/** Percentiles of the 20 ms RMS envelope of the mono mix (dB). */
export function envelopeStats(buf: AudioBuffer, from = 0, to = buf.duration): { p10: number; p50: number; p95: number } {
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const w = Math.floor(0.02 * buf.sampleRate);
  const env: number[] = [];
  const end = Math.min(l.length, Math.floor(to * buf.sampleRate));
  for (let p = Math.floor(from * buf.sampleRate); p + w <= end; p += w) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const v = (l[p + i] + r[p + i]) * 0.5;
      s += v * v;
    }
    env.push(10 * Math.log10(s / w + 1e-12));
  }
  if (!env.length) return { p10: -120, p50: -120, p95: -120 };
  env.sort((a, b) => a - b);
  const q = (f: number): number => env[Math.min(env.length - 1, Math.floor(f * env.length))];
  return { p10: q(0.1), p50: q(0.5), p95: q(0.95) };
}
const round = (v: number, d = 1): number => {
  const k = Math.pow(10, d);
  return Math.round(v * k) / k;
};

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const N = 2048;
const HANN = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));

/** Magnitude spectra (N/2 bins) of consecutive half-overlapped frames of the mono mix. */
export function stft(buf: AudioBuffer, from = 0, to = buf.duration): Float32Array[] {
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const s0 = Math.max(0, Math.floor(from * buf.sampleRate));
  const s1 = Math.min(l.length, Math.floor(to * buf.sampleRate));
  const frames: Float32Array[] = [];
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let p = s0; p + N <= s1; p += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = (l[p + i] + r[p + i]) * 0.5 * HANN[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / (N / 4);
    frames.push(mag);
  }
  return frames;
}

export function analyze(buf: AudioBuffer, from = 0, to = buf.duration): Metrics {
  const sr = buf.sampleRate;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const s0 = Math.max(0, Math.floor(from * sr));
  const s1 = Math.min(l.length, Math.floor(to * sr));
  let peak = 0, sq = 0, sum = 0, last = s0, nan = false, lr = 0, ll = 0, rr = 0;
  for (let i = s0; i < s1; i++) {
    const a = l[i], b = r[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nan = true; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    if (m > 0.001) last = i;
    sq += (a * a + b * b) * 0.5;
    sum += (a + b) * 0.5;
    lr += a * b; ll += a * a; rr += b * b;
  }
  const n = Math.max(1, s1 - s0);
  const rms = Math.sqrt(sq / n);
  // 99.99th percentile of |x| from a 0.1 dB histogram
  const hist = new Uint32Array(1201);
  for (let i = s0; i < s1; i++) {
    const m = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    const d = m > 1e-6 ? 20 * Math.log10(m) : -120;
    hist[Math.max(0, Math.min(1200, Math.round((d + 120) * 10)))]++;
  }
  let over = 0;
  let crestPeakDb = -120;
  for (let b = 1200; b >= 0; b--) {
    over += hist[b];
    if (over >= Math.max(1, n * 1e-4)) { crestPeakDb = b / 10 - 120; break; }
  }
  const frames = stft(buf, from, to);
  const edges = [80, 250, 2000, 8000];
  const bands: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let num = 0, den = 0, total = 0;
  for (const f of frames) {
    for (let i = 1; i < f.length; i++) {
      const hz = (i * sr) / N;
      const p = f[i] * f[i];
      num += hz * f[i];
      den += f[i];
      total += p;
      bands[hz < edges[0] ? 0 : hz < edges[1] ? 1 : hz < edges[2] ? 2 : hz < edges[3] ? 3 : 4] += p;
    }
  }
  for (let i = 0; i < 5; i++) bands[i] = total > 0 ? round(bands[i] / total, 3) : 0;
  const env = envelopeStats(buf, from, to);
  return {
    peak: round(peak, 4), peakDb: round(db(peak)), rms: round(rms, 5), rmsDb: round(db(rms)),
    crestPeakDb: round(crestPeakDb), loudDb: round(bufferLoudness(buf, from, to).loudDb), punchDb: round(env.p95 - env.p50),
    durationMs: Math.round(((last - s0) / sr) * 1000),
    spectralCentroidHz: den > 0 ? Math.round(num / den) : 0,
    bands, dc: round(sum / n, 5), stereo: ll > 0 && rr > 0 ? round(lr / Math.sqrt(ll * rr), 2) : 1,
    silent: peak < 0.0008, clipped: peak > 0.98, nan,
  };
}

/** Draw a log-frequency spectrogram (40 Hz – 16 kHz, 72 dB range) with the level envelope over it. */
export function drawSpectrogram(cv: HTMLCanvasElement, buf: AudioBuffer, seconds = buf.duration): void {
  const g = cv.getContext('2d');
  if (!g) return;
  const w = cv.width, h = cv.height;
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, w, h);
  const frames = stft(buf, 0, seconds);
  if (!frames.length) return;
  const sr = buf.sampleRate;
  const img = g.createImageData(w, h);
  const fLo = Math.log(40), fHi = Math.log(16000);
  for (let x = 0; x < w; x++) {
    const f = frames[Math.min(frames.length - 1, Math.floor((x / w) * frames.length))];
    for (let y = 0; y < h; y++) {
      const hz = Math.exp(fLo + (1 - y / h) * (fHi - fLo));
      const bin = Math.min(f.length - 1, Math.max(1, Math.round((hz * N) / sr)));
      // pink-tilt compensation so highs are visible
      const v = Math.max(0, Math.min(1, (db(f[bin] * Math.sqrt(hz / 200)) + 78) / 72));
      const o = (y * w + x) * 4;
      // black → violet → amber → white-gold
      img.data[o] = Math.min(255, v * v * 330);
      img.data[o + 1] = Math.min(255, Math.pow(v, 1.6) * 250);
      img.data[o + 2] = Math.min(255, 70 * Math.sin(Math.min(1, v * 1.4) * Math.PI) + v * v * v * 190);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // level envelope
  const l = buf.getChannelData(0);
  const n = Math.min(l.length, Math.floor(seconds * sr));
  g.strokeStyle = 'rgba(160,220,255,0.85)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < w; x++) {
    const a = Math.floor((x / w) * n), b = Math.floor(((x + 1) / w) * n);
    let m = 0;
    for (let i = a; i < b; i++) m = Math.max(m, Math.abs(l[i]));
    const y = h - 1 - Math.max(0, Math.min(1, (db(m) + 60) / 60)) * (h - 2);
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
}
