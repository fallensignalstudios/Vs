/**
 * CreatureBase — the CharacterVisual implementation shared by every creature and device:
 * action slots (blend, events, loops, holds), locomotion smoothing, look target, sockets, and the
 * shader-state setters. Archetypes subclass it and implement `pose()` + an action table.
 */
import * as THREE from 'three';
import type { ActionInfo, AnimAction, Archetype, CharacterCreateOpts, CharacterVisual, Game, PlayOpts, SocketName, Vec3Like } from '@/core/api';
import { clamp, clamp01, damp } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { Rig, warnOnce, type RigTemplate } from './rig';
import { createStateMaterial, GROUPS, type StateUniforms } from './shader';
import { cadenceFor, cadenceRelease, cadenceRetain, type Cadence } from './cadence';

export interface ActionDef {
  /** seconds */
  dur: number;
  loop?: boolean;
  /** keep the final pose until stop() or another play() (deaths, disabled states) */
  hold?: boolean;
  /** seconds at which 'hit' (or `hitName`) fires */
  hits?: readonly number[];
  hitName?: 'hit' | 'release';
  /** extra named events: [seconds, name] */
  events?: readonly (readonly [number, string])[];
  /** default blend-in / blend-out seconds */
  fade?: number;
  out?: number;
}

/** A playing action. `t` is seconds since start, `w` the eased blend weight 0..1. */
export interface Slot {
  name: string;
  def: ActionDef;
  t: number;
  w: number;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  /** 0 = playing, 1 = holding final pose, 2 = fading out */
  state: 0 | 1 | 2;
  raw: number;
  loop: boolean;
  onEvent?: (name: string) => void;
}

export interface CreatureSpec {
  archetype: Archetype;
  height: number;
  radius: number;
  template: RigTemplate;
  actions: Readonly<Record<string, ActionDef>>;
  /** action name → canonical action of this creature */
  aliases?: Readonly<Record<string, string>>;
  /** group name → shader group id (setExposed / group glow) */
  groups?: Readonly<Record<string, number>>;
  /** bind-space origin + range of the frost creep */
  frostOrigin?: readonly [number, number, number];
  frostRange?: number;
  /** Eclipse-made: follows the shared cadence and dissolves on death */
  eclipse?: boolean;
  /** baseline corruption the creature is authored with (setCorruption adds on top, clamped) */
  baseCorruption?: number;
  /** vein pattern frequency multiplier (default 1; big bodies < 1) */
  veinScale?: number;
  /** uniform scale from authored model units to metres (default 1); `height`/`radius` are already in metres */
  modelScale?: number;
}

const GENERIC: ActionDef = { dur: 0.6 };
const _v = new THREE.Vector3();

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
  protected frozen = 0;
  protected corruption = 0;
  protected glow = 1;
  protected dead = false;
  /** part exposure values by name (0..1) */
  protected readonly exposed = new Map<string, number>();
  /** look target in world space (valid when hasLook) */
  protected readonly lookWorld = new THREE.Vector3();
  protected hasLook = false;
  /** look direction in model space, smoothed: yaw (+ = left, toward −X… see lookAngles) and pitch */
  protected lookYaw = 0;
  protected lookPitch = 0;

  private targetSpeed = 0;
  private targetMoveYaw = 0;
  private readonly slots: Slot[] = [];
  private flashT = 0;
  private flashDur = 0.12;
  private flashGain = 1;
  private extDissolve = 0;
  /** dissolve driven by the creature's own death animation (max'ed with the external value) */
  protected autoDissolve = 0;
  private readonly spec: CreatureSpec;
  private readonly material: THREE.MeshStandardMaterial;
  private disposed = false;

  protected constructor(protected readonly game: Game | null, spec: CreatureSpec, opts: CharacterCreateOpts = {}) {
    this.spec = spec;
    this.archetype = spec.archetype;
    const userScale = Number.isFinite(opts.scale) && (opts.scale as number) > 0 ? (opts.scale as number) : 1;
    this.scale = userScale * (spec.modelScale ?? 1);
    this.seed = (opts.seed ?? 1) >>> 0;
    this.variant = opts.variant ?? 0;
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
    this.cadence = cadenceFor(game);
    cadenceRetain();
    this.corruption = clamp01(opts.corruption ?? 0);
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

  play(action: AnimAction, opts: PlayOpts = {}): ActionInfo {
    let name = this.resolve(String(action));
    if (name === null) {
      warnOnce(`${this.archetype}:action:${String(action)}`, `[creatures] ${this.archetype}: unknown action "${String(action)}" — playing a generic gesture`);
      name = 'generic';
    }
    const def = this.spec.actions[name] ?? GENERIC;
    for (const s of this.slots) if (s.state !== 2) { s.state = 2; s.fadeOut = Math.max(0.05, opts.fade ?? def.fade ?? 0.12); }
    while (this.slots.length > 2) this.slots.shift();
    const speed = Number.isFinite(opts.speed) && (opts.speed as number) > 0 ? (opts.speed as number) : 1;
    const slot: Slot = {
      name, def, t: 0, w: 0, raw: 0, speed, state: 0,
      fadeIn: Math.max(0, opts.fade ?? def.fade ?? 0.12),
      fadeOut: def.out ?? 0.25,
      loop: opts.loop ?? !!def.loop,
      onEvent: opts.onEvent,
    };
    if (slot.fadeIn <= 0) { slot.raw = 1; slot.w = 1; }
    this.slots.push(slot);
    this.dead = name === 'death';
    if (!this.dead) this.autoDissolve = 0;
    this.onPlay(name, slot);
    this.fireAt(slot, -1, 0);
    return { duration: def.dur / speed, hitTimes: (def.hits ?? []).map((h) => h / speed), loop: slot.loop };
  }

  stop(action?: AnimAction, fade = 0.2): void {
    const name = action === undefined ? null : this.resolve(String(action)) ?? 'generic';
    for (const s of this.slots) {
      if (s.state === 2) continue;
      if (name === null || s.name === name) { s.state = 2; s.fadeOut = Math.max(0.03, fade); }
    }
    if (name === null || name === 'death') this.dead = false;
  }

  isPlaying(action?: AnimAction): boolean {
    const name = action === undefined ? null : this.resolve(String(action)) ?? 'generic';
    for (const s of this.slots) if (s.state !== 2 && (name === null || s.name === name)) return true;
    return false;
  }

  info(action: AnimAction): ActionInfo {
    const def = this.spec.actions[this.resolve(String(action)) ?? 'generic'] ?? GENERIC;
    return { duration: def.dur, hitTimes: [...(def.hits ?? [])], loop: !!def.loop };
  }

  lookAt(target: Vec3Like | null): void {
    if (target && Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)) {
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
    const c = new THREE.Color(color);
    this.u.uFlash.value.set(c.r, c.g, c.b, 1);
    this.flashDur = Math.max(0.02, seconds);
    this.flashT = this.flashDur;
    this.flashGain = 1;
    try {
      // accessibility contract: whole-figure flashes are toned down, never removed (they confirm hits)
      if (this.game && !isStub(this.game.settings) && this.game.settings.get('reduceFlash') === true) this.flashGain = 0.35;
    } catch { /* settings unavailable */ }
  }

  setFrozen(amount: number): void {
    this.frozen = clamp01(amount || 0);
  }

  setCorruption(amount: number): void {
    this.corruption = clamp01(amount || 0);
  }

  setDissolve(amount: number, color?: number): void {
    this.extDissolve = clamp01(amount || 0);
    if (color !== undefined) this.u.uDissolveColor.value.setHex(color);
  }

  setGlow(amount: number): void {
    this.glow = Number.isFinite(amount) ? Math.max(0, amount) : 1;
  }

  setTelegraph(amount: number, color?: number): void {
    const v = this.u.uTelegraph.value;
    if (color !== undefined) {
      const c = new THREE.Color(color);
      v.set(c.r, c.g, c.b, v.w);
    }
    v.w = clamp01(amount || 0);
  }

  setExposed(part: string, amount: number): void {
    this.exposed.set(String(part), clamp01(amount || 0));
  }

  setRim(amount: number, color?: number): void {
    const v = this.u.uRim.value;
    if (color !== undefined) {
      const c = new THREE.Color(color);
      v.set(c.r, c.g, c.b, v.w);
    }
    v.w = clamp01(amount || 0);
  }

  setVisible(v: boolean): void {
    this.root.visible = !!v;
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);
    const adt = dt * (1 - this.freezeHold());
    this.time += adt;
    this.cadence.tick(dt);

    // locomotion smoothing
    this.speed = damp(this.speed, this.targetSpeed, 9, dt);
    this.moveYaw = this.targetMoveYaw;
    const tvx = -Math.sin(this.moveYaw) * this.targetSpeed, tvz = -Math.cos(this.moveYaw) * this.targetSpeed;
    this.velX = damp(this.velX, tvx, 6, dt);
    this.velZ = damp(this.velZ, tvz, 6, dt);

    // action slots
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i]!;
      this.advance(s, adt, dt);
      if (s.state === 2 && s.raw <= 0) this.slots.splice(i, 1);
    }

    // look target → model-space yaw/pitch
    this.root.updateWorldMatrix(true, false);
    let ty = 0, tp = 0;
    if (this.hasLook && !this.dead) {
      _v.copy(this.lookWorld);
      this.rig.group.worldToLocal(_v);
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

    // uniforms
    const u = this.u;
    u.uTime.value = this.time;
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      u.uFlash.value.w = (this.flashT / this.flashDur) * this.flashGain;
    }
    u.uFrozen.value = this.frozen;
    u.uCorruption.value = clamp01((this.spec.baseCorruption ?? 0) + this.corruption);
    u.uDissolve.value = Math.max(this.extDissolve, this.autoDissolve);
    u.uGlow.value = this.glow;
    u.uBeat.value = this.spec.eclipse || u.uCorruption.value > 0 ? this.cadence.beat() : 0;
    this.rig.mesh.castShadow = u.uDissolve.value < 0.6;
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

  /** evaluate the full pose for this frame; the rig has been reset to rest */
  protected abstract pose(adt: number, dt: number): void;

  /** hook: an action started */
  protected onPlay(_name: string, _slot: Slot): void {}

  /** hook: a named event fired inside an action (before the caller's onEvent) */
  protected onActionEvent(_action: string, _event: string): void {}

  /** 0..1 — how much of the animation clock the frozen state arrests */
  protected freezeHold(): number {
    return clamp01(this.frozen * 1.25);
  }

  /** model-space height the look direction is measured from */
  protected lookHeight(): number {
    return this.spec.height * 0.8;
  }

  /** active slots, oldest first */
  protected get active(): readonly Slot[] {
    return this.slots;
  }

  /** weight of a named action right now (0 when not playing) */
  protected weight(name: string): number {
    let w = 0;
    for (const s of this.slots) if (s.name === name) w = Math.max(w, s.w);
    return w;
  }

  protected exposure(part: string): number {
    return this.exposed.get(part) ?? 0;
  }

  /** set the emissive multiplier of a named part group */
  protected groupGlow(group: string | number, v: number): void {
    const id = typeof group === 'number' ? group : this.spec.groups?.[group];
    if (id === undefined || id < 0 || id >= GROUPS) return;
    this.u.uGroup.value[id] = v;
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
    this.rig.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
