/** STUB — replaced by the mission agent. */
import type { DebugApi, Game } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createDebugApi(_game: Game): DebugApi {
  return nullObject<DebugApi>('debug');
}
