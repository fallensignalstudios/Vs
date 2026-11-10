import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import type { Look, LookName } from '@/core/api';
import { DEFAULT_LOOK, L, LOOK_SIZE, LOOKS, LookBlender, mergeLook, packLook, unpackLook } from './looks';

const NAMES: LookName[] = [
  'neutral', 'crash', 'pressureHall', 'survivorBend', 'frozen', 'relay', 'atrium', 'breach', 'gallery', 'crucible',
  'woundGallery', 'core', 'observation', 'hangar', 'witness',
];

function numbers(look: Look): number[] {
  return Array.from(packLook(look));
}

describe('LOOKS presets', () => {
  it('defines every named look with finite, sane values', () => {
    for (const name of NAMES) {
      const look = LOOKS[name];
      expect(look, name).toBeDefined();
      for (const v of numbers(look)) expect(Number.isFinite(v), name).toBe(true);
      expect(look.exposure).toBeGreaterThan(0.5);
      expect(look.exposure).toBeLessThan(2);
      expect(look.fog.density).toBeGreaterThan(0);
      expect(look.fog.density).toBeLessThan(0.05);
      expect(look.bloom.threshold).toBeGreaterThan(0.5);
      expect(look.grade.contrast).toBeGreaterThan(0.8);
      expect(look.vignette).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the zone looks distinct from each other', () => {
    for (let i = 1; i < NAMES.length; i++) {
      for (let j = i + 1; j < NAMES.length; j++) {
        const a = numbers(LOOKS[NAMES[i]]);
        const b = numbers(LOOKS[NAMES[j]]);
        const diff = a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0);
        expect(diff, `${NAMES[i]} vs ${NAMES[j]}`).toBeGreaterThan(0.05);
      }
    }
  });

  it('follows the art direction: frozen is cold, witness is desaturated, core keeps deep blacks', () => {
    const fog = new Color(LOOKS.frozen.fog.color);
    expect(fog.b).toBeGreaterThan(fog.r);
    expect(LOOKS.witness.grade.saturation).toBeLessThan(0.5);
    expect(LOOKS.core.grade.lift).toBeLessThanOrEqual(0);
    expect(LOOKS.core.grade.contrast).toBeGreaterThan(1.1);
  });
});

describe('mergeLook', () => {
  it('overrides only what is given', () => {
    const m = mergeLook(DEFAULT_LOOK, { exposure: 1.4, fog: { density: 0.02 } });
    expect(m.exposure).toBe(1.4);
    expect(m.fog.density).toBe(0.02);
    expect(m.fog.color).toBe(DEFAULT_LOOK.fog.color);
    expect(m.bloom).toEqual(DEFAULT_LOOK.bloom);
    expect(m.bloom).not.toBe(DEFAULT_LOOK.bloom);
  });

  it('ignores garbage instead of throwing', () => {
    const bad = { exposure: Number.NaN, bloom: 'no', grade: { saturation: Infinity, contrast: 1.3 }, nope: 1 } as unknown as Partial<Look>;
    const m = mergeLook(DEFAULT_LOOK, bad);
    expect(m.exposure).toBe(DEFAULT_LOOK.exposure);
    expect(m.bloom).toEqual(DEFAULT_LOOK.bloom);
    expect(m.grade.saturation).toBe(DEFAULT_LOOK.grade.saturation);
    expect(m.grade.contrast).toBe(1.3);
    expect(mergeLook(DEFAULT_LOOK, null)).toEqual(DEFAULT_LOOK);
  });
});

describe('pack / unpack', () => {
  it('round-trips every field', () => {
    for (const name of NAMES) {
      const packed = packLook(LOOKS[name]);
      expect(packed.length).toBe(LOOK_SIZE);
      const back = unpackLook(packed);
      expect(back.fog.color).toBe(LOOKS[name].fog.color);
      expect(back.grade.shadowsTint).toBe(LOOKS[name].grade.shadowsTint);
      expect(back.ambient.ground).toBe(LOOKS[name].ambient.ground);
      expect(back.exposure).toBeCloseTo(LOOKS[name].exposure, 5);
      expect(back.ao.radius).toBeCloseTo(LOOKS[name].ao.radius, 5);
    }
  });
});

describe('LookBlender', () => {
  it('snaps when no blend time is given', () => {
    const b = new LookBlender(LOOKS.neutral);
    b.setTarget(LOOKS.frozen);
    expect(b.blending).toBe(false);
    expect(b.update(0.016)).toBe(true); // dirty once
    expect(b.update(0.016)).toBe(false);
    expect(b.current[L.exposure]).toBeCloseTo(LOOKS.frozen.exposure, 5);
    expect(b.target).toEqual(LOOKS.frozen);
  });

  it('blends every numeric and colour field, colours in linear space', () => {
    const b = new LookBlender(LOOKS.core);
    b.update(0);
    b.setTarget(LOOKS.frozen, 2);
    b.update(1); // halfway; smoothstep(0.5) = 0.5
    const a = packLook(LOOKS.core);
    const z = packLook(LOOKS.frozen);
    for (let i = 0; i < LOOK_SIZE; i++) expect(b.current[i]).toBeCloseTo((a[i] + z[i]) / 2, 5);
    // linear midpoint of the fog colours is brighter than the midpoint of the sRGB hex values
    const lin = new Color().setRGB(b.current[L.fogColor], b.current[L.fogColor + 1], b.current[L.fogColor + 2]);
    const srgbMid = new Color(LOOKS.core.fog.color).lerp(new Color(LOOKS.frozen.fog.color), 0.5);
    expect(lin.b).toBeCloseTo(srgbMid.b, 5); // Color.lerp is linear too — the blend matches three's own maths
    b.update(5);
    expect(b.blending).toBe(false);
    for (let i = 0; i < LOOK_SIZE; i++) expect(b.current[i]).toBeCloseTo(z[i], 5);
  });

  it('retargets mid-blend without a pop', () => {
    const b = new LookBlender(LOOKS.core);
    b.setTarget(LOOKS.relay, 2);
    b.update(0.7);
    const before = b.current[L.exposure];
    b.setTarget(LOOKS.breach, 2);
    expect(b.current[L.exposure]).toBe(before);
    b.update(1e-4);
    expect(Math.abs(b.current[L.exposure] - before)).toBeLessThan(1e-4);
    b.update(10);
    expect(b.current[L.exposure]).toBeCloseTo(LOOKS.breach.exposure, 5);
  });

  it('partial targets accumulate on the previous target', () => {
    const b = new LookBlender(LOOKS.core);
    b.setTarget({ fog: { density: 0.03 } }, 1);
    b.setTarget({ exposure: 1.3 }, 1);
    b.update(2);
    expect(b.target.fog.density).toBe(0.03);
    expect(b.target.exposure).toBe(1.3);
    expect(b.target.grade).toEqual(LOOKS.core.grade);
    expect(b.current[L.fogDensity]).toBeCloseTo(0.03, 6);
  });
});
