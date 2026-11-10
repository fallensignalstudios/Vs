/**
 * Creature + device visuals — OWNER: creatures (src/chars/creatures/*).
 * Creatures and devices implement CharacterVisual from ./chars. Add creature-specific extras here.
 *
 * QUICK GUIDE FOR AI / ZONE AUTHORS
 *   const v = game.chars.create('elite');            // or createCreature(game, 'elite')
 *   scene.add(v.root);  v.root.position / v.root.rotation.y are yours;  call v.update(dt) every tick.
 *   v.play('groundSlam', { onEvent: (e) => e === 'hit' && shockwave() });   // see CREATURE_ACTIONS
 *   v.setExposed('joint', 1);  v.setFrozen(0.4);  v.setTelegraph(1, 0xff3b2a);  v.socket('joint')
 *   asWallrunner(v)?.setCling({ height: 5, wallYaw: Math.PI / 2 });         // typed extensions, null-safe
 *
 * CONVENTIONS
 *  - Model front is −Z (engine yaw convention). Ground creatures stand on the root origin; DRONES are centred
 *    on the root origin (the hover point — Actor.pos already includes hoverHeight).
 *  - Every visual accepts ANY action string: unknown actions warn once and play a short generic gesture.
 *  - `play()` returns ActionInfo; `hitTimes` are the seconds at which 'hit' (melee connects) or 'release'
 *    (projectile / pulse leaves) fire through PlayOpts.onEvent. Other event names: 'impact' (body or limb hits
 *    the ground), 'step' (elite footfall inside an action), 'launch' / 'land' (wallrunner pounce), 'end'.
 *  - Deaths hold their final pose. Eclipse bodies (wallrunner, weaver, elite, weaverAnchor) dissolve by
 *    themselves at the end of 'death'; machines and devices stay as wreckage until disposed.
 *  - `setFrozen(n)` arrests the animation clock as well as frosting the surface. On the elite the frost creeps
 *    outward from the regenerating joint, so n ≈ 0.3 reads as "joint arrested", n = 1 as a full stasis.
 *  - `setCorruption(n)` ADDS to the creature's authored baseline (Eclipse bodies are already corrupted).
 *  - Eclipse-made things twitch / pulse on one shared cadence: game.ai.links.cadence when the link system is
 *    live, otherwise an internal clock of the same period (CADENCE_PERIOD in src/chars/creatures/core/cadence).
 *  - Cost: one draw call and one shared shader program per creature/device, no lights, no textures.
 */
import type { CharacterVisual, CreatureArchetype, DeviceArchetype, CharacterCreateOpts } from './chars';
import type { Vec3Like } from './common';

export type CreatureCreate = (archetype: CreatureArchetype | DeviceArchetype, opts?: CharacterCreateOpts) => CharacterVisual;

/**
 * Canonical extra sockets creatures/devices expose via CharacterVisual.socket():
 *  - drones: 'muzzle', 'eye', 'vent' (rear weak point), 'core'
 *  - wallrunner: 'head', 'core'
 *  - weaver: 'core' (link origin), 'head'
 *  - elite: 'joint' (regenerating joint / Resonance target), 'core', 'head', 'handL', 'handR'
 *  - commandEmitter / relayReceiver / scanHead / weaverAnchor / frostAnchor: 'core' (beam origin), 'top'
 */
export const CREATURE_SOCKETS = ['muzzle', 'eye', 'vent', 'core', 'joint', 'head', 'top'] as const;

/**
 * Every socket each archetype provides (all also accept 'root'; unknown names return the root).
 * 'top' is always the highest point worth hanging a UI marker on; 'core' the beam / link / aim origin.
 */
export const CREATURE_SOCKET_MAP: Readonly<Record<CreatureArchetype | DeviceArchetype, readonly string[]>> = {
  secDrone: ['core', 'eye', 'muzzle', 'vent', 'head', 'top'],
  contamDrone: ['core', 'eye', 'muzzle', 'vent', 'head', 'top'],
  wallrunner: ['core', 'head', 'eye', 'chest', 'hips', 'top'],
  weaver: ['core', 'head', 'eye', 'chest', 'handL', 'handR', 'top'],
  elite: ['core', 'joint', 'head', 'eye', 'chest', 'hips', 'handL', 'handR', 'weaponTip', 'back', 'top'],
  commandEmitter: ['core', 'top', 'prongL', 'prongR'],
  relayReceiver: ['core', 'top', 'dish'],
  scanHead: ['core', 'eye', 'top'],
  weaverAnchor: ['core', 'top'],
  frostAnchor: ['core', 'top'],
};

/**
 * Canonical actions per archetype (aliases from AnimAction are accepted too, e.g. 'attackLight1' → the
 * creature's primary attack, 'hover'/'frozen'/'linkedSync' → idle, 'spawnDrop'/'spawnBreach' → spawn).
 *  - drones: idle, shoot (single bolt, 'release'), volley (three 'release's), scan, hitLight, hitHeavy,
 *    stagger, spawn, death ('impact' when the hull hits the floor)
 *  - wallrunner: idle, lunge, pounce / leap ('launch', 'hit', 'land'; detaches a cling by itself),
 *    ceilingCling (looping watch pose), hitLight, hitHeavy, stagger, spawn, death
 *  - weaver: idle, weave (channel loop), pulse (bolt, 'release'), hitLight, hitHeavy, stagger (filaments go
 *    slack), spawn, death
 *  - elite: idle, sweep, groundSlam ('hit' = shockwave), charge, roar, pulse ('release' = pressure pulse),
 *    regenerate (loop), exposeJoint, fracture, hitLight, hitHeavy, stagger, spawn, death
 *  - devices: idle, hitLight, hitHeavy, stagger, disabled (held: lights out, slumped), death (break apart);
 *    frostAnchor adds 'activate' (held: ring lit, crystals risen)
 */
export const CREATURE_ACTIONS: Readonly<Record<CreatureArchetype | DeviceArchetype, readonly string[]>> = {
  secDrone: ['idle', 'shoot', 'volley', 'scan', 'hitLight', 'hitHeavy', 'stagger', 'spawn', 'death'],
  contamDrone: ['idle', 'shoot', 'volley', 'scan', 'hitLight', 'hitHeavy', 'stagger', 'spawn', 'death'],
  wallrunner: ['idle', 'lunge', 'pounce', 'leap', 'ceilingCling', 'hitLight', 'hitHeavy', 'stagger', 'spawn', 'death'],
  weaver: ['idle', 'weave', 'pulse', 'hitLight', 'hitHeavy', 'stagger', 'spawn', 'death'],
  elite: ['idle', 'sweep', 'groundSlam', 'charge', 'roar', 'pulse', 'regenerate', 'exposeJoint', 'fracture', 'hitLight', 'hitHeavy', 'stagger', 'spawn', 'death'],
  commandEmitter: ['idle', 'hitLight', 'hitHeavy', 'stagger', 'disabled', 'death'],
  relayReceiver: ['idle', 'hitLight', 'hitHeavy', 'stagger', 'disabled', 'death'],
  scanHead: ['idle', 'hitLight', 'hitHeavy', 'stagger', 'disabled', 'death'],
  weaverAnchor: ['idle', 'hitLight', 'hitHeavy', 'stagger', 'disabled', 'death'],
  frostAnchor: ['idle', 'activate', 'hitLight', 'disabled', 'death'],
};

/** Parts accepted by setExposed(part, 0..1) per archetype. Unknown parts are stored and ignored. */
export const CREATURE_EXPOSABLE: Readonly<Partial<Record<CreatureArchetype | DeviceArchetype, readonly string[]>>> = {
  secDrone: ['vent'],
  contamDrone: ['vent'],
  wallrunner: ['core'],
  weaver: ['core'],
  elite: ['joint', 'core'],
  commandEmitter: ['core'],
  relayReceiver: ['core'],
  weaverAnchor: ['core'],
};

// ---------------------------------------------------------------------------------------------------------
// Extension interfaces. Obtain them with the as*() helpers below (null when the visual is another kind).
// ---------------------------------------------------------------------------------------------------------

/** secDrone / contamDrone */
export interface DroneVisual extends CharacterVisual {
  /**
   * Distance from the hover point down to the floor in metres (default 1.8). The 'death' animation drops the
   * hull this far inside its own frame; pass 0 if the driver lowers the root itself.
   */
  setHoverHeight(h: number): void;
}

export interface WallrunnerCling {
  /** metres above the actor's ground position (root origin) where the body centre clings */
  height: number;
  /**
   * World yaw of the wall's OUTWARD normal (the direction pointing from the wall into the room, engine yaw
   * convention). Omit / null for a ceiling: the body hangs inverted at `height`.
   */
  wallYaw?: number | null;
  /** metres the body is shifted from the root toward the wall (against the normal). Default 0. */
  inset?: number;
}

export interface WallrunnerVisual extends CharacterVisual {
  /**
   * Place the body up on a wall or ceiling above its ground position (the root stays on the floor so the Actor
   * keeps a valid nav position). The body re-orients belly-to-surface and keeps skittering with setLocomotion;
   * on a wall it faces along the wall in the root's heading (head-down when the heading points into the room).
   * null returns it to the floor. `blendSeconds` (default 0.35) is the scramble time.
   * 'pounce' / 'leap' played while clinging detach by themselves at their 'launch' event and arc to the floor.
   */
  setCling(cling: WallrunnerCling | null, blendSeconds?: number): void;
  readonly clinging: boolean;
}

export interface WeaverVisual extends CharacterVisual {
  /**
   * Point one of the three link arms at a world position (the linked body / anchor); null releases it back
   * into the braid. The link beam itself is VFX — start it at socket('core').
   */
  setLinkTarget(index: number, target: Vec3Like | null): void;
  /** 0..1 filament slackness held outside the 'stagger' action (1 = all links cut, arms hanging). */
  setSlack(amount: number): void;
}

export interface EliteVisual extends CharacterVisual {
  /** 0..1 regeneration presentation layered on any pose: plates knitting in waves, violet flow, core swell. */
  setRegenerating(amount: number): void;
  /**
   * Force the joint's fractured state (shattered plates gone, cauterised stump, no regeneration glow).
   * play('fracture') sets it; pass false to restore the joint (checkpoint reload).
   */
  setFractured(fractured: boolean): void;
  readonly fractured: boolean;
  /** Called on every planted footfall of the walk cycle and attack steps (camera shake / dust / audio). */
  onFootfall: ((side: 'L' | 'R', strength: number) => void) | null;
}

/** all devices */
export interface DeviceVisual extends CharacterVisual {
  /**
   * Powered-down state reached by a close-interaction disable: lights out, moving parts slumped, held until
   * re-enabled. (play('death') is the destroyed state: the device breaks apart.)
   */
  setDisabled(disabled: boolean): void;
  readonly disabled: boolean;
}

export interface CommandEmitterVisual extends DeviceVisual {
  /** Aim one of the two prongs (0 = left, 1 = right) at a world point — the drone it synchronises. null = idle sweep. */
  setProngTarget(index: number, target: Vec3Like | null): void;
  /** 0..1 flare of the crown on a synchronised volley (call with 1 when the volley is released; decays itself). */
  pulseSync(strength?: number): void;
}

export interface ScanHeadVisual extends DeviceVisual {
  /**
   * Head yaw relative to the root in radians (+ = left). The lens looks along root yaw + sweep, pitched by
   * setAimPitch(); lookAt() overrides both. The base is rotationally plain, so drivers may equally sweep by
   * rotating the root.
   */
  setSweep(yaw: number): void;
}

export interface FrostAnchorVisual extends DeviceVisual {
  /** 0..1 — Selene is standing on it / channelling: ring brightens, rime crystals rise. */
  setActive(amount: number): void;
}

function has(v: CharacterVisual | null | undefined, method: string): boolean {
  return !!v && typeof (v as unknown as Record<string, unknown>)[method] === 'function';
}

/** Typed access to drone extras (also true for null-object stubs, whose calls no-op). */
export function asDrone(v: CharacterVisual | null | undefined): DroneVisual | null {
  return has(v, 'setHoverHeight') ? (v as DroneVisual) : null;
}
export function asWallrunner(v: CharacterVisual | null | undefined): WallrunnerVisual | null {
  return has(v, 'setCling') ? (v as WallrunnerVisual) : null;
}
export function asWeaver(v: CharacterVisual | null | undefined): WeaverVisual | null {
  return has(v, 'setLinkTarget') ? (v as WeaverVisual) : null;
}
export function asElite(v: CharacterVisual | null | undefined): EliteVisual | null {
  return has(v, 'setFractured') ? (v as EliteVisual) : null;
}
export function asDevice(v: CharacterVisual | null | undefined): DeviceVisual | null {
  return has(v, 'setDisabled') ? (v as DeviceVisual) : null;
}
export function asCommandEmitter(v: CharacterVisual | null | undefined): CommandEmitterVisual | null {
  return has(v, 'setProngTarget') ? (v as CommandEmitterVisual) : null;
}
export function asScanHead(v: CharacterVisual | null | undefined): ScanHeadVisual | null {
  return has(v, 'setSweep') ? (v as ScanHeadVisual) : null;
}
export function asFrostAnchor(v: CharacterVisual | null | undefined): FrostAnchorVisual | null {
  return has(v, 'setActive') ? (v as FrostAnchorVisual) : null;
}
