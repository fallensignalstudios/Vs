/** Linkbound — a coerced body. Hunched, head canted, arms hanging long; attacks are lunges on the shared beat. */
import type { Moveset } from '../anim/moveset';
import type { ClipSpec, PoseSpec } from '../anim/clip';
import { GENERIC } from './generic';

export const L_HUNCH: PoseSpec = {
  hips: [0, -0.1, 0], hipsR: [10, 0, 0],
  spine: [22, 0, 4], chest: [14, 0, -3], neck: [-16, 0, 0], head: [-14, 0, 0],
  armL: { sh: [26, 12, 20], el: 34, fist: 0.55 }, armR: { sh: [32, 14, 20], el: 26, fist: 0.55 },
  legL: { p: [-0.13, 0, 0.06], yaw: 2, pitch: 0, air: false }, legR: { p: [0.14, 0, -0.08], yaw: 20, pitch: 0, air: false },
};

/** Telegraphed lunge: sink, then throw the whole body forward behind both hands. */
const lunge: ClipSpec = {
  duration: 0.8, base: L_HUNCH, fadeIn: 0.08, fadeOut: 0.24,
  keys: [
    { t: 0 },
    { t: 0.34, ease: 'out', hips: [0, -0.28, -0.1], hipsR: [20, 0, 0], spine: [26, 0, 0], chest: [10, 0, 0], neck: [-24, 0, 0], head: [-22, 0, 0],
      armL: { sh: [-40, 26, 0], el: 70, fist: 0.4 }, armR: { sh: [-46, 24, 0], el: 76, fist: 0.4 },
      legL: { p: [-0.14, 0, 0.1], yaw: 6 }, legR: { p: [0.16, 0, -0.2], yaw: 22, pitch: -24 } },
    { t: 0.5, ease: 'in', hips: [0, -0.16, 0.26], hipsR: [30, 0, 0], spine: [20, 0, 0], chest: [8, 0, 0], neck: [-22, 0, 0], head: [-24, 0, 0],
      armL: { p: [-0.12, 0.12, 0.52], fingers: [0.1, 0.1, 1], palm: [0.5, -0.8, 0.1], fist: 0.45, pole: [-0.8, -0.3, -0.2] },
      armR: { p: [0.12, 0.16, 0.54], fingers: [-0.1, 0.1, 1], palm: [-0.5, -0.8, 0.1], fist: 0.45, pole: [0.8, -0.3, -0.2] },
      legL: { p: [-0.13, 0, 0.44], yaw: 0, pitch: 0 }, legR: { p: [0.15, 0.04, -0.4], pitch: -50, yaw: 14, air: true } },
    { t: 0.68, ease: 'out', hips: [0, -0.2, 0.22], armL: { p: [-0.16, -0.12, 0.4] }, armR: { p: [0.16, -0.1, 0.42] }, legR: { p: [0.15, 0, -0.3], pitch: -30, air: false } },
    { t: 1, ease: 'inOut', ...L_HUNCH },
  ],
  events: [[0.34, 'step'], [0.5, 'hit']],
};

/** Raking swipe with the right hand. */
const swipe: ClipSpec = {
  duration: 0.6, base: L_HUNCH, fadeIn: 0.06, fadeOut: 0.2,
  keys: [
    { t: 0 },
    { t: 0.3, ease: 'out', hipsR: [10, -24, 0], spine: [18, -10, 4], chest: [10, -16, 0], neck: [-14, 20, 0], head: [-12, 24, 0],
      armR: { p: [0.36, 0.14, 0.02], fingers: [0.5, 0.6, 0.6], palm: [-0.6, -0.2, 0.75], fist: 0.4, pole: [0.8, -0.3, -0.5] } },
    { t: 0.48, ease: 'in', hips: [0, -0.14, 0.12], hipsR: [14, 14, 0], spine: [20, 8, 0], chest: [10, 16, 0], neck: [-14, -10, 0], head: [-14, -14, 0],
      armR: { p: [-0.02, -0.04, 0.5], fingers: [-0.7, 0, 0.7], palm: [-0.5, -0.5, -0.7], fist: 0.4 },
      legL: { p: [-0.13, 0, 0.3], yaw: 0 }, legR: { p: [0.15, 0, -0.2], pitch: -24, yaw: 20 } },
    { t: 0.68, ease: 'out', armR: { p: [-0.14, -0.22, 0.3], fingers: [-0.8, -0.5, 0.3], palm: [-0.2, -0.3, -0.9] } },
    { t: 1, ease: 'inOut', ...L_HUNCH },
  ],
  events: [[0.48, 'hit']],
};

/** Linked cadence: every body twitches on the same beat (1.2 s). */
const linkedSync: ClipSpec = {
  duration: 1.2, base: L_HUNCH, loop: true, upperOnly: true, fadeIn: 0.3,
  keys: [
    { t: 0, spine: [24, 0, 4], chest: [16, 0, -3], neck: [-10, 0, 0], head: [-6, 0, 0], armL: { sh: [30, 14, 20], el: 44, fist: 0.7 }, armR: { sh: [36, 16, 20], el: 36, fist: 0.7 } },
    { t: 0.12, ease: 'out', spine: [18, 0, 4], chest: [8, 0, -3], neck: [-20, 0, 0], head: [-22, 0, 0], armL: { sh: [20, 22, 20], el: 28, fist: 0.2 }, armR: { sh: [26, 24, 20], el: 22, fist: 0.2 } },
    { t: 0.4, ease: 'inOut', spine: [22, 2, 4], chest: [14, 2, -3], neck: [-16, 0, 0], head: [-14, 4, 0], armL: { sh: [26, 12, 20], el: 34, fist: 0.55 }, armR: { sh: [32, 14, 20], el: 26, fist: 0.55 } },
    { t: 0.8, ease: 'inOut', spine: [23, -2, 4], chest: [15, -2, -3], head: [-12, -4, 0] },
  ],
  events: [[0.08, 'hit']],
};

/** Rising out of a breach: unfolds from a ball on the floor. */
const spawnBreach: ClipSpec = {
  duration: 1.5, fadeIn: 0.01, fadeOut: 0.3,
  keys: [
    { t: 0, hips: [0, -0.62, 0], hipsR: [40, 0, 0], spine: [40, 0, 0], chest: [30, 0, 0], neck: [20, 0, 0], head: [24, 0, 0],
      armL: { p: [-0.16, -0.5, 0.3], fingers: [0, -0.2, 1], palm: [0, -1, -0.1], fist: 0.3, pole: [-0.9, 0, -0.2] }, armR: { p: [0.16, -0.5, 0.32], fingers: [0, -0.2, 1], palm: [0, -1, -0.1], fist: 0.3, pole: [0.9, 0, -0.2] },
      legL: { p: [-0.16, 0, 0.1], yaw: 16, knee: [-0.4, 0.2, 1] }, legR: { p: [0.16, 0, 0.0], yaw: 16, pitch: -30, knee: [0.4, 0.2, 1] } },
    { t: 0.3, ease: 'inOut', hips: [0, -0.6, 0], head: [10, 12, 0] },
    { t: 0.62, ease: 'inOut', hips: [0, -0.34, 0.02], hipsR: [24, 0, 0], spine: [30, 0, 6], chest: [20, 0, -4], neck: [-6, 0, 0], head: [-8, -10, 0],
      armL: { p: [-0.2, -0.46, 0.24] }, armR: { p: [0.2, -0.44, 0.24] } },
    { t: 1, ease: 'inOut', ...L_HUNCH },
  ],
  events: [[0.62, 'step']],
};

const stagger: ClipSpec = {
  duration: 0.6, base: L_HUNCH, fadeIn: 0.05, fadeOut: 0.22,
  keys: [
    { t: 0 },
    { t: 0.22, ease: 'out', hips: [0.03, -0.06, -0.16], hipsR: [-14, 10, 6], spine: [-8, 6, 8], chest: [-10, 14, 0], neck: [10, 0, 0], head: [16, -10, 8],
      armL: { sh: [-10, 50, 0], el: 30, fist: 0.2 }, armR: { sh: [10, 46, 0], el: 30, fist: 0.2 }, legR: { p: [0.16, 0, -0.34], yaw: 24 } },
    { t: 1, ease: 'inOut', ...L_HUNCH, hips: [0, -0.1, -0.16] },
  ],
};

export const LINKBOUND_MOVES: Moveset = {
  name: 'linkbound',
  parent: GENERIC,
  clips: { lunge, attackLight1: swipe, linkedSync, spawnBreach, stagger },
  alias: { attackHeavy: 'lunge', attackLight2: 'attackLight1', pounce: 'lunge', charge: 'lunge', spawnDrop: 'spawnBreach', guardBreak: 'stagger' },
  stances: { none: { idle: L_HUNCH, swing: [0.45, 0.45], crouch: 0.05, width: 0.125 } },
};
