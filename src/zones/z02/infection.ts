/**
 * Z02 — what the Eclipse tissue does to the soldier's arm (the author's ruling 2): the crack from Z01 on his left
 * gauntlet, lit violet from inside, black tissue working into it, violet veins crawling up the forearm; then the
 * amputation (the forearm is gone below the elbow, the stump wrapped), and the severed limb on the floor being
 * consumed by black tissue. Pure presentation — the scene in ./varo.ts drives `grow`, `amputate` and `consume`;
 * `updateInfection` (ZoneDef.update) eases them on the sim clock and snaps on a skip.
 *
 * The generated soldier's skeleton is reached by bone name (Mixamo convention, `LeftForeArm`); the forearm bone
 * is scaled to nothing, which folds the forearm and hand into the elbow. The procedural fallback figure keeps
 * its arm (its bones are not named that way) — the wrap and the limb on the floor still tell the story.
 *
 * Polish 4: the severed limb on the floor is HIS forearm — the generated body's own forearm and gauntleted hand,
 * cut out of his mesh (the triangles skinned to the forearm and everything below it) and laid on its flattest
 * side, drawn with his own material — torn at the elbow and covered in black tissue that swells over it from the
 * cracked gauntlet back to the torn end, violet veins running under it. The primitive capsule-and-box limb stays
 * only as the fallback for a body that has no forearm bone (the procedural figure).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Companion, ZoneRuntime } from '@/core/api';
import { VIOLET } from '../shared';

interface InfectionState {
  /** veins + crack + tissue on the living hand (rides the `handL` socket) */
  hand: THREE.Group | null;
  veins: THREE.BufferGeometry[];
  veinCount: number[];
  tissue: THREE.Object3D[];
  grow: number;
  growTarget: number;
  /** the severed limb on the floor and the mass consuming it */
  limb: THREE.Group | null;
  /** where the limb lies (world) and which way it points, for a late upgrade to the body's own forearm */
  limbAt: THREE.Vector3;
  limbYaw: number;
  /** the limb is the body's own forearm (false: the primitive fallback) */
  limbReal: boolean;
  /** seconds until the next try at the body's forearm (the generated body may attach after the cut), tries made */
  limbRetry: number;
  limbTries: number;
  mass: THREE.Object3D[];
  /** the real limb's nodules drawn as one instanced mesh (the `mass` entries are its unrendered placements) */
  massMesh: THREE.InstancedMesh | null;
  consume: number;
  consumeTarget: number;
  /** the stump wrap (world space, follows the elbow every frame) */
  wrap: THREE.Mesh | null;
  amputated: boolean;
  bone: THREE.Bone | null;
  boneOf: THREE.Object3D | null;
}

function blank(): InfectionState {
  return {
    hand: null, veins: [], veinCount: [], tissue: [], grow: 0, growTarget: 0, limb: null, limbAt: new THREE.Vector3(), limbYaw: 0,
    limbReal: false, limbRetry: 0, limbTries: 0, mass: [], massMesh: null, consume: 0, consumeTarget: 0, wrap: null, amputated: false, bone: null, boneOf: null,
  };
}
let I: InfectionState = blank();

export function resetInfection(): void {
  I = blank();
}

/** 0..1 how far the infection has crawled up the forearm (eased; 1 = to the elbow) */
export function setInfectionGrowth(target: number): void {
  I.growTarget = Math.max(0, Math.min(1, target));
}

/** 0..1 how much of the severed limb the black tissue has taken */
export function setConsumed(target: number): void {
  I.consumeTarget = Math.max(0, Math.min(1, target));
}

/** true once the cut has been made this load */
/** world position of the wrapped stump (false until the cut, or when the body has no forearm bone) */
export function stumpWorld(out: THREE.Vector3): boolean {
  if (!I.wrap || !I.wrap.visible) return false;
  I.wrap.getWorldPosition(out);
  return true;
}

export function isAmputated(): boolean {
  return I.amputated;
}

/** the generated body's forearm bone (Mixamo naming), searched on the visible skinned meshes only */
function forearmBone(root: THREE.Object3D): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverseVisible((o) => {
    if (found || !(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    for (const b of (o as THREE.SkinnedMesh).skeleton?.bones ?? []) {
      if (/(^|:)left_?fore_?arm$/i.test(b.name)) {
        found = b;
        return;
      }
    }
  });
  return found;
}

/**
 * Seat the infection on the soldier's left hand: the violet-lit split in the plate (three short angular
 * segments, the Z01 crack), black tissue nodules working into it, and three veins that run from the crack up
 * the forearm toward the elbow (revealed by `grow`). Built in world space as the arm lies now, then carried
 * in the `handL` socket's frame.
 */
export function attachInfection(z: ZoneRuntime, who: Companion | null): void {
  if (I.hand || !who?.actor.visual) return;
  const visual = who.actor.visual;
  const mats = z.game.mats;
  const socket = visual.socket('handL');
  socket.updateWorldMatrix(true, false);
  const hand = socket.getWorldPosition(new THREE.Vector3());
  const bone = forearmBone(visual.root);
  const elbow = new THREE.Vector3();
  if (bone) bone.getWorldPosition(elbow);
  else elbow.copy(hand).add(new THREE.Vector3(0, 0.27, 0));
  const along = elbow.clone().sub(hand);
  const len = Math.max(0.12, along.length());
  along.normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(along);
  if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
  side.normalize();
  const up = along.clone().cross(side).normalize();

  const g = new THREE.Group();
  g.name = 'z02-infection';
  const lit = mats.emissive(VIOLET, 3.2);
  // the veins glow from under the surface: dimmer than the crack
  const vein = mats.emissive(VIOLET, 1.6);
  const tissue = mats.get('eclipseTissue');
  // the crack: three angular segments across the back of the plate, just above the knuckles
  const crackAt = hand.clone().addScaledVector(along, 0.03).addScaledVector(up, 0.045);
  const segs: Array<[number, number, number]> = [[-0.02, 0.6, 0.03], [0.0, -0.4, 0.028], [0.021, 0.35, 0.022]];
  for (const [o, rot, l] of segs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(l, 0.005, 0.006), lit);
    m.position.copy(crackAt).addScaledVector(side, o);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, along)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot));
    g.add(m);
  }
  // tissue working into the crack
  for (const [o, a, r] of [[-0.012, 0.0, 0.016], [0.01, 0.012, 0.012], [0.024, -0.008, 0.01], [-0.026, 0.01, 0.009]] as const) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), tissue);
    m.position.copy(crackAt).addScaledVector(side, o).addScaledVector(along, a).addScaledVector(up, 0.004);
    m.scale.set(1.4, 0.55, 1.1);
    g.add(m);
    I.tissue.push(m);
  }
  // veins: from the crack along the top and both flanks of the forearm toward the elbow
  const radius = 0.05;
  for (const [ang, wob] of [[0, 0.012], [1.1, 0.016], [-1.0, 0.014]] as const) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = ang + Math.sin(t * 9 + ang * 3) * 0.35;
      const off = side.clone().multiplyScalar(Math.sin(a) * radius).addScaledVector(up, Math.cos(a) * radius);
      pts.push(crackAt.clone().addScaledVector(along, t * len * 0.92).add(off).addScaledVector(side, Math.sin(t * 17) * wob * t));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.0022, 4, false);
    geo.setDrawRange(0, 0);
    I.veins.push(geo);
    I.veinCount.push(geo.index ? geo.index.count : 0);
    g.add(new THREE.Mesh(geo, vein));
  }
  // into the socket's frame (sockets carry unit scale), so it rides the hand from here on
  const inv = socket.matrixWorld.clone().invert();
  for (const c of g.children) {
    c.updateMatrix();
    c.matrix.premultiply(inv).decompose(c.position, c.quaternion, c.scale);
  }
  socket.add(g);
  I.hand = g;
  I.bone = bone;
  I.boneOf = visual.root;
  z.onDispose(() => {
    g.removeFromParent();
    for (const c of g.children) (c as THREE.Mesh).geometry.dispose();
    lit.dispose();
    vein.dispose();
  });
}

/**
 * The cut. The forearm folds into the elbow (generated body), the hand's infection goes with it, a dark field
 * wrap seals the stump, and the severed limb lies at `limbAt` (world, on the floor) pointing along `limbYaw`.
 */
export function amputate(z: ZoneRuntime, who: Companion | null, limbAt: THREE.Vector3, limbYaw: number): void {
  if (I.amputated) return;
  I.amputated = true;
  const mats = z.game.mats;
  if (I.hand) I.hand.visible = false;
  if (who?.actor.visual && !I.bone) {
    I.bone = forearmBone(who.actor.visual.root);
    I.boneOf = who.actor.visual.root;
  }
  // the wrap
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.058, 0.11, 12), mats.get('domCloth'));
  wrap.name = 'z02-stump';
  z.builder.add(wrap);
  I.wrap = wrap;
  I.limbRetry = 0.5;
  I.limbAt.copy(limbAt);
  I.limbYaw = limbYaw;
  const real = who?.actor.visual ? buildRealLimb(z, who.actor.visual.root, limbAt, limbYaw) : null;
  setLimb(z, real ?? buildPrimitiveLimb(z, limbAt, limbYaw), !!real);
  z.onDispose(() => {
    wrap.removeFromParent();
    wrap.geometry.dispose();
    disposeLimb();
  });
}

/** put `limb` on the floor in place of the current one (its nodules become the mass `consume` swells) */
function setLimb(z: ZoneRuntime, limb: THREE.Group, real: boolean): void {
  disposeLimb();
  I.mass = (limb.userData.mass as THREE.Object3D[] | undefined) ?? [];
  I.massMesh = (limb.userData.massMesh as THREE.InstancedMesh | undefined) ?? null;
  z.builder.add(limb);
  I.limb = limb;
  I.limbReal = real;
}

function disposeLimb(): void {
  const limb = I.limb;
  if (!limb) return;
  limb.removeFromParent();
  // (geometry only: the materials are the library's shared ones and the body's own)
  limb.traverse((c) => {
    (c as THREE.Mesh).geometry?.dispose();
    if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
  });
  I.limb = null;
  I.mass = [];
  I.massMesh = null;
}

/** the fallback limb: a forearm and a cracked gauntlet from primitives, lying on its side, nodules over it */
function buildPrimitiveLimb(z: ZoneRuntime, limbAt: THREE.Vector3, limbYaw: number): THREE.Group {
  const mats = z.game.mats;
  const limb = new THREE.Group();
  limb.name = 'z02-limb';
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 10), mats.get('domBlack'));
  fore.rotation.z = Math.PI / 2;
  fore.position.set(0, 0.055, 0);
  limb.add(fore);
  const gauntlet = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.1), mats.get('domBronze'));
  gauntlet.position.set(0.19, 0.05, 0);
  limb.add(gauntlet);
  const crackMat = mats.emissive(VIOLET, 3);
  const crack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.006), crackMat);
  crack.position.set(0.19, 0.095, 0.01);
  crack.rotation.y = 0.5;
  limb.add(crack);
  // the mass that takes it: black nodules swelling over it from the crack end
  const tissue = mats.get('eclipseTissue');
  const blobs: Array<[number, number, number, number]> = [
    [0.19, 0.06, 0.0, 0.07], [0.13, 0.07, 0.03, 0.06], [0.06, 0.065, -0.02, 0.065], [-0.02, 0.06, 0.02, 0.06],
    [-0.09, 0.055, -0.01, 0.055], [0.1, 0.04, -0.05, 0.045], [0.02, 0.035, 0.06, 0.04], [0.24, 0.03, 0.04, 0.035],
  ];
  const mass: THREE.Object3D[] = [];
  for (const [x, y, zz, r] of blobs) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), tissue);
    m.position.set(x, y, zz);
    m.scale.setScalar(0.001);
    m.userData.s = [1.3, 0.75, 1.15];
    limb.add(m);
    mass.push(m);
  }
  limb.position.copy(limbAt);
  limb.rotation.y = limbYaw;
  limb.userData.mass = mass;
  return limb;
}

/** the generated body's skinned mesh with the most of the forearm in it, and the bones that carry it */
interface ForearmSource {
  mesh: THREE.SkinnedMesh;
  /** per-vertex weight on the forearm and every bone below it */
  w: Float32Array;
  fore: number;
  hand: number;
  arm: number;
}

function forearmSource(root: THREE.Object3D): ForearmSource | null {
  let best: ForearmSource | null = null;
  let bestCount = 0;
  root.traverseVisible((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const bones = mesh.skeleton.bones;
    const fore = bones.findIndex((b) => /(^|:)left_?fore_?arm$/i.test(b.name));
    if (fore < 0) return;
    const set = new Set<number>();
    bones[fore].traverse((b) => {
      const i = bones.indexOf(b as THREE.Bone);
      if (i >= 0) set.add(i);
    });
    const hand = bones.findIndex((b, i) => i !== fore && set.has(i) && /(^|:)left_?hand$/i.test(b.name));
    const arm = bones.indexOf(bones[fore].parent as THREE.Bone);
    const geo = mesh.geometry;
    const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight'), pos = geo.getAttribute('position');
    if (!si || !sw || !pos || hand < 0 || arm < 0) return;
    const w = new Float32Array(pos.count);
    let count = 0;
    for (let v = 0; v < pos.count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) if (set.has(si.getComponent(v, k))) sum += sw.getComponent(v, k);
      w[v] = sum;
      if (sum > 0.5) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = { mesh, w, fore, hand, arm };
    }
  });
  return bestCount > 40 ? best : null;
}

const _m = new THREE.Matrix4();
/** a bone's position in the skeleton's bind pose (bind world space) */
function bindPos(src: ForearmSource, i: number, out: THREE.Vector3): THREE.Vector3 {
  return out.setFromMatrixPosition(_m.copy(src.mesh.skeleton.boneInverses[i]).invert());
}

/**
 * His own forearm on the floor: the triangles of his mesh skinned (≥ 0.5) to the forearm and below, compacted into a
 * static mesh in the bind pose (straight, the hand open), scaled to his size, laid on its flattest side with the
 * torn elbow end at `limbAt` and the hand toward `limbYaw`; the black mass over it from the gauntlet back to the
 * torn end, violet veins, the Z01 crack. Null when the body has no forearm to give (procedural figure).
 */
function buildRealLimb(z: ZoneRuntime, root: THREE.Object3D, limbAt: THREE.Vector3, limbYaw: number): THREE.Group | null {
  root.updateWorldMatrix(true, true);
  const src = forearmSource(root);
  if (!src) return null;
  const geo = src.mesh.geometry;
  const pos = geo.getAttribute('position');
  // the triangles: every vertex mostly on the forearm (the cut falls at the elbow)
  const idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const keep: number[] = [];
  const remap = new Map<number, number>();
  for (let t = 0; t < tri; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    if (src.w[a] < 0.5 || src.w[b] < 0.5 || src.w[c] < 0.5) continue;
    for (const v of [a, b, c]) {
      if (!remap.has(v)) remap.set(v, remap.size);
      keep.push(remap.get(v)!);
    }
  }
  if (keep.length < 60) return null;
  const sub = new THREE.BufferGeometry();
  const verts = [...remap.keys()];
  for (const [name, attr] of Object.entries(geo.attributes)) {
    if (name === 'skinIndex' || name === 'skinWeight') continue;
    const n = attr.itemSize, out = new Float32Array(verts.length * n);
    verts.forEach((v, j) => {
      for (let k = 0; k < n; k++) out[j * n + k] = attr.getComponent(v, k);
    });
    sub.setAttribute(name, new THREE.BufferAttribute(out, n));
  }
  sub.setIndex(keep);
  sub.computeBoundingSphere();

  // raw vertex → bind world (bindMatrix) → metres, elbow at the origin, forearm along +X
  const E = bindPos(src, src.fore, new THREE.Vector3()), H = bindPos(src, src.hand, new THREE.Vector3());
  const A = bindPos(src, src.arm, new THREE.Vector3());
  const bones = src.mesh.skeleton.bones;
  const aw = bones[src.arm].getWorldPosition(new THREE.Vector3()), ew = bones[src.fore].getWorldPosition(new THREE.Vector3());
  const k = aw.distanceTo(ew) / Math.max(1e-6, A.distanceTo(E));
  const axis = H.clone().sub(E).normalize();
  const align = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(1, 0, 0)));
  const canon = new THREE.Matrix4().makeScale(k, k, k).multiply(align).multiply(new THREE.Matrix4().makeTranslation(-E.x, -E.y, -E.z)).multiply(src.mesh.bindMatrix);
  // the flattest side down: the roll about the forearm that gives the lowest profile
  const pts: THREE.Vector3[] = [];
  const step = Math.max(1, Math.floor(verts.length / 600));
  for (let j = 0; j < verts.length; j += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, verts[j]).applyMatrix4(canon));
  let bestRoll = 0, bestH = Infinity;
  for (let r = 0; r < 24; r++) {
    const a = (r / 24) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      const y = p.y * ca - p.z * sa;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if (hi - lo < bestH - 1e-4) {
      bestH = hi - lo;
      bestRoll = a;
    }
  }
  const roll = new THREE.Matrix4().makeRotationX(bestRoll);
  let lo = Infinity, len = 0;
  const local = pts.map((p) => p.clone().applyMatrix4(roll));
  for (const p of local) {
    lo = Math.min(lo, p.y);
    len = Math.max(len, p.x);
  }
  // in the limb's frame (x along it from the torn elbow, y up from the floor): the top of the limb along its length
  const top = (x: number, zc: number): number => {
    let hi = 0.03;
    for (const p of local) if (Math.abs(p.x - x) < 0.035 && Math.abs(p.z - zc) < 0.05) hi = Math.max(hi, p.y - lo);
    return hi;
  };
  const halfW = (x: number): number => {
    let hw = 0.03;
    for (const p of local) if (Math.abs(p.x - x) < 0.04) hw = Math.max(hw, Math.abs(p.z));
    return hw;
  };

  const limb = new THREE.Group();
  limb.name = 'z02-limb';
  const mesh = new THREE.Mesh(sub, src.mesh.material);
  mesh.name = 'z02-limb-forearm';
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeTranslation(0, -lo + 0.004, 0).multiply(roll).multiply(canon);
  mesh.customDepthMaterial = src.mesh.customDepthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  limb.add(mesh);

  const mats = z.game.mats;
  const tissue = mats.get('eclipseTissue');
  const crackMat = mats.emissive(VIOLET, 3);
  const veinMat = mats.emissive(VIOLET, 1.3);
  const ball = new THREE.SphereGeometry(1, 12, 9);
  const mass: THREE.Object3D[] = [];
  // a private, fixed stream: the same mass on every load
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  // (each nodule is a placement; all of them draw as ONE instanced mesh, see below)
  const nodule = (x: number, zc: number, r: number, sink = 0.35, sx = 1.35, sy = 0.7, sz = 1.15): void => {
    const m = new THREE.Object3D();
    m.position.set(x, top(x, zc) - r * sink, zc);
    m.rotation.y = rnd() * Math.PI;
    m.scale.setScalar(0.001);
    m.userData.r = r;
    m.userData.s = [sx * r, sy * r, sz * r];
    mass.push(m);
  };
  // the crack in the back of the gauntlet (a hand's length from the end), where the mass began
  const hx = Math.max(0.12, len - 0.13);
  const crackParts: THREE.BufferGeometry[] = [];
  for (const [o, rot, l] of [[-0.02, 0.6, 0.034], [0.0, -0.4, 0.03], [0.021, 0.35, 0.024]] as const) {
    crackParts.push(new THREE.BoxGeometry(l, 0.005, 0.006).rotateY(rot).translate(hx + o * 0.4, top(hx, o) + 0.001, o));
  }
  const crackGeo = mergeGeometries(crackParts);
  for (const g of crackParts) g.dispose();
  if (crackGeo) limb.add(new THREE.Mesh(crackGeo, crackMat));
  // the mass, ordered from the crack outward (the order `consume` swells it in): over the gauntlet, up the forearm,
  // and a heaped collar over the torn elbow end
  nodule(hx, 0.0, 0.055);
  nodule(hx - 0.04, 0.03, 0.045);
  nodule(hx + 0.035, -0.03, 0.04);
  for (let x = hx - 0.07; x > 0.04; x -= 0.036 + rnd() * 0.016) {
    const hw = halfW(x);
    // over the top, and down both flanks to the floor (the mass grips the whole forearm)
    nodule(x, (rnd() - 0.5) * hw * 0.9, 0.04 + rnd() * 0.024);
    nodule(x - 0.012, hw * (0.75 + rnd() * 0.2), 0.03 + rnd() * 0.016, 0.9, 1.2, 0.95, 1.0);
    nodule(x + 0.01, -hw * (0.75 + rnd() * 0.2), 0.03 + rnd() * 0.016, 0.9, 1.2, 0.95, 1.0);
  }
  // spilled over the floor round the limb: a low, flattened pool of it
  for (let i = 0; i < 9; i++) {
    const x = hx * (i / 8) + (rnd() - 0.5) * 0.05;
    const side = i % 2 ? 1 : -1;
    const m = new THREE.Object3D();
    const r = 0.05 + rnd() * 0.04;
    m.position.set(x, 0.006, side * (halfW(x) + r * 0.45));
    m.rotation.y = rnd() * Math.PI;
    m.scale.setScalar(0.001);
    m.userData.s = [1.6 * r, 0.22 * r, 1.1 * r];
    mass.push(m);
  }
  const ew0 = halfW(0.02), eh = top(0.02, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI;
    const m = new THREE.Object3D();
    const r = 0.038 + rnd() * 0.02;
    m.position.set(0.005 + rnd() * 0.02, Math.max(r * 0.5, Math.sin(a) * eh * 0.9), Math.cos(a) * ew0 * 0.95);
    m.scale.setScalar(0.001);
    m.userData.s = [1.1 * r, 0.9 * r, 1.1 * r];
    mass.push(m);
  }
  // the veins: from the crack back along the top toward the torn end, under the mass
  const veinParts: THREE.BufferGeometry[] = [];
  for (const [zc, wob] of [[0.0, 0.012], [0.022, 0.016], [-0.02, 0.014]] as const) {
    const vp: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const x = hx - (hx - 0.03) * (i / 10);
      const zz = zc + Math.sin(i * 1.7 + zc * 40) * wob;
      vp.push(new THREE.Vector3(x, top(x, zz) + 0.002, zz));
    }
    veinParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vp), 24, 0.0028, 4, false));
  }
  const veinGeo = mergeGeometries(veinParts);
  for (const g of veinParts) g.dispose();
  if (veinGeo) limb.add(new THREE.Mesh(veinGeo, veinMat));
  // the whole mass in one draw call: the placements above drive its instances (`updateInfection`)
  const massMesh = new THREE.InstancedMesh(ball, tissue, mass.length);
  massMesh.name = 'z02-limb-mass';
  massMesh.frustumCulled = false;
  massMesh.castShadow = true;
  massMesh.receiveShadow = true;
  limb.add(massMesh);
  // centred on the mark, like the primitive it replaces
  const outer = new THREE.Group();
  outer.name = 'z02-limb';
  limb.name = 'z02-limb-body';
  limb.position.x = -len * 0.5;
  outer.add(limb);
  outer.position.copy(limbAt);
  outer.rotation.y = limbYaw;
  outer.userData.mass = mass;
  outer.userData.massMesh = massMesh;
  syncMass(massMesh, mass);
  return outer;
}

/** copy the nodule placements into the instanced mass */
function syncMass(mesh: THREE.InstancedMesh, mass: THREE.Object3D[]): void {
  for (let i = 0; i < mass.length; i++) {
    mass[i].updateMatrix();
    mesh.setMatrixAt(i, mass[i].matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

const _e = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);

/** ZoneDef.update: ease growth / consumption, keep the forearm folded and the wrap on the elbow */
export function updateInfection(z: ZoneRuntime, dt: number): void {
  const k = z.skipping ? 1 : Math.min(1, dt * 0.8);
  I.grow += (I.growTarget - I.grow) * k;
  for (let i = 0; i < I.veins.length; i++) I.veins[i].setDrawRange(0, Math.floor((I.veinCount[i] * I.grow) / 6) * 6);
  const ts = 0.6 + I.grow * 0.7;
  for (const t of I.tissue) t.scale.set(1.4 * ts, 0.55 * ts, 1.1 * ts);
  const kc = z.skipping ? 1 : Math.min(1, dt * 1.6);
  I.consume += (I.consumeTarget - I.consume) * kc;
  const nm = Math.max(1, I.mass.length);
  for (let i = 0; i < I.mass.length; i++) {
    // the nodules swell one after another from the gauntlet end
    const s = Math.max(0.001, Math.min(1, I.consume * 1.6 - (i / nm) * 0.6));
    const k = (I.mass[i].userData.s as [number, number, number] | undefined) ?? [1.3, 0.75, 1.15];
    I.mass[i].scale.set(s * k[0], s * k[1], s * k[2]);
  }
  if (I.massMesh) syncMass(I.massMesh, I.mass);
  if (!I.amputated) return;
  // the generated body may attach after the cut (a checkpoint entry): find its forearm bone, then trade the
  // primitive limb for its own forearm (a few tries, then the primitive stays)
  if ((!I.bone || !I.limbReal) && I.boneOf && I.limbRetry > 0) {
    I.limbRetry -= dt;
    if (I.limbRetry <= 0) {
      I.limbRetry = I.limbTries++ < 12 ? 0.5 : 0;
      if (!I.bone) I.bone = forearmBone(I.boneOf);
      if (I.bone && !I.limbReal) {
        // (rebuild while the forearm still has its length: undo this frame's fold first)
        I.bone.scale.setScalar(1);
        I.bone.updateWorldMatrix(true, true);
        const real = buildRealLimb(z, I.boneOf, I.limbAt, I.limbYaw);
        if (real) setLimb(z, real, true);
      }
    }
  }
  if (I.wrap) I.wrap.visible = !!I.bone;
  if (!I.bone) return;
  I.bone.scale.setScalar(0.0001);
  if (I.wrap) {
    I.bone.getWorldPosition(_e);
    const parent = I.bone.parent;
    if (parent) parent.getWorldPosition(_s);
    else _s.copy(_e).add(_y);
    _s.sub(_e).normalize();
    I.wrap.position.copy(_e).addScaledVector(_s, 0.02);
    I.wrap.quaternion.copy(_q.setFromUnitVectors(_y, _s));
  }
}
