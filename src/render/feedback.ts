/**
 * Screen feedback state (CPU side): pulse envelopes and the smoothed corruption level.
 * Pure logic — the ScreenFeedbackEffect reads the summed values every frame.
 *
 * Accessibility: `reduceFlash` shortens and dims pulses (a full-frame white flash becomes a faint edge glow);
 * `reduceDistortion` removes the UV warp and stills the veining while keeping the violet edge readable.
 */
import type { ScreenPulse } from '@/core/api';

interface PulseDef {
  /** linear RGB */
  color: readonly [number, number, number];
  /** additive glow hugging the frame edges */
  edge: number;
  /** flat additive wash over the whole frame */
  flash: number;
  /** multiplicative edge darkening (impact weight) */
  darken: number;
  /** transient chromatic aberration */
  chroma: number;
  /** crystalline rim pattern (frost) */
  frost: number;
  attack: number;
  decay: number;
}

/** Colours are the BRIEF palette converted to linear, scaled for an HDR additive overlay. */
export const PULSES: Readonly<Record<ScreenPulse, PulseDef>> = {
  hit: { color: [0.62, 0.02, 0.015], edge: 1.0, flash: 0.03, darken: 0.5, chroma: 1.6, frost: 0, attack: 0.03, decay: 0.55 },
  heal: { color: [0.35, 0.8, 0.5], edge: 0.55, flash: 0.02, darken: 0, chroma: 0, frost: 0, attack: 0.12, decay: 0.9 },
  corruption: { color: [0.2, 0.05, 1.0], edge: 0.8, flash: 0.0, darken: 0.35, chroma: 1.2, frost: 0, attack: 0.08, decay: 0.8 },
  frost: { color: [0.62, 0.86, 1.0], edge: 0.7, flash: 0.03, darken: 0, chroma: 0.3, frost: 1, attack: 0.06, decay: 1.1 },
  cinder: { color: [1.0, 0.24, 0.03], edge: 0.85, flash: 0.05, darken: 0.1, chroma: 0.5, frost: 0, attack: 0.04, decay: 0.6 },
  flash: { color: [1.0, 0.96, 0.88], edge: 0.2, flash: 0.9, darken: 0, chroma: 0.4, frost: 0, attack: 0.02, decay: 0.45 },
  gold: { color: [1.0, 0.72, 0.3], edge: 0.6, flash: 0.1, darken: 0, chroma: 0.2, frost: 0, attack: 0.15, decay: 1.4 },
};

const KINDS = Object.keys(PULSES) as ScreenPulse[];

export interface FeedbackOutput {
  /** summed additive edge glow, linear RGB */
  edge: [number, number, number];
  /** summed flat wash, linear RGB */
  flash: [number, number, number];
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
    edge: [0, 0, 0], flash: [0, 0, 0], darken: 0, chroma: 0, frost: 0, corruption: 0, distort: 0, time: 0, active: false,
  };

  reduceFlash = false;
  reduceDistortion = false;

  /** per kind: target strength, current envelope value, phase (true = attacking) */
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

  /** Advance envelopes by real seconds and refresh `out`. */
  update(dt: number): void {
    const o = this.out;
    const d = Math.min(0.1, Math.max(0, dt));
    o.edge[0] = o.edge[1] = o.edge[2] = 0;
    o.flash[0] = o.flash[1] = o.flash[2] = 0;
    o.darken = o.chroma = o.frost = 0;

    // reduceFlash: dimmer, slower onset (no sudden luminance step), and the flat wash is mostly removed
    const gain = this.reduceFlash ? 0.4 : 1;
    const flashGain = this.reduceFlash ? 0.08 : 1;
    const attackScale = this.reduceFlash ? 4 : 1;

    for (let i = 0; i < KINDS.length; i++) {
      const def = PULSES[KINDS[i]];
      let v = this.level[i];
      if (this.rising[i]) {
        v += (this.strength[i] / (def.attack * attackScale)) * d;
        if (v >= this.strength[i]) {
          v = this.strength[i];
          this.rising[i] = 0;
        }
      } else if (v > 0) {
        v *= Math.exp(-d / (def.decay * 0.4));
        if (v < 0.003) v = 0;
      }
      this.level[i] = v;
      if (v <= 0) continue;
      const e = v * def.edge * gain;
      const f = v * def.flash * flashGain;
      o.edge[0] += def.color[0] * e;
      o.edge[1] += def.color[1] * e;
      o.edge[2] += def.color[2] * e;
      o.flash[0] += def.color[0] * f;
      o.flash[1] += def.color[1] * f;
      o.flash[2] += def.color[2] * f;
      o.darken = Math.max(o.darken, v * def.darken * gain);
      o.chroma += v * def.chroma * (this.reduceDistortion ? 0 : gain);
      o.frost = Math.max(o.frost, v * def.frost * gain);
    }
    o.darken = Math.min(0.85, o.darken);

    // corruption eases in quickly and releases a little slower (relief should read, not snap)
    const c = o.corruption;
    const rate = this.corruptionTarget > c ? 3.5 : 1.8;
    let next = c + (this.corruptionTarget - c) * (1 - Math.exp(-rate * d));
    if (Math.abs(next - this.corruptionTarget) < 0.002) next = this.corruptionTarget;
    o.corruption = next;
    o.distort = this.reduceDistortion ? 0 : next;
    o.time += d * (this.reduceDistortion ? 0.12 : 1);
    if (o.time > 3600) o.time -= 3600;

    o.active =
      next > 0.001 || o.darken > 0 || o.frost > 0 ||
      o.edge[0] + o.edge[1] + o.edge[2] + o.flash[0] + o.flash[1] + o.flash[2] > 0;
  }
}
