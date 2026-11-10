/**
 * Screen feedback state (CPU side): pulse envelopes and the smoothed corruption level.
 * Pure logic — the ScreenFeedbackEffect reads the summed values every frame.
 *
 * Accessibility: `reduceFlash` dims pulses, slows their onset and all but removes the full-frame wash;
 * `reduceDistortion` removes the UV warp and chromatic fringing and stills the veining while keeping the
 * violet edge readable.
 */
import type { ScreenPulse } from '@/core/api';

interface PulseDef {
  /** additive glow hugging the frame edges, linear HDR RGB at strength 1 */
  glow: readonly [number, number, number];
  /** flat additive wash over the whole frame, linear HDR RGB at strength 1 */
  wash: readonly [number, number, number];
  /** colour the frame edges are pulled toward (multiplied by the pixel's luminance), and how strongly */
  tint: readonly [number, number, number];
  tintAmount: number;
  /** multiplicative edge darkening (impact weight) */
  darken: number;
  /** transient chromatic aberration */
  chroma: number;
  /** crystalline rim pattern (frost) */
  frost: number;
  /** seconds to reach full strength / to fall to ~8 % */
  attack: number;
  decay: number;
}

/**
 * BRIEF palette, linear. Values are for strength 1 and deliberately small: a pulse should tint the outer edge
 * of the frame, not paint a border (callers may pass up to strength 2). Only `flash` washes the frame.
 */
export const PULSES: Readonly<Record<ScreenPulse, PulseDef>> = {
  // damage: the edges sink into a dark blood red — weight, not neon (the glow keeps it readable on black stone)
  hit: { glow: [0.07, 0.002, 0], wash: [0.004, 0, 0], tint: [0.85, 0.045, 0.035], tintAmount: 0.72, darken: 0.45, chroma: 1.4, frost: 0, attack: 0.03, decay: 0.55 },
  // sustain: a soft warm-green breath
  heal: { glow: [0.02, 0.05, 0.03], wash: [0.002, 0.005, 0.003], tint: [0.85, 1.2, 0.95], tintAmount: 0.12, darken: 0, chroma: 0, frost: 0, attack: 0.14, decay: 0.9 },
  // Eclipse pressure spike (the sustained state is setCorruption)
  corruption: { glow: [0.025, 0.006, 0.098], wash: [0, 0, 0], tint: [0.7, 0.4, 1.5], tintAmount: 0.35, darken: 0.35, chroma: 1.2, frost: 0, attack: 0.08, decay: 0.8 },
  // Selene's Frost: still, pale, crystalline
  frost: { glow: [0.042, 0.07, 0.098], wash: [0.004, 0.007, 0.009], tint: [0.8, 1.0, 1.3], tintAmount: 0.2, darken: 0, chroma: 0.3, frost: 1, attack: 0.07, decay: 1.1 },
  // Tarrik's Cinder: orange heat at the edges
  cinder: { glow: [0.112, 0.032, 0.004], wash: [0.01, 0.003, 0], tint: [1.5, 0.7, 0.3], tintAmount: 0.18, darken: 0.06, chroma: 0.5, frost: 0, attack: 0.04, decay: 0.6 },
  // white-out (detonations, the Witness cut)
  flash: { glow: [0.07, 0.07, 0.063], wash: [0.5, 0.48, 0.44], tint: [1, 1, 1], tintAmount: 0, darken: 0, chroma: 0.4, frost: 0, attack: 0.02, decay: 0.45 },
  // ancient recognition: warm gold, slow
  gold: { glow: [0.098, 0.063, 0.021], wash: [0.012, 0.008, 0.003], tint: [1.3, 1.0, 0.55], tintAmount: 0.15, darken: 0, chroma: 0.15, frost: 0, attack: 0.16, decay: 1.4 },
};

const KINDS = Object.keys(PULSES) as ScreenPulse[];
/** envelopes are integrated in slices no longer than this, so long headless steps behave like real frames */
const MAX_SLICE = 0.05;

export interface FeedbackOutput {
  /** summed additive edge glow, linear RGB */
  edge: [number, number, number];
  /** summed flat wash, linear RGB */
  flash: [number, number, number];
  /** edge tint colour (multiplies luminance) and amount 0..1 */
  tint: [number, number, number];
  tintAmount: number;
  darken: number;
  chroma: number;
  frost: number;
  /** smoothed corruption 0..1 */
  corruption: number;
  /** UV warp amount 0..1 (0 when reduceDistortion) */
  distort: number;
  /** animation clock for the veining (slows to a crawl when reduceDistortion) */
  time: number;
  /** true when the effect has anything to draw */
  active: boolean;
}

export class ScreenFeedback {
  readonly out: FeedbackOutput = {
    edge: [0, 0, 0], flash: [0, 0, 0], tint: [1, 1, 1], tintAmount: 0, darken: 0, chroma: 0, frost: 0,
    corruption: 0, distort: 0, time: 0, active: false,
  };

  reduceFlash = false;
  reduceDistortion = false;

  /** per kind: target strength, current envelope value, phase (1 = attacking) */
  private readonly strength = new Float32Array(KINDS.length);
  private readonly level = new Float32Array(KINDS.length);
  private readonly rising = new Uint8Array(KINDS.length);
  private corruptionTarget = 0;
  private warned = false;

  /** Start (or re-trigger) a pulse. Unknown kinds warn once and are ignored. */
  pulse(kind: ScreenPulse, strength = 1): void {
    const i = KINDS.indexOf(kind);
    if (i < 0) {
      if (!this.warned) {
        this.warned = true;
        console.warn(`[render] unknown screen pulse "${String(kind)}"`);
      }
      return;
    }
    const s = Number.isFinite(strength) ? Math.min(2, Math.max(0, strength)) : 1;
    if (s <= 0) return;
    // re-triggering never lowers a pulse that is already stronger
    this.strength[i] = Math.max(s, this.level[i]);
    this.rising[i] = 1;
  }

  setCorruption(amount: number): void {
    this.corruptionTarget = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0;
  }

  /** Current envelope value of a pulse kind (0 when idle). */
  levelOf(kind: ScreenPulse): number {
    const i = KINDS.indexOf(kind);
    return i < 0 ? 0 : this.level[i];
  }

  /** Advance envelopes by real seconds and refresh `out`. */
  update(dt: number): void {
    let left = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 30) : 0;
    while (left > 0) {
      const d = Math.min(MAX_SLICE, left);
      this.integrate(d);
      left -= d;
    }
    this.compose();
  }

  private integrate(d: number): void {
    const attackScale = this.reduceFlash ? 4 : 1;
    for (let i = 0; i < KINDS.length; i++) {
      const def = PULSES[KINDS[i]];
      let v = this.level[i];
      let rest = d;
      if (this.rising[i]) {
        const rate = this.strength[i] / (def.attack * attackScale);
        const need = (this.strength[i] - v) / rate;
        if (rest >= need) {
          v = this.strength[i];
          this.rising[i] = 0;
          rest -= need; // the remainder of the slice already decays
        } else {
          v += rate * rest;
          rest = 0;
        }
      }
      if (!this.rising[i] && v > 0 && rest > 0) {
        v *= Math.exp(-rest / (def.decay * 0.4));
        if (v < 0.003) v = 0;
      }
      this.level[i] = v;
    }
    // corruption eases in quickly and releases a little slower (relief should read, not snap)
    const o = this.out;
    const c = o.corruption;
    const rate = this.corruptionTarget > c ? 3.5 : 1.8;
    let next = c + (this.corruptionTarget - c) * (1 - Math.exp(-rate * d));
    if (Math.abs(next - this.corruptionTarget) < 0.002) next = this.corruptionTarget;
    o.corruption = next;
    o.time += d * (this.reduceDistortion ? 0.12 : 1);
    if (o.time > 3600) o.time -= 3600;
  }

  private compose(): void {
    const o = this.out;
    o.edge[0] = o.edge[1] = o.edge[2] = 0;
    o.flash[0] = o.flash[1] = o.flash[2] = 0;
    o.tint[0] = o.tint[1] = o.tint[2] = 0;
    o.tintAmount = o.darken = o.chroma = o.frost = 0;

    // reduceFlash: dimmer everywhere, and the full-frame wash is all but removed
    const gain = this.reduceFlash ? 0.45 : 1;
    const washGain = this.reduceFlash ? 0.08 : 1;
    let tintWeight = 0;
    let any = false;

    for (let i = 0; i < KINDS.length; i++) {
      const v = this.level[i];
      if (v <= 0) continue;
      any = true;
      const def = PULSES[KINDS[i]];
      const g = v * gain;
      const w = v * washGain;
      o.edge[0] += def.glow[0] * g;
      o.edge[1] += def.glow[1] * g;
      o.edge[2] += def.glow[2] * g;
      o.flash[0] += def.wash[0] * w;
      o.flash[1] += def.wash[1] * w;
      o.flash[2] += def.wash[2] * w;
      const t = Math.min(1, v) * def.tintAmount * gain;
      if (t > 0) {
        o.tint[0] += def.tint[0] * t;
        o.tint[1] += def.tint[1] * t;
        o.tint[2] += def.tint[2] * t;
        tintWeight += t;
        o.tintAmount = Math.max(o.tintAmount, t);
      }
      o.darken = Math.max(o.darken, Math.min(1, v) * def.darken * gain);
      o.chroma += v * def.chroma * (this.reduceDistortion ? 0 : gain);
      o.frost = Math.max(o.frost, Math.min(1, v) * def.frost * gain);
    }
    if (tintWeight > 0) {
      o.tint[0] /= tintWeight;
      o.tint[1] /= tintWeight;
      o.tint[2] /= tintWeight;
    } else {
      o.tint[0] = o.tint[1] = o.tint[2] = 1;
    }
    o.darken = Math.min(0.85, o.darken);
    o.distort = this.reduceDistortion ? 0 : o.corruption;
    o.active = any || o.corruption > 0.001;
  }
}
