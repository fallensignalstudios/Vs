/**
 * Z05 staging helpers for the authored scenes: camera placement beside two fighters (on the open side, away
 * from the shaft), facing, the duel prompt, and lines that move the speaker's mouth WITHOUT the talk gesture
 * (the gesture sheathes a drawn weapon, and in this zone the blades stay out).
 */
import * as THREE from 'three';
import type { Actor, ButtonAction, CamPose, CineCtx, Companion, Routine, SayOpts, SpeakerId, Vec3Like, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { yawTo } from '@/core/mathx';
import { S } from './state';

/**
 * Camera beside the line a → b, `dist` metres off it on the side AWAY from the shaft (the parapet and the lift
 * walkway would fill the lens on the other), looking at the middle. `along` slides it toward b.
 */
export function flank(a: Vec3Like, b: Vec3Like, dist: number, height = 1.55, fov = 40, along = 0): CamPose {
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.max(1e-3, Math.hypot(dx, dz));
  let px = -dz / l;
  let pz = dx / l;
  const c = S.centre;
  if (Math.hypot(mx + px - c.x, mz + pz - c.z) < Math.hypot(mx - px - c.x, mz - pz - c.z)) {
    px = -px;
    pz = -pz;
  }
  return {
    pos: { x: mx + px * dist + (dx / l) * along, y: a.y + height, z: mz + pz * dist + (dz / l) * along },
    look: { x: mx, y: a.y + 1.2, z: mz }, fov,
  };
}

/** turn two bodies toward each other (the companion keeps facing the other until told otherwise) */
export function faceOff(sel: Actor, tar: Companion | null): void {
  if (!tar) return;
  const t = tar.actor;
  sel.yaw = yawTo(sel.pos.x, sel.pos.z, t.pos.x, t.pos.z);
  t.yaw = yawTo(t.pos.x, t.pos.z, sel.pos.x, sel.pos.z);
  tar.face(sel.pos.clone());
}

/** chest-height point between two bodies (where the blades meet) */
export function between(a: Actor, b: Actor | undefined, h = 1.4): THREE.Vector3 {
  const p = a.pos.clone();
  if (b) p.lerp(b.pos, 0.5);
  p.y += h;
  return p;
}

/** compass bearing (deg) from one world point to another */
export function bearingDeg(from: Vec3Like, to: Vec3Like): number {
  return (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
}

/** the player's figure plays a one-shot from rest (held poses such as knockdown or the tether are released) */
export function selAct(z: ZoneRuntime, action: string, faceTo?: Vec3Like): void {
  z.game.player.actor.visual?.stop();
  z.game.player.playScripted(action, faceTo ? { faceTo } : undefined);
}

/**
 * One duel prompt: a familiar input in a wide window, auto-confirmed by the accessibility setting. It stays a
 * scene: the context prompt draws by itself over the hidden HUD and its button is read in the cinematic input
 * context (the player's context actions opt it in). Returns whether it was answered. A skip answers nothing and
 * counts as answered: it is choreography only — the outcome never depends on it.
 */
export function* duelPrompt(z: ZoneRuntime, id: string, prompt: string, button: ButtonAction, window: number): Routine<boolean> {
  if (z.skipping) return true;
  const game = z.game;
  const r: { answered: boolean | null } = { answered: null };
  game.time.slowMo(0.42, 0.7);
  game.player.setContextAction({
    id, prompt, button, window, autoConfirmable: true,
    onConfirm: () => { r.answered = true; },
    onExpire: () => { r.answered = false; },
  });
  yield () => r.answered !== null || z.skipping;
  game.player.setContextAction(null);
  return r.answered !== false;
}

type Body = Companion | Actor | null | undefined;

function visualOf(b: Body): import('@/core/api').CharacterVisual | null {
  if (!b) return null;
  return (b as Companion).actor ? (b as Companion).actor.visual : (b as Actor).visual;
}

function posOf(b: Body): THREE.Vector3 | null {
  if (!b) return null;
  return (b as Companion).actor ? (b as Companion).actor.pos : (b as Actor).pos;
}

/**
 * A line in this zone, where the blades stay out. A figure speaking TO THE LEAD goes through the dialogue with
 * `{ actor, keepWeapon: true }` (integration): it turns to her and looks at her eyes, its mouth moves, a drawn
 * weapon stays drawn (the talk gesture would sheathe it) and the zone's `face()` target comes back after the line.
 * The lead's own lines and a line said to someone else (`aside`) keep the facing the scene gave them: only the
 * mouth moves here — the dialogue would turn the lead's head to her nearest ally, not to the man she is facing.
 */
export function* say(
  z: ZoneRuntime, speaker: SpeakerId, text: string, body: Body, opts?: SayOpts & { aside?: boolean },
): Routine {
  const { aside, ...rest } = opts ?? {};
  const who = body ? ((body as Companion).actor ? (body as Companion) : (body as Actor)) : null;
  const actor = who ? ((who as Companion).actor ?? (who as Actor)) : null;
  if (who && actor && actor !== z.player && !aside) {
    yield* z.say(speaker, text, { ...rest, actor: who, keepWeapon: true });
    return;
  }
  const v = visualOf(body);
  if (isHumanoidVisual(v) && !z.skipping) v.setSpeaking(0.7);
  yield* z.say(speaker, text, rest);
  if (isHumanoidVisual(v)) v.setSpeaking(0);
}

/**
 * A two-hander: each line framed over the listener's shoulder (sides alternate so the eyeline holds). The text
 * passes through untouched.
 */
export function* exchange(
  z: ZoneRuntime, c: CineCtx, lines: Array<[SpeakerId, string]>, bodies: Record<string, Body>,
  opts?: { distance?: number; fov?: number },
): Routine {
  let prev: string | null = null;
  let side: 1 | -1 = 1;
  for (const [speaker, text] of lines) {
    const me = posOf(bodies[speaker]);
    const other = Object.keys(bodies).find((k) => k !== speaker && posOf(bodies[k]));
    const them = other ? posOf(bodies[other]) : null;
    if (speaker !== prev && me && them) {
      c.twoShot(me, them, { side, distance: opts?.distance ?? 1.8, fov: opts?.fov ?? 34 });
      side = side === 1 ? -1 : 1;
    }
    prev = speaker;
    yield* say(z, speaker, text, bodies[speaker]);
  }
}
