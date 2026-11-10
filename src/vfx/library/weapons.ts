/** Weapons, drones, shields. Muzzle effects: effect axis (+Y) = firing direction. Shield effects: axis = shield normal. */
import type { EffectDef } from '../defs';
import { C, PI, flame, flashGlow, motes, ringPop, shards, smoke, sparks, star } from './common';

export const WEAPONS: Record<string, EffectDef> = {
  /** Cinderline: a fat warm bark — forward flame tongue, side flare, sparks, a curl of smoke */
  muzzleWarm: {
    emitters: [
      { p: star(C.cinderHot, 12, 0.7, 0.06), burst: 1 },
      { p: flashGlow(C.cinder, 4, 0.9, 0.09), burst: 1 },
      { p: flame({ life: [0.07, 0.13], size: [0.12, 0.32, 0.4], drag: 14, gravity: 0 }), burst: [4, 5], vel: 'cone', cone: 0.16, speed: [7, 15] },
      { p: { layer: 'add', sprite: 'flare', life: 0.07, size: [0.5, 0.9, 1.0], sizeRand: 1, color: [[C.heat, 8], [C.cinder, 3]], fadeOut: 0.3, rot: 0, tint: 0.4 }, burst: 1 },
      { p: sparks(C.cinderHot, { life: [0.12, 0.3], bounce: 0 }), burst: [5, 7], vel: 'cone', cone: 0.32, speed: [6, 16] },
      { p: smoke(C.smoke, { life: [0.5, 0.9], size: [0.1, 0.35, 0.55], alpha: 0.2, floorFade: false }), burst: 2, at: 0.04, vel: 'cone', cone: 0.3, speed: [0.6, 1.6] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.cinderHot, intensity: 1.5, seconds: 0.07 }],
  },

  /** Axiom: precise and cold — a needle of light, one thin ring, no smoke */
  muzzleCold: {
    emitters: [
      { p: star(C.ice, 11, 0.55, 0.05), burst: 1 },
      { p: ringPop(C.frost, 5, 0.04, 0.42, 0.13, { facing: 'camera' }), burst: 1 },
      { p: sparks(C.frost, { life: [0.05, 0.09], size: [0.035, 0.025, 0.006], aspect: 5, stretch: 0.02, gravity: 0, bounce: 0, drag: 10, color: [[C.ice, 8], [C.frost, 4], [C.frostDeep, 0.5]] }), burst: 3, vel: 'cone', cone: 0.02, speed: [26, 40] },
      { p: motes(C.ice, 4, { sprite: 'star', life: [0.12, 0.25], size: [0.05, 0.08, 0.03] }), burst: 4, shape: 'sphere', radius: 0.12, vel: 'cone', cone: 0.6, speed: [0.5, 2] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.frostDeep, intensity: 1.0, seconds: 0.05 }],
  },

  /**
   * Drone charge — the 0.8 s tell before a volley (duration via opts). Motes fall inward to a core that
   * swells; tint with opts.color for contaminated drones. Attach to the muzzle.
   */
  droneCharge: {
    sustain: 0.8,
    emitters: [
      { p: motes(C.refBlue, 4, { life: [0.22, 0.28], size: [0.05, 0.035, 0.015], fadeIn: 0.25, fadeOut: 0.75, follow: true }), rate: 36, shape: 'shell', radius: 0.42, vel: 'inward', speed: [1.5, 1.8] },
      { p: { layer: 'add', sprite: 'glow', life: 0.8, size: [0.05, 0.3, 0.6], sizeMid: 0.6, sizeRand: 1, color: [[C.refBlue, 2], [C.refBlue, 4], [C.white, 7]], colorMid: 0.6, fadeIn: 0.1, fadeOut: 0.92, follow: true, rot: 0 }, burst: 1 },
      { p: { layer: 'add', sprite: 'star', life: 0.8, size: [0.05, 0.35, 0.8], sizeMid: 0.6, sizeRand: 1, color: [[C.refBlue, 2], [C.ice, 5], [C.white, 9]], colorMid: 0.6, fadeIn: 0.2, fadeOut: 0.94, follow: true, rot: 0, spin: [2.5, 2.5], tint: 0.6 }, burst: 1 },
    ],
  },

  /** drone bolt impact: small cold splash */
  droneBoltHit: {
    emitters: [
      { p: star(C.refBlue, 9, 0.55, 0.07), burst: 1 },
      { p: flashGlow(C.refBlue, 3, 0.7, 0.12, { color: [[C.ice, 3], [C.refBlue, 2], [C.refBlue, 0]] }), burst: 1 },
      { p: ringPop(C.refBlue, 4, 0.05, 0.6, 0.18), burst: 1 },
      { p: sparks(C.refBlue, { life: [0.15, 0.4], gravity: 5, color: [[C.ice, 6], [C.refBlue, 4], [C.refBlue, 0.4]] }), burst: [8, 10], vel: 'cone', cone: 1.15, speed: [2.5, 8] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.refBlue, intensity: 0.9, seconds: 0.08 }],
  },

  /** Shield holds: hex cells light as the impact ripple passes; a few sparks skitter off toward the attacker */
  shieldHit: {
    emitters: [
      { p: star(C.goldLight, 8, 0.5, 0.07), burst: 1, offset: [0, 0.03, 0] },
      { p: sparks(C.amber, { life: [0.18, 0.4] }), burst: [6, 8], vel: 'cone', cone: 1.0, speed: [2.5, 7] },
      { p: { layer: 'add', sprite: 'hex', life: [0.25, 0.4], size: [0.1, 0.16, 0.12], color: [[C.goldLight, 4], [C.amber, 2.5], [C.amber, 0]], fadeOut: 0.4, drag: 4, spin: 2 }, burst: 4, shape: 'disc', radius: 0.25, vel: 'ring', speed: [1, 2.6], offset: [0, 0.04, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'hexRipple', life: 0.45, color: [C.amber, 3], color2: [C.heat, 4], radius: [0.85, 0.95], attack: 0.02, detail: 5.5, offset: [0, 0.02, 0] } },
      { at: 0, kind: 'flash', color: C.amber, intensity: 0.9, seconds: 0.1 },
    ],
  },

  /** Shield breaks: the lattice flashes whole, then its cells fly apart as glowing hex shards */
  shieldBreak: {
    emitters: [
      { p: star(C.white, 14, 1.6, 0.1), burst: 1 },
      { p: flashGlow(C.amber, 6, 2.4, 0.18), burst: 1 },
      { p: shards(C.amber, { sprite: 'hex', life: [0.7, 1.3], size: [0.17, 0.17, 0.1], color: [[C.heat, 5], [C.amber, 3], [C.amber, 1.2]], gravity: 7, drag: 1.2, bounce: 0.35, spin: 6 }), burst: [24, 28], shape: 'disc', radius: 0.8, vel: 'ring', speed: [1.5, 6], up: [0.5, 5] },
      { p: sparks(C.amber, { life: [0.3, 0.8] }), burst: [26, 30], vel: 'cone', cone: 1.4, speed: [4, 13] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'hexRipple', life: 0.38, color: [C.amber, 5], color2: [C.white, 6], radius: [1.2, 1.7], attack: 0.02, detail: 5.5, offset: [0, 0.02, 0] } },
      { at: 0.02, kind: 'shape', shape: { kind: 'halo', life: 0.4, color: [C.goldLight, 4], radius: [0.3, 2.3], attack: 0.03, detail: 24 } },
      { at: 0, kind: 'flash', color: C.amber, intensity: 4, seconds: 0.22 },
    ],
  },

  /** Perfect guard / deflect: a white cross-flare and crescent — the cleanest, sharpest flash in the game */
  deflect: {
    emitters: [
      { p: star(C.white, 16, 1.3, 0.1, { tint: 0 }), burst: 1 },
      { p: { layer: 'add', sprite: 'flare', life: 0.12, size: [0.8, 2.0, 2.4], sizeRand: 1, aspect: 0.6, color: [[C.white, 9], [C.frost, 3]], fadeIn: 0.02, fadeOut: 0.3, rot: [-0.5, 0.5] }, burst: 1 },
      { p: { layer: 'add', sprite: 'arc', life: 0.16, size: [0.5, 1.3, 1.5], sizeRand: 1, color: [[C.white, 7], [C.frost, 3], [C.frost, 0]], fadeIn: 0.02, fadeOut: 0.3, rot: [0, PI * 2] }, burst: 1 },
      { p: ringPop(C.ice, 5, 0.1, 0.9, 0.18), burst: 1 },
      { p: sparks(C.goldLight, { life: [0.2, 0.5], color: [[C.white, 8], [C.goldLight, 4.5], [C.cinderHot, 0.6]] }), burst: [14, 18], vel: 'cone', cone: 1.25, speed: [4, 12] },
    ],
    events: [{ at: 0, kind: 'flash', color: 0xf4f8ff, intensity: 2.6, seconds: 0.09 }],
  },
};
