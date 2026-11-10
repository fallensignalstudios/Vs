/**
 * Voice-over playback. One line at a time, on the dialogue bus (follows the SFX slider; never muffled, never
 * gated by pause), with a treatment per channel:
 *
 *   voice      clip ─► trim ─► 70 Hz high-pass ─► spot (pan + level by position) ─► dialogue bus
 *   radio      clip ─► trim ─► 420 Hz–3.1 kHz band ─► soft clip ─► spot ─► dialogue bus
 *   system     clip ─► trim ─► 260 Hz–4.4 kHz band ─► lighter clip ─► 9 ms comb ─► dialogue bus (centred)
 *   narration  clip ─► trim ─► straight to the dialogue fader: dry (no room send) and centred
 *
 * A positional line pans gently toward its speaker (at most ±0.45) and loses at most 30 % of its level with
 * distance: dialogue is information, it must never be lost to staging.
 *
 * While a line plays the score and the ambience are ducked. A line whose clip is listed but not decoded yet
 * is started the moment it arrives (preloadVoices exists so that this is rare); if that takes longer than
 * a breath the line stays silent rather than run into the next one.
 */
import { clamp, clamp01 } from '@/core/mathx';
import type { Vec3Like, VoiceOpts } from '@/core/api';
import { setQ } from '../synth/kit';
import type { Mixer } from '../mixer';
import type { AssetLibrary, VoiceClip } from './library';
import { voLineId } from './voiceId';

export type VoiceChannel = NonNullable<VoiceOpts['channel']>;

/** how far the score drops under a spoken line (ambience drops by 60 % of this) */
const VOICE_DUCK = 0.5;
/** a clip that arrives later than this after its line began is not started (s) */
const MAX_LATE = 0.6;
/** the same line asked for again within this window is the same utterance (s) */
const SAME_LINE = 0.3;
const MAX_PAN = 0.45;
const MIN_LEVEL = 0.7;
/** level of each channel's chain relative to the dry voice, set so the treated line reads as loud (measured) */
const CHANNEL_TRIM: Readonly<Record<VoiceChannel, number>> = { voice: 1, radio: 1.25, system: 1.1, narration: 1 };
const CHANNELS: readonly VoiceChannel[] = ['voice', 'radio', 'system', 'narration'];

interface Line {
  id: string;
  /** context time voice() was called */
  asked: number;
  seconds: number;
  channel: VoiceChannel;
  pos: { x: number; y: number; z: number } | null;
  /** context time the clip started sounding (Infinity until it has) */
  startedAt: number;
  /** context time the clip stops sounding (asked + seconds until it actually starts) */
  endAt: number;
  cancelled: boolean;
  src: AudioBufferSourceNode | null;
  trim: GainNode | null;
  base: number;
  spot: GainNode | null;
  pan: StereoPannerNode | null;
  nodes: AudioNode[];
}

export class VoicePlayer {
  private line: Line | null = null;
  private readonly ending: Line[] = [];
  private readonly lpos = { x: 0, y: 0, z: 0 };
  private readonly lfwd = { x: 0, z: -1 };
  private curve: Float32Array<ArrayBuffer> | null = null;

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly mixer: Mixer,
    private readonly library: AssetLibrary | null,
  ) {}

  /** id of the line being spoken (or about to be), or null */
  get speaking(): string | null {
    return this.line ? this.line.id : null;
  }

  /**
   * Speak the recording of `text` by `speaker` if there is one. Returns its length in seconds, or 0 when
   * the line has no recording (the caller plays the comm tick instead).
   */
  say(speaker: string, text: string, opts?: VoiceOpts): number {
    const lib = this.library;
    if (!lib) return 0;
    const id = voLineId(speaker, text);
    const now = this.ac.currentTime;
    // the mission and the dialogue event both announce a line: that is one utterance, not two
    if (this.line && this.line.id === id && now - this.line.asked < SAME_LINE) return this.line.seconds;
    const meta = lib.voiceMeta(id);
    if (!meta) {
      if (!lib.voicesKnown) void lib.loadVoices();
      return 0;
    }
    this.stop(0.06);
    const clip = lib.clip(id);
    const channel = opts?.channel && CHANNELS.includes(opts.channel) ? opts.channel : 'voice';
    const p = opts?.pos;
    const seconds = clip ? clip.buffer.duration : meta.seconds;
    const line: Line = {
      id, asked: now, seconds, channel, startedAt: Infinity, endAt: now + seconds, cancelled: false,
      pos: p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? { x: p.x, y: p.y, z: p.z } : null,
      src: null, trim: null, base: 1, spot: null, pan: null, nodes: [],
    };
    this.line = line;
    if (clip) this.start(line, clip, now);
    else {
      void lib.requestClip(id).then((c) => {
        if (this.line !== line || line.cancelled) return;
        const t = this.ac.currentTime;
        if (c && t - line.asked <= MAX_LATE) this.start(line, c, t);
        else this.line = null;
      });
    }
    this.mixer.duck(VOICE_DUCK, seconds + 0.2);
    return seconds;
  }

  /** Soft-clip curve shared by the comm treatments. */
  private shaper(): WaveShaperNode {
    if (!this.curve) {
      const n = 513;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = Math.tanh(2.2 * ((i / (n - 1)) * 2 - 1)) / Math.tanh(2.2);
      this.curve = c;
    }
    const w = this.ac.createWaveShaper();
    w.curve = this.curve;
    w.oversample = '2x';
    return w;
  }

  private filter(type: BiquadFilterType, hz: number, q = 0.707): BiquadFilterNode {
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    setQ(f, q);
    return f;
  }

  private gain(v: number): GainNode {
    const g = this.ac.createGain();
    g.gain.value = v;
    return g;
  }

  /** Where a positional line sits: pan −1..1 (already scaled) and level 0.7..1. */
  private place(pos: { x: number; z: number }): { pan: number; level: number } {
    const dx = pos.x - this.lpos.x;
    const dz = pos.z - this.lpos.z;
    const d = Math.hypot(dx, dz);
    const f = Math.hypot(this.lfwd.x, this.lfwd.z);
    // the listener's right in the ground plane is (−fz, fx)
    const side = d > 0.01 && f > 1e-6 ? (dx * -this.lfwd.z + dz * this.lfwd.x) / (d * f) : 0;
    // someone at arm's length is in front of you whichever way the camera happens to point
    const pan = clamp(side, -1, 1) * MAX_PAN * clamp01((d - 0.5) / 2.5);
    return { pan, level: 1 - (1 - MIN_LEVEL) * clamp01((d - 4) / 26) };
  }

  private start(line: Line, clip: VoiceClip, at: number): void {
    const ac = this.ac;
    const src = ac.createBufferSource();
    src.buffer = clip.buffer;
    const base = clip.gain * CHANNEL_TRIM[line.channel];
    const trim = this.gain(0);
    trim.gain.setValueAtTime(0, at);
    trim.gain.linearRampToValueAtTime(base, at + 0.008);
    src.connect(trim);
    const nodes: AudioNode[] = [trim];
    let tail: AudioNode = trim;
    const through = (n: AudioNode): void => {
      tail.connect(n);
      nodes.push(n);
      tail = n;
    };
    if (line.channel === 'radio') {
      through(this.filter('highpass', 420));
      through(this.filter('lowpass', 3100, 0.9));
      through(this.gain(2.6));
      through(this.shaper());
      through(this.gain(0.5));
    } else if (line.channel === 'system') {
      through(this.filter('highpass', 260));
      through(this.filter('lowpass', 4400));
      through(this.gain(1.7));
      through(this.shaper());
      // a 9 ms doubling: the faint metallic ring of a voice that comes out of a wall
      const dry: AudioNode = tail;
      const comb = ac.createDelay(0.05);
      comb.delayTime.value = 0.009;
      const wet = this.gain(0.35);
      const sum = this.gain(0.6);
      dry.connect(comb);
      comb.connect(wet);
      wet.connect(sum);
      nodes.push(comb, wet);
      through(sum);
    } else if (line.channel === 'voice') {
      through(this.filter('highpass', 70));
    }
    if (line.channel === 'narration') {
      // past the bus (and its room send), straight to the dialogue fader
      tail.connect(this.mixer.faders.voice);
    } else {
      const spot = this.gain(1);
      const pan = ac.createStereoPanner();
      // comm channels have no place in the room unless the caller gives them one
      const where = line.pos && line.channel !== 'system' ? this.place(line.pos) : { pan: 0, level: 1 };
      spot.gain.value = where.level;
      pan.pan.value = where.pan;
      through(spot);
      through(pan);
      tail.connect(this.mixer.voice);
      line.spot = spot;
      line.pan = pan;
    }
    src.start(at);
    src.stop(at + clip.buffer.duration + 0.05);
    line.src = src;
    line.trim = trim;
    line.base = base;
    line.nodes = nodes;
    line.startedAt = at;
    line.endAt = at + clip.buffer.duration;
  }

  /** Cut the current line (cinematic skip, a new line taking the stage). */
  stop(fadeSeconds = 0.15): void {
    const line = this.line;
    if (!line) return;
    this.line = null;
    line.cancelled = true;
    if (!line.src || !line.trim) return;
    const now = this.ac.currentTime;
    const fade = clamp(Number.isFinite(fadeSeconds) ? fadeSeconds : 0.15, 0.01, 5);
    const g = line.trim.gain;
    g.cancelScheduledValues(now);
    // (a line cut inside its own 8 ms fade-in was not at level yet)
    g.setValueAtTime(line.base * clamp01((now - line.startedAt) / 0.008), now);
    g.linearRampToValueAtTime(0, now + fade);
    try {
      line.src.stop(now + fade + 0.02);
    } catch {
      /* already ended */
    }
    line.endAt = Math.min(line.endAt, now + fade + 0.02);
    this.ending.push(line);
  }

  /** Make sure the clips of these `[speaker, text]` lines are decoded. Never rejects. */
  preload(lines: ReadonlyArray<readonly [string, string]>): Promise<void> {
    const lib = this.library;
    if (!lib) return Promise.resolve();
    return preloadLines(lib, lines);
  }

  setListener(pos: Vec3Like, forward: Vec3Like): void {
    this.lpos.x = pos.x;
    this.lpos.y = pos.y;
    this.lpos.z = pos.z;
    this.lfwd.x = forward.x;
    this.lfwd.z = forward.z;
  }

  private release(line: Line): void {
    for (const n of line.nodes) n.disconnect();
    line.nodes = [];
  }

  /** Per-frame upkeep: follow the listener with a positional line, release finished ones. */
  update(): void {
    const now = this.ac.currentTime;
    const line = this.line;
    if (line) {
      if (line.src && now > line.endAt + 0.25) {
        this.release(line);
        this.line = null;
      } else if (line.pos && line.pan && line.spot) {
        const where = this.place(line.pos);
        line.pan.pan.setTargetAtTime(where.pan, now, 0.12);
        line.spot.gain.setTargetAtTime(where.level, now, 0.12);
      }
    }
    for (let i = this.ending.length - 1; i >= 0; i--) {
      if (now < this.ending[i].endAt + 0.1) continue;
      this.release(this.ending[i]);
      this.ending.splice(i, 1);
    }
  }

  dispose(): void {
    this.stop(0.01);
    for (const l of this.ending) this.release(l);
    this.ending.length = 0;
  }
}

/** Decode the clips of `[speaker, text]` lines (lines without a recording are skipped). Never rejects. */
export function preloadLines(library: AssetLibrary, lines: ReadonlyArray<readonly [string, string]>): Promise<void> {
  if (!Array.isArray(lines)) return Promise.resolve();
  const jobs: Array<Promise<unknown>> = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Array.isArray(l) || typeof l[0] !== 'string' || typeof l[1] !== 'string') continue;
    const id = voLineId(l[0], l[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    jobs.push(library.requestClip(id));
  }
  return Promise.all(jobs).then(() => undefined, () => undefined);
}
