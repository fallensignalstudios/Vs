/**
 * terminalVista — the city-scale converging terminal of the Wound-overlook concept: radial causeways meeting at
 * a distant hub, ring roads, ranks of needle spires thinning into haze, hero towers flanking the viewer and
 * thousands of tiny warm lights across a dark abyss. Two draw calls (structure + lights).
 *
 * Local frame: origin = overlook floor, deck `drop` metres below, hub toward −Z.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING, addCauseway, addSpire, type SpireTone } from './arch';
import { GeoBuilder } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';

export interface TerminalVistaOpts { radius?: number; seed?: number; density?: number; drop?: number; corridor?: number }

export function buildTerminalVista(shared: SharedUniforms, opts: TerminalVistaOpts = {}): THREE.Object3D {
  const R = Math.max(600, opts.radius ?? 3000);
  const drop = opts.drop ?? 220;
  const density = Math.min(2, Math.max(0.25, opts.density ?? 1));
  const corridor = Math.max(0, opts.corridor ?? 0);
  const rand = mulberry32((opts.seed ?? 7283) ^ 0x7e21);
  const b = new GeoBuilder();
  const cards = new LightCards();
  const yd = -drop;
  const hubZ = -0.7 * R;
  const inCorridor = (x: number, z: number): boolean => corridor > 0 && Math.abs(x) < corridor / 2 + 30 && z > hubZ * 1.25;

  // ---- abyss floor (only ever seen through haze) and a far rim wall closing the horizon
  b.paint(KING.blackDeep, 0, 0.8).ring(0, hubZ * 0.5, 0, R * 1.5, yd - 640, yd - 600, 0, Math.PI * 2, 28);
  b.paint(KING.black, 0, 0.9).ring(0, hubZ * 0.5, R * 1.32, R * 1.36, yd - 600, yd + 70, 0, Math.PI * 2, 40);

  // ---- radial causeways from the hub. angle 0 points back at the viewer (+Z), measured clockwise from above.
  const arms: Array<{ a: number; len: number; w: number }> = [];
  const armAngles = [0, 26, -26, 55, -55, 92, -92, 138, -138, 180];
  for (const deg of armAngles) {
    if (deg === 0 && corridor > 0) continue;
    const a = (deg * Math.PI) / 180;
    const toward = Math.cos(a); // 1 = toward the viewer
    const len = deg === 0 ? -hubZ - 150 : R * (toward > 0.3 ? 0.78 : 0.62) * (0.9 + rand() * 0.2);
    arms.push({ a, len, w: Math.abs(deg) <= 26 ? 54 : 40 });
  }
  const armPoint = (a: number, d: number): [number, number] => [Math.sin(a) * d, hubZ + Math.cos(a) * d];
  for (const arm of arms) {
    const [x1, z1] = armPoint(arm.a, arm.len);
    const [x0, z0] = armPoint(arm.a, R * 0.05);
    addCauseway(b, cards, x0, z0, x1, z1, yd, arm.w, { rand, lightEvery: 46 / density, pylonEvery: 190 });
  }

  // ---- ring roads: chords between neighbouring arms, with junction spires
  const sorted = [...arms].sort((p, q) => p.a - q.a);
  const junctions: Array<[number, number, number]> = [];
  for (const [fr, w] of [[0.2, 34], [0.4, 30], [0.62, 26]] as const) {
    const d = R * fr;
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i], q = sorted[(i + 1) % sorted.length];
      if (p.len >= d) junctions.push([...armPoint(p.a, d), fr]);
      if (p.len < d || q.len < d) continue;
      let da = q.a - p.a;
      if (da <= 0) da += Math.PI * 2;
      if (da > 1.5) continue; // leave the widest gaps open
      const [ax, az] = armPoint(p.a, d), [bx, bz] = armPoint(q.a, d);
      if (inCorridor((ax + bx) / 2, (az + bz) / 2)) continue;
      addCauseway(b, cards, ax, az, bx, bz, yd - 6, w, { rand, lightEvery: 60 / density, pylonEvery: 220, channel: 1.2 });
    }
  }

  const tones: SpireTone[] = ['black', 'mixed', 'mixed', 'white'];
  // a pier rising out of the abyss: stepped octagonal lifts that widen with depth, rim lights at deck level
  const pier = (x: number, z: number, r: number, depth: number): void => {
    b.paint(KING.black, 0, 1).prism(x, yd - 14, z, yd, r * 3.0, r * 2.7, 8);
    b.paint(KING.blackDeep, 0, 1.2).prism(x, yd - 90, z, yd - 14, r * 2.3, r * 2.5, 8, { caps: false });
    b.paint(KING.black, 0, 0.8).prism(x, yd - depth, z, yd - 90, r * 3.4, r * 2.1, 8, { caps: false });
    const n = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand();
      cards.point(x + Math.cos(a) * r * 2.8, yd + 2, z + Math.sin(a) * r * 2.8, 1.7, KING.light, 2.6 + rand() * 2);
    }
  };
  const spire = (x: number, z: number, h: number, r: number, tone: SpireTone, hero = false): void => {
    if (inCorridor(x, z) || Math.hypot(x, z) < 620) return; // the near field belongs to the authored hero towers
    pier(x, z, r, 640);
    addSpire(b, cards, { x, y: yd, z, h, r, tone, rand, hero });
  };

  // ---- the hub citadel: a crown of very tall spires around a white point (the destination marker)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    spire(Math.sin(a) * R * 0.045, hubZ + Math.cos(a) * R * 0.045, R * (0.17 + rand() * 0.06), R * 0.012, i % 2 ? 'white' : 'mixed');
  }
  spire(0, hubZ, R * 0.3, R * 0.02, 'white');
  cards.point(0, yd + R * 0.3 + 6, hubZ, 9, KING.white, 9);
  b.paint(KING.whiteGold, 0, 0.5).ring(0, hubZ, R * 0.06, R * 0.068, yd - 20, yd + 26, 0, Math.PI * 2, 24);

  // ---- junction spires and ranks along every arm
  for (const [x, z, fr] of junctions) spire(x + 60, z + 50, R * (0.1 + rand() * 0.07) * (1.15 - fr * 0.4), R * 0.0085, tones[Math.floor(rand() * tones.length)]);
  for (const arm of arms) {
    const step = (230 + rand() * 60) / density;
    for (let d = R * 0.1; d < arm.len - 80; d += step * (0.8 + rand() * 0.5)) {
      const side = rand() < 0.5 ? -1 : 1;
      const [cx, cz] = armPoint(arm.a, d);
      const off = arm.w * 0.5 + 34 + rand() * 60;
      const px = Math.cos(arm.a) * side, pz = -Math.sin(arm.a) * side;
      const h = R * (0.045 + rand() * rand() * 0.11);
      spire(cx + px * off, cz + pz * off, h, Math.max(h * 0.062, 7), tones[Math.floor(rand() * tones.length)]);
    }
  }

  // ---- scattered districts between the arms, and far silhouettes all around the horizon
  const scatter = Math.round(46 * density);
  for (let i = 0; i < scatter; i++) {
    const a = (rand() - 0.5) * Math.PI * 1.7;
    const d = R * (0.12 + rand() * 0.6);
    const [x, z] = armPoint(a, d);
    if (z > -160) continue;
    const h = R * (0.03 + rand() * rand() * 0.09);
    spire(x, z, h, Math.max(h * 0.066, 6), tones[Math.floor(rand() * tones.length)]);
  }
  const far = Math.round(54 * density);
  for (let i = 0; i < far; i++) {
    const a = (i / far) * Math.PI * 2 + rand() * 0.08;
    const d = R * (0.95 + rand() * 0.32);
    const x = Math.sin(a) * d, z = hubZ * 0.5 + Math.cos(a) * d;
    if (z > 200 && Math.abs(x) < 500) continue;
    const h = R * (0.05 + rand() * 0.13);
    addSpire(b, cards, { x, y: yd - 60, z, h, r: h * 0.07, tone: rand() < 0.5 ? 'black' : 'mixed', rand });
  }

  // ---- hero towers flanking the viewer: tops above eye level for parallax and a hard scale cue
  const heroes: Array<[number, number, number, number, SpireTone]> = [
    [-330, -250, drop + 150, 24, 'white'], [-520, -520, drop + 60, 20, 'mixed'], [-235, -420, drop - 40, 13, 'white'],
    [420, -330, drop + 210, 26, 'mixed'], [600, -640, drop + 90, 21, 'white'], [300, -560, drop - 30, 12, 'white'],
  ];
  for (const [x, z, h, r, tone] of heroes) {
    if (inCorridor(x, z)) continue;
    pier(x, z, r, 640);
    addSpire(b, cards, { x, y: yd, z, h, r, tone, rand, hero: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      cards.point(x + Math.cos(a) * r * 2.5, yd + 8, z + Math.sin(a) * r * 2.5, 1.6, KING.light, 3);
    }
  }

  // ---- lights down in the abyss: sparse, dim — depth below the deck
  const deep = Math.round(260 * density);
  for (let i = 0; i < deep; i++) {
    const a = rand() * Math.PI * 2, d = R * Math.sqrt(rand()) * 1.1;
    const x = Math.sin(a) * d, z = hubZ * 0.6 + Math.cos(a) * d;
    if (z > -100 || inCorridor(x, z)) continue;
    cards.point(x, yd - 60 - rand() * 380, z, 2.2, rand() < 0.85 ? KING.light : KING.white, 1.2 + rand() * 1.6);
  }

  const group = new THREE.Group();
  group.name = 'scenic:terminalVista';
  const mesh = new THREE.Mesh(b.build(), createScenicMaterial(shared, { name: 'ScenicVista', panel: [34, 17], gloss: 0.55, lowHaze: 1, lowStart: yd - 20, lowDepth: 460 }));
  mesh.name = 'scenic:terminalVista:structure';
  mesh.frustumCulled = false;
  const lights = cards.build(shared, { name: 'scenic:terminalVista:lights' });
  lights.frustumCulled = false;
  group.add(mesh, lights);
  group.userData.scenic = { kind: 'terminalVista', triangles: b.triangleCount, lights: cards.count };
  return group;
}
