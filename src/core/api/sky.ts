/**
 * Sky + scenic vista contract — OWNER: sky-scenic (src/render/sky/*).
 * The far field: the Wound, the two remnants, the fleet battle, the carrier, and the immense terminal shell that
 * extends far beyond playable bounds. Nothing here has collision.
 *
 * ORIENTATION. Presets are authored with the Wound toward north (−Z, plan +n), the red remnant to its LEFT (west)
 * and the white remnant to its RIGHT (east). A zone whose vista faces another way calls `sky.setHeading(yaw)`
 * (engine yaw convention) and gives its scenic pieces the same `rotation.y`.
 *
 * `SKY_PRESET_IDS` (all preset ids, mission order) and `SKY_PRESETS` (the authored table) are exported from
 * '@/render/sky' for debug menus.
 *
 * ZONE LOADS. Sky state persists between zones (preset, heading, boundary, carrier). A snap `setPreset` clears
 * every live battle effect and hides the carrier unless the preset is 'battleCeiling'; `sky.reset()` returns
 * everything to the neutral start state. Call one of them when a zone loads.
 *
 * TYPICAL ZONE USE
 *   game.sky.setPreset('woundVista');                       // snap during loading (or { blendSeconds } in play)
 *   const vista = game.sky.scenic.terminalVista();          // built facing −Z, origin = overlook floor
 *   vista.position.copy(b.P(0, 40, 0)); b.root.add(vista);  // zone-local placement; disposed with the zone
 *   key.position.copy(game.sky.keyLight.dir).multiplyScalar(60);
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';

export type SkyPreset =
  | 'void'            // plain dark backdrop (title / fallbacks)
  | 'crashRib'        // Z00–Z02: seen through fractured ribs; contained black Wound far away, fleet flashes
  | 'frozenInterior'  // Z03–Z04: daylight inside the megastructure — bright cold haze, its own ribbed upper space overhead, no stars
  | 'battleCeiling'   // Z05: transparent ceiling, amber / blue-white / violet battle light, carrier crossing
  | 'breachDeep'      // Z06–Z08: enclosed; through glass a dark grey-blue nebula and the fleet battle low over the horizon
  | 'woundVista'      // Z09: one enormous Crownmark arm; Wound fills much of the horizon (concept: Wound overlook)
  | 'coreChamber'     // Z10: enclosed nested machinery volume; the Wound seen dimly through the dark shut view boundary
  | 'observation'     // Z11: red remnant left, hard white remnant right, Wound between
  | 'hangar';         // Z12: outer ring, both fleets wary at distance

/**
 * The damaged carrier of Z05. Hidden unless `visible`; `sky.setPreset` hides it again for every preset except
 * 'battleCeiling'.
 *
 * THE CLIP. The pass is staged so the hull's ventral bow ram FIRST touches the scenic tower's needle at
 * `clipProgress` (0.8): nothing intersects the tower before it, the needle shears off at its collar and the
 * rest of the hull rides clear of the stump. A crossing that is PLAYED (visible, progress advancing by ≤ 0.05
 * per call) fires `onClip` and spawns the flash, sparks, masonry and dust; these and the falling needle run on
 * the sim clock, so they keep going if the script holds progress. A skip / load past 0.8 lands with the needle
 * simply gone and no effects; progress below 0.8 restores it.
 *
 * THE DESCENT. The hull never recovers: once the ram has dragged clear of the stump (≈ 0.83) the pass bends down
 * into the distortion below the complex, nose-down, ≈ 560 m below the level pass by progress 1 (ease-in: barely
 * lower at 0.88, most of the drop in the last tenth). Drive progress to 1 and hide the carrier after the shot —
 * no anchor lowering needed.
 */
export interface CarrierActor {
  readonly object: THREE.Object3D;
  visible: boolean;
  /** 0..1 along its authored pass above the Z05 ceiling (first contact with the scenic tower at `clipProgress`). */
  setProgress(t: number): void;
  /** 0..1 how much of its maneuvering light is restored (Tharne reconnecting jets) */
  setStabilized(n: number): void;
  /** world position (for shadow / audio panning) */
  readonly position: THREE.Vector3;

  /** current values of setProgress / setStabilized */
  readonly progress: number;
  readonly stabilized: number;
  /**
   * Place the authored pass. `origin` = centre of the Z05 atrium floor in world space and `yaw` (engine yaw)
   * rotates the whole pass about it. Defaults to the origin with yaw 0 — the frame `scenic.atriumShell()` is
   * built in, so shell and carrier line up when both get the same position / rotation.y.
   * A missing or non-finite origin warns once and keeps the previous anchor.
   */
  setAnchor(origin: Vec3Like, yaw?: number): void;
  /** World position where the hull clips the scenic tower: the needle's collar (the tower `scenic.atriumShell()` builds). */
  readonly clipPoint: THREE.Vector3;
  /** Progress at which the bow ram first touches the tower (0.8). */
  readonly clipProgress: number;
  /**
   * Called once when a PLAYED pass shears the tower (see the interface note), with the world contact point —
   * hook audio, camera shake and rumble here instead of polling `progress`. null = no listener.
   */
  onClip: ((point: THREE.Vector3) => void) | null;
  /** Unit travel direction (world) at the current progress. */
  readonly forward: THREE.Vector3;
  /** Overall hull length in metres (≈ 460). */
  readonly length: number;
  /**
   * 0..1 how much the hull currently blocks the sky's key light over the atrium centre (0 while hidden; always
   * finite). Dim the zone key light with it — the carrier's threat is communicated by its shadow.
   * It peaks when the hull sits BETWEEN the atrium and the key light, not when it looks overhead: with the
   * 'battleCeiling' key (high in the east-north-east) that is progress ≈ 0.72–0.88, i.e. around the clip.
   */
  readonly shadow: number;
  /**
   * The hull's shadow on the atrium floor plane (y = anchor height), cast along the sky's key light — drive a
   * light cookie or a blob shadow with it so a moving edge crosses the room. `center` is in world space, `axis`
   * the unit direction of the shadow's long side; half extents are 0 while the carrier is hidden.
   * The same objects are updated in place every frame.
   */
  readonly shadowFootprint: { readonly center: THREE.Vector3; readonly axis: THREE.Vector3; readonly halfLength: number; readonly halfWidth: number };
}

/** A directional light suggestion. `dir` is the unit vector pointing FROM the scene TOWARD the light. */
export interface SkyLight {
  dir: THREE.Vector3;
  color: number;
  intensity: number;
}

export interface SkySystem {
  /**
   * Add to scene by Game (the system also adds itself to `game.scene` when constructed with a real scene).
   * The root never moves: dome and fleet shaders ignore camera translation (infinite distance for any camera,
   * including reflection and PMREM cameras); the carrier is a child at true world coordinates.
   * Everything in it lives in the OPAQUE render list (so it shows through transmissive glass), pinned to the far
   * plane and drawn after ordinary opaque geometry with a depth test and no depth write — hidden sky costs nothing.
   */
  readonly root: THREE.Object3D;
  readonly preset: SkyPreset;
  /**
   * Switch preset; `blendSeconds` (default 0 = snap) crossfades every parameter. Unknown ids fall back to 'void'.
   * A snap is a cut: live tracers, flashes and arcs are cleared and `battleGlow` is zeroed. Any preset other
   * than 'battleCeiling' hides the carrier.
   */
  setPreset(preset: SkyPreset, opts?: { blendSeconds?: number }): void;
  /**
   * Back to the neutral start state for a zone load: preset 'void' (snap), heading 0, boundary open, battle
   * effects cleared, carrier hidden at progress 0 / stabilised 0 with the scenic tower's needle restored.
   */
  reset(): void;

  /**
   * Unit directions (world) toward the key bodies for the current preset — use to align key lights.
   * These report the TARGET preset immediately after setPreset (not the mid-crossfade value) and include
   * the heading set with setHeading.
   */
  readonly woundDir: THREE.Vector3;
  readonly redRemnantDir: THREE.Vector3;
  readonly whiteRemnantDir: THREE.Vector3;
  /** suggested key light for the preset (`dir` points toward the light; usually the white remnant side) */
  readonly keyLight: SkyLight;
  /** suggested secondary light: the red remnant's contribution (intensity 0 where it is not visible) */
  readonly fillLight: SkyLight;

  readonly carrier: CarrierActor;
  /** 0..1 distant fleet battle activity (flashes, tracers) */
  setBattleIntensity(n: number): void;
  /**
   * 0..1 restrained violet movement behind the Wound boundary. The Wound also breathes with it: drawn back toward 0
   * it visibly CONTRACTS (to 80 % of its radius at 0; the authored size at the default 0.3; +3 % at 1) — void,
   * crust and smoke together — its crust thins, and the violet knots and veins glowing in its crust withdraw; at 1
   * they flare and the crust swells. Eased (≈ 1 s) unless snapped.
   * ADDED `opts.snap`: land on the value at once. The sky also snaps by itself while the mission fast-forwards a
   * skipped cinematic or loads a zone (`game.mission.runtime.skipping` / `game.mission.loading`), so a skipped scene
   * lands in the state it would have reached watched; pass `{ snap: z.skipping }` to be explicit.
   */
  setWoundActivity(n: number, opts?: { snap?: boolean }): void;
  /**
   * Consequence visual: boundary closed / stability recovering (the opening settles to its slow outline and a calm,
   * thin gold seam seals it; its crust stays, dimmed; the violet stills).
   * `seconds` (default 3; ≤ 0 = instant) is the transition. ADDED `opts.snap`: instant, whatever `seconds` says;
   * like setWoundActivity it also snaps by itself during a skip or a zone load.
   */
  setBoundaryClosed(closed: boolean, seconds?: number, opts?: { snap?: boolean }): void;

  /** current (eased) values of the three setters above; boundaryClosed is 0..1 */
  readonly battleIntensity: number;
  readonly woundActivity: number;
  readonly boundaryClosed: number;

  /**
   * Rotate the whole sky (bodies, fleet, lights) about +Y. Engine yaw convention: `yaw` is the direction a
   * viewer faces to look at the Wound's bearing (0 = north / −Z). Give scenic pieces the same `rotation.y`.
   */
  setHeading(yaw: number): void;
  readonly heading: number;

  /**
   * Linear HDR colour of the fleet-battle light currently in the sky (sum of live flashes, 0 when quiet).
   * Drive a soft light with it so interiors flicker in amber / blue-white / violet with the battle (Z05).
   */
  readonly battleGlow: THREE.Color;
  /**
   * Scripted fleet impact: one large flash (plus glow) for beats that need a synchronised hit.
   * `dir` = world direction toward it (default: somewhere inside the battle), `strength` 0..1.
   * Honours settings.reduceFlash.
   */
  impact(opts?: { dir?: Vec3Like; color?: number; strength?: number }): void;

  /** Horizon haze colour of the current (blended) sky, linear — match zone fog to it for seamless vistas. */
  readonly hazeColor: THREE.Color;

  // QUALITY: the dome's shading cost follows `game.render.quality.level` (low / medium / high+ultra tiers) and
  // drops to the cheapest tier automatically in small secondary passes (reflections, PMREM bakes).

  /**
   * Build non-colliding megastructure backdrop pieces. Returned objects are positioned in zone-local space by
   * the caller and disposed with the zone.
   */
  scenic: ScenicFactory;

  update(dt: number, camera: THREE.Camera): void;
  /** Release GPU resources owned by the sky itself (not scenic pieces already handed out). */
  dispose(): void;
}

/**
 * Scenic pieces. Far-field kinds (`terminalVista`, `atriumShell`, `crownmarkArm`, `megaRibs`, capital ships) use
 * fog-exempt materials with their own distance haze that follows the sky preset, so they survive zone fog; each
 * is ≤ 12 draw calls (merged structure + instanced light points). Their lighting is BAKED per vertex: the sky's
 * key / fill reach only what is open to the sky, enclosed surfaces are lit by their own seams — zone lights and
 * shadows do not affect them. Near-field kinds (shuttle / transport / wreck) use the shared material library and
 * are lit, shadowed and fogged by the zone like any prop.
 *
 * All pieces are built facing −Z (north) with +Y up. NOTHING HERE HAS COLLISION: a zone that lets the player
 * reach a shuttle, transport or wreck must author its own colliders (footprints are given per kind below).
 * Geometry is owned by the returned object (dispose it with the zone); the near-field pieces' materials are
 * shared and owned by the factory — never dispose or mutate them.
 *
 * Every option is sanitised: null / NaN / infinite / absurd values fall back to the default or are clamped to
 * the stated range, and unknown kinds warn once and fall back.
 */
export interface ScenicFactory {
  /**
   * City-scale converging terminal structure: spires, arched skyways, bridges fading into haze (Wound overlook
   * concept). Origin = the overlook floor by the railing; the hub lies toward −Z. Two levels: skyways about
   * 0.2 × `drop` below the floor (what the eye-level camera sees) and the main deck `drop` metres below.
   * `radius` 800…6000 (default 3000), `drop` 40…900 (default 220), `density` 0.25…2.
   * `corridor` keeps a central strip (metres wide) free of spires so `crownmarkArm` can lie in it.
   * `clearWound` (default true): nothing stands or shines inside the `woundVista` Wound's disc as seen from the
   * origin — structures in its azimuth band are capped under its lower limb, so the disc keeps a clean silhouette
   * (the accretion swirl beyond the rim may sink behind them). Pass false for other skies.
   * Spires come in six families (needle, stepped crown, ribs, cluster, ziggurat, blade) of weathered pale stone and
   * black stone with gold trim; only the tall ones stand pale against a dark city mass.
   */
  terminalVista(opts?: { radius?: number; seed?: number; density?: number; drop?: number; corridor?: number; clearWound?: boolean }): THREE.Object3D;
  /**
   * The ~300 m scenic atrium shell around Z05: arcaded gallery tiers, immense ribs, broken bridges, an open
   * ceiling lattice. Origin = centre of the playable platform floor. At floor level everything lies outside
   * `shaftRadius` (the void around the playable platform) except four short broken stubs at bearings
   * 67.5° + k·90° (measured from +X toward −Z; they reach in to r ≈ 34). Four long broken spans reach over the
   * shaft at 22.5° + k·90°, at gallery height (≥ one tier up, in to r ≈ 40). Keep zone bridges on the cardinals.
   * Includes the exterior spires seen through the ceiling — one of them is the
   * tower the carrier clips (`sky.carrier.clipPoint`); the most recently built shell's needle is the one the
   * carrier shears. `radius` 80…260 (default 150), `height` 50…400 (140), `shaftRadius` ≥ 20 (60), `tiers` 1…7 (4).
   */
  atriumShell(opts?: { radius?: number; height?: number; shaftRadius?: number; tiers?: number; seed?: number }): THREE.Object3D;
  /**
   * One enormous arm of a city-scale Crownmark structure receding to the horizon.
   * Origin = the overlook floor above the arm's root; the arm runs toward −Z, `drop` metres below.
   * `length` 600…9000 (default 3600), `width` 80…1600 (520), `drop` 20…900 (150). `clearWound` as in `terminalVista`.
   */
  crownmarkArm(opts?: { length?: number; width?: number; drop?: number; seed?: number; clearWound?: boolean }): THREE.Object3D;
  /**
   * Distant structural ribs (immense spans) for interiors that look out. A nave of `count` (1…24) arches spaced
   * `spacing` apart, each `span` wide and `height` tall. Origin = floor level on the nave axis under the FIRST
   * rib; the others recede toward −Z.
   */
  megaRibs(opts?: { count?: number; span?: number; height?: number; spacing?: number; seed?: number }): THREE.Object3D;
  /**
   * A parked/hovering ship for hangar and battle backdrops.
   * Shuttle ≈ 26 m long × 17 m span × 7 m high and transport ≈ 31 × 15 × 9 m (near-field PBR, resting on
   * y = 0, nose toward −Z, ramp / cargo door at +Z); capitals ≈ 620 m (far-field hazed material, origin at the
   * hull centre). No collision — see the interface note.
   * ADDED (integration wave, SHIPS): the kinds are now the generated ships, at the forge's scale — shuttle 18 m
   * (19.2 m span, 6.6 m high), transport = the Reformation dropship 22 m (22 m span, 6 m high; its closed ramp
   * door is at the stern, +Z), Dominion capital 600 m, Reformation capital = the carrier 500 m — each with
   * additive engine glow (amber crown rings / cold-blue planes and plumes) and baked LODs. The model loads
   * asynchronously into the returned object; the procedural ship is shown until then (and stays if the file cannot
   * be loaded). Engines default to 1 on capitals and 0.6 (hovering) on the small craft. Read and drive the live
   * state with {@link asScenicShip}; `await asScenicShip(ship)?.ready` in an async build() to never show the
   * stand-in.
   */
  ship(kind: 'dominionShuttle' | 'reformationTransport' | 'dominionCapital' | 'reformationCapital', opts?: { scale?: number }): THREE.Object3D;
  /**
   * Crashed dropship hull section (Z00 / Z03 start dressing). Rests on y = 0; ≈ 16 m long × 9 m wide × 6 m
   * high at scale 1, with debris and scorch scattered within ≈ 12 m. No collision — see the interface note.
   */
  wreck(kind: 'dominion' | 'reformation', opts?: { scale?: number; seed?: number }): THREE.Object3D;
}

/**
 * ADDED (integration wave, SHIPS): live controls of a ship built by `sky.scenic.ship()`.
 *
 *   const ship = game.sky.scenic.ship('reformationTransport');   // Z00: the dropship crossing the fracture
 *   const ctl = asScenicShip(ship);
 *   if (ctl) ctl.engines = 1.2;                                   // full burn while it crosses
 *   await ctl?.ready;                                             // (async build) never show the stand-in
 */
export interface ScenicShipControls {
  readonly kind: 'dominionShuttle' | 'reformationTransport' | 'dominionCapital' | 'reformationCapital';
  /** resolves true once the generated model replaced the procedural stand-in, false if the stand-in stays */
  readonly ready: Promise<boolean>;
  /** true while the generated model is shown */
  readonly generated: boolean;
  /** engine level 0…1.5: crown rings / blue planes, the hull's glowing texels, plume length. Instant. */
  engines: number;
  /** running lights 0…1 (wingtips, beacons). Instant. */
  lights: number;
  /** hull length in metres, including the object's own scale (the stand-in's while it is shown) */
  readonly length: number;
}

/** ADDED (integration wave, SHIPS): the controls of a `sky.scenic.ship()` object; null for anything else. */
export function asScenicShip(obj: THREE.Object3D | null | undefined): ScenicShipControls | null {
  const c = (obj?.userData as { ship?: unknown } | undefined)?.ship as ScenicShipControls | undefined;
  return c && typeof c === 'object' && typeof c.ready === 'object' ? c : null;
}

export type { Vec3Like };
