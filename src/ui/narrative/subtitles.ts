/**
 * Subtitles + captions (accessibility contract).
 *  - Subtitles: speaker name in faction colour AND a faction shape tag; offscreen speakers are tagged
 *    "(radio)" / "off-screen ▸"; sizes m/l/xl; optional backing plate; at most two balanced lines — longer lines
 *    are paginated across their duration.
 *  - Captions: "[ SCAN SWEEP → ]" with a kind icon and a live bearing arrow.
 */
import * as THREE from 'three';
import type { CaptionKind, DialogueLine, Game, Vec3Like } from '@/core/api';
import { isStub } from '@/core/stub';
import { Fader, Flag, Num, Txt, h, svg, warnOnce } from '../dom';
import { bearingWord, num, pageDurations, paginate, relAngle, speakerFaction, subtitleSeconds, type Faction } from '../logic';
import { CAPTION_ICON, FACTION_ICON, ICON, icon } from '../theme';

const SUB_GRACE = 2.5;
const CAPTION_LIFE = 3.8;
const CAPTION_POOL = 4;
const tmpF = new THREE.Vector3();

interface Caption {
  el: HTMLElement;
  fader: Fader;
  text: Txt;
  where: Txt;
  shape: SVGSVGElement;
  arrowEl: SVGSVGElement;
  hasBearing: Flag;
  rot: Num;
  kind: CaptionKind | '';
  life: number;
  pos: { x: number; y: number; z: number } | null;
  bearing: number;
  order: number;
}

export class Subtitles {
  /** flex column: captions above, subtitle below */
  readonly el: HTMLElement;

  private readonly subEl: HTMLElement;
  private readonly subFader: Fader;
  private readonly who: HTMLElement;
  private readonly shape: SVGSVGElement;
  private readonly name: Txt;
  private readonly tag: Txt;
  private readonly tagIcon: SVGSVGElement;
  private readonly textEl: HTMLElement;
  private readonly text: Txt;
  private readonly pagerEl: HTMLElement;
  private readonly pager: Txt;

  private line: DialogueLine | null = null;
  private pages: string[] = [];
  private durations: number[] = [];
  private page = 0;
  private pageT = 0;
  private total = 0;
  private elapsed = 0;
  private faction: Faction | '' = '';
  private enabled = true;
  private letterboxed = false;

  private readonly capEl: HTMLElement;
  private readonly caps: Caption[] = [];
  private capOrder = 0;
  private capsEnabled = true;

  constructor(private readonly game: Game) {
    // --- subtitle
    this.shape = svg('0 0 16 16', 'aur-ico aur-sub-shape', '');
    const name = h('span', 'aur-sub-name');
    const tag = h('span', 'aur-sub-tagtext');
    this.tagIcon = icon(ICON.radio, 'aur-ico aur-sub-tagico');
    this.who = h('div', 'aur-sub-who', this.shape as unknown as HTMLElement, name, h('span', 'aur-sub-tag', this.tagIcon as unknown as HTMLElement, tag));
    this.textEl = h('div', 'aur-sub-text');
    this.pagerEl = h('span', 'aur-sub-pager aur-num');
    this.subEl = h('div', 'aur-sub', this.who, this.textEl, this.pagerEl);
    this.name = new Txt(name);
    this.tag = new Txt(tag);
    this.text = new Txt(this.textEl);
    this.pager = new Txt(this.pagerEl);
    this.subFader = new Fader(this.subEl, { in: 0.16, out: 0.22 });

    // --- captions
    this.capEl = h('div', 'aur-caps');
    for (let i = 0; i < CAPTION_POOL; i++) {
      const shape = svg('0 0 16 16', 'aur-ico aur-cap-ico', '');
      const arrowEl = icon(ICON.arrow, 'aur-ico aur-cap-arrow');
      const text = h('span', 'aur-cap-text');
      const where = h('span', 'aur-cap-where');
      const el = h('div', 'aur-cap',
        h('span', 'aur-cap-br', '['), shape as unknown as HTMLElement, text,
        h('span', 'aur-cap-dir', arrowEl as unknown as HTMLElement, where),
        h('span', 'aur-cap-br', ']'));
      this.capEl.appendChild(el);
      this.caps.push({
        el, fader: new Fader(el, { in: 0.18, out: 0.4, display: 'flex' }), text: new Txt(text), where: new Txt(where),
        shape, arrowEl, hasBearing: new Flag(el, 'has-bearing'),
        rot: new Num((v) => { arrowEl.style.transform = `rotate(${v.toFixed(3)}rad)`; }, 0.02),
        kind: '', life: 0, pos: null, bearing: 0, order: 0,
      });
    }

    this.el = h('div', 'aur-talk', this.capEl, this.subEl);
    this.applySettings();

    game.events.on('dialogue:line', (e) => { if (e?.line) this.show(e.line); });
    game.events.on('dialogue:clear', () => this.show(null));
    game.events.on('caption', (e) => {
      if (!e) return;
      this.caption(e.text, e.kind, undefined, e.pos);
    });
    game.events.on('settings:changed', () => this.applySettings());
  }

  private applySettings(): void {
    const s = this.game.settings;
    const size = s.get('subtitleSize');
    this.el.dataset.size = size === 'l' || size === 'xl' ? size : 'm';
    this.el.classList.toggle('is-plate', s.get('subtitleBackground') !== false);
    this.enabled = s.get('subtitles') !== false;
    this.capsEnabled = s.get('captions') !== false;
    if (!this.enabled) this.subFader.show(false, true);
    else if (this.line) this.layout(this.line, true);
    if (!this.capsEnabled) for (const c of this.caps) { c.life = 0; c.fader.show(false, true); }
  }

  /** subtitles sit above the bottom letterbox bar while it is in */
  setLetterboxed(on: boolean): void {
    if (on === this.letterboxed) return;
    this.letterboxed = on;
    this.el.classList.toggle('is-letterboxed', on);
  }

  // ------------------------------------------------------------------------------------------ subtitles
  show(line: DialogueLine | null): void {
    if (!line || typeof line.text !== 'string' || !line.text.trim()) {
      this.line = null;
      this.subFader.show(false);
      return;
    }
    const cur = this.line;
    if (cur && this.subFader.on && (cur === line || (cur.speaker === line.speaker && cur.text === line.text))) return;
    this.line = line;
    this.elapsed = 0;
    this.total = num(line.duration, 0) > 0 ? num(line.duration) : subtitleSeconds(line.text);
    if (this.enabled) this.layout(line, false);
  }

  private layout(line: DialogueLine, keepPage: boolean): void {
    const channel = line.channel ?? 'voice';
    const faction = speakerFaction(line.speaker);
    const speaker = String(line.speaker ?? '').trim();
    const named = faction !== 'none' && channel !== 'narration' && speaker.length > 0;
    this.who.style.display = named ? '' : 'none';
    if (faction !== this.faction) {
      this.faction = faction;
      this.subEl.dataset.faction = faction;
      this.shape.innerHTML = FACTION_ICON[faction];
    }
    this.subEl.dataset.channel = channel;
    this.name.set(speaker);
    const radio = channel === 'radio';
    const off = line.offscreen === true;
    // offscreen speakers are always identified in words; radio gets the comm glyph, others an arrow tag
    this.tag.set(radio ? '(radio)' : off ? 'off-screen ▸' : '');
    this.tagIcon.style.display = radio ? '' : 'none';
    this.subEl.classList.toggle('is-off', off || radio);

    this.subFader.show(true);
    // paginate against the real layout: a page fits when it renders in at most two lines
    const el = this.textEl;
    const prev = this.text.value;
    const fits = (candidate: string): boolean => {
      el.textContent = candidate;
      const hgt = el.getBoundingClientRect().height;
      if (hgt <= 0) return true;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || hgt;
      return Math.round(hgt / lh) <= 2;
    };
    let pages: string[];
    try {
      pages = paginate(line.text, fits);
    } catch {
      pages = [line.text.trim()];
    }
    el.textContent = prev;
    this.pages = pages;
    this.durations = pageDurations(pages, this.total);
    if (!keepPage || this.page >= pages.length) {
      this.page = 0;
      this.pageT = 0;
    }
    this.showPage();
  }

  private showPage(): void {
    const n = this.pages.length;
    const t = this.pages[this.page] ?? '';
    // Txt caches: force a write because pagination measured through the same node
    this.textEl.textContent = t;
    this.text.set(t);
    this.pager.set(n > 1 ? `${this.page + 1} / ${n}` : '');
    this.pagerEl.style.display = n > 1 ? '' : 'none';
  }

  // ------------------------------------------------------------------------------------------ captions
  caption(text: string, kind: CaptionKind, bearing?: number, pos?: Vec3Like): void {
    if (!this.capsEnabled) return;
    const msg = String(text ?? '').trim();
    if (!msg) return;
    let k: CaptionKind = kind;
    if (!(k in CAPTION_ICON)) {
      warnOnce(`caption:${String(kind)}`, `unknown caption kind "${String(kind)}" — using 'ambient'`);
      k = 'ambient';
    }
    let slot = this.caps.find((c) => c.life > 0 && c.text.value === msg) ?? null;
    if (!slot) slot = this.caps.find((c) => !c.fader.visible) ?? null;
    if (!slot) {
      slot = this.caps.reduce((a, b) => (a.life <= b.life ? a : b));
      slot.fader.show(false, true);
    }
    if (slot.kind !== k) {
      slot.kind = k;
      slot.el.dataset.kind = k;
      slot.shape.innerHTML = CAPTION_ICON[k];
    }
    slot.text.set(msg);
    slot.pos = pos && Number.isFinite(num(pos.x, Number.NaN)) && Number.isFinite(num(pos.z, Number.NaN)) ? { x: pos.x, y: num(pos.y), z: pos.z } : null;
    const hasBearing = slot.pos !== null || (typeof bearing === 'number' && Number.isFinite(bearing));
    slot.bearing = typeof bearing === 'number' && Number.isFinite(bearing) ? bearing : 0;
    slot.hasBearing.set(hasBearing);
    if (hasBearing) this.aimCaption(slot);
    if (slot.life <= 0) {
      slot.order = this.capOrder++;
      slot.el.style.order = String(slot.order);
    }
    slot.life = CAPTION_LIFE;
    slot.fader.show(true);
  }

  private aimCaption(c: Caption): void {
    if (c.pos) {
      const cam = this.game.camera;
      if (!isStub(cam)) {
        try {
          cam.getForward(tmpF);
          const p = cam.camera.position;
          if (tmpF.x !== 0 || tmpF.z !== 0) c.bearing = relAngle(c.pos.x - p.x, c.pos.z - p.z, tmpF.x, tmpF.z);
        } catch {
          /* keep the last bearing */
        }
      }
    }
    c.rot.set(c.bearing);
    c.where.set(bearingWord(c.bearing));
  }

  // ------------------------------------------------------------------------------------------ update
  update(dt: number): void {
    const paused = this.game.paused === true;
    if (this.line && this.enabled && !paused) {
      this.elapsed += dt;
      this.pageT += dt;
      const d = this.durations[this.page] ?? this.total;
      if (this.page < this.pages.length - 1 && this.pageT >= d) {
        this.page++;
        this.pageT = 0;
        this.showPage();
      }
      // safety net: a line nobody cleared never sticks to the screen
      if (this.elapsed > this.total + SUB_GRACE) {
        this.line = null;
        this.subFader.show(false);
      }
    }
    this.subFader.update(dt);

    for (const c of this.caps) {
      if (c.life > 0) {
        if (!paused) c.life -= dt;
        if (c.life <= 0) c.fader.show(false);
        else if (c.pos) this.aimCaption(c);
      }
      c.fader.update(dt);
    }
  }
}
