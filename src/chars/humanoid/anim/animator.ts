/**
 * Layered animator: locomotion → base pose (full body) → upper-body pose → one-shot action, joined by snapshot
 * cross-fades, then additive breathing / look-at / aim pitch / hit reactions, then the IK solve.
 *
 * Slots:
 *  - base : a looping or held FULL-BODY pose (sit, kneel, lie, death, charge stances …)
 *  - over : a looping or held UPPER-BODY pose (guard, aim, talk, a held hand-over …); it layers on the base, so a
 *           seated figure keeps its seat while it talks
 *  - shot : the one-shot in progress. A `hold` clip that finishes moves into base / over and stays there.
 * One instance per figure.
 */
import * as THREE from 'three';
import type { ActionInfo, PlayOpts } from '@/core/api';
import type { RigSpec } from '../rig';
import { Pose } from './pose';
import { Locomotion, type StanceSet } from './locomotion';
import { Additive, BodySolver, type SolveOpts } from './solver';
import { sampleClip, type Clip } from './clip';

interface Active {
  clip: Clip;
  name: string;
  time: number;
  speed: number;
  upperOnly: boolean;
  loop: boolean;
  onEvent: ((name: string) => void) | undefined;
  ev: number;
  ended: boolean;
}

interface Spring { x: number; v: number }

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _eye = new THREE.Vector3();
const EYE = new THREE.Vector3(0, 0.105, -0.095);
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Additive (non-interrupting) reactions and their nominal durations. */
const REACTIONS: Record<string, number> = { hitLight: 0.32, hitHeavy: 0.5, guardHit: 0.28 };
/** look-at engages inside ENGAGE and lets go beyond RELEASE (bearing from the figure's facing, radians) */
const LOOK_ENGAGE = 1.5, LOOK_RELEASE = 1.75;

function stepSpring(s: Spring, k: number, c: number, dt: number): void {
  // semi-implicit, sub-stepped: stable for any frame time
  let rem = Math.min(dt, 0.1);
  while (rem > 1e-6) {
    const h = Math.min(rem, 1 / 120);
    s.v += (-k * s.x - c * s.v) * h;
    s.x += s.v * h;
    rem -= h;
  }
}

export interface ClipSource {
  resolve(name: string): Clip;
  has(name: string): boolean;
}

export class Animator {
  readonly loco = new Locomotion();
  readonly solver: BodySolver;
  private readonly cur = new Pose();
  private readonly snap = new Pose();
  private readonly tmp = new Pose();
  private readonly out = new Pose();
  private xfade = 1;
  private xfadeDur = 0.12;
  private xfadeLower = true;
  private shot: Active | null = null;
  private base: Active | null = null;
  private over: Active | null = null;
  /** looping pose requested by locomotion flags (guard / aim); yields to explicit upper-body poses */
  private autoName: string | null = null;
  private overAuto = false;
  private readonly add = new Additive();
  private time = 0;
  private hasOut = false;
  /** animation is held (frozen pose) when true; any non-additive play() or stop() releases it */
  paused = false;

  // look / aim
  private lookActive = false;
  private lookOn = false;
  private readonly lookLocal = new THREE.Vector3();
  private lookYaw = 0;
  private lookPitch = 0;
  private aimPitch = 0;
  private aimPitchTarget = 0;
  private aimFix = 0;

  // reactions
  private readonly hitPitch: Spring = { x: 0, v: 0 };
  private readonly hitYaw: Spring = { x: 0, v: 0 };
  private readonly hitRoll: Spring = { x: 0, v: 0 };
  private readonly hitBack: Spring = { x: 0, v: 0 };
  private readonly kick: Spring = { x: 0, v: 0 };
  private readonly springs = [this.hitPitch, this.hitYaw, this.hitRoll, this.hitBack, this.kick];
  private reactName = '';
  private reactLeft = 0;
  private reactCb: ((name: string) => void) | undefined;
  private reactFlip = 1;
  private pushX = 0;
  private pushZ = 1;
  /** breathing amplitude multiplier (injured / exhausted figures breathe harder) */
  breath = 1;
  /** idle head-tilt etc. supplied by the archetype (radians: pitch fwd, yaw left, roll right) */
  readonly headBias = new THREE.Vector3();

  constructor(spec: RigSpec, private readonly clips: ClipSource) {
    this.solver = new BodySolver(spec);
  }

  // ---- queries --------------------------------------------------------------------------------------------

  /** the clip `action` resolves to right now (dodge picks its direction from `dir` / the movement input) */
  private clipFor(action: string, dir: number | undefined): Clip {
    if (action === 'dodge') {
      const d = dir !== undefined && Number.isFinite(dir) ? dir : this.loco.inputSpeed > 0.3 ? this.loco.inputYaw : 0;
      const a = Math.atan2(Math.sin(d), Math.cos(d));
      const name = Math.abs(a) <= 0.87 ? 'dodge' : Math.abs(a) >= 2.27 ? 'dodgeBack' : a > 0 ? 'dodgeLeft' : 'dodgeRight';
      if (name !== 'dodge' && this.clips.has(name)) return this.clips.resolve(name);
    }
    return this.clips.resolve(action);
  }

  /** start offset (seconds) a one-shot gets when it is played out of a charge pose */
  private releaseStart(clip: Clip): number {
    return this.base && this.base.clip.transient && clip.releaseAt > 0 ? Math.min(clip.releaseAt, clip.duration) : 0;
  }

  info(action: string): ActionInfo {
    const r = REACTIONS[action];
    if (r !== undefined) return { duration: r, hitTimes: [], loop: false };
    const c = this.clipFor(action, undefined);
    const t0 = c.loop ? 0 : this.releaseStart(c);
    return { duration: c.duration - t0, hitTimes: c.hitTimes.filter((t) => t >= t0).map((t) => t - t0), loop: c.loop };
  }

  isPlaying(action: string | undefined): boolean {
    if (action === undefined) return !!this.shot || this.reactLeft > 0;
    return (!!this.shot && this.shot.name === action) || (!!this.base && this.base.name === action) || (!!this.over && this.over.name === action)
      || (this.reactLeft > 0 && this.reactName === action);
  }

  /** name of the active upper-body / full-body pose and one-shot, if any */
  get poseName(): string | null { return this.over ? this.over.name : null; }
  get baseName(): string | null { return this.base ? this.base.name : null; }
  get shotName(): string | null { return this.shot ? this.shot.name : null; }
  /** a clip that must play in real time is active (death / knockdown ignore stasis) */
  get thawing(): boolean { return (!!this.shot && this.shot.clip.thaw) || (!!this.base && this.base.clip.thaw && !this.base.ended); }
  /** an active clip needs both hands free */
  get emptyHands(): boolean { return (!!this.shot && this.shot.clip.emptyHands) || (!!this.base && this.base.clip.emptyHands) || (!!this.over && this.over.clip.emptyHands); }
  /** the held weapon has been let go (dead on the floor) */
  get dropped(): boolean {
    const a = this.shot && this.shot.clip.dropAt >= 0 ? this.shot : this.base && this.base.clip.dropAt >= 0 ? this.base : null;
    return !!a && a.time >= a.clip.dropAt;
  }
  /** seat height (reference metres) of the active full-body pose; −1 when standing */
  get seat(): number { return this.base ? this.base.clip.seat : this.shot && !this.shot.upperOnly ? this.shot.clip.seat : -1; }
  /** locomotion owns the legs (no full-body clip, no lower-body cross-fade in flight) */
  get legsFree(): boolean { return !this.base && (!this.shot || this.shot.upperOnly) && !(this.xfade < 1 && this.xfadeLower); }
  /** the upper body is free for the aim loop to steer (aim pose in, nothing recoiling) */
  private get aimSteady(): boolean { return !!this.over && (this.over.name === 'aim' || this.over.name === 'aimRifle') && !this.shot && this.xfade >= 1; }

  // ---- control --------------------------------------------------------------------------------------------

  play(action: string, opts: PlayOpts | undefined): ActionInfo {
    const r = REACTIONS[action];
    if (r !== undefined) { this.react(action, r, opts?.onEvent, opts?.dir); return { duration: r, hitTimes: [], loop: false }; }
    const clip = this.clipFor(action, opts?.dir);
    const speed = opts?.speed && opts.speed > 0 ? opts.speed : 1;
    const loop = opts?.loop ?? clip.loop;
    // the dead stay down: only stop() releases a sticky pose
    if ((this.base && this.base.clip.sticky) || (this.shot && this.shot.clip.sticky)) {
      if (opts?.onEvent) opts.onEvent('cancel');
      return { duration: clip.duration / speed, hitTimes: clip.hitTimes.map((t) => t / speed), loop };
    }
    this.paused = false;
    let t0 = 0;
    if (!loop) {
      const s = opts?.startAt;
      t0 = s !== undefined && Number.isFinite(s) ? clamp(s, 0, clip.duration) : this.releaseStart(clip);
    }
    const a: Active = { clip, name: action, time: t0, speed, upperOnly: opts?.upperOnly ?? clip.upperOnly, loop, onEvent: opts?.onEvent, ev: 0, ended: false };
    while (a.ev < clip.events.length && clip.events[a.ev].t < t0) a.ev++;
    const prev = this.shot;
    const lower = !a.upperOnly || (!loop && !!prev && !prev.upperOnly);
    this.transition(opts?.fade ?? (t0 > 0 ? Math.min(0.06, clip.fadeIn) : clip.fadeIn), lower);
    if (loop) {
      if (a.upperOnly) { this.over = a; this.overAuto = false; }
      else { this.base = a; if (!this.overAuto) this.over = null; }
    } else {
      this.shot = a;
      if (this.base && this.base.clip.transient) this.base = null;
      if (prev && !prev.ended && prev.onEvent) prev.onEvent('cancel');
    }
    return { duration: (clip.duration - t0) / speed, hitTimes: clip.hitTimes.filter((t) => t >= t0).map((t) => (t - t0) / speed), loop };
  }

  /** Looping pose implied by locomotion flags ('guard' / 'aim'); null clears it. Explicit poses win. */
  setAuto(name: string | null): void {
    this.autoName = name;
    if (this.over && !this.overAuto) return;
    if (name === (this.over ? this.over.name : null)) return;
    if (!name) { if (this.over) { this.transition(0.2, false); this.over = null; this.overAuto = false; } return; }
    const clip = this.clips.resolve(name);
    const a: Active = { clip, name, time: 0, speed: 1, upperOnly: true, loop: true, onEvent: undefined, ev: 0, ended: false };
    this.transition(clip.fadeIn, false);
    this.over = a; this.overAuto = true;
  }

  stop(action: string | undefined, fade: number | undefined): void {
    const f = fade ?? 0.2;
    let cancelled: Active | null = null;
    if (action === undefined) {
      if (this.shot || this.base || this.over) this.transition(f, true);
      cancelled = this.shot;
      this.shot = null; this.base = null; this.over = null; this.overAuto = false;
    } else {
      if (this.shot && this.shot.name === action) { this.transition(f, !this.shot.upperOnly); cancelled = this.shot; this.shot = null; }
      if (this.base && this.base.name === action) { this.transition(f, true); this.base = null; }
      if (this.over && this.over.name === action) { this.transition(f, false); this.over = null; this.overAuto = false; }
    }
    // a flag-implied pose resumes as soon as nothing explicit holds the slot
    if (!this.over && this.autoName) { const n = this.autoName; this.autoName = null; this.setAuto(n); }
    if (cancelled && !cancelled.ended && cancelled.onEvent) cancelled.onEvent('cancel');
  }

  /** Look target in MODEL space (null = neutral). */
  setLook(local: THREE.Vector3 | null): void {
    this.lookActive = !!local && Number.isFinite(local.x + local.y + local.z);
    if (local && this.lookActive) this.lookLocal.copy(local);
  }

  setAimPitch(p: number): void { this.aimPitchTarget = clamp(Number.isFinite(p) ? p : 0, -1.2, 1.2); }

  private transition(seconds: number, lower: boolean): void {
    if (!this.hasOut) return;
    // if a fade is still running, the snapshot is whatever is on screen right now
    this.snap.copy(this.out);
    this.xfadeLower = lower || (this.xfade < 1 && this.xfadeLower);
    this.xfade = 0;
    this.xfadeDur = Math.max(1e-3, seconds);
  }

  /** `dir`: the way the body is shoved, relative to facing (0 forward, + left, PI back = hit from the front). */
  private react(name: string, dur: number, cb: ((name: string) => void) | undefined, dir: number | undefined): void {
    this.reactFlip = -this.reactFlip;
    const f = this.reactFlip;
    const d = dir !== undefined && Number.isFinite(dir) ? dir : Math.PI;
    const back = -Math.cos(d), left = Math.sin(d);
    this.pushX = -Math.sin(d); this.pushZ = -Math.cos(d);
    if (name === 'hitLight') { this.hitPitch.v -= 5.5 * back; this.hitYaw.v += 3.2 * f * Math.abs(back) + 2.4 * left; this.hitRoll.v += 2.2 * left; this.hitBack.v += 0.5; }
    else if (name === 'hitHeavy') { this.hitPitch.v -= 10 * back; this.hitYaw.v += 6 * f * Math.abs(back) + 4 * left; this.hitRoll.v += 3 * f * Math.abs(back) + 5 * left; this.hitBack.v += 1.3; }
    else { this.kick.v += 2.4; this.hitPitch.v -= 2.2 * back; this.hitRoll.v += 1.2 * left; this.hitBack.v += 0.5; }
    if (this.reactCb && this.reactLeft > 0) { const old = this.reactCb; this.reactCb = undefined; old('cancel'); }
    this.reactName = name; this.reactLeft = dur; this.reactCb = cb;
  }

  private advance(a: Active, dt: number): boolean {
    const prev = a.time;
    a.time += dt * a.speed;
    const ev = a.clip.events;
    if (a.loop) {
      const dur = a.clip.duration;
      if (a.onEvent && ev.length) {
        const p0 = prev % dur, p1 = a.time % dur;
        for (const e of ev) if (p1 >= p0 ? e.t > p0 && e.t <= p1 : e.t > p0 || e.t <= p1) a.onEvent(e.name);
      }
      return false;
    }
    while (a.ev < ev.length && ev[a.ev].t <= a.time) { const e = ev[a.ev++]; if (a.onEvent) a.onEvent(e.name); }
    return a.time >= a.clip.duration;
  }

  /** Advance clocks and fire events. Returns the dt the pose layers should use. */
  private tick(dt: number, real: number): number {
    const adt = this.paused ? 0 : this.thawing ? real : dt;
    this.time += adt;
    if (this.base && !this.base.ended) this.advance(this.base, adt);
    if (this.over && !this.over.ended) this.advance(this.over, adt);
    const s = this.shot;
    if (s && this.advance(s, adt) && this.shot === s) {
      s.time = s.clip.duration;
      s.ended = true;
      if (s.clip.hold) {
        // a finished hold clip becomes the standing pose of its layer
        this.shot = null;
        if (s.upperOnly) { this.over = s; this.overAuto = false; }
        else { this.base = s; if (!this.overAuto) this.over = null; }
      } else { this.transition(s.clip.fadeOut, !s.upperOnly); this.shot = null; }
      if (s.onEvent) s.onEvent('end');
    }
    if (this.reactLeft > 0) {
      this.reactLeft -= adt;
      if (this.reactLeft <= 0 && this.reactCb) { const cb = this.reactCb; this.reactCb = undefined; cb('end'); }
    }
    return adt;
  }

  /**
   * Advance and solve. `dt` = animation seconds (already scaled by stasis), `real` = unscaled frame seconds.
   * `stance` = carry stance for the current loadout; `opts` = held equipment info; `yawRate` (rad/s) of the root
   * lets the figure lean into turns. With `pose` false only clocks and events advance (invisible figures).
   */
  update(dt: number, real: number, stance: StanceSet, opts: SolveOpts, bones: THREE.Bone[], yawRate: number, pose = true): void {
    const adt = this.tick(dt, real);
    const loco = this.loco;
    loco.turnLean += (clamp(-yawRate * 0.035 * Math.min(1, loco.speed / 5), -0.16, 0.16) - loco.turnLean) * (1 - Math.exp(-6 * adt));
    loco.advance(adt, this.legsFree);
    if (!pose) { this.xfade = 1; for (const s of this.springs) { s.x = 0; s.v = 0; } return; }

    // ---- layers ---------------------------------------------------------------------------------------
    const cur = this.cur;
    loco.evaluate(cur, stance);
    if (this.base) { sampleClip(this.base.clip, this.base.time, this.tmp); cur.mix(this.tmp, 1, 1); }
    if (this.over) { sampleClip(this.over.clip, this.over.time, this.tmp); cur.mix(this.tmp, 1, 0); }
    if (this.shot) { sampleClip(this.shot.clip, this.shot.time, this.tmp); cur.mix(this.tmp, 1, this.shot.upperOnly ? 0 : 1); }
    const out = this.out;
    if (this.xfade < 1) {
      // a double blade looks the same turned end for end: never cross-fade the long way round
      if (opts.ring && this.snap.armIk[1] > 0.5 && cur.armIk[1] > 0.5) {
        const a = this.snap.hand, b = cur.hand;
        _q.set(a[10], a[11], a[12], a[13]); _q2.set(b[10], b[11], b[12], b[13]);
        if (_v.copy(opts.ring).applyQuaternion(_q).dot(_eye.copy(opts.ring).applyQuaternion(_q2)) < -0.2) {
          _q.multiply(_q2.setFromAxisAngle(Y, Math.PI));
          a[10] = _q.x; a[11] = _q.y; a[12] = _q.z; a[13] = _q.w;
        }
      }
      this.xfade = Math.min(1, this.xfade + adt / this.xfadeDur);
      const w = smooth(this.xfade);
      out.copy(this.snap).mix(cur, w, this.xfadeLower ? w : 1);
    } else out.copy(cur);
    this.hasOut = true;

    // ---- additives --------------------------------------------------------------------------------------
    const add = this.add, sv = this.solver, I = sv.spec.index;
    add.reset();
    const mvQuiet = 1 - Math.min(1, loco.speed / 3) * 0.6;
    const br = Math.sin(this.time * 1.9) * this.breath;
    const k = 1 - Math.exp(-10 * adt);
    this.aimPitch += (this.aimPitchTarget - this.aimPitch) * k;
    // aim: close the loop on the barrel the solver produced last frame, so the muzzle points where it was asked
    if (opts.barrel && this.aimSteady) {
      _v.copy(opts.barrel).applyQuaternion(sv.wq[I.handR]);
      this.aimFix = clamp(this.aimFix + (this.aimPitch - Math.asin(clamp(_v.y, -1, 1))) * k, -0.6, 0.6);
    } else if (!this.over || (this.over.name !== 'aim' && this.over.name !== 'aimRifle')) this.aimFix += -this.aimFix * k;

    // look-at: integrate the error between where the head really points and where the target is (head frame),
    // so it holds for any pose — seated, kneeling, mid-swing — and lets go when the target passes behind
    const kl = 1 - Math.exp(-7 * adt);
    let steer = false;
    if (this.lookActive) {
      _eye.copy(EYE).applyQuaternion(sv.wq[I.head]).add(sv.wp[I.head]);
      _v.copy(this.lookLocal).sub(_eye);
      const flat = Math.hypot(_v.x, _v.z);
      if (flat > 0.05 || Math.abs(_v.y) > 0.05) {
        // bearing from the figure's facing (not the head's: the engage test must not chase its own output)
        const b = Math.abs(Math.atan2(-_v.x, -_v.z));
        if (b > LOOK_RELEASE) this.lookOn = false; else if (b < LOOK_ENGAGE) this.lookOn = true;
        if (this.lookOn) {
          _v.applyQuaternion(_q.copy(sv.wq[I.head]).invert());
          this.lookYaw = clamp(this.lookYaw + Math.atan2(-_v.x, -_v.z) * kl, -1.35, 1.35);
          this.lookPitch = clamp(this.lookPitch + Math.atan2(_v.y, Math.hypot(_v.x, _v.z)) * kl, -0.85, 0.85);
          steer = true;
        }
      }
    } else this.lookOn = false;
    if (!steer) { this.lookYaw += -this.lookYaw * kl; this.lookPitch += -this.lookPitch * kl; }

    stepSpring(this.hitPitch, 190, 17, adt); stepSpring(this.hitYaw, 170, 16, adt); stepSpring(this.hitRoll, 170, 16, adt);
    stepSpring(this.hitBack, 150, 18, adt); stepSpring(this.kick, 260, 22, adt);

    const ap = this.aimPitch + this.aimFix;
    const ly = this.lookYaw, lp = this.lookPitch;
    // spine
    _q.setFromAxisAngle(X, ap * 0.42 + this.hitPitch.x * -0.35 + lp * 0.08);
    _q2.setFromAxisAngle(Y, ly * 0.08 + this.hitYaw.x * 0.3);
    add.spine.copy(_q2).multiply(_q);
    // chest (breathing lifts it)
    _q.setFromAxisAngle(X, ap * 0.46 + this.hitPitch.x * -0.65 + lp * 0.12 + br * 0.012 * mvQuiet);
    _q2.setFromAxisAngle(Y, ly * 0.14 + this.hitYaw.x * 0.7);
    add.chest.copy(_q2).multiply(_q);
    _q.setFromAxisAngle(Z, this.hitRoll.x);
    add.chest.multiply(_q);
    // neck / head
    const hb = this.headBias;
    _q.setFromAxisAngle(X, lp * 0.3 - hb.x * 0.4 - br * 0.006);
    _q2.setFromAxisAngle(Y, ly * 0.3 + hb.y * 0.4);
    add.neck.copy(_q2).multiply(_q);
    _q.setFromAxisAngle(X, lp * 0.5 - hb.x * 0.6 + ap * 0.08 + this.hitPitch.x * 0.3);
    _q2.setFromAxisAngle(Y, ly * 0.48 + hb.y * 0.6);
    add.head.copy(_q2).multiply(_q);
    _q.setFromAxisAngle(Z, -hb.z);
    add.head.multiply(_q);
    const push = this.hitBack.x * 0.12;
    add.hip.set(this.pushX * push, br * 0.003 * mvQuiet, this.pushZ * push);
    add.handKick.set(0, this.kick.x * 0.02, this.kick.x * 0.09);

    sv.solve(out, add, opts);
    sv.apply(bones);
  }

  /** Reset transient state (teleport / respawn). */
  reset(): void {
    this.loco.snap();
    this.xfade = 1;
    for (const s of this.springs) { s.x = 0; s.v = 0; }
  }
}
