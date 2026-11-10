/**
 * Z11 · Observation gallery — lead: Selene (with Tarrik). Dialogue framing: remain, understand.
 *
 * SPACE (./z11/layout.ts): the lift landing where all five meet (the author's ruling 5), a side passage, and the
 * 24 × 16 m gallery — a broad transparent wall north (red remnant left, the harder white remnant right, the Wound
 * between), one dark table and six age-polished chairs, nothing else. Exit east, to the outer ring (Z12).
 *
 * BEATS
 *   reunion            the lift; the quarantine retracts; Lyric alive, not cured (`lyricAliveNotCured`); the
 *                      summonses; “We should talk first.” / “Yes.”; Lyessa holds the junction. The bystander's
 *                      local-priority callback as Selene passes (NEW line, from `state.rescuePriority`).
 *   conversation → CP8 Tarrik goes ahead and chooses a chair; the seated scene (./z11/table.ts): the field seal,
 *                      the held look, Tarrik's callback (NEW), the Admonition, the exchange (`evidenceExchanged`),
 *                      the visions, the pact (`pactAgreed`), parting on purpose. Skippable; a skip applies the
 *                      same evidence and pact state and never touches the recorded priority.
 *   linger (O4)        the linger window: she is still seated. Staying (an interaction) plays O4 (./z11/o4.ts,
 *                      `optionalDone('O4')`); moving rises from the table. Either way the fleet alert, “We’re running
 *                      out of time.”, and they leave together → Z12.
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z11. The author's lines are exact; lines marked (ext — trimmed) are not played. Every
 * line and UI string written for the game is tagged `// NEW`.
 */
import type { Beat, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { setDoor, standardExit, walkTo } from './shared';
import { GAL, buildSpace } from './z11/layout';
import { S, buildObjects, placePanels, resetZ11, updateZ11 } from './z11/state';
import { callbackLine, restAtBench, reunionScene } from './z11/reunion';
import { alertScene, conversationScene, evidenceAfterExchange } from './z11/table';
import { o4Scene } from './z11/o4';
import { SEAT_S, sitPlayer, sitTarrik } from './z11/stage';

// =====================================================================================================================
// Build
// =====================================================================================================================

function build(b: ZoneBuilder): void {
  resetZ11();
  const sp = buildSpace(b);
  buildObjects(b, sp);
}

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'reunion' | 'gallery' | 'linger';

/**
 * The lead and the cast as each stage finds them (every beat's `enter`). Lyessa and the two soldiers of the squad
 * hold the junction once the reunion is over; Tharne and Lyric rest at the bench by the passage; the bystander of
 * the callback is a medic (West) or a walking survivor (East).
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const sp = S.sp;
  const reunion = stage === 'reunion';
  const east = z.state.rescuePriority === 'EastWalkers';
  z.spawnPlayer('selene', reunion ? 'liftSelene' : stage === 'gallery' ? 'galleryIn' : SEAT_S);
  const tarrik = z.companion('tarrik', reunion ? 'liftTarrik' : stage === 'gallery' ? 'tarrikIn' : 'tarrikApproach', reunion ? 'hold' : 'follow');
  if (reunion) tarrik.holdAt(z.m('liftTarrik'), z.myaw('liftTarrik'));
  const lyessa = z.companion('lyessa', reunion ? 'lyessaGate' : 'lyessaPost', 'hold');
  lyessa.holdAt(z.m(reunion ? 'lyessaGate' : 'lyessaPost'), z.myaw(reunion ? 'lyessaGate' : 'lyessaPost'));
  z.npc('dominionSoldier', reunion ? 'soldier1Gate' : 'soldier1Post', undefined, 'soldier1');
  z.npc('dominionSoldier', reunion ? 'soldier2Gate' : 'soldier2Post', undefined, 'soldier2');
  const tharne = z.companion('tharne', reunion ? 'tharneGate' : 'tharneRest', 'hold');
  const lyric = z.companion('lyric', reunion ? 'lyricGate' : 'lyricRest', 'hold');
  if (reunion) {
    tharne.holdAt(z.m('tharneGate'), z.myaw('tharneGate'));
    lyric.holdAt(z.m('lyricGate'), z.myaw('lyricGate'));
    lyric.actor.visual?.setCorruption(0.24);
  } else {
    restAtBench(z, tharne, lyric);
  }
  z.npc(east ? 'survivor' : 'medic', 'bystander', undefined, 'bystander');
  placePanels(z);
  if (!reunion) {
    // the quarantine has retracted and the lift stands open
    sp?.barrierW?.setActive(false, { instant: true });
    sp?.barrierE?.setActive(false, { instant: true });
    setDoor(sp?.lift ?? null, true);
    z.story('lyricAliveNotCured');
  }
  if (stage === 'linger') {
    // the linger window: both still seated, the evidence where the exchange left it
    z.story('evidenceExchanged');
    z.story('pactAgreed');
    sitTarrik(z, tarrik);
    tarrik.mode = 'hold';
    sitPlayer(z);
    evidenceAfterExchange(z);
  }
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `reunion`: the scene at the landing, then the side passage; the callback line as she passes the bystander */
function* reunion(z: ZoneRuntime): Routine {
  z.titleCard();
  yield 0.6;
  yield* reunionScene(z);
  z.objective('Take the side passage', 'passageIn'); // NEW
  yield z.untilNear('bystander', 3.4);
  const [who, text] = callbackLine(z);
  yield* z.say(who, text, { actor: z.cast('bystander') });
  yield z.untilInRect(6, GAL.n0 + 0.4, 4, 2.4);
}

/** `conversation` → CP8: he goes ahead and chooses a chair; she joins him; the seated scene */
function* conversation(z: ZoneRuntime): Routine {
  const tarrik = z.cast('tarrik');
  if (tarrik) {
    tarrik.mode = 'hold';
    walkTo(z, tarrik, 'tarrikApproach');
  }
  z.objective('Join him at the table', 'seleneStand'); // NEW
  yield z.untilNear('seleneStand', 2.6);
  z.objective(null);
  yield* conversationScene(z);
}

/**
 * `linger` (O4). The linger window: she is still seated, and the player decides — stay (the interaction plays
 * O4) or move (she rises). Either way the fleet alert follows, and they leave together.
 */
function* linger(z: ZoneRuntime): Routine {
  const g = z.game;
  g.player.setMovementLocked(true);
  if (!z.state.optional.O4) {
    z.optionalMarker('O4', SEAT_S, 'O4 · Stay at the table'); // NEW
    const stay = z.interact({ id: 'z11-o4', at: SEAT_S, prompt: 'Stay at the table', radius: 1.6 }); // NEW
    z.hint('Move to rise from the table.', undefined, 9); // NEW
    const rising = (): boolean => Math.hypot(g.input.move.x, g.input.move.y) > 0.45 || g.input.moveWorld !== null || g.player.action !== 'free';
    yield () => stay.done || rising();
    z.optionalMarker('O4', null);
    z.hint(null);
    if (stay.done) {
      yield* o4Scene(z);
      z.optionalDone('O4');
    } else {
      stay.remove();
    }
  }
  g.player.setMovementLocked(false);
  yield* alertScene(z);
  g.player.setMovementLocked(false);
  yield* standardExit(z, S.sp?.exit ?? null, 'Z12', { at: 'exit', objective: 'Leave the gallery' }); // NEW (objective)
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  { id: 'reunion', enter: (z) => spawnCast(z, 'reunion'), run: reunion },
  { id: 'conversation', checkpoint: 'CP8', enter: (z) => spawnCast(z, 'gallery'), run: conversation },
  { id: 'linger', enter: (z) => spawnCast(z, 'linger'), run: linger },
];

const Z11_DEF: ZoneDef = {
  id: 'Z11',
  title: 'Observation Gallery',
  art: 'wound-overlook',
  cast: ['tarrik', 'lyessa', 'dominionSoldier', 'tharne', 'lyric', 'medic', 'survivor'],
  build,
  beats,
  /** the evidence, the hands on it and the projections, on the sim clock (a skip snaps them) */
  update: updateZ11,
  dispose(z) {
    z.game.player.setMovementLocked(false);
    if (z.player) z.player.fixed = false;
    S.sp?.set?.dispose();
    resetZ11();
  },
};

export default Z11_DEF;
