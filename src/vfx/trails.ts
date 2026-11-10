/**
 * Weapon trails — swoosh ribbons sampled every update from two sockets (blade base + tip) while a swing is
 * active. Samples are Catmull-Rom smoothed, the ribbon tapers toward its tail and is drawn additively.
 * All trails share one dynamic mesh (one draw call, hidden when nothing is live).
 */
import * as THREE from 'three';
import type { TrailHandle } from '@/core/api';

const SAMPLES = 20;
const SUB = 3;
const SECTIONS = (SAMPLES - 1) * SUB + 1; // cross-sections per trail
const VPT = SECTIONS * 2;
const STRIDE = 9; // pos3, uv2, color3, alpha1

const VERT = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = aUv;
  vColor = aColor;
  vec4 mvPosition = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <logdepthbuf_pars_fragment>
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  #include <logdepthbuf_fragment>
  float u = clamp(vUv.x, 0.0, 1.0);  // 0 = newest edge, 1 = tail
  float v = clamp(vUv.y, 0.0, 1.0);  // 0 = base, 1 = tip
  float tail = pw(1.0 - u, 1.6);
  // hot rim along the tip edge, soft body falling off toward the base, streaks dragged along the swing
  float rim = exp(-pw((1.0 - v) * 9.0, 2.0));
  float body = pw(v, 2.2) * 0.5;
  float streak = 0.6 + 0.4 * vn(vec2(v * 26.0, u * 3.0));
  float lead = exp(-u * 14.0) * 0.6;
  float m = (rim * 1.5 + body * streak) * tail + lead * pw(v, 1.4);
  m *= smoothstep(0.0, 0.06, v);
  vec3 hot = mix(vColor.rgb, vec3(max(vColor.r, max(vColor.g, vColor.b))), rim * tail * 0.7);
  vec3 col = hot * m * vColor.a;
  if (col.r + col.g + col.b < 0.003) discard;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

class Trail implements TrailHandle {
  active = false;
  removed = false;
  /** ring of samples, newest first after `head`: base xyz, tip xyz */
  readonly pts = new Float32Array(SAMPLES * 6);
  readonly born = new Float32Array(SAMPLES);
  head = 0;
  count = 0;
  r = 1; g = 1; b = 1;
  intensity = 1.7;
  constructor(readonly base: THREE.Object3D, readonly tip: THREE.Object3D, readonly length: number) {}
  setActive(active: boolean): void {
    this.active = !!active;
  }
  setColor(color: number): void {
    _c.setHex(color);
    this.r = _c.r; this.g = _c.g; this.b = _c.b;
  }
  remove(): void {
    this.removed = true;
    this.active = false;
  }
  /** sample index i (0 = newest) → ring slot */
  slot(i: number): number {
    return (this.head - i + SAMPLES * 2) % SAMPLES;
  }
}

export class TrailRenderer {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private buf = new Float32Array(0);
  private ibuf!: THREE.InterleavedBuffer;
  private capacity = 0;
  private readonly mat: THREE.ShaderMaterial;
  private readonly trails: Trail[] = [];
  private time = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      name: 'vfx-trails', vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'vfx-trails';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 896;
    this.mesh.visible = false;
    this.grow(8);
  }

  get count(): number {
    return this.trails.length;
  }

  /** (re)allocate buffers for `n` trails — only when a new trail exceeds the capacity */
  private grow(n: number): void {
    this.capacity = n;
    this.buf = new Float32Array(n * VPT * STRIDE);
    this.ibuf = new THREE.InterleavedBuffer(this.buf, STRIDE);
    this.ibuf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.ibuf, 3, 0));
    geo.setAttribute('aUv', new THREE.InterleavedBufferAttribute(this.ibuf, 2, 3));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.ibuf, 4, 5));
    const idx = new Uint16Array(n * (SECTIONS - 1) * 6);
    for (let t = 0; t < n; t++) {
      for (let s = 0; s < SECTIONS - 1; s++) {
        const v = t * VPT + s * 2, o = (t * (SECTIONS - 1) + s) * 6;
        idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
        idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo.dispose();
    this.geo = geo;
    this.mesh.geometry = geo;
  }

  /**
   * @param length seconds a sample persists (ribbon length in time), default 0.24
   */
  create(base: THREE.Object3D, tip: THREE.Object3D, color: number | undefined, length: number | undefined): TrailHandle {
    const t = new Trail(base, tip, length !== undefined && length > 0 ? length : 0.24);
    t.setColor(color ?? 0xfff0dc);
    this.trails.push(t);
    if (this.trails.length > this.capacity) this.grow(this.capacity * 2);
    return t;
  }

  update(dt: number): void {
    this.time += dt;
    const now = this.time;
    let drawn = 0, w = 0;
    for (let i = 0; i < this.trails.length; i++) {
      const t = this.trails[i];
      // drop expired samples from the tail
      while (t.count > 0 && now - t.born[t.slot(t.count - 1)] > t.length) t.count--;
      if (t.removed && t.count === 0) continue;
      this.trails[w++] = t;
      if (t.active && dt > 0 && t.base && t.tip) {
        t.base.getWorldPosition(_a);
        t.tip.getWorldPosition(_b);
        if (Number.isFinite(_a.x + _a.y + _a.z + _b.x + _b.y + _b.z)) {
          t.head = (t.head + 1) % SAMPLES;
          const o = t.head * 6;
          t.pts[o] = _a.x; t.pts[o + 1] = _a.y; t.pts[o + 2] = _a.z;
          t.pts[o + 3] = _b.x; t.pts[o + 4] = _b.y; t.pts[o + 5] = _b.z;
          t.born[t.head] = now;
          if (t.count < SAMPLES) t.count++;
        }
      }
      if (t.count >= 2 && drawn < this.capacity) this.write(drawn++, t, now);
    }
    this.trails.length = w;
    this.mesh.visible = drawn > 0;
    this.geo.setDrawRange(0, drawn * (SECTIONS - 1) * 6);
    if (drawn > 0) {
      this.ibuf.clearUpdateRanges();
      this.ibuf.addUpdateRange(0, drawn * VPT * STRIDE);
      this.ibuf.needsUpdate = true;
    }
  }

  private write(index: number, t: Trail, now: number): void {
    const buf = this.buf, pts = t.pts, n = t.count;
    let o = index * VPT * STRIDE;
    const sections = (n - 1) * SUB + 1;
    for (let s = 0; s < SECTIONS; s++) {
      // sections beyond the live range collapse onto the last one (degenerate, invisible)
      const sc = Math.min(s, sections - 1);
      const seg = Math.min(n - 2, Math.floor(sc / SUB));
      const f = sc / SUB - seg;
      const i0 = t.slot(Math.max(0, seg - 1)) * 6, i1 = t.slot(seg) * 6, i2 = t.slot(seg + 1) * 6, i3 = t.slot(Math.min(n - 1, seg + 2)) * 6;
      const age = (now - (t.born[t.slot(seg)] * (1 - f) + t.born[t.slot(seg + 1)] * f)) / t.length;
      const u = Math.min(1, Math.max(0, age));
      // taper: the base slides toward the tip as the sample ages
      const taper = u * 0.75;
      for (let side = 0; side < 2; side++) {
        const k = side * 3;
        let x = catmull(pts[i0 + k], pts[i1 + k], pts[i2 + k], pts[i3 + k], f);
        let y = catmull(pts[i0 + k + 1], pts[i1 + k + 1], pts[i2 + k + 1], pts[i3 + k + 1], f);
        let z = catmull(pts[i0 + k + 2], pts[i1 + k + 2], pts[i2 + k + 2], pts[i3 + k + 2], f);
        if (side === 0) {
          const tx = catmull(pts[i0 + 3], pts[i1 + 3], pts[i2 + 3], pts[i3 + 3], f);
          const ty = catmull(pts[i0 + 4], pts[i1 + 4], pts[i2 + 4], pts[i3 + 4], f);
          const tz = catmull(pts[i0 + 5], pts[i1 + 5], pts[i2 + 5], pts[i3 + 5], f);
          x += (tx - x) * taper; y += (ty - y) * taper; z += (tz - z) * taper;
        }
        buf[o] = x; buf[o + 1] = y; buf[o + 2] = z;
        buf[o + 3] = u; buf[o + 4] = side;
        buf[o + 5] = t.r; buf[o + 6] = t.g; buf[o + 7] = t.b; buf[o + 8] = s < sections ? t.intensity : 0;
        o += STRIDE;
      }
    }
  }

  /** Drop every live ribbon. Trails stay registered — they belong to their weapon and end with remove(). */
  clear(): void {
    for (const t of this.trails) { t.count = 0; t.active = false; }
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
