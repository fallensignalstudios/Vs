/**
 * Looks — per-zone grading presets and the maths that blends them.
 *
 *   import { LOOKS } from '@/render/looks';
 *   b.setEnv({ sky: 'coreChamber', look: LOOKS.core });
 *   game.render.setLook({ ...LOOKS.witness }, 1.5);
 *
 * A Look is packed into a flat float array (colours as linear RGB) so blending is one loop and every
 * numeric / colour field interpolates.
 */
import { Color } from 'three';
import type { DeepPartial, Look, LookName } from '@/core/api';

/** Engine default: neutral filmic image, light haze, restrained lens artefacts. */
export const DEFAULT_LOOK: Look = {
  exposure: 1,
  bloom: { intensity: 0.7, threshold: 1.0, radius: 0.7 },
  fog: { color: 0x0b0d12, density: 0.008 },
  grade: { tint: 0xffffff, saturation: 1, contrast: 1.05, lift: 0, shadowsTint: 0xffffff, highlightsTint: 0xffffff },
  vignette: 0.35,
  grain: 0.3,
  chromaticAberration: 0.2,
  ao: { intensity: 3.0, radius: 1.2 },
  ambient: { sky: 0x8d93a3, ground: 0x241f1a, intensity: 0.45 },
  envIntensity: 1,
};

function look(over: DeepPartial<Look>): Look {
  return mergeLook(DEFAULT_LOOK, over);
}

/**
 * Tuned presets. Art direction (BRIEF §4): warm ivory / gold upper halls, cold cyan frozen corridor,
 * near-black mirror stone with gold in the lower terminal; violet never comes from the grade — only from
 * real corruption sources in the scene.
 */
export const LOOKS: Readonly<Record<LookName, Look>> = {
  neutral: look({}),

  // Z00 — fractured white-gold landing: smoke haze, amber emergency practicals, teal shadows.
  crash: look({
    exposure: 0.96,
    bloom: { intensity: 0.82, threshold: 1.0, radius: 0.76 },
    fog: { color: 0x33261c, density: 0.022 },
    grade: { tint: 0xffe6c6, saturation: 0.9, contrast: 1.12, lift: 0.008, shadowsTint: 0x9cc4ff, highlightsTint: 0xffc98a },
    vignette: 0.5, grain: 0.45, chromaticAberration: 0.32,
    ao: { intensity: 3.2, radius: 1.3 },
    ambient: { sky: 0x8a7663, ground: 0x2a1a10, intensity: 0.5 },
    envIntensity: 0.85,
  }),

  // Z01 — long ivory hall: bright, clean, a touch cool so the cold security light and warm strips both read.
  pressureHall: look({
    // Z01 integration pass: exposure and fill lowered so the key, the shafts and the light strips carry the
    // hall (it read as an evenly lit white box); a little more warm haze so the far end recedes
    exposure: 0.92,
    bloom: { intensity: 0.62, threshold: 1.0, radius: 0.66 },
    fog: { color: 0x5a554c, density: 0.013 },
    grade: { tint: 0xf2f6ff, saturation: 1.0, contrast: 1.1, lift: 0.002, shadowsTint: 0xbdd0ff, highlightsTint: 0xfff4e0 },
    vignette: 0.34, grain: 0.26, chromaticAberration: 0.16,
    ao: { intensity: 3.0, radius: 1.4 },
    ambient: { sky: 0xbdb9b0, ground: 0x3a332b, intensity: 0.5 },
    envIntensity: 1.0,
  }),

  // Z02 — survivor bend: muted and low-key; soft contrast, lifted blacks, warm practicals. A breath after E1.
  survivorBend: look({
    exposure: 0.88,
    bloom: { intensity: 0.6, threshold: 0.98, radius: 0.74 },
    fog: { color: 0x2a2420, density: 0.024 },
    grade: { tint: 0xffe8cc, saturation: 0.72, contrast: 0.98, lift: 0.018, shadowsTint: 0xb8c6dd, highlightsTint: 0xffd096 },
    vignette: 0.6, grain: 0.4, chromaticAberration: 0.16,
    ao: { intensity: 3.2, radius: 1.1 },
    ambient: { sky: 0x786a5c, ground: 0x241a14, intensity: 0.42 },
    envIntensity: 0.8,
  }),

  // Z03 — frozen sensor access: cold cyan atmosphere, thick pale haze, icy glow.
  frozen: look({
    exposure: 1.06,
    bloom: { intensity: 0.9, threshold: 0.94, radius: 0.8 },
    fog: { color: 0x6b93a3, density: 0.024 },
    grade: { tint: 0xdff2ff, saturation: 0.8, contrast: 1.06, lift: 0.01, shadowsTint: 0xa8dcf8, highlightsTint: 0xeefaff },
    vignette: 0.4, grain: 0.3, chromaticAberration: 0.24,
    ao: { intensity: 2.6, radius: 1.2 },
    ambient: { sky: 0x9cc9e2, ground: 0x22323e, intensity: 0.72 },
    envIntensity: 0.95,
  }),

  // Z04 — relay overlook: silver daylight through the ribs, pale marble, long hazy sight lines (relay concept).
  relay: look({
    exposure: 1.18,
    bloom: { intensity: 0.5, threshold: 1.08, radius: 0.64 },
    fog: { color: 0x8f9aa8, density: 0.007 },
    grade: { tint: 0xf0f5ff, saturation: 0.9, contrast: 1.04, lift: 0.01, shadowsTint: 0xbfd2f5, highlightsTint: 0xfff6e6 },
    vignette: 0.28, grain: 0.22, chromaticAberration: 0.14,
    ao: { intensity: 3.0, radius: 1.5 },
    ambient: { sky: 0xd2dae8, ground: 0x4e463a, intensity: 1.0 },
    envIntensity: 1.1,
  }),

  // Z05 — meeting atrium: vast, saturated, hard contrast; blue shadows under amber / blue-white battle light.
  atrium: look({
    exposure: 1.0,
    bloom: { intensity: 0.8, threshold: 1.0, radius: 0.78 },
    fog: { color: 0x141a30, density: 0.004 },
    grade: { tint: 0xf4f2ff, saturation: 1.12, contrast: 1.18, lift: 0, shadowsTint: 0xa9b8ff, highlightsTint: 0xffd9a8 },
    vignette: 0.42, grain: 0.28, chromaticAberration: 0.2,
    ao: { intensity: 3.0, radius: 1.6 },
    ambient: { sky: 0x7482b4, ground: 0x2a2218, intensity: 0.55 },
    envIntensity: 1.0,
  }),

  // Z06 — breach rescue: dark, gritty, drained of colour; cold steel shadows, warm highlights so people read.
  // (No violet in the grade: violet belongs to real corruption sources and to setCorruption.)
  breach: look({
    exposure: 0.9,
    bloom: { intensity: 0.86, threshold: 0.98, radius: 0.74 },
    fog: { color: 0x0e1016, density: 0.024 },
    grade: { tint: 0xf0f2fa, saturation: 0.8, contrast: 1.18, lift: -0.006, shadowsTint: 0xa4b6e6, highlightsTint: 0xffdfc0 },
    vignette: 0.58, grain: 0.5, chromaticAberration: 0.4,
    ao: { intensity: 3.4, radius: 1.2 },
    ambient: { sky: 0x4e5568, ground: 0x14110f, intensity: 0.38 },
    envIntensity: 0.85,
  }),

  // Z07 — capture-control gallery: dim technical space below grade; teal shadows, amber console highlights.
  gallery: look({
    exposure: 0.94,
    bloom: { intensity: 0.8, threshold: 1.0, radius: 0.7 },
    fog: { color: 0x0c1418, density: 0.017 },
    grade: { tint: 0xeaf4f6, saturation: 0.95, contrast: 1.14, lift: 0, shadowsTint: 0xa8d0d8, highlightsTint: 0xffe0b0 },
    vignette: 0.5, grain: 0.34, chromaticAberration: 0.24,
    ao: { intensity: 3.3, radius: 1.1 },
    ambient: { sky: 0x4c5c66, ground: 0x14130f, intensity: 0.38 },
    envIntensity: 0.9,
  }),

  // Z08 — quarantine crucible: luminous white-gold arena over a wet dark floor (quarantine concept).
  crucible: look({
    exposure: 1.1,
    bloom: { intensity: 0.95, threshold: 1.0, radius: 0.76 },
    fog: { color: 0x3a322a, density: 0.008 },
    grade: { tint: 0xfff2dc, saturation: 1.08, contrast: 1.12, lift: 0, shadowsTint: 0xc2ccf0, highlightsTint: 0xffe0a8 },
    vignette: 0.4, grain: 0.3, chromaticAberration: 0.24,
    ao: { intensity: 3.0, radius: 1.5 },
    ambient: { sky: 0xb6aa94, ground: 0x2e251c, intensity: 0.62 },
    envIntensity: 1.05,
  }),

  // Z09 — wound gallery: near-black, crushed, cold; the sky does the talking (wound-overlook concept).
  woundGallery: look({
    exposure: 0.92,
    bloom: { intensity: 0.8, threshold: 1.0, radius: 0.72 },
    fog: { color: 0x07070d, density: 0.0058 },
    grade: { tint: 0xeef0ff, saturation: 0.96, contrast: 1.2, lift: -0.015, shadowsTint: 0xb0b8ff, highlightsTint: 0xffe6cc },
    vignette: 0.55, grain: 0.32, chromaticAberration: 0.22,
    ao: { intensity: 3.2, radius: 1.3 },
    ambient: { sky: 0x464862, ground: 0x0c0a0e, intensity: 0.3 },
    envIntensity: 1.1,
  }),

  // Z10 — Fifth Crownmark chamber: mirror-black stone and gold, luminous rings (crownmark-chamber concept).
  core: look({
    exposure: 1.0,
    bloom: { intensity: 0.92, threshold: 1.0, radius: 0.76 },
    fog: { color: 0x060608, density: 0.0066 },
    grade: { tint: 0xfff6e8, saturation: 1.08, contrast: 1.18, lift: -0.012, shadowsTint: 0xc9cdea, highlightsTint: 0xffdca0 },
    vignette: 0.48, grain: 0.28, chromaticAberration: 0.2,
    ao: { intensity: 3.2, radius: 1.4 },
    ambient: { sky: 0x57524a, ground: 0x0b0a0c, intensity: 0.28 },
    envIntensity: 1.15,
  }),

  // Z11 — observation gallery: quiet and warm inside, soft bloom, a little lifted; the cold stays outside.
  observation: look({
    exposure: 0.98,
    bloom: { intensity: 0.75, threshold: 1.0, radius: 0.8 },
    fog: { color: 0x100e12, density: 0.01 },
    grade: { tint: 0xffeeda, saturation: 0.9, contrast: 1.04, lift: 0.012, shadowsTint: 0xbcc6e8, highlightsTint: 0xffd49a },
    vignette: 0.5, grain: 0.36, chromaticAberration: 0.16,
    ao: { intensity: 3.0, radius: 1.0 },
    ambient: { sky: 0x6b626c, ground: 0x1c1410, intensity: 0.4 },
    envIntensity: 1.0,
  }),

  // Z12 — outer-ring hangar: wide, blue-grey haze, neutral-cool; both fleets' light at wary distance.
  hangar: look({
    exposure: 1.04,
    bloom: { intensity: 0.72, threshold: 1.0, radius: 0.7 },
    fog: { color: 0x232a34, density: 0.011 },
    grade: { tint: 0xf2f6ff, saturation: 0.9, contrast: 1.06, lift: 0.008, shadowsTint: 0xbcd0f0, highlightsTint: 0xfff0da },
    vignette: 0.38, grain: 0.3, chromaticAberration: 0.18,
    ao: { intensity: 3.0, radius: 1.5 },
    ambient: { sky: 0x8a94a6, ground: 0x26211c, intensity: 0.56 },
    envIntensity: 1.0,
  }),

  // The historical sequence — a remembered image: desaturated gold-white, blooming, grainy.
  witness: look({
    exposure: 1.25,
    bloom: { intensity: 1.3, threshold: 0.7, radius: 0.85 },
    fog: { color: 0xb8a67c, density: 0.018 },
    grade: { tint: 0xffecc4, saturation: 0.22, contrast: 0.94, lift: 0.04, shadowsTint: 0xffe2b0, highlightsTint: 0xfff3d6 },
    vignette: 0.65, grain: 0.75, chromaticAberration: 0.55,
    ao: { intensity: 2.0, radius: 1.4 },
    ambient: { sky: 0xfff0d0, ground: 0x8a7a5a, intensity: 0.85 },
    envIntensity: 0.8,
  }),
};

// ---------------------------------------------------------------------------------------------------------
// Packing / blending
// ---------------------------------------------------------------------------------------------------------

/** Offsets into the packed look. Colours occupy three consecutive linear-RGB floats. */
export const L = {
  exposure: 0,
  bloomIntensity: 1, bloomThreshold: 2, bloomRadius: 3,
  fogColor: 4, fogDensity: 7,
  tint: 8, saturation: 11, contrast: 12, lift: 13,
  shadowsTint: 14, highlightsTint: 17,
  vignette: 20, grain: 21, chromaticAberration: 22,
  aoIntensity: 23, aoRadius: 24,
  ambientSky: 25, ambientGround: 28, ambientIntensity: 31,
  envIntensity: 32,
} as const;

export const LOOK_SIZE = 33;

const scratch = new Color();

function putColor(out: Float32Array, at: number, hex: number): void {
  scratch.setHex(hex);
  out[at] = scratch.r;
  out[at + 1] = scratch.g;
  out[at + 2] = scratch.b;
}

function getColor(arr: Float32Array, at: number): number {
  return scratch.setRGB(clamp01(arr[at]), clamp01(arr[at + 1]), clamp01(arr[at + 2])).getHex();
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Look → flat floats (colours converted from sRGB hex to linear RGB). */
export function packLook(look: Look, out: Float32Array = new Float32Array(LOOK_SIZE)): Float32Array {
  out[L.exposure] = look.exposure;
  out[L.bloomIntensity] = look.bloom.intensity;
  out[L.bloomThreshold] = look.bloom.threshold;
  out[L.bloomRadius] = look.bloom.radius;
  putColor(out, L.fogColor, look.fog.color);
  out[L.fogDensity] = look.fog.density;
  putColor(out, L.tint, look.grade.tint);
  out[L.saturation] = look.grade.saturation;
  out[L.contrast] = look.grade.contrast;
  out[L.lift] = look.grade.lift;
  putColor(out, L.shadowsTint, look.grade.shadowsTint);
  putColor(out, L.highlightsTint, look.grade.highlightsTint);
  out[L.vignette] = look.vignette;
  out[L.grain] = look.grain;
  out[L.chromaticAberration] = look.chromaticAberration;
  out[L.aoIntensity] = look.ao.intensity;
  out[L.aoRadius] = look.ao.radius;
  putColor(out, L.ambientSky, look.ambient.sky);
  putColor(out, L.ambientGround, look.ambient.ground);
  out[L.ambientIntensity] = look.ambient.intensity;
  out[L.envIntensity] = look.envIntensity;
  return out;
}

/** Flat floats → Look (colours back to sRGB hex). */
export function unpackLook(arr: Float32Array): Look {
  return {
    exposure: arr[L.exposure],
    bloom: { intensity: arr[L.bloomIntensity], threshold: arr[L.bloomThreshold], radius: arr[L.bloomRadius] },
    fog: { color: getColor(arr, L.fogColor), density: arr[L.fogDensity] },
    grade: {
      tint: getColor(arr, L.tint),
      saturation: arr[L.saturation],
      contrast: arr[L.contrast],
      lift: arr[L.lift],
      shadowsTint: getColor(arr, L.shadowsTint),
      highlightsTint: getColor(arr, L.highlightsTint),
    },
    vignette: arr[L.vignette],
    grain: arr[L.grain],
    chromaticAberration: arr[L.chromaticAberration],
    ao: { intensity: arr[L.aoIntensity], radius: arr[L.aoRadius] },
    ambient: { sky: getColor(arr, L.ambientSky), ground: getColor(arr, L.ambientGround), intensity: arr[L.ambientIntensity] },
    envIntensity: arr[L.envIntensity],
  };
}

export function cloneLook(look: Look): Look {
  return {
    exposure: look.exposure,
    bloom: { ...look.bloom },
    fog: { ...look.fog },
    grade: { ...look.grade },
    vignette: look.vignette,
    grain: look.grain,
    chromaticAberration: look.chromaticAberration,
    ao: { ...look.ao },
    ambient: { ...look.ambient },
    envIntensity: look.envIntensity,
  };
}

// (function declarations: `LOOKS` above is built at module evaluation and needs these hoisted)
function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function mergeGroup<T extends Record<string, number>>(base: T, over: unknown): T {
  const out: Record<string, number> = { ...base };
  if (over && typeof over === 'object') {
    const src = over as Record<string, unknown>;
    for (const key of Object.keys(base)) out[key] = finite(src[key], base[key]);
  }
  return out as T;
}

/** Deep-merge a partial look over a complete one. Unknown keys and non-finite numbers are ignored. */
export function mergeLook(base: Look, over: DeepPartial<Look> | null | undefined): Look {
  const o: DeepPartial<Look> = over && typeof over === 'object' ? over : {};
  return {
    exposure: finite(o.exposure, base.exposure),
    bloom: mergeGroup(base.bloom, o.bloom),
    fog: mergeGroup(base.fog, o.fog),
    grade: mergeGroup(base.grade, o.grade),
    vignette: finite(o.vignette, base.vignette),
    grain: finite(o.grain, base.grain),
    chromaticAberration: finite(o.chromaticAberration, base.chromaticAberration),
    ao: mergeGroup(base.ao, o.ao),
    ambient: mergeGroup(base.ambient, o.ambient),
    envIntensity: finite(o.envIntensity, base.envIntensity),
  };
}

/**
 * Blends the displayed look toward a target. `current` is the packed look to apply this frame.
 * Retargeting mid-blend starts from whatever is on screen, so there is never a pop.
 */
export class LookBlender {
  readonly current = new Float32Array(LOOK_SIZE);
  private readonly from = new Float32Array(LOOK_SIZE);
  private readonly to = new Float32Array(LOOK_SIZE);
  private targetLook: Look;
  private elapsed = 0;
  private duration = 0;
  private dirty = true;

  constructor(initial: Look = DEFAULT_LOOK) {
    this.targetLook = cloneLook(initial);
    packLook(this.targetLook, this.to);
    this.current.set(this.to);
    this.from.set(this.to);
  }

  /** The look being blended toward (copy). */
  get target(): Look {
    return cloneLook(this.targetLook);
  }

  get blending(): boolean {
    return this.elapsed < this.duration;
  }

  setTarget(partial: DeepPartial<Look> | null | undefined, seconds = 0): void {
    this.targetLook = mergeLook(this.targetLook, partial);
    packLook(this.targetLook, this.to);
    const s = finite(seconds, 0);
    if (s <= 0) {
      this.current.set(this.to);
      this.from.set(this.to);
      this.elapsed = this.duration = 0;
    } else {
      this.from.set(this.current);
      this.elapsed = 0;
      this.duration = s;
    }
    this.dirty = true;
  }

  /** Advance by real seconds. Returns true when `current` changed and must be re-applied. */
  update(dt: number): boolean {
    if (this.elapsed < this.duration) {
      this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
      const x = this.elapsed / this.duration;
      const k = x * x * (3 - 2 * x);
      const { current, from, to } = this;
      for (let i = 0; i < LOOK_SIZE; i++) current[i] = from[i] + (to[i] - from[i]) * k;
      this.dirty = false;
      return true;
    }
    if (this.dirty) {
      this.dirty = false;
      return true;
    }
    return false;
  }
}
