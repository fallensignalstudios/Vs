/**
 * Effect runtime — turns EffectDef timelines into particle emission and timed events, and owns the handles
 * returned by `vfx.spawn`. Unknown ids warn once and return an inert handle (never throw).
 */
import * as THREE from 'three';
import type { Vec3Like, VfxHandle, VfxOpts } from '@/core/api';
import type { EffectDef, EmitterDef, FxContext, FxEvent, ShapeDef } from './defs';
import { sample } from './defs';
import type { CompiledParticle, ParticleCore } from './particles';

/** Handle on a live mesh shape (dome, wall, …). */
export interface ShapeHandle {
  readonly alive: boolean;
  /** begin the fade-out of a sustained shape */
  release(): void;
  setPosition(x: number, y: number, z: number): void;
}

/** What the runtime needs from the rest of the VFX system. */
export interface FxServices {
  readonly particles: ParticleCore;
  /** quality multiplier on particle counts (0..1) */
  particleScale(): number;
  /** ground height under a point, or null when unknown */
  floorAt(x: number, y: number, z: number): number | null;
  flash(x: number, y: number, z: number, color: number, intensity: number, seconds: number): void;
  shock(x: number, y: number, z: number, radius: number, color: number, seconds: number): void;
  decal(kind: string, x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, life: number): void;
  /** `life` overrides def.life when > 0 (shapes fitted to the effect duration) */
  shape(def: ShapeDef, x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number, tint: number | undefined, life: number): ShapeHandle;
}

interface CompiledEmitter {
  readonly def: EmitterDef;
  readonly p: CompiledParticle;
  readonly at: number;
  readonly until: number;
  readonly every: number;
  readonly rate: number;
}

interface CompiledEffect {
  readonly emitters: readonly CompiledEmitter[];
  readonly events: readonly FxEvent[];
  readonly sustain: number | undefined;
  /** time after which a one-shot emits nothing more */
  readonly endTime: number;
  readonly upright: boolean;
  readonly update: EffectDef['update'];
}

const DEAD: VfxHandle = Object.freeze({ alive: false, setPosition() {}, stop() {} });
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

class FxInstance implements VfxHandle, FxContext {
  alive = true;
  age = 0;
  duration = Infinity;
  stopped = false;
  readonly state = new Float32Array(4);
  readonly pos = new THREE.Vector3();
  /** local→world rotation (column-major 3×3), identity when dir is up */
  readonly rot = new Float32Array(9);
  readonly dir = new THREE.Vector3(0, 1, 0);
  rotated = false;
  scale = 1;
  tint: number | undefined;
  attach: THREE.Object3D | null = null;
  slot = 0;
  eventIdx = 0;
  /** next spoke index for `spokes` emitters */
  spoke = 0;
  readonly acc: Float32Array;
  readonly next: Float32Array;
  readonly shapes: ShapeHandle[] = [];

  constructor(readonly def: CompiledEffect, private readonly rt: EffectRuntime) {
    this.acc = new Float32Array(def.emitters.length);
    this.next = new Float32Array(def.emitters.length);
    for (let i = 0; i < def.emitters.length; i++) this.next[i] = def.emitters[i].at;
  }

  setPosition(p: Vec3Like): void {
    if (!this.alive || !p) return;
    this.pos.set(p.x, p.y, p.z);
    for (let i = 0; i < this.shapes.length; i++) this.shapes[i].setPosition(p.x, p.y, p.z);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (let i = 0; i < this.shapes.length; i++) this.shapes[i].release();
  }

  emit(emitter: number, count: number): void {
    const em = this.def.emitters[emitter];
    if (em && count > 0) this.rt.emitFrom(this, em, count);
  }

  flash(color: number, intensity: number, seconds: number): void {
    this.rt.services.flash(this.pos.x, this.pos.y, this.pos.z, this.tint ?? color, intensity * this.scale, seconds);
  }

  shock(radius: number, color: number, seconds: number): void {
    this.rt.services.shock(this.pos.x, this.pos.y, this.pos.z, radius * this.scale, this.tint ?? color, seconds);
  }
}

export class EffectRuntime {
  private readonly registry = new Map<string, CompiledEffect>();
  private readonly live: FxInstance[] = [];
  private readonly warned = new Set<string>();

  constructor(readonly services: FxServices) {}

  /** Register (or replace) an effect definition under an id. */
  register(id: string, def: EffectDef): void {
    const sustained = def.sustain !== undefined;
    let endTime = 0;
    const emitters: CompiledEmitter[] = (def.emitters ?? []).map((e) => {
      const at = e.at ?? 0;
      const repeating = e.rate !== undefined || e.every !== undefined;
      const until = e.until ?? (repeating ? (sustained ? Infinity : at + 0.25) : at);
      if (Number.isFinite(until)) endTime = Math.max(endTime, until);
      return { def: e, p: this.services.particles.register(e.p), at, until, every: e.every ?? 0, rate: e.rate ?? 0 };
    });
    const events = [...(def.events ?? [])].sort((a, b) => a.at - b.at);
    for (const ev of events) endTime = Math.max(endTime, ev.at);
    this.registry.set(id, { emitters, events, sustain: def.sustain, endTime, upright: def.upright ?? false, update: def.update });
  }

  has(id: string): boolean {
    return this.registry.has(id);
  }

  ids(): string[] {
    return [...this.registry.keys()];
  }

  get liveCount(): number {
    return this.live.length;
  }

  spawn(id: string, pos: Vec3Like, opts?: VfxOpts): VfxHandle {
    const def = this.registry.get(id);
    if (!def) {
      if (!this.warned.has(id)) {
        this.warned.add(id);
        console.warn(`[vfx] unknown effect id "${id}" — ignored`);
      }
      return DEAD;
    }
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return DEAD;
    const fx = new FxInstance(def, this);
    fx.pos.set(pos.x, pos.y, pos.z);
    fx.scale = opts?.scale !== undefined && opts.scale > 0 && Number.isFinite(opts.scale) ? opts.scale : 1;
    fx.tint = opts?.color !== undefined && Number.isFinite(opts.color) ? opts.color : undefined;
    fx.attach = opts?.attachTo ?? null;
    fx.rot[0] = fx.rot[4] = fx.rot[8] = 1;
    const d = opts?.dir;
    if (d) {
      const len = Math.hypot(d.x, d.y, d.z);
      if (len > 1e-5 && Number.isFinite(len)) {
        fx.dir.set(d.x / len, d.y / len, d.z / len);
        if (def.upright) {
          // yaw-only frame: X = wall tangent, Y = world up, Z = dir flattened
          const fl = Math.hypot(fx.dir.x, fx.dir.z);
          if (fl > 1e-4) {
            const ax = fx.dir.x / fl, az = fx.dir.z / fl;
            fx.rot[0] = az; fx.rot[1] = 0; fx.rot[2] = -ax;
            fx.rot[6] = ax; fx.rot[7] = 0; fx.rot[8] = az;
            fx.rotated = true;
          }
        } else if (fx.dir.y < 0.9999) {
          _q.setFromUnitVectors(UP, fx.dir);
          _m.makeRotationFromQuaternion(_q);
          const e = _m.elements;
          fx.rot[0] = e[0]; fx.rot[1] = e[1]; fx.rot[2] = e[2];
          fx.rot[3] = e[4]; fx.rot[4] = e[5]; fx.rot[5] = e[6];
          fx.rot[6] = e[8]; fx.rot[7] = e[9]; fx.rot[8] = e[10];
          fx.rotated = true;
        }
      }
    }
    if (def.sustain !== undefined) fx.duration = opts?.duration !== undefined && opts.duration > 0 ? opts.duration : def.sustain;
    if (fx.attach) fx.attach.getWorldPosition(fx.pos);
    const P = this.services.particles;
    fx.slot = P.allocSlot(fx.pos.x, fx.pos.y, fx.pos.z, this.services.floorAt(fx.pos.x, fx.pos.y, fx.pos.z));
    if (fx.tint !== undefined) P.setSlotTint(fx.slot, fx.tint);
    this.live.push(fx);
    // fire everything scheduled at t = 0 immediately so a spawn is visible on the very next render
    this.advance(fx, 0);
    return fx;
  }

  update(dt: number): void {
    const live = this.live;
    let w = 0;
    for (let i = 0; i < live.length; i++) {
      const fx = live[i];
      this.advance(fx, dt);
      if (fx.alive) live[w++] = fx;
    }
    live.length = w;
  }

  /** Stop and forget every instance (particles are cleared by the caller). */
  clear(): void {
    for (const fx of this.live) {
      fx.stop();
      fx.alive = false;
      this.services.particles.freeSlot(fx.slot);
    }
    this.live.length = 0;
  }

  private advance(fx: FxInstance, dt: number): void {
    const def = fx.def, P = this.services.particles;
    if (fx.attach) {
      fx.attach.getWorldPosition(_v);
      if (Number.isFinite(_v.x + _v.y + _v.z)) {
        fx.pos.copy(_v);
        for (let i = 0; i < fx.shapes.length; i++) fx.shapes[i].setPosition(_v.x, _v.y, _v.z);
      }
    }
    P.moveSlot(fx.slot, fx.pos.x, fx.pos.y, fx.pos.z);
    fx.age += dt;
    const age = fx.age;
    if (!fx.stopped && age >= fx.duration) fx.stop();

    if (!fx.stopped) {
      const scale = this.services.particleScale();
      for (let e = 0; e < def.emitters.length; e++) {
        const em = def.emitters[e];
        if (age < em.at) continue;
        const burst = em.def.burst;
        if (burst !== undefined) {
          while (age >= fx.next[e] && fx.next[e] <= em.until + 1e-6) {
            const n = sample(burst, P.rand()) * scale * Math.min(2, Math.max(0.5, Math.sqrt(fx.scale)));
            this.emitFrom(fx, em, n >= 1 ? Math.round(n) : P.rand() < n ? 1 : 0);
            fx.next[e] = em.every > 0 ? fx.next[e] + em.every : Infinity;
          }
        }
        if (em.rate > 0 && age <= em.until) {
          fx.acc[e] += em.rate * scale * dt;
          const n = fx.acc[e] | 0;
          if (n > 0) {
            fx.acc[e] -= n;
            this.emitFrom(fx, em, n);
          }
        }
      }
      const events = def.events;
      while (fx.eventIdx < events.length && events[fx.eventIdx].at <= age) this.fire(fx, events[fx.eventIdx++]);
      if (def.update) def.update(fx, dt);
    }

    const finished = fx.stopped || (def.sustain === undefined && age >= def.endTime);
    if (finished && P.slotLive[fx.slot] <= 0 && age > 0) {
      let shapesAlive = false;
      for (let i = 0; i < fx.shapes.length; i++) if (fx.shapes[i].alive) { shapesAlive = true; break; }
      if (!shapesAlive) {
        fx.alive = false;
        P.freeSlot(fx.slot);
      }
    }
  }

  private fire(fx: FxInstance, ev: FxEvent): void {
    const S = this.services, s = fx.scale;
    switch (ev.kind) {
      case 'flash': {
        const o = ev.offset;
        let x = fx.pos.x, y = fx.pos.y, z = fx.pos.z;
        if (o) {
          const r = fx.rot;
          x += (r[0] * o[0] + r[3] * o[1] + r[6] * o[2]) * s;
          y += (r[1] * o[0] + r[4] * o[1] + r[7] * o[2]) * s;
          z += (r[2] * o[0] + r[5] * o[1] + r[8] * o[2]) * s;
        }
        S.flash(x, y, z, fx.tint ?? ev.color, ev.intensity * Math.min(2, s), ev.seconds ?? 0.2);
        break;
      }
      case 'shock':
        S.shock(fx.pos.x, fx.pos.y, fx.pos.z, ev.radius * s, fx.tint ?? ev.color, ev.seconds ?? 0.5);
        break;
      case 'decal':
        S.decal(ev.decal, fx.pos.x, fx.pos.y, fx.pos.z, fx.dir.x, fx.dir.y, fx.dir.z, ev.size * s, ev.life ?? 20);
        break;
      case 'shape': {
        const life = ev.shape.fit && Number.isFinite(fx.duration) ? Math.max(0.05, fx.duration - ev.at) : 0;
        fx.shapes.push(S.shape(ev.shape, fx.pos.x, fx.pos.y, fx.pos.z, fx.dir.x, fx.dir.y, fx.dir.z, s, fx.tint, life));
        break;
      }
    }
  }

  /** Emit `count` particles from one emitter of an instance. */
  emitFrom(fx: FxInstance, em: CompiledEmitter, count: number): void {
    const P = this.services.particles, d = em.def, p = em.p, s = fx.scale, r = fx.rot;
    const shape = d.shape ?? 'point', velMode = d.vel ?? 'cone';
    const radius = d.radius ?? 0, height = d.height ?? 0, depth = d.depth ?? radius;
    const spokes = d.spokes ?? 0;
    const cone = d.cone ?? Math.PI, cosCone = Math.cos(cone);
    const off = d.offset;
    const speed = d.speed ?? 0, up = d.up ?? 0;
    for (let n = 0; n < count; n++) {
      // ---- local spawn position
      let lx = 0, ly = 0, lz = 0;
      const ang = spokes > 0 ? ((fx.spoke++ % spokes) / spokes) * Math.PI * 2 : P.rand() * Math.PI * 2;
      switch (shape) {
        case 'sphere':
        case 'shell': {
          const cz = P.rand() * 2 - 1, sz = Math.sqrt(1 - cz * cz);
          const rr = shape === 'shell' ? radius : radius * Math.cbrt(P.rand());
          lx = Math.cos(ang) * sz * rr; ly = cz * rr; lz = Math.sin(ang) * sz * rr;
          break;
        }
        case 'disc': {
          const rr = Math.sqrt(height * height + (radius * radius - height * height) * P.rand());
          lx = Math.cos(ang) * rr; lz = Math.sin(ang) * rr;
          break;
        }
        case 'ring':
          lx = Math.cos(ang) * radius; lz = Math.sin(ang) * radius;
          break;
        case 'box':
          lx = (P.rand() * 2 - 1) * radius; ly = (P.rand() * 2 - 1) * height; lz = (P.rand() * 2 - 1) * depth;
          break;
        case 'line':
          ly = P.rand() * height;
          break;
        default:
          break;
      }
      // ---- local velocity
      let vx = 0, vy = 0, vz = 0;
      const sp = sample(speed, P.rand());
      if (velMode === 'radial' || velMode === 'inward') {
        let l = Math.hypot(lx, ly, lz);
        if (l < 1e-5) {
          const cz = P.rand() * 2 - 1, sz = Math.sqrt(1 - cz * cz), a2 = P.rand() * Math.PI * 2;
          vx = Math.cos(a2) * sz; vy = cz; vz = Math.sin(a2) * sz; l = 1;
        } else { vx = lx / l; vy = ly / l; vz = lz / l; }
        const k = velMode === 'inward' ? -sp : sp;
        vx *= k; vy *= k; vz *= k;
      } else if (velMode === 'cone') {
        const cz = cosCone + (1 - cosCone) * P.rand(), sz = Math.sqrt(Math.max(0, 1 - cz * cz)), a2 = P.rand() * Math.PI * 2;
        vx = Math.cos(a2) * sz * sp; vy = cz * sp; vz = Math.sin(a2) * sz * sp;
      } else if (velMode === 'ring') {
        vx = Math.cos(ang) * sp; vz = Math.sin(ang) * sp;
      } else if (velMode === 'tangent') {
        vx = -Math.sin(ang) * sp; vz = Math.cos(ang) * sp;
      }
      vy += sample(up, P.rand());
      if (d.flip) { ly = -ly; vy = -vy; }
      if (off) { lx += off[0]; ly += off[1]; lz += off[2]; }
      // ---- to world
      let wx = lx, wy = ly, wz = lz;
      if (fx.rotated) {
        wx = r[0] * lx + r[3] * ly + r[6] * lz; wy = r[1] * lx + r[4] * ly + r[7] * lz; wz = r[2] * lx + r[5] * ly + r[8] * lz;
        const tx = r[0] * vx + r[3] * vy + r[6] * vz, ty = r[1] * vx + r[4] * vy + r[7] * vz;
        vz = r[2] * vx + r[5] * vy + r[8] * vz; vx = tx; vy = ty;
      }
      P.spawn(p, fx.slot, fx.pos.x + wx * s, fx.pos.y + wy * s, fx.pos.z + wz * s, vx * s, vy * s, vz * s, s);
    }
  }
}
