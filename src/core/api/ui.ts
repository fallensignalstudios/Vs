/**
 * UI contract — OWNER: ui (src/ui/*).
 * HTML/CSS overlay above the canvas (crisp type, accessible). The HUD polls game.player.getHudState() and
 * listens to events; scripts call the explicit methods below.
 *
 * Tone: restrained, elegant, thin rules, small caps, slate + parchment + aged gold. No vendor-screen clutter.
 * Accessibility contract: subtitles identify offscreen speakers; captions convey scans, links, pressure and
 * breach direction; never colour alone (pair with shape/motion/sound); hold/toggle alternatives.
 *
 * HOW THE UI BEHAVES (implementation notes every caller can rely on)
 *  - Timing is driven only by `update(dt)` (real seconds). Nothing uses timers, so headless stepping is exact.
 *  - Every method tolerates bad input (null opts, unknown kinds/ids, NaN): console.warn once + fallback, never throws.
 *  - Calling a method again with the same content is a no-op; calling it AND emitting the matching event shows
 *    one item, not two. Events the UI listens to by itself:
 *      'dialogue:line' → subtitle(line)          'dialogue:clear'   → subtitle(null)
 *      'caption'       → caption(text, kind) with a live bearing computed from `pos`
 *      'checkpoint:saved' → toast('Checkpoint saved', 'checkpoint')
 *      'objective:changed' → objective(text)     'player:protagonist' → HUD accent + name swap
 *      'player:damaged' → damage-direction arc   'actor:hit' (attacker = player) → hit marker
 *      'player:echo' → Echo gain flash + "+22 counter" label   'player:healed' → heal flash
 *      'zone:loading' → clears world-bound HUD (markers, prompt, hint, readout, elite frame, pinned actor)
 *  - UI sounds the UI plays itself (do not double them): uiMove / uiSelect / uiBack in menus, uiPrompt when a
 *    context action appears, uiObjective when the objective line changes, uiChoice / uiCommit on the choice
 *    panel. (The checkpoint toast is silent: the audio system already answers 'checkpoint:saved'.)
 *  - While any menu or the choice panel is open (`modalOpen`), the UI puts `game.input` into the 'menu' context
 *    and releases the pointer; when the last one closes it restores the context it found (unless somebody else
 *    changed it meanwhile). Menu presses it handles are consumed (including `pause`, so Esc never re-opens the
 *    pause menu it just closed).
 */
import type { DialogueLine, Vec3Like, CaptionKind, MissionState, Difficulty } from './common';
import type { Actor } from './combat';

export interface TitleOpts {
  /** show "Continue" (must be exactly `true`) */
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
  /** programmatic selection (autoplay) — commits immediately; unknown ids are ignored */
  select(id: string): void;
}

export interface WorldMarkerOpts {
  label?: string;
  /**
   * Kinds differ by SHAPE first: objective = solid diamond in a diamond, optional = dashed diamond with a dot,
   * return = square with a back chevron, interact = ring with a dot, companion = open triangle,
   * threat = solid inverted triangle. Default 'objective'.
   */
  kind?: 'objective' | 'optional' | 'return' | 'interact' | 'companion' | 'threat';
  /** hide when closer than this (m) */
  hideWithin?: number;
}

export interface MissionSummary {
  state: MissionState;
  lines: Array<{ label: string; value: string }>;
}

export interface UiSystem {
  /** Async warm-up (fonts, title art). Resolves within ~2.5 s even if assets are slow. */
  init(): Promise<void>;

  // --- screens ---
  /**
   * Title screen: Continue (if `canContinue`) · New Game → difficulty (Story / Standard / Hard) · Settings ·
   * Controls. Modal. If the HUD was hidden before the title opened it is made visible again by `hideTitle()`.
   */
  showTitle(opts: TitleOpts): void;
  hideTitle(): void;
  /**
   * pause menu with settings (graphics, audio, controls, accessibility). Restart / Quit ask for confirmation
   * before calling back. Esc / cancel on the root list calls `onResume`. The HUD is hidden underneath.
   */
  showPause(opts: { onResume(): void; onRestartCheckpoint(): void; onQuitToTitle(): void }): void;
  hidePause(): void;
  /** "Fallen" screen with a single "Return to checkpoint" action (accepts input after ~0.9 s). Modal. */
  showDeath(opts: { onRetry(): void }): void;
  hideDeath(): void;
  /**
   * Loading screen (not modal). Call repeatedly to update `progress` (0..1; omit for an indeterminate line).
   * Omitted fields keep their previous value. A `title` like "Z04 · Relay Overlook" is split into code + name.
   */
  showLoading(show: boolean, opts?: { title?: string; subtitle?: string; art?: 'wound-overlook' | 'relay-route' | 'quarantine-cooperation' | 'crownmark-chamber'; progress?: number }): void;
  /** Mission-complete summary: rows reveal one by one, then "Return to title" (hides itself, then calls back). */
  showMissionComplete(summary: MissionSummary, opts: { onTitle(): void }): void;

  // --- HUD ---
  /**
   * Show/hide the whole HUD (cinematics). Toasts and the zone card are independent of this. The HUD also hides
   * itself under the title, loading, pause, death, completion and choice screens without changing this flag.
   */
  setHudVisible(visible: boolean): void;
  /** ADDED — the visibility last requested through setHudVisible (save it before a cinematic, restore after). */
  readonly hudVisible: boolean;
  /** current objective line (null hides). A change animates and is tagged "Updated" for a few seconds. */
  objective(text: string | null): void;
  /**
   * world-space marker projected to screen with distance; pos null removes. Calling again with the same id
   * moves/updates it. Off-screen markers clamp to the screen edge with an arrow; with the navigation-assistance
   * setting off, objective/optional markers are only drawn while on screen and 'return' markers not at all.
   */
  marker(id: string, pos: Vec3Like | null, opts?: WorldMarkerOpts): void;
  /**
   * interaction prompt near screen centre-bottom; progress 0..1 draws the hold ring; null hides.
   * Pass `game.input.glyph(action)` as `glyph`. With `hold`, the verb reads "Hold" (or "Press" when the
   * hold→toggle setting is on).
   */
  prompt(p: { text: string; glyph: string; progress?: number; hold?: boolean } | null): void;
  /** transient toast (~3.6 s, max 4 stacked; an identical live toast is refreshed instead of duplicated) */
  toast(text: string, kind?: 'checkpoint' | 'info' | 'echo' | 'record' | 'warning'): void;
  /** zone title card: "Z01 · PRESSURE HALL" (code and name are split on "·"); shown ~4.6 s */
  zoneCard(title: string, subtitle?: string): void;
  /** contextual tutorial hint ("Hold Q to guard") with glyph; null hides. Without `seconds` it stays until replaced. */
  hint(h: { text: string; glyph?: string; seconds?: number } | null): void;
  /** in-fiction readout (carrier impact 1:31, forecast 02:11:43). null hides. Never a mission-wide clock. */
  readout(r: { label: string; value: string; tone?: 'amber' | 'cold' | 'gold' | 'violet' } | null): void;
  /**
   * named elite frame (subtle, not boss framing): null hides. Call every tick (or on change) with current hp.
   * "REGENERATING" is shown with a travelling sheen, "JOINT EXPOSED" with a diamond tag.
   */
  eliteBar(e: { name: string; hp: number; maxHp: number; regenerating: boolean; exposed: boolean } | null): void;
  /** directional damage tick; angle in radians relative to camera forward (0 = front, +right) */
  damageDirection(angle: number, strength?: number): void;
  /** hit / weak / kill / blocked differ by shape. Same-instant markers coalesce to the strongest. */
  hitMarker(kind?: 'hit' | 'weak' | 'kill' | 'blocked'): void;
  /** floating health/poise pips above actors are drawn automatically for hostile targetable actors; this pins one */
  focusActor(actor: Actor | null): void;
  /** ADDED — drop all world-bound HUD state (markers, prompt, hint, readout, elite frame, pinned actor). */
  clearWorldHud(): void;

  // --- narrative ---
  /**
   * Show a subtitle (null clears). The speaker name carries the faction colour AND a faction shape; `offscreen`
   * adds an "off-screen ▸" tag and `channel: 'radio'` a "(radio)" tag; 'system' and 'narration' have their own
   * type treatment. At most two lines are shown: longer text is paginated across the line's duration.
   * A line that nobody clears disappears `duration` (or `estimateSubtitleSeconds`) + 2.5 s after it appeared.
   */
  subtitle(line: DialogueLine | null): void;
  /** ADDED — reading time the UI assumes for a line without `duration` (1.4 s + 0.33 s/word, clamped 2.2–9 s). */
  estimateSubtitleSeconds(text: string): number;
  /**
   * "[ SCAN SWEEP → right ]" caption with a kind icon; `bearing` in radians relative to camera forward
   * (0 = ahead, + = right) adds the arrow and the direction in words. ~3.8 s, max 4.
   */
  caption(text: string, kind: CaptionKind, bearing?: number): void;
  /** letterbox bars (default 0.7 s ease). Subtitles move up to sit above the lower bar. */
  letterbox(on: boolean, seconds?: number): void;
  /** full-screen fade. level 0 clear … 1 opaque. color 'black' | 'white' | 'gold'. seconds 0/omitted = immediate. */
  fade(level: number, seconds?: number, color?: 'black' | 'white' | 'gold'): void;
  /** opacity on screen right now (linear in time during a fade) */
  readonly fadeLevel: number;
  /** "Hold [Space] to skip" indicator; progress 0..1 */
  skipHint(show: boolean, progress?: number): void;
  /**
   * large centred narrative card (opening context lines, Witness V captions). `\n` breaks lines. Cards are
   * drawn ABOVE the fade (use them over black). A new card cross-fades with the old one; `seconds` auto-hides.
   * Styles: 'context' serif statement · 'witness' gold caption in the lower third · 'consequence' wide
   * small-caps verdict with a rule · 'title' the large lockup ("Aurelion" / sub "Contrary Witness").
   * ADDED — 'flash': ONE-FLASH TEXT (Z05 `DO NOT LET HIM KNEEL.`). The words cut in, hold for `seconds`
   * (default 0.14 — a fraction of a second) and cut out; typeset capitals, no ornament or plate, above the fade.
   * A flash is independent of the narrative card: it neither replaces nor clears one, and `sub` is ignored.
   * With the reduce-flash setting it is a short soft fade (≥ 0.9 s) instead of a cut.
   */
  card(text: string | null, opts?: { sub?: string; seconds?: number; style?: 'context' | 'witness' | 'consequence' | 'title' | 'flash' }): void;
  /**
   * present the Z07 local decision. Explicit, untimed, confirm-to-commit: the player selects a card, then
   * confirms on a separate "Commit" control (cancel returns to browsing). Pauses nothing itself. `modalOpen`
   * is true until `handle.selected` is set; the panel then fades by itself. The UI does not emit 'choice:made'.
   */
  choice(opts: ChoiceOpts): ChoiceHandle;
  /**
   * status rows (consequence sequence: "BOUNDARY — CLOSED", "RELEASE — WITHHELD"). Rows reveal one by one
   * (~0.7 s apart); calling again with a longer list keeps the rows already shown and reveals only the new ones.
   * Tones differ by glyph: ok = check, warn = triangle, neutral = dash.
   */
  statusBoard(rows: Array<{ label: string; value: string; tone?: 'ok' | 'warn' | 'neutral' }> | null, opts?: { title?: string }): void;

  /** true while a menu/choice has focus and gameplay input should be ignored */
  readonly modalOpen: boolean;
  /** small monospace overlay for development (null hides) */
  debugText(text: string | null): void;
  /** advance all UI animation; `dt` in real seconds. Called once per tick by Game. */
  update(dt: number): void;
}
