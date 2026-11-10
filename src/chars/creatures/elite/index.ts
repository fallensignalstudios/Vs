/**
 * Elite — regenerative breach organism: animation + state.
 *
 * Layers evaluated every frame: imposed idle (breathing, weight shift, cadence twitch) → lumbering gait with
 * planted IK feet → look → persistent postures (joint exposed droop, fractured dead arm, regeneration hunch)
 * → action layers (attacks, reactions) → leg/arm IK → trailing tendrils → plates, glow groups.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { EliteVisual } from '@/core/api/creatures';
import { clamp, clamp01, damp, smoothstep, TAU } from '@/core/mathx';
import { gaitFoot, gaitRate, impact, keys, Limb2, move, noise1, rot, win, type GaitOut } from '../core/anim';
import { CreatureBase, type ActionDef, type Slot } from '../core/base';
import { getTemplate } from '../core/rig';
import { buildElite, ELITE_GROUPS, ELITE_MODEL_SCALE, EW as E, TENDRIL_BONES, TENDRIL_COUNT } from './build';

const ACTIONS: Record<string, ActionDef> = {
  idle: { dur: 4, loop: true },
  sweep: { dur: 1.75, hits: [0.82], fade: 0.2, out: 0.3, events: [[0.84, 'step']] },
  groundSlam: { dur: 3.1, hits: [1.62], fade: 0.25, out: 0.35, events: [[1.62, 'impact']] },
  charge: { dur: 2.5, hits: [1.7], fade: 0.2, out: 0.35 },
  roar: { dur: 2.6, fade: 0.2, out: 0.4, events: [[0.6, 'release']] },
  pulse: { dur: 2.7, hits: [1.45], hitName: 'release', fade: 0.25, out: 0.4 },
  regenerate: { dur: 3.2, loop: true, fade: 0.5, out: 0.5 },
  exposeJoint: { dur: 2.2, fade: 0.15, out: 0.4, events: [[0.55, 'impact']] },
  fracture: { dur: 3.2, hits: [0.03], fade: 0.04, out: 0.5, events: [[1.3, 'impact']] },
  hitLight: { dur: 0.4, fade: 0.03, out: 0.15 },
  hitHeavy: { dur: 0.75, fade: 0.04, out: 0.2 },
  stagger: { dur: 1.5, fade: 0.06, out: 0.35 },
  spawn: { dur: 2.4, fade: 0, out: 0.4 },
  death: { dur: 4.4, hold: true, fade: 0.1, events: [[1.9, 'impact']] },
  generic: { dur: 0.6 },
};

const ALIASES: Record<string, string> = {
  attackLight1: 'sweep', attackLight2: 'sweep', attackLight3: 'sweep', attackLight4: 'sweep', attackHeavy: 'groundSlam', attackHeavyCharge: 'groundSlam',
  slam: 'groundSlam', lunge: 'charge', shieldBash: 'charge', linkedSync: 'regenerate', frozen: 'idle', guardBreak: 'stagger', knockdown: 'stagger',
  spawnBreach: 'spawn', spawnDrop: 'spawn', weave: 'regenerate', distress: 'roar',
};

const STRIDE_DUTY = 0.64;
const _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _p = new THREE.Vector3(), _mi = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m4 = new THREE.Matrix4();
const _g: GaitOut = { along: 0, lift: 0, planted: 1 };
const v3 = (p: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

interface Leg {
  limb: Limb2;
  foot: THREE.Bone;
  rest: THREE.Vector3;
  /** per-frame target offsets (model space) written by gait + actions */
  off: THREE.Vector3;
  toe: number;
  planted: number;
}

interface ArmIk {
  limb: Limb2;
  target: THREE.Vector3;
  w: number;
}

export class Elite extends CreatureBase implements EliteVisual {
  onFootfall: ((side: 'L' | 'R', strength: number) => void) | null = null;
  private isFractured = false;
  private fractureBlend = 0;
  private regen = 0;
  private gait = 0;
  private stumpHeat = 0;
  private readonly legs: Leg[];
  private readonly arms: ArmIk[];
  private readonly tendrils: THREE.Bone[][] = [];
  private readonly chestPrev = new THREE.Vector3();
  private readonly chestVel = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private hasPrev = false;
  // per-frame accumulators written by action layers
  private knitLift = 0;
  private knitWave = 0;
  private coreGlow = 0;
  private flare = 0;
  private limp = 0;
  private petalBurst = -1;

  private readonly hips: THREE.Bone; private readonly spine: THREE.Bone; private readonly chest: THREE.Bone;
  private readonly neck: THREE.Bone; private readonly head: THREE.Bone; private readonly jaw: THREE.Bone;
  private readonly ribR: THREE.Bone; private readonly ribL: THREE.Bone;
  private readonly shR: THREE.Bone; private readonly armR: THREE.Bone; private readonly foreR: THREE.Bone;
  private readonly shL: THREE.Bone; private readonly armL: THREE.Bone; private readonly foreL: THREE.Bone;
  private readonly clawR: THREE.Bone[]; private readonly clawL: THREE.Bone[];
  private readonly petals: THREE.Bone[]; private readonly jointCore: THREE.Bone;

  constructor(game: Game | null, opts: CharacterCreateOpts = {}) {
    super(game, {
      archetype: 'elite', height: 3.6, radius: 1.3,
      template: getTemplate('elite', buildElite),
      actions: ACTIONS, aliases: ALIASES, groups: ELITE_GROUPS,
      frostOrigin: [E.shR[0] + 0.1, E.shR[1] + 0.1, E.shR[2]], frostRange: 3.6,
      eclipse: true, baseCorruption: 0.62, veinScale: 0.5, modelScale: ELITE_MODEL_SCALE,
    }, opts);
    const r = this.rig;
    this.hips = r.b('hips'); this.spine = r.b('spine'); this.chest = r.b('chest');
    this.neck = r.b('neck'); this.head = r.b('head'); this.jaw = r.b('jaw');
    this.ribR = r.b('ribR'); this.ribL = r.b('ribL');
    this.shR = r.b('shR'); this.armR = r.b('armR'); this.foreR = r.b('foreR');
    this.shL = r.b('shL'); this.armL = r.b('armL'); this.foreL = r.b('foreL');
    this.clawR = [0, 1, 2].map((i) => r.b('clawR' + i));
    this.clawL = [0, 1, 2].map((i) => r.b('clawL' + i));
    this.petals = [0, 1, 2, 3].map((i) => r.b('petal' + i));
    this.jointCore = r.b('jointCore');
    for (let i = 0; i < TENDRIL_COUNT; i++) {
      const ch: THREE.Bone[] = [];
      for (let j = 0; j < TENDRIL_BONES; j++) ch.push(r.b(`t${i}_${j}`));
      this.tendrils.push(ch);
    }
    const fwd = new THREE.Vector3(0, 0, -1);
    this.legs = [
      { limb: new Limb2(r.group, r.b('thighR'), r.b('shinR'), v3(E.hipR), v3(E.kneeR), v3(E.ankleR), fwd), foot: r.b('footR'), rest: v3(E.ankleR), off: new THREE.Vector3(), toe: 0, planted: 1 },
      { limb: new Limb2(r.group, r.b('thighL'), r.b('shinL'), v3(E.hipL), v3(E.kneeL), v3(E.ankleL), fwd), foot: r.b('footL'), rest: v3(E.ankleL), off: new THREE.Vector3(), toe: 0, planted: 1 },
    ];
    const back = new THREE.Vector3(0.5, 0, 1);
    const backL = new THREE.Vector3(-0.5, 0, 1);
    this.arms = [
      { limb: new Limb2(r.group, this.armR, this.foreR, v3(E.shR), v3(E.elbowR), v3(E.wristR), back), target: new THREE.Vector3(), w: 0 },
      { limb: new Limb2(r.group, this.armL, this.foreL, v3(E.shL), v3(E.elbowL), v3(E.wristL), backL), target: new THREE.Vector3(), w: 0 },
    ];
  }

  // ------------------------------------------------------------------ EliteVisual
  setRegenerating(amount: number): void {
    this.regen = clamp01(amount || 0);
  }

  setFractured(fractured: boolean): void {
    this.isFractured = !!fractured;
    if (!fractured) { this.fractureBlend = 0; this.stumpHeat = 0; }
    else this.fractureBlend = 1;
  }

  get fractured(): boolean {
    return this.isFractured;
  }

  protected override freezeHold(): number {
    // a joint-only arrest slows the body; a full stasis stops it
    return smoothstep(0.05, 0.9, this.frozen);
  }

  protected override lookHeight(): number {
    return 3.35;
  }

  protected override onPlay(name: string): void {
    if (name === 'fracture') {
      this.isFractured = true;
      this.stumpHeat = 1;
      this.petalBurst = 0;
      this.flash(0xffd2a0, 0.3);
    }
  }

  // ------------------------------------------------------------------ pose
  protected override pose(adt: number, dt: number): void {
    const t = this.time;
    const { hips, spine, chest, neck, head } = this;
    const beat = this.cadence.beat();
    const alive = this.dead ? 0 : 1;
    this.knitLift = 0; this.knitWave = 0; this.coreGlow = 0; this.flare = 0; this.limp = 0;
    for (const l of this.legs) { l.off.set(0, 0, 0); l.toe = 0; }
    for (const a of this.arms) a.w = 0;

    // ---- imposed idle: slow breath, weight shift, the cadence hitch every Eclipse body shares
    const breath = Math.sin(t * 1.05);
    const shift = Math.sin(t * 0.42);
    move(hips, shift * 0.06 * alive, breath * 0.012 * alive, 0);
    rot(hips, 0, shift * 0.03 * alive, -shift * 0.025 * alive);
    rot(spine, breath * 0.018 * alive, 0, shift * 0.02 * alive);
    rot(chest, breath * 0.026 * alive, -shift * 0.03 * alive, 0);
    rot(this.shR, 0, 0, (breath * 0.03 + beat * 0.06) * alive);
    rot(this.shL, 0, 0, -(breath * 0.03) * alive);
    rot(this.armR, noise1(t * 0.3) * 0.04, 0, breath * 0.02);
    rot(this.armL, noise1(t * 0.27 + 7) * 0.06, 0, -breath * 0.02);
    rot(this.foreL, 0.08 * Math.sin(t * 0.7 + 1), 0, 0);
    // head: canted and low (imposed posture), ticking on the beat
    rot(neck, -0.06 + noise1(t * 0.2) * 0.04, 0, 0.08 * alive);
    rot(head, -0.1 + noise1(t * 0.33 + 3) * 0.05 + beat * 0.07 * alive, noise1(t * 0.18 + 11) * 0.12 * alive, (0.22 + beat * 0.1) * alive);
    for (let i = 0; i < 3; i++) {
      rot(this.clawR[i]!, (Math.max(0, noise1(t * 0.5 + i * 3)) * 0.2 + beat * 0.14) * alive, 0, 0);
      rot(this.clawL[i]!, (Math.sin(t * 1.3 + i * 1.9) * 0.16 + beat * 0.3) * alive, 0, 0);
    }
    rot(this.jaw, -0.05 - Math.max(0, breath) * 0.04, 0, 0);

    // ---- look
    const ly = clamp(this.lookYaw, -1.0, 1.0), lp = clamp(this.lookPitch, -0.7, 0.5);
    rot(chest, 0, ly * 0.15, 0);
    rot(neck, lp * 0.4, ly * 0.35, 0);
    rot(head, lp * 0.5 + this.aimPitch * 0.4, ly * 0.5, 0);

    // ---- lumbering gait
    const sp = this.speed;
    const mv = smoothstep(0.08, 0.7, sp) * alive;
    const stride = 1.0 + clamp01(sp / 7) * 1.5;
    this.gait += gaitRate(sp, stride, STRIDE_DUTY) * adt;
    const dx = -Math.sin(this.moveYaw), dz = -Math.cos(this.moveYaw);
    const lift = 0.2 + clamp01(sp / 7) * 0.22;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!;
      gaitFoot(this.gait + i * 0.5, stride, lift, STRIDE_DUTY, _g);
      leg.off.x += dx * _g.along * mv;
      leg.off.z += dz * _g.along * mv;
      leg.off.y += _g.lift * mv;
      leg.toe = -_g.lift * 1.6 * mv;
      const planted = mv > 0.3 ? _g.planted : 1;
      if (planted > leg.planted && mv > 0.3 && this.onFootfall) {
        try { this.onFootfall(i === 0 ? 'R' : 'L', clamp01(0.4 + sp / 6)); } catch { /* caller's handler */ }
      }
      leg.planted = planted;
    }
    const ph = this.gait * TAU;
    const swayL = Math.cos(ph - STRIDE_DUTY * Math.PI);
    move(hips, swayL * 0.13 * mv, -(0.5 + 0.5 * Math.cos(ph * 2)) * 0.09 * mv - 0.05 * mv, dz * 0.1 * mv);
    rot(hips, 0, Math.cos(ph) * 0.13 * mv, -swayL * 0.05 * mv);
    rot(spine, -0.1 * mv - clamp01(sp / 7) * 0.15, -Math.cos(ph) * 0.08 * mv, swayL * 0.05 * mv);
    rot(chest, Math.cos(ph * 2) * 0.03 * mv, -Math.cos(ph) * 0.1 * mv, swayL * 0.04 * mv);
    rot(this.armR, -Math.cos(ph) * 0.22 * mv, 0, 0.05 * mv);
    rot(this.foreR, (0.1 + Math.cos(ph - 0.6) * 0.12) * mv, 0, 0);
    rot(this.armL, Math.cos(ph) * 0.32 * mv, 0, -0.05 * mv);
    rot(this.foreL, (0.25 + Math.cos(ph + 0.5) * 0.2) * mv, 0, 0);
    rot(head, 0.12 * mv, Math.cos(ph) * 0.06 * mv, 0);

    // ---- actions
    let exposeAnim = 0;
    for (const s of this.active) exposeAnim = Math.max(exposeAnim, this.applyAction(s));

    // ---- persistent postures
    this.fractureBlend = damp(this.fractureBlend, this.isFractured ? 1 : 0, 3, dt);
    const fr = this.fractureBlend;
    const open = this.isFractured ? 0 : Math.max(this.exposure('joint'), exposeAnim);
    const droop = Math.max(open, fr) * alive;
    if (droop > 0) {
      rot(this.armR, -0.12 * droop, 0, -0.1 * droop);
      rot(this.foreR, -0.32 * droop - 0.1 * fr, 0, 0);
      rot(chest, 0, -0.06 * droop, -0.13 * droop);
      rot(spine, 0, 0, -0.07 * droop);
      move(hips, 0.07 * droop, -0.04 * droop, 0);
      move(this.shR, 0, -0.1 * droop, 0);
      rot(head, 0, -0.2 * open, 0);
      rot(this.armL, 0.35 * open, 0, 0);
      rot(this.foreL, 0.5 * open, 0, 0);
      // a dead arm sways behind the body's motion
      rot(this.armR, Math.sin(t * 1.4) * 0.05 * fr, 0, Math.sin(t * 1.1) * 0.04 * fr);
    }
    const regen = Math.max(this.regen, this.weight('regenerate'));
    if (regen > 0) {
      this.knitWave = Math.max(this.knitWave, regen);
      this.coreGlow += regen * (1.0 + 1.4 * (0.5 + 0.5 * Math.sin(t * 2.6)));
      this.flare += regen * 0.45;
    }

    // exposed core (post-Resonance finish): the ribcage is pulled open around it
    const coreOpen = this.exposure('core') * alive;
    rot(this.ribR, 0, -0.5 * coreOpen, 0);
    rot(this.ribL, 0, 0.5 * coreOpen, 0);

    // ---- IK: legs first (hips are final), then any arm contacts
    this.root.updateWorldMatrix(true, false);
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!;
      _t.copy(leg.rest).add(leg.off);
      _pole.set(i === 0 ? 0.25 : -0.25, 0.15, -1);
      leg.limb.solve(_t, _pole);
      // keep the foot level in model space (plus toe roll while swinging)
      leg.limb.lowerQuat(_q).invert();
      _e.set(leg.toe, 0, 0);
      leg.foot.quaternion.copy(_q).multiply(_q2.setFromEuler(_e));
    }
    for (const a of this.arms) if (a.w > 0.001) a.limb.solve(a.target, _pole.set(a === this.arms[0] ? 0.6 : -0.6, 0.2, 1), a.w);

    // ---- tendrils: writhe, flare, and trail behind the chest's motion
    chest.updateWorldMatrix(true, false);
    _mi.copy(this.rig.group.matrixWorld).invert();
    _p.setFromMatrixPosition(chest.matrixWorld).applyMatrix4(_mi);
    if (this.hasPrev && adt > 1e-5) {
      _t.subVectors(_p, this.chestPrev).multiplyScalar(1 / adt);
      _t.x += this.velX; _t.z += this.velZ;
      _t.clampLength(0, 9);
      this.chestVel[0]!.lerp(_t, 1 - Math.exp(-9 * adt));
      this.chestVel[1]!.lerp(this.chestVel[0]!, 1 - Math.exp(-5 * adt));
      this.chestVel[2]!.lerp(this.chestVel[1]!, 1 - Math.exp(-3 * adt));
    }
    this.chestPrev.copy(_p);
    this.hasPrev = true;
    const life = (1 - this.limp) * alive;
    const flare = this.flare;
    // gravity: undo most of the chest's lean at each root so the tendrils hang, whatever the torso is doing
    this.armL.updateWorldMatrix(true, false);
    _q2.setFromRotationMatrix(_m4.multiplyMatrices(_mi, this.armL.matrixWorld)).invert();
    _q.setFromRotationMatrix(_m4.multiplyMatrices(_mi, chest.matrixWorld)).invert();
    for (let i = 0; i < TENDRIL_COUNT; i++) {
      const ch = this.tendrils[i]!;
      const side = i % 2 === 0 ? 1 : -1;
      ch[0]!.quaternion.identity().slerp(ch[0]!.parent === this.armL ? _q2 : _q, 0.85);
      for (let j = 0; j < TENDRIL_BONES; j++) {
        const v = this.chestVel[Math.min(2, j)]!;
        const amp = 0.07 + j * 0.06;
        const wx = Math.sin(t * 0.9 + i * 1.7 - j * 0.85) * amp * life;
        const wz = Math.cos(t * 0.7 + i * 2.3 - j * 0.9) * amp * life;
        const whip = (j + 1) * 0.045;
        rot(ch[j]!, wx + v.z * whip - (j === 0 ? flare * 0.75 : flare * 0.12) + beat * 0.05 * j * life,
          0, wz - v.x * whip - side * (j === 0 ? flare * 0.4 : 0) + (j === 0 ? this.limp * side * 0.05 : 0));
      }
    }

    // ---- joint petals: always shifting a little, opening when exposed, gone when fractured
    const petalOut: [number, number, number, number, number][] = [
      [-0.1, 0.34, 0.0, 0, 0.55], [0.36, -0.06, 0, 0, -0.55], [0.06, -0.04, -0.34, -0.5, 0], [0.06, -0.04, 0.34, 0.5, 0],
    ];
    for (let i = 0; i < 4; i++) {
      const p = this.petals[i]!, o = petalOut[i]!;
      const idle = (0.5 + 0.5 * Math.sin(t * 0.8 + i * 1.9)) * 0.045 * alive + beat * 0.02;
      const k = open + idle;
      move(p, o[0] * k, o[1] * k, o[2] * k);
      rot(p, o[3] * open, 0, o[4] * open);
      if (this.petalBurst >= 0) {
        // shattered: the plates are thrown clear and shrink out of existence
        const bt = this.petalBurst;
        move(p, o[0] * bt * 9, o[1] * bt * 9 + 2.5 * bt - 6 * bt * bt, o[2] * bt * 9);
        rot(p, bt * (4 + i), bt * 3, bt * (2 + i * 1.5));
        p.scale.setScalar(Math.max(0.0001, 1 - smoothstep(0.35, 0.9, bt)));
      } else if (this.isFractured) p.scale.setScalar(0.0001);
    }
    if (this.petalBurst >= 0) {
      this.petalBurst += adt;
      if (this.petalBurst > 1.2) this.petalBurst = -1;
    }
    this.jointCore.scale.setScalar(1 - 0.5 * fr);
    this.stumpHeat = damp(this.stumpHeat, this.isFractured ? 0.07 : 0, 1.5, adt);

    // ---- shader groups
    const deathW = this.weight('death');
    const on = 1 - smoothstep(0.3, 0.75, deathW) * (this.dead ? 1 : 0);
    this.groupGlow('eye', (0.8 + beat * 0.8 + noise1(t * 3.1) * 0.15) * on);
    this.groupGlow('core', Math.max(0, 0.75 + beat * 0.7 + this.coreGlow + coreOpen * 1.6) * on);
    this.groupGlow('joint', this.isFractured ? 0 : (0.0 + open * (1.05 + beat * 0.5 + Math.sin(t * 5.2) * 0.08)) * on);
    this.groupGlow('stump', this.isFractured ? this.stumpHeat * (6.5 + Math.sin(t * 9) * 1.2) : 0);
    this.groupGlow('nodes', (0.6 + beat * 1.3) * on);
    this.u.uKnit.value.set(0.06 * alive + regen * 0.05, this.knitWave * 0.9, t * 2.6, this.knitLift);
    this.rig.setBoundsCenter(hips.position.x, 2.3 + (hips.position.y - E.hips[1]) * 0.5, hips.position.z, 1.5);
  }

  /** applies one action layer; returns the joint-open amount the action itself drives */
  private applyAction(s: Slot): number {
    const t = s.t, w = s.w;
    const { hips, spine, chest, neck, head, jaw, armR, foreR, armL, foreL, shR, shL, ribR, ribL } = this;
    const [legR, legL] = [this.legs[0]!, this.legs[1]!];
    const k = (arr: readonly number[]): number => keys(t, arr) * w;
    switch (s.name) {
      case 'sweep': {
        const yaw = k([0, 0, 0.55, -0.75, 0.68, -0.8, 0.86, 1.0, 1.05, 1.15, 1.75, 0]);
        rot(chest, 0, yaw * 0.6, 0);
        rot(spine, k([0, 0, 0.55, 0.12, 0.86, -0.3, 1.2, -0.22, 1.75, 0]), yaw * 0.32, 0);
        rot(hips, 0, yaw * 0.2, 0);
        move(hips, 0, k([0, 0, 0.55, -0.12, 0.86, -0.26, 1.75, 0]), k([0.6, 0, 0.86, -0.38, 1.75, 0]));
        rot(armR, 0, k([0, 0, 0.55, -0.7, 0.68, -0.78, 0.86, 1.15, 1.05, 1.45, 1.75, 0]), k([0, 0, 0.5, 1.28, 0.9, 1.22, 1.2, 0.9, 1.75, 0]));
        rot(foreR, k([0, 0, 0.5, 0.55, 0.7, 0.3, 0.86, -0.38, 1.2, -0.2, 1.75, 0]), 0, 0);
        rot(shR, 0, 0, k([0, 0, 0.5, 0.2, 0.9, 0.12, 1.75, 0]));
        for (const c of this.clawR) rot(c, k([0.5, 0, 0.7, -0.5, 1.0, -0.4, 1.75, 0]), 0, 0);
        rot(armL, k([0, 0, 0.55, 0.45, 0.86, -0.5, 1.75, 0]), 0, k([0, 0, 0.55, -0.45, 0.86, -0.25, 1.75, 0]));
        rot(foreL, k([0, 0, 0.55, 0.5, 0.86, 0.2, 1.75, 0]), 0, 0);
        rot(head, 0, -yaw * 0.5, 0);
        legR.off.z += k([0.62, 0, 0.84, -0.62, 1.3, -0.62, 1.75, 0]);
        legR.off.y += (win(t, 0.62, 0.72, 0.76, 0.84) * 0.22 + win(t, 1.4, 1.5, 1.6, 1.72) * 0.12) * w;
        this.flare += Math.abs(yaw) * 0.25;
        return 0;
      }
      case 'groundSlam': {
        const rear = k([0, 0, 1.0, 1, 1.42, 1.06, 1.62, 0]);
        const slam = k([1.46, 0, 1.62, 1, 2.3, 1, 3.1, 0]);
        const tremble = noise1(t * 31) * win(t, 0.85, 1.1, 1.42, 1.5) * w;
        const ring = impact(t, 1.62, 0.22, 34) * w;
        rot(spine, 0.3 * rear - 0.55 * slam + tremble * 0.012, 0, 0);
        rot(chest, 0.28 * rear - 0.36 * slam, 0, tremble * 0.015);
        move(hips, 0, 0.2 * rear - 0.52 * slam + ring * 0.04, 0.1 * rear - 0.3 * slam);
        rot(armR, 2.5 * rear + 0.95 * slam, 0, 0.32 * rear);
        rot(foreR, 0.5 * rear - 0.25 * slam, 0, 0);
        rot(armL, 2.35 * rear + 0.95 * slam, 0, -0.32 * rear);
        rot(foreL, 0.45 * rear, 0, 0);
        rot(shR, 0, 0, 0.25 * rear);
        rot(shL, 0, 0, -0.25 * rear);
        rot(neck, 0.2 * rear - 0.1 * slam, 0, 0);
        rot(head, 0.42 * rear - 0.15 * slam, 0, 0);
        rot(jaw, -0.4 * rear, 0, 0);
        for (const c of this.clawR) rot(c, -0.4 * rear + 0.3 * slam, 0, 0);
        const ik = keys(t, [1.5, 0, 1.62, 1, 2.35, 1, 2.9, 0]) * w;
        this.arms[0]!.w = ik; this.arms[0]!.target.set(0.62, 0.62, -1.8);
        this.arms[1]!.w = ik; this.arms[1]!.target.set(-0.56, 0.5, -1.7);
        this.knitLift += impact(t, 1.62, 0.3) * 0.5 * w;
        this.flare += rear * 0.5;
        this.coreGlow += rear * 0.8;
        return 0;
      }
      case 'charge': {
        const crouch = k([0, 0, 0.55, 1, 0.8, 0.6, 1.6, 0.6, 1.9, 0]);
        const run = win(t, 0.6, 0.85, 1.6, 1.75) * w;
        const check = k([1.58, 0, 1.72, 1, 1.95, 0.6, 2.5, 0]);
        rot(spine, -0.36 * crouch - 0.3 * run + 0.12 * check, 0, 0);
        rot(chest, -0.1 * crouch, -0.45 * crouch - 0.15 * run + 0.95 * check, 0.12 * crouch);
        move(hips, 0, -0.3 * crouch - 0.08 * run, -0.15 * run + 0.25 * check);
        rot(neck, 0.2 * crouch + 0.2 * run, 0, 0);
        rot(head, 0.22 * crouch + 0.2 * run, 0.3 * crouch - 0.5 * check, 0);
        rot(armR, -0.35 * crouch - 0.5 * run + 0.3 * check, 0, 0.15 * run + 0.4 * check);
        rot(foreR, 0.3 * crouch, 0, 0);
        rot(armL, 0.2 * crouch - 0.2 * run + 0.9 * check, 0, -0.1 * crouch - 0.55 * check);
        rot(foreL, 0.9 * crouch + 0.3 * check, 0, 0);
        rot(shL, 0, 0.35 * check, -0.2 * crouch);
        legR.off.z += keys(t, [0.1, 0, 0.5, 0.45, 0.7, 0]) * w;
        legR.off.x += check * 0.22; legL.off.x -= check * 0.22;
        this.flare += run * 0.6;
        return 0;
      }
      case 'roar': {
        const gather = win(t, 0, 0.4, 0.45, 0.7) * w;
        const open = k([0.45, 0, 0.75, 1, 1.8, 1, 2.6, 0]);
        const shake = noise1(t * 27) * open;
        rot(spine, -0.3 * gather + 0.3 * open, 0, shake * 0.012);
        rot(chest, -0.15 * gather + 0.26 * open, shake * 0.02, 0);
        move(hips, 0, -0.22 * gather + 0.14 * open, 0.12 * open);
        rot(armR, 0.3 * gather - 0.4 * open, 0, 0.98 * open);
        rot(foreR, 0.5 * gather + 0.35 * open, 0, 0);
        rot(armL, 0.4 * gather - 0.35 * open, 0, -1.0 * open);
        rot(foreL, 0.6 * gather + 0.5 * open, 0, 0);
        rot(neck, -0.2 * gather + 0.22 * open, 0, 0);
        rot(head, -0.3 * gather + 0.38 * open + shake * 0.03, shake * 0.04, -0.12 * open);
        rot(jaw, -0.75 * open, 0, 0);
        rot(ribR, 0, -0.45 * open, 0);
        rot(ribL, 0, 0.45 * open, 0);
        for (const c of this.clawR) rot(c, -0.5 * open, 0, 0);
        for (const c of this.clawL) rot(c, -0.6 * open, 0, 0);
        this.knitLift += 0.55 * open;
        this.coreGlow += 2.2 * open;
        this.flare += open;
        return 0;
      }
      case 'pulse': {
        const curl = k([0, 0, 1.2, 1, 1.38, 1.06, 1.5, 0]);
        const burst = k([1.38, 0, 1.5, 1, 1.85, 0.7, 2.7, 0]);
        rot(spine, -0.4 * curl + 0.26 * burst, 0, 0);
        rot(chest, -0.3 * curl + 0.3 * burst, 0, 0);
        move(hips, 0, -0.25 * curl + 0.1 * burst, 0.1 * burst);
        rot(neck, -0.2 * curl + 0.2 * burst, 0, 0);
        rot(head, -0.35 * curl + 0.4 * burst, 0, 0);
        rot(jaw, -0.6 * burst, 0, 0);
        rot(armR, 0.55 * curl - 0.4 * burst, -0.5 * curl, -0.12 * curl + 1.0 * burst);
        rot(foreR, 0.85 * curl - 0.2 * burst, 0, 0);
        rot(armL, 0.6 * curl - 0.4 * burst, 0.5 * curl, 0.15 * curl - 1.0 * burst);
        rot(foreL, 1.0 * curl, 0, 0);
        rot(ribR, 0, 0.1 * curl - 0.6 * burst, 0);
        rot(ribL, 0, -0.1 * curl + 0.6 * burst, 0);
        this.knitLift += -0.2 * curl + 0.9 * burst;
        this.coreGlow += 3.4 * curl * curl + 5 * impact(t, 1.45, 0.25) * w - 0.5 * win(t, 1.7, 1.9, 2.3, 2.7) * w;
        this.flare += -0.5 * curl + 1.3 * burst;
        return 0;
      }
      case 'regenerate': {
        const b = Math.sin((t / s.def.dur) * TAU);
        rot(spine, (-0.24 + b * 0.03) * w, 0, 0);
        rot(chest, (-0.14 + b * 0.05) * w, 0, 0);
        move(hips, 0, (-0.2 + b * 0.02) * w, 0);
        rot(neck, -0.15 * w, 0, 0);
        rot(head, -0.25 * w, 0, 0);
        rot(armR, 0.12 * w, 0, 0.08 * w);
        rot(foreR, -0.22 * w, 0, 0);
        rot(armL, 0.2 * w, 0, -0.12 * w);
        rot(foreL, -0.15 * w, 0, 0);
        rot(ribR, 0, -0.2 * (0.5 + 0.5 * b) * w, 0);
        rot(ribL, 0, 0.2 * (0.5 + 0.5 * b) * w, 0);
        return 0;
      }
      case 'exposeJoint': {
        const lurch = impact(t, 0.5, 0.22, 20) * w;
        const drop = k([0, 0, 0.5, 1, 1.7, 1, 2.2, 0]);
        rot(chest, 0.1 * lurch, 0, -0.1 * drop - 0.05 * lurch);
        move(hips, 0, -0.12 * drop - 0.04 * lurch, 0.08 * drop);
        rot(armR, -0.2 * drop, 0, 0.25 * keys(t, [0, 0, 0.25, 1, 0.55, 0]) * w);
        rot(foreR, -0.2 * drop + 0.1 * lurch, 0, 0);
        rot(head, 0.15 * keys(t, [0, 0, 0.3, 1, 0.9, 0]) * w, -0.25 * drop, 0);
        rot(jaw, -0.3 * drop, 0, 0);
        legL.off.z += k([0.1, 0, 0.45, 0.3, 1.8, 0.3, 2.2, 0]);
        legL.off.y += win(t, 0.1, 0.2, 0.3, 0.45) * 0.15 * w;
        return k([0.25, 0, 1.0, 1, 1.85, 1, 2.2, 0]);
      }
      case 'fracture': {
        const recoil = k([0, 0, 0.12, 1, 0.5, 0.8, 1.2, 0.3, 3.2, 0]);
        const kneel = k([0.6, 0, 1.3, 1, 2.3, 1, 3.2, 0]);
        const spasm = noise1(t * 19) * win(t, 0.1, 0.3, 1.8, 2.6) * w;
        rot(chest, 0.42 * recoil - 0.2 * kneel + spasm * 0.03, -0.8 * recoil, 0.2 * recoil);
        rot(spine, 0.3 * recoil - 0.38 * kneel, -0.3 * recoil, spasm * 0.02);
        move(hips, -0.15 * recoil, -0.72 * kneel + impact(t, 1.3, 0.2, 26) * 0.03 * w, 0.55 * recoil + 0.2 * kneel);
        rot(neck, 0.3 * recoil - 0.15 * kneel, 0, 0);
        rot(head, 0.55 * recoil - 0.3 * kneel + spasm * 0.06, 0.4 * recoil, 0.25 * recoil);
        rot(jaw, -0.7 * recoil - 0.2 * kneel, 0, 0);
        rot(armR, -0.75 * recoil, 0, k([0, 0, 0.15, 1.35, 0.6, 0.55, 1.2, 0.1, 3.2, 0]));
        rot(foreR, k([0, 0, 0.15, 0.6, 0.7, -0.3, 3.2, 0]), 0, 0);
        rot(shR, 0, 0, k([0, 0, 0.1, 0.35, 0.8, 0, 3.2, 0]));
        rot(armL, 0.5 * recoil + 0.4 * kneel, 0, -0.5 * recoil);
        rot(foreL, 0.4 * kneel, 0, 0);
        this.arms[1]!.w = keys(t, [0.9, 0, 1.3, 1, 2.3, 1, 2.9, 0]) * w;
        this.arms[1]!.target.set(-0.95, 0.5, -0.8);
        legR.off.z += k([0.08, 0, 0.32, 0.75, 2.6, 0.75, 3.2, 0]);
        legR.off.y += win(t, 0.08, 0.16, 0.22, 0.32) * 0.2 * w;
        legL.off.z += k([0.3, 0, 0.6, 0.95, 2.6, 0.95, 3.2, 0]);
        legL.off.y += win(t, 0.3, 0.4, 0.5, 0.6) * 0.2 * w;
        this.knitLift += impact(t, 0.02, 0.35) * 0.8 * w;
        this.flare += recoil * 0.8;
        this.coreGlow += -0.5 * kneel;
        return 0;
      }
      case 'hitLight':
      case 'hitHeavy': {
        const a = s.name === 'hitHeavy' ? 2.1 : 1;
        const f = impact(t, 0, 0.13, 17) * w * a;
        const e = impact(t, 0, 0.2) * w * a;
        rot(chest, 0.07 * e, 0.06 * f, 0.03 * f);
        rot(spine, 0.05 * e, 0, 0);
        rot(head, 0.12 * f, 0, 0.05 * f);
        rot(shR, 0, 0, 0.06 * f);
        rot(armL, 0.1 * e, 0, 0);
        move(hips, 0, -0.02 * e, 0.05 * e * a);
        this.knitLift += 0.22 * e;
        return 0;
      }
      case 'stagger': {
        const kk = k([0, 0, 0.15, 1, 0.6, 0.7, 1.5, 0]);
        const whipH = impact(t, 0, 0.3, 9) * w;
        rot(chest, 0.38 * kk, 0.15 * kk, 0);
        rot(spine, 0.2 * kk, 0, 0.06 * kk);
        move(hips, 0, -0.1 * kk, 0.38 * kk);
        rot(neck, 0.15 * kk, 0, 0);
        rot(head, 0.45 * whipH, 0, 0.2 * kk);
        rot(jaw, -0.4 * kk, 0, 0);
        rot(armR, 0.5 * kk, 0, 0.25 * kk);
        rot(foreR, -0.2 * kk, 0, 0);
        rot(armL, 0.6 * kk, 0, -0.3 * kk);
        rot(foreL, 0.3 * kk, 0, 0);
        legL.off.z += k([0.08, 0, 0.36, 0.62, 1.1, 0.62, 1.5, 0]);
        legL.off.y += win(t, 0.08, 0.18, 0.26, 0.36) * 0.2 * w;
        this.knitLift += impact(t, 0, 0.3) * 0.4 * w;
        this.flare += kk * 0.5;
        return 0;
      }
      case 'spawn': {
        const low = (1 - keys(t, [0.3, 0, 1.7, 1])) * w;
        const flex = win(t, 1.2, 1.7, 1.9, 2.4) * w;
        rot(spine, -0.5 * low + 0.2 * flex, 0, 0);
        rot(chest, -0.35 * low + 0.2 * flex, 0, 0);
        move(hips, 0, -0.75 * low + 0.1 * flex, 0);
        rot(head, -0.4 * low + 0.3 * flex, 0, 0);
        rot(armR, 0.5 * low, 0, 0.5 * flex);
        rot(foreR, 0.6 * low, 0, 0);
        rot(armL, 0.5 * low, 0, -0.5 * flex);
        rot(foreL, 0.8 * low, 0, 0);
        this.autoDissolve = (1 - keys(t, [0, 0, 1.3, 1])) * (s.state === 2 ? 0 : 1);
        this.knitLift += 0.8 * low + 0.3 * flex;
        this.flare += flex;
        this.coreGlow += 2 * low;
        return 0;
      }
      case 'death': {
        const arch = win(t, 0, 0.35, 0.7, 1.0) * w;
        const fall = k([0.8, 0, 1.9, 1]);
        const settle = k([1.9, 0, 2.7, 1]);
        const thud = impact(t, 1.9, 0.2, 24) * w;
        rot(spine, 0.4 * arch - 0.7 * fall - 0.1 * settle, 0, 0.15 * settle);
        rot(chest, 0.3 * arch - 0.38 * fall, 0.2 * settle, 0.2 * settle);
        move(hips, 0.1 * settle, -0.95 * fall - 0.12 * settle + thud * 0.04, -0.35 * fall);
        rot(hips, -0.25 * fall, 0, 0.22 * settle);
        rot(neck, 0.3 * arch - 0.3 * fall, 0, 0);
        rot(head, 0.7 * arch - 0.45 * fall, 0, 0.3 * settle);
        rot(jaw, -0.7 * arch - 0.35 * settle, 0, 0);
        rot(armR, -0.5 * arch + 0.8 * fall, 0, 0.8 * arch + 0.3 * settle);
        rot(armL, -0.4 * arch + 0.8 * fall, 0, -0.8 * arch - 0.4 * settle);
        rot(foreL, 0.6 * fall, 0, 0);
        const ik = keys(t, [1.3, 0, 1.9, 1]) * w;
        this.arms[0]!.w = ik; this.arms[0]!.target.set(1.1 + 0.3 * settle, 0.6, -1.4 - 0.2 * settle);
        this.arms[1]!.w = ik; this.arms[1]!.target.set(-1.0 - 0.3 * settle, 0.5, -1.25 - 0.25 * settle);
        this.limp = Math.max(this.limp, keys(t, [0.6, 0, 1.6, 1]) * w);
        this.flare += arch * 1.0 - fall * 0.6;
        this.knitLift += keys(t, [1.9, 0, 3.4, 1.5]) * w;
        this.coreGlow += 1.5 * arch - 1.6 * keys(t, [1.0, 0, 2.6, 1]) * w;
        this.autoDissolve = keys(t, [2.7, 0, 4.4, 1]);
        return 0;
      }
      case 'generic': {
        const f = impact(t, 0, 0.2, 12) * w;
        rot(head, 0.12 * f, 0, 0.1 * f);
        rot(chest, 0.04 * f, 0, 0);
        return 0;
      }
      default:
        return 0;
    }
  }
}

export function createElite(game: Game | null, opts?: CharacterCreateOpts): Elite {
  return new Elite(game, opts);
}

export const ELITE_ACTIONS = ACTIONS;
