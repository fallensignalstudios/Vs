/**
 * Frost (Selene) — stillness. Things are thrown, then ARRESTED: shards hang, rings are crisp and thin, nothing
 * billows. Brightness is spent on small precise shapes so the scene never floods blue-white.
 */
import type { EffectDef, ParticleDef } from '../defs';
import { C, PI, dust, flashGlow, motes, ringPop, shards, sparks, star } from './common';

/** shards that leave fast and stop dead within half a metre, then hang and slowly turn */
const hangShards = (o: Partial<ParticleDef> = {}): ParticleDef =>
  shards(C.frost, { life: [0.9, 1.5], drag: 9, gravity: 0.15, spin: [-0.5, 0.5], flicker: 0.12, ...o });

/** tiny six-point glints that hold position and twinkle */
const glints = (o: Partial<ParticleDef> = {}): ParticleDef => ({
  layer: 'add', sprite: ['star', 'flake'], life: [0.7, 1.4], size: [0.05, 0.11, 0.04], sizeRand: [0.5, 1.5],
  color: [[C.ice, 4], [C.frost, 2.5]], fadeIn: 0.2, fadeOut: 0.5, flicker: 0.75, spin: [-0.3, 0.3], ...o,
});

export const FROST: Record<string, EffectDef> = {
  /** Frost hit accent: a clean star, one crisp ring, a handful of shards that stop and hang */
  frostBurst: {
    emitters: [
      { p: star(C.frost, 10, 0.8, 0.09), burst: 1 },
      { p: ringPop(C.frost, 5, 0.1, 1.0, 0.24), burst: 1 },
      { p: hangShards(), burst: [8, 11], vel: 'cone', cone: 1.3, speed: [4, 8.5] },
      { p: glints(), burst: [5, 7], shape: 'sphere', radius: 0.45, vel: 'none' },
      { p: dust(C.steam, { life: [0.5, 0.9], size: [0.2, 0.5, 0.7], alpha: 0.12, floorFade: false }), burst: 2, vel: 'cone', cone: 1.0, speed: [0.3, 0.8] },
    ],
    events: [{ at: 0, kind: 'flash', color: C.frostDeep, intensity: 1.2, seconds: 0.1 }],
  },

  /** A frozen thing breaks: glassy shards with real weight that clatter and skid, bright glints, ice dust */
  frostShatter: {
    emitters: [
      { p: star(C.ice, 12, 1.3, 0.1), burst: 1 },
      { p: ringPop(C.frost, 6, 0.2, 1.8, 0.26), burst: 1 },
      { p: shards(C.frost, { life: [1.1, 1.9], gravity: 9.5, drag: 0.6, bounce: 0.42, spin: 7, size: [0.2, 0.2, 0.14] }), burst: [24, 28], shape: 'sphere', radius: 0.3, vel: 'radial', speed: [2.5, 9], up: [0.5, 3] },
      { p: shards(C.frostDeep, { life: [0.6, 1.1], gravity: 9.5, drag: 1, bounce: 0.3, spin: 12, size: [0.07, 0.07, 0.04] }), burst: [16, 20], shape: 'sphere', radius: 0.3, vel: 'radial', speed: [4, 12], up: [0, 3] },
      { p: glints({ life: [0.4, 0.9] }), burst: [9, 12], shape: 'sphere', radius: 0.7, vel: 'radial', speed: [0.1, 0.6] },
      { p: dust(C.steam, { life: [0.7, 1.2], size: [0.3, 0.8, 1.1], alpha: 0.16 }), burst: 4, shape: 'sphere', radius: 0.3, vel: 'radial', speed: [0.5, 1.4] },
    ],
    events: [
      { at: 0, kind: 'flash', color: C.frost, intensity: 2.2, seconds: 0.14 },
      { at: 0.1, kind: 'decal', decal: 'frost', size: 2.2, life: 12 },
    ],
  },

  /**
   * Arrest: motes are drawn in (anticipation), then one thin ring snaps out and the shards it leaves behind
   * simply hold in the air.
   */
  frostArrest: {
    emitters: [
      { p: motes(C.frost, 3.5, { sprite: 'flake', life: [0.24, 0.3], size: [0.1, 0.07, 0.03], fadeIn: 0.3, fadeOut: 0.7 }), burst: [18, 22], shape: 'shell', radius: 1.5, vel: 'inward', speed: [4.6, 5.4] },
      { p: star(C.ice, 12, 1.2, 0.1), burst: 1, at: 0.28 },
      { p: flashGlow(C.frostDeep, 3, 1.4, 0.2, { color: [[C.ice, 3], [C.frostDeep, 1.6], [C.frostDeep, 0]] }), burst: 1, at: 0.28 },
      { p: hangShards({ life: [1.1, 1.6], drag: 14 }), burst: [12, 15], at: 0.28, shape: 'shell', radius: 0.55, vel: 'radial', speed: [1.5, 3.5] },
      { p: glints({ life: [1.0, 1.5] }), burst: [8, 10], at: 0.3, shape: 'shell', radius: 0.9, vel: 'none' },
    ],
    events: [
      { at: 0.28, kind: 'shape', shape: { kind: 'halo', life: 0.5, color: [C.ice, 4.5], color2: [C.frost, 2], radius: [0.25, 1.6], attack: 0.03, detail: 36 } },
      { at: 0.28, kind: 'shock', radius: 2.3, color: C.frost, seconds: 0.4 },
      { at: 0.28, kind: 'flash', color: C.frostDeep, intensity: 2.2, seconds: 0.16 },
      { at: 0.32, kind: 'decal', decal: 'frost', size: 2.0, life: 10 },
    ],
  },

  /**
   * Stasis field — a HELD dome: thin fresnel shell with a frozen lattice, motes that appear and do not move.
   * Sustained; default 4 s. Scale 1 = 3.5 m radius.
   */
  stasisField: {
    sustain: 4,
    emitters: [
      { p: star(C.ice, 9, 1.4, 0.1), burst: 1, offset: [0, 0.4, 0] },
      { p: glints({ life: [1.4, 2.4], size: [0.05, 0.09, 0.04], flicker: 0.6, spin: 0 }), rate: 13, shape: 'sphere', radius: 3.1, vel: 'none', offset: [0, 0.4, 0] },
      { p: motes(C.frost, 2.2, { life: [1.6, 2.6], size: [0.025, 0.035, 0.02] }), rate: 16, shape: 'sphere', radius: 3.2, vel: 'none', offset: [0, 0.3, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'dome', life: 0.5, sustain: true, color: [C.frostDeep, 1.5], color2: [C.ice, 1.3], radius: [0.4, 3.5], attack: 0.32, detail: 15 } },
      { at: 0, kind: 'shock', radius: 3.6, color: C.frost, seconds: 0.36 },
      { at: 0, kind: 'flash', color: C.frostDeep, intensity: 2, seconds: 0.2, offset: [0, 1, 0] },
      { at: 0.05, kind: 'decal', decal: 'frost', size: 6.6, life: 7 },
    ],
  },

  /**
   * Dispatch blink-strike. pos = start, dir = travel direction, scale = distance / 4 m.
   * A lance of pale speed-lines that is gone almost at once, leaving glints hanging along the path.
   */
  dispatchStreak: {
    emitters: [
      { p: sparks(C.frost, { life: [0.14, 0.26], size: [0.04, 0.03, 0.006], aspect: 6, stretch: 0.03, gravity: 0, bounce: 0, drag: 7, color: [[C.ice, 7], [C.frost, 4], [C.frostDeep, 0.5]] }), burst: [22, 26], shape: 'line', height: 4, radius: 0, vel: 'cone', cone: 0.03, speed: [22, 46] },
      { p: flashGlow(C.frost, 3, 0.9, 0.16, { color: [[C.ice, 3], [C.frost, 1.5], [C.frostDeep, 0]] }), burst: 1 },
      { p: star(C.ice, 11, 1.1, 0.1), burst: 1, at: 0.05, offset: [0, 4, 0] },
      { p: ringPop(C.frost, 5, 0.1, 1.1, 0.22), burst: 1, at: 0.05, offset: [0, 4, 0] },
      { p: glints({ life: [0.5, 0.9] }), burst: [10, 12], at: 0.03, shape: 'line', height: 4, vel: 'none' },
      { p: hangShards({ life: [0.6, 1.0], size: [0.1, 0.1, 0.06] }), burst: 6, at: 0.05, vel: 'cone', cone: PI / 2, speed: [2, 5], offset: [0, 4, 0] },
    ],
    events: [{ at: 0.05, kind: 'flash', color: C.frostDeep, intensity: 1.6, seconds: 0.12, offset: [0, 4, 0] }],
  },
};
