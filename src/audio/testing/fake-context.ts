/**
 * A strict fake of the slice of WebAudio this subsystem uses, for node tests. It renders nothing; it
 * *validates* — the mistakes that only blow up (or silently misbehave) in a real browser are turned into
 * recorded problems: non-finite automation, exponential ramps to/through zero, starting a source twice,
 * stopping before starting, and so on. It also records source lifetimes so tests can bound polyphony.
 */

export interface SourceSpan {
  kind: 'osc' | 'buffer';
  start: number;
  stop: number;
  /** buffer offset the source was started at (noise phase) */
  offset: number;
}

export class FakeParam {
  /** value of the most recently scheduled event (for ramp validation) */
  private last: number;
  constructor(private readonly ctx: FakeContext, private readonly name: string, public value: number) {
    this.last = value;
  }

  private check(v: number, t: number, what: string): void {
    if (!Number.isFinite(v)) this.ctx.problem(`${this.name}.${what}: non-finite value ${v}`);
    if (!Number.isFinite(t) || t < 0) this.ctx.problem(`${this.name}.${what}: bad time ${t}`);
  }

  setValueAtTime(v: number, t: number): this {
    this.check(v, t, 'setValueAtTime');
    this.last = v;
    return this;
  }

  linearRampToValueAtTime(v: number, t: number): this {
    this.check(v, t, 'linearRampToValueAtTime');
    this.last = v;
    return this;
  }

  exponentialRampToValueAtTime(v: number, t: number): this {
    this.check(v, t, 'exponentialRampToValueAtTime');
    if (v === 0) this.ctx.problem(`${this.name}: exponential ramp to 0`);
    if (this.last === 0 || Math.sign(this.last) !== Math.sign(v)) this.ctx.problem(`${this.name}: exponential ramp from ${this.last} to ${v}`);
    this.last = v;
    return this;
  }

  setTargetAtTime(v: number, t: number, tc: number): this {
    this.check(v, t, 'setTargetAtTime');
    if (!Number.isFinite(tc) || tc < 0) this.ctx.problem(`${this.name}.setTargetAtTime: bad time constant ${tc}`);
    this.last = v === 0 ? this.last : v; // approaches, never reaches
    return this;
  }

  cancelScheduledValues(t: number): this {
    this.check(0, t, 'cancelScheduledValues');
    return this;
  }
}

export class FakeNode {
  readonly outputs = new Set<FakeNode | FakeParam>();
  constructor(readonly ctx: FakeContext, readonly type: string) {
    ctx.nodes++;
    ctx.all.push(this);
  }

  protected param(name: string, v: number): FakeParam {
    return new FakeParam(this.ctx, `${this.type}.${name}`, v);
  }

  connect(dst: FakeNode | FakeParam): FakeNode | FakeParam {
    if (!(dst instanceof FakeNode) && !(dst instanceof FakeParam)) this.ctx.problem(`${this.type}.connect: not a node/param`);
    this.outputs.add(dst);
    return dst;
  }

  disconnect(): void {
    this.outputs.clear();
  }
}

export class FakeSource extends FakeNode {
  private started = false;
  private span: SourceSpan | null = null;
  onended: (() => void) | null = null;

  start(when = 0, offset = 0): void {
    if (this.started) this.ctx.problem(`${this.type}.start called twice`);
    if (!Number.isFinite(when) || when < 0) this.ctx.problem(`${this.type}.start: bad time ${when}`);
    if (!Number.isFinite(offset) || offset < 0) this.ctx.problem(`${this.type}.start: bad offset ${offset}`);
    this.started = true;
    this.span = { kind: this.type === 'OscillatorNode' ? 'osc' : 'buffer', start: Math.max(when, this.ctx.currentTime), stop: Infinity, offset };
    this.ctx.spans.push(this.span);
  }

  stop(when = 0): void {
    if (!this.started || !this.span) {
      this.ctx.problem(`${this.type}.stop before start`);
      return;
    }
    if (!Number.isFinite(when) || when < 0) this.ctx.problem(`${this.type}.stop: bad time ${when}`);
    this.span.stop = Math.min(this.span.stop, Math.max(when, this.ctx.currentTime));
  }
}

export class FakeBuffer {
  readonly duration: number;
  private readonly data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(c: number): Float32Array {
    return this.data[c];
  }

  copyToChannel(src: Float32Array, c: number): void {
    this.data[c].set(src.subarray(0, this.length));
  }
}

/** Fake BaseAudioContext. Advance `currentTime` by hand between engine updates. */
export class FakeContext {
  currentTime = 0;
  readonly sampleRate = 44100;
  state: 'running' | 'suspended' | 'closed' = 'running';
  nodes = 0;
  /** every node ever created (graph inspection in tests) */
  readonly all: FakeNode[] = [];
  readonly problems: string[] = [];
  readonly spans: SourceSpan[] = [];
  readonly destination: FakeNode;
  readonly listener: Record<string, FakeParam>;

  constructor() {
    this.destination = new FakeNode(this, 'Destination');
    const p = (n: string, v: number): FakeParam => new FakeParam(this, `listener.${n}`, v);
    this.listener = {
      positionX: p('positionX', 0), positionY: p('positionY', 0), positionZ: p('positionZ', 0),
      forwardX: p('forwardX', 0), forwardY: p('forwardY', 0), forwardZ: p('forwardZ', -1),
      upX: p('upX', 0), upY: p('upY', 1), upZ: p('upZ', 0),
    };
  }

  problem(msg: string): void {
    if (this.problems.length < 50 && !this.problems.includes(msg)) this.problems.push(msg);
  }

  private node(type: string, params: Record<string, number>, extra: Record<string, unknown> = {}): FakeNode {
    const n = new FakeNode(this, type) as FakeNode & Record<string, unknown>;
    for (const [k, v] of Object.entries(params)) n[k] = new FakeParam(this, `${type}.${k}`, v);
    Object.assign(n, extra);
    return n;
  }

  private source(type: string, params: Record<string, number>, extra: Record<string, unknown> = {}): FakeNode {
    const n = new FakeSource(this, type) as FakeSource & Record<string, unknown>;
    for (const [k, v] of Object.entries(params)) n[k] = new FakeParam(this, `${type}.${k}`, v);
    Object.assign(n, extra);
    return n;
  }

  createGain(): FakeNode { return this.node('GainNode', { gain: 1 }); }
  createOscillator(): FakeNode { return this.source('OscillatorNode', { frequency: 440, detune: 0 }, { type: 'sine' }); }
  createBufferSource(): FakeNode { return this.source('AudioBufferSourceNode', { playbackRate: 1, detune: 0 }, { buffer: null, loop: false }); }
  createBiquadFilter(): FakeNode { return this.node('BiquadFilterNode', { frequency: 350, Q: 1, gain: 0, detune: 0 }, { type: 'lowpass' }); }
  createStereoPanner(): FakeNode { return this.node('StereoPannerNode', { pan: 0 }); }
  createPanner(): FakeNode { return this.node('PannerNode', { positionX: 0, positionY: 0, positionZ: 0 }, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 1, maxDistance: 10000 }); }
  createDelay(): FakeNode { return this.node('DelayNode', { delayTime: 0 }); }
  createWaveShaper(): FakeNode { return this.node('WaveShaperNode', {}, { curve: null, oversample: 'none' }); }
  createConvolver(): FakeNode { return this.node('ConvolverNode', {}, { buffer: null, normalize: true }); }
  createDynamicsCompressor(): FakeNode { return this.node('DynamicsCompressorNode', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }, { reduction: 0 }); }
  createAnalyser(): FakeNode { return this.node('AnalyserNode', {}, { fftSize: 2048, getFloatTimeDomainData: (a: Float32Array): void => void a.fill(0) }); }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer { return new FakeBuffer(channels, length, sampleRate); }

  /** Peak number of sources sounding at once between `from` and `to` (context seconds). */
  maxPolyphony(from = 0, to = Infinity): number {
    const ev: Array<[number, number]> = [];
    for (const s of this.spans) {
      const a = Math.max(s.start, from);
      const b = Math.min(s.stop, to);
      if (b > a) ev.push([a, 1], [b, -1]);
    }
    ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let n = 0;
    let max = 0;
    for (const [, d] of ev) {
      n += d;
      if (n > max) max = n;
    }
    return max;
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Can a signal leaving `from` reach the destination without passing any node in `blocked`? */
  reaches(from: FakeNode, blocked: ReadonlySet<FakeNode>): boolean {
    const seen = new Set<FakeNode>();
    const todo: FakeNode[] = [from];
    while (todo.length) {
      const n = todo.pop() as FakeNode;
      if (n === this.destination) return true;
      if (seen.has(n) || blocked.has(n)) continue;
      seen.add(n);
      for (const o of n.outputs) if (o instanceof FakeNode) todo.push(o);
    }
    return false;
  }

  /** A typed view for code that expects a BaseAudioContext. */
  asContext(): BaseAudioContext {
    return this as unknown as BaseAudioContext;
  }
}
