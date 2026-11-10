/**
 * Environment kit contract — OWNER: kit (src/world/kit/*). Hero props: hero-props (src/world/props/*).
 *
 * The ZoneBuilder is what zone authors use to construct a zone: modular King-era architecture that
 * auto-registers collision + walkable surfaces, faction equipment props, lights, markers.
 * Zone authors may also add arbitrary THREE objects to `root` and register colliders manually.
 *
 * All positions use PLAN coordinates: x = east (m), n = north (m), h = height (m). World: (x, h, -n).
 * yawDeg: degrees, 0 = facing north (-Z), 90 = facing east (+X).  [world yaw = -deg2rad(yawDeg)]
 *
 * QUICK GUIDE FOR ZONE AUTHORS (kit)
 *   const b = game.createZoneBuilder(root, seed);
 *   b.setEnv({ sky: 'frozenInterior', look: LOOKS.relay, ambience: 'relayOverlook' });   // sky, look, key light
 *   b.floor({ x: 31, n: 19, w: 62, d: 38, inlay: 'channels' });                          // surface + visuals
 *   b.walls([[0, 0], [62, 0], [62, 38], [0, 38]], { closed: true, style: 'ribbed', doors: [{ at: 31, width: 3, height: 3.5 }] });
 *   b.ribRow({ x: 31, n: 4, span: 30, height: 14, count: 6, spacing: 6 });
 *   const door = b.door({ x: 31, n: 0 });  b.coverLow({ x: 20, n: 12, style: 'reformation' });  b.prop('refCrate', { x: 8, n: 5 });
 *   b.marker('spawn', 31, 3, 0, 0);
 *   b.finalize();                       // LAST: merges statics, fits shadows, builds nav, bakes the environment
 *
 *  - PHYSICS IS AUTOMATIC and matches the visuals: floors / discs / ramps / decks / bridges add walkable
 *    surfaces; walls, columns, rib legs, cover, large props, door leaves and active barriers add solids. Decks get
 *    a slab solid (or a full block with `solidBelow`), ramps a stepped under-fill, rails a thin solid that blocks
 *    movement but neither sight nor shots while ≤ 1.1 m. Glass blocks movement and shots, not sight.
 *  - ORIENTATION of pieces with a facing: yawDeg 0 = the piece faces north. A door at yawDeg 0 is walked through
 *    north–south (its opening spans east–west); a rib at yawDeg 0 spans east–west across a hall that runs north;
 *    a ramp at yawDeg 0 rises toward the north; props face north (their interaction side is the north side),
 *    except `fireControlStation` whose operator stands on its SOUTH side looking north through the sighting ring.
 *  - WALLS are centred on their line and extended by half their thickness at both ends, so corners made from
 *    separate `wall()` calls close without gaps. A door opening in a wall is `doors: [{ at, width, height }]`
 *    (`at` = distance of the opening's centre from `from`; along the whole polyline for `walls()`); put the
 *    `door()` itself at that point with the wall's direction ± 90° as yawDeg.
 *  - TWO SUBSTRATES: pass `mat: 'blackStone'` (walls, ceilings, columns, rails, ribs) or `'blackStoneFloor'` (floors,
 *    decks, ramps, bridges) and the piece builds its lower-terminal variant: black-stone frames, gold channels as
 *    light. Without `mat` everything is upper-terminal white-gold. The `threshold` door style is black stone.
 *    Black stone reflects rather than scatters: such rooms read through emissive channels (the kit outlines dark
 *    walls, rails and pylons in gold light) and through LIGHTS you add — a steep `spot({ shaft: true })` on the
 *    focal point and a few cool `point` fills (40–60, distance ~25) keep figures separated from the stone.
 *  - STATIC vs LIVE: everything a builder method returns is merged by material in `finalize()` and can no longer
 *    be moved or hidden individually. Wrap the call in `b.keep(...)` to leave a piece as its own object
 *    (`b.keep(b.prop('fallenPlate', …)).visible = false`). Doors, barriers, lights and the white point stay live.
 *  - LIGHT BUDGET: every `point` / `spot` / `panelLight`, each lamp / console / scenic prop, each `whitePoint`,
 *    `barrier` and `corruption` patch owns one unshadowed point light. Keep a zone to roughly a dozen. Shadows:
 *    the key light first, then `spot({ shadow: true })` in creation order, up to `quality.maxShadowLights`.
 *  - MIRROR FLOORS (`reflective: true`): keep the key light steep (≥ 40° elevation) or behind the usual view,
 *    otherwise its reflection blooms into a white glint. finalize() warns about it.
 *  - LIFECYCLE: the builder animates itself on the sim clock (it registers one routine with `game.scripts`);
 *    the mission system calls `dispose()` on zone unload (as a safety net the builder also disposes itself when
 *    its root, once attached to a scene, is removed again). `update()` exists for hosts without a script runner.
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';
import type { ColliderHandle, PhysicsWorld, SurfaceHandle } from './physics';
import type { MatId, MaterialLibrary } from './materials';
import type { Look } from './render';
import type { SkyPreset } from './sky';
import type { AmbienceId, MusicState } from './audio';
import type { DeepPartial } from './render';

export interface Marker {
  name: string;
  pos: THREE.Vector3;
  /** world yaw in radians */
  yaw: number;
}

export interface RectOpts {
  /** centre, plan coords */
  x: number; n: number;
  /** size along east (w) and north (d) before rotation */
  w: number; d: number;
  /** base height (default 0) */
  h?: number;
  yawDeg?: number;
  mat?: MatId;
}

export interface FloorOpts extends RectOpts {
  /** slab thickness below the walking surface (default 0.5) */
  thickness?: number;
  /** inlay style drawn into the floor */
  inlay?: 'none' | 'channels' | 'radial' | 'grid' | 'crownmark';
  /** register with the renderer as a reflective floor */
  reflective?: boolean;
  /** skip creating a walkable surface (pure visual) */
  noSurface?: boolean;
  surfaceMaterial?: 'stone' | 'metal' | 'ice' | 'grate' | 'glass';
}

export interface DiscOpts {
  x: number; n: number; r: number; inner?: number; h?: number; mat?: MatId; thickness?: number;
  inlay?: FloorOpts['inlay']; reflective?: boolean; noSurface?: boolean;
  /** build a low rim/rail collider around the outer edge except in these [startDeg,endDeg] gaps */
  rim?: { height?: number; gapsDeg?: Array<[number, number]> };
}

export interface RampOpts {
  /** centre of the ramp footprint */
  x: number; n: number;
  /** footprint: w = width across, d = run length (before rotation). Ramp rises along local north. */
  w: number; d: number;
  /** height at the low (south, before rotation) end and high end */
  h0: number; h1: number;
  yawDeg?: number;
  mat?: MatId;
  rails?: boolean;
}

export interface WallOpts {
  /** segment endpoints in plan coords */
  from: [number, number]; to: [number, number];
  /** base height and wall height (default h 0, height 8) */
  h?: number; height?: number;
  thickness?: number;
  mat?: MatId;
  /** openings along the wall: centre distance from `from` (m), width, height */
  doors?: Array<{ at: number; width: number; height: number }>;
  /** architectural treatment */
  style?: 'plain' | 'ribbed' | 'panelled' | 'conduit' | 'glass';
  noCollider?: boolean;
}

export interface RibOpts {
  /** foot position (centre of the arch span) */
  x: number; n: number; h?: number;
  /** span across (m), apex height (m), depth of the rib along its axis */
  span: number; height: number; depth?: number;
  yawDeg?: number;
  mat?: MatId;
  /** leg thickness; legs get colliders */
  leg?: number;
  /** 'arch' = curved full rib; 'half' = single curved leg; 'broken' = fractured; 'frozen' = ice-clad */
  style?: 'arch' | 'half' | 'broken' | 'frozen';
  /** emissive seam running up the inner face */
  lit?: boolean;
  noCollider?: boolean;
}

export interface CoverOpts {
  x: number; n: number; h?: number;
  /** footprint (default 3 × 1) */
  w?: number; d?: number;
  yawDeg?: number;
  /** visual family */
  style?: 'ancient' | 'dominion' | 'reformation' | 'debris' | 'plate';
}

export interface DoorOpts {
  x: number; n: number; h?: number; yawDeg?: number;
  /** clear opening. Ordinary routes 3 × 3.5; elite entrances 5 × 4.5 */
  width?: number; height?: number;
  style?: 'ancient' | 'service' | 'quarantine' | 'threshold';
  open?: boolean;
  /** frame only, never closes, no collider */
  frameOnly?: boolean;
}

export interface DoorHandle {
  readonly object: THREE.Object3D;
  readonly isOpen: boolean;
  /** animate open/closed; toggles the collider and (optionally) rebuilds nav */
  setOpen(open: boolean, opts?: { instant?: boolean; silent?: boolean }): void;
  /** lock light colour on the frame */
  setState(state: 'locked' | 'ready' | 'open' | 'sealed'): void;
  readonly collider: ColliderHandle | null;
  readonly pos: THREE.Vector3;
}

export interface BarrierHandle {
  readonly object: THREE.Object3D;
  readonly active: boolean;
  /** raise/lower the white-gold isolation light wall; blocks movement (not sight) while active */
  setActive(active: boolean, opts?: { instant?: boolean }): void;
}

export type PropKind =
  // Dominion (bronze / oxblood / black / amber; heavy ceremonial-functional)
  | 'domCrate' | 'domBarricade' | 'domBanner' | 'domLamp' | 'domAmmoCase' | 'domFieldCache' | 'domStretcher'
  | 'domResonator'        // Z07 Dominion containment cage/resonator (scenic target)
  // Reformation (navy / slate / sterile metal / cold blue-white; modular)
  | 'refCrate' | 'refBarricade' | 'refSensorMast' | 'refLamp' | 'refAmmoCase' | 'refConsole' | 'refStretcher'
  | 'refRecoveryPlatform' // Z07 Reformation recovery platform + fragment (scenic target)
  | 'refSealedCase'       // Lyric's sealed case
  // Ancient terminal
  | 'ancientConsole' | 'ancientPedestal' | 'ancientPylon' | 'ancientBench' | 'conduitJunction'
  | 'fireControlStation'  // Z07 external fire-control station
  | 'recoveryPanel'       // Z07 physical recovery panel (the local decision)
  | 'controlRing'         // Z05 stabilizer control ring
  | 'manualShutter'       // Z08 survivor shutter
  // Dressing
  | 'rubblePile' | 'fallenPlate' | 'debrisSmall' | 'cableBundle' | 'casualtyTarp' | 'medKit'
  | 'chair' | 'table' | 'iceFormation' | 'eclipseGrowth' | 'wallSeam'
  | (string & {});

export interface PropOpts {
  x: number; n: number; h?: number; yawDeg?: number; scale?: number;
  /** default depends on the prop: large props get colliders */
  collider?: boolean;
  variant?: number;
}

export interface LightOpts {
  x: number; n: number; h: number;
  color?: number; intensity?: number; distance?: number;
  /** spot only */
  target?: [number, number, number]; angleDeg?: number; penumbra?: number;
  shadow?: boolean;
  /** visible volumetric cone / shaft */
  shaft?: boolean;
  flicker?: number;
}

export interface ZoneEnvOpts {
  sky: SkyPreset;
  look: DeepPartial<Look>;
  ambience?: AmbienceId;
  music?: MusicState;
  /** key directional light; default derives from the sky preset */
  key?: { dirFrom: [number, number, number]; color?: number; intensity?: number; shadow?: boolean } | null;
}

export interface ZoneBuilder {
  /** Root group of the zone. Everything added here is disposed on unload. */
  readonly root: THREE.Group;
  readonly physics: PhysicsWorld;
  readonly mats: MaterialLibrary;
  /** deterministic PRNG for dressing variation (seeded per zone) */
  rand(): number;

  /** plan → world */
  P(x: number, n: number, h?: number): THREE.Vector3;
  /** plan yaw degrees → world yaw radians */
  yaw(yawDeg: number): number;

  marker(name: string, x: number, n: number, h?: number, yawDeg?: number): Marker;
  getMarker(name: string): Marker;
  hasMarker(name: string): boolean;
  readonly markers: ReadonlyMap<string, Marker>;

  setEnv(opts: ZoneEnvOpts): void;

  // --- structure (all auto-register physics unless stated) ---
  floor(o: FloorOpts): THREE.Object3D;
  disc(o: DiscOpts): THREE.Object3D;
  ramp(o: RampOpts): THREE.Object3D;
  /** raised deck: slab + walkable top + solid underside block + edge rails with gaps */
  deck(o: RectOpts & { thickness?: number; solidBelow?: boolean; rails?: Array<'n' | 's' | 'e' | 'w'>; inlay?: FloorOpts['inlay'] } & DeckExtraOpts): THREE.Object3D;
  /** bridge span between two points: walkable, with side rails (fall protection is automatic) */
  bridge(o: { from: [number, number]; to: [number, number]; h?: number; width?: number; mat?: MatId; broken?: 'none' | 'far' | 'mid' }): THREE.Object3D;
  wall(o: WallOpts): THREE.Object3D;
  /** closed or open polyline of walls */
  walls(points: Array<[number, number]>, o?: Omit<WallOpts, 'from' | 'to'> & { closed?: boolean }): THREE.Object3D;
  /** curved wall ring (atrium / chamber): centre, radius, arc, door gaps in degrees (0 = north, clockwise) */
  ringWall(o: { x: number; n: number; r: number; h?: number; height?: number; mat?: MatId; gapsDeg?: Array<[number, number]>; segments?: number; style?: WallOpts['style']; noCollider?: boolean; /** ADDED (kit): default 0.6 */ thickness?: number }): THREE.Object3D;
  /** blocks movement only (invisible) — "simple blocking volumes behind scenery" */
  blocker(o: RectOpts & { height?: number }): ColliderHandle;
  ceiling(o: RectOpts & { style?: 'vault' | 'flat' | 'lattice' | 'glass' }): THREE.Object3D;

  rib(o: RibOpts): THREE.Object3D;
  /** evenly spaced ribs along a line */
  ribRow(o: RibOpts & { count: number; spacing: number; alongDeg?: number }): THREE.Object3D;
  column(o: { x: number; n: number; h?: number; r?: number; height?: number; mat?: MatId; style?: 'round' | 'faceted' | 'pylon'; lit?: boolean }): THREE.Object3D;

  /** 1.2 m low cover */
  coverLow(o: CoverOpts): THREE.Object3D;
  /** 2.2 m high cover */
  coverHigh(o: CoverOpts): THREE.Object3D;

  door(o: DoorOpts): DoorHandle;
  barrier(o: { from: [number, number]; to: [number, number]; h?: number; height?: number; active?: boolean }): BarrierHandle;
  rail(o: { from: [number, number]; to: [number, number]; h?: number; height?: number; style?: 'ancient' | 'glass'; /** ADDED (kit): 'blackStone' builds the lower-terminal variant */ mat?: MatId }): THREE.Object3D;

  /** narrow angular emissive gold channel polyline on the floor (h) or a wall */
  channel(points: Array<[number, number]>, o?: { h?: number; width?: number; color?: number; intensity?: number; pulse?: boolean; /** ADDED (kit): stand the strip on edge at height h (a line drawn along a wall face) */ vertical?: boolean }): THREE.Object3D;
  /** white-gold conduit pipe run with junctions (visual; optional thin collider) */
  conduit(points: Array<[number, number, number]>, o?: { r?: number; glow?: boolean; /** ADDED (kit): thin solids along the horizontal runs (default false) */ collider?: boolean }): THREE.Object3D;
  /** the "white point" navigation landmark above a threshold */
  whitePoint(o: { x: number; n: number; h: number; intensity?: number }): THREE.Object3D;
  /** frozen-atmosphere panels / curtains (Z03) */
  frost(o: RectOpts & { height?: number; density?: number; /** ADDED (kit): solid footprint (sight passes). Default: true for curtains ≤ 1.5 m thick, false for wide areas */ collider?: boolean }): THREE.Object3D;
  /** localized Eclipse contamination patch following conduits */
  corruption(o: { x: number; n: number; h?: number; r: number; intensity?: number; onWall?: boolean; yawDeg?: number }): THREE.Object3D;

  prop(kind: PropKind, o: PropOpts): THREE.Object3D;

  point(o: LightOpts): THREE.PointLight;
  spot(o: LightOpts): THREE.SpotLight;
  /** soft rectangular emissive panel + matching light */
  panelLight(o: RectOpts & { color?: number; intensity?: number; facing?: 'down' | 'up' | 'north' | 'south' | 'east' | 'west' }): THREE.Object3D;

  /** add an arbitrary object (already positioned in WORLD coordinates) */
  add<T extends THREE.Object3D>(obj: T): T;
  /** register a collider / surface directly (world coords) */
  collider(desc: import('./physics').ColliderDesc): ColliderHandle;
  surface(desc: import('./physics').SurfaceDesc): SurfaceHandle;

  /** per-frame callbacks for zone-specific animation (called while the zone is loaded) */
  onUpdate(fn: (dt: number, time: number) => void): void;

  /**
   * Call once at the end of build(): merges static geometry by material, builds nav, computes bounds,
   * refreshes the environment map.
   */
  finalize(): void;

  // ---- ADDED (kit) ------------------------------------------------------------------------------------

  /**
   * Exclude a piece from the static merge so it stays its own object after finalize() — for anything a zone
   * script will move, hide or remove later. Returns the object. Its colliders are unaffected.
   */
  keep<T extends THREE.Object3D>(obj: T): T;
  /**
   * Advance door / barrier animation, light flicker and `onUpdate` callbacks. The builder already calls this
   * itself every sim tick through `game.scripts`; a second call with the same `time` is ignored, so hosts that
   * drive it explicitly (mission system, sandboxes without a script runner) are safe either way.
   */
  update(dt: number, time?: number): void;
  /**
   * Release everything the builder created: empties `root`, disposes geometries, cloned materials and textures,
   * unregisters reflective floors, removes lights and update callbacks, stops its script routine. The physics
   * world is cleared separately by the mission system. Safe to call twice.
   */
  dispose(): void;
  /** true once finalize() has run (doors / barriers refresh the nav grid themselves from then on) */
  readonly finalized: boolean;
  /** Bounds of everything the kit built, in zone-root space. Valid after finalize(). */
  readonly bounds: THREE.Box3;
  /** The key directional light created by setEnv (null before setEnv, or with `key: null`). */
  readonly keyLight: THREE.DirectionalLight | null;
  /**
   * Build statistics (valid after finalize): `meshes` = draw calls of the merged static geometry, `triangles`
   * of it, `merged` = source meshes consumed, `lights`, `shadowLights` currently casting.
   */
  readonly stats: { meshes: number; triangles: number; lights: number; shadowLights: number; merged: number };
}

/** ADDED (kit): further options of `ZoneBuilder.deck`. */
export interface DeckExtraOpts {
  /** gaps in the edge rails (where a ramp or stair joins): `at` = centre of the gap measured from the WEST end of an 'n' / 's' side or the SOUTH end of an 'e' / 'w' side (before rotation), `width` in metres */
  railGaps?: Array<{ side: 'n' | 's' | 'e' | 'w'; at: number; width: number }>;
  /** support pylons under an open deck (default true when the deck stands more than 1.5 m above `base`) */
  supports?: boolean;
  /** height of the ground the deck stands over (default 0): supports and `solidBelow` blocks reach down to it */
  base?: number;
}

/** Hero props — OWNER: hero-props (src/world/props/*). Each returns a self-contained animated object. */
export interface HeroProps {
  /** human-sized black-gold, white-core Crownmark Five seated in its mechanism (never loot) */
  crownmarkFive(): HeroProp<{ glow: number; integrated: number }>;
  /** suspended nested concentric ring assembly for Z10 (scenic scale; rings align on Meridian completion) */
  nestedRings(opts?: { radius?: number }): HeroProp<{ align: number; spin: number; energy: number }>;
  /** one of the two independent assent interfaces (pedestal) */
  assentInterface(side: 'tarrik' | 'selene'): HeroProp<{ active: number; assent: number }>;
  /** Z05 stabilizer control ring Selene holds the plane from */
  stabilizer(): HeroProp<{ active: number; plane: number }>;
  /** dark physical table + six age-polished chairs layout helper (Z11) */
  observationSet(): HeroProp<Record<string, number>>;
  /** five-depression threshold (Z09 recognition) */
  recognitionThreshold(): HeroProp<{ recognized: number }>;
  /** containment cages for Z07 (seen through the gallery window; destroyed by story action) */
  containmentCage(kind: 'dominion' | 'reformation'): HeroProp<{ charge: number; destroyed: number }>;
  /** fallen plate trapping the marine (Z06) */
  fallenPlate(): HeroProp<{ lift: number }>;
  /** departure craft at human scale on the concourse */
  departureShip(kind: 'dominionShuttle' | 'reformationTransport'): HeroProp<{ engines: number; ramp: number }>;
  /** holographic displays: trajectory overlay, threat-track streams, diagnostic, forecast clock */
  hologram(kind: 'trajectory' | 'threatStreams' | 'diagnostic' | 'forecast' | 'casualtyLog' | 'contaminationRecord' | 'sensorReconstruction'): HeroProp<{ progress: number; visible: number }>;
}

export interface HeroProp<P extends Record<string, number>> {
  readonly object: THREE.Object3D;
  /** animatable parameters (0..1 unless noted); set directly, the prop eases internally */
  params: P;
  /** named attachment points (world-updated) */
  socket(name: string): THREE.Object3D | null;
  update(dt: number, time: number): void;
  /** footprint colliders the zone should register (world-relative to object origin) */
  colliders?: Array<{ shape: import('./physics').ColliderShape; offset: Vec3Like; yaw?: number }>;
  dispose(): void;
}
