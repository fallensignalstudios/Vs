/**
 * Generic moveset — everything any humanoid can do: carry stances, firearms, reactions, falls and the shared
 * narrative vocabulary (see ./narrative.ts). Archetype movesets inherit from this and override what differs.
 */
import type { Moveset } from '../anim/moveset';
import type { ClipSpec, PoseSpec } from '../anim/clip';
import { NARRATIVE } from './narrative';

/** Rifle at low ready across the body. */
export const G_RIFLE: PoseSpec = {
  spine: [3, -4, 0], chest: [2, -6, 0], neck: [0, 4, 0], head: [-2, 6, 0],
  armR: { p: [0.13, -0.1, 0.1], barrel: [-0.45, -0.22, 0.87], up: [0.1, 0.95, 0.3], pole: [0.8, -0.5, -0.4] },
  armL: { sh: [30, 10, 0], el: 50 },
  grip: 1,
};

const G_RIFLE_RUN: PoseSpec = {
  armR: { p: [0.14, -0.06, 0.12], barrel: [-0.6, 0.25, 0.76], up: [0.3, 0.9, 0.3], pole: [0.8, -0.5, -0.4] },
};

/** Sidearm held low. */
export const G_PISTOL: PoseSpec = {
  spine: [2, 0, 0],
  armR: { p: [0.2, -0.27, 0.25], barrel: [-0.04, -0.55, 0.83], up: [0, 0.83, 0.55], pole: [0.7, -0.6, -0.3] },
};

/** Two-handed pistol presentation, square to the target. */
const AIM_POSE: PoseSpec = {
  spine: [4, 0, 0], chest: [3, 0, 0], neck: [-3, 0, 0], head: [-3, 0, 2],
  armR: { p: [0.06, 0.27, 0.5], barrel: [0, 0.122, 0.992], up: [0, 0.992, -0.122], pole: [0.7, -0.7, -0.1] },
  armL: { p: [0.0, 0.225, 0.47], fingers: [0.55, 0.2, 0.8], palm: [0.85, 0, -0.5], pole: [-0.6, -0.75, -0.1], fist: 0.9 },
  grip: 0,
};

const aim: ClipSpec = {
  duration: 2.6, loop: true, upperOnly: true, fadeIn: 0.14,
  keys: [{ t: 0, ...AIM_POSE }, { t: 0.5, armR: { p: [0.06, 0.273, 0.5] }, armL: { p: [0.0, 0.228, 0.47] } }],
};

/** Rifle shouldered, body bladed, cheek on the stock. */
const AIM_RIFLE_POSE: PoseSpec = {
  hipsR: [2, -14, 0], spine: [4, -4, 0], chest: [3, -8, 0], neck: [4, 12, 6], head: [5, 13, 11],
  clavR: [8, 6],
  armR: { p: [0.1, 0.22, 0.3], barrel: [-0.42, 0.11, 0.9], up: [0, 0.99, -0.12], pole: [0.95, -0.25, -0.15] },
  armL: { sh: [30, 10, 0], el: 50 },
  grip: 1,
};

const aimRifle: ClipSpec = {
  duration: 2.8, loop: true, upperOnly: true, fadeIn: 0.14,
  keys: [{ t: 0, ...AIM_RIFLE_POSE }, { t: 0.5, armR: { p: [0.1, 0.223, 0.3] } }],
};

const shoot: ClipSpec = {
  duration: 0.34, upperOnly: true, base: AIM_POSE, fadeIn: 0.03, fadeOut: 0.14,
  keys: [
    { t: 0 },
    { t: 0.16, ease: 'out', chest: [0, 0, 0], head: [-1, 0, 2], armR: { p: [0.06, 0.33, 0.43], barrel: [0, 0.3, 0.95], up: [0, 0.95, -0.3] }, armL: { p: [0.0, 0.28, 0.41] } },
    { t: 0.5, ease: 'inOut', armR: { p: [0.06, 0.28, 0.49], barrel: [0, 0.05, 1], up: [0, 1, -0.05] }, armL: { p: [0.0, 0.235, 0.46] } },
    { t: 1, ease: 'inOut', ...AIM_POSE },
  ],
  events: [[0.03, 'release']],
};

const shootRifle: ClipSpec = {
  duration: 0.3, upperOnly: true, base: AIM_RIFLE_POSE, fadeIn: 0.03, fadeOut: 0.12,
  keys: [
    { t: 0 },
    { t: 0.18, ease: 'out', chest: [1, -9, 0], armR: { p: [0.108, 0.232, 0.268], barrel: [-0.42, 0.17, 0.9], up: [0, 0.98, -0.18] } },
    { t: 1, ease: 'inOut', ...AIM_RIFLE_POSE },
  ],
  events: [[0.03, 'release']],
};

/** Unarmed / improvised strike (rifle butt, fist): generic light attack. */
const strike: ClipSpec = {
  duration: 0.6, fadeIn: 0.06,
  keys: [
    { t: 0 },
    { t: 0.28, ease: 'out', hipsR: [0, -24, 0], chest: [-2, -18, 0], neck: [0, 18, 0], head: [0, 20, 0], armR: { sh: [-30, 30, 0], el: 110, fist: 1 }, armL: { sh: [40, 14, 10], el: 80, fist: 1 },
      legL: { p: [-0.12, 0, 0.14] }, legR: { p: [0.14, 0, -0.16], yaw: 30 } },
    { t: 0.46, ease: 'in', hips: [0, -0.05, 0.1], hipsR: [4, 16, 0], spine: [6, 8, 0], chest: [4, 16, 0], neck: [0, -14, 0], head: [-2, -16, 0], armR: { sh: [82, 6, 20], el: 18, fist: 1 }, armL: { sh: [-10, 20, 0], el: 90, fist: 1 },
      legL: { p: [-0.12, 0, 0.3], yaw: 0 }, legR: { p: [0.14, 0, -0.22], pitch: -24, yaw: 26 } },
    { t: 0.66, ease: 'out' },
    { t: 1, ease: 'inOut', hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], armR: { sh: [2, 6, 0], el: 14, fist: 0.3 }, armL: { sh: [2, 6, 0], el: 14, fist: 0.3 },
      legL: { p: [-0.115, 0, 0], yaw: 8, pitch: 0 }, legR: { p: [0.115, 0, 0], yaw: 8, pitch: 0 } },
  ],
  events: [[0.46, 'hit']],
};

const dodge: ClipSpec = {
  duration: 0.45, fadeIn: 0.04, fadeOut: 0.14,
  keys: [
    { t: 0 },
    { t: 0.32, ease: 'out', hips: [0, -0.34, 0.08], hipsR: [24, 0, 0], spine: [20, 0, 0], chest: [12, 0, 0], neck: [-16, 0, 0], head: [-18, 0, 0],
      armL: { sh: [40, 16, 20], el: 95 }, armR: { sh: [30, 16, 20], el: 95 }, legL: { p: [-0.12, 0, 0.28], yaw: 0 }, legR: { p: [0.14, 0, -0.34], pitch: -40, yaw: 16 } },
    { t: 0.68, ease: 'inOut', hips: [0, -0.28, 0.05] },
    { t: 1, ease: 'inOut', hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
      armL: { sh: [2, 6, 0], el: 14 }, armR: { sh: [2, 6, 0], el: 14 }, legL: { p: [-0.115, 0, 0], yaw: 8 }, legR: { p: [0.115, 0, 0], yaw: 8, pitch: 0 } },
  ],
  events: [[0.1, 'step']],
};

const NEUTRAL: PoseSpec = {
  hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  armL: { sh: [2, 6, 0], el: 14 }, armR: { sh: [2, 6, 0], el: 14 }, legL: { p: [-0.115, 0, 0], yaw: 8, pitch: 0, air: false }, legR: { p: [0.115, 0, 0], yaw: 8, pitch: 0, air: false },
};

/**
 * Directional dodges built on a stance: a back-skip and a side-step to either flank (the forward dive is authored
 * per archetype). `arms` is what the arms do while the body goes — tuck the weapon, keep the shield in.
 * play('dodge', { dir }) picks among them.
 */
export function dodgeVariants(base: PoseSpec | undefined, arms: PoseSpec = {}): Record<string, ClipSpec> {
  const home = base ?? NEUTRAL;
  const side = (s: number): ClipSpec => ({
    duration: 0.45, base, fadeIn: 0.04, fadeOut: 0.14,
    keys: [
      { t: 0 },
      // push off the trailing foot, the leading leg reaches for the floor a long step away
      { t: 0.3, ease: 'out', hips: [s * 0.14, -0.3, 0], hipsR: [12, s * -8, s * 14], spine: [12, 0, s * 10], chest: [8, s * 6, s * 6], neck: [-8, s * -10, s * -8], head: [-8, s * -14, s * -8], ...arms,
        legL: s < 0 ? { p: [-0.42, 0.07, 0.02], yaw: 20, pitch: 10, air: true } : { p: [-0.02, 0, 0], yaw: 6, pitch: -34, air: false },
        legR: s < 0 ? { p: [0.02, 0, 0], yaw: 6, pitch: -34, air: false } : { p: [0.42, 0.07, 0.02], yaw: 20, pitch: 10, air: true } },
      { t: 0.66, ease: 'inOut', hips: [s * 0.2, -0.26, 0], hipsR: [10, 0, s * 6],
        legL: s < 0 ? { p: [-0.36, 0, 0.02], yaw: 16, pitch: 0, air: false } : { p: [0.1, 0.06, 0], yaw: 6, pitch: -10, air: true },
        legR: s < 0 ? { p: [-0.1, 0.06, 0], yaw: 6, pitch: -10, air: true } : { p: [0.36, 0, 0.02], yaw: 16, pitch: 0, air: false } },
      { t: 1, ease: 'inOut', ...home },
    ],
    events: [[0.08, 'step'], [0.66, 'step']],
  });
  const back: ClipSpec = {
    duration: 0.45, base, fadeIn: 0.04, fadeOut: 0.14,
    keys: [
      { t: 0 },
      // weight drops back off the front foot, the rear leg reaches behind
      { t: 0.3, ease: 'out', hips: [0, -0.26, -0.12], hipsR: [-6, 0, 0], spine: [14, 0, 0], chest: [10, 0, 0], neck: [-10, 0, 0], head: [-10, 0, 0], ...arms,
        legL: { p: [-0.12, 0, 0.34], yaw: 4, pitch: 14, air: false }, legR: { p: [0.15, 0.08, -0.34], yaw: 14, pitch: -20, air: true } },
      { t: 0.66, ease: 'inOut', hips: [0, -0.24, -0.1], hipsR: [4, 0, 0],
        legL: { p: [-0.12, 0.06, 0.1], yaw: 4, pitch: -16, air: true }, legR: { p: [0.15, 0, -0.38], yaw: 20, pitch: 0, air: false } },
      { t: 1, ease: 'inOut', ...home },
    ],
    events: [[0.08, 'step'], [0.66, 'step']],
  };
  return { dodgeBack: back, dodgeLeft: side(-1), dodgeRight: side(1) };
}

/** Guard without a real guard tool: forearms up. */
const guard: ClipSpec = {
  duration: 2, loop: true, upperOnly: true,
  keys: [
    { t: 0, spine: [8, 0, 0], chest: [6, 0, 0], neck: [-6, 0, 0], head: [-4, 0, 0], armL: { sh: [62, 12, 26], el: 118, fist: 1 }, armR: { sh: [58, 14, 26], el: 122, fist: 1 } },
    { t: 0.5, armL: { sh: [63, 12, 26], el: 117 } },
  ],
};

const stagger: ClipSpec = {
  duration: 0.7, fadeIn: 0.05, fadeOut: 0.24,
  keys: [
    { t: 0 },
    { t: 0.22, ease: 'out', hips: [0.02, -0.07, -0.14], hipsR: [-10, 8, 4], spine: [-14, 4, 6], chest: [-10, 10, 0], neck: [8, -6, 0], head: [12, -8, 4],
      armL: { sh: [-10, 46, 0], el: 46, fk: true, fist: 0.2 }, armR: { sh: [16, 36, 0], el: 40, fk: true }, grip: 0,
      legL: { p: [-0.13, 0, 0.06], yaw: 10 }, legR: { p: [0.16, 0, -0.34], yaw: 26, pitch: -12 } },
    { t: 0.55, ease: 'inOut', hips: [0.01, -0.1, -0.16], hipsR: [4, 4, 0], spine: [6, 2, 2], chest: [4, 4, 0], neck: [0, 0, 0], head: [2, 0, 0], armL: { sh: [10, 24, 0], el: 50 }, armR: { sh: [10, 20, 0], el: 46 } },
    { t: 1, ease: 'inOut', hips: [0, -0.04, -0.14], hipsR: [0, 0, 0], spine: [2, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], armL: { sh: [2, 8, 0], el: 20 }, armR: { sh: [2, 8, 0], el: 20 },
      legL: { p: [-0.12, 0, -0.1], yaw: 8 }, legR: { p: [0.13, 0, -0.2], yaw: 12, pitch: 0 } },
  ],
};

const guardBreak: ClipSpec = {
  duration: 0.9, fadeIn: 0.05, fadeOut: 0.26,
  keys: [
    { t: 0 },
    { t: 0.2, ease: 'out', hips: [0, -0.05, -0.16], hipsR: [-12, -6, 0], spine: [-16, 0, 0], chest: [-12, 6, 0], neck: [8, 0, 0], head: [12, 0, 0],
      armL: { sh: [20, 70, 0], el: 30, fk: true, fist: 0.1 }, armR: { sh: [20, 66, 0], el: 30, fk: true }, grip: 0,
      legL: { p: [-0.14, 0, 0.08] }, legR: { p: [0.17, 0, -0.36], yaw: 26 } },
    { t: 0.62, ease: 'inOut', hips: [0, -0.12, -0.18], spine: [4, 0, 0], chest: [2, 0, 0], head: [4, 0, 0], armL: { sh: [14, 30, 0], el: 60 }, armR: { sh: [14, 30, 0], el: 60 } },
    { t: 1, ease: 'inOut', hips: [0, -0.04, -0.16], spine: [2, 0, 0], armL: { sh: [2, 8, 0], el: 20 }, armR: { sh: [2, 8, 0], el: 20 }, legL: { p: [-0.12, 0, -0.12], yaw: 8 }, legR: { p: [0.13, 0, -0.22], yaw: 12 } },
  ],
};

/** Supine on the floor (shared end pose of knockdown / lieInjured). */
export const LYING: PoseSpec = {
  hips: [0, -0.85, -0.32], hipsR: [-86, 0, 0], spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [6, 0, 0], head: [6, 10, 0],
  armL: { sh: [-6, 38, 0], el: 26, fk: true, fist: 0.2 },
  // root space: the right hand rests on the floor beside the hip, whatever it holds lying flat and pointing away
  armR: { p: [0.5, 0.05, -0.18], blade: [0.35, 0.02, 0.94], edge: [0.94, 0, -0.35], pole: [0.9, 0.2, 0.3], fist: 0.2 }, grip: 0,
  legL: { p: [-0.16, 0.02, 0.5], pitch: 62, yaw: 22, air: true, knee: [-0.3, 0.9, 0.3] },
  legR: { p: [0.13, 0.03, 0.42], pitch: 56, yaw: 14, air: true, knee: [0.2, 0.95, 0.2] },
};

const knockdown: ClipSpec = {
  duration: 1.0, hold: true, fadeIn: 0.06, thaw: true, seat: 0.02, space: { R: 'root' },
  keys: [
    { t: 0 },
    { t: 0.22, ease: 'out', hips: [0, -0.12, -0.2], hipsR: [-28, 0, 0], spine: [-14, 0, 0], chest: [-8, 0, 0], neck: [12, 0, 0], head: [14, 0, 0],
      armL: { sh: [40, 50, 0], el: 30, fk: true, fist: 0.1 }, armR: { sh: [40, 46, 0], el: 30, fk: true }, grip: 0,
      legL: { p: [-0.13, 0.12, 0.2], pitch: 20, air: true }, legR: { p: [0.14, 0, -0.1], yaw: 16 } },
    { t: 0.52, ease: 'in', hips: [0, -0.74, -0.34], hipsR: [-70, 0, 0], spine: [8, 0, 0], chest: [6, 0, 0], neck: [14, 0, 0], head: [16, 0, 0],
      armL: { sh: [10, 60, 0], el: 20 }, armR: { sh: [10, 56, 0], el: 20 },
      legL: { p: [-0.16, 0.26, 0.42], pitch: 40, yaw: 20, air: true, knee: [-0.2, 0.9, 0.4] }, legR: { p: [0.14, 0.2, 0.36], pitch: 40, air: true, knee: [0.2, 0.9, 0.4] } },
    // bounce and settle
    { t: 0.66, ease: 'out', ...LYING, hips: [0, -0.83, -0.33] },
    { t: 1, ease: 'inOut', ...LYING },
  ],
  events: [[0.56, 'impact']],
};

const getUp: ClipSpec = {
  duration: 1.2, base: LYING, fadeIn: 0.1, fadeOut: 0.3, space: { R: 'root' },
  keys: [
    { t: 0 },
    // roll up to sitting, one hand planted
    { t: 0.3, ease: 'inOut', hips: [0, -0.78, -0.2], hipsR: [-30, 10, 0], spine: [14, 0, 0], chest: [10, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0],
      armL: { sh: [-50, 30, 0], el: 20 }, armR: { sh: [30, 20, 0], el: 60, fk: true },
      legL: { p: [-0.18, 0, 0.3], pitch: 0, yaw: 20, air: false, knee: [-0.3, 0.9, 0.3] }, legR: { p: [0.15, 0.02, 0.44], pitch: 40, air: true } },
    // onto one knee
    { t: 0.62, ease: 'inOut', hips: [0, -0.46, 0], hipsR: [14, 0, 0], spine: [16, 0, 0], chest: [8, 0, 0], neck: [-8, 0, 0], head: [-8, 0, 0],
      armL: { sh: [30, 14, 0], el: 50 }, armR: { sh: [36, 10, 0], el: 60 },
      legL: { p: [-0.13, 0, 0.26], pitch: 0, yaw: 6, air: false, knee: [-0.1, 0.3, 1] }, legR: { p: [0.13, 0.06, -0.38], pitch: -78, yaw: 6, air: true, knee: [0.1, -0.8, 0.6] } },
    { t: 1, ease: 'inOut', hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
      armL: { sh: [2, 6, 0], el: 14 }, armR: { sh: [2, 6, 0], el: 14 }, legL: { p: [-0.115, 0, 0], yaw: 8, knee: [-0.1, 0.05, 1] }, legR: { p: [0.115, 0, 0], pitch: 0, yaw: 8, air: false, knee: [0.1, 0.05, 1] } },
  ],
};

const death: ClipSpec = {
  duration: 1.5, hold: true, fadeIn: 0.08, sticky: true, thaw: true, dropAt: 0.4, seat: 0.02,
  keys: [
    { t: 0 },
    // the hit takes the breath: stagger back
    { t: 0.16, ease: 'out', hips: [0.03, -0.06, -0.12], hipsR: [-10, 10, 4], spine: [-12, 4, 6], chest: [-10, 12, 0], neck: [8, 0, 0], head: [14, -8, 6],
      armL: { sh: [-10, 40, 0], el: 40, fk: true, fist: 0.15 }, armR: { sh: [10, 34, 0], el: 36, fk: true }, grip: 0,
      legL: { p: [-0.13, 0, 0.04] }, legR: { p: [0.16, 0, -0.26], yaw: 24 } },
    // knees go
    { t: 0.46, ease: 'in', hips: [0.02, -0.5, -0.08], hipsR: [8, 6, 4], spine: [18, 0, 6], chest: [14, 0, 4], neck: [10, 0, 0], head: [16, 0, 8],
      armL: { sh: [10, 16, 0], el: 20 }, armR: { sh: [14, 14, 0], el: 24 },
      legL: { p: [-0.14, 0.05, -0.3], pitch: -76, air: true, knee: [-0.1, -0.7, 0.7] }, legR: { p: [0.15, 0.05, -0.36], pitch: -76, yaw: 10, air: true, knee: [0.1, -0.7, 0.7] } },
    // topple forward onto the left side
    { t: 0.74, ease: 'in', hips: [-0.06, -0.78, 0.12], hipsR: [72, 26, -34], spine: [6, 10, 0], chest: [4, 12, 0], neck: [-10, 20, 0], head: [-10, 30, 0],
      armL: { sh: [78, 34, 0], el: 70 }, armR: { sh: [50, 24, 10], el: 64 },
      legL: { p: [-0.2, 0.04, -0.62], pitch: -80, yaw: 30, air: true, knee: [-0.6, -0.3, 0.3] }, legR: { p: [0.02, 0.1, -0.56], pitch: -70, yaw: -20, air: true, knee: [-0.4, 0.2, 0.6] } },
    { t: 0.86, ease: 'out', hips: [-0.06, -0.81, 0.13], hipsR: [80, 28, -40] },
    { t: 1, ease: 'inOut', hips: [-0.06, -0.82, 0.13] },
  ],
  events: [[0.48, 'impact'], [0.76, 'impact']],
};

const roar: ClipSpec = {
  duration: 1.2, fadeIn: 0.1,
  keys: [
    { t: 0 },
    { t: 0.25, ease: 'out', hips: [0, -0.1, 0], spine: [14, 0, 0], chest: [10, 0, 0], head: [-4, 0, 0], armL: { sh: [10, 30, 0], el: 80, fk: true, fist: 1 }, armR: { sh: [10, 30, 0], el: 80, fk: true, fist: 1 } },
    { t: 0.5, ease: 'inOut', hips: [0, 0, -0.03], spine: [-12, 0, 0], chest: [-12, 0, 0], neck: [10, 0, 0], head: [16, 0, 0], armL: { sh: [-20, 50, -10], el: 60, fist: 0.1 }, armR: { sh: [-20, 50, -10], el: 60, fist: 0.1 } },
    { t: 0.8, ease: 'inOut', spine: [-10, 0, 0] },
    { t: 1, ease: 'inOut', hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], armL: { sh: [2, 6, 0], el: 14, fist: 0.3 }, armR: { sh: [2, 6, 0], el: 14, fist: 0.3 } },
  ],
  events: [[0.45, 'hit']],
};

export const GENERIC: Moveset = {
  name: 'generic',
  clips: {
    ...NARRATIVE,
    aim, aimRifle, shoot, attackLight1: strike, dodge, guard, stagger, guardBreak, knockdown, getUp, death, roar,
    shootRifle,
    ...dodgeVariants(undefined, { armL: { sh: [40, 16, 20], el: 95 }, armR: { sh: [30, 16, 20], el: 95 } }),
  },
  alias: {
    attackLight2: 'attackLight1', attackLight3: 'attackLight1', attackLight4: 'attackLight1', attackHeavy: 'attackLight1', attackHeavyCharge: 'guard',
    counter: 'attackLight1', parry: 'guard', deflect: 'guard', lunge: 'attackLight1', batonStrike: 'attackLight1', shieldBash: 'attackLight1',
    slam: 'attackLight1', throw: 'point', dispatch: 'attackLight1', spawnBreach: 'getUp', spawnDrop: 'getUp', linkedSync: 'listen',
    pounce: 'attackLight1', leap: 'dodge', sweep: 'attackLight1', groundSlam: 'attackLight1', charge: 'attackLight1',
    weave: 'holdPlane', pulse: 'roar', exposeJoint: 'stagger', fracture: 'stagger', floorStrike: 'kneel', tetherStop: 'holdPlane',
    ceilingCling: 'cower', hover: 'listen', lowerWeapon: 'listen', raiseWeapon: 'nod',
  },
  stances: {
    none: { idle: {} },
    ranged: { idle: G_PISTOL, swing: [1, 0.35] },
    case: { idle: {}, swing: [0.25, 1] },
  },
};

/** Moveset for rifle carriers: long-gun stances, `aim` / `shoot` use the shouldered poses. */
export const RIFLE_MOVES: Moveset = {
  name: 'rifle',
  parent: GENERIC,
  clips: { aim: aimRifle, shoot: shootRifle },
  stances: {
    ranged: { idle: G_RIFLE, run: G_RIFLE_RUN, swing: [0.2, 0.15] },
  },
};
