/**
 * Cinematic camera: cuts, eased moves (position / look target / FOV / roll), orbital drift, target tracking and
 * handheld sway. Poses are authored as position + look target; the rig turns them into the final camera.
 */
import * as THREE from 'three';
import type { CamPose, CinematicCamera, EaseName, Vec3Like } from '@/core/api';
import { DEG, clamp, clamp01, type EaseFn } from '@/core/mathx';
import { Pose, easeFn, isFiniteVec, noise1, quatLookAt } from './pose';

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

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpV = new THREE.Vector3();

export class CinematicImpl implements CinematicCamera {
  /** true while the cinematic layer owns the camera */
  active = false;
  /** resolved pose for this frame */
  readonly out = new Pose();

  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private fov = 62;
  private roll = 0;

  private readonly fromPos = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private fromFov = 62;
  private fromRoll = 0;
  private readonly toPos = new THREE.Vector3();
  private readonly toLook = new THREE.Vector3();
  private toFov = 62;
  private toRoll = 0;
  private moveT = 0;
  private moveDur = 0;
  private ease: EaseFn = easeFn('inOut');
  private _moving = false;

  private drifting = false;
  private readonly driftCentre = new THREE.Vector3();
  private driftRadius = 4;
  private driftRate = 0.06;
  private driftHeight = 1.6;
  private driftLook = 1.4;
  private driftAngle = 0;

  private trackFn: (() => Vec3Like) | null = null;
  private trackWarned = false;
  private sway = 0;
  private time = 0;

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
    this.enter();
    this.drifting = false;
    this.fromPos.copy(this.pos);
    this.fromLook.copy(this.look);
    this.fromFov = this.fov;
    this.fromRoll = this.roll;
    this.toPos.copy(pose.pos as THREE.Vector3);
    this.toLook.copy(pose.look as THREE.Vector3);
    this.toFov = Number.isFinite(pose.fov) ? clamp(pose.fov as number, 5, 140) : this.fov;
    this.toRoll = Number.isFinite(pose.roll) ? (pose.roll as number) : 0;
    this.ease = easeFn(ease);
    this.moveT = 0;
    this.moveDur = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    this._moving = this.moveDur > 0;
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
    // Defaults continue from the current shot so a cut followed by drift() does not jump.
    const dx = this.pos.x - c.x;
    const dz = this.pos.z - c.z;
    const here = Math.hypot(dx, dz);
    const useHere = wasActive && here > 0.5;
    this.driftRadius = Number.isFinite(opts.radius) ? Math.max(0.2, opts.radius as number) : useHere ? here : 4;
    this.driftHeight = Number.isFinite(opts.height) ? (opts.height as number) : useHere ? this.pos.y - c.y : 1.6;
    this.driftLook = Number.isFinite(opts.lookHeight) ? (opts.lookHeight as number) : 1.4;
    this.driftRate = Number.isFinite(opts.yawRate) ? clamp(opts.yawRate as number, -3, 3) : 0.06;
    this.driftAngle = here > 1e-3 ? Math.atan2(dx, dz) : 0;
    this.drifting = true;
    this._moving = false;
    this.applyDrift();
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

  /** Advance and resolve this frame's pose. `swayScale` lets the rig honour reduceShake. */
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

  private applyMove(k: number): void {
    this.pos.lerpVectors(this.fromPos, this.toPos, k);
    this.look.lerpVectors(this.fromLook, this.toLook, k);
    this.fov = this.fromFov + (this.toFov - this.fromFov) * k;
    this.roll = this.fromRoll + (this.toRoll - this.fromRoll) * k;
  }

  private applyDrift(): void {
    const c = this.driftCentre;
    this.pos.set(c.x + Math.sin(this.driftAngle) * this.driftRadius, c.y + this.driftHeight, c.z + Math.cos(this.driftAngle) * this.driftRadius);
    this.look.set(c.x, c.y + this.driftLook, c.z);
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
