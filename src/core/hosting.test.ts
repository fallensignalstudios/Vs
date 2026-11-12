/**
 * (ship) Hosted in a (possibly sandboxed) iframe: pointer lock may be missing, throw, reject or fire
 * 'pointerlockerror'. Each of those must leave the input system in drag-look mode, flag the lock as unavailable
 * (the one-line hint) — and a quiet re-lock refused after a menu must not.
 */
import { describe, expect, it } from 'vitest';
import type { Game } from './api';
import { DRAG_LOOK_HINT, installHostingHints } from './hosting';
import { MOUSE_RAD_PER_PX } from './input/system';
import { rig } from './input/testkit';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('pointer lock unavailable (hosted iframe)', () => {
  it('missing API: unavailable from the start, RMB drag turns the camera', () => {
    const r = rig({ lock: 'none' });
    expect(r.input.pointerLockDenied).toBe(true);
    r.mouseDown(2);
    r.mouseMove(30, 0);
    r.tick();
    expect(r.input.look.x).toBeCloseTo(-30 * MOUSE_RAD_PER_PX, 8);
  });

  it('a rejected request (sandboxed frame) makes it unavailable', async () => {
    const r = rig({ lock: 'reject' });
    expect(r.input.pointerLockDenied).toBe(false);
    r.mouseDown(0);
    await flush();
    expect(r.input.pointerLockDenied).toBe(true);
    expect(r.input.lookMode).toBe('drag');
  });

  it('a request that throws makes it unavailable, and nothing escapes', () => {
    const r = rig({ lock: 'grant' });
    r.canvas.requestPointerLock = () => {
      throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
    };
    expect(() => r.mouseDown(0)).not.toThrow();
    expect(r.input.pointerLockDenied).toBe(true);
    expect(r.input.pointerLocked).toBe(false);
  });

  it("'pointerlockerror' (old API, no promise) makes it unavailable; acquiring the lock later clears it", () => {
    const r = rig({ lock: 'grant' });
    const grant = r.canvas.requestPointerLock!;
    r.canvas.requestPointerLock = () => undefined as unknown as Promise<void>;
    r.mouseDown(0);
    r.doc.dispatchEvent(new Event('pointerlockerror'));
    expect(r.input.pointerLockDenied).toBe(true);
    r.mouseUp(0);
    r.canvas.requestPointerLock = grant;
    r.tick(120); // past the retry cooldown
    r.mouseDown(0);
    expect(r.input.pointerLocked).toBe(true);
    expect(r.input.pointerLockDenied).toBe(false);
  });

  it('a granted lock is never flagged', async () => {
    const r = rig({ lock: 'grant' });
    r.mouseDown(0);
    await flush();
    expect(r.input.pointerLocked).toBe(true);
    expect(r.input.pointerLockDenied).toBe(false);
  });
});

describe('drag-look hint', () => {
  function fakeGame(denied: boolean) {
    const toasts: Array<[string, string | undefined]> = [];
    const input = { context: 'game', device: 'kbm', pointerLockDenied: denied, virtual: { active: false } };
    let ticks = 0;
    const game = {
      phase: 'playing', paused: false, input,
      ui: { toast: (t: string, k?: string) => toasts.push([t, k]) },
      tick: () => {
        ticks++;
      },
    };
    return { game: game as unknown as Game & { phase: string; paused: boolean }, input, toasts, ticks: () => ticks };
  }

  it('shows one line, once, only in play with the lock unavailable — and keeps ticking the game', () => {
    const f = fakeGame(false);
    installHostingHints(f.game);
    f.game.tick(0.016);
    expect(f.toasts).toEqual([]);
    f.input.pointerLockDenied = true;
    f.input.virtual.active = true; // the bot is driving: nobody to tell
    f.game.tick(0.016);
    expect(f.toasts).toEqual([]);
    f.input.virtual.active = false;
    f.input.context = 'menu';
    f.game.tick(0.016);
    expect(f.toasts).toEqual([]);
    f.input.context = 'game';
    f.game.tick(0.016);
    f.game.tick(0.016);
    expect(f.toasts).toEqual([[DRAG_LOOK_HINT, 'info']]);
    expect(DRAG_LOOK_HINT.includes('\n')).toBe(false);
    expect(f.ticks()).toBe(5);
  });

  it('says nothing to a gamepad player', () => {
    const f = fakeGame(true);
    f.input.device = 'gamepad';
    installHostingHints(f.game);
    f.game.tick(0.016);
    expect(f.toasts).toEqual([]);
  });
});
