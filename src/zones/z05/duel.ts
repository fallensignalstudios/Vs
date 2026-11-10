/**
 * Z05 `meeting` → CP3: the walk in, the meeting (SCRIPT_SOURCE Z05 `meeting`, the author's lines exact) and the
 * duel — fierce, as in the book (author's ruling 7); only the kill is withheld, and that comes in `carrier`.
 * The duel is an authored scene with three familiar, forgiving prompts (deflect, dodge, strike); automatic
 * prompts complete them; a missed prompt changes one move of the choreography and nothing else. No health
 * bars, no victor, no squad fire. Every state change is unconditional; only VFX / audio wait on `!z.skipping`.
 */
import * as THREE from 'three';
import type { Actor, ButtonAction, CamPose, CineCtx, Companion, Routine, Vec3Like, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { rightX, rightZ, forwardX, forwardZ, yawTo } from '@/core/mathx';
import { CINDER, FROST, atPost, conversation, waitOr, walkTo } from '../shared';
import { SOLDIERS, burnBlade } from './cast';
import { S, glide, place } from './state';

// ---------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------

/** camera beside the line a → b, `side` metres off it (sign picks the side), looking at the middle */
function flank(a: Vec3Like, b: Vec3Like, side: number, height = 1.55, fov = 40, along = 0): CamPose {
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.max(1e-3, Math.hypot(dx, dz));
  const px = -dz / l;
  const pz = dx / l;
  return {
    pos: { x: mx + px * side + (dx / l) * along, y: a.y + height, z: mz + pz * side + (dz / l) * along },
    look: { x: mx, y: a.y + 1.25, z: mz }, fov,
  };
}

/** turn two bodies toward each other (the companion keeps facing the other until told otherwise) */
function faceOff(sel: Actor, tar: Companion | null): void {
  if (!tar) return;
  const t = tar.actor;
  sel.yaw = yawTo(sel.pos.x, sel.pos.z, t.pos.x, t.pos.z);
  t.yaw = yawTo(t.pos.x, t.pos.z, sel.pos.x, sel.pos.z);
  tar.face(sel.pos.clone());
}

/** chest-height midpoint between two bodies (where the blades meet) */
function between(a: Actor, b: Actor | undefined, h = 1.4): THREE.Vector3 {
  const p = a.pos.clone();
  if (b) p.lerp(b.pos, 0.5);
  p.y += h;
  return p;
}

/**
 * One duel prompt: a familiar input in a wide window, auto-confirmed by the accessibility setting. Input is
 * switched to the game context for the window (a cinematic only reads skip) and the HUD shows only while the
 * prompt is up. Returns whether it was answered; a skip answers nothing and counts as answered (it is
 * choreography only — the outcome never depends on it).
 */
function* duelPrompt(z: ZoneRuntime, id: string, prompt: string, button: ButtonAction, window: number): Routine<boolean> {
  if (z.skipping) return true;
  const game = z.game;
  const r: { answered: boolean | null } = { answered: null };
  game.input.setContext('game');
  game.ui.setHudVisible(true);
  game.time.slowMo(0.42, 0.7);
  game.player.setContextAction({
    id, prompt, button, window, autoConfirmable: true,
    onConfirm: () => { r.answered = true; },
    onExpire: () => { r.answered = false; },
  });
  yield () => r.answered !== null || z.skipping;
  game.player.setContextAction(null);
  game.ui.setHudVisible(false);
  if (game.input.context === 'game') game.input.setContext('cinematic');
  return r.answered !== false;
}

// ---------------------------------------------------------------------------------------------------------
// the beat
// ---------------------------------------------------------------------------------------------------------

/** `meeting` → CP3: walk in, the two groups meet, the duel */
export function* meeting(z: ZoneRuntime): Routine {
  z.objective('Reach the shaft', 'seleneStop'); // NEW
  const stop = z.m('seleneStop');
  yield waitOr(z, () => Math.hypot(z.player.pos.x - stop.x, z.player.pos.z - stop.z) < 9, 75);
  z.objective(null);
  yield* meetingScene(z);
  yield* duelScene(z);
}

/** the groups stop ≈ 20 m apart; the leaders close to ≈ 10 m; hold fire; the exchange */
function* meetingScene(z: ZoneRuntime): Routine {
  const game = z.game;
  yield* z.cinematic('z05-meeting', function* (c: CineCtx): Routine {
    const sel = game.player.actor;
    const tharne = z.cast('tharne');
    const lyric = z.cast('lyric');
    const tarrik = z.cast('tarrik');
    const lyessa = z.cast('lyessa');
    const soldiers = SOLDIERS.map((s) => z.cast(s));
    const north: Array<[Companion | null, string]> = [[lyessa, 'lyessa'], [tarrik, 'tarrik'], ...soldiers.map((s, i): [Companion | null, string] => [s, SOLDIERS[i]])];

    // Selene's people take their places (the first cut hides the step)
    place(z, sel, z.m('seleneStop'), z.myaw('seleneStop'));
    for (const k of [tharne, lyric]) if (k) k.mode = 'scripted';
    walkTo(z, tharne, 'tharneStop');
    walkTo(z, lyric, 'lyricStop');
    // the Dominion side comes in off the north bridge: Lyessa first, rifle raised; then Tarrik
    for (const [k, key] of north) {
      if (!k) continue;
      k.teleport(z.m(`${key}In`), z.myaw(`${key}In`));
      k.actor.visual?.setVisible(true);
      walkTo(z, k, `${key}Stop`);
    }
    lyessa?.play('aimRifle', { loop: true });
    burnBlade(z, tarrik);

    // the whole room: the platform small under the battle, the north side coming in
    c.cut({ pos: z.P(52.5, 41.5, 2.4), look: z.P(58, 96, 9), fov: 52 });
    c.moveAsync({ pos: z.P(51.6, 44, 2.0), look: z.P(57, 96, 6.5), fov: 46 }, 5.5, 'inOut');
    // Caerion II warms under her armor before she sees him
    sel.visual?.setGlow(1.7);
    if (!z.skipping) game.audio.play('ambGoldPing', { pos: sel.pos, volume: 0.6 });
    yield 3.0;
    if (lyessa) {
      c.shot(lyessa.actor.pos, { yawDeg: 200, distance: 4.2, height: 1.5, lookHeight: 1.5, fov: 36 });
      c.drift({ around: lyessa.actor.pos, yawRate: 0.05 });
    }
    yield 2.2;
    // “with Velkorran burning in one hand” — and the one flash as Selene first sees him
    if (tarrik) c.twoShot(tarrik.actor.pos, sel.pos, { side: 1, distance: 2.0, fov: 30 });
    if (!z.skipping) game.ui.card('DO NOT LET HIM KNEEL.', { style: 'flash' });
    yield 2.8;
    // “For several seconds, no one moves.”
    yield waitOr(z, () => z.skipping || north.every(([k, key]) => atPost(z, k, `${key}Stop`, 1)), 6);
    for (const [k, key] of north) if (k && !atPost(z, k, `${key}Stop`, 1)) k.teleport(z.m(`${key}Stop`), z.myaw(`${key}Stop`));
    for (const [k, key] of [[tharne, 'tharneStop'], [lyric, 'lyricStop']] as const) if (k && !atPost(z, k, key, 1)) k.teleport(z.m(key), z.myaw(key));
    c.cut({ pos: z.P(40.5, 63, 2.2), look: z.P(50, 64, 1.5), fov: 46 });
    c.moveAsync({ pos: z.P(40.8, 61.5, 2.1), look: z.P(50, 64, 1.5), fov: 44 }, 4, 'inOut');
    yield 3.2;

    // the leaders close to ≈ 10 m
    walkTo(z, tarrik, 'tarrikMeet');
    place(z, sel, z.m('seleneMeet'), z.myaw('seleneMeet'));
    if (tarrik) c.shot(z.m('tarrikMeet'), { yawDeg: 160, distance: 3.6, fov: 34 });
    yield waitOr(z, () => z.skipping || atPost(z, tarrik, 'tarrikMeet', 0.5), 4);
    if (tarrik) {
      tarrik.teleport(z.m('tarrikMeet'), z.myaw('tarrikMeet'));
      faceOff(sel, tarrik);
      tarrik.play('guard', { loop: true });
    }
    sel.visual?.setGlow(1);

    const cast = { Tarrik: tarrik, Selene: sel, Lyric: lyric, Lyessa: lyessa };
    yield* conversation(z, c, [['Tarrik', 'Veyne.'], ['Selene', 'Walcur.']], cast, { distance: 2.2, fov: 34 });
    // he gives the order without looking back
    if (tarrik) c.shot(tarrik.actor.pos, { yawDeg: 200, distance: 2.6, height: 1.6, fov: 38 });
    yield* z.say('Tarrik', 'Hold fire.', { actor: tarrik });
    for (const s of soldiers) {
      s?.stopAction();
      s?.play('lowerWeapon');
    }
    // she gives the same order with a hand signal: an open hand, held low, to the people behind her
    c.shot(sel.pos, { yawDeg: 150, distance: 3.2, height: 1.3, lookHeight: 1.1, fov: 40 });
    const sv = sel.visual;
    if (isHumanoidVisual(sv)) {
      const back = 0.42;
      const side = -0.38;
      sv.setHandTarget('L', {
        x: sel.pos.x + rightX(sel.yaw) * side - forwardX(sel.yaw) * back, y: sel.pos.y + 0.82,
        z: sel.pos.z + rightZ(sel.yaw) * side - forwardZ(sel.yaw) * back,
      }, 1);
    }
    yield 1.8;
    if (isHumanoidVisual(sv)) sv.setHandTarget('L', null);
    tharne?.play('nod');

    yield* conversation(z, c, [
      ['Tarrik', 'Get away from the terminal.'],
      ['Selene', 'I was about to tell you the same thing.'],
    ], cast, { distance: 2.2, fov: 34 });
    // Lyessa raises her rifle another centimeter
    if (lyessa) {
      c.shot(lyessa.actor.pos, { yawDeg: 170, distance: 2.4, height: 1.62, lookHeight: 1.55, fov: 30 });
      c.moveAsync({ ...shotNear(z, lyessa.actor.pos, 170, 2.1) }, 1.6, 'inOut');
    }
    yield 1.6;
    // Lyric steps out from behind Selene, violet lines now reaching her cheekbones
    walkTo(z, lyric, 'lyricOut');
    lyric?.actor.visual?.setCorruption(0.34);
    if (lyric) c.shot(z.m('lyricOut'), { yawDeg: 20, distance: 2.0, height: 1.6, lookHeight: 1.58, fov: 30 });
    yield waitOr(z, () => z.skipping || atPost(z, lyric, 'lyricOut', 0.6), 3);
    if (lyric) lyric.face(tarrik ? tarrik.actor.pos.clone() : null);
    yield* z.say('Lyric', 'Your girlfriend points weapons when she gets nervous.', { actor: lyric });
    // “Lyessa’s expression turns murderous.”
    if (lyessa) c.shot(lyessa.actor.pos, { yawDeg: 200, distance: 1.7, height: 1.64, lookHeight: 1.6, fov: 28 });
    yield 1.5;
    yield* conversation(z, c, [
      ['Tarrik', 'Not now.'],
      ['Selene', 'Agreed. Nobody goes below.'],
      ['Tarrik', 'My team does.'],
      ['Selene', 'Then we do not agree.'],
    ], cast, { distance: 2.0, fov: 32 });

    // end state — identical watched or skipped
    if (lyric) lyric.teleport(z.m('lyricOut'), z.myaw('lyricOut'));
    for (const s of soldiers) s?.stopAction();
    if (isHumanoidVisual(sv)) sv.setHandTarget('L', null);
    sel.visual?.setGlow(1);
    z.setFlag('z05Met', true);
  });
}

/** a short push toward a subject from a bearing (camera pose only) */
function shotNear(z: ZoneRuntime, at: THREE.Vector3, yawDeg: number, distance: number): CamPose {
  const a = (yawDeg * Math.PI) / 180;
  return { pos: { x: at.x + Math.sin(a) * distance, y: at.y + 1.62, z: at.z - Math.cos(a) * distance }, look: { x: at.x, y: at.y + 1.55, z: at.z }, fov: 28 };
}

/** the duel — the book's order; three prompts; ends with blades locked and Tarrik between her and the shaft */
function* duelScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const vfx = game.vfx;
  const audio = game.audio;
  yield* z.cinematic('z05-duel', function* (c: CineCtx): Routine {
    const sel = game.player.actor;
    const tarrik = z.cast('tarrik');
    const tar = tarrik?.actor;
    const tv = tar?.visual ?? null;
    const sv = sel.visual;
    const fx = (fn: () => void): void => {
      if (!z.skipping) fn();
    };
    if (!z.skipping) audio.setMusic('duel', 0.5);
    // the others give the leaders room: Tharne goes to his viewmaker across the chamber, Lyric with him
    const tharne = z.cast('tharne');
    const lyric = z.cast('lyric');
    walkTo(z, tharne, 'tharneFar', { run: true });
    walkTo(z, lyric, 'lyricFar');

    // (dir) Tarrik advances toward the shaft. Selene moves to block him.
    tarrik?.stopAction();
    tarrik?.face(null);
    walkTo(z, tarrik, 'dTarAdvance');
    c.cut(flank(z.m('dTarAdvance'), z.m('dSelBlock'), -6.5, 1.7, 44));
    yield 0.9;
    fx(() => audio.play('dodge', { pos: sel.pos }));
    game.player.playScripted('dodge', { faceTo: z.m('dSelBlock') });
    glide(z, sel, z.m('dSelBlock'), 0.45);
    yield 0.75;
    if (tarrik) tarrik.teleport(z.m('dTarAdvance'), z.myaw('dTarAdvance'));
    faceOff(sel, tarrik);
    tarrik?.play('guard', { loop: true });

    // 1 — he opens with a burst of speed; her read arrives first (prompt 1: deflect)
    c.cut(flank(sel.pos, tar?.pos ?? sel.pos, 4.2, 1.45, 38, -0.6));
    tarrik?.stopAction();
    tv?.play('attackHeavyCharge');
    fx(() => tv?.setTelegraph(1, FROST));
    const read = yield* duelPrompt(z, 'z05-deflect', 'Deflect', 'guard', 2.4); // NEW (HUD prompt)
    tv?.setTelegraph(0);
    tv?.play('attackHeavy');
    glide(z, tar, z.m('dTarLunge'), 0.24);
    fx(() => audio.play('swingHeavy', { pos: sel.pos }));
    yield 0.2;
    if (read) {
      // she turns the air between them white; his momentum bleeds away for less than half a second
      game.player.playScripted('deflect');
      fx(() => {
        const p = between(sel, tar);
        vfx.spawn('deflect', p, { dir: { x: 0, y: 0, z: 1 } });
        vfx.spawn('frostBurst', p, { scale: 1.3 });
        audio.play('deflect', { pos: p });
        game.time.slowMo(0.3, 0.45);
      });
      tv?.play('guardHit');
    } else {
      game.player.playScripted('guardHit');
      glide(z, sel, z.m('dSelShoved'), 0.3);
      fx(() => {
        vfx.spawn('sparkHeavy', between(sel, tar), { dir: { x: 0, y: 0.3, z: 1 } });
        audio.play('guardBlock', { pos: sel.pos });
        game.camera.shake(0.35, 0.3);
      });
    }
    yield 0.7;

    // 2 — her rear blade goes toward his throat; Velkorran catches it; heat and frost strip ice from the floor
    c.cut(flank(sel.pos, tar?.pos ?? sel.pos, -3.6, 1.35, 36));
    faceOff(sel, tarrik);
    game.player.playScripted('attackLight2');
    glide(z, sel, z.m('dSelStrike'), 0.22);
    fx(() => audio.play('verityWhirl', { pos: sel.pos }));
    yield 0.26;
    tv?.play('parry');
    fx(() => {
      const p = between(sel, tar, 1.5);
      vfx.spawn('sparkHeavy', p, { dir: { x: 0, y: 1, z: 0 } });
      vfx.spawn('cinderBurst', p, { scale: 0.8 });
      vfx.spawn('frostShatter', p, { scale: 0.9 });
      const floor = between(sel, tar, 0.02);
      vfx.decal('frost', floor, { size: 3.2, life: 30 });
      vfx.spawn('stoneChip', floor, { dir: { x: 0, y: 1, z: 0 }, color: 0xdff2ff, scale: 1.4 });
      audio.play('bladeHitMetal', { pos: p });
      audio.play('frostShatter', { pos: p, volume: 0.7 });
      game.camera.shake(0.4, 0.3);
    });
    yield 0.9;

    // 3 — she gives ground to reshape the geometry; reads his feint; for the first time, Tarrik gives ground
    c.cut(flank(z.m('dSelLanes'), z.m('dTarGives'), 5.4, 1.6, 42));
    game.player.playScripted('dodge', { faceTo: z.m('dSelLanes') });
    glide(z, sel, z.m('dSelLanes'), 0.4);
    fx(() => audio.play('dodge', { pos: sel.pos }));
    yield 0.25;
    if (tar) tar.yaw = yawTo(tar.pos.x, tar.pos.z, sel.pos.x, sel.pos.z);
    tv?.play('attackLight1');
    fx(() => audio.play('swingHeavy', { pos: tar?.pos ?? sel.pos }));
    yield 0.45;
    faceOff(sel, tarrik);
    game.player.playScripted('attackLight3');
    glide(z, sel, z.m('dSelFeint'), 0.22);
    fx(() => audio.play('verityWhirl', { pos: sel.pos }));
    yield 0.24;
    tv?.play('guardHit');
    glide(z, tar, z.m('dTarGives'), 0.5);
    fx(() => {
      vfx.spawn('sparkHit', between(sel, tar, 1.3), { dir: { x: 0, y: 0.5, z: 1 } });
      audio.play('bladeHitMetal', { pos: sel.pos, pitch: 1.1 });
    });
    yield 0.6;
    faceOff(sel, tarrik);
    if (tar) c.twoShot(tar.pos, sel.pos, { side: -1, distance: 1.9, fov: 32 });
    yield* z.say('Tarrik', 'You see me.', { actor: tarrik });
    // “Selene offers no answer.”
    c.shot(sel.pos, { yawDeg: tar ? (yawBearing(sel.pos, tar.pos) + 25) : 0, distance: 1.9, height: 1.62, lookHeight: 1.58, fov: 30 });
    yield 1.5;

    // 4 — the floor strike: Cinder through the ancient stone; her read breaks into dozens of trajectories
    c.cut(flank(sel.pos, tar?.pos ?? sel.pos, 6.2, 1.2, 46, 0.6));
    tv?.play('raiseWeapon');
    const dodged = yield* duelPrompt(z, 'z05-dodge', 'Dodge', 'dodge', 2.4); // NEW (HUD prompt)
    tv?.play('floorStrike');
    yield 0.32;
    const strike = between(sel, tar, 0);
    if (tar) strike.lerp(tar.pos, 0.45).setY(tar.pos.y + 0.02);
    fx(() => {
      vfx.spawn('cinderSlam', strike, { scale: 1.25 });
      vfx.shockwave(strike, 7.5, CINDER, 0.7);
      for (let i = 0; i < 3; i++) vfx.spawn('stoneChip', strike, { dir: { x: (i - 1) * 0.4, y: 1, z: 0.2 }, color: 0xf3ead2, scale: 1.8 });
      vfx.spawn('debrisFall', strike.clone().setY(strike.y + 2.5), { duration: 0.8 });
      vfx.flash(strike.clone().setY(strike.y + 0.6), CINDER, 3.5, 0.3);
      audio.play('cinderSlam', { pos: strike });
      game.camera.shake(0.7, 0.45);
    });
    if (dodged) {
      game.player.playScripted('dodge', { faceTo: z.m('dSelDodged') });
      glide(z, sel, z.m('dSelDodged'), 0.42);
    } else {
      game.player.playScripted('knockdown');
      glide(z, sel, z.m('dSelDodged'), 0.5);
    }
    yield dodged ? 0.8 : 1.2;
    if (!dodged) game.player.playScripted('getUp');
    yield dodged ? 0.2 : 0.9;

    // 5 — the tether coils round his weapon arm; he grabs the line and pulls; she flies in, blades turning
    faceOff(sel, tarrik);
    c.cut(flank(sel.pos, tar?.pos ?? sel.pos, -5.6, 1.5, 40));
    game.player.playScripted('tetherStop');
    if (!z.skipping && sv && tv) S.tether = vfx.beam(sv.socket('handL'), tv.socket('handR'), 'tether');
    fx(() => {
      if (tv) vfx.spawn('frostArrest', tv.socket('handR').getWorldPosition(new THREE.Vector3()), { scale: 0.45 });
      audio.play('frostArrest', { pos: sel.pos, volume: 0.7 });
    });
    yield 0.9;
    tv?.play('counter');
    const struck = yield* duelPrompt(z, 'z05-strike', 'Strike', 'attack', 2.4); // NEW (HUD prompt)
    dropTether(0.15);
    game.player.playScripted(struck ? 'attackHeavy' : 'dodge', { faceTo: z.m('dSelFlown') });
    glide(z, sel, z.m('dSelFlown'), 0.32);
    fx(() => audio.play(struck ? 'verityWhirl' : 'dodge', { pos: sel.pos }));
    yield 0.34;
    // his free-hand blast breaks her directional shield; she lands hard and rolls
    tv?.play('shieldBash');
    fx(() => {
      const p = between(sel, tar, 1.25);
      if (struck) vfx.spawn('sparkHeavy', p, { dir: { x: 0, y: 1, z: 0 } });
      vfx.spawn('cinderBurst', p, { scale: 1.2 });
      vfx.spawn('shieldBreak', p, { color: FROST });
      vfx.flash(p, CINDER, 3, 0.25);
      audio.play('shieldBreak', { pos: p });
      audio.play('cinderIgnite', { pos: p });
      game.camera.shake(0.8, 0.5);
    });
    game.player.playScripted('knockdown');
    glide(z, sel, z.m('dSelThrown'), 0.55);
    c.cut(flank(z.m('dSelThrown'), z.m('dSelFlown'), 4.8, 0.9, 44, -1.5));
    yield 1.1;
    fx(() => audio.play('armorRattle', { pos: sel.pos }));
    game.player.playScripted('getUp');
    yield 0.9;

    // 6 — she locks ice round his lead boot; he walks out of it in steam; blades lock
    faceOff(sel, tarrik);
    fx(() => {
      if (tar) {
        vfx.spawn('frostArrest', tar.pos.clone().setY(tar.pos.y + 0.2), { scale: 0.6 });
        vfx.decal('frost', tar.pos, { size: 1.8, life: 30 });
      }
      audio.play('frostArrest', { pos: tar?.pos ?? sel.pos });
    });
    tv?.setFrozen(0.4);
    if (tar) c.shot(tar.pos, { yawDeg: yawBearing(tar.pos, sel.pos) + 40, distance: 3.0, height: 0.9, lookHeight: 0.5, fov: 36 });
    yield 1.1;
    tv?.setFrozen(0);
    fx(() => {
      if (tar) {
        vfx.spawn('dustPuff', tar.pos, { color: 0xe8f0ff, scale: 1.4 });
        vfx.spawn('cinderBurst', tar.pos.clone().setY(tar.pos.y + 0.2), { scale: 0.5 });
      }
      audio.play('ventHiss', { pos: tar?.pos ?? sel.pos });
    });
    walkTo(z, tarrik, 'dTarLock');
    game.player.playScripted('attackLight1', { faceTo: z.m('dTarLock') });
    glide(z, sel, z.m('dSelLock'), 0.9);
    yield 0.9;
    if (tarrik) tarrik.teleport(z.m('dTarLock'), z.myaw('dTarLock'));
    faceOff(sel, tarrik);
    tv?.play('parry');
    fx(() => {
      const p = between(sel, tar, 1.45);
      vfx.spawn('sparkHeavy', p, { dir: { x: 0, y: 1, z: 0 } });
      audio.play('bladeHitMetal', { pos: p, pitch: 0.9 });
      vfx.spawn('cinderEmbers', p, { duration: 9, scale: 0.7 });
    });
    tarrik?.play('guard', { loop: true });
    sv?.play('guard', { loop: true });
    yield 0.4;
    yield* conversation(z, c, [
      ['Tarrik', 'You brought an army to a prison.'],
      ['Selene', 'So did you.'],
      ['Tarrik', 'Your fleet fired first.'],
      ['Selene', 'After yours killed our drones.'],
      ['Tarrik', 'They crossed the perimeter.'],
      ['Selene', 'Your perimeter.'],
    ], { Tarrik: tarrik, Selene: sel }, { distance: 1.35, fov: 34 });
    // white crystal grows along Velkorran until Cinder burns it away. Neither yields.
    if (tar) c.cut(flank(sel.pos, tar.pos, 2.6, 1.5, 30));
    fx(() => {
      if (tv) {
        const blade = tv.socket('weaponMid').getWorldPosition(new THREE.Vector3());
        vfx.spawn('frostArrest', blade, { scale: 0.4 });
        audio.play('frostArrest', { pos: blade, volume: 0.5 });
      }
    });
    yield 1.2;
    fx(() => {
      if (tv) vfx.spawn('cinderBurst', tv.socket('weaponMid').getWorldPosition(new THREE.Vector3()), { scale: 0.55 });
      audio.play('cinderIgnite', { pos: tar?.pos ?? sel.pos, volume: 0.6 });
    });
    yield 1.4;

    // end state — identical watched or skipped (the blades stay locked: the carrier breaks it)
    dropTether();
    tv?.setFrozen(0);
    tv?.setTelegraph(0);
    place(z, sel, z.m('dSelLock'), z.myaw('dSelLock'));
    if (tarrik) tarrik.teleport(z.m('dTarLock'), z.myaw('dTarLock'));
    faceOff(sel, tarrik);
    for (const [k, key] of [[tharne, 'tharneFar'], [lyric, 'lyricFar']] as const) {
      if (!k) continue;
      if (!atPost(z, k, key, 1)) k.teleport(z.m(key), z.myaw(key));
      k.mode = 'hold';
      k.holdAt(z.m(key), z.myaw(key));
    }
    tharne?.play('holdConsole', { loop: true });
    z.setFlag('z05Duel', true);
  });
}

/** let go of the frost tether (cosmetic beam) */
function dropTether(fade = 0): void {
  const t = S.tether;
  S.tether = null;
  t?.remove(fade);
}

/** compass bearing (deg) from one world point to another */
function yawBearing(from: Vec3Like, to: Vec3Like): number {
  return (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
}
