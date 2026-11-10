/**
 * Third-person over-the-shoulder follow camera: orbit, aim framing, soft lock-on, spring-arm collision,
 * position lag, sprint FOV and gentle auto-recentre. Pure logic — world queries come in through FollowWorld.
 *
 * Conventions: yaw 0 looks toward −Z (same as actors); positive pitch looks UP.
 */
import * as THREE from 'three';
import type { CameraFollowTarget, FollowFraming, Vec3Like } from '@/core/api';
import { DEG, angleDelta, clamp, clamp01, damp, dampAngle, smoothstep, wrapAngle } from '@/core/mathx';
import { Damped, Pose, isFiniteVec, quatFromYawPitch, viewDir } from './pose';

/** Follow-camera tuning (BRIEF §5 numbers). */
export const FOLLOW = {
  distance: 3.4,
  /** fallback pivot height when the target does not supply one */
  height: 1.55,
  shoulder: 0.55,
  fov: 62,
  aimDistance: 1.6,
  aimShoulder: 0.72,
  aimFov: 48,
  /** extra pivot height while aiming so the reticle clears the shoulder */
  aimRise: 0.12,
  /** extra height when the arm is squeezed short, to look over the shoulder rather than into a back */
  squeezeRise: 0.38,
  sprintFov: 4,
  pitchMin: -55 * DEG,
  pitchMax: 70 * DEG,
  /** resting pitch used by snapBehind and auto-recentre */
  pitchRest: -9 * DEG,
  /** collision probe radius */
  probe: 0.25,
  /** the camera never sits lower than this above the feet / the floor under it */
  floorClearance: 0.32,
  minDistance: 0.3,
  lockDistance: 0.45,
  /**
   * Anticipation whiskers: two thinner probes fanned to either side of the arm. When one finds an obstacle
   * the arm eases most of the way in (`whiskerPull`) before the obstacle reaches the arm itself, so ribs,
   * corners and cover produce a short settle instead of a full-length pop.
   */
  whiskerAngle: 0.38,
  whiskerPull: 0.65,
  /**
   * Looking up: the camera body stops sinking behind the player once the view passes `orbitKnee` and
   * settles toward `orbitMax`, while the view keeps tilting. The figure slides to the bottom of the frame
   * instead of filling it from below, leaving the architecture overhead unobstructed.
   */
  orbitKnee: 8 * DEG,
  orbitMax: 21 * DEG,
} as const;

/** Elevation of the camera arm for a given view pitch (identical when level or looking down). */
export function orbitPitchFor(pitch: number): number {
  if (pitch <= FOLLOW.orbitKnee) return pitch;
  const span = FOLLOW.orbitMax - FOLLOW.orbitKnee;
  return FOLLOW.orbitKnee + span * (1 - Math.exp(-(pitch - FOLLOW.orbitKnee) / span));
}

/** World queries the follow camera needs; every member is optional (stub physics = no collision). */
export interface FollowWorld {
  /** allowed fraction 0..1 of the sphere sweep from→to, or null when unavailable */
  sweep: ((from: Vec3Like, to: Vec3Like, radius: number) => number | null) | null;
  /** floor height under (x,z) at or below yRef, or null */
  ground: ((x: number, z: number, yRef: number) => number | null) | null;
}

export interface FollowInput {
  /** look delta this frame (radians): x = yaw, y = pitch (up positive) */
  lookX: number;
  lookY: number;
  /** true when the player can only look by dragging / keys: recentre sooner and more firmly */
  assisted: boolean;
}

/** soft minimum: tends to min(a,b) but with a rounded corner */
const softMin = (a: number, b: number): number => (a * b) / Math.pow(Math.pow(a, 6) + Math.pow(b, 6), 1 / 6);

const NUDGE_YAW = 0.6;
const NUDGE_PITCH = 0.35;
const TELEPORT = 5;

export class FollowCamera {
  /** view yaw / pitch in radians (public orbit angles) */
  yaw = 0;
  pitch: number = FOLLOW.pitchRest;
  /** resolved pose for this frame */
  readonly out = new Pose();
  /** camera → pivot distance after collision */
  distance: number = FOLLOW.distance;
  aim = false;
  side: 1 | -1 = 1;

  private target: CameraFollowTarget | null = null;
  private lockFn: (() => Vec3Like) | null = null;
  private lockWarned = false;
  private fresh = true;

  private readonly px = new Damped();
  private readonly py = new Damped();
  private readonly pz = new Damped();
  private readonly last = new THREE.Vector3();
  private velX = 0;
  private velZ = 0;
  private speed = 0;

  private readonly aimBlend = new Damped(0);
  private readonly sideBlend = new Damped(1);
  private readonly lockBlend = new Damped(0);
  private sprintBlend = 0;
  /** smoothed arm length (≤ the swept limit) */
  private armSmooth: number = FOLLOW.distance;
  private sideLimit = 1;
  private squeeze = 0;
  private lift = 0;
  private idle = 0;
  private nudgeYaw = 0;
  private nudgePitch = 0;
  private nudgeIdle = 0;
  private lockYaw = 0;

  private readonly fDistance = new Damped(FOLLOW.distance);
  private readonly fShoulder = new Damped(FOLLOW.shoulder);
  private readonly fFov = new Damped(FOLLOW.fov);
  private readonly fHeight = new Damped(0);
  private framing: FollowFraming | null = null;
  private framingTime = 0.35;

  private readonly guide = new THREE.Vector3();
  private guideLeft = 0;
  private guideRate = 0;
  private bearingYaw = 0;
  private bearingPitch = 0;

  private readonly pivot = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly cam = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly raw = new THREE.Vector3();

  constructor() {
    this.out.pos.set(0, 1.9, 4);
    quatFromYawPitch(this.out.quat, 0, FOLLOW.pitchRest);
    this.out.fov = FOLLOW.fov;
  }

  get hasTarget(): boolean {
    return this.target !== null;
  }

  get targetRef(): CameraFollowTarget | null {
    return this.target;
  }

  setTarget(t: CameraFollowTarget | null): void {
    this.target = t && isFiniteVec(t.pos) ? t : null;
    this.fresh = true;
  }

  setLockOn(fn: (() => Vec3Like) | null): void {
    this.lockFn = typeof fn === 'function' ? fn : null;
    this.lockWarned = false;
    this.nudgeYaw = this.nudgePitch = 0;
  }

  setFraming(f: FollowFraming | null, blendSeconds: number): void {
    // Copy and sanitise: a bad number here would otherwise poison every smoother.
    const pick = (v: number | undefined, lo: number, hi: number): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : undefined;
    this.framing = f
      ? { distance: pick(f.distance, 0.6, 40), shoulder: pick(f.shoulder, 0, 3), fov: pick(f.fov, 20, 110), heightOffset: pick(f.heightOffset, -1.5, 6) }
      : null;
    this.framingTime = Math.max(0.01, (Number.isFinite(blendSeconds) ? blendSeconds : 1) * 0.35);
  }

  /** Re-seat every smoother on the current target (teleports, snapBehind). */
  snap(): void {
    this.fresh = true;
  }

  /**
   * Point the orbit at a world point from the current pivot: instantly, or as a guided turn of roughly
   * `seconds` that the player can cancel by looking.
   */
  aimAt(p: Vec3Like, seconds = 0): void {
    const t = this.target;
    if (!t || !isFiniteVec(p)) return;
    this.guide.set(p.x, p.y, p.z);
    if (Number.isFinite(seconds) && seconds > 0) {
      this.guideRate = 3.2 / seconds;
      this.guideLeft = seconds * 2.5;
      return;
    }
    this.guideLeft = 0;
    this.bearingTo(this.guide, t);
    this.yaw = this.bearingYaw;
    this.pitch = this.bearingPitch;
    this.idle = 0;
  }

  /** yaw / pitch from the target's pivot to a point → bearingYaw / bearingPitch */
  private bearingTo(p: Vec3Like, t: CameraFollowTarget): void {
    const dx = p.x - t.pos.x;
    const dz = p.z - t.pos.z;
    const hd = Math.hypot(dx, dz);
    this.bearingYaw = hd > 1e-4 ? Math.atan2(-dx, -dz) : this.yaw;
    this.bearingPitch = clamp(Math.atan2(p.y - (t.pos.y + this.heightOf(t)), Math.max(hd, 1e-4)), FOLLOW.pitchMin, FOLLOW.pitchMax);
  }

  update(dt: number, input: FollowInput, world: FollowWorld): void {
    const t = this.target;
    if (!t || !isFiniteVec(t.pos)) return;
    const h = this.heightOf(t);
    const tp = t.pos;

    // --- target motion, teleport detection -------------------------------------------------------
    if (!this.fresh && this.last.distanceToSquared(tp) > TELEPORT * TELEPORT) this.fresh = true;
    if (this.fresh) {
      this.px.snap(tp.x);
      this.py.snap(tp.y);
      this.pz.snap(tp.z);
      this.velX = this.velZ = this.speed = 0;
      this.sideLimit = 1;
      this.squeeze = 0;
      this.lift = 0;
      this.aimBlend.snap(this.aim ? 1 : 0);
      this.sideBlend.snap(this.side);
      this.lockBlend.snap(this.lockFn ? 1 : 0);
      this.snapFraming();
    } else if (dt > 0) {
      const ivx = (tp.x - this.last.x) / dt;
      const ivz = (tp.z - this.last.z) / dt;
      this.velX = damp(this.velX, ivx, 10, dt);
      this.velZ = damp(this.velZ, ivz, 10, dt);
      this.speed = Math.hypot(this.velX, this.velZ);
    }
    this.last.copy(tp);

    // --- look input ------------------------------------------------------------------------------
    const aimK = this.aimBlend.step(this.aim ? 1 : 0, 0.11, dt);
    const lookScale = 1 - 0.32 * aimK;
    const lx = input.lookX * lookScale;
    const ly = input.lookY * lookScale;
    const looking = Math.abs(lx) + Math.abs(ly) > 1e-6;
    this.idle = looking ? 0 : this.idle + dt;

    const lockPoint = this.aim ? null : this.readLock();
    const lockK = this.lockBlend.step(lockPoint ? 1 : 0, 0.16, dt);
    const sideK = this.sideBlend.step(this.side, 0.14, dt);

    // --- framing parameters ----------------------------------------------------------------------
    const f = this.framing;
    const ft = this.framingTime;
    const baseDist = this.fDistance.step(f?.distance ?? FOLLOW.distance, ft, dt);
    const baseShoulder = this.fShoulder.step(f?.shoulder ?? FOLLOW.shoulder, ft, dt);
    const baseFov = this.fFov.step(f?.fov ?? FOLLOW.fov, ft, dt);
    const heightOffset = this.fHeight.step(f?.heightOffset ?? 0, ft, dt);
    let dist = baseDist + (FOLLOW.aimDistance - baseDist) * aimK + FOLLOW.lockDistance * lockK * (1 - aimK);
    const shoulder = (baseShoulder + (FOLLOW.aimShoulder - baseShoulder) * aimK) * sideK;

    // --- smoothed pivot (critically damped lag; vertical is softer to swallow steps) --------------
    let sx = this.px.step(tp.x, 0.07, dt);
    const sy = this.py.step(tp.y, 0.16, dt);
    let sz = this.pz.step(tp.z, 0.07, dt);
    const lagX = sx - tp.x;
    const lagZ = sz - tp.z;
    const lag = Math.hypot(lagX, lagZ);
    if (lag > 1) {
      sx = tp.x + (lagX / lag) * 1;
      sz = tp.z + (lagZ / lag) * 1;
      this.px.value = sx;
      this.pz.value = sz;
    }
    const pivotY = sy + h + heightOffset + FOLLOW.aimRise * aimK;
    const pivot = this.pivot.set(sx, pivotY, sz);
    if (world.sweep && lag > 0.05) {
      // The lagged pivot may cut a corner the player went around: keep it reachable from the real one.
      const k = world.sweep(this.raw.set(tp.x, tp.y + h, tp.z), pivot, FOLLOW.probe);
      if (k !== null && k < 1) {
        pivot.lerpVectors(this.raw, pivot, k);
        this.px.value = pivot.x;
        this.pz.value = pivot.z;
      }
    }

    // --- orbit angles ----------------------------------------------------------------------------
    if (looking || lockPoint || this.aim) this.guideLeft = 0; // the player (or a lock) always outranks a guide
    if (lockPoint) {
      this.updateLock(dt, lockPoint, lx, ly, looking, dist, shoulder, sideK);
    } else {
      this.yaw += lx;
      this.pitch += ly;
      this.nudgeYaw = this.nudgePitch = 0;
      if (this.guideLeft > 0) {
        this.guideLeft -= dt;
        this.bearingTo(this.guide, t);
        this.yaw = dampAngle(this.yaw, this.bearingYaw, this.guideRate, dt);
        this.pitch = damp(this.pitch, this.bearingPitch, this.guideRate, dt);
        this.idle = 0; // do not let auto-recentre undo the framing straight away
        if (Math.abs(angleDelta(this.yaw, this.bearingYaw)) < 0.01 && Math.abs(this.pitch - this.bearingPitch) < 0.01) this.guideLeft = 0;
      } else if (!this.aim) {
        this.recentre(dt, input.assisted);
      }
    }
    this.yaw = wrapAngle(this.yaw);
    this.pitch = clamp(this.pitch, FOLLOW.pitchMin, FOLLOW.pitchMax);

    // --- ideal arm -------------------------------------------------------------------------------
    const yaw = this.yaw;
    const pitch = this.pitch;
    // `dir` is the direction of the arm (camera sits at anchor − dir·arm); the view itself uses `pitch`.
    const dir = viewDir(this.dir, yaw, orbitPitchFor(pitch));
    // The arm still dips toward the floor when looking up: shorten it smoothly instead of colliding.
    const room = Math.max(0.2, pivotY - (sy + FOLLOW.floorClearance));
    if (dir.y > 0.02) dist = softMin(dist, room / dir.y);
    dist = Math.max(FOLLOW.minDistance, dist);

    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const anchor = this.anchor;
    const cam = this.cam;
    // When the arm was squeezed last frame, the anchor rises so we look over the shoulder instead of into
    // the back of a head. It is part of the swept anchor offset, so it can never push through a ceiling.
    const rise = FOLLOW.squeezeRise * this.squeeze;
    let arm = dist;
    if (world.sweep) {
      // 1) shoulder offset: slide the anchor sideways (and up) only as far as the world allows
      let open = 1;
      if (Math.abs(shoulder) > 0.01 || rise > 0.01) {
        anchor.set(pivot.x + rx * shoulder, pivot.y + rise, pivot.z + rz * shoulder);
        const k = world.sweep(pivot, anchor, FOLLOW.probe);
        if (k !== null) open = clamp01(k);
      }
      this.sideLimit = open < this.sideLimit ? open : Math.min(open, this.sideLimit + (open - this.sideLimit) * (1 - Math.exp(-5 * dt)) + 0.2 * dt);
      const s = shoulder * this.sideLimit;
      anchor.set(pivot.x + rx * s, pivot.y + rise * this.sideLimit, pivot.z + rz * s);
      // 2) spring arm: the swept limit applies instantly (never clip through cover)…
      cam.set(anchor.x - dir.x * dist, anchor.y - dir.y * dist, anchor.z - dir.z * dist);
      const k = world.sweep(anchor, cam, FOLLOW.probe);
      // (no minimum here: against a wall the camera closes right up to the shoulder rather than poke through;
      //  the player figure is expected to fade by `targetDistance`)
      const hard = k !== null && k < 1 ? dist * clamp01(k) : dist;
      // 3) …while anticipation whiskers ease the arm in ahead of obstacles about to cross it
      let want = hard;
      const cp = Math.sqrt(Math.max(0, 1 - dir.y * dir.y));
      for (let side = -1; side <= 1; side += 2) {
        const wy = yaw + side * FOLLOW.whiskerAngle;
        cam.set(anchor.x + Math.sin(wy) * cp * dist, anchor.y - dir.y * dist, anchor.z + Math.cos(wy) * cp * dist);
        const w = world.sweep(anchor, cam, FOLLOW.probe * 0.6);
        if (w === null || w >= 1) continue;
        const hit = dist * clamp01(w);
        if (hit < hard) want = Math.min(want, hard + (hit - hard) * FOLLOW.whiskerPull);
      }
      // one smoothed length: quick to settle in, slow to ease back out, cut short by the hard limit
      if (this.fresh || want < this.armSmooth) this.armSmooth = this.fresh ? want : damp(this.armSmooth, want, 7, dt);
      else this.armSmooth = Math.min(want, this.armSmooth + clamp((want - this.armSmooth) * 3.2, 0.7, 5) * dt);
      if (this.armSmooth > hard) this.armSmooth = hard;
      arm = this.armSmooth;
    } else {
      this.sideLimit = 1;
      this.armSmooth = dist;
      anchor.set(pivot.x + rx * shoulder, pivot.y + rise, pivot.z + rz * shoulder);
    }
    this.squeeze = damp(this.squeeze, 1 - clamp01(arm / Math.max(dist, 1e-3)), 9, dt);
    cam.set(anchor.x - dir.x * arm, anchor.y - dir.y * arm, anchor.z - dir.z * arm);

    // --- floor under the camera (ramps, steps) -----------------------------------------------------
    let need = 0;
    if (world.ground) {
      const g = world.ground(cam.x, cam.z, pivot.y);
      if (g !== null) need = Math.max(0, g + FOLLOW.floorClearance - cam.y);
    }
    this.lift = need > this.lift ? need : damp(this.lift, need, 6, dt);
    if (this.lift < 1e-4) this.lift = 0;
    cam.y += this.lift;

    // --- output ----------------------------------------------------------------------------------
    const sprintTarget = smoothstep(5.9, 7.0, this.speed);
    this.sprintBlend = this.fresh ? sprintTarget : damp(this.sprintBlend, sprintTarget, 4, dt);
    this.distance = cam.distanceTo(pivot);
    this.out.pos.copy(cam);
    quatFromYawPitch(this.out.quat, yaw, pitch);
    this.out.fov = baseFov + (FOLLOW.aimFov - baseFov) * aimK + FOLLOW.sprintFov * this.sprintBlend * (1 - aimK);
    this.fresh = false;
  }

  private heightOf(t: CameraFollowTarget): number {
    return Number.isFinite(t.height) && t.height > 0 ? t.height : FOLLOW.height;
  }

  private snapFraming(): void {
    const f = this.framing;
    this.fDistance.snap(f?.distance ?? FOLLOW.distance);
    this.fShoulder.snap(f?.shoulder ?? FOLLOW.shoulder);
    this.fFov.snap(f?.fov ?? FOLLOW.fov);
    this.fHeight.snap(f?.heightOffset ?? 0);
  }

  private readLock(): Vec3Like | null {
    if (!this.lockFn) return null;
    try {
      const p = this.lockFn();
      return isFiniteVec(p) ? p : null;
    } catch (err) {
      if (!this.lockWarned) {
        this.lockWarned = true;
        console.warn('[camera] lock-on target threw — lock cleared', err);
      }
      this.lockFn = null;
      return null;
    }
  }

  /**
   * Soft lock: ease the orbit so the lock point sits just off-centre on the open side of the frame while the
   * player stays on their shoulder side. Look input adds a bounded nudge that relaxes back.
   */
  private updateLock(dt: number, p: Vec3Like, lx: number, ly: number, looking: boolean, dist: number, shoulder: number, sideK: number): void {
    const pivot = this.pivot;
    const dx = p.x - pivot.x;
    const dz = p.z - pivot.z;
    const hd = Math.hypot(dx, dz);
    if (hd > 0.35) this.lockYaw = Math.atan2(-dx, -dz);

    this.nudgeYaw = clamp(this.nudgeYaw + lx, -NUDGE_YAW, NUDGE_YAW);
    this.nudgePitch = clamp(this.nudgePitch + ly, -NUDGE_PITCH, NUDGE_PITCH);
    this.nudgeIdle = looking ? 0 : this.nudgeIdle + dt;
    if (this.nudgeIdle > 0.7) {
      this.nudgeYaw = damp(this.nudgeYaw, 0, 1.6, dt);
      this.nudgePitch = damp(this.nudgePitch, 0, 1.6, dt);
    }

    // Swing the orbit to the shoulder side so the target is not hidden behind the player's body:
    // solve for the view offset that puts the target ~5° toward the open side of screen centre.
    const alpha = 0.085;
    const reach = (Math.abs(shoulder) + alpha * dist) / Math.max(hd, 0.6);
    const swing = (alpha + Math.asin(Math.min(0.62, reach))) * sideK;
    const wantYaw = this.lockYaw + swing + this.nudgeYaw;
    const wantPitch = clamp(Math.atan2(p.y - pivot.y, hd + dist) * 0.9 - 0.1, -0.55, 0.5) + this.nudgePitch;

    // Close in, the bearing swings fast as the player circles: follow more loosely there.
    const rate = 2.2 + 4.6 * smoothstep(1.2, 4, hd);
    this.yaw = dampAngle(this.yaw, wantYaw, rate, dt);
    this.pitch = damp(this.pitch, wantPitch, rate * 0.8, dt);
  }

  /** Gentle recentre behind the direction of travel once the player has left the camera alone. */
  private recentre(dt: number, assisted: boolean): void {
    const delay = assisted ? 0.7 : 2.4;
    if (this.idle <= delay || this.speed < 1) return;
    const heading = Math.atan2(-this.velX, -this.velZ);
    const diff = angleDelta(this.yaw, heading);
    // Running toward the camera is a deliberate choice: never swing round on the player.
    const moving = smoothstep(1, 4, this.speed) * (1 - smoothstep(2.0, 2.6, Math.abs(diff)));
    const w = smoothstep(delay, delay + 1.2, this.idle) * moving;
    if (w > 0) this.yaw += diff * (1 - Math.exp(-(assisted ? 2.0 : 0.85) * w * dt));
    // Pitch drifts back to rest far more reluctantly — looking up at the architecture is the point.
    const wp = smoothstep(3, 5, this.idle) * moving;
    if (wp > 0) this.pitch = damp(this.pitch, FOLLOW.pitchRest, 0.35 * wp, dt);
  }
}
