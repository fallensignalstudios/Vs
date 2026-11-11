/**
 * Z04 · Relay overlook / Encounter E2 — lead: Selene; Tharne and Lyric hold in cover at the entry.
 *
 * SPACE: ./z04/layout.ts (62 × 38 m, built to `pdf/ref-z04-tactical-plan.png`): the entry from Z03 in the south
 * wall, the exit to Z05 in the north wall inside a great gold ring, the +3 m deck on the right (east, against the
 * glass) reached by the south ramp and left by the west ramp, the O2 pocket off the deck, the service lane behind
 * the west colonnade, receivers A (35, 18) and B (16, 27), the scan head S (8, 11). Built by ./z04/space.ts.
 *
 * BEATS (tasks/ZONES.md):
 *   overlook → CP2b  the opening crossfire: four Enforcers in an overlapping shield angle and two contaminated drones
 *                    shoot at each other; neither is on our side. A Z03 detection (`z.flag('z03Detected')`) changes
 *                    Tharne's report, turns the two drones on the entry together and speeds up the scan head.
 *   e2               the encounter (./z04/fight.ts): receivers by shot or by hand, the network, the shield front.
 *   release          the room goes quiet; the exit opens under the white point; O2 (optional) on the pocket.
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z04. The author's lines are exact (curly quotes and apostrophes are the book's); every
 * line and UI string written for the game is tagged `// NEW`.
 */
import * as THREE from 'three';
import type { Actor, Beat, CamPose, CineCtx, Companion, Routine, ZoneDef, ZoneRuntime } from '@/core/api';
import { yawTo } from '@/core/mathx';
import {
  atPost, encounterMusic, feet, setDoor, standardExit, waitOr, walkTo, type ConvLine,
} from './shared';
import {
  armReceivers, detected, e2Barks, e2Done, e2Objective, e2Sustain, notice, quietDevices, restoreAfterE2, setupE2,
  startNetworkClock, startTurn, stepTurn, teachE2, updateE2,
} from './z04/fight';
import { build } from './z04/space';
import { S, resetState } from './z04/state';

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'overlook' | 'fight' | 'release';

/**
 * The lead and her two companions as the given stage finds them — called from every beat's `enter`, so a
 * checkpoint reload or a debug jump lands where the earlier beats leave off. Tharne and Lyric are non-combatants
 * here: protected (never targeted), kneeling behind the entry cover until the room is quiet.
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const end = stage === 'release';
  z.spawnPlayer('selene', end ? 'releaseStart' : 'start');
  z.player.targetable = true;
  const tharne = z.companion('tharne', end ? 'tharneExit' : 'tharneHold', end ? 'follow' : 'hold');
  const lyric = z.companion('lyric', end ? 'lyricExit' : 'lyricHold', 'hold');
  for (const c of [tharne, lyric]) c.actor.protectedNpc = true;
  setDoor(S.entry, false, 'sealed');
  if (end) {
    lyric.holdAt(z.m('lyricExit'), z.myaw('lyricExit'));
    restoreAfterE2(z);
    setDoor(S.exit, false, 'ready');
    return;
  }
  kneelAt(z, tharne, 'tharneHold');
  kneelAt(z, lyric, 'lyricHold');
}

function kneelAt(z: ZoneRuntime, c: Companion, marker: string): void {
  c.holdAt(z.m(marker), z.myaw(marker));
  c.play('kneel');
}

/** centroid (world) of some bodies */
function centre(list: readonly Actor[]): THREE.Vector3 {
  const v = new THREE.Vector3();
  for (const a of list) v.add(a.pos);
  return list.length ? v.multiplyScalar(1 / list.length) : v;
}

/** where the shield line stands now (its posts before it has moved) */
function shieldCentre(z: ZoneRuntime): THREE.Vector3 {
  const shields = S.enc ? S.enc.alive.filter((a) => String(a.archetype) === 'enforcer') : [];
  return shields.length ? centre(shields) : z.m('enf1').lerp(z.m('enf2'), 0.5);
}

/**
 * The crossfire shot, framed on the live positions: from just behind and beside the drone nearest the shield
 * line, looking along its lane at the shields (the two groups move while they fight).
 */
function crossfireShot(z: ZoneRuntime): { from: CamPose; to: CamPose } {
  const line = shieldCentre(z);
  const drones = S.enc ? S.enc.alive.filter((a) => String(a.archetype) === 'contamDrone') : [];
  let d = drones[0]?.pos ?? z.m('droneB');
  for (const a of drones) if (a.pos.distanceTo(line) < d.distanceTo(line)) d = a.pos;
  const away = new THREE.Vector3(d.x - line.x, 0, d.z - line.z);
  if (away.lengthSq() < 1) away.set(0, 0, 1);
  away.normalize();
  const side = new THREE.Vector3(-away.z, 0, away.x);
  const look = line.clone().setY(line.y + 1.3);
  const at = (back: number, off: number, h: number) => new THREE.Vector3(d.x + away.x * back + side.x * off, d.y + h, d.z + away.z * back + side.z * off);
  return { from: { pos: at(3.4, 1.6, 0.9), look, fov: 40 }, to: { pos: at(2.6, 1.2, 0.7), look, fov: 34 } };
}

/** both drones in one frame, from beside the entry cover: the lens widens with their spread */
function dronePair(z: ZoneRuntime, drones: readonly Actor[]): CamPose {
  const pos = z.P(33.4, 4.4, 1.55);
  const mid = drones.length ? centre(drones) : z.P(29, 19, 0);
  let spread = 0;
  for (const a of drones) {
    for (const b of drones) {
      const da = Math.atan2(a.pos.x - pos.x, a.pos.z - pos.z);
      const db = Math.atan2(b.pos.x - pos.x, b.pos.z - pos.z);
      spread = Math.max(spread, Math.abs(Math.atan2(Math.sin(da - db), Math.cos(da - db))));
    }
  }
  // vertical fov for a ~2.2:1 letterboxed frame with a margin either side
  const fov = Math.min(64, Math.max(26, (spread * 180) / Math.PI / 1.6 + 14));
  return { pos, look: mid.setY(mid.y + 0.2), fov };
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `overlook` → CP2b. Through the door into a crossfire that is not about them — yet. */
function* overlook(z: ZoneRuntime): Routine {
  const enc = setupE2(z);
  const game = z.game;
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const alerted = detected(z);
  // the crossfire is already under way when the camera finds it
  yield 0.8;

  yield* z.cinematic('z04-crossfire', function* (c: CineCtx): Routine {
    // the whole hall from the entry: the shield angle small under the gold ring, bolts crossing the floor
    const line = shieldCentre(z);
    c.cut({ pos: z.P(32.4, 1.0, 2.0), look: line.clone().setY(2.6), fov: 50 });
    c.moveAsync({ pos: z.P(31.6, 3.4, 1.85), look: line.clone().setY(1.8), fov: 34 }, 5.5, 'inOut');
    yield 3;
    // the shield front from over a drone's shoulder: violet lanes on amber shields, sidearms answering
    const front = crossfireShot(z);
    c.cut(front.from);
    c.moveAsync(front.to, 4, 'out');
    yield 1.2;
    yield* z.say('Enforcer', 'Drones, left! Hold the line!', { offscreen: true }); // NEW (Dominion drill call)
    yield 0.6;
    if (alerted) {
      // Z03 gave them away: the two drones break off and turn on the entry together
      const drones = enc.alive.filter((a) => String(a.archetype) === 'contamDrone');
      c.cut(dronePair(z, drones));
      yield 0.6;
      game.ai.setCeasefire(true);
      startTurn(drones, z.player.pos, 0.7);
      yield 1.5;
      game.ai.setCeasefire(false);
    }
    // the three of them behind the entry cover
    // they kneel facing the hall: the camera sits low over the barricade top, looking back at their faces
    const sel = feet(z, z.player);
    c.shot(feet(z, tharne), { yawDeg: 20, distance: 1.45, height: 1.42, lookHeight: 1.0, fov: 44 });
    yield* z.say('Tharne', alerted
      ? 'Four Dominion enforcers, two contaminated drones firing on them, and tracking us.' // NEW (Z03 detection variant)
      : 'Four Dominion enforcers and two contaminated drones, firing on each other.', // NEW
    { actor: tharne });
    c.shot(feet(z, lyric), { yawDeg: 345, distance: 1.45, height: 1.42, lookHeight: 1.0, fov: 44 });
    yield* z.say('Lyric', 'They will hold that doorway until it apologizes.', { actor: lyric }); // NEW
    // low, from the hall side: her face, the ribs climbing the entry wall behind her
    c.shot(sel, { yawDeg: 335, distance: 2.5, height: 1.2, lookHeight: 1.62, fov: 36 });
    yield* z.say('Selene', 'Receivers first.', { actor: z.player }); // NEW
    // end state — identical watched or skipped
    stepTurn(Infinity);
    game.ai.setCeasefire(false);
    if (alerted) notice(z, 'z03');
  }, { ceasefire: false });
}

/** `e2`. The encounter: receivers, network, shield front. Released when both receivers are out and the room is clear. */
function* e2(z: ZoneRuntime): Routine {
  const enc = setupE2(z);
  armReceivers(z);
  e2Sustain(z);
  startNetworkClock(z);
  // forked in the beat that needs them, so a debug entry at `e2` gets them too
  z.fork(encounterMusic(z, enc, 'combatSelene', 'approachSelene', { begin: () => !S.unseen }), 'music');
  z.fork(e2Objective(z, enc), 'objective');
  z.fork(e2Barks(z, enc), 'barks');
  z.fork(teachE2(z, enc), 'teach');
  yield z.until(e2Done);
}

/** `release`. The room goes quiet; the exit opens on the white point; O2 waits on the pocket. */
function* release(z: ZoneRuntime): Routine {
  const game = z.game;
  z.objective(null);
  z.hint(null);
  game.audio.stinger('encounterClear');
  quietDevices();
  S.unseen = false;
  z.player.targetable = true;
  yield 1.2;
  // Tharne and Lyric come up from the entry cover
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  if (tharne && tharne.mode !== 'follow') {
    tharne.stopAction();
    tharne.mode = 'follow';
    tharne.follow(z.player);
  }
  if (lyric && !atPost(z, lyric, 'lyricExit', 1.5)) walkTo(z, lyric, 'lyricExit', { run: true });
  if (S.exit) S.exit.setState('ready');
  z.bark('Tharne', 'North door. The atrium is beyond it.', { channel: 'radio' }); // NEW
  armO2(z);
  yield* standardExit(z, S.exit, 'Z05', { at: 'exit' });
}

// =====================================================================================================================
// O2 · elevated sensor reconstruction (optional, ≈ 2 min)
// =====================================================================================================================

function armO2(z: ZoneRuntime): void {
  if (z.state.optional.O2) return;
  z.optionalMarker('O2', 'o2View', 'O2 · Sensor reconstruction'); // NEW
  z.interact({
    id: 'z04-o2', at: 'o2View', prompt: 'Replay the sensor record', radius: 2.2, markerRange: 18, // NEW (prompt)
    onDone: () => {
      z.optionalMarker('O2', null);
      z.fork(o2Scene(z), 'o2');
    },
  });
}

/**
 * The replay of the local collision between the shield line and the drones; Selene's reading of why the line
 * opened fire; then her purpose, the mirror of Tarrik's in O1 (the author's lines, RELOCATED from ch23).
 */
function* o2Scene(z: ZoneRuntime): Routine {
  const tharne = z.cast('tharne');
  yield* z.cinematic('z04-o2', function* (c: CineCtx): Routine {
    walkTo(z, tharne, 'tharneO2');
    z.game.player.cancelAction?.();
    S.holoVisible = 1;
    S.holoProgress = 0.35;
    const holo = z.m('o2Holo');
    c.cut({ pos: z.P(36.6, 33.6, DECK_EYE + 0.4), look: holo.clone().setY(holo.y + 1.2), fov: 46 });
    c.moveAsync({ pos: z.P(37.3, 33.9, DECK_EYE + 0.2), look: holo.clone().setY(holo.y + 1.1), fov: 40 }, 6, 'inOut');
    yield waitOr(z, () => z.skipping || atPost(z, tharne, 'tharneO2', 1.0), 5);
    // still on his way up (he was not following her): place him while the camera is on the replay
    if (tharne && !atPost(z, tharne, 'tharneO2', 1.5)) tharne.teleport(z.m('tharneO2'), z.myaw('tharneO2'));
    tharne?.face(holo);
    if (tharne) z.player.yaw = yawTo(z.player.pos.x, z.player.pos.z, tharne.actor.pos.x, tharne.actor.pos.z);
    tharne?.face(z.player.pos);
    yield* exchange(z, c, tharne, [
      ['Tharne', 'Local sensor record. Their line, then the drones.'], // NEW
      ['Tharne', 'The drones crossed their perimeter first.'], // NEW
    ]);
    S.holoProgress = 0.8;
    yield* exchange(z, c, tharne, [
      ['Selene', 'Automated response to a boundary incursion.'], // RELOCATED (ch24, her answer to Sol)
      ['Tharne', 'Then the drones returned fire. No command traffic on either side.'], // NEW
      ['Tharne', 'We are racing them to secure the terminal site.'], // RELOCATED (ch23)
      ['Selene', 'No.'],
      ['Lyric', 'Then what exactly are we doing?', { channel: 'radio' }],
      ['Selene', 'Keeping anyone from touching it.'],
      ['Lyric', 'Good.', { channel: 'radio' }], // SPEAKER? (untagged in the book; follows “Lyric smiles faintly.”)
    ]);
    yield 0.8;
    // end state — identical watched or skipped
    S.holoProgress = 1;
    if (z.skipping) tharne?.teleport(z.m('tharneO2'), z.myaw('tharneO2'));
    tharne?.face(null);
    if (tharne) tharne.mode = 'follow';
    z.optionalDone('O2');
  });
}

/**
 * Lines on the pocket, framed for its 4 m depth: each speaker over the other's shoulder along the pocket (the
 * replay and the north wall between them); Lyric on the comm holds on Selene. Text passes through untouched.
 */
function* exchange(z: ZoneRuntime, c: CineCtx, tharne: Companion | null, lines: ConvLine[]): Routine {
  let framed = '';
  for (const [speaker, text, opts] of lines) {
    const radio = opts?.channel === 'radio';
    const subject = speaker === 'Tharne' && tharne ? 'Tharne' : 'Selene';
    if (subject !== framed) {
      framed = subject;
      const sel = feet(z, z.player);
      const th = tharne ? feet(z, tharne) : sel;
      if (subject === 'Tharne') c.twoShot(th, sel, { side: -1, distance: 1.5, fov: 36 });
      else c.twoShot(sel, th, { side: -1, distance: 1.5, fov: 36 });
    }
    const actor = radio ? null : speaker === 'Tharne' ? tharne : z.player;
    yield* z.say(speaker, text, { ...opts, actor });
  }
}

/** camera eye height on the deck */
const DECK_EYE = 3 + 1.6;

/** ZoneDef.update: the replay plays on the sim clock while it is visible (a skip snaps it) */
function updateReplay(z: ZoneRuntime, dt: number): void {
  const holo = S.holo;
  if (!holo) return;
  const p = holo.params;
  if (z.skipping) {
    p.visible = S.holoVisible;
    p.progress = S.holoProgress;
    holo.snap();
    return;
  }
  p.visible = S.holoVisible;
  if (S.holoVisible > 0) p.progress = Math.min(S.holoProgress, p.progress + dt / 9);
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  {
    id: 'overlook', checkpoint: 'CP2b',
    enter: (z) => {
      spawnCast(z, 'overlook');
      setupE2(z);
    },
    run: overlook,
  },
  {
    id: 'e2',
    enter: (z) => {
      spawnCast(z, 'fight');
      setupE2(z);
      if (detected(z)) notice(z, 'z03');
    },
    run: e2,
  },
  { id: 'release', enter: (z) => spawnCast(z, 'release'), run: release },
];

const Z04_DEF: ZoneDef = {
  id: 'Z04',
  title: 'Relay Overlook',
  art: 'relay-route',
  cast: ['enforcer', 'contamDrone', 'relayReceiver', 'scanHead', 'tharne', 'lyric', 'selene'],
  build,
  beats,
  update(z, dt) {
    updateE2(z, dt);
    updateReplay(z, dt);
  },
  dispose(z) {
    // an unseen lead is untargetable: never carry that out of the zone
    if (z?.player) z.player.targetable = true;
    resetState();
  },
};

export default Z04_DEF;
