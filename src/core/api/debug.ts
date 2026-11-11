/**
 * Debug / test harness contract — OWNER: mission (src/debug/*).
 * Exposed as window.__aurelion. Used by Playwright smoke tests, screenshot tooling and the autoplay bot.
 */
import type { CheckpointId, RescuePriority, Vec3Like, ZoneId } from './common';
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
  /**
   * interactions that are not done yet — required ones and (polish 3) optional ones; `required` tells them apart
   */
  interactables?: Array<{ id: string; enabled: boolean; required?: boolean; x: number; y: number; z: number; progress: number }>;
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

/** ADDED (polish 3). Options for DebugApi.goto. */
export interface DebugGotoOpts {
  /**
   * keep the mission state as it stands (flags, story flags, recorded choices, optional records). Default false:
   * every debug goto starts from a fresh state (difficulty and play statistics kept), as if the page had been
   * opened at that zone — flags from earlier gotos in the same page no longer leak into the next one.
   */
  keepState?: boolean;
  /** flags to set on top of the (fresh) state, e.g. `{ z03Detected: true }` or `{ officerFate: 'spared' }` */
  flags?: Record<string, boolean | number | string>;
  /** the Z07 priority to start with (Z08 / Z11 read it) */
  rescuePriority?: Exclude<RescuePriority, 'pending'>;
}

/** ADDED (polish 3). Options for DebugApi.planView. */
export interface PlanViewOpts {
  /**
   * height (m) of the horizontal section plane above the floor the lead stands on: everything above it — ceilings,
   * vaults, upper shells — is not drawn. Default 2.8. `false` = no cut (the whole zone, roofs included).
   */
  cut?: number | false;
  /** keep the scene fog (default false: a plan view is drawn without fog, which from 40 m up hides the floor) */
  fog?: boolean;
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
  /**
   * load a zone at a beat (default its first). Polish 3: starts from a fresh mission state unless
   * `opts.keepState`, and drops a free camera / plan view left from earlier captures (also on loadCheckpoint and
   * newGame) so the jump opens on the gameplay camera.
   */
  goto(zone: ZoneId, beat?: string, opts?: DebugGotoOpts): Promise<void>;
  loadCheckpoint(id: CheckpointId): Promise<void>;
  newGame(): Promise<void>;
  teleport(pos: Vec3Like, yaw?: number): void;
  god(on: boolean): void;
  killAll(): void;
  skipCinematic(): void;
  setQuality(q: QualityLevel): void;
  /** free camera for screenshots; null returns to gameplay camera. Ends a plan view's section cut. */
  cam(pose: CamPose | null): void;
  /**
   * look at the zone from above (plan view) for layout verification. Polish 3: the view is cut by a horizontal
   * section plane a few metres above the lead's floor (see PlanViewOpts) so ceilings no longer hide the plan, and
   * drawn without fog; `cam()`, `goto()`, `loadCheckpoint()` and `newGame()` remove the cut and restore the fog.
   */
  planView(height?: number, opts?: PlanViewOpts): void;
  /**
   * show / hide the HUD. Polish 3: `hud(false)` is a clean frame for screenshots — it also hides the zone card,
   * toasts, subtitles, captions, the context prompt and the skip hint (`ui.setCleanFrame`), and a cinematic
   * restoring the HUD does not bring them back; `hud(true)` shows everything again.
   * Polish 4: also a `ui.card(…, { style: 'context' })` (the information overlay the Z07 bridge sets over the
   * hologram); the narrative cards ('witness', 'consequence', 'title', 'flash'), the status board and world text
   * (`ui.worldText`, diegetic labels) still draw. To capture a context card, do not call `hud(false)`.
   */
  hud(visible: boolean): void;
  /** show physics/nav debug wireframes */
  physics(visible: boolean): void;
  /** autoplay bot */
  autoplay: {
    /** `choice` = the Z07 priority (default West), `officer` = the Z08 officer (default 'killed') */
    start(opts?: {
      choice?: 'WestStretchers' | 'EastWalkers'; officer?: 'killed' | 'spared'; skipCinematics?: boolean;
      /** default: on at the 'bot' pace, off at the 'human' pace */
      god?: boolean;
      /**
       * ADDED. 'bot' (default): instant reactions, perfect aim — the soft-lock detector. 'human': reaction delays
       * (0.4–0.75 s), human swing cadence with breathers, imperfect aim, dodges ~65 % of the wind-ups it sees, can
       * die — for balance and pacing measurements at Standard.
       */
      pace?: 'bot' | 'human';
    }): void;
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
    /** ADDED. the Z08 officer choice the bot commits (default 'killed') */
    officer?: 'killed' | 'spared';
    /** ADDED. sim seconds without any progress before the run is declared stuck (default 90) */
    stallSeconds?: number;
    /** ADDED. false = watch every cinematic at full length (default true: skip) */
    skipCinematics?: boolean;
    /** ADDED. the bot's pace (see autoplay.start); 'human' runs without god mode unless `god` is given */
    pace?: 'bot' | 'human';
    /** ADDED. god mode for the run (default: on at the 'bot' pace, off at 'human') */
    god?: boolean;
  }): Promise<RunToResult>;

  // --- ADDED (mission/debug) ---
  /**
   * show / hide the F1 development overlay. With `?debug=1` it starts visible in a live session and hidden under
   * `?manual=1` (headless captures stay clean); the F-keys are bound in both cases.
   */
  overlay(visible: boolean): void;
  /** ids of the registered zones in mission order */
  zones(): string[];
}
