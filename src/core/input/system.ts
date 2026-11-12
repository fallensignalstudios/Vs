/**
 * InputSystemImpl — merges keyboard, mouse, gamepad and virtual input into the InputSystem contract.
 * All DOM access goes through an injectable InputEnv so the system runs headless (tests, node) unchanged.
 */
import type { ButtonAction, Game, InputContext, InputSystem } from '@/core/api';
import { clamp } from '@/core/mathx';
import { A, ACTION_COUNT, ActionStates, EdgeGate, actionIndex } from './actions';
import {
  Keymap, LOOK_KEYS, MOUSE_BINDINGS, MOVE_KEYS, glyphFor, loadKeymap, readLayout, saveKeymap, type BindingStore, type InputDevice, type LayoutMap,
} from './bindings';
import { GamepadReader, type PadLike } from './gamepad';
import { PointerLock, type LockCanvas, type LockDoc } from './lock';
import { VirtualInputImpl } from './virtual';

/** radians of look per pixel of mouse travel at sensitivity 1 */
export const MOUSE_RAD_PER_PX = 0.0022;
/** arrow-key look rates, rad/s */
export const KEY_YAW_RATE = 2.3;
export const KEY_PITCH_RATE = 1.4;
const KEY_LOOK_RAMP = 0.16;
/** a single mouse event larger than this is a browser warp glitch, not a hand */
const MOUSE_SPIKE = 600;
/**
 * Without pointer lock the right button both looks (drag) and aims (hold). A press that travels this many
 * pixels within AIM_HOLD seconds is a look drag and never aims; one that stays put becomes 'aim'.
 */
export const DRAG_PIXELS = 6;
export const AIM_HOLD = 0.15;
const RMB = 2;
const RMB_IDLE = 0;
const RMB_PENDING = 1;
const RMB_LOOK = 2;
const RMB_AIM = 3;

type Listener = (e: Event) => void;
interface Listenable {
  addEventListener(type: string, fn: Listener, opts?: unknown): void;
  removeEventListener(type: string, fn: Listener, opts?: unknown): void;
}
interface CanvasLike extends Listenable, LockCanvas {}
interface DocLike extends Listenable, LockDoc {
  readonly hidden?: boolean;
}

/** Everything the input system needs from the browser. Any member may be null / absent (headless). */
export interface InputEnv {
  win: Listenable | null;
  doc: DocLike | null;
  canvas: CanvasLike | null;
  getGamepads: () => ArrayLike<PadLike | null> | null;
  /** navigator.keyboard.getLayoutMap, where the browser has it (glyphs for non-QWERTY layouts) */
  getLayoutMap?: (() => Promise<LayoutMap>) | null;
  /** where key rebinds persist (localStorage); access is guarded */
  storage?: BindingStore;
}

interface KeyEv {
  code: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  preventDefault(): void;
}
interface MouseEv {
  button: number;
  movementX?: number;
  movementY?: number;
  preventDefault(): void;
}

const tagOf = (t: unknown): string => {
  const tag = (t as { tagName?: unknown } | null)?.tagName;
  return typeof tag === 'string' ? tag : '';
};
/** typing into a form control must never drive the game */
const isTextTarget = (t: unknown): boolean => {
  const tag = tagOf(t);
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as { isContentEditable?: boolean } | null)?.isContentEditable === true;
};
/** focusable controls with native Enter/Space activation */
const isActivatable = (t: unknown): boolean => {
  const tag = tagOf(t);
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
};

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export class InputSystemImpl implements InputSystem {
  readonly move = { x: 0, y: 0 };
  readonly look = { x: 0, y: 0 };
  readonly virtual: VirtualInputImpl = new VirtualInputImpl();

  private readonly states = new ActionStates();
  private readonly pad: GamepadReader;
  private readonly lock: PointerLock;
  private readonly keymap = new Keymap();
  private layout: LayoutMap | null = null;
  private readonly keys = new Set<string>();
  private readonly mouseHeld = new Uint8Array(MOUSE_BINDINGS.length);
  /** thumb buttons whose press landed on the canvas: their release must not navigate the browser */
  private readonly navHeld = new Uint8Array(8);
  /** number of physical keys/buttons currently holding each action */
  private readonly count = new Uint8Array(ACTION_COUNT);
  /** went down since the last tick (so a tap shorter than a frame still registers) */
  private readonly tap = new Uint8Array(ACTION_COUNT);
  /** fully released since the last tick (so release + re-press inside one frame is still a new press) */
  private readonly upSince = new Uint8Array(ACTION_COUNT);
  private readonly listeners: Array<[Listenable, string, Listener, unknown]> = [];
  private readonly deviceListeners: Array<(device: InputDevice) => void> = [];
  private readonly allowScratch: number[] = [];

  private _device: InputDevice = 'kbm';
  private notifiedDevice: InputDevice = 'kbm';
  private accX = 0;
  private accY = 0;
  private mouseTravel = 0;
  private skipMouse = 0;
  private keyLook = 0;
  private rmb = RMB_IDLE;
  private rmbTime = 0;
  private rmbTravel = 0;
  private padProbe = 0;
  private worldActive = false;
  private toggleHolds = false;
  /** shows each edge to one sim substep per frame */
  private readonly gate = new EdgeGate();

  constructor(private readonly game: Game, private readonly env: InputEnv) {
    this.pad = new GamepadReader(env.getGamepads);
    this.lock = new PointerLock(env.canvas, env.doc, () => {
      this.skipMouse = 1; // first delta after capture is often a warp
      this.accX = this.accY = 0;
    });
    loadKeymap(this.keymap, env.storage);
    readLayout(env.getLayoutMap, (map) => {
      this.layout = map;
    });
    this.bind();
  }

  // -------------------------------------------------------------------------------------------
  // InputSystem
  // -------------------------------------------------------------------------------------------

  get moveWorld(): { x: number; z: number } | null {
    return this.worldActive ? this.virtual.world : null;
  }

  get device(): InputDevice {
    return this._device;
  }

  get pointerLocked(): boolean {
    return this.lock.locked;
  }

  /** (ship) pointer lock cannot be had here (see PointerLock.unavailable): mouse look is RMB drag */
  get pointerLockDenied(): boolean {
    return this.lock.unavailable && !this.lock.locked;
  }

  get lookMode(): 'locked' | 'drag' | 'stick' {
    return this._device === 'gamepad' ? 'stick' : this.lock.locked ? 'locked' : 'drag';
  }

  get gamepadConnected(): boolean {
    return this.pad.connected;
  }

  get context(): InputContext {
    return this.states.context;
  }

  down(a: ButtonAction): boolean {
    return this.states.down(actionIndex(a));
  }

  pressed(a: ButtonAction): boolean {
    const i = actionIndex(a);
    if (!this.states.pressed(i) || !this.gate.live(this.simClock())) return false;
    this.states.sawPress(i);
    return true;
  }

  released(a: ButtonAction): boolean {
    const i = actionIndex(a);
    if (!this.states.released(i) || !this.gate.live(this.simClock())) return false;
    this.states.sawRelease(i);
    return true;
  }

  take(a: ButtonAction): boolean {
    const i = actionIndex(a);
    if (!this.states.pressed(i) || !this.gate.live(this.simClock())) return false;
    this.states.consume(i);
    return true;
  }

  heldTime(a: ButtonAction): number {
    return this.states.heldTime(actionIndex(a));
  }

  lastHeldTime(a: ButtonAction): number {
    return this.states.lastHeldTime(actionIndex(a));
  }

  consume(a: ButtonAction): void {
    this.states.consume(actionIndex(a));
  }

  engaged(a: ButtonAction): boolean {
    return this.states.engaged(actionIndex(a), this.toggleHolds);
  }

  disengage(a: ButtonAction): void {
    this.states.disengage(actionIndex(a));
  }

  glyph(a: ButtonAction): string {
    return glyphFor(a, this._device, this.pad.style, this.keymap, this.layout);
  }

  glyphFor(a: ButtonAction, device: InputDevice): string {
    return glyphFor(a, device === 'gamepad' ? 'gamepad' : 'kbm', this.pad.style, this.keymap, this.layout);
  }

  onDeviceChange(fn: (device: InputDevice) => void): () => void {
    if (typeof fn !== 'function') return () => {};
    this.deviceListeners.push(fn);
    return () => {
      const i = this.deviceListeners.indexOf(fn);
      if (i >= 0) this.deviceListeners.splice(i, 1);
    };
  }

  rebind(a: ButtonAction, code: string): boolean {
    if (actionIndex(a) < 0) return false;
    this.releaseAll(); // counts are per key: never carry a held key across a map change
    const ok = this.keymap.rebind(a, code);
    if (ok) saveKeymap(this.keymap, this.env.storage);
    return ok;
  }

  bindingOf(a: ButtonAction): string | null {
    return this.keymap.keyOf(a);
  }

  resetBindings(): void {
    this.releaseAll();
    this.keymap.reset();
    saveKeymap(this.keymap, this.env.storage);
  }

  allowInCinematic(actions: readonly ButtonAction[] | null): void {
    const slots = this.allowScratch;
    slots.length = 0;
    if (Array.isArray(actions)) {
      for (const a of actions) {
        const i = actionIndex(a);
        if (i >= 0) slots.push(i);
      }
    }
    this.mergePhysical();
    this.states.allowInCinematic(slots);
  }

  allowInGame(actions: readonly ButtonAction[] | null): void {
    const slots = this.allowScratch;
    slots.length = 0;
    if (Array.isArray(actions)) {
      for (const a of actions) {
        const i = actionIndex(a);
        if (i >= 0) slots.push(i);
      }
    }
    this.mergePhysical();
    this.states.allowInGame(slots);
  }

  setContext(ctx: InputContext): void {
    const prev = this.states.context;
    if (ctx === prev) return;
    // Fold in events that arrived since the last tick so they cannot leak into the new context.
    this.mergePhysical();
    this.tap.fill(0);
    this.upSince.fill(0);
    this.states.retap.fill(0);
    this.states.setContext(ctx);
    const now = this.states.context;
    if (now === prev) return; // unknown context: ignored
    if (now !== 'game') {
      this.move.x = this.move.y = 0;
      this.look.x = this.look.y = 0;
      this.worldActive = false;
      this.accX = this.accY = 0;
    }
    // The input system owns the lock: menus get the cursor back without every caller having to remember
    // exitPointerLock(), and play takes it again on return. Cinematics keep it (no cursor over a shot).
    if (now === 'menu') this.lock.suspend();
    else if (now === 'game') this.lock.restore();
  }

  requestPointerLock(): void {
    this.lock.request();
  }

  exitPointerLock(): void {
    // Called from a menu (after setContext('menu') already freed the cursor) this must not cancel the re-lock
    // that returning to play performs; called during play it is a deliberate, final release.
    this.lock.exit(this.states.context === 'menu');
  }

  rumble(strong: number, weak: number, ms: number): void {
    if (this._device === 'gamepad') this.pad.rumble(num(strong, 0), num(weak, 0), num(ms, 0));
  }

  endSim(): void {
    this.gate.endSim();
  }

  update(dt: number): void {
    const d = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.25) : 0;
    const v = this.virtual;
    const pad = this.pad;
    const inGame = this.states.context === 'game';

    // Gamepads: poll every frame once one is present, otherwise probe about once a second.
    this.padProbe -= d;
    if (pad.connected || this.padProbe <= 0) {
      pad.poll(d);
      if (!pad.connected) this.padProbe = 1;
      else if (pad.activity) this._device = 'gamepad';
    }
    if (this.mouseTravel > 4) this._device = 'kbm';
    this.mouseTravel = 0;
    if (this._device === 'gamepad' && !pad.connected) this._device = 'kbm'; // unplugged
    this.lock.update(d);
    this.resolveDrag(d);

    // Buttons.
    this.mergePhysical();
    this.tap.fill(0);
    this.upSince.fill(0);
    const virt = this.states.virt;
    for (let i = 0; i < ACTION_COUNT; i++) virt[i] = v.holds[i] | v.presses[i];
    this.toggleHolds = this.game.settings.get('holdToToggle') === true;
    // No sim step since the previous latch (hit-stop): unread gameplay edges stay up for the frozen frames.
    const clock = this.simClock();
    this.states.latch(d, this.toggleHolds, this.gate.frozen(clock));
    this.gate.latch(clock);

    // Move (camera-relative; y = forward).
    let mx = 0;
    let my = 0;
    this.worldActive = false;
    if (inGame) {
      const k = this.keys;
      mx = (k.has(MOVE_KEYS.right) ? 1 : 0) - (k.has(MOVE_KEYS.left) ? 1 : 0);
      my = (k.has(MOVE_KEYS.forward) ? 1 : 0) - (k.has(MOVE_KEYS.back) ? 1 : 0);
      if (mx !== 0 && my !== 0) {
        mx *= Math.SQRT1_2;
        my *= Math.SQRT1_2;
      }
      mx += pad.moveX + v.moveX;
      my += pad.moveY + v.moveY;
      if (v.hasWorld) {
        // Absolute world direction wins; `move` still reports how hard the stick is pushed.
        this.worldActive = true;
        mx = 0;
        my = Math.hypot(v.world.x, v.world.z);
      }
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
    }
    this.move.x = mx;
    this.move.y = my;

    // Look (radians this frame; x = yaw delta, y = pitch delta, up positive).
    let lx = 0;
    let ly = 0;
    if (inGame) {
      const settings = this.game.settings;
      const invert = settings.get('invertY') === true ? -1 : 1;
      const mouse = clamp(num(settings.get('mouseSensitivity'), 1), 0.05, 10) * MOUSE_RAD_PER_PX;
      lx -= this.accX * mouse;
      ly -= this.accY * mouse * invert;

      const k = this.keys;
      const ax = (k.has(LOOK_KEYS.left) ? 1 : 0) - (k.has(LOOK_KEYS.right) ? 1 : 0);
      const ay = (k.has(LOOK_KEYS.up) ? 1 : 0) - (k.has(LOOK_KEYS.down) ? 1 : 0);
      this.keyLook = ax !== 0 || ay !== 0 ? Math.min(1, this.keyLook + d / KEY_LOOK_RAMP) : 0;
      lx += ax * KEY_YAW_RATE * this.keyLook * d;
      ly += ay * KEY_PITCH_RATE * this.keyLook * d;

      const stick = clamp(num(settings.get('gamepadSensitivity'), 1), 0.05, 10) * d;
      lx += pad.lookX * stick;
      ly += pad.lookY * stick * invert;

      lx += v.lookYaw;
      ly += v.lookPitch;
    }
    this.accX = this.accY = 0;
    this.look.x = lx;
    this.look.y = ly;

    v.endFrame(d);
    if (this._device !== this.notifiedDevice) this.notifyDevice();
  }

  dispose(): void {
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
    this.deviceListeners.length = 0;
    this.releaseAll();
  }

  // -------------------------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------------------------

  /** `game.time.now` when the host has a simulation clock, else NaN */
  private simClock(): number {
    const now = (this.game as { time?: { now?: unknown } }).time?.now;
    return typeof now === 'number' ? now : NaN;
  }

  private notifyDevice(): void {
    const device = (this.notifiedDevice = this._device);
    for (const fn of this.deviceListeners) {
      try {
        fn(device);
      } catch (err) {
        console.warn('[input] device listener threw', err);
      }
    }
  }

  private mergePhysical(): void {
    const raw = this.states.raw;
    const { count, tap } = this;
    const padDown = this.pad.down;
    for (let i = 0; i < ACTION_COUNT; i++) raw[i] = count[i] > 0 || tap[i] || padDown[i] ? 1 : 0;
  }

  /** a physical key / button for these actions went down */
  private press(bound: readonly ButtonAction[]): void {
    for (let i = 0; i < bound.length; i++) {
      const a = A[bound[i]];
      this.count[a]++;
      this.tap[a] = 1;
      if (this.upSince[a]) this.states.retap[a] = 1;
    }
  }

  private unpress(bound: readonly ButtonAction[]): void {
    for (let i = 0; i < bound.length; i++) {
      const a = A[bound[i]];
      if (this.count[a] > 0 && --this.count[a] === 0) this.upSince[a] = 1;
    }
  }

  /** Decide what a right-button press without pointer lock means: look drag, or aim. */
  private resolveDrag(dt: number): void {
    if (this.rmb !== RMB_PENDING) return;
    if (this.rmbTravel >= DRAG_PIXELS) {
      this.rmb = RMB_LOOK;
      return;
    }
    this.rmbTime += dt;
    if (this.rmbTime >= AIM_HOLD) {
      this.rmb = RMB_AIM;
      this.press(MOUSE_BINDINGS[RMB]);
    }
  }

  private on(target: Listenable | null, type: string, fn: Listener, opts?: unknown): void {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn, opts]);
  }

  private bind(): void {
    const { win, doc, canvas } = this.env;
    // Events are read structurally (code / button / movement) so plain objects work in tests.
    const key = (e: Event): KeyEv => e as unknown as KeyEv;
    const mouse = (e: Event): MouseEv => e as unknown as MouseEv;
    this.on(win, 'keydown', (e) => this.onKeyDown(key(e)));
    this.on(win, 'keyup', (e) => this.onKeyUp(key(e)));
    this.on(win, 'blur', () => this.releaseAll());
    this.on(win, 'mouseup', (e) => this.onMouseUp(mouse(e)));
    this.on(win, 'gamepadconnected', () => {
      this.padProbe = 0;
    });
    this.on(doc, 'visibilitychange', () => {
      if (!doc || doc.hidden !== false) this.releaseAll();
    });
    this.on(doc, 'mousemove', (e) => this.onMouseMove(mouse(e)));
    this.on(doc, 'pointerlockchange', () => this.lock.onChange());
    this.on(doc, 'pointerlockerror', () => this.lock.onDenied());
    this.on(canvas, 'mousedown', (e) => this.onMouseDown(mouse(e)));
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'auxclick', (e) => e.preventDefault());
  }

  private onKeyDown(e: KeyEv): void {
    if (isTextTarget(e.target)) return;
    const code = e.code;
    const bound = this.keymap.get(code);
    if (!bound) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser / OS shortcut, not ours
    this._device = 'kbm';
    const ctx = this.states.context;
    // In menus a focused button/link keeps its native Enter/Space activation and that is the ONLY activation
    // (no `confirm` as well). During play the game owns those keys even if a stale UI element holds focus.
    if (ctx === 'menu' && isActivatable(e.target) && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) return;
    // The game owns its keys during play. Elsewhere only keys that act in that context are taken from the
    // browser, and never Tab — DOM menus need focus traversal.
    if (ctx === 'game' || (code !== 'Tab' && this.acts(bound))) e.preventDefault();
    // (An auto-repeat for a key we are not tracking means its first press was swallowed — typically by a
    //  modifier held at the time — so it counts as the press.)
    if (this.keys.has(code)) return;
    this.keys.add(code);
    this.press(bound);
  }

  private acts(bound: readonly ButtonAction[]): boolean {
    for (let i = 0; i < bound.length; i++) if (this.states.allowed(A[bound[i]])) return true;
    return false;
  }

  private onKeyUp(e: KeyEv): void {
    const code = e.code;
    if (!this.keys.delete(code)) return;
    const bound = this.keymap.get(code);
    if (bound) this.unpress(bound);
  }

  private onMouseDown(e: MouseEv): void {
    const b = e.button;
    if (b >= 1) e.preventDefault(); // middle-click autoscroll, thumb-button history navigation
    if (b >= 3 && b < this.navHeld.length) this.navHeld[b] = 1;
    this._device = 'kbm';
    const lock = this.lock;
    if (this.states.context === 'game' && !lock.locked && lock.canAutoLock) {
      const firstAttempt = !lock.denied;
      lock.request();
      if (b === 0 && firstAttempt) return; // the click that captures the mouse is not an attack
    }
    const bound = MOUSE_BINDINGS[b];
    if (!bound || this.mouseHeld[b]) return;
    this.mouseHeld[b] = 1;
    if (b === RMB && !lock.locked) {
      // no pointer lock: this press may be a look drag — `resolveDrag` decides
      this.rmb = RMB_PENDING;
      this.rmbTime = this.rmbTravel = 0;
      return;
    }
    if (b === RMB) this.rmb = RMB_AIM;
    this.press(bound);
  }

  private onMouseUp(e: MouseEv): void {
    const b = e.button;
    if (b >= 3 && (this.lock.locked || this.navHeld[b] === 1)) e.preventDefault(); // Mouse4/5: no browser Back
    if (b >= 3 && b < this.navHeld.length) this.navHeld[b] = 0;
    const bound = MOUSE_BINDINGS[b];
    if (!bound || !this.mouseHeld[b]) return;
    this.mouseHeld[b] = 0;
    if (b === RMB) {
      const state = this.rmb;
      this.rmb = RMB_IDLE;
      if (state === RMB_LOOK) return;
      if (state === RMB_PENDING) {
        // a click without a drag: still an aim tap (press-to-toggle aim relies on it)
        for (let i = 0; i < bound.length; i++) this.tap[A[bound[i]]] = 1;
        return;
      }
    }
    this.unpress(bound);
  }

  private onMouseMove(e: MouseEv): void {
    const mx = num(e.movementX, 0);
    const my = num(e.movementY, 0);
    if (mx === 0 && my === 0) return;
    const travel = Math.abs(mx) + Math.abs(my);
    this.mouseTravel += travel;
    if (this.lock.locked) {
      if (this.skipMouse > 0) {
        this.skipMouse--;
        return;
      }
      if (Math.abs(mx) > MOUSE_SPIKE || Math.abs(my) > MOUSE_SPIKE) return;
      this.accX += mx;
      this.accY += my;
    } else if (this.mouseHeld[RMB]) {
      // Drag-look fallback: hold RMB and move.
      this.rmbTravel += travel;
      this.accX += mx;
      this.accY += my;
    }
  }

  private releaseAll(): void {
    this.keys.clear();
    this.mouseHeld.fill(0);
    this.navHeld.fill(0);
    this.count.fill(0);
    this.tap.fill(0);
    this.upSince.fill(0);
    this.states.retap.fill(0);
    this.rmb = RMB_IDLE;
    this.accX = this.accY = 0;
    this.keyLook = 0;
  }
}
