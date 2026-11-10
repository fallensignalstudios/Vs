/**
 * Full-screen overlays without menus of their own: loading (concept art, title, thin progress line), death
 * (single "return to checkpoint" action) and the mission-complete summary.
 */
import type { Game, MissionSummary } from '@/core/api';
import { isStub } from '@/core/stub';
import { Fader, Flag, Num, Txt, clear, h } from '../dom';
import { clamp01 } from '../logic';
import { FocusList, type Layer, type MenuInput, type MenuKeys, type ModalStack } from '../menu';
import { ART, glyphText, isGamepad, keycap, setKeycap, type ArtId } from '../theme';
import { ArtBackdrop } from './common';

// ---------------------------------------------------------------------------------------------- loading
export interface LoadingOpts {
  title?: string;
  subtitle?: string;
  art?: ArtId;
  progress?: number;
}

export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly bg: ArtBackdrop;
  private readonly code: Txt;
  private readonly codeEl: HTMLElement;
  private readonly title: Txt;
  private readonly sub: Txt;
  private readonly subEl: HTMLElement;
  private readonly bar: Num;
  private readonly barEl: HTMLElement;
  private readonly indeterminate: Flag;
  private progress = -1;
  private shownProgress = 0;
  private sweep = 0;

  constructor() {
    this.bg = new ArtBackdrop('aur-loading-bg');
    this.bg.set('wound-overlook');
    this.codeEl = h('div', 'aur-loading-code aur-label');
    const title = h('div', 'aur-loading-title aur-title');
    this.subEl = h('div', 'aur-loading-sub');
    this.barEl = h('i');
    const track = h('div', 'aur-loading-bar', this.barEl);
    this.el = h('div', 'aur-layer aur-loading',
      this.bg.el,
      h('div', 'aur-loading-grad'),
      h('div', 'aur-loading-col', this.codeEl, title, h('div', 'aur-rule-l'), this.subEl),
      h('div', 'aur-loading-foot', h('span', 'aur-label', 'Aurelion · Contrary Witness'), h('span', 'aur-label aur-loading-tag', 'Loading')),
      track,
    );
    this.code = new Txt(this.codeEl);
    this.title = new Txt(title);
    this.sub = new Txt(this.subEl);
    this.bar = new Num((v) => { this.barEl.style.transform = `scaleX(${v.toFixed(4)})`; }, 0.0008);
    this.indeterminate = new Flag(track, 'is-indeterminate');
    this.fader = new Fader(this.el, { in: 0.35, out: 0.6 });
  }

  get shown(): boolean {
    return this.fader.on;
  }

  get covering(): boolean {
    return this.fader.visible;
  }

  set(show: boolean, opts: LoadingOpts = {}): void {
    if (!show) {
      this.fader.show(false);
      return;
    }
    if (!this.fader.on) {
      this.shownProgress = 0;
      this.progress = -1;
    }
    if (opts.art !== undefined) {
      if ((ART as readonly string[]).includes(opts.art)) this.bg.set(opts.art);
    }
    if (opts.title !== undefined) {
      // "Z04 · Relay Overlook" → code + name
      const raw = String(opts.title).trim();
      const parts = raw.split(/\s*[·•|]\s*/);
      const hasCode = parts.length > 1 && (parts[0] as string).length <= 8;
      this.code.set(hasCode ? (parts[0] as string) : '');
      this.codeEl.style.display = hasCode ? '' : 'none';
      this.title.set(hasCode ? parts.slice(1).join(' · ') : raw);
    }
    if (opts.subtitle !== undefined) {
      const sub = String(opts.subtitle).trim();
      this.sub.set(sub);
      this.subEl.style.display = sub ? '' : 'none';
    }
    if (typeof opts.progress === 'number' && Number.isFinite(opts.progress)) this.progress = clamp01(opts.progress);
    this.fader.show(true);
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    this.bg.update(dt);
    if (this.progress < 0) {
      // no progress reported: a quiet travelling segment
      this.indeterminate.set(true);
      this.sweep = (this.sweep + dt * 0.55) % 1;
      this.barEl.style.transform = `translateX(${(this.sweep * 140 - 30).toFixed(2)}%) scaleX(0.22)`;
    } else {
      // leaving the indeterminate sweep: the cached bar value no longer matches the DOM
      if (this.indeterminate.set(false)) this.bar.invalidate();
      this.shownProgress += (this.progress - this.shownProgress) * Math.min(1, dt * 7);
      if (this.progress >= 1 && this.shownProgress > 0.995) this.shownProgress = 1;
      this.bar.set(this.shownProgress);
    }
  }
}

// ---------------------------------------------------------------------------------------------- death
const DEATH_ID = 'death';
const DEATH_INPUT_DELAY = 0.9;

export class DeathScreen implements Layer {
  readonly id = DEATH_ID;
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly who: Txt;
  private readonly key: HTMLElement;
  private readonly btn: HTMLElement;
  private readonly list: FocusList;
  private readonly ready: Flag;
  private onRetry: (() => void) | null = null;
  private age = 0;

  constructor(private readonly game: Game, menu: MenuInput, private readonly stack: ModalStack) {
    const who = h('div', 'aur-death-who aur-label');
    this.key = keycap('', 'is-sm');
    this.btn = h('div', 'aur-btn aur-btn-primary', this.key, h('span', null, 'Return to checkpoint'));
    this.el = h('div', 'aur-layer aur-death aur-interactive',
      h('div', 'aur-death-veil'),
      h('div', 'aur-death-col',
        who,
        h('div', 'aur-death-title aur-title', 'Fallen'),
        h('div', 'aur-death-orn', h('i'), h('b'), h('i')),
        h('div', 'aur-death-line', 'The record resumes from the last checkpoint.'),
        this.btn,
      ),
    );
    this.who = new Txt(who);
    this.ready = new Flag(this.el, 'is-ready');
    this.list = new FocusList(game, menu, 'h');
    this.list.add({ el: this.btn, onConfirm: () => this.retry() });
    this.fader = new Fader(this.el, { in: 1.4, out: 0.5 });
  }

  get shown(): boolean {
    return this.fader.on;
  }

  show(opts: { onRetry(): void }): void {
    this.onRetry = opts?.onRetry ?? null;
    this.age = 0;
    this.ready.set(false);
    let name = '';
    if (!isStub(this.game.player)) {
      try {
        const s = this.game.player.getHudState();
        if (s && typeof s.name === 'string') name = s.name;
      } catch {
        name = '';
      }
    }
    this.who.set(name);
    this.list.active = false;
    this.list.focus(0);
    const g = glyphText(this.game, 'confirm');
    setKeycap(this.key, g, isGamepad(this.game) && g.length === 1);
    this.fader.show(true);
    this.stack.push(this);
  }

  hide(): void {
    this.onRetry = null;
    this.fader.show(false);
    this.stack.remove(DEATH_ID);
  }

  private retry(): void {
    if (this.age < DEATH_INPUT_DELAY) return;
    const cb = this.onRetry;
    this.onRetry = null;
    cb?.();
  }

  handle(k: MenuKeys): void {
    // combat inputs that were already down must not skip the screen
    if (this.age < DEATH_INPUT_DELAY) return;
    this.list.handle(k);
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    if (!this.fader.on) return;
    this.age += dt;
    if (this.age >= DEATH_INPUT_DELAY) {
      this.list.active = true;
      this.ready.set(true);
    }
  }
}

// ---------------------------------------------------------------------------------------------- complete
const COMPLETE_ID = 'complete';

interface SummaryRow {
  fader: Fader;
  delay: number;
}

export class CompleteScreen implements Layer {
  readonly id = COMPLETE_ID;
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly bg: ArtBackdrop;
  private readonly rowsEl: HTMLElement;
  private readonly key: HTMLElement;
  private readonly btn: HTMLElement;
  private readonly btnFader: Fader;
  private readonly list: FocusList;
  private rows: SummaryRow[] = [];
  private onTitle: (() => void) | null = null;
  private btnDelay = 0;

  constructor(private readonly game: Game, menu: MenuInput, private readonly stack: ModalStack) {
    this.bg = new ArtBackdrop('aur-complete-bg');
    this.bg.set('crownmark-chamber');
    this.rowsEl = h('div', 'aur-complete-rows');
    this.key = keycap('', 'is-sm');
    this.btn = h('div', 'aur-btn aur-btn-primary', this.key, h('span', null, 'Return to title'));
    this.el = h('div', 'aur-layer aur-complete aur-interactive',
      this.bg.el,
      h('div', 'aur-complete-grad'),
      h('div', 'aur-complete-col',
        h('div', 'aur-complete-series aur-label', 'Sovereign Call', h('i'), 'Origins', h('i'), 'Aurelion'),
        h('div', 'aur-complete-title aur-title', 'Contrary Witness'),
        h('div', 'aur-complete-orn', h('i'), h('b'), h('i')),
        h('div', 'aur-complete-tag aur-label', 'Mission complete'),
        this.rowsEl,
        this.btn,
      ),
    );
    this.list = new FocusList(game, menu, 'h');
    this.list.add({ el: this.btn, onConfirm: () => { const cb = this.onTitle; this.hide(); cb?.(); } });
    this.btnFader = new Fader(this.btn, { in: 0.5, out: 0.2, display: 'inline-flex', keepLayout: true });
    this.fader = new Fader(this.el, { in: 1.6, out: 0.6 });
  }

  get shown(): boolean {
    return this.fader.on;
  }

  get covering(): boolean {
    return this.fader.visible;
  }

  show(summary: MissionSummary, opts: { onTitle(): void }): void {
    this.onTitle = opts?.onTitle ?? null;
    clear(this.rowsEl);
    this.rows = [];
    const lines = Array.isArray(summary?.lines) ? summary.lines : [];
    let delay = 1.6;
    for (const line of lines) {
      const el = h('div', 'aur-complete-row',
        h('span', 'aur-complete-label aur-label', String(line?.label ?? '')),
        h('i', 'aur-complete-lead'),
        h('span', 'aur-complete-value', String(line?.value ?? '')),
      );
      this.rowsEl.appendChild(el);
      this.rows.push({ fader: new Fader(el, { in: 0.6, out: 0.2, display: 'flex', keepLayout: true }), delay });
      delay += 0.42;
    }
    this.btnDelay = delay + 0.5;
    this.btnFader.show(false, true);
    this.list.active = false;
    this.list.focus(0);
    const g = glyphText(this.game, 'confirm');
    setKeycap(this.key, g, isGamepad(this.game) && g.length === 1);
    this.fader.show(true);
    this.stack.push(this);
  }

  hide(): void {
    this.onTitle = null;
    this.fader.show(false);
    this.stack.remove(COMPLETE_ID);
  }

  handle(k: MenuKeys): void {
    if (this.list.active) {
      this.list.handle(k);
      return;
    }
    // any confirm fast-forwards the reveal
    if (k.confirm) {
      for (const r of this.rows) r.delay = Math.min(r.delay, 0.01);
      this.btnDelay = Math.min(this.btnDelay, 0.3);
    }
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    this.bg.update(dt);
    for (const r of this.rows) {
      if (r.delay > 0) {
        r.delay -= dt;
        if (r.delay <= 0) r.fader.show(true);
      }
      r.fader.update(dt);
    }
    if (this.btnDelay > 0 && this.fader.on) {
      this.btnDelay -= dt;
      if (this.btnDelay <= 0) {
        this.btnFader.show(true);
        this.list.active = true;
      }
    }
    this.btnFader.update(dt);
  }
}
