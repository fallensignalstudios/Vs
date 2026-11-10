/**
 * Camera + Input contract — OWNER: camera-input (src/render/camera/*, src/core/input/*).
 *
 * ANGLE CONVENTIONS (camera and look input):
 *  - yaw: same as actors — yaw 0 looks toward −Z (north); positive yaw turns LEFT (counter-clockwise from above).
 *  - pitch: positive looks UP. The follow camera clamps pitch to [−55°, +70°].
 *  - `InputSystem.look` / `VirtualInput.addLook` are deltas in that same space: the follow camera does
 *    `yaw += look.x; pitch += look.y`. Mouse-right therefore produces a NEGATIVE look.x.
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
  /** press for one frame (the next input tick) */
  press(a: ButtonAction): void;
  hold(a: ButtonAction, down: boolean): void;
  /** drop every virtual move / hold / press and un-pin `active` */
  clear(): void;
  /**
   * true while any virtual input is being supplied (autoplay). Reads true automatically while a move / hold is
   * set and for ~0.5 s after a press()/addLook(); a bot may also pin it with `active = true` (clear() un-pins).
   */
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
  /**
   * ADDED. Duration (s) of the most recently completed hold of `a` — read it on the tick `released(a)` is true
   * (tap vs hold, charge release). Stays valid until the action is released again.
   */
  lastHeldTime(a: ButtonAction): number;

  /** Short glyph text for prompts: "E", "LMB", "Space", "A", "LB"… depends on the active device. */
  glyph(a: ButtonAction): string;
  /** ADDED. Glyph for a specific device regardless of which one is active (controls reference screens). */
  glyphFor(a: ButtonAction, device: 'kbm' | 'gamepad'): string;
  /**
   * ADDED. How the camera is being turned right now — for look hints:
   * 'locked' pointer-lock mouse look · 'drag' no pointer lock (hold RMB and move the mouse, or use the arrow
   * keys) · 'stick' gamepad right stick.
   */
  readonly lookMode: 'locked' | 'drag' | 'stick';
  /** ADDED. true while a gamepad is connected (it becomes the active `device` on its first input). */
  readonly gamepadConnected: boolean;

  /**
   * Switch context (takes effect immediately, mid-tick safe):
   *  - 'game': every action is readable (gameplay + skip / confirm / cancel / menu*).
   *  - 'menu': only confirm / cancel / menuUp|Down|Left|Right / pause; `move`, `look` and gameplay actions read 0.
   *    Held menu directions re-fire `pressed` (0.42 s delay, then every 0.13 s).
   *  - 'cinematic': only skip / pause.
   * A physical key never acts in two contexts: presses latched on the switching tick are swallowed and anything
   * held must be released first — except sprint / aim / guard, which resume (without a `pressed` edge) when
   * returning to 'game'. Because a switch can hide a held action, poll `down()` for holds rather than waiting
   * for `released()`. Virtual holds are exempt.
   */
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
  /** roll in degrees (default 0 = level; positive tilts the horizon clockwise on screen) */
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

/**
 * ADDED. Authored override of the follow framing for a space or a fight (wide vista, tight corridor, elite arena).
 * Omitted fields keep the default (distance 3.4, shoulder 0.55, fov 62, heightOffset 0). Aim framing is unaffected.
 */
export interface FollowFraming {
  /** camera distance behind the pivot (m) */
  distance?: number;
  /** lateral shoulder offset (m) */
  shoulder?: number;
  /** vertical FOV (degrees) */
  fov?: number;
  /** added to the target's `height` (m) */
  heightOffset?: number;
}

export interface CinematicCamera {
  /** Enter cinematic mode (if not already) and cut to the pose. */
  cut(pose: CamPose): void;
  /** Non-blocking eased move from the current pose; check `moving`. */
  move(pose: CamPose, seconds: number, ease?: EaseName): void;
  /**
   * Slow orbital drift around a point for conversation shots. Non-blocking, runs until next cut/move/release.
   * The orbit starts at the camera's current bearing from `around`. `radius` and `height` (above `around`)
   * default to the current shot's when called after a cut/move (else 4 m / 1.6 m); `lookHeight` (above
   * `around`) defaults to 1.4; `yawRate` is rad/s (default 0.06, sign = direction).
   */
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
  /** follow-orbit angles (radians). yaw follows the same convention as actors; positive pitch looks up. */
  yaw: number;
  pitch: number;
  /** ADDED. current shoulder side (+1 right, −1 left). The rig toggles it on 'swapShoulder' unless consumed. */
  readonly shoulder: 1 | -1;
  /** ADDED. true while aim framing is requested (setAim). */
  readonly aiming: boolean;
  /**
   * ADDED. Current distance (m) from the camera to the follow pivot after collision. Fade the player figure
   * when this drops below ~0.9; skip this far along getAimRay() to start a shot trace past the player.
   */
  readonly targetDistance: number;

  setTarget(target: CameraFollowTarget | null): void;
  /** over-the-shoulder aim framing */
  setAim(active: boolean): void;
  /** soft lock-on: frame both the player and this point. null clears. */
  setLockOn(target: (() => Vec3Like) | null): void;
  setShoulder(side: 1 | -1): void;
  /** instantly place the follow camera behind the target (after teleports / handoffs) */
  snapBehind(yaw?: number): void;
  /** ADDED. Turn the follow orbit so the camera looks at a world point (bots, scripted "look there" beats). */
  aimAt(point: Vec3Like): void;
  /** ADDED. Override the follow framing, eased over `blendSeconds` (default 1). null restores the defaults. */
  setFraming(framing: FollowFraming | null, blendSeconds?: number): void;

  /** Trauma-style shake. amplitude ~0..1. Honours settings.reduceShake. */
  shake(amplitude: number, duration?: number): void;
  /** recoil-style impulse (degrees) */
  kick(pitchDeg: number, yawDeg?: number): void;
  /** transient FOV change that eases back */
  fovPunch(deltaDeg: number, seconds?: number): void;

  readonly cine: CinematicCamera;
  /** Leave cinematic mode and blend back to follow over `seconds` (0 = cut; default 0.6). */
  release(seconds?: number): void;

  /** Free debug camera (screenshots). */
  setFree(pose: CamPose | null): void;

  /** Flattened camera forward (unit, y=0) — basis for camera-relative movement. */
  getForward(out: THREE.Vector3): THREE.Vector3;
  getRight(out: THREE.Vector3): THREE.Vector3;
  /** Ray from the camera through the screen centre (aim). Includes recoil kick, excludes shake. */
  getAimRay(outOrigin: THREE.Vector3, outDir: THREE.Vector3): void;
  /**
   * Project a world point to CSS pixels of `game.canvas`. Returns false if behind the camera; `out` is then
   * placed outside the frame on the side the point is on, so clamping it to the viewport edge gives a correct
   * off-screen indicator.
   */
  worldToScreen(p: Vec3Like, out: { x: number; y: number }): boolean;

  /** Called after actors moved, before render. `dt` is real seconds. */
  update(dt: number): void;
}
