/**
 * Z07 · Capture-control gallery — enter as Tarrik, handoff to Selene inside `cages`.
 *
 *   space (./z07/layout.ts) → cast → beats → ZoneDef;  the cage acts in ./z07/cages.ts;  the bridge, the West /
 *   East choice and O3 in ./z07/choice.ts;  the medics, stretcher cases and walking wounded in ./z07/people.ts
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north): a 34 × 22 m black-stone gallery
 * below grade (authored at local 0). The north wall is glass and looks OUT of the terminal: both containment cages
 * float in vacuum at scenic distance, the Crownwatch resonator to the north-west and the Reformation extraction
 * drone's cold-field envelope to the north-east. At the glass: the external fire-control station and the
 * auxiliary desk (the interoperability display over it); the O3 side console by the west wall. South: the
 * recovery panel in front of the exit door to Z08; the two survivor routes leave through the west and east walls.
 *
 * BEATS (tasks/ZONES.md, SCRIPT_SOURCE Z07): `cages` (fixed story acts: Lyric names the danger; Tarrik fires the
 * Dominion lance battery against Cross; `z.handoff('selene')`; Selene fires two volleys against Sol; the two
 * displays) · `bridge` (Tharne's interoperability channel; the author's two sentences) · `choice` → CP4b (the
 * plating, the people, the physical panel: explicit, untimed, `z.commitRescuePriority` once; O3 available).
 * CP4b restores the world AFTER `bridge`: both cages destroyed, the channel open, Selene leading, the choice unset —
 * or, after the commit, the acknowledged state (a reload never offers the panel again).
 *
 * SCRIPT: the author's lines are exact (curly apostrophes are the book's); every line and UI string written for
 * the game is tagged `// NEW`.
 */
import * as THREE from 'three';
import type { Beat, Routine, ZoneDef, ZoneRuntime } from '@/core/api';
import { VIOLET } from './shared';
import { bothCagesGone, cagesScene, seleneFires, tarrikFires } from './z07/cages';
import { bridgeScene, choiceBeat, exitReady, streamsOpen } from './z07/choice';
import { build } from './z07/layout';
import { resetPeople, spawnPeople, updatePeople } from './z07/people';
import { S, resetState } from './z07/state';

/** Lyric's corruption level through Z07 (Z06 leaves her at 0.3; never cured, never explained) */
const LYRIC_CORRUPTION = 0.3;
/** rim light on each cage at full (candela; the cages are ~150 m out) */
const RIM = 2600;
const VIOLET_C = new THREE.Color(VIOLET);

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'cages' | 'bridge' | 'choice';

/**
 * Spawn the lead and the cast as the given stage finds them. Called from every beat's `enter` — the world a
 * checkpoint reload or a debug jump lands in must equal the one the earlier beats leave behind.
 *  - 'cages':  Tarrik inside, a few steps from the station; Selene at the glass; Lyric on the floor against a
 *              pylon with Tharne kneeling beside her; Lyessa near Tarrik; both groups of survivors waiting.
 *  - 'bridge': both cages destroyed; Selene leads, at the station; Tarrik stepped aside.
 *  - 'choice': the channel open; Tharne at the desk. Before the commit Lyessa is at the panel once the plating
 *              has fallen; after it she holds her route and the chosen group is inside it.
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const game = z.game;
  const priority = z.state.rescuePriority;
  const committed = stage === 'choice' && priority !== 'pending';
  const plating = stage === 'choice' && (committed || z.flag('z07Plating') === true);
  if (stage === 'cages') {
    z.spawnPlayer('tarrik', 'tarrikEnter');
    z.companion('selene', 'seleneGlass', 'scripted');
  } else {
    z.spawnPlayer('selene', 'station');
    z.companion('tarrik', 'tarrikAside', 'scripted');
  }
  // Lyessa: near Tarrik; at the panel once the plating is down; at her route once the priority stands
  const lyAt = committed ? (priority === 'WestStretchers' ? 'lyessaWest' : 'lyessaEast') : plating ? 'lyessaPanel' : 'lyessaStart';
  const lyessa = z.companion('lyessa', lyAt, 'hold');
  lyessa.holdAt(z.m(lyAt), z.myaw(lyAt));
  if (committed) lyessa.play('aimRifle', { loop: true });
  // Tharne beside Lyric (at the desk once he has opened the channel); Lyric on the floor where he set her down
  const tharneAt = stage === 'choice' ? 'tharneDesk' : 'tharne';
  const tharne = z.companion('tharne', tharneAt, 'hold');
  if (stage !== 'choice') tharne.play('kneel', { loop: true });
  const lyric = z.companion('lyric', 'lyric', 'hold');
  lyric.play('sitInjured', { loop: true });
  lyric.actor.visual?.setCorruption(LYRIC_CORRUPTION);
  for (const c of [tharne, lyric]) c.actor.protectedNpc = true;
  spawnPeople(z, committed ? priority : 'pending');

  // the world the earlier beats leave behind
  if (stage !== 'cages') bothCagesGone(z, true);
  if (stage === 'choice') {
    streamsOpen(true);
    z.story('threatExchangeOpen');
    game.sky.setBattleIntensity(0.12);
    for (const o of S.plating) o.visible = plating;
    if (committed) {
      if (priority === 'WestStretchers' && S.cacheWest) S.cacheWest.visible = true;
      exitReady();
    }
  }
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `cages`. What they see, “Kill them.”, Cross; Tarrik's shot; the handoff; Sol; Selene's two volleys. */
function* cages(z: ZoneRuntime): Routine {
  yield* cagesScene(z);
  yield* tarrikFires(z);
  yield* seleneFires(z);
}

/** `bridge`. Tharne opens the local interoperability channel. */
function* bridge(z: ZoneRuntime): Routine {
  yield* bridgeScene(z);
}

/** `choice` → CP4b. The plating, the people, the panel; O3; the way down to Z08. */
function* choice(z: ZoneRuntime): Routine {
  yield* choiceBeat(z);
}

const beats: Beat[] = [
  { id: 'cages', enter: (z) => spawnCast(z, 'cages'), run: cages },
  { id: 'bridge', enter: (z) => spawnCast(z, 'bridge'), run: bridge },
  { id: 'choice', checkpoint: 'CP4b', enter: (z) => spawnCast(z, 'choice'), run: choice },
];

// =====================================================================================================================
// Per-frame zone animation (sim clock; a skip snaps)
// =====================================================================================================================

function update(z: ZoneRuntime, dt: number): void {
  const snap = z.skipping;
  // the cages' rim light: faction colour, pulled toward violet as the Eclipse uses the field; out once destroyed
  for (const rig of [S.dom, S.ref]) {
    if (!rig) continue;
    rig.spread += (rig.spreadTarget - rig.spread) * (snap ? 1 : 1 - Math.exp(-dt * 0.8));
    rig.lit += (rig.litTarget - rig.lit) * (snap ? 1 : 1 - Math.exp(-dt * 1.6));
    rig.light.color.copy(rig.tint).lerp(VIOLET_C, 0.7 * rig.spread);
    rig.light.intensity = RIM * rig.lit * (1 + 0.4 * rig.spread);
  }
  // every Reformation system in range flickers while the Eclipse uses the field
  S.flicker = Math.max(0, S.flicker - dt);
  S.refLights.forEach((l, i) => {
    const base = S.refLightBase[i] ?? l.intensity;
    if (S.flicker <= 0 || snap) {
      l.intensity = base;
      return;
    }
    const n = Math.sin(z.time * 31 + i * 2.1) * Math.sin(z.time * 11.7 + i * 0.7);
    l.intensity = base * (n > -0.2 ? 0.7 + 0.3 * Math.abs(n) : 0.1);
  });
  for (const p of [...S.streamLabels, S.recordText, S.stripSelene, S.stripTarrik]) p?.update(dt, snap);
  updatePeople(z, dt);
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const Z07_DEF: ZoneDef = {
  id: 'Z07',
  title: 'Capture-Control Gallery',
  art: 'quarantine-cooperation',
  cast: ['selene', 'lyessa', 'tharne', 'lyric', 'medic', 'survivor', 'dominionSoldier', 'reformationSoldier', 'reformationMarine'],
  build,
  beats,
  update,
  dispose() {
    resetState();
    resetPeople();
  },
};

export default Z07_DEF;
