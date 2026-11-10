/**
 * Shared palette + particle presets for the effect library. Presets return fresh ParticleDefs; pass overrides
 * for the per-effect character. Colours mirror PALETTE in api/materials.ts.
 */
import type { ColorKey, ParticleDef } from '../defs';

export const C = {
  white: 0xffffff,
  heat: 0xfff1d6,        // white-hot
  cinder: 0xff6a1a,
  cinderHot: 0xffb347,
  cinderDeep: 0xb5200a,
  frost: 0xcfeeff,
  frostDeep: 0x7fd0ff,
  ice: 0xf2fbff,
  violet: 0x7a3cff,
  violetLight: 0xb99cff,
  violetDeep: 0x2a0f4d,
  gold: 0xffc56b,
  goldLight: 0xffe2a8,
  goldDeep: 0xc9a45c,
  amber: 0xffa033,
  refBlue: 0xa8d8ff,
  heal: 0xa6ffd0,
  soot: 0x0d0c0c,
  smoke: 0x2b2a2c,
  smokeWarm: 0x3a2f28,
  stone: 0x8d877a,
  dust: 0xc4bcab,       // airborne stone dust reads paler than the solid it came from
  stoneDark: 0x24252b,
  steel: 0x9aa3ad,
  steam: 0xd8e2ea,
} as const;

export const PI = Math.PI;

type Over = Partial<ParticleDef>;

/**
 * Calibration: bloom sprites and flames cover many pixels, so their HDR is scaled down here once — authored
 * intensities in the library stay comparable with the tiny sparks and motes (which keep their full value).
 */
const GLOW_GAIN = 0.3;
const STAR_GAIN = 0.5;
const FLAME_GAIN = 0.6;

/** Velocity-stretched hot sparks that fall, bounce once or twice and die. */
export function sparks(color: number, o: Over = {}): ParticleDef {
  return {
    layer: 'stretch', sprite: 'streak', life: [0.25, 0.7], size: [0.04, 0.032, 0.012], aspect: 3, stretch: 0.05,
    color: [[C.heat, 8], [color, 5.5], [color, 0.8]], colorMid: 0.25, fadeIn: 0.01, fadeOut: 0.6,
    gravity: 9.5, drag: 1.1, bounce: 0.42, tint: 0.85, ...o,
  };
}

/** One soft additive bloom sprite — the HDR core of a flash. */
export function flashGlow(color: number, intensity: number, size: number, life = 0.14, o: Over = {}): ParticleDef {
  const keys: readonly ColorKey[] = o.color ?? [[C.heat, intensity], [color, intensity * 0.6], [color, 0]];
  return {
    layer: 'add', sprite: 'glow', life, size: [size * 0.35, size, size * 1.25], sizeMid: 0.25, sizeRand: 1,
    colorMid: 0.3, fadeIn: 0.02, fadeOut: 0.25, rot: 0, tint: 0.6, ...o,
    color: keys.map((k): ColorKey => [k[0], k[1] * GLOW_GAIN]),
  };
}

/** A sharp four-point star flash (the instant of contact). */
export function star(color: number, intensity: number, size: number, life = 0.09, o: Over = {}): ParticleDef {
  return {
    layer: 'add', sprite: 'spark', life, size: [size * 0.5, size, size * 0.3], sizeMid: 0.2, sizeRand: 1,
    color: [[C.white, intensity * STAR_GAIN], [color, intensity * STAR_GAIN * 0.5]], fadeIn: 0.01, fadeOut: 0.3, rot: [0, PI / 2], tint: 0.35, ...o,
  };
}

/** Embers: rise on heat, wander, flicker and cool from white-orange to dull red. */
export function embers(o: Over = {}): ParticleDef {
  return {
    layer: 'add', sprite: 'ember', life: [0.9, 2.2], size: [0.06, 0.05, 0.015], sizeRand: [0.5, 1.4],
    color: [[C.cinderHot, 6], [C.cinder, 3.5], [C.cinderDeep, 0.8]], colorMid: 0.3, fadeIn: 0.03, fadeOut: 0.6,
    gravity: -1.3, drag: 1.4, turb: 3.2, turbFreq: 1.6, flicker: 0.55, spin: 2, ...o,
  };
}

/**
 * Flame tongues: additive smoke-shaped sprites, orange-hot → deep red. They fade IN over the first fifth of their
 * life so a burst of overlapping flames never stacks into a white-out on the frame of the flash itself.
 */
export function flame(o: Over = {}): ParticleDef {
  return {
    layer: 'add', sprite: ['smoke0', 'smoke1', 'smoke2', 'smoke3'], life: [0.22, 0.45], size: [0.2, 0.6, 0.85], sizeMid: 0.35,
    color: [[C.cinderHot, 3.4 * FLAME_GAIN], [C.cinder, 3.2 * FLAME_GAIN], [C.cinderDeep, 0.5 * FLAME_GAIN]], colorMid: 0.35, alpha: 0.9,
    fadeIn: 0.22, fadeOut: 0.4, gravity: -2.2, drag: 3.5, spin: 1.6, ...o,
  };
}

/** Licking flame tongues: upright wisps that stretch upward and vanish — the high-frequency detail on a fireball. */
export function tongues(o: Over = {}): ParticleDef {
  return {
    layer: 'add', sprite: ['wisp0', 'wisp1'], life: [0.22, 0.42], size: [0.25, 0.55, 0.7], aspect: 1.7, sizeMid: 0.4,
    color: [[C.heat, 3.2 * FLAME_GAIN], [C.cinder, 3.4 * FLAME_GAIN], [C.cinderDeep, 0.4 * FLAME_GAIN]], colorMid: 0.3, alpha: 0.9,
    fadeIn: 0.15, fadeOut: 0.4, gravity: -5, drag: 2.5, rot: [-0.5, 0.5], spin: [-0.6, 0.6], facing: 'upright', ...o,
  };
}

/** Lit, soft-edged smoke that billows, rises and thins out. `glow` > 0 lights it from within at birth. */
export function smoke(color: number = C.smoke, o: Over = {}): ParticleDef {
  return {
    layer: 'lit', sprite: ['smoke0', 'smoke1', 'smoke2', 'smoke3'], life: [1.3, 2.4], size: [0.35, 0.95, 1.5], sizeMid: 0.35,
    color: [[color, 1]], alpha: 0.42, fadeIn: 0.12, fadeOut: 0.3, gravity: -0.45, drag: 1.7, spin: 0.5,
    turb: 0.5, turbFreq: 0.4, floorFade: true, tint: 0.4, ...o,
  };
}

/** Low pale dust kicked along a surface. */
export function dust(color: number = C.dust, o: Over = {}): ParticleDef {
  return {
    layer: 'lit', sprite: ['smoke1', 'smoke2', 'smoke3'], life: [0.6, 1.2], size: [0.18, 0.5, 0.8], sizeMid: 0.4,
    color: [[color, 1]], alpha: 0.26, fadeIn: 0.1, fadeOut: 0.25, gravity: -0.1, drag: 3.2, spin: 0.6, floorFade: true, tint: 0.7, ...o,
  };
}

/** Fine lit grit: tiny grains that are thrown or simply fall (reads correctly in dark and bright rooms). */
export function grit(color: number = C.dust, o: Over = {}): ParticleDef {
  return {
    layer: 'lit', sprite: 'dot', life: [0.5, 1.0], size: [0.04, 0.035, 0.02], sizeRand: [0.5, 1.5],
    color: [[color, 1]], alpha: 0.85, fadeIn: 0.05, fadeOut: 0.6, gravity: 7, drag: 1.4, tint: 0.8, ...o,
  };
}

/** Tumbling solid fragments (stone / metal) that fall and bounce. */
export function chips(color: number, o: Over = {}): ParticleDef {
  return {
    layer: 'alpha', sprite: ['chip0', 'chip1'], life: [0.9, 1.6], size: [0.09, 0.09, 0.07], sizeRand: [0.5, 1.5],
    color: [[color, 1]], fadeIn: 0.01, fadeOut: 0.8, gravity: 9.8, drag: 0.4, bounce: 0.36, spin: 9, tint: 0.9, ...o,
  };
}

/** Glassy angular shards (frost, shield cells) — HDR pale so they catch bloom at their rims. */
export function shards(color: number, o: Over = {}): ParticleDef {
  return {
    layer: 'alpha', sprite: ['shard0', 'shard1', 'shard2'], life: [0.9, 1.5], size: [0.16, 0.16, 0.1], sizeRand: [0.45, 1.35],
    color: [[C.ice, 2.4], [color, 1.5], [color, 0.9]], colorMid: 0.2, alpha: 0.92, fadeIn: 0.02, fadeOut: 0.72,
    spin: 1.2, tint: 0.8, ...o,
  };
}

/** Small steady light points (information / recognition / frost glints). */
export function motes(color: number, intensity: number, o: Over = {}): ParticleDef {
  return {
    layer: 'add', sprite: 'dot', life: [0.8, 1.6], size: [0.035, 0.05, 0.02], sizeRand: [0.6, 1.4],
    color: [[color, intensity]], fadeIn: 0.15, fadeOut: 0.5, ...o,
  };
}

/** A sprite ring that snaps outward — crisp accent for precise hits. `facing: 'ground'` lays it on the floor. */
export function ringPop(color: number, intensity: number, from: number, to: number, life = 0.28, o: Over = {}): ParticleDef {
  return {
    layer: 'add', sprite: 'ring', life, size: [from, to * 0.85, to], sizeMid: 0.35, sizeRand: 1,
    color: [[C.white, intensity], [color, intensity * 0.7], [color, 0]], colorMid: 0.25, fadeIn: 0.02, fadeOut: 0.35, rot: 0, tint: 0.7, ...o,
  };
}

/** Eclipse wisps: smoky strands that sway *in unison* as they rise and thin. */
export function wisps(o: Over = {}): ParticleDef {
  return {
    layer: 'add', sprite: ['wisp0', 'wisp1'], life: [1.1, 2.0], size: [0.22, 0.42, 0.55], aspect: 1.9, sizeMid: 0.4,
    color: [[C.violetLight, 2.2], [C.violet, 1.7], [C.violetDeep, 0.6]], colorMid: 0.3, alpha: 0.85, fadeIn: 0.18, fadeOut: 0.45,
    gravity: -0.5, drag: 1.6, turb: 2.4, turbFreq: 0.9, unison: true, rot: [-0.35, 0.35], spin: [-0.25, 0.25], facing: 'upright', ...o,
  };
}

/** Light-absorbing flecks torn off an Eclipse body. */
export function darkMotes(o: Over = {}): ParticleDef {
  return {
    layer: 'alpha', sprite: ['chip0', 'drop', 'chip1'], life: [0.7, 1.4], size: [0.06, 0.05, 0.02], sizeRand: [0.5, 1.5],
    color: [[0x120a1e, 1], [0x08050d, 1]], alpha: 0.95, fadeIn: 0.02, fadeOut: 0.6, gravity: 4, drag: 1.4, spin: 5, tint: 0, ...o,
  };
}
