/**
 * Z09 — the two authored scenes (SCRIPT_SOURCE Z09 `overlook`, `recognition`) and the two relics.
 *
 * The author's lines are exact (curly apostrophes are the book's). The lines marked *(ext — trimmed)* are not
 * played. The terminal is text only: its three lines appear on the status board, never as a voice. The door
 * prints nothing; Neon Veil and Caerion II rise from the armour by themselves and are never keys — nobody inserts
 * or touches anything, and the door opens before either relic reaches it.
 */
import * as THREE from 'three';
import type { CineCtx, Routine, ZoneRuntime } from '@/core/api';
import { atPost, waitOr, walkTo } from '../shared';
import { LOW, OVERLOOK, THRESHOLD } from './space';

// =====================================================================================================================
// Relics — Neon Veil (Tarrik) and Caerion II (Selene): medallion-sized, rise from the armour and hover
// =====================================================================================================================

export interface Relics {
  tarrik: THREE.Group | null;
  selene: THREE.Group | null;
  /** 0 = in the armour (hidden), 1 = risen and hovering */
  k: number;
  target: number;
  geos: THREE.BufferGeometry[];
}

export function blankRelics(): Relics {
  return { tarrik: null, selene: null, k: 0, target: 0, geos: [] };
}

/** black-gold, five points round a white core (STORY.md · Terms) */
function makeRelic(z: ZoneRuntime, R: Relics, name: string): THREE.Group {
  const mats = z.game.mats;
  const g = new THREE.Group();
  g.name = name;
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.085 : 0.034;
    const x = Math.sin(a) * r;
    const y = Math.cos(a) * r;
    if (i === 0) star.moveTo(x, y);
    else star.lineTo(x, y);
  }
  star.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.022, 0, Math.PI * 2, true);
  star.holes.push(hole);
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1 });
  sg.translate(0, 0, -0.006);
  const rim = new THREE.TorusGeometry(0.052, 0.0035, 6, 40);
  const core = new THREE.SphereGeometry(0.019, 16, 12);
  R.geos.push(sg, rim, core);
  g.add(new THREE.Mesh(sg, mats.get('goldDark')));
  g.add(new THREE.Mesh(rim, mats.get('goldTrim')));
  g.add(new THREE.Mesh(core, mats.emissive(0xfff4e0, 6)));
  g.visible = false;
  z.builder.add(g);
  return g;
}

export function ensureRelics(z: ZoneRuntime, R: Relics): void {
  if (!R.tarrik) R.tarrik = makeRelic(z, R, 'relic-neonVeil');
  if (!R.selene) R.selene = makeRelic(z, R, 'relic-caerionII');
}

const V = new THREE.Vector3();
const F = new THREE.Vector3();

/** ZoneDef.update: ease the relics toward their target and keep them in front of each bearer's chest */
export function updateRelics(z: ZoneRuntime, R: Relics, dt: number): void {
  R.k = z.skipping ? R.target : R.k + Math.sign(R.target - R.k) * Math.min(Math.abs(R.target - R.k), dt / 2.2);
  const ease = R.k * R.k * (3 - 2 * R.k);
  const selene = z.cast('selene');
  const pairs: Array<[THREE.Group | null, THREE.Object3D | null | undefined, number]> = [
    [R.tarrik, z.player?.visual?.socket('chest'), z.player?.yaw ?? 0],
    [R.selene, selene?.actor.visual?.socket('chest'), selene?.actor.yaw ?? 0],
  ];
  for (const [relic, chest, yaw] of pairs) {
    if (!relic) continue;
    relic.visible = R.k > 0.02 && !!chest;
    if (!relic.visible || !chest) continue;
    chest.getWorldPosition(V);
    F.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    relic.position.copy(V).addScaledVector(F, 0.18 + 0.32 * ease);
    relic.position.y += 0.34 * ease + Math.sin(z.time * 1.7) * 0.012 * ease;
    relic.rotation.set(0, yaw + z.time * 0.35 * ease, 0);
    relic.scale.setScalar(0.4 + 0.6 * ease);
  }
}

export function disposeRelics(R: Relics): void {
  for (const g of [R.tarrik, R.selene]) g?.removeFromParent();
  for (const geo of R.geos) geo.dispose();
}

// =====================================================================================================================
// `overlook`
// =====================================================================================================================

/** the painting's framing (plan x, n, height above the low floor): from behind the pair along the parapet */
const RAIL_CAM = { pos: [28.0, 7.2, 1.75], to: [28.5, 8.0, 1.75], look: [34.5, 40, 5.0], fov: 60 } as const;

/**
 * “The Crownmark.” — Selene stops at the edge of the circular gallery and looks back along the path they have
 * taken; the camera finds what she sees: they have been walking along one arm of a Crownmark large enough to
 * contain cities, and the Wound fills half the horizon. Far within it, violet moves; Tarrik's hand closes on
 * his blade, and Selene notices.
 */
export function* overlookScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const sky = game.sky;
  const selene = z.cast('selene');
  yield* z.cinematic('z09-overlook', function* (c: CineCtx): Routine {
    // the score of the reveal: a giant slow heartbeat under a low drone (wound_vista loops its full section)
    game.audio.setMusic('woundVista', 2);
    selene?.stopAction();
    walkTo(z, selene, 'seleneRail');
    game.player.teleport(z.m('tarrikRail').setZ(z.m('tarrikRail').z + 2.2), z.myaw('tarrikRail'));
    // the reveal: behind and to the right of the pair, the parapet on the left, the arm running out under it to
    // the Wound; the red remnant on the left, the hard white one on the right (the concept painting)
    // (polish 4: 1.8 m further west than before, so the pale buttresses beyond the parapet on the north-east stay out
    // of this frame and off the Wound)
    c.cut({ pos: z.P(OVERLOOK.x + 2.6, OVERLOOK.n - 3.0, LOW + 1.7), look: z.P(OVERLOOK.x - 9, OVERLOOK.n + 30, LOW + 8.5), fov: 58 });
    c.moveAsync({ pos: z.P(OVERLOOK.x + 1.8, OVERLOOK.n - 1.8, LOW + 1.75), look: z.P(OVERLOOK.x - 8, OVERLOOK.n + 30, LOW + 9.5), fov: 56 }, 7, 'inOut');
    yield waitOr(z, () => z.skipping || atPost(z, selene, 'seleneRail'), 6);
    yield 1.2;
    // she looks back along the path; the line lands on her
    selene?.face(z.P(OVERLOOK.x - 14, OVERLOOK.n - 6, LOW + 1.5));
    const s = selene ? selene.actor.pos.clone() : z.m('seleneRail');
    c.shot(s, { yawDeg: 200, distance: 2.6, height: 1.55, lookHeight: 1.55, fov: 36 });
    yield 0.6;
    yield* z.say('Selene', 'The Crownmark.', { actor: selene });
    game.player.playScripted('idle', { faceTo: z.m('overlookLook') });
    c.twoShot(z.player.pos, s, { side: -1, distance: 2.0, fov: 36 });
    yield* z.say('Tarrik', 'Subtle.', { actor: z.player });
    c.twoShot(s, z.player.pos, { side: 1, distance: 2.0, fov: 36 });
    yield* z.say('Selene', 'I suspect subtlety was not among the design requirements.', { actor: selene });

    // “They are walking along one arm of a Crownmark large enough to contain cities.” — the long view, framed as the
    // wound-overlook painting: along the parapet at eye level, the Wound over the canyon city, the white remnant
    // right, the two of them small at the rail (the rail-framing camera; it replaces a view tilted up at the sky)
    selene?.face(z.m('overlookLook'));
    c.cut({ pos: z.P(RAIL_CAM.pos[0], RAIL_CAM.pos[1], LOW + RAIL_CAM.pos[2]), look: z.P(RAIL_CAM.look[0], RAIL_CAM.look[1], LOW + RAIL_CAM.look[2]), fov: RAIL_CAM.fov });
    c.moveAsync({ pos: z.P(RAIL_CAM.to[0], RAIL_CAM.to[1], LOW + RAIL_CAM.to[2]), look: z.P(RAIL_CAM.look[0], RAIL_CAM.look[1], LOW + RAIL_CAM.look[2] + 0.5), fov: RAIL_CAM.fov - 2 }, 7.5, 'inOut');
    // “Far within it, violet light moves. Something enormous shifts behind layers of folded space, then disappears.”
    if (!z.skipping) sky.setWoundActivity(0.95);
    yield 4.2;
    sky.setWoundActivity(0.3, { snap: z.skipping });
    yield 2.4;
    // “Tarrik’s hand closes around Velkorran. Selene notices.”
    const hand = z.player.visual?.socket('handR');
    const hp = hand ? hand.getWorldPosition(new THREE.Vector3()) : z.player.pos.clone().setY(z.player.pos.y + 1);
    c.cut({ pos: hp.clone().add(new THREE.Vector3(0.55, 0.12, 0.75)), look: hp, fov: 30 });
    game.player.playScripted('raiseWeapon');
    yield 1.6;
    selene?.face(z.player.pos);
    c.shot(s, { yawDeg: 160, distance: 2.2, height: 1.6, lookHeight: 1.6, fov: 32 });
    yield 2.2;
    // end state — identical watched or skipped
    sky.setWoundActivity(0.3, { snap: z.skipping });
    selene?.face(null);
    if (selene) {
      selene.teleport(z.m('seleneRail'), z.myaw('seleneRail'));
      selene.mode = 'follow';
    }
  });
}

// =====================================================================================================================
// `recognition`
// =====================================================================================================================

/** the terminal's three lines (SCRIPT_SOURCE Z09 — exact; text only) */
const SYS_1 = 'BEARER CONTINUITY DETECTED';
const SYS_2 = 'SECONDARY CONTINUITY DETECTED';
const SYS_3 = 'CONTRARY WITNESS CONFIRMED';

export interface RecognitionHooks {
  /** fill the depressions and open the channels (the threshold prop's `recognized`) */
  recognize(): void;
  openDoor(): void;
  relics: Relics;
}

export function* recognitionScene(z: ZoneRuntime, h: RecognitionHooks): Routine {
  const game = z.game;
  const ui = game.ui;
  const selene = z.cast('selene');
  const board = (n: number): void => {
    const rows = [SYS_1, SYS_2, SYS_3].slice(0, n).map((label) => ({ label, value: '' }));
    ui.statusBoard(rows);
  };
  yield* z.cinematic('z09-recognition', function* (c: CineCtx): Routine {
    ensureRelics(z, h.relics);
    // “a door without controls or a visible seam. Five shallow depressions surround a single white point.”
    game.player.teleport(z.m('thresholdApproach'), z.myaw('thresholdApproach'));
    selene?.stopAction();
    if (selene) selene.teleport(z.m('seleneBeside').setX(z.m('seleneBeside').x - 2.2), z.myaw('seleneBeside'));
    const centre = z.m('thresholdCenter');
    c.cut({ pos: z.P(THRESHOLD.x - 6.4, THRESHOLD.n - 1.9, LOW + 1.6), look: z.P(THRESHOLD.x + 4.6, THRESHOLD.n, LOW + 2.6), fov: 46 });
    c.moveAsync({ pos: z.P(THRESHOLD.x - 5.2, THRESHOLD.n - 1.6, LOW + 1.5), look: z.P(THRESHOLD.x + 4.6, THRESHOLD.n, LOW + 2.4), fov: 44 }, 6, 'inOut');
    yield 1.6;
    board(1); // “Tarrik stops.”
    game.player.playScripted('idle', { faceTo: centre });
    yield 2.2;
    board(2); // “Selene steps beside him.”
    walkTo(z, selene, 'seleneBeside');
    yield waitOr(z, () => z.skipping || atPost(z, selene, 'seleneBeside'), 3.5);
    // “The interface pauses, not malfunctioning but considering.”
    c.cut({ pos: z.P(THRESHOLD.x - 0.6, THRESHOLD.n - 3.6, LOW + 0.55), look: z.P(THRESHOLD.x - 1.2, THRESHOLD.n + 0.4, LOW + 0.1), fov: 40 });
    yield 2.0;
    board(3);
    z.story('contraryRecognized');
    h.recognize();
    if (!z.skipping) {
      game.vfx.spawn('goldRecognition', centre);
      game.audio.play('recognitionTone', { pos: centre });
    }
    game.audio.setMusic('recognition', 2.5);
    yield 3.2;
    // the board steps back for the exchange; they turn to each other
    ui.statusBoard(null);
    const t = z.player.pos.clone();
    const s = selene ? selene.actor.pos.clone() : z.m('seleneBeside');
    selene?.face(t);
    game.player.playScripted('idle', { faceTo: s });
    c.twoShot(s, t, { side: 1, distance: 1.9, fov: 36 });
    yield* z.say('Selene', 'Contrary.', { actor: selene });
    c.twoShot(t, s, { side: -1, distance: 1.9, fov: 36 });
    yield* z.say('Tarrik', 'I noticed.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 1.9, fov: 36 });
    yield* z.say('Selene', 'I’m trying to determine whether it means ideological opposition,', { actor: selene });
    yield* z.say('Selene', 'incompatible bearer signatures, or independent Continuity lineage.', { actor: selene });
    c.twoShot(t, s, { side: -1, distance: 1.9, fov: 36 });
    yield* z.say('Tarrik', 'That sounded more like Tharne than you.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 1.9, fov: 36 });
    yield* z.say('Selene', 'He is contagious.', { actor: selene });

    // “Neon Veil rises from Tarrik’s armor. Caerion II lifts from Selene’s. Before either relic touches the door, it opens.”
    const mid = t.clone().lerp(s, 0.5);
    // from the side (the door's side): both chests and the space between them
    c.cut({ pos: mid.clone().add(new THREE.Vector3(2.7, 1.3, 0.2)), look: mid.clone().setY(mid.y + 1.55), fov: 44 });
    h.relics.target = 1;
    if (!z.skipping) game.audio.play('meridianAlign', { pos: mid, volume: 0.55 });
    yield 2.4;
    selene?.face(z.m('doorFront'));
    game.player.playScripted('idle', { faceTo: z.m('doorFront') });
    c.cut({ pos: z.P(THRESHOLD.x - 4.6, THRESHOLD.n + 0.2, LOW + 1.3), look: z.P(THRESHOLD.x + 4.6, THRESHOLD.n, LOW + 2.2), fov: 44 });
    h.openDoor();
    yield 2.6;

    selene?.face(t);
    game.player.playScripted('idle', { faceTo: s });
    c.twoShot(t, s, { side: -1, distance: 2.0, fov: 36 });
    yield* z.say('Tarrik', 'I assume that means we keep going.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 2.0, fov: 36 });
    yield* z.say('Selene', 'I assume it means the system expects us to.', { actor: selene });
    c.twoShot(t, s, { side: -1, distance: 2.0, fov: 36 });
    yield* z.say('Tarrik', 'That isn’t the same thing.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 2.0, fov: 36 });
    yield* z.say('Selene', 'No.', { actor: selene });
    h.relics.target = 0;
    c.twoShot(t, s, { side: -1, distance: 2.0, fov: 36 });
    yield* z.say('Tarrik', 'You first.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 2.0, fov: 36 });
    yield* z.say('Selene', 'How generous.', { actor: selene });
    c.twoShot(t, s, { side: -1, distance: 2.0, fov: 36 });
    yield* z.say('Tarrik', 'I want to know what happens.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 2.0, fov: 36 });
    yield* z.say('Selene', 'If I explode?', { actor: selene });
    c.twoShot(t, s, { side: -1, distance: 2.0, fov: 36 });
    yield* z.say('Tarrik', 'Then I reconsider.', { actor: z.player });
    // “Selene steps forward, and Tarrik follows.” — she goes through first
    selene?.face(null);
    c.shot(s, { yawDeg: 250, distance: 3.4, height: 1.5, lookHeight: 1.4, fov: 38 });
    walkTo(z, selene, 'seleneBeyond');
    yield 2.6;
    // end state — identical watched or skipped
    h.relics.target = 0;
    ui.statusBoard(null);
    selene?.face(null);
    if (selene && z.skipping) selene.teleport(z.m('seleneBeyond'), z.myaw('seleneBeyond'));
  });
}
