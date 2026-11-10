/**
 * AI contract — OWNER: ai (src/ai/*).
 * Enemy brains per role, encounter director (spawn slots / caps / wave conditions / melee slots),
 * the Eclipse link system, encounter devices (emitter, relays, scanners), companions and protected NPCs.
 *
 * QUICK GUIDE FOR ZONE AUTHORS (implementation: src/ai/*, numbers: TUNING.enemies + src/ai/tune.ts)
 *  - Enemies come from an Encounter (`z.encounter(def)` → `enc.start()`): waves, a hard `maxActive` cap with
 *    queued spawn slots, melee attack tokens, hostility for the roles it contains, `encounter:*` events and the
 *    music intensity. `ai.spawnEnemy` makes a free-standing enemy (no cap, no melee token limit).
 *  - Default teams: secDrone → 'reformation', enforcer → 'dominion', contamDrone → 'contaminated',
 *    linkbound / wallrunner / weaver / elite → 'eclipse'. An encounter makes 'player' hostile to the teams it
 *    spawns when it starts and restores what it changed when it is cleared or stopped.
 *  - Every attack is telegraphed for ≥ 0.45 s (× 0.8 hard, × 1.3 story) on the body (`setTelegraph`), on the
 *    ground for area attacks (`vfx.telegraph`) and in sound; attacks commit (no tracking after the commit point).
 *  - Brains never target `protectedNpc` / neutral actors or actors tagged 'device'; they stop attacking during
 *    `ai.setCeasefire(true)` (telegraphs in progress are cancelled).
 *  - E1: `ai.devices.commandEmitter({ drones })` synchronises those drones' volleys; staggering it desyncs them
 *    for 8 s, destroying / disabling it for good. E2: `ai.devices.relayReceiver({ network })` ×2 and
 *    `SpawnOpts.network` on the contaminated drones. E3 / E4: Weavers link nearby linkbound (and the elite)
 *    by themselves; `ai.devices.weaverAnchor()` gives a Weaver a destructible physical anchor.
 *  - The elite: `ai.elite(actor)` returns its EliteController (phase, joint exposure, Thermal Fracture hooks,
 *    no-go rectangles).
 *  - Companions never die (downed → kneel 4 s → recover) and never take the last kill of an encounter.
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';
import type { Actor, Team } from './combat';
import type { HumanoidArchetype } from './chars';

export type EnemyRole =
  | 'secDrone'      // Reformation security drone: lane fire, synchronised volleys through a command emitter
  | 'contamDrone'   // contaminated variant: coordinated by relay receivers, hostile to everyone
  | 'enforcer'      // Dominion Enforcer: overlapping shield front
  | 'linkbound'     // Eclipse ordinary body: melee, synchronised cadence while linked
  | 'wallrunner'    // Eclipse ceiling/wall attacker
  | 'weaver'        // Eclipse link source
  | 'elite';        // regenerative breach organism

export interface SpawnOpts {
  pos: Vec3Like;
  yaw?: number;
  /** entrance presentation */
  via?: 'none' | 'aperture' | 'ceiling' | 'breach' | 'march';
  /** where the entrance animation starts (aperture mouth, wall seam, breach) */
  from?: Vec3Like;
  /** post to hold / lane anchor (drones: lane position; enforcers: line slot) */
  post?: Vec3Like;
  /** firing lane index (drones) */
  lane?: number;
  team?: Team;
  hpScale?: number;
  tags?: string[];
  /** start dormant until alerted (Z03 → E2 drones) */
  dormant?: boolean;
  name?: string;
  /** ADDED. Relay network a contamDrone belongs to (default: the only network that exists, if any). */
  network?: string;
  /**
   * ADDED. Rectangles (world XZ) the enemy never enters, never charges through and never attacks into
   * (survivor recesses in E4). Used by the elite; also changeable later with `EliteController.setNoGo`.
   */
  noGo?: NoGoRect[];
  /**
   * ADDED. Wall / ceiling perches for a wallrunner. Omitted: it finds walls around its target by itself
   * (physics rays) and falls back to the ceiling above it.
   */
  perches?: WallPerch[];
  /** ADDED. Deterministic variation seed for the visual (default: derived from the spawn order). */
  seed?: number;
}

/** ADDED. Axis-aligned world-space rectangle (XZ). */
export interface NoGoRect {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

/** ADDED. A place a wallrunner clings to. `pos` is the FLOOR point under it (must be walkable). */
export interface WallPerch {
  pos: Vec3Like;
  /** metres above the floor the body clings at (default 4) */
  height?: number;
  /** world yaw of the wall's outward normal (pointing into the room); null / omitted = ceiling */
  wallYaw?: number | null;
}

export interface WaveSpawn {
  role: EnemyRole;
  /** marker name or position */
  at: string | Vec3Like;
  opts?: Partial<SpawnOpts>;
}

export interface WaveDef {
  /** condition to release this wave (evaluated each tick once previous waves have been released). Default: immediately. */
  when?: (enc: Encounter) => boolean;
  spawns: WaveSpawn[];
  /** telegraph before spawning (seconds) — e.g. aperture opening, wall seam glow */
  telegraph?: number;
  onTelegraph?: (enc: Encounter) => void;
  onSpawn?: (actors: Actor[], enc: Encounter) => void;
}

export interface EncounterDef {
  id: string;
  /** hard cap on simultaneously alive hostile actors (spawn slots enforce it; excess spawns queue) */
  maxActive: number;
  /** simultaneous melee attack tokens (default 2) */
  meleeSlots?: number;
  waves: WaveDef[];
  /** resolve a marker name to a position (zone runtime supplies this) */
  resolve?: (marker: string) => Vec3Like;
  onCleared?: (enc: Encounter) => void;
}

export interface Encounter {
  readonly id: string;
  readonly state: 'idle' | 'active' | 'cleared';
  /** currently alive hostile actors spawned by this encounter */
  readonly alive: readonly Actor[];
  readonly aliveCount: number;
  /** total actors committed (spawned) so far / total defined */
  readonly spawned: number;
  readonly total: number;
  readonly killed: number;
  /** index of the last released wave (-1 before start) */
  readonly wave: number;
  /** all waves released and nothing alive or queued */
  readonly cleared: boolean;
  /** free-form flags scripts set and wave conditions read ('formationBroken', 'rescueOpen', …) */
  flags: Record<string, boolean>;
  meleeSlots: number;
  start(): void;
  /** add an externally spawned actor to this encounter's accounting */
  adopt(actor: Actor): void;
  /** debug/autoplay: kill everything and release remaining waves as dead */
  forceClear(): void;
  stop(): void;

  // ---- ADDED by ai ----
  /** ADDED. spawns waiting for a free slot under `maxActive` (released waves only) */
  readonly queued: number;
  /** ADDED. the hard cap this encounter was created with */
  readonly maxActive: number;
  /** ADDED. highest number of simultaneously alive members seen so far */
  readonly peakActive: number;
  /** ADDED. melee tokens currently held */
  readonly meleeSlotsHeld: number;
  /**
   * ADDED. Ask for a melee attack token (brains call this before a melee telegraph). true = granted (or already
   * held). At most `meleeSlots` are out at once — 2 by default, `max(meleeSlots, 3)` once `flags.linkLearned`.
   * Tokens of dead / removed holders are reclaimed automatically.
   */
  acquireMeleeSlot(actor: Actor): boolean;
  /** ADDED. Give the token back (after the attack's recovery). No-op when none is held. */
  releaseMeleeSlot(actor: Actor): void;
  /** ADDED. Is `actor` one of this encounter's members (spawned or adopted)? */
  has(actor: Actor): boolean;
}

export interface LinkHandle {
  readonly id: number;
  readonly source: Actor;
  readonly target: Actor;
  /** optional physical anchor actor; destroying it severs the link */
  readonly anchor: Actor | null;
  readonly alive: boolean;
  /** world-space midpoint, for targeting / UI */
  midpoint(out: THREE.Vector3): THREE.Vector3;
}

export interface LinkSystem {
  /** Create a visible link. The target gains `linked` (poise resistance, synchronised cadence). */
  create(source: Actor, target: Actor, opts?: { anchor?: Actor | null; regen?: number }): LinkHandle;
  sever(link: LinkHandle, by?: Actor | null): void;
  severAllFrom(source: Actor, by?: Actor | null): void;
  linksOf(actor: Actor): LinkHandle[];
  readonly all: readonly LinkHandle[];
  /**
   * Links can be struck directly: melee sweeps and shots test against link segments.
   * Returns the first link whose segment passes within `radius` of the ray/segment.
   */
  hitTest(from: Vec3Like, to: Vec3Like, radius: number): LinkHandle | null;
  /** Shared cadence clock: linked bodies turn, hesitate and attack on the same beat. */
  readonly cadence: { period: number; phase(): number; timeToBeat(): number };
}

export type DeviceKind = 'commandEmitter' | 'relayReceiver' | 'scanHead' | 'weaverAnchor' | 'frostAnchor';

export interface DeviceHandle {
  readonly id: string;
  readonly kind: DeviceKind;
  /** devices are Actors (targetable, destructible) so every weapon and the autoplay bot can attack them */
  readonly actor: Actor;
  readonly disabled: boolean;
  /** close-interaction / scripted disable (no ammunition required) */
  disable(by?: Actor | null): void;
  /** ADDED. world position of the device's 'core' (interaction prompts, markers, beams) */
  readonly pos: Vec3Like;
  /** ADDED. take the device out of the world (visual, beams, sounds). Devices are also removed by `ai.clear()`. */
  remove(): void;
  /** ADDED. scanHead only: multiply the sweep speed (Z04: the head runs faster after a Z03 detection). No-op on other kinds. */
  setRate(mult: number): void;
}

export interface ScanPlaneHandle {
  /** sweeps between two points; detection requires unobstructed sight to the player (cover occludes) */
  readonly active: boolean;
  setActive(a: boolean): void;
  /** multiply sweep speed (first failure "accelerates the local scanner pattern") */
  setRate(mult: number): void;
  readonly detections: number;
  remove(): void;
}

export interface DeviceSystem {
  /** E1: physical command emitter synchronising the given drones' volleys. Staggering it desyncs temporarily; destroying it permanently. */
  commandEmitter(opts: { id: string; pos: Vec3Like; drones: Actor[]; hp?: number }): DeviceHandle;
  /** E2: relay receiver. Any one down → scanning interrupted briefly; all down → network down. */
  relayReceiver(opts: { id: string; pos: Vec3Like; network: string; hp?: number }): DeviceHandle;
  /** state of a relay network */
  network(name: string): { receivers: DeviceHandle[]; down: boolean; interruptedUntil: number };
  /** fixed scanner head sweeping a cone; onDetect fires when the player is seen (cover occludes) */
  scanHead(opts: { id: string; pos: Vec3Like; yaw: number; arcDeg: number; range: number; period: number; onDetect?: () => void }): DeviceHandle;
  /** moving scan plane (Z03). `source` is the physical emitter position the trace points back to. */
  scanPlane(opts: { id: string; from: Vec3Like; to: Vec3Like; width: number; height?: number; period: number; phase?: number; source: Vec3Like; onDetect?: () => void }): ScanPlaneHandle;
  /** E4: frost anchor position marker Selene (AI) moves to in phase B */
  frostAnchor(opts: { id: string; pos: Vec3Like }): DeviceHandle;
  byId(id: string): DeviceHandle | null;

  // ---- ADDED by ai ----
  /**
   * ADDED. Physical anchor of a Weaver's links (team 'eclipse', destructible, tagged 'device' / 'objective' /
   * 'source'). A Weaver uses the nearest living anchor within 30 m for every link it makes; destroying the
   * anchor severs those links and that Weaver cannot link again. Also usable directly:
   * `ai.links.create(source, target, { anchor: handle.actor })`.
   */
  weaverAnchor(opts: { id: string; pos: Vec3Like; yaw?: number; hp?: number }): DeviceHandle;
  /** ADDED. every device created since the last clear() */
  readonly all: readonly DeviceHandle[];
  /**
   * ADDED. State of the command-emitter group a drone belongs to, or null: `synced` is false while the emitter
   * is staggered (8 s) and for good once it is destroyed / disabled (`broken`).
   */
  syncOf(drone: Actor): { readonly synced: boolean; readonly broken: boolean; readonly emitter: DeviceHandle } | null;
}

export type CompanionMode =
  | 'follow'        // stay near the leader, no combat
  | 'combat'        // fight alongside (uses own kit), never steals objective kills flagged 'playerOnly'
  | 'hold'          // hold position, defend
  | 'scripted';     // do nothing unless told

export interface Companion {
  readonly actor: Actor;
  readonly who: HumanoidArchetype;
  mode: CompanionMode;
  /** walk/run to a point through nav; resolves `arrived` */
  moveTo(pos: Vec3Like, opts?: { run?: boolean; yaw?: number; stopDistance?: number }): void;
  readonly arrived: boolean;
  follow(leader: Actor | null, offset?: { right: number; back: number }): void;
  holdAt(pos: Vec3Like, yaw?: number): void;
  face(target: Vec3Like | null): void;
  /** play an animation action on the figure (narrative posing) */
  play(action: string, opts?: { loop?: boolean }): number;
  stopAction(): void;
  teleport(pos: Vec3Like, yaw?: number): void;
  /** priority target hint for combat mode */
  focus(target: Actor | null): void;
  /** scripted assist: perform the companion's signature arrest on a target (Selene: frost tether; Lyessa: rifle shot) */
  assist(target: Actor, kind: 'frostArrest' | 'rifleShot' | 'cinderStrike' | 'suppress'): void;
  remove(): void;

  // ---- ADDED by ai ----
  /** ADDED. true while downed (hp reached 0: kneels 4 s, cannot be hit, then recovers half its health) */
  readonly downed: boolean;
  /** ADDED. true while a scripted assist() is being performed (wind-up → effect); false once it has landed */
  readonly assisting: boolean;
  /** ADDED. true while the companion is being staggered or frozen (a Resonance window should cancel) */
  readonly disrupted: boolean;
}

/**
 * ADDED. Scripting surface of the elite's brain (`ai.elite(actor)`), for the E4 zone script.
 *
 * Phase A: at least one link feeds the elite → it regenerates (`TUNING.enemies.elite.regen` hp/s), sweeps, slams,
 * charges along clear lines and announces a corruption PRESSURE PULSE: for a few seconds `game.player.threat`
 * rises while the player stands in the field (≈ 9 m) AND a link still feeds the elite; leaving the field or
 * cutting the links relieves it. At full threat the player takes one bounded violet hit and the meter drops.
 * Phase B: isolated. It regenerates slowly on its own; after each heavy attack (slam, charge) it EXPOSES THE
 * JOINT (weak point 'joint', ×3) for a window. `fracture()` ends all regeneration.
 */
export interface EliteController {
  readonly actor: Actor;
  /** 'A' while any link feeds it, otherwise 'B' */
  readonly phase: 'A' | 'B';
  /** the joint weak point is open right now */
  readonly jointExposed: boolean;
  /** Thermal Fracture has happened: no regeneration, the core stays exposed */
  readonly fractured: boolean;
  /** the corruption pressure field is active right now */
  readonly pressureActive: boolean;
  /** called each time the joint opens (phase B, after a heavy attack or a granted resonance window) */
  onJointExposed: ((elite: Actor) => void) | null;
  /** called when the phase changes */
  onPhase: ((phase: 'A' | 'B') => void) | null;
  /**
   * Ask for a Resonance opening: in phase B (not fractured, alive, not staggered) the elite finishes what it is
   * doing, opens the joint and holds it — attacking nothing — for `seconds` (default 7). Returns false when it
   * cannot (phase A, dead, already fractured). Poll `jointExposed` or use `onJointExposed`.
   */
  requestResonanceWindow(seconds?: number): boolean;
  /** Close a granted window early (a partner was staggered): the joint closes and the elite stays in a short low-pressure pattern (≈ 3 s without heavy attacks). */
  cancelResonanceWindow(): void;
  /**
   * Selene's arrest on the joint: frost creeps from the joint (visual `setFrozen(0.3)`), the elite cannot act
   * and the exposure is held for `seconds` (default 3).
   */
  arrest(seconds?: number): void;
  /**
   * THE Thermal Fracture consequence: plays the creature's 'fracture', removes regeneration for good, removes
   * 35 % of max hp (never the last 5 %), staggers it for 5 s and leaves the core exposed. Presentation around it
   * (`vfx.spawn('thermalFracture', joint)`, slow-mo, music) is the caller's. No-op when already fractured.
   */
  fracture(by?: Actor | null): void;
  /** replace the no-go rectangles (survivor recesses) */
  setNoGo(rects: NoGoRect[]): void;
}

export interface AiSystem {
  spawnEnemy(role: EnemyRole, opts: SpawnOpts): Actor;
  /** Fighting / following ally with a full humanoid figure. Team 'player'. Never dies (downed → recovers). */
  spawnCompanion(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; mode?: CompanionMode; name?: string }): Companion;
  /** Non-combat protected NPC (survivors, wounded, authorities). Same handle type for posing/moving. */
  spawnNpc(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; pose?: string; name?: string; seed?: number }): Companion;
  createEncounter(def: EncounterDef): Encounter;
  readonly encounters: readonly Encounter[];
  readonly links: LinkSystem;
  readonly devices: DeviceSystem;
  /** alert dormant actors with the tag (Z03 scan failure → E2 drones) */
  alert(tag: string): void;
  /** global calm: all hostiles stop attacking (hold-fire orders, cinematics) */
  setCeasefire(on: boolean): void;
  /** 0..1 current combat intensity (drives music) */
  readonly intensity: number;
  update(dt: number): void;
  /** zone unload */
  clear(): void;

  // ---- ADDED by ai ----
  /** ADDED. current ceasefire state (see setCeasefire) */
  readonly ceasefire: boolean;
  /** ADDED. the elite's scripting surface, or null when `actor` is not a living elite spawned by this system */
  elite(actor: Actor | null): EliteController | null;
  /** ADDED. the encounter `actor` belongs to, or null */
  encounterOf(actor: Actor): Encounter | null;
  /** ADDED. every companion / NPC handle that has not been removed */
  readonly companions: readonly Companion[];
  /** ADDED. live counters for the debug overlay and sandbox reports (the same object every read) */
  readonly stats: AiStats;
}

/** ADDED. Counters since the last `ai.clear()`. */
export interface AiStats {
  spawned: number;
  /** volleys fired by drones / of those, fired at the same instant as a synchronised partner */
  volleys: number;
  syncVolleys: number;
  boltsFired: number;
  meleeAttacks: number;
  /** attacks that began a telegraph / the shortest telegraph (s) any attack has had */
  telegraphs: number;
  minTelegraph: number;
  linksCreated: number;
  linksSevered: number;
  pounces: number;
  detections: number;
  /** elite: joint exposures, pressure pulses */
  jointExposures: number;
  pressurePulses: number;
}
