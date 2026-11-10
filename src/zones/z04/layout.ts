/**
 * Z04 — every layout number, in PLAN coordinates (origin at the south-west corner, x east, n north, h up), taken
 * from the tactical drawing `pdf/ref-z04-tactical-plan.png` (metre grid).
 *
 *   entry (from Z03) south wall x 31 · exit (to Z05) north wall x 31, the white point above it
 *   HIGH ROUTE  +3 m deck x 44…61.6, n 23…38, reached by the south ramp (x 51…57, n 11 → 23, 3 m over 12 m);
 *               the west ramp (x 32 ← 44, n 27…33) returns to the floor; the O2 pocket (x 34…44, n 34…38) is off
 *               the deck's north-west corner, its replay faces south
 *   LOW ROUTE   the covered floor between the cover islands, close to receiver A
 *   LEFT        the service path behind the west colonnade (x 0.5…4.9), out of the scan head's arc; it emerges in
 *               the north-west corner, beside the west end of the Enforcers' shield angle, near the exit
 *   receivers   A (35, 18) and B (16, 27) · scan head S (8, 11) sweeping north-east
 *   sightlines  deck (51, 28) → B: 35 m · south-east floor (44, 5) → S: 36 m
 */

/** playable envelope (plan §Z04: 62 × 38 m) */
export const W = 62;
export const D = 38;
/** wall height and rib apex: the colonnade and ribs carry the eye far above the fight */
export const WALL_H = 13;
export const RIB_H = 21;
/** entry (south wall) and exit (north wall) door centres */
export const ENTRY_X = 31;
export const EXIT_X = 31;
export const DOOR_W = 3;
export const DOOR_H = 3.5;

/** the high route */
export const DECK_H = 3;
export const DECK = { x0: 44, x1: 61.6, n0: 23, n1: 38 } as const;
/** south ramp: rises north from n 11 to the deck edge at n 23 */
export const RAMP_S = { x: 54, n: 17, w: 6, d: 12 } as const;
/** west ramp: rises east from x 32 (floor) to the deck edge at x 44 */
export const RAMP_W = { x: 38, n: 30, w: 6, d: 12 } as const;
/** the O2 pocket: elevated, off the deck's north-west corner */
export const POCKET = { x0: 34, x1: 44, n0: 34, n1: 38 } as const;

/** the west colonnade the service path runs behind (column centres along x = COL_X) */
export const COL_X = 6.2;
export const COL_N = [5.5, 13.5, 21.5, 29.5] as const;
export const COL_R = 1.3;
export const SCREEN_H = 2.4;

/** ribs across the hall (span north–south); the central bay frames the entry → exit axis */
export const RIB_X = [9, 20, 42, 53] as const;

/** devices */
export const RX_A: readonly [number, number] = [35, 18];
export const RX_B: readonly [number, number] = [16, 27];
export const SCAN_S: readonly [number, number] = [8, 11];
/** the scan head's sweep: centre bearing (plan degrees), arc, range, seconds per sweep */
export const SCAN_YAW = 45;
export const SCAN_ARC = 70;
export const SCAN_RANGE = 27;
export const SCAN_PERIOD = 7;
/** a Z03 detection "accelerates the local scanner pattern" */
export const SCAN_FAST = 1.6;
/** relay network name shared by the receivers and the contaminated drones */
export const NET = 'z04';

/** E2: four Enforcers + two contaminated drones, never more than six alive (plan) */
export const E2_CAP = 6;
/** the shield angle: four line slots across the approach to the exit, angled toward receiver B */
export const ENFORCER_POSTS: ReadonlyArray<readonly [number, number, number]> = [
  [19.0, 32.0, 205], [21.9, 33.1, 195], [24.9, 33.6, 185], [27.9, 33.4, 175],
];
/** how close the lead may come to an unseen Enforcer / drone before it notices her (horizontal metres) */
export const NOTICE_ENFORCER = 9;
export const NOTICE_DRONE = 6.5;
/** close-interaction disable of a receiver (seconds held) */
export const RX_HOLD = 1.4;
