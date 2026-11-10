/** Shared fixtures for the camera unit tests: a headless game shell with the real input system and rig. */
import * as THREE from 'three';
import type { CameraFollowTarget, Game, GameEvents, PhysicsWorld } from '@/core/api';
import { Emitter } from '@/core/events';
import { InputSystemImpl } from '@/core/input';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { FOLLOW } from './follow';
import { CameraRigImpl } from './rig';

export const DT = 1 / 60;

/** rest pose of the follow camera at pitch 0 behind a target at the origin facing −Z (see FOLLOW.lookOffset) */
const TOE = Math.asin(FOLLOW.lookOffset / FOLLOW.distance);
export const REST = {
  x: FOLLOW.shoulder + FOLLOW.distance * Math.sin(TOE),
  z: FOLLOW.distance * Math.cos(TOE),
};
/** arm length actually in use, measured from the shoulder anchor (valid at pitch 0, yaw 0, target at origin) */
export const armLength = (rig: CameraRigImpl, side = 1): number =>
  Math.hypot(rig.camera.position.x - side * FOLLOW.shoulder, rig.camera.position.z);

export function setup(physics?: Partial<PhysicsWorld>) {
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  /** the host state the rig reads: simulation clock, phase, pause, loading */
  const host = { time: { now: 0, scale: 1 }, phase: 'playing', paused: false, mission: { loading: false } };
  const game = Object.assign(host, {
    events,
    settings,
    scene: new THREE.Scene(),
    physics: physics ?? nullObject<PhysicsWorld>('physics'),
  }) as unknown as Game;
  const input = new InputSystemImpl(game, { win: null, doc: null, canvas: null, getGamepads: () => null });
  (game as { input: unknown }).input = input;
  const rig = new CameraRigImpl(game);
  (game as { camera: unknown }).camera = rig;
  rig.setViewport(1280, 720);
  // Reduced shake also disables idle breathing, which keeps pose assertions exact.
  settings.set('reduceShake', true);
  const target: CameraFollowTarget = { pos: new THREE.Vector3(0, 0, 0), height: 1.55, yaw: 0 };
  /** one frame in engine order; `simScale` is how much of the frame the simulation advanced (0 = hit-stop) */
  const tick = (n = 1, dt = DT, simScale = 1) => {
    for (let i = 0; i < n; i++) {
      input.update(dt);
      if (!host.paused && !host.mission.loading) host.time.now += dt * simScale;
      rig.update(dt);
    }
  };
  return { game, host, input, rig, settings, target, tick };
}

export const camDir = (rig: CameraRigImpl) => rig.camera.getWorldDirection(new THREE.Vector3());
