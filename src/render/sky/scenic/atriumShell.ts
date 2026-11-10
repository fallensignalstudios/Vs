/**
 * atriumShell — the ≈ 300 m scenic atrium around the Z05 meeting platform: a ring floor around the shaft, ringed
 * balcony tiers with warm rim light, twelve immense ribs that climb the wall and arc over into an open ceiling
 * lattice (the fleet battle and the carrier must stay visible through it), broken spans that end over the shaft,
 * the shaft itself falling away in receding light rings, and the exterior spires seen through the ceiling — one
 * of which is the tower the carrier clips (its tip is a separate mesh the carrier shears off).
 * Three draw calls: structure, tower tip, lights.
 *
 * Local frame: origin = centre of the playable platform floor. Everything lies at radius ≥ `shaftRadius` at floor
 * level; broken spans sit on the diagonals (22.5° + k·45°) so cardinal bridges built by the zone never collide.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING, addSpire } from './arch';
import { CLIP_TOWER, registerClipTip } from './clipTower';
import { GeoBuilder, type P3 } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';

export interface AtriumShellOpts { radius?: number; height?: number; shaftRadius?: number; tiers?: number; seed?: number }

const TAU = Math.PI * 2;

export function buildAtriumShell(shared: SharedUniforms, opts: AtriumShellOpts = {}): THREE.Object3D {
  const R = Math.max(60, opts.radius ?? 150);
  const H = Math.max(40, opts.height ?? 140);
  const shaft = Math.min(Math.max(20, opts.shaftRadius ?? 60), R - 30);
  const tiers = Math.max(1, Math.min(7, Math.round(opts.tiers ?? 4)));
  const rand = mulberry32((opts.seed ?? 7283) ^ 0xa791);
  const b = new GeoBuilder();
  const cards = new LightCards();
  const tierH = (H * 0.66) / tiers;
  const wallTop = tiers * tierH + tierH * 0.45;
  const polar = (r: number, a: number, y: number): P3 => [Math.cos(a) * r, y, -Math.sin(a) * r];

  // ---- ring floor around the shaft (two rings so the inner lip reads as black stone with a gold edge)
  b.paint(KING.whiteGold, 0, 0.34).ring(0, 0, shaft + 6, R, -5, 0, 0, TAU, 48);
  b.paint(KING.black, 0, 1).ring(0, 0, shaft, shaft + 6, -7, 0.4, 0, TAU, 48);
  b.paint(KING.channel, 1.6).ring(0, 0, shaft + 6, shaft + 6.3, 0, 0.45, 0, TAU, 48);

  // ---- outer wall (seen from inside) with a dark plinth course
  b.paint(KING.whiteGold, 0, 0.3).ring(0, 0, R, R + 10, -5, wallTop, 0, TAU, 48);
  b.paint(KING.black, 0, 1).ring(0, 0, R - 1.2, R, 0, 3.2, 0, TAU, 48);

  // ---- balcony tiers: slab, parapet, warm rim light, columns down to the tier below
  for (let k = 1; k <= tiers; k++) {
    const y = k * tierH;
    const inner = R - 24 + k * 2.6;
    b.paint(KING.whiteGold, 0, 0.36).ring(0, 0, inner, R, y - 2.4, y, 0, TAU, 48);
    b.paint(KING.whiteGold, 0, 0.44).ring(0, 0, inner, inner + 0.7, y, y + 1.2, 0, TAU, 48);
    b.paint(KING.light, 1.5).ring(0, 0, inner - 0.2, inner, y - 1.5, y - 1.25, 0, TAU, 48);
    b.paint(KING.gold, 0, 0.8).ring(0, 0, inner - 0.2, inner, y - 0.5, y, 0, TAU, 48);
    const cols = 36;
    for (let i = 0; i < cols; i++) {
      const a = ((i + 0.5) / cols) * TAU;
      const p = polar(inner + 3, a, y - tierH / 2 - 1.2);
      b.push().translate(p[0], p[1], p[2]).rotateY(a);
      b.paint(KING.whiteGold, 0, 0.4).box(0, 0, 0, 2.4, tierH - 2.4, 1.5, { top: [0.8, 0.9] });
      b.pop();
      if (i % 3 === 0) cards.point(Math.cos(a) * (inner + 5), y - tierH * 0.55, -Math.sin(a) * (inner + 5), 1.4, KING.light, 2.6 + rand() * 1.4);
    }
  }

  // ---- vertical light seams in the wall bays ("light as information"), a few of them dark
  for (let k = 0; k < tiers; k++) {
    for (let i = 0; i < 24; i++) {
      if (rand() < 0.3) continue;
      const a = ((i + 0.5) / 24) * TAU;
      cards.strip(Math.cos(a) * (R - 0.8), k * tierH + tierH * 0.5, -Math.sin(a) * (R - 0.8), 0.5, tierH * 0.56, KING.light, 1.5 + rand() * 0.8);
    }
  }

  // ---- immense ribs: up the wall, over the ceiling to an oculus ring
  const ribs = 12;
  const oculus = R * 0.12;
  const ribPath = (t: number): [number, number] => {
    // t 0..0.42 climbs the wall, then a quarter-ellipse to the oculus
    if (t < 0.42) return [R - 7, (t / 0.42) * wallTop];
    const a = ((t - 0.42) / 0.58) * Math.PI * 0.5;
    return [oculus + (R - 7 - oculus) * Math.cos(a), wallTop + (H - wallTop) * Math.sin(a)];
  };
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * TAU + TAU / (ribs * 2);
    const ca = Math.cos(a), sa = -Math.sin(a);
    const frames: Array<{ p: P3; side: P3; up: P3; w: number; d: number }> = [];
    const N = 22;
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const [r, y] = ribPath(t);
      const [r1, y1] = ribPath(Math.min(t + 0.01, 1));
      const [r0, y0] = ribPath(Math.max(t - 0.01, 0));
      let tr = r1 - r0, ty = y1 - y0;
      const l = Math.hypot(tr, ty) || 1;
      tr /= l; ty /= l;
      // rib normal pointing into the room
      const nr = -ty, ny = tr;
      const w = 6.4 - 4.2 * t, d = 9 - 6 * t;
      frames.push({ p: [ca * r, y, sa * r], side: [-sa, 0, ca], up: [ca * nr, ny, sa * nr], w, d });
      if (k % 2 === 1) cards.point(ca * (r + nr * (d / 2 + 0.5)), y + ny * (d / 2 + 0.5), sa * (r + nr * (d / 2 + 0.5)), 1.5, KING.light, 3 + rand() * 1.5);
    }
    b.paint(KING.whiteGold, 0, 0.56).sweep(frames);
    // gold shoe where each rib meets the floor
    b.push().translate(ca * (R - 7), 0, sa * (R - 7)).rotateY(a);
    b.paint(KING.gold, 0, 0.8).box(0, 2, 0, 10.5, 4, 8.2, { top: [0.9, 0.9] });
    b.pop();
  }
  // ---- open ceiling lattice: thin concentric rings + secondary mullions (≈ 90 % open)
  for (const f of [0.3, 0.52, 0.74]) {
    const a = f * Math.PI * 0.5;
    const r = oculus + (R - 7 - oculus) * Math.cos(a), y = wallTop + (H - wallTop) * Math.sin(a);
    b.paint(KING.whiteGold, 0, 0.6).ring(0, 0, r - 0.8, r + 0.8, y - 0.9, y + 0.9, 0, TAU, 48);
  }
  b.paint(KING.gold, 0, 0.85).ring(0, 0, oculus - 1.5, oculus + 1.5, H - 1.6, H + 1.6, 0, TAU, 32);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * TAU;
    const ca = Math.cos(a), sa = -Math.sin(a);
    const frames: Array<{ p: P3; side: P3; up: P3; w: number; d: number }> = [];
    for (let k = 0; k <= 8; k++) {
      const u = ((k / 8) * 0.74) * Math.PI * 0.5;
      const r = oculus + (R - 7 - oculus) * Math.cos(u), y = wallTop + (H - wallTop) * Math.sin(u);
      frames.push({ p: [ca * r, y, sa * r], side: [-sa, 0, ca], up: [0, 1, 0], w: 0.9, d: 1.1 });
    }
    b.paint(KING.whiteGold, 0, 0.55).sweep(frames);
  }

  // ---- the shaft: walls falling away in bands with receding light rings
  const depth = 620;
  for (let k = 0; k < 9; k++) {
    const y0 = -7 - ((k + 1) / 9) * depth, y1 = -7 - (k / 9) * depth;
    b.paint(k % 2 ? KING.black : KING.blackDeep, 0, 1).ring(0, 0, shaft, shaft + 8, y0, y1, 0, TAU, 40);
    b.paint(KING.channel, 1.15 - k * 0.09).ring(0, 0, shaft - 0.3, shaft, y1 - 3.2, y1 - 2.8, 0, TAU, 40);
  }

  // ---- broken spans on the diagonals: floor level stubs and higher spans snapped in mid-air
  for (let i = 0; i < 8; i++) {
    const a = (22.5 + i * 45) * (Math.PI / 180);
    const level = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2;
    const y = level * tierH;
    const from = level === 0 ? shaft : R - 24 + level * 2.6;
    const reach = level === 0 ? 8 + rand() * 12 : 34 + rand() * 46;
    const to = Math.max(from - reach, level === 0 ? 40 : 26);
    const len = from - to;
    b.push().rotateY(a).translate((from + to) / 2, y, 0);
    b.paint(KING.whiteGold, 0, 0.56).box(0, -1.5, 0, len, 3, 6.4);
    for (const s of [-1, 1]) b.paint(KING.whiteGold, 0, 0.62).box(0, 0.6, s * 3.0, len, 1.2, 0.4);
    // torn end: sheared slabs + hanging plates
    b.paint(KING.blackDeep, 0, 1).box(-len / 2 - 1.2, -1.7, 0.6, 3.2, 2.4, 5.2, { top: [0.3, 0.8], shift: [0.8, 0.4] });
    for (let j = 0; j < 4; j++) {
      b.push().translate(-len / 2 - 1.5 - rand() * 2.5, -2.5 - rand() * 4, (rand() - 0.5) * 6).rotateX(rand() * 2).rotateZ(rand() * 2);
      b.paint(KING.whiteGold, 0, 0.4).box(0, 0, 0, 1 + rand() * 2.4, 0.3, 0.8 + rand() * 2);
      b.pop();
    }
    b.pop();
    cards.point(Math.cos(a) * (to - 1), y + 0.4, -Math.sin(a) * (to - 1), 1.2, 0xffb070, 2.2);
  }

  // ---- exterior spires seen through the ceiling
  const towers: Array<[number, number, number, number]> = [
    [-300, -210, 380, 20], [-120, -400, 470, 23], [210, -330, 350, 18], [-390, 110, 440, 22],
    [140, 360, 400, 20], [390, 190, 360, 18], [-230, 330, 330, 17],
  ];
  for (const [x, z, h, r] of towers) {
    addSpire(b, cards, { x, y: -60, z, h: h + 60, r, tone: rand() < 0.5 ? 'white' : 'mixed', rand, hero: true });
  }
  // the clip tower: shaft built here, the tip above the cut is its own mesh
  const cx = CLIP_TOWER.x, cz = CLIP_TOWER.z, cut = CLIP_TOWER.cut, top = CLIP_TOWER.top;
  b.paint(KING.whiteGold, 0, 0.58).prism(cx, -60, cz, 40, 44, 40, 4);
  b.paint(KING.whiteGold, 0, 0.6).prism(cx, 40, cz, 230, 30, 21, 8);
  b.paint(KING.gold, 0, 0.8).prism(cx, 230, cz, 236, 24, 23, 8);
  b.paint(KING.whiteGold, 0, 0.62).prism(cx, 236, cz, cut, 19, 9.5, 4);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    b.paint(KING.whiteGold, 0, 0.55).prism(cx + Math.cos(a) * 34, 40, cz + Math.sin(a) * 34, 200, 8, 0, 4);
  }
  for (let i = 0; i < 9; i++) cards.strip(cx - 14 + rand() * 6, 70 + i * 34, cz + 15 - i * 0.9, 1.3, 16, KING.light, 2.6);
  cards.point(cx, top + 3, cz, 5, KING.white, 7);

  const tb = new GeoBuilder();
  tb.paint(KING.gold, 0, 0.8).prism(0, 0, 0, 2.5, 10.5, 10, 4);
  tb.paint(KING.whiteGold, 0, 0.62).prism(0, 2.5, 0, top - cut, 9, 0, 4);

  const group = new THREE.Group();
  group.name = 'scenic:atriumShell';
  const material = createScenicMaterial(shared, { name: 'ScenicAtrium', panel: [12, 7.3], panelTone: 0.16, panelSeam: 0.3, gloss: 0.45, haze: 0.4, lowHaze: 1, lowStart: -30, lowDepth: 420 });
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.name = 'scenic:atriumShell:structure';
  mesh.frustumCulled = false;
  const tip = new THREE.Mesh(tb.build(), material);
  tip.name = 'scenic:atriumShell:clipTip';
  tip.position.set(cx, cut, cz);
  tip.userData.home = tip.position.clone();
  tip.frustumCulled = false;
  registerClipTip(tip);
  const lights = cards.build(shared, { name: 'scenic:atriumShell:lights', haze: 0.4 });
  lights.frustumCulled = false;
  group.add(mesh, tip, lights);
  group.userData.scenic = { kind: 'atriumShell', triangles: b.triangleCount + tb.triangleCount, lights: cards.count };
  return group;
}
