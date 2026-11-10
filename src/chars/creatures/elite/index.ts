/**
 * Elite — regenerative breach organism: animator + state.
 *
 * Layers evaluated every frame: imposed idle (breathing, weight shift, cadence twitch) → lumbering gait with
 * planted IK feet → look → action layers (./actions) → persistent postures (joint exposed droop, fractured
 * dead arm, regeneration hunch) → ground constraints (body clamp, knees, claws) → turn-stepping → leg / arm IK
 * → trailing tendrils (model-space chains that drape on the floor) → plates, glow groups.
 *
 * The same animator drives two bodies: the procedural rig built in ./build (always available), and — when the
 * generated mesh has been preloaded — a skin retargeted from it every frame (./skin).
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { EliteVisual } from '@/core/api/creatures';
import { clamp, clamp01, damp, smoothstep, TAU } from '@/core/mathx';
import { gaitFoot, gaitRate, groundDeficit, Limb2, move, noise1, PlantYaw, probe, rot, type GaitOut, type GroundProbe } from '../core/anim';
import { CreatureBase, type Slot } from '../core/base';
import { getTemplate } from '../core/rig';
import { getCreatureSkin, loadCreatureSkin, skinsEnabled } from '../core/skinlib';
import { applyEliteAction, ELITE_ACTIONS, ELITE_ALIASES, ELITE_STEPS, type ElitePose } from './actions';
import { buildElite, ELITE_GROUPS, ELITE_MODEL_SCALE, eliteWarp, EW as E, TENDRIL_BONES, TENDRIL_COUNT } from './build';
import { ELITE_SKIN_SIZE, EliteSkin } from './skin';

const STRIDE_DUTY = 0.64;
const TURN_LIMIT = 0.42, TURN_STEP_TIME = 0.36;
const PETAL_OUT: readonly (readonly [number, number, number, number, number])[] = [
  [-0.1, 0.34, 0.0, 0, 0.55], [0.36, -0.06, 0, 0, -0.55], [0.06, -0.04, -0.34, -0.5, 0], [0.06, -0.04, 0.34, 0.5, 0],
];
const _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m4 = new THREE.Matrix4();
const _g: GaitOut = { along: 0, lift: 0, planted: 1 };
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (p: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

/** claw tip offsets in each claw bone's frame, from authoring-space tip positions (see build.ts) */
function clawTips(rig: { restOf(i: number, out: THREE.Vector3): THREE.Vector3; indexOf(b: THREE.Bone): number }, claws: THREE.Bone[], at: (i: number) => [number, number, number]): THREE.Vector3[] {
  return claws.map((c, i) => {
    const p = at(i);
    eliteWarp(p);
    return new THREE.Vector3(p[0], p[1], p[2]).sub(rig.restOf(rig.indexOf(c), new THREE.Vector3()));
  });
}

export interface EliteLegState {
  limb: Limb2;
  foot: THREE.Bone;
  rest: THREE.Vector3;
  off: THREE.Vector3;
  toe: number;
  planted: number;
  plant: PlantYaw;
}

export interface EliteArmState {
  limb: Limb2;
  hand: THREE.Bone;
  /** the three claws and their tips (offsets in each claw bone's frame) */
  claws: THREE.Bone[];
  tips: THREE.Vector3[];
  /** height the wrist must keep above the floor (the knuckle mass under it) */
  clear: number;
  target: THREE.Vector3;
  w: number;
}

interface Tendril {
  bones: THREE.Bone[];
  dir: THREE.Vector3[];
  len: number[];
  onArm: boolean;
}

export class Elite extends CreatureBase implements EliteVisual, ElitePose {
  onFootfall: ((side: 'L' | 'R', strength: number) => void) | null = null;
  private isFractured = false;
  /** 0..1 smoothed fractured state (also read by the skin) */
  fractureBlend = 0;
  private regen = 0;
  private gait = 0;
  private walk = 0;
  private stumpHeat = 0;
  private stepN = 0;
  readonly legs: EliteLegState[];
  readonly arms: EliteArmState[];
  private readonly tendrils: Tendril[] = [];
  private readonly chestPrev = new THREE.Vector3();
  private readonly chestVel = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private hasPrev = false;
  private readonly bodyProbes: GroundProbe[];
  private skin: EliteSkin | null = null;
  private gone = false;
  // per-frame accumulators written by action layers
  knitLift = 0;
  coreGlow = 0;
  flare = 0;
  limp = 0;
  private petalBurst = -1;
  /** joint-open amount this frame (exposure or the exposeJoint action), for the skin */
  jointOpen = 0;

  readonly hips: THREE.Bone; readonly spine: THREE.Bone; readonly chest: THREE.Bone;
  readonly neck: THREE.Bone; readonly head: THREE.Bone; readonly jaw: THREE.Bone;
  readonly ribR: THREE.Bone; readonly ribL: THREE.Bone;
  readonly shR: THREE.Bone; readonly armR: THREE.Bone; readonly foreR: THREE.Bone;
  readonly shL: THREE.Bone; readonly armL: THREE.Bone; readonly foreL: THREE.Bone;
  readonly clawR: THREE.Bone[]; readonly clawL: THREE.Bone[];
  private readonly petals: THREE.Bone[]; private readonly jointCore: THREE.Bone; private readonly stump: THREE.Bone;

  constructor(game: Game | null, opts: CharacterCreateOpts = {}) {
    super(game, {
      archetype: 'elite', height: 3.6, radius: 1.3,
      template: getTemplate('elite', buildElite),
      actions: ELITE_ACTIONS, aliases: ELITE_ALIASES, groups: ELITE_GROUPS,
      frostOrigin: [E.shR[0] + 0.1, E.shR[1] + 0.1, E.shR[2]], frostRange: 3.6,
      eclipse: true, baseCorruption: 0.62, veinScale: 0.5, modelScale: ELITE_MODEL_SCALE,
      rim: [0xb9a8e6, 0.24],
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
    this.jointCore = r.b('jointCore'); this.stump = r.b('stump');
    const a = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < TENDRIL_COUNT; i++) {
      const bones: THREE.Bone[] = [], dir: THREE.Vector3[] = [], len: number[] = [];
      for (let j = 0; j < TENDRIL_BONES; j++) bones.push(r.b(`t${i}_${j}`));
      for (let j = 0; j < TENDRIL_BONES; j++) {
        const k = Math.min(j, TENDRIL_BONES - 2);
        r.restOf(r.indexOf(bones[k]!), a); r.restOf(r.indexOf(bones[k + 1]!), c);
        c.sub(a);
        len.push(c.length());
        dir.push(c.clone().normalize());
      }
      this.tendrils.push({ bones, dir, len, onArm: bones[0]!.parent === this.armL });
    }
    const fwd = new THREE.Vector3(0, 0, -1);
    this.legs = [
      { limb: new Limb2(r.group, r.b('thighR'), r.b('shinR'), v3(E.hipR), v3(E.kneeR), v3(E.ankleR), fwd), foot: r.b('footR'), rest: v3(E.ankleR), off: new THREE.Vector3(), toe: 0, planted: 1, plant: new PlantYaw() },
      { limb: new Limb2(r.group, r.b('thighL'), r.b('shinL'), v3(E.hipL), v3(E.kneeL), v3(E.ankleL), fwd), foot: r.b('footL'), rest: v3(E.ankleL), off: new THREE.Vector3(), toe: 0, planted: 1, plant: new PlantYaw() },
    ];
    this.arms = [
      { limb: new Limb2(r.group, this.armR, this.foreR, v3(E.shR), v3(E.elbowR), v3(E.wristR), new THREE.Vector3(0.5, 0, 1)), hand: r.b('handR'), claws: this.clawR, tips: clawTips(r, this.clawR, (i) => [0.3 * (i - 1) + 1.3, 0.28 + Math.abs(i - 1) * 0.08, -1.02 + Math.abs(i - 1) * 0.1]), clear: 0.32, target: new THREE.Vector3(), w: 0 },
      { limb: new Limb2(r.group, this.armL, this.foreL, v3(E.shL), v3(E.elbowL), v3(E.wristL), new THREE.Vector3(-0.5, 0, 1)), hand: r.b('handL'), claws: this.clawL, tips: clawTips(r, this.clawL, (i) => [0.2 * (i - 1) - 1.1, 0.52 - (i === 1 ? 0.1 : 0) - 0.03, -0.84 + Math.abs(i - 1) * 0.06 - 0.03]), clear: 0.17, target: new THREE.Vector3(), w: 0 },
    ];
    // points of the trunk that must never be driven through the floor, whatever an action does to the hips
    this.bodyProbes = [
      probe(this.hips, E.hips, E.hips, 0.52),
      probe(this.chest, E.chest, [0, E.core[1], E.core[2] - 0.1], 0.36),
      probe(this.chest, E.chest, [0, E.chest[1] + 0.25, -0.4], 0.55),
      probe(this.head, E.head, [0, E.head[1] - 0.05, E.head[2] - 0.2], 0.42),
      probe(this.shR, E.shR, [E.shR[0] + 0.1, E.shR[1], E.shR[2]], 0.62),
      probe(this.shL, E.shL, [E.shL[0] - 0.15, E.shL[1], E.shL[2]], 0.58),
      probe(this.foreR, E.elbowR, E.elbowR, 0.34),
      probe(this.foreL, E.elbowL, E.elbowL, 0.24),
    ];
    this.adoptSkin();
  }

  // ------------------------------------------------------------------ skin (generated mesh)
  /** wear the generated mesh if it is loaded; otherwise ask for it and swap when it arrives */
  private adoptSkin(): void {
    if (!skinsEnabled()) return;
    const ready = getCreatureSkin('elite');
    if (ready) { this.wear(ready); return; }
    void loadCreatureSkin('elite').then((tpl) => { if (tpl && !this.gone && !this.skin && skinsEnabled()) this.wear(tpl); });
  }

  private wear(tpl: NonNullable<ReturnType<typeof getCreatureSkin>>): void {
    try {
      const skin = new EliteSkin(tpl, this.u, this.rig.sockets);
      skin.group.scale.setScalar((this.scale / ELITE_MODEL_SCALE) * ELITE_SKIN_SIZE);
      this.root.add(skin.group);
      this.extraMaterials.push(skin.material);
      this.rig.mesh.visible = false;
      this.skin = skin;
    } catch (err) {
      console.warn('[creatures] elite: generated mesh could not be attached — keeping the procedural body', err);
    }
  }

  get skinned(): boolean {
    return this.skin !== null;
  }

  protected override setCastShadow(on: boolean): void {
    this.rig.mesh.castShadow = on;
    if (this.skin) this.skin.mesh.castShadow = on;
  }

  protected override onDispose(): void {
    this.gone = true;
    this.skin?.dispose();
  }

  // ------------------------------------------------------------------ EliteVisual
  setRegenerating(amount: number): void {
    this.regen = clamp01(amount || 0);
  }

  setFractured(fractured: boolean): void {
    this.isFractured = !!fractured;
    if (!fractured) { this.fractureBlend = 0; this.stumpHeat = 0; this.petalBurst = -1; }
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

  protected override onPlay(name: string, slot: Slot): void {
    if (!slot.react) this.stepN = 0;
    if (name === 'fracture') {
      this.isFractured = true;
      this.stumpHeat = 1;
      this.petalBurst = 0;
      this.flash(0xffd2a0, 0.3);
    }
  }

  protected override onActionEvent(action: string, event: string): void {
    if (event !== 'step') return;
    const s = ELITE_STEPS[action]?.[this.stepN++];
    if (s) this.footfall(s[0], s[1]);
  }

  protected override onRevive(): void {
    this.petalBurst = -1;
    this.hasPrev = false;
    for (const l of this.legs) l.plant.reset();
  }

  protected override heal(): void {
    this.gait = 0; this.walk = 0; this.fractureBlend = this.isFractured ? 1 : 0; this.stumpHeat = 0; this.petalBurst = -1;
    this.hasPrev = false;
    this.chestPrev.set(0, 0, 0);
    for (const v of this.chestVel) v.set(0, 0, 0);
    for (const l of this.legs) { l.plant.reset(); l.planted = 1; }
  }

  private footfall(side: 'L' | 'R', strength: number): void {
    if (!this.onFootfall) return;
    try { this.onFootfall(side, strength); } catch { /* caller's handler */ }
  }

  // ------------------------------------------------------------------ pose
  protected override pose(adt: number, dt: number): void {
    const t = this.time;
    const { hips, spine, chest, neck, head } = this;
    const beat = this.cadence.beat();
    const alive = this.dead ? 0 : 1;
    const inv = 1 / this.scale; // metres → model units
    this.knitLift = 0; this.coreGlow = 0; this.flare = 0; this.limp = 0;
    this.u.uKnit.value.y = 0;
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

    // ---- lumbering gait (stride in metres; foot offsets in model units, so a planted foot holds the world)
    const sp = this.speed;
    const want = smoothstep(0.08, 0.7, sp) * alive;
    if (this.walk < 0.02 && want > 0) this.gait = STRIDE_DUTY * 0.5; // start from a neutral stance, not mid-stride
    this.walk = damp(this.walk, want, 6, dt);
    const mv = this.walk;
    const stride = 1.0 + clamp01(sp / 7) * 1.5;
    this.gait += gaitRate(sp, stride, STRIDE_DUTY) * adt;
    const dx = -Math.sin(this.moveYaw), dz = -Math.cos(this.moveYaw);
    const lift = 0.2 + clamp01(sp / 7) * 0.22;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!;
      gaitFoot(this.gait + i * 0.5, stride, lift, STRIDE_DUTY, _g);
      leg.off.x += dx * _g.along * mv * inv;
      leg.off.z += dz * _g.along * mv * inv;
      leg.off.y += _g.lift * mv;
      leg.toe = -_g.lift * 1.6 * mv;
      const planted = mv > 0.3 ? _g.planted : 1;
      if (planted > leg.planted && mv > 0.3) this.footfall(i === 0 ? 'R' : 'L', clamp01(0.4 + sp / 6));
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
    for (const s of this.active) exposeAnim = Math.max(exposeAnim, applyEliteAction(this, s));

    // ---- persistent postures
    this.fractureBlend = damp(this.fractureBlend, this.isFractured ? 1 : 0, 3, dt);
    const fr = this.fractureBlend;
    const open = this.isFractured ? 0 : Math.max(this.exposure('joint'), exposeAnim);
    this.jointOpen = open;
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
      this.knitWave(regen);
      this.coreGlow += regen * (1.0 + 1.4 * (0.5 + 0.5 * Math.sin(t * 2.6)));
      this.flare += regen * 0.45;
    }
    // exposed core (post-Resonance finish): the ribcage is pulled open around it
    const coreOpen = this.exposure('core') * alive;
    rot(this.ribR, 0, -0.5 * coreOpen, 0);
    rot(this.ribL, 0, 0.5 * coreOpen, 0);

    // ---- ground constraint, trunk: lift the hips by whatever the lowest body probe is short of the floor
    const toModel = this.rig.toModel;
    head.updateWorldMatrix(true, false);
    this.foreR.updateWorldMatrix(true, false);
    this.foreL.updateWorldMatrix(true, false);
    const deficit = groundDeficit(this.bodyProbes, toModel);
    if (deficit > 0) hips.position.y += deficit;

    // ---- turn-stepping: planted feet hold the world while the root yaws, and re-plant one at a time
    const release = Math.max(mv, this.dead ? 1 : 0);
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!, other = this.legs[1 - i]!;
      leg.plant.update(this.yawDelta, dt, !other.plant.stepping && mv < 0.3 && alive > 0, release, TURN_LIMIT, TURN_STEP_TIME);
      if (leg.plant.landed) this.footfall(i === 0 ? 'R' : 'L', 0.5);
    }

    // ---- IK: legs first (hips are final), then any arm contacts
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]!;
      _t.copy(leg.rest).add(leg.off);
      leg.plant.apply(_t);
      _t.y += leg.plant.lift * 0.24;
      _pole.set(i === 0 ? 0.25 : -0.25, 0.15, -1);
      leg.limb.solve(_t, _pole);
      if (leg.limb.joint.y < 0.38) {
        // a folded leg kneels ON the floor: swing the knee up until it clears
        _pole.y += 0.6 + (0.38 - leg.limb.joint.y) * 4;
        leg.limb.solve(_t, _pole);
      }
      // keep the foot level in model space (plus toe roll while swinging, and the yaw it was planted with)
      leg.limb.lowerQuat(_q).invert();
      _e.set(leg.toe - leg.plant.lift * 0.3, leg.plant.phi, 0);
      leg.foot.quaternion.copy(_q).multiply(_q2.setFromEuler(_e));
    }
    for (let i = 0; i < 2; i++) {
      const a = this.arms[i]!;
      if (a.w > 0.001) a.limb.solve(a.target, _pole.set(i === 0 ? 0.6 : -0.6, 0.2, 1), clamp01(a.w));
      // a swinging or half-blended arm must not carry its hand through the floor: pin the wrist at floor height
      a.hand.updateWorldMatrix(true, false);
      _p.setFromMatrixPosition(a.hand.matrixWorld).applyMatrix4(toModel);
      if (_p.y < a.clear) {
        _p.y = a.clear;
        a.limb.solve(_p, _pole.set(i === 0 ? 0.6 : -0.6, 0.2, 1), 1);
      }
      this.liftClaws(a, 0.09);
      this.liftClaws(a, 0.09); // a second pass: lifting one claw can leave a neighbour lowest
    }

    // ---- tendrils, petals, glow
    this.poseTendrils(t, adt, beat, alive);
    this.posePetals(t, adt, beat, alive, open, fr);
    const deathW = this.weight('death');
    const on = 1 - smoothstep(0.3, 0.75, deathW) * (this.dead ? 1 : 0);
    this.groupGlow('eye', (0.8 + beat * 0.8 + noise1(t * 3.1) * 0.15) * on);
    this.groupGlow('core', Math.max(0, 0.75 + beat * 0.7 + this.coreGlow + coreOpen * 1.6) * on);
    this.groupGlow('joint', this.isFractured ? 0 : open * (1.05 + beat * 0.5 + Math.sin(t * 5.2) * 0.08) * on);
    this.groupGlow('stump', this.isFractured ? this.stumpHeat * (6.5 + Math.sin(t * 9) * 1.2) : 0);
    this.groupGlow('nodes', (0.6 + beat * 1.3) * on);
    this.u.uKnit.value.x = 0.06 * alive + regen * 0.05;
    this.u.uKnit.value.z = t * 2.6;
    this.u.uKnit.value.w = this.knitLift;
    this.rig.setBoundsCenter(hips.position.x, 2.3 + (hips.position.y - E.hips[1]) * 0.5, hips.position.z, 1.5);

    if (this.skin) this.skin.update(this, ELITE_MODEL_SCALE / ELITE_SKIN_SIZE, alive, on);
  }

  private knitWave(amount: number): void {
    this.u.uKnit.value.y = Math.max(this.u.uKnit.value.y, amount * 0.9);
  }

  /** rotate a hand so its lowest claw tip rests on the floor instead of passing through it */
  private liftClaws(a: EliteArmState, clear: number): void {
    const hand = a.hand;
    hand.updateWorldMatrix(true, false);
    _m4.multiplyMatrices(this.rig.toModel, hand.matrixWorld);
    _p.setFromMatrixPosition(_m4);
    let low = clear;
    for (let i = 0; i < a.claws.length; i++) {
      const c = a.claws[i]!;
      c.updateWorldMatrix(false, false);
      _t.copy(a.tips[i]!).applyMatrix4(c.matrixWorld).applyMatrix4(this.rig.toModel);
      if (_t.y < low) { low = _t.y; _d.copy(_t); }
    }
    if (low >= clear) return;
    _d.sub(_p);
    const len = _d.length();
    if (len < 1e-4) return;
    const cur = Math.asin(clamp(_d.y / len, -1, 1));
    const need = Math.asin(clamp((clear - _p.y) / len, -1, 1));
    if (need <= cur) return;
    _n.crossVectors(_d, UP);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0);
    // model-space delta, conjugated into the hand's parent frame
    _q.setFromAxisAngle(_n.normalize(), need - cur);
    _qp.setFromRotationMatrix(_m4).multiply(_q2.copy(hand.quaternion).invert());
    hand.quaternion.premultiply(_q2.copy(_qp).invert().multiply(_q).multiply(_qp));
  }

  /**
   * Tendrils are solved as chains in model space: each segment takes a direction (hang + writhe + flare +
   * drag behind the chest's motion), the end point is kept on or above the floor, and only then is the
   * direction turned into a bone rotation — so a collapsed body's tendrils lie along the ground.
   */
  private poseTendrils(t: number, adt: number, beat: number, alive: number): void {
    const { chest, armL } = this;
    const toModel = this.rig.toModel;
    chest.updateWorldMatrix(true, false);
    armL.updateWorldMatrix(true, false);
    _p.setFromMatrixPosition(_m4.multiplyMatrices(toModel, chest.matrixWorld));
    if (this.hasPrev && adt > 1e-5) {
      _t.subVectors(_p, this.chestPrev).multiplyScalar(1 / adt);
      _t.x += this.velX; _t.z += this.velZ;
      if (Number.isFinite(_t.x + _t.y + _t.z)) {
        _t.clampLength(0, 9);
        this.chestVel[0]!.lerp(_t, 1 - Math.exp(-9 * adt));
        this.chestVel[1]!.lerp(this.chestVel[0]!, 1 - Math.exp(-5 * adt));
        this.chestVel[2]!.lerp(this.chestVel[1]!, 1 - Math.exp(-3 * adt));
      }
    }
    if (Number.isFinite(_p.x + _p.y + _p.z)) { this.chestPrev.copy(_p); this.hasPrev = true; }
    const life = (1 - this.limp) * alive;
    const flare = this.flare;
    for (let i = 0; i < TENDRIL_COUNT; i++) {
      const td = this.tendrils[i]!;
      const parent = td.onArm ? armL : chest;
      _m4.multiplyMatrices(toModel, parent.matrixWorld);
      _p.copy(td.bones[0]!.position).applyMatrix4(_m4); // root, model space
      _qp.setFromRotationMatrix(_m4);                  // parent orientation, model space
      const rx = _p.x, rz = _p.z - 0.3;
      const rl = Math.hypot(rx, rz) || 1;
      for (let j = 0; j < TENDRIL_BONES; j++) {
        const rest = td.dir[j]!, v = this.chestVel[Math.min(2, j)]!;
        const amp = (0.1 + j * 0.07) * life;
        const out = flare * (j === 0 ? 0.9 : 0.45);
        _d.set(
          rest.x * 0.5 + Math.sin(t * 0.9 + i * 1.7 - j * 0.85) * amp - v.x * 0.05 * (j + 1) + (rx / rl) * out,
          -1 + flare * (0.75 - j * 0.14) + clamp(-v.y * 0.04 * (j + 1), -0.4, 0.7) + beat * 0.04 * j * life,
          rest.z * 0.5 + 0.2 + Math.cos(t * 0.7 + i * 2.3 - j * 0.9) * amp - v.z * 0.05 * (j + 1) + (rz / rl) * out,
        ).normalize();
        const len = td.len[j]!, floor = 0.07 - j * 0.012;
        if (_p.y + _d.y * len < floor) {
          // the segment would end under the floor: lay it down, keeping its heading
          const dy = clamp((floor - _p.y) / len, -1, 1);
          const h = Math.hypot(_d.x, _d.z);
          const k = h > 1e-4 ? Math.sqrt(1 - dy * dy) / h : 0;
          if (k > 0) _d.set(_d.x * k, dy, _d.z * k);
          else _d.set((rx / rl) * Math.sqrt(1 - dy * dy), dy, (rz / rl) * Math.sqrt(1 - dy * dy));
        }
        _q.setFromUnitVectors(rest, _d);
        td.bones[j]!.quaternion.copy(_q2.copy(_qp).invert().multiply(_q));
        _qp.copy(_q);
        _p.addScaledVector(_d, len);
      }
    }
  }

  /** joint petals: always shifting a little, opening when exposed, thrown clear when the joint shatters */
  private posePetals(t: number, adt: number, beat: number, alive: number, open: number, fr: number): void {
    for (let i = 0; i < 4; i++) {
      const p = this.petals[i]!, o = PETAL_OUT[i]!;
      const idle = (0.5 + 0.5 * Math.sin(t * 0.8 + i * 1.9)) * 0.045 * alive + beat * 0.02;
      const k = open + idle;
      move(p, o[0] * k, o[1] * k, o[2] * k);
      rot(p, o[3] * open, 0, o[4] * open);
      if (this.petalBurst >= 0) {
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
    this.jointCore.scale.setScalar(Math.max(0.0001, 1 - 0.75 * fr));
    this.stump.scale.setScalar(Math.max(0.0001, fr));
    this.stumpHeat = damp(this.stumpHeat, this.isFractured ? 0.07 : 0, 1.5, adt);
  }
}

export function createElite(game: Game | null, opts?: CharacterCreateOpts): Elite {
  return new Elite(game, opts);
}

export { ELITE_ACTIONS };
