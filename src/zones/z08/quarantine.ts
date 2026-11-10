/**
 * Z08 `quarantine` (SCRIPT_SOURCE Z08 `quarantine`, ≈ 1 min) — the fighting ends here. The survivors clear the
 * court through the south entry (the chosen group first, both seen to leave alive), the officer is acknowledged
 * once, then the terminal itself separates them: white-gold isolation barriers rise along lines of pale light —
 * Lyessa (with the two squad soldiers) on the west side, Tharne and Lyric beyond the south one, another closes
 * beyond them — and only the two bearers keep the descending corridor.
 *
 * Every line below is the author's except the survivor exit lines and the medic's line, tagged `// NEW`.
 */
import * as THREE from 'three';
import type { CineCtx, Companion, Routine, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { FROST, atPost, setDoor, waitOr, walkTo } from '../shared';
import { officerOntoLitter } from './finish';
import { BARRIER_E_X, BARRIER_S_N, BARRIER_W_X } from './layout';
import { exitPlan, litter, sendOut, survivorsGone, throughDoor } from './people';
import { S } from './state';

const _v = new THREE.Vector3();

/** the whole quarantine scene; leaves the world identical watched or skipped */
export function* quarantineScene(z: ZoneRuntime, west: boolean, fate: 'killed' | 'spared'): Routine {
  const game = z.game;
  yield* z.cinematic('z08-quarantine', function* (c: CineCtx): Routine {
    const lyessa = z.cast('lyessa');
    const selene = z.cast('selene');
    const s1 = z.cast('soldier1');
    const s2 = z.cast('soldier2');
    const lyric = z.cast('lyric');
    const spared = fate === 'spared';

    // --- 1. the court clears through the south entry: the chosen group first ---------------------------------
    if (S.entry) {
      S.entry.setState('open');
      z.openDoor(S.entry, true);
    }
    const plan = exitPlan(west, spared);
    // Lyessa and the squad pair fall back west of the court, covering the exit
    walkTo(z, lyessa, 'lyessaQ');
    walkTo(z, s1, 'soldierQ1');
    walkTo(z, s2, 'soldierQ2');
    if (spared) {
      // the medic who takes him is already with him, the litter beside
      const mb = z.cast('medicB');
      mb?.stopAction();
      mb?.teleport(z.m('litterO2'), z.myaw('litterO2'));
      mb?.play('kneelTend', { loop: true });
    }
    c.cut({ pos: z.P(30.5, 21.5, 2.1), look: west ? z.P(10, 36, 1.2) : z.P(62, 36, 1.2), fov: 42 });
    sendOut(z, plan.first);
    if (west) yield* z.say('Medic', 'Stretchers first. One. Two. Keep moving.', { actor: z.cast('medicA') }); // NEW
    else yield* z.say('Survivor', 'Walkers out first. Go, go.', { actor: z.cast('walker1') }); // NEW
    yield 1.2;
    sendOut(z, plan.second);
    if (west) yield* z.say('Survivor', 'Walking wounded, with me. Stay close.', { actor: z.cast('walker1') }); // NEW
    else yield* z.say('Survivor', 'Last stretcher’s mine. I’ve got it.', { actor: z.cast('walker2') }); // NEW

    // --- 2. the officer: one acknowledgement, before the barriers ignite -------------------------------------
    const fell = z.m('officerFell');
    if (!spared) {
      // one of the two Dominion soldiers stops where the officer fell — fist to the breastplate
      walkTo(z, s1, 'officerSalute');
      c.cut({ pos: z.P(33.2, 17.4, 1.6), look: _v.copy(fell).setY(0.9), fov: 40 });
      yield waitOr(z, () => atPost(z, s1, 'officerSalute'), 6);
      s1?.face(fell);
      s1?.play('salute');
      c.shot(z.m('officerSalute'), { yawDeg: 160, distance: 2.6, height: 1.5, lookHeight: 1.45, fov: 36 });
      yield 0.6;
      yield* z.say('Soldier', 'Glory.', { actor: s1 });
      yield 1.2;
      walkTo(z, s1, 'soldierQ1');
    } else {
      // the medics lift him, frost and all, and go out with the stretcher cases
      const mb = z.cast('medicB');
      const lo = litter('O');
      if (lo) {
        lo.group.visible = true;
        lo.group.position.copy(fell).add(_v.set(0.2, 0, 1.1));
        lo.group.rotation.y = z.myaw('officerFell') + Math.PI / 2;
        officerOntoLitter(lo.group);
      }
      mb?.stopAction();
      c.shot(z.m('litterO2'), { yawDeg: 200, distance: 3, height: 1.4, lookHeight: 1.1, fov: 38 });
      yield 0.8;
      yield* z.say('Medic', 'Still breathing. We carry him as he is.', { actor: mb }); // NEW
      sendOut(z, [['medicB', 'O']]);
      yield 1.4;
    }
    yield waitOr(z, () => throughDoor(z, ['medicA', 'medicB', 'walker1', 'walker2']), 6);
    // end of the clearing: everyone is out of the court and the entry is shut behind them
    survivorsGone(z);
    if (S.entry) {
      setDoor(S.entry, false, 'sealed');
    }

    // --- 3. “White-gold barriers ignite through the corridors as ancient containment systems wake …” ----------
    game.audio.setMusic('quarantine', 1.5);
    game.player.teleport(z.m('tarrikQ'), z.myaw('tarrikQ'));
    selene?.stopAction();
    walkTo(z, selene, 'seleneQ');
    walkTo(z, lyessa, 'lyessaQ');
    walkTo(z, s1, 'soldierQ1');
    walkTo(z, s2, 'soldierQ2');
    if (z.skipping) {
      for (const [who, at] of [[lyessa, 'lyessaQ'], [s1, 'soldierQ1'], [s2, 'soldierQ2'], [selene, 'seleneQ']] as const) who?.teleport(z.m(at), z.myaw(at));
    }
    c.cut({ pos: z.P(44, 40, 9), look: z.P(26, 16, 0), fov: 52 });
    for (const o of S.seams) o.visible = true;
    if (!z.skipping) {
      game.audio.play('structuralGroan');
      for (const n of [16, 30, 42]) game.vfx.spawn('goldRecognition', z.P(BARRIER_W_X, n, 0.05));
    }
    yield 2.4;
    // TARRIK to Lyessa, across the line of light
    const tq = z.m('tarrikQ');
    const lq = lyessa ? lyessa.actor.pos.clone() : z.m('lyessaQ');
    c.twoShot(lq, tq, { side: 1, distance: 2.1, fov: 38 });
    yield* z.say('Tarrik', 'Move.', { actor: game.player.actor });
    // “The floor separates between them, not cracking but dividing along a line of pale light.”
    walkTo(z, lyessa, 'lyessaJump', { run: true });
    yield 0.5;
    S.barrierW?.setActive(true, { instant: z.skipping });
    if (!z.skipping) {
      game.vfx.spawn('quarantineSeal', z.P(BARRIER_W_X, 23, 0), { dir: { x: 1, y: 0, z: 0 } });
      game.audio.play('quarantineSeal', { pos: z.P(BARRIER_W_X, 23, 2) });
    }
    // “Lyessa jumps too late. The wall seals between them.”
    c.cut({ pos: z.P(28.6, 21.4, 1.7), look: z.P(BARRIER_W_X - 1, 23.2, 1.4), fov: 40 });
    yield 1.0;
    yield* z.say('Lyessa', 'Tarrik.', { actor: lyessa, offscreen: true });
    // running at the wall “as the material turns opaque.” — “No answer reaches him.”
    game.player.teleport(z.m('tarrikWall'), z.myaw('tarrikWall'));
    c.shot(z.m('tarrikWall'), { yawDeg: 120, distance: 2.6, height: 1.6, lookHeight: 1.6, fov: 38 });
    yield 0.4;
    yield* z.say('Tarrik', 'Lyessa.', { actor: game.player.actor });
    yield 1.4;

    // --- 4. “another barrier drops between Selene and Tharne. Lyric is on the wrong side with him.” -----------
    walkTo(z, selene, 'seleneWall', { run: true });
    S.barrierS?.setActive(true, { instant: z.skipping });
    if (!z.skipping) game.vfx.spawn('quarantineSeal', z.P(35, BARRIER_S_N, 0), { dir: { x: 0, y: 0, z: 1 } });
    lyric?.play('distress', { loop: true });
    c.cut({ pos: z.P(38.6, 14.2, 1.8), look: z.P(33, 7.4, 1.2), fov: 44 });
    yield waitOr(z, () => atPost(z, selene, 'seleneWall'), 3);
    // Selene strikes it: “Frost spreads across the white-gold surface without leaving a mark.”
    selene?.face(z.P(34.2, BARRIER_S_N - 1));
    selene?.play('attackLight1');
    yield 0.3;
    if (!z.skipping) {
      game.vfx.spawn('frostBurst', z.P(34.2, BARRIER_S_N + 0.15, 1.3), { dir: { x: 0, y: 0, z: 1 }, color: FROST });
      game.audio.play('frostShatter', { pos: z.P(34.2, BARRIER_S_N, 1.3) });
    }
    yield 0.9;
    const sp = selene ? selene.actor.pos.clone() : z.m('seleneWall');
    c.shot(sp, { yawDeg: 20, distance: 2.4, height: 1.55, lookHeight: 1.55, fov: 38 });
    yield* z.say('Selene', 'Tharne.', { actor: selene });
    yield* z.say('Tharne', 'We’re here.', { offscreen: true, channel: 'radio' });
    yield* z.say('Selene', 'Her condition?', { actor: selene });
    yield* z.say('Tharne', 'Worse.', { offscreen: true, channel: 'radio' });
    yield* z.say('Selene', 'Get her away from the lower conduits.', { actor: selene });
    yield* z.say('Tharne', 'I’m trying.', { offscreen: true, channel: 'radio' });
    // “Another barrier closes somewhere beyond them, and the signal dies.”
    S.barrierE?.setActive(true, { instant: z.skipping });
    if (!z.skipping) game.audio.play('barrierUp', { pos: z.P(BARRIER_E_X, 12, 2), volume: 0.6 });
    yield 1.4;

    // --- 5. “Only one corridor remains open, descending between walls pulsing with white-gold light.” ----------
    if (S.exit) {
      S.exit.setState('open');
      z.openDoor(S.exit, true);
    }
    game.player.teleport(z.m('tarrikGo'), z.myaw('tarrikGo'));
    selene?.teleport(z.m('seleneGo'), z.myaw('seleneGo'));
    selene?.face(z.m('tarrikGo'));
    game.player.actor.face(z.m('seleneGo'));
    c.cut({ pos: z.P(35.2, 31.6, 1.7), look: z.P(35, 44, 2.2), fov: 44 });
    yield 1.6;
    const lines: Array<[string, string]> = [
      ['Tarrik', 'I’m not letting your fleet take it.'],
      ['Selene', 'I’m not letting yours take it.'],
      ['Tarrik', 'Good.'],
    ];
    yield* pair(z, c, lines, selene);
    // “The Cinder along Velkorran extinguishes.” She collapses the twin blades to the central staff.
    game.player.actor.visual?.setGlow(0.1);
    const sv = selene?.actor.visual;
    if (isHumanoidVisual(sv)) sv.setLoadout({ melee: false });
    yield 1.0;
    yield* pair(z, c, [
      ['Tarrik', 'We go.'],
      ['Selene', 'Together?'],
      ['Tarrik', 'At the same time.'],
      ['Selene', 'Acceptable.'],
    ], selene);
    yield 0.8;
    // end state — identical watched or skipped
    for (const bar of [S.barrierW, S.barrierS, S.barrierE]) bar?.setActive(true, { instant: true });
    for (const o of S.seams) o.visible = true;
    survivorsGone(z);
    if (S.exit) S.exit.setState('open');
    z.story('quarantineSeparated');
  });
  const selene = z.cast('selene');
  if (selene) selene.mode = 'follow';
}

/** the two leads' exchange: alternating over-the-shoulder shots, Tarrik as the player's body */
function* pair(z: ZoneRuntime, c: CineCtx, lines: Array<[string, string]>, selene: Companion | null): Routine {
  const tp = z.game.player.actor.pos.clone();
  const sp = selene ? selene.actor.pos.clone() : z.m('seleneGo');
  let prev = '';
  for (const [who, text] of lines) {
    if (who !== prev) {
      if (who === 'Tarrik') c.twoShot(tp, sp, { side: -1, distance: 1.8, fov: 36 });
      else c.twoShot(sp, tp, { side: 1, distance: 1.8, fov: 36 });
      prev = who;
    }
    yield* z.say(who, text, { actor: who === 'Tarrik' ? z.game.player.actor : selene });
  }
}

/** the last steps: into the corridor; the ancient barrier closes behind them and the sound of war vanishes */
export function* descend(z: ZoneRuntime): Routine {
  const game = z.game;
  z.objective('Take the descending corridor', 'exit'); // NEW
  yield z.untilNear('exit', 2.4);
  z.objective(null);
  S.barrierExit?.setActive(true);
  game.audio.setMuffle(1, 0.25);
  game.audio.play('quarantineSeal', { pos: z.m('exit') });
  z.onDispose(() => game.audio.setMuffle(0, 1.5));
  yield 1.4;
  yield* z.exit('Z09', { fade: 'black', seconds: 1.8 });
}
