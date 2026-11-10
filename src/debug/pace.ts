/**
 * How fast and how well the autoplay bot plays. `'bot'` is the soft-lock detector (instant reactions, perfect aim,
 * god mode by default); `'human'` plays like an attentive person at Standard so encounter timings and balance can
 * be measured honestly: it reacts to cues after a human delay, swings at a human cadence with breathers between
 * combos, aims imperfectly, and dodges most telegraphed attacks it sees coming — and it can die.
 */
import type { Actor, Game, Vec3Like } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { isStub } from '@/core/stub';

export type BotPace = 'bot' | 'human';

export interface PaceProfile {
  /** seconds from a cue (a new target, a context prompt, an attack's wind-up) to the reaction [min, max] */
  reaction: readonly [number, number];
  /** seconds between melee presses [min, max] */
  swing: readonly [number, number];
  /** a breather after this many swings in a row (0 = never), and its length [min, max] */
  combo: number;
  comboPause: readonly [number, number];
  /** seconds between shots [min, max] */
  shot: readonly [number, number];
  /** the aim ray must be this close to the aim point before firing (radians) */
  aimTolerance: number;
  /** the aim point wanders this far (metres, re-rolled every shot) — some shots miss, few find a weak point */
  aimJitter: number;
  /** chance to dodge an attack whose wind-up it notices (0 = never), from attackers within this range (m) */
  dodgeChance: number;
  dodgeRange: number;
}

export const PACES: Readonly<Record<BotPace, PaceProfile>> = {
  bot: {
    reaction: [0, 0], swing: [0.42, 0.42], combo: 0, comboPause: [0, 0], shot: [0.5, 0.5],
    aimTolerance: 0.01, aimJitter: 0, dodgeChance: 0, dodgeRange: 0,
  },
  human: {
    reaction: [0.4, 0.75], swing: [0.5, 0.72], combo: 4, comboPause: [0.7, 1.4], shot: [0.75, 1.1],
    aimTolerance: 0.03, aimJitter: 0.28, dodgeChance: 0.65, dodgeRange: 10,
  },
};

/** the AI's telegraph query (optional on the contract; absent on stubs) */
function telegraphOf(game: Game, a: Actor): number {
  const ai = game.ai as { telegraphOf?: (a: Actor) => unknown };
  if (isStub(ai) || typeof ai.telegraphOf !== 'function') return 0;
  const v = ai.telegraphOf(a);
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Per-run reflex state for one pace: deterministic randomness, delayed reactions to cues and the dodge decision
 * for each wind-up. Everything runs on the sim time passed in.
 */
export class Reflexes {
  readonly profile: PaceProfile;
  private readonly rnd: () => number;
  /** per cue slot: the key on offer, since when, and the reaction drawn for it */
  private readonly cues = new Map<string, { key: string; at: number; delay: number }>();
  private swings = 0;
  /** last telegraph seconds seen per attacker id (a rise means a new wind-up) */
  private readonly seen = new Map<number, number>();
  private dodgeAt = Infinity;
  private dodgeFrom: Actor | null = null;
  private readonly jitter = { x: 0, y: 0, z: 0 };
  private readonly dir = { x: 0, z: 0 };
  /** dodges performed / wind-ups noticed (for reports) */
  dodges = 0;
  noticed = 0;

  constructor(readonly pace: BotPace, seed = 7) {
    this.profile = PACES[pace];
    this.rnd = mulberry32(seed);
  }

  get human(): boolean {
    return this.pace === 'human';
  }

  private roll(r: readonly [number, number]): number {
    return r[0] + (r[1] - r[0]) * this.rnd();
  }

  /** true once `key` (a prompt id, a target id) has been on offer in `slot` for a human reaction time */
  reacted(slot: 'prompt' | 'target', key: string, now: number): boolean {
    let c = this.cues.get(slot);
    if (!c) this.cues.set(slot, (c = { key: '', at: 0, delay: 0 }));
    if (key !== c.key) {
      c.key = key;
      c.at = now;
      c.delay = this.roll(this.profile.reaction);
    }
    return now >= c.at + c.delay;
  }

  /** seconds until the next melee press (a breather every `combo` swings) */
  swingGap(): number {
    const p = this.profile;
    this.swings++;
    const pause = p.combo > 0 && this.swings % p.combo === 0 ? this.roll(p.comboPause) : 0;
    return this.roll(p.swing) + pause;
  }

  shotGap(): number {
    this.rerollJitter();
    return this.roll(this.profile.shot);
  }

  /** the aim point with this shot's wander added */
  aimPoint(p: Vec3Like, out: { x: number; y: number; z: number }): typeof out {
    out.x = p.x + this.jitter.x;
    out.y = p.y + this.jitter.y;
    out.z = p.z + this.jitter.z;
    return out;
  }

  private rerollJitter(): void {
    const j = this.profile.aimJitter;
    this.jitter.x = (this.rnd() * 2 - 1) * j;
    this.jitter.y = (this.rnd() * 2 - 1) * j * 0.7;
    this.jitter.z = (this.rnd() * 2 - 1) * j;
  }

  /**
   * Watch the wind-ups of the hostiles around `me`. Returns the attacker to dodge away from on the frame the
   * (delayed) reaction fires, else null. A wind-up noticed too late — it lands before the reaction — is taken.
   */
  dodgeCue(game: Game, me: Actor, hostiles: readonly Actor[], now: number): Actor | null {
    const p = this.profile;
    if (p.dodgeChance <= 0) return null;
    for (const h of hostiles) {
      if (!h.alive) continue;
      const left = telegraphOf(game, h);
      const before = this.seen.get(h.id) ?? 0;
      this.seen.set(h.id, left);
      if (left <= before + 1e-3 || left <= 0) continue;
      // a new wind-up
      if (Math.hypot(h.pos.x - me.pos.x, h.pos.z - me.pos.z) > p.dodgeRange) continue;
      this.noticed++;
      const react = this.roll(p.reaction);
      if (this.rnd() < p.dodgeChance && react < left + 0.1 && this.dodgeAt === Infinity) {
        // dodge as the blow comes (the i-frames cover the last 0.3 s), not the moment the wind-up starts
        this.dodgeAt = now + Math.max(react, left - 0.3);
        this.dodgeFrom = h;
      }
    }
    if (now < this.dodgeAt) return null;
    const from = this.dodgeFrom;
    this.dodgeAt = Infinity;
    this.dodgeFrom = null;
    if (!from || !from.alive) return null;
    this.dodges++;
    return from;
  }

  /**
   * Dodge a wind-up it noticed, as the blow comes (through the virtual input) — away from a close attacker,
   * sideways from a far one (charges, lanes). Returns the attacker dodged this frame, else null.
   */
  evade(game: Game, me: Actor): Actor | null {
    const from = this.dodgeCue(game, me, game.actors.hostilesOf(me), game.time.now);
    if (!from) return null;
    let dx = me.pos.x - from.pos.x;
    let dz = me.pos.z - from.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    if (l > 5) {
      const s = this.rnd() < 0.5 ? -1 : 1;
      const sx = -dz * s;
      dz = dx * s;
      dx = sx;
    }
    this.dir.x = dx;
    this.dir.z = dz;
    game.input.virtual.setMoveWorld(this.dir);
    game.input.virtual.press('dodge');
    return from;
  }
}
