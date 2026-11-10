/**
 * Scenic ships.
 *  - Capitals (≈ 620 m): far-field hazed material + light cards, 2 draw calls.
 *  - Shuttle / transport (≈ 26 / 31 m): near-field PBR split by material role, using the shared material library
 *    when it is available (so they match the faction kit) and a palette-matched MeshStandardMaterial fallback
 *    when it is not. ≤ 7 draw calls each; they cast and receive zone shadows. Crashed hull sections live in
 *    wrecks.ts and share `ShipMaterials`.
 */
import * as THREE from 'three';
import type { Game, MatId } from '@/core/api';
import { PALETTE } from '@/core/api';
import { isStub } from '@/core/stub';
import type { SharedUniforms } from '../shared';
import { GeoBuilder } from './geo';
import { HULL_ROLES, PartSink, buildHull, paletteFor, type HullRole, type ShipKind } from './hulls';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';
import { num } from './opts';

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
    engine: { color: 0x0a0503, rough: 0.5, metal: 0, emissive: PALETTE.cinderHot, intensity: 0.07 },
  },
  reformation: {
    hull: { color: PALETTE.refSlate, rough: 0.5, metal: 0.6 }, accent: { color: PALETTE.refNavy, rough: 0.5, metal: 0.4 },
    dark: { color: 0x0d1118, rough: 0.7, metal: 0.3 }, metal: { color: PALETTE.refSteel, rough: 0.32, metal: 0.9 },
    glow: { color: 0x000000, rough: 0.5, metal: 0, emissive: PALETTE.refBlue, intensity: 2 },
    glass: { color: 0x050a10, rough: 0.1, metal: 0.6 },
    engine: { color: 0x03060a, rough: 0.5, metal: 0, emissive: PALETTE.frost, intensity: 0.07 },
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

  /** Fallback for the ground a wreck ploughed up (used when the library has no 'rubble'). */
  ground(): THREE.Material {
    let m = this.cache.get('ground');
    if (!m) {
      m = new THREE.MeshStandardMaterial({ name: 'ship:ground', color: 0x24211e, roughness: 0.95, metalness: 0 });
      this.owned.push(m);
      this.cache.set('ground', m);
    }
    return m;
  }

  /** Soft scorch decal: black, alpha from the vertex colours, never writes depth. */
  scorch(): THREE.Material {
    let m = this.cache.get('scorch');
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        name: 'ship:scorch', color: 0x050403, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.owned.push(m);
      this.cache.set('scorch', m);
    }
    return m;
  }

  update(time: number): void {
    for (let i = 0; i < this.dying.length; i++) {
      const d = this.dying[i];
      // a failing strip: mostly dim, slow surges, an occasional soft sag — never a hard strobe
      const a = Math.sin(time * 1.9 + d.seed) * Math.sin(time * 0.73 + d.seed * 2.1);
      const sag = 1 - 0.6 * Math.max(0, Math.sin(time * 0.9 + d.seed * 3.0) - 0.8) * 5;
      d.m.emissiveIntensity = d.base * (0.35 + 0.45 * (0.5 + 0.5 * a)) * sag;
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
        // parked craft: the throats only smoulder
        const m = mats.emissive(faction === 'dominion' ? PALETTE.cinderHot : PALETTE.frost, 0.12);
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
    const mesh = new THREE.Mesh(b.build(true), material(role));
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

export function buildShip(shared: SharedUniforms, mats: ShipMaterials, kind: ShipKind, scale?: number): THREE.Object3D {
  const faction = factionOf(kind);
  const s = num(scale, 1, 0.05, 20);
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
