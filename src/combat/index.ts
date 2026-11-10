/** STUB — replaced by the combat-player agent. */
import type { ActorManager, Game, PlayerController } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createActorManager(_game: Game): ActorManager {
  return nullObject<ActorManager>('actors');
}

export function createPlayerController(_game: Game): PlayerController {
  return nullObject<PlayerController>('player');
}
