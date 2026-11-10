/** Destruction — explosions, broken devices, falling debris, the Z07 cage release. */
import type { EffectDef } from '../defs';
import { C, PI, chips, dust, embers, flame, flashGlow, grit, motes, ringPop, smoke, sparks, star } from './common';

export const DESTRUCTION: Record<string, EffectDef> = {
  explosionSmall: {
    emitters: [
      { p: flashGlow(C.cinderHot, 9, 3.2, 0.16), burst: 1 },
      { p: star(C.heat, 13, 1.9, 0.09), burst: 1 },
      { p: flame({ life: [0.25, 0.5], size: [0.3, 0.7, 1.0], drag: 4.5 }), burst: [18, 22], shape: 'sphere', radius: 0.25, vel: 'radial', speed: [1.5, 6.5] },
      { p: flame({ life: [0.14, 0.24], size: [0.3, 0.6, 0.7], drag: 6, color: [[C.heat, 3], [C.cinderHot, 2.4], [C.cinder, 0.4]], fadeIn: 0.1 }), burst: 6, shape: 'sphere', radius: 0.1, vel: 'radial', speed: [0.5, 2.5] },
      { p: sparks(C.cinderHot, { life: [0.35, 0.9] }), burst: [28, 34], vel: 'cone', cone: PI, speed: [4, 14] },
      { p: smoke(C.smoke, { life: [1.2, 2.0], size: [0.45, 1.2, 1.7], alpha: 0.34, glow: 2.2 }), burst: [5, 6], at: 0.05, shape: 'sphere', radius: 0.35, vel: 'radial', speed: [0.5, 1.5] },
      { p: chips(C.stoneDark), burst: [7, 9], vel: 'cone', cone: 1.2, speed: [3, 8] },
      { p: embers({ life: [0.8, 1.6] }), burst: [8, 10], shape: 'sphere', radius: 0.4, vel: 'radial', speed: [0.5, 2.5] },
    ],
    events: [
      { at: 0, kind: 'flash', color: C.cinderHot, intensity: 4.5, seconds: 0.26 },
      { at: 0, kind: 'shock', radius: 3, color: C.cinderHot, seconds: 0.36 },
      { at: 0, kind: 'decal', decal: 'scorch', size: 2.4, life: 16 },
    ],
  },

  /** two-stage: instant core + radial fire, then a rolling lit smoke column with embers */
  explosionLarge: {
    emitters: [
      { p: flashGlow(C.heat, 9, 5.2, 0.2), burst: 1, offset: [0, 0.5, 0] },
      { p: star(C.white, 11, 2.4, 0.1), burst: 1, offset: [0, 0.5, 0] },
      { p: flame({ life: [0.3, 0.6], size: [0.7, 1.6, 2.1], drag: 4 }), burst: [18, 22], shape: 'sphere', radius: 0.4, vel: 'radial', speed: [3.5, 9.5], offset: [0, 0.5, 0] },
      { p: flame({ life: [0.5, 0.9], size: [0.8, 1.8, 2.4], gravity: -4.5, drag: 2.2 }), burst: [9, 11], at: 0.08, shape: 'sphere', radius: 0.6, vel: 'cone', cone: 0.5, speed: [2, 5], offset: [0, 0.6, 0] },
      { p: sparks(C.cinderHot, { life: [0.5, 1.3], size: [0.04, 0.03, 0.01] }), burst: [60, 70], vel: 'cone', cone: 1.9, speed: [6, 22], offset: [0, 0.3, 0] },
      { p: smoke(C.soot, { life: [2.2, 3.6], size: [0.8, 2.1, 3.2], alpha: 0.46, glow: 2.6, gravity: -0.9 }), burst: [12, 14], at: 0.1, shape: 'sphere', radius: 0.8, vel: 'cone', cone: 0.9, speed: [0.8, 2.6], offset: [0, 0.6, 0] },
      { p: dust(C.smokeWarm, { life: [1.0, 1.8], size: [0.6, 1.6, 2.4], alpha: 0.3 }), burst: [10, 12], shape: 'ring', radius: 1.0, vel: 'ring', speed: [4, 7.5], up: [0.1, 0.5], offset: [0, 0.2, 0] },
      { p: chips(C.stoneDark, { life: [1.2, 2.0], size: [0.11, 0.11, 0.08] }), burst: [18, 22], vel: 'cone', cone: 1.2, speed: [4, 12] },
      { p: embers({ life: [1.4, 3.0] }), rate: 40, at: 0.1, until: 0.9, shape: 'sphere', radius: 1.4, vel: 'cone', cone: 0.9, speed: [0.5, 3], offset: [0, 0.6, 0] },
    ],
    events: [
      { at: 0, kind: 'flash', color: C.cinderHot, intensity: 9, seconds: 0.5, offset: [0, 1, 0] },
      { at: 0, kind: 'shock', radius: 4.5, color: C.heat, seconds: 0.3 },
      { at: 0.04, kind: 'shock', radius: 7.5, color: C.cinder, seconds: 0.65 },
      { at: 0, kind: 'decal', decal: 'scorch', size: 5.5, life: 20 },
      { at: 0, kind: 'decal', decal: 'crack', size: 4.2, life: 20 },
    ],
  },

  /** A device dies electrically: stuttering arc pops, cold sparks, thin dark smoke. Tint to its owner colour. */
  deviceBreak: {
    emitters: [
      { p: star(C.ice, 13, 1.2, 0.08), burst: 1 },
      { p: flashGlow(C.refBlue, 4.5, 1.6, 0.14, { color: [[C.white, 4.5], [C.refBlue, 2.5], [C.refBlue, 0]] }), burst: 1 },
      { p: sparks(C.refBlue, { life: [0.3, 0.8], color: [[C.white, 7], [C.refBlue, 4.5], [C.refBlue, 0.5]] }), burst: [20, 24], vel: 'cone', cone: 1.5, speed: [3, 11] },
      { p: sparks(C.cinderHot, { life: [0.3, 0.7] }), burst: [8, 10], vel: 'cone', cone: 1.2, speed: [2, 7] },
      // arc pops that keep stuttering for half a second
      { p: star(C.refBlue, 9, 0.5, 0.06), burst: 1, every: 0.09, at: 0.1, until: 0.6, shape: 'sphere', radius: 0.35 },
      { p: sparks(C.refBlue, { life: [0.15, 0.35], color: [[C.white, 7], [C.refBlue, 4.5], [C.refBlue, 0.5]] }), burst: 3, every: 0.09, at: 0.1, until: 0.6, shape: 'sphere', radius: 0.3, vel: 'cone', cone: PI, speed: [1.5, 5] },
      { p: chips(C.steel), burst: [7, 9], vel: 'cone', cone: 1.2, speed: [2, 6.5] },
      { p: smoke(C.soot, { life: [1.2, 2.0], size: [0.25, 0.7, 1.1], alpha: 0.34, floorFade: false }), rate: 7, at: 0.1, until: 0.8, vel: 'cone', cone: 0.35, speed: [0.5, 1.3] },
    ],
    events: [
      { at: 0, kind: 'flash', color: C.refBlue, intensity: 2.4, seconds: 0.12 },
      { at: 0.19, kind: 'flash', color: C.refBlue, intensity: 1.2, seconds: 0.08 },
      { at: 0.37, kind: 'flash', color: C.refBlue, intensity: 0.8, seconds: 0.08 },
    ],
  },

  /**
   * Debris shaken loose from above (pos = where it starts falling). Sustained, default 1.2 s.
   * Chips fall and bounce on the floor below; dust sheets drift down behind them.
   */
  debrisFall: {
    sustain: 1.2,
    emitters: [
      { p: chips(C.stone, { life: [1.6, 2.6], size: [0.1, 0.1, 0.08], fadeOut: 0.85 }), rate: 16, shape: 'box', radius: 0.9, height: 0.1, vel: 'cone', cone: PI, speed: [0, 0.8] },
      // thin streams of grit pouring from a few points
      { p: grit(C.dust, { life: [1.4, 2.0], gravity: 8, drag: 0.5, bounce: 0.15, fadeOut: 0.8 }), rate: 70, shape: 'ring', radius: 0.7, spokes: 5, vel: 'cone', cone: PI, speed: [0, 0.35] },
      { p: dust(C.dust, { life: [1.4, 2.2], size: [0.35, 0.9, 1.4], alpha: 0.16, gravity: 1.4, drag: 1.1, floorFade: true }), rate: 7, shape: 'box', radius: 0.8, height: 0.1, vel: 'none' },
    ],
  },

  /**
   * Cage destroyed (Z07): metal bursts apart, then a clean white-gold ring opens — a release, not a kill.
   */
  cageDestroy: {
    emitters: [
      { p: flashGlow(C.goldLight, 6, 2.6, 0.18), burst: 1, offset: [0, 1, 0] },
      { p: star(C.white, 10, 1.5, 0.1), burst: 1, offset: [0, 1, 0] },
      { p: sparks(C.cinderHot, { life: [0.4, 1.0] }), burst: [44, 52], shape: 'box', radius: 0.8, height: 1.0, vel: 'radial', speed: [4, 13], up: [0, 3], offset: [0, 1, 0] },
      { p: chips(C.steel, { sprite: ['shard2', 'chip0', 'chip1'], life: [1.2, 2.0], size: [0.16, 0.16, 0.12], color: [[0x4a4f58, 1]], spin: 7 }), burst: [22, 26], shape: 'box', radius: 0.9, height: 1.0, vel: 'radial', speed: [2.5, 7.5], up: [1, 5], offset: [0, 1, 0] },
      { p: smoke(C.smoke, { life: [1.2, 2.0], alpha: 0.3, glow: 1.4 }), burst: [6, 7], at: 0.05, shape: 'box', radius: 0.7, height: 0.8, vel: 'cone', cone: 0.8, speed: [0.5, 1.5], offset: [0, 0.9, 0] },
      { p: motes(C.goldLight, 3.5, { sprite: 'diamond', life: [1.0, 1.8], size: [0.05, 0.07, 0.03], gravity: -0.35, flicker: 0.4 }), burst: [16, 20], at: 0.15, shape: 'box', radius: 0.9, height: 1.0, vel: 'cone', cone: 0.6, speed: [0.1, 0.6], offset: [0, 1, 0] },
      { p: ringPop(C.goldLight, 4, 0.4, 3.4, 0.5, { facing: 'ground' }), burst: 1, at: 0.12, offset: [0, 0.08, 0] },
    ],
    events: [
      { at: 0, kind: 'flash', color: C.goldLight, intensity: 5, seconds: 0.3, offset: [0, 1.2, 0] },
      { at: 0, kind: 'shock', radius: 4, color: C.goldLight, seconds: 0.5 },
      { at: 0.12, kind: 'shape', shape: { kind: 'halo', life: 0.7, color: [C.goldLight, 1.9], color2: [C.white, 1.2], radius: [0.5, 3.2], attack: 0.05, detail: 40, offset: [0, 1.1, 0] } },
    ],
  },
};
