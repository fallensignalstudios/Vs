/**
 * Camera subsystem — third-person follow / aim / lock-on rig with spring-arm collision, trauma shake and an
 * authored cinematic layer. See `CameraRig` in '@/core/api' (camera.ts) for the contract and conventions.
 */
import type { CameraRig, Game } from '@/core/api';
import { CameraRigImpl } from './rig';

export { CameraRigImpl } from './rig';
export { FOLLOW, orbitPitchFor } from './follow';

export function createCameraRig(game: Game): CameraRig {
  return new CameraRigImpl(game);
}
