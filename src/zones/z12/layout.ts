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
import type { HeroProp, ZoneBuilder } from '@/core/api';
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

export interface Z12Space {
  dom: HeroProp<{ engines: number; ramp: number }> | null;
  ref: HeroProp<{ engines: number; ramp: number }> | null;
  entry: import('@/core/api').DoorHandle | null;
}

export function buildSpace(b: ZoneBuilder): Z12Space {
  const game = b.game;
  game.sky.setHeading(0);
  b.setEnv({
    sky: 'hangar', look: LOOKS.hangar, ambience: 'hangar', music: 'departure',
    key: { dirFrom: [20, 24, 34], color: 0xfff1dc, intensity: 1.35, shadow: true },
  });
  const sp: Z12Space = { dom: null, ref: null, entry: null };

  // ---- shell: floor, three walls, the open edge ------------------------------------------------------------------
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, mat: 'blackStoneFloor', inlay: 'grid', reflective: true });
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'panelled', doors: [{ at: 4.5, width: 3, height: 3.5 }, { at: W / 2, width: 4, height: 4 }, { at: W - 4.5, width: 3, height: 3.5 }] });
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'ribbed' });
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'ribbed' });
  sp.entry = b.door({ x: W / 2, n: 0, width: 4, height: 4, open: true });
  sp.entry.setState('open');
  b.door({ x: 4.5, n: 0 }).setState('sealed'); // the Dominion corridor
  b.door({ x: W - 4.5, n: 0 }).setState('sealed'); // the Reformation corridor
  b.floor({ x: W / 2, n: -2.5, w: 5, d: 5, inlay: 'none', reflective: false });
  b.wall({ from: [W / 2 - 2.5, -5], to: [W / 2 - 2.5, 0], height: 5 });
  b.wall({ from: [W / 2 + 2.5, -5], to: [W / 2 + 2.5, 0], height: 5 });
  b.wall({ from: [W / 2 - 2.5, -5], to: [W / 2 + 2.5, -5], height: 5, style: 'panelled' });
  b.ceiling({ x: W / 2, n: -2.5, w: 5, d: 5, h: 5, style: 'flat' });
  // the edge: a stone lip with a gold line, a rail, and nothing beyond it but the ring and space
  b.rail({ from: [0.6, D - 0.5], to: [W - 0.6, D - 0.5], height: 1.05, style: 'ancient' });
  b.blocker({ x: W / 2, n: D + 0.3, w: W, d: 0.6, height: 4 });
  b.channel([[0.6, D - 0.95], [W - 0.6, D - 0.95]], { width: 0.08, intensity: 2.4 });
  b.floor({ x: W / 2, n: D + 3, w: W + 10, d: 6, h: -0.6, inlay: 'none', reflective: false, noSurface: true });
  // ribs carry the hangar's lattice; the last one frames the open edge
  b.ribRow({ x: W / 2, n: 4, span: W - 1.2, height: WALL_H + 5, count: 3, spacing: 9.5, lit: true });
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: WALL_H + 5.4, style: 'lattice' });
  for (const x of [0.9, W - 0.9]) b.column({ x, n: D - 0.9, height: WALL_H + 3, style: 'pylon', lit: true });

  // ---- the two berths --------------------------------------------------------------------------------------------
  sp.dom = berth(b, 'dominionShuttle', DOM.x, DOM.n);
  sp.ref = berth(b, 'reformationTransport', REF.x, REF.n);
  // each side's own gear, kept to its own berth
  b.prop('domCrate', { x: DOM.x + 6.2, n: DOM.n - 6.4, yawDeg: 12 });
  b.prop('domAmmoCase', { x: DOM.x + 7.4, n: DOM.n - 5.6, yawDeg: 70 });
  b.prop('domLamp', { x: DOM.x - 5.5, n: DOM.n - 6.6, yawDeg: 40 });
  b.prop('refCrate', { x: REF.x - 6.2, n: REF.n - 6.4, yawDeg: -10, variant: 2 });
  b.prop('refConsole', { x: REF.x - 7.6, n: REF.n - 5.4, yawDeg: 120 });
  b.prop('refLamp', { x: REF.x + 5.5, n: REF.n - 6.6, yawDeg: -40 });
  b.prop('cableBundle', { x: REF.x + 2.4, n: REF.n - 7.4, yawDeg: 20 });

  // ---- light -------------------------------------------------------------------------------------------------------
  b.spot({ x: FAREWELL.x, n: FAREWELL.n - 1.5, h: WALL_H + 3, target: [FAREWELL.x, FAREWELL.n + 0.5, 0], angleDeg: 18, intensity: 520, color: 0xdfe6f4, penumbra: 0.8, shaft: true });
  b.point({ x: DOM.x + 2, n: DOM.n - 5, h: 4.5, color: AMBER, intensity: 46, distance: 18 });
  b.point({ x: REF.x - 2, n: REF.n - 5, h: 4.5, color: BLUE, intensity: 46, distance: 18 });
  b.point({ x: W / 2, n: 3, h: 4.2, color: IVORY, intensity: 18, distance: 14 });
  b.point({ x: 3.5, n: D - 1.5, h: 5, color: 0xff6a4a, intensity: 24, distance: 16 }); // the red remnant's spill
  b.panelLight({ x: W / 2, n: -4.6, w: 2.2, d: 2.4, h: 0.9, facing: 'north', intensity: 1.6 });

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
  b.marker('tarrikFarewell', FAREWELL.x - 0.62, FAREWELL.n, 0, FACE.east);
  b.marker('seleneFarewell', FAREWELL.x + 0.62, FAREWELL.n, 0, FACE.west);
  b.marker('tarrikTurn', FAREWELL.x - 1.4, FAREWELL.n - 0.4, 0, 250);
  b.marker('seleneTurn', FAREWELL.x + 1.4, FAREWELL.n - 0.4, 0, 110);
  b.marker('lookBack', FAREWELL.x - 4.2, FAREWELL.n - 1.6, 0, 250);
  b.marker('wound', W / 2, D + 400, 60);
  b.marker('centre', W / 2, D / 2, 0);
  return sp;
}

/** a parked departure craft: hero prop, its colliders, ramp markers from its sockets */
function berth(b: ZoneBuilder, kind: 'dominionShuttle' | 'reformationTransport', x: number, n: number): HeroProp<{ engines: number; ramp: number }> {
  const ship = b.game.props.departureShip(kind);
  ship.params.ramp = 1;
  ship.params.engines = 0.08;
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

function so(b: ZoneBuilder, from: string, name: string, dx: number, back = 0): void {
  if (!b.hasMarker(from)) return;
  const m = b.getMarker(from);
  b.marker(name, m.pos.x + dx, -m.pos.z - 0.6 - back, 0, FACE.north);
}

/** far field: the ring receding both ways, both fleets holding at a wary distance */
export function buildScenic(b: ZoneBuilder): void {
  const sc = b.game.sky.scenic;
  const west = sc.megaRibs({ count: 6, span: 150, height: 110, spacing: 95, seed: 1201 });
  west.position.copy(b.P(-30, D + 60, -40));
  west.rotation.y = b.yaw(-64);
  b.add(west);
  const east = sc.megaRibs({ count: 6, span: 150, height: 110, spacing: 95, seed: 1202 });
  east.position.copy(b.P(W + 30, D + 60, -40));
  east.rotation.y = b.yaw(64);
  b.add(east);
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
