/**
 * Shared visual vocabulary: icon markup (static, trusted SVG strings), marker/caption/faction shape tables and the
 * glyph key-cap builder. Meaning is never carried by colour alone — every category here has its own SHAPE.
 */
import type { ButtonAction, CaptionKind, Game, WorldMarkerOpts } from '@/core/api';
import { isStub } from '@/core/stub';
import { h, svg } from './dom';
import { FALLBACK_GLYPH, type Faction } from './logic';

/** 16×16 faction shape tags used next to speaker names. */
export const FACTION_ICON: Record<Faction, string> = {
  // heavy downward shield
  dominion: '<path d="M3 2.5h10v6.2L8 14 3 8.7z" fill="currentColor"/>',
  // precise hollow hexagon with a centre point
  reformation: '<path d="M8 1.8l5.4 3.1v6.2L8 14.2 2.6 11.1V4.9z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/>',
  // King-era diamond
  ancient: '<path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill="currentColor"/>',
  // terminal: square frame with an inner block
  system: '<rect x="2.7" y="2.7" width="10.6" height="10.6" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/>',
  // broken, intruding triangle
  eclipse: '<path d="M8 1.6l6.2 12.2H9.6L8 10.4l-1.6 3.4H1.8z" fill="currentColor"/>',
  // civilians / mixed: plain ring
  neutral: '<circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  none: '',
};

export type MarkerKind = NonNullable<WorldMarkerOpts['kind']>;

/** 24×24 world-marker shapes (kinds differ by silhouette, then by colour). */
export const MARKER_ICON: Record<MarkerKind, string> = {
  objective: '<path d="M12 2.2L21.8 12 12 21.8 2.2 12z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M12 7l5 5-5 5-5-5z" fill="currentColor"/>',
  optional: '<path d="M12 4l8 8-8 8-8-8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3.2 2.2"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/>',
  return: '<rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M13.6 8.2L9.6 12l4 3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/>',
  interact: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>',
  companion: '<path d="M12 4.5l7.5 14h-15z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/>',
  threat: '<path d="M3.5 5h17L12 20.5z" fill="currentColor"/><path d="M12 8.2v5.2" stroke="#0b0f16" stroke-width="1.7"/><circle cx="12" cy="15.6" r="1" fill="#0b0f16"/>',
};

/** 16×16 caption icons. */
export const CAPTION_ICON: Record<CaptionKind, string> = {
  scan: '<path d="M2.5 12.5a8 8 0 0 1 11 0M4.8 10a5 5 0 0 1 6.4 0" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="12.6" r="1.2" fill="currentColor"/>',
  link: '<rect x="1.8" y="5.6" width="7" height="4.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="7.2" y="5.6" width="7" height="4.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  pressure: '<circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2.4 2"/>',
  breach: '<path d="M9.6 1.5L5.2 7h4L5.8 14.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/>',
  impact: '<path d="M8 1.5v3.4M8 11.1v3.4M1.5 8h3.4M11.1 8h3.4M3.4 3.4l2.3 2.3M10.3 10.3l2.3 2.3M12.6 3.4l-2.3 2.3M5.7 10.3l-2.3 2.3" stroke="currentColor" stroke-width="1.3"/>',
  ambient: '<path d="M1.5 9.5c2.2-4 4.3-4 6.5 0s4.3 4 6.5 0" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  door: '<path d="M6.2 2.5H3v11h3.2M9.8 2.5H13v11H9.8" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  alert: '<path d="M8 2l6.3 11.5H1.7z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 6.2v3.6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="11.5" r="0.9" fill="currentColor"/>',
};

/** Misc 16×16 glyphs. */
export const ICON = {
  chain: CAPTION_ICON.link,
  diamond: '<path d="M8 1.8L14.2 8 8 14.2 1.8 8z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5.6L10.4 8 8 10.4 5.6 8z" fill="currentColor"/>',
  diamondSolid: '<path d="M8 2L14 8 8 14 2 8z" fill="currentColor"/>',
  shield: '<path d="M3 2.8h10v5.8L8 13.6 3 8.6z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  radio: '<path d="M2 8h1.6M5.2 5v6M8 2.6v10.8M10.8 5v6M13.4 8H14" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>',
  arrow: '<path d="M8 2.2l4.6 6.2H9.4v5.4H6.6V8.4H3.4z" fill="currentColor"/>',
  chevron: '<path d="M4 5.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  regen: '<path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" stroke-width="1.8"/>',
  check: '<path d="M3 8.4l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  blade: '<path d="M2.5 13.5l1.6-4.2L11.8 2l2.2-.2-.2 2.2-7.3 7.7z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.4 9.6l3 3" stroke="currentColor" stroke-width="1.2"/>',
  sidearm: '<path d="M2 5h11.5v2.6H8.6l-.8 1.6H6.4L5.8 13H2.8l.8-5.4H2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"/>',
} as const;

export function icon(markup: string, cls = 'aur-ico', box = 16): SVGSVGElement {
  return svg(`0 0 ${box} ${box}`, cls, markup);
}

/** Device-aware prompt glyph; tolerates a stub input system. */
export function glyphText(game: Game, action: ButtonAction): string {
  const input = game.input;
  if (!isStub(input)) {
    try {
      const g = input.glyph(action);
      if (typeof g === 'string' && g.length > 0) return g;
    } catch {
      /* fall through to the reference glyph */
    }
  }
  return FALLBACK_GLYPH[action] ?? '?';
}

/**
 * Key-cap element for a glyph string. Single characters get a square cap, words a wide cap; gamepad face buttons
 * a round cap. Single letters are set in the title face so Q / O / I never read as 0 / 1 at prompt size.
 * The element is reusable: call `setKeycap` to change the text later.
 */
export function keycap(text: string, cls = ''): HTMLSpanElement {
  const el = h('span', `aur-key ${cls}`.trim());
  setKeycap(el, text);
  return el;
}

const capState = new WeakMap<HTMLElement, string>();
/** a single letter of any script: set in the title face (see `.aur-key.is-letter` in styles/base.css) */
const LETTER = /^\p{L}$/u;

export function setKeycap(el: HTMLElement, text: string, round = false): void {
  const key = round ? `${text}\u0001` : text;
  if (capState.get(el) === key) return;
  capState.set(el, key);
  el.textContent = text;
  el.classList.toggle('is-wide', text.length > 1);
  el.classList.toggle('is-letter', LETTER.test(text));
  el.classList.toggle('is-round', round);
}

/** true when face-button glyphs should be drawn round */
export function isGamepad(game: Game): boolean {
  return !isStub(game.input) && game.input.device === 'gamepad';
}

export const ART = ['wound-overlook', 'relay-route', 'quarantine-cooperation', 'crownmark-chamber'] as const;
export type ArtId = (typeof ART)[number];

/** URL of a bundled concept painting (served from /public/art). */
export function artUrl(id: ArtId): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? './';
  return `${base}art/${id}.jpg`;
}
