/**
 * Sandbox harness (FOUNDATION) — a minimal three.js stage for developing one subsystem in isolation and
 * screenshotting it with tools/shot.cjs. Not shipped in the game.
 *
 *   const h = createHarness({ bloom: true, env: 'dark' });
 *   h.scene.add(thing);
 *   h.onUpdate((dt, t) => thing.update(dt));
 *   h.ready();
 *
 * Globals for tools/shot.cjs --eval:  __h (the harness), __step(seconds) advance + render deterministically,
 * __h.setCam([x,y,z],[lx,ly,lz], fov?).  URL: ?manual=1 disables the RAF loop (use __step), ?nobloom=1.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface HarnessOpts {
  bloom?: boolean;
  /** 'studio' neutral bright IBL, 'dark' dim IBL for emissive work, 'none' */
  env?: 'studio' | 'dark' | 'none';
  background?: number;
  grid?: boolean;
  exposure?: number;
  /** add a default key/fill light rig with shadows */
  lights?: boolean;
  /** add a ground plane receiving shadows */
  ground?: boolean;
}

export interface Harness {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  params: URLSearchParams;
  time: number;
  onUpdate(fn: (dt: number, time: number) => void): void;
  setCam(pos: [number, number, number], look: [number, number, number], fov?: number): void;
  /** advance update callbacks by `seconds` in 1/60 steps and render one frame */
  step(seconds: number): void;
  render(): void;
  ready(): void;
}

export function createHarness(opts: HarnessOpts = {}): Harness {
  const params = new URLSearchParams(location.search);
  const manual = params.has('manual');
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#07090d';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? 0x0a0d13);

  const env = opts.env ?? 'studio';
  if (env !== 'none') {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = env === 'dark' ? 0.25 : 0.9;
  }

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 4000);
  camera.position.set(4, 2.2, 6);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1, 0);
  controls.update();

  if (opts.lights !== false) {
    const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x1a1410, env === 'dark' ? 0.15 : 0.5);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff1dc, env === 'dark' ? 1.2 : 2.4);
    key.position.set(6, 10, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12; key.shadow.camera.right = 12; key.shadow.camera.top = 12; key.shadow.camera.bottom = -12;
    key.shadow.bias = -0.0005;
    scene.add(key);
  }
  if (opts.ground) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6, metalness: 0.1 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
  }
  if (opts.grid) scene.add(new THREE.GridHelper(40, 40, 0x334455, 0x1a2230));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if ((opts.bloom ?? true) && !params.has('nobloom')) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.92));
  composer.addPass(new OutputPass());

  const updaters: Array<(dt: number, t: number) => void> = [];
  const h: Harness = {
    renderer, scene, camera, controls, params, time: 0,
    onUpdate(fn) { updaters.push(fn); },
    setCam(pos, look, fov) {
      camera.position.set(pos[0], pos[1], pos[2]);
      controls.target.set(look[0], look[1], look[2]);
      if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      controls.update();
    },
    step(seconds) {
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) { h.time += 1 / 60; for (const u of updaters) u(1 / 60, h.time); }
      h.render();
    },
    render() { controls.update(); composer.render(); },
    ready() {
      h.render();
      requestAnimationFrame(() => { h.render(); (window as any).__ready = true; });
    },
  };

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  addEventListener('error', (e) => ((window as any).__aurelionErrors ??= []).push(String(e.error?.stack ?? e.message)));

  if (!manual) {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      h.time += dt;
      for (const u of updaters) u(dt, h.time);
      h.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  (window as any).__h = h;
  (window as any).__step = (s: number) => h.step(s);
  return h;
}

// -------------------------------------------------------------------------------------------------
// miniGame — a fake Game for sandboxes: real events/settings/time/scripts, everything else a null-object
// stub unless you pass an override. Example:
//   const game = miniGame(h, { physics: createPhysicsWorld(null) });
//   const vfx = createVfxSystem(game);  h.onUpdate((dt) => vfx.update(dt));
// Pass { ownRenderer: true } if your subsystem creates its own WebGLRenderer on `game.canvas`
// (then build the harness with createCanvasOnly() instead of createHarness()).
// -------------------------------------------------------------------------------------------------
import type { Game, GameEvents, QualityProfile } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { ScriptRunnerImpl } from '@/core/script';
import { nullObject } from '@/core/stub';
import { mulberry32 } from '@/core/mathx';

export const SANDBOX_QUALITY: QualityProfile = {
  level: 'high', resolutionScale: 1, maxPixelRatio: 1, shadows: true, shadowMapSize: 2048, ao: true, bloom: true,
  dof: true, reflections: true, volumetrics: true, particleScale: 1, maxShadowLights: 2, anisotropy: 4, textureSize: 512,
};

/** Wrap a partial object so missing members resolve to null-object stubs instead of undefined. */
export function withStubs<T extends object>(name: string, real: Partial<T>): T {
  const cache: Record<string | symbol, unknown> = { ...(real as Record<string, unknown>) };
  return new Proxy(cache, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol' || p === 'then') return undefined;
      return (t[p] = nullObject(`${name}.${String(p)}`));
    },
    set(t, p, v) { t[p] = v; return true; },
    has(t, p) { return p in t; },
  }) as T;
}

export function miniGame(h: Pick<Harness, 'scene' | 'camera' | 'renderer' | 'onUpdate'> | null, overrides: Partial<Game> = {}): Game {
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  const scripts = new ScriptRunnerImpl();
  const rng = mulberry32(7283);
  const time = { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} };
  h?.onUpdate((dt, t) => { time.now = t; time.dt = dt; time.unscaledDt = dt; time.frame++; scripts.update(dt); });
  const q = new URLSearchParams(location.search);
  const flags = { zone: null, beat: null, checkpoint: null, debug: true, autoplay: false, mute: q.has('mute'), nopost: q.has('nopost'), quality: null, manual: q.has('manual'), seed: 7283 };
  const base: Partial<Game> = {
    events, settings, scripts, flags,
    time: time as Game['time'],
    random: () => rng(),
    phase: 'playing', paused: false,
    setPhase() {}, setPaused() {}, tick() {},
    uiRoot: document.body,
  };
  if (h) {
    Object.assign(base, {
      scene: h.scene,
      canvas: h.renderer.domElement,
      camera: withStubs<Game['camera']>('camera', { camera: h.camera, mode: 'follow', yaw: 0, pitch: 0 } as Partial<Game['camera']>),
      render: withStubs<Game['render']>('render', { renderer: h.renderer, scene: h.scene, quality: SANDBOX_QUALITY } as Partial<Game['render']>),
    });
  }
  return withStubs<Game>('game', { ...base, ...overrides });
}

/** For subsystems that own the renderer (render-core): just a full-window canvas + the ready/step protocol. */
export function createCanvasOnly(): { canvas: HTMLCanvasElement; params: URLSearchParams; onUpdate(fn: (dt: number, t: number) => void): void; step(seconds: number): void; ready(): void; setRender(fn: () => void): void } {
  const params = new URLSearchParams(location.search);
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#07090d';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.appendChild(canvas);
  const updaters: Array<(dt: number, t: number) => void> = [];
  let renderFn: () => void = () => {};
  let time = 0;
  const api = {
    canvas, params,
    onUpdate(fn: (dt: number, t: number) => void) { updaters.push(fn); },
    setRender(fn: () => void) { renderFn = fn; },
    step(seconds: number) {
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) { time += 1 / 60; for (const u of updaters) u(1 / 60, time); }
      renderFn();
    },
    ready() { renderFn(); requestAnimationFrame(() => { renderFn(); (window as any).__ready = true; }); },
  };
  addEventListener('error', (e) => ((window as any).__aurelionErrors ??= []).push(String(e.error?.stack ?? e.message)));
  if (!params.has('manual')) {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
      for (const u of updaters) u(dt, time);
      renderFn();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  (window as any).__step = (s: number) => api.step(s);
  return api;
}
