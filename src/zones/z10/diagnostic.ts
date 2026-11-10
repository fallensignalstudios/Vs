/**
 * Z10 `diagnostic` — the arrival and the diagnostic argument (SCRIPT_SOURCE Z10 `diagnostic`, CORE lines only;
 * *(ext — trimmed)* lines are not played and nothing bridges them).
 *
 * Must make three facts clear without optional inspection: four active references are unbalanced; doing nothing
 * lets the boundary fail; completion stabilises it AND enables the authority that could open the prison. And the
 * book's two pressures: Cross orders completion and Tarrik refuses him; Lyric begs Selene not to leave it like this.
 * Terminal text is on the status board (text only); the forecast is a readout, never a timer. Selene works the
 * console; Tarrik paces the ring; Cross is a voice and is never shown.
 */
import * as THREE from 'three';
import type { BeamHandle, CineCtx, Routine, SayOpts, ZoneRuntime } from '@/core/api';
import { atPost, waitOr, walkTo } from '../shared';
import { C, DAIS_H, S, show, snapProps, terminal } from './state';

const RADIO: SayOpts = { offscreen: true, channel: 'radio' };

/** Tarrik (the lead) stands at a marker for the next shot — he paces the ring between cuts */
function place(z: ZoneRuntime, marker: string, face?: THREE.Vector3): THREE.Vector3 {
  z.game.player.teleport(z.m(marker), z.myaw(marker));
  if (face) z.game.player.playScripted('idle', { faceTo: face });
  return z.player.pos.clone();
}

/** “That’s it.” / “Yes.” — the chamber, the rings, the human-sized relic at the centre */
export function* arrivalScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const selene = z.cast('selene');
  yield* z.cinematic('z10-arrival', function* (c: CineCtx): Routine {
    walkTo(z, selene, 'seleneArrive');
    game.player.teleport(z.m('start'), z.myaw('start'));
    // out of the walkway: the whole volume, the rings turning over the dais, two small figures
    c.cut({ pos: z.P(C.x + 3.2, 4.8, 2.6), look: z.P(C.x, C.n, 9), fov: 62 });
    c.moveAsync({ pos: z.P(C.x + 2.2, 7.5, 2.2), look: z.P(C.x, C.n, 11), fov: 58 }, 9, 'inOut');
    if (!z.skipping) game.audio.play('meridianAlign', { volume: 0.5 });
    yield 3.4;
    // “Everything focuses on one human-sized object: five points of black-gold metal surrounding a white core.”
    c.cut({ pos: z.P(C.x - 1.4, C.n - 9.5, 1.5), look: z.P(C.x, C.n, 1.7), fov: 34 });
    c.moveAsync({ pos: z.P(C.x - 0.9, C.n - 8.0, 1.55), look: z.P(C.x, C.n, 1.75), fov: 32 }, 5, 'inOut');
    yield 2.6;
    game.player.teleport(z.m('arrive'), z.myaw('arrive'));
    if (selene && z.skipping) selene.teleport(z.m('seleneArrive'), z.myaw('seleneArrive'));
    yield waitOr(z, () => z.skipping || atPost(z, selene, 'seleneArrive'), 4);
    const s = selene ? selene.actor.pos.clone() : z.m('seleneArrive');
    c.twoShot(s, z.player.pos, { side: 1, distance: 2.1, fov: 38 });
    yield* z.say('Selene', 'That’s it.', { actor: selene });
    c.twoShot(z.player.pos, s, { side: -1, distance: 2.1, fov: 38 });
    yield* z.say('Tarrik', 'Yes.', { actor: z.player });
    if (selene) selene.mode = 'follow';
  });
}

/** “A line of white-gold light extends toward Tarrik.” — it grows from the Crownmark's core to his chest */
function* lineToTarrik(z: ZoneRuntime, beams: BeamHandle[]): Routine {
  const core = S.crownmark?.socket('core');
  const from = core ? core.getWorldPosition(new THREE.Vector3()) : z.P(C.x, C.n, DAIS_H + 1.6);
  const t = z.player.pos.clone().setY(z.player.pos.y + 1.35);
  const beam = z.game.vfx.beam(from, from.clone().lerp(t, 0.02), 'gold', { width: 0.06 });
  beams.push(beam);
  for (let k = 0.05; k <= 1.001; k += 0.05) {
    beam.setEnds(from, from.clone().lerp(t, k * 0.93));
    yield 0.05;
  }
}

/** the argument. Selene at the console, Tarrik on the ring; terminal text under the lines. */
export function* diagnosticScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const ui = game.ui;
  const selene = z.cast('selene');
  const beams: BeamHandle[] = [];
  yield* z.cinematic('z10-diagnostic', function* (c: CineCtx): Routine {
    if (selene) {
      selene.stopAction();
      selene.mode = 'scripted';
      selene.teleport(z.m('seleneConsole'), z.myaw('seleneConsole'));
      selene.play('holdConsole');
    }
    let t = place(z, 'tarrikDais', z.P(C.x, C.n, 1.5));
    const s = (): THREE.Vector3 => (selene ? selene.actor.pos.clone() : z.m('seleneConsole'));
    if (S.diag) S.diag.params.visible = 1;

    // the terminal wakes: four of five
    c.cut({ pos: z.P(C.x - 2.8, C.n - 11.2, 2.3), look: z.P(C.x, C.n - 2, 1.6), fov: 44 });
    terminal(z, ['MERIDIAN CONTINUITY: 4 / 5', 'TERMINAL WITNESS: SEALED'], true);
    yield 3.4;
    // “A line of white-gold light extends toward Tarrik.” … “A second line reaches Selene. The two paths advance
    // toward one another but stop before touching.”
    c.cut({ pos: z.P(C.x + 4.4, C.n - 10.6, 1.9), look: z.P(C.x - 1, C.n - 5, 1.4), fov: 46 });
    terminal(z, ['MERIDIAN CONTINUITY: 4 / 5', 'TERMINAL WITNESS: SEALED', 'BEARER CONTINUITY A: VERIFIED']);
    if (!z.skipping) yield* lineToTarrik(z, beams);
    yield 0.8;
    terminal(z, ['MERIDIAN CONTINUITY: 4 / 5', 'TERMINAL WITNESS: SEALED', 'BEARER CONTINUITY A: VERIFIED', 'BEARER CONTINUITY B: VERIFIED']);
    if (!z.skipping) {
      const core = S.crownmark?.socket('core');
      const from = core ? core.getWorldPosition(new THREE.Vector3()) : z.P(C.x, C.n, 2);
      const sc = s().setY(s().y + 1.35);
      beams.push(game.vfx.beam(from, from.clone().lerp(sc, 0.93), 'gold', { width: 0.06 }));
      // the two paths reach toward one another and stop short
      const tc = z.player.pos.clone().setY(z.player.pos.y + 1.35);
      const mid = tc.clone().lerp(sc, 0.5);
      beams.push(game.vfx.beam(tc, tc.clone().lerp(mid, 0.82), 'gold', { width: 0.045 }));
      beams.push(game.vfx.beam(sc, sc.clone().lerp(mid, 0.82), 'gold', { width: 0.045 }));
    }
    yield 2.2;
    terminal(z, ['MERIDIAN CONTINUITY: 4 / 5', 'TERMINAL WITNESS: SEALED', 'BEARER CONTINUITY A: VERIFIED', 'BEARER CONTINUITY B: VERIFIED', 'CONTINUITY RELATION: CONTRARY']);
    yield 2.6;
    ui.statusBoard(null);

    c.twoShot(s(), t, { side: 1, distance: 2.4, fov: 38 });
    yield* z.say('Selene', 'The terminal doesn’t require identical authority. It requires independent authority.', { actor: selene });
    c.twoShot(t, s(), { side: -1, distance: 2.4, fov: 38 });
    yield* z.say('Tarrik', 'One person can’t complete it.', { actor: z.player });
    for (const bm of beams) bm.remove(0.8);
    beams.length = 0;

    terminal(z, ['WITNESS V ACCESS REQUIRES MERIDIAN COMPLETION'], true);
    c.cut({ pos: z.P(C.x - 0.4, C.n - 12.4, 1.2), look: z.P(C.x, C.n, 3.6), fov: 48 });
    yield 2.6;
    terminal(z, ['WITNESS V ACCESS REQUIRES MERIDIAN COMPLETION', 'MERIDIAN COMPLETION WILL ENABLE TERMINAL AUTHORITY']);
    yield 2.8;
    ui.statusBoard(null);
    // “It is the fastest agreement they have reached.”
    c.cut({ pos: t.clone().lerp(s(), 0.5).add(new THREE.Vector3(0, 1.5, 3.6)), look: t.clone().lerp(s(), 0.5).setY(t.y + 1.4), fov: 42 });
    yield* z.say('Tarrik + Selene', 'No.', { actor: z.player }); // speaker label NEW (the script's TARRIK + SELENE, together)
    // he circles the outer ring, not approaching the Crownmark
    t = place(z, 'tarrikRing1', z.P(C.x, C.n - 10, 1));
    c.shot(t, { yawDeg: 230, distance: 3.4, height: 1.6, lookHeight: 1.45, fov: 40 });
    yield* z.say('Tarrik', 'We leave it sealed.', { actor: z.player });
    c.shot(s(), { yawDeg: 200, distance: 2.6, height: 1.55, lookHeight: 1.5, fov: 36 });
    yield* z.say('Selene', 'Wait.', { actor: selene });

    // fact one: four active references are unbalanced
    if (S.diag) S.diag.params.progress = 0;
    const holo = S.diag ? S.diag.object.position.clone() : z.P(C.x + 4.4, C.n - 7.1, 1.25);
    c.cut({ pos: holo.clone().add(new THREE.Vector3(-1.6, 0.6, 2.6)), look: holo, fov: 40 });
    yield* show(z, [['REMOTE ANCHOR LOAD: ASYMMETRIC', 'warn'], ['BOUNDARY DEGRADATION: ACTIVE', 'warn'], ['CONTAINMENT STRESS: RISING', 'warn']], 3.0);
    yield* z.say('Selene', 'The system was never meant to remain at four.', { actor: selene });
    c.twoShot(s(), t, { side: 1, distance: 2.8, fov: 34 });
    yield* z.say('Selene', 'The boundary is trying to balance four active references against one closed terminal authority.', { actor: selene });
    t = place(z, 'tarrikRing2', s());
    c.shot(t, { yawDeg: 160, distance: 3.0, height: 1.6, lookHeight: 1.5, fov: 38 });
    yield* z.say('Tarrik', 'That’s why the Eclipse is getting through.', { actor: z.player });
    c.shot(s(), { yawDeg: 220, distance: 2.6, height: 1.55, lookHeight: 1.5, fov: 36 });
    yield* z.say('Selene', 'Yes.', { actor: selene });

    // fact two: doing nothing threatens containment — the forecast is a readout, never a clock to race
    if (S.forecast) S.forecast.params.visible = 1;
    c.cut({ pos: z.P(C.x - 5.6, C.n - 11.6, 1.9), look: z.P(C.x - 4.6, C.n - 7.2, 2.1), fov: 42 });
    yield* show(z, [['BOUNDARY PRESSURE: 138%', 'warn'], ['FORECAST TO CRITICAL FAILURE: 02:11:43', 'warn']], 3.6);
    c.shot(s(), { yawDeg: 180, distance: 2.4, height: 1.55, lookHeight: 1.5, fov: 34 });
    yield* z.say('Selene', 'If we do nothing, the boundary fails.', { actor: selene });
    // fact three, in his words: completing it unlocks the door; leaving it lets the wall fall
    t = place(z, 'tarrikComm', s());
    c.twoShot(t, s(), { side: -1, distance: 2.6, fov: 34 });
    yield* z.say('Tarrik', 'So the choice is between unlocking the door and allowing the wall around it to collapse.', { actor: z.player });
    ui.statusBoard(null);

    // Tarrik's comm — static, gunfire on the channel
    if (!z.skipping) game.audio.play('ambCommBlip');
    c.shot(t, { yawDeg: 210, distance: 2.3, height: 1.6, lookHeight: 1.6, fov: 32 });
    yield* z.say('Cross', 'Tarrik, terminal telemetry is now visible through Neon Veil.', RADIO);
    yield* z.say('Cross', 'Complete the Meridian.', RADIO);
    // “he looks at Selene first” — “She hears everything.”
    game.player.playScripted('idle', { faceTo: s() });
    c.twoShot(s(), t, { side: 1, distance: 3.2, fov: 30 });
    yield 0.8;
    c.shot(t, { yawDeg: 200, distance: 2.1, height: 1.6, lookHeight: 1.6, fov: 30 });
    yield* z.say('Tarrik', 'No.', { actor: z.player });
    yield* z.say('Tarrik', 'And after I complete it?', { actor: z.player });
    yield* z.say('Cross', 'We determine terminal control.', RADIO);
    yield* z.say('Tarrik', 'That is precisely the part I am concerned about.', { actor: z.player });

    // Selene's comm — Lyric screaming behind Tharne
    c.shot(s(), { yawDeg: 160, distance: 2.0, height: 1.6, lookHeight: 1.6, fov: 30 });
    if (selene) selene.stopAction();
    yield* z.say('Tharne', 'Selene.', RADIO);
    yield* z.say('Selene', 'Status.', { actor: selene });
    yield* z.say('Tharne', 'Bad.', RADIO);
    yield* z.say('Lyric', 'Selene.', RADIO);
    yield* z.say('Selene', 'I’m here.', { actor: selene });
    yield* z.say('Lyric', 'Don’t leave it like this.', RADIO);
    yield* z.say('Selene', 'Can she survive two hours?', { actor: selene });
    // he “does not answer quickly enough”, then says it
    yield 1.1;
    yield* z.say('Tharne', 'I don’t know.', RADIO);
    yield* z.say('Lyric', 'Make it quiet.', { ...RADIO, duration: 2.6 });
    if (!z.skipping) game.audio.play('ambCommBlip', { volume: 0.6 });
    yield 1.2;

    // the decision — they end “almost shoulder to shoulder, neither having noticed when it happened”
    t = place(z, 'tarrikShoulder', z.P(C.x, C.n, 1.4));
    if (selene) {
      selene.stopAction();
      selene.teleport(z.m('seleneShoulder'), z.myaw('seleneShoulder'));
      selene.face(z.P(C.x, C.n, 1.4));
    }
    c.cut({ pos: z.P(C.x + 0.5, C.n - 10.6, 1.7), look: t.clone().lerp(s(), 0.5).setY(t.y + 1.45), fov: 34 });
    yield* z.say('Tarrik', 'I’ve heard this argument before.', { actor: z.player });
    yield* z.say('Tarrik', 'That there is no other choice.', { actor: z.player });
    c.twoShot(t, s(), { side: -1, distance: 1.9, fov: 34 });
    yield* z.say('Tarrik', 'People usually say it just before making something unforgivable sound inevitable.', { actor: z.player });
    c.twoShot(s(), t, { side: 1, distance: 1.9, fov: 34 });
    yield* z.say('Selene', 'We decide between the risks that exist, not the innocence we wish existed.', { actor: selene });
    c.twoShot(t, s(), { side: -1, distance: 1.9, fov: 34 });
    yield* z.say('Tarrik', 'If this is wrong…', { actor: z.player });
    c.twoShot(s(), t, { side: 1, distance: 1.9, fov: 34 });
    yield* z.say('Selene', 'Then we put our names beside it.', { actor: selene });
    yield 0.8;

    // end state — identical watched or skipped
    for (const bm of beams) bm.remove(0.5);
    ui.statusBoard(null);
    if (S.diag) S.diag.params.visible = 1;
    if (S.forecast) S.forecast.params.visible = 1;
    game.player.teleport(z.m('tarrikShoulder'), z.myaw('tarrikShoulder'));
    if (selene) {
      selene.stopAction();
      selene.face(null);
      selene.teleport(z.m('seleneConsole'), z.myaw('seleneConsole'));
    }
    snapProps(z);
  });
}
