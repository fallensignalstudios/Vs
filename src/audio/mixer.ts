/**
 * Mix graph.
 *
 *   sfx voices ─► sfx ─┐
 *   ambience ─► amb ─► ambDuck ─┤► world ─► muffle (LP) ─► worldGate ─┐
 *   reverb return ◄─ convolver ◄─ reverbIn ─────────────────┘        │
 *   music decks ─► music ─► tilt EQ ─► peak comp ─► musicDuck ───────┼─► sum ─► master ─► glue comp
 *   ui voices ─► ui ──────────────────────────────────────────────────┘        ─► limiter ─► ceiling ─► out
 *
 * Reverb sends: every SFX voice has its own send into `sfxSend` (scaled by the room amount of the current
 * ambience); music, ambience and UI have fixed bus sends. The reverb return joins the world bus so the
 * muffle filter and the pause gate act on tails as well.
 */
import { clamp, clamp01 } from '@/core/mathx';
import { setQ } from './synth/kit';
import type { Shared } from './synth/shared';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

/** Slider (0..1) → amplitude. Squared so the slider feels even; 1 → unity. */
export const sliderGain = (v: number): number => {
  const c = clamp01(Number.isFinite(v) ? v : 0);
  return c * c;
};

/** The settings the mix is calibrated at (the game's defaults). */
export const REFERENCE_VOLUMES: Volumes = { master: 0.8, music: 0.7, sfx: 0.9 };

const dB = (d: number): number => Math.pow(10, d / 20);

/** Reverb return level (the impulse has unit energy). */
const REVERB_RETURN = 0.5;

export interface CompParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
  /** the node's built-in make-up gain for these settings (dB), measured by the sandbox "chain" report */
  makeupDb: number;
}

/** Dynamics stages: the score's own peak control, then the master glue compressor into a fast limiter. */
export const DYNAMICS: { music: CompParams; glue: CompParams; limiter: CompParams } = {
  music: { threshold: -17, knee: 8, ratio: 4, attack: 0.003, release: 0.14, makeupDb: 6.1 },
  glue: { threshold: -14, knee: 10, ratio: 2, attack: 0.018, release: 0.22, makeupDb: 2.7 },
  limiter: { threshold: -2.5, knee: 1, ratio: 20, attack: 0.001, release: 0.08, makeupDb: 1.3 },
};

export class Mixer {
  readonly sfx: GainNode;
  readonly ui: GainNode;
  readonly amb: GainNode;
  readonly music: GainNode;
  /** per-voice SFX reverb sends connect here */
  readonly sfxSend: GainNode;
  /** direct reverb input for instruments that want to be wetter than their bus */
  readonly reverbIn: GainNode;

  private readonly ambDuck: GainNode;
  private readonly musicDuck: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly worldGate: GainNode;
  private readonly musicGate: GainNode;
  private readonly reverbTone: BiquadFilterNode;
  private readonly master: GainNode;
  private readonly sum: GainNode;
  private duckUntil = 0;
  private duckDepth = 0;

  constructor(readonly ac: BaseAudioContext, res: Shared, destination?: AudioNode) {
    const g = (v = 1): GainNode => {
      const n = ac.createGain();
      n.gain.value = v;
      return n;
    };
    this.sum = g();
    // --- master dynamics: gentle glue → fast limiter → soft ceiling (never hard-clips) ---
    const comp = (c: CompParams): DynamicsCompressorNode => {
      const n = ac.createDynamicsCompressor();
      n.threshold.value = c.threshold;
      n.knee.value = c.knee;
      n.ratio.value = c.ratio;
      n.attack.value = c.attack;
      n.release.value = c.release;
      return n;
    };
    // WebKit-lineage compressors add fixed make-up gain ((1/fullRangeGain)^0.6). Each stage is trimmed back to
    // unity below its threshold, so "−6 dBFS in" means −6 dBFS out until the dynamics actually work.
    const glue = comp(DYNAMICS.glue);
    const glueTrim = g(dB(-DYNAMICS.glue.makeupDb));
    const limiter = comp(DYNAMICS.limiter);
    const limiterTrim = g(dB(-DYNAMICS.limiter.makeupDb));
    const ceiling = ac.createWaveShaper();
    ceiling.curve = res.curves.ceiling;
    // the master slider sits BEFORE the dynamics so turning it up can never push past the ceiling
    this.master = g();
    this.sum.connect(this.master);
    this.master.connect(glue);
    glue.connect(glueTrim);
    glueTrim.connect(limiter);
    limiter.connect(limiterTrim);
    limiterTrim.connect(ceiling);
    ceiling.connect(destination ?? ac.destination);

    // --- world: sfx + ambience + reverb return through the muffle filter ---
    const world = g();
    this.muffle = ac.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    setQ(this.muffle, 0.707);
    this.worldGate = g();
    world.connect(this.muffle);
    this.muffle.connect(this.worldGate);
    this.worldGate.connect(this.sum);

    this.sfx = g();
    this.sfx.connect(world);
    this.amb = g();
    this.ambDuck = g();
    this.amb.connect(this.ambDuck);
    this.ambDuck.connect(world);

    this.music = g();
    this.musicDuck = g();
    this.musicGate = g();
    // score "mastering" tilt: synthesised low strings and drums pile energy under 250 Hz, so ease the bottom
    // and lift presence — the score sits behind the SFX without turning to mud on small speakers
    const lowShelf = ac.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 160;
    lowShelf.gain.value = -3.5;
    const presence = ac.createBiquadFilter();
    presence.type = 'highshelf';
    presence.frequency.value = 2200;
    presence.gain.value = 5;
    // drums and stabs land together on the bar line: hold those peaks so the score has body without
    // spiking into the SFX's headroom
    const musicComp = comp(DYNAMICS.music);
    const musicTrim = g(dB(-DYNAMICS.music.makeupDb));
    this.music.connect(lowShelf);
    lowShelf.connect(presence);
    presence.connect(musicComp);
    musicComp.connect(musicTrim);
    musicTrim.connect(this.musicDuck);
    this.musicDuck.connect(this.musicGate);
    this.musicGate.connect(this.sum);

    this.ui = g();
    this.ui.connect(this.sum);

    // --- reverb ---
    this.reverbIn = g();
    const conv = ac.createConvolver();
    conv.normalize = false;
    conv.buffer = res.hallIR;
    this.reverbTone = ac.createBiquadFilter();
    this.reverbTone.type = 'lowpass';
    this.reverbTone.frequency.value = 6500;
    setQ(this.reverbTone, 0.707);
    const ret = g(REVERB_RETURN);
    this.reverbIn.connect(conv);
    conv.connect(this.reverbTone);
    this.reverbTone.connect(ret);
    ret.connect(world);

    this.sfxSend = g(0.6);
    this.sfxSend.connect(this.reverbIn);
    const musicSend = g(0.22);
    this.musicDuck.connect(musicSend);
    musicSend.connect(this.reverbIn);
    const ambSend = g(0.3);
    this.ambDuck.connect(ambSend);
    ambSend.connect(this.reverbIn);
    const uiSend = g(0.1);
    this.ui.connect(uiSend);
    uiSend.connect(this.reverbIn);

    this.setVolumes(REFERENCE_VOLUMES, 0);
  }

  /** Apply the three user sliders. Ambience and UI follow the SFX slider. */
  setVolumes(v: Volumes, fade = 0.05): void {
    const now = this.ac.currentTime;
    const set = (p: AudioParam, val: number): void => {
      if (fade <= 0) p.value = val;
      else p.setTargetAtTime(val, now, fade / 3);
    };
    // buses carry (slider gain / reference gain): the recipes are calibrated at the reference settings
    set(this.master.gain, sliderGain(v.master) / sliderGain(REFERENCE_VOLUMES.master));
    set(this.music.gain, sliderGain(v.music) / sliderGain(REFERENCE_VOLUMES.music));
    const s = sliderGain(v.sfx) / sliderGain(REFERENCE_VOLUMES.sfx);
    set(this.sfx.gain, s);
    set(this.amb.gain, s);
    set(this.ui.gain, s);
  }

  /** How reverberant the current space is (0..1.5) and how dark its tail is. Set by the ambience bed. */
  setRoom(amount: number, toneHz: number, fade = 1.5): void {
    const now = this.ac.currentTime;
    this.sfxSend.gain.setTargetAtTime(clamp(amount, 0, 1.5), now, fade / 3);
    this.reverbTone.frequency.setTargetAtTime(clamp(toneHz, 400, 16000), now, fade / 3);
  }

  /** 0..1 "muffled pressure" low-pass on the world bus (sfx, ambience, reverb). */
  setMuffle(amount: number, fade = 0.4): void {
    const m = clamp01(Number.isFinite(amount) ? amount : 0);
    // 20 kHz → 280 Hz, perceptually even
    const hz = 20000 * Math.pow(280 / 20000, Math.pow(m, 0.8));
    const now = this.ac.currentTime;
    this.muffle.frequency.cancelScheduledValues(now);
    this.muffle.frequency.setTargetAtTime(hz, now, Math.max(0.01, fade) / 3);
    // a little resonance at the cutoff as the world closes in (Q is in dB for a low-pass)
    this.muffle.Q.setTargetAtTime(-3 + m * 6, now, Math.max(0.01, fade) / 3);
  }

  /** Lower music + ambience by `amount` (0..1) for `seconds`, then recover. Overlapping ducks extend. */
  duck(amount: number, seconds: number): void {
    const now = this.ac.currentTime;
    const depth = clamp(Number.isFinite(amount) ? amount : 0, 0, 0.95);
    const until = now + clamp(Number.isFinite(seconds) ? seconds : 0, 0, 120);
    if (now < this.duckUntil && depth < this.duckDepth && until <= this.duckUntil) return;
    this.duckDepth = Math.max(depth, now < this.duckUntil ? this.duckDepth : 0);
    this.duckUntil = Math.max(until, this.duckUntil);
    for (const [p, k] of [[this.musicDuck.gain, 1], [this.ambDuck.gain, 0.6]] as Array<[AudioParam, number]>) {
      p.cancelScheduledValues(now);
      p.setTargetAtTime(1 - this.duckDepth * k, now, 0.07);
      p.setTargetAtTime(1, this.duckUntil, 0.35);
    }
  }

  /** Pause: the world freezes (gate closes), music drops back. UI stays crisp. */
  setPaused(paused: boolean): void {
    const now = this.ac.currentTime;
    this.worldGate.gain.cancelScheduledValues(now);
    this.worldGate.gain.setTargetAtTime(paused ? 0 : 1, now, paused ? 0.06 : 0.12);
    this.musicGate.gain.cancelScheduledValues(now);
    this.musicGate.gain.setTargetAtTime(paused ? 0.45 : 1, now, 0.2);
  }
}
