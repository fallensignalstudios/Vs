/**
 * Shared creature state shader: a MeshStandardMaterial patched (onBeforeCompile) with per-vertex surface data
 * and the CharacterVisual state features — flash, frost, Eclipse corruption, dissolve, glow, telegraph, rim,
 * emissive groups (weak-point exposure) and plate knitting. Every creature/device uses this one program;
 * each instance owns only a small uniform block.
 */
import * as THREE from 'three';

export const GROUPS = 8;

export interface StateUniforms {
  uTime: { value: number };
  /** rgb + amount */
  uFlash: { value: THREE.Vector4 };
  uFrozen: { value: number };
  /** frost creeps outward from this bind-space point … */
  uFrostOrigin: { value: THREE.Vector3 };
  /** … reaching this radius at uFrozen = 1 */
  uFrostRange: { value: number };
  uCorruption: { value: number };
  uDissolve: { value: number };
  uDissolveColor: { value: THREE.Color };
  uGlow: { value: number };
  uTelegraph: { value: THREE.Vector4 };
  uRim: { value: THREE.Vector4 };
  /** emissive multiplier per part group */
  uGroup: { value: Float32Array };
  /** x breathing amount, y regenerate wave amount, z wave phase, w uniform lift */
  uKnit: { value: THREE.Vector4 };
  /** 0..1 cadence beat pulse (vein brightness) */
  uBeat: { value: number };
  /** rgb = hot colour vertices in the hot group shift toward, a = amount */
  uHot: { value: THREE.Vector4 };
}

export interface StateMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: StateUniforms;
}

const VERT_PARS = /* glsl */ `
attribute vec4 aSurf;
attribute vec4 aPart;
attribute vec3 aSlide;
varying vec3 vBind;
varying vec4 vSurf;
varying vec4 vPart;
uniform float uTime;
uniform vec4 uKnit;
`;

const VERT_BEGIN = /* glsl */ `
vBind = position;
vSurf = aSurf;
vPart = aPart;
{
  float cPh = aPart.y * 6.2831853;
  float cWave = 0.5 + 0.5 * sin(uKnit.z - position.y * 2.4 + cPh * 0.4);
  float cKn = uKnit.x * (0.5 + 0.5 * sin(uTime * 1.3 + cPh)) + uKnit.y * cWave * cWave * cWave + uKnit.w * (0.6 + 0.8 * aPart.y);
  transformed += aSlide * cKn;
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vBind;
varying vec4 vSurf;
varying vec4 vPart;
uniform float uTime;
uniform vec4 uFlash;
uniform float uFrozen;
uniform vec3 uFrostOrigin;
uniform float uFrostRange;
uniform float uCorruption;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uGlow;
uniform vec4 uTelegraph;
uniform vec4 uRim;
uniform float uGroup[${GROUPS}];
uniform float uBeat;
uniform vec4 uHot;

float cHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float cNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cHash(i), cHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(cHash(i + vec3(0.0, 1.0, 0.0)), cHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(cHash(i + vec3(0.0, 0.0, 1.0)), cHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(cHash(i + vec3(0.0, 1.0, 1.0)), cHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

/** surface breakup, corruption, frost and dissolve — runs right after the vertex colour is applied */
const FRAG_COLOR = /* glsl */ `
vec3 cP = vBind;
// fine detail fades out with distance (metres of surface per pixel) so it never aliases into a weave
float cFine = 1.0 - smoothstep(0.004, 0.022, length(fwidth(cP)));
float cN1 = cNoise(cP * 7.0);
float cN2 = mix(0.5, cNoise(cP * 27.0 + 11.3), cFine);
float cTissue = vPart.z;
float cEmi = vSurf.z;
float cGroup = uGroup[int(vPart.x + 0.5)];

// dissolve first (cheap early-out)
float cDn = cNoise(cP * 5.5 + vPart.y * 3.0) * 0.72 + cN2 * 0.28;
float cCut = uDissolve * 1.12 - 0.06;
if (uDissolve > 0.0005 && cDn < cCut) discard;
float cDEdge = uDissolve > 0.0005 ? smoothstep(cCut + 0.1, cCut, cDn) : 0.0;

// grime + bevel wear
diffuseColor.rgb *= 0.74 + 0.38 * cN1 * (0.55 + 0.45 * cN2);
float cWear = vSurf.w * (0.45 + 0.55 * cN2);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.9 + 0.035, cWear * 0.65);
diffuseColor.rgb *= 1.0 - clamp(cEmi, 0.0, 1.0) * 0.85;

// Eclipse corruption: thin conduits that creep out of seams/tissue first, then across plating.
// Stretched along the body's vertical so veins run WITH limbs and structure rather than marbling it.
float cCorr = clamp(uCorruption, 0.0, 1.0);
vec3 cVp = cP * vec3(4.6, 2.0, 4.6);
float cRidgeA = abs(cNoise(cVp + 3.1) * 2.0 - 1.0);
float cRidgeB = abs(cNoise(cVp * 2.3 - 7.7) * 2.0 - 1.0);
float cGateN = cNoise(cP * 1.7 + 5.0) * 0.6 + cTissue * 0.5 + cN1 * 0.1;
float cGate = cCorr > 0.001 ? smoothstep(1.02 - cCorr * 1.05, 1.14 - cCorr * 0.95, cGateN + cCorr * 0.25) : 0.0;
float cVein = (1.0 - smoothstep(0.0, 0.022 + 0.03 * cCorr, min(cRidgeA, cRidgeB + 0.1))) * cGate;
float cFlow = 0.5 + 0.5 * sin(cNoise(cP * 2.2) * 20.0 - uTime * 2.4);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.016, 0.01, 0.026), cGate * 0.6 * (1.0 - clamp(cEmi, 0.0, 1.0)));
vec3 cCorrEmi = vec3(0.3, 0.1, 1.0) * cVein * (0.35 + 1.5 * uBeat + 0.5 * cFlow);

// frost: creeps outward from uFrostOrigin, crystalline breakup
float cFd = distance(cP, uFrostOrigin) + (cN1 - 0.5) * 0.35 * uFrostRange;
float cFr = uFrozen * uFrostRange * 1.5;
float cFrost = uFrozen > 0.001 ? smoothstep(cFr, cFr - 0.22 * uFrostRange - 0.02, cFd) : 0.0;
float cCrys = abs(cNoise(cP * 24.0 + 2.0) * 2.0 - 1.0);
float cCrack = 1.0 - smoothstep(0.0, 0.09, cCrys);
float cLum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(cLum), vec3(0.58, 0.78, 0.9), 0.78) * (0.8 + 0.3 * cCrack), cFrost * 0.88);
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = clamp(vSurf.x * (0.82 + 0.4 * cN2) + cWear * 0.1, 0.045, 1.0);
roughnessFactor = mix(roughnessFactor, 0.2 + 0.5 * cCrys, cFrost);
roughnessFactor = mix(roughnessFactor, 0.32, cGate * 0.6);
`;

const FRAG_METAL = /* glsl */ `
metalnessFactor = vSurf.y * (1.0 - 0.75 * cFrost) * (1.0 - 0.5 * cGate);
`;

const FRAG_BUMP = /* glsl */ `
#ifdef CREATURE_BUMP
{
  float cH = mix(cN2 * 0.7 + cN1 * 0.3, cRidgeB * 1.6 + cRidgeA, cTissue * 0.8) + cCrack * cFrost * 1.5 - cVein * 0.8;
  vec3 cDpx = dFdx(-vViewPosition);
  vec3 cDpy = dFdy(-vViewPosition);
  float cDhx = dFdx(cH);
  float cDhy = dFdy(cH);
  vec3 cR1 = cross(cDpy, normal);
  vec3 cR2 = cross(normal, cDpx);
  float cDet = dot(cDpx, cR1);
  vec3 cGrad = sign(cDet) * (cDhx * cR1 + cDhy * cR2);
  normal = normalize(abs(cDet) * normal - (0.006 + 0.014 * cTissue) * cFine * cGrad);
}
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float cFres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  float cHotMask = vPart.x > 0.5 ? uHot.a * clamp(cGroup - 1.0, 0.0, 1.0) : 0.0;
  vec3 cBase = mix(vColor.rgb, uHot.rgb, cHotMask);
  vec3 cE = cBase * cEmi * uGlow * cGroup * (1.0 - cFrost * 0.75);
  cE += cCorrEmi * (1.0 - cFrost);
  cE += vec3(0.5, 0.82, 1.0) * cFrost * (cFres * 0.55 + cCrack * 0.22);
  cE += uDissolveColor * cDEdge * 5.0;
  float cTp = 0.72 + 0.28 * sin(uTime * 17.0);
  cE += uTelegraph.rgb * uTelegraph.a * cTp * (cFres * 1.6 + clamp(cEmi, 0.0, 1.0) * 2.5 + 0.06);
  cE += uRim.rgb * uRim.a * cFres * 1.4;
  cE += uFlash.rgb * uFlash.a * (0.55 + cFres * 1.2);
  totalEmissiveRadiance = cE;
}
`;

function patch(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, uniforms: StateUniforms): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BEGIN);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH)
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_METAL)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_BUMP)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE);
}

/**
 * Create one state material instance. All instances share a single compiled program (per `bump` flag);
 * `bump` adds derivative-based micro surface detail and is switched off on the low quality profile.
 */
export function createStateMaterial(bump = true): StateMaterial {
  const group = new Float32Array(GROUPS).fill(1);
  const uniforms: StateUniforms = {
    uTime: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uFrozen: { value: 0 },
    uFrostOrigin: { value: new THREE.Vector3() },
    uFrostRange: { value: 1 },
    uCorruption: { value: 0 },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(0x7a3cff) },
    uGlow: { value: 1 },
    uTelegraph: { value: new THREE.Vector4(1, 1, 1, 0) },
    uRim: { value: new THREE.Vector4(1, 1, 1, 0) },
    uGroup: { value: group },
    uKnit: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBeat: { value: 0 },
    uHot: { value: new THREE.Vector4(1, 1, 1, 0) },
  };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1 });
  material.name = 'creatureState';
  if (bump) material.defines = { ...(material.defines ?? {}), CREATURE_BUMP: '' };
  material.onBeforeCompile = (shader) => patch(shader, uniforms);
  material.customProgramCacheKey = () => (bump ? 'creatureState:bump' : 'creatureState');
  return { material, uniforms };
}
