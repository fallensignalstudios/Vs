/**
 * Ancient-space anchors:
 *  - weaverAnchor: an Eclipse growth node gripping the structure it feeds on. It has taken a broken King-era
 *    pier stub: tissue climbs one side of the pale stone, a caged bulb sits on the break, and flat roots run
 *    out along the floor in the straight, angular lines of the channels they follow. Deliberately lopsided
 *    and rooted — a growth ON a thing, never a creature. Everything about it moves on the shared cadence; when
 *    it dies the growth dissolves and the clean pier is left standing.
 *  - frostAnchor: a frost-rimed King-era floor node with a pale ring — a place to stand. Low, quiet, open
 *    toward the approach, flanked by two slender markers so it reads from across a court.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { FrostAnchorVisual } from '@/core/api/creatures';
import { clamp01, damp, smoothstep } from '@/core/mathx';
import { impact, keys, noise1, rot, move } from '../core/anim';
import type { ActionDef } from '../core/base';
import { along, arcPath, band, blob, box, cyl, deform, prism, shard, sphere, T, torus, tube, type Pt3 } from '../core/geo';
import { P, tint } from '../core/palette';
import { addPlate, bladeOutline, facing } from '../core/plates';
import { getTemplate, RigBuilder, type RigTemplate } from '../core/rig';
import { DEVICE_ACTIONS, DEVICE_ALIASES, DeviceBase } from './base';

// =========================================================================================================
// weaver anchor
// =========================================================================================================
const WG = { core: 1, nodes: 2, channel: 3 } as const;

/** floor roots: straight runs with channel-like bends, different lengths, all on the growth's side of the pier */
const ROOT_PATHS: Pt3[][] = [
  [[0.24, 0, 0.14], [0.62, 0, 0.14], [0.92, 0, 0.44], [1.3, 0, 0.44]],
  [[0.12, 0, 0.27], [0.12, 0, 0.72], [-0.18, 0, 1.02]],
  [[0.25, 0, -0.08], [0.56, 0, -0.39], [0.56, 0, -0.86]],
  [[-0.06, 0, 0.27], [-0.4, 0, 0.61], [-0.78, 0, 0.61]],
  [[0.28, 0, 0.02], [0.5, 0, 0.02], [0.74, 0, -0.1]],
];
const ROOT_R = [0.074, 0.064, 0.06, 0.052, 0.046];
const BULB: Pt3 = [0.05, 0.9, 0.03];
const CAGE_AT: Pt3[] = [[0.25, 0.76, 0.07], [0.0, 0.76, 0.24], [-0.16, 0.76, -0.02], [0.08, 0.76, -0.18]];
const K_SWELL = [0, 0, 0.26, 1, 0.34, 0];
const K_WITHER = [0.3, 0, 1.6, 1];
const K_BURST = [0, 1, 0.26, 6, 0.36, 0];

/** a root path sampled densely: each straight run keeps its direction, corners are tight */
function rootPath(i: number): Pt3[] {
  const src = ROOT_PATHS[i]!;
  const out: Pt3[] = [];
  for (let k = 0; k < src.length - 1; k++) {
    const a = src[k]!, c = src[k + 1]!;
    for (let j = 0; j < 4; j++) out.push([a[0] + (c[0] - a[0]) * (j / 4), 0.075, a[2] + (c[2] - a[2]) * (j / 4)]);
  }
  const last = src[src.length - 1]!;
  out.push([last[0], 0.075, last[2]]);
  return out;
}

function buildWeaverAnchor(): RigTemplate {
  const b = new RigBuilder();
  b.bone('base', null, [0, 0, 0]);
  b.bone('mass', 'base', [0.14, 0.34, 0.12]);
  b.bone('bulb', 'base', BULB);
  CAGE_AT.forEach((p, i) => b.bone('cage' + i, 'base', p));
  ROOT_PATHS.forEach((path, i) => {
    b.bone(`r${i}_0`, 'base', [path[0]![0], 0.05, path[0]![2]]);
    b.bone(`r${i}_1`, `r${i}_0`, [path[1]![0], 0.05, path[1]![2]]);
  });

  // ---- the structure it grips: a broken King-era pier stub on its footing (kept when the growth dissolves)
  const keep = { keep: true } as const;
  b.add('base', P.blackStone, cyl(0.4, 0.38, 0.07, 8, 0.012, Math.PI / 8), T(0, 0.035, 0), keep);
  b.add('base', P.gold, band(0.345, 0.03, 0.078, 8, 0.006, Math.PI * 2, Math.PI / 8), T(0, 0.04, 0), keep);
  b.add('base', P.whiteGold, cyl(0.27, 0.25, 0.5, 8, 0.02, Math.PI / 8), T(0, 0.32, 0), { ...keep, crease: 40 });
  b.add('base', P.gold, band(0.268, 0.02, 0.035, 8, 0.006, Math.PI * 2, Math.PI / 8), T(0, 0.14, 0), keep);
  b.add('base', P.gold, band(0.258, 0.016, 0.02, 8, 0.004, Math.PI * 2, Math.PI / 8), T(0, 0.47, 0), keep);
  // the break: jagged remnants of the shaft, highest on the clean side
  b.add('base', P.whiteGold, shard(0.34, 0.24, 0.16, 341, 5, 0.42), along([-0.13, 0.52, -0.1], [-0.17, 0.86, -0.13]), { ...keep, crease: 30 });
  b.add('base', P.ivoryWorn, shard(0.22, 0.2, 0.14, 342, 5, 0.5), along([-0.02, 0.52, -0.17], [0.0, 0.74, -0.2]), { ...keep, crease: 30 });
  b.add('base', P.whiteGold, shard(0.16, 0.18, 0.12, 343, 4, 0.5), along([-0.17, 0.52, 0.08], [-0.22, 0.68, 0.1]), { ...keep, crease: 30 });
  // its light channel still runs up the clean face — the thing being fed on
  b.add('base', tint(P.goldChannel, { e: 1.1 }), box(0.022, 0.4, 0.012, 0.003), T(-0.1, 0.33, -0.243, 0, 0.39, 0), { ...keep, group: WG.channel });
  b.add('base', P.gold, box(0.05, 0.44, 0.008, 0.002), T(-0.1, 0.33, -0.24, 0, 0.39, 0), keep);

  // ---- growth: tissue climbing the +x / +z faces and capping the break
  b.add('mass', P.tissue, blob(0.27, 2, 0.32, 41, [0.9, 1.25, 1.0]), T(0.17, 0.4, 0.14), { crease: 180 });
  b.add('mass', P.tissueWet, blob(0.2, 2, 0.3, 42, [1.2, 0.7, 1.1]), T(0.22, 0.17, 0.2), { crease: 180 });
  b.add('mass', P.tissue, blob(0.21, 2, 0.26, 43, [1.15, 0.55, 1.1]), T(0.06, 0.66, 0.05), { crease: 180 });
  b.add('mass', P.tissueWet, torus(0.15, 0.05, 14, 6), T(BULB[0], 0.76, BULB[2], 0.1, 0, -0.08), { crease: 180 });
  // sinew straps hauling themselves round the shaft
  for (let i = 0; i < 3; i++) {
    const a0 = 0.5 + i * 0.5, y0 = 0.12 + i * 0.14;
    const pts: Pt3[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = a0 - 2.6 * (k / 8), r = 0.27 + 0.03 * Math.sin(k * 1.3 + i);
      pts.push([Math.cos(a) * r, y0 + 0.2 * (k / 8), Math.sin(a) * r]);
    }
    b.add('mass', i === 1 ? P.tissueWet : P.sinew, tube(pts, (t) => 0.03 * (1 - t * 0.75) + 0.006, 5), undefined, { crease: 180 });
  }
  b.add('bulb', tint(P.violet, { e: 1.15 }), blob(0.17, 2, 0.18, 44, [1, 1.12, 1]), T(BULB[0], BULB[1], BULB[2]), { group: WG.core, crease: 180 });
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    b.add('bulb', P.sinew, tube(arcPath([BULB[0] + Math.cos(a) * 0.15, 0.78, BULB[2] + Math.sin(a) * 0.15], [BULB[0] + Math.cos(a + 0.5) * 0.21, 0.94, BULB[2] + Math.sin(a + 0.5) * 0.21], [BULB[0] + Math.cos(a + 1.1) * 0.05, 1.09, BULB[2] + Math.sin(a + 1.1) * 0.05], 6), 0.015, 4), undefined, { crease: 180 });
  }
  // cage: four mismatched blades clenched round the bulb (the tallest on the growth's side)
  const cagePaint = [P.whiteGold, P.domBronze, P.ivoryWorn, P.refNavy];
  const cageLen = [0.66, 0.5, 0.36, 0.44];
  CAGE_AT.forEach((p, i) => {
    const nx = p[0] - BULB[0], nz = p[2] - BULB[2], nl = Math.hypot(nx, nz) || 1;
    addPlate(b, 'cage' + i, cagePaint[i]!, bladeOutline(0.19, cageLen[i]!, 320 + i, i % 2 ? 0.12 : -0.1),
      facing([p[0] + (nx / nl) * 0.03, p[1], p[2] + (nz / nl) * 0.03], [nx / nl, 0.4, nz / nl], [0, 1, 0], (i - 1.5) * 0.14), { thick: 0.034, rx: 0.2, lift: 0.03, trim: i === 0 ? tint(P.gold, { r: 0.42 }) : undefined });
  });

  // ---- roots: flat on the floor, running out along the channels
  ROOT_PATHS.forEach((src, i) => {
    const path = rootPath(i), r0 = ROOT_R[i]!;
    const soup = deform(tube(path, (t) => r0 * (1 - t * 0.7) + 0.012, 6), (x, y, z, o) => { o[0] = x; o[1] = Math.max(0.004, y * 0.6); o[2] = z; });
    const split = 4 / (path.length - 1);
    b.addSkinned([`r${i}_0`, `r${i}_1`], i % 2 ? P.sinew : P.tissue, soup, undefined, {}, [0, split], 0.3);
    // where it leaves the growth, and a claw driven into the channel at its end
    b.add(`r${i}_0`, P.tissueWet, blob(r0 * 1.5, 1, 0.3, 50 + i, [1.1, 0.6, 1.1]), T(src[0]![0], 0.07, src[0]![2]), { crease: 180 });
    const e = src[src.length - 1]!, p = src[src.length - 2]!;
    const dx = e[0] - p[0], dz = e[2] - p[2], dl = Math.hypot(dx, dz) || 1;
    b.add(`r${i}_1`, P.domBlack, shard(0.2, 0.07, 0.05, 300 + i, 4, 0.6), along([e[0] - (dx / dl) * 0.06, 0.05, e[2] - (dz / dl) * 0.06], [e[0] + (dx / dl) * 0.13, 0.026, e[2] + (dz / dl) * 0.13]), { crease: 30 });
    // a stolen plate bedded on the first run, and light threading the root
    if (i < 3) {
      const m: Pt3 = [(src[0]![0] + src[1]![0]) / 2, 0.092, (src[0]![2] + src[1]![2]) / 2];
      addPlate(b, `r${i}_0`, [P.whiteGold, P.refNavy, P.domBronze][i]!, bladeOutline(0.13, 0.26, 310 + i), facing(m, [0, 1, 0], [src[1]![0] - src[0]![0], 0, src[1]![2] - src[0]![2]], 0.15), { thick: 0.022, lift: 0.02, shift: 0.02 });
    }
    for (let k = 1; k < src.length; k++) b.add(k === 1 ? `r${i}_0` : `r${i}_1`, P.violet, sphere(0.014, 1), T(src[k]![0], 0.094 - k * 0.012, src[k]![2]), { group: WG.nodes, crease: 180 });
  });
  // the floor it has lifted: a slab of black stone cracked free beside the widest root
  const slabM = T(0.72, 0.035, -0.14, 0.0, 0.5, 0.11);
  b.add('base', P.blackStone, box(0.4, 0.045, 0.26, 0.01), slabM, keep);
  b.add('base', P.gold, box(0.36, 0.01, 0.024, 0.003), slabM.clone().multiply(T(0, 0.024, 0.04)), keep);

  b.socket('core', 'bulb', BULB);
  b.socket('top', 'base', [0, 1.35, 0]);
  return b.build();
}

const WA_ACTIONS: Record<string, ActionDef> = {
  ...DEVICE_ACTIONS,
  death: { dur: 2.6, hold: true, fade: 0.02, ignoreFreeze: true, thaw: true, events: [[0.32, 'impact']], dissolveOut: [1.3, 2.6] },
};

export class WeaverAnchor extends DeviceBase {
  private readonly mass: THREE.Bone; private readonly bulb: THREE.Bone; private readonly cage: THREE.Bone[];
  private readonly roots: [THREE.Bone, THREE.Bone][] = [];

  constructor(game: Game | null, opts?: CharacterCreateOpts) {
    super(game, {
      archetype: 'weaverAnchor', height: 1.3, radius: 0.6, template: getTemplate('weaverAnchor', buildWeaverAnchor),
      actions: WA_ACTIONS, aliases: DEVICE_ALIASES, groups: WG, frostOrigin: [0.1, 0.6, 0.05], frostRange: 1.2, eclipse: true, baseCorruption: 0.6,
      rim: [0x8a78c8, 0.16],
    }, opts);
    const r = this.rig;
    this.mass = r.b('mass'); this.bulb = r.b('bulb');
    this.cage = [0, 1, 2, 3].map((i) => r.b('cage' + i));
    for (let i = 0; i < ROOT_PATHS.length; i++) this.roots.push([r.b(`r${i}_0`), r.b(`r${i}_1`)]);
    for (let i = 0; i < 4; i++) this.addChunk(this.cage[i]!, [(CAGE_AT[i]![0] - BULB[0]) * 4, 0.5, (CAGE_AT[i]![2] - BULB[2]) * 4], i, 2.4);
  }

  protected override pose(adt: number, dt: number): void {
    this.stepDevice(adt, dt);
    const t = this.time, pw = this.power, off = this.off;
    const beat = this.cadence.beat() * pw;
    const open = this.exposure('core');
    let wither = 0, deathT = -1, squeeze = 0;
    for (const s of this.active) {
      if (s.name === 'death') { deathT = s.t; wither = keys(s.t, K_WITHER); }
      else if (s.name === 'hitLight' || s.name === 'hitHeavy') squeeze += impact(s.t, 0, 0.14, 22) * s.w;
    }
    rot(this.mass, this.wobX * 0.25, 0, this.wobZ * 0.25);
    this.mass.scale.set(1 + beat * 0.03 - wither * 0.3, 1 + beat * 0.05 - off * 0.1 - wither * 0.45, 1 + beat * 0.03 - wither * 0.3);
    this.bulb.scale.setScalar(Math.max(0.0001, (1 + beat * 0.13 - off * 0.2) * (1 - 0.12 * squeeze)));
    for (let i = 0; i < 4; i++) {
      const c = this.cage[i]!;
      const flare = beat * 0.1 + open * 0.55 - off * 0.12 + Math.sin(t * 0.9 + i * 1.7) * 0.02;
      // lean each blade away from the bulb about the horizontal axis perpendicular to its radial direction
      const px = CAGE_AT[i]![0] - BULB[0], pz = CAGE_AT[i]![2] - BULB[2], l = Math.hypot(px, pz) || 1;
      rot(c, (pz / l) * flare, 0, -(px / l) * flare);
    }
    if (deathT >= 0) {
      const swell = keys(deathT, K_SWELL);
      this.bulb.scale.setScalar(Math.max(0.0001, (1 + swell * 0.6) * (1 - smoothstep(0.28, 0.36, deathT))));
      this.breakApart(Math.max(0, deathT - 0.3));
    }
    // roots stay flat: they tighten and creep sideways on the beat, and shrivel in place when the node dies
    for (let i = 0; i < this.roots.length; i++) {
      const pair = this.roots[i]!;
      const grip = beat * 0.05 + Math.sin(t * 0.7 + i * 2.1) * 0.018 - off * 0.03;
      rot(pair[0], 0, grip * (i % 2 ? 1 : -1), 0);
      rot(pair[1], 0, -grip * 1.6 * (i % 2 ? 1 : -1) + noise1(t * 0.9 + i * 4) * 0.02 - wither * 0.25 * (i % 2 ? 1 : -1), 0);
      const thick = 1 + beat * 0.07 - wither * 0.5;
      pair[0].scale.set(thick, 1 + beat * 0.1 - wither * 0.45, thick);
    }
    const fl = this.flickerLight(2);
    const burst = this.dead ? (deathT >= 0 ? keys(deathT, K_BURST) : 0) : 0;
    this.groupGlow('core', (0.55 + beat * 1.9 + open * 0.8) * pw * fl + burst);
    this.groupGlow('nodes', (0.5 + beat * 1.5) * pw);
    // the pier's own channel gutters while it is being fed on, and steadies once the growth is dead
    this.groupGlow('channel', this.dead ? 0.9 : 0.35 + 0.3 * Math.max(0, noise1(t * 3.3)) * (1 - beat));
  }
}

// =========================================================================================================
// frost anchor
// =========================================================================================================
const FG = { ring: 1, gold: 2 } as const;
const CLUSTERS: { a: number; r: number; n: number; size: number }[] = [
  { a: 1.25, r: 0.74, n: 5, size: 1 }, { a: 2.15, r: 0.7, n: 4, size: 0.8 }, { a: 0.35, r: 0.76, n: 4, size: 0.72 },
  { a: 3.2, r: 0.75, n: 3, size: 0.55 }, { a: -0.75, r: 0.78, n: 3, size: 0.5 },
];

function buildFrostAnchor(): RigTemplate {
  const b = new RigBuilder();
  b.bone('base', null, [0, 0, 0]);
  b.bone('ring', 'base', [0, 0.09, 0]);
  CLUSTERS.forEach((c, i) => b.bone('cry' + i, 'base', [Math.cos(c.a) * c.r, 0.05, Math.sin(c.a) * c.r]));
  // ancient node: octagonal black-stone plinth, angular gold inlay, satin standing disc (a mirror here would
  // white out under a glancing key and hide the ring)
  b.add('base', P.blackStone, cyl(0.82, 0.78, 0.07, 8, 0.016, Math.PI / 8), T(0, 0.035, 0));
  b.add('base', P.gold, band(0.6, 0.045, 0.082, 8, 0.008, Math.PI * 2, Math.PI / 8), T(0, 0.041, 0));
  b.add('base', tint(P.blackStone, { r: 0.27, m: 0.1 }), cyl(0.5, 0.5, 0.076, 28, 0.006), T(0, 0.04, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('base', tint(P.goldChannel, { e: 0.9 }), box(0.012, 0.006, 0.1), T(Math.cos(a) * 0.71, 0.072, Math.sin(a) * 0.71, 0, -a + Math.PI / 2, 0), { group: FG.gold });
  }
  // the pale ring (two fine lines: recognisable shape as well as colour)
  b.add('ring', tint(P.frostGlow, { e: 1.5 }), torus(0.44, 0.014, 48, 5), T(0, 0.084, 0), { group: FG.ring, crease: 180 });
  b.add('ring', tint(P.frostGlow, { e: 0.9 }), torus(0.36, 0.007, 40, 4), T(0, 0.082, 0), { group: FG.ring, crease: 180 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add('ring', tint(P.frostGlow, { e: 1.1 }), box(0.07, 0.006, 0.012), T(Math.cos(a) * 0.4, 0.082, Math.sin(a) * 0.4, 0, -a, 0), { group: FG.ring });
  }
  // rime: crystal clusters crowding the back and sides, leaving the approach (−Z) open
  CLUSTERS.forEach((c, i) => {
    const cx = Math.cos(c.a) * c.r, cz = Math.sin(c.a) * c.r;
    for (let k = 0; k < c.n; k++) {
      const spread = (k - (c.n - 1) / 2) * 0.5;
      const len = (0.16 + ((k * 37 + i * 11) % 7) * 0.045) * c.size * (k === Math.floor(c.n / 2) ? 1.6 : 1);
      const base: Pt3 = [cx + Math.cos(c.a + 1.57) * spread * 0.16, 0.05, cz + Math.sin(c.a + 1.57) * spread * 0.16];
      const tip: Pt3 = [base[0] + Math.cos(c.a + spread) * len * 0.35, 0.05 + len, base[2] + Math.sin(c.a + spread) * len * 0.35];
      b.add('cry' + i, P.ice, shard(len, 0.07 * c.size + 0.02, 0.05 * c.size + 0.02, 400 + i * 9 + k, 5, 0.45), along(base, tip, k), { crease: 25 });
    }
    b.add('base', tint(P.ice, { r: 0.45, e: 0.02, c: 0x9db9c6 }), blob(0.2 * c.size + 0.06, 1, 0.5, 420 + i, [1.3, 0.12, 1]), T(cx * 0.94, 0.07, cz * 0.94, 0, -c.a, 0), { crease: 180 });
  });
  for (let i = 0; i < 6; i++) {
    const a = 0.6 + i * 0.95, r = 0.52 + (i % 3) * 0.07;
    b.add('base', tint(P.ice, { r: 0.5, e: 0.02, c: 0x9db9c6 }), blob(0.09, 1, 0.6, 430 + i, [1.5, 0.08, 1]), T(Math.cos(a) * r, 0.078, Math.sin(a) * r, 0, a, 0), { crease: 180 });
  }
  // two slender King-era markers behind the ring
  for (const side of [-1, 1]) {
    const x = side * 0.56, z = 0.52;
    b.add('base', P.whiteGold, prism([[-0.05, 0], [0.05, 0], [0.035, 0.36], [0, 0.46], [-0.02, 0.36]], 0.07, 0.012), T(x, 0.07, z, 0, side * 0.5, 0));
    b.add('base', P.gold, box(0.012, 0.3, 0.076, 0.003), T(x, 0.24, z, 0, side * 0.5, 0));
    b.add('base', tint(P.frostGlow, { e: 0.9 }), box(0.012, 0.16, 0.012), T(x - side * 0.02, 0.27, z - 0.045, 0, side * 0.5, 0), { group: FG.ring });
  }
  b.socket('core', 'ring', [0, 0.12, 0]);
  b.socket('top', 'base', [0, 0.55, 0]);
  return b.build();
}

const FA_ACTIONS: Record<string, ActionDef> = { ...DEVICE_ACTIONS, activate: { dur: 0.8, hold: true, fade: 0.1 } };

export class FrostAnchor extends DeviceBase implements FrostAnchorVisual {
  private active01 = 0;
  private activeNow = 0;
  private readonly ring: THREE.Bone; private readonly cry: THREE.Bone[];

  constructor(game: Game | null, opts?: CharacterCreateOpts) {
    super(game, {
      archetype: 'frostAnchor', height: 0.5, radius: 0.82, template: getTemplate('frostAnchor', buildFrostAnchor),
      actions: FA_ACTIONS, aliases: { ...DEVICE_ALIASES, holdPlane: 'activate', weave: 'activate' }, groups: FG, frostOrigin: [0, 0, 0], frostRange: 1,
    }, opts);
    this.ring = this.rig.b('ring');
    this.cry = CLUSTERS.map((_, i) => this.rig.b('cry' + i));
    for (let i = 0; i < this.cry.length; i++) this.addChunk(this.cry[i]!, [Math.cos(CLUSTERS[i]!.a) * 1.8, 0.4, Math.sin(CLUSTERS[i]!.a) * 1.8], i, 2.2);
    this.u.uDissolveColor.value.setHex(0xcfeeff);
  }

  setActive(amount: number): void {
    this.active01 = clamp01(amount || 0);
  }

  protected override heal(): void {
    super.heal();
    this.activeNow = 0;
  }

  protected override pose(adt: number, dt: number): void {
    this.stepDevice(adt, dt);
    const t = this.time, pw = this.power;
    const want = Math.max(this.active01, this.weight('activate'));
    this.activeNow = damp(this.activeNow, want, 4, dt);
    const a = this.activeNow * pw;
    move(this.ring, 0, a * 0.012 + Math.sin(t * 1.4) * 0.002, 0);
    for (let i = 0; i < this.cry.length; i++) {
      const g = 1 + a * (0.45 + 0.12 * i) + Math.sin(t * 0.8 + i * 2.2) * 0.012;
      this.cry[i]!.scale.set(1 + a * 0.12, g, 1 + a * 0.12);
    }
    for (const s of this.active) {
      if (s.name === 'death') this.breakApart(s.t);
      else if (s.name === 'hitLight' || s.name === 'hitHeavy') {
        const k = impact(s.t, 0, 0.12, 30) * s.w;
        for (const c of this.cry) rot(c, 0.06 * k, 0, 0.05 * k);
      }
    }
    this.groupGlow('ring', (0.62 + 0.14 * Math.sin(t * 1.4) + a * 1.9) * pw + 0.03);
    this.groupGlow('gold', 0.5 + a * 0.8);
  }
}

export function createWeaverAnchor(game: Game | null, opts?: CharacterCreateOpts): WeaverAnchor {
  return new WeaverAnchor(game, opts);
}
export function createFrostAnchor(game: Game | null, opts?: CharacterCreateOpts): FrostAnchor {
  return new FrostAnchor(game, opts);
}
