/** Regression tests for the review findings: recentre, pause / hit-stop, squeeze, blink, blends, lifecycle. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { PhysicsWorld, Vec3Like } from '@/core/api';
import { DEG } from '@/core/mathx';
import { FOLLOW, FollowCamera, RECENTRE_ASSIST, RECENTRE_GENTLE, RECENTRE_OFF, type FollowInput } from './follow';
import { DT, REST, armLength, camDir, setup } from './testkit';

const HEAD = { x: 0, y: 1.77, z: 0 };
const yawDeg = (a: number, b: number): number => {
  let d = a - b;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d / DEG;
};

/** half-spaces of solid: every point with axis·sign ≥ at is inside a wall */
function walls(list: Array<{ axis: 'x' | 'z'; at: number; sign: 1 | -1 }>, opts: { enabled?: () => boolean } = {}): PhysicsWorld {
  return {
    sweepSphere(from: Vec3Like, to: Vec3Like, radius: number) {
      if (opts.enabled && !opts.enabled()) return 1;
      let k = 1;
      for (const w of list) {
        const a = from[w.axis] * w.sign;
        const b = to[w.axis] * w.sign;
        const limit = w.at - radius;
        if (a > limit) return 0; // starts inside
        if (b > limit) k = Math.min(k, Math.max(0, (limit - 0.01 - a) / (b - a)));
      }
      return k;
    },
    groundAt: () => null,
  } as unknown as PhysicsWorld;
}

describe('auto-recentre (closed loop: move → camera basis → target → camera)', () => {
  /** the player loop the reviewer asked for, on the follow camera alone: returns yaw (rad) once per frame */
  function run(mode: number, mx: number, my: number, seconds: number, extra: Partial<FollowInput> = {}): { yaw: number[]; cam: FollowCamera } {
    const cam = new FollowCamera();
    const target = { pos: new THREE.Vector3(), height: 1.55 };
    cam.setTarget(target);
    const fi: FollowInput = { lookX: 0, lookY: 0, recentre: mode, absolute: false, busy: false, simDt: DT, ...extra };
    const world = { sweep: null, ground: null };
    const yaw: number[] = [];
    const len = Math.hypot(mx, my) || 1;
    for (let i = 0; i < seconds * 60; i++) {
      const fx = -Math.sin(cam.yaw);
      const fz = -Math.cos(cam.yaw);
      target.pos.x += ((Math.cos(cam.yaw) * mx + fx * my) / len) * 5.2 * DT;
      target.pos.z += ((-Math.sin(cam.yaw) * mx + fz * my) / len) * 5.2 * DT;
      cam.update(DT, fi, world);
      yaw.push(cam.yaw);
    }
    return { yaw, cam };
  }
  const maxRate = (yaw: number[]): number => {
    let m = 0;
    for (let i = 1; i < yaw.length; i++) m = Math.max(m, Math.abs(yawDeg(yaw[i], yaw[i - 1])) / DT);
    return m;
  };

  it('strafing and backpedalling never turn the camera, on any device', () => {
    for (const mode of [RECENTRE_GENTLE, RECENTRE_ASSIST]) {
      for (const [mx, my] of [[1, 0], [-1, 0], [0, -1], [1, -1]]) {
        const { yaw } = run(mode, mx, my, 12);
        expect(Math.abs(yawDeg(yaw[yaw.length - 1], 0)), `mode ${mode} move ${mx},${my}`).toBeLessThan(0.5);
      }
    }
  });

  it('a held diagonal is a slow capped arc: ≤ 18°/s on a pad, ≤ 25°/s without pointer lock', () => {
    const pad = run(RECENTRE_GENTLE, 1, 1, 12);
    expect(maxRate(pad.yaw)).toBeLessThanOrEqual(18.01);
    expect(maxRate(pad.yaw)).toBeGreaterThan(3); // it does help the player round the corner
    expect(yawDeg(pad.yaw[143], 0)).toBeCloseTo(0, 6); // nothing for the first 2.4 s
    const kb = run(RECENTRE_ASSIST, 1, 1, 12);
    expect(maxRate(kb.yaw)).toBeLessThanOrEqual(25.01);
    expect(Math.abs(yawDeg(kb.yaw[kb.yaw.length - 1], kb.yaw[0]))).toBeGreaterThan(60); // keyboard steering works
    const shallow = run(RECENTRE_GENTLE, 0.25, 1, 12);
    expect(maxRate(shallow.yaw)).toBeLessThanOrEqual(18.01);
  });

  it('a captured mouse gets no automatic camera at all', () => {
    for (const [mx, my] of [[1, 1], [0, 1], [1, 0]]) {
      const { yaw, cam } = run(RECENTRE_OFF, mx, my, 12);
      expect(maxRate(yaw)).toBe(0);
      expect(cam.pitch).toBeCloseTo(FOLLOW.pitchRest, 9);
    }
  });

  it('stays out of the way while fighting, and after a combat input', () => {
    expect(maxRate(run(RECENTRE_GENTLE, 1, 1, 12, { busy: true }).yaw)).toBe(0);
  });

  it('through the rig: virtual / pad input is gentle, strafing at 30 fps or 60 fps never spirals', () => {
    for (const dt of [1 / 60, 1 / 30]) {
      const { rig, target, input, host } = setup();
      rig.setTarget(target);
      rig.snapBehind(0);
      const f = new THREE.Vector3();
      const r = new THREE.Vector3();
      input.virtual.setMove(1, 0);
      let peak = 0;
      let prev = rig.yaw;
      for (let t = 0; t < 12; t += dt) {
        input.update(dt);
        host.time.now += dt;
        rig.getForward(f);
        rig.getRight(r);
        target.pos.addScaledVector(r, input.move.x * 5.2 * dt).addScaledVector(f, input.move.y * 5.2 * dt);
        rig.update(dt);
        peak = Math.max(peak, Math.abs(yawDeg(rig.yaw, prev)) / dt);
        prev = rig.yaw;
      }
      expect(peak).toBeLessThan(0.05);
      expect(Math.abs(rig.yaw)).toBeLessThan(0.01);
    }
  });

  it('a bot steering by world direction is followed round a corner, at a bounded rate', () => {
    const { rig, target, input, host } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    input.virtual.setMoveWorld({ x: 1, z: 0 }); // run east while the camera faces north
    let peak = 0;
    let prev = rig.yaw;
    for (let i = 0; i < 60 * 10; i++) {
      input.update(DT);
      host.time.now += DT;
      target.pos.x += 5.2 * DT;
      rig.update(DT);
      peak = Math.max(peak, Math.abs(yawDeg(rig.yaw, prev)) / DT);
      prev = rig.yaw;
    }
    expect(rig.yaw / DEG).toBeLessThan(-70); // has come round behind the run (east = −90°)
    expect(rig.yaw / DEG).toBeGreaterThan(-90.5);
    expect(peak).toBeLessThanOrEqual(60.01);
  });
});

describe('authored time: pause, loading, hit-stop, slow-motion', () => {
  const A = { pos: { x: 0, y: 2, z: 10 }, look: { x: 0, y: 1, z: 0 }, fov: 40 };
  const B = { pos: { x: 8, y: 3, z: 10 }, look: { x: 0, y: 1, z: 0 }, fov: 40 };

  it('a cinematic move does not advance while the game is paused or loading', () => {
    const { rig, host, tick } = setup();
    rig.cine.cut(A);
    rig.cine.move(B, 4, 'linear');
    tick(60);
    expect(rig.camera.position.x).toBeCloseTo(2, 3);
    host.paused = true;
    tick(300); // five seconds in the pause menu
    expect(rig.camera.position.x).toBeCloseTo(2, 3);
    expect(rig.cine.moving).toBe(true);
    host.paused = false;
    host.mission.loading = true;
    tick(120);
    expect(rig.camera.position.x).toBeCloseTo(2, 3);
    host.mission.loading = false;
    tick(60);
    expect(rig.camera.position.x).toBeCloseTo(4, 3);
    tick(125);
    expect(rig.cine.moving).toBe(false);
    expect(rig.camera.position.x).toBeCloseTo(8, 6);
  });

  it('waits out hit-stop and stretches with slow-motion', () => {
    const { rig, tick } = setup();
    rig.cine.cut(A);
    rig.cine.move(B, 4, 'linear');
    tick(60);
    tick(15, DT, 0); // hit-stop: real frames, no simulated time
    expect(rig.camera.position.x).toBeCloseTo(2, 3);
    tick(120, DT, 0.25); // two real seconds at quarter speed = half a second of shot
    expect(rig.camera.position.x).toBeCloseTo(3, 3);
  });

  it('drift, release blends and guided turns stop with it; shake does not', () => {
    const { rig, target, host, settings, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(5);
    rig.cine.cut(A);
    rig.cine.drift({ around: { x: 0, y: 0, z: 0 }, yawRate: 0.5 });
    tick(30);
    host.paused = true;
    const p = rig.camera.position.clone();
    tick(120);
    expect(rig.camera.position.distanceTo(p)).toBeLessThan(1e-6);
    host.paused = false;
    tick(30);
    expect(rig.camera.position.distanceTo(p)).toBeGreaterThan(0.5);

    rig.release(1);
    tick(30);
    host.paused = true;
    const mid = rig.camera.position.clone();
    tick(120);
    expect(rig.blending).toBe(true);
    expect(rig.camera.position.distanceTo(mid)).toBeLessThan(1e-6);
    host.paused = false;
    tick(40);
    expect(rig.blending).toBe(false);

    rig.aimAt({ x: -10, y: 1.55, z: 0 }, 2);
    tick(10);
    host.paused = true;
    const yaw = rig.yaw;
    tick(120);
    expect(rig.yaw).toBe(yaw);
    host.paused = false;
    tick(300);
    expect(rig.yaw).toBeCloseTo(Math.PI / 2, 1);

    settings.set('reduceShake', false);
    rig.shake(1, 0.5);
    host.paused = true;
    tick(40);
    expect(rig.trauma).toBe(0); // real-time: the shake ran out under the pause menu
  });

  it('outside the playing phases (title screen) cinematic time is real time', () => {
    const { rig, host } = setup();
    host.phase = 'title';
    rig.cine.cut(A);
    rig.cine.move(B, 4, 'linear');
    for (let i = 0; i < 60; i++) rig.update(DT); // the simulation clock never moves on the title screen
    expect(rig.camera.position.x).toBeCloseTo(2, 3);
  });
});

describe('squeezed against geometry', () => {
  it('back to a wall: the camera looks over the head and the hero stays in frame', () => {
    let wall = true;
    const { rig, target, tick } = setup(walls([{ axis: 'z', at: 0.75, sign: 1 }], { enabled: () => wall }));
    rig.setTarget(target);
    rig.snapBehind(0); // rest pitch −9°, wall 0.75 m behind the hero's centre (their back ~0.5 m from it)
    tick(60);
    const p = rig.camera.position;
    expect(p.z).toBeLessThanOrEqual(0.75 - FOLLOW.probe); // never in the wall
    expect(p.y).toBeGreaterThan(1.55 + 0.45); // risen above the head
    const head = { x: 0, y: 0 };
    expect(rig.worldToScreen(HEAD, head)).toBe(true);
    expect(head.x).toBeGreaterThan(1280 * 0.15);
    expect(head.x).toBeLessThan(1280 * 0.6);
    expect(head.y).toBeGreaterThan(720 * 0.55); // low in the frame: the view ahead is clear
    expect(head.y).toBeLessThan(720);
    expect(rig.playerFade).toBeGreaterThan(0.6); // close, but not close enough to need hiding
    expect(camDir(rig).y).toBeLessThan(Math.sin(FOLLOW.pitchRest) - 0.03); // tilted down a little to hold the helmet
    expect(rig.pitch).toBeCloseTo(FOLLOW.pitchRest, 6); // the player's own pitch is untouched
    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    rig.getAimRay(o, d);
    expect(d.dot(camDir(rig))).toBeCloseTo(1, 5); // the aim ray is what the screen centre shows

    rig.setAim(true); // aiming: the reticle must not drift, so no tilt
    tick(90);
    expect(camDir(rig).y).toBeCloseTo(Math.sin(FOLLOW.pitchRest), 3);
    expect(rig.camera.position.z).toBeLessThanOrEqual(0.75 - FOLLOW.probe);
    rig.setAim(false);
    tick(60);

    wall = false; // stepping away: ease back out, no outward pop
    let step = 0;
    let prev = p.clone();
    for (let i = 0; i < 300; i++) {
      tick();
      step = Math.max(step, p.distanceTo(prev));
      prev = p.clone();
    }
    expect(step).toBeLessThan(0.12);
    expect(p.x).toBeCloseTo(REST.x, 2);
    expect(camDir(rig).y).toBeCloseTo(Math.sin(FOLLOW.pitchRest), 4);
  });

  it('snapping in against a wall lands in the settled pose at once', () => {
    const { rig, target, tick } = setup(walls([{ axis: 'z', at: 0.75, sign: 1 }]));
    rig.setTarget(target);
    rig.snapBehind(0);
    tick();
    const first = rig.camera.position.clone();
    tick(120);
    expect(rig.camera.position.distanceTo(first)).toBeLessThan(0.03);
  });

  it('wedged into a corner the figure fades instead of filling the frame', () => {
    const { rig, target, tick } = setup(walls([{ axis: 'z', at: 0.45, sign: 1 }, { axis: 'x', at: 0.45, sign: 1 }, { axis: 'x', at: 0.45, sign: -1 }]));
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(60);
    expect(rig.playerFade).toBeLessThan(0.5);
    expect(rig.camera.position.z).toBeLessThanOrEqual(0.45 - FOLLOW.probe);
    expect(Math.abs(rig.camera.position.x)).toBeLessThanOrEqual(0.45 - FOLLOW.probe + 1e-6);
  });

  it('a hero standing inside a solid does not collapse the camera into the head', () => {
    let inside = false;
    const physics = { sweepSphere: () => (inside ? 0 : 1), groundAt: () => null } as unknown as PhysicsWorld;
    const { rig, target, tick } = setup(physics);
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    inside = true; // a door closed on them / a large body moved over them
    tick(120);
    expect(armLength(rig)).toBeGreaterThan(3);
    expect(rig.targetDistance).toBeGreaterThan(3);
    inside = false;
    tick(5);
    expect(armLength(rig)).toBeCloseTo(FOLLOW.distance, 2);
  });

  it('a thin post between camera and hero shortens the arm as an eased move, not a pop', () => {
    let post = false;
    const physics = {
      sweepSphere(from: Vec3Like, to: Vec3Like, radius: number) {
        // only the thin sight probe is cut, and only for a camera more than 2 m from the head
        if (post && radius < FOLLOW.probe * 0.55 && Math.hypot(to.x - from.x, to.z - from.z) > 2) return 0.5;
        return 1;
      },
      groundAt: () => null,
    } as unknown as PhysicsWorld;
    const { rig, target, tick } = setup(physics);
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    post = true;
    let step = 0;
    let prev = armLength(rig);
    for (let i = 0; i < 40; i++) {
      tick();
      step = Math.max(step, Math.abs(armLength(rig) - prev));
      prev = armLength(rig);
    }
    expect(step).toBeLessThan(0.5);
    expect(armLength(rig)).toBeLessThan(2.05); // the head is back in sight
    expect(armLength(rig)).toBeGreaterThan(1.5);
  });
});

describe('blink-distance moves', () => {
  it('a 4.5 m blink is followed with a short whip, not a 3.5 m jump; aim framing survives', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    rig.setAim(true);
    tick(90);
    const p = rig.camera.position;
    let prev = p.clone();
    target.pos.z -= 4.5; // Dispatch
    let step = 0;
    let frames = 0;
    for (let i = 0; i < 30; i++) {
      tick();
      step = Math.max(step, p.distanceTo(prev));
      if (p.distanceTo(prev) > 0.01) frames = i + 1;
      prev = p.clone();
      expect(rig.camera.fov).toBeCloseTo(FOLLOW.aimFov, 2); // still the same aimed shot
    }
    expect(step).toBeLessThan(1.1);
    expect(frames).toBeGreaterThan(6); // it travels…
    expect(frames).toBeLessThan(16); // …for about 0.15–0.22 s
    expect(p.z).toBeCloseTo(-4.5 + FOLLOW.aimDistance, 2);
  });

  it('a zone-scale displacement, or snapBehind, still cuts', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    rig.pitch = 0;
    tick(10);
    target.pos.z -= 40;
    tick();
    expect(rig.camera.position.z).toBeCloseTo(-40 + REST.z, 3);
    target.pos.z -= 6;
    rig.snapBehind(0);
    rig.pitch = 0;
    tick();
    expect(rig.camera.position.z).toBeCloseTo(-46 + REST.z, 3);
  });

  it('a fast knock-back at a low frame rate is not mistaken for a blink', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(10, 1 / 15);
    let lagMax = 0;
    for (let i = 0; i < 8; i++) {
      target.pos.z -= 20 / 15; // 20 m/s at 15 fps = 1.33 m per frame
      tick(1, 1 / 15);
      lagMax = Math.max(lagMax, rig.camera.position.z - (target.pos.z + REST.z * Math.cos(FOLLOW.pitchRest)));
    }
    expect(lagMax).toBeLessThan(1.3); // ordinary lag clamp, the hero never leaves the frame
  });
});

describe('blends, framing and lifecycle', () => {
  it('release() cuts instead of flying the camera through a wall', () => {
    const { rig, target, tick } = setup(walls([{ axis: 'x', at: 6, sign: 1 }])); // solid east of x = 6
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(5);
    rig.cine.cut({ pos: { x: 12, y: 3, z: 0 }, look: { x: 0, y: 1, z: 0 } }); // a shot from beyond the wall
    tick(5);
    rig.release(1.2);
    tick(2);
    expect(rig.blending).toBe(false);
    expect(rig.camera.position.x).toBeLessThan(2);

    rig.cine.cut({ pos: { x: 3, y: 3, z: 2 }, look: { x: 0, y: 1, z: 0 } }); // open air: a normal blend
    tick(2);
    rig.release(1.2);
    tick(2);
    expect(rig.blending).toBe(true);
    const other = { pos: new THREE.Vector3(20, 0, 0), height: 1.55 }; // the hand-over glide obeys the same rule
    tick(120);
    rig.setTarget(other);
    tick(2);
    expect(rig.blending).toBe(false);
  });

  it('narrow windows keep the 16:9 horizontal field of view', () => {
    const { rig, target, tick } = setup();
    rig.setTarget(target);
    rig.snapBehind(0);
    tick(5);
    const hTan = (): number => Math.tan(rig.camera.fov * DEG * 0.5) * rig.camera.aspect;
    const wide = Math.tan(31 * DEG) * (16 / 9);
    expect(rig.camera.fov).toBeCloseTo(62, 6);
    rig.setViewport(2560, 1080); // ultrawide: vertical FOV as authored
    tick();
    expect(rig.camera.fov).toBeCloseTo(62, 6);
    rig.setViewport(1024, 768); // 4:3
    tick();
    expect(hTan()).toBeCloseTo(wide, 5);
    rig.setViewport(1000, 1000);
    tick();
    expect(hTan()).toBeCloseTo(wide, 5);
    rig.setViewport(720, 1280); // portrait: capped at 100° vertical, still far wider than before
    tick();
    expect(rig.camera.fov).toBeCloseTo(100, 6);
    expect(hTan()).toBeGreaterThan(Math.tan(31 * DEG) * (720 / 1280) * 1.8);
    const hero = { x: 0, y: 0 };
    expect(rig.worldToScreen({ x: 0, y: 1.2, z: 0 }, hero)).toBe(true);
    expect(hero.x).toBeGreaterThan(0);
    expect(hero.x).toBeLessThan(720);
  });

  it('shake covers the same share of the screen through the aim lens', () => {
    const deflection = (aim: boolean): number => {
      const { rig, target, settings, tick } = setup();
      rig.setTarget(target);
      rig.snapBehind(0);
      rig.setAim(aim);
      tick(120);
      settings.set('reduceShake', false);
      const rest = camDir(rig);
      rig.shake(1, 60);
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        tick();
        peak = Math.max(peak, camDir(rig).angleTo(rest));
      }
      return peak / Math.tan(rig.camera.fov * DEG * 0.5); // as a fraction of the half-screen
    };
    const wide = deflection(false);
    const zoom = deflection(true);
    expect(wide).toBeGreaterThan(0.01);
    expect(zoom / wide).toBeGreaterThan(0.9);
    expect(zoom / wide).toBeLessThan(1.1);
  });

  it('dispose detaches the camera and stops listening', () => {
    const { rig, target, game, tick } = setup();
    rig.setTarget(target);
    tick(2);
    expect(rig.camera.parent).not.toBeNull();
    rig.setFraming({ distance: 9 }, 0);
    rig.dispose();
    expect(rig.camera.parent).toBeNull();
    game.events.emit('zone:loading', { zone: 'Z01' });
    expect(() => rig.dispose()).not.toThrow();
    expect(() => rig.update(DT)).not.toThrow();
  });
});

describe('cinematic continuity', () => {
  /** largest per-frame change of view direction (degrees) and of position (m) over the next `frames` */
  function watch(s: ReturnType<typeof setup>, frames: number): { angle: number; move: number; steps: number[] } {
    let dir = camDir(s.rig);
    let pos = s.rig.camera.position.clone();
    let angle = 0;
    let move = 0;
    const steps: number[] = [];
    for (let i = 0; i < frames; i++) {
      s.tick();
      const d = camDir(s.rig);
      const a = d.angleTo(dir) / DEG;
      steps.push(a);
      angle = Math.max(angle, a);
      move = Math.max(move, s.rig.camera.position.distanceTo(pos));
      dir = d;
      pos = s.rig.camera.position.clone();
    }
    return { angle, move, steps };
  }

  it('drift after a cut keeps the shot: no pop, with or without a look height', () => {
    const s = setup();
    s.rig.cine.cut({ pos: { x: 2.4, y: 1.75, z: 8.8 }, look: { x: -0.5, y: 1.5, z: 0 }, fov: 44 });
    s.tick(5);
    const before = camDir(s.rig);
    s.rig.cine.drift({ around: { x: 0, y: 0, z: 6 }, yawRate: 0.12 }); // defaults: continue the shot exactly
    expect(camDir(s.rig).angleTo(before) / DEG).toBeLessThan(0.01);
    const kept = watch(s, 180);
    expect(kept.angle).toBeLessThan(0.3);
    expect(kept.move).toBeLessThan(0.02);

    const t = setup();
    t.rig.cine.cut({ pos: { x: 2.4, y: 1.75, z: 8.8 }, look: { x: -0.5, y: 1.5, z: 0 }, fov: 44 });
    t.tick(5);
    const start = camDir(t.rig);
    // the reviewer's case: a look point ~25° away from where the shot was looking, plus another radius / height
    t.rig.cine.drift({ around: { x: 0, y: 0, z: 6 }, yawRate: 0.12, lookHeight: 1.45, radius: 5, height: 2.4 });
    expect(camDir(t.rig).angleTo(start) / DEG).toBeLessThan(0.01);
    const eased = watch(t, 240);
    expect(eased.angle).toBeLessThan(1.2); // 22.7° in one frame before; now eased over ~0.9 s
    expect(eased.move).toBeLessThan(0.06);
    const look = new THREE.Vector3(0, 1.45, 6).sub(t.rig.camera.position).normalize();
    expect(camDir(t.rig).angleTo(look) / DEG).toBeLessThan(0.05); // and it does arrive on the requested look point
    const flat = Math.hypot(t.rig.camera.position.x, t.rig.camera.position.z - 6);
    expect(flat).toBeCloseTo(5, 3);
    expect(t.rig.camera.position.y).toBeCloseTo(2.4, 3);
  });

  it('move → drift, as in the demo cinematic, has no discontinuity at the hand-off', () => {
    const s = setup();
    s.rig.cine.cut({ pos: { x: -7.5, y: 4.4, z: 10.6 }, look: { x: 0.3, y: 0.9, z: -1 }, fov: 34 });
    s.tick(10);
    s.rig.cine.move({ pos: { x: 2.4, y: 1.75, z: 8.8 }, look: { x: -0.5, y: 1.5, z: 0 }, fov: 44, roll: -3 }, 2, 'inOutCubic');
    const moving = watch(s, 125);
    expect(s.rig.cine.moving).toBe(false);
    s.rig.cine.drift({ around: { x: 0, y: 0, z: 6 }, yawRate: 0.12, lookHeight: 1.45 });
    const after = watch(s, 120);
    expect(moving.angle).toBeLessThan(2.5);
    expect(after.angle).toBeLessThan(1.2);
    expect(after.move).toBeLessThan(0.02);
  });

  it('a linear move pans at an even rate even when the look target passes close to the camera', () => {
    const s = setup();
    s.rig.cine.cut({ pos: { x: 0, y: 2, z: 0 }, look: { x: -6, y: 2, z: -0.4 } });
    s.tick(2);
    s.rig.cine.move({ pos: { x: 0, y: 2, z: 0 }, look: { x: 6, y: 2, z: -0.4 } }, 3, 'linear');
    const { steps } = watch(s, 170);
    const mid = steps.slice(5, 165);
    expect(Math.max(...mid) / Math.min(...mid)).toBeLessThan(1.02); // was 6°/s → 568°/s
    expect(Math.max(...mid) * 60).toBeLessThan(60);
    s.tick(20);
    expect(camDir(s.rig).x).toBeGreaterThan(0.99);
  });

  it('a move that keeps the look target stays locked on it; the horizon stays level', () => {
    const s = setup();
    const subject = new THREE.Vector3(0, 1.4, 0);
    s.rig.cine.cut({ pos: { x: -6, y: 2, z: 5 }, look: subject });
    s.rig.cine.move({ pos: { x: 7, y: 3.5, z: 3 }, look: subject }, 2, 'inOut');
    for (let i = 0; i < 110; i++) {
      s.tick();
      const to = subject.clone().sub(s.rig.camera.position).normalize();
      expect(camDir(s.rig).angleTo(to)).toBeLessThan(1e-4);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(s.rig.camera.quaternion);
      expect(Math.abs(right.y)).toBeLessThan(1e-6);
    }
  });

  it('arc() swings round a point instead of cutting the chord', () => {
    const s = setup();
    const centre = { x: 0, y: 1, z: 0 };
    s.rig.cine.cut({ pos: { x: 5, y: 2, z: 0 }, look: centre });
    s.rig.cine.arc({ pos: { x: -5, y: 3, z: 0.001 }, look: centre }, 2, centre, 'linear');
    let minRadius = Infinity;
    for (let i = 0; i < 119; i++) {
      s.tick();
      minRadius = Math.min(minRadius, Math.hypot(s.rig.camera.position.x, s.rig.camera.position.z));
    }
    expect(minRadius).toBeGreaterThan(4.99); // a straight move would pass through the centre
    s.tick(3);
    expect(s.rig.cine.moving).toBe(false);
    expect(s.rig.camera.position.x).toBeCloseTo(-5, 6);
    expect(s.rig.camera.position.y).toBeCloseTo(3, 6);
    s.rig.cine.arc({ pos: { x: 0, y: 2, z: 5 }, look: centre }, 1, { x: NaN, y: 0, z: 0 }); // bad pivot: plain move
    s.tick(70);
    expect(s.rig.camera.position.z).toBeCloseTo(5, 6);
  });

  it('path() is one continuous move through every key and ends exactly on the last', () => {
    const s = setup();
    s.rig.cine.cut({ pos: { x: 0, y: 2, z: 10 }, look: { x: 0, y: 1, z: 0 }, fov: 40 });
    const keys = [
      { pos: { x: 6, y: 3, z: 6 }, look: { x: 0, y: 1, z: 0 } },
      { pos: { x: 8, y: 4, z: -2 }, look: { x: 0, y: 1.5, z: 0 }, fov: 50 },
      { pos: { x: 2, y: 2.5, z: -8 }, look: { x: 0, y: 2, z: 0 }, fov: 35, roll: 4 },
    ];
    s.tick(); // show the cut before measuring steps from it
    s.rig.cine.path(keys, 6, 'linear');
    const near = keys.map(() => Infinity);
    let prev = s.rig.camera.position.clone();
    const steps: number[] = [];
    let turn = 0;
    let dir = camDir(s.rig);
    for (let i = 0; i < 359; i++) {
      s.tick();
      const p = s.rig.camera.position;
      keys.forEach((k, j) => (near[j] = Math.min(near[j], p.distanceTo(new THREE.Vector3(k.pos.x, k.pos.y, k.pos.z)))));
      steps.push(p.distanceTo(prev));
      turn = Math.max(turn, camDir(s.rig).angleTo(dir) / DEG);
      dir = camDir(s.rig);
      prev = p.clone();
    }
    expect(s.rig.cine.moving).toBe(true);
    for (const d of near.slice(0, 2)) expect(d).toBeLessThan(0.08); // it passes THROUGH the intermediate keys
    const mid = steps.slice(3, 355);
    expect(Math.min(...mid)).toBeGreaterThan(0.02); // and never stops at one
    expect(Math.max(...mid)).toBeLessThan(0.2);
    expect(turn).toBeLessThan(1.5);
    s.tick(3);
    expect(s.rig.cine.moving).toBe(false);
    expect(s.rig.camera.position.x).toBeCloseTo(2, 6);
    expect(s.rig.camera.position.z).toBeCloseTo(-8, 6);
    expect(s.rig.camera.fov).toBeCloseTo(35, 6);
    const look = new THREE.Vector3(0, 2, 0).sub(s.rig.camera.position).normalize();
    // (rolled 4°: the view axis is unaffected by roll)
    expect(camDir(s.rig).angleTo(look)).toBeLessThan(1e-4);

    s.rig.cine.path([{ pos: { x: 0, y: 2, z: 10 }, look: { x: 0, y: 1, z: 0 } }, { pos: { x: -4, y: 2, z: 4 }, look: { x: 0, y: 1, z: 0 } }], 5);
    s.tick(10);
    s.rig.cine.finish(); // cinematic skip
    expect(s.rig.cine.moving).toBe(false);
    s.tick();
    expect(s.rig.camera.position.x).toBeCloseTo(-4, 6);
    expect(() => s.rig.cine.path([], 2)).not.toThrow();
    expect(() => s.rig.cine.path(null as never, 2)).not.toThrow();
    expect(() => s.rig.cine.path([{ pos: { x: NaN, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 } }], 2)).not.toThrow();
  });
});
