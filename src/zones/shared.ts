/**
 * Shared zone-authoring helpers — distilled from what Z01 needed. Import from '@/zones/shared'.
 * Nothing here is zone-specific: no markers, no lines, no layout. Every helper is skip-safe (state changes
 * happen inside routines) and tolerant of missing cast / stub subsystems.
 *
 *   room        hallShell(b, o)                     floor + four walls + rib row + vault + entry / exit doors
 *   flow        standardExit(z, door, to)           objective → open door → wait at the threshold → z.exit
 *               waitOr(z, pred, seconds)            predicate wait with a sim-time timeout (never soft-locks)
 *   cast        spawnTarrikSquad / spawnSeleneSquad the companions a lead travels with
 *               walkTo(c, pos) / atPost / allArrived scripted moves that survive a skip
 *   dialogue    conversation(z, c, lines, shots)    lines with alternating over-the-shoulder shots
 *               barker(z)                           once-per-key combat barks with a minimum gap
 *   teaching    tutorialHint(z, id, text, button)   a hint that shows once per save
 *   combat      sustainDrops(z, markers)            heal pickups on accessible floor
 *               encounterMusic(z, enc, combat, calm) music follows an encounter's life
 *               whenEnemyDown(z, enc, fn)           callback on each member's death (auto-unsubscribed)
 */
import type * as THREE from 'three';
import type {
  Actor, ButtonAction, CineCtx, Companion, CompanionMode, DoorHandle, Encounter, HumanoidArchetype, MatId,
  MusicState, Routine, SayOpts, SpeakerId, Vec3Like, Wait, WallOpts, ZoneBuilder, ZoneId, ZoneRuntime,
} from '@/core/api';

// ---------------------------------------------------------------------------------------------------------
// Palette (BRIEF §4) — light colours zone scripts reach for; materials come from the kit
// ---------------------------------------------------------------------------------------------------------

/** King-era channel light: recognition and route continuity */
export const GOLD = 0xffc56b;
/** King-era white-gold glow (ribs, seams, the white point) */
export const IVORY = 0xffe2a8;
/** Dominion equipment light */
export const AMBER = 0xffa033;
/** Reformation equipment light */
export const BLUE = 0xa8d8ff;
/** Eclipse — only where a real source exists */
export const VIOLET = 0x7a3cff;
/** Tarrik's Cinder / Selene's Frost */
export const CINDER = 0xff6a1a;
export const FROST = 0xcfeeff;

/** plan compass bearings as kit `yawDeg` (0 = faces north, 90 = faces east) */
export const FACE = { north: 0, east: 90, south: 180, west: 270 } as const;

// ---------------------------------------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------------------------------------

export interface HallShellOpts {
  /** playable envelope: w metres east–west (x), d metres north–south (n), origin at the south-west corner */
  w: number; d: number;
  /** wall height (default 10) and rib apex height (default wall height + 4) */
  height?: number; ribHeight?: number;
  /** long axis the ribs march along: 'x' (hall runs west → east, default) or 'n' (south → north) */
  axis?: 'x' | 'n';
  /** ribs along the hall (default one every ~8 m); 0 = none */
  ribs?: number;
  /** floor inlay (default 'channels') and mirror finish (default true) */
  inlay?: 'none' | 'channels' | 'radial' | 'grid' | 'crownmark';
  reflective?: boolean;
  /** substrate: omit for upper white-gold; 'blackStone' builds the lower-terminal variant */
  mat?: 'blackStone';
  /** door centres measured along their wall from its south / west end; omit entry or exit for a blank wall */
  entryAt?: number; exitAt?: number;
  /** clear door size (default 3 × 3.5; the elite needs 5 × 4.5) */
  doorWidth?: number; doorHeight?: number;
  /** wall treatments: [entry wall, exit wall, left wall, right wall] seen walking from entry to exit */
  styles?: [WallOpts['style'], WallOpts['style'], WallOpts['style'], WallOpts['style']];
  ceiling?: 'vault' | 'flat' | 'lattice' | 'glass' | 'none';
  /** build the entry door closed (default: open behind the player is wrong — entries are sealed once inside) */
  entryOpen?: boolean;
}

export interface HallShell {
  entry: DoorHandle | null;
  exit: DoorHandle | null;
  /** plan positions just inside each door (spawn / exit trigger points) */
  entryInside: [number, number];
  exitInside: [number, number];
}

/**
 * The standard King-era room: floor, four walls with door openings, a rib row along the long axis, a ceiling,
 * an entry door (sealed) and an exit door (locked) with its white point. The hall runs entry → exit along
 * `axis`. Everything else — cover, decks, props, lights, markers — is the zone's own.
 */
export function hallShell(b: ZoneBuilder, o: HallShellOpts): HallShell {
  const height = o.height ?? 10;
  const ribHeight = o.ribHeight ?? height + 4;
  const alongX = (o.axis ?? 'x') === 'x';
  const dw = o.doorWidth ?? 3;
  const dh = o.doorHeight ?? 3.5;
  const wallMat: MatId | undefined = o.mat;
  const floorMat: MatId | undefined = o.mat ? 'blackStoneFloor' : undefined;
  const st = o.styles ?? ['panelled', 'panelled', 'conduit', 'ribbed'];
  const cross = alongX ? o.d : o.w; // width across the hall
  const length = alongX ? o.w : o.d;
  const entryAt = o.entryAt;
  const exitAt = o.exitAt;

  b.floor({ x: o.w / 2, n: o.d / 2, w: o.w, d: o.d, inlay: o.inlay ?? 'channels', reflective: o.reflective !== false, mat: floorMat });
  const door = (at: number | undefined) => (at === undefined ? undefined : [{ at, width: dw, height: dh }]);
  if (alongX) {
    b.wall({ from: [0, 0], to: [0, o.d], height, style: st[0], mat: wallMat, doors: door(entryAt) });
    b.wall({ from: [o.w, 0], to: [o.w, o.d], height, style: st[1], mat: wallMat, doors: door(exitAt) });
    b.wall({ from: [0, o.d], to: [o.w, o.d], height, style: st[2], mat: wallMat });
    b.wall({ from: [0, 0], to: [o.w, 0], height, style: st[3], mat: wallMat });
  } else {
    b.wall({ from: [0, 0], to: [o.w, 0], height, style: st[0], mat: wallMat, doors: door(entryAt) });
    b.wall({ from: [0, o.d], to: [o.w, o.d], height, style: st[1], mat: wallMat, doors: door(exitAt) });
    b.wall({ from: [0, 0], to: [0, o.d], height, style: st[2], mat: wallMat });
    b.wall({ from: [o.w, 0], to: [o.w, o.d], height, style: st[3], mat: wallMat });
  }

  const ribs = o.ribs ?? Math.max(2, Math.round(length / 8));
  if (ribs > 0) {
    const spacing = length / ribs;
    b.ribRow(alongX
      ? { x: spacing / 2, n: o.d / 2, span: cross - 2.4, height: ribHeight, count: ribs, spacing, yawDeg: 90, alongDeg: 90, mat: wallMat }
      : { x: o.w / 2, n: spacing / 2, span: cross - 2.4, height: ribHeight, count: ribs, spacing, mat: wallMat });
  }
  if (o.ceiling !== 'none') b.ceiling({ x: o.w / 2, n: o.d / 2, w: o.w, d: o.d, h: ribHeight + 0.3, style: o.ceiling ?? 'lattice', mat: wallMat });

  let entry: DoorHandle | null = null;
  let exit: DoorHandle | null = null;
  const entryInside: [number, number] = alongX ? [2.4, entryAt ?? o.d / 2] : [entryAt ?? o.w / 2, 2.4];
  const exitInside: [number, number] = alongX ? [o.w - 2.2, exitAt ?? o.d / 2] : [exitAt ?? o.w / 2, o.d - 2.2];
  if (entryAt !== undefined) {
    entry = alongX
      ? b.door({ x: 0, n: entryAt, yawDeg: 90, width: dw, height: dh, open: o.entryOpen === true })
      : b.door({ x: entryAt, n: 0, width: dw, height: dh, open: o.entryOpen === true });
    entry.setState(o.entryOpen === true ? 'open' : 'sealed');
  }
  if (exitAt !== undefined) {
    exit = alongX
      ? b.door({ x: o.w, n: exitAt, yawDeg: 90, width: dw, height: dh })
      : b.door({ x: exitAt, n: o.d, width: dw, height: dh });
    exit.setState('locked');
    if (alongX) b.whitePoint({ x: o.w - 0.9, n: exitAt, h: dh + 1.7 });
    else b.whitePoint({ x: exitAt, n: o.d - 0.9, h: dh + 1.7 });
  }
  return { entry, exit, entryInside, exitInside };
}

// ---------------------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------------------

/**
 * Wait for `pred`, but never longer than `seconds` of sim time. Use it for every wait on movement, arrival or
 * animation so a blocked body cannot soft-lock the mission (and a skipped cinematic does not wait at all when
 * `pred` is written to accept `z.skipping`).
 */
export function waitOr(z: ZoneRuntime, pred: () => boolean, seconds: number): Wait {
  const until = z.time + Math.max(0, seconds);
  return () => pred() || z.time >= until;
}

/**
 * The standard way out: set the objective at the door, open it, wait for the lead at the threshold, leave.
 * `at` is the marker / position the player must reach (default: 1.6 m inside the door). Never returns (the zone
 * unloads) — unless `to` is not registered, in which case `z.exit` warns and returns.
 */
export function* standardExit(
  z: ZoneRuntime, door: DoorHandle | null, to: ZoneId,
  opts?: { objective?: string; at?: string | Vec3Like; radius?: number; fade?: 'white' | 'black' | 'gold'; seconds?: number },
): Routine {
  const at = opts?.at ?? (door ? door.pos : z.player.pos.clone());
  z.objective(opts?.objective ?? 'Reach the lit doorway', at);
  if (door) {
    door.setState('open');
    z.openDoor(door, true);
  }
  yield z.untilNear(at, opts?.radius ?? 2.4);
  z.objective(null);
  yield* z.exit(to, { fade: opts?.fade ?? 'black', seconds: opts?.seconds });
}

/** Put a door in a state without animation or sound (use in `enter()` restores). */
export function setDoor(door: DoorHandle | null, open: boolean, state?: 'locked' | 'ready' | 'open' | 'sealed'): void {
  if (!door) return;
  door.setOpen(open, { instant: true, silent: true });
  door.setState(state ?? (open ? 'open' : 'locked'));
}

// ---------------------------------------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------------------------------------

export interface SquadMarkers {
  /** marker (or position) per member; members without one are not spawned */
  [name: string]: string | Vec3Like | undefined;
}

/**
 * Tarrik's people: Lyessa plus any number of Dominion soldiers. `soldiers` maps a cast name to its marker; they
 * are protected NPCs (never targeted, never damaged) — give them a pose such as 'aimRifle' or 'kneel'.
 */
export function spawnTarrikSquad(
  z: ZoneRuntime,
  o: { lyessa?: string | Vec3Like; lyessaMode?: CompanionMode; soldiers?: Record<string, string | Vec3Like>; soldierPose?: string },
): { lyessa: Companion | null; soldiers: Companion[] } {
  const lyessa = o.lyessa ? z.companion('lyessa', o.lyessa, o.lyessaMode ?? 'follow') : null;
  const soldiers: Companion[] = [];
  for (const [name, at] of Object.entries(o.soldiers ?? {})) soldiers.push(z.npc('dominionSoldier', at, o.soldierPose, name));
  return { lyessa, soldiers };
}

/** Selene's people: Tharne and Lyric (Lyric carries the sealed case — her kit holds it by default). */
export function spawnSeleneSquad(
  z: ZoneRuntime,
  o: { tharne?: string | Vec3Like; lyric?: string | Vec3Like; mode?: CompanionMode },
): { tharne: Companion | null; lyric: Companion | null } {
  const mode = o.mode ?? 'follow';
  return {
    tharne: o.tharne ? z.companion('tharne', o.tharne, mode) : null,
    lyric: o.lyric ? z.companion('lyric', o.lyric, mode) : null,
  };
}

/** The other lead as an AI partner (spawn BEFORE `z.handoff`, which looks the body up by cast name). */
export function spawnPartner(z: ZoneRuntime, who: 'tarrik' | 'selene', at: string | Vec3Like, mode: CompanionMode = 'follow'): Companion {
  return z.companion(who as HumanoidArchetype, at, mode);
}

/**
 * Send a body somewhere as part of a scene. When the scene is being skipped the body is teleported instead, so
 * the world ends in the same state either way (a held pose — knockdown, kneel… — is released in both cases, as
 * `moveTo` does). Pair it with `atPost` when you wait for the arrival: a teleported body may not report `arrived`.
 */
export function walkTo(z: ZoneRuntime, c: Companion | null, at: string | Vec3Like, opts?: { run?: boolean; yaw?: number }): void {
  if (!c) return;
  const pos = typeof at === 'string' ? z.m(at) : at;
  const yaw = opts?.yaw ?? (typeof at === 'string' ? z.myaw(at) : undefined);
  if (z.skipping) {
    c.stopAction();
    c.teleport(pos, yaw);
  } else {
    c.moveTo(pos, { run: opts?.run, yaw });
  }
}

/** true when the body has arrived at (or was teleported onto) `at` — use it in waits after `walkTo` */
export function atPost(z: ZoneRuntime, c: Companion | null, at: string | Vec3Like, within = 0.8): boolean {
  if (!c) return true;
  if (c.arrived) return true;
  const p = typeof at === 'string' ? z.m(at) : at;
  return Math.hypot(c.actor.pos.x - p.x, c.actor.pos.z - p.z) <= within;
}

/** true once every listed body has arrived (missing bodies count as arrived) */
export function allArrived(cs: Array<Companion | null>): boolean {
  return cs.every((c) => !c || c.arrived);
}

/** feet position of a speaker for camera work: a companion, an actor, or a marker / position */
export function feet(z: ZoneRuntime, who: Companion | Actor | string | Vec3Like | null): THREE.Vector3 {
  if (!who) return z.player.pos.clone();
  if (typeof who === 'string') return z.m(who);
  const actor = (who as Companion).actor ?? (who as Actor);
  if (actor && (actor as Actor).pos && typeof (actor as Actor).aimPoint === 'function') return (actor as Actor).pos.clone();
  const v = who as Vec3Like;
  return z.P(0, 0).set(v.x, v.y, v.z);
}

// ---------------------------------------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------------------------------------

export type ConvLine = [SpeakerId, string] | [SpeakerId, string, SayOpts];

export interface ConvCast {
  /** speaker → body (companion / actor) or marker. Speakers not listed keep the previous shot (radio, offscreen). */
  [speaker: string]: Companion | Actor | string | null | undefined;
}

/**
 * Play lines inside a cinematic with tasteful alternating coverage: each on-screen speaker is framed over the
 * shoulder of whoever spoke before (sides alternate so the eyeline stays consistent); a line by the same
 * speaker holds its shot; offscreen / radio lines hold on the listener. Speaking bodies face each other.
 * The lines are passed through untouched — this helper never edits text.
 */
export function* conversation(z: ZoneRuntime, c: CineCtx, lines: ConvLine[], cast: ConvCast, opts?: { distance?: number; fov?: number }): Routine {
  let prev: string | null = null;
  let side: 1 | -1 = 1;
  for (const line of lines) {
    const [speaker, text, say] = line;
    const body = cast[speaker];
    const onScreen = body != null && !(say && (say.offscreen || say.channel === 'radio'));
    if (onScreen && speaker !== prev) {
      const subject = feet(z, body);
      const overBody = prev ? cast[prev] : null;
      if (overBody != null) {
        c.twoShot(subject, feet(z, overBody), { side, distance: opts?.distance, fov: opts?.fov });
        side = side === 1 ? -1 : 1;
      } else {
        c.shot(subject, { yawDeg: 150, distance: 2.6, fov: opts?.fov ?? 38 });
      }
      prev = speaker;
    }
    const actor = body && typeof body !== 'string' ? (body as Companion | Actor) : null;
    yield* z.say(speaker, text, { ...say, actor: say?.actor ?? actor });
  }
}

/**
 * Combat barks with manners: each `key` is said at most once (per zone load), and never within `gap` seconds of
 * the previous bark, so information does not pile up. Returns true when the line was queued.
 */
export function barker(z: ZoneRuntime, gap = 4): (key: string, speaker: SpeakerId, text: string, opts?: SayOpts) => boolean {
  const said = new Set<string>();
  let last = -Infinity;
  return (key, speaker, text, opts) => {
    if (said.has(key) || z.skipping) return false;
    if (z.time - last < gap) return false;
    said.add(key);
    last = z.time;
    z.bark(speaker, text, opts);
    return true;
  };
}

// ---------------------------------------------------------------------------------------------------------
// Teaching
// ---------------------------------------------------------------------------------------------------------

/**
 * A tutorial hint that is shown once (flag `hint:<id>`). The flag lives in the mission state, so it is saved
 * with the NEXT checkpoint: a retry from a checkpoint saved before the hint shows it again (useful after a
 * death), one saved after it does not. Mechanics are taught here, never in dialogue. Returns true when shown.
 */
export function tutorialHint(z: ZoneRuntime, id: string, text: string, button?: ButtonAction, seconds = 7): boolean {
  const key = `hint:${id}`;
  if (z.flag(key) === true) return false;
  z.setFlag(key, true);
  z.hint(text, button, seconds);
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------------------------------------

/** Sustain drops on accessible floor (markers or positions). */
export function sustainDrops(z: ZoneRuntime, at: Array<string | Vec3Like>): void {
  for (const p of at) z.pickup('sustain', p);
}

/**
 * Music follows an encounter: `combat` once it is live, `calm` when it clears. The AI system drives the music
 * INTENSITY from the fight by itself; this only switches states. `begin` delays the switch for encounters whose
 * members start dormant (default: as soon as the encounter is active). Run it with `z.fork(encounterMusic(...))`.
 */
export function* encounterMusic(
  z: ZoneRuntime, enc: Encounter, combat: MusicState, calm: MusicState, opts?: { begin?: () => boolean; fade?: number },
): Routine {
  const audio = z.game.audio;
  const begin = opts?.begin;
  yield () => enc.cleared || (enc.state === 'active' && (!begin || begin()));
  if (!enc.cleared) {
    audio.setMusic(combat, opts?.fade ?? 1.2);
    audio.stinger('encounterStart');
    yield () => enc.cleared;
  }
  audio.setMusic(calm, 2.5);
}

/** Call `fn` for every member of `enc` that dies (unsubscribed when the zone unloads). */
export function whenEnemyDown(z: ZoneRuntime, enc: Encounter, fn: (actor: Actor, killer: Actor | null) => void): void {
  const off = z.game.events.on('actor:died', ({ actor, killer }) => {
    if (enc.has ? enc.has(actor) : true) fn(actor, killer);
  });
  z.onDispose(off);
}

/** Subscribe to a game event for the lifetime of the zone. */
export function onZoneEvent<K extends keyof import('@/core/api').GameEvents>(
  z: ZoneRuntime, type: K, fn: (payload: import('@/core/api').GameEvents[K]) => void,
): void {
  z.onDispose(z.game.events.on(type, fn));
}
