/**
 * terminalVista — the city-scale converging terminal of the Wound-overlook concept.
 *
 * Composed for the Z09 over-shoulder camera, which stands at the railing and sees roughly −7° … +25°:
 *  - a HIGH level of arched skyways (≈ 0.2 × drop below the floor) converging on the hub, so thick decks and
 *    the pointed arches of their pylons overlap in depth right at the horizon instead of hiding under the parapet;
 *  - the DECK level `drop` metres down: the ten-armed star, ring roads and piers that open up when the player
 *    looks over the rail;
 *  - six foreground towers with real mass flanking the view, ranks of spires from four families thinning into
 *    haze, terraced districts between the arms, thousands of tiny warm lights across the abyss.
 * Nothing may shine inside the Wound: within its cone, spires are capped low and carry no lights, so the disc
 * stays a clean absence (the hub citadel is a dark crown under its lower limb, not a star inside it).
 * Two draw calls (structure + lights), ≈ 200k triangles.
 *
 * Local frame: origin = overlook floor, hub toward −Z.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING, addCauseway, addPier, addSpire, type SpireStyle, type SpireTone } from './arch';
import { GeoBuilder } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';
import { bag, num, seedOf } from './opts';
import { insideWound, woundCone, woundLimit } from './woundClear';

export interface TerminalVistaOpts { radius?: number; seed?: number; density?: number; drop?: number; corridor?: number; clearWound?: boolean }

const DEG = Math.PI / 180;

export function buildTerminalVista(shared: SharedUniforms, opts?: TerminalVistaOpts | null): THREE.Object3D {
  const o = bag(opts);
  const R = num(o.radius, 3000, 800, 6000);
  const drop = num(o.drop, 220, 40, 900);
  const density = num(o.density, 1, 0.25, 2);
  const corridor = num(o.corridor, 0, 0, R);
  const rand = mulberry32(seedOf(o.seed) ^ 0x7e21);
  const cone = o.clearWound === false ? null : woundCone();
  const b = new GeoBuilder();
  const cards = new LightCards();
  if (cone) cards.veto = (x, y, z) => insideWound(cone, x, y, z);
  const yd = -drop;
  const yHigh = -drop * 0.2;
  const hubZ = -0.7 * R;
  const inCorridor = (x: number, z: number): boolean => corridor > 0 && Math.abs(x) < corridor / 2 + 30 && z > hubZ * 1.25;
  const limit = (x: number, z: number, top: number): { top: number; lit: boolean } => woundLimit(cone, x, z, top);

  // ---- abyss floor (only ever seen through haze) and a far rim wall closing the horizon
  b.light(1, 0).dress(0, 0).paint(KING.blackDeep, 0, 0.8).lathe(0, hubZ * 0.5, [[R * 1.5, yd - 600], [0, yd - 600]], 64);
  b.dress(0, 0).paint(KING.black, 0, 0.9).lathe(0, hubZ * 0.5, [[R * 1.32, yd + 70], [R * 1.32, yd - 600]], 128);
  b.dress(0, 1).paint(KING.gold, 0, 0.5).lathe(0, hubZ * 0.5, [[R * 1.32 - 3, yd + 74], [R * 1.32 - 3, yd + 66]], 128);

  // ---- DECK level: radial causeways from the hub. angle 0 points back at the viewer (+Z), clockwise from above.
  const arms: Array<{ a: number; len: number; w: number }> = [];
  for (const deg of [0, 26, -26, 55, -55, 92, -92, 138, -138, 180]) {
    if (deg === 0 && corridor > 0) continue;
    const a = deg * DEG;
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
  // ring roads: chords between neighbouring arms
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

  // ---- HIGH level: four skyways converging on the hub, tied by two chords. Their decks ride just under the
  //      horizon and their pylons fall away in ranks of pointed arches — the mid-ground the eye-level camera sees.
  const highArms = [22, -22, 48, -48].map((deg) => ({ a: deg * DEG, len: R * (Math.abs(deg) < 30 ? 0.56 : 0.5) }));
  for (const arm of highArms) {
    const [x0, z0] = armPoint(arm.a, R * 0.1), [x1, z1] = armPoint(arm.a, arm.len);
    addCauseway(b, cards, x0, z0, x1, z1, yHigh, 30, { rand, lightEvery: 40 / density, pylonEvery: 150, pylonDepth: drop * 0.8 + 420, channel: 1.5 });
  }
  for (const fr of [0.3, 0.46]) {
    for (const s of [-1, 1]) {
      const [ax, az] = armPoint(s * 22 * DEG, R * fr), [bx, bz] = armPoint(s * 48 * DEG, R * fr * 0.98);
      addCauseway(b, cards, ax, az, bx, bz, yHigh - 5, 22, { rand, lightEvery: 50 / density, pylonEvery: 130, pylonDepth: drop * 0.8 + 420, channel: 1.2 });
    }
    if (corridor <= 0 || fr < 0.4) {
      // the chord across the axis: far enough out that it bridges the Crownmark arm well below the Wound's limb
      const [ax, az] = armPoint(-22 * DEG, R * fr), [bx, bz] = armPoint(22 * DEG, R * fr);
      addCauseway(b, cards, ax, az, bx, bz, yHigh - 5, 22, { rand, lightEvery: 50 / density, pylonEvery: 130, pylonDepth: drop * 0.8 + 420, channel: 1.2 });
    }
  }

  const tones: SpireTone[] = ['black', 'mixed', 'mixed', 'white'];
  const styles: SpireStyle[] = ['needle', 'needle', 'blade', 'cluster', 'stepped'];
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const spire = (x: number, z: number, h: number, r: number, tone: SpireTone, style: SpireStyle, base = yd): void => {
    if (inCorridor(x, z) || Math.hypot(x, z) < 760) return; // the near field belongs to the authored hero towers
    const dist = Math.hypot(x, z);
    const lim = limit(x, z, base + h);
    const hh = lim.top - base;
    if (hh < 24) return;
    const detail = dist < 1500 ? 1 : dist < 2600 ? (rand() < 0.5 ? 1 : 0) : 0;
    addPier(b, cards, x, z, base, r, 640, rand, dist < 1700 ? 1 : 0, lim.lit);
    addSpire(b, cards, { x, y: base, z, h: hh, r: Math.min(r, hh * 0.09), tone: lim.lit ? tone : 'black', rand, detail, style, lit: lim.lit, rot: Math.atan2(x, z) });
  };

  // ---- the hub citadel: a crown of spires around the white point, kept under the Wound's lower limb
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    spire(Math.sin(a) * R * 0.045, hubZ + Math.cos(a) * R * 0.045, R * (0.17 + rand() * 0.06), R * 0.012, i % 2 ? 'white' : 'mixed', i % 2 ? 'needle' : 'blade');
  }
  spire(0, hubZ, R * 0.3, R * 0.02, 'white', 'cluster');
  b.light(1, 0).dress(0.8, 1).paint(KING.whiteGold, 0, 0.5).lathe(0, hubZ, [[R * 0.068, yd - 20], [R * 0.068, yd + 26], [R * 0.06, yd + 26], [R * 0.06, yd - 20]], 64);
  // the destination marker: a white point at the citadel's foot, on the glow line (never inside the disc)
  cards.point(0, yd + 34, hubZ + R * 0.07, 10, KING.white, 9);

  // ---- junction spires and ranks along every arm
  for (const [x, z, fr] of junctions) spire(x + 60, z + 50, R * (0.1 + rand() * 0.07) * (1.15 - fr * 0.4), R * 0.0085, pick(tones), pick(styles));
  for (const arm of arms) {
    const step = (230 + rand() * 60) / density;
    for (let d = R * 0.1; d < arm.len - 80; d += step * (0.8 + rand() * 0.5)) {
      const side = rand() < 0.5 ? -1 : 1;
      const [cx, cz] = armPoint(arm.a, d);
      const off = arm.w * 0.5 + 34 + rand() * 60;
      const px = Math.cos(arm.a) * side, pz = -Math.sin(arm.a) * side;
      const h = R * (0.045 + rand() * rand() * 0.11);
      spire(cx + px * off, cz + pz * off, h, Math.max(h * 0.062, 7), pick(tones), pick(styles));
    }
  }
  // towers standing where the skyways meet their chords: they carry the high level visually
  for (const arm of highArms) {
    for (const fr of [0.3, 0.46]) {
      const [x, z] = armPoint(arm.a, R * fr);
      const side = arm.a > 0 ? 1 : -1;
      spire(x + side * 46, z + 20, drop * 0.2 + R * (0.06 + rand() * 0.05), 13, pick(tones), 'cluster', yHigh - 6);
    }
  }

  // ---- terraced districts between the arms: low stepped blocks with lit openings (the city's fabric)
  const districts = Math.round(34 * density);
  for (let i = 0; i < districts; i++) {
    const a = (rand() - 0.5) * Math.PI * 1.5;
    const d = R * (0.14 + rand() * 0.5);
    const [x, z] = armPoint(a, d);
    if (z > -700 || inCorridor(x, z)) continue;
    const lim = limit(x, z, yd + 90);
    const r = 22 + rand() * 26;
    addPier(b, cards, x, z, yd, r * 0.4, 640, rand, 0, lim.lit);
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const bx = x + (rand() - 0.5) * r * 1.6, bz = z + (rand() - 0.5) * r * 1.6;
      const w = 10 + rand() * 18, dp = 10 + rand() * 18, h = Math.min(12 + rand() * rand() * 70, lim.top - yd);
      const pale = rand() < 0.3;
      b.light(1, 0).dress(lim.lit ? 0.7 : 0, 1).paint(pale ? KING.whiteGold : KING.black, 0, pale ? 0.42 : 1.3).box(bx, yd + h / 2, bz, w, h, dp, { top: [0.86, 0.86] });
      b.dress(0, 1).paint(KING.gold, 0, 0.55).box(bx, yd + h + 0.5, bz, w * 0.8, 1, dp * 0.8);
      if (h > 40) b.paint(pale ? KING.whiteGold : KING.black, 0, pale ? 0.5 : 1.2).prism(bx, yd + h + 1, bz, yd + h + 1 + h * 0.5, w * 0.22, 0, 4);
    }
  }
  // scattered spires between the arms, and far silhouettes all around the horizon
  const scatter = Math.round(46 * density);
  for (let i = 0; i < scatter; i++) {
    const a = (rand() - 0.5) * Math.PI * 1.7;
    const d = R * (0.12 + rand() * 0.6);
    const [x, z] = armPoint(a, d);
    if (z > -160) continue;
    const h = R * (0.03 + rand() * rand() * 0.09);
    spire(x, z, h, Math.max(h * 0.066, 6), pick(tones), pick(styles));
  }
  const far = Math.round(54 * density);
  for (let i = 0; i < far; i++) {
    const a = (i / far) * Math.PI * 2 + rand() * 0.08;
    const d = R * (0.95 + rand() * 0.32);
    const x = Math.sin(a) * d, z = hubZ * 0.5 + Math.cos(a) * d;
    if (z > 200 && Math.abs(x) < 500) continue;
    const lim = limit(x, z, yd - 60 + R * (0.05 + rand() * 0.13));
    const h = lim.top - (yd - 60);
    if (h < 30) continue;
    addSpire(b, cards, { x, y: yd - 60, z, h, r: h * 0.07, tone: rand() < 0.5 ? 'black' : 'mixed', rand, detail: 0, lit: lim.lit });
  }

  // ---- foreground towers with real mass, flanking the view: tops far above eye level for parallax and a hard
  //      scale cue. Each stands on its own pier; the two nearest carry a skyway stub toward the viewer's terrace.
  //      They step aside for the corridor when a Crownmark arm lies in it, so the frame always has its flanks.
  const edge = corridor > 0 ? corridor / 2 + 30 : 0;
  const hx = (x: number, r: number): number => Math.sign(x) * Math.max(Math.abs(x), edge + r * 3.4);
  const heroes: Array<[number, number, number, number, SpireTone, SpireStyle]> = [
    [hx(-300, 30), -330, drop + 190, 30, 'white', 'cluster'], [hx(-560, 24) - (edge > 0 ? 190 : 0), -640, drop + 90, 24, 'mixed', 'stepped'], [hx(-215, 15), -560, drop + 10, 15, 'white', 'blade'],
    [hx(390, 32), -430, drop + 250, 32, 'white', 'cluster'], [hx(640, 26) + (edge > 0 ? 150 : 0), -780, drop + 130, 26, 'mixed', 'stepped'], [hx(270, 15), -720, drop + 30, 15, 'white', 'blade'],
  ];
  for (const [x, z, h, r, tone, style] of heroes) {
    addPier(b, cards, x, z, yd, r, 640, rand, 1, true);
    addSpire(b, cards, { x, y: yd, z, h, r, tone, rand, detail: 2, style, rot: Math.atan2(x, z) });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      cards.point(x + Math.cos(a) * r * 2.8, yd + 8, z + Math.sin(a) * r * 2.8, 1.6, KING.light, 3);
    }
  }
  // short high-level links between neighbouring foreground towers (thick decks close to the eye line)
  const link = (i: number, j: number, y: number): void => {
    const p = heroes[i], q = heroes[j];
    addCauseway(b, cards, p[0], p[1], q[0], q[1], y, 18, { rand, lightEvery: 26, pylonEvery: 110, pylonDepth: drop + y + 400, channel: 1.4 });
  };
  link(0, 1, yHigh - 18);
  link(3, 4, yHigh - 10);

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
  const mesh = new THREE.Mesh(b.build(), createScenicMaterial(shared, {
    name: 'ScenicVista', panel: [34, 17], gloss: 0.85, lowHaze: 1, lowStart: yd - 20, lowDepth: 460, windows: [5.5, 11, 1.5], nearFill: [0.22, 0.21, 0.24, 1300],
  }));
  mesh.name = 'scenic:terminalVista:structure';
  mesh.frustumCulled = false;
  const lights = cards.build(shared, { name: 'scenic:terminalVista:lights' });
  lights.frustumCulled = false;
  group.add(mesh, lights);
  group.userData.scenic = { kind: 'terminalVista', triangles: b.triangleCount, lights: cards.count };
  return group;
}
