/**
 * Per-frame context handed to every HUD widget, plus the viewport metrics shared by projected elements.
 */
import type { Game, PlayerHudState } from '@/core/api';

export interface HudFrame {
  game: Game;
  /** null while the player controller is a stub / has no protagonist yet */
  state: PlayerHudState | null;
  /** real seconds since the previous frame */
  dt: number;
  /** simulation clock (stops while paused) */
  now: number;
  /** viewport size in CSS px */
  w: number;
  h: number;
  /** UI scale: CSS px per design unit (1 at 1080p) */
  u: number;
  /** settings snapshot read once per frame */
  reduceFlash: boolean;
}

export interface Viewport {
  w: number;
  h: number;
  u: number;
}

/** Mirror of the CSS `--u` clamp so JS-positioned elements scale identically. */
export function measureViewport(root: HTMLElement, out: Viewport): void {
  const w = root.clientWidth || globalThis.innerWidth || 1280;
  const hh = root.clientHeight || globalThis.innerHeight || 720;
  out.w = w;
  out.h = hh;
  out.u = Math.min(32, Math.max(13.6, Math.min(hh * 0.014815, w * 0.008334))) / 16;
}
