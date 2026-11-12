/**
 * (ship) Hosting glue for the embedded build. The game is served inside an iframe on claude.ai that may be
 * sandboxed: pointer lock and fullscreen may be refused, storage may throw (settings, rebinds and saves are
 * guarded where they are read and written, and checkpoints then live in memory), and audio unlocks on the
 * first gesture inside the frame (src/audio/index.ts). What is left for here:
 *
 *  - when pointer lock cannot be had, say once — one line — how to look around instead (hold the right mouse
 *    button and drag; the arrow keys also turn). Keyboard play is unchanged; nothing is required of fullscreen.
 */
import type { Game } from './api';

/** the one-line drag-look hint (shown once per session, only when pointer lock is unavailable) */
export const DRAG_LOOK_HINT = 'Mouse capture is blocked here: hold the right mouse button and drag to look (arrow keys turn too).';

/** Show the drag-look hint the first time play runs with pointer lock unavailable. Returns an uninstall. */
export function installHostingHints(game: Game): () => void {
  let shown = false;
  let live = true;
  const prevTick = game.tick.bind(game);
  (game as { tick: Game['tick'] }).tick = (dt: number, render?: boolean) => {
    prevTick(dt, render);
    if (shown || !live) return;
    const input = game.input;
    if (game.phase !== 'playing' || game.paused || input.context !== 'game' || input.device !== 'kbm') return;
    if (input.virtual.active || input.pointerLockDenied !== true) return;
    shown = true;
    game.ui.toast(DRAG_LOOK_HINT, 'info');
  };
  return () => {
    live = false;
  };
}
