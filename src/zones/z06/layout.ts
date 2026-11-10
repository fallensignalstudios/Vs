/**
 * Z06 — the space (plan coordinates, origin at the south-west corner, x east, n north).
 *
 *   56 × 34 m junction at datum 0, entered from the WEST (door at n 22) and left by the EAST door (n 24) to Z07.
 *   - The FALLEN PLATE lies in the middle (27, 14), its lifting edge facing south-west — the protected side, away
 *     from the bodies' push — with the Reformation marine pinned under it, visible from the entry.
 *   - LEFT (north) PUSH LANE, n 20–33: broad, low and high cover, the north pier at (19, 26) whose west face
 *     carries the ELEVATED WALL SEAM where the first ceiling attacker announces itself.
 *   - RIGHT (south) RESCUE LOOP, n 3–12: from the side refuge past the marines' barricade and Lyessa's lane to the
 *     plate's protected side, round the south pier (35, 7) and up to the exit approach.
 *   - SIDE REFUGE +1 m along the west wall south of the entry (Tharne, Lyric, a wounded soldier; the marine after).
 *   - TWO VISIBLE BREACHES: A in the north wall (x 40), where the first bodies came through; B in the south wall
 *     (x 48), plugged by growth until it bursts. Contamination follows the low conduits a few metres out from each
 *     breach and stops; the stone around stays clean.
 *
 * Look: black mirror stone underfoot with gold channels, white-gold walls and lit ribs under an enclosed vault
 * (ref-concept-quarantine), the LOOKS.breach grade. Violet only at the two breaches and the Weaver's anchor.
 */
import * as THREE from 'three';
import type { ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { BLUE, FACE, GOLD, IVORY, VIOLET } from '../shared';
import { S, resetState } from './state';

// =====================================================================================================================
// Constants
// =====================================================================================================================

/** playable envelope (plan §Z06: 56 × 34 m) */
export const W = 56;
export const D = 34;
/** wall height; the enclosed vault springs from it, rib apex above */
const WALL_H = 12;
const RIB_H = 16.5;
const VAULT_RISE = 5.2;
/** entry (west wall) and exit (east wall) door centres */
export const ENTRY_N = 22;
export const EXIT_N = 24;
/** the fallen plate: centre and the bearing its lifting edge faces (south-west: the protected side) */
export const PLATE = { x: 27, n: 14, yawDeg: 225 } as const;
/** side refuge +1 m against the west wall, south of the entry; its ramp comes down to the east */
const REFUGE = { x0: 0.4, x1: 5.6, n0: 2, n1: 10, h: 1 } as const;
const REFUGE_RAMP = 4;
/** the two piers (3 × 3 m) that carry the vault over the floor — the north one carries the wall seam */
export const PIER_N = { x: 19, n: 26 } as const;
export const PIER_S = { x: 35, n: 7 } as const;
const PIER_HALF = 1.2;
/** the seam on the north pier's west face: plan x of the face, height band */
export const SEAM = { x: PIER_N.x - PIER_HALF - 0.32, n: PIER_N.n, h0: 3.2, h1: 10.4 } as const;
/** the two breaches (wall openings) */
export const BREACH_A = { x: 40, n: D } as const;
export const BREACH_B = { x: 48, n: 0 } as const;
const BREACH_W = 4.4;
const BREACH_H = 5.6;

// =====================================================================================================================
// Build
// =====================================================================================================================

export function build(b: ZoneBuilder): void {
  resetState();
  b.setEnv({
    sky: 'breachDeep', look: LOOKS.breach, ambience: 'breach', music: 'breach',
    // high, from the south-west: the plate's protected face is lit, long shadows fall toward the breaches
    key: { dirFrom: [-20, -24, 50], intensity: 2.3, color: 0xfff0dc },
  });
  buildShell(b);
  buildEntry(b);
  buildExit(b);
  buildRefuge(b);
  buildPiers(b);
  buildBreaches(b);
  buildCover(b);
  buildPlate(b);
  buildGear(b);
  buildLight(b);
  buildMarkers(b);
  buildScenic(b);
  b.finalize();
}

/** floor, the four walls with their openings, the lit rib row and the enclosed vault */
function buildShell(b: ZoneBuilder): void {
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, inlay: 'channels', reflective: true, mat: 'blackStoneFloor' });
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'panelled', doors: [{ at: ENTRY_N, width: 3, height: 3.5 }] });
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'panelled', doors: [{ at: EXIT_N, width: 3, height: 3.5 }] });
  b.wall({ from: [0, D], to: [W, D], height: WALL_H, style: 'conduit', doors: [{ at: BREACH_A.x, width: BREACH_W, height: BREACH_H }] });
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'ribbed', doors: [{ at: BREACH_B.x, width: BREACH_W, height: BREACH_H }] });
  // seven lit ribs carry the vault (legs against the long walls, clear of both breaches and the refuge)
  b.ribRow({ x: 4, n: D / 2, span: D - 1, height: RIB_H, count: 7, spacing: 8, yawDeg: FACE.east, alongDeg: FACE.east, lit: true });
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: WALL_H, style: 'vaultClosed', rise: VAULT_RISE, bay: 8, bayPhase: 4, glow: 3 });
  // a thin gold line along the foot of the long walls: light as information, it runs east with the route
  b.channel([[0.4, D - 0.34], [BREACH_A.x - 3, D - 0.34]], { h: 1.1, vertical: true, width: 0.05, color: IVORY, intensity: 2 });
  b.channel([[BREACH_A.x + 3, D - 0.34], [W - 0.4, D - 0.34]], { h: 1.1, vertical: true, width: 0.05, color: IVORY, intensity: 2 });
}

/** the corridor stub the party comes down (west of the entry door): dark black stone. The door has just shut behind Tarrik
 * and Lyessa; it opens again for Selene, Tharne and Lyric (spawnCast / arrival). */
function buildEntry(b: ZoneBuilder): void {
  S.entry = b.door({ x: 0, n: ENTRY_N, yawDeg: FACE.east });
  S.entry.setState('ready');
  b.floor({ x: -4, n: ENTRY_N, w: 8, d: 3.6, inlay: 'channels', mat: 'blackStoneFloor' });
  b.wall({ from: [-8, ENTRY_N - 1.8], to: [0, ENTRY_N - 1.8], height: 5, mat: 'blackStone', style: 'plain' });
  b.wall({ from: [-8, ENTRY_N + 1.8], to: [0, ENTRY_N + 1.8], height: 5, mat: 'blackStone', style: 'plain' });
  b.wall({ from: [-8, ENTRY_N - 1.8], to: [-8, ENTRY_N + 1.8], height: 5, mat: 'blackStone', style: 'plain' });
  b.ceiling({ x: -4, n: ENTRY_N, w: 8, d: 3.6, h: 5, style: 'flat', mat: 'blackStone' });
}

/** the east exit: a short lit vestibule, the white point and two lit pylons — the brightest thing at that end */
function buildExit(b: ZoneBuilder): void {
  S.exit = b.door({ x: W, n: EXIT_N, yawDeg: FACE.east });
  S.exit.setState('locked');
  b.floor({ x: W + 3, n: EXIT_N, w: 6, d: 4.4, inlay: 'channels', mat: 'blackStoneFloor' });
  b.wall({ from: [W, EXIT_N - 2.2], to: [W + 6, EXIT_N - 2.2], height: 5, mat: 'blackStone', style: 'plain' });
  b.wall({ from: [W, EXIT_N + 2.2], to: [W + 6, EXIT_N + 2.2], height: 5, mat: 'blackStone', style: 'plain' });
  b.wall({ from: [W + 6, EXIT_N - 2.2], to: [W + 6, EXIT_N + 2.2], height: 5, style: 'panelled' });
  b.ceiling({ x: W + 3, n: EXIT_N, w: 6, d: 4.4, h: 5, style: 'flat', mat: 'blackStone' });
  b.panelLight({ x: W + 5.6, n: EXIT_N, w: 2.2, d: 2.6, h: 0.9, facing: 'west', intensity: 2.2 });
  b.whitePoint({ x: W - 0.9, n: EXIT_N, h: 5.3, intensity: 1.8 });
  b.column({ x: W - 0.9, n: EXIT_N - 3.4, height: 8.5, style: 'pylon', lit: true });
  b.column({ x: W - 0.9, n: EXIT_N + 3.4, height: 8.5, style: 'pylon', lit: true });
  // the ground round the plate: one angular gold ring (the King-era floor marks the place, not the fight)
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ring.push([PLATE.x + Math.cos(a) * 7.2, PLATE.n + Math.sin(a) * 7.2]);
  }
  b.channel(ring, { width: 0.06, intensity: 2.4 });
  // the route continues: a gold channel from the plate ground to the exit threshold
  b.channel([[31, 10.5], [43, 10.5], [49.5, 17], [W - 0.4, 17], [W - 0.4, EXIT_N - 1.2]], { width: 0.07 });
}

/** the side refuge: a +1 m ledge against the west wall with rails, its ramp down to the east */
function buildRefuge(b: ZoneBuilder): void {
  const w = REFUGE.x1 - REFUGE.x0;
  const d = REFUGE.n1 - REFUGE.n0;
  const cn = (REFUGE.n0 + REFUGE.n1) / 2;
  b.deck({
    x: (REFUGE.x0 + REFUGE.x1) / 2, n: cn, w, d, h: REFUGE.h, solidBelow: true, rails: ['n', 'e'],
    railGaps: [{ side: 'e', at: d / 2, width: 3.2 }], inlay: 'channels',
  });
  b.ramp({ x: REFUGE.x1 + REFUGE_RAMP / 2, n: cn, w: 3.2, d: REFUGE_RAMP, h0: 0, h1: REFUGE.h, yawDeg: FACE.west, rails: true });
}

/** the two piers carrying the vault over the floor; the north one bears the elevated seam */
function buildPiers(b: ZoneBuilder): void {
  for (const p of [PIER_N, PIER_S]) {
    const x0 = p.x - PIER_HALF;
    const x1 = p.x + PIER_HALF;
    const n0 = p.n - PIER_HALF;
    const n1 = p.n + PIER_HALF;
    b.walls([[x0, n0], [x1, n0], [x1, n1], [x0, n1]], { closed: true, height: WALL_H, style: 'ribbed', thickness: 0.6 });
  }
  b.prop('wallSeam', { x: SEAM.x - 0.02, n: SEAM.n, yawDeg: FACE.west });
  buildSeam(b);
}

/**
 * The elevated seam: a recessed black slot up the pier's west face with a lit line inside it. Its own material
 * is kept live (not merged) — the fight script lights it violet when something moves in it (the telegraph).
 */
function buildSeam(b: ZoneBuilder): void {
  const len = SEAM.h1 - SEAM.h0;
  const g = new THREE.Group();
  g.name = 'z06-seam';
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.42), b.mats.get('blackStone'));
  const line = b.mats.emissive(GOLD, 1.4).clone();
  S.seamMat = line;
  const lit = new THREE.Mesh(new THREE.BoxGeometry(0.03, len - 0.3, 0.08), line);
  lit.position.x = -0.03;
  const trim = b.mats.get('goldTrim');
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.08, len + 0.2, 0.05), trim);
    edge.position.set(-0.02, 0, s * 0.24);
    g.add(edge);
  }
  g.add(slot, lit);
  g.position.copy(b.P(SEAM.x + 0.03, SEAM.n, SEAM.h0 + len / 2));
  b.add(b.keep(g));
}

/**
 * The two breaches: torn openings with a dark throat behind them. Contamination grows on the opening's edges and
 * follows the low conduit a few metres along the wall, then stops — the stone beyond stays clean.
 */
function buildBreaches(b: ZoneBuilder): void {
  // A — north wall: open, the way the first bodies came
  const an = BREACH_A.n;
  b.floor({ x: BREACH_A.x, n: an + 1.6, w: BREACH_W + 0.4, d: 3.2, inlay: 'none', mat: 'blackStoneFloor', noSurface: true });
  b.wall({ from: [BREACH_A.x - 2.4, an + 3.2], to: [BREACH_A.x + 2.4, an + 3.2], height: BREACH_H, mat: 'blackStone', style: 'plain', noCollider: true });
  b.blocker({ x: BREACH_A.x, n: an + 0.4, w: BREACH_W, d: 0.8, height: BREACH_H });
  b.conduit([[BREACH_A.x - 2.6, an - 0.35, 0.55], [BREACH_A.x - 11, an - 0.35, 0.55]], { r: 0.1, glow: false });
  b.corruption({ x: BREACH_A.x - 2.5, n: an - 0.3, h: 2.2, r: 1.4, onWall: true, yawDeg: FACE.south, intensity: 0.5 });
  b.corruption({ x: BREACH_A.x - 5.6, n: an - 0.3, h: 0.7, r: 0.9, onWall: true, yawDeg: FACE.south, intensity: 0.35 });
  b.point({ x: BREACH_A.x, n: an + 1.4, h: 2.4, color: VIOLET, intensity: 6, distance: 9 });
  b.prop('rubblePile', { x: BREACH_A.x + 2.9, n: an - 1.3, yawDeg: 30 });
  b.prop('debrisSmall', { x: BREACH_A.x - 1.6, n: an - 2.4, yawDeg: 200 });

  // B — south wall: sealed by growth until the second wave bursts it
  const bn = BREACH_B.n;
  b.floor({ x: BREACH_B.x, n: bn - 1.6, w: BREACH_W + 0.4, d: 3.2, inlay: 'none', mat: 'blackStoneFloor', noSurface: true });
  b.wall({ from: [BREACH_B.x - 2.4, bn - 3.2], to: [BREACH_B.x + 2.4, bn - 3.2], height: BREACH_H, mat: 'blackStone', style: 'plain', noCollider: true });
  b.blocker({ x: BREACH_B.x, n: bn - 0.4, w: BREACH_W, d: 0.8, height: BREACH_H });
  b.conduit([[BREACH_B.x + 2.6, bn + 0.35, 0.55], [BREACH_B.x + 7.5, bn + 0.35, 0.55]], { r: 0.1, glow: false });
  b.corruption({ x: BREACH_B.x + 2.5, n: bn + 0.3, h: 1.6, r: 1.2, onWall: true, yawDeg: FACE.north, intensity: 0.45 });
  b.corruption({ x: BREACH_B.x + 5.2, n: bn + 0.3, h: 0.7, r: 0.8, onWall: true, yawDeg: FACE.north, intensity: 0.3 });
  const plug = b.keep(b.prop('eclipseGrowth', { x: BREACH_B.x, n: bn - 0.2, scale: 2.4, collider: false, variant: 1 }));
  S.plug = plug;
  S.plugLight = b.point({ x: BREACH_B.x, n: bn - 1.2, h: 2.6, color: VIOLET, intensity: 4, distance: 9 });
  b.prop('debrisSmall', { x: BREACH_B.x - 2.8, n: bn + 1.4, yawDeg: 40 });
}

/** cover: the left lane, the rescue loop, and the cover-lined approach to the exit (1.2 m low / 2.2 m high) */
function buildCover(b: ZoneBuilder): void {
  // left (north) push lane
  b.coverLow({ x: 10.5, n: 27.5, yawDeg: FACE.east, style: 'ancient' });
  b.coverHigh({ x: 26, n: 29.5, w: 2.6, yawDeg: FACE.east, style: 'ancient' });
  b.coverLow({ x: 29.5, n: 23.5, w: 2.6, yawDeg: 225, style: 'debris' });
  b.coverLow({ x: 37.5, n: 28, yawDeg: FACE.east, style: 'debris' });
  // right (south) rescue loop: the marines' barricades, Lyessa's lane, rubble
  b.coverLow({ x: 13, n: 5.5, yawDeg: FACE.east, style: 'debris' });
  b.coverHigh({ x: 18.5, n: 8, w: 2.6, yawDeg: FACE.east, style: 'reformation' });
  b.coverLow({ x: 22.4, n: 10.4, w: 2.8, yawDeg: 45, style: 'reformation' });
  b.coverLow({ x: 29.5, n: 5.5, yawDeg: FACE.east, style: 'debris' });
  b.coverLow({ x: 41.5, n: 9.5, yawDeg: FACE.east, style: 'ancient' });
  // the exit approach
  b.coverLow({ x: 48, n: EXIT_N - 4, yawDeg: FACE.north, style: 'ancient' });
  b.coverLow({ x: 48, n: EXIT_N + 4, yawDeg: FACE.south, style: 'ancient' });
  b.coverHigh({ x: 44.5, n: 15, w: 2.6, yawDeg: FACE.east, style: 'ancient' });
}

/** the fallen plate (hero prop): placed, its collider registered, its sockets written out as markers */
function buildPlate(b: ZoneBuilder): void {
  const plate = b.game.props.fallenPlate();
  const pos = b.P(PLATE.x, PLATE.n, 0);
  const yaw = b.yaw(PLATE.yawDeg);
  plate.object.position.copy(pos);
  plate.object.rotation.y = yaw;
  plate.params.lift = 0;
  b.add(plate.object);
  for (const c of plate.colliders ?? []) {
    const o = c.offset;
    b.collider({
      shape: c.shape, x: pos.x + o.x * Math.cos(yaw) + o.z * Math.sin(yaw), y: pos.y + o.y,
      z: pos.z - o.x * Math.sin(yaw) + o.z * Math.cos(yaw), yaw: yaw + (c.yaw ?? 0), cover: 'low', tag: 'prop:fallenPlate',
    });
  }
  b.onUpdate((dt, t) => plate.update(dt, t));
  S.plate = plate;
  // sockets → markers (plan coordinates), so scripts read them like every other point
  plate.object.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const [socket, name] of [['stand', 'plateStand'], ['marine', 'marine']] as const) {
    const s = plate.socket(socket);
    if (!s) continue;
    s.getWorldPosition(v);
    e.setFromQuaternion(s.getWorldQuaternion(q), 'YXZ');
    b.marker(name, v.x, -v.z, 0, -THREE.MathUtils.radToDeg(e.y));
  }
  // the plate's centre at chest height (camera / facing target)
  b.marker('plateCentre', PLATE.x, PLATE.n, 0.9);
}

/** faction gear: the marines' post round the plate (cold, modular, temporary); ancient furniture; wreckage */
function buildGear(b: ZoneBuilder): void {
  b.prop('refBarricade', { x: 23.5, n: 17.6, yawDeg: 45 });
  b.prop('refCrate', { x: 20.8, n: 12.4, yawDeg: 18, variant: 1 });
  b.prop('refCrate', { x: 31.2, n: 9.6, yawDeg: -24, variant: 2 });
  b.prop('refAmmoCase', { x: 24.6, n: 9.2, yawDeg: 64 });
  b.prop('refSensorMast', { x: 32.6, n: 12.2, yawDeg: 200 });
  b.prop('refLamp', { x: 21.2, n: 15.6, yawDeg: 120 });
  b.prop('cableBundle', { x: 29.6, n: 11, yawDeg: 30 });
  b.prop('refStretcher', { x: 16.2, n: 10.2, yawDeg: 80 });
  // ancient furniture and the room's own wreckage
  b.prop('ancientPylon', { x: 51.5, n: EXIT_N - 6.5 });
  b.prop('ancientPylon', { x: 51.5, n: EXIT_N + 6.5 });
  b.prop('ancientBench', { x: 8, n: 31.8, yawDeg: 180 });
  b.prop('rubblePile', { x: 33.5, n: 20.5, yawDeg: 140 });
  b.prop('rubblePile', { x: 14.5, n: 18.4, yawDeg: 60 });
  b.prop('debrisSmall', { x: 24, n: 21 });
  b.prop('debrisSmall', { x: 38.5, n: 15.5, yawDeg: 120 });
  b.prop('debrisSmall', { x: 9.5, n: 14.5, yawDeg: 300 });
  // the refuge: a wounded soldier's place, a med kit
  b.prop('medKit', { x: 3.3, n: 4.4, h: REFUGE.h, yawDeg: 20 });
  b.prop('domAmmoCase', { x: 1.2, n: 9.2, h: REFUGE.h, yawDeg: 90 });
}

/** about a dozen lights: key (setEnv), two shafts, cool fills so figures separate from the stone, faction accents */
function buildLight(b: ZoneBuilder): void {
  // a pale shaft on the plate (the focal point) and one down the left lane
  b.spot({ x: 24, n: 12, h: RIB_H - 0.8, target: [26.5, 13.6, 0], angleDeg: 20, intensity: 820, shaft: true, color: 0xe4ebff });
  b.spot({ x: 14, n: 25, h: RIB_H - 0.8, target: [15, 25.5, 0], angleDeg: 22, intensity: 640, shaft: true, color: 0xe8ecf6 });
  // cool fills
  b.point({ x: 34, n: 22, h: 5.5, color: 0x9fb2d6, intensity: 40, distance: 24 });
  b.point({ x: 12, n: 14, h: 5, color: 0xa9b8d8, intensity: 30, distance: 20 });
  // the refuge reads warm and held: amber from the soldier's lamp
  b.point({ x: 3, n: 6, h: REFUGE.h + 2.2, color: 0xffb060, intensity: 14, distance: 8 });
  // the marines' post is lit by its own lamp (refLamp); the trapped man's suit lamp under the plate's edge
  b.point({ x: PLATE.x - 1.5, n: PLATE.n - 1.5, h: 0.35, color: BLUE, intensity: 5, distance: 3.2 });
}

function buildMarkers(b: ZoneBuilder): void {
  // --- entry: Tarrik and Lyessa first; Selene, Tharne and Lyric a few seconds behind them ---
  b.marker('start', 2.4, ENTRY_N, 0, FACE.east);
  b.marker('lyessaStart', 1.6, ENTRY_N + 1.3, 0, FACE.east);
  b.marker('kingAt', 8.8, ENTRY_N - 0.8, 0, FACE.west);
  b.marker('kingFace', 6.7, ENTRY_N - 0.4, 0, FACE.east);
  b.marker('lyessaWatch', 4.6, ENTRY_N + 1.1, 0, 100);
  b.marker('seleneOut', -3.4, ENTRY_N - 0.8, 0, FACE.east);
  b.marker('tharneOut', -5, ENTRY_N + 0.7, 0, FACE.east);
  b.marker('lyricOut', -6.4, ENTRY_N - 0.5, 0, FACE.east);
  b.marker('seleneIn', 6.2, ENTRY_N - 2.6, 0, 110);
  // --- the refuge (+1) ---
  b.marker('tharneRefuge', 2.4, 7.6, REFUGE.h, FACE.east);
  b.marker('lyricRefuge', 1.8, 5.8, REFUGE.h, 70);
  b.marker('soldierRefuge', 3.4, 3.2, REFUGE.h, 30);
  b.marker('marineSafe', 4.2, 8.9, REFUGE.h, 100);
  // --- the fight ---
  b.marker('lyessaPost', 21.2, 9.6, 0, 45);
  b.marker('selenePost', 17.5, 15, 0, 70);
  b.marker('rescueStart', 18.5, 13.5, 0, 90);
  b.marker('lb0', 32.5, 18.5, 0, 225);
  b.marker('lb1', 30.5, 21.2, 0, 215);
  b.marker('lb2', 34.6, 15.4, 0, 240);
  b.marker('wrDrop', 15.8, 28.6, 0, 120);
  b.marker('seamPerch', SEAM.x - 1.25, SEAM.n, 0, FACE.west); // (fight.ts reads the same offset)
  b.marker('seamMid', SEAM.x, SEAM.n, (SEAM.h0 + SEAM.h1) / 2, FACE.west);
  b.marker('breachA', BREACH_A.x, BREACH_A.n - 1.5, 1.6, FACE.south);
  b.marker('breachB', BREACH_B.x, BREACH_B.n + 1.5, 1.6, FACE.north);
  b.marker('lb3', 45, 5, 0, 330);
  b.marker('lb4', 51.2, 6.2, 0, 320);
  b.marker('weaverIn', 48, 3.4, 0, 330);
  b.marker('anchor', BREACH_B.x + 1.6, BREACH_B.n + 1.2, 0, FACE.north);
  b.marker('marineOut', 24.2, 11.6, 0, 200);
  // --- recovery ---
  b.marker('sustainLane', 12, 30.5, 0);
  b.marker('sustainLoop', 26.5, 4, 0);
  b.marker('sustainEast', 44, 21, 0);
  // --- grounding (after the fight, at the foot of the refuge ramp) ---
  b.marker('gLyricFrom', 10.4, 6.4, 0, FACE.east);
  b.marker('gTharneFrom', 9.6, 7.3, 0, FACE.east);
  b.marker('gLyric', 12.5, 7, 0, FACE.east);
  b.marker('gTharne', 11.6, 7.25, 0, 100);
  b.marker('gTharneBlock', 13.4, 6.6, 0, 110);
  b.marker('gSelene', 13.5, 7.05, 0, FACE.west);
  b.marker('gSeleneStand', 14.1, 8.3, 0, 240);
  b.marker('gLyessa', 14.7, 9.1, 0, 230);
  b.marker('gTarrik', 15.1, 6, 0, 290);
  b.marker('impactBelow', 20, 2, 0);
  // --- exit ---
  b.marker('exit', W - 1.9, EXIT_N, 0, FACE.east);
}

/** far field: the junction is enclosed; dust in the shafts, a few violet motes only at the open breach */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 5), { x: W, y: 10, z: D }, 0.55);
  game.vfx.ambient('ash', b.P(26, 14, 6), { x: 16, y: 10, z: 12 }, 0.3);
  game.vfx.ambient('violetMotes', b.P(BREACH_A.x, BREACH_A.n - 3, 2), { x: 7, y: 4, z: 5 }, 0.25);
}
