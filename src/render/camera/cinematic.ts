/**
 * Cinematic camera: cuts, eased moves (straight, arced or through several keys), orbital drift, target tracking
 * and handheld sway. Poses are authored as position + look target; the rig turns them into the final camera.
 *
 * Orientation is always interpolated as pan / tilt angles (like a fluid head), never by sliding the look target
 * through space — so a move has an even angular speed, the horizon stays level, and a look target that passes
 * close to the camera cannot whip the view round.
 */
import * as THREE from 'three';
import type { CamPose, CinematicCamera, EaseName, Vec3Like } from '@/core/api';
import { DEG, angleDelta, clamp, clamp01, smoothstep, type EaseFn } from '@/core/mathx';
import { Pose, easeFn, isFiniteVec, noise1, quatLookAt, viewDir } from './pose';

/** What the cinematic layer needs from the rig when it takes over. */
export interface CinematicHost {
  /** current rendered pose (before shake) and a sensible look distance for it */
  currentPose(): Pose;
  lookDistance(): number;
  /** called when cinematic mode starts */
  onCinematicEnter(): void;
}

const HANDHELD_ANGLE = 0.55 * DEG;
const HANDHELD_ROLL = 0.3 * DEG;
const HANDHELD_SHIFT = 0.03;
/** seconds a drift takes to ease onto a newly requested look point / radius / height */
const DRIFT_SETTLE = 0.9;
/** keys a path() can hold, including the starting pose */
const MAX_KEYS = 17;
const MOVE_LINE = 0;
const MOVE_ARC = 1;
const MOVE_PATH = 2;

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpV = new THREE.Vector3();

/** pan / tilt / distance of a look target seen from a position */
interface Aim {
  yaw: number;
  pitch: number;
  dist: number;
}
const aimOf = (out: Aim, pos: Vec3Like, look: Vec3Like, fallbackYaw: number): Aim => {
  const dx = look.x - pos.x;
  const dy = look.y - pos.y;
  const dz = look.z - pos.z;
  const hd = Math.hypot(dx, dz);
  out.dist = Math.max(0.05, Math.hypot(hd, dy));
  out.pitch = Math.atan2(dy, hd);
  // straight up / down has no bearing of its own: borrow the other end's
  out.yaw = hd > out.dist * 0.03 ? Math.atan2(-dx, -dz) : fallbackYaw;
  return out;
};

/** Catmull-Rom through p1→p2 with neighbours p0 / p3 */
const spline = (p0: number, p1: number, p2: number, p3: number, u: number): number => {
  const u2 = u * u;
  return 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (3 * p1 - p0 - 3 * p2 + p3) * u2 * u);
};

/** one key of a path(): position plus unwrapped pan / tilt, look distance, FOV and roll */
class Key {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  dist = 1;
  fov = 62;
  roll = 0;
  /** path parameter 0..1 at which this key is reached */
  at = 0;
}

export class CinematicImpl implements CinematicCamera {
  /** true while the cinematic layer owns the camera */
  active = false;
  /** resolved pose for this frame */
  readonly out = new Pose();

  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private fov = 62;
  private roll = 0;

  private kind = MOVE_LINE;
  private readonly fromPos = new THREE.Vector3();
  private readonly toPos = new THREE.Vector3();
  private readonly from: Aim = { yaw: 0, pitch: 0, dist: 1 };
  private readonly to: Aim = { yaw: 0, pitch: 0, dist: 1 };
  /** both ends look at the same point: hold it exactly (an orbit / dolly round a subject) */
  private sameLook = false;
  private fromFov = 62;
  private fromRoll = 0;
  private toFov = 62;
  private toRoll = 0;
  private moveT = 0;
  private moveDur = 0;
  private ease: EaseFn = easeFn('inOut');
  private _moving = false;

  private readonly arcCentre = new THREE.Vector3();
  private arcFrom = 0;
  private arcTurn = 0;
  private arcRadFrom = 1;
  private arcRadTo = 1;

  private readonly keys: Key[] = Array.from({ length: MAX_KEYS }, () => new Key());
  private keyCount = 0;

  private drifting = false;
  private readonly driftCentre = new THREE.Vector3();
  private readonly driftLook = new THREE.Vector3();
  private driftRate = 0.06;
  private driftAngle = 0;
  private driftRadFrom = 4;
  private driftRadTo = 4;
  private driftHeightFrom = 1.6;
  private driftHeightTo = 1.6;
  private driftOffYaw = 0;
  private driftOffPitch = 0;
  private driftT = 1;

  private trackFn: (() => Vec3Like) | null = null;
  private trackWarned = false;
  private sway = 0;
  private time = 0;
  private readonly aim: Aim = { yaw: 0, pitch: 0, dist: 1 };

  constructor(private readonly host: CinematicHost) {}

  get moving(): boolean {
    return this._moving;
  }

  cut(pose: CamPose): void {
    if (!this.valid(pose, 'cut')) return;
    this.enter();
    this.pos.copy(pose.pos as THREE.Vector3);
    this.look.copy(pose.look as THREE.Vector3);
    if (Number.isFinite(pose.fov)) this.fov = clamp(pose.fov as number, 5, 140);
    this.roll = Number.isFinite(pose.roll) ? (pose.roll as number) : 0;
    this._moving = false;
    this.drifting = false;
    this.resolve(1);
  }

  move(pose: CamPose, seconds: number, ease?: EaseName): void {
    if (!this.valid(pose, 'move')) return;
    this.beginMove(pose, seconds, ease);
    this.kind = MOVE_LINE;
    if (!this._moving) this.applyMove(1);
  }

  arc(pose: CamPose, seconds: number, around: Vec3Like, ease?: EaseName): void {
    if (!this.valid(pose, 'arc')) return;
    if (!isFiniteVec(around)) {
      console.warn('[camera] cine.arc: `around` is not a finite point — moving in a straight line');
      this.move(pose, seconds, ease);
      return;
    }
    this.beginMove(pose, seconds, ease);
    const c = this.arcCentre.copy(around as THREE.Vector3);
    const fx = this.fromPos.x - c.x;
    const fz = this.fromPos.z - c.z;
    const tx = this.toPos.x - c.x;
    const tz = this.toPos.z - c.z;
    this.arcRadFrom = Math.hypot(fx, fz);
    this.arcRadTo = Math.hypot(tx, tz);
    // an end sitting on the axis has no bearing: the path degenerates to a spiral out of / into it
    this.arcFrom = this.arcRadFrom > 1e-3 ? Math.atan2(fx, fz) : Math.atan2(tx, tz);
    this.arcTurn = this.arcRadFrom > 1e-3 && this.arcRadTo > 1e-3 ? angleDelta(this.arcFrom, Math.atan2(tx, tz)) : 0;
    this.kind = MOVE_ARC;
    if (!this._moving) this.applyMove(1);
  }

  path(poses: readonly CamPose[], seconds: number, ease?: EaseName): void {
    const list = Array.isArray(poses) ? poses.filter((p) => p && isFiniteVec(p.pos) && isFiniteVec(p.look)) : [];
    if (list.length === 0) {
      console.warn('[camera] cine.path ignored: it needs at least one pose with finite pos and look');
      return;
    }
    if (list.length > MAX_KEYS - 1) {
      console.warn(`[camera] cine.path: only the first ${MAX_KEYS - 1} keys are used`);
      list.length = MAX_KEYS - 1;
    }
    const last = list[list.length - 1];
    this.beginMove(last, seconds, ease);
    // key 0 is where the camera is now; angles are unwrapped key to key so the spline takes the short way round
    const keys = this.keys;
    const k0 = keys[0];
    k0.x = this.fromPos.x;
    k0.y = this.fromPos.y;
    k0.z = this.fromPos.z;
    k0.yaw = this.from.yaw;
    k0.pitch = this.from.pitch;
    k0.dist = this.from.dist;
    k0.fov = this.fromFov;
    k0.roll = this.fromRoll;
    k0.at = 0;
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const prev = keys[i];
      const k = keys[i + 1];
      k.x = p.pos.x;
      k.y = p.pos.y;
      k.z = p.pos.z;
      const a = aimOf(this.aim, p.pos, p.look, prev.yaw);
      k.yaw = prev.yaw + angleDelta(prev.yaw, a.yaw);
      k.pitch = a.pitch;
      k.dist = a.dist;
      k.fov = Number.isFinite(p.fov) ? clamp(p.fov as number, 5, 140) : prev.fov;
      k.roll = Number.isFinite(p.roll) ? (p.roll as number) : 0;
      // time is shared out by how far each leg travels (a leg that only pans still gets its share)
      total += Math.hypot(k.x - prev.x, k.y - prev.y, k.z - prev.z) + 2 * (Math.abs(k.yaw - prev.yaw) + Math.abs(k.pitch - prev.pitch)) + 1e-3;
      k.at = total;
    }
    for (let i = 1; i <= list.length; i++) keys[i].at /= total;
    this.keyCount = list.length + 1;
    this.kind = MOVE_PATH;
    if (!this._moving) this.applyMove(1);
  }

  drift(opts: { around: Vec3Like; radius?: number; yawRate?: number; height?: number; lookHeight?: number }): void {
    if (!opts || !isFiniteVec(opts.around)) {
      console.warn('[camera] cine.drift ignored: `around` is not a finite point');
      return;
    }
    const wasActive = this.active;
    this.enter();
    const c = this.driftCentre.copy(opts.around as THREE.Vector3);
    // The orbit starts exactly where the shot is: its bearing, radius and height. Anything the caller asks for
    // on top of that (another radius or height, a look point) is eased onto — a drift never snaps the view.
    const dx = this.pos.x - c.x;
    const dz = this.pos.z - c.z;
    const here = Math.hypot(dx, dz);
    const continues = wasActive && here > 0.5;
    this.driftRadFrom = continues ? here : 4;
    this.driftHeightFrom = continues ? this.pos.y - c.y : 1.6;
    this.driftRadTo = Number.isFinite(opts.radius) ? Math.max(0.2, opts.radius as number) : this.driftRadFrom;
    this.driftHeightTo = Number.isFinite(opts.height) ? (opts.height as number) : this.driftHeightFrom;
    this.driftRate = Number.isFinite(opts.yawRate) ? clamp(opts.yawRate as number, -3, 3) : 0.06;
    this.driftAngle = here > 1e-3 ? Math.atan2(dx, dz) : 0;
    const before = aimOf(this.aim, this.pos, this.look, 0);
    const beforeYaw = before.yaw;
    const beforePitch = before.pitch;
    if (Number.isFinite(opts.lookHeight) || !continues) this.driftLook.set(c.x, c.y + (Number.isFinite(opts.lookHeight) ? (opts.lookHeight as number) : 1.4), c.z);
    else this.driftLook.copy(this.look); // keep framing what the shot was framing
    this.driftT = continues ? 0 : 1;
    if (!continues) {
      this.driftRadFrom = this.driftRadTo;
      this.driftHeightFrom = this.driftHeightTo;
    }
    this.drifting = true;
    this._moving = false;
    this.driftOffYaw = this.driftOffPitch = 0;
    this.applyDrift();
    if (continues) {
      const after = aimOf(this.aim, this.pos, this.driftLook, beforeYaw);
      this.driftOffYaw = angleDelta(after.yaw, beforeYaw);
      this.driftOffPitch = beforePitch - after.pitch;
      this.applyDrift();
    }
    this.resolve(1);
  }

  track(target: (() => Vec3Like) | null): void {
    this.trackFn = typeof target === 'function' ? target : null;
    this.trackWarned = false;
  }

  handheld(amount: number): void {
    this.sway = clamp01(Number.isFinite(amount) ? amount : 0);
  }

  finish(): void {
    if (!this._moving) return;
    this.applyMove(1);
    this._moving = false;
    this.resolve(1);
  }

  /** Leave cinematic mode (rig.release). Clears drift / track / sway so the next shot starts clean. */
  exit(): void {
    this.active = false;
    this._moving = false;
    this.drifting = false;
    this.trackFn = null;
    this.sway = 0;
  }

  /** Advance and resolve this frame's pose. `dt` is authored time (0 while paused). */
  update(dt: number, swayScale: number): void {
    if (!this.active) return;
    this.time += dt;
    if (this._moving) {
      this.moveT += dt;
      const u = this.moveT / this.moveDur;
      if (u >= 1) {
        this.applyMove(1);
        this._moving = false;
      } else {
        this.applyMove(this.ease(u));
      }
    } else if (this.drifting) {
      this.driftAngle += this.driftRate * dt;
      if (this.driftT < 1) this.driftT = Math.min(1, this.driftT + dt / DRIFT_SETTLE);
      this.applyDrift();
    }
    this.resolve(swayScale);
  }

  private enter(): void {
    if (this.active) return;
    const p = this.host.currentPose();
    this.pos.copy(p.pos);
    tmpV.set(0, 0, -1).applyQuaternion(p.quat).multiplyScalar(this.host.lookDistance());
    this.look.copy(p.pos).add(tmpV);
    this.fov = p.fov;
    this.roll = 0;
    this.active = true;
    this._moving = false;
    this.drifting = false;
    this.host.onCinematicEnter();
  }

  private valid(pose: CamPose, what: string): boolean {
    if (pose && isFiniteVec(pose.pos) && isFiniteVec(pose.look)) return true;
    console.warn(`[camera] cine.${what} ignored: pose needs finite pos and look`);
    return false;
  }

  /** shared start of move / arc / path: capture the current shot as "from", `pose` as "to" */
  private beginMove(pose: CamPose, seconds: number, ease?: EaseName): void {
    this.enter();
    this.drifting = false;
    this.fromPos.copy(this.pos);
    this.toPos.copy(pose.pos as THREE.Vector3);
    this.sameLook = this.look.distanceToSquared(pose.look as THREE.Vector3) < 1e-4;
    const to = aimOf(this.to, pose.pos, pose.look, 0);
    const from = aimOf(this.from, this.pos, this.look, to.yaw);
    aimOf(to, pose.pos, pose.look, from.yaw);
    to.yaw = from.yaw + angleDelta(from.yaw, to.yaw);
    this.fromFov = this.fov;
    this.fromRoll = this.roll;
    this.toFov = Number.isFinite(pose.fov) ? clamp(pose.fov as number, 5, 140) : this.fov;
    this.toRoll = Number.isFinite(pose.roll) ? (pose.roll as number) : 0;
    this.ease = easeFn(ease);
    this.moveT = 0;
    this.moveDur = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    this._moving = this.moveDur > 0;
  }

  private applyMove(k: number): void {
    if (this.kind === MOVE_PATH) {
      this.applyPath(k);
      return;
    }
    const { fromPos, toPos, from, to } = this;
    if (this.kind === MOVE_ARC) {
      const c = this.arcCentre;
      const a = this.arcFrom + this.arcTurn * k;
      const r = this.arcRadFrom + (this.arcRadTo - this.arcRadFrom) * k;
      this.pos.set(c.x + Math.sin(a) * r, fromPos.y + (toPos.y - fromPos.y) * k, c.z + Math.cos(a) * r);
      if (k >= 1) this.pos.copy(toPos);
    } else {
      this.pos.lerpVectors(fromPos, toPos, k);
    }
    if (!this.sameLook) {
      viewDir(tmpV, from.yaw + (to.yaw - from.yaw) * k, from.pitch + (to.pitch - from.pitch) * k);
      this.look.copy(this.pos).addScaledVector(tmpV, from.dist + (to.dist - from.dist) * k);
    }
    this.fov = this.fromFov + (this.toFov - this.fromFov) * k;
    this.roll = this.fromRoll + (this.toRoll - this.fromRoll) * k;
  }

  /** Catmull-Rom through the keys: one continuous move, no stop at the intermediate keys */
  private applyPath(k: number): void {
    const keys = this.keys;
    const n = this.keyCount;
    let i = 0;
    while (i < n - 2 && k > keys[i + 1].at) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const p = keys[i > 0 ? i - 1 : 0];
    const q = keys[i + 2 < n ? i + 2 : n - 1];
    const u = clamp01((k - a.at) / Math.max(1e-6, b.at - a.at));
    this.pos.set(spline(p.x, a.x, b.x, q.x, u), spline(p.y, a.y, b.y, q.y, u), spline(p.z, a.z, b.z, q.z, u));
    const pitch = clamp(spline(p.pitch, a.pitch, b.pitch, q.pitch, u), -1.55, 1.55);
    viewDir(tmpV, spline(p.yaw, a.yaw, b.yaw, q.yaw, u), pitch);
    this.look.copy(this.pos).addScaledVector(tmpV, Math.max(0.05, spline(p.dist, a.dist, b.dist, q.dist, u)));
    this.fov = clamp(spline(p.fov, a.fov, b.fov, q.fov, u), 5, 140);
    this.roll = spline(p.roll, a.roll, b.roll, q.roll, u);
  }

  private applyDrift(): void {
    const c = this.driftCentre;
    const e = smoothstep(0, 1, this.driftT);
    const radius = this.driftRadFrom + (this.driftRadTo - this.driftRadFrom) * e;
    const height = this.driftHeightFrom + (this.driftHeightTo - this.driftHeightFrom) * e;
    this.pos.set(c.x + Math.sin(this.driftAngle) * radius, c.y + height, c.z + Math.cos(this.driftAngle) * radius);
    // look at the drift's look point, minus whatever is left of the offset the shot started with
    const a = aimOf(this.aim, this.pos, this.driftLook, 0);
    const left = 1 - e;
    viewDir(tmpV, a.yaw + this.driftOffYaw * left, clamp(a.pitch + this.driftOffPitch * left, -1.55, 1.55));
    this.look.copy(this.pos).addScaledVector(tmpV, a.dist);
  }

  private resolve(swayScale: number): void {
    const out = this.out;
    out.pos.copy(this.pos);
    out.fov = this.fov;
    let look: Vec3Like = this.look;
    if (this.trackFn) {
      try {
        const p = this.trackFn();
        if (isFiniteVec(p)) look = p;
      } catch (err) {
        if (!this.trackWarned) {
          this.trackWarned = true;
          console.warn('[camera] cine.track target threw — tracking cleared', err);
        }
        this.trackFn = null;
      }
    }
    quatLookAt(out.quat, out.pos, look, this.roll);
    const s = this.sway * swayScale;
    if (s > 0) {
      const t = this.time;
      tmpE.set(noise1(t * 0.43, 211) * HANDHELD_ANGLE * s, noise1(t * 0.37, 223) * HANDHELD_ANGLE * s, noise1(t * 0.29, 227) * HANDHELD_ROLL * s, 'YXZ');
      out.quat.multiply(tmpQ.setFromEuler(tmpE));
      tmpV.set(noise1(t * 0.33, 229) * HANDHELD_SHIFT * s, noise1(t * 0.41, 233) * HANDHELD_SHIFT * s, 0).applyQuaternion(out.quat);
      out.pos.add(tmpV);
    }
  }
}
