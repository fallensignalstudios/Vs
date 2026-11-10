/**
 * Z11 — staging for the seated scenes: seating the two leads, the camera setups around the table, and a small
 * line runner. Shared by the conversation (./table.ts), O4 (./o4.ts) and the alert.
 *
 * COVERAGE. The line of action runs west–east across the table (Tarrik west, Selene east, at the window end).
 * Every camera stays on its SOUTH side, so eyelines never flip, and the singles are angled so each lead is framed
 * against their own remnant: Tarrik against the red one (north-west), Selene against the hard white one
 * (north-east). The profile two-shot from the table's south end puts the Wound between them. Every setup drifts a
 * little while it holds — the room is quiet, never static.
 */
import * as THREE from 'three';
import type { CamPose, CineCtx, Companion, Routine, SayOpts, ZoneRuntime } from '@/core/api';
import { S, humanoid } from './state';
import { SEAT_SELENE, SEAT_TARRIK } from './layout';

export const SEAT_T = `seat${SEAT_TARRIK}`;
export const SEAT_S = `seat${SEAT_SELENE}`;

// =====================================================================================================================
// Seating
// =====================================================================================================================

/** the player (Selene) sits in her chair: pinned, sheathed gear stowed */
export function sitPlayer(z: ZoneRuntime): void {
  const g = z.game;
  g.player.teleport(z.m(SEAT_S), z.myaw(SEAT_S));
  z.player.fixed = true;
  humanoid(z.player)?.setLoadout({ hideSheathed: true });
  g.player.playScripted('sit');
  humanoid(z.player)?.teleported();
  S.seated = true;
}

/** the player stands up beside her chair (or at `at`) */
export function standPlayer(z: ZoneRuntime, at = 'lingerAt'): void {
  const v = z.player.visual;
  v?.stop('sit');
  v?.stop();
  z.player.fixed = false;
  humanoid(z.player)?.setLoadout({ hideSheathed: false });
  z.game.player.teleport(z.m(at), z.myaw(at));
  S.seated = false;
}

/** Tarrik in his chair */
export function sitTarrik(z: ZoneRuntime, t: Companion | null): void {
  if (!t) return;
  t.stopAction();
  t.teleport(z.m(SEAT_T), z.myaw(SEAT_T));
  humanoid(t.actor)?.setLoadout({ hideSheathed: true });
  t.play('sit');
}

export function standTarrik(z: ZoneRuntime, t: Companion | null, at?: string): void {
  if (!t) return;
  t.stopAction();
  humanoid(t.actor)?.setLoadout({ hideSheathed: false });
  if (at) t.teleport(z.m(at), z.myaw(at));
}

// =====================================================================================================================
// Camera setups
// =====================================================================================================================

export type Shot =
  /** from the table's south end, low: both in profile, the Wound between them */
  | 'two'
  /** the room: the whole window, the table small in front of it */
  | 'wide'
  /** high three-quarter from the south-east */
  | 'high'
  /** singles, each against their own remnant */
  | 'T' | 'S'
  /** over the listener's shoulder (south side) */
  | 'otsT' | 'otsS'
  /** looking down on the table between them */
  | 'table'
  /** behind Tarrik, low, toward the Wound (rule three) */
  | 'wound';

const v = (x: number, y: number, zz: number): THREE.Vector3 => new THREE.Vector3(x, y, zz);

/** the head of a seated lead (world) */
function head(z: ZoneRuntime, seat: string): THREE.Vector3 {
  return z.m(seat).setY(1.2);
}

/** a pose for a setup, plus the pose it drifts to while it holds */
export function setup(z: ZoneRuntime, shot: Shot): { a: CamPose; b: CamPose } {
  const t = head(z, SEAT_T);
  const s = head(z, SEAT_S);
  const mid = t.clone().lerp(s, 0.5);
  const P = (x: number, n: number, h: number): THREE.Vector3 => z.P(x, n, h);
  switch (shot) {
    case 'two': {
      const a = { pos: mid.clone().add(v(0, 0.12, 3.2)), look: mid.clone().add(v(0, 0.95, -6)), fov: 44 };
      return { a, b: { ...a, pos: a.pos.clone().add(v(0, -0.03, -0.35)), fov: 42 } };
    }
    case 'wide': {
      const a = { pos: P(12, 19.6, 1.35), look: P(12, 32, 3.3), fov: 52 };
      return { a, b: { pos: P(12, 21.0, 1.25), look: P(12, 32, 3.1), fov: 49 } };
    }
    case 'high': {
      const a = { pos: P(17.6, 22.2, 3.3), look: mid.clone().add(v(0, -0.25, 0)), fov: 40 };
      return { a, b: { pos: P(17.2, 22.7, 3.1), look: a.look, fov: 38 } };
    }
    case 'T':
    case 'S': {
      // the camera south of the line, low, angled so the subject's own remnant hangs above and behind them
      const subj = shot === 'T' ? t : s;
      const bearing = THREE.MathUtils.degToRad(shot === 'T' ? 132 : 228);
      const d = 2.55;
      const pos = subj.clone().add(v(Math.sin(bearing) * d, -0.24, -Math.cos(bearing) * d));
      const look = subj.clone().add(v(0, 0.36, 0));
      const a = { pos, look, fov: 34 };
      const in2 = pos.clone().lerp(subj, 0.07);
      return { a, b: { pos: in2, look, fov: 33 } };
    }
    case 'otsS':
    case 'otsT': {
      // over the listener's south shoulder
      const over = shot === 'otsS' ? t : s;
      const subj = shot === 'otsS' ? s : t;
      const away = over.clone().sub(subj).setY(0).normalize();
      const south = v(0, 0, 1);
      const pos = over.clone().addScaledVector(away, 0.85).addScaledVector(south, 0.42).setY(1.42);
      const look = subj.clone().add(v(0, 0.02, 0));
      const a = { pos, look, fov: 31 };
      return { a, b: { pos: pos.clone().addScaledVector(away, -0.1), look, fov: 30 } };
    }
    case 'table': {
      const a = { pos: mid.clone().add(v(0, 0.42, 1.1)), look: mid.clone().setY(0.78).add(v(0, 0, -0.1)), fov: 38 };
      return { a, b: { pos: a.pos.clone().add(v(0, -0.06, -0.12)), look: a.look, fov: 36 } };
    }
    case 'wound': {
      const a = { pos: t.clone().add(v(-0.75, -0.22, 1.7)), look: P(13.2, 32, 3.6), fov: 50 };
      return { a, b: { pos: a.pos.clone().add(v(0.05, 0, -0.2)), look: a.look, fov: 48 } };
    }
  }
}

/** cut to a setup and let it drift for `hold` seconds */
export function frame(z: ZoneRuntime, c: CineCtx, shot: Shot, hold = 7): void {
  const { a, b } = setup(z, shot);
  c.cut(a);
  c.moveAsync(b, hold, 'inOut');
}

// =====================================================================================================================
// Line runner
// =====================================================================================================================

export type Who = 'Tarrik' | 'Selene';
/** a line (speaker, exact text, optional setup to cut to first, say options) · a pause · an action */
export type Step = [Who, string] | [Who, string, Shot | null] | [Who, string, Shot | null, SayOpts] | number | ((c: CineCtx) => Routine | void);

/**
 * Play steps: each line by a lead; when the speaker changes and the step names no setup, coverage alternates
 * between that lead's single and the over-the-shoulder, with the profile two-shot every few changes.
 * Lines pass through untouched.
 */
export function* run(z: ZoneRuntime, c: CineCtx, steps: Step[], tarrik: Companion | null): Routine {
  let prev: Who | null = null;
  for (const st of steps) {
    if (typeof st === 'number') {
      yield st;
      continue;
    }
    if (typeof st === 'function') {
      const r = st(c);
      if (r) yield* r;
      continue;
    }
    const [who, text, shot, opts] = st;
    if (shot) frame(z, c, shot);
    else if (who !== prev && shot !== null) frame(z, c, nextCover(who));
    prev = who;
    const actor = who === 'Selene' ? z.player : tarrik?.actor ?? null;
    yield* z.say(who, text, { actor, ...opts });
  }
}

const turns = { all: 0, Tarrik: 0, Selene: 0 };
function nextCover(who: Who): Shot {
  turns.all++;
  if (turns.all % 7 === 0) return 'two';
  const single = turns[who]++ % 2 === 0;
  if (who === 'Tarrik') return single ? 'T' : 'otsT';
  return single ? 'S' : 'otsS';
}
/** restart the coverage pattern (each scene) */
export function resetCover(): void {
  turns.all = 0;
  turns.Tarrik = 0;
  turns.Selene = 0;
}

/** a pair of quoted pieces the book splits with a speech tag, played as one line */
export function joined(...parts: string[]): string {
  return parts.join(' ');
}
