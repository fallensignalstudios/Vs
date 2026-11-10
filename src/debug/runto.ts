/**
 * Headless run: the autoplay bot plays the mission in fast sim steps until a checkpoint, the end of the
 * mission, a stall, or the time limit. The result is the project's soft-lock report — it must stay honest:
 * a run is clean (`stuck: null`) only if the bot never needed a teleport and progress never stopped.
 */
import type { CheckpointId, Game, GameEvents, RunToResult } from '@/core/api';
import { reportError } from '@/core/events';
import { isStub } from '@/core/stub';
import type { AutoplayBot } from './autoplay';

export interface RunToOptions {
  untilCheckpoint?: CheckpointId;
  maxSimSeconds?: number;
  choice?: 'WestStretchers' | 'EastWalkers';
  stallSeconds?: number;
  skipCinematics?: boolean;
}

/** sim step of a run: two 60 Hz substeps per tick */
const RUN_DT = 1 / 30;
/** ticks between yields to the event loop (async zone loads, page responsiveness) */
const TICKS_PER_SLICE = 200;
/** how long a zone load may take in real time before the run gives up on it */
const LOAD_TIMEOUT_MS = 120000;
/** consecutive ticks without sim time passing before the run concludes the simulation is halted */
const FROZEN_TICKS = 120;

/** Events that mean the mission itself moved on. */
const HARD_EVENTS: Array<keyof GameEvents> = [
  'zone:beat', 'zone:ready', 'checkpoint:saved', 'interact:done', 'actor:died', 'encounter:started', 'encounter:wave',
  'encounter:cleared', 'objective:changed', 'choice:made', 'handoff', 'device:disabled', 'link:severed',
  'cinematic:start', 'cinematic:end', 'mission:complete',
];
/** Events that show something is still happening without proving the mission advances. */
const SOFT_EVENTS: Array<keyof GameEvents> = ['dialogue:line', 'actor:hit', 'actor:spawned', 'player:pickup', 'scan:detected'];

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const errorList = (): string[] => ((globalThis as { __aurelionErrors?: string[] }).__aurelionErrors ??= []);

export async function runTo(game: Game, bot: AutoplayBot, opts: RunToOptions = {}): Promise<RunToResult> {
  const until = opts.untilCheckpoint ?? 'CP9';
  const maxSim = opts.maxSimSeconds && opts.maxSimSeconds > 0 ? opts.maxSimSeconds : 3600;
  const stallLimit = opts.stallSeconds && opts.stallSeconds > 0 ? opts.stallSeconds : 90;
  const hardLimit = Math.max(240, stallLimit * 3);
  const { mission, events, time } = game;
  const errorsBefore = errorList().length;

  const result: RunToResult = { reached: [], beats: [], ok: false, stuck: null, simSeconds: 0, teleports: 0, forcedInteractions: [], errors: [] };
  if (isStub(mission) || mission.zones.size === 0) {
    result.stuck = 'no zones registered';
    return result;
  }

  let simStart = time.now;
  let hard = 0;
  let soft = 0;
  let complete = false;
  const offs: Array<() => void> = [];
  for (const type of HARD_EVENTS) offs.push(events.on(type, () => { hard++; }));
  for (const type of SOFT_EVENTS) offs.push(events.on(type, () => { soft++; }));
  offs.push(events.on('checkpoint:saved', ({ id }) => { result.reached.push(id); }));
  offs.push(events.on('zone:beat', ({ zone, beat }) => { result.beats.push({ zone, beat, t: round1(time.now - simStart) }); }));
  offs.push(events.on('mission:complete', () => { complete = true; }));

  const wasRunning = bot.running;
  try {
    // make sure something is loaded and the game is in play
    if (game.phase !== 'playing' && game.phase !== 'complete' && game.phase !== 'dead') {
      game.ui.hideTitle();
      game.setPhase('playing');
      game.input.setContext('game');
    }
    if (game.paused) game.setPaused(false);
    if (!mission.currentZone && !mission.loading) await mission.newGame();
    await waitForLoad(game);
    simStart = time.now;
    const cur = mission.currentZone;
    if (cur && result.beats.length === 0 && mission.currentBeat) result.beats.push({ zone: cur.id, beat: mission.currentBeat, t: 0 });

    bot.start({ choice: opts.choice, skipCinematics: opts.skipCinematics !== false, god: true });

    let lastHard = hard;
    let lastSoft = soft + bot.progress;
    let hardIdle = 0;
    let softIdle = 0;
    let frozen = 0;
    for (;;) {
      if (result.reached.includes(until) || complete) {
        result.ok = true;
        break;
      }
      if (time.now - simStart >= maxSim) {
        result.stuck = `time limit: ${maxSim} sim seconds reached — ${describe(game, bot)}`;
        break;
      }
      if (mission.loading) {
        if (!(await waitForLoad(game))) {
          result.stuck = `zone load did not finish within ${LOAD_TIMEOUT_MS / 1000} s — ${describe(game, bot)}`;
          break;
        }
        continue;
      }
      let stalled: string | null = null;
      for (let i = 0; i < TICKS_PER_SLICE && !mission.loading; i++) {
        const before = time.now;
        game.tick(RUN_DT, false);
        const dt = time.now - before;
        const softNow = soft + bot.progress;
        if (hard !== lastHard) {
          lastHard = hard;
          hardIdle = 0;
          softIdle = 0;
        } else {
          hardIdle += dt;
        }
        if (softNow !== lastSoft) {
          lastSoft = softNow;
          softIdle = 0;
        } else {
          softIdle += dt;
        }
        if (softIdle >= stallLimit) stalled = `no progress of any kind for ${stallLimit} s`;
        else if (hardIdle >= hardLimit) stalled = `no mission progress for ${hardLimit} s (activity continues)`;
        if (stalled || complete || result.reached.includes(until)) break;
        if (dt > 0) {
          frozen = 0;
        } else if (!mission.loading && ++frozen > FROZEN_TICKS) {
          // hit-stop frames are a handful; this many in a row means the simulation is not running at all
          if (game.paused) game.setPaused(false);
          else {
            stalled = game.phase === 'playing' || game.phase === 'dead' ? 'the simulation is not advancing' : `the game left play (phase "${game.phase}")`;
            break;
          }
          frozen = 0;
        }
      }
      if (stalled) {
        result.stuck = `${stalled} — ${describe(game, bot)}`;
        break;
      }
      await pause();
    }
  } catch (err) {
    reportError('debug:runTo', err);
    result.stuck = `runTo failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    for (const off of offs) off();
    result.teleports = bot.teleports;
    result.forcedInteractions = bot.forced.slice();
    if (!wasRunning) bot.stop();
  }

  result.simSeconds = round1(time.now - simStart);
  result.errors = errorList().slice(errorsBefore).map((e) => e.split('\n')[0]);
  if (!result.stuck && result.teleports > 0) {
    const jumps = bot.log.filter((l) => l.includes('TELEPORT')).slice(-4).join(' | ');
    result.stuck = `finished, but the bot needed ${result.teleports} last-resort teleport(s): ${jumps}`;
  }
  return result;
}

async function waitForLoad(game: Game): Promise<boolean> {
  const t0 = Date.now();
  while (game.mission.loading) {
    if (Date.now() - t0 > LOAD_TIMEOUT_MS) return false;
    await pause();
  }
  return true;
}

function describe(game: Game, bot: AutoplayBot): string {
  const { mission, player } = game;
  const zone = mission.currentZone ? mission.currentZone.id : '—';
  const a = isStub(player) ? null : player.actor;
  const pos = a && !isStub(a) ? `(${a.pos.x.toFixed(1)}, ${a.pos.y.toFixed(1)}, ${a.pos.z.toFixed(1)})` : '(no player)';
  const tail = bot.log.slice(-3).join(' | ');
  return `at ${zone}/${mission.currentBeat ?? '—'}, objective "${mission.objectiveText ?? ''}", bot: ${bot.status || 'stopped'}, player ${pos}${tail ? `; log: ${tail}` : ''}`;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
