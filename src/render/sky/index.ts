/** STUB — replaced by the sky-scenic agent. */
import type { Game, SkySystem } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createSkySystem(_game: Game): SkySystem {
  return nullObject<SkySystem>('sky');
}
