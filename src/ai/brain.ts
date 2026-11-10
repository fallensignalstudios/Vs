/**
 * Base class of every enemy brain (one ActorController per role). It owns what all roles share: the spawn
 * presentation, dormancy, target choice with stickiness, the ceasefire, interruption by stagger / freeze,
 * telegraph bookkeeping and melee tokens. Roles implement `think()` as a small state machine.
 */
import * as THREE from 'three';
import type { Actor, ActorController, EnemyRole, HitInfo, HitResult, LinkHandle, SpawnOpts, VfxHandle } from '@/core/api';
import type { AiCore } from './core';
import type { EncounterImpl } from './encounter';
import { NavFollower } from './steer';
import { AI } from './tune';
import { fin, live, nowOf, playerActor, telegraphScale } from './util';

interface Entrance {
  kind: 'aperture' | 'ceiling' | 'breach' | 'march';
  t: number;
  /** seconds until the brain takes over (breach / ceiling) */
  dur: number;
  to: THREE.Vector3;
  shown: boolean;
}

export abstract class Brain implements ActorController {
  enc: EncounterImpl | null = null;
  target: Actor | null = null;
  dormant: boolean;
  /** lane post / line slot / home position */
  readonly post = new THREE.Vector3();
  protected readonly nav: NavFollower;
  protected entrance: Entrance | null = null;
  private retargetAt = 0;
  private interrupted = false;
  private slot = false;
  /** telegraph in progress: seconds left / total, colour */
  protected teleLeft = 0;
  protected teleTotal = 0;
  private teleColor: number | undefined;
  /** ground markers of the attack being telegraphed (cancelled if the attack is interrupted) */
  protected readonly marks: VfxHandle[] = [];
  /** sim time this brain last started an attack */
  lastAttackAt = -1e9;

  constructor(
    protected readonly core: AiCore,
    readonly role: EnemyRole,
    protected readonly opts: SpawnOpts,
  ) {
    this.nav = new NavFollower(core.game);
    this.dormant = opts.dormant === true;
    const p = opts.post ?? opts.pos;
    this.post.set(fin(p?.x), fin(p?.y), fin(p?.z));
  }

  protected get game() {
    return this.core.game;
  }
  protected get now(): number {
    return nowOf(this.core.game);
  }
  /** deterministic gameplay random in [lo, hi) */
  protected rand(lo: number, hi: number): number {
    return lo + (hi - lo) * fin(this.core.game.random(), 0.5);
  }

  /** called once, right after the actor has been spawned */
  attach(a: Actor): void {
    const via = this.opts.via ?? 'none';
    const from = this.opts.from;
    const v = a.visual;
    if (via === 'none') {
      this.onActive(a);
      return;
    }
    const to = new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z);
    this.entrance = { kind: via, t: 0, dur: 0, to, shown: true };
    const audio = this.game.audio;
    if (via === 'breach') {
      // the burst first, the body half a second later
      this.game.vfx.spawn('eclipseSpawn', { x: a.pos.x, y: a.pos.y - (a.flying ? a.hoverHeight : 0), z: a.pos.z });
      audio.play('breachCrack', { pos: a.pos });
      v?.setVisible(false);
      a.targetable = false;
      this.entrance.shown = false;
      this.entrance.dur = 0.5 + Math.min(1.3, fin(v?.info('spawnBreach').duration, 1) * 0.75);
    } else if (via === 'ceiling') {
      if (a.flying) a.pos.y += 5;
      const info = v?.play('spawnDrop');
      this.entrance.dur = Math.min(1.4, Math.max(0.5, fin(info?.duration, 0.9)));
    } else if (from && Number.isFinite(from.x + from.y + from.z)) {
      // aperture / march: start at the mouth and travel in
      a.pos.set(from.x, a.flying ? from.y : a.pos.y, from.z);
      if (!a.flying) a.pos.y = fin(from.y, a.pos.y);
      a.face(to);
      if (via === 'aperture') audio.play('apertureOpen', { pos: from });
      this.entrance.dur = 12;
    } else {
      this.entrance = null;
      this.onActive(a);
    }
  }

  /** the entrance has finished (or there was none): the role may set itself up */
  protected onActive(_a: Actor): void {}

  private runEntrance(a: Actor, dt: number): void {
    const e = this.entrance as Entrance;
    e.t += dt;
    if (e.kind === 'breach') {
      if (!e.shown && e.t >= 0.5) {
        e.shown = true;
        a.visual?.setVisible(true);
        a.visual?.play('spawnBreach');
        a.targetable = true;
      }
    } else if (e.kind === 'aperture' || e.kind === 'march') {
      const speed = a.flying ? 6.5 : e.kind === 'march' ? 1.9 : 3.2;
      let arrived: boolean;
      if (a.flying) {
        const dx = e.to.x - a.pos.x;
        const dz = e.to.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        arrived = d < 0.4;
        if (!arrived) {
          a.desiredVel.set((dx / d) * Math.min(speed, d * 4 + 1), 0, (dz / d) * Math.min(speed, d * 4 + 1));
          a.face(e.to, 6 * dt);
        }
      } else {
        if (e.kind === 'march') a.guarding = true;
        arrived = this.nav.moveTo(a, e.to, speed, dt, { turn: 4 });
      }
      // a marching line does not wait to be attacked at point-blank range
      const t = this.target;
      const close = e.kind === 'march' && t !== null && t.alive && a.distanceTo(t) < 7;
      if (arrived || close || this.nav.stuck > 2) e.t = e.dur;
    }
    if (e.t >= e.dur) {
      this.entrance = null;
      a.targetable = true;
      a.visual?.setVisible(true);
      this.nav.reset();
      this.onActive(a);
    }
  }

  // ---- ActorController ----------------------------------------------------------------------------------

  update(a: Actor, dt: number): void {
    if (this.entrance) {
      this.pickTarget(a);
      this.runEntrance(a, dt);
      return;
    }
    if (this.dormant) {
      this.idle(a, dt);
      return;
    }
    if (a.frozen || a.staggered) {
      if (!this.interrupted) {
        this.interrupted = true;
        this.cancelAttack(a);
        this.onInterrupted(a);
      }
      return;
    }
    if (this.interrupted) {
      this.interrupted = false;
      this.onRecovered(a);
    }
    this.pickTarget(a);
    if (this.core.ceasefire) {
      this.cancelAttack(a);
      this.calm(a, dt);
      return;
    }
    this.think(a, dt);
  }

  onHit(a: Actor, hit: HitInfo, _res: HitResult): void {
    if (this.dormant) this.wake();
    // whoever hurts it earns its attention when it has no better claim on someone closer
    const by = hit.attacker;
    if (live(by) && by.alive && by !== this.target && this.canTarget(a, by) && this.game.actors.areHostile(a, by)) {
      const t = this.target;
      if (!t || !t.alive || a.distanceTo(by) < a.distanceTo(t) * 1.4) {
        this.target = by;
        this.retargetAt = this.now + 2.5;
      }
    }
  }

  onDeath(a: Actor, _killer: Actor | null): void {
    this.cancelAttack(a);
    this.cleanup(a);
  }

  dispose(a: Actor): void {
    this.cancelAttack(a);
    this.cleanup(a);
  }

  // ---- hooks for roles ------------------------------------------------------------------------------------

  protected abstract think(a: Actor, dt: number): void;
  /** dormant: nothing to do but look alive */
  protected idle(_a: Actor, _dt: number): void {}
  /** ceasefire: hold position, attack nothing */
  protected calm(a: Actor, _dt: number): void {
    this.nav.halt(a);
  }
  /** a stagger or freeze interrupted whatever was going on (the attack has already been cancelled) */
  protected onInterrupted(_a: Actor): void {}
  protected onRecovered(_a: Actor): void {}
  /** stop loops, beams and anything else the role owns */
  protected cleanup(_a: Actor): void {}
  /** role-specific target filter */
  protected canTarget(_a: Actor, t: Actor): boolean {
    return !t.tags.has('device') && !t.protectedNpc && t.team !== 'neutral';
  }
  /** distance multiplier when choosing a target (> 1 = less interesting). Ground fighters care little for what flies. */
  protected targetWeight(_a: Actor, _t: Actor): number {
    return 1;
  }
  /** a link whose TARGET is this body was cut */
  onLinkSevered(_a: Actor, _link: LinkHandle, _by: Actor | null): void {}
  /** a link whose SOURCE is this body was cut */
  onLinkLost(_a: Actor, _link: LinkHandle, _by: Actor | null): void {}

  wake(): void {
    this.dormant = false;
  }

  // ---- shared behaviour -----------------------------------------------------------------------------------

  protected validTarget(a: Actor, t: Actor | null): t is Actor {
    return !!t && t.alive && t.targetable && this.game.actors.areHostile(a, t);
  }

  protected pickTarget(a: Actor): void {
    const now = this.now;
    if (this.validTarget(a, this.target) && now < this.retargetAt) return;
    this.retargetAt = now + AI.retarget + ((a.id * 0.071) % 0.15);
    const list = this.game.actors.hostilesOf(a);
    const player = playerActor(this.game);
    let best: Actor | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i] as Actor;
      if (!this.canTarget(a, c)) continue;
      let s = a.distanceTo(c) * this.targetWeight(a, c);
      if (c === player) s *= 0.8;
      // stickiness: the current target keeps its claim unless something is clearly closer
      if (c === this.target) s *= 0.6;
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    this.target = best;
  }

  /** telegraph length for this difficulty; never below the readable minimum */
  protected teleTime(base: number): number {
    return Math.max(AI.minTelegraph, base) * telegraphScale(this.game);
  }

  /** start a telegraph of exactly `seconds` (already scaled) */
  protected beginTelegraph(a: Actor, seconds: number, color?: number): void {
    this.teleLeft = this.teleTotal = Math.max(0.05, seconds);
    this.teleColor = color;
    this.lastAttackAt = this.now;
    this.core.noteTelegraph(seconds);
    this.core.noteAttack();
    a.visual?.setTelegraph(0.05, color);
  }

  /** advance the telegraph; true when it has run out */
  protected tickTelegraph(a: Actor, dt: number): boolean {
    this.teleLeft -= dt;
    const k = 1 - Math.max(0, this.teleLeft) / Math.max(0.05, this.teleTotal);
    a.visual?.setTelegraph(Math.min(1, 0.15 + k * 0.85), this.teleColor);
    return this.teleLeft <= 0;
  }

  protected endTelegraph(a: Actor): void {
    this.teleLeft = 0;
    a.visual?.setTelegraph(0);
  }

  /** drop the telegraph, its ground markers and the melee token */
  protected cancelAttack(a: Actor): void {
    if (this.teleLeft > 0) this.endTelegraph(a);
    for (const m of this.marks) m.stop();
    this.marks.length = 0;
    this.releaseSlot(a);
    this.onAttackCancelled(a);
  }

  /** role state reset when an attack is cancelled */
  protected onAttackCancelled(_a: Actor): void {}

  protected acquireSlot(a: Actor): boolean {
    if (this.slot) return true;
    this.slot = this.enc ? this.enc.acquireMeleeSlot(a) : true;
    return this.slot;
  }

  protected releaseSlot(a: Actor): void {
    if (!this.slot) return;
    this.slot = false;
    this.enc?.releaseMeleeSlot(a);
  }

  protected get holdsSlot(): boolean {
    return this.slot;
  }
}
