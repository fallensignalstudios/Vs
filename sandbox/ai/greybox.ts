/**
 * Greybox stage for the AI sandbox: every surface and solid added to the physics world through the recorder is
 * also drawn as a simple mesh, so a physics fixture (Z04, Z08) or a hand-built hall becomes a visible arena.
 */
import * as THREE from 'three';
import type { ColliderDesc, ColliderHandle, PhysicsWorld, SurfaceDesc, SurfaceHandle } from '@/core/api';

const C = { stone: 0x0d0f14, wall: 0x171a21, rib: 0xd9d2c0, channel: 0xffc56b, low: 0x6a5132, high: 0x25344d, kerb: 0x2a2d35, light: 0xffe2a8 };

export interface Greybox {
  /** physics world that records what is added to it */
  physics: PhysicsWorld;
  root: THREE.Group;
  /** build meshes for everything recorded since the last call */
  flush(): void;
  /** remove every mesh (the physics world is cleared by its owner) */
  clear(): void;
}

export function createGreybox(scene: THREE.Scene, real: PhysicsWorld): Greybox {
  const root = new THREE.Group();
  root.name = 'greybox';
  scene.add(root);
  const colliders: Array<{ desc: ColliderDesc; handle: ColliderHandle }> = [];
  const surfaces: SurfaceDesc[] = [];
  const mats = {
    floor: new THREE.MeshStandardMaterial({ color: C.stone, roughness: 0.32, metalness: 0.15, envMapIntensity: 1.2 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.45, metalness: 0.4 }),
    wall: new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.55, metalness: 0.25 }),
    low: new THREE.MeshStandardMaterial({ color: C.low, roughness: 0.5, metalness: 0.6 }),
    high: new THREE.MeshStandardMaterial({ color: C.high, roughness: 0.45, metalness: 0.55 }),
    kerb: new THREE.MeshStandardMaterial({ color: C.kerb, roughness: 0.5, metalness: 0.4 }),
    seam: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.channel, emissiveIntensity: 1.5 }),
    door: new THREE.MeshStandardMaterial({ color: C.rib, roughness: 0.4, metalness: 0.5 }),
  };

  const physics = new Proxy(real, {
    get(t, p, r) {
      if (p === 'addCollider') {
        return (desc: ColliderDesc) => {
          const handle = t.addCollider(desc);
          colliders.push({ desc: { ...desc }, handle });
          return handle;
        };
      }
      if (p === 'addSurface') {
        return (desc: SurfaceDesc): SurfaceHandle => {
          surfaces.push({ ...desc });
          return t.addSurface(desc);
        };
      }
      const v = Reflect.get(t, p, r);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }) as PhysicsWorld;

  function flush(): void {
    for (const s of surfaces) {
      let mesh: THREE.Mesh;
      const raised = s.y > 0.5 || (s.y1 ?? s.y) > 0.5;
      if (s.shape.kind === 'rect') {
        const g = new THREE.PlaneGeometry(s.shape.hx * 2, s.shape.hz * 2, 1, 1);
        g.rotateX(-Math.PI / 2);
        if (s.y1 !== undefined) {
          // ramp: y at local −Z, y1 at local +Z
          const pos = g.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getZ(i) > 0 ? s.y1 - s.y : 0);
          g.computeVertexNormals();
        }
        mesh = new THREE.Mesh(g, raised ? mats.deck : mats.floor);
        // gold channels along the long axis of big floors
        if (!raised && s.shape.hx > 8 && s.shape.hz > 8) {
          const n = Math.floor((s.shape.hz * 2) / 6);
          const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(s.shape.hx * 2, 0.006, 0.04), mats.seam, n);
          const m = new THREE.Matrix4();
          for (let i = 0; i < n; i++) inst.setMatrixAt(i, m.makeTranslation(0, 0.004, -s.shape.hz + 3 + i * 6));
          mesh.add(inst);
        }
      } else {
        const g = new THREE.RingGeometry(s.shape.inner ?? 0, s.shape.r, 64);
        g.rotateX(-Math.PI / 2);
        mesh = new THREE.Mesh(g, mats.floor);
      }
      mesh.position.set(s.x, s.y + (raised ? 0.01 : 0), s.z);
      mesh.rotation.y = s.yaw ?? 0;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    surfaces.length = 0;
    for (const { desc: c, handle } of colliders) {
      if (handle.enabled === false) continue;
      const tag = c.tag ?? '';
      const mat = c.cover === 'low' ? mats.low : c.cover === 'high' ? mats.high : tag === 'kerb' ? mats.kerb : tag === 'door' ? mats.door : mats.wall;
      let mesh: THREE.Mesh;
      if (c.shape.kind === 'box') mesh = new THREE.Mesh(new THREE.BoxGeometry(c.shape.hx * 2, c.shape.hy * 2, c.shape.hz * 2), mat);
      else mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.shape.r, c.shape.r, c.shape.hy * 2, 20), mat);
      if (tag === 'ramp-fill' || tag === 'receiverA' || tag === 'receiverB' || tag === 'scanHead') continue;
      mesh.position.set(c.x, c.y, c.z);
      mesh.rotation.y = c.yaw ?? 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
    colliders.length = 0;
  }

  function clear(): void {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    root.clear();
    colliders.length = 0;
    surfaces.length = 0;
  }

  return { physics, root, flush, clear };
}

/** a rectangular hall: floor x0..x1 × z0..z1 at y 0 with 8 m walls and white-gold ribs along the long sides */
export function hall(g: Greybox, x0: number, z0: number, x1: number, z1: number): void {
  const p = g.physics;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  p.addSurface({ shape: { kind: 'rect', hx, hz }, x: cx, z: cz, y: 0, material: 'stone', tag: 'floor' });
  const wall = (x: number, z: number, wx: number, wz: number) => p.addCollider({ shape: { kind: 'box', hx: wx, hy: 4, hz: wz }, x, y: 4, z, tag: 'wall' });
  wall(cx, z0 - 0.5, hx + 1, 0.5);
  wall(cx, z1 + 0.5, hx + 1, 0.5);
  wall(x0 - 0.5, cz, 0.5, hz + 1);
  wall(x1 + 0.5, cz, 0.5, hz + 1);
  // ribs with warm seams: dressing only
  const rib = new THREE.MeshStandardMaterial({ color: C.rib, roughness: 0.38, metalness: 0.55 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: C.light, emissiveIntensity: 2.4 });
  const n = Math.max(2, Math.round((x1 - x0) / 8));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    for (const z of [z0 + 0.25, z1 - 0.25]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 8, 0.5), rib);
      m.position.set(x, 4, z);
      g.root.add(m);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 7.4, 0.04), seam);
      s.position.set(x, 4, z + (z < cz ? 0.27 : -0.27));
      g.root.add(s);
    }
  }
}

/** a cover block (low 1.2 m / high 2.2 m) */
export function coverBlock(g: Greybox, x: number, z: number, wx: number, wz: number, kind: 'low' | 'high'): void {
  const h = kind === 'low' ? 1.2 : 2.2;
  g.physics.addCollider({ shape: { kind: 'box', hx: wx / 2, hy: h / 2, hz: wz / 2 }, x, y: h / 2, z, cover: kind, tag: 'cover' });
}
