/**
 * Settings screen (shared by the title and pause menus): Graphics, Audio, Controls (+ bindings reference),
 * Gameplay, Accessibility (+ live subtitle preview). Two panes — categories left, options right — navigable
 * with menu actions and the mouse. Every control writes `game.settings` immediately.
 */
import type { Game, Settings } from '@/core/api';
import { Fader, Flag, Txt, clear, h, svg } from '../dom';
import { clamp01, cycle, stepValue } from '../logic';
import { FocusList, sfx, type FocusItem, type Layer, type MenuInput, type MenuKeys, type ModalStack } from '../menu';
import { FACTION_ICON, ICON, glyphText, icon, isGamepad, keycap, setKeycap } from '../theme';
import { KeyHints } from './common';
import { BINDINGS, TABS, type ChoiceRow, type RowDef, type SettingsTab, type SliderRow, type TabDef, type ToggleRow } from './settings-data';

const LAYER_ID = 'settings';

interface RowView {
  def: RowDef;
  el: HTMLElement;
  refresh(): void;
  desc(): string;
}

export class SettingsScreen implements Layer {
  readonly id = LAYER_ID;
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly cats: FocusList;
  private readonly rows: FocusList;
  private readonly catEls: HTMLElement[] = [];
  private readonly pane: HTMLElement;
  private readonly paneTitle: Txt;
  private readonly desc: Txt;
  private readonly hints: KeyHints;
  private readonly previewEl: HTMLElement;
  private readonly previewTalk: HTMLElement;
  private bindingCaps: Array<{ cap: HTMLElement; i: number }> = [];
  private views: RowView[] = [];
  private tab: TabDef = TABS[0] as TabDef;
  private mode: 'cats' | 'rows' = 'cats';
  private onClose: (() => void) | null = null;
  private refreshAcc = 0;

  constructor(private readonly game: Game, private readonly menu: MenuInput, private readonly stack: ModalStack) {
    const catsEl = h('div', 'aur-set-cats');
    this.cats = new FocusList(game, menu, 'v');
    this.cats.hover = false;
    TABS.forEach((tab, i) => {
      const el = h('div', 'aur-set-cat', h('i', 'aur-mi-mark'), h('span', null, tab.label));
      catsEl.appendChild(el);
      this.catEls.push(el);
      this.cats.add({ el, onConfirm: () => { this.selectTab(i); this.enterRows(); } });
    });
    this.cats.onFocus = (i) => { if (this.mode === 'cats') this.selectTab(i); };

    this.rows = new FocusList(game, menu, 'v');
    this.rows.onFocus = (i) => {
      if (this.mode !== 'rows') this.setMode('rows');
      this.showDesc(i);
    };

    const paneTitle = h('div', 'aur-set-panetitle aur-title');
    this.pane = h('div', 'aur-set-rows');
    const desc = h('div', 'aur-set-desc');
    this.paneTitle = new Txt(paneTitle);
    this.desc = new Txt(desc);

    // live subtitle preview (same classes as the real subtitle layer)
    const shape = svg('0 0 16 16', 'aur-ico aur-sub-shape', FACTION_ICON.dominion);
    this.previewTalk = h('div', 'aur-talk',
      h('div', 'aur-sub', h('div', 'aur-sub-who', shape as unknown as HTMLElement, h('span', 'aur-sub-name', 'Lyessa'),
        h('span', 'aur-sub-tag', icon(ICON.radio, 'aur-ico aur-sub-tagico') as unknown as HTMLElement, h('span', 'aur-sub-tagtext', '(radio)'))),
        h('div', 'aur-sub-text', 'Three lanes. They are not guessing.')));
    const previewSub = this.previewTalk.firstChild as HTMLElement;
    previewSub.dataset.faction = 'dominion';
    previewSub.dataset.channel = 'radio';
    previewSub.classList.add('is-off');
    this.previewEl = h('div', 'aur-set-preview', h('span', 'aur-label', 'Preview'), this.previewTalk);

    this.hints = new KeyHints(game, 'aur-set-hints');

    this.el = h('div', 'aur-layer aur-settings aur-interactive',
      h('div', 'aur-set-veil'),
      h('div', 'aur-set-frame',
        h('div', 'aur-set-head', h('span', 'aur-label', 'Aurelion'), h('span', 'aur-set-title aur-title', 'Settings'), h('div', 'aur-rule-l')),
        h('div', 'aur-set-body',
          catsEl,
          h('div', 'aur-set-pane', paneTitle, this.pane, h('div', 'aur-set-foot', desc, this.previewEl)),
        ),
        this.hints.el,
      ),
    );
    this.fader = new Fader(this.el, { in: 0.25, out: 0.2 });

    game.events.on('settings:changed', () => {
      if (!this.fader.visible) return;
      for (const v of this.views) v.refresh();
      this.syncPreview();
    });
  }

  get open(): boolean {
    return this.fader.on;
  }

  show(tab: SettingsTab = 'graphics', onClose: (() => void) | null = null): void {
    this.onClose = onClose;
    const i = Math.max(0, TABS.findIndex((t) => t.id === tab));
    this.mode = 'cats';
    this.cats.active = true;
    this.cats.index = -1;
    this.selectTab(i, true);
    this.cats.focus(i);
    this.setMode('cats');
    this.fader.show(true);
    this.stack.push(this);
  }

  hide(): void {
    if (!this.fader.on) return;
    this.fader.show(false);
    this.stack.remove(LAYER_ID);
  }

  private close(): void {
    sfx(this.game, 'uiBack');
    const cb = this.onClose;
    this.onClose = null;
    this.hide();
    cb?.();
  }

  private setMode(mode: 'cats' | 'rows'): void {
    this.mode = mode;
    this.el.dataset.mode = mode;
    const idx = TABS.indexOf(this.tab);
    this.catEls.forEach((el, i) => el.classList.toggle('is-current', i === idx));
    if (mode === 'cats') {
      this.rows.blur();
      this.cats.focus(idx);
      this.desc.set('');
      this.hints.set([
        { keys: '↑↓', label: 'Category' },
        { action: 'confirm', label: 'Open' },
        { action: 'cancel', label: 'Back' },
      ]);
    } else {
      this.cats.blur();
      this.hints.set([
        { keys: '↑↓', label: 'Option' },
        { keys: '←→', label: 'Adjust' },
        { action: 'cancel', label: 'Categories' },
      ]);
    }
  }

  private enterRows(): void {
    if (this.rows.items.length === 0) return;
    this.setMode('rows');
    this.rows.index = -1;
    this.rows.focusFirst();
  }

  private selectTab(i: number, force = false): void {
    const tab = TABS[i];
    if (!tab || (tab === this.tab && !force && this.views.length > 0)) return;
    this.tab = tab;
    this.paneTitle.set(tab.label);
    clear(this.pane);
    this.rows.clear();
    this.views = [];
    this.bindingCaps = [];
    for (const def of tab.rows) {
      const { view, item } = this.buildRow(def);
      this.views.push(view);
      this.pane.appendChild(view.el);
      this.rows.add(item);
      view.refresh();
    }
    if (tab.bindings) this.pane.appendChild(this.buildBindings());
    this.previewEl.style.display = tab.preview ? '' : 'none';
    this.syncPreview();
    this.catEls.forEach((el, k) => el.classList.toggle('is-current', k === i));
    this.el.dataset.tab = tab.id;
  }

  private showDesc(i: number): void {
    const v = this.views[i];
    this.desc.set(v ? v.desc() : '');
  }

  private syncPreview(): void {
    const s = this.game.settings;
    const size = s.get('subtitleSize');
    this.previewTalk.dataset.size = size === 'l' || size === 'xl' ? size : 'm';
    this.previewTalk.classList.toggle('is-plate', s.get('subtitleBackground') !== false);
    this.previewTalk.classList.toggle('is-muted', s.get('subtitles') === false);
  }

  private commit<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.game.settings.set(key, value);
    if (key === 'masterVolume' || key === 'musicVolume' || key === 'sfxVolume') {
      try {
        this.game.audio.applySettings();
      } catch {
        /* stub audio */
      }
    }
    const i = this.rows.index;
    if (this.mode === 'rows' && i >= 0) this.showDesc(i);
  }

  // ------------------------------------------------------------------------------------------ rows
  private buildRow(def: RowDef): { view: RowView; item: FocusItem } {
    switch (def.kind) {
      case 'toggle': return this.buildToggle(def);
      case 'choice': return this.buildChoice(def);
      case 'slider': return this.buildSlider(def);
      default: return this.buildAction(def);
    }
  }

  private rowShell(def: RowDef, ctl: HTMLElement): HTMLElement {
    const el = h('div', 'aur-row', h('i', 'aur-row-mark'), h('span', 'aur-row-label', def.label), ctl);
    el.dataset.kind = def.kind;
    return el;
  }

  private buildToggle(def: ToggleRow): { view: RowView; item: FocusItem } {
    const state = h('span', 'aur-toggle-state aur-label');
    const ctl = h('div', 'aur-toggle', state, h('i', 'aur-toggle-track', h('b')));
    const el = this.rowShell(def, ctl);
    const on = new Flag(ctl, 'is-on');
    const txt = new Txt(state);
    const s = this.game.settings;
    const flip = (): void => this.commit(def.key, !(s.get(def.key) === true));
    return {
      view: {
        def, el,
        refresh: () => { const v = s.get(def.key) === true; on.set(v); txt.set(v ? 'On' : 'Off'); },
        desc: () => def.desc,
      },
      item: { el, onConfirm: flip, onAdjust: (dir) => { if ((dir > 0) !== (s.get(def.key) === true)) { sfx(this.game, 'uiMove'); flip(); } } },
    };
  }

  private buildChoice(def: ChoiceRow): { view: RowView; item: FocusItem } {
    const s = this.game.settings;
    const values = def.options.map((o) => o.value);
    const set = (value: string): void => this.commit(def.key, value as never);
    const opts = def.options.map((o) => {
      const optEl = h('span', 'aur-seg-opt', o.label);
      optEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.menu.noteClick();
        sfx(this.game, 'uiSelect');
        set(o.value);
      });
      return { el: optEl, cur: new Flag(optEl, 'is-cur') };
    });
    const ctl = h('div', 'aur-seg', h('i', 'aur-seg-arrow l'), ...opts.map((o) => o.el), h('i', 'aur-seg-arrow r'));
    const el = this.rowShell(def, ctl);
    const step = (dir: number): void => {
      sfx(this.game, 'uiMove');
      set(cycle(values, String(s.get(def.key)), dir));
    };
    return {
      view: {
        def, el,
        refresh: () => { const v = String(s.get(def.key)); opts.forEach((o, i) => o.cur.set(values[i] === v)); },
        desc: () => {
          const cur = def.options.find((o) => o.value === String(s.get(def.key)));
          return cur?.desc ? `${def.desc}  ${cur.label} — ${cur.desc}` : def.desc;
        },
      },
      item: { el, onConfirm: () => step(1), onAdjust: (dir) => step(dir) },
    };
  }

  private buildSlider(def: SliderRow): { view: RowView; item: FocusItem } {
    const s = this.game.settings;
    const fill = h('i', 'aur-slider-fill');
    const thumb = h('b', 'aur-slider-thumb');
    const track = h('div', 'aur-slider-track', fill, thumb);
    const val = h('span', 'aur-slider-val aur-num');
    const ctl = h('div', 'aur-slider', track, val);
    const el = this.rowShell(def, ctl);
    const txt = new Txt(val);
    const fmt = (v: number): string => (def.format === 'percent' ? `${Math.round(v * 100)}` : `${v.toFixed(1)}×`);
    const fromPointer = (e: PointerEvent): void => {
      const r = track.getBoundingClientRect();
      if (r.width <= 0) return;
      const t = clamp01((e.clientX - r.left) / r.width);
      const raw = def.min + t * (def.max - def.min);
      this.commit(def.key, stepValue(raw, 0, def.step, def.min, def.max));
    };
    let dragging = false;
    track.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { track.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      fromPointer(e);
    });
    track.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
    const stop = (): void => { dragging = false; };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);
    track.addEventListener('click', (e) => { e.stopPropagation(); this.menu.noteClick(); });
    return {
      view: {
        def, el,
        refresh: () => {
          const v = Number(s.get(def.key));
          const t = clamp01((v - def.min) / (def.max - def.min));
          fill.style.transform = `scaleX(${t.toFixed(4)})`;
          thumb.style.left = `${(t * 100).toFixed(2)}%`;
          txt.set(fmt(v));
        },
        desc: () => def.desc,
      },
      item: {
        el,
        onAdjust: (dir) => {
          const next = stepValue(Number(s.get(def.key)), dir, def.step, def.min, def.max);
          if (next !== s.get(def.key)) sfx(this.game, 'uiMove');
          this.commit(def.key, next);
        },
      },
    };
  }

  private buildAction(def: RowDef): { view: RowView; item: FocusItem } {
    const ctl = h('div', 'aur-row-action aur-label', 'Confirm');
    const el = this.rowShell(def, ctl);
    return {
      view: { def, el, refresh: () => undefined, desc: () => def.desc },
      item: { el, onConfirm: () => { this.game.settings.reset(); try { this.game.audio.applySettings(); } catch { /* stub */ } } },
    };
  }

  private buildBindings(): HTMLElement {
    const grid = h('div', 'aur-binds');
    BINDINGS.forEach((b, i) => {
      const cap = keycap('', 'is-sm');
      this.bindingCaps.push({ cap, i });
      grid.appendChild(h('div', 'aur-bind', h('span', 'aur-bind-key', cap), h('span', 'aur-bind-label', b.label)));
    });
    this.refreshBindings();
    return h('div', 'aur-binds-wrap', h('div', 'aur-binds-title aur-label', 'Bindings reference'), grid);
  }

  private refreshBindings(): void {
    const pad = isGamepad(this.game);
    for (const { cap, i } of this.bindingCaps) {
      const b = BINDINGS[i];
      if (!b) continue;
      const g = b.action ? glyphText(this.game, b.action) : pad ? (b.pad ?? '') : (b.kbm ?? '');
      setKeycap(cap, g, pad && g.length === 1);
    }
  }

  // ------------------------------------------------------------------------------------------ input
  handle(k: MenuKeys): void {
    if (this.mode === 'cats') {
      this.cats.handle(k);
      if (k.right && this.mode === 'cats') {
        sfx(this.game, 'uiSelect');
        this.enterRows();
      } else if (k.cancel) {
        this.close();
      }
    } else {
      this.rows.handle(k);
      if (k.cancel) {
        sfx(this.game, 'uiBack');
        this.setMode('cats');
      }
    }
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    this.hints.update(dt);
    this.refreshAcc += dt;
    if (this.refreshAcc > 0.4) {
      this.refreshAcc = 0;
      if (this.bindingCaps.length) this.refreshBindings();
    }
  }
}
