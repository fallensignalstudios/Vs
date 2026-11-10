import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gaitFoot, gaitRate, impact, keys, Limb2, snap, solveTwoBone, whip, win, type GaitOut } from './anim';

describe('animation curves', () => {
  it('keys interpolates, clamps and hits its key values', () => {
    const k = [0, 0, 1, 2, 3, -1];
    expect(keys(-5, k)).toBe(0);
    expect(keys(0, k)).toBe(0);
    expect(keys(1, k)).toBeCloseTo(2, 6);
    expect(keys(3, k)).toBeCloseTo(-1, 6);
    expect(keys(99, k)).toBe(-1);
    expect(keys(0.5, k)).toBeCloseTo(1, 6); // smoothstep midpoint
    expect(keys(0.25, k)).toBeLessThan(0.5); // eased in
    expect(keys(1, [])).toBe(0);
  });

  it('window / whip / snap / impact envelopes', () => {
    expect(win(0, 1, 2, 3, 4)).toBe(0);
    expect(win(2.5, 1, 2, 3, 4)).toBe(1);
    expect(win(5, 1, 2, 3, 4)).toBe(0);
    expect(whip(0.5, 0, 1)).toBeLessThan(0.2);
    expect(snap(0.5, 0, 1)).toBeGreaterThan(0.8);
    expect(whip(2, 0, 1)).toBe(1);
    expect(impact(0.9, 1, 0.1)).toBe(0);
    expect(impact(1, 1, 0.1)).toBe(1);
    expect(impact(1.3, 1, 0.1)).toBeLessThan(0.1);
  });
});

describe('gait', () => {
  it('a planted foot travels exactly as far as the body does (no slide)', () => {
    const out: GaitOut = { along: 0, lift: 0, planted: 1 };
    const stride = 1.2, duty = 0.6, speed = 3;
    const rate = gaitRate(speed, stride, duty);
    const dt = 0.01;
    const a0 = gaitFoot(0.1, stride, 0.2, duty, out).along;
    const a1 = gaitFoot(0.1 + rate * dt, stride, 0.2, duty, out).along;
    expect(out.planted).toBe(1);
    expect(a0 - a1).toBeCloseTo(speed * dt, 6);
    expect(out.lift).toBe(0);
  });

  it('the swing phase lifts the foot and returns it to the front of the stride', () => {
    const out: GaitOut = { along: 0, lift: 0, planted: 1 };
    gaitFoot(0.8, 1, 0.2, 0.6, out);
    expect(out.planted).toBe(0);
    expect(out.lift).toBeGreaterThan(0.1);
    expect(gaitFoot(0.999, 1, 0.2, 0.6, out).along).toBeCloseTo(0.5, 2);
    expect(gaitFoot(1.0, 1, 0.2, 0.6, out).along).toBeCloseTo(0.5, 6); // wraps
    expect(gaitRate(1, 0, 0.5)).toBe(0);
  });
});

describe('two-bone IK', () => {
  it('solveTwoBone keeps both segment lengths and bends toward the pole', () => {
    const root = new THREE.Vector3(0, 1, 0), target = new THREE.Vector3(0.3, 0.1, 0.2), pole = new THREE.Vector3(0, 0, -1), out = new THREE.Vector3();
    solveTwoBone(root, target, 0.6, 0.5, pole, out);
    expect(out.distanceTo(root)).toBeCloseTo(0.6, 5);
    expect(out.distanceTo(target)).toBeCloseTo(0.5, 5);
    const mid = root.clone().lerp(target, 0.5);
    expect(out.z).toBeLessThan(mid.z); // knee pushed toward −Z
  });

  it('clamps unreachable targets instead of producing NaN', () => {
    const out = new THREE.Vector3();
    solveTwoBone(new THREE.Vector3(), new THREE.Vector3(0, -10, 0), 0.6, 0.5, new THREE.Vector3(0, 0, -1), out);
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
    expect(out.length()).toBeCloseTo(0.6, 4);
    solveTwoBone(new THREE.Vector3(), new THREE.Vector3(), 0.6, 0.5, new THREE.Vector3(0, 0, -1), out);
    expect(Number.isFinite(out.x + out.y + out.z)).toBe(true);
  });

  it('Limb2 poses real bones so the chain end lands on the target, under a rotated parent', () => {
    const space = new THREE.Group();
    space.position.set(3, 0, -2);
    space.rotation.y = 0.7;
    const hips = new THREE.Bone(), upper = new THREE.Bone(), lower = new THREE.Bone(), end = new THREE.Bone();
    const hipAt = new THREE.Vector3(0.3, 1.2, 0), kneeAt = new THREE.Vector3(0.35, 0.7, -0.2), footAt = new THREE.Vector3(0.3, 0.1, 0.1);
    hips.position.set(0, 1.2, 0);
    upper.position.copy(hipAt).sub(hips.position);
    lower.position.copy(kneeAt).sub(hipAt);
    end.position.copy(footAt).sub(kneeAt);
    space.add(hips); hips.add(upper); upper.add(lower); lower.add(end);
    const limb = new Limb2(space, upper, lower, hipAt, kneeAt, footAt, new THREE.Vector3(0, 0, -1));
    hips.rotation.set(0.2, 0.4, -0.1); // the body is mid-pose
    hips.position.y = 1.05;
    const target = new THREE.Vector3(0.5, 0.15, -0.35);
    limb.solve(target, new THREE.Vector3(0.2, 0, -1));
    space.updateMatrixWorld(true);
    const got = space.worldToLocal(end.getWorldPosition(new THREE.Vector3()));
    expect(got.distanceTo(target)).toBeLessThan(1e-3);
    expect(limb.end.distanceTo(target)).toBeLessThan(1e-3);
    // weight 0 leaves the FK pose untouched
    const before = upper.quaternion.clone();
    limb.solve(new THREE.Vector3(0, 0.1, 0.4), new THREE.Vector3(0, 0, -1), 0);
    expect(upper.quaternion.angleTo(before)).toBeLessThan(1e-6);
  });
});
