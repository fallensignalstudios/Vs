/**
 * Layered animator: locomotion → looping pose → one-shot action, joined by snapshot cross-fades, then additive
 * breathing / look-at / aim pitch / hit reactions, then the IK solve. One instance per figure.
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
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Additive (non-interrupting) reactions and their nominal durations. */
const REACTIONS: Record<string, number> = { hitLight: 0.32, hitHeavy: 0.5, guardHit: 0.28 };

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
  private pose: Active | null = null;
  private readonly add = new Additive();
  private time = 0;
  private hasOut = false;
  /** animation is held (frozen pose) when true */
  paused = false;

  // look / aim
  private lookActive = false;
  private readonly lookLocal = new THREE.Vector3();
  private lookYaw = 0;
  private lookPitch = 0;
  private aimPitch = 0;
  private aimPitchTarget = 0;

  // reactions
  private readonly hitPitch: Spring = { x: 0, v: 0 };
  private readonly hitYaw: Spring = { x: 0, v: 0 };
  private readonly hitRoll: Spring = { x: 0, v: 0 };
  private readonly hitBack: Spring = { x: 0, v: 0 };
  private readonly kick: Spring = { x: 0, v: 0 };
  private reactName = '';
  private reactLeft = 0;
  private reactCb: ((name: string) => void) | undefined;
  private reactFlip = 1;
  /** breathing amplitude multiplier (injured / exhausted figures breathe harder) */
  breath = 1;
  /** idle head-tilt etc. supplied by the archetype (radians: pitch fwd, yaw left, roll right) */
  readonly headBias = new THREE.Vector3();

  constructor(spec: RigSpec, private readonly resolve: (name: string) => Clip) {
    this.solver = new BodySolver(spec);
  }

  info(action: string): ActionInfo {
    const r = REACTIONS[action];
    if (r !== undefined) return { duration: r, hitTimes: [], loop: false };
    const c = this.resolve(action);
    return { duration: c.duration, hitTimes: c.hitTimes.slice(), loop: c.loop };
  }

  play(action: string, opts: PlayOpts | undefined): ActionInfo {
    const r = REACTIONS[action];
    if (r !== undefined) { this.react(action, r, opts?.onEvent); return { duration: r, hitTimes: [], loop: false }; }
    const clip = this.resolve(action);
    const speed = opts?.speed && opts.speed > 0 ? opts.speed : 1;
    const loop = opts?.loop ?? clip.loop;
    const a: Active = { clip, name: action, time: 0, speed, upperOnly: opts?.upperOnly ?? clip.upperOnly, loop, onEvent: opts?.onEvent, ev: 0, ended: false };
    const lower = !a.upperOnly || (!loop && !!this.shot && !this.shot.upperOnly);
    this.transition(opts?.fade ?? clip.fadeIn, lower);
    if (loop) this.pose = a; else this.shot = a;
    return { duration: clip.duration / speed, hitTimes: clip.hitTimes.map((t) => t / speed), loop };
  }

  stop(action: string | undefined, fade: number | undefined): void {
    const f = fade ?? 0.2;
    if (action === undefined) {
      if (this.shot || this.pose) this.transition(f, true);
      this.shot = null; this.pose = null;
      return;
    }
    if (this.shot && this.shot.name === action) { this.transition(f, !this.shot.upperOnly); this.shot = null; }
    if (this.pose && this.pose.name === action) { this.transition(f, !this.pose.upperOnly); this.pose = null; }
  }

  isPlaying(action: string | undefined): boolean {
    if (action === undefined) return !!this.shot || this.reactLeft > 0;
    return (!!this.shot && this.shot.name === action) || (!!this.pose && this.pose.name === action) || (this.reactLeft > 0 && this.reactName === action);
  }

  /** name of the active looping pose, if any */
  get poseName(): string | null { return this.pose ? this.pose.name : null; }
  get shotName(): string | null { return this.shot ? this.shot.name : null; }

  /** Look target in MODEL space (null = neutral). */
  setLook(local: THREE.Vector3 | null): void {
    this.lookActive = !!local;
    if (local) this.lookLocal.copy(local);
  }

  setAimPitch(p: number): void { this.aimPitchTarget = Math.max(-1.2, Math.min(1.2, Number.isFinite(p) ? p : 0)); }

  private transition(seconds: number, lower: boolean): void {
    if (!this.hasOut) return;
    // if a fade is still running, the snapshot is whatever is on screen right now
    this.snap.copy(this.out);
    this.xfadeLower = lower || (this.xfade < 1 && this.xfadeLower);
    this.xfade = 0;
    this.xfadeDur = Math.max(1e-3, seconds);
  }

  private react(name: string, dur: number, cb: ((name: string) => void) | undefined): void {
    this.reactFlip = -this.reactFlip;
    const f = this.reactFlip;
    if (name === 'hitLight') { this.hitPitch.v -= 5.5; this.hitYaw.v += 3.2 * f; this.hitBack.v += 0.5; }
    else if (name === 'hitHeavy') { this.hitPitch.v -= 10; this.hitYaw.v += 6 * f; this.hitRoll.v += 3 * f; this.hitBack.v += 1.3; }
    else { this.kick.v += 2.4; this.hitPitch.v -= 2.2; this.hitBack.v += 0.5; }
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

  /**
   * Advance and solve. `stance` = carry stance for the current loadout; `opts` = held equipment info.
   * `yawRate` (rad/s) of the root lets the figure lean into turns.
   */
  update(dt: number, stance: StanceSet, opts: SolveOpts, bones: THREE.Bone[], yawRate: number): void {
    const adt = this.paused ? 0 : dt;
    this.time += adt;
    const loco = this.loco;
    loco.turnLean += (Math.max(-0.16, Math.min(0.16, -yawRate * 0.035 * Math.min(1, loco.speed / 5))) - loco.turnLean) * (1 - Math.exp(-6 * adt));
    loco.update(adt);

    if (this.pose) this.advance(this.pose, adt);
    if (this.shot && this.advance(this.shot, adt)) {
      const s = this.shot;
      if (!s.clip.hold) { this.transition(s.clip.fadeOut, !s.upperOnly); this.shot = null; }
      else s.time = s.clip.duration;
      if (!s.ended) { s.ended = true; if (s.onEvent) s.onEvent('end'); }
    }
    if (this.reactLeft > 0) {
      this.reactLeft -= adt;
      if (this.reactLeft <= 0 && this.reactCb) { const cb = this.reactCb; this.reactCb = undefined; cb('end'); }
    }

    // ---- layers ---------------------------------------------------------------------------------------
    const cur = this.cur;
    loco.evaluate(cur, stance);
    if (this.pose) { sampleClip(this.pose.clip, this.pose.time, this.tmp); cur.mix(this.tmp, 1, this.pose.upperOnly ? 0 : 1); }
    if (this.shot) { sampleClip(this.shot.clip, this.shot.time, this.tmp); cur.mix(this.tmp, 1, this.shot.upperOnly ? 0 : 1); }
    const out = this.out;
    if (this.xfade < 1) {
      this.xfade = Math.min(1, this.xfade + adt / this.xfadeDur);
      const w = smooth(this.xfade);
      out.copy(this.snap).mix(cur, w, this.xfadeLower ? w : 1);
    } else out.copy(cur);
    this.hasOut = true;

    // ---- additives --------------------------------------------------------------------------------------
    const add = this.add;
    add.reset();
    const mvQuiet = 1 - Math.min(1, loco.speed / 3) * 0.6;
    const br = Math.sin(this.time * 1.9) * this.breath;
    const k = 1 - Math.exp(-10 * adt);
    this.aimPitch += (this.aimPitchTarget - this.aimPitch) * k;

    // look-at: yaw/pitch of the target relative to the head, clamped and shared down the spine
    let ty = 0, tp = 0;
    if (this.lookActive) {
      const dx = this.lookLocal.x, dy = this.lookLocal.y - 1.66, dz = this.lookLocal.z;
      const flat = Math.hypot(dx, dz);
      if (flat > 0.05) {
        ty = Math.max(-1.25, Math.min(1.25, Math.atan2(-dx, -dz)));
        tp = Math.max(-0.7, Math.min(0.7, Math.atan2(dy, flat)));
      }
    }
    const kl = 1 - Math.exp(-7 * adt);
    this.lookYaw += (ty - this.lookYaw) * kl;
    this.lookPitch += (tp - this.lookPitch) * kl;

    stepSpring(this.hitPitch, 190, 17, adt); stepSpring(this.hitYaw, 170, 16, adt); stepSpring(this.hitRoll, 170, 16, adt);
    stepSpring(this.hitBack, 150, 18, adt); stepSpring(this.kick, 260, 22, adt);

    const ap = this.aimPitch;
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
    add.hip.set(0, br * 0.003 * mvQuiet, this.hitBack.x * 0.12);
    add.handKick.set(0, this.kick.x * 0.02, this.kick.x * 0.09);

    this.solver.solve(out, add, opts);
    this.solver.apply(bones);
  }

  /** Reset transient state (teleport / respawn). */
  reset(): void {
    this.loco.snap();
    this.xfade = 1;
    for (const s of [this.hitPitch, this.hitYaw, this.hitRoll, this.hitBack, this.kick]) { s.x = 0; s.v = 0; }
  }
}
