/**
 * Dominion Enforcer: a shield wall. Holds a line slot beside its neighbours and advances as one front, shield
 * up (frontal 140°, widening to 200° while it overlaps a neighbour facing the same way). It turns slowly, so
 * the answer is the flank, a heavy blow / poise break, or stasis. Attacks open the guard: shield bash and shock
 * baton up close (melee token required), sidearm at range.
 */
import * as THREE from 'three';
import type { Actor, SpawnOpts } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { TUNING } from '@/combat/tuning';
import { angleDelta, forwardX, forwardZ, yawTo } from '@/core/mathx';
import { Brain } from '../brain';
import type { AiCore } from '../core';
import { AI } from '../tune';
import { carry, cooldownScale, fin, physicsOf, socketPos } from '../util';

type State = 'advance' | 'windup' | 'strike' | 'recover' | 'aim' | 'shoot';

const AMBER = 0xffa033;
const _goal = new THREE.Vector3();
const _from = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();

export class EnforcerBrain extends Brain {
  private state: State = 'advance';
  private t = 0;
  private hitAt = 0;
  private endAt = 0;
  private attack: 'bash' | 'baton' = 'bash';
  private meleeCd: number;
  private shootCd: number;
  private readonly aimDir = new THREE.Vector3();
  private fired = false;
  private overlapAt = 0;
  /** out of formation (no shield overlap, a step back) until this sim time */
  brokenUntil = 0;
  private struck = false;

  constructor(core: AiCore, opts: SpawnOpts) {
    super(core, 'enforcer', opts);
    this.meleeCd = this.rand(0.4, 1.2);
    this.shootCd = this.rand(1.5, 3.5);
  }

  protected override onActive(a: Actor): void {
    a.visual?.setLoadout({ shield: true, melee: true, ranged: false });
    a.guardArc = TUNING.enemies.enforcer.guardArc;
    const v = a.visual;
    if (isHumanoidVisual(v)) v.onFootstep = (_foot, world) => this.game.audio.play('enforcerStep', { pos: world, volume: 0.7 });
  }

  protected override cleanup(a: Actor): void {
    const v = a.visual;
    if (isHumanoidVisual(v)) v.onFootstep = null;
  }

  protected override onAttackCancelled(a: Actor): void {
    if (this.state === 'aim' || this.state === 'shoot') a.visual?.setLoadout({ shield: true, melee: true, ranged: false });
    this.state = 'advance';
  }

  protected override onInterrupted(_a: Actor): void {
    // a staggered Enforcer is out of the wall for a moment even after it recovers
    this.brokenUntil = this.now + TUNING.actor.staggerSeconds + AI.enforcer.brokenFormation;
  }

  protected override calm(a: Actor, dt: number): void {
    a.guarding = false;
    this.nav.moveTo(a, this.post, AI.enforcer.speed, dt, { turn: AI.enforcer.turn });
  }

  /** the other living Enforcers of this front */
  private neighbours(a: Actor, out: Actor[]): Actor[] {
    out.length = 0;
    const all = this.game.actors.all;
    for (let i = 0; i < all.length; i++) {
      const o = all[i] as Actor;
      if (o !== a && o.alive && o.team === a.team && String(o.archetype) === 'enforcer') out.push(o);
    }
    return out;
  }

  private readonly nb: Actor[] = [];

  /** guard arc: wider while shoulder to shoulder with a neighbour facing the same way */
  private updateOverlap(a: Actor): void {
    const E = AI.enforcer;
    const base = TUNING.enemies.enforcer.guardArc;
    if (this.now < this.brokenUntil) {
      a.guardArc = base;
      return;
    }
    let overlap = false;
    for (const o of this.neighbours(a, this.nb)) {
      if (o.staggered || o.frozen || !o.guarding) continue;
      if (a.distanceTo(o) > E.overlapWithin) continue;
      if (Math.abs(angleDelta(a.yaw, o.yaw)) > E.overlapFacing) continue;
      overlap = true;
      break;
    }
    a.guardArc = overlap ? E.overlapArc : base;
  }

  /** where this Enforcer's slot is now: its post carried forward by the front's shared advance */
  private formationGoal(a: Actor, t: Actor, out: THREE.Vector3): THREE.Vector3 {
    const E = AI.enforcer;
    // centroid of the front's posts, so every member advances by the same vector and the line keeps its shape
    let cx = this.post.x;
    let cz = this.post.z;
    let n = 1;
    for (const o of this.neighbours(a, this.nb)) {
      const b = this.core.brainOf(o);
      if (!b || b.post.distanceToSquared(this.post) > 14 * 14) continue;
      cx += b.post.x;
      cz += b.post.z;
      n++;
    }
    cx /= n;
    cz /= n;
    let dx = t.pos.x - cx;
    let dz = t.pos.z - cz;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const adv = Math.max(0, Math.min(E.leash, d - E.standOff));
    out.set(this.post.x + dx * adv, this.post.y, this.post.z + dz * adv);
    if (this.now < this.brokenUntil) {
      // stumbling out of the wall: give a little ground
      out.x -= dx * 1.6;
      out.z -= dz * 1.6;
    }
    return out;
  }

  protected think(a: Actor, dt: number): void {
    const E = AI.enforcer;
    const S = TUNING.enemies.enforcer;
    const now = this.now;
    const t = this.target;
    if (now >= this.overlapAt) {
      this.overlapAt = now + 0.25;
      this.updateOverlap(a);
    }
    if (!this.validTarget(a, t)) {
      if (this.state !== 'advance') this.cancelAttack(a);
      a.guarding = true;
      this.nav.moveTo(a, this.post, E.speed, dt, { turn: E.turn });
      return;
    }
    const dist = a.distanceTo(t);
    const facing = Math.abs(angleDelta(a.yaw, yawTo(a.pos.x, a.pos.z, t.pos.x, t.pos.z)));
    this.meleeCd -= dt;
    this.shootCd -= dt;

    switch (this.state) {
      case 'advance': {
        a.guarding = true;
        this.formationGoal(a, t, _goal);
        this.nav.moveTo(a, _goal, E.speed, dt, { turn: E.turn, faceTo: t.pos, stop: 0.3 });
        const grounded = !t.flying;
        if (grounded && dist < E.bashRange + t.radius && facing < E.attackArc * 0.5 && this.meleeCd <= 0 && this.acquireSlot(a)) {
          this.attack = dist < 1.9 + t.radius || this.rand(0, 1) < 0.5 ? 'bash' : 'baton';
          this.state = 'windup';
          this.beginTelegraph(a, this.teleTime(E.telegraph), AMBER);
          this.game.audio.play('shieldUp', { pos: a.pos });
        } else if (this.shootCd <= 0 && dist >= E.sidearmRange[0] && dist <= E.sidearmRange[1] && facing < 0.5 && this.clearShot(a, t)) {
          this.state = 'aim';
          a.visual?.setLoadout({ shield: true, ranged: true });
          this.beginTelegraph(a, this.teleTime(E.sidearmTelegraph), AMBER);
          this.game.audio.play('armorRattle', { pos: a.pos });
        }
        break;
      }
      case 'windup': {
        // the guard opens as the arm goes back; it still turns (slowly) until the blow is thrown
        a.guarding = false;
        a.face(t.pos, E.turn * dt);
        if (this.tickTelegraph(a, dt)) {
          this.endTelegraph(a);
          const info = a.visual?.play(this.attack === 'bash' ? 'shieldBash' : 'batonStrike');
          this.hitAt = Math.max(0.12, fin(info?.hitTimes?.[0], 0.3));
          this.endAt = Math.max(this.hitAt + 0.25, fin(info?.duration, 0.8));
          this.t = 0;
          this.struck = false;
          this.state = 'strike';
          this.core.stats.meleeAttacks++;
        }
        break;
      }
      case 'strike': {
        a.guarding = false;
        this.t += dt;
        if (!this.struck) {
          // committed: a short step into the blow, no more turning
          carry(a, forwardX(a.yaw) * 2.6, forwardZ(a.yaw) * 2.6);
          if (this.t >= this.hitAt) {
            this.struck = true;
            this.land(a);
          }
        }
        if (this.t >= this.endAt) {
          this.state = 'recover';
          this.t = 0;
        }
        break;
      }
      case 'recover': {
        a.guarding = false;
        this.t += dt;
        if (this.t >= 0.35) {
          this.releaseSlot(a);
          this.meleeCd = this.rand(E.meleeCooldown[0], E.meleeCooldown[1]) * cooldownScale(this.game);
          this.state = 'advance';
        }
        break;
      }
      case 'aim': {
        a.guarding = false;
        const k = 1 - this.teleLeft / this.teleTotal;
        if (k < 0.6) {
          a.face(t.pos, 3 * dt);
          socketPos(a, 'muzzle', _from);
          this.aimDir.copy(t.aimPoint(_aim)).sub(_from).normalize();
        }
        a.visual?.setAimPitch(Math.asin(Math.max(-0.6, Math.min(0.6, this.aimDir.y))));
        if (this.tickTelegraph(a, dt)) {
          this.endTelegraph(a);
          const info = a.visual?.play('shoot');
          this.hitAt = Math.max(0.03, fin(info?.hitTimes?.[0], 0.08));
          this.endAt = Math.max(this.hitAt + 0.2, fin(info?.duration, 0.45));
          this.t = 0;
          this.fired = false;
          this.state = 'shoot';
        }
        break;
      }
      case 'shoot': {
        a.guarding = false;
        this.t += dt;
        if (!this.fired && this.t >= this.hitAt) {
          this.fired = true;
          socketPos(a, 'muzzle', _from);
          _dir.set(-this.aimDir.x, -this.aimDir.y, -this.aimDir.z);
          this.game.vfx.spawn('muzzleWarm', _from, { dir: this.aimDir, scale: 0.7 });
          this.game.audio.play('cinderlineShot', { pos: a.pos, volume: 0.6, pitch: 1.25 });
          this.core.projectiles.fire({
            owner: a, from: _from, dir: this.aimDir, speed: E.sidearmSpeed, range: E.sidearmRange[1] + 8,
            damage: S.sidearm, poise: 4, element: 'kinetic', style: 'warm',
          });
          this.core.stats.boltsFired++;
        }
        if (this.t >= this.endAt) {
          a.visual?.setLoadout({ shield: true, melee: true, ranged: false });
          a.visual?.setAimPitch(0);
          this.shootCd = this.rand(E.sidearmCooldown[0], E.sidearmCooldown[1]) * cooldownScale(this.game);
          this.state = 'advance';
        }
        break;
      }
    }
  }

  private clearShot(a: Actor, t: Actor): boolean {
    const physics = physicsOf(this.game);
    if (!physics) return true;
    return physics.lineOfFire(a.aimPoint(_from), t.aimPoint(_aim));
  }

  /** the blow lands on whoever is still in front of the shield */
  private land(a: Actor): void {
    const S = TUNING.enemies.enforcer;
    const E = AI.enforcer;
    const bash = this.attack === 'bash';
    const actors = this.game.actors;
    const physics = physicsOf(this.game);
    const victims = actors.inArc(a.pos, a.yaw, E.attackArc, (bash ? E.bashRange : E.batonRange) + 0.3, (o) => o !== a && o.targetable && !o.flying && actors.areHostile(a, o));
    this.game.audio.play(bash ? 'shieldHit' : 'batonZap', { pos: a.pos });
    for (let i = 0; i < victims.length && i < 2; i++) {
      const v = victims[i] as Actor;
      v.aimPoint(_pt);
      if (physics && !physics.lineOfFire(a.aimPoint(_from), _pt)) continue;
      const dx = v.pos.x - a.pos.x;
      const dz = v.pos.z - a.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      actors.applyHit(v, {
        attacker: a, damage: bash ? S.bash : S.baton, poise: bash ? 32 : 16, kind: 'melee', element: bash ? 'kinetic' : 'shock',
        dir: { x: dx / l, y: 0, z: dz / l }, point: { x: _pt.x, y: _pt.y, z: _pt.z }, knockback: bash ? 5.5 : 2, tag: bash ? 'shieldBash' : 'baton',
      });
    }
  }
}
