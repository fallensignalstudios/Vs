/** Dominion Enforcer — tower shield on the left forearm, shock baton in the right hand. Slow, square, heavy. */
import type { Moveset } from '../anim/moveset';
import type { ClipSpec, PoseSpec } from '../anim/clip';
import { GENERIC } from './generic';

/** Shield presented, baton low. */
export const E_READY: PoseSpec = {
  hips: [0, -0.06, 0], hipsR: [3, 12, 0],
  spine: [5, -4, 0], chest: [3, -4, 0], neck: [-2, -2, 0], head: [-3, -2, 0],
  armL: { p: [0.08, -0.12, 0.2], fingers: [1, 0.1, 0.05], palm: [0, 0, -1], pole: [-0.7, -0.7, 0.05], fist: 1 },
  armR: { p: [0.3, -0.32, 0.1], blade: [0.05, -0.35, 0.93], edge: [0, -0.93, -0.35], pole: [0.7, -0.5, -0.5] },
  legL: { p: [-0.15, 0, 0.16], yaw: 4, pitch: 0, air: false },
  legR: { p: [0.17, 0, -0.16], yaw: 30, pitch: 0, air: false },
};

const E_WALK: PoseSpec = {
  hips: [0, -0.03, 0], hipsR: [2, 6, 0], spine: [4, -2, 0], chest: [2, -2, 0], neck: [0, -1, 0], head: [-2, -1, 0],
  armL: { p: [0.08, -0.12, 0.21], fingers: [1, 0.1, 0.05], palm: [0, 0, -1], pole: [-0.7, -0.7, 0.05], fist: 1 },
};

const guard: ClipSpec = {
  duration: 2.6, base: E_READY, loop: true, upperOnly: true, fadeIn: 0.14,
  keys: [
    { t: 0, spine: [8, -2, 0], chest: [6, -2, 0], neck: [-4, 0, 0], head: [-6, 0, 0], armL: { p: [0.1, -0.02, 0.24] } },
    { t: 0.5, armL: { p: [0.1, -0.015, 0.245] } },
  ],
};

const shieldBash: ClipSpec = {
  duration: 0.8, base: E_READY, fadeIn: 0.08, fadeOut: 0.24,
  keys: [
    { t: 0 },
    { t: 0.3, ease: 'out', hips: [0, -0.12, -0.08], hipsR: [6, 26, 0], spine: [8, 6, 0], chest: [4, 8, 0], neck: [-4, -14, 0], head: [-6, -18, 0], armL: { p: [0.02, -0.08, 0.1] },
      legL: { p: [-0.15, 0, 0.1] }, legR: { p: [0.18, 0, -0.22], yaw: 34 } },
    { t: 0.46, ease: 'in', hips: [0, -0.1, 0.18], hipsR: [8, -6, 0], spine: [10, -4, 0], chest: [6, -6, 0], neck: [-6, 6, 0], head: [-8, 6, 0], armL: { p: [0.14, 0.0, 0.42] },
      legL: { p: [-0.15, 0, 0.42], yaw: 0 }, legR: { p: [0.18, 0, -0.26], pitch: -26, yaw: 28 } },
    { t: 0.66, ease: 'out', armL: { p: [0.12, -0.02, 0.38] } },
    { t: 1, ease: 'inOut', ...E_READY },
  ],
  events: [[0.38, 'step'], [0.46, 'hit']],
};

const batonStrike: ClipSpec = {
  duration: 0.9, base: E_READY, fadeIn: 0.08, fadeOut: 0.26,
  keys: [
    { t: 0 },
    // shield stays forward while the baton comes up and over
    { t: 0.32, ease: 'out', hips: [0.02, -0.06, -0.04], hipsR: [0, -8, 0], spine: [-4, -8, 0], chest: [-4, -14, 0], neck: [2, 12, 0], head: [2, 16, 0],
      armR: { p: [0.3, 0.4, -0.02], blade: [0.2, 0.72, -0.66], edge: [0, 0.66, 0.72], pole: [0.9, -0.3, 0.2] } },
    { t: 0.46, ease: 'in', hips: [-0.01, -0.1, 0.12], hipsR: [6, 16, 0], spine: [10, 6, 0], chest: [8, 12, 0], neck: [-4, -10, 0], head: [-6, -14, 0],
      armR: { p: [0.12, -0.02, 0.48], blade: [-0.12, -0.3, 0.95], edge: [0, -0.95, -0.3], pole: [0.7, -0.5, -0.5] },
      legL: { p: [-0.15, 0, 0.34], yaw: 0 }, legR: { p: [0.18, 0, -0.24], pitch: -22, yaw: 28 } },
    { t: 0.64, ease: 'out', armR: { p: [0.06, -0.2, 0.42], blade: [-0.2, -0.6, 0.77] } },
    { t: 1, ease: 'inOut', ...E_READY },
  ],
  events: [[0.46, 'hit']],
};

const stagger: ClipSpec = {
  duration: 0.9, base: E_READY, fadeIn: 0.06, fadeOut: 0.3,
  keys: [
    { t: 0 },
    { t: 0.2, ease: 'out', hips: [0.02, -0.08, -0.14], hipsR: [-8, 4, 3], spine: [-10, 0, 4], chest: [-8, -10, 0], head: [10, 0, 0], armL: { p: [-0.1, -0.2, 0.12] }, armR: { p: [0.36, -0.1, 0.0], blade: [0.5, 0.3, 0.8] },
      legR: { p: [0.18, 0, -0.32], yaw: 30 } },
    { t: 0.6, ease: 'inOut', hips: [0, -0.14, -0.14], spine: [6, 0, 0], chest: [4, 0, 0], head: [4, 0, 0] },
    { t: 1, ease: 'inOut', ...E_READY },
  ],
};

export const ENFORCER_MOVES: Moveset = {
  name: 'enforcer',
  parent: GENERIC,
  clips: { guard, shieldBash, batonStrike, attackLight1: batonStrike, stagger },
  alias: { attackHeavy: 'shieldBash', attackLight2: 'batonStrike', attackLight3: 'shieldBash', counter: 'shieldBash', charge: 'shieldBash', guardBreak: 'stagger' },
  stances: {
    melee: { idle: E_READY, walk: E_WALK, swing: [0, 0.3], crouch: 0.02, width: 0.14 },
    none: { idle: E_READY, walk: E_WALK, swing: [0, 0.6], crouch: 0.02, width: 0.14 },
    ranged: { idle: { ...E_READY, armR: { p: [0.22, -0.26, 0.26], barrel: [-0.04, -0.5, 0.86], up: [0, 0.86, 0.5], pole: [0.7, -0.6, -0.3] } }, walk: E_WALK, swing: [0, 0.3], crouch: 0.02, width: 0.14 },
  },
};
