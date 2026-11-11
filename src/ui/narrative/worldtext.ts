/**
 * World text (polish 4): legible screen-space copies of small in-world text — hologram lane labels, projected
 * text panels, signage. Each label follows a world point (or a point on a moving object), is drawn at the size
 * its world height projects to, but NEVER smaller than a minimum pixel size (given at 720p and scaled with the
 * viewport), on a dark backing plate. It hides when its anchor object is hidden or detached, when it is behind
 * the camera, off screen, beyond `maxDistance`, or seen from behind (`faces`).
 *
 * It is diegetic text, not HUD: it shows in cinematics and in the debug clean frame, and only the full-screen
 * screens (title, loading, pause, death, completion) cover it. Everything moves with transforms; text and font
 * size only touch the DOM when they change.
 */
import * as THREE from 'three';
import type { Game, Vec3Like, WorldTextOpts } from '@/core/api';
import { isStub } from '@/core/stub';
import { Num, Txt, h, warnOnce } from '../dom';

/** the viewport height the pixel sizes are given for */
export const WORLD_TEXT_REF_H = 720;
/** cap height of the label face (Barlow Condensed, upper case) as a fraction of its font size */
const CAP = 0.7;
const TONES = ['pale', 'cold', 'amber', 'gold', 'violet'] as const;
type Tone = (typeof TONES)[number];
const ALIGN_X = { left: 0, center: -50, right: -100 } as const;
type Align = keyof typeof ALIGN_X;

interface Label {
  id: string;
  el: HTMLElement;
  text: Txt;
  /** a world point (copied) or an object followed every frame */
  point: THREE.Vector3 | null;
  object: THREE.Object3D | null;
  offset: THREE.Vector3;
  faces: THREE.Vector3 | null;
  size: number;
  minPx: number;
  maxPx: number;
  maxDistance: number;
  opacity: number;
  align: Align;
  removing: boolean;
  vis: number;
  sx: number;
  sy: number;
  font: Num;
  alpha: Num;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = { x: 0, y: 0 };
const _m = new THREE.Matrix3();

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finitePoint = (p: unknown): p is Vec3Like => {
  if (!p || typeof p !== 'object') return false;
  const v = p as { x?: unknown; y?: unknown; z?: unknown };
  return finite(v.x) && finite(v.y) && finite(v.z);
};
const isObject3D = (o: unknown): o is THREE.Object3D => !!o && typeof o === 'object' && (o as THREE.Object3D).isObject3D === true;

/** an object is drawn only when it and all its parents are visible and it hangs under a scene */
function shown(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  let top: THREE.Object3D = o;
  while (cur) {
    if (!cur.visible) return false;
    top = cur;
    cur = cur.parent;
  }
  return (top as THREE.Scene).isScene === true;
}

/**
 * Font size in CSS px for a label of world cap height `size` at `dist` metres, in a viewport `vh` px tall seen
 * through a vertical field of view of `fovDeg`: what the world size projects to, clamped to [min, max] (given at
 * 720p, scaled to the viewport).
 */
export function worldTextPx(size: number, dist: number, fovDeg: number, vh: number, minPx: number, maxPx: number): number {
  const scale = vh / WORLD_TEXT_REF_H;
  const lo = minPx * scale;
  const hi = Math.max(lo, maxPx * scale);
  const fov = Number.isFinite(fovDeg) ? Math.max(1, Math.min(170, fovDeg)) : 50;
  const focal = vh / (2 * Math.tan((fov * Math.PI) / 360));
  const projected = (size * focal) / Math.max(0.05, Number.isFinite(dist) ? dist : 0.05) / CAP;
  return Math.min(hi, Math.max(lo, projected));
}

export class WorldText {
  readonly el: HTMLElement;
  private readonly labels = new Map<string, Label>();

  constructor(private readonly game: Game) {
    this.el = h('div', 'aur-layer aur-wtext');
  }

  set(id: string, opts: WorldTextOpts | null): void {
    const key = String(id);
    let l = this.labels.get(key);
    if (!opts) {
      if (l) l.removing = true;
      return;
    }
    const at = opts.at as unknown;
    const object = isObject3D(at) ? at : null;
    if (!object && !finitePoint(at)) {
      warnOnce(`worldText:${key}`, `worldText "${key}" ignored: \`at\` is neither a finite point nor an Object3D`);
      return;
    }
    if (!l) {
      l = this.create(key);
      this.labels.set(key, l);
    }
    l.removing = false;
    l.object = object;
    l.point = object ? null : (l.point ?? new THREE.Vector3()).set((at as Vec3Like).x, (at as Vec3Like).y, (at as Vec3Like).z);
    const off = opts.offset;
    if (finitePoint(off)) l.offset.set(off.x, off.y, off.z);
    else l.offset.set(0, 0, 0);
    l.faces = finitePoint(opts.faces) && Math.hypot(opts.faces.x, opts.faces.y, opts.faces.z) > 1e-6
      ? (l.faces ?? new THREE.Vector3()).set(opts.faces.x, opts.faces.y, opts.faces.z).normalize()
      : null;
    l.size = finite(opts.size) && opts.size > 0 ? opts.size : 0.05;
    l.minPx = finite(opts.minPx) && opts.minPx > 0 ? opts.minPx : 17;
    l.maxPx = finite(opts.maxPx) && opts.maxPx > 0 ? opts.maxPx : 36;
    l.maxDistance = finite(opts.maxDistance) && opts.maxDistance > 0 ? opts.maxDistance : 30;
    l.opacity = finite(opts.opacity) ? Math.max(0, Math.min(1, opts.opacity)) : 1;
    let tone: Tone = 'pale';
    if (opts.tone !== undefined) {
      if ((TONES as readonly string[]).includes(opts.tone)) tone = opts.tone as Tone;
      else warnOnce(`worldTextTone:${String(opts.tone)}`, `worldText tone "${String(opts.tone)}" is unknown — using 'pale'`);
    }
    let align: Align = 'center';
    if (opts.align !== undefined) {
      if (opts.align in ALIGN_X) align = opts.align as Align;
      else warnOnce(`worldTextAlign:${String(opts.align)}`, `worldText align "${String(opts.align)}" is unknown — using 'center'`);
    }
    l.align = align;
    if (l.el.dataset.tone !== tone) l.el.dataset.tone = tone;
    if (l.el.dataset.align !== align) {
      l.el.dataset.align = align;
      l.sx = Number.NaN; // the anchor point within the box changed: re-place
    }
    const plate = opts.plate !== false ? '1' : '0';
    if (l.el.dataset.plate !== plate) l.el.dataset.plate = plate;
    l.text.set(String(opts.text ?? '').trim());
  }

  /** drop every label at once (a zone change: their anchors are gone) */
  clear(): void {
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
  }

  get size(): number {
    return this.labels.size;
  }

  private create(id: string): Label {
    const span = h('span', 'aur-wt-text');
    const el = h('div', 'aur-wt', span);
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    this.el.appendChild(el);
    return {
      id, el, text: new Txt(span), point: null, object: null, offset: new THREE.Vector3(), faces: null,
      size: 0.05, minPx: 17, maxPx: 36, maxDistance: 30, opacity: 1, align: 'center', removing: false, vis: 0,
      sx: Number.NaN, sy: Number.NaN,
      font: new Num((v) => { el.style.fontSize = `${v.toFixed(1)}px`; }, 0.25),
      alpha: new Num((v) => {
        el.style.opacity = v.toFixed(3);
        el.style.visibility = v <= 0.002 ? 'hidden' : 'visible';
      }, 0.004),
    };
  }

  /** where the label should be now, or null when it should not show */
  private place(l: Label, cam: THREE.PerspectiveCamera, w: number, vh: number): { x: number; y: number; px: number } | null {
    if (l.text.value === '' || l.opacity <= 0) return null;
    if (l.object) {
      if (!shown(l.object)) return null;
      _p.copy(l.offset).applyMatrix4(l.object.matrixWorld);
    } else if (l.point) {
      _p.copy(l.point).add(l.offset);
    } else return null;
    cam.getWorldPosition(_c);
    const dist = _p.distanceTo(_c);
    if (!(dist <= l.maxDistance)) return null;
    if (l.faces && l.object) {
      _n.copy(l.faces).applyMatrix3(_m.setFromMatrix4(l.object.matrixWorld)).normalize();
      if (_n.dot(_c.sub(_p)) <= 0) return null;
    } else if (l.faces) {
      if (_n.copy(l.faces).dot(_c.sub(_p)) <= 0) return null;
    }
    let front = false;
    try {
      front = this.game.camera.worldToScreen(_p, _s) === true;
    } catch {
      front = false;
    }
    if (!front || _s.x < -w * 0.25 || _s.x > w * 1.25 || _s.y < -vh * 0.25 || _s.y > vh * 1.25) return null;
    return { x: _s.x, y: _s.y, px: worldTextPx(l.size, dist, cam.fov, vh, l.minPx, l.maxPx) };
  }

  update(dt: number, w: number, vh: number, covered: boolean): void {
    if (this.labels.size === 0) return;
    const camSys = this.game.camera;
    const cam = camSys && !isStub(camSys) ? (camSys.camera as THREE.PerspectiveCamera | undefined) : undefined;
    const camOk = !!cam && (cam as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    for (const l of [...this.labels.values()]) {
      const at = !covered && !l.removing && camOk ? this.place(l, cam!, w, vh) : null;
      const want = at ? 1 : 0;
      l.vis += Math.sign(want - l.vis) * Math.min(Math.abs(want - l.vis), dt * 6);
      if (l.removing && l.vis <= 0) {
        l.el.remove();
        this.labels.delete(l.id);
        continue;
      }
      l.alpha.set(l.vis * l.opacity);
      if (!at) continue;
      l.font.set(at.px);
      if (!(Math.abs(at.x - l.sx) <= 0.15 && Math.abs(at.y - l.sy) <= 0.15)) {
        l.sx = at.x;
        l.sy = at.y;
        l.el.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0) translate(${ALIGN_X[l.align]}%, -50%)`;
      }
    }
  }
}
