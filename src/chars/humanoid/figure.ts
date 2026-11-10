/**
 * Figure assembly + cache. An archetype definition sculpts into a MeshBuilder and fills a FigureDraft
 * (equipment mounts, cloth panels, moveset, defaults). Built figures are cached per (archetype, seed, variant)
 * so repeated spawns share geometry, rig spec and clips.
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
  /** Verity: blades retract into the hilt ring when sheathed */
  blades?: boolean;
  /** named points in the item's frame (weaponTip, weaponMid, weaponBase, muzzle) */
  sockets?: Record<string, V3>;
  /** this ranged item is a long gun (prop:'rifle' also shows it) */
  rifle?: boolean;
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

export interface Loadout { melee: boolean; ranged: boolean; shield: boolean; prop: 'case' | 'rifle' | 'none' }

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
}

export interface FigureDef extends FigureDraft {
  archetype: HumanoidArchetype;
  geometry: THREE.BufferGeometry;
  spec: RigSpec;
  triangles: number;
  moveset: Moveset;
}

const cache = new Map<string, FigureDef>();

export function getFigure(archetype: HumanoidArchetype, def: ArchetypeDef, fallbackMoveset: Moveset, seed: number, variant: number): FigureDef {
  const key = `${archetype}|${seed}|${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = mulberry32((hashString(archetype) ^ Math.imul(seed + 1, 2654435761) ^ Math.imul(variant + 7, 40503)) >>> 0);
  const prop = def.proportions(rng, variant);
  const spec = buildRigSpec(prop);
  const b = new MeshBuilder();
  const draft: FigureDraft = {
    items: {}, cloth: [], overlays: [], moveset: null,
    loadout: { melee: false, ranged: false, shield: false, prop: 'none' },
    ghost: false, luminous: 0, corruption: 0, rim: { color: 0xa9c6ff, amount: 0.22 },
    headBias: [0, 0, 0], breath: 1, radius: 0.4, girth: 1,
  };
  def.build({ b, rig: new RigView(spec), spec, rng, seed, variant, draft });
  const geometry = b.build();
  const fig: FigureDef = { ...draft, archetype, geometry, spec, triangles: b.triangleCount, moveset: draft.moveset ?? fallbackMoveset };
  cache.set(key, fig);
  return fig;
}

/** Drop every cached figure (tests / hot reload). Geometry of live instances stays valid until they dispose. */
export function clearFigureCache(): void {
  cache.clear();
}
