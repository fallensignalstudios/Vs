/**
 * Mission system factory: zone registry + loading, beat runner, ZoneRuntime, cinematics, checkpoints / saves.
 * Contract: src/core/api/mission.ts.
 */
import type { Game, MissionSystem } from '@/core/api';
import { MissionSystemImpl } from './system';

export function createMissionSystem(game: Game): MissionSystem {
  return new MissionSystemImpl(game);
}

export { lineDuration } from './dialogue';
export { deriveCheckpoints, firstZone, orderedZones } from './checkpoints';
export { SAVE_KEY, SAVE_VERSION, CHECKPOINT_ORDER, createMissionState, validateState } from './save';
