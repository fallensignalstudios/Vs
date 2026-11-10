/**
 * Story hero moments. These are staged: each has an anticipation, a peak and a readable aftermath.
 * Ancient gold light = recognition; white = resolution; frost holds, cinder releases.
 */
import type { EffectDef, ParticleDef } from '../defs';
import { C, PI, chips, dust, embers, flame, flashGlow, motes, ringPop, shards, smoke, sparks, star } from './common';

const glyphs = (o: Partial<ParticleDef> = {}): ParticleDef => ({
  layer: 'add', sprite: ['glyph0', 'glyph1', 'glyph2', 'glyph3'], life: [1.0, 1.6], size: [0.1, 0.13, 0.1], sizeRand: [0.8, 1.2],
  color: [[C.goldLight, 3.4], [C.gold, 2.6], [C.gold, 0]], fadeIn: 0.12, fadeOut: 0.6, rot: 0, ...o,
});

const frostGlints = (o: Partial<ParticleDef> = {}): ParticleDef => ({
  layer: 'add', sprite: ['star', 'flake'], life: [0.9, 1.5], size: [0.06, 0.13, 0.05], sizeRand: [0.5, 1.5],
  color: [[C.ice, 4.5], [C.frost, 2.6]], fadeIn: 0.2, fadeOut: 0.55, flicker: 0.7, ...o,
});

/** thermalFracture timing (seconds): arrest → held beat → cinder strike */
const T_ARREST = 0.5;
const T_STRIKE = 0.98;

export const STORY: Record<string, EffectDef> = {
  /**
   * THERMAL FRACTURE — the one Resonance. pos = the regenerating joint.
   *  0.00  frost is drawn in; a pale ring closes on the joint
   *  0.50  ARREST: white star, lattice shell, shards hang — a held, silent beat
   *  0.98  CINDER: white-hot core, radial sparks, fire, double shock ring, glowing fracture
   *  1.00+ the frozen shell leaves as glassy shards; steam and embers climb
   */
  thermalFracture: {
    emitters: [
      // --- frost anticipation
      { p: motes(C.frost, 4, { sprite: 'flake', life: [0.4, 0.48], size: [0.13, 0.09, 0.03], fadeIn: 0.25, fadeOut: 0.8 }), rate: 110, until: 0.36, shape: 'shell', radius: 2.4, vel: 'inward', speed: [4.6, 5.4] },
      // --- arrest
      { p: star(C.ice, 14, 2.0, 0.12), burst: 1, at: T_ARREST },
      { p: flashGlow(C.frostDeep, 4, 2.6, 0.26, { color: [[C.ice, 4], [C.frostDeep, 2], [C.frostDeep, 0]] }), burst: 1, at: T_ARREST },
      { p: shards(C.frost, { life: [0.46, 0.5], drag: 16, spin: [-0.4, 0.4], size: [0.24, 0.24, 0.24], fadeOut: 0.96, flicker: 0.15 }), burst: [26, 30], at: T_ARREST, shape: 'shell', radius: 0.75, vel: 'radial', speed: [1, 2.4] },
      { p: frostGlints({ life: [0.42, 0.5] }), burst: [14, 16], at: T_ARREST + 0.02, shape: 'shell', radius: 1.2, vel: 'none' },
      // --- cinder strike
      { p: flashGlow(C.heat, 13, 6.5, 0.2), burst: 1, at: T_STRIKE },
      { p: star(C.white, 18, 4.2, 0.12), burst: 1, at: T_STRIKE },
      { p: { layer: 'add', sprite: 'flare', life: 0.16, size: [2, 6, 7], sizeRand: 1, aspect: 0.5, color: [[C.white, 10], [C.cinderHot, 4]], fadeIn: 0.02, fadeOut: 0.3, rot: 0, tint: 0 }, burst: 1, at: T_STRIKE },
      { p: sparks(C.cinder, { life: [0.45, 1.2], size: [0.04, 0.03, 0.01], stretch: 0.05 }), burst: [80, 92], at: T_STRIKE, vel: 'cone', cone: PI, speed: [7, 24] },
      { p: flame({ life: [0.3, 0.6], size: [0.6, 1.4, 1.9], drag: 4.5 }), burst: [18, 22], at: T_STRIKE, shape: 'sphere', radius: 0.3, vel: 'radial', speed: [3, 9] },
      // --- the shell leaves as glass
      { p: shards(C.frost, { life: [1.2, 2.0], gravity: 9.5, drag: 0.5, bounce: 0.42, spin: 8, size: [0.26, 0.26, 0.18], color: [[C.heat, 3.2], [C.frost, 1.8], [C.frost, 1.0]] }), burst: [44, 50], at: T_STRIKE + 0.02, shape: 'shell', radius: 0.8, vel: 'radial', speed: [5, 15], up: [0, 3] },
      { p: shards(C.frostDeep, { life: [0.7, 1.3], gravity: 9.5, drag: 0.8, bounce: 0.3, spin: 13, size: [0.08, 0.08, 0.05] }), burst: [26, 30], at: T_STRIKE + 0.02, shape: 'shell', radius: 0.8, vel: 'radial', speed: [6, 18] },
      { p: chips(C.stoneDark, { life: [1.2, 1.9], size: [0.12, 0.12, 0.08] }), burst: [12, 14], at: T_STRIKE + 0.02, vel: 'cone', cone: PI, speed: [4, 11] },
      // --- aftermath: steam (frost meeting fire), embers
      { p: smoke(C.steam, { life: [1.4, 2.4], size: [0.6, 1.7, 2.6], alpha: 0.26, glow: 1.6, gravity: -1.1 }), burst: [9, 11], at: T_STRIKE + 0.08, shape: 'sphere', radius: 0.7, vel: 'cone', cone: 1.0, speed: [0.8, 2.4] },
      { p: embers({ life: [1.2, 2.6] }), rate: 44, at: T_STRIKE + 0.05, until: T_STRIKE + 0.85, shape: 'sphere', radius: 1.3, vel: 'radial', speed: [0.5, 3] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'halo', life: 0.5, color: [C.frost, 3], color2: [C.ice, 2], radius: [3.0, 0.9], attack: 0.1, detail: 36 } },
      { at: 0.05, kind: 'flash', color: C.frostDeep, intensity: 1.6, seconds: 0.45 },
      { at: T_ARREST, kind: 'shape', shape: { kind: 'sphere', life: T_STRIKE - T_ARREST + 0.05, color: [C.frostDeep, 2.2], color2: [C.ice, 2.4], radius: [0.6, 1.0], attack: 0.04, detail: 9 } },
      { at: T_ARREST, kind: 'shock', radius: 3.2, color: C.frost, seconds: 0.4 },
      { at: T_ARREST, kind: 'flash', color: C.frost, intensity: 4, seconds: 0.3 },
      { at: T_STRIKE, kind: 'flash', color: C.cinderHot, intensity: 10, seconds: 0.45 },
      { at: T_STRIKE, kind: 'shock', radius: 4.2, color: C.heat, seconds: 0.28 },
      { at: T_STRIKE + 0.03, kind: 'shock', radius: 6.8, color: C.cinder, seconds: 0.55 },
      { at: T_STRIKE, kind: 'shape', shape: { kind: 'halo', life: 0.45, color: [C.cinderHot, 5], color2: [C.heat, 3], radius: [0.6, 4.2], attack: 0.02, detail: 30 } },
      { at: T_STRIKE, kind: 'decal', decal: 'crack', size: 5.2, life: 20 },
      { at: T_STRIKE, kind: 'decal', decal: 'scorch', size: 4.2, life: 20 },
      { at: T_STRIKE + 0.1, kind: 'decal', decal: 'frost', size: 6.4, life: 9 },
    ],
  },

  /**
   * Resonance window. A cinder ring closes linearly onto a steady frost ring and meets it exactly at the end
   * of the effect's duration (default 1.2 s) — confirm when they touch.
   */
  resonanceRing: {
    sustain: 1.2,
    emitters: [
      { p: frostGlints({ life: [0.5, 0.9], size: [0.04, 0.08, 0.03] }), rate: 12, shape: 'shell', radius: 0.8, vel: 'none' },
      { p: embers({ life: [0.5, 0.9], gravity: -0.6, orbit: 2.4, turb: 0.6 }), rate: 16, shape: 'ring', radius: 1.5, vel: 'inward', speed: [0.6, 1.0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'halo', life: 0.18, sustain: true, color: [C.ice, 3.2], color2: [C.frost, 2], radius: [0.6, 0.8], attack: 0.12, detail: 24 } },
      { at: 0, kind: 'shape', shape: { kind: 'halo', life: 1.2, fit: true, color: [C.cinderHot, 3.4], color2: [C.heat, 2], radius: [2.4, 0.8], attack: 0.1, detail: 12 } },
    ],
  },

  /**
   * Quarantine seal. pos = centre of the threshold on the floor, dir = barrier normal.
   * Scale 1 = 8 m wide × 4.5 m tall. Light rises behind a hot edge and holds. Sustained, default 2.6 s.
   */
  quarantineSeal: {
    sustain: 2.6,
    upright: true,
    emitters: [
      { p: motes(C.goldLight, 3.4, { sprite: ['diamond', 'dot'], life: [0.9, 1.6], size: [0.05, 0.07, 0.03], gravity: -1.6, drag: 0.5 }), rate: 60, until: 0.9, shape: 'box', radius: 4, height: 0.05, depth: 0.05, vel: 'none', up: [0.6, 2.2] },
      { p: sparks(C.goldLight, { life: [0.2, 0.45], gravity: 5, bounce: 0.2 }), rate: 50, until: 0.6, shape: 'box', radius: 4, height: 0.02, depth: 0.02, vel: 'cone', cone: 0.9, speed: [1, 4] },
      { p: dust(C.stone, { life: [0.7, 1.2], alpha: 0.16 }), burst: 8, shape: 'box', radius: 4, height: 0.05, depth: 0.1, vel: 'cone', cone: 1.2, speed: [0.3, 1.0], offset: [0, 0.1, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'wall', life: 0.6, sustain: true, color: [C.goldLight, 1.5], color2: [C.white, 3.4], radius: [4, 4], height: 4.5, attack: 0.7, detail: 1.0 } },
      { at: 0, kind: 'flash', color: C.goldLight, intensity: 3, seconds: 0.8, offset: [0, 1.5, 0.6] },
      { at: 0.7, kind: 'flash', color: C.white, intensity: 2.5, seconds: 0.4, offset: [0, 3.5, 0.6] },
    ],
  },

  /** King-era recognition: a thin vertical seam of gold, a floor mark, ordered glyphs rising in files */
  goldRecognition: {
    emitters: [
      { p: glyphs({ gravity: 0, facing: 'upright' }), rate: 22, until: 1.2, shape: 'ring', radius: 0.9, spokes: 8, vel: 'none', up: [0.55, 0.6], offset: [0, 0.1, 0] },
      { p: motes(C.goldLight, 3, { sprite: 'diamond', life: [0.9, 1.5], size: [0.04, 0.06, 0.03] }), rate: 16, until: 1.2, shape: 'disc', radius: 1.1, vel: 'none', up: [0.2, 0.5], offset: [0, 0.1, 0] },
      { p: flashGlow(C.gold, 2.4, 2.0, 1.0, { color: [[C.goldLight, 2.4], [C.gold, 1.5], [C.gold, 0]], fadeIn: 0.25, fadeOut: 0.4, floorFade: true }), burst: 1, offset: [0, 0.6, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'column', life: 2.0, color: [C.gold, 2.2], color2: [C.goldLight, 3], radius: [0.05, 0.14], height: 7, attack: 0.2 } },
      { at: 0, kind: 'shape', shape: { kind: 'halo', life: 1.4, color: [C.goldLight, 2.2], color2: [C.gold, 2], radius: [0.3, 1.5], attack: 0.15, detail: 48, offset: [0, 1.2, 0] } },
      { at: 0, kind: 'decal', decal: 'goldRing', size: 2.6, life: 5 },
      { at: 0, kind: 'flash', color: C.gold, intensity: 1.6, seconds: 1.0, offset: [0, 1.2, 0] },
    ],
  },

  /** Tarrik's assent — WARM and weighty: a slow swell of heat from the floor, embers lifting, round shapes */
  assentTarrik: {
    emitters: [
      { p: flashGlow(C.cinder, 3.2, 2.8, 1.5, { color: [[C.cinderHot, 3.2], [C.cinder, 2.2], [C.cinderDeep, 0]], fadeIn: 0.3, fadeOut: 0.45, floorFade: true }), burst: 1, offset: [0, 0.7, 0] },
      { p: embers({ life: [1.6, 2.8], gravity: -0.9, turb: 1.4, size: [0.06, 0.05, 0.015] }), rate: 26, until: 1.5, shape: 'disc', radius: 0.9, vel: 'cone', cone: 0.2, speed: [0.3, 1.0], offset: [0, 0.05, 0] },
      { p: flame({ life: [0.5, 0.9], size: [0.3, 0.7, 0.9], gravity: -1.6, drag: 2.5, alpha: 0.5, floorFade: true }), rate: 10, until: 0.9, shape: 'ring', radius: 0.7, vel: 'none', up: [0.3, 0.8], offset: [0, 0.15, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'column', life: 1.9, color: [C.cinder, 1.3], color2: [C.cinderHot, 2.4], radius: [0.5, 0.75], height: 3.2, attack: 0.5 } },
      { at: 0, kind: 'shock', radius: 3.2, color: C.cinder, seconds: 1.3 },
      { at: 0, kind: 'flash', color: C.cinder, intensity: 3, seconds: 1.3, offset: [0, 1.1, 0] },
    ],
  },

  /** Selene's assent — COOL and exact: one thin ring snaps out and holds; glints stand in a perfect circle */
  assentSelene: {
    emitters: [
      { p: star(C.ice, 11, 1.0, 0.1), burst: 1, offset: [0, 1.1, 0] },
      { p: frostGlints({ life: [1.5, 1.8], size: [0.07, 0.13, 0.05], spin: 0, rot: 0 }), burst: 16, shape: 'ring', radius: 1.2, spokes: 16, vel: 'none', offset: [0, 1.1, 0], at: 0.08 },
      { p: frostGlints({ life: [1.2, 1.6], size: [0.04, 0.07, 0.03], flicker: 0.4 }), burst: 12, shape: 'ring', radius: 0.7, spokes: 12, vel: 'none', offset: [0, 0.05, 0], at: 0.14 },
      { p: ringPop(C.frost, 3.2, 0.3, 2.6, 0.4, { facing: 'ground' }), burst: 1, offset: [0, 0.05, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'halo', life: 1.7, color: [C.ice, 3.4], color2: [C.frost, 2.2], radius: [0.15, 1.2], attack: 0.03, detail: 16, offset: [0, 1.1, 0] } },
      { at: 0, kind: 'shape', shape: { kind: 'column', life: 1.7, color: [C.frostDeep, 1.6], color2: [C.ice, 2.4], radius: [0.03, 0.05], height: 3.6, attack: 0.05 } },
      { at: 0, kind: 'shock', radius: 2.7, color: C.frost, seconds: 0.36 },
      { at: 0, kind: 'flash', color: C.frostDeep, intensity: 2.6, seconds: 0.28, offset: [0, 1.1, 0] },
    ],
  },

  /**
   * Meridian complete (4/5 → 5/5). Gold currents spiral in along the floor for 1.8 s, meet, and resolve to
   * white: column, ring, slow drifting motes. Scale 1 = 6 m gathering radius.
   */
  meridianComplete: {
    emitters: [
      { p: sparks(C.gold, { life: [1.3, 1.5], size: [0.05, 0.045, 0.02], aspect: 4, stretch: 0.16, gravity: 0, bounce: 0, drag: 0, attract: 1.5, orbit: 1.5, color: [[C.gold, 2.5], [C.goldLight, 4.5], [C.white, 6]], colorMid: 0.6, fadeIn: 0.15, fadeOut: 0.9 }), rate: 110, until: 1.5, shape: 'ring', radius: 6, spokes: 5, vel: 'inward', speed: [0.4, 0.8], offset: [0, 0.12, 0] },
      { p: glyphs({ life: [1.2, 1.5], attract: 1.3, orbit: 1.5, facing: 'ground' }), rate: 22, until: 1.4, shape: 'ring', radius: 5.2, vel: 'inward', speed: [0.4, 0.6], offset: [0, 0.06, 0] },
      // resolve
      { p: flashGlow(C.white, 10, 8, 0.6, { color: [[C.white, 10], [C.goldLight, 4], [C.goldLight, 0]], fadeOut: 0.3, floorFade: true }), burst: 1, at: 1.85, offset: [0, 1.2, 0] },
      { p: star(C.white, 16, 4.5, 0.2, { tint: 0 }), burst: 1, at: 1.85, offset: [0, 1.2, 0] },
      { p: motes(C.white, 4, { sprite: ['diamond', 'dot', 'star'], life: [1.6, 2.8], size: [0.05, 0.08, 0.03], drag: 2.2, gravity: -0.15, flicker: 0.4, color: [[C.white, 4], [C.goldLight, 3], [C.gold, 0]] }), burst: [70, 80], at: 1.85, shape: 'sphere', radius: 0.4, vel: 'radial', speed: [2, 9], offset: [0, 1.2, 0] },
      { p: motes(C.goldLight, 3, { sprite: 'diamond', life: [1.4, 2.4], gravity: -0.5, flicker: 0.3 }), rate: 34, at: 1.9, until: 3.0, shape: 'disc', radius: 3.5, vel: 'none', up: [0.2, 0.7], offset: [0, 0.1, 0] },
    ],
    events: [
      { at: 0, kind: 'decal', decal: 'goldRing', size: 12, life: 5.5 },
      { at: 0, kind: 'flash', color: C.gold, intensity: 2, seconds: 1.8, offset: [0, 1.5, 0] },
      { at: 1.85, kind: 'shape', shape: { kind: 'column', life: 2.4, color: [C.goldLight, 2.4], color2: [C.white, 4], radius: [0.4, 1.0], height: 16, attack: 0.12 } },
      { at: 1.85, kind: 'shape', shape: { kind: 'halo', life: 1.2, color: [C.white, 4], color2: [C.goldLight, 2.5], radius: [0.8, 9], attack: 0.05, detail: 60, offset: [0, 1.2, 0] } },
      { at: 1.85, kind: 'shock', radius: 10, color: C.goldLight, seconds: 1.2 },
      { at: 1.85, kind: 'flash', color: C.white, intensity: 9, seconds: 0.9, offset: [0, 1.6, 0] },
    ],
  },

  /**
   * Boundary close. pos = centre of the aperture, dir = toward the viewer, scale 1 = 6 m radius.
   * The iris closes to a seam, the seam thins to nothing; violet motes in front of it are cut off.
   */
  boundaryClose: {
    emitters: [
      { p: motes(C.violetLight, 2.6, { life: [0.8, 1.6], size: [0.06, 0.05, 0.02], attract: 0.9, turb: 1.5, turbFreq: 0.7, unison: true }), rate: 26, until: 1.5, shape: 'disc', radius: 5, vel: 'none', offset: [0, 0.3, 0] },
      { p: { layer: 'add', sprite: 'flare', life: 0.5, size: [4, 11, 13], sizeRand: 1, aspect: 0.35, color: [[C.white, 8], [C.goldLight, 3], [C.goldLight, 0]], fadeIn: 0.1, fadeOut: 0.3, rot: 0, tint: 0 }, burst: 1, at: 2.05, offset: [0, 0.1, 0] },
      { p: motes(C.goldLight, 3.5, { sprite: 'diamond', life: [0.8, 1.6], drag: 2 }), burst: [26, 30], at: 2.15, shape: 'line', height: 0, radius: 0, vel: 'cone', cone: PI, speed: [0.5, 3], offset: [0, 0.2, 0] },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'iris', life: 2.6, color: [C.goldLight, 1.6], color2: [C.white, 3.4], radius: [6, 6], attack: 0.2, detail: 24 } },
      { at: 2.05, kind: 'flash', color: C.white, intensity: 3.5, seconds: 0.5, offset: [0, 1.5, 0] },
    ],
  },

  /**
   * Command grammar propagates: thin gold glyphs race outward along eight fixed lines on the floor in a steady,
   * indifferent cadence. Sustained, default 3 s.
   */
  grammarPropagate: {
    sustain: 3,
    emitters: [
      { p: glyphs({ life: [1.3, 1.5], size: [0.2, 0.22, 0.2], sizeRand: 1, facing: 'ground', fadeIn: 0.05, fadeOut: 0.75, color: [[C.white, 5], [C.goldLight, 3.6], [C.gold, 0.5]], colorMid: 0.15 }), burst: 8, every: 0.2, shape: 'ring', radius: 0.5, spokes: 8, vel: 'ring', speed: 9, offset: [0, 0.05, 0] },
      { p: sparks(C.gold, { life: [1.0, 1.2], size: [0.035, 0.03, 0.02], aspect: 8, stretch: 0.11, gravity: 0, bounce: 0, drag: 0, color: [[C.goldLight, 4], [C.gold, 2.6], [C.gold, 0.3]] }), burst: 8, every: 0.1, shape: 'ring', radius: 0.4, spokes: 8, vel: 'ring', speed: 9, offset: [0, 0.05, 0] },
      { p: ringPop(C.gold, 2.6, 0.3, 2.4, 0.5, { facing: 'ground' }), burst: 1, every: 0.8, offset: [0, 0.05, 0] },
    ],
    events: [
      { at: 0, kind: 'decal', decal: 'goldRing', size: 3.4, life: 4 },
      { at: 0, kind: 'flash', color: C.gold, intensity: 1.4, seconds: 0.6, offset: [0, 0.8, 0] },
    ],
  },

  /**
   * Carrier shadow: dust and grit shaken loose as seven million tons pass overhead.
   * Sustained, default 3 s. Scale 1 covers a 20 × 20 m patch, falling from 7 m.
   */
  carrierShadowDust: {
    sustain: 3,
    emitters: [
      { p: dust(C.stone, { life: [2.2, 3.4], size: [0.5, 1.3, 1.9], alpha: 0.16, gravity: 0.9, drag: 0.9, floorFade: true, turb: 0.6, turbFreq: 0.3 }), rate: 12, shape: 'box', radius: 10, height: 0.5, vel: 'none', offset: [0, 7, 0] },
      { p: { layer: 'alpha', sprite: 'dust', life: [1.6, 2.6], size: [0.4, 0.8, 1.0], color: [[C.stone, 1]], alpha: 0.4, fadeIn: 0.15, fadeOut: 0.5, gravity: 2.2, drag: 0.8, spin: 0.4, tint: 0.8 }, rate: 14, shape: 'box', radius: 10, height: 0.5, vel: 'none', offset: [0, 7, 0] },
      { p: chips(C.stone, { life: [1.8, 2.6], size: [0.05, 0.05, 0.04], fadeOut: 0.9 }), rate: 10, shape: 'box', radius: 10, height: 0.3, vel: 'none', offset: [0, 7, 0] },
    ],
  },

  /**
   * Coherent plane: a steady gridded sheet of pale light facing `dir` (default: horizontal).
   * Scale 1 = 6 × 6 m. Sustained until stop(). Nothing in it wanders — coherence reads as stillness.
   */
  coherentPlane: {
    sustain: Infinity,
    emitters: [
      { p: frostGlints({ life: [1.6, 2.4], size: [0.04, 0.07, 0.03], flicker: 0.5, spin: 0 }), rate: 9, shape: 'box', radius: 3, height: 0.01, vel: 'none' },
    ],
    events: [
      { at: 0, kind: 'shape', shape: { kind: 'plane', life: 0.6, sustain: true, color: [C.refBlue, 1.5], color2: [C.ice, 2.6], radius: [0.5, 3], attack: 0.5, detail: 0.75 } },
      { at: 0, kind: 'flash', color: C.refBlue, intensity: 1.4, seconds: 0.5 },
    ],
  },

  /** Witness motes: slow white-gold memory light, drifting around a point. Sustained, default 3 s. */
  witnessMote: {
    sustain: 3,
    emitters: [
      { p: motes(C.goldLight, 3.2, { sprite: ['diamond', 'dot', 'dot'], life: [2.0, 3.2], size: [0.035, 0.06, 0.02], orbit: 0.5, turb: 0.35, turbFreq: 0.3, gravity: -0.12, flicker: 0.35, color: [[C.white, 3.2], [C.goldLight, 2.6], [C.gold, 0]] }), rate: 14, shape: 'sphere', radius: 1.5, vel: 'none' },
      { p: flashGlow(C.goldLight, 0.9, 2.4, 1.6, { color: [[C.goldLight, 0.9], [C.goldLight, 0.7], [C.gold, 0]], fadeIn: 0.4, fadeOut: 0.5 }), burst: 1, every: 1.3 },
    ],
  },
};
