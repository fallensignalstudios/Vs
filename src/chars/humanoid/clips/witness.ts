/** The Witness — a recorded presence. Unhurried, open-handed; never a combat gesture. */
import type { Moveset } from '../anim/moveset';
import type { ClipSpec, PoseSpec } from '../anim/clip';
import { GENERIC } from './generic';

/** Arms a little away from the body, palms turned forward. */
const W_STAND: PoseSpec = {
  spine: [-1, 0, 0], chest: [-2, 0, 0], head: [-2, 0, 0],
  armL: { sh: [4, 14, -50], el: 14, wr: [0, 0, -20], fist: 0 }, armR: { sh: [4, 14, -50], el: 14, wr: [0, 0, -20], fist: 0 },
  legL: { p: [-0.09, 0, 0], yaw: 4 }, legR: { p: [0.09, 0, 0], yaw: 4 },
};

const talk: ClipSpec = {
  duration: 6, base: W_STAND, loop: true, upperOnly: true, fadeIn: 0.8,
  keys: [
    { t: 0 },
    { t: 0.3, chest: [-2, 3, 0], head: [-3, -2, 0], armR: { p: [0.22, -0.1, 0.34], fingers: [0.1, 0.3, 0.95], palm: [0, 0.95, -0.3], fist: 0, pole: [0.8, -0.6, -0.1] } },
    { t: 0.62, chest: [-2, -2, 0], head: [0, 2, 0], armL: { p: [-0.22, -0.12, 0.32], fingers: [-0.1, 0.3, 0.95], palm: [0, 0.95, -0.3], fist: 0, pole: [-0.8, -0.6, -0.1] } },
    { t: 0.86, armR: { sh: [4, 14, -50], el: 14, fk: true }, armL: { p: [-0.2, -0.16, 0.3] } },
  ],
};

/** The five-fold gesture: both arms open and rise, held. */
const assent: ClipSpec = {
  duration: 3, base: W_STAND, hold: true, upperOnly: true, fadeIn: 0.8,
  keys: [
    { t: 0 },
    { t: 1, ease: 'inOut', spine: [-3, 0, 0], chest: [-5, 0, 0], neck: [-3, 0, 0], head: [-6, 0, 0],
      armL: { p: [-0.36, 0.14, 0.26], fingers: [-0.3, 0.9, 0.3], palm: [0.2, 0.2, 0.95], fist: 0, pole: [-0.7, -0.7, -0.1] },
      armR: { p: [0.36, 0.14, 0.26], fingers: [0.3, 0.9, 0.3], palm: [-0.2, 0.2, 0.95], fist: 0, pole: [0.7, -0.7, -0.1] } },
  ],
  events: [[0.8, 'hit']],
};

const point: ClipSpec = {
  duration: 3, base: W_STAND, upperOnly: true, fadeIn: 0.6, fadeOut: 0.8,
  keys: [
    { t: 0 },
    { t: 0.35, ease: 'inOut', chest: [-2, 6, 0], head: [-2, -4, 0], armR: { p: [0.2, 0.1, 0.5], fingers: [0.05, 0, 1], palm: [0, -1, 0], fist: 0, pole: [0.7, -0.7, -0.1] } },
    { t: 0.75, ease: 'inOut', armR: { p: [0.2, 0.105, 0.505] } },
    { t: 1, ease: 'inOut', ...W_STAND },
  ],
  events: [[0.35, 'hit']],
};

export const WITNESS_MOVES: Moveset = {
  name: 'witness',
  parent: GENERIC,
  clips: { talk, assent, point },
  alias: { holdPlane: 'assent', handOver: 'point', interact: 'point', attackLight1: 'point', attackHeavy: 'point', lunge: 'point', shoot: 'point', guard: 'assent', death: 'kneel' },
  stances: { none: { idle: W_STAND, swing: [0.2, 0.2], width: 0.09 } },
};
