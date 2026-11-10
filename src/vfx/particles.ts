/**
 * Particle core — four pooled instanced-billboard layers (additive, alpha, lit-soft, stretched = 4 draw calls),
 * simulated on the CPU in typed arrays with swap-remove pools and zero per-frame allocation.
 *
 * Effects talk to the core through SLOTS: a slot carries the owning effect's origin (for follow/attract/orbit),
 * floor height (bounce + soft floor fade), tint and a live-particle counter (so an effect knows when it is done).
 */
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, spriteIndex } from './atlas';
import type { LayerId, ParticleDef, Range } from './defs';
import { PARTICLE_FRAG, PARTICLE_VERT } from './shaders';

export const STRIDE = 16;
export const LAYER_IDS: readonly LayerId[] = ['add', 'alpha', 'lit', 'stretch'];
/** live-particle budget per layer (≈ 6k total at High) */
export const LAYER_CAP: Readonly<Record<LayerId, number>> = { add: 2800, alpha: 900, lit: 700, stretch: 1600 };
export const MAX_SLOTS = 256;
const NO_FLOOR = -1e6;
const SORT_BUCKETS = 64;

const lo = (r: Range | undefined, d: number): number => (r === undefined ? d : typeof r === 'number' ? r : r[0]);
const hi = (r: Range | undefined, d: number): number => (r === undefined ? d : typeof r === 'number' ? r : r[1]);

/** ParticleDef flattened to numbers for the hot loop. */
export interface CompiledParticle {
  readonly index: number;
  readonly layer: number;
  readonly frames: Uint8Array;
  life0: number; life1: number;
  s0: number; s1: number; s2: number; sMid: number;
  sr0: number; sr1: number;
  aspect: number;
  /** 3 linear RGB keys premultiplied by intensity */
  c: Float32Array; cMid: number;
  alpha: number; fadeIn: number; fadeOut: number;
  gravity: number; drag: number;
  rot0: number; rot1: number;
  spin0: number; spin1: number; spinSigned: boolean;
  stretch: number;
  turb: number; turbFreq: number; unison: boolean;
  attract: number; orbit: number; follow: boolean;
  bounce: number; floorFade: boolean; flicker: number;
  facing: number; tint: number; glow: number;
  /** any force that needs the slot origin */
  needsOrigin: boolean;
  /** short additive bloom sprite — dimmed by the reduceFlash accessibility setting */
  isFlash: boolean;
}

const _col = new THREE.Color();

function compile(def: ParticleDef, index: number): CompiledParticle {
  const names = typeof def.sprite === 'string' ? [def.sprite] : def.sprite;
  const frames = new Uint8Array(names.length);
  for (let i = 0; i < names.length; i++) frames[i] = spriteIndex(names[i]);
  const size = typeof def.size === 'number' ? [def.size, def.size, def.size] : def.size;
  const c = new Float32Array(9);
  for (let k = 0; k < 3; k++) {
    const key = def.color[Math.min(k, def.color.length - 1)];
    // with two keys the middle one is the first (hold, then cool)
    const use = def.color.length === 2 && k === 1 ? def.color[0] : key;
    _col.setHex(use[0]);
    c[k * 3] = _col.r * use[1]; c[k * 3 + 1] = _col.g * use[1]; c[k * 3 + 2] = _col.b * use[1];
  }
  const attract = def.attract ?? 0, orbit = def.orbit ?? 0, follow = def.follow ?? false;
  return {
    index, layer: LAYER_IDS.indexOf(def.layer), frames,
    life0: lo(def.life, 1), life1: hi(def.life, 1),
    s0: size[0], s1: size[1], s2: size[2], sMid: def.sizeMid ?? 0.3,
    sr0: lo(def.sizeRand, 0.75), sr1: hi(def.sizeRand, 1.25),
    aspect: def.aspect ?? 1,
    c, cMid: def.colorMid ?? 0.4,
    alpha: def.alpha ?? 1, fadeIn: Math.max(1e-4, def.fadeIn ?? 0.06), fadeOut: Math.min(0.999, def.fadeOut ?? 0.55),
    gravity: def.gravity ?? 0, drag: def.drag ?? 0,
    rot0: lo(def.rot, 0), rot1: hi(def.rot, Math.PI * 2),
    spin0: lo(def.spin, 0), spin1: hi(def.spin, 0), spinSigned: typeof def.spin === 'number',
    stretch: def.stretch ?? 0.04,
    turb: def.turb ?? 0, turbFreq: def.turbFreq ?? 1, unison: def.unison ?? false,
    attract, orbit, follow,
    bounce: def.bounce ?? 0, floorFade: def.floorFade ?? false, flicker: def.flicker ?? 0,
    facing: def.facing === 'ground' ? 1 : def.facing === 'upright' ? 2 : 0,
    tint: def.tint ?? 1, glow: def.glow ?? 0,
    needsOrigin: attract !== 0 || orbit !== 0 || follow,
    isFlash: def.layer === 'add' && hi(def.life, 1) <= 0.3 && names.every((n) => n === 'glow' || n === 'spark' || n === 'flare'),
  };
}

/** One draw call worth of particles. */
class Layer {
  count = 0;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** sizeMul, rot, spin, seed */
  readonly rnd: Float32Array;
  readonly def: Uint16Array;
  readonly slot: Uint16Array;
  readonly frame: Uint8Array;
  readonly buf: Float32Array;
  readonly ibuf: THREE.InstancedInterleavedBuffer;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly mat: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  // depth sort scratch (alpha / lit only)
  readonly order: Uint16Array;
  readonly depth: Float32Array;
  readonly bucketStart = new Uint16Array(SORT_BUCKETS + 1);
  readonly bucketFill = new Uint16Array(SORT_BUCKETS);

  constructor(readonly id: LayerId, readonly cap: number, atlas: THREE.Texture, shared: SharedUniforms) {
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.rnd = new Float32Array(cap * 4);
    this.def = new Uint16Array(cap);
    this.slot = new Uint16Array(cap);
    this.frame = new Uint8Array(cap);
    this.buf = new Float32Array(cap * STRIDE);
    this.order = new Uint16Array(cap);
    this.depth = new Float32Array(cap);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.ibuf = new THREE.InstancedInterleavedBuffer(this.buf, STRIDE);
    this.ibuf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPosSize', new THREE.InterleavedBufferAttribute(this.ibuf, 4, 0));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(this.ibuf, 4, 4));
    geo.setAttribute('iMisc', new THREE.InterleavedBufferAttribute(this.ibuf, 4, 8));
    geo.setAttribute('iVel', new THREE.InterleavedBufferAttribute(this.ibuf, 4, 12));
    geo.instanceCount = 0;
    this.geo = geo;

    const additive = id === 'add' || id === 'stretch';
    const defines: Record<string, string> = {};
    if (additive) defines.ADDITIVE = '';
    if (id === 'stretch') defines.STRETCH = '';
    if (id === 'lit') defines.LIT = '';
    const uniforms: Record<string, THREE.IUniform> = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: atlas },
      uGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      uPixel: { value: 0.001 },
      uDepth: shared.uDepth, uResolution: shared.uResolution, uNearFar: shared.uNearFar,
    };
    if (id === 'lit') {
      uniforms.uAmbient = shared.uAmbient; uniforms.uKeyDir = shared.uKeyDir; uniforms.uKeyColor = shared.uKeyColor;
      uniforms.uFlashPos = shared.uFlashPos; uniforms.uFlashColor = shared.uFlashColor;
    }
    this.mat = new THREE.ShaderMaterial({
      name: `vfx-particles-${id}`,
      vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, uniforms, defines,
      transparent: true, depthWrite: false, depthTest: true, fog: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: additive ? THREE.ZeroFactor : THREE.OneFactor, blendDstAlpha: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = `vfx-particles-${id}`;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // smoke under glow: lit, alpha, then additive layers
    this.mesh.renderOrder = 900 + (id === 'lit' ? 0 : id === 'alpha' ? 1 : id === 'add' ? 2 : 3);
    const size = new THREE.Vector2();
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(size);
      const p = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
      uniforms.uPixel.value = 2 / (Math.max(0.01, p) * Math.max(1, size.y));
    };
  }

  kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const p = this.pos, v = this.vel, r = this.rnd;
    const i3 = i * 3, l3 = last * 3, i4 = i * 4, l4 = last * 4;
    p[i3] = p[l3]; p[i3 + 1] = p[l3 + 1]; p[i3 + 2] = p[l3 + 2];
    v[i3] = v[l3]; v[i3 + 1] = v[l3 + 1]; v[i3 + 2] = v[l3 + 2];
    r[i4] = r[l4]; r[i4 + 1] = r[l4 + 1]; r[i4 + 2] = r[l4 + 2]; r[i4 + 3] = r[l4 + 3];
    this.age[i] = this.age[last]; this.life[i] = this.life[last];
    this.def[i] = this.def[last]; this.slot[i] = this.slot[last]; this.frame[i] = this.frame[last];
  }
}

interface SharedUniforms {
  uAmbient: { value: THREE.Vector3 };
  uKeyDir: { value: THREE.Vector3 };
  uKeyColor: { value: THREE.Vector3 };
  uFlashPos: { value: Float32Array };
  uFlashColor: { value: Float32Array };
  uDepth: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uNearFar: { value: THREE.Vector2 };
}

/** Pooled particle renderer + simulator shared by every effect. */
export class ParticleCore {
  readonly group = new THREE.Group();
  private readonly layers: Layer[];
  private readonly defs: CompiledParticle[] = [];
  private readonly defIndex = new Map<ParticleDef, CompiledParticle>();
  private time = 0;
  private seed = 0x9e3779b9;
  /** brightness multiplier for flash sprites (1 normally, lower with settings.reduceFlash) */
  flashScale = 1;

  // slots — slot 0 is the shared "world" slot (no origin, no floor, no tint)
  readonly slotOrigin = new Float32Array(MAX_SLOTS * 3);
  readonly slotDelta = new Float32Array(MAX_SLOTS * 3);
  readonly slotFloor = new Float32Array(MAX_SLOTS).fill(NO_FLOOR);
  /** r, g, b (linear, luminance-normalised), amount 0..1 */
  readonly slotTint = new Float32Array(MAX_SLOTS * 4);
  readonly slotLive = new Int32Array(MAX_SLOTS);
  private readonly freeSlots: number[] = [];

  // camera for depth sorting (optional)
  private camX = 0; private camY = 0; private camZ = 0;
  private fwdX = 0; private fwdY = 0; private fwdZ = -1;
  private hasCamera = false;

  /** uniforms shared with the flash-light pool and the scene-light probe */
  readonly shared: SharedUniforms = {
    uAmbient: { value: new THREE.Vector3(0.08, 0.08, 0.09) },
    uKeyDir: { value: new THREE.Vector3(0.4, 0.8, 0.4).normalize() },
    uKeyColor: { value: new THREE.Vector3(0.4, 0.38, 0.34) },
    uFlashPos: { value: new Float32Array(16) },
    uFlashColor: { value: new Float32Array(12) },
    uDepth: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNearFar: { value: new THREE.Vector2(0.1, 1000) },
  };

  constructor(atlas: THREE.Texture) {
    this.group.name = 'vfx-particles';
    this.layers = LAYER_IDS.map((id) => new Layer(id, LAYER_CAP[id], atlas, this.shared));
    for (const l of this.layers) this.group.add(l.mesh);
    for (let s = MAX_SLOTS - 1; s >= 1; s--) this.freeSlots.push(s);
  }

  /** fast xorshift in [0,1) — visual variation only (deterministic per session) */
  rand(): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }

  /** Compile (and cache) a particle definition. */
  register(def: ParticleDef): CompiledParticle {
    let c = this.defIndex.get(def);
    if (!c) {
      c = compile(def, this.defs.length);
      this.defs.push(c);
      this.defIndex.set(def, c);
    }
    return c;
  }

  /** Reserve a slot for an effect. Returns 0 (shared world slot) when exhausted. */
  allocSlot(x: number, y: number, z: number, floorY: number | null): number {
    const s = this.freeSlots.pop();
    if (s === undefined) return 0;
    const s3 = s * 3;
    this.slotOrigin[s3] = x; this.slotOrigin[s3 + 1] = y; this.slotOrigin[s3 + 2] = z;
    this.slotDelta[s3] = this.slotDelta[s3 + 1] = this.slotDelta[s3 + 2] = 0;
    this.slotFloor[s] = floorY ?? NO_FLOOR;
    this.slotTint[s * 4 + 3] = 0;
    this.slotLive[s] = 0;
    return s;
  }

  freeSlot(s: number): void {
    if (s > 0) this.freeSlots.push(s);
  }

  /** Tint every tintable particle of the slot toward `hex` (luminance preserved). */
  setSlotTint(s: number, hex: number): void {
    if (s <= 0) return;
    _col.setHex(hex);
    const lum = Math.max(1e-3, 0.2126 * _col.r + 0.7152 * _col.g + 0.0722 * _col.b);
    // normalise so that a mid-luminance hue keeps the authored brightness, but never blow up dark hues
    const k = 1 / Math.max(lum, 0.25);
    const t = s * 4;
    this.slotTint[t] = _col.r * k; this.slotTint[t + 1] = _col.g * k; this.slotTint[t + 2] = _col.b * k; this.slotTint[t + 3] = 1;
  }

  /** Move a slot's origin; `follow` particles are carried by the delta on the next update. */
  moveSlot(s: number, x: number, y: number, z: number): void {
    if (s <= 0) return;
    const s3 = s * 3;
    this.slotDelta[s3] += x - this.slotOrigin[s3];
    this.slotDelta[s3 + 1] += y - this.slotOrigin[s3 + 1];
    this.slotDelta[s3 + 2] += z - this.slotOrigin[s3 + 2];
    this.slotOrigin[s3] = x; this.slotOrigin[s3 + 1] = y; this.slotOrigin[s3 + 2] = z;
  }

  /** Spawn one particle. Silently dropped when the layer is full. */
  spawn(c: CompiledParticle, slot: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, scale: number): void {
    const L = this.layers[c.layer];
    if (L.count >= L.cap) return;
    const i = L.count++;
    const i3 = i * 3, i4 = i * 4;
    L.pos[i3] = px; L.pos[i3 + 1] = py; L.pos[i3 + 2] = pz;
    L.vel[i3] = vx; L.vel[i3 + 1] = vy; L.vel[i3 + 2] = vz;
    L.age[i] = 0;
    L.life[i] = c.life0 + (c.life1 - c.life0) * this.rand();
    L.rnd[i4] = (c.sr0 + (c.sr1 - c.sr0) * this.rand()) * scale;
    L.rnd[i4 + 1] = c.rot0 + (c.rot1 - c.rot0) * this.rand();
    let spin = c.spin0 + (c.spin1 - c.spin0) * this.rand();
    if (c.spinSigned && this.rand() < 0.5) spin = -spin;
    L.rnd[i4 + 2] = spin;
    L.rnd[i4 + 3] = this.rand();
    L.def[i] = c.index;
    L.slot[i] = slot;
    L.frame[i] = c.frames.length === 1 ? c.frames[0] : c.frames[(this.rand() * c.frames.length) | 0];
    this.slotLive[slot]++;
  }

  /** Camera used for back-to-front bucketing of the alpha/lit layers. */
  setCamera(camera: THREE.Camera | null): void {
    if (!camera) { this.hasCamera = false; return; }
    const e = camera.matrixWorld.elements;
    this.camX = e[12]; this.camY = e[13]; this.camZ = e[14];
    this.fwdX = -e[8]; this.fwdY = -e[9]; this.fwdZ = -e[10];
    this.hasCamera = true;
  }

  /** Optional scene depth for soft particles (must not be the depth attachment of the target being rendered). */
  setSoftDepth(tex: THREE.Texture | null, width: number, height: number, near: number, far: number): void {
    const had = this.shared.uDepth.value !== null;
    this.shared.uDepth.value = tex;
    this.shared.uResolution.value.set(Math.max(1, width), Math.max(1, height));
    this.shared.uNearFar.value.set(near, far);
    if (had !== (tex !== null)) {
      for (const l of this.layers) {
        if (l.id === 'stretch') continue;
        if (tex) l.mat.defines.SOFT_DEPTH = ''; else delete l.mat.defines.SOFT_DEPTH;
        l.mat.needsUpdate = true;
      }
    }
  }

  /** live particles across all layers */
  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.layers.length; i++) n += this.layers[i].count;
    return n;
  }

  liveIn(layer: LayerId): number {
    return this.layers[LAYER_IDS.indexOf(layer)].count;
  }

  /** Kill everything immediately. */
  clear(): void {
    for (const l of this.layers) { l.count = 0; l.geo.instanceCount = 0; l.mesh.visible = false; }
    this.slotLive.fill(0);
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.layers.length; i++) {
      const L = this.layers[i];
      if (L.count > 0) this.simulate(L, dt);
      this.upload(L);
    }
    this.slotDelta.fill(0);
  }

  private simulate(L: Layer, dt: number): void {
    const { pos, vel, age, life, rnd, def, slot } = L;
    const defs = this.defs, time = this.time;
    const so = this.slotOrigin, sd = this.slotDelta, sf = this.slotFloor;
    let i = 0;
    while (i < L.count) {
      const a = age[i] + dt;
      if (a >= life[i]) {
        this.slotLive[slot[i]]--;
        L.kill(i);
        continue;
      }
      age[i] = a;
      const d = defs[def[i]];
      const i3 = i * 3;
      let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
      let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      vy -= d.gravity * dt;
      if (d.turb !== 0) {
        const w = time * d.turbFreq;
        const ph = d.unison ? py * 0.9 + slot[i] * 1.7 : rnd[i * 4 + 3] * 61.0;
        const k = d.turb * dt;
        vx += Math.sin(w * 1.31 + ph) * k;
        vy += Math.sin(w * 1.07 + ph * 1.9 + 1.3) * k * 0.6;
        vz += Math.cos(w * 1.19 + ph * 1.3) * k;
      }
      if (d.needsOrigin) {
        const s3 = slot[i] * 3;
        if (d.follow) { px += sd[s3]; py += sd[s3 + 1]; pz += sd[s3 + 2]; }
        const ox = so[s3], oy = so[s3 + 1], oz = so[s3 + 2];
        if (d.attract !== 0) {
          const k = d.attract * dt;
          vx += (ox - px) * k; vy += (oy - py) * k; vz += (oz - pz) * k;
        }
        if (d.orbit !== 0) {
          const ang = d.orbit * dt, c = Math.cos(ang), s = Math.sin(ang);
          const rx = px - ox, rz = pz - oz;
          px = ox + rx * c - rz * s; pz = oz + rx * s + rz * c;
          const tvx = vx * c - vz * s; vz = vx * s + vz * c; vx = tvx;
        }
      }
      if (d.drag !== 0) {
        const f = Math.max(0, 1 - d.drag * dt);
        vx *= f; vy *= f; vz *= f;
      }
      px += vx * dt; py += vy * dt; pz += vz * dt;
      if (d.bounce !== 0) {
        const fy = sf[slot[i]] + 0.015;
        if (py < fy && fy > NO_FLOOR + 1) {
          py = fy;
          if (vy < -0.5) { vy = -vy * d.bounce; vx *= 0.62; vz *= 0.62; rnd[i * 4 + 2] *= 0.6; }
          else { vy = 0; vx *= Math.max(0, 1 - 6 * dt); vz *= Math.max(0, 1 - 6 * dt); rnd[i * 4 + 2] *= Math.max(0, 1 - 8 * dt); }
        }
      }
      rnd[i * 4 + 1] += rnd[i * 4 + 2] * dt;
      pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      i++;
    }
  }

  private upload(L: Layer): void {
    const n = L.count;
    L.geo.instanceCount = n;
    L.mesh.visible = n > 0;
    if (n === 0) return;
    const sorted = this.hasCamera && (L.id === 'alpha' || L.id === 'lit') && n > 1;
    if (sorted) this.sortBackToFront(L);
    for (let k = 0; k < n; k++) this.write(L, sorted ? L.order[k] : k, k);
    L.ibuf.clearUpdateRanges();
    L.ibuf.addUpdateRange(0, n * STRIDE);
    L.ibuf.needsUpdate = true;
  }

  /** stable counting sort into far→near buckets; no allocation */
  private sortBackToFront(L: Layer): void {
    const n = L.count, pos = L.pos, depth = L.depth;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const z = (pos[i3] - this.camX) * this.fwdX + (pos[i3 + 1] - this.camY) * this.fwdY + (pos[i3 + 2] - this.camZ) * this.fwdZ;
      depth[i] = z;
      if (z < min) min = z;
      if (z > max) max = z;
    }
    const start = L.bucketStart, fill = L.bucketFill;
    start.fill(0); fill.fill(0);
    const scale = max > min ? (SORT_BUCKETS - 1) / (max - min) : 0;
    for (let i = 0; i < n; i++) start[(SORT_BUCKETS - 1 - (((depth[i] - min) * scale) | 0)) + 1]++;
    for (let b = 0; b < SORT_BUCKETS; b++) start[b + 1] += start[b];
    for (let i = 0; i < n; i++) {
      const b = SORT_BUCKETS - 1 - (((depth[i] - min) * scale) | 0);
      L.order[start[b] + fill[b]++] = i;
    }
  }

  private write(L: Layer, i: number, k: number): void {
    const d = this.defs[L.def[i]];
    const buf = L.buf, o = k * STRIDE, i3 = i * 3, i4 = i * 4;
    const t = L.age[i] / L.life[i];
    const sizeMul = L.rnd[i4];
    // size over life
    let size: number;
    if (t < d.sMid) size = d.s0 + (d.s1 - d.s0) * (t / d.sMid);
    else size = d.s1 + (d.s2 - d.s1) * ((t - d.sMid) / (1 - d.sMid));
    size *= sizeMul;
    // colour over life
    const c = d.c;
    let r: number, g: number, b: number;
    if (t < d.cMid) {
      const u = t / d.cMid;
      r = c[0] + (c[3] - c[0]) * u; g = c[1] + (c[4] - c[1]) * u; b = c[2] + (c[5] - c[2]) * u;
    } else {
      const u = (t - d.cMid) / (1 - d.cMid);
      r = c[3] + (c[6] - c[3]) * u; g = c[4] + (c[7] - c[4]) * u; b = c[5] + (c[8] - c[5]) * u;
    }
    const slot = L.slot[i];
    const tintAmt = this.slotTint[slot * 4 + 3] * d.tint;
    if (tintAmt > 0) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const t4 = slot * 4;
      r += (this.slotTint[t4] * lum - r) * tintAmt;
      g += (this.slotTint[t4 + 1] * lum - g) * tintAmt;
      b += (this.slotTint[t4 + 2] * lum - b) * tintAmt;
    }
    // opacity envelope
    let alpha = d.alpha * (t < d.fadeIn ? t / d.fadeIn : 1);
    if (t > d.fadeOut) {
      const u = (t - d.fadeOut) / (1 - d.fadeOut);
      alpha *= 1 - u * u * (3 - 2 * u);
    }
    if (d.flicker !== 0) alpha *= 1 - d.flicker * (0.5 + 0.5 * Math.sin(this.time * 31 + L.rnd[i4 + 3] * 97));
    if (d.isFlash) alpha *= this.flashScale;
    buf[o] = L.pos[i3]; buf[o + 1] = L.pos[i3 + 1]; buf[o + 2] = L.pos[i3 + 2]; buf[o + 3] = size;
    buf[o + 4] = r; buf[o + 5] = g; buf[o + 6] = b; buf[o + 7] = alpha;
    buf[o + 8] = L.rnd[i4 + 1]; buf[o + 9] = L.frame[i];
    const vx = L.vel[i3], vy = L.vel[i3 + 1], vz = L.vel[i3 + 2];
    if (L.id === 'stretch') {
      buf[o + 10] = size * d.aspect + Math.sqrt(vx * vx + vy * vy + vz * vz) * d.stretch * sizeMul;
      buf[o + 11] = 0;
      buf[o + 12] = vx; buf[o + 13] = vy; buf[o + 14] = vz; buf[o + 15] = NO_FLOOR;
    } else {
      buf[o + 10] = d.aspect; buf[o + 11] = d.facing;
      const cool = 1 - t;
      buf[o + 12] = d.glow * cool * cool; buf[o + 13] = 0; buf[o + 14] = 0;
      buf[o + 15] = d.floorFade ? this.slotFloor[slot] : NO_FLOOR;
    }
  }
}
