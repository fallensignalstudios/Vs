/**
 * Far-field "megastructure" material: one forward shader for everything kilometres away (terminal vista,
 * atrium shell, Crownmark arm, ribs, capital ships, the carrier). Fog-exempt — it carries its own distance haze
 * that dissolves into the exact sky colour behind it (shared `skyHaze`).
 *
 * Lighting is the sky preset's key (white remnant side) and fill (red remnant side) gated by a BAKED per-vertex
 * sky visibility (`aLight.x`), so interiors are not lit through their own walls; enclosed surfaces are lit by a
 * baked warm lamp term (`aLight.y`) from their own seams instead. Polished black stone stays near black and shows
 * an analytic mirror image of the sky (remnants, haze, the Wound's absence). Vertical faces can carry procedural
 * lit openings (`aLight.z`) — the tiny lights that sell the distance.
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
  /** per-panel tone variation (default 0.2) and seam darkness (default 0.4) */
  panelTone?: number;
  panelSeam?: number;
  /** 0..1 specular polish of the darkest surfaces (black stone = high); pale ceramic gets a third of it */
  gloss?: number;
  /** 0..1 procedural scorch + torn, glowing breaches (carrier) */
  breach?: number;
  /** Crownmark-arm deck channels: [root half-width, length, z of the root]; enables the procedural gold inlay */
  arm?: [number, number, number];
  /** light arriving from below (terminal glow under a ship), linear RGB */
  underLight?: [number, number, number];
  /** minimum haze-independent visibility of emissive parts (lights punch through haze) */
  glowReach?: number;
  /** colour × intensity of the baked local lamp term (warm seam light inside enclosed spaces), linear RGB */
  lamp?: [number, number, number];
  /** ambient multiplier where the sky is hidden (0 = black interiors, 1 = no occlusion) */
  shade?: number;
  /** soft light arriving from the piece's +Z side (the viewer's terrace): [r, g, b, falloff distance in metres] */
  nearFill?: [number, number, number, number];
  /** lit openings on flagged vertical faces: [module width, module height (m), brightness] */
  windows?: [number, number, number];
  /** how strongly the fleet battle's light rims the surface (the carrier's underside) */
  battleRim?: number;
  /** 0..1 weathering on pale stone: soot and rain streaks down vertical faces, blotches, darker footings */
  weather?: number;
  /** base sky-ambient colour (linear, before the preset haze and ambient scale); default a cool grey */
  ambientTint?: [number, number, number];
  name?: string;
}

const VERTEX = /* glsl */ `
attribute float aGlow;
attribute vec4 aLight;
attribute vec2 aUv;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vLocalNormal;
varying vec3 vColor;
varying float vGlow;
varying vec4 vLight;
varying vec2 vUv;
varying vec3 vViewLocal;
void main() {
  #ifdef USE_INSTANCING
    mat4 mm = modelMatrix * instanceMatrix;
  #else
    mat4 mm = modelMatrix;
  #endif
  vec4 wp = mm * vec4(position, 1.0);
  // view direction in the piece's local frame (rotation + uniform scale only, so the transpose is enough)
  vViewLocal = transpose(mat3(mm)) * (cameraPosition - wp.xyz);
  vWorld = wp.xyz;
  vLocal = position;
  vLocalNormal = normal;
  vNormal = normalize(mat3(mm) * normal);
  vColor = color;
  vGlow = aGlow;
  vLight = aLight;
  vUv = aUv;
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
varying vec4 vLight;
varying vec2 vUv;
varying vec3 vViewLocal;
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
uniform vec3 uLamp;
uniform float uShade;
uniform vec4 uNearFill;
uniform vec3 uWindows;
uniform vec4 uArm;
uniform vec4 uBodies;
uniform vec3 uBattleGlow;
uniform vec3 uBattleDir;
uniform float uBattleRim;
uniform vec3 uFlashPos;
uniform vec3 uFlashColor;
uniform float uTime;
uniform float uWeather;
uniform vec3 uAmbTint;
${GLSL_NOISE}
${GLSL_HAZE}

// filtered grid line: 1 on the line, fades to the line's average coverage when the module is sub-pixel
float gridLine(float x, float w) {
  float fw = max(fwidth(x), 1e-5);
  float toLine = 0.5 - abs(fract(x) - 0.5);
  float l = 1.0 - smoothstep(w - fw, w + fw, toLine);
  return mix(l, 2.0 * w, clamp(fw * 1.8, 0.0, 1.0));
}

// The sky as a polished surface sees it — no noise, just the things that read in a reflection: the horizon glow,
// the red remnant and its nebula, the white remnant's pinpoint, and the Wound, which returns nothing at all.
vec3 skyLite(vec3 d) {
  vec3 c = skyHaze(d) * (0.30 + 0.90 * exp(-max(d.y, 0.0) * 4.0));
  float ar = acos(clamp(dot(d, uRedDir), -1.0, 1.0)) / max(uBodies.z, 1e-3);
  c += vec3(1.7, 0.15, 0.045) * uBodies.w * (smoothstep(1.12, 0.9, ar) + 0.14 * exp(-max(ar - 1.0, 0.0) * 1.7));
  float cw = max(dot(d, uWhiteDir), 0.0);
  c += uKeyColor * (pow(cw, 3000.0) * 7.0 + pow(cw, 240.0) * 0.07);
  float aw = acos(clamp(dot(d, uWoundDir), -1.0, 1.0)) / max(uBodies.x, 1e-3);
  c *= 1.0 - uBodies.y * smoothstep(1.3, 0.92, aw);
  return c;
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
  float skyVis = vLight.x;
  float wall = 1.0 - smoothstep(0.35, 0.6, abs(vLocalNormal.y));
  vec2 tilt = vec2(0.0);

  // --- panelling from the baked surface coordinates (metres)
  if (uPanel.x > 0.0 && vLight.w > 0.01) {
    vec2 pc = vUv / uPanel;
    float fw = max(fwidth(pc.x), fwidth(pc.y));
    float fade = (1.0 - clamp(fw * 2.2, 0.0, 1.0)) * vLight.w;
    vec2 cell = floor(pc);
    float tone = hash21(cell + floor(dot(vLocalNormal, vec3(1.0, 3.0, 5.0)) + 0.5));
    albedo *= 1.0 + (tone - 0.5) * uPanelLook.x * fade;
    float seam = max(gridLine(pc.x, 0.03), gridLine(pc.y, 0.03));
    albedo *= 1.0 - uPanelLook.y * seam * step(glow, 0.01) * vLight.w;
    tilt = (vec2(tone, hash21(cell + 31.7)) - 0.5) * fade;
  }

  // --- weathering: pale ceramic-stone is old — soot and rain streaks run down its faces, blotches gather, footings
  //     darken. Filtered by footprint so it fades to its average instead of shimmering kilometres away.
  if (uWeather > 0.0 && glow < 0.01) {
    float lumA = dot(albedo, vec3(0.3, 0.55, 0.15));
    float pale = smoothstep(0.12, 0.40, lumA);
    vec3 sp = vec3(vLocal.x * 0.30, vLocal.y * 0.016, vLocal.z * 0.30);
    float fws = max(fwidth(sp.x) + fwidth(sp.z), fwidth(sp.y) * 6.0);
    float fade = 1.0 - clamp(fws * 1.6 - 0.2, 0.0, 1.0);
    float streak = mix(0.5, vnoise(sp + 3.0), fade);
    float blot = vnoise(vLocal * 0.035 + 11.0);
    float grime = 0.6 * smoothstep(0.38, 0.82, streak) * wall + 0.4 * smoothstep(0.42, 0.85, blot);
    albedo *= 1.0 - uWeather * pale * (0.10 + 0.32 * grime);
    // a faint warm patina on the pale stone (ivory, never blue-white)
    albedo = mix(albedo, albedo * vec3(1.04, 0.99, 0.90), uWeather * pale * 0.6);
  }

  // --- lit openings: tall narrow slits in a regular module, some dark; dissolve into an even glow when sub-pixel
  vec3 windowGlow = vec3(0.0);
  if (uWindows.z > 0.0 && vLight.z > 0.004 && wall > 0.0) {
    vec2 wuv = vUv / uWindows.xy;
    vec2 wc = floor(wuv), wf = fract(wuv);
    float fw = max(fwidth(wuv.x), fwidth(wuv.y));
    float h = hash21(wc + 7.3);
    // light gathers in a few vertical runs and leaves most of a face dark: seams of information, not office blocks
    float run = step(0.70, hash11(wc.x * 1.37 + floor(dot(vLocalNormal, vec3(2.0, 0.0, 5.0)) + 0.5) * 17.0));
    float level = vLight.z * mix(0.14, 1.25, run);
    float on = step(h, level);
    float sx = 1.0 - smoothstep(0.07, 0.07 + fw, abs(wf.x - 0.5));
    float sy = smoothstep(0.12 - fw, 0.12, wf.y) * (1.0 - smoothstep(0.86, 0.86 + fw, wf.y));
    float shape = mix(sx * sy * on, 0.10 * vLight.z * 0.47, clamp(fw * 1.6 - 0.3, 0.0, 1.0));
    float warm = hash21(wc + 91.0);
    windowGlow = mix(vec3(1.0, 0.62, 0.26), vec3(1.0, 0.83, 0.55), warm) * shape * uWindows.z * (0.55 + 0.9 * h) * wall;
    albedo *= 1.0 - 0.6 * sx * sy * wall * (1.0 - clamp(fw * 1.6, 0.0, 1.0));
  }

  // --- Crownmark arm: narrow angular gold channels inlaid in the deck (longitudinal lines + chevrons pointing
  //     at the tip), filtered so they dissolve into a faint sheen with distance instead of aliasing
  if (uArm.w > 0.0 && vLocalNormal.y > 0.7 && glow < 0.01 && vLight.w > 0.5) {
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
    emisCol = mix(emisCol, vec3(1.0, 0.58, 0.20), step(0.001, ch));
    glow = ch * 1.5;
  }

  // --- battle damage: long tears along the hull with charred lips; the cavity behind glows from embers deep
  //     inside (parallax against the view), not from the surface
  vec3 breachGlow = vec3(0.0);
  if (uBreach > 0.0) {
    vec3 bp = vLocal * vec3(0.030, 0.045, 0.0085);
    float warp = vnoise(vLocal * 0.012 + 5.0);
    float b = fbm3(bp + warp * 0.9 + 3.7);
    float edge = 0.79 - 0.10 * uBreach;
    float rag = (vnoise(vLocal * vec3(0.35, 0.35, 0.10) + 9.0) - 0.5) * 0.07;
    float hole = smoothstep(edge + 0.035, edge + 0.05, b + rag);
    float lip = smoothstep(edge - 0.02, edge + 0.035, b + rag) * (1.0 - hole);
    float scorch = smoothstep(edge - 0.19, edge + 0.01, b);
    // look INTO the hole: sample ember structure a few metres behind the plating along the view ray
    vec3 vl = normalize(vViewLocal);
    vec3 inside = vLocal - vl * (9.0 / max(dot(vl, normalize(vLocalNormal)), 0.25));
    float decks = smoothstep(0.42, 0.5, abs(fract(inside.y / 7.0) - 0.5)) ;
    float ember = fbm3(inside * vec3(0.10, 0.10, 0.035) + 17.0);
    float pulse = 0.8 + 0.2 * sin(uTime * 0.9 + ember * 23.0);
    vec3 fire = mix(vec3(0.45, 0.035, 0.008), vec3(1.25, 0.46, 0.10), smoothstep(0.45, 0.85, ember)) * smoothstep(0.30, 0.75, ember) * pulse;
    breachGlow = hole * fire * (1.0 - 0.75 * decks) * 2.6 + lip * vec3(0.9, 0.16, 0.03) * 0.5 * smoothstep(0.5, 0.9, ember);
    albedo *= (1.0 - 0.86 * scorch) * (1.0 - hole);
    glow *= 1.0 - scorch;
    windowGlow *= 1.0 - scorch;
    skyVis *= 1.0 - hole;
  }

  // --- lighting: key + fill where the sky reaches, hemisphere ambient, baked warm lamp light where it does not
  float ndk = max(dot(n, uKeyDir), 0.0);
  float ndf = max(dot(n, uFillDir), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = (uHaze * 3.0 + uAmbTint) * uAmbient * mix(0.55, 1.0, hemi) * mix(uShade, 1.0, skyVis);
  float lum = dot(albedo, vec3(0.3, 0.55, 0.15));
  // mirror-polished black stone: almost no diffuse response, the reflection carries it
  float polish = uGloss * mix(1.0, 0.33, smoothstep(0.02, 0.22, lum));
  // the red remnant's fill is mostly desaturated and fades fast where the sky is only partly visible: it warms
  // the far side of a tower, it must never repaint ivory as brick or pink
  vec3 fill = mix(vec3(dot(uFillColor, vec3(0.3, 0.55, 0.15))), uFillColor, 0.3);
  vec3 direct = (uKeyColor * ndk + fill * ndf * skyVis) * skyVis;
  vec3 lamp = uLamp * vLight.y;
  // soft light from the viewer's own terrace: both remnants sit behind the vista, so without it every near
  // tower would show the viewer only its shadow side
  vec3 nearFill = uNearFill.rgb * (clamp(dot(n, vec3(0.0, 0.33, 0.944)) * 0.6 + 0.4, 0.0, 1.0) * exp(-length(vLocal) / max(uNearFill.a, 1.0)));
  vec3 lit = albedo * (direct * (1.0 - 0.55 * polish) + ambient + lamp + nearFill + uUnderLight * max(-n.y, 0.0));
  // the fleet battle rims surfaces that face it (wrapped so the whole underside of a hull catches it)
  float rim = clamp((dot(n, uBattleDir) + 0.6) / 1.6, 0.0, 1.0);
  lit += albedo * uBattleGlow * (uBattleRim * rim * rim * 6.0);

  // transient point light (the carrier's contact flash)
  if (uFlashColor.r + uFlashColor.g + uFlashColor.b > 0.0) {
    vec3 fl = uFlashPos - vWorld;
    float fd2 = dot(fl, fl);
    lit += albedo * uFlashColor * ((max(dot(n, fl) * inversesqrt(fd2 + 1.0), 0.0) * 0.75 + 0.25) / (1.0 + fd2 / 6400.0));
  }

  vec3 hv = normalize(uKeyDir + v);
  float spec = pow(max(dot(n, hv), 0.0), mix(24.0, 220.0, polish)) * (0.25 + 1.6 * polish);
  lit += uKeyColor * spec * 0.4 * skyVis * step(0.0, dot(n, uKeyDir));
  // reflection: each slab tilts a hair differently, which is what makes a polished floor read as laid stone
  vec3 nr = normalize(n + vec3(tilt.x, 0.0, tilt.y) * 0.035 * polish);
  float fres = 0.07 + 0.93 * pow(1.0 - max(dot(nr, v), 0.0), 5.0);
  vec3 rf = reflect(-v, nr);
  rf.y = abs(rf.y) * step(0.5, n.y) + rf.y * (1.0 - step(0.5, n.y)); // a floor cannot reflect what is below it
  // (a surface only mirrors the sky it can see: gallery interiors must not pick up the red remnant through a wall)
  lit += skyLite(rf) * fres * polish * skyVis * skyVis + lamp * fres * polish * 0.6;

  // --- haze: exponential with distance, thicker below the piece origin (the abyss)
  float low = uLowHaze * clamp((uLowStart - vLocal.y) / uLowDepth, 0.0, 1.0);
  float density = uHazeDensity * uHazeScale * (1.0 + 3.0 * low);
  float f = 1.0 - exp(-dist * density);
  f = max(f, low * low * 0.92);
  vec3 hz = skyHaze(-v);
  vec3 col = mix(lit, hz, f);
  // emissive parts survive haze far longer than surfaces (tiny lights sell the distance)
  vec3 emis = emisCol * glow + windowGlow + breachGlow;
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
      uBodies: shared.uBodies, uBattleGlow: shared.uBattleGlow, uBattleDir: shared.uBattleDir,
      uFlashPos: shared.uFlashPos, uFlashColor: shared.uFlashColor,
      uHazeScale: { value: opts.haze ?? 1 },
      uLowHaze: { value: opts.lowHaze ?? 0 },
      uLowDepth: { value: opts.lowDepth ?? 400 },
      uLowStart: { value: opts.lowStart ?? 0 },
      uPanel: { value: new THREE.Vector2(opts.panel?.[0] ?? 0, opts.panel?.[1] ?? 1) },
      uPanelLook: { value: new THREE.Vector2(opts.panelTone ?? 0.2, opts.panelSeam ?? 0.4) },
      uGloss: { value: opts.gloss ?? 0.3 },
      uBreach: { value: opts.breach ?? 0 },
      uGlowReach: { value: opts.glowReach ?? 0.3 },
      uArm: { value: new THREE.Vector4(opts.arm?.[0] ?? 0, opts.arm?.[1] ?? 1, opts.arm?.[2] ?? 0, opts.arm ? 1 : 0) },
      uUnderLight: { value: new THREE.Vector3(...(opts.underLight ?? [0, 0, 0])) },
      uLamp: { value: new THREE.Vector3(...(opts.lamp ?? [0, 0, 0])) },
      uShade: { value: opts.shade ?? 1 },
      uNearFill: { value: new THREE.Vector4(...(opts.nearFill ?? [0, 0, 0, 1])) },
      uWindows: { value: new THREE.Vector3(...(opts.windows ?? [1, 1, 0])) },
      uBattleRim: { value: opts.battleRim ?? 0 },
      uWeather: { value: opts.weather ?? 0 },
      uAmbTint: { value: new THREE.Vector3(...(opts.ambientTint ?? [0.16, 0.17, 0.21])) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
    side: THREE.FrontSide,
    fog: false,
  });
}
