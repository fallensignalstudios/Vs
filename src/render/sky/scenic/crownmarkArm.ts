/**
 * crownmarkArm — one enormous arm of a city-scale Crownmark: a tapering blade of polished black stone several
 * kilometres long with a raised white-gold spine, narrow angular gold channels inlaid in its flanks, buttressed
 * edge walls dropping into the abyss, and ranks of spires that shrink toward the tip. The roots of the two
 * neighbouring arms leave to either side so it reads as part of a five-pointed structure, not a floor tile.
 * Two draw calls (structure + lights).
 *
 * Local frame: origin = overlook floor above the arm's root; the arm runs toward −Z, `drop` metres below.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING, addSpire } from './arch';
import { GeoBuilder, type P3 } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';

export interface CrownmarkArmOpts { length?: number; width?: number; drop?: number; seed?: number }

const ROOT_Z = 140;

/** One blade: deck flanks, spine, edge walls, buttresses. Built along −Z from z = ROOT_Z in the current frame. */
function blade(b: GeoBuilder, L: number, W: number, yd: number, full: boolean): void {
  const segs = full ? 26 : 8;
  const hwAt = (t: number): number => (W / 2) * (1 - t) + 4;
  const spineAt = (t: number): number => Math.max((W * 0.04) * (1 - t * 0.85), 4);
  const ridge = (t: number): number => yd + 5 + 22 * (1 - t);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const z0 = ROOT_Z - t0 * L, z1 = ROOT_Z - t1 * L;
    const h0 = hwAt(t0), h1 = hwAt(t1), s0 = spineAt(t0), s1 = spineAt(t1);
    const e0 = yd - 14 * (1 - t0), e1 = yd - 14 * (1 - t1); // flanks fall gently toward the edges
    for (const s of [-1, 1]) {
      const q: [P3, P3, P3, P3] = [[s * s0, yd, z0], [s * h0, e0, z0], [s * h1, e1, z1], [s * s1, yd, z1]];
      b.paint(KING.black, 0, 1).quad(...(s > 0 ? q : ([q[3], q[2], q[1], q[0]] as [P3, P3, P3, P3])));
      // edge wall down into the abyss, leaning outward
      const w: [P3, P3, P3, P3] = [[s * h0, e0, z0], [s * (h0 + 60), yd - 700, z0], [s * (h1 + 60), yd - 700, z1], [s * h1, e1, z1]];
      b.paint(KING.blackDeep, 0, 1.1).quad(...(s > 0 ? w : ([w[3], w[2], w[1], w[0]] as [P3, P3, P3, P3])));
      // spine flank
      const f: [P3, P3, P3, P3] = [[s * s0 * 0.45, ridge(t0), z0], [s * s0, yd, z0], [s * s1, yd, z1], [s * s1 * 0.45, ridge(t1), z1]];
      b.paint(KING.black, 0, 1.3).quad(...(s > 0 ? f : ([f[3], f[2], f[1], f[0]] as [P3, P3, P3, P3])));
    }
    // spine crest carrying the main light channel between two white-gold shoulders
    const c0 = s0 * 0.45, c1 = s1 * 0.45, g0 = c0 * 0.14, g1 = c1 * 0.14;
    for (const s of [-1, 1]) {
      const q: [P3, P3, P3, P3] = [[s * g0, ridge(t0), z0], [s * c0, ridge(t0), z0], [s * c1, ridge(t1), z1], [s * g1, ridge(t1), z1]];
      b.paint(KING.whiteGold, 0, 0.42).quad(...(s > 0 ? q : ([q[3], q[2], q[1], q[0]] as [P3, P3, P3, P3])));
    }
    b.paint(KING.channel, 1.5).quad([-g0, ridge(t0) - 1.2, z0], [g0, ridge(t0) - 1.2, z0], [g1, ridge(t1) - 1.2, z1], [-g1, ridge(t1) - 1.2, z1]);
  }
  // root cap
  b.paint(KING.blackDeep, 0, 1).quad([-hwAt(0), yd - 14, ROOT_Z], [-hwAt(0) - 60, yd - 700, ROOT_Z], [hwAt(0) + 60, yd - 700, ROOT_Z], [hwAt(0), yd - 14, ROOT_Z]);
  if (!full) return;
  // buttresses along both edge walls
  const n = Math.floor(L / 150);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (t > 0.94) break;
    const z = ROOT_Z - t * L, hw = hwAt(t), e = yd - 14 * (1 - t);
    const k = 1 - t * 0.6;
    for (const s of [-1, 1]) {
      b.paint(KING.whiteGold, 0, 0.42).box(s * (hw + 9 * k), e - 150 * k, z, 18 * k, 300 * k, 26 * k, { top: [0.5, 0.8], shift: [-s * 12 * k, 0] });
      b.paint(KING.gold, 0, 0.6).box(s * (hw - 2), e + 2.5 * k, z, 9 * k, 5 * k, 30 * k);
    }
  }
}

export function buildCrownmarkArm(shared: SharedUniforms, opts: CrownmarkArmOpts = {}): THREE.Object3D {
  const L = Math.max(600, opts.length ?? 3600);
  const W = Math.max(80, opts.width ?? 520);
  const drop = opts.drop ?? 150;
  const yd = -drop;
  const rand = mulberry32((opts.seed ?? 7283) ^ 0xc5a3);
  const b = new GeoBuilder();
  const cards = new LightCards();

  blade(b, L, W, yd, true);
  // neighbouring arms: same blade rotated ±72° about the star centre, which lies behind the viewer
  const centreZ = ROOT_Z + W * 0.69;
  for (const s of [-1, 1]) {
    b.push().translate(0, 0, centreZ).rotateY((s * 72 * Math.PI) / 180).translate(0, 0, -centreZ);
    blade(b, L * 0.8, W, yd, false);
    b.pop();
  }
  // the hub between the arms: a stepped white-gold core
  b.paint(KING.black, 0, 1).prism(0, yd - 700, centreZ, yd - 6, W * 0.9, W * 0.74, 10);
  b.paint(KING.whiteGold, 0, 0.5).prism(0, yd - 6, centreZ, yd + 24, W * 0.36, W * 0.3, 10);

  // spires along both edges, shrinking toward the tip; light points along the rims and the spine
  const hw = (t: number): number => (W / 2) * (1 - t) + 4;
  for (let t = 0.07; t < 0.9; t += 0.058 + rand() * 0.02) {
    const z = ROOT_Z - t * L;
    const k = 1 - t * 0.72;
    for (const s of [-1, 1]) {
      const h = (150 + rand() * 170) * k;
      addSpire(b, cards, { x: s * (hw(t) - 20 * k), y: yd - 14 * (1 - t), z: z + (rand() - 0.5) * 60, h, r: Math.max(h * 0.06, 5), tone: rand() < 0.6 ? 'white' : 'mixed', rand, hero: t < 0.2 });
    }
  }
  // city fabric: terraces of low blocks along both rims and either side of the spine, with lit openings —
  // the small repeated things that make the blade read as kilometres rather than a runway
  for (let d = 30; d < L * 0.86; d += 24 + rand() * 30) {
    const t = d / L, z = ROOT_Z - d, k = 1 - t * 0.5;
    for (const s of [-1, 1]) {
      if (rand() < 0.3) continue;
      const u = rand() < 0.7 ? 0.76 + rand() * 0.18 : 0.1 + rand() * 0.14;
      const x = s * hw(t) * u;
      const y = yd - 14 * (1 - t) * u;
      const w = (14 + rand() * 30) * k, dp = (16 + rand() * 40) * k, h = (8 + rand() * rand() * 46) * k;
      const pale = rand() < 0.2;
      b.paint(pale ? KING.whiteGold : KING.black, 0, pale ? 0.3 : 1.4).box(x, y + h / 2, z, w, h, dp, { top: [0.82, 0.86] });
      if (rand() < 0.18) b.paint(KING.gold, 0, 0.5).box(x, y + h + 0.4 * k, z, w * 0.5, 0.8 * k, dp * 0.5);
      else if (h > 24 * k) b.paint(KING.black, 0, 1.2).box(x, y + h + h * 0.18, z, w * 0.5, h * 0.36, dp * 0.5, { top: [0.7, 0.7] });
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) cards.point(x - s * (w / 2 + 0.5), y + h * (0.2 + rand() * 0.6), z + (rand() - 0.5) * dp, 1.3, KING.light, 2.4 + rand() * 2.4);
    }
  }
  const step = 46;
  for (let d = 0; d < L * 0.97; d += step) {
    const t = d / L, z = ROOT_Z - d;
    for (const s of [-1, 1]) cards.point(s * hw(t), yd - 14 * (1 - t) + 3, z, 1.9, KING.light, 3.2 + rand() * 2);
    if (d % (step * 4) === 0) cards.point(0, yd + 8 + 30 * (1 - t), z, 2.4, KING.white, 4);
  }
  // the tip: a white point — the far end of the arm is a destination, not just a vanishing line
  cards.point(0, yd + 40, ROOT_Z - L, 12, KING.white, 9);

  const group = new THREE.Group();
  group.name = 'scenic:crownmarkArm';
  const mesh = new THREE.Mesh(b.build(), createScenicMaterial(shared, {
    name: 'ScenicCrownmarkArm', panel: [42, 21], gloss: 0.8, lowHaze: 1, lowStart: yd - 30, lowDepth: 520, arm: [W / 2, L, ROOT_Z],
  }));
  mesh.name = 'scenic:crownmarkArm:structure';
  mesh.frustumCulled = false;
  const lights = cards.build(shared, { name: 'scenic:crownmarkArm:lights' });
  lights.frustumCulled = false;
  group.add(mesh, lights);
  group.userData.scenic = { kind: 'crownmarkArm', triangles: b.triangleCount, lights: cards.count };
  return group;
}
