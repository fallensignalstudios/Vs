/**
 * Mix graph. Every bus is a PRE-fader collection point and every reverb RETURNS BEFORE the fader of the bus
 * that fed it, so no signal can reach the output without passing its slider, its duck and its gate:
 *
 *   sfx voices ─► sfx ─────────────────────────┐
 *   ambience ─► amb ─► ambDuck ────────────────┤
 *   near ─► small room ─┐                      ├─► worldFader ─► muffle (LP) ─► worldGate ─┐
 *   room ─► small/hall/vast blend ─► tone ─────┘                                          │
 *   tonal score ─► music ─► tilt EQ ─► levelling ─┐                                       │
 *   drums/stabs/stingers/recordings ─► musicDirect ┤                                      │
 *   scoreSend ─► stage reverb ─────────────────────┼─► musicFader ─► side ─► duck ─► gate ─┼─► sum ─► master
 *   scoreRoom ─► short drum room ──────────────────┘                                      │    ─► 20 Hz guard
 *   ui voices ─► ui (+ uiSend ─► halo) ─► uiFader ─────────────────────────────────────────┤    ─► glue ─► limiter
 *   dialogue ─► voice ─► voiceFader ───────────────────────────────────────────────────────┘    ─► ceiling ─► out
 *
 * The world has three convolution spaces (small / hall / vast); each ambience picks a blend and an amount.
 * Rapid cues send mostly to `near` (early reflections, half a second) so a four-hit combo does not smear;
 * single large events send to `room` and get the long tail. The score has its own stage reverb, returned into
 * the music path — the muffle filter and the pause gate act on world sound only.
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

/** Reverb return level (the impulses have unit energy, so send × return is the wet level). */
const REVERB_RETURN = 0.5;
/**
 * A freshly created DynamicsCompressorNode attenuates for its first ~150 ms. Until this long after the
 * graph is built the dynamics are bypassed (the soft ceiling still protects the output), so the click that
 * unlocked audio is heard at its real level.
 */
export const PRIME_SECONDS = 0.2;
/** how far impacts push the score down (dB) — they read without having to be louder */
const SIDECHAIN_DB = 2.5;

export interface CompParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
  /** the node's built-in make-up gain for these settings (dB), measured by the sandbox "chain" report */
  makeupDb: number;
}

/**
 * Dynamics stages. `music` only levels the tonal score (pads, strings, swells) and is slow enough to let
 * note attacks through — percussion never passes it. Then the master glue compressor into a fast limiter.
 */
export const DYNAMICS: { music: CompParams; glue: CompParams; limiter: CompParams } = {
  music: { threshold: -17, knee: 8, ratio: 2, attack: 0.025, release: 0.25, makeupDb: 3.2 },
  glue: { threshold: -14, knee: 10, ratio: 2, attack: 0.018, release: 0.22, makeupDb: 2.7 },
  limiter: { threshold: -2.5, knee: 1, ratio: 20, attack: 0.001, release: 0.08, makeupDb: 1.3 },
};

/** How much of each world space a place is made of: `[small, hall, vast]` (any scale; normalised here). */
export type SpaceBlend = readonly [number, number, number];

export class Mixer {
  /** dry SFX voices */
  readonly sfx: GainNode;
  /** UI voices (never muffled, never gated) */
  readonly ui: GainNode;
  /** ambience beds */
  readonly amb: GainNode;
  /** tonal score — pads, strings, swells, bells — through the tilt EQ and gentle levelling */
  readonly music: GainNode;
  /** score percussion, stabs, stingers and recorded tracks: nothing between here and the music fader */
  readonly musicDirect: GainNode;
  /** dialogue clips: follow the SFX slider, never muffled or gated */
  readonly voice: GainNode;
  /** early/short world reverb for rapid cues */
  readonly near: GainNode;
  /** the current world space (blend of small / hall / vast), scaled by the ambience's room amount */
  readonly room: GainNode;
  /** score reverb (returns into the music path) */
  readonly scoreSend: GainNode;
  /** short drum room for the score (returns into the music path) */
  readonly scoreRoom: GainNode;
  /** UI halo: a soft stereo echo instead of a hall */
  readonly uiSend: GainNode;
  /** the nodes a signal must pass to be heard — exposed so tests can prove nothing bypasses them */
  readonly faders: { world: GainNode; ui: GainNode; voice: GainNode; music: GainNode; master: GainNode };
  /** gain reduction (dB, ≤ 0) of the score's levelling compressor right now */
  get musicReduction(): number {
    return this.musicComp.reduction ?? 0;
  }

  private readonly ambDuck: GainNode;
  private readonly musicDuck: GainNode;
  private readonly musicSide: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly worldGate: GainNode;
  private readonly musicGate: GainNode;
  private readonly roomTone: BiquadFilterNode;
  private readonly blend: [GainNode, GainNode, GainNode];
  private readonly musicComp: DynamicsCompressorNode;
  private readonly meter: AnalyserNode | null = null;
  private readonly meterData: Float32Array<ArrayBuffer> | null = null;
  private sideEnv = 0;
  private sideGain = 1;
  private duckUntil = 0;
  private duckDepth = 0;

  constructor(readonly ac: BaseAudioContext, res: Shared, destination?: AudioNode) {
    const t0 = ac.currentTime;
    const g = (v = 1): GainNode => {
      const n = ac.createGain();
      n.gain.value = v;
      return n;
    };
    const comp = (c: CompParams): DynamicsCompressorNode => {
      const n = ac.createDynamicsCompressor();
      n.threshold.value = c.threshold;
      n.knee.value = c.knee;
      n.ratio.value = c.ratio;
      n.attack.value = c.attack;
      n.release.value = c.release;
      return n;
    };
    const conv = (buffer: AudioBuffer): ConvolverNode => {
      const n = ac.createConvolver();
      n.normalize = false;
      n.buffer = buffer;
      return n;
    };
    const lowpass = (hz: number): BiquadFilterNode => {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = hz;
      setQ(f, 0.707);
      return f;
    };
    /** `from` → dynamics (`chainIn` … `chainOut`) → `to`, bypassed while the compressors settle. */
    const primed = (from: AudioNode, chainIn: AudioNode, chainOut: AudioNode, to: AudioNode): void => {
      const bypass = g(1);
      const dyn = g(0);
      from.connect(bypass);
      bypass.connect(to);
      from.connect(chainIn);
      chainOut.connect(dyn);
      dyn.connect(to);
      bypass.gain.setValueAtTime(1, t0 + PRIME_SECONDS);
      bypass.gain.linearRampToValueAtTime(0, t0 + PRIME_SECONDS + 0.03);
      dyn.gain.setValueAtTime(0, t0 + PRIME_SECONDS);
      dyn.gain.linearRampToValueAtTime(1, t0 + PRIME_SECONDS + 0.03);
    };

    // --- master: slider → subsonic guard → gentle glue → fast limiter → soft ceiling (never hard-clips) ---
    const sum = g();
    // the master slider sits BEFORE the dynamics so turning it up can never push past the ceiling
    const master = g();
    const guard = ac.createBiquadFilter();
    guard.type = 'highpass';
    guard.frequency.value = 20;
    setQ(guard, 0.707);
    // WebKit-lineage compressors add fixed make-up gain. Each stage is trimmed back to unity below its
    // threshold, so "−6 dBFS in" means −6 dBFS out until the dynamics actually work.
    const glue = comp(DYNAMICS.glue);
    const glueTrim = g(dB(-DYNAMICS.glue.makeupDb));
    const limiter = comp(DYNAMICS.limiter);
    const limiterTrim = g(dB(-DYNAMICS.limiter.makeupDb));
    const ceiling = ac.createWaveShaper();
    ceiling.curve = res.curves.ceiling;
    ceiling.oversample = '4x'; // overshoots are shaped without folding back into the audible band
    sum.connect(master);
    master.connect(guard);
    glue.connect(glueTrim);
    glueTrim.connect(limiter);
    limiter.connect(limiterTrim);
    primed(guard, glue, limiterTrim, ceiling);
    ceiling.connect(destination ?? ac.destination);

    // --- world: sfx + ambience + room reverbs → slider → muffle → pause gate ---
    const worldPre = g();
    const worldFader = g();
    this.muffle = lowpass(20000);
    this.worldGate = g();
    worldPre.connect(worldFader);
    worldFader.connect(this.muffle);
    this.muffle.connect(this.worldGate);
    this.worldGate.connect(sum);

    this.sfx = g();
    this.sfx.connect(worldPre);
    this.amb = g();
    this.ambDuck = g();
    this.amb.connect(this.ambDuck);
    this.ambDuck.connect(worldPre);

    // three spaces; `room` feeds the blend the ambience chose, `near` always feeds the small one
    this.near = g();
    this.room = g(0.6);
    const roomMix = g();
    this.room.connect(roomMix);
    const small = conv(res.rooms.small);
    const hall = conv(res.rooms.hall);
    const vast = conv(res.rooms.vast);
    this.blend = [g(0.3), g(0.9), g(0.3)];
    this.roomTone = lowpass(6500);
    const roomReturn = g(REVERB_RETURN);
    [small, hall, vast].forEach((c, i) => {
      roomMix.connect(this.blend[i]);
      this.blend[i].connect(c);
      c.connect(this.roomTone);
    });
    this.near.connect(small);
    // rapid cues still excite the big space a little, or they would sound pasted on in the atrium
    const nearToRoom = g(0.2);
    this.near.connect(nearToRoom);
    nearToRoom.connect(this.room);
    this.roomTone.connect(roomReturn);
    roomReturn.connect(worldPre);
    const ambSend = g(0.3);
    this.ambDuck.connect(ambSend);
    ambSend.connect(roomMix);

    // --- score ---
    this.music = g();
    this.musicDirect = g();
    const musicPre = g();
    const musicFader = g();
    this.musicSide = g();
    this.musicDuck = g();
    this.musicGate = g();
    // "mastering" tilt for the synthesised ensemble: ease the bottom, lift presence
    const lowShelf = ac.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 160;
    lowShelf.gain.value = -3.5;
    const presence = ac.createBiquadFilter();
    presence.type = 'highshelf';
    presence.frequency.value = 2200;
    presence.gain.value = 5;
    this.musicComp = comp(DYNAMICS.music);
    const musicTrim = g(dB(-DYNAMICS.music.makeupDb));
    this.music.connect(lowShelf);
    lowShelf.connect(presence);
    this.musicComp.connect(musicTrim);
    primed(presence, this.musicComp, musicTrim, musicPre);
    this.musicDirect.connect(musicPre);

    this.scoreSend = g();
    const stage = conv(res.rooms.stage);
    const scoreReturn = g(REVERB_RETURN);
    this.scoreSend.connect(stage);
    stage.connect(scoreReturn);
    scoreReturn.connect(musicPre);
    this.scoreRoom = g();
    const drumRoom = conv(res.rooms.small);
    const drumReturn = g(REVERB_RETURN);
    this.scoreRoom.connect(drumRoom);
    drumRoom.connect(drumReturn);
    drumReturn.connect(musicPre);

    musicPre.connect(musicFader);
    musicFader.connect(this.musicSide);
    this.musicSide.connect(this.musicDuck);
    this.musicDuck.connect(this.musicGate);
    this.musicGate.connect(sum);

    // --- UI: dry + a soft ping-pong halo, all before the fader ---
    this.ui = g();
    const uiFader = g();
    this.ui.connect(uiFader);
    uiFader.connect(sum);
    this.uiSend = g();
    const haloReturn = g(0.55);
    const dl = ac.createDelay(0.5);
    dl.delayTime.value = 0.083;
    const dr = ac.createDelay(0.5);
    dr.delayTime.value = 0.127;
    const fbL = g(0.42);
    const fbR = g(0.42);
    const toneL = lowpass(4200);
    const toneR = lowpass(3600);
    const panL = ac.createStereoPanner();
    panL.pan.value = -0.6;
    const panR = ac.createStereoPanner();
    panR.pan.value = 0.6;
    this.uiSend.connect(dl);
    dl.connect(toneL);
    toneL.connect(panL);
    toneL.connect(fbL);
    fbL.connect(dr);
    dr.connect(toneR);
    toneR.connect(panR);
    toneR.connect(fbR);
    fbR.connect(dl);
    panL.connect(haloReturn);
    panR.connect(haloReturn);
    haloReturn.connect(this.ui);

    // --- dialogue ---
    this.voice = g();
    const voiceFader = g();
    this.voice.connect(voiceFader);
    voiceFader.connect(sum);
    const voiceSend = g(0.06);
    this.voice.connect(voiceSend);
    voiceSend.connect(roomMix);

    this.faders = { world: worldFader, ui: uiFader, voice: voiceFader, music: musicFader, master };

    // --- SFX level meter for the score's sidechain (absent in the test fake and very old browsers) ---
    const make = (ac as unknown as { createAnalyser?: () => AnalyserNode }).createAnalyser;
    if (typeof make === 'function') {
      this.meter = make.call(ac);
      this.meter.fftSize = 1024;
      this.sfx.connect(this.meter);
      this.meterData = new Float32Array(this.meter.fftSize);
    }

    this.setVolumes(REFERENCE_VOLUMES, 0);
  }

  /** Apply the three user sliders. Ambience, UI and dialogue follow the SFX slider. */
  setVolumes(v: Volumes, fade = 0.05): void {
    const now = this.ac.currentTime;
    const set = (p: AudioParam, val: number): void => {
      if (fade <= 0) p.value = val;
      else p.setTargetAtTime(val, now, fade / 3);
    };
    // buses carry (slider gain / reference gain): the recipes are calibrated at the reference settings
    set(this.faders.master.gain, sliderGain(v.master) / sliderGain(REFERENCE_VOLUMES.master));
    set(this.faders.music.gain, sliderGain(v.music) / sliderGain(REFERENCE_VOLUMES.music));
    const s = sliderGain(v.sfx) / sliderGain(REFERENCE_VOLUMES.sfx);
    set(this.faders.world.gain, s);
    set(this.faders.ui.gain, s);
    set(this.faders.voice.gain, s);
  }

  /**
   * The space the listener is in: how reverberant (0..1.5), how dark its tail is, and which of the three
   * rooms it is made of. Set by the ambience bed.
   */
  setRoom(amount: number, toneHz: number, space: SpaceBlend, fade = 1.5): void {
    const now = this.ac.currentTime;
    const tc = Math.max(0.01, fade) / 3;
    const a = clamp(Number.isFinite(amount) ? amount : 0.6, 0, 1.5);
    this.room.gain.setTargetAtTime(a, now, tc);
    // dry rooms keep their early reflections: `near` never falls as far as the tail does
    this.near.gain.setTargetAtTime(0.45 + 0.55 * Math.min(1, a / 0.6), now, tc);
    this.roomTone.frequency.setTargetAtTime(clamp(toneHz, 400, 16000), now, tc);
    // the impulses are decorrelated and unit-energy: normalise the weights so `amount` alone sets the level
    const w = space.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
    const norm = Math.hypot(w[0], w[1], w[2]) || 1;
    for (let i = 0; i < 3; i++) this.blend[i].gain.setTargetAtTime(w[i] / norm, now, tc);
  }

  /** 0..1 "muffled pressure" low-pass on the world bus (sfx, ambience, world reverb). */
  setMuffle(amount: number, fade = 0.4): void {
    const m = clamp01(Number.isFinite(amount) ? amount : 0);
    const f = Number.isFinite(fade) ? fade : 0.4;
    // 20 kHz → 280 Hz, perceptually even
    const hz = 20000 * Math.pow(280 / 20000, Math.pow(m, 0.8));
    const now = this.ac.currentTime;
    this.muffle.frequency.cancelScheduledValues(now);
    this.muffle.frequency.setTargetAtTime(hz, now, Math.max(0.01, f) / 3);
    // a little resonance at the cutoff as the world closes in (Q is in dB for a low-pass)
    this.muffle.Q.setTargetAtTime(-3 + m * 6, now, Math.max(0.01, f) / 3);
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

  /**
   * Sidechain: follow the SFX bus level and lean the score back by up to 2.5 dB under impacts, recovering in
   * a quarter of a second. Called once per update(); costs one 1024-sample read.
   */
  update(dt: number): void {
    const m = this.meter;
    const data = this.meterData;
    if (!m || !data || !(dt > 0)) return;
    m.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = data[i] < 0 ? -data[i] : data[i];
      if (a > peak) peak = a;
    }
    if (!Number.isFinite(peak)) return;
    // instant attack, ~250 ms release
    this.sideEnv = Math.max(peak, this.sideEnv * Math.exp(-Math.min(dt, 0.5) / 0.25));
    // nothing below −26 dBFS moves the score; full depth from −8 dBFS up
    const level = this.sideEnv > 1e-5 ? 20 * Math.log10(this.sideEnv) : -100;
    const k = clamp01((level + 26) / 18);
    const target = dB(-SIDECHAIN_DB * k);
    if (Math.abs(target - this.sideGain) < 0.004) return;
    this.sideGain = target;
    this.musicSide.gain.setTargetAtTime(target, this.ac.currentTime, 0.03);
  }
}
