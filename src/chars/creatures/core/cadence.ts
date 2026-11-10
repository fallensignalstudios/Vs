/**
 * The Eclipse cadence: one shared clock every linked / Eclipse-made thing twitches, pulses and hesitates on,
 * so unlike bodies read as driven by the same imposed timing. Uses the AI link system's cadence when the
 * game provides one, otherwise a local clock with the same default period.
 */
import type { Game } from '@/core/api';
import { isStub } from '@/core/stub';

/** default beat period in seconds when no link system is running */
export const CADENCE_PERIOD = 1.6;

export interface Cadence {
  /** 0..1 position inside the current beat */
  phase(): number;
  /** sharp pulse: 1 on the beat, decaying to 0 within ~a third of the period */
  beat(): number;
  /** advance the local fallback clock (no-op when the game clock drives it) */
  tick(dt: number): void;
}

let localTime = 0;
let lastFrameTick = -1;

/** shared cadence source; `localDt` ticks are de-duplicated per game frame so many creatures can call tick() */
export function cadenceFor(game: Game | null): Cadence {
  const external = (): (() => number) | null => {
    if (!game) return null;
    try {
      const ai = game.ai;
      if (!ai || isStub(ai)) return null;
      const c = ai.links?.cadence;
      if (!c || isStub(c) || typeof c.phase !== 'function') return null;
      return () => c.phase();
    } catch {
      return null;
    }
  };
  const phase = (): number => {
    const ext = external();
    if (ext) {
      const p = Number(ext());
      if (Number.isFinite(p)) return p - Math.floor(p);
    }
    const p = localTime / CADENCE_PERIOD;
    return p - Math.floor(p);
  };
  return {
    phase,
    beat(): number {
      return Math.exp(-phase() * 7.5);
    },
    tick(dt: number): void {
      const frame = game && !isStub(game.time) ? game.time.frame : -1;
      if (frame >= 0) {
        if (frame === lastFrameTick) return;
        lastFrameTick = frame;
        localTime += game!.time.dt > 0 ? game!.time.dt : dt;
      } else {
        localTime += dt / Math.max(1, cadenceUsers);
      }
    },
  };
}

/** number of live creatures ticking the frameless fallback clock (so N instances do not run it N× fast) */
let cadenceUsers = 0;
export function cadenceRetain(): void { cadenceUsers++; }
export function cadenceRelease(): void { cadenceUsers = Math.max(0, cadenceUsers - 1); }
