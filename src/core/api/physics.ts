/**
 * Physics + navigation contract — OWNER: physics-nav (src/world/{physics,nav}.ts).
 * Implementation: src/world/physics/ (pure TypeScript; fixtures of Z04 / Z08 / Z05 in fixtures.ts show how a
 * zone is expressed as surfaces + solids).
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
  /**
   * ADDED (physics-nav): the surface that was hit when `ground` is true (its `desc.material` picks the impact
   * decal / sound), otherwise null. Always set by the real physics world; optional so hand-built hits stay valid.
   */
  surface?: SurfaceHandle | null;
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
  /**
   * flying actors ignore surfaces and only collide with solids at their altitude: `from.y` is the BOTTOM of the
   * body (its real altitude, e.g. 1.5 for a hovering drone) and `height` its vertical size, so a drone at 1.5 m
   * passes over 1.2 m low cover but is stopped by 2.2 m high cover and walls. y is returned unchanged.
   */
  flying?: boolean;
  /**
   * ADDED (physics-nav): optional result object to fill instead of allocating a new MoveResult. Pass one
   * long-lived object per actor to keep the per-frame movement path allocation-free.
   */
  out?: MoveResult;
}

/** ADDED (physics-nav): the defaults used by moveCharacter / canStand / the nav grid. */
export const MOVE_DEFAULTS = { stepUp: 0.45, maxDrop: 0.7, height: 1.8 } as const;

export type TriggerShape =
  | { kind: 'box'; x: number; z: number; hx: number; hz: number; yaw?: number; yMin?: number; yMax?: number }
  | { kind: 'circle'; x: number; z: number; r: number; yMin?: number; yMax?: number };

export interface TriggerHandle {
  readonly shape: TriggerShape;
  enabled: boolean;
  /** true while the tracked point (player by default) is inside */
  readonly inside: boolean;
  /**
   * ADDED (physics-nav): pure test of an arbitrary point against this trigger volume (ignores `enabled`, fires
   * nothing) — e.g. "has the escorted NPC reached the exit volume?".
   */
  contains(point: Vec3Like): boolean;
  remove(): void;
}

export const RAY_MOVE = 1;
export const RAY_SIGHT = 2;
export const RAY_SHOT = 4;
export const RAY_GROUND = 8;

export interface PhysicsWorld {
  /**
   * Register a solid. The description is copied (later edits go through the handle: `enabled`, `setPose`,
   * `remove`; the `blocks*` / `cover` flags of `handle.desc` may be changed live). Never throws: non-finite
   * numbers are sanitised with a single console warning.
   */
  addCollider(desc: ColliderDesc): ColliderHandle;
  /**
   * Register a walkable surface. Characters stand on the HIGHEST surface within step-up of their feet, so a
   * balcony over a floor is simply two surfaces.
   *
   * Surfaces carry no thickness, but a HEADROOM RULE keeps bodies out of them: a character may not move to a
   * point where another surface hangs between step height and its body height above the ground it would
   * stand on. So the low end of a ramp, or a 0.6 m dais, blocks a walker on the floor beside it; where the
   * surface is ≥ body height up (a balcony, the tall end of a ramp) the walker passes underneath. The rule is
   * tested at the feet point — add solids (deck slab, ramp under-fill, rails) wherever the body must not even
   * overlap the side, and so that shots and sight are blocked too.
   */
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
   *
   * Behaviour notes (physics-nav):
   *  - Solids only block when they overlap the band (y + stepUp, y + height): anything ≤ stepUp tall is stepped
   *    over, anything starting above head height is walked under.
   *  - Fall protection tests the FEET POINT (circle centre): it must stay on a surface, never drop more than
   *    maxDrop in one step, and keep headroom under overhanging surfaces (see addSurface). At an edge the move
   *    slides along it (straight, curved or rotated edges alike).
   *  - Long moves are sub-stepped (≤ radius/2), so fast dodges and 20 m/s knock-backs cannot tunnel.
   *  - A character that starts inside a solid (door closed on it) is pushed out; one that starts off every
   *    surface moves freely until it reaches ground again. Use nearestStandable for hard un-sticking.
   *  - A new MoveResult is returned per call unless `opts.out` is supplied.
   */
  moveCharacter(from: Vec3Like, radius: number, dx: number, dz: number, opts?: MoveOpts): MoveResult;

  /**
   * Nearest valid standing point to (x,z) near yRef within maxDist (default 4), or null. Used to un-stick
   * actors. Prefers ground at the reference level; falls back to any level if none is in range.
   */
  nearestStandable(x: number, y: number, z: number, radius: number, maxDist?: number): Vec3Like | null;

  /**
   * Ray vs solids (filtered by mask: RAY_MOVE | RAY_SIGHT | RAY_SHOT) and optionally floors (RAY_GROUND).
   * `dir` need not be normalised; `distance` is in metres. A collider is tested when it blocks ANY of the
   * masked categories. Default mask = RAY_SIGHT | RAY_SHOT ("anything physical" — skips invisible move-only
   * blockers). A ray that starts inside a solid hits it at distance 0 with normal = −dir. Floors are two-sided.
   */
  raycast(origin: Vec3Like, dir: Vec3Like, maxDist: number, mask?: number): RayHit | null;
  /**
   * Unobstructed sight line between two points (uses RAY_SIGHT). Solids that CONTAIN either endpoint are
   * ignored, so aiming at the centre of a device (or looking out of a scanner housing) is not blocked by that
   * device's own collider. Consequently, test from an eye / chest point — not from a muzzle that may poke into
   * a wall the actor is hugging (use raycast for the shot itself: it reports a start inside a solid as a hit).
   */
  lineOfSight(a: Vec3Like, b: Vec3Like): boolean;
  /** Unobstructed firing line (uses RAY_SHOT). Same endpoint rule as lineOfSight. */
  lineOfFire(a: Vec3Like, b: Vec3Like): boolean;
  /**
   * Push a sphere out of solids (camera collision). Returns the allowed fraction 0..1 along from→to.
   * Default mask = RAY_SIGHT | RAY_MOVE: everything a camera must stay out of — walls and cover, but also
   * glass, energy barriers and invisible blocking volumes (a 1.1 m rail only matters when the sphere dips below
   * its top). Pass RAY_SIGHT alone to collide with opaque geometry only; add RAY_GROUND to also stop at
   * floors/ramps. Returns 0 when `from` already overlaps a solid. The sphere stops 1 cm short of contact so
   * consecutive sweeps never start inside. Box edges are treated conservatively (the sphere may stop up to
   * 0.4 × radius early at a sharp box corner; it never clips).
   */
  sweepSphere(from: Vec3Like, to: Vec3Like, radius: number, mask?: number): number;
  /** Colliders overlapping a circle (xz) within the y range */
  queryColliders(x: number, z: number, radius: number, yMin: number, yMax: number): ColliderHandle[];
  /** Cover colliders near a point, nearest first */
  coverNear(x: number, z: number, radius: number): ColliderHandle[];
  /**
   * ADDED (physics-nav): a standing point (feet, y on the ground) tucked behind `cover` that is hidden from
   * `threat` — the threat's eye or muzzle position. Low cover hides a crouched body (tested at 0.9 m), high
   * cover a standing one (1.5 m). Tries the spot directly opposite the threat first, then fans out along the
   * far side; null when nothing behind this cover is both standable and protected. `radius` defaults to 0.4.
   * Typical use: `for (const c of physics.coverNear(x, z, 12)) { const p = physics.coverPoint(c, enemyEye); … }`.
   */
  coverPoint(cover: ColliderHandle, threat: Vec3Like, radius?: number): Vec3Like | null;

  readonly nav: NavGrid;

  /**
   * Evaluate triggers for the tracked point. Called by Game each tick with the player's feet position.
   * A null point (no live player) leaves every trigger state untouched — dying inside a volume does not fire
   * its exit callback. Callbacks may add/remove triggers or clear the world; a throwing callback is logged
   * and does not stop the others.
   */
  updateTriggers(point: Vec3Like | null): void;

  /** Remove everything (zone unload). */
  clear(): void;

  /**
   * Debug wireframes of surfaces/colliders/nav as a THREE.Object3D (lazily rebuilt). The same THREE.Group is
   * returned every call and refreshes itself whenever the world changes while it is visible in a scene:
   * surfaces green (ramps lighter), solids red, cover blue (low light / high dark), sight-through solids orange,
   * triggers yellow, nav nodes as dots.
   */
  debugObject(): unknown;
  readonly counts: { colliders: number; surfaces: number; triggers: number };

  /**
   * ADDED (physics-nav): bumped on every structural change (collider/surface added, removed, moved or
   * enabled/disabled). Cheap way to cache anything derived from the collision world.
   */
  readonly revision: number;
}

export interface NavPath {
  points: Vec3Like[];
  length: number;
}

export interface NavGrid {
  /**
   * (Re)build from current surfaces + colliders. Cheap enough to call when a door/barrier toggles.
   * Defaults: cell 0.5 m, agentRadius 0.45 m (options persist for later calls). When only a few
   * colliders/surfaces changed since the last build, only the cells they touch are re-evaluated (well under
   * 1 ms for a door; a full 70 × 48 m build is ~12 ms warm); with no changes it is a no-op. The first query on
   * an unbuilt grid builds it automatically.
   */
  rebuild(opts?: { cell?: number; agentRadius?: number }): void;
  /**
   * Smoothed path, or null when unreachable. `points[0]` is `from`; the last point is `to` (or the nearest nav
   * point to it when `to` itself is off the grid). Endpoints up to 3 m off the grid are snapped to it. The
   * polyline keeps agentRadius clearance from solids and follows the ground within 0.3 m (waypoints are kept at
   * ramp ends), so it can be drawn as a guide line as well as followed.
   */
  findPath(from: Vec3Like, to: Vec3Like): NavPath | null;
  /** Is the point on walkable, unobstructed nav? */
  isWalkable(x: number, y: number, z: number): boolean;
  /** Nearest walkable nav point (default maxDist 4) */
  nearest(x: number, y: number, z: number, maxDist?: number): Vec3Like | null;
  /** Deterministic pseudo-random reachable point within radius of centre (seeded by `seed`). */
  randomPoint(center: Vec3Like, radius: number, seed: number): Vec3Like | null;
  /**
   * Straight walk possible between two points without leaving nav / hitting solids? Conservative: true means
   * an agentRadius circle clears every solid along the line and the line never crosses a walkable edge or a
   * step higher than step-up.
   */
  walkable(a: Vec3Like, b: Vec3Like): boolean;
  readonly built: boolean;

  /**
   * ADDED (physics-nav): findPath for a WIDE agent (the elite, anything with radius > agentRadius). Only uses
   * nav nodes whose distance to the nearest movement-blocking solid is ≥ `radius` (up to 3 m), so a 1.2 m body
   * is routed down the middle of a 3 m loop and never asked to squeeze between cover islands. Endpoints snap to
   * the nearest node that fits. null when no route is wide enough. Because clearance is sampled at node
   * centres, a passage is only guaranteed usable when it is at least 2 · radius + one cell wide.
   */
  findPathFor(from: Vec3Like, to: Vec3Like, radius: number): NavPath | null;
  /** ADDED (physics-nav): walkable() for a wide agent of the given radius. */
  walkableFor(a: Vec3Like, b: Vec3Like, radius: number): boolean;
  /**
   * ADDED (physics-nav): free radius at a nav point — distance (m, capped at 3) to the nearest
   * movement-blocking solid at that level; 0 when the point is off the nav grid. Use it to pick open ground
   * (spawn points, retreat spots, where a large creature can turn).
   */
  clearance(x: number, y: number, z: number): number;

  /** ADDED (physics-nav): true when colliders/surfaces changed since the last rebuild (call rebuild()). */
  readonly stale: boolean;
  /** ADDED (physics-nav): number of nav nodes in the current build (0 before the first build). */
  readonly nodeCount: number;
  /** ADDED (physics-nav): cell size of the current build in metres. */
  readonly cellSize: number;
}
