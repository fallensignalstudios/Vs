/**
 * Voice-over line ids — THE single source of truth shared by the mission system, the VO generation script
 * and the player. A recorded line lives at `public/audio/vo/<lineId>.mp3` and is listed in
 * `public/audio/vo/manifest.json` as `{ "<lineId>": { "file": "<lineId>.mp3", "seconds": 2.84 } }`.
 *
 *   lineId = speakerSlug(speaker) + '_' + fnv1a32hex(canonicalLine(speaker, text))
 *
 * This file is deliberately free of imports and of non-erasable TypeScript, so a node script can load it
 * directly (`node --experimental-strip-types`, tsx, vite-node) instead of re-implementing it.
 *
 * The exact recipe (for a port to another language):
 *  1. `key = trim(speaker) + '|' + trim(text)`, Unicode-normalised (NFKC) and lower-cased;
 *  2. every whitespace character becomes a space; THEN everything that is not a letter, a digit or a space
 *     is removed (the `|`, punctuation, quotes, dashes, combining marks…); THEN runs of spaces collapse to
 *     one and the ends are trimmed — in that order, so a free-standing dash leaves one space, not two;
 *  3. FNV-1a, 32 bit, over the UTF-8 bytes of the result, as 8 lower-case hex digits;
 *  4. prefix: the speaker lower-cased with accents folded to their base letter (NFKD, combining marks
 *     dropped) and every run of characters outside `a-z0-9` replaced by one `_` (`line` if nothing is left).
 * Punctuation, case and spacing therefore never change an id: a re-punctuated subtitle keeps its recording.
 * `assets.test.ts` pins reference ids — a port must reproduce them:
 *   voLineId('Tarrik', 'Hold the line.')                                     → tarrik_40653c06
 *   voLineId('Selene', 'Three lanes. They are not guessing.')                → selene_45b7ddea
 *   voLineId('Reformation Command', 'Relay A is down — 7,184 aboard.')       → reformation_command_bef6c9dd
 */

/** File-system-safe tag for a speaker: `'Dominion Command'` → `dominion_command`. */
export function speakerSlug(speaker: string): string {
  const s = String(speaker ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return s.length ? s : 'line';
}

/** The text that is hashed: lower-case letters, digits and single spaces of `speaker|text`. */
export function canonicalLine(speaker: string, text: string): string {
  return `${String(speaker ?? '').trim()}|${String(text ?? '').trim()}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s/gu, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
}

/** FNV-1a (32 bit) of the UTF-8 encoding of `s`, as 8 lower-case hex digits. */
export function fnv1a32hex(s: string): string {
  let h = 0x811c9dc5;
  const eat = (byte: number): void => {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    // surrogate pair → one code point (a lone surrogate encodes as U+FFFD, like TextEncoder)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) eat(c);
    else if (c < 0x800) {
      eat(0xc0 | (c >> 6));
      eat(0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      eat(0xe0 | (c >> 12));
      eat(0x80 | ((c >> 6) & 0x3f));
      eat(0x80 | (c & 0x3f));
    } else {
      eat(0xf0 | (c >> 18));
      eat(0x80 | ((c >> 12) & 0x3f));
      eat(0x80 | ((c >> 6) & 0x3f));
      eat(0x80 | (c & 0x3f));
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Id of the recording of `text` spoken by `speaker`, e.g. `voLineId('Tarrik', 'Hold the line.')` →
 * `tarrik_xxxxxxxx`. Stable under changes of case, spacing and punctuation.
 */
export function voLineId(speaker: string, text: string): string {
  return `${speakerSlug(speaker)}_${fnv1a32hex(canonicalLine(speaker, text))}`;
}
