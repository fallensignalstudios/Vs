/**
 * Z02 `stabilize` — the book's Varo scene, whole (SCRIPT_SOURCE Z02 `stabilize`, the author's ruling 2): the
 * infection that took his gauntlet at the Z01 rib reaches the skin; Tarrik gives the order and owns it;
 * Lyessa makes the cut; Tarrik drops beside him and seals the wound; the man stays human and alive and says his
 * own name. Then two soldiers take him between them. Every line is the author's, in order.
 *
 * Staging rules: the scene opens on the cracked gauntlet; the blade stays out of frame during the cut; Lyessa
 * kneels at Varo's other side — Tarrik is never framed on his knees with an armed woman standing behind him.
 * Skip = fast-forward: every state change (poses released, the cut, positions, follow orders) is unconditional.
 */
import * as THREE from 'three';
import { isHumanoidVisual } from '@/core/api';
import type { CineCtx, Companion, Routine, ZoneRuntime } from '@/core/api';
import { AMBER, waitOr, walkTo, atPost } from '../shared';
import { amputate, attachInfection, setConsumed, setInfectionGrowth } from './infection';

/** subtitle labels: nameless until he says his name */
const SOLDIER = 'Dominion Soldier';
const VARO = 'Varo';

interface VaroState {
  blade: THREE.Group | null;
}
let V: VaroState = { blade: null };
export function resetVaro(): void {
  V = { blade: null };
}

/** Lyessa's field blade: a short dark knife with an amber edge, in her right hand for the scene */
function showBlade(z: ZoneRuntime, lyessa: Companion | null, on: boolean): void {
  const visual = lyessa?.actor.visual;
  if (!visual) return;
  if (on && !V.blade) {
    const mats = z.game.mats;
    const g = new THREE.Group();
    g.name = 'z02-field-blade';
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.028, 0.19), mats.get('domBlack'));
    blade.position.z = -0.14;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.18), mats.emissive(AMBER, 2.2));
    edge.position.set(0, -0.015, -0.14);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.03, 0.09), mats.get('domBronze'));
    grip.position.z = -0.005;
    g.add(blade, edge, grip);
    visual.socket('handR').add(g);
    V.blade = g;
    z.onDispose(() => {
      g.removeFromParent();
      for (const c of g.children) (c as THREE.Mesh).geometry.dispose();
    });
    visual.setLoadout({ ranged: false });
  }
  if (V.blade) V.blade.visible = on;
  if (!on) visual.setLoadout({ ranged: true });
}

/** feet position of a cast member or a marker */
function at(z: ZoneRuntime, c: Companion | null, marker: string): THREE.Vector3 {
  return c ? c.actor.pos.clone() : z.m(marker);
}

/**
 * The scene. Markers: varo, lyessaKneel, tarrikStand, tarrikKneel, limb, helpL, helpR, varoUp (and the
 * squad's soldierA / soldierB). Ends with the squad formed up to walk the bend (see `formUp`).
 */
export function* varoScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const malik = z.cast('malik');
  const lyessa = z.cast('lyessa');
  const a = z.cast('soldierA');
  const bb = z.cast('soldierB');
  const varo = z.m('varo');

  yield* z.cinematic('z02-varo', function* (c: CineCtx): Routine {
    attachInfection(z, malik);
    setInfectionGrowth(0.45);
    // “Then a Dominion soldier screams.” — open on the gauntlet from Z01: the same crack, tissue in it
    const hand = new THREE.Vector3();
    const handPos = (): THREE.Vector3 => (malik?.actor.visual ? malik.actor.visual.socket('handL').getWorldPosition(hand) : hand.copy(varo).setY(0.5));
    handPos();
    // in front of him and to his left, low: the hand in his lap, his body behind it
    c.cut({ pos: hand.clone().add(new THREE.Vector3(-0.34, 0.55, -0.52)), look: hand.clone(), fov: 30 });
    c.moveAsync({ pos: hand.clone().add(new THREE.Vector3(-0.26, 0.46, -0.42)), look: hand.clone(), fov: 26 }, 3.4, 'inOut');
    c.dof(0.66, 0.7);
    if (!z.skipping) {
      game.events.emit('caption', { text: 'A soldier screams', kind: 'alert', pos: varo }); // NEW
      game.audio.play('eclipseBreath', { pos: varo, volume: 0.6 });
      game.audio.play('armorRattle', { pos: varo });
    }
    malik?.play('hitHeavy');
    setInfectionGrowth(0.62);
    yield 2.6;
    c.dof(null);

    // Tarrik is over him at once; he grips the man's shoulder. Lyessa is already down at his other side.
    game.player.teleport(z.m('tarrikStand'), z.myaw('tarrikStand'));
    lyessa?.teleport(z.m('lyessaKneel'), z.myaw('lyessaKneel'));
    lyessa?.play('kneel');
    showBlade(z, lyessa, true);
    const tv = z.player.visual;
    const shoulder = varo.clone().add(new THREE.Vector3(0.18, 1.0, -0.05));
    if (isHumanoidVisual(tv)) tv.setHandTarget('L', shoulder, 1);
    const tp = z.m('tarrikStand');
    c.shot(tp, { yawDeg: 250, distance: 2.3, height: 0.95, lookHeight: 1.6, fov: 38 });
    yield 0.4;
    yield* z.say('Tarrik', 'Cut it.', { actor: z.player });
    c.shot(varo, { yawDeg: 20, distance: 1.55, height: 1.05, lookHeight: 0.85, fov: 36 });
    yield* z.say(SOLDIER, 'What?', { actor: malik });
    // the three of them: Lyessa with the field blade, the man between them, Tarrik's grip on his shoulder
    c.shot(varo, { yawDeg: 0, distance: 2.9, height: 1.55, lookHeight: 0.9, fov: 42 });
    yield* z.say('Tarrik', 'Cut off the arm.', { actor: z.player });
    c.shot(varo, { yawDeg: 340, distance: 1.35, height: 1.0, lookHeight: 0.88, fov: 36 });
    yield* z.say(SOLDIER, 'No.', { actor: malik });
    // the look — not a request for an order but a demand that he own the choice
    const lp = at(z, lyessa, 'lyessaKneel');
    lyessa?.face(z.player.pos);
    lyessa?.actor.visual?.lookAt(z.player.pos.clone().setY(1.65));
    c.shot(lp, { yawDeg: 62, distance: 1.75, height: 1.18, lookHeight: 1.05, fov: 34 });
    yield 2.4;
    // and under it, the tissue moves another centimeter beneath his skin
    handPos();
    c.cut({ pos: hand.clone().add(new THREE.Vector3(-0.24, 0.42, -0.4)), look: hand.clone().add(new THREE.Vector3(0, 0.03, 0)), fov: 24 });
    setInfectionGrowth(0.95);
    yield 1.9;
    c.shot(tp, { yawDeg: 280, distance: 1.6, height: 1.5, lookHeight: 1.65, fov: 34 });
    yield* z.say('Tarrik', 'Do it.', { actor: z.player });

    // the cut: on the three faces, the blade out of frame
    c.cut({ pos: z.P(varo.x, -varo.z + 2.2, 1.55), look: varo.clone().setY(0.92), fov: 46 });
    yield 0.35;
    showBlade(z, lyessa, false);
    if (!z.skipping) {
      game.audio.play('bladeHitFlesh', { pos: varo, volume: 0.55, pitch: 0.8 });
      game.camera.shake(0.12, 0.25);
    }
    malik?.play('hitHeavy');
    amputate(z, malik, z.m('limb'), z.myaw('limb'));
    setConsumed(0.35);
    // Tarrik drops beside him and seals the wound
    if (isHumanoidVisual(tv)) tv.setHandTarget('L', null);
    game.player.teleport(z.m('tarrikKneel'), z.myaw('tarrikKneel'));
    game.player.playScripted('kneelTend');
    yield 0.6;
    if (!z.skipping) {
      const elbow = varo.clone().add(new THREE.Vector3(-0.28, 0.75, 0));
      game.vfx.spawn('cinderEmbers', elbow, { duration: 0.8, scale: 0.35 });
      game.audio.play('cinderIgnite', { pos: elbow, volume: 0.35 });
    }
    setConsumed(1);
    yield 1.4;
    lyessa?.face(varo);
    lyessa?.actor.visual?.lookAt(null);

    // “Name.” — at his level, holding his eyes
    const tk = z.m('tarrikKneel');
    const tShot = (): void => c.shot(tk, { yawDeg: 250, distance: 1.5, height: 1.12, lookHeight: 1.12, fov: 36 });
    // (framed on his bare face: he is drawn without a helmet, chars `malik`)
    const vShot = (): void => c.shot(varo, { yawDeg: 350, distance: 1.4, height: 1.06, lookHeight: 0.95, fov: 36 });
    malik?.face(tk);
    tShot();
    yield* z.say('Tarrik', 'Name.', { actor: z.player });
    vShot();
    yield* z.say(SOLDIER, 'Varo.', { actor: malik });
    tShot();
    yield* z.say('Tarrik', 'Full name.', { actor: z.player });
    vShot();
    yield* z.say(VARO, 'Centurion Malik Varo.', { actor: malik });
    tShot();
    yield* z.say('Tarrik', 'Stay with us, Malik.', { actor: z.player });
    // he stares at what is consuming the arm on the floor
    // the reverse: low beyond the black mass, his head bowed over it
    const limb = z.m('limb');
    malik?.actor.visual?.lookAt(limb);
    c.cut({ pos: limb.clone().add(new THREE.Vector3(-0.75, 0.32, -0.62)), look: varo.clone().setY(0.62), fov: 38 });
    c.dof(0.95, 0.6);
    yield* z.say(VARO, 'Was I…', { actor: malik });
    c.dof(null);
    malik?.actor.visual?.lookAt(null);
    c.shot(tk, { yawDeg: 228, distance: 1.45, height: 1.08, lookHeight: 1.12, fov: 34 });
    yield* z.say('Tarrik', 'I don’t know. But you’re still here.', { actor: z.player });

    // he rises and signals two soldiers to carry Varo between them
    z.player.visual?.stop();
    game.player.teleport(z.m('tarrikStand'), z.myaw('tarrikStand'));
    c.cut({ pos: z.P(10.2, 4.8, 1.9), look: z.P(5.2, 1.8, 0.95), fov: 46 });
    game.player.playScripted('point', { faceTo: at(z, a, 'soldierA') });
    walkTo(z, a, 'helpR', { run: true });
    walkTo(z, bb, 'helpL', { run: true });
    yield waitOr(z, () => z.skipping || (atPost(z, a, 'helpR', 0.6) && atPost(z, bb, 'helpL', 0.6)), 4);
    lyessa?.stopAction();
    malik?.stopAction();
    walkTo(z, malik, 'varoUp');
    walkTo(z, lyessa, 'lyessaUp');
    yield 1.2;
    c.shot(z.player.pos, { yawDeg: 95, distance: 2.6, height: 1.55, lookHeight: 1.55, fov: 36 });
    game.player.playScripted('idle', { faceTo: z.m('bendLook') });
    yield* z.say('Tarrik', 'Move.', { actor: z.player });

    // end state — identical watched or skipped
    setInfectionGrowth(1);
    setConsumed(1);
    showBlade(z, lyessa, false);
    if (isHumanoidVisual(tv)) tv.setHandTarget('L', null);
    z.player.visual?.stop();
    for (const [cm, mk] of [[malik, 'varoUp'], [lyessa, 'lyessaUp'], [a, 'helpR'], [bb, 'helpL']] as const) {
      if (cm && !atPost(z, cm, mk, 0.35)) {
        cm.stopAction();
        cm.teleport(z.m(mk), z.myaw(mk));
      }
    }
    z.setFlag('z02VaroCut', true);
  }, { blendOut: 0.6 });
  formUp(z);
}

/**
 * The squad on the move after the scene: Varo walks (hurt) behind the lead with a soldier at each side —
 * carried between them — and Lyessa follows. `holdHands` IK is refreshed by the zone's update.
 */
export function formUp(z: ZoneRuntime): void {
  const malik = z.cast('malik');
  const lyessa = z.cast('lyessa');
  const a = z.cast('soldierA');
  const bb = z.cast('soldierB');
  if (lyessa) {
    lyessa.mode = 'follow';
    lyessa.follow(z.player, { right: -1.6, back: 2.2 });
  }
  if (malik) {
    malik.mode = 'follow';
    malik.follow(z.player, { right: 0.4, back: 4.4 });
    malik.play('limp', { loop: true });
    malik.actor.loco = { ...(malik.actor.loco ?? {}), injured: true };
  }
  if (a && malik) {
    a.mode = 'follow';
    a.follow(malik.actor, { right: 0.62, back: 0.15 });
  }
  if (bb && malik) {
    bb.mode = 'follow';
    bb.follow(malik.actor, { right: -0.62, back: 0.15 });
  }
}

const _h = new THREE.Vector3();
/** ZoneDef.update helper: the two soldiers keep a hand on Varo's shoulders while they carry him */
export function holdHands(z: ZoneRuntime, on: boolean): void {
  const malik = z.cast('malik');
  const chest = malik?.actor.visual?.socket('chest');
  for (const [name, hand, side] of [['soldierA', 'L', 1], ['soldierB', 'R', -1]] as const) {
    const v = z.cast(name)?.actor.visual;
    if (!isHumanoidVisual(v)) continue;
    if (!on || !chest || !malik) {
      v.setHandTarget(hand, null);
      continue;
    }
    chest.getWorldPosition(_h);
    // toward this soldier's side of his back, at shoulder height
    const yaw = malik.actor.yaw;
    _h.x += Math.cos(yaw) * 0.16 * side + Math.sin(yaw) * 0.08;
    _h.z += -Math.sin(yaw) * 0.16 * side + Math.cos(yaw) * 0.08;
    _h.y += 0.16;
    v.setHandTarget(hand, _h, 0.85);
  }
}
