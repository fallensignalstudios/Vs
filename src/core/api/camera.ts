/**
 * Camera + Input contract — OWNER: camera-input (src/render/camera/*, src/core/input/*).
 *
 * ANGLE CONVENTIONS (camera and look input):
 *  - yaw: same as actors — yaw 0 looks toward −Z (north); positive yaw turns LEFT (counter-clockwise from above).
 *  - pitch: positive looks UP. The follow camera clamps pitch to [−55°, +70°].
 *  - `InputSystem.look` / `VirtualInput.addLook` are deltas in that same space: the follow camera does
 *    `yaw += look.x; pitch += look.y`. Mouse-right therefore produces a NEGATIVE look.x.
 *
 * READING BUTTON EDGES (pressed / released / take) — the rule for everyone:
 *  - `input.update()` latches edges once per FRAME, but the simulation runs 2–5 substeps per frame below 45 fps.
 *    The input system therefore shows each edge to ONE substep only (the first that asks) and again to
 *    frame-level code after the simulation (camera, UI, flow). `if (input.pressed('lockOn')) toggle()` is
 *    correct at any frame rate; nobody needs to count substeps.
 *  - When several systems could react to the same press (interact vs. dodge-cancel, a prompt vs. the player),
 *    read it with `input.take(a)`: the first taker gets it and it reads false for everyone else that frame.
 *  - A press or release made while the simulation is frozen by hit-stop is not lost: if nobody read it, it is
 *    still reported on the next frames (up to 0.3 s) until the simulation runs again.
 *  - For anything sustained poll `down()` / `engaged()`; a context switch can hide a held action without a
 *    `released()` edge.
 */
import type * as THREE from 'three';
import type { Vec3Like } from './common';

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

/**
 * Actions and their default bindings (keyboard-mouse / gamepad, standard mapping). Implementation notes:
 *  - Gamepad: only pads with the browser's 'standard' mapping are read (throttles, wheels and other HID
 *    devices are ignored); with several pads the one used last is active. RT fires ('attack') only while LT
 *    ('aim') is held; otherwise RT is the modifier that turns RB into 'ability2' (D-pad right also works).
 *    'reload' = D-pad down, or X while aiming (X is 'attack' only when not aiming, so a reload never starts with
 *    a swing). 'scan' = D-pad up or View. 'sprint' = click L3 (latched until the stick relaxes).
 *  - Keyboard: P is a second 'pause' key. confirm = Enter / Space / E, cancel = Esc / Backspace, skip = Enter /
 *    Space (gamepad B). Arrow keys rotate the camera during play and are menu directions in menus.
 *  - Keys are bound by physical position (KeyboardEvent.code): WASD is ZQSD on AZERTY with no setup, and
 *    `glyph()` prints the letter on the player's own layout where the browser exposes it. Gameplay keys can be
 *    moved with `rebind()`.
 *  - Without pointer lock (sandboxed iframe) the right mouse button does two jobs: DRAG it to look, HOLD it
 *    still (~0.15 s) to aim — a look drag never aims. Arrow keys always rotate the camera.
 */
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
  | 'reload'      // R / D-pad down (or X while aiming)
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
  /**
   * If set (autoplay), absolute world-space move direction (unit) that bypasses the camera basis.
   * (A vector shorter than 1 passed to `virtual.setMoveWorld` is kept as a slower walk; longer ones are
   * normalised. While set, `move` reads (0, |moveWorld|).)
   */
  readonly moveWorld: { x: number; z: number } | null;
  /** look delta for this frame in radians (already scaled by sensitivity / invert settings) */
  readonly look: { x: number; y: number };
  readonly device: 'kbm' | 'gamepad';
  readonly pointerLocked: boolean;
  readonly virtual: VirtualInput;

  down(a: ButtonAction): boolean;
  /** went down this tick (shown to one sim substep per frame — see "READING BUTTON EDGES" at the top) */
  pressed(a: ButtonAction): boolean;
  /** went up this tick (same once-per-frame rule as `pressed`) */
  released(a: ButtonAction): boolean;
  /** seconds the action has been held (0 if up) */
  heldTime(a: ButtonAction): number;
  /** swallow a press so later consumers this tick do not see it */
  consume(a: ButtonAction): void;
  /**
   * ADDED. `pressed(a)` and `consume(a)` in one call: true for the first caller this frame, false for everyone
   * after. The way gameplay code should claim a press that more than one system could act on.
   */
  take(a: ButtonAction): boolean;
  /**
   * ADDED. Accessibility-aware hold: identical to `down(a)` normally; with `settings.holdToToggle` on, the
   * action latches instead — press once to engage, press again to release (the latch also clears on a context
   * switch). Use this instead of `down()` for sustained holds (guard, aim, sprint, hold-to-interact) and call
   * `disengage(a)` when the hold has done its job (interaction completed, guard broken).
   */
  engaged(a: ButtonAction): boolean;
  /** ADDED. Clear the press-to-toggle latch of `a` (no-op when not toggling). */
  disengage(a: ButtonAction): void;
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
   * 'locked' pointer-lock mouse look · 'drag' no pointer lock (drag with RMB, or use the arrow keys; holding
   * RMB still aims) · 'stick' gamepad right stick.
   */
  readonly lookMode: 'locked' | 'drag' | 'stick';
  /**
   * ADDED. true while a standard-mapping gamepad is connected. It becomes the active `device` on its first
   * deliberate input (a button press or a stick pushed out from rest — never a resting level), and `device`
   * returns to 'kbm' on any key / mouse input or when the pad is unplugged.
   */
  readonly gamepadConnected: boolean;
  /**
   * ADDED. Call `fn` whenever `device` changes (re-render prompts). Returns an unsubscribe function. Fired from
   * `update()`, at most once per frame.
   */
  onDeviceChange(fn: (device: 'kbm' | 'gamepad') => void): () => void;

  /**
   * ADDED. Move a gameplay action to another physical key (`code` = KeyboardEvent.code, e.g. 'KeyG'). If the key
   * already drives another rebindable action the two swap. Returns false for actions without a keyboard key
   * (attack / aim are mouse buttons), UI actions, and reserved keys (WASD, arrows, Esc, Enter, F-keys,
   * modifiers). Persisted in localStorage; `glyph()` follows.
   */
  rebind(a: ButtonAction, code: string): boolean;
  /** ADDED. The KeyboardEvent.code currently bound to a rebindable action, else null. */
  bindingOf(a: ButtonAction): string | null;
  /** ADDED. Restore the default key bindings. */
  resetBindings(): void;

  /**
   * Switch context (takes effect immediately, mid-tick safe):
   *  - 'game': gameplay actions + pause. skip / confirm / cancel / menu* read false (they share Space, E, Esc
   *    and WASD with gameplay) unless a HUD prompt opts in with `allowInGame`.
   *  - 'menu': only confirm / cancel / menuUp|Down|Left|Right / pause; `move`, `look` and gameplay actions read 0.
   *    Held menu directions re-fire `pressed` (0.42 s delay, then every 0.13 s). Tab is left to the browser so
   *    DOM menus keep keyboard focus traversal.
   *  - 'cinematic': only skip / pause.
   * Pointer lock follows the context: entering 'menu' gives the cursor back, returning to 'game' quietly takes
   * the lock again if it was held (callers need not pair exitPointerLock / requestPointerLock, and an extra
   * exitPointerLock() from a menu changes nothing); 'cinematic' keeps it. exitPointerLock() during play is a
   * deliberate release: the lock then stays off until the next canvas click or requestPointerLock().
   * A physical key never acts in two contexts: presses latched on the switching tick are swallowed and anything
   * held must be released first — except sprint / aim / guard, which resume (without a `pressed` edge) when
   * returning to 'game'. Because a switch can hide a held action, poll `down()` for holds rather than waiting
   * for `released()`. Virtual holds are exempt.
   * DOM note for menus: Enter / Space on a FOCUSED <button>/<a> keeps its native click and is NOT also reported
   * as `confirm` (no double activation); with nothing focused, `confirm` is reported. Typing in form fields is
   * never seen by the game.
   */
  setContext(ctx: InputContext): void;
  readonly context: InputContext;
  /**
   * ADDED. While in the 'game' context, also report these UI actions (skip / confirm / cancel / menu*) — for a
   * HUD-level prompt that must be acknowledged without leaving play. A key already held when the prompt opts in
   * has to be released first (the dodge that was in progress cannot confirm it). `null` or `[]` restores the
   * default; any context switch clears it.
   */
  allowInGame(actions: readonly ButtonAction[] | null): void;
  /**
   * Pointer lock is requested on canvas click while in 'game' context; falls back to drag-look if denied.
   * (The click that captures the mouse is not reported as 'attack'. A denied request never throws; see `lookMode`.
   * After three refusals clicks stop asking; one refusal is forgiven every 30 s so a later click can try again.)
   */
  requestPointerLock(): void;
  exitPointerLock(): void;
  rumble(strong: number, weak: number, ms: number): void;

  /** Called first in every tick. Latches pressed/released edges for this tick. */
  update(dt: number): void;
  /**
   * ADDED. Marks the end of this frame's simulation substeps: edges are readable again by frame-level code. The
   * camera rig calls it at the start of its update (it runs right after the simulation); a host with a
   * different loop may call it after its own substep loop.
   */
  endSim(): void;
  /** ADDED. Remove every DOM listener and subscription (hot reload, sandbox teardown, tests). */
  dispose(): void;
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
 * A framing belongs to the space it was authored for: 'zone:loading' clears it.
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
  /**
   * Non-blocking eased move from the current pose; check `moving`. The position travels in a straight line;
   * the view pans / tilts at an even angular rate (it is not a lerp of look targets), and when the pose keeps
   * the current look target the view stays locked on it. FOV and roll interpolate linearly.
   */
  move(pose: CamPose, seconds: number, ease?: EaseName): void;
  /**
   * ADDED. Like `move`, but the position swings round `around` on an arc (bearing, radius and height each
   * interpolate) instead of cutting the chord — an orbit round a subject or a table. Takes the short way round.
   */
  arc(pose: CamPose, seconds: number, around: Vec3Like, ease?: EaseName): void;
  /**
   * ADDED. One continuous move from the current pose through every pose in `poses` (up to 16), ending on the
   * last: a smooth spline with a single ease over the whole duration — no stop at the intermediate keys.
   * Time is shared between the legs by how far each travels. `finish()` jumps to the last pose.
   */
  path(poses: readonly CamPose[], seconds: number, ease?: EaseName): void;
  /**
   * Slow orbital drift around a point for conversation shots. Non-blocking, runs until next cut/move/release.
   * Called after a cut/move it CONTINUES that shot: the orbit starts at the camera's current bearing, radius
   * and height, and keeps looking at what the shot was looking at. `radius`, `height` (above `around`) and
   * `lookHeight` (look at the point this far above `around`) are optional changes that are eased onto over
   * ~0.9 s — a drift never snaps the view. Called straight from gameplay it cuts to radius 4 / height 1.6 /
   * lookHeight 1.4 unless given. `yawRate` is rad/s (default 0.06, sign = direction).
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

/**
 * The camera rig. Division of labour (so nothing is done twice or not at all):
 *  - The PLAYER CONTROLLER calls setTarget / setAim / setLockOn — the rig never reads 'aim' or 'lockOn' input.
 *  - The rig applies `input.look` itself while in follow mode, and toggles the shoulder on 'swapShoulder'
 *    (it TAKES the press — see InputSystem.take — so nobody else sees it; skipped if the press was already
 *    consumed or setShoulder() was called that tick).
 *  - Sprint FOV (+4°) is inferred from the target's speed in simulated time; nobody needs to signal sprinting.
 *  - The rig never shakes on its own: combat / VFX call shake(), kick(), fovPunch() where an impact happens.
 *  - Collision uses `game.physics.sweepSphere` (0.25 m probe, mask RAY_SIGHT | RAY_SHOT: opaque geometry plus
 *    physical see-through solids such as glass and energy barriers; invisible move-only blockers do not push
 *    the camera) + `groundAt`; with stub physics the camera simply does not collide. A hero standing INSIDE a
 *    solid (a door closed on them, a large body over them) holds the camera where it was.
 *  - Draw the followed figure with `playerFade` as its opacity.
 *  - 'zone:loading' is a hard cut: it cancels shake / blends, clears lock-on, aim, a guided aimAt and any
 *    setFraming override, and re-seats the follow camera. Set them again for the new zone.
 *
 * Time: shake, recoil, FOV punch and breathing run on real time. Authored motion — cinematic moves / drifts,
 * release() and hand-over blends, guided aimAt — runs on SIMULATED time: it stops while the game is paused or
 * loading, waits out hit-stop and stretches with slow-motion, so a shot is never ahead of the script, voice and
 * animation it belongs to. (Outside the playing phases, e.g. on the title screen, cinematic time is real time.)
 *
 * Feel of the follow camera (so nobody re-implements or fights it):
 *  - Composition: the hero sits left of centre (right shoulder) with the screen centre clear; aim framing is
 *    tighter (distance 1.6, FOV 48) with the head below the reticle line.
 *  - Auto-recentre depends on the device: none with a captured mouse; on a gamepad a slow turn (≤ 18°/s) behind
 *    FORWARD motion after 2.4 s without look input and 4 s without combat input, easing in over the first two
 *    seconds of a run; without pointer lock a slightly firmer one (≤ 25°/s, after 0.9 s). Strafing and
 *    backpedalling never turn the camera. A bot steering with `virtual.setMoveWorld` is followed round corners
 *    (≤ 60°/s); bots that need a specific view should still call aimAt().
 *  - With a wall close behind the hero the camera rises and looks over the head (and tilts down a few degrees)
 *    instead of sitting beside it; looking steeply up, it drops low and close so the helmet stays at the bottom
 *    of the frame.
 *  - A one-frame displacement of 1.5–25 m (blink-strike, knock-through) is followed with a ~0.15–0.2 s whip;
 *    more than 25 m is a teleport and cuts. Call snapBehind() after a move you want as a hard cut.
 *  - Windows narrower than 16:9 keep the 16:9 horizontal field of view (vertical FOV grows, up to 100° for the
 *    follow lens; beyond that — portrait — the shoulder offset tightens instead). Aiming still zooms.
 *  - `rig.camera.fov` is therefore the RENDERED vertical FOV, not always the authored one.
 */
export interface CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly mode: 'follow' | 'cinematic' | 'free';
  /**
   * follow-orbit angles (radians). yaw follows the same convention as actors; positive pitch looks up.
   * (These are the player's orbit; squeezed against a wall the rendered view may be tilted a few degrees below
   * `pitch` — use getAimRay() for what the screen centre actually points at.)
   */
  yaw: number;
  pitch: number;
  /** ADDED. current shoulder side (+1 right, −1 left). The rig toggles it on 'swapShoulder' unless consumed. */
  readonly shoulder: 1 | -1;
  /** ADDED. true while aim framing is requested (setAim). */
  readonly aiming: boolean;
  /**
   * ADDED. Current distance (m) from the camera to the follow pivot after collision. Skip this far along
   * getAimRay() to start a shot trace past the player. (For fading the figure use `playerFade`.)
   */
  readonly targetDistance: number;
  /**
   * ADDED. Opacity to draw the followed figure with: 1 normally, easing to 0 as the camera closes within
   * ~0.6 → 0.3 m of the body (wedged into a corner), so the hero never fills the frame or crosses the near
   * plane. Valid in every mode (a cinematic camera passing through the hero fades it too).
   */
  readonly playerFade: number;

  /**
   * Follow this body (its `pos` is read live every frame). Switching from one body to another glides the camera
   * across in ~0.85 s (protagonist hand-over); call snapBehind() right after to cut instead.
   */
  setTarget(target: CameraFollowTarget | null): void;
  /** over-the-shoulder aim framing */
  setAim(active: boolean): void;
  /** soft lock-on: frame both the player and this point. null clears. */
  setLockOn(target: (() => Vec3Like) | null): void;
  setShoulder(side: 1 | -1): void;
  /** instantly place the follow camera behind the target (after teleports / handoffs) */
  snapBehind(yaw?: number): void;
  /**
   * ADDED. Turn the follow orbit so the camera looks at a world point. `seconds` 0 (default) = instantly (bots);
   * > 0 = a gentle guided turn over roughly that long, for "frame the next destination" beats — the player
   * cancels it by touching look, and it never fights lock-on or aim.
   */
  aimAt(point: Vec3Like, seconds?: number): void;
  /**
   * ADDED. Aim-assist candidates (weak points, heads, centres of mass), read every frame while it applies. With
   * a GAMEPAD, while aiming, and `settings.aimAssist` on, the stick's look speed eases down by up to 45 % as the
   * reticle passes within ~1–5° of a candidate ("reticle friction"). It only slows the player's own input — it
   * never moves the view — and does nothing for mouse players. null clears; 'zone:loading' clears.
   */
  setAimAssist(points: (() => readonly Vec3Like[]) | null): void;
  /** ADDED. Override the follow framing, eased over `blendSeconds` (default 1). null restores the defaults. */
  setFraming(framing: FollowFraming | null, blendSeconds?: number): void;

  /**
   * Trauma-style shake. amplitude ~0..1. Honours settings.reduceShake.
   * (Decays linearly to exactly zero over `duration`, default 0.4 s. Rough guide: light hit 0.15, heavy 0.5,
   * slam / elite impact 0.9. Overlapping shakes combine as a root-sum-square; re-issuing the same shake every
   * frame sustains it without stacking. Full trauma is about 1.3° / 6 cm at FOV 62 and is scaled with the zoom,
   * so it covers the same share of the screen through the aim lens.)
   */
  shake(amplitude: number, duration?: number): void;
  /** recoil-style impulse (degrees) — positive pitch kicks up, positive yaw kicks left; springs back in ~0.25 s */
  kick(pitchDeg: number, yawDeg?: number): void;
  /** transient FOV change that eases back (snaps in over the first 18 % of `seconds`, default 0.35 s) */
  fovPunch(deltaDeg: number, seconds?: number): void;

  readonly cine: CinematicCamera;
  /**
   * Leave cinematic mode and blend back to follow over `seconds` (0 = cut; default 0.6). If geometry stands
   * between the shot and the follow camera the blend is replaced by a cut (it would fly through the wall); the
   * same holds for the hand-over glide of setTarget().
   */
  release(seconds?: number): void;

  /** Free debug camera (screenshots). Applied immediately; no shake/breathing. null returns to the previous mode. */
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
  /** ADDED. Remove the resize listener and event subscriptions and detach the camera (hot reload, teardown). */
  dispose(): void;
}
