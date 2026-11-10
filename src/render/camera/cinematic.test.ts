import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEG } from '@/core/mathx';
import { CameraFeel } from './feel';
import { Damped, noise1 } from './pose';
import { DT, camDir, setup } from './testkit';

describe('cinematic', () => {
  const A = { pos: { x: 10, y: 3, z: 10 }, look: { x: 0, y: 1, z: 0 }, fov: 35 };
  const B = { pos: { x: -4, y: 6, z: 2 }, look: { x: 2, y: 0, z: -8 }, fov: 50, roll: 10 };

  it('cuts, ignores look input, and moves with eased interpolation to an exact end state', () => {
    const { rig, target, input, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(5);
    rig.cine.cut(A);
    expect(rig.mode).toBe('cinematic');
    tick();
    expect(rig.camera.position.x).toBeCloseTo(10, 6);
    expect(rig.camera.fov).toBeCloseTo(35, 6);
    const want = new THREE.Vector3(-10, -2, -10).normalize();
    expect(camDir(rig).distanceTo(want)).toBeLessThan(1e-5);

    const yaw = rig.yaw;
    input.virtual.addLook(0.4, 0.1);
    tick();
    expect(rig.yaw).toBe(yaw);

    rig.cine.move(B, 2, 'inOutCubic');
    expect(rig.cine.moving).toBe(true);
    tick(60); // halfway: inOutCubic(0.5) = 0.5
    expect(rig.camera.position.x).toBeCloseTo(3, 3);
    expect(rig.camera.position.y).toBeCloseTo(4.5, 3);
    expect(rig.camera.fov).toBeCloseTo(42.5, 3);
    tick(15); // 62.5 %: eased ahead of linear
    expect(rig.camera.position.x).toBeLessThan(10 + (-14) * 0.625);
    tick(60);
    expect(rig.cine.moving).toBe(false);
    expect(rig.camera.position.x).toBeCloseTo(-4, 6);
    expect(rig.camera.position.y).toBeCloseTo(6, 6);
    expect(rig.camera.position.z).toBeCloseTo(2, 6);
    expect(rig.camera.fov).toBeCloseTo(50, 6);
    const end = new THREE.Vector3(6, -6, -10).normalize();
    expect(camDir(rig).distanceTo(end)).toBeLessThan(1e-5);
    // roll 10°: camera up is tilted 10° away from the unrolled up, about the view axis
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.camera.quaternion);
    const level = new THREE.Vector3(0, 1, 0).addScaledVector(end, -end.y).normalize();
    expect(up.angleTo(level)).toBeCloseTo(10 * DEG, 4);
  });

  it('finish() completes a move instantly; a zero-second move is a jump', () => {
    const { rig, tick } = setup();
    rig.cine.cut(A);
    rig.cine.move(B, 5);
    tick(10);
    rig.cine.finish();
    expect(rig.cine.moving).toBe(false);
    tick();
    expect(rig.camera.position.x).toBeCloseTo(-4, 6);
    expect(rig.camera.fov).toBeCloseTo(50, 6);
    rig.cine.move(A, 0);
    expect(rig.cine.moving).toBe(false);
    tick();
    expect(rig.camera.position.x).toBeCloseTo(10, 6);
  });

  it('move() from gameplay starts at the current follow pose (no pop)', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(10);
    const before = rig.camera.position.clone();
    const dirBefore = camDir(rig);
    rig.cine.move(A, 2);
    tick();
    expect(rig.mode).toBe('cinematic');
    expect(rig.camera.position.distanceTo(before)).toBeLessThan(0.02);
    expect(camDir(rig).angleTo(dirBefore)).toBeLessThan(0.01);
  });

  it('drift orbits a point, track keeps the look-at on a moving target', () => {
    const { rig, tick } = setup();
    rig.cine.cut({ pos: { x: 0, y: 2, z: 5 }, look: { x: 0, y: 1, z: 0 } });
    rig.cine.drift({ around: { x: 0, y: 0, z: 0 }, yawRate: 0.5 });
    tick();
    expect(rig.camera.position.z).toBeCloseTo(5, 1); // continues from the cut, no jump
    tick(120);
    const p = rig.camera.position;
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(5, 4);
    expect(p.y).toBeCloseTo(2, 4);
    expect(Math.atan2(p.x, p.z)).toBeCloseTo(0.5 * 121 * DT, 3);

    const mover = new THREE.Vector3(3, 1, -4);
    rig.cine.cut({ pos: { x: 0, y: 2, z: 5 }, look: { x: 0, y: 1, z: 0 } });
    rig.cine.track(() => mover);
    tick();
    expect(camDir(rig).distanceTo(mover.clone().sub(rig.camera.position).normalize())).toBeLessThan(1e-5);
    mover.set(-6, 3, 0);
    tick();
    expect(camDir(rig).distanceTo(mover.clone().sub(rig.camera.position).normalize())).toBeLessThan(1e-5);
    rig.cine.track(null);
    tick();
    expect(camDir(rig).distanceTo(new THREE.Vector3(0, -1, -5).normalize())).toBeLessThan(1e-5);
  });

  it('release blends back to the live follow pose without popping; release(0) cuts', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    const follow = rig.camera.position.clone();
    rig.cine.cut(A);
    tick(5);
    rig.release(1);
    expect(rig.mode).toBe('follow');
    tick();
    expect(rig.camera.position.distanceTo(new THREE.Vector3(10, 3, 10))).toBeLessThan(0.01);
    let prev = rig.camera.position.clone();
    let maxStep = 0;
    for (let i = 0; i < 70; i++) {
      tick();
      const step = rig.camera.position.distanceTo(prev);
      if (i === 0) expect(step).toBeLessThan(0.01); // eases in
      maxStep = Math.max(maxStep, step);
      prev = rig.camera.position.clone();
    }
    expect(maxStep).toBeLessThan(0.7); // continuous: ~12.6 m over 1 s, cubic ease peaks at 3× the mean
    expect(rig.camera.position.distanceTo(follow)).toBeLessThan(1e-4);
    expect(rig.camera.fov).toBeCloseTo(62, 4);

    rig.cine.cut(A);
    tick();
    rig.release(0);
    tick();
    expect(rig.camera.position.distanceTo(follow)).toBeLessThan(1e-4);

    // cut and release within the same tick still blends from the cut pose, not from a stale one
    rig.cine.cut(B);
    rig.release(1);
    tick();
    expect(rig.camera.position.distanceTo(new THREE.Vector3(-4, 6, 2))).toBeLessThan(0.01);
  });
});

describe('feel', () => {
  it('shake decays to exactly zero and leaves the pose untouched', () => {
    const { rig, target, settings, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    const restPos = rig.camera.position.clone();
    const restQuat = rig.camera.quaternion.clone();
    settings.set('reduceShake', false);

    const feel = new CameraFeel();
    feel.shake(0.8, 0.5);
    feel.update(DT, false, 0);
    expect(feel.trauma).toBeGreaterThan(0.7);
    expect(Math.abs(feel.pitch) + Math.abs(feel.yaw) + Math.abs(feel.roll)).toBeGreaterThan(0);
    let last = feel.trauma;
    for (let i = 0; i < 29; i++) {
      feel.update(DT, false, 0);
      expect(feel.trauma).toBeLessThanOrEqual(last);
      last = feel.trauma;
    }
    feel.update(DT, false, 0);
    expect(feel.trauma).toBe(0);
    expect([feel.pitch, feel.yaw, feel.roll, feel.x, feel.y, feel.fov]).toEqual([0, 0, 0, 0, 0, 0]);

    rig.shake(1, 0.3);
    tick(2);
    expect(rig.trauma).toBeGreaterThan(0);
    expect(rig.camera.quaternion.angleTo(restQuat)).toBeGreaterThan(1e-4);
    tick(20);
    expect(rig.trauma).toBe(0);
    settings.set('reduceShake', true); // remove breathing to compare exactly
    tick();
    expect(rig.camera.position.distanceTo(restPos)).toBe(0);
    expect(rig.camera.quaternion.angleTo(restQuat)).toBe(0);
  });

  it('re-issuing the same shake every frame does not stack; reduceShake scales it down', () => {
    const a = new CameraFeel();
    for (let i = 0; i < 120; i++) {
      a.shake(0.3, 0.2);
      a.update(DT, false, 0);
    }
    expect(a.trauma).toBeLessThanOrEqual(0.3);

    const full = new CameraFeel();
    const reduced = new CameraFeel();
    let sumFull = 0;
    let sumReduced = 0;
    full.shake(1, 1);
    reduced.shake(1, 1);
    for (let i = 0; i < 30; i++) {
      full.update(DT, false, 0);
      reduced.update(DT, true, 0);
      sumFull += Math.abs(full.pitch) + Math.abs(full.yaw);
      sumReduced += Math.abs(reduced.pitch) + Math.abs(reduced.yaw);
      expect(reduced.roll).toBe(0);
    }
    expect(sumReduced).toBeLessThan(sumFull * 0.25);
    expect(sumReduced).toBeGreaterThan(0); // timing is retained
  });

  it('kick peaks near the requested angle and settles to exactly zero; FOV punch eases back', () => {
    const feel = new CameraFeel();
    feel.kick(2, -1);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      feel.update(DT, false, 0);
      peak = Math.max(peak, feel.kickPitch);
    }
    expect(peak / DEG).toBeGreaterThan(1.7);
    expect(peak / DEG).toBeLessThan(2.05);
    expect(feel.kickPitch).toBe(0);
    expect(feel.kickYaw).toBe(0);

    feel.fovPunch(6, 0.4);
    let top = 0;
    for (let i = 0; i < 23; i++) {
      feel.update(DT, false, 0);
      top = Math.max(top, feel.fov);
    }
    expect(top).toBeGreaterThan(5);
    expect(top).toBeLessThanOrEqual(6);
    feel.update(DT, false, 0);
    feel.update(DT, false, 0);
    expect(feel.fov).toBe(0);
  });

  it('smoothing helpers behave: Damped converges without overshoot, noise is bounded and smooth', () => {
    const d = new Damped(0);
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, d.step(1, 0.2, DT));
    expect(max).toBeLessThanOrEqual(1);
    expect(d.value).toBeCloseTo(1, 4);
    let prev = noise1(0, 5);
    for (let t = 0.01; t < 20; t += 0.01) {
      const n = noise1(t, 5);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(n - prev)).toBeLessThan(0.12);
      prev = n;
    }
    expect(noise1(3.3, 5)).toBe(noise1(3.3, 5));
    expect(noise1(3.3, 5)).not.toBe(noise1(3.3, 6));
  });
});
