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
  | 'malik'               // Centurion Malik Varo, injured (Z02): unarmed, dressings — the generated `varo` body
  | 'varo'                // ADDED (integration) Centurion Malik Varo, armed (Z00/Z01): bare-headed, Dominion rifle — `varo` body
  | 'officer'             // ADDED (integration) the Z08 Dominion officer found alive inside the organism — `officer` body
  | 'dominionSoldier' | 'reformationSoldier' | 'reformationMarine'
  | 'enforcer'            // Dominion Enforcer: heavy, tower shield with energy rim, shock baton
  | 'medic' | 'survivor'
  | 'linkbound'           // Eclipse-coerced body in appropriated mixed-faction armour
  | 'kingWitness'         // the King in Witness V (luminous, never a combatant) — the generated `king` body
  | 'vesryn'              // ADDED (integration) the King's chronicler in Witness V, no halo — the `vesryn` body
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
  // ADDED (polish 3) — see ACTION RULES (humanoids)
  | 'breath' | 'verityCollapsed' | 'igniteBlades'
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
   * Humanoids also send 'cancel' instead of 'end' when a one-shot is replaced by another play() or stopped
   * before it finished — every one-shot ends with exactly one of the two.
   */
  onEvent?: (name: string) => void;
  /** upper-body only (legs keep locomotion) */
  upperOnly?: boolean;
  /**
   * Start a one-shot this many seconds into its clip (humanoids). The returned ActionInfo is shortened to match.
   * Not needed for charged heavies: `attackHeavy` played while `attackHeavyCharge` is held starts at its coil
   * automatically (see HumanoidVisual).
   */
  startAt?: number;
  /**
   * Direction of the resulting body motion, relative to facing and in the moveYaw convention (0 = forward,
   * +PI/2 = to the figure's left, PI = backward). Humanoids use it for `dodge` (picks the forward / back / side
   * roll; defaults to the last moveYaw passed to setLocomotion) and for `hitLight` / `hitHeavy` / `guardHit`
   * (the way the blow shoves the body; default PI = struck from the front).
   */
  dir?: number;
  /**
   * ADDED (polish 4). Humanoids, held upper-body poses (such as `verityCollapsed`): the pose
   * survives `stop()` called WITHOUT an action — what a companion's stopAction() and mode changes do — and any
   * full-body loop played over it; only `stop('<that action>')`, or another held upper-body pose, ends it.
   * Z09: `selene.visual.play('verityCollapsed', { persist: true })` keeps Verity collapsed in her hand while she
   * follows (the AI must also leave the pose alone: see the AI report).
   */
  persist?: boolean;
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

  /**
   * Brief hit-confirm flash: an edge (fresnel) tint plus a lift of the surface's own albedo in `color` — the
   * figure's design stays readable at the peak; it is never a flat fill. `seconds` default 0.12 (linear decay).
   * ADDED: `strength` 0..1.5, default 1 (a punchy enemy confirm). Use ~0.5 on the protagonist (a hurt flash
   * must not read as a damage state or hide the character), ~0.4–0.6 for block/charge cues.
   * Polish 3: up to 0.6 a flash is a thin RIM only (no colour on the body at all); the albedo lift and the wider
   * band fade in between 0.6 and 1.
   */
  flash(color: number, seconds?: number, strength?: number): void;
  /**
   * 0..1 frozen/arrested look (frost shell, desaturate, pose hold). ADDED (polish 3, humanoids): `opts.region`
   * localizes it — see FrozenOpts. Creatures ignore `opts`.
   */
  setFrozen(amount: number, opts?: FrozenOpts): void;
  /**
   * 0..1 Eclipse corruption overlay amount. ADDED (polish 3, humanoids): `opts.mode` 'face' / 'halfFace' — see
   * CorruptionOpts. The mode is remembered until another call passes one. Creatures ignore `opts`.
   */
  setCorruption(amount: number, opts?: CorruptionOpts): void;
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

/**
 * ADDED (polish 3). Where setFrozen's frost goes (humanoids; procedural and generated bodies alike).
 *  - 'body' (default): the whole figure — the classic arrest: frost shell, colour drained, animation slowed by
 *    (1 − amount).
 *  - 'lead' (= 'footL', the forward foot of a right-handed guard), 'footR', 'feet': ice locked round that boot
 *    only, up to its top — a thick, solid shell with a ragged crystalline edge. Nothing else changes: no colour
 *    drain, no slowing, the figure keeps acting (Z05: "she locks ice round his lead boot; he walks out of it").
 *    Use amount 1 for a fully encased boot, ~0.5 for a crust.
 * The region stays until the next setFrozen call (which sets it again, 'body' when omitted).
 */
export interface FrozenOpts {
  region?: 'body' | 'lead' | 'footL' | 'footR' | 'feet';
}

/**
 * ADDED (polish 3). How setCorruption's corruption is shown (humanoids).
 *  - 'body' (default): it climbs over the figure from one flank.
 *  - 'face': the face only — violet in the irises, thin dark veins at the temples and down the neck that reach
 *    further as the amount rises (Lyric, "the black patterns in her iris, at her neck"). Nothing else is touched.
 *  - 'halfFace': on the head exactly one half is taken (dark tissue, violet veins), split down the middle by a
 *    ragged line — the other half stays human. The rest of the figure keeps its own look. `side` picks the taken half (default 'right', the figure's right). Needs a face: see
 *    CharacterCreateOpts.halfHuman for the linkbound.
 * The mode (and side) are remembered until a later call passes another.
 *
 * POLISH 4 (generated bodies): the 'face' mode's irises have depth (a black pupil, violet fibres brightening toward
 * it, a dark limbal ring, the light held inside the eye) and its veins are thick enough to read at 2 m.
 */
export interface CorruptionOpts {
  mode?: 'body' | 'face' | 'halfFace';
  side?: 'left' | 'right';
  /**
   * ADDED (polish 4). Generated bodies, any mode (meant for 'face'): black patterns with light running in them,
   * down BOTH arms from the shoulders — 0 none, 0.5 to the elbows, 1 to the fingertips. Animate it to make them
   * "race down both arms" (Z06): e.g. ramp it 0 → 1 over ~1.2 s in the zone's update, snapping when skipping.
   * Remembered until a later call passes another value, and independent of `amount` (pass `arms: 0` to clear it).
   *   visual.setCorruption(0.8, { mode: 'face', arms: 1 })
   */
  arms?: number;
}

export interface CharacterCreateOpts {
  /** deterministic variation (armour bits, proportions, damage) */
  seed?: number;
  variant?: number;
  /** initial corruption 0..1 */
  corruption?: number;
  /** scale multiplier */
  scale?: number;
  /**
   * Humanoids only: build an animation DRIVER instead of a figure — the full rig, animator, sockets and cloth
   * simulation, but no body geometry (zero triangles, nothing to build or cache). Used to animate another mesh
   * (a generated GLB) with the procedural moveset; copy bone transforms from the driver's skeleton each frame.
   */
  driverOnly?: boolean;
  /** with `driverOnly`: procedural parts to keep as the only drawn geometry (e.g. the cape, a weapon fallback) */
  keep?: Array<'cloth' | 'melee' | 'ranged' | 'shield' | 'case'>;
  /**
   * Generated helmeted soldiers (`dominionSoldier`, `cross`, `reformationSoldier`, …): draw the figure without its
   * helmet, with a bare head (a generated civilian head, re-tinted to an older, greying officer) — for a named
   * soldier whose face must be seen. `malik` is always bare-headed (his own look). Ignored by archetypes that
   * already show their face and by procedural figures. The head's model is fetched with the body; until both are
   * loaded the procedural figure stands in, as for any generated body.
   */
  bareHead?: boolean;
  /**
   * ADDED (polish 3). `linkbound` only: "half the face remains human". The figure is drawn bare-headed (a human
   * head grafted on, as `bareHead`) and starts with corruption 1 in 'halfFace' mode, so the right half of the face
   * is taken and the left half is a man's. Change the amount or the side later with
   * `setCorruption(a, { mode: 'halfFace', side })`. Ignored by other archetypes.
   */
  halfHuman?: boolean;
  /**
   * ADDED (polish 3). `kingWitness` only: false = without the King's five-point halo. Default true. (Integration:
   * Vesryn now has his own archetype, `vesryn`, which never has a halo — use it rather than a haloless King.)
   */
  halo?: boolean;
  /**
   * ADDED (integration). Generated bodies only (meant for the King in Witness V: «armour broken along one shoulder.
   * Blood runs beneath one eye»): the plate of the figure's LEFT shoulder cracked, chipped to the dark metal under it
   * and scorched; a run of blood from under the RIGHT eye down the cheek; ash greying the hair. A surface tint in
   * the body's shader (no geometry, no draw call); procedural figures ignore it.
   * POLISH 4: made to read at 3–6 m (the Witness V framing): whole flakes of the shoulder plate gone to dark metal
   * with bright torn edges, cracks running out across the plate, soot, dried blood down the front of the plate;
   * the eye's blood is wider, runs to the jaw and is smeared round the eye; more ash in the hair.
   */
  wounded?: boolean;
  /**
   * ADDED (polish 4). With `wounded`: which shoulder is broken — 'left' (default, the figure's left) or 'right'.
   * Put it on the side the camera sees: in a three-quarter view from the figure's right, use 'right'.
   */
  woundSide?: 'left' | 'right';
}

export interface CharacterFactory {
  /**
   * Humanoid archetypes that have a generated body in public/models (the five leads, soldiers, Enforcer,
   * Linkbound, survivors; integration: `malik` / `varo` → varo.glb, `officer` → officer.glb, `kingWitness` →
   * king.glb, `vesryn` → vesryn.glb) return it, animated by the procedural moveset: same actions, timings, events and
   * sockets as the procedural figure (see HumanoidVisual). When the model files are not loaded yet the visual
   * starts as the procedural figure and switches by itself on a later update(); when they cannot be loaded it
   * stays procedural. `height` follows the body that is drawn. Call preload() while a zone loads to avoid the
   * switch being seen.
   * Generated bodies, their props and the elite's skin draw coarser baked levels of detail as they get smaller
   * on screen (≈ 30 % / 10 % of the view height; chosen per frame for the main camera, shadows included).
   * `?lod=0` in the URL (or setCharacterLodEnabled(false) from '@/chars/glb') draws full meshes only.
   */
  create(archetype: Archetype, opts?: CharacterCreateOpts): CharacterVisual;
  /** Pre-build geometry/material caches for a list of archetypes during loading. */
  warm(archetypes: Archetype[]): void;
  /**
   * Fetch the generated bodies and props (public/models, see its manifest.json) these archetypes use, so the
   * next create() returns them at once. Creature archetypes with a generated skin (the elite) load it too, so
   * it is worn from the first frame. Always resolves — a missing file is logged once and that archetype
   * keeps its procedural figure. Safe to call repeatedly; already-loaded models cost nothing.
   * POLISH 4: `linkbound` also fetches the donor of the grafted human head (`halfHuman`), so a zone no longer adds
   * 'survivor' to its `cast` for it. (A helmeted soldier made with `bareHead: true` still fetches its donor on
   * create(): add 'survivor' to the cast if its first frames must not show the procedural stand-in.)
   */
  preload(archetypes: Archetype[]): Promise<void>;
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
 *  - `hideSheathed: true` removes sheathed weapons from the body altogether (seated scenes: a greatsword on the
 *    back does not fit a chair).
 * Carry stance (idle / walk / run arm poses) follows the loadout automatically.
 *
 * ACTION RULES (humanoids)
 *  - Layers. A looping / held FULL-BODY pose (`sit`, `sitTalk`, `sitInjured`, `kneel`, `kneelTend`, `lieInjured`,
 *    `trapped`, `cower`, `distress`, `grounding`, `tetherStop`, `liftPlate` once raised, …) stays until stop() or
 *    another full-body pose. Looping UPPER-BODY poses (`talk`, `listen`, `guard`, `aim`, `aimRifle`,
 *    `holdConsole`, `limp`, `walkAway`, a held `handOver` / `assent` / `turnAway`) layer on top of it — a seated
 *    figure stays seated while it talks, nods, points, receives or hands over. One-shots play over both and the
 *    poses return when they end. stop(name) removes one layer; stop() removes everything.
 *  - `hitLight`, `hitHeavy`, `guardHit` are ADDITIVE reactions: they never interrupt, and take PlayOpts.dir.
 *  - `guard`, `aim` also apply automatically while setLocomotion(..., { guarding / aiming }) is set and no other
 *    upper-body pose plays (`aim` needs the ranged weapon drawn). Aiming also shortens the stride and lowers the
 *    hips; setAimPitch() is closed-loop — the `muzzle` socket's −Z points at the requested pitch within ~1°.
 *  - `death` is final: once started, later play() calls are ignored (their onEvent gets 'cancel') until stop().
 *    The weapon in hand is let go and comes to rest on the floor; stop() puts it back. `death` and `knockdown`
 *    play in real time even while the figure is frozen, so a stasis kill still reaches 'end'.
 *  - `frozen` holds the current pose; ANY later non-additive play(), stop('frozen') or stop() releases it.
 *    setFrozen(amount) is the stasis look and slows animation by (1 − amount); action clocks and events slow
 *    with it (an arrested attack does not land). info('frozen') / play('idle') report duration 0.
 *  - isPlaying() (no argument) is true only while a one-shot or reaction is in progress; held poses answer to
 *    isPlaying(name).
 *  - `attackHeavyCharge` is a held coil. Playing `attackHeavy` out of it skips the wind-up (the swing starts at the
 *    coil key, the hit lands ≈ 0.14 s later) and releases the charge pose; info('attackHeavy') reports the
 *    shortened timing while the charge is held.
 *  - `dodge` is in place (the driver moves the actor); it picks a forward / back / left / right roll from
 *    PlayOpts.dir or the last moveYaw.
 *  - `liftPlate`, `carryStretcher`, `kneelTend`, `holdPlane`, `holdConsole` need both hands: held weapons are
 *    sheathed while they play and return afterwards.
 *  - Blades never go through the floor or the wielder: a stroke that reaches the ground stops on it ('impact'
 *    marks the moment), and Verity's energy blades shorten where they would otherwise cut their owner.
 *  - ADDED (polish 3):
 *    · `breath` — one deep, visible breath (≈ 3.2 s): the chest fills, the shoulders rise, it is let go. Upper body
 *      only, so it plays over standing, sitting or kneeling. Every humanoid.
 *    · `verityCollapsed` (Selene) — Verity collapsed in her hand: the hilt ring held low at the right hip with the
 *      blades drawn in, whatever the loadout says. A held upper-body pose: stop('verityCollapsed') ends it (the
 *      blades come back out if Verity is drawn, otherwise it goes back to the hip).
 *    · `igniteBlades` (Selene) — the hilt comes up, the blades snap out and FLARE cold-white for ≈ 1 s, then she
 *      settles into her guard. Draws Verity (setLoadout({ melee: true })) if it was put away. Play it out of
 *      `verityCollapsed` after stop('verityCollapsed'). 'hit' marks the ignition.
 *  - ADDED (integration): `aimRifle` draws the figure's long gun (setLoadout({ ranged: true })) if it carries one and
 *    it is put away — a posed rifleman never aims with empty hands.
 *  - Unknown action names play a small generic gesture and warn once.
 * Locomotion: the stride follows the distance the root really moved (feet do not slide on starts, stops, turns or
 * against walls), planted feet stay put in world space, and a figure turned on the spot takes turn steps. Report
 * the INTENDED planar speed to setLocomotion; displacement beyond it (knockback, dodges, platforms) is treated as
 * being carried. A figure whose root has never been moved (previews, turntables) walks in place from the reported
 * speed instead; the first real displacement switches it to measured travel for good.
 *
 * Cost: each figure has three levels of detail on one skeleton (switched by camera distance) and casts its
 * shadow from the cheapest; geometry is shared per archetype (and per structural seed bucket for rank-and-file,
 * who otherwise differ by per-instance height and tint) and freed by `releaseUnusedHumanoids()` from
 * '@/chars/humanoid' — call it on zone unload; `warmHumanoids(archetypes, seeds)` pre-builds squad variants.
 */
export type HumanoidLoadout = { melee?: boolean; ranged?: boolean; shield?: boolean; prop?: 'case' | 'rifle' | 'none'; hideSheathed?: boolean };

export interface HumanoidVisual extends CharacterVisual {
  readonly archetype: HumanoidArchetype;
  /** triangle count of the figure at full detail (budget checks); 0 for a mesh-less driver */
  readonly triangles: number;
  /** As CharacterVisual.setLoadout, plus `hideSheathed` (see the loadout rules above). */
  setLoadout(opts: HumanoidLoadout): void;
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
   * Speech: 0 = mouth closed, 1 = talking at full voice. The jaw flaps procedurally while the amount is above 0
   * (hold ~0.7 for the length of a line, or feed the voice envelope); blinks are automatic. A hidden driver
   * still animates its `jaw` / `lids` bones for whatever body is retargeted from it.
   */
  setSpeaking(amount: number): void;
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
  'counter', 'parry', 'deflect', 'dodge', 'dodgeBack', 'dodgeLeft', 'dodgeRight', 'shoot', 'throw', 'slam', 'dispatch',
  'hitLight', 'hitHeavy', 'stagger', 'guardHit', 'guardBreak', 'knockdown', 'getUp', 'death',
  'shieldBash', 'batonStrike', 'lunge', 'roar', 'spawnBreach',
  'guard', 'aim', 'aimRifle', 'frozen', 'linkedSync',
  'idle', 'talk', 'listen', 'point', 'kneel', 'kneelTend', 'sit', 'sitTalk', 'sitInjured', 'lieInjured',
  'trapped', 'liftPlate', 'interact', 'holdConsole', 'holdPlane', 'assent', 'handOver', 'receive',
  'salute', 'nod', 'lookAround', 'cower', 'carryStretcher', 'limp', 'distress', 'grounding',
  'lowerWeapon', 'raiseWeapon', 'floorStrike', 'tetherStop', 'turnAway', 'walkAway',
  'breath', 'verityCollapsed', 'igniteBlades',
];
