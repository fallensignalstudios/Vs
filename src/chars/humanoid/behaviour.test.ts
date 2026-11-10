/**
 * Regression tests for the behaviours combat and zone authors rely on: cloth stays attached, blades stay out of
 * their wielder and above the floor, action events always terminate, look / aim are accurate in any pose, feet
 * hold the ground, and the driver / level-of-detail / cache plumbing does what the API promises.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HUMANOID_ACTIONS, type HumanoidArchetype, type HumanoidVisual } from '@/core/api';
import { createHumanoid, humanoidCacheStats, releaseUnusedHumanoids, warmHumanoids } from './index';
import { listActions } from './debug';
import { ARCHETYPES } from './archetypes';
import { getFigure } from './figure';
import { GENERIC } from './clips/generic';

const V = (): THREE.Vector3 => new THREE.Vector3();
const DEG = 180 / Math.PI;
const bone = (v: HumanoidVisual, name: string): THREE.Object3D => v.root.getObjectByName(name)!;
const wpos = (v: HumanoidVisual, name: string): THREE.Vector3 => bone(v, name).getWorldPosition(V());
const run = (v: HumanoidVisual, seconds: number, hz = 60): void => { for (let i = 0, n = Math.round(seconds * hz); i < n; i++) v.update(1 / hz); };

function segSeg(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  let best = Infinity;
  const a = V(), b = V();
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 8; j++) { a.lerpVectors(p1, q1, i / 16); b.lerpVectors(p2, q2, j / 8); best = Math.min(best, a.distanceTo(b)); }
  return best;
}

describe('cloth on the figure', () => {
  const cases: Array<[string, (i: number) => number]> = [
    ['144 Hz', () => 1 / 144], ['jittered 60 Hz', (i) => 1 / 60 + (((i * 7919) % 13) / 13 - 0.5) * 0.003], ['0.2× slow motion', () => 1 / 300],
  ];
  for (const who of ['tarrik', 'selene'] as const) {
    it(`${who}: the cape root never leaves the body, whatever the frame time`, () => {
      const fig = getFigure(who, ARCHETYPES[who], GENERIC, 0, 0);
      const c0 = fig.cloth[0], col = Math.floor(c0.cols / 2);
      const bi = c0.bone0 + col * c0.rows, pi = c0.pin[col], R = fig.spec.rest;
      const off = new THREE.Vector3(R[bi * 3] - R[pi * 3], R[bi * 3 + 1] - R[pi * 3 + 1], R[bi * 3 + 2] - R[pi * 3 + 2]).multiplyScalar(fig.spec.scale);
      for (const [, dtf] of cases) {
        const v = createHumanoid(null, who);
        v.setLocomotion(5.2, 0);
        const bones = (bone(v, 'body') as THREE.SkinnedMesh).skeleton.bones;
        const q = new THREE.Quaternion();
        let worst = 0;
        for (let i = 0; i < 400; i++) {
          const dt = dtf(i);
          v.root.position.z -= 5.2 * dt;
          v.update(dt);
          const want = bones[pi].getWorldPosition(V()).add(off.clone().applyQuaternion(bones[pi].getWorldQuaternion(q)));
          worst = Math.max(worst, bones[bi].getWorldPosition(V()).distanceTo(want));
        }
        expect(worst).toBeLessThan(0.004);
        v.dispose();
      }
    });
  }

  it('does not whip when the figure is placed after creation, frozen, or moved while time is stopped', () => {
    const fig = getFigure('selene', ARCHETYPES.selene, GENERIC, 0, 0);
    const c0 = fig.cloth[0];
    const hemOf = (v: HumanoidVisual): THREE.Vector3 => (bone(v, 'body') as THREE.SkinnedMesh).skeleton.bones[c0.bone0 + Math.floor(c0.cols / 2) * c0.rows + c0.rows - 1].getWorldPosition(V());
    const rel = (v: HumanoidVisual): number => hemOf(v).distanceTo(wpos(v, 'hips'));
    // spawn → position → first tick (the usual order in a zone script)
    for (const x of [0.8, 2.2, 6]) {
      const v = createHumanoid(null, 'selene');
      v.root.position.set(x, 0, -x);
      v.update(1 / 60);
      const d0 = rel(v);
      for (let i = 0; i < 20; i++) { v.update(1 / 60); expect(Math.abs(rel(v) - d0)).toBeLessThan(0.12); }
      v.dispose();
    }
    // arrested, then shoved; and moved by a cinematic while the game clock stands still
    for (const mode of ['frozen', 'paused'] as const) {
      const v = createHumanoid(null, 'selene');
      run(v, 1);
      const d0 = rel(v);
      if (mode === 'frozen') v.setFrozen(1);
      for (let i = 0; i < 30; i++) { v.root.position.x += 0.05; v.update(mode === 'frozen' ? 1 / 60 : 0); }
      expect(Math.abs(rel(v) - d0)).toBeLessThan(0.02);
      v.dispose();
    }
  });
});

describe('weapons respect the body and the floor', () => {
  it('Verity never cuts its wielder: ring grip keeps the blade line off the forearm, blades stay clear of the body', () => {
    const v = createHumanoid(null, 'selene');
    const bones = (bone(v, 'body') as THREE.SkinnedMesh).skeleton.bones;
    const bA = bones.find((b) => b.name === 'bladeA')!, bB = bones.find((b) => b.name === 'bladeB')!;
    let minAngle = 90, angleAt = '', minShown = 1, shownAt = '', worst = 0, worstAt = '';
    const sample = (label: string, frames: number, hz: number, full: boolean): void => {
      for (let i = 0; i < frames; i++) {
        v.update(1 / hz);
        const hand = v.socket('handR').getWorldPosition(V()), t1 = v.socket('weaponTip').getWorldPosition(V()), t2 = v.socket('weaponTip2').getWorldPosition(V());
        const el = wpos(v, 'fArmR'), wr = wpos(v, 'handR');
        let a = Math.acos(Math.max(-1, Math.min(1, wr.clone().sub(el).normalize().dot(t1.clone().sub(hand).normalize())))) * DEG;
        if (a > 90) a = 180 - a;
        const held = bone(v, 'weapon').parent!.name === 'handR';
        if (held && a < minAngle) { minAngle = a; angleAt = label + '@' + i; }
        if (full && Math.min(bA.scale.z, bB.scale.z) < minShown) { minShown = Math.min(bA.scale.z, bB.scale.z); shownAt = label + '@' + i; }
        // the blades as DRAWN (they shorten where they would touch): centre line vs limb axes, minus limb radius
        const caps: Array<[THREE.Vector3, THREE.Vector3, number]> = [
          [wpos(v, 'uArmR'), wpos(v, 'fArmR'), 0.05], [wpos(v, 'fArmR'), wr.clone().lerp(el, 0.25), 0.045], [wpos(v, 'hips'), wpos(v, 'neck'), 0.13],
          [wpos(v, 'head'), wpos(v, 'head').add(new THREE.Vector3(0, 0.12, 0)), 0.1], [wpos(v, 'uArmL'), wpos(v, 'fArmL'), 0.05], [wpos(v, 'fArmL'), wpos(v, 'handL'), 0.045],
          [wpos(v, 'thighR'), wpos(v, 'shinR'), 0.075], [wpos(v, 'thighL'), wpos(v, 'shinL'), 0.075], [wpos(v, 'shinR'), wpos(v, 'footR'), 0.06], [wpos(v, 'shinL'), wpos(v, 'footL'), 0.06],
        ];
        const segs: Array<[THREE.Vector3, THREE.Vector3]> = [
          [hand.clone().lerp(t1, 0.18), hand.clone().lerp(t1, 0.173 + 0.827 * bA.scale.z)], [hand.clone().lerp(t2, 0.18), hand.clone().lerp(t2, 0.173 + 0.827 * bB.scale.z)],
        ];
        if (held) for (const [s0, s1] of segs) for (const [c0, c1, r] of caps) {
          const pen = r - segSeg(s0, s1, c0, c1);
          if (pen > worst) { worst = pen; worstAt = label + '@' + i; }
        }
      }
    };
    run(v, 0.6);
    sample('idle', 60, 60, true);
    v.setLocomotion(2.2, 0); sample('walk', 120, 60, true);
    v.setLocomotion(5.2, 0); sample('run', 120, 60, true);
    v.setLocomotion(7.2, 0, { sprint: true }); sample('sprint', 120, 60, true);
    v.setLocomotion(1.5, Math.PI / 2, { guarding: true }); sample('guard strafe', 120, 60, true);
    v.setLocomotion(0, 0); run(v, 0.8);
    // stances and strikes that must show both blades at (nearly) full length
    for (const a of ['attackLight1', 'attackHeavy', 'attackHeavyCharge', 'guard', 'deflect', 'counter', 'dispatch', 'dodge', 'dodgeBack', 'dodgeLeft', 'dodgeRight', 'tetherStop', 'lowerWeapon', 'stagger']) {
      v.stop(); run(v, 0.4);
      const info = v.play(a);
      sample(a, Math.round(Math.min(info.duration > 0 ? info.duration + 0.2 : 1, 1.4) * 120), 120, true);
    }
    expect(minShown, 'shortest drawn blade, at ' + shownAt).toBeGreaterThan(0.85);
    // the light combo as it is really played (each cancelled into the next), then everything else she can do
    v.stop(); run(v, 0.4);
    for (const a of ['attackLight1', 'attackLight2', 'attackLight3', 'attackLight4']) { const info = v.play(a); sample('combo ' + a, Math.round(info.duration * 0.7 * 120), 120, false); }
    for (const a of new Set([...HUMANOID_ACTIONS, ...listActions('selene')])) {
      v.stop(); run(v, 0.3);
      const info = v.play(a);
      sample(a, Math.round(Math.min(info.duration > 0 ? info.duration : 0.8, 1.2) * 60), 60, false);
    }
    expect(minAngle, 'blade line closest to the forearm, at ' + angleAt).toBeGreaterThan(55);
    expect(worst, 'deepest blade penetration, at ' + worstAt).toBeLessThan(0.015);
    v.dispose();
  }, 120000);

  it('hands, feet and held blades stay above the floor in every action', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const who of ['tarrik', 'selene', 'enforcer', 'linkbound', 'tharne'] as HumanoidArchetype[]) {
      const v = createHumanoid(null, who);
      const s = v.height / 1.85;
      const feet = ['toeL', 'toeR', 'footL', 'footR'].map((n) => bone(v, n)), hands = ['handL', 'handR'].map((n) => bone(v, n));
      const tips = [v.socket('weaponTip'), v.socket('weaponTip2')];
      const blades = who === 'selene' ? [bone(v, 'bladeA'), bone(v, 'bladeB')] : [null, null];
      const p = V();
      const bad: string[] = [];
      for (const act of new Set([...HUMANOID_ACTIONS, ...listActions(who)])) {
        v.stop(); run(v, 0.3);
        const info = v.play(act);
        let minFoot = 9, minHand = 9, minTip = 9;
        for (let i = 0, n = Math.round(Math.min(info.duration > 0 ? info.duration + 0.3 : 1.5, 2.6) * 60); i < n; i++) {
          v.update(1 / 60);
          for (const f of feet) minFoot = Math.min(minFoot, f.getWorldPosition(p).y);
          for (const h of hands) minHand = Math.min(minHand, h.getWorldPosition(p).y);
          // only a weapon that is in the hand (or lying where it fell) is expected to respect the floor
          if (bone(v, 'weapon').scale.x > 0.5 && bone(v, 'weapon').parent!.name !== 'chest' && bone(v, 'weapon').parent!.name !== 'hips') {
            // energy blades are measured as drawn: they shorten on the floor instead of entering it
            const grip = v.socket('handR').getWorldPosition(V());
            tips.forEach((t, k) => {
              if (t === v.root) return;
              const drawn = blades[k] ? 0.173 + 0.827 * blades[k]!.scale.z : 1;
              minTip = Math.min(minTip, bone(v, 'weapon').parent!.name === 'handR' ? grip.clone().lerp(t.getWorldPosition(p), blades[k] ? drawn : 1).y : t.getWorldPosition(p).y);
            });
          }
        }
        if (minFoot < 0.015 * s || minHand < 0.01 * s || minTip < -0.005) bad.push(`${who}.${act}: foot ${minFoot.toFixed(3)} hand ${minHand.toFixed(3)} tip ${minTip.toFixed(3)}`);
      }
      expect(bad).toEqual([]);
      v.dispose();
    }
    warn.mockRestore();
  }, 120000);

  it('a dying hand lets the weapon fall flat; stop() puts it back', () => {
    const t = createHumanoid(null, 'tarrik');
    run(t, 0.5);
    t.play('death');
    run(t, 2.2);
    const tip = t.socket('weaponTip').getWorldPosition(V()), base = t.socket('weaponBase').getWorldPosition(V());
    expect(tip.y).toBeGreaterThan(0);
    expect(tip.y).toBeLessThan(0.08);
    expect(base.y).toBeLessThan(0.08);
    expect(base.distanceTo(t.socket('handR').getWorldPosition(V()))).toBeGreaterThan(0.15);
    t.stop();
    run(t, 0.6);
    expect(t.socket('weaponBase').getWorldPosition(V()).distanceTo(t.socket('handR').getWorldPosition(V()))).toBeLessThan(0.2);
  });
});

describe('action bookkeeping', () => {
  it('a kill while frozen still plays and ends; frozen is released by the next action', () => {
    for (const how of ['pose', 'stasis'] as const) {
      const v = createHumanoid(null, 'linkbound');
      run(v, 0.3);
      if (how === 'pose') v.play('frozen'); else v.setFrozen(1);
      const y0 = wpos(v, 'hips').y;
      run(v, 0.5);
      expect(Math.abs(wpos(v, 'hips').y - y0)).toBeLessThan(1e-3);
      const ev: string[] = [];
      const info = v.play('death', { onEvent: (n) => ev.push(n) });
      run(v, info.duration + 0.2);
      expect(ev).toContain('end');
      expect(wpos(v, 'hips').y).toBeLessThan(0.4);
      expect(v.isPlaying('frozen')).toBe(false);
      expect(v.isPlaying('death')).toBe(true);
      expect(v.isPlaying()).toBe(false);
    }
  });

  it('every one-shot ends with exactly one of end / cancel', () => {
    const v = createHumanoid(null, 'tarrik');
    const ev: string[] = [];
    v.play('attackLight1', { onEvent: (n) => ev.push('a:' + n) });
    run(v, 0.1);
    v.play('dodge', { onEvent: (n) => ev.push('b:' + n) });
    run(v, 1);
    v.play('attackHeavy', { onEvent: (n) => ev.push('c:' + n) });
    run(v, 0.1);
    v.stop();
    run(v, 0.5);
    v.play('hitLight', { onEvent: (n) => ev.push('d:' + n) });
    run(v, 0.5);
    const terminal = (k: string): string[] => ev.filter((e) => e === k + ':end' || e === k + ':cancel');
    expect(terminal('a')).toEqual(['a:cancel']);
    expect(terminal('b')).toEqual(['b:end']);
    expect(terminal('c')).toEqual(['c:cancel']);
    expect(terminal('d')).toEqual(['d:end']);
  });

  it('death is final until stop(); seated figures stay seated through gestures', () => {
    const v = createHumanoid(null, 'tarrik');
    v.play('death'); run(v, 2);
    const ev: string[] = [];
    v.play('throw', { onEvent: (n) => ev.push(n) });
    v.play('attackLight1');
    v.setLocomotion(5, 0);
    run(v, 1);
    expect(ev).toEqual(['cancel']);
    expect(wpos(v, 'hips').y).toBeLessThan(0.4);
    v.stop(); v.setLocomotion(0, 0); run(v, 1);
    expect(wpos(v, 'hips').y).toBeGreaterThan(0.8);

    const t = createHumanoid(null, 'tharne');
    t.play('sit'); run(t, 1.5);
    const seat = wpos(t, 'hips').y;
    expect(seat).toBeLessThan(0.65);
    for (const a of ['talk', 'nod', 'handOver', 'receive', 'point', 'listen', 'assent']) {
      t.play(a); run(t, 0.8);
      expect(Math.abs(wpos(t, 'hips').y - seat), a).toBeLessThan(0.03);
    }
    expect(t.isPlaying('sit')).toBe(true);
    t.stop('sit'); run(t, 1);
    expect(wpos(t, 'hips').y).toBeGreaterThan(0.85);
  });

  it('a charged heavy releases from the coil: no rewind, hit within 0.1–0.2 s', () => {
    for (const who of ['tarrik', 'selene'] as const) {
      const v = createHumanoid(null, who);
      run(v, 0.5);
      const full = v.info('attackHeavy');
      v.play('attackHeavyCharge'); run(v, 1);
      const tip = v.socket('weaponTip');
      const before = tip.getWorldPosition(V());
      const info = v.play('attackHeavy');
      expect(info.duration).toBeLessThan(full.duration - 0.05);
      expect(info.hitTimes[0]).toBeGreaterThan(0.09);
      expect(info.hitTimes[0]).toBeLessThan(0.2);
      expect(v.info('attackHeavy').duration).toBeCloseTo(full.duration, 5); // the charge pose is released by the swing
      v.update(1 / 120); v.update(1 / 120); v.update(1 / 120);
      expect(tip.getWorldPosition(V()).distanceTo(before)).toBeLessThan(0.3);
      run(v, info.duration + 0.4);
      expect(v.isPlaying('attackHeavyCharge')).toBe(false);
      expect(v.isPlaying()).toBe(false);
    }
  });

  it('dodge picks its direction; hit reactions shove the body the way they are told', () => {
    const v = createHumanoid(null, 'selene');
    run(v, 0.3);
    const lean = (dir: number | undefined, moveYaw = 0): THREE.Vector3 => {
      v.stop(); v.setLocomotion(0, moveYaw); run(v, 0.5);
      const h0 = wpos(v, 'hips');
      v.play('dodge', dir === undefined ? undefined : { dir });
      run(v, 0.16);
      return wpos(v, 'hips').sub(h0);
    };
    // figure faces −Z, its left is −X
    expect(lean(Math.PI / 2).x).toBeLessThan(-0.05);
    expect(lean(-Math.PI / 2).x).toBeGreaterThan(0.05);
    expect(lean(Math.PI).z).toBeGreaterThan(0.03);
    v.stop(); run(v, 0.5);
    const c0 = wpos(v, 'head');
    v.play('hitHeavy', { dir: Math.PI / 2 });
    run(v, 0.1);
    expect(wpos(v, 'head').x - c0.x).toBeLessThan(-0.01);
  });
});

describe('look and aim', () => {
  it('looks at the target from any pose and lets go behind', () => {
    const v = createHumanoid(null, 'tharne');
    const eye = v.socket('eye');
    const err = (target: THREE.Vector3): number => {
      v.lookAt(target); run(v, 2);
      const p = eye.getWorldPosition(V()), dir = eye.getWorldDirection(V()).negate();
      return dir.angleTo(target.clone().sub(p)) * DEG;
    };
    expect(err(new THREE.Vector3(0, 1.62, -2))).toBeLessThan(3);
    expect(err(new THREE.Vector3(-1.41, 1.62, -1.41))).toBeLessThan(3);
    expect(err(new THREE.Vector3(0, 0.2, -1.5))).toBeLessThan(4);
    v.play('sit'); run(v, 2);
    expect(err(new THREE.Vector3(0, 1.2, -1.7))).toBeLessThan(3);
    v.play('kneelTend'); run(v, 2);
    expect(err(new THREE.Vector3(0.3, 0.9, -1.2))).toBeLessThan(4);
    v.stop(); run(v, 1);
    // a target walking past directly behind: the head never whips from one shoulder to the other
    const dir = V();
    let prev = 0, jump = 0;
    for (let i = 0; i < 120; i++) {
      const a = Math.PI - 0.5 + (i / 120);
      v.lookAt(new THREE.Vector3(-Math.sin(a) * 2, 1.6, -Math.cos(a) * 2));
      v.update(1 / 60);
      eye.getWorldDirection(dir).negate();
      const yaw = Math.atan2(-dir.x, -dir.z) * DEG;
      if (i > 0) jump = Math.max(jump, Math.abs(yaw - prev));
      prev = yaw;
    }
    expect(jump).toBeLessThan(6);
    expect(Math.abs(prev)).toBeLessThan(25);
  });

  it('the muzzle points where setAimPitch asked', () => {
    for (const who of ['tarrik', 'selene', 'lyessa', 'reformationSoldier'] as HumanoidArchetype[]) {
      const v = createHumanoid(null, who);
      v.setLoadout({ ranged: true });
      v.setLocomotion(0, 0, { aiming: true });
      const mz = v.socket('muzzle'), dir = V();
      for (const pitch of [0, 0.35, -0.35, 0.7]) {
        v.setAimPitch(pitch); run(v, 1.2);
        mz.getWorldDirection(dir).negate();
        expect(Math.abs(Math.asin(dir.y) - pitch) * DEG, `${who} @ ${pitch}`).toBeLessThan(2);
      }
      v.setAimPitch(0); v.setLocomotion(2.2, 0, { aiming: true }); run(v, 1);
      for (let i = 0; i < 90; i++) { v.root.position.z -= 2.2 / 60; v.update(1 / 60); mz.getWorldDirection(dir).negate(); expect(Math.abs(Math.asin(dir.y)) * DEG).toBeLessThan(3); }
      v.dispose();
    }
  });
});

describe('feet', () => {
  /** total distance grounded toes slide over the floor while the driver runs `drive` */
  function slide(who: HumanoidArchetype, drive: (t: number) => { speed: number; yaw: number; move: number; report?: number }, seconds: number): number {
    const v = createHumanoid(null, who);
    v.setLoadout({ melee: false, ranged: false });
    const dt = 1 / 120, s = v.height / 1.85;
    const toes = [bone(v, 'toeL'), bone(v, 'toeR')];
    const prev = [V(), V()], was = [false, false], p = V();
    let total = 0;
    run(v, 0.5, 120);
    for (let i = 0, n = Math.round(seconds / dt); i < n; i++) {
      const d = drive(i * dt);
      v.root.rotation.y = d.yaw;
      const a = d.yaw + d.move;
      v.root.position.x += -Math.sin(a) * d.speed * dt; v.root.position.z += -Math.cos(a) * d.speed * dt;
      v.setLocomotion(d.report ?? d.speed, d.move);
      v.update(dt);
      for (let k = 0; k < 2; k++) {
        toes[k].getWorldPosition(p);
        const down = p.y < 0.04 * s;
        if (down && was[k]) total += Math.hypot(p.x - prev[k].x, p.z - prev[k].z);
        prev[k].copy(p); was[k] = down;
      }
    }
    v.dispose();
    return total;
  }

  it('hold the ground through a start and a stop', () => {
    const ramp = (t: number): number => (t < 0.3 ? 0 : t < 0.7 ? ((t - 0.3) / 0.4) * 5.2 : t < 1.7 ? 5.2 : t < 2.0 ? (1 - (t - 1.7) / 0.3) * 5.2 : 0);
    expect(slide('tarrik', (t) => ({ speed: ramp(t), yaw: 0, move: 0 }), 2.8)).toBeLessThan(0.75);
    expect(slide('selene', (t) => ({ speed: ramp(t), yaw: 0, move: 0 }), 2.8)).toBeLessThan(0.6);
  });

  it('step instead of swivelling when turned on the spot', () => {
    // 3 rad/s for 2 s swept each foot through ~0.7 m of arc before feet were planted in world space
    expect(slide('tarrik', (t) => ({ speed: 0, yaw: t * 3, move: 0 }), 2)).toBeLessThan(0.6);
  });

  it('stop cycling when the body is blocked', () => {
    // runs for a second, then hits a wall: the driver keeps reporting 5.2 m/s but the root no longer moves
    expect(slide('tarrik', (t) => ({ speed: t < 1 ? 5.2 : 0, yaw: 0, move: 0, report: 5.2 }), 2.5)).toBeLessThan(0.45);
  });

  it('stay planted through a running turn', () => {
    expect(slide('tarrik', (t) => ({ speed: 5.2, yaw: t * 2, move: 0 }), 3)).toBeLessThan(0.7);
  });
});

describe('levels of detail, drivers and the cache', () => {
  it('culls with a generous fixed bound instead of a CPU-skinned one', () => {
    const v = createHumanoid(null, 'tarrik');
    v.update(1 / 60);
    let n = 0;
    v.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      n++;
      expect(m.boundingSphere).not.toBeNull();
      expect(m.boundingSphere!.radius).toBeGreaterThanOrEqual(3);
      expect(m.boundingBox).not.toBeNull();
    });
    expect(n).toBeGreaterThan(0);
    // dead on the floor, sword beside it: everything is still inside the bound
    v.play('death'); run(v, 2.5);
    const body = bone(v, 'body') as THREE.SkinnedMesh;
    const centre = body.boundingSphere!.center.clone().applyMatrix4(body.matrixWorld);
    const r = body.boundingSphere!.radius * (v.height / ARCHETYPES.tarrik.proportions(() => 0, 0).height) * (v.height / 1.85);
    for (const name of ['weaponTip', 'head', 'handL']) expect(v.socket(name).getWorldPosition(V()).distanceTo(centre)).toBeLessThan(r);
  });

  it('builds lower levels of detail on the same skeleton and casts its shadow from the cheapest', () => {
    for (const who of ['tarrik', 'enforcer', 'linkbound', 'survivor'] as HumanoidArchetype[]) {
      const fig = getFigure(who, ARCHETYPES[who], GENERIC, 0, 0);
      expect(fig.lods.length).toBe(2);
      const tris = [fig.geometry!, ...fig.lods].map((g) => g.index!.count / 3);
      expect(tris[1]).toBeLessThan(tris[0] * 0.6);
      expect(tris[2]).toBeLessThan(tris[0] * 0.32);
      const maxBone = (g: THREE.BufferGeometry): number => { const a = g.getAttribute('skinIndex'); let m = 0; for (let i = 0; i < a.count; i++) m = Math.max(m, a.getX(i), a.getY(i), a.getZ(i), a.getW(i)); return m; };
      for (const g of fig.lods) expect(maxBone(g)).toBeLessThan(fig.spec.names.length);
      const v = createHumanoid(null, who);
      const casters: string[] = [];
      v.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow) casters.push(o.name); });
      expect(casters).toEqual(['shadow']);
      expect(((bone(v, 'shadow') as THREE.Mesh).geometry.index!.count / 3)).toBe(tris[2]);
      v.dispose();
    }
  });

  it('driverOnly builds no body but animates, exposes sockets and simulates cloth', () => {
    const full = createHumanoid(null, 'tarrik');
    const d = createHumanoid(null, 'tarrik', { driverOnly: true });
    expect(d.triangles).toBe(0);
    let meshes = 0, bones = 0, fullBones = 0;
    d.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; if ((o as THREE.Bone).isBone) bones++; });
    full.root.traverse((o) => { if ((o as THREE.Bone).isBone) fullBones++; });
    expect(meshes).toBe(0);
    expect(bones).toBe(fullBones);
    for (const v of [full, d]) { v.play('attackLight1'); run(v, 0.25); }
    for (const s of ['weaponTip', 'handL', 'head', 'hips']) expect(d.socket(s).getWorldPosition(V()).distanceTo(full.socket(s).getWorldPosition(V()))).toBeLessThan(1e-4);
    expect(d.root.getObjectByName('cape_3_6')!.getWorldPosition(V()).distanceTo(full.root.getObjectByName('cape_3_6')!.getWorldPosition(V()))).toBeLessThan(1e-3);
    const k = createHumanoid(null, 'tarrik', { driverOnly: true, keep: ['cloth', 'melee'] });
    expect(k.triangles).toBeGreaterThan(500);
    expect(k.triangles).toBeLessThan(8000);
  });

  it('shares geometry across seeds and frees what nobody uses', () => {
    releaseUnusedHumanoids();
    const base = humanoidCacheStats().figures, held = humanoidCacheStats().referenced;
    const squad = Array.from({ length: 12 }, (_, i) => createHumanoid(null, 'survivor', { seed: i + 1 }));
    const geos = new Set(squad.map((v) => (bone(v, 'body') as THREE.Mesh).geometry));
    expect(geos.size).toBeLessThanOrEqual(6);
    expect(new Set(squad.map((v) => v.height.toFixed(3))).size).toBeGreaterThan(6);
    let disposed = 0;
    for (const g of geos) g.addEventListener('dispose', () => disposed++);
    for (const v of squad) v.dispose();
    expect(humanoidCacheStats().referenced).toBe(held);
    expect(releaseUnusedHumanoids()).toBeGreaterThanOrEqual(geos.size);
    expect(disposed).toBe(geos.size);
    expect(humanoidCacheStats().figures).toBeLessThanOrEqual(base);
    warmHumanoids(['linkbound'], [0, 1, 2, 3]);
    const t0 = performance.now();
    createHumanoid(null, 'linkbound', { seed: 2 }).dispose();
    expect(performance.now() - t0).toBeLessThan(25);
  });

  it('skips posing and cloth while invisible but keeps the clocks running', () => {
    const v = createHumanoid(null, 'tarrik');
    run(v, 0.3);
    v.setVisible(false);
    const ev: string[] = [];
    v.play('attackLight1', { onEvent: (n) => ev.push(n) });
    const hand = wpos(v, 'handR');
    run(v, 1);
    expect(ev).toEqual(['step', 'hit', 'end']);
    expect(wpos(v, 'handR').distanceTo(hand)).toBeLessThan(1e-6);
    v.setVisible(true); v.setLocomotion(3, 0); run(v, 0.5);
    expect(wpos(v, 'handR').distanceTo(hand)).toBeGreaterThan(0.01);
  });
});
