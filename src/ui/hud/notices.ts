/**
 * Transient HUD notices: toasts (top-right stack), the zone title card and contextual tutorial hints.
 */
import type { Game } from '@/core/api';
import { Fader, Txt, h, svg, warnOnce } from '../dom';
import { clamp01, num } from '../logic';
import { CAPTION_ICON, ICON, MARKER_ICON, isGamepad, keycap, setKeycap } from '../theme';

// ---------------------------------------------------------------------------------------------- toasts
export type ToastKind = 'checkpoint' | 'info' | 'echo' | 'record' | 'warning';

const TOAST_ICON: Record<ToastKind, [string, number]> = {
  checkpoint: [ICON.diamondSolid, 16],
  info: [MARKER_ICON.interact, 24],
  echo: ['<path d="M2 11h2.4V5H2zM6.8 11h2.4V3H6.8zM11.6 11H14V7h-2.4z" fill="currentColor"/>', 16],
  record: ['<rect x="2.7" y="2.7" width="10.6" height="10.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.2 6.2h5.6M5.2 8.6h5.6M5.2 11h3.2" stroke="currentColor" stroke-width="1.1"/>', 16],
  warning: [CAPTION_ICON.alert, 16],
};
const TOAST_LIFE = 3.6;
const TOAST_MAX = 4;

interface Toast {
  el: HTMLElement;
  fader: Fader;
  text: Txt;
  shape: SVGSVGElement;
  kind: ToastKind;
  life: number;
  age: number;
}

export class Toasts {
  readonly el: HTMLElement;
  private readonly pool: Toast[] = [];
  private order = 0;

  constructor(game: Game) {
    this.el = h('div', 'aur-toasts');
    for (let i = 0; i < TOAST_MAX; i++) {
      const text = h('span', 'aur-toast-text');
      const shape = svg('0 0 16 16', 'aur-ico', '');
      const el = h('div', 'aur-toast', shape as unknown as HTMLElement, text);
      this.el.appendChild(el);
      this.pool.push({ el, fader: new Fader(el, { in: 0.3, out: 0.45, display: 'flex' }), text: new Txt(text), shape, kind: 'info', life: 0, age: 99 });
    }
    game.events.on('checkpoint:saved', () => this.push('Checkpoint saved', 'checkpoint'));
  }

  push(text: string, kind: ToastKind = 'info'): void {
    const msg = String(text ?? '').trim();
    if (!msg) return;
    let k: ToastKind = kind;
    if (!(k in TOAST_ICON)) {
      warnOnce(`toast:${String(kind)}`, `unknown toast kind "${String(kind)}" — using 'info'`);
      k = 'info';
    }
    // the same notice arriving twice (event + direct call) refreshes instead of stacking
    for (const t of this.pool) {
      if (t.life <= 0) continue;
      if ((t.kind === k && t.text.value === msg) || (k === 'checkpoint' && t.kind === 'checkpoint' && t.age < 2)) {
        t.life = TOAST_LIFE;
        return;
      }
    }
    let slot = this.pool.find((t) => !t.fader.visible) ?? null;
    if (!slot) {
      slot = this.pool.reduce((a, b) => (a.life <= b.life ? a : b));
      slot.fader.show(false, true);
    }
    slot.kind = k;
    slot.el.dataset.kind = k;
    const [markup, box] = TOAST_ICON[k];
    slot.shape.setAttribute('viewBox', `0 0 ${box} ${box}`);
    slot.shape.innerHTML = markup;
    slot.text.set(msg);
    slot.life = TOAST_LIFE;
    slot.age = 0;
    slot.el.style.order = String(this.order++);
    slot.fader.show(true);
  }

  update(dt: number): void {
    for (const t of this.pool) {
      if (t.life > 0) {
        t.life -= dt;
        t.age += dt;
        if (t.life <= 0) t.fader.show(false);
      }
      t.fader.update(dt);
    }
  }
}

// ---------------------------------------------------------------------------------------------- zone card
export class ZoneCard {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly code: Txt;
  private readonly title: Txt;
  private readonly sub: Txt;
  private readonly rule: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly codeEl: HTMLElement;
  private life = 0;
  private age = 0;
  private lastRule = -1;

  constructor() {
    this.codeEl = h('div', 'aur-zone-code aur-label');
    const title = h('div', 'aur-zone-title aur-title');
    this.subEl = h('div', 'aur-zone-sub');
    this.rule = h('i', 'aur-zone-rule');
    this.el = h('div', 'aur-zonecard', this.codeEl, title, this.rule, this.subEl);
    this.code = new Txt(this.codeEl);
    this.title = new Txt(title);
    this.sub = new Txt(this.subEl);
    this.fader = new Fader(this.el, { in: 0.9, out: 1.1 });
  }

  show(title: string, subtitle?: string): void {
    const raw = String(title ?? '').trim();
    if (!raw) {
      this.fader.show(false);
      return;
    }
    // "Z01 · PRESSURE HALL" → code + name
    const parts = raw.split(/\s*[·•|]\s*|\s+[—–-]\s+/);
    const hasCode = parts.length > 1 && (parts[0] as string).length <= 8;
    this.code.set(hasCode ? (parts[0] as string) : '');
    this.codeEl.style.display = hasCode ? '' : 'none';
    this.title.set(hasCode ? parts.slice(1).join(' · ') : raw);
    const sub = String(subtitle ?? '').trim();
    this.sub.set(sub);
    this.subEl.style.display = sub ? '' : 'none';
    this.life = 4.6;
    this.age = 0;
    this.fader.show(true);
  }

  hide(): void {
    this.life = 0;
    this.fader.show(false);
  }

  update(dt: number): void {
    if (this.life > 0) {
      this.life -= dt;
      this.age += dt;
      if (this.life <= 0) this.fader.show(false);
    }
    if (!this.fader.update(dt)) return;
    const r = Math.round(clamp01((this.age - 0.15) / 1.1) * 100) / 100;
    if (r !== this.lastRule) {
      this.lastRule = r;
      const e = 1 - (1 - r) * (1 - r) * (1 - r);
      this.rule.style.transform = `scaleX(${e.toFixed(3)})`;
    }
  }
}

// ---------------------------------------------------------------------------------------------- hint
export class Hint {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly text: Txt;
  private readonly key: HTMLElement;
  private life = Infinity;

  constructor(private readonly game: Game) {
    const text = h('span', 'aur-hint-text');
    this.key = keycap('', '');
    this.el = h('div', 'aur-hint', this.key, text);
    this.text = new Txt(text);
    this.fader = new Fader(this.el, { in: 0.35, out: 0.35, display: 'flex' });
  }

  set(hint: { text: string; glyph?: string; seconds?: number } | null): void {
    const text = hint ? String(hint.text ?? '').trim() : '';
    if (!hint || !text) {
      this.fader.show(false);
      return;
    }
    this.text.set(text);
    const g = typeof hint.glyph === 'string' ? hint.glyph.trim() : '';
    this.key.style.display = g ? '' : 'none';
    if (g) setKeycap(this.key, g, isGamepad(this.game) && g.length === 1);
    const secs = num(hint.seconds, 0);
    this.life = secs > 0 ? secs : Infinity;
    this.fader.show(true);
  }

  update(dt: number): void {
    if (this.fader.on && this.life !== Infinity) {
      this.life -= dt;
      if (this.life <= 0) this.fader.show(false);
    }
    this.fader.update(dt);
  }
}
