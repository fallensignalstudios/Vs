/**
 * Menu plumbing shared by every interactive screen: reading menu actions from `game.input` (with a keyboard
 * fallback while the input system is still a stub), focus lists with visible focus + mouse support, and the
 * modal stack that decides which screen owns input.
 */
import type { ButtonAction, Game, InputContext, SfxId } from '@/core/api';
import { isStub } from '@/core/stub';
import { moveFocus } from './logic';

export interface MenuKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  cancel: boolean;
}

type KeyName = keyof MenuKeys;

const ACTIONS: ReadonlyArray<[KeyName, ButtonAction]> = [
  ['up', 'menuUp'], ['down', 'menuDown'], ['left', 'menuLeft'], ['right', 'menuRight'],
  ['confirm', 'confirm'], ['cancel', 'cancel'],
];

const FALLBACK_KEYS: Record<string, KeyName> = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right', Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm',
  Escape: 'cancel', Backspace: 'cancel',
};

/** Play a UI sound; silent when audio is a stub or throws. */
export function sfx(game: Game, id: SfxId): void {
  try {
    game.audio.play(id);
  } catch {
    /* audio must never break a menu */
  }
}

/** Per-frame menu actions. Presses are consumed so gameplay / the pause toggle never see them twice. */
export class MenuInput {
  private readonly keys: MenuKeys = { up: false, down: false, left: false, right: false, confirm: false, cancel: false };
  private readonly queue: KeyName[] = [];
  private listening = false;
  /** frames during which `confirm` from the input system is ignored (a mouse click already activated something) */
  private suppressConfirm = 0;

  constructor(private readonly game: Game) {}

  private readonly onKey = (e: KeyboardEvent): void => {
    const k = FALLBACK_KEYS[e.code];
    if (k && this.queue.length < 8) this.queue.push(k);
  };

  /** A DOM click handled an activation: do not also treat this frame's `confirm` (LMB) as one. */
  noteClick(): void {
    this.suppressConfirm = 2;
  }

  /** Enable/disable the stub keyboard fallback (only while a modal is open). */
  setActive(active: boolean): void {
    const want = active && isStub(this.game.input);
    if (want === this.listening) return;
    this.listening = want;
    this.queue.length = 0;
    try {
      if (want) globalThis.addEventListener?.('keydown', this.onKey);
      else globalThis.removeEventListener?.('keydown', this.onKey);
    } catch {
      /* no window (tests) */
    }
  }

  /** Inject a press (tests, sandbox, autoplay of menus). */
  push(key: KeyName): void {
    this.queue.push(key);
  }

  poll(): MenuKeys {
    const k = this.keys;
    k.up = k.down = k.left = k.right = k.confirm = k.cancel = false;
    const input = this.game.input;
    if (!isStub(input)) {
      for (const [name, action] of ACTIONS) {
        if (input.pressed(action) === true) {
          k[name] = true;
          input.consume(action);
        }
      }
      // Esc is usually both `pause` and `cancel`: treat it as cancel and swallow it so the flow layer does not
      // immediately re-open the pause menu we are closing.
      if (input.pressed('pause') === true) {
        k.cancel = true;
        input.consume('pause');
      }
    }
    for (const q of this.queue) k[q] = true;
    this.queue.length = 0;
    if (this.suppressConfirm > 0) {
      this.suppressConfirm--;
      k.confirm = false;
    }
    return k;
  }
}

export interface FocusItem {
  el: HTMLElement;
  onConfirm?(): void;
  /** left/right adjustment (sliders, cycles). Lists oriented 'h' use left/right for movement instead. */
  onAdjust?(dir: -1 | 1): void;
  disabled?: boolean;
}

/**
 * An ordered set of focusable elements. The focused element carries `.is-focus`; hovering focuses, clicking
 * confirms. Only the list a screen marks `active` reacts.
 */
export class FocusList {
  readonly items: FocusItem[] = [];
  index = -1;
  active = true;
  /** focus follows the pointer (false = click only) */
  hover = true;
  /** called after focus moved (keyboard or mouse) */
  onFocus: ((index: number, item: FocusItem) => void) | null = null;

  constructor(
    private readonly game: Game,
    private readonly menu: MenuInput,
    readonly orientation: 'v' | 'h' = 'v',
  ) {}

  clear(): void {
    for (const it of this.items) it.el.classList.remove('is-focus');
    this.items.length = 0;
    this.index = -1;
  }

  add(item: FocusItem): FocusItem {
    const i = this.items.length;
    this.items.push(item);
    item.el.classList.toggle('is-disabled', item.disabled === true);
    item.el.addEventListener('pointerenter', () => {
      if (this.active && this.hover && !item.disabled && this.index !== i) this.focus(i, true);
    });
    item.el.addEventListener('click', (e) => {
      if (!this.active || item.disabled) return;
      e.stopPropagation();
      this.menu.noteClick();
      if (this.index !== i) this.focus(i, false);
      if (item.onConfirm) {
        sfx(this.game, 'uiSelect');
        item.onConfirm();
      }
    });
    return item;
  }

  focus(i: number, sound = false): void {
    if (i < 0 || i >= this.items.length) return;
    const prev = this.items[this.index];
    if (prev) prev.el.classList.remove('is-focus');
    this.index = i;
    const item = this.items[i] as FocusItem;
    item.el.classList.add('is-focus');
    if (sound) sfx(this.game, 'uiMove');
    this.onFocus?.(i, item);
  }

  /** focus the first enabled item (or keep the current one if still valid) */
  focusFirst(): void {
    const cur = this.items[this.index];
    if (cur && !cur.disabled) {
      this.focus(this.index);
      return;
    }
    const i = this.items.findIndex((it) => !it.disabled);
    if (i >= 0) this.focus(i);
  }

  blur(): void {
    const prev = this.items[this.index];
    if (prev) prev.el.classList.remove('is-focus');
  }

  get current(): FocusItem | null {
    return this.items[this.index] ?? null;
  }

  private step(dir: number): boolean {
    const n = moveFocus(this.index, dir, this.items.length, (i) => !(this.items[i] as FocusItem).disabled);
    if (n === this.index || n < 0) return false;
    this.focus(n, true);
    return true;
  }

  /** Apply this frame's keys. Returns true if any key was used. */
  handle(k: MenuKeys): boolean {
    if (!this.active || this.items.length === 0) return false;
    const prevKey = this.orientation === 'v' ? k.up : k.left;
    const nextKey = this.orientation === 'v' ? k.down : k.right;
    let used = false;
    if (prevKey) used = this.step(-1) || used;
    if (nextKey) used = this.step(1) || used;
    const cur = this.current;
    if (cur && !cur.disabled) {
      if (this.orientation === 'v' && cur.onAdjust && (k.left || k.right)) {
        cur.onAdjust(k.left ? -1 : 1);
        used = true;
      }
      if (k.confirm && cur.onConfirm) {
        sfx(this.game, 'uiSelect');
        cur.onConfirm();
        used = true;
      }
    }
    return used;
  }
}

/** A modal screen: owns input while it is the top of the stack. */
export interface Layer {
  readonly id: string;
  handle(k: MenuKeys): void;
}

/**
 * Stack of open modal layers. While non-empty: `modalOpen` is true, the input context is 'menu' (restored when
 * the last layer closes, unless somebody else already changed it) and the pointer is released for mouse use.
 */
export class ModalStack {
  private readonly layers: Layer[] = [];
  private savedContext: InputContext | null = null;

  constructor(private readonly game: Game, private readonly menu: MenuInput) {}

  get open(): boolean {
    return this.layers.length > 0;
  }

  get top(): Layer | null {
    return this.layers[this.layers.length - 1] ?? null;
  }

  has(id: string): boolean {
    return this.layers.some((l) => l.id === id);
  }

  push(layer: Layer): void {
    this.remove(layer.id);
    const first = this.layers.length === 0;
    this.layers.push(layer);
    if (first) {
      this.menu.setActive(true);
      const input = this.game.input;
      if (!isStub(input)) {
        try {
          if (input.context !== 'menu') {
            this.savedContext = input.context;
            input.setContext('menu');
            input.exitPointerLock();
          }
        } catch {
          /* input not ready */
        }
      }
    }
  }

  remove(id: string): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    this.layers.splice(i, 1);
    if (this.layers.length === 0) {
      this.menu.setActive(false);
      const input = this.game.input;
      const saved = this.savedContext;
      this.savedContext = null;
      if (saved && !isStub(input)) {
        try {
          if (input.context === 'menu') input.setContext(saved);
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** route this frame's menu input to the top layer */
  update(): void {
    if (this.layers.length === 0) return;
    const keys = this.menu.poll();
    const top = this.top;
    if (top) top.handle(keys);
  }
}
