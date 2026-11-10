/**
 * Collision blockouts of three plan zones, expressed purely as surfaces + solids. They are the fixtures for the
 * physics/nav unit tests and the sandbox, and double as a worked example of how a zone maps onto the contract.
 *
 * Plan coordinates (x east, n north, origin at the south-west corner) map to world (x, h, −n).
 *   Z04 Relay overlook      62 × 38, +3 m east balcony, 12 m south ramp, west down-ramp, exit gap north
 *   Z08 Quarantine crucible 70 × 48, 18 × 14 court, two loops, +3 m east balcony with two 6 × 10 ramps
 *   Z05 Meeting atrium      Ø72 platform, Ø18 shaft, 6 m bridges
 */
import type { ColliderDesc, ColliderHandle, PhysicsWorld, SurfaceHandle, Vec3Like } from '@/core/api';

const HALF_PI = Math.PI / 2;

/** plan → world position */
export const planPos = (x: number, n: number, h = 0): Vec3Like => ({ x, y: h, z: -n });

/** Flat walkable rect over plan x0..x1 × n0..n1 at height h. */
export function fxFloor(w: PhysicsWorld, x0: number, n0: number, x1: number, n1: number, h = 0, tag?: string): SurfaceHandle {
  return w.addSurface({
    shape: { kind: 'rect', hx: (x1 - x0) / 2, hz: (n1 - n0) / 2 },
    x: (x0 + x1) / 2, z: -(n0 + n1) / 2, y: h, tag,
  });
}

/** Axis-aligned solid over plan x0..x1 × n0..n1, from y0 to y1. */
export function fxBox(
  w: PhysicsWorld, x0: number, n0: number, x1: number, n1: number, y0: number, y1: number,
  extra: Partial<ColliderDesc> = {},
): ColliderHandle {
  return w.addCollider({
    shape: { kind: 'box', hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (n1 - n0) / 2 },
    x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: -(n0 + n1) / 2, ...extra,
  });
}

/** Vertical cylinder solid at plan (x, n). */
export function fxCyl(w: PhysicsWorld, x: number, n: number, r: number, y0: number, y1: number, extra: Partial<ColliderDesc> = {}): ColliderHandle {
  return w.addCollider({ shape: { kind: 'cyl', r, hy: (y1 - y0) / 2 }, x, y: (y0 + y1) / 2, z: -n, ...extra });
}

/**
 * Ramp over plan x0..x1 × n0..n1. `axis` 'n': height hA at the south edge → hB at the north edge;
 * 'x': hA at the west edge → hB at the east edge. Also adds stepped solids under the tall part so nobody walks
 * through the ramp body from the floor below.
 */
export function fxRamp(
  w: PhysicsWorld, x0: number, n0: number, x1: number, n1: number, hA: number, hB: number, axis: 'n' | 'x', base = 0,
): SurfaceHandle {
  const surface = axis === 'n'
    ? w.addSurface({ shape: { kind: 'rect', hx: (x1 - x0) / 2, hz: (n1 - n0) / 2 }, x: (x0 + x1) / 2, z: -(n0 + n1) / 2, y: hB, y1: hA, tag: 'ramp' })
    : w.addSurface({ shape: { kind: 'rect', hx: (n1 - n0) / 2, hz: (x1 - x0) / 2 }, x: (x0 + x1) / 2, z: -(n0 + n1) / 2, yaw: HALF_PI, y: hA, y1: hB, tag: 'ramp' });
  const len = axis === 'n' ? n1 - n0 : x1 - x0;
  const steps = Math.max(2, Math.round(len / 2));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const top = Math.min(hA + (hB - hA) * t0, hA + (hB - hA) * t1);
    if (top - base < 0.3) continue;
    if (axis === 'n') fxBox(w, x0, n0 + len * t0, x1, n0 + len * t1, base, top, { tag: 'ramp-fill' });
    else fxBox(w, x0 + len * t0, n0, x0 + len * t1, n1, base, top, { tag: 'ramp-fill' });
  }
  return surface;
}

/** Raised deck: walkable top + 0.4 m slab solid beneath it. */
export function fxDeck(w: PhysicsWorld, x0: number, n0: number, x1: number, n1: number, h: number, tag = 'deck'): SurfaceHandle {
  fxBox(w, x0, n0, x1, n1, h - 0.4, h, { tag: `${tag}-slab` });
  return fxFloor(w, x0, n0, x1, n1, h, tag);
}

/** Perimeter wall segment (0.6 m thick, centred on the line). */
function fxWall(w: PhysicsWorld, xa: number, na: number, xb: number, nb: number, height = 6, thick = 0.6, tag = 'wall'): ColliderHandle {
  const t = thick / 2;
  return fxBox(w, Math.min(xa, xb) - t, Math.min(na, nb) - t, Math.max(xa, xb) + t, Math.max(na, nb) + t, 0, height, { tag });
}

/** see-through, shoot-through guard rail (blocks movement only) */
function fxRail(w: PhysicsWorld, xa: number, na: number, xb: number, nb: number, h: number): ColliderHandle {
  return fxBox(w, Math.min(xa, xb) - 0.05, Math.min(na, nb) - 0.05, Math.max(xa, xb) + 0.05, Math.max(na, nb) + 0.05, h, h + 1.1, {
    blocksSight: false, blocksShots: false, tag: 'rail',
  });
}

const cover = (w: PhysicsWorld, kind: 'low' | 'high', x0: number, n0: number, x1: number, n1: number, base = 0): ColliderHandle =>
  fxBox(w, x0, n0, x1, n1, base, base + (kind === 'low' ? 1.2 : 2.2), { cover: kind, tag: `cover-${kind}` });

// ---------------------------------------------------------------------------------------------------------
// Z04 — Relay overlook
// ---------------------------------------------------------------------------------------------------------
export interface Z04Fixture {
  /** north exit door (closed = enabled) */
  door: ColliderHandle;
  lowCover: ColliderHandle[];
  highCover: ColliderHandle[];
  receiverA: ColliderHandle;
  receiverB: ColliderHandle;
  scanHead: ColliderHandle;
  balcony: SurfaceHandle;
  southRamp: SurfaceHandle;
  westRamp: SurfaceHandle;
  /** named world positions */
  marks: {
    entry: Vec3Like; floorMid: Vec3Like; rampFoot: Vec3Like; rampTop: Vec3Like; balcony: Vec3Like;
    underBalcony: Vec3Like; pocket: Vec3Like; westRampFoot: Vec3Like; exitInside: Vec3Like; exitOutside: Vec3Like;
    receiverA: Vec3Like; receiverB: Vec3Like; overlook: Vec3Like;
  };
}

export function buildZ04(w: PhysicsWorld, opts: { rails?: boolean } = {}): Z04Fixture {
  // floors: main hall, entry stub (from Z03), exit stub (to Z05)
  fxFloor(w, 0, 0, 62, 38, 0, 'floor');
  fxFloor(w, 28, -6, 34, 0, 0, 'entry');
  fxFloor(w, 28, 38, 34, 44, 0, 'exit');

  // perimeter with a 6 m gap south (28..34) and north (28..34)
  fxWall(w, 0, 0, 28, 0); fxWall(w, 34, 0, 62, 0);
  fxWall(w, 0, 38, 28, 38); fxWall(w, 34, 38, 62, 38);
  fxWall(w, 0, 0, 0, 38); fxWall(w, 62, 0, 62, 38);
  fxWall(w, 28, -6, 28, 0); fxWall(w, 34, -6, 34, 0); fxWall(w, 28, -6, 34, -6);
  fxWall(w, 28, 38, 28, 44); fxWall(w, 34, 38, 34, 44); fxWall(w, 28, 44, 34, 44);
  const door = fxBox(w, 28, 37.8, 34, 38.2, 0, 3.5, { tag: 'door' });

  // high route: +3 m balcony, 12 m south ramp, west down-ramp, optional pocket
  const balcony = fxDeck(w, 44, 23, 58, 34, 3, 'balcony');
  fxDeck(w, 33, 34, 46, 38, 3, 'pocket');
  const southRamp = fxRamp(w, 51, 11, 57, 23, 0, 3, 'n');
  const westRamp = fxRamp(w, 32, 27, 44, 33, 0, 3, 'x');
  for (const [x, n] of [[45, 24], [57, 24], [45, 33], [57, 33]] as const) fxCyl(w, x, n, 0.4, 0, 2.6, { tag: 'support' });
  if (opts.rails !== false) {
    fxRail(w, 44, 23, 51, 23, 3); fxRail(w, 57, 23, 58, 23, 3);
    fxRail(w, 44, 23, 44, 27, 3); fxRail(w, 44, 33, 44, 34, 3);
    fxRail(w, 58, 23, 58, 34, 3); fxRail(w, 46, 34, 58, 34, 3);
    fxRail(w, 33, 34, 44, 34, 3); fxRail(w, 33, 34, 33, 38, 3);
  }

  // cover islands (light = 1.2 m low, dark = 2.2 m high)
  const lowCover = [
    cover(w, 'low', 14, 33, 17, 35), cover(w, 'low', 25, 25, 28, 28), cover(w, 'low', 29, 6, 32, 9),
    cover(w, 'low', 38, 9, 41, 12), cover(w, 'low', 50, 25, 53, 27, 3),
  ];
  const highCover = [
    cover(w, 'high', 11, 19, 14, 22), cover(w, 'high', 24, 14, 27, 17),
    cover(w, 'high', 43, 20, 46, 23), cover(w, 'high', 46, 8, 49, 11),
  ];

  // relay receivers + fixed scan head (physical devices)
  const receiverA = fxCyl(w, 35, 18, 0.7, 0, 2.4, { tag: 'receiverA' });
  const receiverB = fxCyl(w, 16, 27, 0.7, 0, 2.4, { tag: 'receiverB' });
  const scanHead = fxCyl(w, 8, 11, 0.5, 0, 2.8, { tag: 'scanHead' });

  return {
    door, lowCover, highCover, receiverA, receiverB, scanHead, balcony, southRamp, westRamp,
    marks: {
      entry: planPos(31, -3), floorMid: planPos(31, 4), rampFoot: planPos(54, 9), rampTop: planPos(54, 24, 3),
      balcony: planPos(51, 30, 3), underBalcony: planPos(51, 30, 0), pocket: planPos(38, 36, 3),
      westRampFoot: planPos(30, 30), exitInside: planPos(31, 35), exitOutside: planPos(31, 41),
      receiverA: planPos(35, 18, 1.4), receiverB: planPos(16, 27, 1.4), overlook: planPos(51, 28, 3),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Z08 — Quarantine crucible
// ---------------------------------------------------------------------------------------------------------
export interface Z08Fixture {
  /** isolation barriers closing the four court openings (disabled = court open) */
  courtBarriers: ColliderHandle[];
  doorW: ColliderHandle;
  doorE: ColliderHandle;
  exitDoor: ColliderHandle;
  balcony: SurfaceHandle;
  /** court rect in world XZ */
  court: { minX: number; maxX: number; minZ: number; maxZ: number };
  marks: {
    entry: Vec3Like; staging: Vec3Like; courtMid: Vec3Like; northOfCourt: Vec3Like; westLoop: Vec3Like;
    eastLoop: Vec3Like; balcony: Vec3Like; underBalcony: Vec3Like; roomW: Vec3Like; roomE: Vec3Like;
    exitInside: Vec3Like; exitOutside: Vec3Like;
  };
}

export function buildZ08(w: PhysicsWorld): Z08Fixture {
  fxFloor(w, 0, 0, 70, 48, 0, 'floor');
  fxFloor(w, 32, -6, 38, 0, 0, 'entry');
  fxFloor(w, 32, 48, 38, 54, 0, 'exit');

  fxWall(w, 0, 0, 32, 0); fxWall(w, 38, 0, 70, 0);
  fxWall(w, 0, 48, 32, 48); fxWall(w, 38, 48, 70, 48);
  fxWall(w, 0, 0, 0, 48); fxWall(w, 70, 0, 70, 48);
  fxWall(w, 32, -6, 32, 0); fxWall(w, 38, -6, 38, 0); fxWall(w, 32, -6, 38, -6);
  fxWall(w, 32, 48, 32, 54); fxWall(w, 38, 48, 38, 54); fxWall(w, 32, 54, 38, 54);
  const exitDoor = fxBox(w, 32, 47.8, 38, 48.2, 0, 4.5, { tag: 'door' });

  // 18 × 14 elite court: 1 m kerb with a 6 m opening in each side, closable by isolation barriers
  const kerb = (x0: number, n0: number, x1: number, n1: number): ColliderHandle =>
    fxBox(w, x0, n0, x1, n1, 0, 1.0, { tag: 'kerb', blocksSight: false });
  kerb(26, 16.8, 32, 17.2); kerb(38, 16.8, 44, 17.2);
  kerb(26, 30.8, 32, 31.2); kerb(38, 30.8, 44, 31.2);
  kerb(25.8, 17, 26.2, 21); kerb(25.8, 27, 26.2, 31);
  kerb(43.8, 17, 44.2, 21); kerb(43.8, 27, 44.2, 31);
  const barrier = (x0: number, n0: number, x1: number, n1: number): ColliderHandle => {
    const b = fxBox(w, x0, n0, x1, n1, 0, 3, { tag: 'isolation', blocksSight: false });
    b.enabled = false;
    return b;
  };
  const courtBarriers = [
    barrier(32, 16.85, 38, 17.15), barrier(32, 30.85, 38, 31.15),
    barrier(25.85, 21, 26.15, 27), barrier(43.85, 21, 44.15, 27),
  ];

  // east balcony +3 with two 6 × 10 ramps
  const balcony = fxDeck(w, 54, 16, 63, 30, 3, 'balcony');
  fxRamp(w, 54, 6, 60, 16, 0, 3, 'n');
  fxRamp(w, 54, 30, 60, 40, 3, 0, 'n');
  for (const [x, n] of [[55, 17], [62, 17], [55, 29], [62, 29]] as const) fxCyl(w, x, n, 0.4, 0, 2.6, { tag: 'support' });

  // survivor rooms W / E with a closed door each (S-W, S-E)
  const room = (x0: number, n0: number, x1: number, n1: number, dx0: number, dx1: number): ColliderHandle => {
    fxWall(w, x0, n1, x1, n1, 4, 0.4); fxWall(w, x0, n0, x0, n1, 4, 0.4); fxWall(w, x1, n0, x1, n1, 4, 0.4);
    fxWall(w, x0, n0, dx0, n0, 4, 0.4); fxWall(w, dx1, n0, x1, n0, 4, 0.4);
    return fxBox(w, dx0, n0 - 0.15, dx1, n0 + 0.15, 0, 3.5, { tag: 'door' });
  };
  const doorW = room(3, 35, 15, 45, 6, 11);
  const doorE = room(62, 35, 69, 45, 63, 68);

  cover(w, 'low', 17, 36, 20, 39); cover(w, 'low', 41, 37, 44, 40); cover(w, 'low', 46, 27, 49, 30);
  cover(w, 'low', 18, 13, 21, 16); cover(w, 'low', 39, 10, 42, 13); cover(w, 'low', 6, 7, 9, 10);
  cover(w, 'high', 30, 36, 33, 38); cover(w, 'high', 18, 26, 21, 29);
  cover(w, 'high', 8, 19, 11, 22); cover(w, 'high', 46, 13, 49, 16);

  return {
    courtBarriers, doorW, doorE, exitDoor, balcony,
    court: { minX: 26, maxX: 44, minZ: -31, maxZ: -17 },
    marks: {
      entry: planPos(35, -3), staging: planPos(35, 5), courtMid: planPos(35, 24), northOfCourt: planPos(35, 43),
      westLoop: planPos(23, 24), eastLoop: planPos(51, 24), balcony: planPos(58.5, 23, 3),
      underBalcony: planPos(58.5, 23, 0), roomW: planPos(9, 40), roomE: planPos(65.5, 40),
      exitInside: planPos(35, 46), exitOutside: planPos(35, 51),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Z05 — Meeting atrium (origin at the platform centre)
// ---------------------------------------------------------------------------------------------------------
export interface Z05Fixture {
  platform: SurfaceHandle;
  shaftBridge: SurfaceHandle;
  marks: {
    southApproach: Vec3Like; southRim: Vec3Like; northRim: Vec3Like; northApproach: Vec3Like;
    ringEast: Vec3Like; ringWest: Vec3Like; brokenSpanEnd: Vec3Like; shaftCentre: Vec3Like;
  };
  shaftRadius: number;
  platformRadius: number;
}

export function buildZ05(w: PhysicsWorld): Z05Fixture {
  // Ø72 platform with the Ø18 shaft opening
  const platform = w.addSurface({ shape: { kind: 'disc', r: 36, inner: 9 }, x: 0, z: 0, y: 0, tag: 'platform' });
  // 6 m bridge straight across the shaft (north–south)
  const shaftBridge = w.addSurface({ shape: { kind: 'rect', hx: 3, hz: 9.5 }, x: 0, z: 0, y: 0, tag: 'bridge' });
  // 6 m approach bridges south (from Z04) and north (to Z06), 20 m long
  w.addSurface({ shape: { kind: 'rect', hx: 3, hz: 10.25 }, x: 0, z: 45.75, y: 0, tag: 'bridge' });
  w.addSurface({ shape: { kind: 'rect', hx: 3, hz: 10.25 }, x: 0, z: -45.75, y: 0, tag: 'bridge' });
  // broken east span: 12 m of deck that ends over the void
  w.addSurface({ shape: { kind: 'rect', hx: 6.25, hz: 3 }, x: 41.75, z: 0, y: 0, tag: 'bridge-broken' });
  // a ring of eight King-era columns at r = 24
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    w.addCollider({ shape: { kind: 'cyl', r: 1.1, hy: 6 }, x: Math.cos(a) * 24, y: 6, z: Math.sin(a) * 24, tag: 'column' });
  }
  return {
    platform, shaftBridge, shaftRadius: 9, platformRadius: 36,
    marks: {
      southApproach: { x: 0, y: 0, z: 54 }, southRim: { x: 0, y: 0, z: 20 }, northRim: { x: 0, y: 0, z: -20 },
      northApproach: { x: 0, y: 0, z: -54 }, ringEast: { x: 20, y: 0, z: 0 }, ringWest: { x: -20, y: 0, z: 0 },
      brokenSpanEnd: { x: 47, y: 0, z: 0 }, shaftCentre: { x: 0, y: 0, z: 0 },
    },
  };
}
