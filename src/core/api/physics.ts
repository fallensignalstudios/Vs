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
  /**
   * ADDED (physics-nav): does the floor itself stop sight lines / shots? Default true for both, so a deck or a
   * bare ramp hides and protects what is beneath it even with no slab solid under it. Set false for glass
   * walkways (`blocksSight`) or open grating (both).
   */
  blocksSight?: boolean;
  /** ADDED (physics-nav): see `blocksSight`. Default true. */
  blocksShots?: boolean;
  tag?: string;
}

export interface SurfaceHandle {
  readonly id: number;
  readonly desc: SurfaceDesc;
  enabled: boolean;
  /**
   * ADDED (physics-nav): move the surface — a lift plate, a sliding bridge. `y` becomes `desc.y` (a ramp keeps
   * its rise). An actor standing on it is carried: its next moveCharacter snaps to the new height as long as
   * the plate moved less than step-up (rising) / max-drop (sinking) since the last call. The nav grid picks
   * the change up on its next query (only the cells under the old and new footprint are re-evaluated).
   * Always present on handles returned by the physics world; optional so hand-built handles stay valid.
   */
  setPose?(x: number, y: number, z: number, yaw?: number): void;
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

/**
 * ADDED (physics-nav): why a move was blocked.
 *  - 'solid'     a collider (wall, cover, door, a soffit too low over the next step of a ramp)
 *  - 'edge'      fall protection: a ledge, a drop deeper than max-drop, the side of a surface without headroom
 *  - 'recovered' the start position was invalid (inside a solid, off every surface, wrong height); the actor
 *                was put on the nearest spot where it can stand — expect a visible pop, and a console warning
 *  - 'lost'      invalid start and nothing standable within 4 m: the position is held
 *  - 'limit'     the requested move exceeded the per-call cap (512 sub-steps ≈ 100 m) and was truncated
 */
export type MoveBlockReason = 'solid' | 'edge' | 'recovered' | 'lost' | 'limit';

export interface MoveResult {
  x: number; y: number; z: number;
  /** blocked by a solid or by fall protection this move */
  blocked: boolean;
  /** unit normal of the last blocking contact (xz), or null */
  normal: { x: number; z: number } | null;
  // The members below are ADDED (physics-nav). The real physics world always sets them; they are optional so
  // hand-built results (mocks, caller-owned `out` objects) stay valid.
  /** true when the result stands on a walkable surface (always, for a non-flying actor, unless 'lost') */
  grounded?: boolean;
  /** the surface stood on — `surface.desc.material` picks the footstep sound; null when not grounded */
  surface?: SurfaceHandle | null;
  /**
   * height change of this call (result.y − from.y). Step-ups (≤ step-up) and drops (≤ max-drop) arrive in
   * one call: smooth the VISUAL height in the controller / camera with this, never the physics position.
   */
  stepDy?: number;
  /** why the last block happened; null when `blocked` is false */
  reason?: MoveBlockReason | null;
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
   * long-lived object per actor to keep the per-frame movement path allocation-free (its `normal` object is
   * allocated once and then reused whenever there is contact).
   */
  out?: MoveResult;
  /**
   * ADDED (physics-nav): how far the feet point keeps from a ledge (a void, or a drop deeper than maxDrop).
   * Default: 0.25 m or half the radius, whichever is larger, capped at the radius — so a 0.4 m body
   * overhangs an unrailed edge by 0.15 m instead of 0.4 m, and the 1.2 m elite by 0.6 m instead of 1.2 m. Pass 0 for the bare feet-point rule. Walkways must
   * be wider than twice this to be usable (≥ 0.6 m for humans). An actor that already stands inside the
   * margin (spawned on a rim) is not trapped: the rule re-arms once it has walked clear.
   */
  edgeMargin?: number;
  /**
   * ADDED (physics-nav): opt back in to the old behaviour for an actor that is not on any surface: move
   * against solids only, y unchanged, until it reaches ground. Default false — such an actor is put on the
   * nearest standable spot instead (see MoveBlockReason 'recovered' / 'lost').
   */
  freeRoam?: boolean;
}

/**
 * ADDED (physics-nav): the defaults used by moveCharacter / canStand / the nav grid.
 * `gap` is the widest crack between two surfaces that still counts as continuous floor: narrower cracks are
 * walked over at any speed, wider ones are a ledge at any speed (and the nav grid agrees).
 */
export const MOVE_DEFAULTS = { stepUp: 0.45, maxDrop: 0.7, height: 1.8, edgeMargin: 0.25, edgeMarginScale: 0.5, gap: 0.12 } as const;

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

/**
 * ADDED (physics-nav): one authoring problem found by `PhysicsWorld.validate()`.
 *  - 'gap'         two surfaces 0.12–0.5 m apart at the same level that touch nowhere: a void strip nobody
 *                  can cross (move the modules together, or overlap them)
 *  - 'low-solid'   a movement-blocking solid no taller than step-up with no surface on top: characters walk
 *                  straight through it at floor level (give it a top surface, or make it taller)
 *  - 'narrow'      a surface too narrow to walk along with the default ledge margin (< 0.6 m of free width)
 *  - 'steep'       a ramp steeper than 45° — almost always a typo in y / y1
 */
export interface PhysicsIssue {
  kind: 'gap' | 'low-solid' | 'narrow' | 'steep';
  /** where to look */
  x: number; y: number; z: number;
  /** human-readable description, including the tags involved */
  message: string;
}

export interface PhysicsWorld {
  /**
   * Register a solid. The description is copied (later edits go through the handle: `enabled`, `setPose`,
   * `remove`; the `blocks*` / `cover` flags of `handle.desc` may be assigned live — movement, rays, the nav
   * grid and the debug view all follow). Never throws. A description with an unknown shape or a non-finite
   * number is NOT registered: one console warning names its tag and the returned handle is inert (as after
   * `remove()`), so bad data can never become phantom geometry at the origin.
   */
  addCollider(desc: ColliderDesc): ColliderHandle;
  /**
   * Register a walkable surface. Characters stand on the HIGHEST surface within step-up of their feet, so a
   * balcony over a floor is simply two surfaces. Invalid descriptions are ignored exactly as for addCollider.
   *
   * CRACKS: surfaces need not touch exactly. A crack up to MOVE_DEFAULTS.gap (0.12 m) wide between two
   * surfaces at the same level is floor — for movement at any speed, for canStand / groundAt and for the nav
   * grid. Anything wider is a ledge for all of them. `validate()` lists the gaps that are too wide.
   *
   * Surfaces carry no thickness, but a HEADROOM RULE keeps bodies out of them: a character may not move to a
   * point where another surface hangs between step height and its body height above the ground it would
   * stand on. So the low end of a ramp, or a 0.6 m dais, blocks a walker on the floor beside it; where the
   * surface is ≥ body height up (a balcony, the tall end of a ramp) the walker passes underneath. The rule is
   * tested at the feet point — add solids (deck slab, ramp under-fill, rails) wherever the body must not even
   * overlap the side. Sight lines and shots are stopped by the surface itself (see SurfaceDesc.blocksSight).
   */
  addSurface(desc: SurfaceDesc): SurfaceHandle;
  /**
   * Trigger tested against the player's feet position each tick (Game supplies the position through
   * updateTriggers). Callbacks fire on edge transitions.
   */
  addTrigger(shape: TriggerShape, onEnter?: () => void, onExit?: () => void): TriggerHandle;

  /**
   * Highest enabled surface at (x,z) whose height <= yRef + stepUp. null if none. Allocates the result unless
   * `out` (ADDED) is passed — per-frame callers (camera, vfx, footsteps) should keep one and reuse it.
   */
  groundAt(x: number, z: number, yRef: number, stepUp?: number, out?: GroundHit): GroundHit | null;
  /**
   * true if a character of `radius` could have been moved to the point by moveCharacter: on a surface within
   * step-up / max-drop of y, with headroom for `height` (default 1.8), clear of solids, and its feet the
   * ledge margin away from any drop. `edgeMargin` (ADDED) overrides that margin (see MoveOpts.edgeMargin).
   */
  canStand(x: number, y: number, z: number, radius: number, height?: number, edgeMargin?: number): boolean;

  /**
   * Move a grounded character circle from `from` by (dx,dz) with wall sliding, step-up, ramp following and fall
   * protection. Returns the resolved position (y snapped to ground).
   *
   * Behaviour notes (physics-nav):
   *  - The result is always a place where the body can REST: on valid ground, with every solid that overlaps
   *    the band (y + stepUp, y + height) AT THE RESULT'S HEIGHT clear of the circle. Anything ≤ stepUp tall
   *    is stepped over, anything starting above head height is walked under; climbing a ramp or a step under
   *    a soffit stops where the head would meet it (and slides along that line), it never ends inside it.
   *  - Fall protection: the feet point (circle centre) must stay on a surface, never drop more than maxDrop in
   *    one step, keep headroom under overhanging surfaces (see addSurface) and stay `edgeMargin` away from
   *    ledges. At an edge the move slides along it (straight, curved or rotated edges alike).
   *  - Long moves are sub-stepped (≤ radius/2) and the ground is sampled every ~0.1 m along each sub-step, so
   *    fast dodges and 20 m/s knock-backs can neither tunnel through a wall nor skip a void.
   *  - `from.y` should be the y of the previous result. It is snapped to the ground within step-up above /
   *    max-drop below it. A start that is not standing on anything (a marker at the wrong height or outside
   *    the level, a bridge that retracted), or that is inside a solid with no clean way out, is RELOCATED to
   *    the nearest standable spot with a console warning (`reason: 'recovered'`): straight up or down onto
   *    the level at its XZ when there is one (any height difference), else sideways within 4 m. With nothing
   *    in range the position is held (`reason: 'lost'`, `grounded: false`). It never roams through the void —
   *    unless `opts.freeRoam` asks for that.
   *  - A character pushed out of a solid that appears on it (a closing door) leaves through the nearest face,
   *    but never to the far side of a different wall.
   *  - Allocation: a new MoveResult per call unless `opts.out` is supplied.
   */
  moveCharacter(from: Vec3Like, radius: number, dx: number, dz: number, opts?: MoveOpts): MoveResult;

  /**
   * Nearest valid standing point to (x,z) near yRef within maxDist (default 4), or null. Used to un-stick
   * actors and to validate spawn points. Prefers ground at the reference level; falls back to any level if
   * none is in range. `height` (ADDED, default 1.8) is the body height — pass 3.6 for the elite so the spot
   * is not under a balcony it cannot stand beneath. The result satisfies canStand(…, radius, height).
   */
  nearestStandable(x: number, y: number, z: number, radius: number, maxDist?: number, height?: number): Vec3Like | null;

  /**
   * Ray vs solids (filtered by mask: RAY_MOVE | RAY_SIGHT | RAY_SHOT) and floors.
   * `dir` need not be normalised; `distance` is in metres. A collider is tested when it blocks ANY of the
   * masked categories. Default mask = RAY_SIGHT | RAY_SHOT ("anything physical" — skips invisible move-only
   * blockers). A ray that starts inside a solid hits it at distance 0 with normal = −dir.
   *
   * FLOORS (physics-nav): walkable surfaces are physical too. A ray masked RAY_SIGHT / RAY_SHOT also stops
   * at every surface that blocks sight / shots (all of them unless SurfaceDesc says otherwise) and reports
   * `ground: true`, `collider: null`, `surface` — so a shot into the floor gets its impact point, and nothing
   * is seen or hit through a deck or a bare ramp. RAY_GROUND adds every surface regardless of its flags;
   * RAY_MOVE alone never hits a floor. Floors are two-sided, except that a ray starting within 2 cm beneath
   * one does not hit its underside.
   *
   * Allocates the hit (and its point / normal) unless `out` (ADDED) is passed: `out` is then filled and
   * returned on a hit and left untouched on a miss.
   */
  raycast(origin: Vec3Like, dir: Vec3Like, maxDist: number, mask?: number, out?: RayHit): RayHit | null;
  /**
   * Unobstructed sight line between two points (uses RAY_SIGHT; solids AND floors block). Solids that CONTAIN
   * either endpoint are ignored, so aiming at the centre of a device (or looking out of a scanner housing) is
   * not blocked by that device's own collider; so is a floor either endpoint rests on (within 5 cm), so
   * looking at someone's feet or a spot on the ground works. Consequently, test from an eye / chest point —
   * not from a muzzle that may poke into a wall the actor is hugging (use raycast for the shot itself: it
   * reports a start inside a solid as a hit). Allocation-free.
   */
  lineOfSight(a: Vec3Like, b: Vec3Like): boolean;
  /** Unobstructed firing line (uses RAY_SHOT). Same endpoint rules as lineOfSight. Allocation-free. */
  lineOfFire(a: Vec3Like, b: Vec3Like): boolean;
  /**
   * Push a sphere out of solids (camera collision). Returns the allowed fraction 0..1 along from→to.
   * Default mask = RAY_SIGHT | RAY_MOVE: everything a camera must stay out of — walls and cover, but also
   * glass, energy barriers and invisible blocking volumes (a 1.1 m rail only matters when the sphere dips below
   * its top). Pass RAY_SIGHT alone to collide with opaque geometry only. Unlike rays, a sweep meets
   * floors / ramps / decks ONLY when RAY_GROUND is added (a camera rig usually handles the floor itself).
   * The sphere stops 1 cm short of contact so consecutive sweeps never start inside. Box edges are treated
   * conservatively (the sphere may stop up to 0.4 × radius early at a sharp box corner; it never clips).
   *
   * A sweep that STARTS overlapping a shape is stopped by it (returns 0) only when the motion goes deeper
   * into it; moving out of it or along its face is free. So a pivot that ends up within the probe radius of
   * a rail, a kerb or a closing door does not pin the camera. Allocation-free.
   */
  sweepSphere(from: Vec3Like, to: Vec3Like, radius: number, mask?: number): number;
  /**
   * Colliders overlapping a circle (xz) within the y range, ordered by id. Allocates the array unless `out`
   * (ADDED) is passed, which is cleared, filled and returned.
   */
  queryColliders(x: number, z: number, radius: number, yMin: number, yMax: number, out?: ColliderHandle[]): ColliderHandle[];
  /** Cover colliders near a point, nearest first. Allocates the array unless `out` (ADDED) is passed. */
  coverNear(x: number, z: number, radius: number, out?: ColliderHandle[]): ColliderHandle[];
  /**
   * ADDED (physics-nav): a standing point (feet, y on the ground) tucked behind `cover` that is hidden from
   * `threat` — the threat's eye or muzzle position. Low cover hides a crouched body (tested at 0.9 m), high
   * cover a standing one (1.5 m). Tries the spot directly opposite the threat first, then fans out along the
   * far side; null when nothing behind this cover is both standable and protected. `radius` defaults to 0.4,
   * `height` (the body that must fit there) to 1.8.
   * Typical use: `for (const c of physics.coverNear(x, z, 12)) { const p = physics.coverPoint(c, enemyEye); … }`.
   */
  coverPoint(cover: ColliderHandle, threat: Vec3Like, radius?: number, height?: number): Vec3Like | null;

  readonly nav: NavGrid;

  /**
   * Evaluate triggers for the tracked point. Called by Game each tick with the player's feet position.
   * A null point (no live player) — or one with a non-finite coordinate — leaves every trigger state
   * untouched: dying inside a volume does not fire its exit callback. Callbacks may add/remove triggers or
   * clear the world; a throwing callback is logged and does not stop the others.
   */
  updateTriggers(point: Vec3Like | null): void;

  /** Remove everything (zone unload). */
  clear(): void;

  /**
   * Debug view of surfaces / colliders / triggers / nav as a THREE.Object3D. The same THREE.Group is returned
   * every call and refreshes itself whenever the world changes while it is visible in a scene (only the layer
   * that changed is rebuilt). Its children are named layers (THREE.Groups) that can be shown or hidden
   * individually:
   *   'surfaces'  floors tinted by height level (green at 0, toward blue going up, toward yellow going down;
   *               ramps shaded along their slope, with uphill chevrons)
   *   'solids'    red; cover blue (low light / high dark); sight-through orange; move-through violet;
   *               disabled grey. Structure under a walkable top (slabs, ramp fill) is drawn faintly.
   *   'nav'       the nav grid as merged strips, tinted by level, darker where nodes hug an obstacle or a ledge
   *   'triggers'  yellow (grey while disabled)
   *   'issues'    magenta pins at every `validate()` finding (re-scanned once the world has held still)
   * `group.userData` carries: `layer(name, visible)` toggles one layer; `refresh()` forces an update now;
   * `issues` is the list the 'issues' layer shows; `navNodes()` returns the nav node positions as x, y, z
   * triples (for overlays that colour the grid by a query).
   */
  debugObject(): unknown;
  readonly counts: { colliders: number; surfaces: number; triggers: number };

  /**
   * ADDED (physics-nav): bumped on every structural change (collider/surface added, removed, moved,
   * enabled/disabled or re-flagged). Cheap way to cache anything derived from the collision world.
   */
  readonly revision: number;

  /**
   * ADDED (physics-nav): authoring check — call it once after a zone is assembled (the debug view draws the
   * result). Returns the problems that make a level misbehave quietly; see PhysicsIssue. Costs a few
   * milliseconds; not for per-frame use.
   */
  validate(): PhysicsIssue[];
}

export interface NavPath {
  points: Vec3Like[];
  length: number;
}

export interface NavGrid {
  /**
   * (Re)build from current surfaces + colliders. Defaults: cell 0.5 m, agentRadius 0.45 m (options persist for
   * later calls). When only a few colliders/surfaces changed since the last build, only the cells they touch
   * are re-evaluated (≈ 1 ms for a door; a full 70 × 48 m build is ~15 ms warm, a few times that the first
   * time in a session); with no changes it is a no-op.
   *
   * Calling it is OPTIONAL: every query first brings a stale grid up to date itself (and the first query on an
   * unbuilt grid builds it), so nav never answers from out-of-date geometry — toggling `door.enabled`,
   * assigning `desc.blocksMove`, moving a collider or a surface is enough. Call rebuild() explicitly to take
   * the cost at a moment of your choosing: in `finalize()` after assembling a zone, so the full build lands on
   * the loading screen rather than on the first AI query.
   *
   * Note for animated solids: a collider moved with setPose EVERY frame makes every frame's first nav query
   * pay an incremental rebuild. For doors and barriers prefer toggling `enabled` when the motion finishes.
   */
  rebuild(opts?: { cell?: number; agentRadius?: number }): void;
  /**
   * Smoothed path, or null when unreachable. `points[0]` is `from` (its y corrected to the ground there). The
   * last point is `to` when the agent can stand exactly there; otherwise it is the nearest nav point to it
   * (so a goal inside cover, or closer to a wall than the agent radius, ends beside it — a 0.4 m body can
   * always complete the path). Endpoints up to 3 m off the grid are snapped to it. Every point except
   * `points[0]` (the caller's own position) keeps agentRadius clearance from solids and the ledge margin from
   * drops, every leg has been tested for the agent by the rules of moveCharacter, and the polyline follows
   * the ground within 0.3 m (waypoints are kept at ramp ends), so it can be drawn as a guide line as well as
   * followed. Routes prefer open ground over squeezing along walls when the detour is small.
   *
   * Following it: steer straight at each point in turn with moveCharacter. The agent radius (0.45 m) leaves a
   * 0.4 m body 5 cm of slack from solids; waypoints can sit exactly on the ledge margin and exactly at the
   * step-up limit beside a ramp, so a follower that cuts a corner there may report one `blocked` frame as it
   * slides — treat a single blocked frame as contact, not as "stuck".
   */
  findPath(from: Vec3Like, to: Vec3Like): NavPath | null;
  /**
   * Can the default agent stand at exactly this point: on the nav grid, clear of solids by agentRadius, with
   * headroom and the ledge margin? (A point 0.42 m from a wall is not walkable for the 0.45 m agent even
   * though a 0.4 m body fits there; use `nearest` to get the point to walk to.)
   */
  isWalkable(x: number, y: number, z: number): boolean;
  /** Nearest walkable nav point (default maxDist 4): the point itself when isWalkable, else a node centre. */
  nearest(x: number, y: number, z: number, maxDist?: number): Vec3Like | null;
  /** Deterministic pseudo-random reachable point within radius of centre (seeded by `seed`). */
  randomPoint(center: Vec3Like, radius: number, seed: number): Vec3Like | null;
  /**
   * Straight walk possible between two points without leaving nav / hitting solids? Conservative: true means
   * an agentRadius circle clears every solid along the line and the line never crosses a walkable edge, a
   * void wider than a crack, or a step higher than step-up. An endpoint that is not itself walkable is
   * replaced by the nearest nav point within 1 m.
   */
  walkable(a: Vec3Like, b: Vec3Like): boolean;
  readonly built: boolean;

  /**
   * ADDED (physics-nav): findPath for a BIG agent — wider than agentRadius and / or taller than 1.8 m (the
   * elite: radius 1.2, height 3.6). Only nav nodes where that body fits are used: its circle (plus the same
   * 5 cm of slack the default agent has) clear of every solid overlapping ITS height band (so a 3.6 m body is
   * never routed under a 3 m balcony), headroom under surfaces, and its own ledge margin; it does not cut
   * corners past a node it does not fit on. The fit is tested exactly per node on first use and remembered
   * until that part of the grid is rebuilt.
   *
   * Endpoints snap to the nearest node that fits, in the same connected area (never one behind a wall). When
   * the goal is somewhere the body cannot go — under that balcony, down a corridor narrower than itself — the
   * path ends at the nearest place it CAN reach on the goal's own level (beside the balcony, not on top of
   * it; of two equally near spots, the one with the shorter walk). That fallback searches the body's whole
   * reachable area (≈ 1–2 ms in a 70 × 48 m zone): fine per repath, not per frame. null when the goal is
   * somewhere no agent could walk to from here (a sealed room).
   *
   * Always pass the same radius / height you give moveCharacter for that actor. On the 0.5 m grid a body
   * needs passages at least 2 · radius + 0.6 m wide to be routed through them (3 m for the elite).
   */
  findPathFor(from: Vec3Like, to: Vec3Like, radius: number, height?: number): NavPath | null;
  /** ADDED (physics-nav): walkable() for a big agent of the given radius (and height, default 1.8). */
  walkableFor(a: Vec3Like, b: Vec3Like, radius: number, height?: number): boolean;
  /**
   * ADDED (physics-nav): free radius at a nav point — distance (m, capped at 3) to the nearest
   * movement-blocking solid overlapping a body of `height` (default 1.8) standing there; 0 when the point is
   * off the nav grid. Use it to pick open ground (spawn points, retreat spots, where a large creature can
   * turn).
   */
  clearance(x: number, y: number, z: number, height?: number): number;

  /**
   * ADDED (physics-nav): true when colliders/surfaces changed since the last build. Informational — the next
   * query (or rebuild()) refreshes the grid.
   */
  readonly stale: boolean;
  /** ADDED (physics-nav): number of nav nodes in the current build (0 before the first build). */
  readonly nodeCount: number;
  /** ADDED (physics-nav): cell size of the current build in metres. */
  readonly cellSize: number;
  /**
   * ADDED (physics-nav): machine-independent effort counters, for perf HUDs and tests: number of builds that
   * did work, whether the last one was a full build and how many cells it evaluated, and how many nodes the
   * last path search expanded.
   */
  readonly stats: { builds: number; lastBuildFull: boolean; lastBuildCells: number; lastSearchExpanded: number };
}
