/**
 * Input subsystem — keyboard + mouse + Gamepad API + virtual (autoplay/test) input behind one contract.
 * See `InputSystem` in '@/core/api' (camera.ts). Works headless: with no DOM it simply reports no real input.
 */
import type { Game, InputSystem } from '@/core/api';
import type { LayoutMap } from './bindings';
import { InputSystemImpl, type InputEnv } from './system';

export { InputSystemImpl, type InputEnv } from './system';
export { ACTIONS } from './actions';
export { KEY_BINDINGS, MOUSE_BINDINGS, PAD, glyphFor, keyLabel } from './bindings';

/** Collect the browser objects the input system listens to; every member is optional. */
function browserEnv(game: Game): InputEnv {
  const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
  const canvas = game.canvas as HTMLCanvasElement | undefined;
  const isCanvas = !!canvas && typeof canvas.addEventListener === 'function';
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const keyboard = (nav as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } } | null)?.keyboard;
  let storage: InputEnv['storage'] = null;
  try {
    storage = globalThis.localStorage ?? null; // throws in some sandboxed frames
  } catch {
    storage = null;
  }
  return {
    win: hasDom ? window : null,
    doc: hasDom ? document : null,
    canvas: hasDom && isCanvas ? canvas : null,
    getGamepads: () => (nav && typeof nav.getGamepads === 'function' ? nav.getGamepads() : null),
    getLayoutMap: keyboard && typeof keyboard.getLayoutMap === 'function' ? () => (keyboard.getLayoutMap as () => Promise<LayoutMap>)() : null,
    storage,
  };
}

export function createInputSystem(game: Game): InputSystem {
  return new InputSystemImpl(game, browserEnv(game));
}
