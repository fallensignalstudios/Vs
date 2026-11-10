/**
 * Z10 `consequence` and `after` (SCRIPT_SOURCE Z10). The boundary is closed; the authority to open it now
 * exists; the release command is withheld; the language of command spread to both governments and could not be
 * stopped; release needs both of them. The book's strings only — no «stability recovering», no rejection of the
 * queries. Crownmark Five does not move or change shape: its white core is steady rather than pulsing. Nothing
 * opens the prison. `after` is the silent walk to the return lift.
 */
import * as THREE from 'three';
import type { CineCtx, Routine, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api/chars';
import { C, DAIS_H, S, show, snapProps, terminal } from './state';
import { palm } from './assent';

/** the consequence board, built up row by row (exact strings) */
const BOARD_1 = ['ALL WITNESSES COMPLETE', 'SOVEREIGN MERIDIAN COMPLETE', 'PRIMARY CONTAINMENT AUTHORITY: OPEN'] as const;
const BOARD_2 = ['TERMINAL AUTHORITY AVAILABLE', ['RELEASE COMMAND: WITHHELD', 'warn'], 'SOVEREIGN COMMAND REQUIRED'] as const;

export function* consequenceScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const sky = game.sky;
  const tarrik = z.cast('tarrik');
  const tvis = tarrik?.actor.visual ?? null;
  yield* z.cinematic('z10-consequence', function* (c: CineCtx): Routine {
    const s = (): THREE.Vector3 => z.player.pos.clone();
    const t = (): THREE.Vector3 => (tarrik ? tarrik.actor.pos.clone() : z.m('standT'));
    game.player.teleport(z.m('standS'), z.myaw('standS'));
    if (tarrik) {
      tarrik.stopAction();
      tarrik.mode = 'scripted';
      tarrik.teleport(z.m('standT'), z.myaw('standT'));
    }
    c.twoShot(t(), s(), { side: -1, distance: 2.3, fov: 34 });
    yield* z.say('Tarrik', 'He didn’t leave.', { actor: tarrik });
    c.twoShot(s(), t(), { side: 1, distance: 2.3, fov: 34 });
    yield* z.say('Selene', 'He stayed.', { actor: z.player });

    // the terminal interrupts. “Tarrik draws Velkorran. Selene extends Verity halfway before the next line resolves.”
    tvis?.setLoadout({ melee: true });
    tarrik?.play('raiseWeapon');
    game.player.playScripted('raiseWeapon', { faceTo: z.P(C.x, C.n, 1.6) });
    c.cut({ pos: z.P(C.x, C.n - 13.4, 1.0), look: z.P(C.x, C.n, 4.4), fov: 48 });
    terminal(z, [...BOARD_1], true);
    yield 3.2;
    // “She lowers the weapon slightly.”
    terminal(z, [...BOARD_1, 'BOUNDARY STATE: CLOSED']);
    sky.setBoundaryClosed(true, z.skipping ? 0 : 4);
    if (!z.skipping) {
      game.audio.play('boundaryClose');
      game.vfx.spawn('boundaryClose', z.P(C.x, C.n, DAIS_H + 6), { dir: { x: 0, y: 0, z: 1 }, scale: 1.4 });
    }
    yield 2.0;
    game.ui.statusBoard(null);
    game.player.playScripted('lowerWeapon', { faceTo: z.P(C.x, C.n, 1.6) });
    c.shot(s(), { yawDeg: 200, distance: 2.4, height: 1.6, lookHeight: 1.58, fov: 32 });
    yield* z.say('Selene', 'The authority lattice is open. Not the prison.', { actor: z.player });
    z.story('releaseWithheld');
    c.cut({ pos: z.P(C.x + 0.6, C.n - 13.0, 1.1), look: z.P(C.x, C.n, 4.2), fov: 48 });
    yield* show(z, ['BOUNDARY STATE: CLOSED', ...BOARD_2], 4.0);
    c.twoShot(t(), s(), { side: -1, distance: 2.3, fov: 34 });
    yield* z.say('Tarrik', 'So we armed the lock.', { actor: tarrik });
    c.twoShot(s(), t(), { side: 1, distance: 2.3, fov: 34 });
    yield* z.say('Selene', 'Yes.', { actor: z.player });

    // the command architecture spreads; they cannot stop it
    terminal(z, [['TERMINAL COMMAND ARCHITECTURE SYNCHRONIZING TO ACTIVE NODES', 'warn']], true);
    if (!z.skipping) {
      game.vfx.spawn('grammarPropagate', z.P(C.x, C.n, DAIS_H), { duration: 6, scale: 2.6 });
      game.audio.play('grammarPropagate');
    }
    if (S.rings) S.rings.params.energy = 1;
    c.cut({ pos: z.P(C.x + 7, C.n - 12, 3.4), look: z.P(C.x, C.n, 2), fov: 52 });
    yield 2.4;
    game.ui.statusBoard(null);
    c.shot(s(), { yawDeg: 210, distance: 2.0, height: 1.6, lookHeight: 1.6, fov: 30 });
    yield* z.say('Selene', 'No.', { actor: z.player });
    c.shot(t(), { yawDeg: 150, distance: 2.0, height: 1.65, lookHeight: 1.62, fov: 30 });
    yield* z.say('Tarrik', 'Stop synchronization.', { actor: tarrik });
    c.shot(s(), { yawDeg: 210, distance: 2.0, height: 1.6, lookHeight: 1.6, fov: 30 });
    yield* z.say('Selene', 'Interrupt Meridian synchronization.', { actor: z.player });
    c.cut({ pos: z.P(C.x - 7, C.n - 12, 3.0), look: z.P(C.x, C.n, 2.4), fov: 52 });
    yield* show(z, [['TERMINAL COMMAND ARCHITECTURE SYNCHRONIZING TO ACTIVE NODES', 'warn'], ['MERIDIAN SYNCHRONIZATION CANNOT BE INTERRUPTED', 'warn']], 2.8);
    c.shot(t(), { yawDeg: 150, distance: 2.2, height: 1.65, lookHeight: 1.5, fov: 32 });
    yield* z.say('Tarrik', 'Of course.', { actor: tarrik });
    // he strikes the interface with his palm
    tvis?.setLoadout({ melee: false });
    tarrik?.play('interact');
    if (isHumanoidVisual(tvis)) tvis.setHandTarget('R', z.m('handT'), 1);
    if (!z.skipping) game.audio.play('panelCommit', { pos: z.m('handT') });
    yield 0.8;
    if (isHumanoidVisual(tvis)) tvis.setHandTarget('R', null);

    // the queries arrive — on her display and, the same moment, on his interface
    z.story('grammarPropagated');
    c.cut({ pos: z.P(C.x, C.n - 13.6, 1.0), look: z.P(C.x, C.n, 4.4), fov: 48 });
    yield* show(z, ['EXTERNAL CONTINUITY QUERY DETECTED', 'SOURCE: REFORMATION CENTRAL INFORMATION INTEGRITY', 'CROWNWATCH SOVEREIGN QUERY DETECTED'], 4.4);
    c.twoShot(t(), s(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('Tarrik', 'We gave them the door.', { actor: tarrik });
    c.twoShot(s(), t(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Selene', 'No. We gave them the language to ask the door to open.', { actor: z.player });
    // “Tarrik reads it twice.”
    c.cut({ pos: t().add(new THREE.Vector3(-0.6, 1.7, 2.2)), look: z.m('handT'), fov: 40 });
    yield* show(z, ['TERMINAL RELEASE REQUIRES CONTRARY BEARER CONCURRENCE'], 3.4);
    c.shot(t(), { yawDeg: 165, distance: 2.0, height: 1.66, lookHeight: 1.64, fov: 30 });
    yield* z.say('Tarrik', 'They still need us.', { actor: tarrik });
    c.twoShot(s(), t(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Selene', 'Yes.', { actor: z.player });
    c.twoShot(t(), s(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('Tarrik', 'Both of us.', { actor: tarrik });
    c.twoShot(s(), t(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Selene', 'Yes. No singular authority can execute the release. That is why the King required contrary witnesses.', { actor: z.player });
    c.twoShot(t(), s(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('Tarrik', 'He really trusted no one.', { actor: tarrik });
    c.twoShot(s(), t(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Selene', 'Maybe he trusted disagreement.', { actor: z.player });

    // the pressure keeps falling; “Movement recedes within the Wound.”
    terminal(z, ['BOUNDARY PRESSURE: 61%'], true);
    sky.setWoundActivity(0.02);
    c.cut({ pos: z.P(C.x - 2.4, C.n - 12.5, 1.4), look: z.P(C.x, C.n, 6.5), fov: 50 });
    c.moveAsync({ pos: z.P(C.x - 1.8, C.n - 11, 1.5), look: z.P(C.x, C.n, 7), fov: 48 }, 6, 'inOut');
    yield 2.6;
    terminal(z, ['BOUNDARY PRESSURE: 43%']); // NEW (the book: “43 percent”)
    yield 3.0;

    // end state — identical watched or skipped
    z.game.ui.statusBoard(null);
    sky.setBoundaryClosed(true, 0);
    tvis?.setLoadout({ melee: false });
    if (isHumanoidVisual(tvis)) tvis.setHandTarget('R', null);
    palm(z, 'tarrik', false);
    if (tarrik) {
      tarrik.stopAction();
      tarrik.mode = 'follow';
    }
    snapProps(z);
  });
}
