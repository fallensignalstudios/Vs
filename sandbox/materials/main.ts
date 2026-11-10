/**
 * Materials sandbox.
 *
 *   /sandbox/materials/?scene=gallery&env=studio|dark[&only=id,id][&size=256|512|1024]
 *   /sandbox/materials/?scene=corridor&env=dark        corridor swatch (white-gold · black stone · frost · corruption)
 *        &refl=core   use render-core's real planar reflections on the floors (default: a sandbox mirror)
 *        &nomirror=1  environment-map reflections only
 *   /sandbox/materials/?scene=hall                     60 m hall: tiling / macro-variation check
 *   /sandbox/materials/?scene=moving                   object-space mapping on moving, instanced and skinned meshes
 *   /sandbox/materials/?scene=maps&id=blackStone       the raw baked maps of one material, tiled 2 × 2
 *
 * Globals for tools/shot.cjs: __mats, __ids, __focus(id, dist?, grazing?), __row(row, half), __corrupt(amount), __view(name),
 * __stats() (bake time, texture memory), plus the harness __h / __step.
 */
import * as THREE from 'three';
import type { MatId, QualityProfile } from '@/core/api';
import { createMaterialLibrary } from '@/world/materials';
import { MAT_IDS } from '@/world/materials/defs';
import { createHarness, miniGame, SANDBOX_QUALITY } from '../harness';
import { bevelledSlab, label, ribSegment } from './shapes';
import { buildCorridor } from './corridor';
import { buildHall, buildMaps, buildMoving } from './checks';

const q = new URLSearchParams(location.search);
const scene = q.get('scene') ?? 'gallery';
const env = q.get('env') === 'dark' ? 'dark' : 'studio';

const h = createHarness({ bloom: true, env, lights: false, background: env === 'dark' ? 0x05070a : 0x0c1016, exposure: 1 });
// The harness bloom is a plain threshold bloom: keep diffuse white-gold below it so only emissives glow.
h.scene.environmentIntensity = env === 'dark' ? 0.22 : 0.5;
if (scene !== 'corridor') {
  h.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1410, env === 'dark' ? 0.12 : 0.3));
  const key = new THREE.DirectionalLight(0xfff1dc, env === 'dark' ? 0.9 : 1.35);
  key.position.set(6, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera;
  sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.far = 60;
  key.target.position.set(scene === 'gallery' ? 11 : 0, 0, scene === 'gallery' ? 6 : scene === 'hall' ? -20 : 0);
  key.position.add(key.target.position);
  h.scene.add(key, key.target);
}
const quality: QualityProfile = { ...SANDBOX_QUALITY, textureSize: (Number(q.get('size')) || SANDBOX_QUALITY.textureSize) as QualityProfile['textureSize'] };
const game = miniGame(h);
(game.render as unknown as { quality: QualityProfile }).quality = quality;
const mats = createMaterialLibrary(game);
h.onUpdate((dt, t) => mats.update(dt, t));

const w = window as unknown as Record<string, unknown>;
w.__mats = mats;
w.__ids = MAT_IDS;

const CELL = 3.2;
const COLS = 8;
const cells = new Map<string, THREE.Vector3>();

function buildGallery(): void {
  const only = q.get('only')?.split(',').filter(Boolean);
  // light-emitting materials share the far row so their bloom does not wash over the surface materials
  const glows: MatId[] = ['goldChannel', 'whiteLight', 'domAmberGlow', 'refBlueGlow', 'eclipseVein', 'hologram', 'shieldEnergy', 'quarantineBarrier'];
  const ids = (only && only.length ? only : [...glows, ...MAT_IDS.filter((id) => !glows.includes(id))]) as MatId[];
  const cols = Math.min(COLS, ids.length);
  const rows = Math.ceil(ids.length / cols);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(cols * CELL + 16, rows * CELL + 16), mats.get('blackStoneFloor'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(((cols - 1) * CELL) / 2, 0, ((rows - 1) * CELL) / 2);
  floor.receiveShadow = true;
  h.scene.add(floor);

  const sphere = new THREE.SphereGeometry(0.45, 48, 32);
  sphere.deleteAttribute('uv');
  const slab = bevelledSlab();
  const rib = ribSegment();
  ids.forEach((id, i) => {
    const cx = (i % cols) * CELL, cz = Math.floor(i / cols) * CELL;
    cells.set(id, new THREE.Vector3(cx, 0, cz));
    const m = mats.get(id);
    const a = new THREE.Mesh(sphere, m); a.position.set(cx - 0.75, 0.47, cz + 0.35);
    const b = new THREE.Mesh(slab, m); b.position.set(cx + 0.15, 0.01, cz - 0.1); b.rotation.y = -0.35;
    const c = new THREE.Mesh(rib, m); c.position.set(cx + 0.55, 0, cz - 0.75); c.rotation.y = Math.PI * 0.5;
    for (const o of [a, b, c]) { o.castShadow = !m.transparent; o.receiveShadow = true; h.scene.add(o); }
    const l = label(id, 1.5); l.position.set(cx, 0.012, cz + 1.25); h.scene.add(l);
    if (m.transparent && m.blending !== THREE.AdditiveBlending && id !== 'quarantineBarrier') {
      // something bright behind the see-through materials so their transmission reads
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 12), mats.emissive(mats.palette.goldLight, 4));
      glow.position.set(cx + 0.2, 0.75, cz - 0.6); h.scene.add(glow);
    }
  });
  h.setCam([((cols - 1) * CELL) / 2, 15, rows * CELL + 7.5], [((cols - 1) * CELL) / 2, 0, ((rows - 1) * CELL) / 2 - 0.4], 44);
}

/** Aim the camera at one gallery cell. `grazing` drops it near the floor to judge the specular response. */
w.__focus = (id: string, dist = 4.2, grazing = false): string => {
  const c = cells.get(id);
  if (!c) return `no cell "${id}"`;
  if (grazing) h.setCam([c.x - dist * 0.5, 0.35, c.z + dist], [c.x + 0.1, 0.45, c.z], 38);
  else h.setCam([c.x - dist * 0.25, dist * 0.42, c.z + dist], [c.x, 0.6, c.z - 0.1], 38);
  return id;
};

/** Frame four neighbouring cells of one gallery row (row 0…, half 0 = left four, 1 = right four). */
w.__row = (row: number, half = 0): string => {
  const cx = (half * 4 + 1.5) * CELL, cz = row * CELL;
  h.setCam([cx, 4.6, cz + 9.2], [cx, 0.5, cz - 0.2], 44);
  return `row ${row}.${half}`;
};

w.__stats = (): Record<string, number> => ({
  drawCalls: h.renderer.info.render.calls,
  textures: h.renderer.info.memory.textures,
  programs: h.renderer.info.programs?.length ?? 0,
  bakeMs: Math.round(bakeMs),
});

let bakeMs = 0;
async function boot(): Promise<void> {
  const controls: Record<string, unknown> = {};
  if (scene === 'corridor') Object.assign(controls, buildCorridor(h, mats));
  else if (scene === 'hall') Object.assign(controls, buildHall(h, mats));
  else if (scene === 'moving') Object.assign(controls, buildMoving(h, mats));
  else if (scene !== 'maps') buildGallery();
  Object.assign(w, controls);
  if (controls.__ready instanceof Promise) await controls.__ready;
  if (!q.has('noinit')) {
    const t0 = performance.now();
    await mats.init();
    bakeMs = performance.now() - t0;
  }
  if (scene === 'maps') buildMaps(h, mats, (q.get('id') ?? 'blackStone') as MatId);
  h.ready();
}
void boot();
