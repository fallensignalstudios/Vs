import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import { GameImpl, parseUrlFlags } from '@/core/game';
import { installFlow } from '@/core/flow';
import { installHostingHints } from '@/core/hosting';
import { reportError } from '@/core/events';
import type { CheckpointId, ZoneId } from '@/core/api';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const flags = parseUrlFlags(location.search);

  window.addEventListener('error', (e) => reportError('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));

  const game = new GameImpl(canvas, uiRoot, flags);
  // (ship) The debug API ships in the build but is only reachable with ?debug=1 (always in dev).
  if (import.meta.env.DEV || flags.debug) (window as any).__game = game;
  else delete (globalThis as { __aurelion?: unknown }).__aurelion;
  installFlow(game);
  installHostingHints(game);
  await game.init();

  document.getElementById('boot')?.remove();
  if (flags.mute) {
    game.settings.set('masterVolume', 0);
  }

  window.addEventListener('resize', () => game.render.resize());

  if (flags.zone || flags.checkpoint) {
    game.setPhase('playing');
    game.input.setContext('game');
    try {
      if (flags.checkpoint) await game.mission.loadCheckpoint(flags.checkpoint as CheckpointId);
      else await game.mission.gotoZone(flags.zone as ZoneId, flags.beat ?? undefined);
    } catch (err) {
      reportError('boot:goto', err);
    }
    if (flags.autoplay) game.debug.autoplay.start({ skipCinematics: true, god: true });
  } else {
    (game as any).toTitle();
  }

  game.debug.ready = true;

  if (!flags.manual) {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      game.tick(dt, true);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

boot().catch((err) => {
  reportError('boot', err);
  const el = document.getElementById('boot');
  if (el) el.textContent = 'Failed to start — see console';
});
