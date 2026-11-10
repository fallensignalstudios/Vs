/**
 * InputSystemImpl — merges keyboard, mouse, gamepad and virtual input into the InputSystem contract.
 * All DOM access goes through an injectable InputEnv so the system runs headless (tests, node) unchanged.
 */
import type { ButtonAction, Game, InputContext, InputSystem } from '@/core/api';
import { clamp } from '@/core/mathx';
import { A, ACTION_COUNT, ActionStates, actionIndex } from './actions';
import { KEY_BINDINGS, LOOK_KEYS, MOUSE_BINDINGS, MOVE_KEYS, glyphFor, type InputDevice } from './bindings';
import { GamepadReader, type PadLike } from './gamepad';
import { VirtualInputImpl } from './virtual';

/** radians of look per pixel of mouse travel at sensitivity 1 */
export const MOUSE_RAD_PER_PX = 0.0022;
/** arrow-key look rates, rad/s */
export const KEY_YAW_RATE = 2.3;
export const KEY_PITCH_RATE = 1.4;
const KEY_LOOK_RAMP = 0.16;
/** a single mouse event larger than this is a browser warp glitch, not a hand */
const MOUSE_SPIKE = 600;
/** consecutive pointer-lock denials before canvas clicks stop retrying (sandboxed iframes) */
const MAX_LOCK_STRIKES = 3;
const LOCK_RETRY_COOLDOWN = 1.5;

type Listener = (e: Event) => void;
interface Listenable {
  addEventListener(type: string, fn: Listener, opts?: unknown): void;
  removeEventListener(type: string, fn: Listener, opts?: unknown): void;
}
interface CanvasLike extends Listenable {
  requestPointerLock?: (opts?: { unadjustedMovement?: boolean }) => unknown;
}
interface DocLike extends Listenable {
  readonly pointerLockElement?: unknown;
  readonly hidden?: boolean;
  exitPointerLock?: () => void;
}

/** Everything the input system needs from the browser. Any member may be null (headless). */
export interface InputEnv {
  win: Listenable | null;
  doc: DocLike | null;
  canvas: CanvasLike | null;
  getGamepads: () => ArrayLike<PadLike | null> | null;
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
/** focused buttons/links keep their native Enter/Space activation */
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
  private readonly keys = new Set<string>();
  private readonly mouseHeld = new Uint8Array(MOUSE_BINDINGS.length);
  /** number of physical keys/buttons currently holding each action */
  private readonly count = new Uint8Array(ACTION_COUNT);
  /** went down since the last tick (so a tap shorter than a frame still registers) */
  private readonly tap = new Uint8Array(ACTION_COUNT);
  private readonly listeners: Array<[Listenable, string, Listener, unknown]> = [];

  private _device: InputDevice = 'kbm';
  private accX = 0;
  private accY = 0;
  private mouseTravel = 0;
  private skipMouse = 0;
  private keyLook = 0;
  private locked = false;
  private lockPending = false;
  private lockDenied = false;
  private lockStrikes = 0;
  private lockCooldown = 0;
  private padProbe = 0;
  private worldActive = false;

  constructor(private readonly game: Game, private readonly env: InputEnv) {
    this.pad = new GamepadReader(env.getGamepads);
    if (env.canvas && typeof env.canvas.requestPointerLock !== 'function') {
      this.lockDenied = true;
      this.lockStrikes = MAX_LOCK_STRIKES;
    }
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
    return this.locked;
  }

  get lookMode(): 'locked' | 'drag' | 'stick' {
    return this._device === 'gamepad' ? 'stick' : this.locked ? 'locked' : 'drag';
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
    return this.states.pressed(actionIndex(a));
  }

  released(a: ButtonAction): boolean {
    return this.states.released(actionIndex(a));
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

  glyph(a: ButtonAction): string {
    return glyphFor(a, this._device, this.pad.style);
  }

  glyphFor(a: ButtonAction, device: InputDevice): string {
    return glyphFor(a, device === 'gamepad' ? 'gamepad' : 'kbm', this.pad.style);
  }

  setContext(ctx: InputContext): void {
    if (ctx === this.states.context) return;
    // Fold in events that arrived since the last tick so they cannot leak into the new context.
    this.mergePhysical();
    this.tap.fill(0);
    this.states.setContext(ctx);
    if (this.states.context !== 'game') {
      this.move.x = this.move.y = 0;
      this.look.x = this.look.y = 0;
      this.worldActive = false;
      this.accX = this.accY = 0;
    }
  }

  requestPointerLock(): void {
    const { canvas, doc } = this.env;
    if (!canvas || !doc || typeof canvas.requestPointerLock !== 'function') {
      this.lockDenied = true;
      return;
    }
    if (this.locked || this.lockPending) return;
    this.lockPending = true;
    this.tryLock(true);
  }

  exitPointerLock(): void {
    const doc = this.env.doc;
    this.lockPending = false;
    if (!doc || !this.locked || typeof doc.exitPointerLock !== 'function') return;
    try {
      doc.exitPointerLock();
    } catch {
      /* nothing to release */
    }
  }

  rumble(strong: number, weak: number, ms: number): void {
    if (this._device === 'gamepad') this.pad.rumble(num(strong, 0), num(weak, 0), num(ms, 0));
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
    if (this.lockCooldown > 0) this.lockCooldown -= d;

    // Buttons.
    this.mergePhysical();
    this.tap.fill(0);
    const virt = this.states.virt;
    for (let i = 0; i < ACTION_COUNT; i++) virt[i] = v.holds[i] | v.presses[i];
    this.states.latch(d);

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
  }

  /** Remove every DOM listener (hot reload / tests). */
  dispose(): void {
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
  }

  // -------------------------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------------------------

  private mergePhysical(): void {
    const raw = this.states.raw;
    const { count, tap } = this;
    const padDown = this.pad.down;
    for (let i = 0; i < ACTION_COUNT; i++) raw[i] = count[i] > 0 || tap[i] || padDown[i] ? 1 : 0;
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
    this.on(doc, 'pointerlockchange', () => this.onLockChange());
    this.on(doc, 'pointerlockerror', () => this.onLockDenied());
    this.on(canvas, 'mousedown', (e) => this.onMouseDown(mouse(e)));
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'auxclick', (e) => e.preventDefault());
  }

  private onKeyDown(e: KeyEv): void {
    if (isTextTarget(e.target)) return;
    const code = e.code;
    const bound = KEY_BINDINGS[code];
    if (!bound) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser / OS shortcut, not ours
    const nativeActivation = isActivatable(e.target) && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space');
    if (!nativeActivation) e.preventDefault();
    this._device = 'kbm';
    if (e.repeat || this.keys.has(code)) return;
    this.keys.add(code);
    for (let i = 0; i < bound.length; i++) {
      const a = A[bound[i]];
      this.count[a]++;
      this.tap[a] = 1;
    }
  }

  private onKeyUp(e: KeyEv): void {
    const code = e.code;
    if (!this.keys.delete(code)) return;
    const bound = KEY_BINDINGS[code];
    if (!bound) return;
    for (let i = 0; i < bound.length; i++) {
      const a = A[bound[i]];
      if (this.count[a] > 0) this.count[a]--;
    }
  }

  private onMouseDown(e: MouseEv): void {
    const b = e.button;
    if (b >= 1) e.preventDefault(); // middle-click autoscroll, thumb-button history navigation
    this._device = 'kbm';
    if (this.states.context === 'game' && !this.locked && this.canAutoLock()) {
      const firstAttempt = !this.lockDenied;
      this.requestPointerLock();
      if (b === 0 && firstAttempt) return; // the click that captures the mouse is not an attack
    }
    const bound = MOUSE_BINDINGS[b];
    if (!bound || this.mouseHeld[b]) return;
    this.mouseHeld[b] = 1;
    for (let i = 0; i < bound.length; i++) {
      const a = A[bound[i]];
      this.count[a]++;
      this.tap[a] = 1;
    }
  }

  private onMouseUp(e: MouseEv): void {
    const b = e.button;
    if (b >= 3 && this.locked) e.preventDefault();
    const bound = MOUSE_BINDINGS[b];
    if (!bound || !this.mouseHeld[b]) return;
    this.mouseHeld[b] = 0;
    for (let i = 0; i < bound.length; i++) {
      const a = A[bound[i]];
      if (this.count[a] > 0) this.count[a]--;
    }
  }

  private onMouseMove(e: MouseEv): void {
    const mx = num(e.movementX, 0);
    const my = num(e.movementY, 0);
    if (mx === 0 && my === 0) return;
    this.mouseTravel += Math.abs(mx) + Math.abs(my);
    if (this.locked) {
      if (this.skipMouse > 0) {
        this.skipMouse--; // first delta after capture is often a warp
        return;
      }
      if (Math.abs(mx) > MOUSE_SPIKE || Math.abs(my) > MOUSE_SPIKE) return;
      this.accX += mx;
      this.accY += my;
    } else if (this.mouseHeld[2]) {
      // Drag-look fallback: hold RMB and move.
      this.accX += mx;
      this.accY += my;
    }
  }

  private canAutoLock(): boolean {
    if (this.lockPending) return false;
    if (!this.lockDenied) return true;
    return this.lockStrikes < MAX_LOCK_STRIKES && this.lockCooldown <= 0;
  }

  private tryLock(raw: boolean): void {
    const canvas = this.env.canvas;
    if (!canvas || typeof canvas.requestPointerLock !== 'function') return;
    try {
      const p = raw ? canvas.requestPointerLock({ unadjustedMovement: true }) : canvas.requestPointerLock();
      if (p && typeof (p as Promise<unknown>).then === 'function') {
        (p as Promise<unknown>).then(undefined, (err: unknown) => {
          // Raw mouse input is optional: retry once without it before treating this as a denial.
          if (raw && (err as { name?: string } | null)?.name === 'NotSupportedError' && this.lockPending) this.tryLock(false);
          else this.onLockDenied();
        });
      }
    } catch {
      this.onLockDenied();
    }
  }

  private onLockChange(): void {
    const { doc, canvas } = this.env;
    const now = !!doc && !!canvas && doc.pointerLockElement === canvas;
    if (now && !this.locked) {
      this.lockDenied = false;
      this.lockStrikes = 0;
      this.skipMouse = 1;
      this.accX = this.accY = 0;
    }
    if (now) this.lockPending = false;
    this.locked = now;
  }

  private onLockDenied(): void {
    if (!this.lockPending) return; // promise rejection + pointerlockerror both report the same denial
    this.lockPending = false;
    this.lockDenied = true;
    this.lockStrikes++;
    this.lockCooldown = LOCK_RETRY_COOLDOWN;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.mouseHeld.fill(0);
    this.count.fill(0);
    this.tap.fill(0);
    this.accX = this.accY = 0;
    this.keyLook = 0;
  }
}
