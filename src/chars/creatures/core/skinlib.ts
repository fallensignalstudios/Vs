/**
 * Skin library — generated creature meshes (public/models/*.glb, meshopt + WebP, "meshy24" humanoid rig) worn
 * over a creature's procedural animator.
 *
 * A skin is OPTIONAL presentation: createCreature() never waits for one. A creature built before its skin has
 * loaded shows its procedural body and swaps when the file arrives; if the file is missing, or outside a
 * browser (unit tests), the procedural body simply stays. Call `loadCreatureSkin` / preloadCreatureSkins()
 * during a loading screen to avoid the swap.
 *
 * convert() re-expresses the file in ENGINE model space once, so everything downstream is plain: metres, feet
 * on y = 0, front = −Z, unit-scale bones. The source faces +Z; it is brought round by MIRRORING z rather than
 * turning it, which also moves the generated elite's exposed shoulder from its left to the creature's RIGHT —
 * the canonical side of the 'joint' socket (see api/creatures.ts).
 */
import * as THREE from 'three';
import { warnOnce } from './rig';

export interface SkinBone {
  name: string;
  parent: number;
  /** bind transform in model space */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

export interface SkinTemplate {
  name: string;
  geometry: THREE.BufferGeometry;
  /** the file's own PBR material (maps are shared by every instance) */
  material: THREE.MeshStandardMaterial;
  bones: SkinBone[];
  height: number;
  triangles: number;
}

/** archetype → model file and standing height (metres) */
const SKINS: Readonly<Record<string, { file: string; height: number }>> = {
  elite: { file: 'elite.glb', height: 3.6 },
};

const cache = new Map<string, SkinTemplate>();
const pending = new Map<string, Promise<SkinTemplate | null>>();
let enabled = true;

/** master switch (default on): off = every creature keeps its procedural body */
export function setSkinsEnabled(on: boolean): void {
  enabled = !!on;
}
export function skinsEnabled(): boolean {
  return enabled;
}

/** archetypes that have a generated mesh */
export function skinnable(): string[] {
  return Object.keys(SKINS);
}

/** the loaded skin of an archetype, or null (not loaded / none / failed) */
export function getCreatureSkin(archetype: string): SkinTemplate | null {
  return cache.get(archetype) ?? null;
}

/** Load (once) and convert an archetype's generated mesh. Resolves null when there is none or it cannot load. */
export function loadCreatureSkin(archetype: string): Promise<SkinTemplate | null> {
  const def = SKINS[archetype];
  if (!def || typeof document === 'undefined') return Promise.resolve(null);
  const hit = cache.get(archetype);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(archetype);
  if (!p) {
    p = fetchSkin(archetype, def.file, def.height).catch((err: unknown) => {
      warnOnce('skin:' + archetype, `[creatures] generated mesh for "${archetype}" unavailable (${String((err as Error)?.message ?? err)}) — using the procedural body`);
      return null;
    });
    pending.set(archetype, p);
  }
  return p;
}

async function fetchSkin(archetype: string, file: string, height: number): Promise<SkinTemplate | null> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = import.meta.env?.BASE_URL ?? '/';
  const gltf = await loader.loadAsync(`${base}models/${file}`);
  const tpl = convertSkin(archetype, gltf.scene, height);
  if (tpl) cache.set(archetype, tpl);
  return tpl;
}

/**
 * Re-express a loaded skinned mesh in engine model space (see the file header). Pure — exported for tests.
 * Returns null when the scene holds no usable skinned mesh.
 */
export function convertSkin(name: string, scene: THREE.Object3D, height: number): SkinTemplate | null {
  scene.updateMatrixWorld(true);
  let src: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && (!src || m.geometry.getAttribute('position').count > src.geometry.getAttribute('position').count)) src = m;
  });
  const mesh = src as THREE.SkinnedMesh | null;
  if (!mesh || !mesh.skeleton || !mesh.geometry.getAttribute('skinIndex')) return null;
  const g = mesh.geometry;
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const bind = mesh.bindMatrix;
  const nm = new THREE.Matrix3().getNormalMatrix(bind);

  // bind-pose bounds → uniform scale to the declared height, feet on the floor
  const p = new THREE.Vector3();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(bind);
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!(maxY > minY)) return null;
  const k = height / (maxY - minY);

  const outP = new Float32Array(pos.count * 3), outN = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(bind);
    outP[i * 3] = p.x * k; outP[i * 3 + 1] = (p.y - minY) * k; outP[i * 3 + 2] = -p.z * k;
    if (nrm) {
      p.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      outN[i * 3] = p.x; outN[i * 3 + 1] = p.y; outN[i * 3 + 2] = -p.z;
    }
  }
  // a mirror turns every triangle inside out: swap two corners
  const srcIndex = g.getIndex();
  const count = srcIndex ? srcIndex.count : pos.count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i += 3) {
    index[i] = srcIndex ? srcIndex.getX(i) : i;
    index[i + 1] = srcIndex ? srcIndex.getX(i + 2) : i + 2;
    index[i + 2] = srcIndex ? srcIndex.getX(i + 1) : i + 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(outP, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  const uv = g.getAttribute('uv');
  if (uv) geometry.setAttribute('uv', uv);
  geometry.setAttribute('skinIndex', g.getAttribute('skinIndex'));
  geometry.setAttribute('skinWeight', g.getAttribute('skinWeight'));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  if (!nrm) geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5, 0), height);

  // bones: bind world transform = inverse of the inverse-bind matrix; mirrored, rescaled, scale dropped
  const sk = mesh.skeleton;
  const m = new THREE.Matrix4(), s = new THREE.Vector3();
  const bones: SkinBone[] = sk.bones.map((b, i) => {
    const bp = new THREE.Vector3(), bq = new THREE.Quaternion();
    m.copy(sk.boneInverses[i]!).invert().decompose(bp, bq, s);
    bp.set(bp.x * k, (bp.y - minY) * k, -bp.z * k);
    bq.set(-bq.x, -bq.y, bq.z, bq.w); // reflection of a rotation across the XY plane
    return { name: b.name, parent: b.parent ? sk.bones.indexOf(b.parent as THREE.Bone) : -1, pos: bp, quat: bq };
  });
  // parents must precede children for the retarget passes
  for (let i = 0; i < bones.length; i++) if (bones[i]!.parent >= i) return null;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!(mat as THREE.MeshStandardMaterial)?.isMeshStandardMaterial) return null;
  return { name, geometry, material: mat as THREE.MeshStandardMaterial, bones, height, triangles: count / 3 };
}

/** One wearer's copy of a skin: its own bones and skeleton over the shared geometry. */
export class SkinInstance {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  /** bind transforms in model space, by bone index */
  readonly restPos: THREE.Vector3[];
  readonly restQuat: THREE.Quaternion[];
  private readonly byName = new Map<string, number>();
  private readonly skeleton: THREE.Skeleton;

  constructor(readonly template: SkinTemplate, material: THREE.Material) {
    const inverses: THREE.Matrix4[] = [];
    const one = new THREE.Vector3(1, 1, 1), q = new THREE.Quaternion();
    this.restPos = template.bones.map((b) => b.pos);
    this.restQuat = template.bones.map((b) => b.quat);
    template.bones.forEach((sb, i) => {
      const b = new THREE.Bone();
      b.name = sb.name;
      if (sb.parent >= 0) {
        const par = template.bones[sb.parent]!;
        q.copy(par.quat).invert();
        b.position.copy(sb.pos).sub(par.pos).applyQuaternion(q);
        b.quaternion.copy(q).multiply(sb.quat);
        this.bones[sb.parent]!.add(b);
      } else {
        b.position.copy(sb.pos);
        b.quaternion.copy(sb.quat);
        this.group.add(b);
      }
      this.bones.push(b);
      this.byName.set(sb.name, i);
      inverses.push(new THREE.Matrix4().compose(sb.pos, sb.quat, one).invert());
    });
    this.skeleton = new THREE.Skeleton(this.bones, inverses);
    this.mesh = new THREE.SkinnedMesh(template.geometry, material);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, template.height * 0.5, 0), template.height);
    this.mesh.name = 'skin:' + template.name;
    this.group.add(this.mesh);
  }

  /** bone index by name (−1 when the rig has no such bone) */
  index(name: string): number {
    return this.byName.get(name) ?? -1;
  }

  dispose(): void {
    this.skeleton.dispose();
    this.group.removeFromParent();
  }
}
