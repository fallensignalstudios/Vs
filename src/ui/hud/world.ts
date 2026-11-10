/**
 * World-projected HUD: enemy pips (thin hp + poise, chain glyph when linked, diamond when a weak point is
 * exposed) over hostile targetable actors within 40 m, and world markers with distance and edge-of-screen
 * clamping arrows. Everything moves with transforms only — no layout work per frame.
 */
import type { Actor, Game, Vec3Like, WorldMarkerOpts } from '@/core/api';
import { isStub } from '@/core/stub';
import { Flag, Num, Txt, h, warnOnce } from '../dom';
import { bearingToEdge, clamp01, clampN, edgeClamp, fmtDistance, num, relAngle } from '../logic';
import { ICON, MARKER_ICON, icon, type MarkerKind } from '../theme';
import type { HudFrame } from './frame';
import * as THREE from 'three';

const PIP_RANGE = 40;
const PIP_POOL_MAX = 16;
const GHOST_HOLD = 0.35;

interface Pip {
  el: HTMLElement;
  actorId: number;
  seen: number;
  vis: number;
  x: number;
  y: number;
  scale: number;
  ghostV: number;
  ghostHold: number;
  lastHp: number;
  hot: number;
  opacity: Num;
  hp: Num;
  ghost: Num;
  poise: Num;
  linked: Flag;
  exposed: Flag;
  frozen: Flag;
  stagger: Flag;
  elite: Flag;
  emph: Flag;
}

interface Marker {
  id: string;
  el: HTMLElement;
  shape: SVGSVGElement;
  kind: MarkerKind;
  pos: { x: number; y: number; z: number };
  hideWithin: number;
  removing: boolean;
  vis: number;
  x: number;
  y: number;
  /** last position written to the DOM */
  sx: number;
  sy: number;
  /** which side of the centre column a bottom-edge marker keeps to (hysteresis) */
  side: -1 | 1;
  placed: boolean;
  label: Txt;
  dist: Txt;
  edge: Flag;
  hasLabel: Flag;
  opacity: Num;
  arrow: Num;
}

const tmpP = { x: 0, y: 0, z: 0 };
const tmpS = { x: 0, y: 0 };
const tmpE = { x: 0, y: 0 };
const tmpF = new THREE.Vector3();
const KINDS: readonly MarkerKind[] = ['objective', 'optional', 'return', 'interact', 'companion', 'threat'];

export class WorldHud {
  /** container for pips + markers (sits under the HUD panels) */
  readonly el: HTMLElement;
  private readonly pipLayer: HTMLElement;
  private readonly markerLayer: HTMLElement;
  private readonly pips = new Map<number, Pip>();
  private readonly freePips: Pip[] = [];
  private readonly markers = new Map<string, Marker>();
  private frame = 0;
  private focus: Actor | null = null;

  constructor(private readonly game: Game) {
    this.pipLayer = h('div', 'aur-layer aur-pips');
    this.markerLayer = h('div', 'aur-layer aur-markers');
    this.el = h('div', 'aur-layer aur-world', this.markerLayer, this.pipLayer);
  }

  focusActor(actor: Actor | null): void {
    this.focus = actor && !isStub(actor) ? actor : null;
  }

  // ------------------------------------------------------------------------------------------ markers
  marker(id: string, pos: Vec3Like | null, options?: WorldMarkerOpts | null): void {
    const opts = options ?? {};
    const key = String(id);
    let m = this.markers.get(key);
    if (!pos) {
      if (m) m.removing = true;
      return;
    }
    const x = num(pos.x, Number.NaN);
    const y = num(pos.y, 0);
    const z = num(pos.z, Number.NaN);
    if (Number.isNaN(x) || Number.isNaN(z)) {
      warnOnce(`marker:${key}`, `marker "${key}" ignored: position is not finite`);
      return;
    }
    let kind: MarkerKind = opts.kind ?? m?.kind ?? 'objective';
    if (!KINDS.includes(kind)) {
      warnOnce(`markerkind:${String(kind)}`, `unknown marker kind "${String(kind)}" — using 'objective'`);
      kind = 'objective';
    }
    if (!m) {
      m = this.createMarker(key, kind);
      this.markers.set(key, m);
    }
    if (m.kind !== kind) {
      m.el.classList.remove(`k-${m.kind}`);
      m.el.classList.add(`k-${kind}`);
      m.shape.innerHTML = MARKER_ICON[kind];
      m.kind = kind;
    }
    m.removing = false;
    m.pos.x = x;
    m.pos.y = y;
    m.pos.z = z;
    if (opts.label !== undefined || m.label.value === '') m.label.set(opts.label ?? '');
    m.hasLabel.set(m.label.value.length > 0);
    if (opts.hideWithin !== undefined) m.hideWithin = Math.max(0, num(opts.hideWithin));
  }

  private createMarker(id: string, kind: MarkerKind): Marker {
    const shape = icon(MARKER_ICON[kind], 'aur-marker-shape', 24);
    const arrow = h('i', 'aur-marker-arrow');
    const label = h('span', 'aur-marker-label');
    const dist = h('span', 'aur-marker-dist aur-num');
    const el = h('div', `aur-marker k-${kind}`, arrow, shape as unknown as HTMLElement, h('div', 'aur-marker-txt', label, dist));
    el.style.opacity = '0';
    this.markerLayer.appendChild(el);
    return {
      id, el, shape, kind,
      pos: { x: 0, y: 0, z: 0 },
      hideWithin: 0,
      removing: false,
      vis: 0,
      x: 0, y: 0, sx: -1e9, sy: -1e9, side: -1, placed: false,
      label: new Txt(label),
      dist: new Txt(dist),
      edge: new Flag(el, 'is-edge'),
      hasLabel: new Flag(el, 'has-label'),
      opacity: new Num((v) => {
        el.style.opacity = v.toFixed(2);
        el.style.visibility = v <= 0.001 ? 'hidden' : 'visible';
      }, 0.01),
      arrow: new Num((v) => { arrow.style.transform = `rotate(${v.toFixed(3)}rad) translateY(calc(var(--u) * -21))`; }, 0.01),
    };
  }

  clearMarkers(): void {
    for (const m of this.markers.values()) m.removing = true;
  }

  // ------------------------------------------------------------------------------------------ update
  update(f: HudFrame, visible: boolean): void {
    this.frame++;
    const game = this.game;
    const cam = game.camera;
    const camOk = !isStub(cam);
    let origin: Vec3Like | null = null;
    let player: Actor | null = null;
    if (!isStub(game.player)) {
      try {
        const a = game.player.actor;
        if (a && !isStub(a) && a.pos) {
          player = a;
          origin = a.pos;
        }
      } catch {
        player = null;
      }
    }
    if (!origin && camOk) origin = cam.camera.position;

    let fx = 0;
    let fz = -1;
    if (camOk) {
      try {
        cam.getForward(tmpF);
        if (tmpF.x !== 0 || tmpF.z !== 0) {
          fx = tmpF.x;
          fz = tmpF.z;
        }
      } catch {
        /* keep default */
      }
    }

    this.updateMarkers(f, visible && camOk, origin, fx, fz);
    this.updatePips(f, visible && camOk, origin, player);
  }

  private updateMarkers(f: HudFrame, visible: boolean, origin: Vec3Like | null, fx: number, fz: number): void {
    if (this.markers.size === 0) return;
    const nav = this.game.settings.get('navAssist') !== false;
    // safe rectangle for edge-clamped markers: clear of the corner panels and the subtitle band
    const mx = 84 * f.u;
    const myTop = 96 * f.u;
    const myBottom = 250 * f.u;
    for (const m of this.markers.values()) {
      let want = visible && !m.removing ? 1 : 0;
      let edge = false;
      let tx = m.x;
      let ty = m.y;
      let dist = 0;
      if (want) {
        if (origin) {
          const dx = m.pos.x - origin.x;
          const dy = m.pos.y - origin.y;
          const dz = m.pos.z - origin.z;
          dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        if (dist < m.hideWithin) want = 0;
        if (m.kind === 'return' && !nav) want = 0;
      }
      if (want) {
        tmpP.x = m.pos.x;
        tmpP.y = m.pos.y;
        tmpP.z = m.pos.z;
        let front = false;
        try {
          front = this.game.camera.worldToScreen(tmpP, tmpS) === true;
        } catch {
          front = false;
        }
        if (front) {
          edge = edgeClamp(tmpS.x, tmpS.y, f.w, f.h, mx, myTop, myBottom, tmpE);
        } else {
          edge = true;
          const cp = this.game.camera.camera.position;
          bearingToEdge(relAngle(m.pos.x - cp.x, m.pos.z - cp.z, fx, fz), f.w, f.h, mx, myTop, myBottom, tmpE);
        }
        // navigation assistance off: guidance stays in the world, never on the screen edge
        if (edge && !nav && (m.kind === 'objective' || m.kind === 'optional' || m.kind === 'return')) want = 0;
        tx = tmpE.x;
        ty = tmpE.y;
        // bottom edge: the centre column belongs to prompts and captions — slide out to one side of it
        if (edge && ty >= f.h * 0.5 + (f.h * 0.5 - myBottom) - 1) {
          const half = f.w * 0.17;
          const dx = tx - f.w * 0.5;
          if (Math.abs(dx) > half * 0.3) m.side = dx < 0 ? -1 : 1;
          if (Math.abs(dx) < half) tx = f.w * 0.5 + m.side * half;
        }
      }
      m.vis += Math.sign(want - m.vis) * Math.min(Math.abs(want - m.vis), f.dt * 5);
      if (m.vis <= 0 && m.removing) {
        m.el.remove();
        this.markers.delete(m.id);
        continue;
      }
      if (!want) {
        m.opacity.set(m.vis);
        if (m.vis <= 0) m.placed = false;
        continue;
      }
      // glide along the edge, snap when first placed or while tracking a visible point
      if (!m.placed || !edge) {
        m.x = tx;
        m.y = ty;
      } else {
        const k = Math.min(1, f.dt * 14);
        m.x += (tx - m.x) * k;
        m.y += (ty - m.y) * k;
      }
      m.placed = true;
      if (Math.abs(m.x - m.sx) > 0.15 || Math.abs(m.y - m.sy) > 0.15) {
        m.sx = m.x;
        m.sy = m.y;
        m.el.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`;
      }
      m.edge.set(edge);
      if (edge) m.arrow.set(Math.atan2(m.x - f.w * 0.5, -(m.y - f.h * 0.5)));
      m.dist.set(origin ? fmtDistance(dist) : '');
      // on-screen markers recede a little when the player looks straight at them from afar
      m.opacity.set(m.vis * (edge ? 0.92 : 1));
    }
  }

  private acquirePip(id: number): Pip | null {
    let p = this.pips.get(id);
    if (p) return p;
    p = this.freePips.pop();
    if (!p) {
      if (this.pips.size >= PIP_POOL_MAX) return null;
      p = this.createPip();
    }
    p.actorId = id;
    p.vis = 0;
    p.lastHp = -1;
    p.hot = 0;
    p.ghostHold = 0;
    this.pips.set(id, p);
    return p;
  }

  private createPip(): Pip {
    const ghost = h('i', 'g');
    const fill = h('i', 'f');
    const poise = h('i', 'f');
    const el = h('div', 'aur-pip',
      h('div', 'aur-pip-states',
        icon(ICON.chain, 'aur-ico s-linked') as unknown as HTMLElement,
        icon(ICON.diamond, 'aur-ico s-exposed') as unknown as HTMLElement,
        h('span', 's-frozen', 'Held'),
      ),
      h('div', 'aur-pip-hp', ghost, fill),
      h('div', 'aur-pip-poise', poise),
    );
    el.style.display = 'none';
    this.pipLayer.appendChild(el);
    return {
      el, actorId: -1, seen: 0, vis: 0, x: 0, y: 0, scale: 1, ghostV: 1, ghostHold: 0, lastHp: -1, hot: 0,
      opacity: new Num((v) => {
        el.style.opacity = v.toFixed(2);
        el.style.display = v <= 0.001 ? 'none' : 'block';
      }, 0.01),
      hp: new Num((v) => { fill.style.transform = `scaleX(${v.toFixed(3)})`; }, 0.003),
      ghost: new Num((v) => { ghost.style.transform = `scaleX(${v.toFixed(3)})`; }, 0.003),
      poise: new Num((v) => { poise.style.transform = `scaleX(${v.toFixed(3)})`; }, 0.003),
      linked: new Flag(el, 'is-linked'),
      exposed: new Flag(el, 'is-exposed'),
      frozen: new Flag(el, 'is-frozen'),
      stagger: new Flag(el, 'is-stagger'),
      elite: new Flag(el, 'is-elite'),
      emph: new Flag(el, 'is-emph'),
    };
  }

  private updatePips(f: HudFrame, visible: boolean, origin: Vec3Like | null, player: Actor | null): void {
    const game = this.game;
    const actors = game.actors;
    if (visible && origin && !isStub(actors)) {
      const lock = f.state?.lockTarget ?? null;
      let list: readonly Actor[] | null = null;
      try {
        list = actors.all;
      } catch {
        list = null;
      }
      const n = list ? list.length : 0;
      for (let i = 0; i < n; i++) {
        const a = (list as readonly Actor[])[i] as Actor;
        if (!a || !a.alive || !a.pos) continue;
        const pinned = a === this.focus;
        if (!pinned) {
          if (!a.targetable || a === player || a.protectedNpc) continue;
          let hostile = false;
          try {
            hostile = player ? actors.areHostile(player, a) === true : false;
          } catch {
            hostile = false;
          }
          if (!hostile) continue;
        }
        const dx = a.pos.x - origin.x;
        const dz = a.pos.z - origin.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > PIP_RANGE && !pinned) continue;
        tmpP.x = a.pos.x;
        tmpP.y = a.pos.y + num(a.height, 1.8) + 0.28;
        tmpP.z = a.pos.z;
        let front = false;
        try {
          front = game.camera.worldToScreen(tmpP, tmpS) === true;
        } catch {
          front = false;
        }
        if (!front || tmpS.x < -40 || tmpS.x > f.w + 40 || tmpS.y < -20 || tmpS.y > f.h + 20) continue;
        const p = this.acquirePip(a.id);
        if (!p) break;
        p.seen = this.frame;
        this.drawPip(p, a, f, dist, a === lock || pinned);
      }
    }
    for (const p of this.pips.values()) {
      const want = p.seen === this.frame ? 1 : 0;
      p.vis += Math.sign(want - p.vis) * Math.min(Math.abs(want - p.vis), f.dt * (want ? 8 : 5));
      if (!want) {
        p.opacity.set(p.vis * 0.8);
        if (p.vis <= 0) {
          this.pips.delete(p.actorId);
          p.actorId = -1;
          this.freePips.push(p);
        }
      }
    }
  }

  private drawPip(p: Pip, a: Actor, f: HudFrame, dist: number, emph: boolean): void {
    const maxHp = Math.max(1, num(a.maxHp, 1));
    const hp = clampN(num(a.hp), 0, maxHp);
    const frac = hp / maxHp;
    if (p.lastHp < 0) p.ghostV = frac;
    else if (hp < p.lastHp - 0.01) {
      p.ghostHold = GHOST_HOLD;
      p.hot = 2.5;
    }
    p.lastHp = hp;
    if (p.ghostV < frac) p.ghostV = frac;
    else if (p.ghostV > frac) {
      if (p.ghostHold > 0) p.ghostHold -= f.dt;
      else p.ghostV = Math.max(frac, p.ghostV - f.dt * 1.2);
    }
    if (p.hot > 0) p.hot -= f.dt;
    p.hp.set(frac);
    p.ghost.set(p.ghostV);
    const maxPoise = Math.max(1, num(a.maxPoise, 1));
    p.poise.set(clamp01(num(a.poise) / maxPoise));

    let exposed = false;
    const wp = a.weakPoints;
    if (wp) for (let i = 0; i < wp.length; i++) if (wp[i]?.exposed) { exposed = true; break; }
    p.linked.set(a.linked === true);
    p.exposed.set(exposed);
    const now = f.now;
    p.frozen.set(num(a.frozenUntil) > now);
    p.stagger.set(num(a.staggeredUntil) > now);
    p.elite.set(a.archetype === 'elite');
    const hot = emph || p.hot > 0 || exposed;
    p.emph.set(hot);

    const scale = clampN(16 / Math.max(1, dist), 0.74, 1);
    if (Math.abs(p.x - tmpS.x) > 0.2 || Math.abs(p.y - tmpS.y) > 0.2 || Math.abs(p.scale - scale) > 0.01) {
      p.x = tmpS.x;
      p.y = tmpS.y;
      p.scale = scale;
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) scale(${scale.toFixed(2)})`;
    }
    const far = clamp01((PIP_RANGE - dist) / 8);
    const base = hot ? 1 : frac < 0.999 ? 0.86 : 0.58;
    p.opacity.set(p.vis * base * (hot ? 1 : far));
  }
}
