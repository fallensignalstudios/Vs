/**
 * Z00 set dressing (moved out of z00.ts in polish 4 to keep the zone module under ~600 lines): the bulkhead's
 * broken crest and torn service runs, the relay-route painting's bracketed pipe runs, and the polish-4 relief —
 * lit slots, the doorway's stepped portal, the haze under the surviving vault. All visual: no colliders.
 */
import type { ZoneBuilder } from '@/core/api';
import { FACE } from '../shared';

/** the layout numbers the dressing needs (z00.ts owns them) */
export interface Z00Layout {
  W: number; D: number; WALL_H: number; EXIT_N: number; VAULT_D: number;
  BULK_X: number; BULK_H: number; GAP_N: number; GAP_W: number; EDGE_N: number;
}

/** a private stream for set dressing, so the zone's own `b.rand()` sequence (prop variants) is untouched */
function localRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Integration wave (backlog: "the bulkhead reads as a plain wall"): the bulkhead is a King-era partition brought
 * down in the crash, and must read as one. A broken crest of stepped blocks along its top (kept clear of the
 * gantry), its torn service runs — the relay-route painting's twin gold pipes — along the west face, hanging
 * where the north end broke, and slabs of the fallen upper course resting in the rubble at its foot. Visual only:
 * no colliders, nothing in the walkable floor (the bulkhead's footprint and the gap are unchanged).
 */
export function dressBulkhead(b: ZoneBuilder, L: Z00Layout): void {
  const g0 = L.GAP_N - L.GAP_W / 2;
  const g1 = L.GAP_N + L.GAP_W / 2;
  const rnd = localRand(4107);
  // the broken crest: the upper course survives in stepped, uneven blocks, gaps where it fell
  for (const [n0, n1] of [[0.25, g0 - 1.6], [g1 + 1.6, L.EDGE_N - 0.2]] as const) {
    let n = n0;
    while (n < n1 - 0.35) {
      const len = Math.min(n1 - n, 0.8 + rnd() * 1.9);
      if (rnd() > 0.2) {
        // (≤ 0.95 m thick with the skew: clear of the service conduit on the east face's top)
        const skew = (rnd() - 0.5) * 0.16;
        b.wall({ from: [L.BULK_X + skew, n], to: [L.BULK_X - skew, n + len], h: L.BULK_H, height: 0.3 + rnd() * rnd() * 2.2, thickness: 0.7 + rnd() * 0.2, style: 'plain', noCollider: true });
      }
      n += len + 0.05 + rnd() * 0.3;
    }
  }
  // the torn service runs on the west face: two gold pipes at the top of the wall, cut at the gap, the north
  // run hanging where the wall broke
  const x = L.BULK_X - 0.84;
  for (const [dh, dn] of [[0, 0], [0.26, 0.12]] as const) {
    const h = 2.95 + dh;
    b.conduit([[x, 0.5, h], [x, g0 - 0.25 - dn, h]], { r: 0.065 });
    b.conduit([[x, g1 + 0.25 + dn, h], [x, 17.6 - dn, h], [x + 0.1, 18.6 - dn, h - 1.3], [x - 0.05, 19.1 - dn, 0.18]], { r: 0.065 });
  }
  // fallen blocks of the upper course in the rubble at the north end (beyond the walkable edge)
  for (const [n, s, yaw] of [[L.EDGE_N + 0.5, 1.1, 25], [L.EDGE_N + 1.2, 0.9, -40]] as const) {
    // (an explicit variant: no draw from the zone's shared stream, so every other prop keeps its variant)
    b.prop('fallenPlate', { x: L.BULK_X - 0.2, n, yawDeg: yaw, scale: s, collider: false, h: 0.25, variant: 0 });
  }
}

/**
 * The relay-route painting's walls carry paired gold service pipes up their faces; the south wall gets three twin
 * runs between its ribs (they jog over under the vault, as in the painting). Polish 4: the kit's `pipes()` — clamp
 * brackets with stems to base plates, collars at the bends, a junction box at the jog. Visual only, on the wall.
 */
export function buildPipes(b: ZoneBuilder, L: Z00Layout): void {
  for (const x of [8.0, 16.0, 23.9]) {
    b.pipes([[x, 0.36, 0.15], [x, 0.36, 8.4], [x + 0.6, 0.36, 9.1], [x + 0.6, 0.36, L.WALL_H - 0.2]], { facing: FACE.north, r: 0.07, bracket: 1.6, boxes: [1] });
  }
  // the shelter's west wall: one run up a stile beside the squad's cache, into the vault
  b.pipes([[0.36, 14.4, 0.15], [0.36, 14.4, L.WALL_H - 0.2]], { facing: FACE.east, r: 0.06, bracket: 1.8, boxes: false });
  // the doorway's east wall: a run each side, outside the lit pylons
  for (const n of [L.EXIT_N - 5.4, L.EXIT_N + 5.4]) {
    b.pipes([[L.W - 0.36, n, 0.15], [L.W - 0.36, n, L.WALL_H - 0.2]], { facing: FACE.west, r: 0.06, bracket: 1.6, boxes: false });
  }
}

/**
 * Polish 4 (relay-route painting): the fine architectural detail — tall softly lit slots between the south wall's
 * pipe runs (window glow from within: the sky beyond the breach is the story's night), a deep stepped portal
 * round the lit rib doorway, and a pale haze high in the surviving vault so the upper room reads as lit stone,
 * not a night ceiling. All collider-free, merged by material.
 */
export function buildRelief(b: ZoneBuilder, L: Z00Layout): void {
  // (between the rib legs at x = 3 / 10.2 / 19.6 / 25.6 and the pipe runs; sills above the bench and the crates)
  for (const x of [5.6, 13.1, 21.7]) b.slot({ x, n: 0.36, h: 1.6, yawDeg: FACE.north, width: 0.42, height: 7.4, intensity: 1.15 });
  // the doorway's stepped portal (crest off: the white point burns where it would stand)
  b.portal({ x: L.W - 0.3, n: L.EXIT_N, yawDeg: FACE.west, width: 3, height: 3.5, steps: 3, depth: 0.9, step: 0.3, crest: false });
  // haze under the surviving vault: brightest high up, thinning toward the floor (the box stays in open air, clear
  // of the walls and the vault, so nothing inside it cuts the veil)
  b.haze({ x: L.W / 2, n: L.VAULT_D / 2 + 0.6, h: 3.5, w: L.W - 1.6, d: L.VAULT_D + 0.6, height: L.WALL_H - 4, density: 0.035, falloff: -0.8, color: 0xe8ecf2, intensity: 0.9 });
}
