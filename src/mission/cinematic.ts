/**
 * Cinematic camera context handed to `z.cinematic(id, body)` bodies, plus the framing maths behind its helpers.
 * Authored poses given to cut/move are used exactly as written; poses computed by the helpers (twoShot, shot)
 * are pulled in toward their subject when geometry is in the way, so a helper never puts the lens in a wall.
 */
import type { CamPose, CineCtx, EaseName, Game, Routine, Vec3Like } from '@/core/api';
import { DEG } from '@/core/mathx';

export interface TwoShotOpts { side?: 1 | -1; distance?: number; height?: number; fov?: number }
export interface ShotOpts { yawDeg?: number; distance?: number; height?: number; lookHeight?: number; fov?: number }

const EYE = 1.5;
/** horizontal shift of the look point as a fraction of the camera→subject distance: moves the subject from the
 *  centre onto a third line at the default lens (tan of one sixth of a ~62° horizontal field) */
const THIRDS_SHIFT = 0.18;
const CAM_PROBE_RADIUS = 0.25;
const MIN_PULL_FRACTION = 0.2;

/**
 * Over-the-shoulder two-shot: camera behind `over` on `side`, looking past the shoulder at `subject`.
 * Positions are feet positions; the result frames eye level with the subject on the far third.
 */
export function twoShotPose(subject: Vec3Like, over: Vec3Like, opts: TwoShotOpts = {}): CamPose {
  const side = opts.side === -1 ? -1 : 1;
  const back = opts.distance ?? 1.7;
  const height = opts.height ?? 1.62;
  let dx = subject.x - over.x;
  let dz = subject.z - over.z;
  let len = Math.hypot(dx, dz);
  if (len < 1e-4) {
    dx = 0;
    dz = -1;
    len = 1;
  }
  dx /= len;
  dz /= len;
  // right of the over→subject direction (engine convention: forward (fx,fz) → right (−fz, fx))
  const rx = -dz;
  const rz = dx;
  const pos = {
    x: over.x - dx * back + rx * side * 0.62,
    y: over.y + height,
    z: over.z - dz * back + rz * side * 0.62,
  };
  const camToSubject = len + back;
  const shift = THIRDS_SHIFT * camToSubject * side;
  // aim toward the shoulder side of the subject, so the subject sits on the opposite third
  const look = {
    x: subject.x - rx * shift * 0.5,
    y: subject.y + EYE,
    z: subject.z - rz * shift * 0.5,
  };
  return { pos, look, fov: opts.fov ?? 38 };
}

/**
 * Single shot of `subject` (feet position). `yawDeg` = compass bearing of the camera seen from the subject in
 * plan degrees (0 = camera to the north, 90 = east). World mapping: north = −Z, east = +X.
 */
export function shotPose(subject: Vec3Like, opts: ShotOpts = {}): CamPose {
  const yaw = (opts.yawDeg ?? 180) * DEG;
  const dist = opts.distance ?? 3.2;
  const pos = {
    x: subject.x + Math.sin(yaw) * dist,
    y: subject.y + (opts.height ?? 1.55),
    z: subject.z - Math.cos(yaw) * dist,
  };
  const look = { x: subject.x, y: subject.y + (opts.lookHeight ?? 1.45), z: subject.z };
  return { pos, look, fov: opts.fov ?? 40 };
}

/** Pull `pose.pos` toward `pose.look` until a camera-sized sphere fits (no-op with stub physics). */
export function pullIn(game: Game, pose: CamPose): CamPose {
  const f = game.physics.sweepSphere(pose.look, pose.pos, CAM_PROBE_RADIUS);
  if (typeof f !== 'number' || !Number.isFinite(f) || f >= 0.999) return pose;
  const k = Math.max(MIN_PULL_FRACTION, f);
  return {
    ...pose,
    pos: {
      x: pose.look.x + (pose.pos.x - pose.look.x) * k,
      y: pose.look.y + (pose.pos.y - pose.look.y) * k,
      z: pose.look.z + (pose.pos.z - pose.look.z) * k,
    },
  };
}

export class CineCtxImpl implements CineCtx {
  constructor(
    private readonly game: Game,
    private readonly isSkipping: () => boolean,
  ) {}

  get skipping(): boolean {
    return this.isSkipping();
  }

  cut(pose: CamPose): void {
    this.game.camera.cine.cut(pose);
  }

  *move(pose: CamPose, seconds: number, ease?: EaseName): Routine {
    const cine = this.game.camera.cine;
    if (this.isSkipping() || !(seconds > 0)) {
      cine.cut(pose);
      return;
    }
    cine.move(pose, seconds, ease);
    yield seconds;
    if (this.isSkipping()) cine.finish();
  }

  moveAsync(pose: CamPose, seconds: number, ease?: EaseName): void {
    const cine = this.game.camera.cine;
    if (this.isSkipping() || !(seconds > 0)) cine.cut(pose);
    else cine.move(pose, seconds, ease);
  }

  twoShot(subject: Vec3Like, over: Vec3Like, opts?: TwoShotOpts): void {
    this.game.camera.cine.cut(pullIn(this.game, twoShotPose(subject, over, opts)));
  }

  shot(subject: Vec3Like, opts?: ShotOpts): void {
    this.game.camera.cine.cut(pullIn(this.game, shotPose(subject, opts)));
  }

  drift(opts: { around: Vec3Like; radius?: number; yawRate?: number; height?: number; lookHeight?: number }): void {
    if (this.isSkipping()) return;
    this.game.camera.cine.drift(opts);
  }

  dof(focusDistance: number | null, strength = 0.6): void {
    this.game.render.setDof(focusDistance == null || !(focusDistance > 0) ? null : { focusDistance, strength });
  }

  letterbox(on: boolean): void {
    this.game.ui.letterbox(!!on);
  }
}
