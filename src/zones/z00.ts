/**
 * Z00 · Broken landing — lead: Tarrik. The opening of the game.
 *
 *   constants → build (shell, breach, bulkhead, doorway, dressing, light, markers, scenic) → cast → beats → ZoneDef
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north): a 28 × 22 m white-gold chamber
 * whose north side is torn open. Through the fractured rib over the breach lies the crash apron — the burning
 * Dominion wreck, smoke, and the contained black Wound far off in the sky (Wound north, heading 0). The squad
 * shelters in the west half under the intact vault. A collapsed bulkhead at x = 16.5 crosses the room with one
 * gap, where a damaged maintenance arm swings (guard); beyond it, the lit rib doorway in the east wall is
 * jammed by a buckled blast shutter (heavy attack). The gap and the doorway sit on one line (n = 7): from the
 * pocket the white point is framed through the arm. Exit: east, to Z01.
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z00. The author's lines are exact (curly apostrophes are the book's); every line
 * and UI string written for the game is tagged `// NEW`. No soldier is named in Z00.
 *
 * FILES: ./z00/context.ts (the five context cards), ./z00/obstruction.ts (arm + plate), ./z00/smoke.ts.
 */
import * as THREE from 'three';
import type { Beat, CineCtx, Companion, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { AMBER, BLUE, CINDER, FACE, atPost, setDoor, tutorialHint, waitOr, walkTo } from './shared';
import { LANDING_SKY, contextScene } from './z00/context';
import {
  armObstruction, buildArm, buildPlate, obstruction, resetObstruction, restoreObstruction, setVestibuleLight,
  updateObstruction,
} from './z00/obstruction';
import { smokeColumn, type SmokeColumn } from './z00/smoke';

// =====================================================================================================================
// Constants
// =====================================================================================================================

/** playable envelope (plan §Z00: 28 × 22 m) */
const W = 28;
const D = 22;
const WALL_H = 12;
const RIB_H = 16.5;
/** the breach in the north wall (x range) and the rubble edge the lead can walk up to */
const BREACH_X0 = 5;
const BREACH_X1 = 23;
const EDGE_N = 20.3;
/** the vault survives over the south part only (n 0 … VAULT_D) */
const VAULT_D = 12.5;
/** collapsed bulkhead across the room and its single gap (where the arm swings) */
const BULK_X = 16.5;
const BULK_H = 3.6;
const GAP_N = 7;
const GAP_W = 2.6;
const ARM_PIVOT_H = 4.35;
/** the lit rib doorway (east wall) and its vestibule */
const EXIT_N = GAP_N;
const VEST_X1 = W + 5.5;
/** the wreck on the crash apron, and the apex line of the fractured rib the shots look through */
const WRECK: [number, number] = [24, 44];
const RIB: [number, number] = [14, 21.2];

/** speaker label for the squad until Z02 names one of them */
const SOLDIER = 'Dominion Soldier';

// =====================================================================================================================
// Per-load state
// =====================================================================================================================

interface Z00 {
  ship: THREE.Object3D | null;
  shipT: number;
  shipActive: boolean;
  sweep: THREE.SpotLight | null;
  smoke: SmokeColumn[];
  key: THREE.DirectionalLight | null;
  keyBase: number;
}
let S: Z00 = blank();
function blank(): Z00 {
  return { ship: null, shipT: 0, shipActive: false, sweep: null, smoke: [], key: null, keyBase: 0 };
}

// =====================================================================================================================
// Build
// =====================================================================================================================

function build(b: ZoneBuilder): void {
  S = blank();
  resetObstruction();
  b.game.sky.setHeading(0);
  b.setEnv({
    // a touch darker than the stock crash look: the shelter is lit by its amber lamp, not by the sky
    sky: 'crashRib', look: { ...LOOKS.crash, exposure: 0.86 }, ambience: 'crash', music: 'context',
    // the white remnant, high in the north-east, falls through the breach; the vault keeps the pocket in shade
    key: { dirFrom: [16, 26, 30], intensity: 2.0, color: 0xffeedd },
  });
  buildShell(b);
  buildBreach(b);
  buildBulkhead(b);
  buildDoorway(b);
  buildPocket(b);
  buildLight(b);
  buildMarkers(b);
  buildScenic(b);
  b.finalize();
  S.key = b.keyLight;
  S.keyBase = b.keyLight ? b.keyLight.intensity : 0;
}

/** floor, the intact walls, the ribs and the surviving half of the vault */
function buildShell(b: ZoneBuilder): void {
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, inlay: 'channels', reflective: true });
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'panelled' });
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'ribbed' });
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'panelled', doors: [{ at: EXIT_N, width: 3, height: 3.5 }] });
  b.wall({ from: [0, D], to: [BREACH_X0, D], height: WALL_H, style: 'conduit' });
  b.wall({ from: [BREACH_X1, D], to: [W, D], height: WALL_H, style: 'conduit' });
  // four ribs carry the vault; the two over the breach side are fractured
  b.rib({ x: 3, n: D / 2, span: D - 1, height: RIB_H, yawDeg: FACE.east, lit: true });
  b.rib({ x: 10.2, n: D / 2, span: D - 1, height: RIB_H, yawDeg: FACE.east, style: 'broken' });
  b.rib({ x: 19.6, n: D / 2, span: D - 1, height: RIB_H, yawDeg: FACE.east, lit: true });
  b.rib({ x: 25.6, n: D / 2, span: D - 1, height: RIB_H, yawDeg: FACE.east, style: 'broken' });
  b.ceiling({ x: W / 2, n: VAULT_D / 2, w: W, d: VAULT_D, h: RIB_H + 0.3, style: 'vault' });
}

/** the torn north side: the fractured rib framing the breach, a rubble edge, the dead laid out near it */
function buildBreach(b: ZoneBuilder): void {
  b.rib({ x: RIB[0], n: RIB[1], span: BREACH_X1 - BREACH_X0 + 1, height: 18, yawDeg: FACE.north, style: 'broken', noCollider: true });
  // broken wall stubs along the breach and the rubble line; the edge itself is blocked off
  b.wall({ from: [BREACH_X0, D], to: [BREACH_X0 + 3.6, D], height: 2.4, style: 'plain' });
  b.wall({ from: [BREACH_X1 - 2.8, D], to: [BREACH_X1, D], height: 1.6, style: 'plain' });
  b.wall({ from: [11.5, D - 0.2], to: [13.4, D - 0.2], height: 0.9, style: 'plain' });
  b.blocker({ x: (BREACH_X0 + BREACH_X1) / 2, n: (EDGE_N + D) / 2 + 0.2, w: BREACH_X1 - BREACH_X0, d: D - EDGE_N + 0.4, height: 3 });
  for (const [x, n, yaw, s] of [[7.6, 21.1, 20, 1.2], [10.4, 21.4, -30, 0.9], [15.5, 21.2, 70, 1.3], [19.4, 21.0, 10, 1.1], [21.6, 21.5, -50, 0.8]] as const) {
    b.prop('rubblePile', { x, n, yawDeg: yaw, scale: s, collider: false });
  }
  b.prop('fallenPlate', { x: 17.2, n: 20.4, yawDeg: 160, scale: 1.4, collider: false });
  b.prop('debrisSmall', { x: 12.6, n: 19.4, yawDeg: 40 });
  b.prop('debrisSmall', { x: 20.8, n: 19.0, yawDeg: 110 });
  // the dead the squad carried in out of the wreck, under tarps by the breach
  b.prop('casualtyTarp', { x: 8.2, n: 18.4, yawDeg: 95 });
  b.prop('casualtyTarp', { x: 10.1, n: 18.7, yawDeg: 80 });
  // the crash apron outside (visual only): scorched white-gold paving running out to the wreck
  b.floor({ x: 14, n: 64, w: 150, d: 84, h: -0.05, inlay: 'channels', noSurface: true });
}

/** the collapsed bulkhead with its one gap, the gantry and the arm */
function buildBulkhead(b: ZoneBuilder): void {
  const g0 = GAP_N - GAP_W / 2;
  const g1 = GAP_N + GAP_W / 2;
  b.wall({ from: [BULK_X, 0], to: [BULK_X, g0], height: BULK_H, thickness: 1.1, style: 'ribbed' });
  b.wall({ from: [BULK_X, g1], to: [BULK_X, EDGE_N + 0.2], height: BULK_H, thickness: 1.1, style: 'ribbed' });
  // the break line on top of the bulkhead and at its north end
  b.prop('rubblePile', { x: BULK_X + 0.2, n: EDGE_N - 0.6, scale: 1.1, yawDeg: 15 });
  b.prop('rubblePile', { x: BULK_X - 0.9, n: 14.5, scale: 0.8, yawDeg: 70 });
  b.prop('fallenPlate', { x: BULK_X - 1.4, n: 11.2, yawDeg: 280, scale: 1.2 });
  b.prop('debrisSmall', { x: BULK_X + 1.4, n: g1 + 1.4, yawDeg: 30 });
  b.prop('conduitJunction', { x: BULK_X + 0.9, n: g0 - 0.8 });
  b.conduit([[BULK_X + 0.62, 0.4, ARM_PIVOT_H - 0.6], [BULK_X + 0.62, g0 - 0.3, ARM_PIVOT_H - 0.6]], { r: 0.08, glow: true });
  buildArm(b, BULK_X, GAP_N, GAP_W, ARM_PIVOT_H);
}

/** the lit rib doorway, the buckled shutter jammed in it, the vestibule and a glimpse of the next chamber */
function buildDoorway(b: ZoneBuilder): void {
  setDoor(b.door({ x: W, n: EXIT_N, yawDeg: FACE.east, frameOnly: true }), true, 'ready');
  buildPlate(b, W, EXIT_N, 3);
  // vestibule (x W … W + 5.5): lit from its far end
  b.floor({ x: (W + VEST_X1) / 2, n: EXIT_N, w: VEST_X1 - W, d: 4.4, inlay: 'none' });
  b.wall({ from: [W, EXIT_N - 2.2], to: [VEST_X1, EXIT_N - 2.2], height: 5 });
  b.wall({ from: [W, EXIT_N + 2.2], to: [VEST_X1, EXIT_N + 2.2], height: 5 });
  b.ceiling({ x: (W + VEST_X1) / 2, n: EXIT_N, w: VEST_X1 - W, d: 4.4, h: 5, style: 'flat' });
  b.blocker({ x: VEST_X1 - 0.6, n: EXIT_N, w: 1.2, d: 4.4, height: 4 });
  // the far end opens on the next chamber (dark; the passing ship's light shows it once)
  b.floor({ x: VEST_X1 + 10, n: EXIT_N, w: 20, d: 22, h: -0.02, inlay: 'channels', noSurface: true });
  b.rib({ x: VEST_X1 + 4, n: EXIT_N, span: 20, height: 15, yawDeg: FACE.east, lit: true, noCollider: true });
  b.rib({ x: VEST_X1 + 12, n: EXIT_N, span: 20, height: 15, yawDeg: FACE.east, lit: true, noCollider: true });
  b.wall({ from: [VEST_X1 + 20, EXIT_N - 11], to: [VEST_X1 + 20, EXIT_N + 11], height: 12, style: 'panelled', noCollider: true });
  const flood = b.panelLight({ x: VEST_X1 - 1.4, n: EXIT_N, w: 2.4, d: 3, h: 4.9, facing: 'down', intensity: 2.6, color: 0xfff0d6 });
  flood.visible = false;
  setVestibuleLight(flood);
  b.panelLight({ x: W + 2.2, n: EXIT_N, w: 1.6, d: 2.2, h: 4.95, facing: 'down', intensity: 1.6, color: 0xffe6c0 });
  // the white point: the brightest thing at the east end; two lit pylons lead the eye up to it
  b.whitePoint({ x: W - 0.9, n: EXIT_N, h: 5.2, intensity: 1.8 });
  b.column({ x: W - 0.9, n: EXIT_N - 3.2, height: 8.5, style: 'pylon', lit: true });
  b.column({ x: W - 0.9, n: EXIT_N + 3.2, height: 8.5, style: 'pylon', lit: true });
}

/** the squad's shelter: field kit under the surviving vault (Dominion gear, temporary, small in the room) */
function buildPocket(b: ZoneBuilder): void {
  b.prop('domFieldCache', { x: 2.2, n: 9.6, yawDeg: 90 });
  b.prop('domLamp', { x: 3.4, n: 12.6, yawDeg: 120 });
  b.prop('domCrate', { x: 10.3, n: 4.7, yawDeg: 12, variant: 1 });
  b.prop('domCrate', { x: 2.0, n: 4.4, yawDeg: -20 });
  b.prop('domAmmoCase', { x: 3.6, n: 5.6, yawDeg: 60 });
  b.prop('medKit', { x: 12.1, n: 3.7, yawDeg: 30 });
  b.prop('domStretcher', { x: 5.6, n: 15.6, yawDeg: 80 });
  b.prop('cableBundle', { x: 1.6, n: 7.2, yawDeg: 90 });
  b.prop('ancientBench', { x: 6.6, n: 1.4, yawDeg: 0 });
  b.prop('fallenPlate', { x: 13.2, n: 15.6, yawDeg: 40 });
  b.prop('debrisSmall', { x: 8.6, n: 6.2, yawDeg: 15 });
  b.prop('debrisSmall', { x: 21.4, n: 12.8, yawDeg: 75 });
  b.prop('rubblePile', { x: 24.6, n: 16.4, scale: 0.9, yawDeg: 200 });
  b.coverLow({ x: 21.5, n: 3.4, yawDeg: FACE.east, style: 'plate' });
  // a gold route channel from the gap to the doorway: the substrate itself points the way
  b.channel([[BULK_X + 1.4, GAP_N], [W - 2.4, GAP_N]], { width: 0.08, intensity: 2.2 });
}

/** a dozen lights at most: key (setEnv), fires, the shelter's amber, the doorway, the sweep that reveals the hall */
function buildLight(b: ZoneBuilder): void {
  b.point({ x: 5.4, n: 9.4, h: 2.4, color: AMBER, intensity: 16, distance: 11, flicker: 0.08 });
  // the wreck burns: warm light low on the apron
  b.point({ x: WRECK[0] - 3, n: WRECK[1] - 5, h: 2.5, color: CINDER, intensity: 140, distance: 34, flicker: 0.35 });
  b.point({ x: WRECK[0] + 5, n: WRECK[1] + 2, h: 4, color: AMBER, intensity: 90, distance: 30, flicker: 0.3 });
  // a cool bounce off the breach so the squad separates from the shaded wall
  b.point({ x: 12, n: 16.5, h: 6, color: 0xc8d8ec, intensity: 12, distance: 16 });
  // the passing ship's light: sweeps the next chamber once (intensity driven by the landing scene)
  // (it streams back through the vestibule and the doorway, over the jammed plate, into the room)
  const sweep = b.spot({ x: VEST_X1 + 9, n: EXIT_N, h: 6.5, target: [W - 3, EXIT_N, 0], angleDeg: 20, intensity: 0, color: BLUE, shaft: true });
  S.sweep = sweep;
}

function buildMarkers(b: ZoneBuilder): void {
  // --- after the opening: the squad in the shelter ---
  b.marker('start', 7.6, 8.4, 0, FACE.east);
  b.marker('lyessa', 6.0, 10.6, 0, FACE.east); // half a metre farther from him than she once stood
  b.marker('lyessaAim', 6.4, 11.4, 0, FACE.north);
  b.marker('lyessaWait', 13.4, 9.6, 0, FACE.east);
  b.marker('malik', 4.6, 6.0, 0, 70);
  b.marker('soldierA', 4.0, 8.9, 0, FACE.east);
  b.marker('soldierB', 9.2, 12.4, 0, 120);
  b.marker('soldierC', 3.2, 12.4, 0, 100);
  b.marker('wounded', 11.4, 5.0, 0, 80); // seated against the crate, facing the gap and the doorway beyond it
  // --- once the way is open: the squad gathers at the doorway ---
  b.marker('malikDoor', 22.4, 5.0, 0, FACE.east);
  b.marker('soldierADoor', 23.6, 9.4, 0, FACE.east);
  b.marker('soldierBDoor', 21.2, 8.2, 0, FACE.east);
  b.marker('soldierCDoor', 20.6, 4.2, 0, FACE.east);
  // --- the obstruction ---
  b.marker('arm', BULK_X, GAP_N, 0, FACE.east);
  b.marker('armApproach', BULK_X - 5.5, GAP_N, 0, FACE.east);
  b.marker('plate', W - 1.4, EXIT_N, 0, FACE.east);
  b.marker('exit', W + 1.6, EXIT_N, 0, FACE.east);
  b.marker('breachLook', RIB[0], RIB[1], 4);
}

/** far field: the outer chamber's nave beyond the breach, the wreck, smoke and embers */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const nave = game.sky.scenic.megaRibs({ count: 6, span: 230, height: 170, spacing: 120, seed: 7 });
  nave.position.copy(b.P(14, 95, -10));
  b.add(nave);
  const wreck = game.sky.scenic.wreck('dominion', { scale: 1.25, seed: 3 });
  wreck.position.copy(b.P(WRECK[0], WRECK[1], 0));
  wreck.rotation.y = b.yaw(28);
  b.add(wreck);
  for (const [x, n, h, s] of [[WRECK[0] - 2, WRECK[1] - 1, 30, 1], [WRECK[0] + 6, WRECK[1] + 3, 22, 0.75], [-26, 82, 40, 1.4]] as const) {
    const col = smokeColumn({ height: h, size0: 3.2 * s, size1: 15 * s, wind: [9, 4], seed: Math.round(x * 7 + n), opacity: 0.55 });
    col.object.position.copy(b.P(x, n, 0.5));
    b.add(col.object);
    S.smoke.push(col);
  }
  b.onUpdate((_dt, t) => {
    for (const c of S.smoke) c.update(t);
  });
  // the dropship that crosses the fracture during the landing (hidden until then)
  const ship = game.sky.scenic.ship('reformationTransport');
  ship.visible = false;
  ship.rotation.y = -Math.PI / 2;
  for (const [x, y, z] of [[0, 1.2, -15], [6.5, 0.8, 2], [-6.5, 0.8, 2]] as const) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), b.mats.emissive(BLUE, 9));
    light.position.set(x, y, z);
    ship.add(light);
  }
  b.add(ship);
  b.keep(ship);
  S.ship = ship;
  game.vfx.ambient('embers', b.P(WRECK[0], WRECK[1] - 6, 4), { x: 34, y: 10, z: 30 }, 0.7);
  game.vfx.ambient('ash', b.P(14, 16, 6), { x: 30, y: 12, z: 14 }, 0.35);
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 4), { x: W, y: 8, z: D }, 0.55);
}

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'context' | 'landing' | 'open';

/**
 * Spawn the lead and the squad as the stage finds them: Lyessa, five soldiers (the one who will be Malik Varo
 * among them; one wounded, seated). `open` = the way is open (arm seized, plate down).
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const open = stage === 'open';
  z.spawnPlayer('tarrik', 'start');
  const lyessa = z.companion('lyessa', open ? 'lyessaWait' : 'lyessa', open ? 'follow' : 'hold');
  if (!open) lyessa.holdAt(z.m('lyessa'), z.myaw('lyessa'));
  z.npc('dominionSoldier', open ? 'malikDoor' : 'malik', 'idle', 'malik');
  z.npc('dominionSoldier', open ? 'soldierADoor' : 'soldierA', 'idle', 'soldierA');
  z.npc('dominionSoldier', open ? 'soldierBDoor' : 'soldierB', 'idle', 'soldierB');
  z.npc('dominionSoldier', open ? 'soldierCDoor' : 'soldierC', 'idle', 'soldierC');
  z.npc('dominionSoldier', 'wounded', 'sitInjured', 'wounded');
  const sky = z.game.sky;
  if (stage !== 'context') {
    sky.setBattleIntensity(LANDING_SKY.battle);
    sky.setWoundActivity(LANDING_SKY.wound);
    z.game.audio.setMusic('approachTarrik', 0.5);
  }
  if (open) restoreObstruction(true, true);
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `context` → CP0: the five cards over the crash aftermath, ending on the Wound. */
function* context(z: ZoneRuntime): Routine {
  yield; // the loader shows the zone card after the first tick of this routine; the context scene withdraws it
  yield* contextScene(z, WRECK, RIB);
}

/** ZoneDef.update: the dropship's pass (its light reveals the next chamber), the obstruction */
function update(z: ZoneRuntime, dt: number): void {
  updateObstruction(z, dt);
  const ship = S.ship;
  if (!ship || !S.shipActive) return;
  S.shipT = z.skipping ? 1 : Math.min(1, S.shipT + dt / 7.5);
  const t = S.shipT;
  // west → east across the fracture, descending a little toward the terminal's heart
  ship.position.set(-70 + 170 * t, 27 - 7 * t, -(43 - 5 * t));
  ship.rotation.z = Math.sin(t * Math.PI) * 0.06;
  ship.visible = t < 1;
  // its hull crosses the key light: a shadow passes over the shelter; its lights wash the next chamber once
  const over = Math.exp(-Math.pow((t - 0.47) / 0.11, 2));
  if (S.key) S.key.intensity = S.keyBase * (1 - 0.7 * over);
  if (S.sweep) {
    const reveal = Math.exp(-Math.pow((t - 0.62) / 0.1, 2));
    S.sweep.intensity = 1800 * reveal;
    S.sweep.position.set(VEST_X1 + 9, 6.5, -(EXIT_N - 4 + 8 * t));
  }
  if (t >= 1) {
    S.shipActive = false;
    if (S.key) S.key.intensity = S.keyBase;
    if (S.sweep) S.sweep.intensity = 0;
  }
}

/**
 * `landing`. The super over the wreck; the dropship crosses the fracture and Lyessa raises her rifle; the
 * wounded soldier points the way; “Move.”, and one soldier's “Glory.” Then control: move, the arm (guard), the
 * plate (heavy attack), the lit doorway.
 */
function* landing(z: ZoneRuntime): Routine {
  const game = z.game;
  const lyessa = z.cast('lyessa');
  const wounded = z.cast('wounded');
  const salute = z.cast('soldierA');
  const squad = [z.cast('malik'), z.cast('soldierA'), z.cast('soldierB'), z.cast('soldierC')];
  armObstruction(z);
  if (!obstruction.plateBroken) {
    yield* opening(z, lyessa, wounded, salute);
    z.titleCard();
    yield* play(z, lyessa, squad);
  } else {
    game.audio.setMusic('approachTarrik', 0.5);
  }
  yield* leave(z);
}

function* opening(z: ZoneRuntime, lyessa: Companion | null, wounded: Companion | null, salute: Companion | null): Routine {
  const game = z.game;
  yield* z.cinematic('z00-landing', function* (c: CineCtx): Routine {
    game.audio.setMusic('approachTarrik', 2.5);
    // the super over the wreck, before the squad is seen
    c.cut({ pos: z.P(12.6, 17.2, 2.2), look: z.P(WRECK[0] + 1, WRECK[1], 2.6), fov: 42 });
    c.moveAsync({ pos: z.P(12.0, 15.8, 2.0), look: z.P(WRECK[0], WRECK[1], 2.4), fov: 40 }, 7, 'inOut');
    yield 0.6;
    yield* z.say('Narrator', 'Tarrik reaches the first interior chamber with Lyessa and five surviving Dominion soldiers. The rest of the insertion team died in the crash.', { channel: 'narration', duration: 6.4 });

    // the shelter: Tarrik small under the vault, the squad around him; he does not look at the dead for long
    c.cut({ pos: z.P(14.2, 12.6, 2.6), look: z.P(6.6, 8.8, 1.2), fov: 44 });
    c.moveAsync({ pos: z.P(13.4, 12.0, 2.4), look: z.P(6.8, 9.2, 1.3), fov: 42 }, 6, 'inOut');
    yield 1.8;

    // the passing shadow: the Reformation dropship crosses the fracture; Lyessa raises her rifle at it
    S.shipT = 0;
    S.shipActive = true;
    if (!z.skipping) game.audio.play('engineSpool', { pos: z.P(14, 40, 24), volume: 0.8 });
    // from the rubble edge, panning with it as it crosses the nave beyond the fracture
    c.cut({ pos: z.P(13.2, 18.6, 1.2), look: z.P(-14, 46, 27), fov: 52 });
    c.moveAsync({ pos: z.P(13.4, 18.8, 1.25), look: z.P(30, 44, 24), fov: 50 }, 3.4, 'inOut');
    lyessa?.stopAction();
    if (lyessa) {
      lyessa.holdAt(z.m('lyessaAim'), z.myaw('lyessaAim'));
      lyessa.face(z.P(16, 60, 30));
      lyessa.play('aimRifle', { loop: true });
    }
    yield 3.3;
    // its lights wash the next chamber through the doorway, once
    c.cut({ pos: z.P(9.6, EXIT_N + 0.2, 1.65), look: z.P(W + 6, EXIT_N, 2.3), fov: 28 });
    yield 2.3;
    const t = z.player.pos;
    const l = lyessa ? lyessa.actor.pos : z.m('lyessaAim');
    c.twoShot(l, t, { side: 1, distance: 1.9, fov: 38 });
    game.player.playScripted('idle', { faceTo: l });
    yield* z.say('Tarrik', 'Don’t.', { actor: z.player }); // RELOCATED (ch24, the shuttle)
    c.twoShot(t, l, { side: -1, distance: 1.9, fov: 38 });
    yield* z.say('Lyessa', 'It’s heading toward the same site.', { actor: lyessa });
    c.twoShot(l, t, { side: 1, distance: 1.9, fov: 38 });
    yield* z.say('Tarrik', 'So are we.', { actor: z.player });
    c.twoShot(t, l, { side: -1, distance: 1.9, fov: 38 });
    yield* z.say('Lyessa', 'That is traditionally why I shoot things.', { actor: lyessa });
    c.twoShot(l, t, { side: 1, distance: 2.0, fov: 36 });
    yield* z.say('Tarrik', 'Not yet.', { actor: z.player });
    lyessa?.stopAction();
    lyessa?.play('lowerWeapon');

    // the wounded soldier points the way: through the arm's gap to the lit doorway
    const w = wounded ? wounded.actor.pos : z.m('wounded');
    c.shot(w, { yawDeg: 40, distance: 2.4, height: 1.0, lookHeight: 0.8, fov: 40 });
    yield* z.say(SOLDIER, 'High Centurion.', { actor: wounded }); // NEW
    wounded?.play('point');
    c.cut({ pos: z.P(w.x - 0.6, -w.z + 0.5, 1.05), look: z.P(W, EXIT_N, 3.2), fov: 34 });
    c.moveAsync({ pos: z.P(w.x - 0.2, -w.z + 0.45, 1.1), look: z.P(W, EXIT_N, 3.6), fov: 30 }, 4, 'inOut');
    yield* z.say(SOLDIER, 'The lit doorway. Past the arm.', { actor: wounded }); // NEW
    yield* z.say(SOLDIER, 'I’ll hold here.', { actor: wounded }); // NEW
    wounded?.play('sitInjured', { loop: true });

    // “Move.” — and one soldier's salute as he takes the lead: quiet, fist to the breastplate, heads bowed
    c.shot(z.player.pos, { yawDeg: 70, distance: 2.6, height: 1.55, lookHeight: 1.55, fov: 36 });
    game.player.playScripted('idle', { faceTo: z.m('arm') });
    yield* z.say('Tarrik', 'Move.', { actor: z.player });
    const sp = salute ? salute.actor.pos : z.m('soldierA');
    c.shot(sp, { yawDeg: 120, distance: 2.3, height: 1.5, lookHeight: 1.45, fov: 34 });
    salute?.face(z.player.pos);
    salute?.play('salute');
    z.cast('soldierC')?.play('salute');
    yield 0.5;
    yield* z.say(SOLDIER, 'Glory.', { actor: salute, duration: 2.2 }); // the salute (ch1), once — returns in Z08
    yield 0.6;

    // end state — identical watched or skipped
    S.shipT = 1;
    S.shipActive = true;
    if (lyessa) lyessa.holdAt(z.m('lyessa'), z.myaw('lyessa'));
    wounded?.play('sitInjured', { loop: true });
  }, { blendOut: 0.8 });
}

/** control: the three hints, Lyessa's two remarks, the squad moving up once the way is open */
function* play(z: ZoneRuntime, lyessa: Companion | null, squad: Array<Companion | null>): Routine {
  const game = z.game;
  z.objective('Reach the lit doorway', 'plate'); // NEW
  const kbm = game.input.device !== 'gamepad';
  tutorialHint(z, 'z00Move', kbm ? 'Move with W A S D. Hold Shift to sprint.' : 'Move with the left stick. Click it to sprint.', undefined, 7); // NEW
  // guard: as the lead nears the arm
  yield z.until(() => obstruction.armSeized || z.player.pos.x > BULK_X - 6.5);
  if (!obstruction.armSeized) {
    tutorialHint(z, 'z00Guard', 'Hold to guard. A guarded blow stops the arm.', 'guard', 10); // NEW
    yield waitOr(z, () => obstruction.armSeized || obstruction.armHits > 0, 14);
    if (!obstruction.armSeized) z.bark('Lyessa', 'It still thinks it’s working.', { actor: lyessa }); // NEW
  }
  yield z.until(() => obstruction.armSeized);
  z.hint(null);
  // the way past the arm is safe: Lyessa comes up behind him, the squad waits for the doorway
  if (lyessa) {
    lyessa.mode = 'follow';
    lyessa.follow(z.player);
  }
  // heavy attack: at the jammed shutter
  yield z.until(() => obstruction.plateBroken || z.player.pos.x > W - 7);
  if (!obstruction.plateBroken) tutorialHint(z, 'z00Heavy', 'Heavy attack breaks the buckled plate.', 'heavy', 10); // NEW
  yield z.until(() => obstruction.plateBroken);
  z.hint(null);
  yield 0.9;
  z.bark('Lyessa', 'That’s one way to knock.', { actor: lyessa }); // NEW
  // the squad moves up to the doorway (the wounded man holds the shelter)
  const posts = ['malikDoor', 'soldierADoor', 'soldierBDoor', 'soldierCDoor'];
  squad.forEach((s, i) => {
    s?.stopAction();
    walkTo(z, s, posts[i], { run: i % 2 === 0 });
  });
  z.fork((function* (): Routine {
    for (let i = 0; i < squad.length; i++) {
      const s = squad[i];
      yield waitOr(z, () => atPost(z, s, posts[i]), 20);
      s?.play('aimRifle', { loop: true });
    }
  })(), 'squadUp');
}

/** the lit doorway → Z01 */
function* leave(z: ZoneRuntime): Routine {
  z.objective('Reach the lit doorway', 'exit'); // NEW
  yield z.untilNear('exit', 1.8);
  z.objective(null);
  yield* z.exit('Z01', { fade: 'black' });
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  { id: 'context', checkpoint: 'CP0', enter: (z) => spawnCast(z, 'context'), run: context },
  { id: 'landing', enter: (z) => spawnCast(z, z.flag('z00PlateBroken') === true ? 'open' : 'landing'), run: landing },
];

const Z00_DEF: ZoneDef = {
  id: 'Z00',
  title: 'Broken Landing',
  art: 'wound-overlook',
  cast: ['dominionSoldier', 'lyessa'],
  build,
  beats,
  update,
  dispose() {
    for (const c of S.smoke) c.dispose();
    S = blank();
    resetObstruction();
  },
};

export default Z00_DEF;
