/**
 * `GeneratedShip` — one generated ship on screen: the hull (shared template geometry, its own material clone),
 * its engine glow (one additive mesh) and a level-of-detail switch, all inside a frame that turns and scales the
 * file into the caller's convention. It loads asynchronously: `object` is an empty group until the template is
 * ready (`ready` resolves true), and stays empty when the file cannot be had (`ready` resolves false) — callers
 * keep their procedural ship visible until then and hide it on success.
 *
 * Frames: 'plusX' = nose +X (the hero prop's), 'minusZ' = nose −Z (scenic pieces). Origins: 'centre' = the hull's
 * bounding-box centre, 'ground' = resting on y = 0 (plus `lift`), centred in x and z.
 *
 * LOD: two baked index levels; the switch picks one per frame from the hull's projected length (a fraction of the
 * viewport height, so the choice holds at any resolution): level 0 ≥ 12 %, level 1 ≥ 3.5 %, level 2 below, with
 * hysteresis. Only perspective cameras narrower than 80° decide (shadow and cube renders reuse the choice).
 */
import * as THREE from 'three';
import { SHIP_MODELS, shipScale, type ShipModelId } from './catalog';
import { buildGlow, patchHull, type GlowUniforms, type HullUniforms, type ShipHaze } from './glow';
import { requestShip, shipTemplate, type ShipTemplate } from './loader';

export type ShipFrame = 'plusX' | 'minusZ';

export interface GeneratedShipOpts {
  /** hull length in metres (default: the forge's nominal length) */
  length?: number;
  /** default 'plusX' */
  frame?: ShipFrame;
  /** default 'centre' */
  origin?: 'centre' | 'ground';
  /** with origin 'ground': raise the hull this many metres (landing gear) */
  lift?: number;
  /** far-field: fog-exempt haze toward the sky (scenic capitals) */
  haze?: ShipHaze;
  /** minimum on-screen size of the engine halos, pixels (default 0; far-field ships use ~2) */
  minPx?: number;
  /** hull casts / receives shadows (default true without haze, false with) */
  shadows?: boolean;
  /** initial engine level 0…1.5 (default 1) and running lights 0…1 (default 1) */
  engines?: number;
  lights?: number;
  /** emissive strength of the hull's glowing texels at engine level 1 (default 0.9; far-field 0.6) */
  texelGlow?: number;
}

/** projected-length fractions of the viewport below which level 1 / 2 take over */
export const SHIP_LOD_SCREEN: readonly [number, number] = [0.12, 0.035];
const HYSTERESIS = 0.15;

let lodEnabled = true;
try {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('lod') === '0') lodEnabled = false;
} catch { /* no page */ }
/** master switch for ship LODs (default on; `?lod=0` starts it off) */
export function setShipLodEnabled(on: boolean): void { lodEnabled = !!on; }

const _cam = new THREE.Vector3();
const _at = new THREE.Vector3();
const _ws = new THREE.Vector3();

/** Level switch for one hull: three.js asks it for a level while it walks the scene for a render. */
export class ShipLod extends THREE.LOD {
  current = 0;
  private readonly geoms: THREE.BufferGeometry[];
  constructor(private readonly hull: THREE.Mesh, lods: readonly THREE.BufferGeometry[], private readonly lengthM: () => number) {
    super();
    this.name = 'ship:lod';
    this.geoms = [hull.geometry, ...lods];
  }

  static pick(frac: number, current: number): number {
    const t1 = SHIP_LOD_SCREEN[0], t2 = SHIP_LOD_SCREEN[1];
    const a = current >= 1 ? t1 * (1 + HYSTERESIS) : t1 * (1 - HYSTERESIS);
    const b = current >= 2 ? t2 * (1 + HYSTERESIS) : t2 * (1 - HYSTERESIS);
    return frac >= a ? 0 : frac >= b ? 1 : 2;
  }

  override update(camera: THREE.Camera): void {
    if (this.geoms.length < 2) return;
    if (!lodEnabled) { this.set(0); return; }
    const persp = camera as THREE.PerspectiveCamera;
    if (!persp.isPerspectiveCamera || persp.fov >= 80) return;
    _cam.setFromMatrixPosition(camera.matrixWorld);
    this.hull.getWorldPosition(_at);
    const d = Math.max(0.05, _cam.distanceTo(_at));
    const frac = (this.lengthM() * (persp.zoom || 1)) / (2 * d * Math.tan(THREE.MathUtils.degToRad(persp.fov) * 0.5));
    this.set(ShipLod.pick(frac, this.current));
  }

  private set(level: number): void {
    const l = Math.min(level, this.geoms.length - 1);
    if (l === this.current && this.hull.geometry === this.geoms[l]) return;
    this.current = l;
    this.hull.geometry = this.geoms[l];
  }

  /** triangles drawn now */
  get triangles(): number {
    const g = this.hull.geometry;
    return Math.round((g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3);
  }
}

export class GeneratedShip {
  /** add this where the ship goes; it holds the generated hull once loaded */
  readonly object = new THREE.Group();
  /** resolves true once the hull is on screen, false when it cannot be had */
  readonly ready: Promise<boolean>;
  readonly id: ShipModelId;
  /** metres per raw unit */
  readonly scale: number;
  private hull: THREE.Mesh | null = null;
  private glowU: GlowUniforms | null = null;
  private hullU: HullUniforms | null = null;
  private lod: ShipLod | null = null;
  private owned: Array<{ dispose(): void }> = [];
  private disposed = false;
  private engineLevel: number;
  private lightLevel: number;
  private readonly texelGlow: number;

  constructor(id: ShipModelId, private readonly opts: GeneratedShipOpts = {}) {
    this.id = SHIP_MODELS[id] ? id : 'dominionShuttle';
    this.scale = shipScale(this.id, opts.length);
    this.object.name = `ship:${this.id}`;
    this.engineLevel = clampLevel(opts.engines ?? 1, 1.5);
    this.lightLevel = clampLevel(opts.lights ?? 1, 1);
    this.texelGlow = opts.texelGlow ?? (opts.haze ? 0.6 : 0.9);
    const have = shipTemplate(this.id);
    if (have) {
      this.attach(have);
      this.ready = Promise.resolve(true);
    } else {
      this.ready = requestShip(this.id).then((tpl) => {
        if (!tpl || this.disposed) return false;
        this.attach(tpl);
        return true;
      });
    }
  }

  /** true once the generated hull is in `object` */
  get loaded(): boolean { return this.hull !== null; }

  /** engine level 0…1.5: glow, plumes and the hull's glowing texels */
  get engines(): number { return this.engineLevel; }
  set engines(v: number) {
    this.engineLevel = clampLevel(v, 1.5);
    this.push();
  }

  /** running lights 0…1 */
  get lights(): number { return this.lightLevel; }
  set lights(v: number) {
    this.lightLevel = clampLevel(v, 1);
    this.push();
  }

  /** the hull mesh (null until loaded) */
  get mesh(): THREE.Mesh | null { return this.hull; }

  /** triangles the hull draws at its current level (0 until loaded) */
  get triangles(): number { return this.lod?.triangles ?? (this.hull ? Math.round((this.hull.geometry.index?.count ?? 0) / 3) : 0); }

  /** length of the hull in metres */
  get length(): number { return SHIP_MODELS[this.id].rawLength * this.scale; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    for (const d of this.owned) d.dispose();
    this.owned = [];
    // the hull's geometries belong to the shared template: never dispose them here
    this.object.clear();
    this.hull = null;
    this.lod = null;
  }

  private push(): void {
    if (this.glowU) {
      this.glowU.uEngine.value = this.engineLevel;
      this.glowU.uLights.value = this.lightLevel;
    }
    if (this.hullU) this.hullU.uShipEmis.value = this.texelGlow * Math.min(1, this.engineLevel) + 0.08 * this.lightLevel;
  }

  private attach(tpl: ShipTemplate): void {
    if (this.disposed || this.hull) return;
    const spec = SHIP_MODELS[this.id];
    const o = this.opts;
    const frame = new THREE.Group();
    frame.name = 'ship:frame';
    frame.rotation.y = spec.yawToPlusX + (o.frame === 'minusZ' ? Math.PI / 2 : 0);
    frame.scale.setScalar(this.scale);
    const centre = tpl.box.getCenter(new THREE.Vector3());
    if (o.origin === 'ground') frame.position.y = (centre.y - tpl.box.min.y) * this.scale + Math.max(0, o.lift ?? 0);
    const raw = new THREE.Group();
    raw.name = 'ship:raw';
    raw.position.copy(centre).negate();
    frame.add(raw);

    const { material, uniforms: hullU } = patchHull(tpl.material, spec.mask, { haze: o.haze });
    this.owned.push(material);
    const hull = new THREE.Mesh(tpl.geometry, material);
    hull.name = `ship:${this.id}:hull`;
    hull.matrixAutoUpdate = false;
    hull.matrix.copy(tpl.node);
    const shadows = o.shadows ?? !o.haze;
    hull.castShadow = shadows;
    hull.receiveShadow = shadows;
    raw.add(hull);

    const { mesh: glow, uniforms: glowU } = buildGlow(spec, { minPx: o.minPx, haze: o.haze, engines: this.engineLevel, lights: this.lightLevel });
    this.owned.push(glow.geometry, glow.material as THREE.Material);
    raw.add(glow);

    if (tpl.lods.length) {
      const lod = new ShipLod(hull, tpl.lods, () => this.length * this.object.getWorldScale(_ws).x);
      // first child: three.js asks the switch for a level before it reaches the hull
      frame.add(lod);
      frame.children.splice(frame.children.indexOf(lod), 1);
      frame.children.unshift(lod);
      this.lod = lod;
    }
    this.hull = hull;
    this.glowU = glowU;
    this.hullU = hullU;
    this.push();
    this.object.add(frame);
    this.object.updateMatrixWorld(true);
  }
}

function clampLevel(v: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
}
