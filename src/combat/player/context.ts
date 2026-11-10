/**
 * Scripted contextual prompts (Resonance confirm, duel beats). One at a time; the window is widened by the
 * difficulty scale; `onConfirm` or `onExpire` fires exactly once; replacing or clearing cancels silently.
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

  constructor(private readonly game: Game) {}

  set(action: ContextAction | null): void {
    if (action && (typeof action.onConfirm !== 'function' || !action.button)) {
      warnOnce('ctx', 'setContextAction() needs a button and onConfirm — ignored');
      return;
    }
    this.action = action;
    this.age = 0;
    if (!action) {
      this.shown = null;
      return;
    }
    const w = fin(action.window, Infinity);
    this.left = action.window === Infinity ? Infinity : Math.max(0.05, w) * windowScale(this.game.settings.get('difficulty'));
    // the HUD draws its timer ring from `window`: show the widened value
    this.shown = this.left === action.window ? action : { ...action, window: this.left };
  }

  tick(dt: number): void {
    const c = this.action;
    if (!c) return;
    this.age += dt;
    // automatic prompts confirm after a short readable beat
    const auto = c.autoConfirmable === true && this.game.settings.get('autoPrompts') === true && this.age >= Math.min(0.45, this.left * 0.5);
    if (auto || this.game.input.take(c.button) === true) {
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
      this.action = this.shown = null;
      try {
        c.onExpire?.();
      } catch (err) {
        warnOnce(`ctx:${c.id}`, `context action "${c.id}" onExpire threw: ${String(err)}`);
      }
    }
  }
}
