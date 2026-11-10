/** STUB — replaced by the mission agent. */
import type { Game, MissionSystem } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createMissionSystem(_game: Game): MissionSystem {
  return nullObject<MissionSystem>('mission');
}
