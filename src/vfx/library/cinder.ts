/** Cinder (Tarrik) — orange-white heat, weight, embers that rise and cool. */
import type { EffectDef } from '../defs';
import { C, PI, chips, dust, embers, flame, flashGlow, ringPop, smoke, sparks, star } from './common';

export const CINDER: Record<string, EffectDef> = {
  /** Cinder hit accent: white-hot core, short flame lick, embers that outlive the flash */
  cinderBurst: {
    emitters: [
      { p: star(C.cinderHot, 12, 1.0, 0.1), burst: 1 },
      { p: flashGlow(C.cinder, 5, 1.6, 0.18), burst: 1 },
      { p: flame({ life: [0.2, 0.4], size: [0.2, 0.5, 0.7] }), burst: [7, 9], shape: 'sphere', radius: 0.12, vel: 'cone', cone: 1.2, speed: [1.2, 4.5] },
      { p: sparks(C.cinder), burst: [16, 20], vel: 'cone', cone: 1.3, speed: [3, 11] },
      { p: embers(), burst: [10, 14], shape: 'sphere', radius: 0.2, vel: 'cone', cone: 1.4, speed: [0.5, 2.6] },
      { p: smoke(C.smokeWarm, { life: [0.8, 1.4], size: [0.25, 0.7, 1.0], alpha: 0.26, glow: 1.6 }), burst: 2, at: 0.05, vel: 'cone', cone: 0.6, speed: [0.3, 0.8] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.cinder, intensity: 2.6, seconds: 0.2 }],
  },

  /**
   * Cinder Slam — ground strike. Impact core, fire racing outward along the floor, a low fan of sparks,
   * double shock ring, glowing fracture, debris, then embers climbing out of the scar.
   */
  cinderSlam: {
    emitters: [
      { p: flashGlow(C.cinderHot, 9, 3.4, 0.2, { floorFade: true }), burst: 1, offset: [0, 0.25, 0] },
      { p: star(C.heat, 14, 2.2, 0.12), burst: 1, offset: [0, 0.2, 0] },
      // radial ground fire
      { p: flame({ life: [0.3, 0.55], size: [0.35, 0.8, 1.05], gravity: -1.2, drag: 3.2, floorFade: true }), burst: [30, 36], shape: 'ring', radius: 0.5, vel: 'ring', speed: [7, 12.5], up: [0.2, 1.2], offset: [0, 0.2, 0] },
      // centre jet
      { p: flame({ life: [0.25, 0.5], size: [0.4, 0.9, 1.1], gravity: -4 }), burst: 8, shape: 'disc', radius: 0.4, vel: 'cone', cone: 0.35, speed: [3, 7.5], offset: [0, 0.2, 0] },
      // low spark fan + a few high flyers
      { p: sparks(C.cinder, { life: [0.35, 0.9] }), burst: [42, 50], shape: 'ring', radius: 0.4, vel: 'ring', speed: [5, 13], up: [0.8, 4.5], offset: [0, 0.1, 0] },
      { p: sparks(C.cinderHot, { life: [0.5, 1.1] }), burst: 14, vel: 'cone', cone: 0.7, speed: [5, 10], offset: [0, 0.1, 0] },
      // debris + dust skirt
      { p: chips(C.stoneDark, { life: [0.9, 1.5], size: [0.09, 0.09, 0.06] }), burst: [12, 15], shape: 'disc', radius: 1.0, vel: 'ring', speed: [1.5, 5], up: [2.5, 6.5] },
      { p: dust(C.smokeWarm, { life: [0.8, 1.4], size: [0.45, 1.1, 1.6], alpha: 0.3, glow: 0.8 }), burst: [10, 12], shape: 'ring', radius: 1.0, vel: 'ring', speed: [3, 5.5], up: [0.1, 0.5], offset: [0, 0.15, 0] },
      // embers out of the scar
      { p: embers({ life: [1.2, 2.6] }), rate: 46, at: 0.08, until: 0.75, shape: 'disc', radius: 2.4, vel: 'cone', cone: 0.5, speed: [0.4, 2.2], offset: [0, 0.05, 0] },
      { p: smoke(C.smoke, { life: [1.4, 2.2], alpha: 0.24, glow: 1.4 }), burst: 4, at: 0.12, shape: 'disc', radius: 1.2, vel: 'cone', cone: 0.5, speed: [0.4, 1.0], offset: [0, 0.3, 0] },
    ],
    events: [
      { at: 0, kind: 'flash', color: C.cinder, intensity: 6, seconds: 0.35, offset: [0, 0.6, 0] },
      { at: 0, kind: 'shock', radius: 3.2, color: C.heat, seconds: 0.26 },
      { at: 0.03, kind: 'shock', radius: 4.8, color: C.cinder, seconds: 0.5 },
      { at: 0, kind: 'decal', decal: 'scorch', size: 5.2, life: 18 },
      { at: 0, kind: 'decal', decal: 'crack', size: 4.4, life: 18 },
    ],
  },

  /** sustained ember shedding (charged blade, smouldering ground). duration via opts; default 1.4 s */
  cinderEmbers: {
    sustain: 1.4,
    emitters: [
      { p: embers({ life: [0.8, 1.8], follow: false }), rate: 22, shape: 'sphere', radius: 0.22, vel: 'cone', cone: 0.9, speed: [0.2, 1.2] },
      { p: flashGlow(C.cinder, 1.6, 0.55, 0.5, { follow: true, color: [[C.cinder, 1.6], [C.cinder, 1.2], [C.cinderDeep, 0]], fadeIn: 0.3 }), burst: 1, every: 0.4 },
    ],
  },

  /**
   * Sticky charge, armed. A hot core with a pulse that accelerates toward the end of the fuse
   * (state[0] = time until the next pulse). Pair with cinderStickyBlast when the fuse ends.
   */
  cinderStickyArm: {
    sustain: 1.6,
    emitters: [
      { p: flashGlow(C.cinder, 2.2, 0.32, 0.16, { follow: true }), burst: 0 },
      { p: ringPop(C.cinderHot, 3.5, 0.06, 0.55, 0.22, { follow: true }), burst: 0 },
      { p: sparks(C.cinderHot, { life: [0.15, 0.3], gravity: 6, bounce: 0 }), burst: 0, vel: 'cone', cone: PI, speed: [1, 3] },
      { p: { layer: 'add', sprite: 'dot', life: 0.25, size: 0.11, sizeRand: 1, color: [[C.cinderHot, 3.5], [C.cinder, 2.5]], fadeIn: 0.3, fadeOut: 0.5, follow: true }, rate: 12 },
    ],
    update(fx, dt) {
      const s = fx.state;
      s[0] -= dt;
      if (s[0] <= 0) {
        const urgency = Number.isFinite(fx.duration) ? Math.min(1, fx.age / fx.duration) : 0;
        s[0] = 0.42 - 0.35 * Math.pow(urgency, 1.4);
        fx.emit(0, 1);
        fx.emit(1, 1);
        fx.emit(2, urgency > 0.5 ? 3 : 1);
        fx.flash(C.cinder, 0.5 + urgency * 0.7, 0.09);
      }
    },
  },

  /** Sticky blast: tight fireball, fast radial sparks, lit smoke, scorch */
  cinderStickyBlast: {
    emitters: [
      { p: flashGlow(C.cinderHot, 10, 3.8, 0.18), burst: 1 },
      { p: star(C.heat, 14, 2.4, 0.1), burst: 1 },
      { p: flame({ life: [0.28, 0.55], size: [0.45, 1.05, 1.4], drag: 4.5 }), burst: [14, 17], shape: 'sphere', radius: 0.2, vel: 'radial', speed: [2.5, 7] },
      { p: sparks(C.cinder, { life: [0.4, 1.0] }), burst: [38, 46], vel: 'cone', cone: PI, speed: [5, 16] },
      { p: embers({ life: [1.0, 2.2] }), burst: [20, 26], shape: 'sphere', radius: 0.5, vel: 'radial', speed: [0.6, 3.2] },
      { p: smoke(C.smoke, { life: [1.4, 2.4], size: [0.5, 1.3, 1.9], alpha: 0.36, glow: 2.4 }), burst: [6, 8], at: 0.06, shape: 'sphere', radius: 0.4, vel: 'radial', speed: [0.5, 1.6] },
      { p: chips(C.stoneDark), burst: 8, vel: 'cone', cone: 1.2, speed: [3, 8] },
    ],
    events: [
      { at: 0, kind: 'flash', color: C.cinder, intensity: 6.5, seconds: 0.32 },
      { at: 0, kind: 'shock', radius: 3.6, color: C.cinderHot, seconds: 0.4 },
      { at: 0, kind: 'decal', decal: 'scorch', size: 3.0, life: 16 },
    ],
  },
};
