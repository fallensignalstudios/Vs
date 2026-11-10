/** STUB — replaced by the camera-input agent. */
import type { Game, InputSystem } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createInputSystem(_game: Game): InputSystem {
  return nullObject<InputSystem>('input');
}
