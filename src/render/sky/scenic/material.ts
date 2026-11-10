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
  /** local height where the low haze starts (default 0 = the piece origin) */
  lowStart?: number;
  /** panel module in metres (x = along, y = up); 0 disables panelling */
  panel?: [number, number];
  /** per-panel tone variation (default 0.34) and seam darkness (default 0.42) */
  panelTone?: number;
  panelSeam?: number;
  /** 0..1 specular polish (black stone = high) */
  gloss?: number;
  /** 0..1 procedural scorch + glowing breaches (carrier, capital wrecks) */
  breach?: number;
  /** Crownmark-arm deck channels: [root half-width, length, z of the root]; enables the procedural gold inlay */
  arm?: [number, number, number];
  /** light arriving from below (terminal glow under a ship), linear RGB */
  underLight?: [number, number, number];
  /** minimum haze-independent visibility of emissive parts (lights punch through haze) */
  glowReach?: number;
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
uniform float uLowStart;
uniform vec2 uPanel;
uniform vec2 uPanelLook;
uniform float uGloss;
uniform float uBreach;
uniform float uGlowReach;
uniform vec3 uUnderLight;
uniform vec4 uArm;
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
  vec3 emisCol = vColor;
  float glow = vGlow;

  // --- panelling in object space: pick the plane by the dominant local normal axis
  if (uPanel.x > 0.0) {
    vec3 an = abs(vLocalNormal);
    vec2 pc = an.y > 0.6 ? vLocal.xz / uPanel.x : (an.x > an.z ? vec2(vLocal.z / uPanel.x, vLocal.y / uPanel.y) : vec2(vLocal.x / uPanel.x, vLocal.y / uPanel.y));
    float fw = max(fwidth(pc.x), fwidth(pc.y));
    float fade = 1.0 - clamp(fw * 2.2, 0.0, 1.0);
    vec2 cell = floor(pc);
    float tone = hash21(cell + floor(dot(vLocalNormal, vec3(1.0, 3.0, 5.0))));
    albedo *= 1.0 + (tone - 0.5) * uPanelLook.x * fade;
    float seam = max(gridLine(pc.x, 0.035), gridLine(pc.y, 0.035));
    albedo *= 1.0 - uPanelLook.y * seam * step(glow, 0.01);
  }

  // --- Crownmark arm: narrow angular gold channels inlaid in the deck (longitudinal lines + chevrons pointing
  //     at the tip), filtered so they dissolve into a faint sheen with distance instead of aliasing
  if (uArm.w > 0.0 && vLocalNormal.y > 0.7 && glow < 0.01) {
    float t = clamp((uArm.z - vLocal.z) / uArm.y, 0.0, 1.0);
    float hw = max(uArm.x * (1.0 - t), 1.0);
    float u = abs(vLocal.x) / hw;
    float along = (uArm.z - vLocal.z) / 150.0;
    float lw = 0.55 / hw;
    float fu = max(fwidth(u), 1e-5);
    float l1 = 1.0 - smoothstep(lw, lw + fu, abs(u - 0.34));
    float l2 = 1.0 - smoothstep(lw, lw + fu, abs(u - 0.70));
    float cv = along + u * 1.6;
    float fc = max(fwidth(cv), 1e-5);
    float chev = (1.0 - smoothstep(0.0035, 0.0035 + fc, abs(fract(cv) - 0.5))) * step(0.34, u) * step(u, 0.70);
    float ch = max(max(l1, l2) * min(1.0, lw / max(fu, lw)), chev * min(1.0, 0.007 / max(fc, 0.007)));
    ch *= step(u, 0.97) * uArm.w;
    albedo = mix(albedo, vec3(1.0, 0.72, 0.36), ch);
    emisCol = vec3(1.0, 0.58, 0.20);
    glow = ch * 1.7;
  }

  // --- battle damage: scorched plating around elongated gashes that glow from within (slow ember pulse)
  vec3 breachGlow = vec3(0.0);
  if (uBreach > 0.0) {
    float b = fbm3(vLocal * vec3(0.034, 0.034, 0.013) + 3.7);
    float edge = 0.80 - 0.12 * uBreach;
    float scorch = smoothstep(edge - 0.15, edge, b);
    float heat = smoothstep(edge, edge + 0.11, b);
    float torn = vnoise(vLocal * 0.22 + 9.0);
    float gash = smoothstep(0.25, 0.75, heat + (torn - 0.5) * 0.5);
    float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + b * 31.0) * sin(uTime * 0.7 + torn * 9.0);
    breachGlow = mix(vec3(0.55, 0.05, 0.01), vec3(1.0, 0.42, 0.10), heat * heat) * (gash * (0.25 + 2.6 * heat * heat) * pulse);
    albedo *= (1.0 - 0.88 * scorch) * (1.0 - 0.9 * gash);
    glow *= 1.0 - scorch;
  }

  // --- lighting: key (white remnant side), fill (red remnant side), sky ambient, a touch of polish
  float ndk = max(dot(n, uKeyDir), 0.0);
  float ndf = max(dot(n, uFillDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = (uHaze * 3.0 + vec3(0.16, 0.17, 0.21)) * uAmbient * mix(0.55, 1.0, hemi);
  vec3 lit = albedo * (uKeyColor * ndk + uFillColor * ndf + ambient + uUnderLight * max(-n.y, 0.0));
  vec3 hv = normalize(uKeyDir + v);
  float spec = pow(max(dot(n, hv), 0.0), mix(18.0, 90.0, uGloss)) * uGloss;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  lit += uKeyColor * spec * 0.35 * step(0.0, dot(n, uKeyDir));
  // polished stone mirrors the sky: haze colour at grazing angles plus a soft image of each remnant
  vec3 rf = reflect(-v, n);
  vec3 env = skyHaze(rf) * (0.25 + 1.4 * fres);
  env += uHazeRed * 4.0 * pow(max(dot(rf, uRedDir), 0.0), 10.0);
  env += uKeyColor * (0.06 * pow(max(dot(rf, uWhiteDir), 0.0), 24.0) + 0.9 * pow(max(dot(rf, uWhiteDir), 0.0), 600.0));
  lit += env * uGloss * (0.35 + 0.65 * fres);

  // --- haze: exponential with distance, thicker below the piece origin (the abyss)
  float low = uLowHaze * clamp((uLowStart - vLocal.y) / uLowDepth, 0.0, 1.0);
  float density = uHazeDensity * uHazeScale * (1.0 + 3.0 * low);
  float f = 1.0 - exp(-dist * density);
  f = max(f, low * low * 0.92);
  vec3 hz = skyHaze(-v);
  vec3 col = mix(lit, hz, f);
  // emissive parts survive haze far longer than surfaces (tiny lights sell the distance)
  vec3 emis = emisCol * glow + breachGlow;
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
      uLowStart: { value: opts.lowStart ?? 0 },
      uPanel: { value: new THREE.Vector2(opts.panel?.[0] ?? 0, opts.panel?.[1] ?? 1) },
      uPanelLook: { value: new THREE.Vector2(opts.panelTone ?? 0.34, opts.panelSeam ?? 0.42) },
      uGloss: { value: opts.gloss ?? 0.3 },
      uBreach: { value: opts.breach ?? 0 },
      uGlowReach: { value: opts.glowReach ?? 0.3 },
      uArm: { value: new THREE.Vector4(opts.arm?.[0] ?? 0, opts.arm?.[1] ?? 1, opts.arm?.[2] ?? 0, opts.arm ? 1 : 0) },
      uUnderLight: { value: new THREE.Vector3(...(opts.underLight ?? [0, 0, 0])) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
    side: THREE.FrontSide,
    fog: false,
  });
}
