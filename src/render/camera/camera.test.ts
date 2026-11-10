import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CameraFollowTarget, Game, GameEvents, PhysicsWorld, Vec3Like } from '@/core/api';
import { Emitter } from '@/core/events';
import { InputSystemImpl } from '@/core/input';
import { DEG } from '@/core/mathx';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { CameraFeel } from './feel';
import { FOLLOW, orbitPitchFor } from './follow';
import { Damped, noise1 } from './pose';
import { CameraRigImpl } from './rig';

const DT = 1 / 60;

function setup(physics?: Partial<PhysicsWorld>) {
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  const game = {
    events,
    settings,
    scene: new THREE.Scene(),
    physics: physics ?? nullObject<PhysicsWorld>('physics'),
  } as unknown as Game;
  const input = new InputSystemImpl(game, { win: null, doc: null, canvas: null, getGamepads: () => null });
  (game as { input: unknown }).input = input;
  const rig = new CameraRigImpl(game);
  (game as { camera: unknown }).camera = rig;
  rig.setViewport(1280, 720);
  // Reduced shake also disables idle breathing, which keeps pose assertions exact.
  settings.set('reduceShake', true);
  const target: CameraFollowTarget = { pos: new THREE.Vector3(0, 0, 0), height: 1.55, yaw: 0 };
  const tick = (n = 1, dt = DT) => {
    for (let i = 0; i < n; i++) {
      input.update(dt);
      rig.update(dt);
    }
  };
  return { game, input, rig, settings, target, tick };
}

const camDir = (rig: CameraRigImpl) => rig.camera.getWorldDirection(new THREE.Vector3());

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
    const calls: number[] = [];
    const physics = {
      sweepSphere(from: Vec3Like, to: Vec3Like, radius: number) {
        calls.push(radius);
        // only the arm sweep (shoulder → camera, mostly along z) is obstructed
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
    expect(calls.every((r) => r === FOLLOW.probe)).toBe(true);

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
