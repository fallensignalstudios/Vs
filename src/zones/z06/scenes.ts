/**
 * Z06 — the authored scenes (SCRIPT_SOURCE Z06). The author's lines are exact (curly apostrophes and the …
 * character are the book's) and play in order; every new string is tagged `// NEW`. Skip = fast-forward: every
 * state change happens inside the routine; only sound, VFX and captions sit behind `!z.skipping`.
 *
 *   kingScene      «King?» / «King…» — only Tarrik and Lyessa witness it; nobody remarks on it
 *   arrival        (in play) Selene, Tharne and Lyric come through the entry only after it
 *   rescueScene    the marine takes his hand — «Move.»
 *   groundingScene Lyric's episode and Tharne's grounding (a protected authored beat; every line plays)
 *   toTheGallery   the walk to the exit under distant impacts and radio walla (no new lines)
 */
import * as THREE from 'three';
import type { Actor, CineCtx, Companion, Encounter, Routine, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { VIOLET, atPost, standardExit, waitOr, walkTo } from '../shared';
import { S } from './state';

/** the speaker tag SCRIPT_SOURCE gives the first body */
const BODY = 'Eclipse body';
/**
 * Lyric's corruption: as she arrives, at the peak of the episode, and once the presence has gone (never cured).
 * Face-only (chars 'face' mode: violet irises, dark veins at the temples and down the neck that reach further as
 * the amount rises), so the amounts can climb high enough to read at conversation distance.
 */
export const LYRIC_CORRUPTION = { arrive: 0.38, episode: 0.6, scream: 0.8, peak: 1.0, after: 0.45 } as const;
/**
 * Polish 4 (chars `CorruptionOpts.arms`): «Black patterns race down both arms» — the face-mode patterns run down her
 * arms at the scream (0 → 1 over the beat after it), and a trace of them stays once the presence has gone (Z07 and
 * Z08 carry the same trace).
 */
export const LYRIC_ARMS_AFTER = 0.25;

const _v = new THREE.Vector3();

// =====================================================================================================================
// «King?»
// =====================================================================================================================

/** the first body, standing just inside the junction (idempotent; a free-standing actor outside E3) */
function spawnKing(z: ZoneRuntime): Actor {
  if (S.king) return S.king;
  // «Half the face remains human»: a man's head grafted on, one half of it taken (chars `halfHuman`)
  S.king = z.game.ai.spawnEnemy('linkbound', {
    pos: z.m('kingAt'), yaw: z.myaw('kingAt'), dormant: true, tags: ['z06King'], seed: 11, look: { halfHuman: true },
  });
  return S.king;
}

/**
 * RELOCATED (ch24, Tarrik's approach corridor). In the first seconds, before Selene comes in, one of the first
 * bodies — centuries-old Dominion armor — turns its one human eye on Tarrik: «King?». He stops; it lunges; as he
 * kills it the eye stays on him: «King…». Never explained, never remarked on; Lyessa is the only other witness.
 */
export function* kingScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const lyessa = z.cast('lyessa');
  const king = spawnKing(z);
  const kp = z.m('kingAt');
  const tp = z.m('kingFace');

  yield* z.cinematic('z06-king', function* (c: CineCtx): Routine {
    // the junction from the doorway: the plate in the middle, bodies hunched at it, violet only at the far breach
    c.cut({ pos: z.P(0.8, 23.4, 2.3), look: z.P(27, 15, 1.1), fov: 52 });
    c.moveAsync({ pos: z.P(2.4, 23.0, 2.0), look: z.P(27, 14.5, 1.0), fov: 46 }, 4.6, 'inOut');
    if (!z.skipping) game.audio.play('eclipseBreath', { pos: z.m('lb0'), volume: 0.5 });
    yield 2.8;

    // he walks in; one of the first bodies turns toward him
    game.player.teleport(tp, z.myaw('kingFace'));
    lyessa?.teleport(z.m('lyessaWatch'), z.myaw('lyessaWatch'));
    king.face(tp);
    c.twoShot(kp, tp, { side: 1, distance: 1.9, fov: 38 });
    yield 1.2;
    // half of it is still a man; one eye fixes on him — close over his shoulder (a soft light on the human half)
    if (S.kingLight) S.kingLight.intensity = 4.5;
    // (polish 4: low and close from his side, looking up into the bowed head — the half face fills the frame)
    c.cut({ pos: z.P(7.3, 20.6, 1.2), look: z.P(8.55, 21.2, 1.45), fov: 28 });
    c.dof(1.4, 0.5);
    yield 0.5;
    yield* z.say(BODY, 'King?'); // RELOCATED (ch24, Tarrik's approach corridor)
    c.dof(null);
    // he stops
    c.shot(tp, { yawDeg: 100, distance: 1.7, height: 1.62, lookHeight: 1.66, fov: 34 });
    z.player.visual?.lookAt(kp.clone().setY(1.65));
    yield 1.2;

    // and the creature lunges; he kills it
    if (S.kingLight) S.kingLight.intensity = 0;
    c.cut({ pos: z.P(7.6, 19.2, 1.35), look: z.P(7.7, 21.5, 1.15), fov: 46 });
    king.visual?.play('lunge');
    if (!z.skipping) game.audio.play('eclipseLunge', { pos: kp });
    yield 0.3;
    game.player.playScripted('attackHeavy', { faceTo: kp });
    yield 0.42;
    if (!z.skipping) {
      const hit = king.aimPoint(_v).clone();
      game.vfx.spawn('sparkHeavy', hit, { dir: { x: 1, y: 0.1, z: 0 } });
      game.vfx.spawn('violetBurst', hit, { scale: 0.5 });
      game.audio.play('bladeHitFlesh', { pos: hit });
      game.camera.shake(0.3, 0.3);
    }
    game.actors.kill(king, null);
    yield 0.7;
    // the eye stays on him: low beside the body, looking up at him
    c.cut({ pos: z.P(8.9, 22.4, 0.45), look: z.P(6.9, 21.6, 1.55), fov: 40 });
    yield 0.4;
    yield* z.say(BODY, 'King…'); // RELOCATED (ch24, Tarrik's approach corridor)
    yield 0.9;
    // Lyessa saw it. Nobody speaks.
    z.player.visual?.lookAt(null);
    c.shot(z.m('lyessaWatch'), { yawDeg: 75, distance: 2.2, height: 1.6, lookHeight: 1.6, fov: 36 });
    lyessa?.actor.visual?.lookAt(tp.clone().setY(1.7));
    yield 1.6;
    lyessa?.actor.visual?.lookAt(null);
    // end state — identical watched or skipped
    if (king.alive) game.actors.kill(king, null);
    if (S.kingLight) S.kingLight.intensity = 0;
    z.setFlag('z06King', true);
  }, { blendOut: 0.5 });
}

// =====================================================================================================================
// Arrival (in play)
// =====================================================================================================================

/**
 * Selene, Tharne and Lyric come through the entry only after «King…»: she joins the fight, they go up to the
 * side refuge and stay there, protected. `seleneIn` releases the ceiling attacker («Selene enters behind them as
 * a creature races across the ceiling»).
 */
export function* arrival(z: ZoneRuntime, enc: Encounter): Routine {
  const selene = z.cast('selene');
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  if (S.entry) {
    S.entry.setState('open');
    z.openDoor(S.entry, true);
  }
  walkTo(z, selene, 'seleneIn', { run: true });
  walkTo(z, tharne, 'tharneRefuge', { run: true });
  walkTo(z, lyric, 'lyricRefuge', { run: true });
  yield waitOr(z, () => !selene || selene.actor.pos.x > 1.2, 6);
  if (selene) selene.mode = 'combat';
  enc.flags.seleneIn = true;
  z.setFlag('z06SeleneIn', true);
  z.fork(settleRefuge(z, tharne, lyric), 'refuge');
}

/** once at the refuge they keep low */
function* settleRefuge(z: ZoneRuntime, tharne: Companion | null, lyric: Companion | null): Routine {
  for (const [c, post] of [[tharne, 'tharneRefuge'], [lyric, 'lyricRefuge']] as const) {
    if (!c) continue;
    yield waitOr(z, () => atPost(z, c, post, 0.9), 14);
    c.teleport(z.m(post), z.myaw(post));
    c.play('kneel', { loop: true });
  }
}

// =====================================================================================================================
// The marine
// =====================================================================================================================

/**
 * «A Reformation marine trapped beneath fallen plating sees him approach, and enemy recognition flashes across
 * his face. Tarrik reaches down anyway. The marine hesitates, takes his hand, and lets Tarrik pull him free.»
 * Then «Move.» and «The marine obeys.» The marine has breath and a look, no line; nobody thanks anybody.
 */
export function* rescueScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const marine = z.cast('marine');
  const stand = z.m('plateStand');
  const mp = z.m('marine');
  const selene = z.cast('selene');
  yield* z.cinematic('z06-rescue', function* (c: CineCtx): Routine {
    // Selene covers the far side of the plate (out of the frame)
    selene?.teleport(z.m('seleneCover'), z.myaw('seleneCover'));
    selene?.holdAt(z.m('seleneCover'), z.myaw('seleneCover'));
    // the plate held high on its rubble; under the edge, the marine sees whose armour it is
    if (S.plate) S.plate.params.lift = 1;
    game.player.teleport(stand, z.myaw('plateStand'));
    game.player.playScripted('liftPlate', { faceTo: z.m('plateCentre') });
    if (!z.skipping) game.audio.play('plateLift', { pos: stand });
    c.cut({ pos: mp.clone().add(_v.set(0, 0.32, 0)).lerp(stand, 0.35).setY(0.42), look: stand.clone().setY(1.5), fov: 40 });
    marine?.actor.visual?.lookAt(stand.clone().setY(1.6));
    if (!z.skipping) game.audio.play('armorRattle', { pos: mp, volume: 0.5 });
    yield 1.6;
    // he braces it on the rubble and reaches down anyway
    if (S.plate) S.plate.params.lift = 0.85;
    z.player.visual?.stop('liftPlate');
    game.player.playScripted('handOver', { faceTo: mp });
    c.shot(stand, { yawDeg: 300, distance: 2.6, height: 1.05, lookHeight: 0.75, fov: 40 });
    yield 1.1;
    // the hesitation; then he takes the hand
    yield 0.8;
    marine?.stopAction();
    marine?.teleport(z.m('marineOut'), z.myaw('marineOut'));
    marine?.play('getUp');
    if (!z.skipping) game.audio.play('armorRattle', { pos: z.m('marineOut') });
    yield 1.1;
    c.shot(stand, { yawDeg: 210, distance: 2.0, height: 1.6, lookHeight: 1.6, fov: 36 });
    game.player.playScripted('idle', { faceTo: z.m('marineOut') });
    yield* z.say('Tarrik', 'Move.', { actor: z.player });
    // «The marine obeys.» — the plate comes down behind him
    walkTo(z, marine, 'marineSafe', { run: true });
    if (S.plate) S.plate.params.lift = 0;
    yield 0.5;
    if (!z.skipping) {
      game.vfx.spawn('dustPuff', z.m('plateCentre').setY(0.2), { scale: 2 });
      game.audio.play('debrisFall', { pos: z.m('plateCentre') });
      game.camera.shake(0.2, 0.35);
    }
    yield 0.8;
    // end state — identical watched or skipped
    marine?.actor.visual?.lookAt(null);
    if (S.plate) S.plate.params.lift = 0;
    z.story('marineRescued');
    z.setFlag('z06MarineFree', true);
  }, { blendOut: 0.4 });
  // she goes back to fighting at his side (a mode assignment releases the held post)
  if (selene) selene.mode = 'combat';
  if (marine && !atPost(z, marine, 'marineSafe', 1.2)) walkTo(z, marine, 'marineSafe', { run: true });
  z.fork(marineSettles(z, marine), 'marine');
}

function* marineSettles(z: ZoneRuntime, marine: Companion | null): Routine {
  if (!marine) return;
  yield waitOr(z, () => atPost(z, marine, 'marineSafe', 0.9), 16);
  marine.teleport(z.m('marineSafe'), z.myaw('marineSafe'));
  marine.play('sitInjured', { loop: true });
}

// =====================================================================================================================
// Lyric
// =====================================================================================================================

/**
 * The protected beat (≈ 45 s). Lyric's condition answers the Eclipse; for one second something else looks out
 * of her; Tharne brings her back by name. She is a person throughout: never an enemy, never cured, never
 * explained. Tarrik raises his blade and does nothing more. Every line plays, in order.
 */
export function* groundingScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const lyessa = z.cast('lyessa');
  const selene = z.cast('selene');
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const L = z.m('gLyric');
  const T = z.m('gTarrik');
  const LY = z.m('gLyessa');
  const SK = z.m('gSelene');
  const TH = z.m('gTharne');
  const TB = z.m('gTharneBlock');
  const fig = (amount: number, arms: number): void => lyric?.actor.visual?.setCorruption(amount, { mode: 'face', arms });

  yield* z.cinematic('z06-grounding', function* (c: CineCtx): Routine {
    game.audio.setMusic('silence', 2);
    // the others where the fight left them; Lyric down from the refuge, Tharne close enough to catch her.
    // Every camera stays on the open (south) side of the group.
    for (const s of [selene, tharne, lyric, lyessa]) s?.stopAction();
    if (selene) selene.mode = 'scripted';
    if (lyessa) lyessa.mode = 'scripted';
    game.player.teleport(T, z.myaw('gTarrik'));
    lyessa?.teleport(LY, z.myaw('gLyessa'));
    selene?.teleport(z.m('gSeleneStand'), z.myaw('gSeleneStand'));
    lyric?.teleport(z.m('gLyricFrom'), z.myaw('gLyric'));
    tharne?.teleport(z.m('gTharneFrom'), z.myaw('gLyric'));
    // «Violet patterns now cross most of her face»
    fig(LYRIC_CORRUPTION.episode, 0);
    walkTo(z, lyric, 'gLyric');
    walkTo(z, tharne, 'gTharne');
    c.cut({ pos: z.P(14.6, 2.0, 1.7), look: z.P(12.6, 7.4, 1.25), fov: 44 });
    yield waitOr(z, () => z.skipping || (atPost(z, lyric, 'gLyric', 0.5) && atPost(z, tharne, 'gTharne', 0.6)), 3.2);
    lyric?.teleport(L, z.myaw('gLyric'));
    tharne?.teleport(TH, z.myaw('gTharne'));
    lyric?.face(LY);
    lyessa?.face(L);

    const group = (): void => c.cut({ pos: z.P(13.4, 3.4, 1.45), look: z.P(12.9, 7.3, 0.95), fov: 44 });
    const onLyessa = (): void => c.shot(LY, { yawDeg: 205, distance: 2.3, height: 1.62, lookHeight: 1.62, fov: 32 });
    const onLyricUp = (): void => c.shot(L, { yawDeg: 105, distance: 2.0, height: 1.58, lookHeight: 1.55, fov: 32 });
    onLyessa();
    yield* z.say('Lyessa', 'What is happening to you?', { actor: lyessa });
    onLyricUp();
    yield* z.say('Lyric', 'Charming concern.', { actor: lyric });
    onLyessa();
    yield* z.say('Lyessa', 'Answer me.', { actor: lyessa });
    onLyricUp();
    yield* z.say('Lyric', 'The prison likes me.', { actor: lyric });
    // her laugh breaks halfway through and her knees give; Tharne catches her
    lyric?.play('grounding', { loop: true });
    tharne?.play('kneelTend', { loop: true });
    if (!z.skipping) game.audio.play('armorRattle', { pos: L, volume: 0.6 });
    group();
    yield 0.9;
    yield* z.say('Tharne', 'Lyric.', { actor: tharne });
    // Selene kneels in front of her
    selene?.teleport(SK, z.myaw('gSelene'));
    selene?.play('kneel', { loop: true });
    lyric?.face(SK);
    const onSelene = (): void => c.cut({ pos: z.P(12.9, 5.2, 1.2), look: z.P(13.4, 7.65, 1.1), fov: 34 });
    const onLyricLow = (): void => c.cut({ pos: z.P(14.1, 5.85, 1.15), look: z.P(12.5, 7.0, 1.08), fov: 34 });
    onSelene();
    yield* z.say('Selene', 'Look at me.', { actor: selene });
    // «Black patterns race down both arms, and she screams.»
    fig(LYRIC_CORRUPTION.scream, 0);
    lyric?.actor.visual?.flash(VIOLET, 0.6, 0.45);
    if (!z.skipping) {
      game.audio.play('eclipseBreath', { pos: L, volume: 0.8, pitch: 1.3 });
      game.events.emit('caption', { text: 'Lyric screams', kind: 'alert', pos: L }); // NEW
    }
    onLyricLow();
    // the patterns race down both arms over the beat that follows (the same 0.9 s as before)
    for (let k = 1; k <= 9; k++) {
      fig(LYRIC_CORRUPTION.scream, k / 9);
      yield 0.1;
    }
    yield* z.say('Lyric', 'No. No, no…', { actor: lyric });
    // Tharne grips her hand
    holdHands(tharne, lyric, true);
    c.cut({ pos: z.P(12.3, 4.9, 1.15), look: z.P(11.6, 7.2, 1.1), fov: 34 });
    yield* z.say('Tharne', 'What do you see?', { actor: tharne });
    onLyricLow();
    yield* z.say('Lyric', 'They aren’t leaking.', { actor: lyric });
    onSelene();
    yield* z.say('Selene', 'What?', { actor: selene });
    // she looks toward the lower structure
    lyric?.actor.visual?.lookAt(z.m('impactBelow').setY(-4));
    onLyricLow();
    yield* z.say('Lyric', 'They’re reaching.', { actor: lyric });
    // «Something strikes the complex from below.»
    if (!z.skipping) {
      game.camera.shake(0.55, 1.2);
      game.audio.play('structuralGroan', { volume: 0.9 });
      game.audio.play('fleetImpact', { pos: z.m('impactBelow') });
      game.vfx.spawn('debrisFall', z.P(15, 10, 11));
      game.vfx.spawn('debrisFall', z.P(9.5, 12, 11));
      game.events.emit('caption', { text: 'Impact below', kind: 'impact', pos: z.m('impactBelow') }); // NEW
    }
    c.cut({ pos: z.P(17.6, 2.6, 2.8), look: z.P(13.4, 7.4, 0.9), fov: 46 });
    yield 1.3;
    onLyricLow();
    yield* z.say('Lyric', 'They know the marks are here.', { actor: lyric });

    // Tarrik looks down at Neon Veil; Selene touches Caerion II
    z.player.visual?.lookAt(T.clone().add(_v.set(0.25, 1.05, 0)));
    c.shot(T, { yawDeg: 240, distance: 1.4, height: 1.6, lookHeight: 1.45, fov: 32 });
    yield 1.1;
    selene?.actor.visual?.lookAt(SK.clone().add(_v.set(-0.2, 0.6, 0)));
    onSelene();
    yield 1.0;
    // «Lyric’s head snaps toward Tarrik. The movement is not her choice … something else looks through her.»
    // Selene comes up off her knee and back a step
    selene?.stopAction();
    selene?.actor.visual?.lookAt(null);
    selene?.teleport(z.m('gSeleneStand'), z.myaw('gSeleneStand'));
    lyric?.face(T);
    lyric?.actor.visual?.lookAt(T.clone().setY(1.75));
    fig(LYRIC_CORRUPTION.peak, 1);
    lyric?.actor.visual?.flash(VIOLET, 0.9, 0.6);
    if (!z.skipping) game.audio.play('ambWhisper', { pos: L, volume: 0.9 });
    c.cut({ pos: z.P(13.7, 5.6, 1.12), look: z.P(12.5, 7.0, 1.1), fov: 30 });
    c.dof(1.85, 0.6);
    yield 1.3;
    c.dof(null);
    // Tarrik raises his blade — and nothing more
    z.player.visual?.lookAt(L.clone().setY(1.0));
    game.player.playScripted('raiseWeapon', { faceTo: L });
    c.cut({ pos: z.P(11.2, 5.4, 1.35), look: z.P(15.1, 6.0, 1.5), fov: 38 });
    yield 0.9;
    // Tharne moves directly in front of her
    holdHands(tharne, lyric, false);
    tharne?.stopAction();
    tharne?.teleport(TB, z.myaw('gTharneBlock'));
    c.cut({ pos: z.P(15.7, 5.0, 1.62), look: z.P(13.4, 6.6, 1.5), fov: 36 });
    yield* z.say('Tharne', 'Don’t.', { actor: tharne });
    tharne?.face(L);
    tharne?.play('kneelTend', { loop: true });
    const pair = (): void => c.cut({ pos: z.P(12.75, 4.7, 1.15), look: z.P(12.95, 6.8, 1.02), fov: 36 });
    pair();
    yield* z.say('Tharne', 'Lyric. Stay here.', { actor: tharne });
    // her mouth opens with no voice; her hand closes on his wrist, hard enough to make him wince
    reachWrist(tharne, lyric, true);
    c.cut({ pos: z.P(12.9, 5.5, 0.95), look: z.P(12.95, 6.8, 0.85), fov: 34 });
    yield 1.6;
    pair();
    yield* z.say('Tharne', 'Lyric.', { actor: tharne });
    // «She blinks; the presence behind her eyes vanishes.» — the presence, not the infection
    fig(LYRIC_CORRUPTION.after, LYRIC_ARMS_AFTER);
    lyric?.actor.visual?.lookAt(TB.clone().setY(1.0));
    game.player.playScripted('lowerWeapon');
    z.player.visual?.lookAt(null);
    const onLyricBack = (): void => c.cut({ pos: z.P(13.75, 5.3, 1.15), look: z.P(12.5, 7.0, 1.08), fov: 32 });
    const onTharneBack = (): void => c.cut({ pos: z.P(12.0, 5.2, 1.2), look: z.P(13.4, 6.6, 1.05), fov: 32 });
    onLyricBack();
    yield* z.say('Lyric', 'Tharne.', { actor: lyric });
    onTharneBack();
    yield* z.say('Tharne', 'I’m here.', { actor: tharne });
    // she sees his wrist and lets go
    reachWrist(tharne, lyric, false);
    onLyricBack();
    yield* z.say('Lyric', 'Sorry.', { actor: lyric });
    onTharneBack();
    yield* z.say('Tharne', 'Later.', { actor: tharne });
    // her laugh is weak but human
    group();
    yield* z.say('Lyric', 'You keep saying that.', { actor: lyric });
    yield 0.8;

    // end state — identical watched or skipped
    holdHands(tharne, lyric, false);
    reachWrist(tharne, lyric, false);
    lyric?.actor.visual?.lookAt(null);
    selene?.actor.visual?.lookAt(null);
    fig(LYRIC_CORRUPTION.after, LYRIC_ARMS_AFTER);
    z.setFlag('z06Grounded', true);
  }, { blendOut: 0.5 });
}

/** Tharne's right hand on Lyric's left (on), or released */
function holdHands(tharne: Companion | null, lyric: Companion | null, on: boolean): void {
  const tv = tharne?.actor.visual;
  const lv = lyric?.actor.visual;
  if (!isHumanoidVisual(tv)) return;
  if (!on || !lv) {
    tv.setHandTarget('R', null);
    return;
  }
  tv.setHandTarget('R', lv.socket('handL').getWorldPosition(new THREE.Vector3()), 1);
}

/** Lyric's hand closes on Tharne's wrist (on), or lets go */
function reachWrist(tharne: Companion | null, lyric: Companion | null, on: boolean): void {
  const lv = lyric?.actor.visual;
  const tv = tharne?.actor.visual;
  if (!isHumanoidVisual(lv)) return;
  if (!on || !tv) {
    lv.setHandTarget('R', null);
    return;
  }
  lv.setHandTarget('R', tv.socket('handL').getWorldPosition(new THREE.Vector3()), 1);
  tharne?.actor.visual?.flash(0xffffff, 0.15, 0.3);
}

// =====================================================================================================================
// To the gallery
// =====================================================================================================================

/** everyone falls in behind him; the exit opens; distant impacts and both fleets' channels keep the urgency */
export function* toTheGallery(z: ZoneRuntime): Routine {
  const game = z.game;
  for (const name of ['selene', 'lyessa', 'tharne', 'lyric'] as const) {
    const c = z.cast(name);
    if (!c) continue;
    c.stopAction();
    c.mode = 'follow';
    c.follow(z.player);
  }
  game.audio.setMusic('breach', 3);
  z.fork(radioWalla(z), 'walla');
  yield* standardExit(z, S.exit, 'Z07', { at: 'exit' });
}

/** «The tactical alarm changes … Dominion and Reformation channels activate at once.» — sound, never words */
function* radioWalla(z: ZoneRuntime): Routine {
  const game = z.game;
  yield 2.2;
  for (let n = 0; ; n++) {
    if (!z.skipping) {
      game.audio.play('ambCommBlip', { volume: 0.8 });
      game.audio.play('ambPA', { volume: 0.55 });
      if (n === 0) game.events.emit('caption', { text: 'Dominion and Reformation channels, both at once', kind: 'ambient' }); // NEW
    }
    yield 2.6;
    if (!z.skipping) {
      game.audio.play('fleetImpact', { volume: 0.7 });
      game.camera.shake(0.1, 0.6);
      if (n < 2) game.events.emit('caption', { text: 'Distant impact', kind: 'impact' }); // NEW
    }
    yield 5 + (n % 3);
  }
}
