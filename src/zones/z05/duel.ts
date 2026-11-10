/**
 * Z05 `meeting` → CP3: the walk in, the meeting (SCRIPT_SOURCE Z05 `meeting`, the author's lines exact) and the
 * duel — fierce, as in the book (author's ruling 7); only the kill is withheld, and that comes in `carrier`.
 * The duel is an authored scene with three familiar, forgiving prompts (deflect, dodge, strike); automatic
 * prompts complete them; a missed prompt changes one move of the choreography and nothing else. No health
 * bars, no victor, no squad fire. No blade reaches a body: what lands is force. Every state change is
 * unconditional; only VFX / audio wait on `!z.skipping`.
 */
import * as THREE from 'three';
import type { CineCtx, Companion, Routine, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { forwardX, forwardZ, rightX, rightZ } from '@/core/mathx';
import { CINDER, FROST, atPost, waitOr, walkTo } from '../shared';
import { SOLDIERS, burnBlade } from './cast';
import { CN, CX } from './layout';
import { bearingDeg, between, duelPrompt, exchange, faceOff, flank, say, selAct } from './stage';
import { S, glide, place } from './state';

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
  const P = (dx: number, dn: number, h = 0): THREE.Vector3 => z.P(CX + dx, CN + dn, h);
  yield* z.cinematic('z05-meeting', function* (c: CineCtx): Routine {
    const sel = game.player.actor;
    const tharne = z.cast('tharne');
    const lyric = z.cast('lyric');
    const tarrik = z.cast('tarrik');
    const lyessa = z.cast('lyessa');
    const soldiers = SOLDIERS.map((s) => z.cast(s));
    const squad: Array<[Companion | null, string]> = [[lyessa, 'lyessa'], ...soldiers.map((s, i): [Companion | null, string] => [s, SOLDIERS[i]])];
    const all: Array<[Companion | null, string]> = [[tarrik, 'tarrik'], ...squad];

    // Selene's people take their places (the first cut hides the step)
    place(z, sel, z.m('seleneStop'), z.myaw('seleneStop'));
    for (const k of [tharne, lyric]) if (k) k.mode = 'scripted';
    walkTo(z, tharne, 'tharneStop');
    walkTo(z, lyric, 'lyricStop');
    // the Dominion side comes in off the north bridge, Lyessa first, rifle raised
    for (const [k, key] of squad) {
      if (!k) continue;
      k.teleport(z.m(`${key}In`), z.myaw(`${key}In`));
      k.actor.visual?.setVisible(true);
      walkTo(z, k, `${key}Stop`, { run: true });
    }
    lyessa?.play('aimRifle', { loop: true });
    for (const s of soldiers) s?.play('aimRifle', { loop: true });

    // the whole room: from the battle in the ceiling down to the platform, small under it
    c.cut({ pos: P(-9, -22, 2.6), look: P(-4, 30, 70), fov: 56 });
    c.moveAsync({ pos: P(-9.5, -21, 2.2), look: P(-6, 34, 5), fov: 50 }, 3.6, 'inOut');
    // Caerion II warms under her armor before she sees him
    sel.visual?.setGlow(1.7);
    if (!z.skipping) game.audio.play('ambGoldPing', { pos: sel.pos, volume: 0.6 });
    yield 3.6;
    if (lyessa) c.shot(lyessa.actor.pos, { yawDeg: 210, distance: 4.4, height: 1.5, lookHeight: 1.45, fov: 34 });
    yield 2.2;
    // then Tarrik, with Velkorran burning in one hand
    if (tarrik) {
      tarrik.teleport(z.m('tarrikIn'), z.myaw('tarrikIn'));
      tarrik.actor.visual?.setVisible(true);
      walkTo(z, tarrik, 'tarrikStop');
      burnBlade(z, tarrik);
      c.cut({ pos: P(-11.4, 12.6, 1.25), look: P(-7.4, 18.8, 1.3), fov: 36 });
      c.moveAsync({ pos: P(-11.8, 11.6, 1.2), look: P(-9.6, 15.6, 1.35), fov: 36 }, 2.6, 'inOut');
    }
    yield 2.6;
    // the one flash, as Selene first sees him
    if (tarrik) c.twoShot(z.m('tarrikStop'), sel.pos, { side: 1, distance: 1.9, fov: 30 });
    if (!z.skipping) game.ui.card('DO NOT LET HIM KNEEL.', { style: 'flash' });
    yield waitOr(z, () => z.skipping || all.every(([k, key]) => atPost(z, k, `${key}Stop`, 1)), 3.2);
    for (const [k, key] of [...all, [tharne, 'tharne'], [lyric, 'lyric']] as Array<[Companion | null, string]>) {
      if (k && !atPost(z, k, `${key}Stop`, 1)) k.teleport(z.m(`${key}Stop`), z.myaw(`${key}Stop`));
    }
    // “For several seconds, no one moves.”
    c.cut({ pos: P(-35, -2.5, 2.3), look: P(-14, 0, 1.3), fov: 50 });
    c.moveAsync({ pos: P(-34, -2, 2.2), look: P(-14, 0, 1.3), fov: 47 }, 3.4, 'inOut');
    yield 3.2;

    // the leaders close to ≈ 10 m
    walkTo(z, tarrik, 'tarrikMeet');
    place(z, sel, z.m('seleneMeet'), z.myaw('seleneMeet'));
    c.cut(flank(z.m('tarrikStop'), z.m('seleneMeet'), 5.5, 1.5, 38));
    yield waitOr(z, () => z.skipping || atPost(z, tarrik, 'tarrikMeet', 0.5), 3.5);
    if (tarrik) {
      tarrik.teleport(z.m('tarrikMeet'), z.myaw('tarrikMeet'));
      faceOff(sel, tarrik);
      tarrik.play('guard', { loop: true });
    }
    sel.visual?.setGlow(1);

    const leads = { Tarrik: tarrik, Selene: sel };
    yield* exchange(z, c, [['Tarrik', 'Veyne.'], ['Selene', 'Walcur.']], leads, { distance: 2.2, fov: 32 });
    // he gives the order without looking back
    if (tarrik) c.shot(tarrik.actor.pos, { yawDeg: bearingDeg(tarrik.actor.pos, sel.pos), distance: 2.6, height: 1.6, fov: 38 });
    yield* say(z, 'Tarrik', 'Hold fire.', tarrik);
    for (const s of soldiers) {
      s?.stopAction();
      s?.play('lowerWeapon');
    }
    // she gives the same order with a hand signal: an open hand, held low, to the people behind her
    c.shot(sel.pos, { yawDeg: bearingDeg(sel.pos, z.m('tharneStop')) + 40, distance: 3.0, height: 1.25, lookHeight: 1.1, fov: 40 });
    const sv = sel.visual;
    if (isHumanoidVisual(sv)) {
      sv.setHandTarget('L', {
        x: sel.pos.x - rightX(sel.yaw) * 0.38 - forwardX(sel.yaw) * 0.42, y: sel.pos.y + 0.82,
        z: sel.pos.z - rightZ(sel.yaw) * 0.38 - forwardZ(sel.yaw) * 0.42,
      }, 1);
    }
    yield 1.8;
    if (isHumanoidVisual(sv)) sv.setHandTarget('L', null);
    tharne?.play('nod');

    yield* exchange(z, c, [
      ['Tarrik', 'Get away from the terminal.'],
      ['Selene', 'I was about to tell you the same thing.'],
    ], leads, { distance: 2.2, fov: 32 });
    // Lyessa raises her rifle another centimeter
    if (lyessa) {
      const at = lyessa.actor.pos;
      const b = bearingDeg(at, sel.pos) + 12;
      c.shot(at, { yawDeg: b, distance: 2.5, height: 1.62, lookHeight: 1.55, fov: 30 });
      c.moveAsync({ ...poseNear(at, b, 2.0) }, 1.6, 'inOut');
    }
    yield 1.6;
    // Lyric steps out from behind Selene, violet lines now reaching her cheekbones
    walkTo(z, lyric, 'lyricOut');
    lyric?.actor.visual?.setCorruption(0.28);
    c.shot(z.m('lyricOut'), { yawDeg: 15, distance: 2.0, height: 1.6, lookHeight: 1.58, fov: 30 });
    yield waitOr(z, () => z.skipping || atPost(z, lyric, 'lyricOut', 0.6), 3);
    if (lyric && tarrik) lyric.face(tarrik.actor.pos.clone());
    yield* say(z, 'Lyric', 'Your girlfriend points weapons when she gets nervous.', lyric);
    // “Lyessa’s expression turns murderous.”
    if (lyessa) c.shot(lyessa.actor.pos, { yawDeg: bearingDeg(lyessa.actor.pos, sel.pos) + 8, distance: 1.7, height: 1.64, lookHeight: 1.6, fov: 28 });
    yield 1.5;
    yield* exchange(z, c, [
      ['Tarrik', 'Not now.'],
      ['Selene', 'Agreed. Nobody goes below.'],
      ['Tarrik', 'My team does.'],
      ['Selene', 'Then we do not agree.'],
    ], leads, { distance: 2.0, fov: 32 });

    // end state — identical watched or skipped
    for (const [k, key] of all) {
      k?.actor.visual?.setVisible(true);
      if (key !== 'tarrik') k?.teleport(z.m(`${key}Stop`), z.myaw(`${key}Stop`));
    }
    if (tharne) tharne.teleport(z.m('tharneStop'), z.myaw('tharneStop'));
    if (lyric) lyric.teleport(z.m('lyricOut'), z.myaw('lyricOut'));
    if (tarrik) tarrik.teleport(z.m('tarrikMeet'), z.myaw('tarrikMeet'));
    place(z, sel, z.m('seleneMeet'), z.myaw('seleneMeet'));
    faceOff(sel, tarrik);
    for (const s of soldiers) s?.stopAction();
    if (isHumanoidVisual(sv)) sv.setHandTarget('L', null);
    sel.visual?.setGlow(1);
    z.setFlag('z05Met', true);
  });
}

/** a camera pose `distance` m from a subject on a compass bearing, at head height */
function poseNear(at: THREE.Vector3, bearing: number, distance: number): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  const a = (bearing * Math.PI) / 180;
  return { pos: new THREE.Vector3(at.x + Math.sin(a) * distance, at.y + 1.62, at.z - Math.cos(a) * distance), look: at.clone().setY(at.y + 1.55), fov: 28 };
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
    const tAct = (action: string): void => {
      tv?.stop();
      tv?.play(action);
    };
    const tPos = (): THREE.Vector3 => (tar ? tar.pos : sel.pos);
    audio.setMusic('duel', 0.5);
    // the others give the leaders room: Tharne goes to his viewmaker across the chamber, Lyric with him
    const tharne = z.cast('tharne');
    const lyric = z.cast('lyric');
    walkTo(z, tharne, 'tharneFar', { run: true });
    walkTo(z, lyric, 'lyricFar');

    // (dir) “Tarrik advances toward the shaft. Selene moves to block him.”
    tarrik?.stopAction();
    tarrik?.face(null);
    walkTo(z, tarrik, 'dTarAdvance');
    c.cut(flank(z.m('tarrikMeet'), z.m('dSelBlock'), 7.5, 1.7, 46));
    yield 0.9;
    fx(() => audio.play('dodge', { pos: sel.pos }));
    selAct(z, 'dodge', z.m('dSelBlock'));
    glide(z, sel, z.m('dSelBlock'), 0.45);
    yield 0.75;
    if (tarrik) tarrik.teleport(z.m('dTarAdvance'), z.myaw('dTarAdvance'));
    faceOff(sel, tarrik);

    // 1 — he opens with a burst of speed; her read arrives first (prompt 1: deflect)
    c.cut(flank(sel.pos, tPos(), 4.4, 1.45, 38, -0.6));
    tAct('attackHeavyCharge');
    fx(() => tv?.setTelegraph(1, FROST));
    const read = yield* duelPrompt(z, 'z05-deflect', 'Deflect', 'guard', 2.4); // NEW (HUD prompt)
    tv?.setTelegraph(0);
    tv?.play('attackHeavy');
    glide(z, tar, z.m('dTarLunge'), 0.24);
    fx(() => audio.play('swingHeavy', { pos: sel.pos }));
    yield 0.2;
    if (read) {
      // she turns the air between them white; his momentum bleeds away for less than half a second
      selAct(z, 'deflect');
      fx(() => {
        const p = between(sel, tar);
        vfx.spawn('deflect', p, { dir: { x: 0, y: 0, z: 1 } });
        vfx.spawn('frostBurst', p, { scale: 1.3 });
        audio.play('deflect', { pos: p });
        game.time.slowMo(0.3, 0.45);
      });
      tv?.play('guardHit');
    } else {
      selAct(z, 'guardHit');
      glide(z, sel, z.m('dSelShoved'), 0.3);
      fx(() => {
        vfx.spawn('sparkHeavy', between(sel, tar), { dir: { x: 0, y: 0.3, z: 1 } });
        audio.play('guardBlock', { pos: sel.pos });
        game.camera.shake(0.35, 0.3);
      });
    }
    yield 0.7;

    // 2 — her rear blade goes for his throat; Velkorran catches it; heat and frost strip ice from the floor
    c.cut(flank(sel.pos, tPos(), 3.6, 1.35, 36, 0.4));
    faceOff(sel, tarrik);
    selAct(z, 'attackLight2');
    glide(z, sel, z.m('dSelStrike'), 0.22);
    fx(() => audio.play('verityWhirl', { pos: sel.pos }));
    yield 0.26;
    tAct('parry');
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
    c.cut(flank(z.m('dSelLanes'), z.m('dTarGives'), 5.6, 1.6, 42));
    selAct(z, 'dodge', z.m('dSelLanes'));
    glide(z, sel, z.m('dSelLanes'), 0.4);
    fx(() => audio.play('dodge', { pos: sel.pos }));
    yield 0.25;
    if (tar) tar.yaw = Math.atan2(-(sel.pos.x - tar.pos.x), -(sel.pos.z - tar.pos.z));
    tAct('attackLight1');
    fx(() => audio.play('swingHeavy', { pos: tPos() }));
    yield 0.45;
    faceOff(sel, tarrik);
    selAct(z, 'attackLight3');
    glide(z, sel, z.m('dSelFeint'), 0.22);
    fx(() => audio.play('verityWhirl', { pos: sel.pos }));
    yield 0.24;
    tAct('guardHit');
    glide(z, tar, z.m('dTarGives'), 0.5);
    fx(() => {
      vfx.spawn('sparkHit', between(sel, tar, 1.3), { dir: { x: 0, y: 0.5, z: 1 } });
      audio.play('bladeHitMetal', { pos: sel.pos, pitch: 1.1 });
    });
    yield 0.6;
    faceOff(sel, tarrik);
    tarrik?.play('guard', { loop: true });
    c.twoShot(tPos(), sel.pos, { side: -1, distance: 1.9, fov: 32 });
    yield* say(z, 'Tarrik', 'You see me.', tarrik);
    // “Selene offers no answer.”
    c.shot(sel.pos, { yawDeg: bearingDeg(sel.pos, tPos()) + 25, distance: 1.9, height: 1.62, lookHeight: 1.58, fov: 30 });
    yield 1.5;

    // 4 — the floor strike: Cinder through the ancient stone; her read breaks into dozens of trajectories
    c.cut(flank(sel.pos, tPos(), 6.4, 1.2, 46, 0.6));
    tAct('raiseWeapon');
    const dodged = yield* duelPrompt(z, 'z05-dodge', 'Dodge', 'dodge', 2.4); // NEW (HUD prompt)
    tAct('floorStrike');
    yield 0.32;
    const strike = between(sel, tar, 0).lerp(tPos(), 0.45).setY(tPos().y + 0.02);
    fx(() => {
      vfx.spawn('cinderSlam', strike, { scale: 1.25 });
      vfx.shockwave(strike, 7.5, CINDER, 0.7);
      for (let i = 0; i < 3; i++) vfx.spawn('stoneChip', strike, { dir: { x: (i - 1) * 0.4, y: 1, z: 0.2 }, color: 0xf3ead2, scale: 1.8 });
      vfx.spawn('debrisFall', strike.clone().setY(strike.y + 2.5), { duration: 0.8 });
      vfx.flash(strike.clone().setY(strike.y + 0.6), CINDER, 3.5, 0.3);
      audio.play('cinderSlam', { pos: strike });
      game.camera.shake(0.7, 0.45);
    });
    selAct(z, dodged ? 'dodge' : 'knockdown', z.m('dSelDodged'));
    glide(z, sel, z.m('dSelDodged'), dodged ? 0.42 : 0.5);
    yield dodged ? 0.8 : 1.2;
    if (!dodged) selAct(z, 'getUp');
    yield dodged ? 0.2 : 1.0;

    // 5 — the tether coils round his weapon arm; he grabs the line and pulls; she flies in, blades turning
    faceOff(sel, tarrik);
    c.cut(flank(sel.pos, tPos(), 5.8, 1.5, 40));
    selAct(z, 'tetherStop');
    if (!z.skipping && sv && tv) S.tether = vfx.beam(sv.socket('handL'), tv.socket('handR'), 'tether');
    fx(() => {
      if (tv) vfx.spawn('frostArrest', tv.socket('handR').getWorldPosition(new THREE.Vector3()), { scale: 0.45 });
      audio.play('frostArrest', { pos: sel.pos, volume: 0.7 });
    });
    yield 0.9;
    tAct('counter');
    const struck = yield* duelPrompt(z, 'z05-strike', 'Strike', 'attack', 2.4); // NEW (HUD prompt)
    dropTether(0.15);
    selAct(z, struck ? 'attackHeavy' : 'dodge', z.m('dSelFlown'));
    glide(z, sel, z.m('dSelFlown'), 0.32);
    fx(() => audio.play(struck ? 'verityWhirl' : 'dodge', { pos: sel.pos }));
    yield 0.34;
    // his free-hand blast breaks her directional shield; she lands hard and rolls
    tAct('shieldBash');
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
    selAct(z, 'knockdown');
    glide(z, sel, z.m('dSelThrown'), 0.55);
    c.cut(flank(z.m('dSelThrown'), z.m('dSelFlown'), 4.8, 0.9, 44, -1.5));
    yield 1.1;
    fx(() => audio.play('armorRattle', { pos: sel.pos }));
    selAct(z, 'getUp');
    yield 1.1;

    // 6 — she locks ice round his lead boot; he walks out of it in steam; the blades lock
    faceOff(sel, tarrik);
    tarrik?.play('guard', { loop: true });
    fx(() => {
      if (tar) {
        vfx.spawn('frostArrest', tar.pos.clone().setY(tar.pos.y + 0.2), { scale: 0.6 });
        vfx.decal('frost', tar.pos, { size: 1.8, life: 30 });
      }
      audio.play('frostArrest', { pos: tPos() });
    });
    tv?.setFrozen(0.22);
    c.shot(tPos(), { yawDeg: bearingDeg(S.centre, tPos()) + 25, distance: 3.0, height: 0.9, lookHeight: 0.5, fov: 36 });
    yield 1.1;
    tv?.setFrozen(0);
    fx(() => {
      vfx.spawn('dustPuff', tPos(), { color: 0xe8f0ff, scale: 1.4 });
      vfx.spawn('cinderBurst', tPos().clone().setY(tPos().y + 0.2), { scale: 0.5 });
      audio.play('ventHiss', { pos: tPos() });
    });
    walkTo(z, tarrik, 'dTarLock');
    selAct(z, 'attackLight1', z.m('dTarLock'));
    glide(z, sel, z.m('dSelLock'), 0.9);
    yield 0.9;
    if (tarrik) tarrik.teleport(z.m('dTarLock'), z.myaw('dTarLock'));
    faceOff(sel, tarrik);
    tAct('parry');
    fx(() => {
      const p = between(sel, tar, 1.45);
      vfx.spawn('sparkHeavy', p, { dir: { x: 0, y: 1, z: 0 } });
      audio.play('bladeHitMetal', { pos: p, pitch: 0.9 });
      vfx.spawn('cinderEmbers', p, { duration: 9, scale: 0.7 });
    });
    yield 0.35;
    tarrik?.play('guard', { loop: true });
    sv?.stop();
    sv?.play('guard', { loop: true });
    yield* exchange(z, c, [
      ['Tarrik', 'You brought an army to a prison.'],
      ['Selene', 'So did you.'],
      ['Tarrik', 'Your fleet fired first.'],
      ['Selene', 'After yours killed our drones.'],
      ['Tarrik', 'They crossed the perimeter.'],
      ['Selene', 'Your perimeter.'],
    ], { Tarrik: tarrik, Selene: sel }, { distance: 1.4, fov: 34 });
    // white crystal grows along Velkorran until Cinder burns it away. Neither yields.
    c.cut(flank(sel.pos, tPos(), 2.6, 1.5, 30));
    fx(() => {
      if (!tv) return;
      const blade = tv.socket('weaponMid').getWorldPosition(new THREE.Vector3());
      vfx.spawn('frostArrest', blade, { scale: 0.4 });
      audio.play('frostArrest', { pos: blade, volume: 0.5 });
    });
    yield 1.2;
    fx(() => {
      if (tv) vfx.spawn('cinderBurst', tv.socket('weaponMid').getWorldPosition(new THREE.Vector3()), { scale: 0.55 });
      audio.play('cinderIgnite', { pos: tPos(), volume: 0.6 });
    });
    yield 1.4;

    // end state — identical watched or skipped (the blades stay locked: the carrier breaks it)
    dropTether();
    tv?.setFrozen(0);
    tv?.setTelegraph(0);
    place(z, sel, z.m('dSelLock'), z.myaw('dSelLock'));
    if (tarrik) tarrik.teleport(z.m('dTarLock'), z.myaw('dTarLock'));
    faceOff(sel, tarrik);
    sv?.stop();
    sv?.play('guard', { loop: true });
    tarrik?.play('guard', { loop: true });
    for (const [k, key] of [[tharne, 'tharneFar'], [lyric, 'lyricFar']] as const) {
      if (!k) continue;
      k.teleport(z.m(key), z.myaw(key));
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
