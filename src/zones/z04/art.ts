/**
 * Z04 — art direction (polish 4), toward `ref-concept-relay-route`: the paired gold pipes with brackets and
 * junction boxes on the walls and the colonnade, the navy Reformation crates with lit panels stacked by the
 * King-era plinths, tall lit slots in the great ring round the exit, and the warm sunlit haze of the upper hall.
 *
 * Everything here is collider-free dressing: the walkable footprint (colliders, surfaces, nav) is untouched. The
 * crates are props built with `collider: false`; they stand ON the 2.2 m plinths (above the cover line, so they never
 * read as cover that is not there) or flush against a plinth's flank on the side away from the fight, where they
 * only lengthen the plinth's own silhouette. Their segmented light panels merge into one draw call (`addStatic`).
 */
import * as THREE from 'three';
import type { ZoneBuilder } from '@/core/api';
import { FACE } from '../shared';
import { COL_N, COL_R, COL_X, D, DECK, DECK_H, EXIT_X, W, WALL_H } from './layout';

/** x of the paired gold pipe runs on the long walls: between the rib legs, clear of the doors */
export const PIPE_X = [3.6, 14.5, 25.6, 36.4, 47.5, 58.4] as const;
/** n of the pipe pairs on the west wall, between the column bays */
const WEST_PIPE_N = [9.5, 17.5, 25.5, 33.5] as const;
/** the pipes: radius and centre spacing (the painting's pairs read at 40 m) */
const PIPE_R = 0.11;
const PIPE_GAP = 0.4;
/** wall face (the walls are 0.6 m thick, centred on their line) */
const FACE_OFF = 0.3;

/** Reformation panel light: a cold cyan-white */
const PANEL = 0x9fdcff;

/**
 * One paired run: from a junction box at knee height straight up the face, a jog part-way up (the painting's
 * pipes step round the stone courses), then on up to the top. `dx` is the jog across the face (plan x or n).
 */
function pipeRun(b: ZoneBuilder, at: (along: number) => [number, number], along: number, h0: number, facing: number, jog: number): void {
  const top = WALL_H - 1.2;
  const j0 = 11 + (Math.abs(along * 7.3) % 3);
  const p = (a: number, h: number): [number, number, number] => {
    const [x, n] = at(a);
    return [x, n, h];
  };
  b.pipes([p(along, h0 + 0.55), p(along, j0), p(along + jog, j0 + Math.abs(jog)), p(along + jog, top)], {
    facing, r: PIPE_R, spacing: PIPE_GAP, bracket: 4.2, boxes: [0],
  });
}

/** the paired gold pipes on the three stone walls and up the room face of every colonnade column */
export function buildPipes(b: ZoneBuilder): void {
  // the long walls, between the rib legs (on the deck where it backs onto the north wall)
  PIPE_X.forEach((x, i) => {
    const jog = i % 2 === 0 ? 0.9 : -0.9;
    pipeRun(b, (a) => [a, FACE_OFF], x, 0, FACE.north, jog);
    if (Math.abs(x - EXIT_X) < 9) return;
    pipeRun(b, (a) => [a, D - FACE_OFF], x, x > DECK.x0 ? DECK_H : 0, FACE.south, -jog);
  });
  // either side of the great ring: straight up, framing the far door
  for (const x of [EXIT_X - 7.4, EXIT_X + 7.4]) {
    b.pipes([[x, D - FACE_OFF, 0.55], [x, D - FACE_OFF, WALL_H - 1.2]], { facing: FACE.south, r: 0.13, spacing: 0.46, bracket: 4.2, boxes: [0] });
  }
  // the west wall behind the colonnade, between the column bays
  WEST_PIPE_N.forEach((n, i) => pipeRun(b, (a) => [FACE_OFF, a], n, 0, FACE.east, i % 2 === 0 ? 0.8 : -0.8));
  // the colonnade: straight paired pipes up each column's room face, a junction box at the foot
  for (const n of COL_N) {
    b.pipes([[COL_X + COL_R - 0.06, n, 0.55], [COL_X + COL_R - 0.06, n, WALL_H - 1.2]], { facing: FACE.east, r: 0.12, spacing: 0.84, bracket: 4.0, boxes: [0] });
  }
}

/** crate placements: [x, n, h, yawDeg, variant, scale] — h 2.2 = on top of a high plinth */
const CRATES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  // on the plinths (above the cover line)
  [12.1, 20.8, 2.2, 8, 0, 1.15],
  [25.0, 15.7, 2.2, -6, 2, 1.1],
  [44.9, 21.2, 2.2, 14, 0, 1.15],
  // flush against the plinths' flanks, away from the fight (the plinth is the cover; these only lengthen it)
  [10.5, 20.9, 0, 270, 1, 1.2],
  [23.5, 15.9, 0, 270, 1, 1.2],
  [42.5, 21.3, 0, 270, 1, 1.15],
  [49.5, 9.2, 0, 90, 1, 1.2],
  // against the south wall, by the Reformation kit dropped at the entry
  [20.4, 0.95, 0, 0, 1, 1.2],
  [38.6, 0.95, 0, 0, 2, 1.15],
];

/**
 * The navy crates with lit panels. Each gets a segmented light panel on its front (the painting's stacked cyan
 * cells) on top of the kit crate's own thin strips; all panels are one merged mesh.
 */
export function buildCrates(b: ZoneBuilder): void {
  const panels = new THREE.Group();
  panels.name = 'z04-crate-panels';
  const cell = b.mats.emissive(PANEL, 2.2);
  const bezel = b.mats.get('refSlate');
  const cellGeo = new THREE.BoxGeometry(0.085, 0.07, 0.012);
  const bezelGeo = new THREE.BoxGeometry(0.13, 1, 0.012);
  for (const [x, n, h, yawDeg, variant, scale] of CRATES) {
    b.prop('refCrate', { x, n, h, yawDeg, variant, scale, collider: false });
    // the panel on the front (local −Z) of the lower crate, and of the upper one in a stack, beside the kit crate's
    // own label plate (the crate's face is 1.1 × 0.8 at scale 1; its slate panel stands 1 cm proud of it)
    const g = new THREE.Group();
    g.position.copy(b.P(x, n, h));
    g.rotation.y = b.yaw(yawDeg);
    g.scale.setScalar(scale);
    const tiers = variant === 1 ? [0, 0.8] : [0];
    for (const y0 of tiers) {
      const bz = new THREE.Mesh(bezelGeo, bezel);
      bz.scale.y = 0.56;
      bz.position.set(-0.43, y0 + 0.4, -0.418);
      g.add(bz);
      const cells = 5;
      for (let k = 0; k < cells; k++) {
        const c = new THREE.Mesh(cellGeo, cell);
        c.position.set(-0.43, y0 + 0.19 + k * 0.105, -0.426);
        g.add(c);
      }
    }
    panels.add(g);
  }
  b.addStatic(panels);
}

/**
 * Tall lit slots inside the great ring round the exit (the painting's lit seams in its circular gold door), and
 * daylight slots high on the south wall between the pipe pairs.
 */
export function buildSlots(b: ZoneBuilder): void {
  for (const dx of [-2.75, 2.75]) {
    b.slot({ x: EXIT_X + dx, n: D - FACE_OFF, h: 2.3, yawDeg: FACE.south, width: 0.3, height: 7.0, intensity: 1.25, depth: 0.22 });
  }
  for (const x of [9, 20, 42, 53]) {
    // above the ribs' legs on the south wall: tall daylight windows high up the hall
    b.slot({ x: x + 2.6, n: FACE_OFF, h: 9.5, yawDeg: FACE.north, width: 1.2, height: 8.5, mullions: 2, intensity: 1.5, depth: 0.3 });
  }
}

/** Warm sunlit haze: the upper hall, and a bright band along the east glass where the sun comes in. */
export function buildHaze(b: ZoneBuilder): void {
  b.haze({ x: W / 2, n: D / 2, h: 6, w: W, d: D, height: WALL_H - 6, density: 0.016, falloff: -0.7, color: 0xffeedb, intensity: 1.0 });
  b.haze({ x: W - 5, n: D / 2, h: 0, w: 10, d: D, height: WALL_H, density: 0.03, falloff: -0.3, color: 0xffe7c8, intensity: 1.05, soft: 0.35 });
}
