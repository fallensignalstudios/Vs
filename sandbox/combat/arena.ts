/**
 * Combat sandbox arena: a 44 × 44 m hall of polished black stone with gold channels, white-gold ribs, a few
 * cover blocks and a low dais — built directly from physics surfaces / colliders and simple meshes.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '@/core/api';

const C = { stone: 0x0b0c10, channel: 0xffc56b, whiteGold: 0xd9d2c0, gold: 0xc9a45c, light: 0xffe2a8, bronze: 0x8a5a2b, navy: 0x1b2a44, steel: 0xc5ccd4 };

export function buildArena(scene: THREE.Scene, physics: PhysicsWorld): THREE.Group {
  const root = new THREE.Group();
  root.name = 'combatArena';
  scene.add(root);
  const H = 22;

  // floor
  physics.addSurface({ shape: { kind: 'rect', hx: H, hz: H }, x: 0, z: 0, y: 0, material: 'stone', tag: 'floor' });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(H * 2, H * 2),
    new THREE.MeshStandardMaterial({ color: C.stone, roughness: 0.34, metalness: 0.1, envMapIntensity: 1.1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // gold channels: narrow emissive lines every 4 m
  const channelMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.channel, emissiveIntensity: 1.6 });
  const channels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.006, 0.035), channelMat, 22);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let k = -5; k <= 5; k++) {
    m.makeScale(H * 2, 1, 1).setPosition(0, 0.003, k * 4);
    channels.setMatrixAt(n++, m);
    m.makeRotationY(Math.PI / 2).scale(new THREE.Vector3(H * 2, 1, 1)).setPosition(k * 4, 0.003, 0);
    channels.setMatrixAt(n++, m);
  }
  root.add(channels);

  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, solid = true, cover?: 'low' | 'high') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (solid) physics.addCollider({ shape: { kind: 'box', hx: sx / 2, hy: sy / 2, hz: sz / 2 }, x, y, z, cover });
    return mesh;
  };

  // perimeter walls + white-gold ribs with warm light seams
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.3 });
  const ribMat = new THREE.MeshStandardMaterial({ color: C.whiteGold, roughness: 0.38, metalness: 0.55 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.light, emissiveIntensity: 2.6 });
  box(0, 5, -H - 0.5, H * 2 + 2, 10, 1, wallMat);
  box(0, 5, H + 0.5, H * 2 + 2, 10, 1, wallMat);
  box(-H - 0.5, 5, 0, 1, 10, H * 2 + 2, wallMat);
  box(H + 0.5, 5, 0, 1, 10, H * 2 + 2, wallMat);
  for (let i = -2; i <= 2; i++) {
    box(i * 8, 5, -H + 0.1, 1.2, 10, 0.8, ribMat, false);
    box(i * 8, 5, -H + 0.52, 0.12, 9.2, 0.05, seamMat, false);
    box(-H + 0.1, 5, i * 8, 0.8, 10, 1.2, ribMat, false);
    box(-H + 0.52, 5, i * 8, 0.05, 9.2, 0.12, seamMat, false);
    box(H - 0.1, 5, i * 8, 0.8, 10, 1.2, ribMat, false);
    box(H - 0.52, 5, i * 8, 0.05, 9.2, 0.12, seamMat, false);
  }

  // faction cover: low (1.2 m) and high (2.2 m)
  const dom = new THREE.MeshStandardMaterial({ color: C.bronze, roughness: 0.45, metalness: 0.7 });
  const ref = new THREE.MeshStandardMaterial({ color: C.navy, roughness: 0.4, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: C.steel, roughness: 0.3, metalness: 0.8 });
  box(-9, 0.6, 6, 3, 1.2, 0.9, dom, true, 'low');
  box(9, 0.6, 6, 3, 1.2, 0.9, ref, true, 'low');
  box(-12, 1.1, -3, 1, 2.2, 3, dom, true, 'high');
  box(12, 1.1, -3, 1, 2.2, 3, ref, true, 'high');
  box(12, 2.25, -3, 1.04, 0.06, 3.04, steel, false);
  box(0, 1.6, -14, 2.2, 3.2, 2.2, ribMat, true, 'high');

  // lights: warm key with shadows, cool rim, low ambient so emissives and VFX carry the frame
  scene.add(new THREE.HemisphereLight(0xb9c8ff, 0x1a1208, 0.35));
  const key = new THREE.DirectionalLight(0xffe6c4, 2.4);
  key.position.set(9, 16, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = key.shadow.camera;
  s.left = -24; s.right = 24; s.top = 24; s.bottom = -24; s.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
  rim.position.set(-7, 20, -9);
  scene.add(rim);
  return root;
}
