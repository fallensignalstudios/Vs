/**
 * Quality: presets, the GPU heuristic behind `settings.quality = 'auto'`, dynamic resolution and the
 * auto-quality governor. Everything here is pure logic (no WebGL / DOM) so it can be unit-tested.
 */
import type { QualityLevel, QualityProfile } from '@/core/api';

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, Readonly<QualityProfile>>> = {
  // Integrated / software GPUs: no AO, no reflections, no SMAA; bloom on a reduced chain.
  low: {
    level: 'low', resolutionScale: 0.8, maxPixelRatio: 1, shadows: true, shadowMapSize: 1024,
    ao: false, bloom: true, dof: false, reflections: false, volumetrics: false,
    particleScale: 0.5, maxShadowLights: 1, anisotropy: 2, textureSize: 512,
  },
  // Half-resolution AO, SMAA medium, env-map floor reflections.
  medium: {
    level: 'medium', resolutionScale: 1, maxPixelRatio: 1.25, shadows: true, shadowMapSize: 2048,
    ao: true, bloom: true, dof: true, reflections: false, volumetrics: true,
    particleScale: 0.75, maxShadowLights: 1, anisotropy: 4, textureSize: 1024,
  },
  // The reference look: full-res AO, planar floor reflections, SMAA high.
  high: {
    level: 'high', resolutionScale: 1, maxPixelRatio: 1.5, shadows: true, shadowMapSize: 2048,
    ao: true, bloom: true, dof: true, reflections: true, volumetrics: true,
    particleScale: 1, maxShadowLights: 2, anisotropy: 8, textureSize: 1024,
  },
  ultra: {
    level: 'ultra', resolutionScale: 1, maxPixelRatio: 2, shadows: true, shadowMapSize: 4096,
    ao: true, bloom: true, dof: true, reflections: true, volumetrics: true,
    particleScale: 1, maxShadowLights: 2, anisotropy: 16, textureSize: 2048,
  },
};

export function isQualityLevel(v: unknown): v is QualityLevel {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra';
}

export function lowerQuality(level: QualityLevel): QualityLevel {
  return QUALITY_ORDER[Math.max(0, QUALITY_ORDER.indexOf(level) - 1)];
}

/**
 * Guess a quality level from the unmasked WebGL renderer string (WEBGL_debug_renderer_info).
 * Conservative: unknown hardware gets 'medium'; software rasterisers always get 'low'.
 */
export function classifyGpu(rendererString: string | null | undefined, hints: { mobile?: boolean } = {}): QualityLevel {
  const s = (rendererString ?? '').toLowerCase();
  if (!s) return hints.mobile ? 'low' : 'medium';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render|virtualbox|vmware|svga3d/.test(s)) return 'low';

  // Phones / tablets.
  if (/adreno|mali|powervr|videocore|tegra/.test(s)) {
    const adreno = /adreno[^0-9]*(\d{3})/.exec(s);
    if (adreno && Number(adreno[1]) >= 730) return 'medium';
    return 'low';
  }
  if (/apple a\d+/.test(s)) return 'medium';

  // Apple silicon laptops / desktops.
  const appleM = /apple m(\d)(?:\s*(pro|max|ultra))?/.exec(s);
  if (appleM) return appleM[2] === 'max' || appleM[2] === 'ultra' ? 'ultra' : 'high';
  if (/apple gpu|apple/.test(s) && hints.mobile) return 'medium';
  if (/apple gpu/.test(s)) return 'high';

  // NVIDIA.
  const rtx = /rtx\s*(?:a|pro\s*)?(\d{3,4})/.exec(s);
  if (rtx) {
    const n = Number(rtx[1]);
    const tier = n % 100; // 60 / 70 / 80 / 90
    const series = Math.floor(n / 1000); // 2 / 3 / 4 / 5
    if (series >= 3 && tier >= 70) return 'ultra';
    return 'high';
  }
  const gtx = /gtx\s*(\d{3,4})/.exec(s);
  if (gtx) {
    const n = Number(gtx[1]);
    if (n >= 1060 || (n >= 970 && n < 1000)) return 'high';
    return 'medium';
  }
  if (/quadro|nvidia|geforce/.test(s)) return /mx\d{3}|gt\s*\d{3,4}|\d{3}m\b/.test(s) ? 'medium' : 'high';

  // AMD.
  const rx = /rx\s*(\d{3,4})/.exec(s);
  if (rx) {
    const n = Number(rx[1]);
    if (n >= 6800 && n % 1000 >= 800) return 'ultra';
    if (n >= 5600 || (n >= 570 && n < 1000)) return 'high';
    return 'medium';
  }
  if (/radeon pro|firepro/.test(s)) return 'high';
  if (/radeon/.test(s)) return 'medium'; // integrated Vega / "Radeon(TM) Graphics"

  // Intel.
  if (/arc\b|arc\(tm\)/.test(s)) return 'high';
  if (/iris\(r\) xe|iris xe|iris plus|iris pro/.test(s)) return 'medium';
  if (/intel/.test(s)) return 'low';

  return hints.mobile ? 'low' : 'medium';
}

// ---------------------------------------------------------------------------------------------------------
// Dynamic resolution
// ---------------------------------------------------------------------------------------------------------

export interface DynamicResolutionOpts {
  /** frame budget in ms (default 17.2 ≈ 58 fps) */
  targetMs?: number;
  minScale?: number;
  maxScale?: number;
  /** quantisation of the scale (default 0.05) */
  step?: number;
}

/**
 * Nudges a resolution multiplier inside [minScale, maxScale] to hold the frame budget.
 * Hysteresis: drops quickly when sustained over budget; climbs back only after a stable period, and when a
 * climb immediately causes a drop the wait before the next attempt doubles (so it never oscillates under vsync,
 * where spare headroom is invisible).
 */
export class DynamicResolution {
  scale: number;
  /** smoothed frame time fed to the controller (ms) */
  ema = 0;
  private readonly targetMs: number;
  private readonly minScale: number;
  private readonly maxScale: number;
  private readonly step: number;
  private overTime = 0;
  private stableTime = 0;
  private sinceChange = 0;
  private probeWait = 4;
  private lastChangeWasUp = false;

  constructor(opts: DynamicResolutionOpts = {}) {
    this.targetMs = opts.targetMs ?? 17.2;
    this.minScale = opts.minScale ?? 0.6;
    this.maxScale = opts.maxScale ?? 1;
    this.step = opts.step ?? 0.05;
    this.scale = this.maxScale;
  }

  reset(): void {
    this.scale = this.maxScale;
    this.ema = 0;
    this.overTime = this.stableTime = this.sinceChange = 0;
    this.probeWait = 4;
    this.lastChangeWasUp = false;
  }

  get atFloor(): boolean {
    return this.scale <= this.minScale + 1e-6;
  }

  /**
   * Feed one frame (`frameMs` = real time since the previous frame). Returns true when `scale` changed.
   * Frames longer than 100 ms (loading hitches, tab switches) are ignored.
   */
  update(frameMs: number): boolean {
    if (!(frameMs > 0) || frameMs > 100) return false;
    const dt = frameMs / 1000;
    const a = 1 - Math.exp(-dt / 0.25);
    this.ema = this.ema === 0 ? frameMs : this.ema + (frameMs - this.ema) * a;
    this.sinceChange += dt;

    const over = this.ema > this.targetMs * 1.08;
    const under = this.ema < this.targetMs * 0.88;
    if (over) {
      this.overTime += dt;
      this.stableTime = 0;
    } else {
      this.overTime = 0;
      this.stableTime += dt;
    }

    if (over && this.overTime > 0.4 && this.sinceChange > 0.75 && !this.atFloor) {
      // A climb that immediately costs frames was a mistake: wait twice as long before the next attempt.
      if (this.lastChangeWasUp && this.sinceChange < 3) this.probeWait = Math.min(60, this.probeWait * 2);
      // frame time ∝ pixels ∝ scale² → aim straight at the budget, at least one step.
      const ideal = this.scale * Math.sqrt(this.targetMs / this.ema);
      const next = Math.min(this.scale - this.step, Math.floor(ideal / this.step + 1e-6) * this.step);
      return this.apply(Math.max(this.minScale, next), false);
    }

    if (this.scale < this.maxScale - 1e-6 && !over) {
      // Clear headroom (high-refresh displays) → climb steadily; otherwise probe carefully.
      const wait = under ? 1.5 : this.probeWait;
      if (this.stableTime > wait && this.sinceChange > wait) {
        if (under) this.probeWait = Math.max(4, this.probeWait * 0.75);
        return this.apply(Math.min(this.maxScale, this.scale + this.step), true);
      }
    }
    return false;
  }

  private apply(next: number, up: boolean): boolean {
    const q = Math.round(next / this.step) * this.step;
    const clamped = Math.min(this.maxScale, Math.max(this.minScale, Number(q.toFixed(4))));
    if (Math.abs(clamped - this.scale) < 1e-6) return false;
    this.scale = clamped;
    this.sinceChange = 0;
    this.overTime = 0;
    this.stableTime = 0;
    this.lastChangeWasUp = up;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Auto quality governor
// ---------------------------------------------------------------------------------------------------------

/**
 * Refines the GPU heuristic with real frame timing. Only ever steps DOWN (vsync hides headroom, and stepping
 * up would recompile shaders mid-play): once early if the first second of play is clearly too slow, and later
 * if the frame rate stays poor even with dynamic resolution at its floor.
 */
export class AutoQualityGovernor {
  private frames = 0;
  private sum = 0;
  private slowTime = 0;
  private stepsLeft: number;
  private earlyDone = false;

  constructor(maxSteps = 2) {
    this.stepsLeft = maxSteps;
  }

  reset(): void {
    this.frames = 0;
    this.sum = 0;
    this.slowTime = 0;
    this.earlyDone = false;
  }

  /**
   * Feed one frame. `resolutionAtFloor` = dynamic resolution cannot help any more (or is disabled).
   * Returns true when the caller should step one quality level down.
   */
  update(frameMs: number, resolutionAtFloor: boolean): boolean {
    if (this.stepsLeft <= 0 || !(frameMs > 0) || frameMs > 100) return false;

    if (!this.earlyDone) {
      this.frames++;
      // skip the first frames: shader warm-up and texture uploads are not representative
      if (this.frames > 20) this.sum += frameMs;
      if (this.frames >= 80) {
        const avg = this.sum / (this.frames - 20);
        this.earlyDone = true;
        if (avg > 30) return this.step();
      }
      return false;
    }

    if (frameMs > 22 && resolutionAtFloor) this.slowTime += frameMs / 1000;
    else this.slowTime = Math.max(0, this.slowTime - frameMs / 500);
    if (this.slowTime > 4) return this.step();
    return false;
  }

  private step(): boolean {
    this.stepsLeft--;
    this.frames = 0;
    this.sum = 0;
    this.slowTime = 0;
    this.earlyDone = false;
    return true;
  }
}
