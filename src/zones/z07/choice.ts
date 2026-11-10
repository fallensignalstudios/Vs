/**
 * Z07 `bridge` and `choice` (SCRIPT_SOURCE Z07 `bridge`, `choice`, O3).
 *
 *  bridge   Tharne opens local threat-track and firing-corridor interoperability: two narrow streams on the
 *           display over the auxiliary desk gain a common target vocabulary and never merge; the labels carry the
 *           plan's three limits (only tracks and arcs are shared; weapons authority and command are not; the
 *           ceasefire is unauthorized — the author's two sentences, as cards). `z.story('threatExchangeOpen')`.
 *  choice   plating falls across both survivor routes; the medic, a walker, Lyessa and Tharne state the problem
 *           (all new lines); Selene answers at the physical recovery panel: explicit, untimed, select then confirm.
 *           Saved immediately before the prompt and again after the acknowledgment; `z.commitRescuePriority`
 *           exactly once; a reload after the commit never offers the panel again.
 *  O3       the contamination record at the side console: the Reformation cage's record (new text built from
 *           the book's facts) and three short reactions.
 */
import type { ChoiceOpts, CineCtx, RescuePriority, Routine, SayOpts, ZoneRuntime } from '@/core/api';
import { atPost, setDoor, standardExit, tutorialHint, waitOr, walkTo } from '../shared';
import { bearing, lightStrip, stripsOff, yawToward } from './cages';
import { moveChosenGroup } from './people';
import { S } from './state';

const SYSTEM: SayOpts = { channel: 'system' };

/** the panel's text — new UI text, exactly as SCRIPT_SOURCE Z07 `choice` gives it */
export const PRIORITY_CHOICE: ChoiceOpts = {
  id: 'rescuePriority',
  title: 'SURVIVOR ROUTES', // NEW
  prompt: 'Lyessa can cover one route first.', // NEW
  options: [
    {
      id: 'WestStretchers', tag: 'WEST', label: 'Stretcher cases first', // NEW
      detail: 'Lyessa covers the medics. Their field cache is staged in the west alcove.', // NEW
    },
    {
      id: 'EastWalkers', tag: 'EAST', label: 'Walking wounded first', // NEW
      detail: 'The walking wounded reach the manual shutter early. The east flank opens sooner.', // NEW
    },
  ],
  note: 'Both groups get out. This decides the order.', // NEW
};

/** the consequence record shown after the acknowledgment (the mission summary's wording) */
const RECORD: Record<Exclude<RescuePriority, 'pending'>, string> = {
  WestStretchers: 'LOCAL PRIORITY: WEST — STRETCHER CASES FIRST', // NEW
  EastWalkers: 'LOCAL PRIORITY: EAST — WALKING WOUNDED FIRST', // NEW
};

/** what the contamination record prints (new text from the book's facts about the cold-field cage only) */
const RECORD_ROWS = [
  'COLD FIELD: IMMOBILIZATION EXPECTED', // NEW
  'BLACK TISSUE: SPREADING ALONG BOUNDARY, NOT THROUGH IT', // NEW
  'VIOLET VEINS: TRACING CONTAINMENT GEOMETRY', // NEW
  'REFORMATION SYSTEMS IN RANGE: FLICKERING', // NEW
];

/** the interoperability display in its open state (restores and skips snap it) */
export function streamsOpen(snap: boolean): void {
  const h = S.streams;
  if (h) {
    h.params.visible = 1;
    h.params.progress = 1;
    if (snap) h.snap();
  }
  for (const p of S.streamLabels) {
    p.show(1, 0.8);
    if (snap) p.update(0, true);
  }
}

// =====================================================================================================================
// bridge
// =====================================================================================================================

export function* bridgeScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const tharne = z.cast('tharne');
  const tarrik = z.cast('tarrik');
  yield 0.8;
  yield* z.cinematic('z07-bridge', function* (c: CineCtx): Routine {
    // Tharne rises from Lyric's side to the desk a step away
    tharne?.stopAction();
    walkTo(z, tharne, 'tharneDesk');
    c.cut({ pos: z.P(10.8, 15.4, 1.9), look: z.P(7.2, 19.6, 1.3), fov: 42 });
    yield waitOr(z, () => z.skipping || atPost(z, tharne, 'tharneDesk', 0.5), 3);
    const Se = z.player.pos.clone();
    const Th = tharne ? tharne.actor.pos.clone() : z.m('tharneDesk');
    const T = tarrik ? tarrik.actor.pos.clone() : z.m('tarrikAside');
    tharne?.face(Se);
    z.player.yaw = yawToward(Se, Th);
    c.shot(Th, { yawDeg: bearing(Th, Se) - 24, distance: 2.3, height: 1.62, lookHeight: 1.56, fov: 36 });
    yield* z.say('Tharne', 'Selene, I can bridge local targeting.', { actor: tharne });
    c.twoShot(Se, Th, { side: 1, distance: 1.7, fov: 38 });
    yield* z.say('Selene', 'Between the fleets?', { actor: z.player });
    c.shot(Th, { yawDeg: bearing(Th, Se) - 24, distance: 2.0, height: 1.62, lookHeight: 1.58, fov: 34 });
    yield* z.say('Tharne', 'Dominion and Reformation combat languages still share King-era ancestry.', { actor: tharne });
    tarrik?.face(Se);
    c.shot(T, { yawDeg: bearing(T, Se) + 30, distance: 2.2, height: 1.66, lookHeight: 1.6, fov: 34 });
    yield* z.say('Tarrik', 'Do it.', { actor: tarrik });
    // she looks at Tarrik, then at Tharne, and says the same
    z.player.yaw = yawToward(Se, T);
    c.shot(Se, { yawDeg: bearing(Se, T) + 35, distance: 2.1, height: 1.62, lookHeight: 1.56, fov: 34 });
    yield 1.0;
    z.player.yaw = yawToward(Se, Th);
    yield 0.5;
    yield* z.say('Selene', 'Do it.', { gesture: false });

    // the channel opens on both systems: two streams, one shared vocabulary, never one interface
    const cam = z.P(14.6, 15.2, 2.0);
    c.cut({ pos: cam, look: z.P(7.8, 20.4, 2.0), fov: 46 });
    c.moveAsync({ pos: z.P(13.4, 15.9, 2.05), look: z.P(7.8, 20.4, 2.05), fov: 42 }, 14, 'inOut');
    if (S.streams) S.streams.params.visible = 1;
    if (!z.skipping) game.audio.play('ambConsoleTick', { volume: 0.8 });
    lightStrip(z, S.stripSelene, Se, cam, 'LOCAL INTEROPERABILITY CHANNEL OPEN');
    lightStrip(z, S.stripTarrik, T, cam, 'LOCAL INTEROPERABILITY CHANNEL OPEN');
    yield* z.say('Fleet channel', 'LOCAL INTEROPERABILITY CHANNEL OPEN', { ...SYSTEM, duration: 2.6 }); // NEW (speaker label)
    stripsOff(z);
    for (const p of S.streamLabels) p.show(1, 1.2);
    // the streams acquire matching target glyphs over a few seconds
    for (let t = 0; t <= 5; t += 0.25) {
      if (S.streams) S.streams.params.progress = t / 5;
      yield 0.25;
    }
    // the fleets stop wasting weapons on each other
    game.sky.setBattleIntensity(0.12);
    z.story('threatExchangeOpen');
    // CORE: the author's two sentences, exact
    if (!z.skipping) game.ui.card('The fleets are not allies, but their local cooperation has become a ceasefire before either government can authorize one.', { style: 'context', seconds: 7 });
    yield 7.4;
    if (!z.skipping) game.ui.card('The exchange remains ugly, incomplete, and unauthorized in several sectors, but the two fleets stop wasting weapons on each other.', { style: 'context', seconds: 7 });
    yield 7.4;
    if (!z.skipping) game.ui.card(null);
    // end state — identical watched or skipped
    streamsOpen(z.skipping);
    stripsOff(z);
    if (z.skipping) tharne?.teleport(z.m('tharneDesk'), z.myaw('tharneDesk'));
  }, { blendOut: 0.5 });
}

// =====================================================================================================================
// choice
// =====================================================================================================================

/** the main path of `choice`: plating, the people, the panel — unless the priority is already committed */
export function* choiceBeat(z: ZoneRuntime): Routine {
  const game = z.game;
  game.audio.setMusic('decision', 3);
  z.fork(o3(z), 'o3');
  if (z.state.rescuePriority === 'pending') {
    // a reload from the save taken before the prompt does not replay the scene
    if (z.flag('z07Plating') !== true) yield* platingScene(z);
    yield* panelAndChoice(z);
  }
  // the way down: the party follows the lead; Lyessa holds her route
  for (const name of ['tarrik', 'tharne', 'lyric'] as const) {
    const c = z.cast(name);
    if (!c) continue;
    c.stopAction();
    c.mode = 'follow';
    c.follow(z.player);
  }
  yield 1.2;
  yield* standardExit(z, S.exit, 'Z08', { at: 'exit' });
}

/** plating falls across both survivor routes; the people state the problem */
function* platingScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const lyessa = z.cast('lyessa');
  const medic = z.cast('medicA');
  const walker = z.cast('walkerB');
  const tharne = z.cast('tharne');
  yield 1.0;
  yield* z.cinematic('z07-plating', function* (c: CineCtx): Routine {
    // the structure groans; plating comes down across the west mouth, then the east
    c.cut({ pos: z.P(9.4, 11.2, 2.4), look: z.P(0.6, 4.8, 1.7), fov: 46 });
    if (!z.skipping) {
      game.audio.play('structuralGroan', { volume: 1 });
      game.camera.shake(0.18, 1.2);
      game.vfx.spawn('debrisFall', z.P(1.2, 5.2, 4.2), { duration: 1.4 });
    }
    yield 0.9;
    for (const o of S.plating.slice(0, 2)) o.visible = true;
    if (!z.skipping) {
      game.audio.play('debrisFall', { pos: z.P(0.5, 4.5, 1) });
      game.vfx.spawn('dustPuff', z.P(0.8, 5.2, 0.2), { scale: 3 });
    }
    yield 1.4;
    c.cut({ pos: z.P(25.4, 11.0, 2.4), look: z.P(33.4, 4.8, 1.7), fov: 46 });
    if (!z.skipping) game.vfx.spawn('debrisFall', z.P(32.8, 5.2, 4.2), { duration: 1.4 });
    yield 0.6;
    for (const o of S.plating.slice(2)) o.visible = true;
    if (!z.skipping) {
      game.audio.play('debrisFall', { pos: z.P(33.5, 4.5, 1) });
      game.vfx.spawn('dustPuff', z.P(33.2, 5.2, 0.2), { scale: 3 });
    }
    z.setFlag('z07Plating', true);
    yield 1.2;
    // Lyessa comes to the panel; the people say what they need
    walkTo(z, lyessa, 'lyessaPanel', { run: true });
    if (medic) {
      c.shot(medic.actor.pos, { yawDeg: 75, distance: 2.0, height: 1.15, lookHeight: 0.9, fov: 38 });
      yield* z.say('Medic', 'Two stretchers. We need the door held.', { actor: medic }); // NEW
    }
    if (walker) {
      walker.stopAction();
      c.shot(walker.actor.pos, { yawDeg: 300, distance: 2.2, height: 1.62, lookHeight: 1.55, fov: 36 });
      yield* z.say('Survivor', 'We can walk. Give us a way through.', { actor: walker }); // NEW
    }
    yield waitOr(z, () => z.skipping || atPost(z, lyessa, 'lyessaPanel', 0.7), 4);
    const Ly = lyessa ? lyessa.actor.pos.clone() : z.m('lyessaPanel');
    c.shot(Ly, { yawDeg: 160, distance: 2.4, height: 1.62, lookHeight: 1.55, fov: 36 });
    // she says it to the room, then looks at whoever is at the panel
    yield* z.say('Lyessa', 'Plating’s down on both routes. I can cover one.', { gesture: false }); // NEW
    yield* z.say('Lyessa', 'Stretcher cases go west. Walking wounded go east.', { gesture: false }); // NEW
    if (tharne) {
      c.shot(tharne.actor.pos, { yawDeg: 150, distance: 2.3, height: 1.62, lookHeight: 1.56, fov: 34 });
      yield* z.say('Tharne', 'Both routes stay passable; her cover only sets the order.', { actor: tharne }); // NEW
    }
    lyessa?.face(z.player.pos);
    c.twoShot(Ly, z.player.pos, { side: 1, distance: 1.8, fov: 38 });
    yield 1.4;
    // end state — identical watched or skipped
    for (const o of S.plating) o.visible = true;
    if (z.skipping) lyessa?.teleport(z.m('lyessaPanel'), z.myaw('lyessaPanel'));
    lyessa?.face(z.m('panel'));
  }, { blendOut: 0.5 });
}

/** the physical panel: interact, save, choose (untimed, select then confirm), commit once, acknowledge, save */
function* panelAndChoice(z: ZoneRuntime): Routine {
  const game = z.game;
  z.objective('Use the recovery panel', 'panelUse'); // NEW
  tutorialHint(z, 'z07Panel', 'At the panel: select a route, then confirm. There is no time limit.', 'interact', 8); // NEW
  const it = z.interact({ id: 'z07-panel', at: 'panelUse', prompt: 'Set route priority', radius: 1.8, required: true }); // NEW
  yield z.untilInteract(it);
  z.objective(null);
  z.hint(null);
  z.checkpoint('CP4b'); // immediately before the prompt
  const pick = yield* z.choice(PRIORITY_CHOICE);
  const p: Exclude<RescuePriority, 'pending'> = pick === 'EastWalkers' ? 'EastWalkers' : 'WestStretchers';
  z.commitRescuePriority(p);
  if (!z.skipping) game.audio.play('panelCommit', { pos: z.m('panel') });
  yield* ackScene(z, p);
  game.ui.toast(RECORD[p], 'record');
  z.checkpoint('CP4b'); // and after the acknowledgment
}

/** one word from her; Lyessa moves; the chosen group goes first */
function* ackScene(z: ZoneRuntime, p: Exclude<RescuePriority, 'pending'>): Routine {
  const lyessa = z.cast('lyessa');
  const west = p === 'WestStretchers';
  const post = west ? 'lyessaWest' : 'lyessaEast';
  yield* z.cinematic('z07-ack', function* (c: CineCtx): Routine {
    const Se = z.player.pos.clone();
    c.shot(Se, { yawDeg: 200, distance: 2.0, height: 1.62, lookHeight: 1.58, fov: 34 });
    yield* z.say('Selene', west ? 'West.' : 'East.', { gesture: false }); // NEW
    walkTo(z, lyessa, post, { run: true });
    moveChosenGroup(z, p);
    if (west && S.cacheWest) S.cacheWest.visible = true;
    c.cut(west
      ? { pos: z.P(10.2, 9.6, 2.6), look: z.P(1.4, 5.2, 1.2), fov: 44 }
      : { pos: z.P(23.8, 9.6, 2.6), look: z.P(32.6, 5.2, 1.2), fov: 44 });
    yield 3.6;
    // end state — identical watched or skipped
    if (z.skipping) lyessa?.teleport(z.m(post), z.myaw(post));
  }, { blendOut: 0.5 });
  z.fork(holdPost(z, post), 'lyessaPost');
}

/** Lyessa takes her protective position once she reaches it */
export function* holdPost(z: ZoneRuntime, post: string): Routine {
  const lyessa = z.cast('lyessa');
  if (!lyessa) return;
  yield waitOr(z, () => atPost(z, lyessa, post, 0.8), 12);
  lyessa.mode = 'hold';
  lyessa.holdAt(z.m(post), z.myaw(post));
  lyessa.play('aimRifle', { loop: true });
}

/** the exit is open once the priority stands (also used by restores) */
export function exitReady(): void {
  setDoor(S.exit, false, 'ready');
}

// =====================================================================================================================
// O3 · contamination record (optional, ≈ 1 min)
// =====================================================================================================================

function recordShown(full: boolean, snap: boolean): void {
  const r = S.record;
  if (r) {
    r.params.visible = full ? 1 : 0.4;
    r.params.progress = full ? 1 : 0.05;
    if (snap) r.snap();
  }
  if (full) S.recordText?.setLines(RECORD_ROWS);
  S.recordText?.show(full ? 1 : 0, 0.6);
  if (snap) S.recordText?.update(0, true);
}

function* o3(z: ZoneRuntime): Routine {
  if (z.state.optional.O3) {
    recordShown(true, true);
    return;
  }
  z.optionalMarker('O3', 'o3Use', 'O3 · Contamination record'); // NEW
  const it = z.interact({ id: 'z07-o3', at: 'o3Use', prompt: 'Inspect the contamination record', radius: 2.0 }); // NEW
  yield z.untilInteract(it);
  z.optionalMarker('O3', null);
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  yield* z.cinematic('z07-o3', function* (c: CineCtx): Routine {
    const rec = z.m('o3Record').setY(2.05);
    walkTo(z, tharne, 'o3Tharne');
    c.cut({ pos: z.P(4.4, 16.0, 1.9), look: rec, fov: 40 });
    c.moveAsync({ pos: z.P(3.7, 16.6, 1.95), look: rec, fov: 36 }, 9, 'inOut');
    if (S.record) S.record.params.visible = 1;
    // the record reveals top-down; each row is also given to the subtitles
    for (let i = 0; i < RECORD_ROWS.length; i++) {
      if (S.record) S.record.params.progress = (i + 1) / RECORD_ROWS.length;
      S.recordText?.setLines(RECORD_ROWS.slice(0, i + 1));
      S.recordText?.show(1, 0.4);
      yield* z.say('Record', RECORD_ROWS[i], { ...SYSTEM, duration: 2.6 }); // NEW (speaker label)
    }
    const Th = tharne ? tharne.actor.pos.clone() : z.m('o3Tharne');
    c.shot(Th, { yawDeg: 140, distance: 2.1, height: 1.62, lookHeight: 1.56, fov: 34 });
    yield* z.say('Tharne', 'It followed the containment geometry exactly.', { actor: tharne }); // NEW
    const sitting = lyric ? lyric.mode !== 'follow' : true;
    c.shot(lyric ? lyric.actor.pos : z.m('lyric'), { yawDeg: 165, distance: 1.7, height: sitting ? 0.9 : 1.6, lookHeight: sitting ? 0.82 : 1.55, fov: 34 });
    yield* z.say('Lyric', 'Somebody built it a road.', { actor: lyric }); // NEW
    const Se = z.player.pos.clone();
    c.shot(Se, { yawDeg: 120, distance: 2.0, height: 1.62, lookHeight: 1.58, fov: 34 });
    yield* z.say('Selene', 'This should have stopped the deployment.', { gesture: false }); // NEW
    // end state — identical watched or skipped
    recordShown(true, z.skipping);
    if (z.skipping) tharne?.teleport(z.m('o3Tharne'), z.myaw('o3Tharne'));
  }, { blendOut: 0.4 });
  // after the choice the party follows the lead again
  if (tharne && tharne.mode === 'follow') tharne.follow(z.player);
  z.optionalDone('O3');
}
