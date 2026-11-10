/**
 * Option sanitising for the scenic factories. Zone data reaches these builders from hand-written tables and
 * scripts, so every number is forced finite and into a sane range before it can reach a vertex buffer or a loop
 * bound (hard rule: bad input never throws, never hangs, never produces NaN geometry).
 */

/** `v` if it is a finite number, else `fallback`; then clamped to [min, max]. */
export function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return n < min ? min : n > max ? max : n;
}

/** As `num`, rounded to an integer. */
export function int(v: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(v, fallback, min, max));
}

/** A usable 32-bit seed from anything. */
export function seedOf(v: unknown, fallback = 7283): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(Math.abs(v)) >>> 0 : fallback;
}

/** Options object or `{}` — null, undefined and non-objects all mean "defaults". */
export function bag<T extends object>(o: T | null | undefined): Partial<T> {
  return o && typeof o === 'object' ? o : {};
}
