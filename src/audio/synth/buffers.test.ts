import { describe, expect, it } from 'vitest';
import { fillNoise, makeCurve, makeHallIR, ROOMS, STONE_HALL, type NoiseColor, type RoomName } from './buffers';

const SR = 44100;

describe('noise buffers', () => {
  for (const color of ['white', 'pink', 'brown', 'crackle'] as NoiseColor[]) {
    it(`${color}: finite, normalised, no DC, seamless loop`, () => {
      const a = new Float32Array(SR * 2);
      fillNoise(a, color, SR, 11);
      let peak = 0, sum = 0;
      for (const v of a) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
        sum += v;
      }
      expect(peak).toBeGreaterThan(0.9);
      expect(peak).toBeLessThanOrEqual(0.951);
      expect(Math.abs(sum / a.length)).toBeLessThan(0.02);
      if (color === 'brown') {
        // the wrap-around step must be no bigger than an ordinary sample-to-sample step
        let maxStep = 0;
        for (let i = 1; i < a.length; i++) maxStep = Math.max(maxStep, Math.abs(a[i] - a[i - 1]));
        expect(Math.abs(a[0] - a[a.length - 1])).toBeLessThanOrEqual(maxStep * 1.5);
      }
    });
  }

  it('is deterministic per seed', () => {
    const a = new Float32Array(1000), b = new Float32Array(1000), c = new Float32Array(1000);
    fillNoise(a, 'pink', SR, 5);
    fillNoise(b, 'pink', SR, 5);
    fillNoise(c, 'pink', SR, 6);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});

describe('waveshaper curves', () => {
  it('are odd-ish, bounded and monotonic where they should be', () => {
    for (const name of ['soft', 'hard', 'asym', 'ceiling'] as const) {
      const c = makeCurve(name);
      for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1] - 1e-6);
      expect(Math.max(...c)).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(c[(c.length - 1) / 2])).toBeLessThan(1e-6);
    }
  });

  it('ceiling is transparent below the knee and never reaches full scale', () => {
    const c = makeCurve('ceiling');
    const at = (x: number): number => c[Math.round(((x + 1) / 2) * (c.length - 1))];
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.7)).toBeCloseTo(-0.7, 3);
    expect(at(1)).toBeLessThan(0.975);
    expect(at(1)).toBeGreaterThan(0.9);
  });
});

describe('hall impulse', () => {
  const [l, r] = makeHallIR(SR, STONE_HALL, 1);

  it('has unit energy per channel and no NaN', () => {
    for (const ch of [l, r]) {
      let e = 0;
      for (const v of ch) {
        expect(Number.isFinite(v)).toBe(true);
        e += v * v;
      }
      expect(e).toBeCloseTo(1, 3);
    }
  });

  it('starts after the pre-delay, decays, and ends at zero', () => {
    const pre = Math.floor(STONE_HALL.preDelay * SR);
    for (let i = 0; i < pre; i++) expect(l[i]).toBe(0);
    const energy = (from: number, to: number): number => {
      let e = 0;
      for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i++) e += l[i] * l[i];
      return e;
    };
    expect(energy(0.1, 0.6)).toBeGreaterThan(energy(1.0, 1.5) * 3);
    expect(energy(1.0, 1.5)).toBeGreaterThan(energy(2.0, 2.5) * 3);
    expect(Math.abs(l[l.length - 1])).toBe(0);
  });

  it('is decorrelated between channels (stereo width)', () => {
    let lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < l.length; i++) { lr += l[i] * r[i]; ll += l[i] * l[i]; rr += r[i] * r[i]; }
    expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.2);
  });
});

describe('the spaces', () => {
  /** seconds for the impulse's energy to fall 30 dB from its first 20 ms (a T30-style decay time) */
  const decay = (name: RoomName): number => {
    const [l] = makeHallIR(SR, ROOMS[name], 7);
    const win = Math.floor(0.02 * SR);
    const energy: number[] = [];
    for (let p = 0; p + win <= l.length; p += win) {
      let e = 0;
      for (let i = 0; i < win; i++) e += l[p + i] * l[p + i];
      energy.push(e);
    }
    const peak = Math.max(...energy);
    const at = energy.findIndex((e) => e === peak);
    for (let i = at; i < energy.length; i++) if (energy[i] < peak * 1e-3) return (i - at) * 0.02;
    return energy.length * 0.02;
  };

  it('differ in decay time, not just in level: small < hall < vast', () => {
    const small = decay('small'), hall = decay('hall'), vast = decay('vast');
    expect(small).toBeLessThan(0.45);
    expect(hall).toBeGreaterThan(small * 2);
    expect(hall).toBeLessThan(1.3);
    expect(vast).toBeGreaterThan(hall * 1.6);
  });

  it('the vast space answers late (pre-delay) and every impulse has unit energy', () => {
    expect(ROOMS.vast.preDelay).toBeGreaterThanOrEqual(0.05);
    expect(ROOMS.small.preDelay).toBeLessThanOrEqual(0.006);
    for (const name of Object.keys(ROOMS) as RoomName[]) {
      const [l, r] = makeHallIR(SR, ROOMS[name], 3);
      for (const ch of [l, r]) {
        let e = 0;
        for (const v of ch) e += v * v;
        expect(e, name).toBeCloseTo(1, 3);
      }
    }
  });
});
