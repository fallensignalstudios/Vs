/**
 * Render-core showcase scene — self-built (no material library) so the image pipeline can be judged alone:
 * white-gold ribs with warm light seams, a mirror-black floor with gold emissive channels, emissive strips at
 * intensities 1.5 / 3 / 6, chrome / gold / rough spheres, a point of violet, a 1.85 m figure for scale.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RENDER_LAYERS, type RenderSystem } from '@/core/api';

export interface Showcase {
  floor: THREE.Mesh;
  upper: THREE.Mesh;
  update(dt: number, t: number): void;
}

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tiling value-noise roughness (G) + matching normal map: polished stone with faint clouding and hairlines. */
function stoneMaps(size: number): { rough: THREE.DataTexture; normal: THREE.DataTexture } {
  const r = rand(11);
  const g = 16;
  const grid = new Float32Array(g * g).map(() => r());
  const at = (x: number, y: number) => grid[((y % g) + g) % g * g + (((x % g) + g) % g)];
  const noise = (u: number, v: number, f: number) => {
    const x = u * f, y = v * f;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const s = g / f;
    const a = at(xi * s, yi * s), b = at((xi + 1) * s, yi * s), c = at(xi * s, (yi + 1) * s), d = at((xi + 1) * s, (yi + 1) * s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const height = new Float32Array(size * size);
  const rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = noise(u, v, 2) * 0.5 + noise(u, v, 4) * 0.3 + noise(u, v, 8) * 0.14 + noise(u, v, 16) * 0.06;
      height[y * size + x] = n;
      // mostly mirror (≈ 0.06), clouded patches up to ≈ 0.15
      const ro = 0.055 + Math.min(0.1, Math.pow(Math.max(0, n - 0.42) * 2.2, 2) * 0.3);
      const i = (y * size + x) * 4;
      rough[i] = 255;
      rough[i + 1] = Math.min(255, Math.round(ro * 255));
      rough[i + 2] = 0;
      rough[i + 3] = 255;
    }
  }
  const normal = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 1.2;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 1.2;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  }
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 10);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { rough: mk(rough), normal: mk(normal) };
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};

export function buildShowcase(scene: THREE.Scene, render: RenderSystem, opts: { reflect: boolean; strength: number }): Showcase {
  const root = new THREE.Group();
  root.name = 'showcase';
  scene.add(root);

  // ---- materials --------------------------------------------------------------------------------------
  const maps = stoneMaps(256);
  const blackStone = new THREE.MeshStandardMaterial({
    color: 0x0b0c10, roughness: 1, metalness: 0, roughnessMap: maps.rough, normalMap: maps.normal,
    normalScale: new THREE.Vector2(0.18, 0.18),
  });
  const blackWall = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.28, metalness: 0.05 });
  const whiteGold = new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.42, metalness: 0.35 });
  const goldTrim = new THREE.MeshStandardMaterial({ color: 0xc9a45c, roughness: 0.22, metalness: 1 });
  const emissive = (color: number, intensity: number) =>
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1, metalness: 0 });
  const channel = emissive(0xffc56b, 3);
  const seam = emissive(0xffe2a8, 3);

  // ---- floors -----------------------------------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.BoxGeometry(70, 0.5, 90), blackStone);
  floor.position.set(0, -0.25, -14);
  floor.receiveShadow = true;
  floor.name = 'floor';
  root.add(floor);

  // raised side gallery (+3 m) with its own polished floor: tests "one plane at a time"
  const upper = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 44), blackStone);
  upper.position.set(-17.5, 2.8, -14);
  upper.receiveShadow = true;
  upper.castShadow = true;
  upper.name = 'upperFloor';
  root.add(upper);

  if (opts.reflect) {
    render.registerReflectiveFloor(floor, { strength: opts.strength });
    render.registerReflectiveFloor(upper, { strength: opts.strength });
  }

  // ---- gold channels inlaid in the floor (narrow, angular) ---------------------------------------------
  const ch: THREE.BufferGeometry[] = [];
  const cw = 0.07, cy = 0.004;
  for (const x of [-4.5, 4.5]) ch.push(box(cw, 0.008, 60, x, cy, -14));
  for (const x of [-9, 9]) ch.push(box(cw, 0.008, 60, x, cy, -14));
  for (let z = 6; z >= -34; z -= 8) {
    ch.push(box(9, 0.008, cw, 0, cy, z));
    // chevrons pointing down the hall
    ch.push(box(3.2, 0.008, cw, -6.75 + 1.1, cy, z - 1.1, Math.PI / 4));
    ch.push(box(3.2, 0.008, cw, 6.75 - 1.1, cy, z - 1.1, -Math.PI / 4));
  }
  // dais ring
  const ring = new THREE.RingGeometry(4.0, 4.08, 96);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, cy + 0.002, -22);
  const ring2 = new THREE.RingGeometry(6.2, 6.26, 96);
  ring2.rotateX(-Math.PI / 2);
  ring2.translate(0, cy + 0.002, -22);
  const channels = new THREE.Mesh(mergeGeometries([...ch.map((g) => g.toNonIndexed()), ring.toNonIndexed(), ring2.toNonIndexed()]), channel);
  channels.name = 'channels';
  root.add(channels);

  // ---- white-gold ribs with warm light seams -----------------------------------------------------------
  const ribs: THREE.BufferGeometry[] = [];
  const trims: THREE.BufferGeometry[] = [];
  const seams: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const z = 4 - i * 8;
    for (const side of [-1, 1]) {
      const x = side * 12.5;
      ribs.push(box(1.6, 15, 2.2, x, 7.5, z));
      ribs.push(box(2.4, 0.8, 3.0, x, 0.4, z));
      // leaning upper span toward the centre
      const span = new THREE.BoxGeometry(1.2, 12, 1.8);
      span.rotateZ(side * 0.62);
      span.translate(x - side * 3.6, 19.2, z);
      ribs.push(span);
      trims.push(box(1.7, 0.18, 2.3, x, 1.0, z));
      trims.push(box(1.7, 0.12, 2.3, x, 9.2, z));
      seams.push(box(0.1, 7.6, 0.1, x - side * 0.82, 5.2, z + 0.6));
      seams.push(box(0.1, 7.6, 0.1, x - side * 0.82, 5.2, z - 0.6));
    }
  }
  const ribMesh = new THREE.Mesh(mergeGeometries(ribs), whiteGold);
  ribMesh.castShadow = ribMesh.receiveShadow = true;
  root.add(ribMesh);
  const trimMesh = new THREE.Mesh(mergeGeometries(trims), goldTrim);
  trimMesh.castShadow = true;
  root.add(trimMesh);
  root.add(new THREE.Mesh(mergeGeometries(seams), seam));

  // dark outer walls + far wall so the hall closes and the floor has something to mirror
  const walls = new THREE.Mesh(
    mergeGeometries([box(1, 26, 90, -22.5, 13, -14), box(1, 26, 90, 22.5, 13, -14), box(46, 26, 1, 0, 13, -52), box(46, 1, 90, 0, 26, -14)]),
    blackWall,
  );
  walls.receiveShadow = true;
  root.add(walls);

  // ---- far "white point": a column of light inside a white-gold frame (frames the destination) --------
  const frame = new THREE.Mesh(
    mergeGeometries([box(0.7, 16, 0.7, -2.2, 8, -44), box(0.7, 16, 0.7, 2.2, 8, -44), box(5.1, 0.7, 0.7, 0, 16.3, -44)]),
    whiteGold,
  );
  frame.castShadow = true;
  root.add(frame);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 15.6, 0.2), emissive(0xfff0d0, 9));
  beam.position.set(0, 7.9, -44.2);
  root.add(beam);
  const beamLight = new THREE.PointLight(0xffe8c0, 260, 60, 2);
  beamLight.position.set(0, 6, -42);
  root.add(beamLight);

  // ---- emissive calibration strips: 1.5 / 3 / 6 --------------------------------------------------------
  const panel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.6, 0.3), blackWall);
  panel.position.set(-6.2, 1.9, -6);
  panel.rotation.y = 0.5;
  panel.castShadow = true;
  root.add(panel);
  [1.5, 3, 6].forEach((intensity, i) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.12, 0.06), emissive(0xffc56b, intensity));
    strip.position.set(0, 0.75 - i * 0.75, 0.17);
    panel.add(strip);
  });

  // ---- material spheres -------------------------------------------------------------------------------
  const sphere = new THREE.SphereGeometry(0.6, 64, 32);
  const balls: Array<[number, number, THREE.Material]> = [
    [-1.8, -1.5, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 1 })],
    [-0.4, -2.2, goldTrim],
    [1.0, -1.6, new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.75, metalness: 0 })],
    [2.4, -2.4, new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.12, metalness: 0 })],
  ];
  for (const [x, z, mat] of balls) {
    const m = new THREE.Mesh(sphere, mat);
    m.position.set(x, 0.6, z);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }

  // ---- a point of violet: one corrupted shard and its light, off to the side --------------------------
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), emissive(0x7a3cff, 5));
  shard.position.set(6.6, 1.1, -9);
  shard.scale.set(0.6, 1.8, 0.6);
  root.add(shard);
  const violet = new THREE.PointLight(0x7a3cff, 26, 9, 2);
  violet.position.copy(shard.position);
  root.add(violet);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), whiteGold);
  plinth.position.set(6.6, 0.35, -9);
  plinth.castShadow = plinth.receiveShadow = true;
  root.add(plinth);

  // ---- 1.85 m figure for scale (dark cloak silhouette) -------------------------------------------------
  const cloak = new THREE.MeshStandardMaterial({ color: 0x3a1214, roughness: 0.8, metalness: 0 });
  const figure = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 1.0, 6, 16), cloak);
  body.position.y = 0.92;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshStandardMaterial({ color: 0x8a6a55, roughness: 0.7 }));
  head.position.y = 1.72;
  const pauldron = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.32), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.35, metalness: 0.9 }));
  pauldron.position.y = 1.5;
  figure.add(body, head, pauldron);
  figure.traverse((o) => { o.castShadow = true; });
  figure.position.set(-2.2, 0, -16.5);
  root.add(figure);

  // ---- additive light shaft (transparent, depthWrite off): must not be darkened by AO behind it -------
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 2.2, 14, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  shaft.position.set(9.5, 7, -17);
  shaft.layers.set(RENDER_LAYERS.noReflect);
  root.add(shaft);

  // ---- lighting -------------------------------------------------------------------------------------------
  const key = new THREE.DirectionalLight(0xffe9cc, 2.6);
  key.position.set(9, 22, 6);
  key.target.position.set(0, 0, -14);
  key.castShadow = true;
  key.shadow.mapSize.set(render.quality.shadowMapSize, render.quality.shadowMapSize);
  const sc = key.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 70;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  root.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.7);
  rim.position.set(-10, 8, -30);
  root.add(rim);
  // warm practicals where the seams are
  for (const z of [4, -12, -28]) {
    for (const side of [-1, 1]) {
      const p = new THREE.PointLight(0xffd9a0, 14, 18, 2);
      p.position.set(side * 10.6, 5, z);
      root.add(p);
    }
  }

  return {
    floor,
    upper,
    update(_dt: number, t: number): void {
      shard.rotation.y = t * 0.7;
      shard.position.y = 1.1 + Math.sin(t * 1.3) * 0.05;
      violet.intensity = 26 + Math.sin(t * 2.1) * 4;
    },
  };
}
