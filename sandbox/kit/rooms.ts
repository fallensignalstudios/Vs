/**
 * Kit showcase rooms — built ONLY through the public ZoneBuilder, exactly as a zone author would.
 *   hall     upper white-gold hall 56 × 26 (rib row, three cover bands, +2 flank, faction clutter, doors)
 *   gallery  lower black-stone gallery 34 × 22 (mirror floor, gold channels, glass wall, barrier, consoles)
 *   z04      the Z04 relay overlook blockout 62 × 38 (+3 balcony, two ramps, cover islands)
 *   props    every prop kind, cover family and dressing piece on a contact sheet
 */
import type { BarrierHandle, DoorHandle, ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { PROP_KINDS } from '@/world/kit';

export interface Room {
  doors: DoorHandle[];
  barriers: BarrierHandle[];
  /** where the scale figures stand: plan x, n, h */
  figures: Array<[number, number, number]>;
  /** default camera: world position + look-at */
  cam: { pos: [number, number, number]; look: [number, number, number] };
}

export function buildHall(b: ZoneBuilder): Room {
  b.setEnv({ sky: 'crashRib', look: LOOKS.pressureHall, ambience: 'pressureHall', music: 'approachTarrik', key: { dirFrom: [-14, 22, 34], intensity: 2.1 } });
  b.floor({ x: 13, n: 28, w: 26, d: 56, inlay: 'channels', reflective: true });
  b.wall({ from: [0, 0], to: [26, 0], height: 10, style: 'panelled', doors: [{ at: 13, width: 3, height: 3.5 }] });
  b.wall({ from: [0, 56], to: [26, 56], height: 10, style: 'panelled', doors: [{ at: 13, width: 3, height: 3.5 }] });
  b.wall({ from: [0, 0], to: [0, 56], height: 10, style: 'conduit' });
  b.wall({ from: [26, 0], to: [26, 56], height: 10, style: 'ribbed' });
  b.ribRow({ x: 13, n: 4.5, span: 23.4, height: 14, count: 7, spacing: 7.8 });
  b.ceiling({ x: 13, n: 28, w: 26, d: 56, h: 14.3, style: 'lattice' });
  const entry = b.door({ x: 13, n: 0, open: true });
  const exit = b.door({ x: 13, n: 56 });
  b.whitePoint({ x: 13, n: 55.1, h: 5.4 });

  // left flank: +2 m walkway with a ramp at each end
  b.deck({ x: 3, n: 29, w: 5.4, d: 22, h: 2, solidBelow: true, rails: ['e'] });
  b.ramp({ x: 3, n: 13, w: 5.4, d: 10, h0: 0, h1: 2, rails: true });
  b.ramp({ x: 3, n: 45, w: 5.4, d: 10, h0: 0, h1: 2, yawDeg: 180, rails: true });

  // three cover bands at ~10 / 22 / 38 m
  b.coverLow({ x: 10, n: 10, style: 'reformation' });
  b.coverLow({ x: 17, n: 10.5, style: 'ancient' });
  b.coverHigh({ x: 22.5, n: 9.5, w: 2.4, style: 'ancient' });
  b.coverLow({ x: 9.5, n: 22, style: 'ancient' });
  b.coverHigh({ x: 15, n: 22.5, w: 2.6, style: 'plate' });
  b.coverLow({ x: 20.5, n: 21.5, style: 'debris' });
  b.coverLow({ x: 10.5, n: 38, style: 'dominion' });
  b.coverHigh({ x: 16.5, n: 38.5, w: 2.6, style: 'dominion' });
  b.coverLow({ x: 22, n: 37.5, style: 'ancient' });
  b.coverLow({ x: 3, n: 27, w: 2.4, h: 2, style: 'ancient' });

  // Reformation gear by the entry, Dominion gear toward the exit
  b.prop('refCrate', { x: 8.2, n: 4.2, yawDeg: 12, variant: 1 });
  b.prop('refCrate', { x: 9.7, n: 3.8, yawDeg: -8, variant: 0 });
  b.prop('refCrate', { x: 19.5, n: 5, yawDeg: 80, variant: 2 });
  b.prop('refConsole', { x: 17.6, n: 3.2, yawDeg: 200 });
  b.prop('refSensorMast', { x: 20.8, n: 8, yawDeg: 20 });
  b.prop('refLamp', { x: 7, n: 8.6, yawDeg: 60 });
  b.prop('refAmmoCase', { x: 11.4, n: 9.2, yawDeg: 30 });
  b.prop('refStretcher', { x: 22.6, n: 3.6, yawDeg: 90 });
  b.prop('medKit', { x: 21.4, n: 3.0, variant: 0 });
  b.prop('cableBundle', { x: 18.8, n: 5.2, yawDeg: 30 });
  b.prop('domCrate', { x: 8, n: 43, yawDeg: 6, variant: 1 });
  b.prop('domCrate', { x: 9.8, n: 43.6, yawDeg: -14, variant: 0 });
  b.prop('domFieldCache', { x: 20.5, n: 46, yawDeg: 184 });
  b.prop('domBanner', { x: 9.6, n: 53.6 });
  b.prop('domBanner', { x: 16.4, n: 53.6 });
  b.prop('domLamp', { x: 18.2, n: 41.6 });
  b.prop('domLamp', { x: 7.6, n: 50.5 });
  b.prop('domAmmoCase', { x: 11.4, n: 39.2, yawDeg: 70 });
  b.prop('domBarricade', { x: 13, n: 47.5, yawDeg: 180 });
  b.prop('rubblePile', { x: 23.4, n: 29 });
  b.prop('fallenPlate', { x: 21.5, n: 16, yawDeg: 25 });
  b.prop('debrisSmall', { x: 18, n: 18 });
  b.prop('debrisSmall', { x: 12.5, n: 30.5 });
  b.prop('ancientPylon', { x: 6.6, n: 18.6 });
  b.prop('ancientPylon', { x: 6.6, n: 39.4 });
  b.prop('ancientBench', { x: 24.6, n: 44, yawDeg: 270 });

  b.spot({ x: 13, n: 30, h: 13.2, target: [14, 31, 0], angleDeg: 20, intensity: 900, shaft: true, color: 0xfff0d2 });
  b.marker('spawn', 13, 2.5, 0, 0);
  b.marker('exit', 13, 54, 0, 0);
  b.finalize();
  return {
    doors: [entry, exit], barriers: [],
    figures: [[13, 6, 0], [16.5, 36.6, 0], [3, 30, 2], [13, 52, 0]],
    cam: { pos: [14.6, 1.7, -1.8], look: [12.6, 3.2, -30] },
  };
}

export function buildGallery(b: ZoneBuilder): Room {
  b.setEnv({ sky: 'observation', look: LOOKS.gallery, ambience: 'gallery', music: 'decision', key: { dirFrom: [4, 14, 30], intensity: 1.1, color: 0xcfdcff } });
  b.floor({ x: 17, n: 11, w: 34, d: 22, mat: 'blackStoneFloor', reflective: true, inlay: 'channels' });
  b.wall({ from: [0, 0], to: [34, 0], height: 7, mat: 'blackStone', style: 'conduit', doors: [{ at: 17, width: 3, height: 3.5 }] });
  b.wall({ from: [0, 0], to: [0, 22], height: 7, mat: 'blackStone', style: 'ribbed' });
  b.wall({ from: [34, 0], to: [34, 22], height: 7, mat: 'blackStone', style: 'ribbed' });
  b.wall({ from: [0, 22], to: [34, 22], height: 7, mat: 'blackStone', style: 'glass' });
  b.ceiling({ x: 17, n: 11, w: 34, d: 22, h: 7, mat: 'blackStone', style: 'flat' });
  for (const x of [5, 12, 22, 29]) b.column({ x, n: 19.4, r: 0.55, height: 7, mat: 'blackStone', style: 'pylon' });
  const door = b.door({ x: 17, n: 0, style: 'threshold' });
  door.setState('ready');
  b.whitePoint({ x: 17, n: 0.9, h: 5.2, intensity: 0.7 });

  // isolation cell on the east side
  b.wall({ from: [24, 0], to: [24, 4], height: 7, mat: 'blackStone' });
  b.wall({ from: [24, 12], to: [24, 15], height: 7, mat: 'blackStone' });
  const barrier = b.barrier({ from: [24, 4.3], to: [24, 11.7], height: 4.5 });

  // the station the story happens at, its scenic targets beyond the glass
  b.prop('fireControlStation', { x: 13, n: 16.6 });
  b.prop('recoveryPanel', { x: 29, n: 8, yawDeg: 270 });
  b.prop('ancientConsole', { x: 5.5, n: 6, yawDeg: 90 });
  b.prop('ancientConsole', { x: 5.5, n: 12, yawDeg: 90 });
  b.prop('conduitJunction', { x: 20, n: 3 });
  b.prop('refConsole', { x: 9.5, n: 3.4, yawDeg: 180 });
  b.prop('refSealedCase', { x: 29.5, n: 3.6, yawDeg: 300 });
  b.prop('ancientBench', { x: 17, n: 8, yawDeg: 0 });
  b.floor({ x: 17, n: 30, w: 46, d: 16, mat: 'blackStone', noSurface: true, inlay: 'none' });
  b.prop('domResonator', { x: 8, n: 29 });
  b.prop('refRecoveryPlatform', { x: 25, n: 29, yawDeg: 180 });
  b.channel([[13, 13.4], [13, 9.5], [10, 6.5], [10, 1]], {});
  b.conduit([[0.5, 5, 5.6], [0.5, 17, 5.6], [0.5, 17, 6.4]], { glow: true, r: 0.09 });

  b.marker('spawn', 17, 2, 0, 0);
  b.finalize();
  return {
    doors: [door], barriers: [barrier],
    figures: [[13, 15.1, 0], [29.9, 8, 0], [21, 6, 0]],
    cam: { pos: [17.5, 1.7, -1.6], look: [15.5, 2.0, -18] },
  };
}

export function buildZ04(b: ZoneBuilder): Room {
  b.setEnv({ sky: 'frozenInterior', look: LOOKS.relay, ambience: 'relayOverlook', music: 'stealth', key: { dirFrom: [26, 10, 30], intensity: 2.4 } });
  b.floor({ x: 31, n: 19, w: 62, d: 38, inlay: 'grid' });
  b.floor({ x: 31, n: -3, w: 6, d: 6, inlay: 'none' });
  b.floor({ x: 31, n: 41, w: 6, d: 6, inlay: 'none' });
  // perimeter: openings south (from Z03) and north (to Z05)
  b.wall({ from: [0, 0], to: [62, 0], height: 12, style: 'ribbed', doors: [{ at: 31, width: 5, height: 4.5 }] });
  b.wall({ from: [0, 38], to: [62, 38], height: 12, style: 'ribbed', doors: [{ at: 31, width: 5, height: 4.5 }] });
  b.wall({ from: [0, 0], to: [0, 38], height: 12, style: 'conduit' });
  b.wall({ from: [62, 0], to: [62, 38], height: 12, style: 'glass' });
  b.walls([[28, 0], [28, -6], [34, -6], [34, 0]], { height: 6, style: 'panelled' });
  b.walls([[28, 38], [28, 44], [34, 44], [34, 38]], { height: 6, style: 'panelled' });
  b.ribRow({ x: 5, n: 19, span: 36.6, height: 19, count: 6, spacing: 10.4, yawDeg: 90 });
  const entry = b.door({ x: 31, n: 0, width: 5, height: 4.5, open: true });
  const exit = b.door({ x: 31, n: 38, width: 5, height: 4.5, style: 'quarantine' });
  b.whitePoint({ x: 31, n: 37.2, h: 6.6 });

  // high route: +3 balcony, 12 m south ramp, west down-ramp, pocket
  b.deck({
    x: 51, n: 28.5, w: 14, d: 11, h: 3, rails: ['n', 's', 'e', 'w'],
    railGaps: [{ side: 's', at: 10, width: 6 }, { side: 'w', at: 7, width: 6 }, { side: 'n', at: 1, width: 2 }],
  });
  b.deck({ x: 39.5, n: 36, w: 13, d: 4, h: 3, rails: ['s', 'w', 'e'], railGaps: [{ side: 's', at: 12, width: 2 }], supports: false });
  b.ramp({ x: 54, n: 17, w: 6, d: 12, h0: 0, h1: 3, rails: true });
  b.ramp({ x: 38, n: 30, w: 6, d: 12, h0: 0, h1: 3, yawDeg: 90, rails: true });

  // cover islands: light = low, dark = high (tactical plan)
  for (const [x, n, w, d] of [[15.5, 34, 3, 2], [26.5, 26.5, 3, 3], [30.5, 7.5, 3, 3], [39.5, 10.5, 3, 3]] as const) b.coverLow({ x, n, w, d, style: 'ancient' });
  b.coverLow({ x: 51.5, n: 26, w: 3, d: 2, h: 3, style: 'reformation' });
  for (const [x, n] of [[12.5, 20.5], [25.5, 15.5], [44.5, 21.5], [47.5, 9.5]] as const) b.coverHigh({ x, n, w: 3, d: 3, style: 'ancient' });

  // relay receivers, scan head, faction traces
  b.prop('ancientPedestal', { x: 35, n: 18 });
  b.prop('ancientPedestal', { x: 16, n: 27 });
  b.prop('refSensorMast', { x: 8, n: 11, yawDeg: 70 });
  b.prop('refCrate', { x: 22, n: 5, variant: 1 });
  b.prop('refCrate', { x: 23.6, n: 4.4, yawDeg: 25, variant: 0 });
  b.prop('refLamp', { x: 36.5, n: 4 });
  b.prop('domCrate', { x: 20, n: 33, variant: 2 });
  b.prop('domLamp', { x: 23.5, n: 35 });
  b.prop('refCrate', { x: 56, n: 32.5, h: 3, yawDeg: 15, variant: 0 });
  b.prop('refSensorMast', { x: 56.5, n: 24.5, h: 3, yawDeg: 250 });
  b.spot({ x: 30, n: 19, h: 17, target: [28, 20, 0], angleDeg: 24, intensity: 1500, shaft: true });

  b.marker('spawn', 31, -2, 0, 0);
  b.marker('overlook', 51, 28, 3, 270);
  b.finalize();
  return {
    doors: [entry, exit], barriers: [],
    figures: [[31, 3, 0], [51, 29, 3], [35, 20, 0], [20, 22, 0]],
    cam: { pos: [28.5, 1.7, 3.5], look: [42, 3.5, -26] },
  };
}

export function buildProps(b: ZoneBuilder): Room {
  b.setEnv({ sky: 'void', look: LOOKS.neutral, key: { dirFrom: [-10, -14, 30], intensity: 2.6 } });
  b.floor({ x: 24, n: 22, w: 56, d: 52, inlay: 'grid' });
  b.wall({ from: [-4, 48], to: [52, 48], height: 6, style: 'panelled' });
  PROP_KINDS.forEach((kind, i) => {
    b.prop(kind, { x: (i % 8) * 6.4, n: Math.floor(i / 8) * 6.2, yawDeg: 180, variant: 0 });
  });
  const styles = ['ancient', 'dominion', 'reformation', 'debris', 'plate'] as const;
  styles.forEach((style, i) => {
    b.coverLow({ x: i * 5, n: 32, style });
    b.coverHigh({ x: i * 5, n: 35.5, style });
  });
  b.column({ x: 27, n: 33, style: 'round', height: 6, lit: true });
  b.column({ x: 30, n: 33, style: 'faceted', height: 6, lit: true });
  b.column({ x: 33, n: 33, style: 'pylon', height: 6 });
  b.column({ x: 36, n: 33, style: 'pylon', height: 6, mat: 'blackStone' });
  b.rib({ x: 8, n: 43, span: 12, height: 9, style: 'broken' });
  b.rib({ x: 24, n: 43, span: 12, height: 9, style: 'frozen' });
  b.rib({ x: 38, n: 43, span: 12, height: 9, style: 'half' });
  b.frost({ x: 42, n: 36, w: 7, d: 0.8, height: 4 });
  b.corruption({ x: 47, n: 28, r: 2.2 });
  b.corruption({ x: 49, n: 47.6, h: 2.5, r: 1.6, onWall: true, yawDeg: 180 });
  b.rail({ from: [40, 30], to: [46, 30], style: 'glass' });
  b.bridge({ from: [-3, 26], to: [-3, 44], h: 0, width: 3, broken: 'far' });
  b.panelLight({ x: 20, n: 47.6, w: 3, d: 1, h: 3.5, facing: 'south' });
  // a vaulted side bay
  b.floor({ x: 64, n: 12, w: 10, d: 24, inlay: 'channels' });
  b.wall({ from: [59, 0], to: [59, 24], height: 5, style: 'ribbed' });
  b.wall({ from: [69, 0], to: [69, 24], height: 5, style: 'conduit' });
  b.ceiling({ x: 64, n: 12, w: 10.6, d: 24, h: 5, style: 'vault' });
  b.point({ x: 64, n: 6, h: 3.4, intensity: 26 });
  b.point({ x: 64, n: 18, h: 3.4, intensity: 26 });
  b.marker('spawn', 24, -2, 0, 0);
  b.finalize();
  return { doors: [], barriers: [], figures: [[-2.5, -1.5, 0]], cam: { pos: [10, 5, 6], look: [16, 0.5, -12] } };
}

/** A round black-stone chamber: disc + crownmark inlay, ring wall with gaps, rim, bridge, vault, corruption. */
export function buildRotunda(b: ZoneBuilder): Room {
  b.setEnv({ sky: 'coreChamber', look: LOOKS.core, ambience: 'coreChamber', music: 'core', key: { dirFrom: [6, 10, 30], intensity: 1.0, color: 0xdfe6ff } });
  b.disc({ x: 0, n: 0, r: 16, mat: 'blackStoneFloor', reflective: true, inlay: 'crownmark', rim: { gapsDeg: [[-12, 12], [168, 192]] } });
  b.disc({ x: 0, n: 0, r: 4, h: 0.3, thickness: 0.3, mat: 'blackStoneFloor', inlay: 'radial' });
  b.ringWall({ x: 0, n: 0, r: 22, height: 14, mat: 'blackStone', style: 'ribbed', gapsDeg: [[-10, 10], [170, 190]] });
  b.disc({ x: 0, n: 0, r: 22, inner: 16, h: -2, mat: 'blackStone', noSurface: true, inlay: 'none' });
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * Math.PI * 2;
    b.column({ x: Math.sin(a) * 13, n: Math.cos(a) * 13, r: 0.5, height: 9, mat: 'blackStone', style: 'pylon' });
  }
  b.bridge({ from: [0, 16], to: [0, 30], width: 4, mat: 'blackStoneFloor' });
  b.bridge({ from: [0, -16], to: [0, -34], width: 4, mat: 'blackStoneFloor', broken: 'far' });
  b.floor({ x: 0, n: 36, w: 12, d: 12, mat: 'blackStoneFloor', reflective: true, inlay: 'grid' });
  b.ceiling({ x: 0, n: 36, w: 12, d: 12, h: 6, mat: 'blackStone', style: 'vault' });
  b.walls([[-6, 30], [-6, 42], [6, 42], [6, 30]], { height: 6, mat: 'blackStone', style: 'conduit' });
  b.rib({ x: 0, n: 0, span: 36, height: 22, mat: 'blackStone', yawDeg: 45, noCollider: true });
  b.rib({ x: 0, n: 0, span: 36, height: 22, mat: 'blackStone', yawDeg: 135, noCollider: true });
  // black stone reads only through light: a steep warm shaft on the dais, cool fills around the ring
  b.spot({ x: 0, n: 0, h: 20, target: [0, 0, 0], angleDeg: 16, intensity: 5200, color: 0xffe9c4, shaft: true, shadow: true });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    b.point({ x: Math.sin(a) * 18.5, n: Math.cos(a) * 18.5, h: 5, color: 0xbfd2ff, intensity: 60, distance: 26 });
  }
  b.point({ x: 0, n: 36, h: 4.2, color: 0xffe2a8, intensity: 30, distance: 14 });
  b.prop('ancientConsole', { x: -2.2, n: 3.2, h: 0.3, yawDeg: 145 });
  b.prop('ancientConsole', { x: 2.2, n: 3.2, h: 0.3, yawDeg: 215 });
  b.prop('controlRing', { x: 9, n: -6 });
  b.corruption({ x: -9, n: -7, r: 2.4, yawDeg: 60 });
  b.prop('eclipseGrowth', { x: -9.6, n: -7.6 });
  b.corruption({ x: 5.9, n: 38, h: 2.6, r: 1.5, onWall: true, yawDeg: 270 });
  b.whitePoint({ x: 0, n: 21.4, h: 5 });
  b.marker('spawn', 0, 26, 0, 180);
  b.finalize();
  return {
    doors: [], barriers: [],
    figures: [[-1.6, 2.2, 0.3], [1.6, 2.2, 0.3], [0, 24, 0]],
    cam: { pos: [0.8, 1.7, -27], look: [0, 3.4, 0] },
  };
}

export const ROOMS = { hall: buildHall, gallery: buildGallery, z04: buildZ04, props: buildProps, rotunda: buildRotunda } as const;
export type RoomName = keyof typeof ROOMS;
