/**
 * Building blocks shared by the full-screen menus: drifting concept-art backdrop, the vertical menu column
 * with visible focus, and the key-hint footer.
 */
import type { ButtonAction, Game } from '@/core/api';
import { clear, h, reducedMotion } from '../dom';
import { FocusList, type MenuInput, type MenuKeys } from '../menu';
import { artUrl, glyphText, isGamepad, keycap, setKeycap, type ArtId } from '../theme';

/** Full-bleed concept painting with a slow drift. */
export class ArtBackdrop {
  readonly el: HTMLElement;
  private readonly img: HTMLElement;
  private art: ArtId | '' = '';
  private t = 0;
  private last = '';

  constructor(cls = '') {
    this.img = h('div', 'aur-bg-img');
    this.el = h('div', `aur-bg ${cls}`.trim(), this.img);
  }

  set(art: ArtId): void {
    if (art === this.art) return;
    this.art = art;
    this.img.style.backgroundImage = `url("${artUrl(art)}")`;
    this.el.dataset.art = art;
  }

  update(dt: number): void {
    if (reducedMotion()) {
      if (this.last !== 'static') {
        this.last = 'static';
        this.img.style.transform = 'scale(1.04)';
      }
      return;
    }
    this.t += dt;
    const s = 1.075 + 0.025 * Math.sin(this.t * 0.045);
    const x = Math.sin(this.t * 0.06) * 1.3;
    const y = Math.cos(this.t * 0.043) * 0.7;
    const tr = `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0) scale(${s.toFixed(4)})`;
    if (tr !== this.last) {
      this.last = tr;
      this.img.style.transform = tr;
    }
  }
}

export interface MenuEntry {
  label: string;
  /** one-line description under the label */
  desc?: string;
  onSelect(): void;
  disabled?: boolean;
  /** small right-aligned annotation ("Current") */
  note?: string;
}

/** Vertical list of text entries; the focused one carries a gold diamond and an extending rule. */
export class MenuColumn {
  readonly el: HTMLElement;
  readonly list: FocusList;
  private readonly head: HTMLElement;
  private readonly items: HTMLElement;
  private readonly foot: HTMLElement;

  constructor(game: Game, menu: MenuInput, cls = '') {
    this.head = h('div', 'aur-menu-head');
    this.items = h('div', 'aur-menu-items');
    this.foot = h('div', 'aur-menu-note');
    this.el = h('div', `aur-menu ${cls}`.trim(), this.head, this.items, this.foot);
    this.list = new FocusList(game, menu, 'v');
  }

  setEntries(entries: MenuEntry[], opts: { header?: string; lead?: string; note?: string; focus?: number } = {}): void {
    clear(this.head);
    clear(this.items);
    this.list.clear();
    if (opts.header) {
      this.head.appendChild(h('div', 'aur-menu-title aur-label', opts.header));
      if (opts.lead) this.head.appendChild(h('div', 'aur-menu-lead', opts.lead));
    }
    this.head.style.display = opts.header ? '' : 'none';
    this.foot.textContent = opts.note ?? '';
    this.foot.style.display = opts.note ? '' : 'none';
    this.items.classList.toggle('has-desc', entries.some((e) => !!e.desc));
    for (const e of entries) {
      const el = h('div', 'aur-mi',
        h('i', 'aur-mi-mark'),
        h('div', 'aur-mi-body',
          h('div', 'aur-mi-line', h('span', 'aur-mi-label', e.label), e.note ? h('span', 'aur-mi-note aur-label', e.note) : null),
          e.desc ? h('span', 'aur-mi-desc', e.desc) : null,
        ),
        h('i', 'aur-mi-rule'),
      );
      this.items.appendChild(el);
      this.list.add({ el, onConfirm: e.onSelect, disabled: e.disabled });
    }
    const f = opts.focus ?? 0;
    this.list.index = -1;
    if (f >= 0 && f < entries.length && !entries[f]?.disabled) this.list.focus(f);
    else this.list.focusFirst();
  }

  handle(k: MenuKeys): boolean {
    return this.list.handle(k);
  }
}

export interface KeyHint {
  /** action whose glyph to show, or literal key text */
  action?: ButtonAction;
  keys?: string;
  label: string;
}

/** Footer row of key-cap hints; glyphs follow the active device. */
export class KeyHints {
  readonly el: HTMLElement;
  private hints: KeyHint[] = [];
  private caps: Array<HTMLElement | null> = [];
  private acc = 0;

  constructor(private readonly game: Game, cls = '') {
    this.el = h('div', `aur-keyhints ${cls}`.trim());
  }

  set(hints: KeyHint[]): void {
    this.hints = hints;
    this.caps = [];
    clear(this.el);
    for (const hint of hints) {
      const cap = keycap(hint.keys ?? '', 'is-sm');
      this.caps.push(hint.action ? cap : null);
      this.el.appendChild(h('span', 'aur-keyhint aur-label', cap, h('span', null, hint.label)));
    }
    this.refresh();
  }

  refresh(): void {
    const round = isGamepad(this.game);
    for (let i = 0; i < this.hints.length; i++) {
      const cap = this.caps[i];
      const action = (this.hints[i] as KeyHint).action;
      if (!cap || !action) continue;
      const g = glyphText(this.game, action);
      setKeycap(cap, g, round && g.length === 1);
    }
  }

  /** cheap periodic refresh so glyphs follow a device change */
  update(dt: number): void {
    this.acc += dt;
    if (this.acc < 0.4) return;
    this.acc = 0;
    this.refresh();
  }
}
