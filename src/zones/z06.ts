/**
 * Z06 · Breach rescue / Encounter E3 — lead: Tarrik; Selene fights beside him as AI.
 *
 *   space (./z06/layout.ts) → cast → beats → ZoneDef;  E3 in ./z06/fight.ts;  the authored scenes in ./z06/scenes.ts
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north): a 56 × 34 m junction at datum 0,
 * entered from the west (n 22), left by the east door (n 24) to Z07. The fallen plate lies in the middle with the
 * Reformation marine pinned under it, its lifting edge on the protected (south-west) side; a broad left (north)
 * push lane, a right (south) rescue loop, an elevated wall seam on the north pier, two visible breaches (north and
 * south walls), a side refuge +1 m against the west wall. See ./z06/layout.ts.
 *
 * BEATS (tasks/ZONES.md): `breach` → CP4 (the first body: «King?»; Selene, Tharne and Lyric come in behind; E3
 * wakes; the opening; the approach) · `rescue` (the plate, «Move.», the rest of E3) · `grounding` (Lyric's episode,
 * the walk to the exit). CP4 restores: carrier lost, terminal standing, Tarrik controlled, Selene companion.
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z06. The author's lines are exact (curly apostrophes are the book's); every line and
 * UI string written for the game is tagged `// NEW`.
 */
import type { Beat, Routine, ZoneDef, ZoneRuntime } from '@/core/api';
import { setDoor } from './shared';
import { burstBreachB, liftInteraction, setupE3, startFight, updateFight, wakeE3 } from './z06/fight';
import { build } from './z06/layout';
import { LYRIC_CORRUPTION, arrival, groundingScene, kingScene, rescueScene, toTheGallery } from './z06/scenes';
import { S, resetState } from './z06/state';

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'breach' | 'fight' | 'after';

/**
 * Spawn the lead and the cast as the given stage finds them. Called from every beat's `enter` — the world a
 * checkpoint reload or a debug jump lands in must equal the one the earlier beats leave behind.
 *  - 'breach': Tarrik and Lyessa just inside the entry; Selene, Tharne and Lyric still in the corridor behind.
 *  - 'fight':  everyone in; Lyessa on her lane, Tharne and Lyric kneeling on the refuge, the marine pinned.
 *  - 'after':  the fight is over, the marine out and on the refuge, the second breach open, the exit ready.
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const after = stage === 'after';
  const fight = stage === 'fight';
  z.spawnPlayer('tarrik', after ? 'gTarrik' : fight ? 'rescueStart' : 'start');
  // Lyessa holds a defensive lane by the plate; she is never the answer to the encounter
  const lyessaAt = after ? 'gLyessa' : fight ? 'lyessaPost' : 'lyessaStart';
  const lyessa = z.companion('lyessa', lyessaAt, 'hold');
  lyessa.holdAt(z.m(lyessaAt), z.myaw(lyessaAt));
  // Selene: behind them in the corridor at first (scripted), then at his side (combat)
  const seleneAt = after ? 'gSeleneStand' : fight ? 'selenePost' : 'seleneOut';
  z.companion('selene', seleneAt, fight ? 'combat' : 'scripted');
  // Tharne and Lyric: protected, at the rear
  const tharne = z.companion('tharne', stage === 'breach' ? 'tharneOut' : 'tharneRefuge', 'hold');
  const lyric = z.companion('lyric', stage === 'breach' ? 'lyricOut' : 'lyricRefuge', 'hold');
  for (const c of [tharne, lyric]) c.actor.protectedNpc = true;
  if (stage !== 'breach') {
    tharne.play('kneel', { loop: true });
    lyric.play('kneel', { loop: true });
  }
  lyric.actor.visual?.setCorruption(after ? LYRIC_CORRUPTION.after : LYRIC_CORRUPTION.arrive);
  // a Dominion soldier sheltering on the refuge with them; the marine under the plate (or out of it)
  z.npc('dominionSoldier', 'soldierRefuge', 'sitInjured', 'soldier');
  z.npc('reformationMarine', after ? 'marineSafe' : 'marine', after ? 'sitInjured' : 'trapped', 'marine');
  if (after) {
    burstBreachB(z, false);
    z.story('marineRescued');
    setDoor(S.exit, false, 'ready');
  }
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `breach` → CP4. «King?»; the others come in; E3 wakes; the opening; until the rescue approach is open. */
function* breach(z: ZoneRuntime): Routine {
  const enc = setupE3(z);
  yield* kingScene(z);
  wakeE3(z);
  startFight(z, enc);
  liftInteraction(z);
  z.objective('Reach the trapped marine', 'plateStand'); // NEW
  yield* arrival(z, enc);
  yield z.until(() => enc.flags.rescueOpen === true);
}

/** `rescue`. The plate from its protected side, «Move.», and the rest of E3 (the second breach, the links). */
function* rescue(z: ZoneRuntime): Routine {
  const enc = setupE3(z);
  wakeE3(z);
  enc.flags.seleneIn = true;
  enc.flags.rescueOpen = true;
  z.setFlag('z06RescueOpen', true);
  startFight(z, enc);
  const lift = liftInteraction(z);
  z.objective('Lift the plate', 'plateStand'); // NEW
  yield z.untilInteract(lift);
  yield* rescueScene(z);
  if (!enc.cleared) {
    z.objective('Hold the junction'); // NEW
    yield z.until(() => enc.cleared);
  }
  z.objective(null);
}

/** `grounding`. The last body is down: Lyric's episode (protected), then the cover-lined route to the exit. */
function* grounding(z: ZoneRuntime): Routine {
  const game = z.game;
  z.objective(null);
  z.hint(null);
  game.ui.marker('z06-opening', null);
  game.audio.stinger('encounterClear');
  S.anchor?.remove();
  setDoor(S.exit, false, 'ready');
  yield 1.4;
  yield* groundingScene(z);
  yield* toTheGallery(z);
}

const beats: Beat[] = [
  { id: 'breach', checkpoint: 'CP4', enter: (z) => spawnCast(z, 'breach'), run: breach },
  { id: 'rescue', enter: (z) => spawnCast(z, 'fight'), run: rescue },
  { id: 'grounding', enter: (z) => spawnCast(z, 'after'), run: grounding },
];

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const Z06_DEF: ZoneDef = {
  id: 'Z06',
  title: 'Breach Rescue',
  art: 'quarantine-cooperation',
  cast: ['linkbound', 'wallrunner', 'weaver', 'weaverAnchor', 'reformationMarine', 'dominionSoldier', 'selene', 'lyessa', 'tharne', 'lyric'],
  build,
  beats,
  /** per-frame zone animation on the sim clock: the seam's light, the plate following the hold */
  update: updateFight,
  dispose() {
    resetState();
  },
};

export default Z06_DEF;
