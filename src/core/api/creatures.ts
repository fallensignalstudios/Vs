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
 *   asCreature(v)?.revive();                                                 // pooled visual back to life
 *
 * CONVENTIONS
 *  - Model front is −Z (engine yaw convention). Ground creatures stand on the root origin; DRONES are centred
 *    on the root origin (the hover point — Actor.pos already includes hoverHeight).
 *  - Every visual accepts ANY action string: unknown actions warn once and play a short generic gesture
 *    (tracked under the name you passed: isPlaying('talk') is true, isPlaying('salute') is not).
 *  - `play()` returns ActionInfo; `hitTimes` are the seconds at which 'hit' (melee connects) or 'release'
 *    (projectile / pulse / roar leaves) fire through PlayOpts.onEvent. Other event names: 'impact' (body or
 *    limb hits the ground), 'step' (elite footfall inside an action), 'launch' / 'land' (wallrunner pounce),
 *    'end'. PlayOpts.upperOnly is ignored: creature actions are whole-body by design.
 *
 * ACTION MODEL (differs from "last play wins" — read this before writing AI)
 *  - MAIN actions (attacks, stagger, spawn, death, loops) cross-fade: starting one fades the previous one out
 *    and CANCELS its remaining events. An interrupted attack never delivers its hit.
 *  - REACTIONS — `hitLight`, `hitHeavy` and unknown gestures — are ADDITIVE, exactly as for humanoids: they
 *    layer over whatever is playing and never interrupt it. Chip damage cannot stun-lock the elite; only
 *    `stagger`, `fracture`, `death` or another main action end an attack. isPlaying() with no argument reports
 *    main actions only.
 *  - `idle` (and aliases such as 'hover', 'frozen') is the ABSENCE of a main action, not a slot: play('idle')
 *    blends the current action out; isPlaying('idle') is true while nothing else plays.
 *  - `death` is TERMINAL. It holds its final pose (Eclipse bodies — wallrunner, weaver, elite, weaverAnchor —
 *    then dissolve by themselves; machines and devices stay as wreckage). While dead, play() of anything but a
 *    spawn, stop(), lookAt() and hit reactions are ignored, so late hits and AoE on a corpse are harmless.
 *    Bring a pooled visual back with asCreature(v).revive() or by playing 'spawn'.
 *  - Device `disabled` is a STATE, not just an action: play('disabled') ≡ setDisabled(true), and it persists
 *    through stop(). Clear it with setDisabled(false) or stop('disabled').
 *
 * FREEZE
 *  - `setFrozen(n)` frosts the surface and arrests the animation clock (fully at n ≥ 0.8; the elite's frost
 *    creeps outward from the regenerating joint, so n ≈ 0.3 reads as "joint arrested" and only slows it).
 *    ActionInfo times are in that clock: ordinary actions on a partly frozen body run proportionally late.
 *  - `death`, `fracture` and the hit reactions IGNORE the freeze and run in real game time — a stasis kill dies
 *    on schedule and the Thermal Fracture lands its 'impact' at 1.3 s whatever the joint's frost. Both also
 *    shatter the frost themselves: the visual thaws within ~0.2 s and stays thawed until you call
 *    setFrozen(0) (so keep calling setFrozen(n) every tick if you like — it is ignored until released).
 *
 * LOOK
 *  - `setCorruption(n)` ADDS to the creature's authored baseline (Eclipse bodies are already corrupted).
 *  - Every creature carries an authored readability rim (faction blue on drones, cold pale violet on Eclipse
 *    bodies); setRim(n, colour) layers over it and setRim(0) returns to it.
 *  - Eclipse-made things twitch / pulse on one shared cadence: game.ai.links.cadence when the link system is
 *    live, otherwise an internal clock of the same period (CADENCE_PERIOD in src/chars/creatures/core/cadence).
 *  - CharacterCreateOpts.seed desynchronises idle phases and wreck trajectories; it does not vary geometry.
 *  - Cost: one draw call and one shared shader program per creature/device, no lights, no textures (the
 *    skinned elite: two draw calls and the generated mesh's maps).
 *  - A hidden visual (setVisible(false)) still runs its action clocks and events but is not posed.
 *
 * THE ELITE'S TWO BODIES
 *  - The elite's animator can wear the generated hero mesh (public/models/elite.glb) as a skin. Skins are
 *    optional: await preloadCreatureSkins(['elite'], game) (src/chars/creatures) during loading — game.chars
 *    .preload(cast) does this for every creature in a zone's cast — its maps are fitted to
 *    game.render.quality.textureSize, and it draws baked levels of detail at distance (public/models/elite.lod.bin);
 *    an elite created before the file has arrived shows its
 *    procedural body and swaps when it does; with no file (or setCreatureSkinsEnabled(false)) it stays
 *    procedural. The skinned elite is two draw calls: the generated body and its procedural tendril wreath.
 *    Actions, events, timings and sockets are identical on both bodies.
 *  - The regenerating joint is the creature's RIGHT shoulder (+X in model space) on BOTH bodies. The generated
 *    file has it on its left; it is mirrored on load. (manifest.json's `weakPoint` is in the file's own
 *    space — use socket('joint'), never the manifest numbers.)
 */
import type { CharacterVisual, CreatureArchetype, DeviceArchetype, CharacterCreateOpts } from './chars';
import type { Vec3Like } from './common';

export type CreatureCreate = (archetype: CreatureArchetype | DeviceArchetype, opts?: CharacterCreateOpts) => CharacterVisual;

/**
 * Canonical extra sockets creatures/devices expose via CharacterVisual.socket():
 *  - drones: 'muzzle', 'eye', 'vent' (rear weak point), 'core'
 *  - wallrunner: 'head', 'core'
 *  - weaver: 'core' (link origin), 'head'
 *  - elite: 'joint' (regenerating joint / Resonance target — its RIGHT shoulder), 'core', 'head', 'handL', 'handR';
 *    'weaponBase' / 'weaponMid' / 'weaponTip' run down the right (club) arm for vfx.trail()
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
  elite: ['core', 'joint', 'head', 'eye', 'chest', 'hips', 'handL', 'handR', 'weaponBase', 'weaponMid', 'weaponTip', 'back', 'top'],
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
 *  - elite: idle, sweep, groundSlam ('hit' = shockwave), charge, roar ('release' = the roar leaves),
 *    pulse ('release' = pressure pulse), regenerate (loop), exposeJoint, fracture, hitLight, hitHeavy, stagger,
 *    spawn, death
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

/**
 * Visual extents at bind, in metres along the model axes (front = −Z), for placing things AROUND a creature:
 * spawn clearances, wall stand-off, markers, camera framing. `CharacterVisual.radius` / `.height` are the
 * COLLISION suggestions and are deliberately smaller — legs, arms, tails and spines reach well outside them.
 * Scale by CharacterCreateOpts.scale. `bottom` is negative only for drones (centred on the hover point).
 */
export interface CreatureBounds {
  halfWidth: number;
  front: number;
  rear: number;
  top: number;
  bottom: number;
}
export const CREATURE_BOUNDS: Readonly<Record<CreatureArchetype | DeviceArchetype, CreatureBounds>> = {
  secDrone: { halfWidth: 0.6, front: 0.45, rear: 0.36, top: 0.45, bottom: -0.2 },
  contamDrone: { halfWidth: 0.6, front: 0.45, rear: 0.37, top: 0.45, bottom: -0.65 },
  wallrunner: { halfWidth: 0.97, front: 1.2, rear: 1.47, top: 1.1, bottom: -0.05 },
  weaver: { halfWidth: 1.6, front: 0.85, rear: 1.2, top: 2.78, bottom: -0.05 },
  elite: { halfWidth: 1.78, front: 1.45, rear: 1.85, top: 4.1, bottom: -0.05 },
  commandEmitter: { halfWidth: 1.06, front: 0.56, rear: 0.76, top: 2.02, bottom: 0 },
  relayReceiver: { halfWidth: 0.8, front: 0.66, rear: 0.5, top: 2.8, bottom: 0 },
  scanHead: { halfWidth: 0.9, front: 0.45, rear: 0.4, top: 2.02, bottom: 0 },
  weaverAnchor: { halfWidth: 1.5, front: 1.05, rear: 1.16, top: 1.4, bottom: -0.02 },
  frostAnchor: { halfWidth: 0.95, front: 0.8, rear: 1.02, top: 0.6, bottom: 0 },
};

// ---------------------------------------------------------------------------------------------------------
// Extension interfaces. Obtain them with the as*() helpers below (null when the visual is another kind).
// ---------------------------------------------------------------------------------------------------------

/** every creature and device */
export interface CreatureVisual extends CharacterVisual {
  /** true from play('death') until revive() or a spawn action */
  readonly dead: boolean;
  /**
   * Bring a dead (or dissolved) visual back to its living idle: clears every action, the death dissolve and
   * the telegraph. For pooled visuals and checkpoint reloads. (setDissolve / setFrozen values YOU set stay.)
   */
  revive(): void;
}

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
  /**
   * Called on every planted footfall: the walk cycle, turn-steps while it tracks a target in place, and the
   * 'step' events inside actions (sweep, groundSlam, charge, roar, pulse, exposeJoint, fracture, stagger).
   * `strength` 0..1 — camera shake / dust / audio.
   */
  onFootfall: ((side: 'L' | 'R', strength: number) => void) | null;
  /** true while the generated mesh is worn (see "THE ELITE'S TWO BODIES" above) */
  readonly skinned: boolean;
}

/** all devices */
export interface DeviceVisual extends CharacterVisual {
  /**
   * Powered-down state reached by a close-interaction disable: lights out, moving parts slumped, held until
   * re-enabled — it survives stop() and other actions. (play('death') is the destroyed state: the device
   * breaks apart and its wreckage comes to rest on the floor.)
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

/** Typed access to the members every creature / device has (also true for null-object stubs, whose calls no-op). */
export function asCreature(v: CharacterVisual | null | undefined): CreatureVisual | null {
  return has(v, 'revive') ? (v as CreatureVisual) : null;
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
