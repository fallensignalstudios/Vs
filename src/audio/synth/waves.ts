/**
 * Ensemble waves. A pad or string note is two or three detuned oscillators; a chord of them, cross-fading
 * into the next chord, is the bulk of the score's live source count. Each ensemble is therefore rendered
 * once per octave into a seamless stereo loop (every partial completes a whole number of cycles) and a note
 * becomes ONE looping buffer source whose playback rate sets the pitch — detune, width and beating included.
 * Where a loop is not available (not rendered yet, no OfflineAudioContext) the same ensemble is built from
 * live oscillators, at the same level.
 */

export interface EnsembleVoice {
  type: OscillatorType;
  /** frequency ratio to the note */
  ratio: number;
  /** detune in cents */
  cents: number;
  g: number;
  /** stereo position −1..1 */
  pan: number;
}

export type EnsembleName = 'warm' | 'strings' | 'choir' | 'glass' | 'glassy' | 'wrong' | 'brass' | 'horn' | 'pluck';

export const ENSEMBLES: Readonly<Record<EnsembleName, readonly EnsembleVoice[]>> = {
  /** warm pad: a detuned saw pair over a soft octave below */
  warm: [
    { type: 'sawtooth', ratio: 1, cents: -8, g: 0.4, pan: -0.5 },
    { type: 'sawtooth', ratio: 1, cents: 9, g: 0.4, pan: 0.5 },
    { type: 'triangle', ratio: 0.5, cents: 0, g: 0.35, pan: 0 },
  ],
  /** low string desks: cellos left and right, violas an octave above — the part small speakers carry */
  strings: [
    { type: 'sawtooth', ratio: 1, cents: -9, g: 0.36, pan: -0.5 },
    { type: 'sawtooth', ratio: 1, cents: 11, g: 0.36, pan: 0.3 },
    { type: 'sawtooth', ratio: 2, cents: 4, g: 0.36, pan: -0.15 },
  ],
  choir: [
    { type: 'sawtooth', ratio: 1, cents: -6, g: 0.45, pan: -0.45 },
    { type: 'sawtooth', ratio: 1, cents: 7, g: 0.45, pan: 0.45 },
  ],
  glass: [
    { type: 'sine', ratio: 1, cents: 0, g: 0.6, pan: -0.4 },
    { type: 'sine', ratio: 1, cents: 4.3, g: 0.4, pan: 0.4 },
    { type: 'triangle', ratio: 2, cents: 2.6, g: 0.14, pan: -0.2 },
  ],
  /** a struck-glass note's held body: the still tone and its slow beat (Frost, Selene's motif) */
  glassy: [
    { type: 'sine', ratio: 1, cents: 0, g: 1, pan: 0 },
    { type: 'sine', ratio: 1, cents: 5.2, g: 0.5, pan: 0 },
  ],
  /** Eclipse: an exact quarter-tone pair over a sub a semitone off */
  wrong: [
    { type: 'sawtooth', ratio: 1, cents: 0, g: 0.4, pan: -0.5 },
    { type: 'sawtooth', ratio: 1, cents: 50, g: 0.4, pan: 0.5 },
    { type: 'sine', ratio: 0.5, cents: 100, g: 0.25, pan: 0 },
  ],
  /** brass section before its filter and rasp */
  brass: [
    { type: 'sawtooth', ratio: 1, cents: -7, g: 0.5, pan: 0 },
    { type: 'sawtooth', ratio: 1, cents: 8, g: 0.5, pan: 0 },
    { type: 'square', ratio: 0.5, cents: 0, g: 0.22, pan: 0 },
  ],
  /** Reformation's plucked ostinato before its filter: a saw with a hollow square inside it */
  pluck: [
    { type: 'sawtooth', ratio: 1, cents: -5, g: 0.5, pan: 0 },
    { type: 'square', ratio: 1, cents: 6, g: 0.25, pan: 0 },
  ],
  /** solo horn before its filter */
  horn: [
    { type: 'sawtooth', ratio: 1, cents: -4, g: 0.42, pan: 0 },
    { type: 'sawtooth', ratio: 1, cents: 5, g: 0.42, pan: 0 },
  ],
};

/** lowest loop base (A1); loops exist per octave above it */
const BASE_HZ = 55;
const MAX_OCTAVE = 5;

/** Which octave loop serves a note (playback rate stays within ±half an octave of 1). */
export function waveOctave(hz: number): number {
  const j = Math.round(Math.log2(Math.max(hz, 1) / BASE_HZ));
  return j < 0 ? 0 : j > MAX_OCTAVE ? MAX_OCTAVE : j;
}

export const waveKey = (name: EnsembleName, octave: number): string => `${name}@${octave}`;

export interface Wave {
  buffer: AudioBuffer;
  /** the pitch the loop was rendered at */
  baseHz: number;
}

/** Rendered ensemble loops for one sample rate. A plain lookup: a miss means "use live oscillators". */
export class WaveBank {
  private readonly map = new Map<string, Wave>();
  /** false = always answer "not rendered" (A/B measurement of the live oscillators) */
  enabled = true;

  get(name: EnsembleName, hz: number): Wave | null {
    if (!this.enabled) return null;
    return this.map.get(waveKey(name, waveOctave(hz))) ?? null;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, wave: Wave): void {
    this.map.set(key, wave);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/**
 * Render the requested `name@octave` loops into `bank`. Each loop is band-limited to ~11 kHz so that playing
 * it up to half an octave sharp cannot alias. Never rejects.
 */
export async function bakeWaves(sampleRate: number, keys: Iterable<string>, bank: WaveBank): Promise<void> {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const Offline = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Offline) return;
  for (const key of keys) {
    if (bank.has(key)) continue;
    const [name, oct] = key.split('@') as [EnsembleName, string];
    const octave = Number(oct);
    const def = ENSEMBLES[name];
    if (!def || !Number.isFinite(octave)) continue;
    const baseHz = BASE_HZ * Math.pow(2, octave);
    // long loops low down (fine detune resolution), short ones higher up (memory)
    const n = Math.round((octave <= 1 ? 4 : 2) * sampleRate);
    const pre = Math.round(0.12 * sampleRate);
    try {
      const ctx = new Offline(2, n + pre, sampleRate);
      const lp1 = ctx.createBiquadFilter();
      lp1.type = 'lowpass';
      lp1.frequency.value = 11000;
      lp1.Q.value = 0; // dB: flat
      const lp2 = ctx.createBiquadFilter();
      lp2.type = 'lowpass';
      lp2.frequency.value = 11000;
      lp2.Q.value = 0;
      lp1.connect(lp2);
      lp2.connect(ctx.destination);
      for (const v of def) {
        const want = baseHz * v.ratio * Math.pow(2, v.cents / 1200);
        // snap to a whole number of cycles in the loop
        const hz = Math.max(1, Math.round((want * n) / sampleRate)) * (sampleRate / n);
        const o = ctx.createOscillator();
        o.type = v.type;
        o.frequency.value = hz;
        const gain = ctx.createGain();
        gain.gain.value = v.g;
        o.connect(gain);
        if (v.pan === 0) {
          gain.connect(lp1); // centred voices are not panned live either (a panner would cost them 3 dB)
        } else {
          const pan = ctx.createStereoPanner();
          pan.pan.value = v.pan;
          gain.connect(pan);
          pan.connect(lp1);
        }
        o.start(0);
      }
      const rendered = await ctx.startRendering();
      const buffer = ctx.createBuffer(2, n, sampleRate);
      for (let c = 0; c < 2; c++) buffer.getChannelData(c).set(rendered.getChannelData(c).subarray(pre, pre + n));
      bank.set(key, { buffer, baseHz });
    } catch (err) {
      console.warn(`[audio] ensemble loop ${key} could not be rendered — it stays on live oscillators:`, err);
    }
  }
}
