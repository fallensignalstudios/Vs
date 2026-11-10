/**
 * Mission sandbox: boots the REAL GameImpl on the two mission test zones (src/mission/testzones) and publishes
 * window.__aurelion. Subsystems that are still stubs (combat / AI) get the stand-ins from ./fallback.ts.
 *
 *   /sandbox/mission/?manual=1&mute=1            T01 from its first beat (drive with __aurelion.step / runTo)
 *   …&zone=T02  …&beat=fight  …&cp=CP1           start elsewhere        …&title=1   start at the title screen
 *   …&autoplay=1                                 let the bot play in real time
 * `__sandbox.replaced` lists the subsystems that were stand-ins for this run.
 */
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import { GameImpl, parseUrlFlags } from '@/core/game';
import { installFlow } from '@/core/flow';
import { reportError } from '@/core/events';
import type { CheckpointId, ZoneId } from '@/core/api';
import { registerTestZones, T01_ID } from '@/mission/testzones';
import { installFallbacks } from './fallback';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const params = new URLSearchParams(location.search);
  const flags = parseUrlFlags(location.search);
  if (!params.has('debug')) flags.debug = true;

  window.addEventListener('error', (e) => reportError('window', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));

  const game = new GameImpl(canvas, uiRoot, flags);
  const replaced = installFallbacks(game);
  (window as unknown as { __game: GameImpl; __sandbox: { replaced: string[] } }).__game = game;
  (window as unknown as { __sandbox: { replaced: string[] } }).__sandbox = { replaced };
  installFlow(game);
  await game.init();
  if (flags.mute) game.settings.set('masterVolume', 0);
  registerTestZones(game);
  window.addEventListener('resize', () => game.render.resize());

  if (params.has('title')) {
    (game as unknown as { toTitle(): void }).toTitle();
  } else {
    game.setPhase('playing');
    game.input.setContext('game');
    try {
      if (flags.checkpoint) await game.mission.loadCheckpoint(flags.checkpoint as CheckpointId);
      else await game.mission.gotoZone((flags.zone as ZoneId | null) ?? T01_ID, flags.beat ?? undefined);
    } catch (err) {
      reportError('sandbox:goto', err);
    }
    if (flags.autoplay) game.debug.autoplay.start({ skipCinematics: true, god: true });
  }
  // helpers for tools/shot.cjs --eval
  const w = window as unknown as Record<string, unknown>;
  /** step the sim (no rendering) until `pred()` is true; returns sim seconds stepped, or -1 on timeout */
  w.__stepUntil = (pred: () => boolean, maxSeconds = 60, dt = 1 / 30): number => {
    let t = 0;
    while (t < maxSeconds) {
      if (pred()) return Math.round(t * 100) / 100;
      game.tick(dt, false);
      t += dt;
    }
    return -1;
  };
  /** step `seconds`, sampling the bot status every `every` seconds */
  w.__trace = (seconds: number, every = 1): string[] => {
    const out: string[] = [];
    for (let t = 0; t < seconds; t += every) {
      game.debug.step(every, 1 / 30);
      const s = game.debug.snapshot();
      out.push(`${s.time.toFixed(1)} ${s.beat} | ${s.bot} | hostiles ${s.hostiles.map((h) => `${h.archetype}:${Math.round(h.hp)}`).join(',')}`);
    }
    return out;
  };
  game.debug.ready = true;

  if (!flags.manual) {
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      game.tick(dt, true);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

boot().catch((err) => reportError('sandbox:boot', err));
