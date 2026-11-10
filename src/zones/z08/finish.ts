/**
 * Z08 `phaseB` — the finish (SCRIPT_SOURCE Z08 `phaseB`, steps 2–6; the author's ruling 9). Authored and always
 * the same whatever removed the organism's last health: Tarrik superheats the central armour, Selene flash-cools
 * it, the armour opens — a Dominion officer is alive inside it. “Kill me.” The player, as Tarrik, answers once
 * (`officerFate`, untimed, saved before and after). Either way Lyessa's round bursts the core.
 *
 * The officer is never shown before the armour breaks: his figure is created at the reveal. Afterwards what is
 * left of him stays where it fell (killed) or lies held in the frost, still part of the tissue (spared) until the
 * medics take him as he is (`quarantine`).
 */
import * as THREE from 'three';
import type { Actor, CharacterVisual, ChoiceOpts, CineCtx, Routine, ZoneRuntime } from '@/core/api';
import { asElite, isHumanoidVisual } from '@/core/api';
import { AMBER, FROST, VIOLET } from '../shared';
import { S } from './state';

/** the officer's choice panel (SCRIPT_SOURCE Z08 `phaseB`) — all new UI text */
export const OFFICER_CHOICE: ChoiceOpts = {
  id: 'officerFate',
  title: 'The officer', // NEW
  prompt: 'A Dominion officer is alive inside it. He asks to die.', // NEW
  options: [
    {
      id: 'killed', tag: 'KILL', label: 'Do what he asks', // NEW
      detail: 'Tarrik puts the blade through the center. The officer dies before the body that carries him falls.', // NEW
    },
    {
      id: 'spared', tag: 'SPARE', label: 'Refuse him', // NEW
      detail: 'Selene’s Frost holds him while the body around him is destroyed. The medics carry him out alive and still infected; no one can say what follows.', // NEW
    },
  ],
  note: 'This choice is explicit and untimed. The organism is destroyed either way. Your answer is recorded once.', // NEW
};

/** the speaker label of the officer's two words */
const OFFICER = 'Dominion Officer';
/** how far in front of the organism's chest socket his face is, his lean out of it, and his head height */
const OFFICER_OUT = 0.55;
const LEAN = -0.75;
const HEAD_H = 1.25;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function socketPos(a: Actor, name: string, out: THREE.Vector3): THREE.Vector3 {
  const s = a.visual?.socket(name);
  return s ? s.getWorldPosition(out) : a.aimPoint(out);
}

/** facing vector of an actor on the floor plane */
function fwd(a: Actor): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
}

// ---------------------------------------------------------------------------------------------------------------------
// The officer
// ---------------------------------------------------------------------------------------------------------------------

/** the group the officer's figure hangs in (its transform is the zone's; the figure's own root stays untouched) */
function holder(): THREE.Group | null {
  return (S.officerRig?.getObjectByName('officer-holder') as THREE.Group | undefined) ?? null;
}

/** the officer's figure inside a fresh rig (rig → holder → figure root), added to the zone */
function makeOfficer(z: ZoneRuntime): { rig: THREE.Group; hold: THREE.Group; fig: CharacterVisual } {
  // a bare face (the book: “his face protruding from the creature’s chest”) — the infantry models are helmeted —
  // with what is left of his Dominion plate on him: a bronze gorget and an oxblood breast plate
  const fig = z.game.chars.create('survivor', { seed: 8080 });
  const rig = new THREE.Group();
  rig.name = 'z08-officer';
  const hold = new THREE.Group();
  hold.name = 'officer-holder';
  rig.add(hold);
  hold.add(fig.root);
  z.builder.add(rig);
  if (isHumanoidVisual(fig)) fig.setLoadout({ melee: false, ranged: false, hideSheathed: true });
  const mats = z.game.mats;
  const plate = new THREE.Group();
  plate.name = 'officer-plate-dominion';
  const geos: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.088, 0.013, 6, 18, Math.PI * 1.3), new THREE.BoxGeometry(0.16, 0.12, 0.025)];
  const gorget = new THREE.Mesh(geos[0], mats.get('domBronze'));
  gorget.position.set(0, 0.2, -0.01);
  gorget.rotation.set(Math.PI / 2, 0, Math.PI * 0.8);
  plate.add(gorget);
  const crest = new THREE.Mesh(geos[1], mats.get('domOxblood'));
  crest.position.set(0, 0.04, -0.13);
  plate.add(crest);
  fig.socket('chest').add(plate);
  S.officer = fig;
  S.officerRig = rig;
  z.onDispose(() => {
    plate.removeFromParent();
    fig.dispose();
    for (const g of geos) g.dispose();
  });
  return { rig, hold, fig };
}

/**
 * The armour opens: the officer's head and shoulders lean out of the organism's chest, tissue round him, the
 * parted plates hinged aside, the core's violet light on his face. Static while the frost holds the body still.
 */
export function revealOfficer(z: ZoneRuntime): void {
  const elite = S.elite;
  if (S.officerRig || !elite) return;
  const mats = z.game.mats;
  const { rig, hold, fig } = makeOfficer(z);
  const chest = socketPos(elite, 'chest', _a);
  rig.position.copy(chest).addScaledVector(fwd(elite), OFFICER_OUT);
  rig.position.y -= 0.2;
  rig.rotation.y = elite.yaw;
  // leaning out of the chest (head at the rig's origin), the rest of him inside the body behind and below
  hold.rotation.set(LEAN, 0, 0);
  hold.position.set(0, -HEAD_H * Math.cos(LEAN), HEAD_H * Math.sin(-LEAN));
  fig.play('kneel', { loop: true });
  fig.setCorruption(0.35);
  if (isHumanoidVisual(fig)) fig.teleported();

  const geos: THREE.BufferGeometry[] = [];
  const tissue = mats.get('eclipseTissue');
  const plate = mats.get('eclipsePlate');
  const vein = mats.emissive(VIOLET, 2.4);
  // the parted armour: two narrow plates hinged back on either side of him
  for (const s of [-1, 1]) {
    const geo = new THREE.BoxGeometry(0.36, 0.78, 0.07);
    geos.push(geo);
    const m = new THREE.Mesh(geo, plate);
    m.name = 'officer-plate';
    m.position.set(s * 0.5, -0.25, 0.22);
    m.rotation.set(0.15, s * 1.15, s * 0.2);
    m.castShadow = true;
    rig.add(m);
  }
  // tissue that still holds him: strands from his shoulders and chest back into the body, a few lit veins
  const strands: Array<[number, number, number, boolean]> = [
    [-0.24, -0.12, 0.035, false], [0.23, -0.15, 0.035, false], [-0.16, -0.42, 0.04, false], [0.17, -0.45, 0.04, false],
    [0.0, -0.6, 0.045, false], [-0.3, -0.3, 0.013, true], [0.28, -0.34, 0.013, true], [0.02, -0.25, 0.03, false],
  ];
  for (const [x, y, r, lit] of strands) {
    const pts = [
      new THREE.Vector3(x * 0.7, y, -0.05),
      new THREE.Vector3(x * 1.25, y + 0.08, 0.18),
      new THREE.Vector3(x * 1.6, y - 0.06, 0.5),
    ];
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, r, 6, false);
    geos.push(geo);
    const m = new THREE.Mesh(geo, lit ? vein : tissue);
    m.name = 'officer-tissue';
    rig.add(m);
  }
  // the opened core lights him from below: the only light on his face is the thing that holds him
  if (S.officerGlow) {
    S.officerGlow.position.copy(rig.position).add(_b.set(0, -0.55, 0)).addScaledVector(fwd(elite), 0.35);
    S.officerGlow.intensity = 1.8;
  }
  z.onDispose(() => {
    for (const g of geos) g.dispose();
  });
}

/** ZoneDef.update: animate the officer figure (it is not an actor) */
export function updateOfficer(dt: number): void {
  S.officer?.update(dt);
}

/** after the body falls: what is left of him on the floor where it fell (killed), or held in the frost (spared) */
export function officerToFloor(z: ZoneRuntime, fate: 'killed' | 'spared'): void {
  const rig = S.officerRig;
  const hold = holder();
  const fig = S.officer;
  if (!rig || !hold || !fig) return;
  rig.position.copy(z.m('officerFell'));
  rig.rotation.set(0, z.myaw('officerFell'), 0);
  if (S.officerGlow) S.officerGlow.intensity = 0;
  for (const c of rig.children) {
    if (c.name === 'officer-plate') c.visible = false;
    if (c.name === 'officer-tissue') c.visible = fate === 'spared';
  }
  if (fate === 'killed') {
    // the death he asked for has already played: he lies where the body fell
    hold.rotation.set(0, 0, 0);
    hold.position.set(0, 0, 0);
    fig.setCorruption(0.8);
  } else {
    // lying on his back, still in the frost and the tissue that held him
    hold.rotation.set(Math.PI / 2, 0, 0);
    hold.position.set(0, 0.24, -0.85);
    fig.setFrozen(1);
  }
}

/** the medics take him as he is: onto the officer's litter, frost, tissue and all */
export function officerOntoLitter(litterGroup: THREE.Group): void {
  const rig = S.officerRig;
  if (!rig) return;
  litterGroup.add(rig);
  rig.position.set(0.05, 0.48, 0);
  rig.rotation.set(0, -Math.PI / 2, 0);
}

/** restore the officer as `quarantine` finds him (checkpoint / debug entry after the finish) */
export function restoreOfficer(z: ZoneRuntime, fate: 'killed' | 'spared'): void {
  if (S.officerRig) return;
  const { fig } = makeOfficer(z);
  if (fate === 'killed') {
    fig.play('death');
    fig.update(6);
  } else {
    fig.play('idle', { loop: true });
  }
  officerToFloor(z, fate);
}

// ---------------------------------------------------------------------------------------------------------------------
// The finish
// ---------------------------------------------------------------------------------------------------------------------

/** cut everyone to the finish: the organism held in the court, Tarrik before it, Selene beside, Lyessa with the angle */
export function placeFinish(z: ZoneRuntime): void {
  const game = z.game;
  const elite = S.elite;
  if (elite) {
    elite.fixed = true;
    elite.invulnerable = true;
    elite.pos.copy(z.m('eliteFinish'));
    elite.yaw = z.myaw('eliteFinish');
    const v = asElite(elite.visual);
    if (z.flag('z08Fractured') === true) v?.setFractured(true);
    v?.setRegenerating(0);
  }
  game.player.teleport(z.m('tarrikFinish'), z.myaw('tarrikFinish'));
  for (const [who, at] of [['selene', 'seleneFinish'], ['lyessa', 'lyessaFinish']] as const) {
    const c = z.cast(who);
    if (!c) continue;
    c.mode = 'scripted';
    c.stopAction();
    c.teleport(z.m(at), z.myaw(at));
    c.face(z.m('eliteFinish'));
  }
}

/** the finish scene: steps 2–6 of SCRIPT_SOURCE Z08 `phaseB` */
export function* finishScene(z: ZoneRuntime): Routine {
  const game = z.game;
  S.stage = 'finish';
  game.ui.eliteBar(null);
  game.player.setContextAction(null);
  game.audio.setMusic('resonance', 1);
  yield* z.cinematic('z08-finish', function* (c: CineCtx): Routine {
    const selene = z.cast('selene');
    const lyessa = z.cast('lyessa');
    placeFinish(z);
    const elite = S.elite;
    if (!elite) return;
    const tp = z.m('tarrikFinish');
    const ep = z.m('eliteFinish');
    const chest = socketPos(elite, 'chest', new THREE.Vector3());
    // “They attack together. Tarrik superheats the creature’s central armor, and Selene flash-cools it.”
    c.cut({ pos: z.P(28.6, 18.2, 1.3), look: { x: ep.x, y: 2.1, z: ep.z }, fov: 50 });
    game.player.playScripted('attackHeavy', { faceTo: chest });
    selene?.play('attackHeavy');
    if (!z.skipping) {
      game.vfx.spawn('cinderBurst', chest, { scale: 1.3 });
      game.audio.play('cinderIgnite', { pos: chest });
    }
    yield 0.5;
    if (!z.skipping) {
      game.vfx.spawn('frostBurst', chest, { scale: 1.3, color: FROST });
      game.audio.play('frostShatter', { pos: chest });
    }
    yield 0.45;
    // “The tissue fractures under the thermal shock.” The armour opens.
    if (!z.skipping) {
      game.vfx.spawn('thermalFracture', chest, { scale: 0.75 });
      game.time.slowMo(0.5, 0.6);
    }
    elite.visual?.play('stagger');
    yield 1.3;
    revealOfficer(z);
    // Selene's frost holds the organism still: nothing in the court moves from here to the end of the beat
    elite.visual?.setFrozen(0.9);
    selene?.play('aim', { loop: true });
    if (!z.skipping) game.vfx.spawn('frostArrest', chest);
    const face = S.officerRig ? S.officerRig.getWorldPosition(new THREE.Vector3()) : chest;
    const ef = fwd(elite);
    c.cut({ pos: { x: face.x + ef.x * 2.2 + ef.z * 0.5, y: face.y - 0.1, z: face.z + ef.z * 2.2 - ef.x * 0.5 }, look: { x: face.x, y: face.y - 0.12, z: face.z }, fov: 25 });
    c.dof(2.3, 0.6);
    yield 1.8;
    // “The man is still alive, his face protruding from the creature’s chest.”
    const tarrikEye = game.player.actor.aimPoint(_b);
    S.officer?.lookAt(tarrikEye);
    if (isHumanoidVisual(S.officer)) S.officer.setSpeaking(0.7);
    yield* z.say(OFFICER, 'Kill me.');
    if (isHumanoidVisual(S.officer)) S.officer.setSpeaking(0);
    c.dof(null);
    // Lyessa has the opening in her sights and does not fire. She looks at Tarrik — the decision is his.
    if (lyessa) {
      lyessa.play('aimRifle', { loop: true });
      c.shot(lyessa.actor.pos, { yawDeg: 300, distance: 2.4, height: 1.55, lookHeight: 1.5, fov: 34 });
      yield 1.4;
      lyessa.actor.visual?.lookAt(game.player.actor.aimPoint(_a));
      yield 1.5;
    }
    c.twoShot(face.clone().setY(0), tp, { side: 1, distance: 2.0, fov: 40 });
    yield 0.8;
    const pick = yield* z.choice(OFFICER_CHOICE);
    const fate = pick === 'spared' ? 'spared' : 'killed';
    z.setFlag('officerFate', fate);
    z.checkpoint('CP5b');
    lyessa?.actor.visual?.lookAt(null);
    if (fate === 'killed') {
      // “Tarrik does.” Velkorran enters the organism's center, and Cinder floods the blade.
      c.shot(tp, { yawDeg: 255, distance: 3.2, height: 1.4, lookHeight: 1.7, fov: 40 });
      game.player.playScripted('attackHeavy', { faceTo: face });
      yield 0.55;
      if (!z.skipping) {
        game.vfx.spawn('cinderBurst', face, { scale: 0.9 });
        game.audio.play('bladeHitFlesh', { pos: face });
      }
      // “Black tissue burns, and the officer dies before the body carrying him collapses.”
      S.officer?.setCorruption(1);
      S.officer?.lookAt(null);
      S.officer?.play('death');
      yield 1.6;
    } else {
      // Tarrik lowers the point. Selene's frost closes over the man and the tissue that holds him.
      c.shot(tp, { yawDeg: 220, distance: 3.4, height: 1.5, lookHeight: 1.6, fov: 42 });
      game.player.playScripted('lowerWeapon');
      yield 1.0;
      S.officer?.lookAt(null);
      S.officer?.setFrozen(1);
      if (!z.skipping) {
        game.vfx.spawn('frostArrest', face);
        game.audio.play('frostArrest', { pos: face });
      }
      yield 1.1;
      // Velkorran goes in beside the frost line, not through him; the armour parts around the held section
      const beside = face.clone().addScaledVector(new THREE.Vector3(ef.z, 0, -ef.x), 0.75);
      beside.y -= 0.35;
      game.player.playScripted('attackHeavy', { faceTo: beside });
      yield 0.55;
      if (!z.skipping) game.vfx.spawn('cinderBurst', beside, { scale: 0.8 });
      yield 1.0;
    }
    // “Lyessa fires into the opening, bursting the core.”
    if (lyessa) {
      const lp = lyessa.actor.pos;
      c.cut({ pos: { x: lp.x + 0.6, y: 1.75, z: lp.z + 1.6 }, look: chest, fov: 40 });
      lyessa.actor.face(chest);
      yield 0.5;
      lyessa.play('shoot');
      if (!z.skipping) {
        const muzzle = socketPos(lyessa.actor, 'muzzle', new THREE.Vector3());
        game.vfx.spawn('muzzleWarm', muzzle, { dir: _a.copy(chest).sub(muzzle).normalize() });
        game.vfx.beam(muzzle, chest, 'laser', { color: AMBER, width: 0.03 }).remove(0.25);
        game.audio.play('cinderlineShot', { pos: muzzle, pitch: 1.2 });
      }
      yield 0.12;
    }
    if (!z.skipping) {
      game.vfx.spawn('violetBurst', chest, { scale: 1.6 });
      game.vfx.spawn('explosionSmall', chest, { color: VIOLET });
    }
    killElite(z, lyessa ? lyessa.actor : null);
    yield 0.6;
    // Lyessa lowers the rifle while the body goes down behind the camera
    if (lyessa) {
      c.shot(lyessa.actor.pos, { yawDeg: 315, distance: 2.3, height: 1.55, lookHeight: 1.5, fov: 34 });
      lyessa.play('lowerWeapon');
      yield 2.2;
    }
    // what is left of the officer stays where it fell
    c.cut({ pos: z.P(31, 16.6, 2.2), look: { x: ep.x, y: 0.6, z: ep.z }, fov: 44 });
    officerToFloor(z, fate);
    yield 2.6;
    // end state — identical watched or skipped
    S.stage = 'done';
    game.player.actor.visual?.lookAt(null);
  });
  S.stage = 'done';
  game.ui.eliteBar(null);
}

/** Lyessa's round: the organism dies (in both outcomes, whatever did the work before) */
export function killElite(z: ZoneRuntime, by: Actor | null): void {
  const elite = S.elite;
  if (!elite || !elite.alive) return;
  elite.invulnerable = false;
  elite.visual?.setFrozen(0);
  z.game.actors.kill(elite, by);
}

