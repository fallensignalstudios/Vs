/**
 * Z04 — the space: shell, the three routes, cover islands as drawn, faction dressing, light, markers, the O2
 * replay and the far field. Every number lives in ./layout.ts.
 *
 * Look (concept `ref-concept-relay-route`): pale marble under silver daylight, massive columns with paired gold
 * conduits, navy Reformation sensor gear dropped among King-era plinths, a raised balcony on the right that opens
 * on the megastructure through a glass wall, a distant Dominion shield line in front of a great gold ring.
 */
import * as THREE from 'three';
import type { DeepPartial, Look, ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { AMBER, BLUE, FACE, IVORY } from '../shared';
import {
  COL_N, COL_R, COL_X, D, DECK, DECK_H, DOOR_H, DOOR_W, ENFORCER_POSTS, ENTRY_X, EXIT_X, POCKET, RAMP_S, RAMP_W, RIB_H,
  RIB_X, RX_A, RX_B, SCAN_S, SCAN_YAW, SCREEN_H, W, WALL_H,
} from './layout';
import { buildCrates, buildHaze, buildPipes, buildSlots } from './art';
import { S, resetState } from './state';

/**
 * LOOKS.relay with more haze and less fill: the far end recedes into silver air and the key, the shafts and the
 * strips carry the room (the shared preset reads as an evenly lit white box at this scale). Integration: the fill
 * came down and the contrast up (B's request — at 0.66 / 1.12 the hall read pale and flat). Polish 4: under the
 * bright coffers and over the wet grey floor the fill goes down again (0.36, contrast 1.26) and the warm sun through
 * the glass carries the modelling; the shadows are a neutral grey, not the preset's blue.
 */
const Z04_LOOK: DeepPartial<Look> = {
  ...LOOKS.relay,
  exposure: 1.0,
  // polish 4: warmer sunlit air (the painting's haze is a warm grey-white, not a cold blue); with the wet grey floor
  // and the bright coffers the hall reads pale, so the fill comes down again and the sun carries the modelling
  fog: { color: 0xb3b0aa, density: 0.012 },
  grade: { ...LOOKS.relay.grade, tint: 0xf8f6f2, saturation: 0.9, contrast: 1.26, shadowsTint: 0xbcc4d2, highlightsTint: 0xffefda },
  ambient: { ...LOOKS.relay.ambient, sky: 0xaeaeac, intensity: 0.36 },
};
/** polish 4: the sun through the east glass — a warm daylight, not the cold white of the integration wave */
const SUN = 0xfff0da;

export function build(b: ZoneBuilder): void {
  resetState();
  // the exterior glow comes through the east glass: put the Wound's bearing out there, north of east
  b.game.sky.setHeading(-Math.PI / 3);
  b.setEnv({
    sky: 'frozenInterior', look: Z04_LOOK, ambience: 'relayOverlook', music: 'approachSelene',
    // high from the east, through the glass wall: column shadows fall west across the floor (≥ 40° over the mirror floor)
    key: { dirFrom: [30, 6, 34], intensity: 3.1, color: SUN },
  });
  buildShell(b);
  buildHighRoute(b);
  buildServicePath(b);
  buildCover(b);
  buildDressing(b);
  buildCrates(b);
  buildLight(b);
  buildMarkers(b);
  buildReplay(b);
  buildScenic(b);
  b.finalize();
}

/** floor, walls, ribs and vault; the entry from Z03 and the exit to Z05 inside a great gold ring */
function buildShell(b: ZoneBuilder): void {
  // polish 4: the relay route's light-to-mid grey WET marble (the painting's floor), mirroring the pipes and the gold
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, inlay: 'channels', reflective: true, finish: 'wet' });
  const door = (at: number) => [{ at, width: DOOR_W, height: DOOR_H }];
  // polish 4 (relay-route painting): the long walls are smooth marble slabs in gold-framed recessed panels, carrying
  // paired gold pipes with brackets and junction boxes (./art.ts) — no tile grid, no lit seams
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'framed', doors: door(ENTRY_X) });
  b.wall({ from: [0, D], to: [W, D], height: WALL_H, style: 'framed', doors: door(EXIT_X) });
  // the west wall behind the colonnade: the same framed slabs, its pipe pairs between the column bays
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'framed' });
  buildPipes(b);
  buildSlots(b);
  // the right side is open to the megastructure: glass from floor to vault, in wide daylight panes (the painting's
  // open side — the hazy ribs and towers beyond read through 6 m bays, not a 3 m grille)
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'glass', mullionSpacing: 6 });
  // the ribs are pale structure, not light (their lit seams were the neon arcs over the hall)
  for (const x of RIB_X) b.rib({ x, n: D / 2, span: D - 1.4, height: RIB_H, yawDeg: FACE.east, lit: false });
  // polish 4: the upper hall is bright closed-ceiling haze — deep coffers open onto warm daylight (no sky, no stars)
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: RIB_H + 0.3, style: 'skylight', coffer: 5.5, glow: 2.0, hazeColor: 0xfff0dc, hazeBelow: false });
  buildHaze(b);

  // entry: the Z03 corridor end, sealed once she is through
  S.entry = b.door({ x: ENTRY_X, n: 0 });
  S.entry.setState('sealed');
  b.floor({ x: ENTRY_X, n: -2.6, w: 5, d: 5.2, inlay: 'none' });
  b.walls([[ENTRY_X - 2.5, 0], [ENTRY_X - 2.5, -5.2], [ENTRY_X + 2.5, -5.2], [ENTRY_X + 2.5, 0]], { height: 5, style: 'panelled' });
  b.ceiling({ x: ENTRY_X, n: -2.6, w: 5, d: 5.2, h: 5, style: 'flat' });

  // exit: door, a lit vestibule, the white point; the ring and two lit pylons lead the eye to it
  S.exit = b.door({ x: EXIT_X, n: D });
  S.exit.setState('locked');
  b.floor({ x: EXIT_X, n: D + 3, w: 4.4, d: 6, inlay: 'none' });
  b.wall({ from: [EXIT_X - 2.2, D], to: [EXIT_X - 2.2, D + 6], height: 5 });
  b.wall({ from: [EXIT_X + 2.2, D], to: [EXIT_X + 2.2, D + 6], height: 5 });
  b.wall({ from: [EXIT_X - 2.2, D + 6], to: [EXIT_X + 2.2, D + 6], height: 5, style: 'panelled' });
  b.ceiling({ x: EXIT_X, n: D + 3, w: 4.4, d: 6, h: 5, style: 'flat' });
  b.panelLight({ x: EXIT_X, n: D + 5.6, w: 2.4, d: 2.6, h: 0.9, facing: 'south', intensity: 2.2 });
  b.whitePoint({ x: EXIT_X, n: D - 0.9, h: DOOR_H + 2.1, intensity: 1.8 });
  b.column({ x: EXIT_X - 3.6, n: D - 0.9, height: 8.5, style: 'pylon', lit: true });
  b.column({ x: EXIT_X + 3.6, n: D - 0.9, height: 8.5, style: 'pylon', lit: true });
  goldRing(b);
}

/** the great King-era ring the exit stands in (concept: the circular gold door at the end of the hall) */
function goldRing(b: ZoneBuilder): void {
  const g = new THREE.Group();
  g.name = 'z04-ring';
  const rim = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.32, 10, 72), b.mats.get('goldTrim'));
  const seam = new THREE.Mesh(new THREE.TorusGeometry(4.75, 0.06, 6, 72), b.mats.emissive(IVORY, 2.4));
  rim.receiveShadow = true;
  g.add(rim, seam);
  g.position.copy(b.P(EXIT_X, D - 0.42, 5.9));
  b.add(g);
}

/** the high route: south ramp, +3 m deck against the glass, west ramp down, the O2 pocket */
function buildHighRoute(b: ZoneBuilder): void {
  const w = DECK.x1 - DECK.x0;
  const d = DECK.n1 - DECK.n0;
  b.ramp({ x: RAMP_S.x, n: RAMP_S.n, w: RAMP_S.w, d: RAMP_S.d, h0: 0, h1: DECK_H, yawDeg: FACE.north, rails: true, finish: 'wet' });
  b.deck({
    x: DECK.x0 + w / 2, n: DECK.n0 + d / 2, w, d, h: DECK_H, solidBelow: true, rails: ['s', 'w'], inlay: 'channels', finish: 'wet',
    railGaps: [
      { side: 's', at: RAMP_S.x - DECK.x0, width: RAMP_S.w },
      { side: 'w', at: RAMP_W.n - DECK.n0, width: RAMP_W.w },
      { side: 'w', at: (POCKET.n0 + POCKET.n1) / 2 - DECK.n0, width: POCKET.n1 - POCKET.n0 },
    ],
  });
  b.ramp({ x: RAMP_W.x, n: RAMP_W.n, w: RAMP_W.w, d: RAMP_W.d, h0: 0, h1: DECK_H, yawDeg: FACE.east, rails: true, finish: 'wet' });
  b.deck({
    x: (POCKET.x0 + POCKET.x1) / 2, n: (POCKET.n0 + POCKET.n1) / 2, w: POCKET.x1 - POCKET.x0, d: POCKET.n1 - POCKET.n0,
    h: DECK_H, solidBelow: true, rails: ['s', 'w'], inlay: 'none', finish: 'wet',
  });
  // cover on the deck: the oblique shot at receiver B is taken from behind it
  b.coverLow({ x: 51.5, n: 26, w: 3, d: 2, h: DECK_H, yawDeg: FACE.east, style: 'reformation' });
  b.coverLow({ x: 57.5, n: 33.5, w: 2.6, h: DECK_H, yawDeg: FACE.north, style: 'ancient' });
  // gold route light up the ramp and along the deck edge: the right flank is an offered path
  b.channel([[RAMP_S.x - RAMP_S.w / 2 - 0.4, 4], [RAMP_S.x - RAMP_S.w / 2 - 0.4, RAMP_S.n - RAMP_S.d / 2]], { width: 0.07 });
  b.channel([[DECK.x0 + 0.6, DECK.n0 + 0.6], [DECK.x1 - 0.6, DECK.n0 + 0.6]], { h: DECK_H, width: 0.06 });
}

/**
 * The left service path: a 4.4 m lane behind the west colonnade. Screens between the columns hide it from the
 * floor and from the scan head; it opens between the second and third columns and at both ends.
 */
function buildServicePath(b: ZoneBuilder): void {
  // (their paired gold pipes are in ./art.ts)
  for (const n of COL_N) b.column({ x: COL_X, n, r: COL_R, height: RIB_H, style: 'faceted', lit: false });
  const screen = (n0: number, n1: number) => b.wall({ from: [COL_X, n0], to: [COL_X, n1], height: SCREEN_H, thickness: 0.5, style: 'panelled' });
  screen(COL_N[0] + COL_R, COL_N[1] - COL_R);
  screen(COL_N[2] + COL_R, COL_N[3] - COL_R);
  // the service run itself: conduits along the west wall at knee height, a gold channel on the floor
  b.conduit([[0.45, 2, 0.5], [0.45, 35, 0.5]], { r: 0.11, collider: true });
  b.channel([[2.6, 1.5], [2.6, 34]], { width: 0.05, intensity: 1.2 });
}

/** cover islands as drawn: light = low (1.2 m), dark = high (2.2 m); the Enforcers hold behind theirs */
function buildCover(b: ZoneBuilder): void {
  // low
  b.coverLow({ x: 15.5, n: 34, w: 3, d: 2, yawDeg: FACE.east, style: 'ancient' });
  b.coverLow({ x: 26.5, n: 27.5, w: 3, d: 3, yawDeg: FACE.east, style: 'ancient' });
  b.coverLow({ x: 30.5, n: 7.2, w: 3.4, d: 1.3, yawDeg: FACE.north, style: 'reformation' }); // Tharne and Lyric hold here
  b.coverLow({ x: 39.5, n: 10.5, w: 3, d: 3, yawDeg: FACE.east, style: 'ancient' });
  // high
  b.coverHigh({ x: 12.5, n: 20.5, w: 3, d: 3, yawDeg: FACE.east, style: 'ancient' });
  b.coverHigh({ x: 25.5, n: 15.5, w: 3, d: 3, yawDeg: FACE.east, style: 'ancient' });
  b.coverHigh({ x: 44.5, n: 21.5, w: 3, d: 3, yawDeg: FACE.east, style: 'ancient' });
  b.coverHigh({ x: 47.5, n: 9.5, w: 3, d: 3, yawDeg: FACE.east, style: 'reformation' });
}

/** the Reformation sensor installation (cold blue, modular, temporary) and the Dominion line's kit (amber) */
function buildDressing(b: ZoneBuilder): void {
  // sensor gear around the receivers and the scan head
  b.prop('refSensorMast', { x: RX_A[0] + 2.2, n: RX_A[1] - 1.6, yawDeg: 300 });
  b.prop('refSensorMast', { x: RX_B[0] - 2.1, n: RX_B[1] - 1.5, yawDeg: 120 });
  b.prop('refConsole', { x: RX_A[0] - 2.4, n: RX_A[1] + 1.4, yawDeg: 150 });
  b.prop('cableBundle', { x: RX_A[0] - 1.2, n: RX_A[1] - 2.6, yawDeg: 20 });
  b.prop('cableBundle', { x: RX_B[0] + 1.6, n: RX_B[1] - 2.4, yawDeg: 160 });
  b.prop('cableBundle', { x: SCAN_S[0] + 1.6, n: SCAN_S[1] - 1.8, yawDeg: 70 });
  b.prop('refCrate', { x: 22.2, n: 4.8, yawDeg: 8, variant: 1 });
  b.prop('refCrate', { x: 23.9, n: 4.3, yawDeg: 22, variant: 0 });
  b.prop('refCrate', { x: 41.6, n: 12.8, yawDeg: -6, variant: 2 });
  b.prop('refCrate', { x: 27.6, n: 13.3, yawDeg: 4, variant: 1 });
  b.prop('refCrate', { x: 59.4, n: 4.2, yawDeg: 14, variant: 0 });
  b.prop('refCrate', { x: 59.8, n: 6.2, yawDeg: -10, variant: 2 });
  b.prop('refAmmoCase', { x: 33.1, n: 6.4, yawDeg: 30 });
  b.prop('refLamp', { x: 36.8, n: 4.2, yawDeg: 300 });
  b.prop('refLamp', { x: 10.4, n: 9.6, yawDeg: 40 });
  b.prop('refCrate', { x: 58.6, n: 30.5, h: DECK_H, yawDeg: 6, variant: 1 });
  b.prop('refSensorMast', { x: 59.6, n: 27.2, h: DECK_H, yawDeg: 250 });
  // the Dominion line's kit behind the shield angle
  b.prop('domCrate', { x: 17.4, n: 36.6, yawDeg: 6, variant: 0 });
  b.prop('domCrate', { x: 26.6, n: 36.7, yawDeg: -4, variant: 2 });
  b.prop('domAmmoCase', { x: 21.6, n: 36.9, yawDeg: 12 });
  b.prop('domLamp', { x: 24.2, n: 36.8, yawDeg: 180 });
  // the frost of the sensor corridor has crept through the entry
  b.prop('iceFormation', { x: ENTRY_X - 3.4, n: 0.9, yawDeg: 20 });
  b.prop('iceFormation', { x: ENTRY_X + 3.8, n: 0.8, yawDeg: 200, scale: 0.8 });
  // ancient furniture and wreckage
  b.prop('ancientPylon', { x: 17.5, n: 1.4 });
  b.prop('ancientPylon', { x: 44.5, n: 1.4 });
  b.prop('ancientBench', { x: 9.4, n: 17.4, yawDeg: 90 });
  b.prop('fallenPlate', { x: 8.6, n: 33.2, yawDeg: 30 });
  b.prop('rubblePile', { x: 2.6, n: 36.4 });
  b.prop('debrisSmall', { x: 19.2, n: 11.5 });
  b.prop('debrisSmall', { x: 46.5, n: 16.4, yawDeg: 120 });
  b.prop('debrisSmall', { x: 2.4, n: 15.5, yawDeg: 60 });
  // the devices are actors without colliders: a small solid keeps bodies out of them (shots and sight pass)
  for (const [x, n, r] of [[RX_A[0], RX_A[1], 0.55], [RX_B[0], RX_B[1], 0.55], [SCAN_S[0], SCAN_S[1], 0.5]] as const) {
    const p = b.P(x, n, 0.9);
    b.collider({ shape: { kind: 'cyl', r, hy: 0.9 }, x: p.x, y: p.y, z: p.z, blocksShots: false, blocksSight: false, tag: 'prop:device' });
  }
}

/** a dozen lights: the key, two shafts down the central bay and on B, faction and route accents */
function buildLight(b: ZoneBuilder): void {
  b.spot({ x: 30, n: 21, h: RIB_H - 1.5, target: [30, 21.5, 0], angleDeg: 24, intensity: 1500, shaft: true, color: SUN });
  b.spot({ x: 15, n: 27.5, h: RIB_H - 1.5, target: [16, 27, 0], angleDeg: 17, intensity: 1100, shaft: true, color: SUN });
  // polish 4: the sun through the east glass — a long warm shaft slanting down across the deck onto the floor
  b.spot({ x: W + 6, n: 15, h: 17, target: [38, 13, 0], angleDeg: 13, penumbra: 0.6, intensity: 2600, shaft: true, color: SUN });
  // Selene's side holds at the entry: cold Reformation light
  b.point({ x: ENTRY_X, n: 3.2, h: 3, color: BLUE, intensity: 16, distance: 10 });
  // the Dominion line: amber from their own lamps behind the shields
  b.point({ x: 23, n: 35.6, h: 2.6, color: AMBER, intensity: 34, distance: 13 });
  // the deck and the pocket
  b.point({ x: 52, n: 31, h: DECK_H + 4, color: IVORY, intensity: 30, distance: 16 });
  b.point({ x: 38.5, n: 36, h: DECK_H + 2.6, color: IVORY, intensity: 12, distance: 8 });
  // the service lane behind the colonnade stays readable
  b.point({ x: 2.6, n: 18, h: 3.2, color: 0xdfe8ff, intensity: 18, distance: 14 });
}

function buildMarkers(b: ZoneBuilder): void {
  // --- Selene's side (entry) ---
  b.marker('start', ENTRY_X, 1.8, 0, FACE.north);
  b.marker('tharneHold', 29.3, 5.1, 0, FACE.north);
  b.marker('lyricHold', 31.9, 4.9, 0, FACE.north);
  b.marker('tharneExit', 28.4, 34.8, 0, 30);
  b.marker('lyricExit', 30.4, 33.2, 0, 60);
  // --- E2 ---
  ENFORCER_POSTS.forEach(([x, n, yaw], i) => b.marker(`enf${i}`, x, n, 0, yaw));
  b.marker('droneA', 38.6, 21.4, 0, 250);
  b.marker('droneB', 18.6, 23.6, 0, 20);
  b.marker('droneAFwd', 36.4, 12.6, 0, 210);
  b.marker('droneBFwd', 22.6, 15.2, 0, 190);
  b.marker('receiverA', RX_A[0], RX_A[1], 0, 200);
  b.marker('receiverB', RX_B[0], RX_B[1], 0, 160);
  b.marker('scanHead', SCAN_S[0], SCAN_S[1], 0, SCAN_YAW);
  // --- recovery ---
  b.marker('sustainService', 2.6, 24.5, 0);
  b.marker('sustainLow', 25.5, 13.1, 0);
  b.marker('sustainDeck', 56.5, 36, DECK_H);
  b.marker('sustainEast', 59.6, 14.5, 0);
  // --- O2 and the exit ---
  b.marker('o2View', 38.4, 34.7, DECK_H, FACE.north);
  b.marker('o2Holo', 38.4, 36.5, DECK_H, FACE.south);
  b.marker('tharneO2', 41.2, 35.3, DECK_H, 290);
  b.marker('exit', EXIT_X, D - 1.4, 0, FACE.north);
  b.marker('releaseStart', 30, 24, 0, FACE.north);
}

/** O2: the sensor reconstruction stands in the pocket, dark until the lead wakes it */
function buildReplay(b: ZoneBuilder): void {
  const holo = b.game.props.hologram('sensorReconstruction');
  holo.object.position.copy(b.getMarker('o2Holo').pos);
  holo.object.rotation.y = b.yaw(FACE.south);
  holo.params.visible = 0;
  holo.params.progress = 0;
  holo.setText('LOCAL SENSOR RECORD'); // NEW (display header)
  b.add(holo.object);
  b.onUpdate((dt, t) => holo.update(dt, t));
  S.holo = holo;
}

/** far field: the megastructure beyond the glass, a nave of distant ribs marching east, dust in the shafts */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const vista = game.sky.scenic.terminalVista({ radius: 2400, seed: 404, density: 0.8, drop: 160, clearWound: false });
  vista.name = 'z04-vista';
  vista.position.copy(b.P(W + 6, D / 2, 0));
  vista.rotation.y = -Math.PI / 2;
  b.add(vista);
  const nave = game.sky.scenic.megaRibs({ count: 6, span: 150, height: 110, spacing: 80, seed: 44 });
  nave.name = 'z04-nave';
  nave.position.copy(b.P(W + 40, D / 2, -20));
  nave.rotation.y = -Math.PI / 2;
  b.add(nave);
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 6), { x: W, y: 12, z: D }, 0.45);
  game.vfx.ambient('goldMotes', b.P(30, 22, 5), { x: 20, y: 9, z: 14 }, 0.2);
}
