/**
 * Z08 — the space (plan coordinates, origin at the south-west corner; built to pdf/ref-z08-tactical-plan.png).
 *
 *   70 × 48 m at local 0. SOUTH ENTRY at x 35 (the companion staging just inside it); the ELITE COURT, 18 × 14 m,
 *   centred (35, 24) with the W and E circulation loops round it (≥ 3 m clear); ten cover islands as drawn
 *   (light 1.2 m, dark 2.2 m, 3 m wide); the EAST DECK +3 m (x 54–63, n 16–30) with two 6 × 10 m ramps whose
 *   feet are gated by manual shutters (the east flank); the survivor recesses W (x 3–15, n 35–45) and E
 *   (x 62–70, n 35–45) behind the fight; the north doorway at x 35, 5 × 4.5 m — the organism's breach, and later
 *   the one-way descending corridor to Z09. Four King-era isolation barriers stand dormant on pale floor lines:
 *   west (x 24), south (n 9, between the court and the staging), east (x 50.5) and across the exit.
 *
 * Look: black mirror stone underfoot with gold rings round the court, white-gold walls and lit ribs, a vault of
 * glass over a dark sky — the battle outside goes on in amber, blue-white and violet. Violet only at the breach
 * and at the Weaver's anchor (the real sources).
 */
import type { MissionState, ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { BLUE, FACE, GOLD, IVORY } from '../shared';
import { S, resetState } from './state';

// =====================================================================================================================
// Constants
// =====================================================================================================================

/** playable envelope (plan §Z08: 70 × 48 m) */
export const W = 70;
export const D = 48;
/** solid wall height; the glass clerestory and vault above it */
const WALL_H = 14;
const RIB_H = 22;
/** the court (18 × 14) */
export const COURT = { x: 35, n: 24, w: 18, d: 14 } as const;
/** doors: south entry, north exit (the elite's 5 × 4.5 breach) */
export const ENTRY_X = 35;
export const EXIT_X = 35;
const EXIT_W = 5;
const EXIT_H = 4.5;
/** east deck and ramps */
const DECK = { x0: 54, x1: 63, n0: 16, n1: 30, h: 3 } as const;
const RAMP_X = 57;
const RAMP_W = 6;
/** survivor recesses */
const RECESS_H = 4.6;
export const RECESS_W = { x0: 3, x1: 15, n0: 35, n1: 45 } as const;
export const RECESS_E = { x0: 62, x1: 70, n0: 35, n1: 45 } as const;
/** isolation barrier lines (quarantine) */
export const BARRIER_W_X = 24;
export const BARRIER_S_N = 9;
export const BARRIER_E_X = 50.5;
const BARRIER_H = 7;
/** the clean anchor (pressure relief, plan: «reach the clean companion anchor») and its radius */
export const CLEAN_ANCHOR = { x: 35, n: 11.4, r: 2.6 } as const;

// =====================================================================================================================
// Build
// =====================================================================================================================

export function build(b: ZoneBuilder, state: MissionState): void {
  resetState();
  const west = state.rescuePriority !== 'EastWalkers';
  b.setEnv({
    sky: 'breachDeep', look: LOOKS.crucible, ambience: 'crucible', music: 'elite',
    // high, from the south-west: long rib shadows fall north-east across the court; steep for the mirror floor
    key: { dirFrom: [-22, -30, 54], intensity: 2.1, color: 0xfff0dc },
  });
  buildShell(b);
  buildRecesses(b, west);
  buildDeck(b);
  buildCover(b);
  buildCourt(b);
  buildBarriers(b);
  buildGear(b, west);
  buildLight(b);
  buildMarkers(b);
  buildScenic(b);
  b.finalize();
}

/** floor, walls, glass clerestory, ribs and vault, the two doors, the descending corridor beyond the north door */
function buildShell(b: ZoneBuilder): void {
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, inlay: 'channels', reflective: true, mat: 'blackStoneFloor' });
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'panelled', doors: [{ at: ENTRY_X, width: 4, height: 4.2 }] });
  b.wall({ from: [0, D], to: [W, D], height: WALL_H, style: 'panelled', doors: [{ at: EXIT_X, width: EXIT_W, height: EXIT_H }] });
  b.wall({ from: [0, 0], to: [0, D], height: WALL_H, style: 'ribbed' });
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'conduit' });
  // the glass band above the solid walls: the battle outside is still visible (book: the transparent ceiling)
  for (const [from, to] of [[[0, 0], [W, 0]], [[0, D], [W, D]], [[0, 0], [0, D]], [[W, 0], [W, D]]] as Array<[[number, number], [number, number]]>) {
    b.wall({ from, to, h: WALL_H, height: RIB_H - WALL_H, style: 'glass', noCollider: true });
  }
  b.ribRow({ x: 6.25, n: D / 2, span: D - 1, height: RIB_H, count: 6, spacing: 11.5, yawDeg: FACE.east, alongDeg: FACE.east, lit: true });
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: RIB_H + 0.3, style: 'glass' });

  // south entry: the way the party came in (survivors leave through it in `quarantine`)
  S.entry = b.door({ x: ENTRY_X, n: 0, width: 4, height: 4.2 });
  S.entry.setState('sealed');
  // north doorway: the organism's breach, then the one-way corridor down (opened in `quarantine`)
  S.exit = b.door({ x: EXIT_X, n: D, width: EXIT_W, height: EXIT_H, style: 'threshold' });
  S.exit.setState('sealed');
  const cn = D + 4;
  b.floor({ x: EXIT_X, n: cn, w: EXIT_W + 0.6, d: 8, inlay: 'channels', mat: 'blackStoneFloor' });
  for (const s of [-1, 1]) {
    const x = EXIT_X + s * (EXIT_W / 2 + 0.3);
    b.wall({ from: [x, D], to: [x, D + 8], height: 6, mat: 'blackStone', style: 'plain' });
    // walls pulsing with white-gold light (book): the descending corridor's seams
    for (const h of [1.2, 2.6, 4.0]) b.channel([[x - s * 0.32, D + 0.6], [x - s * 0.32, D + 7.6]], { h, vertical: true, width: 0.06, color: IVORY, intensity: 3, pulse: true });
  }
  b.wall({ from: [EXIT_X - 3, D + 8], to: [EXIT_X + 3, D + 8], height: 6, mat: 'blackStone', style: 'plain' });
  b.ceiling({ x: EXIT_X, n: cn, w: EXIT_W + 0.6, d: 8, h: 6, style: 'flat', mat: 'blackStone' });
  b.panelLight({ x: EXIT_X, n: D + 7.6, w: 2.6, d: 3, h: 1.2, facing: 'south', intensity: 2.4 });
  // the white point: the brightest thing at the north end, two lit pylons lead the eye to it
  b.whitePoint({ x: EXIT_X, n: D - 0.9, h: EXIT_H + 1.8, intensity: 1.8 });
  b.column({ x: EXIT_X - 4.6, n: D - 1.2, height: 9.5, style: 'pylon', lit: true });
  b.column({ x: EXIT_X + 4.6, n: D - 1.2, height: 9.5, style: 'pylon', lit: true });
  // the breach: Eclipse growth on the doorway the organism came through (a real source — faint)
  b.corruption({ x: EXIT_X - 2.9, n: D - 0.35, h: 2.1, r: 1.3, onWall: true, yawDeg: FACE.south, intensity: 0.5 });
  b.corruption({ x: EXIT_X + 2.9, n: D - 0.35, h: 1.4, r: 1.0, onWall: true, yawDeg: FACE.south, intensity: 0.4 });
  b.corruption({ x: EXIT_X + 1.2, n: D - 1.6, r: 1.4, intensity: 0.35 });
}

/** W and E survivor recesses: open-fronted shelters behind the fight, warm inside, with their shutters raised */
function buildRecesses(b: ZoneBuilder, west: boolean): void {
  for (const r of [RECESS_W, RECESS_E]) {
    const westSide = r === RECESS_W;
    const mouthX = westSide ? 9 : 66;
    const mouthW = westSide ? 5 : 4;
    // side walls (the E recess uses the room's east wall as its far side)
    b.wall({ from: [r.x0, r.n0], to: [r.x0, r.n1], height: RECESS_H, style: 'panelled' });
    if (westSide) b.wall({ from: [r.x1, r.n0], to: [r.x1, r.n1], height: RECESS_H, style: 'panelled' });
    b.wall({ from: [r.x0, r.n1], to: [r.x1, r.n1], height: RECESS_H, style: 'conduit' });
    b.wall({ from: [r.x0, r.n0], to: [r.x1, r.n0], height: RECESS_H, style: 'panelled', doors: [{ at: mouthX - r.x0, width: mouthW, height: 3.6 }] });
    b.ceiling({ x: (r.x0 + r.x1) / 2, n: (r.n0 + r.n1) / 2, w: r.x1 - r.x0, d: r.n1 - r.n0, h: RECESS_H, style: 'flat' });
    // the manual shutter of the recess, raised (S-W / S-E on the drawing)
    b.door({ x: mouthX, n: r.n0, width: mouthW, height: 3.6, style: 'service', open: true }).setState('open');
    b.panelLight({ x: (r.x0 + r.x1) / 2, n: r.n1 - 1.2, w: 3.2, d: 0.6, h: RECESS_H - 0.12, facing: 'down', intensity: 1.6 });
    // nothing to hide in behind the recess
    b.blocker({ x: (r.x0 + r.x1) / 2, n: (r.n1 + D) / 2, w: r.x1 - r.x0, d: D - r.n1, height: 5 });
  }
  b.blocker({ x: RECESS_W.x0 / 2, n: (RECESS_W.n0 + D) / 2, w: RECESS_W.x0, d: D - RECESS_W.n0, height: 5 });
  // medical gear in both recesses; the field cache is staged in the west alcove only when the medics were chosen
  b.prop('refCrate', { x: 4.2, n: 43.6, yawDeg: 90, variant: 1 });
  b.prop('medKit', { x: 13.6, n: 43.8, yawDeg: 200 });
  b.prop('casualtyTarp', { x: 66.5, n: 43.4, yawDeg: 0 });
  b.prop('medKit', { x: 68.6, n: 37, yawDeg: 300 });
  if (west) {
    b.prop('domFieldCache', { x: 13.4, n: 37.6, yawDeg: 270 });
    b.prop('domAmmoCase', { x: 4.4, n: 37.2, yawDeg: 80 });
  }
}

/** the east flank: +3 m deck, two ramps, manual shutters at the ramp feet (closed until the flank opens) */
function buildDeck(b: ZoneBuilder): void {
  const w = DECK.x1 - DECK.x0;
  b.deck({
    x: (DECK.x0 + DECK.x1) / 2, n: (DECK.n0 + DECK.n1) / 2, w, d: DECK.n1 - DECK.n0, h: DECK.h, solidBelow: true,
    rails: ['n', 's', 'e', 'w'], inlay: 'channels', mat: 'blackStoneFloor',
    railGaps: [{ side: 's', at: RAMP_X - DECK.x0, width: RAMP_W }, { side: 'n', at: RAMP_X - DECK.x0, width: RAMP_W }],
  });
  b.ramp({ x: RAMP_X, n: DECK.n0 - 5, w: RAMP_W, d: 10, h0: 0, h1: DECK.h, yawDeg: FACE.north, rails: true, mat: 'blackStoneFloor' });
  b.ramp({ x: RAMP_X, n: DECK.n1 + 5, w: RAMP_W, d: 10, h0: 0, h1: DECK.h, yawDeg: FACE.south, rails: true, mat: 'blackStoneFloor' });
  S.gateS = b.door({ x: RAMP_X, n: DECK.n0 - 10.4, width: RAMP_W, height: 3.6, style: 'service' });
  S.gateN = b.door({ x: RAMP_X, n: DECK.n1 + 10.4, yawDeg: FACE.south, width: RAMP_W, height: 3.6, style: 'service' });
  S.gateS.setState('locked');
  S.gateN.setState('locked');
  // one piece of cover up top so the balcony is an angle, not a shooting gallery
  b.coverLow({ x: 58.5, n: 23, h: DECK.h, w: 2.4, yawDeg: FACE.west, style: 'ancient' });
  // the space between the deck and the east wall is closed off
  b.blocker({ x: (DECK.x1 + W) / 2, n: (DECK.n0 + DECK.n1) / 2, w: W - DECK.x1, d: DECK.n1 - DECK.n0, height: 6 });
}

/** the ten cover islands of the drawing (light 1.2 m, dark 2.2 m; each 3 m wide) */
function buildCover(b: ZoneBuilder): void {
  const low = (x: number, n: number, yaw: number, style: 'ancient' | 'plate' | 'debris') => b.coverLow({ x, n, w: 3, d: 3, yawDeg: yaw, style });
  const high = (x: number, n: number, yaw: number, d = 3) => b.coverHigh({ x, n, w: 3, d, yawDeg: yaw, style: 'ancient' });
  low(18.5, 37.3, FACE.east, 'ancient');
  high(19.5, 27.5, FACE.east);
  high(9.5, 20.5, FACE.east);
  low(19.5, 14.5, FACE.east, 'plate');
  low(7.5, 8.5, FACE.north, 'debris');
  high(31.5, 37.3, FACE.north, 1.6);
  low(42.5, 38.5, FACE.north, 'ancient');
  low(47.5, 28.5, FACE.west, 'ancient');
  high(47.5, 14.5, FACE.west);
  low(40.5, 11.5, FACE.north, 'plate');
}

/** gold rings round the court: the arena reads from any angle; light as information */
function buildCourt(b: ZoneBuilder): void {
  const ring = (r: number, seg: number, width: number, intensity: number) => {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push([COURT.x + Math.cos(a) * r, COURT.n + Math.sin(a) * r]);
    }
    b.channel(pts, { width, intensity });
  };
  ring(6.6, 40, 0.07, 2.2);
  ring(4.4, 32, 0.05, 1.8);
  ring(1.6, 16, 0.05, 2.4);
  const x0 = COURT.x - COURT.w / 2, x1 = COURT.x + COURT.w / 2, n0 = COURT.n - COURT.d / 2, n1 = COURT.n + COURT.d / 2;
  b.channel([[x0, n0], [x1, n0], [x1, n1], [x0, n1], [x0, n0]], { width: 0.08, intensity: 2.4 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.channel([[COURT.x + Math.cos(a) * 4.6, COURT.n + Math.sin(a) * 4.6], [COURT.x + Math.cos(a) * 6.4, COURT.n + Math.sin(a) * 6.4]], { width: 0.05, intensity: 1.8 });
  }
  // the clean anchor by the staging: a ring of steady gold light the corruption does not reach
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push([CLEAN_ANCHOR.x + Math.cos(a) * 1.7, CLEAN_ANCHOR.n + Math.sin(a) * 1.7]);
  }
  b.channel(pts, { width: 0.09, intensity: 3.2, color: GOLD });
  b.panelLight({ x: CLEAN_ANCHOR.x, n: CLEAN_ANCHOR.n, w: 1.1, d: 1.1, h: 0.02, facing: 'up', intensity: 1.4 });
}

/**
 * The King-era containment the terminal wakes in `quarantine`: dormant isolation barriers on pale floor lines.
 * Their emitter posts stand in the room from the start (the two mid-floor ones are solid).
 */
function buildBarriers(b: ZoneBuilder): void {
  S.barrierW = b.barrier({ from: [BARRIER_W_X, 0.4], to: [BARRIER_W_X, D - 0.4], height: BARRIER_H, active: false });
  S.barrierS = b.barrier({ from: [BARRIER_W_X, BARRIER_S_N], to: [BARRIER_E_X, BARRIER_S_N], height: BARRIER_H, active: false });
  S.barrierE = b.barrier({ from: [BARRIER_E_X, 0.4], to: [BARRIER_E_X, D - 0.4], height: BARRIER_H, active: false });
  S.barrierExit = b.barrier({ from: [EXIT_X - EXIT_W / 2 - 0.2, D + 1.1], to: [EXIT_X + EXIT_W / 2 + 0.2, D + 1.1], height: EXIT_H, active: false });
  for (const [x, n] of [[BARRIER_W_X, BARRIER_S_N], [BARRIER_E_X, BARRIER_S_N]]) b.blocker({ x, n, w: 0.7, d: 0.7, height: BARRIER_H });
  // the lines of pale light the floor divides along (lit when the barriers rise)
  const seam = (pts: Array<[number, number]>) => {
    const o = b.keep(b.channel(pts, { width: 0.16, color: 0xfff4dc, intensity: 5 }));
    o.visible = false;
    S.seams.push(o);
  };
  seam([[BARRIER_W_X, 0.4], [BARRIER_W_X, D - 0.4]]);
  seam([[BARRIER_W_X, BARRIER_S_N], [BARRIER_E_X, BARRIER_S_N]]);
  seam([[BARRIER_E_X, 0.4], [BARRIER_E_X, D - 0.4]]);
}

/** faction gear: temporary and modular inside the ancient room (never makes it look faction-owned) */
function buildGear(b: ZoneBuilder, west: boolean): void {
  // Selene's people at the staging: cold blue-white, modular
  b.coverLow({ x: 29.5, n: 7.4, w: 2.6, d: 1, yawDeg: FACE.north, style: 'reformation' });
  b.prop('refCrate', { x: 40.5, n: 4.2, yawDeg: 10, variant: 0 });
  b.prop('refAmmoCase', { x: 38.6, n: 3.4, yawDeg: -20 });
  b.prop('cableBundle', { x: 41.8, n: 6.6, yawDeg: 70 });
  // Lyessa's squad: bronze and amber where they hold
  if (west) {
    b.coverLow({ x: 12.4, n: 30.2, w: 2.4, d: 1, yawDeg: FACE.south, style: 'dominion' });
    b.coverLow({ x: 6.6, n: 31.2, w: 2.4, d: 1, yawDeg: FACE.south, style: 'dominion' });
  } else {
    b.coverLow({ x: 63.4, n: 31.6, w: 2.4, d: 1, yawDeg: FACE.south, style: 'dominion' });
    b.coverLow({ x: 67.6, n: 31.6, w: 2.4, d: 1, yawDeg: FACE.south, style: 'dominion' });
  }
  // ancient furniture and the wreckage of the breach
  b.prop('ancientPylon', { x: 2.2, n: 2.2 });
  b.prop('ancientPylon', { x: 67.8, n: 2.2 });
  b.prop('rubblePile', { x: 28.6, n: 45.6, yawDeg: 30 });
  b.prop('fallenPlate', { x: 43.5, n: 44.8, yawDeg: -20 });
  b.prop('debrisSmall', { x: 39.2, n: 42.4, yawDeg: 60 });
  b.prop('debrisSmall', { x: 23.4, n: 33.4, yawDeg: 140 });
  b.prop('debrisSmall', { x: 46.6, n: 20.4, yawDeg: 10 });
}

/** about a dozen lights: key, two shafts, warm recesses, cool staging, a cool court fill (figures read on black) */
function buildLight(b: ZoneBuilder): void {
  b.spot({ x: 30.5, n: 27, h: RIB_H - 1, target: [31.5, 25, 0], angleDeg: 24, intensity: 1300, shaft: true, color: 0xfff0d2 });
  b.spot({ x: 41, n: 20, h: RIB_H - 1, target: [40, 22, 0], angleDeg: 22, intensity: 1000, shaft: true, color: 0xfff0d2 });
  b.point({ x: 9, n: 39.5, h: 3.4, color: IVORY, intensity: 26, distance: 12 });
  b.point({ x: 66, n: 39.5, h: 3.4, color: IVORY, intensity: 22, distance: 10 });
  b.point({ x: 35, n: 5.2, h: 2.8, color: BLUE, intensity: 26, distance: 11 });
  b.point({ x: 35, n: 24, h: 10, color: 0xdfe6ff, intensity: 70, distance: 30 });
}

function buildMarkers(b: ZoneBuilder): void {
  // --- arrival and staging ---
  b.marker('start', 35, 4.2, 0, FACE.north);
  b.marker('tarrikStart', 37.4, 6.2, 0, FACE.north);
  b.marker('tarrikCourt', 35.5, 15.5, 0, FACE.north);
  b.marker('tharneStage', 31.2, 5.4, 0, FACE.east);
  b.marker('lyricStage', 33.2, 4.8, 0, FACE.west);
  b.marker('cleanAnchor', CLEAN_ANCHOR.x, CLEAN_ANCHOR.n, 0);
  // --- Lyessa and the two squad soldiers at the chosen support position ---
  b.marker('lyessaW', 12.4, 29.2, 0, 150);
  b.marker('soldierW1', 6.6, 30.2, 0, 160);
  b.marker('soldierW2', 16.6, 32.6, 0, 130);
  b.marker('lyessaE', 61.2, 32.8, 0, 220);
  b.marker('soldierE1', 63.4, 30.4, 0, 200);
  b.marker('soldierE2', 67.6, 30.4, 0, 190);
  // --- survivors ---
  b.marker('medicA', 7.4, 39.4, 0, FACE.east);
  b.marker('medicB', 12.2, 41.6, 0, FACE.west);
  b.marker('litterW1', 9, 39.4, 0, FACE.east);
  b.marker('litterW2', 10.6, 42.4, 0, FACE.east);
  b.marker('litterO', 5.2, 43.4, 0, FACE.east);
  b.marker('helperW', 5.4, 37.8, 0, 60);
  b.marker('walker1', 64.6, 38.4, 0, FACE.south);
  b.marker('walker2', 67, 40.6, 0, 200);
  b.marker('walker3', 68.2, 37.4, 0, 230);
  b.marker('shutterWheel', 59.4, 41.4, 0, 200);
  b.marker('walkerGate1', 61.2, 42.4, 0, 230);
  b.marker('walkerGate2', 62.6, 41, 0, 250);
  b.marker('cacheW1', 13, 39.2, 0);
  b.marker('cacheW2', 11.4, 37.2, 0);
  b.marker('cacheW3', 5.4, 36.4, 0);
  b.marker('sustainS', 26.5, 6.4, 0);
  b.marker('sustainE', 46.5, 33.6, 0);
  b.marker('sustainDeck', 60.5, 18.6, DECK.h);
  // --- encounter ---
  b.marker('eliteIn', EXIT_X, D - 4.5, 0, FACE.south);
  b.marker('eliteB', COURT.x, COURT.n + 3, 0, FACE.south);
  b.marker('weaverIn', 38.5, D - 6.5, 0, FACE.south);
  b.marker('lbIn0', 29.5, D - 9.5, 0, FACE.south);
  b.marker('lbIn1', 41.5, D - 10.5, 0, FACE.south);
  b.marker('anchor', 25.6, D - 3.6, 0, FACE.south);
  b.marker('wrIn', 17.75, 40.5, 0, FACE.south);
  b.marker('frostAnchor', 28.6, 18.4, 0, 45);
  b.marker('tarrikB', 35, 15.2, 0, FACE.north);
  // --- the finish (positions everyone is cut to) ---
  b.marker('eliteFinish', COURT.x, COURT.n + 1.4, 0, FACE.south);
  b.marker('tarrikFinish', COURT.x + 0.2, COURT.n - 2.4, 0, FACE.north);
  b.marker('seleneFinish', COURT.x - 3.6, COURT.n - 1.6, 0, 60);
  b.marker('lyessaFinish', COURT.x + 5.6, COURT.n - 6.2, 0, 320);
  b.marker('officerFell', COURT.x + 0.3, COURT.n - 0.4, 0, FACE.south);
  b.marker('officerSalute', COURT.x + 1.8, COURT.n - 2.6, 0, 330);
  // --- quarantine ---
  b.marker('lyessaQ', 19.4, 22.6, 0, FACE.east);
  b.marker('lyessaJump', 23.1, 23.2, 0, FACE.east);
  b.marker('soldierQ1', 17.2, 20.8, 0, FACE.east);
  b.marker('soldierQ2', 17.8, 25.4, 0, FACE.east);
  b.marker('tarrikQ', 30.5, 23.2, 0, FACE.west);
  b.marker('tarrikWall', 25.2, 23.2, 0, FACE.west);
  b.marker('seleneQ', 35.6, 17, 0, FACE.south);
  b.marker('seleneWall', 34.2, 10.1, 0, FACE.south);
  b.marker('tarrikGo', 33.8, 38, 0, FACE.north);
  b.marker('seleneGo', 36.4, 38.4, 0, FACE.north);
  b.marker('litterO2', COURT.x + 1.6, COURT.n - 1.2, 0, FACE.west);
  b.marker('southOut', ENTRY_X, -4, 0, FACE.south);
  b.marker('southDoor', ENTRY_X, 1.6, 0, FACE.south);
  b.marker('medicCount', ENTRY_X - 2.6, 2.4, 0, 60);
  b.marker('exit', EXIT_X, D + 3.4, 0, FACE.north);
}

/** far field: the crucible is one cell of a far larger structure; dust in the shafts, gold motes over the court */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const nave = game.sky.scenic.megaRibs({ count: 6, span: 190, height: 130, spacing: 85, seed: 808 });
  nave.position.copy(b.P(-70, D / 2, -6));
  nave.rotation.y = -Math.PI / 2;
  b.add(nave);
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 6), { x: W, y: 12, z: D }, 0.45);
  game.vfx.ambient('goldMotes', b.P(COURT.x, COURT.n, 4), { x: 22, y: 8, z: 18 }, 0.25);
}
