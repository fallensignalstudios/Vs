/**
 * Corridor swatch: two bays side by side.
 *   left  — upper terminal: white-gold panelled wall, gold trim, a lit channel, ribs, Reformation gear,
 *           a frost panel in front of a glowing conduit
 *   right — lower terminal: polished black stone with angular gold channels, Dominion gear, a corrupted patch
 * Compared against ref-concept-relay-route.png and ref-concept-crownmark-chamber.png.
 */
import * as THREE from 'three';
import type { MaterialLibrary, MatId } from '@/core/api';
import type { Harness } from '../harness';
import { box, ribSegment } from './shapes';
import { createFloorMirror } from './mirror';

type V3 = [number, number, number];

export function buildCorridor(h: Harness, mats: MaterialLibrary): Record<string, unknown> {
  const root = new THREE.Group();
  h.scene.add(root);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | MatId, pos: V3, rot?: V3, shadow = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, typeof mat === 'string' ? mats.get(mat) : mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = shadow; m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const strip = (mat: THREE.Material | MatId, a: V3, b: V3, w = 0.05, t = 0.02): THREE.Mesh => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = add(box(w, t, len), mat, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], undefined, false);
    m.lookAt(vb);
    return m;
  };

  // ---------------------------------------------------------------- floors (unique instances: the mirror patches them)
  const mirror = createFloorMirror(h.renderer, h.scene, h.camera, 0);
  const floorL = add(box(9, 0.4, 24), mats.clone('whiteGoldFloor'), [-5.5, -0.2, -4], undefined, false);
  const floorR = add(box(9, 0.4, 24), mats.clone('blackStoneFloor'), [5.5, -0.2, -4], undefined, false);
  const floorMid = add(box(2, 0.4, 24), mats.clone('blackStoneFloor'), [0, -0.2, -4], undefined, false);
  // Reflections: ?refl=core drives render-core's real PlanarReflections (the production injection) when that
  // module is available; otherwise a sandbox mirror that patches the floors the same way (plain assignment of
  // onBeforeCompile on top of the library's own patches).
  let ready: Promise<void> | undefined;
  const floors = [floorL, floorR, floorMid];
  const useMock = (): void => {
    mirror.register(floorL, 0.85); mirror.register(floorR, 1); mirror.register(floorMid, 1);
    h.onUpdate(() => mirror.update());
  };
  if (h.params.get('refl') === 'core') {
    ready = import('@/render/reflections').then(({ PlanarReflections }) => {
      const pr = new PlanarReflections(true);
      const size = h.renderer.getDrawingBufferSize(new THREE.Vector2());
      pr.setSize(size.x, size.y, 0.5);
      for (const f of floors) pr.register(f, { y: 0 });
      h.onUpdate((dt) => { pr.render(h.renderer, h.scene, h.camera, dt); });
    }).catch((err: unknown) => { console.warn('[sandbox] render-core reflections unavailable — using the sandbox mirror', err); useMock(); });
  } else if (!h.params.has('nomirror')) {
    useMock();
  }

  // ---------------------------------------------------------------- left bay: white-gold
  add(box(0.6, 8, 24), 'whiteGoldPanel', [-10.3, 4, -4]);
  add(box(20, 8, 0.6), 'whiteGoldPanel', [0, 4, -16.3]);
  strip('goldTrim', [-9.97, 0.12, -16], [-9.97, 0.12, 8], 0.24, 0.06);
  strip('goldTrim', [-9.97, 3.62, -16], [-9.97, 3.62, 8], 0.1, 0.05);
  for (const z of [-12, -7.2, -2.4, 2.4]) {
    add(box(0.5, 8, 0.9), 'whiteGold', [-9.85, 4, z]);
    add(box(0.06, 6.4, 0.34), 'goldDark', [-9.6, 3.6, z]);
    add(box(0.04, 6.2, 0.035), 'goldChannel', [-9.57, 3.6, z], undefined, false);
    add(box(0.52, 0.16, 0.94), 'goldTrim', [-9.85, 0.5, z]);
    add(box(0.52, 0.1, 0.94), 'goldTrim', [-9.85, 6.9, z]);
    const pl = new THREE.PointLight(0xffc56b, 1.4, 6, 1.8); pl.position.set(-8.9, 2.4, z); root.add(pl);
  }
  // ribs spanning the bay with a warm strip on the inner face
  const rib = ribSegment(4.2, 0.5, 0.7);
  for (const z of [-9.6, -0]) {
    add(rib, 'whiteGold', [-9.9, 3.2, z]);
    const r2 = add(rib, 'whiteGold', [-1.3, 3.2, z]); r2.scale.x = -1;
    add(box(8.3, 0.04, 0.06), 'whiteLight', [-5.6, 7.38, z], undefined, false);
  }
  // door at the end with the "white point" above it
  add(box(3.6, 4.2, 0.2), 'goldDark', [-5.5, 2.1, -15.95]);
  add(box(3.0, 3.7, 0.1), 'whiteGold', [-5.5, 1.85, -15.82]);
  add(box(0.05, 3.7, 0.06), 'goldChannel', [-5.5, 1.85, -15.76], undefined, false);
  add(box(0.3, 0.3, 0.1), 'whiteLight', [-5.5, 5.2, -15.9], undefined, false);
  const wp = new THREE.PointLight(0xfff0d2, 5, 16, 1.8); wp.position.set(-5.5, 5.2, -14.6); root.add(wp);
  // floor inlay
  strip('goldTrim', [-3.2, 0.004, -16], [-3.2, 0.004, 8], 0.07, 0.01);
  strip('goldTrim', [-7.8, 0.004, -16], [-7.8, 0.004, 8], 0.07, 0.01);

  // Reformation gear: stacked crates, a sensor console
  const crate = (x: number, y: number, z: number, s = 1, yaw = 0): void => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; g.scale.setScalar(s); root.add(g);
    const part = (geo: THREE.BufferGeometry, mat: MatId, p: V3): void => { const m = new THREE.Mesh(geo, mats.getLocal(mat)); m.position.set(...p); m.castShadow = true; m.receiveShadow = true; g.add(m); };
    part(box(1.2, 0.8, 0.9), 'refNavy', [0, 0.4, 0]);
    part(box(1.26, 0.07, 0.96), 'refSlate', [0, 0.04, 0]);
    part(box(1.26, 0.07, 0.96), 'refSlate', [0, 0.77, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(box(0.07, 0.8, 0.07), 'refSteel', [sx * 0.6, 0.4, sz * 0.45]);
    part(box(0.34, 0.07, 0.02), 'refBlueGlow', [0.25, 0.58, 0.455]);
  };
  crate(-8.2, 0, 3.4, 1, 0.2); crate(-8.3, 0.8, 3.45, 0.9, 0.05); crate(-6.9, 0, 3.9, 1, -0.3);
  add(box(0.5, 1.5, 0.4), 'refSlate', [-2.4, 0.75, 2.6]);
  add(box(0.3, 0.5, 0.03), 'refBlueGlow', [-2.4, 1.1, 2.82], undefined, false);
  add(box(0.56, 0.05, 0.46), 'refSteel', [-2.4, 1.52, 2.6]);

  // frost panel in front of a glowing conduit
  const conduitX = -9.2, conduitZ = -4.8;
  for (const dz of [-0.35, 0, 0.35]) {
    add(new THREE.CylinderGeometry(0.07, 0.07, 6, 16), 'goldTrim', [conduitX, 3, conduitZ + dz]);
    add(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 12), mats.emissive(0xffd27a, 6), [conduitX + 0.08, 1.6, conduitZ + dz], undefined, false);
  }
  const conduitLight = new THREE.PointLight(0xffc56b, 5, 6, 1.6); conduitLight.position.set(conduitX + 0.15, 1.6, conduitZ); root.add(conduitLight);
  const ice = add(box(0.3, 3.2, 3.0), 'frostIce', [-8.55, 1.6, -4.8], undefined, false); ice.renderOrder = 5;
  add(box(0.5, 0.5, 3.4), 'frostRime', [-8.7, 0.25, -4.8]);
  add(box(0.34, 0.5, 1.2), 'frostRime', [-8.5, 3.4, -5.4], [0, 0, 0.2]);

  // ---------------------------------------------------------------- centre: pylons between the bays
  for (const z of [-12, -4.8, 2.4]) {
    add(box(1.1, 8, 1.1), 'blackStone', [0, 4, z]);
    add(box(1.16, 0.12, 1.16), 'goldTrim', [0, 0.4, z]);
    add(box(1.16, 0.08, 1.16), 'goldTrim', [0, 5.6, z]);
    add(box(0.04, 5, 0.028), 'goldChannel', [0.565, 3, z], undefined, false);
    add(box(0.04, 5, 0.028), 'goldChannel', [-0.565, 3, z], undefined, false);
  }

  // ---------------------------------------------------------------- right bay: black stone + channels
  const wallMat = mats.get('blackStone');
  add(box(0.6, 8, 9), wallMat, [10.3, 4, -11.5]);
  // the middle wall section, a pylon face and a floor patch are separate instances that get corrupted; world-space
  // mapping keeps them seamless with their neighbours
  const corruptWall = mats.clone('blackStone');
  const corruptFloor = floorR.material as THREE.MeshStandardMaterial;
  add(box(0.6, 8, 8), corruptWall, [10.3, 4, -3]);
  add(box(0.6, 8, 7), wallMat, [10.3, 4, 4.5]);
  const chan = (pts: V3[]): void => { for (let i = 0; i < pts.length - 1; i++) strip('goldChannel', pts[i], pts[i + 1], 0.028, 0.03); };
  chan([[9.98, 1.1, -16], [9.98, 1.1, -12], [9.98, 2.3, -10.8], [9.98, 2.3, -7.6], [9.98, 4.6, -5.3], [9.98, 4.6, 8]]);
  chan([[9.98, 0.35, -16], [9.98, 0.35, 8]]);
  chan([[9.98, 6.2, -16], [9.98, 6.2, -9], [9.98, 7.4, -7.8]]);
  // floor channels: angular, converging on the end wall
  chan([[2.2, 0.006, 8], [2.2, 0.006, -6], [4.2, 0.006, -8], [4.2, 0.006, -16]]);
  chan([[8.6, 0.006, 8], [8.6, 0.006, -2], [6.8, 0.006, -3.8], [6.8, 0.006, -16]]);
  chan([[2.2, 0.006, 1.5], [8.6, 0.006, 1.5]]);
  for (const z of [-12.5, -6.5, -0.5, 5]) { const pl = new THREE.PointLight(0xffc56b, 1.6, 6, 1.8); pl.position.set(9.0, 1.6, z); root.add(pl); }
  // end wall: tall slit of white light
  add(box(0.08, 7, 0.1), 'whiteLight', [5.5, 3.6, -15.95], undefined, false);
  add(box(1.3, 7.6, 0.16), 'goldDark', [5.5, 3.8, -16.0]);
  const slit = new THREE.PointLight(0xfff0d2, 6, 18, 1.7); slit.position.set(5.5, 3.2, -14.4); root.add(slit);

  // Dominion gear: barricade + lamp + banner
  const bx = 4.2, bz = 3.2;
  add(box(2.6, 1.25, 0.28), mats.getLocal('domBronze'), [bx, 0.63, bz], [0, 0.25, 0]);
  add(box(2.0, 0.7, 0.06), mats.getLocal('domOxblood'), [bx + 0.04, 0.72, bz + 0.17], [0, 0.25, 0]);
  add(box(2.8, 0.14, 0.4), mats.getLocal('domBlack'), [bx, 0.07, bz], [0, 0.25, 0]);
  add(box(0.16, 1.9, 0.16), mats.getLocal('domBlack'), [bx + 1.9, 0.95, bz - 0.6]);
  add(box(0.24, 0.42, 0.24), 'domAmberGlow', [bx + 1.9, 2.05, bz - 0.6], undefined, false);
  add(box(0.3, 0.06, 0.3), mats.getLocal('domBronze'), [bx + 1.9, 2.3, bz - 0.6]);
  const amber = new THREE.PointLight(0xffa033, 3, 7, 1.8); amber.position.set(bx + 1.9, 2.05, bz - 0.6); root.add(amber);
  add(box(1.1, 2.6, 0.03), 'domCloth', [8.4, 3.2, -11.8], [0, -1.2, 0]);

  // corruption: a patch of wall + floor, tissue and veins growing out of a channel junction
  const corruptPale = mats.clone('whiteGold');
  add(box(1.1, 3.4, 1.1), corruptPale, [7.4, 1.7, -6.2]);
  const cp = mats.corrupt(corruptPale, { amount: 0.45, scale: 2.2 });
  const cw = mats.corrupt(corruptWall, { amount: 0.45, scale: 2.2 });
  const cf = mats.corrupt(corruptFloor, { amount: 0.0, scale: 2.2 });
  const tissueGeo = new THREE.IcosahedronGeometry(1, 5);
  for (const [x, y, z, s] of [[9.75, 0.5, -3.4, 0.75], [9.6, 0.22, -2.2, 0.5], [9.8, 1.7, -4.2, 0.45], [9.85, 3.0, -3.0, 0.3]] as const) {
    const t = add(tissueGeo, 'eclipseTissue', [x, y, z]); t.scale.set(s * 0.55, s, s * 1.1);
  }
  const vein = (pts: V3[]): void => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    add(new THREE.TubeGeometry(curve, 40, 0.035, 8), 'eclipseVein', [0, 0, 0], undefined, false);
  };
  vein([[9.9, 0.3, -3.4], [9.9, 1.4, -3.9], [9.92, 2.6, -3.2], [9.95, 4.4, -4.0], [9.95, 5.8, -3.1]]);
  vein([[9.7, 0.05, -3.0], [8.8, 0.03, -2.4], [8.0, 0.03, -2.9], [7.2, 0.03, -2.2]]);
  add(box(0.9, 1.3, 0.12), 'eclipsePlate', [9.55, 0.7, -1.1], [0.1, -1.1, 0.25]);
  const violet = new THREE.PointLight(0x7a3cff, 2.2, 6, 1.8); violet.position.set(9.0, 1.3, -3.2); root.add(violet);

  // ---------------------------------------------------------------- lighting
  root.add(new THREE.HemisphereLight(0xdfe6ff, 0x14110e, 0.3));
  const key = new THREE.DirectionalLight(0xfff0dc, 1.5);
  key.position.set(-4, 14, 9); key.target.position.set(0, 0, -6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03;
  const sc = key.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.far = 50;
  root.add(key, key.target);

  const views: Record<string, [V3, V3, number]> = {
    wide: [[0.5, 2.6, 13], [0.3, 2.2, -8], 55],
    whitegold: [[-4.2, 1.7, 9.5], [-6.6, 2.3, -8], 50],
    blackstone: [[4.6, 1.6, 10], [6.4, 1.9, -8], 50],
    frost: [[-5.2, 1.7, -2.2], [-9.2, 1.6, -4.8], 42],
    corrupt: [[4.6, 1.8, 0.2], [9.6, 1.8, -4.4], 50],
    gear: [[-5.2, 1.3, 6.6], [-8, 0.8, 3.4], 40],
    dominion: [[2.6, 1.4, 6.4], [4.6, 0.9, 3.0], 42],
    wallClose: [[-8.6, 1.6, 0.6], [-10, 1.7, -1.2], 40],
    stoneGraze: [[5.2, 0.5, 8], [6.2, 0.2, -6], 40],
  };
  h.setCam(views.wide[0], views.wide[1], views.wide[2]);
  return {
    __ready: ready,
    __view: (name: string): string => { const v = views[name] ?? views.wide; h.setCam(v[0], v[1], v[2]); return name; },
    __corrupt: (amount: number, floor = amount * 0.8): number => { cw.amount = amount; cp.amount = amount; cf.amount = floor; return cw.amount; },
  };
}
