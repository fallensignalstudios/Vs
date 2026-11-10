/**
 * Z10 `witness` — Witness V, watched, never played (SCRIPT_SOURCE Z10 `witness`; CORE lines only, skippable).
 *
 * The chamber disappears; Tarrik and Selene stand inside the Witness, unseen and unable to affect anything. The
 * bridge, the whole blue-white star, the King and his chronicler. Part one: the trap. Part two (no dialogue): the
 * King raises the blade, Aurelion tears into two unequal remnants and the Wound forms. Part three: the anchors, the
 * contrary condition, and the King walks through a white-gold portal of his own age that opens on the bridge and
 * gives onto the Wound (the author's ruling 6) — it has no name, caption or line. The boundary seals; Crownmark Five
 * ignites. The chronicler's subtitles read CHRONICLER until the King names him, VESRYN after.
 */
import * as THREE from 'three';
import type { CineCtx, Routine, SayOpts, ZoneRuntime } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { C, DAIS_H, S, terminal } from './state';
import { placeFigure, walkFigure, type WitnessSet } from './witness-set';

const OFF: SayOpts = { offscreen: true };

/** show the Witness and hide the chamber (or the reverse); the hidden list is kept so a restore is exact */
export function showWitness(z: ZoneRuntime, on: boolean): void {
  const W = S.witness;
  if (!W) return;
  const root = z.builder.root;
  if (on) {
    if (S.hidden.length === 0) {
      for (const o of root.children) {
        if (o === W.group || !o.visible) continue;
        o.visible = false;
        S.hidden.push(o);
      }
    }
    W.group.visible = true;
  } else {
    for (const o of S.hidden) o.visible = true;
    S.hidden.length = 0;
    W.group.visible = false;
  }
}

/** the opening state of the set (figures placed, star whole, nothing open) */
export function resetWitness(z: ZoneRuntime, W: WitnessSet): void {
  placeFigure(z, W.king, 1.6, 7.6, 0);
  placeFigure(z, W.vesryn, -2.6, 4.2, 30);
  W.tgt = { star: 1, sunder: 0, wound: 0, portal: 0, blade: 0 };
  W.cur = { ...W.tgt };
  W.king.visual?.setVisible(true);
  W.king.visual?.setHandTarget('R', null);
}

export function* witnessScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const sky = game.sky;
  const render = game.render;
  const W = S.witness;
  const tarrik = z.cast('tarrik');
  yield* z.cinematic('z10-witness', function* (c: CineCtx): Routine {
    // “The chamber disappears.”
    yield* z.fadeOut(z.skipping ? 0 : 0.9, 'white');
    if (W) resetWitness(z, W);
    showWitness(z, true);
    game.ui.statusBoard(null);
    sky.setPreset('void');
    render.setLook({ ...LOOKS.witness, grade: { ...LOOKS.witness.grade, saturation: 0.5 } }, 0);
    game.audio.setMusic('witness', 1.5);
    if (!z.skipping) game.audio.play('witnessEnter');
    // the two watchers, side by side at the front of the dais
    game.player.teleport(z.P(C.x + 0.75, C.n - 4.1, DAIS_H), 0);
    if (tarrik) {
      tarrik.stopAction();
      tarrik.teleport(z.P(C.x - 0.75, C.n - 4.1, DAIS_H), 0);
    }
    const sel = (): THREE.Vector3 => z.player.pos.clone();
    const tar = (): THREE.Vector3 => (tarrik ? tarrik.actor.pos.clone() : z.P(C.x - 0.75, C.n - 4.1, DAIS_H));
    const king = (): THREE.Vector3 => (W?.king.visual ? W.king.visual.root.position.clone() : z.P(C.x + 1.6, C.n + 7.6, DAIS_H));
    const ves = (): THREE.Vector3 => (W?.vesryn.visual ? W.vesryn.visual.root.position.clone() : z.P(C.x - 2.6, C.n + 4.2, DAIS_H));
    // “One massive blue-white star fills the sky”
    c.cut({ pos: z.P(C.x + 0.2, C.n - 7.2, DAIS_H + 1.7), look: z.P(C.x + 0.6, C.n + 40, DAIS_H + 9), fov: 60 });
    yield* z.fadeIn(z.skipping ? 0 : 1.4);
    c.moveAsync({ pos: z.P(C.x + 0.1, C.n - 5.6, DAIS_H + 1.7), look: z.P(C.x + 0.8, C.n + 40, DAIS_H + 8), fov: 56 }, 6, 'inOut');
    if (!z.skipping) game.vfx.spawn('witnessMote', z.P(C.x, C.n + 2, DAIS_H + 1.5), { duration: 90 });
    yield 3.6;

    // ---- part one: the bridge and the trap -------------------------------------------------------------------
    // the chronicler steps up beside the King. “Tarrik goes rigid.”
    if (W) walkFigure(z, W.vesryn, 0.2, 7.0, 0.9);
    c.shot(king(), { yawDeg: 200, distance: 5.2, height: 1.7, lookHeight: 1.7, fov: 36 });
    yield 2.6;
    c.shot(tar(), { yawDeg: 160, distance: 1.9, height: 1.65, lookHeight: 1.62, fov: 30 });
    yield 0.6;
    yield* z.say('Tarrik', 'Him.', { actor: tarrik });
    c.twoShot(sel(), tar(), { side: 1, distance: 1.7, fov: 34 });
    yield* z.say('Selene', 'You know him.', { actor: z.player });
    c.twoShot(tar(), sel(), { side: -1, distance: 1.7, fov: 34 });
    yield* z.say('Tarrik', 'I’ve heard him.', { actor: tarrik });

    c.twoShot(ves(), king(), { side: 1, distance: 2.4, fov: 34 });
    yield* z.say('Chronicler', 'You are drawing every remaining Eclipse mass into one system.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.4, fov: 34 });
    yield* z.say('King', 'Yes.');
    c.twoShot(ves(), king(), { side: 1, distance: 2.4, fov: 34 });
    yield* z.say('Chronicler', 'There are civilian ships inside the convergence radius.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.4, fov: 34 });
    yield* z.say('King', 'I know.');
    c.twoShot(ves(), king(), { side: 1, distance: 2.4, fov: 34 });
    yield* z.say('Chronicler', 'The carnage you wreak will not stop the Eclipse of life.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.4, fov: 34 });
    yield* z.say('King', 'No. But it may give us somewhere to bury it.');
    c.twoShot(ves(), king(), { side: 1, distance: 2.4, fov: 34 });
    yield* z.say('Chronicler', 'You will kill millions.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.4, fov: 34 });
    yield* z.say('King', 'Yes.');
    c.twoShot(ves(), king(), { side: 1, distance: 2.4, fov: 34 });
    yield* z.say('Chronicler', 'You do not know whether this will work.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.4, fov: 34 });
    yield* z.say('King', 'No.');
    // he walks to the forward glass, “and the chronicler follows.”
    if (W) {
      walkFigure(z, W.king, 0.9, 10.6, 0.8);
      walkFigure(z, W.vesryn, -0.5, 9.9, 0.8);
    }
    c.shot(king(), { yawDeg: 190, distance: 7.0, height: 1.8, lookHeight: 2.2, fov: 40 });
    yield 2.6;
    yield* z.say('King', 'Vesryn.');
    // “Tarrik closes his eyes.” — the man who has spoken through impossible fragments finally possesses a name
    c.shot(tar(), { yawDeg: 170, distance: 1.6, height: 1.65, lookHeight: 1.64, fov: 28 });
    yield 2.4;
    terminal(z, [['ECLIPSE CONVERGENCE: 97%', 'warn']], true);
    c.cut({ pos: z.P(C.x - 0.6, C.n + 6.4, DAIS_H + 1.7), look: z.P(C.x + 0.4, C.n + 40, DAIS_H + 9), fov: 48 });
    yield 2.0;
    yield* z.say('Vesryn', 'They will call you King, but you will die a beggar.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('King', 'Then let them bury me without a crown.');
    game.ui.statusBoard(null);

    // ---- part two: the star (no dialogue) --------------------------------------------------------------------
    // “White-gold Echo ignites around the King, neither Dominion amber nor Reformation blue”. “He raises the blade,
    // and Aurelion answers.”
    if (W) {
      W.tgt.blade = 1;
      W.king.visual?.setGlow(2.2);
      const hand = king().add(new THREE.Vector3(0.25, 2.55, -0.35));
      W.king.visual?.setHandTarget('R', hand, 1);
    }
    c.shot(king(), { yawDeg: 160, distance: 4.0, height: 1.3, lookHeight: 2.1, fov: 40 });
    yield 2.4;
    // “A line of force enters the star.” “Nothing happens for half a second.”
    const tip = W?.blade.getWorldPosition(new THREE.Vector3()) ?? king().setY(king().y + 3);
    const force = !z.skipping ? game.vfx.beam(tip, W ? W.star.position : tip, 'gold', { width: 0.5 }) : null;
    c.cut({ pos: z.P(C.x - 1.2, C.n - 3.0, DAIS_H + 1.3), look: z.P(C.x + 0.4, C.n + 40, DAIS_H + 9), fov: 62 });
    yield 1.6;
    // “Then Aurelion tears apart.” — “a pressure beneath hearing, a vibration carried through bone.”
    if (W) {
      W.tgt.sunder = 1;
      W.tgt.wound = 1;
    }
    force?.remove(0.4);
    if (!z.skipping) {
      game.audio.play('witnessSunder');
      game.camera.shake(0.5, 3);
      sky.impact({ strength: 1, color: 0xffffff });
    }
    yield 2.4;
    // “Eclipse and human vessels become light together”. “The King watches friendly ships disappear. He does not
    // look away.”
    sky.setPreset('observation', { blendSeconds: z.skipping ? 0 : 5 });
    sky.setHeading(0);
    if (!z.skipping) {
      for (let i = 0; i < 5; i++) sky.impact({ strength: 0.6, color: i % 2 ? 0xbfe0ff : 0xffc890 });
    }
    yield 2.2;
    c.shot(king(), { yawDeg: 175, distance: 2.3, height: 1.9, lookHeight: 1.95, fov: 30 });
    yield 2.6;
    // “Space between the remnants folds inward, and the Wound forms.” “It is not emptiness. It is containment.”
    c.cut({ pos: z.P(C.x + 0.4, C.n - 6.6, DAIS_H + 1.4), look: z.P(C.x, C.n + 40, DAIS_H + 7.5), fov: 64 });
    game.ui.card('It is not emptiness. It is containment.', { style: 'witness', seconds: 4.6 });
    yield 4.4;
    if (W) {
      W.tgt.blade = 0;
      W.king.visual?.setHandTarget('R', null);
      W.king.visual?.setGlow(1);
    }

    // ---- part three: the terminal anchor ---------------------------------------------------------------------
    terminal(z, ['REMOTE ANCHOR I: SEALED', 'REMOTE ANCHOR II: SEALED', 'REMOTE ANCHOR III: SEALED', 'REMOTE ANCHOR IV: SEALED'], true);
    c.cut({ pos: z.P(C.x - 1.6, C.n + 5.2, DAIS_H + 1.75), look: king().setY(DAIS_H + 1.6), fov: 38 });
    yield 2.8;
    terminal(z, ['REMOTE ANCHOR I: SEALED', 'REMOTE ANCHOR II: SEALED', 'REMOTE ANCHOR III: SEALED', 'REMOTE ANCHOR IV: SEALED',
      ['TERMINAL ANCHOR: PENDING', 'warn'], ['SOVEREIGN REFERENCE REQUIRED BEYOND BOUNDARY', 'warn']]);
    yield 2.6;
    c.twoShot(ves(), king(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Vesryn', 'Then send someone else.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('King', 'Who?');
    game.ui.statusBoard(null);
    c.twoShot(ves(), king(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Vesryn', 'They will call this victory.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('King', 'A lock is not a victory. Tell them I did not destroy the Eclipse. Tell them I closed a door.');
    c.shot(ves(), { yawDeg: 160, distance: 2.2, height: 1.7, lookHeight: 1.7, fov: 32 });
    yield* z.say('Vesryn', 'Fire. Frost. A bear beneath a crown. An eagle leaving its nest.');
    yield* z.say('Vesryn', 'The gates fail.');
    // “Tarrik turns toward Selene. She is already looking at him, and neither speaks.”
    tarrik?.face(sel());
    game.player.playScripted('idle', { faceTo: tar() });
    c.cut({ pos: tar().lerp(sel(), 0.5).add(new THREE.Vector3(0, 1.55, -2.6)), look: tar().lerp(sel(), 0.5).setY(DAIS_H + 1.55), fov: 36 });
    yield 2.6;
    tarrik?.face(null);
    c.twoShot(ves(), king(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Vesryn', 'I can tell you what I saw.');
    c.twoShot(king(), ves(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('King', 'No.');
    c.twoShot(ves(), king(), { side: 1, distance: 2.2, fov: 34 });
    yield* z.say('Vesryn', 'Why?');
    c.twoShot(king(), ves(), { side: -1, distance: 2.2, fov: 34 });
    yield* z.say('King', 'Because I still have to choose.');
    yield* z.say('King', 'Change the final access condition.');
    yield* z.say('King', 'No singular Witness receives terminal release authority.');
    yield* z.say('Engineer', 'Then who does?', OFF);
    yield* z.say('King', 'Contrary witnesses.');
    yield* z.say('Engineer', 'Opposed authority?', OFF);
    yield* z.say('King', 'Independent authority.');
    // “The King walks toward the boundary.” — he says it walking
    if (W) walkFigure(z, W.king, 3.0, 7.6, 0.75);
    c.shot(king(), { yawDeg: 215, distance: 4.4, height: 1.7, lookHeight: 1.7, fov: 36 });
    yield* z.say('King', 'If the people who inherit this cannot find someone who disagrees with them,');
    yield* z.say('King', 'they have no business opening the door.');
    // the final threshold: white-gold light forms against the Wound, and darkness waits beyond it
    if (W) W.tgt.portal = 1;
    if (!z.skipping) {
      game.audio.play('boundaryClose', { volume: 0.7 });
      game.vfx.spawn('witnessMote', z.P(C.x + 3.4, C.n + 9.2, DAIS_H + 2.2), { duration: 6 });
    }
    c.cut({ pos: z.P(C.x + 0.4, C.n + 2.2, DAIS_H + 1.6), look: z.P(C.x + 3.4, C.n + 9.2, DAIS_H + 2.3), fov: 44 });
    yield 2.6;
    // “Vesryn takes one step forward.”
    if (W) walkFigure(z, W.vesryn, 0.2, 9.0, 0.7);
    c.twoShot(king(), ves(), { side: -1, distance: 2.6, fov: 36 });
    yield* z.say('King', 'Do not follow me.');
    yield* z.say('King', 'Write what they forget.');
    c.twoShot(ves(), king(), { side: 1, distance: 2.6, fov: 36 });
    yield* z.say('Vesryn', 'I will.');
    // “The King crosses the threshold. White-gold light surrounds him, and for one second Selene can still see his
    // silhouette moving within the dark.”
    if (W) walkFigure(z, W.king, 3.6, 10.6, 0.9);
    c.cut({ pos: z.P(C.x + 1.4, C.n + 1.0, DAIS_H + 1.6), look: z.P(C.x + 3.4, C.n + 9.4, DAIS_H + 2.1), fov: 40 });
    yield 3.6;
    if (W) {
      W.king.visual?.setVisible(false);
      W.tgt.portal = 0;
    }
    yield 1.6;
    // “Then the boundary seals.” “Crownmark Five ignites.”
    if (!z.skipping) {
      game.vfx.spawn('boundaryClose', z.P(C.x + 3.4, C.n + 9.2, DAIS_H + 2.3), { dir: { x: 0, y: 0, z: 1 } });
      game.audio.play('boundaryClose');
    }
    terminal(z, ['TERMINAL ANCHOR: SEALED'], true);
    yield 2.6;
    // “The Witness ends.”
    yield* z.fadeOut(z.skipping ? 0 : 0.8, 'white');
    game.ui.statusBoard(null);
    showWitness(z, false);
    sky.setPreset('coreChamber');
    sky.setHeading(0);
    render.setLook(LOOKS.core, 0);
    game.audio.setMusic('consequence', 2);
    // back where they stood, at their interfaces
    game.player.teleport(z.m('standS'), z.myaw('standS'));
    if (tarrik) tarrik.teleport(z.m('standT'), z.myaw('standT'));
    if (S.crownmark) S.crownmark.params.glow = 1;
    c.cut({ pos: z.P(C.x - 0.9, C.n - 6.8, 1.2), look: z.P(C.x, C.n, 1.7), fov: 36 });
    yield* z.fadeIn(z.skipping ? 0 : 1.2);
    if (!z.skipping) game.vfx.flash(z.P(C.x, C.n, 1.7), 0xfff4e0, 6, 0.6);
    yield 1.2;
  });
}
