/**
 * Scripted contextual prompts (Resonance confirm, duel beats). One at a time; the window is widened by the
 * difficulty scale; `onConfirm` or `onExpire` fires exactly once; replacing or clearing cancels silently.
 * Inside a scene (input context 'cinematic') the prompt's button is opted into the cinematic context while it is
 * up, so a zone never has to switch input to 'game' for a duel or Resonance beat.
 */
import type { ContextAction, Game } from '@/core/api';
import { windowScale } from '../tuning';
import { fin, warnOnce } from '../safe';

export class ContextActions {
  /** the action as the script passed it */
  action: ContextAction | null = null;
  /** what the HUD draws: the same action with the widened window */
  shown: ContextAction | null = null;
  private left = 0;
  private age = 0;
  /** the button opted into the 'cinematic' input context for the current action */
  private opted = false;

  constructor(private readonly game: Game) {}

  set(action: ContextAction | null): void {
    if (action && (typeof action.onConfirm !== 'function' || !action.button)) {
      warnOnce('ctx', 'setContextAction() needs a button and onConfirm — ignored');
      return;
    }
    this.release();
    this.action = action;
    this.age = 0;
    if (!action) {
      this.shown = null;
      return;
    }
    this.optIn(action);
    const w = fin(action.window, Infinity);
    this.left = action.window === Infinity ? Infinity : Math.max(0.05, w) * windowScale(this.game.settings.get('difficulty'));
    // the HUD draws its timer ring from `window`: show the widened value
    this.shown = this.left === action.window ? action : { ...action, window: this.left };
  }

  /** inside a scene, make the prompt's button readable (re-done after any context switch, which clears it) */
  private optIn(c: ContextAction): void {
    const input = this.game.input;
    const cine = input.context === 'cinematic';
    if (cine && !this.opted && typeof input.allowInCinematic === 'function') {
      input.allowInCinematic([c.button]);
      this.opted = true;
    } else if (!cine) {
      this.opted = false;
    }
  }

  private release(): void {
    if (!this.opted) return;
    this.opted = false;
    const input = this.game.input;
    if (input.context === 'cinematic' && typeof input.allowInCinematic === 'function') input.allowInCinematic(null);
  }

  tick(dt: number): void {
    const c = this.action;
    if (!c) return;
    this.optIn(c);
    this.age += dt;
    // automatic prompts confirm after a short readable beat
    const auto = c.autoConfirmable === true && this.game.settings.get('autoPrompts') === true && this.age >= Math.min(0.45, this.left * 0.5);
    if (auto || this.game.input.take(c.button) === true) {
      this.release();
      this.action = this.shown = null;
      try {
        c.onConfirm();
      } catch (err) {
        warnOnce(`ctx:${c.id}`, `context action "${c.id}" onConfirm threw: ${String(err)}`);
      }
      return;
    }
    this.left -= dt;
    if (this.left <= 0) {
      this.release();
      this.action = this.shown = null;
      try {
        c.onExpire?.();
      } catch (err) {
        warnOnce(`ctx:${c.id}`, `context action "${c.id}" onExpire threw: ${String(err)}`);
      }
    }
  }
}
