/**
 * ZoneBuilderImpl — the object zone authors build a zone with. It owns nothing but glue: every piece lives in
 * its own module (structure / walls / ribs / cover / doors / dressing / lights / props) and writes into the
 * shared KitCtx; this class adds markers, the environment, finalize() and dispose().
 */
import * as THREE from 'three';
import type {
  BarrierHandle, CeilingOpts, ColliderDesc, ColliderHandle, CoverOpts, DiscOpts, DoorHandle, DoorOpts, FloorOpts, Game, LightOpts, Marker,
  MatId, MaterialLibrary, PhysicsWorld, PropKind, PropOpts, RampOpts, RectOpts, RibOpts, ScriptHandle, SurfaceDesc, SurfaceFinish, SurfaceHandle,
  WallOpts, ZoneBuilder, ZoneEnvOpts,
} from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { KitCtx } from './core';
import { buildCover } from './cover';
import { buildBarrier, buildDoor } from './doors';
import { buildChannel, buildConduit, buildCorruption, buildFrost, buildWhitePoint, type ChannelOpts } from './dressing';
import { computeBounds, mergeStatics } from './finalize';
import { applyEnv, applyShadowBudget, budgetLights, buildPanelLight, buildPoint, buildSpot, fitKeyLight } from './lights';
import { buildProp } from './props';
import { buildColumn, buildRib, buildRibRow } from './ribs';
import { buildBlocker, buildBridge, buildDeck, buildDisc, buildFloor, buildRail, buildRamp, type DeckExtras } from './structure';
import { buildCeiling, buildRingWall, buildWall, buildWalls } from './walls';

/** reflection strength of mirror-polished floors (render: > 1 boosts the reflected radiance; 1.5 is already strong) */
const POLISHED_REFLECTION = 1.25;

export class ZoneBuilderImpl implements ZoneBuilder {
  readonly physics: PhysicsWorld;
  readonly mats: MaterialLibrary;
  readonly markers = new Map<string, Marker>();
  readonly bounds = new THREE.Box3();
  readonly stats = { meshes: 0, triangles: 0, lights: 0, shadowLights: 0, merged: 0 };
  private readonly ctx: KitCtx;
  private readonly statics = new THREE.Group();
  private readonly mergedMeshes: THREE.Mesh[] = [];
  private key: THREE.DirectionalLight | null = null;
  private ticker: ScriptHandle | null = null;
  private lastTime = Number.NaN;
  private clock = 0;
  private shadowKey = -1;
  private disposed = false;
  private attached = false;

  constructor(readonly game: Game, readonly root: THREE.Group, seed: number) {
    this.ctx = new KitCtx(game, root, mulberry32((Number.isFinite(seed) ? seed : 1) >>> 0));
    this.physics = game.physics;
    this.mats = game.mats;
    this.statics.name = 'kit-static';
    this.statics.matrixAutoUpdate = false;
    root.add(this.statics);
    // Self-driving animation (doors, barriers, flicker): one routine on the sim clock. The mission system may
    // also call update() — calls that repeat a timestamp are ignored.
    const self = this;
    try {
      if (!isStub(game.scripts)) {
        this.ticker = game.scripts.start((function* () {
          for (;;) { self.update(game.time.dt, game.time.now); yield; }
        })(), { name: 'kit-update', group: 'kit' });
      }
    } catch (err) {
      this.ctx.warn('ticker', `could not start the kit update routine: ${String(err)}`);
    }
  }

  get finalized(): boolean { return this.ctx.finalized; }

  rand(): number { return this.ctx.rand(); }
  P(x: number, n: number, h = 0): THREE.Vector3 { return this.ctx.P(x, n, h); }
  yaw(yawDeg: number): number { return this.ctx.yaw(yawDeg); }

  // ---- markers ------------------------------------------------------------------------------------------
  marker(name: string, x: number, n: number, h = 0, yawDeg = 0): Marker {
    const m: Marker = { name, pos: this.P(this.ctx.num(x, 0), this.ctx.num(n, 0), this.ctx.num(h, 0)), yaw: this.yaw(this.ctx.num(yawDeg, 0)) };
    if (this.markers.has(name)) this.ctx.warn(`marker-dup:${name}`, `marker "${name}" defined twice — the later one wins`);
    this.markers.set(name, m);
    return m;
  }

  getMarker(name: string): Marker {
    const m = this.markers.get(name);
    if (m) return m;
    this.ctx.warn(`marker:${name}`, `unknown marker "${name}" — using the zone origin`);
    return { name, pos: new THREE.Vector3(), yaw: 0 };
  }

  hasMarker(name: string): boolean { return this.markers.has(name); }

  // ---- environment --------------------------------------------------------------------------------------
  setEnv(opts: ZoneEnvOpts): void {
    if (!opts) return;
    if (this.key) {
      // a second setEnv replaces the key light
      const i = this.ctx.shadowLights.findIndex((s) => s.light === this.key);
      if (i >= 0) this.ctx.shadowLights.splice(i, 1);
      const j = this.ctx.lights.indexOf(this.key);
      if (j >= 0) this.ctx.lights.splice(j, 1);
      this.key.shadow.map?.dispose();
      this.key.target.removeFromParent();
      this.key.removeFromParent();
      this.key = null;
    }
    this.key = applyEnv(this.ctx, opts);
    if (this.key && this.ctx.finalized) {
      fitKeyLight(this.key, this.worldBounds());
      this.refreshShadows(true);
    }
  }

  /** the key directional light created by setEnv (null before setEnv or with `key: null`) */
  get keyLight(): THREE.DirectionalLight | null { return this.key; }

  // ---- structure ----------------------------------------------------------------------------------------
  floor(o: FloorOpts): THREE.Object3D { return buildFloor(this.ctx, o); }
  disc(o: DiscOpts): THREE.Object3D { return buildDisc(this.ctx, o); }
  ramp(o: RampOpts): THREE.Object3D { return buildRamp(this.ctx, o); }
  deck(o: RectOpts & DeckExtras): THREE.Object3D { return buildDeck(this.ctx, o); }
  bridge(o: { from: [number, number]; to: [number, number]; h?: number; width?: number; mat?: MatId; broken?: 'none' | 'far' | 'mid'; finish?: SurfaceFinish }): THREE.Object3D { return buildBridge(this.ctx, o); }

  surfaceMaterial(finish: SurfaceFinish, base: MatId = 'whiteGoldFloor'): THREE.Material {
    return this.ctx.mat(this.ctx.finish(base, finish));
  }
  wall(o: WallOpts): THREE.Object3D { return buildWall(this.ctx, o); }
  walls(points: Array<[number, number]>, o?: Omit<WallOpts, 'from' | 'to'> & { closed?: boolean }): THREE.Object3D { return buildWalls(this.ctx, points, o); }
  ringWall(o: Parameters<ZoneBuilder['ringWall']>[0]): THREE.Object3D { return buildRingWall(this.ctx, o); }
  blocker(o: RectOpts & { height?: number }): ColliderHandle { return buildBlocker(this.ctx, o); }
  ceiling(o: CeilingOpts): THREE.Object3D { return buildCeiling(this.ctx, o); }
  rib(o: RibOpts): THREE.Object3D { return buildRib(this.ctx, o); }
  ribRow(o: RibOpts & { count: number; spacing: number; alongDeg?: number }): THREE.Object3D { return buildRibRow(this.ctx, o); }
  column(o: Parameters<ZoneBuilder['column']>[0]): THREE.Object3D { return buildColumn(this.ctx, o); }
  coverLow(o: CoverOpts): THREE.Object3D { return buildCover(this.ctx, o, 'low'); }
  coverHigh(o: CoverOpts): THREE.Object3D { return buildCover(this.ctx, o, 'high'); }
  door(o: DoorOpts): DoorHandle { return buildDoor(this.ctx, o); }
  barrier(o: Parameters<ZoneBuilder['barrier']>[0]): BarrierHandle { return buildBarrier(this.ctx, o); }
  rail(o: Parameters<ZoneBuilder['rail']>[0]): THREE.Object3D { return buildRail(this.ctx, o); }
  channel(points: Array<[number, number]>, o?: ChannelOpts): THREE.Object3D { return buildChannel(this.ctx, points, o); }
  conduit(points: Array<[number, number, number]>, o?: { r?: number; glow?: boolean; collider?: boolean }): THREE.Object3D { return buildConduit(this.ctx, points, o); }
  whitePoint(o: { x: number; n: number; h: number; intensity?: number }): THREE.Object3D { return buildWhitePoint(this.ctx, o); }
  frost(o: RectOpts & { height?: number; density?: number; collider?: boolean }): THREE.Object3D { return buildFrost(this.ctx, o); }
  corruption(o: Parameters<ZoneBuilder['corruption']>[0]): THREE.Object3D { return buildCorruption(this.ctx, o); }
  prop(kind: PropKind, o: PropOpts): THREE.Object3D { return buildProp(this.ctx, kind, o); }
  point(o: LightOpts): THREE.PointLight { return buildPoint(this.ctx, o); }
  spot(o: LightOpts): THREE.SpotLight { return buildSpot(this.ctx, o); }
  panelLight(o: Parameters<ZoneBuilder['panelLight']>[0]): THREE.Object3D { return buildPanelLight(this.ctx, o); }

  add<T extends THREE.Object3D>(obj: T): T {
    if (obj && (obj as THREE.Object3D).isObject3D) this.root.add(obj);
    else this.ctx.warn('add', 'add(): not an Object3D — ignored');
    return obj;
  }

  keep<T extends THREE.Object3D>(obj: T): T {
    if (obj && (obj as THREE.Object3D).isObject3D) obj.userData.kitKeep = true;
    return obj;
  }

  collider(desc: ColliderDesc): ColliderHandle { return this.ctx.collider(desc); }
  surface(desc: SurfaceDesc): SurfaceHandle { return this.ctx.surface(desc); }

  onUpdate(fn: (dt: number, time: number) => void): void {
    if (typeof fn === 'function') this.ctx.updaters.push(fn);
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------
  update(dt: number, time?: number): void {
    if (this.disposed) return;
    // safety net: a zone root that was in the scene and has been removed is an unloaded zone
    if (this.root.parent) this.attached = true;
    else if (this.attached) { this.dispose(); return; }
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (time !== undefined && Number.isFinite(time)) {
      if (time === this.lastTime) return;
      this.lastTime = time;
      this.clock = time;
    } else {
      this.clock += step;
    }
    for (const fn of this.ctx.updaters) {
      try { fn(step, this.clock); } catch (err) { this.ctx.warn(`updater:${String(err)}`, `update callback failed: ${String(err)}`); }
    }
    this.refreshShadows(false);
  }

  finalize(): void {
    if (this.disposed) return;
    const ctx = this.ctx, game = this.game;
    const res = mergeStatics(ctx, this.statics);
    this.mergedMeshes.push(...res.meshes);
    computeBounds(this.mergedMeshes, this.bounds.makeEmpty());
    const render = isStub(game.render) ? null : game.render;

    // polished floors: merged slabs plus any kept (unmerged) reflective slab. Integration wave: a mirror-polished
    // top (the dark marble floors) reflects a little stronger than the physical default — the paintings' floors
    // read wet; a rough finish ('worn', 'hangar') keeps the plain strength (its roughness fades the mirror out).
    this.root.traverse((o) => {
      const y = o.userData.kitReflectY;
      const mesh = o as THREE.Mesh;
      if (typeof y !== 'number' || !mesh.isMesh || ctx.reflective.has(mesh)) return;
      ctx.reflective.set(mesh, y);
      const rough = (mesh.material as THREE.MeshStandardMaterial).roughness;
      const strength = typeof rough === 'number' && rough <= 0.15 ? POLISHED_REFLECTION : 1;
      try { render?.registerReflectiveFloor(mesh, { y: y + this.root.getWorldPosition(new THREE.Vector3()).y, strength }); } catch (err) { ctx.warn('reflect', `registerReflectiveFloor failed: ${String(err)}`); }
    });

    budgetLights(ctx);
    if (this.key) {
      fitKeyLight(this.key, this.worldBounds());
      const dir = this.key.userData.kitDir as THREE.Vector3;
      if (ctx.reflective.size && dir.y < 0.64) {
        ctx.warn('key-glint', `key light is only ${Math.round((Math.asin(dir.y) * 180) / Math.PI)}° above a mirror-polished floor — its reflection blooms into a white glint; raise it above ~40° or keep it behind the usual view`);
      }
    }
    this.refreshShadows(true);

    ctx.finalized = true;
    ctx.rebuildNav();
    if (game.flags?.debug === true) {
      try {
        const issues = this.physics.validate();
        if (Array.isArray(issues)) for (const i of issues.slice(0, 8)) console.warn(`[kit] physics ${i.kind} @ (${i.x.toFixed(1)}, ${i.y.toFixed(1)}, ${i.z.toFixed(1)}): ${i.message}`);
      } catch { /* validation is advisory */ }
    }
    try { render?.refreshEnvironment({ scene: true }); } catch (err) { ctx.warn('env-refresh', `refreshEnvironment failed: ${String(err)}`); }

    this.stats.meshes = this.mergedMeshes.length;
    this.stats.triangles += Math.round(res.triangles);
    this.stats.merged += res.merged;
    this.stats.lights = ctx.lights.length;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ctx = this.ctx, game = this.game;
    this.ticker?.stop();
    this.ticker = null;
    ctx.updaters.length = 0;
    if (!isStub(game.render)) {
      for (const mesh of ctx.reflective.keys()) {
        try { game.render.unregisterReflectiveFloor(mesh); } catch { /* renderer already gone */ }
      }
    }
    ctx.reflective.clear();
    for (const light of ctx.lights) {
      const shadow = (light as THREE.DirectionalLight).shadow;
      shadow?.map?.dispose();
      (light as THREE.SpotLight).target?.removeFromParent();
      light.removeFromParent();
      light.dispose();
    }
    ctx.lights.length = 0;
    ctx.shadowLights.length = 0;
    for (const d of ctx.disposables) {
      try { d.dispose(); } catch { /* already disposed */ }
    }
    ctx.disposables.clear();
    this.mergedMeshes.length = 0;
    for (let i = this.root.children.length - 1; i >= 0; i--) this.root.remove(this.root.children[i]);
    this.markers.clear();
    this.key = null;
  }

  // ---- internals ----------------------------------------------------------------------------------------
  private worldBounds(): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    return this.bounds.clone().applyMatrix4(this.root.matrixWorld);
  }

  /** (re)apply the shadow budget when it could have changed: quality level or the set of lights */
  private refreshShadows(force: boolean): void {
    const q = this.ctx.quality();
    const key = (q.shadows ? 1 : 0) + q.maxShadowLights * 2 + this.ctx.shadowLights.length * 64 + q.shadowMapSize * 4096;
    if (!force && key === this.shadowKey) return;
    this.shadowKey = key;
    applyShadowBudget(this.ctx);
    this.stats.shadowLights = this.ctx.shadowLights.filter((s) => s.light.castShadow).length;
  }
}
