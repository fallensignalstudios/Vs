/**
 * Input subsystem — keyboard + mouse + Gamepad API + virtual (autoplay/test) input behind one contract.
 * See `InputSystem` in '@/core/api' (camera.ts). Works headless: with no DOM it simply reports no real input.
 */
import type { Game, InputSystem } from '@/core/api';
import { InputSystemImpl, type InputEnv } from './system';

export { InputSystemImpl, type InputEnv } from './system';
export { ACTIONS } from './actions';
export { KEY_BINDINGS, MOUSE_BINDINGS, PAD, glyphFor } from './bindings';

/** Collect the browser objects the input system listens to; every member is optional. */
function browserEnv(game: Game): InputEnv {
  const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
  const canvas = game.canvas as HTMLCanvasElement | undefined;
  const isCanvas = !!canvas && typeof canvas.addEventListener === 'function';
  return {
    win: hasDom ? window : null,
    doc: hasDom ? document : null,
    canvas: hasDom && isCanvas ? canvas : null,
    getGamepads: () => (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null),
  };
}

export function createInputSystem(game: Game): InputSystem {
  return new InputSystemImpl(game, browserEnv(game));
}
