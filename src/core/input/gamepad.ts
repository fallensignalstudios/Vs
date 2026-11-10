/**
 * Gamepad API reader (standard mapping): radial dead-zones, response curves, triggers as buttons, chords,
 * sprint latch, hold-to-reload, rumble. Polled once per frame; writes into caller-owned arrays.
 */
import { clamp01 } from '@/core/mathx';
import { A, ACTION_COUNT } from './actions';
import { PAD, padStyleFromId, type PadStyle } from './bindings';

/** Minimal structural view of the Gamepad API so tests can feed plain objects. */
export interface PadLike {
  readonly id: string;
  readonly connected: boolean;
  readonly mapping?: string;
  readonly axes: ArrayLike<number>;
  readonly buttons: ArrayLike<{ readonly pressed: boolean; readonly value: number }>;
  readonly vibrationActuator?: {
    playEffect?(type: string, params: Record<string, number>): unknown;
  } | null;
}

export const STICK_DEADZONE = 0.16;
export const STICK_OUTER = 0.96;
/** trigger press / release thresholds (hysteresis) */
const TRIGGER_ON = 0.35;
const TRIGGER_OFF = 0.22;
/** left stick as a menu direction (hysteresis) */
const MENU_ON = 0.6;
const MENU_OFF = 0.4;
/** hold X this long to reload */
export const RELOAD_HOLD = 0.45;
/** full-deflection look rates, rad/s (before gamepadSensitivity) */
export const PAD_YAW_RATE = 3.1;
export const PAD_PITCH_RATE = 1.9;

const out2 = { x: 0, y: 0 };

type Buttons = PadLike['buttons'];
const btn = (b: Buttons, i: number): boolean => i < b.length && b[i].pressed;
const val = (b: Buttons, i: number): number => (i < b.length ? Math.max(b[i].value, b[i].pressed ? 1 : 0) : 0);

/**
 * Radial dead-zone with rescale and a power response curve. Returns a shared scratch object.
 * |result| is 0 inside the dead-zone and reaches exactly 1 at the outer ring.
 */
export function shapeStick(x: number, y: number, curve: number, dead = STICK_DEADZONE, outer = STICK_OUTER): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (!(len > dead)) {
    out2.x = 0;
    out2.y = 0;
    return out2;
  }
  const t = clamp01((len - dead) / (outer - dead));
  const m = Math.pow(t, curve) / len;
  out2.x = x * m;
  out2.y = y * m;
  return out2;
}

export class GamepadReader {
  /** action slots held by the pad this frame */
  readonly down = new Uint8Array(ACTION_COUNT);
  /** move intent: x strafe right, y forward */
  moveX = 0;
  moveY = 0;
  /** look rate in rad/s: x = yaw delta (left positive), y = pitch delta (up positive) */
  lookX = 0;
  lookY = 0;
  /** true if the pad produced any deliberate input this frame */
  activity = false;
  connected = false;
  style: PadStyle = 'xbox';

  private pad: PadLike | null = null;
  private ltDown = false;
  private rtDown = false;
  private rbWasDown = false;
  private rbAsSecond = false;
  private l3WasDown = false;
  private sprintLatch = false;
  private xHeld = 0;
  private turnHold = 0;
  private menuX = 0;
  private menuY = 0;

  constructor(private readonly getPads: () => ArrayLike<PadLike | null> | null) {}

  /** Poll the first connected pad. `dt` is real seconds. */
  poll(dt: number): void {
    const down = this.down;
    down.fill(0);
    this.moveX = this.moveY = this.lookX = this.lookY = 0;
    this.activity = false;

    let pad: PadLike | null = null;
    let pads: ArrayLike<PadLike | null> | null = null;
    try {
      pads = this.getPads();
    } catch {
      pads = null;
    }
    if (pads) {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected && p.buttons.length >= 10 && p.axes.length >= 2) {
          pad = p;
          break;
        }
      }
    }
    if (pad !== this.pad && pad) this.style = padStyleFromId(pad.id);
    this.pad = pad;
    this.connected = pad !== null;
    if (!pad) {
      this.resetLatches();
      return;
    }

    const b = pad.buttons;

    // Triggers as buttons, with hysteresis so a resting finger does not chatter.
    const lt = val(b, PAD.LT);
    const rt = val(b, PAD.RT);
    this.ltDown = this.ltDown ? lt > TRIGGER_OFF : lt > TRIGGER_ON;
    this.rtDown = this.rtDown ? rt > TRIGGER_OFF : rt > TRIGGER_ON;

    // Sticks.
    const ax = pad.axes;
    const l = shapeStick(ax[0] || 0, ax[1] || 0, 1.25);
    this.moveX = l.x;
    this.moveY = -l.y;
    const lMag = Math.hypot(l.x, l.y);
    if (ax.length >= 4) {
      const r = shapeStick(ax[2] || 0, ax[3] || 0, 2.0);
      const rMag = Math.hypot(r.x, r.y);
      // Turn boost: holding the stick at the rim ramps the yaw rate up for fast 180s.
      this.turnHold = rMag > 0.92 ? Math.min(1, this.turnHold + dt / 0.5) : Math.max(0, this.turnHold - dt * 6);
      const boost = 1 + 0.75 * this.turnHold;
      this.lookX = -r.x * PAD_YAW_RATE * boost;
      this.lookY = -r.y * PAD_PITCH_RATE;
      if (rMag > 0.2) this.activity = true;
    }
    if (lMag > 0.2) this.activity = true;

    // Face buttons.
    if (btn(b, PAD.A)) down[A.dodge] = down[A.confirm] = 1;
    if (btn(b, PAD.B)) down[A.interact] = down[A.cancel] = down[A.skip] = 1;
    if (btn(b, PAD.Y)) down[A.heavy] = 1;
    const x = btn(b, PAD.X);
    if (x) down[A.attack] = 1;
    this.xHeld = x ? this.xHeld + dt : 0;
    if (this.xHeld >= RELOAD_HOLD) down[A.reload] = 1;

    // Shoulders. LT aims; RT fires while aiming, otherwise it is the modifier for the second ability.
    if (btn(b, PAD.LB)) down[A.guard] = 1;
    if (this.ltDown) down[A.aim] = 1;
    if (this.rtDown && this.ltDown) down[A.attack] = 1;
    const rb = btn(b, PAD.RB);
    if (rb && !this.rbWasDown) this.rbAsSecond = this.rtDown && !this.ltDown;
    if (rb) down[this.rbAsSecond ? A.ability2 : A.ability1] = 1;
    this.rbWasDown = rb;

    // Sticks clicks. L3 latches sprint until the stick relaxes (nobody holds L3 while steering).
    const l3 = btn(b, PAD.L3);
    if (l3 && !this.l3WasDown) this.sprintLatch = !this.sprintLatch;
    this.l3WasDown = l3;
    if (lMag < 0.3 && !l3) this.sprintLatch = false;
    if (this.sprintLatch || l3) down[A.sprint] = 1;
    if (btn(b, PAD.R3)) down[A.lockOn] = 1;

    // D-pad + menu.
    if (btn(b, PAD.UP)) down[A.scan] = down[A.menuUp] = 1;
    if (btn(b, PAD.DOWN)) down[A.reload] = down[A.menuDown] = 1;
    if (btn(b, PAD.LEFT)) down[A.swapShoulder] = down[A.menuLeft] = 1;
    if (btn(b, PAD.RIGHT)) down[A.ability2] = down[A.menuRight] = 1;
    if (btn(b, PAD.BACK)) down[A.scan] = 1;
    if (btn(b, PAD.START)) down[A.pause] = 1;

    // Left stick as menu directions (raw axes, hysteresis, dominant axis only).
    const rx = ax[0] || 0;
    const ry = ax[1] || 0;
    this.menuX = Math.abs(rx) > (this.menuX !== 0 ? MENU_OFF : MENU_ON) && Math.abs(rx) >= Math.abs(ry) ? Math.sign(rx) : 0;
    this.menuY = Math.abs(ry) > (this.menuY !== 0 ? MENU_OFF : MENU_ON) && Math.abs(ry) > Math.abs(rx) ? Math.sign(ry) : 0;
    if (this.menuX < 0) down[A.menuLeft] = 1;
    if (this.menuX > 0) down[A.menuRight] = 1;
    if (this.menuY < 0) down[A.menuUp] = 1;
    if (this.menuY > 0) down[A.menuDown] = 1;

    if (!this.activity) {
      if (this.ltDown || this.rtDown) this.activity = true;
      else {
        const n = Math.min(b.length, 17);
        for (let i = 0; i < n; i++) {
          if (b[i].pressed) {
            this.activity = true;
            break;
          }
        }
      }
    }
  }

  /** Dual-rumble when the pad supports it. Magnitudes 0..1, duration in milliseconds. */
  rumble(strong: number, weak: number, ms: number): void {
    const act = this.pad?.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function' || !(ms > 0)) return;
    try {
      const p = act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.min(ms, 2000),
        strongMagnitude: clamp01(strong),
        weakMagnitude: clamp01(weak),
      });
      if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
    } catch {
      /* unsupported effect: rumble is optional */
    }
  }

  private resetLatches(): void {
    this.ltDown = this.rtDown = this.rbWasDown = this.rbAsSecond = this.l3WasDown = this.sprintLatch = false;
    this.xHeld = this.turnHold = 0;
    this.menuX = this.menuY = 0;
  }
}
