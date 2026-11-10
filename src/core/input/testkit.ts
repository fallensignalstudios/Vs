/** Shared fixtures for the input unit tests: a fake browser environment the real InputSystemImpl binds to. */
import type { Game, GameEvents, Settings } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import type { PadLike } from './gamepad';
import { InputSystemImpl, type InputEnv } from './system';

export const DT = 1 / 60;

export interface FakePad extends PadLike {
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
  rumbles: Array<Record<string, number>>;
}

export function makePad(id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'): FakePad {
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

export function rig(opts: { lock?: 'grant' | 'reject' | 'none'; settings?: Partial<Settings> } = {}) {
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
