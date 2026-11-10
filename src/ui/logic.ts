/**
 * Pure UI logic (no DOM) — unit tested in logic.test.ts.
 */
import type { ButtonAction, SpeakerId } from '@/core/api';

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clampN = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** Coerce anything (including null-object stubs) to a finite number. */
export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** "24 m", "7 m", "<1 m"; hundreds are rounded to 10. */
export function fmtDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 1) return '<1 m';
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.round(m)} m`;
}

/**
 * Angle of a world-space planar direction relative to a planar forward vector.
 * 0 = straight ahead, +π/2 = to the right, ±π = behind. (yaw 0 faces −Z; right of forward (fx,fz) is (−fz, fx).)
 */
export function relAngle(dx: number, dz: number, fx: number, fz: number): number {
  const fwd = dx * fx + dz * fz;
  const right = dx * -fz + dz * fx;
  if (fwd === 0 && right === 0) return 0;
  return Math.atan2(right, fwd);
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Clamp a screen point to the safe rectangle (inset mx left/right, myTop / myBottom) along the ray from the
 * screen centre. Returns true if the point had to be moved (it was outside the safe rect).
 */
export function edgeClamp(x: number, y: number, w: number, h: number, mx: number, myTop: number, myBottom: number, out: Pt): boolean {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const dx = x - cx;
  const dy = y - cy;
  const hw = Math.max(1, cx - mx);
  const hh = Math.max(1, dy < 0 ? cy - myTop : cy - myBottom);
  const k = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  if (k <= 1) {
    out.x = x;
    out.y = y;
    return false;
  }
  out.x = cx + dx / k;
  out.y = cy + dy / k;
  return true;
}

/**
 * Edge position for a target that cannot be projected (behind the camera): cast a ray from the centre in the
 * direction of the bearing (0 = up/front, +π/2 = right, π = down/behind) to the safe rectangle.
 */
export function bearingToEdge(bearing: number, w: number, h: number, mx: number, myTop: number, myBottom: number, out: Pt): void {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const dx = Math.sin(bearing);
  const dy = -Math.cos(bearing);
  const hw = Math.max(1, cx - mx);
  const hh = Math.max(1, dy < 0 ? cy - myTop : cy - myBottom);
  const k = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh) || 1;
  out.x = cx + dx / k;
  out.y = cy + dy / k;
}

/** Words for a bearing — captions never rely on the arrow glyph alone. */
export function bearingWord(bearing: number): string {
  const tau = Math.PI * 2;
  const a = ((bearing % tau) + tau) % tau;
  const i = Math.round(a / (Math.PI / 4)) % 8;
  return ['ahead', 'ahead right', 'right', 'behind right', 'behind', 'behind left', 'left', 'ahead left'][i] as string;
}

/** Reading time for a subtitle when the script gives no duration. */
export function subtitleSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return clampN(1.4 + words * 0.33, 2.2, 9);
}

const SENTENCE_END = /[.!?…;:]["')\]]?$|—$/;

/**
 * Greedy pagination of a subtitle into pages that each satisfy `fits` (≤ 2 rendered lines). Prefers to end a
 * page on sentence punctuation when one exists in the back half of the page. A single word that does not fit
 * still becomes its own page (never loops forever).
 */
export function paginate(text: string, fits: (candidate: string) => boolean): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const full = words.join(' ');
  if (fits(full)) return [full];
  const pages: string[] = [];
  let i = 0;
  while (i < words.length) {
    let n = 1;
    let line = words[i] as string;
    while (i + n < words.length) {
      const next = `${line} ${words[i + n]}`;
      if (!fits(next)) break;
      line = next;
      n++;
    }
    if (i + n < words.length) {
      // look back for a sentence end inside the back half so pages break on meaning
      for (let k = n; k > Math.max(1, Math.floor(n * 0.5)); k--) {
        if (SENTENCE_END.test(words[i + k - 1] as string)) {
          n = k;
          break;
        }
      }
      // avoid a one-word orphan page at the very end
      if (words.length - (i + n) === 1 && n > 3) n--;
    }
    pages.push(words.slice(i, i + n).join(' '));
    i += n;
  }
  return pages;
}

/** Share of the total duration each page gets (by length, with a floor so short pages remain readable). */
export function pageDurations(pages: readonly string[], total: number): number[] {
  if (pages.length === 0) return [];
  const weights = pages.map((p) => Math.max(12, p.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (total * w) / sum);
}

/** Number of poise pips shown for a poise pool (one per ~10 poise, 3..8). */
export function poisePips(maxPoise: number): number {
  return clampN(Math.round(num(maxPoise) / 10), 3, 8);
}

export type HitKind = 'hit' | 'weak' | 'kill' | 'blocked';
const HIT_RANK: Record<HitKind, number> = { blocked: 0, hit: 1, weak: 2, kill: 3 };

/** When two hit markers land in the same instant the more important one wins. */
export function strongerHit(a: HitKind, b: HitKind): HitKind {
  return HIT_RANK[b] > HIT_RANK[a] ? b : a;
}

export type Faction = 'dominion' | 'reformation' | 'ancient' | 'system' | 'eclipse' | 'neutral' | 'none';

const SPEAKER_FACTION: Record<string, Faction> = {
  tarrik: 'dominion', lyessa: 'dominion', malik: 'dominion', cross: 'dominion', 'dominion command': 'dominion',
  selene: 'reformation', tharne: 'reformation', lyric: 'reformation', sol: 'reformation', marine: 'reformation',
  'reformation command': 'reformation',
  terminal: 'system', king: 'ancient', narrator: 'none',
  medic: 'neutral', survivor: 'neutral', soldier: 'neutral',
};

/** Faction identity of a speaker (drives BOTH the colour and the shape tag of the subtitle name). */
export function speakerFaction(speaker: SpeakerId): Faction {
  const key = String(speaker).trim().toLowerCase();
  const direct = SPEAKER_FACTION[key];
  if (direct) return direct;
  if (key.includes('dominion')) return 'dominion';
  if (key.includes('reformation')) return 'reformation';
  if (key.includes('eclipse') || key.includes('weaver')) return 'eclipse';
  return 'neutral';
}

/** Keyboard + mouse fallback glyphs used when the input system is a stub or returns nothing usable. */
export const FALLBACK_GLYPH: Record<ButtonAction, string> = {
  attack: 'LMB', heavy: 'F', guard: 'Q', aim: 'RMB', dodge: 'Space', sprint: 'Shift', interact: 'E',
  ability1: '1', ability2: '2', lockOn: 'Tab', scan: 'V', reload: 'R', swapShoulder: 'C', pause: 'Esc',
  skip: 'Space', confirm: 'Enter', cancel: 'Esc', menuUp: '↑', menuDown: '↓', menuLeft: '←', menuRight: '→',
};

/** Step a numeric setting and keep it on a clean grid (no 0.30000000000000004). */
export function stepValue(v: number, dir: number, step: number, min: number, max: number): number {
  const n = Math.round((v + dir * step) / step) * step;
  return clampN(Math.round(n * 1000) / 1000, min, max);
}

/** Cycle through a list (wraps). */
export function cycle<T>(list: readonly T[], current: T, dir: number): T {
  const i = list.indexOf(current);
  const n = list.length;
  return list[(((i < 0 ? 0 : i) + dir) % n + n) % n] as T;
}

/** Move a focus index over `count` items skipping disabled ones; wraps. Returns `from` if nothing is enabled. */
export function moveFocus(from: number, dir: number, count: number, enabled: (i: number) => boolean): number {
  if (count <= 0) return -1;
  let i = from;
  for (let n = 0; n < count; n++) {
    i = ((i + dir) % count + count) % count;
    if (enabled(i)) return i;
  }
  return from;
}
