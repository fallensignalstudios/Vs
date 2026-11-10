/**
 * Companions (fighting / following allies) and protected NPCs. One class drives both: an ActorController with
 * a small order system (moveTo / follow / hold / scripted), support-level combat by archetype, signature
 * scripted assists (assist.ts), the downed → recover rule and good manners in doorways.
 */
import * as THREE from 'three';
import type { Actor, ActorController, Companion, CompanionMode, HitInfo, HitResult, HumanoidArchetype, Vec3Like } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { forwardX, forwardZ, rightX, rightZ } from '@/core/mathx';
import { Assist, type AssistKind } from './assist';
import { HELD_POSES, kitFor, type CompanionKit } from './companionKit';
import type { AiCore } from './core';
import { NavFollower, snapToNav } from './steer';
import { AI } from './tune';
import { caption, fin, live, nowOf, physicsOf, playerActor, socketPos, warnOnce } from './util';

const _goal = new THREE.Vector3();
const _from = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _snap = { x: 0, y: 0, z: 0 };
const _g = { y: 0, surface: null as never };

interface Order {
  pos: THREE.Vector3;
  run: boolean;
  yaw: number | null;
  stop: number;
}

export class CompanionImpl implements Companion, ActorController {
  actor!: Actor;
  private _mode: CompanionMode;
  arrived = true;
  removed = false;
  readonly kit: CompanionKit;
  private readonly nav: NavFollower;
  private order: Order | null = null;
  /** arrived at a moveTo() destination: stays there until follow() / a mode change / another order */
  private parked = false;
  private leader: Actor | null = null;
  private followPlayer = true;
  private offRight: number;
  private offBack: number;
  private readonly holdPos = new THREE.Vector3();
  private holdYaw: number | null = null;
  private faceTo: THREE.Vector3 | null = null;
  private focusTarget: Actor | null = null;
  private target: Actor | null = null;
  private retargetAt = 0;
  private followAt = 0;
  private readonly followGoal = new THREE.Vector3();
  private downedUntil = 0;
  private attackCd: number;
  /** attack in progress: seconds until it lands / ends (−1 = none) */
  private hitIn = -1;
  private endIn = -1;
  private attackTarget: Actor | null = null;
  private combo = 0;
  private drawn = false;
  private lastFightAt = -1e9;
  private stepUntil = 0;
  private readonly stepDir = new THREE.Vector3();
  private readonly assistRun: Assist;
  private pose: string | null = null;

  constructor(
    private readonly core: AiCore,
    readonly who: HumanoidArchetype,
    readonly npc: boolean,
    mode: CompanionMode,
    index: number,
    private readonly onRemove: (c: CompanionImpl) => void,
  ) {
    this._mode = mode;
    this.kit = kitFor(who);
    this.nav = new NavFollower(core.game);
    // companions fan out behind their leader instead of stacking on one spot
    this.offRight = (index % 2 === 0 ? 1 : -1) * (1.5 + Math.floor(index / 2) * 0.5);
    this.offBack = 2.2 + Math.floor(index / 2) * 1.5;
    this.attackCd = 0.8 + (index % 3) * 0.4;
    this.assistRun = new Assist(core, this);
  }

  /** called once, right after the actor has been spawned */
  attach(a: Actor): void {
    this.actor = a;
    this.holdPos.copy(a.pos);
    a.visual?.setLoadout(this.kit.loadout);
    const v = a.visual;
    if (isHumanoidVisual(v)) v.onFootstep = (_foot, world) => this.core.game.audio.play('footStone', { pos: world, volume: 0.45 });
  }

  // ---- Companion ------------------------------------------------------------------------------------------------

  get mode(): CompanionMode {
    return this._mode;
  }
  set mode(m: CompanionMode) {
    if (m !== 'follow' && m !== 'combat' && m !== 'hold' && m !== 'scripted') {
      warnOnce(`mode:${String(m)}`, `companion mode "${String(m)}" is unknown — using 'follow'`);
      m = 'follow';
    }
    // setting a mode (even the current one) releases a body parked by moveTo()
    this.parked = false;
    if (m === this._mode) return;
    this._mode = m;
    this.order = null;
    if (m === 'hold' && this.actor) this.holdPos.copy(this.actor.pos);
    if (m === 'follow' || m === 'combat') this.release();
  }

  get downed(): boolean {
    return this.downedUntil > 0;
  }
  get assisting(): boolean {
    return this.assistRun.pending;
  }
  get disrupted(): boolean {
    const a = this.actor;
    return !!a && (a.staggered || a.frozen || this.downed);
  }

  moveTo(pos: Vec3Like, opts?: { run?: boolean; yaw?: number; stopDistance?: number }): void {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) {
      warnOnce('moveTo', 'companion.moveTo() with a bad position — ignored');
      return;
    }
    this.release();
    this.order = {
      pos: new THREE.Vector3(pos.x, pos.y, pos.z), run: opts?.run === true,
      yaw: typeof opts?.yaw === 'number' && Number.isFinite(opts.yaw) ? opts.yaw : null,
      stop: Math.max(0.15, fin(opts?.stopDistance, 0.35)),
    };
    this.arrived = false;
    this.parked = false;
    this.nav.reset();
  }

  follow(leader: Actor | null, offset?: { right: number; back: number }): void {
    this.order = null;
    this.parked = false;
    this.release();
    this.leader = live(leader) ? leader : null;
    // following the protagonist means whoever the protagonist is (it changes at a handoff)
    this.followPlayer = this.leader !== null && this.leader === playerActor(this.core.game);
    if (offset && Number.isFinite(offset.right + offset.back)) {
      this.offRight = offset.right;
      this.offBack = offset.back;
    }
    if (!this.leader && this.actor) this.holdPos.copy(this.actor.pos);
  }

  holdAt(pos: Vec3Like, yaw?: number): void {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    this.release();
    this._mode = 'hold';
    this.order = null;
    this.parked = false;
    this.holdPos.set(pos.x, pos.y, pos.z);
    this.holdYaw = typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : null;
    this.arrived = false;
  }

  face(target: Vec3Like | null): void {
    this.faceTo = target && Number.isFinite(target.x + target.y + target.z) ? new THREE.Vector3(target.x, target.y, target.z) : null;
    this.actor?.visual?.lookAt(this.faceTo);
  }

  play(action: string, opts?: { loop?: boolean }): number {
    const a = this.actor;
    const v = a?.visual;
    if (!v) return 0;
    const info = v.play(action, opts);
    if (HELD_POSES.has(action) && opts?.loop !== false) {
      // seated / lying / working figures are set pieces: nothing shoves them
      this.pose = action;
      a.fixed = true;
    }
    return fin(info?.duration, 0);
  }

  stopAction(): void {
    this.actor?.visual?.stop();
    this.release();
    this.actor?.visual?.setLoadout(this.kit.loadout);
  }

  /** let go of a held pose so the body can walk again */
  private release(): void {
    const a = this.actor;
    if (!a) return;
    if (this.pose) {
      a.visual?.stop(this.pose);
      this.pose = null;
    }
    a.fixed = false;
  }

  teleport(pos: Vec3Like, yaw?: number): void {
    const a = this.actor;
    if (!a || !pos || !Number.isFinite(pos.x + pos.y + pos.z)) return;
    let y = pos.y;
    const physics = physicsOf(this.core.game);
    if (physics) {
      const g = physics.groundAt(pos.x, pos.z, pos.y + 0.5, 0.6, _g);
      if (g && Number.isFinite(g.y)) y = g.y;
    }
    a.pos.set(pos.x, y, pos.z);
    if (typeof yaw === 'number' && Number.isFinite(yaw)) a.yaw = yaw;
    a.impulse.set(0, 0, 0);
    this.nav.reset();
    this.order = null;
    this.arrived = true;
    this.holdPos.copy(a.pos);
    const v = a.visual;
    if (isHumanoidVisual(v)) v.teleported();
  }

  focus(target: Actor | null): void {
    this.focusTarget = live(target) ? target : null;
  }

  assist(target: Actor, kind: AssistKind): void {
    if (!live(target) || !this.actor?.alive || this.downed) return;
    this.release();
    this.cancelAttack();
    this.holster();
    this.assistRun.start(target, kind);
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.assistRun.cancel();
    const a = this.actor;
    if (a) {
      const v = a.visual;
      if (isHumanoidVisual(v)) v.onFootstep = null;
      this.core.game.actors.despawn(a);
    }
    this.onRemove(this);
  }

  // ---- downed / recover -------------------------------------------------------------------------------------------

  /** hp ran out (or nearly): kneel, untouchable, for a few seconds — companions never die */
  goDown(): void {
    const a = this.actor;
    if (!a || this.downed || this.npc) return;
    const game = this.core.game;
    this.downedUntil = nowOf(game) + AI.companion.downSeconds;
    this.assistRun.cancel();
    this.cancelAttack();
    a.invulnerable = true;
    a.targetable = false;
    a.guarding = false;
    a.hp = Math.max(1, a.hp);
    a.visual?.play('kneel', { loop: true });
    caption(game, `${a.name} is down — recovering`, 'alert', a.pos);
  }

  /** called by the AI system every tick, also while the actor is dead */
  tick(): void {
    const a = this.actor;
    if (!a || this.removed) return;
    const game = this.core.game;
    if (!a.alive) {
      // a blow took everything at once: back on a knee instead of a corpse
      game.actors.revive(a, 1);
      this.downedUntil = 0;
      this.goDown();
    }
    if (this.downed && nowOf(game) >= this.downedUntil) {
      this.downedUntil = 0;
      a.hp = Math.max(a.hp, a.maxHp * AI.companion.recoverTo);
      a.invulnerable = false;
      a.targetable = true;
      a.visual?.stop('kneel');
    }
  }

  // ---- ActorController ------------------------------------------------------------------------------------------------

  onHit(a: Actor, _hit: HitInfo, _res: HitResult): void {
    if (!this.npc && a.alive && !this.downed && a.hp <= a.maxHp * AI.companion.downAt) this.goDown();
  }

  update(a: Actor, dt: number): void {
    if (this.downed || a.fixed) return;
    if (a.frozen || a.staggered) {
      this.cancelAttack();
      this.assistRun.interrupted();
      return;
    }
    const game = this.core.game;
    const now = nowOf(game);
    if (this.assistRun.active) {
      this.assistRun.update(a, dt, this.nav);
      return;
    }
    if (this.order) {
      const o = this.order;
      if (this.nav.moveTo(a, o.pos, o.run ? AI.companion.run : AI.companion.walk, dt, { stop: o.stop })) {
        this.arrived = true;
        this.parked = true;
        this.holdPos.copy(a.pos);
        this.holdYaw = o.yaw;
        this.order = null;
      } else if (this.nav.stuck > AI.companion.stuckSeconds) this.unstick(a, o.pos);
      return;
    }

    if ((this._mode === 'combat' || this._mode === 'hold') && !this.npc && this.kit.style !== 'none' && !this.core.ceasefire) {
      if (this.fight(a, dt, now)) {
        this.lastFightAt = now;
        return;
      }
    } else this.cancelAttack();
    if (this.drawn && now - this.lastFightAt > 1.5) this.holster();

    if (this.parked) {
      this.stand(a, dt);
    } else if (this._mode === 'follow' || this._mode === 'combat') {
      const leader = this.followPlayer ? playerActor(game) : this.leader;
      if (leader && leader !== a) this.followLeader(a, leader, dt, now);
      else this.stand(a, dt);
    } else if (this._mode === 'hold') {
      if (this.nav.moveTo(a, this.holdPos, AI.companion.walk, dt, { stop: 0.4 })) {
        this.arrived = true;
        this.stand(a, dt);
      }
    } else {
      this.stand(a, dt);
    }
  }

  dispose(_a: Actor): void {
    this.assistRun.cancel();
  }

  // ---- movement -----------------------------------------------------------------------------------------------------

  /** stationary: face what was asked, and step out of the protagonist's way */
  private stand(a: Actor, dt: number): void {
    const game = this.core.game;
    const now = nowOf(game);
    if (now < this.stepUntil) {
      a.desiredVel.set(this.stepDir.x * 2.6, 0, this.stepDir.z * 2.6);
      return;
    }
    this.nav.halt(a);
    if (this.faceTo) a.face(this.faceTo, 6 * dt);
    else if (this.holdYaw !== null && (this.parked || this._mode === 'hold' || this._mode === 'scripted')) {
      _goal.set(a.pos.x + forwardX(this.holdYaw), a.pos.y, a.pos.z + forwardZ(this.holdYaw));
      a.face(_goal, 5 * dt);
    }
    // never block a doorway: when the protagonist pushes into this body, it steps aside
    const p = playerActor(game);
    if (!p || p === a) return;
    const dx = a.pos.x - p.pos.x;
    const dz = a.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > a.radius + p.radius + 0.45 || d < 1e-3) return;
    const push = (p.vel.x * dx + p.vel.z * dz) / d;
    if (push < 0.8) return;
    const physics = physicsOf(game);
    for (const side of [1, -1]) {
      const sx = (-dz / d) * side;
      const sz = (dx / d) * side;
      if (physics && !physics.canStand(a.pos.x + sx * 1.2, a.pos.y, a.pos.z + sz * 1.2, a.radius)) continue;
      this.stepDir.set(sx, 0, sz);
      this.stepUntil = now + 0.45;
      if (this._mode === 'hold' || this._mode === 'scripted') this.holdPos.set(a.pos.x + sx * 1.2, a.pos.y, a.pos.z + sz * 1.2);
      return;
    }
  }

  private followLeader(a: Actor, leader: Actor, dt: number, now: number): void {
    const C = AI.companion;
    if (now >= this.followAt) {
      this.followAt = now + 0.25;
      _snap.x = leader.pos.x + rightX(leader.yaw) * this.offRight - forwardX(leader.yaw) * this.offBack;
      _snap.y = leader.pos.y;
      _snap.z = leader.pos.z + rightZ(leader.yaw) * this.offRight - forwardZ(leader.yaw) * this.offBack;
      snapToNav(this.core.game, _snap, 3, _snap);
      this.followGoal.set(_snap.x, _snap.y, _snap.z);
    }
    const dist = a.distanceTo(this.followGoal);
    const far = a.distanceTo(leader);
    if (far > 45) {
      // hopelessly behind (a cut, a lift): rejoin at the slot
      this.teleport(this.followGoal, leader.yaw);
      return;
    }
    if (dist < C.followNear && far < C.followFar) {
      this.arrived = true;
      this.stand(a, dt);
      return;
    }
    this.arrived = false;
    const run = far > C.followFar || Math.hypot(leader.vel.x, leader.vel.z) > 3.5;
    if (!this.nav.moveTo(a, this.followGoal, run ? C.run : C.walk, dt, { stop: 0.7 }) && this.nav.stuck > C.stuckSeconds) this.unstick(a, this.followGoal);
  }

  /** stuck for seconds: reposition to the nearest valid spot toward the goal */
  private unstick(a: Actor, goal: Vec3Like): void {
    const physics = physicsOf(this.core.game);
    this.nav.reset();
    if (!physics) return;
    const mx = a.pos.x + (goal.x - a.pos.x) * 0.35;
    const mz = a.pos.z + (goal.z - a.pos.z) * 0.35;
    const p = physics.nearestStandable(mx, a.pos.y, mz, a.radius, 6, a.height);
    if (p && Number.isFinite(p.x + p.y + p.z)) {
      a.pos.set(p.x, p.y, p.z);
      const v = a.visual;
      if (isHumanoidVisual(v)) v.teleported();
    }
  }

  // ---- combat -------------------------------------------------------------------------------------------------------

  private cancelAttack(): void {
    this.hitIn = this.endIn = -1;
    this.attackTarget = null;
  }

  /** put the ranged weapon away once the shooting has stopped for a moment */
  private holster(): void {
    if (!this.drawn) return;
    this.drawn = false;
    this.actor?.visual?.stop(this.kit.aimPose);
    this.actor?.visual?.setLoadout(this.kit.loadout);
  }

  private acceptable(a: Actor, t: Actor | null): t is Actor {
    if (!t || !t.alive || !t.targetable || !this.core.game.actors.areHostile(a, t)) return false;
    if (t.tags.has('playerOnly') || t.tags.has('device')) return false;
    // the last enemy of an encounter belongs to the player once it is nearly beaten
    const enc = this.core.memberOf(t);
    if (enc && enc.aliveCount <= 1 && enc.queued === 0 && t.hp <= t.maxHp * AI.companion.lastKillGuard) return false;
    return true;
  }

  private pick(a: Actor, now: number): Actor | null {
    if (this.acceptable(a, this.focusTarget)) return this.focusTarget;
    if (this.acceptable(a, this.target) && now < this.retargetAt) return this.target;
    this.retargetAt = now + 0.7;
    const list = this.core.game.actors.hostilesOf(a);
    const anchor = this._mode === 'hold' ? this.holdPos : (playerActor(this.core.game)?.pos ?? a.pos);
    let best: Actor | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i] as Actor;
      if (!this.acceptable(a, c)) continue;
      if (c.distanceTo(anchor) > AI.companion.engage) continue;
      const s = a.distanceTo(c) * (c === this.target ? 0.6 : 1);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return (this.target = best);
  }

  /** returns true when combat owns the body this tick */
  private fight(a: Actor, dt: number, now: number): boolean {
    const game = this.core.game;
    const kit = this.kit;
    // an attack already thrown plays out
    if (this.endIn >= 0) {
      this.nav.halt(a);
      const t = this.attackTarget;
      if (this.hitIn >= 0) {
        this.hitIn -= dt;
        if (t && t.alive) a.face(t.pos, 8 * dt);
        if (this.hitIn < 0 && t && this.acceptable(a, t)) this.land(a, t);
      }
      this.endIn -= dt;
      if (this.endIn < 0) this.cancelAttack();
      return true;
    }
    this.attackCd -= dt;
    const t = this.pick(a, now);
    if (!t) return false;
    const dist = a.distanceTo(t);
    const melee = kit.style === 'melee' || (kit.closeDamage > 0 && dist < 2.6 && !t.flying);
    if (melee) {
      if (t.flying) return false;
      const reach = 2.3 + t.radius;
      const leash = this._mode === 'hold' ? 3 : AI.companion.engage;
      if (dist > reach) {
        if (kit.style !== 'melee' || t.distanceTo(this._mode === 'hold' ? this.holdPos : a.pos) > leash) return false;
        this.nav.moveTo(a, t.pos, AI.companion.run, dt, { stop: reach - 0.4 });
        return true;
      }
      a.face(t.pos, 9 * dt);
      this.nav.halt(a);
      if (this.attackCd <= 0) {
        this.combo = (this.combo % 3) + 1;
        const info = a.visual?.play(`attackLight${this.combo}`);
        this.hitIn = Math.max(0.1, fin(info?.hitTimes?.[0], 0.25));
        this.endIn = Math.max(this.hitIn + 0.1, fin(info?.duration, 0.6));
        this.attackTarget = t;
        this.attackCd = kit.interval;
        game.audio.play(kit.style === 'melee' ? 'swingHeavy' : 'verityWhirl', { pos: a.pos, volume: 0.7 });
      }
      return true;
    }
    // ranged: fire from where it stands when the line is clear, otherwise leave the body to its mode
    if (dist > AI.companion.engage) return false;
    const physics = physicsOf(game);
    if (physics && !physics.lineOfFire(a.aimPoint(_from), t.aimPoint(_aim))) return false;
    a.face(t.pos, 7 * dt);
    this.nav.halt(a);
    if (this.attackCd <= 0) {
      if (!this.drawn) {
        this.drawn = true;
        a.visual?.setLoadout(kit.drawn);
        a.visual?.play(kit.aimPose, { loop: true });
      }
      // a short, readable aim before every shot
      this.hitIn = 0.35;
      this.endIn = 0.75;
      this.attackTarget = t;
      this.attackCd = kit.interval;
    }
    return true;
  }

  private land(a: Actor, t: Actor): void {
    const game = this.core.game;
    const kit = this.kit;
    const close = kit.style === 'melee' || (kit.closeDamage > 0 && a.distanceTo(t) < 3 && !this.drawn);
    if (close) {
      if (a.distanceTo(t) > 3.1 + t.radius) return;
      const dx = t.pos.x - a.pos.x;
      const dz = t.pos.z - a.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      t.aimPoint(_aim);
      game.actors.applyHit(t, {
        attacker: a, damage: kit.style === 'melee' ? kit.damage : kit.closeDamage, poise: kit.poise, kind: 'melee', element: kit.element,
        dir: { x: dx / l, y: 0, z: dz / l }, point: { x: _aim.x, y: _aim.y, z: _aim.z }, knockback: 1.5,
      });
      return;
    }
    socketPos(a, 'muzzle', _from);
    _dir.copy(t.aimPoint(_aim)).sub(_from);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    game.vfx.spawn(kit.muzzle, _from, { dir: _dir, scale: 0.7 });
    game.audio.play(kit.sfx, { pos: a.pos, volume: 0.6 });
    a.visual?.play('shoot');
    this.core.projectiles.fire({
      owner: a, from: _from, dir: _dir, speed: 140, range: AI.companion.engage + 12, damage: kit.damage, poise: kit.poise,
      element: kit.element, style: kit.tracer,
    });
  }
}
