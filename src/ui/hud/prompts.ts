/**
 * Input prompts: the scripted context action (Resonance confirm, duel prompts — large, centred-low, with a
 * window timer ring) and the interaction prompt (press / hold ring).
 */
import type { ContextAction, Game } from '@/core/api';
import { Fader, Flag, Num, Txt, h } from '../dom';
import { clamp01, num } from '../logic';
import { glyphText, isGamepad, keycap, setKeycap } from '../theme';
import { sfx } from '../menu';
import type { HudFrame } from './frame';

export class ContextPrompt {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly key: HTMLElement;
  private readonly text: Txt;
  private readonly ringEl: HTMLElement;
  private readonly ring: Num;
  private readonly urgent: Flag;
  private readonly timed: Flag;
  private readonly auto: Flag;
  private current: ContextAction | null = null;
  private currentId = '';
  private start = 0;
  private pulse = 0;
  private lastPulse = -1;

  constructor(private readonly game: Game) {
    this.key = keycap('', 'is-lg');
    this.ringEl = h('div', 'aur-ring aur-ctx-ring', this.key);
    const text = h('div', 'aur-ctx-text aur-title');
    this.el = h('div', 'aur-ctx', this.ringEl, text, h('div', 'aur-ctx-auto aur-label', 'Automatic'));
    this.text = new Txt(text);
    this.ring = new Num((v) => { this.ringEl.style.setProperty('--p', v.toFixed(3)); }, 0.003);
    this.urgent = new Flag(this.el, 'is-urgent');
    this.timed = new Flag(this.el, 'is-timed');
    this.auto = new Flag(this.el, 'is-auto');
    this.fader = new Fader(this.el, { in: 0.16, out: 0.22, display: 'flex' });
  }

  /** `ctx` = the action on offer (null hides the prompt); drawn whether or not the rest of the HUD is visible */
  update(f: HudFrame, ctx: ContextAction | null): void {
    if (ctx && typeof ctx.prompt === 'string') {
      const id = String(ctx.id ?? ctx.prompt);
      if (ctx !== this.current || id !== this.currentId) {
        this.current = ctx;
        this.currentId = id;
        this.start = f.now;
        this.pulse = 1;
        sfx(this.game, 'uiPrompt');
      }
      const g = glyphText(this.game, ctx.button);
      setKeycap(this.key, g, isGamepad(this.game) && g.length === 1);
      this.text.set(ctx.prompt);
      const win = num(ctx.window, Infinity);
      const timed = Number.isFinite(win) && win > 0;
      this.timed.set(timed);
      const left = timed ? clamp01(1 - (f.now - this.start) / win) : 1;
      this.ring.set(left);
      this.urgent.set(timed && left < 0.3);
      this.auto.set(ctx.autoConfirmable === true && this.game.settings.get('autoPrompts') === true);
      this.fader.show(true);
    } else {
      this.current = null;
      this.currentId = '';
      this.fader.show(false);
    }
    if (!this.fader.update(f.dt)) return;
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - f.dt * 3);
    const p = Math.round(this.pulse * 40) / 40;
    if (p !== this.lastPulse) {
      this.lastPulse = p;
      this.ringEl.style.transform = `scale(${(1 + p * 0.18).toFixed(3)})`;
    }
  }
}

export interface PromptSpec {
  text: string;
  glyph: string;
  progress?: number;
  hold?: boolean;
}

export class InteractPrompt {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly key: HTMLElement;
  private readonly ringEl: HTMLElement;
  private readonly text: Txt;
  private readonly verb: Txt;
  private readonly ring: Num;
  private readonly holding: Flag;
  private readonly isHold: Flag;

  constructor(private readonly game: Game) {
    this.key = keycap('', '');
    this.ringEl = h('div', 'aur-ring aur-prompt-ring', this.key);
    const verb = h('span', 'aur-prompt-verb aur-label');
    const text = h('span', 'aur-prompt-text');
    this.el = h('div', 'aur-prompt', this.ringEl, h('div', 'aur-prompt-body', verb, text));
    this.text = new Txt(text);
    this.verb = new Txt(verb);
    this.ring = new Num((v) => { this.ringEl.style.setProperty('--p', v.toFixed(3)); }, 0.003);
    this.holding = new Flag(this.el, 'is-holding');
    this.isHold = new Flag(this.el, 'is-hold');
    this.fader = new Fader(this.el, { in: 0.18, out: 0.18, display: 'flex' });
  }

  set(p: PromptSpec | null): void {
    const text = p ? String(p.text ?? '').trim() : '';
    if (!p || !text) {
      this.fader.show(false);
      return;
    }
    const g = String(p.glyph ?? '').trim() || '?';
    setKeycap(this.key, g, isGamepad(this.game) && g.length === 1);
    this.text.set(text);
    const hold = p.hold === true;
    const progress = clamp01(num(p.progress, 0));
    this.isHold.set(hold);
    // hold → toggle accessibility: the same interaction is a single press that latches
    this.verb.set(hold ? (this.game.settings.get('holdToToggle') === true ? 'Press' : 'Hold') : '');
    this.ring.set(hold ? progress : 0);
    this.holding.set(hold && progress > 0.001);
    this.fader.show(true);
  }

  update(dt: number): void {
    this.fader.update(dt);
  }
}
