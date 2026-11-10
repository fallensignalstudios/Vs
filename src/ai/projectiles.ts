/**
 * Enemy / companion projectiles with real travel time, so guard, deflect, dodge and cover all matter.
 * A bolt is committed when fired: it flies straight, is stopped by solids (clipped at launch) and strikes the
 * first living actor hostile to its owner that its path crosses — one `applyHit` per bolt, `kind: 'ranged'`.
 */
import * as THREE from 'three';
import type { Actor, Element, Game, Vec3Like } from '@/core/api';
import { RAY_SHOT } from '@/core/api';
import { fin, live, physicsOf } from './util';

export interface BoltDesc {
  owner: Actor;
  from: Vec3Like;
  /** need not be unit */
  dir: Vec3Like;
  speed: number;
  range: number;
  damage: number;
  poise?: number;
  element?: Element;
  style: 'drone' | 'violet' | 'warm' | 'cold' | 'rifle';
  knockback?: number;
  tag?: string;
  /** only this actor can be struck (scripted assists); default: anything hostile to the owner */
  only?: Actor | null;
  /** counts as a weak-point hit wherever it lands (scripted finishing shots) */
  weakPoint?: boolean;
}

interface Bolt {
  owner: Actor;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  left: number;
  damage: number;
  poise: number;
  element: Element | undefined;
  knockback: number;
  tag: string | undefined;
  only: Actor | null;
  weakPoint: boolean;
  style: BoltDesc['style'];
  /** the bolt ends on a solid (impact effect there) rather than running out of range */
  wall: boolean;
}

const _hit = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 0, collider: null, ground: false };
const _end = new THREE.Vector3();
const _dir = { x: 0, y: 0, z: 0 };

export class Projectiles {
  private readonly bolts: Bolt[] = [];
  private readonly pool: Bolt[] = [];
  /** bolts fired since the last clear */
  fired = 0;

  constructor(private readonly game: Game) {}

  get count(): number {
    return this.bolts.length;
  }

  fire(d: BoltDesc): void {
    const dx = fin(d.dir.x);
    const dy = fin(d.dir.y);
    const dz = fin(d.dir.z);
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6 || !live(d.owner)) return;
    const b = this.pool.pop() ?? {
      owner: d.owner, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 40, left: 0, damage: 0, poise: 0,
      element: undefined, knockback: 0, tag: undefined, only: null, weakPoint: false, style: 'drone' as const, wall: false,
    };
    b.owner = d.owner;
    b.pos.set(fin(d.from.x), fin(d.from.y), fin(d.from.z));
    b.dir.set(dx / len, dy / len, dz / len);
    b.speed = Math.max(1, fin(d.speed, 40));
    b.left = Math.max(0.1, fin(d.range, 40));
    b.damage = Math.max(0, fin(d.damage));
    b.poise = Math.max(0, fin(d.poise));
    b.element = d.element;
    b.knockback = fin(d.knockback);
    b.tag = d.tag;
    b.only = d.only ?? null;
    b.weakPoint = d.weakPoint === true;
    b.style = d.style;
    b.wall = false;
    const physics = physicsOf(this.game);
    if (physics) {
      const h = physics.raycast(b.pos, b.dir, b.left, RAY_SHOT, _hit);
      if (h && Number.isFinite(h.distance)) {
        b.left = Math.max(0.05, h.distance);
        b.wall = true;
      }
    }
    _end.copy(b.pos).addScaledVector(b.dir, b.left);
    this.game.vfx.tracer(b.pos, _end, b.style, { speed: b.speed });
    this.bolts.push(b);
    this.fired++;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    const actors = this.game.actors;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i] as Bolt;
      const step = Math.min(b.left, b.speed * dt);
      const owner = b.owner;
      const only = b.only;
      const hit = actors.raycast(b.pos, b.dir, step + 0.05, (a) =>
        a !== owner && a.alive && a.targetable && (only ? a === only : actors.areHostile(owner, a)));
      if (hit && live(hit.actor)) {
        _dir.x = b.dir.x;
        _dir.y = b.dir.y;
        _dir.z = b.dir.z;
        actors.applyHit(hit.actor, {
          attacker: owner, damage: b.damage, poise: b.poise, kind: 'ranged', element: b.element,
          dir: { x: _dir.x, y: _dir.y, z: _dir.z }, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          knockback: b.knockback, tag: b.tag, weakPoint: b.weakPoint || undefined,
        });
        this.retire(i);
        continue;
      }
      b.pos.addScaledVector(b.dir, step);
      b.left -= step;
      if (b.left <= 1e-4) {
        if (b.wall) {
          _dir.x = -b.dir.x;
          _dir.y = -b.dir.y;
          _dir.z = -b.dir.z;
          this.game.vfx.spawn(b.style === 'violet' ? 'violetBurst' : b.style === 'drone' ? 'droneBoltHit' : 'sparkHit', b.pos, { dir: _dir, scale: 0.7 });
        }
        this.retire(i);
      }
    }
  }

  private retire(i: number): void {
    const b = this.bolts[i] as Bolt;
    this.bolts.splice(i, 1);
    this.pool.push(b);
  }

  clear(): void {
    for (const b of this.bolts) this.pool.push(b);
    this.bolts.length = 0;
    this.fired = 0;
  }
}
