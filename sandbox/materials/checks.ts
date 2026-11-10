/**
 * Verification scenes:
 *   hall   — a 60 m hall to judge tiling repetition / macro variation at distance
 *   moving — object-space mapping on a moving mesh, instancing (world + object), a skinned mesh, non-uniform scale
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '@/core/api';
import type { Harness } from '../harness';
import { bevelledSlab, box, label, ribSegment } from './shapes';

type V3 = [number, number, number];

export function buildHall(h: Harness, mats: MaterialLibrary): Record<string, unknown> {
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: V3): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.receiveShadow = true; m.castShadow = true; h.scene.add(m); return m;
  };
  add(box(12, 0.4, 64), mats.get('whiteGoldFloor'), [-6, -0.2, -28]);
  add(box(12, 0.4, 64), mats.get('blackStoneFloor'), [6, -0.2, -28]);
  add(box(0.6, 10, 64), mats.get('whiteGoldPanel'), [-12.3, 5, -28]);
  add(box(0.6, 10, 64), mats.get('blackStone'), [12.3, 5, -28]);
  add(box(25, 10, 0.6), mats.get('whiteGold'), [0, 5, -60.3]);
  const rib = ribSegment(6, 0.8, 1.1);
  for (let z = -4; z > -60; z -= 9) {
    add(rib, mats.get('whiteGold'), [-12, 3.9, z]);
    const r = add(rib, mats.get('whiteGold'), [0, 3.9, z]); r.scale.x = -1;
    add(box(0.05, 0.03, 9), mats.get('goldChannel'), [6, 0.01, z]);
    add(box(0.04, 6, 0.06), mats.get('goldChannel'), [11.98, 3.4, z]);
  }
  const views: Record<string, [V3, V3, number]> = {
    eye: [[-1, 1.7, 3], [0, 1.4, -40], 62],
    high: [[0, 9, 4], [0, 0, -34], 55],
    whitegold: [[-4, 1.7, 2], [-9, 1.2, -40], 55],
    blackstone: [[4, 1.7, 2], [9, 1.2, -40], 55],
    top: [[0, 46, -28], [0, 0, -28.01], 50],
  };
  h.setCam(views.eye[0], views.eye[1], views.eye[2]);
  return { __view: (name: string): string => { const v = views[name] ?? views.eye; h.setCam(v[0], v[1], v[2]); return name; } };
}

export function buildMoving(h: Harness, mats: MaterialLibrary): Record<string, unknown> {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), mats.get('whiteGoldFloor'));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; h.scene.add(floor);
  const tag = (text: string, x: number, z: number): void => { const l = label(text, 2.2); l.position.set(x, 0.012, z); h.scene.add(l); };

  // 1. the same crate twice: object-space (texture rides along) vs world-space (texture swims)
  const crateGeo = box(1.2, 1.2, 1.2);
  const local = new THREE.Mesh(crateGeo, mats.getLocal('refNavy'));
  const world = new THREE.Mesh(crateGeo, mats.get('refNavy'));
  h.scene.add(local, world);
  tag('getLocal — moves with mesh', -4.5, 2.2); tag('get — world-space (static only)', -1.5, 2.2);

  // 2. instancing: one draw call each, world-mapped (static dressing) and object-mapped
  const dummy = new THREE.Object3D();
  const slab = bevelledSlab(0.8, 1.0, 0.3, 0.05);
  const instWorld = new THREE.InstancedMesh(slab, mats.get('domBronze'), 5);
  const instLocal = new THREE.InstancedMesh(slab, mats.getLocal('domBronze'), 5);
  for (let i = 0; i < 5; i++) {
    dummy.position.set(1.6 + i * 1.0, 0, -0.6); dummy.rotation.set(0, i * 0.5, 0); dummy.scale.setScalar(0.8 + i * 0.1); dummy.updateMatrix();
    instWorld.setMatrixAt(i, dummy.matrix);
    dummy.position.z = 1.2; dummy.updateMatrix();
    instLocal.setMatrixAt(i, dummy.matrix);
  }
  h.scene.add(instWorld, instLocal);
  tag('instanced · world', 3.6, -1.5); tag('instanced · object', 3.6, 2.2);

  // 3. skinned mesh using the plain shared material: must switch to object space by itself
  const segs = 24, height = 2.4;
  const cyl = new THREE.CylinderGeometry(0.28, 0.34, height, 24, segs);
  cyl.translate(0, height / 2, 0);
  cyl.deleteAttribute('uv');
  const pos = cyl.getAttribute('position');
  const skinIndex: number[] = [], skinWeight: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) / height - 0.35) / 0.3, 0, 1);
    skinIndex.push(0, 1, 0, 0); skinWeight.push(1 - t, t, 0, 0);
  }
  cyl.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  cyl.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const b0 = new THREE.Bone(), b1 = new THREE.Bone();
  b1.position.y = height / 2; b0.add(b1);
  const skinned = new THREE.SkinnedMesh(cyl, mats.get('domOxblood'));
  skinned.add(b0); skinned.bind(new THREE.Skeleton([b0, b1]));
  skinned.position.set(8.5, 0, 0.2); skinned.castShadow = true;
  h.scene.add(skinned);
  tag('skinned · auto object-space', 8.5, 2.2);

  // 4. non-uniform scale in object space: texel density must stay in metres
  const long = new THREE.Mesh(box(1, 1, 1), mats.getLocal('refSteel'));
  long.scale.set(4, 0.6, 0.5); long.position.set(-3, 0.3, -2.6); long.rotation.y = 0.2; h.scene.add(long);
  tag('scaled 4 × 0.6 × 0.5 · object', -3, -1.6);

  h.onUpdate((_dt, t) => {
    const s = Math.sin(t * 0.9);
    local.position.set(-4.5 + s * 0.6, 0.6 + Math.abs(Math.sin(t * 1.4)) * 0.5, 0.4); local.rotation.set(t * 0.4, t * 0.7, 0);
    world.position.set(-1.5 + s * 0.6, 0.6 + Math.abs(Math.sin(t * 1.4)) * 0.5, 0.4); world.rotation.copy(local.rotation);
    b1.rotation.z = Math.sin(t * 1.1) * 1.0;
  });
  h.setCam([2, 5.5, 9.5], [2, 0.6, 0], 46);
  return {};
}
