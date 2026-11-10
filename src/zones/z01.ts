/**
 * Z01 · Pressure hall / Encounter E1 — lead: Tarrik. THE REFERENCE ZONE: copy its structure.
 *
 *   constants → build (space, cover, dressing, light, markers) → cast → encounter → beats → ZoneDef
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north): a 56 × 26 m white-gold hall. The
 * player enters at the west end and pushes EAST. Three cover bands at x ≈ 10 / 22 / 38. The LEFT (north) flank
 * climbs to a +2 m gallery that ends at the command emitter; the RIGHT (south) reinforcement rib at x = 28 makes
 * a recovery pocket that the north lane can still see into. Six Reformation security drones hold three lanes
 * from the east end (four at first, two more through the high service aperture). Exit: east wall, to Z02.
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z01. The author's lines are exact (curly apostrophes are the book's); every line
 * and UI string written for the game is tagged `// NEW`.
 */
import * as THREE from 'three';
import type {
  Actor, Beat, CineCtx, Companion, DeviceHandle, DoorHandle, Encounter, Routine, ZoneBuilder, ZoneDef, ZoneRuntime,
} from '@/core/api';
import { LOOKS } from '@/render/looks';
import {
  AMBER, BLUE, FACE, GOLD, IVORY, VIOLET, barker, encounterMusic, onZoneEvent, setDoor, standardExit, sustainDrops,
  tutorialHint, waitOr, walkTo,
} from './shared';

// =====================================================================================================================
// Constants — every number the layout and the encounter depend on
// =====================================================================================================================

/** playable envelope (plan §Z01: 56 × 26 m) */
const W = 56;
const D = 26;
/** wall height and rib apex: the vault reads as an "immense span" above 10 m walls */
const WALL_H = 10;
const RIB_H = 15.5;
/** the three firing lanes (n of the south / centre / north lane on the main floor) */
const LANE_N = [4.5, 10.5, 16.5] as const;
/** entry (west wall) and exit (east wall) door centres */
const ENTRY_N = 10.5;
const EXIT_N = 8.5;
/** north flank gallery: +2 m, x 15…41, against the north wall */
const DECK_H = 2;
const DECK_X0 = 15;
const DECK_X1 = 41;
const DECK_N0 = 20.4;
const DECK_MID_N = (DECK_N0 + D) / 2;
const RAMP_RUN = 9; // 2 m over 9 m ≈ 12.5° (plan metric: 3 m over 10–12 m)
/** south reinforcement rib (the recovery pocket is on its west side) */
const RIB_X = 28;
const RIB_LEN = 4.2;
/** high service aperture in the east wall (reinforcements) */
const APERTURE_N = 17.5;
const APERTURE_H = 4.8;
/** the player crosses this x to start the fight (the combat threshold of CP1) */
const THRESHOLD_X = 8.2;
/** E1: six drones, never more than four alive (plan) */
const E1_CAP = 4;
/** Lyessa's suppressing bursts: seconds between them */
const SUPPRESS_EVERY = 6.5;

/** speaker label for the soldier who is nameless until Z02 */
const MALIK = 'Soldier';

// =====================================================================================================================
// Per-load state (rebuilt by build(); beats read it)
// =====================================================================================================================

interface Z01 {
  exit: DoorHandle | null;
  hatch: DoorHandle | null;
  hatchLight: THREE.PointLight | null;
  enc: Encounter | null;
  emitter: DeviceHandle | null;
  /** the tissue that closes on the gauntlet during the insert (scaled by `grip`) */
  tissue: THREE.Object3D | null;
  grip: number;
  gripTarget: number;
  /** the violet-lit crack on the soldier's gauntlet */
  crack: THREE.Object3D | null;
}
let S: Z01 = blank();
function blank(): Z01 {
  return { exit: null, hatch: null, hatchLight: null, enc: null, emitter: null, tissue: null, grip: 0, gripTarget: 0, crack: null };
}

// =====================================================================================================================
// Build
// =====================================================================================================================

function build(b: ZoneBuilder): void {
  S = blank();
  const sky = b.game.sky;
  // the hall runs east: put the Wound over the exit wall so the far end of the vault frames it
  sky.setHeading(-Math.PI / 2);
  b.setEnv({
    sky: 'crashRib', look: LOOKS.pressureHall, ambience: 'pressureHall', music: 'approachTarrik',
    // high, from the south-east: long rib shadows fall across the floor toward the player
    key: { dirFrom: [30, -16, 34], intensity: 2.3, color: 0xfff0dc },
  });
  buildShell(b);
  buildFlank(b);
  buildCover(b);
  buildRibPocket(b);
  buildFactionGear(b);
  buildLight(b);
  buildMarkers(b);
  buildScenic(b);
  b.finalize();
}

/** floor, walls, the rib row and vault, entry and exit */
function buildShell(b: ZoneBuilder): void {
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, inlay: 'channels', reflective: true });
  // west wall: sealed entry
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'panelled', doors: [{ at: ENTRY_N, width: 3, height: 3.5 }] });
  b.door({ x: 0, n: ENTRY_N, yawDeg: FACE.east }).setState('sealed');
  // long walls
  b.wall({ from: [0, D], to: [W, D], height: WALL_H, style: 'conduit' });
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'ribbed' });
  // east wall in two tiers: the exit below, the service aperture above
  b.wall({ from: [W, 0], to: [W, D], height: APERTURE_H, style: 'panelled', doors: [{ at: EXIT_N, width: 3, height: 3.5 }] });
  b.wall({ from: [W, 0], to: [W, D], h: APERTURE_H, height: WALL_H - APERTURE_H, style: 'plain', doors: [{ at: APERTURE_N, width: 3.6, height: 2.2 }] });

  // seven ribs carry the vault; their legs stand against the long walls
  b.ribRow({ x: 4, n: D / 2, span: D - 1, height: RIB_H, count: 7, spacing: 8, yawDeg: FACE.east, alongDeg: FACE.east });
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: RIB_H + 0.3, style: 'lattice' });

  // exit: door, a lit vestibule beyond it, the white point above
  S.exit = b.door({ x: W, n: EXIT_N, yawDeg: FACE.east });
  S.exit.setState('locked');
  b.floor({ x: W + 3, n: EXIT_N, w: 6, d: 4.4, inlay: 'none' });
  b.wall({ from: [W, EXIT_N - 2.2], to: [W + 6, EXIT_N - 2.2], height: 5 });
  b.wall({ from: [W, EXIT_N + 2.2], to: [W + 6, EXIT_N + 2.2], height: 5 });
  b.wall({ from: [W + 6, EXIT_N - 2.2], to: [W + 6, EXIT_N + 2.2], height: 5, style: 'panelled' });
  b.ceiling({ x: W + 3, n: EXIT_N, w: 6, d: 4.4, h: 5, style: 'flat' });
  b.panelLight({ x: W + 5.6, n: EXIT_N, w: 2.2, d: 2.6, h: 0.9, facing: 'west', intensity: 2.2 });
  b.whitePoint({ x: W - 0.9, n: EXIT_N, h: 5.3 });

  // the service aperture: a hatch high in the east wall with a dark Reformation duct behind it
  S.hatch = b.door({ x: W, n: APERTURE_N, h: APERTURE_H, yawDeg: FACE.east, width: 3.6, height: 2.2, style: 'service' });
  S.hatch.setState('locked');
  b.floor({ x: W + 1.9, n: APERTURE_N, w: 3.2, d: 4, h: APERTURE_H, inlay: 'none', noSurface: true, mat: 'refSlate' });
  b.wall({ from: [W + 3.4, APERTURE_N - 2], to: [W + 3.4, APERTURE_N + 2], h: APERTURE_H, height: 2.6, mat: 'refNavy', style: 'plain', noCollider: true });
  S.hatchLight = b.point({ x: W + 1.6, n: APERTURE_N, h: APERTURE_H + 1.4, color: BLUE, intensity: 0, distance: 14 });
}

/** the left (north) flank: ramp up, +2 m gallery, ramp down behind the formation */
function buildFlank(b: ZoneBuilder): void {
  const d = D - DECK_N0;
  b.ramp({ x: DECK_X0 - RAMP_RUN / 2, n: DECK_MID_N, w: d, d: RAMP_RUN, h0: 0, h1: DECK_H, yawDeg: FACE.east, rails: true });
  b.deck({ x: (DECK_X0 + DECK_X1) / 2, n: DECK_MID_N, w: DECK_X1 - DECK_X0, d, h: DECK_H, solidBelow: true, rails: ['s'], inlay: 'channels' });
  b.ramp({ x: DECK_X1 + RAMP_RUN / 2, n: DECK_MID_N, w: d, d: RAMP_RUN, h0: 0, h1: DECK_H, yawDeg: FACE.west, rails: true });
  // one piece of cover on the gallery so the flank is a route, not a shooting gallery
  b.coverLow({ x: 27.5, n: DECK_N0 + 1.5, h: DECK_H, yawDeg: FACE.east, style: 'ancient' });
  // gold route light along the gallery edge: the flank is an offered path
  b.channel([[DECK_X0 - RAMP_RUN, DECK_N0 - 0.5], [DECK_X0 - 1, DECK_N0 - 0.5]], { width: 0.07 });
}

/** three cover bands across the main floor (plan: ≈ 10 / 22 / 38 m). Long sides face the lanes. */
function buildCover(b: ZoneBuilder): void {
  // band 1 — King-era plinths; the squad starts behind these
  b.coverLow({ x: 10, n: 5.5, yawDeg: FACE.east, style: 'ancient' });
  b.coverHigh({ x: 10.5, n: 13.5, w: 2.6, yawDeg: FACE.east, style: 'ancient' });
  // band 2 — a fallen ceiling plate and a plinth
  b.coverLow({ x: 22, n: 6.5, yawDeg: FACE.east, style: 'plate' });
  b.coverHigh({ x: 22.5, n: 14, w: 2.6, yawDeg: FACE.east, style: 'ancient' });
  // band 3 — Reformation barricades: their gear, temporary, in the ancient room
  b.coverLow({ x: 38, n: 6, yawDeg: FACE.east, style: 'reformation' });
  b.coverHigh({ x: 38.5, n: 14.5, w: 2.6, yawDeg: FACE.east, style: 'reformation' });
  b.coverLow({ x: 31, n: 10.5, w: 2.2, yawDeg: FACE.east, style: 'debris' });
}

/**
 * The right (south) reinforcement rib and its pocket. One King-era conduit runs along the base of the rib's
 * sheltered (west) face and carries the only Eclipse growth in Z00–Z01 — a real source, so faint violet is
 * allowed here and nowhere else in the hall. A conduit housing keeps the lead from standing in it.
 */
function buildRibPocket(b: ZoneBuilder): void {
  b.wall({ from: [RIB_X, 0], to: [RIB_X, RIB_LEN], height: 6.5, thickness: 1.3, style: 'ribbed' });
  b.rib({ x: RIB_X, n: RIB_LEN + 0.2, span: 7, height: 9, style: 'half', yawDeg: FACE.north, noCollider: true });
  const face = RIB_X - 0.65; // the sheltered west face
  b.conduit([[face - 0.12, 0.5, 0.32], [face - 0.12, 3.9, 0.32]], { r: 0.1, glow: false });
  b.prop('conduitJunction', { x: face - 0.5, n: 0.9, collider: true });
  b.corruption({ x: face - 0.02, n: 2.4, h: 0.55, r: 1.15, onWall: true, yawDeg: FACE.west, intensity: 0.8 });
  b.corruption({ x: face - 0.45, n: 2.5, r: 0.8, intensity: 0.6 });
  b.blocker({ x: face - 0.4, n: 2.5, w: 0.8, d: 2.4, height: 1.2 });
  b.prop('debrisSmall', { x: face - 1.3, n: 0.8, yawDeg: 40 });
}

/** Reformation security equipment at the far end; a little Dominion kit where the squad came in */
function buildFactionGear(b: ZoneBuilder): void {
  // east end: the drones' support gear (cold blue-white, modular, visibly temporary)
  b.prop('refSensorMast', { x: 44.5, n: 2.2, yawDeg: 290 });
  b.prop('refSensorMast', { x: 52.5, n: 19.2, yawDeg: 250 });
  b.prop('refConsole', { x: 52.8, n: 13.4, yawDeg: 270 });
  b.prop('refCrate', { x: 51.6, n: 3.2, yawDeg: 12, variant: 1 });
  b.prop('refCrate', { x: 53.2, n: 3.6, yawDeg: -8, variant: 0 });
  b.prop('refCrate', { x: 39.6, n: 16.4, yawDeg: 84, variant: 2 });
  b.prop('refAmmoCase', { x: 37.2, n: 7.6, yawDeg: 30 });
  b.prop('refLamp', { x: 45.5, n: 19.4, yawDeg: 240 });
  b.prop('refLamp', { x: 50.5, n: 1.6, yawDeg: 300 });
  b.prop('cableBundle', { x: 49, n: 14.6, yawDeg: 60 });
  b.prop('refCrate', { x: 37.2, n: DECK_MID_N + 1.6, h: DECK_H, yawDeg: 6, variant: 1 });
  // ancient furniture and wreckage
  b.prop('ancientPylon', { x: 16.5, n: 1.6 });
  b.prop('ancientPylon', { x: 40.5, n: 1.6 });
  b.prop('ancientBench', { x: 6.5, n: 18.6, yawDeg: 180 });
  b.prop('fallenPlate', { x: 30.5, n: 16.8, yawDeg: 25 });
  b.prop('rubblePile', { x: 33.5, n: 1.8 });
  b.prop('debrisSmall', { x: 18, n: 10.5 });
  b.prop('debrisSmall', { x: 44, n: 9.5, yawDeg: 120 });
  // the squad's own: one field cache by the entry
  b.prop('domFieldCache', { x: 3.2, n: 16.4, yawDeg: 120 });
  b.prop('domAmmoCase', { x: 4.6, n: 5.2, yawDeg: 70 });
}

/** a dozen lights at most: the key, two shafts, faction accents (BRIEF §4: warm / cool contrast) */
function buildLight(b: ZoneBuilder): void {
  b.spot({ x: 20, n: 12, h: RIB_H - 1, target: [21, 11, 0], angleDeg: 22, intensity: 900, shaft: true, color: 0xfff0d2 });
  b.spot({ x: 36, n: 9, h: RIB_H - 1, target: [37, 9.5, 0], angleDeg: 20, intensity: 800, shaft: true, color: 0xfff0d2 });
  // cold security light where the formation holds
  b.point({ x: 48.5, n: 10.5, h: 4.2, color: BLUE, intensity: 60, distance: 20 });
  // the recovery pocket reads warm and safe; the growth gets no light of its own
  b.point({ x: 24.5, n: 2.6, h: 3, color: IVORY, intensity: 22, distance: 9 });
  // gallery
  b.point({ x: 28, n: DECK_MID_N, h: DECK_H + 3, color: IVORY, intensity: 26, distance: 14 });
  // entry: amber from the squad's cache
  b.point({ x: 3.6, n: 15.6, h: 1.4, color: AMBER, intensity: 10, distance: 7 });
}

function buildMarkers(b: ZoneBuilder): void {
  // --- squad (west end) ---
  b.marker('start', 3.2, ENTRY_N, 0, FACE.east);
  b.marker('lyessaStart', 4.6, 12.8, 0, FACE.east);
  b.marker('lyessaPost1', 9.2, 13.5, 0, FACE.east); // behind the band-1 plinth
  b.marker('lyessaPost2', 21.2, 14, 0, FACE.east); // moves up when the lead passes band 2
  b.marker('lyessaEnd', 50, 10.4, 0, FACE.east);
  b.marker('malikStart', 5.4, 5.2, 0, FACE.east);
  b.marker('malikAdvance', 24.4, 3.2, 0, FACE.east); // along the right rib
  b.marker('malikFall', RIB_X - 1.25, 2.5, 0, FACE.west); // thrown against the rib's base, hand in the growth
  b.marker('malikCover', 20.6, 6.1, 0, FACE.east); // behind the band-2 plate
  b.marker('malikEnd', 47.5, 6.6, 0, FACE.east);
  b.marker('soldierA', 8.6, 5.2, 0, FACE.east);
  b.marker('soldierACover', 20.7, 7.3, 0, FACE.east);
  b.marker('soldierAEnd', 49, 5.2, 0, FACE.east);
  b.marker('soldierB', 6.2, 7.4, 0, FACE.east);
  b.marker('soldierBCover', 19.6, 5.2, 0, FACE.east);
  b.marker('soldierBEnd', 46, 8.2, 0, FACE.north);
  b.marker('soldierC', 8.9, 15.2, 0, FACE.east);
  b.marker('soldierCEnd', 44.5, 13, 0, FACE.east);
  b.marker('helpL', RIB_X - 2.2, 3.4, 0, FACE.east); // where the two soldiers take hold of him
  b.marker('helpR', RIB_X - 2.4, 1.6, 0, FACE.east);
  b.marker('threshold', 11.5, ENTRY_N, 0, FACE.east);

  // --- formation (east end) ---
  b.marker('drone0', 47, LANE_N[0], 0, FACE.west);
  b.marker('drone1', 49.5, LANE_N[1], 0, FACE.west);
  b.marker('drone2', 47, LANE_N[2], 0, FACE.west);
  b.marker('drone3', 52, 12.6, 0, FACE.west);
  b.marker('emitter', 38.6, DECK_N0 + 1.3, DECK_H, FACE.south);
  b.marker('aperture', W - 0.6, APERTURE_N, APERTURE_H + 0.9, FACE.west);
  b.marker('reinforceA', 46, 7, 0, FACE.west);
  b.marker('reinforceB', 46.5, 14, 0, FACE.west);

  // --- recovery ---
  b.marker('sustainPocket', 24.6, 2.4, 0);
  b.marker('sustainGallery', 33, DECK_MID_N + 0.6, DECK_H);
  b.marker('sustainEast', 42.4, 3.4, 0);

  b.marker('exit', W - 1.9, EXIT_N, 0, FACE.east);
  b.marker('growthLook', RIB_X - 0.7, 2.4, 0.5);
}

/** far field: the hall is one bay of a much larger nave (megastructure ribs beyond the vault), dust in the shafts */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const nave = game.sky.scenic.megaRibs({ count: 7, span: 170, height: 120, spacing: 90, seed: 101 });
  nave.position.copy(b.P(-60, D / 2, -6));
  nave.rotation.y = -Math.PI / 2; // march east, like the hall
  b.add(nave);
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 5), { x: W, y: 10, z: D }, 0.5);
  game.vfx.ambient('goldMotes', b.P(22, 11, 4), { x: 26, y: 8, z: 14 }, 0.25);
}

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'threshold' | 'fight' | 'clear';

/**
 * Spawn the lead and the cast as the given stage finds them. Called from every beat's `enter` — the world a
 * checkpoint reload or a debug jump lands in must equal the one the earlier beats leave behind.
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const end = stage === 'clear';
  z.spawnPlayer('tarrik', end ? 'reinforceA' : stage === 'fight' ? 'threshold' : 'start');
  // Lyessa hangs back and holds a post; she is never the answer to the encounter
  const lyessa = z.companion('lyessa', end ? 'lyessaEnd' : stage === 'fight' ? 'lyessaPost1' : 'lyessaStart', 'hold');
  lyessa.holdAt(z.m(end ? 'lyessaEnd' : stage === 'fight' ? 'lyessaPost1' : 'lyessaStart'), z.myaw('lyessaStart'));
  // the soldier on the right (named in Z02), and three more of the squad
  z.npc('dominionSoldier', end ? 'malikEnd' : 'malikStart', 'aimRifle', 'malik');
  z.npc('dominionSoldier', end ? 'soldierAEnd' : 'soldierA', 'aimRifle', 'soldierA');
  z.npc('dominionSoldier', end ? 'soldierBEnd' : 'soldierB', 'aimRifle', 'soldierB');
  z.npc('dominionSoldier', end ? 'soldierCEnd' : 'soldierC', 'aimRifle', 'soldierC');
  if (end) {
    attachCrack(z);
    setDoor(S.exit, false, 'ready');
  }
}

/**
 * The cracked gauntlet: a split in the plate lit violet from inside, a thread of black in it. It rides on the
 * soldier's left hand from the insert onward (Z02 picks the story up).
 */
function attachCrack(z: ZoneRuntime): void {
  if (S.crack) return;
  const malik = z.cast('malik');
  const visual = malik?.actor.visual;
  if (!visual) return;
  const mats = z.game.mats;
  const g = new THREE.Group();
  g.name = 'gauntlet-crack';
  const lit = mats.emissive(VIOLET, 3.2);
  const tissue = mats.get('eclipseTissue');
  // the split runs along the back of the hand in three short angular segments
  const segs: Array<[number, number, number, number]> = [[-0.035, 0, 0.5, 0.05], [0.004, 0.012, -0.35, 0.045], [0.04, 0.002, 0.3, 0.04]];
  for (const [x, zz, rot, len] of segs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.006, 0.009), lit);
    m.position.set(x, 0.034, zz);
    m.rotation.y = rot;
    g.add(m);
  }
  const thread = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), tissue);
  thread.scale.set(1.8, 0.5, 0.8);
  thread.position.set(0.004, 0.036, 0.008);
  g.add(thread);
  visual.socket('handL').add(g);
  S.crack = g;
  z.onDispose(() => {
    g.removeFromParent();
    for (const c of g.children) (c as THREE.Mesh).geometry.dispose();
  });
}

/** the tissue on the rib that closes over the gauntlet for the two-second insert */
function makeTissue(z: ZoneRuntime, at: THREE.Vector3): void {
  if (S.tissue) return;
  const mat = z.game.mats.get('eclipseTissue');
  const vein = z.game.mats.get('eclipseVein');
  const g = new THREE.Group();
  g.name = 'gauntlet-tissue';
  const lobes: Array<[number, number, number, number]> = [
    [-0.07, 0.01, 0.03, 0.075], [0.06, 0.0, -0.04, 0.07], [0.0, 0.03, 0.07, 0.06], [0.02, -0.01, -0.08, 0.065], [-0.05, 0.035, -0.05, 0.05],
  ];
  for (const [x, y, zz, r] of lobes) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    m.position.set(x, y, zz);
    m.scale.set(1.25, 0.7, 1);
    g.add(m);
  }
  const strand = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.008, 6, 14, Math.PI * 1.3), vein);
  strand.rotation.x = Math.PI / 2;
  g.add(strand);
  g.position.copy(at);
  g.scale.setScalar(0.001);
  z.builder.add(g);
  S.tissue = g;
  S.grip = 0;
  S.gripTarget = 0;
}

// =====================================================================================================================
// Encounter E1
// =====================================================================================================================

/**
 * Six security drones, hard cap four. Wave 1: four in a three-lane formation, DORMANT until the fight starts
 * (they are already holding the hall when the squad comes in); the two outer lanes are synchronised through the
 * command emitter on the gallery. Wave 2: two more through the aperture once the formation is broken AND no more
 * than two remain. `formationBroken` = emitter destroyed / staggered, or the first drone destroyed.
 */
function setupE1(z: ZoneRuntime): Encounter {
  if (S.enc) return S.enc;
  const game = z.game;
  const enc = z.encounter({
    id: 'E1',
    maxActive: E1_CAP,
    waves: [
      {
        spawns: [0, 1, 2, 3].map((i) => ({
          role: 'secDrone' as const, at: `drone${i}`,
          opts: { yaw: z.myaw(`drone${i}`), lane: Math.min(i, 2), dormant: true, tags: ['e1', `lane${Math.min(i, 2)}`] },
        })),
        onSpawn: (actors) => {
          // the two outer lanes cover each other through the emitter
          S.emitter = game.ai.devices.commandEmitter({ id: 'e1-emitter', pos: z.m('emitter'), drones: [actors[0], actors[2]].filter(Boolean) });
          S.emitter.actor.yaw = z.myaw('emitter');
        },
      },
      {
        when: (e) => e.flags.formationBroken === true && e.aliveCount <= 2,
        telegraph: 1.6,
        onTelegraph: () => {
          S.hatch?.setState('open');
          S.hatch?.setOpen(true);
          if (S.hatchLight) S.hatchLight.intensity = 46;
          game.events.emit('caption', { text: 'Service aperture opening', kind: 'door', pos: z.m('aperture') }); // NEW
          z.bark('Lyessa', 'More.'); // RELOCATED (ch24) — her whole reinforcement call
        },
        spawns: [
          { role: 'secDrone', at: 'reinforceA', opts: { via: 'aperture', from: z.m('aperture'), lane: 0, tags: ['e1'] } },
          { role: 'secDrone', at: 'reinforceB', opts: { via: 'aperture', from: z.m('aperture'), lane: 2, tags: ['e1'] } },
        ],
        onSpawn: () => z.bark('Tarrik', 'Move.'),
      },
    ],
  });
  S.enc = enc;
  const broken = (): void => {
    enc.flags.formationBroken = true;
  };
  onZoneEvent(z, 'device:disabled', (e) => {
    if (e.id === 'e1-emitter') broken();
  });
  onZoneEvent(z, 'actor:staggered', (e) => {
    if (S.emitter && e.actor === S.emitter.actor) broken();
  });
  onZoneEvent(z, 'actor:died', (e) => {
    if (enc.has?.(e.actor)) broken();
  });
  enc.start();
  return enc;
}

/** wake the formation: from here the lanes are live and the combat score plays */
function wakeFormation(z: ZoneRuntime): void {
  z.game.ai.alert('e1');
  z.setFlag('z01Awake', true);
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `threshold` → CP1. First sight of the formation already holding the hall; walk to the first cover band. */
function* threshold(z: ZoneRuntime): Routine {
  const enc = setupE1(z);
  z.fork(encounterMusic(z, enc, 'combatTarrik', 'approachTarrik', { begin: () => z.flag('z01Awake') === true }), 'music');
  const lyessa = z.cast('lyessa');

  yield* z.cinematic('z01-first-sight', function* (c: CineCtx): Routine {
    // the whole span, the squad small at its foot, the formation a line of cold points at the far end
    c.cut({ pos: z.P(1.6, 17.6, 6.2), look: z.P(50, 10, 2.4), fov: 50 });
    c.moveAsync({ pos: z.P(5.5, 15.4, 4.6), look: z.P(50, 10, 2.2), fov: 44 }, 5, 'inOut');
    yield 1.6;
    yield* z.say('Lyessa', 'They’re early.', { actor: lyessa }); // RELOCATED (ch24, the bridge of the Supremacy)
    // the formation: three lanes, two of them tied to the emitter on the gallery
    c.cut({ pos: z.P(33, 12.5, 2.3), look: z.P(49, 11, 2.0), fov: 34 });
    c.moveAsync({ pos: z.P(35, 12, 2.2), look: z.P(49, 11, 2.0), fov: 32 }, 3, 'out');
    yield 2.2;
    c.shot(z.player.pos, { yawDeg: 70, distance: 2.3, height: 1.5, lookHeight: 1.55, fov: 36 });
    yield* z.say('Tarrik', 'No. They think we’re late.', { actor: z.player });
  });

  z.objective('Advance into the hall', 'threshold'); // NEW
  // the fight starts when the lead crosses the threshold — or shoots first
  yield z.until(() => z.player.pos.x > THRESHOLD_X || enc.killed > 0 || enc.alive.some((a) => a.hp < a.maxHp));
}

/** `e1`. The fixed beat on the right rib, then the encounter. */
function* e1(z: ZoneRuntime): Routine {
  const enc = setupE1(z);
  const game = z.game;
  const lyessa = z.cast('lyessa');
  const say = barker(z, 4.5);

  yield* gauntletBeat(z, enc);

  wakeFormation(z);
  z.objective('Break the drone formation'); // NEW
  sustainDrops(z, ['sustainPocket', 'sustainGallery', 'sustainEast']);
  say('down', 'Lyessa', 'Man down, right side.'); // NEW
  z.fork(teachE1(z, enc), 'teach');
  z.fork(lyessaSupport(z, enc, lyessa), 'lyessa');

  // --- barks: information the player can use ---
  const stats = game.ai.stats;
  const syncAtStart = stats.syncVolleys;
  let emitterCalled = false;
  let brokenCalled = false;
  z.fork((function* (): Routine {
    for (;;) {
      if (enc.cleared) return;
      if (!emitterCalled && stats.syncVolleys > syncAtStart && S.emitter && !S.emitter.disabled) {
        if (say('sync', 'Lyessa', 'Two of them fire as one.')) emitterCalled = true; // NEW
      } else if (emitterCalled && S.emitter && !S.emitter.disabled) {
        say('emitter', 'Lyessa', 'That emitter pairs them.'); // NEW
      }
      if (!brokenCalled && enc.flags.formationBroken === true) {
        brokenCalled = true;
        z.bark('Lyessa', 'They’ve lost their timing.'); // NEW
      }
      if (z.player.hp < z.player.maxHp * 0.45) say('hurt', 'Soldier', 'High Centurion!'); // NEW
      yield 0.25;
    }
  })(), 'barks');
  // a lane that falls is called by the soldier nearest to it
  onZoneEvent(z, 'actor:died', ({ actor }) => {
    if (!enc.has?.(actor) || enc.cleared) return;
    if (actor.tags.has('lane0')) say('lane0', 'Soldier', 'Right lane is open.'); // NEW
    else if (actor.tags.has('lane2')) say('lane2', 'Soldier', 'Left lane is open.'); // NEW
    else if (actor.tags.has('lane1')) say('lane1', 'Soldier', 'Center lane is open.'); // NEW
  });

  yield z.until(() => enc.cleared);
}

/**
 * The fixed beat (SCRIPT_SOURCE Z01, the author's ruling 2). The soldier on the right advances along the rib;
 * the first synchronised volley takes him on the guard and the chest plate — sparks, no wound — and throws him
 * against the rib's base, where his gauntlet hand goes into the growth. A two-second insert: the tissue closes
 * on the gauntlet and the plate splits along a line lit violet from inside. He tears the hand free and two
 * soldiers pull him behind cover. No character sees what touched him.
 * Every state change is applied whether the scene is watched or skipped.
 */
function* gauntletBeat(z: ZoneRuntime, enc: Encounter): Routine {
  const game = z.game;
  const malik = z.cast('malik');
  const a = z.cast('soldierA');
  const bb = z.cast('soldierB');
  if (!malik) return;
  const fall = z.m('malikFall');
  const hand = new THREE.Vector3();

  yield* z.cinematic('z01-gauntlet', function* (c: CineCtx): Routine {
    // (1) he advances along the right rib
    malik.stopAction();
    malik.teleport(z.P(21.4, 3.3), z.myaw('malikAdvance'));
    walkTo(z, malik, 'malikAdvance', { run: true });
    c.cut({ pos: z.P(17.2, 1.5, 1.35), look: z.P(26.5, 3.6, 1.5), fov: 40 });
    c.moveAsync({ pos: z.P(18.6, 1.7, 1.4), look: z.P(26.8, 3.2, 1.3), fov: 38 }, 2.2, 'out');
    // (2) the paired drones light him up, then fire as one
    const paired = enc.alive.filter((d) => d.tags.has('lane0') || d.tags.has('lane2'));
    const chest = new THREE.Vector3();
    const beams = z.skipping ? [] : paired.map((d) => game.vfx.beam(d.aimPoint(new THREE.Vector3()), malik.actor.aimPoint(chest).clone(), 'laser'));
    if (!z.skipping) {
      game.audio.play('droneCharge', { pos: z.m('drone0') });
      game.events.emit('caption', { text: 'Volley lane locking', kind: 'alert', pos: malik.actor.pos }); // NEW
    }
    yield 1.25;
    for (const beam of beams) beam.remove(0.1);
    if (!z.skipping) {
      malik.actor.aimPoint(chest);
      for (const d of paired) {
        const from = d.aimPoint(new THREE.Vector3());
        for (let i = 0; i < 3; i++) game.vfx.tracer(from, chest, 'drone');
      }
      game.audio.play('droneVolley', { pos: z.m('drone0') });
      game.vfx.spawn('sparkHeavy', chest, { dir: { x: 1, y: 0.2, z: 0 } });
      game.vfx.spawn('droneBoltHit', chest);
      game.audio.play('guardBlock', { pos: chest });
      game.camera.shake(0.35, 0.3);
      malik.play('hitHeavy');
    }
    yield 0.28;
    // thrown down against the rib's base — the cut covers the throw
    malik.teleport(fall, z.myaw('malikFall'));
    malik.play('knockdown');
    c.cut({ pos: z.P(RIB_X - 3.3, 4.6, 0.75), look: z.P(RIB_X - 0.9, 2.5, 0.35), fov: 36 });
    if (!z.skipping) game.audio.play('armorRattle', { pos: fall });
    yield 0.75;
    // (3) the insert: tissue closes on the gauntlet; the plate splits along a violet-lit line. No impact light.
    const visual = malik.actor.visual;
    if (visual) visual.socket('handL').getWorldPosition(hand);
    else hand.copy(fall).setY(0.2);
    makeTissue(z, hand);
    S.gripTarget = 1;
    c.cut({ pos: new THREE.Vector3(hand.x - 0.62, hand.y + 0.34, hand.z + 0.5), look: hand.clone(), fov: 26 });
    c.moveAsync({ pos: new THREE.Vector3(hand.x - 0.5, hand.y + 0.28, hand.z + 0.42), look: hand.clone(), fov: 24 }, 2, 'inOut');
    c.dof(0.75, 0.7);
    if (!z.skipping) game.audio.play('eclipseBreath', { pos: hand, volume: 0.5 });
    yield 0.95;
    attachCrack(z);
    if (!z.skipping) game.audio.play('breachCrack', { pos: hand, volume: 0.35, pitch: 1.7 });
    yield 1.1;
    // (4) he tears the hand free; two of the squad take hold of him
    S.gripTarget = 0.25;
    c.dof(null);
    malik.play('getUp');
    walkTo(z, a, 'helpL', { run: true });
    walkTo(z, bb, 'helpR', { run: true });
    c.cut({ pos: z.P(RIB_X - 6.4, 5.4, 1.45), look: z.P(RIB_X - 1.4, 2.6, 1.0), fov: 40 });
    yield* z.say('Soldier', 'Got him. Pulling him back.', { duration: 1.9, actor: a }); // NEW
    // end state — identical watched or skipped
    walkTo(z, malik, 'malikCover');
    walkTo(z, a, 'soldierACover');
    walkTo(z, bb, 'soldierBCover');
    attachCrack(z);
    z.setFlag('z01GauntletCracked', true);
  }, { blendOut: 0.4 });

  // hurt, not maimed: he keeps the hand and stays in the fight from cover
  z.fork((function* (): Routine {
    yield waitOr(z, () => malik.arrived, 14);
    malik.play('aimRifle', { loop: true });
    if (a) {
      yield waitOr(z, () => a.arrived, 6);
      a.play('aimRifle', { loop: true });
    }
    if (bb) {
      yield waitOr(z, () => bb.arrived, 6);
      bb.play('aimRifle', { loop: true });
    }
  })(), 'settle');
}

/** Tutorialise through play (plan order): guard → counter → the emitter → spending Echo. HUD text only. */
function* teachE1(z: ZoneRuntime, enc: Encounter): Routine {
  const game = z.game;
  const stats = game.ai.stats;
  const telegraphs = stats.telegraphs;
  // guard works at once: hint when the first lane telegraph appears
  yield waitOr(z, () => stats.telegraphs > telegraphs || enc.cleared, 20);
  if (enc.cleared) return;
  tutorialHint(z, 'z01Guard', 'Hold to guard. A guarded volley earns Echo.', 'guard', 7); // NEW
  let blocked = false;
  let countered = false;
  onZoneEvent(z, 'player:guard', (e) => {
    if (e.perfect) countered = true;
    else blocked = true;
  });
  yield waitOr(z, () => blocked || countered || enc.cleared, 40);
  if (enc.cleared) return;
  yield 2.5;
  if (!countered) tutorialHint(z, 'z01Counter', 'Guard just before impact to counter.', 'guard', 7); // NEW
  // the emitter: what makes the other two dangerous
  const sync = stats.syncVolleys;
  yield waitOr(z, () => stats.syncVolleys > sync || enc.flags.formationBroken === true || enc.cleared, 30);
  if (enc.cleared) return;
  yield 5;
  if (S.emitter && !S.emitter.disabled) {
    tutorialHint(z, 'z01Emitter', 'The emitter on the gallery pairs two drones. Stagger or destroy it to stop the paired volleys.', 'scan', 9); // NEW
    game.ui.marker('z01-emitter', S.emitter.pos, { label: 'Emitter', kind: 'threat', hideWithin: 4 }); // NEW
    yield z.until(() => !S.emitter || S.emitter.disabled || enc.cleared);
    game.ui.marker('z01-emitter', null);
  }
  // spending Echo — ordinary attacks are always enough
  yield waitOr(z, () => game.player.echo >= 35 || enc.cleared, 90);
  if (enc.cleared || game.player.echo < 35) return;
  tutorialHint(z, 'z01Echo', 'Echo is spent on abilities. Ordinary attacks are always enough.', 'ability1', 8); // NEW
}

/** Lyessa suppresses from the rear and moves her post up once; she never solves the encounter. */
function* lyessaSupport(z: ZoneRuntime, enc: Encounter, lyessa: Companion | null): Routine {
  if (!lyessa) return;
  let movedUp = false;
  let next = z.time + 3;
  while (!enc.cleared) {
    if (!movedUp && z.player.pos.x > 24) {
      movedUp = true;
      lyessa.holdAt(z.m('lyessaPost2'), z.myaw('lyessaPost2'));
    }
    if (z.time >= next && !lyessa.assisting && !lyessa.disrupted) {
      next = z.time + SUPPRESS_EVERY;
      const target = nearest(enc.alive, lyessa.actor);
      if (target) lyessa.assist(target, 'suppress');
    }
    yield 0.4;
  }
}

function nearest(list: readonly Actor[], from: Actor): Actor | null {
  let best: Actor | null = null;
  let bestD = Infinity;
  for (const a of list) {
    const d = a.distanceTo(from);
    if (a.alive && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** `clear`. The last lane has fallen: the squad moves up, one exchange, the exit opens. */
function* clear(z: ZoneRuntime): Routine {
  const game = z.game;
  const lyessa = z.cast('lyessa');
  const malik = z.cast('malik');
  const others = [z.cast('soldierA'), z.cast('soldierB'), z.cast('soldierC')];
  z.objective(null);
  z.hint(null);
  game.ui.marker('z01-emitter', null);
  game.audio.stinger('encounterClear');
  S.emitter?.remove();
  yield 1.2;

  yield* z.cinematic('z01-clear', function* (c: CineCtx): Routine {
    // the squad leaves the pocket; the camera gives the growth on the rib one clear look. Nobody remarks on it.
    for (const s of [malik, ...others]) s?.stopAction();
    walkTo(z, malik, 'malikEnd');
    walkTo(z, others[0], 'soldierAEnd');
    walkTo(z, others[1], 'soldierBEnd');
    walkTo(z, others[2], 'soldierCEnd', { run: true });
    lyessa?.moveTo(z.m('lyessaEnd'), { run: true, yaw: z.myaw('lyessaEnd') });
    if (z.skipping) lyessa?.teleport(z.m('lyessaEnd'), z.myaw('lyessaEnd'));
    const growth = z.m('growthLook');
    c.cut({ pos: z.P(RIB_X - 5.2, 5.6, 1.5), look: growth, fov: 40 });
    c.moveAsync({ pos: z.P(RIB_X - 3.1, 3.9, 0.95), look: growth, fov: 34 }, 4.2, 'inOut');
    yield 4.4;
    // in passing: a cracked plate, nothing more
    const m = malik ? malik.actor.pos : z.m('malikEnd');
    const l = lyessa ? lyessa.actor.pos : z.m('lyessaEnd');
    c.twoShot(m, l, { side: 1, distance: 1.9, fov: 36 });
    yield* z.say('Lyessa', 'Your gauntlet’s cracked.', { actor: lyessa }); // NEW
    c.twoShot(l, m, { side: -1, distance: 1.9, fov: 36 });
    malik?.play('lookAround');
    yield* z.say(MALIK, 'It’s nothing.', { actor: malik }); // NEW
    c.shot(z.player.pos, { yawDeg: 60, distance: 2.5, height: 1.5, lookHeight: 1.55, fov: 36 });
    yield* z.say('Tarrik', 'Move.', { actor: z.player });
    // end state — identical watched or skipped
    if (z.skipping) {
      for (const [s, at] of [[malik, 'malikEnd'], [others[0], 'soldierAEnd'], [others[1], 'soldierBEnd'], [others[2], 'soldierCEnd']] as const) {
        s?.teleport(z.m(at), z.myaw(at));
      }
    }
    if (S.exit) S.exit.setState('ready');
    z.setFlag('z01Cleared', true);
  });

  if (lyessa) lyessa.mode = 'follow';
  yield* standardExit(z, S.exit, 'Z02', { at: 'exit' });
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  { id: 'threshold', checkpoint: 'CP1', enter: (z) => spawnCast(z, 'threshold'), run: threshold },
  { id: 'e1', enter: (z) => spawnCast(z, 'fight'), run: e1 },
  { id: 'clear', enter: (z) => spawnCast(z, 'clear'), run: clear },
];

const Z01_DEF: ZoneDef = {
  id: 'Z01',
  title: 'Pressure Hall',
  art: 'relay-route',
  cast: ['secDrone', 'commandEmitter', 'dominionSoldier', 'lyessa'],
  build,
  beats,
  /** the tissue's grip eases toward its target on the sim clock (the insert animates it; a skip snaps it) */
  update(z, dt) {
    if (!S.tissue) return;
    S.grip = z.skipping ? S.gripTarget : S.grip + (S.gripTarget - S.grip) * Math.min(1, dt * 3.2);
    S.tissue.scale.setScalar(Math.max(0.001, S.grip));
  },
  dispose() {
    S = blank();
  },
};

export default Z01_DEF;

// re-exported for the unit test
export const Z01_LAYOUT = { W, D, LANE_N, THRESHOLD_X, E1_CAP, DECK_H, GOLD } as const;
