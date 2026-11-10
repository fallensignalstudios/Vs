import { describe, expect, it } from 'vitest';
import { Pose } from './pose';
import { Locomotion, cycleTime, dutyFactor, stanceTravel, type StanceSet } from './locomotion';
import { compilePose } from './clip';

const idle = compilePose([{}]);
const stance: StanceSet = { idle, walk: idle, run: idle, swing: [1, 1] };

describe('locomotion', () => {
  it('gait tables are monotonic and sane', () => {
    let prevT = Infinity, prevD = Infinity;
    for (let s = 0.3; s <= 7.2; s += 0.3) {
      const T = cycleTime(s), d = dutyFactor(s);
      expect(T).toBeLessThanOrEqual(prevT + 1e-9);
      expect(d).toBeLessThanOrEqual(prevD + 1e-9);
      expect(stanceTravel(s)).toBeLessThanOrEqual(0.9501);
      prevT = T; prevD = d;
    }
    expect(dutyFactor(1.4)).toBeGreaterThan(0.5); // walking: double support
    expect(dutyFactor(2.2)).toBeGreaterThan(0.5);
    expect(dutyFactor(5.2)).toBeLessThan(0.5); // running: flight phase
  });

  for (const speed of [1.4, 2.2, 5.2, 7.2]) {
    it(`planted feet do not skate at ${speed} m/s`, () => {
      const loco = new Locomotion();
      loco.setInput(speed, 0, undefined);
      loco.snap();
      const pose = new Pose();
      const dt = 1 / 240;
      // settle smoothing
      for (let i = 0; i < 240; i++) loco.update(dt);
      let checked = 0;
      let prevZ = NaN, prevPhase = -1;
      for (let i = 0; i < 240 * 3; i++) {
        loco.update(dt);
        loco.evaluate(pose, stance);
        const d = dutyFactor(loco.speed);
        const u = loco.phase / d;
        const z = pose.foot[2];
        // mid-stance of the left foot: flat on the ground, so the ankle must slide back at exactly body speed
        if (u > 0.3 && u < 0.48 && prevPhase >= 0 && loco.phase > prevPhase && Number.isFinite(prevZ)) {
          const v = (z - prevZ) / dt;
          expect(Math.abs(v - loco.speed) / loco.speed).toBeLessThan(0.03);
          expect(pose.foot[1]).toBeLessThan(0.086);
          checked++;
        }
        prevZ = z; prevPhase = loco.phase;
      }
      expect(checked).toBeGreaterThan(20);
    });
  }

  it('feet stay under the body when strafing and backing up', () => {
    const pose = new Pose();
    for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI, 2.3]) {
      const loco = new Locomotion();
      loco.setInput(2.2, yaw, { guarding: true });
      loco.snap();
      for (let i = 0; i < 600; i++) {
        loco.update(1 / 120);
        loco.evaluate(pose, stance);
        for (let k = 0; k < 14; k++) expect(Number.isFinite(pose.foot[k])).toBe(true);
        expect(Math.hypot(pose.foot[0], pose.foot[2])).toBeLessThan(0.95);
        expect(Math.hypot(pose.foot[7], pose.foot[9])).toBeLessThan(0.95);
      }
    }
  });

  it('fires alternating step events', () => {
    const loco = new Locomotion();
    const steps: number[] = [];
    loco.onStep = (s) => steps.push(s);
    loco.setInput(5.2, 0, undefined);
    loco.snap();
    for (let i = 0; i < 360; i++) loco.update(1 / 120);
    expect(steps.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBe(-steps[i - 1]);
  });
});
