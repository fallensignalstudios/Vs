/**
 * Linkbound — an Eclipse-coerced body. Closes and lunges. While LINKED it moves, hesitates and attacks on the
 * shared cadence beat, in unison with every other linked body, and shrugs off individual disruption (the link
 * system sets its resist scales). Cut the link and it staggers, then fights on its own irregular clock.
 */
import * as THREE from 'three';
import type { Actor, LinkHandle, SpawnOpts } from '@/core/api';
import { TUNING } from '@/combat/tuning';
import { forwardX, forwardZ } from '@/core/mathx';
import { Brain } from '../brain';
import type { AiCore } from '../core';
import { AI } from '../tune';
import { carry, cooldownScale, fin, physicsOf } from '../util';

type State = 'approach' | 'windup' | 'lunge' | 'recover';

const VIOLET = 0x9a5cff;
const _goal = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _from = new THREE.Vector3();

export class LinkboundBrain extends Brain {
  private state: State = 'approach';
  private t = 0;
  private hitAt = 0.3;
  private endAt = 0.8;
  private cooldown: number;
  private struck = false;
  private lastBeat = -1;
  private wasLinked = false;
  /** has been freed from a link: its cadence is its own, and audibly irregular */
  private freed = false;
  /** which way it circles while it waits for a melee token */
  private readonly orbit: number;
  /** offset (rad) of its approach bearing round the target */
  private bearing = 0;

  constructor(core: AiCore, opts: SpawnOpts) {
    super(core, 'linkbound', opts);
    this.cooldown = this.rand(0.3, 1.4);
    this.orbit = this.rand(0, 1) < 0.5 ? 1 : -1;
  }

  protected override onActive(a: Actor): void {
    this.bearing = ((a.id % 3) - 1) * 0.75;
  }

  protected override targetWeight(_a: Actor, t: Actor): number {
    return t.flying ? 3 : 1;
  }

  protected override onAttackCancelled(_a: Actor): void {
    this.state = 'approach';
  }

  override onLinkSevered(a: Actor, _link: LinkHandle, by: Actor | null): void {
    if (a.linked) return; // another link still holds it
    this.freed = true;
    this.wasLinked = false;
    a.visual?.stop('linkedSync');
    this.cancelAttack(a);
    this.game.actors.stagger(a, AI.linkbound.severStagger, by);
    // individual timing from here on: no two freed bodies share a clock
    this.cooldown = this.rand(0.2, 1.8);
  }

  protected think(a: Actor, dt: number): void {
    const L = AI.linkbound;
    const links = this.core.links;
    const linked = a.linked;
    if (linked !== this.wasLinked) {
      this.wasLinked = linked;
      if (linked) {
        this.freed = false;
        a.visual?.play('linkedSync', { loop: true });
      } else a.visual?.stop('linkedSync');
    }

    const t = this.target;
    if (!this.validTarget(a, t)) {
      if (this.state !== 'approach') this.cancelAttack(a);
      this.nav.halt(a);
      return;
    }
    const dist = a.distanceTo(t);
    const beat = links.beatIndex();
    const onBeat = beat !== this.lastBeat;
    this.lastBeat = beat;
    this.cooldown -= dt;

    switch (this.state) {
      case 'approach': {
        // linked bodies step together and hesitate together
        const moving = !linked || links.cadence.phase() < L.moveFraction;
        const speed = linked ? L.linkedSpeed : L.speed;
        const reach = L.lungeFrom + t.radius;
        const wantsSlot = dist < reach + 3;
        const hasSlot = wantsSlot && this.acquireSlot(a);
        if (!wantsSlot && this.holdsSlot) this.releaseSlot(a);
        if (hasSlot) {
          if (dist > reach) {
            if (moving) {
              // each body closes on its own bearing, so a group arrives as a front and not as a queue
              const ang = Math.atan2(a.pos.z - t.pos.z, a.pos.x - t.pos.x) + this.bearing * Math.min(1, dist / 7);
              _goal.set(t.pos.x + Math.cos(ang) * (reach - 0.5), t.pos.y, t.pos.z + Math.sin(ang) * (reach - 0.5));
              this.nav.moveTo(a, _goal, speed, dt, { turn: L.turn, stop: 0.3 });
            } else this.hesitate(a, t, dt);
          } else {
            a.face(t.pos, L.turn * dt);
            this.nav.halt(a);
            // linked: the wind-up begins exactly on the beat, so every linked body in reach begins it together
            const go = linked ? onBeat && this.cooldown <= 0 : this.cooldown <= 0;
            if (go && !t.flying) this.startWindup(a);
          }
        } else if (dist > L.waitRing + 1.2) {
          if (moving) this.nav.moveTo(a, t.pos, speed, dt, { turn: L.turn, stop: L.waitRing });
          else this.hesitate(a, t, dt);
        } else {
          // no token: prowl the ring instead of crowding the fight
          const ang = Math.atan2(a.pos.z - t.pos.z, a.pos.x - t.pos.x) + this.orbit * 0.5;
          _goal.set(t.pos.x + Math.cos(ang) * L.waitRing, t.pos.y, t.pos.z + Math.sin(ang) * L.waitRing);
          if (moving) this.nav.moveTo(a, _goal, speed * 0.45, dt, { turn: L.turn, faceTo: t.pos, stop: 0.3 });
          else this.hesitate(a, t, dt);
        }
        break;
      }
      case 'windup': {
        const k = 1 - this.teleLeft / this.teleTotal;
        // it tracks while it sinks, then commits to a line
        if (k < 0.6) a.face(t.pos, L.turn * dt);
        if (this.tickTelegraph(a, dt)) {
          this.endTelegraph(a);
          const info = a.visual?.play('lunge');
          this.hitAt = Math.max(0.12, fin(info?.hitTimes?.[0], 0.3));
          this.endAt = Math.max(this.hitAt + 0.2, fin(info?.duration, 0.8));
          this.t = 0;
          this.struck = false;
          this.state = 'lunge';
          this.game.audio.play('eclipseLunge', { pos: a.pos });
          this.core.stats.meleeAttacks++;
        }
        break;
      }
      case 'lunge': {
        this.t += dt;
        if (!this.struck) {
          // thrown forward along the committed line; pulls up short of whoever it reaches
          if (dist > t.radius + a.radius + 0.5) {
            carry(a, forwardX(a.yaw) * L.lungeSpeed, forwardZ(a.yaw) * L.lungeSpeed);
          }
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
        this.t += dt;
        if (this.t >= L.recover) {
          this.releaseSlot(a);
          this.cooldown = (linked ? 0.2 : this.rand(L.cooldown[0], L.cooldown[1])) * cooldownScale(this.game);
          this.state = 'approach';
        }
        break;
      }
    }
  }

  /** the shared hesitation: stand, sway toward the target */
  private hesitate(a: Actor, t: Actor, dt: number): void {
    this.nav.halt(a);
    a.face(t.pos, AI.linkbound.turn * 0.3 * dt);
  }

  private startWindup(a: Actor): void {
    this.state = 'windup';
    this.beginTelegraph(a, this.teleTime(AI.linkbound.telegraph), VIOLET);
    this.game.audio.play('eclipseBreath', { pos: a.pos, volume: 0.8 });
    // a freed body's beat is heard stumbling; linked bodies tick together through the link system's clock
    if (this.freed) this.game.audio.cadenceTick(a.pos, true);
  }

  private land(a: Actor): void {
    const L = AI.linkbound;
    const actors = this.game.actors;
    const physics = physicsOf(this.game);
    const victims = actors.inArc(a.pos, a.yaw, L.lungeArc, L.lungeReach, (o) => o !== a && o.targetable && !o.flying && actors.areHostile(a, o));
    for (let i = 0; i < victims.length && i < 2; i++) {
      const v = victims[i] as Actor;
      v.aimPoint(_pt);
      if (physics && !physics.lineOfFire(a.aimPoint(_from), _pt)) continue;
      const dx = v.pos.x - a.pos.x;
      const dz = v.pos.z - a.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      actors.applyHit(v, {
        attacker: a, damage: TUNING.enemies.linkbound.lunge, poise: 14, kind: 'melee', element: 'violet',
        dir: { x: dx / l, y: 0, z: dz / l }, point: { x: _pt.x, y: _pt.y, z: _pt.z }, knockback: 3, tag: 'lunge',
      });
    }
  }
}
