import type { EventBus } from './api';

/** Typed synchronous event bus. Listener errors are isolated and reported, never thrown into emitters. */
export class Emitter<E> implements EventBus<E> {
  private map = new Map<keyof E, Array<(p: any) => void>>();

  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let list = this.map.get(type);
    if (!list) this.map.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }

  once<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, fn: (payload: E[K]) => void): void {
    const list = this.map.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.map.get(type);
    if (!list || list.length === 0) return;
    for (const fn of list.slice()) {
      try {
        fn(payload);
      } catch (err) {
        reportError(`event:${String(type)}`, err);
      }
    }
  }
}

/** Central error sink: console + window.__aurelionErrors (read by tests and the debug API). */
export function reportError(where: string, err: unknown): void {
  const msg = `[${where}] ${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`;
  console.error(msg);
  const g = globalThis as any;
  (g.__aurelionErrors ??= []).push(msg);
}
