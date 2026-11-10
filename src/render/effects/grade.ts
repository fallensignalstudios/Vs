/**
 * Colour pipeline effects for the main EffectPass (all merged into one fullscreen shader by `postprocessing`):
 *
 *   ChromaEffect  — subtle radial chromatic aberration (re-samples the pass input, so it must run first)
 *   GradeEffect   — scene-referred grade: exposure, tint, split-toning, saturation, contrast, lift, vignette
 *   ToneMapEffect — filmic tone map + sRGB encode (everything after it works on display-referred values)
 *   FinishEffect  — film grain + triangular dither (kills banding in fog gradients; blacks stay black)
 */
import { Color, Uniform, Vector3 } from 'three';
import { BlendFunction, Effect } from 'postprocessing';

// ---------------------------------------------------------------------------------------------------------

const chromaFrag = /* glsl */ `
uniform float chromaAmount;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (chromaAmount > 0.0) {
    vec2 d = uv - 0.5;
    vec2 off = d * (dot(d, d) * chromaAmount);
    float r = texture2D(inputBuffer, uv + off).r;
    float b = texture2D(inputBuffer, uv - off).b;
    outputColor = vec4(r, inputColor.g, b, inputColor.a);
  } else {
    outputColor = inputColor;
  }
}`;

/** Radial chromatic aberration: zero at the frame centre, growing with the cube of the radius. */
export class ChromaEffect extends Effect {
  constructor() {
    super('ChromaEffect', chromaFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['chromaAmount', new Uniform(0)]]),
    });
  }

  /** `amount` 0..1+ (Look.chromaticAberration plus transient feedback). 1 ≈ 0.45 % of the frame at the corners. */
  set amount(v: number) {
    this.uniforms.get('chromaAmount')!.value = Math.max(0, v) * 0.026;
  }
}

// ---------------------------------------------------------------------------------------------------------

const gradeFrag = /* glsl */ `
uniform float gradeExposure;
uniform vec3 gradeTint;
uniform vec3 gradeShadows;
uniform vec3 gradeHighlights;
uniform float gradeSaturation;
uniform float gradeContrast;
uniform float gradeLift;
uniform float gradeVignette;

const vec3 GRADE_LUMA = vec3(0.2126, 0.7152, 0.0722);

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // argument order matters: max(0, NaN) = 0, so NaN / Inf from a broken material never reach the tone map
  vec3 c = min(vec3(4096.0), max(vec3(0.0), inputColor.rgb)) * gradeExposure;
  c *= gradeTint;

  // split toning on a compressed luminance scale (0.5 = mid grey); tints are hue-only multipliers
  float l = dot(c, GRADE_LUMA);
  float t = l / (l + 0.18);
  float ws = 1.0 - smoothstep(0.0, 0.5, t);
  float wh = smoothstep(0.5, 0.95, t);
  c *= mix(vec3(1.0), gradeShadows, ws) * mix(vec3(1.0), gradeHighlights, wh);

  l = dot(c, GRADE_LUMA);
  c = max(mix(vec3(l), c, gradeSaturation), vec3(0.0));

  // filmic contrast: power curve pivoting on mid grey
  c = 0.18 * pow(c * (1.0 / 0.18), vec3(gradeContrast));

  c = max(c + gradeLift, vec3(0.0));

  // natural lens falloff, aspect-aware so it stays round
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) / length(vec2(aspect, 1.0) * 0.5);
  float r2 = dot(p, p);
  c *= 1.0 / (1.0 + r2 * r2 * gradeVignette * 1.6);

  outputColor = vec4(c, inputColor.a);
}`;

const luma = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Scene-referred colour grade (runs in linear HDR before the tone map, so nothing clips). */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['gradeExposure', new Uniform(1)],
        ['gradeTint', new Uniform(new Vector3(1, 1, 1))],
        ['gradeShadows', new Uniform(new Vector3(1, 1, 1))],
        ['gradeHighlights', new Uniform(new Vector3(1, 1, 1))],
        ['gradeSaturation', new Uniform(1)],
        ['gradeContrast', new Uniform(1)],
        ['gradeLift', new Uniform(0)],
        ['gradeVignette', new Uniform(0)],
      ]),
    });
  }

  private num(name: string, v: number): void {
    this.uniforms.get(name)!.value = v;
  }

  private vec(name: string, r: number, g: number, b: number, normalise: boolean): void {
    const out = this.uniforms.get(name)!.value as Vector3;
    out.set(r, g, b);
    if (normalise) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > 1e-4) out.multiplyScalar(1 / l);
      else out.set(1, 1, 1);
    }
  }

  /**
   * All colours are linear RGB triples. `lift` is in display-ish units (±0.05 visible) and is converted to a
   * scene-linear offset here.
   */
  setGrade(g: {
    exposure: number; tint: readonly [number, number, number]; shadows: readonly [number, number, number];
    highlights: readonly [number, number, number]; saturation: number; contrast: number; lift: number; vignette: number;
  }): void {
    this.num('gradeExposure', Math.max(0, g.exposure));
    this.vec('gradeTint', g.tint[0], g.tint[1], g.tint[2], false);
    this.vec('gradeShadows', g.shadows[0], g.shadows[1], g.shadows[2], true);
    this.vec('gradeHighlights', g.highlights[0], g.highlights[1], g.highlights[2], true);
    this.num('gradeSaturation', Math.max(0, g.saturation));
    this.num('gradeContrast', Math.min(3, Math.max(0.2, g.contrast)));
    this.num('gradeLift', Math.sign(g.lift) * Math.pow(Math.abs(g.lift), 2.2));
    this.num('gradeVignette', Math.min(1.5, Math.max(0, g.vignette)));
  }
}

/** Luminance of a linear colour (exported for callers that normalise tints themselves). */
export const linearLuma = luma;

// ---------------------------------------------------------------------------------------------------------

export type ToneMapOperator = 'aces' | 'agx' | 'agxPunchy' | 'neutral';

const TONEMAP_IDS: Record<ToneMapOperator, number> = { aces: 0, agx: 1, agxPunchy: 2, neutral: 3 };

const toneMapFrag = /* glsl */ `
#include <tonemapping_pars_fragment>

#if TONEMAP_OPERATOR == 2
// AgX with the "punchy" look applied in the log domain (contrast + saturation), so blacks sit deeper and
// mid-tones keep their chroma while highlights still roll off through AgX's desaturating shoulder.
vec3 punchyAgX(vec3 color) {
  const mat3 AgXInsetMatrix = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AgXOutsetMatrix = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxDefaultContrastApprox(color);
  // look: slope / power / saturation (ASC CDL), punchy = power 1.35, saturation 1.4 — softened a little
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(color, vec3(1.3));
  l = pow(l, 1.3);
  color = l + 1.3 * (color - l);
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp(color, 0.0, 1.0);
}
#endif

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, vec3(0.0));
  #if TONEMAP_OPERATOR == 0
    c = ACESFilmicToneMapping(c);
  #elif TONEMAP_OPERATOR == 1
    c = AgXToneMapping(c);
  #elif TONEMAP_OPERATOR == 2
    c = punchyAgX(c);
  #else
    c = NeutralToneMapping(c);
  #endif
  outputColor = sRGBTransferOETF(vec4(clamp(c, 0.0, 1.0), inputColor.a));
}`;

/**
 * Tone map + display encode. Output is sRGB-ENCODED (not linear): the passes after it (SMAA, grain) want
 * perceptual values, and the pass that reaches the screen must have `encodeOutput = false`.
 */
export class ToneMapEffect extends Effect {
  private op: ToneMapOperator;

  constructor(operator: ToneMapOperator = 'aces') {
    super('ToneMapEffect', toneMapFrag, {
      blendFunction: BlendFunction.SRC,
      defines: new Map([['TONEMAP_OPERATOR', String(TONEMAP_IDS[operator] ?? 0)]]),
    });
    this.op = operator in TONEMAP_IDS ? operator : 'aces';
  }

  get operator(): ToneMapOperator {
    return this.op;
  }

  set operator(v: ToneMapOperator) {
    if (v === this.op || !(v in TONEMAP_IDS)) return;
    this.op = v;
    this.defines.set('TONEMAP_OPERATOR', String(TONEMAP_IDS[v]));
    this.setChanged();
  }
}

// ---------------------------------------------------------------------------------------------------------

const finishFrag = /* glsl */ `
uniform float finishGrain;
uniform float finishSeed;

float finishHash(vec2 p, float s) {
  uvec2 q = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y ^ (uint(s) * 2654435769u)) * 1597334673u;
  n ^= n >> 16u;
  n *= 2246822519u;
  n ^= n >> 13u;
  return float(n) * (1.0 / 4294967295.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec2 px = gl_FragCoord.xy;
  // triangular-PDF noise in [-1, 1]
  float tri = finishHash(px, finishSeed) + finishHash(px + 61.0, finishSeed + 17.0) - 1.0;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // film response: grain lives in the mid-tones and shadows, thins out in highlights and in true black
  float response = smoothstep(0.0, 0.14, l) * (1.0 - 0.65 * smoothstep(0.45, 1.0, l));
  c += tri * (finishGrain * response + 1.0 / 255.0);
  outputColor = vec4(c, inputColor.a);
}`;

/** Film grain + 1-LSB triangular dither on display-encoded values. Always the last effect before the screen. */
export class FinishEffect extends Effect {
  private frame = 0;

  constructor() {
    super('FinishEffect', finishFrag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['finishGrain', new Uniform(0)],
        ['finishSeed', new Uniform(0)],
      ]),
    });
  }

  /** `amount` = Look.grain 0..1 */
  set grain(amount: number) {
    this.uniforms.get('finishGrain')!.value = Math.min(1, Math.max(0, amount)) * 0.05;
  }

  /** Advance the noise pattern by one frame (deterministic: a frame counter, not wall time). */
  tick(): void {
    this.frame = (this.frame + 1) % 4096;
    this.uniforms.get('finishSeed')!.value = this.frame;
  }
}
