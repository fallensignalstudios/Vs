/**
 * (ship) Voice packs: the shipped build concatenates the voice-over into per-zone packs
 * (`tools/pack-vo.mjs`, `audio/vo/packs/<pack>.bin` + `index.json`). The library reads the index next to the
 * manifest, loads the pack of a zone being prefetched once, slices each line out and decodes a copy; with no
 * index (dev, tests, an unpacked build) it fetches one file per line exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { FakeBuffer, FakeContext } from '../testing/fake-context';
import { AssetLibrary, parsePackIndex, type FetchResult } from './library';
import { mpegDuration } from './sniff';
import { voLineId } from './voiceId';

/** A minimal valid MP3 stream (MPEG-1 layer III, 128 kbit/s, 44.1 kHz) of about `seconds`, tagged with `mark`. */
function fakeMp3(seconds: number, mark = 0): Uint8Array {
  const frames = Math.max(2, Math.round((seconds * 44100) / 1152));
  const b = new Uint8Array(frames * 417);
  for (let f = 0; f < frames; f++) b.set([0xff, 0xfb, 0x90, 0x00], f * 417);
  b[5] = mark & 0xff; // inside the first frame's payload: identifies the clip
  return b;
}

const res = (body: unknown, type: string, bytes: () => ArrayBuffer = () => new ArrayBuffer(0)): FetchResult => ({
  ok: true,
  headers: { get: (n) => (n === 'content-type' ? type : null) },
  arrayBuffer: async () => bytes(),
  json: async () => body,
});
const html = (): FetchResult => res(null, 'text/html'); // what a dev server answers for a missing file

interface Net {
  lib: AssetLibrary;
  fetched: string[];
  /** the first byte of the clip payload of every buffer handed to decodeAudioData */
  decodedMarks: number[];
}

function net(files: Record<string, () => FetchResult>): Net {
  const fetched: string[] = [];
  const decodedMarks: number[] = [];
  const ctx = new FakeContext() as FakeContext & { decodeAudioData?: (b: ArrayBuffer) => Promise<FakeBuffer> };
  ctx.decodeAudioData = async (b: ArrayBuffer): Promise<FakeBuffer> => {
    if (!(mpegDuration(b) > 0)) throw new Error('not audio');
    decodedMarks.push(new Uint8Array(b)[5]);
    const buf = new FakeBuffer(1, 44100, 44100);
    buf.getChannelData(0).fill(0.05);
    return buf;
  };
  const fetcher = async (url: string): Promise<FetchResult> => {
    const path = url.replace(/^\.?\/audio\//, '');
    fetched.push(path);
    const f = files[path];
    return f ? f() : { ok: false, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
  };
  const lib = new AssetLibrary({ baseUrl: './', decoder: () => ctx.asContext(), fetcher, warn: () => {} });
  return { lib, fetched, decodedMarks };
}

/** Lines a..e: a, b in Z03; c in Z04; d in Z03 and Z04 (shared); e in Z05. */
function fixture(): { ids: string[]; manifest: Record<string, unknown>; clips: Uint8Array[]; packs: Record<string, Uint8Array>; index: Record<string, [string, number, number]> } {
  const ids = ['a', 'b', 'c', 'd', 'e'].map((k) => voLineId('Selene', `Pack line ${k}.`));
  const zones = [['Z03'], ['Z03'], ['Z04'], ['Z03', 'Z04'], ['Z05']];
  const manifest: Record<string, unknown> = {};
  ids.forEach((id, i) => (manifest[id] = { file: `${id}.mp3`, seconds: 1, zone: zones[i][0], zones: zones[i] }));
  const clips = ids.map((_, i) => fakeMp3(1, 10 + i));
  const packOf = (i: number): string => (zones[i].length > 1 ? 'shared' : zones[i][0]);
  const index: Record<string, [string, number, number]> = {};
  const parts: Record<string, Uint8Array[]> = {};
  const offs: Record<string, number> = {};
  ids.forEach((id, i) => {
    const p = packOf(i);
    (parts[p] ??= []).push(clips[i]);
    index[id] = [p, offs[p] ?? 0, clips[i].length];
    offs[p] = (offs[p] ?? 0) + clips[i].length;
  });
  const packs: Record<string, Uint8Array> = {};
  for (const [p, list] of Object.entries(parts)) {
    const out = new Uint8Array(offs[p]);
    let o = 0;
    for (const c of list) {
      out.set(c, o);
      o += c.length;
    }
    packs[p] = out;
  }
  return { ids, manifest, clips, packs, index };
}

const copy = (u: Uint8Array): ArrayBuffer => u.slice().buffer;

describe('voice packs (shipped build)', () => {
  it('parses the index and skips malformed entries', () => {
    expect(parsePackIndex(null)).toBeNull();
    expect(parsePackIndex([])).toBeNull();
    expect(parsePackIndex({})).toBeNull();
    const m = parsePackIndex({
      good: ['Z03', 0, 417],
      shared: ['shared', 834, 12],
      neg: ['Z03', -1, 10],
      zero: ['Z03', 0, 0],
      frac: ['Z03', 1.5, 10],
      path: ['../x', 0, 10],
      short: ['Z03', 0],
      obj: { pack: 'Z03' },
    });
    expect(m && [...m.entries()]).toEqual([['good', ['Z03', 0, 417]], ['shared', ['shared', 834, 12]]]);
  });

  it('prefetching a zone fetches its pack (and the shared one) once, never a single file, and slices each line', async () => {
    const f = fixture();
    const files: Record<string, () => FetchResult> = {
      'vo/manifest.json': () => res(f.manifest, 'application/json'),
      'vo/packs/index.json': () => res(f.index, 'application/json'),
    };
    for (const [p, bytes] of Object.entries(f.packs)) files[`vo/packs/${p}.bin`] = () => res(null, 'application/octet-stream', () => copy(bytes));
    const { lib, fetched, decodedMarks } = net(files);
    await lib.prefetchVoices(['Z03']);
    expect(fetched.filter((p) => p.endsWith('.mp3'))).toEqual([]);
    expect(fetched.filter((p) => p.endsWith('.bin')).sort()).toEqual(['vo/packs/Z03.bin', 'vo/packs/shared.bin']);
    for (const id of [f.ids[0], f.ids[1], f.ids[3]]) expect(lib.clipBytesReady(id)).toBe(true);
    expect(lib.clipBytesReady(f.ids[2])).toBe(false); // Z04's own pack: not yet
    expect(lib.voiceStats()).toMatchObject({ listed: 5, fetched: 3, decoded: 0, broken: [], packs: { indexed: 5, failed: [] } });
    // decoding hands the decoder that line's own bytes
    expect(await lib.requestClip(f.ids[1])).not.toBeNull();
    expect(await lib.requestClip(f.ids[3])).not.toBeNull();
    expect(decodedMarks).toEqual([11, 13]);
    // a line of a pack nobody prefetched: requested alone, it brings its whole pack (once)
    const [c1, c2] = await Promise.all([lib.requestClip(f.ids[2]), lib.fetchClip(f.ids[2])]);
    expect(c1).not.toBeNull();
    expect(c2).toBe(true);
    expect(fetched.filter((p) => p === 'vo/packs/Z04.bin')).toHaveLength(1);
    await lib.prefetchVoices(['Z04', 'Z05']);
    expect(fetched.filter((p) => p.endsWith('.bin')).sort()).toEqual(['vo/packs/Z03.bin', 'vo/packs/Z04.bin', 'vo/packs/Z05.bin', 'vo/packs/shared.bin']);
    expect(lib.voiceStats().packs?.loaded.sort()).toEqual(['Z03', 'Z04', 'Z05', 'shared']);
    expect(fetched.filter((p) => p.endsWith('.mp3'))).toEqual([]);
  });

  it('without an index (dev: the server answers index.html) every line is its own file, as before', async () => {
    const f = fixture();
    const files: Record<string, () => FetchResult> = {
      'vo/manifest.json': () => res(f.manifest, 'application/json'),
      'vo/packs/index.json': html,
    };
    f.ids.forEach((id, i) => (files[`vo/${id}.mp3`] = () => res(null, 'audio/mpeg', () => copy(f.clips[i]))));
    const { lib, fetched, decodedMarks } = net(files);
    await lib.prefetchVoices(['Z03']);
    expect(fetched.filter((p) => p.endsWith('.bin'))).toEqual([]);
    expect(fetched.filter((p) => p.endsWith('.mp3')).sort()).toEqual([f.ids[0], f.ids[1], f.ids[3]].map((id) => `vo/${id}.mp3`).sort());
    expect(await lib.requestClip(f.ids[0])).not.toBeNull();
    expect(decodedMarks).toEqual([10]);
    expect(lib.voiceStats().packs).toBeUndefined();
  });

  it('a pack that is gone or truncated leaves its lines subtitled (said once), and the other packs still play', async () => {
    const f = fixture();
    const warnings: string[] = [];
    const files: Record<string, () => FetchResult> = {
      'vo/manifest.json': () => res(f.manifest, 'application/json'),
      'vo/packs/index.json': () => res(f.index, 'application/json'),
      // Z03 is missing; shared is cut short
      'vo/packs/shared.bin': () => res(null, 'application/octet-stream', () => copy(f.packs.shared.subarray(0, 100))),
      'vo/packs/Z04.bin': () => res(null, 'application/octet-stream', () => copy(f.packs.Z04)),
    };
    const fetched: string[] = [];
    const ctx = new FakeContext() as FakeContext & { decodeAudioData?: (b: ArrayBuffer) => Promise<FakeBuffer> };
    ctx.decodeAudioData = async (): Promise<FakeBuffer> => new FakeBuffer(1, 44100, 44100);
    const lib = new AssetLibrary({
      baseUrl: '/', decoder: () => ctx.asContext(), warn: (m) => warnings.push(m),
      fetcher: async (url) => {
        const p = url.replace(/^\/audio\//, '');
        fetched.push(p);
        return files[p]?.() ?? { ok: false, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({}) };
      },
    });
    await lib.prefetchVoices(['Z03', 'Z04']);
    expect(lib.clipMissing(f.ids[0])).toBe(true);
    expect(lib.clipMissing(f.ids[1])).toBe(true);
    expect(lib.clipMissing(f.ids[3])).toBe(true);
    expect(await lib.requestClip(f.ids[0])).toBeNull();
    expect(await lib.requestClip(f.ids[2])).not.toBeNull();
    expect(fetched.filter((p) => p.endsWith('.mp3'))).toEqual([]); // no per-line retries
    expect(fetched.filter((p) => p === 'vo/packs/Z03.bin')).toHaveLength(1);
    const st = lib.voiceStats();
    expect(st.broken.sort()).toEqual([f.ids[0], f.ids[1], f.ids[3]].sort());
    expect(st.packs).toMatchObject({ failed: ['Z03'] });
    expect(warnings.filter((w) => w.includes('not found'))).toHaveLength(2);
    expect(warnings.filter((w) => w.includes('truncated'))).toHaveLength(1);
  });

  it('a line missing from the index is still fetched as its own file', async () => {
    const f = fixture();
    const { [f.ids[4]]: _dropped, ...partial } = f.index;
    const files: Record<string, () => FetchResult> = {
      'vo/manifest.json': () => res(f.manifest, 'application/json'),
      'vo/packs/index.json': () => res(partial, 'application/json'),
      [`vo/${f.ids[4]}.mp3`]: () => res(null, 'audio/mpeg', () => copy(f.clips[4])),
    };
    const { lib, fetched } = net(files);
    expect(await lib.fetchClip(f.ids[4])).toBe(true);
    expect(fetched).toContain(`vo/${f.ids[4]}.mp3`);
  });
});
