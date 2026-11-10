/**
 * VFX contract — OWNER: vfx (src/vfx/*).
 * Pooled GPU particles, beams, trails, decals, shockwaves, light flashes. Unknown ids must warn once and no-op.
 * Readability rule from the plan: reduce particles until the hit and recovery routes remain visible.
 *
 * CONVENTIONS (for combat / AI / zone authors)
 *  - `spawn(id, pos, opts)`: `opts.dir` is the effect axis — the surface normal for impacts, the firing direction
 *    for muzzle effects, the shield/boundary normal for shieldHit / shieldBreak / boundaryClose / quarantineSeal /
 *    coherentPlane, the link direction for linkSever. Default is world up.
 *  - `opts.scale` multiplies sizes, speeds and radii. Authored sizes at scale 1 are listed in VFX_NOTES below.
 *  - `opts.color` re-tints the effect (e.g. `stoneChip` for black stone, `droneCharge` for contaminated drones).
 *  - SUSTAINED effects keep emitting until `handle.stop()` or `opts.duration` (their default is in VFX_NOTES);
 *    everything else is a one-shot whose handle turns `alive === false` when its last particle is gone.
 *  - Ground rings / decals that belong to an effect are projected onto the floor under it (physics.groundAt) when
 *    it is within 3 m; effects high in the air simply skip them.
 *  - Light flashes are pooled (max 4 live, shadowless) and honour `settings.reduceFlash`.
 *  - Everything advances with the `dt` given to `update` (sim time): hit-stop and pause freeze effects too.
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

/**
 * Per-effect usage notes: where to put `pos`, what `dir` / `scale` mean, and which effects are sustained
 * (value after "sustain" = default seconds; ∞ = until `stop()`). Effects not listed are plain one-shots at `pos`.
 */
export const VFX_NOTES: Readonly<Record<string, string>> = {
  sparkHit: 'pos = contact point, dir = surface normal',
  sparkHeavy: 'pos = contact point, dir = surface normal',
  metalChip: 'pos = contact point, dir = surface normal',
  stoneChip: 'pos = contact point, dir = surface normal; color = stone colour',
  dustPuff: 'dir = surface normal',
  footDust: 'pos = foot on the floor',
  cinderSlam: 'pos = ground strike point; reaches ~4.8 m at scale 1; leaves scorch + crack decals',
  cinderEmbers: 'sustain 1.4 — attachTo a blade/hand for a charged look',
  cinderStickyArm: 'sustain 1.6 — pass duration = fuse seconds; the pulse accelerates toward the end. Follow with cinderStickyBlast',
  stasisField: 'sustain 4 — pos = floor centre; dome radius 3.5 m at scale 1',
  frostArrest: 'pos = arrested target centre; the ring snaps at +0.28 s',
  dispatchStreak: 'pos = start, dir = travel direction, scale = distance / 4 m',
  violetWisp: 'sustain 2.5 — corruption source dressing',
  linkSever: 'pos = cut point, dir = link direction (halves whip back along it)',
  eclipseDissolve: 'pos = body centre (~chest height); ~1.4 s',
  eclipseSpawn: 'pos = floor point; body should appear at +0.5 s',
  pressurePulse: 'pos = floor under the elite; band reaches 9 m in 0.95 s at scale 1',
  muzzleWarm: 'pos = muzzle, dir = firing direction',
  muzzleCold: 'pos = muzzle, dir = firing direction',
  droneCharge: 'sustain 0.8 — attachTo the drone muzzle; duration = telegraph seconds; color for contaminated drones',
  shieldHit: 'pos = contact on the shield, dir = shield normal (toward the attacker); color = shield colour',
  shieldBreak: 'pos = shield centre, dir = shield normal',
  deviceBreak: 'color = owner glow colour (default Reformation blue)',
  debrisFall: 'sustain 1.2 — pos = where debris starts falling (ceiling / ledge)',
  cageDestroy: 'pos = cage base centre on the floor',
  healPickup: 'sustain ∞ — idle marker on a sustain drop; stop() on pickup then spawn healBurst',
  healBurst: 'pos = feet of the healed actor',
  echoGain: 'pos = chest of the protagonist; color = cinder / frost',
  checkpointPulse: 'pos = floor',
  thermalFracture: 'pos = the regenerating joint. Arrest at +0.50 s, cinder strike at +0.98 s, ~3 s total. scale 1 suits the 3.6 m elite',
  resonanceRing: 'sustain 1.2 — duration = confirm window; the cinder ring meets the frost ring exactly at the end',
  quarantineSeal: 'sustain 2.6 — pos = threshold centre on the floor, dir = barrier normal; 8 × 4.5 m at scale 1',
  goldRecognition: 'pos = floor point being recognised',
  assentTarrik: 'pos = floor at the console (warm, rising)',
  assentSelene: 'pos = floor at the console (cool, exact)',
  meridianComplete: 'pos = dais centre on the floor; gathers from 6 m at scale 1; resolves to white at +1.85 s',
  boundaryClose: 'pos = aperture centre, dir = toward the viewer; 6 m radius at scale 1; ~2.6 s',
  grammarPropagate: 'sustain 3 — pos = floor origin; glyphs race outward along eight lines',
  carrierShadowDust: 'sustain 3 — pos = floor centre of a 20 × 20 m patch',
  coherentPlane: 'sustain ∞ — pos = plane centre, dir = plane normal (default horizontal); 6 × 6 m at scale 1',
  witnessMote: 'sustain 3 — drifting memory light around pos',
};

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

/** Live object counts (debug overlay / perf budget checks). The same object is reused between reads. */
export interface VfxStats {
  /** live particles across the four layers (budget ≈ 6000) */
  particles: number;
  /** live effect instances */
  effects: number;
  beams: number;
  tracers: number;
  trails: number;
  decals: number;
  telegraphs: number;
  /** live mesh shapes (domes, walls, halos…) — one draw call each */
  shapes: number;
  /** flash lights currently lit (max 4) */
  flashes: number;
  /** ambient volumes — one draw call each */
  ambients: number;
}

export interface VfxSystem {
  /** one-shot or sustained effect */
  spawn(id: VfxId, pos: Vec3Like, opts?: VfxOpts): VfxHandle;
  /**
   * persistent beam between two points/objects until removed. Objects are followed every frame.
   * Patterns travel from `from` to `to`: for 'trace' make `to` the SOURCE being pointed at; for 'command' / 'relay'
   * make `from` the emitter / relay and `to` the drone. 'link' pulses run from `from` (Weaver) to `to` (body).
   * Default widths (m): link 0.2, laser 0.05, scan 0.12, tether 0.1, command 0.07, relay 0.11, trace 0.2, gold 0.1.
   * Removed by clear().
   */
  beam(from: Vec3Like | THREE.Object3D, to: Vec3Like | THREE.Object3D, style: BeamStyle, opts?: { color?: number; width?: number }): BeamHandle;
  /**
   * instantaneous projectile streak from→to. The head travels at `speed` m/s (defaults: warm 150, cold 320,
   * drone 60, violet 34, rifle 520) and the streak fades once it arrives; pair with an impact effect at `to`.
   */
  tracer(from: Vec3Like, to: Vec3Like, style: 'warm' | 'cold' | 'drone' | 'violet' | 'rifle', opts?: { speed?: number }): void;
  /**
   * weapon swoosh ribbon between two sockets. `length` = seconds a sample persists (default 0.24).
   * The trail belongs to its creator: it survives clear() (only its ribbon is dropped) and ends with remove().
   */
  trail(base: THREE.Object3D, tip: THREE.Object3D, opts?: { color?: number; length?: number }): TrailHandle;
  /**
   * volume of drifting ambient particles (zone dressing). Removed on clear(). `center` / `size` describe a
   * world-space box; particles only exist in a window around the camera inside it, so large boxes are cheap.
   * `density` 1 = authored default. One draw call per volume.
   */
  ambient(kind: AmbientKind, center: Vec3Like, size: Vec3Like, density?: number): VfxHandle;
  scanPlane(color?: number): ScanPlaneVisual;
  /** ground/wall decal that fades after `life` seconds (default 20). `size` = diameter in metres (default 1.5) */
  decal(kind: 'scorch' | 'frost' | 'violet' | 'crack' | 'goldRing', pos: Vec3Like, opts?: { normal?: Vec3Like; size?: number; life?: number }): void;
  /** expanding ground ring */
  shockwave(pos: Vec3Like, radius: number, color: number, seconds?: number): void;
  /** transient point light. `intensity` 1 ≈ muzzle flash, 3 ≈ explosion, 6+ ≈ hero beat. Default 0.2 s. */
  flash(pos: Vec3Like, color: number, intensity: number, seconds?: number): void;
  /**
   * telegraph marker on the ground (circle / line / cone) for announced attacks.
   * The fill grows linearly and reaches the outline EXACTLY at `seconds` (land the attack then); the marker
   * flashes for ~0.14 s and removes itself. `stop()` cancels it early. Cone `yaw` uses the engine convention
   * (0 faces −Z), `arc` is the full angle in radians. Line fill runs from `from` to `to`.
   */
  telegraph(shape: { kind: 'circle'; pos: Vec3Like; r: number } | { kind: 'line'; from: Vec3Like; to: Vec3Like; width: number } | { kind: 'cone'; pos: Vec3Like; yaw: number; arc: number; r: number }, seconds: number, color?: number): VfxHandle;

  update(dt: number): void;
  /** remove everything (zone unload) */
  clear(): void;

  /** true if `id` is a registered effect (lets callers probe optional ids without triggering a warning) */
  has(id: string): boolean;
  /** every registered effect id */
  ids(): string[];
  /** live counts for the debug overlay */
  readonly stats: VfxStats;
  /**
   * Optional soft particles: give the VFX system a copy of the scene depth (a THREE.DepthTexture rendered by a
   * depth pre-pass — NOT the depth attachment of the target the particles are drawn into) so sprites fade where
   * they intersect geometry. `width`/`height` = drawing-buffer size of the pass that draws the particles,
   * `near`/`far` = camera planes. Pass null to disable. Without it, floor-hugging sprites still fade against the
   * ground plane under their effect.
   */
  setSoftDepth(texture: THREE.Texture | null, width?: number, height?: number, near?: number, far?: number): void;
}
