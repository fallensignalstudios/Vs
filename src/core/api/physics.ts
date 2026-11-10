/**
 * Physics + navigation contract — OWNER: physics-nav (src/world/{physics,nav}.ts).
 *
 * A deliberately simple, deterministic 2.5D world:
 *  - WALKABLE SURFACES define where characters may stand (flat rects/discs or linear ramps). Characters are
 *    always grounded on a surface. There is no jumping and no falling off the critical path:
 *    a move that would leave all surfaces, or step down more than `maxDrop`, is blocked ("fall protection").
 *  - SOLID COLLIDERS (oriented boxes / vertical cylinders with a Y extent) block movement, sight and shots.
 *  - TRIGGERS report player/actor overlap.
 *  - NAV: grid A* over the walkable surfaces minus solids, for ground AI and autoplay.
 */
import type { Vec3Like } from './common';

export type ColliderShape =
  | { kind: 'box'; hx: number; hy: number; hz: number }
  | { kind: 'cyl'; r: number; hy: number };

export interface ColliderDesc {
  shape: ColliderShape;
  /** centre */
  x: number; y: number; z: number;
  yaw?: number;
  /** default true */
  blocksMove?: boolean;
  /** default true (false for glass / low rails / barriers you can see through) */
  blocksSight?: boolean;
  /** default true */
  blocksShots?: boolean;
  /** cover classification for AI + player cover hints */
  cover?: 'low' | 'high';
  tag?: string;
  userData?: unknown;
}

export interface ColliderHandle {
  readonly id: number;
  readonly desc: ColliderDesc;
  /** disabled colliders are ignored by every query (doors, barriers, destroyed cover) */
  enabled: boolean;
  setPose(x: number, y: number, z: number, yaw?: number): void;
  remove(): void;
}

export type SurfaceShape =
  | { kind: 'rect'; hx: number; hz: number }
  | { kind: 'disc'; r: number; inner?: number };

export interface SurfaceDesc {
  shape: SurfaceShape;
  /** centre in XZ */
  x: number; z: number;
  yaw?: number;
  /** height. For ramps: height at the local -Z edge. */
  y: number;
  /** if set, the surface is a ramp: height at the local +Z edge (rect only) */
  y1?: number;
  /** footstep / decal material */
  material?: 'stone' | 'metal' | 'ice' | 'grate' | 'glass';
  tag?: string;
}

export interface SurfaceHandle {
  readonly id: number;
  readonly desc: SurfaceDesc;
  enabled: boolean;
  remove(): void;
}

export interface GroundHit {
  y: number;
  surface: SurfaceHandle;
}

export interface RayHit {
  point: Vec3Like;
  normal: Vec3Like;
  distance: number;
  collider: ColliderHandle | null;
  /** true if the ray hit a walkable surface (floor) rather than a collider */
  ground: boolean;
}

export interface MoveResult {
  x: number; y: number; z: number;
  /** blocked by a solid or by fall protection this move */
  blocked: boolean;
  /** unit normal of the last blocking contact (xz), or null */
  normal: { x: number; z: number } | null;
}

export interface MoveOpts {
  /** max step up (default 0.45) */
  stepUp?: number;
  /** max step down before fall protection blocks the move (default 0.7) */
  maxDrop?: number;
  /** character height for vertical overlap tests (default 1.8) */
  height?: number;
  /** flying actors ignore surfaces and only collide with solids at their altitude */
  flying?: boolean;
}

export type TriggerShape =
  | { kind: 'box'; x: number; z: number; hx: number; hz: number; yaw?: number; yMin?: number; yMax?: number }
  | { kind: 'circle'; x: number; z: number; r: number; yMin?: number; yMax?: number };

export interface TriggerHandle {
  readonly shape: TriggerShape;
  enabled: boolean;
  /** true while the tracked point (player by default) is inside */
  readonly inside: boolean;
  remove(): void;
}

export const RAY_MOVE = 1;
export const RAY_SIGHT = 2;
export const RAY_SHOT = 4;
export const RAY_GROUND = 8;

export interface PhysicsWorld {
  addCollider(desc: ColliderDesc): ColliderHandle;
  addSurface(desc: SurfaceDesc): SurfaceHandle;
  /**
   * Trigger tested against the player's feet position each tick (Game supplies the position through
   * updateTriggers). Callbacks fire on edge transitions.
   */
  addTrigger(shape: TriggerShape, onEnter?: () => void, onExit?: () => void): TriggerHandle;

  /** Highest enabled surface at (x,z) whose height <= yRef + stepUp. null if none. */
  groundAt(x: number, z: number, yRef: number, stepUp?: number): GroundHit | null;
  /** true if a character of `radius` can stand at the point (on a surface, not inside a solid) */
  canStand(x: number, y: number, z: number, radius: number, height?: number): boolean;

  /**
   * Move a grounded character circle from `from` by (dx,dz) with wall sliding, step-up, ramp following and fall
   * protection. Returns the resolved position (y snapped to ground).
   */
  moveCharacter(from: Vec3Like, radius: number, dx: number, dz: number, opts?: MoveOpts): MoveResult;

  /** Nearest valid standing point to (x,z) near yRef within maxDist, or null. Used to un-stick actors. */
  nearestStandable(x: number, y: number, z: number, radius: number, maxDist?: number): Vec3Like | null;

  /** Ray vs solids (filtered by mask: RAY_MOVE | RAY_SIGHT | RAY_SHOT) and optionally floors (RAY_GROUND). */
  raycast(origin: Vec3Like, dir: Vec3Like, maxDist: number, mask?: number): RayHit | null;
  /** Unobstructed sight line between two points (uses RAY_SIGHT). */
  lineOfSight(a: Vec3Like, b: Vec3Like): boolean;
  /** Unobstructed firing line (uses RAY_SHOT). */
  lineOfFire(a: Vec3Like, b: Vec3Like): boolean;
  /** Push a sphere out of solids (camera collision). Returns the allowed fraction 0..1 along from→to. */
  sweepSphere(from: Vec3Like, to: Vec3Like, radius: number, mask?: number): number;
  /** Colliders overlapping a circle (xz) within the y range */
  queryColliders(x: number, z: number, radius: number, yMin: number, yMax: number): ColliderHandle[];
  /** Cover colliders near a point, nearest first */
  coverNear(x: number, z: number, radius: number): ColliderHandle[];

  readonly nav: NavGrid;

  /** Evaluate triggers for the tracked point. Called by Game each tick with the player's feet position. */
  updateTriggers(point: Vec3Like | null): void;

  /** Remove everything (zone unload). */
  clear(): void;

  /** Debug wireframes of surfaces/colliders/nav as a THREE.Object3D (lazily rebuilt). */
  debugObject(): unknown;
  readonly counts: { colliders: number; surfaces: number; triggers: number };
}

export interface NavPath {
  points: Vec3Like[];
  length: number;
}

export interface NavGrid {
  /** (Re)build from current surfaces + colliders. Cheap enough to call when a door/barrier toggles. */
  rebuild(opts?: { cell?: number; agentRadius?: number }): void;
  /** Smoothed path, or null when unreachable. */
  findPath(from: Vec3Like, to: Vec3Like): NavPath | null;
  /** Is the point on walkable, unobstructed nav? */
  isWalkable(x: number, y: number, z: number): boolean;
  /** Nearest walkable nav point */
  nearest(x: number, y: number, z: number, maxDist?: number): Vec3Like | null;
  /** Deterministic pseudo-random reachable point within radius of centre (seeded by `seed`). */
  randomPoint(center: Vec3Like, radius: number, seed: number): Vec3Like | null;
  /** Straight walk possible between two points without leaving nav / hitting solids? */
  walkable(a: Vec3Like, b: Vec3Like): boolean;
  readonly built: boolean;
}
