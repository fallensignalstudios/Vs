/**
 * Far-field "megastructure" material: one cheap forward shader for everything kilometres away (terminal vista,
 * atrium shell, Crownmark arm, ribs, capital ships, the carrier). Fog-exempt — it carries its own distance haze
 * that dissolves into the exact sky colour behind it (shared `skyHaze`), lit by the sky preset's key (white
 * remnant side) and fill (red remnant side). Vertex `color` = albedo, `aGlow` = emissive multiplier.
 */
import * as THREE from 'three';
import { GLSL_HAZE, GLSL_NOISE } from '../glsl';
import type { SharedUniforms } from '../shared';

export interface ScenicMaterialOpts {
  /** multiplier on the preset haze density (interiors use < 1 so near shells stay crisp) */
  haze?: number;
  /** extra haze for geometry below the piece origin: 0 none … 1 the abyss swallows everything by `lowDepth` m */
  lowHaze?: number;
  lowDepth?: number;
  /** panel module in metres (x = along, y = up); 0 disables panelling */
  panel?: [number, number];
  /** 0..1 specular polish (black stone = high) */
  gloss?: number;
  /** 0..1 procedural scorch + glowing breaches (carrier, capital wrecks) */
  breach?: number;
  /** minimum haze-independent visibility of emissive parts (lights punch through haze) */
  glowReach?: number;
  doubleSide?: boolean;
  name?: string;
}

const VERTEX = /* glsl */ `
attribute float aGlow;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vLocalNormal;
varying vec3 vColor;
varying float vGlow;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vLocalNormal = normal;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vGlow = aGlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vLocalNormal;
varying vec3 vColor;
varying float vGlow;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uFillDir;
uniform vec3 uFillColor;
uniform float uAmbient;
uniform float uHazeDensity;
uniform float uHazeScale;
uniform float uLowHaze;
uniform float uLowDepth;
uniform vec2 uPanel;
uniform float uGloss;
uniform float uBreach;
uniform float uGlowReach;
uniform float uTime;
${GLSL_NOISE}
${GLSL_HAZE}

// filtered grid line: 1 on the line, fades to the line's average coverage when the module is sub-pixel
float gridLine(float x, float w) {
  float fw = max(fwidth(x), 1e-5);
  float toLine = 0.5 - abs(fract(x) - 0.5);
  float l = 1.0 - smoothstep(w - fw, w + fw, toLine);
  return mix(l, 2.0 * w, clamp(fw * 1.8, 0.0, 1.0));
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / max(dist, 1e-3);

  vec3 albedo = vColor;
  float glow = vGlow;

  // --- panelling in object space: pick the plane by the dominant local normal axis
  if (uPanel.x > 0.0) {
    vec3 an = abs(vLocalNormal);
    vec2 pc = an.y > 0.6 ? vLocal.xz / uPanel.x : (an.x > an.z ? vec2(vLocal.z / uPanel.x, vLocal.y / uPanel.y) : vec2(vLocal.x / uPanel.x, vLocal.y / uPanel.y));
    float fw = max(fwidth(pc.x), fwidth(pc.y));
    float fade = 1.0 - clamp(fw * 2.2, 0.0, 1.0);
    vec2 cell = floor(pc);
    float tone = hash21(cell + floor(dot(vLocalNormal, vec3(1.0, 3.0, 5.0))));
    albedo *= 1.0 + (tone - 0.5) * 0.34 * fade;
    float seam = max(gridLine(pc.x, 0.035), gridLine(pc.y, 0.035));
    albedo *= 1.0 - 0.42 * seam * step(glow, 0.01);
  }

  // --- battle damage: scorch + glowing breaches (object-space noise, slow ember pulse)
  vec3 breachGlow = vec3(0.0);
  if (uBreach > 0.0) {
    float b = fbm3(vLocal * 0.021 + 3.7);
    float edge = 0.83 - 0.12 * uBreach;
    float scorch = smoothstep(edge - 0.13, edge, b);
    albedo *= 1.0 - 0.85 * scorch;
    float core = smoothstep(edge + 0.012, edge + 0.05, b);
    float cracks = pow(1.0 - abs(2.0 * vnoise(vLocal * 0.16 + 9.0) - 1.0), 6.0);
    float pulse = 0.72 + 0.28 * sin(uTime * 1.7 + b * 40.0);
    breachGlow = vec3(1.0, 0.26, 0.05) * (core * (0.35 + 2.4 * cracks) * pulse * 1.7);
    albedo *= 1.0 - 0.9 * core;
    glow *= 1.0 - scorch;
  }

  // --- lighting: key (white remnant side), fill (red remnant side), sky ambient, a touch of polish
  float ndk = max(dot(n, uKeyDir), 0.0);
  float ndf = max(dot(n, uFillDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = (uHaze * 2.2 + vec3(0.010, 0.011, 0.016)) * uAmbient * mix(0.4, 1.0, hemi);
  vec3 lit = albedo * (uKeyColor * ndk + uFillColor * ndf + ambient);
  vec3 hv = normalize(uKeyDir + v);
  float spec = pow(max(dot(n, hv), 0.0), mix(18.0, 90.0, uGloss)) * uGloss;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  lit += uKeyColor * spec * 0.35 * step(0.0, dot(n, uKeyDir));
  lit += skyHaze(reflect(-v, n)) * fres * uGloss * 1.6;

  // --- haze: exponential with distance, thicker below the piece origin (the abyss)
  float low = uLowHaze * clamp(-vLocal.y / uLowDepth, 0.0, 1.0);
  float density = uHazeDensity * uHazeScale * (1.0 + 3.0 * low);
  float f = 1.0 - exp(-dist * density);
  f = max(f, low * low * 0.92);
  vec3 hz = skyHaze(-v);
  vec3 col = mix(lit, hz, f);
  // emissive parts survive haze far longer than surfaces (tiny lights sell the distance)
  vec3 emis = vColor * glow + breachGlow;
  col += emis * max(1.0 - f, uGlowReach) * (1.0 - 0.75 * low * low);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createScenicMaterial(shared: SharedUniforms, opts: ScenicMaterialOpts = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: opts.name ?? 'ScenicMega',
    uniforms: {
      uTime: shared.uTime,
      uHaze: shared.uHaze, uHazeRed: shared.uHazeRed, uHazeWhite: shared.uHazeWhite,
      uRedDir: shared.uRedDir, uWhiteDir: shared.uWhiteDir, uWoundDir: shared.uWoundDir,
      uKeyDir: shared.uKeyDir, uKeyColor: shared.uKeyColor, uFillDir: shared.uFillDir, uFillColor: shared.uFillColor,
      uAmbient: shared.uAmbient, uHazeDensity: shared.uHazeDensity,
      uHazeScale: { value: opts.haze ?? 1 },
      uLowHaze: { value: opts.lowHaze ?? 0 },
      uLowDepth: { value: opts.lowDepth ?? 400 },
      uPanel: { value: new THREE.Vector2(opts.panel?.[0] ?? 0, opts.panel?.[1] ?? 1) },
      uGloss: { value: opts.gloss ?? 0.3 },
      uBreach: { value: opts.breach ?? 0 },
      uGlowReach: { value: opts.glowReach ?? 0.3 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    fog: false,
  });
}
