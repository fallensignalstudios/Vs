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

  update(dt: number): void {
    this.fader.update(dt);
  }
}

// ---------------------------------------------------------------------------------------------- card
export type CardStyle = 'context' | 'witness' | 'consequence' | 'title';
const CARD_STYLES: readonly CardStyle[] = ['context', 'witness', 'consequence', 'title'];

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

  set(text: string | null, opts: { sub?: string; seconds?: number; style?: CardStyle } = {}): void {
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

  private present(spec: CardSpec): void {
    this.current = spec;
    this.pending = null;
    this.el.dataset.style = spec.style;
    this.text.set(spec.text);
    this.sub.set(spec.sub);
    this.subEl.style.display = spec.sub ? '' : 'none';
    this.life = spec.seconds > 0 ? spec.seconds : Infinity;
    this.fader.show(true);
  }

  update(dt: number): void {
    if (this.current && this.life !== Infinity) {
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
