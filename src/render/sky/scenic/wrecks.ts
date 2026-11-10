/**
 * Wrecks — a crashed dropship hull section (Z00 / Z03 start dressing), built to be walked up to.
 *
 * A fuselage barrel lying where it stopped: smooth outer skin gashed open along one shoulder with torn, peeled
 * edges; the structure it was hiding — ring frames (some snapped), stringers bent out of the break, a buckled
 * deck, hanging cable; a shed nacelle or thruster pod thrown clear; armour and plating scattered down the gouge
 * it ploughed; soft-edged scorch on the ground; light strips that are failing.
 * Near-field PBR split by material role (shared library materials when available). ≤ 9 draw calls.
 */
import * as THREE from 'three';
import type { Game } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { GeoBuilder, type Frame, type P2, type P3 } from './geo';
import { HULL_ROLES, PartSink, paletteFor, type HullRole } from './hulls';
import { num, seedOf } from './opts';
import type { ShipMaterials } from './ships';

type Faction = 'dominion' | 'reformation';

const RECT: readonly P2[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
const N = 22; // points around the barrel section

/** Soft-edged scorch: a ragged disc whose vertex alpha falls to nothing at the rim (no hard polygon outline). */
function scorchDecals(rand: () => number, marks: Array<[x: number, z: number, r: number, a: number]>): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const SEG = 18;
  let lift = 0.012;
  for (const [x, z, r, alpha] of marks) {
    const base = pos.length / 3;
    pos.push(x, lift, z);
    col.push(0, 0, 0, alpha);
    const stretch = 0.7 + rand() * 0.9, rot = rand() * Math.PI;
    const rr: number[] = [];
    for (let i = 0; i < SEG; i++) rr.push(r * (0.72 + rand() * 0.5));
    for (let ring = 1; ring <= 2; ring++) {
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const k = ring === 1 ? 0.52 : 1;
        const lx = Math.cos(a) * rr[i] * k * stretch, lz = Math.sin(a) * rr[i] * k;
        pos.push(x + lx * Math.cos(rot) - lz * Math.sin(rot), lift, z + lx * Math.sin(rot) + lz * Math.cos(rot));
        col.push(0, 0, 0, ring === 1 ? alpha * (0.6 + rand() * 0.3) : 0);
      }
    }
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      idx.push(base, base + 1 + j, base + 1 + i);
      idx.push(base + 1 + i, base + 1 + j, base + 1 + SEG + j, base + 1 + i, base + 1 + SEG + j, base + 1 + SEG + i);
    }
    lift += 0.0015; // overlapping marks never z-fight
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function buildWreck(mats: ShipMaterials, game: Game, faction: Faction, scale?: number, seed?: number): THREE.Object3D {
  const rand = mulberry32(seedOf(seed) ^ (faction === 'dominion' ? 0xd03 : 0x4ef));
  const sink = PartSink.split(paletteFor(faction === 'dominion' ? 'dominionShuttle' : 'reformationTransport'));
  const ground = new GeoBuilder(); // gouge berm + rubble (its own material)
  const dom = faction === 'dominion';
  const W = dom ? 3.0 : 3.2, H = dom ? 2.2 : 2.25; // half width / half height of the barrel
  const LEN = 13;
  const roll = dom ? 0.2 : -0.16, pitch = dom ? -0.13 : -0.09, liftY = H * 0.74;

  /** barrel section at z, scaled by k: a rounded hull for the Dominion craft, a chamfered module for the other */
  const ringAt = (z: number, k: number): P3[] => {
    const pts: P3[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2; // start at the keel, counter-clockwise seen from +Z
      const cx = Math.cos(a), sy = Math.sin(a);
      const e = dom ? 0.8 : 0.42; // superellipse exponent: lower = boxier
      const px = Math.sign(cx) * Math.pow(Math.abs(cx), e) * W * (dom && sy < 0 ? 0.86 : 1);
      const py = Math.sign(sy) * Math.pow(Math.abs(sy), e) * H * (dom && sy < 0 ? 1.08 : 0.95);
      pts.push([px * k, py * k, z]);
    }
    return pts;
  };
  const stations = [-LEN / 2, -LEN / 3, -LEN / 8, LEN / 8, LEN / 3, LEN / 2];
  const taper = (z: number): number => 1 - 0.1 * Math.max(0, -z / (LEN / 2));
  // the gash: ring indices i0..i1 of skin are gone (the roof, leaning to one shoulder), wider toward the torn rear
  const gash = (s: number): [number, number] => {
    const t = s / (stations.length - 1);
    return [9.6 - 1.5 * t, 12.4 + 1.7 * t];
  };

  sink.push().translate(0, liftY, 0).rotateZ(roll).rotateX(pitch);

  // ---- skin: two open strips either side of the gash, with a ragged rear edge; inner lining behind them
  const jag = (p: P3, amt: number): P3 => [p[0], p[1], p[2] + (rand() - 0.5) * amt];
  const strip = (from: (s: number) => number, to: (s: number) => number, kOuter: number, inward: boolean): P3[][] => {
    const n = 16;
    return stations.map((z, s) => {
      const ring = ringAt(z, taper(z) * kOuter);
      const a = from(s), b2 = to(s);
      const out: P3[] = [];
      for (let j = 0; j <= n; j++) {
        const f = a + ((b2 - a) * j) / n;
        const i0 = Math.floor(f), t = f - i0;
        const p = ring[((i0 % N) + N) % N], q = ring[(((i0 + 1) % N) + N) % N];
        let pt: P3 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2]];
        if (s === stations.length - 1) pt = jag(pt, 2.4);
        else if (s === 0) pt = jag(pt, 0.5);
        // the lips of the gash curl outward
        if ((j === 0 || j === n) && !inward) pt = [pt[0] * 1.03, pt[1] * 1.05, pt[2]];
        out.push(pt);
      }
      return inward ? out.reverse() : out;
    });
  };
  // ringAt runs counter-clockwise seen from +Z = clockwise looking from the first station (−Z end) toward the
  // last, so outward-facing strips are fed reversed
  const lower = (s: number): number => gash(s)[1] - N;       // from the gash's far lip, round the keel…
  const upper = (s: number): number => gash(s)[0];           // …to its near lip
  sink.p('hull').skin(strip(lower, upper, 1, false).map((r) => [...r].reverse()), { open: true });
  sink.p('accent').skin(strip(lower, upper, 0.94, true).map((r) => [...r].reverse()), { open: true });
  // the tear itself: ragged tongues of skin left standing along both lips of the gash, bent out by the blast
  for (let s = 0; s < stations.length - 1; s++) {
    for (const lip of [0, 1]) {
      for (let k = 0; k < 2; k++) {
        if (rand() < 0.25) continue;
        const t0 = k / 2 + rand() * 0.12, t1 = t0 + 0.2 + rand() * 0.22;
        const at = (t: number): P3 => {
          const z = stations[s] + (stations[s + 1] - stations[s]) * t;
          const g0 = gash(s)[lip], g1 = gash(s + 1)[lip];
          const f = g0 + (g1 - g0) * t;
          const ring = ringAt(z, taper(z) * 1.01);
          const i0 = Math.floor(f), u = f - i0;
          const p = ring[i0 % N], q = ring[(i0 + 1) % N];
          return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, z];
        };
        const a = at(t0), c = at(Math.min(t1, 1));
        const dir = lip === 0 ? 1 : -1;
        const top = (p: P3, h: number, out: number): P3 => [p[0] + dir * out + (rand() - 0.5) * 0.2, p[1] + h, p[2] + (rand() - 0.5) * 0.4];
        const ta = top(a, 0.12 + rand() * 0.4, 0.1 + rand() * 0.5), tc = top(c, 0.1 + rand() * 0.3, 0.15 + rand() * 0.6);
        sink.p('hull', 0.8).poly([a, c, tc, ta]).poly([ta, tc, c, a]);
      }
    }
  }
  if (!dom) {
    // the module's exterior frames (the transport's signature), still standing proud of the skin
    for (let i = 0; i < 5; i++) {
      const z = -LEN / 2 + 1.6 + i * 2.5;
      const ring = ringAt(z, taper(z) * 1.03);
      const g = gash((i / 4) * (stations.length - 1));
      const frames: Frame[] = [];
      for (let j = Math.ceil(g[1]) - N; j <= Math.floor(g[0]); j++) {
        const p = ring[((j % N) + N) % N];
        const l = Math.hypot(p[0], p[1]) || 1;
        frames.push({ p: [p[0], p[1], z], side: [0, 0, 1], up: [p[0] / l, p[1] / l, 0], w: 0.22, d: 0.16 });
      }
      sink.p('metal').sweepProfile(frames, RECT, { caps: true });
    }
  }
  // nose bulkhead, crumpled inward
  const nose = ringAt(stations[0] + 0.3, taper(stations[0]) * 0.96);
  sink.p('accent').poly(nose.map((p): P3 => [p[0], p[1], p[2] + (rand() - 0.5) * 0.5]));

  // ---- ring frames (complete even where the skin is gone; two are snapped) and a keel beam
  for (let i = 0; i < 6; i++) {
    const z = -LEN / 2 + 0.9 + (i * (LEN - 1.8)) / 5;
    const ring = ringAt(z, taper(z) * 0.93);
    const snapped = i === 4 || (i === 2 && rand() < 0.7);
    const g = gash((i / 5) * (stations.length - 1));
    const g0 = Math.floor(g[0]), g1 = Math.ceil(g[1]);
    const frames: Frame[] = [];
    const count = snapped ? N - (g1 - g0) - 1 : N;
    const start = snapped ? g1 + 1 : 0;
    for (let j = 0; j <= count; j++) {
      const p = ring[(start + j) % N];
      const l = Math.hypot(p[0], p[1]) || 1;
      frames.push({ p: [p[0], p[1], z], side: [0, 0, 1], up: [p[0] / l, p[1] / l, 0], w: 0.2, d: 0.34 });
    }
    sink.p('metal').sweepProfile(frames, RECT, { caps: true });
    if (snapped) {
      // the snapped end bends away from the break
      const p = ring[(start + count) % N];
      sink.p('metal').tube([[p[0], p[1], z], [p[0] * 1.08, p[1] * 1.12, z + 0.3], [p[0] * 1.3, p[1] * 1.2 + 0.2, z + 0.9]], [0.11, 0.09, 0.06], 6);
    }
  }
  sink.p('metal').bevelBox(0, -H * 0.86, 0, 0.5, 0.3, LEN * 0.94, 0.05);
  // ---- stringers: straight inside, bent out of the torn rear
  for (const i of [2, 5, 8, 14, 17, 20]) {
    const a = ringAt(-LEN / 2 + 0.5, taper(-LEN / 2) * 0.91)[i], c = ringAt(LEN / 2 - 1.2, 0.91)[i];
    const bend = 0.8 + rand() * 1.6;
    sink.p('dark').tube([a, c, [c[0] * (1 + rand() * 0.25), c[1] * (1 + rand() * 0.3) + 0.2, c[2] + bend], [c[0] * (1.1 + rand() * 0.5), c[1] * 1.2 + (rand() - 0.3), c[2] + bend * 1.7]], [0.06, 0.06, 0.05, 0.035], 6);
  }
  // ---- buckled deck with tread strips, two wrenched benches, a dead console
  sink.push().translate(0, -H * 0.56, 0);
  for (let i = 0; i < 4; i++) {
    sink.push().translate(0, (rand() - 0.5) * 0.14, -LEN / 2 + 1.8 + i * 3.0).rotateX((rand() - 0.5) * 0.14).rotateZ((rand() - 0.5) * 0.1);
    sink.p('hull', 0.7).bevelBox(0, 0, 0, W * 1.5, 0.1, 2.9, 0.03);
    for (let k = 0; k < 5; k++) sink.p('dark').box(0, 0.06, -1.1 + k * 0.55, W * 1.3, 0.02, 0.12);
    sink.pop();
  }
  for (const sx of [-1, 1]) {
    sink.push().translate(sx * W * 0.62, 0.42, -1 + sx * 1.6).rotateZ(sx * (0.15 + rand() * 0.5)).rotateY((rand() - 0.5) * 0.4);
    sink.p('accent').bevelBox(0, 0, 0, 0.55, 0.14, 3.4, 0.05);
    sink.p('dark').bevelBox(sx * 0.24, 0.45, 0, 0.1, 0.9, 3.4, 0.04);
    for (const z of [-1.4, 1.4]) sink.p('metal').tube([[0, -0.05, z], [0, -0.42, z]], 0.04, 5);
    sink.pop();
  }
  sink.p('dark').bevelBox(-W * 0.45, 0.6, -LEN / 2 + 0.9, 1.3, 1.0, 0.5, 0.06);
  sink.p('glow').box(-W * 0.45, 0.7, -LEN / 2 + 1.17, 0.9, 0.4, 0.03);
  sink.pop();
  // ---- hanging cable loom from the frames
  for (let i = 0; i < 6; i++) {
    const z = -LEN / 2 + 1.5 + rand() * (LEN - 3), x = (rand() - 0.5) * W * 1.2, sag = 0.8 + rand() * 1.8;
    sink.p('dark').tube([[x, H * 0.8, z], [x + (rand() - 0.5) * 0.4, H * 0.8 - sag * 0.6, z + 0.3], [x + (rand() - 0.5) * 0.8, H * 0.8 - sag, z + 0.5 + rand()]], 0.03, 5, false);
  }
  // ---- what is left of the outside: armour / panels (some missing), failing light strips
  for (let i = 0; i < 8; i++) {
    const z = -LEN / 2 + 1.0 + i * 1.45;
    for (const sx of [-1, 1]) {
      if (rand() < 0.3 || (sx > 0 && i > 4)) continue;
      const ring = ringAt(z, taper(z) * 1.02);
      const p = ring[sx > 0 ? 3 : N - 3];
      sink.push().translate(p[0], p[1] + 0.1, z).rotateZ(sx * 0.12 + (rand() - 0.5) * 0.1).rotateX((rand() - 0.5) * 0.08);
      sink.p(dom ? 'accent' : 'hull', 0.9 + rand() * 0.25).bevelBox(0, 0, 0, 0.16, H * (0.9 + rand() * 0.4), 1.3, 0.05);
      sink.pop();
    }
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      if (rand() > 0.75) continue;
      const z = -LEN / 2 + 2.2 + i * 3.6;
      const p = ringAt(z, taper(z) * 1.012)[sx > 0 ? 5 : N - 5];
      sink.p('glow').box(p[0], p[1], z, 0.06, 0.1, 2.4);
    }
  }
  // ---- torn-off root: a wing stub (Dominion) / an outrigger truss with its strut ends (Reformation)
  if (dom) {
    sink.push().translate(-W * 0.98, 0.4, 0.8).rotateZ(0.52);
    const stub: P3[][] = [
      [[-0.2, -0.24, 2.4], [-0.2, 0.24, 2.4], [-0.2, 0.24, -2.4], [-0.2, -0.24, -2.4]],
      [[-3.6, -0.12, 1.6 + rand()], [-3.6, 0.12, 2.0], [-3.9 - rand(), 0.12, -1.2], [-3.4, -0.12, -1.6]],
    ];
    sink.p('hull', 0.9).loft(stub.map((r) => [...r].reverse()));
    sink.p('metal').tube([[-0.2, 0, -2.4], [-3.5, 0, -1.5]], 0.07, 6);
    for (let i = 0; i < 4; i++) sink.p('dark').tube([[-3.6, 0, -1 + i * 0.8], [-4.2 - rand() * 0.6, (rand() - 0.5) * 0.8, -1 + i * 0.8 + (rand() - 0.5)]], 0.035, 5);
    sink.pop();
  } else {
    sink.p('metal').tube([[W, H * 0.6, 1], [W + 1.4, H * 0.75, 1.1], [W + 2.6, H * 0.35, 1.5]], [0.18, 0.16, 0.1], 8);
    sink.p('dark').tube([[W, H * 0.1, 1.5], [W + 1.6, H * 0.5, 1.2]], 0.06, 5);
    for (let i = 0; i < 3; i++) sink.p('dark').tube([[W + 2.6, H * 0.35, 1.5], [W + 3.0 + rand() * 0.5, H * 0.1 + rand() * 0.6, 1.3 + rand() * 0.6]], 0.03, 5);
  }
  sink.pop();

  // ---- thrown clear: a shed nacelle (Dominion) / thruster pod (Reformation), half sunk where it landed
  sink.push().translate(dom ? 6.4 : -6.8, 0.55, dom ? 4.6 : 3.2).rotateY(dom ? 0.9 : -0.6).rotateZ(0.12).rotateX(Math.PI / 2 + 0.08);
  sink.p('dark').cyl(0, -2.6, 0, 1.6, dom ? 0.98 : 0.82, dom ? 1.14 : 0.95, 18, false);
  sink.p('dark', 1.3).lathe(0, 0, [[dom ? 1.14 : 0.95, 1.6], [dom ? 1.28 : 1.1, 2.7], [dom ? 1.14 : 0.98, 2.7], [0.7, 1.8]], 18);
  sink.p('metal').lathe(0, 0, [[0.7, -2.0], [0.94, -2.7], [dom ? 1.06 : 0.9, -2.55], [dom ? 1.0 : 0.84, -2.0]], 18);
  sink.p('dark').box(0, -2.1, 0, 1.3, 0.05, 1.3);
  for (let i = 0; i < 5; i++) sink.p('metal').box(dom ? 1.02 : 0.86, -1.6 + i * 0.7, 0.2, 0.18, 0.07, 0.8);
  sink.p('dark').tube([[0.6, -2.5, 0.5], [0.9, -3.2, 0.9], [1.6, -3.5, 0.6]], 0.05, 5, false);
  sink.pop();

  // ---- the gouge it ploughed: low berms either side of the track, rubble, scattered plating
  for (const sx of [-1, 1]) {
    const rings: P3[][] = [];
    for (let i = 0; i <= 7; i++) {
      const z = 2 + i * 1.9, k = Math.sin(((i + 0.6) / 8.2) * Math.PI);
      const x = sx * (W * 0.95 + 0.5 + i * 0.12 + (rand() - 0.5) * 0.5), h = (0.28 + rand() * 0.3) * k + 0.03, w = (0.8 + rand() * 0.5) * k + 0.1;
      const ring: P3[] = [[x - sx * w, 0, z], [x - sx * w * 0.3, h, z + (rand() - 0.5) * 0.3], [x + sx * w * 0.5, h * 0.7, z], [x + sx * w * 1.3, 0, z]];
      rings.push(ring);
    }
    ground.skin(sx > 0 ? rings : rings.map((r) => [...r].reverse()), { open: true });
  }
  for (let i = 0; i < 22; i++) {
    const z = -1 + rand() * 16, x = (rand() < 0.5 ? -1 : 1) * (W * 0.7 + rand() * 4.5), sz = 0.12 + rand() * rand() * 0.6;
    ground.push().translate(x, sz * 0.3, z).rotateY(rand() * 6.28).rotateX(rand()).rotateZ(rand());
    ground.bevelBox(0, 0, 0, sz * (1 + rand()), sz * 0.7, sz * (1 + rand()), sz * 0.16);
    ground.pop();
  }
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2, d = W + 1.4 + rand() * 7;
    sink.push().translate(Math.cos(a) * d * 0.9, 0.06 + rand() * 0.2, Math.sin(a) * d * 1.2 + 2).rotateY(rand() * 6.28).rotateX((rand() - 0.5) * 0.7).rotateZ((rand() - 0.5) * 0.7);
    sink.p(rand() < 0.5 ? 'hull' : dom ? 'accent' : 'metal', 0.8).bevelBox(0, 0, 0, 0.5 + rand() * 1.7, 0.07, 0.4 + rand() * 1.3, 0.025);
    sink.pop();
  }

  // ---- assemble: hull parts by role, the ground mound, soft scorch decals
  const group = new THREE.Group();
  group.name = `scenic:wreck:${faction}`;
  let tris = 0;
  for (const role of HULL_ROLES) {
    const b = sink.builder(role);
    if (b.triangleCount === 0) continue;
    const mesh = new THREE.Mesh(b.build(true), role === 'glow' ? mats.dyingGlow(faction) : mats.get(faction, role as HullRole));
    mesh.name = `scenic:wreck:${faction}:${role}`;
    mesh.castShadow = mesh.receiveShadow = role !== 'glow';
    tris += b.triangleCount;
    group.add(mesh);
  }
  let rubble: THREE.Material | null = null;
  try {
    const m = game.mats && !isStub(game.mats) ? game.mats.get('rubble') : null;
    rubble = m && !isStub(m) && (m as THREE.Material).isMaterial ? m : null;
  } catch {
    rubble = null;
  }
  const mound = new THREE.Mesh(ground.build(true), rubble ?? mats.ground());
  mound.name = `scenic:wreck:${faction}:ground`;
  mound.castShadow = mound.receiveShadow = true;
  const marks: Array<[number, number, number, number]> = [[0, 1.5, 5.5, 0.82], [0, 8, 4.2, 0.7], [dom ? 6.4 : -6.8, dom ? 4.6 : 3.2, 2.6, 0.75]];
  for (let i = 0; i < 6; i++) marks.push([(rand() - 0.5) * 11, -3 + rand() * 17, 0.8 + rand() * 1.8, 0.4 + rand() * 0.35]);
  const decals = new THREE.Mesh(scorchDecals(rand, marks), mats.scorch());
  decals.name = `scenic:wreck:${faction}:scorch`;
  decals.renderOrder = 1;
  group.add(mound, decals);
  tris += ground.triangleCount + (decals.geometry.index ? decals.geometry.index.count / 3 : 0);
  group.userData.scenic = { kind: `wreck:${faction}`, triangles: tris };
  group.scale.setScalar(num(scale, 1, 0.05, 20));
  return group;
}
