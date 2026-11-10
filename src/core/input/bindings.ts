/**
 * Default bindings (BRIEF §5 + the ButtonAction comments) and prompt glyphs for every device.
 * Keyboard bindings use KeyboardEvent.code so they are layout independent.
 */
import type { ButtonAction } from '@/core/api';

/** KeyboardEvent.code → actions it drives. One key may drive several context-exclusive actions. */
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

const KBM_GLYPHS: Record<ButtonAction, string> = {
  attack: 'LMB',
  heavy: 'F',
  guard: 'Q',
  aim: 'RMB',
  dodge: 'Space',
  sprint: 'Shift',
  interact: 'E',
  ability1: '1',
  ability2: '2',
  lockOn: 'Tab',
  scan: 'V',
  reload: 'R',
  swapShoulder: 'C',
  pause: 'Esc',
  skip: 'Space',
  confirm: 'Enter',
  cancel: 'Esc',
  menuUp: '↑',
  menuDown: '↓',
  menuLeft: '←',
  menuRight: '→',
};

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

/** Prompt glyph for an action on a device. Unknown actions fall back to "?" (never throws). */
export function glyphFor(action: ButtonAction, device: InputDevice, pad: PadStyle = 'xbox'): string {
  const table = device === 'kbm' ? KBM_GLYPHS : pad === 'playstation' ? PLAYSTATION_GLYPHS : XBOX_GLYPHS;
  return table[action] ?? '?';
}

/** Guess the face-button legend from a Gamepad.id string. */
export function padStyleFromId(id: string): PadStyle {
  const s = id.toLowerCase();
  return s.includes('054c') || s.includes('dualsense') || s.includes('dualshock') || s.includes('playstation')
    ? 'playstation'
    : 'xbox';
}
