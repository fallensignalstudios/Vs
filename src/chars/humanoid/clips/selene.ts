/**
 * Selene — Verity, the ring-hilted double blade. Fast and rotational: the weapon keeps turning from one strike
 * into the next, so alternate hits land with alternate blades. Lights 0.34 / 0.34 / 0.38 / 0.45 s, spinning
 * heavy 0.7 s, dodge 0.45 s. `blade` is the direction of the FORWARD blade; the rear blade points opposite.
 */
import type { Moveset } from '../anim/moveset';
import type { ClipSpec, PoseSpec } from '../anim/clip';
import { GENERIC } from './generic';

/** Ready: bladed, weight low, Verity carried at the right hip with the forward blade angled down. */
export const S_READY: PoseSpec = {
  hips: [0, -0.04, 0], hipsR: [2, -18, 0],
  spine: [4, -2, 0], chest: [2, -4, 0], neck: [-2, 10, 0], head: [-3, 14, 0],
  armR: { p: [0.25, -0.3, 0.14], blade: [-0.2, -0.55, 0.8], edge: [0.9, 0, 0.3], pole: [0.75, -0.5, -0.45] },
  armL: { sh: [14, 12, 6], el: 48, fist: 0.35 },
  legL: { p: [-0.1, 0, 0.17], yaw: 2, pitch: 0, air: false },
  legR: { p: [0.15, 0, -0.17], yaw: 34, pitch: 0, air: false },
};

const S_WALK: PoseSpec = {
  hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [2, 0, 0], chest: [1, 0, 0], neck: [0, 0, 0], head: [-1, 0, 0],
  armR: { p: [0.27, -0.32, 0.08], blade: [-0.05, -0.3, 0.95], edge: [1, 0, 0], pole: [0.75, -0.5, -0.45] },
  armL: { sh: [2, 7, 0], el: 16 },
};

/** Running: the staff-length weapon trails level beside the hip. */
const S_RUN: PoseSpec = {
  armR: { p: [0.3, -0.28, 0.0], blade: [-0.2, -0.45, 0.87], edge: [1, 0, 0.2], pole: [0.7, -0.4, -0.6] },
};

const S_GUN: PoseSpec = {
  spine: [2, 0, 0],
  armR: { p: [0.19, -0.26, 0.24], barrel: [-0.04, -0.55, 0.83], up: [0, 0.83, 0.55], pole: [0.7, -0.6, -0.3] },
};

const light1: ClipSpec = {
  duration: 0.34, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0 },
    { t: 0.2, ease: 'out', hipsR: [2, -26, 0], chest: [0, -14, 0], neck: [0, 16, 0], head: [-2, 22, 0],
      armR: { p: [0.3, 0.02, 0.1], blade: [0.85, 0.12, 0.5], edge: [0, 1, 0] }, armL: { sh: [30, 24, 10], el: 70 } },
    // forward blade cuts right → left at chest height
    { t: 0.42, ease: 'in', hips: [-0.01, -0.07, 0.1], hipsR: [3, 6, 0], spine: [6, 8, 0], chest: [4, 14, 0], neck: [-2, -10, 0], head: [-3, -14, 0],
      armR: { p: [0.02, 0.0, 0.46], blade: [-0.4, 0.0, 0.92], edge: [0, 1, 0] }, armL: { sh: [-20, 26, 0], el: 40 },
      legL: { p: [-0.1, 0, 0.3], yaw: 0 }, legR: { p: [0.15, 0, -0.22], pitch: -24, yaw: 28 } },
    { t: 0.66, ease: 'out', hipsR: [3, 14, 0], chest: [4, 24, 0], neck: [-2, -18, 0], head: [-3, -24, 0],
      armR: { p: [-0.1, -0.05, 0.3], blade: [-0.96, -0.1, 0.2], edge: [0, 1, 0] } },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.42, 'hit']],
};

const light2: ClipSpec = {
  duration: 0.34, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    // enters from light1's follow-through: the weapon keeps turning, the REAR blade leads back across
    { t: 0, hipsR: [3, 14, 0], chest: [4, 22, 0], neck: [-2, -16, 0], head: [-3, -22, 0], armR: { p: [-0.08, -0.02, 0.3], blade: [-0.9, -0.05, -0.4], edge: [0, 1, 0] } },
    { t: 0.42, ease: 'in', hips: [0.01, -0.07, 0.1], hipsR: [3, -8, 0], spine: [6, -6, 0], chest: [4, -10, 0], neck: [-2, 10, 0], head: [-3, 14, 0],
      armR: { p: [0.12, 0.02, 0.44], blade: [0.42, 0.06, -0.9], edge: [0, 1, 0] }, armL: { sh: [-14, 22, 0], el: 50 },
      legR: { p: [0.14, 0, 0.16], yaw: 12, pitch: 0 }, legL: { p: [-0.12, 0, -0.14], pitch: -22, yaw: 12 } },
    { t: 0.66, ease: 'out', hipsR: [3, -20, 0], chest: [4, -22, 0], neck: [-2, 20, 0], head: [-3, 26, 0],
      armR: { p: [0.3, 0.05, 0.24], blade: [0.95, 0.1, -0.25], edge: [0, 1, 0] } },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.42, 'hit']],
};

const light3: ClipSpec = {
  duration: 0.38, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0 },
    { t: 0.2, ease: 'out', hips: [0, -0.1, -0.02], hipsR: [6, -22, 0], chest: [4, -10, 0], armR: { p: [0.26, -0.26, 0.16], blade: [0.3, -0.85, 0.42], edge: [1, 0, 0] } },
    // rising diagonal, forward blade finishing high
    { t: 0.44, ease: 'in', hips: [0, -0.02, 0.1], hipsR: [-2, 8, 0], spine: [-2, 6, 0], chest: [-4, 12, 0], neck: [2, -8, 0], head: [4, -10, 0],
      armR: { p: [0.04, 0.2, 0.42], blade: [-0.25, 0.72, 0.64], edge: [1, 0, 0], pole: [0.9, -0.3, -0.2] }, armL: { sh: [-24, 20, 0], el: 30 },
      legL: { p: [-0.1, 0, 0.28], yaw: 0 }, legR: { p: [0.15, 0, -0.2], pitch: -30, yaw: 26 } },
    { t: 0.68, ease: 'out', armR: { p: [-0.04, 0.34, 0.26], blade: [-0.5, 0.82, -0.25], edge: [1, 0, 0] }, chest: [-4, 20, 0] },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.44, 'hit']],
};

const light4: ClipSpec = {
  duration: 0.45, base: S_READY, fadeIn: 0.05, fadeOut: 0.2,
  keys: [
    { t: 0 },
    { t: 0.24, ease: 'out', hips: [0, 0.02, -0.04], hipsR: [-4, -12, 0], spine: [-8, -4, 0], chest: [-6, -8, 0], neck: [4, 6, 0], head: [6, 8, 0],
      armR: { p: [0.2, 0.42, 0.02], blade: [0.2, 0.62, -0.76], edge: [1, 0, 0], pole: [0.9, -0.2, 0.1] }, armL: { sh: [40, 16, 0], el: 30 } },
    // finisher: falling diagonal, driven by the whole back
    { t: 0.46, ease: 'in', hips: [0, -0.14, 0.14], hipsR: [10, 6, 0], spine: [14, 4, 0], chest: [10, 8, 0], neck: [-8, -6, 0], head: [-10, -8, 0],
      armR: { p: [0.02, -0.12, 0.44], blade: [-0.2, -0.5, 0.84], edge: [1, 0, 0], pole: [0.75, -0.5, -0.45] }, armL: { sh: [-30, 30, 0], el: 20 },
      legL: { p: [-0.11, 0, 0.36], yaw: 0 }, legR: { p: [0.15, 0, -0.28], pitch: -30, yaw: 24 } },
    { t: 0.66, ease: 'out', armR: { p: [-0.04, -0.24, 0.36], blade: [-0.45, -0.75, 0.48], edge: [1, 0, 0] }, spine: [18, 6, 0] },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.46, 'hit']],
};

/** Spinning heavy: a full pirouette on the left foot, both blades level — two sweeps in one turn. */
const heavy: ClipSpec = {
  duration: 0.7, base: S_READY, fadeIn: 0.05, fadeOut: 0.2,
  keys: [
    { t: 0 },
    { t: 0.2, ease: 'out', hips: [0, -0.1, 0], hipsR: [4, 34, 0], spine: [4, 10, 0], chest: [2, 14, 0], neck: [0, -24, 0], head: [-2, -30, 0],
      armR: { p: [0.3, -0.04, 0.16], blade: [0.2, 0.05, 0.98], edge: [0, 1, 0] }, armL: { sh: [10, 40, 0], el: 30 },
      legL: { p: [-0.08, 0, 0.06], yaw: 14, pitch: -8 }, legR: { p: [0.2, 0, -0.14], yaw: 10, pitch: -20 } },
    { t: 0.4, ease: 'in', hips: [0, -0.07, 0.02], hipsR: [4, -90, 0], spine: [4, -8, 0], chest: [2, -10, 0], neck: [0, 30, 0], head: [-2, 40, 0],
      armR: { p: [0.34, 0.0, 0.14], blade: [0.3, 0.02, 0.95], edge: [0, 1, 0] }, armL: { sh: [0, 60, 0], el: 20 },
      legL: { p: [-0.04, 0, 0.04], yaw: -60, pitch: -24 }, legR: { p: [-0.1, 0.1, -0.22], yaw: 90, pitch: -30, air: true } },
    { t: 0.6, ease: 'linear', hipsR: [4, -200, 0], neck: [0, 0, 0], head: [-2, 0, 0],
      legL: { p: [-0.04, 0, 0.04], yaw: -170, pitch: -24 }, legR: { p: [-0.16, 0.12, 0.16], yaw: 200, pitch: -30, air: true } },
    { t: 0.78, ease: 'out', hips: [0, -0.09, 0.04], hipsR: [4, -330, 0], neck: [0, -16, 0], head: [-2, -20, 0],
      armR: { p: [0.3, -0.02, 0.2], blade: [0.1, 0.0, 0.99], edge: [0, 1, 0] },
      legL: { p: [-0.08, 0, 0.1], yaw: -330, pitch: -10 }, legR: { p: [0.2, 0, -0.04], yaw: 330, pitch: -10, air: false } },
    { t: 1, ease: 'inOut', ...S_READY, hipsR: [2, -378, 0] },
  ],
  events: [[0.36, 'hit'], [0.6, 'hit']],
};

const heavyCharge: ClipSpec = {
  duration: 0.8, base: S_READY, loop: true, fadeIn: 0.2,
  keys: [
    { t: 0, hips: [0, -0.11, 0], hipsR: [4, 34, 0], spine: [4, 10, 0], chest: [2, 14, 0], neck: [0, -24, 0], head: [-2, -30, 0],
      armR: { p: [0.3, -0.04, 0.16], blade: [0.2, 0.05, 0.98], edge: [0, 1, 0] }, armL: { sh: [10, 40, 0], el: 30 },
      legL: { p: [-0.08, 0, 0.06], yaw: 14 }, legR: { p: [0.2, 0, -0.14], yaw: 10, pitch: -20 } },
    { t: 0.5, hips: [0, -0.125, 0] },
  ],
};

/** Deflect: Verity wheels once in front of her like a shutter. */
const deflect: ClipSpec = {
  duration: 0.5, base: S_READY, upperOnly: true, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0, armR: { p: [0.1, 0.02, 0.4], blade: [0.1, -0.98, 0.15], edge: [1, 0, 0], pole: [0.9, -0.4, -0.1] }, chest: [2, -6, 0], armL: { sh: [30, 18, 20], el: 80 } },
    { t: 0.3, ease: 'linear', armR: { p: [0.1, 0.04, 0.42], blade: [0.98, 0.1, 0.15], edge: [0, 1, 0] } },
    { t: 0.6, ease: 'linear', armR: { p: [0.08, 0.04, 0.42], blade: [-0.1, 0.98, 0.15], edge: [-1, 0, 0] } },
    { t: 0.85, ease: 'out', armR: { p: [0.08, 0.02, 0.4], blade: [-0.92, 0.35, 0.15], edge: [0, -1, 0] } },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.2, 'hit']],
};

const guard: ClipSpec = {
  duration: 2.2, base: S_READY, loop: true, upperOnly: true, fadeIn: 0.1,
  keys: [
    { t: 0, spine: [4, -2, 0], chest: [3, -6, 0], neck: [-2, 6, 0], head: [-3, 8, 0],
      armR: { p: [0.08, 0.0, 0.38], blade: [-0.42, 0.86, 0.26], edge: [0.7, 0.4, -0.2], pole: [0.9, -0.4, -0.1] }, armL: { sh: [34, 16, 22], el: 86, fist: 0.4 } },
    { t: 0.5, armR: { p: [0.08, 0.01, 0.385] } },
  ],
};

/** Counter after a timed deflect: snap thrust with the forward blade. */
const counter: ClipSpec = {
  duration: 0.4, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0, armR: { p: [0.14, 0.02, 0.22], blade: [-0.1, 0.05, 0.99], edge: [1, 0, 0] } },
    { t: 0.4, ease: 'in', hips: [0, -0.08, 0.14], hipsR: [5, 6, 0], spine: [8, 6, 0], chest: [4, 10, 0], neck: [-2, -8, 0], head: [-4, -8, 0],
      armR: { p: [0.08, 0.04, 0.52], blade: [-0.12, 0.02, 0.99], edge: [1, 0, 0] }, armL: { sh: [-30, 24, 0], el: 20 },
      legL: { p: [-0.1, 0, 0.36], yaw: 0 }, legR: { p: [0.15, 0, -0.26], pitch: -26, yaw: 26 } },
    { t: 0.64, ease: 'out' },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.4, 'hit']],
};

/** Dispatch: coil, then a flat blink-thrust (the driver relocates the actor at 'hit'). */
const dispatch: ClipSpec = {
  duration: 0.55, base: S_READY, fadeIn: 0.05, fadeOut: 0.2,
  keys: [
    { t: 0 },
    { t: 0.3, ease: 'out', hips: [0, -0.24, -0.06], hipsR: [14, -30, 0], spine: [12, -8, 0], chest: [6, -12, 0], neck: [-10, 20, 0], head: [-12, 26, 0],
      armR: { p: [0.3, -0.12, -0.02], blade: [-0.2, 0.1, 0.97], edge: [1, 0, 0] }, armL: { sh: [50, 10, 20], el: 60 },
      legL: { p: [-0.1, 0, 0.22], yaw: 0 }, legR: { p: [0.16, 0, -0.26], pitch: -30, yaw: 30 } },
    { t: 0.46, ease: 'in', hips: [0, -0.2, 0.2], hipsR: [16, 10, 0], spine: [14, 8, 0], chest: [8, 14, 0], neck: [-12, -10, 0], head: [-14, -12, 0],
      armR: { p: [0.06, 0.06, 0.54], blade: [-0.1, 0.0, 1], edge: [1, 0, 0] }, armL: { sh: [-50, 24, 0], el: 10 },
      legL: { p: [-0.1, 0, 0.44], yaw: 0 }, legR: { p: [0.15, 0, -0.36], pitch: -40, yaw: 20 } },
    { t: 0.7, ease: 'out' },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.46, 'hit']],
};

/** Stasis grenade: underhand left-hand cast. */
const throwClip: ClipSpec = {
  duration: 0.5, base: S_READY, upperOnly: true, fadeIn: 0.06,
  keys: [
    { t: 0 },
    { t: 0.3, ease: 'out', chest: [4, -16, 0], neck: [0, 10, 0], head: [0, 12, 0],
      armL: { p: [-0.28, -0.26, -0.12], fingers: [-0.1, -0.7, -0.7], palm: [0.2, -0.6, 0.75], pole: [-0.8, -0.3, -0.5], fist: 0.9 } },
    { t: 0.55, ease: 'in', chest: [2, 14, 0], neck: [0, -8, 0], head: [0, -10, 0],
      armL: { p: [-0.1, 0.12, 0.5], fingers: [0, 0.5, 0.86], palm: [0, 0.86, -0.5], fist: 0 } },
    { t: 0.78, ease: 'out', armL: { p: [-0.08, 0.2, 0.44], fingers: [0, 0.8, 0.6], palm: [0, 0.6, -0.8] } },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.52, 'release']],
};

const dodge: ClipSpec = {
  duration: 0.45, base: S_READY, fadeIn: 0.04, fadeOut: 0.14,
  keys: [
    { t: 0 },
    // low slide: one knee folds, the other leg trails long
    { t: 0.3, ease: 'out', hips: [0, -0.42, 0.06], hipsR: [20, -24, 0], spine: [18, -6, 0], chest: [12, -8, 0], neck: [-14, 14, 0], head: [-16, 18, 0],
      armR: { p: [0.3, -0.16, -0.06], blade: [0.1, 0.1, 0.99], edge: [1, 0, 0] }, armL: { p: [-0.2, -0.36, 0.3], fingers: [0, -0.9, 0.4], palm: [0, -0.4, -0.9], fist: 0.1 },
      legL: { p: [-0.1, 0, 0.32], yaw: 0 }, legR: { p: [0.2, 0, -0.5], pitch: -60, yaw: 30 } },
    { t: 0.66, ease: 'inOut', hips: [0, -0.36, 0.06] },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.08, 'step']],
};

/** Frost tether: the off hand thrown out, bracing against a pull. */
const tetherStop: ClipSpec = {
  duration: 2, base: S_READY, loop: true, fadeIn: 0.18,
  keys: [
    { t: 0, hips: [0, -0.12, -0.06], hipsR: [-4, -30, 0], spine: [-2, -6, 0], chest: [-2, -10, 0], neck: [0, 18, 0], head: [-2, 26, 0],
      armL: { p: [-0.1, 0.12, 0.52], fingers: [0.1, 0.5, 0.86], palm: [0, -0.3, 0.95], pole: [-0.6, -0.7, -0.2], fist: 0 },
      armR: { p: [0.3, -0.2, -0.04], blade: [0.3, -0.4, 0.86], edge: [1, 0, 0] },
      legL: { p: [-0.1, 0, 0.3], yaw: 0 }, legR: { p: [0.18, 0, -0.3], yaw: 50 } },
    { t: 0.5, hips: [0, -0.13, -0.075], armL: { p: [-0.1, 0.125, 0.5] } },
  ],
};

/** Holding the coherent plane: both arms up, palms flat to an unseen pane, leaning into it. */
const holdPlane: ClipSpec = {
  duration: 2.4, loop: true, fadeIn: 0.3,
  keys: [
    { t: 0, hips: [0, -0.08, 0.04], hipsR: [6, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0],
      armL: { p: [-0.2, 0.2, 0.46], fingers: [-0.15, 0.95, 0.2], palm: [0, -0.2, 0.98], pole: [-0.7, -0.6, -0.2], fist: 0 },
      armR: { p: [0.2, 0.2, 0.46], fingers: [0.15, 0.95, 0.2], palm: [0, -0.2, 0.98], pole: [0.7, -0.6, -0.2], fist: 0 },
      legL: { p: [-0.14, 0, 0.22], yaw: 4 }, legR: { p: [0.15, 0, -0.24], yaw: 30, pitch: -12 } },
    { t: 0.5, hips: [0, -0.09, 0.03], armL: { p: [-0.2, 0.21, 0.45] }, armR: { p: [0.2, 0.195, 0.455] } },
  ],
};

const lowerWeapon: ClipSpec = {
  duration: 1, base: S_READY, hold: true, fadeIn: 0.3,
  keys: [
    { t: 0 },
    { t: 1, ease: 'inOut', hips: [0, 0, 0], hipsR: [0, -4, 0], spine: [1, 0, 0], chest: [0, 0, 0], neck: [0, 2, 0], head: [2, 2, 0],
      armR: { p: [0.26, -0.34, 0.04], blade: [0, -0.96, 0.28], edge: [1, 0, 0] }, armL: { sh: [2, 6, 0], el: 14 },
      legL: { p: [-0.11, 0, 0.05], yaw: 8 }, legR: { p: [0.12, 0, -0.03], yaw: 14 } },
  ],
};

const raiseWeapon: ClipSpec = {
  duration: 0.6, fadeIn: 0.2,
  base: { ...S_READY, armR: { p: [0.26, -0.34, 0.04], blade: [0, -0.96, 0.28], edge: [1, 0, 0] } },
  keys: [{ t: 0 }, { t: 1, ease: 'inOut', ...S_READY }],
};

export const SELENE_MOVES: Moveset = {
  name: 'selene',
  parent: GENERIC,
  clips: {
    attackLight1: light1, attackLight2: light2, attackLight3: light3, attackLight4: light4, attackHeavy: heavy, attackHeavyCharge: heavyCharge,
    deflect, guard, counter, dispatch, throw: throwClip, dodge, tetherStop, holdPlane, lowerWeapon, raiseWeapon,
  },
  alias: { parry: 'deflect' },
  stances: {
    melee: { idle: S_READY, walk: S_WALK, run: S_RUN, swing: [1, 0.12], width: 0.105 },
    ranged: { idle: S_GUN, swing: [1, 0.35], width: 0.1 },
    none: { idle: { spine: [1, 0, 0] }, width: 0.1 },
    case: { idle: { spine: [1, 0, 0] }, swing: [0.25, 1], width: 0.1 },
  },
};
