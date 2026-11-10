import { describe, expect, it } from 'vitest';
import { ch, chordAt, cycleBars, layerGain, mtof, openVoicing, parsePattern, tierFor, voicing } from './theory';

describe('music theory', () => {
  it('converts MIDI to Hz', () => {
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(57)).toBeCloseTo(220, 6);
    expect(mtof(38)).toBeCloseTo(73.416, 2);
  });

  it('voices chords upward from a floor, staying in register', () => {
    // D minor from D3 (50): D3 F3 A3
    expect(voicing(38, ch(0, 'm'), 50, 3)).toEqual([50, 53, 57]);
    // Bb major from the same floor: D3 F3 Bb3 (smooth voice leading: common tones stay)
    expect(voicing(38, ch(8, 'M'), 50, 3)).toEqual([50, 53, 58]);
    // an open fifth never contains a third
    const open = voicing(38, ch(0, '5'), 50, 4).map((m) => (m - 38) % 12);
    expect(open.every((pc) => pc === 0 || pc === 7)).toBe(true);
  });

  it('keeps low-register voicings open (no thirds or seconds in the bottom octave)', () => {
    expect(openVoicing(38, ch(0, 'm'), 38, 2)).toEqual([38, 45]); // D2 A2
    expect(openVoicing(38, ch(0, 'm'), 38, 4)).toEqual([38, 45, 50, 53]); // D2 A2 D3 F3
    expect(openVoicing(38, ch(8, 'M'), 38, 3)).toEqual([46, 53, 58]); // Bb2 F3 Bb3
    expect(openVoicing(37, ch(0, 'b2'), 37, 4)).toEqual([37, 44, 49, 50]); // C#2 G#2 C#3 D3: the rub sits an octave up
    expect(openVoicing(37, ch(6, 'tri'), 37, 2)).toEqual([43, 49]);
    expect(openVoicing(38, ch(7, '5'), 38, 1)).toEqual([45]);
  });

  it('walks a chord cycle by bar', () => {
    const cycle = [ch(0, 'm', 2), ch(8, 'M', 1), ch(7, '5', 1)];
    expect(cycleBars(cycle)).toBe(4);
    expect(chordAt(cycle, 0)).toMatchObject({ index: 0, first: true, barsLeft: 2 });
    expect(chordAt(cycle, 1)).toMatchObject({ index: 0, first: false, barsLeft: 1 });
    expect(chordAt(cycle, 2)).toMatchObject({ index: 1, first: true });
    expect(chordAt(cycle, 3)).toMatchObject({ index: 2, first: true });
    expect(chordAt(cycle, 4)).toMatchObject({ index: 0, first: true });
    expect(chordAt(cycle, 4001).index).toBe(0);
  });

  it('parses step patterns', () => {
    expect(parsePattern('X.xo')).toEqual([1, 0, 0.72, 0.42]);
    expect(parsePattern('X... x... | o...')).toHaveLength(12);
    expect(parsePattern('')).toEqual([]);
  });

  it('picks pattern tiers by intensity', () => {
    expect(tierFor(1, 0.9)).toBe(0);
    expect(tierFor(3, 0)).toBe(0);
    expect(tierFor(3, 0.5)).toBe(1);
    expect(tierFor(3, 1)).toBe(2);
    expect(tierFor(2, 0.49)).toBe(0);
    expect(tierFor(2, 0.51)).toBe(1);
  });

  it('cross-fades layer gain over an intensity window', () => {
    expect(layerGain(0.4, undefined, 0.9)).toBe(0.4);
    expect(layerGain([0, 1], undefined, 0)).toBe(0);
    expect(layerGain([0, 1], undefined, 1)).toBe(1);
    expect(layerGain([0, 1], undefined, 0.5)).toBeCloseTo(0.5, 6);
    expect(layerGain([0, 0.4], [0.5, 0.9], 0.4)).toBe(0);
    expect(layerGain([0, 0.4], [0.5, 0.9], 0.95)).toBeCloseTo(0.4, 6);
    expect(layerGain([0.3, 0.1], undefined, 1)).toBeCloseTo(0.1, 6);
  });
});
