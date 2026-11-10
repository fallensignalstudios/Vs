/**
 * Mission-system test zones (T01, T02). They are NOT registered by the game: only the mission sandbox and the
 * tests call `registerTestZones`.
 */
import type { Game } from '@/core/api';
import { createT01, T01_ID, T02_ID } from './t01';
import { createT02 } from './t02';

export function registerTestZones(game: Game): void {
  game.mission.registerZone(createT01(game));
  game.mission.registerZone(createT02(game));
}

export { createT01, createT02, T01_ID, T02_ID };
