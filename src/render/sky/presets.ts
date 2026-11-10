/**
 * Sky preset table + blendable sky state. Pure data/maths (no rendering) so the layout rules from the level
 * plan can be unit-tested: red remnant LEFT, white remnant RIGHT, the Wound BETWEEN.
 *
 * Angles are authored in degrees as (azimuth, elevation): azimuth 0 = north (−Z), +90 = east (+X) — the same
 * convention as engine yaw mirrored to compass bearings — elevation up from the horizon.
 */
import * as THREE from 'three';
import type { SkyPreset } from '@/core/api';
import { DEG, clamp01 } from '@/core/mathx';

/** Every preset id, in mission order (handy for debug menus and sandboxes). */
export const SKY_PRESET_IDS: readonly SkyPreset[] = [
  'void', 'crashRib', 'frozenInterior', 'battleCeiling', 'breachDeep', 'woundVista', 'coreChamber', 'observation', 'hangar',
];

type AzEl = readonly [az: number, el: number];

/** Authoring form of a preset (degrees, sRGB hex). */
export interface SkyPresetDef {
  wound: { at: AzEl; radius: number; vis: number; lens: number; debris: number; halo: number; activity: number };
  red: { at: AzEl; radius: number; vis: number };
  white: { at: AzEl; radius: number; vis: number };
  stars: number;
  nebula: number;
  zenith: number;
  horizon: number;
  /** horizon haze colour (also the colour distant megastructure dissolves into) */
  haze: number;
  /** 0..1 strength of the haze band at the horizon, and how fast it thins with elevation (higher = thinner band) */
  hazeAmt: number;
  hazeFall: number;
  /** tint added to the haze toward the red / white remnant */
  hazeRed: number;
  hazeWhite: number;
  /** 0 = stars all around (open space), 1 = opaque dark ground below the horizon */
  ground: number;
  /** overall dome brightness */
  gain: number;
  /** scenic megastructure: haze extinction per metre and ambient fill */
  scenicHaze: number;
  scenicAmbient: number;
  battle: { at: AzEl; spread: number; fleet: number; intensity: number };
  key: { at: AzEl; color: number; intensity: number };
  fill: { at: AzEl; color: number; intensity: number };
}

/** Unit vector for an (azimuth, elevation) pair in degrees. */
export function dirFromAzEl(az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = az * DEG, e = el * DEG, c = Math.cos(e);
  return out.set(Math.sin(a) * c, Math.sin(e), -Math.cos(a) * c);
}

const D = (o: Partial<SkyPresetDef> & Pick<SkyPresetDef, 'key'>): SkyPresetDef => ({
  wound: { at: [0, 12], radius: 6, vis: 0, lens: 0.55, debris: 1, halo: 1, activity: 0.3 },
  red: { at: [-38, 16], radius: 4, vis: 0 },
  white: { at: [34, 14], radius: 0.16, vis: 0 },
  stars: 1, nebula: 0.6,
  zenith: 0x010207, horizon: 0x05060c, haze: 0x0b0b12, hazeAmt: 0, hazeFall: 9, hazeRed: 0x000000, hazeWhite: 0x000000,
  ground: 0, gain: 1, scenicHaze: 0.00055, scenicAmbient: 0.5,
  battle: { at: [20, 40], spread: 30, fleet: 0, intensity: 0 },
  fill: { at: [-38, 20], color: 0xff5a3c, intensity: 0 },
  ...o,
});

export const SKY_PRESETS: Readonly<Record<SkyPreset, SkyPresetDef>> = {
  // Title / fallback: quiet stars only.
  void: D({
    stars: 0.55, nebula: 0.35, gain: 0.9,
    key: { at: [30, 55], color: 0xdfe6ff, intensity: 1.0 },
  }),
  // Z00–Z02: seen through fractured ribs. A contained Wound far away; the fleets are still fighting.
  crashRib: D({
    wound: { at: [0, 21], radius: 2.3, vis: 1, lens: 0.5, debris: 0.55, halo: 0.7, activity: 0.35 },
    red: { at: [-27, 31], radius: 2.1, vis: 0.9 },
    white: { at: [23, 27], radius: 0.11, vis: 0.9 },
    stars: 0.9, nebula: 0.7, zenith: 0x010207, horizon: 0x07070f, haze: 0x12111a, hazeAmt: 0.55, hazeFall: 7,
    hazeRed: 0x2a0806, hazeWhite: 0x10141c, ground: 1, scenicHaze: 0.0009, scenicAmbient: 0.8,
    battle: { at: [38, 44], spread: 34, fleet: 1, intensity: 0.6 },
    key: { at: [23, 38], color: 0xe6edff, intensity: 2.2 },
    fill: { at: [-27, 31], color: 0xff5a3c, intensity: 0.35 },
  }),
  // Z03–Z04: frozen atmosphere scatters everything into a pale cold glow; bodies are only diffuse light.
  frozenInterior: D({
    wound: { at: [0, 20], radius: 3, vis: 0, lens: 0.5, debris: 0.4, halo: 0.5, activity: 0.2 },
    white: { at: [28, 34], radius: 0.5, vis: 0.35 },
    stars: 0.22, nebula: 0.3, zenith: 0x060b14, horizon: 0x1b2a3a, haze: 0x2a4257, hazeAmt: 0.92, hazeFall: 1.6,
    hazeWhite: 0x38546a, ground: 1, gain: 0.9, scenicHaze: 0.0022, scenicAmbient: 0.8,
    battle: { at: [30, 48], spread: 40, fleet: 0.25, intensity: 0.25 },
    key: { at: [28, 42], color: 0xbfe0ff, intensity: 1.5 },
    fill: { at: [-60, 30], color: 0x7fb4d8, intensity: 0.3 },
  }),
  // Z05: looking up through the transparent ceiling into the fleet battle.
  battleCeiling: D({
    wound: { at: [0, 36], radius: 4.6, vis: 1, lens: 0.55, debris: 0.8, halo: 0.9, activity: 0.5 },
    red: { at: [-64, 34], radius: 3.6, vis: 1 },
    white: { at: [58, 44], radius: 0.13, vis: 1 },
    stars: 1, nebula: 0.85, zenith: 0x020309, horizon: 0x080810, haze: 0x15131c, hazeAmt: 0.5, hazeFall: 6,
    hazeRed: 0x2c0a07, hazeWhite: 0x11161f, ground: 1, scenicHaze: 0.0012, scenicAmbient: 0.75,
    battle: { at: [8, 68], spread: 42, fleet: 1, intensity: 0.85 },
    key: { at: [58, 62], color: 0xfff0dd, intensity: 1.8 },
    fill: { at: [-64, 34], color: 0xff5a3c, intensity: 0.3 },
  }),
  // Z06–Z08: enclosed. Only muffled impacts leak in.
  breachDeep: D({
    stars: 0.14, nebula: 0.25, zenith: 0x010104, horizon: 0x05040a, haze: 0x0a0812, hazeAmt: 0.8, hazeFall: 2.5,
    ground: 1, gain: 0.7, scenicHaze: 0.003, scenicAmbient: 0.35,
    battle: { at: [0, 60], spread: 45, fleet: 0.15, intensity: 0.3 },
    key: { at: [20, 60], color: 0x9aa4c8, intensity: 0.5 },
  }),
  // Z09: the Wound overlook concept painting.
  woundVista: D({
    wound: { at: [0, 8.5], radius: 14, vis: 1, lens: 0.6, debris: 1, halo: 1, activity: 0.45 },
    red: { at: [-37, 16], radius: 7.4, vis: 1 },
    white: { at: [33, 11], radius: 0.17, vis: 1 },
    stars: 1, nebula: 1, zenith: 0x010207, horizon: 0x06060d, haze: 0x2b2c38, hazeAmt: 0.8, hazeFall: 15,
    hazeRed: 0x3a0c08, hazeWhite: 0x1a2028, ground: 1, scenicHaze: 0.00042, scenicAmbient: 1.0,
    battle: { at: [62, 30], spread: 26, fleet: 0.6, intensity: 0.15 },
    key: { at: [33, 24], color: 0xe4ecff, intensity: 1.7 },
    fill: { at: [-37, 18], color: 0xff5a3c, intensity: 0.45 },
  }),
  // Z10: enclosed nested machinery; the view boundary is shut — dim grey nebula between immense members.
  coreChamber: D({
    stars: 0.5, nebula: 0.9, zenith: 0x020306, horizon: 0x07080c, haze: 0x0d0e13, hazeAmt: 0.6, hazeFall: 4,
    ground: 1, gain: 0.8, scenicHaze: 0.0012, scenicAmbient: 0.5,
    key: { at: [0, 78], color: 0xffe9c4, intensity: 1.5 },
  }),
  // Z11: red remnant left, hard white remnant right, the Wound between.
  observation: D({
    wound: { at: [0, 12], radius: 9, vis: 1, lens: 0.6, debris: 0.9, halo: 0.9, activity: 0.25 },
    red: { at: [-40, 17], radius: 5.2, vis: 1 },
    white: { at: [36, 15], radius: 0.15, vis: 1 },
    stars: 1, nebula: 0.9, zenith: 0x010207, horizon: 0x05050b, haze: 0x13131a, hazeAmt: 0.45, hazeFall: 14,
    hazeRed: 0x2e0a07, hazeWhite: 0x141a22, ground: 1, scenicHaze: 0.0005,
    battle: { at: [70, 26], spread: 24, fleet: 0.7, intensity: 0.08 },
    key: { at: [36, 22], color: 0xe8f0ff, intensity: 1.4 },
    fill: { at: [-40, 18], color: 0xff5a3c, intensity: 0.5 },
  }),
  // Z12: outer ring. Both fleets hold position, wary; nothing is firing.
  hangar: D({
    wound: { at: [0, 10], radius: 5.5, vis: 1, lens: 0.55, debris: 0.8, halo: 0.8, activity: 0.15 },
    red: { at: [-52, 15], radius: 3.4, vis: 1 },
    white: { at: [46, 13], radius: 0.13, vis: 1 },
    stars: 1, nebula: 0.8, zenith: 0x010207, horizon: 0x05060c, haze: 0x111219, hazeAmt: 0.35, hazeFall: 12,
    hazeRed: 0x220806, hazeWhite: 0x12171f, ground: 0.6, scenicHaze: 0.0006, scenicAmbient: 0.9,
    battle: { at: [0, 20], spread: 50, fleet: 1, intensity: 0 },
    key: { at: [46, 30], color: 0xfff1dc, intensity: 1.6 },
    fill: { at: [-52, 16], color: 0xff5a3c, intensity: 0.3 },
  }),
};

/** Runtime (blendable) form: unit vectors, radians, linear colours. */
export class SkyState {
  readonly woundDir = new THREE.Vector3(0, 0.2, -1).normalize();
  woundRadius = 0.1; woundVis = 0; woundLens = 0.55; woundDebris = 1; woundHalo = 1; woundActivity = 0.3;
  readonly redDir = new THREE.Vector3(-0.6, 0.3, -0.75).normalize();
  redRadius = 0.07; redVis = 0;
  readonly whiteDir = new THREE.Vector3(0.55, 0.25, -0.8).normalize();
  whiteRadius = 0.003; whiteVis = 0;
  stars = 1; nebula = 0.6;
  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly haze = new THREE.Color();
  readonly hazeRed = new THREE.Color();
  readonly hazeWhite = new THREE.Color();
  hazeAmt = 0; hazeFall = 9; ground = 0; gain = 1; scenicHaze = 0.0005; scenicAmbient = 0.5;
  readonly battleDir = new THREE.Vector3(0, 1, 0);
  battleSpread = 0.5; fleet = 0; battleIntensity = 0;
  readonly keyDir = new THREE.Vector3(0.3, 0.8, 0.5).normalize();
  readonly keyColor = new THREE.Color(1, 1, 1);
  keyIntensity = 1;
  readonly fillDir = new THREE.Vector3(-0.5, 0.4, 0.5).normalize();
  readonly fillColor = new THREE.Color(1, 0.35, 0.25);
  fillIntensity = 0;

  /** Load from an authored preset. */
  setFromDef(d: SkyPresetDef): this {
    dirFromAzEl(d.wound.at[0], d.wound.at[1], this.woundDir);
    this.woundRadius = d.wound.radius * DEG; this.woundVis = d.wound.vis; this.woundLens = d.wound.lens;
    this.woundDebris = d.wound.debris; this.woundHalo = d.wound.halo; this.woundActivity = d.wound.activity;
    dirFromAzEl(d.red.at[0], d.red.at[1], this.redDir);
    this.redRadius = d.red.radius * DEG; this.redVis = d.red.vis;
    dirFromAzEl(d.white.at[0], d.white.at[1], this.whiteDir);
    this.whiteRadius = d.white.radius * DEG; this.whiteVis = d.white.vis;
    this.stars = d.stars; this.nebula = d.nebula;
    this.zenith.setHex(d.zenith); this.horizon.setHex(d.horizon); this.haze.setHex(d.haze);
    this.hazeRed.setHex(d.hazeRed); this.hazeWhite.setHex(d.hazeWhite);
    this.hazeAmt = d.hazeAmt; this.hazeFall = d.hazeFall; this.ground = d.ground; this.gain = d.gain;
    this.scenicHaze = d.scenicHaze; this.scenicAmbient = d.scenicAmbient;
    dirFromAzEl(d.battle.at[0], d.battle.at[1], this.battleDir);
    this.battleSpread = d.battle.spread * DEG; this.fleet = d.battle.fleet; this.battleIntensity = d.battle.intensity;
    dirFromAzEl(d.key.at[0], d.key.at[1], this.keyDir);
    this.keyColor.setHex(d.key.color); this.keyIntensity = d.key.intensity;
    dirFromAzEl(d.fill.at[0], d.fill.at[1], this.fillDir);
    this.fillColor.setHex(d.fill.color); this.fillIntensity = d.fill.intensity;
    return this;
  }

  copy(s: SkyState): this {
    blendSkyStates(s, s, 0, this);
    return this;
  }
}

const NUM_KEYS = [
  'woundRadius', 'woundVis', 'woundLens', 'woundDebris', 'woundHalo', 'woundActivity', 'redRadius', 'redVis',
  'whiteRadius', 'whiteVis', 'stars', 'nebula', 'hazeAmt', 'hazeFall', 'ground', 'gain', 'scenicHaze', 'scenicAmbient',
  'battleSpread', 'fleet', 'battleIntensity', 'keyIntensity', 'fillIntensity',
] as const satisfies readonly (keyof SkyState)[];
const DIR_KEYS = ['woundDir', 'redDir', 'whiteDir', 'battleDir', 'keyDir', 'fillDir'] as const satisfies readonly (keyof SkyState)[];
const COL_KEYS = ['zenith', 'horizon', 'haze', 'hazeRed', 'hazeWhite', 'keyColor', 'fillColor'] as const satisfies readonly (keyof SkyState)[];

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

/** Spherical interpolation between two unit vectors (stable for near-parallel and near-opposite inputs). */
export function slerpDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  if (t <= 0) return out.copy(a);
  if (t >= 1) return out.copy(b);
  _q.setFromUnitVectors(a, b);
  _qi.identity().slerp(_q, t);
  return out.copy(a).applyQuaternion(_qi).normalize();
}

/** out = lerp(a, b, t) for every field (directions slerp). `out` may alias `a` or `b`. */
export function blendSkyStates(a: SkyState, b: SkyState, t: number, out: SkyState): SkyState {
  const k = clamp01(t);
  for (const key of NUM_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  for (const key of DIR_KEYS) slerpDir(a[key], b[key], k, out[key]);
  for (const key of COL_KEYS) {
    const ca = a[key], cb = b[key];
    out[key].setRGB(ca.r + (cb.r - ca.r) * k, ca.g + (cb.g - ca.g) * k, ca.b + (cb.b - ca.b) * k);
  }
  return out;
}

/** Rotate every direction in the state about +Y by `yaw` radians (engine yaw: positive turns left / CCW from above). */
export function rotateSkyState(src: SkyState, yaw: number, out: SkyState): SkyState {
  if (out !== src) out.copy(src);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const key of DIR_KEYS) {
    const v = out[key];
    const x = v.x * c + v.z * s, z = -v.x * s + v.z * c;
    v.x = x; v.z = z;
  }
  return out;
}
