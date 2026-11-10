/**
 * The Eclipse link system: visible links from a source (a Weaver, or any body) to a target. A linked target
 * resists individual disruption and moves on the shared cadence; a link feeding the elite regenerates it.
 * Links are cut by striking the line (`hitTest` → `sever`), by killing the source or the target, or by
 * destroying the link's physical anchor.
 */
import * as THREE from 'three';
import type { Actor, BeamHandle, LinkHandle, LinkSystem, LoopHandle, Vec3Like } from '@/core/api';
import { asWeaver } from '@/core/api';
import { TUNING } from '@/combat/tuning';
import type { AiCore } from './core';
import { AI } from './tune';
import { fin, live, nowOf, playerActor, segSegDistance, socketObject, socketPos } from './util';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();

class LinkImpl implements LinkHandle {
  alive = true;
  beam: BeamHandle | null = null;
  hum: LoopHandle | null = null;
  /** arm of the Weaver's visual that points along this link (-1 = none) */
  arm = -1;
  /** the beam follows two socket objects by itself (otherwise update() moves its ends) */
  followed = false;
  constructor(
    readonly id: number,
    readonly source: Actor,
    readonly target: Actor,
    readonly anchor: Actor | null,
    /** hp/s this link feeds its target (the elite) */
    readonly regen: number,
  ) {}

  /** world ends of the visible line */
  ends(a: THREE.Vector3, b: THREE.Vector3): void {
    socketPos(this.source, 'core', a);
    socketPos(this.target, 'core', b);
  }

  midpoint(out: THREE.Vector3): THREE.Vector3 {
    this.ends(_a, _b);
    return out.copy(_a).add(_b).multiplyScalar(0.5);
  }
}

export class LinkSystemImpl implements LinkSystem {
  private readonly list: LinkImpl[] = [];
  private nextId = 1;
  private lastBeat = -1;
  /** sim time of the most recent sever (the freed bodies' cadence turns irregular) */
  lastSeverAt = -1e9;
  private offDied: (() => void) | null = null;

  readonly cadence = {
    period: AI.cadence.period as number,
    phase: (): number => {
      const p = nowOf(this.core.game) / this.cadence.period;
      return p - Math.floor(p);
    },
    timeToBeat: (): number => {
      const t = nowOf(this.core.game);
      const p = this.cadence.period;
      return p - (t - Math.floor(t / p) * p);
    },
  };

  constructor(private readonly core: AiCore) {
    this.offDied = core.game.events.on('actor:died', ({ actor, killer }) => this.onDeath(actor, killer));
  }

  get all(): readonly LinkHandle[] {
    return this.list;
  }

  /** index of the current beat (changes exactly on the beat) */
  beatIndex(): number {
    return Math.floor(nowOf(this.core.game) / this.cadence.period);
  }

  create(source: Actor, target: Actor, opts?: { anchor?: Actor | null; regen?: number }): LinkHandle {
    const game = this.core.game;
    const ok = live(source) && live(target) && source.alive && target.alive && source !== target;
    const existing = ok ? this.list.find((l) => l.alive && l.source === source && l.target === target) : undefined;
    if (existing) return existing;
    const anchor = live(opts?.anchor) && opts?.anchor?.alive ? opts.anchor : null;
    const isElite = ok && String(target.archetype) === 'elite';
    const regen = Math.max(0, fin(opts?.regen, isElite ? TUNING.enemies.elite.regen : 0));
    const link = new LinkImpl(this.nextId++, source, target, anchor, regen);
    if (!ok) {
      // a dead handle: callers can hold it safely, nothing was linked
      link.alive = false;
      return link;
    }
    const from = socketObject(source, 'core');
    const to = socketObject(target, 'core');
    link.followed = !!from && !!to;
    link.beam = game.vfx.beam(from ?? source.aimPoint(_a).clone(), to ?? target.aimPoint(_b).clone(), 'link');
    link.hum = game.audio.loop('linkHum', { pos: link.midpoint(_mid), volume: 0.8 });
    const weaver = asWeaver(source.visual);
    if (weaver) {
      const used = new Set(this.list.filter((l) => l.alive && l.source === source).map((l) => l.arm));
      for (let i = 0; i < TUNING.enemies.weaver.maxLinks; i++) {
        if (!used.has(i)) {
          link.arm = i;
          break;
        }
      }
    }
    this.list.push(link);
    this.applyState(target);
    this.core.stats.linksCreated++;
    game.events.emit('link:created', { link });
    return link;
  }

  sever(link: LinkHandle, by: Actor | null = null): void {
    this.cut(link as LinkImpl, live(by) ? by : null, true);
  }

  severAllFrom(source: Actor, by: Actor | null = null): void {
    for (const l of this.list.slice()) if (l.alive && (l.source === source || l.anchor === source)) this.cut(l, live(by) ? by : null, true);
  }

  linksOf(actor: Actor): LinkHandle[] {
    return this.list.filter((l) => l.alive && (l.source === actor || l.target === actor || l.anchor === actor));
  }

  /** living links whose TARGET is `actor` */
  feeding(actor: Actor): number {
    let n = 0;
    for (const l of this.list) if (l.alive && l.target === actor) n++;
    return n;
  }

  /** living links whose SOURCE is `actor` */
  countFrom(actor: Actor): number {
    let n = 0;
    for (const l of this.list) if (l.alive && l.source === actor) n++;
    return n;
  }

  hitTest(from: Vec3Like, to: Vec3Like, radius: number): LinkHandle | null {
    if (!from || !to) return null;
    const r = Math.max(0, fin(radius, 0.3));
    for (const l of this.list) {
      if (!l.alive) continue;
      l.ends(_a, _b);
      if (segSegDistance(from, to, _a, _b) <= r) return l;
    }
    return null;
  }

  private cut(link: LinkImpl, by: Actor | null, payEcho: boolean): void {
    if (!link || !link.alive) return;
    const game = this.core.game;
    link.alive = false;
    link.ends(_a, _b);
    _mid.copy(_a).add(_b).multiplyScalar(0.5);
    _dir.copy(_b).sub(_a);
    if (_dir.lengthSq() > 1e-8) _dir.normalize();
    else _dir.set(0, 1, 0);
    link.beam?.remove(0.18);
    link.beam = null;
    link.hum?.stop(0.15);
    link.hum = null;
    if (link.arm >= 0) asWeaver(link.source.visual)?.setLinkTarget(link.arm, null);
    game.vfx.spawn('linkSever', _mid, { dir: _dir });
    game.audio.play('linkSever', { pos: _mid });
    const i = this.list.indexOf(link);
    if (i >= 0) this.list.splice(i, 1);
    this.lastSeverAt = nowOf(game);
    this.core.stats.linksSevered++;
    this.applyState(link.target);
    const player = playerActor(game);
    if (payEcho && by && by === player && live(game.player)) game.player.addEcho(25, 'sever');
    // `link:severed` also drives the audio stinger and the score's cadence turning irregular
    game.events.emit('link:severed', { link, by });
    this.core.brainOf(link.target)?.onLinkSevered(link.target, link, by);
    if (link.source.alive) this.core.brainOf(link.source)?.onLinkLost(link.source, link, by);
  }

  /** resist scales, `linked` and link-fed regeneration follow the number of living links on a body */
  private applyState(target: Actor): void {
    if (!live(target)) return;
    let n = 0;
    let regen = 0;
    for (const l of this.list) {
      if (!l.alive || l.target !== target) continue;
      n++;
      regen = Math.max(regen, l.regen);
    }
    const was = target.linked;
    target.linked = n > 0;
    const isElite = String(target.archetype) === 'elite';
    if (isElite) {
      // the elite's own brain owns its regeneration in phase B; a link overrides it while it feeds
      target.data.linkRegen = regen;
    } else if (target.linked) {
      target.poiseTakenScale = TUNING.enemies.linkbound.linkedPoiseScale;
      target.damageTakenScale = TUNING.enemies.linkbound.linkedDamageScale;
    } else if (was) {
      target.poiseTakenScale = 1;
      target.damageTakenScale = 1;
    }
  }

  private onDeath(actor: Actor, killer: Actor | null): void {
    if (!this.list.length) return;
    let paid = false;
    for (const l of this.list.slice()) {
      if (!l.alive) continue;
      if (l.source !== actor && l.target !== actor && l.anchor !== actor) continue;
      // destroying an anchor is a sever the player earned; killing a body is paid as a kill, not as a sever
      const pay = l.anchor === actor && !paid;
      if (pay) paid = true;
      this.cut(l, killer, pay);
    }
  }

  update(_dt: number): void {
    const game = this.core.game;
    // safety net: an end that stopped existing without a death event (despawn) also cuts the link
    for (let i = this.list.length - 1; i >= 0; i--) {
      const l = this.list[i] as LinkImpl;
      if (!l.source.alive || !l.target.alive || (l.anchor && !l.anchor.alive)) this.cut(l, null, false);
    }
    const scanning = live(game.player) && game.player.scanning === true;
    const beat = Math.exp(-this.cadence.phase() * 6);
    let tickAt: Vec3Like | null = null;
    for (const l of this.list) {
      l.ends(_a, _b);
      _mid.copy(_a).add(_b).multiplyScalar(0.5);
      l.hum?.setPosition(_mid);
      if (!l.followed) l.beam?.setEnds(_a, _b);
      l.beam?.setIntensity(Math.min(1, (scanning ? 0.85 : 0.55) + beat * 0.45));
      if (l.arm >= 0) asWeaver(l.source.visual)?.setLinkTarget(l.arm, _b);
      if (!tickAt && String(l.target.archetype) !== 'elite') tickAt = l.target.pos;
    }
    // the shared beat is heard: one tick per beat while anything is linked
    const idx = this.beatIndex();
    if (idx !== this.lastBeat) {
      this.lastBeat = idx;
      if (this.list.length) game.audio.cadenceTick(tickAt ?? (this.list[0] as LinkImpl).target.pos, false);
    }
  }

  clear(): void {
    for (const l of this.list) {
      l.alive = false;
      l.beam?.remove(0);
      l.hum?.stop(0);
      l.beam = null;
      l.hum = null;
    }
    this.list.length = 0;
    this.lastSeverAt = -1e9;
  }

  dispose(): void {
    this.clear();
    this.offDied?.();
    this.offDied = null;
  }
}
