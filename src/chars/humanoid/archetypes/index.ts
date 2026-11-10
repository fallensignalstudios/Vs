/** Archetype registry. */
import type { HumanoidArchetype } from '@/core/api';
import type { ArchetypeDef } from '../figure';
import { selene, tarrik } from './heroes';
import { cross, dominionSoldier, enforcer, lyessa, malik } from './dominion';
import { lyric, medic, reformationMarine, reformationSoldier, sol, tharne } from './reformation';
import { kingWitness, linkbound, survivor } from './others';

export const ARCHETYPES: Record<HumanoidArchetype, ArchetypeDef> = {
  tarrik, selene, lyessa, tharne, lyric, malik, dominionSoldier, reformationSoldier, reformationMarine, enforcer,
  medic, survivor, linkbound, kingWitness, cross, sol,
};
export const FALLBACK_ARCHETYPE: ArchetypeDef = dominionSoldier;
