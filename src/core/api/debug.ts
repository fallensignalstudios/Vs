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
  };
  /**
   * Headless full-run: steps the sim with the bot until `untilCheckpoint` (default CP9) or `maxSimSeconds`.
   * Resolves with the trail of checkpoints reached and per-beat timings.
   */
  runTo(opts?: { untilCheckpoint?: CheckpointId; maxSimSeconds?: number; choice?: 'WestStretchers' | 'EastWalkers' }): Promise<{
    reached: string[]; beats: Array<{ zone: string; beat: string; t: number }>; ok: boolean; stuck: string | null; simSeconds: number;
  }>;
}
