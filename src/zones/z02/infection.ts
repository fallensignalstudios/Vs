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
 */
import * as THREE from 'three';
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
  mass: THREE.Object3D[];
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
    hand: null, veins: [], veinCount: [], tissue: [], grow: 0, growTarget: 0, limb: null, mass: [], consume: 0,
    consumeTarget: 0, wrap: null, amputated: false, bone: null, boneOf: null,
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
  // the limb: forearm and cracked gauntlet, lying on its side
  const limb = new THREE.Group();
  limb.name = 'z02-limb';
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, 10), mats.get('domBlack'));
  fore.rotation.z = Math.PI / 2;
  fore.position.set(0, 0.055, 0);
  limb.add(fore);
  const gauntlet = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.1), mats.get('domBronze'));
  gauntlet.position.set(0.19, 0.05, 0);
  limb.add(gauntlet);
  const crack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.006), mats.emissive(VIOLET, 3));
  crack.position.set(0.19, 0.095, 0.01);
  crack.rotation.y = 0.5;
  limb.add(crack);
  // the mass that takes it: black nodules swelling over it from the crack end
  const tissue = mats.get('eclipseTissue');
  const blobs: Array<[number, number, number, number]> = [
    [0.19, 0.06, 0.0, 0.07], [0.13, 0.07, 0.03, 0.06], [0.06, 0.065, -0.02, 0.065], [-0.02, 0.06, 0.02, 0.06],
    [-0.09, 0.055, -0.01, 0.055], [0.1, 0.04, -0.05, 0.045], [0.02, 0.035, 0.06, 0.04], [0.24, 0.03, 0.04, 0.035],
  ];
  for (const [x, y, zz, r] of blobs) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), tissue);
    m.position.set(x, y, zz);
    m.scale.setScalar(0.001);
    m.userData.r = 1;
    limb.add(m);
    I.mass.push(m);
  }
  limb.position.copy(limbAt);
  limb.rotation.y = limbYaw;
  z.builder.add(limb);
  I.limb = limb;
  z.onDispose(() => {
    for (const o of [wrap, limb]) {
      o.removeFromParent();
      o.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
    }
  });
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
  for (let i = 0; i < I.mass.length; i++) {
    // the nodules swell one after another from the gauntlet end
    const s = Math.max(0.001, Math.min(1, I.consume * 1.6 - i * 0.08));
    I.mass[i].scale.set(s * 1.3, s * 0.75, s * 1.15);
  }
  if (!I.amputated) return;
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
