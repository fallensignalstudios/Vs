/**
 * Echo: the ability resource. No passive gain — it is paid only by the rules in the brief, one table per
 * protagonist (TUNING.kits[id].echo), and each protagonist keeps their own pool across handoffs.
 */
import * as THREE from 'three';
import type { ProtagonistId } from '@/core/api';
import { clamp } from '@/core/mathx';
import { TUNING, type EchoRule } from '../tuning';
import { fin } from '../safe';
import type { PlayerControllerImpl } from './controller';

const RULES: ReadonlySet<string> = new Set<EchoRule>([
  'blocked', 'counter', 'poiseBreak', 'heavyHit', 'kill', 'weakPoint', 'flank', 'sever', 'deflect', 'device', 'hit',
]);
const _v = new THREE.Vector3();

export class EchoBank {
  private readonly pools: Record<ProtagonistId, number> = { tarrik: 0, selene: 0 };
  private fullPlayed = false;

  constructor(private readonly p: PlayerControllerImpl) {}

  get value(): number {
    return this.pools[this.p.protagonist];
  }

  set(value: number, reason: string): void {
    const p = this.p;
    const v = clamp(fin(value, 0), 0, TUNING.echo.max);
    const delta = v - this.value;
    if (delta === 0) return;
    this.pools[p.protagonist] = v;
    p.game.events.emit('player:echo', { value: v, delta, reason });
    if (delta > 0 && p.isSpawned) {
      if (v >= TUNING.echo.max && !this.fullPlayed) {
        this.fullPlayed = true;
        p.game.audio.play('echoFull');
      } else if (delta >= 4) p.game.audio.play('echoGain', { volume: clamp(delta / 20, 0.4, 1) });
      if (delta >= 10) p.game.vfx.spawn('echoGain', p.actor.aimPoint(_v), { color: p.kit.color, scale: 0.55 });
    }
    if (v < TUNING.echo.max) this.fullPlayed = false;
  }

  /** rule reasons pay from the protagonist's table whatever `amount` says; anything else adds `amount` */
  add(amount: number, reason: string): void {
    let add = fin(amount, 0);
    if (RULES.has(reason)) add = this.p.kit.echo[reason as EchoRule] ?? 0;
    if (add !== 0) this.set(this.value + add, String(reason));
  }
}
