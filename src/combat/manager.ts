/**
 * ActorManager — owns every Actor: spawn / death / removal, the hostility matrix, spatial queries and the tick
 * (integrate.ts). Damage goes through resolver.ts. Contract and behaviour notes: src/core/api/combat.ts.
 */
import * as THREE from 'three';
import type {
  Actor, ActorDesc, ActorManager, ActorRayHit, Game, HitInfo, HitResult, PhysicsWorld, Team, Vec3Like, WeakPoint,
} from '@/core/api';
import { forwardX, forwardZ } from '@/core/mathx';
import { ActorImpl } from './actor';
import { HostilityMatrix } from './hostility';
import { ScratchHits, ScratchLists, rayVsCapsule, rayVsSphere } from './queries';
import { applyHitImpl } from './resolver';
import { updateActors } from './integrate';
import { TUNING } from './tuning';
import { fin, live, warnOnce } from './safe';

const _v = new THREE.Vector3();
const _ground = { y: 0, surface: null as unknown as NonNullable<ReturnType<PhysicsWorld['groundAt']>>['surface'] };

export class ActorManagerImpl implements ActorManager {
  /** every actor that has not been removed (dead bodies stay until their corpse time runs out) */
  readonly list: ActorImpl[] = [];
  private readonly matrix = new HostilityMatrix();
  private readonly lists = new ScratchLists();
  private readonly hits = new ScratchHits();
  private readonly keys: number[] = [];
  private nextId = 1;
  /** true while update() iterates: removals are deferred */
  updating = false;
  private dirty = false;

  constructor(readonly game: Game) {}

  get all(): readonly Actor[] {
    return this.list;
  }

  /** sim clock */
  get now(): number {
    return fin(this.game.time?.now, 0);
  }

  /** the physics world, or null while it is a stub */
  get physics(): PhysicsWorld | null {
    const p = this.game.physics;
    return live(p) ? p : null;
  }

  /** the protagonist's actor, or null (stub player / none spawned yet) */
  playerActor(): Actor | null {
    const p = this.game.player;
    if (!live(p)) return null;
    const a = p.actor;
    return live(a) ? a : null;
  }

  playerGodMode(): boolean {
    const p = this.game.player;
    return live(p) && p.godMode === true;
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------

  spawn(desc: ActorDesc): Actor {
    const a = new ActorImpl(this.nextId++, desc ?? ({ archetype: 'unknown', team: 'neutral', pos: { x: 0, y: 0, z: 0 }, hp: 1 } as ActorDesc), this.game.time ?? { now: 0 });
    const physics = this.physics;
    if (a.flying && physics) {
      const g = physics.groundAt(a.pos.x, a.pos.z, a.pos.y + 0.5, 0.45, _ground);
      if (g && Number.isFinite(g.y)) {
        a._groundY = g.y;
        a.pos.y = g.y + a.hoverHeight;
      }
    }
    a._visualY = a.pos.y;
    const v = a.visual;
    if (v) {
      v.root.position.copy(a.pos);
      v.root.rotation.y = a.yaw;
      const scene = this.game.scene;
      if (live(scene)) scene.add(v.root);
    }
    this.list.push(a);
    this.game.events.emit('actor:spawned', { actor: a });
    return a;
  }

  despawn(actor: Actor, opts?: { dissolve?: boolean; seconds?: number; keepVisual?: boolean }): void {
    const a = actor as ActorImpl;
    if (!a || a._removed || this.list.indexOf(a) < 0) return;
    if (opts?.dissolve) {
      // fade out of the world: no longer a target, removed when the dissolve completes
      a.alive = false;
      a.targetable = false;
      a.guarding = false;
      a._dissolveSeconds = Math.max(0.05, fin(opts.seconds, TUNING.actor.dissolveSeconds));
      a._dissolveFrom = this.now;
      a._removeAt = this.now + a._dissolveSeconds;
      a._keepVisual = opts.keepVisual === true;
      return;
    }
    this.remove(a, opts?.keepVisual === true);
  }

  /** take an actor out of the world now */
  remove(a: ActorImpl, keepVisual = false): void {
    if (a._removed) return;
    a._removed = true;
    a.alive = false;
    a.targetable = false;
    const c = a.controller;
    if (c && typeof c.dispose === 'function') {
      try {
        c.dispose(a);
      } catch (err) {
        warnOnce(`dispose:${a.name}`, `controller.dispose of "${a.name}" threw: ${String(err)}`);
      }
    }
    const v = a.visual;
    if (v) {
      try {
        v.root.removeFromParent();
        if (!keepVisual && !a._keepVisual) v.dispose();
      } catch (err) {
        warnOnce(`vdispose:${a.name}`, `visual.dispose of "${a.name}" threw: ${String(err)}`);
      }
    }
    if (this.updating) this.dirty = true;
    else {
      const i = this.list.indexOf(a);
      if (i >= 0) this.list.splice(i, 1);
    }
  }

  /** drop removed actors after an update pass */
  compact(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (!a._removed) this.list[w++] = a;
    }
    this.list.length = w;
  }

  kill(actor: Actor, killer: Actor | null = null): void {
    const a = actor as ActorImpl;
    if (!a || !a.alive || a._removed) return;
    const now = this.now;
    a.alive = false;
    a.hp = 0;
    a._wasTargetable = a.targetable;
    a.targetable = false;
    a.guarding = false;
    a.staggeredUntil = 0;
    a.frozenUntil = 0;
    a._diedAt = now;
    a.desiredVel.set(0, 0, 0);
    a.carryVel.set(0, 0, 0);
    const persist = a.tags.has('persist');
    a._removeAt = persist ? Infinity : now + a._corpseSeconds;
    if (a._dissolveOnDeath && !persist && a._corpseSeconds !== Infinity) {
      a._dissolveSeconds = Math.min(TUNING.actor.dissolveSeconds, Math.max(0.2, a._corpseSeconds));
      a._dissolveFrom = a._removeAt - a._dissolveSeconds;
      a._dissolveColor = 0x7a3cff;
    }
    const c = a.controller;
    if (c && typeof c.onDeath === 'function') {
      try {
        c.onDeath(a, killer);
      } catch (err) {
        warnOnce(`ondeath:${a.name}`, `controller.onDeath of "${a.name}" threw: ${String(err)}`);
      }
    }
    const v = a.visual;
    if (v) {
      if (a._wasFrozen) v.setFrozen(0);
      a._wasFrozen = false;
      v.setTelegraph(0);
      v.play('death');
    }
    if (a !== this.playerActor()) {
      const audio = this.game.audio;
      const id = a.material === 'eclipse' ? 'eclipseDeath' : a.flying ? 'droneDeath' : null;
      if (id) audio.play(id, { pos: a.pos });
    }
    this.game.events.emit('actor:died', { actor: a, killer: live(killer) ? killer : null });
  }

  revive(actor: Actor, hp?: number): void {
    const a = actor as ActorImpl;
    if (!a || a._removed) return;
    a.hp = Math.min(a.maxHp, Math.max(1, fin(hp, a.maxHp)));
    a.poise = a.maxPoise;
    a.staggeredUntil = 0;
    a.frozenUntil = 0;
    a.iframesUntil = 0;
    a.impulse.set(0, 0, 0);
    if (a.alive) return;
    a.alive = true;
    a.targetable = a._wasTargetable;
    a._removeAt = Infinity;
    a._dissolveFrom = Infinity;
    const v = a.visual;
    if (v) {
      v.stop();
      v.setDissolve(0);
      v.setFrozen(0);
      v.setVisible(true);
    }
  }

  clear(): void {
    for (const a of this.list.slice()) if (!a.tags.has('persist')) this.remove(a);
    this.compact();
  }

  // ---- damage ---------------------------------------------------------------------------------------------

  applyHit(target: Actor, hit: HitInfo): HitResult {
    return applyHitImpl(this, target as ActorImpl, hit);
  }

  stagger(target: Actor, seconds: number, by: Actor | null = null): void {
    this.staggerWith(target as ActorImpl, seconds, by, 'stagger');
  }

  /** stagger with a specific reaction clip ('stagger' | 'guardBreak') */
  staggerWith(a: ActorImpl, seconds: number, by: Actor | null, clip: string): void {
    if (!a || !a.alive || a.invulnerable || a.protectedNpc || !(seconds > 0)) return;
    const now = this.now;
    a.staggeredUntil = Math.max(a.staggeredUntil, now + seconds);
    a.guarding = false;
    a.desiredVel.set(0, 0, 0);
    a.carryVel.set(0, 0, 0);
    const v = a.visual;
    if (v && !a.frozen) {
      v.setTelegraph(0);
      v.play(clip);
    }
    this.game.events.emit('actor:staggered', { actor: a, by: live(by) ? by : null });
  }

  freeze(target: Actor, seconds: number): void {
    this.freezeFor(target as ActorImpl, seconds);
  }

  /** returns the seconds actually applied (0 = immune) */
  freezeFor(a: ActorImpl, seconds: number): number {
    if (!a || !a.alive || a.invulnerable || a.protectedNpc) return 0;
    const s = fin(seconds, 0) * Math.max(0, fin(a.freezeScale, 1));
    if (!(s > 0)) return 0;
    a.frozenUntil = Math.max(a.frozenUntil, this.now + s);
    a.desiredVel.set(0, 0, 0);
    a.carryVel.set(0, 0, 0);
    a.impulse.set(0, 0, 0);
    if (!a._wasFrozen) {
      a._wasFrozen = true;
      a.visual?.setFrozen(1);
    }
    this.game.events.emit('actor:frozen', { actor: a, seconds: s });
    return s;
  }

  // ---- hostility ------------------------------------------------------------------------------------------

  setHostile(a: Team, b: Team, hostile: boolean): void {
    this.matrix.set(a, b, hostile);
  }

  teamsHostile(a: Team, b: Team): boolean {
    return this.matrix.get(a, b);
  }

  areHostile(a: Actor, b: Actor): boolean {
    if (!a || !b || a === b || a.protectedNpc || b.protectedNpc) return false;
    return this.matrix.get(a.team, b.team);
  }

  resetHostility(): void {
    this.matrix.reset();
  }

  // ---- queries --------------------------------------------------------------------------------------------

  hostilesOf(of: Actor): Actor[] {
    const out = this.lists.take();
    if (!of) return out;
    const keys = this.keys;
    keys.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (!a.alive || !a.targetable || a === of || !this.areHostile(of, a)) continue;
      out.push(a);
      keys.push(Math.hypot(a.pos.x - of.pos.x, a.pos.z - of.pos.z));
    }
    ScratchLists.sortByKey(out, keys);
    return out;
  }

  nearest(pos: Vec3Like, maxDist: number, filter?: (a: Actor) => boolean): Actor | null {
    let best: Actor | null = null;
    let bestD = fin(maxDist, Infinity);
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (!a.alive) continue;
      // 3D, so a body on the balcony overhead is not "nearest" to someone on the floor below it
      const d = Math.hypot(a.pos.x - pos.x, a.bottom - fin(pos.y, a.bottom), a.pos.z - pos.z) - a.radius;
      if (d > bestD || (filter && !filter(a))) continue;
      bestD = d;
      best = a;
    }
    return best;
  }

  inRadius(pos: Vec3Like, radius: number, filter?: (a: Actor) => boolean): Actor[] {
    const out = this.lists.take();
    const keys = this.keys;
    keys.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z) - a.radius;
      if (d > radius) continue;
      // vertical: the body must overlap the sphere's height band
      const lo = a.bottom;
      if (pos.y < lo - radius || pos.y > lo + a.height + radius) continue;
      if (filter && !filter(a)) continue;
      out.push(a);
      keys.push(d);
    }
    ScratchLists.sortByKey(out, keys);
    return out;
  }

  inArc(pos: Vec3Like, yaw: number, arc: number, range: number, filter?: (a: Actor) => boolean): Actor[] {
    const out = this.lists.take();
    const keys = this.keys;
    keys.length = 0;
    const fx = forwardX(yaw);
    const fz = forwardZ(yaw);
    const half = Math.min(Math.PI, Math.max(0, arc * 0.5));
    const up = TUNING.melee.reachUp;
    const down = TUNING.melee.reachDown;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (!a.alive) continue;
      const dx = a.pos.x - pos.x;
      const dz = a.pos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist - a.radius > range) continue;
      const lo = a.bottom;
      if (lo > pos.y + up || lo + a.height < pos.y - down) continue;
      if (half < Math.PI - 1e-3 && dist > a.radius) {
        // widen the arc by the angle the body itself subtends
        const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / dist)));
        if (ang - Math.asin(Math.min(1, a.radius / dist)) > half) continue;
      }
      if (filter && !filter(a)) continue;
      out.push(a);
      keys.push(dist - a.radius);
    }
    ScratchLists.sortByKey(out, keys);
    return out;
  }

  raycast(origin: Vec3Like, dir: Vec3Like, maxDist: number, filter?: (a: Actor) => boolean): ActorRayHit | null {
    let dx = fin(dir?.x);
    let dy = fin(dir?.y);
    let dz = fin(dir?.z);
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9 || !origin) return null;
    dx /= len;
    dy /= len;
    dz /= len;
    const ox = fin(origin.x);
    const oy = fin(origin.y);
    const oz = fin(origin.z);
    let best: ActorImpl | null = null;
    let bestT = fin(maxDist, Infinity);
    let bestWp: WeakPoint | null = null;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (!a.alive || (!filter && !a.targetable)) continue;
      // cheap reject: distance from the axis to the ray's line in the plane is not enough in 3D; use a sphere
      const reach = a.height + a.radius + 1.5;
      const cx = a.pos.x - ox;
      const cy = a.bottom + a.height * 0.5 - oy;
      const cz = a.pos.z - oz;
      const along = cx * dx + cy * dy + cz * dz;
      if (along < -reach || along - reach > bestT) continue;
      if (cx * cx + cy * cy + cz * cz - along * along > reach * reach) continue;
      if (filter && !filter(a)) continue;
      const lo = a.bottom;
      let t = rayVsCapsule(ox, oy, oz, dx, dy, dz, a.pos.x, lo, lo + a.height, a.pos.z, a.radius);
      let wp: WeakPoint | null = null;
      const wps = a.weakPoints;
      if (wps.length && a.visual) {
        for (let k = 0; k < wps.length; k++) {
          const w = wps[k] as WeakPoint;
          if (!w.exposed) continue;
          a.visual.socket(w.socket).getWorldPosition(_v);
          const tw = rayVsSphere(ox, oy, oz, dx, dy, dz, _v.x, _v.y, _v.z, w.radius);
          // the weak point wins only where the ray meets it at the body's surface on the ray's own side:
          // a rear vent cannot be shot through the chest
          if (tw >= 0 && (t < 0 || tw <= t + w.radius)) {
            wp = w;
            t = t < 0 ? tw : Math.min(t, tw);
            break;
          }
        }
      }
      if (t < 0 || t > bestT) continue;
      bestT = t;
      best = a;
      bestWp = wp;
    }
    if (!best) return null;
    const hit = this.hits.take();
    hit.actor = best;
    hit.distance = bestT;
    hit.weakPoint = bestWp;
    hit.point.set(ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
    return hit;
  }

  byTag(tag: string): Actor[] {
    const out = this.lists.take();
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (a.alive && a.tags.has(tag)) out.push(a);
    }
    return out;
  }

  byId(id: number): Actor | null {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i] as ActorImpl;
      if (a.id === id && !a._removed) return a;
    }
    return null;
  }

  isFlank(target: Actor, dir: Vec3Like): boolean {
    const off = this.offAngle(target, dir, null);
    return off > TUNING.hit.flankAngle;
  }

  /**
   * Angle (0..π) between the target's facing and the direction the hit comes FROM; -1 when it has no direction.
   * The travel direction is preferred (projectiles); the attacker's position is the fallback.
   */
  offAngle(target: Actor, dir: Vec3Like | undefined, attacker: Actor | null): number {
    let sx = -fin(dir?.x);
    let sz = -fin(dir?.z);
    if (sx * sx + sz * sz < 1e-6) {
      if (!attacker) return -1;
      sx = attacker.pos.x - target.pos.x;
      sz = attacker.pos.z - target.pos.z;
      if (sx * sx + sz * sz < 1e-6) return -1;
    }
    const l = Math.hypot(sx, sz);
    const d = (sx * forwardX(target.yaw) + sz * forwardZ(target.yaw)) / l;
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }

  /** exposed weak point whose sphere contains `point` (slack widens the spheres), else null */
  weakPointAt(target: Actor, point: Vec3Like | undefined, slack = 0.08): WeakPoint | null {
    const wps = target.weakPoints;
    const v = target.visual;
    if (!wps || !wps.length || !v || !point || !Number.isFinite(point.x + point.y + point.z)) return null;
    for (let k = 0; k < wps.length; k++) {
      const w = wps[k] as WeakPoint;
      if (!w.exposed) continue;
      v.socket(w.socket).getWorldPosition(_v);
      const r = w.radius + slack;
      if (_v.distanceToSquared(point as THREE.Vector3) <= r * r) return w;
    }
    return null;
  }

  /** the first exposed weak point (or the exposed one called `id`), else null */
  exposedWeakPoint(target: Actor, id?: string): WeakPoint | null {
    const wps = target.weakPoints;
    if (!wps) return null;
    for (let k = 0; k < wps.length; k++) {
      const w = wps[k] as WeakPoint;
      if (w.exposed && (id === undefined || w.id === id)) return w;
    }
    return null;
  }

  weakPointPosition(actor: Actor, out: THREE.Vector3, id?: string): THREE.Vector3 | null {
    const w = this.exposedWeakPoint(actor, id);
    if (!w) return null;
    const v = actor.visual;
    if (!v) return actor.aimPoint(out);
    v.socket(w.socket).getWorldPosition(out);
    return out;
  }

  // ---- tick -----------------------------------------------------------------------------------------------

  update(dt: number): void {
    updateActors(this, fin(dt, 0));
  }
}
