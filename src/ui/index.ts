/** STUB — replaced by the ui agent. */
import type { Game, UiSystem } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createUiSystem(_game: Game): UiSystem {
  return nullObject<UiSystem>('ui');
}
