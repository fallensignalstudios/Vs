/**
 * Action table + per-context visibility + the pure, DOM-free action state machine (edge latching, hold
 * timers, consume, context switching, menu key-repeat). Everything here is allocation-free per frame.
 */
import type { ButtonAction, InputContext } from '@/core/api';

/** Every ButtonAction, in a stable order. Index = slot in the typed state arrays. */
export const ACTIONS = [
  'attack', 'heavy', 'guard', 'aim', 'dodge', 'sprint', 'interact', 'ability1', 'ability2', 'lockOn', 'scan',
  'reload', 'swapShoulder', 'pause', 'skip', 'confirm', 'cancel', 'menuUp', 'menuDown', 'menuLeft', 'menuRight',
] as const satisfies readonly ButtonAction[];

/** Compile-time guarantee that ACTIONS covers the whole ButtonAction union. */
type MissingAction = Exclude<ButtonAction, (typeof ACTIONS)[number]>;
const exhaustive: MissingAction extends never ? true : never = true;
void exhaustive;

export const ACTION_COUNT = ACTIONS.length;

const INDEX = new Map<string, number>(ACTIONS.map((a, i) => [a, i]));
const warned = new Set<string>();

/** Slot of an action, or -1 (with a single warning) for an unknown name coming from untyped callers. */
export function actionIndex(a: ButtonAction): number {
  const i = INDEX.get(a);
  if (i !== undefined) return i;
  const key = String(a);
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[input] unknown action "${key}" — reads as not pressed`);
  }
  return -1;
}

/** Typed slot lookup for internal tables (throws at module load only if the table itself is wrong). */
export const A = Object.fromEntries(ACTIONS.map((a, i) => [a, i])) as Record<ButtonAction, number>;

const mask = (list: readonly ButtonAction[]): Uint8Array => {
  const m = new Uint8Array(ACTION_COUNT);
  for (const a of list) m[A[a]] = 1;
  return m;
};

/**
 * Which actions are readable in each context.
 *  - game: everything (gameplay + skip/confirm/cancel/menu*, so a HUD-level prompt can never soft-lock)
 *  - menu: confirm / cancel / menu directions / pause — gameplay actions read false
 *  - cinematic: skip / pause only
 */
export const CONTEXT_MASK: Record<InputContext, Uint8Array> = {
  game: mask(ACTIONS),
  menu: mask(['confirm', 'cancel', 'menuUp', 'menuDown', 'menuLeft', 'menuRight', 'pause']),
  cinematic: mask(['skip', 'pause']),
};

/** Holds that survive a switch INTO the game context without a re-press (they resume, but fire no edge). */
const CARRY_INTO_GAME = mask(['sprint', 'aim', 'guard']);

const MENU_DIRS = [A.menuUp, A.menuDown, A.menuLeft, A.menuRight] as const;
/** seconds before a held menu direction starts repeating, then the repeat interval */
export const MENU_REPEAT_DELAY = 0.42;
export const MENU_REPEAT_INTERVAL = 0.13;

/**
 * Per-action state. The owner fills `raw` (physical devices) and `virt` (programmatic input) for this frame
 * and calls `latch(dt)` once per tick; everything else is derived.
 */
export class ActionStates {
  /** merged physical state (keyboard | mouse | gamepad) for the current frame */
  readonly raw = new Uint8Array(ACTION_COUNT);
  /** virtual (autoplay / test) state for the current frame — deliberate, so never release-blocked */
  readonly virt = new Uint8Array(ACTION_COUNT);
  private readonly eff = new Uint8Array(ACTION_COUNT);
  private readonly press = new Uint8Array(ACTION_COUNT);
  private readonly release = new Uint8Array(ACTION_COUNT);
  private readonly consumed = new Uint8Array(ACTION_COUNT);
  /** raw-down actions that must be released before they count again (set by context switches) */
  private readonly blocked = new Uint8Array(ACTION_COUNT);
  private readonly held = new Float32Array(ACTION_COUNT);
  private readonly lastHeld = new Float32Array(ACTION_COUNT);
  private readonly repeat = new Float32Array(MENU_DIRS.length);
  /** press-to-toggle latches for `engaged()` (accessibility: settings.holdToToggle) */
  private readonly latched = new Uint8Array(ACTION_COUNT);
  private allow = CONTEXT_MASK.game;
  private ctx: InputContext = 'game';

  get context(): InputContext {
    return this.ctx;
  }

  /** Latch edges for this tick from `raw`. `toggle` = settings.holdToToggle. */
  latch(dt: number, toggle = false): void {
    const { raw, virt, eff, press, release, consumed, blocked, held, lastHeld, allow, latched } = this;
    for (let i = 0; i < ACTION_COUNT; i++) {
      if (!raw[i]) blocked[i] = 0;
      const was = eff[i];
      const now = allow[i] && ((raw[i] && !blocked[i]) || virt[i]) ? 1 : 0;
      eff[i] = now;
      consumed[i] = 0;
      press[i] = now && !was ? 1 : 0;
      release[i] = !now && was ? 1 : 0;
      if (now) {
        if (!was) held[i] = 0;
        held[i] += dt;
      } else if (was) {
        lastHeld[i] = held[i];
        held[i] = 0;
      }
      if (!toggle || !allow[i]) latched[i] = 0;
      else if (press[i]) latched[i] ^= 1;
    }
    // Key-repeat for menu navigation: a held direction pulses `pressed` again after a delay.
    for (let k = 0; k < MENU_DIRS.length; k++) {
      const i = MENU_DIRS[k];
      if (!eff[i]) continue;
      if (press[i]) {
        this.repeat[k] = MENU_REPEAT_DELAY;
      } else {
        this.repeat[k] -= dt;
        if (this.repeat[k] <= 0) {
          press[i] = 1;
          this.repeat[k] += MENU_REPEAT_INTERVAL;
          if (this.repeat[k] <= 0) this.repeat[k] = MENU_REPEAT_INTERVAL;
        }
      }
    }
  }

  /**
   * Switch context immediately (mid-tick safe). A key can never act in two contexts: every press latched
   * this tick is swallowed, and anything physically held must be released before it counts again — except
   * sprint/aim/guard, which resume silently when gameplay returns. Virtual holds are never blocked.
   */
  setContext(ctx: InputContext): void {
    if (ctx === this.ctx) return;
    const allow = CONTEXT_MASK[ctx];
    if (!allow) {
      console.warn(`[input] unknown context "${String(ctx)}" — ignored`);
      return;
    }
    this.ctx = ctx;
    this.allow = allow;
    const { raw, virt, eff, press, release, blocked, held, lastHeld } = this;
    this.latched.fill(0);
    for (let i = 0; i < ACTION_COUNT; i++) {
      const was = eff[i];
      const carries = ctx === 'game' && CARRY_INTO_GAME[i] === 1;
      if (carries) blocked[i] = 0;
      else if (raw[i]) blocked[i] = 1;
      const now = allow[i] && ((raw[i] && !blocked[i]) || virt[i]) ? 1 : 0;
      eff[i] = now;
      press[i] = 0;
      if (was && !now) {
        release[i] = 1;
        lastHeld[i] = held[i];
        held[i] = 0;
      } else if (now && !was) {
        held[i] = 0;
      }
    }
  }

  down(i: number): boolean {
    return i >= 0 && this.eff[i] === 1;
  }

  pressed(i: number): boolean {
    return i >= 0 && this.press[i] === 1 && this.consumed[i] === 0;
  }

  released(i: number): boolean {
    return i >= 0 && this.release[i] === 1;
  }

  heldTime(i: number): number {
    return i >= 0 ? this.held[i] : 0;
  }

  lastHeldTime(i: number): number {
    return i >= 0 ? this.lastHeld[i] : 0;
  }

  consume(i: number): void {
    if (i >= 0) this.consumed[i] = 1;
  }

  /** hold state that honours press-to-toggle: the latch when toggling, plain `down` otherwise */
  engaged(i: number, toggle: boolean): boolean {
    if (i < 0) return false;
    return toggle ? this.latched[i] === 1 : this.eff[i] === 1;
  }

  disengage(i: number): void {
    if (i >= 0) this.latched[i] = 0;
  }

}
