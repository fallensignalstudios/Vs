/**
 * Camera + Input contract — OWNER: camera-input (src/render/camera.ts, src/core/input.ts).
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

export type ButtonAction =
  | 'attack'      // LMB / X      — light melee; fires when aiming
  | 'heavy'       // F / Y        — heavy attack; also confirms Resonance windows
  | 'guard'       // Q or Mouse4 / LB — hold guard, timed = counter (Tarrik) / deflect (Selene)
  | 'aim'         // RMB / LT     — hold to aim ranged weapon
  | 'dodge'       // Space / A
  | 'sprint'      // Shift / L3
  | 'interact'    // E / B        — press or hold
  | 'ability1'    // 1 / RB
  | 'ability2'    // 2 / RT+RB (or D-pad right)
  | 'lockOn'      // Tab or MMB / R3
  | 'scan'        // V / D-pad up — tactical read (links, sources, weak points)
  | 'reload'      // R / X(hold)
  | 'swapShoulder'// C / D-pad left
  | 'pause'       // Esc / Start
  | 'skip'        // hold Enter or Space / hold B — skip cinematic
  | 'confirm' | 'cancel' | 'menuUp' | 'menuDown' | 'menuLeft' | 'menuRight';

export type InputContext = 'game' | 'menu' | 'cinematic';

export interface VirtualInput {
  /** x: strafe right (+1), y: forward (+1) — camera relative, same as real input */
  setMove(x: number, y: number): void;
  /** absolute world-space move direction override (ignores camera); null = use setMove */
  setMoveWorld(dir: { x: number; z: number } | null): void;
  /** look delta in radians applied this frame */
  addLook(dyaw: number, dpitch: number): void;
  /** press for one frame */
  press(a: ButtonAction): void;
  hold(a: ButtonAction, down: boolean): void;
  clear(): void;
  /** true while any virtual input is being supplied (autoplay) */
  active: boolean;
}

export interface InputSystem {
  /** camera-relative move intent, |v| <= 1. y = forward. */
  readonly move: { x: number; y: number };
  /** If set (autoplay), absolute world-space move direction (unit) that bypasses the camera basis. */
  readonly moveWorld: { x: number; z: number } | null;
  /** look delta for this frame in radians (already scaled by sensitivity / invert settings) */
  readonly look: { x: number; y: number };
  readonly device: 'kbm' | 'gamepad';
  readonly pointerLocked: boolean;
  readonly virtual: VirtualInput;

  down(a: ButtonAction): boolean;
  /** went down this tick */
  pressed(a: ButtonAction): boolean;
  released(a: ButtonAction): boolean;
  /** seconds the action has been held (0 if up) */
  heldTime(a: ButtonAction): number;
  /** swallow a press so later consumers this tick do not see it */
  consume(a: ButtonAction): void;

  /** Short glyph text for prompts: "E", "LMB", "Space", "A", "LB"… depends on the active device. */
  glyph(a: ButtonAction): string;

  setContext(ctx: InputContext): void;
  readonly context: InputContext;
  /** Pointer lock is requested on canvas click while in 'game' context; falls back to drag-look if denied. */
  requestPointerLock(): void;
  exitPointerLock(): void;
  rumble(strong: number, weak: number, ms: number): void;

  /** Called first in every tick. Latches pressed/released edges for this tick. */
  update(dt: number): void;
}

// ---------------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------------

export interface CamPose {
  pos: Vec3Like;
  look: Vec3Like;
  /** vertical FOV degrees (default: keep current) */
  fov?: number;
  /** roll in degrees */
  roll?: number;
}

export type EaseName = 'linear' | 'inOut' | 'in' | 'out' | 'inOutCubic' | 'outCubic' | 'outExpo';

export interface CameraFollowTarget {
  /** world position of the feet */
  pos: THREE.Vector3;
  /** eye/shoulder height above feet */
  height: number;
  /** facing yaw, used by snapBehind() */
  yaw?: number;
}

export interface CinematicCamera {
  /** Enter cinematic mode (if not already) and cut to the pose. */
  cut(pose: CamPose): void;
  /** Non-blocking eased move from the current pose; check `moving`. */
  move(pose: CamPose, seconds: number, ease?: EaseName): void;
  /** Slow orbital drift around a point for conversation shots. Non-blocking, runs until next cut/move/release. */
  drift(opts: { around: Vec3Like; radius?: number; yawRate?: number; height?: number; lookHeight?: number }): void;
  /** Keep the look-at locked onto a moving target while position is cut/moved independently. null clears. */
  track(target: (() => Vec3Like) | null): void;
  /** Subtle handheld sway amount 0..1 (0 = locked off). */
  handheld(amount: number): void;
  readonly moving: boolean;
  /** finish the current move instantly (used by cinematic skip) */
  finish(): void;
}

export interface CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly mode: 'follow' | 'cinematic' | 'free';
  /** follow-orbit angles (radians). yaw follows the same convention as actors. */
  yaw: number;
  pitch: number;

  setTarget(target: CameraFollowTarget | null): void;
  /** over-the-shoulder aim framing */
  setAim(active: boolean): void;
  /** soft lock-on: frame both the player and this point. null clears. */
  setLockOn(target: (() => Vec3Like) | null): void;
  setShoulder(side: 1 | -1): void;
  /** instantly place the follow camera behind the target (after teleports / handoffs) */
  snapBehind(yaw?: number): void;

  /** Trauma-style shake. amplitude ~0..1. Honours settings.reduceShake. */
  shake(amplitude: number, duration?: number): void;
  /** recoil-style impulse (degrees) */
  kick(pitchDeg: number, yawDeg?: number): void;
  /** transient FOV change that eases back */
  fovPunch(deltaDeg: number, seconds?: number): void;

  readonly cine: CinematicCamera;
  /** Leave cinematic mode and blend back to follow over `seconds` (0 = cut). */
  release(seconds?: number): void;

  /** Free debug camera (screenshots). */
  setFree(pose: CamPose | null): void;

  /** Flattened camera forward (unit, y=0) — basis for camera-relative movement. */
  getForward(out: THREE.Vector3): THREE.Vector3;
  getRight(out: THREE.Vector3): THREE.Vector3;
  /** Ray from the camera through the screen centre (aim). */
  getAimRay(outOrigin: THREE.Vector3, outDir: THREE.Vector3): void;
  /** Project a world point to CSS pixels. Returns false if behind the camera. */
  worldToScreen(p: Vec3Like, out: { x: number; y: number }): boolean;

  /** Called after actors moved, before render. `dt` is real seconds. */
  update(dt: number): void;
}
