/**
 * Combat contract — OWNER: combat-player (src/combat/*).
 * Actor model, damage resolution, team hostility, the player controller and the two protagonist kits.
 */
import type * as THREE from 'three';
import type { Vec3Like, ProtagonistId } from './common';
import type { Archetype, CharacterVisual } from './chars';
import type { ButtonAction } from './camera';

/** Teams. Hostility between teams is a matrix on ActorManager (encounters configure it). */
export type Team = 'player' | 'dominion' | 'reformation' | 'contaminated' | 'eclipse' | 'neutral';

export type DamageKind = 'melee' | 'ranged' | 'explosion' | 'ability' | 'environment' | 'resonance';
export type Element = 'kinetic' | 'cinder' | 'frost' | 'violet' | 'shock';

export interface HitInfo {
  attacker: Actor | null;
  damage: number;
  /** poise damage */
  poise: number;
  kind: DamageKind;
  element?: Element;
  /** world-space direction the hit travels (unit) */
  dir: Vec3Like;
  /** world-space impact point */
  point: Vec3Like;
  heavy?: boolean;
  /** ignores guard/shield */
  unblockable?: boolean;
  /** set by the resolver if a weak point was struck, or forced by the attacker */
  weakPoint?: boolean;
  /** planar knockback impulse (m/s) */
  knockback?: number;
  /** seconds of freeze to apply (stasis / frost arrest) */
  freeze?: number;
  /** free-form tag ('counter', 'dispatch', 'thermalFracture', 'cinderSlam', …) */
  tag?: string;
}

export interface HitResult {
  /** hp actually removed */
  applied: number;
  blocked: boolean;
  /** perfect guard / deflect */
  perfect: boolean;
  staggered: boolean;
  killed: boolean;
  /** target ignored the hit entirely (invulnerable / i-frames / protected) */
  immune: boolean;
  weakPoint: boolean;
  /** damage was reduced by link armour / regeneration state */
  resisted: boolean;
}

export interface WeakPoint {
  id: string;
  /** socket on the visual the sphere follows */
  socket: string;
  radius: number;
  /** damage multiplier when struck */
  multiplier: number;
  /** only active while true */
  exposed: boolean;
}

export interface ActorController {
  /** called every tick before movement integration */
  update(actor: Actor, dt: number): void;
  onHit?(actor: Actor, hit: HitInfo, result: HitResult): void;
  onDeath?(actor: Actor, killer: Actor | null): void;
  dispose?(actor: Actor): void;
}

export interface Actor {
  readonly id: number;
  readonly archetype: Archetype | string;
  name: string;
  team: Team;

  /** feet position (world). Movement code writes desiredVel; ActorManager integrates through physics. */
  readonly pos: THREE.Vector3;
  yaw: number;
  /** desired planar velocity for this tick (m/s). Cleared each tick after integration. */
  readonly desiredVel: THREE.Vector3;
  /** actual velocity last tick */
  readonly vel: THREE.Vector3;
  /** additive impulse velocity that decays (knockback, lunges) */
  readonly impulse: THREE.Vector3;
  radius: number;
  height: number;
  /** flying actors hover: pos.y is the hover point's ground-projected height + hoverHeight */
  flying: boolean;
  hoverHeight: number;

  hp: number;
  maxHp: number;
  poise: number;
  maxPoise: number;
  /** hp/s regeneration (elite phase A) */
  regen: number;

  alive: boolean;
  /** can be locked onto / hit by hostiles */
  targetable: boolean;
  /** takes no damage (story NPCs, cinematics) */
  invulnerable: boolean;
  /** protected narrative NPC: never targeted, never damaged, repositioned if stuck */
  protectedNpc: boolean;

  /** guard state (player + Enforcers). guardArc = total frontal arc in radians. */
  guarding: boolean;
  guardArc: number;
  /** sim time until which a guard counts as perfect */
  perfectGuardUntil: number;
  /** sim-time stamps */
  staggeredUntil: number;
  frozenUntil: number;
  iframesUntil: number;

  /** damage multiplier applied to incoming damage (link armour etc). 1 = normal. */
  damageTakenScale: number;
  /** poise damage multiplier (linked bodies resist individual disruption) */
  poiseTakenScale: number;
  /** linked to a Weaver (maintained by LinkSystem) */
  linked: boolean;

  weakPoints: WeakPoint[];
  tags: Set<string>;
  visual: CharacterVisual | null;
  controller: ActorController | null;
  /** arbitrary per-actor blackboard for AI / scripts */
  data: Record<string, unknown>;

  /** convenience */
  readonly staggered: boolean;
  readonly frozen: boolean;
  /** chest/aim point in world space */
  aimPoint(out: THREE.Vector3): THREE.Vector3;
  distanceTo(other: Actor | Vec3Like): number;
  /** face toward a world point, optionally limited by turn rate (rad/s * dt) */
  face(target: Vec3Like, maxTurn?: number): void;
}

export interface ActorDesc {
  archetype: Archetype | string;
  name?: string;
  team: Team;
  pos: Vec3Like;
  yaw?: number;
  hp: number;
  poise?: number;
  radius?: number;
  height?: number;
  flying?: boolean;
  hoverHeight?: number;
  visual?: CharacterVisual | null;
  controller?: ActorController | null;
  targetable?: boolean;
  invulnerable?: boolean;
  protectedNpc?: boolean;
  tags?: string[];
  weakPoints?: WeakPoint[];
}

export interface ActorRayHit {
  actor: Actor;
  point: THREE.Vector3;
  distance: number;
  weakPoint: WeakPoint | null;
}

export interface ActorManager {
  readonly all: readonly Actor[];
  spawn(desc: ActorDesc): Actor;
  /** remove immediately, or after a dissolve */
  despawn(actor: Actor, opts?: { dissolve?: boolean; seconds?: number }): void;
  /** kill through the normal death path (events, dissolve) */
  kill(actor: Actor, killer?: Actor | null): void;

  /** THE damage resolver: guard arcs, perfect guard, i-frames, weak points, poise/stagger, freeze, death, events. */
  applyHit(target: Actor, hit: HitInfo): HitResult;
  stagger(target: Actor, seconds: number, by?: Actor | null): void;
  freeze(target: Actor, seconds: number): void;

  setHostile(a: Team, b: Team, hostile: boolean): void;
  areHostile(a: Actor, b: Actor): boolean;
  /** reset the hostility matrix to defaults (eclipse hostile to everyone; player hostile to eclipse) */
  resetHostility(): void;

  /** living, targetable actors hostile to `of` */
  hostilesOf(of: Actor): Actor[];
  nearest(pos: Vec3Like, maxDist: number, filter?: (a: Actor) => boolean): Actor | null;
  inRadius(pos: Vec3Like, radius: number, filter?: (a: Actor) => boolean): Actor[];
  /** actors inside a frontal arc (melee sweeps). arc = total radians. */
  inArc(pos: Vec3Like, yaw: number, arc: number, range: number, filter?: (a: Actor) => boolean): Actor[];
  /** ray vs actor capsules + weak-point spheres */
  raycast(origin: Vec3Like, dir: Vec3Like, maxDist: number, filter?: (a: Actor) => boolean): ActorRayHit | null;
  byTag(tag: string): Actor[];
  byId(id: number): Actor | null;

  /** controllers → movement integration via physics → separation → visuals.update */
  update(dt: number): void;
  /** remove all actors except those tagged 'persist' (zone unload) */
  clear(): void;
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

export type AbilityId = 'cinderSlam' | 'cinderSticky' | 'stasisGrenade' | 'dispatch';
export type WeaponId = 'velkorran' | 'cinderline' | 'verity' | 'axiom';

export interface AbilityState {
  id: AbilityId;
  name: string;
  cost: number;
  cooldown: number;
  /** seconds remaining */
  cooldownLeft: number;
  ready: boolean;
}

export interface PlayerHudState {
  protagonist: ProtagonistId;
  name: string;
  hp: number; maxHp: number;
  poise: number; maxPoise: number;
  echo: number; echoMax: number;
  ammo: number; magSize: number; reserve: number; reloading: boolean;
  meleeName: string; rangedName: string;
  abilities: [AbilityState, AbilityState];
  aiming: boolean;
  guarding: boolean;
  lockTarget: Actor | null;
  /** current contextual action prompt (e.g. Resonance confirm), if any */
  context: ContextAction | null;
  /** 0..1 bounded local corruption threat meter (E4 contest); 0 hides it */
  threat: number;
}

/** Scripted contextual action (Resonance confirm, duel prompts). */
export interface ContextAction {
  id: string;
  prompt: string;
  button: ButtonAction;
  /** seconds the window stays open (Infinity allowed). Widened by assistance settings. */
  window: number;
  /** auto-confirm when the accessibility setting for automatic prompts is on */
  autoConfirmable?: boolean;
  onConfirm(): void;
  onExpire?(): void;
}

export interface PlayerController {
  /** The current protagonist's actor (always exists after setProtagonist). */
  readonly actor: Actor;
  readonly protagonist: ProtagonistId;
  /** Spawn/switch the controlled protagonist at a position. Applies the authored kit. */
  setProtagonist(id: ProtagonistId, at: { pos: Vec3Like; yaw: number }): void;
  /** false = ignore gameplay input (cinematics, menus). Actor stays in the world. */
  enabled: boolean;
  /** scripted movement lock variants */
  setMovementLocked(locked: boolean): void;
  teleport(pos: Vec3Like, yaw?: number): void;

  echo: number;
  readonly echoMax: number;
  addEcho(amount: number, reason: string): void;
  heal(amount: number): void;
  /** mission-authored recovery values for a checkpoint: full hp, authored ammo + echo */
  restoreForCheckpoint(opts?: { echo?: number }): void;
  setAmmo(mag: number, reserve: number): void;

  lockTarget: Actor | null;
  godMode: boolean;
  /** 0..1 bounded local threat meter value shown on the HUD (set by AI corruption-pressure logic) */
  threat: number;

  setContextAction(action: ContextAction | null): void;
  readonly contextAction: ContextAction | null;

  /** scripted one-off animation on the player figure while disabled (cinematics) */
  playScripted(action: string, opts?: { faceTo?: Vec3Like }): number;

  getHudState(): PlayerHudState;
  update(dt: number): void;
}

/** Tunable numbers shared by combat + AI (single source of truth lives in src/combat/tuning.ts). */
export interface CombatTuning {
  difficultyDamageTaken: Record<'story' | 'standard' | 'hard', number>;
  difficultyWindow: Record<'story' | 'standard' | 'hard', number>;
}
