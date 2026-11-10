/**
 * Pre-rendering ("baking") of procedural sounds through OfflineAudioContext.
 *
 * A frequent one-shot — a footstep, a blade hit, a taiko stroke — is a dozen oscillators, filters and
 * envelopes when synthesised live. Rendered once when audio starts and replayed as a buffer it is ONE source
 * node. The render happens off the main thread; until it lands (and wherever OfflineAudioContext does not
 * exist) the same recipes are synthesised live, so nothing ever waits for it.
 *
 * Jobs are packed back to back into a few long offline contexts and sliced apart afterwards.
 */
import { hashString, mulberry32 } from '@/core/mathx';
import { Kit } from './kit';
import { makeShared } from './shared';

export interface BakeJob {
  /** sample-bank id the variants are stored under */
  id: string;
  /** how many differently-seeded renders to keep */
  variants: number;
  /** identical on every play: one variant, seeded exactly like the live path */
  exact?: boolean;
  /** build the sound into the kit (kit time 0 = start of the sound) */
  build(k: Kit): void;
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

/** True where sounds can be pre-rendered at all. */
export const canBake = (): boolean => offlineCtor() !== null;

/** seconds of audio per offline context */
const CHUNK_SECONDS = 20;
/** silence between two sounds in a chunk */
const GAP = 0.03;
const SILENCE = 2e-5;

interface Item {
  job: BakeJob;
  seed: number;
  seconds: number;
}

const seedOf = (job: BakeJob, variant: number): number =>
  job.exact ? hashString(job.id) : (hashString(job.id) ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;

/** Cut one sound out of a rendered chunk: trim trailing silence, close with a short fade, fold to mono if it is. */
function slice(ctx: BaseAudioContext, chunk: AudioBuffer, start: number, seconds: number): AudioBuffer | null {
  const sr = chunk.sampleRate;
  const s0 = Math.floor(start * sr);
  let n = Math.min(chunk.length - s0, Math.ceil(seconds * sr));
  if (n <= 16) return null;
  const l = chunk.getChannelData(0).subarray(s0, s0 + n);
  const r = chunk.getChannelData(1).subarray(s0, s0 + n);
  let last = -1;
  let stereo = false;
  for (let i = 0; i < n; i++) {
    const a = l[i], b = r[i];
    if (a > SILENCE || a < -SILENCE || b > SILENCE || b < -SILENCE) last = i;
    if (!stereo && Math.abs(a - b) > 1e-4) stereo = true;
  }
  if (last < 0) return null;
  n = Math.min(n, last + 1 + Math.floor(0.004 * sr));
  const out = ctx.createBuffer(stereo ? 2 : 1, n, sr);
  const fade = Math.min(n, Math.floor(0.003 * sr));
  for (let c = 0; c < out.numberOfChannels; c++) {
    const src = c === 0 ? l : r;
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, n));
    for (let i = 0; i < fade; i++) dst[n - 1 - i] *= i / fade;
  }
  return out;
}

/**
 * Render every job. Resolves to id → variants (an id whose renders were all silent is omitted). Never
 * rejects: a failed chunk simply leaves its ids to live synthesis.
 */
export async function bake(sampleRate: number, jobs: readonly BakeJob[]): Promise<Map<string, AudioBuffer[]>> {
  const out = new Map<string, AudioBuffer[]>();
  const Offline = offlineCtor();
  if (!Offline || !jobs.length) return out;
  let scratch: OfflineAudioContext;
  try {
    scratch = new Offline(1, 128, sampleRate);
  } catch {
    return out;
  }
  const res = makeShared(scratch);

  // pass 1: build each sound on a throwaway context to learn its length (same seed → same length)
  const items: Item[] = [];
  for (const job of jobs) {
    const variants = job.exact ? 1 : Math.max(1, job.variants);
    for (let v = 0; v < variants; v++) {
      const seed = seedOf(job, v);
      try {
        const k = new Kit(scratch, res, scratch.destination, 0, 1, mulberry32(seed), false);
        job.build(k);
        k.seal();
        if (k.end > 0 && k.end < 12) items.push({ job, seed, seconds: k.end + 0.06 });
      } catch {
        /* a recipe that cannot be built is left to live synthesis (which reports it) */
      }
    }
  }

  // pass 2: pack into chunks, render, slice
  let i = 0;
  while (i < items.length) {
    const chunk: Array<{ item: Item; at: number }> = [];
    let cursor = 0.01;
    while (i < items.length && (chunk.length === 0 || cursor + items[i].seconds <= CHUNK_SECONDS)) {
      chunk.push({ item: items[i], at: cursor });
      cursor += items[i].seconds + GAP;
      i++;
    }
    try {
      const ctx = new Offline(2, Math.ceil(cursor * sampleRate), sampleRate);
      for (const { item, at } of chunk) {
        const k = new Kit(ctx, res, ctx.destination, at, 1, mulberry32(item.seed), false);
        item.job.build(k);
        k.seal();
      }
      const rendered = await ctx.startRendering();
      for (const { item, at } of chunk) {
        const buf = slice(ctx, rendered, at, item.seconds);
        if (!buf) continue;
        const list = out.get(item.job.id);
        if (list) list.push(buf);
        else out.set(item.job.id, [buf]);
      }
    } catch (err) {
      console.warn('[audio] pre-render chunk failed — those sounds stay live-synthesised:', err);
    }
  }
  return out;
}
