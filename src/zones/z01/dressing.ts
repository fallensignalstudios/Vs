/**
 * Z01 set dressing (its own module since polish 4, so z01.ts stays under ~600 lines): the faction gear, and the
 * polish-4 additions — the relay-route painting's bracketed pipe runs, lit slots, stepped portals, inlaid twin
 * rails, Reformation crates and the haze high in the hall. Visual only: no new colliders.
 */
import type { ZoneBuilder } from '@/core/api';
import { FACE } from '../shared';

/** the layout numbers the dressing needs (z01.ts owns them) */
export interface Z01Layout {
  W: number; D: number; WALL_H: number; EXIT_N: number; ENTRY_N: number; APERTURE_H: number; DECK_H: number;
  LANE_N: readonly number[]; DECK_MID_N: number;
}

/** Reformation security equipment at the far end; a little Dominion kit where the squad came in */
export function buildFactionGear(b: ZoneBuilder, L: Z01Layout): void {
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
  b.prop('refCrate', { x: 37.2, n: L.DECK_MID_N + 1.6, h: L.DECK_H, yawDeg: 6, variant: 1 });
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

/**
 * Integration wave (relay-route painting): twin gold service pipes climb the south wall between the ribs and jog
 * over under the vault, as the painting's walls do. Polish 4: the kit's `pipes()` — clamp brackets, collars at the
 * bends, a junction box at the jog. Visual only, on the wall face (the recovery pocket at x = 28 and the growth
 * are left alone).
 */
export function buildPipes(b: ZoneBuilder, L: Z01Layout): void {
  // (between the rib legs at x = 4, 12 … 52; the bays without pipes carry a lit slot, see buildRelief)
  for (const x of [15.4, 32.6, 47.6]) {
    b.pipes([[x, 0.36, 0.15], [x, 0.36, L.WALL_H - 3.4], [x + 0.6, 0.36, L.WALL_H - 2.7], [x + 0.6, 0.36, L.WALL_H - 0.2]], { facing: FACE.north, r: 0.065, bracket: 1.6, boxes: [1] });
  }
  // a single run either side of the exit portal, up into the vault
  for (const n of [L.EXIT_N - 4.6, L.EXIT_N + 4.6]) {
    b.pipes([[L.W - 0.36, n, 0.15], [L.W - 0.36, n, L.APERTURE_H - 0.3]], { facing: FACE.west, r: 0.055, bracket: 1.4, boxes: false });
  }
}

/**
 * Polish 4 (relay-route painting): detail density. Tall softly lit slots in the south bays between the pipe runs
 * (window glow: daylight from within), deep stepped portals round the sealed entry and the exit, a pair of fine
 * gold rails inlaid down the centre lane (the painting's floor rails), Reformation crates with lit strips stacked
 * against the band-3 barricades and the east wall (collider-free, tight to existing solids), and a pale daylight
 * haze high under the vault.
 */
export function buildRelief(b: ZoneBuilder, L: Z01Layout): void {
  for (const x of [8, 24, 40]) b.slot({ x, n: 0.36, h: 1.5, yawDeg: FACE.north, width: 0.44, height: 6.4, intensity: 1.2 });
  // the north wall above the gallery: high slots over the deck, in the bays between the rib legs
  for (const x of [16, 24, 32, 40]) b.slot({ x, n: L.D - 0.36, h: L.DECK_H + 2.2, yawDeg: FACE.south, width: 0.4, height: 4.6, intensity: 1.15 });
  // the doors' stepped portals (crest off at the exit: the white point burns there)
  b.portal({ x: L.W - 0.3, n: L.EXIT_N, yawDeg: FACE.west, width: 3, height: 3.5, steps: 3, depth: 0.85, step: 0.28, crest: false });
  b.portal({ x: 0.3, n: L.ENTRY_N, yawDeg: FACE.east, width: 3, height: 3.5, steps: 3, depth: 0.85, step: 0.28 });
  // the painting's twin rails, inlaid down the hall (fine gold, reflective, no glow)
  b.inlay({ x: L.W / 2, n: L.LANE_N[1], h: 0.003, kind: 'lines', w: 1.4, d: L.W - 6, yawDeg: FACE.east, count: 2, width: 0.035 });
  // navy Reformation crates with their lit strips, stacked in the east corners behind the formation, out of the
  // lanes (no colliders; nothing walks there)
  for (const [x, n, yaw, v] of [[55.0, 1.1, 90, 1], [55.0, 24.9, 90, 1], [52.6, 25.2, 0, 2]] as const) {
    b.prop('refCrate', { x, n, yawDeg: yaw, variant: v, collider: false });
  }
  // daylight haze high in the hall, under the vault's seams
  // (in open air: below the wall tops, clear of the walls, over the gallery's heads)
  b.haze({ x: L.W / 2, n: L.D / 2, h: 4.2, w: L.W - 1.6, d: L.D - 1.6, height: L.WALL_H - 4.4, density: 0.045, falloff: -0.9, color: 0xf0eee8, intensity: 0.95 });
}
