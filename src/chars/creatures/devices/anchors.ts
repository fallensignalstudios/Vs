/**
 * Ancient-space anchors:
 *  - weaverAnchor: an Eclipse growth node gripping the structure it feeds on — six root claws dug into the
 *    floor around a caged, pulsing bulb. Everything about it moves on the shared cadence.
 *  - frostAnchor: a frost-rimed King-era floor node with a pale ring — a place to stand. Low, quiet, open
 *    toward the approach, flanked by two slender markers so it reads from across a court.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { FrostAnchorVisual } from '@/core/api/creatures';
import { clamp01, damp, smoothstep } from '@/core/mathx';
import { impact, keys, noise1, rot, move } from '../core/anim';
import type { ActionDef } from '../core/base';
import { along, band, blob, box, cyl, prism, shard, sphere, T, torus, tube, arcPath, type Pt3 } from '../core/geo';
import { P, tint } from '../core/palette';
import { addPlate, bladeOutline, facing } from '../core/plates';
import { getTemplate, RigBuilder, type RigTemplate } from '../core/rig';
import { DEVICE_ACTIONS, DEVICE_ALIASES, DeviceBase } from './base';

// =========================================================================================================
// weaver anchor
// =========================================================================================================
const WG = { core: 1, nodes: 2 } as const;
const ROOTS = 6;

function rootGeom(i: number): { s: Pt3; k: Pt3; f: Pt3 } {
  const a = (i / ROOTS) * Math.PI * 2 + 0.3 + Math.sin(i * 2.7) * 0.22;
  const reach = 0.74 + Math.sin(i * 1.9 + 1) * 0.14;
  const c = Math.cos(a), sn = Math.sin(a);
  return { s: [c * 0.2, 0.36, sn * 0.2], k: [c * reach * 0.62, 0.5 + Math.sin(i * 3.1) * 0.08, sn * reach * 0.62], f: [c * reach, 0.03, sn * reach] };
}

function buildWeaverAnchor(): RigTemplate {
  const b = new RigBuilder();
  b.bone('base', null, [0, 0, 0]);
  b.bone('mass', 'base', [0, 0.4, 0]);
  b.bone('bulb', 'mass', [0, 0.64, 0]);
  const cageAt: Pt3[] = [[0.22, 0.5, 0.05], [-0.05, 0.5, 0.23], [-0.23, 0.5, -0.04], [0.04, 0.5, -0.22]];
  cageAt.forEach((p, i) => b.bone('cage' + i, 'mass', p));
  for (let i = 0; i < ROOTS; i++) {
    const g = rootGeom(i);
    b.bone(`r${i}_0`, 'base', g.s);
    b.bone(`r${i}_1`, `r${i}_0`, g.k);
  }
  // roots: thick sinew arching out, a blade claw driven into the floor, a stolen plate on the knuckle
  const paints = [P.whiteGold, P.domBronze, P.ivoryWorn, P.refNavy, P.whiteGold, P.domOxblood];
  for (let i = 0; i < ROOTS; i++) {
    const g = rootGeom(i);
    b.tubeOn([`r${i}_0`, `r${i}_1`], g.f, i % 2 ? P.sinew : P.tissue, (t) => 0.085 * (1 - t * 0.6), 6, {}, 1, 4);
    const out: Pt3 = [g.f[0] - g.k[0], 0, g.f[2] - g.k[2]];
    const ol = Math.hypot(out[0], out[2]) || 1;
    b.add(`r${i}_1`, P.domBlack, shard(0.3, 0.1, 0.07, 300 + i, 4, 0.55), along([g.f[0] - (out[0] / ol) * 0.1, 0.16, g.f[2] - (out[2] / ol) * 0.1], [g.f[0] + (out[0] / ol) * 0.07, -0.06, g.f[2] + (out[2] / ol) * 0.07]), { crease: 30 });
    addPlate(b, `r${i}_1`, paints[i]!, bladeOutline(0.17, 0.3, 310 + i), facing([g.k[0], g.k[1] + 0.085, g.k[2]], [out[0] / ol * 0.3, 1, out[2] / ol * 0.3], [out[0], 0.2, out[2]], 0.2), { thick: 0.03, rx: 0.14, lift: 0.04 });
    if (i % 2 === 0) {
      const side: Pt3 = [g.f[0] * 0.8 - out[2] / ol * 0.22, 0.02, g.f[2] * 0.8 + out[0] / ol * 0.22];
      b.add(`r${i}_1`, P.sinew, tube(arcPath(g.k, [g.k[0] * 1.1, 0.3, g.k[2] * 1.1], side, 6), (t) => 0.03 * (1 - t * 0.7), 5), undefined, { crease: 180 });
    }
  }
  // central mass, bulb, membrane
  b.add('mass', P.tissue, blob(0.31, 2, 0.3, 41, [1.12, 0.84, 1.12]), T(0, 0.4, 0), { crease: 180 });
  b.add('mass', P.tissueWet, torus(0.17, 0.06, 14, 6), T(0, 0.56, 0), { crease: 180 });
  b.add('bulb', tint(P.violet, { e: 1.15 }), blob(0.18, 2, 0.18, 43, [1, 1.12, 1]), T(0, 0.68, 0), { group: WG.core, crease: 180 });
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    b.add('bulb', P.sinew, tube(arcPath([Math.cos(a) * 0.16, 0.56, Math.sin(a) * 0.16], [Math.cos(a + 0.5) * 0.22, 0.72, Math.sin(a + 0.5) * 0.22], [Math.cos(a + 1.1) * 0.05, 0.88, Math.sin(a + 1.1) * 0.05], 6), 0.016, 4), undefined, { crease: 180 });
  }
  // cage: four mismatched blades clenched around the bulb
  const cagePaint = [P.whiteGold, P.domBronze, P.ivoryWorn, P.refNavy];
  cageAt.forEach((p, i) => {
    const n: Pt3 = [p[0], -0.02, p[2]];
    const nl = Math.hypot(n[0], n[2]);
    addPlate(b, 'cage' + i, cagePaint[i]!, bladeOutline(0.2, 0.62 + (i % 2) * 0.14, 320 + i, i % 2 ? 0.12 : -0.1),
      facing([p[0] * 1.12, 0.46, p[2] * 1.12], [n[0] / nl, 0.42, n[2] / nl], [0, 1, 0], (i - 1.5) * 0.12), { thick: 0.035, rx: 0.2, lift: 0.03, trim: i === 0 ? tint(P.gold, { r: 0.42 }) : undefined });
  });
  b.add('mass', P.ivoryWorn, shard(0.5, 0.1, 0.07, 331, 4, 0.5), along([-0.12, 0.6, 0.1], [-0.3, 1.08, 0.2]), { crease: 30 });
  // the structure it grips: a lifted floor slab with its gold channel, cracked free
  const slabM = T(0.5, 0.17, -0.36, 0.34, 0.5, -0.2);
  b.add('base', P.blackStone, box(0.56, 0.06, 0.36, 0.012), slabM);
  b.add('base', P.gold, box(0.5, 0.012, 0.03, 0.004), slabM.clone().multiply(T(0, 0.032, 0.05)));
  b.add('base', P.blackStone, shard(0.3, 0.2, 0.06, 333, 4, 0.5), along([-0.5, 0.02, -0.42], [-0.74, 0.1, -0.56]), { crease: 30 });
  const nodes: Pt3[] = [[0.2, 0.5, 0.18], [-0.24, 0.42, 0.1], [0.05, 0.36, -0.28], [-0.1, 0.62, -0.16]];
  for (const n of nodes) b.add('mass', P.violet, sphere(0.02, 1), T(n[0], n[1], n[2]), { group: WG.nodes, crease: 180 });
  b.socket('core', 'bulb', [0, 0.72, 0]);
  b.socket('top', 'mass', [0, 1.15, 0]);
  return b.build();
}

const WA_ACTIONS: Record<string, ActionDef> = { ...DEVICE_ACTIONS, death: { dur: 2.6, hold: true, fade: 0.02, events: [[0.32, 'impact']] } };

export class WeaverAnchor extends DeviceBase {
  private readonly mass: THREE.Bone; private readonly bulb: THREE.Bone; private readonly cage: THREE.Bone[];
  private readonly roots: [THREE.Bone, THREE.Bone][] = [];

  constructor(game: Game | null, opts?: CharacterCreateOpts) {
    super(game, {
      archetype: 'weaverAnchor', height: 1.15, radius: 0.6, template: getTemplate('weaverAnchor', buildWeaverAnchor),
      actions: WA_ACTIONS, aliases: DEVICE_ALIASES, groups: WG, frostOrigin: [0, 0.5, 0], frostRange: 1.1, eclipse: true, baseCorruption: 0.6,
    }, opts);
    const r = this.rig;
    this.mass = r.b('mass'); this.bulb = r.b('bulb');
    this.cage = [0, 1, 2, 3].map((i) => r.b('cage' + i));
    for (let i = 0; i < ROOTS; i++) this.roots.push([r.b(`r${i}_0`), r.b(`r${i}_1`)]);
    this.cage.forEach((c, i) => this.addChunk(c, [c.position.x * 4, 0.5, c.position.z * 4], 0.45, i, 2.4));
  }

  protected override pose(adt: number, dt: number): void {
    this.stepDevice(adt, dt);
    const t = this.time, pw = this.power, off = this.off;
    const beat = this.cadence.beat() * pw;
    const open = this.exposure('core');
    rot(this.mass, this.wobX * 0.5, 0, this.wobZ * 0.5);
    this.mass.scale.set(1 + beat * 0.035, 1 + beat * 0.06 - off * 0.12, 1 + beat * 0.035);
    this.bulb.scale.setScalar(1 + beat * 0.13 - off * 0.2);
    for (let i = 0; i < 4; i++) {
      const c = this.cage[i]!;
      const flare = beat * 0.1 + open * 0.55 - off * 0.12 + Math.sin(t * 0.9 + i * 1.7) * 0.02;
      // lean each blade away from the bulb about the horizontal axis perpendicular to its radial direction
      const px = c.position.x, pz = c.position.z, l = Math.hypot(px, pz) || 1;
      rot(c, (pz / l) * flare, 0, -(px / l) * flare);
    }
    let wither = 0;
    for (const s of this.active) {
      if (s.name === 'death') {
        const swell = keys(s.t, [0, 0, 0.26, 1, 0.34, 0]) * s.w;
        const gone = smoothstep(0.28, 0.36, s.t);
        this.bulb.scale.setScalar(Math.max(0.0001, (1 + swell * 0.6) * (1 - gone)));
        this.breakApart(Math.max(0, s.t - 0.3), s.w);
        wither = keys(s.t, [0.3, 0, 1.6, 1]) * s.w;
        this.mass.scale.set(1 - wither * 0.2, 1 - wither * 0.55, 1 - wither * 0.2);
        this.autoDissolve = keys(s.t, [1.3, 0, 2.6, 1]);
      } else if (s.name === 'hitLight' || s.name === 'hitHeavy') {
        const k = impact(s.t, 0, 0.14, 22) * s.w;
        this.bulb.scale.multiplyScalar(1 - 0.12 * k);
      }
    }
    for (let i = 0; i < ROOTS; i++) {
      const [r0, r1] = this.roots[i]!;
      const g = rootGeom(i);
      const l = Math.hypot(g.f[0], g.f[2]) || 1;
      const ax = g.f[2] / l, az = -g.f[0] / l; // axis that lifts the root's reach
      const grip = beat * 0.07 + Math.sin(t * 0.7 + i * 2.1) * 0.02 - off * 0.06;
      rot(r0, ax * (grip - wither * 0.9), 0, az * (grip - wither * 0.9));
      rot(r1, -ax * (grip * 1.6 + wither * 1.4) + noise1(t * 0.9 + i * 4) * 0.02, 0, -az * (grip * 1.6 + wither * 1.4));
      const sc = 1 - wither * 0.45;
      r0.scale.setScalar(sc);
    }
    const fl = this.flickerLight(2);
    this.groupGlow('core', (0.55 + beat * 1.9 + open * 0.8) * pw * fl * (this.dead ? 0 : 1) + (this.dead ? keys(this.weight('death') > 0 ? this.deathT() : 9, [0, 1, 0.26, 6, 0.36, 0]) : 0));
    this.groupGlow('nodes', (0.5 + beat * 1.5) * pw);
  }

  private deathT(): number {
    for (const s of this.active) if (s.name === 'death') return s.t;
    return 9;
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
  // ancient node: octagonal black-stone plinth, angular gold inlay, polished standing disc
  b.add('base', P.blackStone, cyl(0.82, 0.78, 0.07, 8, 0.016, Math.PI / 8), T(0, 0.035, 0));
  b.add('base', P.gold, band(0.6, 0.045, 0.082, 8, 0.008, Math.PI * 2, Math.PI / 8), T(0, 0.041, 0));
  b.add('base', tint(P.blackStone, { r: 0.07 }), cyl(0.5, 0.5, 0.076, 28, 0.006), T(0, 0.04, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('base', tint(P.goldChannel, { e: 0.9 }), box(0.012, 0.006, 0.1), T(Math.cos(a) * 0.71, 0.072, Math.sin(a) * 0.71, 0, -a + Math.PI / 2, 0), { group: FG.gold });
  }
  // the pale ring (two fine lines: recognisable shape as well as colour)
  b.add('ring', tint(P.frostGlow, { e: 1.25 }), torus(0.44, 0.012, 48, 5), T(0, 0.084, 0), { group: FG.ring, crease: 180 });
  b.add('ring', tint(P.frostGlow, { e: 0.8 }), torus(0.36, 0.006, 40, 4), T(0, 0.082, 0), { group: FG.ring, crease: 180 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add('ring', tint(P.frostGlow, { e: 1.0 }), box(0.07, 0.006, 0.012), T(Math.cos(a) * 0.4, 0.082, Math.sin(a) * 0.4, 0, -a, 0), { group: FG.ring });
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
    this.cry.forEach((c, i) => this.addChunk(c, [c.position.x * 2.4, 0.4, c.position.z * 2.4], 0.05, i, 2.2));
    this.u.uDissolveColor.value.setHex(0xcfeeff);
  }

  setActive(amount: number): void {
    this.active01 = clamp01(amount || 0);
  }

  protected override pose(adt: number, dt: number): void {
    this.stepDevice(adt, dt);
    const t = this.time, pw = this.power;
    const want = Math.max(this.active01, this.weight('activate'));
    this.activeNow = damp(this.activeNow, want, 4, dt);
    const a = this.activeNow * pw;
    move(this.ring, 0, a * 0.012 + Math.sin(t * 1.4) * 0.002, 0);
    this.cry.forEach((c, i) => {
      const g = 1 + a * (0.45 + 0.12 * i) + Math.sin(t * 0.8 + i * 2.2) * 0.012;
      c.scale.set(1 + a * 0.12, g, 1 + a * 0.12);
    });
    for (const s of this.active) {
      if (s.name === 'death') this.breakApart(s.t, s.w);
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
