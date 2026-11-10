/**
 * Physics + navigation subsystem (OWNER: physics-nav) — implements `PhysicsWorld` from '@/core/api/physics'.
 *
 * A deterministic 2.5D world of walkable surfaces + solid colliders:
 *   world.ts      registries, spatial hash broadphase, ground / standing / overlap / cover / trigger queries
 *   move.ts       grounded character movement (sliding, step-up, ramps, fall protection, no tunnelling)
 *   ray.ts        raycast, line of sight / fire, swept sphere
 *   nav.ts        multi-level nav grid, incremental rebuild, A* (navsearch.ts) + string-pull smoothing
 *   debug.ts      three.js debug drawing (the only three.js dependency; everything else is plain math)
 *   fixtures.ts   Z04 / Z08 / Z05 blockouts used by the tests and the sandbox
 */
import type {
  ColliderDesc, ColliderHandle, Game, GroundHit, MoveOpts, MoveResult, NavGrid, PhysicsWorld, RayHit,
  SurfaceDesc, SurfaceHandle, TriggerHandle, TriggerShape, Vec3Like,
} from '@/core/api';
import { RAY_SHOT, RAY_SIGHT } from '@/core/api/physics';
import { createPhysicsDebug } from './debug';
import { moveCharacter } from './move';
import { NavGridImpl } from './nav';
import { raycast, segmentClear, sweepSphere } from './ray';
import { PhysicsCore } from './world';

class PhysicsWorldImpl implements PhysicsWorld {
  private readonly core = new PhysicsCore();
  private readonly navGrid = new NavGridImpl(this.core);
  private debug: unknown = null;

  get nav(): NavGrid { return this.navGrid; }
  get counts(): { colliders: number; surfaces: number; triggers: number } { return this.core.counts; }
  get revision(): number { return this.core.revision; }

  addCollider(desc: ColliderDesc): ColliderHandle { return this.core.addCollider(desc); }
  addSurface(desc: SurfaceDesc): SurfaceHandle { return this.core.addSurface(desc); }
  addTrigger(shape: TriggerShape, onEnter?: () => void, onExit?: () => void): TriggerHandle {
    return this.core.addTrigger(shape, onEnter, onExit);
  }

  groundAt(x: number, z: number, yRef: number, stepUp?: number): GroundHit | null {
    return this.core.groundAt(x, z, yRef, stepUp);
  }

  canStand(x: number, y: number, z: number, radius: number, height?: number): boolean {
    return this.core.canStand(x, y, z, radius, height);
  }

  moveCharacter(from: Vec3Like, radius: number, dx: number, dz: number, opts?: MoveOpts): MoveResult {
    return moveCharacter(this.core, from, radius, dx, dz, opts);
  }

  nearestStandable(x: number, y: number, z: number, radius: number, maxDist?: number): Vec3Like | null {
    return this.core.nearestStandable(x, y, z, radius, maxDist);
  }

  raycast(origin: Vec3Like, dir: Vec3Like, maxDist: number, mask?: number): RayHit | null {
    return raycast(this.core, origin, dir, maxDist, mask);
  }

  lineOfSight(a: Vec3Like, b: Vec3Like): boolean { return segmentClear(this.core, a, b, RAY_SIGHT); }
  lineOfFire(a: Vec3Like, b: Vec3Like): boolean { return segmentClear(this.core, a, b, RAY_SHOT); }

  sweepSphere(from: Vec3Like, to: Vec3Like, radius: number, mask?: number): number {
    return sweepSphere(this.core, from, to, radius, mask);
  }

  queryColliders(x: number, z: number, radius: number, yMin: number, yMax: number): ColliderHandle[] {
    return this.core.queryColliders(x, z, radius, yMin, yMax);
  }

  coverNear(x: number, z: number, radius: number): ColliderHandle[] { return this.core.coverNear(x, z, radius); }

  updateTriggers(point: Vec3Like | null): void { this.core.updateTriggers(point); }

  clear(): void { this.core.clear(); }

  debugObject(): unknown {
    if (!this.debug) this.debug = createPhysicsDebug(this.core, this.navGrid);
    else ((this.debug as { userData: { refresh(): void } }).userData.refresh)();
    return this.debug;
  }
}

/**
 * Create the collision + navigation world. `game` is accepted for symmetry with the other factories; the world
 * has no dependencies on other subsystems and works with `null` (tests, sandboxes).
 */
export function createPhysicsWorld(_game: Game | null): PhysicsWorld {
  return new PhysicsWorldImpl();
}
