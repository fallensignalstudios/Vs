/**
 * Debug / test harness contract — OWNER: mission (src/debug/*).
 * Exposed as window.__aurelion. Used by Playwright smoke tests, screenshot tooling and the autoplay bot.
 */
import type { CheckpointId, Vec3Like, ZoneId } from './common';
import type { CamPose } from './camera';
import type { QualityLevel } from './render';

export interface DebugSnapshot {
  phase: string;
  zone: string | null;
  beat: string | null;
  checkpoint: string;
  loading: boolean;
  cinematic: boolean;
  objective: string | null;
  protagonist: string;
  player: { x: number; y: number; z: number; hp: number; echo: number; alive: boolean };
  hostiles: Array<{ id: number; archetype: string; hp: number; x: number; y: number; z: number }>;
  encounters: Array<{ id: string; state: string; alive: number; spawned: number; total: number }>;
  rescuePriority: string;
  flags: Record<string, unknown>;
  time: number;
  errors: string[];
  stats: { fps: number; drawCalls: number; triangles: number };
  // --- ADDED (mission/debug) ---
  /** draw calls / triangles of the main colour pass only (the numbers the BRIEF budgets refer to) */
  scene?: { drawCalls: number; triangles: number };
  /** required interactions that are not done yet */
  interactables?: Array<{ id: string; enabled: boolean; x: number; y: number; z: number; progress: number }>;
  /** objective marker position, if any */
  objectiveMarker?: { x: number; y: number; z: number } | null;
  /** id of the open decision panel, if any */
  choice?: string | null;
  /** camera mode + position */
  camera?: { mode: string; x: number; y: number; z: number };
  /** what the autoplay bot is doing right now ('' when it is not running) */
  bot?: string;
  /** audio.debugInfo() summary */
  audio?: { music: string; ambience: string; intensity: number };
}

/** ADDED (mission/debug). Result of DebugApi.runTo. */
export interface RunToResult {
  /** checkpoints saved during the run, in order */
  reached: string[];
  /** beats started during the run with the sim second (from the start of the run) each began at */
  beats: Array<{ zone: string; beat: string; t: number }>;
  /** the target checkpoint was reached (or the mission completed) */
  ok: boolean;
  /**
   * null for a clean run. Otherwise why the run is not clean: the stall that ended it ("no progress for 90 s at
   * Z04/e2 — …"), the time limit, or — when the run did finish — every last-resort teleport the bot needed.
   */
  stuck: string | null;
  simSeconds: number;
  /** number of last-resort teleports the bot used (each one is a navigation soft-lock for a real player) */
  teleports: number;
  /** interactions the bot had to finish through `Interactable.complete()` because input did not complete them */
  forcedInteractions: string[];
  /** entries added to `errors` during the run */
  errors: string[];
}

export interface DebugApi {
  /** true once the title screen (or the requested zone) is interactive */
  ready: boolean;
  errors: string[];
  snapshot(): DebugSnapshot;
  /** advance the simulation synchronously without rendering */
  step(seconds: number, dt?: number): void;
  /** render one frame now */
  render(): void;
  /** run sim + render alternately (seconds of sim, frames rendered) — for screenshots with settled animation */
  settle(seconds?: number): void;
  goto(zone: ZoneId, beat?: string): Promise<void>;
  loadCheckpoint(id: CheckpointId): Promise<void>;
  newGame(): Promise<void>;
  teleport(pos: Vec3Like, yaw?: number): void;
  god(on: boolean): void;
  killAll(): void;
  skipCinematic(): void;
  setQuality(q: QualityLevel): void;
  /** free camera for screenshots; null returns to gameplay camera */
  cam(pose: CamPose | null): void;
  /** look at the zone from above (plan view) for layout verification */
  planView(height?: number): void;
  hud(visible: boolean): void;
  /** show physics/nav debug wireframes */
  physics(visible: boolean): void;
  /** autoplay bot */
  autoplay: {
    start(opts?: { choice?: 'WestStretchers' | 'EastWalkers'; skipCinematics?: boolean; god?: boolean }): void;
    stop(): void;
    readonly running: boolean;
    /** human-readable log of what the bot did / is stuck on */
    readonly log: string[];
    /** ADDED. one-line description of the current activity ('' when stopped) */
    readonly status?: string;
    /** ADDED. last-resort teleports used since start() */
    readonly teleports?: number;
  };
  /**
   * Headless full-run: steps the sim with the bot until `untilCheckpoint` (default CP9) or `maxSimSeconds`.
   * Resolves with the trail of checkpoints reached and per-beat timings.
   */
  runTo(opts?: {
    untilCheckpoint?: CheckpointId; maxSimSeconds?: number; choice?: 'WestStretchers' | 'EastWalkers';
    /** ADDED. sim seconds without any progress before the run is declared stuck (default 90) */
    stallSeconds?: number;
    /** ADDED. false = watch every cinematic at full length (default true: skip) */
    skipCinematics?: boolean;
  }): Promise<RunToResult>;

  // --- ADDED (mission/debug) ---
  /** show / hide the F1 development overlay (on by default with `?debug=1`) */
  overlay(visible: boolean): void;
  /** ids of the registered zones in mission order */
  zones(): string[];
}
