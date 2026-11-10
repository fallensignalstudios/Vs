/**
 * Ground marks — pooled decals, shockwave rings and attack telegraphs, drawn as two instanced quad batches
 * (decals under marks). Everything procedural in one fragment shader; polygon offset keeps them off the floor.
 *
 * Telegraph contract: the fill grows LINEARLY and reaches the outline exactly at `seconds` — the attack lands
 * when the shape is full. Shape + motion carry the meaning (hatching, sweeping front), not colour alone.
 */
import * as THREE from 'three';
import type { Vec3Like, VfxHandle } from '@/core/api';
import type { DecalKind } from './defs';

const DECAL_CAP = 48;
const MARK_CAP = 40;
const KIND_ID: Record<DecalKind, number> = { scorch: 0, frost: 1, violet: 2, crack: 3, goldRing: 4 };
const K_SHOCK = 10, K_CIRCLE = 11, K_LINE = 12, K_CONE = 13;
/** seconds a completed telegraph lingers (bright "now" flash) before it is gone */
export const TELEGRAPH_HOLD = 0.14;

const VERT = /* glsl */ `
attribute vec4 iColor;
attribute vec4 iParam; // kind, progress, seed, aux
varying vec2 vP;
varying vec4 vColor;
varying vec4 vParam;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vP = position.xz * 2.0;
  vColor = iColor;
  vParam = iParam;
  vec4 mvPosition = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vP;
varying vec4 vColor;
varying vec4 vParam;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s / 0.9375; }
float line(float d, float w) { float aa = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
// radial needles: an even number of angular cells, each with one needle of hashed length and jittered heading
float needles(float ang, float r, float count, float seed, float lenBase, float width) {
  float cell = ang / 6.2831853 * count;
  float id = floor(cell);
  float h = h21(vec2(id, seed * 31.0 + count));
  float da = (fract(cell) - 0.5 - (h - 0.5) * 0.6) * 6.2831853 / count;
  float len = lenBase * (0.45 + 0.55 * h21(vec2(id * 1.7 + 3.0, seed + count)));
  float across = abs(da) * r;
  float w = width * max(0.0, 1.0 - r / len) + 0.003;
  return (1.0 - smoothstep(w * 0.5, w, across)) * step(r, len);
}

void main() {
  #include <logdepthbuf_fragment>
  float kind = vParam.x, prog = vParam.y, seed = vParam.z, aux = vParam.w;
  vec2 p = clamp(vP, -1.0, 1.0);
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  vec3 tint = vColor.rgb;
  float fade = vColor.a;

  if (kind < 0.5) {
    // ---- scorch: mottled soot with radial rays, a smooth ember-hot heart that cools (aux = heat), live specks
    float n = fbm(p * 2.6 + seed * 13.0);
    float n2 = fbm(p * 6.0 - seed * 7.0);
    float rays = vn(vec2(ang * 7.0 + seed * 3.0, r * 1.2));
    float edge = r + (n - 0.5) * 0.45 + (rays - 0.5) * 0.45 * r;
    float m = smoothstep(1.0, 0.25, edge);
    alpha = m * (0.5 + 0.45 * n2) * 0.92 * fade;
    col = vec3(0.01, 0.009, 0.008) * alpha;
    float heart = exp(-r * r * 7.5) * (0.7 + 0.6 * n) * aux;
    vec2 cellId = floor(p * 38.0);
    float specks = step(0.94, h21(cellId + seed)) * smoothstep(0.8, 0.1, r) * aux * (0.5 + 0.5 * sin(uTime * 6.0 + h21(cellId) * 30.0));
    col += tint * (heart * 1.5 + specks * 2.2) * fade;
  } else if (kind < 1.5) {
    // ---- frost: rime patch — needles of varied length at jittered angles, finer under-growth, cold sparkle
    float frostN = needles(ang, r, 18.0, seed, 0.96, 0.034) + 0.6 * needles(ang, r, 42.0, seed + 3.0, 0.62, 0.018);
    float rime = smoothstep(0.7, 0.05, r + (fbm(p * 5.0 + seed) - 0.5) * 0.6);
    vec2 sc = floor(p * 46.0);
    float sparkle = step(0.965, h21(sc + seed)) * rime * (0.5 + 0.5 * sin(uTime * 3.0 + h21(sc) * 40.0));
    float body = clamp(rime * 0.32 + frostN * 0.8, 0.0, 1.0) * smoothstep(1.0, 0.85, r);
    alpha = body * 0.5 * fade;
    col = tint * (body * 0.38 + sparkle * 1.6) * fade;
  } else if (kind < 2.5) {
    // ---- violet stain: dark tissue patch with thin live veins running outwards
    float n = fbm(p * 3.0 + seed * 9.0);
    float m = smoothstep(0.95, 0.25, r + (n - 0.5) * 0.8);
    float vein = 1.0 - smoothstep(0.0, 0.035, abs(fbm(vec2(ang * 1.6 + seed, r * 2.2) * 2.0) - 0.5));
    vein *= smoothstep(1.0, 0.3, r) * (0.55 + 0.45 * sin(uTime * 2.2 - r * 7.0));
    alpha = m * 0.86 * fade;
    col = vec3(0.02, 0.006, 0.035) * alpha + tint * vein * 1.5 * m * fade;
  } else if (kind < 3.5) {
    // ---- crack: jagged radial fractures from an impact crush; aux = glow in the fissures
    float wob = (vn(vec2(r * 5.0 + seed * 11.0, seed)) - 0.5) * 0.5 + (vn(vec2(r * 14.0, seed * 3.0)) - 0.5) * 0.16;
    float count = 7.0;
    float cell = (ang + wob) / 6.2831853 * count + seed;
    float id = floor(cell);
    float d = abs(fract(cell) - 0.5) * 6.2831853 / count * r;
    float reach = 0.45 + 0.5 * h21(vec2(id, seed));
    float w = 0.022 * (1.0 - r / reach) + 0.004;
    float crack = (1.0 - smoothstep(w * 0.4, w, d)) * step(r, reach);
    float branch = 1.0 - smoothstep(0.0, 0.012, abs(fbm(p * 4.0 + seed * 5.0) - 0.5));
    branch *= smoothstep(0.75, 0.25, r) * 0.6;
    float crush = smoothstep(0.2, 0.0, r);
    float m = clamp(crack + branch + crush * 0.8, 0.0, 1.0);
    alpha = m * 0.92 * fade;
    col = vec3(0.006) * alpha + tint * (crack + crush) * aux * 2.4 * fade;
  } else if (kind < 4.5) {
    // ---- gold ring: King-era recognition mark — concentric hairlines, tick scale, angular glyph spokes
    float rot = uTime * 0.12 + seed;
    float a2 = ang + rot;
    float outer = line(r - 0.9, 0.012);
    float inner = line(r - 0.62, 0.007);
    float ticks = line(fract(a2 / 6.2831853 * 48.0) - 0.5, 0.09) * step(0.78, r) * step(r, 0.88);
    float major = line(fract(a2 / 6.2831853 * 5.0) - 0.5, 0.012) * step(0.62, r) * step(r, 0.9);
    float a5 = mod(ang - rot * 0.5, 1.2566371) - 0.6283185;
    vec2 q = vec2(cos(a5), sin(a5)) * r;
    float chev = line(q.x - 0.36 - abs(q.y) * 0.9, 0.012) * step(abs(q.y), 0.14);
    float glow = exp(-abs(r - 0.9) * 14.0) * 0.25;
    float m = clamp(outer + inner + ticks * 0.7 + major + chev + glow, 0.0, 1.5);
    col = tint * m * fade * (0.8 + 0.2 * sin(uTime * 1.7 + r * 9.0));
    alpha = 0.0;
  }
  if (kind < 4.5) {
    // decals never reach the quad edge (no visible square), whatever their noise does
    float win = smoothstep(1.0, 0.9, r);
    col *= win;
    alpha *= win;
  } else if (kind < 10.5) {
    // ---- shockwave: sharp leading edge, soft trailing wake, angular breakup
    float front = prog;
    float d = front - r;
    float brk = 0.75 + 0.5 * vn(vec2(ang * 9.0 + seed * 5.0, front * 3.0));
    float edge = exp(-d * d * 2600.0) * 1.6;
    float wake = d > 0.0 ? exp(-d * 9.0) * 0.55 * brk : 0.0;
    float inner = d > 0.0 ? exp(-d * 2.2) * 0.08 : 0.0;
    float life = (1.0 - prog);
    col = tint * (edge + wake + inner) * life * life * fade * step(r, 1.0);
  } else {
    // ---- telegraphs: outline + linearly growing fill with a bright front, hatching, completion flash
    float inside = 0.0, bound = 0.0, coord = 0.0; // coord: 0 at origin → 1 at the outline (fill axis)
    float px = fwidth(r) + 1e-4;
    if (kind < 11.5) {
      inside = 1.0 - smoothstep(1.0 - px, 1.0, r);
      bound = line(r - 0.985, 0.02);
      coord = r;
    } else if (kind < 12.5) {
      vec2 q = abs(p);
      inside = step(q.x, 1.0) * step(q.y, 1.0);
      float lx = fwidth(p.x) * 1.5 + 0.03, ly = fwidth(p.y) * 1.5 + 0.004;
      bound = max(step(1.0 - lx, q.x), step(1.0 - ly, q.y)) * inside;
      coord = p.y * 0.5 + 0.5;
    } else {
      float halfArc = aux * 0.5;
      float a2 = abs(atan(p.x, p.y));
      float edgeA = (halfArc - a2) * r;
      inside = (1.0 - smoothstep(1.0 - px, 1.0, r)) * smoothstep(0.0, px, edgeA);
      bound = max(line(r - 0.985, 0.02) * step(a2, halfArc), line(edgeA, 0.014) * step(r, 1.0));
      coord = r;
    }
    float fill = min(prog, 1.0);
    float done = step(1.005, prog); // the CPU sends 1.01 once complete (never compare an interpolated value to 1.0)
    float filled = inside * (1.0 - smoothstep(fill - 0.004, fill + 0.004, coord));
    float front = inside * exp(-pw((coord - fill) * 26.0, 2.0)) * (1.0 - done);
    float hatch = 0.55 + 0.45 * step(0.5, fract((p.x + p.y) * 5.0 - uTime * 0.6));
    float pulse = 0.85 + 0.15 * sin(uTime * 9.0);
    float m = bound * (1.1 * pulse) + filled * (0.2 + 0.12 * hatch) + front * 0.9 + inside * 0.035;
    m += done * inside * 0.32;
    vec3 c = mix(tint, vec3(1.0, 0.96, 0.9) * max(tint.r, max(tint.g, tint.b)), done * 0.7 + front * 0.4);
    col = c * m * fade;
    // slight darkening under the shape keeps it readable on bright white-gold floors
    alpha = inside * (0.2 + 0.2 * filled) * fade;
  }

  float fogFactor = 0.0;
#ifdef USE_FOG
  #ifdef FOG_EXP2
    fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
  if (alpha + col.r + col.g + col.b < 0.002) discard;
  gl_FragColor = vec4(col * (1.0 - fogFactor), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

type TelegraphShape =
  | { kind: 'circle'; pos: Vec3Like; r: number }
  | { kind: 'line'; from: Vec3Like; to: Vec3Like; width: number }
  | { kind: 'cone'; pos: Vec3Like; yaw: number; arc: number; r: number };

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const LIFT = 0.02;

/** One instanced batch of unit ground quads. */
class Batch {
  readonly mesh: THREE.InstancedMesh;
  readonly color: THREE.InstancedBufferAttribute;
  readonly param: THREE.InstancedBufferAttribute;

  constructor(name: string, cap: number, order: number, mat: THREE.ShaderMaterial) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.param = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.color.setUsage(THREE.DynamicDrawUsage);
    this.param.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iColor', this.color);
    geo.setAttribute('iParam', this.param);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  write(i: number, m: THREE.Matrix4, r: number, g: number, b: number, a: number, kind: number, prog: number, seed: number, aux: number): void {
    this.mesh.setMatrixAt(i, m);
    this.color.setXYZW(i, r, g, b, a);
    this.param.setXYZW(i, kind, prog, seed, aux);
  }

  commit(n: number): void {
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.color.needsUpdate = true;
      this.param.needsUpdate = true;
    }
  }
}

interface Decal {
  kind: number; age: number; life: number; seed: number;
  readonly m: THREE.Matrix4;
  r: number; g: number; b: number;
}

interface Shock {
  age: number; seconds: number; seed: number;
  readonly m: THREE.Matrix4;
  r: number; g: number; b: number;
}

/** A telegraph's handle also exposes its fill (0..1, exactly 1 at the announced time). */
export interface TelegraphHandle extends VfxHandle {
  readonly fill: number;
}

class Telegraph implements TelegraphHandle {
  alive = true;
  age = 0;
  /** seconds since stop() / completion fade began; <0 = not fading */
  fading = -1;
  readonly m = new THREE.Matrix4();
  r = 1; g = 0.3; b = 0.15;
  constructor(readonly shape: TelegraphShape, readonly kind: number, readonly seconds: number, readonly aux: number, readonly seed: number) {
    this.place();
  }
  /** 0..1 linear fill; exactly 1 at `seconds` */
  get fill(): number {
    return this.age >= this.seconds - 1e-5 ? 1 : this.age / this.seconds;
  }
  place(): void {
    const s = this.shape;
    if (s.kind === 'line') {
      const dx = s.to.x - s.from.x, dz = s.to.z - s.from.z;
      const len = Math.max(0.01, Math.hypot(dx, dz));
      _p.set((s.from.x + s.to.x) / 2, (s.from.y + s.to.y) / 2 + LIFT, (s.from.z + s.to.z) / 2);
      // local +Z of the rotated quad is the fill axis; map it onto from→to
      _q.setFromAxisAngle(UP, Math.atan2(dx, dz));
      _s.set(Math.max(0.05, s.width), 1, len);
    } else if (s.kind === 'cone') {
      _p.set(s.pos.x, s.pos.y + LIFT, s.pos.z);
      // engine yaw 0 faces -Z; the shader's cone axis is local +Z
      _q.setFromAxisAngle(UP, s.yaw + Math.PI);
      _s.set(s.r * 2, 1, s.r * 2);
    } else {
      _p.set(s.pos.x, s.pos.y + LIFT, s.pos.z);
      _q.identity();
      _s.set(s.r * 2, 1, s.r * 2);
    }
    this.m.compose(_p, _q, _s);
  }
  setPosition(p: Vec3Like): void {
    const s = this.shape;
    if (!p) return;
    if (s.kind === 'line') {
      const dx = s.to.x - s.from.x, dy = s.to.y - s.from.y, dz = s.to.z - s.from.z;
      s.from.x = p.x; s.from.y = p.y; s.from.z = p.z;
      s.to.x = p.x + dx; s.to.y = p.y + dy; s.to.z = p.z + dz;
    } else {
      s.pos.x = p.x; s.pos.y = p.y; s.pos.z = p.z;
    }
    this.place();
  }
  stop(): void {
    if (this.fading < 0) this.fading = 0;
  }
}

export class GroundMarks {
  readonly group = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  private readonly decalBatch: Batch;
  private readonly markBatch: Batch;
  private readonly decals: Decal[] = [];
  private readonly shocks: Shock[] = [];
  private readonly telegraphs: Telegraph[] = [];
  private time = 0;
  private seq = 0;

  constructor() {
    this.group.name = 'vfx-ground';
    this.mat = new THREE.ShaderMaterial({
      name: 'vfx-ground',
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 } },
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.decalBatch = new Batch('vfx-decals', DECAL_CAP, 880, this.mat);
    this.markBatch = new Batch('vfx-marks', MARK_CAP, 885, this.mat);
    this.group.add(this.decalBatch.mesh, this.markBatch.mesh);
  }

  get counts(): { decals: number; shocks: number; telegraphs: number } {
    return { decals: this.decals.length, shocks: this.shocks.length, telegraphs: this.telegraphs.length };
  }

  private seed(): number {
    this.seq = (this.seq + 1) % 997;
    return (this.seq * 0.6180339887) % 1;
  }

  decal(kind: DecalKind, pos: Vec3Like, normal: Vec3Like | undefined, size: number, life: number, color?: number): void {
    const id = KIND_ID[kind];
    if (id === undefined || !pos) return;
    let d: Decal;
    if (this.decals.length >= DECAL_CAP) {
      // recycle the oldest (first) decal
      d = this.decals.shift() as Decal;
    } else {
      d = { kind: 0, age: 0, life: 1, seed: 0, m: new THREE.Matrix4(), r: 1, g: 1, b: 1 };
    }
    d.kind = id; d.age = 0; d.life = Math.max(0.1, life); d.seed = this.seed();
    _n.set(normal?.x ?? 0, normal?.y ?? 1, normal?.z ?? 0);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
    _n.normalize();
    _q.setFromUnitVectors(UP, _n);
    // random spin about the normal so repeats do not line up
    _q.multiply(_q2.setFromAxisAngle(UP, d.seed * Math.PI * 2));
    _p.set(pos.x, pos.y, pos.z).addScaledVector(_n, LIFT * 0.6);
    const s = Math.max(0.05, size);
    _s.set(s, 1, s);
    d.m.compose(_p, _q, _s);
    const hex = color ?? (id === 0 ? 0xff6a1a : id === 1 ? 0xcfeeff : id === 2 ? 0x8a4cff : id === 3 ? 0xff7a2a : 0xffc56b);
    _c.setHex(hex);
    d.r = _c.r; d.g = _c.g; d.b = _c.b;
    this.decals.push(d);
  }

  shockwave(pos: Vec3Like, radius: number, color: number, seconds: number): void {
    if (!pos || !(radius > 0)) return;
    let s: Shock;
    if (this.shocks.length >= 16) s = this.shocks.shift() as Shock;
    else s = { age: 0, seconds: 1, seed: 0, m: new THREE.Matrix4(), r: 1, g: 1, b: 1 };
    s.age = 0; s.seconds = Math.max(0.05, seconds); s.seed = this.seed();
    _p.set(pos.x, pos.y + LIFT, pos.z);
    _q.identity();
    _s.set(radius * 2, 1, radius * 2);
    s.m.compose(_p, _q, _s);
    _c.setHex(color);
    s.r = _c.r; s.g = _c.g; s.b = _c.b;
    this.shocks.push(s);
  }

  telegraph(shape: TelegraphShape, seconds: number, color: number): TelegraphHandle {
    const kind = shape.kind === 'circle' ? K_CIRCLE : shape.kind === 'line' ? K_LINE : K_CONE;
    // own copies: callers often pass live vectors
    const own: TelegraphShape = shape.kind === 'line'
      ? { kind: 'line', from: { x: shape.from.x, y: shape.from.y, z: shape.from.z }, to: { x: shape.to.x, y: shape.to.y, z: shape.to.z }, width: shape.width }
      : shape.kind === 'cone'
        ? { kind: 'cone', pos: { x: shape.pos.x, y: shape.pos.y, z: shape.pos.z }, yaw: shape.yaw, arc: shape.arc, r: shape.r }
        : { kind: 'circle', pos: { x: shape.pos.x, y: shape.pos.y, z: shape.pos.z }, r: shape.r };
    const aux = own.kind === 'cone' ? Math.min(Math.PI * 2, Math.max(0.05, own.arc)) : 0;
    const t = new Telegraph(own, kind, Math.max(0.01, seconds), aux, this.seed());
    _c.setHex(color);
    t.r = _c.r; t.g = _c.g; t.b = _c.b;
    if (this.telegraphs.length >= MARK_CAP - 16) {
      const old = this.telegraphs.shift();
      if (old) old.alive = false;
    }
    this.telegraphs.push(t);
    return t;
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;

    // ---- decals
    let w = 0;
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age >= d.life) continue;
      this.decals[w] = d;
      const fadeIn = Math.min(1, d.age / 0.12);
      const tail = Math.min(1, (d.life - d.age) / Math.min(3, d.life * 0.4));
      // aux: scorch heat / crack glow cool off quickly; the mark itself lingers
      const heat = Math.exp(-d.age * (d.kind === 3 ? 0.9 : 1.6));
      this.decalBatch.write(w, d.m, d.r, d.g, d.b, fadeIn * tail, d.kind, d.age / d.life, d.seed, heat);
      w++;
    }
    this.decals.length = w;
    this.decalBatch.commit(w);

    // ---- shockwaves + telegraphs
    let n = 0;
    w = 0;
    for (let i = 0; i < this.shocks.length; i++) {
      const s = this.shocks[i];
      s.age += dt;
      if (s.age >= s.seconds) continue;
      this.shocks[w++] = s;
      const t = s.age / s.seconds;
      const eased = 1 - Math.pow(1 - t, 2.6);
      this.markBatch.write(n++, s.m, s.r * 2.2, s.g * 2.2, s.b * 2.2, 1, K_SHOCK, eased, s.seed, 0);
    }
    this.shocks.length = w;
    w = 0;
    for (let i = 0; i < this.telegraphs.length; i++) {
      const t = this.telegraphs[i];
      t.age += dt;
      let fade = Math.min(1, t.age / 0.08 + 0.35);
      if (t.fading >= 0) {
        t.fading += dt;
        fade *= Math.max(0, 1 - t.fading / 0.15);
        if (t.fading >= 0.15) { t.alive = false; continue; }
      } else if (t.age >= t.seconds + TELEGRAPH_HOLD) {
        t.alive = false;
        continue;
      }
      this.telegraphs[w++] = t;
      if (n < MARK_CAP) this.markBatch.write(n++, t.m, t.r * 1.2, t.g * 1.2, t.b * 1.2, fade, t.kind, t.age >= t.seconds - 1e-5 ? 1.01 : t.age / t.seconds, t.seed, t.aux);
    }
    this.telegraphs.length = w;
    this.markBatch.commit(n);
  }

  clear(): void {
    for (const t of this.telegraphs) t.alive = false;
    this.decals.length = 0;
    this.shocks.length = 0;
    this.telegraphs.length = 0;
    this.decalBatch.commit(0);
    this.markBatch.commit(0);
  }
}
