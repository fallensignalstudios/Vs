/**
 * Elite — action table and authored action layers.
 *
 * Every layer is additive over the idle / gait pose and is written as key tables (module constants — nothing
 * here allocates per frame) evaluated at the slot's time and scaled by its blend weight. Conventions in this
 * rig: rotation +x leans a body bone back / swings an arm forward-up, +y turns left, +z rolls left (and
 * abducts the RIGHT arm); leg offsets and hips moves are in model units, −z is forward.
 *
 * Whole-body rule: every attack involves the stance. A slam is braced with a forward step and a deep hip
 * drop, the roar widens the feet, the pulse plants a foot before it is released.
 */
import type * as THREE from 'three';
import { TAU } from '@/core/mathx';
import { impact, keys, move, noise1, rot, win } from '../core/anim';
import type { ActionDef, Slot } from '../core/base';

export const ELITE_ACTIONS: Record<string, ActionDef> = {
  idle: { dur: 4, loop: true },
  sweep: { dur: 1.75, hits: [0.82], fade: 0.2, out: 0.3, events: [[0.84, 'step']] },
  groundSlam: { dur: 3.1, hits: [1.62], fade: 0.25, out: 0.35, events: [[0.7, 'step'], [1.62, 'impact']] },
  charge: { dur: 2.5, hits: [1.7], fade: 0.2, out: 0.35, events: [[0.5, 'step'], [1.74, 'step']] },
  roar: { dur: 2.6, hits: [0.62], hitName: 'release', fade: 0.2, out: 0.4, events: [[0.5, 'step']] },
  pulse: { dur: 2.7, hits: [1.45], hitName: 'release', fade: 0.25, out: 0.4, events: [[0.9, 'step']] },
  regenerate: { dur: 3.2, loop: true, fade: 0.5, out: 0.5 },
  exposeJoint: { dur: 2.2, fade: 0.15, out: 0.4, events: [[0.45, 'step'], [0.55, 'impact']] },
  fracture: { dur: 3.2, hits: [0.03], fade: 0.04, out: 0.5, ignoreFreeze: true, thaw: true, events: [[0.32, 'step'], [0.6, 'step'], [1.3, 'impact']] },
  hitLight: { dur: 0.4, fade: 0.03, out: 0.15, react: true, ignoreFreeze: true },
  hitHeavy: { dur: 0.75, fade: 0.04, out: 0.2, react: true, ignoreFreeze: true },
  stagger: { dur: 1.5, fade: 0.06, out: 0.35, events: [[0.36, 'step']] },
  spawn: { dur: 2.4, fade: 0, out: 0.4, revive: true, dissolveIn: 1.3 },
  death: { dur: 4.4, hold: true, fade: 0.1, ignoreFreeze: true, thaw: true, events: [[1.9, 'impact']], dissolveOut: [2.7, 4.4] },
  generic: { dur: 0.6, react: true, ignoreFreeze: true },
};

export const ELITE_ALIASES: Record<string, string> = {
  attackLight1: 'sweep', attackLight2: 'sweep', attackLight3: 'sweep', attackLight4: 'sweep', attackHeavy: 'groundSlam', attackHeavyCharge: 'groundSlam',
  slam: 'groundSlam', lunge: 'charge', shieldBash: 'charge', linkedSync: 'regenerate', frozen: 'idle', hover: 'idle', guardBreak: 'stagger', knockdown: 'stagger',
  spawnBreach: 'spawn', spawnDrop: 'spawn', weave: 'regenerate', distress: 'roar',
};

/** which foot each 'step' event of an action lands (in order) and how hard — feeds EliteVisual.onFootfall */
export const ELITE_STEPS: Readonly<Record<string, readonly (readonly ['L' | 'R', number])[]>> = {
  sweep: [['R', 0.8]], groundSlam: [['L', 0.75]], charge: [['R', 0.7], ['L', 0.9]], roar: [['L', 0.85]], pulse: [['R', 0.7]],
  exposeJoint: [['L', 0.6]], fracture: [['R', 0.8], ['L', 0.8]], stagger: [['L', 0.7]],
};

export interface EliteLeg {
  /** per-frame foot target offset (model space) written by gait + actions */
  off: THREE.Vector3;
}

export interface EliteArm {
  target: THREE.Vector3;
  w: number;
}

/** what an action layer may touch */
export interface ElitePose {
  hips: THREE.Bone; spine: THREE.Bone; chest: THREE.Bone; neck: THREE.Bone; head: THREE.Bone; jaw: THREE.Bone;
  ribR: THREE.Bone; ribL: THREE.Bone;
  shR: THREE.Bone; armR: THREE.Bone; foreR: THREE.Bone;
  shL: THREE.Bone; armL: THREE.Bone; foreL: THREE.Bone;
  clawR: THREE.Bone[]; clawL: THREE.Bone[];
  /** [right, left] */
  legs: EliteLeg[];
  /** [right, left] hand contacts */
  arms: EliteArm[];
  knitLift: number; coreGlow: number; flare: number; limp: number;
}

const K = {
  swYaw: [0, 0, 0.55, -0.75, 0.68, -0.8, 0.86, 1.0, 1.05, 1.15, 1.75, 0],
  swSpineX: [0, 0, 0.55, 0.12, 0.86, -0.3, 1.2, -0.22, 1.75, 0],
  swHipY: [0, 0, 0.55, -0.12, 0.86, -0.26, 1.75, 0],
  swHipZ: [0.6, 0, 0.86, -0.38, 1.75, 0],
  swArmRY: [0, 0, 0.55, -0.7, 0.68, -0.78, 0.86, 1.15, 1.05, 1.45, 1.75, 0],
  swArmRZ: [0, 0, 0.5, 1.28, 0.9, 1.22, 1.2, 0.9, 1.75, 0],
  swForeRX: [0, 0, 0.5, 0.55, 0.7, 0.3, 0.86, -0.38, 1.2, -0.2, 1.75, 0],
  swShRZ: [0, 0, 0.5, 0.2, 0.9, 0.12, 1.75, 0],
  swClaw: [0.5, 0, 0.7, -0.5, 1.0, -0.4, 1.75, 0],
  swArmLX: [0, 0, 0.55, 0.45, 0.86, -0.5, 1.75, 0],
  swArmLZ: [0, 0, 0.55, -0.45, 0.86, -0.25, 1.75, 0],
  swForeLX: [0, 0, 0.55, 0.5, 0.86, 0.2, 1.75, 0],
  swLegZ: [0.62, 0, 0.84, -0.62, 1.3, -0.62, 1.75, 0],

  slRear: [0, 0, 1.0, 1, 1.42, 1.06, 1.62, 0],
  slSlam: [1.46, 0, 1.62, 1, 2.3, 1, 3.1, 0],
  slIk: [1.5, 0, 1.62, 1, 2.35, 1, 2.9, 0],
  slStep: [0.45, 0, 0.7, 1, 2.5, 1, 3.0, 0],
  slBrace: [1.4, 0, 1.62, 1, 2.5, 1, 3.0, 0],

  chCrouch: [0, 0, 0.55, 1, 0.8, 0.6, 1.6, 0.6, 1.9, 0],
  chCheck: [1.58, 0, 1.72, 1, 1.95, 0.6, 2.5, 0],
  chLegZ: [0.1, 0, 0.5, 0.45, 0.7, 0],

  roOpen: [0.45, 0, 0.72, 1, 1.8, 1, 2.6, 0],
  roHead: [0.45, 0, 0.62, 1.3, 0.8, 0.9, 1.0, 1.04, 1.8, 1, 2.6, 0],
  roStep: [0.28, 0, 0.5, 1, 2.1, 1, 2.5, 0],

  puCurl: [0, 0, 1.2, 1, 1.38, 1.06, 1.5, 0],
  puBurst: [1.38, 0, 1.5, 1, 1.85, 0.7, 2.7, 0],
  puStep: [0.7, 0, 0.9, 1, 2.3, 1, 2.65, 0],

  exDrop: [0, 0, 0.5, 1, 1.7, 1, 2.2, 0],
  exArm: [0, 0, 0.25, 1, 0.55, 0],
  exHead: [0, 0, 0.3, 1, 0.9, 0],
  exLegZ: [0.1, 0, 0.45, 0.3, 1.8, 0.3, 2.2, 0],
  exOpen: [0.25, 0, 1.0, 1, 1.85, 1, 2.2, 0],

  frRecoil: [0, 0, 0.12, 1, 0.5, 0.8, 1.2, 0.3, 3.2, 0],
  frKneel: [0.6, 0, 1.3, 1, 2.3, 1, 3.2, 0],
  frArmRZ: [0, 0, 0.15, 1.35, 0.6, 0.55, 1.2, 0.1, 3.2, 0],
  frForeRX: [0, 0, 0.15, 0.6, 0.7, -0.3, 3.2, 0],
  frShRZ: [0, 0, 0.1, 0.35, 0.8, 0, 3.2, 0],
  frIk: [0.9, 0, 1.3, 1, 2.3, 1, 2.9, 0],
  frLegRZ: [0.08, 0, 0.32, 0.75, 2.6, 0.75, 3.2, 0],
  frLegLZ: [0.3, 0, 0.6, 0.95, 2.6, 0.95, 3.2, 0],

  stK: [0, 0, 0.15, 1, 0.6, 0.7, 1.5, 0],
  stLegZ: [0.08, 0, 0.36, 0.62, 1.1, 0.62, 1.5, 0],

  spLow: [0.3, 0, 1.7, 1],

  deFall: [0.8, 0, 1.9, 1],
  deSettle: [1.9, 0, 2.7, 1],
  deIk: [1.3, 0, 1.9, 1],
  deLimp: [0.6, 0, 1.6, 1],
  deKnit: [1.9, 0, 3.4, 1.5],
  deCore: [1.0, 0, 2.6, 1],
} as const;

/** applies one action layer to the pose; returns the joint-open amount the action itself drives */
export function applyEliteAction(p: ElitePose, s: Slot): number {
  const t = s.t, w = s.w;
  const { hips, spine, chest, neck, head, jaw, armR, foreR, armL, foreL, shR, shL, ribR, ribL } = p;
  const legR = p.legs[0]!, legL = p.legs[1]!;
  const armIkR = p.arms[0]!, armIkL = p.arms[1]!;
  switch (s.name) {
    case 'sweep': {
      const yaw = keys(t, K.swYaw) * w;
      rot(chest, 0, yaw * 0.6, 0);
      rot(spine, keys(t, K.swSpineX) * w, yaw * 0.32, 0);
      rot(hips, 0, yaw * 0.2, 0);
      move(hips, 0, keys(t, K.swHipY) * w, keys(t, K.swHipZ) * w);
      rot(armR, 0, keys(t, K.swArmRY) * w, keys(t, K.swArmRZ) * w);
      rot(foreR, keys(t, K.swForeRX) * w, 0, 0);
      rot(shR, 0, 0, keys(t, K.swShRZ) * w);
      const claw = keys(t, K.swClaw) * w;
      for (let i = 0; i < 3; i++) rot(p.clawR[i]!, claw, 0, 0);
      rot(armL, keys(t, K.swArmLX) * w, 0, keys(t, K.swArmLZ) * w);
      rot(foreL, keys(t, K.swForeLX) * w, 0, 0);
      rot(head, 0, -yaw * 0.5, 0);
      legR.off.z += keys(t, K.swLegZ) * w;
      legR.off.y += (win(t, 0.62, 0.72, 0.76, 0.84) * 0.22 + win(t, 1.4, 1.5, 1.6, 1.72) * 0.12) * w;
      p.flare += Math.abs(yaw) * 0.25;
      return 0;
    }
    case 'groundSlam': {
      const rear = keys(t, K.slRear) * w;
      const slam = keys(t, K.slSlam) * w;
      const tremble = noise1(t * 31) * win(t, 0.85, 1.1, 1.42, 1.5) * w;
      const ring = impact(t, 1.62, 0.22, 34) * w;
      rot(spine, 0.3 * rear - 0.55 * slam + tremble * 0.012, 0, 0);
      rot(chest, 0.28 * rear - 0.36 * slam, 0, tremble * 0.015);
      // rise onto the stepping foot, then drop the whole weight through both knees
      move(hips, 0, 0.2 * rear - 0.66 * slam + ring * 0.04, 0.06 * rear - 0.42 * slam);
      rot(hips, -0.1 * slam, 0, 0);
      rot(armR, 2.5 * rear + 0.95 * slam, 0, 0.32 * rear);
      rot(foreR, 0.5 * rear - 0.25 * slam, 0, 0);
      rot(armL, 2.35 * rear + 0.95 * slam, 0, -0.32 * rear);
      rot(foreL, 0.45 * rear, 0, 0);
      rot(shR, 0, 0, 0.25 * rear);
      rot(shL, 0, 0, -0.25 * rear);
      rot(neck, 0.2 * rear - 0.1 * slam, 0, 0);
      rot(head, 0.42 * rear - 0.15 * slam, 0, 0);
      rot(jaw, -0.4 * rear, 0, 0);
      const claw = -0.4 * rear + 0.3 * slam;
      for (let i = 0; i < 3; i++) rot(p.clawR[i]!, claw, 0, 0);
      // bracing step: the left foot goes forward during the wind-up, the right slides back as the blow lands
      const step = keys(t, K.slStep) * w, brace = keys(t, K.slBrace) * w;
      legL.off.z -= 0.55 * step; legL.off.x -= 0.1 * step;
      legL.off.y += (win(t, 0.45, 0.54, 0.6, 0.7) * 0.26 + win(t, 2.5, 2.62, 2.8, 3.0) * 0.14) * w;
      legR.off.z += 0.3 * brace; legR.off.x += 0.12 * brace;
      const ik = keys(t, K.slIk) * w;
      armIkR.w = Math.max(armIkR.w, ik); armIkR.target.set(0.62, 0.62, -1.8);
      armIkL.w = Math.max(armIkL.w, ik); armIkL.target.set(-0.56, 0.5, -1.7);
      p.knitLift += impact(t, 1.62, 0.3) * 0.5 * w;
      p.flare += rear * 0.5;
      p.coreGlow += rear * 0.8;
      return 0;
    }
    case 'charge': {
      const crouch = keys(t, K.chCrouch) * w;
      const run = win(t, 0.6, 0.85, 1.6, 1.75) * w;
      const check = keys(t, K.chCheck) * w;
      rot(spine, -0.36 * crouch - 0.3 * run + 0.12 * check, 0, 0);
      rot(chest, -0.1 * crouch, -0.45 * crouch - 0.15 * run + 0.95 * check, 0.12 * crouch);
      move(hips, 0, -0.3 * crouch - 0.08 * run, -0.15 * run + 0.25 * check);
      rot(neck, 0.2 * crouch + 0.2 * run, 0, 0);
      rot(head, 0.22 * crouch + 0.2 * run, 0.3 * crouch - 0.5 * check, 0);
      rot(armR, -0.35 * crouch - 0.5 * run + 0.3 * check, 0, 0.15 * run + 0.4 * check);
      rot(foreR, 0.3 * crouch, 0, 0);
      rot(armL, 0.2 * crouch - 0.2 * run + 0.9 * check, 0, -0.1 * crouch - 0.55 * check);
      rot(foreL, 0.9 * crouch + 0.3 * check, 0, 0);
      rot(shL, 0, 0.35 * check, -0.2 * crouch);
      legR.off.z += keys(t, K.chLegZ) * w;
      legR.off.x += check * 0.22; legL.off.x -= check * 0.22;
      p.flare += run * 0.6;
      return 0;
    }
    case 'roar': {
      // coil, then throw the chest open: the club arm is dragged down and back, the left claw is thrust out,
      // the head whips up past its mark and settles, and the left foot stamps wide to carry it
      const gather = win(t, 0, 0.38, 0.45, 0.66) * w;
      const open = keys(t, K.roOpen) * w;
      const whipH = keys(t, K.roHead) * w;
      const shake = noise1(t * 27) * open;
      rot(spine, -0.34 * gather - 0.1 * open, 0.08 * open, shake * 0.012);
      rot(chest, -0.15 * gather + 0.36 * open, -0.3 * open + shake * 0.02, -0.06 * open);
      rot(hips, 0, 0.1 * open, 0);
      move(hips, -0.06 * open, -0.24 * gather - 0.17 * open, 0.1 * gather - 0.14 * open);
      rot(shR, 0, 0, -0.12 * open);
      rot(armR, 0.25 * gather - 0.62 * open, -0.3 * open, 0.44 * open);
      rot(foreR, 0.5 * gather - 0.18 * open, 0, 0);
      rot(shL, 0, 0, -0.2 * open);
      rot(armL, 0.4 * gather + 0.88 * open, 0.2 * open, -0.5 * open);
      rot(foreL, 0.7 * gather + 0.4 * open, 0, 0);
      rot(neck, -0.2 * gather + 0.26 * whipH, 0, 0);
      rot(head, -0.32 * gather + 0.5 * whipH + shake * 0.03, 0.18 * open + shake * 0.04, -0.18 * open);
      rot(jaw, -0.85 * open, 0, 0);
      rot(ribR, 0, -0.45 * open, 0);
      rot(ribL, 0, 0.45 * open, 0);
      for (let i = 0; i < 3; i++) {
        rot(p.clawR[i]!, -0.45 * open, 0, (i - 1) * 0.2 * open);
        rot(p.clawL[i]!, -0.7 * open, 0, (i - 1) * 0.3 * open);
      }
      const step = keys(t, K.roStep) * w;
      legL.off.x -= 0.42 * step; legL.off.z -= 0.22 * step;
      legL.off.y += (win(t, 0.28, 0.36, 0.42, 0.5) * 0.26 + win(t, 2.1, 2.2, 2.36, 2.5) * 0.14) * w;
      legR.off.z += 0.14 * step;
      p.knitLift += 0.55 * open;
      p.coreGlow += 2.2 * open;
      p.flare += open;
      return 0;
    }
    case 'pulse': {
      const curl = keys(t, K.puCurl) * w;
      const burst = keys(t, K.puBurst) * w;
      rot(spine, -0.4 * curl + 0.26 * burst, 0, 0);
      rot(chest, -0.3 * curl + 0.3 * burst, 0, 0);
      const step = keys(t, K.puStep) * w;
      move(hips, 0, -0.3 * curl + 0.1 * burst - 0.1 * step, 0.1 * burst);
      rot(neck, -0.2 * curl + 0.2 * burst, 0, 0);
      rot(head, -0.35 * curl + 0.4 * burst, 0, 0);
      rot(jaw, -0.6 * burst, 0, 0);
      rot(armR, 0.55 * curl - 0.4 * burst, -0.5 * curl, -0.12 * curl + 1.0 * burst);
      rot(foreR, 0.85 * curl - 0.2 * burst, 0, 0);
      rot(armL, 0.6 * curl - 0.4 * burst, 0.5 * curl, 0.15 * curl - 1.0 * burst);
      rot(foreL, 1.0 * curl, 0, 0);
      rot(ribR, 0, 0.1 * curl - 0.6 * burst, 0);
      rot(ribL, 0, -0.1 * curl + 0.6 * burst, 0);
      // plant wide before the release
      legR.off.x += 0.3 * step; legR.off.z += 0.08 * step;
      legR.off.y += (win(t, 0.7, 0.77, 0.83, 0.9) * 0.22 + win(t, 2.3, 2.4, 2.52, 2.65) * 0.12) * w;
      legL.off.x -= 0.12 * step;
      p.knitLift += -0.2 * curl + 0.9 * burst;
      p.coreGlow += 3.4 * curl * curl + 5 * impact(t, 1.45, 0.25) * w - 0.5 * win(t, 1.7, 1.9, 2.3, 2.7) * w;
      p.flare += -0.5 * curl + 1.3 * burst;
      return 0;
    }
    case 'regenerate': {
      const b = Math.sin((t / s.def.dur) * TAU);
      rot(spine, (-0.24 + b * 0.03) * w, 0, 0);
      rot(chest, (-0.14 + b * 0.05) * w, 0, 0);
      move(hips, 0, (-0.2 + b * 0.02) * w, 0);
      rot(neck, -0.15 * w, 0, 0);
      rot(head, -0.25 * w, 0, 0);
      rot(armR, 0.12 * w, 0, 0.08 * w);
      rot(foreR, -0.22 * w, 0, 0);
      rot(armL, 0.2 * w, 0, -0.12 * w);
      rot(foreL, -0.15 * w, 0, 0);
      rot(ribR, 0, -0.2 * (0.5 + 0.5 * b) * w, 0);
      rot(ribL, 0, 0.2 * (0.5 + 0.5 * b) * w, 0);
      return 0;
    }
    case 'exposeJoint': {
      const lurch = impact(t, 0.5, 0.22, 20) * w;
      const drop = keys(t, K.exDrop) * w;
      rot(chest, 0.1 * lurch, 0, -0.1 * drop - 0.05 * lurch);
      move(hips, 0, -0.12 * drop - 0.04 * lurch, 0.08 * drop);
      rot(armR, -0.2 * drop, 0, 0.25 * keys(t, K.exArm) * w);
      rot(foreR, -0.2 * drop + 0.1 * lurch, 0, 0);
      rot(head, 0.15 * keys(t, K.exHead) * w, -0.25 * drop, 0);
      rot(jaw, -0.3 * drop, 0, 0);
      legL.off.z += keys(t, K.exLegZ) * w;
      legL.off.y += win(t, 0.1, 0.2, 0.3, 0.45) * 0.15 * w;
      return keys(t, K.exOpen) * w;
    }
    case 'fracture': {
      const recoil = keys(t, K.frRecoil) * w;
      const kneel = keys(t, K.frKneel) * w;
      const spasm = noise1(t * 19) * win(t, 0.1, 0.3, 1.8, 2.6) * w;
      rot(chest, 0.42 * recoil - 0.2 * kneel + spasm * 0.03, -0.8 * recoil, 0.2 * recoil);
      rot(spine, 0.3 * recoil - 0.38 * kneel, -0.3 * recoil, spasm * 0.02);
      move(hips, -0.15 * recoil, -0.72 * kneel + impact(t, 1.3, 0.2, 26) * 0.03 * w, 0.55 * recoil + 0.2 * kneel);
      rot(neck, 0.3 * recoil - 0.15 * kneel, 0, 0);
      rot(head, 0.55 * recoil - 0.3 * kneel + spasm * 0.06, 0.4 * recoil, 0.25 * recoil);
      rot(jaw, -0.7 * recoil - 0.2 * kneel, 0, 0);
      rot(armR, -0.75 * recoil, 0, keys(t, K.frArmRZ) * w);
      rot(foreR, keys(t, K.frForeRX) * w, 0, 0);
      rot(shR, 0, 0, keys(t, K.frShRZ) * w);
      rot(armL, 0.5 * recoil + 0.4 * kneel, 0, -0.5 * recoil);
      rot(foreL, 0.4 * kneel, 0, 0);
      armIkL.w = Math.max(armIkL.w, keys(t, K.frIk) * w);
      armIkL.target.set(-0.95, 0.5, -0.8);
      legR.off.z += keys(t, K.frLegRZ) * w;
      legR.off.y += win(t, 0.08, 0.16, 0.22, 0.32) * 0.2 * w;
      legL.off.z += keys(t, K.frLegLZ) * w;
      legL.off.y += win(t, 0.3, 0.4, 0.5, 0.6) * 0.2 * w;
      p.knitLift += impact(t, 0.02, 0.35) * 0.8 * w;
      p.flare += recoil * 0.8;
      p.coreGlow += -0.5 * kneel;
      return 0;
    }
    case 'hitLight':
    case 'hitHeavy': {
      const a = s.name === 'hitHeavy' ? 2.1 : 1;
      const f = impact(t, 0, 0.13, 17) * w * a;
      const e = impact(t, 0, 0.2) * w * a;
      rot(chest, 0.07 * e, 0.06 * f, 0.03 * f);
      rot(spine, 0.05 * e, 0, 0);
      rot(head, 0.12 * f, 0, 0.05 * f);
      rot(shR, 0, 0, 0.06 * f);
      rot(armL, 0.1 * e, 0, 0);
      move(hips, 0, -0.02 * e, 0.05 * e * a);
      p.knitLift += 0.22 * e;
      return 0;
    }
    case 'stagger': {
      const kk = keys(t, K.stK) * w;
      const whipH = impact(t, 0, 0.3, 9) * w;
      rot(chest, 0.38 * kk, 0.15 * kk, 0);
      rot(spine, 0.2 * kk, 0, 0.06 * kk);
      move(hips, 0, -0.1 * kk, 0.38 * kk);
      rot(neck, 0.15 * kk, 0, 0);
      rot(head, 0.45 * whipH, 0, 0.2 * kk);
      rot(jaw, -0.4 * kk, 0, 0);
      rot(armR, 0.5 * kk, 0, 0.25 * kk);
      rot(foreR, -0.2 * kk, 0, 0);
      rot(armL, 0.6 * kk, 0, -0.3 * kk);
      rot(foreL, 0.3 * kk, 0, 0);
      legL.off.z += keys(t, K.stLegZ) * w;
      legL.off.y += win(t, 0.08, 0.18, 0.26, 0.36) * 0.2 * w;
      p.knitLift += impact(t, 0, 0.3) * 0.4 * w;
      p.flare += kk * 0.5;
      return 0;
    }
    case 'spawn': {
      const low = (1 - keys(t, K.spLow)) * w;
      const flex = win(t, 1.2, 1.7, 1.9, 2.4) * w;
      rot(spine, -0.5 * low + 0.2 * flex, 0, 0);
      rot(chest, -0.35 * low + 0.2 * flex, 0, 0);
      move(hips, 0, -0.75 * low + 0.1 * flex, 0);
      rot(head, -0.4 * low + 0.3 * flex, 0, 0);
      rot(armR, 0.5 * low, 0, 0.5 * flex);
      rot(foreR, 0.6 * low, 0, 0);
      rot(armL, 0.5 * low, 0, -0.5 * flex);
      rot(foreL, 0.8 * low, 0, 0);
      p.knitLift += 0.8 * low + 0.3 * flex;
      p.flare += flex;
      p.coreGlow += 2 * low;
      return 0;
    }
    case 'death': {
      // reel back, then the knees go: it folds forward onto its forearms and slumps to one side
      const arch = win(t, 0, 0.35, 0.7, 1.0) * w;
      const fall = keys(t, K.deFall) * w;
      const settle = keys(t, K.deSettle) * w;
      const thud = impact(t, 1.9, 0.2, 24) * w;
      rot(spine, 0.4 * arch - 0.62 * fall - 0.08 * settle, 0, 0.15 * settle);
      rot(chest, 0.3 * arch - 0.36 * fall, 0.2 * settle, 0.2 * settle);
      move(hips, 0.1 * settle, -0.84 * fall - 0.1 * settle + thud * 0.04, -0.3 * fall);
      rot(hips, -0.22 * fall, 0, 0.2 * settle);
      rot(neck, 0.3 * arch - 0.2 * fall, 0, 0);
      rot(head, 0.7 * arch - 0.3 * fall, 0, 0.3 * settle);
      rot(jaw, -0.7 * arch - 0.35 * settle, 0, 0);
      rot(armR, -0.75 * arch + 0.8 * fall, 0, 0.45 * arch + 0.3 * settle);
      rot(armL, -0.15 * arch + 0.8 * fall, 0.3 * arch, -0.7 * arch - 0.4 * settle);
      rot(foreL, 0.6 * fall, 0, 0);
      legR.off.z += 0.5 * fall; legL.off.z += 0.62 * fall;
      legR.off.x += 0.12 * settle; legL.off.x -= 0.18 * settle;
      const ik = keys(t, K.deIk) * w;
      armIkR.w = Math.max(armIkR.w, ik); armIkR.target.set(1.1 + 0.3 * settle, 0.6, -1.4 - 0.2 * settle);
      armIkL.w = Math.max(armIkL.w, ik); armIkL.target.set(-1.0 - 0.3 * settle, 0.5, -1.25 - 0.25 * settle);
      p.limp = Math.max(p.limp, keys(t, K.deLimp) * w);
      p.flare += arch * 1.0 - fall * 0.6;
      p.knitLift += keys(t, K.deKnit) * w;
      p.coreGlow += 1.5 * arch - 1.6 * keys(t, K.deCore) * w;
      return 0;
    }
    case 'generic': {
      const f = impact(t, 0, 0.2, 12) * w;
      rot(head, 0.12 * f, 0, 0.1 * f);
      rot(chest, 0.04 * f, 0, 0);
      return 0;
    }
    default:
      return 0;
  }
}
