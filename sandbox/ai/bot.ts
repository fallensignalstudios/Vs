/**
 * A simple scripted virtual-input bot for the AI sandbox: it plays the real protagonist through the real input
 * system (move, guard, attack, aim + fire). Tarrik closes under guard and swings; Selene shoots links first,
 * then weak points / bodies, and uses Verity up close. It is not clever — it exists so encounters can be run
 * headless for N simulated seconds and reported on.
 */
import * as THREE from 'three';
import type { Actor, Game, Vec3Like } from '@/core/api';

const _aim = new THREE.Vector3();
const _mid = new THREE.Vector3();

export class Bot {
  enabled = false;
  /** optional priority target supplied by the scene (a device to break first) */
  objective: (() => Actor | null) | null = null;
  private pathAt = 0;
  private path: Vec3Like[] = [];
  private idx = 0;
  private attackAt = 0;
  private target: Actor | null = null;
  doing = 'idle';

  constructor(private readonly game: Game) {}

  private steer(goal: Vec3Like, stop: number): boolean {
    const g = this.game;
    const p = g.player.actor;
    const now = g.time.now;
    const d = Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z);
    if (d <= stop) {
      g.input.virtual.setMoveWorld(null);
      g.input.virtual.setMove(0, 0);
      return true;
    }
    if (now >= this.pathAt) {
      this.pathAt = now + 0.5;
      const found = g.physics.nav.findPath(p.pos, goal);
      this.path = found ? found.points : [goal];
      this.idx = found ? 1 : 0;
    }
    while (this.idx < this.path.length - 1) {
      const w = this.path[this.idx] as Vec3Like;
      if (Math.hypot(w.x - p.pos.x, w.z - p.pos.z) > 0.6) break;
      this.idx++;
    }
    const w = this.path[Math.min(this.idx, this.path.length - 1)] ?? goal;
    const dx = w.x - p.pos.x;
    const dz = w.z - p.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    g.input.virtual.setMoveWorld({ x: dx / l, z: dz / l });
    return false;
  }

  private pick(): Actor | null {
    const g = this.game;
    const p = g.player.actor;
    const obj = this.objective?.();
    if (obj && obj.alive && obj.targetable) return obj;
    if (this.target && this.target.alive && this.target.targetable && g.time.now < this.pathAt + 2) return this.target;
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const h of g.actors.hostilesOf(p)) {
      if (h.tags.has('device')) continue;
      const d = p.distanceTo(h) + (h.flying && g.player.protagonist === 'tarrik' ? 4 : 0);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  update(_dt: number): void {
    if (!this.enabled) return;
    const g = this.game;
    const v = g.input.virtual;
    const player = g.player;
    const p = player.actor;
    if (!p.alive || !player.enabled) {
      v.setMoveWorld(null);
      return;
    }
    v.active = true;
    const now = g.time.now;
    const selene = player.protagonist === 'selene';

    // Selene: a visible link in reach is always the first answer
    if (selene) {
      for (const link of g.ai.links.all) {
        if (!link.alive) continue;
        link.midpoint(_mid);
        if (Math.hypot(_mid.x - p.pos.x, _mid.z - p.pos.z) > 34) continue;
        if (!g.physics.lineOfFire(p.aimPoint(_aim), _mid)) continue;
        this.doing = 'sever';
        v.setMoveWorld(null);
        v.hold('guard', false);
        v.hold('aim', true);
        player.aimAt(_mid);
        if (now >= this.attackAt) {
          this.attackAt = now + 0.55;
          v.press('attack');
        }
        return;
      }
    }

    const t = (this.target = this.pick());
    if (!t) {
      this.doing = 'idle';
      v.setMoveWorld(null);
      v.hold('aim', false);
      v.hold('guard', false);
      return;
    }
    const dist = p.distanceTo(t);
    const aim = g.actors.weakPointPosition(t, _aim) ?? t.aimPoint(_aim);
    if (selene && dist > 4.5) {
      // keep a firing distance, shoot when the line is clear
      const clear = g.physics.lineOfFire(p.aimPoint(_mid), aim);
      this.doing = clear ? 'shoot' : 'reposition';
      if (!clear || dist > 24) {
        v.hold('aim', false);
        this.steer(t.pos, 10);
      } else {
        v.setMoveWorld(null);
        v.hold('aim', true);
        player.aimAt(aim);
        if (now >= this.attackAt) {
          this.attackAt = now + 0.6;
          v.press('attack');
        }
      }
      return;
    }
    v.hold('aim', false);
    // melee: walk in under guard, drop it to swing
    const reach = (selene ? 2.0 : 2.4) + t.radius;
    const arrived = this.steer(t.pos, reach);
    player.aimAt(aim);
    if (!arrived) {
      this.doing = 'close';
      v.hold('guard', !selene && dist > reach + 1.5);
      return;
    }
    this.doing = 'melee';
    v.hold('guard', false);
    if (now >= this.attackAt) {
      this.attackAt = now + (selene ? 0.36 : 0.62);
      v.press(now % 5 < 1 ? 'heavy' : 'attack');
    }
  }

  stop(): void {
    this.enabled = false;
    this.game.input.virtual.clear();
  }
}
