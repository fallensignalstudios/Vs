/**
 * Reformation encounter devices — temporary, modular equipment standing inside ancient space:
 *  - commandEmitter (E1): tripod with a rotating emitter crown and two aiming prongs that track the pair of
 *    drones it synchronises.
 *  - relayReceiver (E2): crate + mast + antenna. Variant 0 "A" carries one large round dish; variant 1 "B" a
 *    vertical ladder of hex panels under a T-bar — told apart by shape alone.
 *  - scanHead (Z03/Z04): hooded sensor head on a column; its lit scanning bar sweeps inside the lens slit.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game, Vec3Like } from '@/core/api';
import type { CommandEmitterVisual, ScanHeadVisual } from '@/core/api/creatures';
import { clamp, clamp01, damp, dampAngle } from '@/core/mathx';
import { impact, noise1, rot, move } from '../core/anim';
import { arcPath, band, box, cyl, lathe, prism, sphere, T, torus, tube, type Pt2, type Pt3 } from '../core/geo';
import { P, tint } from '../core/palette';
import { getTemplate, RigBuilder, type RigTemplate } from '../core/rig';
import { DEVICE_ACTIONS, DEVICE_ALIASES, DeviceBase } from './base';

const HALF_PI = Math.PI / 2;
const _v = new THREE.Vector3();
const mulM = (...m: THREE.Matrix4[]): THREE.Matrix4 => m.reduce((a, x) => a.multiply(x), new THREE.Matrix4());

// =========================================================================================================
// command emitter
// =========================================================================================================
const EG = { core: 1, prong: 2, lights: 3 } as const;
const LEG_DIRS: Pt2[] = [[0, 1], [-0.866, -0.5], [0.866, -0.5]];

function buildEmitter(): RigTemplate {
  const b = new RigBuilder();
  b.bone('base', null, [0, 0, 0]);
  b.bone('hub', 'base', [0, 0.92, 0]);
  LEG_DIRS.forEach((d, i) => b.bone('leg' + i, 'base', [d[0] * 0.09, 0.9, d[1] * 0.09]));
  b.bone('prongL', 'hub', [-0.21, 1.36, 0]);
  b.bone('prongR', 'hub', [0.21, 1.36, 0]);
  b.bone('crown', 'hub', [0, 1.54, 0]);
  // tripod
  LEG_DIRS.forEach((d, i) => {
    const L = 'leg' + i;
    const top: Pt3 = [d[0] * 0.09, 0.9, d[1] * 0.09], knee: Pt3 = [d[0] * 0.37, 0.5, d[1] * 0.37], foot: Pt3 = [d[0] * 0.64, 0.035, d[1] * 0.64];
    b.add(L, P.refSteel, tube([top, knee], 0.022, 6), undefined, { crease: 180 });
    b.add(L, P.refNavy, tube([knee, foot], [0.03, 0.024], 4), undefined, { crease: 20 });
    b.add(L, P.refSteel, sphere(0.04, 1), T(knee[0], knee[1], knee[2]), { crease: 180 });
    b.add(L, P.refDark, cyl(0.08, 0.09, 0.035, 10, 0.008), T(foot[0], 0.018, foot[2]));
    b.add(L, P.refSteel, tube([[0, 0.56, 0], knee], 0.01, 5), undefined, { crease: 180 });
  });
  b.add('hub', P.refNavy, cyl(0.115, 0.1, 0.16, 8, 0.02, Math.PI / 8), T(0, 0.92, 0));
  b.add('hub', P.refSteel, band(0.112, 0.022, 0.03, 8, 0.006, Math.PI * 2, Math.PI / 8), T(0, 0.98, 0));
  b.add('hub', P.refSteel, cyl(0.03, 0.03, 0.42, 8), T(0, 0.74, 0));
  // battery pack slung between the legs, cabled to the floor
  b.add('hub', P.refSlate, box(0.24, 0.27, 0.15, 0.022), T(0, 0.66, 0.13));
  b.add('hub', P.refSteel, box(0.25, 0.03, 0.16, 0.006), T(0, 0.72, 0.13));
  for (let i = 0; i < 3; i++) b.add('hub', P.refGlow, box(0.03, 0.012, 0.006), T(-0.06 + i * 0.06, 0.6, 0.207), { group: EG.lights });
  b.add('base', P.rubber, tube(arcPath([0.06, 0.55, 0.2], [0.2, 0.2, 0.5], [0.12, 0.02, 0.26], 8), 0.012, 5), undefined, { crease: 180 });
  b.add('base', P.rubber, torus(0.1, 0.014, 14, 5), T(0.02, 0.016, 0.26), { crease: 180 });
  // mast + yoke
  b.add('hub', P.refSteel, cyl(0.034, 0.03, 0.5, 8), T(0, 1.22, 0));
  b.add('hub', P.refNavy, box(0.5, 0.05, 0.07, 0.014), T(0, 1.36, 0));
  b.add('hub', P.refSteel, cyl(0.055, 0.05, 0.09, 8, 0.01), T(0, 1.46, 0));
  // prongs: twin-rail forks on gimbals
  for (const side of [-1, 1]) {
    const pr = side < 0 ? 'prongL' : 'prongR';
    const x = side * 0.21;
    b.add(pr, P.refSteel, sphere(0.05, 1), T(x, 1.36, 0), { crease: 180 });
    for (const o of [-0.03, 0.03]) b.add(pr, P.refSteel, box(0.012, 0.024, 0.56, 0.003), T(x + o, 1.36, -0.3));
    b.add(pr, P.refNavy, box(0.09, 0.05, 0.1, 0.012), T(x, 1.36, -0.09));
    b.add(pr, P.refNavy, box(0.08, 0.034, 0.03, 0.008), T(x, 1.36, -0.36));
    b.add(pr, P.refDark, cyl(0.03, 0.03, 0.1, 8, 0.006), T(x, 1.36, 0.1, HALF_PI, 0, 0));
    b.add(pr, P.refGlow, box(0.076, 0.016, 0.02), T(x, 1.36, -0.585), { group: EG.prong });
    b.socket(pr, pr, [x, 1.36, -0.6]);
  }
  // crown: collar, lit band, six emitter fins, dome and spike
  b.add('crown', P.refNavy, band(0.2, 0.05, 0.07, 12, 0.014), T(0, 1.54, 0));
  b.add('crown', tint(P.refGlow, { e: 2.2 }), torus(0.205, 0.012, 24, 5), T(0, 1.585, 0), { group: EG.core, crease: 180 });
  for (let i = 0; i < 3; i++) b.add('crown', P.refSteel, box(0.4, 0.016, 0.03, 0.004), T(0, 1.54, 0, 0, (i * Math.PI) / 3, 0));
  const fin: Pt2[] = [[0, -0.035], [0.15, -0.055], [0.23, 0.02], [0.17, 0.115], [0.04, 0.06], [0, 0.04]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add('crown', i % 2 ? P.refNavy : P.refSlate, prism(fin, 0.014, 0.005), mulM(T(0, 1.55, 0, 0, a, 0), T(0.2, 0, 0, 0.25, 0, 0)));
  }
  b.add('crown', P.refSteel, lathe([[0, 1.6], [0.12, 1.6], [0.13, 1.63], [0.1, 1.69], [0.045, 1.725], [0, 1.73]], 12, [1]), undefined, { crease: 50 });
  b.add('crown', P.refSteel, tube([[0, 1.72, 0], [0, 1.98, 0]], [0.012, 0.004], 5), undefined, { crease: 180 });
  b.add('crown', P.refGlow, sphere(0.014, 1), T(0, 1.985, 0), { group: EG.lights, crease: 180 });
  b.socket('core', 'crown', [0, 1.6, 0]);
  b.socket('top', 'crown', [0, 2.0, 0]);
  return b.build();
}

export class CommandEmitter extends DeviceBase implements CommandEmitterVisual {
  private spin = 0;
  private sync = 0;
  private readonly targets: (THREE.Vector3 | null)[] = [null, null];
  private readonly aimYaw = [0.5, -0.5];
  private readonly aimPitchV = [0.2, 0.2];
  private readonly hub: THREE.Bone; private readonly crown: THREE.Bone; private readonly prongs: THREE.Bone[]; private readonly legs: THREE.Bone[];

  constructor(game: Game | null, opts?: CharacterCreateOpts) {
    super(game, {
      archetype: 'commandEmitter', height: 2.0, radius: 0.55, template: getTemplate('commandEmitter', buildEmitter),
      actions: DEVICE_ACTIONS, aliases: DEVICE_ALIASES, groups: EG, frostOrigin: [0, 1.4, 0], frostRange: 1.5,
    }, opts);
    const r = this.rig;
    this.hub = r.b('hub'); this.crown = r.b('crown');
    this.prongs = [r.b('prongL'), r.b('prongR')];
    this.legs = [0, 1, 2].map((i) => r.b('leg' + i));
    for (const p of this.prongs) p.rotation.order = 'YXZ';
    this.addChunk(this.crown, [0, 1, 0.3], 0.3, 0, 3);
    this.addChunk(this.prongs[0]!, [-1, 0.4, -0.3], 0.2, 1);
    this.addChunk(this.prongs[1]!, [1, 0.4, -0.2], 0.2, 2);
    this.addChunk(this.hub, [0, 0, 0], 0.72, 3, 0.4);
    this.u.uDissolveColor.value.setHex(0xa8d8ff);
  }

  setProngTarget(index: number, target: Vec3Like | null): void {
    if (index !== 0 && index !== 1) return;
    if (!target) { this.targets[index] = null; return; }
    (this.targets[index] ??= new THREE.Vector3()).set(target.x, target.y, target.z);
  }

  pulseSync(strength = 1): void {
    this.sync = Math.max(this.sync, clamp01(strength));
  }

  protected override pose(adt: number, dt: number): void {
    this.stepDevice(adt, dt);
    const t = this.time, pw = this.power;
    const stag = this.weight('stagger');
    this.sync = damp(this.sync, 0, 4, adt);
    this.spin += adt * 1.7 * pw * (1 - stag * 1.7 + Math.sin(t * 23) * stag * 0.8);
    rot(this.hub, this.wobX, 0, this.wobZ);
    rot(this.crown, 0, this.spin, 0);
    move(this.crown, 0, this.sync * 0.03, 0);
    const droop = Math.max(this.off, stag * 0.8);
    for (let i = 0; i < 2; i++) {
      const p = this.prongs[i]!;
      let yaw = (i === 0 ? 0.5 : -0.5) + Math.sin(t * 0.55 + i * 2.1) * 0.28;
      let pitch = 0.22 + Math.sin(t * 0.4 + i) * 0.08;
      const tg = this.targets[i];
      if (tg && pw > 0.05) {
        _v.copy(tg);
        this.rig.group.worldToLocal(_v);
        _v.x -= i === 0 ? -0.21 : 0.21; _v.y -= 1.36;
        yaw = Math.atan2(-_v.x, -_v.z);
        pitch = Math.atan2(_v.y, Math.max(0.05, Math.hypot(_v.x, _v.z)));
      }
      this.aimYaw[i] = dampAngle(this.aimYaw[i]!, yaw, 5, adt);
      this.aimPitchV[i] = damp(this.aimPitchV[i]!, clamp(pitch, -0.6, 1.2), 5, adt);
      p.rotation.y += this.aimYaw[i]! * (1 - droop * 0.4) + noise1(t * 9 + i * 5) * 0.2 * stag;
      p.rotation.x += this.aimPitchV[i]! * (1 - droop) - 1.0 * droop;
    }
    for (const s of this.active) {
      if (s.name === 'death') {
        this.breakApart(s.t, s.w);
        for (let i = 0; i < 3; i++) {
          const k = clamp01(s.t / 0.5) * s.w, d = LEG_DIRS[i]!;
          rot(this.legs[i]!, d[1] * 0.75 * k, 0, -d[0] * 0.75 * k);
          move(this.legs[i]!, 0, -0.5 * k * k, 0);
        }
      } else if (s.name === 'generic') rot(this.hub, impact(s.t, 0, 0.15, 20) * 0.05 * s.w, 0, 0);
    }
    const fl = this.flickerLight();
    this.groupGlow('core', (0.75 + this.sync * 2.6 + Math.sin(t * 3.4) * 0.12 + this.exposure('core') * 1.5) * pw * fl);
    this.groupGlow('prong', (0.6 + this.sync * 3 + (this.targets[0] || this.targets[1] ? 0.5 : 0)) * pw * fl);
    this.groupGlow('lights', pw * fl * (0.6 + 0.4 * Math.max(0, Math.sin(t * 2.2))));
  }
}

// =========================================================================================================
// relay receiver
// =========================================================================================================
const RG = { core: 1, lights: 2 } as const;

function buildRelay(variant: number): RigTemplate {
  const b = new RigBuilder();
  b.bone('base', null, [0, 0, 0]);
  b.bone('mast', 'base', [0, 0.42, 0]);
  b.bone('dish', 'mast', [0, 1.95, 0]);
  // equipment crate on outriggers
  b.add('base', P.refNavy, box(0.64, 0.38, 0.5, 0.03), T(0, 0.23, 0));
  for (const x of [-0.27, 0.27]) b.add('base', P.refSteel, box(0.05, 0.4, 0.52, 0.01), T(x, 0.23, 0));
  b.add('base', P.refSlate, box(0.5, 0.03, 0.4, 0.008), T(0, 0.43, 0));
  b.add('base', P.refDark, box(0.3, 0.12, 0.01), T(0, 0.25, -0.252));
  for (let i = 0; i < 4; i++) b.add('base', P.refGlow, box(0.045, 0.014, 0.008), T(-0.105 + i * 0.07, 0.27, -0.259), { group: RG.lights, rand: i * 0.25 });
  for (let i = 0; i < 4; i++) b.add('base', P.refSteel, box(0.2, 0.008, 0.008), T(0, 0.2 + i * 0.012 - 0.01, -0.259));
  b.add('base', P.refDark, box(0.95, 0.04, 0.09, 0.012), T(0, 0.022, 0.16, 0, 0.5, 0));
  b.add('base', P.refDark, box(0.95, 0.04, 0.09, 0.012), T(0, 0.022, -0.1, 0, -0.5, 0));
  b.add('base', P.rubber, tube(arcPath([0.3, 0.3, 0.2], [0.55, 0.3, 0.45], [0.6, 0.02, 0.1], 8), 0.014, 5), undefined, { crease: 180 });
  b.add('base', P.rubber, torus(0.11, 0.015, 14, 5), T(0.6, 0.018, 0.0), { crease: 180 });
  // mast with collars and braces
  b.add('mast', P.refSteel, cyl(0.042, 0.034, 1.56, 8), T(0, 1.2, 0));
  b.add('mast', P.refNavy, cyl(0.075, 0.065, 0.1, 8, 0.012), T(0, 0.5, 0));
  b.add('mast', P.refNavy, cyl(0.055, 0.055, 0.06, 8, 0.01), T(0, 1.2, 0));
  for (const x of [-1, 1]) b.add('mast', P.refSteel, tube([[x * 0.22, 0.44, 0.12], [x * 0.03, 0.95, 0]], 0.009, 5), undefined, { crease: 180 });
  b.add('mast', P.refSlate, box(0.09, 0.14, 0.07, 0.012), T(0, 1.5, 0.055));
  b.add('mast', P.refGlow, box(0.02, 0.05, 0.006), T(0, 1.5, 0.092), { group: RG.lights });

  if (variant === 0) {
    // A — one large round dish with a feed horn
    const D = mulM(T(0, 2.02, -0.13, -HALF_PI + 0.38, 0, 0));
    b.add('dish', P.refNavy, lathe([[0, -0.03], [0.16, -0.022], [0.32, 0.012], [0.47, 0.085], [0.485, 0.105]], 20, [3]), D, { crease: 60 });
    b.add('dish', P.refPanel, lathe([[0.485, 0.105], [0.455, 0.092], [0.31, 0.03], [0.15, 0.0], [0, -0.008]], 20, [0]), D, { crease: 60 });
    b.add('dish', P.refNavy, cyl(0.07, 0.05, 0.08, 8, 0.01), mulM(D.clone(), T(0, -0.06, 0)));
    b.add('dish', P.refSteel, cyl(0.03, 0.022, 0.07, 8, 0.006), mulM(D.clone(), T(0, 0.36, 0)));
    b.add('dish', tint(P.refGlow, { e: 2.4 }), sphere(0.02, 1), mulM(D.clone(), T(0, 0.325, 0)), { group: RG.core, crease: 180 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      b.add('dish', P.refSteel, tube([[Math.cos(a) * 0.44, 0.08, Math.sin(a) * 0.44], [0, 0.36, 0]], 0.006, 4), D, { crease: 180 });
    }
    b.add('dish', tint(P.refGlow, { e: 0.9 }), torus(0.475, 0.007, 28, 4), mulM(D.clone(), T(0, 0.108, 0)), { group: RG.core, crease: 180 });
    b.add('dish', P.refSteel, box(0.12, 0.2, 0.08, 0.015), T(0, 1.97, 0.0));
    b.add('dish', P.refSteel, tube([[0.05, 2.02, 0.03], [0.07, 2.42, 0.1]], [0.006, 0.003], 4), undefined, { crease: 180 });
    b.socket('core', 'dish', [0, 2.15, -0.45]);
    b.socket('top', 'dish', [0, 2.55, 0]);
  } else {
    // B — ladder of three hex panels under a T-bar
    b.add('dish', P.refSteel, box(0.05, 1.0, 0.05, 0.01), T(0, 2.12, 0));
    const hex: Pt2[] = [];
    for (let i = 0; i < 6; i++) hex.push([Math.cos((i / 6) * Math.PI * 2) * 0.2, Math.sin((i / 6) * Math.PI * 2) * 0.2]);
    for (let i = 0; i < 3; i++) {
      const M = T(0, 1.8 + i * 0.3, -0.07, 0.12, (i - 1) * 0.3, 0);
      b.add('dish', P.refNavy, prism(hex, 0.035, 0.008), M);
      b.add('dish', P.refSteel, prism(hex.map((p) => [p[0] * 0.72, p[1] * 0.72] as Pt2), 0.012, 0.003), mulM(M.clone(), T(0, 0, -0.022)));
      b.add('dish', tint(P.refGlow, { e: 2.2 }), box(0.11, 0.018, 0.008), mulM(M.clone(), T(0, 0, -0.03)), { group: RG.core, rand: i * 0.33 });
      b.add('dish', P.refSteel, box(0.03, 0.03, 0.08, 0.006), mulM(M.clone(), T(0, 0, 0.04)));
    }
    b.add('dish', P.refNavy, box(0.78, 0.035, 0.035, 0.008), T(0, 2.62, 0));
    for (const x of [-0.37, 0.37]) {
      b.add('dish', P.refSteel, cyl(0.012, 0.012, 0.26, 6), T(x, 2.62, 0));
      b.add('dish', P.refGlow, sphere(0.014, 1), T(x, 2.76, 0), { group: RG.lights, crease: 180 });
    }
    b.socket('core', 'dish', [0, 2.1, -0.12]);
    b.socket('top', 'dish', [0, 2.8, 0]);
  }
  b.socket('dish', 'dish', [0, 2.0, 0]);
  return b.build();
}

export class RelayReceiver extends DeviceBase {
  private readonly mast: THREE.Bone; private readonly dish: THREE.Bone;
  private readonly isB: boolean;

  constructor(game: Game | null, opts: CharacterCreateOpts = {}) {
    const variant = (opts.variant ?? 0) % 2 === 1 ? 1 : 0;
    super(game, {
      archetype: 'relayReceiver', height: variant ? 2.8 : 2.55, radius: 0.5, template: getTemplate('relayReceiver:' + variant, () => buildRelay(variant)),
      actions: DEVICE_ACTIONS, aliases: DEVICE_ALIASES, groups: RG, frostOrigin: [0, 1.6, 0], frostRange: 2,
    }, opts);
    this.isB = variant === 1;
    this.mast = this.rig.b('mast'); this.dish = this.rig.b('dish');
    this.dish.rotation.order = 'YXZ';
    this.addChunk(this.dish, [0.3, 0.6, -0.8], 1.7, 0, 3);
    this.u.uDissolveColor.value.setHex(0xa8d8ff);
  }

  protected override lookHeight(): number {
    return 2.0;
  }

  protected override pose(adt: number, dt: number): void {
    this.stepDevice(adt, dt);
    const t = this.time, pw = this.power, off = this.off;
    rot(this.mast, this.wobX * 0.7, 0, this.wobZ * 0.7 + off * 0.03);
    // searching nod while live; slumped when powered down
    const scanY = this.hasLook ? clamp(this.lookYaw, -1.2, 1.2) : Math.sin(t * 0.5) * (this.isB ? 0.6 : 0.35);
    const scanP = this.hasLook ? clamp(this.lookPitch, -0.4, 0.6) : Math.sin(t * 0.37 + 1) * 0.07;
    this.dish.rotation.y += scanY * pw + off * 0.35;
    this.dish.rotation.x += scanP * pw - off * (this.isB ? 0.25 : 1.05) + this.wobX * 0.6;
    this.dish.rotation.z += off * (this.isB ? 0.6 : 0.22) + this.wobZ * 0.6;
    for (const s of this.active) {
      if (s.name === 'death') {
        this.breakApart(s.t, s.w);
        const k = clamp01(s.t / 0.7);
        rot(this.mast, 0.4 * k * k * s.w, 0, 1.15 * k * k * s.w);
      }
    }
    const fl = this.flickerLight(3);
    const chase = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.6));
    this.groupGlow('core', (0.7 + 0.5 * chase + this.exposure('core') * 1.5) * pw * fl);
    this.groupGlow('lights', chase * pw * fl);
  }
}

// =========================================================================================================
// scan head
// =========================================================================================================
const SG = { eye: 1, lights: 2 } as const;

function buildScanHead(): RigTemplate {
  const b = new RigBuilder();
  b.bone('base', null, [0, 0, 0]);
  b.bone('mast', 'base', [0, 0.08, 0]);
  b.bone('yaw', 'mast', [0, 1.5, 0]);
  b.bone('head', 'yaw', [0, 1.66, 0]);
  b.bone('bar', 'head', [0, 1.66, -0.2]);
  b.bone('flapL', 'head', [-0.165, 1.66, -0.18]);
  b.bone('flapR', 'head', [0.165, 1.66, -0.18]);
  // plain round base: the whole device may be yawed by its driver
  b.add('base', P.refNavy, cyl(0.34, 0.3, 0.07, 20, 0.014), T(0, 0.035, 0));
  b.add('base', P.refSteel, band(0.3, 0.02, 0.02, 20, 0.005), T(0, 0.078, 0));
  b.add('base', P.refDark, cyl(0.12, 0.09, 0.08, 10, 0.012), T(0, 0.11, 0));
  b.add('mast', P.refSteel, cyl(0.048, 0.042, 1.36, 10), T(0, 0.8, 0));
  for (const y of [0.3, 1.22]) b.add('mast', P.refNavy, cyl(0.066, 0.066, 0.07, 10, 0.01), T(0, y, 0));
  const helix: Pt3[] = [];
  for (let i = 0; i <= 26; i++) {
    const a = i * 0.85;
    helix.push([Math.cos(a) * 0.062, 0.34 + i * 0.033, Math.sin(a) * 0.062]);
  }
  b.add('mast', P.rubber, tube(helix, 0.009, 4), undefined, { crease: 180 });
  b.add('mast', P.refSlate, box(0.11, 0.16, 0.08, 0.014), T(0, 0.92, 0.075));
  b.add('mast', P.refGlow, box(0.03, 0.012, 0.006), T(0, 0.96, 0.117), { group: SG.lights });
  // yoke
  b.add('yaw', P.refSteel, cyl(0.07, 0.06, 0.06, 10, 0.01), T(0, 1.5, 0));
  b.add('yaw', P.refNavy, box(0.42, 0.04, 0.09, 0.012), T(0, 1.535, 0));
  for (const x of [-0.2, 0.2]) b.add('yaw', P.refNavy, box(0.03, 0.2, 0.09, 0.01), T(x, 1.63, 0));
  // head: hooded housing, lens slit with a sliding lit bar
  b.add('head', P.refNavy, box(0.32, 0.2, 0.4, 0.035), T(0, 1.66, -0.01));
  b.add('head', P.refSlate, box(0.26, 0.06, 0.3, 0.015), T(0, 1.775, 0.02));
  for (let i = 0; i < 4; i++) b.add('head', P.refSteel, box(0.2, 0.03, 0.012, 0.003), T(0, 1.815, -0.07 + i * 0.06));
  b.add('head', P.refNavy, prism([[-0.19, 0], [0.19, 0], [0.15, 0.15], [-0.15, 0.15]], 0.026, 0.008), T(0, 1.758, -0.19, -HALF_PI - 0.22, 0, 0));
  b.add('head', P.glass, box(0.26, 0.085, 0.02, 0.004), T(0, 1.66, -0.208));
  b.add('head', tint(P.refGlow, { e: 0.9 }), box(0.24, 0.007, 0.008), T(0, 1.66, -0.22), { group: SG.eye });
  b.add('bar', tint(P.refGlow, { e: 3 }), box(0.045, 0.05, 0.01), T(0, 1.66, -0.222), { group: SG.eye });
  b.add('head', P.refSteel, cyl(0.07, 0.085, 0.05, 10, 0.01), T(0, 1.66, 0.21, HALF_PI, 0, 0));
  b.add('head', P.refSteel, tube([[0.1, 1.77, 0.14], [0.12, 1.98, 0.2]], [0.006, 0.003], 4), undefined, { crease: 180 });
  b.add('head', P.refGlow, sphere(0.011, 1), T(0.12, 1.985, 0.2), { group: SG.lights, crease: 180 });
  for (const side of [-1, 1]) {
    b.add(side < 0 ? 'flapL' : 'flapR', P.refSlate, prism([[0, -0.09], [0.2, -0.07], [0.24, 0.0], [0.2, 0.07], [0, 0.09]], 0.012, 0.004),
      T(side * 0.17, 1.66, -0.18, 0, HALF_PI - side * 0.3, 0));
  }
  b.add('yaw', P.rubber, tube(arcPath([0, 1.47, 0.05], [0, 1.5, 0.3], [0, 1.66, 0.22], 6), 0.01, 4), undefined, { crease: 180 });
  b.socket('eye', 'head', [0, 1.66, -0.24]);
  b.socket('core', 'head', [0, 1.66, -0.24]);
  b.socket('top', 'head', [0, 2.0, 0]);
  return b.build();
}

export class ScanHead extends DeviceBase implements ScanHeadVisual {
  private sweep = 0;
  private yawNow = 0;
  private readonly mast: THREE.Bone; private readonly yaw: THREE.Bone; private readonly head: THREE.Bone; private readonly bar: THREE.Bone;
  private readonly flaps: THREE.Bone[];

  constructor(game: Game | null, opts?: CharacterCreateOpts) {
    super(game, {
      archetype: 'scanHead', height: 2.0, radius: 0.35, template: getTemplate('scanHead', buildScanHead),
      actions: DEVICE_ACTIONS, aliases: DEVICE_ALIASES, groups: SG, frostOrigin: [0, 1.66, 0], frostRange: 1.7,
    }, opts);
    const r = this.rig;
    this.mast = r.b('mast'); this.yaw = r.b('yaw'); this.head = r.b('head'); this.bar = r.b('bar');
    this.flaps = [r.b('flapL'), r.b('flapR')];
    this.addChunk(this.yaw, [0.2, 0.7, -0.6], 1.4, 0, 2.6);
    this.u.uDissolveColor.value.setHex(0xa8d8ff);
  }

  setSweep(yaw: number): void {
    if (Number.isFinite(yaw)) this.sweep = yaw;
  }

  protected override lookHeight(): number {
    return 1.66;
  }

  protected override pose(adt: number, dt: number): void {
    this.stepDevice(adt, dt);
    const t = this.time, pw = this.power, off = this.off;
    rot(this.mast, this.wobX * 0.6, 0, this.wobZ * 0.6);
    const yawT = this.hasLook ? this.lookYaw : this.sweep;
    this.yawNow = dampAngle(this.yawNow, yawT, 12, adt);
    this.yaw.rotation.y += this.yawNow;
    const pitch = (this.hasLook ? this.lookPitch : 0) + this.aimPitch;
    rot(this.head, clamp(pitch, -1, 1) * (1 - off) - 0.75 * off + this.wobX * 0.8 + Math.sin(t * 1.3) * 0.012 * pw, 0, this.wobZ * 0.5 + off * 0.12);
    const tel = this.u.uTelegraph.value.w;
    move(this.bar, Math.sin(t * (3.2 + tel * 5)) * 0.092 * pw, 0, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      rot(this.flaps[i]!, 0, side * (-0.18 * pw + Math.max(0, noise1(t * 1.7 + i * 9)) * 0.22 * pw + off * 0.5 - tel * 0.25), 0);
    }
    for (const s of this.active) {
      if (s.name === 'death') {
        this.breakApart(s.t, s.w);
        const k = clamp01(s.t / 0.8);
        rot(this.mast, -1.2 * k * k * s.w, 0, 0.25 * k * s.w);
      }
    }
    const fl = this.flickerLight(5);
    this.groupGlow('eye', (0.9 + tel * 1.5) * pw * fl);
    this.groupGlow('lights', pw * fl);
  }
}

export function createCommandEmitter(game: Game | null, opts?: CharacterCreateOpts): CommandEmitter {
  return new CommandEmitter(game, opts);
}
export function createRelayReceiver(game: Game | null, opts?: CharacterCreateOpts): RelayReceiver {
  return new RelayReceiver(game, opts);
}
export function createScanHead(game: Game | null, opts?: CharacterCreateOpts): ScanHead {
  return new ScanHead(game, opts);
}
