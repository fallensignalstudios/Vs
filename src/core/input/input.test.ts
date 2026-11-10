import { describe, expect, it, vi } from 'vitest';
import { ACTIONS, CONTEXT_MASK, MENU_REPEAT_DELAY, MENU_REPEAT_INTERVAL } from './actions';
import { glyphFor, padStyleFromId } from './bindings';
import { DT, rig } from './testkit';

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
  });

  it('menus: a focused button activates natively and only natively; during play the game owns the key', () => {
    const r = rig();
    const button = { tagName: 'BUTTON' };
    r.input.setContext('menu');
    expect(r.keyDown('Enter', { target: button }).defaultPrevented).toBe(false);
    r.tick();
    expect(r.input.pressed('confirm')).toBe(false); // no double activation
    r.keyUp('Enter');
    r.keyDown('Enter'); // nothing focused: the input system reports it
    r.tick();
    expect(r.input.pressed('confirm')).toBe(true);
    r.keyUp('Enter');
    r.tick();
    r.input.setContext('game');
    r.tick();
    // a stale, still-focused UI button must not eat Space (dodge) or get clicked by it
    expect(r.keyDown('Space', { target: button }).defaultPrevented).toBe(true);
    r.tick();
    expect(r.input.pressed('dodge')).toBe(true);
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

describe('hold-to-toggle accessibility', () => {
  it('engaged() mirrors down() normally and latches with settings.holdToToggle', () => {
    const r = rig();
    r.keyDown('KeyQ');
    r.tick();
    expect(r.input.engaged('guard')).toBe(true);
    r.keyUp('KeyQ');
    r.tick();
    expect(r.input.engaged('guard')).toBe(false);

    r.settings.set('holdToToggle', true);
    r.keyDown('KeyQ');
    r.tick();
    r.keyUp('KeyQ');
    r.tick(20);
    expect(r.input.down('guard')).toBe(false);
    expect(r.input.engaged('guard')).toBe(true); // stays engaged after the tap
    r.keyDown('KeyQ');
    r.tick();
    r.keyUp('KeyQ');
    r.tick();
    expect(r.input.engaged('guard')).toBe(false); // second tap releases

    r.keyDown('KeyE');
    r.tick();
    r.keyUp('KeyE');
    r.tick();
    expect(r.input.engaged('interact')).toBe(true);
    r.input.disengage('interact'); // the interaction completed
    expect(r.input.engaged('interact')).toBe(false);

    r.keyDown('KeyQ');
    r.tick();
    r.keyUp('KeyQ');
    r.tick();
    expect(r.input.engaged('guard')).toBe(true);
    r.input.setContext('menu'); // a context switch always drops latches
    r.input.setContext('game');
    r.tick();
    expect(r.input.engaged('guard')).toBe(false);
  });
});
