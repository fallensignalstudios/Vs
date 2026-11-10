/**
 * Sample bank: buffers that stand in for procedural recipes. Two kinds of content share one playback path
 * (same strip, bus, panner, sends, rate limits and calibration as the recipe they replace):
 *   baked       pre-renders of the procedural recipes themselves (synth/bake.ts) — a frequent one-shot costs
 *               one AudioBufferSourceNode instead of a dozen oscillators and filters
 *   registered  recordings supplied from outside (voice-over, hero cues) with `AudioEngine.registerSample`
 * A registered sample always wins over a baked one; with neither, the recipe is synthesised live.
 */

export interface Sample {
  buffer: AudioBuffer;
  /** linear gain on top of the id's own level (1 = the buffer already sits at recipe level) */
  gain: number;
  /** sustain by looping the buffer (ids used with loop()) */
  loop: boolean;
}

export interface SampleOpts {
  /** linear gain relative to the procedural recipe it replaces (default 1) */
  gain?: number;
  /** loop the buffer when the id is used with loop() (default: true for ids designed as loops) */
  loop?: boolean;
}

export class SampleBank {
  private readonly baked = new Map<string, Sample[]>();
  private readonly registered = new Map<string, Sample[]>();
  private readonly lastPick = new Map<string, number>();

  /** Install pre-rendered variants (does not disturb registered recordings). */
  setBaked(all: ReadonlyMap<string, readonly AudioBuffer[]>): void {
    for (const [id, bufs] of all) this.baked.set(id, bufs.map((buffer) => ({ buffer, gain: 1, loop: false })));
  }

  /** Add a recording for an id. Several calls with the same id add round-robin variants. */
  register(id: string, buffer: AudioBuffer, opts: SampleOpts = {}, loopDefault = false): void {
    const g = opts.gain;
    const s: Sample = { buffer, gain: typeof g === 'number' && Number.isFinite(g) && g >= 0 ? Math.min(g, 8) : 1, loop: opts.loop ?? loopDefault };
    const list = this.registered.get(id);
    if (list) list.push(s);
    else this.registered.set(id, [s]);
  }

  /** Forget the recordings for an id (the baked or live recipe plays again). */
  unregister(id: string): void {
    this.registered.delete(id);
  }

  has(id: string): boolean {
    return this.registered.has(id) || this.baked.has(id);
  }

  isRegistered(id: string): boolean {
    return this.registered.has(id);
  }

  /** number of ids with baked variants */
  get bakedCount(): number {
    return this.baked.size;
  }

  get registeredCount(): number {
    return this.registered.size;
  }

  /** A variant for this play — never the same one twice running when there is a choice. */
  pick(id: string, rnd: () => number): Sample | null {
    const list = this.registered.get(id) ?? this.baked.get(id);
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    const last = this.lastPick.get(id) ?? -1;
    let i = Math.floor(rnd() * (list.length - (last >= 0 ? 1 : 0)));
    if (last >= 0 && i >= last) i++;
    i = Math.min(list.length - 1, Math.max(0, i));
    this.lastPick.set(id, i);
    return list[i];
  }
}
