/**
 * Bare-headed variant of a helmeted generated body: the helmet is cut from the body's index buffer and the head
 * and neck of another generated humanoid (the "donor", a civilian) are grafted on, skinned to the body's own
 * skeleton. Everything is measured from bones and skin weights, nothing is per-file:
 *
 *  - helmet = body vertices mostly weighted to the head bone (or its children) above the jaw line;
 *  - graft  = donor triangles whose vertices are all mostly weighted to the head / neck and lie above the
 *             donor's collar; moved from the donor's rest space onto the body's head joint (scaled by the ratio
 *             of the two statures and the look's proportions) and expressed in the body's RAW vertex space, so
 *             the body's skeleton, bind matrix and rest matrix (shader effects) apply to it unchanged.
 *
 * The graft keeps the donor's texture (it is drawn with the donor's material: one extra draw call); a look
 * re-tints its skin and recolours its hair (material.ts `uHair`) so the same donor can give different faces.
 * Results are cached per (body, donor, look) and shared by every instance, levels of detail included.
 */
import * as THREE from 'three';
import { MASK_NONE } from './config';
import type { ModelTemplate } from './library';
import { shareAttributes } from './lod';
import { createGlbMaterial, type GlbMaterial, type SharedUniforms } from './material';

/** How a bare head looks: which model gives it, and how it is re-tinted and proportioned. */
export interface BareHeadLook {
  /** manifest key of the model the head and neck come from */
  donor: string;
  /** linear albedo multiplier for the face */
  skin: readonly [number, number, number];
  /** linear colour hair, brows and beard are recoloured toward (their own shading is kept); w = amount 0..1 */
  hair: readonly [number, number, number, number];
  /** head proportions: width, height, depth multipliers */
  shape: readonly [number, number, number];
}

export interface BareHeadParts {
  /** the body without its helmet (shares the body's attributes) */
  body: THREE.BufferGeometry;
  bodyLods: THREE.BufferGeometry[];
  /** the grafted head, in the body's raw vertex space, skinned to the body's skeleton */
  head: THREE.BufferGeometry;
  headLods: THREE.BufferGeometry[];
  /** what was cut and grafted (diagnostics) */
  stats: { helmetVerts: number; headVerts: number; headTris: number };
}

/**
 * Where the helmet starts, in neck→head joint spans above the neck joint (meshy rigs put the two joints only
 * ~7 cm apart and weight the whole skull to the head): below it a high collar stays on the body.
 */
const HELMET_FROM = 1.15;
/** the donor's neck column: from this many joint spans below its neck joint, within this radius of the head axis */
const NECK_FROM = -1.6, NECK_R = 0.072;
/** weight on the head (helmet) or head + neck (graft) a vertex needs to belong to it */
const MIN_WEIGHT = 0.5;

const cache = new Map<string, BareHeadParts | null>();

/** bone indices of `root` and every skeleton bone below it */
function subtree(bones: THREE.Bone[], root: number): Set<number> {
  const out = new Set<number>();
  if (root < 0) return out;
  const r = bones[root];
  bones.forEach((b, i) => {
    for (let p: THREE.Object3D | null = b; p; p = p.parent) if (p === r) { out.add(i); break; }
  });
  return out;
}

function weightIn(si: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, sw: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, set: Set<number>): number {
  let w = 0, sum = 0;
  for (let k = 0; k < 4; k++) {
    const wk = sw.getComponent(i, k);
    sum += wk;
    if (set.has(si.getComponent(i, k))) w += wk;
  }
  return sum > 1e-6 ? w / sum : 0;
}

interface Region {
  tpl: ModelTemplate;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  head: number;
  neckY: number;
  headY: number;
  headPos: THREE.Vector3;
}

function region(tpl: ModelTemplate): Region | null {
  const mesh = tpl.mesh, rig = tpl.rig;
  if (!mesh || !rig || !rig.names.head) return null;
  const bones = mesh.skeleton.bones;
  const head = bones.findIndex((b) => b.name === rig.names.head);
  const neck = rig.names.neck ? bones.findIndex((b) => b.name === rig.names.neck) : -1;
  if (head < 0) return null;
  tpl.root.updateMatrixWorld(true);
  const headPos = bones[head].getWorldPosition(new THREE.Vector3());
  const neckPos = neck >= 0 ? bones[neck].getWorldPosition(new THREE.Vector3()) : headPos.clone().setY(headPos.y - 0.12);
  return { tpl, mesh, bones, head, neckY: neckPos.y, headY: headPos.y, headPos };
}

/** keep the triangles of `index` that `keep` accepts (by vertex), remapped through `remap` when given */
function filterIndex(index: ArrayLike<number>, keep: (a: number, b: number, c: number) => boolean, remap?: Int32Array): Uint16Array | Uint32Array {
  const out: number[] = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    if (!keep(a, b, c)) continue;
    if (remap) out.push(remap[a], remap[b], remap[c]); else out.push(a, b, c);
  }
  let max = 0;
  for (const v of out) if (v > max) max = v;
  return max > 65535 ? new Uint32Array(out) : new Uint16Array(out);
}

const indexArray = (g: THREE.BufferGeometry): ArrayLike<number> | null => (g.index ? (g.index.array as ArrayLike<number>) : null);

/**
 * The helmet-less body and the grafted head for `body` wearing `donor`'s head with `look`. Null when either
 * model cannot be measured (the caller keeps the helmeted body). Cached; never throws.
 */
export function bareHeadParts(body: ModelTemplate, donor: ModelTemplate, look: BareHeadLook): BareHeadParts | null {
  const key = `${body.name}|${donor.name}|${look.shape.join(',')}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let parts: BareHeadParts | null = null;
  try { parts = build(body, donor, look); } catch (err) { console.warn('[glb] bare head could not be built', err); }
  cache.set(key, parts);
  return parts;
}

function build(bodyTpl: ModelTemplate, donorTpl: ModelTemplate, look: BareHeadLook): BareHeadParts | null {
  const B = region(bodyTpl), D = region(donorTpl);
  if (!B || !D || !bodyTpl.rig || !donorTpl.rig) return null;
  const bg = B.mesh.geometry, dg = D.mesh.geometry;
  const bIdx = indexArray(bg), dIdx = indexArray(dg);
  const bP = bg.getAttribute('position'), bSI = bg.getAttribute('skinIndex'), bSW = bg.getAttribute('skinWeight');
  const dP = dg.getAttribute('position'), dN = dg.getAttribute('normal'), dUV = dg.getAttribute('uv'), dT = dg.getAttribute('tangent');
  const dSI = dg.getAttribute('skinIndex'), dSW = dg.getAttribute('skinWeight');
  if (!bIdx || !dIdx || !bP || !bSI || !bSW || !dP || !dSI || !dSW) return null;
  const Rb = bodyTpl.rig.restMatrix, Rd = donorTpl.rig.restMatrix;
  const v = new THREE.Vector3();

  // ---- the helmet: head-weighted body vertices above the jaw line
  const bHead = subtree(B.bones, B.head);
  const cutY = B.neckY + (B.headY - B.neckY) * HELMET_FROM;
  const helmet = new Uint8Array(bP.count);
  let helmetVerts = 0;
  for (let i = 0; i < bP.count; i++) {
    if (weightIn(bSI, bSW, i, bHead) < MIN_WEIGHT) continue;
    v.fromBufferAttribute(bP, i).applyMatrix4(Rb);
    if (v.y > cutY) { helmet[i] = 1; helmetVerts++; }
  }
  if (helmetVerts < 50) return null;
  const noHelmet = (a: number, b: number, c: number): boolean => !helmet[a] && !helmet[b] && !helmet[c];
  const body = shareAttributes(bg, filterIndex(bIdx, noHelmet));
  const bodyLods = bodyTpl.lods.map((g) => shareAttributes(bg, filterIndex(indexArray(g) ?? [], noHelmet)));

  // ---- the graft: head- and neck-weighted donor vertices above its collar
  const dHeadNeck = subtree(D.bones, D.head);
  const dNeck = donorTpl.rig.names.neck ? D.bones.findIndex((b) => b.name === donorTpl.rig!.names.neck) : -1;
  if (dNeck >= 0) dHeadNeck.add(dNeck);
  // (plus the bare neck under it: skin close round the head axis, whatever bone carries it — never a collar)
  const neckFrom = D.neckY + (D.headY - D.neckY) * NECK_FROM;
  const inHead = new Uint8Array(dP.count);
  for (let i = 0; i < dP.count; i++) {
    v.fromBufferAttribute(dP, i).applyMatrix4(Rd);
    if (v.y < neckFrom) continue;
    const r = Math.hypot(v.x - D.headPos.x, v.z - D.headPos.z);
    // behind and below the skull, anything wider than the neck is the civilian's collar
    const collar = v.y < D.headY + 0.03 && v.z > D.headPos.z + 0.015 && r > NECK_R;
    if (r < NECK_R || (!collar && weightIn(dSI, dSW, i, dHeadNeck) >= MIN_WEIGHT)) inHead[i] = 1;
  }
  const allIn = (a: number, b: number, c: number): boolean => !!inHead[a] && !!inHead[b] && !!inHead[c];
  // compact: only vertices used by kept triangles
  const remap = new Int32Array(dP.count).fill(-1);
  const order: number[] = [];
  for (let t = 0; t + 2 < dIdx.length; t += 3) {
    const a = dIdx[t], b = dIdx[t + 1], c = dIdx[t + 2];
    if (!allIn(a, b, c)) continue;
    for (const k of [a, b, c]) if (remap[k] < 0) { remap[k] = order.length; order.push(k); }
  }
  if (order.length < 50) return null;

  // donor rest → body rest: head joint onto head joint, scaled by stature and the look's proportions
  const k = B.headY / Math.max(0.5, D.headY);
  const S = new THREE.Matrix4().makeScale(k * look.shape[0], k * look.shape[1], k * look.shape[2]);
  const toBodyRest = new THREE.Matrix4().makeTranslation(B.headPos.x, B.headPos.y, B.headPos.z)
    .multiply(S).multiply(new THREE.Matrix4().makeTranslation(-D.headPos.x, -D.headPos.y, -D.headPos.z));
  // donor raw → body raw
  const M = new THREE.Matrix4().copy(Rb).invert().multiply(toBodyRest).multiply(Rd);
  const Nm = new THREE.Matrix3().getNormalMatrix(M);
  const D3 = new THREE.Matrix3().setFromMatrix4(M);

  // bone indices by name: the donor's skeleton onto the body's
  const byName = new Map<string, number>();
  B.bones.forEach((b, i) => byName.set(b.name, i));
  const boneMap = D.bones.map((b) => byName.get(b.name) ?? B.head);

  const n = order.length;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const tan = dT ? new Float32Array(n * 4) : null;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let j = 0; j < n; j++) {
    const i = order[j];
    v.fromBufferAttribute(dP, i).applyMatrix4(M);
    pos[j * 3] = v.x; pos[j * 3 + 1] = v.y; pos[j * 3 + 2] = v.z;
    if (dN) { v.fromBufferAttribute(dN, i).applyMatrix3(Nm).normalize(); nrm[j * 3] = v.x; nrm[j * 3 + 1] = v.y; nrm[j * 3 + 2] = v.z; }
    if (dUV) { uv[j * 2] = dUV.getX(i); uv[j * 2 + 1] = dUV.getY(i); }
    if (dT && tan) {
      v.set(dT.getX(i), dT.getY(i), dT.getZ(i)).applyMatrix3(D3).normalize();
      tan[j * 4] = v.x; tan[j * 4 + 1] = v.y; tan[j * 4 + 2] = v.z; tan[j * 4 + 3] = dT.getW(i) * Math.sign(D3.determinant() || 1);
    }
    for (let q = 0; q < 4; q++) { si[j * 4 + q] = boneMap[dSI.getComponent(i, q)] ?? B.head; sw[j * 4 + q] = dSW.getComponent(i, q); }
  }
  const head = new THREE.BufferGeometry();
  head.name = `bareHead:${donorTpl.name}`;
  head.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  head.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  head.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (tan) head.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  head.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  head.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  head.setIndex(new THREE.BufferAttribute(filterIndex(dIdx, allIn, remap), 1));
  // the donor's levels, cut to the same region (a coarse level may drop a vertex the full one used: harmless)
  const headLods = donorTpl.lods.map((g) => shareAttributes(head, filterIndex(indexArray(g) ?? [], allIn, remap)));
  return { body, bodyLods, head, headLods, stats: { helmetVerts, headVerts: n, headTris: (head.index?.count ?? 0) / 3 } };
}

/** A grafted head mounted on one instance. */
export interface MountedHead {
  mesh: THREE.SkinnedMesh;
  material: GlbMaterial;
  lods: THREE.BufferGeometry[];
  bodyLods: THREE.BufferGeometry[];
}

/**
 * Mount a bare head on an instance's body: the body mesh switches to its helmet-less geometry and a skinned head
 * mesh (donor material, re-tinted by `look`) joins it on the same skeleton. Null when it cannot be done (the
 * body keeps its helmet).
 */
export function mountBareHead(body: THREE.SkinnedMesh, bodyTpl: ModelTemplate, donorTpl: ModelTemplate, look: BareHeadLook, shared: SharedUniforms, env: number): MountedHead | null {
  const parts = bareHeadParts(bodyTpl, donorTpl, look);
  const src = donorTpl.materials[donorTpl.lodMesh] ?? donorTpl.materials[0];
  if (!parts || !src || !bodyTpl.rig || !body.parent) return null;
  const gm = createGlbMaterial(src, shared, { mask: MASK_NONE, rest: bodyTpl.rig.restMatrix, albedoCap: 0.62, envIntensity: env, doubleSided: true });
  gm.own.uTint.value.setRGB(look.skin[0], look.skin[1], look.skin[2]);
  gm.own.uHair.value.set(look.hair[0], look.hair[1], look.hair[2], look.hair[3]);
  const mesh = new THREE.SkinnedMesh(parts.head, gm.material);
  mesh.name = 'bareHead';
  mesh.position.copy(body.position);
  mesh.quaternion.copy(body.quaternion);
  mesh.scale.copy(body.scale);
  body.parent.add(mesh);
  mesh.bind(body.skeleton, body.bindMatrix);
  // the body's fixed bounds (nothing is skinned on the CPU to cull it)
  if (body.boundingSphere) mesh.boundingSphere = body.boundingSphere.clone();
  if (body.boundingBox) mesh.boundingBox = body.boundingBox.clone();
  mesh.customDepthMaterial = gm.depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  body.geometry = parts.body;
  return { mesh, material: gm, lods: parts.headLods, bodyLods: parts.bodyLods };
}
