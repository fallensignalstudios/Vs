/**
 * Cinematic staging: letterbox bars, full-screen fades (black / white / gold, `level` always accurate), the
 * hold-to-skip indicator and the large narrative card.
 */
import type { Game } from '@/core/api';
import { Fader, Num, Txt, easeInOut, h, warnOnce } from '../dom';
import { clamp01, num } from '../logic';
import { glyphText, isGamepad, keycap, setKeycap } from '../theme';

// ---------------------------------------------------------------------------------------------- letterbox
export class Letterbox {
  readonly el: HTMLElement;
  private level = 0;
  private from = 0;
  private to = 0;
  private t = 1;
  private dur = 0.7;
  private readonly apply: Num;

  constructor() {
    const top = h('i', 'aur-lb aur-lb-top');
    const bottom = h('i', 'aur-lb aur-lb-bottom');
    this.el = h('div', 'aur-layer aur-letterbox', top, bottom);
    this.el.style.display = 'none';
    this.apply = new Num((v) => {
      this.el.style.display = v <= 0.0005 ? 'none' : 'block';
      top.style.transform = `translate3d(0, ${((v - 1) * 100).toFixed(2)}%, 0)`;
      bottom.style.transform = `translate3d(0, ${((1 - v) * 100).toFixed(2)}%, 0)`;
    }, 0.0005);
  }

  /** true once the bars are (going) in */
  get on(): boolean {
    return this.to > 0;
  }

  set(on: boolean, seconds = 0.7): void {
    const target = on ? 1 : 0;
    if (target === this.to && this.t < 1) return;
    this.from = this.level;
    this.to = target;
    this.dur = Math.max(0, num(seconds, 0.7));
    this.t = this.dur <= 0 || this.from === target ? 1 : 0;
    if (this.t >= 1) {
      this.level = target;
      this.apply.set(this.level);
    }
  }

  update(dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.dur);
    this.level = this.from + (this.to - this.from) * easeInOut(this.t);
    this.apply.set(this.level);
  }
}

// ---------------------------------------------------------------------------------------------- fade
export type FadeColor = 'black' | 'white' | 'gold';

export class ScreenFade {
  readonly el: HTMLElement;
  /** current opacity 0..1 (what is on screen right now) */
  level = 0;
  private from = 0;
  private to = 0;
  private t = 1;
  private dur = 0;
  private color: FadeColor = 'black';
  private readonly apply: Num;

  constructor() {
    this.el = h('div', 'aur-layer aur-fade');
    this.el.dataset.color = 'black';
    this.el.style.display = 'none';
    this.apply = new Num((v) => {
      this.el.style.display = v <= 0.0005 ? 'none' : 'block';
      this.el.style.opacity = v.toFixed(3);
    }, 0.0005);
  }

  fade(level: number, seconds = 0, color: FadeColor = 'black'): void {
    const target = clamp01(num(level, 0));
    let c: FadeColor = color;
    if (c !== 'black' && c !== 'white' && c !== 'gold') {
      warnOnce(`fade:${String(color)}`, `unknown fade colour "${String(color)}" — using black`);
      c = 'black';
    }
    // a fade back to clear keeps the colour it went out with unless one is given while already clear
    if (c !== this.color && (target > 0 || this.level <= 0)) {
      this.color = c;
      this.el.dataset.color = c;
    }
    this.from = this.level;
    this.to = target;
    this.dur = Math.max(0, num(seconds, 0));
    if (this.dur <= 0 || this.from === target) {
      this.t = 1;
      this.level = target;
      this.apply.set(this.level);
    } else {
      this.t = 0;
    }
  }

  update(dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.dur);
    this.level = this.t >= 1 ? this.to : this.from + (this.to - this.from) * this.t;
    this.apply.set(this.level);
  }
}

// ---------------------------------------------------------------------------------------------- skip hint
export class SkipHint {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly key: HTMLElement;
  private readonly ringEl: HTMLElement;
  private readonly ring: Num;
  private readonly label: Txt;
  private covered = false;

  constructor(private readonly game: Game) {
    this.key = keycap('', '');
    this.ringEl = h('div', 'aur-ring', this.key);
    const label = h('span', 'aur-skip-label aur-label');
    this.el = h('div', 'aur-skip', label, this.ringEl);
    this.label = new Txt(label);
    this.ring = new Num((v) => { this.ringEl.style.setProperty('--p', v.toFixed(3)); }, 0.003);
    this.fader = new Fader(this.el, { in: 0.25, out: 0.5, display: 'flex' });
  }

  set(show: boolean, progress = 0): void {
    if (show) {
      const g = glyphText(this.game, 'skip');
      setKeycap(this.key, g, isGamepad(this.game) && g.length === 1);
      const p = clamp01(num(progress, 0));
      this.ring.set(p);
      this.label.set(this.game.settings.get('holdToToggle') === true ? 'Press to skip' : p > 0 ? 'Skipping' : 'Hold to skip');
    }
    this.fader.show(show === true);
  }

  /** hidden without losing state (debug clean frame) */
  setCovered(covered: boolean): void {
    if (covered === this.covered) return;
    this.covered = covered;
    this.el.style.visibility = covered ? 'hidden' : '';
  }

  update(dt: number): void {
    this.fader.update(dt);
  }
}

// ---------------------------------------------------------------------------------------------- card
export type CardStyle = 'context' | 'witness' | 'consequence' | 'title' | 'flash';
const CARD_STYLES: readonly CardStyle[] = ['context', 'witness', 'consequence', 'title'];
/** a flash is on screen this long unless `seconds` says otherwise: long enough to register, too short to read twice */
export const FLASH_SECONDS = 0.14;
/** with the reduce-flash setting the same words fade in and out gently instead of cutting */
const FLASH_SOFT_SECONDS = 0.9;
const FLASH_SOFT_FADE = 0.22;

/** ADDED (fix & ship): a screen rectangle in CSS px (left, top, right, bottom) */
export interface ScreenBox {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** the card text's font size per style, in UI units (styles/narrative.css) */
const CARD_FONT: Partial<Record<CardStyle, number>> = { context: 30, witness: 27, consequence: 36, title: 70 };

interface CardSpec {
  text: string;
  sub: string;
  seconds: number;
  style: CardStyle;
}

export class Card {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly text: Txt;
  private readonly sub: Txt;
  private readonly subEl: HTMLElement;
  private current: CardSpec | null = null;
  private pending: CardSpec | null = null;
  private life = Infinity;
  /** (polish 4) debug clean frame: a 'context' card is hidden (not cleared) while this is on */
  private covered = false;
  /** (fix & ship) a full-screen screen (pause, death, …) is up: every card style hides and its timer holds */
  private screened = false;
  private hiddenNow = false;

  constructor() {
    const text = h('div', 'aur-card-text');
    this.subEl = h('div', 'aur-card-sub');
    this.el = h('div', 'aur-card',
      h('div', 'aur-card-orn', h('i'), h('b'), h('i')),
      text,
      h('div', 'aur-card-rule'),
      this.subEl,
    );
    this.text = new Txt(text);
    this.sub = new Txt(this.subEl);
    this.fader = new Fader(this.el, { in: 0.9, out: 0.6, display: 'flex' });
  }

  set(text: string | null, options?: { sub?: string; seconds?: number; style?: Exclude<CardStyle, 'flash'> } | null): void {
    const opts = options ?? {};
    const t = text === null || text === undefined ? '' : String(text).trim();
    if (!t) {
      this.pending = null;
      this.current = null;
      this.fader.show(false);
      return;
    }
    let style: CardStyle = opts.style ?? 'context';
    if (!CARD_STYLES.includes(style)) {
      warnOnce(`card:${String(opts.style)}`, `unknown card style "${String(opts.style)}" — using 'context'`);
      style = 'context';
    }
    const spec: CardSpec = { text: t, sub: String(opts.sub ?? '').trim(), seconds: num(opts.seconds, 0), style };
    const cur = this.current;
    if (cur && this.fader.on && cur.text === spec.text && cur.sub === spec.sub && cur.style === spec.style) {
      this.life = spec.seconds > 0 ? spec.seconds : Infinity;
      return;
    }
    if (this.fader.visible) {
      // cross-fade: let the old card leave first
      this.pending = spec;
      this.current = null;
      this.fader.show(false);
      return;
    }
    this.present(spec);
  }

  /**
   * ADDED (polish 4). Debug clean frame (`__aurelion.hud(false)`): a 'context' card — an information overlay
   * over gameplay — is hidden without losing its state or timer; the narrative styles ('witness', 'consequence',
   * 'title') still draw, as they are part of the shot.
   */
  setCovered(covered: boolean, screen = false): void {
    this.covered = covered === true;
    this.screened = screen === true;
    this.applyCover();
  }

  private applyCover(): void {
    // (fix & ship) the pause menu and the other full-screen screens are translucent: the card must not show through
    // them (it overlapped the pause menu's text), so under a screen every style hides, not only 'context'
    const hide = this.screened || (this.covered && this.el.dataset.style === 'context');
    if (hide === this.hiddenNow) return;
    this.hiddenNow = hide;
    this.el.style.visibility = hide ? 'hidden' : '';
  }

  /** ADDED. Drop the card (and one waiting to cross-fade in) at once — a zone change never inherits a card. */
  clear(): void {
    this.pending = null;
    this.current = null;
    this.life = Infinity;
    this.fader.show(false, true);
  }

  private present(spec: CardSpec): void {
    this.current = spec;
    this.pending = null;
    this.el.dataset.style = spec.style;
    this.applyCover();
    this.text.set(spec.text);
    this.sub.set(spec.sub);
    this.subEl.style.display = spec.sub ? '' : 'none';
    this.life = spec.seconds > 0 ? spec.seconds : Infinity;
    this.fader.show(true);
  }

  /**
   * ADDED (fix & ship): the screen box world labels keep clear of while the card is up, in the coordinates of
   * `root` (the UI root); null while no card shows. Measured from the card when the browser lays it out, else
   * estimated from its style and text (headless tests); widened by the inner part of the card's soft plate.
   */
  avoidBox(root: HTMLElement, w: number, vh: number, u: number, out: ScreenBox): ScreenBox | null {
    if (!this.fader.visible || this.fader.level <= 0.02 || this.hiddenNow) return null;
    let r: { left: number; top: number; width: number; height: number } | null = null;
    let origin: { left: number; top: number } = { left: 0, top: 0 };
    try {
      r = this.el.getBoundingClientRect();
      origin = root.getBoundingClientRect();
    } catch {
      r = null;
    }
    if (r && r.width > 1 && r.height > 1) {
      out.l = r.left - origin.left;
      out.t = r.top - origin.top;
      out.r = out.l + r.width;
      out.b = out.t + r.height;
    } else {
      const style = (this.el.dataset.style ?? 'context') as CardStyle;
      const font = (CARD_FONT[style] ?? 30) * u;
      const boxW = Math.min(1040 * u, 0.84 * w);
      const text = this.current?.text ?? this.pending?.text ?? '';
      const lines = Math.max(1, Math.ceil((text.length * font * 0.62) / Math.max(1, boxW)));
      const half = (lines * font * 1.5 + (this.current?.sub ? 50 * u : 0)) / 2;
      const cy = vh * (style === 'witness' ? 0.71 : 0.5);
      out.l = (w - boxW) / 2;
      out.r = (w + boxW) / 2;
      out.t = cy - half;
      out.b = cy + half;
    }
    // the plate reaches 40 / 70 u past the text; its outer half is faint enough to read a label through
    out.l -= 20 * u;
    out.r += 20 * u;
    out.t -= 35 * u;
    out.b += 35 * u;
    return out;
  }

  update(dt: number): void {
    // a card's timer holds while a screen covers it (the scene under the pause menu is frozen too)
    if (this.current && this.life !== Infinity && !this.screened) {
      this.life -= dt;
      if (this.life <= 0) {
        this.current = null;
        this.fader.show(false);
      }
    }
    const visible = this.fader.update(dt);
    if (!visible && this.pending) this.present(this.pending);
  }
}

// ---------------------------------------------------------------------------------------------- flash
/**
 * One-flash text (`card(text, { style: 'flash' })`): typeset words that CUT in, hold for a fraction of a second
 * and cut out — no ornament, no plate, drawn above the fade. Independent of the narrative card (a flash never
 * replaces a card that is up). With `reduceFlash` it becomes a short soft fade instead of a cut.
 */
export class FlashText {
  readonly el: HTMLElement;
  private readonly text: Txt;
  private left = 0;
  private total = 0;
  private soft = false;
  private readonly opacity: Num;

  constructor(private readonly game: Game) {
    const text = h('div', 'aur-flash-text');
    this.el = h('div', 'aur-flash', text);
    this.el.style.display = 'none';
    this.text = new Txt(text);
    this.opacity = new Num((v) => {
      this.el.style.display = v <= 0.001 ? 'none' : 'flex';
      this.el.style.opacity = v.toFixed(3);
    }, 0.001);
  }

  /** true while the words are on screen */
  get on(): boolean {
    return this.left > 0;
  }

  show(text: string | null, seconds?: number): void {
    const t = text === null || text === undefined ? '' : String(text).trim();
    if (!t) {
      this.left = 0;
      this.opacity.set(0);
      return;
    }
    this.soft = this.game.settings.get('reduceFlash') === true;
    const want = num(seconds, 0) > 0 ? num(seconds, 0) : FLASH_SECONDS;
    this.total = this.soft ? Math.max(want, FLASH_SOFT_SECONDS) : want;
    this.left = this.total;
    this.text.set(t);
    this.opacity.set(this.soft ? 0.001 : 1);
  }

  update(dt: number): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0;
      this.opacity.set(0);
      return;
    }
    if (!this.soft) return;
    const age = this.total - this.left;
    this.opacity.set(Math.max(0.001, Math.min(1, age / FLASH_SOFT_FADE, this.left / FLASH_SOFT_FADE)));
  }
}
