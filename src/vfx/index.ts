/** STUB — replaced by the vfx agent. */
import type { Game, VfxSystem } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createVfxSystem(_game: Game): VfxSystem {
  return nullObject<VfxSystem>('vfx');
}
