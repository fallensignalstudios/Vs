/**
 * Camera sandbox arena — a greybox dressed in the three-layer art direction so framing can be judged honestly:
 * polished black stone with gold channels, white-gold ribs with warm seams, faction crates as cover, a ramp to
 * a +3 m balcony, and kilometre-scale ribs beyond the open north side (exercises the 6000 m far plane).
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '@/core/api';

const C = {
  blackStone: 0x0b0c10, channel: 0xffc56b, whiteGold: 0xd9d2c0, gold: 0xc9a45c, light: 0xffe2a8,
  bronze: 0x8a5a2b, oxblood: 0x5a1616, domBlack: 0x121012, amber: 0xffa033,
  navy: 0x1b2a44, slate: 0x3a4656, steel: 0xc5ccd4, blue: 0xa8d8ff,
};

export interface Arena {
  group: THREE.Group;
  /** named places used by the screenshot scenarios */
  spots: Record<string, { x: number; z: number; yaw: number }>;
  /** lock-on practice targets: world point to frame + a label */
  dummies: Array<{ name: string; point: THREE.Vector3; object: THREE.Object3D }>;
}

function tileTexture(): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  // faint large slabs with slightly different polish, hairline joints
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 112 + Math.floor(rnd() * 40);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x * 128 + 1, y * 128 + 1, 126, 126);
    }
  }
  for (let i = 0; i < 900; i++) {
    const v = 90 + Math.floor(rnd() * 90);
    g.fillStyle = `rgba(${v},${v},${v},0.25)`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 26, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildArena(scene: THREE.Scene, physics: PhysicsWorld): Arena {
  const group = new THREE.Group();
  group.name = 'cameraArena';
  scene.add(group);
  const dummies: Arena['dummies'] = [];

  const mat = (color: number, roughness: number, metalness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const glow = (color: number, intensity: number) =>
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 });

  const M = {
    whiteGold: mat(0xbdb6a6, 0.5, 0.12),
    gold: mat(C.gold, 0.32, 0.9),
    channel: new THREE.MeshStandardMaterial({ color: 0x3a2c12, emissive: C.channel, emissiveIntensity: 1.5, roughness: 0.4, metalness: 0.8 }),
    seam: glow(C.light, 2.6),
    navy: mat(C.navy, 0.55, 0.5),
    slate: mat(C.slate, 0.5, 0.6),
    steel: mat(C.steel, 0.35, 0.8),
    blue: glow(C.blue, 3),
    bronze: mat(C.bronze, 0.38, 0.85),
    oxblood: mat(C.oxblood, 0.6, 0.3),
    domBlack: mat(C.domBlack, 0.5, 0.6),
    amber: glow(C.amber, 3),
  };

  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, yaw = 0, shadow = true): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  /** visible box + matching solid collider (y = base height) */
  const solid = (w: number, h: number, d: number, m: THREE.Material, x: number, z: number, yaw = 0, base = 0, cover?: 'low' | 'high'): THREE.Mesh => {
    physics.addCollider({ shape: { kind: 'box', hx: w / 2, hy: h / 2, hz: d / 2 }, x, y: base + h / 2, z, yaw, cover });
    return box(w, h, d, m, x, base + h / 2, z, yaw);
  };

  // ---------------------------------------------------------------------------------------------
  // floor: 44 × 32 m of polished black stone, gold channels running north toward the white point
  // ---------------------------------------------------------------------------------------------
  const tiles = tileTexture();
  tiles.repeat.set(11, 8);
  // physical material so the specular lobe can be held down: polished, but no sun-glare sheets under bloom
  const floorMat = new THREE.MeshPhysicalMaterial({ color: 0x07080b, roughness: 0.3, metalness: 0, roughnessMap: tiles, specularIntensity: 0.3 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 32), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -4);
  floor.receiveShadow = true;
  group.add(floor);
  physics.addSurface({ shape: { kind: 'rect', hx: 22, hz: 16 }, x: 0, z: -4, y: 0, material: 'stone' });

  for (const x of [-9, -3, 3, 9]) box(0.035, 0.01, 30, M.channel, x, 0.005, -4, 0, false);
  for (const z of [-16, -4, 8]) box(18.035, 0.01, 0.035, M.channel, 0, 0.005, z, 0, false);
  // angular kinks: King-era channels are never plain rectangles
  for (const sx of [-1, 1]) {
    box(0.035, 0.01, 4.3, M.channel, sx * 10.5, 0.005, 6.5, sx * 0.785, false);
    box(0.035, 0.01, 4.3, M.channel, sx * 10.5, 0.005, -14.5, -sx * 0.785, false);
    box(0.035, 0.01, 6, M.channel, sx * 15, 0.005, -4, 0, false);
    box(3.0, 0.01, 0.035, M.channel, sx * 13.5, 0.005, -1, 0, false);
    box(3.0, 0.01, 0.035, M.channel, sx * 13.5, 0.005, -7, 0, false);
  }

  // ---------------------------------------------------------------------------------------------
  // perimeter: white-gold walls + ribs (south, west, part of east); the north is an open colonnade
  // ---------------------------------------------------------------------------------------------
  const H = 9;
  solid(44, H, 1, M.whiteGold, 0, 12.5, 0); // south
  solid(1, H, 32, M.whiteGold, -22.5, -4, 0); // west
  solid(1, H, 14, M.whiteGold, 22.5, 5, 0); // east (southern half; the north-east is the balcony)
  for (let i = -3; i <= 3; i++) {
    const x = i * 6;
    solid(1.1, H, 0.7, M.whiteGold, x, 11.75, 0); // south ribs
    box(0.12, H - 1.2, 0.06, M.seam, x, H / 2, 11.38, 0, false);
    box(1.3, 0.25, 0.9, M.gold, x, 0.125, 11.7);
    box(1.3, 0.2, 0.9, M.gold, x, H - 1.3, 11.7);
  }
  for (let i = 0; i < 6; i++) {
    const z = 9 - i * 5.2;
    solid(0.7, H, 1.1, M.whiteGold, -21.75, z, 0);
    box(0.06, H - 1.2, 0.12, M.seam, -21.38, H / 2, z, 0, false);
    box(0.9, 0.25, 1.3, M.gold, -21.7, 0.125, z);
  }
  // north colonnade: four immense ribs framing the vista, a lintel far overhead
  for (const x of [-18, -6, 6, 18]) {
    solid(2.4, 26, 2.4, M.whiteGold, x, -20.8, 0);
    box(0.16, 22, 0.08, M.seam, x, 12, -19.56, 0, false);
    box(2.8, 0.4, 2.8, M.gold, x, 0.2, -20.8);
    box(2.8, 0.3, 2.8, M.gold, x, 7.2, -20.8);
  }
  box(46, 2.2, 3, M.whiteGold, 0, 27, -20.8);
  box(46, 0.25, 3.2, M.gold, 0, 25.8, -20.8, 0, false);
  // low parapet between the ribs so nobody walks into the vista (see-through: the camera ignores it)
  for (const x of [-12, 0, 12]) {
    physics.addCollider({ shape: { kind: 'box', hx: 4.8, hy: 0.55, hz: 0.25 }, x, y: 0.55, z: -19.9, blocksSight: false, blocksShots: false });
    box(9.6, 1.0, 0.3, M.whiteGold, x, 0.5, -19.9);
    box(9.6, 0.1, 0.42, M.gold, x, 1.05, -19.9);
  }

  // ---------------------------------------------------------------------------------------------
  // cover: Reformation crates (low, 1.2 m) mid-field, Dominion barricades (high, 2.2 m) further up
  // ---------------------------------------------------------------------------------------------
  const crate = (x: number, z: number, yaw: number, w = 2.4) => {
    solid(w, 1.2, 0.95, M.navy, x, z, yaw, 0, 'low');
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const add = (bw: number, bh: number, bd: number, m: THREE.Material, bx: number, by: number, bz: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
      b.position.set(bx, by, bz);
      b.castShadow = true;
      g.add(b);
    };
    add(w + 0.06, 0.08, 1.01, M.slate, 0, 1.16, 0);
    add(w + 0.06, 0.1, 1.01, M.slate, 0, 0.05, 0);
    add(0.5, 0.045, 0.02, M.blue, -w / 2 + 0.5, 0.86, 0.485);
    add(0.5, 0.045, 0.02, M.blue, w / 2 - 0.5, 0.86, -0.485);
    add(0.18, 0.5, 0.03, M.steel, 0, 0.6, 0.49);
  };
  crate(-6, -3.6, 0.08);
  crate(0.4, -4.4, -0.05, 2.9);
  crate(6.5, -3.2, 0.2);
  crate(-13, -9, 1.2);

  const barricade = (x: number, z: number, yaw: number) => {
    solid(2.2, 2.2, 0.9, M.oxblood, x, z, yaw, 0, 'high');
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const add = (bw: number, bh: number, bd: number, m: THREE.Material, bx: number, by: number, bz: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
      b.position.set(bx, by, bz);
      b.castShadow = true;
      g.add(b);
    };
    add(2.36, 0.22, 1.0, M.bronze, 0, 2.2, 0);
    add(2.36, 0.3, 1.0, M.bronze, 0, 0.15, 0);
    add(0.2, 2.1, 1.02, M.domBlack, -0.8, 1.1, 0);
    add(0.2, 2.1, 1.02, M.domBlack, 0.8, 1.1, 0);
    add(0.7, 0.07, 0.02, M.amber, 0, 1.7, 0.46);
    add(0.7, 0.07, 0.02, M.amber, 0, 1.7, -0.46);
  };
  barricade(-3.2, -10.5, 0.1);
  barricade(5.2, -11.2, -0.15);

  // a round ancient pylon to orbit around
  physics.addCollider({ shape: { kind: 'cyl', r: 0.9, hy: 4.5 }, x: -10, y: 4.5, z: -1.5 });
  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 9, 28), M.whiteGold);
  pylon.position.set(-10, 4.5, -1.5);
  pylon.castShadow = pylon.receiveShadow = true;
  group.add(pylon);
  for (const y of [0.15, 2.4, 8.7]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.18, 28), M.gold);
    ring.position.set(-10, y, -1.5);
    group.add(ring);
  }
  const pylonSeam = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.05, 28, 1, true), M.seam);
  pylonSeam.position.set(-10, 2.7, -1.5);
  group.add(pylonSeam);

  // ---------------------------------------------------------------------------------------------
  // ramp (rises 3 m over 11 m, plan §04) to a +3 m balcony in the north-east
  // ---------------------------------------------------------------------------------------------
  const rampLen = 11;
  const rampGeo = new THREE.BoxGeometry(4, 0.3, Math.hypot(rampLen, 3));
  const ramp = new THREE.Mesh(rampGeo, M.whiteGold);
  ramp.position.set(19.5, 1.5 - 0.15, -1.5);
  ramp.rotation.x = Math.atan2(3, rampLen); // rises toward −Z (north)
  ramp.castShadow = ramp.receiveShadow = true;
  group.add(ramp);
  // local −Z edge is the top (north) end
  physics.addSurface({ shape: { kind: 'rect', hx: 2, hz: rampLen / 2 }, x: 19.5, z: -1.5, y: 3, y1: 0, material: 'stone' });
  physics.addSurface({ shape: { kind: 'rect', hx: 5, hz: 6.5 }, x: 17, z: -13.5, y: 3, material: 'stone' });
  const balcony = box(10, 0.4, 13, M.whiteGold, 17, 2.8, -13.5);
  balcony.receiveShadow = true;
  box(10, 0.06, 0.07, M.channel, 17, 3.006, -13.5, 0, false);
  // balcony front wall (solid below the deck) and a see-through rail above it
  solid(0.4, 2.6, 13, M.whiteGold, 12.2, -13.5, 0, 0);
  physics.addCollider({ shape: { kind: 'box', hx: 0.12, hy: 0.55, hz: 6.5 }, x: 12.1, y: 3.55, z: -13.5, blocksSight: false });
  box(0.14, 0.08, 13, M.gold, 12.1, 4.1, -13.5);
  for (let i = 0; i < 7; i++) box(0.08, 1.1, 0.08, M.gold, 12.1, 3.55, -19.5 + i * 2);
  // ramp side walls keep the player on it; the space under the deck is closed off
  solid(0.3, 4.2, rampLen, M.whiteGold, 17.35, -1.5, 0, 0);
  box(0.34, 0.12, rampLen, M.gold, 17.35, 4.2, -1.5);
  solid(0.3, 4.2, rampLen, M.whiteGold, 21.65, -1.5, 0, 0);
  box(0.34, 0.12, rampLen, M.gold, 21.65, 4.2, -1.5);
  solid(5.3, 2.6, 0.4, M.whiteGold, 14.85, -7.2, 0, 0);

  // ---------------------------------------------------------------------------------------------
  // lock-on practice: two Dominion enforcer silhouettes and a hovering Reformation drone
  // ---------------------------------------------------------------------------------------------
  const enforcer = (name: string, x: number, z: number, yaw: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    group.add(g);
    const part = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    part(new THREE.CapsuleGeometry(0.16, 0.62, 4, 10), M.domBlack, -0.19, 0.48, 0);
    part(new THREE.CapsuleGeometry(0.16, 0.62, 4, 10), M.domBlack, 0.19, 0.48, 0);
    part(new THREE.BoxGeometry(0.72, 0.72, 0.42), M.bronze, 0, 1.3, 0);
    part(new THREE.BoxGeometry(0.56, 0.28, 0.36), M.oxblood, 0, 0.88, 0);
    part(new THREE.SphereGeometry(0.2, 14, 10), M.bronze, -0.46, 1.58, 0).scale.set(1, 0.8, 1.1);
    part(new THREE.SphereGeometry(0.2, 14, 10), M.bronze, 0.46, 1.58, 0).scale.set(1, 0.8, 1.1);
    part(new THREE.SphereGeometry(0.17, 14, 12), M.domBlack, 0, 1.84, 0);
    part(new THREE.BoxGeometry(0.22, 0.035, 0.02), M.amber, 0, 1.86, -0.165);
    // tower shield held forward-left
    part(new THREE.BoxGeometry(0.95, 1.7, 0.08), M.oxblood, -0.2, 1.05, -0.5);
    part(new THREE.BoxGeometry(1.03, 0.1, 0.1), M.bronze, -0.2, 1.9, -0.5);
    part(new THREE.BoxGeometry(0.06, 1.2, 0.02), M.amber, -0.2, 1.1, -0.55);
    physics.addCollider({ shape: { kind: 'cyl', r: 0.5, hy: 1.0 }, x, y: 1.0, z, blocksSight: false });
    dummies.push({ name, point: new THREE.Vector3(x, 1.25, z), object: g });
  };
  enforcer('Enforcer A', 2.5, -15, Math.PI);
  enforcer('Enforcer B', -8, -14.5, Math.PI * 0.85);

  const drone = new THREE.Group();
  drone.position.set(9.5, 1.85, -7.5);
  group.add(drone);
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 14), M.navy);
  hull.scale.set(1.25, 0.7, 1);
  hull.castShadow = true;
  drone.add(hull);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), M.blue);
  eye.position.set(0, -0.02, 0.33);
  drone.add(eye);
  for (const sx of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.26), M.steel);
    fin.position.set(sx * 0.6, 0.02, -0.05);
    fin.castShadow = true;
    drone.add(fin);
  }
  dummies.push({ name: 'Security drone', point: drone.position, object: drone });

  // ---------------------------------------------------------------------------------------------
  // vista beyond the colonnade: converging kilometre-scale ribs with light seams, pre-faded by distance
  // ---------------------------------------------------------------------------------------------
  const haze = new THREE.Color(0x6f7684);
  const far = (dist: number): THREE.MeshBasicMaterial => {
    // aerial perspective: near silhouettes are dark, distant ones dissolve into the haze
    const k = Math.min(1, Math.sqrt(dist / 4200));
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(0x14171d).lerp(haze, k * 0.82), fog: false });
  };
  const seamFar = (dist: number): THREE.MeshBasicMaterial => {
    const k = Math.min(1, Math.sqrt(dist / 4200));
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(1.5 - k * 0.9), fog: false });
  };
  for (let i = 0; i < 9; i++) {
    const d = 170 + i * i * 52;
    const h = 260 + i * 210;
    for (const side of [-1, 1]) {
      const x = side * (64 + i * 46);
      const rib = new THREE.Mesh(new THREE.BoxGeometry(22 + i * 10, h, 30 + i * 12), far(d));
      rib.position.set(x, h / 2 - 150, -d);
      rib.rotation.z = -side * 0.1; // lean inward so they converge overhead
      group.add(rib);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.5 + i * 0.5, h * 0.72, 1), seamFar(d));
      seam.position.set(x - side * (11.4 + i * 5.1), h / 2 - 150, -d + 16 + i * 6.5);
      seam.rotation.z = rib.rotation.z;
      group.add(seam);
    }
    if (i % 3 === 1) {
      const span = new THREE.Mesh(new THREE.BoxGeometry(150 + i * 100, 10 + i * 5, 20 + i * 8), far(d));
      span.position.set(0, h * 0.5 - 40, -d);
      group.add(span);
    }
  }
  // the white point: the destination everything converges on
  const whitePoint = new THREE.Mesh(new THREE.SphereGeometry(30, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d8).multiplyScalar(4), fog: false }));
  whitePoint.position.set(0, 120, -4600);
  group.add(whitePoint);
  // abyss far below the colonnade so the vista has a floor
  const deep = new THREE.Mesh(new THREE.PlaneGeometry(12000, 9000), new THREE.MeshBasicMaterial({ color: 0x0a0d13, fog: false }));
  deep.rotation.x = -Math.PI / 2;
  deep.position.set(0, -150, -3600);
  group.add(deep);

  return {
    group,
    dummies,
    spots: {
      start: { x: 0, z: 6, yaw: 0 },
      wall: { x: -2, z: 10.45, yaw: 0.25 },
      cover: { x: 0.4, z: -3.3, yaw: 0 },
      aim: { x: 6.9, z: -10.2, yaw: 0.76 },
      lock: { x: 1.5, z: -9.5, yaw: 0 },
      ramp: { x: 19.5, z: 1.5, yaw: 0 },
      pylon: { x: -10, z: 0.3, yaw: 0.3 },
    },
  };
}

/**
 * Image-based lighting source: a dim cool-to-warm gradient with no bright panels, so the polished floor picks
 * up a soft horizon sheen rather than studio-light blobs. Render once through PMREMGenerator.fromScene.
 */
export function buildEnvironmentScene(): THREE.Scene {
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const zenith = new THREE.Color(0x0b0e16);
  const horizon = new THREE.Color(0x5e5a55);
  const nadir = new THREE.Color(0x0a0908);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y >= 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
    else c.copy(horizon).lerp(nadir, Math.pow(-y, 0.5));
    const north = Math.max(0, -pos.getZ(i) / 50);
    c.multiplyScalar(1 + north * north * 1.4 * Math.max(0, 1 - Math.abs(y) * 2.5));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  return env;
}

/** Lights + sky backdrop for the arena. Returns the key light so the caller can tune shadows. */
export function lightArena(scene: THREE.Scene): THREE.DirectionalLight {
  scene.fog = new THREE.FogExp2(0x10151e, 0.009);
  scene.add(new THREE.HemisphereLight(0x8a9cc0, 0x2a2015, 0.42));

  // key falls steeply through the colonnade from the north-west: pillar shadows on the black stone, figures
  // rim-lit, and (being high) no mirror glare off the polished floor at gameplay camera angles
  const key = new THREE.DirectionalLight(0xffdcae, 2.8);
  key.position.set(-11, 32, -16);
  key.target.position.set(0, 0, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -28; sc.right = 28; sc.top = 26; sc.bottom = -22; sc.near = 1; sc.far = 90;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0x9fb6ea, 1.7);
  fill.position.set(14, 10, 20);
  scene.add(fill);


  // sky: near-black zenith, a luminous haze band low on the northern horizon behind the ribs
  const R = 5600;
  const skyGeo = new THREE.SphereGeometry(R, 40, 20);
  const colors: number[] = [];
  const pos = skyGeo.attributes.position;
  const top = new THREE.Color(0x030408);
  const mid = new THREE.Color(0x10141f);
  const horizon = new THREE.Color(0x2c3240);
  const glow = new THREE.Color(0x8e8f96);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / R;
    const north = Math.max(0, -pos.getZ(i) / R);
    if (y > 0.2) tmp.copy(mid).lerp(top, Math.min(1, (y - 0.2) / 0.5));
    else tmp.copy(horizon).lerp(mid, Math.min(1, Math.max(0, (y + 0.03) / 0.23)));
    const band = Math.max(0, 1 - Math.abs(y - 0.02) * 5.5);
    tmp.lerp(glow, Math.pow(north, 3) * band);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  // the hard white remnant, high on the right
  const remnant = new THREE.Mesh(new THREE.SphereGeometry(38, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f7ff).multiplyScalar(5), fog: false }));
  remnant.position.set(2300, 1900, -4300);
  scene.add(remnant);
  return key;
}
