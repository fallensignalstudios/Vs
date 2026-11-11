/**
 * Loads the generated ship files once per session (meshopt + WebP GLBs and their baked index LODs) and keeps one
 * template per ship: the mesh's geometry, its node transform, its material and the coarser index levels. Every
 * ship on screen shares the template's geometry and textures; only materials are cloned per instance.
 *
 * Nothing here throws. Without a page (unit tests, tools) loading is disabled and `request()` resolves null at
 * once, so callers keep their procedural ship. A missing file or a mesh that cannot be used is warned about once
 * and the ship stays procedural for the session.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SHIP_MODELS, type ShipModelId } from './catalog';

export interface ShipTemplate {
  id: ShipModelId;
  geometry: THREE.BufferGeometry;
  /** the mesh's transform inside the file (raw units), applied before anything else */
  node: THREE.Matrix4;
  /** bounding box of the transformed mesh (raw units) */
  box: THREE.Box3;
  material: THREE.MeshStandardMaterial;
  /** coarser index levels (level 1 first) sharing `geometry`'s attributes; empty without a LOD file */
  lods: THREE.BufferGeometry[];
  triangles: number;
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn('[ships] ' + msg);
}

let forceDisabled = false;
/** tests / tools: switch loading off (true) or back to automatic (false) */
export function setShipLoadingDisabled(off: boolean): void { forceDisabled = !!off; }

/** false where there is no page to load into (unit tests, server-side tooling) or `?ships=0` */
export function shipLoadingEnabled(): boolean {
  if (forceDisabled || typeof document === 'undefined' || typeof fetch !== 'function') return false;
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('ships') === '0') return false;
  } catch { /* no page */ }
  return true;
}

function baseUrl(): string {
  let b = '/';
  try { b = (import.meta.env?.BASE_URL as string | undefined) ?? '/'; } catch { b = '/'; }
  return (b.endsWith('/') ? b : b + '/') + 'models/';
}

const templates = new Map<ShipModelId, ShipTemplate>();
const pending = new Map<ShipModelId, Promise<ShipTemplate | null>>();
const failed = new Set<ShipModelId>();
let loader: GLTFLoader | null = null;

/** the template if it is already loaded */
export function shipTemplate(id: ShipModelId): ShipTemplate | null {
  return templates.get(id) ?? null;
}

/** true when the ship can never be had this session (no page, or its file failed) */
export function shipUnavailable(id: ShipModelId): boolean {
  return !shipLoadingEnabled() || failed.has(id) || !SHIP_MODELS[id];
}

/** Load a ship (once). Resolves the template, or null when it cannot be had. Never rejects. */
export function requestShip(id: ShipModelId): Promise<ShipTemplate | null> {
  const have = templates.get(id);
  if (have) return Promise.resolve(have);
  if (shipUnavailable(id)) return Promise.resolve(null);
  let p = pending.get(id);
  if (!p) {
    const spec = SHIP_MODELS[id];
    const base = baseUrl();
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(base + spec.file)
      .then(async (gltf) => {
        const tpl = prepare(id, gltf.scene);
        if (!tpl) { failed.add(id); return null; }
        tpl.lods = await loadLods(base + spec.lod, tpl.geometry);
        templates.set(id, tpl);
        return tpl;
      })
      .catch((err: unknown) => {
        warnOnce(`${spec.file} failed to load (${String((err as Error)?.message ?? err)}) — procedural ship`);
        failed.add(id);
        return null;
      })
      .finally(() => { pending.delete(id); });
    pending.set(id, p);
  }
  return p;
}

/** start loading these ships (zone build); resolves when all have settled */
export function preloadShips(ids: readonly ShipModelId[]): Promise<void> {
  return Promise.all(ids.map((id) => requestShip(id))).then(() => undefined);
}

function prepare(id: ShipModelId, scene: THREE.Object3D): ShipTemplate | null {
  scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  let most = -1;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const tris = (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
    if (tris > most) { most = tris; mesh = m; }
  });
  const found = mesh as THREE.Mesh | null;
  if (!found) { warnOnce(`${SHIP_MODELS[id].file} has no mesh — procedural ship`); return null; }
  const material = (Array.isArray(found.material) ? found.material[0] : found.material) as THREE.MeshStandardMaterial;
  if (!material || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    warnOnce(`${SHIP_MODELS[id].file}: unexpected material — procedural ship`);
    return null;
  }
  for (const t of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) if (t) t.anisotropy = 4;
  const geometry = found.geometry;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const node = found.matrixWorld.clone();
  const box = (geometry.boundingBox ?? new THREE.Box3()).clone().applyMatrix4(node);
  return { id, geometry, node, box, material, lods: [], triangles: Math.round(most) };
}

/** baked index levels ('ALOD' v1: magic, version, vertex count, bytes per index, level count, counts, indices) */
function loadLods(url: string, base: THREE.BufferGeometry): Promise<THREE.BufferGeometry[]> {
  return fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((buf) => {
      const lods = parseShipLod(buf, base);
      if (!lods) warnOnce(`${url.split('/').pop()} does not match its ship — full geometry only`);
      return lods ?? [];
    })
    .catch((err: unknown) => {
      warnOnce(`${url.split('/').pop()} unavailable (${String((err as Error)?.message ?? err)}) — full geometry only`);
      return [];
    });
}

/** Parse a baked LOD file against the geometry it was baked from; null when it does not belong to it. */
export function parseShipLod(buf: ArrayBuffer, base: THREE.BufferGeometry): THREE.BufferGeometry[] | null {
  try {
    if (buf.byteLength < 20) return null;
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    const version = dv.getUint32(4, true), vc = dv.getUint32(8, true), bpi = dv.getUint32(12, true), n = dv.getUint32(16, true);
    const pos = base.getAttribute('position');
    if (magic !== 'ALOD' || version !== 1 || !pos || vc !== pos.count || (bpi !== 2 && bpi !== 4) || n < 1 || n > 4) return null;
    let off = 20 + n * 4;
    if (off > buf.byteLength) return null;
    const out: THREE.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const count = dv.getUint32(20 + k * 4, true);
      const bytes = count * bpi;
      if (count % 3 !== 0 || off + bytes > buf.byteLength) return null;
      const idx = bpi === 2 ? new Uint16Array(buf.slice(off, off + bytes)) : new Uint32Array(buf.slice(off, off + bytes));
      for (let i = 0; i < idx.length; i++) if (idx[i] >= vc) return null;
      off += Math.ceil(bytes / 4) * 4;
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.boundingBox = base.boundingBox;
      g.boundingSphere = base.boundingSphere;
      g.name = (base.name || 'ship') + ':lod' + (k + 1);
      out.push(g);
    }
    return out;
  } catch {
    return null;
  }
}
