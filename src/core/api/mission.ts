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
import type { Archetype, HumanoidArchetype } from './chars';
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
  /**
   * ADDED (mission). Character models this zone shows (enemy roles, named NPCs). While the zone loads the
   * mission system awaits `game.chars.preload(cast)` — both protagonists and the common companions (Lyessa,
   * Tharne, Lyric) are always included — so no figure pops in after the fade.
   */
  cast?: Archetype[];
}

// ---------------------------------------------------------------------------------------------
// Runtime API given to beats
// ---------------------------------------------------------------------------------------------

export interface SayOpts {
  /**
   * seconds the line stays up. A given duration is always used as is (with voice-over: at least the clip's
   * length + 0.25 s). Default: the voice-over clip's length + 0.25 s when one exists, otherwise the reading time
   * clamp(1.6 + 0.055 × characters, 2, 8) for lines of 20 characters or more; shorter lines ease down to a 1.2 s
   * floor ("No." 1.2 s, "Do it." ≈ 1.4 s, "Kill them." ≈ 1.8 s). (Polish 3: the floor was 2 s for every line.)
   */
  duration?: number;
  offscreen?: boolean;
  channel?: DialogueLine['channel'];
  /**
   * make the speaking companion/actor face its listener (the protagonist, else the nearest same-side figure),
   * look at the listener's eyes (its `eye` / `head` socket — right for seated, kneeling or lying listeners) and
   * play the talk gesture for the length of the line. After the line a companion returns to the facing target
   * the zone gave it with `face()` before the line (or none). Only companions are turned; for the protagonist's
   * own actor (`actor: z.player`) the head turns but the body keeps the yaw the zone set.
   */
  actor?: Actor | Companion | null;
  /**
   * ADDED. false = no talk gesture: the speaker still faces and looks at the listener and its mouth moves
   * (`setSpeaking`), but no body clip plays — so a drawn weapon stays drawn (the talk gesture sheathes it) and a
   * held pose is not interrupted. Default true. Only meaningful with `actor`.
   */
  gesture?: boolean;
  /**
   * ADDED (polish 3). true = the speaker keeps its body facing (it is not turned to the listener and keeps the
   * `face()` target the zone gave it); only the head turns toward the listener's eyes, within the neck's range.
   * Default false. Only meaningful with `actor`.
   */
  keepFacing?: boolean;
  /**
   * ADDED (polish 3). true = a drawn weapon stays drawn: no talk gesture (that clip needs empty hands) — the same
   * as `gesture: false`. Default false. Only meaningful with `actor`.
   */
  keepWeapon?: boolean;
}

/**
 * A world interaction. The prompt shows while the player stands within `radius` (default 2.2 m, same level) and
 * roughly faces the point (waived inside 0.9 m); the nearest such interaction has the focus. While the player's
 * input is disabled (cinematic, choice) or a menu is open, nothing is offered.
 */
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
  /**
   * ADDED (polish 3). `InteractOpts.required` as given (false for optional pockets). Optional so hand-built
   * stand-ins stay valid; a reader treats a missing value as required.
   */
  readonly required?: boolean;
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
  /**
   * conversational two-shot helper: frames `subject` (feet position) over the shoulder of `over` (feet position).
   * The camera sits behind `over` on `side` (+1 right shoulder, default) at eye level; the subject lands on the
   * opposite third of the frame. Defaults: distance 1.7 m behind `over`, height 1.62, fov 38.
   */
  twoShot(subject: Vec3Like, over: Vec3Like, opts?: { side?: 1 | -1; distance?: number; height?: number; fov?: number }): void;
  /**
   * single close/medium shot of a point from a yaw/distance. `yawDeg` is the compass bearing of the CAMERA as
   * seen from the subject, in plan degrees (0 = camera north of the subject looking south, 90 = camera east).
   * Defaults: yawDeg 180 (camera south of the subject), distance 3.2, height 1.55, lookHeight 1.45, fov 40.
   * Like twoShot, the camera is pulled in toward the subject if geometry is in the way.
   */
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
  /**
   * marker world position (a fresh vector). Unknown names never throw (BRIEF rule 5): they warn once and
   * resolve to the player's position, or the zone origin before a player exists.
   */
  m(name: string): THREE.Vector3;
  /** marker world yaw (radians) */
  myaw(name: string): number;

  // --- waits ---
  until(pred: () => boolean): Wait;
  /** wait until the player is within radius of a marker/position (default 3 m) */
  untilNear(at: string | Vec3Like, radius?: number): Wait;
  /** wait until the player is inside a plan-space rectangle: centre (x, n), size w (east–west) × d (north–south) */
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
  /**
   * blocking subtitle line. Voice-over plays when the audio system has a clip for (speaker, text); a line that
   * has been up for 1 s can be advanced with `confirm` (or a tap of `skip` inside a cinematic). While a
   * cinematic is being skipped the line is not shown at all.
   */
  say(speaker: SpeakerId, text: string, opts?: SayOpts): Routine;
  /**
   * non-blocking line during play (queued; never overlaps another line). At most three wait behind the line on
   * screen (further ones are dropped), and one that has waited more than 6 s is dropped as stale.
   */
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
   *
   * Details (mission): the lead is invulnerable and hostiles hold fire for the length of the scene; the input
   * context is 'cinematic'. Holding `skip` for 0.8 s (hint shown for the first 3 s and while held), F4 or
   * `mission.skipCinematic()` fast-forwards the rest: every time wait in `body` collapses, `say` lines are not
   * shown, camera moves finish — predicate waits (`z.until`) still wait, so do not wait on movement inside a
   * skippable scene without checking `c.skipping`. A short tap of `skip` advances the current line instead.
   * The body runs as its own routine; an exception in it is reported and ends the scene cleanly. A cinematic
   * started inside another one (e.g. `z.handoff` in a scene) joins the outer scene.
   */
  cinematic(id: string, body: (c: CineCtx) => Routine, opts?: {
    skippable?: boolean; keepHud?: boolean; blendOut?: number;
    /** ADDED (mission). false = hostiles keep attacking during the scene (default true: global ceasefire). */
    ceasefire?: boolean;
    /** ADDED (mission). false = no letterbox bars (in-play vignettes). Default true. */
    letterbox?: boolean;
  }): Routine;
  /**
   * Authored protagonist handoff: the player recognises the new lead before movement resumes.
   * Camera glides from the old lead to the new one, kit/HUD swap, old lead becomes a companion (mode) and
   * the previous companion body for `to` is consumed.
   *
   * Details (mission): the incoming lead's body is looked up with `z.cast(to)` (spawn it earlier with
   * `z.companion('selene' | 'tarrik', …)`); without one the new lead appears beside the old one. `seconds`
   * (default 3.4) is the scene length without `line`; `line` is spoken by the new lead over the closing shot.
   * The outgoing lead is afterwards `z.cast(<its id>)`. No-op when `to` already leads.
   */
  handoff(to: ProtagonistId, opts?: { partnerMode?: CompanionMode; seconds?: number; line?: [SpeakerId, string] }): Routine;
  /**
   * present the local decision; resolves with the chosen option id. The answer is recorded in the mission state
   * (flag `choice:<id>`): asking the same choice again — a checkpoint retry — returns the recorded answer at
   * once without showing the panel or emitting `choice:made` a second time.
   *
   * A choice is never answered for the player: a cinematic skip STOPS at an open panel (the fast-forward ends
   * there, the rest of the scene plays normally and may be skipped again after the commit), the skip input does
   * nothing while it is open, and `settings.autoPrompts` (which confirms duel / Resonance context prompts) never
   * applies to it. Commit the answer and save right after it (`commitRescuePriority`, or `z.setFlag` +
   * `z.checkpoint` for the officer) — both recorded choices must survive a reload without being asked again.
   */
  choice(opts: ChoiceOpts): Routine<string>;
  /**
   * commit the ONE variable consequence exactly once and save it at once (re-saves the current checkpoint id
   * at the current beat). Later calls are no-ops; a different value also warns.
   */
  commitRescuePriority(p: Exclude<RescuePriority, 'pending'>): void;
  /** fixed story state transitions */
  story(flag: StoryFlag, value?: boolean): void;
  flag(key: string): boolean | number | string | undefined;
  setFlag(key: string, value: boolean | number | string): void;
  /** mark an optional pocket complete */
  optionalDone(id: 'O1' | 'O2' | 'O3' | 'O4'): void;
  /**
   * save a checkpoint now (beats with `checkpoint` do this automatically). The snapshot resumes at the CURRENT
   * beat through its `enter` — give that beat an `enter`, or the nearest earlier beat that has one is used.
   */
  checkpoint(id: CheckpointId): void;
  /** zone title card */
  titleCard(): void;
  /** fade helpers (blocking) */
  fadeOut(seconds?: number, color?: 'black' | 'white' | 'gold'): Routine;
  fadeIn(seconds?: number): Routine;
  /**
   * leave the zone: fade, unload, load `to` at its first beat. Never returns — except when `to` is not a
   * registered zone: that warns and returns at once with the screen still visible.
   */
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

/**
 * ADDED (polish 3). Options for `gotoZone` (the debug harness's `goto` passes `fresh: true`). Applied inside the
 * load queue, after any load already in flight, right before the zone builds.
 */
export interface GotoOpts {
  /**
   * start from a fresh mission state — no flags, story flags, recorded choices, optional records or priority —
   * keeping only the difficulty and the play statistics; as if the page had been opened at this zone. Default
   * false (the state as it stands).
   */
  fresh?: boolean;
  /** flags to set after the reset (e.g. `{ z03Detected: true }`, `{ officerFate: 'spared' }`) */
  flags?: Record<string, boolean | number | string>;
  /** the recorded Z07 priority to start with (Z08 / Z11 read it) */
  rescuePriority?: Exclude<RescuePriority, 'pending'>;
}

/** ADDED (mission). The decision panel that is waiting for an answer (autoplay / tests select through it). */
export interface ActiveChoice {
  readonly id: string;
  /** option ids in display order */
  readonly options: readonly string[];
  /** programmatic commit (same path as the player's confirm). Unknown ids are ignored. */
  select(option: string): void;
}

/** ADDED (mission). One entry of the beat trail kept by the mission system. */
export interface BeatLogEntry {
  zone: string;
  beat: string;
  /** `game.time.now` when the beat began */
  t: number;
}

/**
 * How the pieces behave (implementation notes callers can rely on):
 *  - LOADING is asynchronous and sequential: `gotoZone` / `loadCheckpoint` / `newGame` calls queue behind a load
 *    that is in flight. `loading` is true from the call until the zone is live; the Game does not simulate
 *    meanwhile. A zone whose `build` or `enter` throws is reported (reportError) and still goes live with
 *    whatever was built — the screen always fades back in.
 *  - SAVES: `saveCheckpoint(id)` snapshots the whole MissionState under that id (localStorage key
 *    `aurelion.save.v1`, validated on load, corrupt data discarded). A snapshot resumes at the beat that was
 *    running when it was taken (or the nearest earlier beat that has an `enter`). `loadCheckpoint(id)` restores
 *    that snapshot; for an id that was never saved in this profile it starts the table's beat with the current
 *    state. Deaths, retries and play time survive a restore.
 *  - A beat whose routine throws is reported and skipped; the next beat starts (the mission never hangs on a
 *    script error).
 */
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
  /**
   * interactions not done yet in the loaded zone. (Polish 3: optional ones are listed too — O1–O4 records, side
   * consoles; filter on `Interactable.required` for the critical path, as the autoplay bot does.)
   */
  readonly interactables: readonly Interactable[];
  readonly checkpoints: readonly CheckpointInfo[];

  registerZone(def: ZoneDef): void;
  hasSave(): boolean;
  newGame(difficulty?: Difficulty): Promise<void>;
  continueGame(): Promise<boolean>;
  /** load a zone at a beat (default first). Unloads the current zone. */
  gotoZone(zone: ZoneId, beat?: string, opts?: GotoOpts): Promise<void>;
  loadCheckpoint(id: CheckpointId): Promise<void>;
  /** reload the last saved checkpoint (death / pause menu) */
  reloadCheckpoint(): Promise<void>;
  saveCheckpoint(id: CheckpointId): void;
  /** request skip of the active skippable cinematic (ignored while a choice panel is open) */
  skipCinematic(): void;
  clearSave(): void;
  update(dt: number): void;

  // --- ADDED (mission) ---
  /** the choice panel currently waiting for the player, else null */
  readonly activeChoice: ActiveChoice | null;
  /** every beat started since boot, oldest first (capped at 512 entries) */
  readonly beatLog: readonly BeatLogEntry[];
  /** `z.log()` lines and mission-system notes, oldest first (capped at 300 lines) */
  readonly journal: readonly string[];
  /** true while a cinematic is running that the player may skip (false while a choice panel is open) */
  readonly cinematicSkippable: boolean;
}
