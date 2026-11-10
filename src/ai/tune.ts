/**
 * AI behaviour numbers (timings, ranges, speeds). Health, poise and attack damage live in TUNING.enemies
 * (src/combat/tuning.ts) — this file only holds what the brains themselves decide.
 */
import { DEG } from '@/core/mathx';

export const AI = {
  /** no attack is telegraphed for less than this (before the difficulty scale) */
  minTelegraph: 0.45,
  /** seconds between target re-evaluations */
  retarget: 0.5,
  /** seconds between path searches per actor (≤ 2 Hz) */
  repath: 0.5,

  cadence: { period: 1.6 },

  drone: {
    speed: 3.2,
    /** lateral reach either side of the lane post */
    slide: 3.2,
    /** the player closer than this makes the drone back off */
    retreatWithin: 4,
    retreatBy: 3.5,
    /** fraction of the telegraph during which the lane still tracks; then it is locked */
    trackFraction: 0.55,
    cooldown: [2.4, 3.3] as const,
    /** gap multiplier once the command emitter is destroyed */
    brokenGap: 1.6,
    /** period of synchronised volleys */
    syncPeriod: 3.8,
    /** emitter stagger → seconds of desynchronisation */
    desync: 8,
    ventSeconds: 1.2,
    range: 46,
    boltPoise: 4,
    turn: 5,
    /** contaminated: receiver down → stunned drift; network down → sluggish, then self-disable */
    interrupted: 6,
    downSelfDisable: 10,
    downSpeed: 0.4,
    downGap: 2.3,
    downSpread: 6 * DEG,
  },

  enforcer: {
    speed: 1.35,
    turn: 1.5,
    /** how far the line advances from its posts */
    leash: 24,
    /** distance the wall keeps from its target */
    standOff: 2.1,
    overlapWithin: 3.5,
    overlapArc: 200 * DEG,
    overlapFacing: 40 * DEG,
    bashRange: 2.5,
    batonRange: 2.3,
    telegraph: 0.55,
    meleeCooldown: [1.5, 2.4] as const,
    sidearmRange: [3.2, 26] as const,
    sidearmTelegraph: 0.6,
    sidearmCooldown: [2.6, 3.8] as const,
    sidearmSpeed: 60,
    /** seconds out of formation after a stagger */
    brokenFormation: 2.5,
    attackArc: 110 * DEG,
  },

  linkbound: {
    speed: 3.4,
    linkedSpeed: 2.6,
    turn: 7,
    lungeFrom: 3.4,
    lungeReach: 1.9,
    lungeArc: 110 * DEG,
    lungeSpeed: 7.5,
    telegraph: 0.6,
    recover: 0.9,
    cooldown: [1.2, 2.2] as const,
    /** ring the bodies without a melee token wait on */
    waitRing: 4.6,
    /** fraction of each cadence beat during which linked bodies move (the rest is the shared hesitation) */
    moveFraction: 0.62,
    severStagger: 1.5,
  },

  wallrunner: {
    speed: 5.4,
    clingHeight: 4,
    /** perch distance band from the target */
    perch: [6, 11] as const,
    telegraph: 0.95,
    pounceRange: 12,
    landRadius: 1.9,
    groundSeconds: 2.3,
    stalk: [1.6, 3.0] as const,
    lead: 0.45,
  },

  weaver: {
    speed: 2.3,
    band: [12, 18] as const,
    linkRange: 24,
    channel: 1.1,
    relink: 6,
    boltCooldown: [5, 7.5] as const,
    boltSpeed: 30,
    boltRange: 34,
    allSeveredStagger: 3,
    anchorRange: 30,
  },

  elite: {
    speed: 2.7,
    turn: 1.7,
    cooldown: [1.5, 2.3] as const,
    sweepRange: 4.3,
    sweepReach: 4.9,
    sweepArc: 150 * DEG,
    slamRange: [2.5, 8.5] as const,
    slamInner: 3.2,
    slamOuter: 6.8,
    slamOuterDamage: 0.55,
    chargeRange: [8, 24] as const,
    chargeSpeed: 13,
    chargeWidth: 2.8,
    chargeMax: 18,
    pulseEvery: [14, 20] as const,
    pulseField: 9,
    pulseSeconds: 7,
    threatRise: 0.24,
    threatFall: 0.55,
    threatHit: 18,
    /** phase B: seconds the joint stays open after a heavy attack / hp per second it regenerates on its own */
    exposeSeconds: 4.5,
    selfRegen: 8,
    /** damage-taken scale of the body: link armour in phase A, regenerating plates in phase B (1 once fractured) */
    armorLinked: 0.4,
    armorIsolated: 0.6,
    resonanceSeconds: 7,
    lowPressure: 3,
    fractureStagger: 5,
    freezeScale: 0.25,
  },

  companion: {
    walk: 2.2,
    run: 5.0,
    followNear: 2.6,
    followFar: 6.5,
    downSeconds: 4,
    /** downed voluntarily below this fraction of health, so a real death is rare */
    downAt: 0.12,
    recoverTo: 0.5,
    stuckSeconds: 3,
    /** never take a kill on the last member of an encounter below this health fraction */
    lastKillGuard: 0.4,
    engage: 26,
  },
} as const;
