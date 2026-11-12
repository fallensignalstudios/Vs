/**
 * Z03 — the build: shell and west bay, the service path, cover, frost and tissue, the Reformation installation,
 * the dropship (hatch + tether), light, markers, far field. Numbers live in ./layout.ts.
 *
 * Cover rule for the scan: a scan sees the lead only along a clear line from the projector on the service deck.
 * Every hiding piece on the lower floor is a 2.2 m mass FACING the projector (`faceSource`), so its lee is a
 * readable pocket; low cover (1.2 m) and ice (translucent: it passes sight) do not hide a standing figure.
 */
import * as THREE from 'three';
import type { ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { BLUE, FACE, FROST, IVORY } from '../shared';
import {
  BAY_X0, D, DECK_H, DECK_N0, DECK_N1, DECK_X0, DECK_X1, EXIT_N, HATCH_HINGE_H, HATCH_LEN, HATCH_W, HOLO, LODGE_RIB_SPAN,
  LODGE_RIB_X, HOLO_H, HOLO_SCALE, RAMP_DN_X1, RAMP_UP_X0, RIB_COUNT, TETHER_FROM, TETHER_TO, RIB_H, RIB_SPACING, RIB_X0, SOURCE_N, SOURCE_STAND, SOURCE_X, TERMINAL,
  VAULT_RISE, W, WALL_H, WRECK_N, WRECK_REAR_X,
} from './layout';
import { S } from './state';

/** pale cold light: the exterior glow through the breach and the vault seams */
const PALE = 0xdcecff;

/**
 * LOOKS.frozen, a little lower and hazier: the white-gold reads as ice-lit stone rather than a sunlit hall, so the
 * scan planes' cold sheets, the conduits in the ice and the gold channels carry the frame. Integration (relay-route
 * painting): the air and the fill are a grey silver, not teal — the stone reads silver-white and the cold lives
 * in the frost, the light seams and the blue planes, which now separate from the walls behind them.
 */
const LOOK = {
  ...LOOKS.frozen,
  exposure: 1.0,
  fog: { color: 0x646b72, density: 0.024 },
  grade: { ...LOOKS.frozen.grade, tint: 0xf1f3f5, saturation: 0.86, contrast: 1.2, shadowsTint: 0xb6c2d0, highlightsTint: 0xfaf7f0 },
  ambient: { sky: 0xadb6bf, ground: 0x25262a, intensity: 0.48 },
  envIntensity: 0.8,
};
/** the light that comes in through the breach and the vault seams: cold daylight, a little less blue than ice */
const DAYLIGHT = 0xe6eef6;

/** kit yawDeg that makes a piece at (x, n) face the projector (its lee is the hiding pocket) */
export function faceSource(x: number, n: number): number {
  return (Math.atan2(SOURCE_X - x, SOURCE_N - n) * 180) / Math.PI;
}

export function buildSpace(b: ZoneBuilder): void {
  // the corridor runs east; the Wound sits west, over the breach the dropship came through
  b.game.sky.setHeading(Math.PI / 2);
  b.setEnv({
    sky: 'frozenInterior', look: LOOK, ambience: 'frozenCorridor', music: 'approachSelene',
    // high, from the breach in the west: long rib shadows run east down the corridor toward the installation
    key: { dirFrom: [-26, 7, 36], intensity: 1.35, color: DAYLIGHT },
  });
  buildShell(b);
  buildBay(b);
  buildService(b);
  buildCover(b);
  buildFrost(b);
  buildInstallation(b);
  buildLight(b);
  buildMarkers(b);
  buildScenic(b);
}

/** floor, long walls, ribs, the enclosed vault, the exit */
function buildShell(b: ZoneBuilder): void {
  // polish 4 (relay-route painting): the relay route's light grey WET marble — here a film of meltwater over the
  // stone — and smooth marble-slab walls carrying paired gold pipes (the north wall's run behind the frost)
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, inlay: 'channels', reflective: true, surfaceMaterial: 'ice', finish: 'wet' });
  b.wall({ from: [BAY_X0, D], to: [W, D], height: WALL_H, style: 'slab' });
  b.wall({ from: [BAY_X0, 0], to: [W, 0], height: WALL_H, style: 'framed' });
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'panelled', doors: [{ at: EXIT_N, width: 3, height: 3.5 }] });
  // full ribs carry the vault; their legs stand in the long walls, ice-clad
  b.ribRow({ x: RIB_X0, n: D / 2, span: D + 0.3, height: RIB_H, count: RIB_COUNT, spacing: RIB_SPACING, yawDeg: FACE.east, alongDeg: FACE.east, style: 'frozen' });
  // one enclosed vault over the corridor and the bay. Polish 4: half as many light seams — the vault's own ribs
  // stand every second bay (x = −14, 2, 18, 34, on the rib row's 18 and 34), so each seam runs 16 m between them —
  // and softer (the painting's light is daylight in the air, not lines in the ceiling)
  b.ceiling({
    x: (BAY_X0 + W) / 2, n: D / 2, w: W - BAY_X0, d: D, h: WALL_H, style: 'vaultClosed', rise: VAULT_RISE,
    bay: RIB_SPACING * 2, bayPhase: 1, hazeColor: 0xdfe6ee, glow: 0.75,
  });
  buildRelief(b);

  // exit: door, a short lit vestibule, the white point above with two lit pylons leading the eye up to it
  S.exit = b.door({ x: W, n: EXIT_N, yawDeg: FACE.east });
  S.exit.setState('locked');
  // polish 4: the exit sits at the back of a deep stepped portal, gold-lined (seen from the corridor)
  b.portal({ x: W - 0.3, n: EXIT_N, yawDeg: FACE.west, width: 3, height: 3.5, steps: 2, step: 0.22, depth: 0.75, head: 'pointed' });
  b.floor({ x: W + 3, n: EXIT_N, w: 6, d: 4.4, inlay: 'none' });
  b.wall({ from: [W, EXIT_N - 2.2], to: [W + 6, EXIT_N - 2.2], height: 5 });
  b.wall({ from: [W, EXIT_N + 2.2], to: [W + 6, EXIT_N + 2.2], height: 5 });
  b.wall({ from: [W + 6, EXIT_N - 2.2], to: [W + 6, EXIT_N + 2.2], height: 5, style: 'panelled' });
  b.ceiling({ x: W + 3, n: EXIT_N, w: 6, d: 4.4, h: 5, style: 'flat' });
  b.panelLight({ x: W + 5.6, n: EXIT_N, w: 2.2, d: 2.6, h: 0.9, facing: 'west', intensity: 2.2 });
  b.whitePoint({ x: W - 0.9, n: EXIT_N, h: 5.3, intensity: 1.8 });
  b.column({ x: W - 0.9, n: EXIT_N - 2.6, height: 8, style: 'pylon', lit: true });
  b.column({ x: W - 0.9, n: EXIT_N + 3.4, height: 8, style: 'pylon', lit: true });
}

/** wall faces (the walls are 0.6 m thick, centred on their lines) */
const SOUTH_FACE = 0.3;
const NORTH_FACE = D - 0.3;

/**
 * Polish 4 — the relay route's fine architectural detail, all collider-free: paired gold pipes with brackets and
 * junction boxes up the south wall above the service path and in the gaps between the north wall's frost curtains
 * (the ice grows round them), and tall soft-lit slots of cold daylight in the south wall between the ribs.
 */
function buildRelief(b: ZoneBuilder): void {
  const pr = { r: 0.1, spacing: 0.34, bracket: 2.6 } as const;
  // the south wall: above the ramp up, along the deck, above the ramp down (foot at the path's height there)
  const pathH = (x: number): number =>
    x < RAMP_UP_X0 ? 0 : x < DECK_X0 ? (DECK_H * (x - RAMP_UP_X0)) / (DECK_X0 - RAMP_UP_X0) : x <= DECK_X1 ? DECK_H : x < RAMP_DN_X1 ? (DECK_H * (RAMP_DN_X1 - x)) / (RAMP_DN_X1 - DECK_X1) : 0;
  for (const [x, jog] of [[15.6, 0.7], [23.6, -0.7], [31.6, 0.7], [40.4, -0.7]] as const) {
    const h0 = pathH(x) + 0.55;
    b.pipes([[x, SOUTH_FACE, h0], [x, SOUTH_FACE, 6.2], [x + jog, SOUTH_FACE, 6.9], [x + jog, SOUTH_FACE, WALL_H - 0.3]], { ...pr, facing: FACE.north, boxes: [0] });
  }
  // the north wall, in the gaps between the frost curtains (between a rib leg and the next curtain)
  for (const x of [12.3, 20.5, 29.5, 37.8, 45.4]) {
    b.pipes([[x, NORTH_FACE, 0.55], [x, NORTH_FACE, WALL_H - 0.3]], { ...pr, facing: FACE.south, boxes: [0] });
  }
  // the frozen air under the vault holds the daylight: a pale cold haze, densest up in the vault
  b.haze({ x: (BAY_X0 + W) / 2 + 4, n: D / 2, h: 5.5, w: W - BAY_X0 - 8, d: D - 1, height: WALL_H + VAULT_RISE - 5.5, density: 0.022, falloff: -0.75, color: 0xe4ecf4, intensity: 0.9 });
  // tall slots of cold daylight in the south wall, between the ribs, over the path
  for (const x of [13.0, 29.6, 37.4]) {
    b.slot({ x, n: SOUTH_FACE, h: pathH(x) + 1.0, yawDeg: FACE.north, width: 0.36, height: 4.6, color: 0xe8f0f8, intensity: 1.15 });
  }
}

/**
 * The west bay: the dropship lies nose-first among broken ribs, its torn rear wedged into a small frozen rib at
 * the corridor's mouth. The hatch and the tether are live objects (the arrival animates them).
 */
function buildBay(b: ZoneBuilder): void {
  const game = b.game;
  b.floor({ x: BAY_X0 / 2, n: D / 2, w: -BAY_X0, d: D, inlay: 'none', noSurface: true });
  b.wall({ from: [BAY_X0, 0], to: [BAY_X0, D], height: WALL_H, style: 'ribbed' });
  b.rib({ x: -6, n: D / 2, span: D + 0.3, height: RIB_H, style: 'broken', yawDeg: FACE.east });
  b.rib({ x: -14, n: D / 2, span: D + 0.3, height: RIB_H, style: 'frozen', yawDeg: FACE.east });
  // the rib the hull wedged into: its legs frame the hatch (Lyric's hand goes to the north one)
  b.rib({ x: LODGE_RIB_X, n: WRECK_N, span: LODGE_RIB_SPAN, height: 7.4, style: 'frozen', yawDeg: FACE.east });

  // the hull: nose west, rolled a little onto its north shoulder where it struck
  const wreck = game.sky.scenic.wreck('reformation', { scale: 1, seed: 33 });
  wreck.name = 'z03-dropship';
  wreck.position.copy(b.P(WRECK_REAR_X - 6.5, WRECK_N, 0));
  wreck.rotation.set(0, Math.PI / 2, 0.035);
  b.add(wreck);

  // nobody walks back into the hull: the rear pocket (where the three start) is the only floor beyond x = 0.3
  b.blocker({ x: 0.3, n: (WRECK_N - HATCH_W / 2 - 0.5) / 2, w: 0.6, d: WRECK_N - HATCH_W / 2 - 0.5, height: 4 });
  const nTop = WRECK_N + HATCH_W / 2 + 0.5;
  b.blocker({ x: 0.3, n: (nTop + D) / 2, w: 0.6, d: D - nTop, height: 4 });
  b.blocker({ x: -2.7, n: WRECK_N, w: 0.6, d: HATCH_W + 1.2, height: 4 });
  const pocket = b.P(-1.2, WRECK_N, 0);
  b.surface({ shape: { kind: 'rect', hx: 1.45, hz: HATCH_W / 2 + 0.5 }, x: pocket.x, z: pocket.z, y: 0, material: 'metal' });

  // the rear hatch: a ramp plate hinged at the bottom of the torn rear; closed it stands up, open it lies east
  const mats = b.mats;
  const pivot = new THREE.Group();
  pivot.name = 'z03-hatch';
  pivot.position.copy(b.P(WRECK_REAR_X, WRECK_N, HATCH_HINGE_H));
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.14, HATCH_LEN, HATCH_W), mats.get('refSlate'));
  plate.position.set(0, HATCH_LEN / 2, 0);
  pivot.add(plate);
  const ribs = new THREE.Mesh(new THREE.BoxGeometry(0.06, HATCH_LEN * 0.92, 0.12), mats.get('refSteel'));
  for (const z of [-1.05, -0.35, 0.35, 1.05]) {
    const r = ribs.clone();
    r.position.set(0.09, HATCH_LEN / 2, z);
    pivot.add(r);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, HATCH_W * 0.86), mats.emissive(BLUE, 2.4));
  strip.position.set(0.09, HATCH_LEN - 0.12, 0);
  pivot.add(strip);
  pivot.castShadow = true;
  b.keep(b.add(pivot));
  S.hatch = pivot;
  S.hatchLight = b.point({ x: WRECK_REAR_X - 1.5, n: WRECK_N, h: 1.9, color: 0xcfe4ff, intensity: 0, distance: 11 });

  // the anchor tether (world points): from the hull's top to the arch it is wedged under — taut once she fires it
  const from = TETHER_FROM.clone();
  const to = TETHER_TO.clone();
  const len = from.distanceTo(to);
  const tether = new THREE.Group();
  tether.name = 'z03-tether';
  tether.position.copy(from);
  tether.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  // (integration) a cable that reads at the establishing distance: thicker, its lit core brighter (it was a thread)
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, len, 8), mats.get('refSteel'));
  cable.position.y = len / 2;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, len, 6), mats.emissive(BLUE, 2.6));
  core.position.set(0.05, len / 2, 0.05);
  const tipMat = mats.emissive(BLUE, 3.4);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), tipMat);
  tip.position.y = len;
  const root = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.22, 8), mats.get('refNavy'));
  tether.add(cable, core, tip, root);
  tether.scale.set(1, 0.001, 1);
  b.keep(b.add(tether));
  S.tether = tether;
  S.tetherLen = len;
  // cargo the impact threw out of the rear
  b.prop('refCrate', { x: 4.9, n: 7.4, yawDeg: 24, variant: 1 });
  b.prop('refCrate', { x: 1.6, n: 18.3, yawDeg: -15, variant: 0 });
  b.prop('debrisSmall', { x: 2.4, n: 4.6, yawDeg: 60 });
  b.prop('debrisSmall', { x: 6.2, n: 15.4, yawDeg: 200 });
}

/** the upper service path along the south wall: ramp up, deck, ramp down — the angle on the projector */
function buildService(b: ZoneBuilder): void {
  const w = DECK_N1 - DECK_N0;
  const nMid = (DECK_N0 + DECK_N1) / 2;
  b.ramp({ x: (RAMP_UP_X0 + DECK_X0) / 2, n: nMid, w, d: DECK_X0 - RAMP_UP_X0, h0: 0, h1: DECK_H, yawDeg: FACE.east, rails: true, finish: 'wet' });
  b.deck({ x: (DECK_X0 + DECK_X1) / 2, n: nMid, w: DECK_X1 - DECK_X0, d: w, h: DECK_H, solidBelow: true, rails: ['n'], inlay: 'channels', finish: 'wet' });
  b.ramp({ x: (DECK_X1 + RAMP_DN_X1) / 2, n: nMid, w, d: RAMP_DN_X1 - DECK_X1, h0: 0, h1: DECK_H, yawDeg: FACE.west, rails: true, finish: 'wet' });
  // the route is offered in gold: a channel leads from the arrival pocket to the ramp foot and along the deck
  b.channel([[4.6, 8.6], [RAMP_UP_X0 - 0.4, nMid + 0.6]], { width: 0.07 });
  b.channel([[DECK_X0 + 0.4, DECK_N1 - 0.35], [DECK_X1 - 0.4, DECK_N1 - 0.35]], { h: DECK_H, width: 0.06 });
  // two Reformation crate stacks on the deck: the only cover from plane B up here
  for (const x of [23.4, 28.6]) b.coverHigh({ x, n: 1.7, h: DECK_H, w: 2.4, yawDeg: faceSource(x, 1.7), style: 'reformation' });
  // the projector's mast is solid to walk into but passes sight and shots (its own actor takes the hits)
  const p = b.P(SOURCE_X, SOURCE_N, DECK_H + 1);
  b.collider({ shape: { kind: 'cyl', r: 0.45, hy: 1 }, x: p.x, y: p.y, z: p.z, blocksSight: false, blocksShots: false, tag: 'prop:scanSource' });
  b.prop('cableBundle', { x: SOURCE_X + 1.6, n: 1.4, h: DECK_H, yawDeg: 90 });
  b.prop('refCrate', { x: SOURCE_X + 1.3, n: 3.4, h: DECK_H, yawDeg: 8, variant: 2 });
}

/** the lower floor's hiding pieces (each faces the projector) and a little low cover that does not hide */
function buildCover(b: ZoneBuilder): void {
  const high = (x: number, n: number, style: 'ancient' | 'reformation' | 'plate', w = 2.8): void => {
    b.coverHigh({ x, n, w, yawDeg: faceSource(x, n), style });
  };
  // plane A's stretch
  high(10.2, 12.4, 'ancient');
  high(14.4, 17.8, 'ancient', 3.0);
  high(17.6, 8.7, 'reformation', 2.6);
  // plane B's stretch
  high(22.8, 14.8, 'ancient', 3.0);
  high(26.3, 8.6, 'plate', 2.6);
  high(28.6, 17.6, 'ancient', 3.0);
  // ice has grown over the King-era plinths (it does not change what they hide)
  for (const [x, n] of [[14.4, 17.8], [22.8, 14.8], [28.6, 17.6]] as const) {
    b.frost({ x, n, w: 3.4, d: 1.5, height: 2.7, density: 0.5, yawDeg: faceSource(x, n) + 90, collider: false });
  }
  // low cover: something to read the floor by, never a hiding place from an elevated source
  b.coverLow({ x: 12.8, n: 7.0, yawDeg: 100, style: 'reformation' });
  b.coverLow({ x: 20.6, n: 19.6, yawDeg: 70, style: 'debris' });
  b.prop('refCrate', { x: 24.6, n: 11.2, yawDeg: 37, variant: 0 });
  b.prop('fallenPlate', { x: 31.6, n: 19.6, yawDeg: 210 });
}

/** frozen atmosphere along the walls (conduits shine through), ice at the feet of things, the tissue behind it */
function buildFrost(b: ZoneBuilder): void {
  // north wall curtains, clear of the walkway
  for (const [x, w] of [[7.5, 7], [16.5, 6], [25, 7], [33.5, 6], [41.5, 5]] as const) {
    b.frost({ x, n: D - 0.75, w, d: 1.1, height: 6.2, density: 0.7 });
  }
  // south wall: by the arrival, and above the deck between the crate stacks
  b.frost({ x: 2.6, n: 0.75, w: 4.6, d: 1.1, height: 5.6, density: 0.7 });
  b.frost({ x: 20.8, n: 0.6, h: DECK_H, w: 3.4, d: 0.9, height: 4.8, density: 0.6 });
  b.frost({ x: 26, n: 0.6, h: DECK_H, w: 2.6, d: 0.9, height: 4.8, density: 0.6 });
  // east wall either side of the installation
  b.frost({ x: W - 0.7, n: 17.5, w: 1.0, d: 6, height: 6, density: 0.6 });
  // ice formations at the feet of walls, ribs and the deck
  const ice: Array<[number, number, number, number?]> = [
    [7.2, 20.3, 10], [11.5, 5.1, 80, 0.8], [19.6, 20.6, 140], [30.8, 20.2, 210, 0.9], [36.6, 20.1, 40],
    [33.2, 5.2, 300, 0.7], [5.6, 1.9, 120, 0.8], [46.4, 19.6, 260],
  ];
  for (const [x, n, yawDeg, scale] of ice) b.prop('iceFormation', { x, n, yawDeg, scale });

  // the tissue behind the ice: faint, following the conduits; violet only at a real source
  b.corruption({ x: 17.2, n: D - 0.35, h: 1.6, r: 1.1, onWall: true, yawDeg: FACE.south, intensity: 0.35 });
  b.corruption({ x: 2.2, n: 0.35, h: 2.2, r: 0.9, onWall: true, yawDeg: FACE.north, intensity: 0.3 });
  // the patch that stirs when Lyric is asked what she feels (kept live so it can swell)
  S.stir = b.keep(b.corruption({ x: 37.4, n: D - 0.35, h: 1.5, r: 1.3, onWall: true, yawDeg: FACE.south, intensity: 0.45 }));
}

/** the deployed Reformation sensor installation at the east end, around the terminal */
function buildInstallation(b: ZoneBuilder): void {
  const [tx, tn] = TERMINAL;
  b.prop('refConsole', { x: tx, n: tn, yawDeg: FACE.west });
  b.prop('refSensorMast', { x: 45.6, n: 19.2, yawDeg: 230 });
  b.prop('refSensorMast', { x: 38.4, n: 19.8, yawDeg: 160 });
  b.prop('refCrate', { x: 45.9, n: 16.4, yawDeg: 6, variant: 1 });
  b.prop('refCrate', { x: 46.3, n: 14.6, yawDeg: -4, variant: 2 });
  b.prop('refCrate', { x: 37.6, n: 8.9, yawDeg: 52, variant: 0 });
  b.prop('refAmmoCase', { x: 44.1, n: 17.9, yawDeg: 20 });
  b.prop('cableBundle', { x: 41.2, n: 10.6, yawDeg: 210 });
  b.prop('cableBundle', { x: 38.6, n: 6.4, yawDeg: 240 });
  b.prop('ancientPylon', { x: 35.6, n: 20.2 });

  b.prop('refCrate', { x: HOLO[0], n: HOLO[1], yawDeg: FACE.west, variant: 2, scale: 1.15 });
  const holo = b.game.props.hologram('sensorReconstruction');
  holo.object.position.copy(b.P(HOLO[0], HOLO[1], HOLO_H));
  holo.object.rotation.y = b.yaw(FACE.west);
  holo.object.scale.setScalar(HOLO_SCALE);
  holo.params.visible = 0.6;
  holo.params.progress = 0;
  holo.setText('LOCAL SENSOR RECONSTRUCTION'); // NEW (display header)
  b.add(holo.object);
  b.onUpdate((dt, t) => holo.update(dt, t));
  S.holo = holo;
  S.holoVisible = 0.6;
}

/** about a dozen lights: the key, two pale shafts, the installation's cold blue, a gold hint on the offered route */
function buildLight(b: ZoneBuilder): void {
  b.spot({ x: 15, n: 11.5, h: WALL_H + 3.2, target: [16, 12, 0], angleDeg: 22, intensity: 700, shaft: true, color: PALE });
  b.spot({ x: 29.5, n: 12, h: WALL_H + 3.2, target: [28.5, 11.5, 0], angleDeg: 22, intensity: 650, shaft: true, color: PALE });
  // the installation and the projector: Reformation light, cold
  b.point({ x: 42, n: 13.2, h: 3.4, color: BLUE, intensity: 26, distance: 14 });
  b.point({ x: SOURCE_X - 0.6, n: SOURCE_N + 1.2, h: DECK_H + 2.6, color: BLUE, intensity: 14, distance: 9 });
  // the service ramp is an offered route: warm at its foot
  b.point({ x: RAMP_UP_X0 + 1.5, n: 5.2, h: 2.6, color: IVORY, intensity: 12, distance: 8 });
  // the arrival pocket: frost light off the ice so the three read against the hull
  b.point({ x: 5.2, n: 13.4, h: 3.4, color: FROST, intensity: 18, distance: 10 });
}

function buildMarkers(b: ZoneBuilder): void {
  // --- arrival (inside the hull's rear, then out of the hatch) ---
  b.marker('seleneHatch', -1.5, WRECK_N - 0.7, 0, FACE.east);
  b.marker('tharneHatch', -1.9, WRECK_N + 0.4, 0, FACE.east);
  b.marker('lyricHatch', -0.9, WRECK_N + 0.6, 0, FACE.east);
  b.marker('lyricStep', 2.9, WRECK_N + 0.9, 0, FACE.east);
  b.marker('tharneCatch', 2.75, WRECK_N + 0.3, 0, 14);
  b.marker('lyricWall', 3.3, WRECK_N + 2.55, 0, 20);
  b.marker('wallTouch', LODGE_RIB_X - 0.15, WRECK_N + LODGE_RIB_SPAN / 2 - 0.5, 1.38);
  b.marker('seleneStep', 4.4, WRECK_N - 0.9, 0, FACE.east);
  b.marker('start', 4.6, WRECK_N - 0.8, 0, FACE.east);
  b.marker('tharneStart', 3.4, WRECK_N + 0.6, 0, FACE.east);
  b.marker('lyricStart', 3.1, WRECK_N + 1.9, 0, FACE.east);

  // --- the scan ---
  b.marker('scanStart', 6.6, WRECK_N, 0, FACE.east);
  b.marker('scanLook', 4.2, WRECK_N - 0.4, 0, FACE.east);
  b.marker('tharneScan', 3.5, WRECK_N + 0.8, 0, FACE.east);
  b.marker('lyricScan', 2.9, WRECK_N + 2.0, 0, FACE.east);
  b.marker('past', 37.4, 12, 0, FACE.east);
  b.marker('source', SOURCE_X, SOURCE_N, DECK_H, FACE.west);
  b.marker('sourceStand', SOURCE_STAND[0], SOURCE_STAND[1], DECK_H, FACE.east);

  // --- the terminal ---
  const [tx, tn] = TERMINAL;
  b.marker('terminal', tx - 1.1, tn, 0, FACE.east);
  b.marker('terminalStart', 35.6, 12.6, 0, FACE.east);
  b.marker('tharneT0', 34.2, 13.9, 0, FACE.east);
  b.marker('lyricT0', 33.8, 11.3, 0, FACE.east);
  b.marker('tharneTerm', 40.9, 12.6, 0, 50);
  b.marker('lyricTerm', 39.2, 16.9, 0, 100);
  b.marker('holo', HOLO[0], HOLO[1], HOLO_H, FACE.west);
  b.marker('stir', 37.4, D - 0.5, 1.5);
  b.marker('exit', W - 1.9, EXIT_N, 0, FACE.east);
  b.marker('tharneExit', W - 4.2, EXIT_N + 1.4, 0, FACE.east);
  b.marker('lyricExit', W - 4.6, EXIT_N - 0.6, 0, FACE.east);
}

/** far field: frost motes and dust in the haze (the vault encloses everything; no sky is seen) */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  game.vfx.ambient('frostMotes', b.P(W / 2, D / 2, 4), { x: W, y: 8, z: D }, 0.7);
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 5), { x: W, y: 9, z: D }, 0.25);
}
