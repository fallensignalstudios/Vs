/** STUB — replaced by the physics-nav agent. */
import type { Game, PhysicsWorld } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createPhysicsWorld(_game: Game | null): PhysicsWorld {
  return nullObject<PhysicsWorld>('physics');
}
