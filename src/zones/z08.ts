/**
 * Z08 · Quarantine crucible / Encounter E4 — enter as Selene, handoff to Tarrik. The officer: kill or spare.
 *
 * SPACE: ./z08/layout.ts (70 × 48 m, the elite court at its centre, W / E loops, the east deck +3 m, survivor
 * recesses W and E behind the fight, the north doorway — the organism's breach and later the one-way descent).
 *
 * BEATS (tasks/ZONES.md; SCRIPT_SOURCE.md § Z08 — the author's lines are exact, every new line and UI string is
 * tagged `// NEW`):
 *   phaseA → CP5   Selene. The organism pushes through the breach; a Weaver and two linkbound feed its regeneration
 *                  through links; a wall-runner joins after the first cut; the pressure contest; Lyessa at the
 *                  support position chosen in Z07 (`z.state.rescuePriority`, debug entry = West) and the choice's
 *                  consequence announced (West: the field cache; East: the manual shutter and the east flank).
 *   phaseB → CP5b  `z.handoff('tarrik')`. Selene to the frost anchor; the joint Resonance (Thermal Fracture); the
 *                  authored finish with the officer and the second recorded choice `officerFate` (CP5b saved again
 *                  after the commit — a reload then replays the finish with the recorded answer).
 *   quarantine     the court clears, the officer is acknowledged once, the barriers separate them, the descent.
 *
 * FILES: ./z08/state.ts (per-load state) · layout.ts (build) · fight.ts (E4) · finish.ts (the officer) ·
 * people.ts (survivors, litters) · quarantine.ts (the last scene and the descent).
 */
import type { Beat, CineCtx, Routine, ZoneDef, ZoneRuntime } from '@/core/api';
import { setDoor, sustainDrops, tutorialHint, walkTo } from './shared';
import {
  barksA, isolateA, lyessaSupport, phaseADone, phaseAFailsafe, resonanceLoop, setupE4, teachA, updateFight, wakeE4,
} from './z08/fight';
import { finishScene, restoreOfficer, updateOfficer } from './z08/finish';
import { build } from './z08/layout';
import { spawnSurvivors, updateLitters, walkersToShutter } from './z08/people';
import { descend, quarantineScene } from './z08/quarantine';
import { S, resetState } from './z08/state';

// =====================================================================================================================
// The Z07 choice and the Z08 one, as this zone reads them
// =====================================================================================================================

/** West unless the Z07 panel committed East (a debug entry with the priority still pending defaults to West) */
function westChosen(z: ZoneRuntime): boolean {
  return z.state.rescuePriority !== 'EastWalkers';
}

/** the recorded officer choice; unset (debug entry) counts as 'killed' */
function officerFate(z: ZoneRuntime): 'killed' | 'spared' {
  return z.flag('officerFate') === 'spared' ? 'spared' : 'killed';
}

function fateRecorded(z: ZoneRuntime): boolean {
  const f = z.flag('officerFate');
  return f === 'killed' || f === 'spared';
}

// =====================================================================================================================
// Cast
// =====================================================================================================================

/** Lyric's corruption (face-only), as Z07 leaves her */
const LYRIC_CORRUPTION = 0.45;

type Stage = 'A' | 'B' | 'finish' | 'quarantine';

/**
 * The lead, the cast and the world as the given stage finds them — called from every beat's `enter`, so a
 * checkpoint reload or a debug jump lands where the earlier beats leave off.
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const west = westChosen(z);
  const late = stage === 'finish' || stage === 'quarantine';
  if (stage === 'A') {
    z.spawnPlayer('selene', 'start');
    z.companion('tarrik', 'tarrikStart', 'combat');
  } else if (stage === 'B') {
    z.spawnPlayer('tarrik', 'tarrikB');
    z.companion('selene', 'frostAnchor', 'scripted');
  } else {
    z.spawnPlayer('tarrik', 'tarrikFinish');
    z.companion('selene', 'seleneFinish', 'scripted');
  }
  // Lyessa at the support position chosen in Z07, two soldiers of the squad holding with her
  const post = late ? 'lyessaFinish' : west ? 'lyessaW' : 'lyessaE';
  const lyessa = z.companion('lyessa', post, late ? 'scripted' : 'hold');
  if (!late) lyessa.holdAt(z.m(post), z.myaw(post));
  z.npc('dominionSoldier', west ? 'soldierW1' : 'soldierE1', 'aimRifle', 'soldier1');
  z.npc('dominionSoldier', west ? 'soldierW2' : 'soldierE2', 'aimRifle', 'soldier2');
  // Tharne and Lyric hold at the staging: rear, protected, silent during E4
  z.npc('tharne', 'tharneStage', 'kneelTend', 'tharne');
  const lyric = z.npc('lyric', 'lyricStage', 'sitInjured', 'lyric');
  // as Z06 / Z07 leave her: the infection in her irises and at her neck only, never cured
  lyric.actor.visual?.setCorruption(LYRIC_CORRUPTION, { mode: 'face', arms: 0.25 }); // (+ the arms' trace Z06 leaves)
  spawnSurvivors(z, { walkersOut: !west && stage !== 'A' });
  // the east flank: East opens it in phase A, West at the handoff ("sooner" / later)
  const flank = stage !== 'A';
  setDoor(S.gateS, flank, flank ? 'open' : 'locked');
  setDoor(S.gateN, flank, flank ? 'open' : 'locked');
  S.flankOpen = flank;
  S.announced = stage !== 'A';
  if (stage === 'A' || stage === 'B') {
    if (west) {
      z.pickup('sustain', 'cacheW1');
      z.pickup('ammo', 'cacheW2');
      z.pickup('sustain', 'cacheW3');
    }
    sustainDrops(z, ['sustainS', 'sustainE', 'sustainDeck']);
  }
  if (stage === 'B') {
    S.stage = 'B';
    setupE4(z, 'B');
  } else if (stage === 'finish') {
    S.stage = 'B';
    S.fractured = z.flag('z08Fractured') === true;
    setupE4(z, 'finish');
  } else if (stage === 'quarantine') {
    S.stage = 'done';
    restoreOfficer(z, officerFate(z));
  }
}

/** open the manual shutters of the east deck route */
function openFlank(z: ZoneRuntime): void {
  if (S.flankOpen) return;
  S.flankOpen = true;
  for (const g of [S.gateS, S.gateN]) {
    if (!g) continue;
    g.setState('open');
    z.openDoor(g, true);
  }
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `phaseA` → CP5 (Selene). The organism pushes through the breach; break what feeds it. */
function* phaseA(z: ZoneRuntime): Routine {
  S.stage = 'A';
  const west = westChosen(z);
  setupE4(z, 'A');
  const tarrik = z.cast('tarrik');
  yield* z.cinematic('z08-arrival', function* (c: CineCtx): Routine {
    // “A larger organism pushes through the breach.” The party small at the south end, the court between
    c.cut({ pos: z.P(39.8, 5.2, 2.5), look: z.P(35, 42, 3.4), fov: 50 });
    // (integration wave: settling low over the mirror floor, the gate centred — the quarantine painting's framing)
    c.moveAsync({ pos: z.P(37.4, 9.5, 1.45), look: z.P(35, 40, 3.6), fov: 44 }, 6.5, 'inOut');
    yield 3.4;
    // Tarrik takes the court
    walkTo(z, tarrik, 'tarrikCourt', { run: true });
    c.cut({ pos: z.P(31.6, 6.4, 1.7), look: z.P(36, 20, 1.6), fov: 46 });
    yield 1.6;
    yield* z.say('Tarrik', 'Move.', { actor: tarrik });
    yield 0.6;
    // end state
    if (z.skipping) tarrik?.teleport(z.m('tarrikCourt'), z.myaw('tarrikCourt'));
  });
  wakeE4(z);
  if (tarrik && S.elite) {
    tarrik.mode = 'combat';
    tarrik.focus(S.elite);
  }
  z.objective('Break the links that feed it'); // NEW
  z.fork(teachA(z), 'teachA');
  z.fork(barksA(z), 'barksA');
  z.fork(lyessaSupport(z, z.cast('lyessa')), 'lyessa');
  z.fork(consequence(z, west), 'consequence');
  z.fork(phaseAFailsafe(z), 'failsafe');
  z.fork(isolateA(z), 'isolate');
  yield z.until(phaseADone);
}

/**
 * The Z07 choice's consequence, announced before the phase B handoff (one or the other, never both):
 * West — the medics' field cache in the west alcove; East — the walking wounded wind the manual shutter open and
 * the east flank opens.
 */
function* consequence(z: ZoneRuntime, west: boolean): Routine {
  const lyessa = z.cast('lyessa');
  yield 3.5;
  if (west) {
    yield* z.say('Lyessa', 'West recess. I have the medics.', { actor: lyessa }); // NEW
    yield 6;
    yield* z.say('Lyessa', 'Cache is west. Use it.', { actor: lyessa }); // NEW
    z.game.ui.marker('z08-cache', z.m('cacheW1'), { label: 'Field cache', kind: 'optional', hideWithin: 3 }); // NEW
    yield 3;
  } else {
    yield* z.say('Lyessa', 'East side. I have the walkers.', { actor: lyessa }); // NEW
    yield 6;
    yield* walkersToShutter(z);
    openFlank(z);
    z.game.events.emit('caption', { text: 'East flank open', kind: 'door', pos: S.gateN?.pos }); // NEW
    yield* z.say('Survivor', 'The shutter’s up!', { actor: z.cast('walker1') }); // NEW
    yield 0.8;
    yield* z.say('Lyessa', 'East side’s open.', { actor: lyessa }); // NEW
  }
  S.announced = true;
  z.log(`Z07 consequence announced (${west ? 'West: field cache' : 'East: shutter and flank'})`);
}

/** `phaseB` → CP5b. Handoff to Tarrik; the joint Resonance; the authored finish with the officer's choice. */
function* phaseB(z: ZoneRuntime): Routine {
  z.game.ui.marker('z08-cache', null);
  if (fateRecorded(z)) {
    // a reload after the commit: the finish plays the recorded answer at once
    yield* finishScene(z);
    return;
  }
  yield* z.handoff('tarrik', { partnerMode: 'scripted', seconds: 3.2 });
  S.stage = 'B';
  setupE4(z, 'B');
  // isolated, it has knitted itself whole again: phase B is the fight proper (and a reload starts it the same)
  if (S.elite && S.elite.alive) S.elite.hp = S.elite.maxHp;
  z.log(`phase B: organism at ${Math.round(S.elite?.hp ?? 0)} hp`);
  openFlank(z);
  const selene = z.cast('selene');
  if (selene) {
    selene.mode = 'scripted';
    selene.moveTo(S.frost ? S.frost.actor.pos : z.m('frostAnchor'), { run: true, stopDistance: 0.6 });
  }
  z.objective('Hold the court'); // NEW
  tutorialHint(z, 'z08Joint', 'Its slams and charges open the joint. Selene holds it from the frost anchor.', 'heavy', 8); // NEW
  z.fork(resonanceLoop(z), 'resonance');
  yield z.until(() => S.finishDue && !S.vignette);
  z.objective(null);
  yield* finishScene(z);
}

/** `quarantine`: the fighting ends here. */
function* quarantine(z: ZoneRuntime): Routine {
  S.stage = 'done';
  z.objective(null);
  z.hint(null);
  z.game.ui.eliteBar(null);
  yield 1.0;
  yield* quarantineScene(z, westChosen(z), officerFate(z));
  yield* descend(z);
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  { id: 'phaseA', checkpoint: 'CP5', enter: (z) => spawnCast(z, 'A'), run: phaseA },
  { id: 'phaseB', checkpoint: 'CP5b', enter: (z) => spawnCast(z, fateRecorded(z) ? 'finish' : 'B'), run: phaseB },
  { id: 'quarantine', enter: (z) => spawnCast(z, 'quarantine'), run: quarantine },
];

const Z08_DEF: ZoneDef = {
  id: 'Z08',
  title: 'Quarantine Crucible',
  art: 'quarantine-cooperation',
  cast: [
    'elite', 'weaver', 'linkbound', 'wallrunner', 'weaverAnchor', 'frostAnchor',
    'dominionSoldier', 'reformationSoldier', 'medic', 'survivor', 'lyessa', 'tharne', 'lyric',
    // the officer revealed inside the organism (generated body, preloaded so the reveal never shows a stand-in)
    'officer',
  ],
  build,
  beats,
  update(z, dt) {
    updateFight(z, dt);
    updateLitters(z, dt);
    updateOfficer(dt);
  },
  dispose() {
    resetState();
  },
};

export default Z08_DEF;
