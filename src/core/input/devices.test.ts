import { describe, expect, it } from 'vitest';
import type { Game, GameEvents } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { PAD_YAW_RATE, RELOAD_HOLD, shapeStick } from './gamepad';
import { createInputSystem } from './index';
import { KEY_YAW_RATE, MOUSE_RAD_PER_PX } from './system';
import { DT, makePad, rig } from './testkit';

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
