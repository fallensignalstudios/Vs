/**
 * Is this file really a usable audio clip? Checked on the compressed bytes, before anything is decoded, so a
 * listed voice-over line whose file is broken (an empty file, an error page or JSON body saved as .mp3, a
 * cut-off download) is known to have no recording BEFORE its subtitle goes up — the line then gets the
 * ordinary reading time instead of holding the screen for the manifest's length in silence.
 *
 * MP3 (what the voice-over is) is walked frame by frame: every MPEG audio frame header gives the frame's
 * length and sample count, so the walk both proves the stream is intact and measures its duration without
 * decoding. Other containers a browser can decode (Ogg, WAV, FLAC, MP4/M4A, ADTS AAC) are accepted on their
 * signature.
 */

/** [MPEG-1, MPEG-2, MPEG-2.5] sample rates by index */
const RATES: Readonly<Record<number, readonly number[]>> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
/** kbit/s by [version 1 | 2/2.5][layer 1..3][index] */
const KBPS_V1: readonly (readonly number[])[] = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
];
const KBPS_V2: readonly (readonly number[])[] = [
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];

interface Frame {
  length: number;
  samples: number;
  rate: number;
}

/** The MPEG audio frame whose header starts at `i`, or null. */
function frameAt(b: Uint8Array, i: number): Frame | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5, 1 = reserved
  const layerBits = (b[i + 1] >> 1) & 3; // 3 = layer I, 2 = II, 1 = III, 0 = reserved
  const bri = (b[i + 2] >> 4) & 15;
  const sri = (b[i + 2] >> 2) & 3;
  if (version === 1 || layerBits === 0 || bri === 0 || bri === 15 || sri === 3) return null;
  const layer = 4 - layerBits; // 1..3
  const rate = RATES[version][sri];
  const kbps = (version === 3 ? KBPS_V1 : KBPS_V2)[layer - 1][bri];
  const pad = (b[i + 2] >> 1) & 1;
  let length: number;
  let samples: number;
  if (layer === 1) {
    length = (Math.floor((12000 * kbps) / rate) + pad) * 4;
    samples = 384;
  } else {
    const perFrame = layer === 3 && version !== 3 ? 576 : 1152;
    length = Math.floor(((perFrame / 8) * kbps * 1000) / rate) + pad;
    samples = perFrame;
  }
  return length >= 21 ? { length, samples, rate } : null;
}

/**
 * Duration (s) of an MPEG audio stream, by walking its frames; −1 when the bytes are not one. A leading ID3v2
 * tag and a little junk before the first frame are skipped; the walk ends at the first byte that is not a
 * frame (a trailing ID3v1 / APE tag, or where a cut-off file stops).
 */
export function mpegDuration(bytes: ArrayBuffer | Uint8Array): number {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let i = 0;
  // ID3v2: "ID3", version (2), flags, size as four 7-bit bytes; +10 more when a footer is flagged
  while (i + 10 <= b.length && b[i] === 0x49 && b[i + 1] === 0x44 && b[i + 2] === 0x33) {
    const size = ((b[i + 6] & 0x7f) << 21) | ((b[i + 7] & 0x7f) << 14) | ((b[i + 8] & 0x7f) << 7) | (b[i + 9] & 0x7f);
    i += 10 + size + (b[i + 5] & 0x10 ? 10 : 0);
  }
  // the first frame: a header that is followed by another header where its length says (or the end of file)
  const limit = Math.min(b.length, i + 4096);
  let start = -1;
  for (let j = i; j < limit; j++) {
    const f = frameAt(b, j);
    if (!f) continue;
    if (j + f.length === b.length || frameAt(b, j + f.length)) {
      start = j;
      break;
    }
  }
  if (start < 0) return -1;
  let samples = 0;
  let rate = 0;
  let frames = 0;
  let at = start;
  while (at < b.length) {
    const f = frameAt(b, at);
    if (!f || at + f.length > b.length) break;
    samples += f.samples;
    rate = f.rate;
    frames++;
    at += f.length;
  }
  return frames >= 2 && rate > 0 ? samples / rate : -1;
}

const ascii = (b: Uint8Array, at: number, s: string): boolean => {
  for (let k = 0; k < s.length; k++) if (b[at + k] !== s.charCodeAt(k)) return false;
  return true;
};

/**
 * null when `bytes` look like a usable clip of about `seconds` (when given), else why not. An MP3 must be an
 * intact frame stream at least half as long as listed (a cut-off file decodes to a fragment); a different
 * length beyond that is the manifest's problem, not the file's (tools/vo-check.mjs reports it).
 */
export function audioProblem(bytes: ArrayBuffer | null, seconds?: number): string | null {
  if (!bytes || bytes.byteLength < 128) return 'empty file';
  const b = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 64));
  if (ascii(b, 0, 'OggS') || ascii(b, 0, 'fLaC') || (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) || ascii(b, 4, 'ftyp')) return null;
  // ADTS AAC: sync, layer 0
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return null;
  let k = 0;
  while (k < b.length && (b[k] === 0x20 || b[k] === 0x09 || b[k] === 0x0a || b[k] === 0x0d || b[k] === 0xef || b[k] === 0xbb || b[k] === 0xbf)) k++;
  if (b[k] === 0x3c || b[k] === 0x7b || b[k] === 0x5b) return 'not audio (a text, HTML or JSON body)';
  const d = mpegDuration(bytes);
  if (d < 0) return 'not an audio stream';
  if (typeof seconds === 'number' && seconds > 0 && d < seconds * 0.5 - 0.1) return `cut off (${d.toFixed(2)} s of ${seconds.toFixed(2)} s)`;
  return null;
}
