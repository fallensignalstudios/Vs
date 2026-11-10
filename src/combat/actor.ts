/** The Actor class behind `ActorManager.spawn` (see src/core/api/combat.ts for the contract). */
import * as THREE from 'three';
import type {
  Actor, ActorController, ActorDesc, ActorLocoFlags, ActorMaterial, Archetype, CharacterVisual, MoveResult, Team,
  Vec3Like, WeakPoint,
} from '@/core/api';
import { turnToward, yawTo } from '@/core/mathx';
import { TUNING } from './tuning';
import { fin, live, warnOnce } from './safe';

const METAL: ReadonlySet<string> = new Set([
  'secDrone', 'contamDrone', 'commandEmitter', 'relayReceiver', 'scanHead', 'frostAnchor', 'enforcer',
  'dominionSoldier', 'reformationSoldier', 'reformationMarine', 'tarrik', 'selene', 'lyessa',
]);

function inferMaterial(archetype: string, team: Team): ActorMaterial {
  if (team === 'eclipse' || archetype === 'weaverAnchor') return 'eclipse';
  return METAL.has(archetype) ? 'metal' : 'flesh';
}

export class ActorImpl implements Actor {
  readonly archetype: Archetype | string;
  name: string;
  team: Team;

  readonly pos = new THREE.Vector3();
  yaw = 0;
  readonly desiredVel = new THREE.Vector3();
  readonly carryVel = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly impulse = new THREE.Vector3();
  radius: number;
  height: number;
  flying: boolean;
  hoverHeight: number;

  hp: number;
  maxHp: number;
  poise: number;
  maxPoise: number;
  regen: number;

  alive = true;
  targetable: boolean;
  invulnerable: boolean;
  protectedNpc: boolean;

  guarding = false;
  guardArc: number;
  perfectGuardUntil = 0;
  staggeredUntil = 0;
  frozenUntil = 0;
  iframesUntil = 0;

  damageTakenScale = 1;
  poiseTakenScale = 1;
  linked = false;

  weakPoints: WeakPoint[];
  tags: Set<string>;
  visual: CharacterVisual | null;
  controller: ActorController | null;
  data: Record<string, unknown> = {};

  fixed: boolean;
  loco: ActorLocoFlags = {};
  guardStopsHeavy = true;
  guardChip = 0;
  deflectUntil = 0;
  flankMultiplier = 1;
  freezeScale = 1;
  superArmorUntil = 0;
  material: ActorMaterial;
  lastHitAt = 0;

  // ---- manager-private state (underscore = not part of the contract) -------------------------------------
  /** sim time of the last poise damage */
  _poiseHitAt = -1e9;
  /** reused physics result */
  readonly _move: MoveResult = { x: 0, y: 0, z: 0, blocked: false, normal: null };
  /** separation push accumulated this tick (m) */
  _pushX = 0;
  _pushZ = 0;
  /** smoothed height the visual is drawn at */
  _visualY = 0;
  _bob = 0;
  /** ground height under a flying actor */
  _groundY = 0;
  _unstickAt = 0;
  /** sim time of death; removal / dissolve timing */
  _diedAt = 0;
  _removeAt = Infinity;
  _dissolveFrom = Infinity;
  _dissolveSeconds = TUNING.actor.dissolveSeconds;
  _dissolveColor: number | undefined = undefined;
  _corpseSeconds: number;
  _dissolveOnDeath: boolean;
  /** was targetable before death (restored by revive) */
  _wasTargetable = true;
  _wasFrozen = false;
  _removed = false;
  _warned = false;
  /** despawn-with-dissolve: leave the visual undisposed for its owner */
  _keepVisual = false;
  _dissolveFx = false;

  constructor(
    readonly id: number,
    desc: ActorDesc,
    private readonly clock: { now: number },
  ) {
    this.archetype = desc.archetype ?? 'unknown';
    this.name = desc.name ?? String(this.archetype);
    this.team = desc.team ?? 'neutral';
    const v = live(desc.visual) ? desc.visual : null;
    this.visual = v;
    const p = desc.pos;
    const ok = !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    if (!ok) warnOnce(`spawnpos:${this.name}`, `spawn("${this.name}") with a bad position — placed at the origin`);
    this.pos.set(ok ? p.x : 0, ok ? p.y : 0, ok ? p.z : 0);
    this.yaw = fin(desc.yaw, 0);
    this.radius = Math.max(0.05, fin(desc.radius, v ? fin(v.radius, 0.4) : 0.4));
    this.height = Math.max(0.1, fin(desc.height, v ? fin(v.height, 1.8) : 1.8));
    this.flying = desc.flying === true;
    this.hoverHeight = fin(desc.hoverHeight, 1.8);
    let hp = fin(desc.hp, 1);
    if (hp <= 0) {
      warnOnce(`spawnhp:${this.name}`, `spawn("${this.name}") with hp <= 0 — using 1`);
      hp = 1;
    }
    this.hp = this.maxHp = hp;
    this.maxPoise = Math.max(0, fin(desc.poise, 0));
    this.poise = this.maxPoise;
    this.regen = fin(desc.regen, 0);
    this.targetable = desc.targetable !== false;
    this.invulnerable = desc.invulnerable === true;
    this.protectedNpc = desc.protectedNpc === true;
    this.guardArc = fin(desc.guardArc, TUNING.actor.defaultGuardArc);
    this.weakPoints = Array.isArray(desc.weakPoints) ? desc.weakPoints.map((w) => ({ ...w })) : [];
    this.tags = new Set(Array.isArray(desc.tags) ? desc.tags : []);
    this.controller = desc.controller ?? null;
    this.fixed = desc.fixed === true;
    this.material = desc.material ?? inferMaterial(String(this.archetype), this.team);
    this._corpseSeconds = desc.corpseSeconds === Infinity ? Infinity : Math.max(0, fin(desc.corpseSeconds, TUNING.actor.corpseSeconds));
    this._dissolveOnDeath = desc.dissolveOnDeath ?? this.team === 'eclipse';
    this._wasTargetable = this.targetable;
    this._visualY = this.pos.y;
    this._groundY = this.flying ? this.pos.y - this.hoverHeight : this.pos.y;
  }

  get staggered(): boolean {
    return this.alive && this.clock.now < this.staggeredUntil;
  }

  get frozen(): boolean {
    return this.alive && this.clock.now < this.frozenUntil;
  }

  /** lowest point of the body */
  get bottom(): number {
    return this.flying ? this.pos.y - this.height * 0.5 : this.pos.y;
  }

  /** chest / centre of mass — what shots and lock-on aim at */
  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.flying ? this.pos.y : this.pos.y + this.height * 0.62, this.pos.z);
  }

  /** planar (XZ) distance */
  distanceTo(other: Actor | Vec3Like): number {
    const p = (other as Actor).pos ?? (other as Vec3Like);
    return Math.hypot(fin(p.x) - this.pos.x, fin(p.z) - this.pos.z);
  }

  face(target: Vec3Like, maxTurn?: number): void {
    const dx = fin(target?.x, this.pos.x) - this.pos.x;
    const dz = fin(target?.z, this.pos.z) - this.pos.z;
    if (dx * dx + dz * dz < 1e-8) return;
    const want = yawTo(0, 0, dx, dz);
    this.yaw = maxTurn === undefined || !Number.isFinite(maxTurn) ? want : turnToward(this.yaw, want, Math.max(0, maxTurn));
  }
}
