/**
 * Title screen: full-bleed Wound overlook with a slow drift, the title lockup and the main menu
 * (Continue · New Game → difficulty · Settings · Controls).
 */
import type { Difficulty, Game, TitleOpts } from '@/core/api';
import { Fader, h } from '../dom';
import { sfx, type Layer, type MenuInput, type MenuKeys, type ModalStack } from '../menu';
import { ArtBackdrop, KeyHints, MenuColumn, type MenuEntry } from './common';
import { DIFFICULTY_OPTIONS, type SettingsTab } from './settings-data';

const LAYER_ID = 'title';

export class TitleScreen implements Layer {
  readonly id = LAYER_ID;
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly bg: ArtBackdrop;
  private readonly menuCol: MenuColumn;
  private readonly hints: KeyHints;
  private opts: TitleOpts | null = null;
  private sub: 'root' | 'difficulty' = 'root';
  private rootFocus = 0;

  constructor(
    private readonly game: Game,
    menu: MenuInput,
    private readonly stack: ModalStack,
    private readonly openSettings: (tab: SettingsTab, onClose: () => void) => void,
  ) {
    this.bg = new ArtBackdrop('aur-title-bg');
    this.bg.set('wound-overlook');
    this.menuCol = new MenuColumn(game, menu, 'aur-title-menu');
    this.hints = new KeyHints(game, 'aur-title-hints');
    this.hints.set([{ keys: '↑↓', label: 'Navigate' }, { action: 'confirm', label: 'Select' }, { action: 'cancel', label: 'Back' }]);

    this.el = h('div', 'aur-layer aur-titlescreen aur-interactive',
      this.bg.el,
      h('div', 'aur-title-grad'),
      h('div', 'aur-title-col',
        h('div', 'aur-title-series aur-label', 'Sovereign Call', h('i'), 'Origins'),
        h('div', 'aur-title-name aur-title', 'Aurelion'),
        h('div', 'aur-title-orn', h('i'), h('b'), h('i')),
        h('div', 'aur-title-sub aur-title', 'Contrary Witness'),
        this.menuCol.el,
      ),
      this.hints.el,
      h('div', 'aur-title-legal aur-label', 'Vertical slice · Browser build'),
    );
    this.fader = new Fader(this.el, { in: 0.9, out: 0.5 });
  }

  get shown(): boolean {
    return this.fader.on;
  }

  /** still covering the screen (including the fade-out) */
  get covering(): boolean {
    return this.fader.visible;
  }

  show(opts: TitleOpts): void {
    this.opts = opts;
    this.rootFocus = 0;
    this.showRoot();
    this.fader.show(true);
    this.stack.push(this);
  }

  hide(): void {
    this.opts = null;
    this.fader.show(false);
    this.stack.remove(LAYER_ID);
  }

  private showRoot(): void {
    const o = this.opts;
    if (!o) return;
    this.sub = 'root';
    const entries: MenuEntry[] = [];
    if (o.canContinue) entries.push({ label: 'Continue', onSelect: () => this.opts?.onContinue() });
    entries.push({ label: 'New Game', onSelect: () => this.showDifficulty() });
    entries.push({ label: 'Settings', onSelect: () => this.settings('graphics') });
    entries.push({ label: 'Controls', onSelect: () => this.settings('controls') });
    this.menuCol.setEntries(entries, { focus: Math.min(this.rootFocus, entries.length - 1) });
  }

  private showDifficulty(): void {
    const o = this.opts;
    if (!o) return;
    this.rootFocus = this.menuCol.list.index;
    this.sub = 'difficulty';
    const current = this.game.settings.get('difficulty');
    const entries: MenuEntry[] = DIFFICULTY_OPTIONS.map((d) => ({
      label: d.label,
      desc: d.desc,
      onSelect: () => this.opts?.onNewGame(d.value as Difficulty),
    }));
    entries.push({ label: 'Back', onSelect: () => this.showRoot() });
    this.menuCol.setEntries(entries, {
      header: 'New Game',
      lead: 'Choose a difficulty. It can be changed later in Settings.',
      note: o.canContinue ? 'Starting a new game replaces the saved checkpoint.' : undefined,
      focus: Math.max(0, DIFFICULTY_OPTIONS.findIndex((d) => d.value === current)),
    });
  }

  private settings(tab: SettingsTab): void {
    this.rootFocus = this.menuCol.list.index;
    this.el.classList.add('is-under');
    this.openSettings(tab, () => this.el.classList.remove('is-under'));
  }

  handle(k: MenuKeys): void {
    if (!this.opts) return;
    this.menuCol.handle(k);
    if (k.cancel && this.sub === 'difficulty') {
      sfx(this.game, 'uiBack');
      this.showRoot();
    }
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    this.bg.update(dt);
    this.hints.update(dt);
  }
}
