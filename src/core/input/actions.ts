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

/** Actions that only mean something in menus / cinematics. They share keys with gameplay (Space, E, Esc, WASD). */
export const UI_ACTIONS = ['skip', 'confirm', 'cancel', 'menuUp', 'menuDown', 'menuLeft', 'menuRight'] as const satisfies readonly ButtonAction[];
const UI_MASK = mask(UI_ACTIONS);

/**
 * Which actions are readable in each context.
 *  - game: gameplay actions + pause. The UI actions read false unless a HUD prompt opts in (`allowInGame`),
 *    so one Space press is never a dodge AND a confirm AND a skip.
 *  - menu: confirm / cancel / menu directions / pause — gameplay actions read false
 *  - cinematic: skip / pause only
 */
export const CONTEXT_MASK: Record<InputContext, Uint8Array> = {
  game: mask(ACTIONS.filter((a) => UI_MASK[A[a]] === 0)),
  menu: mask(['confirm', 'cancel', 'menuUp', 'menuDown', 'menuLeft', 'menuRight', 'pause']),
  cinematic: mask(['skip', 'pause']),
};

/** Holds that survive a switch INTO the game context without a re-press (they resume, but fire no edge). */
const CARRY_INTO_GAME = mask(['sprint', 'aim', 'guard']);

const MENU_DIRS = [A.menuUp, A.menuDown, A.menuLeft, A.menuRight] as const;
/** seconds before a held menu direction starts repeating, then the repeat interval */
export const MENU_REPEAT_DELAY = 0.42;
export const MENU_REPEAT_INTERVAL = 0.13;
/** longest an unseen gameplay edge is kept for the simulation while it is frozen (hit-stop is ≤ 0.25 s) */
export const EDGE_CARRY = 0.3;

/**
 * Per-action state. The owner fills `raw` (physical devices) and `virt` (programmatic input) for this frame
 * and calls `latch(dt)` once per tick; everything else is derived.
 */
export class ActionStates {
  /** merged physical state (keyboard | mouse | gamepad) for the current frame */
  readonly raw = new Uint8Array(ACTION_COUNT);
  /** virtual (autoplay / test) state for the current frame — deliberate, so never release-blocked */
  readonly virt = new Uint8Array(ACTION_COUNT);
  /** set by the owner when an action was released AND pressed again since the last latch; cleared by latch */
  readonly retap = new Uint8Array(ACTION_COUNT);
  private readonly eff = new Uint8Array(ACTION_COUNT);
  private readonly press = new Uint8Array(ACTION_COUNT);
  private readonly release = new Uint8Array(ACTION_COUNT);
  private readonly consumed = new Uint8Array(ACTION_COUNT);
  /** edges somebody has actually read this tick (an edge nobody saw may be carried through a hit-stop) */
  private readonly seenPress = new Uint8Array(ACTION_COUNT);
  private readonly seenRelease = new Uint8Array(ACTION_COUNT);
  private readonly carried = new Float32Array(ACTION_COUNT);
  /** raw-down actions that must be released before they count again (set by context switches) */
  private readonly blocked = new Uint8Array(ACTION_COUNT);
  private readonly held = new Float32Array(ACTION_COUNT);
  private readonly lastHeld = new Float32Array(ACTION_COUNT);
  private readonly repeat = new Float32Array(MENU_DIRS.length);
  /** press-to-toggle latches for `engaged()` (accessibility: settings.holdToToggle) */
  private readonly latched = new Uint8Array(ACTION_COUNT);
  /** the 'game' mask of this instance: CONTEXT_MASK.game plus whatever a HUD prompt opted in */
  private readonly gameMask = Uint8Array.from(CONTEXT_MASK.game);
  /** the 'cinematic' mask of this instance: CONTEXT_MASK.cinematic plus a scripted prompt's button */
  private readonly cineMask = Uint8Array.from(CONTEXT_MASK.cinematic);
  private allow: Uint8Array = this.gameMask;
  private ctx: InputContext = 'game';

  get context(): InputContext {
    return this.ctx;
  }

  /**
   * Latch edges for this tick from `raw`. `toggle` = settings.holdToToggle. `carry` = the simulation did not
   * step since the previous latch (hit-stop): gameplay edges that nobody read are then kept for this tick too,
   * so a press made during the freeze still reaches combat when time resumes.
   */
  latch(dt: number, toggle = false, carry = false): void {
    const { raw, virt, eff, press, release, consumed, blocked, held, lastHeld, allow, latched, retap } = this;
    const { seenPress, seenRelease, carried } = this;
    const keep = carry && this.ctx === 'game';
    for (let i = 0; i < ACTION_COUNT; i++) {
      if (!raw[i]) blocked[i] = 0;
      const was = eff[i];
      const now = allow[i] && ((raw[i] && !blocked[i]) || virt[i]) ? 1 : 0;
      // Released and pressed again between two ticks (button mashing at low frame rates): still down, but it
      // is a new press — report both edges and restart the hold timer.
      const again = retap[i] === 1 && was === 1 && now === 1;
      retap[i] = 0;
      const fresh = (now && !was) || again;
      const old = keep && carried[i] < EDGE_CARRY;
      const keepPress = old && press[i] === 1 && consumed[i] === 0 && seenPress[i] === 0;
      const keepRelease = old && release[i] === 1 && seenRelease[i] === 0;
      carried[i] = keepPress || keepRelease ? carried[i] + dt : 0;
      eff[i] = now;
      consumed[i] = seenPress[i] = seenRelease[i] = 0;
      press[i] = fresh || keepPress ? 1 : 0;
      release[i] = (!now && was) || again || keepRelease ? 1 : 0;
      if (now) {
        if (again) lastHeld[i] = held[i];
        if (!was || again) held[i] = 0;
        held[i] += dt;
      } else if (was) {
        lastHeld[i] = held[i];
        held[i] = 0;
      }
      if (!toggle || !allow[i]) latched[i] = 0;
      else if (fresh) latched[i] ^= 1;
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
    if (!CONTEXT_MASK[ctx]) {
      console.warn(`[input] unknown context "${String(ctx)}" — ignored`);
      return;
    }
    // a HUD opt-in belongs to the prompt that asked for it: it never survives a context switch
    this.gameMask.set(CONTEXT_MASK.game);
    this.cineMask.set(CONTEXT_MASK.cinematic);
    const allow = ctx === 'game' ? this.gameMask : ctx === 'cinematic' ? this.cineMask : CONTEXT_MASK[ctx];
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

  /** a reader was shown the press / release edge of `i` this tick (it will not be carried) */
  sawPress(i: number): void {
    this.seenPress[i] = 1;
  }

  sawRelease(i: number): void {
    this.seenRelease[i] = 1;
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

  /** true if the action can currently be read in this context (drives preventDefault for its keys) */
  allowed(i: number): boolean {
    return i >= 0 && this.allow[i] === 1;
  }

  /**
   * Opt UI actions into the 'game' context (`slots` are action indices; empty restores the default). A key that
   * is already held when its action becomes readable must be released first, so the Space of a dodge can
   * never confirm the prompt that just appeared.
   */
  /**
   * Opt gameplay actions into the 'cinematic' context (a scripted prompt inside a scene: a duel beat, a Resonance
   * confirm). Empty restores skip / pause only. Like `allowInGame`, a key already held when its action becomes
   * readable must be released first.
   */
  allowInCinematic(slots: readonly number[]): void {
    const { cineMask, raw, blocked } = this;
    const base = CONTEXT_MASK.cinematic;
    for (let i = 0; i < ACTION_COUNT; i++) {
      let on = base[i];
      if (!on) for (let k = 0; k < slots.length; k++) if (slots[k] === i) on = 1;
      if (on && !cineMask[i] && raw[i] && this.ctx === 'cinematic') blocked[i] = 1;
      cineMask[i] = on;
    }
  }

  allowInGame(slots: readonly number[]): void {
    const { gameMask, raw, blocked } = this;
    const base = CONTEXT_MASK.game;
    for (let i = 0; i < ACTION_COUNT; i++) {
      let on = base[i];
      if (!on && UI_MASK[i]) for (let k = 0; k < slots.length; k++) if (slots[k] === i) on = 1;
      if (on && !gameMask[i] && raw[i] && this.ctx === 'game') blocked[i] = 1;
      gameMask[i] = on;
    }
  }
}

/**
 * Edges are latched once per FRAME, but the simulation may run several substeps in that frame (below 45 fps).
 * The gate shows each press / release to one substep only — the first one that asks — so sim code never sees
 * the same press twice; frame-level readers (before the sim, or after `endSim()`) always see it. Substeps are
 * told apart by the simulation clock (`game.time.now`), which Game advances at the start of each one.
 */
export class EdgeGate {
  private latchNow = NaN;
  private simNow = NaN;
  private afterSim = true;

  /** a new frame was latched at simulation time `now` (NaN = the host has no simulation clock) */
  latch(now: number): void {
    this.latchNow = now;
    this.simNow = NaN;
    this.afterSim = false;
  }

  /** the frame's substeps are over */
  endSim(): void {
    this.afterSim = true;
  }

  /** did the simulation clock stand still since the last latch (hit-stop, pause)? */
  frozen(now: number): boolean {
    return now === this.latchNow;
  }

  /** may a reader at simulation time `now` see this frame's edges? */
  live(now: number): boolean {
    if (this.afterSim || now !== now || now === this.latchNow) return true;
    if (this.simNow !== this.simNow) this.simNow = now;
    return now === this.simNow;
  }
}
