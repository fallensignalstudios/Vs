/**
 * Pause menu: Resume · Restart from checkpoint · Settings · Controls · Quit to title, with explicit
 * confirmation for the two destructive entries and a quiet situation panel (zone, objective).
 */
import type { Game } from '@/core/api';
import { isStub } from '@/core/stub';
import { Fader, Txt, h } from '../dom';
import { sfx, type Layer, type MenuInput, type MenuKeys, type ModalStack } from '../menu';
import { KeyHints, MenuColumn } from './common';
import type { SettingsTab } from './settings-data';

const LAYER_ID = 'pause';

export interface PauseOpts {
  onResume(): void;
  onRestartCheckpoint(): void;
  onQuitToTitle(): void;
}

export class PauseScreen implements Layer {
  readonly id = LAYER_ID;
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly menuCol: MenuColumn;
  private readonly hints: KeyHints;
  private readonly zone: Txt;
  private readonly objective: Txt;
  private readonly objectiveBlock: HTMLElement;
  private readonly zoneBlock: HTMLElement;
  private opts: PauseOpts | null = null;
  private sub: 'root' | 'confirm' = 'root';
  private rootFocus = 0;

  constructor(
    private readonly game: Game,
    menu: MenuInput,
    private readonly stack: ModalStack,
    private readonly openSettings: (tab: SettingsTab, onClose: () => void) => void,
    private readonly currentObjective: () => string | null,
  ) {
    this.menuCol = new MenuColumn(game, menu, 'aur-pause-menu');
    this.hints = new KeyHints(game, 'aur-pause-hints');
    const zone = h('div', 'aur-pause-value aur-title');
    const objective = h('div', 'aur-pause-value');
    this.zoneBlock = h('div', 'aur-pause-block', h('div', 'aur-label', 'Location'), zone);
    this.objectiveBlock = h('div', 'aur-pause-block', h('div', 'aur-label', 'Objective'), objective);
    this.zone = new Txt(zone);
    this.objective = new Txt(objective);

    this.el = h('div', 'aur-layer aur-pause aur-interactive',
      h('div', 'aur-pause-veil'),
      h('div', 'aur-pause-col',
        h('div', 'aur-pause-series aur-label', 'Aurelion', h('i'), 'Contrary Witness'),
        h('div', 'aur-pause-title aur-title', 'Paused'),
        h('div', 'aur-rule-l'),
        this.menuCol.el,
      ),
      h('div', 'aur-pause-info', this.zoneBlock, this.objectiveBlock),
      this.hints.el,
    );
    this.fader = new Fader(this.el, { in: 0.22, out: 0.18, interactive: true });
  }

  get shown(): boolean {
    return this.fader.on;
  }

  show(opts: PauseOpts): void {
    this.opts = opts;
    this.rootFocus = 0;
    this.el.classList.remove('is-under');
    this.refreshInfo();
    this.showRoot();
    this.fader.show(true);
    this.stack.push(this);
  }

  hide(): void {
    this.opts = null;
    this.fader.show(false);
    this.stack.remove(LAYER_ID);
  }

  private refreshInfo(): void {
    let zone = '';
    const mission = this.game.mission;
    if (!isStub(mission)) {
      try {
        const z = mission.currentZone;
        if (z && typeof z.title === 'string') zone = z.title;
      } catch {
        zone = '';
      }
    }
    this.zone.set(zone);
    this.zoneBlock.style.display = zone ? '' : 'none';
    const obj = this.currentObjective() ?? '';
    this.objective.set(obj);
    this.objectiveBlock.style.display = obj ? '' : 'none';
  }

  private setHints(cancelLabel: string): void {
    this.hints.set([{ keys: '↑↓', label: 'Navigate' }, { action: 'confirm', label: 'Select' }, { action: 'cancel', label: cancelLabel }]);
  }

  private showRoot(): void {
    this.sub = 'root';
    this.setHints('Resume');
    this.menuCol.setEntries([
      { label: 'Resume', onSelect: () => this.opts?.onResume() },
      { label: 'Restart from checkpoint', onSelect: () => this.confirm('restart') },
      { label: 'Settings', onSelect: () => this.settings('graphics') },
      { label: 'Controls', onSelect: () => this.settings('controls') },
      { label: 'Quit to title', onSelect: () => this.confirm('quit') },
    ], { focus: this.rootFocus });
  }

  private confirm(what: 'restart' | 'quit'): void {
    this.rootFocus = this.menuCol.list.index;
    this.sub = 'confirm';
    this.setHints('Back');
    const restart = what === 'restart';
    this.menuCol.setEntries([
      { label: 'Cancel', onSelect: () => this.showRoot() },
      {
        label: restart ? 'Restart' : 'Quit',
        onSelect: () => (restart ? this.opts?.onRestartCheckpoint() : this.opts?.onQuitToTitle()),
      },
    ], {
      header: restart ? 'Restart from checkpoint' : 'Quit to title',
      lead: restart
        ? 'Progress since the last checkpoint will be lost.'
        : 'The mission resumes from the last checkpoint when you continue.',
      focus: 0,
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
    if (!k.cancel || !this.opts) return;
    if (this.sub === 'confirm') {
      sfx(this.game, 'uiBack');
      this.showRoot();
    } else {
      sfx(this.game, 'uiBack');
      this.opts.onResume();
    }
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    this.hints.update(dt);
  }
}
