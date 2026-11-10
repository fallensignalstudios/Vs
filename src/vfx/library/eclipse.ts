/**
 * Eclipse — violet used sparingly around dark matter. Wisps sway together (one organism), sources snap rather
 * than explode, bodies come apart into light-absorbing flecks.
 */
import type { EffectDef } from '../defs';
import { C, PI, darkMotes, flashGlow, motes, ringPop, smoke, sparks, star, wisps } from './common';

const violetMotes = (o = {}) => motes(C.violetLight, 3, { life: [0.6, 1.2], turb: 2.4, turbFreq: 0.9, unison: true, ...o });

export const ECLIPSE: Record<string, EffectDef> = {
  /** hit on an Eclipse body: dark flecks torn away, a short violet flare, wisps recoiling */
  violetBurst: {
    emitters: [
      { p: flashGlow(C.violet, 3.2, 1.0, 0.16, { color: [[C.violetLight, 3.2], [C.violet, 2], [C.violetDeep, 0]] }), burst: 1 },
      { p: star(C.violetLight, 7, 0.6, 0.08), burst: 1 },
      { p: darkMotes(), burst: [9, 12], vel: 'cone', cone: 1.2, speed: [2, 6] },
      { p: sparks(C.violet, { life: [0.2, 0.45], gravity: 4, color: [[C.violetLight, 5], [C.violet, 3.5], [C.violetDeep, 0.4]] }), burst: [7, 9], vel: 'cone', cone: 1.1, speed: [3, 8] },
      { p: wisps({ life: [0.6, 1.1], size: [0.16, 0.3, 0.4] }), burst: [4, 6], shape: 'sphere', radius: 0.15, vel: 'cone', cone: 1.3, speed: [0.5, 1.8] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.violet, intensity: 1.2, seconds: 0.12 }],
  },

  /** sustained wisps around a corruption source; they lean and sway as one. default 2.5 s */
  violetWisp: {
    sustain: 2.5,
    emitters: [
      { p: wisps(), rate: 6, shape: 'disc', radius: 0.35, vel: 'cone', cone: 0.25, speed: [0.25, 0.6] },
      { p: violetMotes({ life: [1.0, 1.8], gravity: -0.5, drag: 1.2 }), rate: 7, shape: 'disc', radius: 0.45, vel: 'cone', cone: 0.4, speed: [0.2, 0.7] },
    ],
  },

  /**
   * Link severed: a hard white core for a few frames, then the two halves whip back along the link axis
   * (effect axis = link direction) and the wisps lose their unison.
   */
  linkSever: {
    emitters: [
      { p: star(C.white, 11, 0.9, 0.08, { tint: 0 }), burst: 1 },
      { p: { layer: 'add', sprite: 'flare', life: 0.14, size: [0.9, 1.9, 2.2], sizeRand: 1, aspect: 0.5, color: [[C.white, 5], [C.violetLight, 2.4]], fadeIn: 0.02, fadeOut: 0.3, rot: 0, tint: 0 }, burst: 1 },
      { p: ringPop(C.violetLight, 5, 0.1, 1.2, 0.2), burst: 1 },
      { p: sparks(C.violet, { life: [0.25, 0.55], gravity: 3, color: [[C.white, 7], [C.violetLight, 4], [C.violet, 0.5]] }), burst: [12, 14], vel: 'cone', cone: 0.4, speed: [5, 13] },
      { p: sparks(C.violet, { life: [0.25, 0.55], gravity: 3, color: [[C.white, 7], [C.violetLight, 4], [C.violet, 0.5]] }), burst: [12, 14], vel: 'cone', cone: 0.4, speed: [5, 13], flip: true },
      { p: wisps({ life: [0.6, 1.2], unison: false, turb: 4, turbFreq: 2.2, facing: 'camera' }), burst: [6, 8], at: 0.04, shape: 'sphere', radius: 0.25, vel: 'radial', speed: [0.6, 2.2] },
      { p: darkMotes({ life: [0.6, 1.1] }), burst: [8, 10], vel: 'cone', cone: PI, speed: [1, 4] },
    ],
    events: [{ at: 0, kind: 'flash', color: 0xe6dcff, intensity: 3, seconds: 0.12 }],
  },

  /**
   * An Eclipse body comes apart. Emit from a body-sized box centred on pos (≈ chest height); flecks lift and
   * drift together, then a last pinch of light.
   */
  eclipseDissolve: {
    emitters: [
      { p: darkMotes({ life: [0.9, 1.7], gravity: -0.8, drag: 1.5, turb: 3, turbFreq: 0.8, unison: true, size: [0.08, 0.07, 0.02] }), rate: 80, until: 0.75, shape: 'box', radius: 0.32, height: 0.85, vel: 'cone', cone: PI, speed: [0.1, 0.8] },
      { p: wisps({ life: [0.9, 1.6] }), rate: 16, until: 0.8, shape: 'box', radius: 0.3, height: 0.8, vel: 'cone', cone: 0.5, speed: [0.2, 0.7] },
      { p: violetMotes({ life: [0.8, 1.5], gravity: -0.9, drag: 1.2 }), rate: 46, until: 0.9, shape: 'box', radius: 0.34, height: 0.85, vel: 'cone', cone: 0.6, speed: [0.1, 0.9] },
      { p: star(C.violetLight, 9, 0.7, 0.1), burst: 1, at: 0.95, offset: [0, 0.3, 0] },
      { p: ringPop(C.violet, 3.5, 0.5, 0.05, 0.22, { size: [0.9, 0.3, 0.05] }), burst: 1, at: 0.75, offset: [0, 0.3, 0] },
    ],
    events: [
      { at: 0.1, kind: 'decal', decal: 'violet', size: 1.8, life: 9 },
      { at: 0.95, kind: 'flash', color: C.violet, intensity: 1.4, seconds: 0.16 },
    ],
  },

  /** Something comes through: motes drawn to a point on the floor, a stain, then a short upward heave */
  eclipseSpawn: {
    emitters: [
      { p: violetMotes({ life: [0.5, 0.6], unison: false, turb: 0, size: [0.05, 0.04, 0.02] }), rate: 70, until: 0.45, shape: 'shell', radius: 1.5, vel: 'inward', speed: [2.6, 3.0], offset: [0, 0.6, 0] },
      { p: wisps({ life: [0.7, 1.3], gravity: -1.6 }), burst: [9, 11], at: 0.5, shape: 'disc', radius: 0.5, vel: 'cone', cone: 0.5, speed: [1, 2.6] },
      { p: darkMotes({ life: [0.6, 1.1] }), burst: [10, 12], at: 0.5, shape: 'disc', radius: 0.4, vel: 'cone', cone: 0.9, speed: [2, 5] },
      { p: smoke(0x150c22, { life: [0.9, 1.5], size: [0.4, 1.0, 1.4], alpha: 0.4 }), burst: 4, at: 0.5, shape: 'disc', radius: 0.4, vel: 'cone', cone: 0.6, speed: [0.5, 1.4], offset: [0, 0.2, 0] },
      { p: flashGlow(C.violet, 3.5, 1.6, 0.2, { color: [[C.violetLight, 3.5], [C.violet, 2], [C.violetDeep, 0]], floorFade: true }), burst: 1, at: 0.5, offset: [0, 0.3, 0] },
    ],
    events: [
      { at: 0, kind: 'decal', decal: 'violet', size: 2.6, life: 8 },
      { at: 0.5, kind: 'shock', radius: 2.2, color: C.violet, seconds: 0.4 },
      { at: 0.5, kind: 'flash', color: C.violet, intensity: 2, seconds: 0.2, offset: [0, 0.6, 0] },
    ],
  },

  /** Pressure pulse (elite): one expanding band + ground ring. Scale 1 reaches 9 m in 0.9 s. */
  pressurePulse: {
    emitters: [
      { p: flashGlow(C.violet, 4, 2.6, 0.22, { color: [[C.violetLight, 4], [C.violet, 2.4], [C.violetDeep, 0]] }), burst: 1, offset: [0, 0.8, 0] },
      { p: wisps({ life: [0.5, 0.9], drag: 1.6, gravity: -0.2, unison: false, turb: 0 }), burst: [22, 26], shape: 'ring', radius: 0.8, vel: 'ring', speed: [8, 10.5], offset: [0, 0.5, 0] },
      { p: darkMotes({ life: [0.5, 0.9], gravity: 2 }), burst: [16, 18], shape: 'ring', radius: 0.6, vel: 'ring', speed: [6, 10], up: [0.5, 2.5], offset: [0, 0.3, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'band', life: 0.95, color: [C.violet, 2.2], color2: [C.violetLight, 3.2], radius: [0.5, 9], height: 1.5, attack: 0.05 } },
      { at: 0, kind: 'shock', radius: 9, color: C.violet, seconds: 0.95 },
      { at: 0.12, kind: 'shock', radius: 6.5, color: C.violetLight, seconds: 0.8 },
      { at: 0, kind: 'flash', color: C.violet, intensity: 3, seconds: 0.3, offset: [0, 1, 0] },
    ],
  },
};
