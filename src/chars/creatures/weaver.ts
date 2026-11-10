/**
 * Weaver — the Eclipse link source (≈2.3 m): tall, narrow, slow. A spindle of dark tissue corseted in
 * stretched blade plates, gliding on a skirt of trailing roots, a broken gold ring of needles behind its
 * canted head (the loom), and eight filament arms that braid the air in front of the core the links leave from.
 * Three of the arms are link arms and can be pointed at the bodies it holds; when its links are cut every
 * filament goes slack.
 *
 * Model space: skirt on y = 0, front = −Z.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game, Vec3Like } from '@/core/api';
import type { WeaverVisual } from '@/core/api/creatures';
import { clamp, clamp01, damp, smoothstep } from '@/core/mathx';
import { finite3, impact, keys, noise1, rot, move } from './core/anim';
import { CreatureBase, type ActionDef } from './core/base';
import { along, band, blob, shard, sphere, T, torus, tube, type Pt3 } from './core/geo';
import { P, tint } from './core/palette';
import { addPlate, bladeOutline, facing, kite } from './core/plates';
import { getTemplate, RigBuilder, type Paint, type RigTemplate } from './core/rig';

const G = { core: 1, eye: 2, tips: 3, nodes: 4 } as const;
const ARM_BONES = 5;
const SKIRT_BONES = 3;
const SKIRTS = 9;

interface ArmDef { at: Pt3; dir: Pt3; len: number; r: number }
const ARMS: ArmDef[] = [
  { at: [0.2, 1.86, 0.08], dir: [0.75, 0.25, -0.35], len: 1.5, r: 0.046 },   // link arm (right)
  { at: [-0.2, 1.86, 0.08], dir: [-0.75, 0.25, -0.35], len: 1.5, r: 0.046 }, // link arm (left)
  { at: [0.0, 1.94, 0.16], dir: [0.1, 0.85, 0.3], len: 1.3, r: 0.042 },     // link arm (crown)
  { at: [0.22, 1.66, 0.06], dir: [0.85, -0.25, -0.3], len: 1.4, r: 0.036 },
  { at: [-0.22, 1.66, 0.06], dir: [-0.85, -0.25, -0.3], len: 1.4, r: 0.036 },
  { at: [0.18, 1.45, 0.1], dir: [0.7, -0.6, -0.1], len: 1.25, r: 0.032 },
  { at: [-0.18, 1.45, 0.1], dir: [-0.7, -0.6, -0.1], len: 1.25, r: 0.032 },
  { at: [0.05, 1.7, 0.2], dir: [-0.2, -0.3, 0.9], len: 1.2, r: 0.032 },
];
const CORE: Pt3 = [0, 1.56, -0.2];

function skirtPts(k: number): Pt3[] {
  const a = (k / SKIRTS) * Math.PI * 2 + 0.2;
  const c = Math.cos(a), s = Math.sin(a);
  const reach = 0.72 + Math.sin(k * 2.3) * 0.14;
  return [[c * 0.15, 0.94, 0.04 + s * 0.13], [c * 0.25, 0.52, s * 0.23], [c * 0.4, 0.13, s * 0.38], [c * reach, 0.025, s * reach]];
}

/** tabard blades: [yaw, length, width] — each hangs from its own hinge so it can splay when the body sinks */
const TABARD: readonly (readonly [number, number, number])[] = [
  [0, 0.8, 0.2], [0.8, 0.62, 0.17], [1.6, 0.74, 0.18], [2.4, 0.6, 0.17], [3.14, 0.86, 0.2], [-2.4, 0.64, 0.17], [-1.55, 0.72, 0.18], [-0.8, 0.58, 0.17],
];
const TABARD_Y = 1.0;
/** blade outward lean at rest: sin / cos of the angle between the hanging blade and straight down */
const TAB_N = 0.36 / Math.hypot(1, 0.36);
const TAB_REST = Math.asin(TAB_N);

function buildWeaver(): RigTemplate {
  const b = new RigBuilder();
  b.bone('base', null, [0, 0, 0]);
  b.bone('pelvis', 'base', [0, 0.95, 0.04]);
  b.bone('spine', 'pelvis', [0, 1.3, 0.04]);
  b.bone('chest', 'spine', [0, 1.62, 0]);
  b.bone('neck', 'chest', [0, 1.95, -0.06]);
  b.bone('head', 'neck', [0, 2.08, -0.14]);
  b.bone('halo', 'chest', [0, 1.94, 0.2]);
  const armChains: string[][] = ARMS.map((a, i) => {
    const d = new THREE.Vector3(a.dir[0], a.dir[1], a.dir[2]).normalize();
    const pts: Pt3[] = [];
    for (let j = 0; j < ARM_BONES; j++) {
      const s = (a.len * j) / ARM_BONES;
      pts.push([a.at[0] + d.x * s, a.at[1] + d.y * s, a.at[2] + d.z * s]);
    }
    return b.chain(`a${i}_`, 'chest', pts);
  });
  TABARD.forEach(([yaw], i) => b.bone('tb' + i, 'pelvis', [Math.sin(yaw) * 0.2, TABARD_Y, 0.04 - Math.cos(yaw) * 0.18]));
  const skirtChains: string[][] = [];
  for (let k = 0; k < SKIRTS; k++) skirtChains.push(b.chain(`s${k}_`, 'pelvis', skirtPts(k).slice(0, SKIRT_BONES)));

  // ---- spindle of tissue
  b.addSkinned(['pelvis', 'spine', 'chest', 'neck'], P.tissue,
    tube([[0, 0.9, 0.04], [0, 1.1, 0.05], [0, 1.3, 0.04], [0, 1.5, 0.01], [0, 1.68, 0], [0, 1.85, -0.03], [0, 1.97, -0.07]], [0.2, 0.135, 0.12, 0.19, 0.235, 0.16, 0.075], 10, false),
    undefined, {}, [0, 0.3, 0.52, 0.86], 0.45);
  b.add('pelvis', P.tissueWet, blob(0.17, 1, 0.25, 51, [1.1, 0.7, 1]), T(0, 0.93, 0.04), { crease: 180 });
  // ---- corset: stretched blade plates hanging point-down around the chest, the front left open for the core
  const corset: [number, number, number, number, Paint][] = [
    [0.8, 1.74, 0.68, 0.16, P.whiteGold], [-0.85, 1.72, 0.62, 0.15, P.ivoryWorn], [1.75, 1.76, 0.74, 0.17, P.refNavy],
    [-1.8, 1.75, 0.7, 0.16, P.whiteGold], [2.65, 1.78, 0.78, 0.17, P.ivoryWorn], [-2.7, 1.77, 0.72, 0.16, P.domBronze],
  ];
  corset.forEach(([yaw, y, len, w, paint], i) => {
    const n: Pt3 = [Math.sin(yaw), 0.1, -Math.cos(yaw)];
    addPlate(b, 'chest', paint, bladeOutline(w * 1.25, len, 500 + i, i % 2 ? 0.08 : -0.06), facing([n[0] * 0.255, y, n[2] * 0.235], n, [0, -1, 0], (i % 2 ? 1 : -1) * 0.05), { thick: 0.028, rx: 0.2, lift: 0.05, trim: i === 0 ? tint(P.gold, { r: 0.42 }) : undefined });
  });
  for (let i = 0; i < 5; i++) {
    const yaw = 0.6 + i * 1.3;
    const n: Pt3 = [Math.sin(yaw), 0, -Math.cos(yaw)];
    addPlate(b, 'spine', i % 2 ? P.ivoryWorn : P.whiteGold, bladeOutline(0.09, 0.42, 510 + i), facing([n[0] * 0.155, 1.36, 0.04 + n[2] * 0.145], n, [0, -1, 0], 0), { thick: 0.022, rx: 0.16, lift: 0.04 });
  }
  // ---- mantle: two long shards raking up and back from the shoulders
  b.add('chest', P.whiteGold, shard(0.66, 0.15, 0.08, 520, 4, 0.5), along([0.14, 1.82, 0.02], [0.5, 2.3, 0.32]), { crease: 30 });
  b.add('chest', P.ivoryWorn, shard(0.56, 0.14, 0.08, 521, 4, 0.5), along([-0.14, 1.8, 0.02], [-0.5, 2.18, 0.28]), { crease: 30 });
  b.add('chest', P.domBronze, shard(0.34, 0.1, 0.06, 522, 4, 0.5), along([0.2, 1.74, -0.04], [0.46, 1.9, -0.16]), { crease: 30 });
  // ---- the core the links leave from: lit bulb in a tissue lip, three spinneret prongs
  b.add('chest', tint(P.violet, { e: 1.5 }), blob(0.085, 2, 0.18, 53), T(CORE[0], CORE[1], CORE[2] + 0.04), { group: G.core, crease: 180 });
  b.add('chest', P.tissueWet, torus(0.1, 0.036, 12, 5), T(CORE[0], CORE[1], CORE[2] + 0.06, Math.PI / 2, 0, 0), { crease: 180 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    b.add('chest', P.domBlack, shard(0.17, 0.035, 0.03, 530 + i, 4, 0.6), along([Math.cos(a) * 0.11, CORE[1] + Math.sin(a) * 0.11, CORE[2] + 0.05], [Math.cos(a) * 0.07, CORE[1] + Math.sin(a) * 0.07, CORE[2] - 0.13]), { crease: 30 });
  }
  // ---- head: small split mask with the lit cleft, needles swept back; hangs canted on a thin neck
  b.add('head', P.tissue, blob(0.11, 1, 0.2, 55, [1, 1.1, 1.15]), T(0, 2.09, -0.12), { crease: 180 });
  addPlate(b, 'head', P.whiteGold, kite(0.19, 0.42, 0.3, 541), facing([0.07, 2.07, -0.235], [0.6, 0.15, -0.78], [0, 1, 0.2], 0.08), { thick: 0.026, rx: 0.24, lift: 0.02, trim: tint(P.gold, { r: 0.42 }) });
  addPlate(b, 'head', P.ivoryWorn, kite(0.18, 0.38, 0.3, 542), facing([-0.078, 2.04, -0.215], [-0.64, 0.12, -0.74], [0, 1, 0.2], -0.2), { thick: 0.026, rx: 0.24, lift: 0.02 });
  b.add('head', P.domBlack, sphere(0.05, 1), T(-0.004, 2.07, -0.2, 0, 0, 0, [0.7, 2.6, 1]), { crease: 180 });
  b.add('head', tint(P.violetEye, { e: 1.5 }), sphere(0.013, 1), T(-0.006, 2.09, -0.262, 0, 0, 0, [0.9, 5, 0.9]), { group: G.eye, crease: 180 });
  const needles: [Pt3, Pt3, number][] = [[[0.02, 2.2, -0.1], [0.08, 2.5, 0.1], 0.045], [[-0.06, 2.17, -0.08], [-0.24, 2.36, 0.1], 0.036]];
  needles.forEach(([a, c, w], i) => b.add('head', i === 1 ? P.ivoryWorn : P.whiteGold, shard(Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), w, w * 0.7, 550 + i, 4, 0.6), along(a, c, i), { crease: 30 }));
  // ---- the loom: a broken ring of King-era gold behind the head, bristling with needles
  const HC: Pt3 = [-0.02, 2.0, 0.27];
  const haloM = T(HC[0], HC[1], HC[2], Math.PI / 2 - 0.22, 0, 0.12);
  b.add('halo', P.goldDeep, band(0.36, 0.042, 0.03, 32, 0.009, 4.5, -0.17), haloM);
  for (let i = 0; i < 8; i++) {
    const a = -0.1 + i * 0.6;
    const len = 0.16 + ((i * 5) % 4) * 0.075;
    const p0 = new THREE.Vector3(Math.cos(a) * 0.36, 0, -Math.sin(a) * 0.36).applyMatrix4(haloM);
    const p1 = new THREE.Vector3(Math.cos(a) * (0.36 + len), 0.02, -Math.sin(a) * (0.36 + len)).applyMatrix4(haloM);
    b.add('halo', i % 3 === 0 ? P.refSteel : P.ivoryWorn, shard(len, 0.04, 0.028, 560 + i, 4, 0.7), along([p0.x, p0.y, p0.z], [p1.x, p1.y, p1.z], i), { crease: 30 });
  }
  b.add('halo', P.sinew, tube([[0.0, 1.78, 0.14], [-0.01, 1.88, 0.2], [HC[0], HC[1] - 0.35, HC[2] + 0.05]], 0.03, 5), undefined, { crease: 180 });
  // ---- filament arms
  armChains.forEach((chain, i) => {
    const a = ARMS[i]!;
    const d = new THREE.Vector3(a.dir[0], a.dir[1], a.dir[2]).normalize();
    const tip: Pt3 = [a.at[0] + d.x * a.len, a.at[1] + d.y * a.len, a.at[2] + d.z * a.len];
    b.tubeOn(chain, tip, i % 2 ? P.sinew : P.tissueWet, (t) => a.r * (1 - t * 0.8) + 0.004, 5, {}, 1, 3);
    b.add(chain[ARM_BONES - 1]!, i < 3 ? P.violet : P.violetSoft, sphere(i < 3 ? 0.02 : 0.012, 1), T(tip[0], tip[1], tip[2]), { group: G.tips, crease: 180, rand: i / 8 });
    b.add('chest', P.tissue, sphere(a.r * 1.9, 1), T(a.at[0], a.at[1], a.at[2]), { crease: 180 });
    // vertebrae: a small stolen blade seated on each segment, so the arm reads as assembled, not grown
    for (let j = 0; j < ARM_BONES - 1; j++) {
      const o = b.at(chain[j]!);
      const k = 1 - j / ARM_BONES;
      const up: Pt3 = [d.y * d.x * -0.6, 1 - d.y * d.y * 0.6, d.y * d.z * -0.6];
      const base: Pt3 = [o[0] + d.x * 0.06 + up[0] * a.r, o[1] + d.y * 0.06 + up[1] * a.r, o[2] + d.z * 0.06 + up[2] * a.r];
      const tipv: Pt3 = [base[0] + d.x * 0.2 * k + up[0] * 0.05, base[1] + d.y * 0.2 * k + up[1] * 0.05, base[2] + d.z * 0.2 * k + up[2] * 0.05];
      b.add(chain[j]!, (i + j) % 3 === 0 ? P.domBronze : (i + j) % 3 === 1 ? P.whiteGold : P.ivoryWorn, shard(0.22 * k + 0.04, 0.06 * k + 0.015, 0.03 * k + 0.012, 570 + i * 7 + j, 4, 0.6), along(base, tipv, j), { crease: 30 });
    }
  });
  // ---- skirt: trailing roots + a tabard of hanging blades
  skirtChains.forEach((chain, k) => {
    const pts = skirtPts(k);
    b.tubeOn(chain, pts[3]!, k % 2 ? P.sinew : P.tissue, (t) => 0.055 * (1 - t * 0.8) + 0.007, 6, {}, 1, 3);
  });
  const tabPaint: Paint[] = [P.whiteGold, P.ivoryWorn, P.domOxblood, P.whiteGold, P.ivoryWorn, P.domBlack, P.refNavy, P.whiteGold];
  TABARD.forEach(([yaw, len, w], i) => {
    const n: Pt3 = [Math.sin(yaw), 0.36, -Math.cos(yaw)];
    addPlate(b, 'tb' + i, tabPaint[i]!, bladeOutline(w, len, 580 + i), facing([n[0] * 0.2, TABARD_Y, 0.04 + n[2] * 0.18], n, [0, -1, 0], (i % 2 ? 0.06 : -0.05)), { thick: 0.024, rx: 0.24, lift: 0.05, trim: i === 0 ? tint(P.gold, { r: 0.42 }) : undefined });
  });
  b.add('pelvis', P.domOxblood, torus(0.2, 0.028, 12, 5), T(0, 1.02, 0.04, 0.06, 0, 0, [1.05, 1, 0.92]), { crease: 180 });
  for (const n of [[0.09, 1.42, -0.1], [-0.11, 1.2, 0.02], [0.06, 1.05, -0.09]] as Pt3[]) b.add('spine', P.violetSoft, sphere(0.013, 1), T(n[0], n[1], n[2]), { group: G.nodes, crease: 180 });

  b.socket('core', 'chest', [CORE[0], CORE[1], CORE[2] - 0.1]);
  b.socket('head', 'head', [0, 2.1, -0.18]);
  b.socket('eye', 'head', [0, 2.09, -0.27]);
  b.socket('chest', 'chest', [0, 1.62, -0.1]);
  for (const [name, i] of [['handR', 0], ['handL', 1]] as const) {
    const a = ARMS[i]!;
    const d = new THREE.Vector3(a.dir[0], a.dir[1], a.dir[2]).normalize();
    b.socket(name, armChains[i]![ARM_BONES - 1]!, [a.at[0] + d.x * a.len, a.at[1] + d.y * a.len, a.at[2] + d.z * a.len]);
  }
  b.socket('top', 'chest', [0, 2.5, 0.2]);
  return b.build();
}

const ACTIONS: Record<string, ActionDef> = {
  idle: { dur: 3, loop: true },
  weave: { dur: 3.2, loop: true, fade: 0.5, out: 0.5 },
  pulse: { dur: 1.5, hits: [0.75], hitName: 'release', fade: 0.15, out: 0.3 },
  hitLight: { dur: 0.4, fade: 0.03, react: true, ignoreFreeze: true },
  hitHeavy: { dur: 0.7, fade: 0.03, react: true, ignoreFreeze: true },
  stagger: { dur: 1.8, fade: 0.08, out: 0.5 },
  spawn: { dur: 1.8, fade: 0, revive: true, dissolveIn: 1.0 },
  death: { dur: 3.2, hold: true, fade: 0.1, ignoreFreeze: true, thaw: true, events: [[1.0, 'impact']], dissolveOut: [1.6, 3.2] },
  generic: { dur: 0.6, react: true, ignoreFreeze: true },
};
const K = {
  puGather: [0, 0, 0.6, 1, 0.74, 1, 0.82, 0],
  puFlare: [0.72, 0, 0.82, 1, 1.5, 0],
  puCore: [0, 0, 0.7, 1, 0.8, 0],
  stSlack: [0, 0, 0.2, 1, 1.2, 1, 1.8, 0],
  stHunch: [0, 0, 0.25, 1, 1.1, 0.8, 1.8, 0],
  spUnfurl: [0.2, 0, 1.5, 1],
  deCurl: [0.1, 0, 1.2, 1],
  deSink: [0.3, 0, 1.3, 1],
  deCore: [0, 0, 1.2, 1],
} as const;
const ALIASES: Record<string, string> = {
  linkedSync: 'weave', roar: 'weave', attackLight1: 'pulse', attackLight2: 'pulse', attackLight3: 'pulse', attackLight4: 'pulse', attackHeavy: 'pulse',
  shoot: 'pulse', throw: 'pulse', guardBreak: 'stagger', knockdown: 'stagger', spawnBreach: 'spawn', spawnDrop: 'spawn', frozen: 'idle', hover: 'idle',
};

interface Arm {
  bones: THREE.Bone[];
  d0: THREE.Vector3;
  droop: THREE.Vector3;
  side: THREE.Vector3;
  dir: THREE.Vector3;
  root: THREE.Vector3;
  target: THREE.Vector3 | null;
}

const _d = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _m = new THREE.Matrix4(), _ax = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Weaver extends CreatureBase implements WeaverVisual {
  private slack = 0;
  private slackNow = 0;
  private readonly arms: Arm[] = [];
  private readonly skirt: THREE.Bone[][] = [];
  private readonly tabard: THREE.Bone[];
  private readonly pelvis: THREE.Bone; private readonly spine: THREE.Bone; private readonly chest: THREE.Bone;
  private readonly neck: THREE.Bone; private readonly head: THREE.Bone; private readonly halo: THREE.Bone;

  constructor(game: Game | null, opts?: CharacterCreateOpts) {
    super(game, {
      archetype: 'weaver', height: 2.3, radius: 0.45, template: getTemplate('weaver', buildWeaver),
      actions: ACTIONS, aliases: ALIASES, groups: G, frostOrigin: [0, 1.4, 0], frostRange: 1.9, eclipse: true, baseCorruption: 0.6,
      rim: [0xb9a8e6, 0.24],
    }, opts);
    const r = this.rig;
    this.pelvis = r.b('pelvis'); this.spine = r.b('spine'); this.chest = r.b('chest');
    this.neck = r.b('neck'); this.head = r.b('head'); this.halo = r.b('halo');
    ARMS.forEach((a, i) => {
      const d0 = new THREE.Vector3(a.dir[0], a.dir[1], a.dir[2]).normalize();
      const droop = new THREE.Vector3(d0.z, 0, -d0.x);
      if (droop.lengthSq() < 1e-4) droop.set(1, 0, 0);
      droop.normalize();
      const bones: THREE.Bone[] = [];
      for (let j = 0; j < ARM_BONES; j++) bones.push(r.b(`a${i}_${j}`));
      this.arms.push({ bones, d0, droop, side: new THREE.Vector3().crossVectors(d0, droop).normalize(), dir: d0.clone(), root: new THREE.Vector3(a.at[0], a.at[1], a.at[2]), target: null });
    });
    for (let k = 0; k < SKIRTS; k++) {
      const ch: THREE.Bone[] = [];
      for (let j = 0; j < SKIRT_BONES; j++) ch.push(r.b(`s${k}_${j}`));
      this.skirt.push(ch);
    }
    this.tabard = TABARD.map((_, i) => r.b('tb' + i));
  }

  protected override heal(): void {
    this.slackNow = 0;
    for (const a of this.arms) { a.dir.copy(a.d0); a.target = null; }
  }

  setLinkTarget(index: number, target: Vec3Like | null): void {
    const arm = this.arms[index];
    if (!arm || index > 2 || index < 0) return;
    if (!finite3(target)) { arm.target = null; return; }
    (arm.target ??= new THREE.Vector3()).set(target.x, target.y, target.z);
  }

  setSlack(amount: number): void {
    this.slack = clamp01(amount || 0);
  }

  protected override lookHeight(): number {
    return 2.08;
  }

  protected override pose(adt: number, dt: number): void {
    const t = this.time;
    const { pelvis, spine, chest, neck, head, halo } = this;
    const beat = this.cadence.beat();
    const alive = this.dead ? 0 : 1;

    // ---- per-action blend parameters
    let weave = 0, gather = 0, flareP = 0, curlDeath = 0, slack = this.slack, hunch = 0, sink = 0, coreGlow = 0, recoil = 0, unfurl = 0;
    for (const s of this.active) {
      const w = s.w, st = s.t;
      switch (s.name) {
        case 'weave': weave = Math.max(weave, w); coreGlow += 0.8 * w; break;
        case 'pulse':
          gather = Math.max(gather, keys(st, K.puGather) * w);
          flareP = Math.max(flareP, keys(st, K.puFlare) * w);
          recoil += impact(st, 0.75, 0.12) * w;
          coreGlow += (2.6 * keys(st, K.puCore) + 5 * impact(st, 0.75, 0.1)) * w;
          break;
        case 'hitLight': case 'hitHeavy': recoil += impact(st, 0, 0.14, 16) * w * (s.name === 'hitHeavy' ? 1.8 : 0.8); break;
        case 'stagger':
          slack = Math.max(slack, keys(st, K.stSlack) * w);
          hunch += keys(st, K.stHunch) * w;
          coreGlow -= 0.6 * w;
          break;
        case 'spawn': unfurl = Math.max(unfurl, (1 - keys(st, K.spUnfurl)) * w); break;
        case 'death':
          curlDeath = Math.max(curlDeath, keys(st, K.deCurl) * w);
          sink = Math.max(sink, keys(st, K.deSink) * w);
          coreGlow -= 2 * keys(st, K.deCore) * w;
          break;
        case 'generic': recoil += impact(st, 0, 0.2, 12) * w * 0.5; break;
        default: break;
      }
    }
    this.slackNow = damp(this.slackNow, slack, 5, dt);
    const sl = this.slackNow;

    // ---- body: slow sway on the skirt, canted head ticking on the cadence
    const sway = Math.sin(t * 0.5), sway2 = Math.sin(t * 0.37 + 1);
    move(pelvis, 0, Math.sin(t * 0.8) * 0.012 * alive - sink * 0.72 - unfurl * 0.5 - hunch * 0.08, 0);
    rot(pelvis, sway2 * 0.025 * alive + this.velZ * 0.045 - recoil * 0.05, sink * 0.7, sway * 0.035 * alive - this.velX * 0.045);
    rot(spine, -sway2 * 0.02 - hunch * 0.3 - sink * 0.45 - unfurl * 0.6 - gather * 0.08 + recoil * 0.08, 0, -sway * 0.03 + weave * Math.sin(t * 1.1) * 0.04);
    rot(chest, -hunch * 0.26 - sink * 0.3 - unfurl * 0.4 - gather * 0.14 + flareP * 0.16 + recoil * 0.1 + weave * 0.06, clamp(this.lookYaw, -0.6, 0.6) * 0.3, -sway * 0.02);
    rot(neck, -0.1 - hunch * 0.3 - sink * 0.4 + weave * 0.08, clamp(this.lookYaw, -0.9, 0.9) * 0.35, 0.1 * alive + sl * 0.25);
    rot(head, -0.16 + clamp(this.lookPitch, -0.5, 0.5) * 0.6 + this.aimPitch * 0.3 + beat * 0.08 * alive - hunch * 0.35 + weave * 0.12 + recoil * 0.12,
      clamp(this.lookYaw, -0.9, 0.9) * 0.4 + noise1(t * 0.21) * 0.08 * alive, (0.24 + beat * 0.1) * alive + sl * 0.35 + sink * 0.4);
    rot(halo, sl * 0.2 - flareP * 0.2, Math.sin(t * 0.21) * 0.04, Math.sin(t * 0.3) * 0.05 + sl * 0.4 + sink * 0.5);

    // ---- filament arms
    this.root.updateWorldMatrix(true, false);
    chest.updateWorldMatrix(true, false);
    _m.copy(this.rig.group.matrixWorld).invert().multiply(chest.matrixWorld);
    _qc.setFromRotationMatrix(_m).invert();
    const rate = 1 - Math.exp(-(4.5 - sl * 2) * adt);
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!;
      const side = arm.d0.x >= 0 ? 1 : -1;
      // idle: the bind fan, drooped and drifting
      _d.copy(arm.d0).addScaledVector(DOWN, 0.32 + 0.08 * Math.sin(t * 0.4 + i));
      _d.x += Math.sin(t * 0.33 + i * 1.9) * 0.08; _d.z += Math.cos(t * 0.29 + i * 1.3) * 0.08;
      let droop = 0.2 + 0.08 * Math.sin(t * 0.6 + i), wave = 0.1, tw = t * 0.55 + i * 1.3, helix = 0;
      if (weave > 0.001) {
        // braid: tips circle a point ahead of the core, neighbours turning opposite ways
        const th = (i % 2 ? -1 : 1) * t * 2.1 + i * 0.785;
        _v.set(side * 0.16 + Math.cos(th) * 0.34, 0.0 + (i < 3 ? 0.14 : -0.1) + Math.sin(th) * 0.32, -1.0);
        _d.lerp(_v.normalize(), weave);
        droop += (0.05 - droop) * weave; helix += 0.34 * weave; tw = th;
      }
      if (arm.target && i < 3 && alive) {
        _v.copy(arm.target).applyMatrix4(this.rig.toModel).sub(arm.root);
        if (_v.lengthSq() > 1e-6) _d.lerp(_v.normalize(), 0.92);
        droop *= 0.25; helix *= 0.2; wave = 0.03;
      }
      if (gather > 0.001) {
        _v.set(side * 0.06, -0.12 + (i % 4) * 0.03, -1).normalize();
        _d.lerp(_v, gather);
        droop += (0.28 - droop) * gather;
      }
      if (flareP > 0.001) {
        _v.copy(arm.d0); _v.y += 0.35; _v.z += 0.55;
        _d.lerp(_v.normalize(), flareP);
        droop += (-0.25 - droop) * flareP;
      }
      if (sl > 0.001) {
        _v.copy(arm.d0).multiplyScalar(0.22).add(DOWN).normalize();
        _d.lerp(_v, sl);
        droop += (0.04 - droop) * sl; helix *= 1 - sl; wave = wave * (1 - sl) + 0.07 * sl;
      }
      const curl = Math.max(curlDeath, unfurl);
      if (curl > 0.001) {
        _v.set(-arm.d0.x * 0.35, 0.15, -0.25 - arm.d0.z * 0.2).normalize();
        _d.lerp(_v, curl * 0.7);
        droop += (0.95 - droop) * curl; helix *= 1 - curl;
      }
      _d.normalize();
      arm.dir.lerp(_d, rate).normalize();
      // root: aim bind direction → dir (model space), expressed in the chest's frame
      _q.setFromUnitVectors(arm.d0, arm.dir);
      arm.bones[0]!.quaternion.copy(_qc).multiply(_q);
      for (let j = 1; j < ARM_BONES; j++) {
        const a = droop + Math.sin(tw - j * 1.1) * helix + Math.sin(t * 0.7 + i * 1.7 - j * 0.8) * wave + beat * 0.05 * alive;
        const c = Math.cos(tw - j * 1.1) * helix + Math.cos(t * 0.5 + i * 2.1 - j * 0.9) * wave + sl * 0.1 * Math.sin(t * 1.7 + i - j * 0.5);
        const bn = arm.bones[j]!;
        bn.rotation.x += arm.droop.x * a + arm.side.x * c;
        bn.rotation.y += arm.droop.y * a + arm.side.y * c;
        bn.rotation.z += arm.droop.z * a + arm.side.z * c;
      }
    }

    // ---- skirt: roots trail behind the glide and ripple as it "walks"
    const mv = smoothstep(0.05, 0.6, this.speed);
    for (let k = 0; k < SKIRTS; k++) {
      const ch = this.skirt[k]!;
      const ph = t * (1.2 + mv * 2.4) + k * 0.9;
      for (let j = 0; j < SKIRT_BONES; j++) {
        rot(ch[j]!, Math.sin(ph - j * 0.9) * (0.03 + 0.06 * mv) + this.velZ * 0.09 * (j + 0.5) - (j === 0 ? pelvis.rotation.x : 0),
          0, Math.cos(ph - j * 0.9) * (0.03 + 0.06 * mv) - this.velX * 0.09 * (j + 0.5) - (j === 0 ? pelvis.rotation.z : 0));
      }
      // the skirt stays on the floor: its roots are anchored at their rest height whatever the body does
      move(ch[0]!, 0, 0.95 - pelvis.position.y + 0.012, 0);
    }

    // ---- tabard: each blade hangs from its hinge and fans outward as the body comes down, so the tips rest
    // on the floor instead of passing through it (the skirt of a collapsing tent)
    const hinge = TABARD_Y + pelvis.position.y - 0.95;
    for (let i = 0; i < this.tabard.length; i++) {
      const tb = TABARD[i]!;
      const need = Math.acos(clamp((hinge - 0.04) / tb[1], -1, 1));
      const splay = Math.max(0, need - TAB_REST) + (0.03 * beat + 0.08 * mv + 0.05 * flareP) * alive;
      if (splay > 1e-4) this.tabard[i]!.quaternion.setFromAxisAngle(_ax.set(Math.cos(tb[0]), 0, Math.sin(tb[0])), splay);
    }

    // ---- glow
    const on = this.dead ? 1 - smoothstep(0.2, 0.9, curlDeath) : 1;
    this.groupGlow('core', Math.max(0, 0.7 + beat * 0.7 + coreGlow + this.exposure('core') * 1.2) * on);
    this.groupGlow('eye', (0.8 + beat * 0.7) * on);
    const linked = this.arms[0]!.target || this.arms[1]!.target || this.arms[2]!.target ? 1 : 0;
    this.groupGlow('tips', (0.5 + beat * 1.2 + weave * 0.8 + linked * 0.8 + gather * 2) * (1 - sl * 0.85) * on);
    this.groupGlow('nodes', (0.5 + beat * 1.2) * on);
    this.u.uKnit.value.set(0.25 * alive, 0, 0, flareP * 0.5 + curlDeath * 0.8);
    this.rig.setBoundsCenter(0, 1.2 + pelvis.position.y - 0.95, 0, 1.7);
  }
}

export function createWeaver(game: Game | null, opts?: CharacterCreateOpts): Weaver {
  return new Weaver(game, opts);
}

export const WEAVER_ACTIONS = ACTIONS;
