/** Introspection helpers for sandboxes and tests. */
import type { HumanoidArchetype } from '@/core/api';
import { ARCHETYPES } from './archetypes';
import { getFigure } from './figure';
import { GENERIC } from './clips/generic';
import { listClips } from './anim/moveset';

/** Every action name the archetype has an authored clip for. */
export function listActions(archetype: HumanoidArchetype): string[] {
  const def = ARCHETYPES[archetype];
  if (!def) return listClips(GENERIC);
  return listClips(getFigure(archetype, def, GENERIC, 0, 0).moveset);
}

export function listArchetypes(): HumanoidArchetype[] {
  return Object.keys(ARCHETYPES) as HumanoidArchetype[];
}
