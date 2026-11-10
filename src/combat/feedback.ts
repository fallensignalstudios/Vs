/**
 * Presentation of a resolved hit: flash, hit reaction, impact VFX / SFX chosen from kind / element / target
 * material, hit-stop and camera shake when the protagonist is involved. No game state changes here.
 */
import * as THREE from 'three';
import type { Actor, Game, HitInfo, HitResult } from '@/core/api';
import { clamp, clamp01, forwardX, forwardZ, lerp, wrapAngle } from '@/core/mathx';
import { TUNING } from './tuning';
import { fin } from './safe';

const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _opts: { dir: THREE.Vector3; scale: number; color?: number } = { dir: _normal, scale: 1 };
const _sfx: { pos: THREE.Vector3; volume: number; pitch: number } = { pos: _point, volume: 1, pitch: 1 };
const _react: { dir: number } = { dir: Math.PI };

function sfx(game: Game, id: string, volume = 1, pitch = 1): void {
  _sfx.volume = volume;
  _sfx.pitch = pitch;
  game.audio.play(id, _sfx);
}

function fx(game: Game, id: string, scale = 1, color?: number): void {
  _opts.scale = scale;
  _opts.color = color;
  game.vfx.spawn(id, _point, _opts);
}

/** direction the body is shoved, relative to its facing (PlayOpts.dir convention: 0 forward, +left, π back) */
function shoveDir(target: Actor, hit: HitInfo): number {
  const dx = fin(hit.dir?.x);
  const dz = fin(hit.dir?.z);
  if (dx * dx + dz * dz < 1e-6) return Math.PI;
  return wrapAngle(Math.atan2(-dx, -dz) - target.yaw);
}

export function presentHit(game: Game, target: Actor, hit: HitInfo, res: HitResult, player: Actor | null): void {
  if (res.immune) return;
  const v = target.visual;
  const attacker = hit.attacker;
  const byPlayer = !!player && attacker === player;
  const onPlayer = !!player && target === player;
  const involved = byPlayer || onPlayer;

  // impact point and the normal facing back along the hit
  const p = hit.point;
  if (p && Number.isFinite(p.x + p.y + p.z)) _point.set(p.x, p.y, p.z);
  else target.aimPoint(_point);
  _normal.set(-fin(hit.dir?.x), -fin(hit.dir?.y), -fin(hit.dir?.z));
  if (_normal.lengthSq() < 1e-6) _normal.set(forwardX(target.yaw), 0.2, forwardZ(target.yaw));
  _normal.normalize();
  _react.dir = shoveDir(target, hit);
  const H = TUNING.hit;
  const melee = hit.kind === 'melee';

  if (res.perfect) {
    fx(game, 'deflect', 1);
    v?.flash(H.flashBlock, 0.14);
    if (involved) {
      game.time.hitStop(0.07);
      game.camera.shake(0.22, 0.2);
      game.input.rumble(0.5, 0.8, 110);
    }
    return;
  }

  if (res.blocked) {
    const shield = target.material === 'shield' || target.archetype === 'enforcer';
    fx(game, shield ? 'shieldHit' : 'sparkHit', hit.heavy ? 1.2 : 0.85);
    sfx(game, shield ? (melee ? 'bladeHitShield' : 'shieldHit') : 'guardBlock');
    if (v && !res.guardBroken) v.play('guardHit', _react);
    v?.flash(H.flashBlock, 0.08);
    if (res.guardBroken) {
      fx(game, shield ? 'shieldBreak' : 'sparkHeavy', 1);
      sfx(game, shield ? 'shieldBreak' : 'staggerBreak');
    }
    if (involved) {
      if (melee) game.time.hitStop(res.guardBroken ? 0.09 : 0.035);
      game.camera.shake(res.guardBroken ? 0.5 : hit.heavy ? 0.3 : 0.14, 0.22);
      game.input.rumble(0.4, 0.5, 80);
    }
    return;
  }

  // ---- a clean hit ------------------------------------------------------------------------------------
  if (v) {
    v.flash(onPlayer ? H.flashHurt : res.weakPoint ? H.flashWeak : H.flashHit, res.weakPoint || hit.heavy ? 0.16 : 0.1);
    if (!res.killed && res.applied > 0) v.play(hit.heavy || res.staggered ? 'hitHeavy' : 'hitLight', _react);
  }

  const mat = target.material ?? 'flesh';
  const big = hit.heavy === true || res.staggered || res.killed;
  const el = hit.element ?? 'kinetic';
  const small = hit.kind === 'explosion' || hit.kind === 'ability' ? 0.6 : 1;
  if (el === 'cinder') fx(game, 'cinderBurst', (big ? 1 : 0.6) * small);
  else if (el === 'frost') fx(game, 'frostBurst', (big ? 1 : 0.6) * small);
  else if (el === 'violet') fx(game, 'violetBurst', 0.7 * small);
  else if (mat === 'eclipse') fx(game, 'violetBurst', big ? 0.75 : 0.45);
  else if (mat === 'metal' || el === 'shock') {
    fx(game, big ? 'sparkHeavy' : 'sparkHit', small);
    if (big) fx(game, 'metalChip', 0.8);
  } else fx(game, 'sparkHit', big ? 0.9 : 0.6);
  if (res.froze) {
    target.aimPoint(_point);
    fx(game, 'frostArrest', Math.max(0.7, target.height / 1.8));
    sfx(game, 'frostArrest');
  }

  if (onPlayer) sfx(game, 'playerHit', clamp(0.6 + res.applied / 40, 0.6, 1.3));
  else if (melee) {
    const selene = attacker?.archetype === 'selene';
    sfx(game, selene ? 'verityHit' : mat === 'metal' ? 'bladeHitMetal' : 'bladeHitFlesh', big ? 1.15 : 0.9, mat === 'eclipse' ? 0.82 : 1);
  } else if (byPlayer && res.applied > 0) sfx(game, 'hitConfirm', 0.9);
  if (res.weakPoint && byPlayer) sfx(game, 'weakPointHit');
  if (res.staggered) sfx(game, 'staggerBreak');

  if (!involved) return;
  const weight = clamp01(res.applied / H.hitStopFullAt);
  if (melee || hit.tag === 'counter' || hit.tag === 'dispatch') {
    let stop = lerp(H.hitStopMin, H.hitStopMax, weight);
    if (hit.heavy) stop = Math.max(stop, 0.085);
    if (res.killed) stop += H.hitStopKillBonus;
    game.time.hitStop(Math.min(H.hitStopMax + H.hitStopKillBonus, stop));
  } else if (hit.kind === 'ability' || hit.kind === 'explosion') {
    game.time.hitStop(0.05);
  }
  let shake = clamp(res.applied / H.shakeFullAt, melee ? 0.12 : 0.05, 0.6);
  if (hit.heavy || res.staggered) shake = Math.max(shake, 0.42);
  if (onPlayer) shake = Math.max(shake, 0.3);
  game.camera.shake(shake, 0.18 + shake * 0.35);
  game.input.rumble(clamp01(0.3 + weight), clamp01(0.2 + weight * 0.6), onPlayer ? 160 : 70 + weight * 90);
}
