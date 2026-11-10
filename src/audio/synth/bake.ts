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
const CHUNK_SECONDS = 12;
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

  // every (job, variant) to render, in order
  const todo: Array<{ job: BakeJob; seed: number }> = [];
  for (const job of jobs) {
    const variants = job.exact ? 1 : Math.max(1, job.variants);
    for (let v = 0; v < variants; v++) todo.push({ job, seed: seedOf(job, v) });
  }
  /** Build a sound on the throwaway context to learn its length (same seed → same length). */
  const measure = (t: { job: BakeJob; seed: number }): Item | null => {
    try {
      const k = new Kit(scratch, res, scratch.destination, 0, 1, mulberry32(t.seed), false);
      t.job.build(k);
      k.seal();
      return k.end > 0 && k.end < 12 ? { job: t.job, seed: t.seed, seconds: k.end + 0.06 } : null;
    } catch {
      return null; // a recipe that cannot be built is left to live synthesis (which reports it)
    }
  };

  // Pack into chunks, render, slice. Measuring happens chunk by chunk, so the main thread only ever builds
  // one chunk's worth of nodes between two awaits — no long task when audio starts.
  let next = 0;
  let carried: Item | null = null;
  while (next < todo.length || carried) {
    const chunk: Array<{ item: Item; at: number }> = [];
    let cursor = 0.01;
    for (;;) {
      const item: Item | null = carried ?? (next < todo.length ? measure(todo[next++]) : null);
      carried = null;
      if (!item) {
        if (next >= todo.length) break;
        continue;
      }
      if (chunk.length && cursor + item.seconds > CHUNK_SECONDS) {
        carried = item;
        break;
      }
      chunk.push({ item, at: cursor });
      cursor += item.seconds + GAP;
    }
    if (!chunk.length) break;
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

// ---------------------------------------------------------------------------------------------------------
// sustaining loops
// ---------------------------------------------------------------------------------------------------------

export interface LoopJob {
  id: string;
  /** build the sustaining patch into a kit in sustain mode */
  build(k: Kit): void;
}

/** seconds rendered before the loop is cut: every attack has finished, every filter has settled */
const LOOP_LEAD = 1.4;
/** cross-fade that joins the loop's end to its start (only the non-periodic, noise part needs it) */
const LOOP_XFADE = 0.35;
const LOOP_TARGET = 4.5;

/**
 * Render sustaining patches (a drone's hum, a link's whine) as seamless buffer loops: five or six live
 * oscillators, noises and LFOs per voice become one looping source — and LoopHandle.setPitch can then move
 * the whole sound, noise included.
 *
 * Each patch is rendered with the kit's loop grid on: its slowest LFO fixes the loop length (a whole number
 * of its cycles, about 4.5 s) and every sustained oscillator and LFO is tuned to repeat exactly in that time,
 * so the tonal content needs no cross-fade at all. What does not repeat — the looping noise sources — is
 * cross-faded linearly over 350 ms. Never rejects; a patch that fails stays live-synthesised.
 */
export async function bakeLoops(sampleRate: number, jobs: readonly LoopJob[]): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  const Offline = offlineCtor();
  if (!Offline || !jobs.length) return out;
  let scratch: OfflineAudioContext;
  try {
    scratch = new Offline(1, 128, sampleRate);
  } catch {
    return out;
  }
  const res = makeShared(scratch);
  const lead = Math.round(LOOP_LEAD * sampleRate);
  const xf = Math.round(LOOP_XFADE * sampleRate);
  for (const job of jobs) {
    try {
      const seed = hashString(job.id);
      // what is its slowest free-running LFO?
      const probe = new Kit(scratch, res, scratch.destination, 0, 1, mulberry32(seed), true);
      job.build(probe);
      probe.stopAll(0);
      const slowest = probe.lfoRates.reduce((m, r) => (r > 0 && r < m ? r : m), Infinity);
      let seconds = LOOP_TARGET;
      if (Number.isFinite(slowest)) seconds = Math.max(1, Math.round(LOOP_TARGET * slowest)) / slowest;
      if (seconds > 9) continue; // an LFO too slow to loop sensibly: leave it live
      const n = Math.round(seconds * sampleRate);
      const ctx = new Offline(2, lead + n + xf, sampleRate);
      const k = new Kit(ctx, res, ctx.destination, 0, 1, mulberry32(seed), true);
      k.grid = sampleRate / n;
      job.build(k);
      const rendered = await ctx.startRendering();
      const l = rendered.getChannelData(0);
      const r = rendered.getChannelData(1);
      let stereo = false;
      let peak = 0;
      for (let i = lead; i < lead + n; i += 7) {
        if (Math.abs(l[i] - r[i]) > 1e-4) stereo = true;
        if (Math.abs(l[i]) > peak) peak = Math.abs(l[i]);
      }
      if (peak < SILENCE) continue;
      const buf = ctx.createBuffer(stereo ? 2 : 1, n, sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const src = c === 0 ? l : r;
        const dst = buf.getChannelData(c);
        dst.set(src.subarray(lead, lead + n));
        // the head of the loop is blended with what followed its end, so the wrap is continuous
        for (let i = 0; i < xf; i++) {
          const w = i / xf;
          dst[i] = src[lead + i] * w + src[lead + n + i] * (1 - w);
        }
      }
      out.set(job.id, buf);
    } catch (err) {
      console.warn(`[audio] loop ${job.id} could not be pre-rendered — it stays live-synthesised:`, err);
    }
  }
  return out;
}

/**
 * How discontinuous a loop is at its wrap point: the jump from the last sample to the first, relative to the
 * typical sample-to-sample step. ~1 = seamless; a click is tens or hundreds.
 */
export function loopSeam(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const n = d.length;
  if (n < 16) return 0;
  let sum = 0;
  for (let i = 1; i < n; i++) sum += Math.abs(d[i] - d[i - 1]);
  const typical = sum / (n - 1);
  return typical > 0 ? Math.abs(d[0] - d[n - 1]) / typical : 0;
}
