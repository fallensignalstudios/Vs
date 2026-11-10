/**
 * Combat — actor model, the damage resolver, the player controller and the two protagonist kits.
 * Contract: src/core/api/combat.ts. Numbers: ./tuning.ts (`TUNING`, also read by the AI).
 */
import type { ActorManager, Game, PickupHandle, PickupKind, PlayerController, Vec3Like } from '@/core/api';
import { ActorManagerImpl } from './manager';
import { PlayerControllerImpl } from './player/controller';
import { pickupsOf } from './player/pickups';

export { TUNING, damageTakenScale, windowScale } from './tuning';
export type { EchoRule, MeleeStep, ProtagonistKit, RangedKit, Tuning } from './tuning';

export function createActorManager(game: Game): ActorManager {
  return new ActorManagerImpl(game);
}

export function createPlayerController(game: Game): PlayerController {
  return new PlayerControllerImpl(game);
}

/**
 * Drop a floating pickup at `pos` (snapped to the ground below). Collected when the protagonist walks into it
 * and it is useful: 'sustain' +35 hp · 'ammo' magazine and reserve refilled · 'echo' +20 Echo. Emits
 * `player:pickup`. Pickups disappear on 'zone:loading'; the handle removes one early.
 */
export function spawnPickup(game: Game, kind: PickupKind, pos: Vec3Like): PickupHandle {
  return pickupsOf(game).spawn(kind, pos);
}
