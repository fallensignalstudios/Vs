/** Small defensive helpers: subsystems around combat may be null-object stubs or return junk. */
import { isStub } from '@/core/stub';

/** finite number or fallback (stubs coerce to 0 / NaN — never trust them) */
export const fin = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** a real object: not null and not a null-object stub */
export function live<T>(o: T | null | undefined): o is T {
  return o != null && !isStub(o);
}

const warned = new Set<string>();
/** console.warn once per key */
export function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[combat] ${msg}`);
}

/** run `fn`, reporting (once per key) instead of throwing */
export function guarded(key: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    warnOnce(key, `${key} threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}
