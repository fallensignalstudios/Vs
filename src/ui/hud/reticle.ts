/**
 * Screen-centre feedback: reticle (tightens when aiming), hit markers (hit / weak / kill / blocked differ by
 * SHAPE), damage-direction arcs and the lock-on bracket projected onto `lockTarget`.
 */
import * as THREE from 'three';
import type { Actor, Game } from '@/core/api';
import { isStub } from '@/core/stub';
import { Attr, Flag, Num, h, svg } from '../dom';
import { clampN, num, relAngle, strongerHit, type HitKind } from '../logic';
import type { HudFrame } from './frame';

const HIT_MARKUP =
  // hit: four diagonal ticks
  '<g class="k-hit"><path d="M-11-11l5 5M11-11l-5 5M-11 11l5-5M11 11l-5-5"/></g>' +
  // weak point: ticks + an open diamond
  '<g class="k-weak"><path d="M-14-14l6 6M14-14l-6 6M-14 14l6-6M14 14l-6-6"/><path d="M0-6.5L6.5 0 0 6.5-6.5 0z"/></g>' +
  // kill: ticks + cardinal burst
  '<g class="k-kill"><path d="M-15-15l7 7M15-15l-7 7M-15 15l7-7M15 15l-7-7"/><path d="M0-19v8M0 19v-8M-19 0h8M19 0h-8" class="thin"/></g>' +
  // blocked: a closed bracket pair with a bar — nothing diagonal
  '<g class="k-blocked"><path d="M-6-10h-5v20h5M6-10h5v20h-5"/><path d="M-4 0h8" class="thin"/></g>';

const ARC_MARKUP =
  '<path class="aur-dmg-glow" d="M-46.9-88.3A100 100 0 0 1 46.9-88.3"/>' +
  '<path class="aur-dmg-core" d="M-42.3-90.6A100 100 0 0 1 42.3-90.6"/>' +
  // outward chevron: the arc points AT the source, not just toward a side
  '<path class="aur-dmg-tip" d="M-8-104L0-113 8-104"/>';

const HIT_LIFE: Record<HitKind, number> = { hit: 0.26, weak: 0.42, kill: 0.6, blocked: 0.32 };
const ARC_LIFE = 1.35;
const ARC_POOL = 6;

interface Arc {
  el: HTMLElement;
  life: number;
  strength: number;
  angle: number;
  opacity: Num;
}

const tmpAim = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();
const tmpScreen = { x: 0, y: 0 };

export class Reticle {
  readonly el: HTMLElement;
  readonly lockEl: HTMLElement;

  private readonly reticle: HTMLElement;
  private readonly spread: Num;
  private readonly retOpacity: Num;
  private readonly aiming: Flag;
  private spreadV = 1;
  private retVis = 0;

  private readonly hit: SVGSVGElement;
  private readonly hitKind: Attr;
  private readonly hitOpacity: Num;
  private readonly hitScale: Num;
  private hitLife = 0;
  private hitTotal = 1;
  private hitCur: HitKind = 'hit';
  private hitAge = 1;

  private readonly arcs: Arc[] = [];

  private readonly lockPos = { x: -1, y: -1, s: -1 };
  private readonly lockOpacity: Num;
  private lockVis = 0;
  private lockAcq = 0;
  private lockId = -1;

  constructor(private readonly game: Game) {
    this.reticle = h('div', 'aur-reticle', h('i', 'dot'), h('i', 't t-n'), h('i', 't t-e'), h('i', 't t-s'), h('i', 't t-w'));
    this.spread = new Num((v) => { this.reticle.style.setProperty('--spread', v.toFixed(3)); }, 0.004);
    this.retOpacity = new Num((v) => { this.reticle.style.opacity = v.toFixed(2); }, 0.01);
    this.aiming = new Flag(this.reticle, 'is-aim');

    this.hit = svg('-24 -24 48 48', 'aur-hit', HIT_MARKUP);
    this.hitKind = new Attr(this.hit, 'data-kind');
    this.hitOpacity = new Num((v) => { this.hit.style.opacity = v.toFixed(2); }, 0.01);
    this.hitScale = new Num((v) => { this.hit.style.transform = `translate(-50%, -50%) scale(${v.toFixed(3)})`; }, 0.004);
    this.hit.style.opacity = '0';

    const dmg = h('div', 'aur-dmg');
    for (let i = 0; i < ARC_POOL; i++) {
      const el = h('div', 'aur-dmg-arc');
      el.appendChild(svg('-120 -120 240 240', null, ARC_MARKUP));
      el.style.opacity = '0';
      dmg.appendChild(el);
      this.arcs.push({ el, life: 0, strength: 1, angle: 0, opacity: new Num((v) => { el.style.opacity = v.toFixed(2); }, 0.01) });
    }

    this.el = h('div', 'aur-centre', dmg, this.reticle, this.hit as unknown as HTMLElement);

    this.lockEl = h('div', 'aur-lock', h('i', 'c c-tl'), h('i', 'c c-tr'), h('i', 'c c-bl'), h('i', 'c c-br'), h('i', 'pin'));
    this.lockEl.style.display = 'none';
    this.lockOpacity = new Num((v) => {
      this.lockEl.style.opacity = v.toFixed(2);
      this.lockEl.style.display = v <= 0.001 ? 'none' : 'block';
    }, 0.01);

    game.events.on('player:damaged', (e) => {
      const d = e.dir;
      // undirected damage (environment) has no source to point at
      if (!d || Math.abs(num(d.x)) + Math.abs(num(d.z)) < 1e-4) return;
      this.damageFromWorld(-num(d.x), -num(d.z), clampN(num(e.amount, 10) / 24, 0.45, 1));
    });
    game.events.on('actor:hit', (e) => {
      if (isStub(game.player)) return;
      const attacker = e.hit?.attacker;
      if (!attacker || attacker !== game.player.actor || e.target === attacker) return;
      const r = e.result;
      if (!r) return;
      this.hitMarker(r.killed ? 'kill' : r.immune || r.blocked ? 'blocked' : r.weakPoint ? 'weak' : 'hit');
    });
  }

  /** world-space planar direction TOWARD the damage source */
  private damageFromWorld(dx: number, dz: number, strength: number): void {
    let fx = 0;
    let fz = -1;
    const cam = this.game.camera;
    if (!isStub(cam)) {
      try {
        cam.getForward(tmpFwd);
        if (tmpFwd.x !== 0 || tmpFwd.z !== 0) {
          fx = tmpFwd.x;
          fz = tmpFwd.z;
        }
      } catch {
        /* keep north */
      }
    }
    this.damageDirection(relAngle(dx, dz, fx, fz), strength);
  }

  damageDirection(angle: number, strength = 1): void {
    if (!Number.isFinite(angle)) return;
    const s = clampN(num(strength, 1), 0.2, 1);
    // merge with a live arc pointing the same way (event + direct call for the same hit)
    let slot: Arc | null = null;
    for (const a of this.arcs) {
      if (a.life <= 0) continue;
      const d = Math.atan2(Math.sin(a.angle - angle), Math.cos(a.angle - angle));
      if (Math.abs(d) < 0.3 && a.life > ARC_LIFE - 0.25) {
        a.strength = Math.max(a.strength, s);
        return;
      }
    }
    for (const a of this.arcs) {
      if (a.life <= 0) {
        slot = a;
        break;
      }
      if (!slot || a.life < slot.life) slot = a;
    }
    if (!slot) return;
    slot.life = ARC_LIFE;
    slot.strength = s;
    slot.angle = angle;
    slot.el.style.transform = `rotate(${angle.toFixed(3)}rad)`;
    slot.el.style.setProperty('--w', (0.7 + s * 0.6).toFixed(2));
  }

  hitMarker(kind: HitKind = 'hit'): void {
    const k: HitKind = kind in HIT_LIFE ? kind : 'hit';
    // coalesce same-instant markers (event + direct call): the stronger one wins
    this.hitCur = this.hitLife > 0 && this.hitAge < 0.06 ? strongerHit(this.hitCur, k) : k;
    this.hitTotal = HIT_LIFE[this.hitCur];
    this.hitLife = this.hitTotal;
    this.hitAge = 0;
    this.hitKind.set(this.hitCur);
  }

  update(f: HudFrame): void {
    const dt = f.dt;
    const s = f.state;

    // reticle
    const aiming = s?.aiming === true;
    const locked = !!s?.lockTarget;
    const targetSpread = aiming ? 0 : 1;
    this.spreadV += (targetSpread - this.spreadV) * Math.min(1, dt * 16);
    this.spread.set(this.spreadV);
    this.aiming.set(aiming);
    const wantVis = !s ? 0 : aiming ? 1 : locked ? 0 : 0.5;
    this.retVis += (wantVis - this.retVis) * Math.min(1, dt * 12);
    this.retOpacity.set(this.retVis);

    // hit marker
    if (this.hitLife > 0) {
      this.hitLife = Math.max(0, this.hitLife - dt);
      this.hitAge += dt;
      const t = this.hitLife / this.hitTotal;
      this.hitOpacity.set(t > 0.6 ? 1 : t / 0.6);
      const pop = Math.max(0, 1 - this.hitAge / 0.09);
      this.hitScale.set(1 + pop * 0.35);
    } else {
      this.hitOpacity.set(0);
    }

    // damage arcs
    for (const a of this.arcs) {
      if (a.life <= 0) continue;
      a.life = Math.max(0, a.life - dt);
      const t = a.life / ARC_LIFE;
      const fadeIn = Math.min(1, (ARC_LIFE - a.life) / 0.06);
      a.opacity.set(fadeIn * Math.min(1, t * 1.8) * (0.55 + a.strength * 0.45));
    }

    this.updateLock(f, s?.lockTarget ?? null);
  }

  private updateLock(f: HudFrame, target: Actor | null): void {
    let ok = false;
    const cam = this.game.camera;
    if (target && !isStub(target) && target.alive !== false && !isStub(cam) && typeof target.aimPoint === 'function') {
      try {
        target.aimPoint(tmpAim);
        ok = cam.worldToScreen(tmpAim, tmpScreen) === true;
        if (ok) {
          const camObj = cam.camera;
          const dist = Math.max(0.5, camObj.position.distanceTo(tmpAim));
          const fov = num(camObj.fov, 62) * (Math.PI / 180);
          const pxPerM = (f.h * 0.5) / (dist * Math.tan(fov * 0.5));
          const size = clampN(pxPerM * num(target.height, 1.8) * 0.42, 20 * f.u, 110 * f.u);
          if (target.id !== this.lockId) {
            this.lockId = target.id;
            this.lockAcq = 1;
          }
          this.lockAcq = Math.max(0, this.lockAcq - f.dt * 5.5);
          const sz = size * (1 + this.lockAcq * 0.7);
          const p = this.lockPos;
          if (Math.abs(p.x - tmpScreen.x) > 0.2 || Math.abs(p.y - tmpScreen.y) > 0.2) {
            p.x = tmpScreen.x;
            p.y = tmpScreen.y;
            this.lockEl.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
          }
          if (Math.abs(p.s - sz) > 0.3) {
            p.s = sz;
            this.lockEl.style.setProperty('--s', `${sz.toFixed(1)}px`);
          }
        }
      } catch {
        ok = false;
      }
    }
    if (!ok) this.lockId = -1;
    const want = ok ? 1 : 0;
    this.lockVis += Math.sign(want - this.lockVis) * Math.min(Math.abs(want - this.lockVis), f.dt * 9);
    this.lockOpacity.set(this.lockVis);
  }
}
