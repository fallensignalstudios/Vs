/**
 * Z12 scenes (SCRIPT_SOURCE Z12): `concourse` (the regrouping — the three O4-gated lines read `state.optional.O4`),
 * `farewell` (the ciphers, “Do not kneel.”, the forearm clasp), `departure` (no dialogue: the release, the look
 * back, the two craft leaving along opposite vectors, the displays and the closing cards). Every line is the
 * author's, exact; nothing is invented; lines marked (ext — trimmed) are not played. Speaker labels of the display
 * texts and the two place names on the final cards are new UI text (tagged).
 */
import * as THREE from 'three';
import type { CineCtx, Companion, Routine, ZoneRuntime } from '@/core/api';
import { atPost, feet, waitOr, walkTo } from '../shared';
import { sheathe, toward } from '../z11/framing';
import { FAREWELL } from './layout';
import { FLIGHT_END, RISE, S, carry, humanoid, prepareFlights } from './state';

type Body = Companion | 'player' | null;

/** how far each of them steps in toward the other for the forearm clasp (fraction of the gap to the midpoint) */
const CLASP_STEP = 0.45;
/**
 * Lyric's single as she answers Tharne (she faces him, north-east): well off the line to him, from the east, so
 * she is seen three-quarter against the Dominion berth and the open edge rather than the south wall
 */
const LYRIC_TO_THARNE = 62;
/** where the two departure follow shots stand (plan x, n, h) */
const FOLLOW_DOM: readonly [number, number, number] = [12.0, 4.0, 1.3];
const FOLLOW_REF: readonly [number, number, number] = [21.4, 8.6, 1.5];

/**
 * A line by a body. Polish 4: `to` = who it is addressed to when that is not the lead (dialogue `listener`): a
 * companion answering another companion turns to them and holds their eyes, instead of turning to Tarrik.
 */
function sayer(z: ZoneRuntime): (who: string, text: string, body: Body, to?: Companion | null) => Routine {
  return (who, text, body, to) => z.say(who, text, { actor: body === 'player' ? z.player : body, ...(to !== undefined ? { listener: to } : {}) });
}

// =====================================================================================================================
// concourse
// =====================================================================================================================

export function* concourseScene(z: ZoneRuntime): Routine {
  const g = z.game;
  const selene = z.cast('selene');
  const lyessa = z.cast('lyessa');
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const say = sayer(z);
  const T = (): THREE.Vector3 => z.player.pos.clone();
  const at = (c: Companion | null, m: string): THREE.Vector3 => feet(z, c ?? m);

  yield* z.cinematic('z12-concourse', function* (c: CineCtx): Routine {
    // the group gathered between the berths
    g.player.teleport(z.m('tarrikMeet'), z.myaw('tarrikMeet'));
    for (const [b, m] of [[selene, 'seleneMeet'], [lyessa, 'lyessaMeet'], [tharne, 'tharneMeet'], [lyric, 'lyricMeet']] as const) {
      b?.stopAction();
      b?.teleport(z.m(m), z.myaw(m));
      b?.holdAt(z.m(m), z.myaw(m));
    }
    // “Lyessa notices the Cauldron recorder in Selene's hand before anyone speaks.”
    sheathe(z.player, selene);
    const rec = at(selene, 'seleneMeet').setY(0.98);
    const lf = at(lyessa, 'lyessaMeet');
    const back = lf.clone().sub(rec).setY(0).normalize();
    c.cut({ pos: lf.clone().addScaledVector(back, 0.55).add(new THREE.Vector3(0, 1.58, 0.35)), look: rec.clone(), fov: 30 });
    humanoid(lyessa?.actor)?.lookAt(rec);
    yield 2.4;
    humanoid(lyessa?.actor)?.lookAt(null);
    c.twoShot(T(), at(lyessa, 'lyessaMeet'), { side: 1, distance: 1.8, fov: 32 });
    yield* say('Lyessa', 'You told her.', lyessa);
    // he offers neither excuse nor apology
    toward(c, z.player, selene, -35, 2.0, 29, 1.66);
    yield* say('Tarrik', 'Yes.', 'player');
    c.twoShot(at(selene, 'seleneMeet'), at(lyessa, 'lyessaMeet'), { side: 1, distance: 2.0, fov: 32 });
    yield* say('Lyessa', 'What did he tell you?', lyessa, selene);
    toward(c, selene, lyessa, 35, 2.0, 29, 1.58);
    yield* say('Selene', 'The truth.', selene, lyessa);
    if (z.state.optional.O4) {
      // only if O4 was heard (ruling 11): otherwise “Gate Nine” means nothing
      yield* say('Selene', 'I don’t know whether you were wrong at Gate Nine.', selene, lyessa);
      yield* say('Selene', 'I know you were wrong every day after.', selene, lyessa);
      toward(c, lyessa, selene, -35, 1.8, 27, 1.62);
      yield 0.6;
      yield* say('Lyessa', 'So do I.', lyessa, selene);
      // she does not argue; it repairs nothing; it matters anyway
      yield 1.6;
    }
    // each companion chooses to go with their bearer
    c.twoShot(at(lyric, 'lyricMeet'), at(selene, 'seleneMeet'), { side: -1, distance: 1.8, fov: 32 });
    yield* say('Selene', 'You don’t have to come.', selene, lyric);
    yield* say('Lyric', 'I know.', lyric, selene);
    // she waves Tharne off, manages two steps alone, sways, then lets him take her arm without comment
    c.shot(at(lyric, 'lyricMeet'), { yawDeg: 175, distance: 3.0, height: 1.5, lookHeight: 1.35, fov: 34 });
    lyric?.play('point');
    walkTo(z, lyric, 'lyricAlone');
    yield waitOr(z, () => z.skipping || atPost(z, lyric, 'lyricAlone', 0.35), 2.2);
    lyric?.play('limp', { loop: true });
    walkTo(z, tharne, 'lyricMeet');
    yield* say('Lyric', 'Still coming.', lyric, selene);
    yield* say('Tharne', 'So am I.', tharne, selene);
    c.twoShot(at(lyessa, 'lyessaMeet'), T(), { side: -1, distance: 1.8, fov: 32 });
    yield* say('Tarrik', 'You don’t have to come.', 'player');
    yield* say('Lyessa', 'I know.', lyessa);
    toward(c, lyessa, z.player, 30, 1.9, 28, 1.62);
    yield* say('Lyessa', 'Still coming.', lyessa);
    // the answer mirrors Lyric's; both women notice
    c.cut({ pos: z.P(FAREWELL.x, 4.6, 1.7), look: z.P(FAREWELL.x, 9.6, 1.45), fov: 40 });
    humanoid(lyessa?.actor)?.lookAt(at(lyric, 'lyricMeet').setY(1.6));
    humanoid(lyric?.actor)?.lookAt(at(lyessa, 'lyessaMeet').setY(1.6));
    yield 1.8;
    humanoid(lyessa?.actor)?.lookAt(null);
    humanoid(lyric?.actor)?.lookAt(null);
    // Tharne can find no way round the two of them — and will not promise there is none
    c.twoShot(at(tharne, 'tharneMeet'), at(selene, 'seleneMeet'), { side: 1, distance: 1.9, fov: 32 });
    tharne?.play('point');
    yield* say('Tharne', 'There is no evident mechanism for remote substitution.', tharne, selene);
    toward(c, selene, tharne, -35, 1.9, 29, 1.58);
    yield* say('Selene', 'You don’t see one.', selene, tharne);
    toward(c, tharne, selene, 35, 2.0, 29, 1.6);
    yield* say('Tharne', 'No.', tharne, selene);
    yield* say('Tharne', 'The command grammar distributed to the active nodes can interrogate terminal state,', tharne, selene);
    yield* say('Tharne', 'model release conditions, and authenticate partial authority pathways.', tharne, selene);
    yield* say('Tharne', 'It should not be capable of executing final release without contrary concurrence.', tharne, selene);
    // (polish 4: she answers Tharne — `listener` turns her to him — so she is framed on the line to him)
    toward(c, lyric, tharne, LYRIC_TO_THARNE, 1.9, 28, 1.6);
    yield* say('Lyric', 'Should.', lyric, tharne);
    toward(c, tharne, lyric, 35, 2.0, 29, 1.6);
    yield* say('Tharne', 'Yes.', tharne, lyric);
    toward(c, lyric, tharne, LYRIC_TO_THARNE, 1.9, 28, 1.6);
    yield* say('Lyric', 'That word is doing a remarkable amount of labor.', lyric, tharne);
    // the alert over the concourse
    c.cut({ pos: z.P(FAREWELL.x, 3.2, 1.8), look: z.P(FAREWELL.x, 17.5, 4.6), fov: 46 });
    S.alert?.show(1, 0.3);
    if (!z.skipping) g.audio.play('ambPA', { pos: z.P(FAREWELL.x, 17, 5) });
    yield 0.5;
    yield* z.say('Hangar alert', 'CEASEFIRE VIOLATION RISK: ELEVATED', { channel: 'system' }); // NEW (speaker label)
    c.twoShot(at(selene, 'seleneMeet'), T(), { side: 1, distance: 1.7, fov: 31 });
    yield* say('Selene', 'We need to leave.', selene);
    yield 0.6;
    // end state: the companions go to their own craft; the two bearers stay a moment, beneath the Wound
    S.alert?.show(0.35, 2);
    toShips(z, true);
  }, { blendOut: 0.8 });
}

/** Lyessa to the Dominion ramp; Tharne helping Lyric toward the Reformation one */
export function toShips(z: ZoneRuntime, walk: boolean): void {
  const lyessa = z.cast('lyessa');
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  for (const [b, m] of [[lyessa, 'domRampA'], [tharne, 'refRampA'], [lyric, 'refRampB']] as const) {
    if (!b) continue;
    b.stopAction();
    if (walk && !z.skipping) b.moveTo(z.m(m), { yaw: z.myaw(m) });
    else {
      b.teleport(z.m(m), z.myaw(m));
      b.holdAt(z.m(m), z.myaw(m));
    }
  }
  if (lyric && walk && !z.skipping) lyric.play('limp', { loop: true });
}

// =====================================================================================================================
// farewell
// =====================================================================================================================

export function* farewellScene(z: ZoneRuntime): Routine {
  const g = z.game;
  const selene = z.cast('selene');
  const say = sayer(z);
  yield* z.cinematic('z12-farewell', function* (c: CineCtx): Routine {
    g.player.teleport(z.m('tarrikFarewell'), z.myaw('tarrikFarewell'));
    selene?.stopAction();
    selene?.teleport(z.m('seleneFarewell'), z.myaw('seleneFarewell'));
    selene?.holdAt(z.m('seleneFarewell'), z.myaw('seleneFarewell'));
    toShips(z, false);
    sheathe(z.player, selene);
    const T = z.m('tarrikFarewell');
    const Sx = z.m('seleneFarewell');
    const mid = T.clone().lerp(Sx, 0.5);
    // “Between them, Tarrik and Selene stand beneath the shadow of the Wound.”
    c.cut({ pos: z.P(FAREWELL.x, 1.6, 1.3), look: z.P(FAREWELL.x, 40, 10), fov: 50 });
    c.moveAsync({ pos: z.P(FAREWELL.x, 3.6, 1.35), look: z.P(FAREWELL.x, 40, 9.5), fov: 47 }, 8, 'inOut');
    yield 3.2;
    // the ciphers: one each, narrow
    carry(S.cipherT, z.player, 'handR');
    carry(S.cipherS, selene?.actor ?? null, 'handR');
    c.twoShot(Sx, T, { side: 1, distance: 1.6, fov: 32 });
    yield* say('Selene', 'No terminal authorization over this channel.', selene);
    c.twoShot(T, Sx, { side: -1, distance: 1.6, fov: 32 });
    yield* say('Tarrik', 'No.', 'player');
    c.twoShot(Sx, T, { side: 1, distance: 1.6, fov: 32 });
    yield* say('Selene', 'One transmission before auto-burn.', selene);
    c.twoShot(T, Sx, { side: -1, distance: 1.6, fov: 32 });
    yield* say('Tarrik', 'Yes.', 'player');
    // they swap — smaller than the evidence, and somehow more personal
    c.cut({ pos: mid.clone().add(new THREE.Vector3(0.1, 1.45, 1.05)), look: mid.clone().setY(1.12), fov: 30 });
    humanoid(z.player)?.setHandTarget('R', mid.clone().setY(1.12), 1);
    humanoid(selene?.actor)?.setHandTarget('R', mid.clone().setY(1.12), 1);
    yield 1.1;
    carry(S.cipherT, selene?.actor ?? null, 'handR');
    carry(S.cipherS, z.player, 'handR');
    yield 0.6;
    humanoid(z.player)?.setHandTarget('R', null);
    humanoid(selene?.actor)?.setHandTarget('R', null);
    yield 0.6;
    carry(S.cipherT, null);
    carry(S.cipherS, null);
    c.twoShot(T, Sx, { side: -1, distance: 1.6, fov: 31 });
    yield* say('Tarrik', 'Try not to get arrested.', 'player');
    c.twoShot(Sx, T, { side: 1, distance: 1.6, fov: 31 });
    yield* say('Selene', 'Try not to commit regicide.', selene);
    // the humor fades from her face
    toward(c, Sx, T, -32, 1.7, 27, 1.58);
    yield 0.6;
    yield* say('Selene', 'Do not kneel.', selene);
    toward(c, T, Sx, 32, 1.8, 27, 1.66);
    yield* say('Tarrik', 'I wasn’t planning to.', 'player');
    c.twoShot(Sx, T, { side: 1, distance: 1.55, fov: 30 });
    yield* say('Selene', 'Plans change.', selene);
    c.twoShot(T, Sx, { side: -1, distance: 1.55, fov: 30 });
    yield* say('Tarrik', 'If they do, come remind me.', 'player');
    c.twoShot(Sx, T, { side: 1, distance: 1.55, fov: 30 });
    yield* say('Selene', 'Try not to require it.', selene);
    c.twoShot(T, Sx, { side: -1, distance: 1.55, fov: 30 });
    yield* say('Tarrik', 'And you?', 'player');
    toward(c, Sx, T, -32, 1.7, 27, 1.58);
    yield* say('Selene', 'The eagle.', selene);
    toward(c, T, Sx, 32, 1.8, 27, 1.66);
    yield* say('Tarrik', 'Yes.', 'player');
    c.twoShot(Sx, T, { side: 1, distance: 1.6, fov: 31 });
    yield* say('Selene', 'I intend to come back.', selene);
    c.twoShot(T, Sx, { side: -1, distance: 1.6, fov: 31 });
    yield* say('Tarrik', 'That is not what Vesryn saw.', 'player');
    c.twoShot(Sx, T, { side: 1, distance: 1.6, fov: 31 });
    yield* say('Selene', 'Vesryn doesn’t get a vote.', selene);
    toward(c, T, Sx, 32, 1.8, 27, 1.66);
    yield* say('Tarrik', 'Good.', 'player');
    toward(c, Sx, T, -32, 1.7, 27, 1.58);
    yield* say('Selene', 'Neither does prophecy.', selene);
    toward(c, T, Sx, 32, 1.8, 27, 1.66);
    yield* say('Tarrik', 'No.', 'player');
    // “Tarrik offers his forearm in an old Dominion military gesture.” She looks at it, then at him.
    const clasp = mid.clone().setY(1.18);
    // a step in, for the old Dominion gesture (polish 4: a little deeper, 0.45, now that the chars reach assist
    // brings each hand onto the other's forearm — the clasp closes instead of stopping fingertip to fingertip)
    g.player.teleport(T.clone().lerp(mid, CLASP_STEP), z.myaw('tarrikFarewell'));
    selene?.teleport(Sx.clone().lerp(mid, CLASP_STEP), z.myaw('seleneFarewell'));
    selene?.holdAt(Sx.clone().lerp(mid, CLASP_STEP), z.myaw('seleneFarewell'));
    c.cut({ pos: mid.clone().add(new THREE.Vector3(0.05, 1.52, 1.9)), look: clasp.clone().setY(1.3), fov: 34 });
    humanoid(z.player)?.setHandTarget('R', clasp.clone().add(new THREE.Vector3(0.14, 0, 0)), 1);
    humanoid(selene?.actor)?.lookAt(clasp);
    yield 1.6;
    humanoid(selene?.actor)?.lookAt(null);
    c.twoShot(Sx, T, { side: 1, distance: 1.6, fov: 31 });
    yield* say('Selene', 'You are aware I am not one of your soldiers.', selene);
    c.twoShot(T, Sx, { side: -1, distance: 1.6, fov: 31 });
    yield* say('Tarrik', 'I noticed.', 'player');
    // she takes his arm; warmth and cold meet without either trying to change the other. Neon Veil pulses;
    // Caerion II answers faintly. Recognition. Nothing more.
    c.cut({ pos: mid.clone().add(new THREE.Vector3(-0.2, 1.5, 2.3)), look: clasp.clone().setY(1.35), fov: 32 });
    c.moveAsync({ pos: mid.clone().add(new THREE.Vector3(-0.15, 1.48, 2.0)), look: clasp.clone().setY(1.38), fov: 30 }, 6, 'inOut');
    humanoid(selene?.actor)?.setHandTarget('R', clasp.clone().add(new THREE.Vector3(-0.14, 0, 0)), 1);
    yield 1.4;
    if (!z.skipping) {
      const chestT = new THREE.Vector3();
      const chestS = new THREE.Vector3();
      z.player.visual?.socket('chest').getWorldPosition(chestT);
      selene?.actor.visual?.socket('chest').getWorldPosition(chestS);
      g.vfx.spawn('goldRecognition', chestT, { scale: 0.16 });
      g.audio.play('recognitionTone', { pos: chestT, volume: 0.45 });
      yield 0.7;
      g.vfx.spawn('goldRecognition', chestS, { scale: 0.09, color: 0xcfeeff });
    }
    yield 2.6;
  }, { blendOut: 0 });
}

// =====================================================================================================================
// departure → z.completeMission() (CP9)
// =====================================================================================================================

/** “They release.” Each turns to their own people; both pause and look back; that makes them both turn away. */
export function* releaseScene(z: ZoneRuntime): Routine {
  const g = z.game;
  const selene = z.cast('selene');
  yield* z.cinematic('z12-release', function* (c: CineCtx): Routine {
    humanoid(z.player)?.setHandTarget('R', null);
    humanoid(selene?.actor)?.setHandTarget('R', null);
    sheathe(z.player, selene);
    const T = z.m('tarrikFarewell');
    c.cut({ pos: z.P(FAREWELL.x, 5.0, 1.55), look: z.P(FAREWELL.x, FAREWELL.n + 2, 1.5), fov: 38 });
    yield 0.8;
    // each turns to their own people
    g.player.teleport(T, z.myaw('tarrikTurn'));
    selene?.teleport(z.m('seleneFarewell'), z.myaw('seleneTurn'));
    selene?.holdAt(z.m('seleneFarewell'), z.myaw('seleneTurn'));
    yield 1.4;
    // — but then both pause and look back
    c.cut({ pos: z.P(FAREWELL.x, 7.4, 1.6), look: z.P(FAREWELL.x, FAREWELL.n, 1.62), fov: 32 });
    const head = (a: THREE.Vector3): THREE.Vector3 => a.clone().setY(1.65);
    humanoid(z.player)?.lookAt(head(z.m('seleneFarewell')));
    humanoid(selene?.actor)?.lookAt(head(T));
    yield 2.2;
    // neither expected the other to. That makes them both turn away first.
    humanoid(z.player)?.lookAt(null);
    humanoid(selene?.actor)?.lookAt(null);
    yield 0.6;
    walkTo(z, selene, 'refRampC');
    if (selene) {
      selene.mode = 'hold';
      if (z.skipping) selene.holdAt(z.m('refRampC'), z.myaw('refRampC'));
    }
    c.cut({ pos: z.P(FAREWELL.x + 0.5, 2.2, 1.7), look: z.P(FAREWELL.x + 1, FAREWELL.n + 3, 1.5), fov: 44 });
    yield 2.0;
  }, { blendOut: 0.7 });
}

/**
 * A camera that stays put at `from` and follows a departing craft (eased aim; the field narrows as it recedes so
 * the craft and its escort keep their size in frame). It never ends by itself: it runs in a race with the line it
 * covers, so the line always decides when the shot ends (watched or skipped). Nothing moves while skipping.
 */
function* follow(z: ZoneRuntime, c: CineCtx, ship: THREE.Object3D | null, from: THREE.Vector3): Routine {
  const idle = (): boolean => false;
  if (!ship) {
    yield idle;
    return;
  }
  const aim = new THREE.Vector3();
  const look = new THREE.Vector3();
  ship.getWorldPosition(look);
  for (;;) {
    if (z.skipping) {
      yield idle;
      return;
    }
    ship.getWorldPosition(aim);
    look.lerp(aim, 0.12);
    const dist = Math.max(1, from.distanceTo(look));
    const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(26 / dist)), 16, 58);
    c.cut({ pos: from, look: look.clone(), fov });
    yield;
  }
}

/** at the ramp: they board; the craft leave along opposite vectors; the displays; the closing cards */
export function* departureScene(z: ZoneRuntime): Routine {
  const g = z.game;
  const ui = g.ui;
  const sp = S.sp;
  const party = [z.cast('lyessa'), z.cast('selene'), z.cast('tharne'), z.cast('lyric')];
  yield* z.cinematic('z12-departure', function* (c: CineCtx): Routine {
    S.alert?.show(0, 0.4);
    // aboard: the bodies go inside, the ramps rise
    for (const b of party) b?.actor.visual?.setVisible(false);
    z.player.visual?.setVisible(false);
    if (sp?.dom) sp.dom.params.ramp = 0;
    if (sp?.ref) sp.ref.params.ramp = 0;
    c.cut({ pos: z.P(21, 1.4, 1.6), look: z.P(21, 16, 3.6), fov: 56 });
    c.moveAsync({ pos: z.P(21, 2.6, 1.9), look: z.P(21, 16, 4.6), fov: 54 }, 9, 'inOut');
    if (!z.skipping) {
      g.audio.play('engineSpool', { pos: z.m('domRampBottom') });
      g.audio.play('engineSpool', { pos: z.m('refRampBottom'), volume: 0.8 });
    }
    yield 2.6;
    if (sp?.dom) sp.dom.params.engines = 1;
    if (sp?.ref) sp.ref.params.engines = 1;
    yield 1.4;
    // “the two vessels detach from Aurelion along opposite vectors”
    prepareFlights(z);
    S.t = 0;
    if (!z.skipping) g.audio.play('shipDepart', { pos: z.m('centre') });
    yield RISE + 0.8;
    // “Amber ships surround Tarrik, while blue-white vessels close around Selene.” Each display line rides a shot
    // that follows its craft out from behind, toward the Wound, while its own escort closes in around it
    // (integration wave: the escorts are the generated craft — see updateZ12). Same lines, same timing.
    yield { race: [
      z.say('Dominion Command', 'CROWNWATCH · SOVEREIGN PRIORITY · IMMEDIATE RETURN', { channel: 'system', offscreen: true }), // NEW (speaker label; the text is the book's)
      // from behind, as his craft turns and heads out toward the Wound and the red remnant beyond it (polish 4: the
      // camera stands low behind the berth, looking north through the open edge — it used to look north-west and
      // see mostly the hangar's west wall)
      follow(z, c, sp?.dom?.object ?? null, z.P(FOLLOW_DOM[0], FOLLOW_DOM[1], FOLLOW_DOM[2])),
    ] };
    yield { race: [
      z.say('Reformation Command', 'MESTRIA · CONTINUITY REVIEW · MANDATORY APPEARANCE', { channel: 'system', offscreen: true }), // NEW (speaker label; the text is the book's)
      // across the hangar, as hers goes out over the edge toward the white remnant and her escort closes in
      // (polish 4: from the causeway, low, looking north-east past her berth to the open edge, not at the east wall)
      follow(z, c, sp?.ref?.object ?? null, z.P(FOLLOW_REF[0], FOLLOW_REF[1], FOLLOW_REF[2])),
    ] };
    // the two groups, diverging along opposite vectors over the open edge
    c.cut({ pos: z.P(21, 21.4, 1.4), look: z.P(21, 120, 24), fov: 58 });
    yield waitOr(z, () => z.skipping || S.t >= FLIGHT_END - 3, 14);
    if (!z.skipping) ui.card('Each now carries the truth the other civilization buried.\nEach possesses one half of the authority required to open the prison.\nEach believes the other will refuse.', { style: 'context' });
    yield 9;
    // the final visual: restrained — two rooms, two displays, neither knowing of the other
    if (!z.skipping) ui.fade(1, 1.6, 'black');
    yield 1.8;
    if (!z.skipping) ui.card('CONTRARY BEARER CONCURRENCE REQUIRED', { style: 'consequence', sub: 'Crownwatch' }); // NEW (sub: place name)
    yield 3.4;
    if (!z.skipping) ui.card('ALTERNATIVE SOVEREIGN AUTHORITY PATH\nFEASIBILITY ASSESSMENT', { style: 'consequence', sub: 'Crownwatch' }); // NEW (sub: place name)
    yield 4.2;
    if (!z.skipping) ui.card('TERMINAL DENIAL PROTOCOL\nCONCURRENCE OVERRIDE ANALYSIS', { style: 'consequence', sub: 'Mestria' }); // NEW (sub: place name)
    yield 4.4;
    if (!z.skipping) ui.card('No one in the room believes they are trying to open the prison.\nNeither team knows the other has begun.', { style: 'context' });
    yield 7;
    if (!z.skipping) ui.card(null);
    yield 1.2;
    // the last card over the Wound: the hangar empty, the ships gone
    c.cut({ pos: z.P(21, 6, 1.7), look: z.P(21, 400, 70), fov: 48 });
    c.moveAsync({ pos: z.P(21, 9, 1.75), look: z.P(21, 400, 72), fov: 45 }, 12, 'inOut');
    if (!z.skipping) ui.fade(0, 2.4);
    yield 2.6;
    if (!z.skipping) ui.card('The Wound stays closed.\nFor now.', { style: 'context', seconds: 8.4 });
    yield 6.5;
    // end state
    S.t = FLIGHT_END;
    for (const f of S.flights) f.ship.visible = false;
    S.alert?.show(0, 0.5);
    // CP9 and the completion screen; the scene never hands the camera back (the card fades out with the screen)
    yield* z.completeMission();
  }, { blendOut: 0 });
}
