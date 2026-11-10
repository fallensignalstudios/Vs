/**
 * Render contract — OWNER: render-core (src/render/*, except sky/ and camera/).
 * Renderer, post-processing chain, quality presets, per-zone "look" (grading/exposure/fog), screen feedback,
 * polished-floor reflections and the image-based-lighting environment.
 *
 * QUICK GUIDE FOR ZONE AUTHORS
 *   import { LOOKS } from '@/render/looks';                 // tuned presets, one per zone (see LookName)
 *   b.setEnv({ sky: 'coreChamber', look: LOOKS.core });     // kit → render.setLook + refreshEnvironment
 *   game.render.setLook({ fog: { density: 0.02 } }, 2);     // partial overrides blend over 2 s
 *   game.render.setLook(LOOKS.witness, 1.5);                // whole-look change for a story beat
 *   game.render.registerReflectiveFloor(mesh);              // mirror-polished floors (kit does this for you)
 *   game.render.refreshEnvironment();                       // after the zone is built: local reflection probe
 *   await game.render.compile();                            // during loading, after the zone is in the scene
 *
 * IMAGE PIPELINE (HDR half-float, in order): scene → ambient occlusion → [depth of field] → chromatic
 * aberration → bloom → grade (exposure, tint, split-tone, saturation, contrast, lift, vignette) → screen
 * feedback → filmic tone map → SMAA → film grain + dither. Emissive convention: scene-linear luminance above
 * `Look.bloom.threshold` (≈ 1) blooms — emissive intensity 1.5 = soft glow, 3 = bright strip, 6+ = hot core.
 * `?nopost=1` renders the scene directly (tone-mapped, no effects) for fast headless shots.
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';

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
  /**
   * HDR bloom. `threshold` is scene-linear luminance (before exposure) where glow starts (≈ 1);
   * `intensity` 0..~1.5; `radius` 0..1 spread of the mip chain (0.6 tight, 0.85 wide).
   */
  bloom: { intensity: number; threshold: number; radius: number };
  /** THREE.FogExp2 on the scene. `color` is an sRGB hex; density ≈ 0.004 (vast) … 0.03 (thick haze). */
  fog: { color: number; density: number };
  /**
   * colour grade (applied in scene-linear before the tone map): multiply `tint` (sRGB hex, 0xffffff neutral),
   * `saturation` (1 neutral), `contrast` about mid-grey (1 neutral), `lift` (0 neutral; ±0.05 is a visible
   * raise / crush of the blacks). `shadowsTint` / `highlightsTint` are hue-only split-toning tints
   * (0xffffff neutral; luminance-normalised, so they never darken the image).
   */
  grade: { tint: number; saturation: number; contrast: number; lift: number; shadowsTint: number; highlightsTint: number };
  /** 0..1 edge darkening */
  vignette: number;
  /** 0..1 film grain amount (a 1-LSB dither is always applied, so 0 still has no banding) */
  grain: number;
  /** 0..1 radial chromatic aberration (0.25 = barely visible, 1 = strong lens fringing at the corners) */
  chromaticAberration: number;
  /** ambient occlusion: `intensity` 0..~4 (contrast of the occlusion), `radius` in metres */
  ao: { intensity: number; radius: number };
  /** hemisphere fill light owned by the render system (sRGB hex colours) */
  ambient: { sky: number; ground: number; intensity: number };
  /** scene.environmentIntensity */
  envIntensity: number;
}

/** Names of the tuned presets exported as `LOOKS` from '@/render/looks' (also on `RenderSystem.looks`). */
export type LookName =
  | 'neutral'       // engine default (title, fallbacks)
  | 'crash'         // Z00 broken landing: smoke-warm, amber emergency light, cool shadows
  | 'pressureHall'  // Z01: clean ivory hall, cold security light against warm ancient strips
  | 'survivorBend'  // Z02: subdued, low warm practicals, soft contrast
  | 'frozen'        // Z03: cold cyan frozen atmosphere, thick pale haze
  | 'relay'         // Z04: bright silver daylight through the ribs, marble and distance haze
  | 'atrium'        // Z05: vast, high contrast, cool ambient under battle light
  | 'breach'        // Z06: dark, violet-leaning shadows, gritty
  | 'gallery'       // Z07: dim technical gallery, amber against blue
  | 'crucible'      // Z08: luminous white-gold arena, wet dark floor, gold highlights
  | 'woundGallery'  // Z09: near-black, deep contrast, cold; the sky does the talking
  | 'core'          // Z10: mirror-black stone and gold, luminous rings
  | 'observation'   // Z11: quiet, warm interior against a cold exterior
  | 'hangar'        // Z12: wide, hazy, neutral-cool
  | 'witness';      // the historical sequence: desaturated gold-white memory

export type ScreenPulse = 'hit' | 'heal' | 'corruption' | 'frost' | 'cinder' | 'flash' | 'gold';

export interface RenderStats {
  fps: number;
  frameMs: number;
  /** all draw calls of the last frame (scene + shadow maps + reflection pass + post-processing) */
  drawCalls: number;
  /** all triangles of the last frame (same scope as drawCalls) */
  triangles: number;
  /** effective multiplier on the capped device pixel ratio: preset resolutionScale × dynamic resolution */
  resolutionScale: number;
  /** draw calls of the main colour pass only — the number the ≤ 350 budget refers to */
  sceneDrawCalls: number;
  /** triangles of the main colour pass only — the number the ≤ 1.2 M budget refers to */
  sceneTriangles: number;
  /** true while the planar reflection pass is rendering this frame (roughly doubles scene cost) */
  reflectionActive: boolean;
}

/**
 * Object3D layers used by the renderer. Objects live on layer 0 by default and are seen by every pass.
 * Move small or expensive dressing that should NOT appear in polished-floor reflections (particles, decals,
 * tiny props) to `noReflect` with `object.layers.set(RENDER_LAYERS.noReflect)`; the main camera sees both layers.
 */
export const RENDER_LAYERS = { default: 0, noReflect: 1 } as const;

export interface ReflectiveFloorOpts {
  /** world height of the mirror plane; default = top of the mesh's world bounding box */
  y?: number;
  /**
   * 0..1 blends from environment-only reflection (0) to the full planar reflection (1, default).
   * Values above 1 additionally boost the reflected radiance (wet / lacquered look; 1.5 is already strong).
   */
  strength?: number;
  /**
   * Overrides the blur of the planar reflection (0 = mirror, 0.3 = satin). Default: the material's own
   * per-pixel roughness, including its roughness map.
   */
  roughness?: number;
}

export interface EnvRefreshOpts {
  /**
   * true (default): the environment is a local reflection probe — the current scene (zone geometry, emissive
   * strips, lights) plus the sky and a dim fill tinted by `Look.ambient`, captured from `position`. Metals and
   * polished floors reflect the hall they are in. Whatever is in the scene on layer 0 is baked in.
   * false: sky + fill only (cheapest; use for open vistas where the zone geometry should not tint the light).
   */
  scene?: boolean;
  /** probe position; default = the player's position (eye height) or, failing that, the active camera */
  position?: Vec3Like;
}

export interface RenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** Live profile. The object identity is stable; its fields change on setQuality / settings changes. */
  readonly quality: QualityProfile;
  readonly stats: RenderStats;
  /** The tuned look presets (same object as `LOOKS` from '@/render/looks'). */
  readonly looks: Readonly<Record<LookName, Look>>;

  /** async warm-up (shader compile etc). Called once by Game.init(). */
  init(): Promise<void>;
  /** Pin a quality level (overrides the 'auto' heuristic until settings.quality changes again). */
  setQuality(level: QualityLevel): void;

  /** Blend the current look toward `look` over `blendSeconds` (0 = snap). */
  setLook(look: DeepPartial<Look>, blendSeconds?: number): void;
  /** The look being displayed or blended toward (a copy — safe to keep and pass back to setLook). */
  getLook(): Look;

  /** Cinematic depth of field; null disables. focusDistance in metres from the camera, strength 0..1. */
  setDof(opts: { focusDistance: number; strength: number } | null): void;

  /** Brief full-screen feedback (damage vignette, heal bloom…). Honours settings.reduceFlash. */
  pulse(kind: ScreenPulse, strength?: number): void;

  /** 0..1 bounded local-threat feedback (violet edge distortion). Honours settings.reduceDistortion. */
  setCorruption(amount: number): void;

  /**
   * Rebuild scene.environment (PMREM) from the current sky + zone lights. Call after zone/sky changes.
   * The bake is deferred to the next rendered frame, so several calls in one frame cost one bake, and it is
   * repeated automatically (same options) on `zone:ready`, when the whole zone is in the scene.
   */
  refreshEnvironment(opts?: EnvRefreshOpts): void;

  /**
   * Register a mesh that should receive polished-floor reflections (black stone, wet white-gold).
   * High/ultra quality: a mirrored camera renders the plane nearest below the camera into a half-res target,
   * blurred by roughness and fresnel-weighted into the mesh's MeshStandard/Physical material (patched in
   * place, existing onBeforeCompile hooks are preserved). Low/medium: environment-map reflection only.
   * Only upward-facing fragments at the plane height reflect; the rest of the mesh is untouched.
   * Meshes sharing one material share its `strength` / `roughness` options (last registration wins).
   */
  registerReflectiveFloor(mesh: THREE.Mesh, opts?: ReflectiveFloorOpts): void;
  /** Remove one mesh registered with registerReflectiveFloor (no-op if unknown). */
  unregisterReflectiveFloor(mesh: THREE.Mesh): void;
  clearReflectiveFloors(): void;

  /** Pre-compile shaders for everything currently in the scene (call after a zone is built, during loading). */
  compile(): Promise<void>;

  resize(): void;
  /** Render one frame. `dt` is real (unscaled) seconds. */
  render(dt: number): void;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
