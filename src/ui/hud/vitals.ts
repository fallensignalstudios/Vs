/**
 * Bottom-left vitals: protagonist name + faction shape, health with a damage-lag ghost, poise pips, the segmented
 * Echo meter (gain flash, "ready" ticks at ability costs) and the bounded local threat meter above them.
 */
import type { Game } from '@/core/api';
import { Flag, Num, Txt, h, svg } from '../dom';
import { clamp01, num, poisePips } from '../logic';
import { FACTION_ICON, ICON, glyphText, icon } from '../theme';
import type { HudFrame } from './frame';

const ECHO_SEGMENTS = 10;
const GHOST_HOLD = 0.45;
const GHOST_RATE = 0.85;

interface EchoTick {
  el: HTMLElement;
  key: Txt;
  ready: Flag;
  hidden: Flag;
  pos: Num;
}

export class Vitals {
  readonly el: HTMLElement;

  private readonly name: Txt;
  private readonly shape: SVGSVGElement;
  private shapeFor = '';
  private readonly guard: Flag;

  private readonly hpFill: Num;
  private readonly hpGhost: Num;
  private readonly hpNum: Txt;
  private readonly low: Flag;
  private readonly healFlash: Num;
  private ghost = 1;
  private ghostHold = 0;
  private lastHp = -1;
  private heal = 0;

  private readonly poiseRow: HTMLElement;
  private poiseFills: Num[] = [];
  private poiseCount = 0;
  private readonly poiseBroken: Flag;

  private readonly segs: Num[] = [];
  private readonly segFull: Flag[] = [];
  private readonly ticks: EchoTick[] = [];
  private readonly echoFlash: Num;
  private readonly echoFull: Flag;
  private readonly gainEl: HTMLElement;
  private readonly gainTxt: Txt;
  private readonly gainOpacity: Num;
  private flash = 0;
  private gainLife = 0;
  private lastEcho = -1;
  private gainFromEvent = false;

  private readonly threatEl: HTMLElement;
  private readonly threatFill: Num;
  private readonly threatOpacity: Num;
  private readonly threatHigh: Flag;
  private readonly threatWord: Txt;
  private threatVis = 0;

  constructor(private readonly game: Game) {
    // --- threat (sits above the name; only exists while threat > 0)
    const threatBar = h('i', 'aur-threat-fill');
    const threatWord = h('span', 'aur-threat-word aur-label');
    this.threatEl = h('div', 'aur-threat',
      h('div', 'aur-threat-head', icon(ICON.chain, 'aur-ico aur-threat-ico'), h('span', 'aur-label', 'Local pressure'), threatWord),
      h('div', 'aur-threat-track', threatBar, h('i', 'aur-threat-hatch')),
      h('div', 'aur-threat-remedy', 'Break the link or leave its field'),
    );
    this.threatFill = new Num((v) => { threatBar.style.transform = `scaleX(${v.toFixed(3)})`; });
    this.threatOpacity = new Num((v) => {
      this.threatEl.style.opacity = v.toFixed(3);
      this.threatEl.style.display = v <= 0.001 ? 'none' : 'block';
    });
    this.threatHigh = new Flag(this.threatEl, 'is-high');
    this.threatWord = new Txt(threatWord);

    // --- name
    this.shape = svg('0 0 16 16', 'aur-ico aur-vt-shape', '');
    const name = h('span', 'aur-vt-name aur-title');
    const guard = h('span', 'aur-vt-guard aur-label', icon(ICON.shield), 'Guard');
    this.name = new Txt(name);
    this.guard = new Flag(guard, 'is-on');

    // --- health
    const ghost = h('i', 'aur-hp-ghost');
    const fill = h('i', 'aur-hp-fill');
    const flash = h('i', 'aur-hp-flash');
    const hpNum = h('span', 'aur-hp-num aur-num');
    const hp = h('div', 'aur-hp', h('div', 'aur-hp-track', ghost, fill, flash), hpNum);
    this.hpFill = new Num((v) => { fill.style.transform = `scaleX(${v.toFixed(4)})`; }, 0.0005);
    this.hpGhost = new Num((v) => { ghost.style.transform = `scaleX(${v.toFixed(4)})`; }, 0.0005);
    this.healFlash = new Num((v) => { flash.style.opacity = v.toFixed(2); }, 0.01);
    this.hpNum = new Txt(hpNum);
    this.low = new Flag(hp, 'is-low');

    // --- poise
    this.poiseRow = h('div', 'aur-poise');
    this.poiseBroken = new Flag(this.poiseRow, 'is-broken');

    // --- echo
    const track = h('div', 'aur-echo-track');
    for (let i = 0; i < ECHO_SEGMENTS; i++) {
      const b = h('b');
      const seg = h('i', 'aur-echo-seg', b);
      track.appendChild(seg);
      this.segs.push(new Num((v) => { b.style.transform = `scaleX(${v.toFixed(3)})`; }, 0.004));
      this.segFull.push(new Flag(seg, 'is-full'));
    }
    const flashEl = h('i', 'aur-echo-flash');
    track.appendChild(flashEl);
    for (let i = 0; i < 2; i++) {
      const key = h('span', 'aur-echo-tick-key aur-num');
      const el = h('span', 'aur-echo-tick', key, h('i'));
      track.appendChild(el);
      this.ticks.push({
        el,
        key: new Txt(key),
        ready: new Flag(el, 'is-ready'),
        hidden: new Flag(el, 'is-hidden'),
        pos: new Num((v) => { el.style.left = `${(v * 100).toFixed(2)}%`; }),
      });
    }
    this.echoFlash = new Num((v) => { flashEl.style.opacity = v.toFixed(2); }, 0.01);
    this.gainEl = h('span', 'aur-echo-gain aur-label');
    this.gainTxt = new Txt(this.gainEl);
    this.gainOpacity = new Num((v) => { this.gainEl.style.opacity = v.toFixed(2); }, 0.01);
    const echo = h('div', 'aur-echo', h('span', 'aur-echo-label aur-label', 'Echo'), track, this.gainEl);
    this.echoFull = new Flag(echo, 'is-max');

    this.el = h('div', 'aur-vitals',
      this.threatEl,
      h('div', 'aur-vt-head', this.shape, name, guard),
      hp,
      this.poiseRow,
      echo,
    );

    game.events.on('player:echo', (e) => {
      const delta = num(e.delta);
      if (delta <= 0) return;
      this.gainFromEvent = true;
      this.showGain(delta, typeof e.reason === 'string' ? e.reason : '');
    });
    game.events.on('player:healed', () => { this.heal = 1; });
  }

  private showGain(delta: number, reason: string): void {
    const r = reason.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    this.gainTxt.set(`+${Math.round(delta)}${r && r.length <= 20 ? `  ${r}` : ''}`);
    this.gainLife = 1.6;
    this.flash = 1;
  }

  private buildPoise(count: number): void {
    this.poiseCount = count;
    this.poiseFills = [];
    while (this.poiseRow.firstChild) this.poiseRow.removeChild(this.poiseRow.firstChild);
    for (let i = 0; i < count; i++) {
      const b = h('b');
      this.poiseRow.appendChild(h('i', 'aur-poise-pip', b));
      this.poiseFills.push(new Num((v) => { b.style.transform = `scaleX(${v.toFixed(3)})`; }, 0.004));
    }
  }

  update(f: HudFrame): void {
    const s = f.state;
    if (!s) return;
    const dt = f.dt;

    // identity
    this.name.set(String(s.name ?? ''));
    const prot = s.protagonist === 'selene' ? 'reformation' : 'dominion';
    if (prot !== this.shapeFor) {
      this.shapeFor = prot;
      this.shape.innerHTML = FACTION_ICON[prot];
    }
    this.guard.set(s.guarding === true);

    // health + ghost
    const maxHp = Math.max(1, num(s.maxHp, 1));
    const hp = Math.max(0, Math.min(maxHp, num(s.hp)));
    const frac = hp / maxHp;
    if (this.lastHp < 0) {
      this.ghost = frac;
    } else if (hp < this.lastHp - 0.01) {
      this.ghostHold = GHOST_HOLD;
    } else if (hp > this.lastHp + 0.01) {
      this.heal = Math.max(this.heal, 0.8);
    }
    this.lastHp = hp;
    if (this.ghost < frac) this.ghost = frac;
    else if (this.ghost > frac) {
      if (this.ghostHold > 0) this.ghostHold -= dt;
      else this.ghost = Math.max(frac, this.ghost - GHOST_RATE * dt);
    }
    this.hpFill.set(frac);
    this.hpGhost.set(this.ghost);
    this.hpNum.set(String(Math.ceil(hp)));
    this.low.set(frac > 0 && frac < 0.3);
    if (this.heal > 0) this.heal = Math.max(0, this.heal - dt * 1.8);
    this.healFlash.set(this.heal * 0.8);

    // poise
    const maxPoise = Math.max(1, num(s.maxPoise, 1));
    const count = poisePips(maxPoise);
    if (count !== this.poiseCount) this.buildPoise(count);
    const pfrac = clamp01(num(s.poise) / maxPoise) * count;
    for (let i = 0; i < count; i++) (this.poiseFills[i] as Num).set(clamp01(pfrac - i));
    this.poiseBroken.set(num(s.poise) <= 0.01);

    // echo
    const echoMax = Math.max(1, num(s.echoMax, 100));
    const echo = Math.max(0, Math.min(echoMax, num(s.echo)));
    const per = echoMax / ECHO_SEGMENTS;
    for (let i = 0; i < ECHO_SEGMENTS; i++) {
      const v = clamp01((echo - i * per) / per);
      (this.segs[i] as Num).set(v);
      (this.segFull[i] as Flag).set(v >= 0.999);
    }
    if (this.lastEcho >= 0 && echo > this.lastEcho + 0.01 && !this.gainFromEvent) this.showGain(echo - this.lastEcho, '');
    this.gainFromEvent = false;
    this.lastEcho = echo;
    this.echoFull.set(echo >= echoMax - 0.01);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.9);
    this.echoFlash.set(this.flash * this.flash);
    if (this.gainLife > 0) this.gainLife = Math.max(0, this.gainLife - dt);
    this.gainOpacity.set(clamp01(this.gainLife / 0.5));

    const abilities = s.abilities;
    for (let i = 0; i < this.ticks.length; i++) {
      const t = this.ticks[i] as EchoTick;
      const a = abilities ? abilities[i] : undefined;
      const cost = a ? num(a.cost) : 0;
      if (!a || cost <= 0 || cost > echoMax) {
        t.hidden.set(true);
        continue;
      }
      t.hidden.set(false);
      t.pos.set(cost / echoMax);
      t.key.set(glyphText(this.game, i === 0 ? 'ability1' : 'ability2'));
      t.ready.set(echo >= cost);
    }

    // bounded local threat
    const threat = clamp01(num(s.threat));
    const want = threat > 0.001 ? 1 : 0;
    this.threatVis += Math.sign(want - this.threatVis) * Math.min(Math.abs(want - this.threatVis), dt * 3.5);
    this.threatOpacity.set(this.threatVis);
    if (this.threatVis > 0) {
      this.threatFill.set(threat);
      this.threatHigh.set(threat >= 0.75);
      this.threatWord.set(threat >= 0.75 ? 'High' : threat >= 0.4 ? 'Rising' : 'Present');
    }
  }
}
