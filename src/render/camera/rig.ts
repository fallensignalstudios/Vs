/**
 * CameraRigImpl — owns the PerspectiveCamera and composes the layers:
 *   follow (orbit / aim / lock-on / collision)  ⟷  cinematic  ⟷  free debug pose
 *   → blend (cinematic release, target hand-over glide) → feel (shake, kick, FOV punch, breathing) → camera.
 */
import * as THREE from 'three';
import { RAY_SHOT, RAY_SIGHT } from '@/core/api';
import type { ButtonAction, CamPose, CameraFollowTarget, CameraRig, FollowFraming, Game, Vec3Like } from '@/core/api';
import { DEG, EASE, clamp, smoothstep, wrapAngle } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { CinematicImpl, type CinematicHost } from './cinematic';
import { CameraFeel } from './feel';
import { FOLLOW, FollowCamera, RECENTRE_ASSIST, RECENTRE_GENTLE, RECENTRE_OFF, type FollowInput, type FollowWorld } from './follow';
import { Pose, isFiniteVec, quatLookAt } from './pose';

const NEAR = 0.1;
const FAR = 6000;
/** hand-over glide when the follow target changes to another body */
const TARGET_GLIDE = 0.85;
const DEFAULT_RELEASE = 0.6;
/**
 * What the camera collides with: everything opaque plus everything physical you can see through (glass,
 * energy barriers). Invisible move-only blockers are skipped — nothing is visibly there to push the camera.
 */
const CAMERA_MASK = RAY_SIGHT | RAY_SHOT;
/** FOV and composition are authored for 16:9; narrower windows keep that horizontal view (up to this vFOV) */
const WIDE = 16 / 9;
const MAX_VFOV = 100;
const TAN_REF = Math.tan(FOLLOW.fov * DEG * 0.5);
/** the followed figure fades between these distances from the camera to its body axis */
const FADE_NEAR = 0.28;
const FADE_FAR = 0.6;
/** inputs that mean "the player is fighting": auto-recentre stays out of the way while (and just after) held */
const COMBAT: readonly ButtonAction[] = ['attack', 'heavy', 'guard', 'dodge', 'aim', 'ability1', 'ability2'];
/** phases in which Game runs the simulation: authored camera time follows the simulation clock there */
const SIM_PHASES = new Set<string>(['playing', 'dead', 'complete']);

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
  /** the blend path has not been checked against the world yet */
  private blendUnchecked = false;
  private fade = 1;
  private lastSimNow = NaN;
  private disposed = false;
  private readonly offs: Array<() => void> = [];

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

  private readonly followInput: FollowInput = { lookX: 0, lookY: 0, recentre: RECENTRE_OFF, absolute: false, busy: false, simDt: 0 };
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
        const k = this.game.physics.sweepSphere(from, to, radius, CAMERA_MASK) as unknown;
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
      const onResize = (): void => {
        this.viewDirty = true;
      };
      window.addEventListener('resize', onResize);
      this.offs.push(() => window.removeEventListener('resize', onResize));
    }
    // A zone load is a hard cut: nothing from the previous space may carry over — shake, recoil, a blend, the
    // lock-on closure (its actor is about to be freed), aim, a guided turn, or a framing authored for that space.
    const off = game.events.on('zone:loading', () => {
      this.feel.reset();
      this.blendT = 1;
      this.follow.setFraming(null, 0);
      this.follow.resetScene();
    });
    if (typeof off === 'function') this.offs.push(off);
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

  get playerFade(): number {
    return this.fade;
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.follow.setTarget(null);
    this.follow.setLockOn(null);
    this.cine.exit();
    this.camera.removeFromParent();
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
    // The simulation's substeps are over: button edges are readable by frame-level code again.
    if (typeof input.endSim === 'function') input.endSim();
    // Two clocks. `d` is real time: shake, recoil and breathing never freeze. `sim` is simulated time (0 when
    // paused, loading or in hit-stop, scaled in slow-motion): authored motion — cinematic moves, blends back
    // to gameplay, guided turns — stays in step with the scripts, voice and animation that run on it.
    const sim = this.simDelta(d);
    const frozen = sim === 0 && this.isSuspended();

    // Shoulder swap is camera-owned unless someone consumed the press or set the side explicitly this tick.
    if (mode === 'follow' && !this.shoulderSetExternally && this.takeSwap()) {
      this.follow.side = this.follow.side === 1 ? -1 : 1;
    }
    this.shoulderSetExternally = false;

    // Follow keeps tracking even under a cinematic so release() has a live pose to return to.
    const fi = this.followInput;
    const takesLook = mode === 'follow';
    fi.lookX = takesLook ? num(input.look.x) : 0;
    fi.lookY = takesLook ? num(input.look.y) : 0;
    // Auto-recentre by device: never with a captured mouse; gentle on a pad (and for bots); firmer when the
    // only ways to look are a drag or the arrow keys.
    const pad = input.device === 'gamepad';
    const bot = input.virtual.active === true;
    fi.recentre = bot || pad ? RECENTRE_GENTLE : input.pointerLocked === true ? RECENTRE_OFF : RECENTRE_ASSIST;
    fi.absolute = !!input.moveWorld && !isStub(input.moveWorld);
    fi.busy = false;
    for (let i = 0; i < COMBAT.length; i++) if (input.down(COMBAT[i]) === true) fi.busy = true;
    fi.simDt = sim;
    const physics = game.physics;
    const solid = !isStub(physics);
    this.world.sweep = solid ? this.sweepFn : null;
    this.world.ground = solid ? this.groundFn : null;
    // while the game is paused the follow camera holds still (dt 0), so nothing has drifted when play resumes
    this.follow.update(frozen ? 0 : d, fi, this.world);

    if (this.free) {
      this.base.copy(this.freePose);
    } else if (this.cine.active) {
      this.cine.update(sim, reduce ? 0.3 : 1);
      this.base.copy(this.cine.out);
    } else if (this.blendT < 1) {
      if (this.blendUnchecked) this.checkBlend();
      this.blendT = this.blendDur > 0 ? Math.min(1, this.blendT + sim / this.blendDur) : 1;
      if (this.blendT >= 1) this.base.copy(this.follow.out);
      else {
        this.base.mix(this.blendFrom, this.follow.out, EASE.inOutCubic(this.blendT));
        this.keepBlendClear();
      }
    } else {
      this.base.copy(this.follow.out);
    }
    this.fade = this.figureFade();

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
    this.blendUnchecked = this.blendT < 1;
  }

  /**
   * A blend flies the camera in a straight line from the shot (or the previous hero) to the follow pose. If
   * the world is in the way, that would be a trip through a wall: cut instead.
   */
  private checkBlend(): void {
    this.blendUnchecked = false;
    if (!this.world.sweep || !this.follow.hasTarget) return;
    const k = this.world.sweep(this.blendFrom.pos, this.follow.out.pos, 0.2);
    if (k !== null && k < 0.97) this.blendT = 1;
  }

  /** The follow pose moves during a blend; if the path closes mid-way, stop at the obstacle on the follow side. */
  private keepBlendClear(): void {
    if (!this.world.sweep) return;
    const to = this.follow.out.pos;
    const k = this.world.sweep(to, this.base.pos, 0.2);
    if (k !== null && k < 1 && k > 1e-3) this.base.pos.lerpVectors(to, this.base.pos, k);
  }

  /** the swap press, claimed so the player controller cannot also act on it */
  private takeSwap(): boolean {
    const input = this.game.input;
    if (typeof input.take === 'function') return input.take('swapShoulder') === true;
    return input.pressed('swapShoulder') === true;
  }

  /** paused or loading: authored motion AND the follow camera stand still */
  private isSuspended(): boolean {
    const game = this.game;
    if (game.paused === true) return true;
    const mission = game.mission;
    return !!mission && !isStub(mission) && mission.loading === true;
  }

  /**
   * Simulated seconds since the last update. Where the host runs a simulation clock (Game.time.now during
   * play) this is exactly how far it advanced, so hit-stop and slow-motion are honoured; elsewhere (title
   * screen, sandboxes without a clock) it is real time, and it is 0 whenever the game is paused or loading.
   */
  private simDelta(d: number): number {
    if (this.isSuspended()) return 0;
    const game = this.game;
    const time = game.time;
    const now = time && !isStub(time) ? time.now : NaN;
    if (typeof now !== 'number' || !Number.isFinite(now)) return d;
    const prev = this.lastSimNow;
    this.lastSimNow = now;
    if (!SIM_PHASES.has(game.phase as string)) return d;
    const step = now - prev;
    // first frame, a rewound clock or a jump (checkpoint reload): fall back to real time for this frame
    return step >= 0 && step <= d * 1.5 + 1e-4 ? step : d;
  }

  /**
   * Opacity for the followed figure: 1 normally, falling to 0 as the camera closes on the body (squeezed into
   * a corner) so the hero never fills the frame or crosses the near plane.
   */
  private figureFade(): number {
    const t = this.follow.targetRef;
    if (!t || this.free || !isFiniteVec(t.pos)) return 1;
    const p = this.base.pos;
    const top = this.follow.headPoint.y + 0.4 - t.pos.y;
    const y = clamp(p.y - t.pos.y, 0, top > 0 ? top : 0);
    const dist = Math.hypot(p.x - t.pos.x, p.y - (t.pos.y + y), p.z - t.pos.z);
    return smoothstep(FADE_NEAR, FADE_FAR, dist);
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
        // Shake and breathing are scaled by the zoom so they cover the same share of the SCREEN at any FOV
        // (a 1.3° shake reads a third larger through the 48° aim lens); recoil stays in true degrees.
        const zoom = Math.tan(clamp(base.fov, 5, 140) * DEG * 0.5) / TAN_REF;
        const pitch = (feel.pitch - feel.kickPitch) * zoom + feel.kickPitch;
        const yaw = (feel.yaw - feel.kickYaw) * zoom + feel.kickYaw;
        cam.quaternion.multiply(this.tmpQ.setFromEuler(this.tmpE.set(pitch, yaw, feel.roll * zoom, 'YXZ')));
      }
      if (feel.x !== 0 || feel.y !== 0) cam.position.add(this.tmpV2.set(feel.x, feel.y, 0).applyQuaternion(base.quat));
      fov += feel.fov;
    }
    fov = clamp(fov, 5, 140);
    const aspect = this.viewW / this.viewH;
    // Narrow windows (4:3, portrait, a tall iframe): hold the 16:9 horizontal view instead of cropping it away.
    if (aspect < WIDE - 1e-6) fov = Math.min(Math.max(fov, MAX_VFOV), 2 * Math.atan(Math.tan(fov * DEG * 0.5) * (WIDE / aspect)) / DEG);
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
