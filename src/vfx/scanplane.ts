/**
 * Scan plane — a translucent sensor sheet with a bright leading (ground) edge, fine drifting scan lines and a
 * sweeping bar. `setAlert` does not only change colour: the lines accelerate and hazard chevrons appear.
 */
import * as THREE from 'three';
import type { ScanPlaneVisual, Vec3Like } from '@/core/api';

const VERT = /* glsl */ `
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAlertColor;
uniform float uAlert;
uniform float uTime;
uniform vec2 uSize;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  #include <logdepthbuf_fragment>
  vec2 m = vUv * uSize;            // metres from the bottom-left corner
  float x = vUv.x, y = vUv.y;
  float speed = mix(0.35, 1.6, uAlert);
  // border: hot ground edge, thinner top/sides
  float ground = exp(-m.y * 26.0) * 1.8 + exp(-m.y * 3.0) * 0.35;
  float top = exp(-(uSize.y - m.y) * 40.0) * 0.8;
  float sides = (exp(-m.x * 40.0) + exp(-(uSize.x - m.x) * 40.0)) * 0.7;
  // body: faint fill, fine horizontal lines drifting, streaky data noise
  float lines = pow(0.5 + 0.5 * sin((m.y + uTime * speed * 0.25) * 60.0), 6.0);
  float data = vn(vec2(m.x * 2.5 - uTime * speed, floor(m.y * 14.0)));
  float body = 0.035 + lines * 0.05 + smoothstep(0.62, 0.9, data) * 0.09;
  // sweeping bar
  float bx = fract(uTime * speed * 0.22);
  float bar = exp(-pow((x - bx) * uSize.x * 2.2, 2.0)) * 0.45;
  // alert: hazard chevrons marching outwards from the centre + global pulse
  float cx = abs(x - 0.5) * uSize.x;
  float chev = step(0.5, fract(cx * 1.2 + abs(y - 0.5) * uSize.y * 0.6 - uTime * 2.4)) * uAlert * 0.22;
  float pulse = 1.0 + uAlert * (0.35 + 0.35 * sin(uTime * 14.0));
  vec3 base = mix(uColor, uAlertColor, uAlert);
  float edgeFade = smoothstep(0.0, 0.02, y);
  vec3 col = base * (ground + top + sides + (body + bar + chev) * (1.0 - 0.35 * y)) * pulse * edgeFade;
  float fogFactor = 0.0;
#ifdef USE_FOG
  #ifdef FOG_EXP2
    fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
  gl_FragColor = vec4(col * (1.0 - fogFactor * 0.8), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _c = new THREE.Color();

class ScanPlane implements ScanPlaneVisual {
  readonly object: THREE.Mesh;
  removed = false;
  private alert = 0;
  private shown = 0;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(geo: THREE.BufferGeometry, color: number) {
    _c.setHex(color);
    this.uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uColor: { value: new THREE.Vector3(_c.r, _c.g, _c.b).multiplyScalar(1.6) },
      uAlertColor: { value: new THREE.Vector3(3.2, 0.9, 0.35) },
      uAlert: { value: 0 }, uTime: { value: 0 }, uSize: { value: new THREE.Vector2(4, 3) },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'vfx-scanplane', vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.object = new THREE.Mesh(geo, mat);
    this.object.name = 'vfx-scanplane';
    this.object.renderOrder = 892;
    this.object.scale.set(4, 3, 1);
  }

  setPose(center: Vec3Like, yaw: number, width: number, height: number): void {
    if (!center) return;
    const w = Math.max(0.05, width), h = Math.max(0.05, height);
    this.object.position.set(center.x, center.y, center.z);
    this.object.rotation.set(0, Number.isFinite(yaw) ? yaw : 0, 0);
    this.object.scale.set(w, h, 1);
    (this.uniforms.uSize.value as THREE.Vector2).set(w, h);
  }

  setAlert(n: number): void {
    this.alert = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  }

  remove(): void {
    this.removed = true;
    this.object.removeFromParent();
    (this.object.material as THREE.Material).dispose();
  }

  update(dt: number, time: number): void {
    // snap up fast, relax slowly — a detection reads as an event
    const k = this.alert > this.shown ? 18 : 3;
    this.shown += (this.alert - this.shown) * Math.min(1, dt * k);
    this.uniforms.uAlert.value = this.shown;
    this.uniforms.uTime.value = time;
  }
}

export class ScanPlanes {
  readonly group = new THREE.Group();
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly planes: ScanPlane[] = [];
  private time = 0;

  constructor() {
    this.group.name = 'vfx-scanplanes';
  }

  get count(): number {
    return this.planes.length;
  }

  create(color: number | undefined): ScanPlaneVisual {
    const p = new ScanPlane(this.geo, color ?? 0xa8d8ff);
    this.group.add(p.object);
    this.planes.push(p);
    return p;
  }

  update(dt: number): void {
    this.time += dt;
    let w = 0;
    for (let i = 0; i < this.planes.length; i++) {
      const p = this.planes[i];
      if (p.removed) continue;
      p.update(dt, this.time);
      this.planes[w++] = p;
    }
    this.planes.length = w;
  }

  clear(): void {
    for (const p of this.planes) if (!p.removed) p.remove();
    this.planes.length = 0;
  }

  dispose(): void {
    this.clear();
    this.geo.dispose();
  }
}
