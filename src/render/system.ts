/**
 * RenderSystemImpl — owns the WebGLRenderer and everything between the scene graph and the screen:
 * post chain, looks (grade / fog / ambient / environment), quality + dynamic resolution, floor reflections.
 */
import * as THREE from 'three';
import type {
  DeepPartial, EnvRefreshOpts, Game, Look, LookName, QualityLevel, QualityProfile, ReflectiveFloorOpts, RenderStats,
  RenderSystem, ScreenPulse,
} from '@/core/api';
import { RENDER_LAYERS } from '@/core/api';
import { isStub } from '@/core/stub';
import { DEFAULT_LOOK, L, LOOKS, LookBlender } from './looks';
import { AutoQualityGovernor, classifyGpu, DynamicResolution, isQualityLevel, lowerQuality, QUALITY_PRESETS } from './quality';
import { PostChain } from './postfx';
import { PlanarReflections } from './reflections';
import { EnvironmentBaker } from './environment';
import { ScreenFeedback } from './feedback';
import type { ToneMapOperator } from './effects/grade';

/**
 * Tone-map operator. ACES keeps the blacks deep and holds gold's chroma through the shoulder (emissive gold
 * channels stay gold with a hot yellow-white core); AgX rolled the same highlights off to chalky cream and
 * lifted the blacks of the mirror stone. See shots/render/tonemap-*.png for the comparison.
 */
const DEFAULT_OPERATOR: ToneMapOperator = 'aces';

/** Upper bound on drawing-buffer pixels per quality level (≈ 900p / 1080p / 1440p / 4K). */
const MAX_PIXELS: Readonly<Record<QualityLevel, number>> = {
  low: 1600 * 900, medium: 1920 * 1080, high: 2560 * 1440, ultra: 3840 * 2160,
};

export class RenderSystemImpl implements RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly quality: QualityProfile = { ...QUALITY_PRESETS.medium };
  readonly stats: RenderStats = {
    fps: 60, frameMs: 16.7, drawCalls: 0, triangles: 0, resolutionScale: 1, sceneDrawCalls: 0, sceneTriangles: 0, reflectionActive: false,
  };
  readonly looks: Readonly<Record<LookName, Look>> = LOOKS;

  private readonly game: Game;
  private readonly canvas: HTMLCanvasElement;
  private readonly post: PostChain | null;
  private readonly reflections: PlanarReflections;
  private readonly env: EnvironmentBaker;
  private readonly blender = new LookBlender(DEFAULT_LOOK);
  private readonly feedback = new ScreenFeedback();
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.FogExp2;
  private readonly fallbackCamera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 4000);
  private readonly dynRes = new DynamicResolution();
  private readonly governor = new AutoQualityGovernor();
  private readonly manual: boolean;
  private readonly gpuLevel: QualityLevel;

  private auto: boolean;
  private dynamicResolution = true;
  private cssWidth = 1;
  private cssHeight = 1;
  private lastFrameTime = 0;
  private emaMs = 16.7;
  private envDirty = true;
  private envOpts: EnvRefreshOpts = {};
  private initialised = false;
  private readonly size = new THREE.Vector2();
  private readonly tmpSky = new THREE.Color();
  private readonly tmpGround = new THREE.Color();
  private readonly tmpPos = new THREE.Vector3();

  constructor(game: Game) {
    this.game = game;
    const flags = game.flags;
    const nopost = !isStub(flags) && flags.nopost === true;
    this.manual = !isStub(flags) && flags.manual === true;

    const given = game.canvas as HTMLCanvasElement | undefined;
    this.canvas = given && !isStub(given) && typeof given.getContext === 'function' ? given : document.createElement('canvas');

    // AA happens in post (SMAA); without post the default framebuffer's MSAA is the only AA there is.
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: nopost, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance',
    });
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    // r187: PCFShadowMap is the soft-filtered mode (PCFSoftShadowMap was folded into it and now only warns).
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x000000, 1);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[render] WebGL context lost — waiting for restore');
    });

    const scene = game.scene;
    this.scene = scene && !isStub(scene) && (scene as THREE.Scene).isScene === true ? scene : new THREE.Scene();

    this.fog = new THREE.FogExp2(DEFAULT_LOOK.fog.color, DEFAULT_LOOK.fog.density);
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(DEFAULT_LOOK.ambient.sky, DEFAULT_LOOK.ambient.ground, DEFAULT_LOOK.ambient.intensity);
    this.hemi.name = 'render.ambient';
    this.scene.add(this.hemi);
    this.fallbackCamera.position.set(0, 1.6, 6);

    // Quality: URL flag > explicit setting > GPU heuristic. Decided here (not in init) because the material
    // library reads quality.textureSize while it bakes.
    this.gpuLevel = classifyGpu(readGpuString(renderer), { mobile: isMobile() });
    const setting = readSetting(game, 'quality', 'auto');
    const flagLevel = !isStub(flags) && isQualityLevel(flags.quality) ? flags.quality : null;
    this.auto = flagLevel === null && !isQualityLevel(setting);
    const level = flagLevel ?? (isQualityLevel(setting) ? setting : this.gpuLevel);
    Object.assign(this.quality, QUALITY_PRESETS[level]);
    this.dynamicResolution = readSetting(game, 'dynamicResolution', true) === true;
    this.feedback.reduceFlash = readSetting(game, 'reduceFlash', false) === true;
    this.feedback.reduceDistortion = readSetting(game, 'reduceDistortion', false) === true;

    if (nopost) {
      this.post = null;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
    } else {
      renderer.toneMapping = THREE.NoToneMapping;
      this.post = new PostChain(renderer, this.scene, this.fallbackCamera, DEFAULT_OPERATOR);
    }
    const hdr = this.post ? this.post.hdr : renderer.extensions.has('EXT_color_buffer_float');
    this.reflections = new PlanarReflections(hdr);
    this.env = new EnvironmentBaker(renderer);

    this.applyQuality();

    const events = game.events;
    if (events && !isStub(events)) {
      events.on('settings:changed', ({ key }) => this.onSetting(key));
    }
  }

  // -----------------------------------------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    this.resize();
    // Bake the fallback environment now so no program is ever compiled without an env map (adding one later
    // would recompile every material), then draw one frame to warm the post-processing shaders.
    this.bakeEnvironment();
    this.render(0);
    await this.compile();
  }

  async compile(): Promise<void> {
    const renderer = this.renderer;
    const camera = this.activeCamera();
    if (this.envDirty) this.bakeEnvironment();
    const prev = renderer.getRenderTarget();
    try {
      // Programs are keyed by output colour space: compile for the buffer the scene really renders into.
      if (this.post) renderer.setRenderTarget(this.post.sceneBuffer);
      const ready = renderer.compileAsync(this.scene, camera);
      renderer.setRenderTarget(prev);
      await ready;
    } catch (err) {
      renderer.setRenderTarget(prev);
      console.warn('[render] shader pre-compilation failed (shaders will compile on first use)', err);
    }
  }

  resize(): void {
    const canvas = this.canvas;
    const w = Math.max(1, Math.floor(canvas.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 1280)));
    const h = Math.max(1, Math.floor(canvas.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 720)));
    this.cssWidth = w;
    this.cssHeight = h;
    const q = this.quality;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const dyn = this.dynamicResolution && !this.manual ? this.dynRes.scale : 1;
    const scale = q.resolutionScale * dyn;
    const renderer = this.renderer;
    // Pixel budget per level: a 4K panel at dpr 1 must not quietly quadruple the cost of every pass.
    let ratio = Math.min(dpr, q.maxPixelRatio) * scale;
    const budget = MAX_PIXELS[q.level];
    if (w * h * ratio * ratio > budget) ratio = Math.sqrt(budget / (w * h));
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h);
    renderer.getDrawingBufferSize(this.size);
    this.reflections.setSize(this.size.x, this.size.y, q.level === 'ultra' ? 0.75 : 0.5);
    this.stats.resolutionScale = scale;
    this.syncAspect(this.activeCamera());
  }

  // -----------------------------------------------------------------------------------------------------
  // Quality
  // -----------------------------------------------------------------------------------------------------

  setQuality(level: QualityLevel): void {
    if (!isQualityLevel(level)) {
      console.warn(`[render] unknown quality level "${String(level)}" — ignored`);
      return;
    }
    this.auto = false;
    if (level === this.quality.level) return;
    Object.assign(this.quality, QUALITY_PRESETS[level]);
    this.applyQuality();
  }

  private applyQuality(): void {
    const q = this.quality;
    const renderer = this.renderer;
    renderer.shadowMap.enabled = q.shadows;
    // Lights that already exist adopt the new shadow resolution (zones read quality.shadowMapSize when built).
    this.scene.traverse((o) => {
      const light = o as THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight;
      const shadow = light.isLight === true ? light.shadow : undefined;
      if (!shadow || !light.castShadow) return;
      if (shadow.mapSize.x !== q.shadowMapSize) {
        shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        shadow.map?.dispose();
        shadow.map = null;
      }
    });
    if (this.post) this.post.configure(q);
    // release in both cases: the mirror target is rebuilt lazily with the sample count of the new level
    this.reflections.release();
    this.reflections.samples = q.reflections ? 4 : 0;
    this.dynRes.reset();
    this.governor.reset();
    this.resize();
    this.applyLook();
    if (this.post) this.post.applyFeedback(this.feedback.out, this.blender.current[L.chromaticAberration]);
  }

  private onSetting(key: string): void {
    const game = this.game;
    if (key === 'quality') {
      const v = readSetting(game, 'quality', 'auto');
      if (isQualityLevel(v)) {
        this.setQuality(v);
      } else {
        this.auto = true;
        if (this.quality.level !== this.gpuLevel) {
          Object.assign(this.quality, QUALITY_PRESETS[this.gpuLevel]);
          this.applyQuality();
        }
      }
    } else if (key === 'dynamicResolution') {
      this.dynamicResolution = readSetting(game, 'dynamicResolution', true) === true;
      this.dynRes.reset();
      this.resize();
    } else if (key === 'reduceFlash') {
      this.feedback.reduceFlash = readSetting(game, 'reduceFlash', false) === true;
    } else if (key === 'reduceDistortion') {
      this.feedback.reduceDistortion = readSetting(game, 'reduceDistortion', false) === true;
    }
  }

  // -----------------------------------------------------------------------------------------------------
  // Looks, feedback
  // -----------------------------------------------------------------------------------------------------

  setLook(look: DeepPartial<Look>, blendSeconds = 0): void {
    this.blender.setTarget(look, blendSeconds);
  }

  getLook(): Look {
    return this.blender.target;
  }

  setDof(opts: { focusDistance: number; strength: number } | null): void {
    if (this.post && this.quality.dof) this.post.setDof(opts);
  }

  pulse(kind: ScreenPulse, strength = 1): void {
    this.feedback.pulse(kind, strength);
  }

  setCorruption(amount: number): void {
    this.feedback.setCorruption(amount);
  }

  /** Debug / sandbox: switch the tone-map operator at runtime ('aces' | 'agx' | 'agxPunchy' | 'neutral'). */
  setToneMapOperator(op: ToneMapOperator): void {
    if (this.post) this.post.toneMapOperator = op;
    else this.renderer.toneMapping = op === 'aces' ? THREE.ACESFilmicToneMapping : op === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping;
  }

  private applyLook(): void {
    const a = this.blender.current;
    this.fog.color.setRGB(a[L.fogColor], a[L.fogColor + 1], a[L.fogColor + 2]);
    this.fog.density = Math.max(0, a[L.fogDensity]);
    this.hemi.color.setRGB(a[L.ambientSky], a[L.ambientSky + 1], a[L.ambientSky + 2]);
    this.hemi.groundColor.setRGB(a[L.ambientGround], a[L.ambientGround + 1], a[L.ambientGround + 2]);
    this.hemi.intensity = Math.max(0, a[L.ambientIntensity]);
    this.scene.environmentIntensity = Math.max(0, a[L.envIntensity]);
    if (this.post) this.post.applyLook(a);
    else this.renderer.toneMappingExposure = Math.max(0, a[L.exposure]);
  }

  // -----------------------------------------------------------------------------------------------------
  // Environment + reflections
  // -----------------------------------------------------------------------------------------------------

  refreshEnvironment(opts?: EnvRefreshOpts): void {
    this.envOpts = opts && typeof opts === 'object' ? { scene: opts.scene === true, position: opts.position } : {};
    this.envDirty = true;
  }

  private bakeEnvironment(): void {
    this.envDirty = false;
    const a = this.blender.current;
    const camera = this.activeCamera();
    const opts = this.envOpts;
    const p = opts.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) this.tmpPos.set(p.x, p.y, p.z);
    else camera.getWorldPosition(this.tmpPos);
    const pc = camera as THREE.PerspectiveCamera;
    this.reflections.suspend();
    const texture = this.env.bake({
      scene: this.scene,
      sky: this.skyRoot(),
      skyColor: this.tmpSky.setRGB(a[L.ambientSky], a[L.ambientSky + 1], a[L.ambientSky + 2]),
      groundColor: this.tmpGround.setRGB(a[L.ambientGround], a[L.ambientGround + 1], a[L.ambientGround + 2]),
      ambientIntensity: a[L.ambientIntensity],
      captureScene: opts.scene === true,
      position: this.tmpPos,
      near: Math.max(0.05, pc.near ?? 0.1),
      far: Math.max(200, pc.far ?? 4000),
    });
    if (texture) this.scene.environment = texture;
  }

  private skyRoot(): THREE.Object3D | null {
    const sky = this.game.sky;
    if (!sky || isStub(sky)) return null;
    const root = sky.root;
    return root && !isStub(root) && (root as THREE.Object3D).isObject3D === true ? root : null;
  }

  registerReflectiveFloor(mesh: THREE.Mesh, opts?: ReflectiveFloorOpts): void {
    this.reflections.register(mesh, opts);
  }

  unregisterReflectiveFloor(mesh: THREE.Mesh): void {
    this.reflections.unregister(mesh);
  }

  clearReflectiveFloors(): void {
    this.reflections.clear();
  }

  // -----------------------------------------------------------------------------------------------------
  // Frame
  // -----------------------------------------------------------------------------------------------------

  render(dt: number): void {
    const renderer = this.renderer;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    const frameMs = this.measureFrame(step);

    const camera = this.activeCamera();
    camera.layers.enable(RENDER_LAYERS.noReflect);
    this.syncAspect(camera);

    if (this.blender.update(step)) this.applyLook();
    this.feedback.update(step);
    const post = this.post;
    if (post) {
      post.setCamera(camera);
      post.applyFeedback(this.feedback.out, this.blender.current[L.chromaticAberration]);
    }
    if (this.envDirty) this.bakeEnvironment();

    renderer.info.reset();
    const reflecting = this.quality.reflections
      ? this.reflections.render(renderer, this.scene, camera, step)
      : (this.reflections.suspend(), false);

    // Shadow maps are view independent: refresh them once, in the first scene render of the frame.
    const shadow = renderer.shadowMap;
    shadow.autoUpdate = false;
    shadow.needsUpdate = true;
    if (post) {
      post.render(step);
    } else {
      renderer.setRenderTarget(null);
      renderer.clear(true, true, true);
      renderer.render(this.scene, camera);
    }
    shadow.autoUpdate = true;

    const info = renderer.info.render;
    const s = this.stats;
    s.drawCalls = info.calls;
    s.triangles = info.triangles;
    s.sceneDrawCalls = post ? post.sceneCalls : info.calls;
    s.sceneTriangles = post ? post.sceneTriangles : info.triangles;
    s.reflectionActive = reflecting;

    this.adapt(frameMs);
  }

  /** Real time since the previous frame, smoothed into stats. Falls back to `dt` when no clock is usable. */
  private measureFrame(dt: number): number {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const real = this.lastFrameTime > 0 ? now - this.lastFrameTime : 0;
    this.lastFrameTime = now;
    // Headless runs step the game faster or slower than real time: trust the dt they pass.
    const ms = this.manual || !(real > 0) ? dt * 1000 : real;
    if (ms > 0 && ms < 1000) {
      this.emaMs += (ms - this.emaMs) * 0.08;
      this.stats.frameMs = this.emaMs;
      this.stats.fps = 1000 / Math.max(0.01, this.emaMs);
    }
    return this.manual ? 0 : real;
  }

  /** Dynamic resolution and the auto-quality governor (never in manual / headless stepping). */
  private adapt(frameMs: number): void {
    if (this.manual || !(frameMs > 0)) return;
    const game = this.game;
    if (game.phase !== 'playing' || game.paused === true) return;
    if (this.dynamicResolution && this.dynRes.update(frameMs)) this.resize();
    if (this.auto) {
      const atFloor = !this.dynamicResolution || this.dynRes.atFloor;
      if (this.governor.update(frameMs, atFloor) && this.quality.level !== 'low') {
        const next = lowerQuality(this.quality.level);
        console.info(`[render] auto quality: ${this.quality.level} → ${next}`);
        Object.assign(this.quality, QUALITY_PRESETS[next]);
        this.applyQuality();
      }
    }
  }

  private activeCamera(): THREE.Camera {
    const rig = this.game.camera;
    if (rig && !isStub(rig)) {
      const cam = rig.camera;
      if (cam && !isStub(cam) && (cam as THREE.Camera).isCamera === true) return cam;
    }
    return this.fallbackCamera;
  }

  private syncAspect(camera: THREE.Camera): void {
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera !== true) return;
    const aspect = this.cssWidth / this.cssHeight;
    if (Math.abs(pc.aspect - aspect) > 1e-4) {
      pc.aspect = aspect;
      pc.updateProjectionMatrix();
    }
  }
}

function readSetting<T>(game: Game, key: string, fallback: T): unknown {
  const settings = game.settings;
  if (!settings || isStub(settings)) return fallback;
  try {
    const v = (settings.values as unknown as Record<string, unknown>)[key];
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function readGpuString(renderer: THREE.WebGLRenderer): string | null {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipad|mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent));
}
