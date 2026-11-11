/**
 * PlayerController — the protagonist: kit, state machine, input buffering, Echo, context actions, HUD state.
 * The feature modules (movement, melee, guard, ranged, abilities, lock-on, pickups) hang off this class.
 * Contract: src/core/api/combat.ts. Numbers: ../tuning.ts.
 */
import type {
  Actor, ActorController, ActorManager, ActionInfo, CameraFollowTarget, CharacterVisual, ContextAction, Game, HitInfo,
  HitResult, PhysicsWorld, PlayerAction, PlayerController, PlayerHudState, ProtagonistId, Vec3Like, ButtonAction,
} from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { clamp } from '@/core/mathx';
import { ActorImpl } from '../actor';
import { TUNING, type ProtagonistKit } from '../tuning';
import { fin, live, warnOnce } from '../safe';
import { Movement } from './movement';
import { Melee } from './melee';
import { Guard } from './guard';
import { Ranged } from './ranged';
import { Abilities } from './abilities';
import { LockOn } from './lockon';
import { pickupsOf, playerPickupHost } from './pickups';
import { ContextActions } from './context';
import { EchoBank } from './echo';

type Buffered = 'light' | 'heavy' | 'dodge' | 'ability1' | 'ability2' | 'guard';

const DEFAULT_HEIGHT: Record<ProtagonistId, number> = { tarrik: 1.9, selene: 1.68 };


interface Saved {
  ammo: number;
  reserve: number;
}

export class PlayerControllerImpl implements PlayerController {
  enabled = true;
  /** the clip of the action last started through playAction (cancelAction fades it out) */
  private actionClip: string | null = null;
  godMode = false;
  threat = 0;

  kit: ProtagonistKit = TUNING.kits.tarrik;
  visual: CharacterVisual | null = null;
  readonly actors: ActorManager;

  readonly move: Movement;
  readonly melee: Melee;
  readonly guard: Guard;
  readonly ranged: Ranged;
  readonly abilities: Abilities;
  readonly lock: LockOn;

  private _actor: ActorImpl;
  private _protagonist: ProtagonistId = 'tarrik';
  private spawned = false;
  private state: PlayerAction = 'free';
  private moveLocked = false;
  private readonly visuals: Partial<Record<ProtagonistId, CharacterVisual>> = {};
  private readonly saved: Record<ProtagonistId, Saved>;
  private readonly follow: CameraFollowTarget & { yaw: number };
  private hidden = false;

  // input buffer
  private bufKind: Buffered | null = null;
  private bufAt = 0;
  private bufHeld = false;

  private readonly context: ContextActions;
  private readonly echoBank: EchoBank;
  private heartbeat = 0;

  private readonly brain: ActorController;
  private readonly hud: PlayerHudState;
  /** filter: things the protagonist's attacks may strike (hostiles + destructible devices / objectives) */
  readonly attackable = (x: Actor): boolean => this.canAttack(x);
  /** filter: hostile, living, targetable */
  readonly hostile = (x: Actor): boolean => x !== this._actor && x.alive && x.targetable && this.actors.areHostile(this._actor, x);

  constructor(readonly game: Game) {
    this.actors = game.actors;
    // a detached, dead placeholder until the first setProtagonist()
    this._actor = new ActorImpl(0, { archetype: 'none', team: 'player', pos: { x: 0, y: 0, z: 0 }, hp: 1, targetable: false }, game.time ?? { now: 0 });
    this._actor.alive = false;
    this.saved = {
      tarrik: { ammo: TUNING.kits.tarrik.ranged.mag, reserve: TUNING.kits.tarrik.ranged.reserve },
      selene: { ammo: TUNING.kits.selene.ranged.mag, reserve: TUNING.kits.selene.ranged.reserve },
    };
    this.context = new ContextActions(game);
    this.echoBank = new EchoBank(this);
    const self = this;
    this.follow = {
      pos: this._actor.pos,
      height: 1.55,
      get yaw(): number {
        return self._actor.yaw;
      },
      set yaw(_y: number) {
        /* read-only view of the actor's facing */
      },
    };
    this.move = new Movement(this);
    this.melee = new Melee(this);
    this.guard = new Guard(this);
    this.ranged = new Ranged(this);
    this.abilities = new Abilities(this);
    this.lock = new LockOn(this);
    this.abilities.bindKit();
    this.brain = {
      update: () => {},
      onHit: (_a, hit, res) => this.onHit(hit, res),
      onDeath: () => this.onDeath(),
    };
    this.hud = {
      protagonist: 'tarrik', name: this.kit.name, hp: 0, maxHp: 1, poise: 0, maxPoise: 1, echo: 0, echoMax: TUNING.echo.max,
      ammo: 0, magSize: this.kit.ranged.mag, reserve: 0, reloading: false,
      meleeName: this.kit.meleeName, rangedName: this.kit.ranged.name,
      abilities: this.abilities.states, aiming: false, guarding: false, lockTarget: null, context: null, threat: 0,
    };
    pickupsOf(game).bind(playerPickupHost(this));
    const ev = game.events;
    ev.on('actor:died', (e) => {
      if (this.spawned && e.killer === this._actor && e.actor !== this._actor) this.addEcho(0, 'kill');
    });
    ev.on('device:disabled', (e) => {
      if (this.spawned && e.by === this._actor) this.addEcho(0, 'device');
    });
    ev.on('zone:loading', () => {
      this.abilities.clearWorld();
      this.lock.reset();
      this.setContextAction(null);
    });
  }

  // ---- small accessors for the feature modules ----------------------------------------------------------------

  get actor(): ActorImpl {
    return this._actor;
  }
  get protagonist(): ProtagonistId {
    return this._protagonist;
  }
  get action(): PlayerAction {
    return this.state;
  }
  get now(): number {
    return fin(this.game.time?.now, 0);
  }
  get physics(): PhysicsWorld | null {
    const p = this.game.physics;
    return live(p) ? p : null;
  }
  /** gameplay input is being read this tick */
  get active(): boolean {
    return this.enabled && this.spawned && this._actor.alive;
  }
  get movementLocked(): boolean {
    return this.moveLocked;
  }
  get scanning(): boolean {
    return this.lock.scanLeft > 0;
  }
  get buffered(): Buffered | null {
    return this.bufKind;
  }
  get echoMax(): number {
    return TUNING.echo.max;
  }
  get echo(): number {
    return this.echoBank.value;
  }
  set echo(v: number) {
    this.echoBank.set(fin(v, 0), 'set');
  }
  /** a protagonist is in the world */
  get isSpawned(): boolean {
    return this.spawned;
  }
  get lockTarget(): Actor | null {
    return this.lock.target;
  }
  set lockTarget(t: Actor | null) {
    this.lock.set(live(t) && t.alive ? t : null);
  }
  get contextAction(): ContextAction | null {
    return this.context.action;
  }

  /** strict input reads: a stub input system returns truthy junk */
  down(a: ButtonAction): boolean {
    return this.game.input.down(a) === true;
  }
  pressed(a: ButtonAction): boolean {
    return this.game.input.pressed(a) === true;
  }
  engaged(a: ButtonAction): boolean {
    return this.game.input.engaged(a) === true;
  }

  setState(s: PlayerAction): void {
    this.state = s;
  }

  /** play an action on the figure and return timings that are always usable (fallbacks for stubs / no figure) */
  playAction(action: string, duration: number, hitAt: number): { duration: number; hitTimes: number[] } {
    this.actionClip = action;
    const v = this.visual;
    let info: ActionInfo | null = null;
    if (v) {
      try {
        info = v.play(action);
      } catch (err) {
        warnOnce(`play:${action}`, `visual.play("${action}") threw: ${String(err)}`);
      }
    }
    const d = info && typeof info.duration === 'number' && info.duration > 0.05 && Number.isFinite(info.duration) ? info.duration : duration;
    const hits: number[] = [];
    if (info && Array.isArray(info.hitTimes)) for (const t of info.hitTimes) if (typeof t === 'number' && t >= 0 && t <= d) hits.push(t);
    if (!hits.length) hits.push(Math.min(hitAt, d));
    return { duration: d, hitTimes: hits };
  }

  private canAttack(x: Actor): boolean {
    const a = this._actor;
    if (x === a || !x.alive || !x.targetable || x.protectedNpc || x.team === 'player') return false;
    return this.actors.areHostile(a, x) || x.tags.has('device') || x.tags.has('objective');
  }

  // ---- protagonist --------------------------------------------------------------------------------------------

  setProtagonist(id: ProtagonistId, at: { pos: Vec3Like; yaw: number }): void {
    const game = this.game;
    let pid: ProtagonistId = id;
    if (pid !== 'tarrik' && pid !== 'selene') {
      warnOnce(`protagonist:${String(id)}`, `unknown protagonist "${String(id)}" — using tarrik`);
      pid = 'tarrik';
    }
    const pos = at?.pos && Number.isFinite(at.pos.x + at.pos.y + at.pos.z) ? at.pos : { x: 0, y: 0, z: 0 };
    const yaw = fin(at?.yaw, 0);
    const first = !this.spawned;
    const same = this.spawned && pid === this._protagonist && !this._actor._removed;
    this.cancelAll();
    if (!same) {
      if (this.spawned) {
        this.saveKitState();
        this.melee.unbindVisual();
        this.actors.despawn(this._actor, { keepVisual: true });
        if (!this._actor._removed) this._actor._removed = true;
      }
      this._protagonist = pid;
      this.kit = TUNING.kits[pid];
      let visual = this.visuals[pid] ?? null;
      if (!visual) {
        try {
          const made = game.chars.create(pid);
          visual = live(made) && live(made.root) ? made : null;
        } catch (err) {
          warnOnce(`chars:${pid}`, `chars.create("${pid}") threw: ${String(err)}`);
        }
        if (visual) this.visuals[pid] = visual;
      }
      this.visual = visual;
      const desc = {
        archetype: pid, name: this.kit.name, team: 'player' as const, pos, yaw, hp: this.kit.hp, poise: this.kit.poise,
        radius: clamp(fin(visual?.radius, TUNING.move.radius), 0.3, 0.5),
        height: clamp(fin(visual?.height, DEFAULT_HEIGHT[pid]), 1.4, 2.2),
        visual, controller: this.brain, tags: ['persist', 'player'], guardArc: this.kit.guardArc,
      };
      const spawned = this.actors.spawn(desc);
      if (spawned instanceof ActorImpl) this._actor = spawned;
      else {
        // the actor manager is a stub: keep a detached actor so nothing downstream sees junk
        this._actor = new ActorImpl(-1, desc, game.time ?? { now: 0 });
        if (visual && live(game.scene)) game.scene.add(visual.root);
      }
      this.spawned = true;
      this.abilities.bindKit();
      const s = this.saved[pid];
      this.ranged.setAmmo(s.ammo, s.reserve);
      this.melee.bindVisual();
    } else {
      this.actors.revive(this._actor);
      this._actor.pos.set(pos.x, pos.y, pos.z);
      this._actor.yaw = yaw;
    }
    const a = this._actor;
    a._visualY = a.pos.y;
    a.vel.set(0, 0, 0);
    a.impulse.set(0, 0, 0);
    const v = this.visual;
    if (v) {
      if (!same) v.stop();
      v.setVisible(true);
      v.setDissolve(0);
      v.setFrozen(0);
      v.setLoadout({ melee: true, ranged: false });
      v.root.position.copy(a.pos);
      v.root.rotation.y = a.yaw;
      if (isHumanoidVisual(v)) v.teleported();
    }
    this.hidden = false;
    this.state = 'free';
    this.follow.pos = a.pos;
    this.follow.height = a.height * TUNING.move.eyeFraction;
    game.camera.setTarget(this.follow);
    if (first || same) game.camera.snapBehind(a.yaw);
    this.hud.protagonist = pid;
    this.hud.name = this.kit.name;
    this.hud.meleeName = this.kit.meleeName;
    this.hud.rangedName = this.kit.ranged.name;
    this.hud.magSize = this.kit.ranged.mag;
    game.events.emit('player:protagonist', { id: pid });
  }

  private saveKitState(): void {
    const s = this.saved[this._protagonist];
    s.ammo = this.ranged.ammo;
    s.reserve = this.ranged.reserve;
  }

  /**
   * ADDED (polish 3). Settle the protagonist at once, where it stands and facing as it faces: the swing, heavy
   * charge, dodge, deflect, counter or ability in progress is dropped (its clip fades out in 0.15 s, its hit never
   * lands), guard and aim are let go, the lock-on is released and the body stops. Cooldowns, ammo, Echo and held
   * scripted poses are untouched. For a scene taking over the figure: with this, the yaw (and position) it sets
   * from its first frame holds. While `enabled` is false nothing in the controller turns the body anyway — but
   * an action still in progress would otherwise go on moving it.
   */
  cancelAction(): void {
    if (!this.spawned) return;
    const a = this._actor;
    const was = this.state;
    if (was === 'attack' || was === 'charge') this.melee.end();
    this.melee.reset();
    this.guard.drop();
    this.guard.reset();
    if (this.ranged.aiming) this.ranged.setAim(false);
    this.abilities.cancelRunning();
    this.move.settle();
    this.lock.set(null);
    this.bufKind = null;
    a.vel.set(0, 0, 0);
    a.desiredVel.set(0, 0, 0);
    a.carryVel.set(0, 0, 0);
    a.impulse.set(0, 0, 0);
    a.superArmorUntil = 0;
    if (was !== 'free' && was !== 'dead' && was !== 'stagger' && this.actionClip && this.visual) {
      try {
        this.visual.stop(this.actionClip, 0.15);
      } catch (err) {
        warnOnce('cancel:stop', `visual.stop() threw: ${String(err)}`);
      }
    }
    this.actionClip = null;
    if (a.alive && was !== 'stagger') this.state = 'free';
  }

  /** drop every transient state (protagonist switch, teleport, checkpoint restore, death) */
  private cancelAll(): void {
    this.melee.reset();
    this.guard.drop();
    this.guard.reset();
    this.ranged.reset();
    this.abilities.reset();
    this.move.reset();
    this.lock.reset();
    this.bufKind = null;
    this.state = 'free';
    const a = this._actor;
    a.superArmorUntil = 0;
    a.iframesUntil = 0;
  }

  setMovementLocked(locked: boolean): void {
    this.moveLocked = locked === true;
  }

  teleport(pos: Vec3Like, yaw?: number): void {
    if (!pos || !Number.isFinite(pos.x + pos.y + pos.z)) {
      warnOnce('teleport', 'teleport() with a bad position — ignored');
      return;
    }
    const a = this._actor;
    a.pos.set(pos.x, pos.y, pos.z);
    if (yaw !== undefined && Number.isFinite(yaw)) a.yaw = yaw;
    a._visualY = a.pos.y;
    a.vel.set(0, 0, 0);
    a.impulse.set(0, 0, 0);
    this.move.reset();
    const v = this.visual;
    if (v) {
      v.root.position.copy(a.pos);
      v.root.rotation.y = a.yaw;
      if (isHumanoidVisual(v)) v.teleported();
    }
    if (yaw !== undefined) this.game.camera.snapBehind(a.yaw);
  }

  // ---- Echo / health / ammo ---------------------------------------------------------------------------------

  addEcho(amount: number, reason: string): void {
    this.echoBank.add(amount, reason);
  }

  /** pay for an ability */
  spendEcho(cost: number, reason: string): void {
    this.echoBank.set(this.echo - Math.max(0, cost), reason);
  }

  heal(amount: number): void {
    const a = this._actor;
    if (!a.alive || !(amount > 0)) return;
    const before = a.hp;
    a.hp = Math.min(a.maxHp, a.hp + amount);
    const healed = a.hp - before;
    if (healed > 0) this.game.events.emit('player:healed', { amount: healed });
  }

  restoreForCheckpoint(opts?: { echo?: number }): void {
    const a = this._actor;
    if (!this.spawned) return;
    this.cancelAll();
    this.actors.revive(a);
    a.hp = a.maxHp;
    a.poise = a.maxPoise;
    this.ranged.setAmmo(this.kit.ranged.mag, this.kit.ranged.reserve);
    if (opts && typeof opts.echo === 'number') this.echoBank.set(opts.echo, 'checkpoint');
    this.threat = 0;
    this.state = 'free';
    this.visual?.setLoadout({ melee: true, ranged: false });
  }

  setAmmo(mag: number, reserve: number): void {
    this.ranged.setAmmo(mag, reserve);
  }

  // ---- context action -----------------------------------------------------------------------------------------

  setContextAction(action: ContextAction | null): void {
    this.context.set(action);
  }

  aimAt(point: Vec3Like): void {
    this.move.aimCameraAt(point);
  }

  playScripted(action: string, opts?: { faceTo?: Vec3Like }): number {
    const a = this._actor;
    if (opts?.faceTo) a.face(opts.faceTo);
    const v = this.visual;
    if (!v) return 0;
    try {
      return Math.max(0, fin(v.play(action).duration, 0));
    } catch (err) {
      warnOnce(`scripted:${action}`, `playScripted("${action}") threw: ${String(err)}`);
      return 0;
    }
  }

  // ---- hits on / by the protagonist -----------------------------------------------------------------------------

  private onHit(hit: HitInfo, res: HitResult): void {
    if (res.perfect || res.blocked) this.guard.onHit(hit, res);
    if (res.applied > 0) {
      this.game.events.emit('player:damaged', { amount: res.applied, dir: hit.dir ?? { x: 0, y: 0, z: 0 }, hit });
      if (this.state === 'charge') this.melee.interrupt();
    }
    if (res.staggered && this._actor.alive) this.enterStagger();
  }

  private enterStagger(): void {
    this.melee.interrupt();
    this.abilities.interrupt();
    this.guard.drop();
    this.ranged.setAim(false);
    this.bufKind = null;
    this.state = 'stagger';
  }

  private onDeath(): void {
    this.melee.interrupt();
    this.abilities.interrupt();
    this.guard.drop();
    this.ranged.setAim(false);
    this.lock.reset();
    this.bufKind = null;
    this.context.set(null);
    this.state = 'dead';
    const game = this.game;
    game.audio.play('playerDeath');
    game.camera.shake(0.6, 0.6);
    game.input.disengage('guard');
    game.input.disengage('aim');
    game.events.emit('player:died', {});
  }

  /** Echo rules for a hit the protagonist dealt (kills and devices are paid from their events) */
  onDealt(_target: Actor, hit: HitInfo, res: HitResult): void {
    if (res.immune || res.perfect) return;
    if (res.staggered) this.addEcho(0, 'poiseBreak');
    if (hit.heavy && hit.kind === 'melee' && res.applied > 0) this.addEcho(0, 'heavyHit');
    if (hit.kind === 'ranged' && res.applied > 0 && (res.weakPoint || res.flanked)) this.addEcho(0, res.weakPoint ? 'weakPoint' : 'flank');
    else if (res.applied > 0) this.addEcho(0, 'hit');
  }

  // ---- input buffer ---------------------------------------------------------------------------------------------

  private buffer(kind: Buffered): void {
    this.bufKind = kind;
    this.bufAt = this.now;
    // a press made while committed waits for the window to open, then lives the normal buffer time
    this.bufHeld = !(this.state === 'free');
  }

  /** try to start the buffered action. true = the press was used. */
  consumeBuffered(): boolean {
    const kind = this.bufKind;
    if (!kind) return false;
    if (this.bufHeld) {
      this.bufHeld = false;
      this.bufAt = this.now;
    }
    if (this.now - this.bufAt > TUNING.melee.buffer) {
      this.bufKind = null;
      return false;
    }
    let used = false;
    if (kind === 'dodge') used = this.startDodge();
    else if (kind === 'light') {
      if (this.ranged.aiming) {
        used = this.ranged.tryFire();
        // a shot asked for while the weapon cycles is kept until it can fire
        if (!used) this.bufAt = this.now;
      } else used = this.guard.tryCounter() || this.melee.startLight();
    }
    else if (kind === 'heavy') used = this.melee.startHeavy();
    else if (kind === 'ability1') used = this.abilities.activate(0);
    else if (kind === 'ability2') used = this.abilities.activate(1);
    else if (kind === 'guard') used = this.guard.onPress();
    if (used && this.bufKind === kind) this.bufKind = null;
    return used;
  }

  private startDodge(): boolean {
    if (!this.move.canDodge()) return false;
    if (this.state === 'attack' || this.state === 'charge') this.melee.end();
    this.guard.drop();
    this.ranged.setAim(false);
    return this.move.startDodge();
  }

  private readPresses(): void {
    if (this.pressed('dodge')) this.buffer('dodge');
    if (this.pressed('attack')) this.buffer('light');
    if (this.pressed('heavy')) this.buffer('heavy');
    if (this.pressed('ability1')) this.buffer('ability1');
    if (this.pressed('ability2')) this.buffer('ability2');
    if (this.pressed('guard')) this.buffer('guard');
    if (this.pressed('lockOn')) this.lock.toggle();
    if (this.pressed('scan')) this.lock.scan();
    if (this.pressed('reload')) this.ranged.startReload();
  }

  // ---- tick -----------------------------------------------------------------------------------------------------

  update(dt: number): void {
    const game = this.game;
    pickupsOf(game).update(dt);
    if (!this.spawned) return;
    const a = this._actor;
    this.context.tick(dt);
    this.abilities.tick(dt);
    if (!a.alive) {
      this.state = 'dead';
      return;
    }
    const active = this.enabled;
    this.lock.update(dt, active);
    this.move.readIntent(active);
    if (active) this.readPresses();
    else {
      this.bufKind = null;
      this.guard.updateHold(false);
      if (this.ranged.aiming) this.ranged.setAim(false);
    }
    if (a.staggered && this.state !== 'stagger') this.enterStagger();

    switch (this.state) {
      case 'free':
        this.updateFree(dt, active);
        break;
      case 'attack':
        this.melee.updateAttack(dt);
        break;
      case 'charge':
        this.melee.updateCharge(dt);
        break;
      case 'dodge':
        this.move.updateDodge(dt);
        break;
      case 'deflect':
        this.guard.updateDeflect(dt);
        break;
      case 'counter':
        this.guard.updateCounter(dt);
        break;
      case 'ability':
        this.abilities.updateActive(dt);
        break;
      case 'stagger':
        this.move.brake(dt, 80);
        if (!a.staggered) this.state = 'free';
        break;
      default:
        this.state = 'free';
    }
    this.ranged.update(dt);
    this.cues(dt);
  }

  private updateFree(dt: number, active: boolean): void {
    if (active) this.consumeBuffered();
    if (this.state !== 'free') return;
    const guardHeld = active && this.kit.guard === 'hold' && this.engaged('guard');
    this.guard.updateHold(guardHeld);
    const aim = active && !guardHeld && this.engaged('aim');
    if (aim !== this.ranged.aiming) this.ranged.setAim(aim);
    this.move.locomotion(dt, !active ? 'none' : aim ? 'aim' : guardHeld ? 'guard' : 'free');
  }

  /** low-health heartbeat and the wedged-camera fade */
  private cues(dt: number): void {
    const a = this._actor;
    const P = TUNING.player;
    if (a.hp / a.maxHp < P.lowHealth) {
      this.heartbeat -= dt;
      if (this.heartbeat <= 0) {
        this.heartbeat = P.heartbeat;
        this.game.audio.play('playerLow');
      }
    } else this.heartbeat = 0;
    // the camera says how solid the figure may be drawn; a figure pressed against the lens is hidden
    const fade = this.game.camera.playerFade;
    if (typeof fade === 'number' && this.visual && a.alive) {
      const hide = this.hidden ? fade < 0.55 : fade < 0.3;
      if (hide !== this.hidden) {
        this.hidden = hide;
        this.visual.setVisible(!hide);
      }
    }
  }

  getHudState(): PlayerHudState {
    const a = this._actor;
    const h = this.hud;
    h.hp = a.hp;
    h.maxHp = a.maxHp;
    h.poise = a.poise;
    h.maxPoise = Math.max(1, a.maxPoise);
    h.echo = this.echo;
    h.ammo = this.ranged.ammo;
    h.reserve = this.ranged.reserve;
    h.reloading = this.ranged.reloading;
    h.aiming = this.ranged.aiming;
    h.guarding = a.guarding;
    h.lockTarget = this.lock.target;
    h.context = this.context.shown ?? this.guard.hudPrompt;
    h.threat = clamp(fin(this.threat, 0), 0, 1);
    return h;
  }
}
