/**
 * Beams + tracers — every ribbon lives in ONE dynamic mesh (one draw call): camera-facing strips expanded in the
 * vertex shader, with a per-style procedural pattern in the fragment shader.
 *
 * Style language (colour never carries the meaning alone):
 *   link    violet, sags, sheath of scrolling noise, heartbeat pulses running source → target
 *   laser   hair-thin hot core, steady (aim lane telegraph)
 *   scan    soft cold band with perpendicular tick marks and a sweeping node
 *   tether  still, pale; static crystalline nodes along its length
 *   command thin line with fast evenly spaced packets from → to (synchronisation)
 *   relay   twin rails with paired slower packets
 *   trace   dotted chevrons marching from `from` toward `to` (the source) — brighter toward the source
 *   gold    clean warm hairline with stepped "information" blocks gliding along it
 */
import * as THREE from 'three';
import type { BeamHandle, BeamStyle, Vec3Like } from '@/core/api';

const SEG = 16;
const VPR = (SEG + 1) * 2; // vertices per ribbon
const MAX_RIBBONS = 56;
const STRIDE = 14; // pos3 dir3 data0(4) data1(4)

interface StyleDef { id: number; color: number; width: number; sag: number; intensity: number }
const STYLES: Record<BeamStyle, StyleDef> = {
  link: { id: 0, color: 0x8a4cff, width: 0.2, sag: 0.1, intensity: 1.6 },
  laser: { id: 1, color: 0xff4a30, width: 0.05, sag: 0, intensity: 2.4 },
  scan: { id: 2, color: 0xa8d8ff, width: 0.12, sag: 0, intensity: 1.0 },
  tether: { id: 3, color: 0xcfeeff, width: 0.1, sag: 0.015, intensity: 1.3 },
  command: { id: 4, color: 0xa8d8ff, width: 0.07, sag: 0, intensity: 1.5 },
  relay: { id: 5, color: 0x9d8cff, width: 0.11, sag: 0, intensity: 1.3 },
  trace: { id: 6, color: 0xffe2a8, width: 0.2, sag: 0, intensity: 1.1 },
  gold: { id: 7, color: 0xffc56b, width: 0.1, sag: 0, intensity: 1.5 },
};
const TRACER_STYLE = 8;

export type TracerStyle = 'warm' | 'cold' | 'drone' | 'violet' | 'rifle';
interface TracerDef { color: number; width: number; speed: number; tail: number; intensity: number }
const TRACERS: Record<TracerStyle, TracerDef> = {
  warm: { color: 0xffa24a, width: 0.09, speed: 150, tail: 5, intensity: 3 },
  cold: { color: 0xbfe6ff, width: 0.05, speed: 320, tail: 9, intensity: 3.2 },
  drone: { color: 0x9ad0ff, width: 0.11, speed: 60, tail: 1.8, intensity: 2.8 },
  violet: { color: 0x9a5cff, width: 0.14, speed: 34, tail: 1.6, intensity: 2.6 },
  rifle: { color: 0xfff2dc, width: 0.07, speed: 520, tail: 16, intensity: 4 },
};

const VERT = /* glsl */ `
attribute vec3 aDir;
attribute vec4 aData0; // u, side, width, style
attribute vec4 aData1; // intensity, length (m), phase, head u
attribute vec3 aColor;
uniform float uPixel; // world metres per pixel at unit depth
varying vec2 vUv;
varying vec4 vData;   // style, intensity, length, phase
varying vec3 vColor;
varying float vHead;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mvPosition = viewMatrix * vec4(position, 1.0);
  vec3 tv = (viewMatrix * vec4(aDir, 0.0)).xyz;
  vec3 side = cross(normalize(tv + vec3(1e-5, 0.0, 0.0)), normalize(mvPosition.xyz));
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  // never thinner than ~1.6 px so distant lasers do not shimmer
  float w = max(aData0.z, -mvPosition.z * uPixel * 1.6);
  mvPosition.xyz += side * aData0.y * w * 0.5;
  gl_Position = projectionMatrix * mvPosition;
  vUv = vec2(aData0.x, aData0.y);
  vData = vec4(aData0.w, aData1.x * (aData0.z / w), aData1.y, aData1.z);
  vHead = aData1.w;
  vColor = aColor;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vData;
varying vec3 vColor;
varying float vHead;
#include <common>
// pow() is undefined for negative bases in GLSL (NaN on real GPUs → bloom explosions); always go through pw()
float pw(float b, float e) { return pow(abs(b), e); }
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  #include <logdepthbuf_fragment>
  float u = clamp(vUv.x, 0.0, 1.0), v = clamp(vUv.y, -1.0, 1.0), style = vData.x, len = vData.z, phase = vData.w;
  float s = u * len;                 // metres from the 'from' end
  float av = abs(v);
  float t = uTime + phase;
  float ends = smoothstep(0.0, 0.12, s) * smoothstep(0.0, 0.12, len - s);
  float m = 0.0;                      // intensity
  float white = 0.0;                  // 0..1 push toward white-hot
  if (style < 0.5) {
    // link
    float core = exp(-av * av * 60.0);
    float n = vn(vec2(s * 2.2 - t * 1.4, v * 2.0 + phase * 7.0));
    float n2 = vn(vec2(s * 5.0 + t * 0.7, v * 3.0));
    float sheath = exp(-av * av * 5.0) * smoothstep(0.25, 0.85, n * 0.7 + n2 * 0.5) * 0.7;
    float beat = pw(0.5 + 0.5 * sin(6.2831853 * (t * 0.95)), 10.0) + 0.55 * pw(0.5 + 0.5 * sin(6.2831853 * (t * 0.95 - 0.18)), 10.0);
    float run = pw(0.5 + 0.5 * sin(6.2831853 * (s * 0.35 - t * 0.95)), 8.0);
    m = core * (0.55 + 0.9 * run + 0.5 * beat) + sheath * (0.6 + 0.6 * beat);
    white = core * run * 0.75;
  } else if (style < 1.5) {
    // laser
    float core = exp(-av * av * 26.0);
    float halo = exp(-av * 3.2) * 0.25;
    float shimmer = 0.9 + 0.1 * vn(vec2(s * 9.0 - t * 12.0, 0.0));
    m = (core + halo) * shimmer;
    white = exp(-av * av * 160.0) * 0.85;
  } else if (style < 2.5) {
    // scan
    float band = exp(-av * av * 6.0) * 0.55;
    float core = exp(-av * av * 90.0) * 0.8;
    float ticks = step(0.82, fract(s * 4.0)) * step(av, 0.8) * 0.5;
    float node = exp(-pw((u - (0.5 + 0.5 * sin(t * 1.3))) * len * 1.6, 2.0));
    m = band + core + ticks + node * 1.4 * exp(-av * av * 8.0);
    white = node * 0.5;
  } else if (style < 3.5) {
    // tether — still; static crystal nodes, slow glints
    float core = exp(-av * av * 40.0);
    float cell = fract(s / 0.55) - 0.5;
    float id = floor(s / 0.55);
    float dia = 1.0 - smoothstep(0.0, 0.05, abs(cell) * 0.55 * 2.4 + av * 0.5 - 0.42 * (0.4 + 0.6 * h11(id + phase * 31.0)));
    float glint = pw(0.5 + 0.5 * sin(t * 0.8 + h11(id) * 30.0), 16.0);
    m = core * 0.9 + dia * (0.7 + glint * 1.6) + exp(-av * 3.0) * 0.12;
    white = dia * glint;
  } else if (style < 4.5) {
    // command — evenly spaced fast packets
    float core = exp(-av * av * 30.0);
    float f = fract(s / 1.3 - t * 3.2);
    float packet = smoothstep(0.78, 0.82, f) * (1.0 - smoothstep(0.96, 1.0, f));
    m = core * 0.35 + packet * exp(-av * av * 9.0) * 1.7;
    white = packet * 0.5 * exp(-av * av * 30.0);
  } else if (style < 5.5) {
    // relay — twin rails, paired packets
    float rails = exp(-pw((av - 0.62) * 9.0, 2.0));
    float f = fract(s / 1.9 - t * 1.1);
    float pair = (smoothstep(0.7, 0.73, f) - smoothstep(0.77, 0.8, f)) + (smoothstep(0.86, 0.89, f) - smoothstep(0.93, 0.96, f));
    m = rails * 0.55 + pair * step(av, 0.5) * 1.5 * (1.0 - av);
    white = pair * 0.3 * step(av, 0.3);
  } else if (style < 6.5) {
    // trace — chevrons marching toward 'to'; brighter near the source end
    float f = fract(s / 0.7 - t * 1.6);
    float d = abs(f - 0.45 + av * 0.34) - 0.09;
    float chev = (1.0 - smoothstep(0.0, 0.04, d)) * step(av, 0.92);
    float toward = 0.35 + 0.65 * u;
    m = chev * 1.25 * toward + exp(-av * av * 60.0) * 0.14;
  } else if (style < 7.5) {
    // gold — hairline + gliding information blocks
    float core = exp(-av * av * 50.0);
    float railsG = exp(-pw((av - 0.7) * 14.0, 2.0)) * 0.3;
    float cellS = s / 0.42 - t * 0.9;
    float blk = step(0.55, h11(floor(cellS) + phase * 13.0)) * step(0.12, fract(cellS)) * step(fract(cellS), 0.88);
    m = core * 0.85 + railsG + blk * step(av, 0.5) * 0.9;
    white = core * blk * 0.6;
  } else {
    // tracer — bright head at vHead, tail fading behind it over vData.w metres (phase slot = tail length)
    float tail = max(0.05, phase);
    float behind = (vHead - u) * len;
    float body = behind >= 0.0 ? exp(-behind / tail * 3.2) : 0.0;
    float head = exp(-pw(behind * 5.0, 2.0)) * step(-0.25, behind);
    float across = exp(-av * av * (10.0 + 30.0 * clamp(behind / tail, 0.0, 1.0)));
    m = (body * 0.8 + head * 1.8) * across;
    white = head * across * 0.9;
    ends = 1.0;
  }
  vec3 col = mix(vColor, vec3(max(vColor.r, max(vColor.g, vColor.b))), clamp(white, 0.0, 1.0)) * m * vData.y * ends;
  float fogFactor = 0.0;
#ifdef USE_FOG
  #ifdef FOG_EXP2
    fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
  if (col.r + col.g + col.b < 0.003) discard;
  gl_FragColor = vec4(col * (1.0 - fogFactor * 0.8), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();

function readEnd(src: Vec3Like | THREE.Object3D, out: THREE.Vector3): void {
  if ((src as THREE.Object3D).isObject3D) (src as THREE.Object3D).getWorldPosition(out);
  else out.set((src as Vec3Like).x, (src as Vec3Like).y, (src as Vec3Like).z);
}

class Beam implements BeamHandle {
  alive = true;
  readonly a = new THREE.Vector3();
  readonly b = new THREE.Vector3();
  objA: THREE.Object3D | null = null;
  objB: THREE.Object3D | null = null;
  intensity = 1;
  /** eased display intensity */
  shown = 0;
  fadeLeft = -1;
  fadeTotal = 0.25;
  r = 1; g = 1; bl = 1;
  constructor(readonly style: StyleDef, public width: number, readonly phase: number) {}
  setEnds(from: Vec3Like, to: Vec3Like): void {
    if (!from || !to) return;
    this.objA = this.objB = null;
    this.a.set(from.x, from.y, from.z);
    this.b.set(to.x, to.y, to.z);
  }
  setIntensity(n: number): void {
    this.intensity = Number.isFinite(n) ? Math.max(0, Math.min(1.5, n)) : 1;
  }
  setColor(color: number): void {
    _c.setHex(color);
    this.r = _c.r; this.g = _c.g; this.bl = _c.b;
  }
  remove(fadeSeconds = 0.25): void {
    if (this.fadeLeft >= 0) return;
    this.fadeTotal = Math.max(1e-3, fadeSeconds);
    this.fadeLeft = this.fadeTotal;
  }
}

interface Tracer {
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  len: number; age: number; travel: number; def: TracerDef; r: number; g: number; b: number;
}

/** All beams and tracers; one mesh. */
export class BeamRenderer {
  readonly mesh: THREE.Mesh;
  private readonly geo = new THREE.BufferGeometry();
  private readonly buf = new Float32Array(MAX_RIBBONS * VPR * STRIDE);
  private readonly colors = new Float32Array(MAX_RIBBONS * VPR * 3);
  private readonly ibuf: THREE.InterleavedBuffer;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly mat: THREE.ShaderMaterial;
  private readonly beams: Beam[] = [];
  private readonly tracers: Tracer[] = [];
  private readonly tracerPool: Tracer[] = [];
  private time = 0;
  private seq = 0;

  constructor() {
    this.ibuf = new THREE.InterleavedBuffer(this.buf, STRIDE);
    this.ibuf.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', new THREE.InterleavedBufferAttribute(this.ibuf, 3, 0));
    this.geo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(this.ibuf, 3, 3));
    this.geo.setAttribute('aData0', new THREE.InterleavedBufferAttribute(this.ibuf, 4, 6));
    this.geo.setAttribute('aData1', new THREE.InterleavedBufferAttribute(this.ibuf, 4, 10));
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aColor', this.colorAttr);
    const idx = new Uint16Array(MAX_RIBBONS * SEG * 6);
    for (let r = 0; r < MAX_RIBBONS; r++) {
      for (let s = 0; s < SEG; s++) {
        const v = r * VPR + s * 2, o = (r * SEG + s) * 6;
        idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
        idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2;
      }
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      name: 'vfx-beams', vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uPixel: { value: 0.001 } },
      transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'vfx-beams';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 895;
    this.mesh.visible = false;
    const size = new THREE.Vector2();
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(size);
      const p = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
      this.mat.uniforms.uPixel.value = 2 / (Math.max(0.01, p) * Math.max(1, size.y));
    };
  }

  get counts(): { beams: number; tracers: number } {
    return { beams: this.beams.length, tracers: this.tracers.length };
  }

  beam(from: Vec3Like | THREE.Object3D, to: Vec3Like | THREE.Object3D, style: BeamStyle, color?: number, width?: number): Beam {
    const def = STYLES[style] ?? STYLES.laser;
    this.seq = (this.seq + 1) % 127;
    // synchronisation beams share phase 0 so their packets visibly move together
    const phase = style === 'command' ? 0 : (this.seq * 0.6180339887) % 1;
    const b = new Beam(def, width !== undefined && width > 0 ? width : def.width, phase);
    b.setColor(color ?? def.color);
    if (from && (from as THREE.Object3D).isObject3D) b.objA = from as THREE.Object3D;
    if (to && (to as THREE.Object3D).isObject3D) b.objB = to as THREE.Object3D;
    if (from) readEnd(from, b.a);
    if (to) readEnd(to, b.b);
    if (this.beams.length >= MAX_RIBBONS - 16) {
      const old = this.beams.shift();
      if (old) old.alive = false;
    }
    this.beams.push(b);
    return b;
  }

  tracer(from: Vec3Like, to: Vec3Like, style: TracerStyle, speed?: number): void {
    if (!from || !to) return;
    const def = TRACERS[style] ?? TRACERS.warm;
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (!(len > 1e-3)) return;
    if (this.tracers.length >= 24) this.tracerPool.push(this.tracers.shift() as Tracer);
    const t = this.tracerPool.pop() ?? { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, len: 0, age: 0, travel: 0, def, r: 1, g: 1, b: 1 };
    t.ax = from.x; t.ay = from.y; t.az = from.z; t.bx = to.x; t.by = to.y; t.bz = to.z;
    t.len = len; t.age = 0; t.def = def;
    t.travel = len / Math.max(1, speed !== undefined && speed > 0 ? speed : def.speed);
    _c.setHex(def.color);
    t.r = _c.r; t.g = _c.g; t.b = _c.b;
    this.tracers.push(t);
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    let ribbons = 0;

    let w = 0;
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      if (b.fadeLeft >= 0) {
        b.fadeLeft -= dt;
        if (b.fadeLeft <= 0) { b.alive = false; continue; }
      }
      this.beams[w++] = b;
      if (b.objA) b.objA.getWorldPosition(b.a);
      if (b.objB) b.objB.getWorldPosition(b.b);
      // ease toward the requested intensity (fade-in on creation, no popping on setIntensity)
      b.shown += (b.intensity - b.shown) * Math.min(1, dt * 14);
      const fade = b.fadeLeft >= 0 ? b.fadeLeft / b.fadeTotal : 1;
      if (ribbons < MAX_RIBBONS) {
        this.writeRibbon(ribbons++, b.a, b.b, b.style.id, b.width * (0.6 + 0.4 * Math.min(1, b.shown)) * (0.5 + 0.5 * fade),
          b.style.intensity * b.shown * fade, b.phase, 1, b.style.sag, b.r, b.g, b.bl);
      }
    }
    this.beams.length = w;

    w = 0;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      t.age += dt;
      const linger = 0.1 + t.def.tail / Math.max(60, t.def.speed) * 0.5;
      if (t.age >= t.travel + linger) { this.tracerPool.push(t); continue; }
      this.tracers[w++] = t;
      const head = Math.min(1, t.age / t.travel);
      const fade = t.age > t.travel ? Math.max(0, 1 - (t.age - t.travel) / linger) : 1;
      if (ribbons < MAX_RIBBONS) {
        _a.set(t.ax, t.ay, t.az); _b.set(t.bx, t.by, t.bz);
        this.writeRibbon(ribbons++, _a, _b, TRACER_STYLE, t.def.width, t.def.intensity * fade, t.def.tail, head, 0, t.r, t.g, t.b);
      }
    }
    this.tracers.length = w;

    this.mesh.visible = ribbons > 0;
    this.geo.setDrawRange(0, ribbons * SEG * 6);
    if (ribbons > 0) {
      this.ibuf.clearUpdateRanges();
      this.ibuf.addUpdateRange(0, ribbons * VPR * STRIDE);
      this.ibuf.needsUpdate = true;
      this.colorAttr.clearUpdateRanges();
      this.colorAttr.addUpdateRange(0, ribbons * VPR * 3);
      this.colorAttr.needsUpdate = true;
    }
  }

  private writeRibbon(index: number, a: THREE.Vector3, b: THREE.Vector3, style: number, width: number, intensity: number,
    phase: number, head: number, sag: number, r: number, g: number, bl: number): void {
    const buf = this.buf, col = this.colors;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.max(1e-4, Math.hypot(dx, dy, dz));
    const drop = Math.min(0.9, sag * len);
    const sway = drop > 0 ? Math.sin(this.time * 0.9 + phase * 20) * drop * 0.18 : 0;
    // horizontal perpendicular for the sway
    const hl = Math.hypot(dx, dz) || 1;
    const sx = -dz / hl, sz = dx / hl;
    let o = index * VPR * STRIDE, c = index * VPR * 3;
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG;
      const k = 4 * u * (1 - u);
      const px = a.x + dx * u + sx * sway * k, py = a.y + dy * u - drop * k, pz = a.z + dz * u + sz * sway * k;
      // tangent of the sagging curve
      const dk = 4 * (1 - 2 * u);
      const tx = dx + sx * sway * dk, ty = dy - drop * dk, tz = dz + sz * sway * dk;
      for (let side = -1; side <= 1; side += 2) {
        buf[o] = px; buf[o + 1] = py; buf[o + 2] = pz;
        buf[o + 3] = tx; buf[o + 4] = ty; buf[o + 5] = tz;
        buf[o + 6] = u; buf[o + 7] = side; buf[o + 8] = width; buf[o + 9] = style;
        buf[o + 10] = intensity; buf[o + 11] = len; buf[o + 12] = phase; buf[o + 13] = head;
        col[c] = r; col[c + 1] = g; col[c + 2] = bl;
        o += STRIDE; c += 3;
      }
    }
  }

  clear(): void {
    for (const b of this.beams) b.alive = false;
    this.beams.length = 0;
    while (this.tracers.length) this.tracerPool.push(this.tracers.pop() as Tracer);
    this.geo.setDrawRange(0, 0);
    this.mesh.visible = false;
  }
}
