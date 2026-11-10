/** STUB — replaced by the camera-input agent. */
import type { CameraRig, Game } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createCameraRig(_game: Game): CameraRig {
  return nullObject<CameraRig>('camera');
}
