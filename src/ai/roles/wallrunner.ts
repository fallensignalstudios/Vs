/**
 * Wallrunner — the Eclipse wall / ceiling attacker. It runs to a perch, climbs it (while perched the actor is
 * a hovering body at the cling height, so shots hit where the creature is drawn), ANNOUNCES itself from the
 * seam (glow, skitter, caption, a landing ring on the floor), pounces to where its target is heading, is
 * vulnerable on the ground for a moment, then returns to a wall.
 */
import * as THREE from 'three';
import type { Actor, SpawnOpts, VfxHandle, WallPerch } from '@/core/api';
import { asWallrunner } from '@/core/api';
import { TUNING } from '@/combat/tuning';
import { Brain } from '../brain';
import type { AiCore } from '../core';
import { snapToNav } from '../steer';
import { AI } from '../tune';
import { caption, carry, cooldownScale, fin, physicsOf } from '../util';

type State = 'travel' | 'perched' | 'telegraph' | 'pounce' | 'ground';

const VIOLET = 0xb47cff;
const _p = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };
const _o = { x: 0, y: 0, z: 0 };
const _ray = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 0, collider: null, ground: false } as import('@/core/api').RayHit;
const _g = { y: 0, surface: null as never };

interface Perch {
  x: number; y: number; z: number;
  height: number;
  wallYaw: number | null;
}

export class WallrunnerBrain extends Brain {
  private state: State = 'travel';
  private perch: Perch | null = null;
  private wait = 0;
  private t = 0;
  private hitAt = 0.82;
  private endAt = 1.3;
  private launchAt = 0.45;
  private launched = false;
  private sounded = false;
  private struck = false;
  private readonly land = new THREE.Vector3();
  private landLocked = false;
  private ring: VfxHandle | null = null;
  private wisp: VfxHandle | null = null;
  private groundLeft = 0;
  private perchIdx = 0;
  private groundY = 0;
  private self: Actor | null = null;

  constructor(core: AiCore, opts: SpawnOpts) {
    super(core, 'wallrunner', opts);
  }

  protected override onActive(a: Actor): void {
    this.self = a;
    this.groundY = a.pos.y;
    this.state = 'travel';
    this.perch = null;
  }

  protected override cleanup(_a: Actor): void {
    this.wisp?.stop();
    this.wisp = null;
  }

  protected override targetWeight(_a: Actor, t: Actor): number {
    return t.flying ? 3 : 1;
  }

  protected override onAttackCancelled(a: Actor): void {
    this.ring?.stop();
    this.ring = null;
    this.wisp?.stop();
    this.wisp = null;
    if (this.state === 'telegraph') this.state = 'perched';
    else if (this.state === 'pounce') this.toGround(a, AI.wallrunner.groundSeconds * 0.6);
  }

  /** arrested or staggered on the wall: it falls, and lies open on the floor */
  protected override onInterrupted(a: Actor): void {
    if (a.flying) this.toGround(a, AI.wallrunner.groundSeconds);
  }

  protected override calm(a: Actor, _dt: number): void {
    this.nav.halt(a);
  }

  // ---- wall <-> floor -----------------------------------------------------------------------------------------

  private floorUnder(a: Actor): number {
    const physics = physicsOf(this.game);
    if (!physics) return this.groundY;
    const g = physics.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.3, 0.45, _g);
    if (g && Number.isFinite(g.y)) this.groundY = g.y;
    return this.groundY;
  }

  /** climb: the actor becomes a hovering body at the cling height (the manager eases it up the wall) */
  private climb(a: Actor, p: Perch): void {
    this.groundY = a.pos.y;
    a.flying = true;
    a.hoverHeight = p.height;
    a.pos.y += a.height * 0.5;
    asWallrunner(a.visual)?.setCling({ height: 0, wallYaw: p.wallYaw, inset: p.wallYaw === null ? 0 : 0.55 }, 0.4);
    a.visual?.play('ceilingCling', { loop: true });
  }

  /** come off the wall onto the floor below, without the body visibly jumping */
  private descend(a: Actor, keepCling: boolean): void {
    if (!a.flying) return;
    const y = this.floorUnder(a);
    const h = Math.max(0, a.pos.y - y);
    a.flying = false;
    a.pos.y = y;
    const w = asWallrunner(a.visual);
    // the root drops to the floor this tick; the visual keeps the body where it was until the leap carries it down
    if (keepCling && this.perch) w?.setCling({ height: h, wallYaw: this.perch.wallYaw, inset: this.perch.wallYaw === null ? 0 : 0.55 }, 0);
    else w?.setCling(null, 0.25);
  }

  private toGround(a: Actor, seconds: number): void {
    this.descend(a, false);
    a.visual?.stop('ceilingCling');
    this.state = 'ground';
    this.groundLeft = seconds;
    this.releaseSlot(a);
    const wp = a.weakPoints.find((w) => w.id === 'core');
    if (wp) wp.exposed = true;
    a.visual?.setExposed('core', 1);
  }

  // ---- perches ------------------------------------------------------------------------------------------------

  private choosePerch(a: Actor, t: Actor | null): Perch {
    const W = AI.wallrunner;
    const cx = t ? t.pos.x : a.pos.x;
    const cy = t ? t.pos.y : a.pos.y;
    const cz = t ? t.pos.z : a.pos.z;
    const mid = (W.perch[0] + W.perch[1]) * 0.5;
    const authored = this.opts.perches;
    const cands: Perch[] = [];
    if (Array.isArray(authored) && authored.length) {
      for (const p of authored as WallPerch[]) {
        if (!p || !p.pos || !Number.isFinite(p.pos.x + p.pos.y + p.pos.z)) continue;
        cands.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, height: Math.max(2, fin(p.height, W.clingHeight)), wallYaw: typeof p.wallYaw === 'number' ? p.wallYaw : null });
      }
    } else {
      const physics = physicsOf(this.game);
      if (physics) {
        // look for walls round the target: a perch is the floor point a metre in front of one
        _o.x = cx;
        _o.y = cy + 2.6;
        _o.z = cz;
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2 + a.id;
          _dir.x = Math.cos(ang);
          _dir.y = 0;
          _dir.z = Math.sin(ang);
          const h = physics.raycast(_o, _dir, W.perch[1] + 3, undefined, _ray);
          if (!h || h.ground || h.distance < W.perch[0] - 2) continue;
          const nl = Math.hypot(h.normal.x, h.normal.z);
          if (nl < 0.5) continue;
          const nx = h.normal.x / nl;
          const nz = h.normal.z / nl;
          _p.x = h.point.x + nx * 1.15;
          _p.y = cy;
          _p.z = h.point.z + nz * 1.15;
          const n = physics.nav.nearest(_p.x, _p.y, _p.z, 1.2);
          if (!n) continue;
          // the wall must really be that tall where the body will hang
          cands.push({ x: n.x, y: n.y, z: n.z, height: W.clingHeight, wallYaw: Math.atan2(-nx, -nz) });
        }
      }
    }
    if (!cands.length) {
      // no wall in reach: hang from the ceiling over a point at perch distance
      const ang = this.rand(0, Math.PI * 2);
      _p.x = cx + Math.cos(ang) * mid;
      _p.y = cy;
      _p.z = cz + Math.sin(ang) * mid;
      snapToNav(this.game, _p, 6, _p);
      return { x: _p.x, y: _p.y, z: _p.z, height: W.clingHeight, wallYaw: null };
    }
    // prefer perches in the distance band, and never the one it just left
    let best = cands[0] as Perch;
    let bestScore = Infinity;
    this.perchIdx++;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i] as Perch;
      const d = Math.hypot(c.x - cx, c.z - cz);
      let s = Math.abs(d - mid) + ((i + this.perchIdx) % cands.length) * 0.35;
      if (this.perch && Math.hypot(c.x - this.perch.x, c.z - this.perch.z) < 2) s += 8;
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  // ---- brain --------------------------------------------------------------------------------------------------

  protected think(a: Actor, dt: number): void {
    const W = AI.wallrunner;
    const t = this.target;
    const valid = this.validTarget(a, t);

    switch (this.state) {
      case 'travel': {
        if (!this.perch) this.perch = this.choosePerch(a, valid ? t : null);
        const p = this.perch;
        if (this.nav.moveTo(a, p, W.speed, dt, { turn: 9, stop: 0.5 }) || this.nav.stuck > 1.5) {
          // a perch it cannot reach is replaced by the ceiling right here
          if (!this.nav.arrived) this.perch = { x: a.pos.x, y: a.pos.y, z: a.pos.z, height: W.clingHeight, wallYaw: null };
          this.climb(a, this.perch as Perch);
          this.state = 'perched';
          this.wait = this.rand(W.stalk[0], W.stalk[1]) * cooldownScale(this.game);
          this.nav.reset();
        }
        break;
      }
      case 'perched': {
        if (valid) a.face(t.pos, 5 * dt);
        this.wait -= dt;
        if (this.wait > 0 || !valid) break;
        const d = a.distanceTo(t);
        if (d > W.pounceRange) {
          // the fight moved away: find a closer wall
          this.descend(a, false);
          a.visual?.stop('ceilingCling');
          this.perch = null;
          this.state = 'travel';
          break;
        }
        if (!this.acquireSlot(a)) break;
        this.startTelegraph(a, t);
        break;
      }
      case 'telegraph': {
        const k = 1 - this.teleLeft / this.teleTotal;
        if (valid && !this.landLocked) {
          a.face(t.pos, 6 * dt);
          this.predict(t);
          this.ring?.setPosition(this.land);
          // the landing point is committed before the leap: move and it misses
          if (k >= 0.6) this.landLocked = true;
        }
        if (this.tickTelegraph(a, dt)) {
          this.endTelegraph(a);
          this.wisp?.stop();
          this.wisp = null;
          this.descend(a, true);
          const info = a.visual?.play('pounce', {
            onEvent: (e) => {
              if (e === 'launch') this.launched = true;
            },
          });
          this.hitAt = Math.max(0.3, fin(info?.hitTimes?.[0], 0.82));
          this.endAt = Math.max(this.hitAt + 0.2, fin(info?.duration, 1.3));
          this.launchAt = this.hitAt * 0.55;
          this.t = 0;
          this.launched = false;
          this.sounded = false;
          this.struck = false;
          this.state = 'pounce';
          this.core.stats.pounces++;
        }
        break;
      }
      case 'pounce': {
        this.t += dt;
        if (!this.launched && this.t >= this.launchAt) this.launched = true;
        if (this.launched && !this.struck) {
          if (!this.sounded) {
            this.sounded = true;
            this.game.audio.play('wallrunnerPounce', { pos: a.pos });
          }
          // carried through the air so that it arrives exactly when the blow lands
          const left = Math.max(dt, this.hitAt - this.t + dt);
          carry(a, (this.land.x - a.pos.x) / left, (this.land.z - a.pos.z) / left);
          a.face(this.land, 12 * dt);
          if (this.t >= this.hitAt) {
            this.struck = true;
            this.strike(a);
          }
        }
        if (this.t >= this.endAt) this.toGround(a, W.groundSeconds);
        break;
      }
      case 'ground': {
        this.nav.halt(a);
        if (valid) a.face(t.pos, 2.5 * dt);
        this.groundLeft -= dt;
        if (this.groundLeft <= 0) {
          const wp = a.weakPoints.find((w) => w.id === 'core');
          if (wp) wp.exposed = false;
          a.visual?.setExposed('core', 0);
          this.perch = null;
          this.state = 'travel';
        }
        break;
      }
    }
  }

  private predict(t: Actor): void {
    const W = AI.wallrunner;
    let vx = t.vel.x * W.lead;
    let vz = t.vel.z * W.lead;
    const l = Math.hypot(vx, vz);
    if (l > 3) {
      vx *= 3 / l;
      vz *= 3 / l;
    }
    _p.x = t.pos.x + vx;
    _p.y = t.pos.y;
    _p.z = t.pos.z + vz;
    // it lands beside its prey, on its own side — not inside it
    const a = this.self;
    if (a) {
      const dx = a.pos.x - _p.x;
      const dz = a.pos.z - _p.z;
      const d = Math.hypot(dx, dz);
      const off = Math.min(d, t.radius + a.radius + 0.35);
      if (d > 1e-3) {
        _p.x += (dx / d) * off;
        _p.z += (dz / d) * off;
      }
    }
    snapToNav(this.game, _p, 2, _p);
    this.land.set(_p.x, _p.y, _p.z);
  }

  private startTelegraph(a: Actor, t: Actor): void {
    const W = AI.wallrunner;
    const seconds = this.teleTime(W.telegraph);
    this.state = 'telegraph';
    this.landLocked = false;
    this.predict(t);
    this.beginTelegraph(a, seconds, VIOLET, 'pounce', t, this.land);
    const hit = fin(a.visual?.info('pounce').hitTimes?.[0], 0.82);
    // seam glow, skitter and a caption first; the floor ring closes exactly when it lands
    this.wisp = this.game.vfx.spawn('violetWisp', a.pos, { duration: seconds, scale: 0.8 });
    this.ring = this.game.vfx.telegraph({ kind: 'circle', pos: this.land, r: W.landRadius }, seconds + hit, VIOLET);
    this.marks.push(this.ring);
    this.game.audio.play('wallrunnerSkitter', { pos: a.pos });
    caption(this.game, 'Skittering overhead', 'breach', a.pos);
  }

  private strike(a: Actor): void {
    const W = AI.wallrunner;
    const actors = this.game.actors;
    this.marks.length = 0;
    this.ring = null;
    this.game.vfx.spawn('dustPuff', a.pos);
    const victims = actors.inRadius(a.pos, W.landRadius, (o) => o !== a && o.targetable && !o.flying && actors.areHostile(a, o));
    for (let i = 0; i < victims.length && i < 2; i++) {
      const v = victims[i] as Actor;
      const dx = v.pos.x - a.pos.x;
      const dz = v.pos.z - a.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      const pt = v.aimPoint(new THREE.Vector3());
      actors.applyHit(v, {
        attacker: a, damage: TUNING.enemies.wallrunner.pounce, poise: 22, kind: 'melee', element: 'violet',
        dir: { x: dx / l, y: 0, z: dz / l }, point: { x: pt.x, y: pt.y, z: pt.z }, knockback: 4, tag: 'pounce',
      });
    }
  }
}
