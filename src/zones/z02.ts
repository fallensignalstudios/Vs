/**
 * Z02 · Survivor bend — lead: Tarrik. The Varo scene, the bend (Cross on the comm, the sealed partition, the
 * optional casualty log O1), and the motivated cut to Selene's approach.
 *
 *   constants → build (shell, alcove + partition, loop, doorway, dressing, light, markers, scenic) → cast → beats
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north): a 30 × 18 m white-gold L. The
 * squad enters from Z01 at the west end of the SOUTH LEG (n 0 … 7.6) and walks east to the BEND, then north up
 * the NORTH LEG (x 22 … 30) to the far doorway (north wall, x = 26.5), which frames the circular atrium beyond
 * a white-gold threshold that holds. Inside the L lies the CASUALTY ALCOVE (x 4 … 22, n 7.6 … 14.4), sealed
 * behind transparent partitions: Dominion soldiers and Reformation marines together. The optional SIDE LOOP
 * runs round the alcove's far side (west passage, then north passage) past the casualty-log relay and rejoins
 * the north leg beyond the bend. The King-era conduit that carried the growth in Z01 runs on along the
 * partition's base; dark tissue lies along it at the alcove (no violet: violet only at Varo's arm).
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z02. The author's lines are exact; every new line / UI string is tagged `// NEW`.
 * FILES: ./z02/varo.ts (`stabilize`), ./z02/infection.ts (the arm), ./z02/o1.ts (the casualty log).
 */
import * as THREE from 'three';
import type { Beat, CineCtx, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { AMBER, FACE, IVORY, atPost, waitOr, walkTo } from './shared';
import { resetInfection, setConsumed, setInfectionGrowth, attachInfection, amputate, updateInfection } from './z02/infection';
import { buildLog, disposeLog, o1, o1Running, resetO1 } from './z02/o1';
import { formUp, holdHands, resetVaro, varoScene } from './z02/varo';

// =====================================================================================================================
// Constants
// =====================================================================================================================

/** playable envelope (plan §Z02: 30 × 18 m) */
const W = 30;
const D = 18;
const WALL_H = 8.5;
const RIB_H = 11;
/** entry from Z01 (west wall) and the far doorway (north wall) */
const ENTRY_N = 3.5;
const EXIT_X = 26.5;
/** the sealed casualty alcove inside the L */
const ALC_X0 = 4;
const ALC_X1 = 22;
const ALC_N0 = 7.6;
const ALC_N1 = 14.4;
const GLASS_H = 3.4;
const ALC_H = 5.4;
/** the casualty-log relay in the side loop's north passage */
const LOG_X = 13;
const LOG_N = 15.3;
/** the lead reaching this point of the north leg ends the walk (the cut begins once the call is over) */
const CUT_AT: [number, number] = [EXIT_X, 13.5];

// =====================================================================================================================
// Per-load state
// =====================================================================================================================

interface Z02 {
  callDone: boolean;
  carry: boolean;
  veil: THREE.PointLight | null;
}
let S: Z02 = blank();
function blank(): Z02 {
  return { callDone: false, carry: false, veil: null };
}

// =====================================================================================================================
// Build
// =====================================================================================================================

function build(b: ZoneBuilder): void {
  S = blank();
  resetInfection();
  resetO1();
  resetVaro();
  b.game.sky.setHeading(0);
  b.setEnv({
    sky: 'crashRib', look: LOOKS.survivorBend, ambience: 'survivorBend', music: 'approachTarrik',
    key: { dirFrom: [12, -6, 30], intensity: 1.3, color: 0xffe8d0 },
  });
  buildShell(b);
  buildAlcove(b);
  buildLoop(b);
  buildDoorway(b);
  buildDressing(b);
  buildLight(b);
  buildMarkers(b);
  buildScenic(b);
  b.finalize();
}

/** floor, outer walls with the entry and the far doorway, ribs over both legs, the vault */
function buildShell(b: ZoneBuilder): void {
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, inlay: 'channels', reflective: true });
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'panelled', doors: [{ at: ENTRY_N, width: 3, height: 3.5 }] });
  b.door({ x: 0, n: ENTRY_N, yawDeg: FACE.east }).setState('sealed');
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'ribbed' });
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'ribbed' });
  b.wall({ from: [0, D], to: [W, D], height: WALL_H, style: 'conduit', doors: [{ at: EXIT_X, width: 3, height: 3.5 }] });
  // ribs across the south leg (marching east) and across the north leg (marching north)
  b.ribRow({ x: 3.5, n: ALC_N0 / 2, span: ALC_N0 + 0.4, height: RIB_H, count: 4, spacing: 6, yawDeg: FACE.east, alongDeg: FACE.east });
  b.ribRow({ x: (ALC_X1 + W) / 2, n: 3.6, span: W - ALC_X1 + 0.4, height: RIB_H, count: 3, spacing: 6 });
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: RIB_H + 0.3, style: 'vault' });
}

/** the sealed alcove: transparent partitions on both long sides, solid ends, its own low ceiling */
function buildAlcove(b: ZoneBuilder): void {
  for (const n of [ALC_N0, ALC_N1]) {
    b.wall({ from: [ALC_X0, n], to: [ALC_X1, n], height: GLASS_H, style: 'glass', thickness: 0.2 });
    b.wall({ from: [ALC_X0, n], to: [ALC_X1, n], h: GLASS_H, height: ALC_H - GLASS_H, style: 'panelled', thickness: 0.5 });
  }
  b.wall({ from: [ALC_X0, ALC_N0], to: [ALC_X0, ALC_N1], height: ALC_H, style: 'panelled' });
  b.wall({ from: [ALC_X1, ALC_N0], to: [ALC_X1, ALC_N1], height: ALC_H, style: 'panelled' });
  b.ceiling({ x: (ALC_X0 + ALC_X1) / 2, n: (ALC_N0 + ALC_N1) / 2, w: ALC_X1 - ALC_X0, d: ALC_N1 - ALC_N0, h: ALC_H, style: 'flat' });
  // the mullions of the partition: a slim gold frame every 4.5 m
  for (let x = ALC_X0 + 4.5; x < ALC_X1 - 1; x += 4.5) {
    for (const n of [ALC_N0, ALC_N1]) b.column({ x, n, r: 0.12, height: GLASS_H, style: 'faceted' });
  }
  // inside: stretchers, a kit, the dead under tarps
  b.prop('refStretcher', { x: 14.2, n: 12.6, yawDeg: 90 });
  b.prop('domStretcher', { x: 9.6, n: 12.5, yawDeg: 85 });
  b.prop('casualtyTarp', { x: 6.4, n: 12.4, yawDeg: 80 });
  b.prop('casualtyTarp', { x: 20.2, n: 9.4, yawDeg: 100 });
  b.prop('casualtyTarp', { x: 17.6, n: 13.2, yawDeg: 70 });
  b.prop('medKit', { x: 12.0, n: 9.0, yawDeg: 20 });
  b.prop('refCrate', { x: 21.0, n: 13.4, yawDeg: 10, variant: 1 });
  b.prop('domAmmoCase', { x: 5.2, n: 8.6, yawDeg: 40 });
  // the conduit from Z01 runs on along the partition's base; dark tissue lies along it at the alcove
  b.conduit([[0.6, ALC_N0 - 0.35, 0.3], [ALC_X1 + 0.6, ALC_N0 - 0.35, 0.3]], { r: 0.09, glow: false });
  b.blocker({ x: (ALC_X0 + ALC_X1) / 2, n: ALC_N0 - 0.45, w: ALC_X1 - ALC_X0, d: 0.5, height: 0.6 });
  const tissue = b.mats.get('eclipseTissue');
  const geo = new THREE.SphereGeometry(1, 12, 8);
  const strip = new THREE.Group();
  strip.name = 'z02-conduit-tissue';
  let seed = 11;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let x = 6.5; x < 15.5; x += 0.32 + rnd() * 0.25) {
    const m = new THREE.Mesh(geo, tissue);
    const r = 0.07 + rnd() * 0.08 * (1 - Math.abs(x - 11) / 6);
    m.position.copy(b.P(x, ALC_N0 - 0.35 + (rnd() - 0.5) * 0.12, 0.3 + (rnd() - 0.4) * 0.1));
    m.scale.set(r * (1.6 + rnd()), r * 0.7, r * 1.1);
    strip.add(m);
  }
  b.add(strip);
}

/** the side loop round the alcove's far side, and the casualty-log relay in it */
function buildLoop(b: ZoneBuilder): void {
  // the loop's mouth is half closed by a fallen plate: an option, not the way
  b.prop('fallenPlate', { x: 3.3, n: ALC_N0 + 0.6, yawDeg: 15, scale: 1.1 });
  b.prop('rubblePile', { x: 0.9, n: 12.0, scale: 0.8 });
  b.prop('debrisSmall', { x: 2.2, n: 16.4, yawDeg: 60 });
  b.prop('domFieldCache', { x: LOG_X, n: LOG_N - 0.35, yawDeg: 0 });
  b.prop('domLamp', { x: LOG_X - 1.6, n: LOG_N - 0.2, yawDeg: 20 });
  buildLog(b, LOG_X, LOG_N, FACE.north);
}

/** the far doorway: frame, the threshold that holds, the white point; a ledge beyond over the atrium */
function buildDoorway(b: ZoneBuilder): void {
  b.door({ x: EXIT_X, n: D, frameOnly: true }).setState('sealed');
  b.barrier({ from: [EXIT_X - 1.5, D + 0.1], to: [EXIT_X + 1.5, D + 0.1], height: 3.5, active: true });
  b.whitePoint({ x: EXIT_X, n: D - 0.9, h: 5.3, intensity: 1.8 });
  b.column({ x: EXIT_X - 3.2, n: D - 0.9, height: 7.5, style: 'pylon', lit: true });
  b.column({ x: EXIT_X + 3.2, n: D - 0.9, height: 7.5, style: 'pylon', lit: true });
  b.floor({ x: EXIT_X, n: D + 4, w: 5, d: 8, inlay: 'channels', noSurface: true });
  b.rail({ from: [EXIT_X - 2.5, D + 0.4], to: [EXIT_X - 2.5, D + 8], style: 'ancient' });
  b.rail({ from: [EXIT_X + 2.5, D + 0.4], to: [EXIT_X + 2.5, D + 8], style: 'ancient' });
  // the gold channel runs from the bend to the threshold: the way on
  b.channel([[25.4, 1.2], [25.4, 4.6], [EXIT_X, 6.2], [EXIT_X, D - 1.4]], { width: 0.07, intensity: 2 });
}

/** the squad's medical stop at the entry; ancient furniture; debris at the bend */
function buildDressing(b: ZoneBuilder): void {
  b.prop('domLamp', { x: 2.4, n: 0.9, yawDeg: 40 });
  b.prop('medKit', { x: 3.4, n: 0.8, yawDeg: 10 });
  b.prop('domCrate', { x: 8.6, n: 0.9, yawDeg: -6, variant: 1 });
  b.prop('ancientBench', { x: 16.5, n: 0.9 });
  b.prop('ancientPylon', { x: 21.2, n: 0.9 });
  b.prop('rubblePile', { x: 29.0, n: 1.1, scale: 0.8, yawDeg: 30 });
  b.prop('debrisSmall', { x: 23.6, n: 6.6, yawDeg: 70 });
  b.prop('fallenPlate', { x: 29.0, n: 9.8, yawDeg: 270, scale: 0.9 });
  b.prop('cableBundle', { x: 28.6, n: 14.6, yawDeg: 0 });
}

/** muted, low-key: warm practicals, a cold sealed room, the bright threshold (about a dozen lights) */
function buildLight(b: ZoneBuilder): void {
  b.point({ x: 4.6, n: 2.6, h: 2.3, color: AMBER, intensity: 16, distance: 9, flicker: 0.06 });
  b.panelLight({ x: 11.5, n: 3.8, w: 3, d: 1.2, h: RIB_H - 0.2, facing: 'down', intensity: 1.1, color: 0xffe2c0 });
  b.panelLight({ x: 26, n: 3.8, w: 3, d: 1.2, h: RIB_H - 0.2, facing: 'down', intensity: 1.2, color: 0xffe2c0 });
  // the sealed room: cold, still, enough to read the figures through the glass
  b.point({ x: 9.5, n: 11, h: 4.2, color: 0xc4d2e6, intensity: 16, distance: 10 });
  b.point({ x: 17, n: 11, h: 4.2, color: 0xc4d2e6, intensity: 14, distance: 10 });
  // the far doorway: the atrium's light pours in
  b.spot({ x: EXIT_X, n: D + 3, h: 4.5, target: [EXIT_X, D - 6, 0], angleDeg: 38, intensity: 420, color: 0xfff1dc, shaft: true });
}

function buildMarkers(b: ZoneBuilder): void {
  // --- stabilize ---
  b.marker('start', 2.0, ENTRY_N, 0, FACE.east);
  b.marker('lyessaStart', 2.4, 1.9, 0, FACE.east);
  b.marker('varo', 5.2, 1.0, 0, FACE.north);
  b.marker('lyessaKneel', 4.35, 1.45, 0, FACE.east);
  b.marker('tarrikStand', 5.95, 1.65, 0, 235);
  b.marker('tarrikKneel', 6.0, 1.4, 0, FACE.west);
  b.marker('limb', 4.6, 0.62, 0, 20);
  b.marker('soldierA', 7.6, 3.9, 0, 230);
  b.marker('soldierB', 2.9, 4.4, 0, 140);
  b.marker('helpR', 5.95, 2.0, 0, 250);
  b.marker('helpL', 4.4, 2.05, 0, 110);
  b.marker('varoUp', 5.2, 2.2, 0, FACE.east);
  b.marker('lyessaUp', 3.4, 3.2, 0, FACE.east);
  b.marker('bendLook', 26, 4);
  // --- the bend ---
  b.marker('bendStart', 7.6, 4.2, 0, FACE.east);
  b.marker('cutAt', CUT_AT[0], CUT_AT[1], 0, FACE.north);
  // --- O1 ---
  b.marker('o1Log', LOG_X, LOG_N + 1.1, 0, FACE.south);
  b.marker('o1Tarrik', LOG_X, LOG_N + 1.9, 0, FACE.south);
  b.marker('o1Lyessa', LOG_X + 1.9, LOG_N + 2.1, 0, 225);
  // --- the cut ---
  b.marker('cutTarrik', EXIT_X, D - 2.2, 0, FACE.north);
  b.marker('lyessaCut', EXIT_X - 2.3, D - 4.4, 0, 20);
  b.marker('varoCut', EXIT_X + 1.6, D - 5.4, 0, FACE.north);
  b.marker('exit', EXIT_X, D - 1.4, 0, FACE.north);
  // --- the casualties behind the glass ---
  b.marker('cas0', 8.4, 10.2, 0, FACE.east);
  b.marker('cas1', 11.4, 13.2, 0, FACE.south);
  b.marker('cas2', 15.8, 9.0, 0, FACE.north);
  b.marker('cas3', 18.6, 11.6, 0, FACE.west);
}

/** the circular atrium beyond the far doorway (Z05's shell, glimpsed), haze and motes */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const shell = game.sky.scenic.atriumShell({ radius: 130, height: 150, shaftRadius: 70, tiers: 4, seed: 5 });
  shell.position.copy(b.P(EXIT_X, D + 118, -24));
  b.add(shell);
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 3), { x: W, y: 6, z: D }, 0.5);
  game.vfx.ambient('goldMotes', b.P(EXIT_X, D - 3, 3), { x: 7, y: 5, z: 7 }, 0.3);
}

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'stabilize' | 'bend' | 'cut';

/**
 * Lead, Lyessa, Varo (the soldier named in this zone), the two soldiers who carry him, and the casualties behind
 * the partition. After `stabilize` the arm is gone, and the squad walks as `formUp` arranges it.
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const after = stage !== 'stabilize';
  z.spawnPlayer('tarrik', after ? (stage === 'cut' ? 'cutAt' : 'bendStart') : 'start');
  const lyessa = z.companion('lyessa', after ? 'lyessaUp' : 'lyessaStart', 'hold');
  lyessa.holdAt(z.m(after ? 'lyessaUp' : 'lyessaStart'), z.myaw('lyessaStart'));
  const malik = z.npc('dominionSoldier', after ? 'varoUp' : 'varo', after ? 'idle' : 'sitInjured', 'malik');
  z.npc('dominionSoldier', after ? 'helpR' : 'soldierA', 'idle', 'soldierA');
  z.npc('dominionSoldier', after ? 'helpL' : 'soldierB', 'idle', 'soldierB');
  z.npc('dominionSoldier', 'cas0', 'lieInjured', 'cas0');
  z.npc('reformationMarine', 'cas1', 'sitInjured', 'cas1');
  z.npc('reformationMarine', 'cas2', 'lieInjured', 'cas2');
  z.npc('dominionSoldier', 'cas3', 'sitInjured', 'cas3');
  if (after) {
    attachInfection(z, malik);
    setInfectionGrowth(1);
    amputate(z, malik, z.m('limb'), z.myaw('limb'));
    setConsumed(1);
    z.setFlag('z02VaroCut', true);
    formUp(z);
    S.carry = true;
  }
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `stabilize`: the Varo scene (./z02/varo.ts) */
function* stabilize(z: ZoneRuntime): Routine {
  yield; // the loader shows the zone card after the first tick: the scene opens on the gauntlet instead
  z.game.ui.zoneCard('');
  yield* varoScene(z);
  S.carry = true;
  z.titleCard();
}

/** `bend`: walk the L. The partition, Cross on the comm (non-blocking), the optional casualty log. */
function* bend(z: ZoneRuntime): Routine {
  z.objective('Reach the far doorway', 'exit'); // NEW
  z.fork(o1(z), 'o1');
  z.fork(talk(z), 'talk');
  yield z.until(() => S.callDone && !o1Running() && !z.game.mission.cinematicActive && near(z, CUT_AT, 4));
}

function near(z: ZoneRuntime, p: [number, number], r: number): boolean {
  const q = z.player.pos;
  return Math.hypot(q.x - p[0], -q.z - p[1]) < r;
}

/** on the main path (south leg or north leg), not in the side loop */
function onMainPath(z: ZoneRuntime): boolean {
  const n = -z.player.pos.z;
  return n < ALC_N0 || z.player.pos.x > ALC_X1;
}

/** the partition lines, then the Cross call — each line waits while the O1 conversation plays */
function* talk(z: ZoneRuntime): Routine {
  const lyessa = z.cast('lyessa');
  const radio = { offscreen: true, channel: 'radio' as const };
  const quiet = (): boolean => !o1Running() && !z.game.mission.cinematicActive;
  yield 2.2;
  yield z.until(() => quiet() && z.player.pos.x > 6.5);
  // the sealed partition: both uniforms in there
  yield* z.say('Lyessa', 'Both uniforms in there.', { actor: lyessa }); // NEW
  yield* z.say('Tarrik', 'Some are still moving.', { actor: z.player }); // NEW
  yield 2.5;
  // Cross, by comm (RELOCATED: ch24, face to face in the deployment bay)
  const call: Array<[string, string, boolean]> = [
    ['Cross', 'Crownwatch containment resonators are en route to the terminal.', true], // NEW (replaces “No.” “But these are.”)
    ['Tarrik', 'What are they?', false],
    ['Cross', 'Countermeasure research. They isolate Eclipse biomass from surrounding Echo fields.', true],
    ['Tarrik', 'You brought cages.', false],
    ['Cross', 'I brought options.', true],
    ['Tarrik', 'You watched Cauldron. You saw what exposure did, and your answer was to bring it home.', false],
    ['Cross', 'My answer was to study the thing that nearly ended civilization.', true],
    ['Cross', 'For four centuries there has been nowhere else to do that.', true],
    ['Tarrik', 'Then wait another four.', false],
    ['Tarrik', 'Those do not go near the terminal.', false],
    ['Cross', 'That is not your authority.', true],
    ['Tarrik', 'Everyone keeps saying that.', false],
  ];
  yield z.until(() => quiet() && onMainPath(z));
  for (const [who, text, isRadio] of call) {
    yield z.until(quiet);
    yield* z.say(who, text, isRadio ? radio : { actor: z.player });
  }
  S.callDone = true;
}

/**
 * `cut`: the far doorway frames the atrium; the threshold holds; Neon Veil brightens faintly under his
 * breastplate. Then the camera goes on without him — through the threshold, out and up across the atrium —
 * to the card, and to Selene's side (Z03).
 */
function* cut(z: ZoneRuntime): Routine {
  const game = z.game;
  const lyessa = z.cast('lyessa');
  const malik = z.cast('malik');
  z.objective(null);
  z.optionalMarker('O1', null);
  yield* z.cinematic('z02-cut', function* (c: CineCtx): Routine {
    S.carry = true;
    game.player.teleport(z.m('cutTarrik'), z.myaw('cutTarrik'));
    walkTo(z, malik, 'varoCut');
    walkTo(z, lyessa, 'lyessaCut');
    if (lyessa && !z.skipping && lyessa.actor.distanceTo(z.m('lyessaCut')) > 7) lyessa.teleport(z.m('lyessaCut'), z.myaw('lyessaCut'));
    if (malik && !z.skipping && malik.actor.distanceTo(z.m('varoCut')) > 7) malik.teleport(z.m('varoCut'), z.myaw('varoCut'));
    // behind him at the threshold: the atrium beyond, the light wall holding
    const t = z.m('cutTarrik');
    c.cut({ pos: t.clone().add(new THREE.Vector3(0.7, 1.8, 2.6)), look: z.P(EXIT_X, D + 40, 6), fov: 46 });
    c.moveAsync({ pos: t.clone().add(new THREE.Vector3(0.5, 1.7, 1.9)), look: z.P(EXIT_X, D + 40, 7), fov: 42 }, 4.5, 'inOut');
    yield 1.2;
    // Neon Veil brightens faintly as they near it
    const chest = z.player.visual?.socket('chest');
    if (chest && !S.veil) {
      const veil = new THREE.PointLight(IVORY, 0, 2.4, 2);
      veil.position.set(0, 0, -0.12);
      chest.add(veil);
      S.veil = veil;
      z.onDispose(() => veil.removeFromParent());
    }
    yield 3.2;
    // the people with him: Varo between the two who carry him, Lyessa half a metre farther than she once stood
    c.shot(z.player.pos, { yawDeg: 160, distance: 5.2, height: 1.7, lookHeight: 1.3, fov: 42 });
    yield waitOr(z, () => z.skipping || atPost(z, malik, 'varoCut', 1.2), 3);
    yield 2.2;
    // through the threshold, out over the void and up: the perspective leaves him
    c.cut({ pos: t.clone().add(new THREE.Vector3(0, 1.75, 0.9)), look: z.P(EXIT_X, D + 60, 4), fov: 50 });
    c.moveAsync({ pos: z.P(EXIT_X, D + 2.5, 2.1), look: z.P(EXIT_X + 4, D + 80, 6), fov: 52 }, 2.4, 'in');
    yield 2.3;
    c.moveAsync({ pos: z.P(EXIT_X + 14, D + 70, 32), look: z.P(EXIT_X + 50, D + 230, -10), fov: 56 }, 8, 'out');
    yield 2.6;
    game.ui.card('ELSEWHERE — THE REFORMATION APPROACH', { style: 'context', seconds: 5 }); // NEW (zone-note text)
    yield 3.4;
    // end state
    if (S.veil) S.veil.intensity = 0;
  }, { blendOut: 0 });
  yield* z.exit('Z03', { fade: 'black', seconds: 1.4 });
}

/** ZoneDef.update: the arm, the carriers' hands, Neon Veil's faint glow */
function update(z: ZoneRuntime, dt: number): void {
  updateInfection(z, dt);
  holdHands(z, S.carry);
  if (S.veil) S.veil.intensity = z.skipping ? 0 : Math.min(2.6, S.veil.intensity + dt * 0.9);
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  { id: 'stabilize', enter: (z) => spawnCast(z, 'stabilize'), run: stabilize },
  { id: 'bend', enter: (z) => spawnCast(z, 'bend'), run: bend },
  { id: 'cut', enter: (z) => spawnCast(z, 'cut'), run: cut },
];

const Z02_DEF: ZoneDef = {
  id: 'Z02',
  title: 'Survivor Bend',
  art: 'relay-route',
  cast: ['dominionSoldier', 'reformationMarine', 'lyessa'],
  build,
  beats,
  update,
  dispose() {
    disposeLog();
    S = blank();
    resetInfection();
    resetO1();
    resetVaro();
  },
};

export default Z02_DEF;
