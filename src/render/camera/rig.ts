/**
 * CameraRigImpl — owns the PerspectiveCamera and composes the layers:
 *   follow (orbit / aim / lock-on / collision)  ⟷  cinematic  ⟷  free debug pose
 *   → blend (cinematic release, target hand-over glide) → feel (shake, kick, FOV punch, breathing) → camera.
 */
import * as THREE from 'three';
import type { CamPose, CameraFollowTarget, CameraRig, FollowFraming, Game, Vec3Like } from '@/core/api';
import { EASE, clamp, wrapAngle } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { CinematicImpl, type CinematicHost } from './cinematic';
import { CameraFeel } from './feel';
import { FOLLOW, FollowCamera, type FollowInput, type FollowWorld } from './follow';
import { Pose, isFiniteVec, quatLookAt } from './pose';

const NEAR = 0.1;
const FAR = 6000;
/** hand-over glide when the follow target changes to another body */
const TARGET_GLIDE = 0.85;
const DEFAULT_RELEASE = 0.6;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export class CameraRigImpl implements CameraRig, CinematicHost {
  readonly camera: THREE.PerspectiveCamera;
  readonly cine: CinematicImpl;

  private readonly follow = new FollowCamera();
  private readonly feel = new CameraFeel();
  /** resolved pose before feel offsets */
  private readonly base = new Pose();
  private readonly blendFrom = new Pose();
  private blendT = 1;
  private blendDur = 0;
  /** a release blend survives snapBehind; a hand-over glide does not */
  private blendIsRelease = false;

  private readonly freePose = new Pose();
  private free = false;

  private viewW = 1280;
  private viewH = 720;
  private viewDirty = true;
  private viewAge = 0;
  private shoulderSetExternally = false;
  private worldWarned = false;
  private lastFov = -1;
  private lastAspect = -1;

  private readonly followInput: FollowInput = { lookX: 0, lookY: 0, assisted: false };
  private readonly world: FollowWorld = { sweep: null, ground: null };
  private readonly sweepFn: NonNullable<FollowWorld['sweep']>;
  private readonly groundFn: NonNullable<FollowWorld['ground']>;

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly aimQuat = new THREE.Quaternion();

  constructor(private readonly game: Game) {
    this.camera = new THREE.PerspectiveCamera(FOLLOW.fov, 16 / 9, NEAR, FAR);
    this.camera.name = 'gameCamera';
    this.camera.rotation.order = 'YXZ';
    this.cine = new CinematicImpl(this);
    this.base.copy(this.follow.out);

    // World queries are defensive: a bad answer (or a throw) from physics degrades to "no collision" for that
    // query instead of freezing the camera.
    this.sweepFn = (from, to, radius) => {
      try {
        const k = this.game.physics.sweepSphere(from, to, radius) as unknown;
        return typeof k === 'number' && Number.isFinite(k) ? k : null;
      } catch (err) {
        this.warnWorld(err);
        return null;
      }
    };
    this.groundFn = (x, z, yRef) => {
      try {
        const hit = this.game.physics.groundAt(x, z, yRef, 0) as unknown;
        if (!hit || isStub(hit)) return null;
        const y = (hit as { y?: unknown }).y;
        return typeof y === 'number' && Number.isFinite(y) ? y : null;
      } catch (err) {
        this.warnWorld(err);
        return null;
      }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => {
        this.viewDirty = true;
      });
    }
    // A zone load is a hard cut: nothing from the previous space (shake, recoil, a blend) may carry over.
    game.events.on('zone:loading', () => {
      this.feel.reset();
      this.blendT = 1;
      this.follow.snap();
    });
    const scene = game.scene as THREE.Scene | undefined;
    if (scene && (scene as { isScene?: boolean }).isScene === true) scene.add(this.camera);
    this.refreshViewport();
    this.apply(0);
  }

  // -------------------------------------------------------------------------------------------
  // state
  // -------------------------------------------------------------------------------------------

  get mode(): 'follow' | 'cinematic' | 'free' {
    return this.free ? 'free' : this.cine.active ? 'cinematic' : 'follow';
  }

  get yaw(): number {
    return this.follow.yaw;
  }

  set yaw(v: number) {
    if (Number.isFinite(v)) this.follow.yaw = wrapAngle(v);
  }

  get pitch(): number {
    return this.follow.pitch;
  }

  set pitch(v: number) {
    if (Number.isFinite(v)) this.follow.pitch = clamp(v, FOLLOW.pitchMin, FOLLOW.pitchMax);
  }

  get shoulder(): 1 | -1 {
    return this.follow.side;
  }

  get aiming(): boolean {
    return this.follow.aim;
  }

  get targetDistance(): number {
    return this.follow.distance;
  }

  /** combined shake trauma 0..1 (exactly 0 when no shake is running) */
  get trauma(): number {
    return this.feel.trauma;
  }

  /** true while blending back from a cinematic or gliding to a new target */
  get blending(): boolean {
    return this.blendT < 1;
  }

  // -------------------------------------------------------------------------------------------
  // follow controls
  // -------------------------------------------------------------------------------------------

  setTarget(target: CameraFollowTarget | null): void {
    const prev = this.follow.targetRef;
    if (target === prev) return;
    const glide = !!prev && !!target && isFiniteVec(target.pos) && !this.cine.active && !this.free;
    this.follow.setTarget(target);
    if (glide) this.startBlend(TARGET_GLIDE, false);
  }

  setAim(active: boolean): void {
    this.follow.aim = !!active;
  }

  setLockOn(target: (() => Vec3Like) | null): void {
    this.follow.setLockOn(target);
  }

  setShoulder(side: 1 | -1): void {
    this.follow.side = side < 0 ? -1 : 1;
    this.shoulderSetExternally = true;
  }

  snapBehind(yaw?: number): void {
    const t = this.follow.targetRef;
    const y = Number.isFinite(yaw) ? (yaw as number) : t && Number.isFinite(t.yaw) ? (t.yaw as number) : this.follow.yaw;
    this.follow.yaw = wrapAngle(y);
    this.follow.pitch = FOLLOW.pitchRest;
    this.follow.snap();
    if (!this.blendIsRelease) this.blendT = 1;
  }

  aimAt(point: Vec3Like, seconds = 0): void {
    this.follow.aimAt(point, seconds);
  }

  setFraming(framing: FollowFraming | null, blendSeconds = 1): void {
    this.follow.setFraming(framing && typeof framing === 'object' ? framing : null, blendSeconds);
  }

  // -------------------------------------------------------------------------------------------
  // feel
  // -------------------------------------------------------------------------------------------

  shake(amplitude: number, duration?: number): void {
    this.feel.shake(amplitude, duration);
  }

  kick(pitchDeg: number, yawDeg?: number): void {
    this.feel.kick(pitchDeg, yawDeg);
  }

  fovPunch(deltaDeg: number, seconds?: number): void {
    this.feel.fovPunch(deltaDeg, seconds);
  }

  // -------------------------------------------------------------------------------------------
  // cinematic / free
  // -------------------------------------------------------------------------------------------

  release(seconds: number = DEFAULT_RELEASE): void {
    if (!this.cine.active) return;
    this.cine.exit();
    // blends from the shot as authored right now — correct even when it was cut earlier this same tick
    this.startBlend(Number.isFinite(seconds) ? seconds : DEFAULT_RELEASE, true);
    if (!this.follow.hasTarget) this.follow.out.copy(this.blendFrom); // nothing to return to: hold the shot
  }

  setFree(pose: CamPose | null): void {
    if (!pose) {
      this.free = false;
      return;
    }
    if (!isFiniteVec(pose.pos) || !isFiniteVec(pose.look)) {
      console.warn('[camera] setFree ignored: pose needs finite pos and look');
      return;
    }
    this.freePose.pos.copy(pose.pos as THREE.Vector3);
    quatLookAt(this.freePose.quat, pose.pos, pose.look, num(pose.roll));
    this.freePose.fov = Number.isFinite(pose.fov) ? clamp(pose.fov as number, 5, 140) : this.free ? this.freePose.fov : this.base.fov;
    this.free = true;
    // Debug callers screenshot right away: make the pose visible without waiting for a tick.
    this.base.copy(this.freePose);
    this.apply(0);
  }

  // --- CinematicHost ---
  currentPose(): Pose {
    return this.base;
  }

  lookDistance(): number {
    return this.follow.hasTarget ? Math.max(2, this.follow.distance + 2) : 8;
  }

  onCinematicEnter(): void {
    this.blendT = 1;
  }

  // -------------------------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------------------------

  getForward(out: THREE.Vector3): THREE.Vector3 {
    if (this.mode === 'follow' && this.blendT >= 1) {
      return out.set(-Math.sin(this.follow.yaw), 0, -Math.cos(this.follow.yaw));
    }
    out.set(0, 0, -1).applyQuaternion(this.base.quat);
    out.y = 0;
    if (out.lengthSq() < 1e-6) out.set(0, 1, 0).applyQuaternion(this.base.quat).setY(0); // looking straight down: use screen-up
    if (out.lengthSq() < 1e-6) return out.set(0, 0, -1);
    return out.normalize();
  }

  getRight(out: THREE.Vector3): THREE.Vector3 {
    this.getForward(out);
    // right = forward × up
    const fx = out.x;
    return out.set(-out.z, 0, fx);
  }

  getAimRay(outOrigin: THREE.Vector3, outDir: THREE.Vector3): void {
    outOrigin.copy(this.base.pos);
    outDir.set(0, 0, -1).applyQuaternion(this.aimQuat).normalize();
  }

  worldToScreen(p: Vec3Like, out: { x: number; y: number }): boolean {
    if (!isFiniteVec(p)) {
      out.x = this.viewW * 0.5;
      out.y = this.viewH * 0.5;
      return false;
    }
    const cam = this.camera;
    const v = this.tmpV.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    const front = v.z < -NEAR;
    const e = cam.projectionMatrix.elements;
    const depth = Math.max(Math.abs(v.z), 1e-4);
    let nx = (e[0] * v.x) / depth;
    let ny = (e[5] * v.y) / depth;
    if (!front) {
      // Behind the camera: keep the side the point is on and push it outside the frame, so a plain clamp to
      // the viewport edge yields a correct off-screen indicator (dead astern resolves to the bottom edge).
      const m = Math.max(Math.abs(nx), Math.abs(ny));
      if (m < 1e-4) {
        nx = 0;
        ny = -2;
      } else {
        nx *= 2 / m;
        ny *= 2 / m;
      }
    }
    out.x = (nx * 0.5 + 0.5) * this.viewW;
    out.y = (-ny * 0.5 + 0.5) * this.viewH;
    return front;
  }

  /** Override the CSS viewport size (tests / off-DOM use). Normally read from game.canvas. */
  setViewport(width: number, height: number): void {
    if (!(width > 0) || !(height > 0)) return;
    this.viewW = width;
    this.viewH = height;
    this.viewDirty = false;
    this.viewAge = -1e9;
  }

  // -------------------------------------------------------------------------------------------
  // tick
  // -------------------------------------------------------------------------------------------

  update(dt: number): void {
    const d = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.25) : 0;
    this.viewAge += d;
    if (this.viewDirty || this.viewAge > 0.5) this.refreshViewport();

    const game = this.game;
    const input = game.input;
    const mode = this.mode;
    const reduce = game.settings.get('reduceShake') === true;

    // Shoulder swap is camera-owned unless someone consumed the press or set the side explicitly this tick.
    if (mode === 'follow' && !this.shoulderSetExternally && input.pressed('swapShoulder') === true) {
      this.follow.side = this.follow.side === 1 ? -1 : 1;
    }
    this.shoulderSetExternally = false;

    // Follow keeps tracking even under a cinematic so release() has a live pose to return to.
    const fi = this.followInput;
    const takesLook = mode === 'follow';
    fi.lookX = takesLook ? num(input.look.x) : 0;
    fi.lookY = takesLook ? num(input.look.y) : 0;
    fi.assisted = input.device === 'kbm' && input.pointerLocked !== true && input.virtual.active !== true;
    const physics = game.physics;
    const solid = !isStub(physics);
    this.world.sweep = solid ? this.sweepFn : null;
    this.world.ground = solid ? this.groundFn : null;
    this.follow.update(d, fi, this.world);

    if (this.free) {
      this.base.copy(this.freePose);
    } else if (this.cine.active) {
      this.cine.update(d, reduce ? 0.3 : 1);
      this.base.copy(this.cine.out);
    } else if (this.blendT < 1) {
      this.blendT = this.blendDur > 0 ? Math.min(1, this.blendT + d / this.blendDur) : 1;
      if (this.blendT >= 1) this.base.copy(this.follow.out);
      else this.base.mix(this.blendFrom, this.follow.out, EASE.inOutCubic(this.blendT));
    } else {
      this.base.copy(this.follow.out);
    }

    // Breathing: present when exploring, calmer when aiming, off in authored shots and the debug camera.
    const breathing = this.free || this.cine.active ? 0 : this.follow.aim ? 0.45 : 1;
    this.feel.update(d, reduce, breathing);
    this.apply(this.free ? 0 : 1);
  }

  // -------------------------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------------------------

  private warnWorld(err: unknown): void {
    if (this.worldWarned) return;
    this.worldWarned = true;
    console.warn('[camera] physics query failed — camera collision degraded', err);
  }

  private startBlend(seconds: number, isRelease: boolean): void {
    this.blendFrom.copy(isRelease ? this.cine.out : this.base);
    this.blendDur = Math.max(0, seconds);
    this.blendT = this.blendDur > 0 ? 0 : 1;
    this.blendIsRelease = isRelease && this.blendDur > 0;
  }

  /** Write base pose + feel offsets (scaled by `feelK`) to the THREE camera. */
  private apply(feelK: number): void {
    const cam = this.camera;
    const feel = this.feel;
    const base = this.base;
    // Recoil is part of where the player is aiming; shake and breathing are not.
    this.aimQuat.copy(base.quat);
    if (feelK > 0 && (feel.kickPitch !== 0 || feel.kickYaw !== 0)) {
      this.aimQuat.multiply(this.tmpQ.setFromEuler(this.tmpE.set(feel.kickPitch, feel.kickYaw, 0, 'YXZ')));
    }
    cam.quaternion.copy(base.quat);
    cam.position.copy(base.pos);
    let fov = base.fov;
    if (feelK > 0) {
      if (feel.pitch !== 0 || feel.yaw !== 0 || feel.roll !== 0) {
        cam.quaternion.multiply(this.tmpQ.setFromEuler(this.tmpE.set(feel.pitch, feel.yaw, feel.roll, 'YXZ')));
      }
      if (feel.x !== 0 || feel.y !== 0) cam.position.add(this.tmpV2.set(feel.x, feel.y, 0).applyQuaternion(base.quat));
      fov += feel.fov;
    }
    fov = clamp(fov, 5, 140);
    const aspect = this.viewW / this.viewH;
    if (fov !== this.lastFov || aspect !== this.lastAspect) {
      cam.fov = fov;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      this.lastFov = fov;
      this.lastAspect = aspect;
    }
    cam.updateMatrixWorld(true);
  }

  private refreshViewport(): void {
    this.viewDirty = false;
    this.viewAge = 0;
    const c = this.game.canvas as HTMLCanvasElement | undefined;
    if (!c || isStub(c)) return;
    const w = num(c.clientWidth) || num(c.width);
    const h = num(c.clientHeight) || num(c.height);
    if (w > 0 && h > 0) {
      this.viewW = w;
      this.viewH = h;
    }
  }
}
