/**
 * Ranged weapon: aim framing, hitscan shots along the camera's aim ray (physics + actor capsules + weak points
 * + links for Axiom), gentle bullet magnetism, magazine / reserve / reload, recoil and tracers.
 */
import * as THREE from 'three';
import type { Actor, ActorRayHit, HitInfo, RayHit, Vec3Like } from '@/core/api';
import { RAY_SHOT } from '@/core/api';
import { forwardX, forwardZ } from '@/core/mathx';
import { TUNING, type RangedKit } from '../tuning';
import { fin, live } from '../safe';
import type { PlayerControllerImpl } from './controller';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _start = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ray: RayHit = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 0, collider: null, ground: false, surface: null };
const _fxDir = { dir: _d as Vec3Like };
const _fxNormal = { dir: _n as Vec3Like, scale: 1 };

export class Ranged {
  ammo = 0;
  reserve = 0;
  reloading = false;
  /** aim framing currently requested */
  aiming = false;
  private reloadLeft = 0;
  private nextShotAt = 0;
  private autoReloadAt = Infinity;
  private readonly assistPoints: THREE.Vector3[] = [];
  private assistCount = 0;
  private readonly assistView: THREE.Vector3[] = [];
  private readonly assistProvider = (): readonly Vec3Like[] => this.assistView;

  constructor(private readonly p: PlayerControllerImpl) {}

  private get kit(): RangedKit {
    return this.p.kit.ranged;
  }

  reset(): void {
    this.reloading = false;
    this.reloadLeft = 0;
    this.nextShotAt = 0;
    this.autoReloadAt = Infinity;
    this.setAim(false);
  }

  setAmmo(mag: number, reserve: number): void {
    this.ammo = Math.max(0, Math.min(this.kit.mag, Math.round(fin(mag, this.kit.mag))));
    this.reserve = Math.max(0, Math.round(fin(reserve, this.kit.reserve)));
    this.reloading = false;
    this.autoReloadAt = this.ammo === 0 && this.reserve > 0 ? this.p.now + TUNING.ranged.autoReloadDelay : Infinity;
  }

  /** enter / leave aim framing (camera, loadout, reticle friction candidates) */
  setAim(on: boolean): void {
    if (on === this.aiming) return;
    this.aiming = on;
    const p = this.p;
    const cam = p.game.camera;
    cam.setAim(on);
    cam.setAimAssist(on ? this.assistProvider : null);
    p.visual?.setLoadout({ melee: true, ranged: on });
    if (!on) p.visual?.setAimPitch(0);
    p.actor.loco.aiming = on;
  }

  update(dt: number): void {
    const p = this.p;
    if (this.reloading) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        const take = Math.min(this.kit.mag - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
      }
    } else if (p.now >= this.autoReloadAt) {
      this.autoReloadAt = Infinity;
      this.startReload();
    }
    if (!this.aiming) return;
    // upper body follows the camera pitch; refresh the reticle-friction candidates
    this.aimRay();
    p.visual?.setAimPitch(Math.asin(Math.max(-1, Math.min(1, _d.y))));
    const hostiles = p.actors.hostilesOf(p.actor);
    let n = 0;
    for (let i = 0; i < hostiles.length && n < 8; i++) {
      const h = hostiles[i] as Actor;
      if (p.actor.distanceTo(h) > TUNING.ranged.assistRange) break;
      const v = (this.assistPoints[n] ??= new THREE.Vector3());
      if (!p.actors.weakPointPosition(h, v)) h.aimPoint(v);
      n++;
    }
    if (n !== this.assistCount) {
      this.assistCount = n;
      this.assistView.length = 0;
      for (let i = 0; i < n; i++) this.assistView.push(this.assistPoints[i] as THREE.Vector3);
    }
  }

  startReload(): boolean {
    if (this.reloading || this.ammo >= this.kit.mag || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadLeft = this.kit.reload;
    this.autoReloadAt = Infinity;
    this.p.game.audio.play('axiomReload', { pos: this.p.actor.pos, pitch: this.kit.id === 'cinderline' ? 0.78 : 1 });
    return true;
  }

  /** camera aim ray into _o / _d (falls back to the figure's eye line with a stub camera) */
  private aimRay(): void {
    const a = this.p.actor;
    a.aimPoint(_o);
    _d.set(forwardX(a.yaw), 0, forwardZ(a.yaw));
    this.p.game.camera.getAimRay(_o, _d);
    if (!(_d.lengthSq() > 1e-8) || !Number.isFinite(_d.x + _d.y + _d.z + _o.x + _o.y + _o.z)) {
      a.aimPoint(_o);
      _d.set(forwardX(a.yaw), 0, forwardZ(a.yaw));
    }
    _d.normalize();
  }

  /** attack pressed while aiming. Returns true when the press was used (false = keep it buffered). */
  tryFire(): boolean {
    const p = this.p;
    if (this.reloading) return true;
    if (p.now < this.nextShotAt) return false;
    if (this.ammo <= 0) {
      if (!this.startReload()) p.game.audio.play('uiBack', { volume: 0.5 });
      return true;
    }
    this.fire();
    return true;
  }

  private fire(): void {
    const p = this.p;
    const a = p.actor;
    const kit = this.kit;
    const game = p.game;
    const physics = p.physics;
    this.aimRay();
    // start the trace past the protagonist so nothing behind the shoulder is hit
    const skip = Math.max(0, fin(game.camera.targetDistance, 0));
    _start.copy(_o).addScaledVector(_d, skip);

    let wall: RayHit | null = null;
    let reach = kit.range;
    if (physics) {
      const r = physics.raycast(_start, _d, kit.range, RAY_SHOT, _ray);
      if (r && Number.isFinite(r.distance)) {
        wall = r;
        reach = r.distance;
      }
    }
    let hit: ActorRayHit | null = p.actors.raycast(_start, _d, reach, p.attackable);
    if (!live(hit)) hit = null;

    // gentle bullet magnetism: a near miss inside 1.5° of a visible hostile bends onto it
    if (!hit && game.settings.get('aimAssist') === true) {
      const hostiles = p.actors.hostilesOf(a);
      let best: Actor | null = null;
      let bestAng: number = TUNING.ranged.magnetism;
      for (let i = 0; i < hostiles.length; i++) {
        const h = hostiles[i] as Actor;
        if (!p.actors.weakPointPosition(h, _p)) h.aimPoint(_p);
        _n.subVectors(_p, _start);
        const dist = _n.length();
        if (dist < 0.5 || dist > Math.min(reach + 1, TUNING.ranged.assistRange)) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, _n.dot(_d) / dist)));
        if (ang > bestAng || (physics && !physics.lineOfFire(_start, _p))) continue;
        bestAng = ang;
        best = h;
      }
      if (best) {
        if (!p.actors.weakPointPosition(best, _p)) best.aimPoint(_p);
        _d.subVectors(_p, _start).normalize();
        hit = p.actors.raycast(_start, _d, reach + 2, (x) => x === best);
        if (!live(hit)) hit = null;
        wall = null;
      }
    }

    if (hit) _end.copy(hit.point);
    else _end.copy(_start).addScaledVector(_d, reach);

    // muzzle
    const v = p.visual;
    if (v) v.socket('muzzle').getWorldPosition(_muzzle);
    else a.aimPoint(_muzzle);

    // Axiom severs a link the shot passes through
    let severed = false;
    if (kit.seversLinks && live(game.ai) && live(game.ai.links)) {
      const link = game.ai.links.hitTest(_muzzle, _end, 0.3);
      if (live(link) && link.alive === true) {
        link.midpoint(_end);
        game.ai.links.sever(link, a);
        severed = true;
      }
    }

    game.vfx.tracer(_muzzle, _end, kit.tracer);
    _fxDir.dir = _d;
    game.vfx.spawn(kit.muzzle, _muzzle, _fxDir);
    game.vfx.flash(_muzzle, p.kit.color, 1, 0.08);
    game.audio.play(kit.sfx, { pos: _muzzle });
    v?.play('shoot', { upperOnly: true });
    game.camera.kick(kit.kickPitch, (game.random() - 0.5) * 2 * kit.kickYaw);
    game.camera.fovPunch(-1.2, 0.18);
    game.camera.shake(kit.shake, 0.18);
    game.input.rumble(0.7, 0.3, 90);

    if (!severed) {
      if (hit) {
        const info: HitInfo = {
          attacker: a,
          damage: kit.damage,
          poise: kit.poise,
          kind: 'ranged',
          element: kit.id === 'cinderline' ? 'cinder' : 'kinetic',
          dir: { x: _d.x, y: _d.y, z: _d.z },
          point: hit.point.clone(),
          weakPoint: hit.weakPoint !== null,
          weakPointScale: kit.weakPointScale,
          knockback: kit.knockback,
        };
        const target = hit.actor;
        const res = p.actors.applyHit(target, info);
        p.onDealt(target, info, res);
      } else if (wall) {
        const n = wall.normal;
        _n.set(fin(n?.x), fin(n?.y, 1), fin(n?.z));
        _fxNormal.scale = kit.id === 'cinderline' ? 1 : 0.7;
        game.vfx.spawn(wall.ground ? 'stoneChip' : 'sparkHit', _end, _fxNormal);
        if (kit.id === 'cinderline') game.vfx.decal('scorch', _end, { normal: _n, size: 0.4, life: 10 });
      }
    }

    this.ammo--;
    this.nextShotAt = p.now + kit.interval;
    if (this.ammo <= 0 && this.reserve > 0) this.autoReloadAt = p.now + TUNING.ranged.autoReloadDelay;
    game.events.emit('player:shot', { weapon: kit.id, ammo: this.ammo });
  }
}
