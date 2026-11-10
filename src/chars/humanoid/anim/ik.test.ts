import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { alignPair, makeTwoBoneRest, solveTwoBone } from './ik';

const rest = makeTwoBoneRest(new THREE.Vector3(0.02, -0.3, 0.01), new THREE.Vector3(0.015, -0.27, -0.02), new THREE.Vector3(0, 0, 1));
const root = new THREE.Vector3(0.2, 1.45, 0);

function endOf(qa: THREE.Quaternion, qb: THREE.Quaternion): { mid: THREE.Vector3; end: THREE.Vector3 } {
  const mid = rest.a.clone().applyQuaternion(qa).add(root);
  const end = rest.b.clone().applyQuaternion(qb).add(mid);
  return { mid, end };
}

describe('two-bone IK', () => {
  it('reaches reachable targets exactly', () => {
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    const targets = [[0.3, 1.2, -0.3], [0.1, 1.5, -0.4], [0.5, 1.3, 0.1], [0.2, 1.0, -0.1], [-0.1, 1.4, -0.35]];
    for (const t of targets) {
      const target = new THREE.Vector3(t[0], t[1], t[2]);
      solveTwoBone(rest, root, target, new THREE.Vector3(0.5, -0.7, 0.4), qa, qb);
      const { end } = endOf(qa, qb);
      expect(end.distanceTo(target)).toBeLessThan(1e-4);
    }
  });

  it('clamps unreachable targets to full extension along the target direction', () => {
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    const target = new THREE.Vector3(0.2, 1.45, -3);
    const reach = solveTwoBone(rest, root, target, new THREE.Vector3(0, -1, 0), qa, qb);
    expect(reach).toBeGreaterThan(1);
    const { end } = endOf(qa, qb);
    const len = end.distanceTo(root);
    expect(len).toBeLessThanOrEqual(rest.la + rest.lb + 1e-6);
    expect(len).toBeGreaterThan((rest.la + rest.lb) * 0.99);
    expect(end.clone().sub(root).normalize().dot(target.clone().sub(root).normalize())).toBeGreaterThan(0.9999);
  });

  it('bends the middle joint toward the pole', () => {
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    const target = new THREE.Vector3(0.2, 1.1, -0.2);
    for (const pole of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 1)]) {
      solveTwoBone(rest, root, target, pole, qa, qb);
      const { mid } = endOf(qa, qb);
      const line = target.clone().sub(root).normalize();
      const off = mid.clone().sub(root);
      off.addScaledVector(line, -off.dot(line));
      const poleP = pole.clone().addScaledVector(line, -pole.dot(line)).normalize();
      expect(off.normalize().dot(poleP)).toBeGreaterThan(0.999);
    }
  });

  it('never produces NaN for degenerate input', () => {
    const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
    solveTwoBone(rest, root, root.clone(), new THREE.Vector3(0, 0, 0), qa, qb);
    solveTwoBone(rest, root, new THREE.Vector3(0.2, 0.5, 0), new THREE.Vector3(0, -1, 0), qa, qb);
    for (const q of [qa, qb]) expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
  });

  it('alignPair maps the primary axis exactly and the secondary as close as possible', () => {
    const q = alignPair(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Quaternion());
    const a = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const b = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    expect(a.dot(new THREE.Vector3(1, 1, 0).normalize())).toBeGreaterThan(0.9999);
    expect(b.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0.9999);
  });
});
