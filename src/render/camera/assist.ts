/**
 * Small rig helpers that read the host game rather than the camera: the simulation clock that authored camera
 * motion runs on, and gamepad aim-assist friction.
 */
import * as THREE from 'three';
import type { Game, Vec3Like } from '@/core/api';
import { DEG, smoothstep } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { isFiniteVec } from './pose';

/** phases in which Game runs the simulation: authored camera time follows the simulation clock there */
const SIM_PHASES = new Set<string>(['playing', 'dead', 'complete']);

/**
 * Simulated time for authored camera motion (cinematic moves, blends back to gameplay, guided turns), so a shot
 * is never ahead of the script, voice and animation that run on the simulation.
 */
export class SimClock {
  private last = NaN;
  private stalled = 0;

  constructor(private readonly game: Game) {}

  /** paused or loading: authored motion AND the follow camera stand still */
  get suspended(): boolean {
    const game = this.game;
    if (game.paused === true) return true;
    const mission = game.mission;
    return !!mission && !isStub(mission) && mission.loading === true;
  }

  /**
   * Simulated seconds since the last call, given the real frame time `d`. Where the host runs a simulation
   * clock (Game.time.now during play) this is exactly how far it advanced, so hit-stop and slow-motion are
   * honoured; elsewhere (title screen, sandboxes without a clock) it is real time; 0 when paused or loading.
   */
  delta(d: number): number {
    if (this.suspended) return 0;
    const game = this.game;
    const time = game.time;
    const now = time && !isStub(time) ? time.now : NaN;
    if (typeof now !== 'number' || !Number.isFinite(now)) return d;
    const prev = this.last;
    this.last = now;
    if (!SIM_PHASES.has(game.phase as string)) return d;
    const step = now - prev;
    if (step === 0) {
      // Hit-stop freezes the clock for at most 0.25 s. A clock that stays frozen longer while the game is
      // neither paused nor loading is a host that does not run one (a bare sandbox): never stall on it.
      this.stalled += d;
      return this.stalled > 0.3 ? d : 0;
    }
    this.stalled = 0;
    // first frame, a rewound clock or a jump (checkpoint reload): fall back to real time for this frame
    return step > 0 && step <= d * 1.5 + 1e-4 ? step : d;
  }
}

/** look speed falls by up to this share as the reticle passes within these angles of a candidate */
const ASSIST_SLOW = 0.45;
const ASSIST_INNER = 1.2 * DEG;
const ASSIST_OUTER = 5 * DEG;

/**
 * Gamepad aim assist ("reticle friction"): how much of the stick's look speed gets through, from how close the
 * aim ray passes to the nearest candidate. It only ever slows the player's own input — it never steers.
 */
export class AimAssist {
  private source: (() => readonly Vec3Like[]) | null = null;
  private warned = false;

  get active(): boolean {
    return this.source !== null;
  }

  set(points: (() => readonly Vec3Like[]) | null): void {
    this.source = typeof points === 'function' ? points : null;
    this.warned = false;
  }

  /** 1 = full look speed … (1 − ASSIST_SLOW) with a candidate on the reticle. `dir` is the unit aim direction. */
  friction(origin: THREE.Vector3, dir: THREE.Vector3): number {
    const fn = this.source;
    if (!fn) return 1;
    let points: readonly Vec3Like[];
    try {
      points = fn();
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[camera] aim-assist source threw — assist cleared', err);
      }
      this.source = null;
      return 1;
    }
    if (!points || typeof points.length !== 'number') return 1;
    let best = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!isFiniteVec(p)) continue;
      const vx = p.x - origin.x;
      const vy = p.y - origin.y;
      const vz = p.z - origin.z;
      const d = Math.hypot(vx, vy, vz);
      if (d < 1 || d > 80) continue;
      const cos = (vx * dir.x + vy * dir.y + vz * dir.z) / d;
      if (cos <= 0) continue;
      // a body half a metre across covers more of the view up close: widen the sticky cone accordingly
      const size = Math.atan(0.3 / d);
      const k = 1 - smoothstep(ASSIST_INNER + size, ASSIST_OUTER + size, Math.acos(Math.min(1, cos)));
      if (k > best) best = k;
    }
    return 1 - ASSIST_SLOW * best;
  }
}
