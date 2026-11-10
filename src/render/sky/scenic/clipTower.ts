/**
 * The scenic tower the carrier clips. `atriumShell()` builds it (with a detachable tip); the carrier aims its
 * authored pass at it. Coordinates are atrium-local (origin = centre of the Z05 platform floor).
 */
import type * as THREE from 'three';

export const CLIP_TOWER = {
  /** tower axis */
  x: 330,
  z: -120,
  /** height of the intact tip */
  top: 432,
  /** height where the hull shears it */
  cut: 404,
  /** progress along the carrier pass at which the hull reaches the tower */
  progress: 0.8,
} as const;

const MAX_TIPS = 4;
const tips: THREE.Object3D[] = [];

/** Called by atriumShell for the detachable tip mesh (its local frame = the shell's frame). */
export function registerClipTip(tip: THREE.Object3D): void {
  tips.push(tip);
  // shells are rebuilt per zone load; only the most recent few can still be alive
  while (tips.length > MAX_TIPS) tips.shift();
}

/** The registered tips (most recent shells). Each carries `userData.home` (its resting position). */
export function clipTips(): readonly THREE.Object3D[] {
  return tips;
}
