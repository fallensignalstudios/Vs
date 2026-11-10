/**
 * Encounter devices. Every physical device is an Actor (targetable, destructible, tagged 'device' and
 * 'objective') wearing a creature-kit device visual: the E1 command emitter (synchronises drone volleys), the
 * E2 relay receivers and their networks, fixed scan heads, Weaver anchors and the E4 frost anchor. Moving scan
 * planes (Z03) are in scanplane.ts. Each device emits `device:disabled` once, however it went down.
 */
import * as THREE from 'three';
import type {
  Actor, ActorController, BeamHandle, DeviceHandle, DeviceKind, DeviceSystem, HitInfo, HitResult, LoopHandle,
  ScanPlaneHandle, Team, Vec3Like,
} from '@/core/api';
import { asCommandEmitter, asDevice, asFrostAnchor, asScanHead, RAY_SIGHT } from '@/core/api';
import { DEG, forwardX, forwardZ, wrapAngle, yawTo } from '@/core/mathx';
import type { AiCore } from './core';
import { ScanPlaneImpl, type ScanPlaneOpts } from './scanplane';
import { AI } from './tune';
import { caption, cooldownScale, fin, live, nowOf, physicsOf, playerActor, socketObject, socketPos, vec, warnOnce } from './util';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = { x: 0, y: 0, z: 0 };
const _ray = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, distance: 0, collider: null, ground: false } as import('@/core/api').RayHit;

/** Volley synchronisation of the drones wired to one command emitter. */
export class SyncGroup {
  desyncUntil = 0;
  broken = false;
  /** sim time of the next synchronised volley, and its running index */
  beatAt = 0;
  beatIndex = 0;
  /** members that fired on the current beat */
  fired = 0;
  constructor(readonly emitter: DeviceImpl, readonly drones: Actor[], private readonly clock: () => number) {}
  get synced(): boolean {
    return !this.broken && this.clock() >= this.desyncUntil;
  }
}

/** One relay network: its receivers, the drones it coordinates and its state. */
export class RelayNetwork {
  readonly receivers: DeviceImpl[] = [];
  readonly members: Actor[] = [];
  readonly beams = new Map<Actor, { beam: BeamHandle; from: DeviceImpl }>();
  interruptedUntil = 0;
  /** target every drone of the network fires at while it is up */
  sharedTarget: Actor | null = null;
  /** sim time the network went down for good (0 = it has not) */
  downAt = 0;
  constructor(readonly name: string) {}
  get down(): boolean {
    return this.receivers.length > 0 && this.receivers.every((r) => r.disabled);
  }
  /** 'up' | 'interrupted' | 'down' */
  state(now: number): 'up' | 'interrupted' | 'down' {
    return this.down ? 'down' : now < this.interruptedUntil ? 'interrupted' : 'up';
  }
}

interface ScanHeadState {
  yaw: number;
  arc: number;
  range: number;
  period: number;
  phase: number;
  rate: number;
  onDetect: (() => void) | undefined;
  beams: BeamHandle[];
  cooldownUntil: number;
  detections: number;
}

export class DeviceImpl implements DeviceHandle {
  disabled = false;
  readonly beams: BeamHandle[] = [];
  loop: LoopHandle | null = null;
  group: SyncGroup | null = null;
  network: RelayNetwork | null = null;
  scan: ScanHeadState | null = null;
  /** weaverAnchor: the Weaver working through it (the anchor withers once that Weaver is dead) */
  boundTo: Actor | null = null;
  /** frostAnchor: 0..1 ring brightness */
  glow = 0;
  removed = false;
  private readonly _pos = new THREE.Vector3();

  constructor(
    private readonly sys: DeviceSystemImpl,
    readonly id: string,
    readonly kind: DeviceKind,
    readonly actor: Actor,
  ) {}

  get pos(): Vec3Like {
    return socketPos(this.actor, 'core', this._pos);
  }

  disable(by: Actor | null = null): void {
    this.sys.takeDown(this, live(by) ? by : null, false);
  }

  /** scanHead only: multiply the sweep speed */
  setRate(mult: number): void {
    if (this.scan) this.scan.rate = Math.max(0, fin(mult, 1));
  }

  remove(): void {
    this.sys.removeDevice(this);
  }
}

class DeviceController implements ActorController {
  constructor(private readonly sys: DeviceSystemImpl, private readonly dev: () => DeviceImpl | null) {}
  update(): void {}
  onHit(_a: Actor, hit: HitInfo, res: HitResult): void {
    const d = this.dev();
    if (d && res.staggered) this.sys.staggered(d, hit.attacker);
  }
  onDeath(_a: Actor, killer: Actor | null): void {
    const d = this.dev();
    if (d) this.sys.takeDown(d, killer, true);
  }
}

const DEVICE_HP: Record<DeviceKind, number> = { commandEmitter: 80, relayReceiver: 70, scanHead: 60, weaverAnchor: 70, frostAnchor: 1 };
const DEVICE_POISE: Record<DeviceKind, number> = { commandEmitter: 25, relayReceiver: 30, scanHead: 20, weaverAnchor: 0, frostAnchor: 0 };

export class DeviceSystemImpl implements DeviceSystem {
  private readonly list: DeviceImpl[] = [];
  private readonly networks = new Map<string, RelayNetwork>();
  private readonly groups: SyncGroup[] = [];
  private readonly planes: ScanPlaneImpl[] = [];

  constructor(private readonly core: AiCore) {}

  get all(): readonly DeviceHandle[] {
    return this.list;
  }

  byId(id: string): DeviceHandle | null {
    return this.list.find((d) => d.id === id) ?? null;
  }

  // ---- construction ---------------------------------------------------------------------------------------

  private make(id: string, kind: DeviceKind, pos: Vec3Like, team: Team, opts: { yaw?: number; hp?: number; passive?: boolean; variant?: number } = {}): DeviceImpl {
    const game = this.core.game;
    const key = String(id ?? kind);
    if (this.list.some((d) => d.id === key)) warnOnce(`device:${key}`, `device id "${key}" is used twice — byId() returns the first`);
    const visual = game.chars.create(kind, { variant: opts.variant });
    const v = live(visual) ? visual : null;
    let dev: DeviceImpl | null = null;
    const p = vec(pos);
    const actor = game.actors.spawn({
      archetype: kind, name: key, team, pos: p, yaw: fin(opts.yaw, 0),
      hp: Math.max(1, fin(opts.hp, DEVICE_HP[kind])), poise: DEVICE_POISE[kind],
      // a passive floor device (the frost anchor) is stood ON: it must not shove bodies off itself
      radius: opts.passive ? 0.05 : Math.max(0.35, fin(v?.radius, 0.6)), height: Math.max(0.6, fin(v?.height, 1.8)),
      visual: v, fixed: true, corpseSeconds: Infinity, dissolveOnDeath: false,
      targetable: !opts.passive, invulnerable: opts.passive === true,
      material: kind === 'weaverAnchor' ? 'eclipse' : 'metal',
      tags: opts.passive ? ['device'] : ['device', 'objective', 'source', kind],
      controller: new DeviceController(this, () => dev),
    });
    dev = new DeviceImpl(this, key, kind, actor);
    this.list.push(dev);
    return dev;
  }

  commandEmitter(opts: { id: string; pos: Vec3Like; drones: Actor[]; hp?: number }): DeviceHandle {
    const game = this.core.game;
    const drones = (Array.isArray(opts?.drones) ? opts.drones : []).filter((d) => live(d));
    const team = drones[0]?.team ?? 'reformation';
    const dev = this.make(opts?.id, 'commandEmitter', opts?.pos, team, { hp: opts?.hp });
    const group = new SyncGroup(dev, drones, () => nowOf(game));
    group.beatAt = nowOf(game) + 2.2;
    dev.group = group;
    this.groups.push(group);
    const core = socketObject(dev.actor, 'core');
    for (const d of drones) {
      const to = socketObject(d, 'core');
      dev.beams.push(game.vfx.beam(core ?? dev.actor.aimPoint(_a).clone(), to ?? d.aimPoint(_b).clone(), 'command'));
    }
    dev.loop = game.audio.loop('emitterHum', { pos: dev.actor.pos });
    return dev;
  }

  relayReceiver(opts: { id: string; pos: Vec3Like; network: string; hp?: number }): DeviceHandle {
    const net = this.net(String(opts?.network ?? 'default'));
    const dev = this.make(opts?.id, 'relayReceiver', opts?.pos, 'contaminated', { hp: opts?.hp, variant: net.receivers.length % 2 });
    dev.network = net;
    net.receivers.push(dev);
    dev.loop = this.core.game.audio.loop('relayHum', { pos: dev.actor.pos });
    return dev;
  }

  private net(name: string): RelayNetwork {
    let n = this.networks.get(name);
    if (!n) {
      n = new RelayNetwork(name);
      this.networks.set(name, n);
    }
    return n;
  }

  network(name: string): RelayNetwork {
    return this.net(String(name));
  }

  /** the network a contaminated drone should join: the named one, else the only one there is */
  networkFor(name: string | undefined): RelayNetwork | null {
    if (name) return this.net(name);
    if (this.networks.size === 1) return this.networks.values().next().value ?? null;
    return null;
  }

  join(net: RelayNetwork, drone: Actor): void {
    if (net.members.indexOf(drone) < 0) net.members.push(drone);
  }

  scanHead(opts: { id: string; pos: Vec3Like; yaw: number; arcDeg: number; range: number; period: number; onDetect?: () => void }): DeviceHandle {
    const dev = this.make(opts?.id, 'scanHead', opts?.pos, 'reformation', { yaw: opts?.yaw });
    dev.scan = {
      yaw: fin(opts?.yaw, 0), arc: Math.max(0, fin(opts?.arcDeg, 90)) * DEG, range: Math.max(1, fin(opts?.range, 20)),
      period: Math.max(0.5, fin(opts?.period, 6)), phase: 0, rate: 1,
      onDetect: typeof opts?.onDetect === 'function' ? opts.onDetect : undefined,
      beams: [], cooldownUntil: 0, detections: 0,
    };
    const game = this.core.game;
    for (let i = 0; i < 2; i++) dev.scan.beams.push(game.vfx.beam(dev.actor.aimPoint(_a).clone(), dev.actor.aimPoint(_b).clone(), 'scan', { color: 0xffa033 }));
    dev.loop = game.audio.loop('scanSweep', { pos: dev.actor.pos, volume: 0.7 });
    return dev;
  }

  scanPlane(opts: ScanPlaneOpts): ScanPlaneHandle {
    const plane = new ScanPlaneImpl(this.core, opts, (p) => {
      const i = this.planes.indexOf(p);
      if (i >= 0) this.planes.splice(i, 1);
    });
    this.planes.push(plane);
    return plane;
  }

  frostAnchor(opts: { id: string; pos: Vec3Like }): DeviceHandle {
    return this.make(opts?.id, 'frostAnchor', opts?.pos, 'neutral', { passive: true });
  }

  weaverAnchor(opts: { id: string; pos: Vec3Like; yaw?: number; hp?: number }): DeviceHandle {
    return this.make(opts?.id, 'weaverAnchor', opts?.pos, 'eclipse', { yaw: opts?.yaw, hp: opts?.hp });
  }

  /** nearest living Weaver anchor within `range` of a point */
  anchorNear(pos: Vec3Like, range: number): Actor | null {
    let best: Actor | null = null;
    let bestD = range;
    for (const d of this.list) {
      if (d.kind !== 'weaverAnchor' || d.disabled || !d.actor.alive) continue;
      const dist = d.actor.distanceTo(pos);
      if (dist <= bestD) {
        bestD = dist;
        best = d.actor;
      }
    }
    return best;
  }

  /** a Weaver has started working through this anchor */
  bindAnchor(anchor: Actor, weaver: Actor): void {
    const d = this.list.find((x) => x.actor === anchor);
    if (d && !d.boundTo) d.boundTo = weaver;
  }

  // ---- state changes ----------------------------------------------------------------------------------------

  groupOf(drone: Actor): SyncGroup | null {
    for (const g of this.groups) if (g.drones.indexOf(drone) >= 0) return g;
    return null;
  }

  syncOf(drone: Actor): { readonly synced: boolean; readonly broken: boolean; readonly emitter: DeviceHandle } | null {
    return this.groupOf(drone);
  }

  /** the device was staggered: a command emitter loses synchronisation for a while */
  staggered(dev: DeviceImpl, _by: Actor | null): void {
    const g = dev.group;
    if (!g || g.broken) return;
    const game = this.core.game;
    g.desyncUntil = nowOf(game) + AI.drone.desync;
    caption(game, 'Emitter staggered — volleys out of step', 'alert', dev.pos);
    for (const b of dev.beams) b.setIntensity(0.15);
  }

  /** destroyed (through the damage path) or disabled (close interaction): same consequences, once */
  takeDown(dev: DeviceImpl, by: Actor | null, destroyed: boolean): void {
    if (dev.disabled || dev.removed) return;
    if (dev.kind === 'frostAnchor') return;
    const game = this.core.game;
    dev.disabled = true;
    const a = dev.actor;
    if (!destroyed) {
      // powered down in place: no longer a target, still an object in the room
      asDevice(a.visual)?.setDisabled(true);
      a.targetable = false;
      a.tags.delete('objective');
      game.vfx.spawn('deviceBreak', dev.pos, { scale: 0.6 });
    } else {
      game.vfx.spawn('deviceBreak', dev.pos, dev.kind === 'weaverAnchor' ? { color: 0x7a3cff } : undefined);
    }
    for (const b of dev.beams) b.remove(0.2);
    dev.beams.length = 0;
    dev.loop?.stop(0.2);
    dev.loop = null;
    if (dev.scan) {
      for (const b of dev.scan.beams) b.remove(0.2);
      dev.scan.beams.length = 0;
    }
    if (dev.group) {
      dev.group.broken = true;
      game.audio.play('emitterBreak', { pos: a.pos });
      caption(game, 'Command emitter down — lanes desynchronised', 'alert', dev.pos);
    }
    const net = dev.network;
    if (net) {
      const now = nowOf(game);
      for (const [drone, link] of net.beams) {
        if (link.from !== dev) continue;
        link.beam.remove(0.2);
        net.beams.delete(drone);
      }
      if (net.down) {
        net.downAt = now;
        game.audio.play('networkDown', { pos: a.pos });
        caption(game, 'Relay network down', 'alert', dev.pos);
      } else {
        net.interruptedUntil = now + AI.drone.interrupted;
        game.audio.play('relayDown', { pos: a.pos });
        caption(game, 'Relay down — scanning interrupted', 'scan', dev.pos);
      }
    }
    if (dev.kind === 'weaverAnchor' && !destroyed) {
      // a disabled anchor releases its links exactly like a destroyed one
      this.core.links.severAllFrom(a, by);
    }
    game.events.emit('device:disabled', { id: dev.id, kind: dev.kind, by });
  }

  removeDevice(dev: DeviceImpl): void {
    if (dev.removed) return;
    dev.removed = true;
    for (const b of dev.beams) b.remove(0);
    dev.beams.length = 0;
    if (dev.scan) for (const b of dev.scan.beams) b.remove(0);
    dev.loop?.stop(0);
    dev.loop = null;
    if (dev.group) {
      dev.group.broken = true;
      const gi = this.groups.indexOf(dev.group);
      if (gi >= 0) this.groups.splice(gi, 1);
    }
    if (dev.network) {
      const ri = dev.network.receivers.indexOf(dev);
      if (ri >= 0) dev.network.receivers.splice(ri, 1);
    }
    this.core.game.actors.despawn(dev.actor);
    const i = this.list.indexOf(dev);
    if (i >= 0) this.list.splice(i, 1);
  }

  // ---- tick -------------------------------------------------------------------------------------------------

  update(dt: number): void {
    const game = this.core.game;
    const now = nowOf(game);

    for (const g of this.groups) {
      const em = asCommandEmitter(g.emitter.actor.visual);
      for (let i = 0; i < g.drones.length && i < 2; i++) {
        const d = g.drones[i] as Actor;
        em?.setProngTarget(i, d.alive && !g.broken ? d.pos : null);
      }
      if (g.broken) continue;
      // a drone that died leaves the emitter's beam dark
      for (let i = 0; i < g.drones.length; i++) {
        const d = g.drones[i] as Actor;
        const beam = g.emitter.beams[i];
        if (beam && beam.alive) beam.setIntensity(!d.alive ? 0 : g.synced ? 0.9 : 0.15);
      }
      if (!g.synced) {
        // re-arm the shared beat for when synchronisation returns
        g.beatAt = Math.max(g.beatAt, g.desyncUntil + 1.4);
        continue;
      }
      // the beat has been offered to every member this tick or earlier: schedule the next one
      if (now >= g.beatAt + 0.3) {
        if (g.fired >= 2) {
          this.core.stats.syncVolleys++;
          em?.pulseSync(1);
        }
        g.beatAt = now + AI.drone.syncPeriod * cooldownScale(game);
        g.beatIndex++;
        g.fired = 0;
      }
    }

    // an anchor whose Weaver is dead has nothing left to hold: it withers instead of lingering as a target
    for (const d of this.list) {
      if (d.kind === 'weaverAnchor' && !d.disabled && d.boundTo && !d.boundTo.alive && d.actor.alive) game.actors.kill(d.actor, null);
    }
    for (const net of this.networks.values()) this.updateNetwork(net, now);
    for (const d of this.list) {
      if (d.scan && !d.disabled) this.updateScanHead(d, d.scan, dt, now);
      if (d.kind === 'frostAnchor') {
        // the ring lights while an ally stands on the anchor
        const on = game.actors.nearest(d.actor.pos, 1.1, (o) => o.team === 'player' && o !== d.actor) !== null;
        d.glow += ((on ? 1 : 0) - d.glow) * (1 - Math.exp(-4 * dt));
        asFrostAnchor(d.actor.visual)?.setActive(d.glow);
      }
    }
    for (let i = this.planes.length - 1; i >= 0; i--) (this.planes[i] as ScanPlaneImpl).update(dt);
  }

  private updateNetwork(net: RelayNetwork, now: number): void {
    const game = this.core.game;
    for (let i = net.members.length - 1; i >= 0; i--) {
      const m = net.members[i] as Actor;
      if (m.alive) continue;
      net.members.splice(i, 1);
      net.beams.get(m)?.beam.remove(0.2);
      net.beams.delete(m);
    }
    const up = net.state(now) === 'up';
    for (const m of net.members) {
      const cur = net.beams.get(m);
      if (!up) {
        if (cur) {
          cur.beam.remove(0.3);
          net.beams.delete(m);
        }
        continue;
      }
      if (cur && !cur.from.disabled) continue;
      // a visible relay beam from the nearest working receiver shows who coordinates this drone
      let best: DeviceImpl | null = null;
      let bestD = Infinity;
      for (const r of net.receivers) {
        if (r.disabled) continue;
        const d = r.actor.distanceTo(m);
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
      if (!best) continue;
      const from = socketObject(best.actor, 'core');
      const to = socketObject(m, 'core');
      const beam = game.vfx.beam(from ?? best.actor.aimPoint(_a).clone(), to ?? m.aimPoint(_b).clone(), 'relay', { color: 0x9a6cff });
      beam.setIntensity(0.6);
      net.beams.set(m, { beam, from: best });
    }
    if (net.sharedTarget && !net.sharedTarget.alive) net.sharedTarget = null;
  }

  private updateScanHead(dev: DeviceImpl, s: ScanHeadState, dt: number, now: number): void {
    const game = this.core.game;
    const a = dev.actor;
    s.phase += (dt * s.rate) / s.period;
    const sweep = Math.sin(s.phase * Math.PI * 2) * s.arc * 0.5;
    const yaw = s.yaw + sweep;
    asScanHead(a.visual)?.setSweep(sweep);
    const eye = socketPos(a, 'eye', _a);
    const physics = physicsOf(game);
    const half = 7 * DEG;
    for (let i = 0; i < s.beams.length; i++) {
      const y = yaw + (i === 0 ? -half : half);
      _dir.x = forwardX(y);
      _dir.y = -Math.min(0.5, (eye.y - a.pos.y - 0.3) / s.range);
      _dir.z = forwardZ(y);
      let len = s.range;
      if (physics) {
        const h = physics.raycast(eye, _dir, s.range, RAY_SIGHT, _ray);
        if (h) len = Math.max(0.2, h.distance);
      }
      _b.set(eye.x + _dir.x * len, eye.y + _dir.y * len, eye.z + _dir.z * len);
      (s.beams[i] as BeamHandle).setEnds(eye, _b);
    }
    const player = playerActor(game);
    if (!player || now < s.cooldownUntil) return;
    const chest = player.aimPoint(_b);
    const dist = Math.hypot(chest.x - eye.x, chest.z - eye.z);
    if (dist > s.range) return;
    const off = Math.abs(wrapAngle(yawTo(eye.x, eye.z, chest.x, chest.z) - yaw));
    if (off > half + Math.asin(Math.min(1, player.radius / Math.max(0.5, dist)))) return;
    if (physics && !physics.lineOfSight(eye, chest)) return;
    s.cooldownUntil = now + 3;
    s.detections++;
    this.core.stats.detections++;
    game.audio.play('scanDetect', { pos: eye });
    caption(game, 'Scanner contact', 'scan', a.pos);
    game.events.emit('scan:detected', { source: dev.id });
    const cb = s.onDetect;
    if (cb) {
      try {
        cb();
      } catch (err) {
        warnOnce(`scan:${dev.id}`, `scanHead "${dev.id}" onDetect threw: ${String(err)}`);
      }
    }
  }

  clear(): void {
    for (const d of this.list.slice()) this.removeDevice(d);
    this.list.length = 0;
    for (const net of this.networks.values()) for (const b of net.beams.values()) b.beam.remove(0);
    this.networks.clear();
    this.groups.length = 0;
    for (const p of this.planes.slice()) p.remove();
    this.planes.length = 0;
  }
}
