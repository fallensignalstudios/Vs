/**
 * Figure assembly + cache. An archetype definition sculpts into a MeshBuilder and fills a FigureDraft
 * (equipment mounts, cloth panels, moveset, defaults).
 *
 * A figure is built at up to three levels of detail on the same rig (same bones, same cloth particles), so a
 * visual can swap meshes by distance and cast its shadow from the cheapest one. Built figures are cached per
 * (archetype, structural seed, variant, mask) and reference-counted: unreferenced entries stay warm in a small
 * LRU and are disposed beyond it or on releaseUnusedFigures() (zone unload).
 */
import * as THREE from 'three';
import type { HumanoidArchetype } from '@/core/api';
import { mulberry32, hashString } from '@/core/mathx';
import { MeshBuilder } from './geo/builder';
import { buildRigSpec, RigView, type Proportions, type RigSpec } from './rig';
import type { ClothDef } from './cloth';
import type { Moveset } from './anim/moveset';
import type { V3 } from './geo/prims';

export interface Mount {
  /** bone the item hangs from */
  parent: string;
  /** local position in that bone's frame */
  pos: V3;
  /** orientation as Euler degrees (XYZ) … */
  rot?: V3;
  /** … or as the directions two of the item's own axes should point (in the parent bone's frame) */
  axes?: { x?: V3; y?: V3; z?: V3 };
}

const _mx = new THREE.Vector3(), _my = new THREE.Vector3(), _mz = new THREE.Vector3();
const _mm = new THREE.Matrix4();
const _me = new THREE.Euler();

/** Orientation of a mount as a quaternion. */
export function mountQuat(m: Mount, out: THREE.Quaternion): THREE.Quaternion {
  const a = m.axes;
  if (!a) {
    const r = m.rot ?? [0, 0, 0];
    return out.setFromEuler(_me.set((r[0] * Math.PI) / 180, (r[1] * Math.PI) / 180, (r[2] * Math.PI) / 180, 'XYZ'));
  }
  if (a.z && a.x) { _mz.set(...a.z).normalize(); _my.crossVectors(_mz, _mx.set(...a.x)).normalize(); _mx.crossVectors(_my, _mz); }
  else if (a.z && a.y) { _mz.set(...a.z).normalize(); _mx.crossVectors(_my.set(...a.y), _mz).normalize(); _my.crossVectors(_mz, _mx); }
  else if (a.x && a.y) { _my.set(...a.y).normalize(); _mz.crossVectors(_mx.set(...a.x), _my).normalize(); _mx.crossVectors(_my, _mz); }
  else return out.identity();
  return out.setFromRotationMatrix(_mm.makeBasis(_mx, _my, _mz));
}

export interface ItemDef {
  /** equipment bone the item's geometry is bound to */
  bone: 'weapon' | 'gun' | 'shield' | 'prop';
  held: Mount;
  /** where it lives when not held; null = hidden */
  sheath: Mount | null;
  /** two-handed: off-hand grip point in the item's own frame (grip at origin, −Z forward) */
  grip2?: V3;
  /** off-hand rotation relative to the main hand (Euler degrees) */
  grip2Rot?: V3;
  /** Verity: blades retract into the hilt ring when sheathed; [start, length] of a blade along ±Z */
  blades?: readonly [number, number];
  /** named points in the item's frame (weaponTip, weaponMid, weaponBase, muzzle) */
  sockets?: Record<string, V3>;
  /** this ranged item is a long gun (prop:'rifle' also shows it) */
  rifle?: boolean;
  /** half-thickness of the item where it rests on the floor after being dropped */
  rest?: number;
}

/** A rigid extra mesh parented to a bone (shield energy field, halo). */
export interface OverlayDef {
  bone: string;
  geometry: THREE.BufferGeometry;
  color: number;
  intensity: number;
  opacity: number;
  /** hidden together with this loadout item */
  with?: 'shield' | 'melee';
}

export interface Loadout { melee: boolean; ranged: boolean; shield: boolean; prop: 'case' | 'rifle' | 'none'; hideSheathed?: boolean }

export interface FigureDraft {
  items: { melee?: ItemDef; ranged?: ItemDef; shield?: ItemDef; case?: ItemDef };
  cloth: ClothDef[];
  overlays: OverlayDef[];
  moveset: Moveset | null;
  loadout: Loadout;
  ghost: boolean;
  luminous: number;
  corruption: number;
  rim: { color: number; amount: number };
  /** resting head offset in degrees [pitch fwd, yaw left, roll right] */
  headBias: V3;
  breath: number;
  radius: number;
  /** torso collision inflation for cloth (armour bulk) */
  girth: number;
  /** camera distances (m) at which the figure drops to its lower levels of detail */
  lodDist: readonly [number, number];
}

export interface BuildCtx {
  b: MeshBuilder;
  rig: RigView;
  spec: RigSpec;
  rng: () => number;
  seed: number;
  variant: number;
  draft: FigureDraft;
}

export interface ArchetypeDef {
  proportions(rng: () => number, variant: number): Proportions;
  build(ctx: BuildCtx): void;
  /**
   * How many structurally different bodies `seed` can select (default 1: the seed only tints and scales the
   * instance). Rank-and-file archetypes use a handful so squads vary without a geometry build per spawn.
   */
  seedBuckets?: number;
  /** detail levels built below full (default [0.5, 0.25]); [] = single mesh */
  lods?: readonly number[];
}

export interface FigureDef extends FigureDraft {
  archetype: HumanoidArchetype;
  /** full-detail geometry; null for a mesh-less driver */
  geometry: THREE.BufferGeometry | null;
  /** lower levels of detail, nearest first (same skeleton) */
  lods: THREE.BufferGeometry[];
  spec: RigSpec;
  triangles: number;
  moveset: Moveset;
  key: string;
  refs: number;
  stamp: number;
}

const cache = new Map<string, FigureDef>();
let clock = 0;
/** unreferenced figures kept warm before the oldest is disposed */
const KEEP_UNUSED = 24;
const DEFAULT_LODS: readonly number[] = [0.5, 0.25];

function newDraft(): FigureDraft {
  return {
    items: {}, cloth: [], overlays: [], moveset: null,
    loadout: { melee: false, ranged: false, shield: false, prop: 'none', hideSheathed: false },
    ghost: false, luminous: 0, corruption: 0, rim: { color: 0xa9c6ff, amount: 0.22 },
    headBias: [0, 0, 0], breath: 1, radius: 0.4, girth: 1, lodDist: [9, 20],
  };
}

/** The structural seed an archetype actually builds for `seed` (see ArchetypeDef.seedBuckets). */
export function structuralSeed(def: ArchetypeDef, seed: number): number {
  const n = Math.max(1, Math.floor(def.seedBuckets ?? 1));
  return ((seed % n) + n) % n;
}

/**
 * Build (or fetch) a figure. `mask`: when given, only the listed geometry groups are sculpted ('cloth', 'melee',
 * 'ranged', 'shield', 'case'); an empty mask yields a mesh-less driver with rig, sockets and cloth particles.
 */
export function getFigure(archetype: HumanoidArchetype, def: ArchetypeDef, fallbackMoveset: Moveset, seed: number, variant: number, mask: ReadonlySet<string> | null = null): FigureDef {
  const sseed = structuralSeed(def, seed);
  const key = `${archetype}|${sseed}|${variant}|${mask ? [...mask].sort().join('+') || '-' : '*'}`;
  const hit = cache.get(key);
  if (hit) { hit.stamp = ++clock; return hit; }
  const seedHash = (hashString(archetype) ^ Math.imul(sseed + 1, 2654435761) ^ Math.imul(variant + 7, 40503)) >>> 0;
  const build = (detail: number): { b: MeshBuilder; spec: RigSpec; draft: FigureDraft } => {
    const rng = mulberry32(seedHash);
    const spec = buildRigSpec(def.proportions(rng, variant));
    const b = new MeshBuilder(detail, mask);
    const draft = newDraft();
    def.build({ b, rig: new RigView(spec), spec, rng, seed: sseed, variant, draft });
    return { b, spec, draft };
  };
  const top = build(1);
  const empty = top.b.triangleCount === 0;
  const lods: THREE.BufferGeometry[] = [];
  if (!empty) {
    for (const q of def.lods ?? DEFAULT_LODS) {
      const lo = build(q);
      // a level is only usable on the shared skeleton if it produced the same bones
      if (lo.spec.names.length === top.spec.names.length && lo.b.triangleCount > 0) lods.push(lo.b.build());
      for (const o of lo.draft.overlays) o.geometry.dispose();
    }
  }
  const fig: FigureDef = {
    ...top.draft, archetype, geometry: empty ? null : top.b.build(), lods, spec: top.spec, triangles: top.b.triangleCount,
    moveset: top.draft.moveset ?? fallbackMoveset, key, refs: 0, stamp: ++clock,
  };
  cache.set(key, fig);
  trim();
  return fig;
}

function disposeFigure(fig: FigureDef): void {
  fig.geometry?.dispose();
  for (const g of fig.lods) g.dispose();
  for (const o of fig.overlays) o.geometry.dispose();
  cache.delete(fig.key);
}

function trim(): void {
  const idle = [...cache.values()].filter((f) => f.refs <= 0).sort((a, b) => a.stamp - b.stamp);
  for (let i = 0; i < idle.length - KEEP_UNUSED; i++) disposeFigure(idle[i]);
}

/** A visual holds its figure for as long as it lives. */
export function retainFigure(fig: FigureDef): void { fig.refs++; fig.stamp = ++clock; }
export function releaseFigure(fig: FigureDef): void { fig.refs = Math.max(0, fig.refs - 1); fig.stamp = ++clock; trim(); }

/** Dispose every cached figure no live visual uses (call on zone unload). Returns how many were freed. */
export function releaseUnusedFigures(): number {
  let n = 0;
  for (const f of [...cache.values()]) if (f.refs <= 0) { disposeFigure(f); n++; }
  return n;
}

/** Cache statistics (debug overlays / tests). */
export function figureCacheStats(): { figures: number; referenced: number; triangles: number } {
  let referenced = 0, triangles = 0;
  for (const f of cache.values()) { if (f.refs > 0) referenced++; triangles += f.triangles; }
  return { figures: cache.size, referenced, triangles };
}

/** Drop every cached figure (tests / hot reload). Geometry of live instances stays valid until they dispose. */
export function clearFigureCache(): void {
  cache.clear();
}
