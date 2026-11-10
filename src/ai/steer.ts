/**
 * Ground movement for brains and companions: path following over the nav grid (searches rate-limited to 2 Hz
 * per actor), steering with separation from nearby bodies, arrival and stuck detection. Writes `desiredVel`
 * and turns the actor; the ActorManager integrates through physics, so a body never leaves the walkable world.
 */
import type { Actor, Game, Vec3Like } from '@/core/api';
import { forwardX, forwardZ } from '@/core/mathx';
import { AI } from './tune';
import { fin, nowOf, physicsOf } from './util';

export interface MoveOpts {
  /** rad/s; default 8 */
  turn?: number;
  /** stop this far from the goal (default 0.35) */
  stop?: number;
  /** face this point while moving instead of the direction of travel (strafing, shield walls) */
  faceTo?: Vec3Like | null;
  /** big agents (the elite) path with their own radius / height */
  big?: boolean;
  /** steer round nearby bodies of the same side (default true) */
  separate?: boolean;
}

const _goal = { x: 0, y: 0, z: 0 };

export class NavFollower {
  private path: Vec3Like[] | null = null;
  private idx = 0;
  private goalX = NaN;
  private goalZ = NaN;
  private nextSearch = 0;
  private direct = false;
  /** seconds spent trying to move without getting anywhere */
  stuck = 0;
  private lastX = NaN;
  private lastZ = NaN;
  /** true when the last moveTo() call ended inside the stop distance */
  arrived = false;
  /** false when the last search found no route (the follower then steers straight) */
  reachable = true;

  constructor(private readonly game: Game) {}

  reset(): void {
    this.path = null;
    this.goalX = this.goalZ = NaN;
    this.stuck = 0;
    this.lastX = this.lastZ = NaN;
    this.arrived = false;
    this.nextSearch = 0;
  }

  /**
   * Steer `a` toward `goal` at `speed` this tick. Returns true when it has arrived (and then writes no
   * velocity). Call it every tick while the actor should be travelling.
   */
  moveTo(a: Actor, goal: Vec3Like, speed: number, dt: number, opts?: MoveOpts): boolean {
    const stop = opts?.stop ?? 0.35;
    const gx = fin(goal.x, a.pos.x);
    const gz = fin(goal.z, a.pos.z);
    const dist = Math.hypot(gx - a.pos.x, gz - a.pos.z);
    if (dist <= stop) {
      this.arrived = true;
      this.stuck = 0;
      this.lastX = a.pos.x;
      this.lastZ = a.pos.z;
      if (opts?.faceTo) a.face(opts.faceTo, (opts.turn ?? 8) * dt);
      return true;
    }
    this.arrived = false;
    this.plan(a, gx, fin(goal.y, a.pos.y), gz, opts?.big === true);

    // current waypoint
    let tx = gx;
    let tz = gz;
    const path = this.path;
    if (path && !this.direct) {
      while (this.idx < path.length - 1) {
        const w = path[this.idx] as Vec3Like;
        if (Math.hypot(w.x - a.pos.x, w.z - a.pos.z) > Math.max(0.45, a.radius * 0.8)) break;
        this.idx++;
      }
      const w = path[Math.min(this.idx, path.length - 1)] as Vec3Like;
      tx = w.x;
      tz = w.z;
      // the last waypoint may be a snapped stand-in for the goal: close enough to it counts as arrival
      if (this.idx >= path.length - 1 && Math.hypot(tx - a.pos.x, tz - a.pos.z) <= Math.max(stop, 0.3)) {
        if (Math.hypot(tx - gx, tz - gz) > stop) {
          this.arrived = true;
          return true;
        }
        tx = gx;
        tz = gz;
      }
    }

    let dx = tx - a.pos.x;
    let dz = tz - a.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return false;
    dx /= l;
    dz /= l;

    if (opts?.separate !== false) {
      // steer round bodies standing in the way (the manager's soft push handles actual overlap)
      const near = this.game.actors.inRadius(a.pos, a.radius + 1.3, (o) => o !== a && !o.flying && o.alive);
      let sx = 0;
      let sz = 0;
      for (let i = 0; i < near.length; i++) {
        const o = near[i] as Actor;
        const ox = a.pos.x - o.pos.x;
        const oz = a.pos.z - o.pos.z;
        const od = Math.hypot(ox, oz);
        if (od < 1e-3) continue;
        const ahead = -(ox * dx + oz * dz) / od;
        if (ahead < 0.2) continue;
        const w = Math.max(0, 1 - (od - a.radius - o.radius) / 1.3) * ahead;
        // slide past on the side we are already on
        const side = ox * -dz + oz * dx >= 0 ? 1 : -1;
        sx += -dz * side * w;
        sz += dx * side * w;
      }
      const sl = Math.hypot(sx, sz);
      if (sl > 1e-3) {
        const k = Math.min(0.85, sl) / sl;
        dx += sx * k;
        dz += sz * k;
        const n = Math.hypot(dx, dz) || 1;
        dx /= n;
        dz /= n;
      }
    }

    // ease in over the last half metre so bodies do not jitter on their goal
    const v = Math.min(speed, Math.max(0.6, (dist - stop) * 6));
    a.desiredVel.x = dx * v;
    a.desiredVel.z = dz * v;
    const turn = (opts?.turn ?? 8) * dt;
    if (opts?.faceTo) a.face(opts.faceTo, turn);
    else {
      _goal.x = a.pos.x + dx;
      _goal.y = a.pos.y;
      _goal.z = a.pos.z + dz;
      a.face(_goal, turn);
    }

    // stuck: asked to move, went (almost) nowhere
    if (Number.isFinite(this.lastX) && dt > 1e-6) {
      const moved = Math.hypot(a.pos.x - this.lastX, a.pos.z - this.lastZ);
      if (moved < v * dt * 0.25) {
        this.stuck += dt;
        // a second of pushing against something: look for another way round at the next allowed search
        if (this.stuck > 1) this.goalX = NaN;
      } else this.stuck = Math.max(0, this.stuck - dt * 2);
    }
    this.lastX = a.pos.x;
    this.lastZ = a.pos.z;
    return false;
  }

  /** stand still this tick (keeps the stuck timer honest) */
  halt(a: Actor): void {
    this.stuck = 0;
    this.lastX = a.pos.x;
    this.lastZ = a.pos.z;
  }

  private plan(a: Actor, gx: number, gy: number, gz: number, big: boolean): void {
    const now = nowOf(this.game);
    const moved = !Number.isFinite(this.goalX) || Math.hypot(gx - this.goalX, gz - this.goalZ) > 1.2;
    if (!moved && this.path) return;
    if (now < this.nextSearch && (this.path || this.direct)) return;
    // spread searches over time: actors spawned together do not all search on the same tick
    this.nextSearch = now + AI.repath + ((a.id * 0.137) % 0.2);
    this.goalX = gx;
    this.goalZ = gz;
    this.idx = 0;
    this.direct = true;
    this.path = null;
    this.reachable = true;
    const physics = physicsOf(this.game);
    if (!physics) return;
    const nav = physics.nav;
    _goal.x = gx;
    _goal.y = gy;
    _goal.z = gz;
    try {
      if (big ? nav.walkableFor(a.pos, _goal, a.radius, a.height) : nav.walkable(a.pos, _goal)) return;
      const p = big ? nav.findPathFor(a.pos, _goal, a.radius, a.height) : nav.findPath(a.pos, _goal);
      if (p && Array.isArray(p.points) && p.points.length > 1) {
        this.path = p.points;
        this.idx = 1;
        this.direct = false;
      } else {
        this.reachable = false;
      }
    } catch {
      this.reachable = false;
    }
  }
}

/** a walkable point near `p` (nav-snapped), or `p` itself when there is no nav to ask */
export function snapToNav(game: Game, p: Vec3Like, maxDist = 4, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
  out.x = fin(p.x);
  out.y = fin(p.y);
  out.z = fin(p.z);
  const physics = physicsOf(game);
  if (!physics) return out;
  try {
    const n = physics.nav.nearest(out.x, out.y, out.z, maxDist);
    if (n && Number.isFinite(n.x + n.y + n.z)) {
      out.x = n.x;
      out.y = n.y;
      out.z = n.z;
    }
  } catch {
    /* keep the raw point */
  }
  return out;
}

/** point `dist` metres ahead of an actor */
export function ahead(a: Actor, dist: number, out: Vec3Like): Vec3Like {
  out.x = a.pos.x + forwardX(a.yaw) * dist;
  out.y = a.pos.y;
  out.z = a.pos.z + forwardZ(a.yaw) * dist;
  return out;
}
