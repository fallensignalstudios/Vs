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
  /**
   * ADDED. Minimum weak-point multiplier of this weapon: a weak-point hit uses max(weakPoint.multiplier, this).
   * (Axiom = 2.5.) Ignored when no weak point is struck.
   */
  weakPointScale?: number;
  /**
   * ADDED. The hit never counts as a weak-point hit, wherever `point` lies (area effects, strikes that carry
   * their own bonus rule such as Dispatch).
   */
  ignoreWeakPoints?: boolean;
  /**
   * ADDED. Skip the resolver's default presentation (impact VFX / SFX, hit-stop, shake, hit reaction) because the
   * caller stages its own (Thermal Fracture, scripted beats). State changes and events still happen.
   */
  silent?: boolean;
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
  /** ADDED. the hit arrived from behind the target (more than 100° off its facing); `flankMultiplier` was applied */
  flanked?: boolean;
  /** ADDED. a guarding target ran out of poise: guard dropped, long stagger (`staggered` is true as well) */
  guardBroken?: boolean;
  /** ADDED. the hit froze the target (HitInfo.freeze took effect) */
  froze?: boolean;
}

/** ADDED. What a body is made of, for impact VFX / SFX selection. */
export type ActorMaterial = 'flesh' | 'metal' | 'shield' | 'eclipse';

/** ADDED. Extra locomotion flags the ActorManager forwards to `visual.setLocomotion` every tick. */
export interface ActorLocoFlags {
  sprint?: boolean;
  aiming?: boolean;
  /** defaults to `actor.guarding` when omitted */
  guarding?: boolean;
  injured?: boolean;
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

/**
 * A brain for one Actor. HOW AN ACTOR IS DRIVEN (ActorManager.update, once per sim tick, in spawn order):
 *  1. `controller.update(actor, dt)` — ALWAYS called while the actor is alive, also while it is staggered or
 *     frozen (so a brain can react); check `actor.staggered` / `actor.frozen` yourself. Write `desiredVel`
 *     (walking, reported to the visual as locomotion) and/or `carryVel` (pounces, charges, dodges: displacement
 *     the feet do not walk), set `yaw` or call `face()`, start actions on `actor.visual`.
 *  2. The manager integrates `desiredVel + carryVel + impulse` through `physics.moveCharacter` (never through
 *     walls, never off a ledge), adds soft separation from other bodies, and clears `desiredVel` / `carryVel`.
 *     A frozen actor does not move at all; a staggered one only by `impulse` (knockback).
 *  3. Regeneration, poise recovery (after 2.5 s without poise damage), then the visual is posed and updated.
 * Exceptions thrown by a controller are caught, reported once per actor and never stop the tick.
 */
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
  /** chest/aim point in world space (the body centre for flying actors) */
  aimPoint(out: THREE.Vector3): THREE.Vector3;
  /** planar (XZ) distance between positions — heights are ignored */
  distanceTo(other: Actor | Vec3Like): number;
  /** face toward a world point, optionally limited by turn rate (rad/s * dt) */
  face(target: Vec3Like, maxTurn?: number): void;

  // ---- ADDED by combat-player. Optional so hand-built actors (tests, UI fakes) stay valid; every Actor returned
  // ---- by ActorManager.spawn has all of them.
  /**
   * ADDED. Velocity (m/s) of displacement the feet do NOT walk this tick: dodges, pounces, charges, attack
   * lunges. Integrated exactly like `desiredVel` (collision, fall protection) but not reported to the visual as
   * locomotion, so the figure is "carried" instead of sliding its stride. Cleared each tick after integration.
   */
  readonly carryVel?: THREE.Vector3;
  /**
   * ADDED. true = the manager never moves this actor: no physics integration, no ground snapping, no separation
   * push, no un-sticking (devices on walls and pedestals, seated or lying NPCs, set pieces). Others still walk
   * round it. Its `pos` is whatever you write.
   */
  fixed?: boolean;
  /** ADDED. Extra flags for `visual.setLocomotion` (sprint / aiming / injured); `guarding` follows `actor.guarding`. */
  loco?: ActorLocoFlags;
  /**
   * ADDED. false = a guard that is not perfect does not stop `heavy` hits — they land in full (Selene's deflect
   * stance; give it to a shield that heavy blows should go through). Default true.
   */
  guardStopsHeavy?: boolean;
  /** ADDED. Fraction of a blocked hit's damage that still reaches hp (0 = a full block, the default). */
  guardChip?: number;
  /**
   * ADDED. Sim time until which RANGED hits on a guarding actor count as perfect whatever `perfectGuardUntil`
   * says (a deflect stance turns every projectile for its whole length). Default 0.
   */
  deflectUntil?: number;
  /** ADDED. Damage multiplier for hits arriving from behind (see HitResult.flanked). Default 1; Enforcers 1.5. */
  flankMultiplier?: number;
  /** ADDED. Multiplier on freeze seconds (0 = cannot be frozen; the elite resists stasis). Default 1. */
  freezeScale?: number;
  /** ADDED. Sim time until which poise damage is ignored (committed heavy attacks cannot be interrupted). */
  superArmorUntil?: number;
  /** ADDED. Impact presentation; inferred from archetype / team when omitted. */
  material?: ActorMaterial;
  /** ADDED. Sim time of the last hit that got through to hp or poise (0 = never). */
  lastHitAt?: number;
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
  // ---- ADDED by combat-player ----
  /** ADDED. see Actor.fixed */
  fixed?: boolean;
  /** ADDED. see Actor.material */
  material?: ActorMaterial;
  /** ADDED. frontal guard arc in radians (default 120°) */
  guardArc?: number;
  /** ADDED. hp/s regeneration */
  regen?: number;
  /**
   * ADDED. Seconds a dead body stays before it is removed (default 2.5). `Infinity` keeps the wreck until
   * despawn() / clear(). Actors tagged 'persist' (the player) are never removed automatically.
   */
  corpseSeconds?: number;
  /** ADDED. Dissolve the visual on death with the Eclipse look (default: true for team 'eclipse'). */
  dissolveOnDeath?: boolean;
}

export interface ActorRayHit {
  actor: Actor;
  point: THREE.Vector3;
  distance: number;
  weakPoint: WeakPoint | null;
}

/**
 * Owns every Actor. NOTES FOR AI / ZONE AUTHORS (implementation: src/combat/manager.ts):
 *  - `spawn` takes ownership of `desc.visual`: its root is added to `game.scene`, posed every tick and disposed
 *    when the actor is removed. Bad descriptions (NaN position, hp ≤ 0) are repaired with a warning, never thrown.
 *    `poise` omitted or ≤ 0 = the actor has no poise bar and is only staggered by `stagger()`.
 *  - Flying actors: `pos` is the CENTRE of the body at `hoverHeight` above the ground below (the manager eases
 *    the height over ramps and steps and adds a small visual bob); `height` is the body's vertical size.
 *  - ARRAYS RETURNED BY QUERIES (`hostilesOf`, `inRadius`, `inArc`, `byTag`) and the hit returned by `raycast`
 *    are scratch buffers taken from a small ring: valid for immediate iteration — including nested queries and
 *    applyHit calls inside the loop — and recycled after 16 further queries. `slice()` to keep one.
 *    Results are sorted nearest first. Queries only see LIVING actors; `filter` narrows further.
 *  - DEFAULT HOSTILITY: eclipse ⟷ every other team except neutral; contaminated ⟷ every other team except
 *    neutral; so player ⟷ eclipse / contaminated. dominion / reformation are hostile to the player (or to each
 *    other) only after `setHostile`. A team is never hostile to itself; protected NPCs are hostile to nobody.
 *  - `applyHit` ORDER: dead / untargetable / invulnerable / protectedNpc / i-frames → `immune`; guard (frontal
 *    `guardArc`, not `unblockable`): perfect → no damage and a melee attacker is staggered, else blocked (hp
 *    damage × `guardChip`, poise × 0.6, guard break at 0 poise) unless `heavy` and `guardStopsHeavy === false`;
 *    weak point (forced, or `point` inside an exposed weak-point sphere; not with `ignoreWeakPoints`); flank
 *    (`flankMultiplier`); frozen ×1.5; `damageTakenScale` / `poiseTakenScale`; difficulty when
 *    the target is the player; hp, poise → stagger, freeze, knockback, death. Then presentation (flash, hit
 *    reaction, impact VFX / SFX by material, hit-stop and shake when the player is involved) and `actor:hit`.
 *    The controller's `onHit` is called for every hit that was not `immune`.
 */
export interface ActorManager {
  readonly all: readonly Actor[];
  spawn(desc: ActorDesc): Actor;
  /**
   * remove immediately, or after a dissolve (the actor stops being alive / targetable at once and is removed
   * when the dissolve ends). No `actor:died` is emitted either way — use kill() for a death.
   * `keepVisual` (ADDED): take the visual's root out of the scene but do not dispose it — the caller keeps the
   * figure for reuse.
   */
  despawn(actor: Actor, opts?: { dissolve?: boolean; seconds?: number; keepVisual?: boolean }): void;
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

  // ---- ADDED by combat-player ----
  /**
   * ADDED. Bring a dead (not yet removed) actor back: alive, targetable as before, hp = `hp` (default max), poise
   * full, stagger / freeze cleared, death pose released. Used for the player on checkpoint reload and for
   * companions that recover. No-op on a living actor apart from the heal.
   */
  revive(actor: Actor, hp?: number): void;
  /** ADDED. true when `dir` (the hit's travel direction) strikes `target` from behind (> 100° off its facing). */
  isFlank(target: Actor, dir: Vec3Like): boolean;
  /**
   * ADDED. World position of an actor's exposed weak point (the first exposed one, or the exposed one called
   * `id`), or null when none is exposed. `out` is filled and returned.
   */
  weakPointPosition(actor: Actor, out: THREE.Vector3, id?: string): THREE.Vector3 | null;
  /** ADDED. Is team `a` hostile to team `b` (the matrix `areHostile` reads)? */
  teamsHostile(a: Team, b: Team): boolean;
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

/**
 * The protagonist. NOTES FOR AI / ZONE AUTHORS (implementation: src/combat/player/*, numbers: TUNING):
 *  - HITTING THE PLAYER: always through `actors.applyHit(game.player.actor, hit)` with a real `attacker`, a unit
 *    `dir` (the way the blow / bolt travels) and `kind`. That is what makes the kit work:
 *      · Tarrik holds guard: frontal 120° blocks hp damage (poise ×0.6; guard break at 0). A guard PRESS within
 *        0.22 s (× difficulty window) before a hit is a perfect guard — a melee attacker is staggered 1.6 s and a
 *        0.6 s counter window opens (attack = guaranteed 42 dmg / 90 poise riposte, unblockable).
 *      · Selene taps guard: a 0.5 s deflect stance over 150°. Every `kind: 'ranged'` hit in it is returned to
 *        `hit.attacker` as a ranged hit for 2× its damage (so give projectiles travel time and one applyHit per
 *        bolt); melee is parried only inside the timed window; `heavy` hits go straight through the stance.
 *      · Dodge: 0.30 s of i-frames (`immune`). Unblockable attacks (`unblockable: true`) must be dodged.
 *    Telegraph against these windows: the player needs ≥ 0.45 s of warning to answer.
 *  - WHAT THE PLAYER MAY ATTACK: living targetable actors that are hostile to team 'player', plus any actor
 *    tagged 'device' or 'objective' whatever its team. Never `protectedNpc`, never team 'player'.
 *    Melee and shots are stopped by solids (`physics.lineOfFire`); blades and Axiom shots test
 *    `ai.links.hitTest` and call `ai.links.sever(link, player.actor)`.
 *  - ECHO is paid by the brief's rules only (see addEcho). The controller pays hits, kills (`actor:died` with
 *    killer = the player's actor), blocks, counters, deflects and `device:disabled` (by = the player's actor)
 *    itself; the link system pays severs with `addEcho(0, 'sever')`.
 *  - `enabled = false` stops input but not the body: an action in progress finishes, scripted clips play
 *    (`playScripted`), context actions still confirm, and the actor can still be hit — make it `invulnerable`
 *    or call a ceasefire for cinematics.
 *  - Each protagonist keeps their own Echo and ammunition across handoffs; figures are cached, so switching
 *    back and forth builds nothing.
 */
export interface PlayerController {
  /** The current protagonist's actor (always exists after setProtagonist; a dead placeholder before it). */
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
  /**
   * Add Echo (clamped to 0..echoMax; no passive gain exists). RULE REASONS — 'blocked', 'counter', 'poiseBreak',
   * 'heavyHit', 'kill', 'weakPoint', 'flank', 'sever', 'deflect', 'device', 'hit' — are paid from the current
   * protagonist's table in the brief (`TUNING.kits[id].echo`), whatever `amount` says, and pay nothing to a
   * protagonist who does not earn from that rule (Tarrik gets no Echo for a sever). Any other reason adds
   * `amount` as given (scripts, pickups, debug). Emits `player:echo` when the value changes.
   */
  addEcho(amount: number, reason: string): void;
  heal(amount: number): void;
  /** mission-authored recovery values for a checkpoint: full hp, authored ammo + echo */
  restoreForCheckpoint(opts?: { echo?: number }): void;
  setAmmo(mag: number, reserve: number): void;

  lockTarget: Actor | null;
  godMode: boolean;
  /** 0..1 bounded local threat meter value shown on the HUD (set by AI corruption-pressure logic) */
  threat: number;

  /**
   * Open a contextual prompt. The window (seconds, final once set) is widened by the difficulty window scale;
   * with `settings.autoPrompts` an `autoConfirmable` action confirms itself after a short readable beat.
   * `onConfirm` or `onExpire` fires exactly once. Replacing the action or passing null cancels the old one
   * silently (neither callback). Works while `enabled` is false (authored duel / Resonance beats).
   */
  setContextAction(action: ContextAction | null): void;
  readonly contextAction: ContextAction | null;

  /** scripted one-off animation on the player figure while disabled (cinematics) */
  playScripted(action: string, opts?: { faceTo?: Vec3Like }): number;

  getHudState(): PlayerHudState;
  update(dt: number): void;

  // ---- ADDED by combat-player ----
  /**
   * ADDED. What the protagonist is doing: 'free' (moving / guarding / aiming), 'attack', 'charge' (heavy held),
   * 'dodge', 'deflect', 'counter', 'ability', 'stagger', 'dead'. For bots, tutorials and debug overlays.
   */
  readonly action: PlayerAction;
  /**
   * ADDED. true during the 3 s tactical-read pulse ('scan'). AI / zone code may brighten links, traces and weak
   * points while it is. The pulse itself flashes hostiles and devices and puts HUD markers on devices, actors
   * tagged 'objective' / 'source' and link midpoints.
   */
  readonly scanning: boolean;
  /** ADDED. true while movement is locked by setMovementLocked(true). */
  readonly movementLocked: boolean;
  /**
   * ADDED. Bot / script helper: turn the follow camera so that the AIM RAY (screen centre) passes through a
   * world point. `camera.aimAt()` turns the orbit toward the point as seen from the protagonist, which leaves
   * the reticle off target by the shoulder offset; this corrects that parallax. It converges within two or
   * three frames — call it every tick while lining up a shot or a throw. No-op while not in follow mode.
   */
  aimAt(point: Vec3Like): void;
  /**
   * ADDED (polish 3). Settle the protagonist at once, where it stands and as it faces: the swing / heavy charge /
   * dodge / deflect / counter / ability in progress is dropped (its clip fades out in 0.15 s; its hit never lands),
   * guard and aim are let go, the lock-on is released and the body stops. Cooldowns, ammo, Echo and held scripted
   * poses are untouched; a stagger plays out. Call it when a scene takes over the figure (before setting its yaw)
   * so the facing it sets holds from the first frame. Independently of this, while `enabled` is false nothing in
   * the controller turns the body (an unfinished wind-up, counter step or lock-on no longer writes the yaw).
   * Optional so hand-built controllers stay valid; the real one always has it.
   */
  cancelAction?(): void;
}

/** ADDED. See PlayerController.action. */
export type PlayerAction = 'free' | 'attack' | 'charge' | 'dodge' | 'deflect' | 'counter' | 'ability' | 'stagger' | 'dead';

/** ADDED. Pickup kinds for `spawnPickup` (exported from src/combat). */
export type PickupKind = 'sustain' | 'ammo' | 'echo';

/**
 * ADDED. Handle of a floating pickup made by `spawnPickup(game, kind, pos)` (import from '@/combat').
 * Collected when the living protagonist comes within 1.3 m AND it is useful (sustain below full health, ammo
 * below a full reserve, Echo below 100): +35 hp / magazine + reserve refilled / +20 Echo, `player:pickup`.
 * Pickups are removed on 'zone:loading'.
 */
export interface PickupHandle {
  readonly kind: PickupKind;
  readonly collected: boolean;
  remove(): void;
}

/**
 * Tunable numbers shared by combat + AI (single source of truth lives in src/combat/tuning.ts — import
 * `TUNING` from '@/combat/tuning'; it also carries the kits, movement, hit feel and the enemy stat table).
 */
export interface CombatTuning {
  difficultyDamageTaken: Record<'story' | 'standard' | 'hard', number>;
  difficultyWindow: Record<'story' | 'standard' | 'hard', number>;
}
