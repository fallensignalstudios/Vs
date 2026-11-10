/**
 * Tiny DOM toolkit for the UI overlay: element builders, change-cached writers (so `update()` only touches the
 * DOM when a value really changed) and dt-driven visibility faders (deterministic under headless stepping —
 * no CSS transitions for anything stateful).
 */

export type Child = Node | string | null | undefined | false;

/** Create an element with a class list and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Inline SVG from STATIC, trusted markup (icon tables in theme.ts). Never pass user/script text here.
 */
export function svg(viewBox: string, cls: string | null, inner: string): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  if (cls) el.setAttribute('class', cls);
  el.innerHTML = inner;
  return el;
}

/** Text writer that only touches the DOM when the string changes. */
export class Txt {
  private v: string | null = null;
  constructor(readonly el: HTMLElement | SVGElement) {}
  set(v: string): boolean {
    if (v === this.v) return false;
    this.v = v;
    this.el.textContent = v;
    return true;
  }
  get value(): string {
    return this.v ?? '';
  }
}

/** Class toggle that only touches the DOM on change. */
export class Flag {
  private v: boolean | null = null;
  constructor(private readonly el: Element, private readonly cls: string) {}
  set(on: boolean): boolean {
    if (on === this.v) return false;
    this.v = on;
    this.el.classList.toggle(this.cls, on);
    return true;
  }
  get value(): boolean {
    return this.v === true;
  }
}

/** Numeric writer with an epsilon; `apply` runs only when the value moved by more than `eps`. */
export class Num {
  private v = Number.NaN;
  constructor(private readonly apply: (v: number) => void, private readonly eps = 0.002) {}
  set(v: number): boolean {
    if (this.v === this.v && Math.abs(v - this.v) <= this.eps) return false;
    this.v = v;
    this.apply(v);
    return true;
  }
  /** force the next set() through */
  invalidate(): void {
    this.v = Number.NaN;
  }
}

/** Attribute/dataset writer cached by value. */
export class Attr {
  private v: string | null = null;
  constructor(private readonly el: Element, private readonly name: string) {}
  set(v: string): boolean {
    if (v === this.v) return false;
    this.v = v;
    this.el.setAttribute(this.name, v);
    return true;
  }
}

let reducedMotionQuery: MediaQueryList | null = null;

/** `prefers-reduced-motion: reduce` (live). Slides, drifts and pulses are suppressed; fades stay. */
export function reducedMotion(): boolean {
  if (!reducedMotionQuery) {
    try {
      reducedMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    } catch {
      reducedMotionQuery = null;
    }
  }
  return reducedMotionQuery?.matches === true;
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) * (-2 * t + 2) * 0.5);

export interface FaderOpts {
  /** seconds to appear / disappear */
  in?: number;
  out?: number;
  /** CSS display value while visible (default 'block') */
  display?: string;
  /** keep the element's box while hidden (visibility instead of display) so reveals never shift layout */
  keepLayout?: boolean;
}

/**
 * dt-driven show/hide. Writes `opacity` and the custom property `--k` (1 = fully hidden offset … 0 = settled),
 * which stylesheets use for slide/scale offsets: `transform: translate3d(0, calc(var(--u) * 10 * var(--k)), 0)`.
 * The element is `display:none` while fully hidden so it costs nothing.
 */
export class Fader {
  /** 0..1 linear visibility */
  level = 0;
  private target = 0;
  private shown = false;
  private lastOpacity = -1;
  private readonly tin: number;
  private readonly tout: number;
  private readonly display: string;
  private readonly keepLayout: boolean;

  constructor(readonly el: HTMLElement, opts: FaderOpts = {}) {
    this.tin = opts.in ?? 0.28;
    this.tout = opts.out ?? 0.22;
    this.display = opts.display ?? 'block';
    this.keepLayout = opts.keepLayout === true;
    if (this.keepLayout) {
      el.style.display = this.display;
      el.style.visibility = 'hidden';
    } else {
      el.style.display = 'none';
    }
    el.style.opacity = '0';
  }

  get on(): boolean {
    return this.target === 1;
  }

  /** true while anything is on screen (including fading out) */
  get visible(): boolean {
    return this.shown;
  }

  show(on: boolean, instant = false): void {
    this.target = on ? 1 : 0;
    if (instant) {
      this.level = this.target;
      this.apply();
    } else if (on && !this.shown) {
      this.apply();
    }
  }

  /** advance; returns true while visible */
  update(dt: number): boolean {
    if (this.level !== this.target) {
      const dur = this.target > this.level ? this.tin : this.tout;
      const step = dur <= 0 ? 1 : dt / dur;
      this.level = this.target > this.level ? Math.min(1, this.level + step) : Math.max(0, this.level - step);
      this.apply();
    }
    return this.shown;
  }

  private apply(): void {
    const want = this.level > 0 || this.target > 0;
    if (want !== this.shown) {
      this.shown = want;
      if (this.keepLayout) this.el.style.visibility = want ? 'visible' : 'hidden';
      else this.el.style.display = want ? this.display : 'none';
    }
    if (!want) return;
    const e = this.target >= this.level ? easeOutCubic(this.level) : this.level * this.level;
    const o = Math.round(e * 1000) / 1000;
    if (o !== this.lastOpacity) {
      this.lastOpacity = o;
      this.el.style.opacity = String(o);
      this.el.style.setProperty('--k', reducedMotion() ? '0' : String(Math.round((1 - e) * 1000) / 1000));
    }
  }
}

/** Remove all children. */
export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const warned = new Set<string>();

/** console.warn once per key (bad input never throws — BRIEF rule 5). */
export function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[ui] ${msg}`);
}
