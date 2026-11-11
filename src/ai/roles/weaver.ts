/**
 * Weaver — the Eclipse link source. Hangs 12–18 m back behind the bodies it drives, channels up to three
 * visible links (to nearby linkbound, and first of all to the elite), re-links six seconds after a cut and
 * throws an occasional violet bolt. With every link cut it falters (3 s, core open). When it works through a
 * physical anchor, destroying the anchor ends its linking for good.
 */
import * as THREE from 'three';
import type { Actor, LinkHandle, LoopHandle, SpawnOpts } from '@/core/api';
import { asWeaver } from '@/core/api';
import { TUNING } from '@/combat/tuning';
import { Brain } from '../brain';
import type { AiCore } from '../core';
import { snapToNav } from '../steer';
import { AI } from '../tune';
import { caption, cooldownScale, fin, physicsOf, socketPos, telegraphScale } from '../util';

type State = 'drift' | 'channel' | 'bolt';

const VIOLET = 0x9a5cff;
const _goal = { x: 0, y: 0, z: 0 };
const _from = new THREE.Vector3();
const _aim = new THREE.Vector3();

export class WeaverBrain extends Brain {
  private state: State = 'drift';
  private chant: LoopHandle | null = null;
  private readonly goal = new THREE.Vector3();
  private goalAt = 0;
  private linkAt = 0;
  private relinkAt = 0;
  private candidate: Actor | null = null;
  private anchor: Actor | null = null;
  private usesAnchor = false;
  private boltCd: number;
  private t = 0;
  private releaseAt = 0.75;
  private endAt = 1.5;
  private released = false;
  private readonly aimDir = new THREE.Vector3();
  private weaving = false;
  private slackUntil = 0;

  constructor(core: AiCore, opts: SpawnOpts) {
    super(core, 'weaver', opts);
    this.boltCd = this.rand(3, 5);
  }

  protected override onActive(a: Actor): void {
    this.goal.copy(a.pos);
    this.chant = this.game.audio.loop('weaverChant', { pos: a.pos, volume: 0.7 });
    this.linkAt = this.now + 0.6;
  }

  protected override cleanup(_a: Actor): void {
    this.chant?.stop(0.3);
    this.chant = null;
  }

  protected override onAttackCancelled(_a: Actor): void {
    this.state = 'drift';
    this.candidate = null;
  }

  protected override onRecovered(a: Actor): void {
    asWeaver(a.visual)?.setSlack(0);
    const wp = a.weakPoints.find((w) => w.id === 'core');
    if (wp) wp.exposed = false;
    a.visual?.setExposed('core', 0);
  }

  override onLinkLost(a: Actor, _link: LinkHandle, by: Actor | null): void {
    const W = AI.weaver;
    this.relinkAt = this.now + W.relink;
    if (this.core.links.countFrom(a) > 0 || !a.alive) return;
    // every link cut: the Weaver falters, its core stands open
    this.cancelAttack(a);
    this.setWeaving(a, false);
    asWeaver(a.visual)?.setSlack(1);
    this.slackUntil = this.now + W.allSeveredStagger;
    const wp = a.weakPoints.find((w) => w.id === 'core');
    if (wp) wp.exposed = true;
    a.visual?.setExposed('core', 1);
    this.game.actors.stagger(a, W.allSeveredStagger, by);
    caption(this.game, 'Links severed — it falters', 'link', a.pos);
  }

  private setWeaving(a: Actor, on: boolean): void {
    if (this.weaving === on) return;
    this.weaving = on;
    if (on) a.visual?.play('weave', { loop: true });
    else a.visual?.stop('weave');
  }

  /** can this Weaver still make links? (not once its anchor has been destroyed) */
  private get canLink(): boolean {
    return !this.usesAnchor || (this.anchor !== null && this.anchor.alive);
  }

  private findCandidate(a: Actor): Actor | null {
    const W = AI.weaver;
    const links = this.core.links;
    const all = this.game.actors.all;
    let best: Actor | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < all.length; i++) {
      const o = all[i] as Actor;
      if (o === a || !o.alive || o.team !== a.team) continue;
      const kind = String(o.archetype);
      if (kind !== 'elite' && kind !== 'linkbound') continue;
      const d = a.distanceTo(o);
      if (d > W.linkRange) continue;
      if (links.all.some((l) => l.alive && l.source === a && l.target === o)) continue;
      // the elite first; then bodies nobody is driving yet
      if (kind === 'linkbound' && o.linked) continue;
      const s = kind === 'elite' ? -100 + d : d;
      if (s < bestScore) {
        bestScore = s;
        best = o;
      }
    }
    return best;
  }

  /** where to stand: 12–18 m from the threat, on the far side of the bodies it drives */
  private planGoal(a: Actor, threat: Actor): void {
    const W = AI.weaver;
    let dx = a.pos.x - threat.pos.x;
    let dz = a.pos.z - threat.pos.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.01) {
      dx = 1;
      dz = 0;
      d = 1;
    }
    // lean the stand-off direction through the centroid of its linked bodies
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const l of this.core.links.all) {
      if (!l.alive || l.source !== a) continue;
      cx += l.target.pos.x;
      cz += l.target.pos.z;
      n++;
    }
    if (n > 0) {
      const bx = cx / n - threat.pos.x;
      const bz = cz / n - threat.pos.z;
      const bl = Math.hypot(bx, bz);
      if (bl > 1) {
        dx = dx / d + (bx / bl) * 0.8;
        dz = dz / d + (bz / bl) * 0.8;
        const l2 = Math.hypot(dx, dz) || 1;
        dx = (dx / l2) * d;
        dz = (dz / l2) * d;
      }
    }
    const want = d < W.band[0] ? (W.band[0] + W.band[1]) * 0.5 : d > W.band[1] ? W.band[1] - 1.5 : d;
    if (want === d && n === 0) {
      this.goal.copy(a.pos);
      return;
    }
    _goal.x = threat.pos.x + (dx / d) * want;
    _goal.y = a.pos.y;
    _goal.z = threat.pos.z + (dz / d) * want;
    snapToNav(this.game, _goal, 6, _goal);
    this.goal.set(_goal.x, _goal.y, _goal.z);
  }

  protected think(a: Actor, dt: number): void {
    const W = AI.weaver;
    const now = this.now;
    const links = this.core.links;
    this.chant?.setPosition(a.pos);
    if (this.slackUntil > 0 && now >= this.slackUntil) {
      this.slackUntil = 0;
      this.onRecovered(a);
    }
    const mine = links.countFrom(a);
    const t = this.target;
    const valid = this.validTarget(a, t);

    switch (this.state) {
      case 'drift': {
        this.setWeaving(a, mine > 0);
        if (valid) {
          if (now >= this.goalAt) {
            this.goalAt = now + 1;
            this.planGoal(a, t);
          }
          const crowded = a.distanceTo(t) < 8;
          this.nav.moveTo(a, this.goal, W.speed * (crowded ? 1.5 : 1), dt, { turn: 4, faceTo: t.pos, stop: 0.6 });
        } else this.nav.halt(a);

        // links first
        if (mine < TUNING.enemies.weaver.maxLinks && now >= this.relinkAt && now >= this.linkAt && this.canLink) {
          this.linkAt = now + 0.5;
          const c = this.findCandidate(a);
          if (c) {
            this.candidate = c;
            this.state = 'channel';
            this.beginTelegraph(a, this.teleTime(W.channel), VIOLET, 'channel', c);
            this.setWeaving(a, true);
            break;
          }
        }
        // an occasional bolt
        this.boltCd -= dt;
        if (valid && this.boltCd <= 0 && a.distanceTo(t) <= W.boltRange && this.clearShot(a, t)) {
          // the creature's own wind-up is the telegraph (0.75 s): never shorter than the readable minimum
          const info = a.visual?.play('pulse');
          this.releaseAt = Math.max(AI.minTelegraph * telegraphScale(this.game), fin(info?.hitTimes?.[0], 0.75));
          this.endAt = Math.max(this.releaseAt + 0.3, fin(info?.duration, 1.5));
          this.t = 0;
          this.released = false;
          this.weaving = false;
          this.state = 'bolt';
          this.beginTelegraph(a, this.releaseAt, VIOLET, 'bolt', t);
          this.game.audio.play('eclipseBreath', { pos: a.pos, pitch: 1.3 });
        }
        break;
      }
      case 'channel': {
        const c = this.candidate;
        if (!c || !c.alive || a.distanceTo(c) > W.linkRange + 4) {
          this.cancelAttack(a);
          break;
        }
        a.face(c.pos, 4 * dt);
        this.nav.halt(a);
        if (this.tickTelegraph(a, dt)) {
          this.endTelegraph(a);
          if (!this.usesAnchor && mine === 0 && !this.anchor) {
            this.anchor = this.core.devices.anchorNear(a.pos, W.anchorRange);
            this.usesAnchor = this.anchor !== null;
            if (this.anchor) this.core.devices.bindAnchor(this.anchor, a);
          }
          if (this.canLink) links.create(a, c, { anchor: this.usesAnchor ? this.anchor : null });
          this.candidate = null;
          this.state = 'drift';
        }
        break;
      }
      case 'bolt': {
        this.t += dt;
        this.nav.halt(a);
        if (!this.released) {
          const k = this.t / this.releaseAt;
          if (valid && k < 0.7) {
            a.face(t.pos, 5 * dt);
            socketPos(a, 'core', _from);
            this.aimDir.copy(t.aimPoint(_aim)).sub(_from).normalize();
          }
          if (this.tickTelegraph(a, dt) || this.t >= this.releaseAt) {
            this.released = true;
            this.endTelegraph(a);
            socketPos(a, 'core', _from);
            if (this.aimDir.lengthSq() > 0.5) {
              this.core.projectiles.fire({
                owner: a, from: _from, dir: this.aimDir, speed: W.boltSpeed, range: W.boltRange + 6,
                damage: TUNING.enemies.weaver.bolt, poise: 8, element: 'violet', style: 'violet',
              });
              this.core.stats.boltsFired++;
              this.game.audio.play('eclipseLunge', { pos: a.pos, pitch: 1.5, volume: 0.7 });
            }
          }
        }
        if (this.t >= this.endAt) {
          this.boltCd = this.rand(W.boltCooldown[0], W.boltCooldown[1]) * cooldownScale(this.game);
          this.state = 'drift';
        }
        break;
      }
    }
  }

  private clearShot(a: Actor, t: Actor): boolean {
    const physics = physicsOf(this.game);
    if (!physics) return true;
    return physics.lineOfFire(socketPos(a, 'core', _from), t.aimPoint(_aim));
  }
}
