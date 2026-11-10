/**
 * Status board for the consequence sequence ("BOUNDARY — CLOSED", "RELEASE — WITHHELD"). Rows reveal one by
 * one; calling again with a longer list keeps the rows already on screen and reveals only the new ones.
 */
import { Fader, Txt, clear, h, svg } from '../dom';
import { ICON } from '../theme';

export type BoardTone = 'ok' | 'warn' | 'neutral';
export interface BoardRow {
  label: string;
  value: string;
  tone?: BoardTone;
}

const TONE_ICON: Record<BoardTone, string> = {
  ok: ICON.check,
  warn: '<path d="M8 2.2l6 10.8H2z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  neutral: '<path d="M3.5 8h9" stroke="currentColor" stroke-width="1.6"/>',
};
const ROW_STAGGER = 0.7;

interface RowView {
  el: HTMLElement;
  fader: Fader;
  label: Txt;
  value: Txt;
  shape: SVGSVGElement;
  tone: BoardTone | '';
  delay: number;
}

export class StatusBoard {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly title: Txt;
  private readonly titleEl: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly rows: RowView[] = [];
  private active = 0;

  constructor() {
    this.titleEl = h('div', 'aur-board-title aur-label');
    this.rowsEl = h('div', 'aur-board-rows');
    this.el = h('div', 'aur-board', h('div', 'aur-board-head', this.titleEl, h('div', 'aur-rule')), this.rowsEl, h('div', 'aur-rule'));
    this.title = new Txt(this.titleEl);
    this.fader = new Fader(this.el, { in: 0.6, out: 0.7 });
  }

  set(rows: BoardRow[] | null, options?: { title?: string } | null): void {
    const opts = options ?? {};
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      this.fader.show(false);
      this.active = 0;
      return;
    }
    const wasOn = this.fader.on;
    if (!wasOn) {
      // fresh board: every row is revealed again
      clear(this.rowsEl);
      this.rows.length = 0;
      this.active = 0;
    }
    const title = String(opts.title ?? '').trim();
    this.title.set(title);
    this.titleEl.style.display = title ? '' : 'none';
    let queue = 0;
    for (const r of this.rows) if (r.delay > 0) queue = Math.max(queue, r.delay);
    for (let i = 0; i < rows.length; i++) {
      const spec = rows[i] as BoardRow;
      const view = this.rows[i] ?? this.createRow();
      const tone: BoardTone = spec.tone === 'ok' || spec.tone === 'warn' ? spec.tone : 'neutral';
      if (tone !== view.tone) {
        view.tone = tone;
        view.el.dataset.tone = tone;
        view.shape.innerHTML = TONE_ICON[tone];
      }
      view.label.set(String(spec.label ?? ''));
      view.value.set(String(spec.value ?? ''));
      if (i >= this.active) {
        queue += i === 0 && !wasOn ? 0.45 : ROW_STAGGER;
        view.delay = queue;
      }
    }
    while (this.rows.length > rows.length) this.rows.pop()?.el.remove();
    this.active = rows.length;
    this.fader.show(true);
  }

  private createRow(): RowView {
    const label = h('span', 'aur-board-label');
    const value = h('span', 'aur-board-value');
    const shape = svg('0 0 16 16', 'aur-ico', '');
    const el = h('div', 'aur-board-row', label, h('i', 'aur-board-lead'), value, shape as unknown as HTMLElement);
    this.rowsEl.appendChild(el);
    const view: RowView = { el, fader: new Fader(el, { in: 0.55, out: 0.3, display: 'flex', keepLayout: true }), label: new Txt(label), value: new Txt(value), shape, tone: '', delay: 0 };
    this.rows.push(view);
    return view;
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    for (const r of this.rows) {
      if (r.delay > 0) {
        r.delay -= dt;
        if (r.delay <= 0) r.fader.show(true);
      }
      r.fader.update(dt);
    }
  }
}
