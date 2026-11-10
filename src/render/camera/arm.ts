/**
 * Spring arm: resolves where the follow camera can actually sit. Given the pivot (the hero's head), the wanted
 * shoulder offset, arm direction and length, it sweeps the world and returns a position that is never inside
 * geometry — pulling in instantly when something lands on the arm, easing in ahead of obstacles, looking OVER
 * the hero when a wall leaves no room behind, keeping the head in sight, and easing back out slowly.
 *
 * Pure logic: world queries come in through FollowWorld (null members = no collision).
 */
import * as THREE from 'three';
import type { Vec3Like } from '@/core/api';
import { clamp, clamp01, damp, smoothstep } from '@/core/mathx';

/** World queries the follow camera needs; every member is optional (stub physics = no collision). */
export interface FollowWorld {
  /** allowed fraction 0..1 of the sphere sweep from→to, or null when unavailable */
  sweep: ((from: Vec3Like, to: Vec3Like, radius: number) => number | null) | null;
  /** floor height under (x,z) at or below yRef, or null */
  ground: ((x: number, z: number, yRef: number) => number | null) | null;
}

export const ARM = {
  /** collision probe radius (the near plane's corners sit 0.13 m from the eye; this keeps them out of walls) */
  probe: 0.25,
  /** the camera never sits lower than this above the feet / the floor under it */
  floorClearance: 0.32,
  minDistance: 0.3,
  /**
   * Anticipation whiskers: two thinner probes fanned to either side of the arm. When one finds an obstacle
   * the arm eases most of the way in (`whiskerPull`) before the obstacle reaches the arm itself, so ribs,
   * corners and cover produce a short settle instead of a full-length pop.
   */
  whiskerAngle: 0.38,
  whiskerPull: 0.65,
  /**
   * Look-over: when a wall leaves less than `overFar` metres behind the hero (fully at `overNear`), the anchor
   * rises so the camera looks over the head instead of sitting beside it with the hero out of frame.
   */
  overNear: 0.6,
  overFar: 1.45,
  /** line-of-sight probe radius (camera → the hero's true head) */
  sight: 0.12,
  /** seconds ahead the arm looks along the hero's velocity */
  lead: 0.22,
} as const;

/** soft minimum: tends to min(a,b) but with a rounded corner */
const softMin = (a: number, b: number): number => (a * b) / Math.pow(Math.pow(a, 6) + Math.pow(b, 6), 1 / 6);

/** What the follow camera asks of the arm this frame. */
export interface ArmRequest {
  /** the (lagged) point the camera orbits: the hero's head */
  pivot: THREE.Vector3;
  /** the hero's true head this frame (line of sight is kept to this, not to the lagged pivot) */
  head: THREE.Vector3;
  /** floor level under the hero */
  floorY: number;
  /** view yaw (the shoulder offset is perpendicular to it) */
  yaw: number;
  /** unit direction of the arm: the camera sits at anchor − dir · length */
  dir: THREE.Vector3;
  /** wanted arm length (m) */
  dist: number;
  /** signed lateral shoulder offset (m, + = right of the view) */
  shoulder: number;
  /** authored vertical offset of the anchor above the pivot (framing height + aim rise) */
  lift: number;
  /** extra anchor height when fully squeezed against a wall (look-over) */
  overRise: number;
  /** the hero's horizontal velocity (m/s): where the anchor is about to be */
  velX: number;
  velZ: number;
}

export class SpringArm {
  /** resolved camera position */
  readonly cam = new THREE.Vector3();
  /** arm length in use (≤ the swept limit) */
  length = 3.4;
  /** wanted length after the floor limit — `length / reach` is how much collision took */
  reach = 3.4;
  /** 0..1: how completely a wall behind the hero has closed the arm (drives the look-over rise) */
  squeeze = 0;
  /** 0..1: an anticipation whisker is touching something — scripted orbit moves should slow down */
  crowded = 0;
  /** horizontal distance from the camera back to the anchor line (how close the hero is in frame) */
  backRoom = 3.4;

  private sideLimit = 1;
  private floorLift = 0;
  private slammed = false;

  private readonly base = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  /** Forget smoothing (teleport / snapBehind): the next solve seats everything in one go. */
  reset(): void {
    this.sideLimit = 1;
    this.squeeze = 0;
    this.crowded = 0;
    this.floorLift = 0;
    this.slammed = false;
  }

  /**
   * Resolve this frame's camera position into `cam`. `fresh` seats every smoother immediately (and iterates
   * the look-over so a snap against a wall lands in its final pose).
   */
  solve(dt: number, fresh: boolean, world: FollowWorld, req: ArmRequest): void {
    const passes = fresh && world.sweep ? 3 : 1;
    for (let i = 0; i < passes; i++) this.pass(dt, fresh, world, req);
    // Something cut the arm to (almost) nothing this very frame: the look-over rise it calls for is taken in
    // the same frame, or the camera would sit in the hero's head while the rise eased in.
    if (this.slammed && !fresh) this.pass(dt, false, world, req);

    // floor under the camera (ramps, steps): lift instantly, settle back slowly
    const cam = this.cam;
    let need = 0;
    if (world.ground) {
      const g = world.ground(cam.x, cam.z, req.pivot.y);
      if (g !== null) need = Math.max(0, g + ARM.floorClearance - cam.y);
    }
    this.floorLift = fresh || need > this.floorLift ? need : damp(this.floorLift, need, 6, dt);
    if (this.floorLift < 1e-4) this.floorLift = 0;
    cam.y += this.floorLift;
  }

  private pass(dt: number, fresh: boolean, world: FollowWorld, req: ArmRequest): void {
    const { pivot, dir } = req;
    const sweep = world.sweep;
    const base = this.base;
    const anchor = this.anchor;
    const cam = this.cam;
    const rx = Math.cos(req.yaw);
    const rz = -Math.sin(req.yaw);
    this.slammed = false;

    // --- anchor height: authored lift, then the look-over rise; each only as far as the ceiling allows ----
    const lowY = this.raise(sweep, pivot, pivot.y, req.lift);
    base.set(pivot.x, lowY, pivot.z);
    const over = req.overRise * this.squeeze;
    if (over > 0.01) base.y = this.raise(sweep, base, lowY, over);

    // The arm dips toward the floor when looking up: shorten it smoothly instead of colliding with the ground.
    let dist = req.dist;
    const room = Math.max(0.2, base.y - (req.floorY + ARM.floorClearance));
    if (dir.y > 0.02) dist = softMin(dist, room / dir.y);
    dist = Math.max(ARM.minDistance, dist);
    this.reach = dist;
    const cp = Math.sqrt(Math.max(0, 1 - dir.y * dir.y));

    if (!sweep) {
      this.sideLimit = 1;
      this.squeeze = this.crowded = 0;
      this.length = dist;
      this.backRoom = dist * cp;
      cam.set(base.x + rx * req.shoulder - dir.x * dist, base.y - dir.y * dist, base.z + rz * req.shoulder - dir.z * dist);
      return;
    }

    // --- 1) shoulder offset: slide the anchor sideways only as far as the world allows -------------------
    let open = 1;
    let embedded = false;
    if (Math.abs(req.shoulder) > 0.01) {
      anchor.set(base.x + rx * req.shoulder, base.y, base.z + rz * req.shoulder);
      const k = sweep(base, anchor, ARM.probe);
      if (k !== null) {
        open = clamp01(k);
        if (open < 1e-3 && this.inside(sweep, base)) embedded = true;
      }
    }
    if (!embedded) {
      this.sideLimit = fresh || open < this.sideLimit ? open : Math.min(open, this.sideLimit + (open - this.sideLimit) * (1 - Math.exp(-5 * dt)) + 0.2 * dt);
    }
    const s = req.shoulder * this.sideLimit;
    anchor.set(base.x + rx * s, base.y, base.z + rz * s);

    // --- 2) the arm itself: the swept limit applies instantly (never clip through cover) ------------------
    cam.set(anchor.x - dir.x * dist, anchor.y - dir.y * dist, anchor.z - dir.z * dist);
    const k = embedded ? null : sweep(anchor, cam, ARM.probe);
    const hard = k !== null && k < 1 ? dist * clamp01(k) : dist;
    if (!embedded && hard < 1e-3 && this.inside(sweep, anchor)) embedded = true;
    if (embedded) {
      // The hero is INSIDE a solid (a door closed on them, a large body moved over them, a sight-blocking
      // volume). Sweeps from here all report 0 — collapsing into the head would be the worst answer, so the
      // arm simply holds its length until the overlap ends.
      this.length = Math.min(this.length, dist);
      this.backRoom = this.length * cp;
      this.crowded = 0;
      cam.set(anchor.x - dir.x * this.length, anchor.y - dir.y * this.length, anchor.z - dir.z * this.length);
      return;
    }

    // --- look-over amount, from the room behind the hero at head height (never from the risen arm, so
    //     rising over a crate cannot make the squeeze flip-flop) --------------------------------------
    let free = hard;
    if (over > 0.01) {
      this.tmp.set(anchor.x, lowY, anchor.z);
      this.tmp2.set(this.tmp.x - dir.x * dist, lowY - dir.y * dist, this.tmp.z - dir.z * dist);
      const k0 = sweep(this.tmp, this.tmp2, ARM.probe);
      if (k0 !== null) free = k0 < 1 ? dist * clamp01(k0) : dist;
    }
    const squeeze = (1 - smoothstep(ARM.overNear, ARM.overFar, free * cp)) * smoothstep(0.05, 0.3, 1 - free / dist);
    // (with under half a metre left the rise is immediate — see `solve`; otherwise it eases in and out)
    const floor = squeeze * (1 - smoothstep(0.35, 0.9, free * cp));
    this.slammed = floor > this.squeeze + 0.25;
    if (fresh || this.slammed) this.squeeze = fresh ? squeeze : floor;
    else this.squeeze = damp(this.squeeze, squeeze, squeeze > this.squeeze ? 10 : 2.5, dt);

    // --- 3) anticipation whiskers ease the arm in ahead of obstacles about to cross it --------------------
    let want = hard;
    let crowded = 0;
    const armYaw = Math.atan2(-dir.x, -dir.z);
    for (let side = -1; side <= 1; side += 2) {
      const wy = armYaw + side * ARM.whiskerAngle;
      this.tmp.set(anchor.x + Math.sin(wy) * cp * dist, anchor.y - dir.y * dist, anchor.z + Math.cos(wy) * cp * dist);
      const w = sweep(anchor, this.tmp, ARM.probe * 0.6);
      if (w === null || w >= 1) continue;
      const hit = dist * clamp01(w);
      if (hit < hard) {
        want = Math.min(want, hard + (hit - hard) * ARM.whiskerPull);
        crowded = 1;
      }
    }
    this.crowded = fresh ? crowded : damp(this.crowded, crowded, crowded > this.crowded ? 20 : 4, dt);
    // …and a third whisker in TIME: the same arm from where the hero will be in a fifth of a second. Running
    // along a ribbed wall, the next rib is about to pass between hero and camera — start closing now, so the
    // inevitable cut is a short step instead of a full-length leap.
    const speed = Math.hypot(req.velX, req.velZ);
    if (speed > 2 && !fresh) {
      const lead = Math.min(ARM.lead, 1.6 / speed);
      this.tmp.set(anchor.x + req.velX * lead, anchor.y, anchor.z + req.velZ * lead);
      this.tmp2.set(this.tmp.x - dir.x * dist, this.tmp.y - dir.y * dist, this.tmp.z - dir.z * dist);
      const w = sweep(this.tmp, this.tmp2, ARM.probe * 0.6);
      // (≈0 = the hero is running AT something and the future anchor is inside it: that is not a crossing)
      if (w !== null && w < 1 && w > 0.02) {
        const hit = dist * w;
        if (hit < hard) want = Math.min(want, hard + (hit - hard) * ARM.whiskerPull);
      }
    }

    // --- 4) keep the hero's head in sight: a thin post between camera and hero shortens the arm quickly,
    //        but as an eased move (the camera itself is in free space, so nothing is clipping) ------------
    let rate = 7;
    const at = fresh ? want : Math.min(want, this.length);
    if (at > 0.7 && !this.sees(sweep, req.head, anchor, dir, at)) {
      let ok = at * 0.3;
      if (this.sees(sweep, req.head, anchor, dir, at * 0.75)) ok = at * 0.75;
      else if (this.sees(sweep, req.head, anchor, dir, at * 0.5)) ok = at * 0.5;
      want = Math.min(want, ok);
      rate = 16;
    }

    // --- one smoothed length: quick to settle in, slow to ease back out, cut short by the hard limit ------
    let len = this.length;
    if (fresh) len = want;
    else if (want < len) len = damp(len, want, rate, dt);
    else len = Math.min(want, len + clamp((want - len) * 3.2, 0.7, 5) * dt);
    if (len > hard) len = hard;
    this.length = len;
    this.backRoom = len * cp;
    cam.set(anchor.x - dir.x * len, anchor.y - dir.y * len, anchor.z - dir.z * len);
  }

  /** `from.y` raised by `by` metres (may be negative), stopped by whatever is in the way; returns the new y */
  private raise(sweep: FollowWorld['sweep'], from: THREE.Vector3, y: number, by: number): number {
    if (Math.abs(by) <= 0.01) return y + by;
    if (!sweep) return y + by;
    this.tmp.set(from.x, y, from.z);
    this.tmp2.set(from.x, y + by, from.z);
    const k = sweep(this.tmp, this.tmp2, ARM.probe);
    if (k === null || k >= 1) return y + by;
    if (k < 1e-3 && this.inside(sweep, this.tmp)) return y + by; // embedded: collision is meaningless here
    return y + by * clamp01(k);
  }

  /** true when a probe at `p` already overlaps a solid (a sweep from it reports 0 in opposite directions) */
  private inside(sweep: NonNullable<FollowWorld['sweep']>, p: THREE.Vector3): boolean {
    const a = this.tmp2;
    a.set(p.x, p.y + 0.05, p.z);
    const up = sweep(p, a, ARM.probe);
    if (up === null || up > 1e-3) return false;
    a.set(p.x, p.y - 0.05, p.z);
    const down = sweep(p, a, ARM.probe);
    return down !== null && down <= 1e-3;
  }

  /** unobstructed line from the hero's head to the camera at arm length `len`? */
  private sees(sweep: NonNullable<FollowWorld['sweep']>, head: THREE.Vector3, anchor: THREE.Vector3, dir: THREE.Vector3, len: number): boolean {
    const p = this.tmp.set(anchor.x - dir.x * len, anchor.y - dir.y * len, anchor.z - dir.z * len);
    const v = sweep(head, p, ARM.sight);
    // (≈0 means the probe started inside something: that says nothing about the line, so it counts as clear)
    return v === null || v >= 0.985 || v <= 1e-3;
  }
}
