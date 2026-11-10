/** STUB — replaced by the humanoids agent. */
import type { CharacterCreateOpts, CharacterVisual, Game, HumanoidArchetype } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createHumanoid(_game: Game | null, archetype: HumanoidArchetype, _opts?: CharacterCreateOpts): CharacterVisual {
  return nullObject<CharacterVisual>('humanoid:' + archetype);
}
