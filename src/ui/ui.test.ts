import { beforeEach, describe, expect, it } from 'vitest';
import type { ButtonAction, Game, GameEvents, InputContext, PlayerHudState, UiSystem } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { FakeElement, installFakeDom } from './fake-dom';
import { createUiSystem } from './index';

interface Rig {
  game: Game;
  ui: UiSystem;
  root: FakeElement;
  press(...a: ButtonAction[]): void;
  step(seconds: number): void;
  context(): InputContext;
  hud: PlayerHudState;
  log: string[];
}

function hudState(): PlayerHudState {
  return {
    protagonist: 'tarrik', name: 'Tarrik', hp: 140, maxHp: 140, poise: 60, maxPoise: 60, echo: 40, echoMax: 100,
    ammo: 6, magSize: 6, reserve: 18, reloading: false, meleeName: 'Velkorran', rangedName: 'Cinderline',
    abilities: [
      { id: 'cinderSlam', name: 'Cinder Slam', cost: 35, cooldown: 8, cooldownLeft: 0, ready: true },
      { id: 'cinderSticky', name: 'Sticky Grenade', cost: 30, cooldown: 10, cooldownLeft: 0, ready: true },
    ],
    aiming: false, guarding: false, lockTarget: null, context: null, threat: 0,
  };
}

function rig(opts: { stubInput?: boolean; stubPlayer?: boolean } = {}): Rig {
  const root = installFakeDom();
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  const pressed = new Set<ButtonAction>();
  const log: string[] = [];
  let ctx: InputContext = 'game';
  const hud = hudState();
  const input = {
    device: 'kbm' as const,
    get context() { return ctx; },
    pressed: (a: ButtonAction) => pressed.has(a),
    consume: (a: ButtonAction) => { pressed.delete(a); },
    glyph: (a: ButtonAction) => a.toUpperCase().slice(0, 3),
    setContext: (c: InputContext) => { ctx = c; log.push(`ctx:${c}`); },
    exitPointerLock: () => { log.push('unlock'); },
    requestPointerLock: () => { log.push('lock'); },
  };
  const time = { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} };
  const game = {
    events, settings, time, uiRoot: root, paused: false, phase: 'playing',
    input: opts.stubInput ? nullObject('input') : input,
    player: opts.stubPlayer ? nullObject('player') : { actor: { id: 1, pos: { x: 0, y: 0, z: 0 }, team: 'player' }, getHudState: () => hud },
    camera: nullObject('camera'), actors: nullObject('actors'), audio: nullObject('audio'), mission: nullObject('mission'),
    render: nullObject('render'),
  } as unknown as Game;
  const ui = createUiSystem(game);
  return {
    game, ui, root, hud, log,
    press: (...a) => { for (const x of a) pressed.add(x); },
    step: (seconds) => {
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) {
        time.now += 1 / 60;
        ui.update(1 / 60);
        pressed.clear();
      }
    },
    context: () => ctx,
  };
}

const errors = (): string[] => ((globalThis as unknown as { __aurelionErrors?: string[] }).__aurelionErrors ?? []);

beforeEach(() => {
  (globalThis as unknown as { __aurelionErrors?: string[] }).__aurelionErrors = [];
});

describe('UiSystem construction', () => {
  it('mounts inside uiRoot and survives fully stubbed neighbours', () => {
    const r = rig({ stubInput: true, stubPlayer: true });
    expect(r.root.children.length).toBe(1);
    expect(r.root.children[0]!.classList.contains('aur')).toBe(true);
    r.step(0.5);
    expect(r.ui.modalOpen).toBe(false);
    expect(errors()).toEqual([]);
  });
});

describe('fade', () => {
  it('reports an accurate level while animating and lands exactly', () => {
    const r = rig();
    expect(r.ui.fadeLevel).toBe(0);
    r.ui.fade(1, 1, 'black');
    r.step(0.5);
    expect(r.ui.fadeLevel).toBeGreaterThan(0.45);
    expect(r.ui.fadeLevel).toBeLessThan(0.55);
    r.step(0.6);
    expect(r.ui.fadeLevel).toBe(1);
    r.ui.fade(0, 0);
    expect(r.ui.fadeLevel).toBe(0);
  });
  it('clamps junk input and unknown colours', () => {
    const r = rig();
    r.ui.fade(7, 0, 'chartreuse' as never);
    expect(r.ui.fadeLevel).toBe(1);
    r.ui.fade(Number.NaN, 0);
    expect(r.ui.fadeLevel).toBe(0);
  });
});

describe('choice', () => {
  const opts = {
    id: 'rescuePriority', title: 'Local priority', prompt: 'Where do I stand?',
    options: [
      { id: 'WestStretchers', label: 'Stretcher cases first', detail: 'd', tag: 'West' },
      { id: 'EastWalkers', label: 'Walking wounded first', detail: 'd', tag: 'East' },
    ],
  };

  it('requires select, then an explicit confirm, and is modal until then', () => {
    const r = rig();
    const h = r.ui.choice(opts);
    expect(r.ui.modalOpen).toBe(true);
    expect(r.context()).toBe('menu');
    r.step(1);
    r.press('menuRight');
    r.step(0.1);
    r.press('confirm'); // select East
    r.step(0.05);
    expect(h.selected).toBeNull();
    r.press('confirm'); // too early: the commit is still arming
    r.step(0.05);
    expect(h.selected).toBeNull();
    r.step(0.6);
    r.press('confirm');
    r.step(0.05);
    expect(h.selected).toBe('EastWalkers');
    expect(r.ui.modalOpen).toBe(false);
    expect(r.context()).toBe('game');
  });

  it('ignores the press that opened the panel', () => {
    const r = rig();
    const h = r.ui.choice(opts);
    r.press('confirm'); // same tick as the interaction that opened it
    r.step(0.1);
    r.step(1);
    r.press('confirm'); // this one selects (West), still nothing committed
    r.step(1);
    expect(h.selected).toBeNull();
    r.press('cancel');
    r.step(0.1);
    r.press('menuRight');
    r.step(0.1);
    r.press('confirm');
    r.step(1);
    r.press('confirm');
    r.step(0.1);
    // had the opening press selected West, cancel+right+confirm+confirm would still commit East — so also check
    // that a single early press never arms: one confirm after opening must not be enough to commit
    expect(h.selected).toBe('EastWalkers');
    const r2 = rig();
    const h2 = r2.ui.choice(opts);
    r2.press('confirm');
    r2.step(1.2);
    r2.press('confirm'); // if the opening press had armed West, this would commit it
    r2.step(0.1);
    expect(h2.selected).toBeNull();
  });

  it('never commits by waiting (untimed)', () => {
    const r = rig();
    const h = r.ui.choice(opts);
    r.step(120);
    expect(h.selected).toBeNull();
    expect(r.ui.modalOpen).toBe(true);
  });

  it('cancel after selecting returns to browsing', () => {
    const r = rig();
    const h = r.ui.choice(opts);
    r.step(0.5);
    r.press('confirm');
    r.step(1);
    r.press('cancel');
    r.step(0.2);
    r.press('menuRight');
    r.step(0.1);
    r.press('confirm');
    r.step(1);
    r.press('confirm');
    r.step(0.1);
    expect(h.selected).toBe('EastWalkers');
  });

  it('supports programmatic selection and ignores unknown ids', () => {
    const r = rig();
    const h = r.ui.choice(opts);
    h.select('Nowhere');
    expect(h.selected).toBeNull();
    h.select('WestStretchers');
    expect(h.selected).toBe('WestStretchers');
    h.select('EastWalkers');
    expect(h.selected).toBe('WestStretchers');
    expect(r.ui.modalOpen).toBe(false);
  });

  it('tolerates an empty option list', () => {
    const r = rig();
    const h = r.ui.choice({ id: 'x', title: 't', prompt: 'p', options: [] });
    expect(h.selected).toBeNull();
    expect(r.ui.modalOpen).toBe(false);
  });
});

describe('menus', () => {
  it('title: New Game → difficulty → callback; Continue only with a save', () => {
    const r = rig();
    const got: string[] = [];
    r.ui.showTitle({ canContinue: false, onNewGame: (d) => got.push(d), onContinue: () => got.push('continue') });
    expect(r.ui.modalOpen).toBe(true);
    r.step(1);
    r.press('confirm'); // New Game
    r.step(0.2);
    r.press('menuDown'); // standard → hard
    r.step(0.1);
    r.press('confirm');
    r.step(0.1);
    expect(got).toEqual(['hard']);
    r.ui.hideTitle();
    expect(r.ui.modalOpen).toBe(false);
  });

  it('title: a truthy stub is not a save', () => {
    const r = rig();
    const got: string[] = [];
    r.ui.showTitle({ canContinue: nullObject<boolean>('hasSave'), onNewGame: () => got.push('new'), onContinue: () => got.push('continue') });
    r.step(0.5);
    r.press('confirm');
    r.step(0.1);
    expect(got).toEqual([]); // first entry is New Game (opens the difficulty list), not Continue
  });

  it('pause: Esc resumes and the press is consumed', () => {
    const r = rig();
    let resumed = 0;
    r.ui.showPause({ onResume: () => { resumed++; r.ui.hidePause(); }, onRestartCheckpoint() {}, onQuitToTitle() {} });
    r.step(0.5);
    r.press('pause', 'cancel');
    r.step(1 / 60);
    expect(resumed).toBe(1);
    expect(r.ui.modalOpen).toBe(false);
  });

  it('pause: destructive entries ask first and default to Cancel', () => {
    const r = rig();
    let restarted = 0;
    r.ui.showPause({ onResume() {}, onRestartCheckpoint: () => { restarted++; }, onQuitToTitle() {} });
    r.step(0.3);
    r.press('menuDown');
    r.step(0.1);
    r.press('confirm'); // opens the confirmation
    r.step(0.1);
    r.press('confirm'); // Cancel is focused
    r.step(0.1);
    expect(restarted).toBe(0);
    r.press('confirm'); // back on "Restart from checkpoint"
    r.step(0.1);
    r.press('menuDown');
    r.step(0.1);
    r.press('confirm');
    r.step(0.1);
    expect(restarted).toBe(1);
  });

  it('settings: controls write game.settings live', () => {
    const r = rig();
    r.ui.showPause({ onResume() {}, onRestartCheckpoint() {}, onQuitToTitle() {} });
    r.step(0.3);
    r.press('menuDown'); r.step(0.05);
    r.press('menuDown'); r.step(0.05);
    r.press('confirm'); r.step(0.3); // Settings (Graphics category focused)
    r.press('confirm'); r.step(0.1); // enter rows: Quality
    expect(r.game.settings.get('quality')).toBe('auto');
    r.press('menuRight'); r.step(0.05);
    expect(r.game.settings.get('quality')).toBe('low');
    r.press('menuDown'); r.step(0.05);
    r.press('confirm'); r.step(0.05); // dynamic resolution toggles off
    expect(r.game.settings.get('dynamicResolution')).toBe(false);
    r.press('cancel'); r.step(0.05); // back to categories
    r.press('menuDown'); r.step(0.05); // Audio
    r.press('menuRight'); r.step(0.05); // enter rows: master volume
    r.press('menuLeft'); r.step(0.05);
    expect(r.game.settings.get('masterVolume')).toBeCloseTo(0.75);
    r.press('cancel'); r.step(0.05);
    r.press('cancel'); r.step(0.3); // closes settings, pause still open
    expect(r.ui.modalOpen).toBe(true);
    r.ui.hidePause();
    expect(r.ui.modalOpen).toBe(false);
  });

  it('death: retry only after the input delay', () => {
    const r = rig();
    let retried = 0;
    r.ui.showDeath({ onRetry: () => { retried++; r.ui.hideDeath(); } });
    expect(r.context()).toBe('menu');
    r.press('confirm');
    r.step(0.1);
    expect(retried).toBe(0);
    r.step(1.2);
    r.press('confirm');
    r.step(0.1);
    expect(retried).toBe(1);
    expect(r.context()).toBe('game');
  });

  it('works with a stub input system (keyboard fallback path)', () => {
    const r = rig({ stubInput: true });
    r.ui.showPause({ onResume() {}, onRestartCheckpoint() {}, onQuitToTitle() {} });
    r.step(0.5);
    expect(r.ui.modalOpen).toBe(true);
    r.ui.hidePause();
    expect(r.ui.modalOpen).toBe(false);
  });
});

describe('HUD visibility borrowing', () => {
  it('gives the HUD back when the title that hid it closes', () => {
    const r = rig();
    r.ui.setHudVisible(false);
    r.ui.showTitle({ canContinue: false, onNewGame() {}, onContinue() {} });
    r.step(0.2);
    r.ui.hideTitle();
    r.step(2);
    const panel = r.root.find('aur-hud')!;
    expect(panel.style.display).toBe('block');
  });
  it('respects an explicit hide (cinematics)', () => {
    const r = rig();
    r.step(1);
    r.ui.setHudVisible(false);
    r.step(1);
    expect(r.root.find('aur-hud')!.style.display).toBe('none');
  });
});

describe('added API members', () => {
  it('hudVisible mirrors the request, clearWorldHud drops world-bound state', () => {
    const r = rig();
    expect(r.ui.hudVisible).toBe(true);
    r.ui.setHudVisible(false);
    expect(r.ui.hudVisible).toBe(false);
    r.ui.setHudVisible(true);
    r.ui.readout({ label: 'Carrier impact', value: '1:31' });
    r.ui.hint({ text: 'Hold to guard' });
    r.step(1);
    expect(r.root.find('aur-readout')!.style.display).toBe('block');
    r.ui.clearWorldHud();
    r.step(1);
    expect(r.root.find('aur-readout')!.style.display).toBe('none');
    expect(r.root.find('aur-hint')!.style.display).toBe('none');
  });
  it('estimates subtitle time like the subtitle layer does', () => {
    const r = rig();
    expect(r.ui.estimateSubtitleSeconds('Hold.')).toBeCloseTo(2.2);
    expect(r.ui.estimateSubtitleSeconds('one two three four five six seven eight nine ten')).toBeCloseTo(4.7);
  });
});

describe('narrative widgets', () => {
  it('subtitle dedupes event + direct call and clears', () => {
    const r = rig();
    const line = { speaker: 'Lyessa', text: 'Three lanes. They are not guessing.', offscreen: true };
    r.ui.subtitle(line);
    r.game.events.emit('dialogue:line', { line });
    r.step(0.3);
    const sub = r.root.find('aur-sub')!;
    expect(sub.style.display).toBe('block');
    expect(sub.dataset.faction).toBe('dominion');
    expect(sub.classList.contains('is-off')).toBe(true);
    expect(r.root.find('aur-sub-tagtext')!.textContent).toBe('off-screen ▸');
    r.game.events.emit('dialogue:clear', {});
    r.step(0.5);
    expect(sub.style.display).toBe('none');
  });

  it('a subtitle nobody clears expires by itself', () => {
    const r = rig();
    r.ui.subtitle({ speaker: 'Tarrik', text: 'Hold.', duration: 1 });
    r.step(0.5);
    expect(r.root.find('aur-sub')!.style.display).toBe('block');
    r.step(4);
    expect(r.root.find('aur-sub')!.style.display).toBe('none');
  });

  it('subtitles and captions honour their settings', () => {
    const r = rig();
    r.game.settings.set('subtitles', false);
    r.game.settings.set('captions', false);
    r.ui.subtitle({ speaker: 'Tarrik', text: 'Hold.' });
    r.ui.caption('Scan sweep', 'scan', 1);
    r.step(0.3);
    expect(r.root.find('aur-sub')!.style.display).toBe('none');
    expect(r.root.findAll('aur-cap').every((c) => c.style.display === 'none')).toBe(true);
    r.game.settings.set('subtitles', true);
    r.step(0.3);
    expect(r.root.find('aur-sub')!.style.display).toBe('block');
  });

  it('status board reveals rows one by one and keeps revealed rows on re-call', () => {
    const r = rig();
    const rows = [{ label: 'Boundary', value: 'Closed', tone: 'ok' as const }, { label: 'Release', value: 'Withheld', tone: 'ok' as const }];
    r.ui.statusBoard(rows.slice(0, 1));
    r.step(1.5);
    let els = r.root.findAll('aur-board-row');
    expect(els.length).toBe(1);
    expect(els[0]!.style.visibility).toBe('visible');
    r.ui.statusBoard(rows);
    r.step(0.2);
    els = r.root.findAll('aur-board-row');
    expect(els[0]!.style.visibility).toBe('visible');
    expect(els[1]!.style.visibility).toBe('hidden');
    r.step(1.2);
    expect(els[1]!.style.visibility).toBe('visible');
    r.ui.statusBoard(null);
    r.step(1.5);
    expect(r.root.find('aur-board')!.style.display).toBe('none');
  });

  it('cards auto-hide after their duration and cross-fade', () => {
    const r = rig();
    r.ui.card('One', { seconds: 1, style: 'context' });
    r.step(0.5);
    const card = r.root.find('aur-card')!;
    expect(card.style.display).toBe('flex');
    r.ui.card('Two', { style: 'witness' });
    r.step(2);
    expect(r.root.find('aur-card-text')!.textContent).toBe('Two');
    expect(card.dataset.style).toBe('witness');
    r.ui.card(null);
    r.step(1.5);
    expect(card.style.display).toBe('none');
  });

  it('toasts dedupe the checkpoint event against a direct call', () => {
    const r = rig();
    r.ui.toast('Checkpoint saved', 'checkpoint');
    r.game.events.emit('checkpoint:saved', { id: 'CP1' });
    r.step(0.2);
    const shown = r.root.findAll('aur-toast').filter((t) => t.style.display === 'flex');
    expect(shown.length).toBe(1);
  });
});

describe('bad input never throws', () => {
  it('accepts junk on every public method', () => {
    const r = rig();
    const ui = r.ui as unknown as Record<string, (...a: unknown[]) => unknown>;
    const junk: unknown[] = [undefined, null, Number.NaN, 'x', {}, [], -1, nullObject('junk')];
    const methods = [
      'showTitle', 'hideTitle', 'showPause', 'hidePause', 'showDeath', 'hideDeath', 'showLoading', 'showMissionComplete',
      'setHudVisible', 'objective', 'marker', 'prompt', 'toast', 'zoneCard', 'hint', 'readout', 'eliteBar',
      'damageDirection', 'hitMarker', 'focusActor', 'subtitle', 'caption', 'letterbox', 'fade', 'skipHint', 'card',
      'choice', 'statusBoard', 'debugText', 'update',
    ];
    for (const m of methods) {
      for (const a of junk) {
        for (const b of junk) {
          expect(() => ui[m]!.call(r.ui, a, b, a)).not.toThrow();
        }
      }
      r.step(0.05);
    }
    r.ui.hideTitle();
    r.ui.hidePause();
    r.ui.hideDeath();
    r.step(1);
    expect(errors()).toEqual([]);
  });

  it('runs a busy HUD frame with real-looking state', () => {
    const r = rig();
    r.hud.hp = 20;
    r.hud.threat = 0.9;
    r.hud.reloading = true;
    r.hud.context = { id: 'c', prompt: 'Thermal Fracture', button: 'heavy', window: 2, onConfirm() {} };
    r.ui.objective('Sever the links');
    r.ui.objective('Arrest the joint');
    r.ui.marker('a', { x: 1, y: 2, z: 3 }, { kind: 'objective', label: 'x' });
    r.ui.marker('a', null);
    r.ui.marker('b', { x: Number.NaN, y: 0, z: 0 });
    r.ui.eliteBar({ name: 'Breach Organism', hp: 400, maxHp: 900, regenerating: true, exposed: true });
    r.ui.readout({ label: 'Carrier impact', value: '1:31', tone: 'amber' });
    r.ui.hint({ text: 'Hold to guard', glyph: 'Q', seconds: 1 });
    r.ui.prompt({ text: 'Lift the plate', glyph: 'E', hold: true, progress: 0.4 });
    r.ui.zoneCard('Z01 · Pressure Hall', 'Encounter E1');
    r.ui.hitMarker('weak');
    r.ui.damageDirection(1.2, 0.8);
    r.game.events.emit('player:protagonist', { id: 'selene' });
    r.game.events.emit('zone:loading', { zone: 'Z02' });
    r.step(3);
    expect(errors()).toEqual([]);
    expect(r.root.children[0]!.dataset.prot).toBe('tarrik'); // polled state wins over the event once it arrives
  });
});
