/**
 * Z11 · Observation gallery — the space (plan coordinates, origin at the south-west corner, x east, n north).
 *
 *   n 32 ── broad transparent wall (glass): red remnant left, white remnant right, the Wound between ──
 *        │  GALLERY 24 × 16 m  (x 0…24, n 16…32): black mirror floor, ivory walls, one framing rib,
 *        │  `props.observationSet()` near the glass, long axis north–south: Tarrik west, Selene east
 *   n 16 ── south wall, side-passage door at x 6 ──────────── east wall: exit door at n 19.5 → Z12
 *        │  side passage 3 m wide (x 4.5…7.5, n 10…16)
 *   n 10 ── LANDING 18 × 10 m (x 2…20, n 0…10): the junction where all five meet
 *        │  west corridor (Lyessa, two soldiers) behind an isolation barrier · east corridor (Tharne, Lyric) the same
 *   n  0 ── lift door at x 11; the lift cab below it (n −3.6…0): the short authored lift from the core
 *
 * Nothing in the gallery is faction-owned and nothing is monumental (SCRIPT_SOURCE Z11: “no throne, no ceremonial
 * insignia, and no monumental interface”): one table, six chairs, gold channels, light.
 */
import * as THREE from 'three';
import type { HeroProp, ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { AMBER, BLUE, FACE, GOLD, IVORY } from '../shared';

// =====================================================================================================================
// Constants
// =====================================================================================================================

/** the landing (junction) */
export const LAND = { x0: 2, x1: 20, n0: 0, n1: 10, h: 5.6 } as const;
/** the lift cab south of the landing; its door centre on the landing's south wall */
export const LIFT = { x: 11, n0: -3.6, w: 4.2 } as const;
/** the two side corridors (centre line n) and where their isolation barriers stand */
export const CORRIDOR_N = 5;
export const BARRIER_W_X = 2.5;
export const BARRIER_E_X = 19.5;
/** side passage landing → gallery */
export const PASSAGE = { x: 6, w: 3, n0: 10, n1: 16, h: 4.2 } as const;
/** the gallery (plan §Z11: 24 × 16 m) */
export const GAL = { x0: 0, x1: 24, n0: 16, n1: 32, h: 7 } as const;
/** the observation set: centre and yaw (long axis north–south) */
export const TABLE = { x: 12, n: 26, yawDeg: FACE.east } as const;
/** the exit door on the gallery's east wall (toward the outer ring / Z12) */
export const EXIT_N = 19.5;
/** seats used by the two leads (prop socket indices): Tarrik on the west side, Selene on the east, window end */
export const SEAT_TARRIK = 3;
export const SEAT_SELENE = 0;

export interface Z11Space {
  lift: import('@/core/api').DoorHandle | null;
  liftLight: THREE.PointLight | null;
  barrierW: import('@/core/api').BarrierHandle | null;
  barrierE: import('@/core/api').BarrierHandle | null;
  exit: import('@/core/api').DoorHandle | null;
  set: HeroProp<Record<string, number>> | null;
}

// =====================================================================================================================
// Build
// =====================================================================================================================

export function buildSpace(b: ZoneBuilder): Z11Space {
  const game = b.game;
  // presets are authored with the Wound to the north: the gallery's glass faces north, no heading change
  game.sky.setHeading(0);
  b.setEnv({
    sky: 'observation', look: LOOKS.observation, ambience: 'observation', music: 'observation',
    // the hard white remnant is the key: high from the north-east, cold, through the glass (steep for the mirror floor)
    key: { dirFrom: [16, 22, 34], color: 0xe4ecff, intensity: 1.45, shadow: true },
  });
  const sp: Z11Space = { lift: null, liftLight: null, barrierW: null, barrierE: null, exit: null, set: null };
  buildLanding(b, sp);
  buildPassage(b);
  buildGallery(b, sp);
  buildMarkers(b);
  buildScenic(b);
  b.finalize();
  return sp;
}

/** the junction: lift, two corridors behind isolation barriers, the side passage north */
function buildLanding(b: ZoneBuilder, sp: Z11Space): void {
  const { x0, x1, n0, n1, h } = LAND;
  const cx = (x0 + x1) / 2;
  b.floor({ x: cx, n: (n0 + n1) / 2, w: x1 - x0, d: n1 - n0, inlay: 'channels', reflective: false });
  b.wall({ from: [x0, n0], to: [x1, n0], height: h, style: 'panelled', doors: [{ at: LIFT.x - x0, width: 3, height: 3.5 }] });
  b.wall({ from: [x0, n1], to: [x1, n1], height: h, style: 'ribbed', doors: [{ at: PASSAGE.x - x0, width: PASSAGE.w, height: 3.5 }] });
  b.wall({ from: [x0, n0], to: [x0, n1], height: h, style: 'conduit', doors: [{ at: CORRIDOR_N - n0, width: 3, height: 3.5 }] });
  b.wall({ from: [x1, n0], to: [x1, n1], height: h, style: 'conduit', doors: [{ at: CORRIDOR_N - n0, width: 3, height: 3.5 }] });
  b.ceiling({ x: cx, n: (n0 + n1) / 2, w: x1 - x0, d: n1 - n0, h, style: 'flat' });
  // two ribs carry the landing's ceiling (the lift shaft rises behind the south one)
  b.ribRow({ x: cx, n: 2.4, span: x1 - x0 - 1.2, height: h - 0.2, count: 2, spacing: 5.2 });

  // the lift: a gold-lit cab behind a King-era door
  const ln = LIFT.n0;
  b.floor({ x: LIFT.x, n: ln / 2, w: LIFT.w, d: -ln, inlay: 'crownmark', reflective: false });
  b.wall({ from: [LIFT.x - LIFT.w / 2, ln], to: [LIFT.x - LIFT.w / 2, 0], height: 4.2, style: 'plain' });
  b.wall({ from: [LIFT.x + LIFT.w / 2, ln], to: [LIFT.x + LIFT.w / 2, 0], height: 4.2, style: 'plain' });
  b.wall({ from: [LIFT.x - LIFT.w / 2, ln], to: [LIFT.x + LIFT.w / 2, ln], height: 4.2, style: 'panelled' });
  b.ceiling({ x: LIFT.x, n: ln / 2, w: LIFT.w, d: -ln, h: 4.2, style: 'flat' });
  sp.lift = b.door({ x: LIFT.x, n: 0, yawDeg: FACE.north, style: 'ancient' });
  sp.lift.setState('sealed');
  sp.liftLight = b.point({ x: LIFT.x, n: ln / 2, h: 3.2, color: GOLD, intensity: 18, distance: 7 });

  // west corridor (the Dominion side) and east corridor (the Reformation side), each sealed by an isolation barrier
  for (const side of [-1, 1] as const) {
    const xa = side < 0 ? x0 - 6 : x1;
    const xb = side < 0 ? x0 : x1 + 6;
    const xm = (xa + xb) / 2;
    b.floor({ x: xm, n: CORRIDOR_N, w: 6, d: 3, inlay: 'none', reflective: false });
    b.wall({ from: [xa, CORRIDOR_N - 1.5], to: [xb, CORRIDOR_N - 1.5], height: 4, style: 'plain' });
    b.wall({ from: [xa, CORRIDOR_N + 1.5], to: [xb, CORRIDOR_N + 1.5], height: 4, style: 'plain' });
    b.ceiling({ x: xm, n: CORRIDOR_N, w: 6, d: 3, h: 4, style: 'flat' });
    const endX = side < 0 ? xa : xb;
    b.wall({ from: [endX, CORRIDOR_N - 1.5], to: [endX, CORRIDOR_N + 1.5], height: 4, style: 'panelled', doors: [{ at: 1.5, width: 2.4, height: 3 }] });
    b.door({ x: endX, n: CORRIDOR_N, yawDeg: FACE.east, width: 2.4, height: 3, style: 'service' }).setState('locked');
    const bx = side < 0 ? BARRIER_W_X : BARRIER_E_X;
    const bar = b.barrier({ from: [bx, CORRIDOR_N - 1.5], to: [bx, CORRIDOR_N + 1.5], height: 3.5, active: true });
    if (side < 0) sp.barrierW = bar;
    else sp.barrierE = bar;
    b.point({ x: xm, n: CORRIDOR_N, h: 2.6, color: side < 0 ? AMBER : BLUE, intensity: 14, distance: 8 });
  }

  // the junction as people left it: a little faction kit on each side, a medical cache by the passage
  b.prop('domFieldCache', { x: 3.4, n: 8.6, yawDeg: 120 });
  b.prop('domAmmoCase', { x: 3.6, n: 1.4, yawDeg: 60 });
  b.prop('refCrate', { x: 18.6, n: 8.4, yawDeg: -20, variant: 1 });
  b.prop('refConsole', { x: 18.7, n: 1.6, yawDeg: 270 });
  b.prop('medKit', { x: 9.4, n: 9.2, yawDeg: 10 });
  b.prop('ancientBench', { x: 14.6, n: 9.1, yawDeg: 180 });
  b.point({ x: cx, n: 5.4, h: 4.6, color: IVORY, intensity: 15, distance: 16 });
}

function buildPassage(b: ZoneBuilder): void {
  const { x, w, n0, n1, h } = PASSAGE;
  b.floor({ x, n: (n0 + n1) / 2, w, d: n1 - n0, inlay: 'channels', reflective: false });
  b.wall({ from: [x - w / 2, n0], to: [x - w / 2, n1], height: h, style: 'panelled' });
  b.wall({ from: [x + w / 2, n0], to: [x + w / 2, n1], height: h, style: 'panelled' });
  b.ceiling({ x, n: (n0 + n1) / 2, w, d: n1 - n0, h, style: 'flat' });
  b.panelLight({ x, n: (n0 + n1) / 2, w: 1.2, d: 3.4, h: h - 0.05, facing: 'down', color: IVORY, intensity: 1.6 });
}

/** the gallery: mirror floor, the glass wall, one rib framing it, the table and six chairs, the exit east */
function buildGallery(b: ZoneBuilder, sp: Z11Space): void {
  const { x0, x1, n0, n1, h } = GAL;
  const cx = (x0 + x1) / 2;
  b.floor({ x: cx, n: (n0 + n1) / 2, w: x1 - x0, d: n1 - n0, mat: 'blackStoneFloor', inlay: 'channels', reflective: true });
  b.wall({ from: [x0, n0], to: [x1, n0], height: h, style: 'panelled', doors: [{ at: PASSAGE.x - x0, width: PASSAGE.w, height: 3.5 }] });
  b.wall({ from: [x0, n0], to: [x0, n1], height: h, style: 'ribbed' });
  b.wall({ from: [x1, n0], to: [x1, n1], height: h, style: 'ribbed', doors: [{ at: EXIT_N - n0, width: 3, height: 3.5 }] });
  // the glass in three spans so the centre pane is clear of mullions: the Wound hangs in it, seen from the table
  const cw = 1.85;
  b.wall({ from: [x0, n1], to: [cx - cw, n1], height: h, style: 'glass' });
  b.wall({ from: [cx - cw, n1], to: [cx + cw, n1], height: h, style: 'glass' });
  b.wall({ from: [cx + cw, n1], to: [x1, n1], height: h, style: 'glass' });
  // the ceiling comes forward in stone and turns to glass over the last five metres: the window curves overhead
  b.ceiling({ x: cx, n: (n0 + n1 - 5) / 2, w: x1 - x0, d: n1 - n0 - 5, h, style: 'flat' });
  b.ceiling({ x: cx, n: n1 - 2.5, w: x1 - x0, d: 5, h, style: 'glass' });
  b.rib({ x: cx, n: n1 - 0.7, span: x1 - x0 - 0.6, height: h - 0.25, depth: 0.9, lit: true, yawDeg: FACE.north });
  b.door({ x: PASSAGE.x, n: n0, yawDeg: FACE.north, frameOnly: true });
  // light as information: a gold line at the foot of the glass, and one from the door to the table
  b.channel([[x0 + 0.8, n1 - 0.45], [x1 - 0.8, n1 - 0.45]], { width: 0.06, intensity: 2.2 });
  b.channel([[PASSAGE.x, n0 + 0.6], [PASSAGE.x, n0 + 3.2], [TABLE.x - 2.4, TABLE.n - 3.2]], { width: 0.05, intensity: 1.8 });
  // vertical seams on the side walls (warm light strips)
  for (const n of [19.5, 24.5, 29.0]) {
    b.prop('wallSeam', { x: x0 + 0.42, n, yawDeg: FACE.east });
    if (Math.abs(n - EXIT_N) > 2.5) b.prop('wallSeam', { x: x1 - 0.42, n, yawDeg: FACE.west });
  }

  // the table and the six chairs (hero prop: sockets for the seats and the evidence)
  const set = b.game.props.observationSet();
  set.object.position.copy(b.P(TABLE.x, TABLE.n, 0));
  set.object.rotation.y = b.yaw(TABLE.yawDeg);
  b.add(set.object);
  set.object.updateMatrixWorld(true);
  const r = set.object.rotation.y;
  const p = set.object.position;
  (set.colliders ?? []).forEach((c, i) => {
    // the two chairs the leads use carry no solid: the seated bodies stand in them
    if (i === SEAT_TARRIK || i === SEAT_SELENE) return;
    const o = c.offset;
    b.collider({ shape: c.shape, x: p.x + o.x * Math.cos(r) + o.z * Math.sin(r), y: p.y + o.y, z: p.z - o.x * Math.sin(r) + o.z * Math.cos(r), yaw: r + (c.yaw ?? 0) });
  });
  b.onUpdate((dt, t) => set.update(dt, t));
  sp.set = set;
  // seats and table sockets as markers (plan coordinates; yaw = the way the sitter faces)
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const name of ['seat0', 'seat1', 'seat2', 'seat3', 'seat4', 'seat5', 'tableTop', 'itemA', 'itemB']) {
    const s = set.socket(name);
    if (!s) continue;
    s.getWorldPosition(v);
    s.getWorldQuaternion(q);
    e.setFromQuaternion(q, 'YXZ');
    b.marker(name, v.x, -v.z, name.startsWith('seat') ? 0 : v.y, -THREE.MathUtils.radToDeg(e.y));
  }

  // exit: a short vestibule east, the white point the brightest thing on that wall
  sp.exit = b.door({ x: x1, n: EXIT_N, yawDeg: FACE.east });
  sp.exit.setState('locked');
  b.floor({ x: x1 + 2.5, n: EXIT_N, w: 5, d: 4, inlay: 'none', reflective: false });
  b.wall({ from: [x1, EXIT_N - 2], to: [x1 + 5, EXIT_N - 2], height: 4.4 });
  b.wall({ from: [x1, EXIT_N + 2], to: [x1 + 5, EXIT_N + 2], height: 4.4 });
  b.wall({ from: [x1 + 5, EXIT_N - 2], to: [x1 + 5, EXIT_N + 2], height: 4.4, style: 'panelled' });
  b.ceiling({ x: x1 + 2.5, n: EXIT_N, w: 5, d: 4, h: 4.4, style: 'flat' });
  b.panelLight({ x: x1 + 4.6, n: EXIT_N, w: 2, d: 2.4, h: 0.9, facing: 'west', intensity: 2 });
  b.whitePoint({ x: x1 - 0.8, n: EXIT_N, h: 5.2, intensity: 1.6 });

  // light: warm inside, the cold stays outside
  b.spot({ x: TABLE.x - 0.3, n: TABLE.n - 1.6, h: h - 0.4, target: [TABLE.x, TABLE.n + 0.5, 0.8], angleDeg: 30, penumbra: 0.75, intensity: 240, color: 0xffd6a6, shadow: false });
  // the remnants' spill through the glass: red from the north-west (Tarrik's side), cold from the north-east (Selene's)
  // (high, so their highlight in the mirror floor falls by the glass, not across the room)
  b.point({ x: 4.5, n: n1 + 2.5, h: 8.5, color: 0xff6040, intensity: 46, distance: 24 });
  b.point({ x: 19.5, n: n1 + 2.5, h: 8.5, color: 0xc4d6ff, intensity: 34, distance: 24 });
  b.point({ x: PASSAGE.x + 0.5, n: n0 + 2.2, h: 3.2, color: IVORY, intensity: 12, distance: 10 });
}

/** everything the scripts touch */
function buildMarkers(b: ZoneBuilder): void {
  // --- reunion (the landing) ---
  b.marker('liftSelene', LIFT.x - 0.75, -1.5, 0, FACE.north);
  b.marker('liftTarrik', LIFT.x + 0.75, -1.9, 0, FACE.north);
  b.marker('meetSelene', 10.4, 4.3, 0, 20);
  b.marker('meetTarrik', 11.7, 4.9, 0, 250);
  b.marker('lyessaGate', 0.6, CORRIDOR_N, 0, FACE.east);
  b.marker('lyessaStop', 5.0, 5.3, 0, FACE.east);
  b.marker('lyessaPost', 4.2, 7.4, 0, 120); // she stays at the junction
  b.marker('soldier1Gate', -1.4, CORRIDOR_N - 0.7, 0, FACE.east);
  b.marker('soldier2Gate', -1.4, CORRIDOR_N + 0.7, 0, FACE.east);
  b.marker('soldier1Post', 3.4, 3.6, 0, FACE.east);
  b.marker('soldier2Post', 3.2, 6.6, 0, 100);
  b.marker('tharneGate', 21.6, CORRIDOR_N - 0.45, 0, FACE.west);
  b.marker('lyricGate', 21.6, CORRIDOR_N + 0.45, 0, FACE.west);
  b.marker('tharneStop', 15.8, 4.6, 0, FACE.west);
  b.marker('lyricStop', 15.0, 5.3, 0, FACE.west);
  b.marker('seleneLyric', 14.4, 6.1, 0, 143); // Lyric's other arm
  b.marker('tarrikNear', 13.15, 5.25, 0, 56); // beside her once the summonses come in
  b.marker('lyessaTalk', 10.3, 6.5, 0, 100); // half a metre farther off than she used to stand
  b.marker('tharneRest', 15.6, 8.4, 0, 200);
  b.marker('lyricRest', 14.6, 8.6, 0, 180); // on the bench
  b.marker('bystander', 8.4, 8.6, 0, 200);
  b.marker('passageMouth', PASSAGE.x, LAND.n1 - 1.2, 0, FACE.north);
  b.marker('passageIn', PASSAGE.x, 13, 0, FACE.north);

  // --- gallery ---
  b.marker('galleryIn', PASSAGE.x + 0.6, GAL.n0 + 1.8, 0, 25);
  b.marker('tarrikIn', PASSAGE.x - 0.6, GAL.n0 + 1.2, 0, 25);
  b.marker('seleneStand', TABLE.x + 1.65, TABLE.n + 1.95, 0, 245); // standing by her chair, toward him
  b.marker('lingerAt', TABLE.x + 1.75, TABLE.n + 0.6, 0, 200); // where she stands when she rises
  b.marker('seleneRise', TABLE.x + 1.75, TABLE.n + 0.6, 0, 200);
  b.marker('tarrikRise', TABLE.x - 1.75, TABLE.n + 0.7, 0, 150);
  b.marker('tarrikApproach', TABLE.x - 1.8, TABLE.n + 1.1, 0, FACE.east); // he walks ahead to his chair
  b.marker('tableCentre', TABLE.x, TABLE.n, 0.76);
  b.marker('window', TABLE.x, GAL.n1, 3.2);
  b.marker('exit', GAL.x1 + 1.6, EXIT_N, 0, FACE.east);
  b.marker('exitDoor', GAL.x1 - 1.2, EXIT_N, 0, FACE.east);
}

/** the far field: the broken system below the gallery, dust in the light */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const vista = game.sky.scenic.terminalVista({ radius: 2600, drop: 320, density: 0.8, seed: 1101, clearWound: false });
  vista.position.copy(b.P(GAL.x0 + 12, GAL.n1 + 2, 0));
  b.add(vista);
  game.vfx.ambient('dust', b.P(12, 24, 3), { x: 22, y: 6, z: 14 }, 0.3);
  game.vfx.ambient('goldMotes', b.P(TABLE.x, TABLE.n, 2.4), { x: 6, y: 3, z: 5 }, 0.15);
}
