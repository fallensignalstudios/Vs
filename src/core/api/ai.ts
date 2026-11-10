/**
 * AI contract — OWNER: ai (src/ai/*).
 * Enemy brains per role, encounter director (spawn slots / caps / wave conditions / melee slots),
 * the Eclipse link system, encounter devices (emitter, relays, scanners), companions and protected NPCs.
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
}
