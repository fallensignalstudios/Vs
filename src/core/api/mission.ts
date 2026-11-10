/**
 * Mission contract — OWNER: mission (src/mission/*, src/core/script.ts is foundation).
 * Zone definitions, beats, the zone runtime scripting API, cinematics, interactions, checkpoints.
 *
 * SCRIPTING MODEL
 *  Zone logic is written as generator coroutines ("routines") advanced by game time:
 *      *run(z) {
 *        z.objective('Break the firing formation', 'formation');
 *        yield* z.say('Lyessa', 'Three lanes. They are not guessing.');
 *        yield z.until(() => enc.cleared);      // wait for a predicate
 *        yield 1.5;                              // wait seconds
 *        yield* z.exit('Z02');
 *      }
 *  yield <number>        → wait that many sim seconds
 *  yield <() => boolean> → wait until it returns true
 *  yield* <routine>      → run a sub-routine to completion
 *  yield [a, b]          → run routines/waits in parallel, continue when ALL finish
 *  yield { race: [..] }  → continue when ANY finishes (others are cancelled)
 *  yield (nothing)       → wait one tick
 *
 * SKIP = FAST-FORWARD. Skipping a cinematic never branches: the remaining routine is executed with all time
 * waits collapsed to zero, so "skipping the scene applies exactly the same state". Therefore: put every state
 * change inside the routine, never in timers/promises/setTimeout.
 */
import type * as THREE from 'three';
import type {
  CheckpointId, DialogueLine, MissionState, ProtagonistId, SpeakerId, Vec3Like, ZoneId, RescuePriority, StoryFlag,
  Difficulty,
} from './common';
import type { CamPose, EaseName, ButtonAction } from './camera';
import type { ZoneBuilder, DoorHandle } from './kit';
import type { Encounter, EncounterDef, Companion, CompanionMode } from './ai';
import type { HumanoidArchetype } from './chars';
import type { ChoiceOpts } from './ui';
import type { Actor } from './combat';

export type Wait =
  | number
  | (() => boolean)
  | Generator<Wait, unknown, unknown>
  | Wait[]
  | { race: Wait[] }
  | void
  | null
  | undefined;

export type Routine<T = void> = Generator<Wait, T, unknown>;

export interface ScriptHandle {
  readonly done: boolean;
  /** collapse all time waits to zero until the routine finishes */
  fastForward: boolean;
  stop(): void;
  readonly name: string;
}

export interface ScriptRunner {
  start(routine: Routine<unknown>, opts?: { name?: string; group?: string }): ScriptHandle;
  stopGroup(group: string): void;
  update(dt: number): void;
  readonly active: number;
}

// ---------------------------------------------------------------------------------------------
// Zone definition
// ---------------------------------------------------------------------------------------------

export interface Beat {
  /** unique within the zone; used by debug goto, autoplay logs and saves */
  id: string;
  /** autosave this checkpoint when the beat begins */
  checkpoint?: CheckpointId;
  /**
   * Called ONLY when this beat is the first one executed after the zone loads (normal zone entry for the first
   * beat; checkpoint reload / debug goto for later ones). It must put the world into the state the previous
   * beats would have left: spawn the player (z.spawnPlayer), companions, doors, defeated encounters, flags.
   * Must be synchronous and idempotent.
   */
  enter?(z: ZoneRuntime): void;
  run(z: ZoneRuntime): Routine;
}

export interface ZoneDef {
  id: ZoneId;
  /** "Pressure Hall" */
  title: string;
  /** "Encounter E1 — break coordinated lanes" */
  subtitle?: string;
  /** concept art for the loading screen */
  art?: 'wound-overlook' | 'relay-route' | 'quarantine-cooperation' | 'crownmark-chamber';
  /** Build geometry, colliders, markers, lights. Runs during loading. Must call b.finalize() last. */
  build(b: ZoneBuilder, state: MissionState): void | Promise<void>;
  beats: Beat[];
  /** optional per-tick hook while the zone is live */
  update?(z: ZoneRuntime, dt: number): void;
  /** optional cleanup beyond automatic disposal */
  dispose?(z: ZoneRuntime): void;
}

// ---------------------------------------------------------------------------------------------
// Runtime API given to beats
// ---------------------------------------------------------------------------------------------

export interface SayOpts {
  duration?: number;
  offscreen?: boolean;
  channel?: DialogueLine['channel'];
  /** make the speaking companion/actor face + gesture */
  actor?: Actor | Companion | null;
}

export interface InteractOpts {
  id: string;
  /** marker name or world position */
  at: string | Vec3Like;
  /** "Lift the plate" — glyph is added automatically */
  prompt: string;
  /** seconds to hold (0 / undefined = single press). Honours the hold→toggle accessibility setting. */
  hold?: number;
  radius?: number;
  /** autoplay + nav-assist treat required interactions as objectives */
  required?: boolean;
  /** dynamic availability */
  enabled?: () => boolean;
  /** show an 'interact' world marker when within this distance (default 14) */
  markerRange?: number;
  button?: ButtonAction;
  /** interruptions (taking damage) cancel the hold safely */
  interruptible?: boolean;
  onStart?: () => void;
  onCancel?: () => void;
  onDone?: () => void;
}

export interface Interactable {
  readonly id: string;
  readonly done: boolean;
  enabled: boolean;
  readonly pos: THREE.Vector3;
  /** 0..1 current hold progress */
  readonly progress: number;
  /** programmatic completion (autoplay / skip) */
  complete(): void;
  remove(): void;
}

export interface CineCtx {
  /** camera: all poses in WORLD coordinates (use z.P / markers) */
  cut(pose: CamPose): void;
  /** eased move; blocks for `seconds` (instant when skipping) */
  move(pose: CamPose, seconds: number, ease?: EaseName): Routine;
  /** start a move without waiting */
  moveAsync(pose: CamPose, seconds: number, ease?: EaseName): void;
  /** conversational two-shot helper: frames `subject` over the shoulder of `over` */
  twoShot(subject: Vec3Like, over: Vec3Like, opts?: { side?: 1 | -1; distance?: number; height?: number; fov?: number }): void;
  /** single close/medium shot of a point from a yaw/distance */
  shot(subject: Vec3Like, opts?: { yawDeg?: number; distance?: number; height?: number; lookHeight?: number; fov?: number }): void;
  drift(opts: { around: Vec3Like; radius?: number; yawRate?: number; height?: number; lookHeight?: number }): void;
  dof(focusDistance: number | null, strength?: number): void;
  letterbox(on: boolean): void;
  /** true once the player has asked to skip; long loops inside cinematics should break on it */
  readonly skipping: boolean;
}

export interface ZoneRuntime {
  readonly game: import('./index').Game;
  readonly zone: ZoneDef;
  readonly state: MissionState;
  readonly builder: ZoneBuilder;

  // --- space ---
  /** plan → world */
  P(x: number, n: number, h?: number): THREE.Vector3;
  /** marker world position (throws a clear error for unknown names) */
  m(name: string): THREE.Vector3;
  /** marker world yaw (radians) */
  myaw(name: string): number;

  // --- waits ---
  until(pred: () => boolean): Wait;
  /** wait until the player is within radius of a marker/position (default 3 m) */
  untilNear(at: string | Vec3Like, radius?: number): Wait;
  /** wait until the player is inside a plan-space rectangle */
  untilInRect(x: number, n: number, w: number, d: number): Wait;
  /** run a routine in parallel for the lifetime of the zone */
  fork(routine: Routine<unknown>, name?: string): ScriptHandle;

  // --- cast ---
  /** Place the controlled protagonist at a marker (uses marker yaw). Sets camera behind. */
  spawnPlayer(who: ProtagonistId, marker: string | Vec3Like, yaw?: number): Actor;
  readonly player: Actor;
  companion(who: HumanoidArchetype, marker: string | Vec3Like, mode?: CompanionMode, name?: string): Companion;
  npc(who: HumanoidArchetype, marker: string | Vec3Like, pose?: string, name?: string): Companion;
  /** look up a previously spawned companion/npc by name (or archetype if unnamed) */
  cast(name: string): Companion | null;

  // --- dialogue ---
  /** blocking subtitle line */
  say(speaker: SpeakerId, text: string, opts?: SayOpts): Routine;
  /** non-blocking line during play (queued; never overlaps another line) */
  bark(speaker: SpeakerId, text: string, opts?: SayOpts): void;
  /** blocking sequence of lines */
  talk(lines: Array<[SpeakerId, string] | [SpeakerId, string, SayOpts]>): Routine;

  // --- objectives / interaction ---
  /** set the HUD objective and nav marker (marker name or position); null clears */
  objective(text: string | null, at?: string | Vec3Like | null): void;
  /** optional-content marker ("O1 · Casualty log"); null removes */
  optionalMarker(id: string, at: string | Vec3Like | null, label?: string): void;
  interact(opts: InteractOpts): Interactable;
  /** blocks until the interactable is done */
  untilInteract(i: Interactable): Wait;
  hint(text: string | null, button?: ButtonAction, seconds?: number): void;

  // --- combat ---
  /** create an encounter whose spawn markers resolve through this zone */
  encounter(def: EncounterDef): Encounter;

  // --- cinematics / flow ---
  /**
   * Run a cinematic: disables player input, letterboxes, hides HUD, gives the camera to `body`, restores
   * everything afterwards. Skippable by default (fast-forward semantics).
   */
  cinematic(id: string, body: (c: CineCtx) => Routine, opts?: { skippable?: boolean; keepHud?: boolean; blendOut?: number }): Routine;
  /**
   * Authored protagonist handoff: the player recognises the new lead before movement resumes.
   * Camera glides from the old lead to the new one, kit/HUD swap, old lead becomes a companion (mode) and
   * the previous companion body for `to` is consumed.
   */
  handoff(to: ProtagonistId, opts?: { partnerMode?: CompanionMode; seconds?: number; line?: [SpeakerId, string] }): Routine;
  /** present the local decision; resolves with the chosen option id */
  choice(opts: ChoiceOpts): Routine<string>;
  /** commit the ONE variable consequence exactly once (no-op if already committed) */
  commitRescuePriority(p: Exclude<RescuePriority, 'pending'>): void;
  /** fixed story state transitions */
  story(flag: StoryFlag, value?: boolean): void;
  flag(key: string): boolean | number | string | undefined;
  setFlag(key: string, value: boolean | number | string): void;
  /** mark an optional pocket complete */
  optionalDone(id: 'O1' | 'O2' | 'O3' | 'O4'): void;
  /** save a checkpoint now (beats with `checkpoint` do this automatically) */
  checkpoint(id: CheckpointId): void;
  /** zone title card */
  titleCard(): void;
  /** fade helpers (blocking) */
  fadeOut(seconds?: number, color?: 'black' | 'white' | 'gold'): Routine;
  fadeIn(seconds?: number): Routine;
  /** leave the zone: fade, unload, load `to` at its first beat. Never returns. */
  exit(to: ZoneId, opts?: { fade?: 'white' | 'black' | 'gold'; seconds?: number }): Routine;
  /** finish the mission (Z12): CP9 + completion screen */
  completeMission(): Routine;

  /** door helper: open a kit door and rebuild nav */
  openDoor(door: DoorHandle, open?: boolean): void;
  /** heal/ammo pickups */
  pickup(kind: 'sustain' | 'ammo' | 'echo', at: string | Vec3Like): void;
  /** register cleanup for zone unload */
  onDispose(fn: () => void): void;
  /** true while fast-forwarding (cinematic skip) — skip pure-presentation work */
  readonly skipping: boolean;
  /** seconds since the zone became live */
  readonly time: number;
  log(msg: string): void;
}

// ---------------------------------------------------------------------------------------------
// Mission system
// ---------------------------------------------------------------------------------------------

export interface CheckpointInfo {
  id: CheckpointId;
  zone: ZoneId;
  beat: string;
  label: string;
}

export interface MissionSystem {
  readonly state: MissionState;
  readonly zones: ReadonlyMap<ZoneId, ZoneDef>;
  readonly currentZone: ZoneDef | null;
  readonly runtime: ZoneRuntime | null;
  readonly currentBeat: string | null;
  readonly loading: boolean;
  readonly cinematicActive: boolean;
  /** current objective for HUD / autoplay */
  readonly objectiveText: string | null;
  readonly objectiveMarker: THREE.Vector3 | null;
  readonly interactables: readonly Interactable[];
  readonly checkpoints: readonly CheckpointInfo[];

  registerZone(def: ZoneDef): void;
  hasSave(): boolean;
  newGame(difficulty?: Difficulty): Promise<void>;
  continueGame(): Promise<boolean>;
  /** load a zone at a beat (default first). Unloads the current zone. */
  gotoZone(zone: ZoneId, beat?: string): Promise<void>;
  loadCheckpoint(id: CheckpointId): Promise<void>;
  /** reload the last saved checkpoint (death / pause menu) */
  reloadCheckpoint(): Promise<void>;
  saveCheckpoint(id: CheckpointId): void;
  /** request skip of the active skippable cinematic */
  skipCinematic(): void;
  clearSave(): void;
  update(dt: number): void;
}
