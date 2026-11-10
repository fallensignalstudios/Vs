/**
 * Z05 · Meeting atrium — layout numbers and the marker table (plan coordinates, origin at the south-west corner).
 *
 * THE SPACE. A Ø72 m surviving platform floats in the ~300 m scenic atrium (`sky.scenic.atriumShell`, whose
 * own void falls away all round it at r = 60). An 18 m local shaft opens in the platform's centre; a short
 * walkway on its west lip leads to the lift plate in the middle of it — the way below, to Crownmark Five.
 * Four 6 m bridges leave the rim on the cardinals (the shell keeps its own spans off them): SOUTH to the gate
 * Selene's people come through, NORTH to the Dominion gate, EAST broken off over the void, WEST down a ramp to
 * the lower corridor the screams come from (the exit, to Z06). The control ring stands west-south-west.
 * The meeting and the duel happen on the west side of the shaft, between the two groups' lines of approach.
 *
 * Everything is placed as an offset (dx east, dn north) from the platform centre C.
 */

/** platform centre (plan) */
export const CX = 64;
export const CN = 64;
/** platform outer radius (plan: Ø72) and the local shaft opening (plan: Ø18) */
export const R_PLAT = 36;
export const R_SHAFT = 9;
/** the shaft parapet (1.1 m) stands just outside the opening */
export const R_PARAPET = 9.45;
/** the scenic atrium's own void begins here: bridges end at the shell's ring floor */
export const R_VOID = 60;
/** bridge clear width (plan: 6 m bridges) */
export const BRIDGE_W = 6;
/** the exit: the west bridge runs level to R_RAMP0, then descends EXIT_DROP over the ramp to the landing */
export const R_RAMP0 = 41;
export const R_RAMP1 = 56;
export const EXIT_DROP = 4;
/** lift plate in the shaft (the way below) and its walkway from the west lip */
export const R_LIFT = 4;
/** the control ring: offset from C and the bearing its open side (the gap) faces */
export const RING: readonly [number, number] = [-18, -18.5];
export const RING_FACE = 44;

/** plan position of an offset from C */
export function at(dx: number, dn: number): [number, number] {
  return [CX + dx, CN + dn];
}

/** plan position at radius r on a compass bearing (0 = north, 90 = east) from C */
export function pol(r: number, bearingDeg: number): [number, number] {
  const a = (bearingDeg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CN + r * Math.cos(a)];
}

/** offset of a point `d` metres from (dx, dn) along a compass bearing */
export function step(dx: number, dn: number, d: number, bearingDeg: number): [number, number] {
  const a = (bearingDeg * Math.PI) / 180;
  return [dx + d * Math.sin(a), dn + d * Math.cos(a)];
}

/** compass bearing (degrees) from one offset to another */
export function bearing(from: readonly [number, number], to: readonly [number, number]): number {
  return (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
}

/**
 * Every marker the scripts touch: name → [dx, dn, h, yawDeg] as offsets from C. Groups face each other along
 * the meeting line x = −14 (Selene's people south, Tarrik's north); the duel points D* are the choreography.
 */
export const MARKS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  // --- entry: Selene's people come off the south bridge ---
  start: [0, -50, 0, 0],
  tharneStart: [-1.7, -52.6, 0, 0],
  lyricStart: [1.6, -53.2, 0, 0],
  // the groups stop ≈ 20 m apart; the leaders close to ≈ 10 m
  seleneStop: [-14, -10, 0, 0],
  tharneStop: [-16.4, -12.6, 0, 10],
  lyricStop: [-11.6, -12.9, 0, 350],
  lyricOut: [-12.4, -8.2, 0, 350],
  seleneMeet: [-14, -5, 0, 0],
  // --- the Dominion side comes in off the north bridge ---
  lyessaIn: [-1.5, 33.5, 0, 200],
  sol1In: [-3.2, 36.4, 0, 200],
  sol2In: [2, 37.2, 0, 200],
  sol3In: [-0.6, 39.6, 0, 200],
  tarrikIn: [-7.2, 19.4, 0, 210],
  lyessaStop: [-11.4, 11.6, 0, 185],
  tarrikStop: [-14, 10, 0, 180],
  sol1Stop: [-17.2, 12.8, 0, 170],
  sol2Stop: [-9.6, 14.2, 0, 190],
  sol3Stop: [-15, 15.6, 0, 180],
  tarrikMeet: [-14, 5, 0, 180],
  // --- the duel (see z05/duel.ts) ---
  dSelBlock: [-11.4, 0.9, 0, 330],
  dTarAdvance: [-13, 3.6, 0, 150],
  dTarLunge: [-12.2, 2.3, 0, 150],
  dSelShoved: [-10.9, 0.0, 0, 330],
  dSelStrike: [-11.7, 1.3, 0, 330],
  dSelLanes: [-14.4, 0.4, 0, 40],
  dSelFeint: [-13.6, 1.3, 0, 40],
  dTarGives: [-11.3, 3.7, 0, 230],
  dSelDodged: [-16.4, 0.1, 0, 60],
  dSelFlown: [-12.9, 2.5, 0, 60],
  dSelThrown: [-19.2, -1.9, 0, 60],
  dTarLock: [-14.7, 0.5, 0, 240],
  dSelLock: [-16.0, -0.3, 0, 60],
  // --- the carrier: Tharne across the chamber (the ring's own markers are built from RING in space.ts) ---
  tharneFar: [9.5, -21, 0, 300],
  lyricFar: [-9.4, -14.5, 0, 20],
  // --- the exit: the west ramp down to the lower corridor ---
  exit: [-58.2, 0, -EXIT_DROP, 270],
  screams: [-63.5, 0, -EXIT_DROP + 1.2, 270],
  shaftLook: [-4, 0, -0.5, 90],
  liftGate: [-9.9, 0, 0, 90],
};
