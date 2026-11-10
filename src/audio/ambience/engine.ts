/**
 * Ambience engine: one bed deck at a time, cross-faded on change. Beds are continuous filtered-noise and
 * tone layers (built wide: two decorrelated copies left/right); events are ordinary positional SFX thrown at
 * random bearings around the listener on a randomised schedule checked from `update()`.
 */
import { clamp, mulberry32 } from '@/core/mathx';
import type { AmbienceId } from '@/core/api';
import { Kit } from '../synth/kit';
import type { Shared } from '../synth/shared';
import type { Mixer } from '../mixer';
import type { Voices } from '../voices';
import { dbToGain } from '../sfx/recipe';
import { Fader } from '../music/deck';
import { AMBIENCE, type AmbDef } from './defs';

const UNCALIBRATED = 12;
/** Brown noise carries far more energy per unit gain than a band of pink: trim it so the rumble sits under. */
const COLOR_TRIM = { brown: 0.18, pink: 1, white: 0.8, crackle: 1 } as const;
const TONE_TRIM = 0.12;

class BedDeck {
  readonly out: GainNode;
  readonly fader: Fader;
  endAt = Infinity;
  private readonly kit: Kit;
  private readonly next: number[];

  constructor(ac: BaseAudioContext, res: Shared, mixer: Mixer, readonly def: AmbDef, readonly gain: number, start: number, private readonly rnd: () => number) {
    this.out = ac.createGain();
    this.out.connect(mixer.amb);
    this.fader = new Fader(this.out.gain, 0);
    const k = (this.kit = new Kit(ac, res, this.out, start, 1, rnd, true));
    const hold = { a: 0.5, h: Infinity, d: 0.5 };
    // One oscillator per LFO rate, shared by every layer that moves at it (a bed whose layers all breathe at
    // 0.17 Hz needs one LFO, not seven); each use gets its own depth.
    const lfos = new Map<number, OscillatorNode>();
    const lfo = (rate: number, depth: number, target: AudioParam): void => {
      let o = lfos.get(rate);
      if (!o) {
        const g0 = ac.createGain();
        g0.gain.value = 0; // a parking connection: `Kit.lfo` wants a first target
        o = k.lfo(rate, 0, g0.gain);
        lfos.set(rate, o);
      }
      const d = ac.createGain();
      d.gain.value = depth;
      o.connect(d);
      d.connect(target);
    };

    for (const b of def.beds) {
      // equal-loudness-ish trim per colour so `g` reads as "how present", not "how much energy"
      // low rumble stays mono and centred (decorrelated bass is phasey); everything above it is built wide
      const mono = b.type === 'lowpass' && b.f < 250;
      const g = b.g * COLOR_TRIM[b.color] * (mono ? 1 : 0.7);
      for (const side of mono ? [0] : [-1, 1]) {
        const level = k.gain(g, k.pan(side * 0.75));
        if (b.am) {
          level.gain.value = g * (1 - b.am[1] * 0.5);
          lfo(b.am[0], g * b.am[1] * 0.5, level.gain);
        }
        const f = k.filter(b.type, b.f, b.q ?? 0.707, { to: level });
        // the two sides sweep in opposite directions: the image moves without a second oscillator
        if (b.fm) lfo(b.fm[0], b.fm[1] * (side < 0 ? -1 : 1), f.frequency);
        k.noise(b.color, { ...hold, g: 1 }, { to: f, rate: b.rate });
      }
    }
    for (const t of def.tones ?? []) {
      // a steady tone reads far louder than noise at the same gain: tones sit well inside the bed
      const g = t.g * TONE_TRIM;
      const level = k.gain(g);
      if (t.am) {
        level.gain.value = g * (1 - t.am[1] * 0.5);
        lfo(t.am[0], g * t.am[1] * 0.5, level.gain);
      }
      const dst: AudioNode = t.lp ? k.filter('lowpass', t.lp, 0.7, { to: level }) : level;
      if (t.beat) {
        k.osc(t.wave, t.f, { ...hold, g: 0.7 }, { to: dst, pan: -0.5 });
        k.osc(t.wave, t.f + t.beat, { ...hold, g: 0.7 }, { to: dst, pan: 0.5 });
      } else {
        k.osc(t.wave, t.f, { ...hold, g: 1 }, { to: dst });
      }
    }
    // first occurrence of each event lands early so a short visit still hears the space live
    this.next = (def.events ?? []).map((e) => start + 0.6 + rnd() * Math.min(e.every[0] + 2, e.every[1]) * 0.7);
  }

  /** Fire any events that are due. */
  events(now: number, voices: Voices): void {
    const evs = this.def.events;
    if (!evs || now >= this.endAt) return;
    for (let i = 0; i < evs.length; i++) {
      if (now < this.next[i]) continue;
      const e = evs[i];
      const r = this.rnd;
      voices.playAround(e.id, e.dist[0] + r() * (e.dist[1] - e.dist[0]), e.vol ? e.vol[0] + r() * (e.vol[1] - e.vol[0]) : 1);
      this.next[i] = now + e.every[0] + r() * (e.every[1] - e.every[0]);
    }
  }

  dispose(at: number): void {
    this.kit.stopAll(at);
    this.out.disconnect();
  }
}

export class AmbienceEngine {
  private id: AmbienceId = 'none';
  private deck: BedDeck | null = null;
  private readonly fading: BedDeck[] = [];
  private readonly rnd: () => number;
  private readonly warned = new Set<string>();
  /** false = beds only (the sandbox measures bed loudness without the random events on top) */
  eventsEnabled = true;

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly res: Shared,
    private readonly mixer: Mixer,
    private readonly voices: Voices,
    seed: number,
    private readonly norm: Readonly<Record<string, number>>,
  ) {
    this.rnd = mulberry32(seed);
  }

  get current(): AmbienceId {
    return this.id;
  }

  set(id: AmbienceId, fadeSeconds = 2): void {
    if (id === this.id) return;
    const def = id === 'none' ? null : (AMBIENCE as Record<string, AmbDef | undefined>)[id] ?? null;
    if (id !== 'none' && !def && !this.warned.has(id)) {
      this.warned.add(id);
      console.warn(`[audio] unknown ambience "${id}" — none`);
    }
    const now = this.ac.currentTime;
    const fade = clamp(Number.isFinite(fadeSeconds) ? fadeSeconds : 2, 0.05, 30);
    if (this.deck) {
      this.deck.fader.fade(now, now, fade, 0);
      this.deck.endAt = now + fade;
      this.fading.push(this.deck);
      this.deck = null;
    }
    this.id = def ? id : 'none';
    if (!def) {
      this.mixer.setRoom(0.6, 6500, [0.3, 0.9, 0.3], fade);
      return;
    }
    const gain = (this.norm[id] ?? UNCALIBRATED) * dbToGain(def.db);
    this.deck = new BedDeck(this.ac, this.res, this.mixer, def, gain, now + 0.02, this.rnd);
    this.deck.fader.fade(now, now + 0.02, fade, gain);
    this.mixer.setRoom(def.room * 0.6, def.tone, def.space, fade);
  }

  update(): void {
    const now = this.ac.currentTime;
    if (this.eventsEnabled) this.deck?.events(now, this.voices);
    for (let i = this.fading.length - 1; i >= 0; i--) {
      if (now >= this.fading[i].endAt + 0.1) {
        this.fading[i].dispose(now + 0.02);
        this.fading.splice(i, 1);
      }
    }
  }
}
