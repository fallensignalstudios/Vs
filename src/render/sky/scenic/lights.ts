/**
 * LightCards — instanced emissive points and strips for far-field pieces (one draw call per piece).
 * Each card is a camera-facing soft sprite, or a world-vertical strip when taller than wide. Size is clamped to a
 * minimum pixel footprint (energy-compensated) so kilometre-distant lights never shimmer, and their brightness
 * survives haze longer than surfaces do. Cards may carry a looping or one-shot linear motion (vent plumes,
 * sparks) evaluated in the vertex shader — nothing is simulated per frame on the CPU.
 */
import * as THREE from 'three';
import { viewportTracker, type SharedUniforms } from '../shared';

const VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iSize;   // width, height (m), group, softness (0 = point glow, 1 = flat strip)
attribute vec3 iColor;
attribute vec4 iMotion; // velocity (m/s), period (s): > 0 loops, < 0 one-shot, 0 static
attribute vec2 iPhase;  // start time / loop phase, gravity scale
uniform vec2 uViewport;
uniform float uTime;
uniform float uHazeDensity;
uniform float uHazeScale;
uniform float uMinPx;
uniform vec4 uGroupGain;
uniform float uClock;
varying vec2 vQ;
varying vec3 vCol;
varying float vSoft;
void main() {
  vQ = position.xy;
  vSoft = iSize.w;
  int group = int(iSize.z + 0.5);
  float gain = group == 0 ? uGroupGain.x : (group == 1 ? uGroupGain.y : (group == 2 ? uGroupGain.z : uGroupGain.w));
  vec3 p = iPos;
  float life = 1.0;
  if (iMotion.w > 0.0) {
    float a = fract(uTime / iMotion.w + iPhase.x);
    p += iMotion.xyz * (a * iMotion.w);
    life = sin(3.14159 * a);
  } else if (iMotion.w < 0.0) {
    float age = uClock - iPhase.x;
    float a = age / -iMotion.w;
    if (age < 0.0 || a >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
    p += iMotion.xyz * age + vec3(0.0, -4.9 * iPhase.y * age * age, 0.0);
    life = (1.0 - a) * (1.0 - a);
  }
  vec4 vc = viewMatrix * modelMatrix * vec4(p, 1.0);
  float dist = max(-vc.z, 0.01);
  float mpp = 2.0 * dist / (projectionMatrix[1][1] * uViewport.y);
  float scl = length(modelMatrix[0].xyz);
  float w = max(iSize.x * scl, uMinPx * mpp);
  float h = max(iSize.y * scl, uMinPx * mpp);
  float comp = clamp((iSize.x * iSize.y * scl * scl) / (w * h), 0.06, 1.0);
  bool strip = iSize.y > iSize.x * 1.6;
  vec3 up = strip ? normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) : vec3(0.0, 1.0, 0.0);
  vec3 right = strip ? normalize(cross(up, vec3(0.0, 0.0, 1.0))) : vec3(1.0, 0.0, 0.0);
  vec3 pv = vc.xyz + right * position.x * w * 0.5 + up * position.y * h * 0.5;
  gl_Position = projectionMatrix * vec4(pv, 1.0);
  float haze = exp(-length(vc.xyz) * uHazeDensity * uHazeScale * 0.4);
  vCol = iColor * gain * life * sqrt(comp) * max(haze, 0.12);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying vec3 vCol;
varying float vSoft;
void main() {
  float r2 = dot(vQ, vQ);
  float point = exp(-r2 * 4.2) * (1.0 - smoothstep(0.75, 1.0, sqrt(r2)));
  float ax = abs(vQ.x), ay = abs(vQ.y);
  float stripe = exp(-ax * ax * 3.6) * (1.0 - smoothstep(0.82, 1.0, ay)) * (1.0 - smoothstep(0.7, 1.0, ax));
  float a = mix(point, stripe, vSoft);
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _c = new THREE.Color();

/** Collects cards, then builds one instanced mesh. */
export class LightCards {
  private readonly pos: number[] = [];
  private readonly size: number[] = [];
  private readonly col: number[] = [];
  private readonly motion: number[] = [];
  private readonly phase: number[] = [];

  get count(): number { return this.pos.length / 3; }

  /** Round glow of diameter `size` metres. `intensity` > 1 blooms. */
  point(x: number, y: number, z: number, size: number, hex: number, intensity: number, group = 0): this {
    return this.card(x, y, z, size, size, hex, intensity, group);
  }

  /** Vertical light seam `w` × `h` metres centred on (x, y, z). */
  strip(x: number, y: number, z: number, w: number, h: number, hex: number, intensity: number, group = 0): this {
    return this.card(x, y, z, w, h, hex, intensity, group);
  }

  card(x: number, y: number, z: number, w: number, h: number, hex: number, intensity: number, group = 0): this {
    _c.setHex(hex);
    this.pos.push(x, y, z);
    this.size.push(w, h, group, h > w * 1.6 ? 1 : 0);
    this.col.push(_c.r * intensity, _c.g * intensity, _c.b * intensity);
    this.motion.push(0, 0, 0, 0);
    this.phase.push(0, 0);
    return this;
  }

  /** Give the most recently added card a looping linear motion (vent plume / drifting ember). */
  loop(vx: number, vy: number, vz: number, period: number, phase: number): this {
    const o = this.motion.length - 4;
    this.motion[o] = vx; this.motion[o + 1] = vy; this.motion[o + 2] = vz; this.motion[o + 3] = Math.max(period, 0.01);
    this.phase[this.phase.length - 2] = phase;
    return this;
  }

  build(shared: SharedUniforms, opts?: { haze?: number; minPx?: number; name?: string; dynamic?: boolean }): LightCardMesh {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name: string, data: number[], n: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(data), n);
      if (opts?.dynamic) a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, a);
      return a;
    };
    const attrs = {
      pos: mk('iPos', this.pos, 3), size: mk('iSize', this.size, 4), color: mk('iColor', this.col, 3),
      motion: mk('iMotion', this.motion, 4), phase: mk('iPhase', this.phase, 2),
    };
    geometry.instanceCount = this.count;
    // bounds: cover every card (static pieces are large; keep culling cheap and conservative)
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < this.pos.length; i += 3) box.expandByPoint(v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
    geometry.boundingSphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere());
    geometry.boundingSphere.radius += 400;
    const uniforms = {
      uViewport: shared.uViewport, uTime: shared.uTime, uHazeDensity: shared.uHazeDensity,
      uHazeScale: { value: opts?.haze ?? 1 },
      uMinPx: { value: opts?.minPx ?? 1.7 },
      uGroupGain: { value: new THREE.Vector4(1, 1, 1, 1) },
      uClock: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      name: opts?.name ?? 'ScenicLights',
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geometry, material) as unknown as LightCardMesh;
    mesh.name = opts?.name ?? 'scenic:lights';
    mesh.renderOrder = 10;
    mesh.onBeforeRender = viewportTracker(shared);
    mesh.cards = { attrs, uniforms };
    return mesh;
  }
}

export interface LightCardMesh extends THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  cards: {
    attrs: Record<'pos' | 'size' | 'color' | 'motion' | 'phase', THREE.InstancedBufferAttribute>;
    uniforms: { uGroupGain: { value: THREE.Vector4 }; uClock: { value: number }; uHazeScale: { value: number }; uMinPx: { value: number } };
  };
}
