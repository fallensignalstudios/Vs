/** Pickups and quiet feedback — small, elegant, never louder than combat. */
import type { EffectDef } from '../defs';
import { C, flashGlow, motes, ringPop, star } from './common';

export const FEEDBACK: Record<string, EffectDef> = {
  /** idle marker on a sustain drop: a breathing floor ring and slow rising crosses. Sustained until stop(). */
  healPickup: {
    sustain: Infinity,
    emitters: [
      { p: motes(C.heal, 3, { sprite: 'spark', life: [1.1, 1.8], size: [0.07, 0.12, 0.05], gravity: -0.5, rot: 0, flicker: 0.25 }), rate: 5, shape: 'disc', radius: 0.3, vel: 'cone', cone: 0.2, speed: [0.15, 0.35], offset: [0, 0.2, 0] },
      { p: ringPop(C.heal, 2.4, 0.3, 1.0, 1.4, { facing: 'ground', color: [[C.heal, 2.4], [C.heal, 1.4], [C.heal, 0]], fadeIn: 0.25 }), burst: 1, every: 1.1, offset: [0, 0.04, 0] },
      { p: flashGlow(C.heal, 1.3, 0.7, 1.1, { color: [[C.heal, 1.3], [C.heal, 1.0], [C.heal, 0]], fadeIn: 0.4, fadeOut: 0.5, floorFade: true }), burst: 1, every: 1.1, offset: [0, 0.3, 0] },
    ],
  },

  /** heal applied: a spiral of motes climbing the body, one floor ring */
  healBurst: {
    emitters: [
      { p: motes(C.heal, 3.6, { sprite: 'spark', life: [0.8, 1.3], size: [0.08, 0.13, 0.04], gravity: -1.6, drag: 0.6, orbit: 4.5, rot: 0 }), burst: [18, 22], shape: 'ring', radius: 0.5, vel: 'none', up: [0.4, 1.4], offset: [0, 0.1, 0] },
      { p: motes(C.white, 3, { life: [0.5, 0.9], gravity: -2.2, orbit: 6 }), burst: [14, 16], shape: 'ring', radius: 0.42, vel: 'none', up: [0.6, 1.8], offset: [0, 0.1, 0] },
      { p: ringPop(C.heal, 4, 0.3, 2.2, 0.5, { facing: 'ground' }), burst: 1, offset: [0, 0.05, 0] },
      { p: flashGlow(C.heal, 2.4, 1.8, 0.4, { color: [[C.white, 2.4], [C.heal, 1.6], [C.heal, 0]], floorFade: true }), burst: 1, offset: [0, 0.9, 0] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.heal, intensity: 1.0, seconds: 0.35, offset: [0, 1, 0] }],
  },

  /** Echo gained: motes fall into the body, a ring closes. Tint with the protagonist's colour. */
  echoGain: {
    emitters: [
      { p: motes(C.goldLight, 4, { life: [0.3, 0.38], size: [0.06, 0.045, 0.02], fadeIn: 0.2, fadeOut: 0.75 }), burst: [12, 14], shape: 'shell', radius: 0.9, vel: 'inward', speed: [2.3, 2.7] },
      { p: ringPop(C.goldLight, 3.5, 1.4, 0.2, 0.34, { size: [1.4, 0.5, 0.15], color: [[C.goldLight, 0.5], [C.goldLight, 3.5], [C.white, 5]], fadeOut: 0.8 }), burst: 1 },
      { p: star(C.goldLight, 6, 0.4, 0.1), burst: 1, at: 0.32 },
    ],
  },

  /** Checkpoint: King-era gold acknowledges the route — column, floor mark, rising motes */
  checkpointPulse: {
    emitters: [
      { p: motes(C.gold, 3.2, { sprite: ['diamond', 'dot'], life: [1.2, 2.2], size: [0.05, 0.07, 0.03], gravity: -0.7, drag: 0.4, flicker: 0.3 }), rate: 30, until: 0.9, shape: 'disc', radius: 1.3, vel: 'cone', cone: 0.1, speed: [0.3, 1.0], offset: [0, 0.05, 0] },
      { p: flashGlow(C.gold, 1.6, 2.0, 0.9, { color: [[C.goldLight, 2.2], [C.gold, 1.4], [C.gold, 0]], fadeIn: 0.2, fadeOut: 0.4, floorFade: true }), burst: 1, offset: [0, 0.5, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'column', life: 1.6, color: [C.gold, 0.6], color2: [C.goldLight, 1.1], radius: [0.3, 0.5], height: 5.5, attack: 0.25 } },
      { at: 0, kind: 'shock', radius: 3, color: C.gold, seconds: 0.9 },
      { at: 0, kind: 'decal', decal: 'goldRing', size: 3.2, life: 4.5 },
      { at: 0, kind: 'flash', color: C.gold, intensity: 1.6, seconds: 0.8, offset: [0, 1.2, 0] },
    ],
  },

  /** interaction acknowledged: two thin rings and a glint */
  interactPing: {
    emitters: [
      { p: ringPop(C.goldLight, 3.6, 0.06, 0.6, 0.36), burst: 1 },
      { p: ringPop(C.goldLight, 2.4, 0.06, 0.9, 0.46), burst: 1, at: 0.1 },
      { p: { layer: 'add', sprite: 'diamond', life: 0.4, size: [0.05, 0.18, 0.1], sizeRand: 1, color: [[C.white, 5], [C.goldLight, 3], [C.goldLight, 0]], fadeOut: 0.4, rot: 0 }, burst: 1 },
    ],
  },
};
