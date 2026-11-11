/**
 * Narrative / ambient vocabulary shared by every humanoid: conversation, consoles, the Crownmark assents,
 * hand-overs, sitting at the observation table, tending and being the wounded, the rescue beats.
 * Poses that must hold (sit, kneel, lie, trapped …) loop or `hold` until stop() / the next play().
 */
import type { ClipSpec, PoseSpec } from '../anim/clip';

const REST: PoseSpec = {
  hips: [0, 0, 0], hipsR: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  armL: { sh: [2, 6, 0], el: 14, wr: [0, 0, 0], fist: 0.3, fk: true }, armR: { sh: [2, 6, 0], el: 14, wr: [0, 0, 0], fist: 0.3, fk: true },
};

const talk: ClipSpec = {
  duration: 3.6, emptyHands: true, loop: true, upperOnly: true, fadeIn: 0.3,
  keys: [
    { t: 0, chest: [1, 2, 0], head: [2, -2, 0], armR: { sh: [18, 10, 14], el: 62, wr: [0, 0, -30], fist: 0.15 }, armL: { sh: [4, 6, 0], el: 20 } },
    { t: 0.2, chest: [2, 4, 0], head: [-2, 2, 1], armR: { sh: [30, 14, 10], el: 74, wr: [-12, 0, -50], fist: 0.05 } },
    { t: 0.42, chest: [1, 0, 0], head: [3, -3, 0], armR: { sh: [22, 12, 16], el: 58, wr: [6, 0, -20], fist: 0.2 } },
    { t: 0.62, chest: [0, -3, 0], head: [0, 4, -2], armR: { sh: [26, 18, 8], el: 80, wr: [-8, 0, -60], fist: 0.05 }, armL: { sh: [10, 8, 6], el: 40, fist: 0.15 } },
    { t: 0.84, chest: [2, 1, 0], head: [4, 0, 0], armR: { sh: [16, 10, 14], el: 56, wr: [0, 0, -24], fist: 0.2 }, armL: { sh: [4, 6, 0], el: 22 } },
  ],
};

const listen: ClipSpec = {
  duration: 4.4, loop: true, upperOnly: true, fadeIn: 0.4,
  keys: [
    { t: 0, chest: [1, 0, 0], head: [2, 3, 3], armL: { sh: [4, 6, 0], el: 18 }, armR: { sh: [4, 6, 0], el: 18 } },
    { t: 0.3, chest: [2, -2, 0], head: [4, 0, 4] },
    { t: 0.36, head: [8, 0, 4] },
    { t: 0.42, head: [3, 0, 4] },
    { t: 0.7, chest: [1, 2, 0], head: [1, 5, 2] },
  ],
};

const nod: ClipSpec = {
  duration: 0.8, upperOnly: true, fadeIn: 0.1,
  keys: [{ t: 0 }, { t: 0.28, ease: 'inOut', neck: [6, 0, 0], head: [12, 0, 0] }, { t: 0.52, ease: 'inOut', neck: [0, 0, 0], head: [-2, 0, 0] }, { t: 0.74, ease: 'inOut', neck: [3, 0, 0], head: [6, 0, 0] }, { t: 1, neck: [0, 0, 0], head: [0, 0, 0] }],
  events: [[0.28, 'hit']],
};

const point: ClipSpec = {
  duration: 1.5, emptyHands: true, upperOnly: true, fadeIn: 0.15,
  keys: [
    { t: 0 },
    { t: 0.24, ease: 'out', chest: [2, 6, 0], head: [-2, -4, 0], armR: { p: [0.2, 0.16, 0.52], fingers: [0.05, 0.02, 1], palm: [-0.4, -0.9, 0], fist: 0.55, pole: [0.6, -0.75, -0.1] } },
    { t: 0.7, ease: 'inOut', armR: { p: [0.2, 0.165, 0.525] } },
    { t: 1, ease: 'inOut', ...REST },
  ],
  events: [[0.24, 'hit']],
};

/** Dominion salute: closed fist to the heart. */
const salute: ClipSpec = {
  duration: 1.6, emptyHands: true, upperOnly: true, fadeIn: 0.15,
  keys: [
    { t: 0 },
    { t: 0.22, ease: 'out', chest: [-2, 0, 0], head: [-3, 0, 0], armR: { p: [-0.07, 0.07, 0.19], fingers: [-0.95, 0.2, 0.1], palm: [0, 0, -1], fist: 1, pole: [0.8, -0.4, 0.3] } },
    { t: 0.7, ease: 'inOut', head: [4, 0, 0] },
    { t: 1, ease: 'inOut', ...REST },
  ],
  events: [[0.22, 'hit']],
};

const lookAround: ClipSpec = {
  duration: 4, upperOnly: true, fadeIn: 0.3,
  keys: [
    { t: 0 },
    { t: 0.2, ease: 'inOut', chest: [0, 14, 0], neck: [0, 16, 0], head: [-4, 28, 0] },
    { t: 0.42, ease: 'inOut', chest: [0, 10, 0], neck: [-4, 12, 0], head: [-14, 20, 0] },
    { t: 0.68, ease: 'inOut', chest: [0, -14, 0], neck: [0, -16, 0], head: [-2, -30, 0] },
    { t: 0.86, ease: 'inOut', chest: [0, -8, 0], neck: [0, -8, 0], head: [4, -12, 0] },
    { t: 1, ease: 'inOut', chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0] },
  ],
};

const interact: ClipSpec = {
  duration: 0.9, emptyHands: true, upperOnly: true, fadeIn: 0.12,
  keys: [
    { t: 0 },
    { t: 0.4, ease: 'out', spine: [6, 0, 0], chest: [4, 6, 0], head: [8, -4, 0], armR: { p: [0.14, -0.12, 0.5], fingers: [0, -0.2, 1], palm: [0, -1, -0.2], fist: 0.25, pole: [0.7, -0.7, -0.1] } },
    { t: 0.6, ease: 'inOut', armR: { p: [0.14, -0.14, 0.52] } },
    { t: 1, ease: 'inOut', ...REST },
  ],
  events: [[0.45, 'hit']],
};

/** Both hands working a console at waist height. */
const holdConsole: ClipSpec = {
  duration: 3, emptyHands: true, loop: true, upperOnly: true, fadeIn: 0.3,
  keys: [
    { t: 0, spine: [6, 0, 0], chest: [5, 0, 0], neck: [6, 0, 0], head: [12, 0, 0],
      armL: { p: [-0.17, -0.26, 0.4], fingers: [0.1, -0.25, 1], palm: [0, -1, -0.25], fist: 0.2, pole: [-0.7, -0.7, -0.1] },
      armR: { p: [0.17, -0.26, 0.4], fingers: [-0.1, -0.25, 1], palm: [0, -1, -0.25], fist: 0.2, pole: [0.7, -0.7, -0.1] } },
    { t: 0.3, armR: { p: [0.2, -0.25, 0.43] }, head: [12, -6, 0] },
    { t: 0.55, armL: { p: [-0.13, -0.25, 0.44] }, armR: { p: [0.17, -0.26, 0.4] }, head: [10, 5, 0] },
    { t: 0.8, armL: { p: [-0.17, -0.26, 0.4] }, head: [13, 0, 0] },
  ],
};

/** Assent at the Crownmark lectern: the right palm laid flat, held, the head inclined. */
const assent: ClipSpec = {
  duration: 2.2, emptyHands: true, hold: true, upperOnly: true, fadeIn: 0.4,
  keys: [
    { t: 0 },
    { t: 0.3, ease: 'inOut', chest: [2, 4, 0], head: [4, -2, 0], armR: { p: [0.16, 0.0, 0.36], fingers: [0, 0.2, 1], palm: [0, -1, 0.1], fist: 0, pole: [0.7, -0.7, -0.1] } },
    { t: 0.62, ease: 'inOut', spine: [4, 0, 0], chest: [4, 5, 0], neck: [4, 0, 0], head: [8, -3, 0], armR: { p: [0.15, -0.2, 0.44], fingers: [0, -0.1, 1], palm: [0, -1, -0.1], fist: 0 } },
    { t: 1, ease: 'inOut', neck: [7, 0, 0], head: [12, -3, 0] },
  ],
  events: [[0.62, 'hit']],
};

const handOver: ClipSpec = {
  duration: 1.4, emptyHands: true, hold: true, upperOnly: true, fadeIn: 0.25,
  keys: [
    { t: 0 },
    { t: 0.36, ease: 'inOut', chest: [2, 6, 0], head: [4, -4, 0], armR: { p: [0.12, -0.08, 0.3], fingers: [-0.2, 0, 1], palm: [0, 1, 0], fist: 0.5, pole: [0.75, -0.6, -0.2] } },
    { t: 0.8, ease: 'inOut', spine: [3, 0, 0], chest: [3, 8, 0], armR: { p: [0.1, -0.06, 0.52], fingers: [-0.1, 0.05, 1], palm: [0, 1, 0], fist: 0.3 } },
    { t: 1, ease: 'inOut', armR: { p: [0.1, -0.06, 0.525], fist: 0.1 } },
  ],
  events: [[0.8, 'release']],
};

const receive: ClipSpec = {
  duration: 1.6, emptyHands: true, upperOnly: true, fadeIn: 0.25,
  keys: [
    { t: 0 },
    { t: 0.36, ease: 'inOut', chest: [3, 8, 0], head: [8, -4, 0], armR: { p: [0.1, -0.1, 0.5], fingers: [-0.1, 0, 1], palm: [0, 1, 0], fist: 0.05, pole: [0.75, -0.6, -0.2] } },
    { t: 0.52, ease: 'inOut', armR: { p: [0.1, -0.09, 0.5], fist: 0.7 } },
    { t: 0.8, ease: 'inOut', chest: [1, 2, 0], head: [10, 4, 0], armR: { p: [0.12, -0.14, 0.26], fingers: [-0.5, 0.1, 0.8], palm: [0.2, 0.95, 0.2], fist: 0.7 } },
    { t: 1, ease: 'inOut', ...REST },
  ],
  events: [[0.52, 'hit']],
};

const KNEEL: PoseSpec = {
  hips: [0, -0.44, 0.02], hipsR: [6, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], neck: [-4, 0, 0], head: [-4, 0, 0],
  legL: { p: [-0.13, 0, 0.3], pitch: 0, yaw: 6, air: false, knee: [-0.1, 0.3, 1] },
  // the rear foot stands on the ball, toes bent flat (not air: the heel-off pivot does exactly this)
  legR: { p: [0.12, 0, -0.36], pitch: -76, yaw: 4, air: false, knee: [0.08, -0.8, 0.6] },
  armL: { sh: [26, 8, 10], el: 62, fist: 0.3 }, armR: { sh: [10, 8, 0], el: 30, fist: 0.3 },
};

const kneel: ClipSpec = { duration: 1, hold: true, fadeIn: 0.45, seat: 0.2, keys: [{ t: 0, ...KNEEL }] };

/** Kneeling over a casualty, hands working low and forward. */
const kneelTend: ClipSpec = {
  duration: 3.2, emptyHands: true, seat: 0.2, loop: true, fadeIn: 0.45,
  keys: [
    { t: 0, ...KNEEL, hips: [0, -0.46, 0.06], hipsR: [16, 0, 0], spine: [18, 0, 0], chest: [12, 0, 0], neck: [6, 0, 0], head: [10, 0, 0],
      armL: { p: [-0.14, -0.3, 0.46], fingers: [0.1, -0.5, 0.86], palm: [0, -0.86, -0.5], fist: 0.3, pole: [-0.8, -0.5, -0.2] },
      armR: { p: [0.14, -0.34, 0.44], fingers: [-0.1, -0.5, 0.86], palm: [0, -0.86, -0.5], fist: 0.3, pole: [0.8, -0.5, -0.2] } },
    { t: 0.25, armR: { p: [0.1, -0.36, 0.5] }, head: [12, -6, 0] },
    { t: 0.5, armL: { p: [-0.1, -0.33, 0.5] }, armR: { p: [0.16, -0.32, 0.42] }, head: [10, 4, 0] },
    { t: 0.75, armL: { p: [-0.15, -0.3, 0.45] }, head: [12, 0, 0] },
  ],
};

/** Chair: seat ≈ 0.46 m. The driver places the actor's root at the chair. */
const SIT: PoseSpec = {
  hips: [0, -0.43, -0.04], hipsR: [-4, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0], neck: [-1, 0, 0], head: [-1, 0, 0],
  legL: { p: [-0.12, 0, 0.42], pitch: 0, yaw: 6, air: false, knee: [-0.05, 0.4, 1] },
  legR: { p: [0.12, 0, 0.42], pitch: 0, yaw: 6, air: false, knee: [0.05, 0.4, 1] },
  armL: { p: [-0.13, -0.3, 0.3], fingers: [0.15, -0.2, 0.97], palm: [0, -1, -0.2], fist: 0.25, pole: [-0.8, -0.5, -0.3] },
  armR: { p: [0.13, -0.3, 0.3], fingers: [-0.15, -0.2, 0.97], palm: [0, -1, -0.2], fist: 0.25, pole: [0.8, -0.5, -0.3] },
};

const sit: ClipSpec = {
  duration: 5, emptyHands: true, seat: 0.46, loop: true, fadeIn: 0.5,
  keys: [{ t: 0, ...SIT }, { t: 0.5, spine: [5, 0, 0], head: [-1, 3, 0] }],
};

const sitTalk: ClipSpec = {
  duration: 4, emptyHands: true, seat: 0.46, loop: true, fadeIn: 0.4,
  keys: [
    { t: 0, ...SIT, spine: [8, 0, 0], chest: [4, 2, 0], head: [0, -2, 0], armR: { p: [0.14, -0.14, 0.38], fingers: [-0.2, 0.3, 0.93], palm: [-0.5, 0.8, -0.3], fist: 0.1 } },
    { t: 0.22, chest: [5, 4, 0], head: [-2, 3, 1], armR: { p: [0.2, -0.1, 0.4], fingers: [0, 0.4, 0.9], palm: [-0.8, 0.5, -0.2] } },
    { t: 0.46, chest: [4, 0, 0], head: [3, -3, 0], armR: { p: [0.13, -0.16, 0.36], fingers: [-0.2, 0.2, 0.95], palm: [-0.4, 0.85, -0.3] } },
    { t: 0.72, chest: [5, -3, 0], head: [0, 4, -2], armR: { p: [0.16, -0.2, 0.38], fingers: [-0.1, -0.1, 1], palm: [0, -1, -0.1], fist: 0.2 } },
  ],
};

/** Slumped on the floor against something, one hand pressed to the side. */
const sitInjured: ClipSpec = {
  duration: 3.4, emptyHands: true, seat: 0.02, loop: true, fadeIn: 0.5,
  keys: [
    { t: 0, hips: [0, -0.8, -0.1], hipsR: [-24, 0, 4], spine: [14, 0, 4], chest: [10, 0, 2], neck: [6, 0, 0], head: [10, 8, 6],
      legL: { p: [-0.16, 0.0, 0.62], pitch: 40, yaw: 20, air: true, knee: [-0.3, 0.9, 0.3] },
      legR: { p: [0.14, 0, 0.36], pitch: 0, yaw: 10, air: false, knee: [0.2, 0.9, 0.4] },
      armL: { p: [0.06, -0.26, 0.17], fingers: [0.9, -0.3, 0.1], palm: [0.1, -0.2, -0.97], fist: 0.2, pole: [-0.9, -0.3, 0.1] },
      armR: { sh: [-4, 18, 0], el: 30, fk: true, fist: 0.2 } },
    { t: 0.5, spine: [16, 0, 4], head: [12, 8, 6] },
  ],
};

const lieInjured: ClipSpec = {
  duration: 3.6, emptyHands: true, seat: 0.02, loop: true, fadeIn: 0.5,
  keys: [
    { t: 0, hips: [0, -0.85, -0.32], hipsR: [-86, 0, 0], spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [6, 0, 0], head: [6, 16, 0],
      armL: { p: [-0.04, -0.2, 0.2], fingers: [0.8, -0.5, 0], palm: [0, 0, -1], fist: 0.2, pole: [-1, 0, 0] }, armR: { sh: [-6, 30, 0], el: 30, fk: true, fist: 0.2 },
      legL: { p: [-0.16, 0.02, 0.5], pitch: 62, yaw: 22, air: true, knee: [-0.3, 0.9, 0.3] },
      legR: { p: [0.13, 0.03, 0.42], pitch: 56, yaw: 14, air: true, knee: [0.2, 0.95, 0.2] } },
    { t: 0.5, chest: [-4, 0, 0], head: [6, 12, 0] },
  ],
};

/** Pinned face-down under the plate, one arm free and reaching. */
const trapped: ClipSpec = {
  duration: 2.6, emptyHands: true, seat: 0.02, loop: true, fadeIn: 0.5,
  keys: [
    { t: 0, hips: [0, -0.84, 0.0], hipsR: [84, 0, 6], spine: [-10, 0, 0], chest: [-12, 10, 0], neck: [-16, 0, 0], head: [-22, 8, 0],
      armR: { sh: [150, 30, 0], el: 30, fk: true, fist: 0.1 }, armL: { sh: [60, 50, 0], el: 100, fk: true, fist: 0.6 },
      legL: { p: [-0.14, 0.02, -0.82], pitch: -84, yaw: 10, air: true, knee: [-0.2, -0.9, 0.2] },
      legR: { p: [0.14, 0.02, -0.8], pitch: -84, yaw: 10, air: true, knee: [0.2, -0.9, 0.2] } },
    { t: 0.4, chest: [-16, 14, 0], head: [-26, 10, 0], armR: { sh: [158, 26, 0], el: 14, fist: 0 } },
    { t: 0.7, chest: [-10, 8, 0], armR: { sh: [146, 30, 0], el: 40, fist: 0.4 } },
  ],
};

/** Dead-lift: squat, hands under the edge, drive up and hold. Use setHandTarget to pin the palms to the plate. */
const liftPlate: ClipSpec = {
  duration: 2.2, emptyHands: true, seat: 0.3, hold: true, fadeIn: 0.3,
  keys: [
    { t: 0 },
    { t: 0.26, ease: 'inOut', hips: [0, -0.46, -0.04], hipsR: [30, 0, 0], spine: [14, 0, 0], chest: [6, 0, 0], neck: [-18, 0, 0], head: [-20, 0, 0],
      armL: { p: [-0.2, -0.3, 0.36], fingers: [0.1, -0.3, 0.95], palm: [0, 0.95, 0.3], fist: 0.7, pole: [-0.8, -0.5, -0.2] },
      armR: { p: [0.2, -0.3, 0.36], fingers: [-0.1, -0.3, 0.95], palm: [0, 0.95, 0.3], fist: 0.7, pole: [0.8, -0.5, -0.2] },
      legL: { p: [-0.2, 0, 0.1], yaw: 20, knee: [-0.5, 0.2, 1] }, legR: { p: [0.2, 0, 0.06], yaw: 20, knee: [0.5, 0.2, 1] } },
    { t: 0.4, ease: 'inOut', hips: [0, -0.48, -0.04] },
    // the strain: slow first, then it gives
    { t: 0.72, ease: 'in', hips: [0, -0.22, 0.0], hipsR: [14, 0, 0], spine: [4, 0, 0], chest: [-2, 0, 0], neck: [-6, 0, 0], head: [-4, 0, 0],
      armL: { p: [-0.2, -0.2, 0.34] }, armR: { p: [0.2, -0.2, 0.34] } },
    { t: 1, ease: 'out', hips: [0, -0.06, 0.02], hipsR: [0, 0, 0], spine: [-6, 0, 0], chest: [-6, 0, 0], neck: [4, 0, 0], head: [4, 0, 0],
      armL: { p: [-0.2, 0.0, 0.34], fingers: [0.1, 0.2, 0.97], palm: [0, 0.97, -0.2] }, armR: { p: [0.2, 0.0, 0.34], fingers: [-0.1, 0.2, 0.97], palm: [0, 0.97, -0.2] } },
  ],
  events: [[0.4, 'hit'], [0.95, 'impact']],
};

const carryStretcher: ClipSpec = {
  duration: 2, emptyHands: true, loop: true, upperOnly: true, fadeIn: 0.3,
  keys: [
    { t: 0, spine: [4, 0, 0], chest: [2, 0, 0], armL: { p: [-0.25, -0.44, 0.02], fingers: [0, -0.2, 1], palm: [1, 0, 0], fist: 1, pole: [-0.7, -0.3, -0.6] }, armR: { p: [0.25, -0.44, 0.02], fingers: [0, -0.2, 1], palm: [-1, 0, 0], fist: 1, pole: [0.7, -0.3, -0.6] } },
    { t: 0.5, armL: { p: [-0.25, -0.445, 0.025] }, armR: { p: [0.25, -0.435, 0.015] } },
  ],
};

const cower: ClipSpec = {
  duration: 2.4, emptyHands: true, seat: 0.2, loop: true, fadeIn: 0.3,
  keys: [
    { t: 0, hips: [0, -0.42, -0.02], hipsR: [20, 0, 0], spine: [26, 0, 0], chest: [18, 0, 0], neck: [10, 0, 0], head: [14, 0, 0],
      armL: { p: [-0.1, 0.36, 0.14], fingers: [0.6, 0.6, -0.5], palm: [0.3, -0.8, -0.5], fist: 0.4, pole: [-0.9, -0.2, 0.3] },
      armR: { p: [0.1, 0.36, 0.14], fingers: [-0.6, 0.6, -0.5], palm: [-0.3, -0.8, -0.5], fist: 0.4, pole: [0.9, -0.2, 0.3] },
      legL: { p: [-0.14, 0, 0.12], yaw: 10, knee: [-0.3, 0.2, 1] }, legR: { p: [0.14, 0, -0.06], yaw: 14, pitch: -30, knee: [0.3, 0.2, 1] } },
    { t: 0.5, hips: [0, -0.44, -0.02], spine: [28, 0, 0] },
  ],
};

/** Upper-body overlay for a wounded walk: one hand to the ribs, guarded lean. */
const limp: ClipSpec = {
  duration: 2, loop: true, upperOnly: true, fadeIn: 0.3,
  keys: [
    { t: 0, spine: [10, 0, 6], chest: [6, -4, 4], neck: [-2, 0, 0], head: [2, 4, 0], armL: { p: [0.1, -0.22, 0.15], fingers: [0.9, -0.3, 0.1], palm: [0.1, -0.2, -0.97], fist: 0.2, pole: [-0.9, -0.3, 0.1] }, armR: { sh: [6, 12, 0], el: 30, fist: 0.5 } },
    { t: 0.5, spine: [12, 0, 7] },
  ],
};

/** Eclipse pressure: hands to the head, folding inward. */
const distress: ClipSpec = {
  duration: 2.8, emptyHands: true, loop: true, fadeIn: 0.35,
  keys: [
    { t: 0, hips: [0, -0.1, 0], hipsR: [6, 0, 0], spine: [16, 0, 0], chest: [12, 0, 0], neck: [10, 0, 0], head: [12, 0, 6],
      armL: { p: [-0.1, 0.36, 0.1], fingers: [0.5, 0.8, -0.2], palm: [0.9, -0.2, -0.3], fist: 0.35, pole: [-0.8, -0.5, 0.2] },
      armR: { p: [0.1, 0.36, 0.1], fingers: [-0.5, 0.8, -0.2], palm: [-0.9, -0.2, -0.3], fist: 0.35, pole: [0.8, -0.5, 0.2] },
      legL: { p: [-0.12, 0, 0.04], yaw: 4 }, legR: { p: [0.12, 0, -0.04], yaw: 4 } },
    { t: 0.3, hips: [0.02, -0.14, 0], spine: [20, 4, 3], head: [14, -8, -6] },
    { t: 0.6, hips: [-0.02, -0.12, 0], spine: [18, -4, -3], head: [16, 8, 8] },
  ],
};

/** Grounding: down on one knee, palm flat to the floor, breath counted. */
const grounding: ClipSpec = {
  duration: 4, emptyHands: true, seat: 0.2, loop: true, fadeIn: 0.5,
  keys: [
    { t: 0, ...KNEEL, hips: [0, -0.5, 0.06], hipsR: [18, 0, 0], spine: [20, 0, 0], chest: [12, 0, 0], neck: [8, 0, 0], head: [12, 0, 0],
      armR: { p: [0.22, -0.56, 0.36], fingers: [0, -0.1, 1], palm: [0, -1, -0.1], fist: 0, pole: [0.9, -0.2, -0.3] },
      armL: { p: [-0.14, -0.26, 0.26], fingers: [0.2, -0.5, 0.85], palm: [0, -0.86, -0.5], fist: 0.3, pole: [-0.8, -0.5, -0.2] } },
    { t: 0.5, spine: [17, 0, 0], chest: [9, 0, 0], head: [9, 0, 0] },
  ],
};

const turnAway: ClipSpec = {
  duration: 1.4, hold: true, upperOnly: true, fadeIn: 0.3,
  keys: [{ t: 0 }, { t: 1, ease: 'inOut', spine: [2, 14, 0], chest: [2, 22, 0], neck: [4, 20, 0], head: [8, 26, 0] }],
};

/** Overlay for leaving: shoulders down, eyes on the floor ahead. The driver moves the actor. */
const walkAway: ClipSpec = {
  duration: 2, loop: true, upperOnly: true, fadeIn: 0.6,
  keys: [{ t: 0, spine: [4, 0, 0], chest: [3, 0, 0], neck: [5, 0, 0], head: [8, 0, 0] }, { t: 0.5, head: [9, 2, 0] }],
};

/** Linked cadence sway shared by coerced bodies (overridden by the Linkbound moveset). */
const frozenHold: ClipSpec = { duration: 1, loop: true, keys: [{ t: 0 }] };

/**
 * One deep, visible breath (polish 3): the chest fills and the shoulders rise, held a moment, then let go a little
 * lower than before. Upper body only, so it plays over standing, sitting or kneeling; the arms keep their pose.
 */
const breath: ClipSpec = {
  duration: 3.2, upperOnly: true, fadeIn: 0.25, fadeOut: 0.5,
  keys: [
    { t: 0 },
    { t: 0.4, ease: 'inOut', spine: [-2, 0, 0], chest: [-5, 0, 0], neck: [-2, 0, 0], head: [-6, 0, 0] },
    { t: 0.52, ease: 'inOut', spine: [-2, 0, 0], chest: [-5.5, 0, 0], neck: [-2, 0, 0], head: [-6, 0, 0] },
    { t: 0.86, ease: 'inOut', spine: [2, 0, 0], chest: [4, 0, 0], neck: [2, 0, 0], head: [6, 0, 0] },
    { t: 1, ease: 'inOut', spine: [1, 0, 0], chest: [2, 0, 0], neck: [1, 0, 0], head: [3, 0, 0] },
  ],
  events: [[0.4, 'hit'], [0.86, 'release']],
};

export const NARRATIVE: Record<string, ClipSpec> = {
  talk, listen, nod, point, salute, lookAround, interact, holdConsole, holdPlane: holdConsole, assent, handOver, receive,
  kneel, kneelTend, sit, sitTalk, sitInjured, lieInjured, trapped, liftPlate, carryStretcher, cower, limp, distress, grounding,
  turnAway, walkAway, frozenHold, breath,
};
