/**
 * DeviceBase — shared behaviour of the encounter devices: a smoothed powered-down state (`setDisabled`),
 * a hit wobble spring on the mast, and a deterministic break-apart for 'death' (chunks = bones thrown
 * ballistically, landing and settling on the floor).
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { DeviceVisual } from '@/core/api/creatures';
import { clamp01, damp } from '@/core/mathx';
import { CreatureBase, type ActionDef, type CreatureSpec, type Slot } from '../core/base';

export const DEVICE_ACTIONS: Record<string, ActionDef> = {
  idle: { dur: 2, loop: true },
  hitLight: { dur: 0.45, fade: 0.02 },
  hitHeavy: { dur: 0.7, fade: 0.02 },
  stagger: { dur: 1.4, fade: 0.05, out: 0.3 },
  disabled: { dur: 1.2, hold: true, fade: 0.1 },
  death: { dur: 2.2, hold: true, fade: 0.02, events: [[0.55, 'impact']] },
  generic: { dur: 0.5 },
};

export const DEVICE_ALIASES: Record<string, string> = {
  hover: 'idle', frozen: 'idle', guardHit: 'hitLight', guardBreak: 'stagger', knockdown: 'stagger', disable: 'disabled', interact: 'hitLight',
};

interface Chunk {
  bone: THREE.Bone;
  /** launch velocity (model space, m/s) */
  vx: number; vy: number; vz: number;
  /** spin (rad/s) */
  sx: number; sy: number; sz: number;
  /** how far the chunk can fall before it rests on the floor (metres) */
  drop: number;
  /** resting rotation */
  rx: number; rz: number;
  delay: number;
}

const GRAVITY = 9.8;

export abstract class DeviceBase extends CreatureBase implements DeviceVisual {
  private isDisabled = false;
  /** 0 = live, 1 = fully powered down (smoothed) */
  protected off = 0;
  /** mast wobble spring (radians) */
  protected wobX = 0;
  protected wobZ = 0;
  private wobVX = 0;
  private wobVZ = 0;
  private readonly chunks: Chunk[] = [];

  protected constructor(game: Game | null, spec: CreatureSpec, opts?: CharacterCreateOpts) {
    super(game, spec, opts);
  }

  setDisabled(disabled: boolean): void {
    this.isDisabled = !!disabled;
  }

  get disabled(): boolean {
    return this.isDisabled;
  }

  /** 1 = powered and alive, 0 = dark */
  protected get power(): number {
    return (1 - this.off) * (this.dead ? 0 : 1);
  }

  /**
   * Register a bone as a chunk for the break-apart. `dir` is the rough throw direction; `height` the bone's
   * bind height above the floor (how far it can fall).
   */
  protected addChunk(bone: THREE.Bone, dir: readonly [number, number, number], height: number, index: number, speed = 2.6): void {
    const r = (c: number): number => this.rnd(index * 7 + c) - 0.5;
    this.chunks.push({
      bone,
      vx: dir[0] * speed + r(1) * 1.4, vy: Math.max(0.6, dir[1] * speed + 1.6 + r(2)), vz: dir[2] * speed + r(3) * 1.4,
      sx: r(4) * 9, sy: r(5) * 6, sz: r(6) * 9,
      drop: Math.max(0, height - 0.05),
      rx: (r(7) > 0 ? 1 : -1) * (Math.PI / 2) * (0.7 + Math.abs(r(8)) * 0.6), rz: r(9) * 1.2,
      delay: Math.abs(r(10)) * 0.12,
    });
  }

  protected override onPlay(name: string, _slot: Slot): void {
    if (name === 'hitLight') this.kick(2.2);
    else if (name === 'hitHeavy') this.kick(4.2);
    else if (name === 'stagger') this.kick(5.5);
    else if (name === 'disabled') this.isDisabled = true;
  }

  private kickN = 0;
  private kick(strength: number): void {
    this.kickN++;
    const a = this.rnd(40 + this.kickN) * Math.PI * 2;
    this.wobVX += Math.cos(a) * strength;
    this.wobVZ += Math.sin(a) * strength;
  }

  /** advance the shared device state; call first in pose() */
  protected stepDevice(adt: number, dt: number): void {
    this.off = damp(this.off, this.isDisabled ? 1 : 0, 3.2, dt);
    // damped spring, semi-implicit
    const k = 150, c = 7.5;
    const steps = Math.max(1, Math.ceil(adt / 0.012));
    const h = adt / steps;
    for (let i = 0; i < steps; i++) {
      this.wobVX += (-k * this.wobX - c * this.wobVX) * h;
      this.wobVZ += (-k * this.wobZ - c * this.wobVZ) * h;
      this.wobX += this.wobVX * h;
      this.wobZ += this.wobVZ * h;
    }
  }

  /** throw the registered chunks; `t` = seconds since death started, `w` = action weight */
  protected breakApart(t: number, w: number): void {
    for (const ch of this.chunks) {
      const tt = Math.max(0, t - ch.delay);
      if (tt <= 0) continue;
      // time at which the chunk reaches the floor: -drop = vy t - g t²/2
      const tLand = (ch.vy + Math.sqrt(ch.vy * ch.vy + 2 * GRAVITY * ch.drop)) / GRAVITY;
      const tf = Math.min(tt, tLand);
      const slide = tt > tLand ? (1 - Math.exp(-(tt - tLand) * 5)) * 0.12 : 0;
      const b = ch.bone;
      b.position.x += (ch.vx * tf + ch.vx * slide) * w;
      b.position.z += (ch.vz * tf + ch.vz * slide) * w;
      b.position.y += Math.max(-ch.drop, ch.vy * tf - 0.5 * GRAVITY * tf * tf) * w;
      if (tt < tLand) {
        b.rotation.x += ch.sx * tf * w; b.rotation.y += ch.sy * tf * w; b.rotation.z += ch.sz * tf * w;
      } else {
        const s = clamp01((tt - tLand) * 6);
        const ax = ch.sx * tLand, az = ch.sz * tLand;
        b.rotation.x += (ax + (ch.rx - ax) * s) * w;
        b.rotation.y += ch.sy * tLand * w;
        b.rotation.z += (az + (ch.rz - az) * s) * w;
      }
    }
  }

  /** flicker multiplier while powering down / staggered (1 = steady) */
  protected flickerLight(seedOffset = 0): number {
    const st = this.weight('stagger');
    const dying = this.off > 0.02 && this.off < 0.98 ? 1 : 0;
    const f = Math.sin(this.time * 47 + seedOffset) * Math.sin(this.time * 31.7 + seedOffset * 2);
    const flick = f > 0.1 ? 1 : 0.15;
    return 1 - Math.max(st, dying) * (1 - flick);
  }
}
