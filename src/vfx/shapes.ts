/**
 * Mesh shapes — the handful of non-particle primitives hero effects need: stasis dome, pressure band, light
 * column, rising light wall, hex shield ripple, closing iris, camera-facing halo. Pooled meshes sharing a few
 * unit geometries and one procedural additive shader (per-instance uniforms).
 */
import * as THREE from 'three';
import type { ShapeDef, ShapeKind } from './defs';
import type { ShapeHandle } from './effects';

const KIND_ID: Record<ShapeKind, number> = { dome: 0, sphere: 1, band: 2, column: 3, wall: 4, hexRipple: 5, iris: 6, halo: 7, plane: 8 };

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vLocal;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv;
  vLocal = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mvPosition.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uKind;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uEnv;
uniform float uProg;
uniform float uRise;
uniform float uTime;
uniform float uDetail;
uniform float uSeed;
uniform vec2 uDims;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vLocal;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <logdepthbuf_pars_fragment>

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
// xy = offset from the cell centre, zw = cell id
vec4 hexGrid(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}
float hexD(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
float line(float d, float w) { float aa = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }

void main() {
  #include <logdepthbuf_fragment>
  // MSAA can extrapolate varyings past the primitive edge; exp() of an out-of-range uv explodes into bloom
  vec2 uv = clamp(vUv, 0.0, 1.0);
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(-vViewPos);
  float ndv = abs(dot(n, v));
  vec3 col = vec3(0.0);

  if (uKind < 1.5) {
    // ---- dome / sphere: fresnel shell, frozen hex lattice with slow per-cell glints, bright foot
    float fres = pw(1.0 - ndv, 3.2);
    vec2 sp = vec2(atan(vLocal.z, vLocal.x) / 6.2831853, acos(clamp(vLocal.y, -1.0, 1.0)) / 3.14159265);
    vec4 hx = hexGrid(vec2(sp.x * 2.0 * uDetail * max(0.25, sin(sp.y * 3.14159265)), sp.y * uDetail * 1.1547));
    float e = hexD(hx.xy);
    float lattice = smoothstep(0.43, 0.49, e) * smoothstep(0.02, 0.2, sp.y);
    float glint = pw(0.5 + 0.5 * sin(uTime * 0.7 + h21(hx.zw + uSeed) * 40.0), 12.0);
    float foot = uKind < 0.5 ? exp(-max(vLocal.y, 0.0) * 11.0) : 0.0;
    float breathe = 0.92 + 0.08 * sin(uTime * 1.1);
    col = uColor * (fres * 1.2 * breathe + foot * 1.1) + uColor2 * (lattice * (0.1 + 0.55 * fres) + glint * 0.2 * (1.0 - e * 1.6));
  } else if (uKind < 2.5) {
    // ---- band: expanding wall of pressure, bright foot, streaked body
    float y = uv.y;
    float streak = 0.55 + 0.45 * vn(vec2(uv.x * 120.0, uSeed * 17.0 + y * 2.0));
    float body = pw(1.0 - y, 2.2) * streak;
    float foot = exp(-y * 26.0) * 1.6;
    float life = pw(1.0 - uProg, 1.3);
    col = (uColor * body * mix(1.5, 0.55, ndv) + uColor2 * foot) * life;
  } else if (uKind < 3.5) {
    // ---- column: soft volumetric shaft, rising hairline streaks
    float y = uv.y;
    float core = pw(ndv, 1.7);
    float vert = exp(-y * 2.4) * 1.1 + 0.16 * (1.0 - y) * (1.0 - y);
    float streak = 0.7 + 0.6 * pw(vn(vec2(uv.x * 46.0, y * uDims.y * 0.9 - uTime * 1.6 + uSeed * 9.0)), 2.0);
    float foot = exp(-y * 40.0);
    col = (uColor * core * vert * streak + uColor2 * foot * core * 1.2) * smoothstep(1.0, 0.75, y);
  } else if (uKind < 4.5) {
    // ---- wall: light rises to full height behind a hot leading edge; vertical seams + drifting scan lines
    float x = uv.x, y = uv.y;
    float below = 1.0 - smoothstep(uRise - 0.002, uRise + 0.002, y);
    float lead = exp(-pw((y - uRise) * uDims.y * 11.0, 2.0)) * (1.0 - smoothstep(0.9, 1.0, uRise));
    float seams = pw(0.5 + 0.5 * cos(x * uDims.x * 6.2831853 / max(0.4, uDetail)), 40.0);
    float scan = 0.5 + 0.5 * sin((y * uDims.y - uTime * 0.25) * 48.0);
    float sides = smoothstep(0.0, 0.25 / uDims.x, x) * smoothstep(1.0, 1.0 - 0.25 / uDims.x, x);
    float foot = exp(-y * uDims.y * 3.0);
    float top = line(y - 0.995, 0.004) * step(0.97, uRise);
    float fill = (0.07 + 0.035 * scan + seams * 0.55 + foot * 0.6) * (1.0 - 0.45 * y);
    col = (uColor * fill * below + uColor2 * (lead * 1.6 + top * 0.8)) * sides;
  } else if (uKind < 5.5) {
    // ---- hex ripple: shield cells lit as the impact ring passes them
    vec2 p = uv * 2.0 - 1.0;
    float r = length(p);
    vec4 hx = hexGrid(p * uDetail);
    float e = hexD(hx.xy);
    float cellR = length(hx.zw * vec2(1.0, 1.7320508)) / uDetail;
    float ring = exp(-pw((cellR - uProg * 1.15) * 4.5, 2.0));
    float edge = smoothstep(0.4, 0.48, e);
    float mask = smoothstep(1.0, 0.72, r);
    float hot = exp(-r * r * 60.0) * pw(1.0 - uProg, 4.0);
    col = (uColor * (edge * (0.08 + ring * 1.5) + (1.0 - edge) * ring * 0.22) + uColor2 * hot * 1.2) * mask * (1.0 - uProg * 0.6);
  } else if (uKind < 6.5) {
    // ---- iris: an aperture closing to a seam, then nothing. The closed part is a smooth, seam-free veil.
    vec2 p = uv * 2.0 - 1.0;
    float r = length(p);
    float t = clamp(uProg / 0.82, 0.0, 1.0);
    float ap = 1.0 - t * t * (3.0 - 2.0 * t);
    float outer = 1.0 - smoothstep(0.82, 1.0, r);
    float closed = smoothstep(ap - 0.01, ap + 0.01, r) * outer;
    float aa = fwidth(r);
    float rim = exp(-(r - ap) * (r - ap) / (0.00012 + aa * aa)) * step(0.004, ap);
    // two soft ripples left behind by the travelling rim
    float wake = closed * exp(-(r - ap) * 7.0) * (0.5 + 0.5 * cos((r - ap) * 60.0 - uTime * 2.0)) * 0.12;
    float seamT = clamp((uProg - 0.8) / 0.2, 0.0, 1.0);
    float seam = exp(-p.y * p.y * 2600.0) * exp(-abs(p.x) * (1.5 + seamT * 14.0)) * (1.0 - seamT) * step(0.8, uProg) * 2.2;
    float hold = 1.0 - smoothstep(0.78, 0.95, uProg);
    col = uColor * (closed * (0.035 + 0.05 * (1.0 - r)) + wake) * hold + uColor2 * (rim * 0.9 * hold + seam);
  } else if (uKind > 7.5) {
    // ---- plane: a steady, coherent sheet — hairline grid, concentric rulings, bright rim; nothing wanders
    vec2 p = uv * 2.0 - 1.0;
    vec2 m = p * uDims;
    float box = max(abs(p.x), abs(p.y));
    float rim = line(box - 0.985, 0.012) + exp(-(1.0 - box) * 22.0) * 0.35;
    vec2 g = abs(fract(m / max(0.1, uDetail)) - 0.5);
    float cells = 1.0 - smoothstep(0.0, 0.03, min(g.x, g.y));
    float rings = line(fract(length(m) / (uDetail * 2.0)) - 0.5, 0.02) * 0.6;
    float axis = line(p.x, 0.004) + line(p.y, 0.004);
    float breathe = 0.94 + 0.06 * sin(uTime * 0.8);
    float inside = step(box, 1.0);
    col = (uColor * (0.05 + cells * 0.2 + rings * 0.3) * breathe + uColor2 * (rim * 1.3 + axis * 0.5)) * inside;
  } else {
    // ---- halo: thin camera-facing ring with soft inner bloom
    vec2 p = uv * 2.0 - 1.0;
    float r = length(p);
    float d = r - 0.9;
    float w = 0.011, aa = fwidth(r);
    float ring = exp(-d * d / (w * w + aa * aa)) * (w / sqrt(w * w + aa * aa)) * 0.9;
    float inner = d < 0.0 ? exp(d * 11.0) * 0.07 : exp(-d * 60.0) * 0.07;
    float ticks = line(fract(atan(p.y, p.x) / 6.2831853 * uDetail) - 0.5, 0.05) * step(0.8, r) * step(r, 0.88) * 0.6;
    col = uColor * (ring + inner) + uColor2 * ticks;
  }

  gl_FragColor = vec4(col * uEnv, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _col = new THREE.Color();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

function setHdr(target: THREE.Vector3, hex: number, intensity: number): void {
  _col.setHex(hex);
  target.set(_col.r * intensity, _col.g * intensity, _col.b * intensity);
}

class ShapeInst implements ShapeHandle {
  alive = false;
  age = 0;
  released = -1;
  def!: ShapeDef;
  scale = 1;
  life = 1;
  readonly base = new THREE.Vector3();
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(readonly kind: ShapeKind, geo: THREE.BufferGeometry) {
    this.uniforms = {
      uKind: { value: KIND_ID[kind] }, uColor: { value: new THREE.Vector3() }, uColor2: { value: new THREE.Vector3() },
      uEnv: { value: 0 }, uProg: { value: 0 }, uRise: { value: 0 }, uTime: { value: 0 }, uDetail: { value: 8 },
      uSeed: { value: 0 }, uDims: { value: new THREE.Vector2(1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      name: `vfx-shape-${kind}`, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = `vfx-shape-${kind}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 890;
    this.mesh.visible = false;
  }

  release(): void {
    if (this.alive && this.released < 0) this.released = 0;
  }

  setPosition(x: number, y: number, z: number): void {
    const o = this.def.offset;
    this.base.set(x + (o ? o[0] * this.scale : 0), y + (o ? o[1] * this.scale : 0), z + (o ? o[2] * this.scale : 0));
    this.mesh.position.copy(this.base);
  }
}

export class ShapeRenderer {
  readonly group = new THREE.Group();
  private readonly geos: Record<ShapeKind, THREE.BufferGeometry>;
  private readonly pool: Record<ShapeKind, ShapeInst[]>;
  private readonly live: ShapeInst[] = [];
  private time = 0;
  private seq = 0;

  constructor() {
    this.group.name = 'vfx-shapes';
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true).translate(0, 0.5, 0);
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geos = {
      dome: new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      sphere: new THREE.SphereGeometry(1, 48, 32),
      band: cyl, column: cyl,
      wall: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
      hexRipple: quad, iris: quad, halo: quad, plane: quad,
    };
    this.pool = { dome: [], sphere: [], band: [], column: [], wall: [], hexRipple: [], iris: [], halo: [], plane: [] };
  }

  get liveCount(): number {
    return this.live.length;
  }

  spawn(def: ShapeDef, x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number, tint: number | undefined, life = 0): ShapeHandle {
    let s = this.pool[def.kind].pop();
    if (!s) {
      s = new ShapeInst(def.kind, this.geos[def.kind]);
      this.group.add(s.mesh);
    }
    s.def = def; s.alive = true; s.age = 0; s.released = -1; s.scale = scale;
    s.life = life > 0 ? life : def.life;
    const u = s.uniforms;
    setHdr(u.uColor.value as THREE.Vector3, tint ?? def.color[0], def.color[1]);
    const c2 = def.color2 ?? def.color;
    setHdr(u.uColor2.value as THREE.Vector3, c2[0], c2[1]);
    if (tint !== undefined) (u.uColor2.value as THREE.Vector3).lerp(u.uColor.value as THREE.Vector3, 0.5);
    u.uDetail.value = def.detail ?? 8;
    this.seq = (this.seq + 1) % 251;
    u.uSeed.value = (this.seq * 0.6180339887) % 1;
    s.setPosition(x, y, z);
    const m = s.mesh;
    m.quaternion.identity();
    if (def.kind === 'wall') {
      // upright; plane normal = dir flattened onto the ground (default +Z)
      const l = Math.hypot(dx, dz);
      if (l > 1e-4) m.quaternion.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(dx / l, dz / l));
    } else if (def.kind === 'hexRipple' || def.kind === 'iris' || def.kind === 'plane') {
      _v.set(dx, dy, dz);
      if (_v.lengthSq() > 1e-8) m.quaternion.setFromUnitVectors(Z, _v.normalize());
    }
    this.apply(s, 0);
    m.visible = true;
    this.live.push(s);
    return s;
  }

  update(dt: number, camera: THREE.Camera | null): void {
    this.time += dt;
    let w = 0;
    for (let i = 0; i < this.live.length; i++) {
      const s = this.live[i];
      s.age += dt;
      if (s.released >= 0) s.released += dt;
      const d = s.def;
      const dead = d.sustain ? s.released >= s.life : s.age >= s.life;
      if (dead) {
        s.alive = false;
        s.mesh.visible = false;
        this.pool[s.kind].push(s);
        continue;
      }
      if (s.kind === 'halo' && camera) s.mesh.quaternion.copy(camera.getWorldQuaternion(_q));
      this.apply(s, this.time);
      this.live[w++] = s;
    }
    this.live.length = w;
  }

  private apply(s: ShapeInst, time: number): void {
    const d = s.def, u = s.uniforms, attack = Math.max(1e-3, d.attack ?? 0.15);
    const rise = Math.min(1, s.age / attack);
    let prog: number, env: number;
    if (d.sustain) {
      prog = rise;
      env = rise * rise * (3 - 2 * rise);
      if (s.released >= 0) env *= Math.max(0, 1 - s.released / s.life);
    } else {
      prog = Math.min(1, s.age / s.life);
      const out = Math.max(0, Math.min(1, (prog - 0.55) / 0.45));
      env = rise * (1 - out * out * (3 - 2 * out));
    }
    // fitted timing rings close linearly (readable countdown); everything else eases out
    const eased = d.fit ? prog : 1 - Math.pow(1 - prog, 3);
    const r = (d.radius[0] + (d.radius[1] - d.radius[0]) * eased) * s.scale;
    const h = (d.height ?? 1) * s.scale;
    u.uEnv.value = env; u.uProg.value = prog; u.uRise.value = rise; u.uTime.value = time;
    const m = s.mesh;
    switch (s.kind) {
      case 'dome': case 'sphere': m.scale.set(r, r, r); (u.uDims.value as THREE.Vector2).set(r, r); break;
      case 'band': case 'column': m.scale.set(r, h, r); (u.uDims.value as THREE.Vector2).set(r, h); break;
      case 'wall': m.scale.set(r * 2, h, 1); (u.uDims.value as THREE.Vector2).set(r * 2, h); break;
      default: m.scale.set(r, r, 1); (u.uDims.value as THREE.Vector2).set(r, r); break;
    }
  }

  clear(): void {
    for (const s of this.live) {
      s.alive = false;
      s.mesh.visible = false;
      this.pool[s.kind].push(s);
    }
    this.live.length = 0;
  }
}
