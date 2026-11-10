/**
 * Gamepad API reader (standard mapping only): radial dead-zones, response curves, triggers as buttons, chords,
 * sprint latch, rumble. Polled once per frame; writes into caller-owned arrays.
 *
 * Device selection is deliberately suspicious, because the Gamepad API also lists throttles, pedals, wheels and
 * virtual joysticks:
 *  - only pads reporting `mapping === 'standard'` are read at all;
 *  - among those, the pad that most recently produced a deliberate input EDGE (button press, trigger pull, stick
 *    pushed out from rest) is the active one;
 *  - a stick is ignored until it has been seen resting near centre once (an axis parked at −1 never counts);
 *  - `activity` reports edges, never levels, so a stuck button cannot hold the device away from the keyboard.
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
/** a stick must be seen inside this radius once before it is trusted */
const TRUST_RADIUS = 0.35;
/** stick deflection that counts as a deliberate push (edge from below ACTIVE_OFF) */
const ACTIVE_ON = 0.5;
const ACTIVE_OFF = 0.3;
/** Gamepad API slots that are tracked */
const MAX_PADS = 8;
/** full-deflection look rates, rad/s (before gamepadSensitivity) */
export const PAD_YAW_RATE = 3.1;
export const PAD_PITCH_RATE = 1.9;

const out2 = { x: 0, y: 0 };

type Buttons = PadLike['buttons'];
const btn = (b: Buttons, i: number): boolean => i < b.length && b[i].pressed;
const val = (b: Buttons, i: number): number => (i < b.length ? Math.max(b[i].value, b[i].pressed ? 1 : 0) : 0);
const axis = (a: ArrayLike<number>, i: number): number => {
  const v = i < a.length ? a[i] : 0;
  return Number.isFinite(v) ? v : 0;
};
/** A device the game will read: connected, standard-mapped and shaped like a gamepad. */
const usable = (p: PadLike | null | undefined): p is PadLike =>
  !!p && p.connected === true && p.mapping === 'standard' && !!p.buttons && !!p.axes && p.buttons.length >= 10 && p.axes.length >= 2;

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
  /** true on a frame where the active pad produced a deliberate input edge */
  activity = false;
  connected = false;
  style: PadStyle = 'xbox';

  private pad: PadLike | null = null;
  private active = -1;
  /** per Gamepad API slot: seen before, sticks trusted, sticks currently pushed, buttons held last poll */
  private readonly seen = new Uint8Array(MAX_PADS);
  private readonly trustL = new Uint8Array(MAX_PADS);
  private readonly trustR = new Uint8Array(MAX_PADS);
  private readonly pushL = new Uint8Array(MAX_PADS);
  private readonly pushR = new Uint8Array(MAX_PADS);
  private readonly held = new Uint32Array(MAX_PADS);

  private ltDown = false;
  private rtDown = false;
  private rbWasDown = false;
  private rbAsSecond = false;
  private l3WasDown = false;
  private sprintLatch = false;
  private turnHold = 0;
  private menuX = 0;
  private menuY = 0;

  constructor(private readonly getPads: () => ArrayLike<PadLike | null> | null) {}

  /** Poll every standard pad, pick the active one and read it. `dt` is real seconds. */
  poll(dt: number): void {
    const down = this.down;
    down.fill(0);
    this.moveX = this.moveY = this.lookX = this.lookY = 0;
    this.activity = false;

    let pads: ArrayLike<PadLike | null> | null = null;
    try {
      pads = this.getPads();
    } catch {
      pads = null;
    }
    const n = pads ? Math.min(pads.length, MAX_PADS) : 0;
    let fresh = -1;
    let first = -1;
    for (let i = 0; i < MAX_PADS; i++) {
      const p = i < n && pads ? pads[i] : null;
      if (!usable(p)) {
        this.seen[i] = this.trustL[i] = this.trustR[i] = this.pushL[i] = this.pushR[i] = 0;
        this.held[i] = 0;
        continue;
      }
      if (first < 0) first = i;
      if (this.scan(i, p) && (fresh < 0 || i === this.active)) fresh = i;
    }
    // The active pad keeps the seat while it is connected; another pad takes over on its own input edge.
    let active = this.active;
    if (active < 0 || !this.seen[active]) active = fresh >= 0 ? fresh : first;
    else if (fresh >= 0 && fresh !== active) active = fresh;
    const pad = active >= 0 && pads ? pads[active] : null;
    if (active !== this.active || pad !== this.pad) {
      if (active !== this.active) this.resetLatches();
      if (pad) this.style = padStyleFromId(pad.id);
    }
    this.active = active;
    this.pad = pad;
    this.connected = pad !== null;
    if (!pad) {
      this.resetLatches();
      return;
    }
    this.activity = fresh === active;

    const b = pad.buttons;

    // Triggers as buttons, with hysteresis so a resting finger does not chatter.
    const lt = val(b, PAD.LT);
    const rt = val(b, PAD.RT);
    this.ltDown = this.ltDown ? lt > TRIGGER_OFF : lt > TRIGGER_ON;
    this.rtDown = this.rtDown ? rt > TRIGGER_OFF : rt > TRIGGER_ON;

    // Sticks (only once they have been seen at rest: see `scan`).
    const ax = pad.axes;
    const lOk = this.trustL[active] === 1;
    const l = shapeStick(lOk ? axis(ax, 0) : 0, lOk ? axis(ax, 1) : 0, 1.25);
    this.moveX = l.x;
    this.moveY = -l.y;
    const lMag = Math.hypot(l.x, l.y);
    if (this.trustR[active] === 1) {
      const r = shapeStick(axis(ax, 2), axis(ax, 3), 2.0);
      const rMag = Math.hypot(r.x, r.y);
      // Turn boost: holding the stick at the rim ramps the yaw rate up for fast 180s.
      this.turnHold = rMag > 0.92 ? Math.min(1, this.turnHold + dt / 0.5) : Math.max(0, this.turnHold - dt * 6);
      const boost = 1 + 0.75 * this.turnHold;
      this.lookX = -r.x * PAD_YAW_RATE * boost;
      this.lookY = -r.y * PAD_PITCH_RATE;
    }

    // Face buttons. X swings — except while aiming, where RT is the trigger and X reloads instead (so a
    // reload never starts with an attack).
    if (btn(b, PAD.A)) down[A.dodge] = down[A.confirm] = 1;
    if (btn(b, PAD.B)) down[A.interact] = down[A.cancel] = down[A.skip] = 1;
    if (btn(b, PAD.Y)) down[A.heavy] = 1;
    if (btn(b, PAD.X)) down[this.ltDown ? A.reload : A.attack] = 1;

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
    const rx = lOk ? axis(ax, 0) : 0;
    const ry = lOk ? axis(ax, 1) : 0;
    this.menuX = Math.abs(rx) > (this.menuX !== 0 ? MENU_OFF : MENU_ON) && Math.abs(rx) >= Math.abs(ry) ? Math.sign(rx) : 0;
    this.menuY = Math.abs(ry) > (this.menuY !== 0 ? MENU_OFF : MENU_ON) && Math.abs(ry) > Math.abs(rx) ? Math.sign(ry) : 0;
    if (this.menuX < 0) down[A.menuLeft] = 1;
    if (this.menuX > 0) down[A.menuRight] = 1;
    if (this.menuY < 0) down[A.menuUp] = 1;
    if (this.menuY > 0) down[A.menuDown] = 1;
  }

  /**
   * Per-slot bookkeeping for one usable pad: stick trust, and whether it produced a deliberate input EDGE this
   * poll (button newly pressed, trigger newly pulled, trusted stick newly pushed out). A button already down
   * when the pad first appears counts — browsers only list a pad once the player has pressed something on it.
   */
  private scan(i: number, p: PadLike): boolean {
    const ax = p.axes;
    const lMag = Math.hypot(axis(ax, 0), axis(ax, 1));
    const rMag = ax.length >= 4 ? Math.hypot(axis(ax, 2), axis(ax, 3)) : 0;
    if (lMag < TRUST_RADIUS) this.trustL[i] = 1;
    if (ax.length >= 4 && rMag < TRUST_RADIUS) this.trustR[i] = 1;

    const b = p.buttons;
    let bits = 0;
    const count = Math.min(b.length, 17);
    for (let k = 0; k < count; k++) {
      const pressed = k === PAD.LT || k === PAD.RT ? val(b, k) > TRIGGER_ON : b[k].pressed;
      if (pressed) bits |= 1 << k;
    }
    const pushL = this.trustL[i] === 1 && lMag > (this.pushL[i] ? ACTIVE_OFF : ACTIVE_ON) ? 1 : 0;
    const pushR = this.trustR[i] === 1 && rMag > (this.pushR[i] ? ACTIVE_OFF : ACTIVE_ON) ? 1 : 0;
    const edge = (bits & ~this.held[i]) !== 0 || (pushL === 1 && this.pushL[i] === 0) || (pushR === 1 && this.pushR[i] === 0);
    this.seen[i] = 1;
    this.held[i] = bits;
    this.pushL[i] = pushL;
    this.pushR[i] = pushR;
    return edge;
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
    this.turnHold = 0;
    this.menuX = this.menuY = 0;
  }
}
