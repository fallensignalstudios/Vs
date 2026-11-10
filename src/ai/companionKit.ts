/** What each humanoid archetype brings to a fight as a companion: its weapon, its numbers, its loadout. */
import type { Element, HumanoidArchetype, HumanoidLoadout } from '@/core/api';

export interface CompanionKit {
  /** how it fights in combat / hold mode */
  style: 'melee' | 'ranged' | 'none';
  /** support damage: deliberately well below the protagonists' so companions never solve an encounter */
  damage: number;
  poise: number;
  /** seconds between attacks */
  interval: number;
  element: Element;
  tracer: 'warm' | 'cold' | 'rifle';
  muzzle: 'muzzleWarm' | 'muzzleCold';
  sfx: string;
  /** ranged companions switch to this melee damage when cornered (0 = they back off instead) */
  closeDamage: number;
  loadout: HumanoidLoadout;
  /** loadout while aiming / firing */
  drawn: HumanoidLoadout;
  aimPose: string;
}

const RIFLE: CompanionKit = {
  style: 'ranged', damage: 7, poise: 6, interval: 1.7, element: 'kinetic', tracer: 'rifle', muzzle: 'muzzleWarm',
  sfx: 'cinderlineShot', closeDamage: 0, loadout: { ranged: true }, drawn: { ranged: true }, aimPose: 'aimRifle',
};

const NONE: CompanionKit = {
  style: 'none', damage: 0, poise: 0, interval: 9, element: 'kinetic', tracer: 'rifle', muzzle: 'muzzleWarm',
  sfx: 'cinderlineShot', closeDamage: 0, loadout: { melee: false, ranged: false }, drawn: { melee: false, ranged: false }, aimPose: 'aim',
};

const KITS: Partial<Record<HumanoidArchetype, CompanionKit>> = {
  tarrik: {
    style: 'melee', damage: 16, poise: 22, interval: 1.5, element: 'cinder', tracer: 'warm', muzzle: 'muzzleWarm',
    sfx: 'swingHeavy', closeDamage: 16, loadout: { melee: true }, drawn: { melee: true }, aimPose: 'aim',
  },
  selene: {
    style: 'ranged', damage: 11, poise: 6, interval: 1.6, element: 'frost', tracer: 'cold', muzzle: 'muzzleCold',
    sfx: 'axiomShot', closeDamage: 10, loadout: { melee: true }, drawn: { ranged: true }, aimPose: 'aim',
  },
  lyessa: { ...RIFLE, damage: 10, interval: 1.45 },
  dominionSoldier: RIFLE,
  malik: RIFLE,
  reformationSoldier: { ...RIFLE, tracer: 'cold', muzzle: 'muzzleCold', sfx: 'axiomShot' },
  reformationMarine: { ...RIFLE, tracer: 'cold', muzzle: 'muzzleCold', sfx: 'axiomShot', damage: 8 },
  lyric: { ...NONE, loadout: { melee: false, ranged: false, prop: 'case' } },
};

export function kitFor(who: HumanoidArchetype | string): CompanionKit {
  return KITS[who as HumanoidArchetype] ?? NONE;
}

/** health / poise of a companion body */
export function companionHealth(who: HumanoidArchetype | string): { hp: number; poise: number } {
  if (who === 'tarrik') return { hp: 140, poise: 60 };
  if (who === 'selene') return { hp: 100, poise: 35 };
  if (who === 'lyessa') return { hp: 110, poise: 40 };
  return { hp: 80, poise: 30 };
}

/** looping whole-body poses during which the body must not be moved by anything */
export const HELD_POSES: ReadonlySet<string> = new Set([
  'sit', 'sitTalk', 'sitInjured', 'kneel', 'kneelTend', 'lieInjured', 'trapped', 'cower', 'distress', 'grounding',
  'liftPlate', 'holdConsole', 'holdPlane', 'tetherStop',
]);
