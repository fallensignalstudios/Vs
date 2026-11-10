/**
 * crownmarkArm — one enormous arm of a city-scale Crownmark: a tapering blade of polished black stone several
 * kilometres long with a raised white-gold spine, narrow angular gold channels inlaid in its flanks, buttressed
 * edge walls dropping into the abyss, a processional rank of gate pylons down the spine, terraced districts
 * with plazas between them, and ranks of spires that shrink toward the tip. The roots of the two neighbouring
 * arms leave to either side so it reads as part of a five-pointed structure, not a floor tile.
 * Two draw calls (structure + lights), ≈ 60k triangles.
 *
 * The arm lies under the Wound in the `woundVista` sky, so it obeys the Wound-clear rule (see woundClear.ts):
 * nothing on it shines inside the disc; its far spires are dark silhouettes sunk in the horizon haze.
 *
 * Local frame: origin = overlook floor above the arm's root; the arm runs toward −Z, `drop` metres below.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING, addSpire, type SpireStyle } from './arch';
import { GeoBuilder, type P3 } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';
import { bag, num, seedOf } from './opts';
import { insideWound, woundCone, woundLimit } from './woundClear';

export interface CrownmarkArmOpts { length?: number; width?: number; drop?: number; seed?: number; clearWound?: boolean }

const ROOT_Z = 140;

/** One blade: deck flanks, spine, edge walls, buttresses. Built along −Z from z = ROOT_Z in the current frame. */
function blade(b: GeoBuilder, L: number, W: number, yd: number, full: boolean): void {
  const segs = full ? 40 : 8;
  const hwAt = (t: number): number => (W / 2) * (1 - t) + 4;
  const spineAt = (t: number): number => Math.max((W * 0.04) * (1 - t * 0.85), 4);
  const ridge = (t: number): number => yd + 5 + 22 * (1 - t);
  b.light(1, 0);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const z0 = ROOT_Z - t0 * L, z1 = ROOT_Z - t1 * L;
    const h0 = hwAt(t0), h1 = hwAt(t1), s0 = spineAt(t0), s1 = spineAt(t1);
    const e0 = yd - 14 * (1 - t0), e1 = yd - 14 * (1 - t1); // flanks fall gently toward the edges
    for (const s of [-1, 1]) {
      const q: [P3, P3, P3, P3] = [[s * s0, yd, z0], [s * h0, e0, z0], [s * h1, e1, z1], [s * s1, yd, z1]];
      b.dress(0, 1).paint(KING.black, 0, 1).quad(...(s > 0 ? q : ([q[3], q[2], q[1], q[0]] as [P3, P3, P3, P3])));
      // edge wall down into the abyss, leaning outward; its upper band carries lit openings
      const m0 = yd - 90, m1 = yd - 90;
      const w1: [P3, P3, P3, P3] = [[s * h0, e0, z0], [s * (h0 + 8), m0, z0], [s * (h1 + 8), m1, z1], [s * h1, e1, z1]];
      b.dress(full ? 0.5 : 0, 1).paint(KING.blackDeep, 0, 1.15).quad(...(s > 0 ? w1 : ([w1[3], w1[2], w1[1], w1[0]] as [P3, P3, P3, P3])));
      const w2: [P3, P3, P3, P3] = [[s * (h0 + 8), m0, z0], [s * (h0 + 60), yd - 700, z0], [s * (h1 + 60), yd - 700, z1], [s * (h1 + 8), m1, z1]];
      b.dress(0, 1).paint(KING.blackDeep, 0, 1.0).quad(...(s > 0 ? w2 : ([w2[3], w2[2], w2[1], w2[0]] as [P3, P3, P3, P3])));
      // spine flank
      const f: [P3, P3, P3, P3] = [[s * s0 * 0.45, ridge(t0), z0], [s * s0, yd, z0], [s * s1, yd, z1], [s * s1 * 0.45, ridge(t1), z1]];
      b.dress(0, 0).paint(KING.black, 0, 1.3).quad(...(s > 0 ? f : ([f[3], f[2], f[1], f[0]] as [P3, P3, P3, P3])));
    }
    // spine crest carrying the main light channel between two white-gold shoulders
    const c0 = s0 * 0.45, c1 = s1 * 0.45, g0 = c0 * 0.14, g1 = c1 * 0.14;
    for (const s of [-1, 1]) {
      const q: [P3, P3, P3, P3] = [[s * g0, ridge(t0), z0], [s * c0, ridge(t0), z0], [s * c1, ridge(t1), z1], [s * g1, ridge(t1), z1]];
      b.dress(0, 0).paint(KING.whiteGold, 0, 0.42).quad(...(s > 0 ? q : ([q[3], q[2], q[1], q[0]] as [P3, P3, P3, P3])));
    }
    b.paint(KING.channel, 1.5).quad([-g0, ridge(t0) - 1.2, z0], [g0, ridge(t0) - 1.2, z0], [g1, ridge(t1) - 1.2, z1], [-g1, ridge(t1) - 1.2, z1]);
  }
  b.dress(0, 1);
  // root cap
  b.paint(KING.blackDeep, 0, 1).quad([-hwAt(0), yd - 14, ROOT_Z], [-hwAt(0) - 60, yd - 700, ROOT_Z], [hwAt(0) + 60, yd - 700, ROOT_Z], [hwAt(0), yd - 14, ROOT_Z]);
  if (!full) return;
  // buttresses along both edge walls
  const n = Math.min(60, Math.floor(L / 150));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (t > 0.94) break;
    const z = ROOT_Z - t * L, hw = hwAt(t), e = yd - 14 * (1 - t);
    const k = 1 - t * 0.6;
    for (const s of [-1, 1]) {
      b.paint(KING.whiteGold, 0, 0.42).box(s * (hw + 9 * k), e - 150 * k, z, 18 * k, 300 * k, 26 * k, { top: [0.5, 0.8], shift: [-s * 12 * k, 0] });
      b.paint(KING.gold, 0, 0.6).bevelBox(s * (hw - 2), e + 2.5 * k, z, 9 * k, 5 * k, 30 * k, 0.8 * k);
    }
  }
}

export function buildCrownmarkArm(shared: SharedUniforms, opts?: CrownmarkArmOpts | null): THREE.Object3D {
  const o = bag(opts);
  const L = num(o.length, 3600, 600, 9000);
  const W = num(o.width, 520, 80, 1600);
  const drop = num(o.drop, 150, 20, 900);
  const yd = -drop;
  const rand = mulberry32(seedOf(o.seed) ^ 0xc5a3);
  const cone = o.clearWound === false ? null : woundCone();
  const b = new GeoBuilder();
  const cards = new LightCards();
  if (cone) cards.veto = (x, y, z) => insideWound(cone, x, y, z);

  blade(b, L, W, yd, true);
  // neighbouring arms: same blade rotated ±72° about the star centre, which lies behind the viewer
  const centreZ = ROOT_Z + W * 0.69;
  for (const s of [-1, 1]) {
    b.push().translate(0, 0, centreZ).rotateY((s * 72 * Math.PI) / 180).translate(0, 0, -centreZ);
    blade(b, L * 0.8, W, yd, false);
    b.pop();
  }
  // the hub between the arms: a stepped white-gold core
  b.light(1, 0).dress(0, 1).paint(KING.black, 0, 1).prism(0, yd - 700, centreZ, yd - 6, W * 0.9, W * 0.74, 10);
  b.dress(0.7, 1).paint(KING.whiteGold, 0, 0.5).prism(0, yd - 6, centreZ, yd + 24, W * 0.36, W * 0.3, 10);
  b.dress(0, 1);

  const hw = (t: number): number => (W / 2) * (1 - t) + 4;
  const edgeY = (t: number): number => yd - 14 * (1 - t);
  const styles: SpireStyle[] = ['needle', 'blade', 'needle', 'cluster'];

  // ---- spires along both edges, shrinking toward the tip
  for (let t = 0.07; t < 0.9; t += 0.058 + rand() * 0.02) {
    const z = ROOT_Z - t * L;
    const k = 1 - t * 0.72;
    for (const s of [-1, 1]) {
      const x = s * (hw(t) - 20 * k), zz = z + (rand() - 0.5) * 60;
      const lim = woundLimit(cone, x, zz, edgeY(t) + (150 + rand() * 170) * k);
      const h = lim.top - edgeY(t);
      if (h < 20) continue;
      addSpire(b, cards, {
        x, y: edgeY(t), z: zz, h, r: Math.min(Math.max(h * 0.06, 5), h * 0.1), tone: lim.lit ? (rand() < 0.6 ? 'white' : 'mixed') : 'black', rand,
        detail: t < 0.14 ? 2 : t < 0.5 ? 1 : 0, style: styles[Math.floor(rand() * styles.length)], lit: lim.lit,
      });
    }
  }

  // ---- gate pylons down the spine: paired obelisks either side of the light channel, a processional rhythm
  //      that carries the eye to the tip
  const gates = Math.min(40, Math.floor((L * 0.86) / 170));
  for (let i = 1; i <= gates; i++) {
    const t = (i * 170) / L, z = ROOT_Z - i * 170, k = 1 - t * 0.6;
    const sp = Math.max(W * 0.04 * (1 - t * 0.85), 4) * 0.45 + 5 * k;
    const y = yd + 5 + 22 * (1 - t);
    for (const s of [-1, 1]) {
      const lim = woundLimit(cone, s * sp, z, y + 64 * k);
      const h = Math.max(lim.top - y, 6);
      b.light(1, 0).dress(lim.lit ? 0.3 : 0, 1).paint(KING.black, 0, 1.1).prism(s * sp, y - 6, z, y + h * 0.82, 4.6 * k, 2.6 * k, 4);
      b.dress(0, 1).paint(KING.gold, 0, 0.7).prism(s * sp, y + h * 0.82, z, y + h * 0.84, 3.1 * k, 3.0 * k, 4);
      b.paint(KING.black, 0, 1.0).prism(s * sp, y + h * 0.84, z, y + h, 2.4 * k, 0, 4);
      b.paint(KING.whiteGold, 0, 0.45).bevelBox(s * sp, y - 1.5, z, 12 * k, 3, 12 * k, 0.6 * k);
      cards.point(s * sp, y + 4, z + 6 * k, 1.8, KING.light, 3.4);
    }
  }

  // ---- terraced districts along both flanks, with plazas (and the inlaid channels) left open between them
  for (let d = 90; d < L * 0.84; d += 150 + rand() * 120) {
    const t = d / L, k = 1 - t * 0.5;
    for (const s of [-1, 1]) {
      if (rand() < 0.22) continue;
      const u = 0.80 - rand() * 0.1; // hugging the rim, outside the outer channel line
      const cx = s * hw(t) * u, cz = ROOT_Z - d + (rand() - 0.5) * 30;
      const y = yd - 14 * (1 - t) * u;
      const len = (70 + rand() * 70) * k, wid = Math.min((26 + rand() * 18) * k, hw(t) * 0.24);
      const lim = woundLimit(cone, cx, cz, y + (26 + rand() * 46) * k);
      const hTop = Math.max(lim.top - y, 6);
      const steps = 3 + Math.floor(rand() * 2);
      let yy = y, ww = wid, ll = len;
      for (let i = 0; i < steps; i++) {
        const h = (hTop / steps) * (1.25 - 0.25 * i);
        const pale = i === steps - 1 && rand() < 0.5;
        b.light(1, 0).dress(lim.lit ? 0.75 : 0, 1).paint(pale ? KING.whiteGold : KING.black, 0, pale ? 0.42 : 1.35).bevelBox(cx, yy + h / 2, cz, ww, h, ll, Math.min(1.2 * k, h * 0.2));
        b.dress(0, 0).paint(KING.gold, 0, 0.55).box(cx, yy + h + 0.25 * k, cz, ww * 0.94, 0.5 * k, ll * 0.97);
        yy += h + 0.5 * k;
        ww *= 0.72; ll *= 0.78 - rand() * 0.1;
      }
      // a slim tower on the top terrace, and a few lit thresholds at plaza level
      b.dress(lim.lit ? 0.3 : 0, 1).paint(KING.black, 0, 1.2).prism(cx, yy, cz, yy + hTop * 0.7, ww * 0.26, 0, 4);
      for (let i = 0; i < 4; i++) cards.point(cx - s * (wid / 2 + 0.6), y + 3 * k, cz + (rand() - 0.5) * len, 1.5, KING.light, 2.6 + rand() * 2.2);
    }
  }

  // ---- rim and spine light points; the tip is a white point — a destination, not just a vanishing line
  const step = 46;
  for (let d = 0; d < L * 0.97; d += step) {
    const t = d / L, z = ROOT_Z - d;
    for (const s of [-1, 1]) cards.point(s * hw(t), edgeY(t) + 3, z, 1.9, KING.light, 3.2 + rand() * 2);
    if (d % (step * 4) === 0) cards.point(0, yd + 8 + 30 * (1 - t), z, 2.4, KING.white, 4);
  }
  cards.point(0, yd + 40, ROOT_Z - L, 12, KING.white, 9);

  const group = new THREE.Group();
  group.name = 'scenic:crownmarkArm';
  const mesh = new THREE.Mesh(b.build(), createScenicMaterial(shared, {
    name: 'ScenicCrownmarkArm', panel: [42, 21], gloss: 0.8, lowHaze: 1, lowStart: yd - 30, lowDepth: 520, arm: [W / 2, L, ROOT_Z], windows: [5, 11, 0.6], nearFill: [0.17, 0.16, 0.15, 1300], weather: 1, ambientTint: [0.18, 0.15, 0.105],
  }));
  mesh.name = 'scenic:crownmarkArm:structure';
  mesh.frustumCulled = false;
  const lights = cards.build(shared, { name: 'scenic:crownmarkArm:lights' });
  lights.frustumCulled = false;
  group.add(mesh, lights);
  group.userData.scenic = { kind: 'crownmarkArm', triangles: b.triangleCount, lights: cards.count };
  return group;
}
