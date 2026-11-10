/**
 * Default bindings (BRIEF §5 + the ButtonAction comments), the rebindable keymap and prompt glyphs for every
 * device. Keyboard bindings use KeyboardEvent.code (physical key position), so WASD is ZQSD on an AZERTY
 * keyboard without any configuration; glyphs are translated through the OS layout where the browser exposes it.
 */
import type { ButtonAction } from '@/core/api';

/** KeyboardEvent.code → actions it drives by default. One key may drive several context-exclusive actions. */
export const KEY_BINDINGS: Readonly<Record<string, readonly ButtonAction[]>> = {
  KeyF: ['heavy'],
  KeyQ: ['guard'],
  Space: ['dodge', 'skip', 'confirm'],
  ShiftLeft: ['sprint'],
  ShiftRight: ['sprint'],
  KeyE: ['interact', 'confirm'],
  Digit1: ['ability1'],
  Numpad1: ['ability1'],
  Digit2: ['ability2'],
  Numpad2: ['ability2'],
  Tab: ['lockOn'],
  KeyV: ['scan'],
  KeyR: ['reload'],
  KeyC: ['swapShoulder'],
  Escape: ['pause', 'cancel'],
  KeyP: ['pause'],
  Enter: ['skip', 'confirm'],
  NumpadEnter: ['skip', 'confirm'],
  Backspace: ['cancel'],
  ArrowUp: ['menuUp'],
  ArrowDown: ['menuDown'],
  ArrowLeft: ['menuLeft'],
  ArrowRight: ['menuRight'],
  KeyW: ['menuUp'],
  KeyS: ['menuDown'],
  KeyA: ['menuLeft'],
  KeyD: ['menuRight'],
};

/** Movement keys (also menu directions through KEY_BINDINGS). */
export const MOVE_KEYS = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD' } as const;
/** Arrow keys always rotate the camera in the game context (the no-pointer-lock fallback). */
export const LOOK_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

/** MouseEvent.button → actions. 3 = Mouse4 (back thumb button). */
export const MOUSE_BINDINGS: ReadonlyArray<readonly ButtonAction[]> = [
  ['attack'], // 0 LMB
  ['lockOn'], // 1 MMB
  ['aim'], // 2 RMB
  ['guard'], // 3 Mouse4
  [], // 4 Mouse5 (unbound; default navigation is still suppressed on the canvas)
];

/** Standard-mapping gamepad button indices. */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

export type InputDevice = 'kbm' | 'gamepad';
export type PadStyle = 'xbox' | 'playstation';

/** The key a player can move with `rebind` (one per gameplay action). Mouse buttons and UI keys are fixed. */
const PRIMARY_KEY: Partial<Record<ButtonAction, string>> = {
  heavy: 'KeyF',
  guard: 'KeyQ',
  dodge: 'Space',
  sprint: 'ShiftLeft',
  interact: 'KeyE',
  ability1: 'Digit1',
  ability2: 'Digit2',
  lockOn: 'Tab',
  scan: 'KeyV',
  reload: 'KeyR',
  swapShoulder: 'KeyC',
};

/** Keys that keep their meaning whatever the player rebinds (movement, camera, pause, menu navigation). */
const RESERVED = /^(Key[WASD]|Arrow.*|Escape|Enter|NumpadEnter|Backspace|F\d+|Meta.*|Control.*|Alt.*|OS.*|ContextMenu|PrintScreen)$/;

/** Fixed kbm glyphs: mouse buttons and the UI actions. Keyboard gameplay actions resolve through the keymap. */
const KBM_FIXED: Partial<Record<ButtonAction, string>> = {
  attack: 'LMB',
  aim: 'RMB',
  pause: 'Esc',
  skip: 'Space',
  confirm: 'Enter',
  cancel: 'Esc',
  menuUp: '↑',
  menuDown: '↓',
  menuLeft: '←',
  menuRight: '→',
};

const CODE_LABELS: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Minus: '-',
  Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
};

/** code → printed character for the user's keyboard layout (navigator.keyboard.getLayoutMap), when known */
export type LayoutMap = { get(code: string): string | undefined };

/** Human label of a physical key. Letter / digit / punctuation keys go through the OS layout when available. */
export function keyLabel(code: string, layout: LayoutMap | null = null): string {
  const fixed = CODE_LABELS[code];
  // (digits stay digits: on AZERTY the unshifted character of Digit1 is "&", but the key still reads 1)
  const printable = code.startsWith('Key') || (fixed !== undefined && fixed.length === 1);
  if (printable && layout) {
    const ch = layout.get(code);
    if (typeof ch === 'string' && ch.length > 0 && ch.length <= 2) return ch.toUpperCase();
  }
  if (fixed !== undefined) return fixed;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  return code;
}

/**
 * The live keyboard map: defaults plus the player's rebinds. `get` is the hot path (one Map lookup per key
 * event); everything else runs on a settings screen.
 */
export class Keymap {
  private readonly byCode = new Map<string, ButtonAction[]>();
  private readonly primary = new Map<ButtonAction, string>();

  constructor() {
    this.reset();
  }

  /** actions driven by a physical key, or undefined when the key is unbound */
  get(code: string): readonly ButtonAction[] | undefined {
    return this.byCode.get(code);
  }

  /** the rebindable key of a gameplay action (null for mouse-only and UI actions) */
  keyOf(action: ButtonAction): string | null {
    return this.primary.get(action) ?? null;
  }

  reset(): void {
    this.byCode.clear();
    this.primary.clear();
    for (const code of Object.keys(KEY_BINDINGS)) this.byCode.set(code, [...KEY_BINDINGS[code]]);
    for (const a of Object.keys(PRIMARY_KEY) as ButtonAction[]) this.primary.set(a, PRIMARY_KEY[a] as string);
  }

  /**
   * Move a gameplay action to another physical key. If that key already drives another rebindable action the
   * two swap, so nothing is ever left unbound. Returns false (and changes nothing) for actions without a
   * keyboard binding and for reserved keys (movement, arrows, Esc, Enter, F-keys, modifiers).
   */
  rebind(action: ButtonAction, code: string): boolean {
    const from = this.primary.get(action);
    if (from === undefined || typeof code !== 'string' || code.length === 0 || RESERVED.test(code)) return false;
    if (from === code) return true;
    let other: ButtonAction | null = null;
    for (const [a, c] of this.primary) if (c === code) other = a;
    this.detach(action, from);
    if (other) {
      this.detach(other, code);
      this.attach(other, from);
    }
    this.attach(action, code);
    return true;
  }

  /** the rebinds that differ from the defaults, as { action: code } */
  overrides(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [a, c] of this.primary) if (PRIMARY_KEY[a] !== c) out[a] = c;
    return out;
  }

  /** apply a stored { action: code } object; unknown or invalid entries are skipped */
  load(saved: unknown): void {
    if (!saved || typeof saved !== 'object') return;
    for (const [a, c] of Object.entries(saved as Record<string, unknown>)) {
      if (typeof c === 'string' && this.primary.has(a as ButtonAction)) this.rebind(a as ButtonAction, c);
    }
  }

  private detach(action: ButtonAction, code: string): void {
    this.remove(action, code);
    // the second default key of an action (ShiftRight, Numpad1…) follows it off the default
    for (const twin of TWINS.get(action) ?? []) this.remove(action, twin);
  }

  private attach(action: ButtonAction, code: string): void {
    this.add(action, code, true);
    this.primary.set(action, code);
    if (PRIMARY_KEY[action] === code) for (const twin of TWINS.get(action) ?? []) this.add(action, twin, false);
  }

  private remove(action: ButtonAction, code: string): void {
    const list = this.byCode.get(code);
    if (!list) return;
    const i = list.indexOf(action);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.byCode.delete(code);
  }

  private add(action: ButtonAction, code: string, front: boolean): void {
    const list = this.byCode.get(code);
    if (!list) this.byCode.set(code, [action]);
    else if (!list.includes(action)) front ? list.unshift(action) : list.push(action);
  }
}

/** extra default keys of each rebindable action (same action, other key) */
const TWINS = new Map<ButtonAction, string[]>(
  (Object.keys(PRIMARY_KEY) as ButtonAction[]).map((a) => [a, Object.keys(KEY_BINDINGS).filter((c) => c !== PRIMARY_KEY[a] && KEY_BINDINGS[c].includes(a))]),
);

const XBOX_GLYPHS: Record<ButtonAction, string> = {
  attack: 'X',
  heavy: 'Y',
  guard: 'LB',
  aim: 'LT',
  dodge: 'A',
  sprint: 'L3',
  interact: 'B',
  ability1: 'RB',
  ability2: 'RT+RB',
  lockOn: 'R3',
  scan: 'D↑',
  reload: 'D↓',
  swapShoulder: 'D←',
  pause: 'Start',
  skip: 'B',
  confirm: 'A',
  cancel: 'B',
  menuUp: 'D↑',
  menuDown: 'D↓',
  menuLeft: 'D←',
  menuRight: 'D→',
};

const PLAYSTATION_GLYPHS: Record<ButtonAction, string> = {
  attack: '□',
  heavy: '△',
  guard: 'L1',
  aim: 'L2',
  dodge: '✕',
  sprint: 'L3',
  interact: '○',
  ability1: 'R1',
  ability2: 'R2+R1',
  lockOn: 'R3',
  scan: 'D↑',
  reload: 'D↓',
  swapShoulder: 'D←',
  pause: 'Options',
  skip: '○',
  confirm: '✕',
  cancel: '○',
  menuUp: 'D↑',
  menuDown: 'D↓',
  menuLeft: 'D←',
  menuRight: 'D→',
};

/**
 * Prompt glyph for an action on a device. Keyboard glyphs follow the player's rebinds (`keymap`) and keyboard
 * layout (`layout`) when supplied. Unknown actions fall back to "?" (never throws).
 */
export function glyphFor(
  action: ButtonAction, device: InputDevice, pad: PadStyle = 'xbox', keymap: Keymap | null = null, layout: LayoutMap | null = null,
): string {
  if (device !== 'kbm') return (pad === 'playstation' ? PLAYSTATION_GLYPHS : XBOX_GLYPHS)[action] ?? '?';
  const fixed = KBM_FIXED[action];
  if (fixed !== undefined) return fixed;
  const code = keymap ? keymap.keyOf(action) : PRIMARY_KEY[action];
  return typeof code === 'string' ? keyLabel(code, layout) : '?';
}

/** Guess the face-button legend from a Gamepad.id string. */
export function padStyleFromId(id: string): PadStyle {
  const s = id.toLowerCase();
  return s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('playstation')
    ? 'playstation'
    : 'xbox';
}

const BINDINGS_KEY = 'aurelion.bindings.v1';
/** where rebinds persist (localStorage); may be absent, and every access may throw in sandboxed frames */
export type BindingStore = { getItem(key: string): string | null; setItem(key: string, value: string): void } | null | undefined;

/** Apply the player's stored rebinds to `keymap` (missing / corrupt / blocked storage = defaults). */
export function loadKeymap(keymap: Keymap, store: BindingStore): void {
  try {
    const raw = store?.getItem(BINDINGS_KEY);
    if (raw) keymap.load(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
}

/** Persist the rebinds (a blocked storage just means they last for this session). */
export function saveKeymap(keymap: Keymap, store: BindingStore): void {
  try {
    store?.setItem(BINDINGS_KEY, JSON.stringify(keymap.overrides()));
  } catch {
    /* storage unavailable */
  }
}

/** Ask the browser for the keyboard layout (Chromium only); `done` is called if and when it answers. */
export function readLayout(get: (() => Promise<LayoutMap>) | null | undefined, done: (map: LayoutMap) => void): void {
  if (typeof get !== 'function') return;
  try {
    const p = get();
    if (p && typeof p.then === 'function') {
      p.then((map) => {
        if (map && typeof map.get === 'function') done(map);
      }, () => {});
    }
  } catch {
    /* layout unknown: glyphs fall back to the US labels */
  }
}
