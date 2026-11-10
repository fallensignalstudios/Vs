/**
 * Lock-on (toggle on the hostile nearest the screen centre, flick the look stick / mouse to switch, auto-drop
 * on death or 2 s without sight) and the tactical read (a 3 s pulse that marks hostiles, devices, link
 * midpoints and weak points).
 */
import * as THREE from 'three';
import type { Actor, Vec3Like } from '@/core/api';
import { forwardX, forwardZ } from '@/core/mathx';
import { TUNING } from '../tuning';
import { fin, live } from '../safe';
import type { PlayerControllerImpl } from './controller';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _t = new THREE.Vector3();
const _a = new THREE.Vector3();
const _m = new THREE.Vector3();

export class LockOn {
  target: Actor | null = null;
  private lostSight = 0;
  private flick = 0;
  private flickAge = 0;
  private flickReadyAt = 0;
  private readonly point = new THREE.Vector3();
  private readonly provider = (): Vec3Like => {
    const t = this.target;
    if (t) t.aimPoint(this.point);
    return this.point;
  };

  // tactical read
  scanLeft = 0;
  private scanReadyAt = 0;
  private readonly markers: string[] = [];

  constructor(private readonly p: PlayerControllerImpl) {}

  reset(): void {
    this.set(null);
    this.endScan();
    this.scanReadyAt = 0;
  }

  set(t: Actor | null): void {
    if (t === this.target) return;
    this.target = t;
    this.lostSight = 0;
    this.p.game.camera.setLockOn(t ? this.provider : null);
    this.p.game.events.emit('player:lockon', { target: t });
  }

  private aimRay(): void {
    const a = this.p.actor;
    a.aimPoint(_o);
    _d.set(forwardX(a.yaw), 0, forwardZ(a.yaw));
    this.p.game.camera.getAimRay(_o, _d);
    if (!(_d.lengthSq() > 1e-8)) _d.set(forwardX(a.yaw), 0, forwardZ(a.yaw));
    _d.normalize();
  }

  /** best candidate near the screen centre; `side` ≠ 0 restricts to targets left (+1) / right (−1) of `from` */
  private pick(side: number, from: Actor | null): Actor | null {
    const p = this.p;
    const a = p.actor;
    const L = TUNING.lockOn;
    this.aimRay();
    // camera right in the plane (yaw convention: right = (−dz, 0, dx) of the flattened forward)
    _r.set(-_d.z, 0, _d.x);
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _r.normalize();
    let refSide = 0;
    if (from) refSide = from.aimPoint(_t).sub(_o).dot(_r);
    const hostiles = p.actors.hostilesOf(a);
    let best: Actor | null = null;
    let bestScore = Infinity;
    const eye = a.aimPoint(_a);
    for (let i = 0; i < hostiles.length; i++) {
      const h = hostiles[i] as Actor;
      if (h === from) continue;
      const dist = a.distanceTo(h);
      if (dist > L.range) break;
      h.aimPoint(_t);
      if (p.physics && !p.physics.lineOfSight(eye, _t)) continue;
      _m.subVectors(_t, _o);
      const len = _m.length();
      if (len < 0.2) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, _m.dot(_d) / len)));
      let score: number;
      if (side !== 0) {
        // switching: the next target over in the flick direction (left = smaller "right" coordinate)
        const rel = _m.dot(_r) - refSide;
        if (side > 0 ? rel >= -0.05 : rel <= 0.05) continue;
        score = Math.abs(rel) + dist * 0.05;
      } else {
        // toggling on: near the screen centre wins, with close bodies favoured even off-centre
        if (ang > L.halfAngle && dist > 5) continue;
        score = ang + dist * 0.012;
      }
      if (score < bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return best;
  }

  toggle(): void {
    if (this.target) this.set(null);
    else this.set(this.pick(0, null));
  }

  update(dt: number, active: boolean): void {
    const p = this.p;
    const L = TUNING.lockOn;
    const t = this.target;
    if (t) {
      const a = p.actor;
      let drop = !t.alive || !t.targetable || !p.actors.areHostile(a, t) || a.distanceTo(t) > L.dropRange;
      if (!drop && p.physics) {
        if (p.physics.lineOfSight(a.aimPoint(_a), t.aimPoint(_t))) this.lostSight = 0;
        else {
          this.lostSight += dt;
          drop = this.lostSight > L.losGrace;
        }
      }
      if (drop) {
        // a kill hands the lock to the next body close by, so a melee string keeps flowing
        const next = !t.alive ? this.pick(0, t) : null;
        this.set(next && a.distanceTo(next) < 9 ? next : null);
      } else if (active) {
        // flick the look input to switch
        const lx = fin(p.game.input.look?.x);
        this.flickAge += dt;
        if (this.flickAge > L.flickWindow) {
          this.flick = 0;
          this.flickAge = 0;
        }
        this.flick += lx;
        if (Math.abs(this.flick) >= L.flick && p.now >= this.flickReadyAt) {
          const next = this.pick(Math.sign(this.flick), t);
          this.flick = 0;
          this.flickReadyAt = p.now + L.flickCooldown;
          if (next) this.set(next);
        }
      }
    }
    if (this.scanLeft > 0) {
      this.scanLeft -= dt;
      if (this.scanLeft <= 0) this.endScan();
    }
  }

  // ---- tactical read --------------------------------------------------------------------------------------

  scan(): boolean {
    const p = this.p;
    const S = TUNING.scan;
    if (p.now < this.scanReadyAt) return false;
    this.endScan();
    this.scanReadyAt = p.now + S.cooldown;
    this.scanLeft = S.seconds;
    const a = p.actor;
    const game = p.game;
    game.audio.play('scanPulse', { pos: a.pos });
    game.vfx.shockwave(a.pos, S.range * 0.6, S.color, 0.9);
    game.camera.fovPunch(-2.5, 0.7);
    game.ui.caption('Tactical read', 'scan');
    let n = 0;
    for (const x of p.actors.all) {
      if (!x.alive || x === a || x.protectedNpc || a.distanceTo(x) > S.range) continue;
      const hostile = p.actors.areHostile(a, x);
      const device = x.tags.has('device') || x.tags.has('objective') || x.tags.has('source');
      if (!hostile && !device) continue;
      x.visual?.flash(device ? 0xffe2a8 : S.color, S.seconds * 0.8);
      if (device && n < 8) this.mark(`scan:a${x.id}`, x.aimPoint(_t), x.name, 'threat');
      else if (p.actors.weakPointPosition(x, _t) && n < 8) this.mark(`scan:w${x.id}`, _t, 'Weak point', 'interact');
      else continue;
      n++;
    }
    const ai = game.ai;
    if (live(ai) && live(ai.links)) {
      let k = 0;
      for (const link of ai.links.all) {
        if (!live(link) || link.alive !== true || k >= 6) continue;
        link.midpoint(_t);
        if (Math.hypot(_t.x - a.pos.x, _t.z - a.pos.z) > S.range) continue;
        this.mark(`scan:l${link.id}`, _t, 'Link', 'interact');
        k++;
      }
    }
    return true;
  }

  private mark(id: string, pos: Vec3Like, label: string, kind: 'threat' | 'interact'): void {
    this.markers.push(id);
    this.p.game.ui.marker(id, { x: pos.x, y: pos.y, z: pos.z }, { label, kind });
  }

  private endScan(): void {
    this.scanLeft = 0;
    for (const id of this.markers) this.p.game.ui.marker(id, null);
    this.markers.length = 0;
  }
}
