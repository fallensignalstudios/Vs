/**
 * Sky + scenic vista contract — OWNER: sky-scenic (src/render/sky/*).
 * The far field: the Wound, the two remnants, the fleet battle, the carrier, and the immense terminal shell that
 * extends far beyond playable bounds. Nothing here has collision.
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
}

export interface SkySystem {
  /** Add to scene by Game. Follows the camera position (infinite distance illusion). */
  readonly root: THREE.Object3D;
  readonly preset: SkyPreset;
  setPreset(preset: SkyPreset, opts?: { blendSeconds?: number }): void;

  /** Unit directions (world) toward the key bodies for the current preset — use to align key lights. */
  readonly woundDir: THREE.Vector3;
  readonly redRemnantDir: THREE.Vector3;
  readonly whiteRemnantDir: THREE.Vector3;
  /** suggested key light for the preset */
  readonly keyLight: { dir: THREE.Vector3; color: number; intensity: number };

  readonly carrier: CarrierActor;
  /** 0..1 distant fleet battle activity (flashes, tracers) */
  setBattleIntensity(n: number): void;
  /** 0..1 restrained violet movement behind the Wound boundary */
  setWoundActivity(n: number): void;
  /** Consequence visual: boundary closed / stability recovering (subtle gold rim settles, violet stills) */
  setBoundaryClosed(closed: boolean, seconds?: number): void;

  /**
   * Build non-colliding megastructure backdrop pieces. Returned objects are positioned in zone-local space by
   * the caller and disposed with the zone.
   */
  scenic: ScenicFactory;

  update(dt: number, camera: THREE.Camera): void;
}

export interface ScenicFactory {
  /** City-scale converging terminal structure: spires, arms, bridges fading into haze (Wound overlook concept). */
  terminalVista(opts?: { radius?: number; seed?: number; density?: number }): THREE.Object3D;
  /** The ~300 m scenic atrium shell around Z05: ringed tiers, broken spans, transparent ceiling lattice. */
  atriumShell(opts?: { radius?: number; height?: number; shaftRadius?: number }): THREE.Object3D;
  /** One enormous arm of a city-scale Crownmark structure receding to the horizon. */
  crownmarkArm(opts?: { length?: number; width?: number }): THREE.Object3D;
  /** Distant structural ribs (immense spans) for interiors that look out. */
  megaRibs(opts?: { count?: number; span?: number; height?: number; spacing?: number }): THREE.Object3D;
  /** A parked/hovering capital silhouette for hangar and battle backdrops. */
  ship(kind: 'dominionShuttle' | 'reformationTransport' | 'dominionCapital' | 'reformationCapital', opts?: { scale?: number }): THREE.Object3D;
  /** Crashed dropship hull section (Z00 / Z03 start dressing). */
  wreck(kind: 'dominion' | 'reformation', opts?: { scale?: number }): THREE.Object3D;
}

export type { Vec3Like };
