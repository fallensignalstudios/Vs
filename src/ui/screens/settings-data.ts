/**
 * Declarative description of the settings screen: tabs, rows, copy. Every row is bound to one key of
 * `game.settings` and applied live.
 */
import type { ButtonAction, Settings } from '@/core/api';

export type SettingsTab = 'graphics' | 'audio' | 'controls' | 'gameplay' | 'accessibility';

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

export interface ToggleRow {
  kind: 'toggle';
  key: KeysOf<boolean>;
  label: string;
  desc: string;
}

export interface ChoiceRow {
  kind: 'choice';
  key: 'quality' | 'difficulty' | 'subtitleSize';
  label: string;
  desc: string;
  options: ReadonlyArray<{ value: string; label: string; desc?: string }>;
}

export interface SliderRow {
  kind: 'slider';
  key: KeysOf<number>;
  label: string;
  desc: string;
  min: number;
  max: number;
  step: number;
  format: 'percent' | 'times';
}

export interface ActionRow {
  kind: 'action';
  id: 'reset';
  label: string;
  desc: string;
}

export type RowDef = ToggleRow | ChoiceRow | SliderRow | ActionRow;

export interface TabDef {
  id: SettingsTab;
  label: string;
  rows: RowDef[];
  /** show the bindings reference grid under the rows */
  bindings?: boolean;
  /** show the live subtitle preview */
  preview?: boolean;
}

export const DIFFICULTY_OPTIONS = [
  { value: 'story', label: 'Story', desc: 'Lighter incoming damage and wider timing windows. For the story.' },
  { value: 'standard', label: 'Standard', desc: 'The intended balance of pressure, timing and recovery.' },
  { value: 'hard', label: 'Hard', desc: 'Tighter enemy coordination and overlapping volleys — not just more health.' },
] as const;

export const TABS: readonly TabDef[] = [
  {
    id: 'graphics', label: 'Graphics',
    rows: [
      {
        kind: 'choice', key: 'quality', label: 'Quality', desc: 'Rendering quality preset.',
        options: [
          { value: 'auto', label: 'Auto', desc: 'Chooses a preset for this device and adapts it.' },
          { value: 'low', label: 'Low', desc: 'Fastest. Reduced shadows, effects and resolution.' },
          { value: 'medium', label: 'Medium', desc: 'Balanced for integrated and older graphics hardware.' },
          { value: 'high', label: 'High', desc: 'Full lighting, reflections and ambient occlusion.' },
          { value: 'ultra', label: 'Ultra', desc: 'Highest fidelity. Hero surfaces at full resolution.' },
        ],
      },
      { kind: 'toggle', key: 'dynamicResolution', label: 'Dynamic resolution', desc: 'Lowers the internal resolution under load to hold the frame rate.' },
      { kind: 'toggle', key: 'showFps', label: 'Show frame rate', desc: 'Displays a small frame-rate counter in the corner.' },
    ],
  },
  {
    id: 'audio', label: 'Audio',
    rows: [
      { kind: 'slider', key: 'masterVolume', label: 'Master volume', desc: 'Overall loudness.', min: 0, max: 1, step: 0.05, format: 'percent' },
      { kind: 'slider', key: 'musicVolume', label: 'Music', desc: 'Adaptive score.', min: 0, max: 1, step: 0.05, format: 'percent' },
      { kind: 'slider', key: 'sfxVolume', label: 'Effects', desc: 'Combat, devices, ambience and interface sounds.', min: 0, max: 1, step: 0.05, format: 'percent' },
    ],
  },
  {
    id: 'controls', label: 'Controls',
    rows: [
      { kind: 'slider', key: 'mouseSensitivity', label: 'Mouse sensitivity', desc: 'Camera speed with the mouse.', min: 0.2, max: 3, step: 0.1, format: 'times' },
      { kind: 'slider', key: 'gamepadSensitivity', label: 'Gamepad sensitivity', desc: 'Camera speed with the right stick.', min: 0.2, max: 3, step: 0.1, format: 'times' },
      { kind: 'toggle', key: 'invertY', label: 'Invert vertical look', desc: 'Pushing up looks down.' },
    ],
    bindings: true,
  },
  {
    id: 'gameplay', label: 'Gameplay',
    rows: [
      { kind: 'choice', key: 'difficulty', label: 'Difficulty', desc: 'Can be changed at any time.', options: DIFFICULTY_OPTIONS },
      { kind: 'toggle', key: 'aimAssist', label: 'Aim assistance', desc: 'Gently slows the reticle over targets and weak points while aiming.' },
    ],
  },
  {
    id: 'accessibility', label: 'Accessibility',
    rows: [
      { kind: 'toggle', key: 'subtitles', label: 'Subtitles', desc: 'Shows dialogue as text. Offscreen and radio speakers are always identified.' },
      {
        kind: 'choice', key: 'subtitleSize', label: 'Subtitle size', desc: 'Text size for subtitles and captions.',
        options: [{ value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }, { value: 'xl', label: 'Extra large' }],
      },
      { kind: 'toggle', key: 'subtitleBackground', label: 'Subtitle background', desc: 'Places a dark plate behind subtitles for contrast over bright halls.' },
      { kind: 'toggle', key: 'captions', label: 'Captions', desc: 'Describes scans, links, pressure and breach direction as text with a bearing.' },
      { kind: 'toggle', key: 'reduceFlash', label: 'Reduce flashes', desc: 'Softens full-screen flashes and pulsing. Timings are unchanged.' },
      { kind: 'toggle', key: 'reduceShake', label: 'Reduce camera shake', desc: 'Removes impact shake. Timings are unchanged.' },
      { kind: 'toggle', key: 'reduceDistortion', label: 'Reduce distortion', desc: 'Removes corruption distortion; source, band and remedy stay visible.' },
      { kind: 'toggle', key: 'holdToToggle', label: 'Hold becomes toggle', desc: 'Hold interactions latch with a single press.' },
      { kind: 'toggle', key: 'autoPrompts', label: 'Automatic prompts', desc: 'Duel and Resonance prompts confirm themselves.' },
      { kind: 'toggle', key: 'navAssist', label: 'Navigation assistance', desc: 'Points to the next objective and the safe return from optional routes.' },
      { kind: 'action', id: 'reset', label: 'Restore defaults', desc: 'Resets every setting on every page to its default.' },
    ],
    preview: true,
  },
];

export interface BindingDef {
  action?: ButtonAction;
  /** literal glyphs per device when there is no single action (movement, look) */
  kbm?: string;
  pad?: string;
  label: string;
}

export const BINDINGS: readonly BindingDef[] = [
  { kbm: 'W A S D', pad: 'L', label: 'Move' },
  { kbm: 'Mouse', pad: 'R', label: 'Look' },
  { action: 'sprint', label: 'Sprint' },
  { action: 'dodge', label: 'Dodge' },
  { action: 'attack', label: 'Light attack · fire while aiming' },
  { action: 'heavy', label: 'Heavy attack · confirm Resonance' },
  { action: 'guard', label: 'Guard · timed: counter / deflect' },
  { action: 'aim', label: 'Aim' },
  { action: 'reload', label: 'Reload' },
  { action: 'ability1', label: 'Ability one' },
  { action: 'ability2', label: 'Ability two' },
  { action: 'lockOn', label: 'Lock on' },
  { action: 'scan', label: 'Tactical read' },
  { action: 'interact', label: 'Interact' },
  { action: 'swapShoulder', label: 'Swap shoulder' },
  { action: 'pause', label: 'Pause' },
];
