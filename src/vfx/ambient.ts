/**
 * Ambient volumes — drifting zone dressing (dust, embers, frost / violet / gold motes, ash, snow).
 * Entirely GPU animated: each volume is one instanced draw whose particles live in a window that wraps around
 * the camera and is clamped inside the volume box, so a huge hall costs the same as a corridor.
 */
import * as THREE from 'three';
import type { AmbientKind, Vec3Like, VfxHandle } from '@/core/api';
import { ATLAS_COLS, ATLAS_ROWS, spriteIndex } from './atlas';
import type { SpriteName } from './atlas';

interface KindDef {
  sprite: SpriteName;
  color: number;
  intensity: number;
  /** quad size, metres */
  size: number;
  /** particles in a full camera window at density 1 */
  count: number;
  drift: readonly [number, number, number];
  sway: number;
  swayFreq: number;
  twinkle: number;
  twinkleFreq: number;
  spin: number;
  /** sway phase shared by all particles (they move together) */
  unison: boolean;
  additive: boolean;
  /** camera distance (m) over which particles fade in: [gone, full]; default [0.5, 1.8] */
  near?: readonly [number, number];
}

const KINDS: Record<AmbientKind, KindDef> = {
  embers: { sprite: 'ember', color: 0xff7a2a, intensity: 5, size: 0.065, count: 520, drift: [0.06, 0.42, 0.03], sway: 0.35, swayFreq: 0.7, twinkle: 0.7, twinkleFreq: 5, spin: 1.5, unison: false, additive: true },
  dust: { sprite: 'dot', color: 0xe8dcc8, intensity: 0.55, size: 0.042, count: 1000, drift: [0.03, 0.012, 0.02], sway: 0.16, swayFreq: 0.25, twinkle: 0.5, twinkleFreq: 0.6, spin: 0, unison: false, additive: true },
  frostMotes: { sprite: 'star', color: 0xcfeeff, intensity: 2.4, size: 0.075, count: 520, drift: [0, -0.012, 0], sway: 0.03, swayFreq: 0.2, twinkle: 0.85, twinkleFreq: 0.9, spin: 0.1, unison: false, additive: true },
  violetMotes: { sprite: 'dot', color: 0x8a4cff, intensity: 3, size: 0.07, count: 300, drift: [0, 0.04, 0], sway: 0.4, swayFreq: 0.55, twinkle: 0.35, twinkleFreq: 1.3, spin: 0, unison: true, additive: true },
  ash: { sprite: 'chip0', color: 0x1c1a19, intensity: 1, size: 0.075, count: 560, drift: [0.12, -0.32, 0.05], sway: 0.4, swayFreq: 0.5, twinkle: 0, twinkleFreq: 1, spin: 1.4, unison: false, additive: false },
  // (fix & ship) soft round motes with a falloff, smaller and sparser, and none close to the lens: the outlined diamond
  // read as square orange confetti
  goldMotes: { sprite: 'dot', color: 0xffc56b, intensity: 2.4, size: 0.045, count: 300, drift: [0, 0.07, 0], sway: 0.1, swayFreq: 0.3, twinkle: 0.6, twinkleFreq: 0.8, spin: 0, unison: false, additive: true, near: [1.6, 4.5] },
  snow: { sprite: 'dot', color: 0xf2f7ff, intensity: 1.1, size: 0.065, count: 1200, drift: [0.18, -0.6, 0.06], sway: 0.3, swayFreq: 0.6, twinkle: 0.2, twinkleFreq: 1, spin: 0, unison: false, additive: true },
};

/** camera window (metres) the particles wrap inside */
const WINDOW = new THREE.Vector3(18, 10, 18);
const MAX_PER_VOLUME = 2400;

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uHalf;
uniform vec3 uWrap;
uniform vec3 uDrift;
uniform vec4 uMotion; // sway amp, sway freq, twinkle depth, twinkle freq
uniform vec3 uLook;   // size, spin, unison
uniform vec2 uNear;   // camera distance where particles are gone, fully faded in
uniform float uTime;
uniform float uFrame;
uniform vec2 uGrid;
uniform float uPixel;
varying vec2 vUv;
varying float vAlpha;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  float ph = mix(aSeed.w * 43.0, 0.0, uLook.z);
  vec3 p = aSeed.xyz * uWrap + uDrift * uTime * (0.6 + 0.8 * aSeed.w);
  float w = uTime * uMotion.y;
  p += vec3(sin(w * 1.31 + ph), sin(w * 1.07 + ph * 1.9 + 1.3) * 0.6, cos(w * 1.19 + ph * 1.3)) * uMotion.x;
  // window anchored at the camera but kept inside the volume
  vec3 lo = uCenter - uHalf + uWrap * 0.5, hi = uCenter + uHalf - uWrap * 0.5;
  vec3 anchor = clamp(cameraPosition, min(lo, hi), max(lo, hi));
  vec3 q = fract((p - anchor) / uWrap + 0.5) - 0.5;
  vec3 world = anchor + q * uWrap;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  float dist = -mvPosition.z;
  float size = uLook.x * (0.55 + 0.9 * fract(aSeed.w * 7.31));
  float minSize = dist * uPixel * 1.5;
  float shrink = clamp(size / max(minSize, 1e-5), 0.0, 1.0);
  size = max(size, minSize);
  float rot = aSeed.w * 6.2831853 + uTime * uLook.y * (aSeed.x - 0.5) * 2.0;
  float cr = cos(rot), sr = sin(rot);
  vec2 c = position.xy;
  mvPosition.xy += vec2(cr * c.x - sr * c.y, sr * c.x + cr * c.y) * size;
  gl_Position = projectionMatrix * mvPosition;
  vec2 cell = vec2(mod(uFrame, uGrid.x), floor(uFrame / uGrid.x));
  vUv = (cell + uv) / uGrid;
  vec3 e = abs(q) * 2.0;
  float edge = 1.0 - smoothstep(0.72, 1.0, max(e.x, max(e.y, e.z)));
  float nearFade = smoothstep(uNear.x, uNear.y, dist);
  float tw = 1.0 - uMotion.z * (0.5 + 0.5 * sin(uTime * uMotion.w + aSeed.w * 91.0));
  vAlpha = edge * nearFade * tw * shrink * shrink;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uColor;
uniform float uFade;
varying vec2 vUv;
varying float vAlpha;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec4 tex = texture2D(uAtlas, vUv);
  float a = tex.a * vAlpha * uFade;
  if (a < 0.003) discard;
  float fogFactor = 0.0;
#ifdef USE_FOG
  #ifdef FOG_EXP2
    fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
#ifdef ADDITIVE
  gl_FragColor = vec4(uColor * tex.rgb * a * (1.0 - fogFactor), 1.0);
#else
  gl_FragColor = vec4(uColor * tex.rgb * a, a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _c = new THREE.Color();

class Volume implements VfxHandle {
  alive = true;
  fade = 0;
  stopping = false;
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(def: KindDef, atlas: THREE.Texture, center: Vec3Like, size: Vec3Like, count: number, seedBase: number) {
    const half = new THREE.Vector3(Math.max(0.25, Math.abs(size.x) / 2), Math.max(0.25, Math.abs(size.y) / 2), Math.max(0.25, Math.abs(size.z) / 2));
    const wrap = new THREE.Vector3(Math.min(half.x * 2, WINDOW.x), Math.min(half.y * 2, WINDOW.y), Math.min(half.z * 2, WINDOW.z));
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    let s = (seedBase * 2654435761) >>> 0;
    for (let i = 0; i < seeds.length; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      seeds[i] = s / 4294967296;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    _c.setHex(def.color);
    this.uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: atlas }, uGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      uFrame: { value: spriteIndex(def.sprite) },
      uCenter: { value: new THREE.Vector3(center.x, center.y, center.z) }, uHalf: { value: half }, uWrap: { value: wrap },
      uDrift: { value: new THREE.Vector3(def.drift[0], def.drift[1], def.drift[2]) },
      uMotion: { value: new THREE.Vector4(def.sway, def.swayFreq, def.twinkle, def.twinkleFreq) },
      uLook: { value: new THREE.Vector3(def.size, def.spin, def.unison ? 1 : 0) },
      uNear: { value: new THREE.Vector2(def.near?.[0] ?? 0.5, def.near?.[1] ?? 1.8) },
      uColor: { value: new THREE.Vector3(_c.r, _c.g, _c.b).multiplyScalar(def.intensity) },
      uTime: { value: 0 }, uFade: { value: 0 }, uPixel: { value: 0.001 },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'vfx-ambient', vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      defines: def.additive ? { ADDITIVE: '' } : {},
      transparent: true, depthWrite: false, fog: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: def.additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: def.additive ? THREE.ZeroFactor : THREE.OneFactor, blendDstAlpha: def.additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'vfx-ambient';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 898;
    const size2 = new THREE.Vector2();
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(size2);
      const p = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
      this.uniforms.uPixel.value = 2 / (Math.max(0.01, p) * Math.max(1, size2.y));
    };
  }

  setPosition(p: Vec3Like): void {
    if (p) (this.uniforms.uCenter.value as THREE.Vector3).set(p.x, p.y, p.z);
  }

  stop(): void {
    this.stopping = true;
  }

  dispose(): void {
    this.alive = false;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const DEAD: VfxHandle = Object.freeze({ alive: false, setPosition() {}, stop() {} });

export class AmbientVolumes {
  readonly group = new THREE.Group();
  private readonly volumes: Volume[] = [];
  private readonly warned = new Set<string>();
  private time = 0;
  private seq = 1;

  constructor(private readonly atlas: THREE.Texture) {
    this.group.name = 'vfx-ambient';
  }

  get count(): number {
    return this.volumes.length;
  }

  create(kind: AmbientKind, center: Vec3Like, size: Vec3Like, density: number, particleScale: number): VfxHandle {
    const def = KINDS[kind];
    if (!def || !center || !size) {
      if (!this.warned.has(String(kind))) {
        this.warned.add(String(kind));
        console.warn(`[vfx] unknown ambient kind "${String(kind)}" — ignored`);
      }
      return DEAD;
    }
    const wx = Math.min(Math.abs(size.x), WINDOW.x), wy = Math.min(Math.abs(size.y), WINDOW.y), wz = Math.min(Math.abs(size.z), WINDOW.z);
    const fill = (wx * wy * wz) / (WINDOW.x * WINDOW.y * WINDOW.z);
    const d = Number.isFinite(density) && density > 0 ? density : 1;
    const count = Math.max(12, Math.min(MAX_PER_VOLUME, Math.round(def.count * d * Math.max(0.15, particleScale) * Math.max(0.04, fill))));
    const v = new Volume(def, this.atlas, center, size, count, this.seq++);
    this.group.add(v.mesh);
    this.volumes.push(v);
    return v;
  }

  update(dt: number): void {
    this.time += dt;
    let w = 0;
    for (let i = 0; i < this.volumes.length; i++) {
      const v = this.volumes[i];
      v.fade = v.stopping ? v.fade - dt / 1.5 : Math.min(1, v.fade + dt / 1.2);
      if (v.stopping && v.fade <= 0) { v.dispose(); continue; }
      v.uniforms.uTime.value = this.time;
      v.uniforms.uFade.value = v.fade * v.fade * (3 - 2 * v.fade);
      this.volumes[w++] = v;
    }
    this.volumes.length = w;
  }

  clear(): void {
    for (const v of this.volumes) v.dispose();
    this.volumes.length = 0;
  }
}
