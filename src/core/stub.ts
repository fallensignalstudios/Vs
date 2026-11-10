/**
 * Null-object stand-in for a subsystem that is not implemented yet (or failed to construct).
 * Any property read returns another null object; any call is a no-op. Warns once per member.
 * This keeps the Game bootable while subsystems are developed in parallel.
 */
export function nullObject<T>(name: string): T {
  const warned = new Set<string>();
  const target = function () {} as unknown as Record<string | symbol, unknown>;
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(_t, prop) {
      if (prop === 'then') return undefined; // never thenable
      if (prop === '__isStub') return true;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === Symbol.iterator) return function* () {};
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'length' || prop === 'size') return 0;
      if (!warned.has(prop)) {
        warned.add(prop);
        if ((globalThis as any).__aurelionVerboseStubs) console.warn(`[stub] ${name}.${prop}`);
      }
      return nullObject(`${name}.${prop}`);
    },
    apply() {
      return nullObject(`${name}()`);
    },
    set() {
      return true;
    },
    has() {
      return false;
    },
  };
  return new Proxy(target, handler) as unknown as T;
}

export function isStub(o: unknown): boolean {
  return !!o && (typeof o === 'function' || typeof o === 'object') && (o as any).__isStub === true;
}
