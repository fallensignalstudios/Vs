/**
 * Security drone (and its contaminated variant). Holds a firing lane from its post, slides sideways to keep a
 * line of fire, backs off when crowded. Attack: a laser lane telegraph (tracks, then LOCKS), a three-bolt
 * volley along the locked lane, then the rear vent stands open for a moment.
 *   secDrone     volleys synchronised with a partner through a command emitter (devices.ts SyncGroup)
 *   contamDrone  coordinated by a relay network: shared target and scan sweep while it is up, stunned drift
 *                when a receiver falls, sluggish and inaccurate (then self-disabling) when the network is down
 */
import * as THREE from 'three';
import type { Actor, BeamHandle, LoopHandle, SpawnOpts, VfxHandle } from '@/core/api';
import { asCommandEmitter, asDrone, RAY_SHOT } from '@/core/api';
import { TUNING } from '@/combat/tuning';
import { Brain } from '../brain';
import type { AiCore } from '../core';
import type { RelayNetwork } from '../devices';
import { AI } from '../tune';
import { caption, cooldownScale, fin, physicsOf, socketObject, socketPos } from '../util';

type State = 'hold' | 'telegraph' | 'volley' | 'vent';

const VIOLET = 0x9a5cff;
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cand = new THREE.Vector3();
const _ray = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 0, collider: null, ground: false } as import('@/core/api').RayHit;
const OFFSETS = [0, 1, -1, 2, -2];

export class DroneBrain extends Brain {
  private state: State = 'hold';
  private cooldown: number;
  private laser: BeamHandle | null = null;
  private charge: VfxHandle | null = null;
  private hum: LoopHandle | null = null;
  private scanBeam: BeamHandle | null = null;
  /** locked firing line */
  private readonly aimDir = new THREE.Vector3(0, 0, -1);
  private locked = false;
  private readonly goal = new THREE.Vector3();
  private slideAt = 0;
  private slideOffset = 0;
  private ventLeft = 0;
  private lastSyncBeat = -1;
  /** this volley began on a shared beat */
  private syncedVolley = false;
  private volleyT = 0;
  private volleyIdx = 0;
  private volleyTimes: number[] = [0.06, 0.3, 0.54];
  private volleyEnd = 0.9;
  private readonly contaminated: boolean;
  private net: RelayNetwork | null = null;
  private netState: 'up' | 'interrupted' | 'down' = 'up';
  private downFor = 0;
  private wasSynced = true;
  private driftYaw = 0;

  constructor(core: AiCore, role: 'secDrone' | 'contamDrone', opts: SpawnOpts) {
    super(core, role, opts);
    this.contaminated = role === 'contamDrone';
    this.cooldown = this.rand(1.2, 2.6);
    this.goal.copy(this.post);
  }

  private get stat() {
    return this.contaminated ? TUNING.enemies.contamDrone : TUNING.enemies.secDrone;
  }

  protected override onActive(a: Actor): void {
    asDrone(a.visual)?.setHoverHeight(a.hoverHeight);
    this.hum = this.game.audio.loop('droneHum', { pos: a.pos, pitch: this.contaminated ? 0.82 : 1 });
    if (this.contaminated) {
      this.net = this.core.devices.networkFor(this.opts.network);
      if (this.net) this.core.devices.join(this.net, a);
    }
  }

  override wake(): void {
    if (this.dormant) this.game.audio.play('droneAlert');
    super.wake();
  }

  protected override cleanup(a: Actor): void {
    this.hum?.stop(0.2);
    this.hum = null;
    this.scanBeam?.remove(0.1);
    this.scanBeam = null;
    this.closeVent(a);
  }

  protected override onAttackCancelled(_a: Actor): void {
    this.laser?.remove(0.08);
    this.laser = null;
    this.charge?.stop();
    this.charge = null;
    if (this.state === 'telegraph' || this.state === 'volley') {
      this.state = 'hold';
      this.cooldown = Math.max(this.cooldown, 0.9);
    }
    this.locked = false;
  }

  protected override onInterrupted(a: Actor): void {
    this.closeVent(a);
    this.state = 'hold';
  }

  private closeVent(a: Actor): void {
    const wp = a.weakPoints.find((w) => w.id === 'vent');
    if (wp) wp.exposed = false;
    a.visual?.setExposed('vent', 0);
    this.ventLeft = 0;
  }

  // ---- movement ---------------------------------------------------------------------------------------------

  private hasFire(from: THREE.Vector3, target: Actor): boolean {
    const physics = physicsOf(this.game);
    if (!physics) return true;
    return physics.lineOfFire(from, target.aimPoint(_aim));
  }

  /** choose where on the lane to hover: the nearest lateral offset with a clear firing line */
  private planSlide(a: Actor, t: Actor): void {
    const D = AI.drone;
    let ax = t.pos.x - this.post.x;
    let az = t.pos.z - this.post.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    const px = -az;
    const pz = ax;
    let chosen = this.slideOffset;
    let found = false;
    for (const o of OFFSETS) {
      // try the current offset first, then its neighbours
      const off = Math.max(-D.slide, Math.min(D.slide, this.slideOffset + o * (D.slide / 2)));
      _cand.set(this.post.x + px * off, a.pos.y, this.post.z + pz * off);
      if (this.hasFire(_cand, t)) {
        chosen = off;
        found = true;
        break;
      }
    }
    if (!found) chosen = 0;
    this.slideOffset = chosen;
    this.goal.set(this.post.x + px * chosen, a.pos.y, this.post.z + pz * chosen);
    // crowded: give ground along the lane, away from whoever closed in
    const close = a.distanceTo(t);
    if (close < D.retreatWithin) {
      const back = D.retreatBy * (1 - close / D.retreatWithin) + 1.2;
      this.goal.x -= ax * back;
      this.goal.z -= az * back;
    }
  }

  private fly(a: Actor, speedScale: number): void {
    const dx = this.goal.x - a.pos.x;
    const dz = this.goal.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return;
    const v = Math.min(AI.drone.speed * speedScale, d * 3 + 0.4);
    a.desiredVel.set((dx / d) * v, 0, (dz / d) * v);
    this.hum?.setPitch((this.contaminated ? 0.82 : 1) * (1 + Math.min(0.25, v * 0.05)));
  }

  // ---- brain --------------------------------------------------------------------------------------------------

  protected override idle(a: Actor, _dt: number): void {
    this.hum?.setPosition(a.pos);
  }

  protected override calm(a: Actor, dt: number): void {
    this.hum?.setPosition(a.pos);
    this.goal.set(this.post.x, a.pos.y, this.post.z);
    this.fly(a, 0.6);
  }

  protected think(a: Actor, dt: number): void {
    const D = AI.drone;
    const now = this.now;
    this.hum?.setPosition(a.pos);

    // contaminated: the relay network decides how capable this drone is
    let speedScale = 1;
    let gapScale = 1;
    let spread = 0.5 * (Math.PI / 180);
    if (this.net) {
      const st = this.net.state(now);
      if (st !== this.netState) {
        this.netState = st;
        if (st === 'interrupted') {
          this.cancelAttack(a);
          a.visual?.play('stagger');
          this.driftYaw = this.rand(0, Math.PI * 2);
        }
        if (st !== 'up') {
          this.scanBeam?.remove(0.2);
          this.scanBeam = null;
          a.visual?.stop('scan');
        }
      }
      if (st === 'interrupted') {
        // stunned drift: no fire, no purpose
        a.desiredVel.set(Math.cos(this.driftYaw) * 0.5, 0, Math.sin(this.driftYaw) * 0.5);
        a.yaw += dt * 1.6;
        return;
      }
      if (st === 'down') {
        this.downFor += dt;
        if (this.downFor >= D.downSelfDisable) {
          caption(this.game, 'Contaminated drone powers down', 'alert', a.pos);
          this.game.actors.kill(a, null);
          return;
        }
        speedScale = D.downSpeed;
        gapScale = D.downGap;
        spread = D.downSpread;
      } else {
        // network up: every drone on it works the same target
        const lead = this.net.members[0];
        if (lead === a) this.net.sharedTarget = this.target;
        else if (this.net.sharedTarget && this.validTarget(a, this.net.sharedTarget)) this.target = this.net.sharedTarget;
      }
    }

    const t = this.target;
    if (!this.validTarget(a, t)) {
      if (this.state !== 'hold' && this.state !== 'vent') this.cancelAttack(a);
      this.goal.set(this.post.x, a.pos.y, this.post.z);
      this.fly(a, 0.6);
      return;
    }

    const group = this.contaminated ? null : this.core.devices.groupOf(a);
    const synced = !!group && group.synced;
    if (group && this.wasSynced !== synced) {
      this.wasSynced = synced;
      // out of step: each drone falls back on its own, visibly different, clock
      if (!synced) this.cooldown = this.rand(0.4, 2.6);
    }

    if (this.state === 'hold' || this.state === 'vent') {
      if (now >= this.slideAt) {
        this.slideAt = now + 0.45;
        this.planSlide(a, t);
      }
      this.fly(a, speedScale);
      a.face(t.pos, D.turn * speedScale * dt);
    }
    a.visual?.lookAt(this.state === 'hold' ? t.aimPoint(_aim) : null);

    switch (this.state) {
      case 'hold': {
        this.cooldown -= dt;
        this.updateScanSweep(a, t);
        const inRange = a.distanceTo(t) <= D.range;
        let start = false;
        if (synced && group) {
          if (now >= group.beatAt && this.lastSyncBeat !== group.beatIndex) {
            this.lastSyncBeat = group.beatIndex;
            start = inRange && this.hasFire(socketPos(a, 'muzzle', _from), t);
            if (start) {
              group.fired++;
              this.syncedVolley = true;
            }
          }
        } else if (this.cooldown <= 0 && inRange && this.hasFire(socketPos(a, 'muzzle', _from), t)) {
          start = true;
          this.syncedVolley = false;
        }
        if (start) this.startTelegraph(a, t);
        break;
      }
      case 'telegraph': {
        const k = 1 - this.teleLeft / this.teleTotal;
        if (!this.locked) {
          // the lane follows its target at first …
          socketPos(a, 'muzzle', _from);
          this.aimDir.copy(t.aimPoint(_aim)).sub(_from).normalize();
          a.face(t.pos, D.turn * dt);
          if (k >= D.trackFraction) {
            // … then commits: from here the line does not move
            this.locked = true;
            this.laser?.setIntensity(1);
            this.announce(a, 'laneLock', 0, t);
          }
        }
        this.placeLaser(a);
        if (this.tickTelegraph(a, dt)) {
          this.endTelegraph(a);
          this.laser?.remove(0.12);
          this.laser = null;
          this.charge = null;
          this.state = 'volley';
          this.volleyT = 0;
          this.volleyIdx = 0;
          const info = a.visual?.play('volley');
          const times = info?.hitTimes;
          this.volleyTimes = Array.isArray(times) && times.length >= this.stat.volley ? times.slice(0, this.stat.volley) : [0.06, 0.3, 0.54];
          this.volleyEnd = Math.max(fin(info?.duration, 0.9), (this.volleyTimes[this.volleyTimes.length - 1] ?? 0.54) + 0.1);
          this.game.audio.play('droneVolley', { pos: a.pos });
          this.core.stats.volleys++;
          if (this.syncedVolley && group) asCommandEmitter(group.emitter.actor.visual)?.pulseSync(1);
        }
        break;
      }
      case 'volley': {
        this.volleyT += dt;
        while (this.volleyIdx < this.volleyTimes.length && this.volleyT >= (this.volleyTimes[this.volleyIdx] as number)) {
          this.volleyIdx++;
          this.fireBolt(a, spread);
        }
        if (this.volleyT >= this.volleyEnd) {
          // the rear vent opens after every volley: the answer to a drone is its back
          this.state = 'vent';
          this.ventLeft = D.ventSeconds;
          const wp = a.weakPoints.find((w) => w.id === 'vent');
          if (wp) wp.exposed = true;
          a.visual?.setExposed('vent', 1);
          this.locked = false;
        }
        break;
      }
      case 'vent': {
        this.ventLeft -= dt;
        if (this.ventLeft <= 0) {
          this.closeVent(a);
          this.state = 'hold';
          const broken = !!group && group.broken;
          this.cooldown = this.rand(D.cooldown[0], D.cooldown[1]) * cooldownScale(this.game) * (broken ? D.brokenGap : 1) * gapScale;
        }
        break;
      }
    }
  }

  private startTelegraph(a: Actor, t: Actor): void {
    const seconds = this.teleTime(this.stat.telegraph);
    this.state = 'telegraph';
    this.locked = false;
    this.beginTelegraph(a, seconds, this.contaminated ? VIOLET : 0xff5a3a, 'lane', t);
    socketPos(a, 'muzzle', _from);
    this.aimDir.copy(t.aimPoint(_aim)).sub(_from).normalize();
    this.laser = this.game.vfx.beam(_from.clone(), _aim.clone(), 'laser', this.contaminated ? { color: VIOLET } : undefined);
    this.laser.setIntensity(0.45);
    const muzzle = socketObject(a, 'muzzle');
    this.charge = this.game.vfx.spawn('droneCharge', _from, {
      duration: seconds, attachTo: muzzle ?? undefined, color: this.contaminated ? VIOLET : undefined,
    });
    this.game.audio.play('droneCharge', { pos: a.pos, pitch: this.contaminated ? 0.85 : 1 });
    this.scanBeam?.remove(0.1);
    this.scanBeam = null;
    this.placeLaser(a);
  }

  /** the lane telegraph: muzzle → where the locked line ends (first solid, or range) */
  private placeLaser(a: Actor): void {
    if (!this.laser) return;
    socketPos(a, 'muzzle', _from);
    let len: number = AI.drone.range;
    const physics = physicsOf(this.game);
    if (physics) {
      const h = physics.raycast(_from, this.aimDir, len, RAY_SHOT, _ray);
      if (h) len = Math.max(0.3, h.distance);
    }
    _to.copy(_from).addScaledVector(this.aimDir, len);
    this.laser.setEnds(_from, _to);
  }

  private fireBolt(a: Actor, spread: number): void {
    socketPos(a, 'muzzle', _from);
    _dir.copy(this.aimDir);
    if (spread > 0) {
      // small committed scatter around the locked line
      _dir.x += this.rand(-spread, spread);
      _dir.y += this.rand(-spread, spread) * 0.6;
      _dir.z += this.rand(-spread, spread);
    }
    const s = this.stat;
    this.core.projectiles.fire({
      owner: a, from: _from, dir: _dir, speed: s.boltSpeed, range: AI.drone.range + 6, damage: s.boltDamage,
      poise: AI.drone.boltPoise, element: this.contaminated ? 'violet' : 'shock', style: this.contaminated ? 'violet' : 'drone',
    });
    this.core.stats.boltsFired++;
    this.game.audio.play('droneBolt', { pos: a.pos });
  }

  /** contaminated drones on a live network sweep a scan beam round their shared target */
  private updateScanSweep(a: Actor, t: Actor): void {
    if (!this.net || this.netState !== 'up') return;
    const eye = socketPos(a, 'eye', _from);
    const ang = this.now * 2.4 + a.id;
    _to.set(t.pos.x + Math.cos(ang) * 2.2, t.pos.y + 0.05, t.pos.z + Math.sin(ang) * 2.2);
    if (!this.scanBeam) {
      this.scanBeam = this.game.vfx.beam(eye.clone(), _to.clone(), 'scan', { color: VIOLET });
      this.scanBeam.setIntensity(0.5);
      a.visual?.play('scan', { loop: true });
    }
    this.scanBeam.setEnds(eye, _to);
  }
}
