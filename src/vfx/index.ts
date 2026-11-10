/**
 * VFX subsystem — pooled particles, beams, trails, decals, shockwaves, telegraphs, scan planes, ambient volumes
 * and flash lights behind the VfxSystem contract (src/core/api/vfx.ts).
 *
 * Draw-call budget when everything is busy: 4 particle layers + 2 ground batches + 1 beam batch + 1 trail batch
 * + one per live mesh shape / scan plane / ambient volume. Idle meshes are hidden (0 draw calls).
 * Bad input never throws: unknown ids/styles/kinds warn once and return inert handles.
 */
import * as THREE from 'three';
import type {
  AmbientKind, BeamHandle, BeamStyle, Game, ScanPlaneVisual, TrailHandle, Vec3Like, VfxHandle, VfxId, VfxOpts,
  VfxStats, VfxSystem,
} from '@/core/api';
import { isStub } from '@/core/stub';
import { AmbientVolumes } from './ambient';
import { createAtlasTexture } from './atlas';
import { BeamRenderer } from './beams';
import type { TracerStyle } from './beams';
import type { DecalKind } from './defs';
import { EffectRuntime } from './effects';
import type { FxServices } from './effects';
import { GroundMarks } from './ground';
import { EFFECT_LIBRARY } from './library';
import { FlashLights } from './lights';
import { ParticleCore } from './particles';
import { ScanPlanes } from './scanplane';
import { ShapeRenderer } from './shapes';
import { TrailRenderer } from './trails';

const DEAD_HANDLE: VfxHandle = Object.freeze({ alive: false, setPosition() {}, stop() {} });
const DEAD_BEAM: BeamHandle = Object.freeze({ alive: false, setEnds() {}, setIntensity() {}, setColor() {}, remove() {} });
const DEAD_TRAIL: TrailHandle = Object.freeze({ setActive() {}, setColor() {}, remove() {} });
const BEAM_STYLES: ReadonlySet<string> = new Set(['link', 'laser', 'scan', 'tether', 'command', 'relay', 'trace', 'gold']);
const TRACER_STYLES: ReadonlySet<string> = new Set(['warm', 'cold', 'drone', 'violet', 'rifle']);
const DECAL_KINDS: ReadonlySet<string> = new Set(['scorch', 'frost', 'violet', 'crack', 'goldRing']);
/** how far above a floor a ground ring / decal event is still projected onto it (metres) */
const FLOOR_SNAP = 3;
const DEFAULT_TELEGRAPH_COLOR = 0xff5a2a;

const finite3 = (p: Vec3Like | null | undefined): p is Vec3Like => !!p && Number.isFinite(p.x + p.y + p.z);

class VfxSystemImpl implements VfxSystem {
  private readonly root = new THREE.Group();
  private readonly atlas: THREE.DataTexture;
  private readonly particles: ParticleCore;
  private readonly ground = new GroundMarks();
  private readonly shapes = new ShapeRenderer();
  private readonly beams = new BeamRenderer();
  private readonly trails = new TrailRenderer();
  private readonly scans = new ScanPlanes();
  private readonly ambients: AmbientVolumes;
  private readonly lights: FlashLights;
  private readonly effects: EffectRuntime;
  private readonly warned = new Set<string>();
  private probeTimer = 0;
  private readonly statsOut: VfxStats = { particles: 0, effects: 0, beams: 0, tracers: 0, trails: 0, decals: 0, telegraphs: 0, shapes: 0, flashes: 0, ambients: 0 };

  constructor(private readonly game: Game) {
    this.root.name = 'vfx';
    this.atlas = createAtlasTexture();
    this.particles = new ParticleCore(this.atlas);
    this.lights = new FlashLights(this.particles.shared.uFlashPos.value, this.particles.shared.uFlashColor.value);
    this.ambients = new AmbientVolumes(this.atlas);
    this.effects = new EffectRuntime(this.makeServices());
    for (const id of Object.keys(EFFECT_LIBRARY)) this.effects.register(id, EFFECT_LIBRARY[id]);
    this.root.add(this.ground.group, this.shapes.group, this.scans.group, this.beams.mesh, this.trails.mesh,
      this.particles.group, this.ambients.group, this.lights.group);
    const scene = game.scene as THREE.Scene | undefined;
    if (scene && !isStub(scene) && typeof scene.add === 'function') scene.add(this.root);
  }

  /** what the effect timelines may ask of the other renderers */
  private makeServices(): FxServices {
    return {
      particles: this.particles,
      particleScale: () => this.particleScale(),
      floorAt: (x, y, z) => this.floorAt(x, y, z),
      flash: (x, y, z, color, intensity, seconds) => this.lights.flash(x, y, z, color, intensity, seconds, this.reduceFlash()),
      shock: (x, y, z, radius, color, seconds) => {
        const gy = this.groundY(x, y, z);
        if (Number.isFinite(gy)) this.ground.shockwave({ x, y: gy, z }, radius, color, seconds);
      },
      decal: (kind, x, y, z, nx, ny, nz, size, life) => {
        if (!DECAL_KINDS.has(kind)) return;
        if (ny > 0.7) {
          const gy = this.groundY(x, y, z);
          if (Number.isFinite(gy)) this.ground.decal(kind as DecalKind, { x, y: gy, z }, undefined, size, life);
        } else {
          this.ground.decal(kind as DecalKind, { x, y, z }, { x: nx, y: ny, z: nz }, size, life);
        }
      },
      shape: (def, x, y, z, dx, dy, dz, scale, tint, life) => this.shapes.spawn(def, x, y, z, dx, dy, dz, scale, tint, life),
    };
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[vfx] ${msg}`);
  }

  private particleScale(): number {
    const render = this.game.render;
    if (!render || isStub(render)) return 1;
    const q = render.quality;
    const v = q && !isStub(q) ? q.particleScale : 1;
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(1.5, Math.max(0.1, v)) : 1;
  }

  private floorAt(x: number, y: number, z: number): number | null {
    const physics = this.game.physics;
    if (!physics || isStub(physics) || typeof physics.groundAt !== 'function') return null;
    try {
      const hit = physics.groundAt(x, z, y + 0.3, 0.3);
      return hit && !isStub(hit) && typeof hit.y === 'number' && Number.isFinite(hit.y) ? hit.y : null;
    } catch {
      return null;
    }
  }

  private reduceFlash(): boolean {
    const s = this.game.settings;
    return !!s && !isStub(s) && s.get('reduceFlash') === true;
  }

  /** ground height for a ground-hugging mark; NaN = too far above any floor, skip it */
  private groundY(x: number, y: number, z: number): number {
    const floor = this.floorAt(x, y, z);
    if (floor === null) return y;
    return y - floor <= FLOOR_SNAP ? floor : NaN;
  }

  // ------------------------------------------------------------------------------------------ VfxSystem
  spawn(id: VfxId, pos: Vec3Like, opts?: VfxOpts): VfxHandle {
    return this.effects.spawn(String(id), pos, opts);
  }

  beam(from: Vec3Like | THREE.Object3D, to: Vec3Like | THREE.Object3D, style: BeamStyle, opts?: { color?: number; width?: number }): BeamHandle {
    if (!from || !to || isStub(from) || isStub(to)) return DEAD_BEAM;
    let s = style;
    if (!BEAM_STYLES.has(s)) {
      this.warnOnce(`beam:${String(s)}`, `unknown beam style "${String(s)}" — using "laser"`);
      s = 'laser';
    }
    return this.beams.beam(from, to, s, opts?.color, opts?.width);
  }

  tracer(from: Vec3Like, to: Vec3Like, style: 'warm' | 'cold' | 'drone' | 'violet' | 'rifle', opts?: { speed?: number }): void {
    if (!finite3(from) || !finite3(to)) return;
    let s: TracerStyle = style;
    if (!TRACER_STYLES.has(s)) {
      this.warnOnce(`tracer:${String(s)}`, `unknown tracer style "${String(s)}" — using "warm"`);
      s = 'warm';
    }
    this.beams.tracer(from, to, s, opts?.speed);
  }

  trail(base: THREE.Object3D, tip: THREE.Object3D, opts?: { color?: number; length?: number }): TrailHandle {
    if (!base || !tip || isStub(base) || isStub(tip) || typeof base.getWorldPosition !== 'function' || typeof tip.getWorldPosition !== 'function') {
      this.warnOnce('trail:sockets', 'trail() needs two Object3D sockets — ignored');
      return DEAD_TRAIL;
    }
    return this.trails.create(base, tip, opts?.color, opts?.length);
  }

  ambient(kind: AmbientKind, center: Vec3Like, size: Vec3Like, density = 1): VfxHandle {
    if (!finite3(center) || !finite3(size)) return DEAD_HANDLE;
    return this.ambients.create(kind, center, size, density, this.particleScale());
  }

  scanPlane(color?: number): ScanPlaneVisual {
    return this.scans.create(color);
  }

  decal(kind: 'scorch' | 'frost' | 'violet' | 'crack' | 'goldRing', pos: Vec3Like, opts?: { normal?: Vec3Like; size?: number; life?: number }): void {
    if (!finite3(pos)) return;
    if (!DECAL_KINDS.has(kind)) {
      this.warnOnce(`decal:${String(kind)}`, `unknown decal kind "${String(kind)}" — ignored`);
      return;
    }
    const size = opts?.size !== undefined && opts.size > 0 ? opts.size : 1.5;
    const life = opts?.life !== undefined && opts.life > 0 ? opts.life : 20;
    this.ground.decal(kind, pos, finite3(opts?.normal) ? opts?.normal : undefined, size, life);
  }

  shockwave(pos: Vec3Like, radius: number, color: number, seconds = 0.5): void {
    if (!finite3(pos)) return;
    this.ground.shockwave(pos, radius, color, seconds);
  }

  flash(pos: Vec3Like, color: number, intensity: number, seconds = 0.2): void {
    if (!finite3(pos)) return;
    this.lights.flash(pos.x, pos.y, pos.z, color, intensity, seconds, this.reduceFlash());
  }

  telegraph(shape: { kind: 'circle'; pos: Vec3Like; r: number } | { kind: 'line'; from: Vec3Like; to: Vec3Like; width: number } | { kind: 'cone'; pos: Vec3Like; yaw: number; arc: number; r: number },
    seconds: number, color: number = DEFAULT_TELEGRAPH_COLOR): VfxHandle {
    const ok = !!shape && (shape.kind === 'circle' ? finite3(shape.pos) && shape.r > 0
      : shape.kind === 'line' ? finite3(shape.from) && finite3(shape.to) && shape.width > 0
        : shape.kind === 'cone' ? finite3(shape.pos) && shape.r > 0 && Number.isFinite(shape.yaw + shape.arc) : false);
    if (!ok) {
      this.warnOnce(`telegraph:${String(shape && (shape as { kind?: string }).kind)}`, 'telegraph() got an invalid shape — ignored');
      return DEAD_HANDLE;
    }
    return this.ground.telegraph(shape, Number.isFinite(seconds) && seconds > 0 ? seconds : 0.6, color);
  }

  has(id: string): boolean {
    return this.effects.has(id);
  }

  ids(): string[] {
    return this.effects.ids();
  }

  setSoftDepth(texture: THREE.Texture | null, width = 1, height = 1, near = 0.1, far = 1000): void {
    this.particles.setSoftDepth(texture, width, height, near, far);
  }

  get stats(): VfxStats {
    const s = this.statsOut, g = this.ground.counts, b = this.beams.counts;
    s.particles = this.particles.liveCount; s.effects = this.effects.liveCount;
    s.beams = b.beams; s.tracers = b.tracers; s.trails = this.trails.count;
    s.decals = g.decals; s.telegraphs = g.telegraphs; s.shapes = this.shapes.liveCount;
    s.flashes = this.lights.liveCount; s.ambients = this.ambients.count;
    return s;
  }

  update(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    const rig = this.game.camera;
    const cam = rig && !isStub(rig) && rig.camera && !isStub(rig.camera) && (rig.camera as THREE.Camera).isCamera ? (rig.camera as THREE.Camera) : null;
    this.particles.setCamera(cam);
    this.particles.flashScale = this.reduceFlash() ? 0.4 : 1;

    this.effects.update(step);
    this.particles.update(step);
    this.lights.update(step);
    this.ground.update(step);
    this.shapes.update(step, cam);
    this.beams.update(step);
    this.trails.update(step);
    this.scans.update(step);
    this.ambients.update(step);

    // shade the lit smoke layer like the scene it sits in (cheap probe, ~1 Hz)
    this.probeTimer -= step;
    if (this.probeTimer <= 0) {
      this.probeTimer = 0.8;
      const scene = this.game.scene as THREE.Scene | undefined;
      if (scene && !isStub(scene) && typeof scene.traverseVisible === 'function') {
        const u = this.particles.shared;
        FlashLights.probe(scene, u.uAmbient.value, u.uKeyDir.value, u.uKeyColor.value);
      }
    }
  }

  clear(): void {
    this.effects.clear();
    this.particles.clear();
    this.ground.clear();
    this.shapes.clear();
    this.beams.clear();
    this.trails.clear();
    this.scans.clear();
    this.ambients.clear();
    this.lights.clear();
  }
}

export function createVfxSystem(game: Game): VfxSystem {
  return new VfxSystemImpl(game);
}
