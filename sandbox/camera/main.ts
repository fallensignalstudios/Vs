/**
 * Camera + input sandbox. Drive the mannequin with the REAL input system (keyboard / mouse / gamepad, or
 * `virtual` from the screenshot tool) through a tiny local movement loop, against the real physics subsystem
 * when it exists (else a local mock; force with ?physics=mock).
 *
 * Screenshot globals:  __cam.place(spot|[x,z], yawDeg?)  __cam.look(yawDeg, pitchDeg)  __cam.lock(i|null)
 *                      __cam.cinematic()  __cam.state()  __cam.hud(bool)  + __step(seconds)
 */
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { CameraFollowTarget, Game, PhysicsWorld, Routine } from '@/core/api';
import { createInputSystem } from '@/core/input';
import { DEG, damp, turnToward } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { createCameraRig } from '@/render/camera';
import { createPhysicsWorld } from '@/world/physics';
import { createCanvasOnly, miniGame } from '../harness';
import { buildArena, buildEnvironmentScene, lightArena } from './arena';
import { createHud } from './hud';
import { createMannequin } from './mannequin';
import { createMockPhysics } from './mockPhysics';

const stage = createCanvasOnly();
const params = stage.params;

// --- renderer ----------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(buildEnvironmentScene(), 0.02).texture;
scene.environmentIntensity = 0.9;
lightArena(scene);

// --- physics: the real subsystem when it has landed, else the local mock ------------------------
function makePhysics(): { world: PhysicsWorld; label: string } {
  if (params.get('physics') !== 'mock') {
    try {
      const real = createPhysicsWorld(null);
      if (!isStub(real) && typeof real.sweepSphere({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, 0.25) === 'number') {
        return { world: real, label: 'physics subsystem' };
      }
    } catch (err) {
      console.warn('[sandbox] real physics unavailable, using the mock', err);
    }
  }
  return { world: createMockPhysics(), label: 'sandbox mock' };
}
const { world: physics, label: physicsLabel } = makePhysics();

// --- game shell with the real input system + camera rig -----------------------------------------
const game = miniGame({ scene, camera: new THREE.PerspectiveCamera(), renderer, onUpdate: stage.onUpdate }, { physics });
const shell = game as { -readonly [K in keyof Game]: Game[K] };
const input = (shell.input = createInputSystem(game));
const rig = (shell.camera = createCameraRig(game));
input.setContext('game');

const arena = buildArena(scene, physics);
const mannequin = createMannequin();
scene.add(mannequin.root);

const player: CameraFollowTarget & { yaw: number } = { pos: new THREE.Vector3(0, 0, 6), height: 1.55, yaw: 0 };
rig.setTarget(player);
rig.snapBehind(0);

// MSAA target: the gold channels are sub-pixel at range and crawl without it
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, rig.camera));
if (!params.has('nobloom')) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.5, 1.15));
composer.addPass(new OutputPass());
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
});

const hud = createHud(input, rig, params.has('manual'));
if (params.has('nohud')) hud.setVisible(false);

// --- local movement loop (BRIEF §5 numbers) -----------------------------------------------------
const WALK = 2.2;
const RUN = 5.2;
const SPRINT = 7.2;
const RADIUS = 0.4;
const DODGE_DIST = 4.5;
const DODGE_TIME = 0.45;
const vel = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const dodgeDir = new THREE.Vector3();
let dodgeLeft = 0;
let lockIndex = -1;
let cinematic = false;

function toggleLock(): void {
  if (lockIndex >= 0) {
    lockIndex = -1;
    rig.setLockOn(null);
    return;
  }
  // nearest to the view direction within 35 m
  rig.getForward(fwd);
  let best = -1;
  let bestScore = 0.2;
  arena.dummies.forEach((d, i) => {
    const dx = d.point.x - player.pos.x;
    const dz = d.point.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 35 || dist < 0.5) return;
    const score = (dx * fwd.x + dz * fwd.z) / dist - dist * 0.004;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  setLock(best);
}

function setLock(i: number): void {
  lockIndex = i >= 0 && i < arena.dummies.length ? i : -1;
  const d = lockIndex >= 0 ? arena.dummies[lockIndex] : null;
  rig.setLockOn(d ? () => d.point : null);
}

function simulate(dt: number): void {
  if (input.pressed('pause')) input.setContext(input.context === 'menu' ? 'game' : 'menu');
  if (input.pressed('interact') && !cinematic) game.scripts.start(demoCinematic(), { name: 'cameraDemo' });
  if (input.pressed('lockOn')) toggleLock();

  // intent in world space
  let ix: number;
  let iz: number;
  const world = input.moveWorld;
  if (world) {
    ix = world.x;
    iz = world.z;
  } else {
    rig.getForward(fwd);
    rig.getRight(right);
    ix = right.x * input.move.x + fwd.x * input.move.y;
    iz = right.z * input.move.x + fwd.z * input.move.y;
  }
  const len = Math.hypot(ix, iz);
  const mag = Math.min(1, len);
  const aiming = input.down('aim') && !cinematic;
  rig.setAim(aiming);
  const sprinting = input.down('sprint') && mag > 0.2 && !aiming;
  const top = aiming ? 2.6 : sprinting ? SPRINT : mag < 0.5 ? WALK * (mag / 0.5) : WALK + (RUN - WALK) * ((mag - 0.5) / 0.5);
  const tx = len > 1e-4 ? (ix / len) * top : 0;
  const tz = len > 1e-4 ? (iz / len) * top : 0;
  vel.x = damp(vel.x, tx, 14, dt);
  vel.z = damp(vel.z, tz, 14, dt);

  if (input.pressed('dodge') && dodgeLeft <= 0) {
    dodgeLeft = DODGE_TIME;
    if (len > 0.1) dodgeDir.set(ix / len, 0, iz / len);
    else dodgeDir.set(Math.sin(player.yaw), 0, Math.cos(player.yaw)); // no stick: hop back
    rig.fovPunch(2.5, 0.5);
  }
  let mx = vel.x * dt;
  let mz = vel.z * dt;
  if (dodgeLeft > 0) {
    // front-loaded burst that integrates to exactly DODGE_DIST over DODGE_TIME
    const u = 1 - dodgeLeft / DODGE_TIME;
    const step = Math.min(dt, dodgeLeft);
    const speed = (DODGE_DIST / DODGE_TIME) * (1.6 - 1.2 * u);
    mx = dodgeDir.x * speed * step;
    mz = dodgeDir.z * speed * step;
    dodgeLeft -= dt;
  }
  const res = physics.moveCharacter(player.pos, RADIUS, mx, mz);
  if (res && Number.isFinite(res.x) && Number.isFinite(res.y) && Number.isFinite(res.z)) player.pos.set(res.x, res.y, res.z);

  // facing: lock target, aim direction, or direction of travel
  const lock = lockIndex >= 0 ? arena.dummies[lockIndex] : null;
  const speed = Math.hypot(vel.x, vel.z);
  if (lock) player.yaw = turnToward(player.yaw, Math.atan2(-(lock.point.x - player.pos.x), -(lock.point.z - player.pos.z)), 12 * dt);
  else if (aiming) player.yaw = turnToward(player.yaw, rig.yaw, 14 * dt);
  else if (speed > 0.4) player.yaw = turnToward(player.yaw, Math.atan2(-vel.x, -vel.z), 11 * dt);

  // feel hooks so every camera response can be judged by hand
  if (input.pressed('attack')) {
    if (aiming) {
      rig.kick(1.5, (game.random() - 0.5) * 0.9);
      rig.fovPunch(-1.2, 0.18);
      rig.shake(0.2, 0.18);
      input.rumble(0.7, 0.3, 90);
    } else {
      rig.shake(0.16, 0.16);
      input.rumble(0.25, 0.4, 60);
    }
  }
  if (input.pressed('heavy')) {
    rig.shake(0.55, 0.4);
    rig.fovPunch(3, 0.45);
    input.rumble(1, 0.6, 180);
  }
  if (input.pressed('ability1')) {
    rig.shake(0.95, 0.75);
    rig.fovPunch(5, 0.6);
    input.rumble(1, 1, 320);
  }
  if (input.pressed('scan')) rig.fovPunch(-3.5, 0.8);

  mannequin.root.position.copy(player.pos);
  mannequin.root.rotation.y = player.yaw;
  mannequin.animate(dt, dodgeLeft > 0 ? 9 : speed, aiming);
  // fade the figure out when the spring arm is squeezed against it
  mannequin.setOpacity(rig.mode === 'follow' ? (rig.targetDistance - 0.45) / 0.45 : 1);
}

/** Establishing shot → eased push-in with roll and FOV change → slow drift → blend back to gameplay. */
function* demoCinematic(): Routine {
  cinematic = true;
  input.setContext('cinematic');
  const p = player.pos;
  const skip = () => input.heldTime('skip') > 0.5;
  rig.cine.cut({ pos: { x: p.x - 7.5, y: p.y + 4.4, z: Math.min(p.z + 5.5, 10.6) }, look: { x: p.x + 0.3, y: p.y + 0.9, z: p.z - 7 }, fov: 34 });
  rig.cine.handheld(0.4);
  yield { race: [0.8, skip] };
  rig.cine.move({ pos: { x: p.x + 2.4, y: p.y + 1.75, z: p.z + 2.8 }, look: { x: p.x - 0.5, y: p.y + 1.5, z: p.z - 6 }, fov: 44, roll: -3 }, 4.5, 'inOutCubic');
  yield { race: [() => !rig.cine.moving, skip] };
  rig.cine.finish();
  rig.cine.drift({ around: { x: p.x, y: p.y, z: p.z }, yawRate: 0.12, lookHeight: 1.45 });
  yield { race: [2.5, skip] };
  rig.release(1.2);
  input.setContext('game');
  cinematic = false;
}

/** one frame in engine order: input → sim → camera */
function tick(dt: number): void {
  input.update(dt);
  simulate(dt);
  rig.update(dt);
}
stage.onUpdate((dt) => {
  tick(dt);
  const lock = lockIndex >= 0 ? arena.dummies[lockIndex] : null;
  hud.update({ lockPoint: lock ? lock.point : null, lockName: lock ? lock.name : '', cinematic, physics: physicsLabel });
});
stage.setRender(() => composer.render());

// --- screenshot / console helpers ---------------------------------------------------------------
const api = {
  game, rig, input, player, arena,
  /** teleport the mannequin to a named spot or [x, z] and put the camera behind it */
  place(where: string | [number, number], yawDeg?: number): void {
    const spot = typeof where === 'string' ? arena.spots[where] : { x: where[0], z: where[1], yaw: 0 };
    if (!spot) {
      console.warn(`[sandbox] unknown spot "${String(where)}" — try ${Object.keys(arena.spots).join(', ')}`);
      return;
    }
    const yaw = yawDeg !== undefined ? yawDeg * DEG : spot.yaw;
    const g = physics.groundAt(spot.x, spot.z, 50, 0);
    player.pos.set(spot.x, g && Number.isFinite(g.y) ? g.y : 0, spot.z);
    player.yaw = yaw;
    vel.set(0, 0, 0);
    dodgeLeft = 0;
    rig.snapBehind(yaw);
  },
  /** set the follow orbit directly (degrees) */
  look(yawDeg: number, pitchDeg: number): void {
    rig.yaw = yawDeg * DEG;
    rig.pitch = pitchDeg * DEG;
  },
  lock(i: number | null): void {
    setLock(i === null ? -1 : i);
  },
  cinematic(): void {
    if (!cinematic) game.scripts.start(demoCinematic(), { name: 'cameraDemo' });
  },
  hud(v: boolean): void {
    hud.setVisible(v);
  },
  /** advance input + sim + camera without rendering (stress tests) */
  __tick: tick,
  state() {
    const c = rig.camera;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      mode: rig.mode, yaw: r(rig.yaw / DEG), pitch: r(rig.pitch / DEG), fov: r(c.fov), dist: r(rig.targetDistance),
      cam: [r(c.position.x), r(c.position.y), r(c.position.z)], player: [r(player.pos.x), r(player.pos.y), r(player.pos.z)],
      context: input.context, device: input.device, lookMode: input.lookMode, physics: physicsLabel,
    };
  },
};
(window as unknown as { __cam: typeof api }).__cam = api;

stage.ready();
