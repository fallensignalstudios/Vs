/**
 * Zone registry (FOUNDATION). Each zone module default-exports a ZoneDef; they are registered here in mission
 * order. Z01 is the reference zone; the others are pass-through stubs (./stub.ts) until their authors replace
 * the file — the import and registration below never change.
 */
import type { Game } from '@/core/api';
import z00 from './z00';
import z01 from './z01';
import z02 from './z02';
import z03 from './z03';
import z04 from './z04';
import z05 from './z05';
import z06 from './z06';
import z07 from './z07';
import z08 from './z08';
import z09 from './z09';
import z10 from './z10';
import z11 from './z11';
import z12 from './z12';

export function registerZones(game: Game): void {
  // ZONES:BEGIN
  for (const zone of [z00, z01, z02, z03, z04, z05, z06, z07, z08, z09, z10, z11, z12]) game.mission.registerZone(zone);
  // ZONES:END
}
