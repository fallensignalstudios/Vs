/**
 * Engine light for the generated ships, whose textures have no emissive map:
 *  - `buildGlow()` — every glow element of a ship (catalog.ts) in ONE additive mesh (one draw call). Flat discs,
 *    crown rings and bars sit on the hull facing their axis; halos face the camera and never shrink below
 *    `minPx` pixels (energy-compensated, so a capital kilometres away still shows its engines as points); plumes
 *    stretch out of the nozzles with the engine level and turn about their axis to face the camera.
 *  - `patchHull()` — the hull material: the colour map's own glowing texels (amber for the Dominion, blue-white
 *    for the Reformation, the same thresholds the forge used to find the engines) become emissive with the engine
 *    level; a roughness floor and a lower environment intensity keep the very metallic files from reading chrome;
 *    optional distance haze toward the sky colour for far-field ships (fog-exempt, like every scenic piece).
 */
import * as THREE from 'three';
import { expandGlow, type GlowShape, type ShipModelSpec } from './catalog';

const SHAPE: Record<GlowShape, number> = { disc: 0, ring: 1, bar: 2, halo: 3, plume: 4 };

/** Distance haze shared with the sky (scenic far-field ships). `glsl` must define `vec3 skyHaze(vec3 dir)`. */
export interface ShipHaze {
  /** uniforms the GLSL reads (shared by reference so preset changes reach the ship) + `uHazeDensity` */
  uniforms: Record<string, THREE.IUniform>;
  glsl: string;
  /** multiplier on the haze density (default 1) */
  scale?: number;
}

export interface GlowUniforms {
  uEngine: { value: number };
  uLights: { value: number };
  uTime: { value: number };
  uMinPx: { value: number };
  uViewH: { value: number };
  uHazeDensity: { value: number };
  uHazeScale: { value: number };
}

const VERTEX = /* glsl */ `
attribute vec2 aCorner;
attribute vec3 aAxis;
attribute vec3 aTan;
attribute vec2 aSize;
attribute vec3 aColor;
attribute vec2 aMeta;
uniform float uEngine;
uniform float uLights;
uniform float uTime;
uniform float uMinPx;
uniform float uViewH;
uniform float uHazeDensity;
uniform float uHazeScale;
varying vec2 vQ;
varying vec3 vCol;
varying float vShape;
void main() {
  int shape = int(aMeta.x + 0.5);
  vQ = aCorner;
  vShape = aMeta.x;
  vec3 ax = normalize(aAxis);
  vec4 mvC = modelViewMatrix * vec4(position, 1.0);
  float scl = length(modelMatrix[0].xyz) * length(viewMatrix[0].xyz);
  vec3 toCam = normalize(-mvC.xyz);
  vec3 axV = normalize((modelViewMatrix * vec4(ax, 0.0)).xyz);
  float facing = dot(axV, toCam);
  float flick = 1.0 + 0.06 * sin(uTime * 29.0 + position.x * 91.0) * sin(uTime * 11.3 + position.z * 57.0);
  float level = aMeta.y > 0.5 ? uLights * (0.75 + 0.25 * sin(uTime * 1.9 + position.x * 37.0)) : uEngine * flick;
  float comp = 1.0;
  vec3 pv;
  if (shape <= 2) {
    vec3 t = aTan - ax * dot(aTan, ax);
    t = length(t) > 1e-4 ? normalize(t) : normalize(abs(ax.y) < 0.9 ? cross(ax, vec3(0.0, 1.0, 0.0)) : cross(ax, vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(ax, t);
    vec3 lp = position + t * aCorner.x * aSize.x * 0.5 + b * aCorner.y * aSize.y * 0.5 + ax * aSize.y * 0.04;
    pv = (modelViewMatrix * vec4(lp, 1.0)).xyz;
    // a flat glow seen from behind its surface is hidden by the hull; seen from the front it is brightest
    level *= 0.25 + 0.75 * smoothstep(-0.05, 0.4, facing);
  } else if (shape == 3) {
    float dist = max(-mvC.z, 0.01);
    float mpp = 2.0 * dist / (projectionMatrix[1][1] * max(uViewH, 1.0));
    float w = aSize.x * scl;
    float wc = max(w, uMinPx * mpp);
    comp = clamp((w * w) / (wc * wc), 0.04, 1.0);
    // lift the sprite toward the camera so the hull it sits on does not cut it in half
    pv = mvC.xyz + toCam * min(w * 0.6, dist * 0.3) + vec3(aCorner * wc * 0.5, 0.0);
    level *= 0.3 + 0.7 * smoothstep(-0.3, 0.6, facing);
  } else {
    vec3 side = cross(axV, toCam);
    side = length(side) > 1e-3 ? normalize(side) : vec3(1.0, 0.0, 0.0);
    float u = aCorner.x * 0.5 + 0.5;
    float len = aSize.x * scl * (0.2 + 0.8 * clamp(uEngine, 0.0, 1.5));
    pv = mvC.xyz + axV * u * len + side * aCorner.y * aSize.y * scl * 0.5 * (1.0 - 0.55 * u);
    // a plume seen straight down its axis collapses to a point: fade it rather than flash; parked engines
    // (level ≲ 0.15) only smoulder in their throats, no flame
    level *= (1.0 - 0.8 * abs(facing)) * smoothstep(0.15, 0.55, uEngine);
  }
  gl_Position = projectionMatrix * vec4(pv, 1.0);
  float haze = uHazeDensity > 0.0 ? max(exp(-length(pv) * uHazeDensity * uHazeScale * 0.4), 0.15) : 1.0;
  vCol = aColor * max(level, 0.0) * haze * sqrt(comp);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
varying float vShape;
void main() {
  float r = length(vQ);
  float a;
  if (vShape < 0.5) {
    a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.8, 1.0, r));
  } else if (vShape < 1.5) {
    float ang = atan(vQ.y, vQ.x);
    float hoop = exp(-pow((r - 0.6) / 0.085, 2.0));
    float tines = pow(max(cos(ang * 8.0), 0.0), 10.0) * smoothstep(0.6, 0.7, r) * (1.0 - smoothstep(0.8, 0.97, r));
    a = hoop + 0.85 * tines + 0.2 * exp(-r * r * 7.0);
  } else if (vShape < 2.5) {
    float ax = abs(vQ.x), ay = abs(vQ.y);
    a = exp(-ay * ay * 2.6) * (1.0 - smoothstep(0.75, 1.0, ax)) * (1.0 - smoothstep(0.75, 1.0, ay));
  } else if (vShape < 3.5) {
    a = exp(-r * r * 4.2) * (1.0 - smoothstep(0.7, 1.0, r));
  } else {
    float u = vQ.x * 0.5 + 0.5, v = abs(vQ.y);
    a = exp(-v * v * 3.5) * pow(1.0 - u, 1.7) * smoothstep(0.0, 0.06, u);
  }
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _c = new THREE.Color();
const _v2 = new THREE.Vector2();

/** The additive glow mesh of one ship, in raw file units (child of the same frame as the hull). */
export function buildGlow(spec: ShipModelSpec, opts: { minPx?: number; haze?: ShipHaze; engines?: number; lights?: number } = {}): { mesh: THREE.Mesh; uniforms: GlowUniforms } {
  const els = expandGlow(spec);
  const n = els.length;
  const pos = new Float32Array(n * 12), corner = new Float32Array(n * 8), axis = new Float32Array(n * 12), tan = new Float32Array(n * 12);
  const size = new Float32Array(n * 8), color = new Float32Array(n * 12), meta = new Float32Array(n * 8);
  const index: number[] = [];
  const C: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const box = new THREE.Box3();
  els.forEach((e, i) => {
    _c.setHex(e.color).multiplyScalar(e.intensity);
    const t = e.tan ?? (Math.abs(e.axis[1]) < 0.9 ? [e.axis[2], 0, -e.axis[0]] : [1, 0, 0]);
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      pos.set(e.p, v * 3);
      corner.set(C[k], v * 2);
      axis.set(e.axis, v * 3);
      tan.set(t, v * 3);
      size.set(e.size, v * 2);
      color.set([_c.r, _c.g, _c.b], v * 3);
      meta.set([SHAPE[e.shape], e.group ?? 0], v * 2);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    box.expandByPoint(new THREE.Vector3(...e.p));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3));
  g.setAttribute('aTan', new THREE.BufferAttribute(tan, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 2));
  g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aMeta', new THREE.BufferAttribute(meta, 2));
  g.setIndex(index);
  // plumes and halos reach well outside the points: bound generously (the hull is ~1 raw unit long)
  g.boundingSphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere());
  g.boundingSphere.radius += 0.6;
  const hazeDensity = opts.haze?.uniforms.uHazeDensity as { value: number } | undefined;
  const uniforms: GlowUniforms = {
    uEngine: { value: opts.engines ?? 1 },
    uLights: { value: opts.lights ?? 1 },
    uTime: { value: 0 },
    uMinPx: { value: opts.minPx ?? 0 },
    uViewH: { value: 720 },
    uHazeDensity: hazeDensity ?? { value: 0 },
    uHazeScale: { value: opts.haze?.scale ?? 1 },
  };
  const material = new THREE.ShaderMaterial({
    name: `ship:${spec.id}:glow`,
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = `ship:${spec.id}:glow`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.onBeforeRender = (renderer) => {
    uniforms.uTime.value = shipClock();
    const r = renderer as THREE.WebGLRenderer;
    if (typeof r.getDrawingBufferSize === 'function') {
      const target = r.getRenderTarget?.();
      uniforms.uViewH.value = target ? target.height : r.getDrawingBufferSize(_v2).y;
    }
  };
  return { mesh, uniforms };
}

/** cosmetic flicker clock (seconds) */
function shipClock(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

export interface HullUniforms {
  uShipEmis: { value: number };
  uShipMinRough: { value: number };
  /** ADDED (polish pass 4): the hull look's live values (see {@link HullLook}) */
  uShipTint: { value: THREE.Vector3 };
  uShipDesat: { value: number };
  uShipMaxMetal: { value: number };
  uShipRim: { value: THREE.Vector3 };
  uShipFill: { value: THREE.Vector3 };
}

/**
 * ADDED (polish pass 4): how a hull reads on screen, independent of the scene's lights. The files are dark,
 * glossy and partly metallic: against a night sky, lit only by a far key, they read as black silhouettes with glow.
 *  - `tint` / `desat`: grade the colour map (linear multiplier; 0..1 toward its own luminance) — e.g. the shuttle's
 *    weathered tan bronze instead of dark brown;
 *  - `maxMetal`: cap the metalness so the hull answers the key and the fill with diffuse light, not only with
 *    reflections of a dark environment;
 *  - `rim`: a fresnel edge light (linear RGB × strength) that draws the form against the sky;
 *  - `fill`: a sky hemisphere fill (linear RGB × strength, brightest on up-facing plates) — the environment it flies in.
 */
export interface HullLook {
  tint?: readonly [number, number, number];
  desat?: number;
  maxMetal?: number;
  rim?: readonly [number, number, number];
  fill?: readonly [number, number, number];
}

/**
 * ADDED (polish pass 4): extra shading for one hull — `glsl` (declarations) goes after `<common>`, `body` runs after
 * the emissive map with `vShipLocal` (object-space position, raw file units), `vShipWorldN` (world normal),
 * `vShipWorldP` (world position), `normal`
 * (view space), `diffuseColor` and `totalEmissiveRadiance` in scope. `key` distinguishes the program.
 */
export interface HullShade {
  key: string;
  uniforms: Record<string, THREE.IUniform>;
  glsl: string;
  body: string;
}

const v3 = (t: readonly [number, number, number] | undefined, d: number): THREE.Vector3 => new THREE.Vector3(t?.[0] ?? d, t?.[1] ?? d, t?.[2] ?? d);

/**
 * Clone the template material for one ship: emissive engine texels, a roughness floor, softer environment
 * reflections, the hull look ({@link HullLook}), optional far-field haze and optional extra shading.
 */
export function patchHull(
  base: THREE.MeshStandardMaterial,
  mask: 'amber' | 'blue',
  opts: { haze?: ShipHaze; minRough?: number; envIntensity?: number; look?: HullLook; shade?: HullShade } = {},
): { material: THREE.MeshStandardMaterial; uniforms: HullUniforms } {
  const m = base.clone();
  m.name = `ship:hull:${mask}${opts.haze ? ':far' : ''}`;
  m.envMapIntensity = opts.envIntensity ?? 0.5;
  m.fog = !opts.haze;
  const look = opts.look ?? {};
  const uniforms: HullUniforms = {
    uShipEmis: { value: 0 }, uShipMinRough: { value: opts.minRough ?? 0.4 },
    uShipTint: { value: v3(look.tint, 1) }, uShipDesat: { value: look.desat ?? 0 }, uShipMaxMetal: { value: look.maxMetal ?? 1 },
    uShipRim: { value: v3(look.rim, 0) }, uShipFill: { value: v3(look.fill, 0) },
  };
  const haze = opts.haze;
  const extra = opts.shade;
  m.onBeforeCompile = (shader) => {
    for (const [k, u] of Object.entries(uniforms)) shader.uniforms[k] = u;
    if (extra) for (const [k, u] of Object.entries(extra.uniforms)) shader.uniforms[k] = u;
    const local = !!extra;
    if (local) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vShipLocal;\nvarying vec3 vShipWorldN;\nvarying vec3 vShipWorldP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvShipLocal = transformed;\n\tvShipWorldN = normalize(mat3(modelMatrix) * objectNormal);\n\tvShipWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    }
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uShipEmis;
uniform float uShipMinRough;
uniform vec3 uShipTint;
uniform float uShipDesat;
uniform float uShipMaxMetal;
uniform vec3 uShipRim;
uniform vec3 uShipFill;
${local ? 'varying vec3 vShipLocal;\nvarying vec3 vShipWorldN;\nvarying vec3 vShipWorldP;' : ''}
${extra ? extra.glsl : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	vec3 shipTex = diffuseColor.rgb;
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), uShipDesat) * uShipTint;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = max(roughnessFactor, uShipMinRough);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor = min(metalnessFactor, uShipMaxMetal);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	{
		// the colour map's own engine texels (forge thresholds, linear, before the look's grade): ${mask}
		vec3 tc = shipTex;
		${mask === 'amber'
          ? 'float glowMask = smoothstep(0.55, 0.75, tc.r) * smoothstep(0.12, 0.22, tc.g) * (1.0 - smoothstep(0.2, 0.32, tc.b)) * smoothstep(0.4, 0.55, tc.r - tc.b);'
          : 'float glowMask = smoothstep(0.55, 0.75, tc.b) * smoothstep(0.42, 0.56, tc.g) * smoothstep(0.0, 0.03, tc.b - tc.r);'}
		totalEmissiveRadiance += tc * glowMask * uShipEmis;
		// the hull look: a fresnel rim and a sky hemisphere fill (both scene-independent)
		vec3 shipV = normalize(vViewPosition);
		float shipFres = pow(1.0 - clamp(dot(normal, shipV), 0.0, 1.0), 3.0);
		float shipHemi = 0.5 + 0.5 * dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
		totalEmissiveRadiance += uShipRim * shipFres * (0.4 + 0.6 * shipHemi) + diffuseColor.rgb * uShipFill * (0.35 + 0.65 * shipHemi);
		${extra ? extra.body : ''}
	}`);
    if (haze) {
      for (const [k, u] of Object.entries(haze.uniforms)) shader.uniforms[k] = u;
      shader.uniforms.uShipHazeScale = { value: haze.scale ?? 1 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vShipWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n\tvShipWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      frag = frag
        .replace('#include <common>', `#include <common>\nvarying vec3 vShipWorld;\nuniform float uHazeDensity;\nuniform float uShipHazeScale;\n${haze.glsl}`)
        .replace('#include <tonemapping_fragment>', `{
		vec3 hd = vShipWorld - cameraPosition;
		float hdist = length(hd);
		float hf = 1.0 - exp(-hdist * uHazeDensity * uShipHazeScale);
		gl_FragColor.rgb = mix(gl_FragColor.rgb, skyHaze(hd / max(hdist, 1e-3)), hf);
	}
	#include <tonemapping_fragment>`);
    }
    shader.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `ship:${mask}:${haze ? 'far' : 'near'}:${extra ? extra.key : '-'}`;
  return { material: m, uniforms };
}
