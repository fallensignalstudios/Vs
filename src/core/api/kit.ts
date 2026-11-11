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

/**
 * Options of `ceiling()`. Styles: `'flat'` (default) coffered slab with light strips · `'vault'` low barrel vault
 * with ribs and an apex seam · `'lattice'` open beam grid (the sky shows through) · `'glass'` glazed lattice ·
 * ADDED (kit) `'vaultClosed'` — an ENCLOSED barrel vault for upper white-gold halls: a thick shell springing from
 * the wall tops (`h` = the wall height), transverse ribs every `bay` metres, and in every bay three narrow gold-edged
 * seams (along the crown and high on each shoulder) that open onto bright warm haze (light boxes: no sky, no
 * stars). Both gable ends are
 * closed, each with a vertical light seam; soft sheets of light fall from the seams along the zone's key light
 * (`shafts`, hidden when the quality profile has no volumetrics). The shell casts no shadow, so the key light
 * still lands on the floor as the light that enters through the seams; light the hall with a warm `look.ambient.ground`
 * (bounce from the floor) and a little more fog than an open hall. Cost: ~4 draw calls, ~6k triangles.
 *
 *   // Z01: a 56 × 26 m hall, 10 m walls, a rib row at x = 4, 12 … 52 → the vault springs from the wall tops and
 *   // its ribs sit on the rib row (the first one 4 m from the west end)
 *   b.ceiling({ x: 28, n: 13, w: 56, d: 26, h: 10, style: 'vaultClosed', rise: 6.6, bay: 8, bayPhase: 4 });
 *
 * The vault spans the SHORT side of the rect and runs along the long one; `h` is its springing height. For the
 * lower terminal pass `mat: 'blackStone'` (dark shell, gold-framed seams).
 */
export interface CeilingOpts extends RectOpts {
  style?: 'vault' | 'flat' | 'lattice' | 'glass' | 'vaultClosed';
  /** vaultClosed: height of the crown above `h` (default 0.24 × the span, at least 2 m) */
  rise?: number;
  /** vaultClosed: rib spacing along the vault (default 7 m; rounded so the bays divide the length evenly) */
  bay?: number;
  /**
   * vaultClosed: put the ribs exactly `bay` apart, the first `bayPhase` m from the WEST end of an east–west vault
   * (the NORTH end of a north–south one; before `yawDeg`) — to line them up with a `ribRow`. Default: bays fitted
   * evenly to the length.
   */
  bayPhase?: number;
  /** vaultClosed: brightness of the seam haze (default 3.2; above 1 it blooms) */
  glow?: number;
  /** vaultClosed: haze / light-sheet colour (default 0xffe6bf, warm white) */
  hazeColor?: number;
  /** vaultClosed: soft sheets of light from the seams (default true) */
  shafts?: boolean;
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
  /**
   * ADDED (kit, polish 3): `style: 'glass'` — spacing of the vertical mullions in metres (default 3; each solid
   * span is divided evenly, so the actual spacing is the nearest that fits). `0` leaves only the end mullions of
   * each span: one clear pane between the frames.
   */
  mullionSpacing?: number;
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
  /**
   * ADDED (integration). The game the zone is being built for — `build()` receives only the builder, so this is
   * how a zone reaches `game.sky.scenic.*` (far-field backdrop), `game.vfx.ambient(...)`, `game.props.*` and
   * `game.render.quality` while it builds.
   */
  readonly game: import('./index').Game;
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
  ringWall(o: { x: number; n: number; r: number; h?: number; height?: number; mat?: MatId; gapsDeg?: Array<[number, number]>; segments?: number; style?: WallOpts['style']; noCollider?: boolean; /** ADDED (kit): default 0.6 */ thickness?: number; /** ADDED (kit, polish 3): see WallOpts.mullionSpacing */ mullionSpacing?: number }): THREE.Object3D;
  /** blocks movement only (invisible) — "simple blocking volumes behind scenery" */
  blocker(o: RectOpts & { height?: number }): ColliderHandle;
  /** ceiling slab / vault over a rect; see CeilingOpts for the styles (ADDED: 'vaultClosed', the enclosed vault) */
  ceiling(o: CeilingOpts): THREE.Object3D;

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

/**
 * Hero props — OWNER: hero-props (src/world/props/*). Each returns a self-contained animated object.
 *
 * QUICK GUIDE FOR ZONE AUTHORS (hero props)
 *   const mark = game.props.crownmarkFive();
 *   mark.object.position.copy(b.P(0, 0, 0.3));  mark.object.rotation.y = b.yaw(180);
 *   b.add(mark.object);                                   // or root.add(...) — never merged by finalize()
 *   for (const c of mark.colliders ?? []) …               // see `HeroProp.colliders`
 *   b.onUpdate((dt, t) => mark.update(dt, t));            // REQUIRED: props only animate when updated
 *   mark.params.glow = 1;                                 // scripts write targets; the prop eases by itself
 *   z.onUnload / zone dispose → mark.dispose();
 *
 *  - ORIGIN at the floor centre, Y up, metres. FRONT = local −Z (north at yaw 0), the same rule as kit props: it
 *    is the side characters stand on, approach from and read displays from. Sockets carry a yaw (engine
 *    convention): a character placed at a `stand` / `seat` / `approach` socket with that socket's world yaw faces
 *    the prop correctly — `socket.getWorldPosition(v)`, `socket.getWorldQuaternion(q)`.
 *  - PARAMS are targets (0…1 unless noted). Values set before the first `update()` apply instantly; later changes
 *    ease (springs with a slight overshoot; authored timelines such as `destroyed` play at a fixed pace, so
 *    `params.destroyed = 1` IS the whole break-up animation). `snap()` jumps to the targets (checkpoint restore,
 *    cinematic skip). Out-of-range / NaN values are clamped / ignored.
 *  - DRAW CALLS: ≤ 6 per prop (nested rings 8). Props that own a point light: crownmarkFive, stabilizer,
 *    containmentCage (one each, always present, intensity follows the params — no shader recompiles).
 *  - EMISSIVE HIERARCHY: one brightest element per prop (≈ 6: the Crownmark core, an assent pad at acceptance, the
 *    ring axis, a cage core at full charge), everything else 1.5–3.
 *  - The props never play sound or spawn VFX: pair them with `game.vfx` / `game.audio` in the zone script
 *    (`assentTarrik`, `assentSelene`, `meridianComplete`, `goldRecognition`, `cageDestroy`, `coherentPlane` …).
 */
export interface HeroProps {
  /**
   * human-sized black-gold, white-core Crownmark Five seated in its mechanism (never loot).
   * `glow` white core + channel light · `integrated` the ten cradle claws fold shut one after another and light
   * filaments knit star, hoop and plinth together (the consequence beat). Footprint Ø3.5 m, 2.8 m tall; the star
   * stands in the XY plane and shows its face to the front. Sockets: `core`, `top`. Collider: cylinder.
   */
  crownmarkFive(): HeroProp<{ glow: number; integrated: number }>;
  /**
   * suspended nested concentric ring assembly for Z10 (scenic scale; rings align on Meridian completion).
   * `spin` 0…4 scales every rotation · `align` brings all six rings into one horizontal plane with their light
   * points on common spokes (outer rings first, ~3 s) · `energy` light level, inward-travelling pulses, the
   * converging currents and the axis column. Place its origin on the dais floor (the Crownmark's own origin):
   * the axis column ends just above a 3 m object standing there. Sockets: `center`, `axisTop`. No colliders.
   */
  nestedRings(opts?: NestedRingsOpts): HeroProp<{ align: number; spin: number; energy: number }>;
  /**
   * one of the two independent assent interfaces (pedestal, pale ceramic and gold, 1.05 m).
   * `active` wakes the gold glyph layer · `assent` plays the acceptance: Tarrik's is warm — broad bands pushing
   * outward from the palm; Selene's is cool — a still lattice closing in to an exact ring (pattern AND colour).
   * Sockets: `hand` (palm on the slanted surface), `stand` (0.7 m in front, facing the pedestal). Collider: box.
   */
  assentInterface(side: 'tarrik' | 'selene'): HeroProp<{ active: number; assent: number }>;
  /**
   * Z05 stabilizer control ring Selene holds the plane from: a waist-high ring console (Ø2.7 m) open toward the
   * front, and the coherent plane 3.3 m above it. `active` console light (the plane only shows while active) ·
   * `plane` coherence and size together: 0.2 = a small torn flickering patch, 1 = a still 9 m lattice.
   * Sockets: `entry` (outside the gap), `stand` (centre, facing away from the gap), `handL` / `handR` (the two
   * hand plates), `planeCenter`. Colliders: six boxes around the ring (the gap and the centre stay free).
   */
  stabilizer(): HeroProp<{ active: number; plane: number }>;
  /**
   * dark physical table + six age-polished chairs layout helper (Z11). 3.4 × 1.25 m table along X, three chairs
   * on each long side. Sockets: `seat0…2` (front side, by ascending x), `seat3…5` (far side) — seated hip
   * position, facing the table; `tableTop`; `itemA` / `itemB` (where the exchanged evidence rests, one toward
   * each side). No parameters. Colliders: table + six chairs.
   */
  observationSet(): HeroProp<Record<string, number>>;
  /**
   * five-depression threshold (Z09 recognition): a 7 × 3.2 m floor slab between two low curbs.
   * `recognized` plays at a fixed pace (4.8 s for 0 → 1): the five depressions fill with light one after another,
   * then the angular channels open toward the far side and the convergence node lights. Three channels reach
   * the far edge at x = 0 and ±1.7 — continue them with `b.channel`. Sockets: `approach` (front), `center`,
   * `beyond` (far side), `depression0…4`. Colliders: the two curbs.
   */
  recognitionThreshold(): HeroProp<{ recognized: number }>;
  /**
   * containment cages for Z07 (seen through the gallery window; destroyed by story action). ~7 m across, 6 m
   * tall; light them from the zone as well — at 20–40 m their own light only carries the silhouette.
   * `charge` threat building (light, hum, ring speed) · `destroyed` an authored 2.8 s break-up (overload flash at
   * the start — spawn `cageDestroy` VFX with it), scrub-able and restorable: 1 = the wreck at rest.
   * Sockets: `core` (the contained matter / fragment), `top`. Collider: cylinder.
   */
  containmentCage(kind: 'dominion' | 'reformation', opts?: ContainmentCageOpts): HeroProp<{ charge: number; destroyed: number }>;
  /**
   * fallen plate trapping the marine (Z06): 5 × 3.5 m ceiling plate on rubble, hinge line along its rear edge.
   * `lift` raises the front edge from 0.5 m to 2.2 m (8° → 37°, heavy spring with a slight overshoot).
   * Sockets: `stand` (the lifter, at the front edge), `gripL` / `gripR` (ride on the plate), `marine` (on the
   * floor in the cavity). Collider: one box over plate and rubble (remove it once the marine is out if needed).
   */
  fallenPlate(): HeroProp<{ lift: number }>;
  /**
   * departure craft at human scale on the concourse (~14 × 7 × 5 m), parked side-on: nose toward local +X,
   * boarding door and ramp on the front (−Z) side. `ramp` lowers the ramp (2.8 s) · `engines` nozzle glow.
   * Sockets: `rampBottom` (floor, at the ramp foot), `rampTop` (door sill, 1.0–1.1 m up), `door` (just
   * inside), `engines`. Colliders: hull + two nacelle boxes (the ramp itself has none — add a walkable ramp
   * surface between the two sockets if a character should walk aboard).
   */
  departureShip(kind: 'dominionShuttle' | 'reformationTransport'): HeroProp<{ engines: number; ramp: number }>;
  /** holographic displays: trajectory overlay, threat-track streams, diagnostic, forecast clock — see {@link HologramProp} */
  hologram(kind: HologramKind): HologramProp;
}

/**
 * ADDED (polish 3): options of `HeroProps.containmentCage`, for a cage seen far away through glass (Z07: ~120 m).
 *
 *   const cage = game.props.containmentCage('dominion', { fog: false, distant: true });
 */
export interface ContainmentCageOpts {
  /** false = the cage ignores the scene fog (it stays a crisp silhouette at any distance). Default true. */
  fog?: boolean;
  /** brighter frame glow, field and own light so the silhouette carries at ~100 m and beyond. Default false. */
  distant?: boolean;
}

/** ADDED (hero-props): the display kinds of `HeroProps.hologram`. */
export type HologramKind = 'trajectory' | 'threatStreams' | 'diagnostic' | 'forecast' | 'casualtyLog' | 'contaminationRecord' | 'sensorReconstruction';

/**
 * ADDED (hero-props): options of `HeroProps.nestedRings`. Six rings of alternating section fill a sphere of
 * `radius` around a centre `height` above the prop origin. Rings whose radius is inside `clearRadius` never dip
 * below `clearHeight`, so the assembly can hang directly over a walkable platform.
 */
export interface NestedRingsOpts {
  /** outer ring radius in metres (default 60) */
  radius?: number;
  /** height of the common centre above the origin (default max(14, 0.3 × radius)) */
  height?: number;
  /** radius of the walkable area below that the rings must stay clear of (default 30) */
  clearRadius?: number;
  /** lowest height a ring may reach above the walkable area (default 6) */
  clearHeight?: number;
}

/**
 * ADDED (hero-props): a hologram display. `visible` 0…1 fades it (the object hides itself at 0); `progress`
 * 0…1 advances its content:
 *  - `trajectory`            the carrier marker travels its arc over the schematic atrium toward the impact
 *                            marker; from 0.8 the predicted path lifts clear and the impact marker opens into a
 *                            "clear" ring (hold ≤ 0.8 until the rescue succeeds)
 *  - `threatStreams`         two separate glyph streams (amber blocks above, blue-white bars below) gain matching
 *                            target glyphs and bridging ticks; they never merge
 *  - `diagnostic`            five reference nodes: four lit and off balance, the fifth dark → 5/5 balanced
 *  - `forecast`              segmented clock, `setText('02:11:43')`; progress drains the outer ring
 *  - `casualtyLog` / `contaminationRecord`   rows / spread history reveal top-down
 *  - `sensorReconstruction`  ghost figures walk their recorded paths through two scan cones
 * Flat displays (forecast, casualtyLog, contaminationRecord, threatStreams) are 1.7 × 1.0 m panels centred 1.5 m
 * above the origin and read correctly from the FRONT (−Z); the spatial ones (trajectory ~3.5 m wide, diagnostic
 * Ø1.7 m, sensorReconstruction 2.4 × 1.6 m) stand over the origin. Sockets: `center`, `viewer` (2.2 m in front).
 * One draw call each; they add light only to the image (no scene light).
 */
export interface HologramProp extends HeroProp<{ progress: number; visible: number }> {
  /**
   * Replace the display's text line: the clock digits of `forecast` (`'02:11:43'`), the header of the other
   * kinds. Characters outside 0-9 A-Z : / . - and space are drawn as blanks. Safe to call every frame.
   * ADDED (polish 3): headers hold up to 40 characters and the `trajectory` readout up to 32 — the nominal 26 /
   * 22 / 16 characters keep their full size, longer lines shrink to the same width instead of being cut off.
   */
  setText(text: string): void;
  /**
   * ADDED (polish 3): replace a secondary label. `'header'` is the same as `setText`. `threatStreams`:
   * `'top'` / `'bottom'` name the two track lanes (default `DOMINION TRACK` / `REFORMATION TRACK`, up to 32
   * characters) and `'status'` replaces the words before the live count (`COMMON TARGETS 2/4`, up to 20).
   * An unknown slot warns once and does nothing.
   *
   *   streams.setLabel('top', 'CROWNWATCH TRACK'); streams.setLabel('status', 'SHARED TARGETS');
   */
  setLabel(slot: 'header' | 'top' | 'bottom' | 'status' | (string & {}), text: string): void;
}

export interface HeroProp<P extends Record<string, number>> {
  readonly object: THREE.Object3D;
  /** animatable parameters (0..1 unless noted); set directly, the prop eases internally */
  params: P;
  /** named attachment points (world-updated) */
  socket(name: string): THREE.Object3D | null;
  update(dt: number, time: number): void;
  /**
   * footprint colliders the zone should register (world-relative to object origin). ADDED (hero-props): offsets
   * and yaw are in the prop's LOCAL frame — for a prop at `pos` with yaw `r`, register each as
   * `b.collider({ shape, x: pos.x + ox·cos r + oz·sin r, y: pos.y + oy, z: pos.z − ox·sin r + oz·cos r, yaw: r + (yaw ?? 0) })`.
   */
  colliders?: Array<{ shape: import('./physics').ColliderShape; offset: Vec3Like; yaw?: number }>;
  dispose(): void;
  /** ADDED (hero-props): apply the current `params` instantly, without easing (checkpoint restore, skips). */
  snap(): void;
}
