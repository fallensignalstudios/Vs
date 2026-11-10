/**
 * Combat sandbox — the real ActorManager + PlayerController against training dummies, with the real physics,
 * input, camera rig, VFX, character visuals and HUD. The tick mirrors Game.tick (hit-stop, slow-mo, sub-steps).
 *
 *   /sandbox/combat/                 play it (WASD, mouse, LMB/F/Q/RMB/Space/1/2/Tab/V/R)
 *   ?who=selene                      start as Selene
 *   &manual=1                        no RAF loop: drive with __step() / the globals below (tools/shot.cjs)
 *
 * Globals:  __combat.who(id) .place(x, z, yawDeg) .face(name) .press(a) .hold(a, on) .move(x, y) .run(seconds)
 *           .cam([pos], [look], fov?) .cam(null) .ai(on) .swing() .shoot() .echo(n) .hp(n) .reset() .state()
 *           .hud(on)   __step(seconds)   __combatReport()  (scripted headless check; returns the report)
 *           __combatSoak(seconds, seed)  (random-input soak: exceptions, NaNs, arena escapes)
 */
import '@fontsource/cinzel/400.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Actor, ButtonAction, Game, ProtagonistId } from '@/core/api';
import { createCharacterFactory } from '@/chars';
import { createActorManager, createPlayerController, spawnPickup, TUNING } from '@/combat';
import { createInputSystem } from '@/core/input';
import { DEG, clamp } from '@/core/mathx';
import { nullObject } from '@/core/stub';
import { createCameraRig } from '@/render/camera';
import { createUiSystem } from '@/ui';
import { createVfxSystem } from '@/vfx';
import { createPhysicsWorld } from '@/world/physics';
import { SANDBOX_QUALITY, createCanvasOnly, miniGame, withStubs } from '../harness';
import { buildArena } from './arena';
import { spawnDummies, type Dummies } from './dummies';
import { runReport, runSoak, type CombatReport } from './report';

const stage = createCanvasOnly();
const params = stage.params;

// --- renderer --------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.28;
scene.fog = new THREE.Fog(0x05060a, 30, 80);

// --- clock with hit-stop and slow-mo, as in GameImpl -----------------------------------------------------
const time = {
  now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStopLeft: 0, slowTarget: 1, slowLeft: 0,
  hitStops: 0, lastHitStop: 0,
  hitStop(seconds: number) {
    time.hitStops++;
    time.lastHitStop = seconds;
    time.hitStopLeft = Math.max(time.hitStopLeft, clamp(seconds, 0, 0.25));
  },
  slowMo(scale: number, seconds: number) {
    time.slowTarget = clamp(scale, 0.05, 1);
    time.slowLeft = Math.max(0, seconds);
  },
  envelope(realDt: number) {
    if (time.slowLeft > 0) {
      time.slowLeft -= realDt;
      time.scale += (time.slowTarget - time.scale) * Math.min(1, realDt * 14);
    } else if (time.scale !== 1) {
      time.scale += (1 - time.scale) * Math.min(1, realDt * 6);
      if (Math.abs(1 - time.scale) < 0.01) time.scale = 1;
    }
  },
};

// --- game shell: real subsystems, in contract order ------------------------------------------------------
const physics = createPhysicsWorld(null);
const game = miniGame(null, {
  scene,
  canvas: stage.canvas,
  uiRoot: document.getElementById('ui') as HTMLElement,
  time: time as unknown as Game['time'],
  physics,
  render: withStubs<Game['render']>('render', { renderer, scene, quality: SANDBOX_QUALITY } as Partial<Game['render']>),
  audio: nullObject<Game['audio']>('audio'),
  ai: nullObject<Game['ai']>('ai'),
  mission: nullObject<Game['mission']>('mission'),
});
const shell = game as { -readonly [K in keyof Game]: Game[K] };
const input = (shell.input = createInputSystem(game));
const rig = (shell.camera = createCameraRig(game));
const vfx = (shell.vfx = createVfxSystem(game));
const ui = (shell.ui = createUiSystem(game));
shell.chars = createCharacterFactory(game);
const actors = (shell.actors = createActorManager(game));
const player = (shell.player = createPlayerController(game));
input.setContext('game');
void ui.init();
ui.setHudVisible(!params.has('nohud'));

buildArena(scene, physics);
let dummies: Dummies = spawnDummies(game);
player.setProtagonist(params.get('who') === 'selene' ? 'selene' : 'tarrik', { pos: { x: 0, y: 0, z: 7 }, yaw: 0 });

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, rig.camera));
if (!params.has('nobloom')) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.95));
composer.addPass(new OutputPass());
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
});

// --- the tick, mirroring Game.tick -----------------------------------------------------------------------
const MAX_STEP = 1 / 45;
function simulate(dt: number): void {
  time.dt = dt;
  time.now += dt;
  game.scripts.update(dt);
  player.update(dt);
  actors.update(dt);
  const a = player.actor;
  physics.updateTriggers(a.alive ? a.pos : null);
  vfx.update(dt);
}
function tick(realDt: number): void {
  const frameDt = clamp(realDt, 0, 0.1);
  time.unscaledDt = frameDt;
  time.frame++;
  input.update(frameDt);
  time.envelope(frameDt);
  if (time.hitStopLeft > 0) {
    time.hitStopLeft -= frameDt;
    time.dt = 0;
  } else {
    const simDt = frameDt * time.scale;
    const steps = Math.max(1, Math.ceil(simDt / MAX_STEP));
    for (let i = 0; i < steps; i++) simulate(simDt / steps);
  }
  rig.update(frameDt);
  ui.update(frameDt);
}
stage.onUpdate((dt) => tick(dt));
stage.setRender(() => composer.render());

// --- helpers for screenshots, the report and the console -------------------------------------------------
const byName = (name: string): Actor | null => (dummies as unknown as Record<string, Actor>)[name] ?? null;
const api = {
  game, player, actors, input, rig, time, TUNING, spawnPickup,
  get dummies() {
    return dummies;
  },
  who(id: ProtagonistId): void {
    const a = player.actor;
    player.setProtagonist(id, { pos: a.pos.clone(), yaw: a.yaw });
    rig.snapBehind(a.yaw);
  },
  /** teleport the protagonist and put the camera behind it */
  place(x: number, z: number, yawDeg = 0): void {
    player.teleport({ x, y: 0, z }, yawDeg * DEG);
    rig.snapBehind(yawDeg * DEG);
  },
  /** turn the protagonist and the camera toward a dummy ('passive' | 'swinger' | 'shooter' | 'shield') */
  face(name: string): void {
    const t = byName(name);
    if (!t) return;
    const a = player.actor;
    a.face(t.pos);
    rig.snapBehind(a.yaw);
    const at = t.aimPoint(new THREE.Vector3());
    rig.aimAt(at);
    // settle the reticle on the target (aim framing has a shoulder offset)
    for (let i = 0; i < 6; i++) {
      tick(1 / 60);
      player.aimAt(t.aimPoint(at));
    }
    tick(1 / 60);
  },
  press(a: ButtonAction): void {
    input.virtual.press(a);
  },
  hold(a: ButtonAction, on: boolean): void {
    input.virtual.hold(a, on);
  },
  move(x: number, y: number): void {
    input.virtual.setMove(x, y);
  },
  /** advance without rendering */
  run(seconds: number): void {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) tick(1 / 60);
  },
  /** free camera for readable stills; null returns to the follow camera */
  cam(pos: [number, number, number] | null, look?: [number, number, number], fov = 50): void {
    if (!pos || !look) rig.setFree(null);
    else rig.setFree({ pos: { x: pos[0], y: pos[1], z: pos[2] }, look: { x: look[0], y: look[1], z: look[2] }, fov });
  },
  ai(on: boolean): void {
    dummies.auto = on;
  },
  swing: (): number => dummies.swing(),
  shoot: (): number => dummies.shoot(),
  echo(n: number): void {
    player.echo = n;
  },
  hp(n: number): void {
    player.actor.hp = n;
  },
  hud(on: boolean): void {
    ui.setHudVisible(on);
  },
  /** fresh dummies, protagonist back at the start */
  reset(who?: ProtagonistId): void {
    for (const d of dummies.all()) actors.despawn(d);
    vfx.clear();
    actors.resetHostility();
    dummies = spawnDummies(game);
    player.setProtagonist(who ?? player.protagonist, { pos: { x: 0, y: 0, z: 7 }, yaw: 0 });
    player.restoreForCheckpoint({ echo: 0 });
    input.virtual.clear();
  },
  state() {
    const a = player.actor;
    const h = player.getHudState();
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      who: player.protagonist, action: player.action, pos: [r(a.pos.x), r(a.pos.y), r(a.pos.z)], yaw: r(a.yaw / DEG), hp: r(a.hp),
      echo: h.echo, ammo: h.ammo, reserve: h.reserve, aiming: h.aiming, guarding: h.guarding, lock: h.lockTarget?.name ?? null,
      dummies: dummies.all().map((d) => ({ name: d.name, hp: r(d.hp), pos: [r(d.pos.x), r(d.pos.z)], alive: d.alive, frozen: d.frozen, staggered: d.staggered })),
      actors: actors.all.length,
      vfx: { particles: vfx.stats.particles, effects: vfx.stats.effects }, hitStops: time.hitStops, scale: r(time.scale),
    };
  },
};
export type CombatSandbox = typeof api;
(window as unknown as { __combat: CombatSandbox }).__combat = api;
let lastReport: CombatReport | null = null;
(window as unknown as { __combatReport: () => CombatReport }).__combatReport = () => (lastReport = runReport(api));
(window as unknown as { __combatReportLast: () => CombatReport | null }).__combatReportLast = () => lastReport;
(window as unknown as { __combatSoak: (seconds?: number, seed?: number) => unknown }).__combatSoak = (seconds, seed) => runSoak(api, seconds, seed);

stage.ready();
