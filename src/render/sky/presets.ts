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
  /** saturation of everything in the dome except the red remnant (1 = as authored, 0 = grey) */
  sat: number;
  /** tint multiplied onto the nebula (sRGB hex) */
  nebulaTint: number;
  /** 0..1 how many stars there are (`stars` is how bright they are) */
  starDensity: number;
  /** brightness of the red remnant and its nebula */
  redGain: number;
  /** 0..1 interiors: the megastructure's own hazy, lit upper space replaces open sky above the horizon */
  enclosure: number;
  /** colour of that upper space's haze (sRGB hex) */
  enclosureColor: number;
  /** 0..1 a shut view boundary between the viewer and space (dims and greys everything beyond it) */
  veil: number;
  /**
   * brightness of the Wound's smoke and of the dust its stream drags (its own lavender light on the shell is
   * fixed): a look that crushes its blacks needs more for the smoke to read
   */
  swirl: number;
  /**
   * how far the Wound's void is lifted off black (× the authored core colours): its charcoal depth has to survive
   * the zone's grade — a look that crushes its blacks needs more — yet stay darker than the sky around it, or the
   * absence stops reading (so less against a black sky, or behind a veil)
   */
  woundCore: number;
  /**
   * white balance of everything in space (not the horizon haze, which scenic pieces share): lets a preset be
   * authored against its zone's grade — e.g. warm here so a look with blue split-toned shadows lands on charcoal
   */
  tint: number;
}

/** Unit vector for an (azimuth, elevation) pair in degrees. */
export function dirFromAzEl(az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = az * DEG, e = el * DEG, c = Math.cos(e);
  return out.set(Math.sin(a) * c, Math.sin(e), -Math.cos(a) * c);
}

const D = (o: Partial<SkyPresetDef> & Pick<SkyPresetDef, 'key'>): SkyPresetDef => ({
  wound: { at: [0, 12], radius: 6, vis: 0, lens: 0.55, debris: 1, halo: 1, activity: 0.3 },
  red: { at: [-38, 16], radius: 4, vis: 0 },
  white: { at: [34, 14], radius: 0.24, vis: 0 },
  stars: 1, nebula: 0.6,
  zenith: 0x010207, horizon: 0x05060c, haze: 0x0b0b12, hazeAmt: 0, hazeFall: 9, hazeRed: 0x000000, hazeWhite: 0x000000,
  ground: 0, gain: 1, scenicHaze: 0.00055, scenicAmbient: 0.5,
  battle: { at: [20, 40], spread: 30, fleet: 0, intensity: 0 },
  fill: { at: [-38, 20], color: 0xff5a3c, intensity: 0 },
  sat: 1, nebulaTint: 0xffffff, starDensity: 1, redGain: 1, enclosure: 0, enclosureColor: 0x8a98a6, veil: 0, swirl: 1, woundCore: 0.6, tint: 0xffffff,
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
    white: { at: [23, 27], radius: 0.20, vis: 0.9 },
    stars: 0.9, nebula: 0.7, zenith: 0x010207, horizon: 0x07070f, haze: 0x12111a, hazeAmt: 0.55, hazeFall: 7,
    hazeRed: 0x2a0806, hazeWhite: 0x10141c, ground: 1, scenicHaze: 0.0009, scenicAmbient: 0.8,
    battle: { at: [56, 50], spread: 26, fleet: 1, intensity: 0.6 },
    key: { at: [23, 38], color: 0xe6edff, intensity: 2.2 },
    fill: { at: [-27, 31], color: 0xff5a3c, intensity: 0.35 },
  }),
  // Z03–Z04: daylight inside the megastructure. Frozen atmosphere scatters everything into bright cold haze; the
  // structure's own upper space (far ribs and tiers, a few warm seams) closes overhead instead of open sky. No
  // stars; the bodies are only diffuse light.
  frozenInterior: D({
    wound: { at: [0, 20], radius: 3, vis: 0, lens: 0.5, debris: 0.4, halo: 0.5, activity: 0.2 },
    white: { at: [28, 34], radius: 0.5, vis: 0.22 },
    stars: 0, starDensity: 0, nebula: 0, zenith: 0x7c8b99, horizon: 0xaab8c2, haze: 0xa9b7c1, hazeAmt: 0.85, hazeFall: 2.4,
    hazeWhite: 0x34424e, ground: 1, gain: 1.0, scenicHaze: 0.0015, scenicAmbient: 1.25,
    enclosure: 0.9, enclosureColor: 0x9cabb8,
    battle: { at: [30, 30], spread: 40, fleet: 0, intensity: 0.15 },
    key: { at: [28, 42], color: 0xdfeeff, intensity: 1.6 },
    fill: { at: [-60, 30], color: 0x9fc4dc, intensity: 0.35 },
  }),
  // Z05: looking up through the transparent ceiling into the fleet battle.
  battleCeiling: D({
    wound: { at: [0, 36], radius: 4.6, vis: 1, lens: 0.55, debris: 0.8, halo: 0.9, activity: 0.5 },
    red: { at: [-64, 34], radius: 3.6, vis: 1 },
    white: { at: [58, 44], radius: 0.24, vis: 1 },
    stars: 1, nebula: 0.85, zenith: 0x020309, horizon: 0x080810, haze: 0x15131c, hazeAmt: 0.5, hazeFall: 6,
    hazeRed: 0x2c0a07, hazeWhite: 0x11161f, ground: 1, scenicHaze: 0.0012, scenicAmbient: 0.75,
    battle: { at: [8, 68], spread: 42, fleet: 1, intensity: 0.85 },
    // the key sits high over the carrier's pass, so the hull's shadow crosses the atrium as it clips the tower
    key: { at: [62, 74], color: 0xfff0dd, intensity: 1.8 },
    fill: { at: [-64, 34], color: 0xff5a3c, intensity: 0.3 },
  }),
  // Z06–Z08: enclosed, looking out through deep glass: a dark field of grey-blue nebula and the distant fleet
  // battle low over the horizon, at eye level through a glass wall (not overhead), muffled.
  breachDeep: D({
    stars: 0.6, starDensity: 0.55, nebula: 4.5, nebulaTint: 0xc0c6d6, sat: 0.75,
    zenith: 0x0b0b12, horizon: 0x16161f, haze: 0x1c1c26, hazeAmt: 0.55, hazeFall: 7,
    ground: 1, gain: 1.0, scenicHaze: 0.003, scenicAmbient: 0.35,
    // low enough to fill a glass wall at eye level (Z07), wide enough to reach a clerestory overhead (Z08)
    battle: { at: [0, 20], spread: 38, fleet: 0.6, intensity: 0.3 },
    key: { at: [20, 60], color: 0x9aa4c8, intensity: 0.5 },
  }),
  // Z09: the Wound overlook concept painting. A desaturated night — charcoal, grey-violet, teal-black — with the red
  // remnant as the one accent, small and high on the left; the Wound a soft vortex wholly above the city: a charcoal
  // void (lifted well off black, so its striations survive the gallery's crushed blacks) in a fractured, violet-lit
  // shell, its smoke reaching down behind the spires and its debris stream crossing the red nebula; few stars.
  woundVista: D({
    wound: { at: [0, 15], radius: 9.5, vis: 1, lens: 0.42, debris: 1, halo: 1, activity: 0.45 },
    red: { at: [-34, 21], radius: 4.1, vis: 1 },
    white: { at: [34, 17], radius: 0.30, vis: 1 },
    // (authored a touch warm: the gallery grade pulls shadows toward blue)
    stars: 0.85, starDensity: 0.38, nebula: 3.4, nebulaTint: 0xe2d4ca, sat: 0.36, redGain: 0.68, swirl: 2.4, woundCore: 4, tint: 0xfff2d0,
    zenith: 0x221f1e, horizon: 0x302b29, haze: 0x4d433d, hazeAmt: 0.88, hazeFall: 11,
    hazeRed: 0x260907, hazeWhite: 0x16161a, ground: 1, scenicHaze: 0.00055, scenicAmbient: 1.0,
    battle: { at: [62, 30], spread: 26, fleet: 0.3, intensity: 0.15 },
    key: { at: [34, 24], color: 0xf6efe4, intensity: 1.7 },
    fill: { at: [-34, 21], color: 0xff5a3c, intensity: 0.4 },
  }),
  // Z10: enclosed nested machinery; the view boundary is shut — a dark membrane between the chamber and space. The
  // Wound is still out there, dimmed and greyed behind it among grey nebula and debris: when its pressure is drawn
  // back (setWoundActivity → 0) the disc visibly contracts.
  coreChamber: D({
    wound: { at: [0, 27], radius: 8, vis: 1, lens: 0.3, debris: 0.8, halo: 0.9, activity: 0.3 },
    stars: 0.45, starDensity: 0.45, nebula: 2.6, nebulaTint: 0xc4c0c0, sat: 0.35, swirl: 2.4, woundCore: 0.5, veil: 0.5,
    zenith: 0x0c0c0d, horizon: 0x141315, haze: 0x161518, hazeAmt: 0.55, hazeFall: 4,
    ground: 1, gain: 0.9, scenicHaze: 0.0012, scenicAmbient: 0.5,
    key: { at: [0, 78], color: 0xffe9c4, intensity: 1.5 },
  }),
  // Z11: red remnant left, hard white remnant right, the Wound between.
  observation: D({
    wound: { at: [0, 12], radius: 9, vis: 1, lens: 0.6, debris: 0.9, halo: 0.9, activity: 0.25 },
    red: { at: [-40, 17], radius: 5.2, vis: 1 },
    white: { at: [36, 15], radius: 0.28, vis: 1 },
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
    white: { at: [46, 13], radius: 0.22, vis: 1 },
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
  sat = 1; starDensity = 1; redGain = 1; enclosure = 0; veil = 0; swirl = 1; woundCore = 1;
  readonly nebulaTint = new THREE.Color(1, 1, 1);
  readonly enclosureColor = new THREE.Color(0.25, 0.3, 0.37);
  readonly tint = new THREE.Color(1, 1, 1);

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
    this.sat = d.sat; this.starDensity = d.starDensity; this.redGain = d.redGain; this.enclosure = d.enclosure; this.veil = d.veil; this.swirl = d.swirl; this.woundCore = d.woundCore;
    this.nebulaTint.setHex(d.nebulaTint); this.enclosureColor.setHex(d.enclosureColor); this.tint.setHex(d.tint);
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
  'sat', 'starDensity', 'redGain', 'enclosure', 'veil', 'swirl', 'woundCore',
] as const satisfies readonly (keyof SkyState)[];
const DIR_KEYS = ['woundDir', 'redDir', 'whiteDir', 'battleDir', 'keyDir', 'fillDir'] as const satisfies readonly (keyof SkyState)[];
const COL_KEYS = ['zenith', 'horizon', 'haze', 'hazeRed', 'hazeWhite', 'keyColor', 'fillColor', 'nebulaTint', 'enclosureColor', 'tint'] as const satisfies readonly (keyof SkyState)[];

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
