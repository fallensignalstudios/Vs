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
 * Globals for tools/shot.cjs: __mats, __ids, __focus(id, dist?, grazing?), __corrupt(amount), __view(name),
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

const h = createHarness({ bloom: true, env, lights: scene !== 'corridor', background: env === 'dark' ? 0x05070a : 0x0c1016, exposure: 1 });
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
  const ids = (only && only.length ? only : MAT_IDS) as MatId[];
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
    if (m.transparent) {
      // something bright behind the see-through materials so their transmission reads
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 12), mats.emissive(mats.palette.goldLight, 4));
      glow.position.set(cx + 0.2, 0.75, cz - 0.6); h.scene.add(glow);
    }
  });
  h.setCam([((cols - 1) * CELL) / 2, 11, rows * CELL + 6], [((cols - 1) * CELL) / 2, 0, ((rows - 1) * CELL) / 2 - 1], 42);
}

/** Aim the camera at one gallery cell. `grazing` drops it near the floor to judge the specular response. */
w.__focus = (id: string, dist = 4.2, grazing = false): string => {
  const c = cells.get(id);
  if (!c) return `no cell "${id}"`;
  if (grazing) h.setCam([c.x - dist * 0.5, 0.35, c.z + dist], [c.x + 0.1, 0.45, c.z], 38);
  else h.setCam([c.x - dist * 0.25, dist * 0.42, c.z + dist], [c.x, 0.6, c.z - 0.1], 38);
  return id;
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
