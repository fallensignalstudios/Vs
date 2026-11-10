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
  | 'frozenInterior'  // Z03–Z04: cold haze, pale exterior glow through ribs
  | 'battleCeiling'   // Z05: transparent ceiling, amber / blue-white / violet battle light, carrier crossing
  | 'breachDeep'      // Z06–Z08: enclosed, distant impacts
  | 'woundVista'      // Z09: one enormous Crownmark arm; Wound fills much of the horizon (concept: Wound overlook)
  | 'coreChamber'     // Z10: enclosed nested machinery volume, dark shut view boundary
  | 'observation'     // Z11: red remnant left, hard white remnant right, Wound between
  | 'hangar';         // Z12: outer ring, both fleets wary at distance

export interface CarrierActor {
  readonly object: THREE.Object3D;
  visible: boolean;
  /** 0..1 along its authored pass above the Z05 ceiling (clips a scenic tower near 0.8). */
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
   */
  setAnchor(origin: Vec3Like, yaw?: number): void;
  /** World position where the hull clips the scenic tower (the tower `scenic.atriumShell()` builds). */
  readonly clipPoint: THREE.Vector3;
  /** Unit travel direction (world) at the current progress. */
  readonly forward: THREE.Vector3;
  /** Overall hull length in metres (≈ 460). */
  readonly length: number;
  /**
   * 0..1 how much the hull currently blocks the sky's key light over the atrium centre (0 while hidden).
   * Dim the zone key light with it — the carrier's threat is communicated by its shadow.
   */
  readonly shadow: number;
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
  /** Switch preset; `blendSeconds` (default 0 = snap) crossfades every parameter. Unknown ids fall back to 'void'. */
  setPreset(preset: SkyPreset, opts?: { blendSeconds?: number }): void;

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
  /** 0..1 restrained violet movement behind the Wound boundary */
  setWoundActivity(n: number): void;
  /** Consequence visual: boundary closed / stability recovering (subtle gold rim settles, violet stills) */
  setBoundaryClosed(closed: boolean, seconds?: number): void;

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
 * is ≤ 12 draw calls (merged structure + instanced light points). Near-field kinds (shuttle / transport / wreck)
 * use the shared material library and are lit and fogged by the zone like any prop.
 * All pieces are built facing −Z (north) with +Y up and have no collision.
 */
export interface ScenicFactory {
  /**
   * City-scale converging terminal structure: spires, arms, bridges fading into haze (Wound overlook concept).
   * Origin = the overlook floor; the deck lies `drop` metres below and the arms converge toward −Z.
   * `corridor` keeps a central strip (metres wide) free of spires so `crownmarkArm` can lie in it.
   */
  terminalVista(opts?: { radius?: number; seed?: number; density?: number; drop?: number; corridor?: number }): THREE.Object3D;
  /**
   * The ~300 m scenic atrium shell around Z05: ringed tiers, broken spans, transparent ceiling lattice.
   * Origin = centre of the playable platform floor. Everything lies outside `shaftRadius` (the void around the
   * playable platform), so it never intersects zone geometry built inside it. Includes the exterior spires seen
   * through the ceiling — one of them is the tower the carrier clips (`sky.carrier.clipPoint`).
   */
  atriumShell(opts?: { radius?: number; height?: number; shaftRadius?: number; tiers?: number; seed?: number }): THREE.Object3D;
  /**
   * One enormous arm of a city-scale Crownmark structure receding to the horizon.
   * Origin = the overlook floor above the arm's root; the arm runs toward −Z, `drop` metres below.
   */
  crownmarkArm(opts?: { length?: number; width?: number; drop?: number; seed?: number }): THREE.Object3D;
  /**
   * Distant structural ribs (immense spans) for interiors that look out. A nave of `count` arches spaced
   * `spacing` apart along −Z, each `span` wide and `height` tall, centred on the origin at floor level.
   */
  megaRibs(opts?: { count?: number; span?: number; height?: number; spacing?: number; seed?: number }): THREE.Object3D;
  /**
   * A parked/hovering capital silhouette for hangar and battle backdrops.
   * Shuttle ≈ 24 m and transport ≈ 31 m long (near-field PBR, resting on y = 0, nose toward −Z);
   * capitals ≈ 620 m (far-field hazed material, origin at the hull centre).
   */
  ship(kind: 'dominionShuttle' | 'reformationTransport' | 'dominionCapital' | 'reformationCapital', opts?: { scale?: number }): THREE.Object3D;
  /** Crashed dropship hull section (Z00 / Z03 start dressing). Rests on y = 0; ≈ 16 m long at scale 1. */
  wreck(kind: 'dominion' | 'reformation', opts?: { scale?: number; seed?: number }): THREE.Object3D;
}

export type { Vec3Like };
