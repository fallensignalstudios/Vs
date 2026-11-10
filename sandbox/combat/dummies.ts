/**
 * Training dummies: plain Actors with tiny local controllers, so every player mechanic has something to hit
 * and be hit by. One passive body, one that swings every 2 s, one drone that fires volleys, one shield-bearer.
 */
import * as THREE from 'three';
import type { Actor, ActorController, Game } from '@/core/api';
import { DEG, forwardX, forwardZ } from '@/core/mathx';

export interface Dummies {
  passive: Actor;
  swinger: Actor;
  shooter: Actor;
  shield: Actor;
  /** let the swinger / shooter act on their own timers */
  auto: boolean;
  /** make the swinger attack now; returns seconds until its blow lands */
  swing(): number;
  /** make the drone fire one bolt now; returns seconds until it arrives */
  shoot(): number;
  all(): Actor[];
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export function spawnDummies(game: Game): Dummies {
  const actors = game.actors;
  const player = () => game.player.actor;
  const d = { auto: true } as Dummies;

  d.passive = actors.spawn({
    archetype: 'linkbound', name: 'Passive', team: 'eclipse', pos: { x: -3, y: 0, z: 0 }, yaw: Math.PI, hp: 400, poise: 0,
    visual: game.chars.create('linkbound', { seed: 3 }), corpseSeconds: Infinity, dissolveOnDeath: false,
    weakPoints: [{ id: 'core', socket: 'chest', radius: 0.22, multiplier: 2, exposed: false }],
  });

  // ---- swinger: telegraph 0.5 s, lunge, hit if the player is still in front ---------------------------------
  let swingTimer = 2;
  let pending = -1;
  let hitIn = -1;
  const TELEGRAPH = 0.5;
  const swingCtl: ActorController = {
    update(a, dt) {
      if (a.staggered || a.frozen) {
        pending = hitIn = -1;
        a.visual?.setTelegraph(0);
        return;
      }
      const p = player();
      if (pending < 0 && hitIn < 0) a.face(p.pos, 3 * dt);
      if (d.auto && pending < 0 && hitIn < 0) {
        swingTimer -= dt;
        if (swingTimer <= 0 && a.distanceTo(p) < 3.2) d.swing();
      }
      if (pending >= 0) {
        pending -= dt;
        a.visual?.setTelegraph(1 - Math.max(0, pending) / TELEGRAPH, 0xff5a2a);
        if (pending < 0) {
          const info = a.visual?.play('lunge');
          hitIn = typeof info?.hitTimes?.[0] === 'number' ? info.hitTimes[0] : 0.28;
          a.visual?.setTelegraph(0);
        }
      } else if (hitIn >= 0) {
        hitIn -= dt;
        if (hitIn < 0) {
          const dx = p.pos.x - a.pos.x;
          const dz = p.pos.z - a.pos.z;
          const dist = Math.hypot(dx, dz) || 1;
          const facing = (dx * forwardX(a.yaw) + dz * forwardZ(a.yaw)) / dist;
          if (dist < 2.9 && facing > Math.cos(55 * DEG)) {
            actors.applyHit(p, {
              attacker: a, damage: 16, poise: 14, kind: 'melee', dir: { x: dx / dist, y: 0, z: dz / dist },
              point: p.aimPoint(_a).clone(), knockback: 2,
            });
          }
        }
      }
    },
  };
  d.swinger = actors.spawn({
    archetype: 'linkbound', name: 'Swinger', team: 'eclipse', pos: { x: 3, y: 0, z: 0 }, yaw: Math.PI, hp: 300, poise: 30,
    visual: game.chars.create('linkbound', { seed: 9 }), controller: swingCtl, corpseSeconds: Infinity, dissolveOnDeath: false,
  });
  d.swing = () => {
    swingTimer = 2;
    pending = TELEGRAPH;
    const info = d.swinger.visual?.info('lunge');
    return TELEGRAPH + (typeof info?.hitTimes?.[0] === 'number' ? info.hitTimes[0] : 0.28);
  };

  // ---- shooter: a hovering drone that fires a bolt (travel time 40 m/s) -------------------------------------
  let shootTimer = 2.6;
  const bolts: Array<{ left: number; dir: THREE.Vector3 }> = [];
  const shootCtl: ActorController = {
    update(a, dt) {
      const p = player();
      if (!a.frozen && !a.staggered) a.face(p.pos, 4 * dt);
      if (d.auto && !a.frozen && !a.staggered) {
        shootTimer -= dt;
        if (shootTimer <= 0) {
          shootTimer = 2.6;
          d.shoot();
        }
      }
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i]!;
        b.left -= dt;
        if (b.left > 0) continue;
        bolts.splice(i, 1);
        if (!p.alive || !a.alive) continue;
        a.aimPoint(_a);
        p.aimPoint(_b);
        if (!game.physics.lineOfFire(_a, _b)) continue;
        actors.applyHit(p, { attacker: a, damage: 9, poise: 4, kind: 'ranged', element: 'shock', dir: b.dir, point: _b.clone() });
      }
    },
  };
  d.shooter = actors.spawn({
    archetype: 'secDrone', name: 'Drone', team: 'eclipse', pos: { x: 8, y: 0, z: -8 }, yaw: Math.PI, hp: 60, poise: 20,
    radius: 0.45, height: 0.7, flying: true, hoverHeight: 1.8, visual: game.chars.create('secDrone'), controller: shootCtl,
    corpseSeconds: Infinity, weakPoints: [{ id: 'vent', socket: 'vent', radius: 0.22, multiplier: 2, exposed: true }],
  });
  d.shoot = () => {
    const a = d.shooter;
    const p = player();
    if (!a.alive) return 0;
    const from = a.visual ? a.visual.socket('muzzle').getWorldPosition(_a) : a.aimPoint(_a);
    const to = p.aimPoint(_b);
    const dist = from.distanceTo(to);
    const dir = to.clone().sub(from).normalize();
    game.vfx.tracer(from, to, 'drone');
    a.visual?.play('shoot');
    bolts.push({ left: dist / 40, dir });
    return dist / 40;
  };

  // ---- shield-bearer: frontal 140° shield, heavies and flanks get through -----------------------------------
  const shieldCtl: ActorController = {
    update(a, dt) {
      if (a.staggered || a.frozen) return;
      a.guarding = true;
      a.face(player().pos, 1.1 * dt);
    },
  };
  d.shield = actors.spawn({
    archetype: 'enforcer', name: 'Enforcer', team: 'dominion', pos: { x: -8, y: 0, z: -6 }, yaw: Math.PI, hp: 160, poise: 80,
    visual: game.chars.create('enforcer'), controller: shieldCtl, guardArc: 140 * DEG, corpseSeconds: Infinity,
  });
  d.shield.guardStopsHeavy = false;
  d.shield.flankMultiplier = 1.5;
  d.shield.visual?.setLoadout({ shield: true, melee: true });
  actors.setHostile('player', 'dominion', true);

  d.all = () => [d.passive, d.swinger, d.shooter, d.shield];
  return d;
}
