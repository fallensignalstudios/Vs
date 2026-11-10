/**
 * The Z07 local decision. Two large option cards (tag + label + detail); the player SELECTS a card, then
 * explicitly COMMITS it. Untimed; the panel pauses nothing itself. `modalOpen` is true until the commit.
 */
import type { ChoiceHandle, ChoiceOption, ChoiceOpts, Game } from '@/core/api';
import { Fader, Flag, Num, Txt, clear, h, warnOnce } from '../dom';
import { FocusList, sfx, type Layer, type MenuInput, type MenuKeys, type ModalStack } from '../menu';
import { ICON, glyphText, icon, isGamepad, keycap, setKeycap } from '../theme';

const ARM_DELAY = 0.4;
/** the press that opened the panel (E / Space are also `confirm`) must not select a card */
const OPEN_DELAY = 0.45;
const LAYER_ID = 'choice';

interface CardView {
  option: ChoiceOption;
  el: HTMLElement;
  chosen: Flag;
  dimmed: Flag;
}

class Handle implements ChoiceHandle {
  selected: string | null = null;
  constructor(private readonly commit: (id: string) => void) {}
  select(id: string): void {
    this.commit(id);
  }
}

export class ChoicePanel implements Layer {
  readonly id = LAYER_ID;
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly title: Txt;
  private readonly prompt: Txt;
  private readonly note: Txt;
  private readonly noteEl: HTMLElement;
  private readonly cardsEl: HTMLElement;
  private readonly commitEl: HTMLElement;
  private readonly commitLine: Txt;
  private readonly commitBtn: HTMLElement;
  private readonly backBtn: HTMLElement;
  private readonly commitKey: HTMLElement;
  private readonly backKey: HTMLElement;
  private readonly selectKey: HTMLElement;
  private readonly browseHint: HTMLElement;
  private readonly armFill: Num;
  private readonly commitVis: Num;
  private readonly done: Flag;

  private readonly cards: FocusList;
  private readonly confirm: FocusList;
  private views: CardView[] = [];
  private ticket: Handle | null = null;
  private armed: CardView | null = null;
  private armT = 0;
  private age = 0;
  private commitLevel = 0;
  private closing = 0;

  constructor(private readonly game: Game, private readonly menu: MenuInput, private readonly stack: ModalStack) {
    const title = h('div', 'aur-choice-title aur-label');
    const prompt = h('div', 'aur-choice-prompt');
    this.noteEl = h('div', 'aur-choice-note');
    this.cardsEl = h('div', 'aur-choice-cards');

    const commitLine = h('div', 'aur-choice-commitline');
    this.commitKey = keycap('', 'is-sm');
    this.backKey = keycap('', 'is-sm');
    this.selectKey = keycap('', 'is-sm');
    const armBar = h('i', 'aur-btn-arm');
    this.commitBtn = h('div', 'aur-btn aur-btn-primary', armBar, this.commitKey, h('span', null, 'Commit'));
    this.backBtn = h('div', 'aur-btn', this.backKey, h('span', null, 'Reconsider'));
    this.commitEl = h('div', 'aur-choice-commit', commitLine, h('div', 'aur-choice-actions', this.commitBtn, this.backBtn));
    this.browseHint = h('div', 'aur-choice-browse aur-label', this.selectKey, h('span', null, 'Select'), h('i', 'sep'), h('span', null, 'Nothing is committed until you confirm'));

    this.el = h('div', 'aur-layer aur-choice aur-interactive',
      h('div', 'aur-choice-veil'),
      h('div', 'aur-choice-inner',
        h('div', 'aur-choice-head', title, h('div', 'aur-choice-orn', h('i'), h('b'), h('i')), prompt),
        this.cardsEl,
        h('div', 'aur-choice-foot', this.browseHint, this.commitEl),
        this.noteEl,
      ),
    );
    this.title = new Txt(title);
    this.prompt = new Txt(prompt);
    this.note = new Txt(this.noteEl);
    this.commitLine = new Txt(commitLine);
    this.armFill = new Num((v) => { armBar.style.transform = `scaleX(${v.toFixed(3)})`; }, 0.004);
    this.commitVis = new Num((v) => {
      this.commitEl.style.opacity = v.toFixed(2);
      this.commitEl.style.visibility = v <= 0.01 ? 'hidden' : 'visible';
      this.commitEl.style.setProperty('--k', (1 - v).toFixed(2));
      this.browseHint.style.opacity = (1 - v).toFixed(2);
    }, 0.01);
    this.done = new Flag(this.el, 'is-done');
    this.fader = new Fader(this.el, { in: 0.7, out: 0.7, interactive: true });

    this.cards = new FocusList(game, menu, 'h');
    this.confirm = new FocusList(game, menu, 'h');
    this.confirm.add({ el: this.commitBtn, onConfirm: () => this.tryCommit() });
    this.confirm.add({ el: this.backBtn, onConfirm: () => this.disarm() });
    this.confirm.active = false;
  }

  get open(): boolean {
    return this.ticket !== null && this.ticket.selected === null;
  }

  present(opts: ChoiceOpts): ChoiceHandle {
    // a previous unanswered choice is abandoned (its handle stays null)
    const options = Array.isArray(opts?.options) ? opts.options.filter((o) => o && typeof o.id === 'string') : [];
    const handle = new Handle((id) => this.commit(id));
    this.ticket = handle;
    this.armed = null;
    this.armT = 0;
    this.age = 0;
    this.commitLevel = 0;
    this.closing = 0;
    this.done.set(false);
    this.commitVis.set(0);
    this.title.set(String(opts?.title ?? 'Decision'));
    this.prompt.set(String(opts?.prompt ?? ''));
    const note = String(opts?.note ?? '').trim();
    this.note.set(note);
    this.noteEl.style.display = note ? '' : 'none';

    clear(this.cardsEl);
    this.cards.clear();
    this.views = [];
    this.cardsEl.dataset.count = String(Math.min(3, Math.max(1, options.length)));
    options.forEach((option, i) => {
      const tagShape = icon(i % 2 === 0 ? ICON.diamondSolid : ICON.diamond, 'aur-ico');
      const el = h('div', 'aur-cc',
        h('div', 'aur-cc-tag aur-label', tagShape as unknown as HTMLElement, String(option.tag ?? `Option ${i + 1}`)),
        h('div', 'aur-cc-label aur-title', String(option.label ?? option.id)),
        h('i', 'aur-cc-rule'),
        h('div', 'aur-cc-detail', String(option.detail ?? '')),
        h('div', 'aur-cc-state aur-label', icon(ICON.check) as unknown as HTMLElement, 'Selected'),
        h('i', 'aur-cc-corner tl'), h('i', 'aur-cc-corner br'),
      );
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', 'false');
      this.cardsEl.appendChild(el);
      const view: CardView = { option, el, chosen: new Flag(el, 'is-chosen'), dimmed: new Flag(el, 'is-dimmed') };
      this.views.push(view);
      this.cards.add({ el, onConfirm: () => this.arm(view) });
      // with the mouse, clicking the other card while one is selected simply moves the selection
      el.addEventListener('click', () => {
        if (!this.open || !this.armed || this.armed === view) return;
        this.menu.noteClick();
        this.arm(view);
      });
    });
    if (options.length === 0) {
      warnOnce('choice:empty', `choice "${String(opts?.id)}" has no options — nothing to decide`);
      this.ticket = null;
      return handle;
    }
    this.cards.active = false;
    this.confirm.active = false;
    this.confirm.blur();
    this.cards.index = -1;
    this.cards.focus(0);
    this.refreshKeys();
    this.el.style.pointerEvents = '';
    this.fader.show(true);
    this.stack.push(this);
    sfx(this.game, 'uiChoice');
    return handle;
  }

  private refreshKeys(): void {
    const round = isGamepad(this.game);
    const c = glyphText(this.game, 'confirm');
    const b = glyphText(this.game, 'cancel');
    setKeycap(this.commitKey, c, round && c.length === 1);
    setKeycap(this.selectKey, c, round && c.length === 1);
    setKeycap(this.backKey, b, round && b.length === 1);
  }

  private arm(view: CardView): void {
    if (!this.open) return;
    this.armed = view;
    this.armT = 0;
    for (const v of this.views) {
      v.chosen.set(v === view);
      v.dimmed.set(v !== view);
      v.el.setAttribute('aria-pressed', v === view ? 'true' : 'false');
    }
    const tag = String(view.option.tag ?? '').trim();
    this.commitLine.set(`${tag ? `${tag} — ` : ''}${String(view.option.label ?? view.option.id)}`);
    this.cards.active = false;
    this.confirm.active = true;
    this.confirm.focus(0);
    sfx(this.game, 'uiChoice');
  }

  private disarm(): void {
    if (!this.armed) return;
    const i = this.views.indexOf(this.armed);
    this.armed = null;
    for (const v of this.views) {
      v.chosen.set(false);
      v.dimmed.set(false);
      v.el.setAttribute('aria-pressed', 'false');
    }
    this.confirm.active = false;
    this.confirm.blur();
    this.cards.active = true;
    this.cards.focus(Math.max(0, i));
    sfx(this.game, 'uiBack');
  }

  private tryCommit(): void {
    // a short arming delay so one over-eager double press cannot commit
    if (!this.armed || this.armT < ARM_DELAY) return;
    this.commit(this.armed.option.id);
  }

  /** commit from the panel or programmatically (autoplay) */
  private commit(id: string): void {
    const handle = this.ticket;
    if (!handle || handle.selected !== null) return;
    const view = this.views.find((v) => v.option.id === id);
    if (!view) {
      warnOnce(`choice:${id}`, `choice option "${id}" does not exist — ignored`);
      return;
    }
    handle.selected = id;
    for (const v of this.views) {
      v.chosen.set(v === view);
      v.dimmed.set(v !== view);
    }
    this.done.set(true);
    this.cards.active = false;
    this.confirm.active = false;
    this.closing = 0.9;
    this.el.style.pointerEvents = 'none';
    this.stack.remove(LAYER_ID);
    sfx(this.game, 'uiCommit');
  }

  /** drop the panel without an answer (zone unload / title) */
  dismiss(): void {
    this.ticket = null;
    this.closing = 0;
    this.stack.remove(LAYER_ID);
    this.fader.show(false);
  }

  handle(k: MenuKeys): void {
    if (!this.open || this.age < OPEN_DELAY) return;
    if (this.armed) {
      this.confirm.handle(k);
      if (k.cancel) this.disarm();
    } else {
      this.cards.handle(k);
    }
  }

  update(dt: number): void {
    if (this.closing > 0) {
      this.closing -= dt;
      if (this.closing <= 0) this.fader.show(false);
    }
    if (!this.fader.update(dt)) return;
    if (this.open && this.age < OPEN_DELAY) {
      this.age += dt;
      if (this.age >= OPEN_DELAY && !this.armed) this.cards.active = true;
    }
    if (this.armed && this.open) {
      this.armT += dt;
      this.armFill.set(Math.min(1, this.armT / ARM_DELAY));
    } else if (!this.open) {
      this.armFill.set(1);
    } else {
      this.armFill.set(0);
    }
    const want = this.armed || !this.open ? 1 : 0;
    this.commitLevel += Math.sign(want - this.commitLevel) * Math.min(Math.abs(want - this.commitLevel), dt * 3.2);
    this.commitVis.set(this.commitLevel);
  }
}
