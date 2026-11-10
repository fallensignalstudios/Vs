/**
 * Virtual input: programmatic controls for the autoplay bot, tests and headless screenshots.
 * Merged with real devices by the input system; works with no DOM events at all.
 */
import type { ButtonAction, VirtualInput } from '@/core/api';
import { ACTION_COUNT, actionIndex } from './actions';

/** seconds `active` stays true after the last one-shot (press / addLook) so pulsed bots read as active */
const ACTIVE_LINGER = 0.5;

export class VirtualInputImpl implements VirtualInput {
  /** held actions */
  readonly holds = new Uint8Array(ACTION_COUNT);
  /** one-frame presses queued for the next tick */
  readonly presses = new Uint8Array(ACTION_COUNT);
  moveX = 0;
  moveY = 0;
  /** world-space override, valid when `hasWorld` */
  readonly world = { x: 0, z: 0 };
  hasWorld = false;
  lookYaw = 0;
  lookPitch = 0;

  private manual = false;
  private linger = 0;
  private holdCount = 0;

  setMove(x: number, y: number): void {
    const fx = Number.isFinite(x) ? x : 0;
    const fy = Number.isFinite(y) ? y : 0;
    const len = Math.hypot(fx, fy);
    const k = len > 1 ? 1 / len : 1;
    this.moveX = fx * k;
    this.moveY = fy * k;
  }

  setMoveWorld(dir: { x: number; z: number } | null): void {
    if (!dir || !Number.isFinite(dir.x) || !Number.isFinite(dir.z)) {
      this.hasWorld = false;
      this.world.x = this.world.z = 0;
      return;
    }
    const len = Math.hypot(dir.x, dir.z);
    const k = len > 1 ? 1 / len : 1;
    this.world.x = dir.x * k;
    this.world.z = dir.z * k;
    this.hasWorld = true;
  }

  addLook(dyaw: number, dpitch: number): void {
    if (Number.isFinite(dyaw)) this.lookYaw += dyaw;
    if (Number.isFinite(dpitch)) this.lookPitch += dpitch;
    this.linger = ACTIVE_LINGER;
  }

  press(a: ButtonAction): void {
    const i = actionIndex(a);
    if (i < 0) return;
    this.presses[i] = 1;
    this.linger = ACTIVE_LINGER;
  }

  hold(a: ButtonAction, down: boolean): void {
    const i = actionIndex(a);
    if (i < 0) return;
    const v = down ? 1 : 0;
    if (this.holds[i] === v) return;
    this.holds[i] = v;
    this.holdCount += down ? 1 : -1;
  }

  clear(): void {
    this.holds.fill(0);
    this.presses.fill(0);
    this.holdCount = 0;
    this.moveX = this.moveY = 0;
    this.hasWorld = false;
    this.world.x = this.world.z = 0;
    this.lookYaw = this.lookPitch = 0;
    this.manual = false;
    this.linger = 0;
  }

  /**
   * True while anything virtual is being supplied. Reads true automatically while a move/hold is set and
   * briefly after one-shots; a bot may also pin it with `active = true` (cleared by `clear()`).
   */
  get active(): boolean {
    return this.manual || this.linger > 0 || this.holdCount > 0 || this.hasWorld || this.moveX !== 0 || this.moveY !== 0;
  }

  set active(v: boolean) {
    this.manual = !!v;
    if (!v) this.linger = 0;
  }

  /** Called by the input system after it consumed this frame's one-shots. */
  endFrame(dt: number): void {
    this.presses.fill(0);
    this.lookYaw = this.lookPitch = 0;
    if (this.linger > 0) this.linger = Math.max(0, this.linger - dt);
  }
}
