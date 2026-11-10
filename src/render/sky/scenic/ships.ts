/**
 * Scenic ships and wrecks.
 *  - Capitals (≈ 620 m): far-field hazed material + light cards, 2 draw calls.
 *  - Shuttle / transport (≈ 24 / 31 m) and crashed hull sections: near-field PBR split by material role, using
 *    the shared material library when it is available (so they match the faction kit) and a palette-matched
 *    MeshStandardMaterial fallback when it is not. ≤ 7 draw calls each; they cast and receive zone shadows.
 */
import * as THREE from 'three';
import type { Game, MatId } from '@/core/api';
import { PALETTE } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { isStub } from '@/core/stub';
import type { SharedUniforms } from '../shared';
import { GeoBuilder, type P3 } from './geo';
import { HULL_ROLES, PartSink, buildHull, paletteFor, type HullRole, type ShipKind } from './hulls';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';

type Faction = 'dominion' | 'reformation';

const ROLE_MATS: Record<Faction, Partial<Record<HullRole, MatId>>> = {
  dominion: { hull: 'domBronze', accent: 'domOxblood', dark: 'domBlack', metal: 'goldDark', glow: 'domAmberGlow', glass: 'domBlack' },
  reformation: { hull: 'refSlate', accent: 'refNavy', dark: 'rubber', metal: 'refSteel', glow: 'refBlueGlow', glass: 'refNavy' },
};

const FALLBACK: Record<Faction, Record<HullRole, { color: number; rough: number; metal: number; emissive?: number; intensity?: number }>> = {
  dominion: {
    hull: { color: PALETTE.domBronze, rough: 0.5, metal: 0.75 }, accent: { color: PALETTE.domOxblood, rough: 0.55, metal: 0.35 },
    dark: { color: PALETTE.domBlack, rough: 0.6, metal: 0.5 }, metal: { color: PALETTE.goldDeep, rough: 0.4, metal: 0.9 },
    glow: { color: 0x000000, rough: 0.5, metal: 0, emissive: PALETTE.domAmber, intensity: 2 },
    glass: { color: 0x0a0605, rough: 0.12, metal: 0.6 },
    engine: { color: 0x000000, rough: 0.5, metal: 0, emissive: PALETTE.cinderHot, intensity: 0.9 },
  },
  reformation: {
    hull: { color: PALETTE.refSlate, rough: 0.5, metal: 0.6 }, accent: { color: PALETTE.refNavy, rough: 0.5, metal: 0.4 },
    dark: { color: 0x0d1118, rough: 0.7, metal: 0.3 }, metal: { color: PALETTE.refSteel, rough: 0.32, metal: 0.9 },
    glow: { color: 0x000000, rough: 0.5, metal: 0, emissive: PALETTE.refBlue, intensity: 2 },
    glass: { color: 0x050a10, rough: 0.1, metal: 0.6 },
    engine: { color: 0x000000, rough: 0.5, metal: 0, emissive: PALETTE.frost, intensity: 0.9 },
  },
};

/** Resolves materials per role and owns the ones it had to create (fallbacks, flickering wreck glows). */
export class ShipMaterials {
  private readonly cache = new Map<string, THREE.Material>();
  private readonly owned: THREE.Material[] = [];
  private readonly dying: Array<{ m: THREE.MeshStandardMaterial; base: number; seed: number }> = [];
  constructor(private readonly game: Game) {}

  get(faction: Faction, role: HullRole): THREE.Material {
    const key = `${faction}:${role}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = this.fromLibrary(faction, role) ?? this.fallback(faction, role);
    this.cache.set(key, m);
    return m;
  }

  /** A glow material whose emissive sputters and fades (crashed hull sections). One shared instance per faction. */
  dyingGlow(faction: Faction): THREE.Material {
    const key = `${faction}:dying`;
    let m = this.cache.get(key);
    if (m) return m;
    const f = FALLBACK[faction].glow;
    const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6, metalness: 0.2, emissive: f.emissive, emissiveIntensity: 2 });
    this.owned.push(mat);
    this.dying.push({ m: mat, base: 2.2, seed: faction === 'dominion' ? 1.3 : 4.1 });
    this.cache.set(key, mat);
    m = mat;
    return m;
  }

  update(time: number): void {
    for (const d of this.dying) {
      // a failing strip: mostly dim, occasional slow surges, rare drop-outs — never a hard strobe
      const a = Math.sin(time * 1.9 + d.seed) * Math.sin(time * 0.73 + d.seed * 2.1);
      const drop = Math.sin(time * 5.3 + d.seed * 3.0) > 0.92 ? 0.25 : 1;
      d.m.emissiveIntensity = d.base * (0.35 + 0.45 * (0.5 + 0.5 * a)) * drop;
    }
  }

  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.cache.clear();
    this.dying.length = 0;
  }

  private fromLibrary(faction: Faction, role: HullRole): THREE.Material | null {
    const mats = this.game.mats;
    if (!mats || isStub(mats)) return null;
    try {
      if (role === 'engine') {
        const m = mats.emissive(faction === 'dominion' ? PALETTE.cinderHot : PALETTE.frost, 1);
        return m && !isStub(m) && (m as THREE.Material).isMaterial ? m : null;
      }
      const id = ROLE_MATS[faction][role];
      if (!id) return null;
      const m = mats.get(id);
      return m && !isStub(m) && (m as THREE.Material).isMaterial ? m : null;
    } catch {
      return null;
    }
  }

  private fallback(faction: Faction, role: HullRole): THREE.Material {
    const f = FALLBACK[faction][role];
    const m = new THREE.MeshStandardMaterial({
      color: f.color, roughness: f.rough, metalness: f.metal,
      emissive: f.emissive ?? 0x000000, emissiveIntensity: f.intensity ?? 0,
    });
    m.name = `ship:${faction}:${role}`;
    this.owned.push(m);
    return m;
  }
}

function factionOf(kind: ShipKind): Faction {
  return kind.startsWith('dominion') ? 'dominion' : 'reformation';
}

function splitMeshes(sink: PartSink, name: string, material: (role: HullRole) => THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  let tris = 0;
  for (const role of HULL_ROLES) {
    const b = sink.builder(role);
    if (b.triangleCount === 0) continue;
    const mesh = new THREE.Mesh(b.build(), material(role));
    mesh.name = `${name}:${role}`;
    const lit = role !== 'glow' && role !== 'engine';
    mesh.castShadow = lit;
    mesh.receiveShadow = lit;
    tris += b.triangleCount;
    group.add(mesh);
  }
  group.userData.scenic = { kind: name, triangles: tris };
  return group;
}

export function buildShip(shared: SharedUniforms, mats: ShipMaterials, kind: ShipKind, scale = 1): THREE.Object3D {
  const faction = factionOf(kind);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (kind === 'dominionCapital' || kind === 'reformationCapital') {
    const b = new GeoBuilder();
    buildHull(kind, PartSink.single(paletteFor(kind), b));
    const group = new THREE.Group();
    group.name = `scenic:${kind}`;
    const mesh = new THREE.Mesh(b.build(), createScenicMaterial(shared, {
      name: 'ScenicCapital', panel: [24, 12], gloss: 0.4, glowReach: 0.5, underLight: [0.1, 0.1, 0.12],
    }));
    mesh.name = `scenic:${kind}:hull`;
    const cards = new LightCards();
    const dom = faction === 'dominion';
    const engine = dom ? PALETTE.domAmber : PALETTE.refBlue;
    const pts: Array<[number, number, number, number]> = dom
      ? [[38, -8, 352, 34], [-38, -8, 352, 34], [0, 12, 360, 42]]
      : [[-17, 12, 344, 20], [17, 12, 344, 20], [-17, -12, 344, 20], [17, -12, 344, 20]];
    for (const [x, y, z, size] of pts) cards.point(x, y, z, size, engine, 5).point(x, y, z + size * 0.5, size * 2.2, engine, 0.9);
    const run: Array<[number, number, number]> = dom
      ? [[0, 208, 196], [0, -110, 110], [72, -4, 120], [-72, -4, 120], [0, -30, -346]]
      : [[0, 98, 40], [0, 0, -400], [86, 0, -170], [-86, 0, -170], [164, 20, 150], [-164, 20, 150], [0, -64, -96]];
    for (const [x, y, z] of run) cards.point(x, y, z, 4, dom ? 0xff5030 : 0xe6f2ff, 5);
    const lights = cards.build(shared, { name: `scenic:${kind}:lights` });
    group.add(mesh, lights);
    group.scale.setScalar(s);
    group.userData.scenic = { kind, triangles: b.triangleCount, lights: cards.count };
    return group;
  }
  const sink = PartSink.split(paletteFor(kind));
  buildHull(kind, sink);
  const group = splitMeshes(sink, `scenic:${kind}`, (role) => mats.get(faction, role));
  group.scale.setScalar(s);
  return group;
}

// -------------------------------------------------------------------------------------------------------------
// Wrecks — a crashed dropship hull section: an open, ribbed fuselage barrel half-buried at an angle, torn
// plating, a snapped strut or wing root, scattered plates, scorch, and light strips that are failing.
// -------------------------------------------------------------------------------------------------------------
export function buildWreck(mats: ShipMaterials, game: Game, faction: Faction, scale = 1, seed = 7283): THREE.Object3D {
  const rand = mulberry32(seed ^ (faction === 'dominion' ? 0xd03 : 0x4ef));
  const sink = PartSink.split(paletteFor(faction === 'dominion' ? 'dominionShuttle' : 'reformationTransport'));
  const scorch = new GeoBuilder().paint(0x060606);
  const dom = faction === 'dominion';
  const R = dom ? 2.9 : 3.2, HGT = dom ? 2.2 : 2.3; // half width / half height of the barrel
  const LEN = 13;
  const sides = dom ? 7 : 8;
  const ringAt = (z: number, k: number, jag: number): P3[] => {
    const pts: P3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      // squarer section for the Reformation module, wedge-bellied for the Dominion hull
      const sx = Math.cos(a), sy = Math.sin(a);
      const px = dom ? sx * R * (sy < 0 ? 0.82 : 1) : Math.sign(sx) * Math.pow(Math.abs(sx), 0.55) * R;
      const py = dom ? sy * HGT * (sy < 0 ? 1.1 : 0.92) : Math.sign(sy) * Math.pow(Math.abs(sy), 0.55) * HGT;
      pts.push([px * k, py * k, z + (jag ? (rand() - 0.5) * jag : 0)]);
    }
    return pts;
  };
  // resting pose: nose buried, rolled, section lifted so it rests on y = 0
  sink.push().translate(0, HGT * 0.72, 0).rotateZ(dom ? 0.28 : -0.2).rotateX(dom ? -0.16 : -0.1);
  scorch.push().translate(0, HGT * 0.72, 0).rotateZ(dom ? 0.28 : -0.2).rotateX(dom ? -0.16 : -0.1);

  // outer skin (torn open at the rear: jagged last ring) and inner lining
  const stations = [-LEN / 2, -LEN / 4, 0, LEN / 4, LEN / 2];
  const outer = stations.map((z, i) => ringAt(z, 1 - 0.08 * Math.max(0, -z / (LEN / 2)), i === stations.length - 1 ? 2.6 : 0));
  // ringAt winds clockwise when looking from the first station toward the last, so the skin is lofted
  // reversed (faces out) and the lining as-is (faces the cabin)
  sink.p('hull').loft(outer.map((ring) => [...ring].reverse()), false);
  const inner = outer.map((ring) => ring.map((p): P3 => [p[0] * 0.9, p[1] * 0.88, p[2]]));
  sink.p('dark').loft(inner, false);
  // nose bulkhead, crumpled
  sink.p('accent').poly([...outer[0]].reverse());
  // structural frames (visible ribs) and a longitudinal spine
  for (let i = 0; i < 5; i++) {
    const z = -LEN / 2 + 1 + i * (LEN - 2) / 4;
    const a = ringAt(z - 0.14, 0.9, 0), c = ringAt(z + 0.14, 0.9, 0);
    const a2 = a.map((p): P3 => [p[0] * 0.86, p[1] * 0.86, p[2]]), c2 = c.map((p): P3 => [p[0] * 0.86, p[1] * 0.86, p[2]]);
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      sink.p('metal').quad(a2[k], a2[j], c2[j], c2[k]).quad(a[j], a2[j], a2[k], a[k]).quad(c[k], c2[k], c2[j], c[j]);
    }
  }
  sink.p('metal').box(0, HGT * 0.82, 0, 0.3, 0.26, LEN * 0.94);
  // armour plates / panels on the skin; some missing, edges scorched
  for (let i = 0; i < 9; i++) {
    const z = -LEN / 2 + 0.9 + i * 1.3;
    for (const s of [-1, 1]) {
      if (rand() < 0.28) continue;
      sink.p(dom ? 'accent' : 'hull', 0.9 + rand() * 0.25).box(s * (R + 0.06), (rand() - 0.5) * 0.5, z, 0.14, HGT * (0.9 + rand() * 0.5), 1.14);
      if (rand() < 0.45) scorch.box(s * (R + 0.15), HGT * (rand() - 0.2) * 0.6, z, 0.06, HGT * 0.7, 1.0);
    }
  }
  // failing light strips along the upper flanks + a dead console glow inside
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) if (rand() < 0.75) sink.p('glow').box(s * (R + 0.14), HGT * 0.52, -LEN / 2 + 2.2 + i * 3.6, 0.05, 0.09, 2.4);
  }
  sink.p('glow').box(-R * 0.5, -HGT * 0.3, -LEN / 2 + 0.5, 0.9, 0.5, 0.06);
  // snapped wing root (Dominion) / torn outrigger with a dead thruster pod (Reformation)
  if (dom) {
    sink.push().translate(-R, 0.5, 0.6).rotateZ(0.5);
    sink.p('hull', 0.9).box(-1.9, 0, 0, 3.8, 0.4, 4.6, { top: [0.8, 0.7] });
    sink.p('dark').box(-3.9, 0.1, 0.2, 0.5, 0.5, 3.4, { top: [0.4, 0.5] });
    sink.pop();
  } else {
    sink.p('metal').box(R + 1.5, HGT * 0.6, 1, 3.0, 0.34, 0.6, { shift: [0.4, 0] });
    sink.push().translate(R + 3.2, HGT * 0.35, 1).rotateZ(-0.5).rotateX(Math.PI / 2);
    sink.p('dark').prism(0, -1.3, 0, 1.4, 0.95, 1.1, 8);
    sink.pop();
  }
  scorch.box(0, -HGT * 0.95, LEN * 0.3, R * 1.5, 0.12, LEN * 0.5);
  sink.pop();
  scorch.pop();

  // ground: gouge berm, scattered plates and scorch marks around the hull
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, d = R + 1.2 + rand() * 6.5;
    const x = Math.cos(a) * d * 0.9, z = Math.sin(a) * d * 1.2;
    sink.push().translate(x, 0.08 + rand() * 0.25, z).rotateY(rand() * 6.28).rotateX((rand() - 0.5) * 0.7).rotateZ((rand() - 0.5) * 0.7);
    sink.p(rand() < 0.5 ? 'hull' : dom ? 'accent' : 'metal', 0.8).box(0, 0, 0, 0.5 + rand() * 1.6, 0.07, 0.4 + rand() * 1.2, { top: [0.6 + rand() * 0.4, 0.6 + rand() * 0.4] });
    sink.pop();
  }
  // scorch marks: each a rosette of thin overlapping blades so no mark reads as a rectangle
  for (let i = 0; i < 7; i++) {
    const cx = (rand() - 0.5) * 9, cz = (rand() - 0.5) * 14, size = 1.2 + rand() * 2.6;
    for (let j = 0; j < 5; j++) {
      scorch.push().translate(cx, 0.012 + (i * 5 + j) * 0.0008, cz).rotateY((j / 5) * Math.PI + rand() * 0.4);
      scorch.box(0, 0, 0, size * (1.4 + rand()), 0.006, size * (0.25 + rand() * 0.3), { top: [0.7, 0.4] });
      scorch.pop();
    }
  }

  const roleMat = (role: HullRole): THREE.Material => (role === 'glow' ? mats.dyingGlow(faction) : mats.get(faction, role));
  const group = splitMeshes(sink, `scenic:wreck:${faction}`, roleMat);
  if (scorch.triangleCount > 0) {
    let burnt: THREE.Material | null = null;
    try {
      const m = game.mats && !isStub(game.mats) ? game.mats.get('scorched') : null;
      burnt = m && !isStub(m) && (m as THREE.Material).isMaterial ? m : null;
    } catch {
      burnt = null;
    }
    const mesh = new THREE.Mesh(scorch.build(), burnt ?? mats.get(faction, 'dark'));
    mesh.name = `scenic:wreck:${faction}:scorch`;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  group.scale.setScalar(s);
  return group;
}

