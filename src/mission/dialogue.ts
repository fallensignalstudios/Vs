/**
 * Dialogue: blocking `say` lines, the non-blocking `bark` queue, speaker gestures, voice-over hand-off.
 * One line is on screen at a time: a `say` takes the stage from a bark; barks wait for the stage to be free.
 */
import * as THREE from 'three';
import type { Actor, Companion, DialogueLine, Game, Routine, SayOpts, SpeakerId, Vec3Like } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { clamp } from '@/core/mathx';
import { isStub } from '@/core/stub';

/** a line must have been up this long before `confirm` (or a tap of `skip` in a cinematic) may advance it */
export const MIN_ADVANCE_SECONDS = 1;
/** barks waiting behind the current line; further ones are dropped */
export const BARK_QUEUE_MAX = 3;
/** a queued bark older than this is no longer worth saying */
export const BARK_STALE_SECONDS = 6;
/** padding after a voice-over clip before the subtitle clears */
const VOICE_TAIL = 0.25;
/** a `skip` press shorter than this is a tap (advance the line), not a hold (skip the scene) */
const TAP_SECONDS = 0.3;

/** Reading time for a subtitle without voice-over: clamp(1.6 + 0.055 × characters, 2, 8) seconds. */
export function lineDuration(text: string): number {
  const chars = typeof text === 'string' ? text.length : 0;
  return clamp(1.6 + 0.055 * chars, 2, 8);
}

/** Should a queued bark still be said? */
export function barkIsFresh(queuedAt: number, now: number): boolean {
  return now - queuedAt <= BARK_STALE_SECONDS;
}

interface VoiceAudio {
  voice?: (speaker: string, text: string, opts?: { pos?: Vec3Like; channel?: DialogueLine['channel'] }) => number;
  stopVoice?: (fadeSeconds?: number) => void;
}

interface QueuedBark {
  line: DialogueLine;
  opts: SayOpts | undefined;
  at: number;
}

interface Stage {
  line: DialogueLine;
  actor: Actor | null;
  companion: Companion | null;
  /** false: no talk gesture (a drawn weapon stays out) — only the gaze and the moving mouth */
  gesture: boolean;
  started: number;
  duration: number;
}

const _eye = new THREE.Vector3();
const GAZE_SOCKETS = ['eye', 'head'] as const;

/**
 * Where a speaker looks at a listener: the listener's `eye` socket (else `head`), so the gaze meets a seated,
 * kneeling or lying listener's face; a figure without a believable socket falls back to 0.93 × its height.
 */
export function gazePoint(listener: Actor, out: Vec3Like): Vec3Like {
  const v = listener.visual;
  const h = listener.height || 1.8;
  if (v && !isStub(v)) {
    for (const name of GAZE_SOCKETS) {
      try {
        const s = v.socket(name);
        if (!s || isStub(s) || typeof s.getWorldPosition !== 'function') continue;
        s.getWorldPosition(_eye);
        // an unknown socket returns the root: only accept a point above the feet and within the figure's reach
        const up = _eye.y - listener.pos.y;
        if (Number.isFinite(_eye.x + _eye.y + _eye.z) && up > 0.25 && up < h + 0.6 && Math.hypot(_eye.x - listener.pos.x, _eye.z - listener.pos.z) < 1.5) {
          out.x = _eye.x;
          out.y = _eye.y;
          out.z = _eye.z;
          return out;
        }
      } catch {
        /* a visual without sockets: fall back */
      }
    }
  }
  out.x = listener.pos.x;
  out.y = listener.pos.y + h * 0.93;
  out.z = listener.pos.z;
  return out;
}

const asActor = (a: Actor | Companion | null | undefined): Actor | null => {
  if (!a || isStub(a)) return null;
  const c = a as Companion;
  if (c.actor && typeof c.moveTo === 'function') return isStub(c.actor) ? null : c.actor;
  return a as Actor;
};
const asCompanion = (a: Actor | Companion | null | undefined): Companion | null =>
  a && !isStub(a) && typeof (a as Companion).moveTo === 'function' ? (a as Companion) : null;

export class DialogueDirector {
  private stage: Stage | null = null;
  /** true while the line on stage belongs to a blocking say() */
  private blocking = false;
  private barkLeft = 0;
  private readonly queue: QueuedBark[] = [];
  private readonly eye = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly game: Game,
    private readonly isSkipping: () => boolean,
  ) {}

  get busy(): boolean {
    return this.stage !== null;
  }

  /** Blocking line. Not shown at all while a cinematic is being skipped. */
  *say(speaker: SpeakerId, text: string, opts?: SayOpts): Routine {
    if (this.isSkipping()) return;
    if (typeof text !== 'string' || text.length === 0) return;
    const { input, time } = this.game;
    const stage = this.begin(speaker, text, opts, true);
    try {
      yield {
        race: [
          stage.duration,
          () => time.now - stage.started >= MIN_ADVANCE_SECONDS && this.advancePressed(input),
        ],
      };
    } finally {
      this.end(stage);
    }
  }

  /** Non-blocking line: queued behind whatever is on screen. */
  bark(speaker: SpeakerId, text: string, opts?: SayOpts): void {
    if (this.isSkipping() || typeof text !== 'string' || text.length === 0) return;
    if (this.queue.length >= BARK_QUEUE_MAX) return;
    this.queue.push({ line: this.makeLine(speaker, text, opts), opts, at: this.game.time.now });
  }

  update(dt: number): void {
    if (this.stage && !this.blocking) {
      this.barkLeft -= dt;
      if (this.barkLeft <= 0 || this.isSkipping()) this.end(this.stage);
    }
    if (this.stage || this.queue.length === 0) return;
    const now = this.game.time.now;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      if (!barkIsFresh(next.at, now) || this.isSkipping()) continue;
      const stage = this.begin(next.line.speaker, next.line.text, next.opts, false);
      this.barkLeft = stage.duration;
      break;
    }
  }

  /** Cut the current line short (cinematic skip). */
  interrupt(): void {
    if (this.stage) this.end(this.stage);
    this.queue.length = 0;
  }

  clear(): void {
    this.interrupt();
    this.blocking = false;
  }

  private makeLine(speaker: SpeakerId, text: string, opts?: SayOpts): DialogueLine {
    return { speaker, text, duration: opts?.duration, offscreen: opts?.offscreen, channel: opts?.channel };
  }

  private begin(speaker: SpeakerId, text: string, opts: SayOpts | undefined, blocking: boolean): Stage {
    if (this.stage) this.end(this.stage);
    const { audio, ui, events, time } = this.game;
    const line = this.makeLine(speaker, text, opts);
    const actor = asActor(opts?.actor);
    const channel = line.channel ?? 'voice';

    // Voice-over when a clip exists for this line; the per-speaker comm tick otherwise.
    let voiced = 0;
    const va = audio as unknown as VoiceAudio;
    if (typeof va.voice === 'function') {
      const r = va.voice(String(speaker), text, { channel, pos: actor && !line.offscreen ? actor.pos : undefined });
      if (typeof r === 'number' && r > 0) voiced = r;
    }
    if (voiced <= 0) audio.speak(String(speaker), channel);
    line.duration = voiced > 0 ? Math.max(voiced + VOICE_TAIL, opts?.duration ?? 0) : opts?.duration && opts.duration > 0 ? opts.duration : lineDuration(text);

    const stage: Stage = {
      line, actor, companion: asCompanion(opts?.actor), gesture: opts?.gesture !== false, started: time.now, duration: line.duration,
    };
    this.stage = stage;
    this.blocking = blocking;
    ui.subtitle(line);
    events.emit('dialogue:line', { line });
    this.gesture(stage, true);
    return stage;
  }

  private end(stage: Stage): void {
    if (this.stage !== stage) return;
    const { audio, ui, events, time } = this.game;
    this.stage = null;
    this.blocking = false;
    if (time.now - stage.started < stage.duration - 0.05) {
      const va = audio as unknown as VoiceAudio;
      if (typeof va.stopVoice === 'function') va.stopVoice(0.15);
    }
    this.gesture(stage, false);
    ui.subtitle(null);
    events.emit('dialogue:clear', {});
  }

  /**
   * Speaking actor looks at the listener's eyes / turns to them and plays the talk gesture for the length of the
   * line — or, with `gesture: false`, only moves its mouth (the gesture would sheathe a drawn weapon).
   */
  private gesture(stage: Stage, on: boolean): void {
    const actor = stage.actor;
    if (!actor) return;
    const visual = actor.visual;
    const hasVisual = !!visual && !isStub(visual);
    if (!on) {
      if (hasVisual) {
        if (stage.gesture) visual!.stop('talk');
        else if (isHumanoidVisual(visual)) visual.setSpeaking(0);
        visual!.lookAt(null);
      }
      stage.companion?.face(null);
      return;
    }
    const listener = this.listenerFor(actor);
    if (listener) {
      gazePoint(listener, this.eye);
      if (hasVisual) visual!.lookAt(this.eye);
      stage.companion?.face(listener.pos);
    }
    if (!hasVisual) return;
    if (stage.gesture) visual!.play('talk', { loop: true });
    else if (isHumanoidVisual(visual)) visual.setSpeaking(0.7);
  }

  private listenerFor(speaker: Actor): Actor | null {
    const { player, actors } = this.game;
    const lead = isStub(player) ? null : player.actor;
    if (lead && !isStub(lead) && lead !== speaker) return lead;
    if (isStub(actors)) return null;
    return actors.nearest(speaker.pos, 8, (a) => a !== speaker && a.alive && a.team === speaker.team && !a.flying);
  }

  private advancePressed(input: Game['input']): boolean {
    if (input.pressed('confirm') === true) return true;
    return input.context === 'cinematic' && input.released('skip') === true && input.lastHeldTime('skip') < TAP_SECONDS;
  }
}
