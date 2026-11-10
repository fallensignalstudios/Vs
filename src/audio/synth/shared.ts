/**
 * Per-context shared resources: looping noise buffers, waveshaper curves, the room impulses.
 * Built once per sample rate and reused by every voice.
 */
import { ROOMS, fillNoise, makeCurve, makeHallIR, type CurveName, type NoiseColor, type RoomName } from './buffers';
import { WaveBank } from './waves';

export interface Shared {
  readonly noise: Readonly<Record<NoiseColor, AudioBuffer>>;
  readonly curves: Readonly<Record<CurveName, Float32Array<ArrayBuffer>>>;
  /** convolution impulses: three world spaces and the score's own stage */
  readonly rooms: Readonly<Record<RoomName, AudioBuffer>>;
  /** rendered ensemble loops (filled asynchronously by the pre-render; a miss falls back to oscillators) */
  readonly waves: WaveBank;
}

// distinct (mutually non-multiple) lengths so layered loops never phase-lock audibly
const NOISE_SECONDS: Record<NoiseColor, number> = { white: 2.0, pink: 2.7, brown: 3.3, crackle: 2.3 };
const NOISE_SEED: Record<NoiseColor, number> = { white: 101, pink: 202, brown: 303, crackle: 404 };
const ROOM_SEED: Record<RoomName, number> = { small: 4127, hall: 9173, vast: 2311, stage: 6581 };

// AudioBuffers are not tied to the context that made them, so one set per sample rate serves the live
// context and every offline render.
const cache = new Map<number, Shared>();

export function makeShared(ac: BaseAudioContext): Shared {
  const sr = ac.sampleRate;
  const hit = cache.get(sr);
  if (hit) return hit;
  const noise = {} as Record<NoiseColor, AudioBuffer>;
  for (const color of Object.keys(NOISE_SECONDS) as NoiseColor[]) {
    const buf = ac.createBuffer(1, Math.floor(NOISE_SECONDS[color] * sr), sr);
    fillNoise(buf.getChannelData(0), color, sr, NOISE_SEED[color]);
    noise[color] = buf;
  }
  const curves = {} as Record<CurveName, Float32Array<ArrayBuffer>>;
  for (const name of ['soft', 'hard', 'fold', 'asym', 'ceiling', 'drum'] as CurveName[]) curves[name] = makeCurve(name);

  const rooms = {} as Record<RoomName, AudioBuffer>;
  for (const name of Object.keys(ROOMS) as RoomName[]) {
    const [l, r] = makeHallIR(sr, ROOMS[name], ROOM_SEED[name]);
    const buf = ac.createBuffer(2, l.length, sr);
    buf.copyToChannel(l, 0);
    buf.copyToChannel(r, 1);
    rooms[name] = buf;
  }
  const shared: Shared = { noise, curves, rooms, waves: new WaveBank() };
  cache.set(sr, shared);
  return shared;
}
