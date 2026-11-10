/**
 * Tarrik — Velkorran greatsword. Heavy, committed: a visible wind-up, one decisive arc, a recovery he has to
 * live with. Durations are the combat contract: lights 0.55 / 0.60 / 0.75 s (hit ≈ 45 %), heavy 1.05 s (hit 55 %),
 * counter 0.5 s, dodge 0.45 s. Positions are [right, up, forward] in chest space unless noted.
 */
import type { Moveset } from '../anim/moveset';
import type { ClipSpec, PoseSpec } from '../anim/clip';
import { GENERIC } from './generic';

/** Low ready: bladed stance, left shoulder leading, point low and forward. */
export const T_READY: PoseSpec = {
  hips: [0, -0.05, 0], hipsR: [3, -20, 0],
  spine: [5, -4, 0], chest: [3, -6, 0], neck: [-2, 12, 0], head: [-4, 16, 0],
  armR: { p: [0.07, -0.31, 0.3], blade: [-0.1, -0.42, 0.9], edge: [0.1, -0.9, -0.4], pole: [0.7, -0.5, -0.5] },
  armL: { sh: [20, 10, 0], el: 60 },
  grip: 1,
  legL: { p: [-0.11, 0, 0.2], yaw: 2, pitch: 0, air: false },
  legR: { p: [0.17, 0, -0.2], yaw: 38, pitch: 0, air: false },
};

const T_WALK: PoseSpec = {
  hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [3, 0, 0], chest: [2, 0, 0], neck: [0, 0, 0], head: [-2, 0, 0],
  armR: { p: [0.1, -0.3, 0.27], blade: [-0.12, -0.36, 0.92], edge: [0, -0.93, -0.36], pole: [0.7, -0.5, -0.5] },
  grip: 1,
};

/** Running: the blade rides the right shoulder, left arm pumps. */
const T_RUN: PoseSpec = {
  armR: { p: [0.2, 0.0, 0.17], blade: [0.2, 0.74, -0.64], edge: [1, -0.2, 0], pole: [0.5, -0.85, -0.1] },
  armL: { sh: [2, 8, 0], el: 20, fk: true },
  grip: 0,
};

const T_GUN: PoseSpec = {
  spine: [3, 0, 0],
  armR: { p: [0.2, -0.27, 0.26], barrel: [-0.05, -0.55, 0.83], up: [0, 0.83, 0.55], pole: [0.7, -0.6, -0.3] },
};

const light1: ClipSpec = {
  duration: 0.55, base: T_READY, fadeIn: 0.06, fadeOut: 0.2,
  keys: [
    { t: 0 },
    // wind-up: coil to the right, blade over the right shoulder
    { t: 0.24, ease: 'out', hips: [0.03, -0.05, -0.06], hipsR: [0, -30, 0], spine: [-2, -12, 0], chest: [-4, -16, 0], neck: [0, 20, 0], head: [0, 26, 0],
      armR: { p: [0.24, 0.22, 0.12], blade: [0.3, 0.85, -0.42], edge: [-0.5, 0.1, 0.86] } },
    // hit: descending diagonal through the target, weight onto the front foot
    { t: 0.45, ease: 'in', hips: [-0.02, -0.09, 0.12], hipsR: [4, 12, 0], spine: [8, 10, 0], chest: [6, 16, 0], neck: [-2, -12, 0], head: [-4, -18, 0],
      armR: { p: [0.0, -0.1, 0.42], blade: [-0.62, -0.3, 0.72], edge: [-0.6, -0.5, -0.6] },
      legL: { p: [-0.12, 0, 0.34], yaw: 0 }, legR: { p: [0.17, 0, -0.26], pitch: -25, yaw: 30 } },
    // follow-through: blade carries low to the left
    { t: 0.64, ease: 'out', hipsR: [4, 18, 0], spine: [8, 14, 0], chest: [6, 24, 0], neck: [-2, -20, 0], head: [-4, -26, 0],
      armR: { p: [-0.08, -0.22, 0.3], blade: [-0.92, -0.25, 0.25], edge: [-0.3, -0.5, -0.8] } },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.3, 'step'], [0.45, 'hit']],
};

const light2: ClipSpec = {
  duration: 0.6, base: T_READY, fadeIn: 0.07, fadeOut: 0.2,
  keys: [
    { t: 0 },
    // wind-up on the left: the returning backhand
    { t: 0.22, ease: 'out', hips: [-0.02, -0.06, 0.02], hipsR: [2, 16, 0], spine: [2, 14, 0], chest: [0, 22, 0], neck: [0, -18, 0], head: [0, -26, 0],
      armR: { p: [-0.1, 0.0, 0.24], blade: [-0.85, 0.3, -0.4], edge: [0.3, -0.1, 0.9] } },
    { t: 0.45, ease: 'in', hips: [0.02, -0.09, 0.12], hipsR: [3, -10, 0], spine: [6, -8, 0], chest: [4, -12, 0], neck: [-2, 12, 0], head: [-3, 16, 0],
      armR: { p: [0.22, 0.02, 0.46], blade: [0.55, 0.1, 0.83], edge: [0.8, -0.1, -0.55] },
      legR: { p: [0.16, 0, 0.2], yaw: 14, pitch: 0 }, legL: { p: [-0.14, 0, -0.12], pitch: -22, yaw: 14 } },
    { t: 0.66, ease: 'out', hipsR: [3, -22, 0], spine: [6, -16, 0], chest: [4, -24, 0], neck: [-2, 24, 0], head: [-3, 34, 0],
      armR: { p: [0.34, 0.08, 0.2], blade: [0.9, 0.3, -0.3], edge: [0.3, 0, 0.95] } },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.3, 'step'], [0.45, 'hit']],
};

const light3: ClipSpec = {
  duration: 0.75, base: T_READY, fadeIn: 0.07, fadeOut: 0.24,
  keys: [
    { t: 0 },
    // both hands overhead, back arched
    { t: 0.27, ease: 'out', hips: [0, 0.02, -0.05], hipsR: [-4, -6, 0], spine: [-10, 0, 0], chest: [-8, 2, 0], neck: [6, 2, 0], head: [8, 2, 0],
      armR: { p: [0.06, 0.5, 0.06], blade: [0.05, 0.6, -0.8], edge: [0, 0.8, 0.6], pole: [0.9, -0.2, 0.2] },
      legL: { p: [-0.11, 0, 0.16], yaw: 2 }, legR: { p: [0.16, 0, -0.22], yaw: 30, pitch: -10 } },
    // the chop
    { t: 0.45, ease: 'in', hips: [0, -0.15, 0.14], hipsR: [10, 0, 0], spine: [18, 0, 0], chest: [12, 0, 0], neck: [-10, 0, 0], head: [-12, 0, 0],
      armR: { p: [0.05, -0.08, 0.42], blade: [0, -0.35, 0.94], edge: [0, -0.94, -0.35], pole: [0.7, -0.5, -0.5] },
      legL: { p: [-0.13, 0, 0.38], yaw: 0 }, legR: { p: [0.16, 0, -0.3], pitch: -30, yaw: 24 } },
    // buried low
    { t: 0.56, ease: 'out', spine: [24, 0, 0], chest: [14, 0, 0], armR: { p: [0.05, -0.2, 0.4], blade: [0, -0.56, 0.83], edge: [0, -0.83, -0.56] } },
    { t: 0.72, ease: 'inOut', spine: [22, 0, 0] },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.34, 'step'], [0.45, 'hit'], [0.52, 'impact']],
};

const heavy: ClipSpec = {
  duration: 1.05, base: T_READY, fadeIn: 0.08, fadeOut: 0.26,
  keys: [
    { t: 0 },
    // long coil: blade trails low behind the right hip
    { t: 0.33, ease: 'outCubic', hips: [0.04, -0.11, -0.08], hipsR: [6, -38, 0], spine: [6, -16, 0], chest: [2, -20, 0], neck: [0, 26, 0], head: [-2, 36, 0],
      armR: { p: [0.26, -0.16, 0.06], blade: [0.55, -0.1, -0.83], edge: [0.6, -0.5, 0.6] },
      legL: { p: [-0.1, 0, 0.18], yaw: -6 }, legR: { p: [0.18, 0, -0.24], yaw: 46 } },
    { t: 0.46, ease: 'inOut', hips: [0.045, -0.13, -0.09], hipsR: [6, -42, 0], armR: { p: [0.27, -0.17, 0.04], blade: [0.5, -0.1, -0.86] } },
    // release: the whole body unwinds through a waist-high sweep
    { t: 0.55, ease: 'in', hips: [-0.03, -0.11, 0.15], hipsR: [6, 14, 0], spine: [8, 12, 0], chest: [4, 18, 0], neck: [-2, -16, 0], head: [-4, -20, 0],
      armR: { p: [0.02, -0.06, 0.43], blade: [-0.5, 0.0, 0.87], edge: [-0.85, -0.2, -0.5] },
      legL: { p: [-0.12, 0, 0.38], yaw: 0 }, legR: { p: [0.18, 0, -0.28], pitch: -28, yaw: 30 } },
    { t: 0.7, ease: 'out', hipsR: [6, 26, 0], spine: [8, 22, 0], chest: [4, 32, 0], neck: [-2, -30, 0], head: [-4, -40, 0],
      armR: { p: [-0.06, 0.0, 0.3], blade: [-0.95, 0.15, -0.2], edge: [-0.2, -0.3, -0.93] } },
    { t: 0.8, ease: 'inOut', hipsR: [6, 28, 0], chest: [4, 34, 0] },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.48, 'step'], [0.55, 'hit']],
};

const heavyCharge: ClipSpec = {
  duration: 0.9, base: T_READY, loop: true, fadeIn: 0.25,
  keys: [
    { t: 0, hips: [0.04, -0.12, -0.08], hipsR: [6, -40, 0], spine: [6, -16, 0], chest: [2, -20, 0], neck: [0, 26, 0], head: [-2, 36, 0],
      armR: { p: [0.26, -0.16, 0.05], blade: [0.52, -0.1, -0.85], edge: [0.6, -0.5, 0.6] },
      legL: { p: [-0.1, 0, 0.18], yaw: -6 }, legR: { p: [0.18, 0, -0.24], yaw: 46 } },
    { t: 0.5, hips: [0.045, -0.135, -0.085], armR: { p: [0.265, -0.165, 0.045] } },
  ],
};

const counter: ClipSpec = {
  duration: 0.5, base: T_READY, fadeIn: 0.04, fadeOut: 0.18,
  keys: [
    { t: 0, armR: { p: [-0.02, -0.04, 0.34], blade: [-0.32, 0.9, 0.28], edge: [0.2, 0.3, 0.93] }, chest: [4, -8, 0] },
    // beat the attack aside
    { t: 0.2, ease: 'out', chest: [2, -16, 0], armR: { p: [0.12, 0.02, 0.36], blade: [-0.55, 0.8, 0.2], edge: [0.6, 0.3, 0.7] } },
    // riposte: short thrust from the hips
    { t: 0.4, ease: 'in', hips: [0, -0.07, 0.12], hipsR: [5, 4, 0], spine: [8, 6, 0], chest: [4, 10, 0], neck: [-2, -8, 0], head: [-4, -10, 0],
      armR: { p: [0.06, 0.02, 0.48], blade: [-0.25, 0.05, 0.96], edge: [0, -1, 0] },
      legL: { p: [-0.12, 0, 0.36], yaw: 0 }, legR: { p: [0.17, 0, -0.26], pitch: -22, yaw: 30 } },
    { t: 0.62, ease: 'out' },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.4, 'hit']],
};

const parry: ClipSpec = {
  duration: 0.35, base: T_READY, upperOnly: true, fadeIn: 0.04,
  keys: [
    { t: 0 },
    { t: 0.35, ease: 'out', chest: [2, -16, 0], armR: { p: [0.12, 0.04, 0.36], blade: [-0.55, 0.8, 0.2], edge: [0.6, 0.3, 0.7] } },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.3, 'hit']],
};

/** Hold: blade diagonal across the body, covering head to hip. */
const guard: ClipSpec = {
  duration: 2.4, base: T_READY, loop: true, upperOnly: true, fadeIn: 0.1,
  keys: [
    { t: 0, spine: [5, -2, 0], chest: [4, -4, 0], neck: [-2, 4, 0], head: [-3, 6, 0],
      armR: { p: [-0.02, -0.04, 0.34], blade: [-0.32, 0.9, 0.28], edge: [0.2, 0.3, 0.93], pole: [0.8, -0.5, -0.2] } },
    { t: 0.5, armR: { p: [-0.02, -0.03, 0.345] } },
  ],
};

const guardBreak: ClipSpec = {
  duration: 0.9, base: T_READY, fadeIn: 0.05,
  keys: [
    { t: 0 },
    { t: 0.18, ease: 'out', hips: [0, -0.04, -0.14], hipsR: [-10, -6, 0], spine: [-14, 0, 0], chest: [-12, 8, 0], head: [12, 0, 0],
      armR: { p: [0.36, 0.1, 0.12], blade: [0.7, 0.6, -0.3], edge: [0, 0, 1] }, grip: 0, armL: { sh: [10, 50, 0], el: 40, fk: true },
      legL: { p: [-0.13, 0, 0.1] }, legR: { p: [0.18, 0, -0.34], yaw: 30 } },
    { t: 0.6, ease: 'inOut', hips: [0, -0.1, -0.16], spine: [-4, 0, 0], chest: [-4, 4, 0], armR: { p: [0.3, -0.2, 0.14], blade: [0.5, -0.5, 0.6] } },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
};

/** Cinder Slam: reverse the blade and drive it into the floor. */
const slam: ClipSpec = {
  duration: 0.95, base: T_READY, fadeIn: 0.08, fadeOut: 0.26,
  keys: [
    { t: 0 },
    { t: 0.3, ease: 'out', hips: [0, 0.03, -0.03], hipsR: [-4, 0, 0], spine: [-8, 0, 0], chest: [-6, 0, 0], neck: [4, 0, 0], head: [6, 0, 0],
      armR: { p: [0.05, 0.5, 0.2], blade: [0, -0.9, 0.42], edge: [0, 0.42, 0.9], pole: [0.9, -0.2, 0.2] },
      legL: { p: [-0.16, 0, 0.12], yaw: 12 }, legR: { p: [0.17, 0, -0.1], yaw: 24 } },
    { t: 0.5, ease: 'in', hips: [0, -0.3, 0.06], hipsR: [12, 0, 0], spine: [16, 0, 0], chest: [10, 0, 0], neck: [-8, 0, 0], head: [-10, 0, 0],
      armR: { p: [0.03, 0.22, 0.36], blade: [0, -1, 0.06], edge: [0, 0.06, 1], pole: [0.8, -0.5, -0.3] },
      legL: { p: [-0.2, 0, 0.16], yaw: 16 }, legR: { p: [0.2, 0, -0.14], yaw: 28, pitch: -10 } },
    { t: 0.74, ease: 'out', hips: [0, -0.32, 0.06], armR: { p: [0.03, 0.2, 0.36] } },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.5, 'impact'], [0.5, 'hit']],
};

/** Deliberate, ceremonial version of the slam (narrative floor strike). */
const floorStrike: ClipSpec = {
  duration: 1.6, base: T_READY, fadeIn: 0.2, fadeOut: 0.4,
  keys: [
    { t: 0 },
    { t: 0.35, ease: 'inOut', hips: [0, 0.02, -0.02], hipsR: [-3, 0, 0], spine: [-6, 0, 0], chest: [-4, 0, 0], neck: [3, 0, 0], head: [4, 0, 0],
      armR: { p: [0.04, 0.46, 0.22], blade: [0, -0.92, 0.38], edge: [0, 0.38, 0.92], pole: [0.9, -0.2, 0.2] },
      legL: { p: [-0.15, 0, 0.1], yaw: 12 }, legR: { p: [0.16, 0, -0.08], yaw: 22 } },
    { t: 0.52, ease: 'in', hips: [0, -0.24, 0.05], hipsR: [9, 0, 0], spine: [12, 0, 0], chest: [8, 0, 0], neck: [-6, 0, 0], head: [-8, 0, 0],
      armR: { p: [0.03, 0.17, 0.36], blade: [0, -1, 0.05], edge: [0, 0.05, 1], pole: [0.8, -0.5, -0.3] } },
    { t: 0.85, ease: 'inOut', hips: [0, -0.25, 0.05] },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.52, 'impact'], [0.52, 'hit']],
};

/** Cinder sticky grenade: left-hand overhand throw while the right keeps the blade low. */
const throwClip: ClipSpec = {
  duration: 0.6, base: T_READY, upperOnly: true, fadeIn: 0.07,
  keys: [
    { t: 0, grip: 0 },
    { t: 0.3, ease: 'out', grip: 0, spine: [0, -10, 0], chest: [-4, -22, 0], neck: [0, 14, 0], head: [0, 16, 0],
      armL: { p: [-0.3, 0.28, -0.08], fingers: [-0.2, 0.9, -0.3], palm: [0.3, 0.2, 0.9], pole: [-0.8, -0.4, -0.3], fist: 0.9 } },
    { t: 0.52, ease: 'in', spine: [8, 10, 0], chest: [6, 22, 0], neck: [-2, -12, 0], head: [-3, -18, 0],
      armL: { p: [-0.08, 0.3, 0.5], fingers: [0, 0.1, 1], palm: [0, -1, 0.2], fist: 0 } },
    { t: 0.75, ease: 'out', armL: { p: [-0.02, 0.05, 0.42], fingers: [0.2, -0.6, 0.8], palm: [0, -0.8, -0.6] } },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.5, 'release']],
};

const dodge: ClipSpec = {
  duration: 0.45, base: T_READY, fadeIn: 0.04, fadeOut: 0.14,
  keys: [
    { t: 0 },
    // drop the shoulder and drive
    { t: 0.3, ease: 'out', hips: [0, -0.34, 0.1], hipsR: [26, -14, 0], spine: [22, -4, 0], chest: [14, -6, 0], neck: [-18, 8, 0], head: [-20, 10, 0],
      armR: { p: [0.2, -0.22, 0.12], blade: [0.3, -0.25, -0.92], edge: [0, -1, 0] }, grip: 0, armL: { sh: [40, 14, 20], el: 95, fk: true },
      legL: { p: [-0.12, 0, 0.3], yaw: 0 }, legR: { p: [0.16, 0.06, -0.36], pitch: -50, yaw: 20, air: true } },
    { t: 0.68, ease: 'inOut', hips: [0, -0.3, 0.06], legR: { p: [0.16, 0, 0.16], pitch: 0, yaw: 20, air: false }, legL: { p: [-0.12, 0, -0.26], pitch: -30 } },
    { t: 1, ease: 'inOut', ...T_READY },
  ],
  events: [[0.1, 'step'], [0.7, 'step']],
};

const lowerWeapon: ClipSpec = {
  duration: 1.2, base: T_READY, hold: true, fadeIn: 0.3,
  keys: [
    { t: 0 },
    { t: 1, ease: 'inOut', hips: [0, 0, 0], hipsR: [0, -6, 0], spine: [2, -2, 0], chest: [0, -2, 0], neck: [0, 4, 0], head: [2, 6, 0],
      armR: { p: [0.22, -0.34, 0.1], blade: [0.05, -0.92, 0.38], edge: [0, -0.38, -0.92] }, grip: 0, armL: { sh: [2, 6, 0], el: 14, fk: true },
      legL: { p: [-0.12, 0, 0.06], yaw: 8 }, legR: { p: [0.13, 0, -0.04], yaw: 16 } },
  ],
  events: [[1, 'impact']],
};

const raiseWeapon: ClipSpec = {
  duration: 0.8, fadeIn: 0.25,
  base: { ...T_READY, armR: { p: [0.22, -0.34, 0.1], blade: [0.05, -0.92, 0.38], edge: [0, -0.38, -0.92] }, grip: 0 },
  keys: [{ t: 0 }, { t: 1, ease: 'inOut', ...T_READY }],
};

export const TARRIK_MOVES: Moveset = {
  name: 'tarrik',
  parent: GENERIC,
  clips: {
    attackLight1: light1, attackLight2: light2, attackLight3: light3, attackHeavy: heavy, attackHeavyCharge: heavyCharge,
    counter, parry, guard, guardBreak, slam, groundSlam: slam, floorStrike, throw: throwClip, dodge, lowerWeapon, raiseWeapon,
  },
  alias: { attackLight4: 'attackLight2', deflect: 'parry' },
  stances: {
    melee: { idle: T_READY, walk: T_WALK, run: T_RUN, swing: [1, 0.2], width: 0.12 },
    ranged: { idle: T_GUN, swing: [1, 0.35], width: 0.115 },
    none: { idle: { spine: [2, 0, 0] }, width: 0.115 },
    case: { idle: { spine: [2, 0, 0] }, swing: [0.25, 1], width: 0.115 },
  },
};
