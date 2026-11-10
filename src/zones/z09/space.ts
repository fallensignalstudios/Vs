/**
 * Z09 · Wound gallery — the space. A 55 × 16 m shallow descending curve (plan coordinates, origin at the south-west
 * corner, x east, n north):
 *
 *   A  sealed white-gold corridor, x 0 → 13, heading east, h 0 (enclosed vault, warm seams)
 *   B  the descent: a 12 m ramp bending 15° north, h 0 → −3; the walls turn to black stone
 *   C  the apron: black stone with gold channels, h −3; its north side opens onto the CIRCULAR OVERLOOK — a half
 *      disc bulging north behind a glass rail. Beyond it: one arm of a city-scale Crownmark and the Wound
 *      (sky `woundVista`, `scenic.terminalVista` + `scenic.crownmarkArm`). The reveal comes only after the bend.
 *   D  the threshold hall, x 41 → 55: the five-depression threshold (`props.recognitionThreshold`) before a seamless
 *      black-stone door in the east wall, framed by the white point.
 *
 * Everything a script touches has a marker (see `buildMarkers`).
 */
import * as THREE from 'three';
import type { DoorHandle, HeroProp, ZoneBuilder } from '@/core/api';
import { FACE, GOLD, IVORY } from '../shared';

// =====================================================================================================================
// Layout constants
// =====================================================================================================================

/** the floor after the descent */
export const LOW = -3;
/** corridor width (A, B) */
const CW = 6;
/** A: the sealed corridor */
const A_END = 13;
const A_N = 3.5;
/** B: the ramp — 12 m at bearing 75° (15° north of east) */
const B_LEN = 12;
const B_BEARING = 75;
/** corridor wall height above its floor (A) — the vault springs from here; B's walls reach the same top */
const WALL_TOP = 7;
/** C: the apron (x from the ramp's foot to D), n range shared with D */
const APRON_X1 = 41;
const HALL_N0 = 2.25;
const HALL_N1 = 11.25;
/** the overlook: a half disc on the apron's north edge */
export const OVERLOOK = { x: 34, n: HALL_N1, r: 5.4 } as const;
/** D: the threshold hall and the door */
export const DOOR = { x: 55, n: (HALL_N0 + HALL_N1) / 2, width: 3.6, height: 4.6 } as const;
export const THRESHOLD = { x: 50.4, n: DOOR.n } as const;

/** plan point + bearing helpers */
type P2 = [number, number];
const rad = (deg: number): number => (deg * Math.PI) / 180;
const fwd = (deg: number): P2 => [Math.sin(rad(deg)), Math.cos(rad(deg))];
const add = (p: P2, d: P2, k: number): P2 => [p[0] + d[0] * k, p[1] + d[1] * k];

/** corridor centreline */
export const P0: P2 = [0, A_N];
export const P1: P2 = [A_END, A_N];
export const P2_: P2 = add(P1, fwd(B_BEARING), B_LEN);
/** right / left wall lines of the ramp */
const B_RIGHT: P2 = [Math.cos(rad(B_BEARING)), -Math.sin(rad(B_BEARING))];

export interface Z09Space {
  entry: DoorHandle | null;
  door: DoorHandle | null;
  threshold: HeroProp<{ recognized: number }> | null;
}

// =====================================================================================================================
// Build
// =====================================================================================================================

export function buildSpace(b: ZoneBuilder): Z09Space {
  const out: Z09Space = { entry: null, door: null, threshold: null };
  buildCorridor(b, out);
  buildDescent(b);
  buildApron(b);
  buildThresholdHall(b, out);
  buildLight(b);
  buildMarkers(b);
  return out;
}

/** A — the sealed corridor: white-gold, enclosed, its seams warm; the war is already far away */
function buildCorridor(b: ZoneBuilder, out: Z09Space): void {
  const n0 = A_N - CW / 2;
  const n1 = A_N + CW / 2;
  b.floor({ x: (A_END + 1) / 2, n: A_N, w: A_END + 1, d: CW, inlay: 'channels', reflective: true });
  b.wall({ from: [0, n0], to: [0, n1], height: WALL_TOP, style: 'panelled', doors: [{ at: CW / 2, width: 3, height: 3.5 }] });
  out.entry = b.door({ x: 0, n: A_N, yawDeg: FACE.east });
  out.entry.setState('sealed');
  b.wall({ from: [0, n0], to: [A_END + 0.8, n0], height: WALL_TOP, style: 'ribbed' });
  b.wall({ from: [0, n1], to: [A_END, n1], height: WALL_TOP, style: 'panelled' });
  b.ribRow({ x: 2.2, n: A_N, span: CW - 0.6, height: WALL_TOP + 2.4, count: 3, spacing: 4.4, yawDeg: FACE.east, alongDeg: FACE.east });
  b.ceiling({ x: A_END / 2, n: A_N, w: A_END, d: CW, h: WALL_TOP, style: 'vaultClosed', rise: 2.6, bay: 4.4, bayPhase: 2.2, glow: 2.4 });
}

/** B — the descent: the ramp bends 15° north; white-gold gives way to black stone */
function buildDescent(b: ZoneBuilder): void {
  const mid = add(P1, fwd(B_BEARING), B_LEN / 2);
  // the ramp rises toward its local north: turned to face back up the slope, its low end is the far one
  b.ramp({ x: mid[0], n: mid[1], w: CW, d: B_LEN, h0: LOW, h1: 0, yawDeg: B_BEARING + 180, mat: 'blackStoneFloor' });
  const r0 = add(P1, B_RIGHT, CW / 2);
  const r1 = add(P2_, B_RIGHT, CW / 2);
  const l0 = add(P1, B_RIGHT, -CW / 2);
  const l1 = add(P2_, B_RIGHT, -CW / 2);
  // first third still white-gold, then black stone to the same top (the space grows taller as it descends)
  const cut = 0.34;
  const rc = add(r0, fwd(B_BEARING), B_LEN * cut);
  const lc = add(l0, fwd(B_BEARING), B_LEN * cut);
  b.wall({ from: r0, to: rc, h: LOW, height: WALL_TOP - LOW, style: 'ribbed' });
  b.wall({ from: l0, to: lc, h: LOW, height: WALL_TOP - LOW, style: 'panelled' });
  b.wall({ from: rc, to: r1, h: LOW, height: WALL_TOP - LOW, style: 'ribbed', mat: 'blackStone' });
  b.wall({ from: lc, to: l1, h: LOW, height: WALL_TOP - LOW, style: 'conduit', mat: 'blackStone' });
  b.ceiling({ x: mid[0], n: mid[1], w: CW, d: B_LEN, h: WALL_TOP, yawDeg: B_BEARING, style: 'vaultClosed', rise: 2.6, bay: 4, glow: 1.6, mat: 'blackStone' });
  // ribs over the descent: two white-gold, then black stone with gold seams
  for (const [k, mat] of [[0.2, undefined], [0.55, 'blackStone'], [0.88, 'blackStone']] as const) {
    const c = add(P1, fwd(B_BEARING), B_LEN * k);
    b.rib({ x: c[0], n: c[1], h: LOW, span: CW - 0.5, height: WALL_TOP - LOW + 1.8, yawDeg: B_BEARING, mat, lit: true, noCollider: true });
  }
}

/** C — the apron and the circular overlook: open to the sky on the north, glass rail, black mirror stone */
function buildApron(b: ZoneBuilder): void {
  const x0 = P2_[0];
  b.floor({ x: (x0 + APRON_X1) / 2, n: (HALL_N0 + HALL_N1) / 2, w: APRON_X1 - x0, d: HALL_N1 - HALL_N0, h: LOW, mat: 'blackStoneFloor', inlay: 'channels', reflective: true });
  b.disc({ x: OVERLOOK.x, n: OVERLOOK.n, r: OVERLOOK.r, h: LOW, mat: 'blackStoneFloor', inlay: 'crownmark', reflective: true });
  // south boundary: the ramp's right wall turns along the apron's south edge to the threshold hall
  const rEnd = add(P2_, B_RIGHT, CW / 2);
  b.walls([rEnd, [rEnd[0] + 1.1, HALL_N0], [APRON_X1, HALL_N0]], { h: LOW, height: 9, style: 'ribbed' });
  // north: the glass rail — from the ramp's left wall, along the apron edge, round the half disc, to D
  const lEnd = add(P2_, B_RIGHT, -CW / 2);
  const rail: P2[] = [lEnd, [x0 + 0.1, HALL_N1], [OVERLOOK.x - OVERLOOK.r, HALL_N1]];
  const steps = 14;
  for (let i = 1; i < steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI; // west → north → east
    rail.push([OVERLOOK.x + Math.sin(a) * OVERLOOK.r, OVERLOOK.n + Math.cos(a) * OVERLOOK.r]);
  }
  rail.push([OVERLOOK.x + OVERLOOK.r, HALL_N1], [APRON_X1, HALL_N1]);
  for (let i = 0; i < rail.length - 1; i++) b.rail({ from: rail[i], to: rail[i + 1], h: LOW, height: 1.1, style: 'glass' });
  // a gold channel traces the rail's foot (route light) and the five-pointed inlay's axis toward the threshold
  b.channel(rail.slice(2, rail.length - 1).map((p) => [p[0] + (OVERLOOK.x - p[0]) * 0.06, p[1] + (OVERLOOK.n - p[1]) * 0.06] as P2), { h: LOW, width: 0.05, intensity: 2.2 });
  // the white-gold structure on the right: three immense ribs rising out of the south wall and leaning over the
  // walkway (the concept's buttresses) — tiny figures against them
  // (a half rib's foot is its local west end: turned to face west, the foot stands south of the wall and the
  // apex hangs over the middle of the walkway)
  for (const x of [29.5, 35.5, 41.5]) {
    b.rib({ x, n: HALL_N0 + 5.2, h: LOW, span: 14, height: 15, depth: 1.5, yawDeg: FACE.west, style: 'half', lit: true, noCollider: true });
    b.column({ x: x - 3, n: HALL_N0 - 0.9, h: LOW, r: 0.95, height: 24, style: 'round', lit: true });
  }
  b.column({ x: x0 + 1.6, n: HALL_N0 + 0.6, h: LOW, r: 0.55, height: 12, style: 'pylon', mat: 'blackStone', lit: true });
}

/** D — the threshold hall: black stone, the five-depression threshold, the seamless door, the white point */
function buildThresholdHall(b: ZoneBuilder, out: Z09Space): void {
  const nMid = DOOR.n;
  const d = HALL_N1 - HALL_N0;
  b.floor({ x: (APRON_X1 + DOOR.x) / 2, n: nMid, w: DOOR.x - APRON_X1, d, h: LOW, mat: 'blackStoneFloor', inlay: 'channels', reflective: true });
  b.wall({ from: [APRON_X1, HALL_N0], to: [DOOR.x, HALL_N0], h: LOW, height: 9, style: 'ribbed', mat: 'blackStone' });
  b.wall({ from: [APRON_X1, HALL_N1], to: [DOOR.x, HALL_N1], h: LOW, height: 9, style: 'conduit', mat: 'blackStone' });
  b.wall({ from: [DOOR.x, HALL_N0], to: [DOOR.x, HALL_N1], h: LOW, height: 9, style: 'plain', mat: 'blackStone', doors: [{ at: nMid - HALL_N0, width: DOOR.width, height: DOOR.height }] });
  b.ceiling({ x: (APRON_X1 + DOOR.x) / 2 + 1, n: nMid, w: DOOR.x - APRON_X1 - 2, d, h: LOW + 9, style: 'vaultClosed', rise: 2.8, bay: 4.4, glow: 1.2, mat: 'blackStone' });
  out.door = b.door({ x: DOOR.x, n: nMid, h: LOW, yawDeg: FACE.east, width: DOOR.width, height: DOOR.height, style: 'threshold' });
  out.door.setState('locked');
  // beyond the door: a short dark vestibule (Z10 lies beyond)
  b.floor({ x: DOOR.x + 2.6, n: nMid, w: 5.2, d: 4.4, h: LOW, mat: 'blackStoneFloor', inlay: 'none' });
  b.wall({ from: [DOOR.x, nMid - 2.2], to: [DOOR.x + 5.2, nMid - 2.2], h: LOW, height: 5, mat: 'blackStone' });
  b.wall({ from: [DOOR.x, nMid + 2.2], to: [DOOR.x + 5.2, nMid + 2.2], h: LOW, height: 5, mat: 'blackStone' });
  b.wall({ from: [DOOR.x + 5.2, nMid - 2.2], to: [DOOR.x + 5.2, nMid + 2.2], h: LOW, height: 5, mat: 'blackStone' });
  b.ceiling({ x: DOOR.x + 2.6, n: nMid, w: 5.2, d: 4.4, h: LOW + 5, style: 'flat', mat: 'blackStone' });
  b.panelLight({ x: DOOR.x + 4.9, n: nMid, h: LOW + 0.6, w: 2, d: 2.4, facing: 'west', intensity: 1.6, color: IVORY });

  // the threshold: five depressions round a single white point; its three channels run on to the door
  const game = b.game;
  const t = game.props.recognitionThreshold();
  t.object.position.copy(b.P(THRESHOLD.x, THRESHOLD.n, LOW));
  t.object.rotation.y = b.yaw(FACE.west); // approached from the west
  b.add(t.object);
  for (const c of t.colliders ?? []) {
    const r = t.object.rotation.y;
    const p = t.object.position;
    b.collider({ shape: c.shape, x: p.x + c.offset.x * Math.cos(r) + c.offset.z * Math.sin(r), y: p.y + c.offset.y, z: p.z - c.offset.x * Math.sin(r) + c.offset.z * Math.cos(r), yaw: r + (c.yaw ?? 0) });
  }
  b.onUpdate((dt, time) => t.update(dt, time));
  out.threshold = t;
  const far = THRESHOLD.x + 1.6 + 0.05;
  for (const dn of [-1.7, 0, 1.7]) b.channel([[far, nMid + dn], [DOOR.x - 0.4, nMid + dn * 0.55]], { h: LOW, width: 0.045, intensity: 1.8, pulse: true });
  // the white point is the brightest thing at this end; two lit pylons lead the eye to it
  b.whitePoint({ x: DOOR.x - 0.7, n: nMid, h: LOW + DOOR.height + 1.6, intensity: 1.8 });
  b.column({ x: DOOR.x - 0.9, n: nMid - 3.1, h: LOW, height: 8, style: 'pylon', mat: 'blackStone', lit: true });
  b.column({ x: DOOR.x - 0.9, n: nMid + 3.1, h: LOW, height: 8, style: 'pylon', mat: 'blackStone', lit: true });
}

/** about a dozen lights: warm seams in the sealed corridor, cool fills on black stone, the focal shafts */
function buildLight(b: ZoneBuilder): void {
  b.point({ x: 6.5, n: A_N, h: 4.6, color: IVORY, intensity: 26, distance: 14 });
  const mid = add(P1, fwd(B_BEARING), B_LEN * 0.6);
  b.point({ x: mid[0], n: mid[1], h: 1.5, color: 0xb8c4ff, intensity: 30, distance: 16 });
  // the overlook: a steep shaft on the half disc keeps the two figures off the black stone
  b.spot({ x: OVERLOOK.x - 1.5, n: OVERLOOK.n - 3, h: LOW + 16, target: [OVERLOOK.x, OVERLOOK.n + 1, LOW], angleDeg: 26, intensity: 520, shaft: true, color: 0xfff0d8 });
  b.point({ x: OVERLOOK.x - 3, n: HALL_N0 + 2.2, h: LOW + 3, color: 0xaebcff, intensity: 42, distance: 22 });
  b.point({ x: 46, n: DOOR.n, h: LOW + 4.5, color: 0xaebcff, intensity: 36, distance: 18 });
  b.spot({ x: THRESHOLD.x - 3, n: THRESHOLD.n, h: LOW + 8.5, target: [THRESHOLD.x + 0.6, THRESHOLD.n, LOW], angleDeg: 30, intensity: 380, shaft: true, color: 0xfff2dc });
}

function buildMarkers(b: ZoneBuilder): void {
  // descent
  b.marker('start', 2.6, A_N - 0.6, 0, FACE.east);
  b.marker('seleneStart', 2.2, A_N + 1.3, 0, FACE.east);
  // overlook
  b.marker('overlookEnter', P2_[0] + 2.6, 7.4, LOW, 60);
  b.marker('seleneOverlookEnter', P2_[0] + 1.8, 8.9, LOW, 60);
  b.marker('seleneRail', OVERLOOK.x - 2.3, OVERLOOK.n + 3.6, LOW, 225); // at the rail, looking back along the path
  b.marker('tarrikRail', OVERLOOK.x + 0.4, OVERLOOK.n + 3.4, LOW, FACE.north);
  b.marker('overlookLook', OVERLOOK.x, OVERLOOK.n + 12, LOW + 2);
  // recognition
  b.marker('recogEnter', 44, DOOR.n - 0.6, LOW, FACE.east);
  b.marker('seleneRecogEnter', 43, DOOR.n + 1.2, LOW, FACE.east);
  b.marker('thresholdApproach', THRESHOLD.x - 2.6, THRESHOLD.n - 0.5, LOW, FACE.east);
  b.marker('seleneBeside', THRESHOLD.x - 2.5, THRESHOLD.n + 0.9, LOW, FACE.east);
  b.marker('thresholdCenter', THRESHOLD.x, THRESHOLD.n, LOW);
  b.marker('doorFront', DOOR.x - 1.2, DOOR.n, LOW, FACE.east);
  b.marker('seleneBeyond', DOOR.x + 3.4, DOOR.n + 0.7, LOW, FACE.east);
  b.marker('exit', DOOR.x + 1.6, DOOR.n - 0.4, LOW, FACE.east);
}

// =====================================================================================================================
// The far field
// =====================================================================================================================

/**
 * The reveal: one arm of a city-scale Crownmark running out from under the overlook toward the Wound, and the
 * converging terminal around it (origins on the overlook floor by the rail; both built facing −Z = north, which is
 * where `woundVista` puts the Wound at heading 0).
 */
export function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const at = b.P(OVERLOOK.x, OVERLOOK.n + OVERLOOK.r, LOW);
  const vista = game.sky.scenic.terminalVista({ corridor: 640 });
  vista.position.copy(at);
  b.add(vista);
  const arm = game.sky.scenic.crownmarkArm();
  arm.position.copy(at);
  b.add(arm);
  game.vfx.ambient('dust', b.P(14, A_N, 3), { x: 30, y: 7, z: 9 }, 0.35);
  game.vfx.ambient('goldMotes', b.P(OVERLOOK.x, OVERLOOK.n, LOW + 3), { x: 14, y: 6, z: 12 }, 0.35);
}

// =====================================================================================================================
// "White-gold lines illuminate along the floor and begin flowing down the passage."
// =====================================================================================================================

/** two lines of short gold segments along the route, from the sealed door to the threshold (one draw call) */
export interface FlowLines {
  mesh: THREE.InstancedMesh;
  /** distance along the route of each instance */
  s: Float32Array;
  length: number;
  material: THREE.Material;
}

const SEG = 0.62;
const GAP = 0.08;

export function buildFlow(b: ZoneBuilder): FlowLines {
  // route (plan x, n, h): the sealed corridor, the ramp, across the apron to the threshold's approach
  const route: Array<[number, number, number]> = [
    [P0[0] + 0.6, P0[1], 0], [P1[0], P1[1], 0], [P2_[0], P2_[1], LOW], [P2_[0] + 4.5, DOOR.n - 0.4, LOW], [THRESHOLD.x - 2.2, DOOR.n, LOW],
  ];
  const pos: Array<[THREE.Vector3, number, number, number]> = []; // centre, yaw, pitch, s
  let s0 = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = b.P(route[i][0], route[i][1], route[i][2]);
    const c = b.P(route[i + 1][0], route[i + 1][1], route[i + 1][2]);
    const d = c.clone().sub(a);
    const len = d.length();
    const planLen = Math.hypot(d.x, d.z);
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.atan2(d.y, planLen);
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // right of the travel direction
    const n = Math.max(1, Math.floor(len / (SEG + GAP)));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const p = a.clone().lerp(c, t);
      for (const off of [-1.45, 1.45]) pos.push([p.clone().addScaledVector(side, off), yaw, pitch, s0 + t * len]);
    }
    s0 += len;
  }
  const geo = new THREE.BoxGeometry(0.05, 0.012, SEG);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, material, pos.length);
  mesh.name = 'z09-flow';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const one = new THREE.Vector3(1, 1, 1);
  const s = new Float32Array(pos.length);
  const dark = new THREE.Color(0, 0, 0);
  pos.forEach(([p, yaw, pitch, dist], i) => {
    e.set(-pitch, yaw, 0);
    q.setFromEuler(e);
    m.compose(p.setY(p.y + 0.014), q, one);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, dark);
    s[i] = dist;
  });
  mesh.frustumCulled = false;
  b.add(b.keep(mesh));
  return { mesh, s, length: s0, material };
}

const FLOW_COLOR = new THREE.Color(GOLD);
const TMP = new THREE.Color();

/**
 * Light the flow: `front` metres of the route are lit (the lines ignite from the sealed door forward); pulses
 * travel down the passage on top of a steady glow. Cheap enough to call every tick.
 */
export function updateFlow(f: FlowLines, front: number, time: number): void {
  const n = f.s.length;
  for (let i = 0; i < n; i++) {
    const s = f.s[i];
    const lit = Math.min(1, Math.max(0, (front - s) / 2.5));
    const ph = ((s - time * 4.2) / 9) % 1;
    const wave = Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 8);
    const k = lit * (0.9 + 2.6 * wave);
    TMP.copy(FLOW_COLOR).multiplyScalar(k);
    f.mesh.setColorAt(i, TMP);
  }
  if (f.mesh.instanceColor) f.mesh.instanceColor.needsUpdate = true;
}
