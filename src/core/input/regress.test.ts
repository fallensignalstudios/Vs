/** Regression tests for the review findings: sim-substep edges, hit-stop, drag look, device selection, browser gaps. */
import { describe, expect, it } from 'vitest';
import { EDGE_CARRY } from './actions';
import { Keymap, glyphFor, keyLabel } from './bindings';
import { AIM_HOLD, MOUSE_RAD_PER_PX } from './system';
import { DT, makePad, rig } from './testkit';

describe('edges vs simulation substeps', () => {
  /** one frame as Game.tick runs it: latch, `steps` sim substeps (each reads the edge), then frame-level code */
  function frame(r: ReturnType<typeof rig>, steps: number, read: () => boolean): { sim: number; after: boolean } {
    r.input.update(steps * (1 / 45));
    let sim = 0;
    for (let i = 0; i < steps; i++) {
      r.time.now += 1 / 45;
      if (read()) sim++;
    }
    r.input.endSim(); // the camera rig does this right after the simulation
    return { sim, after: read() };
  }

  it('shows a press to exactly one substep however many run, and again to frame-level readers', () => {
    for (const steps of [1, 2, 3, 5]) {
      const r = rig();
      r.tick();
      r.keyDown('Tab');
      const f = frame(r, steps, () => r.input.pressed('lockOn'));
      expect(f.sim, `${steps} substeps`).toBe(1);
      expect(f.after).toBe(true);
      expect(frame(r, steps, () => r.input.pressed('lockOn')).sim).toBe(0);
    }
  });

  it('a toggle written the obvious way does not cancel itself at 20 fps', () => {
    const r = rig();
    r.tick();
    let toggles = 0;
    r.keyDown('Tab');
    r.input.update(0.05);
    for (let i = 0; i < 3; i++) {
      r.time.now += 0.05 / 3;
      if (r.input.pressed('lockOn')) toggles++; // player controller, once per substep
    }
    expect(toggles).toBe(1);
  });

  it('released() follows the same rule', () => {
    const r = rig();
    r.keyDown('KeyF');
    r.tick();
    r.keyUp('KeyF');
    expect(frame(r, 4, () => r.input.released('heavy')).sim).toBe(1);
  });

  it('take() hands a press to the first caller only', () => {
    const r = rig();
    r.keyDown('KeyE');
    r.tick();
    expect(r.input.take('interact')).toBe(true);
    expect(r.input.take('interact')).toBe(false);
    expect(r.input.pressed('interact')).toBe(false);
    expect(r.input.down('interact')).toBe(true);
    expect(r.input.take('bogus' as never)).toBe(false);
  });

  it('a press made during hit-stop reaches the simulation when time resumes', () => {
    const r = rig();
    r.tick(3);
    r.keyDown('Space');
    r.input.update(DT); // frozen frames: the sim clock does not advance and nobody reads the edge
    r.input.update(DT);
    r.input.update(DT);
    r.time.now += DT; // time resumes: the first substep still sees the dodge
    expect(r.input.pressed('dodge')).toBe(true);
    r.tick();
    expect(r.input.pressed('dodge')).toBe(false); // and only once
  });

  it('a tap that starts and ends inside a hit-stop is still delivered, but nothing is kept forever', () => {
    const r = rig();
    r.tick(3);
    r.keyDown('KeyF');
    r.keyUp('KeyF');
    r.input.update(DT);
    r.input.update(DT);
    r.time.now += DT;
    expect(r.input.pressed('heavy')).toBe(true);
    expect(r.input.down('heavy')).toBe(false);

    const s = rig();
    s.tick(3);
    s.keyDown('KeyF');
    for (let t = 0; t < EDGE_CARRY + 0.2; t += DT) s.input.update(DT); // a long freeze (loading): the press expires
    s.time.now += DT;
    expect(s.input.pressed('heavy')).toBe(false);
    expect(s.input.down('heavy')).toBe(true);
  });

  it('an edge somebody already read is never repeated by the hit-stop carry', () => {
    const r = rig();
    r.tick(3);
    r.keyDown('Escape');
    r.input.update(DT);
    expect(r.input.pressed('pause')).toBe(true); // read at frame level while frozen
    r.input.update(DT);
    expect(r.input.pressed('pause')).toBe(false);
  });
});

describe('key edge cases', () => {
  it('release and re-press inside one frame is a new press', () => {
    const r = rig({ lock: 'none' });
    r.mouseDown(0);
    r.tick();
    expect(r.input.pressed('attack')).toBe(true);
    r.tick();
    r.mouseUp(0);
    r.mouseDown(0); // mashing at a low frame rate
    r.tick();
    expect(r.input.pressed('attack')).toBe(true);
    expect(r.input.released('attack')).toBe(true);
    expect(r.input.down('attack')).toBe(true);
    expect(r.input.heldTime('attack')).toBeCloseTo(DT, 6);
    r.tick();
    expect(r.input.pressed('attack')).toBe(false);
  });

  it('a key first pressed under a modifier wakes up on its auto-repeat', () => {
    const r = rig();
    r.keyDown('KeyW', { ctrlKey: true }); // browser shortcut: not ours
    r.tick();
    expect(r.input.move.y).toBe(0);
    r.keyDown('KeyW', { repeat: true }); // Ctrl released, W still held
    r.tick();
    expect(r.input.move.y).toBe(1);
    r.keyDown('KeyW', { repeat: true });
    r.tick();
    expect(r.input.move.y).toBe(1);
    r.keyUp('KeyW');
    r.tick();
    expect(r.input.move.y).toBe(0);
  });

  it('game context: Space is a dodge only, Esc a pause only, W never a menu direction', () => {
    const r = rig();
    r.keyDown('Space');
    r.keyDown('Escape');
    r.keyDown('KeyW');
    r.tick();
    expect(r.input.pressed('dodge')).toBe(true);
    expect(r.input.pressed('pause')).toBe(true);
    for (const a of ['skip', 'confirm', 'cancel', 'menuUp'] as const) expect(r.input.down(a), a).toBe(false);
    r.tick(60);
    expect(r.input.pressed('menuUp')).toBe(false); // no key-repeat pulses during play
  });

  it('a HUD prompt can opt UI actions into play; a key already held must be released first', () => {
    const r = rig();
    r.keyDown('Space'); // mid-dodge when the prompt appears
    r.tick();
    r.input.allowInGame(['confirm']);
    r.tick(3);
    expect(r.input.down('confirm')).toBe(false);
    expect(r.input.down('dodge')).toBe(true);
    r.keyUp('Space');
    r.tick();
    r.keyDown('Enter');
    r.tick();
    expect(r.input.pressed('confirm')).toBe(true);
    expect(r.input.down('skip')).toBe(false); // only what was asked for
    r.keyUp('Enter');
    r.input.allowInGame(['heavy', 'bogus' as never]); // gameplay / unknown names are ignored
    r.input.allowInGame(null);
    r.tick();
    r.keyDown('Enter');
    r.tick();
    expect(r.input.pressed('confirm')).toBe(false);
    r.input.allowInGame(['confirm']);
    r.input.setContext('menu');
    r.input.setContext('game'); // a context switch clears the opt-in
    r.keyUp('Enter');
    r.tick();
    r.keyDown('Enter');
    r.tick();
    expect(r.input.pressed('confirm')).toBe(false);
  });
});

describe('browser integration', () => {
  it('leaves Tab (focus traversal) and unbound-in-context keys to the browser outside play', () => {
    const r = rig();
    expect(r.keyDown('Tab').defaultPrevented).toBe(true);
    r.keyUp('Tab');
    r.input.setContext('menu');
    expect(r.keyDown('Tab').defaultPrevented).toBe(false);
    expect(r.keyDown('KeyF').defaultPrevented).toBe(false); // heavy means nothing in a menu
    expect(r.keyDown('ArrowDown').defaultPrevented).toBe(true); // menu navigation is ours
    expect(r.keyDown('Enter').defaultPrevented).toBe(true);
    r.input.setContext('cinematic');
    expect(r.keyDown('Space').defaultPrevented).toBe(true); // skip
    expect(r.keyDown('Tab').defaultPrevented).toBe(false);
  });

  it('thumb buttons pressed on the canvas never navigate the browser, locked or not', () => {
    const r = rig({ lock: 'none' });
    expect(r.mouseDown(3).defaultPrevented).toBe(true);
    r.tick();
    expect(r.input.down('guard')).toBe(true);
    expect(r.mouseUp(3).defaultPrevented).toBe(true);
    expect(r.mouseDown(4).defaultPrevented).toBe(true);
    expect(r.mouseUp(4).defaultPrevented).toBe(true);
    expect(r.mouseUp(3).defaultPrevented).toBe(false); // a release that did not start on the canvas is not ours
    expect(r.mouseUp(0).defaultPrevented).toBe(false);
  });

  it('the input system owns the lock: menus get the cursor, play takes it back, cinematics keep it', () => {
    const r = rig();
    r.mouseDown(0);
    r.mouseUp(0);
    expect(r.input.pointerLocked).toBe(true);
    r.input.setContext('cinematic');
    expect(r.input.pointerLocked).toBe(true);
    r.input.setContext('menu');
    expect(r.input.pointerLocked).toBe(false);
    const before = r.lockRequests;
    r.input.setContext('game');
    expect(r.lockRequests).toBe(before + 1);
    expect(r.input.pointerLocked).toBe(true);
    r.input.setContext('menu');
    r.input.exitPointerLock(); // an explicit exit (title screen) is final
    r.input.setContext('game');
    expect(r.input.pointerLocked).toBe(false);
  });

  it('stops asking after three refusals but forgives one every 30 s', async () => {
    const r = rig({ lock: 'reject' });
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };
    for (let i = 0; i < 6; i++) {
      r.mouseDown(0);
      r.mouseUp(0);
      await settle();
      r.tick(120); // past the retry cooldown
    }
    expect(r.lockRequests).toBe(3);
    r.tick(Math.ceil(31 / 0.25), 0.25);
    r.mouseDown(0);
    r.mouseUp(0);
    await settle();
    expect(r.lockRequests).toBe(4);
  });
});

describe('no pointer lock: the right button looks or aims, never both by accident', () => {
  it('a drag looks without aiming', () => {
    const r = rig({ lock: 'none' });
    r.mouseDown(2);
    r.mouseMove(30, 0);
    r.tick();
    expect(r.input.look.x).toBeCloseTo(-30 * MOUSE_RAD_PER_PX, 8);
    for (let i = 0; i < 40; i++) {
      r.mouseMove(4, 1);
      r.tick();
      expect(r.input.down('aim')).toBe(false);
    }
    r.mouseUp(2);
    r.tick();
    expect(r.input.pressed('aim')).toBe(false);
    expect(r.input.released('aim')).toBe(false);
  });

  it('holding it still aims after a beat, and moving then looks while aiming', () => {
    const r = rig({ lock: 'none' });
    r.mouseDown(2);
    r.tick(Math.floor(AIM_HOLD / DT) - 1);
    expect(r.input.down('aim')).toBe(false);
    r.mouseMove(2, 1); // a resting hand is not a drag
    r.tick(3);
    expect(r.input.down('aim')).toBe(true);
    r.mouseMove(50, 0);
    r.tick();
    expect(r.input.down('aim')).toBe(true);
    expect(r.input.look.x).toBeCloseTo(-50 * MOUSE_RAD_PER_PX, 8);
    r.mouseUp(2);
    r.tick();
    expect(r.input.released('aim')).toBe(true);
  });

  it('a click without a drag is an aim tap (press-to-toggle aim still works)', () => {
    const r = rig({ lock: 'none', settings: { holdToToggle: true } });
    r.mouseDown(2);
    r.mouseUp(2);
    r.tick();
    expect(r.input.pressed('aim')).toBe(true);
    r.tick(5);
    expect(r.input.down('aim')).toBe(false);
    expect(r.input.engaged('aim')).toBe(true);
  });

  it('with pointer lock the right button aims at once', () => {
    const r = rig();
    r.mouseDown(0);
    r.mouseUp(0);
    r.mouseDown(2);
    r.tick();
    expect(r.input.pressed('aim')).toBe(true);
  });
});

describe('gamepad selection', () => {
  /** a throttle / pedal style HID device: enough buttons and axes, no standard mapping, axes parked at −1 */
  const throttle = () => {
    const p = makePad('Saitek Pro Flight Throttle (Vendor: 06a3 Product: 0c2d)', '');
    p.axes = [-1, -1, -1, 0];
    p.buttons[2].pressed = true;
    return p;
  };

  it('ignores devices without the standard mapping: no walking, no glyph flip', () => {
    const r = rig();
    r.pads[0] = throttle();
    r.tick(120);
    expect(r.input.gamepadConnected).toBe(false);
    expect(r.input.device).toBe('kbm');
    expect(r.input.move).toEqual({ x: 0, y: 0 });
    expect(r.input.down('attack')).toBe(false);
    expect(r.input.glyph('attack')).toBe('LMB');
  });

  it('reads the real pad sitting behind a phantom device', () => {
    const r = rig();
    r.pads[0] = throttle();
    const pad = makePad();
    r.pads[1] = pad;
    r.tick();
    pad.axes[1] = -1;
    r.tick();
    expect(r.input.device).toBe('gamepad');
    expect(r.input.move.y).toBeCloseTo(1, 5);
  });

  it('does not trust an axis that has never been seen at rest', () => {
    const r = rig();
    const pad = makePad();
    pad.axes = [-1, -1, 0, 0]; // a worn stick, or a pedal reporting as one
    r.pads[0] = pad;
    r.tick(60);
    expect(r.input.move).toEqual({ x: 0, y: 0 });
    expect(r.input.device).toBe('kbm');
    pad.axes[0] = pad.axes[1] = 0; // seen centred once: trusted from now on
    r.tick();
    pad.axes[1] = -1;
    r.tick();
    expect(r.input.move.y).toBeCloseTo(1, 5);
  });

  it('switches device on an input edge only: a stuck button cannot hold it away from the keyboard', () => {
    const r = rig();
    const pad = makePad();
    r.pads[0] = pad;
    r.tick();
    pad.buttons[4].pressed = true; // LB jammed down
    r.tick();
    expect(r.input.device).toBe('gamepad');
    r.keyDown('KeyW');
    r.tick(30);
    expect(r.input.device).toBe('kbm'); // the level alone never takes it back
    pad.buttons[0].pressed = true; // a fresh press does
    r.tick();
    expect(r.input.device).toBe('gamepad');
  });

  it('the pad used last is the active one, and unplugging it returns to the keyboard', () => {
    const r = rig();
    const xbox = makePad();
    const sony = makePad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
    r.pads[0] = xbox;
    r.pads[1] = sony;
    r.tick();
    xbox.buttons[0].pressed = true;
    r.tick();
    expect(r.input.glyph('dodge')).toBe('A');
    xbox.buttons[0].pressed = false;
    r.tick();
    sony.axes[1] = -1;
    r.tick();
    expect(r.input.glyph('dodge')).toBe('✕');
    expect(r.input.move.y).toBeCloseTo(1, 5);
    xbox.axes[0] = 1; // the idle pad's stick moving later takes over again
    r.tick();
    expect(r.input.move.x).toBeCloseTo(1, 5);
    const seen: string[] = [];
    const off = r.input.onDeviceChange((d) => seen.push(d));
    r.pads[0] = r.pads[1] = null;
    r.tick();
    expect(r.input.gamepadConnected).toBe(false);
    expect(r.input.device).toBe('kbm');
    expect(seen).toEqual(['kbm']);
    off();
    r.pads[0] = xbox;
    xbox.axes[0] = 0;
    r.tick(61); // with no pad connected the system only probes for one about once a second
    xbox.buttons[1].pressed = true;
    r.tick();
    expect(r.input.device).toBe('gamepad');
    expect(seen).toEqual(['kbm']); // unsubscribed
  });
});

describe('glyphs, layouts and rebinding', () => {
  it('prints letters as the player\'s keyboard layout shows them', async () => {
    const r = rig({ layout: { KeyQ: 'a', KeyW: 'z', Digit1: '&' } }); // AZERTY
    await Promise.resolve();
    expect(r.input.glyph('guard')).toBe('A');
    expect(r.input.glyph('ability1')).toBe('1'); // digit keys keep their digit
    expect(r.input.glyph('dodge')).toBe('Space');
    expect(keyLabel('KeyW', new Map([['KeyW', 'z']]))).toBe('Z');
    expect(keyLabel('KeyW')).toBe('W');
    expect(glyphFor('guard', 'kbm')).toBe('Q');
  });

  it('rebinds a gameplay key, swaps on conflict, persists, and refuses reserved keys', () => {
    const r = rig();
    expect(r.input.bindingOf('heavy')).toBe('KeyF');
    expect(r.input.rebind('heavy', 'KeyG')).toBe(true);
    expect(r.input.glyph('heavy')).toBe('G');
    r.keyDown('KeyF');
    r.tick();
    expect(r.input.down('heavy')).toBe(false);
    r.keyDown('KeyG');
    r.tick();
    expect(r.input.pressed('heavy')).toBe(true);
    r.keyUp('KeyG');
    r.keyUp('KeyF');

    expect(r.input.rebind('guard', 'KeyG')).toBe(true); // taken by heavy: they swap
    expect(r.input.bindingOf('guard')).toBe('KeyG');
    expect(r.input.bindingOf('heavy')).toBe('KeyQ');
    expect(r.input.rebind('dodge', 'KeyW')).toBe(false); // movement is reserved
    expect(r.input.rebind('dodge', 'Escape')).toBe(false);
    expect(r.input.rebind('attack', 'KeyK')).toBe(false); // mouse action
    expect(r.input.rebind('confirm', 'KeyK')).toBe(false);
    expect(r.input.bindingOf('attack')).toBeNull();

    // Space keeps its menu meaning when dodge moves away
    expect(r.input.rebind('dodge', 'AltRight')).toBe(false);
    expect(r.input.rebind('dodge', 'KeyX')).toBe(true);
    r.input.setContext('menu');
    r.keyDown('Space');
    r.tick();
    expect(r.input.pressed('confirm')).toBe(true);

    const again = rig({ stored: Object.fromEntries(r.store) }); // a new session reads them back
    expect(again.input.bindingOf('guard')).toBe('KeyG');
    expect(again.input.glyph('dodge')).toBe('X');
    again.input.resetBindings();
    expect(again.input.bindingOf('guard')).toBe('KeyQ');
    expect(again.input.glyph('dodge')).toBe('Space');
  });

  it('the second default key follows its action off the default and back', () => {
    const k = new Keymap();
    expect(k.get('ShiftRight')).toEqual(['sprint']);
    k.rebind('sprint', 'KeyZ');
    expect(k.get('ShiftRight')).toBeUndefined();
    expect(k.get('ShiftLeft')).toBeUndefined();
    k.rebind('sprint', 'ShiftLeft');
    expect(k.get('ShiftRight')).toEqual(['sprint']);
    k.load({ heavy: 'KeyH', bogus: 'KeyB', guard: 42 });
    expect(k.overrides()).toEqual({ heavy: 'KeyH' });
    k.load('junk');
    k.load(null);
  });
});

describe('lifecycle', () => {
  it('dispose removes every listener', () => {
    const r = rig();
    r.input.dispose();
    r.keyDown('KeyF');
    r.mouseDown(0);
    r.tick();
    expect(r.input.down('heavy')).toBe(false);
    expect(r.input.pointerLocked).toBe(false);
    expect(() => r.input.dispose()).not.toThrow();
  });
});
