/**
 * atriumShell — the ≈ 300 m scenic atrium around the Z05 meeting platform.
 *
 * Ringed gallery tiers, each an arcade of pointed arches whose recesses glow from their own seams; twelve
 * immense profiled ribs that climb the wall as a giant order, spring from a cornice and arc over into an open
 * ceiling lattice (the fleet battle and the carrier stay visible through it); real broken bridges snapped in
 * mid-air over the shaft; the shaft itself falling away in fluted, light-ringed bands; and the exterior spires
 * seen through the ceiling — one of which is the tower the carrier clips (its needle is a separate mesh).
 * Three draw calls: structure, tower needle, light cards. ≈ 160k triangles.
 *
 * LIGHTING is baked per vertex (GeoBuilder.light): the sky's key / fill only reach the ribs, ceiling and
 * exterior; the arcades and soffits are lit by their own warm seams. Nothing is lit through a wall.
 *
 * Local frame: origin = centre of the playable platform floor. At floor level everything lies at radius
 * ≥ `shaftRadius` except four short broken stubs on the odd diagonals (22.5° + k·90°); the high broken spans sit
 * on the even diagonals at gallery height (≥ one tier up), so cardinal bridges built by the zone never collide.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING, addSpire, archPanel, type SpireStyle } from './arch';
import { CLIP_TOWER, clipTowerRadius, type ClipTipSlot } from './clipTower';
import { GeoBuilder, type Frame, type P2, type P3 } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';
import { bag, int, num, seedOf } from './opts';

export interface AtriumShellOpts { radius?: number; height?: number; shaftRadius?: number; tiers?: number; seed?: number }

const TAU = Math.PI * 2;
const SEG = 144;
/** rib section: (side, up) in units of the frame's w / d; +up faces the room and carries the light channel */
const RIB: readonly P2[] = [
  [-0.5, -0.5], [0.5, -0.5], [0.5, 0.18], [0.34, 0.5], [0.10, 0.5], [0.10, 0.36], [-0.10, 0.36], [-0.10, 0.5], [-0.34, 0.5], [-0.5, 0.18],
];
const RECT: readonly P2[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];

export function buildAtriumShell(shared: SharedUniforms, tips: ClipTipSlot, opts?: AtriumShellOpts | null): THREE.Object3D {
  const o = bag(opts);
  // the clip tower stands 351 m out, so the shell may not grow past it
  const R = num(o.radius, 150, 80, 260);
  const H = num(o.height, 140, 50, 400);
  const shaft = Math.min(num(o.shaftRadius, 60, 20, 200), R - 40);
  const tiers = int(o.tiers, 4, 1, 7);
  const rand = mulberry32(seedOf(o.seed) ^ 0xa791);
  const b = new GeoBuilder();
  const cards = new LightCards();
  const tierH = (H * 0.66) / tiers;
  const attic = tierH * 0.45;
  const wallTop = tiers * tierH + attic;
  const G = Math.min(22, R * 0.15);        // gallery depth
  const A = G * 0.55;                      // arcade set back from the wall
  const inner = R - G, Ra = R - A;
  const bays = 12;
  const perBay = Math.max(3, Math.min(9, Math.round((TAU * Ra) / bays / 12)));
  const nArch = bays * perBay;
  const dA = TAU / nArch;
  const pitch = 2 * Ra * Math.tan(dA / 2);
  const polar = (r: number, a: number, y: number): P3 => [Math.cos(a) * r, y, -Math.sin(a) * r];
  /** local frame at angle a, radius r: +X tangent, +Z toward the atrium centre */
  const atWall = (a: number, r: number, y = 0): GeoBuilder => b.push().translate(Math.cos(a) * r, y, -Math.sin(a) * r).rotateY(a - Math.PI / 2);

  // ---- ring floor: pale paving, concentric and radial gold channels, a black-stone lip at the shaft
  b.dress(0, 1).light(0.42, 0.22).paint(KING.whiteGold, 0, 0.36).lathe(0, 0, [[R, 0], [shaft + 6, 0]], SEG);
  b.paint(KING.black, 0, 1).lathe(0, 0, [[shaft + 6, 0], [shaft + 6, 0.4], [shaft, 0.4], [shaft, -7]], SEG);
  b.dress(0, 0).paint(KING.channel, 1.6).lathe(0, 0, [[shaft + 6.5, 0.03], [shaft + 6.05, 0.03]], SEG);
  for (const f of [0.36, 0.7]) {
    const r = shaft + 6 + (inner - shaft - 6) * f;
    b.paint(KING.channel, 1.15).lathe(0, 0, [[r + 0.2, 0.03], [r - 0.2, 0.03]], SEG);
  }
  for (let i = 0; i < bays * 2; i++) {
    const a = (i / (bays * 2)) * TAU + TAU / (bays * 2);
    const major = i % 2 === 0;
    const r0 = shaft + 6.6, r1 = major ? inner : shaft + 6 + (inner - shaft - 6) * 0.36;
    atWall(a, (r0 + r1) / 2).paint(KING.channel, major ? 1.25 : 0.9).box(0, 0.02, 0, major ? 0.42 : 0.3, 0.04, r1 - r0).pop();
  }
  b.dress(0, 1);

  // ---- the wall behind the galleries: the lit back of every recess, with vertical light seams
  b.light(0, 0.6).paint(KING.whiteGold, 0, 0.3).lathe(0, 0, [[R, wallTop], [R, 0]], SEG);
  b.light(0, 0.3).paint(KING.black, 0, 1).lathe(0, 0, [[R - 0.6, 3.2], [R - 0.6, 0]], SEG);
  b.dress(0, 0);
  for (let k = 0; k < tiers; k++) {
    for (let j = 0; j < nArch; j++) {
      if (rand() < 0.5) continue;
      const a = (j + 0.5) * dA;
      const h = (tierH - 2.4) * (0.3 + rand() * 0.22);
      atWall(a, R - 0.45, k * tierH + 3.4 + h / 2).paint(KING.light, 0.9 + rand() * 0.7).box(0, 0, 0, 0.26, h, 0.3).pop();
    }
  }
  b.dress(0, 1);

  // ---- gallery tiers
  for (let k = 0; k < tiers; k++) {
    const y0 = k * tierH, y1 = y0 + tierH, soffit = y1 - 2.4;
    const up = k / Math.max(tiers - 1, 1);
    // slab edge: kerb, cornice with a gold band over a continuous seam of light, soffit running back to the wall
    b.light(0.30 + 0.15 * up, 0.25).paint(KING.whiteGold, 0, 0.46).lathe(0, 0, [[inner + 0.8, y1 + 0.35], [inner, y1 + 0.35], [inner, y1 - 0.45], [inner + 0.35, y1 - 0.45]], SEG);
    b.paint(KING.gold, 0, 0.8).lathe(0, 0, [[inner + 0.35, y1 - 0.45], [inner + 0.35, y1 - 0.72]], SEG);
    b.dress(0, 0).paint(KING.light, 1.25).lathe(0, 0, [[inner + 0.35, y1 - 0.72], [inner + 0.35, y1 - 0.86]], SEG);
    b.paint(KING.gold, 0, 0.8).lathe(0, 0, [[inner + 0.35, y1 - 0.86], [inner + 0.35, y1 - 1.0]], SEG);
    b.dress(0, 1).light(0.12, 0.5).paint(KING.whiteGold, 0, 0.4).lathe(0, 0, [[inner + 0.35, y1 - 1.0], [inner + 0.7, y1 - 1.0], [inner + 0.7, soffit]], SEG);
    b.light(0, 0.42).paint(KING.whiteGold, 0, 0.3).lathe(0, 0, [[inner + 0.7, soffit], [R, soffit]], SEG);
    // balustrade: posts + rails
    b.light(0.35 + 0.2 * up, 0.2).dress(0, 0).paint(KING.whiteGold, 0, 0.5)
      .lathe(0, 0, [[inner + 0.55, y1 + 1.45], [inner + 0.25, y1 + 1.45], [inner + 0.25, y1 + 1.25], [inner + 0.55, y1 + 1.25]], SEG, { closed: true });
    b.paint(KING.gold, 0, 0.75).lathe(0, 0, [[inner + 0.47, y1 + 0.95], [inner + 0.33, y1 + 0.95], [inner + 0.33, y1 + 0.85], [inner + 0.47, y1 + 0.85]], SEG, { closed: true });
    for (let j = 0; j < nArch * 2; j++) {
      const p = polar(inner + 0.4, (j / (nArch * 2)) * TAU, y1 + 0.8);
      b.paint(KING.whiteGold, 0, 0.5).box(p[0], p[1], p[2], 0.34, 0.9, 0.34, { noBottom: true, noTop: true });
    }
    b.dress(0, 1);
    // the arcade under the slab
    for (let j = 0; j < nArch; j++) {
      const a = (j + 0.5) * dA;
      atWall(a, Ra);
      b.paint(KING.whiteGold, 0, 0.44);
      archPanel(b, {
        x0: -pitch / 2, x1: pitch / 2, y0, y1: soffit, z: 0, depth: 2.4, pier: Math.min(1.35, pitch * 0.14), spring: 0.52, crown: 1.5, segs: 7,
        front: [0.26 + 0.2 * up, 0.3], inside: [0, 0.9],
      });
      // pier base and capital, keystone
      b.light(0.26 + 0.2 * up, 0.35);
      b.paint(KING.whiteGold, 0, 0.5).bevelBox(-pitch / 2, y0 + 0.7, 0.25, 3.3, 1.4, 3.2, 0.22);
      b.paint(KING.gold, 0, 0.7).bevelBox(-pitch / 2, y0 + (soffit - 1.5 - y0) * 0.52, 0.2, 3.1, 0.6, 3.0, 0.16);
      b.paint(KING.gold, 0, 0.8).box(0, soffit - 1.25, 0.2, 0.9, 1.5, 0.6, { top: [1.5, 1] });
      // coffer beam under the gallery, from the pier out to the slab edge
      b.light(0, 0.4).paint(KING.whiteGold, 0, 0.36).box(-pitch / 2, soffit - 0.55, (G - A) / 2 - 0.2, 0.9, 1.1, G - A - 1.2);
      // a conduit of gold set into the face of every pier
      b.light(0.26 + 0.2 * up, 0.35).paint(KING.gold, 0, 0.75).box(-pitch / 2, y0 + (soffit - y0) * 0.5, 0.06, 0.34, (soffit - y0) * 0.86, 0.12);
      b.pop();
    }
  }
  // ---- attic band with clerestory slots, and the cornice the ceiling springs from
  b.light(0.55, 0.2).dress(0.85, 1).paint(KING.whiteGold, 0, 0.42).lathe(0, 0, [[Ra, wallTop - 1.8], [Ra, tiers * tierH + 0.35]], SEG);
  b.dress(0, 1).paint(KING.whiteGold, 0, 0.5).lathe(0, 0, [[Ra - 2.6, wallTop + 1.6], [Ra - 2.6, wallTop - 0.5], [Ra - 1.2, wallTop - 0.5], [Ra - 1.2, wallTop - 1.8], [Ra, wallTop - 1.8]], SEG);
  b.paint(KING.gold, 0, 0.8).lathe(0, 0, [[Ra - 2.75, wallTop + 0.9], [Ra - 2.75, wallTop + 0.35]], SEG);
  b.dress(0, 0).paint(KING.light, 1.2).lathe(0, 0, [[Ra - 1.2, wallTop - 0.95], [Ra - 1.2, wallTop - 1.15]], SEG);
  b.dress(0, 1);

  // ---- immense ribs: a giant order up the wall, then over the ceiling to the oculus
  const oculus = R * 0.12;
  const Rr = Ra - 2.2;
  const split = 0.42;
  const ribPath = (t: number): [number, number] => {
    if (t < split) return [Rr, (t / split) * wallTop];
    const a = ((t - split) / (1 - split)) * Math.PI * 0.5;
    return [oculus + (Rr - oculus) * Math.cos(a), wallTop + (H - wallTop) * Math.sin(a)];
  };
  const ribFrames = (ca: number, sa: number, t0: number, t1: number, n: number, scaleW = 1, scaleD = 1, lift = 0): Frame[] => {
    const frames: Frame[] = [];
    for (let k = 0; k <= n; k++) {
      const t = t0 + ((t1 - t0) * k) / n;
      const [r, y] = ribPath(t);
      const [r1, y1] = ribPath(Math.min(t + 0.004, 1));
      const [r0, y0] = ribPath(Math.max(t - 0.004, 0));
      let tr = r1 - r0, ty = y1 - y0;
      const l = Math.hypot(tr, ty) || 1;
      tr /= l; ty /= l;
      const nr = -ty, ny = tr; // rib normal pointing into the room
      const w = 6.6 - 4.0 * t, d = 8.4 - 5.2 * t;
      const rr = r + nr * d * lift, yy = y + ny * d * lift;
      frames.push({ p: [ca * rr, yy, sa * rr], side: [-sa, 0, ca], up: [ca * nr, ny, sa * nr], w: w * scaleW, d: d * scaleD });
    }
    return frames;
  };
  for (let i = 0; i < bays; i++) {
    const a = (i / bays) * TAU + TAU / (bays * 2);
    const ca = Math.cos(a), sa = -Math.sin(a);
    // wall run (lit by the room) and ceiling run (lit by the sky)
    b.light(0.42, 0.34).paint(KING.whiteGold, 0, 0.58).sweepProfile(ribFrames(ca, sa, 0, split, 8), RIB);
    b.light(1, 0.12).paint(KING.whiteGold, 0, 0.6).sweepProfile(ribFrames(ca, sa, split, 1, 30), RIB);
    // the light seam in the channel and the gold fillets either side of it
    b.dress(0, 0).paint(KING.light, 1.1).sweepProfile(ribFrames(ca, sa, 0.012, 0.985, 40, 0.07, 0.03, 0.375), RECT, { caps: false });
    for (const s of [-1, 1]) {
      const fr = ribFrames(ca, sa, 0.012, 0.985, 40, 0.05, 0.02, 0.505);
      for (const f of fr) { const off = s * (f.w / 0.05) * 0.22; f.p = [f.p[0] + f.side[0] * off, f.p[1], f.p[2] + f.side[2] * off]; }
      b.paint(KING.gold, 0, 0.8).sweepProfile(fr, RECT, { caps: false });
    }
    b.dress(0, 1);
    // stepped plinth with a gold shoe, and the capital where the rib leaves the wall
    atWall(a, Rr - 0.6);
    b.light(0.42, 0.34).paint(KING.whiteGold, 0, 0.5).bevelBox(0, 1.3, 0, 10.6, 2.6, 11.4, 0.5).bevelBox(0, 3.6, 0, 9.0, 2.0, 10.0, 0.4);
    b.paint(KING.gold, 0, 0.8).bevelBox(0, 4.95, 0, 8.2, 0.7, 9.4, 0.2);
    b.light(0.8, 0.2).paint(KING.whiteGold, 0, 0.56).bevelBox(0, wallTop - 0.4, 0.3, 7.4, 3.0, 9.2, 0.5);
    b.paint(KING.gold, 0, 0.8).bevelBox(0, wallTop + 1.45, 0.3, 6.6, 0.7, 8.4, 0.2);
    b.pop();
  }

  // ---- open ceiling lattice: thin concentric rings + secondary mullions (≈ 90 % open), gold oculus ring
  b.light(1, 0);
  for (const f of [0.3, 0.52, 0.74]) {
    const a = f * Math.PI * 0.5;
    const r = oculus + (Rr - oculus) * Math.cos(a), y = wallTop + (H - wallTop) * Math.sin(a);
    b.paint(KING.whiteGold, 0, 0.6).lathe(0, 0, [[r + 0.8, y - 0.9], [r + 0.8, y + 0.9], [r - 0.8, y + 0.9], [r - 0.8, y - 0.9]], SEG, { closed: true });
    b.dress(0, 0).paint(KING.light, 0.9).lathe(0, 0, [[r - 0.82, y + 0.12], [r - 0.82, y - 0.12]], SEG);
    b.dress(0, 1);
  }
  b.paint(KING.gold, 0, 0.85).lathe(0, 0, [[oculus + 1.6, H - 1.7], [oculus + 1.6, H + 1.7], [oculus - 1.6, H + 1.7], [oculus - 1.6, H - 1.7]], 72, { closed: true });
  b.dress(0, 0).paint(KING.light, 1.7).lathe(0, 0, [[oculus - 1.62, H + 0.5], [oculus - 1.62, H - 0.5]], 72);
  b.dress(0, 1);
  for (let i = 0; i < bays; i++) {
    const a = (i / bays) * TAU;
    const ca = Math.cos(a), sa = -Math.sin(a);
    const frames: Frame[] = [];
    for (let k = 0; k <= 14; k++) {
      const u = (k / 14) * 0.74 * Math.PI * 0.5;
      const r = oculus + (Rr - oculus) * Math.cos(u), y = wallTop + (H - wallTop) * Math.sin(u);
      frames.push({ p: [ca * r, y, sa * r], side: [-sa, 0, ca], up: [0, 1, 0], w: 0.9, d: 1.1 });
    }
    b.paint(KING.whiteGold, 0, 0.55).sweep(frames);
  }

  // ---- the shaft: fluted walls falling away in bands with receding rings of light
  const depth = 620;
  for (let k = 0; k < 9; k++) {
    const yb = -7 - ((k + 1) / 9) * depth, yt = -7 - (k / 9) * depth;
    b.light(0.16, 0.2).paint(k % 2 ? KING.black : KING.blackDeep, 0, 1).lathe(0, 0, [[shaft, yt], [shaft, yb]], 96);
    b.dress(0, 0).paint(KING.channel, 1.2 - k * 0.09).lathe(0, 0, [[shaft - 0.05, yt - 2.6], [shaft - 0.05, yt - 3.3]], 96);
    b.dress(0, 1);
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    atWall(a, shaft - 0.9, -7 - depth / 2).light(0.16, 0.2).paint(KING.black, 0, 1.25).box(0, 0, 0, 2.6, depth, 1.9, { noTop: true, noBottom: true }).pop();
  }

  // ---- broken bridges. Even diagonals: long spans at gallery height, snapped in mid-air. Odd: floor stubs.
  const span = (a: number, y: number, from: number, to: number, w: number, trussed: boolean): void => {
    const len = from - to;
    b.push().rotateY(a).translate((from + to) / 2, y, 0);
    b.light(0.5, 0.2).paint(KING.whiteGold, 0, 0.56).box(0, -1.4, 0, len, 2.8, w);
    b.dress(0, 0).paint(KING.channel, 0.9).box(len * 0.12, 0.03, 0, len * 0.76, 0.06, 0.34);
    b.dress(0, 1);
    for (const s of [-1, 1]) {
      b.paint(KING.whiteGold, 0, 0.62).box(0, 0.65, s * (w / 2 - 0.2), len, 1.3, 0.4);
      b.paint(KING.gold, 0, 0.75).box(0, 1.36, s * (w / 2 - 0.2), len, 0.12, 0.5);
      b.light(0.3, 0.25).paint(KING.whiteGold, 0, 0.44).box(0, -3.4, s * (w / 2 - 0.9), len, 1.6, 0.8);
    }
    if (trussed) {
      // pointed-arch web under the deck, one per bay; the bay nearest the break has lost its far springing
      const nb = Math.max(2, Math.round(len / 20));
      const bay = len / nb;
      for (let i = 0; i < nb; i++) {
        const cx = len / 2 - (i + 0.5) * bay;
        for (const s of [-1, 1]) {
          b.push().translate(cx, -4.2, s * (w / 2 - 0.9)).rotateY(s > 0 ? 0 : Math.PI);
          b.paint(KING.whiteGold, 0, 0.46);
          archPanel(b, { x0: -bay / 2, x1: bay / 2, y0: -bay * 0.42, y1: 0, z: 0.4, depth: 0.8, pier: 0.7, spring: 0.12, crown: 0.7, segs: 5, front: [0.3, 0.25], inside: [0.1, 0.3] });
          b.pop();
        }
        if (i > 0) b.light(0.3, 0.25).paint(KING.whiteGold, 0, 0.42).box(len / 2 - i * bay, -4.6 - bay * 0.2, 0, 1.2, bay * 0.4 + 1, w - 1.4);
      }
      // lower chord tying the hangers together: each bay is a framed panel with a pointed opening
      for (const s of [-1, 1]) b.light(0.3, 0.25).paint(KING.whiteGold, 0, 0.44).box(0, -4.2 - bay * 0.42 - 0.3, s * (w / 2 - 0.9), len, 0.7, 0.9);
      // corbel where the span leaves the gallery
      b.light(0.3, 0.3).paint(KING.whiteGold, 0, 0.5).box(len / 2 - 3.5, -7.5, 0, 7, 9.5, w + 1.6, { top: [1, 1], shift: [0, 0] });
      b.paint(KING.gold, 0, 0.75).bevelBox(len / 2 - 3.5, -2.9, 0, 7.4, 0.5, w + 2, 0.15);
    }
    // the torn end: stepped broken slabs, bent reinforcement, plates hanging by a thread
    const ex = -len / 2;
    b.light(0.4, 0.15);
    for (let j = 0; j < 4; j++) {
      const zc = -w / 2 + (j + 0.5) * (w / 4);
      const l = 1.2 + rand() * 5.5;
      b.paint(KING.whiteGold, 0, 0.5).box(ex - l / 2, -1.5 - rand() * 0.3, zc, l, 2.4 - rand() * 0.8, w / 4 - 0.15, { top: [0.6 + rand() * 0.4, 1], shift: [rand() * 0.8, 0] });
    }
    for (let j = 0; j < 9; j++) {
      const zc = (rand() - 0.5) * (w - 0.8), l = 3 + rand() * 7, sag = 2 + rand() * 7;
      b.paint(KING.blackDeep, 0, 1.4).tube([[ex + 1, -1.2, zc], [ex - l * 0.45, -1.4 - sag * 0.15, zc + (rand() - 0.5)], [ex - l * 0.8, -1.6 - sag * 0.6, zc + (rand() - 0.5) * 2], [ex - l, -1.8 - sag, zc + (rand() - 0.5) * 3]], 0.16, 5);
    }
    for (let j = 0; j < 5; j++) {
      const px = ex - 1.5 - rand() * 6, py = -4 - rand() * 9, pz = (rand() - 0.5) * w;
      b.push().translate(px, py, pz).rotateX(rand() * 2).rotateZ(rand() * 2);
      b.paint(KING.whiteGold, 0, 0.42).bevelBox(0, 0, 0, 1.2 + rand() * 2.6, 0.35, 0.9 + rand() * 2.2, 0.08);
      b.pop();
      b.paint(KING.blackDeep, 0, 1.4).tube([[ex - 0.5, -1.8, pz * 0.6], [px, py + 0.2, pz]], 0.07, 4, false);
    }
    b.pop();
    const lx = Math.cos(a) * (to + 1.5), lz = -Math.sin(a) * (to + 1.5);
    cards.point(lx, y + 0.5, lz, 1.3, 0xffb070, 2.2).point(lx, y - 3, lz, 5, 0xff9050, 0.5);
  };
  for (let i = 0; i < 8; i++) {
    const a = (22.5 + i * 45) * (Math.PI / 180);
    if (i % 2 === 0) {
      const level = Math.min(tiers, 1 + ((i / 2) % 2));
      const reach = 58 + rand() * 34;
      span(a, level * tierH - 0.35, inner + 0.6, Math.max(inner - reach, 40), 7.2, true);
    } else {
      span(a, 0, shaft + 3, Math.max(shaft - 9 - rand() * 12, 34), 6.4, false);
    }
  }

  // ---- exterior spires seen through the ceiling (their distance scales with the shell)
  const k = Math.max(1, R / 150);
  const towers: Array<[number, number, number, number, SpireStyle]> = [
    [-300, -210, 380, 20, 'cluster'], [-120, -400, 470, 23, 'needle'], [210, -330, 350, 18, 'blade'], [-390, 110, 440, 22, 'stepped'],
    [140, 360, 400, 20, 'needle'], [390, 190, 360, 18, 'cluster'], [-230, 330, 330, 17, 'blade'],
  ];
  for (const [x, z, h, r, style] of towers) {
    addSpire(b, cards, { x: x * k, y: -60, z: z * k, h: h + 60, r, tone: rand() < 0.5 ? 'white' : 'mixed', rand, detail: 2, style, rot: Math.atan2(x, z) });
  }
  // the clip tower: built here up to the collar; the needle above it is its own mesh (the carrier shears it)
  const cx = CLIP_TOWER.x, cz = CLIP_TOWER.z, cut = CLIP_TOWER.cut, top = CLIP_TOWER.top;
  const rot = Math.atan2(cx, cz) + Math.PI / 4;
  const shaftR = (y: number): number => clipTowerRadius(y);
  b.light(1, 0).dress(0, 1).paint(KING.whiteGold, 0, 0.58).prism(cx, -60, cz, 40, 46, 42, 4, { rot });
  b.dress(0.8, 1).paint(KING.whiteGold, 0, 0.6).prism(cx, 40, cz, 120, 34, 30, 8, { rot });
  b.dress(0.3, 1).paint(KING.whiteGold, 0, 0.6).prism(cx, 120, cz, 236, 26, shaftR(236) * 1.15, 4, { rot });
  b.dress(0, 1).paint(KING.gold, 0, 0.8).prism(cx, 236, cz, 241, shaftR(236) * 1.3, shaftR(236) * 1.25, 4, { rot });
  b.dress(0.2, 1).paint(KING.whiteGold, 0, 0.62).prism(cx, 241, cz, cut, shaftR(241), shaftR(cut), 4, { rot });
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 2;
    const fx = cx + Math.cos(a) * 36, fz = cz - Math.sin(a) * 36;
    b.paint(KING.whiteGold, 0, 0.55).prism(fx, 40, fz, 170, 9, 5, 4, { rot }).prism(fx, 170, fz, 215, 5, 0, 4, { rot });
    b.paint(KING.gold, 0, 0.75).prism(fx, 170, fz, 172, 6.2, 6, 4, { rot });
    const px = cx + Math.cos(a) * shaftR(241) * 1.1, pz = cz - Math.sin(a) * shaftR(241) * 1.1;
    b.paint(KING.whiteGold, 0, 0.6).prism(px, 241, pz, 276, 2.6, 0, 4, { rot });
    // light seams down the shaft faces
    const sa = a - Math.PI / 4;
    const sr = shaftR(310) * 0.7072 + 0.3;
    b.push().translate(cx + Math.cos(sa) * sr, 316, cz - Math.sin(sa) * sr).rotateY(sa);
    b.dress(0, 0).paint(KING.light, 1.3).box(0, 0, 0, 0.6, 120, 0.9);
    b.pop().dress(0, 1);
  }
  for (let i = 0; i < 14; i++) {
    const a = rand() * TAU;
    cards.point(cx + Math.cos(a) * 34, 44 + rand() * 70, cz + Math.sin(a) * 34, 2, KING.light, 3 + rand() * 2);
  }

  // the needle (shell-local frame; origin at the collar)
  const tb = new GeoBuilder();
  tb.light(1, 0).paint(KING.gold, 0, 0.8).prism(0, 0, 0, 2.6, CLIP_TOWER.cutRadius * 1.25, CLIP_TOWER.cutRadius * 1.15, 4, { rot });
  tb.dress(0.15, 1).paint(KING.whiteGold, 0, 0.62).prism(0, 2.6, 0, top - cut - 6, CLIP_TOWER.cutRadius, 1.5, 4, { rot });
  tb.dress(0, 1).paint(KING.gold, 0, 0.8).prism(0, top - cut - 6, 0, top - cut - 5.2, 2.1, 2.0, 4, { rot });
  tb.paint(KING.whiteGold, 0, 0.62).prism(0, top - cut - 5.2, 0, top - cut, 1.4, 0, 4, { rot });
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 2;
    tb.paint(KING.whiteGold, 0, 0.6).prism(Math.cos(a) * CLIP_TOWER.cutRadius * 0.95, 2.6, -Math.sin(a) * CLIP_TOWER.cutRadius * 0.95, 13, 1.3, 0, 4, { rot });
  }
  tb.dress(0, 0).paint(KING.white, 3.2).prism(0, top - cut - 0.2, 0, top - cut + 2.2, 1.0, 0.25, 6);

  const group = new THREE.Group();
  group.name = 'scenic:atriumShell';
  const material = createScenicMaterial(shared, {
    name: 'ScenicAtrium', panel: [12, 7.3], panelTone: 0.14, panelSeam: 0.3, gloss: 0.5, haze: 0.4, lowHaze: 1, lowStart: -30, lowDepth: 420,
    lamp: [0.34, 0.27, 0.19], shade: 0.5, windows: [3.4, 8.2, 1.4],
  });
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.name = 'scenic:atriumShell:structure';
  mesh.frustumCulled = false;
  const tip = new THREE.Mesh(tb.build(), material);
  tip.name = 'scenic:atriumShell:clipTip';
  tip.position.set(cx, cut, cz);
  tip.frustumCulled = false;
  tips.set(tip);
  const lights = cards.build(shared, { name: 'scenic:atriumShell:lights', haze: 0.4 });
  lights.frustumCulled = false;
  group.add(mesh, tip, lights);
  group.userData.scenic = { kind: 'atriumShell', triangles: b.triangleCount + tb.triangleCount, lights: cards.count };
  return group;
}
