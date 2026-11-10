/**
 * AI sandbox — every encounter of the slice in a greybox, with the real player, physics / nav, camera rig, VFX,
 * character visuals and HUD. The tick mirrors Game.tick (input → scripts → player → ai → actors → vfx → camera).
 *
 *   /sandbox/ai/?scene=e1|e2|e3|e4|companions      play it (WASD, mouse, LMB / F / Q / RMB / Space / 1 / 2 / Tab / V)
 *   &bot=1        the scripted virtual-input bot plays          &god=1   the protagonist takes no damage
 *   &manual=1     no RAF loop: drive with __step() / the globals below (tools/shot.cjs)      &nohud=1
 *
 * Globals:  __ai.run(seconds)  .cam([pos],[look],fov?) / .cam(null)  .bot(on)  .god(on)  .place(x, z, yawDeg)
 *           .state()  .refs  .game  .until(fnSource, maxSeconds)  .watch(role | actor)  .press(a) .hold(a, on)
 *           __aiReport(seconds = 60)   run the scene headless under the bot and summarise what happened
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
import type { Actor, ButtonAction, Game } from '@/core/api';
import { createAiSystem } from '@/ai';
import { createCharacterFactory } from '@/chars';
import { createActorManager, createPlayerController } from '@/combat';
import { createInputSystem } from '@/core/input';
import { DEG, clamp } from '@/core/mathx';
import { nullObject } from '@/core/stub';
import { createCameraRig } from '@/render/camera';
import { createUiSystem } from '@/ui';
import { createVfxSystem } from '@/vfx';
import { createPhysicsWorld } from '@/world/physics';
import { SANDBOX_QUALITY, createCanvasOnly, miniGame, withStubs } from '../harness';
import { Bot } from './bot';
import { createGreybox } from './greybox';
import { makeReporter } from './report';
import { buildScene, type SceneId } from './scenes';

const stage = createCanvasOnly();
const params = stage.params;

// --- renderer --------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
scene.fog = new THREE.Fog(0x05060a, 45, 120);
scene.add(new THREE.HemisphereLight(0xb9c8ff, 0x1a1208, 0.42));
const key = new THREE.DirectionalLight(0xffe6c4, 2.3);
key.position.set(20, 30, 14);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
const sc = key.shadow.camera;
sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.far = 120;
key.shadow.bias = -0.0006;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.0);
rim.position.set(-12, 22, -16);
scene.add(rim);

// --- clock with hit-stop and slow-mo, as in GameImpl -----------------------------------------------------
const time = {
  now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStopLeft: 0, slowTarget: 1, slowLeft: 0,
  hitStop(seconds: number) {
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
const realPhysics = createPhysicsWorld(null);
const gb = createGreybox(scene, realPhysics);
const game = miniGame(null, {
  scene,
  canvas: stage.canvas,
  uiRoot: document.getElementById('ui') as HTMLElement,
  time: time as unknown as Game['time'],
  physics: realPhysics,
  render: withStubs<Game['render']>('render', { renderer, scene, quality: SANDBOX_QUALITY } as Partial<Game['render']>),
  audio: nullObject<Game['audio']>('audio'),
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
const ai = (shell.ai = createAiSystem(game));
input.setContext('game');
void ui.init();
ui.setHudVisible(!params.has('nohud'));

const bot = new Bot(game);
const log: string[] = [];
const sceneId = (['e1', 'e2', 'e3', 'e4', 'companions'].includes(params.get('scene') ?? '') ? params.get('scene') : 'e1') as SceneId;
const current = buildScene(sceneId, { game, gb, scene, bot, log: (msg) => log.push(`${time.now.toFixed(1)}s ${msg}`) });
player.setProtagonist(current.who, current.start);
rig.snapBehind(current.start.yaw);
player.godMode = params.has('god');
bot.enabled = params.has('bot');
key.target.position.set(current.start.pos.x + 20, 0, current.start.pos.z);
key.position.set(current.start.pos.x + 40, 30, current.start.pos.z + 14);
current.enc?.start();

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
  current.update(dt);
  bot.update(dt);
  player.update(dt);
  ai.update(dt);
  actors.update(dt);
  const a = player.actor;
  realPhysics.updateTriggers(a.alive ? a.pos : null);
  vfx.update(dt);
}
function tick(realDt: number, withUi = true): void {
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
  if (withUi) ui.update(frameDt);
}
stage.onUpdate((dt) => tick(dt));
stage.setRender(() => composer.render());

// --- console / screenshot helpers ------------------------------------------------------------------------
const reporter = makeReporter({ game, tick, scene: current, log, bot });
const _v = new THREE.Vector3();
const api = {
  game, ai, actors, player, rig, bot, time, scene: current,
  get refs() {
    return current.refs;
  },
  /** advance without rendering */
  run(seconds: number): void {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) tick(1 / 60);
  },
  /** run until the expression is truthy (evaluated with `ai`, `refs`, `game` in scope) or maxSeconds passes; returns seconds run */
  until(expr: string, maxSeconds = 30): number {
    const fn = new Function('ai', 'refs', 'game', 'enc', `return (${expr});`) as (...a: unknown[]) => unknown;
    let t = 0;
    while (t < maxSeconds) {
      tick(1 / 60);
      t += 1 / 60;
      let ok: unknown = false;
      try {
        ok = fn(ai, current.refs, game, current.enc);
      } catch {
        ok = false;
      }
      if (ok) break;
    }
    return Math.round(t * 100) / 100;
  },
  /** free camera for readable stills; null returns to the follow camera */
  cam(pos: [number, number, number] | null, look?: [number, number, number], fov = 50): void {
    if (!pos || !look) rig.setFree(null);
    else rig.setFree({ pos: { x: pos[0], y: pos[1], z: pos[2] }, look: { x: look[0], y: look[1], z: look[2] }, fov });
  },
  /** frame an actor (or the first living actor of a role) from `dist` metres at `angleDeg` round it */
  watch(who: string | Actor, dist = 7, angleDeg = 35, height = 2.6, fov = 45): boolean {
    const a = typeof who === 'string' ? actors.all.find((x) => x.alive && (String(x.archetype) === who || x.name === who)) : who;
    if (!a) return false;
    a.aimPoint(_v);
    const ang = a.yaw + angleDeg * DEG;
    rig.setFree({
      pos: { x: a.pos.x - Math.sin(ang) * dist, y: _v.y + height, z: a.pos.z - Math.cos(ang) * dist },
      look: { x: _v.x, y: _v.y, z: _v.z }, fov,
    });
    return true;
  },
  bot(on: boolean): void {
    bot.enabled = on;
    if (!on) input.virtual.clear();
  },
  god(on: boolean): void {
    player.godMode = on;
  },
  place(x: number, z: number, yawDeg = 0): void {
    player.teleport({ x, y: 0, z }, yawDeg * DEG);
    rig.snapBehind(yawDeg * DEG);
  },
  press(a: ButtonAction): void {
    input.virtual.press(a);
  },
  hold(a: ButtonAction, on: boolean): void {
    input.virtual.hold(a, on);
  },
  hud(on: boolean): void {
    ui.setHudVisible(on);
  },
  state: () => reporter.snapshot(),
  log,
};
export type AiSandbox = typeof api;
const win = window as unknown as Record<string, unknown>;
win.__ai = api;
win.__aiReport = (seconds = 60) => (win.__aiReportLast = reporter.run(seconds));

stage.ready();
