import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isHumanoidVisual, type HumanoidArchetype } from '@/core/api';
import { createCharacterFactory } from '@/chars';
import { createHumanoid } from '../humanoid';
import { ARCHETYPES } from '../humanoid/archetypes';
import type { HumanoidVisualImpl } from '../humanoid/visual';
import { eigenSym3, fitRestMatrix, quantile, resolveRoles, type HandInfo, type RigInfo } from './analyze';
import { bareHeadFor, GLB_ARCHETYPES, ITEM_SLOTS, modelsFor } from './config';
import type { ModelInstance, ModelLibrary, ModelTemplate } from './library';
import { alignFrames, Retargeter, solveJoint } from './retarget';
import { GlbHumanoidVisual } from './visual';

// ---- a synthetic "generated" humanoid: meshy24 names, A-pose, bones pointing along +Y, cm under a 0.01 armature ----
const JOINTS: Record<string, [string | null, number, number, number]> = {
  Hips: [null, 0, 1.0, 0],
  Spine02: ['Hips', 0, 1.12, 0], Spine01: ['Spine02', 0, 1.24, 0], Spine: ['Spine01', 0, 1.36, 0],
  neck: ['Spine', 0, 1.5, 0], Head: ['neck', 0, 1.58, 0], head_end: ['Head', 0, 1.8, 0],
  LeftShoulder: ['Spine', -0.05, 1.44, 0], LeftArm: ['LeftShoulder', -0.2, 1.44, 0], LeftForeArm: ['LeftArm', -0.4, 1.24, 0], LeftHand: ['LeftForeArm', -0.58, 1.06, 0],
  RightShoulder: ['Spine', 0.05, 1.44, 0], RightArm: ['RightShoulder', 0.2, 1.44, 0], RightForeArm: ['RightArm', 0.4, 1.24, 0], RightHand: ['RightForeArm', 0.58, 1.06, 0],
  LeftUpLeg: ['Hips', -0.11, 0.92, 0], LeftLeg: ['LeftUpLeg', -0.13, 0.5, 0], LeftFoot: ['LeftLeg', -0.15, 0.1, 0], LeftToeBase: ['LeftFoot', -0.18, 0.02, -0.14],
  RightUpLeg: ['Hips', 0.11, 0.92, 0], RightLeg: ['RightUpLeg', 0.13, 0.5, 0], RightFoot: ['RightLeg', 0.15, 0.1, 0], RightToeBase: ['RightFoot', 0.18, 0.02, -0.14],
};

function makeSkeleton(): { root: THREE.Group; bones: THREE.Bone[]; mesh: THREE.SkinnedMesh } {
  const root = new THREE.Group();
  const armature = new THREE.Group();
  armature.name = 'Armature';
  armature.scale.setScalar(0.01);
  root.add(armature);
  const bones: Record<string, THREE.Bone> = {};
  const world: Record<string, THREE.Matrix4> = {};
  const Y = new THREE.Vector3(0, 1, 0);
  for (const name of Object.keys(JOINTS)) {
    const [parent, x, y, z] = JOINTS[name];
    const child = Object.keys(JOINTS).find((k) => JOINTS[k][0] === name);
    const dir = child ? new THREE.Vector3(JOINTS[child][1] - x, JOINTS[child][2] - y, JOINTS[child][3] - z).normalize() : Y.clone();
    // every bone's own +Y runs along it, like a rigger's export — so rest rotations are far from identity
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    world[name] = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(0.01, 0.01, 0.01));
    const bone = new THREE.Bone();
    bone.name = name;
    const parentWorld = parent ? world[parent] : new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
    new THREE.Matrix4().copy(parentWorld).invert().multiply(world[name]).decompose(bone.position, bone.quaternion, bone.scale);
    (parent ? bones[parent] : armature).add(bone);
    bones[name] = bone;
  }
  root.updateMatrixWorld(true);
  const list = Object.values(bones);
  // a token skinned mesh: one triangle on the hips
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 100, 0, 10, 100, 0, 0, 110, 0], 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  armature.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list), mesh.matrixWorld);
  return { root, bones: list, mesh };
}

function hand(side: -1 | 1): HandInfo {
  const wrist = new THREE.Vector3(side * 0.58, 1.06, 0), f = new THREE.Vector3(side, -1, 0).normalize(), n = new THREE.Vector3(-side, -1, 0).normalize();
  return { ok: false, wrist, f, n, s: new THREE.Vector3().crossVectors(f, n), length: 0.18, grip: wrist.clone().addScaledVector(f, 0.085), fingers: null, curlAxis: new THREE.Vector3(1, 0, 0) };
}

function makeRigInfo(bones: THREE.Bone[]): RigInfo {
  const roles = resolveRoles(bones);
  if (!roles) throw new Error('synthetic rig did not resolve');
  return {
    names: roles.names, spine: roles.spine, hands: { L: hand(-1), R: hand(1) },
    metrics: { backDepth: 0.12, hipHalfWidth: 0.17, thighOuter: [0.09, 0.09], forearmRadius: [0.05, 0.05], shoulderHalfWidth: 0.26 },
    groundY: 0, height: 1.8, restMatrix: new THREE.Matrix4(), triangles: 1,
  };
}

const finite = (v: { x: number; y: number; z: number }): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

describe('analysis helpers', () => {
  it('eigenSym3 returns eigenpairs of a symmetric matrix', () => {
    const a = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
    const { values, vectors } = eigenSym3(a);
    for (let k = 0; k < 3; k++) {
      const v = [vectors[0][k], vectors[1][k], vectors[2][k]];
      for (let r = 0; r < 3; r++) expect(a[r][0] * v[0] + a[r][1] * v[1] + a[r][2] * v[2]).toBeCloseTo(values[k] * v[r], 8);
    }
    expect(values[0] + values[1] + values[2]).toBeCloseTo(9, 8);
  });

  it('quantile picks order statistics', () => {
    expect(quantile([5, 1, 3, 2, 4], 0)).toBe(1);
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([5, 1, 3, 2, 4], 1)).toBe(5);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('resolveRoles reads the meshy24 hierarchy and rejects a rig without a hand', () => {
    const { bones } = makeSkeleton();
    const roles = resolveRoles(bones);
    expect(roles?.spine).toEqual(['Spine02', 'Spine01', 'Spine']);
    expect(roles?.names.handL).toBe('LeftHand');
    expect(roles?.names.thighR).toBe('RightUpLeg');
    expect(resolveRoles(bones.filter((b) => b.name !== 'LeftHand'))).toBeNull();
  });

  it('fitRestMatrix recovers the affine map from raw vertices to rest positions', () => {
    const truth = new THREE.Matrix4().compose(new THREE.Vector3(0.1, 0.9, -0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)), new THREE.Vector3(0.9, 0.95, 0.9));
    const raw: number[] = [], pos: number[] = [];
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(Math.sin(i * 1.7), Math.cos(i * 0.9), Math.sin(i * 0.37 + 1));
      raw.push(v.x, v.y, v.z);
      v.applyMatrix4(truth);
      pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(raw, 3));
    const fit = fitRestMatrix({ geometry: g, matrixWorld: new THREE.Matrix4() } as unknown as THREE.SkinnedMesh, { count: 40, pos: new Float32Array(pos) });
    const p = new THREE.Vector3(0.3, -0.4, 0.7);
    expect(p.clone().applyMatrix4(fit).distanceTo(p.clone().applyMatrix4(truth))).toBeLessThan(1e-5);
  });
});

describe('retarget maths', () => {
  it('solveJoint keeps segment lengths, reaches the target and bends toward the hint', () => {
    const a = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3(0.1, 0.35, -0.2), hint = new THREE.Vector3(0, 0.6, -1);
    const mid = new THREE.Vector3(), end = new THREE.Vector3();
    solveJoint(a, t, 0.45, 0.42, hint, mid, end);
    expect(mid.distanceTo(a)).toBeCloseTo(0.45, 6);
    expect(end.distanceTo(mid)).toBeCloseTo(0.42, 6);
    expect(end.distanceTo(t)).toBeLessThan(1e-6);
    expect(mid.z).toBeLessThan(Math.min(a.z, t.z));
    // out of reach: the chain straightens toward the target instead of stretching
    solveJoint(a, new THREE.Vector3(0, -2, 0), 0.45, 0.42, hint, mid, end);
    expect(end.distanceTo(a)).toBeLessThanOrEqual(0.87);
    expect(end.distanceTo(a)).toBeGreaterThan(0.86);
    expect(finite(mid) && finite(end)).toBe(true);
    // degenerate inputs stay finite
    solveJoint(a, a, 0.45, 0.42, a, mid, end);
    expect(finite(mid) && finite(end)).toBe(true);
  });

  it('alignFrames maps one frame onto another', () => {
    const a1 = new THREE.Vector3(1, -1, 0).normalize(), a2 = new THREE.Vector3(1, 1, 0).normalize();
    const b1 = new THREE.Vector3(0, -1, 0), b2 = new THREE.Vector3(-1, 0, 0);
    const q = alignFrames(a1, a2, b1, b2, new THREE.Quaternion());
    expect(a1.clone().applyQuaternion(q).distanceTo(b1)).toBeLessThan(1e-6);
    expect(a2.clone().applyQuaternion(q).distanceTo(b2)).toBeLessThan(1e-6);
  });
});

describe('Retargeter on a synthetic skeleton', () => {
  function setup(archetype: HumanoidArchetype = 'tarrik') {
    const sk = makeSkeleton();
    const rig = makeRigInfo(sk.bones);
    const driver = createHumanoid(null, archetype, { driverOnly: true }) as HumanoidVisualImpl;
    const acc = driver.retargetAccess();
    const rt = new Retargeter(sk.root, rig, 1, acc.fig.spec);
    acc.model.scale.setScalar(rt.driverScale);
    const step = (seconds: number): void => {
      for (let k = 0, n = Math.round(seconds * 60); k < n; k++) driver.update(1 / 60);
      rt.pose(acc.solver.wp, acc.solver.wq, rt.driverScale);
      rt.apply();
      sk.root.updateMatrixWorld(true);
    };
    const bone = (name: string): THREE.Vector3 => (sk.root.getObjectByName(name) as THREE.Object3D).getWorldPosition(new THREE.Vector3());
    return { sk, rig, driver, acc, rt, step, bone };
  }

  it('scales the driver to the target leg length', () => {
    const { rt, acc } = setup();
    const I = acc.fig.spec.index, R = acc.fig.spec.rest;
    const len = (a: string, b: string): number => Math.hypot(R[I[a] * 3] - R[I[b] * 3], R[I[a] * 3 + 1] - R[I[b] * 3 + 1], R[I[a] * 3 + 2] - R[I[b] * 3 + 2]);
    const src = len('thighL', 'shinL') + len('shinL', 'footL');
    const tgt = Math.hypot(0.02, 0.42) + Math.hypot(0.02, 0.4);
    expect(rt.driverScale).toBeCloseTo(tgt / src, 4);
  });

  it('standing: arms hang like the driver, limbs keep their length, ankles sit on the driver ankles', () => {
    const { step, bone, acc, rt } = setup('tharne');
    step(0.5);
    const I = acc.fig.spec.index, wp = acc.solver.wp, wq = acc.solver.wq, s = rt.driverScale;
    for (const [side, S] of [['Left', 'L'], ['Right', 'R']] as const) {
      const tUp = bone(side + 'ForeArm').sub(bone(side + 'Arm')).normalize(), dUp = wp[I['fArm' + S]].clone().sub(wp[I['uArm' + S]]).normalize();
      const tLo = bone(side + 'Hand').sub(bone(side + 'ForeArm')).normalize(), dLo = wp[I['hand' + S]].clone().sub(wp[I['fArm' + S]]).normalize();
      expect(tUp.dot(dUp)).toBeGreaterThan(0.999);
      expect(tLo.dot(dLo)).toBeGreaterThan(0.999);
      expect(tUp.y).toBeLessThan(-0.8);                                   // no longer in the A-pose
      expect(bone(side + 'Leg').distanceTo(bone(side + 'UpLeg'))).toBeCloseTo(Math.hypot(0.02, 0.42), 4);
      expect(bone(side + 'Foot').distanceTo(bone(side + 'Leg'))).toBeCloseTo(Math.hypot(0.02, 0.4), 4);
      // ankle = the driver's, raised along the foot's up by the constant ankle-height difference
      const lift = 0.1 - acc.fig.spec.rest[I['foot' + S] * 3 + 1] * s;
      const want = wp[I['foot' + S]].clone().multiplyScalar(s).add(new THREE.Vector3(0, lift, 0).applyQuaternion(wq[I['foot' + S]]));
      expect(bone(side + 'Foot').distanceTo(want)).toBeLessThan(0.004);
    }
  });

  it('moving and acting: knees bend forward, nothing goes non-finite', () => {
    const { step, bone, driver, sk } = setup();
    driver.setLocomotion(5.2, 0);
    let bent = 0;
    for (let k = 0; k < 40; k++) {
      step(1 / 30);
      for (const side of ['Left', 'Right']) {
        const hip = bone(side + 'UpLeg'), knee = bone(side + 'Leg'), ankle = bone(side + 'Foot');
        const off = knee.clone().sub(hip.clone().add(ankle).multiplyScalar(0.5));
        if (off.length() > 0.04) { bent++; expect(off.z).toBeLessThan(0.01); }   // facing −Z: forward is −Z
      }
    }
    expect(bent).toBeGreaterThan(10);
    for (const a of ['attackHeavy', 'dodge', 'kneel', 'sit', 'death', 'no-such-action']) { driver.play(a); step(0.4); }
    sk.root.traverse((o) => {
      expect(Number.isFinite(o.quaternion.x + o.quaternion.y + o.quaternion.z + o.quaternion.w)).toBe(true);
      expect(finite(o.position)).toBe(true);
    });
  });

  it('pullHand puts the grip on a reachable point; sockets take the driver bone orientation at unit scale', () => {
    const { step, rt, acc, sk } = setup('tharne');
    const head = new THREE.Object3D();
    expect(rt.attachSocket('head', rt.restPos('head', new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0)), head)).toBe(true);
    step(0.3);
    const target = rt.pos('uArmL', new THREE.Vector3()).add(new THREE.Vector3(-0.1, -0.25, -0.25));
    rt.pullHand(0, target, 1);
    expect(rt.grip(0, new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-4);
    rt.apply();
    sk.root.updateMatrixWorld(true);
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    head.matrixWorld.decompose(p, q, sc);
    expect(q.angleTo(acc.solver.wq[acc.fig.spec.index.head])).toBeLessThan(1e-3);
    expect(sc.x).toBeCloseTo(1, 5);
    expect(rt.attachSocket('no-such-role', p, new THREE.Object3D())).toBe(false);
  });
});

describe('configuration and factory', () => {
  it('maps only known humanoid archetypes, with their props', () => {
    for (const a of Object.keys(GLB_ARCHETYPES)) expect(ARCHETYPES[a as HumanoidArchetype]).toBeDefined();
    expect(modelsFor('tarrik')).toEqual(['tarrik', 'velkorran', 'cinderline', 'sealed_case']);
    expect(modelsFor('selene')).toEqual(['selene', 'verity', 'axiom', 'sealed_case']);
    expect(modelsFor('elite')).toEqual([]);
  });

  it('integration: Varo, the officer, the King and Vesryn have their own hero bodies with real faces', () => {
    expect(modelsFor('malik')).toEqual(['varo', 'sealed_case']);
    expect(modelsFor('varo')).toEqual(['varo', 'rifle_dominion', 'sealed_case']);
    expect(modelsFor('officer')).toEqual(['officer']);
    expect(modelsFor('kingWitness')).toEqual(['king']);
    expect(modelsFor('vesryn')).toEqual(['vesryn']);
    // their own faces: asking for a bare head never grafts a civilian's on (or fetches the donor)
    for (const a of ['malik', 'varo', 'officer', 'kingWitness', 'vesryn'] as const) {
      expect(bareHeadFor(GLB_ARCHETYPES[a]!, true), a).toBeNull();
      expect(modelsFor(a, true)).not.toContain('survivor');
    }
    expect(bareHeadFor(GLB_ARCHETYPES.dominionSoldier!, true)).not.toBeNull();
    // only the King holds the halo; both Witness figures carry the Witness light, the King more
    expect(GLB_ARCHETYPES.kingWitness!.halo).toBe(true);
    expect(GLB_ARCHETYPES.vesryn!.halo).toBeFalsy();
    expect(GLB_ARCHETYPES.kingWitness!.witness!.edge).toBeGreaterThan(GLB_ARCHETYPES.vesryn!.witness!.edge);
    // every humanoid archetype in the contract has a generated body now
    for (const a of Object.keys(ARCHETYPES)) expect(GLB_ARCHETYPES[a as HumanoidArchetype], a).toBeDefined();
  });

  it('without a page to load into, the factory hands out procedural figures and preload still resolves', async () => {
    const chars = createCharacterFactory(null);
    await expect(chars.preload(['tarrik', 'selene', 'secDrone'])).resolves.toBeUndefined();
    const v = chars.create('tarrik');
    expect(isHumanoidVisual(v)).toBe(true);
    expect(v).not.toBeInstanceOf(GlbHumanoidVisual);
    expect(() => { v.update(1 / 60); v.dispose(); }).not.toThrow();
  });
});

describe('GlbHumanoidVisual on a stand-in library', () => {
  /** a library that "has" one synthetic body and no props */
  function fakeLibrary(ready: { value: boolean }): ModelLibrary {
    const sk = makeSkeleton();
    const tpl: ModelTemplate = {
      name: 'fake', entry: { file: 'fake.glb', kind: 'humanoid', height: 1.8 }, root: sk.root, mesh: sk.mesh, rig: makeRigInfo(sk.bones),
      box: new THREE.Box3(), materials: [sk.mesh.material as THREE.MeshStandardMaterial], triangles: 1, lods: [], lodMesh: 0,
    };
    const lib = {
      version: 0, enabled: true,
      has: (n: string) => ready.value && n === 'fake',
      unavailable: (n: string) => n !== 'fake',
      instantiate: (n: string): ModelInstance | null => {
        if (n !== 'fake' || !ready.value) return null;
        const fresh = makeSkeleton();
        return { template: tpl, root: fresh.root, mesh: fresh.mesh, meshes: [fresh.mesh] };
      },
    };
    return lib as unknown as ModelLibrary;
  }
  const cfg = (a: HumanoidArchetype) => ({ ...GLB_ARCHETYPES[a]!, model: 'fake' });

  it('drives the generated body: sockets on it, every item slot answered, same action timings as the driver', () => {
    for (const a of ['tarrik', 'selene', 'enforcer', 'lyessa', 'survivor'] as const) {
      const v = new GlbHumanoidVisual(null, a, cfg(a), fakeLibrary({ value: true }));
      const ref = createHumanoid(null, a);
      expect(v.generated).toBe(true);
      // heroes are exactly the manifest height; rank-and-file vary by a few percent with the seed
      expect(Math.abs(v.height / 1.8 - 1)).toBeLessThan(GLB_ARCHETYPES[a]?.vary ? 0.031 : 1e-6);
      expect(isHumanoidVisual(v)).toBe(true);
      for (const action of ['attackHeavy', 'attackLight1', 'dodge', 'shoot', 'death']) expect(v.info(action)).toEqual(ref.info(action));
      const scene = new THREE.Scene();
      scene.add(v.root);
      v.root.position.set(3, 0, -2);
      v.setLocomotion(2.2, 0);
      for (let k = 0; k < 30; k++) { v.root.position.z -= 2.2 / 60; v.update(1 / 60); }
      for (const n of ['root', 'hips', 'chest', 'core', 'head', 'eye', 'back', 'handR', 'handL', 'weaponBase', 'weaponMid', 'weaponTip', 'muzzle', 'shield', 'nonsense']) {
        const p = v.socket(n).getWorldPosition(new THREE.Vector3());
        expect(finite(p)).toBe(true);
        expect(p.distanceTo(v.root.position)).toBeLessThan(3);
      }
      // the eye socket's −Z looks where the figure faces (world −Z), i.e. its own Z axis points to world +Z
      expect(v.socket('eye').matrixWorld.elements[10]).toBeGreaterThan(0.7);
      expect(v.socket('head').getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(1.4);
      ref.dispose();
      v.dispose();
      v.dispose();
    }
  });

  it('survives the whole CharacterVisual surface with odd input, before and after the body arrives', () => {
    const ready = { value: false };
    const lib = fakeLibrary(ready);
    const v = new GlbHumanoidVisual(null, 'tarrik', cfg('tarrik'), lib, { seed: 3, corruption: 0.2 });
    const exercise = (): void => {
      v.play('attackHeavy', { onEvent: () => undefined });
      v.setLoadout({ ranged: true });
      v.setLoadout({ melee: true, ranged: false, prop: 'case' });
      v.setHandTarget('L', { x: 0.2, y: 1.1, z: -0.4 });
      v.setHandTarget('R', null);
      v.lookAt({ x: 0, y: 1.6, z: -5 }); v.setAimPitch(0.3); v.setSpeaking(0.7);
      v.flash(0xffffff, 0.1); v.setFrozen(0.5); v.setCorruption(NaN); v.setDissolve(0.4, 0x7a3cff); v.setGlow(-1);
      v.setTelegraph(2); v.setExposed('nope', 1); v.setExposed('chest', 0.5); v.setRim(0.5, 0x88aaff);
      v.teleported();
      for (const dt of [1 / 60, 0, NaN, 5, -1]) v.update(dt);
      v.setVisible(false); v.update(1 / 60); v.setVisible(true);
      v.play('death'); for (let k = 0; k < 40; k++) v.update(1 / 30);
      v.stop();
    };
    expect(v.generated).toBe(false);
    expect(exercise).not.toThrow();
    ready.value = true;
    (lib as unknown as { version: number }).version++;
    v.update(1 / 60);
    expect(v.generated).toBe(true);
    expect(exercise).not.toThrow();
    expect(v.isPlaying('death')).toBe(false);
    for (const slot of ITEM_SLOTS) expect(typeof slot).toBe('string');
    expect(() => v.dispose()).not.toThrow();
  });

  it('integration: the King holds his halo on the visible head, carries the Witness light, and can be wounded', () => {
    const own = (v: GlbHumanoidVisual) => (v as unknown as { body: { materials: Array<{ own: Record<string, { value: THREE.Vector4 }> }> } }).body.materials[0].own;
    const king = new GlbHumanoidVisual(null, 'kingWitness', cfg('kingWitness'), fakeLibrary({ value: true }), { wounded: true });
    king.update(1 / 60);
    const halo = king.root.getObjectByName('witnessHalo') as THREE.Mesh;
    expect(halo).toBeDefined();
    expect(halo.parent).toBe(king.socket('head'));
    // the halo follows setGlow (and goes dark at 0), and dissolves with the figure
    const c0 = (halo.material as THREE.MeshBasicMaterial).color.r;
    king.setGlow(2);
    expect((halo.material as THREE.MeshBasicMaterial).color.r).toBeCloseTo(c0 * 2, 5);
    king.setGlow(0);
    expect(halo.visible).toBe(false);
    king.setGlow(1);
    king.setDissolve(1);
    expect(halo.visible).toBe(false);
    king.setDissolve(0);
    expect(halo.visible).toBe(true);
    const u = own(king);
    expect(u.uWitness.value.x).toBeGreaterThan(0);
    expect(u.uWitness.value.z).toBeCloseTo(king.height, 5);
    // wounded: the LEFT shoulder (−X, at shoulder height)
    expect(u.uWound.value.x).toBe(1);
    expect(u.uShoulder.value.x).toBeLessThan(0);
    expect(u.uShoulder.value.y).toBeGreaterThan(1.2);
    expect(u.uShoulder.value.y).toBeLessThan(1.7);
    king.dispose();
    expect(halo.parent).toBeNull();

    // no halo when asked, none on Vesryn, no wound unless asked
    const bare = new GlbHumanoidVisual(null, 'kingWitness', cfg('kingWitness'), fakeLibrary({ value: true }), { halo: false });
    expect(bare.root.getObjectByName('witnessHalo')).toBeUndefined();
    expect(own(bare).uWound.value.x).toBe(0);
    bare.dispose();
    const ves = new GlbHumanoidVisual(null, 'vesryn', cfg('vesryn'), fakeLibrary({ value: true }), { halo: true });
    expect(ves.root.getObjectByName('witnessHalo')).toBeUndefined();
    expect(own(ves).uWitness.value.y).toBeGreaterThan(0);
    for (const action of ['idle', 'talk', 'breath', 'walkAway']) expect(ves.info(action)).toEqual(createHumanoid(null, 'vesryn').info(action));
    ves.dispose();
    // soldiers carry no Witness light
    const varo = new GlbHumanoidVisual(null, 'varo', cfg('varo'), fakeLibrary({ value: true }));
    expect(own(varo).uWitness.value.x + own(varo).uWitness.value.y).toBe(0);
    varo.dispose();
  });
});

describe('bare head graft', () => {
  /** a template whose body is a stack of rings up the centre line: below `headFrom` on the spine, above on the head */
  function columnTemplate(name: string, radius: number, headFrom: number, lods = false): ModelTemplate {
    const sk = makeSkeleton();
    const head = sk.bones.findIndex((b) => b.name === 'Head'), spine = sk.bones.findIndex((b) => b.name === 'Spine');
    const pos: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
    const rings = 14, seg = 8;
    for (let r = 0; r < rings; r++) {
      const y = 1.3 + r * 0.05;
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * radius * 100, y * 100, Math.sin(a) * radius * 100); // cm, under the 0.01 armature
        si.push(y >= headFrom ? head : spine, 0, 0, 0);
        sw.push(1, 0, 0, 0);
      }
    }
    for (let r = 0; r + 1 < rings; r++) for (let s = 0; s < seg; s++) {
      const a = r * seg + s, b = r * seg + ((s + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map(() => 0), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0.5), 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    sk.mesh.geometry = g;
    sk.root.updateMatrixWorld(true);
    const rig = { ...makeRigInfo(sk.bones), restMatrix: sk.mesh.matrixWorld.clone() };
    const coarse = new THREE.BufferGeometry();
    coarse.setIndex(idx.filter((_, i) => Math.floor(i / 3) % 2 === 0));
    return {
      name, entry: { file: name + '.glb', kind: 'humanoid', height: 1.8 }, root: sk.root, mesh: sk.mesh, rig, box: new THREE.Box3(),
      materials: [sk.mesh.material as THREE.MeshStandardMaterial], triangles: idx.length / 3, lods: lods ? [coarse] : [], lodMesh: 0,
    };
  }

  it('cuts the head-weighted top of the body and grafts the donor head onto the body skeleton', async () => {
    const { bareHeadParts } = await import('./head');
    const body = columnTemplate('helmeted', 0.15, 1.55, true), donor = columnTemplate('civilian', 0.08, 1.5, true);
    const parts = bareHeadParts(body, donor, { donor: 'civilian', skin: [1, 1, 1], hair: [0, 0, 0, 0], shape: [1, 1, 1] });
    expect(parts).not.toBeNull();
    const p = parts!;
    expect(p.stats.helmetVerts).toBeGreaterThanOrEqual(50);
    // every kept body triangle avoids the helmet; the coarse level is cut the same way
    expect(p.body.index!.count).toBeLessThan(body.mesh!.geometry.index!.count);
    expect(p.bodyLods.length).toBe(1);
    // the graft is skinned to the body's head and sits round the body's head joint, in the body's raw space
    const headIdx = body.mesh!.skeleton.bones.findIndex((b) => b.name === 'Head');
    const hp = p.head.getAttribute('position'), hs = p.head.getAttribute('skinIndex');
    const v = new THREE.Vector3();
    for (let i = 0; i < hp.count; i++) {
      v.fromBufferAttribute(hp, i).applyMatrix4(body.rig!.restMatrix);
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
      expect(Math.hypot(v.x, v.z)).toBeLessThan(0.1);
      if (v.y > 1.6) expect(hs.getX(i)).toBe(headIdx);
    }
    // the graft's coarse level only indexes kept vertices
    for (const g of p.headLods) for (let i = 0; i < g.index!.count; i++) expect(g.index!.getX(i)).toBeLessThan(hp.count);
    // cached per body / donor / proportions
    expect(bareHeadParts(body, donor, { donor: 'civilian', skin: [0.5, 0.5, 0.5], hair: [1, 1, 1, 1], shape: [1, 1, 1] })).toBe(p);
  });
});
