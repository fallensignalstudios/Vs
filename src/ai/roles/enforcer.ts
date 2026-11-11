/**
 * Dominion Enforcer: a shield wall. Holds a line slot beside its neighbours, shield up (frontal 140°, widening to
 * 200° while it overlaps a neighbour facing the same way). Against anything that is not on the player's side the
 * front HOLDS ITS POSTS (shared facing, clamped to each post's arc; sidearm answers; at most one member peels off
 * briefly to press a threat close to the line). On a player-side target it advances as one wall (shared advance
 * vector, `front.leash`). It turns slowly, so the answer is the flank, a heavy blow / poise break, or stasis.
 * Attacks open the guard: shield bash and shock baton up close (melee token required), sidearm at range.
 */
import * as THREE from 'three';
import type { Actor, SpawnOpts } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { TUNING } from '@/combat/tuning';
import { angleDelta, clamp, DEG, forwardX, forwardZ, yawTo } from '@/core/mathx';
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
const _face = new THREE.Vector3();

/** resolved SpawnOpts.front */
interface Front {
  leash: number;
  anyTarget: boolean;
  holdArc: number;
  maxPeel: number;
}

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
  private shot: Actor | null = null;
  private shotScanAt = 0;
  private readonly front: Front;
  /** the yaw this member's slot faces (spawn yaw) */
  private readonly postYaw: number;
  /** stepping out of the line toward a close threat until this sim time / the last peel ended at */
  peelUntil = 0;
  peelEndedAt = -1e9;
  /** the front's shared facing (yaw from the posts' centroid to the front's threat), refreshed at 4 Hz */
  private frontYaw = NaN;
  private frontThreat: Actor | null = null;

  constructor(core: AiCore, opts: SpawnOpts) {
    super(core, 'enforcer', opts);
    this.meleeCd = this.rand(0.4, 1.2);
    this.shootCd = this.rand(1.5, 3.5);
    const E = AI.enforcer;
    const f = opts.front ?? {};
    this.front = {
      leash: clamp(fin(f.leash, E.leash), 0, 80),
      anyTarget: f.advanceOn === 'any',
      holdArc: clamp(fin(f.holdArc, E.holdArc), 0, 180) * DEG,
      maxPeel: Math.max(0, Math.floor(fin(f.maxPeel, 1))),
    };
    this.postYaw = fin(opts.yaw, 0);
  }

  /** the wall advances on this target (otherwise it holds its posts) */
  private presses(t: Actor): boolean {
    return this.front.anyTarget || t.team === 'player';
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

  /**
   * The wall advances on what walks; what flies is only worth a sidearm round. A front that holds against
   * everything but the player's side turns to her the moment she can be targeted (noticed), whatever it was
   * trading fire with.
   */
  protected override targetWeight(_a: Actor, t: Actor): number {
    if (!this.front.anyTarget && t.team === 'player') return 0.3;
    return t.flying ? 3 : 1;
  }

  /** who the sidearm fires at: the main target when it can be hit, else any hostile in range with a clear line (drones) */
  private shotTarget(a: Actor, main: Actor, dist: number, facing: number): Actor | null {
    const E = AI.enforcer;
    if (dist >= E.sidearmRange[0] && dist <= E.sidearmRange[1] && facing < 0.5 && this.clearShot(a, main)) return main;
    const list = this.game.actors.hostilesOf(a);
    for (let i = 0; i < list.length; i++) {
      const c = list[i] as Actor;
      if (c === main || !this.canTarget(a, c)) continue;
      const d = a.distanceTo(c);
      if (d < E.sidearmRange[0] || d > E.sidearmRange[1]) continue;
      if (Math.abs(angleDelta(a.yaw, yawTo(a.pos.x, a.pos.z, c.pos.x, c.pos.z))) > 0.9) continue;
      if (this.clearShot(a, c)) return c;
    }
    return null;
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

  /** the brains of the other living members of this front (posts within 14 m of this one) */
  private frontMates(a: Actor, out: EnforcerBrain[]): EnforcerBrain[] {
    out.length = 0;
    for (const o of this.neighbours(a, this.nb)) {
      const b = this.core.brainOf(o);
      if (b instanceof EnforcerBrain && b.post.distanceToSquared(this.post) <= 14 * 14) out.push(b);
    }
    return out;
  }

  private readonly mates: EnforcerBrain[] = [];

  /**
   * The front's shared threat and facing (4 Hz): the lowest-id living member's target leads, so every holding
   * shield turns the same way and the overlap survives; the facing is measured from the posts' centroid.
   */
  private updateFront(a: Actor): void {
    let lead: Actor | null = this.validTarget(a, this.target) ? this.target : null;
    let leadId = a.id;
    let cx = this.post.x;
    let cz = this.post.z;
    let n = 1;
    for (const b of this.frontMates(a, this.mates)) {
      cx += b.post.x;
      cz += b.post.z;
      n++;
    }
    for (const o of this.nb) {
      const b = this.core.brainOf(o);
      if (!(b instanceof EnforcerBrain) || !this.mates.includes(b) || o.id > leadId) continue;
      const t = b.target;
      if (t && this.validTarget(a, t) && this.canTarget(a, t)) {
        lead = t;
        leadId = o.id;
      }
    }
    this.frontThreat = lead;
    this.frontYaw = lead ? yawTo(cx / n, cz / n, lead.pos.x, lead.pos.z) : NaN;
  }

  /**
   * May this member step out of the line now? The front's peel budget counts every member still out of its slot
   * (peeling, or walking back from a peel), and peels are spaced by a front-wide gap.
   */
  private canPeel(): boolean {
    if (this.front.maxPeel <= 0) return false;
    const now = this.now;
    let out = 0;
    let lastEnd = this.peelEndedAt;
    for (const o of this.nb) {
      const b = this.core.brainOf(o);
      if (!(b instanceof EnforcerBrain) || !this.mates.includes(b)) continue;
      if (b.peelUntil > now || Math.hypot(o.pos.x - b.post.x, o.pos.z - b.post.z) > 1.5) out++;
      lastEnd = Math.max(lastEnd, b.peelEndedAt);
    }
    return out < this.front.maxPeel && now >= lastEnd + AI.enforcer.peelGap;
  }

  /** holding the line: the post (or a short peel toward a close threat), shields turned within the post's arc */
  private holdGoal(a: Actor, t: Actor, out: THREE.Vector3): THREE.Vector3 {
    const E = AI.enforcer;
    const now = this.now;
    out.copy(this.post);
    const dx = t.pos.x - this.post.x;
    const dz = t.pos.z - this.post.z;
    const d = Math.hypot(dx, dz) || 1;
    if (this.peelUntil <= now && this.peelUntil > 0) {
      this.peelUntil = 0;
      this.peelEndedAt = now;
    }
    if (this.peelUntil === 0 && now >= this.brokenUntil && d < E.peelRange && this.canPeel()) this.peelUntil = now + E.peelSeconds;
    if (this.peelUntil > now) {
      const step = Math.max(0, Math.min(E.peelStep, d - E.standOff - t.radius));
      out.x += (dx / d) * step;
      out.z += (dz / d) * step;
    } else if (now < this.brokenUntil) {
      out.x -= (dx / d) * 1.6;
      out.z -= (dz / d) * 1.6;
    }
    return out;
  }

  /** where a holding shield looks: the front's shared facing, clamped to this post's arc (a peeling member faces its threat) */
  private holdFacing(a: Actor, t: Actor, out: THREE.Vector3): THREE.Vector3 {
    if (this.peelUntil > this.now) return out.copy(t.pos);
    const want = Number.isFinite(this.frontYaw) ? this.frontYaw : yawTo(a.pos.x, a.pos.z, t.pos.x, t.pos.z);
    const yaw = this.postYaw + clamp(angleDelta(this.postYaw, want), -this.front.holdArc, this.front.holdArc);
    return out.set(a.pos.x + forwardX(yaw) * 6, a.pos.y, a.pos.z + forwardZ(yaw) * 6);
  }

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
    const adv = Math.max(0, Math.min(this.front.leash, d - E.standOff));
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
      this.updateFront(a);
    }
    if (!this.validTarget(a, t)) {
      if (this.state !== 'advance') this.cancelAttack(a);
      a.guarding = true;
      if (this.peelUntil > 0) {
        this.peelUntil = 0;
        this.peelEndedAt = now;
      }
      const threat = this.frontThreat;
      this.nav.moveTo(a, this.post, E.speed, dt, { turn: E.turn, faceTo: threat && threat.alive ? this.holdFacing(a, threat, _face) : null });
      return;
    }
    const dist = a.distanceTo(t);
    const facing = Math.abs(angleDelta(a.yaw, yawTo(a.pos.x, a.pos.z, t.pos.x, t.pos.z)));
    this.meleeCd -= dt;
    this.shootCd -= dt;
    // looking for something to shoot is a 4 Hz job, not a per-tick one
    if (this.shootCd <= 0 && this.state === 'advance' && now < this.shotScanAt) this.shootCd = 1e-3;
    else if (this.shootCd <= 0) this.shotScanAt = now + 0.25;

    switch (this.state) {
      case 'advance': {
        a.guarding = true;
        if (this.presses(t)) {
          if (this.peelUntil > 0) {
            this.peelUntil = 0;
            this.peelEndedAt = now;
          }
          this.formationGoal(a, t, _goal);
          this.nav.moveTo(a, _goal, E.speed, dt, { turn: E.turn, faceTo: t.pos, stop: 0.3 });
        } else {
          this.holdGoal(a, t, _goal);
          this.nav.moveTo(a, _goal, E.speed, dt, { turn: E.turn, faceTo: this.holdFacing(a, t, _face), stop: 0.3 });
        }
        const grounded = !t.flying;
        if (grounded && dist < E.bashRange + t.radius && facing < E.attackArc * 0.5 && this.meleeCd <= 0 && this.acquireSlot(a)) {
          this.attack = dist < 1.9 + t.radius || this.rand(0, 1) < 0.5 ? 'bash' : 'baton';
          this.state = 'windup';
          this.beginTelegraph(a, this.teleTime(E.telegraph), AMBER, this.attack === 'bash' ? 'shieldBash' : 'baton', t);
          this.game.audio.play('shieldUp', { pos: a.pos });
        } else if (this.shootCd <= 0 && (this.shot = this.shotTarget(a, t, dist, facing)) !== null) {
          this.state = 'aim';
          a.visual?.setLoadout({ shield: true, ranged: true });
          this.beginTelegraph(a, this.teleTime(E.sidearmTelegraph), AMBER, 'sidearm', t);
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
        const st = this.shot && this.shot.alive ? this.shot : t;
        if (k < 0.6) {
          a.face(st.pos, 3 * dt);
          socketPos(a, 'muzzle', _from);
          this.aimDir.copy(st.aimPoint(_aim)).sub(_from).normalize();
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
