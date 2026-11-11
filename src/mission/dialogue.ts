/**
 * Dialogue: blocking `say` lines, the non-blocking `bark` queue, speaker gestures, voice-over hand-off.
 * One line is on screen at a time: a `say` takes the stage from a bark; barks wait for the stage to be free.
 */
import * as THREE from 'three';
import type { Actor, Companion, DialogueLine, Game, Routine, SayOpts, SpeakerId, Vec3Like } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { clamp, smoothstep } from '@/core/mathx';
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

/** lines this short (characters) are read at a glance: shortest lead-in and floor */
const GLANCE_CHARS = 4;
/** from this length up a line gets the full reading lead-in and the 2 s floor */
const READ_CHARS = 20;

/**
 * Reading time for a subtitle without voice-over: clamp(1.6 + 0.055 × characters, 2, 8) seconds for a line of
 * 20 characters or more. Shorter lines ease down to a 1.0 s lead-in and a 1.2 s floor ("No." 1.2 s, "Do it."
 * 1.36 s, "Kill them." 1.76 s), so one- and two-word exchanges no longer hold the screen for 2 s each.
 */
export function lineDuration(text: string): number {
  const chars = typeof text === 'string' ? text.length : 0;
  const k = smoothstep(GLANCE_CHARS, READ_CHARS, chars);
  return clamp(1.0 + 0.6 * k + 0.055 * chars, 1.2 + 0.8 * k, 8);
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

/** who a speaker addresses: another figure (looked at in the eyes), a world point, or nobody */
type Listener = { kind: 'actor'; actor: Actor } | { kind: 'point'; pos: Vec3Like } | { kind: 'none' } | { kind: 'default' };

interface Stage {
  line: DialogueLine;
  actor: Actor | null;
  companion: Companion | null;
  /** SayOpts.listener, resolved */
  listener: Listener;
  /** false: no talk gesture (a drawn weapon stays out) — only the gaze and the moving mouth */
  gesture: boolean;
  /** true: the body keeps its facing; only the head turns to the listener */
  keepFacing: boolean;
  /** the companion's own facing target before the line (restored afterwards), if it had one */
  prevFace: THREE.Vector3 | null;
  started: number;
  duration: number;
}

const _eye = new THREE.Vector3();
const GAZE_SOCKETS = ['eye', 'head'] as const;

/**
 * Where a figure looks when told to look at a point: a point below its waist (a floor marker, a figure's feet)
 * is lifted to standing eye height (0.93 × its height) above that point; a raised point is looked at as given.
 * The same rule as `Companion.face()` — so the head never ends a line staring at the listener's feet.
 */
export function eyeLevel(target: Vec3Like, self: Actor | null, out: Vec3Like): Vec3Like {
  const h = self && Number.isFinite(self.height) && self.height > 0.5 ? self.height : 1.8;
  const feet = self && Number.isFinite(self.pos?.y) ? self.pos.y : target.y;
  out.x = target.x;
  out.z = target.z;
  out.y = target.y < feet + h * 0.5 ? target.y + h * 0.93 : target.y;
  return out;
}

const finitePoint = (p: unknown): p is Vec3Like => {
  if (!p || typeof p !== 'object') return false;
  const v = p as { x?: unknown; y?: unknown; z?: unknown };
  return typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number' && Number.isFinite(v.x + v.y + v.z);
};

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

/**
 * The facing target a zone gave a companion with `face()` before the line: `Companion.facing` (polish 3), or —
 * for a hand-built companion without it — an implementation's `faceTo` field; anything else is "none".
 */
function companionFacing(c: Companion | null): THREE.Vector3 | null {
  if (!c) return null;
  const f = 'facing' in c ? c.facing : (c as unknown as { faceTo?: unknown }).faceTo;
  return finitePoint(f) ? new THREE.Vector3(f.x, f.y, f.z) : null;
}

/** SayOpts.listener → who the speaker addresses (`undefined` = the default listener) */
function resolveListener(l: SayOpts['listener'], speaker: Actor | null): Listener {
  if (l === undefined) return { kind: 'default' };
  if (l === null) return { kind: 'none' };
  const a = asActor(l as Actor | Companion);
  if (a && a !== speaker && finitePoint(a.pos)) return { kind: 'actor', actor: a };
  if (a === speaker && a) return { kind: 'default' };
  if (finitePoint(l)) return { kind: 'point', pos: { x: l.x, y: l.y, z: l.z } };
  return { kind: 'default' };
}

/** a companion holding a scripted pose (polish 4: `play(…, { persist: true })`) keeps it through the line */
const holdsPose = (c: Companion | null): boolean => !!c && typeof c.heldPose === 'string' && c.heldPose.length > 0;

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

    const companion = asCompanion(opts?.actor);
    const stage: Stage = {
      line, actor, companion,
      listener: resolveListener(opts?.listener, actor),
      // the talk clip needs empty hands and would end a scripted hold: those speakers only move their mouths
      gesture: opts?.gesture !== false && opts?.keepWeapon !== true && !holdsPose(companion),
      keepFacing: opts?.keepFacing === true,
      prevFace: null,
      started: time.now, duration: line.duration,
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
   * Speaking actor turns to the listener (unless `keepFacing`), looks at the listener's eyes and plays the talk
   * gesture for the length of the line — or, with `gesture: false` / `keepWeapon` / a scripted hold, only moves its
   * mouth (the gesture would sheathe a drawn weapon or end the hold). The listener is `SayOpts.listener` when
   * given (a figure, a point, or `null` = nobody: no turn, no gaze), else the protagonist, else the nearest
   * same-side figure. Afterwards a companion goes back to the facing target the zone gave it before the line (or
   * none), and the head to that target at EYE height (never the foot-level point itself).
   *
   * Order matters: `Companion.face()` also points the head at the position it is given, so the eye gaze is set
   * AFTER it.
   */
  private gesture(stage: Stage, on: boolean): void {
    const actor = stage.actor;
    if (!actor) return;
    const visual = actor.visual;
    const hasVisual = !!visual && !isStub(visual);
    const companion = stage.companion;
    if (!on) {
      if (hasVisual) {
        if (stage.gesture) visual!.stop('talk');
        else if (isHumanoidVisual(visual)) visual.setSpeaking(0);
      }
      const prev = stage.prevFace;
      if (companion && !stage.keepFacing) companion.face(prev);
      else if (hasVisual && stage.listener.kind !== 'none') visual!.lookAt(prev ? eyeLevel(prev, actor, this.eye) : null);
      return;
    }
    stage.prevFace = companionFacing(companion);
    const l = stage.listener;
    if (l.kind === 'point') {
      if (companion && !stage.keepFacing) companion.face(l.pos);
      eyeLevel(l.pos, actor, this.eye);
      if (hasVisual) visual!.lookAt(this.eye);
    } else if (l.kind !== 'none') {
      const listener = l.kind === 'actor' ? l.actor : this.listenerFor(actor);
      if (listener) {
        if (companion && !stage.keepFacing) companion.face(listener.pos);
        gazePoint(listener, this.eye);
        if (hasVisual) visual!.lookAt(this.eye);
      }
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
