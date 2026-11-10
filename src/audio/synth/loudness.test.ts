import { describe, expect, it } from 'vitest';
import { measureLoudness } from './loudness';

const SR = 44100;
const tone = (hz: number, peak: number, seconds: number, total = 1): Float32Array => {
  const a = new Float32Array(Math.floor(total * SR));
  const n = Math.floor(seconds * SR);
  for (let i = 0; i < n; i++) a[i] = peak * Math.sin((2 * Math.PI * hz * i) / SR);
  return a;
};

describe('loudness', () => {
  it('a steady 1 kHz tone reads its RMS (peak − 3 dB) plus the K-weighting gain at 1 kHz', () => {
    const m = measureLoudness([tone(1000, 0.1, 1)], SR);
    expect(m.peakDb).toBeCloseTo(-20, 1);
    expect(m.loudDb).toBeGreaterThan(-23.2);
    expect(m.loudDb).toBeLessThan(-22);
  });

  it('a 5 ms click is much quieter than a sustained sound with the same peak', () => {
    const click = measureLoudness([tone(2000, 0.5, 0.005)], SR);
    const held = measureLoudness([tone(2000, 0.5, 1)], SR);
    expect(click.peakDb).toBeCloseTo(held.peakDb, 0);
    expect(held.loudDb - click.loudDb).toBeGreaterThan(11);
    expect(held.loudDb - click.loudDb).toBeLessThan(15);
  });

  it('weights the ear: sub-bass counts for less, presence for more', () => {
    const sub = measureLoudness([tone(30, 0.3, 1)], SR).loudDb;
    const mid = measureLoudness([tone(500, 0.3, 1)], SR).loudDb;
    const high = measureLoudness([tone(4000, 0.3, 1)], SR).loudDb;
    expect(mid - sub).toBeGreaterThan(2.5);
    expect(high - mid).toBeGreaterThan(2.5);
    expect(high - mid).toBeLessThan(5);
  });

  it('power-averages channels, respects the window, and survives silence', () => {
    const a = tone(1000, 0.2, 1);
    const mono = measureLoudness([a], SR).loudDb;
    expect(measureLoudness([a, a], SR).loudDb).toBeCloseTo(mono, 2);
    expect(measureLoudness([a, new Float32Array(a.length)], SR).loudDb).toBeCloseTo(mono - 3.01, 1);
    expect(measureLoudness([tone(1000, 0.2, 0.2, 1)], SR, 0.5, 1).loudDb).toBeLessThan(-100);
    expect(measureLoudness([new Float32Array(100)], SR)).toEqual({ loudDb: -180, peakDb: -180 });
    expect(measureLoudness([], SR).peakDb).toBe(-180);
  });
});
