/**
 * PostChain — the HDR post-processing pipeline (`postprocessing` EffectComposer + `n8ao`).
 *
 *   ScenePass (4× MSAA at high / ultra) → N8AO → [DoF pass, enabled only while a cinematic asks for it]
 *   → main pass  { chroma → bloom → grade(+vignette) → screen feedback → tone map (+sRGB encode) }
 *   → final pass { SMAA → grain + dither }                       (medium and up)
 *
 * At 'low' the main pass also carries the grain and goes straight to the screen (two fullscreen draws total).
 * Why grain sits after the tone map and SMAA rather than before them: dither only removes banding when it is
 * the last thing before 8-bit quantisation, and noise in front of SMAA is read as edges and smeared.
 * The pass list is rebuilt when the quality profile changes, so disabled features cost nothing.
 */
import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, DepthOfFieldEffect, EdgeDetectionMode, EffectComposer, EffectPass, RenderPass,
  SMAAEffect, SMAAPreset, type Effect, type EffectMaterial,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { QualityProfile } from '@/core/api';
import { L } from './looks';
import { ChromaEffect, FinishEffect, GradeEffect, ToneMapEffect, type ToneMapOperator } from './effects/grade';
import { ScreenFeedbackEffect } from './effects/feedback';
import type { FeedbackOutput } from './feedback';

/** RenderPass that records how much the main colour pass drew (shadow-map draws of that pass included). */
class ScenePass extends RenderPass {
  calls = 0;
  triangles = 0;

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget, deltaTime?: number, stencilTest?: boolean): void {
    const info = renderer.info.render;
    const c0 = info.calls;
    const t0 = info.triangles;
    super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    this.calls = info.calls - c0;
    this.triangles = info.triangles - t0;
  }
}

/** Bloom input is clamped to this scene-linear luminance: hot cores still glow, single-pixel glints cannot shimmer. */
const BLOOM_MAX = '24.0';

export class PostChain {
  readonly composer: EffectComposer;
  readonly hdr: boolean;

  private scenePass: ScenePass | null = null;
  private ao: N8AOPostPass | null = null;
  private dof: DepthOfFieldEffect | null = null;
  private dofPass: EffectPass | null = null;
  private bloom: BloomEffect | null = null;
  private chroma: ChromaEffect | null = null;
  private grade: GradeEffect | null = null;
  private feedback: ScreenFeedbackEffect | null = null;
  private toneMap: ToneMapEffect | null = null;
  private finish: FinishEffect | null = null;
  private smaa: SMAAEffect | null = null;

  private camera: THREE.Camera;
  private camNear = -1;
  private camFar = -1;
  private operator: ToneMapOperator;

  private dofTarget: { focusDistance: number; strength: number } | null = null;
  private dofStrength = 0;
  private dofFocus = 6;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, camera: THREE.Camera, operator: ToneMapOperator) {
    this.camera = camera;
    this.operator = operator;
    // WebGL2 renders to half-float targets when EXT_color_buffer_float (or the half-float variant) exists.
    this.hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.composer = new EffectComposer(renderer, {
      depthBuffer: true,
      stencilBuffer: false,
      multisampling: 0,
      frameBufferType: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
  }

  /** The buffer the scene is rendered into (shader pre-compilation must target it). */
  get sceneBuffer(): THREE.WebGLRenderTarget {
    return this.composer.inputBuffer;
  }

  get sceneCalls(): number {
    return this.scenePass ? this.scenePass.calls : 0;
  }

  get sceneTriangles(): number {
    return this.scenePass ? this.scenePass.triangles : 0;
  }

  get toneMapOperator(): ToneMapOperator {
    return this.operator;
  }

  set toneMapOperator(op: ToneMapOperator) {
    this.operator = op;
    if (this.toneMap) this.toneMap.operator = op;
  }

  /** (Re)build the pass list for a quality profile. Look / feedback state must be re-applied afterwards. */
  configure(q: QualityProfile): void {
    const composer = this.composer;
    const old = composer.passes.slice();
    composer.removeAllPasses();
    for (const pass of old) pass.dispose();

    // MSAA on the HDR scene buffer at high / ultra: SMAA alone cannot rebuild sub-pixel geometry, and the art
    // direction is full of it (narrow gold channels, light seams) — without it they break into crawling dots.
    composer.multisampling = q.level === 'high' || q.level === 'ultra' ? 4 : 0;

    const { scene, camera } = this;
    const scenePass = new ScenePass(scene, camera);
    this.scenePass = scenePass;
    composer.addPass(scenePass);

    this.ao = null;
    if (q.ao) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const ao = new N8AOPostPass(scene, camera, size.x, size.y);
      const half = q.level === 'medium';
      ao.configuration.halfRes = half;
      ao.setQualityMode(q.level === 'ultra' ? 'High' : q.level === 'high' ? 'Medium' : 'Low');
      ao.configuration.distanceFalloff = 1;
      ao.configuration.color = new THREE.Color(0, 0, 0);
      // Explicit (skips N8AO's per-frame scene scan). On: transparent / additive surfaces are not darkened by
      // the occlusion behind them — worth two extra transparent-only draws at high and ultra.
      ao.configuration.transparencyAware = q.level === 'high' || q.level === 'ultra';
      this.ao = ao;
      composer.addPass(ao);
    }

    this.dof = null;
    this.dofPass = null;
    if (q.dof) {
      const dof = new DepthOfFieldEffect(camera, { worldFocusDistance: this.dofFocus, worldFocusRange: 8, bokehScale: 2, resolutionScale: 0.5 });
      const dofPass = new EffectPass(camera, dof);
      dofPass.enabled = false;
      this.dof = dof;
      this.dofPass = dofPass;
      composer.addPass(dofPass);
    }

    const chroma = (this.chroma = new ChromaEffect());
    const grade = (this.grade = new GradeEffect());
    const feedback = (this.feedback = new ScreenFeedbackEffect());
    const toneMap = (this.toneMap = new ToneMapEffect(this.operator));
    const finish = (this.finish = new FinishEffect());
    const effects: Effect[] = [chroma];

    this.bloom = null;
    if (q.bloom) {
      const low = q.level === 'low';
      const bloom = new BloomEffect({
        blendFunction: BlendFunction.ADD,
        mipmapBlur: true,
        luminanceThreshold: 1,
        luminanceSmoothing: 0.3,
        intensity: 0.7,
        radius: 0.7,
        levels: low ? 6 : 8,
      });
      if (low) bloom.luminancePass.resolution.scale = 0.5;
      guardBloomInput(bloom);
      this.bloom = bloom;
      effects.push(bloom);
    }
    effects.push(grade, feedback, toneMap);

    const useSmaa = q.level !== 'low';
    this.smaa = null;
    if (!useSmaa) effects.push(finish);
    const mainPass = new EffectPass(camera, ...effects);
    composer.addPass(mainPass);
    let last = mainPass;
    if (useSmaa) {
      const smaa = new SMAAEffect({
        preset: q.level === 'ultra' ? SMAAPreset.ULTRA : q.level === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM,
        edgeDetectionMode: EdgeDetectionMode.COLOR,
      });
      // dark scenes: catch low-contrast edges (the input is display-encoded, so 0.05 ≈ 13 code values)
      smaa.edgeDetectionMaterial.edgeDetectionThreshold = q.level === 'medium' ? 0.08 : 0.05;
      this.smaa = smaa;
      last = new EffectPass(camera, smaa, finish);
      composer.addPass(last);
    }
    // ToneMapEffect already wrote display-encoded values: the screen pass must not encode again.
    (last.fullscreenMaterial as EffectMaterial).encodeOutput = false;

    this.camNear = this.camFar = -1;
    this.setCamera(camera);
    this.applyDof(0);
  }

  /** Point every pass at `camera` (cheap when nothing changed). */
  setCamera(camera: THREE.Camera): void {
    const pc = camera as THREE.PerspectiveCamera;
    const near = pc.near ?? 0.1;
    const far = pc.far ?? 1000;
    if (camera === this.camera && near === this.camNear && far === this.camFar) return;
    this.camera = camera;
    this.camNear = near;
    this.camFar = far;
    this.composer.setMainCamera(camera);
    if (this.ao) this.ao.camera = camera;
  }

  /** CSS-pixel size; the composer derives the drawing-buffer size from the renderer's pixel ratio. */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** Apply a packed look (see looks.ts) to every effect. `chromaExtra` = transient feedback aberration. */
  applyLook(a: Float32Array): void {
    const bloom = this.bloom;
    if (bloom) {
      bloom.intensity = Math.max(0, a[L.bloomIntensity]);
      bloom.luminanceMaterial.threshold = this.hdr ? Math.max(0, a[L.bloomThreshold]) : Math.min(0.85, a[L.bloomThreshold]);
      bloom.luminanceMaterial.smoothing = 0.35;
      bloom.mipmapBlurPass.radius = Math.min(1, Math.max(0, a[L.bloomRadius]));
    }
    this.grade?.setGrade({
      exposure: a[L.exposure],
      tint: [a[L.tint], a[L.tint + 1], a[L.tint + 2]],
      shadows: [a[L.shadowsTint], a[L.shadowsTint + 1], a[L.shadowsTint + 2]],
      highlights: [a[L.highlightsTint], a[L.highlightsTint + 1], a[L.highlightsTint + 2]],
      saturation: a[L.saturation],
      contrast: a[L.contrast],
      lift: a[L.lift],
      vignette: a[L.vignette],
    });
    if (this.finish) this.finish.grain = a[L.grain];
    const ao = this.ao;
    if (ao) {
      ao.configuration.aoRadius = Math.max(0.05, a[L.aoRadius]);
      ao.configuration.intensity = Math.max(0, a[L.aoIntensity]);
    }
  }

  /** Per-frame transient state: pulses / corruption and the total chromatic aberration. */
  applyFeedback(o: FeedbackOutput, chromaticAberration: number): void {
    this.feedback?.apply(o);
    if (this.chroma) this.chroma.amount = chromaticAberration + o.chroma + o.corruption * 0.6;
  }

  setDof(opts: { focusDistance: number; strength: number } | null): void {
    if (!opts || !(opts.strength > 0) || !Number.isFinite(opts.focusDistance)) {
      this.dofTarget = null;
      return;
    }
    this.dofTarget = { focusDistance: Math.max(0.1, opts.focusDistance), strength: Math.min(1, opts.strength) };
  }

  /** Ease depth of field toward its target (real seconds); the pass switches off when it reaches zero. */
  private applyDof(dt: number): void {
    const dof = this.dof;
    const pass = this.dofPass;
    if (!dof || !pass) return;
    const t = this.dofTarget;
    const k = dt > 0 ? 1 - Math.exp(-dt * 5) : 1;
    this.dofStrength += ((t ? t.strength : 0) - this.dofStrength) * k;
    if (t) this.dofFocus += (t.focusDistance - this.dofFocus) * k;
    if (!t && this.dofStrength < 0.01) this.dofStrength = 0;
    const s = this.dofStrength;
    pass.enabled = s > 0;
    if (s > 0) {
      const coc = dof.cocMaterial;
      coc.focusDistance = this.dofFocus;
      // strength 1 = shallow portrait focus (≈ 2 m in focus), weak = only the far background softens
      coc.focusRange = 2 + (1 - s) * 16 + this.dofFocus * 0.25;
      dof.bokehScale = 1 + 4 * s;
    }
  }

  render(dt: number): void {
    this.applyDof(dt);
    this.finish?.tick();
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}

/**
 * Sanitise what the bloom chain sees: negative / NaN texels become black (one NaN would otherwise spread into
 * a screen-sized black square through the mip chain) and luminance is soft-clamped so sub-pixel specular
 * glints cannot flicker.
 */
function guardBloomInput(bloom: BloomEffect): void {
  const mat = bloom.luminanceMaterial;
  const fetch = 'vec4 texel=texture2D(inputBuffer,vUv);';
  const lum = 'float l=luminance(texel.rgb);';
  const src = mat.fragmentShader;
  if (!src.includes(fetch) || !src.includes(lum)) return;
  mat.fragmentShader = src
    .replace(fetch, `${fetch}texel.rgb=min(vec3(65000.0),max(vec3(0.0),texel.rgb));`)
    .replace(lum, `${lum}texel.rgb*=min(1.0,${BLOOM_MAX}/max(l,1e-4));l=min(l,${BLOOM_MAX});`);
  mat.needsUpdate = true;
}
