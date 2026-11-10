/**
 * Coroutine script runner. See the scripting model in src/core/api/mission.ts.
 *
 *   yield <number>        wait sim seconds            yield <() => boolean>  wait until true
 *   yield* routine        run sub-routine             yield [a, b]           all in parallel
 *   yield { race: [..] }  first to finish wins        yield                  wait one tick
 *
 * fastForward collapses time waits (and single-tick waits) to zero — used for cinematic skip, which must apply
 * exactly the same state as watching.
 */
import type { Routine, ScriptHandle, ScriptRunner, Wait } from './api';
import { reportError } from './events';

type Gen = Generator<Wait, unknown, unknown>;

type WaitState =
  | { kind: 'time'; remaining: number }
  | { kind: 'pred'; fn: () => boolean }
  | { kind: 'tick'; armed: boolean }
  | { kind: 'all'; children: Handle[] }
  | { kind: 'race'; children: Handle[] };

const isGen = (v: unknown): v is Gen => !!v && typeof (v as Gen).next === 'function' && typeof (v as Gen).return === 'function';

/** Max generator resumptions per handle per tick (guards `while(true) yield 0` style loops). */
const RESUME_BUDGET = 4000;

class Handle implements ScriptHandle {
  done = false;
  fastForward = false;
  private stack: Gen[] = [];
  private wait: WaitState | null = null;
  private send: unknown = undefined;

  constructor(
    root: Gen,
    readonly name: string,
    readonly group: string,
  ) {
    this.stack.push(root);
  }

  stop(): void {
    if (this.done) return;
    this.done = true;
    this.cancelChildren();
    // unwind so `finally` blocks run (camera restore, HUD restore…)
    while (this.stack.length) {
      const g = this.stack.pop()!;
      try {
        g.return(undefined);
      } catch (err) {
        reportError(`script:${this.name}:stop`, err);
      }
    }
  }

  private cancelChildren(): void {
    const w = this.wait;
    if (w && (w.kind === 'all' || w.kind === 'race')) for (const c of w.children) c.stop();
    this.wait = null;
  }

  /** returns true when finished */
  advance(dt: number): boolean {
    if (this.done) return true;
    let budget = RESUME_BUDGET;
    let timeCredit = dt;

    for (;;) {
      const w = this.wait;
      if (w) {
        if (w.kind === 'time') {
          if (this.fastForward) w.remaining = 0;
          else {
            const used = Math.min(w.remaining, timeCredit);
            w.remaining -= used;
            timeCredit -= used;
          }
          if (w.remaining > 1e-9) return false;
        } else if (w.kind === 'pred') {
          let ok = false;
          try {
            ok = !!w.fn();
          } catch (err) {
            reportError(`script:${this.name}:until`, err);
            ok = true; // do not deadlock on a throwing predicate
          }
          if (!ok) return false;
        } else if (w.kind === 'tick') {
          if (!w.armed && !this.fastForward) {
            w.armed = true;
            return false;
          }
        } else if (w.kind === 'all') {
          let allDone = true;
          for (const c of w.children) {
            c.fastForward = c.fastForward || this.fastForward;
            if (!c.advance(dt)) allDone = false;
          }
          if (!allDone) return false;
        } else if (w.kind === 'race') {
          let winner = false;
          for (const c of w.children) {
            c.fastForward = c.fastForward || this.fastForward;
            if (c.advance(dt)) {
              winner = true;
              break;
            }
          }
          if (!winner) return false;
          for (const c of w.children) c.stop();
        }
        this.wait = null;
      }

      if (--budget <= 0) return false;

      const top = this.stack[this.stack.length - 1];
      let r: IteratorResult<Wait, unknown>;
      try {
        r = top.next(this.send);
      } catch (err) {
        reportError(`script:${this.name}`, err);
        this.done = true;
        this.stack.length = 0;
        return true;
      }
      this.send = undefined;

      if (r.done) {
        this.stack.pop();
        if (this.stack.length === 0) {
          this.done = true;
          return true;
        }
        this.send = r.value;
        continue;
      }

      const y = r.value as Wait;
      if (typeof y === 'number') {
        if (y > 0) this.wait = { kind: 'time', remaining: y };
      } else if (typeof y === 'function') {
        this.wait = { kind: 'pred', fn: y as () => boolean };
      } else if (isGen(y)) {
        this.stack.push(y);
      } else if (Array.isArray(y)) {
        this.wait = { kind: 'all', children: y.map((c, i) => wrap(c, `${this.name}/all${i}`, this.group)) };
      } else if (y && typeof y === 'object' && Array.isArray((y as { race: Wait[] }).race)) {
        this.wait = { kind: 'race', children: (y as { race: Wait[] }).race.map((c, i) => wrap(c, `${this.name}/race${i}`, this.group)) };
      } else {
        this.wait = { kind: 'tick', armed: false };
      }
    }
  }
}

function wrap(w: Wait, name: string, group: string): Handle {
  if (isGen(w)) return new Handle(w, name, group);
  return new Handle(
    (function* (): Gen {
      yield w;
      return undefined;
    })(),
    name,
    group,
  );
}

export class ScriptRunnerImpl implements ScriptRunner {
  private handles: Handle[] = [];

  get active(): number {
    return this.handles.length;
  }

  start(routine: Routine<unknown>, opts?: { name?: string; group?: string }): ScriptHandle {
    const h = new Handle(routine as Gen, opts?.name ?? 'routine', opts?.group ?? 'default');
    this.handles.push(h);
    return h;
  }

  stopGroup(group: string): void {
    for (const h of this.handles.slice()) if (h.group === group) h.stop();
    this.handles = this.handles.filter((h) => !h.done);
  }

  stopAll(): void {
    for (const h of this.handles.slice()) h.stop();
    this.handles = [];
  }

  update(dt: number): void {
    if (this.handles.length === 0) return;
    // iterate a snapshot: routines may start new routines
    const snapshot = this.handles.slice();
    for (const h of snapshot) h.advance(dt);
    this.handles = this.handles.filter((h) => !h.done);
  }
}

/** Helpers usable inside routines. */
export function* waitSeconds(s: number): Routine {
  yield s;
}
export function* waitUntil(pred: () => boolean): Routine {
  yield pred;
}
/** Run `body(t01)` every tick for `seconds`; when fast-forwarding it is called once with 1. */
export function* tween(seconds: number, body: (t: number) => void, isSkipping?: () => boolean): Routine {
  let t = 0;
  if (seconds <= 0) {
    body(1);
    return;
  }
  // time is measured in sim seconds through numeric yields of one tick each
  const step = 1 / 60;
  while (t < seconds) {
    if (isSkipping?.()) break;
    body(t / seconds);
    yield step;
    t += step;
  }
  body(1);
}
