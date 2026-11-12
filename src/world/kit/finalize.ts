/**
 * finalize(): bake every static kit mesh into one mesh per material (per 64 m cell: kit geometry is light, so
 * draw calls matter more than culling), turn big repeated pieces into InstancedMesh, register polished floors, compute bounds.
 */
import * as THREE from 'three';
import type { KitCtx } from './core';

const CELL = 64;
/** repeats of one geometry become an InstancedMesh from this many copies / vertices */
const INSTANCE_MIN_COUNT = 4;
const INSTANCE_MIN_VERTS = 900;

export interface MergeResult {
  /** merged + instanced meshes created by this pass */
  meshes: THREE.Mesh[];
  triangles: number;
  /** source meshes consumed */
  merged: number;
}

/**
 * fix & ship: a hidden subtree (the mesh or any parent invisible when the bake runs) is never baked — a merged mesh
 * always draws, so the hidden piece would show. Its static marks are dropped: it stays a live object that a script
 * can show later, and a later merge pass (addStatic after finalize) does not bake it either.
 */
function releaseHidden(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c.userData.kitStatic === true) {
      c.userData.kitStatic = false;
      c.userData.kitHiddenAtBake = true;
    }
  });
}

function collectStatics(root: THREE.Object3D, out: THREE.Mesh[], expanded = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()): void {
  for (const child of root.children) {
    if (child.userData.kitKeep) continue;
    if (!child.visible) {
      releaseHidden(child);
      continue;
    }
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh
      && mesh.userData.kitStatic === true && !Array.isArray(mesh.material) && mesh.geometry?.getAttribute('position')) {
      // polish 4: `addStatic` accepts any mesh — indexed geometry and meshes without normals are made mergeable
      // (one expanded copy per source geometry, so repeats still share it and can become instances)
      if (mesh.geometry.index) {
        let g = expanded.get(mesh.geometry);
        if (!g) {
          g = mesh.geometry.toNonIndexed();
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          g.userData.kitExpanded = true;
          expanded.set(mesh.geometry, g);
        }
        mesh.geometry = g;
      }
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      out.push(mesh);
    }
    if (child.children.length) collectStatics(child, out, expanded);
  }
}

/**
 * Merge all static kit meshes under the zone root. Sources are removed from the scene graph; their per-piece
 * geometry is disposed (shared prop / rib templates stay cached for later placements).
 */
export function mergeStatics(ctx: KitCtx, container: THREE.Group): MergeResult {
  const root = ctx.root;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const statics: THREE.Mesh[] = [];
  collectStatics(root, statics);
  const result: MergeResult = { meshes: [], triangles: 0, merged: statics.length };
  if (!statics.length) return result;

  const local = new THREE.Matrix4(), nm = new THREE.Matrix3(), c = new THREE.Vector3();
  // polish 4: meshes from `addStatic` (and the kit's vertex-coloured glows) carry more than position + normal: the
  // extra attributes they share (uv, color, …) are part of the group key and are merged too; indexed geometry is
  // expanded first
  const extras = (m: THREE.Mesh): string[] => Object.keys(m.geometry.attributes).filter((k) => k !== 'position' && k !== 'normal').sort();
  const flags = (m: THREE.Mesh): string => `${(m.material as THREE.Material).uuid}|${m.castShadow ? 1 : 0}|${m.layers.mask}|${extras(m).join(',')}|${m.renderOrder}`;

  // ---- pass 1: big repeated geometry → InstancedMesh ----------------------------------------------------
  const byGeo = new Map<string, THREE.Mesh[]>();
  for (const m of statics) {
    if (m.userData.kitReflectY !== undefined) continue;
    if (m.geometry.getAttribute('position').count < INSTANCE_MIN_VERTS && m.userData.kitInstance !== true) continue;
    const key = `${m.geometry.uuid}|${flags(m)}`;
    let list = byGeo.get(key);
    if (!list) byGeo.set(key, (list = []));
    list.push(m);
  }
  const instanced = new Set<THREE.Mesh>();
  for (const list of byGeo.values()) {
    // polish 4: `addStatic(obj, { instance: true })` asks for instancing from two copies of any size
    const want = list[0].userData.kitInstance === true ? 2 : INSTANCE_MIN_COUNT;
    if (list.length < want) continue;
    const first = list[0];
    const inst = new THREE.InstancedMesh(first.geometry, first.material, list.length);
    for (let i = 0; i < list.length; i++) {
      inst.setMatrixAt(i, local.multiplyMatrices(inv, list[i].matrixWorld));
      instanced.add(list[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.computeBoundingBox();
    inst.castShadow = first.castShadow;
    inst.receiveShadow = first.receiveShadow;
    inst.layers.mask = first.layers.mask;
    inst.name = `kit-instanced:${(first.material as THREE.Material).name || 'mat'}`;
    inst.userData.kitMerged = true;
    inst.matrixAutoUpdate = false;
    container.add(inst);
    result.meshes.push(inst);
    result.triangles += (first.geometry.getAttribute('position').count / 3) * list.length;
  }

  // ---- pass 2: everything else → one mesh per material / flags / cell ------------------------------------
  const groups = new Map<string, { list: THREE.Mesh[]; verts: number; reflectY: number | null }>();
  for (const m of statics) {
    if (instanced.has(m)) continue;
    const reflectY = typeof m.userData.kitReflectY === 'number' ? (m.userData.kitReflectY as number) : null;
    let key = flags(m);
    if (reflectY !== null) key += `|r${reflectY.toFixed(3)}`;
    else {
      const bs = m.geometry.boundingSphere ?? (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere)!;
      c.copy(bs.center).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      key += `|${Math.floor(c.x / CELL)}:${Math.floor(c.z / CELL)}`;
    }
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { list: [], verts: 0, reflectY }));
    g.list.push(m);
    g.verts += m.geometry.getAttribute('position').count;
  }
  for (const g of groups.values()) {
    const pos = new Float32Array(g.verts * 3), nor = new Float32Array(g.verts * 3);
    const names = extras(g.list[0]);
    const extra = names.map((k) => {
      const a = g.list[0].geometry.getAttribute(k);
      return { k, size: a.itemSize, norm: a.normalized, out: new Float32Array(g.verts * a.itemSize), o: 0 };
    });
    let o = 0;
    for (const m of g.list) {
      local.multiplyMatrices(inv, m.matrixWorld);
      nm.getNormalMatrix(local);
      const e = local.elements, n = nm.elements;
      const sp = m.geometry.getAttribute('position').array as ArrayLike<number>, sn = m.geometry.getAttribute('normal').array as ArrayLike<number>;
      for (const x of extra) {
        const a = m.geometry.getAttribute(x.k);
        const count = m.geometry.getAttribute('position').count;
        for (let i = 0; i < count; i++) for (let j = 0; j < x.size; j++) x.out[x.o++] = a.getComponent(i, j);
      }
      for (let i = 0; i < sp.length; i += 3, o += 3) {
        const x = sp[i], y = sp[i + 1], z = sp[i + 2];
        pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
        pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const a = sn[i], b = sn[i + 1], d = sn[i + 2];
        const nx = n[0] * a + n[3] * b + n[6] * d, ny = n[1] * a + n[4] * b + n[7] * d, nz = n[2] * a + n[5] * b + n[8] * d;
        const l = Math.hypot(nx, ny, nz) || 1;
        nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    for (const x of extra) geo.setAttribute(x.k, new THREE.BufferAttribute(x.out, x.size, x.norm));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const first = g.list[0];
    const mesh = new THREE.Mesh(ctx.own(geo), first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.name = `kit-merged:${(first.material as THREE.Material).name || 'mat'}`;
    mesh.userData.kitMerged = true;
    mesh.matrixAutoUpdate = false;
    if (g.reflectY !== null) mesh.userData.kitReflectY = g.reflectY;
    container.add(mesh);
    result.meshes.push(mesh);
    result.triangles += g.verts / 3;
  }

  // ---- retire the sources ------------------------------------------------------------------------------
  const parents = new Set<THREE.Object3D>();
  for (const m of statics) {
    if (m.parent) parents.add(m.parent);
    m.removeFromParent();
    // (geometry a zone handed to `addStatic` is the zone's: it may be shared with live meshes, so only the
    // expanded copies made here are freed)
    const foreign = m.userData.kitForeign === true && !m.geometry.userData.kitExpanded;
    if (!instanced.has(m) && !m.geometry.userData.kitTemplate && !foreign) {
      m.geometry.dispose();
      ctx.disposables.delete(m.geometry);
    }
  }
  // a piece's handle stays in the scene (authors may have attached things to it); it just stops updating
  for (const p of parents) {
    if (!p.userData.kitPart) continue;
    p.updateMatrix();
    p.matrixAutoUpdate = false;
  }
  container.updateMatrixWorld(true);
  return result;
}

/** Bounds (zone-root space) of everything the kit built. */
export function computeBounds(meshes: Iterable<THREE.Object3D>, out: THREE.Box3): THREE.Box3 {
  const box = new THREE.Box3();
  for (const o of meshes) {
    const m = o as THREE.Mesh;
    const bb = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).boundingBox : m.geometry?.boundingBox;
    if (bb && !bb.isEmpty()) out.union(box.copy(bb));
  }
  if (out.isEmpty()) out.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 6, 10));
  return out;
}
