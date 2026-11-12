/**
 * VFX data model — the vocabulary every effect in `library/*` is written in.
 *
 * An EFFECT is a small timeline: particle EMITTERS (burst / rate / pulsed), plus timed EVENTS that drive the
 * non-particle renderers (light flash, ground shockwave, decal, mesh shape). Everything is authored in a local
 * frame whose +Y axis is the effect's `dir` (surface normal / emission direction; default world up) and is
 * multiplied by `opts.scale` at spawn.
 */
import type { SpriteName } from './atlas';

/** A fixed value or a uniformly sampled [min, max]. */
export type Range = number | readonly [number, number];

/** `[hex colour, HDR intensity]` — intensity > 1 blooms (1.5 soft glow, 3 bright, 6+ hot core). */
export type ColorKey = readonly [number, number];

/** The four particle draw calls. */
export type LayerId = 'add' | 'alpha' | 'lit' | 'stretch';

export interface ParticleDef {
  /** add = additive HDR, alpha = unlit premultiplied, lit = soft smoke lit by key/ambient/flash lights, stretch = velocity-aligned additive streaks */
  layer: LayerId;
  /** one sprite, or a list to pick from at random */
  sprite: SpriteName | readonly SpriteName[];
  /** seconds */
  life: Range;
  /** quad edge in metres at t = 0, t = sizeMid, t = 1 (a single number = constant). For `stretch` this is the streak width. */
  size: number | readonly [number, number, number];
  /** position of the middle size key (0..1), default 0.3 */
  sizeMid?: number;
  /** per-particle size multiplier, default [0.75, 1.25] */
  sizeRand?: Range;
  /** quad height / width, default 1. For `stretch`: minimum streak length as a multiple of width. */
  aspect?: number;
  /** 1–3 colour keys over life */
  color: readonly ColorKey[];
  /** position of the middle colour key, default 0.4 */
  colorMid?: number;
  /** peak opacity, default 1 */
  alpha?: number;
  /** fraction of life spent fading in, default 0.06 */
  fadeIn?: number;
  /** life fraction at which the fade-out starts, default 0.55 */
  fadeOut?: number;
  /** m/s², positive pulls down, negative is buoyant */
  gravity?: number;
  /** 1/s exponential velocity damping */
  drag?: number;
  /** initial rotation (radians); default random full turn */
  rot?: Range;
  /** rad/s, sign randomised unless a range is given */
  spin?: Range;
  /** stretch layer: seconds of velocity added to the streak length */
  stretch?: number;
  /** turbulence acceleration m/s² and its frequency (Hz-ish) */
  turb?: number;
  turbFreq?: number;
  /** turbulence phase is shared by the whole effect: particles sway *together* (Eclipse wisps) */
  unison?: boolean;
  /** spring toward the effect origin (1/s²); negative repels */
  attract?: number;
  /** tangential swirl around the effect axis (rad/s) */
  orbit?: number;
  /** particles are carried along when the effect origin moves */
  follow?: boolean;
  /** floor restitution 0..1; 0 = no floor collision. Floor = ground under the effect origin. */
  bounce?: number;
  /** fade the sprite where it meets the floor (cheap soft-particle substitute) */
  floorFade?: boolean;
  /**
   * ADDED (fix & ship): metres from the camera inside which the sprite fades out (gone at 35 % of it), so drifting
   * motes never swell into big shapes in front of the lens. 0 / unset = none. Not on the `stretch` layer.
   */
  nearFade?: number;
  /** 0..1 brightness flicker depth */
  flicker?: number;
  /** camera billboard (default), flat on the effect plane, or upright (Y-locked) */
  facing?: 'camera' | 'ground' | 'upright';
  /** lit layer: self-illumination at birth (HDR multiple of the colour) that cools quadratically over life */
  glow?: number;
  /** 0..1 how strongly `opts.color` replaces this particle's hue (default 1; keep white cores low) */
  tint?: number;
}

export type EmitShape = 'point' | 'sphere' | 'shell' | 'disc' | 'ring' | 'box' | 'line';
/** 'tangent' = perpendicular to the radius in the effect plane (with `attract` this gives inward spirals) */
export type EmitVelocity = 'radial' | 'cone' | 'ring' | 'inward' | 'tangent' | 'none';

export interface EmitterDef {
  p: ParticleDef;
  /** particles emitted at `at` (and again every `every` seconds if set) */
  burst?: Range;
  /** repeat interval for `burst` (seconds) while the effect is emitting */
  every?: number;
  /** continuous particles per second between `at` and `until` */
  rate?: number;
  /** start time (seconds from effect start), default 0 */
  at?: number;
  /** end of rate / repeated-burst emission. Default: end of the effect (sustained effects: until stop) */
  until?: number;
  /** spawn volume in the local frame (Y = effect axis). default point */
  shape?: EmitShape;
  /** sphere/shell/disc/ring radius; box half-extent X/Z; */
  radius?: number;
  /** disc inner radius, box half-height, line length (along +Y) */
  height?: number;
  /** box half-extent along Z (defaults to `radius`) */
  depth?: number;
  /** quantise ring/disc angles to N evenly spaced spokes, visited in turn ("racing outward along lines") */
  spokes?: number;
  /** mirror along the effect axis: emit toward −Y */
  flip?: boolean;
  /** local offset of the spawn volume */
  offset?: readonly [number, number, number];
  /** initial velocity direction model, default 'cone' */
  vel?: EmitVelocity;
  /** m/s along the modelled direction */
  speed?: Range;
  /** cone half-angle in radians (π = full sphere, π/2 = hemisphere), default π */
  cone?: number;
  /** extra velocity along the effect axis (+Y) */
  up?: Range;
}

export type ShapeKind =
  | 'dome'      // hemisphere shell: fresnel rim + lattice (stasis, shields)
  | 'sphere'    // full sphere shell
  | 'band'      // open cylinder band expanding outwards (pressure pulse)
  | 'column'    // tall soft light column (recognition, checkpoint)
  | 'wall'      // upright plane: rising light wall with a bright leading edge (quarantine seal, coherent plane)
  | 'hexRipple' // disc facing the effect axis: hex cells lit by an expanding ripple (shield hit)
  | 'iris'      // disc facing the effect axis: aperture closing to a seam (boundary close)
  | 'plane'     // quad facing the effect axis: steady gridded sheet of light with a bright rim (coherent plane)
  | 'halo';     // camera-facing ring that expands/contracts (resonance)

export interface ShapeDef {
  kind: ShapeKind;
  /** seconds; ignored while `sustain` holds it */
  life: number;
  /** stay alive until the owning effect stops, then fade over `life` */
  sustain?: boolean;
  /** one-shot shapes only: use the owning effect's duration as `life` (timing rings that must end on the beat) */
  fit?: boolean;
  color: ColorKey;
  /** second colour (lattice / leading edge), defaults to `color` */
  color2?: ColorKey;
  /** radius (or half-width for wall) at birth → at end of life */
  radius: readonly [number, number];
  /** height for band / column / wall (metres) */
  height?: number;
  /** seconds to ease in (scale/opacity), default 0.15 */
  attack?: number;
  /** local offset */
  offset?: readonly [number, number, number];
  /** shader pattern density / variant knob */
  detail?: number;
}

export type DecalKind = 'scorch' | 'frost' | 'violet' | 'crack' | 'goldRing';

export type FxEvent =
  | { at: number; kind: 'flash'; color: number; intensity: number; seconds?: number; offset?: readonly [number, number, number] }
  | { at: number; kind: 'shock'; radius: number; color: number; seconds?: number }
  | { at: number; kind: 'decal'; decal: DecalKind; size: number; life?: number }
  | { at: number; kind: 'shape'; shape: ShapeDef };

/** Runtime services handed to bespoke `update` hooks (hero effects that need code, not just data). */
export interface FxContext {
  /** seconds since spawn */
  readonly age: number;
  /** total sustain duration (Infinity when open-ended) */
  readonly duration: number;
  readonly stopped: boolean;
  /** four floats of private scratch state, zeroed at spawn */
  readonly state: Float32Array;
  /** emit `count` particles from one of the effect's emitters right now (index into `emitters`) */
  emit(emitter: number, count: number): void;
  flash(color: number, intensity: number, seconds: number): void;
  shock(radius: number, color: number, seconds: number): void;
}

export interface EffectDef {
  emitters?: readonly EmitterDef[];
  events?: readonly FxEvent[];
  /**
   * Sustained effect: default lifetime in seconds when `opts.duration` is not given (Infinity = until stop()).
   * Omit for one-shots.
   */
  sustain?: number;
  /**
   * Wall-like effects: the local frame is only yawed — +Y stays world up, +Z = `dir` flattened onto the ground,
   * +X = the wall tangent. (Default frame: +Y = `dir`.)
   */
  upright?: boolean;
  /** bespoke per-frame logic (pulse acceleration, staged hero beats) */
  update?(fx: FxContext, dt: number): void;
}

/** Sample a Range with a 0..1 random number. */
export function sample(r: Range, u: number): number {
  return typeof r === 'number' ? r : r[0] + (r[1] - r[0]) * u;
}
