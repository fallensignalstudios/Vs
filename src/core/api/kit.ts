/**
 * Environment kit contract — OWNER: kit (src/world/kit/*). Hero props: hero-props (src/world/props/*).
 *
 * The ZoneBuilder is what zone authors use to construct a zone: modular King-era architecture that
 * auto-registers collision + walkable surfaces, faction equipment props, lights, markers.
 * Zone authors may also add arbitrary THREE objects to `root` and register colliders manually.
 *
 * All positions use PLAN coordinates: x = east (m), n = north (m), h = height (m). World: (x, h, -n).
 * yawDeg: degrees, 0 = facing north (-Z), 90 = facing east (+X).  [world yaw = -deg2rad(yawDeg)]
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
  deck(o: RectOpts & { thickness?: number; solidBelow?: boolean; rails?: Array<'n' | 's' | 'e' | 'w'>; inlay?: FloorOpts['inlay'] }): THREE.Object3D;
  /** bridge span between two points: walkable, with side rails (fall protection is automatic) */
  bridge(o: { from: [number, number]; to: [number, number]; h?: number; width?: number; mat?: MatId; broken?: 'none' | 'far' | 'mid' }): THREE.Object3D;
  wall(o: WallOpts): THREE.Object3D;
  /** closed or open polyline of walls */
  walls(points: Array<[number, number]>, o?: Omit<WallOpts, 'from' | 'to'> & { closed?: boolean }): THREE.Object3D;
  /** curved wall ring (atrium / chamber): centre, radius, arc, door gaps in degrees (0 = north, clockwise) */
  ringWall(o: { x: number; n: number; r: number; h?: number; height?: number; mat?: MatId; gapsDeg?: Array<[number, number]>; segments?: number; style?: WallOpts['style']; noCollider?: boolean }): THREE.Object3D;
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
  rail(o: { from: [number, number]; to: [number, number]; h?: number; height?: number; style?: 'ancient' | 'glass' }): THREE.Object3D;

  /** narrow angular emissive gold channel polyline on the floor (h) or a wall */
  channel(points: Array<[number, number]>, o?: { h?: number; width?: number; color?: number; intensity?: number; pulse?: boolean }): THREE.Object3D;
  /** white-gold conduit pipe run with junctions (visual; optional thin collider) */
  conduit(points: Array<[number, number, number]>, o?: { r?: number; glow?: boolean }): THREE.Object3D;
  /** the "white point" navigation landmark above a threshold */
  whitePoint(o: { x: number; n: number; h: number; intensity?: number }): THREE.Object3D;
  /** frozen-atmosphere panels / curtains (Z03) */
  frost(o: RectOpts & { height?: number; density?: number }): THREE.Object3D;
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
