/**
 * Third-person over-the-shoulder follow camera: orbit, aim framing, soft lock-on, position lag, blink whip,
 * sprint FOV and (device-dependent) auto-recentre. Collision lives in `arm.ts`. Pure logic — world queries come
 * in through FollowWorld.
 *
 * Conventions: yaw 0 looks toward −Z (same as actors); positive pitch looks UP.
 */
import * as THREE from 'three';
import type { CameraFollowTarget, FollowFraming, Vec3Like } from '@/core/api';
import { DEG, angleDelta, clamp, damp, dampAngle, smoothstep, wrapAngle } from '@/core/mathx';
import { ARM, SpringArm, type ArmRequest, type FollowWorld } from './arm';
import { Damped, Pose, isFiniteVec, quatFromYawPitch, viewDir } from './pose';

export type { FollowWorld } from './arm';

/** Follow-camera tuning (BRIEF §5 numbers). */
export const FOLLOW = {
  distance: 3.4,
  /** fallback pivot height when the target does not supply one */
  height: 1.55,
  shoulder: 0.55,
  /**
   * Composition: the arm is toed out so the camera sits this much further to the shoulder side at full
   * distance. The hero lands between the centre and the left third instead of covering the screen centre —
   * without moving the collision anchor away from the shoulder.
   */
  lookOffset: 0.36,
  fov: 62,
  aimDistance: 1.6,
  aimShoulder: 0.88,
  aimFov: 48,
  /** extra pivot height while aiming so the head sits below the reticle line */
  aimRise: 0.32,
  /** look-over rise when a wall is right behind the hero (see arm.ts), exploring / aiming */
  overRise: 0.6,
  overRiseAim: 0.18,
  /** the squeezed view opens up by this many degrees so the room still reads with the camera this close */
  nearFov: 7,
  /** when the camera is this close behind the hero the shoulder offset has shrunk to `nearShoulder` of itself */
  nearMin: 0.5,
  nearMax: 1.3,
  nearShoulder: 0.16,
  /** squeezed view: tilt down just enough to keep the helmet this far inside the frame (fraction of half-FOV) */
  keepHead: 0.74,
  tiltMax: 13 * DEG,
  /** centre of the head above the pivot (the pivot is shoulder / eye height) */
  headUp: 0.22,
  sprintFov: 4,
  pitchMin: -55 * DEG,
  pitchMax: 70 * DEG,
  /** resting pitch used by snapBehind and auto-recentre */
  pitchRest: -9 * DEG,
  probe: ARM.probe,
  floorClearance: ARM.floorClearance,
  minDistance: ARM.minDistance,
  lockDistance: 0.45,
  whiskerAngle: ARM.whiskerAngle,
  whiskerPull: ARM.whiskerPull,
  /**
   * Looking up: the camera body stops sinking behind the player once the view passes `orbitKnee` and settles
   * toward `orbitMax`, while the view keeps tilting — the figure slides to the bottom of the frame instead of
   * filling it from below. Past `orbitFollow` the body follows the view again (and the arm shortens against
   * the floor) so the helmet stays in the bottom of the frame all the way to the 70° clamp.
   */
  orbitKnee: 8 * DEG,
  orbitMax: 21 * DEG,
  orbitFollow: 38 * DEG,
} as const;

/** Elevation of the camera arm for a given view pitch (identical when level or looking down). */
export function orbitPitchFor(pitch: number): number {
  if (pitch <= FOLLOW.orbitKnee) return pitch;
  const span = FOLLOW.orbitMax - FOLLOW.orbitKnee;
  let orbit = FOLLOW.orbitKnee + span * (1 - Math.exp(-(pitch - FOLLOW.orbitKnee) / span));
  const x = pitch - FOLLOW.orbitFollow;
  if (x > 0) orbit += (x * x) / (x + 5 * DEG);
  return orbit;
}

/** Auto-recentre policy, chosen by the rig from the active device. */
export const RECENTRE_OFF = 0;
/** gamepad / bots: late, slow, forward motion only */
export const RECENTRE_GENTLE = 1;
/** keyboard without pointer lock: sooner and a little firmer, because turning the camera is laborious */
export const RECENTRE_ASSIST = 2;

export interface FollowInput {
  /** look delta this frame (radians): x = yaw, y = pitch (up positive) */
  lookX: number;
  lookY: number;
  /** RECENTRE_OFF (pointer-locked mouse) | RECENTRE_GENTLE | RECENTRE_ASSIST */
  recentre: number;
  /** the move intent is an absolute world direction (bots), not camera-relative: following it cannot spiral */
  absolute: boolean;
  /** a combat input is held: leave the camera where the player put it */
  busy: boolean;
  /** simulated seconds this frame (0 during hit-stop, scaled in slow-motion): speed estimate, guided turns */
  simDt: number;
  /** 0..1: share of the 16:9 horizontal view the window really shows — the shoulder offset shrinks with it */
  frame: number;
}

const NUDGE_YAW = 0.6;
const NUDGE_PITCH = 0.35;
/** a jump longer than this is a teleport: cut */
const TELEPORT = 25;
/** a one-frame jump longer than this (and faster than BLINK_SPEED) is a blink: whip to it instead of cutting */
const BLINK = 1.5;
const BLINK_SPEED = 30;
/** recentre: yaw rate caps (rad/s) and how far off the view axis the heading may be before it is ignored */
const RECENTRE_CAP = [0, 18 * DEG, 25 * DEG] as const;
const RECENTRE_GAIN = [0, 0.85, 2.0] as const;
const RECENTRE_DELAY = [0, 2.4, 0.9] as const;
const RECENTRE_CALM = [0, 4, 1.5] as const;

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

  private readonly arm = new SpringArm();
  private readonly px = new Damped();
  private readonly py = new Damped();
  private readonly pz = new Damped();
  private readonly last = new THREE.Vector3();
  private velX = 0;
  private velZ = 0;
  private speed = 0;
  private readonly whipFrom = new THREE.Vector3();
  private whipT = 1;
  private whipDur = 0;

  private readonly aimBlend = new Damped(0);
  private readonly sideBlend = new Damped(1);
  private readonly lockBlend = new Damped(0);
  private readonly tilt = new Damped(0);
  private sprintBlend = 0;
  private near = 0;
  private idle = 0;
  private calm = 10;
  private travel = 0;
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
  private readonly head = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly req: ArmRequest = {
    pivot: this.pivot, head: this.head, floorY: 0, yaw: 0, dir: this.dir, dist: FOLLOW.distance, shoulder: FOLLOW.shoulder, lift: 0, overRise: 0,
    velX: 0, velZ: 0,
  };

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

  /** the hero's head this frame (pivot before lag) — what the figure fade is measured against */
  get headPoint(): THREE.Vector3 {
    return this.head;
  }

  /** downward view tilt (radians) currently added by the squeezed look-over pose */
  get viewTilt(): number {
    return this.tilt.value;
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

  /** Drop everything that belongs to the space being left (zone load): lock, aim, guided turn, smoothing. */
  resetScene(): void {
    this.lockFn = null;
    this.aim = false;
    this.guideLeft = 0;
    this.nudgeYaw = this.nudgePitch = 0;
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
    const arm = this.arm;
    const simDt = input.simDt > 0 ? input.simDt : 0;

    // --- target motion: teleport cut, blink whip, speed --------------------------------------------
    const moved = this.fresh ? 0 : this.last.distanceTo(tp);
    if (moved > TELEPORT) this.fresh = true;
    if (this.fresh) {
      this.px.snap(tp.x);
      this.py.snap(tp.y);
      this.pz.snap(tp.z);
      this.velX = this.velZ = this.speed = 0;
      this.whipT = 1;
      this.near = 0;
      this.tilt.snap(0);
      arm.reset();
      this.aimBlend.snap(this.aim ? 1 : 0);
      this.sideBlend.snap(this.side);
      this.lockBlend.snap(this.lockFn ? 1 : 0);
      this.snapFraming();
    } else if (moved > BLINK && moved > BLINK_SPEED * dt) {
      // A blink-strike or a knock-through: travel there in a short whip instead of jump-cutting. Aim, shoulder
      // and lock blends are left alone — it is still the same shot.
      this.whipFrom.set(this.px.value, this.py.value, this.pz.value);
      this.whipT = 0;
      this.whipDur = clamp(0.11 + moved * 0.012, 0.14, 0.22);
    } else if (simDt > 1e-5) {
      // speed in world units per SIMULATED second, so slow-motion and hit-stop do not read as standing still
      this.velX = damp(this.velX, (tp.x - this.last.x) / simDt, 10, dt);
      this.velZ = damp(this.velZ, (tp.z - this.last.z) / simDt, 10, dt);
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
    this.calm = input.busy ? 0 : this.calm + dt;

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
    const dist = baseDist + (FOLLOW.aimDistance - baseDist) * aimK + FOLLOW.lockDistance * lockK * (1 - aimK);
    // Lateral offset of the anchor, and the toe-out that composes the hero off-centre (none while aiming).
    const frame = input.frame > 0 && input.frame < 1 ? input.frame : 1;
    const lateral = (baseShoulder + (FOLLOW.aimShoulder - baseShoulder) * aimK) * frame;
    const toe = FOLLOW.lookOffset * Math.min(1.5, baseShoulder / FOLLOW.shoulder) * (1 - aimK) * frame;

    // --- smoothed pivot (critically damped lag; vertical is softer to swallow steps) --------------
    let sx: number;
    let sy: number;
    let sz: number;
    if (this.whipT < 1) {
      if (dt > 0) this.whipT = Math.min(1, this.whipT + dt / this.whipDur);
      const e = this.whipT * this.whipT * (3 - 2 * this.whipT);
      const from = this.whipFrom;
      sx = from.x + (tp.x - from.x) * e;
      sy = from.y + (tp.y - from.y) * e;
      sz = from.z + (tp.z - from.z) * e;
      this.px.snap(sx);
      this.py.snap(sy);
      this.pz.snap(sz);
    } else {
      sx = this.px.step(tp.x, 0.07, dt);
      sy = this.py.step(tp.y, 0.16, dt);
      sz = this.pz.step(tp.z, 0.07, dt);
      const lagX = sx - tp.x;
      const lagZ = sz - tp.z;
      const lag = Math.hypot(lagX, lagZ);
      // The hero may run ahead of the pivot by up to a metre — but only as much as the frame can afford: with
      // the camera squeezed close, a metre of lag would put the hero out of shot.
      const slack = clamp(arm.backRoom * 0.3, 0.05, 1);
      if (lag > slack) {
        sx = tp.x + (lagX / lag) * slack;
        sz = tp.z + (lagZ / lag) * slack;
        this.px.value = sx;
        this.pz.value = sz;
      }
    }
    const head = this.head.set(tp.x, tp.y + h, tp.z);
    const pivot = this.pivot.set(sx, sy + h, sz);
    if (world.sweep && (Math.abs(sx - tp.x) > 0.05 || Math.abs(sz - tp.z) > 0.05)) {
      // The lagged pivot may cut a corner the player went around: keep it reachable from the real one.
      const k = world.sweep(head, pivot, FOLLOW.probe);
      if (k !== null && k < 1 && k > 1e-3) {
        pivot.lerpVectors(head, pivot, k);
        if (this.whipT >= 1) {
          this.px.value = pivot.x;
          this.pz.value = pivot.z;
        }
      }
    }

    // --- orbit angles ----------------------------------------------------------------------------
    if (looking || lockPoint || this.aim) this.guideLeft = 0; // the player (or a lock) always outranks a guide
    // Scripted turns slow down while the arm is brushing geometry: a fast swing past a pillar is what pops.
    const ease = 1 - 0.55 * arm.crowded;
    if (lockPoint) {
      this.updateLock(dt, lockPoint, lx, ly, looking, dist, (lateral + toe) * (1 - (1 - FOLLOW.nearShoulder) * this.near), sideK, ease);
    } else {
      this.yaw += lx;
      this.pitch += ly;
      this.nudgeYaw = this.nudgePitch = 0;
      if (this.guideLeft > 0) {
        this.guideLeft -= simDt;
        this.bearingTo(this.guide, t);
        this.yaw = dampAngle(this.yaw, this.bearingYaw, this.guideRate * ease, simDt);
        this.pitch = damp(this.pitch, this.bearingPitch, this.guideRate * ease, simDt);
        this.idle = 0; // do not let auto-recentre undo the framing straight away
        if (Math.abs(angleDelta(this.yaw, this.bearingYaw)) < 0.01 && Math.abs(this.pitch - this.bearingPitch) < 0.01) this.guideLeft = 0;
      } else if (!this.aim) {
        this.recentre(dt, input, ease);
      }
    }
    this.yaw = wrapAngle(this.yaw);
    this.pitch = clamp(this.pitch, FOLLOW.pitchMin, FOLLOW.pitchMax);

    // --- spring arm ------------------------------------------------------------------------------
    const yaw = this.yaw;
    const pitch = this.pitch;
    const req = this.req;
    req.floorY = sy;
    req.yaw = yaw;
    req.dist = dist;
    req.lift = heightOffset + FOLLOW.aimRise * aimK;
    req.overRise = FOLLOW.overRise + (FOLLOW.overRiseAim - FOLLOW.overRise) * aimK;
    req.velX = this.velX;
    req.velZ = this.velZ;
    const orbit = orbitPitchFor(pitch);
    // (a fresh seat iterates: how close the camera ends up decides the shoulder offset, and vice versa)
    for (let pass = this.fresh ? 3 : 1; pass > 0; pass--) {
      // Close behind the hero (squeezed by a wall) the lateral offset shrinks, or the hero would leave the frame.
      const nearScale = 1 - (1 - FOLLOW.nearShoulder) * this.near;
      // `dir` is the direction of the arm (camera sits at anchor − dir·arm); the view itself uses yaw / pitch.
      const toeAngle = toe > 0 ? Math.asin(Math.min(0.5, (toe * nearScale) / Math.max(dist, 0.5))) * sideK : 0;
      viewDir(this.dir, yaw + toeAngle, orbit);
      req.shoulder = lateral * nearScale * sideK;
      arm.solve(dt, this.fresh, world, req);
      const nearTarget = arm.length < arm.reach - 0.05 ? 1 - smoothstep(FOLLOW.nearMin, FOLLOW.nearMax, arm.backRoom) : 0;
      this.near = this.fresh ? nearTarget : damp(this.near, nearTarget, nearTarget > this.near ? 20 : 3, dt);
    }
    const cam = arm.cam;

    // --- output ----------------------------------------------------------------------------------
    const sprintTarget = smoothstep(5.9, 7.0, this.speed);
    this.sprintBlend = this.fresh ? sprintTarget : damp(this.sprintBlend, sprintTarget, 4, dt);
    const fov = baseFov + (FOLLOW.aimFov - baseFov) * aimK + (FOLLOW.sprintFov * this.sprintBlend + FOLLOW.nearFov * this.near) * (1 - aimK);

    // Squeezed against a wall the camera is close above the hero: tilt the view down just enough to keep the
    // helmet in the bottom of the frame. Never while aiming (the reticle must not drift), and not when the
    // hero could not be brought into frame anyway (looking up with a wall behind).
    let tilt = 0;
    if (this.near > 0.01 && aimK < 0.99) {
      // where the helmet projects in the untilted view: depth along the view axis, height along its up axis
      const hx = head.x - cam.x;
      const hy = head.y + FOLLOW.headUp - cam.y;
      const hz = head.z - cam.z;
      const sp = Math.sin(pitch);
      const cp = Math.cos(pitch);
      const ahead = -Math.sin(yaw) * hx - Math.cos(yaw) * hz;
      const depth = ahead * cp + hy * sp;
      const height = hy * cp - ahead * sp;
      const need = Math.atan2(-height, Math.max(depth, 1e-3)) - Math.atan(Math.tan(fov * DEG * 0.5) * FOLLOW.keepHead);
      if (need > 0) {
        tilt = need <= FOLLOW.tiltMax ? need : FOLLOW.tiltMax * (1 - smoothstep(FOLLOW.tiltMax, FOLLOW.tiltMax * 2.2, need));
        tilt *= this.near * (1 - aimK);
      }
    }
    if (this.fresh) this.tilt.snap(tilt);
    else this.tilt.step(tilt, 0.16, dt);

    this.distance = cam.distanceTo(pivot);
    this.out.pos.copy(cam);
    quatFromYawPitch(this.out.quat, yaw, Math.max(FOLLOW.pitchMin - FOLLOW.tiltMax, pitch - this.tilt.value));
    this.out.fov = fov;
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
  private updateLock(dt: number, p: Vec3Like, lx: number, ly: number, looking: boolean, dist: number, lateral: number, sideK: number, ease: number): void {
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
    const reach = (lateral + alpha * dist) / Math.max(hd, 0.6);
    const swing = (alpha + Math.asin(Math.min(0.62, reach))) * sideK;
    const wantYaw = this.lockYaw + swing + this.nudgeYaw;
    const wantPitch = clamp(Math.atan2(p.y - pivot.y, hd + dist) * 0.9 - 0.1, -0.55, 0.5) + this.nudgePitch;

    // Close in, the bearing swings fast as the player circles: follow more loosely there.
    const rate = (2.2 + 4.6 * smoothstep(1.2, 4, hd)) * ease;
    this.yaw = dampAngle(this.yaw, wantYaw, rate, dt);
    this.pitch = damp(this.pitch, wantPitch, rate * 0.8, dt);
  }

  /**
   * Gentle recentre behind the direction of travel once the player has left the camera alone. Never with a
   * pointer-locked mouse. The heading is camera-relative for a player (strafing moves it with the camera), so
   * only motion that is mostly FORWARD pulls the view, and the yaw rate is capped: a held strafe or backpedal
   * does nothing, a held diagonal is a slow arc — never a spin.
   */
  private recentre(dt: number, input: FollowInput, ease: number): void {
    const mode = input.recentre === RECENTRE_ASSIST ? RECENTRE_ASSIST : input.recentre === RECENTRE_GENTLE ? RECENTRE_GENTLE : RECENTRE_OFF;
    if (mode === RECENTRE_OFF) return;
    const delay = RECENTRE_DELAY[mode];
    // (it also eases in over the first couple of seconds of a run, so setting off never swings the view)
    this.travel = this.speed < 1 ? 0 : this.travel + dt;
    if (this.idle <= delay || this.calm < RECENTRE_CALM[mode] || this.speed < 1) return;
    const heading = Math.atan2(-this.velX, -this.velZ);
    const diff = angleDelta(this.yaw, heading);
    const off = Math.abs(diff);
    // A bot steering by world direction can be followed round almost any corner; running toward the camera is
    // still a deliberate choice, so the view never swings round on the player.
    const forward = input.absolute ? 1 - smoothstep(2.0, 2.6, off) : 1 - smoothstep(30 * DEG, 55 * DEG, off);
    const moving = smoothstep(1, 4, this.speed) * forward * smoothstep(0.4, 1.8, this.travel);
    const w = smoothstep(delay, delay + 1.2, this.idle) * moving;
    if (w > 0) {
      const cap = (input.absolute ? 60 * DEG : RECENTRE_CAP[mode]) * ease * dt;
      this.yaw += clamp(diff * (1 - Math.exp(-RECENTRE_GAIN[mode] * w * dt)), -cap, cap);
    }
    // Pitch drifts back to rest far more reluctantly — looking up at the architecture is the point.
    const wp = smoothstep(3, 5, this.idle) * moving;
    if (wp > 0) this.pitch = damp(this.pitch, FOLLOW.pitchRest, 0.35 * wp, dt);
  }
}
