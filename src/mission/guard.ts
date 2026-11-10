/**
 * Error isolation for zone routines. The script runner ends a whole routine when its generator throws; a
 * 50-minute mission cannot hang on one bad line of a beat. `guarded` drives a routine (and every routine it
 * yields, alone or inside all/race waits) so that an exception ends only the routine that threw: it is
 * reported once and the caller continues.
 */
import type { Routine, Wait } from '@/core/api';
import { reportError } from '@/core/events';

type Gen = Generator<Wait, unknown, unknown>;

const isGen = (v: unknown): v is Gen => !!v && typeof (v as Gen).next === 'function' && typeof (v as Gen).return === 'function';

function guardWait(w: Wait, label: string, onError?: (err: unknown) => void): Wait {
  if (isGen(w)) return guarded(w, label, onError);
  if (Array.isArray(w)) return w.map((c) => guardWait(c, label, onError));
  if (w && typeof w === 'object' && Array.isArray((w as { race: Wait[] }).race)) {
    return { race: (w as { race: Wait[] }).race.map((c) => guardWait(c, label, onError)) };
  }
  return w;
}

/**
 * Wrap `inner` so an exception thrown inside it (at any nesting depth) is reported as `label` and ends that
 * routine only. `finally` blocks of the routine still run when the wrapper is stopped from outside.
 * Resolves with the routine's return value, or undefined when it threw.
 */
export function* guarded<T>(inner: Routine<T> | Gen, label: string, onError?: (err: unknown) => void): Routine<T | undefined> {
  let send: unknown;
  let finished = false;
  try {
    for (;;) {
      let r: IteratorResult<Wait, unknown>;
      try {
        r = (inner as Gen).next(send);
      } catch (err) {
        finished = true;
        reportError(label, err);
        onError?.(err);
        return undefined;
      }
      if (r.done) {
        finished = true;
        return r.value as T;
      }
      send = yield guardWait(r.value, label, onError);
    }
  } finally {
    if (!finished) {
      try {
        (inner as Gen).return(undefined);
      } catch (err) {
        reportError(`${label}:stop`, err);
      }
    }
  }
}
