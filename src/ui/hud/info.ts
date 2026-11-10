/**
 * Persistent HUD information: the objective line (top-left, with a change animation), the in-fiction readout
 * (top-right) and the named elite frame (top-centre; deliberately slight — not a boss bar).
 */
import type { Game } from '@/core/api';
import { Fader, Flag, Num, Txt, h, svg } from '../dom';
import { clamp01, num } from '../logic';
import { FACTION_ICON, ICON, icon } from '../theme';
import { sfx } from '../menu';
import type { HudFrame } from './frame';

// ---------------------------------------------------------------------------------------------- objective
export class Objective {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly body: HTMLElement;
  private readonly text: Txt;
  private readonly tag: HTMLElement;
  private readonly tagText: Txt;
  private readonly sweep: HTMLElement;
  private shown: string | null = null;
  private pending: string | null = null;
  private swap = 0; // 1 → 0 fades the old line out, then the new one in
  private phase: 'idle' | 'out' | 'in' = 'idle';
  private fresh = 0;
  private lastBody = -1;
  private lastFresh = -1;

  constructor(private readonly game: Game) {
    const text = h('div', 'aur-obj-text');
    this.sweep = h('i', 'aur-obj-sweep');
    this.tag = h('span', 'aur-obj-tag aur-label', 'Updated');
    this.body = h('div', 'aur-obj-body', text, this.sweep);
    this.el = h('div', 'aur-objective',
      h('div', 'aur-obj-head', icon(ICON.diamondSolid, 'aur-ico aur-obj-ico'), h('span', 'aur-label', 'Objective'), this.tag),
      this.body,
    );
    this.text = new Txt(text);
    this.tagText = new Txt(this.tag);
    this.fader = new Fader(this.el, { in: 0.4, out: 0.3 });
  }

  set(text: string | null): void {
    const t = text === null || text === undefined ? null : String(text).trim() || null;
    if (t === (this.pending ?? this.shown)) return;
    if (t === null) {
      this.pending = null;
      this.shown = null;
      this.phase = 'idle';
      this.fader.show(false);
      return;
    }
    if (this.shown === null || !this.fader.on) {
      this.shown = t;
      this.pending = null;
      this.text.set(t);
      this.tagText.set('New');
      this.phase = 'in';
      this.swap = 0;
      this.fresh = 1;
      this.fader.show(true);
      sfx(this.game, 'uiObjective');
      return;
    }
    this.pending = t;
    this.phase = 'out';
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    if (this.phase === 'out') {
      this.swap = Math.min(1, this.swap + dt / 0.2);
      if (this.swap >= 1 && this.pending !== null) {
        this.shown = this.pending;
        this.pending = null;
        this.text.set(this.shown);
        this.tagText.set('Updated');
        this.phase = 'in';
        this.fresh = 1;
        sfx(this.game, 'uiObjective');
      }
    } else if (this.phase === 'in') {
      this.swap = Math.max(0, this.swap - dt / 0.35);
      if (this.swap <= 0) this.phase = 'idle';
    }
    if (this.fresh > 0) this.fresh = Math.max(0, this.fresh - dt / 3.2);
    const b = Math.round((1 - this.swap) * 100) / 100;
    if (b !== this.lastBody) {
      this.lastBody = b;
      this.body.style.opacity = String(b);
      this.body.style.setProperty('--k', String(Math.round(this.swap * 100) / 100));
    }
    const fr = Math.round(this.fresh * 50) / 50;
    if (fr !== this.lastFresh) {
      this.lastFresh = fr;
      // the gold sweep runs across in the first third, the "Updated" tag lingers then fades
      const sweepT = clamp01((1 - this.fresh) / 0.3);
      this.sweep.style.transform = `scaleX(${fr > 0 ? (1 - sweepT).toFixed(3) : '0'})`;
      this.sweep.style.opacity = fr > 0 ? '1' : '0';
      this.tag.style.opacity = String(clamp01(this.fresh * 4));
    }
  }
}

// ---------------------------------------------------------------------------------------------- readout
export type ReadoutTone = 'amber' | 'cold' | 'gold' | 'violet';
const TONE_ICON: Record<ReadoutTone, string> = {
  amber: FACTION_ICON.dominion, cold: FACTION_ICON.reformation, gold: FACTION_ICON.ancient, violet: FACTION_ICON.eclipse,
};

export class Readout {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly label: Txt;
  private readonly value: Txt;
  private readonly shape: SVGSVGElement;
  private tone: ReadoutTone | '' = '';
  private tick = 0;
  private lastTick = -1;
  private readonly valueEl: HTMLElement;

  constructor() {
    const label = h('span', 'aur-readout-label aur-label');
    this.valueEl = h('span', 'aur-readout-value aur-num');
    this.shape = svg('0 0 16 16', 'aur-ico aur-readout-shape', '');
    this.el = h('div', 'aur-readout',
      h('div', 'aur-readout-head', this.shape as unknown as HTMLElement, label),
      this.valueEl,
      h('i', 'aur-readout-corner'),
    );
    this.label = new Txt(label);
    this.value = new Txt(this.valueEl);
    this.fader = new Fader(this.el, { in: 0.35, out: 0.4 });
  }

  set(r: { label: string; value: string; tone?: ReadoutTone } | null): void {
    if (!r) {
      this.fader.show(false);
      return;
    }
    const tone: ReadoutTone = r.tone && r.tone in TONE_ICON ? r.tone : 'gold';
    if (tone !== this.tone) {
      this.tone = tone;
      this.el.dataset.tone = tone;
      this.shape.innerHTML = TONE_ICON[tone];
    }
    this.label.set(String(r.label ?? ''));
    if (this.value.set(String(r.value ?? '')) && this.fader.on) this.tick = 1;
    this.fader.show(true);
  }

  update(dt: number): void {
    if (!this.fader.update(dt)) return;
    if (this.tick > 0) this.tick = Math.max(0, this.tick - dt * 5);
    const t = Math.round(this.tick * 20) / 20;
    if (t !== this.lastTick) {
      this.lastTick = t;
      this.valueEl.style.opacity = String(1 - t * 0.28);
    }
  }
}

// ---------------------------------------------------------------------------------------------- elite frame
export interface EliteState {
  name: string;
  hp: number;
  maxHp: number;
  regenerating: boolean;
  exposed: boolean;
}

export class EliteFrame {
  readonly el: HTMLElement;
  private readonly fader: Fader;
  private readonly name: Txt;
  private readonly fill: Num;
  private readonly ghost: Num;
  private readonly regen: Flag;
  private readonly exposed: Flag;
  private readonly sheen: HTMLElement;
  private frac = 1;
  private ghostV = 1;
  private hold = 0;
  private isRegen = false;
  private phase = 0;
  private lastSheen = -1;

  constructor() {
    const name = h('div', 'aur-elite-name aur-title');
    const fill = h('i', 'f');
    const ghost = h('i', 'g');
    this.sheen = h('i', 's');
    this.el = h('div', 'aur-elite',
      name,
      h('div', 'aur-elite-bar', h('i', 'cap'), h('div', 'aur-elite-track', ghost, fill, this.sheen), h('i', 'cap')),
      h('div', 'aur-elite-states',
        h('span', 'aur-elite-state s-regen aur-label', icon(ICON.regen), 'Regenerating'),
        h('span', 'aur-elite-state s-exposed aur-label', icon(ICON.diamond), 'Joint exposed'),
      ),
    );
    this.name = new Txt(name);
    this.fill = new Num((v) => { fill.style.transform = `scaleX(${v.toFixed(4)})`; }, 0.0005);
    this.ghost = new Num((v) => { ghost.style.transform = `scaleX(${v.toFixed(4)})`; }, 0.0005);
    this.regen = new Flag(this.el, 'is-regen');
    this.exposed = new Flag(this.el, 'is-exposed');
    this.fader = new Fader(this.el, { in: 0.6, out: 0.8 });
  }

  set(e: EliteState | null): void {
    if (!e) {
      this.fader.show(false);
      return;
    }
    const first = !this.fader.on;
    this.name.set(String(e.name ?? ''));
    const max = Math.max(1, num(e.maxHp, 1));
    const frac = clamp01(num(e.hp) / max);
    if (first) this.ghostV = frac;
    else if (frac < this.frac - 0.0005) this.hold = 0.5;
    this.frac = frac;
    this.isRegen = e.regenerating === true;
    this.regen.set(this.isRegen);
    this.exposed.set(e.exposed === true);
    this.fader.show(true);
  }

  update(f: HudFrame): void {
    if (!this.fader.update(f.dt)) return;
    if (this.ghostV < this.frac) this.ghostV = this.frac;
    else if (this.ghostV > this.frac) {
      if (this.hold > 0) this.hold -= f.dt;
      else this.ghostV = Math.max(this.frac, this.ghostV - f.dt * 0.35);
    }
    this.fill.set(this.frac);
    this.ghost.set(this.ghostV);
    // regeneration reads as MOTION (a sheen travelling up the bar), not only as a colour
    if (this.isRegen) {
      this.phase = (this.phase + f.dt * 0.55) % 1;
      const p = Math.round(this.phase * 200) / 200;
      if (p !== this.lastSheen) {
        this.lastSheen = p;
        this.sheen.style.transform = `translateX(${((p * this.frac - 1) * 100).toFixed(2)}%)`;
        this.sheen.style.opacity = (Math.sin(p * Math.PI) * 0.9).toFixed(2);
      }
    } else if (this.lastSheen !== -1) {
      this.lastSheen = -1;
      this.sheen.style.opacity = '0';
    }
  }
}

// ---------------------------------------------------------------------------------------------- fps + debug
export class Diagnostics {
  readonly fpsEl: HTMLElement;
  readonly debugEl: HTMLElement;
  private readonly fps: Txt;
  private readonly debug: Txt;
  private acc = 0;
  private fpsShown = false;

  constructor(private readonly game: Game) {
    this.fpsEl = h('div', 'aur-fps');
    this.debugEl = h('div', 'aur-debug');
    this.fps = new Txt(this.fpsEl);
    this.debug = new Txt(this.debugEl);
  }

  debugText(text: string | null): void {
    const t = text === null || text === undefined ? '' : String(text);
    this.debug.set(t);
    this.debugEl.style.display = t ? 'block' : 'none';
  }

  update(dt: number): void {
    const show = this.game.settings.get('showFps') === true;
    if (show !== this.fpsShown) {
      this.fpsShown = show;
      this.fpsEl.style.display = show ? 'block' : 'none';
      this.acc = 1;
    }
    if (!show) return;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    let fps = dt > 0 ? 1 / dt : 0;
    let extra = '';
    try {
      const st = this.game.render.stats;
      const v = num(st?.fps, 0);
      if (v > 0) {
        fps = v;
        const scale = num(st.resolutionScale, 0);
        if (scale > 0 && scale < 0.995) extra = `  ·  ${Math.round(scale * 100)}%`;
      }
    } catch {
      /* stub renderer */
    }
    this.fps.set(`${Math.round(fps)} FPS${extra}`);
  }
}
