/**
 * Model library: fetches public/models/manifest.json and the generated GLBs (meshopt + WebP), prepares each
 * once as a template and hands out instances that share geometry and textures.
 *
 * Nothing here throws: a missing manifest, a missing file or a mesh that cannot play its part is logged once
 * and the model simply stays unavailable (callers fall back to the procedural figure / item).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Game } from '@/core/api';
import { analyzeHumanoid, type RigInfo } from './analyze';
import type { Manifest, ManifestEntry } from './config';

export interface ModelTemplate {
  name: string;
  entry: ManifestEntry;
  /** template scene; humanoids are wrapped so they face −Z and stand on y = 0 */
  root: THREE.Group;
  /** humanoids: the skinned body and what was measured from it */
  mesh: THREE.SkinnedMesh | null;
  rig: RigInfo | null;
  /** props: raw bounding box of the file's contents */
  box: THREE.Box3;
  /** one material per mesh in traversal order (shared by all instances; clone before patching) */
  materials: THREE.MeshStandardMaterial[];
  triangles: number;
}

export interface ModelInstance {
  template: ModelTemplate;
  root: THREE.Group;
  /** humanoids: the cloned skinned body */
  mesh: THREE.SkinnedMesh | null;
  /** every mesh of the instance, in the order of `template.materials` */
  meshes: THREE.Mesh[];
}

const warned = new Set<string>();
function warnOnce(msg: string): void { if (!warned.has(msg)) { warned.add(msg); console.warn('[glb] ' + msg); } }

export class ModelLibrary {
  private readonly base: string;
  private manifest: Manifest | null = null;
  private manifestPromise: Promise<Manifest | null> | null = null;
  private readonly templates = new Map<string, ModelTemplate>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private loader: GLTFLoader | null = null;
  private manifestSettled = false;
  /** bumps whenever a model finishes loading or fails (visuals poll it instead of holding callbacks) */
  version = 0;

  constructor(private readonly game: Game | null, base?: string) {
    let b = base;
    if (b === undefined) {
      try { b = import.meta.env.BASE_URL ?? '/'; } catch { b = '/'; }
    }
    this.base = (b.endsWith('/') ? b : b + '/') + 'models/';
  }

  /** false where there is no page to load into (unit tests, server-side tooling) */
  get enabled(): boolean { return typeof document !== 'undefined' && typeof fetch === 'function'; }

  /** The manifest, fetched once. Resolves null when it is unavailable. */
  loadManifest(): Promise<Manifest | null> {
    if (!this.enabled) return Promise.resolve(null);
    this.manifestPromise ??= fetch(this.base + 'manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error('HTTP ' + r.status))))
      .then((m) => { this.manifest = m && typeof m === 'object' ? m : null; this.manifestSettled = true; return this.manifest; })
      .catch((err: unknown) => { this.manifestSettled = true; warnOnce(`manifest unavailable (${String((err as Error)?.message ?? err)}) — procedural figures only`); return null; });
    return this.manifestPromise;
  }

  /** Load these models (and nothing else). Always resolves; failures leave the model unavailable. */
  preload(names: readonly string[]): Promise<void> {
    return Promise.all(names.map((n) => this.load(n))).then(() => undefined);
  }

  /** true once the model is prepared and can be instantiated */
  has(name: string): boolean { return this.templates.has(name); }

  /** true when the model can never be had: no page to load into, not in the manifest, or its file failed */
  unavailable(name: string): boolean {
    return !this.enabled || this.failed.has(name) || (this.manifestSettled && !this.manifest?.[name]);
  }

  get(name: string): ModelTemplate | null { return this.templates.get(name) ?? null; }

  entry(name: string): ManifestEntry | null { return this.manifest?.[name] ?? null; }

  private load(name: string): Promise<void> {
    if (this.templates.has(name) || this.failed.has(name) || !this.enabled) return Promise.resolve();
    let p = this.pending.get(name);
    if (!p) {
      p = this.loadManifest()
        .then((manifest) => {
          const entry = manifest?.[name];
          if (!entry || typeof entry.file !== 'string') { if (manifest) warnOnce(`model "${name}" is not in the manifest`); this.failed.add(name); return undefined; }
          return this.gltf().loadAsync(this.base + entry.file).then((gltf) => {
            const tpl = this.prepare(name, entry, gltf.scene);
            if (tpl) this.templates.set(name, tpl); else this.failed.add(name);
          });
        })
        .catch((err: unknown) => { warnOnce(`model "${name}" failed to load (${String((err as Error)?.message ?? err)})`); this.failed.add(name); })
        .then(() => { this.pending.delete(name); this.version++; });
      this.pending.set(name, p);
    }
    return p;
  }

  private gltf(): GLTFLoader {
    if (!this.loader) {
      this.loader = new GLTFLoader();
      this.loader.setMeshoptDecoder(MeshoptDecoder);
    }
    return this.loader;
  }

  private prepare(name: string, entry: ManifestEntry, scene: THREE.Group): ModelTemplate | null {
    let anisotropy = 4;
    try { const a = this.game?.render?.quality?.anisotropy; if (typeof a === 'number' && a >= 1) anisotropy = a; } catch { /* stub render system */ }
    const materials: THREE.MeshStandardMaterial[] = [];
    let skinned: THREE.SkinnedMesh | null = null, most = -1, triangles = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      materials.push(mat);
      for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap, mat.aoMap]) if (tex) tex.anisotropy = anisotropy;
      const g = m.geometry;
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      triangles += tris;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh && tris > most) { most = tris; skinned = m as THREE.SkinnedMesh; }
    });
    if (!materials.length) { warnOnce(`model "${name}" has no meshes`); return null; }
    const root = new THREE.Group();
    root.name = 'glb:' + name;
    root.add(scene);

    if (entry.kind !== 'humanoid') {
      scene.updateMatrixWorld(true);
      return { name, entry, root, mesh: null, rig: null, box: new THREE.Box3().setFromObject(scene), materials, triangles: Math.round(triangles) };
    }
    const body = skinned as THREE.SkinnedMesh | null;
    if (!body) { warnOnce(`humanoid model "${name}" has no skinned mesh`); return null; }
    // the engine faces −Z; the files face +Z unless the manifest says otherwise
    scene.rotation.y = String(entry.facing ?? '+Z').toUpperCase() === '-Z' ? 0 : Math.PI;
    // bring the file to its stated height and stand it on y = 0 before anything is measured
    root.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(scene);
    const rawHeight = raw.max.y - raw.min.y;
    const k = entry.height && entry.height > 0.3 && rawHeight > 0.3 && Math.abs(entry.height / rawHeight - 1) > 0.01 ? entry.height / rawHeight : 1;
    scene.scale.multiplyScalar(k);
    scene.position.y = Number.isFinite(raw.min.y) ? -raw.min.y * k : 0;
    const rig = analyzeHumanoid(root, body);
    if (!rig) { warnOnce(`humanoid model "${name}": skeleton is not a usable humanoid rig`); return null; }
    root.updateMatrixWorld(true);
    // fixed, generous bounds (nothing is skinned on the CPU to cull it), given in the mesh's own space. The raw
    // geometry box is useless here: quantised vertices only make sense after skinning.
    const inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
    const c = new THREE.Vector3(0, rig.height * 0.5, 0).applyMatrix4(inv);
    const r = (rig.height * 1.75) * Math.cbrt(Math.abs(inv.determinant()));
    body.boundingSphere = new THREE.Sphere(c, r);
    body.boundingBox = new THREE.Box3(c.clone().subScalar(r), c.clone().addScalar(r));
    return { name, entry, root, mesh: body, rig, box: new THREE.Box3(new THREE.Vector3(-rig.height, 0, -rig.height), new THREE.Vector3(rig.height, rig.height, rig.height)), materials, triangles: Math.round(triangles) };
  }

  /** A new instance: own node hierarchy and skeleton, shared geometry / textures / materials. */
  instantiate(name: string): ModelInstance | null {
    const tpl = this.templates.get(name);
    if (!tpl) return null;
    const root = cloneSkinned(tpl.root) as THREE.Group;
    const meshes: THREE.Mesh[] = [];
    let mesh: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes.push(m);
      if (tpl.mesh && m.name === tpl.mesh.name && (m as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = m as THREE.SkinnedMesh;
    });
    return { template: tpl, root, mesh, meshes };
  }
}
