/** The voice-over line id: the one function the mission system, the VO generation script and the player share. */
import { describe, expect, it } from 'vitest';
import { canonicalLine, fnv1a32hex, speakerSlug, voLineId } from './voiceId';

describe('voLineId', () => {
  it('hashes with standard FNV-1a 32 over UTF-8', () => {
    expect(fnv1a32hex('')).toBe('811c9dc5');
    expect(fnv1a32hex('a')).toBe('e40c292c');
    expect(fnv1a32hex('foobar')).toBe('bf9cf968');
    // multi-byte: é is C3 A9, 😀 is F0 9F 98 80 — the same bytes TextEncoder produces
    const viaBytes = (s: string): string => {
      let h = 0x811c9dc5;
      for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193);
      return (h >>> 0).toString(16).padStart(8, '0');
    };
    for (const s of ['é', 'naïve façade', '😀 ok', '\ud800 lone']) expect(fnv1a32hex(s)).toBe(viaBytes(s));
  });

  it('has the documented shape: speaker slug, underscore, 8 hex digits', () => {
    expect(voLineId('Tarrik', 'Hold the line.')).toMatch(/^tarrik_[0-9a-f]{8}$/);
    expect(voLineId('Dominion Command', 'Report.')).toMatch(/^dominion_command_[0-9a-f]{8}$/);
    expect(voLineId('_test_', 'x')).toMatch(/^_test__[0-9a-f]{8}$/);
    expect(speakerSlug('Élise  d’Arc')).toBe('elise_d_arc');
    expect(speakerSlug('')).toBe('line');
    expect(voLineId('', '')).toBe(`line_${fnv1a32hex('')}`);
  });

  it('is pinned: these ids must never change (recordings on disk are named by them)', () => {
    expect(canonicalLine('Tarrik', 'Hold the line.')).toBe('tarrikhold the line');
    expect(voLineId('Tarrik', 'Hold the line.')).toBe(`tarrik_${fnv1a32hex('tarrikhold the line')}`);
    expect(voLineId('Tarrik', 'Hold the line.')).toBe('tarrik_40653c06');
    expect(voLineId('Selene', 'Three lanes. They are not guessing.')).toBe('selene_45b7ddea');
    expect(voLineId('Reformation Command', 'Relay A is down — 7,184 aboard.')).toBe('reformation_command_bef6c9dd');
  });

  it('ignores case, spacing and punctuation — and nothing else', () => {
    const id = voLineId('Selene', 'Hold the plane.');
    expect(voLineId('SELENE', '  hold   the\tplane  ')).toBe(id);
    expect(voLineId('Selene', 'Hold the plane!')).toBe(id);
    expect(voLineId('Selene', 'Hold — the “plane”…')).toBe(id);
    expect(voLineId('Selene', 'Hold\nthe plane')).toBe(id);
    expect(voLineId('Selene', 'Hold the planes.')).not.toBe(id);
    expect(voLineId('Tarrik', 'Hold the plane.')).not.toBe(id);
    // composed and decomposed accents are the same line; digits count
    expect(voLineId('Lyric', 'naïve')).toBe(voLineId('Lyric', 'naïve'));
    expect(voLineId('Terminal', '4 of 5')).not.toBe(voLineId('Terminal', '5 of 5'));
  });

  it('never throws on junk', () => {
    const junk = [undefined, null, 42, {}, []] as unknown as string[];
    for (const a of junk) for (const b of junk) expect(voLineId(a, b)).toMatch(/^[a-z0-9_]+_[0-9a-f]{8}$/);
  });
});
