/** Impacts — small, fast, directional. The effect axis (+Y) is the surface normal. */
import type { EffectDef } from '../defs';
import { C, PI, chips, dust, embers, flashGlow, grit, ringPop, smoke, sparks, star } from './common';

export const IMPACTS: Record<string, EffectDef> = {
  /** light hit on metal: contact star, tight spark fan, two or three lingering embers */
  sparkHit: {
    emitters: [
      { p: star(C.cinderHot, 9, 0.55), burst: 1 },
      { p: flashGlow(C.cinderHot, 3, 0.7, 0.12), burst: 1 },
      { p: sparks(C.cinderHot), burst: [11, 15], vel: 'cone', cone: 1.05, speed: [2.5, 9] },
      { p: embers({ life: [0.4, 0.9], size: [0.03, 0.025, 0.008], gravity: 2, turb: 1.5 }), burst: [2, 4], vel: 'cone', cone: 1.2, speed: [0.6, 2] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.cinderHot, intensity: 1.1, seconds: 0.1 }],
  },

  /** heavy hit: bigger star, a crisp shock ring, long sparks that bounce, a breath of smoke */
  sparkHeavy: {
    emitters: [
      { p: star(C.cinderHot, 12, 1.1, 0.11), burst: 1 },
      { p: flashGlow(C.cinderHot, 4.5, 1.5, 0.16), burst: 1 },
      { p: ringPop(C.cinderHot, 5, 0.15, 1.3, 0.22), burst: 1 },
      { p: sparks(C.cinderHot, { life: [0.35, 0.95], size: [0.034, 0.026, 0.008], stretch: 0.05 }), burst: [28, 36], vel: 'cone', cone: 1.25, speed: [3.5, 14] },
      { p: sparks(C.heat, { life: [0.12, 0.25], size: [0.05, 0.03, 0.01], stretch: 0.07, gravity: 0, bounce: 0 }), burst: 8, vel: 'cone', cone: PI / 2, speed: [10, 18] },
      { p: embers({ life: [0.6, 1.3], gravity: 0.6 }), burst: [6, 9], vel: 'cone', cone: 1.3, speed: [0.8, 3] },
      { p: smoke(C.smokeWarm, { life: [0.6, 1.1], size: [0.2, 0.55, 0.8], alpha: 0.28, glow: 1.2 }), burst: 2, vel: 'cone', cone: 0.8, speed: [0.3, 0.9] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.cinderHot, intensity: 2.4, seconds: 0.14 }],
  },

  /** metal fragments spinning away with a few sparks */
  metalChip: {
    emitters: [
      { p: flashGlow(C.goldLight, 2, 0.4, 0.09), burst: 1 },
      { p: chips(C.steel, { size: [0.055, 0.055, 0.04] }), burst: [6, 8], vel: 'cone', cone: 1.0, speed: [2, 6] },
      { p: sparks(C.goldLight, { life: [0.18, 0.4] }), burst: [5, 7], vel: 'cone', cone: 0.9, speed: [3, 8] },
    ],
  },

  /** stone chips and a puff of pale dust; tint with opts.color for black stone / white-gold */
  stoneChip: {
    emitters: [
      { p: chips(C.stone), burst: [7, 10], vel: 'cone', cone: 1.0, speed: [1.6, 5.5] },
      { p: dust(C.dust, { life: [0.5, 0.9], alpha: 0.3 }), burst: 3, vel: 'cone', cone: 0.9, speed: [0.5, 1.6] },
      { p: grit(C.dust), burst: [8, 10], vel: 'cone', cone: 0.8, speed: [1, 4.5] },
    ],
  },

  /** soft dust burst along the normal */
  dustPuff: {
    emitters: [
      { p: dust(C.dust, { life: [0.8, 1.5], size: [0.25, 0.75, 1.15], alpha: 0.3 }), burst: [5, 7], vel: 'cone', cone: 1.1, speed: [0.5, 1.8] },
      { p: grit(C.dust, { gravity: 3, life: [0.5, 0.9] }), burst: [8, 10], vel: 'cone', cone: 1.0, speed: [0.6, 2.6] },
    ],
  },

  /** footfall: a low skirt of dust that hugs the floor */
  footDust: {
    emitters: [
      { p: dust(C.dust, { life: [0.45, 0.8], size: [0.12, 0.32, 0.5], alpha: 0.24 }), burst: 3, shape: 'ring', radius: 0.08, vel: 'ring', speed: [0.4, 1.1], up: [0.1, 0.35], offset: [0, 0.05, 0] },
    ],
  },
};
