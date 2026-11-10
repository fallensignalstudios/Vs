// GLB inspector: /sandbox/glb/?m=<file in public/models>&env=studio|dark&yaw=<deg>&bones=1
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createHarness } from '../harness';

const q = new URLSearchParams(location.search);
const h = createHarness({ bloom: true, env: (q.get('env') as 'studio' | 'dark') ?? 'studio', ground: true, background: 0x1a1d23 });
const file = q.get('m') ?? 'tarrik.glb';
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

loader.load(
  `/models/${file}`,
  (gltf) => {
    const root = gltf.scene;
    let tris = 0;
    const bones: string[] = [];
    const mats: Array<Record<string, unknown>> = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Bone).isBone) bones.push(`${o.name}<${o.parent?.name ?? ''}`);
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        const g = m.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        const mat = m.material as THREE.MeshStandardMaterial;
        mats.push({
          name: mat.name, mesh: m.name, skinned: (m as unknown as THREE.SkinnedMesh).isSkinnedMesh === true,
          map: mat.map ? `${(mat.map.image as { width: number }).width}x${(mat.map.image as { height: number }).height}` : null,
          normal: !!mat.normalMap, rough: !!mat.roughnessMap, metal: !!mat.metalnessMap, emissive: !!mat.emissiveMap,
          roughness: mat.roughness, metalness: mat.metalness,
        });
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.y -= box.min.y;
    root.rotation.y = (Number(q.get('yaw') ?? 0) * Math.PI) / 180;
    h.scene.add(root);
    if (q.has('bones')) h.scene.add(new THREE.SkeletonHelper(root));
    const d = Math.max(size.y, size.x) * 1.25;
    h.setCam([d * 0.55, size.y * 0.62, d * 1.05], [0, size.y * 0.52, 0], 40);
    (window as any).__info = {
      file, tris: Math.round(tris), size: size.toArray().map((v) => +v.toFixed(3)), center: center.toArray().map((v) => +v.toFixed(3)),
      bones: bones.length, boneNames: bones, materials: mats, animations: gltf.animations.map((a) => `${a.name}:${a.duration.toFixed(2)}s`),
    };
    (window as any).__root = root;
    (window as any).__view = (yawDeg: number, dist = 1.05, height = 0.62, lookH = 0.52, fov = 40) => {
      const a = (yawDeg * Math.PI) / 180;
      h.setCam([Math.sin(a) * d * dist, size.y * height, Math.cos(a) * d * dist], [0, size.y * lookH, 0], fov);
      h.render();
    };
    h.ready();
  },
  undefined,
  (err) => {
    ((window as any).__aurelionErrors ??= []).push('GLB load failed: ' + String((err as Error).message ?? err));
    h.ready();
  },
);
