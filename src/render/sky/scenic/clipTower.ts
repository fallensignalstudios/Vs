/**
 * The scenic tower the carrier clips. `atriumShell()` builds it (with a detachable tip); the carrier aims its
 * authored pass so that the ventral bow ram — the lowest point of the hull — first touches the tip at
 * `progress`. Coordinates are atrium-local (origin = centre of the Z05 platform floor).
 */
import type * as THREE from 'three';

export const CLIP_TOWER = {
  /** tower axis */
  x: 330,
  z: -120,
  /** height of the intact tip */
  top: 446,
  /** height where the hull shears it (the gold collar) */
  cut: 400,
  /** radius of the needle at the cut */
  cutRadius: 8,
  /** progress along the carrier pass at which the bow ram first touches the tip */
  progress: 0.8,
} as const;

/** Radius of the tower at height `y` (the needle above the collar, the shaft below it). */
export function clipTowerRadius(y: number): number {
  if (y >= CLIP_TOWER.cut) return Math.max(0, CLIP_TOWER.cutRadius * (1 - (y - CLIP_TOWER.cut) / (CLIP_TOWER.top - CLIP_TOWER.cut)));
  return CLIP_TOWER.cutRadius + (CLIP_TOWER.cut - y) * 0.05;
}

/**
 * Per-SkySystem link between the most recent atrium shell and the carrier: the shell registers its detachable
 * tip here and the carrier animates it. `home` = the tip's resting position in the shell's local frame.
 */
export class ClipTipSlot {
  tip: THREE.Object3D | null = null;
  readonly home = { x: CLIP_TOWER.x, y: CLIP_TOWER.cut, z: CLIP_TOWER.z };
  set(tip: THREE.Object3D): void {
    this.tip = tip;
  }
}
