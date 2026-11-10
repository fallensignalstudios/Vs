/**
 * Sandbox-only stand-ins for subsystems that are still null-object stubs (combat/player, AI). They implement
 * just enough of the contracts for the mission system, HUD and autoplay bot to be exercised end to end:
 * a walking protagonist with a simple melee / ranged attack, companions that follow through nav, target-dummy
 * enemies and a wave-less encounter. Each one is installed ONLY when the real subsystem is a stub.
 */
import * as THREE from 'three';
import type {
  Actor, ActorDesc, ActorManager, AiSystem, CharacterVisual, Companion, CompanionMode, ContextAction, Encounter,
  EncounterDef, EnemyRole, Game, HitInfo, HitResult, HumanoidArchetype, PlayerController, PlayerHudState, ProtagonistId,
  SpawnOpts, Team, Vec3Like,
} from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { forwardX, forwardZ, turnToward, yawTo } from '@/core/mathx';
import { isStub, nullObject } from '@/core/stub';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

class SimActor implements Actor {
  readonly pos = new THREE.Vector3();
  readonly desiredVel = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly impulse = new THREE.Vector3();
  name: string;
  team: Team;
  yaw: number;
  radius: number;
  height: number;
  flying: boolean;
  hoverHeight: number;
  hp: number;
  maxHp: number;
  poise: number;
  maxPoise: number;
  regen = 0;
  alive = true;
  targetable: boolean;
  invulnerable: boolean;
  protectedNpc: boolean;
  guarding = false;
  guardArc = 0;
  perfectGuardUntil = 0;
  staggeredUntil = 0;
  frozenUntil = 0;
  iframesUntil = 0;
  damageTakenScale = 1;
  poiseTakenScale = 1;
  linked = false;
  weakPoints = [];
  tags: Set<string>;
  visual: CharacterVisual | null;
  controller: Actor['controller'];
  data: Record<string, unknown> = {};
  readonly archetype: string;

  constructor(readonly id: number, d: ActorDesc, private readonly game: Game) {
    this.archetype = d.archetype;
    this.name = d.name ?? String(d.archetype);
    this.team = d.team;
    this.pos.set(d.pos.x, d.pos.y, d.pos.z);
    this.yaw = d.yaw ?? 0;
    this.hp = this.maxHp = d.hp;
    this.poise = this.maxPoise = d.poise ?? 30;
    this.radius = d.radius ?? 0.4;
    this.height = d.height ?? 1.8;
    this.flying = d.flying ?? false;
    this.hoverHeight = d.hoverHeight ?? 0;
    this.visual = d.visual ?? null;
    this.controller = d.controller ?? null;
    this.targetable = d.targetable ?? true;
    this.invulnerable = d.invulnerable ?? false;
    this.protectedNpc = d.protectedNpc ?? false;
    this.tags = new Set(d.tags ?? []);
  }
  get staggered(): boolean { return this.game.time.now < this.staggeredUntil; }
  get frozen(): boolean { return this.game.time.now < this.frozenUntil; }
  aimPoint(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.pos).setY(this.pos.y + (this.flying ? 0 : this.height * 0.7)); }
  distanceTo(o: Actor | Vec3Like): number { const p = (o as Actor).pos ?? (o as Vec3Like); return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }
  face(t: Vec3Like, maxTurn?: number): void {
    const y = yawTo(this.pos.x, this.pos.z, t.x, t.z);
    this.yaw = maxTurn === undefined ? y : turnToward(this.yaw, y, maxTurn);
  }
}

class SimActors {
  readonly all: Actor[] = [];
  private nextId = 1;
  private hostile = new Set<string>();
  private readonly out = { x: 0, y: 0, z: 0, blocked: false, normal: null as { x: number; z: number } | null };

  constructor(private readonly game: Game) { this.resetHostility(); }

  spawn(desc: ActorDesc): Actor {
    const a = new SimActor(this.nextId++, desc, this.game);
    if (a.visual && !isStub(a.visual)) {
      this.game.scene.add(a.visual.root);
      a.visual.root.position.copy(a.pos);
      a.visual.root.rotation.y = a.yaw;
    }
    this.all.push(a);
    this.game.events.emit('actor:spawned', { actor: a });
    return a;
  }
  despawn(actor: Actor): void {
    const i = this.all.indexOf(actor);
    if (i < 0) return;
    this.all.splice(i, 1);
    (actor as SimActor).alive = false;
    actor.controller?.dispose?.(actor);
    if (actor.visual && !isStub(actor.visual)) { actor.visual.root.removeFromParent(); actor.visual.dispose(); }
  }
  kill(actor: Actor, killer: Actor | null = null): void {
    if (!actor.alive) return;
    actor.hp = 0;
    actor.alive = false;
    actor.controller?.onDeath?.(actor, killer);
    this.game.events.emit('actor:died', { actor, killer });
    this.game.vfx.spawn(actor.team === 'eclipse' ? 'eclipseDissolve' : 'deviceBreak', actor.aimPoint(new THREE.Vector3()));
    if (actor === this.game.player.actor) this.game.events.emit('player:died', {});
    else this.despawn(actor);
  }
  applyHit(target: Actor, hit: HitInfo): HitResult {
    const r: HitResult = { applied: 0, blocked: false, perfect: false, staggered: false, killed: false, immune: false, weakPoint: false, resisted: false };
    const god = target === this.game.player.actor && this.game.player.godMode;
    if (!target.alive || target.invulnerable || target.protectedNpc || god) { r.immune = true; return r; }
    r.applied = Math.min(target.hp, hit.damage * target.damageTakenScale);
    target.hp -= r.applied;
    target.visual?.flash(0xffffff, 0.08);
    if (target.hp <= 0) { r.killed = true; this.kill(target, hit.attacker); }
    this.game.events.emit('actor:hit', { target, hit, result: r });
    if (target === this.game.player.actor) this.game.events.emit('player:damaged', { amount: r.applied, dir: hit.dir, hit });
    return r;
  }
  stagger(t: Actor, seconds: number): void { t.staggeredUntil = this.game.time.now + seconds; }
  freeze(t: Actor, seconds: number): void { t.frozenUntil = this.game.time.now + seconds; }
  setHostile(a: Team, b: Team, on: boolean): void {
    for (const k of [`${a}|${b}`, `${b}|${a}`]) if (on) this.hostile.add(k); else this.hostile.delete(k);
  }
  areHostile(a: Actor, b: Actor): boolean { return this.hostile.has(`${a.team}|${b.team}`); }
  resetHostility(): void {
    this.hostile.clear();
    for (const t of ['player', 'dominion', 'reformation'] as Team[]) { this.setHostile(t, 'eclipse', true); this.setHostile(t, 'contaminated', true); }
    this.setHostile('eclipse', 'contaminated', true);
  }
  hostilesOf(of: Actor): Actor[] { return this.all.filter((a) => a.alive && a.targetable && this.areHostile(of, a)); }
  nearest(pos: Vec3Like, maxDist: number, filter?: (a: Actor) => boolean): Actor | null {
    let best: Actor | null = null;
    let bd = maxDist;
    for (const a of this.all) {
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d <= bd && (!filter || filter(a))) { best = a; bd = d; }
    }
    return best;
  }
  inRadius(pos: Vec3Like, radius: number, filter?: (a: Actor) => boolean): Actor[] {
    return this.all.filter((a) => Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z) <= radius && (!filter || filter(a)));
  }
  inArc(pos: Vec3Like, yaw: number, arc: number, range: number, filter?: (a: Actor) => boolean): Actor[] {
    const fx = forwardX(yaw), fz = forwardZ(yaw), cos = Math.cos(arc / 2);
    return this.inRadius(pos, range, filter).filter((a) => {
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z, d = Math.hypot(dx, dz);
      return d < 0.3 || (dx * fx + dz * fz) / d >= cos;
    });
  }
  raycast(): null { return null; }
  byTag(tag: string): Actor[] { return this.all.filter((a) => a.tags.has(tag)); }
  byId(id: number): Actor | null { return this.all.find((a) => a.id === id) ?? null; }
  update(dt: number): void {
    const physics = this.game.physics;
    for (const a of this.all.slice()) {
      if (a.alive) a.controller?.update(a, dt);
      const v = a.desiredVel;
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0 && a.alive) {
        const base = a.flying ? a.pos.y : a.pos.y;
        const r = physics.moveCharacter({ x: a.pos.x, y: base, z: a.pos.z }, a.radius, v.x * dt, v.z * dt, { flying: a.flying, height: a.height, out: this.out });
        a.pos.set(r.x, r.y, r.z);
      }
      a.vel.copy(v);
      v.set(0, 0, 0);
      const vis = a.visual;
      if (vis && !isStub(vis)) {
        vis.root.position.copy(a.pos);
        vis.root.rotation.y = a.yaw;
        vis.setLocomotion(speed, 0, { sprint: speed > 6 });
        vis.update(dt);
      }
    }
  }
  clear(): void {
    for (const a of this.all.slice()) if (!a.tags.has('persist')) this.despawn(a);
  }
}

class SimPlayer {
  actor!: Actor;
  protagonist!: ProtagonistId;
  enabled = true;
  echo = 0;
  readonly echoMax = 100;
  lockTarget: Actor | null = null;
  godMode = false;
  threat = 0;
  contextAction: ContextAction | null = null;
  private cooldown = 0;
  private ammo = 6;
  private reserve = 24;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly follow = { pos: new THREE.Vector3(), height: 1.55, yaw: 0 };
  private hud!: PlayerHudState;

  constructor(private readonly game: Game) {}

  setProtagonist(id: ProtagonistId, at: { pos: Vec3Like; yaw: number }): void {
    const g = this.game;
    if (this.actor) g.actors.despawn(this.actor);
    const tarrik = id !== 'selene';
    this.protagonist = tarrik ? 'tarrik' : 'selene';
    const visual = g.chars.create(this.protagonist);
    visual.setLoadout({ melee: true });
    this.actor = g.actors.spawn({ archetype: this.protagonist, name: tarrik ? 'Tarrik' : 'Selene', team: 'player', pos: at.pos, yaw: at.yaw, hp: tarrik ? 140 : 100, poise: tarrik ? 60 : 35, visual, tags: ['persist', 'player'] });
    if (isHumanoidVisual(visual)) visual.teleported();
    this.ammo = tarrik ? 6 : 8;
    this.follow.pos = this.actor.pos;
    this.follow.yaw = at.yaw;
    g.camera.setTarget(this.follow);
    g.events.emit('player:protagonist', { id: this.protagonist });
  }
  setMovementLocked(): void {}
  teleport(pos: Vec3Like, yaw?: number): void {
    this.actor.pos.set(pos.x, pos.y, pos.z);
    if (yaw !== undefined) this.actor.yaw = yaw;
    if (isHumanoidVisual(this.actor.visual)) this.actor.visual.teleported();
  }
  addEcho(amount: number, reason: string): void {
    const v = Math.max(0, Math.min(this.echoMax, this.echo + amount));
    this.game.events.emit('player:echo', { value: v, delta: v - this.echo, reason });
    this.echo = v;
  }
  heal(amount: number): void {
    this.actor.hp = Math.min(this.actor.maxHp, this.actor.hp + amount);
    this.game.events.emit('player:healed', { amount });
  }
  restoreForCheckpoint(opts?: { echo?: number }): void {
    this.actor.hp = this.actor.maxHp;
    this.actor.alive = true;
    this.echo = opts?.echo ?? 30;
    this.reserve = 24;
  }
  setAmmo(mag: number, reserve: number): void { this.ammo = mag; this.reserve = reserve; }
  setContextAction(a: ContextAction | null): void { this.contextAction = a; }
  playScripted(action: string): number { return this.actor?.visual?.play(action).duration ?? 0; }
  getHudState(): PlayerHudState {
    const a = this.actor;
    const tarrik = this.protagonist !== 'selene';
    const h = (this.hud ??= {
      protagonist: 'tarrik', name: '', hp: 0, maxHp: 1, poise: 0, maxPoise: 1, echo: 0, echoMax: 100, ammo: 0, magSize: 6, reserve: 0, reloading: false,
      meleeName: '', rangedName: '', aiming: false, guarding: false, lockTarget: null, context: null, threat: 0,
      abilities: [
        { id: 'cinderSlam', name: 'Cinder Slam', cost: 35, cooldown: 6, cooldownLeft: 0, ready: false },
        { id: 'cinderSticky', name: 'Sticky Grenade', cost: 30, cooldown: 6, cooldownLeft: 0, ready: false },
      ],
    });
    h.protagonist = this.protagonist; h.name = tarrik ? 'Tarrik' : 'Selene';
    h.hp = a?.hp ?? 0; h.maxHp = a?.maxHp ?? 1; h.poise = a?.poise ?? 0; h.maxPoise = a?.maxPoise ?? 1;
    h.echo = this.echo; h.ammo = this.ammo; h.magSize = tarrik ? 6 : 8; h.reserve = this.reserve;
    h.meleeName = tarrik ? 'Velkorran' : 'Verity'; h.rangedName = tarrik ? 'Cinderline' : 'Axiom';
    h.aiming = this.game.input.down('aim'); h.context = this.contextAction; h.threat = this.threat;
    return h;
  }
  update(dt: number): void {
    const a = this.actor;
    if (!a || !a.alive) return;
    const g = this.game;
    const { input, camera } = g;
    this.follow.yaw = a.yaw;
    this.cooldown -= dt;
    if (!this.enabled) return;
    let mx = 0, mz = 0;
    const w = input.moveWorld;
    if (w) { mx = w.x; mz = w.z; }
    else if (input.move.x !== 0 || input.move.y !== 0) {
      camera.getForward(this.fwd); camera.getRight(this.right);
      mx = this.fwd.x * input.move.y + this.right.x * input.move.x;
      mz = this.fwd.z * input.move.y + this.right.z * input.move.x;
    }
    const mag = Math.min(1, Math.hypot(mx, mz));
    const aiming = input.down('aim');
    camera.setAim(aiming);
    if (mag > 0.05) {
      const speed = (input.down('sprint') ? 7.2 : 5.2) * mag * (aiming ? 0.5 : 1);
      a.desiredVel.set((mx / mag) * speed, 0, (mz / mag) * speed);
      if (!aiming) a.yaw = turnToward(a.yaw, yawTo(0, 0, mx, mz), dt * 10);
    }
    if (aiming) a.yaw = camera.yaw;
    const heavy = input.pressed('heavy');
    if ((input.pressed('attack') || heavy) && this.cooldown <= 0) this.attack(a, aiming, heavy);
    const ctx = this.contextAction;
    if (ctx && input.pressed(ctx.button)) { this.contextAction = null; ctx.onConfirm(); }
  }
  private attack(a: Actor, aiming: boolean, heavy: boolean): void {
    const g = this.game;
    this.cooldown = heavy ? 0.9 : 0.4;
    const hostiles = g.actors.hostilesOf(a);
    const from = a.aimPoint(new THREE.Vector3());
    if (aiming) {
      if (this.ammo <= 0) { this.ammo = Math.min(this.reserve, 6); this.reserve -= this.ammo; this.cooldown = 1.2; return; }
      this.ammo--;
      a.visual?.play('shoot');
      const t = hostiles.filter((h) => g.physics.lineOfFire(from, h.aimPoint(new THREE.Vector3()))).sort((p, q) => a.distanceTo(p) - a.distanceTo(q))[0];
      if (t) {
        const to = t.aimPoint(new THREE.Vector3());
        g.vfx.tracer(from, to, this.protagonist === 'selene' ? 'cold' : 'warm');
        g.actors.applyHit(t, { attacker: a, damage: 26, poise: 10, kind: 'ranged', dir: to.clone().sub(from).normalize(), point: to });
      }
      g.events.emit('player:shot', { weapon: 'sidearm', ammo: this.ammo });
      return;
    }
    a.visual?.play(heavy ? 'attackHeavy' : 'attackLight1');
    for (const t of g.actors.inArc(a.pos, a.yaw, Math.PI * 0.8, 2.8, (h) => hostiles.includes(h))) {
      const to = t.aimPoint(new THREE.Vector3());
      g.actors.applyHit(t, { attacker: a, damage: heavy ? 55 : 24, poise: heavy ? 60 : 20, kind: 'melee', heavy, dir: to.clone().sub(from).normalize(), point: to });
      this.addEcho(heavy ? 6 : 2, 'hit');
    }
  }
}

class SimCompanion implements Companion {
  arrived = true;
  private leader: Actor | null = null;
  private goal: THREE.Vector3 | null = null;
  private goalYaw: number | undefined;
  private path: Vec3Like[] | null = null;
  private repath = 0;
  private faceAt: Vec3Like | null = null;

  constructor(private readonly game: Game, readonly actor: Actor, readonly who: HumanoidArchetype, public mode: CompanionMode) {
    actor.controller = { update: (_a, dt) => this.update(dt) };
    if (mode === 'follow' || mode === 'combat') this.leader = game.player.actor ?? null;
  }
  moveTo(pos: Vec3Like, opts?: { yaw?: number }): void { this.goal = new THREE.Vector3(pos.x, pos.y, pos.z); this.goalYaw = opts?.yaw; this.leader = null; this.arrived = false; this.path = null; }
  follow(leader: Actor | null): void { this.leader = leader; this.goal = null; }
  holdAt(pos: Vec3Like, yaw?: number): void { this.moveTo(pos, { yaw }); }
  face(target: Vec3Like | null): void { this.faceAt = target; }
  play(action: string, opts?: { loop?: boolean }): number { return this.actor.visual?.play(action, opts).duration ?? 0; }
  stopAction(): void { this.actor.visual?.stop(); }
  teleport(pos: Vec3Like, yaw?: number): void { this.actor.pos.set(pos.x, pos.y, pos.z); if (yaw !== undefined) this.actor.yaw = yaw; }
  focus(): void {}
  assist(): void {}
  remove(): void { this.game.actors.despawn(this.actor); }
  private update(dt: number): void {
    const a = this.actor;
    const lead = this.leader && this.leader.alive ? this.leader : this.mode === 'follow' ? this.game.player.actor : null;
    const target = this.goal ?? (lead ? lead.pos : null);
    const stop = this.goal ? 0.35 : 2.6;
    if (target && Math.hypot(target.x - a.pos.x, target.z - a.pos.z) > stop) {
      this.repath -= dt;
      if (!this.path || this.repath <= 0) { this.path = this.game.physics.nav.findPath(a.pos, target)?.points ?? null; this.repath = 0.5; }
      const p = this.path && this.path.length > 1 ? this.path[1] : target;
      const dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
      const speed = Math.hypot(target.x - a.pos.x, target.z - a.pos.z) > 6 ? 5.6 : 3.2;
      a.desiredVel.set((dx / d) * speed, 0, (dz / d) * speed);
      a.yaw = turnToward(a.yaw, yawTo(0, 0, dx, dz), dt * 8);
      if (d < 0.5) this.path = null;
      return;
    }
    if (this.goal) { this.arrived = true; this.goal = null; if (this.goalYaw !== undefined) a.yaw = this.goalYaw; }
    if (this.faceAt) a.face(this.faceAt, dt * 6);
  }
}

const ROLE: Record<EnemyRole, { team: Team; hp: number; flying?: boolean; radius?: number; height?: number }> = {
  secDrone: { team: 'reformation', hp: 60, flying: true, radius: 0.5, height: 0.8 },
  contamDrone: { team: 'contaminated', hp: 55, flying: true, radius: 0.5, height: 0.8 },
  enforcer: { team: 'dominion', hp: 160 },
  linkbound: { team: 'eclipse', hp: 70 },
  wallrunner: { team: 'eclipse', hp: 50 },
  weaver: { team: 'eclipse', hp: 90 },
  elite: { team: 'eclipse', hp: 900, radius: 1.2, height: 3.6 },
};

class SimEncounter implements Encounter {
  state: Encounter['state'] = 'idle';
  readonly alive: Actor[] = [];
  spawned = 0;
  killed = 0;
  wave = -1;
  flags: Record<string, boolean> = {};
  meleeSlots = 2;
  readonly total: number;
  constructor(private readonly game: Game, private readonly ai: SimAi, private readonly def: EncounterDef) {
    this.total = def.waves.reduce((n, w) => n + w.spawns.length, 0);
  }
  get id(): string { return this.def.id; }
  get aliveCount(): number { return this.alive.length; }
  get cleared(): boolean { return this.state === 'cleared'; }
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'active';
    this.game.events.emit('encounter:started', { id: this.id });
  }
  adopt(actor: Actor): void { this.alive.push(actor); }
  forceClear(): void { for (const a of this.alive.slice()) this.game.actors.kill(a, null); this.wave = this.def.waves.length - 1; }
  stop(): void { this.state = 'cleared'; }
  update(): void {
    if (this.state !== 'active') return;
    for (let i = this.alive.length - 1; i >= 0; i--) if (!this.alive[i].alive) { this.alive.splice(i, 1); this.killed++; }
    const next = this.def.waves[this.wave + 1];
    if (next && (!next.when || next.when(this))) {
      this.wave++;
      const actors = next.spawns.map((s) => {
        const pos = typeof s.at === 'string' ? (this.def.resolve ? this.def.resolve(s.at) : { x: 0, y: 0, z: 0 }) : s.at;
        return this.ai.spawnEnemy(s.role, { ...s.opts, pos });
      });
      this.alive.push(...actors);
      this.spawned += actors.length;
      this.game.events.emit('encounter:wave', { id: this.id, wave: this.wave });
      next.onSpawn?.(actors, this);
    } else if (!next && this.alive.length === 0) {
      this.state = 'cleared';
      this.game.events.emit('encounter:cleared', { id: this.id });
      this.def.onCleared?.(this);
    }
  }
}

class SimAi {
  readonly encounters: SimEncounter[] = [];
  readonly links = nullObject<AiSystem['links']>('ai.links');
  readonly devices = nullObject<AiSystem['devices']>('ai.devices');
  private ceasefire = false;
  constructor(private readonly game: Game) {}
  get intensity(): number { return this.encounters.some((e) => e.state === 'active') ? 0.6 : 0; }
  spawnEnemy(role: EnemyRole, opts: SpawnOpts): Actor {
    const g = this.game;
    const r = ROLE[role] ?? ROLE.linkbound;
    const team = opts.team ?? r.team;
    const hover = r.flying ? 1.8 : 0;
    const visual = g.chars.create(role);
    const actor = g.actors.spawn({
      archetype: role, name: opts.name ?? role, team, pos: { x: opts.pos.x, y: opts.pos.y + hover, z: opts.pos.z }, yaw: opts.yaw ?? 0, hp: r.hp * (opts.hpScale ?? 1),
      radius: r.radius, height: r.height, flying: r.flying, hoverHeight: hover, visual, tags: opts.tags,
    });
    if (team === 'reformation' || team === 'dominion') g.actors.setHostile('player', team, true);
    actor.controller = { update: (a, dt) => { const p = g.player.actor; if (p && !this.ceasefire) a.face(p.pos, dt * 3); } };
    return actor;
  }
  private human(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; name?: string }, mode: CompanionMode, pose?: string): Companion {
    const g = this.game;
    const visual = g.chars.create(who);
    const actor = g.actors.spawn({ archetype: who, name: opts.name ?? who, team: 'player', pos: opts.pos, yaw: opts.yaw ?? 0, hp: 100, visual, invulnerable: true, targetable: false });
    if (isHumanoidVisual(visual)) visual.teleported();
    if (pose) visual.play(pose, { loop: true });
    return new SimCompanion(g, actor, who, mode);
  }
  spawnCompanion(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; mode?: CompanionMode; name?: string }): Companion {
    return this.human(who, opts, opts.mode ?? 'follow');
  }
  spawnNpc(who: HumanoidArchetype, opts: { pos: Vec3Like; yaw?: number; pose?: string; name?: string }): Companion {
    return this.human(who, opts, 'scripted', opts.pose);
  }
  createEncounter(def: EncounterDef): Encounter {
    const e = new SimEncounter(this.game, this, def);
    this.encounters.push(e);
    return e;
  }
  alert(): void {}
  setCeasefire(on: boolean): void { this.ceasefire = on; }
  update(): void { for (const e of this.encounters) e.update(); }
  clear(): void { this.encounters.length = 0; this.ceasefire = false; }
}

/**
 * The contracts keep growing while their owners work; members a stand-in does not implement resolve to
 * null-object stubs instead of `undefined`, so callers of newer API still no-op.
 */
function standIn<T extends object>(name: string, impl: object): T {
  return new Proxy(impl as Record<string | symbol, unknown>, {
    get(t, p, recv) {
      if (p in t) return Reflect.get(t, p, recv);
      if (typeof p === 'symbol' || p === 'then' || p === '__isStub') return undefined;
      return nullObject(`${name}.${String(p)}`);
    },
  }) as unknown as T;
}

/** Replace stub combat / AI subsystems on a constructed Game. Returns the names that were replaced. */
export function installFallbacks(game: Game): string[] {
  const g = game as Mutable<Game>;
  const replaced: string[] = [];
  if (isStub(g.actors)) { g.actors = standIn<ActorManager>('actors', new SimActors(game)); replaced.push('actors'); }
  if (isStub(g.player)) { g.player = standIn<PlayerController>('player', new SimPlayer(game)); replaced.push('player'); }
  if (isStub(g.ai)) { g.ai = standIn<AiSystem>('ai', new SimAi(game)); replaced.push('ai'); }
  return replaced;
}
