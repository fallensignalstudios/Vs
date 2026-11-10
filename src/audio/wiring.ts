/**
 * Event wiring: what the audio system does on its own in response to GameEvents, so gameplay code does not
 * have to remember to. The list is mirrored in the header of `src/core/api/audio.ts` — keep them in sync.
 * Everything here is idempotent against a script making the same call (stingers and speaker ticks are
 * rate-limited per kind), so a zone that also calls `stinger('checkpoint')` does not double up.
 */
import { clamp } from '@/core/mathx';
import { isStub } from '@/core/stub';
import type { AudioSystem, Game } from '@/core/api';

export interface WiredAudio extends AudioSystem {
  setPaused(paused: boolean): void;
  setLead(id: 'tarrik' | 'selene'): void;
}

const VOLUME_KEYS = new Set(['masterVolume', 'musicVolume', 'sfxVolume']);
/** how far the mix drops under a spoken line */
const DIALOGUE_DUCK = 0.4;
const DEATH_MUFFLE = 0.65;

export function wireEvents(game: Game, audio: WiredAudio): void {
  const ev = game.events;
  let muffleBeforeDeath = 0;
  let lastSever = -100;

  ev.on('settings:changed', ({ key }) => {
    if (VOLUME_KEYS.has(key)) audio.applySettings();
  });
  ev.on('game:paused', ({ paused }) => audio.setPaused(paused));
  ev.on('game:phase', ({ phase, prev }) => {
    if (phase === 'dead') {
      muffleBeforeDeath = audio.muffle;
      audio.setMuffle(Math.max(DEATH_MUFFLE, muffleBeforeDeath), 0.9);
    } else if (prev === 'dead') {
      audio.setMuffle(muffleBeforeDeath, 0.6);
    }
    if (phase === 'title') {
      audio.clear();
      audio.setMuffle(0, 0.5);
      audio.setPaused(false);
    }
  });

  ev.on('player:protagonist', ({ id }) => audio.setLead(id));
  ev.on('handoff', ({ to }) => audio.setLead(to));
  ev.on('zone:loading', () => audio.clear());
  ev.on('zone:ready', () => {
    // a reload can land before or after the Meridian beat: follow the saved story state
    const mission = game.mission;
    if (!mission || isStub(mission)) return;
    const flags = mission.state?.flags;
    if (flags && !isStub(flags)) audio.setMeridianResolved(flags.meridianComplete === true);
  });

  ev.on('dialogue:line', ({ line }) => {
    audio.speak(line.speaker, line.channel ?? 'voice');
    const seconds = line.duration ?? clamp(1.2 + (line.text?.length ?? 0) * 0.055, 1.5, 9);
    audio.duck(DIALOGUE_DUCK, seconds);
  });

  ev.on('checkpoint:saved', () => audio.stinger('checkpoint'));
  ev.on('encounter:started', () => audio.stinger('encounterStart'));
  ev.on('encounter:cleared', () => audio.stinger('encounterClear'));
  ev.on('link:severed', () => {
    lastSever = game.time.now;
    audio.stinger('sever');
  });
  ev.on('link:created', () => {
    // a new link re-locks the cadence — unless it is just the bookkeeping around a sever
    if (game.time.now - lastSever > 1.5) audio.setCadenceIrregular(0);
  });
}
