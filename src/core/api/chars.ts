/**
 * Character visuals contract — OWNERS: humanoids (src/chars/humanoid/*) own this file;
 * creatures (src/chars/creatures/*) add to ./creatures.ts.
 *
 * A CharacterVisual is PURELY presentational: a procedurally built, procedurally animated figure.
 * Gameplay (combat, AI) drives it through this interface and never reaches into its internals.
 * The owner's Actor sets root.position / root.rotation.y every tick; the visual animates within that frame.
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';

export type HumanoidArchetype =
  | 'tarrik'              // Dominion protagonist: heavy bronze/oxblood plate, cape, greatsword Velkorran, sidearm Cinderline
  | 'selene'              // Reformation protagonist: sleek navy/slate armour, cloak, Verity (circular hilt, opposed blades), Axiom
  | 'lyessa'              // Dominion officer, rifle
  | 'tharne'              // Reformation technical specialist
  | 'lyric'               // Reformation; carries the sealed case; Eclipse-sensitive
  | 'malik'               // injured Dominion soldier
  | 'dominionSoldier' | 'reformationSoldier' | 'reformationMarine'
  | 'enforcer'            // Dominion Enforcer: heavy, tower shield with energy rim, shock baton
  | 'medic' | 'survivor'
  | 'linkbound'           // Eclipse-coerced body in appropriated mixed-faction armour
  | 'kingWitness'         // luminous historical figure (Witness V) — never a combatant
  | 'cross' | 'sol';      // faction authorities seen on comm displays

export type CreatureArchetype =
  | 'secDrone'            // Reformation security drone (hovering)
  | 'contamDrone'         // contaminated state variant of the same drone
  | 'wallrunner'          // Eclipse wall/ceiling attacker
  | 'weaver'              // Eclipse link source
  | 'elite';              // regenerative breach organism (≈3.6 m)

export type DeviceArchetype =
  | 'commandEmitter'      // E1: physical emitter synchronising two drones
  | 'relayReceiver'       // E2: receivers A/B coordinating compromised drones
  | 'scanHead'            // Z03/Z04 fixed scanner
  | 'weaverAnchor'        // physical anchor of a Weaver link
  | 'frostAnchor';        // E4: visible frost anchor Selene moves to

export type Archetype = HumanoidArchetype | CreatureArchetype | DeviceArchetype;

/**
 * Animation actions. Visuals MUST accept any string: unknown actions fall back to a generic gesture and never throw.
 * One-shot actions blend out automatically; looping poses persist until stop() / another pose.
 */
export type AnimAction =
  // combat one-shots
  | 'attackLight1' | 'attackLight2' | 'attackLight3' | 'attackLight4' | 'attackHeavy' | 'attackHeavyCharge'
  | 'counter' | 'parry' | 'deflect' | 'dodge' | 'shoot' | 'throw' | 'slam' | 'dispatch'
  | 'hitLight' | 'hitHeavy' | 'stagger' | 'guardHit' | 'guardBreak' | 'knockdown' | 'getUp' | 'death'
  | 'shieldBash' | 'batonStrike' | 'lunge' | 'pounce' | 'leap' | 'sweep' | 'groundSlam' | 'charge' | 'roar'
  | 'weave' | 'pulse' | 'exposeJoint' | 'fracture' | 'spawnBreach' | 'spawnDrop'
  // looping poses
  | 'guard' | 'aim' | 'aimRifle' | 'frozen' | 'linkedSync' | 'ceilingCling' | 'hover'
  // narrative / ambient
  | 'idle' | 'talk' | 'listen' | 'point' | 'kneel' | 'kneelTend' | 'sit' | 'sitTalk' | 'sitInjured' | 'lieInjured'
  | 'trapped' | 'liftPlate' | 'interact' | 'holdConsole' | 'holdPlane' | 'assent' | 'handOver' | 'receive'
  | 'salute' | 'nod' | 'lookAround' | 'cower' | 'carryStretcher' | 'limp' | 'distress' | 'grounding'
  | 'lowerWeapon' | 'raiseWeapon' | 'floorStrike' | 'tetherStop' | 'turnAway' | 'walkAway'
  | (string & {});

export interface PlayOpts {
  /** playback rate (default 1) */
  speed?: number;
  /** force loop / one-shot (default depends on the action) */
  loop?: boolean;
  /** blend-in seconds (default 0.12) */
  fade?: number;
  /**
   * Named moments inside the action: 'hit' (strike connects), 'release' (projectile leaves hand/muzzle),
   * 'step', 'impact' (body/weapon hits ground), 'end'.
   */
  onEvent?: (name: string) => void;
  /** upper-body only (legs keep locomotion) */
  upperOnly?: boolean;
}

export interface ActionInfo {
  duration: number;
  /** seconds from start at which 'hit' / 'release' events fire */
  hitTimes: number[];
  loop: boolean;
}

export type SocketName =
  | 'root' | 'hips' | 'chest' | 'head' | 'handR' | 'handL' | 'back'
  | 'weaponTip' | 'weaponBase' | 'weaponMid' | 'muzzle' | 'shield' | 'eye' | 'core' | 'joint'
  | (string & {});

export interface CharacterVisual {
  readonly archetype: Archetype;
  /** Add to scene by whoever created it. Position/rotation.y are driven externally. */
  readonly root: THREE.Object3D;
  /** standing height in metres (for UI markers, camera, capsule) */
  readonly height: number;
  /** collision radius suggestion */
  readonly radius: number;

  /**
   * Locomotion blend input, called every tick by the driver.
   * speed: m/s planar. moveYaw: movement direction relative to facing (0 = forward, ±PI/2 strafe, PI = back).
   */
  setLocomotion(speed: number, moveYaw?: number, opts?: { sprint?: boolean; aiming?: boolean; guarding?: boolean; injured?: boolean }): void;

  /** Start an action. Returns its info (duration etc). */
  play(action: AnimAction, opts?: PlayOpts): ActionInfo;
  /** Stop a looping pose (or everything if omitted) and blend back to locomotion. */
  stop(action?: AnimAction, fade?: number): void;
  isPlaying(action?: AnimAction): boolean;
  info(action: AnimAction): ActionInfo;

  /** Head/eyes (and upper body slightly) look toward a world point; null = neutral. */
  lookAt(target: Vec3Like | null): void;
  /** Upper-body aim pitch in radians (for aiming up at balconies/drones). */
  setAimPitch(pitch: number): void;

  /** Attachment point updated every frame. Returns root for unknown names. */
  socket(name: SocketName): THREE.Object3D;

  /** Which held equipment is visible. */
  setLoadout(opts: { melee?: boolean; ranged?: boolean; shield?: boolean; prop?: 'case' | 'rifle' | 'none' }): void;

  /** Brief additive flash on the whole figure (hit confirm). */
  flash(color: number, seconds?: number): void;
  /** 0..1 frozen/arrested look (frost shell, desaturate, pose hold) */
  setFrozen(amount: number): void;
  /** 0..1 Eclipse corruption overlay amount */
  setCorruption(amount: number): void;
  /** 0..1 dissolve (1 = gone); used for deaths/spawns */
  setDissolve(amount: number, color?: number): void;
  /** emissive accents intensity multiplier (weapons, eyes, armour lines) */
  setGlow(amount: number): void;
  /** telegraph highlight (e.g. about to attack): 0..1 */
  setTelegraph(amount: number, color?: number): void;
  /** part exposure for weak points, e.g. elite 'joint' 0..1, drone 'vent' */
  setExposed(part: string, amount: number): void;
  /** soft outline/rim to keep the figure readable against dark stone: 0..1 */
  setRim(amount: number, color?: number): void;
  setVisible(v: boolean): void;

  /** Advance animation. dt in scaled seconds. */
  update(dt: number): void;
  dispose(): void;
}

export interface CharacterCreateOpts {
  /** deterministic variation (armour bits, proportions, damage) */
  seed?: number;
  variant?: number;
  /** initial corruption 0..1 */
  corruption?: number;
  /** scale multiplier */
  scale?: number;
}

export interface CharacterFactory {
  create(archetype: Archetype, opts?: CharacterCreateOpts): CharacterVisual;
  /** Pre-build geometry/material caches for a list of archetypes during loading. */
  warm(archetypes: Archetype[]): void;
}

// ---------------------------------------------------------------------------------------------
// Humanoid extras (src/chars/humanoid). `game.chars.create(<HumanoidArchetype>)` returns a HumanoidVisual;
// narrow with isHumanoidVisual() when you need the members below.
// ---------------------------------------------------------------------------------------------

/**
 * Sockets every humanoid exposes through CharacterVisual.socket():
 *  - `root`, `hips`, `chest` (= `core`), `head`, `eye` (between the eyes, for look/aim rays), `back`
 *  - `handR` / `handL`: palm grip points (attach carried objects here)
 *  - `weaponBase` / `weaponMid` / `weaponTip`: along the melee weapon (Velkorran, Verity's forward blade, baton);
 *    `weaponTip2`: Verity's rear blade tip. They follow the weapon whether held or sheathed — feed
 *    `weaponBase`/`weaponTip` to `vfx.trail()`.
 *  - `muzzle`: barrel end of the ranged weapon (falls back to the right palm if the archetype has none)
 *  - `shield`: centre of the Enforcer's shield face
 * Socket −Z is "forward / along the barrel or blade".
 */
export const HUMANOID_SOCKETS = [
  'root', 'hips', 'chest', 'core', 'head', 'eye', 'back', 'handR', 'handL',
  'weaponBase', 'weaponMid', 'weaponTip', 'weaponTip2', 'muzzle', 'shield',
] as const;

/**
 * Loadout rules for humanoids (CharacterVisual.setLoadout):
 *  - `melee: true` puts the melee weapon in the right hand; false sheathes it (Velkorran on the back, Verity's
 *    blades retract and the hilt ring hangs on the hip, baton on the belt).
 *  - `ranged: true` draws the ranged weapon into the right hand. While it is drawn the melee weapon is sheathed
 *    even if `melee` is still true, so a driver can simply toggle `ranged` while aiming.
 *  - `shield` shows / hides the Enforcer tower shield (left forearm).
 *  - `prop: 'case'` puts the sealed case in the left hand; `prop: 'rifle'` is the same as `ranged: true` for
 *    archetypes whose ranged weapon is a long gun.
 * Carry stance (idle / walk / run arm poses) follows the loadout automatically.
 *
 * Action notes: `hitLight`, `hitHeavy` and `guardHit` are ADDITIVE reactions — they never interrupt the action
 * in progress. `guard`, `aim`, `aimRifle` are looping upper-body poses that persist until stop(); they are also
 * applied automatically while setLocomotion(..., { guarding / aiming }) is set and no other looping pose plays.
 * `death`, `knockdown`, `lieInjured`, `sit*`, `kneel*`, `trapped` hold their final pose until stop() or the
 * next play(). Unknown action names play a small generic gesture and warn once.
 */
export interface HumanoidVisual extends CharacterVisual {
  readonly archetype: HumanoidArchetype;
  /** triangle count of the figure (budget checks) */
  readonly triangles: number;
  /**
   * Footfall callback, fired at each heel strike while moving (audio footsteps, vfx `footDust`).
   * `world` is a scratch vector — copy it if you keep it.
   */
  onFootstep: ((foot: 'L' | 'R', world: THREE.Vector3) => void) | null;
  /**
   * Pin a palm to a WORLD-space point with IK (consoles, lifting the plate, taking an offered object).
   * Blends in/out smoothly; null releases the hand. Reach is clamped to the arm's length.
   */
  setHandTarget(hand: 'L' | 'R', target: Vec3Like | null, weight?: number): void;
  /**
   * Call after moving the figure discontinuously (spawn, checkpoint reload, cinematic cut) so cloth and
   * motion smoothing restart from rest instead of whipping. Jumps over 3 m are also detected automatically.
   */
  teleported(): void;
}

/** Narrowing helper: true for visuals created from a HumanoidArchetype. */
export function isHumanoidVisual(v: CharacterVisual | null | undefined): v is HumanoidVisual {
  return !!v && typeof (v as Partial<HumanoidVisual>).setHandTarget === 'function' && typeof (v as Partial<HumanoidVisual>).teleported === 'function';
}

/** Every action a humanoid has an authored clip for (others fall back to a generic gesture). */
export const HUMANOID_ACTIONS: readonly AnimAction[] = [
  'attackLight1', 'attackLight2', 'attackLight3', 'attackLight4', 'attackHeavy', 'attackHeavyCharge',
  'counter', 'parry', 'deflect', 'dodge', 'shoot', 'throw', 'slam', 'dispatch',
  'hitLight', 'hitHeavy', 'stagger', 'guardHit', 'guardBreak', 'knockdown', 'getUp', 'death',
  'shieldBash', 'batonStrike', 'lunge', 'roar', 'spawnBreach',
  'guard', 'aim', 'aimRifle', 'frozen', 'linkedSync',
  'idle', 'talk', 'listen', 'point', 'kneel', 'kneelTend', 'sit', 'sitTalk', 'sitInjured', 'lieInjured',
  'trapped', 'liftPlate', 'interact', 'holdConsole', 'holdPlane', 'assent', 'handOver', 'receive',
  'salute', 'nod', 'lookAround', 'cower', 'carryStretcher', 'limp', 'distress', 'grounding',
  'lowerWeapon', 'raiseWeapon', 'floorStrike', 'tetherStop', 'turnAway', 'walkAway',
];
