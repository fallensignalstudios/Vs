/**
 * Z06 — dressing toward the quarantine painting (pdf/ref-concept-quarantine.png, which sets the Z06–Z08
 * interiors). Polish 4: built from the kit's art-direction pieces (merged by material in finalize()):
 *   - tall soft-lit SLOTS in the bays of the long walls between the rib legs, fine gold lines either side of them,
 *     paired PIPES with brackets in a few bays;
 *   - GALLERIES high on the end walls, over the entry and over the exit's white point (overhead, collider-free);
 *   - grounded violet CRYSTAL growth heaped at both breaches (the real sources: violet nowhere else).
 *
 * Visual only: no collider, no nav change.
 */
import type { ZoneBuilder } from '@/core/api';
import { BREACH_A, BREACH_B, D, ENTRY_N, EXIT_N, W } from './layout';

/** the walls' room faces (0.6 m thick on their plan line). (Functions, not constants: layout.ts imports this
 * module, so its exports are not initialised yet while this module's top level runs.) */
const nFace = (): number => D - 0.3;
const S_FACE = 0.3;
/** the hall closes here (the coffered skylight, layout.ts) */
const TOP = 17.2;
/** mid-bays between the rib legs (ribs every 8 m from x 4), clear of the breach in that wall */
const BAYS_N = [8, 16, 24, 32, 48] as const;
const BAYS_S = [8, 16, 24, 32, 40] as const;

export function buildDressing(b: ZoneBuilder): void {
  buildBays(b);
  buildGalleries(b);
  buildCrystals(b);
}

/** slots, gold lines and pipes in the long walls' bays */
function buildBays(b: ZoneBuilder): void {
  for (const [bays, n, facing] of [[BAYS_N, nFace(), 180], [BAYS_S, S_FACE, 0]] as const) {
    for (const x of bays) {
      b.slot({ x, n, h: 0.9, yawDeg: facing, width: 0.8, height: 10.2, intensity: 1.0, color: 0xffe4bc });
      for (const s of [-1, 1]) b.wallLine([[x + s * 1.05, n, 0.45], [x + s * 1.05, n, TOP - 0.6]], { facing, width: 0.035 });
    }
  }
  // paired service pipes with brackets up the walls beside the breaches
  b.pipes([[35.0, nFace(), 0.3], [35.0, nFace(), 16.4]], { facing: 180, count: 2, r: 0.06, mat: 'goldDark', boxes: false });
  b.pipes([[44.8, S_FACE, 0.3], [44.8, S_FACE, 16.4]], { facing: 0, count: 2, r: 0.06, mat: 'goldDark', boxes: false });
  b.pipes([[12.6, nFace(), 0.3], [12.6, nFace(), 14.5]], { facing: 180, count: 3, r: 0.05, mat: 'goldDark' });
}

/** galleries high on the end walls: over the exit's white point (east) and over the entry (west) */
function buildGalleries(b: ZoneBuilder): void {
  const depth = 2.8;
  b.tiers({ x: W - 0.3 - depth, n: EXIT_N, h: 6.2, yawDeg: 270, width: 16, levels: 1, levelHeight: 4.6, depth, rail: 'balusters', stairs: 'none' });
  b.tiers({ x: 0.3 + depth, n: ENTRY_N - 4, h: 5.6, yawDeg: 90, width: 20, levels: 1, levelHeight: 4.6, depth, rail: 'balusters', stairs: 'none' });
}

/** crystal growth heaped either side of each breach (floor and jambs), grounded */
function buildCrystals(b: ZoneBuilder): void {
  for (const [bx, wallN, toRoom] of [[BREACH_A.x, D, -1], [BREACH_B.x, 0, 1]] as const) {
    const fn = wallN + toRoom * 1.0;
    const facing = toRoom < 0 ? 180 : 0;
    // (crystals sized to the room: one large heap per breach, the rest knee to chest high)
    b.crystals({ x: bx - 3.3, n: fn, r: 1.1, size: 'large' });
    b.crystals({ x: bx + 3.2, n: fn, r: 0.9, size: 'medium' });
    b.crystals({ x: bx + 4.5, n: fn + toRoom * 0.6, r: 0.5, size: 'small' });
    b.crystals({ x: bx - 2.6, n: wallN + toRoom * 0.3, h: 1.0, r: 0.5, size: 'medium', onWall: true, yawDeg: facing });
    b.crystals({ x: bx - 1.2, n: fn + toRoom * 1.8, r: 0.5, size: 'small' });
  }
}
