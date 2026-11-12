/**
 * Z08 — dressing toward the quarantine painting (pdf/ref-concept-quarantine.png), the zone the painting is of.
 * Polish 4: built from the kit's art-direction pieces instead of the zone's own bars and prisms, so all of it joins
 * the kit's per-material static meshes in finalize() and costs almost no draw calls:
 *   - the GATE: the north doorway as a deep stepped portal (pointed head), a tall gold frame stepping in at the
 *     top, concentric gold rings over it, and one bright line up its axis — the painting's column of light and the
 *     route's white point (the only glowing line in the room besides the clean anchor and the corridor seams);
 *   - TIERS: two storeys of balconies down the west and east walls (from the floor: a ground storey of gold-framed
 *     dark doorways, galleries on corbels at 4.6 and 9.2 m), and a gallery over each survivor recess — all
 *     overhead or beyond the footprint, collider-free;
 *   - tall soft-lit SLOTS in the bays of the north and south walls, paired PIPES with brackets beside them, fine
 *     gold lines up the bays and round the recess mouths (`wallLine`);
 *   - violet CRYSTAL growth, grounded, only at the real sources: the breach (the doorway, the rib legs that flank it,
 *     shards strewn below it) and the Weaver's anchor;
 *   - the court's fine gold RINGS (one shader inlay), and the HAZE of the upper hall: daylight from within, under
 *     the glass band (the sky outside is the story's battle sky and stays).
 *
 * No collider, no nav change. The few lights are budgeted kit fixtures.
 */
import type { ZoneBuilder } from '@/core/api';
import { COURT, D, ENTRY_X, EXIT_X, RECESS_E, RECESS_W, W } from './layout';

/** the walls' room faces (0.6 m thick on their plan line). (Functions, not constants: layout.ts imports this
 * module, so its exports are not initialised yet while this module's top level runs.) */
const nFace = (): number => D - 0.3;
const S_FACE = 0.3;
const W_FACE = 0.3;
const eFace = (): number => W - 0.3;
/** solid wall height (the glass band starts above it) */
const WALL_TOP = 14;
/** the gate: the doorway's opening, the portal's depth, the arched frames' half-width, the rings' centre (the arches' too) */
const GATE = { w: 5, h: 4.5, depth: 1.2, outerH: 11.4, frame: 4.95, ringH: 8.8, rings: [0.8, 1.45, 2.1] } as const;
/** bays of the north and south walls between the rib legs (ribs every 11.5 m from x 6.25) */
const BAYS = [12, 23.5, 46.5, 58] as const;
/** the slots' light: warm, like the painting's lit slots */
const SLOT_WARM = 0xffe4bc;
/** the side galleries: storey height, depth, the stretch of wall they run along (n) */
const TIER = { lh: 4.6, depth: 3.2, n0: 3.6, n1: 33.6 } as const;

export function buildDressing(b: ZoneBuilder): void {
  buildGate(b);
  buildTiers(b);
  buildBays(b);
  buildCrystals(b);
  buildFloorAndAir(b);
}

// ---------------------------------------------------------------------------------------------------------------------
// The gate (north doorway: the breach, later the way down)
// ---------------------------------------------------------------------------------------------------------------------

function circle(x: number, n: number, h: number, r: number, seg = 56): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([x + Math.cos(a) * r, n, h + Math.sin(a) * r]);
  }
  return pts;
}

function buildGate(b: ZoneBuilder): void {
  const x = EXIT_X;
  const n = nFace();
  // the deep stepped portal round the doorway, round-headed like the painting's nested arches (its aperture is wider
  // than the opening: the doorway is unchanged)
  b.portal({ x, n, yawDeg: 180, width: GATE.w, height: GATE.h, steps: 4, depth: GATE.depth, step: 0.34, head: 'round' });
  // a tall blind arch behind it, stepping back to the wall: the gate reads at the scale of the hall
  b.portal({ x, n, yawDeg: 180, width: 7.9, height: GATE.outerH, steps: 2, depth: 0.5, step: 0.32, head: 'round', crest: false });
  // nested round-headed frames round it, the rings at their centre, a line up the axis
  b.wallLine(arch(x, n, GATE.frame, GATE.outerH - 3.95), { facing: 180, width: 0.05 });
  for (const r of GATE.rings) b.wallLine(circle(x, n, GATE.ringH, r), { facing: 180, width: r > 2 ? 0.06 : 0.045, closed: true });
  // the bright line up the axis, from over the portal's crest to under the glass: it guides to the way out
  b.wallLine([[x, n, GATE.h + 2.4], [x, n, WALL_TOP - 0.3]], { facing: 180, width: 0.1, glow: true, color: 0xfff1d6, intensity: 3.2 });
  // the entry (south wall): a shallower portal, the way the party came in and the survivors leave
  b.portal({ x: ENTRY_X, n: S_FACE, yawDeg: 0, width: 4, height: 4.2, steps: 2, depth: 0.5, step: 0.3, head: 'flat' });
}

/** a tall rectangle on a north / south wall: half-width `hw`, from `h0` to `h1` */
function frame(x: number, n: number, hw: number, h0: number, h1: number): Array<[number, number, number]> {
  return [[x - hw, n, h0], [x - hw, n, h1], [x + hw, n, h1], [x + hw, n, h0]];
}

/** a round-headed arch outline on a north / south wall: feet at 0.3 m, the head a half circle of radius `f` centred at `hc` */
function arch(x: number, n: number, f: number, hc: number, seg = 28): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [[x - f, n, 0.3]];
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI * (1 - i / seg);
    pts.push([x + Math.cos(a) * f, n, hc + Math.sin(a) * f]);
  }
  pts.push([x + f, n, 0.3]);
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tiers (balconies) — overhead or beyond the footprint, not walkable
// ---------------------------------------------------------------------------------------------------------------------

function buildTiers(b: ZoneBuilder): void {
  const nc = (TIER.n0 + TIER.n1) / 2;
  const width = TIER.n1 - TIER.n0;
  // down the west and east walls: a ground storey on the wall face, galleries overhead at 4.6 and 9.2 m
  b.tiers({ x: W_FACE + TIER.depth, n: nc, yawDeg: 90, width, levels: 2, levelHeight: TIER.lh, depth: TIER.depth, rail: 'balusters', stairs: 'none' });
  b.tiers({ x: eFace() - TIER.depth, n: nc, yawDeg: 270, width, levels: 2, levelHeight: TIER.lh, depth: TIER.depth, rail: 'balusters', stairs: 'none' });
  // a gallery over each survivor recess, on its roof (4.6 m), against the north wall
  for (const r of [RECESS_W, RECESS_E]) {
    const front = 41;
    b.tiers({
      x: (r.x0 + r.x1) / 2, n: front, h: 4.8, yawDeg: 180, width: r.x1 - r.x0 + 0.4, levels: 1, levelHeight: 4.3,
      depth: nFace() - front, rail: 'balusters', stairs: 'none',
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Wall bays: tall lit slots, pipes, gold lines; the recess mouths
// ---------------------------------------------------------------------------------------------------------------------

function buildBays(b: ZoneBuilder): void {
  for (const x of BAYS) {
    // north wall: over the recesses the slot starts above their roof
    const overRecess = x < RECESS_W.x1 + 1 || x > RECESS_E.x0 - 1;
    const h0 = overRecess ? 9.4 : 0.8;
    b.slot({ x, n: nFace(), h: h0, yawDeg: 180, width: 0.8, height: WALL_TOP - 1.2 - h0, intensity: 1.0, color: SLOT_WARM });
    // a tall gold frame round each slot, and a line either side of it (the painting's gold-lined pilasters)
    b.wallLine(frame(x, nFace(), 0.75, h0 - 0.35, WALL_TOP - 0.7), { facing: 180, width: 0.05, closed: true });
    if (!overRecess) {
      for (const s of [-1, 1]) b.wallLine([[x + s * 1.25, nFace(), 0.4], [x + s * 1.25, nFace(), WALL_TOP - 0.5]], { facing: 180, width: 0.035 });
    }
    // south wall
    b.slot({ x, n: S_FACE, h: 0.8, yawDeg: 0, width: 0.8, height: WALL_TOP - 2, intensity: 1.0, color: SLOT_WARM });
    b.wallLine(frame(x, S_FACE, 0.75, 0.45, WALL_TOP - 0.7), { facing: 0, width: 0.05, closed: true });
    for (const s of [-1, 1]) b.wallLine([[x + s * 1.1, S_FACE, 0.4], [x + s * 1.1, S_FACE, WALL_TOP - 0.5]], { facing: 0, width: 0.035 });
  }
  // paired service pipes with brackets climbing beside the rib legs of the open bays (north and south walls)
  for (const px of [20.0, 27.0, 43.0, 50.0]) b.pipes([[px, nFace(), 0.3], [px, nFace(), 13.7]], { facing: 180, count: 2, r: 0.06, mat: 'goldDark', boxes: false });
  for (const px of [16.2, 53.8]) b.pipes([[px, S_FACE, 0.3], [px, S_FACE, 13.7]], { facing: 0, count: 2, r: 0.06, mat: 'goldDark', boxes: false });

  // gold frames round the survivor recess mouths (they face south, into the room)
  for (const [r, mx, mw] of [[RECESS_W, 9, 5], [RECESS_E, 66, 4]] as const) {
    const n = r.n0 - 0.3;
    const hw = mw / 2 + 0.3;
    b.wallLine([[mx - hw, n, 0], [mx - hw, n, 4.0], [mx + hw, n, 4.0], [mx + hw, n, 0]], { facing: 180, width: 0.05 });
    b.wallLine([[r.x0 + 0.4, n, 4.3], [r.x1 - 0.4, n, 4.3]], { facing: 180, width: 0.035 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Crystal growth — only at the real sources (the breach and the Weaver's anchor), grounded
// ---------------------------------------------------------------------------------------------------------------------

function buildCrystals(b: ZoneBuilder): void {
  const x = EXIT_X;
  // heaped at the portal's feet, either side of the doorway
  b.crystals({ x: x - 4.6, n: D - 1.6, r: 1.3, size: 'large', light: true });
  b.crystals({ x: x + 4.5, n: D - 1.5, r: 1.1, size: 'large' });
  // climbing the rib legs that flank the gate (their faces toward the doorway)
  b.crystals({ x: x - 4.75, n: D - 1.0, h: 2.6, r: 0.7, size: 'medium', onWall: true, yawDeg: 90 });
  b.crystals({ x: x - 4.75, n: D - 1.0, h: 5.0, r: 0.5, size: 'small', onWall: true, yawDeg: 90 });
  b.crystals({ x: x + 4.76, n: D - 1.0, h: 3.2, r: 0.6, size: 'medium', onWall: true, yawDeg: 270 });
  // shards strewn below the breach
  b.crystals({ x: x - 1.9, n: D - 3.9, r: 0.5, size: 'small' });
  b.crystals({ x: x + 2.6, n: D - 3.3, r: 0.6, size: 'small' });
  b.crystals({ x: x + 6.8, n: D - 3.4, r: 0.5, size: 'small' });
  // the Weaver's anchor (25.6, D − 3.6) and the foot of the north wall toward it
  b.crystals({ x: 22.6, n: nFace(), h: 1.2, r: 0.8, size: 'medium', onWall: true, yawDeg: 180 });
  b.crystals({ x: 23.4, n: D - 1.1, r: 1.0, size: 'medium' });
}

// ---------------------------------------------------------------------------------------------------------------------
// The court's fine gold rings and the upper hall's haze
// ---------------------------------------------------------------------------------------------------------------------

function buildFloorAndAir(b: ZoneBuilder): void {
  // concentric fine gold rings round the court (inlaid, reflective, never glowing)
  b.inlay({ x: COURT.x, n: COURT.n, h: 0.003, kind: 'rose', r: 7.4, count: 5, points: 8, inner: 0.2, width: 0.055 });
  // daylight haze under the glass band: the upper hall reads bright, the floor stays clear
  b.haze({ x: W / 2, n: D / 2, h: 5, w: W - 1, d: D - 1, height: 16, density: 0.045, falloff: -0.8, intensity: 1.15, color: 0xf6eee2 });
}
