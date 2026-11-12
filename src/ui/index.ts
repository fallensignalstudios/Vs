/**
 * AURELION UI system — HTML/CSS overlay above the canvas: HUD, menus, subtitles, choice, accessibility.
 * Everything is mounted inside `game.uiRoot`; only interactive screens enable pointer events.
 *
 * Timing is driven exclusively by `update(dt)` (deterministic under headless stepping); the DOM is only
 * touched when a value changes.
 */
// Cinzel 700 for single-letter key caps (Q / O / I must not read as 0 / 1 at prompt size)
import '@fontsource/cinzel/latin-700.css';
import './styles/base.css';
import './styles/hud-player.css';
import './styles/hud-centre.css';
import './styles/hud-world.css';
import './styles/hud-info.css';
import './styles/narrative.css';
import './styles/menus.css';
import './styles/settings.css';
import './styles/screens.css';

import type {
  Actor, CaptionKind, ChoiceHandle, ChoiceOpts, DialogueLine, Game, MissionSummary, TitleOpts, UiSystem, Vec3Like,
  WorldMarkerOpts, WorldTextOpts,
} from '@/core/api';
import { reportError } from '@/core/events';
import { h } from './dom';
import { Hud } from './hud';
import { measureViewport, type Viewport } from './hud/frame';
import { subtitleSeconds, type HitKind } from './logic';
import { MenuInput, ModalStack } from './menu';
import { StatusBoard, type BoardOpts, type BoardRow } from './narrative/board';
import { ChoicePanel } from './narrative/choice';
import { Card, FlashText, Letterbox, ScreenFade, SkipHint, type CardStyle, type FadeColor, type ScreenBox } from './narrative/stage';
import { Subtitles } from './narrative/subtitles';
import { WorldText } from './narrative/worldtext';
import { CompleteScreen, DeathScreen, LoadingScreen, type LoadingOpts } from './screens/overlays';
import { PauseScreen, type PauseOpts } from './screens/pause';
import { SettingsScreen } from './screens/settings';
import { TitleScreen } from './screens/title';
import { artUrl } from './theme';

const FONT_FACES = [
  '400 16px Cinzel', '600 16px Cinzel', '700 16px Cinzel', '400 16px Barlow', '500 16px Barlow', '600 16px Barlow',
  '500 16px "Barlow Condensed"', '600 16px "Barlow Condensed"',
];

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    } catch {
      resolve();
    }
  });
}

class UiSystemImpl implements UiSystem {
  private readonly root: HTMLElement;
  private readonly menu: MenuInput;
  private readonly stack: ModalStack;
  private readonly hud: Hud;
  private readonly letterboxW: Letterbox;
  private readonly fadeW: ScreenFade;
  private readonly cardW: Card;
  private readonly flashW: FlashText;
  private readonly board: StatusBoard;
  private readonly talk: Subtitles;
  private readonly skip: SkipHint;
  private readonly choiceW: ChoicePanel;
  private readonly wtext: WorldText;
  private readonly view: Viewport = { w: 1280, h: 720, u: 1 };
  private readonly cardBox: ScreenBox = { l: 0, t: 0, r: 0, b: 0 };
  private readonly loading: LoadingScreen;
  private readonly death: DeathScreen;
  private readonly complete: CompleteScreen;
  private readonly title: TitleScreen;
  private readonly pause: PauseScreen;
  private readonly settings: SettingsScreen;

  private hudWanted = true;
  /** screenshot mode (debug `hud(false)`): HUD, notices, subtitles, captions, prompts and skip hint hidden */
  private clean = false;
  /** the title flow hid the HUD; give it back when the title closes */
  private hudBorrowedByTitle = false;
  private objectiveText: string | null = null;
  private readonly failed = new Set<string>();

  constructor(game: Game) {
    this.root = h('div', 'aur');
    this.root.setAttribute('aria-label', 'Game interface');
    this.root.dataset.prot = 'tarrik';
    this.menu = new MenuInput(game);
    this.stack = new ModalStack(game, this.menu);

    this.hud = new Hud(game, this.root);
    this.letterboxW = new Letterbox();
    this.fadeW = new ScreenFade();
    this.cardW = new Card();
    this.flashW = new FlashText(game);
    this.board = new StatusBoard();
    this.talk = new Subtitles(game);
    this.skip = new SkipHint(game);
    this.choiceW = new ChoicePanel(game, this.menu, this.stack);
    this.wtext = new WorldText(game);
    this.loading = new LoadingScreen();
    this.death = new DeathScreen(game, this.menu, this.stack);
    this.complete = new CompleteScreen(game, this.menu, this.stack);
    this.settings = new SettingsScreen(game, this.menu, this.stack);
    const openSettings = (tab: Parameters<SettingsScreen['show']>[0], onClose: () => void): void => this.settings.show(tab, onClose);
    this.title = new TitleScreen(game, this.menu, this.stack, openSettings);
    this.pause = new PauseScreen(game, this.menu, this.stack, openSettings, () => this.objectiveText);

    // paint order, bottom → top
    this.root.append(
      this.hud.worldEl, this.wtext.el, this.hud.edgeEl, this.hud.panelEl, this.hud.noticeEl,
      this.letterboxW.el, this.fadeW.el, this.cardW.el, this.flashW.el, this.board.el, this.hud.ctxEl, this.talk.el, this.skip.el,
      this.choiceW.el, this.loading.el, this.death.el, this.complete.el, this.title.el, this.pause.el, this.settings.el,
      this.hud.diagnostics.fpsEl, this.hud.diagnostics.debugEl,
    );
    game.uiRoot.appendChild(this.root);

    game.events.on('objective:changed', (e) => this.objective(e?.text ?? null));
    // a new zone (also a debug goto) never inherits world-bound UI or narrative staging from the previous one
    game.events.on('zone:loading', () => {
      this.clearWorldHud();
      this.clearNarrative();
    });
  }

  /**
   * Narrative staging that belongs to the scene that set it: the card (and one waiting to cross-fade in), the
   * one-flash text, the status board, captions, the subtitle and the skip hint. Letterbox and fade stay: the
   * mission system owns them across a load.
   */
  private clearNarrative(): void {
    this.cardW.clear();
    this.flashW.show(null);
    this.board.clear();
    this.talk.show(null);
    this.talk.clearCaptions();
    this.skip.set(false);
  }

  async init(): Promise<void> {
    const tasks: Array<Promise<unknown>> = [preloadImage(artUrl('wound-overlook'))];
    try {
      const fonts = document.fonts;
      if (fonts && typeof fonts.load === 'function') for (const f of FONT_FACES) tasks.push(fonts.load(f));
    } catch {
      /* font loading API unavailable */
    }
    // never let a slow font or image hold the boot hostage
    await Promise.race([Promise.allSettled(tasks), new Promise<void>((resolve) => setTimeout(resolve, 2500))]);
  }

  clearWorldHud(): void {
    this.hud.clearMarkers();
    this.hud.prompt(null);
    this.hud.hint(null);
    this.hud.eliteBar(null);
    this.hud.readout(null);
    this.hud.focusActor(null);
    this.wtext.clear();
    if (this.choiceW.open) this.choiceW.dismiss();
  }

  // ------------------------------------------------------------------------------------------ screens
  showTitle(opts: TitleOpts): void {
    if (!opts) return;
    if (!this.hudWanted) this.hudBorrowedByTitle = true;
    this.pause.hide();
    this.death.hide();
    this.complete.hide();
    this.settings.hide();
    // a session that ended mid-scene must not leak its staging into the next one
    this.clearWorldHud();
    this.objective(null);
    this.talk.show(null);
    this.cardW.set(null);
    this.flashW.show(null);
    this.board.set(null);
    this.skip.set(false);
    this.letterbox(false, 0);
    this.fadeW.fade(0, 0);
    this.title.show(opts);
  }

  hideTitle(): void {
    this.settings.hide();
    this.title.hide();
    if (this.hudBorrowedByTitle) {
      this.hudBorrowedByTitle = false;
      this.hudWanted = true;
    }
  }

  showPause(opts: PauseOpts): void {
    if (!opts) return;
    this.pause.show(opts);
  }

  hidePause(): void {
    this.settings.hide();
    this.pause.hide();
  }

  showDeath(opts: { onRetry(): void }): void {
    this.death.show(opts);
  }

  hideDeath(): void {
    this.death.hide();
  }

  showLoading(show: boolean, opts?: LoadingOpts): void {
    this.loading.set(show === true, opts ?? {});
  }

  showMissionComplete(summary: MissionSummary, opts: { onTitle(): void }): void {
    this.complete.show(summary, opts);
  }

  // ------------------------------------------------------------------------------------------ HUD
  setHudVisible(visible: boolean): void {
    this.hudWanted = visible === true;
    this.hudBorrowedByTitle = false;
  }

  get hudVisible(): boolean {
    return this.hudWanted;
  }

  setCleanFrame(on: boolean): void {
    this.clean = on === true;
  }

  get cleanFrame(): boolean {
    return this.clean;
  }

  objective(text: string | null): void {
    this.objectiveText = typeof text === 'string' && text.trim() ? text.trim() : null;
    this.hud.objective(this.objectiveText);
  }

  marker(id: string, pos: Vec3Like | null, opts?: WorldMarkerOpts): void {
    this.hud.marker(id, pos, opts);
  }

  prompt(p: { text: string; glyph: string; progress?: number; hold?: boolean } | null): void {
    this.hud.prompt(p);
  }

  toast(text: string, kind?: 'checkpoint' | 'info' | 'echo' | 'record' | 'warning'): void {
    this.hud.toast(text, kind);
  }

  zoneCard(title: string, subtitle?: string): void {
    this.hud.zoneCard(title, subtitle);
  }

  hint(v: { text: string; glyph?: string; seconds?: number } | null): void {
    this.hud.hint(v);
  }

  readout(r: { label: string; value: string; tone?: 'amber' | 'cold' | 'gold' | 'violet' } | null): void {
    this.hud.readout(r);
  }

  eliteBar(e: { name: string; hp: number; maxHp: number; regenerating: boolean; exposed: boolean } | null): void {
    this.hud.eliteBar(e);
  }

  damageDirection(angle: number, strength?: number): void {
    this.hud.damageDirection(angle, strength);
  }

  hitMarker(kind?: HitKind): void {
    this.hud.hitMarker(kind);
  }

  focusActor(actor: Actor | null): void {
    this.hud.focusActor(actor);
  }

  // ------------------------------------------------------------------------------------------ narrative
  subtitle(line: DialogueLine | null): void {
    this.talk.show(line);
  }

  estimateSubtitleSeconds(text: string): number {
    return subtitleSeconds(String(text ?? ''));
  }

  caption(text: string, kind: CaptionKind, bearing?: number): void {
    this.talk.caption(text, kind, bearing);
  }

  letterbox(on: boolean, seconds?: number): void {
    this.letterboxW.set(on === true, seconds);
    this.talk.setLetterboxed(on === true);
  }

  fade(level: number, seconds?: number, color?: FadeColor): void {
    this.fadeW.fade(level, seconds, color);
  }

  get fadeLevel(): number {
    return this.fadeW.level;
  }

  skipHint(show: boolean, progress?: number): void {
    this.skip.set(show === true, progress);
  }

  card(text: string | null, opts?: { sub?: string; seconds?: number; style?: CardStyle }): void {
    if (opts?.style === 'flash') {
      this.flashW.show(text, opts.seconds);
      return;
    }
    this.cardW.set(text, opts as Parameters<Card['set']>[1]);
  }

  choice(opts: ChoiceOpts): ChoiceHandle {
    return this.choiceW.present(opts);
  }

  statusBoard(rows: BoardRow[] | null, opts?: BoardOpts): void {
    this.board.set(rows, opts);
  }

  worldText(id: string, opts: WorldTextOpts | null): void {
    this.wtext.set(id, opts ?? null);
  }

  get modalOpen(): boolean {
    return this.stack.open;
  }

  debugText(text: string | null): void {
    this.hud.diagnostics.debugText(text);
  }

  // ------------------------------------------------------------------------------------------ update
  /** isolate widget groups: one failing group reports once and never blocks the others */
  private run(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      if (!this.failed.has(name)) {
        this.failed.add(name);
        reportError(`ui:${name}`, err);
      }
    }
  }

  update(dt: number): void {
    const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    this.run('menus', () => {
      this.stack.update();
      this.title.update(d);
      this.pause.update(d);
      this.settings.update(d);
      this.death.update(d);
      this.complete.update(d);
      this.loading.update(d);
      this.choiceW.update(d);
    });
    const screen = this.title.covering || this.loading.covering || this.complete.covering || this.death.shown || this.pause.shown;
    this.run('hud', () => {
      const clean = this.clean;
      this.hud.update(d, this.hudWanted && !screen && !this.choiceW.open && !clean, !screen && !clean, !screen && !this.choiceW.open && !clean);
      this.talk.setCovered(this.death.shown || this.pause.shown || clean);
      this.skip.setCovered(clean);
      // (fix & ship) the narrative card, the one-flash text and the status board never show through a screen
      this.cardW.setCovered(clean, screen);
      const scr = screen ? '1' : '0';
      if (this.root.dataset.screen !== scr) this.root.dataset.screen = scr;
    });
    this.run('narrative', () => {
      // world text is part of the scene: only the full-screen screens cover it (not the HUD switch, not a clean frame);
      // (fix & ship) a label never sits under a narrative card that is up: it fades until the card has gone
      if (this.wtext.size > 0) {
        measureViewport(this.root, this.view);
        const avoid = this.cardW.avoidBox(this.root, this.view.w, this.view.h, this.view.u, this.cardBox);
        this.wtext.update(d, this.view.w, this.view.h, screen, avoid);
      }
      this.letterboxW.update(d);
      this.fadeW.update(d);
      this.cardW.update(d);
      this.flashW.update(d);
      this.board.update(d);
      this.talk.update(d);
      this.skip.update(d);
    });
  }
}

/** Factory used by Game (contract construction order: after audio, before chars). */
export function createUiSystem(game: Game): UiSystem {
  return new UiSystemImpl(game);
}
