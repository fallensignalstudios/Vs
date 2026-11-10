import { describe, expect, it } from 'vitest';
import {
  bearingToEdge, bearingWord, cycle, edgeClamp, fmtDistance, moveFocus, num, pageDurations,
  paginate, poisePips, relAngle, speakerFaction, stepValue, strongerHit, subtitleSeconds,
} from './logic';

describe('relAngle (yaw 0 faces −Z)', () => {
  const north = { x: 0, z: -1 };
  it('is 0 straight ahead and ±π behind', () => {
    expect(relAngle(0, -1, north.x, north.z)).toBeCloseTo(0);
    expect(Math.abs(relAngle(0, 1, north.x, north.z))).toBeCloseTo(Math.PI);
  });
  it('is positive to the right (east when facing north)', () => {
    expect(relAngle(1, 0, north.x, north.z)).toBeCloseTo(Math.PI / 2);
    expect(relAngle(-1, 0, north.x, north.z)).toBeCloseTo(-Math.PI / 2);
  });
  it('follows the camera: facing east, south is to the right', () => {
    expect(relAngle(0, 1, 1, 0)).toBeCloseTo(Math.PI / 2);
    expect(relAngle(1, 0, 1, 0)).toBeCloseTo(0);
  });
  it('never returns NaN for a zero vector', () => {
    expect(relAngle(0, 0, 0, -1)).toBe(0);
  });
});

describe('edge clamping', () => {
  const out = { x: 0, y: 0 };
  it('leaves points inside the safe rect alone', () => {
    expect(edgeClamp(640, 300, 1280, 720, 80, 90, 180, out)).toBe(false);
    expect(out).toEqual({ x: 640, y: 300 });
  });
  it('pulls outside points onto the rect along the ray from the centre', () => {
    expect(edgeClamp(5000, 360, 1280, 720, 80, 90, 180, out)).toBe(true);
    expect(out.x).toBeCloseTo(1200);
    expect(out.y).toBeCloseTo(360);
  });
  it('uses separate top and bottom insets', () => {
    edgeClamp(640, -4000, 1280, 720, 80, 90, 180, out);
    expect(out.y).toBeCloseTo(90);
    edgeClamp(640, 4000, 1280, 720, 80, 90, 180, out);
    expect(out.y).toBeCloseTo(720 - 180);
  });
  it('places unprojectable targets by bearing: behind → bottom edge, right → right edge', () => {
    bearingToEdge(Math.PI, 1280, 720, 80, 90, 180, out);
    expect(out.x).toBeCloseTo(640);
    expect(out.y).toBeCloseTo(540);
    bearingToEdge(Math.PI / 2, 1280, 720, 80, 90, 180, out);
    expect(out.x).toBeCloseTo(1200);
    expect(out.y).toBeCloseTo(360);
    bearingToEdge(-Math.PI * 0.75, 1280, 720, 80, 90, 180, out);
    expect(out.x).toBeLessThan(640);
    expect(out.y).toBeGreaterThan(360);
  });
});

describe('bearing words', () => {
  it('maps eight directions', () => {
    expect(bearingWord(0)).toBe('ahead');
    expect(bearingWord(Math.PI / 4)).toBe('ahead right');
    expect(bearingWord(-Math.PI * 0.75)).toBe('behind left');
    expect(bearingWord(Math.PI / 2)).toBe('right');
    expect(bearingWord(-Math.PI / 2)).toBe('left');
    expect(bearingWord(-Math.PI)).toBe('behind');
    expect(bearingWord(Math.PI * 2 + 0.01)).toBe('ahead');
  });
});

describe('subtitle pagination', () => {
  const fitsChars = (n: number) => (s: string) => s.length <= n;
  it('keeps a short line as a single page', () => {
    expect(paginate('Hold the line.', fitsChars(40))).toEqual(['Hold the line.']);
  });
  it('splits long lines and never loses or reorders words', () => {
    const text = 'Four active references are unbalanced. Doing nothing threatens containment. Completion stabilises the boundary and enables authority.';
    const pages = paginate(text, fitsChars(60));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join(' ')).toBe(text);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(60);
  });
  it('prefers to break on sentence punctuation', () => {
    const pages = paginate('One two three four. Five six seven eight nine ten eleven twelve.', fitsChars(34));
    expect(pages[0]).toBe('One two three four.');
  });
  it('terminates when a single word cannot fit', () => {
    const pages = paginate('Supercalifragilistic word', fitsChars(4));
    expect(pages).toEqual(['Supercalifragilistic', 'word']);
  });
  it('returns nothing for blank text', () => {
    expect(paginate('   ', fitsChars(10))).toEqual([]);
  });
  it('shares the duration across pages by length', () => {
    const d = pageDurations(['aaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaa'], 6);
    expect(d[0]! + d[1]!).toBeCloseTo(6);
    expect(d[0]).toBeGreaterThan(d[1]!);
  });
  it('estimates reading time within bounds', () => {
    expect(subtitleSeconds('Go.')).toBeGreaterThanOrEqual(2.2);
    expect(subtitleSeconds('word '.repeat(80))).toBeLessThanOrEqual(9);
  });
});

describe('formatting + small helpers', () => {
  it('formats distances', () => {
    expect(fmtDistance(0.4)).toBe('<1 m');
    expect(fmtDistance(23.6)).toBe('24 m');
    expect(fmtDistance(187)).toBe('190 m');
    expect(fmtDistance(Number.NaN)).toBe('');
  });
  it('coerces stubs and junk to numbers', () => {
    expect(num(undefined, 3)).toBe(3);
    expect(num('12')).toBe(0);
    expect(num(Number.POSITIVE_INFINITY, 7)).toBe(7);
    expect(num(4.5)).toBe(4.5);
  });
  it('maps poise pools to pip counts', () => {
    expect(poisePips(60)).toBe(6);
    expect(poisePips(35)).toBe(4);
    expect(poisePips(900)).toBe(8);
    expect(poisePips(0)).toBe(3);
  });
  it('ranks simultaneous hit markers', () => {
    expect(strongerHit('hit', 'kill')).toBe('kill');
    expect(strongerHit('weak', 'hit')).toBe('weak');
    expect(strongerHit('blocked', 'hit')).toBe('hit');
  });
  it('identifies speaker factions', () => {
    expect(speakerFaction('Tarrik')).toBe('dominion');
    expect(speakerFaction('Selene')).toBe('reformation');
    expect(speakerFaction('Dominion Command')).toBe('dominion');
    expect(speakerFaction('Reformation Marine')).toBe('reformation');
    expect(speakerFaction('Terminal')).toBe('system');
    expect(speakerFaction('King')).toBe('ancient');
    expect(speakerFaction('Narrator')).toBe('none');
    expect(speakerFaction('Somebody Unknown')).toBe('neutral');
  });
  it('steps settings on a clean grid and clamps', () => {
    expect(stepValue(0.3, 1, 0.1, 0, 1)).toBe(0.4);
    expect(stepValue(0.95, 1, 0.05, 0, 1)).toBe(1);
    expect(stepValue(1, 1, 0.05, 0, 1)).toBe(1);
    expect(stepValue(0.2, -1, 0.1, 0.2, 3)).toBe(0.2);
    expect(stepValue(0.3333, 0, 0.05, 0, 1)).toBe(0.35);
  });
  it('cycles and wraps', () => {
    expect(cycle(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(cycle(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(cycle(['a', 'b', 'c'], 'zzz', 1)).toBe('b');
  });
  it('moves focus over disabled items and wraps', () => {
    const enabled = (i: number) => i !== 1;
    expect(moveFocus(0, 1, 3, enabled)).toBe(2);
    expect(moveFocus(2, 1, 3, enabled)).toBe(0);
    expect(moveFocus(0, -1, 3, enabled)).toBe(2);
    expect(moveFocus(0, 1, 3, () => false)).toBe(0);
    expect(moveFocus(0, 1, 0, () => true)).toBe(-1);
  });
});
