/**
 * Z12 · Outer-ring hangar — the space (plan coordinates, origin at the south-west corner, x east, n north).
 *
 *   n 24 ── the open edge of the ring: a lip, a rail, then space — the Wound north, the red remnant over the
 *        │  Dominion berth (left), the hard white remnant over the Reformation berth (right); both fleets far off
 *        │  WEST BERTH: Dominion shuttle (x ≈ 9)        the common concourse        EAST BERTH: Reformation transport (x ≈ 33)
 *        │  (both parked side-on, noses west, boarding ramps open toward the concourse, south)
 *   n  0 ── south wall: the common door (x 21) they come in by; a sealed corridor door at each faction's end
 *
 * Book: “where both factions can approach from separate corridors without crossing weapons range.” “Between them,
 * Tarrik and Selene stand beneath the shadow of the Wound.”
 */
import * as THREE from 'three';
import type { DepartureShipProp, ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { AMBER, BLUE, FACE, IVORY } from '../shared';

/** the common concourse (plan §Z12: 42 × 24 m) */
export const W = 42;
export const D = 24;
export const WALL_H = 13;
/** the berths: ship centres (both at yawDeg 180: nose west, ramp south) */
export const DOM = { x: 9.5, n: 15.5 } as const;
export const REF = { x: 32.5, n: 15.5 } as const;
export const SHIP_YAW = 180;
/** where the two stand for the farewell: beneath the Wound, between the berths */
export const FAREWELL = { x: 21, n: 12.5 } as const;
/** the berth decks (x spans) and their north–south extent: under each craft, short of the edge channel */
const PADS: ReadonlyArray<readonly [number, number]> = [[0.6, 17.2], [24.8, 41.4]];
const PAD_N0 = 6.4;
const PAD_N1 = 22.7;

/** the side walls' slots: mid-bay between the ribs (n 4, 13.5, 23), two to a bay */
const SLOTS_N = [7.2, 10.3, 16.7, 19.8];

/** escorts per craft (“Amber ships surround Tarrik, while blue-white vessels close around Selene.”) */
export const ESCORTS = 4;

/**
 * Integration wave: toward the wound-overlook painting — charcoal, near-neutral, the blue confined to the
 * Reformation berth's own lamps and the warmth to the gold and the Dominion side (the `hangar` grade pushed every
 * shadow and the mirror floor blue).
 */
export const Z12_LOOK = {
  ...LOOKS.hangar,
  // graded like the Z09 overlook (woundGallery), which the woundVista sky is authored against (see Z11_LOOK)
  // polish 4: up from 0.95 — without the neon ribs and the cream mega-rib arcades the hangar fell to ~0.6 of the
  // painting's mean brightness (0.195)
  exposure: 1.15,
  fog: { color: 0x0a0a10, density: 0.007 },
  grade: { tint: 0xeef0fc, saturation: 0.9, contrast: 1.16, lift: -0.01, shadowsTint: 0xb2baf6, highlightsTint: 0xffeedc },
  ambient: { sky: 0x666a7e, ground: 0x1a1816, intensity: 0.46 },
};

export interface Z12Space {
  dom: DepartureShipProp | null;
  ref: DepartureShipProp | null;
  entry: import('@/core/api').DoorHandle | null;
}

export function buildSpace(b: ZoneBuilder): Z12Space {
  const game = b.game;
  game.sky.setHeading(0);
  b.setEnv({
    // integration wave: the `woundVista` sky (the painting's): the Wound large over the open edge, “the red remnant
    // dominates one side of the hangar … the white remnant burns on the other”, a charcoal sky with few stars
    sky: 'woundVista', look: Z12_LOOK, ambience: 'hangar', music: 'departure',
    key: { dirFrom: [20, 24, 34], color: 0xfff1dc, intensity: 1.35, shadow: true },
  });
  // both fleets hold position, wary; nothing is firing
  game.sky.setBattleIntensity(0);
  const sp: Z12Space = { dom: null, ref: null, entry: null };

  // ---- shell: floor, three walls, the open edge ------------------------------------------------------------------
  // polish 4 (the wound-overlook painting): wet near-black mirror marble with FINE inlaid gold (no glowing tubes),
  // walls of gold-framed recessed marble panels, the painting's solid black-stone parapet with lit lantern posts at
  // the open edge, unlit ribs with a fine gold keel, paired service pipes and tall soft slots on the walls, a deep
  // stepped portal round the common door. Every new piece is collider-free; the rail keeps its collider.
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, mat: 'blackStoneFloor', inlay: 'grid', reflective: true });
  // the two berths are working decks: hangar concrete under each craft (visual skins a centimetre proud of the
  // walking surface). The King-era black marble with its gold grid stays as the common causeway between them,
  // where the two of them stand beneath the Wound (wound-overlook painting: dark mirror stone, gold lines).
  for (const [x0, x1] of PADS) {
    b.floor({ x: (x0 + x1) / 2, n: (PAD_N0 + PAD_N1) / 2, w: x1 - x0, d: PAD_N1 - PAD_N0, h: 0.012, thickness: 0.1, inlay: 'none', noSurface: true, finish: 'hangar' });
    const xi = x0 < W / 2 ? x1 : x0; // the pad's causeway edge: a fine gold line along it
    b.channel([[xi, PAD_N0 + 0.3], [xi, PAD_N1 - 0.3]], { width: 0.05, h: 0.013 });
  }
  farewellStar(b);
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'framed', doors: [{ at: 4.5, width: 3, height: 3.5 }, { at: W / 2, width: 4, height: 4 }, { at: W - 4.5, width: 3, height: 3.5 }] });
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'framed' });
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'framed' });
  sp.entry = b.door({ x: W / 2, n: 0, width: 4, height: 4, open: true });
  sp.entry.setState('open');
  b.door({ x: 4.5, n: 0 }).setState('sealed'); // the Dominion corridor
  b.door({ x: W - 4.5, n: 0 }).setState('sealed'); // the Reformation corridor
  // the common door they come in by: a deep stepped portal (collider-free; it never narrows the opening)
  b.portal({ x: W / 2, n: 0.3, yawDeg: FACE.north, width: 4, height: 4, steps: 3, depth: 0.7, head: 'pointed' });
  b.floor({ x: W / 2, n: -2.5, w: 5, d: 5, inlay: 'none', reflective: false });
  b.wall({ from: [W / 2 - 2.5, -5], to: [W / 2 - 2.5, 0], height: 5 });
  b.wall({ from: [W / 2 + 2.5, -5], to: [W / 2 + 2.5, 0], height: 5 });
  b.wall({ from: [W / 2 - 2.5, -5], to: [W / 2 + 2.5, -5], height: 5, style: 'panelled' });
  b.ceiling({ x: W / 2, n: -2.5, w: 5, d: 5, h: 5, style: 'flat' });
  // the edge: the painting's balustrade — solid black stone, a fine gold line on its cap, lantern posts — on the
  // same footprint and collider as the old rail; a gold line at its foot; nothing beyond but the ring and space
  b.rail({ from: [0.6, D - 0.5], to: [W - 0.6, D - 0.5], height: 1.05, style: 'parapet' });
  b.blocker({ x: W / 2, n: D + 0.3, w: W, d: 0.6, height: 4 });
  b.channel([[0.6, D - 0.95], [W - 0.6, D - 0.95]], { width: 0.08 });
  b.floor({ x: W / 2, n: D + 3, w: W + 10, d: 6, h: -0.6, inlay: 'none', reflective: false, noSurface: true });
  // ribs carry the hangar's lattice; the last one frames the open edge (polish 4: unlit — a fine gold keel line)
  b.ribRow({ x: W / 2, n: 4, span: W - 1.2, height: WALL_H + 5, count: 3, spacing: 9.5 });
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: WALL_H + 5.4, style: 'lattice' });
  for (const x of [0.9, W - 0.9]) b.column({ x, n: D - 0.9, height: WALL_H + 3, style: 'pylon' });
  dressWalls(b);

  // ---- the two berths --------------------------------------------------------------------------------------------
  sp.dom = berth(b, 'dominionShuttle', DOM.x, DOM.n);
  sp.ref = berth(b, 'reformationTransport', REF.x, REF.n);
  // each side's own gear, kept to its own berth
  b.prop('domCrate', { x: DOM.x + 6.2, n: DOM.n - 6.4, yawDeg: 12 });
  b.prop('domAmmoCase', { x: DOM.x + 7.4, n: DOM.n - 5.6, yawDeg: 70 });
  b.prop('domLamp', { x: DOM.x - 5.5, n: DOM.n - 6.6, yawDeg: 40 });
  b.prop('refCrate', { x: REF.x - 6.2, n: REF.n - 6.4, yawDeg: -10, variant: 2 });
  b.prop('refConsole', { x: REF.x - 7.6, n: REF.n - 5.4, yawDeg: 120 });
  // (integration wave: the generated dropship's ramp foot is at x 36.9, n 9.9 — the lamp stands clear of it)
  b.prop('refLamp', { x: W - 1.5, n: REF.n - 4.4, yawDeg: -60 });
  b.prop('cableBundle', { x: REF.x + 2.4, n: REF.n - 7.4, yawDeg: 20 });

  // ---- light -------------------------------------------------------------------------------------------------------
  b.spot({ x: FAREWELL.x, n: FAREWELL.n - 1.5, h: WALL_H + 3, target: [FAREWELL.x, FAREWELL.n + 0.5, 0], angleDeg: 18, intensity: 520, color: 0xdfe6f4, penumbra: 0.8, shaft: true });
  b.point({ x: DOM.x + 2, n: DOM.n - 5, h: 4.5, color: AMBER, intensity: 46, distance: 18 });
  b.point({ x: REF.x - 2, n: REF.n - 5, h: 4.5, color: BLUE, intensity: 46, distance: 18 });
  b.point({ x: W / 2, n: 3, h: 4.2, color: IVORY, intensity: 18, distance: 14 });
  // a soft cool fill at face height for the farewell (the shaft above leaves eyes in shadow)
  b.point({ x: FAREWELL.x, n: FAREWELL.n - 2.4, h: 1.9, color: 0xdfe6f4, intensity: 9, distance: 6.5 });
  b.point({ x: 3.5, n: D - 1.5, h: 5, color: 0xff6a4a, intensity: 24, distance: 16 }); // the red remnant's spill
  b.panelLight({ x: W / 2, n: -4.6, w: 2.2, d: 2.4, h: 0.9, facing: 'north', intensity: 1.0 });

  // ---- markers -----------------------------------------------------------------------------------------------------
  b.marker('start', W / 2 - 0.6, 1.4, 0, FACE.north);
  b.marker('seleneStart', W / 2 + 0.8, 0.6, 0, FACE.north);
  b.marker('meet', W / 2, 8.6, 0, FACE.north);
  b.marker('tarrikMeet', W / 2 - 0.9, 8.4, 0, 30);
  b.marker('seleneMeet', W / 2 + 0.9, 8.6, 0, 300);
  b.marker('lyessaWait', DOM.x + 4.6, DOM.n - 6.8, 0, 110);
  b.marker('lyessaMeet', W / 2 - 2.9, 9.4, 0, 100);
  b.marker('tharneWait', REF.x - 4.4, REF.n - 6.6, 0, 250);
  b.marker('lyricWait', REF.x - 5.2, REF.n - 7.2, 0, 260);
  b.marker('tharneMeet', W / 2 + 3.1, 9.0, 0, 265);
  b.marker('lyricMeet', W / 2 + 2.5, 10.2, 0, 245);
  b.marker('lyricAlone', W / 2 + 1.9, 9.6, 0, 245);
  b.marker('tarrikFarewell', FAREWELL.x - 0.85, FAREWELL.n, 0, FACE.east);
  b.marker('seleneFarewell', FAREWELL.x + 0.85, FAREWELL.n, 0, FACE.west);
  b.marker('tarrikTurn', FAREWELL.x - 1.4, FAREWELL.n - 0.4, 0, 250);
  b.marker('seleneTurn', FAREWELL.x + 1.4, FAREWELL.n - 0.4, 0, 110);
  b.marker('lookBack', FAREWELL.x - 4.2, FAREWELL.n - 1.6, 0, 250);
  b.marker('wound', W / 2, D + 400, 60);
  b.marker('centre', W / 2, D / 2, 0);
  return sp;
}

/** a parked departure craft: hero prop, its colliders, ramp markers from its sockets */
function berth(b: ZoneBuilder, kind: 'dominionShuttle' | 'reformationTransport', x: number, n: number): DepartureShipProp {
  const ship = b.game.props.departureShip(kind);
  ship.params.ramp = 1;
  ship.params.engines = 0.08;
  ship.params.escort = 0;
  ship.configureEscort({ count: ESCORTS });
  ship.object.position.copy(b.P(x, n, 0));
  ship.object.rotation.y = b.yaw(SHIP_YAW);
  b.add(ship.object);
  ship.object.updateMatrixWorld(true);
  const r = ship.object.rotation.y;
  const p = ship.object.position;
  for (const c of ship.colliders ?? []) {
    const o = c.offset;
    b.collider({ shape: c.shape, x: p.x + o.x * Math.cos(r) + o.z * Math.sin(r), y: p.y + o.y, z: p.z - o.x * Math.sin(r) + o.z * Math.cos(r), yaw: r + (c.yaw ?? 0) });
  }
  b.onUpdate((dt, t) => ship.update(dt, t));
  const tag = kind === 'dominionShuttle' ? 'dom' : 'ref';
  const v = new THREE.Vector3();
  for (const s of ['rampBottom', 'rampTop', 'door']) {
    const so = ship.socket(s);
    if (!so) continue;
    so.getWorldPosition(v);
    b.marker(`${tag}${s[0].toUpperCase()}${s.slice(1)}`, v.x, -v.z, s === 'rampBottom' ? 0 : v.y, FACE.north);
  }
  // the people who board stand at the ramp foot, two abreast
  so(b, `${tag}RampBottom`, `${tag}RampA`, -0.8);
  so(b, `${tag}RampBottom`, `${tag}RampB`, 0.8);
  so(b, `${tag}RampBottom`, `${tag}RampC`, 0, 1.6); // the bearer, a step behind her people
  if (tag === 'dom') b.whitePoint({ x: x, n: n - 3.2, h: 5.4, intensity: 1.5 });
  return ship;
}

/**
 * The farewell mark: a gold star in a ring inlaid in the causeway's black marble where they stand (the painting's
 * floor star). Polish 4: the shader inlay — fine polished gold that shows by reflecting the room, anti-aliased,
 * one draw call each, kept out of the mirror pass so the floor still mirrors them (it was emissive channel tubes).
 */
function farewellStar(b: ZoneBuilder): void {
  const { x, n } = FAREWELL;
  // (a faint glow: on the near-black mirror the polished gold alone reads too dim from across the concourse)
  b.inlay({ x, n, h: 0.004, kind: 'star', r: 3.2, points: 8, width: 0.05, glow: 0.45 });
  b.inlay({ x, n, h: 0.004, kind: 'rings', r: 2.3, count: 1, width: 0.045, glow: 0.45 });
  // a processional pair of gold lines up the causeway: from the common door to the star, and on from it to the edge
  const gap = 3.6; // clear of the star's tips
  for (const [a, z] of [[1.2, n - gap], [n + gap, D - 1.3]] as const) {
    b.inlay({ x, n: (a + z) / 2, h: 0.004, kind: 'lines', w: 1.3, d: z - a, count: 2, width: 0.035, glow: 0.3 });
  }
}

/**
 * Polish 4 — the walls' fine detail (collider-free, merged by material): tall soft slots in gold frames in every
 * bay of the side walls and flanking the common door, and paired service pipes with brackets high on the south
 * wall, dropping at both corners. Faces: south wall n 0.3, west wall x 0.3, east wall x W − 0.3 (+ the framed
 * relief).
 */
function dressWalls(b: ZoneBuilder): void {
  const f = 0.42; // a slot's foot on the framed wall face (the stiles stand proud of the 0.3 m half-thickness)
  for (const n of SLOTS_N) {
    b.slot({ x: f, n, h: 0.9, yawDeg: FACE.east, width: 0.42, height: 7.2, intensity: 1.2 });
    b.slot({ x: W - f, n, h: 0.9, yawDeg: FACE.west, width: 0.42, height: 7.2, intensity: 1.2 });
  }
  for (const x of [W / 2 - 5.2, W / 2 + 5.2, 10.6, W - 10.6]) b.slot({ x, n: f, h: 0.9, yawDeg: FACE.north, width: 0.42, height: 6.4, intensity: 1.1 });
  // the service runs: a pair high on the south wall, dropping to the deck at both corners
  const pn = 0.36;
  b.pipes([[1.4, pn, 0.35], [1.4, pn, 9.6], [W - 1.4, pn, 9.6], [W - 1.4, pn, 0.35]], { facing: FACE.north, count: 2, r: 0.07, boxes: [1, 2], mat: 'goldDark' });
}

function so(b: ZoneBuilder, from: string, name: string, dx: number, back = 0): void {
  if (!b.hasMarker(from)) return;
  const m = b.getMarker(from);
  b.marker(name, m.pos.x + dx, -m.pos.z - 0.6 - back, 0, FACE.north);
}

/** far field: the ring receding both ways, both fleets holding at a wary distance */
export function buildScenic(b: ZoneBuilder): void {
  const sc = b.game.sky.scenic;

  // integration wave: the terminal city far below the ring's open edge (the wound-overlook painting's dark city mass
  // and pale spires under the Wound, where the woundVista sky otherwise shows only a bare haze band); clearWound
  // keeps every spire under the void so the opening floats clear
  const city = sc.terminalVista({ radius: 3200, drop: 520, density: 0.6, seed: 1203 });
  city.position.copy(b.P(W / 2, D + 3, 0));
  b.add(city);
  // (polish 4: the two scenic mega-rib arcades are gone — cream arches with light lines on both sides, which the
  // painting does not have; the open dark city under the Wound carries the far field, framed by the parapet)
  const domCap = sc.ship('dominionCapital');
  domCap.position.copy(b.P(-900, 2800, 260));
  domCap.rotation.y = b.yaw(80);
  b.add(domCap);
  const refCap = sc.ship('reformationCapital');
  refCap.position.copy(b.P(1100, 3000, 220));
  refCap.rotation.y = b.yaw(-100);
  b.add(refCap);
  b.game.vfx.ambient('dust', b.P(W / 2, D / 2, 4), { x: W, y: 8, z: D }, 0.35);
}
