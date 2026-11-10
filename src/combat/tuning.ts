/**
 * Every combat number in one place (BRIEF §5). Read by combat, the player controller and the AI.
 * Units: metres, seconds, radians, hp. Change values here, never inline.
 */
import type { AbilityId, CombatTuning, Difficulty, ProtagonistId, WeaponId } from '@/core/api';
import { DEG } from '@/core/mathx';

/** Echo rule keys (see PlayerController.addEcho). */
export type EchoRule =
  | 'blocked' | 'counter' | 'poiseBreak' | 'heavyHit' | 'kill'
  | 'weakPoint' | 'flank' | 'sever' | 'deflect' | 'device' | 'hit';

export interface MeleeStep {
  action: string;
  damage: number;
  poise: number;
  /** total frontal arc */
  arc: number;
  /** reach from the wielder's centre */
  range: number;
  /** root-motion lunge distance before the hit lands */
  lunge: number;
  knockback: number;
  /** fallback timing when the visual reports none */
  duration: number;
  hitAt: number;
}

export interface RangedKit {
  id: WeaponId;
  name: string;
  damage: number;
  poise: number;
  mag: number;
  reserve: number;
  /** seconds between shots */
  interval: number;
  reload: number;
  range: number;
  /** minimum weak-point multiplier (0 = use the weak point's own) */
  weakPointScale: number;
  seversLinks: boolean;
  tracer: 'warm' | 'cold';
  muzzle: string;
  sfx: string;
  kickPitch: number;
  kickYaw: number;
  shake: number;
  knockback: number;
}

export interface AbilityKit {
  id: AbilityId;
  name: string;
  cost: number;
  cooldown: number;
}

export interface ProtagonistKit {
  id: ProtagonistId;
  name: string;
  hp: number;
  poise: number;
  meleeId: WeaponId;
  meleeName: string;
  light: MeleeStep[];
  heavy: MeleeStep;
  ranged: RangedKit;
  guard: 'hold' | 'deflect';
  guardArc: number;
  abilities: [AbilityKit, AbilityKit];
  echo: Partial<Record<EchoRule, number>>;
  /** element colour for trails / Echo feedback */
  color: number;
  trailColor: number;
}

const tarrik: ProtagonistKit = {
  id: 'tarrik',
  name: 'Tarrik',
  hp: 140,
  poise: 60,
  meleeId: 'velkorran',
  meleeName: 'Velkorran',
  light: [
    { action: 'attackLight1', damage: 22, poise: 18, arc: 130 * DEG, range: 2.7, lunge: 0.9, knockback: 1.5, duration: 0.55, hitAt: 0.25 },
    { action: 'attackLight2', damage: 24, poise: 20, arc: 140 * DEG, range: 2.7, lunge: 0.8, knockback: 1.5, duration: 0.6, hitAt: 0.27 },
    { action: 'attackLight3', damage: 34, poise: 35, arc: 110 * DEG, range: 2.9, lunge: 1.1, knockback: 3.5, duration: 0.75, hitAt: 0.34 },
  ],
  heavy: { action: 'attackHeavy', damage: 55, poise: 60, arc: 150 * DEG, range: 3.0, lunge: 1.0, knockback: 5, duration: 1.05, hitAt: 0.58 },
  ranged: {
    id: 'cinderline', name: 'Cinderline', damage: 26, poise: 30, mag: 6, reserve: 24, interval: 0.6, reload: 1.7, range: 60,
    weakPointScale: 0, seversLinks: false, tracer: 'warm', muzzle: 'muzzleWarm', sfx: 'cinderlineShot',
    kickPitch: 2.4, kickYaw: 0.9, shake: 0.22, knockback: 2,
  },
  guard: 'hold',
  guardArc: 120 * DEG,
  abilities: [
    { id: 'cinderSlam', name: 'Cinder Slam', cost: 35, cooldown: 6 },
    { id: 'cinderSticky', name: 'Sticky Grenade', cost: 30, cooldown: 6 },
  ],
  echo: { blocked: 4, counter: 22, poiseBreak: 15, heavyHit: 6, kill: 5 },
  color: 0xff6a1a,
  trailColor: 0xffb070,
};

const selene: ProtagonistKit = {
  id: 'selene',
  name: 'Selene',
  hp: 100,
  poise: 35,
  meleeId: 'verity',
  meleeName: 'Verity',
  light: [
    { action: 'attackLight1', damage: 14, poise: 8, arc: 110 * DEG, range: 2.2, lunge: 0.7, knockback: 0.6, duration: 0.34, hitAt: 0.14 },
    { action: 'attackLight2', damage: 14, poise: 9, arc: 110 * DEG, range: 2.2, lunge: 0.6, knockback: 0.6, duration: 0.34, hitAt: 0.14 },
    { action: 'attackLight3', damage: 16, poise: 11, arc: 120 * DEG, range: 2.3, lunge: 0.7, knockback: 0.8, duration: 0.38, hitAt: 0.17 },
    { action: 'attackLight4', damage: 22, poise: 14, arc: 130 * DEG, range: 2.4, lunge: 1.0, knockback: 2.5, duration: 0.45, hitAt: 0.21 },
  ],
  heavy: { action: 'attackHeavy', damage: 36, poise: 30, arc: 360 * DEG, range: 2.5, lunge: 0.6, knockback: 3, duration: 0.7, hitAt: 0.25 },
  ranged: {
    id: 'axiom', name: 'Axiom', damage: 34, poise: 10, mag: 8, reserve: 32, interval: 0.38, reload: 1.3, range: 90,
    weakPointScale: 2.5, seversLinks: true, tracer: 'cold', muzzle: 'muzzleCold', sfx: 'axiomShot',
    kickPitch: 1.2, kickYaw: 0.5, shake: 0.12, knockback: 0.5,
  },
  guard: 'deflect',
  guardArc: 150 * DEG,
  abilities: [
    { id: 'stasisGrenade', name: 'Stasis Grenade', cost: 35, cooldown: 6 },
    { id: 'dispatch', name: 'Dispatch', cost: 30, cooldown: 6 },
  ],
  echo: { weakPoint: 10, flank: 10, sever: 25, deflect: 15, device: 20, kill: 5, hit: 2 },
  color: 0xcfeeff,
  trailColor: 0xbfe6ff,
};

/** BRIEF §5 enemy roles: base hp / poise and the damage of each attack (the AI reads these). */
const enemies = {
  secDrone: { hp: 60, poise: 20, hover: 1.8, radius: 0.45, height: 0.7, boltDamage: 9, volley: 3, telegraph: 0.8, boltSpeed: 40, ventMultiplier: 2 },
  contamDrone: { hp: 55, poise: 20, hover: 1.8, radius: 0.45, height: 0.7, boltDamage: 9, volley: 3, telegraph: 0.8, boltSpeed: 40, ventMultiplier: 2 },
  enforcer: { hp: 160, poise: 80, radius: 0.5, height: 2.0, guardArc: 140 * DEG, flankMultiplier: 1.5, bash: 14, baton: 18, sidearm: 8 },
  linkbound: { hp: 70, poise: 30, radius: 0.4, height: 1.85, lunge: 16, linkedPoiseScale: 1 / 3, linkedDamageScale: 0.5 },
  wallrunner: { hp: 50, poise: 15, radius: 0.45, height: 1.2, pounce: 20 },
  weaver: { hp: 90, poise: 40, radius: 0.5, height: 2.1, bolt: 12, maxLinks: 3 },
  elite: { hp: 900, poise: 200, radius: 1.2, height: 3.6, regen: 25, jointMultiplier: 3, fractureFraction: 0.35, sweep: 28, slam: 32, charge: 36 },
} as const;

export const TUNING = {
  /** damage-taken multiplier when the target is the player */
  difficultyDamageTaken: { story: 0.6, standard: 1, hard: 1.15 } as Record<Difficulty, number>,
  /** multiplier on player timing windows (perfect guard, counter, context prompts) */
  difficultyWindow: { story: 1.6, standard: 1, hard: 0.9 } as Record<Difficulty, number>,

  actor: {
    /** seconds without poise damage before poise starts to recover */
    poiseRecoverDelay: 2.5,
    /** fraction of max poise recovered per second */
    poiseRecoverRate: 0.6,
    staggerSeconds: 1.1,
    guardBreakSeconds: 1.5,
    /** seconds an attacker is staggered by a perfect guard / parry */
    perfectGuardStagger: 1.6,
    /** exponential decay rate of `impulse` (1/s) */
    impulseDecay: 7,
    /** separation: fraction of the overlap resolved per second, capped at maxPush m/s */
    separationRate: 9,
    separationMaxPush: 3.2,
    corpseSeconds: 2.5,
    dissolveSeconds: 1.3,
    /** flying: how fast the hover height follows the ground (1/s), bob amplitude (m) and rate (rad/s) */
    hoverFollow: 4,
    hoverBob: 0.06,
    hoverBobRate: 2.1,
    /** seconds between attempts to rescue an actor that physics reports as lost */
    unstickInterval: 0.75,
    defaultGuardArc: 120 * DEG,
  },

  hit: {
    /** poise damage multiplier on a blocked hit */
    guardPoiseScale: 0.6,
    /** hits from more than this far off the target's facing count as flanks */
    flankAngle: 100 * DEG,
    frozenDamageScale: 1.5,
    /** weak-point multiplier when a hit is forced `weakPoint` and the target defines none */
    defaultWeakPoint: 2,
    /** melee hit-stop: lerp(min, max, damage / hitStopFullAt) */
    hitStopMin: 0.04,
    hitStopMax: 0.11,
    hitStopFullAt: 60,
    hitStopKillBonus: 0.02,
    /** camera shake = damage / shakeFullAt, clamped; heavy hits and hits on the player always shake */
    shakeFullAt: 70,
    flashHit: 0xfff4e0,
    flashWeak: 0xffe08a,
    flashHurt: 0xff4a3a,
    flashBlock: 0x9fc8ff,
  },

  move: {
    walk: 2.2,
    run: 5.2,
    sprint: 7.2,
    aim: 2.6,
    guard: 2.0,
    charge: 0.9,
    accel: 42,
    decel: 34,
    /** rad/s */
    turnRate: 12,
    strafeTurnRate: 16,
    radius: 0.4,
    /** follow-camera eye height as a fraction of the figure's height */
    eyeFraction: 0.86,
  },

  dodge: {
    distance: 4.5,
    time: 0.45,
    iframes: 0.3,
    recovery: 0.1,
    cooldown: 0.12,
  },

  melee: {
    /** input buffer (s) */
    buffer: 0.25,
    /** soft target magnetism when not locked on */
    magnetRange: 3.5,
    magnetHalfAngle: 50 * DEG,
    /** turn rate toward the target during wind-up (rad/s) */
    windupTurn: 14,
    /** seconds after the last hit of a swing at which the next combo input / dodge may cancel the recovery */
    comboCancel: 0.07,
    /** combo resets after this long without an attack */
    comboReset: 0.7,
    /** fraction of the remaining recovery after which movement input cancels it */
    moveCancel: 0.55,
    /** stop the lunge this far from the target's surface */
    lungeStandOff: 0.75,
    chargeFull: 0.8,
    chargeMaxHold: 2.2,
    chargeScale: 1.5,
    /** seconds before the hit at which a held heavy turns into a charge */
    chargeGate: 0.16,
    /** vertical reach of a swing above / below the feet */
    reachUp: 2.9,
    reachDown: 0.9,
    linkRadius: 0.45,
  },

  guard: {
    perfectWindow: 0.22,
    /** a re-press sooner than this after the last press does not re-arm the perfect window */
    rearm: 0.45,
    counterWindow: 0.6,
    counterDamage: 42,
    counterPoise: 90,
    counterRange: 4.2,
    slowMoScale: 0.3,
    slowMoSeconds: 0.22,
    deflectSeconds: 0.5,
    deflectCooldown: 0.2,
    deflectChip: 0.35,
    /** damage multiplier of a reflected projectile */
    reflectScale: 2,
    reflectPoise: 20,
  },

  ranged: {
    /** bullet magnetism cone (settings.aimAssist) */
    magnetism: 1.5 * DEG,
    assistRange: 45,
    autoReloadDelay: 0.35,
  },

  abilities: {
    cinderSlam: { radius: 5, damage: 40, poise: 70, knockback: 6.5, reach: 1.3, superArmor: 0.7 },
    cinderSticky: { speed: 24, gravity: 7, fuse: 1.6, radius: 4, damage: 60, poise: 60, knockback: 6, maxFlight: 2.2, innerRadius: 2 },
    stasisGrenade: { speed: 22, gravity: 9, radius: 4.5, seconds: 4, maxFlight: 1.6 },
    dispatch: { range: 14, damage: 55, poise: 40, bonus: 2, behind: 0.95, vanishAt: 0.1, cone: 9 * DEG },
  },

  lockOn: {
    range: 32,
    halfAngle: 38 * DEG,
    dropRange: 42,
    losGrace: 2,
    /** look delta (rad, accumulated over flickWindow) that switches target */
    flick: 0.085,
    flickWindow: 0.18,
    flickCooldown: 0.4,
  },

  scan: { seconds: 3, cooldown: 4, range: 34, color: 0xa8d8ff },

  echo: { max: 100 },

  pickups: { radius: 1.3, sustain: 35, echo: 20 },

  player: {
    lowHealth: 0.3,
    heartbeat: 0.9,
    /** seconds of grace after a hit lands on the player before another hit-stop is issued */
    hurtShake: 0.45,
  },

  kits: { tarrik, selene } as Record<ProtagonistId, ProtagonistKit>,
  enemies,
} satisfies CombatTuning & Record<string, unknown>;

export type Tuning = typeof TUNING;

/** Difficulty scale helpers (unknown values fall back to 'standard'). */
export function damageTakenScale(d: Difficulty | string | undefined): number {
  const v = (TUNING.difficultyDamageTaken as Record<string, number>)[String(d)];
  return typeof v === 'number' ? v : 1;
}
export function windowScale(d: Difficulty | string | undefined): number {
  const v = (TUNING.difficultyWindow as Record<string, number>)[String(d)];
  return typeof v === 'number' ? v : 1;
}
