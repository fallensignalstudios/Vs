import { describe, expect, it, vi } from 'vitest';
import type { ScreenPulse } from '@/core/api';
import { PULSES, ScreenFeedback } from './feedback';

const sum = (v: readonly number[]): number => v[0] + v[1] + v[2];

describe('ScreenFeedback pulses', () => {
  it('rises to the requested strength and decays to nothing', () => {
    const f = new ScreenFeedback();
    f.pulse('hit', 1);
    f.update(PULSES.hit.attack + 0.001);
    expect(f.levelOf('hit')).toBeCloseTo(1, 2);
    expect(f.out.active).toBe(true);
    expect(f.out.darken).toBeGreaterThan(0.2);
    expect(f.out.tint[0]).toBeGreaterThan(f.out.tint[1]); // red
    f.update(PULSES.hit.decay);
    expect(f.levelOf('hit')).toBeLessThan(0.12);
    f.update(5);
    expect(f.levelOf('hit')).toBe(0);
    expect(f.out.active).toBe(false);
    expect(sum(f.out.edge)).toBe(0);
  });

  it('gives each kind its own colour', () => {
    const f = new ScreenFeedback();
    const hue = (kind: ScreenPulse): number[] => {
      const g = new ScreenFeedback();
      g.pulse(kind, 1);
      g.update(0.3);
      return [...g.out.edge];
    };
    const frost = hue('frost');
    const cinder = hue('cinder');
    const corruption = hue('corruption');
    expect(frost[2]).toBeGreaterThan(frost[0]);
    expect(cinder[0]).toBeGreaterThan(cinder[2]);
    expect(corruption[2]).toBeGreaterThan(corruption[1]);
    expect(f.out.active).toBe(false);
  });

  it('never lowers a stronger pulse on re-trigger and clamps silly strengths', () => {
    const f = new ScreenFeedback();
    f.pulse('gold', 1);
    f.update(0.5);
    const before = f.levelOf('gold');
    f.pulse('gold', 0.1);
    f.update(0.001);
    expect(f.levelOf('gold')).toBeGreaterThanOrEqual(before * 0.99);
    f.pulse('flash', 1e9);
    f.update(1);
    expect(f.levelOf('flash')).toBeLessThanOrEqual(2);
    f.pulse('flash', Number.NaN);
    f.pulse('flash', -3);
  });

  it('warns once for unknown kinds instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = new ScreenFeedback();
    f.pulse('nope' as ScreenPulse);
    f.pulse('also-nope' as ScreenPulse);
    f.update(0.1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(f.out.active).toBe(false);
    warn.mockRestore();
  });

  it('reduceFlash removes almost all of the full-frame wash and slows the onset', () => {
    const peak = (reduce: boolean): { wash: number; early: number } => {
      const f = new ScreenFeedback();
      f.reduceFlash = reduce;
      f.pulse('flash', 1);
      f.update(0.02);
      const early = f.levelOf('flash');
      f.update(0.07);
      return { wash: sum(f.out.flash), early };
    };
    const normal = peak(false);
    const reduced = peak(true);
    expect(reduced.wash).toBeLessThan(normal.wash * 0.15);
    expect(reduced.early).toBeLessThan(normal.early);
  });

  it('one long step equals many short ones (headless settles)', () => {
    const a = new ScreenFeedback();
    const b = new ScreenFeedback();
    for (const f of [a, b]) {
      f.pulse('cinder', 1);
      f.setCorruption(0.8);
    }
    a.update(0.4);
    for (let i = 0; i < 40; i++) b.update(0.01);
    expect(a.levelOf('cinder')).toBeCloseTo(b.levelOf('cinder'), 2);
    expect(a.out.corruption).toBeCloseTo(b.out.corruption, 2);
  });
});

describe('ScreenFeedback corruption', () => {
  it('eases toward the clamped target and releases', () => {
    const f = new ScreenFeedback();
    f.setCorruption(5);
    f.update(0.1);
    expect(f.out.corruption).toBeGreaterThan(0);
    expect(f.out.corruption).toBeLessThan(1);
    f.update(4);
    expect(f.out.corruption).toBe(1);
    expect(f.out.distort).toBe(1);
    f.setCorruption(Number.NaN);
    f.update(6);
    expect(f.out.corruption).toBe(0);
    expect(f.out.active).toBe(false);
  });

  it('reduceDistortion removes the warp and the fringing but keeps the state readable', () => {
    const f = new ScreenFeedback();
    f.reduceDistortion = true;
    f.setCorruption(1);
    f.pulse('corruption', 1);
    f.update(0.2);
    expect(f.out.corruption).toBeGreaterThan(0.3);
    expect(f.out.distort).toBe(0);
    expect(f.out.chroma).toBe(0);
    expect(f.out.active).toBe(true);
    const g = new ScreenFeedback();
    g.setCorruption(1);
    g.update(0.2);
    expect(f.out.time).toBeLessThan(g.out.time * 0.2);
  });
});
