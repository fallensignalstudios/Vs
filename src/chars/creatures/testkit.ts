/**
 * Test-only helpers for the creature suites: stepping, CPU skinning (so tests can measure where the visible
 * surface actually is, not just where bones are), and pose finiteness.
 */
import * as THREE from 'three';
import type { CharacterVisual } from '@/core/api';

export const STEP = 1 / 60;

export function run(v: CharacterVisual, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    v.update(STEP);
    each?.((i + 1) * STEP);
  }
}

export function mesh(v: CharacterVisual): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  v.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible && !found) found = o as THREE.SkinnedMesh; });
  if (!found) throw new Error('no skinned mesh');
  return found;
}

export function finitePose(v: CharacterVisual): boolean {
  let ok = true;
  v.root.traverse((o) => {
    const p = o.position, q = o.quaternion, s = o.scale;
    if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].every(Number.isFinite)) ok = false;
  });
  return ok;
}

export interface SkinnedBounds {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** lowest world Y of the vertices carried by each bone (primary influence) */
  boneMinY: Map<string, number>;
  /** highest world Y per bone */
  boneMaxY: Map<string, number>;
}

/** World-space bounds of the skinned surface in its current pose (scaled-away parts are ignored). */
export function skinnedBounds(v: CharacterVisual, stride = 1): SkinnedBounds {
  const m = mesh(v);
  v.root.updateMatrixWorld(true);
  m.skeleton.update();
  const pos = m.geometry.getAttribute('position'), si = m.geometry.getAttribute('skinIndex');
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  const out: SkinnedBounds = { min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), boneMinY: new Map(), boneMaxY: new Map() };
  const hidden = m.skeleton.bones.map((b) => s.setFromMatrixScale(b.matrixWorld).x < 0.01);
  for (let i = 0; i < pos.count; i += stride) {
    const bi = si.getX(i);
    if (hidden[bi]) continue;
    p.fromBufferAttribute(pos, i);
    m.applyBoneTransform(i, p);
    p.applyMatrix4(m.matrixWorld);
    out.min.min(p); out.max.max(p);
    const name = m.skeleton.bones[bi]!.name;
    out.boneMinY.set(name, Math.min(out.boneMinY.get(name) ?? Infinity, p.y));
    out.boneMaxY.set(name, Math.max(out.boneMaxY.get(name) ?? -Infinity, p.y));
  }
  return out;
}

/** names of bones whose geometry dips below `floor`, with depths — for readable assertion messages */
export function sunk(b: SkinnedBounds, floor: number): string[] {
  const out: string[] = [];
  for (const [name, y] of b.boneMinY) if (y < floor) out.push(`${name}:${(y - floor).toFixed(2)}`);
  return out;
}
