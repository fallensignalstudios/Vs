/**
 * Guard. Tarrik: hold to block the frontal arc, press inside the window before an impact for a perfect guard →
 * counter prompt (attack within 0.6 s for a guaranteed heavy-poise riposte). Selene: tap for a 0.5 s deflect
 * stance — projectiles are turned back at their shooter, timed melee is parried, heavies are not tanked.
 */
import * as THREE from 'three';
import type { Actor, ContextAction, HitInfo, HitResult } from '@/core/api';
import { forwardX, forwardZ } from '@/core/mathx';
import { TUNING, windowScale } from '../tuning';
import { fin } from '../safe';
import type { PlayerControllerImpl } from './controller';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Guard {
  private lastPressAt = -1e9;
  private counterUntil = 0;
  private counterTarget: Actor | null = null;
  private counterT = 0;
  private counterHit = 0;
  private counterDur = 0;
  private counterDone = false;
  private deflectT = 0;
  private deflectEnd = 0;
  private deflectReadyAt = 0;
  /** HUD prompt shown while the counter window is open */
  private readonly prompt: ContextAction = {
    id: 'counter', prompt: 'Counter', button: 'attack', window: TUNING.guard.counterWindow, onConfirm() {},
  };

  constructor(private readonly p: PlayerControllerImpl) {}

  reset(): void {
    this.counterUntil = 0;
    this.counterTarget = null;
    this.deflectReadyAt = 0;
    this.lastPressAt = -1e9;
    const a = this.p.actor;
    a.guarding = false;
    a.deflectUntil = 0;
    a.perfectGuardUntil = 0;
  }

  private window(): number {
    return windowScale(this.p.game.settings.get('difficulty'));
  }

  /** the counter prompt for the HUD, or null */
  get hudPrompt(): ContextAction | null {
    return this.p.now <= this.counterUntil && this.counterTarget?.alive ? this.prompt : null;
  }

  /** a guard press: arms Tarrik's perfect window / starts Selene's deflect. Returns true when it took the press. */
  onPress(): boolean {
    const p = this.p;
    const a = p.actor;
    const G = TUNING.guard;
    if (p.kit.guard === 'deflect') {
      if (p.now < this.deflectReadyAt) return false;
      if (p.action === 'attack') p.melee.end();
      this.deflectT = 0;
      this.deflectEnd = G.deflectSeconds;
      a.guarding = true;
      a.guardArc = p.kit.guardArc;
      a.guardStopsHeavy = false;
      a.guardChip = G.deflectChip;
      a.deflectUntil = p.now + G.deflectSeconds;
      a.perfectGuardUntil = p.now + G.perfectWindow * this.window();
      p.visual?.play('deflect');
      p.game.audio.play('verityWhirl', { pos: a.pos, volume: 0.6, pitch: 1.25 });
      p.setState('deflect');
      return true;
    }
    // hold guard: only a fresh press arms the perfect window (no mashing)
    if (p.now - this.lastPressAt >= G.rearm) a.perfectGuardUntil = p.now + G.perfectWindow * this.window();
    this.lastPressAt = p.now;
    if (p.action === 'attack') p.melee.end();
    return true;
  }

  /** Tarrik: hold state, evaluated every free tick */
  updateHold(held: boolean): void {
    const p = this.p;
    const a = p.actor;
    if (p.kit.guard !== 'hold') return;
    if (held && !a.guarding) {
      a.guardArc = p.kit.guardArc;
      a.guardStopsHeavy = true;
      a.guardChip = 0;
    }
    a.guarding = held;
  }

  updateDeflect(dt: number): void {
    const p = this.p;
    this.deflectT += dt;
    p.move.locomotion(dt, 'guard');
    if (p.active && p.buffered === 'dodge' && p.consumeBuffered()) {
      this.endDeflect();
      return;
    }
    if (this.deflectT >= this.deflectEnd) {
      this.endDeflect();
      if (p.action === 'deflect') p.setState('free');
    }
  }

  private endDeflect(): void {
    const p = this.p;
    const a = p.actor;
    a.guarding = false;
    a.deflectUntil = 0;
    a.guardStopsHeavy = true;
    a.guardChip = 0;
    this.deflectReadyAt = p.now + TUNING.guard.deflectCooldown;
  }

  /** leave any guard state (dodge, stagger, death, disable) */
  drop(): void {
    const p = this.p;
    if (p.action === 'deflect') this.endDeflect();
    p.actor.guarding = false;
  }

  // ---- reactions to hits on the player ----------------------------------------------------------------------

  onHit(hit: HitInfo, res: HitResult): void {
    const p = this.p;
    const a = p.actor;
    const G = TUNING.guard;
    const attacker = hit.attacker;
    if (res.perfect) {
      p.game.events.emit('player:guard', { perfect: true, attacker: attacker ?? null });
      p.game.time.slowMo(G.slowMoScale, G.slowMoSeconds);
      if (p.kit.guard === 'hold') {
        p.game.audio.play('guardPerfect', { pos: a.pos });
        p.visual?.play('parry');
        if (hit.kind === 'melee' && attacker && attacker.alive) {
          this.counterUntil = p.now + G.counterWindow * this.window();
          this.counterTarget = attacker;
          p.addEcho(0, 'counter');
        } else p.addEcho(0, 'blocked');
      } else {
        p.game.audio.play('deflect', { pos: a.pos });
        p.addEcho(0, 'deflect');
        if (hit.kind === 'ranged' && attacker && attacker.alive) this.reflect(hit, attacker);
        // a volley arrives bolt by bolt: a successful deflect keeps the stance up a moment longer
        if (p.action === 'deflect') {
          this.deflectEnd = Math.max(this.deflectEnd, this.deflectT + 0.28);
          a.deflectUntil = Math.max(fin(a.deflectUntil), p.now + 0.28);
        }
      }
      return;
    }
    if (res.blocked) {
      p.game.events.emit('player:guard', { perfect: false, attacker: attacker ?? null });
      if (p.kit.guard === 'hold') p.addEcho(0, 'blocked');
      if (res.guardBroken) p.game.input.disengage('guard');
    }
  }

  /** send a deflected projectile back along its path */
  private reflect(hit: HitInfo, shooter: Actor): void {
    const p = this.p;
    const a = p.actor;
    const G = TUNING.guard;
    const from = a.aimPoint(_a);
    const to = shooter.aimPoint(_b);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    p.game.vfx.tracer(from, to, 'cold');
    const back: HitInfo = {
      attacker: a,
      damage: Math.max(0, fin(hit.damage)) * G.reflectScale,
      poise: G.reflectPoise,
      kind: 'ranged',
      element: hit.element ?? 'kinetic',
      dir: { x: dx / l, y: dy / l, z: dz / l },
      point: to.clone(),
      tag: 'deflect',
    };
    const res = p.actors.applyHit(shooter, back);
    p.onDealt(shooter, back, res);
  }

  // ---- counter (Tarrik) -----------------------------------------------------------------------------------

  /** attack pressed while the counter window is open → the riposte */
  tryCounter(): boolean {
    const p = this.p;
    const t = this.counterTarget;
    if (p.kit.guard !== 'hold' || p.now > this.counterUntil || !t || !t.alive) return false;
    const a = p.actor;
    this.counterUntil = 0;
    const info = p.playAction('counter', 0.5, 0.2);
    this.counterT = 0;
    this.counterHit = info.hitTimes[0] as number;
    this.counterDur = info.duration;
    this.counterDone = false;
    a.guarding = false;
    a.iframesUntil = Math.max(a.iframesUntil, p.now + this.counterHit + 0.1);
    a.face(t.pos);
    p.game.audio.play('swingHeavy', { pos: a.pos });
    p.setState('counter');
    return true;
  }

  updateCounter(dt: number): void {
    const p = this.p;
    const a = p.actor;
    const G = TUNING.guard;
    const t = this.counterTarget;
    this.counterT += dt;
    p.move.brake(dt, 60);
    if (!this.counterDone && t && t.alive && dt > 1e-6) {
      // step in so the guaranteed blow visibly connects
      a.face(t.pos);
      const gap = a.distanceTo(t) - t.radius - a.radius - 0.7;
      if (gap > 0) {
        const step = Math.min(gap, 14 * dt);
        a.carryVel.x += (forwardX(a.yaw) * step) / dt;
        a.carryVel.z += (forwardZ(a.yaw) * step) / dt;
      }
    }
    if (!this.counterDone && this.counterT >= this.counterHit) {
      this.counterDone = true;
      if (t && t.alive && a.distanceTo(t) - t.radius <= G.counterRange) {
        const dx = t.pos.x - a.pos.x;
        const dz = t.pos.z - a.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const hit: HitInfo = {
          attacker: a,
          damage: G.counterDamage,
          poise: G.counterPoise,
          kind: 'melee',
          element: 'cinder',
          dir: { x: dx / l, y: 0, z: dz / l },
          point: t.aimPoint(_a).clone(),
          heavy: true,
          unblockable: true,
          knockback: 4.5,
          tag: 'counter',
        };
        const res = p.actors.applyHit(t, hit);
        p.onDealt(t, hit, res);
      }
    }
    if (this.counterT >= this.counterDur || (this.counterDone && this.counterT >= this.counterHit + 0.12 && p.active && p.consumeBuffered())) {
      this.counterTarget = null;
      if (p.action === 'counter') p.setState('free');
    }
  }
}
