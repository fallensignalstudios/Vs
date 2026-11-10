/**
 * The actor tick (ActorManager.update): controllers → separation → movement through physics → regeneration and
 * poise recovery → visual pose → death / dissolve timers. Allocation-free.
 */
import * as THREE from 'three';
import type { ActorLocoFlags, MoveOpts } from '@/core/api';
import { wrapAngle } from '@/core/mathx';
import type { ActorImpl } from './actor';
import type { ActorManagerImpl } from './manager';
import { TUNING } from './tuning';
import { warnOnce } from './safe';

const _from = { x: 0, y: 0, z: 0 };
const _opts: MoveOpts = {};
const _ground = { y: 0, surface: null as never };
const _loco: ActorLocoFlags = {};
const _chest = new THREE.Vector3();

/** can this body be shoved by separation? */
function movable(a: ActorImpl): boolean {
  return !a.fixed && !a.protectedNpc && !a.frozen;
}

/** soft circle–circle separation: accumulate this tick's push (metres) per actor */
function separate(list: ActorImpl[], n: number, dt: number): void {
  const A = TUNING.actor;
  const maxPush = A.separationMaxPush * dt;
  const rate = Math.min(1, A.separationRate * dt);
  for (let i = 0; i < n; i++) {
    const a = list[i] as ActorImpl;
    if (!a.alive || a._removed) continue;
    for (let j = i + 1; j < n; j++) {
      const b = list[j] as ActorImpl;
      if (!b.alive || b._removed || a.flying !== b.flying) continue;
      const min = a.radius + b.radius;
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      // bodies on different levels (balcony over floor) do not touch
      const la = a.bottom;
      const lb = b.bottom;
      if (la > lb + b.height || lb > la + a.height) continue;
      const ma = movable(a);
      const mb = movable(b);
      if (!ma && !mb) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) {
        // exactly stacked: pick a stable direction from the ids
        const ang = (a.id * 2.399963 + b.id) % 6.2831853;
        dx = Math.cos(ang);
        dz = Math.sin(ang);
        d = 1;
      }
      const push = Math.min((min - d) * rate, maxPush);
      // heavier (wider) bodies give way less
      const wa = ma ? 1 / (a.radius * a.radius) : 0;
      const wb = mb ? 1 / (b.radius * b.radius) : 0;
      const sa = (push * wa) / (wa + wb) / d;
      const sb = (push * wb) / (wa + wb) / d;
      a._pushX -= dx * sa;
      a._pushZ -= dz * sa;
      b._pushX += dx * sb;
      b._pushZ += dz * sb;
    }
  }
}

function integrate(m: ActorManagerImpl, a: ActorImpl, dt: number, now: number): void {
  const A = TUNING.actor;
  const ox = a.pos.x;
  const oy = a.pos.y;
  const oz = a.pos.z;
  const dx = (a.desiredVel.x + a.carryVel.x + a.impulse.x) * dt + a._pushX;
  const dz = (a.desiredVel.z + a.carryVel.z + a.impulse.z) * dt + a._pushZ;
  a._pushX = 0;
  a._pushZ = 0;
  const physics = m.physics;
  if (!physics) {
    a.pos.x += dx;
    a.pos.z += dz;
  } else if (a.flying) {
    _from.x = ox;
    _from.y = a.bottom;
    _from.z = oz;
    _opts.flying = true;
    _opts.height = a.height;
    _opts.out = a._move;
    const r = physics.moveCharacter(_from, a.radius, dx, dz, _opts);
    if (r && Number.isFinite(r.x) && Number.isFinite(r.z)) {
      a.pos.x = r.x;
      a.pos.z = r.z;
    }
    const g = physics.groundAt(a.pos.x, a.pos.z, a.pos.y, 0.45, _ground);
    if (g && Number.isFinite(g.y)) a._groundY = g.y;
    const want = a._groundY + a.hoverHeight;
    a.pos.y += (want - a.pos.y) * (1 - Math.exp(-A.hoverFollow * dt));
  } else {
    _opts.flying = false;
    _opts.height = a.height;
    _opts.out = a._move;
    const r = physics.moveCharacter(a.pos, a.radius, dx, dz, _opts);
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z)) {
      a.pos.set(r.x, r.y, r.z);
      if (r.reason === 'lost' && now >= a._unstickAt) {
        // nothing standable within physics' own 4 m search: look further, occasionally
        a._unstickAt = now + A.unstickInterval;
        const p = physics.nearestStandable(a.pos.x, a.pos.y, a.pos.z, a.radius, 16, a.height);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) a.pos.set(p.x, p.y, p.z);
      }
      if (r.blocked && r.normal) {
        // knockback does not keep pressing into the wall that stopped it
        const into = a.impulse.x * r.normal.x + a.impulse.z * r.normal.z;
        if (into < 0) {
          a.impulse.x -= into * r.normal.x;
          a.impulse.z -= into * r.normal.z;
        }
      }
    }
  }
  if (dt > 1e-6) a.vel.set((a.pos.x - ox) / dt, (a.pos.y - oy) / dt, (a.pos.z - oz) / dt);
  const k = Math.exp(-A.impulseDecay * dt);
  a.impulse.x *= k;
  a.impulse.z *= k;
  a.impulse.y = 0;
  if (a.impulse.x * a.impulse.x + a.impulse.z * a.impulse.z < 0.01) a.impulse.set(0, 0, 0);
}

function pose(a: ActorImpl, dt: number, moving: boolean): void {
  const v = a.visual;
  if (!v) return;
  const A = TUNING.actor;
  let y = a.pos.y;
  if (a.flying) {
    a._bob += dt * A.hoverBobRate;
    y += a.alive ? Math.sin(a._bob + a.id * 1.7) * A.hoverBob : 0;
    a._visualY = a.pos.y;
  } else {
    // steps and kerbs arrive in one physics call: ease the drawn height instead
    const diff = a.pos.y - a._visualY;
    a._visualY = Math.abs(diff) > 1 ? a.pos.y : a._visualY + diff * (1 - Math.exp(-18 * dt));
    y = a._visualY;
  }
  v.root.position.set(a.pos.x, y, a.pos.z);
  v.root.rotation.y = a.yaw;
  if (moving) {
    const sx = a.desiredVel.x;
    const sz = a.desiredVel.z;
    const speed = Math.hypot(sx, sz);
    const f = a.loco;
    _loco.sprint = f.sprint === true;
    _loco.aiming = f.aiming === true;
    _loco.guarding = f.guarding ?? a.guarding;
    _loco.injured = f.injured === true;
    v.setLocomotion(speed, speed > 0.05 ? wrapAngle(Math.atan2(-sx, -sz) - a.yaw) : 0, _loco);
  }
  v.update(dt);
}

export function updateActors(m: ActorManagerImpl, dt: number): void {
  const list = m.list;
  const n = list.length;
  const now = m.now;
  const A = TUNING.actor;
  m.updating = true;

  // 1. brains (always called for the living; a frozen / staggered body is stopped afterwards)
  for (let i = 0; i < n; i++) {
    const a = list[i] as ActorImpl;
    if (a._removed || !a.alive) continue;
    if (a._wasFrozen && now >= a.frozenUntil) {
      a._wasFrozen = false;
      a.visual?.setFrozen(0);
    }
    const c = a.controller;
    if (c) {
      try {
        c.update(a, dt);
      } catch (err) {
        if (!a._warned) {
          a._warned = true;
          warnOnce(`controller:${a.id}`, `controller of "${a.name}" threw in update: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        }
      }
    }
    if (now < a.frozenUntil) {
      a.desiredVel.set(0, 0, 0);
      a.carryVel.set(0, 0, 0);
      a.impulse.set(0, 0, 0);
    } else if (now < a.staggeredUntil) {
      a.desiredVel.set(0, 0, 0);
      a.carryVel.set(0, 0, 0);
    }
  }

  // 2. bodies push each other apart (softly); the push goes through physics with the rest of the motion
  separate(list, n, dt);

  // 3. move, recover, pose
  for (let i = 0; i < n; i++) {
    const a = list[i] as ActorImpl;
    if (a._removed) continue;
    if (!a.alive) {
      // dead: dissolve and removal timers
      if (now >= a._dissolveFrom) {
        if (!a._dissolveFx) {
          a._dissolveFx = true;
          if (a._dissolveColor !== undefined) {
            a.aimPoint(_chest);
            m.game.vfx.spawn('eclipseDissolve', _chest);
          }
        }
        a.visual?.setDissolve(Math.min(1, (now - a._dissolveFrom) / Math.max(0.05, a._dissolveSeconds)), a._dissolveColor);
      }
      a._pushX = a._pushZ = 0;
      pose(a, dt, false);
      if (now >= a._removeAt) m.remove(a);
      continue;
    }
    if (a.fixed) {
      a._pushX = a._pushZ = 0;
      a.vel.set(0, 0, 0);
      a._visualY = a.pos.y;
    } else {
      integrate(m, a, dt, now);
    }
    if (a.regen > 0 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.regen * dt);
    if (a.maxPoise > 0 && a.poise < a.maxPoise && now - a._poiseHitAt >= A.poiseRecoverDelay) {
      a.poise = Math.min(a.maxPoise, a.poise + a.maxPoise * A.poiseRecoverRate * dt);
    }
    pose(a, dt, true);
    a.desiredVel.set(0, 0, 0);
    a.carryVel.set(0, 0, 0);
  }

  m.updating = false;
  m.compact();
}
