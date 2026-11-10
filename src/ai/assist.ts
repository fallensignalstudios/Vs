/**
 * Scripted companion assists (`Companion.assist`): each is a short wind-up → effect sequence the zone script
 * triggers at an authored moment.
 *   frostArrest   Selene: frost tether to the target, then it is frozen 3 s (the elite: its joint is arrested)
 *   rifleShot     Lyessa: one aimed rifle round (weak point if one is open)
 *   suppress      Lyessa: 2.4 s of suppressing fire — pressure, hardly any damage
 *   cinderStrike  Tarrik: closes and lands a heavy Cinder blow
 */
import * as THREE from 'three';
import type { Actor, BeamHandle } from '@/core/api';
import type { CompanionImpl } from './companion';
import type { AiCore } from './core';
import { EliteBrain } from './roles/elite';
import type { NavFollower } from './steer';
import { AI } from './tune';
import { carry, fin, physicsOf, socketObject, socketPos, warnOnce } from './util';

export type AssistKind = 'frostArrest' | 'rifleShot' | 'cinderStrike' | 'suppress';

const KINDS: ReadonlySet<string> = new Set(['frostArrest', 'rifleShot', 'cinderStrike', 'suppress']);
const FREEZE_SECONDS = 3;
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Assist {
  private kind: AssistKind | null = null;
  private target: Actor | null = null;
  private t = 0;
  /** the effect has landed (the rest is follow-through) */
  private done = false;
  private beam: BeamHandle | null = null;
  private shots = 0;
  private striking = false;
  private hitAt = 0;
  private endAt = 0;

  constructor(private readonly core: AiCore, private readonly owner: CompanionImpl) {}

  /** a sequence is running (wind-up or follow-through) */
  get active(): boolean {
    return this.kind !== null;
  }
  /** the effect has not landed yet */
  get pending(): boolean {
    return this.kind !== null && !this.done;
  }

  start(target: Actor, kind: AssistKind): void {
    if (!KINDS.has(String(kind))) {
      warnOnce(`assist:${String(kind)}`, `companion.assist("${String(kind)}") is not a known assist — ignored`);
      return;
    }
    this.cancel();
    this.kind = kind;
    this.target = target;
    this.t = 0;
    this.done = false;
    this.shots = 0;
    this.striking = false;
    const a = this.owner.actor;
    const game = this.core.game;
    const v = a.visual;
    if (kind === 'frostArrest') {
      v?.play('tetherStop', { loop: true });
      const hand = socketObject(a, 'handL');
      // aim the tether at the open weak point when there is one (the elite's joint), else at the body
      const joint = String(target.archetype) === 'elite' ? socketObject(target, 'joint') : null;
      const to = joint ?? socketObject(target, 'core');
      this.beam = game.vfx.beam(hand ?? a.aimPoint(_from).clone(), to ?? target.aimPoint(_to).clone(), 'tether');
      this.beam.setIntensity(0.35);
      game.audio.play('frostArrest', { pos: a.pos });
    } else if (kind === 'rifleShot' || kind === 'suppress') {
      v?.setLoadout({ ranged: true });
      v?.play('aimRifle', { loop: true });
    }
  }

  /** stagger / freeze / downed: the assist is lost */
  interrupted(): void {
    if (this.kind) this.cancel();
  }

  cancel(): void {
    const a = this.owner.actor;
    this.beam?.remove(0.15);
    this.beam = null;
    if (this.kind && a) {
      const v = a.visual;
      if (this.kind === 'frostArrest') v?.stop('tetherStop');
      if (this.kind === 'rifleShot' || this.kind === 'suppress') {
        v?.stop('aimRifle');
        v?.setLoadout(this.owner.kit.loadout);
      }
    }
    this.kind = null;
    this.target = null;
    this.done = false;
  }

  update(a: Actor, dt: number, nav: NavFollower): void {
    const t = this.target;
    const game = this.core.game;
    if (!t || !t.alive) {
      this.cancel();
      return;
    }
    this.t += dt;
    switch (this.kind) {
      case 'frostArrest': {
        nav.halt(a);
        a.face(t.pos, 9 * dt);
        if (!this.done) {
          this.beam?.setIntensity(Math.min(1, 0.35 + this.t * 1.4));
          if (this.t >= 0.45) {
            this.done = true;
            const brain = this.core.brainOf(t);
            if (brain instanceof EliteBrain) {
              brain.arrest(FREEZE_SECONDS);
              game.vfx.spawn('frostArrest', socketPos(t, 'joint', _to));
            } else {
              game.actors.freeze(t, FREEZE_SECONDS);
              game.vfx.spawn('frostArrest', t.aimPoint(_to));
            }
            this.beam?.setIntensity(1);
          }
        } else if (this.t >= 1.5) this.cancel();
        break;
      }
      case 'rifleShot': {
        nav.halt(a);
        a.face(t.pos, 9 * dt);
        if (!this.done && this.t >= 0.4) {
          this.done = true;
          this.shoot(a, t, 30, 30, true);
        } else if (this.done && this.t >= 0.9) this.cancel();
        break;
      }
      case 'suppress': {
        nav.halt(a);
        a.face(t.pos, 9 * dt);
        if (this.t >= 0.35 + this.shots * 0.4 && this.shots < 6) {
          this.shots++;
          this.shoot(a, t, 4, 10, false);
          if (this.shots >= 6) this.done = true;
        }
        if (this.t >= 3) this.cancel();
        break;
      }
      case 'cinderStrike': {
        const reach = 2.7 + t.radius;
        const dist = a.distanceTo(t);
        if (!this.striking) {
          if (dist > reach && this.t < 3) {
            // close the distance first; a last short burst of speed if the walk was not enough
            nav.moveTo(a, t.pos, AI.companion.run * 1.25, dt, { stop: reach - 0.4 });
            break;
          }
          this.striking = true;
          this.t = 0;
          a.face(t.pos);
          const info = a.visual?.play('attackHeavy');
          this.hitAt = Math.max(0.15, fin(info?.hitTimes?.[0], 0.58));
          this.endAt = Math.max(this.hitAt + 0.2, fin(info?.duration, 1.05));
          game.audio.play('cinderIgnite', { pos: a.pos });
          break;
        }
        nav.halt(a);
        if (!this.done) {
          if (dist > reach) {
            carry(a, ((t.pos.x - a.pos.x) / dist) * 9, ((t.pos.z - a.pos.z) / dist) * 9);
          }
          if (this.t >= this.hitAt) {
            this.done = true;
            const p = game.actors.weakPointPosition(t, _to) ?? t.aimPoint(_to);
            game.vfx.spawn('cinderBurst', p);
            game.audio.play('cinderSlam', { pos: p });
            game.camera.shake(0.5, 0.3);
            const dx = t.pos.x - a.pos.x;
            const dz = t.pos.z - a.pos.z;
            const l = Math.hypot(dx, dz) || 1;
            game.actors.applyHit(t, {
              attacker: a, damage: 45, poise: 60, kind: 'melee', element: 'cinder', heavy: true,
              dir: { x: dx / l, y: 0, z: dz / l }, point: { x: p.x, y: p.y, z: p.z }, knockback: 3, tag: 'cinderStrike',
            });
          }
        } else if (this.t >= this.endAt) this.cancel();
        break;
      }
      default:
        this.cancel();
    }
  }

  /** one rifle round: effectively instant (a scripted shot must land), stopped by solids */
  private shoot(a: Actor, t: Actor, damage: number, poise: number, aimed: boolean): void {
    const game = this.core.game;
    socketPos(a, 'muzzle', _from);
    const wp = aimed ? game.actors.weakPointPosition(t, _to) : null;
    if (!wp) t.aimPoint(_to);
    _dir.copy(_to).sub(_from);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    game.vfx.spawn('muzzleWarm', _from, { dir: _dir });
    game.audio.play('cinderlineShot', { pos: a.pos, pitch: 1.15 });
    a.visual?.play('shoot');
    const physics = physicsOf(game);
    const clear = !physics || physics.lineOfFire(_from, _to);
    if (!clear) return;
    game.vfx.tracer(_from, _to, 'rifle');
    game.actors.applyHit(t, {
      attacker: a, damage, poise, kind: 'ranged', element: 'kinetic', weakPoint: wp ? true : undefined,
      dir: { x: _dir.x, y: _dir.y, z: _dir.z }, point: { x: _to.x, y: _to.y, z: _to.z }, tag: aimed ? 'rifleFinish' : 'suppress',
    });
  }
}
