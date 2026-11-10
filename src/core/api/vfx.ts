/**
 * VFX contract — OWNER: vfx (src/vfx/*).
 * Pooled GPU particles, beams, trails, decals, shockwaves, light flashes. Unknown ids must warn once and no-op.
 * Readability rule from the plan: reduce particles until the hit and recovery routes remain visible.
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';

export type VfxId =
  // impacts
  | 'sparkHit' | 'sparkHeavy' | 'metalChip' | 'stoneChip' | 'dustPuff' | 'footDust'
  // Tarrik / Cinder
  | 'cinderBurst' | 'cinderSlam' | 'cinderEmbers' | 'cinderStickyArm' | 'cinderStickyBlast'
  // Selene / Frost
  | 'frostBurst' | 'frostShatter' | 'frostArrest' | 'stasisField' | 'dispatchStreak'
  // Eclipse
  | 'violetBurst' | 'violetWisp' | 'linkSever' | 'eclipseDissolve' | 'eclipseSpawn' | 'pressurePulse'
  // weapons
  | 'muzzleWarm' | 'muzzleCold' | 'droneCharge' | 'droneBoltHit' | 'shieldHit' | 'shieldBreak' | 'deflect'
  // destruction
  | 'explosionSmall' | 'explosionLarge' | 'deviceBreak' | 'debrisFall' | 'cageDestroy'
  // pickups / feedback
  | 'healPickup' | 'healBurst' | 'echoGain' | 'checkpointPulse' | 'interactPing'
  // story
  | 'thermalFracture' | 'resonanceRing' | 'quarantineSeal' | 'goldRecognition'
  | 'assentTarrik' | 'assentSelene' | 'meridianComplete' | 'boundaryClose' | 'grammarPropagate'
  | 'carrierShadowDust' | 'coherentPlane' | 'witnessMote'
  | (string & {});

export interface VfxOpts {
  /** emission direction / surface normal (unit) */
  dir?: Vec3Like;
  scale?: number;
  color?: number;
  /** follow this object while alive */
  attachTo?: THREE.Object3D;
  /** override lifetime for sustained effects */
  duration?: number;
}

export interface VfxHandle {
  readonly alive: boolean;
  setPosition(p: Vec3Like): void;
  /** stop emitting and let particles fade */
  stop(): void;
}

export type BeamStyle =
  | 'link'      // Eclipse link: violet, pulsing in cadence, slightly sagging
  | 'laser'     // thin hot line (drone aim / lane telegraph)
  | 'scan'      // cold blue sweep line
  | 'tether'    // Selene's frost tether
  | 'command'   // E1 emitter ↔ drone synchronisation
  | 'relay'     // E2 relay ↔ drone coordination
  | 'trace'     // interpretable trace pointing back at a source (dotted, directional)
  | 'gold';     // King-era recognition light

export interface BeamHandle {
  readonly alive: boolean;
  setEnds(from: Vec3Like, to: Vec3Like): void;
  /** 0..1 brightness / thickness modulation */
  setIntensity(n: number): void;
  setColor(color: number): void;
  remove(fadeSeconds?: number): void;
}

export interface TrailHandle {
  /** enable while a swing is active */
  setActive(active: boolean): void;
  setColor(color: number): void;
  remove(): void;
}

export interface ScanPlaneVisual {
  readonly object: THREE.Object3D;
  /** place the plane: centre, facing yaw, width, height */
  setPose(center: Vec3Like, yaw: number, width: number, height: number): void;
  /** 0..1 edge brightness; set 1 briefly on detection */
  setAlert(n: number): void;
  remove(): void;
}

export type AmbientKind = 'embers' | 'dust' | 'frostMotes' | 'violetMotes' | 'ash' | 'goldMotes' | 'snow';

export interface VfxSystem {
  /** one-shot or sustained effect */
  spawn(id: VfxId, pos: Vec3Like, opts?: VfxOpts): VfxHandle;
  /** persistent beam between two points/objects until removed. Objects are followed every frame. */
  beam(from: Vec3Like | THREE.Object3D, to: Vec3Like | THREE.Object3D, style: BeamStyle, opts?: { color?: number; width?: number }): BeamHandle;
  /** instantaneous projectile streak from→to */
  tracer(from: Vec3Like, to: Vec3Like, style: 'warm' | 'cold' | 'drone' | 'violet' | 'rifle', opts?: { speed?: number }): void;
  /** weapon swoosh ribbon between two sockets */
  trail(base: THREE.Object3D, tip: THREE.Object3D, opts?: { color?: number; length?: number }): TrailHandle;
  /** volume of drifting ambient particles (zone dressing). Removed on clear(). */
  ambient(kind: AmbientKind, center: Vec3Like, size: Vec3Like, density?: number): VfxHandle;
  scanPlane(color?: number): ScanPlaneVisual;
  /** ground/wall decal that fades after `life` seconds (default 20) */
  decal(kind: 'scorch' | 'frost' | 'violet' | 'crack' | 'goldRing', pos: Vec3Like, opts?: { normal?: Vec3Like; size?: number; life?: number }): void;
  /** expanding ground ring */
  shockwave(pos: Vec3Like, radius: number, color: number, seconds?: number): void;
  /** transient point light */
  flash(pos: Vec3Like, color: number, intensity: number, seconds?: number): void;
  /** telegraph marker on the ground (circle / line / cone) for announced attacks */
  telegraph(shape: { kind: 'circle'; pos: Vec3Like; r: number } | { kind: 'line'; from: Vec3Like; to: Vec3Like; width: number } | { kind: 'cone'; pos: Vec3Like; yaw: number; arc: number; r: number }, seconds: number, color?: number): VfxHandle;

  update(dt: number): void;
  /** remove everything (zone unload) */
  clear(): void;
}
