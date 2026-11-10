/**
 * Render contract — OWNER: render-core (src/render/{renderer,postfx,quality,look}.ts).
 * Renderer, post-processing chain, quality presets, per-zone "look" (grading/exposure/fog), screen feedback.
 */
import type * as THREE from 'three';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  level: QualityLevel;
  /** multiplier on devicePixelRatio-capped resolution (dynamic resolution may lower it further) */
  resolutionScale: number;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  ao: boolean;
  bloom: boolean;
  dof: boolean;
  /** planar / screen-space reflections on polished floors */
  reflections: boolean;
  volumetrics: boolean;
  /** 0..1 multiplier applied by VFX to particle counts */
  particleScale: number;
  /** max simultaneously shadow-casting lights a zone should enable */
  maxShadowLights: number;
  anisotropy: number;
  /** procedural texture resolution */
  textureSize: 256 | 512 | 1024 | 2048;
}

/** Per-zone grading. Every field optional in setLook(); unspecified fields keep their current value. */
export interface Look {
  /** scene exposure multiplier (1 = neutral) */
  exposure: number;
  bloom: { intensity: number; threshold: number; radius: number };
  fog: { color: number; density: number };
  /** colour grade: multiply tint, saturation (1 neutral), contrast (1 neutral), lift (0 neutral) */
  grade: { tint: number; saturation: number; contrast: number; lift: number; shadowsTint: number; highlightsTint: number };
  vignette: number;
  grain: number;
  chromaticAberration: number;
  ao: { intensity: number; radius: number };
  /** hemisphere fill */
  ambient: { sky: number; ground: number; intensity: number };
  /** scene.environmentIntensity */
  envIntensity: number;
}

export type ScreenPulse = 'hit' | 'heal' | 'corruption' | 'frost' | 'cinder' | 'flash' | 'gold';

export interface RenderStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  resolutionScale: number;
}

export interface RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly quality: QualityProfile;
  readonly stats: RenderStats;

  /** async warm-up (shader compile etc). Called once by Game.init(). */
  init(): Promise<void>;
  setQuality(level: QualityLevel): void;

  /** Blend the current look toward `look` over `blendSeconds` (0 = snap). */
  setLook(look: DeepPartial<Look>, blendSeconds?: number): void;
  getLook(): Look;

  /** Cinematic depth of field; null disables. focusDistance in metres from the camera. */
  setDof(opts: { focusDistance: number; strength: number } | null): void;

  /** Brief full-screen feedback (damage vignette, heal bloom…). Honours settings.reduceFlash. */
  pulse(kind: ScreenPulse, strength?: number): void;

  /** 0..1 bounded local-threat feedback (violet edge distortion). Honours settings.reduceDistortion. */
  setCorruption(amount: number): void;

  /** Rebuild scene.environment (PMREM) from the current sky + zone lights. Call after zone/sky changes. */
  refreshEnvironment(): void;

  /**
   * Register a mesh that should receive polished-floor reflections (black stone, wet white-gold).
   * Implementations may use a planar reflector on high quality and fall back to env-map only.
   */
  registerReflectiveFloor(mesh: THREE.Mesh, opts?: { y?: number; strength?: number; roughness?: number }): void;
  clearReflectiveFloors(): void;

  /** Pre-compile shaders for everything currently in the scene (call after a zone is built, during loading). */
  compile(): Promise<void>;

  resize(): void;
  /** Render one frame. `dt` is real (unscaled) seconds. */
  render(dt: number): void;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
