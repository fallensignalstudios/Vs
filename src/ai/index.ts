/** STUB — replaced by the ai agent. */
import type { AiSystem, Game } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createAiSystem(_game: Game): AiSystem {
  return nullObject<AiSystem>('ai');
}
