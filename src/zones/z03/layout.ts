/**
 * Z03 — every layout number the build, the scanner and the beats depend on (plan coordinates: origin at the
 * south-west corner of the playable floor, x east, n north, h up).
 *
 *   x −15 … 0   the west bay: the Reformation dropship lodged nose-first among broken ribs (visual only)
 *   x 0 … 6     arrival pocket at the dropship's rear hatch, framed by the small frozen rib it wedged into
 *   x 8 … 31    the scanned corridor: plane A sweeps the lower floor x 8 ↔ 20, plane B the full width x 19 ↔ 31
 *   south strip the upper service path (+3 m): ramp up x 6 → 18, deck x 18 → 36, ramp down x 36 → 46;
 *               the scan projector stands on the deck at x 33.6 — the angle the path offers
 *   x 33 … 48   the deployed Reformation sensor installation: terminal, reconstruction hologram, exit east
 */

/** playable envelope (plan §Z03: 48 × 22 m) */
export const W = 48;
export const D = 22;
/** wall height and the enclosed vault's rise above it */
export const WALL_H = 9;
export const VAULT_RISE = 4.4;
/** the west bay the dropship came through (visual only; its floor is not walkable beyond the hull's rear) */
export const BAY_X0 = -15;

/** the dropship: its torn rear (where the hatch hinges) and centre line; built nose −Z, rotated to face west */
export const WRECK_REAR_X = 0.7;
export const WRECK_N = 12;
/** the rear hatch: hinge height, width (n), length of the lowered ramp plate, and its open slope (deg) */
export const HATCH_HINGE_H = 0.55;
export const HATCH_W = 3.1;
export const HATCH_LEN = 2.5;
export const HATCH_OPEN_DEG = 12.5;
/** the small frozen rib the hull wedged into (its legs frame the hatch) */
export const LODGE_RIB_X = 3.7;
export const LODGE_RIB_SPAN = 7.2;
/** the corridor's full ribs (legs in the long walls), vault bays line up with them */
export const RIB_X0 = 10;
export const RIB_SPACING = 8;
export const RIB_COUNT = 5;
export const RIB_H = 13.2;

/** upper service path along the south wall */
export const DECK_H = 3;
export const DECK_N0 = 0;
export const DECK_N1 = 4.4;
export const RAMP_UP_X0 = 6;
export const DECK_X0 = 18;
export const DECK_X1 = 36;
export const RAMP_DN_X1 = 46;

/** a moving scan plane: travel line (x0 → x1 at n), slab width across the corridor, height, timing */
export interface PlaneSpec {
  id: string;
  x0: number; x1: number; n: number;
  width: number; height: number;
  /** seconds for a full back-and-forth; phase 0…1 offsets the two planes */
  period: number; phase: number;
}
/** plane A: the lower floor only (the ramp and deck are outside its slab) */
export const PLANE_A: PlaneSpec = { id: 'z03-planeA', x0: 8, x1: 20, n: 13.25, width: 17.3, height: 3.4, period: 10, phase: 0 };
/** plane B: the full width and tall enough to sweep the service deck too */
export const PLANE_B: PlaneSpec = { id: 'z03-planeB', x0: 31, x1: 19, n: 11, width: 22, height: 6.9, period: 12.5, phase: 0.42 };
/** first detection: the local pattern accelerates (plan) */
export const DETECTED_RATE = 1.6;

/** the scan projector (one physical source drives both planes) on the service deck, looking back west */
export const SOURCE_X = 33.6;
export const SOURCE_N = 2.5;
/** the lens of the scanHead figure above its foot (the planes' `source`, the trace's end) */
export const SOURCE_LENS = 1.72;
/** where a hand-disable is done from (north-west of the mast, on the deck path) */
export const SOURCE_STAND: [number, number] = [32.5, 3.55];
/** trace: within this range and in clear sight from the service path / ramps (any height ≥ 1.2 m) … */
export const TRACE_RANGE_HIGH = 30;
/** … or this close on the lower floor */
export const TRACE_RANGE_LOW = 14;

/** the scan beat ends once the lead is past plane B (east of this x) */
export const PAST_X = 33.4;
/** assisted hint: Tharne identifies the source after this long without progress (or after the first detection) */
export const HINT_DELAY = 25;
/** "progress" = the lead's best x improving by this much */
export const PROGRESS_STEP = 3;

/** the deployed terminal (Reformation console, reconstruction hologram) and the exit */
export const TERMINAL: [number, number] = [42.6, 15.6];
export const HOLO: [number, number] = [43.3, 12.7];
export const EXIT_N = 7;
