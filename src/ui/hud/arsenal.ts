/**
 * Bottom-right arsenal: melee / ranged names, ammo `mag / reserve` with per-round ticks and a reload sweep, and
 * the two ability slots (glyph, cost, cooldown sweep, dim when unaffordable).
 */
import type { AbilityState, Game } from '@/core/api';
import { Flag, Num, Txt, h } from '../dom';
import { clamp01, num } from '../logic';
import { ICON, glyphText, icon, isGamepad, keycap, setKeycap } from '../theme';
import type { HudFrame } from './frame';

const MAX_ROUND_TICKS = 16;

interface Slot {
  el: HTMLElement;
  key: HTMLElement;
  name: Txt;
  cost: Txt;
  sweep: Num;
  cooling: Flag;
  poor: Flag;
  ready: Flag;
  pulse: Num;
  wasReady: boolean;
  pulseT: number;
}

export class Arsenal {
  readonly el: HTMLElement;

  private readonly melee: Txt;
  private readonly ranged: Txt;
  private readonly mag: Txt;
  private readonly reserve: Txt;
  private readonly empty: Flag;
  private readonly lowAmmo: Flag;
  private readonly reloading: Flag;
  private readonly reloadSweep: Num;
  private readonly reloadKey: HTMLElement;
  private readonly rounds: HTMLElement;
  private roundEls: Flag[] = [];
  private roundCount = -1;
  private reloadT = 0;
  private readonly slots: Slot[] = [];

  constructor(private readonly game: Game) {
    const melee = h('span', 'aur-wpn-name');
    const ranged = h('span', 'aur-wpn-name');
    const mag = h('span', 'aur-ammo-mag aur-num');
    const reserve = h('span', 'aur-ammo-res aur-num');
    this.melee = new Txt(melee);
    this.ranged = new Txt(ranged);
    this.mag = new Txt(mag);
    this.reserve = new Txt(reserve);

    this.rounds = h('div', 'aur-rounds');
    const sweep = h('i', 'aur-reload-sweep');
    this.reloadKey = keycap('R', 'is-sm');
    const reloadTag = h('span', 'aur-reload-tag aur-label', 'Reloading');
    const reloadHint = h('span', 'aur-reload-hint aur-label', this.reloadKey, 'Reload');
    const ammo = h('div', 'aur-ammo', mag, h('span', 'aur-ammo-sep'), reserve);
    const rangedRow = h('div', 'aur-wpn aur-wpn-ranged',
      h('div', 'aur-wpn-id', icon(ICON.sidearm), ranged), ammo);
    const roundsRow = h('div', 'aur-rounds-row', reloadTag, reloadHint, h('div', 'aur-rounds-wrap', this.rounds, sweep));
    this.empty = new Flag(rangedRow, 'is-empty');
    this.lowAmmo = new Flag(roundsRow, 'is-low');
    this.reloading = new Flag(roundsRow, 'is-reloading');
    this.reloadSweep = new Num((v) => { sweep.style.transform = `scaleX(${v.toFixed(3)})`; }, 0.004);

    const abilities = h('div', 'aur-abilities');
    for (let i = 0; i < 2; i++) {
      const key = keycap(i === 0 ? '1' : '2');
      const cd = h('i', 'aur-ab-cd');
      const ring = h('i', 'aur-ab-pulse');
      const name = h('span', 'aur-ab-name');
      const cost = h('span', 'aur-ab-cost aur-num');
      const el = h('div', 'aur-ab', h('div', 'aur-ab-frame', key, cd, ring), h('div', 'aur-ab-txt', name, h('span', 'aur-ab-costrow', h('i', 'aur-ab-costmark'), cost)));
      abilities.appendChild(el);
      this.slots.push({
        el, key,
        name: new Txt(name),
        cost: new Txt(cost),
        sweep: new Num((v) => { cd.style.transform = `scaleY(${v.toFixed(3)})`; }, 0.004),
        cooling: new Flag(el, 'is-cooling'),
        poor: new Flag(el, 'is-poor'),
        ready: new Flag(el, 'is-ready'),
        pulse: new Num((v) => {
          ring.style.opacity = (v * 0.9).toFixed(2);
          ring.style.transform = `scale(${(1 + (1 - v) * 0.5).toFixed(3)})`;
        }, 0.01),
        wasReady: false,
        pulseT: 0,
      });
    }

    this.el = h('div', 'aur-arsenal',
      h('div', 'aur-wpn aur-wpn-melee', h('div', 'aur-wpn-id', icon(ICON.blade), melee)),
      rangedRow,
      roundsRow,
      abilities,
    );
  }

  private buildRounds(count: number): void {
    this.roundCount = count;
    this.roundEls = [];
    while (this.rounds.firstChild) this.rounds.removeChild(this.rounds.firstChild);
    for (let i = 0; i < count; i++) {
      const el = h('i');
      this.rounds.appendChild(el);
      this.roundEls.push(new Flag(el, 'is-on'));
    }
  }

  update(f: HudFrame): void {
    const s = f.state;
    if (!s) return;
    this.melee.set(String(s.meleeName ?? ''));
    this.ranged.set(String(s.rangedName ?? ''));

    const magSize = Math.max(0, Math.round(num(s.magSize)));
    const ammo = Math.max(0, Math.round(num(s.ammo)));
    const reserve = Math.max(0, Math.round(num(s.reserve)));
    this.mag.set(String(ammo));
    this.reserve.set(String(reserve));
    const ticks = Math.min(MAX_ROUND_TICKS, magSize);
    if (ticks !== this.roundCount) this.buildRounds(ticks);
    for (let i = 0; i < ticks; i++) (this.roundEls[i] as Flag).set(i < ammo);
    const reloading = s.reloading === true;
    this.empty.set(ammo === 0 && !reloading);
    this.lowAmmo.set(!reloading && magSize > 0 && ammo <= Math.max(1, Math.floor(magSize * 0.25)) && reserve > 0);
    if (this.reloading.set(reloading) && reloading) this.reloadT = 0;
    if (reloading) {
      // the controller exposes only a boolean: draw an eased sweep that approaches (never reaches) full
      this.reloadT += f.dt;
      this.reloadSweep.set(1 - Math.exp(-this.reloadT * 2.2));
    }
    setKeycap(this.reloadKey, glyphText(this.game, 'reload'), false);

    const echo = num(s.echo);
    const round = isGamepad(this.game);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i] as Slot;
      const a: AbilityState | undefined = s.abilities ? s.abilities[i] : undefined;
      if (!a) continue;
      const g = glyphText(this.game, i === 0 ? 'ability1' : 'ability2');
      setKeycap(slot.key, g, round && g.length === 1);
      slot.name.set(String(a.name ?? ''));
      const cost = num(a.cost);
      slot.cost.set(String(Math.round(cost)));
      const left = Math.max(0, num(a.cooldownLeft));
      const total = Math.max(0.001, num(a.cooldown, 1));
      const cooling = left > 0.01;
      slot.cooling.set(cooling);
      slot.sweep.set(cooling ? clamp01(left / total) : 0);
      const affordable = echo >= cost;
      slot.poor.set(!affordable);
      const ready = affordable && !cooling;
      slot.ready.set(ready);
      if (ready && !slot.wasReady) slot.pulseT = 1;
      slot.wasReady = ready;
      if (slot.pulseT > 0) slot.pulseT = Math.max(0, slot.pulseT - f.dt * 1.6);
      slot.pulse.set(slot.pulseT);
    }
  }
}
