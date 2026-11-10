/**
 * AURELION — shared contract: identifiers, mission state, events.
 *
 * CONTRACT RULES (all src/core/api/*.ts files):
 *  - These files are the cross-subsystem contract. Existing members must never be removed, renamed or have
 *    their semantics changed.
 *  - The subsystem that OWNS an api file may ADD members / new types to it (with JSDoc). Nobody else edits it.
 *  - Units: metres, seconds, radians. Y is up. Three.js right-handed coordinates.
 *  - "Plan coordinates" used by the level plan: x = east, n = north. World mapping: X = x, Z = -n.
 *  - yaw = rotation about +Y. yaw 0 faces -Z (north). Forward vector = (-sin(yaw), 0, -cos(yaw)).
 */
import type * as THREE from 'three';

export type Vec3Like = { x: number; y: number; z: number };
export type Vec2Like = { x: number; z: number };

export type ZoneId =
  | 'Z00' | 'Z01' | 'Z02' | 'Z03' | 'Z04' | 'Z05' | 'Z06'
  | 'Z07' | 'Z08' | 'Z09' | 'Z10' | 'Z11' | 'Z12';

export const ZONE_ORDER: readonly ZoneId[] = [
  'Z00', 'Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09', 'Z10', 'Z11', 'Z12',
];

export type CheckpointId =
  | 'CP0' | 'CP1' | 'CP2' | 'CP2b' | 'CP3' | 'CP4' | 'CP4b'
  | 'CP5' | 'CP5b' | 'CP6' | 'CP7' | 'CP8' | 'CP9';

export type ProtagonistId = 'tarrik' | 'selene';
export type RescuePriority = 'pending' | 'WestStretchers' | 'EastWalkers';
export type Difficulty = 'story' | 'standard' | 'hard';

/** Named speakers for dialogue/subtitles. `SYSTEM` = terminal voice, `NARRATOR` = opening context. */
export type SpeakerId =
  | 'Tarrik' | 'Selene' | 'Lyessa' | 'Tharne' | 'Lyric' | 'Malik' | 'Cross' | 'Sol'
  | 'Marine' | 'Medic' | 'Survivor' | 'Soldier' | 'Dominion Command' | 'Reformation Command'
  | 'Terminal' | 'Narrator' | 'King' | (string & {});

export interface DialogueLine {
  speaker: SpeakerId;
  text: string;
  /** seconds the line stays up; computed from text length if omitted */
  duration?: number;
  /** true if the speaker is offscreen / on radio — UI tags it (accessibility contract) */
  offscreen?: boolean;
  /** 'radio' lines are rendered with a comm treatment */
  channel?: 'voice' | 'radio' | 'system' | 'narration';
}

export type CaptionKind = 'scan' | 'link' | 'pressure' | 'breach' | 'impact' | 'ambient' | 'door' | 'alert';

/**
 * Persistent mission state. Mission definitions own state; level scripts request transitions through
 * ZoneRuntime / MissionSystem rather than writing arbitrary campaign flags.
 */
export interface MissionState {
  version: number;
  checkpoint: CheckpointId;
  zone: ZoneId;
  beat: string;
  difficulty: Difficulty;
  /** The ONE variable consequence (Z07). Committed exactly once. */
  rescuePriority: RescuePriority;
  /** Fixed story states + zone-local progress flags. Keys listed in STORY_FLAGS are fixed canon, not branches. */
  flags: Record<string, boolean | number | string>;
  /** Optional pockets completed */
  optional: { O1: boolean; O2: boolean; O3: boolean; O4: boolean };
  stats: {
    playSeconds: number;
    deaths: number;
    zoneSeconds: Record<string, number>;
    retries: Record<string, number>;
  };
}

/**
 * Fixed story-state flag keys (never player-authored branches).
 * `carrierLost` is the canonical Z05 outcome (the carrier is lost with all hands; the people on the platform
 * survive). `carrierRescued` is kept only for backward compatibility — do not set it.
 */
export const STORY_FLAGS = [
  'carrierRescued', 'carrierLost', 'cageDominionDestroyed', 'cageReformationDestroyed', 'threatExchangeOpen',
  'marineRescued', 'quarantineSeparated', 'contraryRecognized', 'assentTarrik', 'assentSelene',
  'meridianComplete', 'releaseWithheld', 'grammarPropagated', 'lyricAliveNotCured',
  'evidenceExchanged', 'pactAgreed', 'departed',
] as const;
export type StoryFlag = (typeof STORY_FLAGS)[number];

export type GamePhase = 'boot' | 'title' | 'loading' | 'playing' | 'paused' | 'dead' | 'complete';

export interface GameTime {
  /** simulation seconds since boot (scaled, stops while paused) */
  now: number;
  /** scaled dt of the current tick */
  dt: number;
  /** real dt of the current frame */
  unscaledDt: number;
  /** global time scale (slow-mo). Restored to 1 by whoever changed it. */
  scale: number;
  frame: number;
  /** freeze simulation for `seconds` of real time (hit-stop). Respects max 0.25s. */
  hitStop(seconds: number): void;
  /** ease time scale to `scale` for `seconds` real seconds then back to 1 */
  slowMo(scale: number, seconds: number): void;
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------
import type { Actor, HitInfo, HitResult, AbilityId } from './combat';
import type { LinkHandle } from './ai';

export interface GameEvents {
  'game:phase': { phase: GamePhase; prev: GamePhase };
  'game:paused': { paused: boolean };
  'settings:changed': { key: string };

  'actor:spawned': { actor: Actor };
  'actor:died': { actor: Actor; killer: Actor | null };
  'actor:hit': { target: Actor; hit: HitInfo; result: HitResult };
  'actor:staggered': { actor: Actor; by: Actor | null };
  'actor:frozen': { actor: Actor; seconds: number };

  'player:protagonist': { id: ProtagonistId };
  'player:died': Record<string, never>;
  'player:damaged': { amount: number; dir: Vec3Like; hit: HitInfo };
  'player:healed': { amount: number };
  'player:echo': { value: number; delta: number; reason: string };
  'player:guard': { perfect: boolean; attacker: Actor | null };
  'player:ability': { id: AbilityId };
  'player:lockon': { target: Actor | null };
  'player:shot': { weapon: string; ammo: number };
  'player:pickup': { kind: string };

  'encounter:started': { id: string };
  'encounter:wave': { id: string; wave: number };
  'encounter:cleared': { id: string };
  'link:created': { link: LinkHandle };
  'link:severed': { link: LinkHandle; by: Actor | null };
  'device:disabled': { id: string; kind: string; by: Actor | null };
  'scan:detected': { source: string };

  'zone:loading': { zone: ZoneId };
  'zone:ready': { zone: ZoneId };
  'zone:beat': { zone: ZoneId; beat: string };
  'zone:exit': { zone: ZoneId; to: ZoneId | null };
  'checkpoint:saved': { id: CheckpointId };
  'mission:complete': { state: MissionState };

  'dialogue:line': { line: DialogueLine };
  'dialogue:clear': Record<string, never>;
  'cinematic:start': { id: string; skippable: boolean };
  'cinematic:end': { id: string; skipped: boolean };
  'objective:changed': { text: string | null; marker: Vec3Like | null };
  'interact:done': { id: string };
  'choice:made': { id: string; option: string };
  'handoff': { from: ProtagonistId; to: ProtagonistId };
  'caption': { text: string; kind: CaptionKind; pos?: Vec3Like };
}

export interface EventBus<E> {
  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void;
  once<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void;
  off<K extends keyof E>(type: K, fn: (payload: E[K]) => void): void;
  emit<K extends keyof E>(type: K, payload: E[K]): void;
}

/** Anything with a per-tick update. */
export interface Updatable {
  update(dt: number): void;
}

export type Object3D = THREE.Object3D;
