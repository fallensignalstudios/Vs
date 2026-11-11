/**
 * Moving scan plane (Z03): a `vfx.scanPlane` sweeping back and forth between two floor points. The player is
 * detected when inside the plane's volume AND in unobstructed sight of the plane's physical `source` — solid
 * cover between the source and the player's chest hides them.
 */
import * as THREE from 'three';
import type { BeamHandle, LoopHandle, ScanPlaneColor, ScanPlaneHandle, ScanPlaneVisual, Vec3Like } from '@/core/api';
import { yawTo } from '@/core/mathx';
import type { AiCore } from './core';
import { caption, fin, live, nowOf, physicsOf, playerActor, vec, warnOnce } from './util';

export interface ScanPlaneOpts {
  id: string;
  from: Vec3Like;
  to: Vec3Like;
  width: number;
  height?: number;
  period: number;
  phase?: number;
  source: Vec3Like;
  onDetect?: () => void;
  /** ADDED (polish 4): the sheet's colour (see ScanPlaneColor) */
  color?: ScanPlaneColor;
}

/** a usable linear RGB triple (three finite components ≥ 0), or null */
function linearTriple(c: unknown): [number, number, number] | null {
  if (!Array.isArray(c) || c.length !== 3) return null;
  const [r, g, b] = c as unknown[];
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number' || !Number.isFinite(r + g + b)) return null;
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
}

/**
 * The effect for a plane of colour `color`. A hex goes to `vfx.scanPlane(hex)` as it is. A linear triple is
 * written to the sheet's colour uniform (`uColor`), which the effect's own constructor fills from a hex — the
 * one place outside src/vfx that knows that uniform; a visual of another shape keeps its default colour.
 */
export function scanPlaneVisual(vfx: { scanPlane(color?: number): ScanPlaneVisual }, color: ScanPlaneColor | undefined): ScanPlaneVisual {
  if (typeof color === 'number' && Number.isFinite(color)) return vfx.scanPlane(Math.max(0, Math.min(0xffffff, Math.round(color))));
  const rgb = linearTriple(color);
  const v = vfx.scanPlane();
  if (rgb && v && v.object) {
    v.object.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | THREE.Material[] | undefined;
      if (!mat || Array.isArray(mat)) return;
      const u = (mat as THREE.ShaderMaterial).uniforms?.uColor?.value as unknown;
      if (u instanceof THREE.Vector3) u.set(rgb[0], rgb[1], rgb[2]);
      else if (u instanceof THREE.Color) u.setRGB(rgb[0], rgb[1], rgb[2]);
    });
  } else if (color !== undefined && !rgb) {
    warnOnce('scanPlane:color', 'scanPlane color must be a hex number or a [r, g, b] triple of finite numbers — using the default');
  }
  return v;
}

/** half thickness of the detection slab along the direction of travel (m) */
const HALF_THICKNESS = 0.3;
const REDETECT = 2.5;
const TRACE_SECONDS = 1.6;

const _c = new THREE.Vector3();
const _chest = new THREE.Vector3();

export class ScanPlaneImpl implements ScanPlaneHandle {
  readonly id: string;
  active = true;
  detections = 0;
  private rate = 1;
  private phase: number;
  private readonly from: THREE.Vector3;
  private readonly to: THREE.Vector3;
  private readonly source: THREE.Vector3;
  private readonly width: number;
  private readonly height: number;
  private readonly period: number;
  private readonly yaw: number;
  private readonly onDetect: (() => void) | undefined;
  private visual: ScanPlaneVisual | null;
  private loop: LoopHandle | null;
  private trace: BeamHandle | null = null;
  private traceLeft = 0;
  private alert = 0;
  private nextDetect = 0;
  private removed = false;
  /** current centre of the plane on the floor (contract: ScanPlaneHandle.center) */
  readonly center = new THREE.Vector3();

  constructor(private readonly core: AiCore, opts: ScanPlaneOpts, private readonly onRemove: (p: ScanPlaneImpl) => void) {
    this.id = String(opts?.id ?? 'scanPlane');
    this.from = vec(opts?.from);
    this.to = vec(opts?.to);
    this.source = vec(opts?.source);
    this.width = Math.max(0.5, fin(opts?.width, 6));
    this.height = Math.max(0.5, fin(opts?.height, 3));
    this.period = Math.max(0.5, fin(opts?.period, 6));
    this.phase = fin(opts?.phase, 0);
    this.onDetect = typeof opts?.onDetect === 'function' ? opts.onDetect : undefined;
    // the plane stands across its direction of travel
    this.yaw = this.from.distanceToSquared(this.to) > 1e-6 ? yawTo(this.from.x, this.from.z, this.to.x, this.to.z) : 0;
    const v = scanPlaneVisual(core.game.vfx, opts?.color);
    this.visual = live(v) ? v : null;
    this.loop = core.game.audio.loop('scanSweep', { pos: this.from, volume: 0.6 });
    this.place();
  }

  /** 0..1 position along from → to (eased at the turns, so the plane visibly slows before reversing) */
  private along(): number {
    return 0.5 - 0.5 * Math.cos(this.phase * Math.PI * 2);
  }

  private place(): void {
    this.center.lerpVectors(this.from, this.to, this.along());
    _c.copy(this.center);
    _c.y += this.height * 0.5;
    this.visual?.setPose(_c, this.yaw, this.width, this.height);
    this.loop?.setPosition(_c);
  }

  setActive(a: boolean): void {
    this.active = a === true;
    if (this.visual) this.visual.object.visible = this.active;
    this.loop?.setVolume(this.active ? 0.6 : 0, 0.2);
  }

  setRate(mult: number): void {
    this.rate = Math.max(0, fin(mult, 1));
  }

  /** is a world point inside the plane's slab right now? */
  contains(p: Vec3Like): boolean {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    // travel axis = forward of the plane's yaw; lateral = across it
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const alongD = dx * fx + dz * fz;
    const lateral = dx * -fz + dz * fx;
    if (Math.abs(alongD) > HALF_THICKNESS || Math.abs(lateral) > this.width * 0.5) return false;
    return p.y >= this.center.y - 0.1 && p.y <= this.center.y + this.height;
  }

  update(dt: number): void {
    if (this.removed) return;
    const game = this.core.game;
    if (this.traceLeft > 0) {
      this.traceLeft -= dt;
      if (this.traceLeft <= 0) {
        this.trace?.remove(0.3);
        this.trace = null;
      }
    }
    if (this.alert > 0) {
      this.alert = Math.max(0, this.alert - dt / 1.2);
      this.visual?.setAlert(this.alert);
    }
    if (!this.active) return;
    this.phase += (dt * this.rate) / this.period;
    this.place();

    const player = playerActor(game);
    const now = nowOf(game);
    if (!player || now < this.nextDetect) return;
    player.aimPoint(_chest);
    if (!this.contains(_chest)) return;
    const physics = physicsOf(game);
    if (physics && !physics.lineOfSight(this.source, _chest)) return;
    this.nextDetect = now + REDETECT;
    this.detections++;
    this.core.stats.detections++;
    this.alert = 1;
    this.visual?.setAlert(1);
    game.audio.play('scanDetect', { pos: _chest });
    caption(game, 'Scan plane contact', 'scan', _chest);
    // an interpretable trace: it points back at the emitter that saw you
    this.trace?.remove(0);
    this.trace = game.vfx.beam(_chest.clone(), this.source.clone(), 'trace');
    this.traceLeft = TRACE_SECONDS;
    game.events.emit('scan:detected', { source: this.id });
    const cb = this.onDetect;
    if (cb) {
      try {
        cb();
      } catch (err) {
        warnOnce(`scanPlane:${this.id}`, `scanPlane "${this.id}" onDetect threw: ${String(err)}`);
      }
    }
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.active = false;
    this.visual?.remove();
    this.visual = null;
    this.loop?.stop(0.1);
    this.loop = null;
    this.trace?.remove(0);
    this.trace = null;
    this.onRemove(this);
  }
}
