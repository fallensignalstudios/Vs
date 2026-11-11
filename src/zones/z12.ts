/**
 * Z12 · Outer-ring hangar — lead: Tarrik. Vignette: depart. Quiet; no stinger fight.
 *
 * SPACE (./z12/layout.ts): a 42 × 24 m common concourse on the outer ring, open to space on the north. The
 * Dominion shuttle at the western berth, the Reformation transport at the eastern one (hero props, ramps open
 * toward the concourse); both fleets hold at a wary distance; the Wound between the remnants above the open edge.
 *
 * BEATS
 *   concourse  Tarrik and Selene come in together; the regrouping (the three O4-gated lines read
 *              `state.optional.O4`); “Still coming.”, twice; Tharne will not promise; the hangar alert.
 *   farewell   beneath the Wound: the one-use ciphers, “Do not kneel.”, the eagle, the forearm clasp —
 *              “Recognition. Nothing more.”
 *   departure  they release, turn, look back, turn away first; Tarrik walks to his shuttle; the two craft leave
 *              along opposite vectors; the displays; the book's closing cards and the restrained final visual
 *              (alternative-authority studies — it implies nothing about later events). `z.completeMission()` (CP9).
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z12. The author's lines are exact; lines marked (ext — trimmed) are not played. Every
 * UI string written for the game is tagged `// NEW`.
 */
import type { Beat, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { walkTo } from './shared';
import { lyricFace, sheathe } from './z11/framing';
import { buildScenic, buildSpace } from './z12/layout';
import { S, buildObjects, carry, resetZ12, updateZ12 } from './z12/state';
import { concourseScene, departureScene, farewellScene, releaseScene, toShips } from './z12/scenes';

function build(b: ZoneBuilder): void {
  resetZ12();
  const sp = buildSpace(b);
  buildObjects(b, sp);
  buildScenic(b);
  b.finalize();
}

type Stage = 'concourse' | 'farewell' | 'departure';

/** the lead and the cast as each stage finds them (every beat's `enter`) */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const first = stage === 'concourse';
  z.spawnPlayer('tarrik', first ? 'start' : 'tarrikFarewell');
  const selene = z.companion('selene', first ? 'seleneStart' : 'seleneFarewell', first ? 'follow' : 'hold');
  if (!first) selene.holdAt(z.m('seleneFarewell'), z.myaw('seleneFarewell'));
  const lyessa = z.companion('lyessa', 'lyessaWait', 'hold');
  lyessa.holdAt(z.m('lyessaWait'), z.myaw('lyessaWait'));
  const tharne = z.companion('tharne', 'tharneWait', 'hold');
  tharne.holdAt(z.m('tharneWait'), z.myaw('tharneWait'));
  const lyric = z.companion('lyric', 'lyricWait', 'hold');
  lyric.holdAt(z.m('lyricWait'), z.myaw('lyricWait'));
  lyricFace(lyric);
  sheathe(z.player, selene); // nobody here is fighting
  // she still has the Cauldron recorder in her hand
  carry(S.recorder, selene.actor, 'handL');
  if (!first) toShips(z, false);
}

/** `concourse`: they come in together; the others come to meet them; the regrouping */
function* concourse(z: ZoneRuntime): Routine {
  z.titleCard();
  z.objective('Cross the concourse', 'meet'); // NEW
  yield z.untilNear('meet', 6.5);
  for (const [n, m] of [['lyessa', 'lyessaMeet'], ['tharne', 'tharneMeet'], ['lyric', 'lyricMeet']] as const) walkTo(z, z.cast(n), m);
  yield z.untilNear('meet', 2.8);
  z.objective(null);
  yield* concourseScene(z);
}

/** `farewell`: the two of them, beneath the Wound */
function* farewell(z: ZoneRuntime): Routine {
  // the score's farewell cue (farewell_departure) carries through the release and the departure
  z.game.audio.setMusic('farewell', 2);
  yield* farewellScene(z);
}

/** `departure`: release, the look back, the walk to the shuttle, the two craft leave; CP9 */
function* departure(z: ZoneRuntime): Routine {
  z.game.audio.setMusic('farewell', 2); // (already playing after `farewell`; a checkpoint or debug entry starts it)
  yield* releaseScene(z);
  z.objective('Walk to the shuttle', 'domRampBottom'); // NEW
  yield z.untilNear('domRampBottom', 2.4);
  z.objective(null);
  // the scene ends with `z.completeMission()` (CP9: containment closed, Meridian complete, release withheld, the
  // recorded local priority, the exchange and the pact are all in the saved state by now)
  yield* departureScene(z);
  yield* z.completeMission();
}

const beats: Beat[] = [
  { id: 'concourse', enter: (z) => spawnCast(z, 'concourse'), run: concourse },
  { id: 'farewell', enter: (z) => spawnCast(z, 'farewell'), run: farewell },
  { id: 'departure', enter: (z) => spawnCast(z, 'departure'), run: departure },
];

const Z12_DEF: ZoneDef = {
  id: 'Z12',
  title: 'Outer-Ring Hangar',
  art: 'wound-overlook',
  cast: ['selene', 'lyessa', 'tharne', 'lyric'],
  build,
  beats,
  /** the craft's departure, the carried recorder and ciphers, the alert projection */
  update: updateZ12,
  dispose() {
    S.sp?.dom?.dispose();
    S.sp?.ref?.dispose();
    resetZ12();
  },
};

export default Z12_DEF;
