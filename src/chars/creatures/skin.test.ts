/**
 * Generated-mesh skins: conversion into engine space, and the elite's retarget onto a meshy24 rig. Uses a
 * synthetic rig with the real file's joint positions and deliberately arbitrary bone rest rotations — the
 * retarget must not depend on the file's bone frames.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CharacterVisual } from '@/core/api';
import { asCreature, asElite, CREATURE_SOCKET_MAP } from '@/core/api/creatures';
import { createCreature, setCreatureSkinsEnabled } from './index';
import { disposeTemplates } from './core/rig';
import { convertSkin, registerCreatureSkin, SkinInstance, type SkinTemplate } from './core/skinlib';
import { finitePose, mesh, run, skinnedBounds, STEP } from './testkit';

/** elite.glb joint positions in the FILE's space (faces +Z, its left = +X) */
const JOINTS: [string, string | null, number, number, number][] = [
  ['Hips', null, 0.01, 2.16, -0.03], ['Spine02', 'Hips', 0.01, 2.39, -0.06], ['Spine01', 'Spine02', 0, 2.61, -0.09], ['Spine', 'Spine01', 0, 2.84, -0.12],
  ['neck', 'Spine', 0, 2.99, -0.14], ['Head', 'neck', -0.01, 3.13, -0.15], ['head_end', 'Head', 0.03, 3.42, -0.08], ['headfront', 'Head', -0.01, 3.13, 0.18],
  ['LeftShoulder', 'Spine', 0.11, 3.02, -0.14], ['LeftArm', 'LeftShoulder', 0.55, 3.02, -0.12], ['LeftForeArm', 'LeftArm', 0.78, 2.5, -0.12], ['LeftHand', 'LeftForeArm', 1.05, 1.98, 0.01],
  ['RightShoulder', 'Spine', -0.12, 3.0, -0.14], ['RightArm', 'RightShoulder', -0.57, 3.0, -0.11], ['RightForeArm', 'RightArm', -0.82, 2.49, -0.14], ['RightHand', 'RightForeArm', -1.07, 1.99, 0],
  ['LeftUpLeg', 'Hips', 0.28, 1.98, -0.03], ['LeftLeg', 'LeftUpLeg', 0.43, 1.25, 0.17], ['LeftFoot', 'LeftLeg', 0.5, 0.39, 0.09], ['LeftToeBase', 'LeftFoot', 0.56, 0.11, 0.3],
  ['RightUpLeg', 'Hips', -0.28, 1.98, -0.03], ['RightLeg', 'RightUpLeg', -0.43, 1.23, 0.17], ['RightFoot', 'RightLeg', -0.51, 0.39, 0.15], ['RightToeBase', 'RightFoot', -0.56, 0.1, 0.33],
];

/** a stand-in for the loaded file: one blob of triangles per joint, plus a sole and a crown so the height is 3.6 */
function syntheticScene(): THREE.Object3D {
  const scene = new THREE.Group();
  const bones: THREE.Bone[] = [];
  const world = new Map<string, THREE.Vector3>();
  const pos: number[] = [], si: number[] = [], sw: number[] = [];
  JOINTS.forEach(([name, parent, x, y, z], i) => {
    const b = new THREE.Bone();
    b.name = name;
    world.set(name, new THREE.Vector3(x, y, z));
    bones.push(b);
    const par = parent ? bones[JOINTS.findIndex((j) => j[0] === parent)]! : scene;
    par.add(b);
    // arbitrary rest rotation per bone, then place it at its joint in world space
    b.quaternion.setFromEuler(new THREE.Euler(i * 0.37, i * 0.91, i * 0.53));
    scene.updateMatrixWorld(true);
    b.position.copy(par.worldToLocal(new THREE.Vector3(x, y, z)));
    const top = name === 'head_end' ? 3.6 - y : 0.05, bottom = name.endsWith('ToeBase') ? y : 0.05;
    for (const [ax, ay, az] of [[0.05, -bottom, 0], [-0.05, -bottom, 0.02], [0, top, -0.05], [0.05, -bottom, 0], [0, top, -0.05], [0, 0, 0.06]]) {
      pos.push(x + ax!, y + ay!, z + az!);
      si.push(i, 0, 0, 0);
      sw.push(1, 0, 0, 0);
    }
  });
  scene.updateMatrixWorld(true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0.5), 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.computeVertexNormals();
  const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  scene.add(m);
  m.bind(new THREE.Skeleton(bones));
  return scene;
}

let tpl: SkinTemplate;
afterAll(() => { registerCreatureSkin('elite', null); disposeTemplates(); });

describe('skin conversion', () => {
  it('re-expresses the file in engine space: metres, feet on the floor, mirrored to face −Z, bind preserved', () => {
    const t = convertSkin('elite', syntheticScene(), 3.6);
    expect(t).not.toBeNull();
    tpl = t!;
    const p = tpl.geometry.getAttribute('position');
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(3.6, 5);
    const by = (n: string) => tpl.bones.find((b) => b.name === n)!;
    // the file's toes point +Z; ours must point −Z. Its exposed (file-left, +X) shoulder stays on +X = OUR right
    expect(by('LeftToeBase').pos.z).toBeLessThan(by('LeftFoot').pos.z);
    expect(by('LeftArm').pos.x).toBeGreaterThan(0.4);
    for (let i = 0; i < tpl.bones.length; i++) expect(tpl.bones[i]!.parent).toBeLessThan(i);
    // an instance at rest reproduces the converted geometry exactly, whatever the file's bone frames were
    const inst = new SkinInstance(tpl, new THREE.MeshBasicMaterial());
    inst.group.updateMatrixWorld(true);
    const v = new THREE.Vector3(), r = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 5) {
      r.fromBufferAttribute(p, i);
      v.copy(r);
      inst.mesh.applyBoneTransform(i, v);
      expect(v.distanceTo(r)).toBeLessThan(1e-4);
    }
    // winding was flipped with the mirror: face normals still point the way the stored normals do
    const idx = tpl.geometry.getIndex()!, n = tpl.geometry.getAttribute('normal');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    a.fromBufferAttribute(p, idx.getX(0)); b.fromBufferAttribute(p, idx.getX(1)); c.fromBufferAttribute(p, idx.getX(2));
    const face = b.sub(a).cross(c.sub(a)).normalize();
    expect(face.dot(new THREE.Vector3().fromBufferAttribute(n, idx.getX(0)))).toBeGreaterThan(0.5);
    inst.dispose();
    expect(convertSkin('none', new THREE.Group(), 3.6)).toBeNull();
  });
});

describe('elite wearing the generated mesh', () => {
  const footBone = (v: CharacterVisual, sign: number): THREE.Bone => {
    const feet = mesh(v).skeleton.bones.filter((b) => /Foot$/.test(b.name));
    v.root.updateMatrixWorld(true);
    return feet.sort((p, q) => (q.getWorldPosition(new THREE.Vector3()).x - p.getWorldPosition(new THREE.Vector3()).x) * sign)[0]!;
  };

  it('is opt-out, falls back to the procedural body, and keeps every documented socket', () => {
    setCreatureSkinsEnabled(false);
    registerCreatureSkin('elite', tpl);
    const plain = createCreature(null, 'elite');
    expect(asElite(plain)!.skinned).toBe(false);
    setCreatureSkinsEnabled(true);
    const v = createCreature(null, 'elite');
    expect(asElite(v)!.skinned).toBe(true);
    run(v, 0.5);
    expect(finitePose(v)).toBe(true);
    expect(mesh(v).name).toBe('skin:elite');
    for (const s of CREATURE_SOCKET_MAP.elite) expect(v.socket(s), s).not.toBe(v.root);
    const j = v.socket('joint').getWorldPosition(new THREE.Vector3());
    expect(j.x).toBeGreaterThan(0.4); // the creature's RIGHT shoulder on this body too
    expect(j.y).toBeGreaterThan(2.2);
    expect(v.socket('eye').getWorldPosition(new THREE.Vector3()).z).toBeLessThan(-0.2);
    plain.dispose();
    v.dispose();
    v.update(STEP);
  });

  it('a skin that arrives late is put on mid-life without disturbing the action in progress', () => {
    setCreatureSkinsEnabled(false);
    const v = createCreature(null, 'elite'); // born procedural: the file had not loaded yet
    setCreatureSkinsEnabled(true);
    const events: string[] = [];
    v.play('death', { onEvent: (e) => events.push(e) });
    run(v, 3.2); // part-way through its dissolve
    const joint = v.socket('joint');
    (v as unknown as { wear(t: SkinTemplate): void }).wear(tpl); // what the loader's promise does on arrival
    run(v, 0.1);
    expect(asElite(v)!.skinned).toBe(true);
    expect(v.socket('joint')).toBe(joint); // same socket object, now riding the new body
    const mat = mesh(v).material as THREE.Material;
    expect('CREATURE_DISSOLVE' in mat.defines!).toBe(true); // joined the dissolve already under way
    run(v, 2);
    expect(events).toEqual(expect.arrayContaining(['impact', 'end']));
    expect(finitePose(v)).toBe(true);
    v.dispose();
  });

  it('plants its feet where the animator plants them: no slide walking, no sinking, steps on a turn', () => {
    const v = createCreature(null, 'elite');
    const speed = 2.2;
    v.setLocomotion(speed, 0);
    const foot = footBone(v, 1), p = new THREE.Vector3(), start = new THREE.Vector3();
    let base = Infinity;
    run(v, 2, () => { v.root.position.z -= speed * STEP; v.root.updateMatrixWorld(true); base = Math.min(base, foot.getWorldPosition(p).y); });
    let planted = false, worst = 0;
    for (let i = 0; i < 240; i++) {
      v.root.position.z -= speed * STEP;
      v.update(STEP);
      v.root.updateMatrixWorld(true);
      foot.getWorldPosition(p);
      const down = p.y < base + 0.002;
      if (down && !planted) start.copy(p);
      if (down && planted) worst = Math.max(worst, Math.hypot(p.x - start.x, p.z - start.z));
      planted = down;
    }
    expect(worst).toBeLessThan(0.02);
    expect(skinnedBounds(v).min.y).toBeGreaterThan(-0.06);
    v.dispose();
  });

  it('a slam brings the short generated arms all the way to the floor by lowering the body', () => {
    const v = createCreature(null, 'elite');
    run(v, 0.4);
    const hips = mesh(v).skeleton.bones.find((b) => b.name === 'Hips')!;
    const hands = mesh(v).skeleton.bones.filter((b) => /Hand$/.test(b.name));
    v.root.updateMatrixWorld(true);
    const standing = hips.getWorldPosition(new THREE.Vector3()).y;
    v.play('groundSlam');
    run(v, 1.9);
    v.root.updateMatrixWorld(true);
    expect(hips.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(standing - 0.5);
    for (const h of hands) expect(h.getWorldPosition(new THREE.Vector3()).y, h.name).toBeLessThan(0.45);
    expect(finitePose(v)).toBe(true);
    v.dispose();
  });

  it('shares the state machine: dissolves on death (cut-out program only while dissolving), revives clean', () => {
    const v = createCreature(null, 'elite');
    const mat = mesh(v).material as THREE.Material;
    expect(mat.defines && 'CREATURE_SKIN' in mat.defines).toBe(true);
    run(v, 0.2);
    expect('CREATURE_DISSOLVE' in mat.defines!).toBe(false);
    v.play('death');
    run(v, 3.5);
    expect('CREATURE_DISSOLVE' in mat.defines!).toBe(true);
    run(v, 2);
    expect(mesh(v).castShadow).toBe(false);
    asCreature(v)!.revive();
    run(v, 0.2);
    expect('CREATURE_DISSOLVE' in mat.defines!).toBe(false);
    expect(mesh(v).castShadow).toBe(true);
    for (const act of ['sweep', 'roar', 'charge', 'pulse', 'fracture', 'stagger', 'spawn']) { v.play(act); run(v, 0.8); expect(finitePose(v), act).toBe(true); }
    v.dispose();
  });
});
