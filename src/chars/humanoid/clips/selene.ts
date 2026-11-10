/**
 * Selene — Verity, the ring-hilted double blade. Fast and rotational: the weapon keeps turning from one strike
 * into the next, so alternate hits land with alternate blades. Lights 0.34 / 0.34 / 0.38 / 0.45 s, spinning
 * heavy 0.7 s, dodge 0.45 s.
 *
 * Grip: her fist sits INSIDE the hilt ring, so the blade line is always near perpendicular to the forearm (the
 * solver's ring grip enforces it and aligns the wrist) and cuts are made by turning the body and rolling the
 * forearm, never by pointing the weapon along the arm. `blade` is the direction of the FORWARD blade in chest
 * space; the rear blade points the opposite way. Every key below was searched numerically for ≥ 6 cm clearance
 * of BOTH blades from her own arms, torso, head and legs (shots/humanoid-fix/probe/opt.probe.ts).
 */
import type { Moveset } from '../anim/moveset';
import type { ClipSpec, PoseSpec } from '../anim/clip';
import { GENERIC, dodgeVariants } from './generic';

/** Ready: bladed, weight low; Verity carried level beside the right hip, forward blade leading. */
export const S_READY: PoseSpec = {
  hips: [0, -0.04, 0], hipsR: [2, -18, 0],
  spine: [4, -2, 0], chest: [2, -4, 0], neck: [-2, 10, 0], head: [-3, 14, 0],
  armR: { p: [0.34, -0.33, 0.13], blade: [-0.53, 0.24, 0.82], pole: [0.75, -0.5, -0.45] },
  armL: { sh: [14, 12, 6], el: 48, fist: 0.35 },
  legL: { p: [-0.1, 0, 0.17], yaw: 2, pitch: 0, air: false },
  legR: { p: [0.15, 0, -0.17], yaw: 34, pitch: 0, air: false },
};

const S_WALK: PoseSpec = {
  hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [2, 0, 0], chest: [1, 0, 0], neck: [0, 0, 0], head: [-1, 0, 0],
  armR: { p: [0.4, -0.33, 0.01], blade: [-0.18, 0.1, 0.98], pole: [0.75, -0.5, -0.45] },
  armL: { sh: [2, 7, 0], el: 16 },
};

/** Running: the staff-length weapon trails level, well outside the pumping thigh. */
const S_RUN: PoseSpec = {
  armR: { p: [0.36, -0.33, 0.01], blade: [-0.02, -0.4, 0.92], pole: [0.75, -0.5, -0.45] },
};

const S_GUN: PoseSpec = {
  spine: [2, 0, 0],
  armR: { p: [0.19, -0.26, 0.24], barrel: [-0.04, -0.55, 0.83], up: [0, 0.83, 0.55], pole: [0.7, -0.6, -0.3] },
};

/** off arm thrown back as a counterweight, clear of the wheel of the blades */
const BACK: PoseSpec['armL'] = { sh: [-24, 26, 0], el: 40 };
const LUNGE: PoseSpec = { legL: { p: [-0.1, 0, 0.3], yaw: 0 }, legR: { p: [0.15, 0, -0.22], pitch: -24, yaw: 28 } };

/** end pose of a descending cut: forward blade low on the left, rear blade high behind the right shoulder */
const CUT_LOW: PoseSpec = {
  hips: [-0.01, -0.07, 0.1], hipsR: [3, 14, 0], spine: [6, 8, 0], chest: [4, 26, 0], neck: [-2, -18, 0], head: [-3, -24, 0],
  armR: { p: [0.46, -0.33, 0.19], blade: [-0.17, -0.06, 0.98] }, armL: BACK, ...LUNGE,
};
/** the weapon upright beside her, forward blade down: where the wheel passes on its way back to ready */
const UPRIGHT: PoseSpec['armR'] = { p: [0.46, -0.06, -0.05], blade: [-0.22, -0.97, -0.09] };
/** recovery: the wheel is brought forward and down the right side, clear of the lead leg, before settling */
const RECOVER: PoseSpec = {
  hips: [0, -0.05, 0.02], hipsR: [2, -12, 0], spine: [5, 0, 0], chest: [3, 0, 0], neck: [-2, 6, 0], head: [-3, 8, 0],
  armR: { p: [0.34, 0.12, 0.37], blade: [-0.26, -0.88, 0.39] }, legL: { p: [-0.1, 0, 0.2], yaw: 2 }, legR: { p: [0.15, 0, -0.19], pitch: 0, yaw: 32 },
};

/** The wheel starts: the forward blade lifts, cocks high over the right shoulder and falls through the target. */
const light1: ClipSpec = {
  duration: 0.34, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0 },
    { t: 0.1, ease: 'linear', hipsR: [2, -22, 0], chest: [1, -9, 0], armR: { p: [0.34, -0.06, 0.19], blade: [-0.41, 0.79, 0.45] }, armL: BACK },
    { t: 0.2, ease: 'out', hipsR: [2, -26, 0], chest: [0, -14, 0], neck: [0, 16, 0], head: [-2, 22, 0],
      armR: { p: [0.4, 0.03, 0.13], blade: [0.1, 0.98, 0.19] } },
    { t: 0.42, ease: 'in', hips: [-0.01, -0.07, 0.1], hipsR: [3, 6, 0], spine: [6, 8, 0], chest: [4, 14, 0], neck: [-2, -10, 0], head: [-3, -14, 0],
      armR: { p: [0.46, -0.24, 0.31], blade: [0.07, 0.58, 0.81] }, ...LUNGE },
    { t: 0.66, ease: 'out', ...CUT_LOW },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.42, 'hit']],
};

/** light2's finish: the rear blade low ahead on the left, the forward blade trailing level behind the right hip */
const SWEPT: PoseSpec['armR'] = { p: [0.28, -0.42, 0.13], blade: [0.03, -0.02, -1] };

/** The same turn carries the REAR blade up, over and down the same line. */
const light2: ClipSpec = {
  duration: 0.34, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    // enters from light1's follow-through
    { t: 0, ...CUT_LOW },
    { t: 0.2, ease: 'out', hips: [-0.01, -0.06, 0.08], hipsR: [3, 4, 0], spine: [5, 2, 0], chest: [3, 0, 0], neck: [-2, 0, 0], head: [-3, 0, 0],
      armR: { p: [0.46, 0.12, 0.07], blade: [-0.09, -0.83, 0.54] } },
    { t: 0.31, ease: 'linear', hips: [0, -0.065, 0.1], hipsR: [3, 6, 0], spine: [5, 5, 0], chest: [3, 7, 0], neck: [-2, -5, 0], head: [-3, -7, 0],
      armR: { p: [0.46, 0.03, 0.19], blade: [-0.03, -0.99, -0.11] } },
    { t: 0.42, ease: 'linear', hips: [0, -0.07, 0.12], hipsR: [3, 8, 0], spine: [6, 8, 0], chest: [4, 14, 0], neck: [-2, -10, 0], head: [-3, -14, 0],
      armR: { p: [0.46, -0.24, 0.31], blade: [0.03, -0.61, -0.79] } },
    { t: 0.66, ease: 'out', hipsR: [3, 14, 0], chest: [4, 26, 0], neck: [-2, -18, 0], head: [-3, -24, 0], armR: SWEPT },
    { t: 0.8, ease: 'inOut', hips: [0, -0.04, 0.06], hipsR: [0, 4, 0], spine: [2, 4, 0], chest: [0, 10, 0], neck: [0, -4, 0], head: [0, -6, 0], armR: UPRIGHT,
      legL: { p: [-0.1, 0, 0.26], yaw: 0 }, legR: { p: [0.15, 0, -0.2], pitch: -12, yaw: 28 } },
    { t: 0.9, ease: 'inOut', ...RECOVER },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.42, 'hit']],
};

/** Reverse: the low blade scoops back UP through the target — a rising cut out of light2's finish. */
const light3: ClipSpec = {
  duration: 0.38, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0, hips: [0, -0.07, 0.12], hipsR: [3, 14, 0], spine: [6, 8, 0], chest: [4, 26, 0], neck: [-2, -18, 0], head: [-3, -24, 0],
      armR: SWEPT, armL: BACK, ...LUNGE },
    { t: 0.44, ease: 'in', hips: [0, -0.02, 0.1], hipsR: [-2, 8, 0], spine: [-2, 6, 0], chest: [-4, 12, 0], neck: [2, -8, 0], head: [4, -10, 0],
      armR: { p: [0.4, -0.33, 0.25], blade: [-0.03, -0.28, -0.96] },
      legL: { p: [-0.1, 0, 0.28], yaw: 0 }, legR: { p: [0.15, 0, -0.2], pitch: -30, yaw: 26 } },
    { t: 0.68, ease: 'out', chest: [-4, 20, 0], armR: UPRIGHT },
    { t: 0.86, ease: 'inOut', ...RECOVER },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.44, 'hit']],
};

/** Finisher: the wheel runs on backwards until the forward blade is high behind her, then the whole back brings it down. */
const light4: ClipSpec = {
  duration: 0.45, base: S_READY, fadeIn: 0.05, fadeOut: 0.2,
  keys: [
    { t: 0, hips: [0, -0.02, 0.1], hipsR: [-2, 8, 0], spine: [-2, 6, 0], chest: [-4, 20, 0], neck: [2, -8, 0], head: [4, -10, 0], armR: UPRIGHT, armL: BACK,
      legL: { p: [-0.1, 0, 0.28], yaw: 0 }, legR: { p: [0.15, 0, -0.2], pitch: -30, yaw: 26 } },
    { t: 0.12, ease: 'linear', hips: [0, 0, 0.02], hipsR: [-3, -4, 0], spine: [-5, 0, 0], chest: [-5, 4, 0], armR: { p: [0.4, 0.03, -0.05], blade: [0.25, -0.52, -0.81] }, armL: { sh: [10, 20, 0], el: 40 } },
    { t: 0.24, ease: 'out', hips: [0, 0.02, -0.04], hipsR: [-4, -12, 0], spine: [-8, -4, 0], chest: [-6, -8, 0], neck: [4, 6, 0], head: [6, 8, 0],
      armR: { p: [0.16, 0.3, 0.25], blade: [0.42, 0.91, 0.03] }, armL: { sh: [40, 16, 0], el: 30 }, legR: { p: [0.15, 0, -0.2], pitch: -10, yaw: 26 } },
    { t: 0.36, ease: 'in', hips: [0, -0.05, 0.06], hipsR: [3, -3, 0], spine: [3, 0, 0], chest: [2, 0, 0], neck: [-2, 0, 0], head: [-2, 0, 0],
      armR: { p: [0.28, 0.12, 0.43], blade: [-0.15, 0.99, 0.04] }, armL: { sh: [0, 24, 0], el: 26 },
      legL: { p: [-0.11, 0, 0.36], yaw: 0 }, legR: { p: [0.15, 0, -0.28], pitch: -30, yaw: 24 } },
    { t: 0.46, ease: 'linear', hips: [0, -0.14, 0.14], hipsR: [10, 6, 0], spine: [14, 4, 0], chest: [10, 8, 0], neck: [-8, -6, 0], head: [-10, -8, 0],
      armR: { p: [0.46, -0.15, 0.31], blade: [-0.13, 0.43, 0.89] }, armL: { sh: [-30, 30, 0], el: 20 } },
    { t: 0.66, ease: 'out', spine: [18, 6, 0], armR: { p: [0.46, -0.33, 0.25], blade: [-0.33, 0, 0.94] } },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.46, 'hit'], [0.5, 'impact']],
};

/** Verity held out at arm's length, square to the forearm: the pirouette carries both blades through the target. */
const SPIN_ARM: PoseSpec['armR'] = { p: [0.34, -0.15, 0.43], blade: [-0.53, 0.32, 0.79] };
const COIL_ARM: PoseSpec['armR'] = { p: [0.46, -0.24, 0.07], blade: [0.61, 0.42, 0.67] };

/** Spinning heavy: a full pirouette on the left foot — two sweeps in one turn. */
const heavy: ClipSpec = {
  duration: 0.7, base: S_READY, fadeIn: 0.05, fadeOut: 0.2, releaseAt: 0.17,
  keys: [
    { t: 0 },
    { t: 0.2, ease: 'out', hips: [0, -0.1, 0], hipsR: [4, 34, 0], spine: [4, 10, 0], chest: [2, 14, 0], neck: [0, -24, 0], head: [-2, -30, 0],
      armR: COIL_ARM, armL: { sh: [10, 40, 0], el: 30 },
      legL: { p: [-0.08, 0, 0.06], yaw: 14, pitch: -8 }, legR: { p: [0.2, 0, -0.14], yaw: 10, pitch: -20 } },
    { t: 0.4, ease: 'in', hips: [0, -0.07, 0.02], hipsR: [4, -90, 0], spine: [4, -8, 0], chest: [2, -10, 0], neck: [0, 30, 0], head: [-2, 40, 0],
      armR: SPIN_ARM, armL: { sh: [0, 60, 0], el: 20 },
      legL: { p: [-0.04, 0, 0.04], yaw: -60, pitch: -24 }, legR: { p: [-0.1, 0.1, -0.22], yaw: 90, pitch: -30, air: true } },
    { t: 0.6, ease: 'linear', hipsR: [4, -200, 0], neck: [0, 0, 0], head: [-2, 0, 0],
      legL: { p: [-0.04, 0, 0.04], yaw: -170, pitch: -24 }, legR: { p: [-0.16, 0.12, 0.16], yaw: 200, pitch: -30, air: true } },
    { t: 0.78, ease: 'out', hips: [0, -0.09, 0.04], hipsR: [4, -330, 0], neck: [0, -16, 0], head: [-2, -20, 0],
      armR: COIL_ARM,
      legL: { p: [-0.08, 0, 0.1], yaw: -330, pitch: -10 }, legR: { p: [0.2, 0, -0.04], yaw: 330, pitch: -10, air: false } },
    { t: 1, ease: 'inOut', ...S_READY, hipsR: [2, -378, 0] },
  ],
  events: [[0.36, 'hit'], [0.6, 'hit']],
};

const heavyCharge: ClipSpec = {
  duration: 0.8, base: S_READY, loop: true, fadeIn: 0.2, transient: true,
  keys: [
    { t: 0, hips: [0, -0.11, 0], hipsR: [4, 34, 0], spine: [4, 10, 0], chest: [2, 14, 0], neck: [0, -24, 0], head: [-2, -30, 0],
      armR: COIL_ARM, armL: { sh: [10, 40, 0], el: 30 },
      legL: { p: [-0.08, 0, 0.06], yaw: 14 }, legR: { p: [0.2, 0, -0.14], yaw: 10, pitch: -20 } },
    { t: 0.5, hips: [0, -0.125, 0] },
  ],
};

/** Guard: Verity upright-diagonal in front of her, one blade covering the head, the other the thigh. */
const GUARD_ARM: PoseSpec['armR'] = { p: [0.34, -0.06, 0.19], blade: [-0.12, 0.88, 0.46], pole: [0.75, -0.5, -0.45] };
const GUARD_OFF: PoseSpec['armL'] = { sh: [-10, 22, 0], el: 70, fist: 0.4 };

/** Deflect: the upright blade sweeps across her front and back like a shutter (the forearm rolls, the wrist stays square). */
const deflect: ClipSpec = {
  duration: 0.5, base: S_READY, upperOnly: true, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0, armR: GUARD_ARM, chest: [2, -6, 0], armL: GUARD_OFF },
    { t: 0.2, ease: 'linear', armR: { p: [0.22, -0.06, 0.25], blade: [-0.73, 0.69, 0] } },
    { t: 0.42, ease: 'linear', armR: { p: [0.22, -0.24, 0.43], blade: [-0.97, -0.24, -0.01] } },
    { t: 0.62, ease: 'linear', armR: { p: [0.22, -0.06, 0.25], blade: [-0.73, 0.69, 0] } },
    { t: 0.82, ease: 'out', armR: GUARD_ARM },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.2, 'hit']],
};

const guard: ClipSpec = {
  duration: 2.2, base: S_READY, loop: true, upperOnly: true, fadeIn: 0.1,
  keys: [
    { t: 0, spine: [4, -2, 0], chest: [3, -6, 0], neck: [-2, 6, 0], head: [-3, 8, 0], armR: GUARD_ARM, armL: GUARD_OFF },
    { t: 0.5, armR: { p: [0.34, -0.05, 0.195] } },
  ],
};

/** Counter after a timed deflect: the guard snaps round into a flat cut at throat height. */
const counter: ClipSpec = {
  duration: 0.4, base: S_READY, fadeIn: 0.04, fadeOut: 0.16,
  keys: [
    { t: 0, armR: GUARD_ARM, armL: GUARD_OFF },
    { t: 0.4, ease: 'in', hips: [0, -0.08, 0.14], hipsR: [5, 6, 0], spine: [8, 6, 0], chest: [4, 10, 0], neck: [-2, -8, 0], head: [-4, -8, 0],
      armR: { p: [0.46, -0.15, 0.37], blade: [-0.09, 0.74, 0.67] }, armL: { sh: [-30, 24, 0], el: 20 },
      legL: { p: [-0.1, 0, 0.36], yaw: 0 }, legR: { p: [0.15, 0, -0.26], pitch: -26, yaw: 26 } },
    { t: 0.64, ease: 'out', chest: [4, 18, 0] },
    { t: 1, ease: 'inOut', ...S_READY },
  ],
  events: [[0.4, 'hit']],
};

/** Dispatch: coil low, then a long flat passing cut (the driver relocates the actor at 'hit'). */
const dispatch: ClipSpec = {
  duration: 0.55, base: S_READY, fadeIn: 0.05, fadeOut: 0.2,
  keys: [
    { t: 0 },
    { t: 0.3, ease: 'out', hips: [0, -0.24, -0.06], hipsR: [14, -30, 0], spine: [12, -8, 0], chest: [6, -12, 0], neck: [-10, 20, 0], head: [-12, 26, 0],
      armR: { p: [0.34, -0.24, 0.19], blade: [-0.65, 0.43, 0.63] }, armL: { sh: [50, 10, 20], el: 60 },
      legL: { p: [-0.1, 0, 0.22], yaw: 0 }, legR: { p: [0.16, 0, -0.26], pitch: -30, yaw: 30 } },
    { t: 0.46, ease: 'in', hips: [0, -0.2, 0.2], hipsR: [16, 10, 0], spine: [14, 8, 0], chest: [8, 14, 0], neck: [-12, -10, 0], head: [-14, -12, 0],
      armR: { p: [0.4, -0.15, 0.25], blade: [0.19, 0.79, 0.58] }, armL: { sh: [-50, 24, 0], el: 10 },
      legL: { p: [-0.1, 0, 0.44], yaw: 0 }, legR: { p: [0.15, 0, -0.36], pitch: -40, yaw: 20 } },
    { t: 0.7, ease: 'out', chest: [8, 22, 0] },
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

const DODGE_ARM: PoseSpec['armR'] = { p: [0.4, -0.24, 0.07], blade: [-0.47, 0.59, 0.65] };

const dodge: ClipSpec = {
  duration: 0.45, base: S_READY, fadeIn: 0.04, fadeOut: 0.14,
  keys: [
    { t: 0 },
    // low slide: one knee folds, the other leg trails long; Verity sweeps back out of the way
    { t: 0.3, ease: 'out', hips: [0, -0.42, 0.06], hipsR: [20, -24, 0], spine: [18, -6, 0], chest: [12, -8, 0], neck: [-14, 14, 0], head: [-16, 18, 0],
      armR: DODGE_ARM, armL: { p: [-0.2, -0.36, 0.3], fingers: [0, -0.9, 0.4], palm: [0, -0.4, -0.9], fist: 0.1 },
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
      armR: { p: [0.34, -0.3, 0.0], blade: [-0.1, 0.1, 0.99] },
      legL: { p: [-0.1, 0, 0.3], yaw: 0 }, legR: { p: [0.18, 0, -0.3], yaw: 50 } },
    { t: 0.5, hips: [0, -0.13, -0.075], armL: { p: [-0.1, 0.125, 0.5] } },
  ],
};

/** Holding the coherent plane: both arms up, palms flat to an unseen pane, leaning into it. */
const holdPlane: ClipSpec = {
  duration: 2.4, loop: true, fadeIn: 0.3, emptyHands: true,
  keys: [
    { t: 0, hips: [0, -0.08, 0.04], hipsR: [6, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0],
      armL: { p: [-0.2, 0.2, 0.46], fingers: [-0.15, 0.95, 0.2], palm: [0, -0.2, 0.98], pole: [-0.7, -0.6, -0.2], fist: 0 },
      armR: { p: [0.2, 0.2, 0.46], fingers: [0.15, 0.95, 0.2], palm: [0, -0.2, 0.98], pole: [0.7, -0.6, -0.2], fist: 0 },
      legL: { p: [-0.14, 0, 0.22], yaw: 4 }, legR: { p: [0.15, 0, -0.24], yaw: 30, pitch: -12 } },
    { t: 0.5, hips: [0, -0.09, 0.03], armL: { p: [-0.2, 0.21, 0.45] }, armR: { p: [0.2, 0.195, 0.455] } },
  ],
};

const LOWERED: PoseSpec['armR'] = { p: [0.28, -0.42, 0.07], blade: [-0.07, -0.66, 0.75] };

const lowerWeapon: ClipSpec = {
  duration: 1, base: S_READY, hold: true, fadeIn: 0.3,
  keys: [
    { t: 0 },
    { t: 1, ease: 'inOut', hips: [0, 0, 0], hipsR: [0, -4, 0], spine: [1, 0, 0], chest: [0, 0, 0], neck: [0, 2, 0], head: [2, 2, 0],
      armR: LOWERED, armL: { sh: [2, 6, 0], el: 14 },
      legL: { p: [-0.11, 0, 0.05], yaw: 8 }, legR: { p: [0.12, 0, -0.03], yaw: 14 } },
  ],
};

const raiseWeapon: ClipSpec = {
  duration: 0.6, fadeIn: 0.2,
  base: { ...S_READY, armR: LOWERED },
  keys: [{ t: 0 }, { t: 1, ease: 'inOut', ...S_READY }],
};

export const SELENE_MOVES: Moveset = {
  name: 'selene',
  parent: GENERIC,
  clips: {
    attackLight1: light1, attackLight2: light2, attackLight3: light3, attackLight4: light4, attackHeavy: heavy, attackHeavyCharge: heavyCharge,
    deflect, guard, counter, dispatch, throw: throwClip, dodge, tetherStop, holdPlane, lowerWeapon, raiseWeapon,
    // side-steps carry Verity upright in her guard, out of the way of the reaching leg
    ...dodgeVariants(S_READY, { armR: DODGE_ARM, armL: { sh: [20, 20, 10], el: 70 } }, { armR: GUARD_ARM, armL: { sh: [-10, 26, 0], el: 50 } }),
  },
  alias: { parry: 'deflect' },
  stances: {
    melee: { idle: S_READY, walk: S_WALK, run: S_RUN, swing: [1, 0.12], width: 0.105 },
    ranged: { idle: S_GUN, swing: [1, 0.35], width: 0.1 },
    none: { idle: { spine: [1, 0, 0] }, width: 0.1 },
    case: { idle: { spine: [1, 0, 0] }, swing: [0.25, 1], width: 0.1 },
  },
};
