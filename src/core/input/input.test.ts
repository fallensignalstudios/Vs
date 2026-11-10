import { describe, expect, it, vi } from 'vitest';
import type { Game, GameEvents, Settings } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { ACTIONS, CONTEXT_MASK, MENU_REPEAT_DELAY, MENU_REPEAT_INTERVAL } from './actions';
import { glyphFor, padStyleFromId } from './bindings';
import { PAD_YAW_RATE, RELOAD_HOLD, shapeStick, type PadLike } from './gamepad';
import { InputSystemImpl, KEY_YAW_RATE, MOUSE_RAD_PER_PX, type InputEnv } from './system';
import { createInputSystem } from './index';

const DT = 1 / 60;

interface FakePad extends PadLike {
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
  rumbles: Array<Record<string, number>>;
}

function makePad(id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'): FakePad {
  const rumbles: Array<Record<string, number>> = [];
  return {
    id,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    rumbles,
    vibrationActuator: {
      playEffect(_type: string, params: Record<string, number>) {
        rumbles.push(params);
        return Promise.resolve('complete');
      },
    },
  };
}

function rig(opts: { lock?: 'grant' | 'reject' | 'none'; settings?: Partial<Settings> } = {}) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, hidden: false, exitPointerLock: () => {} });
  const lock = opts.lock ?? 'grant';
  const canvas = new EventTarget() as EventTarget & { requestPointerLock?: () => Promise<void> };
  let lockRequests = 0;
  if (lock !== 'none') {
    canvas.requestPointerLock = () => {
      lockRequests++;
      if (lock === 'grant') {
        doc.pointerLockElement = canvas;
        doc.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      }
      return Promise.reject(Object.assign(new Error('sandboxed'), { name: 'SecurityError' }));
    };
  }
  doc.exitPointerLock = () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  const pads: Array<FakePad | null> = [null, null, null, null];
  const env: InputEnv = { win, doc, canvas, getGamepads: () => pads };
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  for (const [k, v] of Object.entries(opts.settings ?? {})) settings.set(k as keyof Settings, v as never);
  const game = { events, settings } as unknown as Game;
  const input = new InputSystemImpl(game, env);

  const ev = (target: EventTarget, type: string, props: Record<string, unknown> = {}) => {
    const e = new Event(type, { cancelable: true });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
    target.dispatchEvent(e);
    return e;
  };
  return {
    input,
    settings,
    pads,
    doc,
    get lockRequests() {
      return lockRequests;
    },
    keyDown: (code: string, props: Record<string, unknown> = {}) => ev(win, 'keydown', { code, ...props }),
    keyUp: (code: string) => ev(win, 'keyup', { code }),
    mouseDown: (button: number) => ev(canvas, 'mousedown', { button }),
    mouseUp: (button: number) => ev(win, 'mouseup', { button }),
    mouseMove: (movementX: number, movementY: number) => ev(doc, 'mousemove', { movementX, movementY }),
    blur: () => ev(win, 'blur'),
    tick: (n = 1, dt = DT) => {
      for (let i = 0; i < n; i++) input.update(dt);
    },
  };
}

describe('edge latching', () => {
  it('latches pressed for exactly one tick, tracks hold time and release', () => {
    const r = rig();
    r.tick();
    expect(r.input.down('heavy')).toBe(false);
    r.keyDown('KeyF');
    r.tick();
    expect(r.input.pressed('heavy')).toBe(true);
    expect(r.input.down('heavy')).toBe(true);
    expect(r.input.released('heavy')).toBe(false);
    r.tick();
    expect(r.input.pressed('heavy')).toBe(false);
    expect(r.input.down('heavy')).toBe(true);
    r.tick(28);
    expect(r.input.heldTime('heavy')).toBeCloseTo(30 * DT, 5);
    r.keyUp('KeyF');
    r.tick();
    expect(r.input.down('heavy')).toBe(false);
    expect(r.input.released('heavy')).toBe(true);
    expect(r.input.heldTime('heavy')).toBe(0);
    expect(r.input.lastHeldTime('heavy')).toBeCloseTo(30 * DT, 5);
    r.tick();
    expect(r.input.released('heavy')).toBe(false);
  });

  it('registers a tap that went down and up between two ticks', () => {
    const r = rig();
    r.tick();
    r.keyDown('KeyE');
    r.keyUp('KeyE');
    r.tick();
    expect(r.input.pressed('interact')).toBe(true);
    r.tick();
    expect(r.input.down('interact')).toBe(false);
    expect(r.input.released('interact')).toBe(true);
  });

  it('ignores key auto-repeat and keeps an action down while any of its keys is held', () => {
    const r = rig();
    r.keyDown('ShiftLeft');
    r.tick();
    r.keyDown('ShiftLeft', { repeat: true });
    r.tick();
    expect(r.input.pressed('sprint')).toBe(false);
    r.keyDown('ShiftRight');
    r.keyUp('ShiftLeft');
    r.tick();
    expect(r.input.down('sprint')).toBe(true);
    expect(r.input.pressed('sprint')).toBe(false);
    r.keyUp('ShiftRight');
    r.tick();
    expect(r.input.down('sprint')).toBe(false);
  });

  it('consume hides the press for the rest of the tick only', () => {
    const r = rig();
    r.keyDown('KeyE');
    r.tick();
    expect(r.input.pressed('interact')).toBe(true);
    r.input.consume('interact');
    expect(r.input.pressed('interact')).toBe(false);
    expect(r.input.pressed('confirm')).toBe(true); // other actions on the same key are independent
    expect(r.input.down('interact')).toBe(true);
  });

  it('never throws on unknown actions', () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bogus = 'teleport' as never;
    expect(r.input.down(bogus)).toBe(false);
    expect(r.input.pressed(bogus)).toBe(false);
    expect(r.input.heldTime(bogus)).toBe(0);
    expect(r.input.glyph(bogus)).toBe('?');
    r.input.consume(bogus);
    r.input.virtual.press(bogus);
    r.input.virtual.hold(bogus, true);
    r.tick();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('default bindings', () => {
  it('maps the BRIEF keyboard and mouse controls', () => {
    const keys: Array<[string, (typeof ACTIONS)[number]]> = [
      ['KeyF', 'heavy'], ['KeyQ', 'guard'], ['Space', 'dodge'], ['ShiftLeft', 'sprint'], ['KeyE', 'interact'],
      ['Digit1', 'ability1'], ['Digit2', 'ability2'], ['Tab', 'lockOn'], ['KeyV', 'scan'], ['KeyR', 'reload'],
      ['KeyC', 'swapShoulder'], ['Escape', 'pause'],
    ];
    for (const [code, action] of keys) {
      const r = rig();
      r.keyDown(code);
      r.tick();
      expect(r.input.pressed(action), `${code} → ${action}`).toBe(true);
    }
    const buttons: Array<[number, (typeof ACTIONS)[number]]> = [[0, 'attack'], [1, 'lockOn'], [2, 'aim'], [3, 'guard']];
    for (const [button, action] of buttons) {
      const r = rig({ lock: 'none' });
      r.mouseDown(button);
      r.tick();
      expect(r.input.pressed(action), `mouse ${button} → ${action}`).toBe(true);
      r.mouseUp(button);
      r.tick();
      expect(r.input.down(action)).toBe(false);
    }
  });

  it('prevents default on bound keys but leaves F-keys, shortcuts and text fields alone', () => {
    const r = rig();
    expect(r.keyDown('Tab').defaultPrevented).toBe(true);
    expect(r.keyDown('Space').defaultPrevented).toBe(true);
    expect(r.keyDown('ArrowUp').defaultPrevented).toBe(true);
    expect(r.keyDown('F5').defaultPrevented).toBe(false);
    expect(r.keyDown('F11').defaultPrevented).toBe(false);
    expect(r.keyDown('KeyR', { ctrlKey: true }).defaultPrevented).toBe(false);
    r.tick();
    expect(r.input.down('reload')).toBe(false);
    const typed = r.keyDown('KeyQ', { target: { tagName: 'INPUT' } });
    expect(typed.defaultPrevented).toBe(false);
    r.tick();
    expect(r.input.down('guard')).toBe(false);
    // focused buttons keep native Enter activation
    expect(r.keyDown('Enter', { target: { tagName: 'BUTTON' } }).defaultPrevented).toBe(false);
  });

  it('gives short glyphs per device', () => {
    expect(glyphFor('interact', 'kbm')).toBe('E');
    expect(glyphFor('attack', 'kbm')).toBe('LMB');
    expect(glyphFor('aim', 'kbm')).toBe('RMB');
    expect(glyphFor('dodge', 'kbm')).toBe('Space');
    expect(glyphFor('sprint', 'kbm')).toBe('Shift');
    expect(glyphFor('lockOn', 'kbm')).toBe('Tab');
    expect(glyphFor('dodge', 'gamepad')).toBe('A');
    expect(glyphFor('guard', 'gamepad')).toBe('LB');
    expect(glyphFor('aim', 'gamepad')).toBe('LT');
    expect(glyphFor('dodge', 'gamepad', 'playstation')).toBe('✕');
    expect(padStyleFromId('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)')).toBe('playstation');
    for (const a of ACTIONS) {
      expect(glyphFor(a, 'kbm').length).toBeGreaterThan(0);
      expect(glyphFor(a, 'gamepad').length).toBeGreaterThan(0);
    }
  });
});

describe('contexts', () => {
  it('menu hides gameplay actions and movement; cinematic allows only skip and pause', () => {
    const r = rig();
    r.input.setContext('menu');
    r.keyDown('KeyF');
    r.keyDown('KeyW');
    r.keyDown('Enter');
    r.tick();
    expect(r.input.down('heavy')).toBe(false);
    expect(r.input.pressed('heavy')).toBe(false);
    expect(r.input.move.y).toBe(0);
    expect(r.input.pressed('confirm')).toBe(true);
    expect(r.input.pressed('menuUp')).toBe(true);
    expect(r.input.pressed('skip')).toBe(false);

    const c = rig();
    c.input.setContext('cinematic');
    c.keyDown('Space');
    c.keyDown('Escape');
    c.keyDown('KeyE');
    c.tick();
    expect(c.input.down('skip')).toBe(true);
    expect(c.input.pressed('pause')).toBe(true);
    expect(c.input.down('dodge')).toBe(false);
    expect(c.input.down('confirm')).toBe(false);
    expect(c.input.down('interact')).toBe(false);
    expect(c.input.context).toBe('cinematic');
  });

  it('exposes exactly the documented actions per context', () => {
    const allowed = (ctx: 'menu' | 'cinematic') => ACTIONS.filter((_, i) => CONTEXT_MASK[ctx][i] === 1);
    expect(allowed('menu').sort()).toEqual(['cancel', 'confirm', 'menuDown', 'menuLeft', 'menuRight', 'menuUp', 'pause'].sort());
    expect(allowed('cinematic').sort()).toEqual(['pause', 'skip']);
    expect(CONTEXT_MASK.game.every((v) => v === 1)).toBe(true);
  });

  it('a key never acts in two contexts: the switching press is swallowed and must be released', () => {
    const r = rig();
    r.keyDown('KeyE'); // interact (game) + confirm (menu)
    r.tick();
    expect(r.input.pressed('interact')).toBe(true);
    r.input.setContext('menu'); // e.g. the interaction opened a choice
    expect(r.input.pressed('confirm')).toBe(false);
    expect(r.input.down('confirm')).toBe(false);
    expect(r.input.down('interact')).toBe(false);
    r.tick(5);
    expect(r.input.pressed('confirm')).toBe(false);
    r.keyUp('KeyE');
    r.tick();
    r.keyDown('KeyE');
    r.tick();
    expect(r.input.pressed('confirm')).toBe(true);
  });

  it('swallows events that arrived between the last tick and the switch', () => {
    const r = rig();
    r.input.setContext('menu');
    r.tick();
    r.keyDown('Space'); // confirm in the menu…
    r.input.setContext('game'); // …handled by a DOM click before the next tick
    r.tick();
    expect(r.input.pressed('dodge')).toBe(false);
    expect(r.input.down('dodge')).toBe(false);
    r.keyUp('Space');
    r.tick();
    r.keyDown('Space');
    r.tick();
    expect(r.input.pressed('dodge')).toBe(true);
  });

  it('sprint / aim / guard resume without an edge when gameplay returns', () => {
    const r = rig({ lock: 'none' });
    r.keyDown('ShiftLeft');
    r.keyDown('KeyF');
    r.tick();
    r.input.setContext('menu');
    expect(r.input.down('sprint')).toBe(false);
    expect(r.input.released('sprint')).toBe(true);
    r.tick(3);
    r.input.setContext('game');
    expect(r.input.down('sprint')).toBe(true);
    expect(r.input.pressed('sprint')).toBe(false);
    expect(r.input.down('heavy')).toBe(false); // heavy must be re-pressed
    r.tick();
    expect(r.input.down('sprint')).toBe(true);
    expect(r.input.pressed('sprint')).toBe(false);
    expect(r.input.down('heavy')).toBe(false);
  });

  it('repeats held menu directions after a delay', () => {
    const r = rig();
    r.input.setContext('menu');
    r.keyDown('ArrowDown');
    let pulses = 0;
    const steps = Math.round((MENU_REPEAT_DELAY + MENU_REPEAT_INTERVAL * 2.5) / DT);
    for (let i = 0; i < steps; i++) {
      r.tick();
      if (r.input.pressed('menuDown')) pulses++;
    }
    expect(pulses).toBe(4); // initial press + three repeats
    expect(r.input.down('menuDown')).toBe(true);
  });
});

describe('move and look', () => {
  it('normalises keyboard movement: y forward, x strafe right', () => {
    const r = rig();
    r.keyDown('KeyW');
    r.tick();
    expect(r.input.move).toEqual({ x: 0, y: 1 });
    r.keyDown('KeyD');
    r.tick();
    expect(r.input.move.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(r.input.move.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.hypot(r.input.move.x, r.input.move.y)).toBeCloseTo(1, 6);
    r.keyUp('KeyW');
    r.keyDown('KeyA');
    r.tick();
    expect(r.input.move.x).toBe(0); // A + D cancel
  });

  it('accumulates pointer-locked mouse deltas into radians with sensitivity and invert', () => {
    const r = rig({ settings: { mouseSensitivity: 2 } });
    r.mouseDown(0); // click captures the mouse
    expect(r.input.pointerLocked).toBe(true);
    r.tick();
    expect(r.input.pressed('attack')).toBe(false); // the capturing click is not an attack
    r.mouseMove(1, 1); // first delta after capture is discarded
    r.mouseMove(100, 0);
    r.mouseMove(50, -20);
    r.tick();
    expect(r.input.look.x).toBeCloseTo(-150 * MOUSE_RAD_PER_PX * 2, 8); // mouse right → turn right → −yaw
    expect(r.input.look.y).toBeCloseTo(20 * MOUSE_RAD_PER_PX * 2, 8); // mouse up → look up
    r.tick();
    expect(r.input.look).toEqual({ x: 0, y: 0 });
    r.settings.set('invertY', true);
    r.mouseMove(0, -10);
    r.tick();
    expect(r.input.look.y).toBeCloseTo(-10 * MOUSE_RAD_PER_PX * 2, 8);
    r.mouseMove(5000, 0); // warp glitch
    r.tick();
    expect(r.input.look.x).toBe(0);
    expect(r.input.lookMode).toBe('locked');
  });

  it('falls back to RMB drag-look and arrow keys when pointer lock is rejected', async () => {
    const r = rig({ lock: 'reject' });
    r.mouseDown(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.input.pointerLocked).toBe(false);
    expect(r.input.lookMode).toBe('drag');
    r.mouseUp(0);
    r.mouseMove(40, 0); // no button: the cursor just moves
    r.tick();
    expect(r.input.look.x).toBe(0);
    r.mouseDown(2);
    r.mouseMove(40, 10);
    r.tick();
    expect(r.input.down('aim')).toBe(true);
    expect(r.input.look.x).toBeCloseTo(-40 * MOUSE_RAD_PER_PX, 8);
    expect(r.input.look.y).toBeCloseTo(-10 * MOUSE_RAD_PER_PX, 8);
    r.mouseUp(2);
    // once denied, clicks attack normally instead of being swallowed
    r.mouseDown(0);
    r.tick();
    expect(r.input.pressed('attack')).toBe(true);
    r.mouseUp(0);
    // arrow keys always rotate
    r.keyDown('ArrowLeft');
    r.tick(60);
    r.keyUp('ArrowLeft');
    expect(r.input.look.x).toBeCloseTo(KEY_YAW_RATE * DT, 6);
    expect(r.lockRequests).toBeLessThanOrEqual(3);
  });

  it('works with no pointer-lock API at all', () => {
    const r = rig({ lock: 'none' });
    r.mouseDown(0);
    r.tick();
    expect(r.input.pressed('attack')).toBe(true);
    expect(() => r.input.requestPointerLock()).not.toThrow();
    expect(() => r.input.exitPointerLock()).not.toThrow();
    expect(r.input.pointerLocked).toBe(false);
  });

  it('releases everything on blur', () => {
    const r = rig({ lock: 'none' });
    r.keyDown('KeyW');
    r.keyDown('KeyQ');
    r.mouseDown(2);
    r.tick();
    expect(r.input.down('guard')).toBe(true);
    expect(r.input.down('aim')).toBe(true);
    r.blur();
    r.tick();
    expect(r.input.down('guard')).toBe(false);
    expect(r.input.down('aim')).toBe(false);
    expect(r.input.released('guard')).toBe(true);
    expect(r.input.move.y).toBe(0);
  });
});

describe('virtual input', () => {
  it('works headless with no DOM at all', () => {
    const events = new Emitter<GameEvents>();
    const game = { events, settings: new SettingsStoreImpl(events) } as unknown as Game;
    const input = createInputSystem(game);
    expect(() => input.update(DT)).not.toThrow();
    input.virtual.setMove(0, 1);
    input.virtual.press('attack');
    input.update(DT);
    expect(input.move.y).toBe(1);
    expect(input.pressed('attack')).toBe(true);
    expect(input.pointerLocked).toBe(false);
    expect(() => input.requestPointerLock()).not.toThrow();
    expect(() => input.rumble(1, 1, 100)).not.toThrow();
  });

  it('press lasts one tick, hold persists, look applies once', () => {
    const r = rig();
    const v = r.input.virtual;
    expect(v.active).toBe(false);
    v.press('dodge');
    v.hold('guard', true);
    v.addLook(0.1, -0.05);
    expect(v.active).toBe(true);
    r.tick();
    expect(r.input.pressed('dodge')).toBe(true);
    expect(r.input.pressed('guard')).toBe(true);
    expect(r.input.look).toEqual({ x: 0.1, y: -0.05 });
    r.tick();
    expect(r.input.down('dodge')).toBe(false);
    expect(r.input.released('dodge')).toBe(true);
    expect(r.input.down('guard')).toBe(true);
    expect(r.input.look).toEqual({ x: 0, y: 0 });
    v.hold('guard', false);
    r.tick();
    expect(r.input.released('guard')).toBe(true);
    r.tick(40);
    expect(v.active).toBe(false);
  });

  it('merges with real input and clamps the result', () => {
    const r = rig();
    r.keyDown('KeyW');
    r.input.virtual.setMove(1, 1);
    r.tick();
    expect(Math.hypot(r.input.move.x, r.input.move.y)).toBeCloseTo(1, 6);
    expect(r.input.move.y).toBeGreaterThan(r.input.move.x);
    r.input.virtual.clear();
    r.tick();
    expect(r.input.move).toEqual({ x: 0, y: 1 });
  });

  it('exposes an absolute world direction through moveWorld', () => {
    const r = rig();
    expect(r.input.moveWorld).toBeNull();
    r.input.virtual.setMoveWorld({ x: 3, z: -4 });
    r.tick();
    expect(r.input.moveWorld).not.toBeNull();
    expect(r.input.moveWorld!.x).toBeCloseTo(0.6, 6);
    expect(r.input.moveWorld!.z).toBeCloseTo(-0.8, 6);
    expect(r.input.move.y).toBeCloseTo(1, 6);
    expect(r.input.virtual.active).toBe(true);
    r.input.setContext('cinematic');
    expect(r.input.moveWorld).toBeNull();
    r.input.setContext('game');
    r.input.virtual.setMoveWorld(null);
    r.tick();
    expect(r.input.moveWorld).toBeNull();
    expect(r.input.move.y).toBe(0);
  });

  it('virtual holds are not blocked by a context switch; active can be pinned', () => {
    const r = rig();
    r.input.virtual.hold('skip', true);
    r.tick();
    r.input.setContext('cinematic');
    expect(r.input.down('skip')).toBe(true);
    r.tick();
    expect(r.input.down('skip')).toBe(true);
    r.input.virtual.clear();
    expect(r.input.virtual.active).toBe(false);
    r.input.virtual.active = true;
    r.tick(120);
    expect(r.input.virtual.active).toBe(true);
    r.input.virtual.clear();
    expect(r.input.virtual.active).toBe(false);
  });
});

describe('gamepad', () => {
  it('applies a radial dead-zone, rescales to the rim and curves the response', () => {
    expect(shapeStick(0.1, 0.1, 1)).toEqual({ x: 0, y: 0 });
    const full = shapeStick(1, 0, 2);
    expect(full.x).toBeCloseTo(1, 6);
    const diag = shapeStick(0.8, 0.8, 1);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1, 6); // radial: diagonals are not faster
    const half = shapeStick(0.56, 0, 2); // halfway between dead-zone and rim
    expect(half.x).toBeCloseTo(0.25, 6);
  });

  it('maps the standard layout, switches device and glyphs', () => {
    const r = rig();
    const pad = makePad();
    r.pads[0] = pad;
    r.tick();
    expect(r.input.gamepadConnected).toBe(true);
    expect(r.input.device).toBe('kbm'); // connected but idle
    pad.buttons[0].pressed = true; // A
    pad.buttons[4].pressed = true; // LB
    pad.buttons[6].value = 0.9; // LT
    pad.axes[1] = -1; // stick up
    r.tick();
    expect(r.input.device).toBe('gamepad');
    expect(r.input.pressed('dodge')).toBe(true);
    expect(r.input.down('guard')).toBe(true);
    expect(r.input.down('aim')).toBe(true);
    expect(r.input.move.y).toBeCloseTo(1, 5);
    expect(r.input.glyph('dodge')).toBe('A');
    expect(r.input.glyph('guard')).toBe('LB');
    expect(r.input.glyphFor('dodge', 'kbm')).toBe('Space');
    expect(r.input.lookMode).toBe('stick');
    r.input.rumble(0.8, 0.3, 120);
    expect(pad.rumbles).toHaveLength(1);
    expect(pad.rumbles[0]).toMatchObject({ duration: 120, strongMagnitude: 0.8, weakMagnitude: 0.3 });
    pad.buttons[0].pressed = pad.buttons[4].pressed = false;
    pad.buttons[6].value = 0;
    pad.axes[1] = 0;
    r.tick();
    expect(r.input.device).toBe('gamepad'); // stays until another device speaks
    r.keyDown('KeyW');
    r.tick();
    expect(r.input.device).toBe('kbm');
    expect(r.input.glyph('dodge')).toBe('Space');
  });

  it('right stick looks with sensitivity; RT fires only while aiming; RT+RB is the second ability', () => {
    const r = rig({ settings: { gamepadSensitivity: 2 } });
    const pad = makePad();
    r.pads[0] = pad;
    pad.axes[2] = 0.56; // half deflection → 0.25 after the squared curve
    r.tick();
    expect(r.input.look.x).toBeCloseTo(-0.25 * PAD_YAW_RATE * 2 * DT, 6);
    pad.axes[2] = 0;

    pad.buttons[7].value = 1; // RT alone: modifier, not an attack
    r.tick();
    expect(r.input.down('attack')).toBe(false);
    pad.buttons[5].pressed = true; // + RB
    r.tick();
    expect(r.input.pressed('ability2')).toBe(true);
    expect(r.input.down('ability1')).toBe(false);
    pad.buttons[5].pressed = false;
    pad.buttons[7].value = 0;
    r.tick();
    pad.buttons[5].pressed = true; // RB alone
    r.tick();
    expect(r.input.pressed('ability1')).toBe(true);
    pad.buttons[5].pressed = false;
    pad.buttons[6].value = 1; // LT + RT = aim and fire
    pad.buttons[7].value = 1;
    r.tick();
    expect(r.input.down('aim')).toBe(true);
    expect(r.input.pressed('attack')).toBe(true);
  });

  it('latches sprint on L3 until the stick relaxes; holding X reloads', () => {
    const r = rig();
    const pad = makePad();
    r.pads[0] = pad;
    pad.axes[1] = -1;
    pad.buttons[10].pressed = true;
    r.tick();
    pad.buttons[10].pressed = false;
    r.tick(10);
    expect(r.input.down('sprint')).toBe(true);
    pad.axes[1] = 0;
    r.tick();
    expect(r.input.down('sprint')).toBe(false);

    pad.buttons[2].pressed = true;
    r.tick();
    expect(r.input.pressed('attack')).toBe(true);
    expect(r.input.down('reload')).toBe(false);
    r.tick(Math.ceil(RELOAD_HOLD / DT));
    expect(r.input.down('reload')).toBe(true);
  });

  it('left stick and d-pad drive menu directions', () => {
    const r = rig();
    const pad = makePad();
    r.pads[0] = pad;
    r.input.setContext('menu');
    pad.axes[1] = 0.9;
    r.tick();
    expect(r.input.pressed('menuDown')).toBe(true);
    pad.axes[1] = 0;
    pad.buttons[14].pressed = true;
    r.tick();
    expect(r.input.pressed('menuLeft')).toBe(true);
    expect(r.input.down('swapShoulder')).toBe(false);
    expect(r.input.move.y).toBe(0);
  });
});
