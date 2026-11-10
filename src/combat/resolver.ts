/**
 * THE damage resolver (ActorManager.applyHit). One place decides immunity, guard, weak points, scaling, poise,
 * freeze, knockback and death; feedback.ts presents the outcome. Order and rules: src/core/api/combat.ts.
 */
import type { Actor, HitInfo, HitResult } from '@/core/api';
import { clamp01 } from '@/core/mathx';
import type { ActorImpl } from './actor';
import type { ActorManagerImpl } from './manager';
import { presentHit } from './feedback';
import { TUNING, damageTakenScale } from './tuning';
import { fin, live, warnOnce } from './safe';

function emptyResult(): HitResult {
  return {
    applied: 0, blocked: false, perfect: false, staggered: false, killed: false, immune: false, weakPoint: false,
    resisted: false, flanked: false, guardBroken: false, froze: false,
  };
}

function finish(m: ActorManagerImpl, target: ActorImpl, hit: HitInfo, res: HitResult, player: Actor | null): HitResult {
  if (!hit.silent) {
    try {
      presentHit(m.game, target, hit, res, player);
    } catch (err) {
      warnOnce('present', `hit presentation threw: ${String(err)}`);
    }
  }
  const c = target.controller;
  if (c && typeof c.onHit === 'function' && !res.immune) {
    try {
      c.onHit(target, hit, res);
    } catch (err) {
      warnOnce(`onhit:${target.name}`, `controller.onHit of "${target.name}" threw: ${String(err)}`);
    }
  }
  m.game.events.emit('actor:hit', { target, hit, result: res });
  return res;
}

export function applyHitImpl(m: ActorManagerImpl, target: ActorImpl, hit: HitInfo): HitResult {
  const res = emptyResult();
  if (!target || !hit || target._removed || !target.alive) {
    res.immune = true;
    return res;
  }
  const now = m.now;
  const player = m.playerActor();
  const attacker = live(hit.attacker) ? hit.attacker : null;

  if (!target.targetable || target.invulnerable || target.protectedNpc || now < target.iframesUntil) {
    res.immune = true;
    return finish(m, target, hit, res, player);
  }

  let damage = Math.max(0, fin(hit.damage));
  let poise = Math.max(0, fin(hit.poise));
  const off = m.offAngle(target, hit.dir, attacker);

  // ---- guard ------------------------------------------------------------------------------------------
  const canGuard = target.guarding && !hit.unblockable && !target.frozen && !target.staggered;
  if (canGuard && off >= 0 && off <= target.guardArc * 0.5 + 1e-6) {
    const perfect = now < target.perfectGuardUntil || (hit.kind === 'ranged' && now < fin(target.deflectUntil));
    if (perfect) {
      res.blocked = true;
      res.perfect = true;
      if (attacker && hit.kind === 'melee') m.staggerWith(attacker as ActorImpl, TUNING.actor.perfectGuardStagger, target, 'stagger');
      return finish(m, target, hit, res, player);
    }
    if (!(hit.heavy && target.guardStopsHeavy === false)) {
      res.blocked = true;
      damage *= clamp01(fin(target.guardChip));
      poise *= TUNING.hit.guardPoiseScale;
    }
  }

  // ---- weak point / flank / state scaling ---------------------------------------------------------------
  if (!res.blocked) {
    const wp = hit.ignoreWeakPoints
      ? null
      : hit.weakPoint ? m.exposedWeakPoint(target) ?? target.weakPoints[0] ?? null : m.weakPointAt(target, hit.point);
    if (!hit.ignoreWeakPoints && (hit.weakPoint || wp)) {
      res.weakPoint = true;
      hit.weakPoint = true;
      damage *= Math.max(wp ? fin(wp.multiplier, 1) : TUNING.hit.defaultWeakPoint, fin(hit.weakPointScale));
    }
    if (off > TUNING.hit.flankAngle) {
      res.flanked = true;
      damage *= Math.max(0, fin(target.flankMultiplier, 1));
    }
    if (target.frozen) damage *= TUNING.hit.frozenDamageScale;
  }
  const dts = fin(target.damageTakenScale, 1);
  if (dts !== 1) {
    if (dts < 1 && damage > 0) res.resisted = true;
    damage *= Math.max(0, dts);
  }
  poise *= Math.max(0, fin(target.poiseTakenScale, 1));
  if (now < fin(target.superArmorUntil)) poise = 0;
  if (target === player) {
    damage *= damageTakenScale(m.game.settings?.get?.('difficulty'));
    if (m.playerGodMode()) {
      damage = 0;
      poise = 0;
    }
  }

  // ---- apply ------------------------------------------------------------------------------------------
  const applied = Math.min(target.hp, damage);
  target.hp -= applied;
  res.applied = applied;
  if (applied > 0 || poise > 0) target.lastHitAt = now;

  if (fin(hit.freeze) > 0 && !res.blocked) res.froze = m.freezeFor(target, fin(hit.freeze)) > 0;

  const kb = fin(hit.knockback);
  if (kb > 0 && !target.fixed && !target.frozen) {
    const dx = fin(hit.dir?.x);
    const dz = fin(hit.dir?.z);
    const l = Math.hypot(dx, dz);
    if (l > 1e-4) {
      const k = (kb * (res.blocked ? 0.35 : 1)) / l;
      target.impulse.x += dx * k;
      target.impulse.z += dz * k;
    }
  }

  if (target.hp <= 0) {
    res.killed = true;
    m.kill(target, attacker);
  } else if (poise > 0 && target.maxPoise > 0) {
    target.poise -= poise;
    target._poiseHitAt = now;
    if (target.poise <= 0) {
      res.staggered = true;
      res.guardBroken = res.blocked;
      target.poise = target.maxPoise;
      m.staggerWith(
        target,
        res.guardBroken ? TUNING.actor.guardBreakSeconds : TUNING.actor.staggerSeconds,
        attacker,
        res.guardBroken ? 'guardBreak' : 'stagger',
      );
    }
  }
  return finish(m, target, hit, res, player);
}
