/**
 * TEST SUPPORT ONLY — a tiny in-memory DOM so the UI state machines can be exercised by vitest in the node
 * environment (the project has no jsdom). Implements exactly the surface the UI touches; layout queries return
 * zero-sized boxes. Never imported by game code.
 */

type Handler = (e: unknown) => void;

class FakeClassList {
  private readonly set = new Set<string>();
  constructor(private readonly owner: FakeElement) {}
  add(...c: string[]): void { for (const x of c) this.set.add(x); }
  remove(...c: string[]): void { for (const x of c) this.set.delete(x); }
  contains(c: string): boolean { return this.set.has(c); }
  toggle(c: string, force?: boolean): boolean {
    const on = force === undefined ? !this.set.has(c) : force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  assign(v: string): void {
    this.set.clear();
    for (const x of v.split(/\s+/).filter(Boolean)) this.set.add(x);
  }
  toString(): string { return [...this.set].join(' '); }
  get owned(): FakeElement { return this.owner; }
}

class FakeStyle {
  [key: string]: unknown;
  private readonly props = new Map<string, string>();
  setProperty(name: string, value: string): void { this.props.set(name, value); }
  getPropertyValue(name: string): string { return this.props.get(name) ?? ''; }
}

export class FakeNode {
  parentNode: FakeElement | null = null;
  constructor(public text = '') {}
  get textContent(): string { return this.text; }
  set textContent(v: string) { this.text = v; }
  remove(): void { this.parentNode?.removeChild(this); }
}

export class FakeElement extends FakeNode {
  readonly childNodes: FakeNode[] = [];
  readonly classList = new FakeClassList(this);
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string> = {};
  readonly attrs: Record<string, string> = {};
  readonly handlers = new Map<string, Handler[]>();
  clientWidth = 0;
  clientHeight = 0;

  constructor(readonly tagName: string) { super(''); }

  get className(): string { return this.classList.toString(); }
  set className(v: string) { this.classList.assign(v); }

  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get children(): FakeElement[] { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  get childElementCount(): number { return this.children.length; }

  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  override set textContent(v: string) {
    this.childNodes.length = 0;
    if (v) this.appendChild(new FakeNode(v));
  }

  get innerHTML(): string { return this.attrs.__html ?? ''; }
  set innerHTML(v: string) { this.attrs.__html = v; }

  appendChild<T extends FakeNode>(n: T): T {
    n.parentNode?.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  append(...nodes: FakeNode[]): void { for (const n of nodes) this.appendChild(n); }
  removeChild(n: FakeNode): void {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
  }
  replaceChildren(): void { this.childNodes.length = 0; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | null { return this.attrs[k] ?? null; }
  addEventListener(type: string, fn: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  /** fire a DOM event at this element (tests) */
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const fn of this.handlers.get(type) ?? []) fn({ stopPropagation() {}, preventDefault() {}, ...event });
  }
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  setPointerCapture(): void { /* no-op */ }

  /** depth-first search by class name (tests) */
  find(cls: string): FakeElement | null {
    for (const c of this.children) {
      if (c.classList.contains(cls)) return c;
      const hit = c.find(cls);
      if (hit) return hit;
    }
    return null;
  }
  findAll(cls: string, out: FakeElement[] = []): FakeElement[] {
    for (const c of this.children) {
      if (c.classList.contains(cls)) out.push(c);
      c.findAll(cls, out);
    }
    return out;
  }
}

/** Install the fake `document` on globalThis; returns a fresh root element to mount into. */
export function installFakeDom(): FakeElement {
  const doc = {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => new FakeNode(text),
    createRange: () => { throw new Error('no layout'); },
    fonts: undefined,
  };
  (globalThis as unknown as { document: unknown }).document = doc;
  return new FakeElement('div');
}
