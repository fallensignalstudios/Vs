/**
 * App flow glue (FOUNDATION): title → play → pause / death / completion.
 * Thin by design — all presentation lives in the UI system, all progression in the mission system.
 */
import type { Game } from './api';
import { reportError } from './events';
import { buildMissionSummary } from './summary';

export function installFlow(game: Game): void {
  const { events, ui, mission, input, audio } = game;
  let wasLocked = false;

  const run = (what: string, p: Promise<unknown> | void) => {
    if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch((e) => reportError(what, e));
  };

  const toTitle = () => {
    game.setPaused(false);
    game.setPhase('title');
    input.setContext('menu');
    ui.setHudVisible(false);
    audio.setMusic('title', 2);
    audio.setAmbience('none', 1);
    ui.showTitle({
      canContinue: mission.hasSave(),
      onNewGame: (difficulty) => {
        audio.unlock();
        ui.hideTitle();
        game.settings.set('difficulty', difficulty);
        game.setPhase('playing');
        input.setContext('game');
        run('newGame', mission.newGame(difficulty));
      },
      onContinue: () => {
        audio.unlock();
        ui.hideTitle();
        game.setPhase('playing');
        input.setContext('game');
        run('continueGame', mission.continueGame());
      },
    });
  };

  const openPause = () => {
    if (game.paused || game.phase !== 'playing') return;
    game.setPaused(true);
    input.setContext('menu');
    input.exitPointerLock();
    ui.showPause({
      onResume: () => {
        ui.hidePause();
        game.setPaused(false);
        input.setContext(mission.cinematicActive ? 'cinematic' : 'game');
        input.requestPointerLock();
      },
      onRestartCheckpoint: () => {
        ui.hidePause();
        game.setPaused(false);
        input.setContext('game');
        run('reloadCheckpoint', mission.reloadCheckpoint());
      },
      onQuitToTitle: () => {
        ui.hidePause();
        toTitle();
      },
    });
  };

  events.on('player:died', () => {
    if (game.phase !== 'playing') return;
    game.setPhase('dead');
    audio.stinger('death');
    ui.showDeath({
      onRetry: () => {
        ui.hideDeath();
        game.setPhase('playing');
        input.setContext('game');
        run('reloadCheckpoint', mission.reloadCheckpoint());
      },
    });
  });

  events.on('mission:complete', ({ state }) => {
    game.setPhase('complete');
    input.setContext('menu');
    input.exitPointerLock();
    const summary = buildMissionSummary(state);
    ui.showMissionComplete(summary, { onTitle: toTitle });
  });

  // Pause on Esc / Start, and when pointer lock is lost mid-play (browser consumed Esc).
  events.on('game:phase', () => {
    wasLocked = false;
  });
  const prevTick = game.tick.bind(game);
  (game as { tick: Game['tick'] }).tick = (dt: number, render?: boolean) => {
    prevTick(dt, render);
    if (game.phase !== 'playing' || game.paused) return;
    if (input.virtual.active) return;
    const locked = input.pointerLocked;
    if (!ui.modalOpen && (input.pressed('pause') || (wasLocked && !locked && input.device === 'kbm' && input.context !== 'menu'))) {
      openPause();
    }
    wasLocked = locked;
  };

  (game as unknown as { toTitle: () => void }).toTitle = toTitle;
}
