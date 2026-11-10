/**
 * Wall-runner — lean Eclipse quadruped (≈1.6 m nose to haunch, ≈2.5 m with prow and tail) built from stretched
 * appropriated plating.
 * Long blade shins under knees that ride above its back (a spider's stance, nothing like the upright
 * Linkbound), a narrow prow of a head with the shared lit cleft, a whip tail. It skitters on IK-planted feet,
 * clings to walls and ceilings (`setCling`), and pounces through a crouch → launch → flight → landing arc.
 *
 * Model space: feet on y = 0, front = −Z. All body bones hang off a `cling` frame that re-seats the creature
 * on a wall or ceiling above its (ground) root.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { WallrunnerCling, WallrunnerVisual } from '@/core/api/creatures';
import { clamp, clamp01, damp, smoothstep, TAU } from '@/core/mathx';
import { gaitFoot, gaitRate, groundDeficit, impact, keys, Limb2, move, noise1, PlantYaw, probe, rot, win, type GaitOut, type GroundProbe } from './core/anim';
import { CreatureBase, type ActionDef } from './core/base';
import { along, arcPath, blob, shard, sphere, T, tube, type Pt3 } from './core/geo';
import { P, tint } from './core/palette';
import { addPlate, bladeOutline, facing, kite } from './core/plates';
import { getTemplate, RigBuilder, type Paint, type RigTemplate } from './core/rig';

const G = { eye: 1, core: 2, nodes: 3 } as const;

const W = {
  hips: [0, 0.62, 0.42] as Pt3, spine: [0, 0.67, 0.1] as Pt3, chest: [0, 0.64, -0.24] as Pt3,
  neck: [0, 0.62, -0.5] as Pt3, head: [0, 0.58, -0.72] as Pt3, jaw: [0, 0.54, -0.74] as Pt3,
  tail: [[0, 0.62, 0.6], [0, 0.63, 0.78], [0, 0.62, 0.95], [0, 0.59, 1.1]] as Pt3[], tailTip: [0, 0.55, 1.26] as Pt3,
  /** the body is modelled at this height and carried lower: knees stay above the back line */
  ride: -0.14,
};
/** legs: [name, parent, shoulder, elbow, foot] for the +X side; mirrored for −X */
const LEGS: { name: string; parent: string; a: Pt3; k: Pt3; f: Pt3 }[] = [
  { name: 'f', parent: 'chest', a: [0.17, 0.6, -0.28], k: [0.56, 0.86, -0.26], f: [0.92, 0, -0.56] },
  { name: 'h', parent: 'hips', a: [0.16, 0.6, 0.42], k: [0.54, 0.88, 0.6], f: [0.88, 0, 0.84] },
];
const mx = (p: Pt3): Pt3 => [-p[0], p[1], p[2]];

function buildWallrunner(): RigTemplate {
  const b = new RigBuilder();
  b.bone('cling', null, [0, 0, 0]);
  b.bone('hips', 'cling', W.hips);
  b.bone('spine', 'hips', W.spine);
  b.bone('chest', 'spine', W.chest);
  b.bone('neck', 'chest', W.neck);
  b.bone('head', 'neck', W.head);
  b.bone('jaw', 'head', W.jaw);
  const tail = b.chain('t', 'hips', W.tail);
  for (const L of LEGS) {
    for (const side of ['R', 'L'] as const) {
      const m = side === 'R' ? (p: Pt3) => p : mx;
      b.bone(`${L.name}${side}0`, L.parent, m(L.a));
      b.bone(`${L.name}${side}1`, `${L.name}${side}0`, m(L.k));
    }
  }
  // ---- lean trunk of tissue
  b.addSkinned(['hips', 'spine', 'chest', 'neck'], P.tissue,
    tube([[0, 0.6, 0.6], [0, 0.63, 0.42], [0, 0.68, 0.1], [0, 0.65, -0.24], [0, 0.62, -0.5], [0, 0.59, -0.7]], [0.07, 0.125, 0.095, 0.145, 0.085, 0.07], 8, false),
    undefined, {}, [0, 0.3, 0.55, 0.78], 0.45);
  // ---- open ribcage with the core slung inside
  for (let i = 0; i < 4; i++) {
    const z = -0.38 + i * 0.1;
    for (const sx of [-1, 1]) b.add('chest', P.bone, tube(arcPath([sx * 0.03, 0.72, z], [sx * 0.24, 0.62, z + 0.02], [sx * 0.11, 0.4, z + 0.05], 6), (t) => 0.016 * (1 - t * 0.5), 4), undefined, { crease: 180 });
  }
  b.add('chest', tint(P.violet, { e: 1.5 }), blob(0.055, 1, 0.2, 61), T(0, 0.5, -0.2), { group: G.core, crease: 180 });
  b.add('chest', P.sinew, tube([[0, 0.62, -0.22], [0.02, 0.56, -0.2], [0, 0.52, -0.2]], 0.014, 4), undefined, { crease: 180 });
  // ---- dorsal run of stretched blades, tips swept toward the tail
  const dorsal: [string, number, number, number, Paint, boolean][] = [
    ['neck', -0.58, 0.72, 0.36, P.whiteGold, true], ['chest', -0.36, 0.81, 0.46, P.refNavy, false], ['chest', -0.12, 0.8, 0.44, P.whiteGold, false],
    ['spine', 0.1, 0.79, 0.44, P.ivoryWorn, true], ['hips', 0.32, 0.76, 0.42, P.domBronze, false], ['hips', 0.5, 0.71, 0.34, P.whiteGold, false],
  ];
  dorsal.forEach(([bone, z, y, len, paint, trim], i) => {
    addPlate(b, bone, paint, bladeOutline(0.2, len, 600 + i, i % 2 ? 0.06 : -0.05), facing([0, y, z], [0, 1, 0.3], [0, 0, 1], (i % 2 ? 1 : -1) * 0.06), { thick: 0.024, rx: 0.13, lift: 0.04, trim: trim ? tint(P.gold, { r: 0.42 }) : undefined });
  });
  for (const sx of [-1, 1]) {
    addPlate(b, 'chest', sx > 0 ? P.ivoryWorn : P.domOxblood, kite(0.2, 0.3, 0.3, 610 + sx), facing([sx * 0.15, 0.66, -0.3], [sx, 0.35, -0.2], [0, 0.3, 1], sx * 0.3), { thick: 0.02, rx: 0.2, lift: 0.03 });
    addPlate(b, 'hips', sx > 0 ? P.refSlate : P.ivoryWorn, kite(0.17, 0.26, 0.3, 612 + sx), facing([sx * 0.13, 0.64, 0.4], [sx, 0.4, 0.2], [0, 0.3, 1], sx * 0.2), { thick: 0.02, rx: 0.2, lift: 0.03 });
  }
  // ---- head: a narrow prow of two long blades with the lit cleft between, horns swept back
  b.add('head', P.tissue, blob(0.075, 1, 0.2, 63, [1, 1, 1.5]), T(0, 0.59, -0.74), { crease: 180 });
  addPlate(b, 'head', P.whiteGold, bladeOutline(0.13, 0.46, 621, -0.12), facing([0.052, 0.615, -0.7], [0.72, 0.62, -0.1], [0, -0.16, -1], 0.04), { thick: 0.022, rx: 0.18, lift: 0.02, trim: tint(P.gold, { r: 0.42 }) });
  addPlate(b, 'head', P.ivoryWorn, bladeOutline(0.12, 0.42, 622, 0.12), facing([-0.056, 0.6, -0.68], [-0.75, 0.58, -0.1], [0, -0.16, -1], -0.1), { thick: 0.022, rx: 0.18, lift: 0.02 });
  // the cleft runs the length of the prow: a lit ridge-line readable from the front, the sides and above
  b.add('head', P.domBlack, sphere(0.03, 1), T(-0.002, 0.632, -0.78, -0.16, 0, 0, [0.8, 0.9, 7]), { crease: 180 });
  b.add('head', tint(P.violetEye, { e: 1.9 }), sphere(0.012, 1), T(-0.002, 0.652, -0.8, -0.16, 0, 0, [0.9, 1, 13]), { group: G.eye, crease: 180 });
  b.add('head', tint(P.violetEye, { e: 2.4 }), sphere(0.017, 1), T(-0.002, 0.612, -1.0), { group: G.eye, crease: 180 });
  b.add('head', P.whiteGold, shard(0.36, 0.05, 0.035, 624, 4, 0.6), along([0.05, 0.64, -0.66], [0.2, 0.84, -0.4]), { crease: 30 });
  b.add('head', P.ivoryWorn, shard(0.3, 0.045, 0.03, 625, 4, 0.6), along([-0.05, 0.63, -0.66], [-0.2, 0.78, -0.44]), { crease: 30 });
  addPlate(b, 'jaw', P.domBlack, bladeOutline(0.09, 0.34, 626), facing([0, 0.52, -0.72], [0, -1, -0.12], [0, 0, -1], 0), { thick: 0.02, rx: 0.1, lift: 0.01 });
  for (const sx of [-1, 1]) b.add('jaw', P.bone, shard(0.07, 0.022, 0.018, 627 + sx, 4, 0.7), along([sx * 0.025, 0.535, -0.98], [sx * 0.03, 0.59, -1.01]), { crease: 30 });
  // ---- legs: sinew thigh up to a spiked knee, then one long blade down to a black claw
  for (const L of LEGS) {
    const hind = L.name === 'h';
    for (const side of ['R', 'L'] as const) {
      const m = side === 'R' ? (p: Pt3) => p : mx;
      const a = m(L.a), k = m(L.k), f = m(L.f);
      const up = `${L.name}${side}0`, lo = `${L.name}${side}1`;
      const sgn = side === 'R' ? 1 : -1;
      b.add(up, P.sinew, tube([a, [(a[0] + k[0]) / 2, (a[1] + k[1]) / 2 + 0.03, (a[2] + k[2]) / 2], k], [0.055, 0.045, 0.04], 6), undefined, { crease: 180 });
      b.add(up, P.tissueWet, tube([[a[0], a[1] - 0.04, a[2] + 0.03], [(a[0] + k[0]) / 2, (a[1] + k[1]) / 2 - 0.04, (a[2] + k[2]) / 2 + 0.03], k], 0.022, 4), undefined, { crease: 180 });
      addPlate(b, up, hind ? (side === 'R' ? P.domBronze : P.ivoryWorn) : (side === 'R' ? P.whiteGold : P.refNavy), bladeOutline(0.1, 0.4, 630 + sgn + (hind ? 5 : 0)),
        facing([(a[0] + k[0]) / 2, (a[1] + k[1]) / 2 + 0.065, (a[2] + k[2]) / 2], [-sgn * 0.5, 1, 0], [k[0] - a[0], k[1] - a[1], k[2] - a[2]], 0), { thick: 0.02, rx: 0.1, lift: 0.03 });
      b.add(lo, P.tissueWet, sphere(0.05, 1), T(k[0], k[1], k[2]), { crease: 180 });
      // knee spike continues the shin line upward — the silhouette's high points
      const dir: Pt3 = [k[0] - f[0], k[1] - f[1], k[2] - f[2]];
      const dl = Math.hypot(dir[0], dir[1], dir[2]);
      b.add(lo, P.whiteGold, shard(0.24, 0.05, 0.035, 640 + sgn + (hind ? 5 : 0), 4, 0.7), along(k, [k[0] + (dir[0] / dl) * 0.24 + sgn * 0.03, k[1] + (dir[1] / dl) * 0.24, k[2] + (dir[2] / dl) * 0.24]), { crease: 30 });
      const clawTop: Pt3 = [f[0] + (dir[0] / dl) * 0.16, f[1] + (dir[1] / dl) * 0.16, f[2] + (dir[2] / dl) * 0.16];
      b.add(lo, hind ? P.ivoryWorn : P.whiteGold, shard(dl - 0.12, 0.075, 0.045, 650 + sgn + (hind ? 5 : 0), 4, 0.25), along([k[0], k[1] - 0.02, k[2]], clawTop, sgn), { crease: 30 });
      b.add(lo, P.sinew, tube([k, [(k[0] + f[0]) / 2 - sgn * 0.03, (k[1] + f[1]) / 2, (k[2] + f[2]) / 2 + 0.03], clawTop], [0.03, 0.02, 0.016], 4), undefined, { crease: 180 });
      b.add(lo, P.domBlack, shard(0.2, 0.05, 0.035, 660 + sgn, 4, 0.75), along(clawTop, [f[0], -0.012, f[2]], sgn), { crease: 30 });
      b.add(lo, P.violetSoft, sphere(0.012, 1), T(clawTop[0], clawTop[1] + 0.03, clawTop[2]), { group: G.nodes, crease: 180 });
    }
  }
  // ---- whip tail with a blade tip
  b.tubeOn(tail, W.tailTip, P.sinew, (t) => 0.05 * (1 - t * 0.8) + 0.008, 6, {}, 1, 3);
  addPlate(b, tail[3]!, P.whiteGold, bladeOutline(0.08, 0.24, 670), facing([0, 0.565, 1.2], [0.2, 1, 0.3], [0, -0.2, 1], 0.2), { thick: 0.016, lift: 0.02 });
  for (let i = 0; i < 3; i++) {
    const o = W.tail[i]!;
    b.add(tail[i]!, P.ivoryWorn, shard(0.11 - i * 0.02, 0.03, 0.02, 680 + i, 4, 0.7), along([o[0], o[1] + 0.03, o[2] + 0.06], [o[0], o[1] + 0.13 - i * 0.02, o[2] + 0.13]), { crease: 30 });
  }
  b.socket('head', 'head', [0, 0.6, -0.82]);
  b.socket('eye', 'head', [0, 0.63, -0.98]);
  b.socket('core', 'chest', [0, 0.5, -0.2]);
  b.socket('chest', 'chest', W.chest);
  b.socket('hips', 'hips', W.hips);
  b.socket('top', 'spine', [0, 1.0, 0.1]);
  return b.build();
}

const ACTIONS: Record<string, ActionDef> = {
  idle: { dur: 2, loop: true },
  lunge: { dur: 0.75, hits: [0.3], fade: 0.06, out: 0.2 },
  pounce: { dur: 1.3, hits: [0.82], fade: 0.08, out: 0.25, events: [[0.45, 'launch'], [0.88, 'land']] },
  ceilingCling: { dur: 2.4, loop: true, fade: 0.4, out: 0.3 },
  hitLight: { dur: 0.35, fade: 0.03, react: true, ignoreFreeze: true },
  hitHeavy: { dur: 0.6, fade: 0.03, react: true, ignoreFreeze: true },
  stagger: { dur: 1.2, fade: 0.05, out: 0.3 },
  spawn: { dur: 1.1, fade: 0, revive: true, dissolveIn: 0.7 },
  death: { dur: 2.4, hold: true, fade: 0.06, ignoreFreeze: true, thaw: true, events: [[0.5, 'impact']], dissolveOut: [1.2, 2.4] },
  generic: { dur: 0.5, react: true, ignoreFreeze: true },
};
const ALIASES: Record<string, string> = {
  leap: 'pounce', attackHeavy: 'pounce', attackLight1: 'lunge', attackLight2: 'lunge', attackLight3: 'lunge', attackLight4: 'lunge', batonStrike: 'lunge',
  linkedSync: 'idle', frozen: 'idle', hover: 'idle', guardBreak: 'stagger', knockdown: 'stagger', spawnBreach: 'spawn', spawnDrop: 'spawn',
};

const LAUNCH = 0.45, LAND = 0.88;
const DUTY = 0.55;
const TURN_LIMIT = 0.34, TURN_STEP_TIME = 0.13;
const K = {
  luThrust: [0, 0, 0.16, -0.25, 0.3, 1, 0.45, 0.8, 0.75, 0],
  luJaw: [0.1, 0, 0.26, 1, 0.34, 0],
  // anticipation: down in 0.26 s, then HELD (trembling) until the launch — the read the player dodges on
  poCrouch: [0, 0, 0.26, 1, LAUNCH, 1.06, LAUNCH + 0.07, 0],
  poSettle: [LAND, 1, LAND + 0.12, 0.6, 1.3, 0],
  stDown: [0, 0, 0.14, 1, 0.6, 0.9, 1.2, 0],
  spCurl: [0.1, 0, 0.9, 1],
  deDrop: [0, 0, 0.5, 1],
  deCurl: [0.3, 0, 1.3, 1],
} as const;
const _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _f = new THREE.Vector3(), _x = new THREE.Vector3();
const _m = new THREE.Matrix4(), _qI = new THREE.Quaternion();
const _g: GaitOut = { along: 0, lift: 0, planted: 1 };

interface Leg { limb: Limb2; rest: THREE.Vector3; off: THREE.Vector3; phase: number; side: number; front: boolean; plant: PlantYaw }

export class Wallrunner extends CreatureBase implements WallrunnerVisual {
  private cling: { height: number; wallYaw: number | null; inset: number } | null = null;
  /** last cling target, kept while blending back to the floor */
  private readonly clingPos = new THREE.Vector3();
  private readonly clingQuat = new THREE.Quaternion();
  private clingBlend = 0;
  private clingRate = 1 / 0.35;
  private gait = 0;
  private headYaw = 0;
  private headPitch = 0;
  private telegraph = 0;
  private readonly legs: Leg[] = [];
  private readonly probes: GroundProbe[];
  private readonly bCling: THREE.Bone; private readonly hips: THREE.Bone; private readonly spine: THREE.Bone; private readonly chest: THREE.Bone;
  private readonly neck: THREE.Bone; private readonly head: THREE.Bone; private readonly jaw: THREE.Bone; private readonly tail: THREE.Bone[];

  constructor(game: Game | null, opts?: CharacterCreateOpts) {
    super(game, {
      archetype: 'wallrunner', height: 0.95, radius: 0.7, template: getTemplate('wallrunner', buildWallrunner),
      actions: ACTIONS, aliases: ALIASES, groups: G, frostOrigin: [0, 0.6, 0], frostRange: 1.3, eclipse: true, baseCorruption: 0.6,
      rim: [0xb9a8e6, 0.22],
    }, opts);
    const r = this.rig;
    this.bCling = r.b('cling'); this.hips = r.b('hips'); this.spine = r.b('spine'); this.chest = r.b('chest');
    this.neck = r.b('neck'); this.head = r.b('head'); this.jaw = r.b('jaw');
    this.tail = [0, 1, 2, 3].map((i) => r.b('t' + i));
    const v = (p: Pt3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);
    for (const L of LEGS) {
      for (const side of [1, -1]) {
        const m = side > 0 ? (p: Pt3) => p : mx;
        const tag = `${L.name}${side > 0 ? 'R' : 'L'}`;
        const front = L.name === 'f';
        // diagonal pairs move together (a trot), which is what makes the skitter read
        const phase = front === side > 0 ? 0 : 0.5;
        this.legs.push({
          limb: new Limb2(this.bCling, r.b(tag + '0'), r.b(tag + '1'), v(m(L.a)), v(m(L.k)), v(m(L.f)), new THREE.Vector3(side * 0.6, 1, 0)),
          rest: v(m(L.f)), off: new THREE.Vector3(), phase, side, front, plant: new PlantYaw(),
        });
      }
    }
    // parts of the body that must stay on or above the surface it stands on
    this.probes = [
      probe(this.hips, W.hips, W.hips, 0.15),
      probe(this.chest, W.chest, [0, 0.52, -0.24], 0.17),
      probe(this.neck, W.neck, W.neck, 0.11),
      probe(this.head, W.head, [0, 0.6, -1.14], 0.05),
      probe(this.head, W.head, [0, 0.56, -0.78], 0.1),
      probe(this.jaw, W.jaw, [0, 0.52, -1.02], 0.04),
      probe(this.tail[3]!, W.tail[3]!, W.tailTip, 0.05),
      probe(this.tail[2]!, W.tail[2]!, W.tail[2]!, 0.06),
      probe(this.tail[3]!, W.tail[3]!, [0, 0.58, 1.44], 0.03),
    ];
  }

  // ------------------------------------------------------------------ WallrunnerVisual
  setCling(cling: WallrunnerCling | null, blendSeconds = 0.35): void {
    this.clingRate = 1 / Math.max(0.02, Number.isFinite(blendSeconds) ? blendSeconds : 0.35);
    if (!cling || !Number.isFinite(cling.height) || this.dead) { this.cling = null; return; }
    const wy = cling.wallYaw;
    this.cling = { height: cling.height, wallYaw: typeof wy === 'number' && Number.isFinite(wy) ? wy : null, inset: Number.isFinite(cling.inset) ? (cling.inset as number) : 0 };
  }

  get clinging(): boolean {
    return this.cling !== null;
  }

  override setTelegraph(amount: number, color?: number): void {
    super.setTelegraph(amount, color);
    this.telegraph = clamp01(amount || 0);
  }

  protected override lookHeight(): number {
    return 0.6;
  }

  protected override onActionEvent(action: string, event: string): void {
    // a pounce launched from a wall or ceiling lets go by itself and falls along the flight phase
    if (action === 'pounce' && event === 'launch' && this.cling) {
      this.cling = null;
      this.clingRate = 1 / (LAND - LAUNCH);
    }
  }

  protected override onPlay(name: string): void {
    if (name === 'death' && this.cling) { this.cling = null; this.clingRate = 1 / 0.45; }
  }

  protected override onRevive(): void {
    this.telegraph = 0;
    for (const l of this.legs) l.plant.reset();
  }

  protected override heal(): void {
    this.gait = 0; this.headYaw = 0; this.headPitch = 0; this.clingBlend = this.cling ? 1 : 0;
    this.clingPos.set(0, 0, 0); this.clingQuat.identity();
    for (const l of this.legs) l.plant.reset();
  }

  /** compute the cling frame (rig-group space) for the current request */
  private updateClingTarget(): void {
    const c = this.cling;
    if (!c) return;
    const s = 1 / this.scale;
    if (c.wallYaw === null) {
      this.clingPos.set(0, c.height * s, 0);
      this.clingQuat.setFromAxisAngle(_v.set(0, 0, 1), Math.PI);
      return;
    }
    const yaw = this.root.rotation.y;
    const th = c.wallYaw - (Number.isFinite(yaw) ? yaw : 0);
    _n.set(-Math.sin(th), 0, -Math.cos(th)); // wall normal in root space
    _f.set(0, 0, -1).addScaledVector(_n, _n.z); // heading projected onto the wall
    if (_f.lengthSq() < 0.14) _f.set(0, -1, 0); // facing into / out of the wall → hang head-down
    else { _f.y -= 0.35; _f.normalize(); }
    _f.addScaledVector(_n, -_f.dot(_n)).normalize();
    _x.crossVectors(_f, _n);
    _m.makeBasis(_x, _n, _v.copy(_f).multiplyScalar(-1));
    this.clingQuat.setFromRotationMatrix(_m);
    this.clingPos.set(0, c.height * s, 0).addScaledVector(_n, -c.inset * s);
  }

  protected override pose(adt: number, dt: number): void {
    const t = this.time;
    const { hips, spine, chest, neck, head, jaw } = this;
    const beat = this.cadence.beat();
    const alive = this.dead ? 0 : 1;
    for (const l of this.legs) l.off.set(0, 0, 0);

    // ---- cling frame
    this.updateClingTarget();
    this.clingBlend = this.cling ? Math.min(1, this.clingBlend + dt * this.clingRate) : Math.max(0, this.clingBlend - dt * this.clingRate);
    const cb = this.clingBlend;
    if (cb > 0) {
      const e = cb * cb * (3 - 2 * cb);
      // height follows a falling curve on the way down so a wall pounce drops like a body, not a lift
      const eh = this.cling ? e : Math.pow(cb, 1.7);
      this.bCling.position.set(this.clingPos.x * e, this.clingPos.y * eh, this.clingPos.z * e);
      this.bCling.quaternion.copy(_qI.identity()).slerp(this.clingQuat, e);
    }

    // ---- look (in the body's own frame, so it works on a wall)
    let ty = 0, tp = 0;
    if (this.hasLook && alive) {
      this.bCling.updateWorldMatrix(true, false);
      _v.copy(this.lookWorld);
      this.bCling.worldToLocal(_v);
      _v.y -= 0.6; _v.z += 0.6;
      if (Number.isFinite(_v.x + _v.y + _v.z)) {
        ty = Math.atan2(-_v.x, -_v.z);
        tp = Math.atan2(_v.y, Math.max(0.05, Math.hypot(_v.x, _v.z)));
      }
    }
    this.headYaw = damp(this.headYaw, clamp(ty, -1.3, 1.3), 9, adt);
    this.headPitch = damp(this.headPitch, clamp(tp, -0.8, 1.2), 9, adt);

    // ---- idle: low breathing, twitching head (imposed cant + cadence tick), restless tail
    const tel = this.telegraph;
    const breath = Math.sin(t * 2.1);
    move(hips, 0, W.ride + breath * 0.008 * alive - tel * 0.08, tel * 0.05);
    move(chest, 0, -tel * 0.1, 0);
    rot(spine, breath * 0.02, 0, 0);
    rot(neck, -0.05 + this.headPitch * 0.4, this.headYaw * 0.4, 0.1 * alive);
    rot(head, -0.08 + this.headPitch * 0.6 + this.aimPitch * 0.4 + beat * 0.09 * alive + Math.max(0, noise1(t * 2.3)) * 0.1 * alive,
      this.headYaw * 0.6 + noise1(t * 0.9 + 4) * 0.14 * alive, (0.26 + beat * 0.14) * alive);
    rot(jaw, -0.06 - Math.max(0, noise1(t * 1.3 + 2)) * 0.18 * alive - tel * 0.3, 0, 0);
    // tail: −x lifts it. It rides level, rising as a telegraph builds
    for (let j = 0; j < 4; j++) {
      rot(this.tail[j]!, (0.04 - tel * 0.26) * (j === 0 ? 1 : 0.6) + Math.sin(t * 1.3 - j * 0.7) * 0.05 * alive, Math.sin(t * 1.7 - j * 0.9) * 0.16 * alive + beat * 0.08 * (j % 2 ? 1 : -1), 0);
    }

    // ---- skitter: diagonal trot on planted feet, spine and tail snaking against each other
    const sp = this.speed;
    const mv = smoothstep(0.08, 0.8, sp) * alive;
    const stride = 0.42 + clamp01(sp / 8) * 0.62;
    this.gait += gaitRate(sp, stride, DUTY) * adt;
    const dx = -Math.sin(this.moveYaw), dz = -Math.cos(this.moveYaw);
    const inv = 1 / this.scale;
    for (const l of this.legs) {
      gaitFoot(this.gait + l.phase, stride, 0.13 + clamp01(sp / 8) * 0.08, DUTY, _g);
      l.off.x += dx * _g.along * mv * inv; l.off.z += dz * _g.along * mv * inv; l.off.y += _g.lift * mv;
    }
    const ph = this.gait * TAU;
    move(hips, 0, (Math.cos(ph * 2) * 0.018 - 0.07) * mv, 0);
    rot(hips, 0, Math.sin(ph) * 0.14 * mv, Math.sin(ph) * 0.05 * mv);
    rot(spine, 0, -Math.sin(ph) * 0.12 * mv, 0);
    rot(chest, -0.05 * mv, -Math.sin(ph) * 0.1 * mv, -Math.sin(ph) * 0.05 * mv);
    rot(neck, 0.06 * mv, Math.sin(ph) * 0.08 * mv, 0);
    for (let j = 0; j < 4; j++) rot(this.tail[j]!, -0.04 * mv, Math.sin(ph - 0.8 - j * 0.8) * 0.2 * mv, 0);
    // idle foot taps
    if (mv < 0.5 && alive) {
      const idx = Math.floor(t * 0.37) % 4;
      const tap = Math.max(0, Math.sin((t * 0.37 - Math.floor(t * 0.37)) * Math.PI * 6)) * (noise1(Math.floor(t * 0.37) * 3.3) > 0 ? 1 : 0);
      this.legs[idx]!.off.y += tap * 0.05 * (1 - mv * 2);
    }

    // ---- actions
    for (const s of this.active) {
      const w = s.w, st = s.t;
      switch (s.name) {
        case 'lunge': {
          const thrust = keys(st, K.luThrust) * w;
          move(hips, 0, -0.06 * Math.abs(thrust), -0.3 * thrust);
          move(chest, 0, -0.08 * thrust, -0.22 * thrust);
          rot(spine, 0.12 * thrust, 0, 0);
          rot(neck, -0.25 * thrust, 0, 0);
          rot(head, 0.3 * thrust, 0, -0.2 * thrust);
          rot(jaw, -0.7 * keys(st, K.luJaw) * w, 0, 0);
          for (const l of this.legs) {
            if (!l.front) continue;
            l.off.z += -0.55 * Math.max(0, thrust) * (l.side > 0 ? 1 : 0.6);
            l.off.y += (win(st, 0.14, 0.22, 0.27, 0.32) * 0.3 + 0.12 * Math.max(0, thrust)) * w * (l.side > 0 ? 1 : 0.4);
            l.off.x += -l.side * 0.2 * Math.max(0, thrust);
          }
          break;
        }
        case 'pounce': {
          // play-bow: chest to the floor, haunches high, forelegs gathered under it, tail whipped up — held,
          // shaking, until the launch
          const crouch = keys(st, K.poCrouch) * w;
          const fl = clamp01((st - LAUNCH) / (LAND - LAUNCH));
          const air = (st > LAUNCH && st < LAND ? 1 : 0) * w;
          const arc = Math.sin(Math.PI * fl) * 0.75 * (1 - cb) * w * (st > LAUNCH && st <= LAND ? 1 : 0);
          const landK = impact(st, LAND, 0.16, 15) * w;
          const settle = keys(st, K.poSettle) * w;
          const tremble = noise1(st * 40) * crouch * 0.012 * smoothstep(0.22, 0.3, st);
          move(hips, tremble, -0.12 * crouch + arc - 0.1 * settle - 0.04 * landK, 0.24 * crouch - 0.1 * air);
          move(chest, 0, -0.06 * crouch - 0.05 * settle, 0.05 * crouch - 0.16 * air);
          rot(hips, -0.3 * crouch + air * (0.45 - fl * 1.0) - 0.1 * settle, 0, 0);
          rot(spine, 0.06 * crouch + air * 0.12, 0, 0);
          rot(neck, 0.32 * crouch - air * 0.2, 0, 0);
          rot(head, 0.3 * crouch + air * 0.2 * fl, 0, 0);
          rot(jaw, -0.35 * crouch - 0.8 * air * smoothstep(0.3, 0.8, fl), 0, 0);
          for (let j = 0; j < 4; j++) rot(this.tail[j]!, -0.4 * crouch + air * 0.14 - 0.1 * settle, 0, 0);
          for (const l of this.legs) {
            l.off.x += l.side * ((l.front ? -0.1 : 0.12) * crouch + 0.16 * settle);
            l.off.z += (l.front ? 0.3 : -0.1) * crouch;
            if (air > 0) {
              // airborne: the feet travel with the body — forelegs reach for the target, hind legs trail
              const reach = l.front ? -0.3 - 0.45 * fl : 0.4 - 0.25 * fl;
              l.off.z += reach * air;
              l.off.y += (arc / Math.max(w, 1e-3) + (l.front ? 0.38 + 0.2 * Math.sin(Math.PI * fl) : 0.18)) * air * (1 - 0.9 * smoothstep(0.7, 1, fl));
              l.off.x += -l.side * 0.18 * air * (l.front ? 1 : 0.4);
            }
            l.off.z += (l.front ? -0.12 : 0.06) * settle;
          }
          break;
        }
        case 'ceilingCling': {
          rot(neck, 0.3 * w, 0, 0);
          rot(head, 0.45 * w, 0, 0.2 * w);
          move(hips, 0, -0.1 * w, 0);
          move(chest, 0, -0.12 * w, 0);
          for (let j = 0; j < 4; j++) rot(this.tail[j]!, 0, 0.35 * w, 0);
          for (const l of this.legs) l.off.x += l.side * 0.08 * w;
          break;
        }
        case 'hitLight': case 'hitHeavy': {
          const a = s.name === 'hitHeavy' ? 2 : 1;
          const f = impact(st, 0, 0.1, 22) * w * a;
          move(hips, 0, -0.05 * Math.abs(f), 0.07 * f);
          rot(chest, 0.1 * f, 0.1 * f, 0);
          rot(head, 0.25 * f, 0, 0.2 * f);
          rot(jaw, -0.4 * Math.abs(f), 0, 0);
          break;
        }
        case 'stagger': {
          const down = keys(st, K.stDown) * w;
          const scrab = Math.sin(st * 26) * win(st, 0.5, 0.65, 1.0, 1.2) * w;
          move(hips, 0, -0.3 * down, 0.1 * down);
          rot(hips, 0, 0, 0.25 * down);
          rot(neck, 0.1 * down, 0, 0);
          rot(head, -0.05 * down, 0, 0.5 * down);
          rot(jaw, -0.5 * down, 0, 0);
          for (const l of this.legs) { l.off.x += l.side * 0.26 * down; l.off.y += Math.max(0, scrab * (l.front ? 1 : -1)) * 0.12; }
          for (let j = 0; j < 4; j++) rot(this.tail[j]!, -0.2 * down, Math.sin(st * 9 - j) * 0.3 * down, 0);
          break;
        }
        case 'spawn': {
          const curl = (1 - keys(st, K.spCurl)) * w;
          move(hips, 0, -0.3 * curl, 0);
          rot(spine, -0.2 * curl, 0, 0);
          rot(neck, -0.2 * curl, 0, 0);
          for (const l of this.legs) { l.off.x -= l.side * 0.28 * curl; l.off.z += (l.front ? 0.2 : -0.2) * curl; }
          break;
        }
        case 'death': {
          // drops onto its belly, rolls half onto its side and draws its legs in; the head comes to rest on
          // the floor, not through it
          const drop = keys(st, K.deDrop) * w;
          const curl = keys(st, K.deCurl) * w;
          const thud = impact(st, 0.5, 0.14, 20) * w;
          move(hips, 0, -0.3 * drop + 0.03 * thud, 0);
          rot(hips, 0, 0.2 * curl, 0.45 * drop);
          rot(spine, 0, 0.3 * curl, 0);
          rot(neck, -0.06 * curl, 0.45 * curl, 0);
          rot(head, 0, 0.25 * curl, 0.5 * drop);
          rot(jaw, -0.6 * drop, 0, 0);
          for (const l of this.legs) {
            // it rolls onto its left side: those legs splay flat, the upper pair curls in off the ground
            if (l.side > 0) { l.off.x += 0.22 * drop - 0.4 * curl; l.off.y += 0.55 * curl; }
            else l.off.x -= 0.26 * drop;
            l.off.z += (l.front ? 0.2 : -0.24) * curl;
          }
          for (let j = 0; j < 4; j++) rot(this.tail[j]!, -0.06 * drop, 0.5 * curl * (1 - j * 0.1), 0);
          break;
        }
        case 'generic': {
          const f = impact(st, 0, 0.16, 14) * w;
          rot(head, 0.2 * f, 0.2 * f, 0);
          break;
        }
        default: break;
      }
    }

    // ---- ground constraint: nothing of the trunk, head or tail goes through the surface it stands on
    this.root.updateWorldMatrix(true, false);
    this.bCling.updateWorldMatrix(true, false);
    jaw.updateWorldMatrix(true, false);
    this.tail[3]!.updateWorldMatrix(true, false);
    _m.copy(this.bCling.matrixWorld).invert();
    const deficit = groundDeficit(this.probes, _m);
    if (deficit > 0) hips.position.y += deficit;

    // ---- turn-stepping (floor only): diagonal pairs re-plant together when the root has turned under them
    const onFloor = cb < 0.02 && alive > 0;
    let stepping0 = false, stepping1 = false;
    for (const l of this.legs) { if (l.plant.stepping) { if (l.phase === 0) stepping0 = true; else stepping1 = true; } }
    for (const l of this.legs) {
      const otherBusy = l.phase === 0 ? stepping1 : stepping0;
      l.plant.update(onFloor ? this.yawDelta : 0, dt, onFloor && !otherBusy && mv < 0.3, onFloor ? mv : 1, TURN_LIMIT, TURN_STEP_TIME);
    }

    // ---- legs
    for (const l of this.legs) {
      _t.copy(l.rest).add(l.off);
      l.plant.apply(_t);
      _t.y += l.plant.lift * 0.1;
      _pole.set(l.side * 0.6, 1, l.front ? -0.1 : 0.1);
      l.limb.solve(_t, _pole);
      if (l.limb.end.y < -0.004) {
        // the target was nearer than the folded leg can reach, so the foot overshot through the surface:
        // aim higher by the overshoot and solve again
        _t.y -= l.limb.end.y * 1.6;
        l.limb.solve(_t, _pole);
      }
    }

    // ---- glow + bounds
    const on = this.dead ? 1 - smoothstep(0.2, 0.8, this.weight('death')) : 1;
    this.groupGlow('eye', (0.85 + beat * 0.9 + tel * 1.5) * on);
    this.groupGlow('core', (0.7 + beat * 0.8 + this.exposure('core') * 1.2 + tel * 1.2) * on);
    this.groupGlow('nodes', (0.4 + beat * 1.4) * on);
    this.u.uKnit.value.set(0.2 * alive, 0, 0, tel * 0.3);
    this.rig.setBoundsCenter(this.bCling.position.x, this.bCling.position.y + 0.5 * (1 - cb), this.bCling.position.z, 1.8);
  }
}

export function createWallrunner(game: Game | null, opts?: CharacterCreateOpts): Wallrunner {
  return new Wallrunner(game, opts);
}

export const WALLRUNNER_ACTIONS = ACTIONS;
export { LAUNCH as WALLRUNNER_LAUNCH_T, LAND as WALLRUNNER_LAND_T };
