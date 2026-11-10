import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CameraFollowTarget, PhysicsWorld, Vec3Like } from '@/core/api';
import { DEG } from '@/core/mathx';
import { nullObject } from '@/core/stub';
import { FOLLOW, orbitPitchFor } from './follow';
import { DT, camDir, setup } from './testkit';

describe('conventions', () => {
  it('yaw 0 looks toward −Z; positive yaw turns left; positive pitch looks up', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick();
    const f = rig.getForward(new THREE.Vector3());
    const r = rig.getRight(new THREE.Vector3());
    expect(f.x).toBeCloseTo(0, 6);
    expect(f.z).toBeCloseTo(-1, 6);
    expect(r.x).toBeCloseTo(1, 6);
    expect(r.z).toBeCloseTo(0, 6);
    const d = camDir(rig);
    expect(d.z).toBeCloseTo(-1, 5);
    expect(rig.camera.position.z).toBeGreaterThan(0); // behind a target that faces −Z

    rig.yaw = Math.PI / 2;
    tick();
    rig.getForward(f);
    rig.getRight(r);
    expect(f.x).toBeCloseTo(-1, 6); // west
    expect(f.z).toBeCloseTo(0, 6);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.z).toBeCloseTo(-1, 6);

    rig.yaw = 0;
    rig.pitch = 0.3;
    tick();
    expect(camDir(rig).y).toBeCloseTo(Math.sin(0.3), 5);
  });

  it('builds the camera with near 0.1 / far 6000 and tracks the viewport aspect', () => {
    const { rig, tick } = setup();
    expect(rig.camera.near).toBe(0.1);
    expect(rig.camera.far).toBe(6000);
    rig.setViewport(1000, 500);
    tick();
    expect(rig.camera.aspect).toBeCloseTo(2, 6);
  });
});

describe('follow', () => {
  it('sits over the right shoulder at the BRIEF numbers', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(30);
    const p = rig.camera.position;
    expect(p.x).toBeCloseTo(FOLLOW.shoulder, 4);
    expect(p.y).toBeCloseTo(1.55, 4);
    expect(p.z).toBeCloseTo(FOLLOW.distance, 4);
    expect(rig.camera.fov).toBeCloseTo(62, 4);
    expect(rig.targetDistance).toBeCloseTo(Math.hypot(FOLLOW.shoulder, FOLLOW.distance), 4);
    expect(rig.mode).toBe('follow');
  });

  it('orbits with look input and clamps pitch to [−55°, 70°]', () => {
    const { rig, target, input, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    input.virtual.addLook(0.5, 0);
    tick();
    expect(rig.yaw).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 40; i++) {
      input.virtual.addLook(0, 0.1);
      tick();
    }
    expect(rig.pitch).toBeCloseTo(70 * DEG, 6);
    for (let i = 0; i < 80; i++) {
      input.virtual.addLook(0, -0.1);
      tick();
    }
    expect(rig.pitch).toBeCloseTo(-55 * DEG, 6);
    rig.pitch = 5;
    expect(rig.pitch).toBeCloseTo(70 * DEG, 6);
  });

  it('looking up: stays above the floor, keeps its distance, and drops the figure low in frame', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    for (const deg of [-55, -20, 0, 8]) expect(orbitPitchFor(deg * DEG)).toBe(deg * DEG);
    expect(orbitPitchFor(70 * DEG)).toBeLessThanOrEqual(FOLLOW.orbitMax);
    expect(orbitPitchFor(30 * DEG)).toBeGreaterThan(orbitPitchFor(20 * DEG)); // monotonic, no dead zone
    rig.pitch = 70 * DEG;
    tick(30);
    expect(rig.camera.position.y).toBeGreaterThanOrEqual(FOLLOW.floorClearance - 1e-6);
    expect(rig.targetDistance).toBeGreaterThan(2.6); // not squeezed against the player
    expect(camDir(rig).y).toBeCloseTo(Math.sin(70 * DEG), 5); // the view still reaches the full pitch
    rig.pitch = 45 * DEG;
    tick(30);
    const head = { x: 0, y: 0 };
    expect(rig.worldToScreen({ x: 0, y: 1.8, z: 0 }, head)).toBe(true);
    expect(head.y).toBeGreaterThan(720 * 0.8); // head near the bottom edge: the sky is clear
  });

  it('swaps shoulder on input unless the press was consumed', () => {
    const { rig, target, input, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    input.virtual.press('swapShoulder');
    tick();
    expect(rig.shoulder).toBe(-1);
    tick(90);
    expect(rig.camera.position.x).toBeCloseTo(-FOLLOW.shoulder, 3);
    input.virtual.press('swapShoulder');
    input.update(DT);
    input.consume('swapShoulder');
    rig.update(DT);
    expect(rig.shoulder).toBe(-1);
    rig.setShoulder(1);
    expect(rig.shoulder).toBe(1);
  });

  it('aim tightens to distance 1.6 / FOV 48 and keeps the target off-centre', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    rig.setAim(true);
    expect(rig.aiming).toBe(true);
    tick(90);
    expect(rig.camera.fov).toBeCloseTo(FOLLOW.aimFov, 2);
    expect(rig.camera.position.z).toBeCloseTo(FOLLOW.aimDistance, 2);
    expect(rig.camera.position.x).toBeCloseTo(FOLLOW.aimShoulder, 2);
    const s = { x: 0, y: 0 };
    expect(rig.worldToScreen({ x: 0, y: 1.55, z: 0 }, s)).toBe(true);
    expect(s.x).toBeLessThan(640 - 150); // player well left of the reticle
    rig.setAim(false);
    tick(120);
    expect(rig.camera.fov).toBeCloseTo(62, 2);
    expect(rig.camera.position.z).toBeCloseTo(FOLLOW.distance, 2);
  });

  it('pulls in instantly on collision and eases back out', () => {
    let allowed = 1;
    let whisker = 1;
    const radii = new Set<number>();
    const physics = {
      sweepSphere(from: Vec3Like, to: Vec3Like, radius: number) {
        radii.add(radius);
        if (radius < FOLLOW.probe) return whisker; // anticipation probes are thinner
        // of the full-radius sweeps only the arm (shoulder → camera, mostly along z) is obstructed
        return Math.abs(to.z - from.z) > 1 ? allowed : 1;
      },
      groundAt: () => null,
    } as unknown as PhysicsWorld;
    const { rig, target, tick } = setup(physics);
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    expect(rig.camera.position.z).toBeCloseTo(FOLLOW.distance, 4);
    expect(radii.has(FOLLOW.probe)).toBe(true); // the arm itself is swept with the 0.25 m probe

    allowed = 0.4; // a wall appears behind the player
    tick();
    expect(rig.camera.position.z).toBeCloseTo(FOLLOW.distance * 0.4, 4); // same frame

    allowed = 1;
    tick();
    const z1 = rig.camera.position.z;
    expect(z1).toBeGreaterThan(FOLLOW.distance * 0.4);
    expect(z1).toBeLessThan(FOLLOW.distance * 0.4 + 0.2); // not a pop
    tick(120);
    expect(rig.camera.position.z).toBeCloseTo(FOLLOW.distance, 3);

    // an obstacle beside the arm (whisker only): ease most of the way in ahead of it — eased, never snapped
    whisker = 0.25;
    tick();
    expect(rig.camera.position.z).toBeGreaterThan(FOLLOW.distance - 0.4);
    tick(120);
    const anticipated = FOLLOW.distance + (FOLLOW.distance * 0.25 - FOLLOW.distance) * FOLLOW.whiskerPull;
    expect(rig.camera.position.z).toBeCloseTo(anticipated, 2);
    whisker = 1;
    tick();
    expect(rig.camera.position.z).toBeLessThan(anticipated + 0.2); // and eases back out, no outward pop
    tick(300);
    expect(rig.camera.position.z).toBeCloseTo(FOLLOW.distance, 2);
  });

  it('lags behind a moving target without drifting away, and snaps on teleport', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(5);
    for (let i = 0; i < 120; i++) {
      target.pos.z -= 5.2 * DT; // run north
      tick();
    }
    const lag = rig.camera.position.z - (target.pos.z + FOLLOW.distance);
    expect(lag).toBeGreaterThan(0.1);
    expect(lag).toBeLessThan(0.6);
    target.pos.set(100, 3, -50);
    tick();
    expect(rig.camera.position.x).toBeCloseTo(100 + FOLLOW.shoulder, 3);
    expect(rig.camera.position.y).toBeCloseTo(3 + 1.55, 3);
    expect(rig.camera.position.z).toBeCloseTo(-50 + FOLLOW.distance, 3);
  });

  it('adds sprint FOV and recentres gently behind movement only when look is idle', () => {
    const { rig, target, input, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    input.virtual.active = true; // not "assisted": the long idle delay applies
    tick(5);
    for (let i = 0; i < 60; i++) {
      target.pos.x += 7.2 * DT; // sprint east while the camera still faces north
      tick();
    }
    expect(rig.camera.fov).toBeGreaterThan(62 + 3);
    expect(rig.yaw).toBeCloseTo(0, 6); // within the idle delay: untouched
    for (let i = 0; i < 360; i++) {
      target.pos.x += 7.2 * DT;
      tick();
    }
    expect(rig.yaw).toBeLessThan(-0.5); // easing toward east (yaw −90°)
    expect(rig.yaw).toBeGreaterThan(-Math.PI / 2 - 1e-3);
    const before = rig.yaw;
    for (let i = 0; i < 60; i++) {
      target.pos.x += 7.2 * DT;
      input.virtual.addLook(0.0005, 0);
      tick();
    }
    expect(rig.yaw).toBeCloseTo(before + 60 * 0.0005, 4); // player input cancels the assist
  });

  it('survives stub subsystems and bad input without throwing', () => {
    const { rig, target, tick, game } = setup();
    (game as { input: unknown }).input = nullObject('input');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => {
      rig.update(DT);
      rig.setTarget(target);
      rig.update(DT);
      rig.setLockOn(() => {
        throw new Error('dead actor');
      });
      rig.update(DT);
      rig.setLockOn(() => ({ x: NaN, y: 0, z: 0 }));
      rig.update(NaN);
      rig.cine.cut({ pos: { x: NaN, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } });
      rig.cine.move(null as never, 1);
      rig.cine.move({ pos: { x: 1, y: 2, z: 3 }, look: { x: 0, y: 1, z: 0 } }, 1, 'bogus' as never);
      rig.setFree({ pos: { x: 0, y: 0, z: 0 }, look: undefined as never });
      rig.shake(NaN);
      rig.kick(NaN, Infinity);
      rig.fovPunch(NaN);
      rig.setTarget(null);
      rig.update(DT);
      rig.worldToScreen({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0 });
    }).not.toThrow();
    expect(Number.isFinite(rig.camera.position.x)).toBe(true);
    warn.mockRestore();
    void tick;
  });
});

describe('robustness', () => {
  it('a throwing physics query degrades to no collision instead of freezing the camera', () => {
    const physics = {
      sweepSphere() {
        throw new Error('broadphase exploded');
      },
      groundAt() {
        throw new Error('no surfaces');
      },
    } as unknown as PhysicsWorld;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rig, target, tick } = setup(physics);
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    expect(() => tick(5)).not.toThrow();
    expect(rig.camera.position.z).toBeCloseTo(FOLLOW.distance, 4);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('lock-on', () => {
  it('frames the player and the lock point together, target on the open side', () => {
    const { rig, target, input, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    const enemy = new THREE.Vector3(6, 1.2, -6); // north-east, the camera starts facing north
    rig.setLockOn(() => enemy);
    tick(240);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    expect(rig.worldToScreen({ x: 0, y: 1.2, z: 0 }, a)).toBe(true);
    expect(rig.worldToScreen(enemy, b)).toBe(true);
    for (const s of [a, b]) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(1280);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(720);
    }
    expect(a.x).toBeLessThan(640); // player on the shoulder side
    expect(b.x).toBeGreaterThan(a.x + 80); // target clear of the player's body
    expect(Math.abs(b.x - 640)).toBeLessThan(160); // and near the centre

    // look input still nudges, then relaxes back
    const settled = rig.yaw;
    for (let i = 0; i < 30; i++) {
      input.virtual.addLook(0.01, 0);
      tick();
    }
    expect(rig.yaw).toBeGreaterThan(settled + 0.1);
    tick(600);
    expect(rig.yaw).toBeCloseTo(settled, 2);

    rig.setLockOn(null);
    tick(10);
    expect(rig.yaw).toBeCloseTo(settled, 2); // releasing the lock does not pop
  });
});

describe('lock-on dynamics and hand-over', () => {
  it('stays smooth while the player circles a close target', () => {
    const { rig, target, tick } = setup();
    const enemy = new THREE.Vector3(0, 1.2, 0);
    target.pos.set(0, 0, 2.2);
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.setLockOn(() => enemy);
    tick(120);
    let prevYaw = rig.yaw;
    let prevRate = 0;
    let maxRate = 0;
    let maxJerk = 0;
    const s = { x: 0, y: 0 };
    let offscreen = 0;
    for (let i = 0; i < 600; i++) {
      const a = (i / 60) * (4 / 2.2); // 4 m/s around a 2.2 m circle
      target.pos.set(Math.sin(a) * 2.2, 0, Math.cos(a) * 2.2);
      tick();
      let d = rig.yaw - prevYaw;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      const rate = d / DT;
      if (i > 60) {
        maxRate = Math.max(maxRate, Math.abs(rate));
        maxJerk = Math.max(maxJerk, Math.abs(rate - prevRate));
        if (!rig.worldToScreen(enemy, s) || s.x < 0 || s.x > 1280 || s.y < 0 || s.y > 720) offscreen++;
      }
      prevRate = rate;
      prevYaw = rig.yaw;
    }
    expect(maxRate).toBeLessThan(2.6); // tracks the 1.8 rad/s orbit without whipping
    expect(maxJerk).toBeLessThan(0.25); // no frame-to-frame snaps
    expect(offscreen).toBe(0); // the lock point never leaves the frame
  });

  it('glides to a new follow target instead of cutting; snapBehind makes it instant', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(10);
    const from = rig.camera.position.clone();
    const other: CameraFollowTarget = { pos: new THREE.Vector3(4, 0, -3), height: 1.55, yaw: 1 };
    rig.setTarget(other);
    tick();
    expect(rig.camera.position.distanceTo(from)).toBeLessThan(0.05);
    expect(rig.blending).toBe(true);
    tick(90);
    expect(rig.blending).toBe(false);
    expect(rig.camera.position.x).toBeGreaterThan(3);

    rig.setTarget(target);
    rig.snapBehind();
    tick();
    expect(rig.blending).toBe(false);
    expect(rig.yaw).toBeCloseTo(0, 6); // target.yaw
    expect(rig.camera.position.z).toBeGreaterThan(3);
  });

  it('aimAt turns instantly, or as a guided turn the player can cancel', () => {
    const { rig, target, input, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(5);
    rig.aimAt({ x: -10, y: 1.55, z: 0 }); // due west, level
    expect(rig.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(rig.pitch).toBeCloseTo(0, 6);

    rig.aimAt({ x: 0, y: 11.55, z: -10 }, 1.5); // north, 45° up — guided
    tick();
    expect(rig.yaw).toBeGreaterThan(1.3); // has only just started
    tick(150);
    expect(rig.yaw).toBeCloseTo(0, 1);
    expect(rig.pitch).toBeCloseTo(45 * DEG, 1);

    rig.aimAt({ x: 10, y: 1.55, z: 0 }, 2); // east
    tick(10);
    input.virtual.addLook(0.02, 0); // the player takes over
    tick();
    const yaw = rig.yaw;
    tick(120);
    expect(rig.yaw).toBeCloseTo(yaw, 4);
  });

  it('a zone load cancels shake and blends', () => {
    const { rig, target, game, settings, tick } = setup();
    settings.set('reduceShake', false);
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(5);
    rig.shake(1, 5);
    rig.kick(3);
    rig.fovPunch(8, 5);
    tick(3);
    expect(rig.trauma).toBeGreaterThan(0);
    game.events.emit('zone:loading', { zone: 'Z01' });
    settings.set('reduceShake', true);
    tick();
    expect(rig.trauma).toBe(0);
    expect(rig.camera.fov).toBeCloseTo(62, 6);
  });
});

describe('worldToScreen and aim ray', () => {
  it('projects to CSS pixels and reports points behind the camera', () => {
    const { rig } = setup();
    rig.setFree({ pos: { x: 0, y: 2, z: 10 }, look: { x: 0, y: 2, z: 0 }, fov: 60 });
    const s = { x: 0, y: 0 };
    expect(rig.worldToScreen({ x: 0, y: 2, z: 0 }, s)).toBe(true);
    expect(s.x).toBeCloseTo(640, 3);
    expect(s.y).toBeCloseTo(360, 3);
    // top edge of a 60° vertical FOV at 10 m is tan(30°)·10 above centre
    expect(rig.worldToScreen({ x: 0, y: 2 + Math.tan(30 * DEG) * 10, z: 0 }, s)).toBe(true);
    expect(s.y).toBeCloseTo(0, 3);
    expect(rig.worldToScreen({ x: 3, y: 2, z: 0 }, s)).toBe(true);
    expect(s.x).toBeGreaterThan(640);
    // behind and to the right: false, but still on the right-hand side and outside the frame
    expect(rig.worldToScreen({ x: 4, y: 2, z: 20 }, s)).toBe(false);
    expect(s.x).toBeGreaterThan(1280);
    expect(rig.worldToScreen({ x: 0, y: 2, z: 20 }, s)).toBe(false);
    expect(s.y).toBeGreaterThan(720);

    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    rig.getAimRay(o, d);
    expect(o.z).toBeCloseTo(10, 6);
    expect(d.z).toBeCloseTo(-1, 6);
    expect(rig.mode).toBe('free');
    rig.setFree(null);
    expect(rig.mode).toBe('follow');
  });

  it('aim ray includes recoil kick but not shake', () => {
    const { rig, target, settings, tick } = setup();
    settings.set('reduceShake', false);
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    rig.shake(1, 0.5);
    tick(3);
    rig.getAimRay(o, d);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(-1, 6);
    rig.kick(2);
    tick(3);
    rig.getAimRay(o, d);
    expect(d.y).toBeGreaterThan(0.01); // kicked upward
  });
});
