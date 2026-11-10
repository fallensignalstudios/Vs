/**
 * CreatureBase — the CharacterVisual implementation shared by every creature and device:
 * action slots (blend, events, loops, holds), an additive reaction layer, a terminal death state, freeze /
 * thaw, auto dissolve, locomotion smoothing, look target, sockets, and the shader-state setters.
 * Archetypes subclass it and implement `pose()` + an action table.
 *
 * Action model (documented for callers in src/core/api/creatures.ts):
 *  - MAIN actions cross-fade: starting one fades the previous out and cancels its remaining events.
 *  - REACTIONS (`react: true` — hitLight, hitHeavy, unknown gestures) are additive: they never touch the main
 *    action, so a boss that is chip-hit mid-slam still delivers the slam.
 *  - `death` is terminal: while dead only `death`, a reviving action (`revive: true`, i.e. spawn) or revive()
 *    change anything; hit reactions on a corpse are ignored.
 *  - `idle` is the absence of a main action, not a slot.
 */
import * as THREE from 'three';
import type { ActionInfo, AnimAction, Archetype, CharacterCreateOpts, CharacterVisual, Game, PlayOpts, SocketName, Vec3Like } from '@/core/api';
import { clamp, clamp01, damp, smoothstep, wrapAngle } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { finite3 } from './anim';
import { Rig, warnOnce } from './rig';
import type { ActionDef, CreatureSpec, Slot } from './spec';
import { createStateMaterial, GROUPS, setDissolveActive, type StateUniforms } from './shader';
import { cadenceFor, cadenceRelease, cadenceRetain, type Cadence } from './cadence';


export type { ActionDef, CreatureSpec, Slot } from './spec';

const GENERIC: ActionDef = { dur: 0.6, react: true, ignoreFreeze: true };
const NO_OPTS: PlayOpts = Object.freeze({});
const MAX_SLOTS = 6;
const MAX_REACTS = 3;
const _v = new THREE.Vector3();
const _col = new THREE.Color();

export abstract class CreatureBase implements CharacterVisual {
  readonly archetype: Archetype;
  readonly root = new THREE.Group();
  readonly height: number;
  readonly radius: number;

  protected readonly rig: Rig;
  protected readonly u: StateUniforms;
  protected readonly cadence: Cadence;
  /** rig scale: model units → metres (CharacterCreateOpts.scale × the archetype's modelScale) */
  protected readonly scale: number;
  protected readonly seed: number;
  protected readonly variant: number;

  /** animation clock (seconds, slowed by freeze) */
  protected time = 0;
  /** smoothed planar speed (m/s) + relative move yaw */
  protected speed = 0;
  protected moveYaw = 0;
  protected sprint = false;
  /** smoothed local-space velocity (model axes) for banking / lean */
  protected velX = 0;
  protected velZ = 0;
  protected aimPitch = 0;
  /** frost actually shown / arresting the clock: the caller's setFrozen value minus any thaw in progress */
  protected frozen = 0;
  protected corruption = 0;
  protected glow = 1;
  protected isDead = false;
  /** root yaw change during this update (radians; 0 on teleports) — feeds turn-stepping */
  protected yawDelta = 0;
  /** part exposure values by name (0..1) */
  protected readonly exposed = new Map<string, number>();
  /** look target in world space (valid when hasLook) */
  protected readonly lookWorld = new THREE.Vector3();
  protected hasLook = false;
  /** look direction in model space, smoothed: yaw (+ = left) and pitch */
  protected lookYaw = 0;
  protected lookPitch = 0;
  /** extra materials driven by this creature's uniform block (a skin) */
  protected readonly extraMaterials: THREE.Material[] = [];

  private targetSpeed = 0;
  private targetMoveYaw = 0;
  private readonly slots: Slot[] = [];
  private flashT = 0;
  private flashDur = 0.12;
  private flashGain = 1;
  private extDissolve = 0;
  private frozenAsked = 0;
  private thaw = 0;
  private thawLatch = false;
  private lastYaw = Number.NaN;
  private dissolveOn = false;
  /** dissolve owed to an (interrupted) spawn: follows the spawn, but can only ease away, never snap */
  private spawnVeil = 0;
  private rimUser = 0;
  private readonly rimUserColor = new THREE.Color(1, 1, 1);
  private readonly rimBaseColor = new THREE.Color(1, 1, 1);
  private readonly rimBase: number;
  protected readonly spec: CreatureSpec;
  private readonly material: THREE.MeshStandardMaterial;
  private disposed = false;

  protected constructor(protected readonly game: Game | null, spec: CreatureSpec, opts: CharacterCreateOpts = {}) {
    this.spec = spec;
    this.archetype = spec.archetype;
    const userScale = Number.isFinite(opts.scale) && (opts.scale as number) > 0 ? (opts.scale as number) : 1;
    this.scale = userScale * (spec.modelScale ?? 1);
    this.seed = (Number.isFinite(opts.seed) ? (opts.seed as number) : 1) >>> 0;
    this.variant = Number.isFinite(opts.variant) ? (opts.variant as number) : 0;
    this.height = spec.height * userScale;
    this.radius = spec.radius * userScale;
    let bump = true;
    try {
      if (game && !isStub(game.render) && game.render.quality?.level === 'low') bump = false;
    } catch { /* stub render */ }
    const sm = createStateMaterial(bump);
    this.material = sm.material;
    this.u = sm.uniforms;
    this.rig = new Rig(spec.template, sm.material, spec.archetype);
    this.rig.group.scale.setScalar(this.scale);
    this.root.name = 'creature:' + spec.archetype;
    this.root.add(this.rig.group);
    if (spec.frostOrigin) this.u.uFrostOrigin.value.set(spec.frostOrigin[0], spec.frostOrigin[1], spec.frostOrigin[2]);
    this.u.uFrostRange.value = spec.frostRange ?? spec.template.radius;
    this.u.uVeinScale.value = spec.veinScale ?? 1;
    this.rimBase = clamp01(spec.rim?.[1] ?? 0);
    if (spec.rim) this.rimBaseColor.setHex(spec.rim[0]);
    this.applyRim();
    this.cadence = cadenceFor(game);
    cadenceRetain();
    this.corruption = clamp01(Number.isFinite(opts.corruption) ? (opts.corruption as number) : 0);
    this.time = (this.seed % 97) * 0.37; // desynchronise idle phases between instances
  }

  // ------------------------------------------------------------------ CharacterVisual: locomotion / actions

  setLocomotion(speed: number, moveYaw = 0, opts?: { sprint?: boolean; aiming?: boolean; guarding?: boolean; injured?: boolean }): void {
    this.targetSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    if (Number.isFinite(moveYaw)) this.targetMoveYaw = moveYaw;
    this.sprint = !!opts?.sprint;
  }

  /** canonical action name for this creature, or null when it has no such action */
  protected resolve(action: string): string | null {
    if (this.spec.actions[action]) return action;
    const a = this.spec.aliases?.[action];
    if (a && this.spec.actions[a]) return a;
    return null;
  }

  play(action: AnimAction, opts?: PlayOpts | null): ActionInfo {
    const o = opts ?? NO_OPTS;
    const raw = String(action);
    let name = this.resolve(raw);
    const key = name ?? raw;
    if (name === null) {
      warnOnce(`${this.archetype}:action:${raw}`, `[creatures] ${this.archetype}: unknown action "${raw}" — playing a generic gesture`);
      name = 'generic';
    }
    const def = this.spec.actions[name] ?? GENERIC;
    const speed = Number.isFinite(o.speed) && (o.speed as number) > 0 ? (o.speed as number) : 1;
    const loop = typeof o.loop === 'boolean' ? o.loop : !!def.loop;
    const info: ActionInfo = { duration: def.dur / speed, hitTimes: (def.hits ?? []).map((h) => h / speed), loop };
    const fade = Number.isFinite(o.fade) ? Math.max(0, o.fade as number) : def.fade ?? 0.12;
    const react = !!def.react || name === 'generic';

    if (this.isDead) {
      if (!def.revive) return info; // a corpse stays a corpse: late hits, AoE and stray AI calls change nothing
      this.revive();
    }
    if (name === 'idle') {
      // idle is "no main action": clear whatever is playing and report the idle loop
      this.fadeMain(Math.max(0.05, fade));
      return info;
    }
    if (name === 'death') {
      this.isDead = true;
      this.hasLook = false;
      for (let i = this.slots.length - 1; i >= 0; i--) if (this.slots[i]!.react) this.slots.splice(i, 1);
    }
    if (react) {
      // one slot per reaction kind: a repeat restarts it instead of stacking
      let live = 0;
      for (const s of this.slots) {
        if (!s.react) continue;
        if (s.key === key && s.state !== 2) { s.t = 0; s.speed = speed; s.onEvent = typeof o.onEvent === 'function' ? o.onEvent : undefined; this.onPlay(name, s); return info; }
        live++;
      }
      if (live >= MAX_REACTS) for (const s of this.slots) if (s.react) { s.state = 2; s.fadeOut = 0.05; break; }
    } else {
      this.fadeMain(Math.max(0.05, fade));
    }
    // never pop: an overfull stack hurries its oldest fading slot out over a few frames instead of dropping it
    if (this.slots.length >= MAX_SLOTS) for (const s of this.slots) if (s.state === 2) { s.fadeOut = Math.min(s.fadeOut, 0.04); break; }
    const slot: Slot = {
      name, key, def, t: 0, w: 0, raw: 0, speed, state: 0, react,
      fadeIn: fade,
      fadeOut: def.out ?? 0.25,
      loop,
      onEvent: typeof o.onEvent === 'function' ? o.onEvent : undefined,
    };
    if (slot.fadeIn <= 0) { slot.raw = 1; slot.w = 1; }
    this.slots.push(slot);
    if (def.thaw && this.frozen > 0.02) {
      this.thawLatch = true;
      this.flash(0xcfeeff, 0.18); // the frost shatters
    }
    this.onPlay(name, slot);
    this.fireAt(slot, -1, 0);
    return info;
  }

  private fadeMain(fadeOut: number): void {
    for (const s of this.slots) if (!s.react && s.state !== 2) { s.state = 2; s.fadeOut = fadeOut; }
  }

  stop(action?: AnimAction, fade = 0.2): void {
    if (this.isDead) return; // death is terminal — see revive()
    const f = Number.isFinite(fade) ? Math.max(0.03, fade) : 0.2;
    const key = action === undefined || action === null ? null : this.resolve(String(action)) ?? String(action);
    for (const s of this.slots) {
      if (s.state === 2) continue;
      if (key === null || s.key === key) { s.state = 2; s.fadeOut = f; }
    }
    this.onStop(key);
  }

  isPlaying(action?: AnimAction): boolean {
    if (action === undefined || action === null) {
      for (const s of this.slots) if (!s.react && s.state !== 2) return true;
      return false;
    }
    const key = this.resolve(String(action)) ?? String(action);
    if (key === 'idle') return !this.isDead && !this.isPlaying();
    for (const s of this.slots) if (s.state !== 2 && s.key === key) return true;
    return false;
  }

  info(action: AnimAction): ActionInfo {
    const def = this.spec.actions[this.resolve(String(action)) ?? 'generic'] ?? GENERIC;
    return { duration: def.dur, hitTimes: [...(def.hits ?? [])], loop: !!def.loop };
  }

  /** true from play('death') until revive() / a spawn */
  get dead(): boolean {
    return this.isDead;
  }

  /**
   * Bring a dead (or dissolved) visual back to its living idle: clears every action, the death dissolve, the
   * thaw latch and the telegraph. For pooled visuals and checkpoint reloads.
   */
  revive(): void {
    this.isDead = false;
    this.slots.length = 0;
    this.thawLatch = false;
    this.thaw = 0;
    this.spawnVeil = 0;
    this.u.uTelegraph.value.w = 0;
    this.onRevive();
  }

  lookAt(target: Vec3Like | null): void {
    if (finite3(target) && !this.isDead) {
      this.lookWorld.set(target.x, target.y, target.z);
      this.hasLook = true;
    } else this.hasLook = false;
  }

  setAimPitch(pitch: number): void {
    this.aimPitch = Number.isFinite(pitch) ? clamp(pitch, -1.4, 1.4) : 0;
  }

  socket(name: SocketName): THREE.Object3D {
    return this.rig.sockets.get(String(name)) ?? this.root;
  }

  /** creatures carry no swappable equipment */
  setLoadout(_opts: { melee?: boolean; ranged?: boolean; shield?: boolean; prop?: 'case' | 'rifle' | 'none' }): void {}

  // ------------------------------------------------------------------ CharacterVisual: shader state

  flash(color: number, seconds = 0.12): void {
    _col.set(Number.isFinite(color) ? color : 0xffffff);
    this.u.uFlash.value.set(_col.r, _col.g, _col.b, 1);
    this.flashDur = Number.isFinite(seconds) ? Math.max(0.02, seconds) : 0.12;
    this.flashT = this.flashDur;
    this.flashGain = 1;
    try {
      // accessibility contract: whole-figure flashes are toned down, never removed (they confirm hits)
      if (this.game && !isStub(this.game.settings) && this.game.settings.get('reduceFlash') === true) this.flashGain = 0.35;
    } catch { /* settings unavailable */ }
  }

  setFrozen(amount: number): void {
    this.frozenAsked = clamp01(amount || 0);
    if (this.frozenAsked <= 0) { this.thawLatch = false; this.thaw = 0; }
  }

  setCorruption(amount: number): void {
    this.corruption = clamp01(amount || 0);
  }

  setDissolve(amount: number, color?: number): void {
    this.extDissolve = clamp01(amount || 0);
    if (color !== undefined && Number.isFinite(color)) this.u.uDissolveColor.value.setHex(color);
  }

  setGlow(amount: number): void {
    this.glow = Number.isFinite(amount) ? Math.max(0, amount) : 1;
  }

  setTelegraph(amount: number, color?: number): void {
    const v = this.u.uTelegraph.value;
    if (color !== undefined && Number.isFinite(color)) {
      _col.set(color);
      v.set(_col.r, _col.g, _col.b, v.w);
    }
    v.w = clamp01(amount || 0);
  }

  setExposed(part: string, amount: number): void {
    this.exposed.set(String(part), clamp01(amount || 0));
  }

  setRim(amount: number, color?: number): void {
    if (color !== undefined && Number.isFinite(color)) this.rimUserColor.set(color);
    this.rimUser = clamp01(amount || 0);
    this.applyRim();
  }

  /** the authored baseline rim always shows; a caller's rim layers over it and wins the colour as it rises */
  private applyRim(): void {
    const w = Math.max(this.rimBase, this.rimUser);
    const k = w > 1e-4 ? this.rimUser / w : 0;
    _col.copy(this.rimBaseColor).lerp(this.rimUserColor, k);
    this.u.uRim.value.set(_col.r, _col.g, _col.b, w);
  }

  setVisible(v: boolean): void {
    this.root.visible = !!v;
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);

    // frost: a thawing action melts whatever the caller is still asking for, until they release it
    this.thaw = this.thawLatch ? Math.min(1, this.thaw + dt * 5) : 0;
    this.frozen = this.frozenAsked * (1 - this.thaw);
    const adt = dt * (1 - this.freezeHold());
    this.time += adt;
    this.cadence.tick(dt);

    // root yaw change (turn-stepping); a jump of more than ~70° in one frame is a teleport, not a turn
    const yaw = this.root.rotation.y;
    const dy = Number.isFinite(this.lastYaw) && Number.isFinite(yaw) ? wrapAngle(yaw - this.lastYaw) : 0;
    this.yawDelta = Math.abs(dy) < 1.2 ? dy : 0;
    this.lastYaw = yaw;

    // locomotion smoothing
    this.speed = damp(this.speed, this.targetSpeed, 9, dt);
    this.moveYaw = this.targetMoveYaw;
    const tvx = -Math.sin(this.moveYaw) * this.targetSpeed, tvz = -Math.cos(this.moveYaw) * this.targetSpeed;
    this.velX = damp(this.velX, tvx, 6, dt);
    this.velZ = damp(this.velZ, tvz, 6, dt);
    if (!Number.isFinite(this.speed + this.velX + this.velZ + this.lookYaw + this.lookPitch + this.time)) this.healBase();

    // action slots — these always run (events drive gameplay), even for a hidden visual
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i]!;
      this.advance(s, s.def.ignoreFreeze ? dt : adt, dt);
      if ((s.state === 2 && s.raw <= 0) || !Number.isFinite(s.t + s.raw)) this.slots.splice(i, 1);
    }

    // dissolve + program variant (kept current even while hidden, so a reveal never shows a stale state)
    const u = this.u;
    let auto = 0, veil = 0;
    for (const s of this.slots) {
      const d = s.def;
      if (d.dissolveOut && this.isDead) auto = Math.max(auto, smoothstep(d.dissolveOut[0], d.dissolveOut[1], s.t));
      if (d.dissolveIn && s.state !== 2) veil = Math.max(veil, 1 - smoothstep(0, d.dissolveIn, s.t));
    }
    this.spawnVeil = veil >= this.spawnVeil ? veil : Math.max(veil, this.spawnVeil - dt * 3);
    u.uDissolve.value = Math.max(this.extDissolve, auto, this.spawnVeil);
    const cut = u.uDissolve.value > 0.0005;
    if (cut !== this.dissolveOn) {
      this.dissolveOn = cut;
      setDissolveActive(this.material, cut);
      for (const m of this.extraMaterials) setDissolveActive(m, cut);
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      u.uFlash.value.w = (this.flashT / this.flashDur) * this.flashGain;
    }

    // a hidden visual keeps its clocks but is not posed; a degenerate (zero-scale) frame cannot be posed
    if (!this.root.visible || !this.rig.syncModelSpace()) return;

    // look target → model-space yaw/pitch
    let ty = 0, tp = 0;
    if (this.hasLook && !this.isDead) {
      _v.copy(this.lookWorld).applyMatrix4(this.rig.toModel);
      _v.y -= this.lookHeight();
      const flat = Math.hypot(_v.x, _v.z);
      if (flat > 0.05 || Math.abs(_v.y) > 0.05) {
        ty = Math.atan2(-_v.x, -_v.z);
        tp = Math.atan2(_v.y, Math.max(0.05, flat));
      }
    }
    this.lookYaw = damp(this.lookYaw, ty, 6, adt);
    this.lookPitch = damp(this.lookPitch, tp, 6, adt);

    // pose
    this.rig.reset();
    this.pose(adt, dt);
    if (!this.rig.finite()) {
      // last line of defence: bad input must never latch a broken skeleton
      warnOnce(`${this.archetype}:nan`, `[creatures] ${this.archetype}: non-finite pose — state reset`);
      this.healBase();
      this.heal();
      this.rig.reset();
    }

    // uniforms
    u.uTime.value = this.time;
    u.uFrozen.value = this.frozen;
    u.uCorruption.value = clamp01((this.spec.baseCorruption ?? 0) + this.corruption);
    u.uGlow.value = this.glow;
    u.uBeat.value = this.spec.eclipse || u.uCorruption.value > 0 ? this.cadence.beat() : 0;
    this.setCastShadow(u.uDissolve.value < 0.6);
  }

  private healBase(): void {
    this.speed = 0; this.velX = 0; this.velZ = 0; this.lookYaw = 0; this.lookPitch = 0;
    if (!Number.isFinite(this.time)) this.time = 0;
    this.targetSpeed = Number.isFinite(this.targetSpeed) ? this.targetSpeed : 0;
    this.targetMoveYaw = Number.isFinite(this.targetMoveYaw) ? this.targetMoveYaw : 0;
  }

  private advance(s: Slot, adt: number, dt: number): void {
    // blend weight follows real time so hits read even on a frozen body
    if (s.state === 2) s.raw = Math.max(0, s.raw - dt / s.fadeOut);
    else if (s.raw < 1) s.raw = s.fadeIn > 0 ? Math.min(1, s.raw + dt / s.fadeIn) : 1;
    s.w = s.raw * s.raw * (3 - 2 * s.raw);
    if (s.state === 1) return;
    const t0 = s.t;
    let t1 = t0 + adt * s.speed;
    const dur = s.def.dur;
    if (t1 >= dur) {
      if (s.loop) {
        this.fireAt(s, t0, dur);
        t1 -= dur * Math.floor(t1 / dur);
        s.t = t1;
        this.fireAt(s, -1, t1);
        return;
      }
      this.fireAt(s, t0, dur);
      s.t = dur;
      if (s.state === 0) {
        this.emit(s, 'end');
        if (s.def.hold) s.state = 1;
        else s.state = 2;
      }
      return;
    }
    this.fireAt(s, t0, t1);
    s.t = t1;
  }

  /** fire events with time in (t0, t1] */
  private fireAt(s: Slot, t0: number, t1: number): void {
    if (s.state === 2) return; // interrupted actions never deliver their remaining hits
    const d = s.def;
    if (d.hits) for (const h of d.hits) if (h > t0 && h <= t1) this.emit(s, d.hitName ?? 'hit');
    if (d.events) for (const e of d.events) if (e[0] > t0 && e[0] <= t1) this.emit(s, e[1]);
  }

  private emit(s: Slot, name: string): void {
    this.onActionEvent(s.name, name);
    if (!s.onEvent) return;
    try {
      s.onEvent(name);
    } catch (err) {
      warnOnce(`${this.archetype}:event:${s.name}:${name}`, `[creatures] ${this.archetype}: onEvent('${name}') handler threw: ${String(err)}`);
    }
  }

  // ------------------------------------------------------------------ subclass surface

  /** evaluate the full pose for this frame; the rig has been reset to rest and rig.toModel is current */
  protected abstract pose(adt: number, dt: number): void;

  /** hook: an action started (or a reaction restarted) */
  protected onPlay(_name: string, _slot: Slot): void {}

  /** hook: stop() was called for `key` (null = everything) */
  protected onStop(_key: string | null): void {}

  /** hook: a named event fired inside an action (before the caller's onEvent) */
  protected onActionEvent(_action: string, _event: string): void {}

  /** hook: revive() — reset archetype state that death changed */
  protected onRevive(): void {}

  /** hook: the pose came out non-finite — reset every persistent animation scalar the subclass owns */
  protected heal(): void {}

  /** hook: shadow casting follows the dissolve (a skin overrides to reach its own mesh) */
  protected setCastShadow(on: boolean): void {
    this.rig.mesh.castShadow = on;
  }

  /** 0..1 — how much of the animation clock the frozen state arrests */
  protected freezeHold(): number {
    return clamp01(this.frozen * 1.25);
  }

  /** model-space height the look direction is measured from */
  protected lookHeight(): number {
    return this.spec.height * 0.8;
  }

  /** active slots (main and reactions), oldest first */
  protected get active(): readonly Slot[] {
    return this.slots;
  }

  /** weight of a named action right now (0 when not playing) */
  protected weight(name: string): number {
    let w = 0;
    for (const s of this.slots) if (s.name === name) w = Math.max(w, s.w);
    return w;
  }

  /** seconds into a named action (−1 when it is not playing) */
  protected timeOf(name: string): number {
    for (const s of this.slots) if (s.name === name) return s.t;
    return -1;
  }

  protected exposure(part: string): number {
    return this.exposed.get(part) ?? 0;
  }

  /** set the emissive multiplier of a named part group */
  protected groupGlow(group: string | number, v: number): void {
    const id = typeof group === 'number' ? group : this.spec.groups?.[group];
    if (id === undefined || id < 0 || id >= GROUPS) return;
    this.u.uGroup.value[id] = Number.isFinite(v) ? v : 0;
  }

  /** deterministic per-instance random in [0,1) derived from the seed and a channel */
  protected rnd(channel: number): number {
    const s = Math.sin((this.seed + 1) * 12.9898 + channel * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cadenceRelease();
    this.onDispose();
    this.rig.dispose();
    this.material.dispose();
    for (const m of this.extraMaterials) m.dispose();
    this.root.removeFromParent();
  }

  /** register a material that shares this creature's uniform block (a skin), in step with the dissolve program */
  protected adoptMaterial(m: THREE.Material): void {
    this.extraMaterials.push(m);
    setDissolveActive(m, this.dissolveOn);
  }

  /** hook: free archetype-owned resources */
  protected onDispose(): void {}
}
