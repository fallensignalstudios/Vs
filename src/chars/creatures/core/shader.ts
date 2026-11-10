/**
 * Shared creature state shader: a MeshStandardMaterial patched (onBeforeCompile) with the CharacterVisual state
 * features — flash, frost, Eclipse corruption, dissolve, glow, telegraph, rim, emissive groups (weak-point
 * exposure) and plate knitting.
 *
 * Two surface sources feed the same state code:
 *  - PROCEDURAL rigs carry their surface per vertex (`aSurf`, `aPart`, `aSlide` — see core/rig.ts);
 *  - SKINS (`CREATURE_SKIN`: a generated, textured mesh worn over a creature's animator) take albedo /
 *    roughness / metalness / normals from their PBR maps; tissue and light masks are derived from the base
 *    colour and from bind-space regions (weak-point joint, eyes, core), so no extra vertex data is needed.
 *
 * Cost control: `discard` only exists in the program while a creature is actually dissolving
 * (`CREATURE_DISSOLVE`, toggled by setDissolveActive), so layered plates keep early-Z; corruption and frost
 * are skipped by uniform branches when their amounts are zero.
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
  /** vein pattern frequency multiplier (large bodies use < 1 so the thread spacing stays in proportion) */
  uVeinScale: { value: number };
  /** skins: bind-space weak-point region (xyz centre, w radius) — lit by group 3, swollen by uSkin.z */
  uJoint: { value: THREE.Vector4 };
  /** skins: bind-space eye sockets (xyz centre, w radius) — lit by group 1 */
  uEyeA: { value: THREE.Vector4 };
  uEyeB: { value: THREE.Vector4 };
  /** skins: bind-space chest core region — lit by group 2 */
  uCore: { value: THREE.Vector4 };
  /** skins: x vein emissive gain, y roughness floor, z joint swell (metres), w joint fractured 0..1 */
  uSkin: { value: THREE.Vector4 };
}

export interface StateMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: StateUniforms;
}

const VERT_PARS = /* glsl */ `
varying vec3 vBind;
uniform float uTime;
uniform vec4 uKnit;
#ifdef CREATURE_SKIN
uniform vec4 uJoint;
uniform vec4 uSkin;
#else
attribute vec4 aSurf;
attribute vec4 aPart;
attribute vec3 aSlide;
varying vec4 vSurf;
varying vec4 vPart;
#endif
`;

const VERT_BEGIN = /* glsl */ `
vBind = position;
#ifdef CREATURE_SKIN
{
  // the weak point swells and throbs when exposed; regeneration sends a slow breathing wave up the body
  float cJm = 1.0 - smoothstep(uJoint.w * 0.35, uJoint.w, distance(position, uJoint.xyz));
  float cWave = 0.5 + 0.5 * sin(uKnit.z - position.y * 2.4);
  transformed += objectNormal * (cJm * uSkin.z * (0.75 + 0.25 * sin(uTime * 5.2)) + uKnit.y * cWave * cWave * 0.018 + uKnit.w * 0.012);
}
#else
vSurf = aSurf;
vPart = aPart;
{
  float cPh = aPart.y * 6.2831853;
  float cWave = 0.5 + 0.5 * sin(uKnit.z - position.y * 2.4 + cPh * 0.4);
  float cKn = uKnit.x * (0.5 + 0.5 * sin(uTime * 1.3 + cPh)) + uKnit.y * cWave * cWave * cWave + uKnit.w * (0.6 + 0.8 * aPart.y);
  transformed += aSlide * cKn;
}
#endif
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vBind;
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
uniform float uVeinScale;
#ifdef CREATURE_SKIN
uniform vec4 uJoint;
uniform vec4 uEyeA;
uniform vec4 uEyeB;
uniform vec4 uCore;
uniform vec4 uSkin;
#else
varying vec4 vSurf;
varying vec4 vPart;
#endif

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
float cSphere(vec4 s, vec3 p) {
  return 1.0 - smoothstep(s.w * 0.45, s.w, distance(p, s.xyz));
}
`;

/** surface breakup, corruption, frost and dissolve — runs right after the base colour is known */
const FRAG_COLOR = /* glsl */ `
vec3 cP = vBind;
// fine detail fades out with distance (metres of surface per pixel) so it never aliases into a weave
float cFine = 1.0 - smoothstep(0.004, 0.022, length(fwidth(cP)));
float cN1 = cNoise(cP * 7.0);
#ifdef CREATURE_SKIN
float cN2 = 0.5;
float cLum0 = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
// Eclipse tissue on a generated mesh = the violet / blue-dominant texels plus the darkest crevices
float cViolet = clamp((diffuseColor.b - max(diffuseColor.r, diffuseColor.g) * 0.92) * 9.0, 0.0, 1.0) * smoothstep(0.004, 0.03, diffuseColor.b);
float cDark = 1.0 - smoothstep(0.012, 0.07, cLum0);
float cTissue = clamp(cViolet + cDark * 0.55, 0.0, 1.0);
float cEmi = 0.0;
float cWear = 0.0;
float cRnd = 0.37;
float cKeep = 0.0;
float cJoint = cSphere(uJoint, cP);
// a fractured joint is charred: the tissue goes to cinder with ember cracks
float cChar = cJoint * uSkin.w;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.009, 0.008) + diffuseColor.rgb * 0.08, cChar * 0.92);
#else
float cN2 = mix(0.5, cNoise(cP * 27.0 + 11.3), cFine);
float cTissue = vPart.z;
float cEmi = vSurf.z;
float cGroup = uGroup[int(vPart.x + 0.5)];
float cRnd = vPart.y;
float cKeep = vPart.w;
// grime + bevel wear
diffuseColor.rgb *= 0.74 + 0.38 * cN1 * (0.55 + 0.45 * cN2);
float cWear = vSurf.w * (0.45 + 0.55 * cN2);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.9 + 0.035, cWear * 0.65);
diffuseColor.rgb *= 1.0 - clamp(cEmi, 0.0, 1.0) * 0.85;
#endif

float cDEdge = 0.0;
#ifdef CREATURE_DISSOLVE
{
  float cDn = cNoise(cP * 5.5 + cRnd * 3.0) * 0.72 + cNoise(cP * 27.0 + 11.3) * 0.28;
  float cCut = (uDissolve * 1.12 - 0.06) * (1.0 - cKeep) - cKeep;
  if (cDn < cCut) discard;
  cDEdge = smoothstep(cCut + 0.045, cCut, cDn);
}
#endif

// Eclipse corruption: thin conduit lines (two warped families of parallel threads) that surface in patches —
// out of seams and tissue first, then across plating as the amount rises. Line width is constant by
// construction, so veins stay threads at any scale; violet stays an accent.
float cGate = 0.0;
float cVein = 0.0;
float cRidgeA = 0.0;
float cRidgeB = 0.0;
vec3 cCorrEmi = vec3(0.0);
if (uCorruption > 0.001) {
#ifdef CREATURE_SKIN
  // a skin's baseline corruption is already painted into its texture: procedural threads only arrive on top
  float cCorr = clamp((uCorruption - 0.5) * 2.0, 0.0, 1.0);
#else
  float cCorr = clamp(uCorruption, 0.0, 1.0) * (1.0 - 0.8 * cKeep);
#endif
  float cGateN = cNoise(cP * 1.7 + 5.0) * 0.45 + cTissue * 0.55 + cN1 * 0.08;
  cGate = smoothstep(1.02 - cCorr * 1.05, 1.16 - cCorr * 0.95, cGateN + cCorr * 0.25);
  vec3 cVp = cP * uVeinScale;
  float cWarp = cNoise(cVp * 2.3 + 3.1);
  float cWarp2 = cNoise(cVp * 5.1 - 1.7);
  float cU1 = cVp.x * 6.0 + cVp.z * 4.4 + cVp.y * 1.2 + cWarp * 3.4 + cWarp2 * 1.1;
  float cU2 = cVp.y * 6.5 - cVp.x * 4.0 + cVp.z * 3.0 + cNoise(cVp * 2.9 - 7.7) * 3.2;
  float cL1 = abs(fract(cU1) - 0.5);
  float cL2 = abs(fract(cU2) - 0.5);
  float cBreak = cNoise(cVp * 3.7 + 9.0);
  float cHalf = (0.034 + 0.03 * cCorr) * uVeinScale;
  cVein = max((1.0 - smoothstep(cHalf * 0.5, cHalf, cL1)) * smoothstep(0.4, 0.56, cBreak),
              (1.0 - smoothstep(cHalf * 0.4, cHalf * 0.8, cL2)) * smoothstep(0.66, 0.8, cBreak + cWarp * 0.3)) * cGate * (0.45 + 0.55 * cTissue);
  float cFlow = 0.5 + 0.5 * sin(cU1 * 2.0 + cU2 - uTime * 2.4);
  cRidgeA = cL1 * 2.0;
  cRidgeB = cL2 * 2.0;
#ifdef CREATURE_SKIN
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.016, 0.01, 0.026), cGate * 0.3);
#else
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.016, 0.01, 0.026), cGate * 0.6 * (1.0 - clamp(cEmi, 0.0, 1.0)));
#endif
  cCorrEmi = vec3(0.3, 0.1, 1.0) * cVein * (0.4 + 1.5 * uBeat + 0.5 * cFlow);
}

// frost: creeps outward from uFrostOrigin, crystalline breakup
float cFrost = 0.0;
float cCrys = 0.5;
float cCrack = 0.0;
if (uFrozen > 0.001) {
  float cFd = distance(cP, uFrostOrigin) + (cN1 - 0.5) * 0.35 * uFrostRange;
  float cFr = uFrozen * uFrostRange * 1.5;
  cFrost = smoothstep(cFr, cFr - 0.22 * uFrostRange - 0.02, cFd);
  cCrys = abs(cNoise(cP * 24.0 + 2.0) * 2.0 - 1.0);
  cCrack = 1.0 - smoothstep(0.0, 0.09, cCrys);
  float cLum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(cLum), vec3(0.4, 0.6, 0.74), 0.78) * (0.8 + 0.3 * cCrack), cFrost * 0.88);
}
`;

const FRAG_ROUGH = /* glsl */ `
#ifdef CREATURE_SKIN
roughnessFactor = clamp(max(roughnessFactor, uSkin.y) + cChar * 0.3, 0.045, 1.0);
#else
roughnessFactor = clamp(vSurf.x * (0.82 + 0.4 * cN2) + cWear * 0.1, 0.045, 1.0);
#endif
roughnessFactor = mix(roughnessFactor, 0.2 + 0.5 * cCrys, cFrost);
roughnessFactor = mix(roughnessFactor, 0.32, cGate * 0.6);
`;

const FRAG_METAL = /* glsl */ `
#ifdef CREATURE_SKIN
metalnessFactor = metalnessFactor * 0.55 * (1.0 - 0.75 * cFrost) * (1.0 - cChar);
#else
metalnessFactor = vSurf.y * (1.0 - 0.75 * cFrost) * (1.0 - 0.5 * cGate);
#endif
`;

const FRAG_BUMP = /* glsl */ `
#if defined( CREATURE_BUMP ) && !defined( CREATURE_SKIN )
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
  vec3 cE = vec3(0.0);
  float cLit = 0.0;
#ifdef CREATURE_SKIN
  // painted violet seams become light; the joint, eye sockets and chest core are bind-space regions
  float cPulse = 0.75 + 0.25 * sin(uTime * 2.1 + cP.y * 3.0);
  cE += vec3(0.5, 0.22, 1.0) * cViolet * uSkin.x * (0.35 + 0.4 * uGroup[4]) * cPulse * (1.0 - cJoint);
  float cMot = 0.25 + 1.5 * smoothstep(0.3, 0.72, cNoise(cP * 9.0 + 4.0));
  vec3 cJc = mix(vec3(0.5, 0.2, 1.0), uHot.rgb, uHot.a);
  cE += cJc * cJoint * (0.22 + 1.1 * cViolet + 0.4 * cDark) * cMot * uGroup[3] * (1.0 - uSkin.w);
  float cEmber = smoothstep(0.62, 0.8, cNoise(cP * 14.0 + 2.0)) * cJoint;
  cE += vec3(1.0, 0.36, 0.08) * cEmber * uGroup[5];
  float cEye = max(cSphere(uEyeA, cP), cSphere(uEyeB, cP));
  cE += vec3(0.6, 0.42, 1.0) * cEye * (0.3 + 0.7 * cDark) * uGroup[1] * 1.15;
  cE += vec3(0.48, 0.2, 1.0) * cSphere(uCore, cP) * (cViolet * 0.8 + cDark * 0.4) * uGroup[2] * 0.6;
  cE *= uGlow * (1.0 - cFrost * 0.75);
  cLit = clamp(cViolet * uSkin.x + cEye, 0.0, 1.0);
#else
  float cHotMask = vPart.x > 0.5 ? uHot.a * clamp(cGroup - 1.0, 0.0, 1.0) : 0.0;
  vec3 cBase = mix(vColor.rgb, uHot.rgb, cHotMask);
  // organic glows are mottled (embers, tissue light through a crust); hard-surface lights stay clean
  float cMottle = mix(1.0, 0.15 + 1.75 * smoothstep(0.3, 0.72, cNoise(cP * 11.0 + 4.0)), cTissue);
  cE = cBase * cEmi * uGlow * cGroup * cMottle * (1.0 - cFrost * 0.75);
  cLit = clamp(cEmi, 0.0, 1.0);
  // near-black tissue keeps a faint violet edge so limbs do not vanish against black stone
  cE += vec3(0.2, 0.1, 0.5) * cFres * cTissue * (1.0 - cLit) * 0.16 * clamp(uCorruption * 2.0, 0.0, 1.0);
#endif
  cE += cCorrEmi * (1.0 - cFrost);
  cE += vec3(0.5, 0.82, 1.0) * cFrost * (cFres * 0.3 + cCrack * 0.1);
  cE += uDissolveColor * cDEdge * 3.0;
  float cTp = 0.72 + 0.28 * sin(uTime * 17.0);
  cE += uTelegraph.rgb * uTelegraph.a * cTp * (cFres * 0.75 + cLit * 2.2 + 0.012);
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

/** a fresh uniform block (one per creature; a skin shares its creature's block) */
export function createStateUniforms(): StateUniforms {
  return {
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
    uGroup: { value: new Float32Array(GROUPS).fill(1) },
    uKnit: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBeat: { value: 0 },
    uHot: { value: new THREE.Vector4(1, 1, 1, 0) },
    uVeinScale: { value: 1 },
    uJoint: { value: new THREE.Vector4(0, -100, 0, 0.01) },
    uEyeA: { value: new THREE.Vector4(0, -100, 0, 0.01) },
    uEyeB: { value: new THREE.Vector4(0, -100, 0, 0.01) },
    uCore: { value: new THREE.Vector4(0, -100, 0, 0.01) },
    uSkin: { value: new THREE.Vector4(1, 0.55, 0, 0) },
  };
}

function finish(material: THREE.MeshStandardMaterial, uniforms: StateUniforms, key: string): void {
  material.onBeforeCompile = (shader) => patch(shader, uniforms);
  material.customProgramCacheKey = () => key;
}

/**
 * Create one state material instance for a PROCEDURAL rig. All instances share compiled programs (per `bump`
 * flag and dissolve state); `bump` adds derivative-based micro surface detail and is switched off on the low
 * quality profile. Pass `shared` to drive a second procedural mesh from an existing creature's uniform block.
 */
export function createStateMaterial(bump = true, shared?: StateUniforms): StateMaterial {
  const uniforms = shared ?? createStateUniforms();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1 });
  material.name = 'creatureState';
  material.defines = { ...(material.defines ?? {}) };
  if (bump) material.defines.CREATURE_BUMP = '';
  finish(material, uniforms, bump ? 'creatureState:bump' : 'creatureState');
  return { material, uniforms };
}

/**
 * State material for a SKIN: a clone of the generated mesh's own PBR material (maps shared, not copied) driven
 * by the wearer's uniform block, so every CharacterVisual state setter reaches the skin with no extra code.
 */
export function createSkinMaterial(source: THREE.MeshStandardMaterial, uniforms: StateUniforms): THREE.MeshStandardMaterial {
  const material = source.clone();
  material.name = 'creatureSkin';
  material.vertexColors = false;
  material.emissive.setRGB(0, 0, 0);
  material.emissiveMap = null;
  material.defines = { ...(material.defines ?? {}), CREATURE_SKIN: '' };
  finish(material, uniforms, 'creatureSkin');
  return material;
}

/** Add / remove the dissolve cut-out from a state material's program (cheap: programs are cached per variant). */
export function setDissolveActive(material: THREE.Material, on: boolean): void {
  const d = (material.defines ??= {});
  if (('CREATURE_DISSOLVE' in d) === on) return;
  if (on) d.CREATURE_DISSOLVE = '';
  else delete d.CREATURE_DISSOLVE;
  material.needsUpdate = true;
}
