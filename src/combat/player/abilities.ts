/**
 * Echo abilities. Tarrik: Cinder Slam (ground strike AoE) and the Cinder Sticky Grenade (sticks, fused blast).
 * Selene: Stasis Grenade (arresting field) and Dispatch (blink-strike that lands behind the target).
 */
import * as THREE from 'three';
import type { AbilityId, AbilityState, Actor, HitInfo, RayHit, VfxHandle } from '@/core/api';
import { RAY_SHOT } from '@/core/api';
import { clamp, clamp01, forwardX, forwardZ, lerp } from '@/core/mathx';
import { TUNING } from '../tuning';
import { fin, live } from '../safe';
import type { PlayerControllerImpl } from './controller';

interface Grenade {
  kind: 'sticky' | 'stasis';
  mesh: THREE.Mesh;
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  stuck: boolean;
  stuckTo: Actor | null;
  offset: THREE.Vector3;
  fuse: number;
  fx: VfxHandle | null;
}

interface Field {
  pos: THREE.Vector3;
  left: number;
}

type Running =
  | { id: 'cinderSlam'; t: number; dur: number; at: number; done: boolean }
  | { id: 'throw'; kind: 'sticky' | 'stasis'; t: number; dur: number; at: number; done: boolean }
  | { id: 'dispatch'; t: number; dur: number; at: number; done: boolean; vanished: boolean; target: Actor; land: THREE.Vector3 };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();
const _ray: RayHit = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 0, collider: null, ground: false, surface: null };
const _ground = { y: 0, surface: null as never };
const UP = { x: 0, y: 1, z: 0 };

export class Abilities {
  readonly states: [AbilityState, AbilityState] = [
    { id: 'cinderSlam', name: '', cost: 0, cooldown: 0, cooldownLeft: 0, ready: false },
    { id: 'cinderSticky', name: '', cost: 0, cooldown: 0, cooldownLeft: 0, ready: false },
  ];
  private running: Running | null = null;
  private readonly grenades: Grenade[] = [];
  private readonly fields: Field[] = [];
  private geo: THREE.SphereGeometry | null = null;
  private readonly mats: Partial<Record<'sticky' | 'stasis', THREE.MeshStandardMaterial>> = {};

  constructor(private readonly p: PlayerControllerImpl) {}

  /** load the current protagonist's two abilities into the HUD slots */
  bindKit(): void {
    const kit = this.p.kit;
    for (let i = 0; i < 2; i++) {
      const s = this.states[i] as AbilityState;
      const k = kit.abilities[i as 0 | 1];
      s.id = k.id;
      s.name = k.name;
      s.cost = k.cost;
      s.cooldown = k.cooldown;
      s.cooldownLeft = 0;
      s.ready = false;
    }
  }

  reset(): void {
    this.running = null;
    for (const s of this.states) s.cooldownLeft = 0;
  }

  /** remove grenades and fields in flight (zone unload) */
  clearWorld(): void {
    for (const g of this.grenades) this.retire(g);
    this.fields.length = 0;
  }

  tick(dt: number): void {
    const echo = this.p.echo;
    for (const s of this.states) {
      if (s.cooldownLeft > 0) s.cooldownLeft = Math.max(0, s.cooldownLeft - dt);
      s.ready = s.cooldownLeft <= 0 && echo >= s.cost;
    }
    this.updateGrenades(dt);
    this.updateFields(dt);
  }

  /** ability button. Returns true when the press was used (also when it was refused with feedback). */
  activate(slot: 0 | 1): boolean {
    const p = this.p;
    const s = this.states[slot] as AbilityState;
    if (s.cooldownLeft > 0 || p.echo < s.cost) {
      p.game.audio.play('uiBack', { volume: 0.5 });
      return true;
    }
    if (p.action === 'attack' || p.action === 'charge') p.melee.end();
    let ok = false;
    if (s.id === 'cinderSlam') ok = this.startSlam();
    else if (s.id === 'cinderSticky') ok = this.startThrow('sticky');
    else if (s.id === 'stasisGrenade') ok = this.startThrow('stasis');
    else if (s.id === 'dispatch') ok = this.startDispatch();
    if (!ok) {
      p.game.audio.play('uiBack', { volume: 0.5 });
      return true;
    }
    p.spendEcho(s.cost, s.id);
    s.cooldownLeft = s.cooldown;
    p.game.events.emit('player:ability', { id: s.id as AbilityId });
    p.setState('ability');
    return true;
  }

  updateActive(dt: number): void {
    const p = this.p;
    const r = this.running;
    if (!r) {
      p.setState('free');
      return;
    }
    r.t += dt;
    if (r.id === 'throw') p.move.locomotion(dt, 'guard');
    else p.move.brake(dt, 60);
    if (r.id === 'dispatch' && !r.vanished && r.t >= TUNING.abilities.dispatch.vanishAt) {
      r.vanished = true;
      this.blink(r.target, r.land);
    }
    if (!r.done && r.t >= r.at) {
      r.done = true;
      if (r.id === 'cinderSlam') this.slam();
      else if (r.id === 'throw') this.release(r.kind);
      else this.strike(r.target);
    }
    if (r.t >= r.dur || (r.done && r.t >= r.at + 0.18 && p.active && p.consumeBuffered())) {
      this.running = null;
      if (p.action === 'ability') p.setState('free');
    }
  }

  /** the ability in progress was interrupted (stagger / death) */
  interrupt(): void {
    this.running = null;
  }

  // ---- Cinder Slam ----------------------------------------------------------------------------------------

  private startSlam(): boolean {
    const p = this.p;
    const info = p.playAction('slam', 0.95, 0.475);
    const at = info.hitTimes[0] as number;
    this.running = { id: 'cinderSlam', t: 0, dur: info.duration, at, done: false };
    p.actor.superArmorUntil = p.now + at + 0.1;
    p.actor.guarding = false;
    p.game.audio.play('cinderIgnite', { pos: p.actor.pos });
    p.visual?.setGlow(2.5);
    return true;
  }

  private slam(): void {
    const p = this.p;
    const a = p.actor;
    const S = TUNING.abilities.cinderSlam;
    const game = p.game;
    const cx = a.pos.x + forwardX(a.yaw) * S.reach;
    const cz = a.pos.z + forwardZ(a.yaw) * S.reach;
    _a.set(cx, a.pos.y, cz);
    game.vfx.spawn('cinderSlam', _a, { scale: S.radius / 4.8 });
    game.vfx.shockwave(_a, S.radius, p.kit.color, 0.4);
    game.audio.play('cinderSlam', { pos: _a });
    game.camera.shake(0.9, 0.7);
    game.camera.fovPunch(5, 0.6);
    game.input.rumble(1, 1, 320);
    game.time.hitStop(0.09);
    p.visual?.setGlow(1);
    const centre = new THREE.Vector3(cx, a.pos.y + 0.9, cz);
    const list = p.actors.inRadius(_a, S.radius, p.attackable);
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Actor;
      t.aimPoint(_b);
      if (p.physics && !p.physics.lineOfFire(centre, _b)) continue;
      const dx = t.pos.x - cx;
      const dz = t.pos.z - cz;
      const l = Math.hypot(dx, dz);
      const hit: HitInfo = {
        attacker: a, damage: S.damage, poise: S.poise, kind: 'ability', element: 'cinder',
        dir: l > 1e-3 ? { x: dx / l, y: 0, z: dz / l } : { x: forwardX(a.yaw), y: 0, z: forwardZ(a.yaw) },
        point: _b.clone(), heavy: true, unblockable: true, ignoreWeakPoints: true, knockback: S.knockback, tag: 'cinderSlam',
      };
      p.onDealt(t, hit, p.actors.applyHit(t, hit));
    }
  }

  // ---- grenades -------------------------------------------------------------------------------------------

  private startThrow(kind: 'sticky' | 'stasis'): boolean {
    const p = this.p;
    const info = p.playAction('throw', 0.55, 0.28);
    this.running = { id: 'throw', kind, t: 0, dur: info.duration, at: info.hitTimes[0] as number, done: false };
    p.actor.guarding = false;
    p.game.audio.play(kind === 'sticky' ? 'stickyThrow' : 'stasisThrow', { pos: p.actor.pos });
    return true;
  }

  private acquire(kind: 'sticky' | 'stasis'): Grenade {
    let g = this.grenades.find((x) => !x.active);
    if (!g) {
      this.geo ??= new THREE.SphereGeometry(0.085, 12, 8);
      const mesh = new THREE.Mesh(this.geo);
      mesh.name = 'grenade';
      mesh.castShadow = false;
      g = { kind, mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, stuck: false, stuckTo: null, offset: new THREE.Vector3(), fuse: 0, fx: null };
      this.grenades.push(g);
    }
    const mat = (this.mats[kind] ??= new THREE.MeshStandardMaterial({
      color: 0x16110e, roughness: 0.4, metalness: 0.6,
      emissive: kind === 'sticky' ? 0xff6a1a : 0xcfeeff, emissiveIntensity: 4,
    }));
    g.mesh.material = mat;
    g.kind = kind;
    g.active = true;
    g.stuck = false;
    g.stuckTo = null;
    g.t = 0;
    g.fuse = 0;
    g.fx = null;
    g.mesh.scale.setScalar(1);
    const scene = this.p.game.scene;
    if (live(scene)) scene.add(g.mesh);
    return g;
  }

  private retire(g: Grenade): void {
    if (!g.active) return;
    g.active = false;
    g.mesh.removeFromParent();
    if (g.fx) g.fx.stop();
    g.fx = null;
    g.stuckTo = null;
  }

  /** the grenade leaves the hand along the aim ray on a low ballistic arc */
  private release(kind: 'sticky' | 'stasis'): void {
    const p = this.p;
    const a = p.actor;
    const T = kind === 'sticky' ? TUNING.abilities.cinderSticky : TUNING.abilities.stasisGrenade;
    const g = this.acquire(kind);
    const v = p.visual;
    if (v) v.socket('handR').getWorldPosition(g.pos);
    else a.aimPoint(g.pos);
    if (g.pos.distanceToSquared(a.pos) > 16) a.aimPoint(g.pos);

    // where the player is looking: lock target, else what the aim ray meets
    const lock = p.lockTarget;
    if (lock && lock.alive) lock.aimPoint(_b);
    else {
      a.aimPoint(_o);
      _d.set(forwardX(a.yaw), 0, forwardZ(a.yaw));
      p.game.camera.getAimRay(_o, _d);
      _d.normalize();
      const skip = Math.max(0, fin(p.game.camera.targetDistance, 0));
      _o.addScaledVector(_d, skip);
      let reach = 26;
      const r = p.physics ? p.physics.raycast(_o, _d, reach, RAY_SHOT, _ray) : null;
      if (r && Number.isFinite(r.distance)) reach = r.distance;
      const h = p.actors.raycast(_o, _d, reach, p.attackable);
      if (live(h)) reach = h.distance;
      _b.copy(_o).addScaledVector(_d, Math.max(2, reach));
    }
    // low-arc launch angle for a fixed muzzle speed
    const dx = _b.x - g.pos.x;
    const dz = _b.z - g.pos.z;
    const dy = _b.y - g.pos.y;
    const x = Math.max(0.5, Math.hypot(dx, dz));
    const s2 = T.speed * T.speed;
    const disc = s2 * s2 - T.gravity * (T.gravity * x * x + 2 * dy * s2);
    const ang = disc >= 0 ? Math.atan((s2 - Math.sqrt(disc)) / (T.gravity * x)) : Math.PI / 4;
    const ch = (Math.cos(ang) * T.speed) / x;
    g.vel.set(dx * ch, Math.sin(ang) * T.speed, dz * ch);
    g.mesh.position.copy(g.pos);
  }

  private updateGrenades(dt: number): void {
    const p = this.p;
    for (const g of this.grenades) {
      if (!g.active) continue;
      const T = g.kind === 'sticky' ? TUNING.abilities.cinderSticky : TUNING.abilities.stasisGrenade;
      g.t += dt;
      if (!g.stuck) {
        g.vel.y -= T.gravity * dt;
        _d.copy(g.vel).multiplyScalar(dt);
        const len = _d.length();
        let contact: Actor | null = null;
        let hitDist = Infinity;
        if (len > 1e-5) {
          _d.multiplyScalar(1 / len);
          const r = p.physics ? p.physics.raycast(g.pos, _d, len, RAY_SHOT, _ray) : null;
          if (r && Number.isFinite(r.distance)) hitDist = r.distance;
          const h = p.actors.raycast(g.pos, _d, Math.min(len, hitDist), p.attackable);
          if (live(h)) {
            contact = h.actor;
            hitDist = h.distance;
          }
          g.pos.addScaledVector(_d, Math.min(len, hitDist === Infinity ? len : Math.max(0, hitDist - 0.03)));
        }
        const landed = hitDist !== Infinity;
        if (landed || g.t >= T.maxFlight) {
          if (g.kind === 'stasis') {
            this.stasis(g.pos);
            this.retire(g);
            continue;
          }
          g.stuck = true;
          g.stuckTo = contact;
          if (contact) g.offset.subVectors(g.pos, contact.pos);
          g.fuse = landed ? TUNING.abilities.cinderSticky.fuse : 0.3;
          g.fx = p.game.vfx.spawn('cinderStickyArm', g.pos, { duration: g.fuse });
          if (!live(g.fx)) g.fx = null;
          p.game.audio.play('stickyArm', { pos: g.pos });
        }
      } else {
        const t = g.stuckTo;
        if (t && t.alive) g.pos.addVectors(t.pos, g.offset);
        g.fx?.setPosition(g.pos);
        g.fuse -= dt;
        // the pulse accelerates toward the blast
        const k = 1 - clamp01(g.fuse / TUNING.abilities.cinderSticky.fuse);
        g.mesh.scale.setScalar(1 + 0.5 * Math.abs(Math.sin(g.t * (8 + 26 * k))));
        if (g.fuse <= 0) {
          this.blast(g);
          this.retire(g);
          continue;
        }
      }
      g.mesh.position.copy(g.pos);
    }
  }

  private blast(g: Grenade): void {
    const p = this.p;
    const a = p.actor;
    const S = TUNING.abilities.cinderSticky;
    const game = p.game;
    const at = g.pos.clone();
    game.vfx.spawn('cinderStickyBlast', at, { dir: UP });
    game.vfx.decal('scorch', at, { size: 2.6, life: 18 });
    game.audio.play('stickyBlast', { pos: at });
    const near = clamp01(1 - (a.pos.distanceTo(at) - 4) / 14);
    game.camera.shake(lerp(0.15, 0.8, near), 0.5);
    game.input.rumble(near, near, 220);
    const stuckTo = g.stuckTo;
    const list = p.actors.inRadius(at, S.radius, p.attackable);
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Actor;
      t.aimPoint(_b);
      if (t !== stuckTo && p.physics && !p.physics.lineOfFire(at, _b)) continue;
      const dx = t.pos.x - at.x;
      const dz = t.pos.z - at.z;
      const l = Math.hypot(dx, dz);
      const d = Math.max(0, l - t.radius);
      const fall = t === stuckTo || d <= S.innerRadius ? 1 : lerp(1, 0.5, clamp01((d - S.innerRadius) / (S.radius - S.innerRadius)));
      const hit: HitInfo = {
        attacker: a, damage: S.damage * fall, poise: S.poise * fall, kind: 'explosion', element: 'cinder',
        dir: l > 1e-3 ? { x: dx / l, y: 0, z: dz / l } : { x: 0, y: 1, z: 0 },
        point: _b.clone(), heavy: true, unblockable: true, ignoreWeakPoints: true, knockback: S.knockback * fall, tag: 'cinderSticky',
      };
      p.onDealt(t, hit, p.actors.applyHit(t, hit));
    }
  }

  /** stasis field: arrests hostiles inside it now, and any that walk in while it stands */
  private stasis(at: THREE.Vector3): void {
    const p = this.p;
    const S = TUNING.abilities.stasisGrenade;
    const pos = at.clone();
    const g = p.physics ? p.physics.groundAt(pos.x, pos.z, pos.y + 0.3, 0.45, _ground) : null;
    if (g && Number.isFinite(g.y) && pos.y - g.y < 3) pos.y = g.y;
    p.game.vfx.spawn('stasisField', pos, { scale: S.radius / 3.5, duration: S.seconds });
    p.game.vfx.decal('frost', pos, { size: S.radius * 1.6, life: S.seconds + 4 });
    p.game.audio.play('stasisField', { pos });
    p.game.audio.play('frostArrest', { pos });
    p.game.camera.shake(0.25, 0.3);
    this.fields.push({ pos, left: S.seconds });
    this.arrest(this.fields[this.fields.length - 1] as Field);
  }

  private arrest(f: Field): void {
    const p = this.p;
    const a = p.actor;
    const S = TUNING.abilities.stasisGrenade;
    const list = p.actors.inRadius(f.pos, S.radius, p.hostile);
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Actor;
      if (t.frozen) continue;
      const hit: HitInfo = {
        attacker: a, damage: 0, poise: 0, kind: 'ability', element: 'frost', dir: { x: 0, y: 0, z: 0 },
        point: t.aimPoint(_b).clone(), freeze: Math.max(0.6, f.left), unblockable: true, ignoreWeakPoints: true, tag: 'stasis',
      };
      p.actors.applyHit(t, hit);
    }
  }

  private updateFields(dt: number): void {
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i] as Field;
      f.left -= dt;
      if (f.left <= 0) {
        this.fields.splice(i, 1);
        continue;
      }
      this.arrest(f);
    }
  }

  // ---- Dispatch -------------------------------------------------------------------------------------------

  /** lock target, else the hostile under (or nearest to) the aim ray, inside range and in sight */
  private dispatchTarget(): Actor | null {
    const p = this.p;
    const a = p.actor;
    const D = TUNING.abilities.dispatch;
    const lock = p.lockTarget;
    let t: Actor | null = lock && lock.alive && a.distanceTo(lock) <= D.range ? lock : null;
    if (!t) {
      a.aimPoint(_o);
      _d.set(forwardX(a.yaw), 0, forwardZ(a.yaw));
      p.game.camera.getAimRay(_o, _d);
      _d.normalize();
      const skip = Math.max(0, fin(p.game.camera.targetDistance, 0));
      const h = p.actors.raycast(_o, _d, D.range + skip, p.hostile);
      if (live(h)) t = h.actor;
      else {
        let best: number = D.cone;
        const hostiles = p.actors.hostilesOf(a);
        for (let i = 0; i < hostiles.length; i++) {
          const x = hostiles[i] as Actor;
          if (a.distanceTo(x) > D.range) break;
          x.aimPoint(_b).sub(_o);
          const dist = _b.length();
          if (dist < 0.3) continue;
          const ang = Math.acos(clamp(_b.dot(_d) / dist, -1, 1));
          if (ang < best) {
            best = ang;
            t = x;
          }
        }
      }
    }
    if (!t) return null;
    if (p.physics && !p.physics.lineOfSight(a.aimPoint(_a), t.aimPoint(_b))) return null;
    return t;
  }

  /** a standable spot behind the target (else beside / in front of it) */
  private landing(t: Actor, out: THREE.Vector3): boolean {
    const p = this.p;
    const a = p.actor;
    const D = TUNING.abilities.dispatch;
    const reach = t.radius + D.behind;
    const gy = t.flying ? a.pos.y : t.pos.y;
    const physics = p.physics;
    const bx = -forwardX(t.yaw);
    const bz = -forwardZ(t.yaw);
    out.set(t.pos.x + bx * reach, gy, t.pos.z + bz * reach);
    if (!physics) return true;
    if (physics.canStand(out.x, out.y, out.z, a.radius, a.height)) return true;
    // near side: between the target and where we stand
    const dx = a.pos.x - t.pos.x;
    const dz = a.pos.z - t.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    out.set(t.pos.x + (dx / l) * reach, gy, t.pos.z + (dz / l) * reach);
    if (physics.canStand(out.x, out.y, out.z, a.radius, a.height)) return true;
    const n = physics.nearestStandable(t.pos.x + bx * reach, gy, t.pos.z + bz * reach, a.radius, 2.5, a.height);
    if (n && Number.isFinite(n.x + n.y + n.z)) {
      out.set(n.x, n.y, n.z);
      return true;
    }
    return false;
  }

  private startDispatch(): boolean {
    const p = this.p;
    const t = this.dispatchTarget();
    if (!t) return false;
    const land = new THREE.Vector3();
    if (!this.landing(t, land)) return false;
    const info = p.playAction('dispatch', 0.55, 0.25);
    const at = Math.max(info.hitTimes[0] as number, TUNING.abilities.dispatch.vanishAt + 0.06);
    this.running = { id: 'dispatch', t: 0, dur: Math.max(info.duration, at + 0.1), at, done: false, vanished: false, target: t, land };
    const a = p.actor;
    a.guarding = false;
    a.iframesUntil = Math.max(a.iframesUntil, p.now + at + 0.15);
    a.face(t.pos);
    p.game.audio.play('dispatch', { pos: a.pos });
    return true;
  }

  private blink(t: Actor, land: THREE.Vector3): void {
    const p = this.p;
    const a = p.actor;
    a.aimPoint(_a);
    _d.set(land.x - a.pos.x, land.y - a.pos.y, land.z - a.pos.z);
    const dist = _d.length();
    if (dist > 1e-3) {
      _d.multiplyScalar(1 / dist);
      p.game.vfx.spawn('dispatchStreak', _a, { dir: _d, scale: Math.max(0.4, dist / 4) });
    }
    a.pos.copy(land);
    a.vel.set(0, 0, 0);
    a.face(t.pos);
    p.game.vfx.spawn('frostBurst', a.aimPoint(_a), { scale: 0.6 });
    p.game.camera.fovPunch(4, 0.3);
  }

  private strike(t: Actor): void {
    const p = this.p;
    const a = p.actor;
    const D = TUNING.abilities.dispatch;
    if (!t.alive) return;
    a.face(t.pos);
    const exposed = t.frozen || t.staggered || p.actors.weakPointPosition(t, _b) !== null;
    let mult = exposed ? D.bonus : 1;
    // the resolver already scales frozen targets: keep the total at the authored bonus
    if (t.frozen) mult /= TUNING.hit.frozenDamageScale;
    const dx = t.pos.x - a.pos.x;
    const dz = t.pos.z - a.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const hit: HitInfo = {
      attacker: a, damage: D.damage * mult, poise: D.poise, kind: 'ability', element: 'frost',
      dir: { x: dx / l, y: 0, z: dz / l }, point: t.aimPoint(_b).clone(), heavy: true, ignoreWeakPoints: true, knockback: 2.5, tag: 'dispatch',
    };
    p.onDealt(t, hit, p.actors.applyHit(t, hit));
  }
}
