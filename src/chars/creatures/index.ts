/** STUB — replaced by the creatures agent. */
import type { CharacterCreateOpts, CharacterVisual, CreatureArchetype, DeviceArchetype, Game } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createCreature(_game: Game | null, archetype: CreatureArchetype | DeviceArchetype, _opts?: CharacterCreateOpts): CharacterVisual {
  return nullObject<CharacterVisual>('creature:' + archetype);
}
