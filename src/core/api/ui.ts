/**
 * UI contract — OWNER: ui (src/ui/*).
 * HTML/CSS overlay above the canvas (crisp type, accessible). The HUD polls game.player.getHudState() and
 * listens to events; scripts call the explicit methods below.
 *
 * Tone: restrained, elegant, thin rules, small caps, slate + parchment + aged gold. No vendor-screen clutter.
 * Accessibility contract: subtitles identify offscreen speakers; captions convey scans, links, pressure and
 * breach direction; never colour alone (pair with shape/motion/sound); hold/toggle alternatives.
 */
import type { DialogueLine, Vec3Like, CaptionKind, MissionState, Difficulty } from './common';
import type { Actor } from './combat';

export interface TitleOpts {
  canContinue: boolean;
  onNewGame(difficulty: Difficulty): void;
  onContinue(): void;
}

export interface ChoiceOption {
  id: string;
  label: string;
  /** one or two sentences on what the option means */
  detail: string;
  /** small tag ("WEST", "EAST") */
  tag?: string;
}

export interface ChoiceOpts {
  id: string;
  title: string;
  /** who is asking + the question */
  prompt: string;
  options: ChoiceOption[];
  /** footnote, e.g. "This choice is explicit and untimed." */
  note?: string;
}

export interface ChoiceHandle {
  /** null until the player commits (commit requires an explicit confirm step) */
  readonly selected: string | null;
  /** programmatic selection (autoplay) */
  select(id: string): void;
}

export interface WorldMarkerOpts {
  label?: string;
  kind?: 'objective' | 'optional' | 'return' | 'interact' | 'companion' | 'threat';
  /** hide when closer than this (m) */
  hideWithin?: number;
}

export interface MissionSummary {
  state: MissionState;
  lines: Array<{ label: string; value: string }>;
}

export interface UiSystem {
  init(): Promise<void>;

  // --- screens ---
  showTitle(opts: TitleOpts): void;
  hideTitle(): void;
  /** pause menu with settings (graphics, audio, controls, accessibility). */
  showPause(opts: { onResume(): void; onRestartCheckpoint(): void; onQuitToTitle(): void }): void;
  hidePause(): void;
  showDeath(opts: { onRetry(): void }): void;
  hideDeath(): void;
  showLoading(show: boolean, opts?: { title?: string; subtitle?: string; art?: 'wound-overlook' | 'relay-route' | 'quarantine-cooperation' | 'crownmark-chamber'; progress?: number }): void;
  showMissionComplete(summary: MissionSummary, opts: { onTitle(): void }): void;

  // --- HUD ---
  setHudVisible(visible: boolean): void;
  /** current objective line (null hides) */
  objective(text: string | null): void;
  /** world-space marker projected to screen with distance; pos null removes */
  marker(id: string, pos: Vec3Like | null, opts?: WorldMarkerOpts): void;
  /** interaction prompt near screen centre-bottom; progress 0..1 draws the hold ring; null hides */
  prompt(p: { text: string; glyph: string; progress?: number; hold?: boolean } | null): void;
  /** transient toast */
  toast(text: string, kind?: 'checkpoint' | 'info' | 'echo' | 'record' | 'warning'): void;
  /** zone title card: "Z01 · PRESSURE HALL" */
  zoneCard(title: string, subtitle?: string): void;
  /** contextual tutorial hint ("Hold Q to guard") with glyph; null hides */
  hint(h: { text: string; glyph?: string; seconds?: number } | null): void;
  /** in-fiction readout (carrier impact 1:31, forecast 02:11:43). null hides. Never a mission-wide clock. */
  readout(r: { label: string; value: string; tone?: 'amber' | 'cold' | 'gold' | 'violet' } | null): void;
  /** named elite frame (subtle, not boss framing): null hides */
  eliteBar(e: { name: string; hp: number; maxHp: number; regenerating: boolean; exposed: boolean } | null): void;
  /** directional damage tick; angle in radians relative to camera forward (0 = front, +right) */
  damageDirection(angle: number, strength?: number): void;
  hitMarker(kind?: 'hit' | 'weak' | 'kill' | 'blocked'): void;
  /** floating health/poise pips above actors are drawn automatically for hostile targetable actors; this pins one */
  focusActor(actor: Actor | null): void;

  // --- narrative ---
  subtitle(line: DialogueLine | null): void;
  caption(text: string, kind: CaptionKind, bearing?: number): void;
  letterbox(on: boolean, seconds?: number): void;
  /** full-screen fade. level 0 clear … 1 opaque. color 'black' | 'white' | 'gold' */
  fade(level: number, seconds?: number, color?: 'black' | 'white' | 'gold'): void;
  readonly fadeLevel: number;
  /** "Hold [Space] to skip" indicator; progress 0..1 */
  skipHint(show: boolean, progress?: number): void;
  /** large centred narrative card (opening context lines, Witness V captions) */
  card(text: string | null, opts?: { sub?: string; seconds?: number; style?: 'context' | 'witness' | 'consequence' | 'title' }): void;
  /** present the Z07 local decision. Explicit, untimed, confirm-to-commit. */
  choice(opts: ChoiceOpts): ChoiceHandle;
  /** status rows (consequence sequence: "BOUNDARY — CLOSED", "RELEASE — WITHHELD") */
  statusBoard(rows: Array<{ label: string; value: string; tone?: 'ok' | 'warn' | 'neutral' }> | null, opts?: { title?: string }): void;

  /** true while a menu/choice has focus and gameplay input should be ignored */
  readonly modalOpen: boolean;
  debugText(text: string | null): void;
  update(dt: number): void;
}
