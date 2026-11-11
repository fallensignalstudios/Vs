/**
 * Voice-over playback. One line at a time, on the dialogue bus (follows the SFX slider; never muffled, never
 * gated by pause), with a treatment per channel:
 *
 *   voice      clip ─► trim ─► 70 Hz high-pass ─► spot (pan + level by position) ─► dialogue bus
 *   radio      clip ─► trim ─► 300 Hz–3.4 kHz band (4th order) ─► 1.8 kHz presence ─► light soft clip ─► spot
 *              ─► dialogue bus, bracketed by the comm squelch (open as it starts, close as it ends)
 *   system     never voiced: displays, status boards, alerts and the terminal are text only (STORY rule)
 *   narration  clip ─► trim ─► straight to the dialogue fader: dry (no room send) and centred
 *
 * Comm voices — Cross, Sol, Caelus, the Commands — are radio even when a line forgets to say so, as long as
 * nobody stands in the scene to speak it (no position, or `offscreen`).
 *
 * A positional line pans gently toward its speaker (at most ±0.45) and loses at most 30 % of its level with
 * distance: dialogue is information, it must never be lost to staging.
 *
 * Pausing the game holds the line (it resumes a fifth of a second back from where it stopped), so a subtitle
 * that froze with the simulation still has its voice when it thaws.
 *
 * While a line plays the score drops ~6 dB (fast in, slow back) and the ambience 60 % of that.
 *
 * A line is voiced only when its recording is certain: the compressed file has been fetched and checked
 * (AssetLibrary.prefetchVoices on `zone:loading`) or the clip is decoded. Its decode then happens as it is
 * spoken (a few ms) and it always starts, however long that took. A listed line whose file has not been
 * fetched yet returns 0 — the subtitle gets its reading time and the comm tick — and is fetched for next time;
 * a listed file that is missing or broken is reported once and stays unvoiced. So a subtitle never holds for
 * a manifest length in silence (the one exception: a file that passed the check and still fails to decode).
 */
import { clamp, clamp01 } from '@/core/mathx';
import type { Vec3Like, VoiceOpts } from '@/core/api';
import { setQ } from '../synth/kit';
import type { Mixer } from '../mixer';
import type { AssetLibrary, VoiceClip } from './library';
import { voLineId } from './voiceId';

export type VoiceChannel = NonNullable<VoiceOpts['channel']>;

/** how far the score drops under a spoken line, −6 dB (ambience drops by 60 % of this) */
const VOICE_DUCK = 0.5;
/** the score comes back this slowly after a line (time constant, s): ~1.5 s to recover */
const VOICE_DUCK_RELEASE = 0.5;
/** speakers heard only over comms: radio treatment whenever they are not standing in the scene */
const COMM_SPEAKERS = new Set(['cross', 'sol', 'caelus', 'dominion command', 'reformation command', 'command']);
/** speakers that are displays, never voices */
const TEXT_SPEAKERS = new Set(['terminal', 'command strip', 'record', 'crownwatch display', 'fleet channel', 'fleet alert', 'hangar alert', 'system']);
/** the same line asked for again within this window is the same utterance (s) */
const SAME_LINE = 0.3;
const MAX_PAN = 0.45;
const MIN_LEVEL = 0.7;
/**
 * Trim of each channel's chain, set by measurement (sandbox/audioassets report) so that all four read
 * equally loud: the panner costs 3 dB at centre, the band-limited chains lose their lows and gain clip.
 */
const CHANNEL_TRIM: Readonly<Record<VoiceChannel, number>> = { voice: 1.41, radio: 1.3, system: 1.15, narration: 1 };
const CHANNELS: readonly VoiceChannel[] = ['voice', 'radio', 'system', 'narration'];

/** Cue the player asks its owner to play around a comm line (the squelch). */
export type VoiceCue = (id: 'commOpen' | 'commClose') => void;

/** Should this line be heard at all? Display channels and display speakers never are. */
export function isVoicedLine(speaker: string, channel: VoiceOpts['channel']): boolean {
  if (channel === 'system') return false;
  return !TEXT_SPEAKERS.has(String(speaker ?? '').trim().toLowerCase());
}

/** The treatment a line gets: its own channel, except a comm voice with nobody in the scene to speak it. */
export function voiceChannel(speaker: string, opts?: VoiceOpts): VoiceChannel {
  const c = opts?.channel && CHANNELS.includes(opts.channel) ? opts.channel : 'voice';
  if (c !== 'voice') return c;
  const comm = COMM_SPEAKERS.has(String(speaker ?? '').trim().toLowerCase());
  return comm && (!opts?.pos || opts.offscreen === true) ? 'radio' : 'voice';
}

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
  /** the comm squelch has opened for this line (so it closes at its end) */
  keyed: boolean;
  clip: VoiceClip | null;
  src: AudioBufferSourceNode | null;
  trim: GainNode | null;
  base: number;
  spot: GainNode | null;
  pan: StereoPannerNode | null;
  nodes: AudioNode[];
}

export class VoicePlayer {
  private line: Line | null = null;
  private readonly ending: Array<{ nodes: AudioNode[]; endAt: number }> = [];
  private readonly lpos = { x: 0, y: 0, z: 0 };
  private readonly lfwd = { x: 0, z: -1 };
  private curve: Float32Array<ArrayBuffer> | null = null;
  private paused = false;
  /** position (s into the clip) the held line resumes from; −1 = nothing is held */
  private heldAt = -1;

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly mixer: Mixer,
    private readonly library: AssetLibrary | null,
    private readonly cue: VoiceCue | null = null,
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
    // displays, alerts and the terminal are read, never heard
    if (!isVoicedLine(speaker, opts?.channel)) return 0;
    const id = voLineId(speaker, text);
    const now = this.ac.currentTime;
    // the mission and the dialogue event both announce a line: that is one utterance, not two
    if (this.line && this.line.id === id && now - this.line.asked < SAME_LINE) return this.line.seconds;
    const meta = lib.voiceMeta(id);
    // not recorded — or listed, but the file proved unusable
    if (!meta || lib.clipMissing(id)) {
      if (!lib.voicesKnown) void lib.loadVoices();
      return 0;
    }
    const clip = lib.clip(id);
    // listed, but its file is not here yet: a subtitle this time, the recording next time
    if (!clip && !lib.clipBytesReady(id)) {
      void lib.fetchClip(id);
      return 0;
    }
    this.stop(0.06);
    const channel = voiceChannel(speaker, opts);
    const p = opts?.pos;
    const seconds = clip ? clip.buffer.duration : meta.seconds;
    const line: Line = {
      id, asked: now, seconds, channel, startedAt: Infinity, endAt: now + seconds, cancelled: false, keyed: false,
      pos: p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? { x: p.x, y: p.y, z: p.z } : null,
      clip, src: null, trim: null, base: 1, spot: null, pan: null, nodes: [],
    };
    this.line = line;
    if (clip) this.start(line, clip, now);
    else {
      // the bytes are here: decode now and start the moment it is done — never dropped as late
      void lib.requestClip(id).then((c) => {
        if (this.line !== line || line.cancelled) return;
        const t = this.ac.currentTime;
        // (a decode slower than the whole line: its subtitle is gone, so is the moment)
        if (!c || t - line.asked > line.seconds) this.line = null;
        else if (this.paused) {
          line.clip = c;
          this.heldAt = 0;
        } else this.start(line, c, t);
      }).catch(() => {
        // the graph refused the clip: the line stays a subtitle
        if (this.line === line) this.line = null;
      });
    }
    this.mixer.duck(VOICE_DUCK, seconds + 0.2, VOICE_DUCK_RELEASE);
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

  private start(line: Line, clip: VoiceClip, at: number, offset = 0): void {
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
      // a handset: 300 Hz–3.4 kHz at 24 dB/oct, the honk of a small speaker, and only a little drive — the
      // words must stay clean (the old chain clipped every peak)
      through(this.filter('highpass', 300, 0.54));
      through(this.filter('highpass', 300, 1.31));
      through(this.filter('lowpass', 3400, 0.54));
      through(this.filter('lowpass', 3400, 1.31));
      const honk = this.filter('peaking', 1800, 1.1);
      honk.gain.value = 3;
      through(honk);
      through(this.gain(1.8));
      through(this.shaper());
      through(this.gain(0.68));
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
    src.start(at, offset);
    src.stop(at + clip.buffer.duration - offset + 0.05);
    if (line.channel === 'radio' && !line.keyed && offset === 0) {
      line.keyed = true;
      this.cue?.('commOpen');
    }
    // the duck follows the clip as it really sounds (a decode may have delayed it)
    this.mixer.duck(VOICE_DUCK, clip.buffer.duration - offset + 0.2, VOICE_DUCK_RELEASE);
    line.clip = clip;
    line.src = src;
    line.trim = trim;
    line.base = base;
    line.nodes = nodes;
    line.startedAt = at - offset;
    line.endAt = line.startedAt + clip.buffer.duration;
  }

  /** Fade a sounding line's chain to silence and hand it to the clean-up list. */
  private silence(line: Line, fade: number): void {
    if (!line.src || !line.trim) return;
    const now = this.ac.currentTime;
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
    this.ending.push({ nodes: line.nodes, endAt: now + fade + 0.02 });
    line.src = null;
    line.trim = null;
    line.spot = null;
    line.pan = null;
    line.nodes = [];
  }

  /** Game paused / resumed: hold the line being spoken and pick it up again. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    const line = this.line;
    const now = this.ac.currentTime;
    if (paused) {
      if (!line || !line.src || !line.clip) return;
      const at = now - line.startedAt;
      if (at >= line.clip.buffer.duration - 0.1) return; // as good as said
      this.silence(line, 0.05);
      this.heldAt = Math.max(0, at - 0.2);
    } else if (this.heldAt >= 0) {
      const at = this.heldAt;
      this.heldAt = -1;
      if (line && line.clip && !line.cancelled) this.start(line, line.clip, now, at);
    }
  }

  /** Cut the current line (cinematic skip, a new line taking the stage). */
  stop(fadeSeconds = 0.15): void {
    const line = this.line;
    if (!line) return;
    this.line = null;
    this.heldAt = -1;
    line.cancelled = true;
    this.silence(line, clamp(Number.isFinite(fadeSeconds) ? fadeSeconds : 0.15, 0.01, 5));
  }

  /** Make sure the files of these `[speaker, text]` lines are fetched (each decodes as it is spoken). Never rejects. */
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

  private release(line: { nodes: AudioNode[] }): void {
    for (const n of line.nodes) n.disconnect();
    line.nodes = [];
  }

  /** Per-frame upkeep: follow the listener with a positional line, release finished ones. */
  update(): void {
    const now = this.ac.currentTime;
    const line = this.line;
    if (line) {
      // the squelch closes as a line that was said to the end finishes
      if (line.keyed && line.src && now >= line.endAt - 0.03) {
        line.keyed = false;
        this.cue?.('commClose');
      }
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

/** Fetch the files of `[speaker, text]` lines (lines without a recording are skipped). Never rejects. */
export function preloadLines(library: AssetLibrary, lines: ReadonlyArray<readonly [string, string]>): Promise<void> {
  if (!Array.isArray(lines)) return Promise.resolve();
  const jobs: Array<Promise<unknown>> = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Array.isArray(l) || typeof l[0] !== 'string' || typeof l[1] !== 'string') continue;
    const id = voLineId(l[0], l[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    jobs.push(library.fetchClip(id));
  }
  return Promise.all(jobs).then(() => undefined, () => undefined);
}
