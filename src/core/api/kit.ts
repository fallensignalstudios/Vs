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
 *    decks, ramps, bridges) and the piece builds its lower-terminal variant: black-stone frames outlined in fine
 *    gold. Without `mat` everything is upper-terminal white-gold (smooth white-silver marble since polish 4). The
 *    `threshold` door style is black stone. Black stone reflects rather than scatters: such rooms read through the
 *    LIGHTS you add — a steep `spot({ shaft: true })` on the focal point and a few cool `point` fills (40–60,
 *    distance ~25) keep figures separated from the stone — and (polish 4) through what the mirror floor reflects:
 *    `slot()`s, `haze()`, lit posts. The gold outlines glow only with `lit: true`.
 *  - STATIC vs LIVE: everything a builder method returns is merged by material in `finalize()` and can no longer
 *    be moved or hidden individually. Wrap the call in `b.keep(...)` to leave a piece as its own object
 *    (`b.keep(b.prop('fallenPlate', …)).visible = false`). Doors, barriers, lights and the white point stay live.
 *  - LIGHT BUDGET: every `point` / `spot` / `panelLight`, each lamp / console / scenic prop, each `whitePoint`,
 *    `barrier` and `corruption` patch owns one unshadowed light. Keep a zone to roughly a dozen. Shadows:
 *    the key light first, then `spot({ shadow: true })` in creation order, up to `quality.maxShadowLights`.
 *    ADDED (polish 3): finalize() enforces it for FIXTURE lights (props, `panelLight`, `corruption`): fixtures of a
 *    similar colour within 6 m share one light at their intensity-weighted centre, and while the zone still holds
 *    more than 12 point / spot lights the weakest fixtures go emissive-only. Lights you place yourself (`point`,
 *    `spot`), the white point, barriers and the key are never touched. Consoles, the recovery panel and the
 *    fire-control station light their own faces with a narrow spot from above, not a point light at head height.
 *  - MIRROR FLOORS (`reflective: true`): keep the key light steep (≥ 40° elevation) or behind the usual view,
 *    otherwise its reflection blooms into a white glint. finalize() warns about it.
 *  - SURFACES (integration wave): the kit's materials now wear the generated photographic PBR sets
 *    (public/textures/, loaded lazily per zone, procedural detail kept as a blend): white-gold walls, ribs and
 *    columns → `marble_slab` (polish 4: smooth white-silver marble slabs; the `stone_pale` ashlar is
 *    `wall({ finish: 'ashlar' })`), gold trims → `gold_inlay` (fine engraving), upper floors → `marble_dark`
 *    lifted to a deep polished grey, `blackStone*` → `marble_dark` (near-black mirror marble), `goldDark` (relic
 *    trim, door leaves, bands) → `metal_blackgold`, Dominion bronze → `bronze_plate`, Reformation navy →
 *    `panel_navy`, frost dressing → `frost`, corruption tissue → `eclipse_tissue` (its vein mask glows).
 *    Mirror-polished floors register with a stronger planar reflection (polish 4: 2.2; the `'wet'` finish 3).
 *    Damaged or industrial floors: `finish: 'worn'` / `'hangar'`, the relay route's light wet grey marble:
 *    `finish: 'wet'` — on floor / disc / ramp / deck / bridge (see SurfaceFinish). For the
 *    paintings' silver-white chamber look, build walls and pillars WITHOUT `mat: 'blackStone'` (white-gold =
 *    silver marble now) and keep `blackStoneFloor` for the mirror floor.
 *  - ART DIRECTION (polish 4) — the paintings, not neon:
 *    · NO GLOW BY DEFAULT. Rib seams, pylon strips, ribbed / conduit pilaster strips, dark-stone wall outlines,
 *      deck under-lips, ramp / bridge guide lines, disc rims, floor `inlay` channels and `channel()` are now FINE
 *      INLAID GOLD: thin, polished, metallic, not emissive — they show by reflecting the room. Opt back in where a
 *      line guides the player: `rib({ lit: true })`, `column({ lit: true })`, `wall({ lit: true })`,
 *      `deck({ lit: true, inlayGlow: true })`, `floor({ inlayGlow: true })`, `ramp/bridge/rail({ lit: true })`,
 *      `channel(pts, { glow: true })` (`intensity` / `color` only apply to a glowing channel).
 *    · WALLS are large smooth white-silver marble slabs (`marble_slab`) with a dark joint between slabs; the
 *      coursed ashlar stays available for damaged or service areas: `wall({ finish: 'ashlar' })`. Relief styles:
 *      `style: 'slab'` (slabs 6 cm proud with shadow gaps) and `style: 'framed'` (gold-framed recessed panels).
 *    · FLOORS: `finish: 'wet'` is the relay route's light-to-mid grey wet marble (`floor_wet_grey`), mirroring
 *      strongly. Polished floors reflect harder than before (the renderer's strength above 1 now lifts the
 *      reflectance at steep angles and fades out at grazing ones).
 *    · DETAIL: `pipes()` (paired pipe runs with brackets, collars, junction boxes), `slot()` (tall soft-lit slots,
 *      or windows of daylight), `portal()` (deep doorway frames with stepped jambs), `tiers()` (galleries,
 *      balustrades and stairs for distant, non-walkable tiers), `rail({ style: 'parapet' })` (solid stone
 *      balustrade with lit posts) — all collider-free and merged by material.
 *    · DAYLIGHT: `ceiling({ style: 'skylight' })` (coffers open onto bright haze, a haze volume under it) and
 *      `haze()` (a lit haze volume anywhere: shafts, a bright upper hall, mist).
 *    · CORRUPTION: `corruption({ style: 'crystal' })` / `crystals()` — grounded, faceted, glassy violet crystal
 *      clusters with glowing cores (one draw call for all of a zone's crystals).
 *    · INLAYS: `inlay({ kind: 'rings' | 'star' | 'rose' | 'lines' | 'grid' | 'border' })` — shader-drawn fine gold
 *      on one quad, anti-aliased, reflective, one draw call.
 *    · DRAW CALLS: `addStatic(obj)` merges a zone's own static dressing into the kit's per-material meshes
 *      (`{ instance: true }` turns repeats into one InstancedMesh).
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

/**
 * ADDED (integration wave): the finish of a walkable top — which photographic surface set it wears
 * (public/textures/). `'polished'` (default) is the material's own: polished dark marble for `whiteGoldFloor`
 * (a deep grey in the upper halls) and `blackStoneFloor` (near-black mirror). `'worn'` = dark worn flagstones
 * (`stone_worn`, rough, no mirror) for damaged areas; `'hangar'` = the steel-and-concrete deck plates
 * (`concrete_hangar`, 1 m plates) for hangars and landing pads. The kit keeps the slab's substrate (its frame,
 * seams, inlays) and only changes the top. Physics is unchanged.
 *
 *   b.floor({ x: 21, n: 12, w: 42, d: 24, mat: 'blackStoneFloor', finish: 'hangar' });   // Z12 deck
 *   b.floor({ x: 10, n: 30, w: 12, d: 8, finish: 'worn', h: 0.01 });                  // a cracked patch
 *
 * For a custom mesh: `b.surfaceMaterial('worn')` (cached per zone) or `b.mats.clone('whiteGoldFloor', { surface:
 * 'stone_worn' })` (caller disposes). Valid `surface` values: the set names in public/textures/manifest.json,
 * or `'none'` for the procedural maps only.
 */
export type SurfaceFinish = 'polished' | 'worn' | 'hangar' | 'wet';

/**
 * ADDED (polish 4): the stone of a wall. `'slab'` (default) is the material itself: for white-gold walls, large
 * smooth white-silver marble slabs (`marble_slab`) with a dark joint between them. `'ashlar'` is the coursed pale
 * limestone of the integration wave, for damaged and service areas. (Black-stone walls ignore it.)
 *
 *   b.wall({ from: [0, 0], to: [20, 0], height: 8, style: 'slab' });                 // slabs with real shadow gaps
 *   b.wall({ from: [0, 0], to: [0, 12], height: 6, finish: 'ashlar', style: 'plain' }); // a service corridor
 */
export type WallFinish = 'slab' | 'ashlar';

export interface FloorOpts extends RectOpts {
  /** slab thickness below the walking surface (default 0.5) */
  thickness?: number;
  /**
   * ADDED (integration wave): see {@link SurfaceFinish} (default 'polished'). Polish 4: `'wet'` = the relay
   * route's light-to-mid grey wet marble, mirroring strongly:
   *   b.floor({ x: 28, n: 13, w: 56, d: 26, reflective: true, finish: 'wet' });
   */
  finish?: SurfaceFinish;
  /** inlay style drawn into the floor (polish 4: fine inlaid gold, not glowing — see `inlayGlow`) */
  inlay?: 'none' | 'channels' | 'radial' | 'grid' | 'crownmark';
  /** ADDED (polish 4): draw the inlay as the emissive gold channels of the earlier passes (default false) */
  inlayGlow?: boolean;
  /** register with the renderer as a reflective floor */
  reflective?: boolean;
  /** skip creating a walkable surface (pure visual) */
  noSurface?: boolean;
  surfaceMaterial?: 'stone' | 'metal' | 'ice' | 'grate' | 'glass';
}

export interface DiscOpts {
  x: number; n: number; r: number; inner?: number; h?: number; mat?: MatId; thickness?: number;
  /** ADDED (integration wave): see {@link SurfaceFinish} */
  finish?: SurfaceFinish;
  inlay?: FloorOpts['inlay']; reflective?: boolean; noSurface?: boolean;
  /** ADDED (polish 4): glowing inlay channels and rim line instead of fine gold (default false) */
  inlayGlow?: boolean;
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
  /** ADDED (integration wave): see {@link SurfaceFinish} */
  finish?: SurfaceFinish;
  /** ADDED (polish 4): the guide lines along the kerbs glow (default false: fine inlaid gold) */
  lit?: boolean;
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
  /**
   * ADDED (polish 4) `'skylight'` — BRIGHT CLOSED-CEILING HAZE: a deep coffered ceiling (beams ~1.1 m deep, fine
   * gold on their soffits) whose every coffer opens onto a box of bright daylight haze (light boxes — no sky, no
   * stars; brightest in each coffer's middle), closed above. A lit haze volume hangs under it (`hazeBelow`, default
   * true) so the upper hall reads as bright haze. `h` = the beam soffit height; `glow` (default 2.6) and
   * `hazeColor` (default 0xf6f2ea) as for `vaultClosed`. ~3 draw calls (beams merge with the zone's white-gold).
   *
   *   b.ceiling({ x: 31, n: 19, w: 62, d: 38, h: 14, style: 'skylight', coffer: 5 });
   */
  style?: 'vault' | 'flat' | 'lattice' | 'glass' | 'vaultClosed' | 'skylight';
  /** skylight: coffer size in metres (default 4.5, fitted to the rect) */
  coffer?: number;
  /** skylight: hang a lit haze volume under the coffers (default true) and how deep it reaches (default min(10, 0.7 h)) */
  hazeBelow?: boolean;
  hazeDepth?: number;
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
  /**
   * vaultClosed: brightness of the seam haze (default 3.2; above 1 it blooms). Polish 4: also the brightness of the
   * `'flat'` / `'vault'` ceilings' light troughs (default 1.6) — soft, brightest down the middle and fading to their
   * edges and ends (they were flat neon bars), and of the `'skylight'` coffers (default 2.6).
   */
  glow?: number;
  /** vaultClosed: haze / light-sheet colour (default 0xf6f0e6, daylight white; integration wave — was 0xffe6bf) */
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
  /**
   * architectural treatment. ADDED (polish 4): `'slab'` — clad in large smooth marble slabs (≈ 2.6 × 3.4 m) standing
   * 6 cm proud with dark shadow gaps, a fine gold line in the first course joint; `'framed'` — stiles every ≈ 3.2 m
   * and between them recessed panels in a stone moulding with a thin cut-corner gold frame (a dado panel and a tall
   * upper panel on walls over 4 m). Both faces, geometry only, merged by material; the collider is unchanged.
   */
  style?: 'plain' | 'ribbed' | 'panelled' | 'conduit' | 'glass' | 'slab' | 'framed';
  /** ADDED (polish 4): see {@link WallFinish} (default 'slab') */
  finish?: WallFinish;
  /**
   * ADDED (polish 4): light strips on the wall — the ribbed pilasters' seams, the conduit style's vertical seams,
   * black stone's outline channels. Default false: the same lines are fine inlaid gold.
   */
  lit?: boolean;
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
  /**
   * emissive seam running up the inner face. Polish 4: default FALSE (the paintings' ribs carry no light strip) —
   * an unlit rib has a fine gold line along its keel instead; pass `lit: true` where the seam guides the player.
   */
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
  /** ADDED (polish 4): light strips on the leaves (default false: fine gold, which also saves draw calls) */
  lit?: boolean;
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
  bridge(o: { from: [number, number]; to: [number, number]; h?: number; width?: number; mat?: MatId; broken?: 'none' | 'far' | 'mid'; /** ADDED (integration wave) */ finish?: SurfaceFinish; /** ADDED (polish 4): glowing guide lines and rail posts (default false) */ lit?: boolean }): THREE.Object3D;
  wall(o: WallOpts): THREE.Object3D;
  /** closed or open polyline of walls */
  walls(points: Array<[number, number]>, o?: Omit<WallOpts, 'from' | 'to'> & { closed?: boolean }): THREE.Object3D;
  /** curved wall ring (atrium / chamber): centre, radius, arc, door gaps in degrees (0 = north, clockwise) */
  ringWall(o: { x: number; n: number; r: number; h?: number; height?: number; mat?: MatId; gapsDeg?: Array<[number, number]>; segments?: number; style?: WallOpts['style']; noCollider?: boolean; /** ADDED (kit): default 0.6 */ thickness?: number; /** ADDED (kit, polish 3): see WallOpts.mullionSpacing */ mullionSpacing?: number; /** ADDED (polish 4): see WallOpts */ finish?: WallFinish; lit?: boolean }): THREE.Object3D;
  /** blocks movement only (invisible) — "simple blocking volumes behind scenery" */
  blocker(o: RectOpts & { height?: number }): ColliderHandle;
  /** ceiling slab / vault over a rect; see CeilingOpts for the styles (ADDED: 'vaultClosed', the enclosed vault) */
  ceiling(o: CeilingOpts): THREE.Object3D;

  rib(o: RibOpts): THREE.Object3D;
  /** evenly spaced ribs along a line */
  ribRow(o: RibOpts & { count: number; spacing: number; alongDeg?: number }): THREE.Object3D;
  /** `lit`: light strips on the column's faces (polish 4: default false for every style — unlit pylons get fine gold lines) */
  column(o: { x: number; n: number; h?: number; r?: number; height?: number; mat?: MatId; style?: 'round' | 'faceted' | 'pylon'; lit?: boolean }): THREE.Object3D;

  /** 1.2 m low cover */
  coverLow(o: CoverOpts): THREE.Object3D;
  /** 2.2 m high cover */
  coverHigh(o: CoverOpts): THREE.Object3D;

  door(o: DoorOpts): DoorHandle;
  barrier(o: { from: [number, number]; to: [number, number]; h?: number; height?: number; active?: boolean }): BarrierHandle;
  /**
   * ADDED (polish 4) `style: 'parapet'`: the overlook paintings' SOLID waist-high balustrade — polished black stone
   * (or the `mat` given), plinth, overhanging cap with a fine gold line, stout posts every ~3 m with a small lit
   * lantern slot on each face. Same footprint and collider as the other styles:
   *   b.rail({ from: [10, 30], to: [50, 30], style: 'parapet' });
   * `lit` (polish 4): the dark 'ancient' rail's post strips glow (default false: fine gold).
   */
  rail(o: { from: [number, number]; to: [number, number]; h?: number; height?: number; style?: 'ancient' | 'glass' | 'parapet'; /** ADDED (kit): 'blackStone' builds the lower-terminal variant */ mat?: MatId; lit?: boolean }): THREE.Object3D;

  /**
   * a gold line polyline on the floor (h) or a wall. Polish 4: by default a FINE INLAID GOLD line (metallic, not
   * emissive, ~65 % of `width`); `glow: true` (or `pulse: true`) makes it the narrow emissive channel of the earlier
   * passes, and only then do `color` / `intensity` apply. Use the glow where the line guides the player.
   *   b.channel([[2, 4], [30, 4]], { width: 0.05 });                       // inlaid gold
   *   b.channel([[2, 4], [30, 4]], { width: 0.05, glow: true, intensity: 1.6 }); // a guiding light line
   */
  channel(points: Array<[number, number]>, o?: { h?: number; width?: number; color?: number; intensity?: number; pulse?: boolean; /** ADDED (kit): stand the strip on edge at height h (a line drawn along a wall face) */ vertical?: boolean; /** ADDED (polish 4) */ glow?: boolean }): THREE.Object3D;
  /** white-gold conduit pipe run with junctions (visual; optional thin collider) */
  conduit(points: Array<[number, number, number]>, o?: { r?: number; glow?: boolean; /** ADDED (kit): thin solids along the horizontal runs (default false) */ collider?: boolean }): THREE.Object3D;
  /** the "white point" navigation landmark above a threshold */
  whitePoint(o: { x: number; n: number; h: number; intensity?: number }): THREE.Object3D;
  /**
   * frozen-atmosphere panels / curtains (Z03). Polish 3: thick faceted slabs fringed and rooted with prism
   * crystals and faceted icicles (same footprint and collider as before).
   */
  frost(o: RectOpts & { height?: number; density?: number; /** ADDED (kit): solid footprint (sight passes). Default: true for curtains ≤ 1.5 m thick, false for wide areas */ collider?: boolean }): THREE.Object3D;
  /**
   * localized Eclipse contamination patch following conduits. Polish 3: a raised violet-black growth — lumps
   * heaped toward the source (up to ~1 m for r ≥ 10), tendrils arching out along the flow (local −Z), nodules,
   * splinters of dark plate, violet veins over all of it and creeping ahead on the clean floor. No collider.
   * With `onWall` the tendrils and creeping veins stay on a compact face (about ±0.5 r across, 1.25 r along the
   * flow) so a patch on a narrow rib or pilaster does not run off its edge into the air.
   */
  corruption(o: {
    x: number; n: number; h?: number; r: number; intensity?: number; onWall?: boolean; yawDeg?: number;
    /**
     * ADDED (polish 4): `'crystal'` grows grounded violet crystal clusters instead of the tissue (see `crystals()`;
     * `r` × 0.6 is their spread, `size` their scale, `light` a faint violet fixture light, default true). The zone's
     * random stream is advanced exactly as for the tissue, so switching style never moves other dressing.
     *   b.corruption({ x: 12, n: 30, r: 2.5, style: 'crystal', size: 'large' });
     */
    style?: 'growth' | 'crystal';
    size?: CrystalOpts['size'];
    light?: boolean;
  }): THREE.Object3D;

  prop(kind: PropKind, o: PropOpts): THREE.Object3D;

  point(o: LightOpts): THREE.PointLight;
  spot(o: LightOpts): THREE.SpotLight;
  /** soft rectangular emissive panel + matching light */
  panelLight(o: RectOpts & { color?: number; intensity?: number; facing?: 'down' | 'up' | 'north' | 'south' | 'east' | 'west' }): THREE.Object3D;

  /** add an arbitrary object (already positioned in WORLD coordinates) */
  add<T extends THREE.Object3D>(obj: T): T;
  /**
   * ADDED (polish 4): add STATIC dressing (positioned in zone-root coordinates, like `add`) and merge it into the
   * kit's static meshes in finalize(): one draw call per material (per 64 m cell), instead of one per mesh. Every
   * mesh under `obj` is baked in place (its world matrix applied) — nothing in it may move, hide or animate later
   * (wrap such parts in `keep()` first: they stay live). Skinned, instanced, morphing and multi-material meshes
   * stay live too. Extra vertex attributes (uv, color, …) are kept when every mesh of a group has them; indexed
   * geometry is expanded. `{ instance: true }`: copies that share one geometry (≥ 2) become one InstancedMesh
   * (posts, crates, pillars). Called after finalize() it merges at once. Returns `obj`.
   *
   *   const g = new THREE.Group();  … build the dressing into g (shared kit or library materials) …
   *   b.addStatic(g);                                          // N meshes, K materials → K draw calls
   *   b.addStatic(crateGroup, { instance: true });             // 20 identical crates → 1 draw call per material
   *
   * (Materials shared between meshes merge; a material cloned per mesh does not — share them.)
   */
  addStatic<T extends THREE.Object3D>(obj: T, opts?: { instance?: boolean }): T;
  /**
   * ADDED (polish 4): pipe runs on a wall along PLAN points [x, n, h]: `count` parallel pipes (default 2) with
   * filleted bends, clamp brackets every `bracket` m with stems to base plates, collars at the bends and junction
   * boxes. Collider-free. See {@link PipeOpts}.
   *   b.pipes([[4, 0.4, 0.5], [4, 0.4, 7.2], [9, 0.4, 7.2], [9, 0.4, 11]], { facing: 0, count: 2, boxes: [1] });
   */
  pipes(points: Array<[number, number, number]>, o?: PipeOpts): THREE.Object3D;
  /** ADDED (polish 4): a tall soft-lit slot or a window of daylight haze in a stone frame — see {@link SlotOpts}. Collider-free. */
  slot(o: SlotOpts): THREE.Object3D;
  /** ADDED (polish 4): a deep doorway frame with stepped jambs round an opening — see {@link PortalOpts}. Collider-free. */
  portal(o: PortalOpts): THREE.Object3D;
  /** ADDED (polish 4): tiered galleries with balustrades and stairs for distant, NON-walkable tiers — see {@link TiersOpts}. Collider-free. */
  tiers(o: TiersOpts): THREE.Object3D;
  /** ADDED (polish 4): a lit haze volume (daylight from within, a bright upper hall, mist) — see {@link HazeOpts}. */
  haze(o: HazeOpts): THREE.Object3D;
  /** ADDED (polish 4): grounded violet crystal clusters — see {@link CrystalOpts}. Collider-free. */
  crystals(o: CrystalOpts): THREE.Object3D;
  /** ADDED (polish 4): a shader-drawn fine gold floor inlay (rings, star, rose, lines, grid, border) — see {@link InlayOpts}. */
  inlay(o: InlayOpts): THREE.Mesh;
  /**
   * ADDED (polish 4): a fine gold line ON A WALL FACE along PLAN points [x, n, h], in any direction — vertical lines
   * up pilasters, frames, chevrons (`channel({ vertical })` only runs horizontally). `facing` = the plan direction
   * the wall face looks (the line sits 4 mm proud of it); `width` default 0.03; `closed` closes the polyline.
   * Non-glowing inlaid gold by default; `glow: true` (+ `color`, `intensity`) makes it a light line. Collider-free.
   *   b.wallLine([[20.3, 10, 0.6], [20.3, 10, 9]], { facing: 90 });                         // up an east-facing pilaster
   *   b.wallLine([[0.3, 4, 1], [0.3, 6, 1], [0.3, 6, 4], [0.3, 4, 4]], { facing: 90, closed: true }); // a frame
   */
  wallLine(points: Array<[number, number, number]>, o?: { facing?: number; width?: number; glow?: boolean; color?: number; intensity?: number; closed?: boolean }): THREE.Object3D;
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
  /**
   * ADDED (integration wave): the walking-surface material of a {@link SurfaceFinish} on `base` (default
   * `'whiteGoldFloor'`), for custom meshes. Cached per zone, owned and disposed by the builder; world-space
   * mapped (do not use it on moving meshes). Optional only because the mission's fallback builder lacks it:
   * `b.surfaceMaterial?.('worn')`.
   */
  surfaceMaterial?(finish: SurfaceFinish, base?: MatId): THREE.Material;
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
  /** ADDED (integration wave): see {@link SurfaceFinish} */
  finish?: SurfaceFinish;
  /** ADDED (polish 4): the warm light strip under an open deck's lip and glowing rail-post strips (default false) */
  lit?: boolean;
  /** ADDED (polish 4): glowing inlay channels instead of fine inlaid gold (default false) */
  inlayGlow?: boolean;
  /** gaps in the edge rails (where a ramp or stair joins): `at` = centre of the gap measured from the WEST end of an 'n' / 's' side or the SOUTH end of an 'e' / 'w' side (before rotation), `width` in metres */
  railGaps?: Array<{ side: 'n' | 's' | 'e' | 'w'; at: number; width: number }>;
  /** support pylons under an open deck (default true when the deck stands more than 1.5 m above `base`) */
  supports?: boolean;
  /** height of the ground the deck stands over (default 0): supports and `solidBelow` blocks reach down to it */
  base?: number;
}

// ---------------------------------------------------------------------------------------------- ADDED (polish 4)

/** Options of `ZoneBuilder.pipes`. */
export interface PipeOpts {
  /** pipes side by side (default 2: the paintings' paired pipes) */
  count?: number;
  /** pipe radius, m (default 0.05) */
  r?: number;
  /** centre-to-centre spacing of the pipes (default 3 r) */
  spacing?: number;
  /** direction the pipes FACE (out of the wall they run on), plan degrees (default 0 = north: a wall on their south) */
  facing?: number;
  /** distance of the pipe axis from the wall (default r + 0.07) */
  standoff?: number;
  /** spacing of the brackets along the straight runs, m (default 1.7; 0 = none) */
  bracket?: number;
  /** junction boxes at these vertex indices (true = every interior vertex; default [1] with 3+ points) */
  boxes?: boolean | number[];
  /** pipe metal (default 'goldTrim'; 'goldDark', 'refSteel', 'domBronze' read as service pipes) */
  mat?: MatId;
}

/**
 * Options of `ZoneBuilder.slot`: a tall lit slot — or, wider, a window full of daylight haze. A stone frame stands
 * `depth` out of the wall; the light at its back is a soft glow, brightest down the middle and fading at the edges
 * and ends (never a hard neon line), its reveals lit by it, a thin gold line round the frame. Glow only (bloom),
 * unless `light`. All slots of a zone merge into one draw call per brightness.
 *
 *   b.slot({ x: 12, n: 0.3, yawDeg: 0, height: 6 });                                // a tall slot on a south wall
 *   b.slot({ x: 30, n: 38, yawDeg: 180, width: 3, height: 7, mullions: 3, intensity: 2.2 }); // a window of haze
 */
export interface SlotOpts {
  /** centre of the slot's foot on the wall face (plan) and its sill height (default 0.6) */
  x: number; n: number; h?: number;
  /** direction the slot faces (into the room), plan degrees */
  yawDeg?: number;
  /** clear width and height of the light (default 0.38 × 5) */
  width?: number; height?: number;
  /** depth of the stone frame standing out of the wall (default 0.26) */
  depth?: number;
  /** light colour (default pale daylight 0xf3efe6) and brightness (default 1.05; above ~1.2 the middle blooms) */
  color?: number; intensity?: number;
  /** frame substrate: 'blackStone' for the lower terminal (default white-gold) */
  mat?: MatId;
  /** thin bars across the light (a window: 2–6; default 0) */
  mullions?: number;
  /** a weak fixture light in front of the slot (budgeted like prop lamps; default false) */
  light?: boolean;
}

/**
 * Options of `ZoneBuilder.portal`: a deep sculpted doorway frame — `steps` concentric jambs, each wider than the last
 * and standing further out of the wall, so the door sits at the back of a stepped funnel; a fine gold line round
 * every step, a gold medallion above. Its inner aperture is 6 cm wider than the opening on each side, so it never
 * narrows the doorway. Put it on the same spot and yaw as the `door()` it frames (yaw = the side it is seen from).
 *
 *   b.portal({ x: 35, n: 48, yawDeg: 180, width: 5, height: 4.5, steps: 4, depth: 1.6, head: 'pointed' });
 */
export interface PortalOpts {
  /** centre of the doorway's threshold on the wall face (plan) */
  x: number; n: number; h?: number;
  /** the direction the portal faces (into the room it is seen from), plan degrees */
  yawDeg?: number;
  /** the clear opening it frames (default 3 × 3.5) */
  width?: number; height?: number;
  /** stepped jambs (default 3), how far the outermost stands out of the wall (default 1.1 m), each step's width (default 0.32) */
  steps?: number; depth?: number; step?: number;
  /** head shape (default 'flat': chamfered corners) */
  head?: 'flat' | 'pointed' | 'round';
  /** substrate: 'blackStone' for the lower terminal (default white-gold) */
  mat?: MatId;
  /** gold medallion above the head (default true) */
  crest?: boolean;
  /** frame both faces of the wall (default false); `thickness` = the wall's (default 0.6) */
  both?: boolean; thickness?: number;
}

/**
 * Options of `ZoneBuilder.tiers`: tiered galleries for the far walls of a hall (the quarantine painting's balconies
 * and stairs): each level a slab on corbels behind a balustrade with a fine gold line on its fascia, a back wall of
 * gold-framed dark doorways with tall lit slots between them, pilasters, a ground-storey facade, and stair flights.
 * NOT walkable and collider-free: place it beyond the playable footprint, or high enough that nobody reaches it.
 *
 *   b.tiers({ x: 35, n: 52, yawDeg: 180, width: 40, levels: 3, depth: 3, rail: 'balusters', stairs: 'both' });
 */
export interface TiersOpts {
  /** centre of the FRONT edge of the lowest gallery projected to the ground (plan), and the ground height (default 0) */
  x: number; n: number; h?: number;
  /** the direction the tiers face (toward the viewer), plan degrees; the back wall stands `depth` behind the front */
  yawDeg?: number;
  /** width of the stack, m (default 24) */
  width?: number;
  /** galleries one above the other (default 3), storey height (default 4.2), gallery depth (default 3.2) */
  levels?: number; levelHeight?: number; depth?: number;
  /** each gallery's front steps back by this much from the one below (default 0: stacked balconies) */
  setback?: number;
  /** gallery front: 'balusters' (default), 'parapet' (solid, lit posts) or 'glass' */
  rail?: 'balusters' | 'parapet' | 'glass';
  /** stair flights between the levels: 'left' | 'right' | 'both' | 'none' (default 'right') */
  stairs?: 'left' | 'right' | 'both' | 'none';
  /** corbels under every gallery front (default true) */
  corbels?: boolean;
  /** lit slots between the doorways of the back walls (default true) */
  slots?: boolean;
  /** substrate: 'blackStone' for the lower terminal (default white-gold) */
  mat?: MatId;
}

/**
 * Options of `ZoneBuilder.haze`: a box of luminous haze whose density the shader integrates along the view ray
 * (soft at every face, denser toward the bottom or the top, additive, unfogged, not reflected). One draw call.
 *
 *   b.haze({ x: 31, n: 19, h: 6, w: 60, d: 36, height: 9, density: 0.05, falloff: -0.8 });  // bright upper hall
 *   b.haze({ x: 50, n: 8, w: 4, d: 10, height: 12, yawDeg: 20, density: 0.12, intensity: 1.4 }); // a shaft
 */
export interface HazeOpts {
  /** centre of the footprint (plan) and the base height (default 0) */
  x: number; n: number; h?: number;
  /** footprint (east × north before yaw) and height, metres */
  w: number; d: number; height: number;
  yawDeg?: number;
  /** haze colour (default daylight 0xf2eee6) */
  color?: number;
  /** optical density per metre (default 0.04: a 20 m hall reads as a soft veil) */
  density?: number;
  /** brightness (default 1; > 1 blooms) */
  intensity?: number;
  /** vertical profile: + denser at the bottom (ground mist), − denser at the top (light under a ceiling); default −0.6 */
  falloff?: number;
  /** softness of the box faces as a fraction of its size (default 0.25) */
  soft?: number;
}

/**
 * Options of `ZoneBuilder.crystals`: violet crystal corruption — faceted glassy shards (dark violet glass that
 * mirrors the room facet by facet) whose cores glow from the root up and whose edges catch a violet rim, grown out of
 * a surface in grounded clusters (each shard starts inside a dark root mound — never floating), the largest in the
 * middle. All crystals of a zone merge into one draw call. Collider-free.
 *
 *   b.crystals({ x: 8, n: 30, r: 1.5, size: 'large' });                         // a cluster at a pillar foot
 *   b.crystals({ x: 0.3, n: 22, h: 3, r: 0.8, onWall: true, yawDeg: 90, size: 'medium' }); // on a west wall
 */
export interface CrystalOpts {
  /** centre of the growth (plan) and the surface height (default 0) */
  x: number; n: number; h?: number;
  /** radius the clusters spread over (default 1.2) */
  r?: number;
  /** clusters (default round(1 + r)) */
  clusters?: number;
  /** 'small' (≤ 0.4 m), 'medium' (≤ 1.1 m, default), 'large' (≤ 2.6 m), or the tallest shard in metres */
  size?: 'small' | 'medium' | 'large' | number;
  /** core glow 0 … 3 (default 1) */
  intensity?: number;
  /** grow out of a wall, fanning along the facing (`yawDeg`) instead of up */
  onWall?: boolean;
  yawDeg?: number;
  /** a faint violet fixture light (budgeted; default false) */
  light?: boolean;
}

/** Patterns of `ZoneBuilder.inlay`. `'rose'` = concentric rings + a star + spokes (the crownmark / overlook floors). */
export type InlayKind = 'rings' | 'star' | 'lines' | 'grid' | 'border' | 'rose';

/**
 * Options of `ZoneBuilder.inlay`: fine inlaid gold lines drawn by the shader on one flat quad on a floor — polished
 * gold metal that shows by reflecting the room (never glowing unless `glow`), anti-aliased at any distance, one draw
 * call, no collider, kept out of the mirror pass.
 *
 *   b.inlay({ x: 27, n: 27, h: 0.002, kind: 'rose', r: 9, count: 4, points: 5 });  // the chamber floor
 *   b.inlay({ x: 35, n: 24, kind: 'rings', r: 7, count: 5, width: 0.03 });         // quarantine rings
 *   b.inlay({ x: 20, n: 10, kind: 'lines', w: 3, d: 30, count: 2 });               // a pair of rails along north
 */
export interface InlayOpts {
  /** centre (plan) and the floor height it lies on (default 0) */
  x: number; n: number; h?: number;
  kind: InlayKind;
  /** round patterns: outer radius (default 4) */
  r?: number;
  /** rectangular patterns (lines, grid, border): size east × north before yaw (default 2r × 2r); lines run north */
  w?: number; d?: number;
  yawDeg?: number;
  /** line width, m (default 0.028) */
  width?: number;
  /** rings / rose: rings (default 4) · lines: lines (default 2) · grid: cell size in m (default 2) */
  count?: number;
  /** star / rose: points (default 5) */
  points?: number;
  /** rings / rose: the innermost ring at this fraction of r (default 0.25) */
  inner?: number;
  /** gold colour (default 0xe8c06a) and roughness (default 0.18) */
  color?: number; roughness?: number;
  /** a faint emissive on the lines (default 0) */
  glow?: number;
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
   * ADDED (polish 4): `steady` 0…1 is LIGHT ONLY — a calm, unwavering white core, steady channel light and the light
   * filaments lit, the claws untouched (use it where the script wants the core to answer without the integration's
   * folding). `crownmarkFive({ scale: 1.6 })` builds a monumental one: object, light reach and collider scale together.
   *   const mark = game.props.crownmarkFive({ scale: 1.5 });  mark.params.steady = 1;
   */
  crownmarkFive(opts?: CrownmarkFiveOpts): HeroProp<{ glow: number; integrated: number; steady: number }>;
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
   * ADDED (integration wave): the craft are now the generated ships (shuttle 14.4 m with 15.4 m wings, dropship
   * 15 m with 15 m wings, on struts) and the call returns a {@link DepartureShipProp} — an escort flight and the
   * load state. Footprints, sockets and colliders changed: read them from the prop, as before.
   */
  departureShip(kind: 'dominionShuttle' | 'reformationTransport'): DepartureShipProp;
  /** holographic displays: trajectory overlay, threat-track streams, diagnostic, forecast clock — see {@link HologramProp} */
  hologram(kind: HologramKind): HologramProp;
}

/**
 * ADDED (integration wave, SHIPS): the departure craft of `HeroProps.departureShip`.
 *
 * THE CRAFT. `dominionShuttle` is the generated Dominion shuttle (public/models/ship_dominion_shuttle.glb) drawn
 * 14.4 m long: stubby wings at local x −3.3…0.9 reaching z ±7.7 at 1.85–2.65 m height, the door on the flat forward
 * flank (x ≈ 2.2), four rear crown engines and five lift thrusters in amber. `reformationTransport` is the
 * generated Reformation dropship drawn 15 m long on 0.95 m landing struts: its side hatch (x ≈ −4.4) is the door,
 * wings 3.7 m up reaching z ±7.5, cold blue-white engine pods. (The forge's nominal 18 / 22 m do not fit the Z12
 * berths.) The hull loads asynchronously; until it is ready — and for good if the file cannot be loaded — the
 * procedural craft stands in, with its doorway on the same spot. Sockets, ramp and colliders never move.
 *
 * ENGINES. `engines` 0…1 lights the crown rings / blue planes, the hull's glowing texels and the exhaust plumes
 * (0.05–0.1 = parked and smouldering, 1 = take-off).
 *
 * ESCORT. `escort` 0…1 (eases at 1/7 per second; `snap()` lands at once): an escort flight of the same craft
 * (Dominion shuttles in amber around Tarrik's, Reformation dropships in blue-white around Selene's) closes in from
 * far ahead and wide, and holds formation around the craft. The escorts are CHILDREN of the craft, so they follow
 * the zone's own flight path; they wait 26–40 lengths ahead, so raise `escort` only once the craft has turned
 * out of the hangar. 0 hides them. `configureEscort()` before the first raise sets their number and spread.
 *
 *   const dom = game.props.departureShip('dominionShuttle');
 *   dom.configureEscort({ count: 4 });
 *   // … in the departure, once the craft points out of the hangar:
 *   dom.params.engines = 1; dom.params.escort = 1;      // and dom.snap() when skipping
 */
export interface DepartureShipProp extends HeroProp<{ engines: number; ramp: number; escort: number }> {
  /** resolves true once the generated hull is on screen, false when the procedural craft stays */
  readonly whenLoaded: Promise<boolean>;
  /** true while the generated hull is shown */
  readonly generated: boolean;
  /** hull length in metres (14.4 / 15) */
  readonly length: number;
  /** escort options (before the first raise of `escort`): count 1…6 (default 4), spread 0.5…3 (default 1) */
  configureEscort(opts: { count?: number; spread?: number; length?: number }): void;
  /** the escort craft, in the craft's own frame (empty until `escort` is first raised) — for cameras and audio */
  escortCraft(): THREE.Object3D[];
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

/** ADDED (polish 4): options of `HeroProps.crownmarkFive`. */
export interface CrownmarkFiveOpts {
  /** uniform scale (0.5 … 4, default 1): the object, its light's reach and its collider grow together */
  scale?: number;
}

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
  /**
   * ADDED (polish 4): `'chrome'` — polished silver-white metal rings (the crownmark painting) that read by what they
   * reflect, with a faint cool emissive; default `'stone'` (the white-gold ceramic of earlier passes).
   */
  finish?: 'stone' | 'chrome';
  /**
   * ADDED (polish 4): `'concentric'` — the rings sit nearly level (≤ 5° tilt, slow precession), nested round the
   * axis with the outer rings higher, like a gyroscope round its light column; `align` still brings them into one
   * plane. Default `'tilted'` (each ring tilted on its own precessing axis).
   *   game.props.nestedRings({ radius: 26, finish: 'chrome', layout: 'concentric', column: 3, columnWidth: 0.5 });
   */
  layout?: 'tilted' | 'concentric';
  /** ADDED (polish 4): the body's emissive floor (default 0.07 stone, 0.015 chrome); `energy` raises it from there */
  glow?: number;
  /** ADDED (polish 4): brightness scale of the vertical axis column (default 1; 2–4 = the painting's bright column) */
  column?: number;
  /** ADDED (polish 4): radius of the axis column in metres (default 0.35 % of the radius, 0.12 … 0.3) */
  columnWidth?: number;
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
