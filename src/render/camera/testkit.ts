/** Shared fixtures for the camera unit tests: a headless game shell with the real input system and rig. */
import * as THREE from 'three';
import type { CameraFollowTarget, Game, GameEvents, PhysicsWorld } from '@/core/api';
import { Emitter } from '@/core/events';
import { InputSystemImpl } from '@/core/input';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { CameraRigImpl } from './rig';

export const DT = 1 / 60;

export function setup(physics?: Partial<PhysicsWorld>) {
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  const game = {
    events,
    settings,
    scene: new THREE.Scene(),
    physics: physics ?? nullObject<PhysicsWorld>('physics'),
  } as unknown as Game;
  const input = new InputSystemImpl(game, { win: null, doc: null, canvas: null, getGamepads: () => null });
  (game as { input: unknown }).input = input;
  const rig = new CameraRigImpl(game);
  (game as { camera: unknown }).camera = rig;
  rig.setViewport(1280, 720);
  // Reduced shake also disables idle breathing, which keeps pose assertions exact.
  settings.set('reduceShake', true);
  const target: CameraFollowTarget = { pos: new THREE.Vector3(0, 0, 0), height: 1.55, yaw: 0 };
  const tick = (n = 1, dt = DT) => {
    for (let i = 0; i < n; i++) {
      input.update(dt);
      rig.update(dt);
    }
  };
  return { game, input, rig, settings, target, tick };
}

export const camDir = (rig: CameraRigImpl) => rig.camera.getWorldDirection(new THREE.Vector3());
