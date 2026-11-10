// Copy this folder to sandbox/<your-subsystem>/ and build your test scene here.
import * as THREE from 'three';
import { createHarness } from '../harness';

const h = createHarness({ bloom: true, env: 'studio', ground: true });
const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.4, metalness: 0.6 }));
box.position.y = 0.5;
box.castShadow = true;
h.scene.add(box);
h.onUpdate((dt) => { box.rotation.y += dt; });
h.ready();
