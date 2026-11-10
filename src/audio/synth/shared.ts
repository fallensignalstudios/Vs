/**
 * Per-context shared resources: looping noise buffers, waveshaper curves, the reverb impulse.
 * Built once for an AudioContext / OfflineAudioContext and reused by every voice.
 */
import { fillNoise, makeCurve, makeHallIR, type CurveName, type NoiseColor } from './buffers';

export interface Shared {
  readonly noise: Readonly<Record<NoiseColor, AudioBuffer>>;
  readonly curves: Readonly<Record<CurveName, Float32Array<ArrayBuffer>>>;
  readonly hallIR: AudioBuffer;
}

// distinct (mutually non-multiple) lengths so layered loops never phase-lock audibly
const NOISE_SECONDS: Record<NoiseColor, number> = { white: 2.0, pink: 2.7, brown: 3.3, crackle: 2.3 };
const NOISE_SEED: Record<NoiseColor, number> = { white: 101, pink: 202, brown: 303, crackle: 404 };

export function makeShared(ac: BaseAudioContext): Shared {
  const sr = ac.sampleRate;
  const noise = {} as Record<NoiseColor, AudioBuffer>;
  for (const color of Object.keys(NOISE_SECONDS) as NoiseColor[]) {
    const buf = ac.createBuffer(1, Math.floor(NOISE_SECONDS[color] * sr), sr);
    fillNoise(buf.getChannelData(0), color, sr, NOISE_SEED[color]);
    noise[color] = buf;
  }
  const curves = {} as Record<CurveName, Float32Array<ArrayBuffer>>;
  for (const name of ['soft', 'hard', 'fold', 'asym', 'ceiling'] as CurveName[]) curves[name] = makeCurve(name);

  const [l, r] = makeHallIR(sr);
  const hallIR = ac.createBuffer(2, l.length, sr);
  hallIR.copyToChannel(l, 0);
  hallIR.copyToChannel(r, 1);
  return { noise, curves, hallIR };
}
