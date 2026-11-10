/**
 * HUD composition: polls `game.player.getHudState()` once per frame and fans the snapshot out to the widgets,
 * each of which only touches the DOM when its values change.
 */
import type { Actor, ContextAction, Game, PlayerHudState, ProtagonistId, Vec3Like, WorldMarkerOpts } from '@/core/api';
import { isStub } from '@/core/stub';
import { Num, h, reducedMotion, warnOnce } from '../dom';
import { clamp01, num } from '../logic';
import type { HitKind } from '../logic';
import { Arsenal } from './arsenal';
import { measureViewport, type HudFrame, type Viewport } from './frame';
import { Diagnostics, EliteFrame, Objective, Readout, type EliteState, type ReadoutTone } from './info';
import { Hint, Toasts, ZoneCard, type ToastKind } from './notices';
import { ContextPrompt, InteractPrompt, type PromptSpec } from './prompts';
import { Reticle } from './reticle';
import { Vitals } from './vitals';
import { WorldHud } from './world';

export class Hud {
  /** projected elements (markers, pips, lock bracket) — lowest layer */
  readonly worldEl: HTMLElement;
  /** low-health edge treatment */
  readonly edgeEl: HTMLElement;
  /** combat + information panels */
  readonly panelEl: HTMLElement;
  /** elements that outlive HUD visibility (zone card, toasts) */
  readonly noticeEl: HTMLElement;
  /** ADDED. layer of the context prompt — painted above the letterbox, shown whether or not the HUD is */
  readonly ctxEl: HTMLElement;
  readonly diagnostics: Diagnostics;

  private readonly vitals: Vitals;
  private readonly arsenal: Arsenal;
  private readonly reticle: Reticle;
  private readonly world: WorldHud;
  private readonly objectiveW: Objective;
  private readonly readoutW: Readout;
  private readonly elite: EliteFrame;
  private readonly toasts: Toasts;
  private readonly zone: ZoneCard;
  private readonly hintW: Hint;
  private readonly ctx: ContextPrompt;
  private readonly promptW: InteractPrompt;

  private readonly playerEl: HTMLElement;
  private readonly panelOpacity: Num;
  private readonly playerOpacity: Num;
  private readonly edgeOpacity: Num;
  private vis = 0;
  private playerVis = 0;
  private swap = 0;
  private lastSwap = -1;
  private edge = 0;
  private edgePhase = 0;
  private protagonist: ProtagonistId | '' = '';
  private noticesOn = true;
  private readonly view: Viewport = { w: 1280, h: 720, u: 0.75 };
  private viewDirty = true;
  private readonly frame: HudFrame;

  constructor(private readonly game: Game, private readonly root: HTMLElement) {
    this.vitals = new Vitals(game);
    this.arsenal = new Arsenal(game);
    this.reticle = new Reticle(game);
    this.world = new WorldHud(game);
    this.objectiveW = new Objective(game);
    this.readoutW = new Readout();
    this.elite = new EliteFrame();
    this.toasts = new Toasts(game);
    this.zone = new ZoneCard();
    this.hintW = new Hint(game);
    this.ctx = new ContextPrompt(game);
    this.promptW = new InteractPrompt(game);
    this.diagnostics = new Diagnostics(game);

    this.worldEl = h('div', 'aur-layer aur-hud-world', this.world.el, this.reticle.lockEl);
    this.edgeEl = h('div', 'aur-layer aur-lowhp');
    this.playerEl = h('div', 'aur-layer aur-hud-player', this.reticle.el, this.vitals.el, this.arsenal.el);
    // the context prompt has its own layer: a duel / Resonance beat inside a scene shows it with the HUD hidden
    this.ctxEl = h('div', 'aur-layer aur-hud-ctx', this.ctx.el);
    this.panelEl = h('div', 'aur-layer aur-hud', this.playerEl, this.objectiveW.el, this.readoutW.el, this.elite.el, this.hintW.el, this.promptW.el);
    this.noticeEl = h('div', 'aur-layer aur-notices', this.zone.el, this.toasts.el);
    this.worldEl.style.display = 'none';
    this.panelEl.style.display = 'none';
    this.playerEl.style.display = 'none';
    this.edgeEl.style.display = 'none';

    this.panelOpacity = new Num((v) => {
      const o = v.toFixed(2);
      this.panelEl.style.opacity = o;
      this.worldEl.style.opacity = o;
      const d = v <= 0.001 ? 'none' : 'block';
      this.panelEl.style.display = d;
      this.worldEl.style.display = d;
    }, 0.01);
    this.playerOpacity = new Num((v) => {
      this.playerEl.style.opacity = v.toFixed(2);
      this.playerEl.style.display = v <= 0.001 ? 'none' : 'block';
    }, 0.01);
    this.edgeOpacity = new Num((v) => {
      this.edgeEl.style.opacity = v.toFixed(2);
      this.edgeEl.style.display = v <= 0.005 ? 'none' : 'block';
    }, 0.01);

    this.frame = { game, state: null, dt: 0, now: 0, w: 1280, h: 720, u: 0.75, reduceFlash: false };

    game.events.on('player:protagonist', (e) => this.setProtagonist(e.id));
    try {
      globalThis.addEventListener?.('resize', () => { this.viewDirty = true; });
    } catch {
      /* headless */
    }
  }

  private setProtagonist(id: ProtagonistId): void {
    const p: ProtagonistId = id === 'selene' ? 'selene' : 'tarrik';
    if (p === this.protagonist) return;
    const first = this.protagonist === '';
    this.protagonist = p;
    this.root.dataset.prot = p;
    if (!first) this.swap = 1;
  }

  // --- pass-throughs -----------------------------------------------------------------------------------
  objective(text: string | null): void { this.objectiveW.set(text); }
  marker(id: string, pos: Vec3Like | null, opts?: WorldMarkerOpts): void { this.world.marker(id, pos, opts); }
  clearMarkers(): void { this.world.clearMarkers(); }
  prompt(p: PromptSpec | null): void { this.promptW.set(p); }
  toast(text: string, kind?: ToastKind): void { this.toasts.push(text, kind); }
  zoneCard(title: string, subtitle?: string): void { this.zone.show(title, subtitle); }
  hint(v: { text: string; glyph?: string; seconds?: number } | null): void { this.hintW.set(v); }
  readout(r: { label: string; value: string; tone?: ReadoutTone } | null): void { this.readoutW.set(r); }
  eliteBar(e: EliteState | null): void { this.elite.set(e); }
  damageDirection(angle: number, strength?: number): void { this.reticle.damageDirection(angle, strength); }
  hitMarker(kind?: HitKind): void { this.reticle.hitMarker(kind); }
  focusActor(actor: Actor | null): void { this.world.focusActor(actor); }

  /** the context action on offer (with its widened window), read even while the rest of the HUD is hidden */
  private readContext(s: PlayerHudState | null): ContextAction | null {
    const st = s ?? this.readState();
    return st?.context ?? null;
  }

  private readState(): PlayerHudState | null {
    const player = this.game.player;
    if (isStub(player)) return null;
    try {
      const s = player.getHudState();
      if (!s || isStub(s) || typeof s.maxHp !== 'number') return null;
      return s;
    } catch (err) {
      warnOnce('hudstate', `getHudState() threw: ${String(err)}`);
      return null;
    }
  }

  /**
   * @param on effective HUD visibility (requested visibility and no covering screen)
   * @param notices false while a full-screen menu is up (toasts / zone card wait underneath, unseen)
   * @param prompts false while a screen or a choice panel covers play: the context prompt (which otherwise shows
   *   with or without the HUD — scripted beats inside scenes) waits
   */
  update(dt: number, on: boolean, notices = true, prompts = notices): void {
    if (notices !== this.noticesOn) {
      this.noticesOn = notices;
      this.noticeEl.style.visibility = notices ? 'visible' : 'hidden';
    }
    if (this.viewDirty) {
      this.viewDirty = false;
      measureViewport(this.root, this.view);
    }
    const f = this.frame;
    f.dt = dt;
    f.now = num(this.game.time.now);
    f.w = this.view.w;
    f.h = this.view.h;
    f.u = this.view.u;
    f.reduceFlash = this.game.settings.get('reduceFlash') === true;
    f.state = on || this.vis > 0 ? this.readState() : null;
    const s = f.state;
    if (s) this.setProtagonist(s.protagonist);

    // visibility envelopes
    const want = on ? 1 : 0;
    this.vis += Math.sign(want - this.vis) * Math.min(Math.abs(want - this.vis), dt * (on ? 2.6 : 4));
    this.panelOpacity.set(this.vis);
    const wantPlayer = s ? 1 : 0;
    this.playerVis += Math.sign(wantPlayer - this.playerVis) * Math.min(Math.abs(wantPlayer - this.playerVis), dt * 4);
    if (this.swap > 0) this.swap = Math.max(0, this.swap - dt * 2.2);
    this.playerOpacity.set(this.playerVis * (1 - this.swap * this.swap));
    const sw = Math.round(this.swap * 50) / 50;
    if (sw !== this.lastSwap) {
      this.lastSwap = sw;
      this.playerEl.style.setProperty('--k', reducedMotion() ? '0' : String(sw));
    }

    // notices keep running under cinematics
    this.zone.update(dt);
    this.toasts.update(dt);
    this.diagnostics.update(dt);

    // envelopes keep running while hidden (they are idle-cheap) so nothing "ghosts" back in after a cinematic
    this.objectiveW.update(dt);
    this.readoutW.update(dt);
    this.elite.update(f);
    this.hintW.update(dt);
    this.promptW.update(dt);
    this.reticle.update(f);
    this.ctx.update(f, prompts ? this.readContext(s) : null);
    this.world.update(f, on);
    if (this.vis <= 0) {
      this.edgeOpacity.set(0);
      return;
    }
    if (s) {
      this.vitals.update(f);
      this.arsenal.update(f);
    }

    // low-health edge: grows below 35 % hp; slow breathing unless flashes are reduced
    let edge = 0;
    if (s && on) {
      const frac = clamp01(num(s.hp) / Math.max(1, num(s.maxHp, 1)));
      if (frac > 0 && frac < 0.35) edge = 0.35 + ((0.35 - frac) / 0.35) * 0.65;
    }
    this.edge += (edge - this.edge) * Math.min(1, dt * 4);
    let breathe = 1;
    if (this.edge > 0.01 && !f.reduceFlash && !reducedMotion()) {
      this.edgePhase = (this.edgePhase + dt * 0.75) % 1;
      breathe = 0.82 + 0.18 * Math.sin(this.edgePhase * Math.PI * 2);
    }
    this.edgeOpacity.set(this.edge * breathe * this.vis);
  }
}
