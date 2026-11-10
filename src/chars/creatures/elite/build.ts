/**
 * Elite — regenerative breach organism (≈3.6 m). Geometry + skeleton.
 *
 * Assembled from recognisable physical matter over dark tissue: King-era structural shards (ivory with dead
 * gold trim), a Dominion pauldron / tassets / helm, Reformation panels, a drone vane and lens, cable, ribs.
 * Deliberately asymmetric: the creature's RIGHT side carries the huge architectural club arm and the
 * regenerating shoulder joint under four sliding petal plates; the LEFT a layered bronze pauldron and a
 * long thin grasping arm. The head is small, low and canted — the imposed Eclipse posture.
 *
 * Model space: feet on y = 0, front = −Z, creature's right = +X.
 */
import * as THREE from 'three';
import { along, arcPath, batter, blob, box, prism, shard, sphere, T, torus, tube, type Pt2, type Pt3 } from '../core/geo';
import { P, tint } from '../core/palette';
import { addPlate, facing, kite, limbPlates, slab, type LimbPlate } from '../core/plates';
import { RigBuilder, type Paint, type RigTemplate } from '../core/rig';

export const ELITE_GROUPS = { eye: 1, core: 2, joint: 3, nodes: 4, stump: 5 } as const;

/** the regenerating joint is the creature's RIGHT shoulder (+X in model space) — canonical for AI, VFX and camera */
export const ELITE_JOINT_SIDE = 'R' as const;

/**
 * Proportion pass: the figure is authored squat and then its legs (and everything hanging below the hip
 * line: forearms, claws, tendril ends) are lengthened; the rig is scaled back to 3.6 m by ELITE_MODEL_SCALE.
 */
const LEG_FROM = 0.24, LEG_TO = 1.5, LEG_STRETCH = 1.27;
const LEG_SHIFT = (LEG_TO - LEG_FROM) * (LEG_STRETCH - 1);
export function eliteWarp(p: [number, number, number]): void {
  const y = p[1];
  if (y > LEG_TO) p[1] = y + LEG_SHIFT;
  else if (y > LEG_FROM) p[1] = LEG_FROM + (y - LEG_FROM) * LEG_STRETCH;
}
export const ELITE_MODEL_SCALE = 3.6 / (3.56 + LEG_SHIFT);

/** authoring (un-warped) bind positions */
const E = {
  hips: [0, 1.55, 0.28] as Pt3,
  spine: [0, 1.92, 0.2] as Pt3,
  chest: [0, 2.4, -0.02] as Pt3,
  neck: [0, 2.96, -0.5] as Pt3,
  head: [0, 3.06, -1.0] as Pt3,
  jaw: [0, 2.94, -1.02] as Pt3,
  shR: [0.98, 2.98, -0.12] as Pt3,
  elbowR: [1.42, 1.98, -0.2] as Pt3,
  wristR: [1.36, 0.98, -0.72] as Pt3,
  clawTipR: [1.3, 0.28, -1.02] as Pt3,
  shL: [-0.9, 2.86, -0.14] as Pt3,
  elbowL: [-1.22, 1.9, -0.16] as Pt3,
  wristL: [-1.16, 1.06, -0.62] as Pt3,
  fingerTipL: [-1.1, 0.52, -0.84] as Pt3,
  hipR: [0.5, 1.5, 0.26] as Pt3,
  kneeR: [0.62, 0.86, -0.16] as Pt3,
  ankleR: [0.6, 0.24, 0.26] as Pt3,
  hipL: [-0.5, 1.5, 0.26] as Pt3,
  kneeL: [-0.62, 0.86, -0.16] as Pt3,
  ankleL: [-0.6, 0.24, 0.26] as Pt3,
  core: [0, 2.42, -0.7] as Pt3,
} as const;

/** key bind-pose positions shared with the animation code (final, warped model space) */
export const EW = Object.fromEntries(Object.entries(E).map(([k, v]) => {
  const q: [number, number, number] = [v[0], v[1], v[2]];
  eliteWarp(q);
  return [k, q as Pt3];
})) as { readonly [K in keyof typeof E]: Pt3 };

export const TENDRIL_COUNT = 10;
export const TENDRIL_BONES = 4;
export const TENDRIL_ROOTS: { at: Pt3; dir: Pt3; len: number; parent: string }[] = [
  { at: [0.34, 3.2, 0.52], dir: [0.25, -0.75, 0.6], len: 2.3, parent: 'chest' },
  { at: [-0.3, 3.24, 0.55], dir: [-0.2, -0.75, 0.62], len: 2.6, parent: 'chest' },
  { at: [0.68, 2.86, 0.5], dir: [0.5, -0.75, 0.42], len: 1.9, parent: 'chest' },
  { at: [-0.66, 2.8, 0.52], dir: [-0.45, -0.78, 0.42], len: 2.1, parent: 'chest' },
  { at: [0.02, 2.5, 0.62], dir: [0.05, -0.85, 0.52], len: 1.8, parent: 'chest' },
  { at: [-1.2, 2.72, 0.12], dir: [-0.35, -0.9, 0.25], len: 1.7, parent: 'armL' },
  { at: [0.9, 3.1, 0.4], dir: [0.6, -0.72, 0.3], len: 2.0, parent: 'chest' },
  { at: [-0.86, 3.05, 0.4], dir: [-0.6, -0.72, 0.32], len: 2.2, parent: 'chest' },
  { at: [0.4, 2.6, 0.66], dir: [0.3, -0.85, 0.42], len: 1.6, parent: 'chest' },
  { at: [-0.36, 2.62, 0.68], dir: [-0.28, -0.85, 0.44], len: 1.5, parent: 'chest' },
];

const mulM = (...m: THREE.Matrix4[]): THREE.Matrix4 => m.reduce((a, x) => a.multiply(x), new THREE.Matrix4());
const lerp3 = (a: Pt3, c: Pt3, t: number): Pt3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
const add3 = (a: Pt3, x: number, y: number, z: number): Pt3 => [a[0] + x, a[1] + y, a[2] + z];

/** matte, fibrous tissue: reads as muscle and cable in a dark room instead of glossy black balls */
const TISSUE: Paint = tint(P.tissue, { c: 0x1b1522, r: 0.72 });
const TISSUE_W: Paint = tint(P.tissueWet, { c: 0x17111e, r: 0.56 });
const SINEW: Paint = tint(P.sinew, { c: 0x2a2030, r: 0.62 });
const GOLD_DEAD: Paint = tint(P.goldDeep, { r: 0.5, edge: 0.2 });

/** ivory King-era fragment variations */
const IVORY: Paint = P.whiteGold;
const IVORY_D: Paint = P.ivoryWorn;
const TRIM: Paint = tint(P.gold, { r: 0.42 });

/** bundle of sinew strands from a to c, twisting about the axis */
function sinew(b: RigBuilder, bone: string, a: Pt3, c: Pt3, r: number, strands: number, thick: number, seed: number, paint: Paint = SINEW): void {
  const ax = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = ax.length();
  ax.normalize();
  const u = new THREE.Vector3(0, 0, -1);
  if (Math.abs(ax.z) > 0.9) u.set(1, 0, 0);
  u.addScaledVector(ax, -u.dot(ax)).normalize();
  const v = new THREE.Vector3().crossVectors(ax, u);
  for (let s = 0; s < strands; s++) {
    const a0 = (s / strands) * Math.PI * 2 + seed;
    const pts: Pt3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const ang = a0 + t * 1.1;
      const rr = r * (0.75 + 0.35 * Math.sin(t * Math.PI)) * (0.9 + 0.2 * Math.sin(s * 2.3 + seed));
      pts.push([
        a[0] + ax.x * len * t + (u.x * Math.cos(ang) + v.x * Math.sin(ang)) * rr,
        a[1] + ax.y * len * t + (u.y * Math.cos(ang) + v.y * Math.sin(ang)) * rr,
        a[2] + ax.z * len * t + (u.z * Math.cos(ang) + v.z * Math.sin(ang)) * rr,
      ]);
    }
    b.add(bone, s % 3 === 0 ? TISSUE_W : paint, tube(pts, (t) => thick * (0.7 + 0.5 * Math.sin(t * Math.PI)), 5), undefined, { crease: 180 });
  }
}

/** a recognisable helmet (remains) half-sunk into the mass: dome + visor band + crest */
function helmet(b: RigBuilder, bone: string, m: THREE.Matrix4, dominion: boolean): void {
  const shell = dominion ? P.domBronze : P.refNavy;
  b.add(bone, shell, sphere(0.17, 2), mulM(m.clone(), T(0, 0, 0, 0, 0, 0, [1, 1.08, 1.18])), { crease: 180 });
  b.add(bone, dominion ? P.domBlack : P.glass, box(0.25, 0.07, 0.12, 0.02), mulM(m.clone(), T(0, -0.02, -0.14)));
  if (dominion) b.add(bone, P.domOxblood, prism([[-0.2, 0], [0.16, 0], [0.2, 0.06], [-0.1, 0.1], [-0.22, 0.07]], 0.03, 0.01), mulM(m.clone(), T(0, 0.17, 0.02, 0, Math.PI / 2, 0)));
  else b.add(bone, P.refSteel, box(0.3, 0.05, 0.05, 0.012), mulM(m.clone(), T(0, 0.02, 0.05)));
}

export function buildElite(): RigTemplate {
  const b = new RigBuilder();
  b.setWarp(eliteWarp);
  const G = ELITE_GROUPS;

  // ------------------------------------------------------------------ skeleton
  b.bone('hips', null, E.hips);
  b.bone('spine', 'hips', E.spine);
  b.bone('chest', 'spine', E.chest);
  b.bone('neck', 'chest', E.neck);
  b.bone('head', 'neck', E.head);
  b.bone('jaw', 'head', E.jaw);
  b.bone('ribR', 'chest', [0.2, 2.5, -0.55]);
  b.bone('ribL', 'chest', [-0.2, 2.5, -0.55]);
  b.bone('shR', 'chest', [0.55, 2.95, -0.08]);
  b.bone('armR', 'shR', E.shR);
  b.bone('foreR', 'armR', E.elbowR);
  b.bone('handR', 'foreR', E.wristR);
  for (let i = 0; i < 3; i++) b.bone('clawR' + i, 'handR', [E.wristR[0] + (i - 1) * 0.17, E.wristR[1] - 0.12, E.wristR[2] - 0.12]);
  b.bone('jointCore', 'shR', [E.shR[0] + 0.05, E.shR[1] + 0.06, E.shR[2]]);
  b.bone('stump', 'shR', [E.shR[0] + 0.1, E.shR[1] + 0.12, E.shR[2]]);
  for (let i = 0; i < 4; i++) b.bone('petal' + i, 'shR', [E.shR[0] + [0.0, 0.3, -0.12, 0.12][i]!, E.shR[1] + [0.36, 0.1, 0.12, 0.08][i]!, E.shR[2] + [0, 0, -0.34, 0.34][i]!]);
  b.bone('shL', 'chest', [-0.5, 2.86, -0.1]);
  b.bone('armL', 'shL', E.shL);
  b.bone('foreL', 'armL', E.elbowL);
  b.bone('handL', 'foreL', E.wristL);
  for (let i = 0; i < 3; i++) b.bone('clawL' + i, 'handL', [E.wristL[0] + (i - 1) * 0.1, E.wristL[1] - 0.08, E.wristL[2] - 0.08]);
  b.bone('thighR', 'hips', E.hipR);
  b.bone('shinR', 'thighR', E.kneeR);
  b.bone('footR', 'shinR', E.ankleR);
  b.bone('thighL', 'hips', E.hipL);
  b.bone('shinL', 'thighL', E.kneeL);
  b.bone('footL', 'shinL', E.ankleL);
  const tendrils: string[][] = [];
  TENDRIL_ROOTS.forEach((tr, i) => {
    const d = new THREE.Vector3(tr.dir[0], tr.dir[1], tr.dir[2]).normalize();
    const pts: Pt3[] = [];
    for (let j = 0; j < TENDRIL_BONES; j++) {
      const s = (tr.len * j) / TENDRIL_BONES;
      pts.push([tr.at[0] + d.x * s, tr.at[1] + d.y * s, tr.at[2] + d.z * s + 0.1 * Math.sin(j * 1.3)]);
    }
    tendrils.push(b.chain(`t${i}_`, tr.parent, pts));
  });

  // ------------------------------------------------------------------ tissue core (mostly hidden under plating)
  b.add('hips', TISSUE, blob(0.5, 2, 0.22, 2, [1.18, 0.74, 0.92]), T(0, 1.52, 0.27), { crease: 180 });
  b.addSkinned(['hips', 'spine', 'chest'], TISSUE, tube([[0, 1.5, 0.27], [0, 1.75, 0.24], [0, 2.0, 0.17], [0, 2.25, 0.05], [0, 2.45, -0.04]], [0.44, 0.36, 0.33, 0.42, 0.5], 10, false), undefined, {}, [0, 0.3, 0.72], 0.45);
  b.add('chest', TISSUE, blob(0.7, 2, 0.18, 5, [1.28, 0.92, 0.88]), T(0, 2.58, -0.08), { crease: 180 });
  b.add('chest', TISSUE_W, blob(0.58, 2, 0.2, 9, [1.4, 0.82, 1.02]), T(0.06, 3.0, 0.26), { crease: 180 });
  b.addSkinned(['chest', 'neck'], TISSUE, tube([[0, 2.86, -0.22], [0, 2.95, -0.5], [0, 3.02, -0.78], [0, 3.06, -0.95]], [0.32, 0.27, 0.22, 0.2], 8, false), undefined, {}, [0, 0.4], 0.5);
  // abdominal cabling: the waist is cable and sinew, not armour
  sinew(b, 'spine', [0, 1.6, 0.05], [0, 2.3, -0.3], 0.3, 7, 0.05, 0.4);
  for (const sx of [-1, 1]) {
    b.addSkinned(['hips', 'spine', 'chest'], P.rubber, tube(arcPath([sx * 0.42, 1.52, 0.1], [sx * 0.62, 2.0, 0.42], [sx * 0.5, 2.7, 0.5], 9), 0.045, 6), undefined, {}, [0, 0.35, 0.7], 0.5);
  }

  // ------------------------------------------------------------------ core + ribcage
  b.add('chest', tint(P.violet, { e: 1.7 }), blob(0.2, 2, 0.2, 4), T(E.core[0], E.core[1], E.core[2] + 0.05), { group: G.core, crease: 180 });
  b.add('chest', TISSUE_W, torus(0.25, 0.085, 14, 6), T(E.core[0], E.core[1], E.core[2] + 0.08, Math.PI / 2 - 0.12, 0, 0), { crease: 180 });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const y = 2.74 - i * 0.135;
      const span = 0.52 - Math.abs(i - 1.5) * 0.05;
      const path = arcPath([sx * 0.045, y, -0.83 + i * 0.012], [sx * span * 0.75, y - 0.02, -0.92], [sx * span, y - 0.1, -0.46], 7);
      b.add(sx > 0 ? 'ribR' : 'ribL', i === 2 && sx > 0 ? IVORY_D : P.bone, tube(path, (t) => 0.034 * (1 - t * 0.45), 5), undefined, { crease: 180, slide: [sx * 0.05, 0, -0.07] });
    }
  }
  b.add('chest', IVORY_D, prism([[-0.07, -0.34], [0.07, -0.34], [0.09, 0.3], [0, 0.4], [-0.09, 0.3]], 0.06, 0.02), T(0, 2.55, -0.85, 0.1, Math.PI, 0), { slide: [0, 0.03, -0.06] });

  // ------------------------------------------------------------------ torso plating
  const chestC: Pt3 = [0, 2.58, -0.08];
  const tp = (yaw: number, pitch: number, r: number): { pos: Pt3; n: Pt3 } => {
    const n: Pt3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    return { pos: [chestC[0] + n[0] * r * 1.26, chestC[1] + n[1] * r * 0.92, chestC[2] + n[2] * r * 0.9], n };
  };
  const torso: [number, number, number, Paint, Pt2[], number, Paint | undefined][] = [
    // yaw (0 = front, + = creature's right), pitch, stand-off radius, paint, outline, roll, trim
    [0.75, 0.42, 0.74, IVORY, kite(0.62, 0.78, 0.3, 5), 0.2, TRIM],
    [-0.8, 0.36, 0.74, P.domBronze, kite(0.56, 0.7, 0.34, 8), -0.25, undefined],
    [1.45, 0.05, 0.73, P.refNavy, slab(0.5, 0.74, 3, 1), 0.08, undefined],
    [-1.5, 0.02, 0.73, IVORY_D, slab(0.52, 0.7, 6, 2), -0.1, TRIM],
    [2.35, 0.25, 0.76, IVORY, slab(0.7, 0.86, 9, 2), 0.3, undefined],
    [-2.4, 0.2, 0.76, P.domOxblood, slab(0.62, 0.8, 12, 2), -0.2, undefined],
    [0.62, -0.5, 0.72, IVORY_D, slab(0.4, 0.5, 14, 2), -0.3, undefined],
    [-0.62, -0.52, 0.72, P.refSlate, slab(0.4, 0.46, 15, 1), 0.25, undefined],
    // lower back: the lumbar run under the hump carapace
    [Math.PI, -0.28, 0.75, IVORY, kite(0.62, 0.8, 0.28, 16), 0.04, TRIM],
    [Math.PI - 0.62, -0.62, 0.72, P.domBlack, slab(0.44, 0.56, 17, 2), 0.2, undefined],
    [Math.PI + 0.62, -0.62, 0.72, IVORY_D, slab(0.46, 0.56, 18, 2), -0.2, undefined],
  ];
  torso.forEach(([yaw, pitch, r, paint, outline, roll, trim], i) => {
    const { pos, n } = tp(yaw, pitch, r);
    addPlate(b, 'chest', paint, outline, facing(pos, n, [0, 1, 0], roll), { thick: 0.075, bevel: 0.022, rx: 0.9, trim, rand: i * 0.13, detail: true, inlay: trim ? GOLD_DEAD : undefined });
  });
  // pelvis: skirt of mismatched tassets
  const pel: [number, Paint, Pt2[], number][] = [
    [0.0, P.domBronze, kite(0.46, 0.62, 0.25, 21), 0.0], [0.95, P.refNavy, slab(0.42, 0.58, 22, 2), 0.1], [-1.0, P.domBronze, kite(0.44, 0.6, 0.28, 23), -0.1],
    [2.2, IVORY_D, slab(0.5, 0.56, 24, 2), 0.2], [-2.25, IVORY, slab(0.48, 0.6, 25, 2), -0.15], [3.14, P.domBlack, kite(0.4, 0.66, 0.3, 26), 0],
  ];
  pel.forEach(([yaw, paint, outline, roll], i) => {
    const n: Pt3 = [Math.sin(yaw), 0.12, -Math.cos(yaw)];
    addPlate(b, 'hips', paint, outline, facing([Math.sin(yaw) * 0.6, 1.42, 0.27 - Math.cos(yaw) * 0.48], n, [0, 1, 0], roll), { thick: 0.06, rx: 0.7, lift: 0.08, rand: 0.4 + i * 0.09, trim: paint === IVORY ? TRIM : undefined });
  });
  b.add('hips', P.domOxblood, torus(0.52, 0.06, 14, 6), T(0, 1.72, 0.26, 0.08, 0, 0, [1.12, 1, 0.88]), { crease: 180 });

  // ------------------------------------------------------------------ the hump: a carapace of broken slabs under a crown of spines
  const humpC: Pt3 = [0.06, 3.0, 0.26];
  const hp = (yaw: number, pitch: number): { pos: Pt3; n: Pt3 } => {
    const n: Pt3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    return { pos: [humpC[0] + n[0] * 0.92, humpC[1] + n[1] * 0.56, humpC[2] + n[2] * 0.7], n };
  };
  const back: [number, number, Paint, Pt2[], number, boolean][] = [
    [Math.PI, 0.95, IVORY, slab(0.86, 0.78, 201, 2), 0.1, true],
    [Math.PI - 0.8, 0.45, IVORY_D, slab(0.74, 0.86, 202, 2), 0.25, false],
    [Math.PI + 0.8, 0.45, IVORY, slab(0.76, 0.84, 203, 2), -0.2, true],
    [Math.PI, 0.1, IVORY, kite(0.78, 0.98, 0.26, 204), 0.05, true],
    [Math.PI - 1.45, 0.2, P.refNavy, slab(0.56, 0.74, 205, 1), 0.15, false],
    [Math.PI + 1.5, 0.22, P.domOxblood, slab(0.56, 0.72, 206, 2), -0.1, false],
    [Math.PI - 0.7, -0.5, IVORY_D, kite(0.58, 0.8, 0.28, 207), 0.3, false],
    [Math.PI + 0.72, -0.5, P.domBronze, kite(0.56, 0.78, 0.28, 208), -0.3, false],
    [0.9, 1.0, IVORY_D, slab(0.6, 0.6, 209, 2), 0.4, false],
    [-0.9, 1.0, IVORY, slab(0.62, 0.56, 210, 2), -0.3, true],
  ];
  back.forEach(([yaw, pitch, paint, outline, roll, trim], i) => {
    const { pos, n } = hp(yaw, pitch);
    addPlate(b, 'chest', paint, outline, facing(pos, n, [0, 1, 0], roll), { thick: 0.08, bevel: 0.024, rx: 0.85, ry: 1.3, trim: trim ? TRIM : undefined, rand: 0.05 + i * 0.097, lift: 0.12, detail: true, inlay: trim ? GOLD_DEAD : undefined });
  });
  const spines: [Pt3, Pt3, number, number, number][] = [
    [[0.05, 3.34, 0.3], [0.14, 3.86, 0.86], 0.4, 0.2, 1], [[-0.34, 3.3, 0.34], [-0.74, 3.76, 0.92], 0.34, 0.18, 2], [[0.46, 3.28, 0.36], [0.9, 3.7, 1.0], 0.32, 0.17, 3],
    [[-0.05, 3.1, 0.7], [-0.12, 3.64, 1.46], 0.3, 0.16, 4], [[0.32, 2.88, 0.76], [0.6, 3.16, 1.5], 0.26, 0.14, 5], [[-0.44, 2.86, 0.76], [-0.84, 3.04, 1.42], 0.24, 0.13, 6],
    [[-0.72, 3.22, 0.1], [-1.2, 3.68, 0.36], 0.26, 0.14, 7], [[0.1, 2.6, 0.82], [0.16, 2.72, 1.42], 0.2, 0.12, 8],
  ];
  for (const [a, c, w, th, seed] of spines) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    b.add('chest', seed % 3 === 0 ? IVORY_D : IVORY, shard(len, w, th, seed + 30, 5, 0.34), along(a, c, seed), { crease: 30, slide: [(c[0] - a[0]) * 0.12, (c[1] - a[1]) * 0.12, (c[2] - a[2]) * 0.12] });
  }
  // a drone's stabiliser vane and lens, taken into the back
  b.add('chest', P.refNavy, prism([[0, 0.1], [0.22, 0.14], [0.5, 0.02], [0.66, -0.24], [0.6, -0.34], [0.3, -0.2], [0, -0.14]], 0.035, 0.012), mulM(T(0.52, 3.0, 0.52, 0.3, -1.1, 0.9)), { slide: [0.05, 0.06, 0.05] });
  b.add('chest', P.refSlate, torus(0.085, 0.026, 12, 6), T(-0.52, 2.44, 0.6, Math.PI / 2 + 0.5, -0.5, 0.2), { crease: 180 });
  b.add('chest', P.glass, sphere(0.078, 1), T(-0.53, 2.43, 0.61, 0.5, -0.5, 0, [1, 1, 0.5]), { crease: 180 });
  helmet(b, 'chest', T(-0.62, 3.02, 0.5, -0.5, 2.5, 0.4), false);
  helmet(b, 'hips', T(-0.72, 1.86, 0.0, 0.3, 1.2, 0.5), true);

  // ------------------------------------------------------------------ RIGHT: regenerating joint under four petal plates
  b.add('shR', TISSUE, blob(0.3, 2, 0.25, 13), T(E.shR[0] - 0.08, E.shR[1] - 0.04, E.shR[2]), { crease: 180 });
  b.add('jointCore', tint(P.violetHot, { c: 0xb98cff, e: 1.9, seam: 0.45 }), blob(0.37, 2, 0.26, 17), T(E.shR[0] + 0.05, E.shR[1] + 0.06, E.shR[2]), { group: G.joint, crease: 180 });
  // sinew cage over the glowing tissue (dark strands crossing the light)
  for (let i = 0; i < 7; i++) {
    const a0 = (i / 7) * Math.PI * 2;
    const pts: Pt3[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, lat = -0.9 + t * 2.3, lon = a0 + t * 1.3;
      pts.push([E.shR[0] + 0.05 + Math.cos(lat) * Math.cos(lon) * 0.44, E.shR[1] + 0.06 + Math.sin(lat) * 0.43, E.shR[2] + Math.cos(lat) * Math.sin(lon) * 0.44]);
    }
    b.add('jointCore', SINEW, tube(pts, (t) => 0.03 + 0.02 * Math.sin(t * Math.PI), 5), undefined, { crease: 180 });
  }
  // fractured stump (scaled in when the joint is shattered): a cauterised socket of charred shards round embers
  const SC: Pt3 = [E.shR[0] + 0.1, E.shR[1] + 0.12, E.shR[2]];
  b.add('stump', tint(P.domGlow, { c: 0xff6a1a, e: 2.4, seam: 1 }), blob(0.2, 2, 0.45, 23, [1.2, 0.8, 1.1]), T(SC[0], SC[1], SC[2]), { group: G.stump, crease: 180 });
  for (let i = 0; i < 9; i++) {
    const a = i * 0.72 + 0.2, el = 0.25 + ((i * 7) % 5) * 0.2;
    const d: Pt3 = [Math.cos(a) * Math.cos(el) * 0.9 + 0.35, Math.sin(el) * 0.9 + 0.2, Math.sin(a) * Math.cos(el)];
    const len = 0.26 + ((i * 5) % 4) * 0.07;
    b.add('stump', i % 3 === 0 ? IVORY_D : tint(P.domBlack, { c: 0x0a0808, r: 0.85 }), shard(len, 0.16, 0.1, 140 + i, 4, 0.55), along([SC[0] + d[0] * 0.1, SC[1] + d[1] * 0.1, SC[2] + d[2] * 0.1], [SC[0] + d[0] * (0.1 + len), SC[1] + d[1] * (0.1 + len), SC[2] + d[2] * (0.1 + len)], i), { crease: 30 });
  }
  b.add('stump', tint(P.domBlack, { c: 0x0a0808, r: 0.9 }), torus(0.24, 0.07, 10, 5), T(SC[0] - 0.02, SC[1] - 0.04, SC[2], 0.2, 0, -0.9), { crease: 60 });
  const petals: [number, Pt3, Pt3, Pt2[], number][] = [
    [0, [E.shR[0] + 0.02, E.shR[1] + 0.5, E.shR[2]], [0.1, 1, 0], kite(0.82, 0.92, 0.3, 31), 0.1],
    [1, [E.shR[0] + 0.5, E.shR[1] + 0.1, E.shR[2]], [1, 0.25, 0], kite(0.78, 0.95, 0.26, 32), -0.12],
    [2, [E.shR[0] + 0.1, E.shR[1] + 0.12, E.shR[2] - 0.5], [0.25, 0.3, -1], slab(0.74, 0.86, 33, 2), 0.2],
    [3, [E.shR[0] + 0.1, E.shR[1] + 0.1, E.shR[2] + 0.5], [0.2, 0.3, 1], slab(0.72, 0.84, 34, 2), -0.15],
  ];
  for (const [i, pos, n, outline, roll] of petals) {
    addPlate(b, 'petal' + i, IVORY, outline, facing(pos, n, i === 0 ? [0, 0, -1] : [0, 1, 0], roll), { thick: 0.085, bevel: 0.026, rx: 0.62, ry: 0.9, trim: TRIM, lift: 0.04, shift: 0.02, rand: 0.2 + i * 0.2, detail: true, inlay: GOLD_DEAD });
  }

  // ------------------------------------------------------------------ RIGHT arm: the architectural club
  sinew(b, 'armR', add3(E.shR, 0.08, -0.2, 0), add3(E.elbowR, 0, 0.1, 0), 0.19, 6, 0.07, 1.2);
  b.add('armR', TISSUE, tube([add3(E.shR, 0.05, -0.15, 0), lerp3(E.shR, E.elbowR, 0.5), E.elbowR], [0.24, 0.2, 0.2], 8, false), undefined, { crease: 180 });
  const armRPlates: LimbPlate[] = [
    { t: 0.42, a: 1.45, paint: IVORY, outline: slab(0.44, 0.74, 41, 2), opts: { thick: 0.07, rx: 0.4, trim: TRIM } },
    { t: 0.5, a: -0.2, paint: IVORY_D, outline: kite(0.4, 0.66, 0.3, 42), opts: { thick: 0.06, rx: 0.4 } },
    { t: 0.55, a: 3.1, paint: P.domOxblood, outline: slab(0.36, 0.56, 43, 2), opts: { thick: 0.05, rx: 0.4 } },
  ];
  limbPlates(b, 'armR', E.shR, E.elbowR, 0.24, [0, 0, -1], armRPlates);
  b.add('armR', IVORY, shard(0.66, 0.22, 0.14, 44, 5, 0.4), along(add3(E.elbowR, 0.05, 0.08, 0.1), add3(E.elbowR, 0.3, 0.34, 0.62)), { crease: 30 });
  b.add('foreR', TISSUE_W, blob(0.23, 2, 0.32, 71, [1, 0.9, 1]), T(E.elbowR[0], E.elbowR[1], E.elbowR[2]), { crease: 180 });
  addPlate(b, 'foreR', IVORY_D, kite(0.46, 0.5, 0.3, 72), facing(add3(E.elbowR, 0.2, 0.04, 0.12), [1, 0.2, 0.5], [0, 1, 0], 0.2), { thick: 0.06, rx: 0.3, detail: true });
  // forearm = a length of white-gold pier, gold channels dead, strapped on with bronze bands and sinew
  const fa = add3(E.elbowR, -0.01, -0.1, -0.06), fc = add3(E.wristR, 0, 0.06, 0.02);
  const fLen = Math.hypot(fc[0] - fa[0], fc[1] - fa[1], fc[2] - fa[2]);
  const fM = along(fa, fc, 0.5);
  b.add('foreR', IVORY, batter(box(0.5, fLen, 0.44, 0.05, [1.18, 1.25]), 0.03, 3, 3), mulM(fM.clone(), T(0, fLen * 0.5, 0)), { crease: 50 });
  for (const sx of [-1, 1]) {
    b.add('foreR', TRIM, box(0.035, fLen * 0.8, 0.02, 0.006), mulM(fM.clone(), T(sx * 0.1, fLen * 0.52, 0.262)));
    b.add('foreR', IVORY_D, box(0.1, fLen * 0.7, 0.06, 0.02), mulM(fM.clone(), T(sx * 0.29, fLen * 0.55, 0.02)));
  }
  for (const k of [0.22, 0.74]) b.add('foreR', P.domBronze, box(0.62, 0.09, 0.56, 0.025), mulM(fM.clone(), T(0, fLen * k, 0, 0, 0, 0, [1 + k * 0.17, 1, 1 + k * 0.23])));
  sinew(b, 'foreR', add3(E.elbowR, 0, -0.05, 0.05), add3(E.wristR, 0, 0.1, 0.05), 0.31, 5, 0.045, 2.2);
  b.add('foreR', IVORY_D, shard(0.5, 0.2, 0.12, 46, 5, 0.42), along(add3(E.elbowR, 0, -0.2, 0.2), add3(E.elbowR, 0.1, -0.1, 0.72)), { crease: 30 });
  // hand: knuckle mass + three shard claws
  b.add('handR', TISSUE, blob(0.27, 1, 0.3, 19, [1.35, 0.8, 1]), T(E.wristR[0], E.wristR[1] - 0.06, E.wristR[2] - 0.04), { crease: 180 });
  b.add('handR', P.domBronze, box(0.62, 0.1, 0.3, 0.03), T(E.wristR[0], E.wristR[1] - 0.02, E.wristR[2] - 0.06, 0.45, 0, 0));
  for (let i = 0; i < 3; i++) {
    const base: Pt3 = [E.wristR[0] + (i - 1) * 0.2, E.wristR[1] - 0.12, E.wristR[2] - 0.12];
    const tip: Pt3 = [E.clawTipR[0] + (i - 1) * 0.3, E.clawTipR[1] + Math.abs(i - 1) * 0.08, E.clawTipR[2] + Math.abs(i - 1) * 0.1];
    const len = Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
    b.add('clawR' + i, i === 1 ? IVORY : IVORY_D, shard(len, 0.2, 0.15, 50 + i, 5, 0.5), along(base, tip, i), { crease: 30 });
  }

  // ------------------------------------------------------------------ LEFT: layered Dominion pauldron + thin grasping arm
  b.add('shL', TISSUE, blob(0.36, 2, 0.2, 21), T(E.shL[0], E.shL[1], E.shL[2]), { crease: 180 });
  for (let i = 0; i < 3; i++) {
    const w = 0.98 - i * 0.14, h = 0.52 - i * 0.03;
    const lame: Pt2[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w * 0.42, h / 2], [-w * 0.42, h / 2]];
    const m = facing([E.shL[0] - 0.2 - i * 0.14, E.shL[1] + 0.36 - i * 0.2, E.shL[2] + 0.02], [-0.55 - i * 0.2, 1 - i * 0.28, -0.08], [1, 0.4, 0], 0);
    addPlate(b, 'shL', i === 1 ? P.domOxblood : P.domBronze, lame, m, { thick: 0.06, bevel: 0.02, rx: 0.5, lift: 0.07, rand: 0.6 + i * 0.1 });
  }
  b.add('shL', P.domBronze, shard(0.46, 0.16, 0.1, 61, 4, 0.5), along([E.shL[0] - 0.1, E.shL[1] + 0.5, E.shL[2]], [E.shL[0] - 0.42, E.shL[1] + 0.92, E.shL[2] + 0.12]), { crease: 30 });
  b.add('shL', P.domGlow, box(0.3, 0.02, 0.03, 0.006), T(E.shL[0] - 0.47, E.shL[1] + 0.04, E.shL[2] - 0.34, 0, 0.3, -0.5), { group: G.nodes });
  sinew(b, 'armL', add3(E.shL, -0.04, -0.15, 0), add3(E.elbowL, 0, 0.08, 0), 0.13, 5, 0.055, 0.7);
  limbPlates(b, 'armL', E.shL, E.elbowL, 0.17, [0, 0, -1], [
    { t: 0.5, a: -1.5, paint: P.refNavy, outline: slab(0.34, 0.6, 62, 1), opts: { thick: 0.05, rx: 0.3 } },
    { t: 0.56, a: 0.3, paint: P.refSlate, outline: slab(0.3, 0.5, 63, 1), opts: { thick: 0.045, rx: 0.3 } },
  ]);
  for (const t of [0.34, 0.7]) b.add('armL', P.refSteel, torus(0.2, 0.025, 10, 5), mulM(along(lerp3(E.shL, E.elbowL, t), E.elbowL)), { crease: 180 });
  b.add('foreL', TISSUE_W, blob(0.16, 2, 0.32, 73, [1, 0.9, 1]), T(E.elbowL[0], E.elbowL[1], E.elbowL[2]), { crease: 180 });
  addPlate(b, 'foreL', P.domBronze, kite(0.32, 0.36, 0.3, 74), facing(add3(E.elbowL, -0.14, 0.03, 0.1), [-1, 0.2, 0.5], [0, 1, 0], -0.2), { thick: 0.05, rx: 0.22 });
  sinew(b, 'foreL', add3(E.elbowL, 0, -0.05, 0), add3(E.wristL, 0, 0.06, 0), 0.1, 5, 0.045, 1.9);
  b.add('foreL', IVORY, shard(1.2, 0.2, 0.09, 64, 4, 0.5), along(add3(E.wristL, -0.12, 0.0, 0.05), add3(E.elbowL, -0.16, 0.42, 0.26)), { crease: 30 });
  b.add('foreL', P.rubber, tube(arcPath(add3(E.elbowL, 0.05, 0.1, 0.12), add3(E.elbowL, 0.22, -0.5, 0.36), add3(E.wristL, 0.05, 0.08, 0.1), 8), 0.03, 5), undefined, { crease: 180 });
  b.add('handL', TISSUE, blob(0.15, 1, 0.3, 27, [1.2, 0.8, 1]), T(E.wristL[0], E.wristL[1] - 0.04, E.wristL[2] - 0.03), { crease: 180 });
  for (let i = 0; i < 3; i++) {
    const base: Pt3 = [E.wristL[0] + (i - 1) * 0.1, E.wristL[1] - 0.08, E.wristL[2] - 0.08];
    const tip: Pt3 = [E.fingerTipL[0] + (i - 1) * 0.2, E.fingerTipL[1] - (i === 1 ? 0.1 : 0), E.fingerTipL[2] + Math.abs(i - 1) * 0.06];
    b.add('clawL' + i, SINEW, tube([base, lerp3(base, tip, 0.5), lerp3(base, tip, 0.72)], [0.045, 0.035, 0.03], 5), undefined, { crease: 180 });
    b.add('clawL' + i, P.domBlack, shard(0.3, 0.07, 0.05, 70 + i, 4, 0.6), along(lerp3(base, tip, 0.62), tip, i), { crease: 30 });
  }

  // ------------------------------------------------------------------ legs
  for (const side of [1, -1]) {
    const R = side > 0;
    const hip = R ? E.hipR : E.hipL, knee = R ? E.kneeR : E.kneeL, ankle = R ? E.ankleR : E.ankleL;
    const [th, sh, ft] = R ? ['thighR', 'shinR', 'footR'] : ['thighL', 'shinL', 'footL'];
    b.add(th, TISSUE, tube([add3(hip, 0, 0.1, 0), lerp3(hip, knee, 0.45), knee], [0.44, 0.42, 0.3], 9, false), undefined, { crease: 180 });
    sinew(b, th, hip, knee, 0.38, 6, 0.07, side * 1.3);
    limbPlates(b, th, hip, knee, 0.42, [0, 0, -1], R
      ? [
          { t: 0.46, a: 0.1, paint: P.refNavy, outline: slab(0.46, 0.7, 81, 1), opts: { thick: 0.06, rx: 0.5 } },
          { t: 0.5, a: 1.6, paint: IVORY, outline: kite(0.44, 0.74, 0.3, 82), opts: { thick: 0.07, rx: 0.5, trim: TRIM } },
          { t: 0.48, a: 3.2, paint: IVORY_D, outline: slab(0.4, 0.6, 83, 2), opts: { thick: 0.05, rx: 0.5 } },
        ]
      : [
          { t: 0.4, a: -0.15, paint: P.domBronze, outline: kite(0.48, 0.6, 0.26, 84), flare: 0.12, opts: { thick: 0.055, rx: 0.5 } },
          { t: 0.62, a: -0.1, paint: P.domOxblood, outline: kite(0.42, 0.5, 0.26, 85), flare: 0.1, off: -0.03, opts: { thick: 0.05, rx: 0.5 } },
          { t: 0.5, a: -1.65, paint: IVORY_D, outline: slab(0.42, 0.7, 86, 2), opts: { thick: 0.06, rx: 0.5 } },
          { t: 0.48, a: 3.0, paint: P.domBlack, outline: slab(0.38, 0.56, 87, 2), opts: { thick: 0.05, rx: 0.5 } },
        ]);
    b.add(sh, TISSUE_W, blob(0.25, 2, 0.3, 75 + side, [1, 0.9, 1]), T(knee[0], knee[1], knee[2]), { crease: 180 });
    addPlate(b, sh, R ? IVORY : P.domBronze, kite(0.46, 0.5, 0.3, 76 + side), facing(add3(knee, 0, 0.0, -0.25), [side * 0.15, 0.3, -1], [0, 1, 0], side * 0.1), { thick: 0.065, rx: 0.3, detail: true });
    // calf mass + plated greave: the lower leg has to carry the silhouette on a dark floor
    b.add(sh, TISSUE, tube([knee, lerp3(knee, ankle, 0.4), ankle], [0.24, 0.25, 0.15], 8, false), undefined, { crease: 180 });
    limbPlates(b, sh, knee, ankle, 0.23, [0, 0.4, -1], [
      { t: 0.5, a: 0, paint: R ? IVORY : IVORY_D, outline: kite(0.4, 0.74, 0.28, 77 + side), opts: { thick: 0.06, rx: 0.3, trim: R ? TRIM : undefined, detail: true, inlay: R ? GOLD_DEAD : undefined } },
      { t: 0.46, a: side * 1.7, paint: R ? P.refNavy : P.domOxblood, outline: slab(0.3, 0.56, 78 + side, 2), opts: { thick: 0.05, rx: 0.3 } },
    ]);
    b.add(sh, R ? IVORY : P.domBronze, shard(0.5, 0.26, 0.16, 88 + side, 5, 0.45), along(add3(knee, 0, -0.12, -0.12), add3(knee, side * 0.05, 0.3, -0.42)), { crease: 30 });
    sinew(b, sh, knee, ankle, 0.2, 5, 0.05, side * 0.6);
    // shin: two long structural shards flanking the sinew, pointing down to the ankle
    b.add(sh, IVORY, shard(0.82, 0.24, 0.14, 90 + side, 5, 0.3), along(add3(knee, side * 0.14, 0.05, -0.06), add3(ankle, side * 0.12, 0.02, -0.02)), { crease: 30 });
    b.add(sh, IVORY_D, shard(0.74, 0.2, 0.12, 92 + side, 5, 0.3), along(add3(knee, -side * 0.12, 0.0, -0.02), add3(ankle, -side * 0.1, 0.06, 0.02)), { crease: 30 });
    b.add(ft, IVORY, shard(0.5, 0.16, 0.1, 94 + side, 4, 0.5), along(add3(ankle, 0, 0.1, 0.06), add3(ankle, side * 0.04, 0.46, 0.44)), { crease: 30 });
    // foot: heel block + three splayed toe wedges
    b.add(ft, TISSUE, blob(0.22, 1, 0.25, 33 + side, [1.2, 0.8, 1.3]), T(ankle[0], ankle[1] - 0.02, ankle[2] - 0.02), { crease: 180 });
    b.add(ft, IVORY_D, box(0.3, 0.2, 0.3, 0.05, [0.8, 0.8]), T(ankle[0], 0.1, ankle[2] + 0.12));
    for (let i = -1; i <= 1; i++) {
      const base: Pt3 = [ankle[0] + i * 0.12, 0.2, ankle[2] - 0.08];
      const tip: Pt3 = [ankle[0] + i * 0.3 + side * 0.03, 0.0, ankle[2] - 0.62 + Math.abs(i) * 0.1];
      const len = Math.hypot(tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]);
      b.add(ft, i === 0 ? IVORY : (R ? IVORY_D : P.domBronze), shard(len, 0.2, 0.16, 96 + i + side * 4, 5, 0.42), along(base, tip, i + 0.5), { crease: 30 });
    }
  }

  // ------------------------------------------------------------------ head: a heavy pale helm thrust out ahead of the shoulders —
  // a brow plane over ONE lit slit, two cheek plates closing to a prow, a crest of shards. The face of the thing.
  const H = E.head;
  const HS = new THREE.Matrix4().makeTranslation(H[0], H[1], H[2]).multiply(new THREE.Matrix4().makeScale(1.32, 1.32, 1.32)).multiply(new THREE.Matrix4().makeTranslation(-H[0], -H[1], -H[2]));
  const hm = (m: THREE.Matrix4): THREE.Matrix4 => HS.clone().multiply(m);
  b.add('head', TISSUE, blob(0.25, 1, 0.2, 37, [1, 1, 1.25]), hm(T(H[0], H[1], H[2] + 0.04)), { crease: 180 });
  addPlate(b, 'head', IVORY, kite(0.4, 0.66, 0.3, 101), hm(facing([H[0] + 0.2, H[1] - 0.14, H[2] - 0.2], [0.7, 0.1, -0.7], [0, 1, 0.3], 0.1)), { thick: 0.06, rx: 0.55, trim: TRIM, lift: 0.03, detail: true });
  addPlate(b, 'head', IVORY_D, kite(0.38, 0.62, 0.3, 102), hm(facing([H[0] - 0.21, H[1] - 0.17, H[2] - 0.17], [-0.74, 0.06, -0.68], [0, 1, 0.3], -0.2)), { thick: 0.06, rx: 0.55, lift: 0.03, detail: true });
  // brow plane: one wide slab overhanging the eye
  addPlate(b, 'head', IVORY, [[-0.36, -0.1], [0.36, -0.12], [0.4, 0.04], [0.22, 0.2], [-0.2, 0.22], [-0.4, 0.06]], hm(facing([H[0], H[1] + 0.2, H[2] - 0.27], [0.02, 0.6, -0.8], [0, 1, 0], 0.05)), { thick: 0.07, bevel: 0.024, rx: 0.5, trim: TRIM, lift: 0.03, detail: true, inlay: GOLD_DEAD });
  addPlate(b, 'head', IVORY, slab(0.56, 0.5, 103, 2), hm(facing([H[0] + 0.02, H[1] + 0.3, H[2] + 0.06], [0.05, 0.95, -0.25], [0, 0, 1], 0.1)), { thick: 0.06, rx: 0.45, lift: 0.03 });
  // the eye: a dark recess under the brow holding a single hot slit, wide enough to read at range
  b.add('head', tint(P.domBlack, { c: 0x060507, r: 0.9 }), box(0.56, 0.17, 0.2, 0.02), hm(T(H[0], H[1] + 0.04, H[2] - 0.2, 0.2, 0, 0.05)));
  b.add('head', tint(P.violetEye, { e: 2.5 }), box(0.42, 0.036, 0.05, 0.01), hm(T(H[0] - 0.01, H[1] + 0.045, H[2] - 0.3, 0.2, 0, 0.05)), { group: G.eye });
  b.add('head', tint(P.violetEye, { e: 1.6 }), box(0.03, 0.2, 0.04), hm(T(H[0] - 0.012, H[1] - 0.1, H[2] - 0.3, 0.3, 0, 0.07)), { group: G.eye });
  const crest: [Pt3, Pt3, number, number][] = [
    [[0.05, 3.38, -0.9], [0.14, 3.8, -0.26], 0.22, 1], [[-0.2, 3.36, -0.86], [-0.6, 3.72, -0.28], 0.18, 2], [[0.28, 3.34, -0.86], [0.7, 3.64, -0.34], 0.16, 3],
    [[-0.4, 3.16, -0.9], [-0.92, 3.34, -0.56], 0.13, 4], [[0.42, 3.12, -0.92], [0.86, 3.2, -0.62], 0.11, 5],
  ];
  for (const [a, c, w, seed] of crest) b.add('head', seed === 2 ? IVORY_D : IVORY, shard(Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), w, w * 0.6, seed + 110, 4, 0.5), along(a, c, seed), { crease: 30 });
  b.add('jaw', P.domBlack, prism([[-0.2, 0.05], [0.2, 0.05], [0.15, -0.12], [0, -0.22], [-0.15, -0.12]], 0.36, 0.035), hm(T(0, H[1] - 0.22, H[2] - 0.16, 0.5, 0, 0)));
  for (let i = -1; i <= 1; i++) b.add('jaw', P.bone, shard(0.18, 0.07, 0.06, 120 + i, 4, 0.6), hm(along([i * 0.11, H[1] - 0.2, H[2] - 0.3], [i * 0.12, H[1] - 0.04, H[2] - 0.36])), { crease: 30 });

  // ------------------------------------------------------------------ trailing tendrils (the violet wreath)
  tendrils.forEach((chain, i) => {
    const tr = TENDRIL_ROOTS[i]!;
    const last = b.at(chain[chain.length - 1]!);
    const d = new THREE.Vector3(tr.dir[0], tr.dir[1], tr.dir[2]).normalize();
    const seg = tr.len / TENDRIL_BONES;
    const tip: Pt3 = [last[0] + d.x * seg, last[1] + d.y * seg, last[2] + d.z * seg];
    // thick at the root, whip-thin at the end; the last run carries light, so the wreath reads violet as a whole
    b.tubeOn(chain, tip, i % 2 ? SINEW : TISSUE_W, (t) => 0.115 * (1 - t) ** 0.75 + 0.016, 7, {}, 1, 3);
    const p2 = b.at(chain[2]!), p3 = b.at(chain[3]!);
    b.addSkinned([chain[2]!, chain[3]!], tint(P.violet, { e: 0.55, r: 0.5 }), tube([lerp3(p2, p3, 0.35), lerp3(p2, p3, 0.7), p3, lerp3(p3, tip, 0.5), tip], [0.048, 0.042, 0.036, 0.026, 0.012].map((r) => r + 0.004), 5), undefined, { group: G.nodes }, [0, 0.5], 0.3);
    b.add(chain[1]!, P.violet, sphere(0.04, 1), T(...lerp3(b.at(chain[1]!), p2, 0.5)), { group: G.nodes, crease: 180 });
  });
  // heavy cable loops from the back down to the arms
  b.add('chest', P.rubber, tube(arcPath([0.5, 3.1, 0.4], [1.2, 3.3, 0.6], [1.16, 2.6, 0.24], 9), 0.05, 6), undefined, { crease: 180 });
  b.add('chest', P.rubber, tube(arcPath([-0.4, 3.0, 0.5], [-1.05, 3.1, 0.7], [-1.0, 2.5, 0.2], 9), 0.04, 6), undefined, { crease: 180 });

  // ------------------------------------------------------------------ sockets
  b.socket('core', 'chest', [E.core[0], E.core[1], E.core[2] - 0.22]);
  b.socket('joint', 'shR', [E.shR[0] + 0.14, E.shR[1] + 0.12, E.shR[2] - 0.05]);
  b.socket('head', 'head', [0, 3.1, -1.05]);
  b.socket('eye', 'head', [0, 3.12, -1.42]);
  b.socket('chest', 'chest', [0, 2.6, -0.4]);
  b.socket('hips', 'hips', E.hips);
  b.socket('handR', 'handR', [E.wristR[0], E.wristR[1] - 0.2, E.wristR[2] - 0.1]);
  b.socket('handL', 'handL', [E.wristL[0], E.wristL[1] - 0.2, E.wristL[2] - 0.1]);
  b.socket('weaponTip', 'handR', E.clawTipR);
  b.socket('weaponBase', 'foreR', E.elbowR);
  b.socket('weaponMid', 'foreR', lerp3(E.elbowR, E.wristR, 0.6));
  b.socket('back', 'chest', [0, 3.1, 0.7]);
  b.socket('top', 'chest', [0, 3.82, 0.1]);
  return b.build();
}
