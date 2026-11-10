/**
 * Carrier hull: geometry, light layout and a conservative collision proxy.
 *
 * ≈ 464 m slab-hulled carrier, nose toward −Z, origin at the hull centre. It is seen mostly from BELOW (through
 * the Z05 ceiling), so the belly carries the detail: a lit keel trench, rows of ventral hangar bays, frames,
 * keel rails, six maneuvering-jet pods and — the lowest point of the whole ship — a ventral bow ram. The ram is
 * the one feature that strikes the scenic tower (see carrier.ts); everything aft of it rides higher.
 */
import * as THREE from 'three';
import { GeoBuilder, type P3 } from './scenic/geo';
import { LightCards, type LightCardMesh } from './scenic/lights';
import type { SharedUniforms } from './shared';

export const HULL_LENGTH = 464;
/** half beam of the main hull (shadow footprint) */
export const HULL_HALF_BEAM = 66;
/** local z of the bow ram's leading face */
export const BOW_Z = -232;
/** local y range of the bow ram: the lowest structure on the ship */
export const RAM_BOTTOM = -52;
export const RAM_TOP = -24;

/** Axis-aligned local-space box [x0, x1, y0, y1, z0, z1]. */
export type HullBox = readonly [number, number, number, number, number, number];

/** [z, half width, deck top, belly bottom] from stern to bow */
const STATIONS: ReadonlyArray<readonly [number, number, number, number]> = [
  [232, 54, 30, -34], [184, 62, 34, -38], [110, 66, 36, -40], [0, 66, 36, -40], [-90, 64, 34, -40],
  [-150, 52, 26, -40], [-205, 34, 14, -38], [BOW_Z, 22, 8, -32],
];

export const JETS: ReadonlyArray<P3> = [[-56, -42, -160], [56, -42, -160], [-60, -42, 150], [60, -42, 150], [-40, -42, -10], [40, -42, -10]];
export const BREACHES: ReadonlyArray<P3> = [[-58, 4, -128], [64, -10, 30], [-26, -40, 92], [34, -40, -70], [18, 36, -60]];
const ENGINES: ReadonlyArray<readonly [number, number, number]> = [[-36, 8, 15], [0, 12, 17], [36, 8, 15], [-19, -17, 12], [19, -17, 12]];

function section(z: number, w: number, top: number, bot: number): P3[] {
  const half: Array<[number, number]> = [
    [0.50 * w, bot], [0.82 * w, bot + 5], [w, bot + 17], [w, top - 16], [0.90 * w, top - 5], [0.72 * w, top],
  ];
  const pts: P3[] = [[0, bot, z]];
  for (const [x, y] of half) pts.push([x, y, z]);
  pts.push([0, top, z]);
  for (let i = half.length - 1; i >= 0; i--) pts.push([-half[i][0], half[i][1], z]);
  return pts;
}

/** Smooth nozzle bell lying along +Z. */
function bell(b: GeoBuilder, x: number, y: number, z0: number, len: number, r: number): void {
  b.push().translate(x, y, z0).rotateX(Math.PI / 2);
  b.lathe(0, 0, [[r * 0.72, 0], [r * 0.80, len * 0.25], [r, len], [r * 0.86, len], [r * 0.6, len * 0.3], [r * 0.5, 0]], 14);
  b.pop();
}

export interface CarrierHull {
  geometry: THREE.BufferGeometry;
  /** conservative boxes covering every solid part (used to stage and test the tower clip) */
  proxy: HullBox[];
  triangles: number;
}

export function buildCarrierHull(rand: () => number): CarrierHull {
  const b = new GeoBuilder();
  const proxy: HullBox[] = [];
  const HULL = 0x5b6169, PLATE = 0x474c54, DARK = 0x15171b, PALE = 0x9a9c97, WARM = 0xffd9a0, STEEL = 0x6e747c, HAZARD = 0xc98a2c;
  /** a solid appendage: chamfered block + its proxy box */
  const part = (hex: number, shade: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, bevel = 1.2): void => {
    b.paint(hex, 0, shade).bevelBox(cx, cy, cz, sx, sy, sz, bevel);
    proxy.push([cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2]);
  };

  // ---- main hull: hard chines, smooth along its length
  b.dress(0, 1).paint(HULL, 0, 0.78);
  const rings = STATIONS.map(([z, w, top, bot]) => section(z, w, top, bot));
  b.skin(rings, { crease: rings[0].map((_, i) => i), caps: true });
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const p = STATIONS[i], q = STATIONS[i + 1];
    proxy.push([-Math.max(p[1], q[1]), Math.max(p[1], q[1]), Math.min(p[3], q[3]), Math.max(p[2], q[2]), q[0], p[0]]);
  }

  // ---- the bow: ventral ram (lowest point of the ship), armoured prow cheeks, a lit launch-bay mouth
  part(STEEL, 0.62, 0, (RAM_TOP + RAM_BOTTOM) / 2, BOW_Z + 31, 28, RAM_TOP - RAM_BOTTOM, 62, 3);
  b.paint(HAZARD, 0, 0.9).box(0, RAM_BOTTOM + 3, BOW_Z - 0.3, 22, 1.6, 0.8);
  for (const sx of [-1, 1]) {
    part(PLATE, 0.8, sx * 25, -8, BOW_Z + 18, 14, 34, 44, 2.5);
    b.paint(DARK).bevelBox(sx * 12, -2, BOW_Z - 1, 12, 10, 4, 0.8);
    b.paint(WARM, 2.2).box(sx * 12, -2, BOW_Z - 3.1, 9, 6, 0.4);
  }
  part(PLATE, 0.7, 0, 12, BOW_Z + 10, 30, 10, 26, 2);

  // ---- flight deck: trench, kerbs, landing-light rows, the island (starboard aft) with masts
  b.paint(DARK).box(0, 36.6, 10, 40, 1.4, 330);
  b.paint(PALE, 0, 0.5).bevelBox(21, 37.4, 10, 1.6, 2.4, 330, 0.4).bevelBox(-21, 37.4, 10, 1.6, 2.4, 330, 0.4);
  for (let z = -140; z <= 160; z += 20) b.paint(WARM, rand() < 0.7 ? 1.4 : 0).box(0, 37.35, z, 0.9, 0.12, 7);
  part(HULL, 0.95, 44, 58, 120, 24, 44, 66, 3);
  part(HULL, 1.05, 45, 90, 126, 15, 22, 36, 2);
  part(PLATE, 0.9, 45, 104, 122, 22, 6, 46, 1.5);
  b.paint(DARK).box(45, 94, 107.6, 13, 4, 1);
  b.paint(WARM, 1.8).box(45, 94, 107.2, 11.5, 1.2, 0.4);
  b.paint(PALE, 0, 0.6).cyl(45, 107, 128, 152, 1.6, 0.4, 8).cyl(39, 107, 140, 134, 1.0, 0.3, 8);
  b.paint(PALE, 0, 0.5).bevelBox(45, 128, 128, 12, 0.8, 2, 0.2).bevelBox(45, 138, 128, 7, 0.6, 1.6, 0.2);

  // ---- flanks: armour belt, hangar blocks with recessed lit bays (several dark), sensor blisters
  for (const sx of [-1, 1]) {
    part(PLATE, 0.72, sx * 67.5, 12, 0, 4, 9, 360, 1.2);
    for (let i = 0; i < 7; i++) {
      const z = -150 + i * 50;
      part(HULL, 0.7, sx * 69, -8, z, 9, 24, 40, 1.6);
      b.paint(DARK).box(sx * 73.6, -9, z, 0.6, 12, 26);
      if (rand() < 0.6) {
        b.paint(WARM, 1.5 + rand() * 1.3).box(sx * 73.2, -10, z, 0.4, 8, 22);
        b.paint(DARK).box(sx * 73.9, -10, z - 6, 0.5, 8.2, 0.8).box(sx * 73.9, -10, z + 6, 0.5, 8.2, 0.8);
      }
    }
    // aft sponson wings carrying the flank batteries
    b.paint(HULL, 0, 0.7).loft([
      [[sx * 62, -18, 215], [sx * 62, -4, 215], [sx * 62, -4, 100], [sx * 62, -18, 100]],
      [[sx * 128, -13, 226], [sx * 128, -7, 226], [sx * 128, -7, 176], [sx * 128, -13, 176]],
    ].map((r) => (sx > 0 ? r : [...r].reverse()) as P3[]));
    proxy.push([Math.min(sx * 62, sx * 128), Math.max(sx * 62, sx * 128), -18, -4, 100, 226]);
    part(DARK, 1, sx * 129, -10, 202, 4, 14, 58, 1);
    b.paint(STEEL, 0, 0.7).cyl(sx * 104, -4, 190, 3, 4.5, 4.5, 10).cyl(sx * 84, -4, 170, 3, 4.5, 4.5, 10);
  }

  // ---- the belly (the face the atrium sees): keel trench, rails, frames, bays, jet pods
  b.paint(DARK).box(0, -39.2, 14, 17, 1.8, 300);
  for (const sx of [-1, 1]) {
    part(PLATE, 0.8, sx * 9.6, -41.5, 14, 2.4, 4.5, 304, 0.6);
    b.paint(WARM, 1.25).box(sx * 7.9, -40.3, 14, 0.5, 0.5, 296);
    part(PLATE, 0.7, sx * 25, -43, 10, 6, 6, 352, 1.2);
  }
  // hangar apertures inside the trench, lit from within
  for (let i = 0; i < 6; i++) {
    const z = -116 + i * 50;
    b.paint(WARM, rand() < 0.75 ? 1.0 + rand() * 0.9 : 0.08).box(0, -38.6, z, 12, 0.3, 30);
    b.paint(DARK).box(0, -39.0, z - 16, 13, 1.2, 1.4).box(0, -39.0, z + 16, 13, 1.2, 1.4);
  }
  // transverse frames
  for (let z = -160; z <= 200; z += 30) {
    const w = z < -120 ? 84 : 118;
    b.paint(PLATE, 0, 0.62).bevelBox(0, -41.2, z, w, 2.6, 4, 0.5);
    proxy.push([-w / 2, w / 2, -42.5, -39.9, z - 2, z + 2]);
  }
  // ventral bays between the frames: recessed, a few glowing
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const z = -135 + i * 30 + 15;
      if (Math.abs(z - -10) < 20 || Math.abs(z - 150) < 22) continue; // jet pods live here
      b.paint(DARK).box(sx * 44, -39.6, z, 22, 0.6, 20);
      const r = rand();
      if (r < 0.34) b.paint(WARM, 0.9 + rand()).box(sx * 44, -39.25, z, 16, 0.2, 13);
      else if (r < 0.6) b.paint(STEEL, 0, 0.5).bevelBox(sx * 44, -40.6, z, 15, 2, 12, 0.6);
    }
  }
  // maneuvering-jet pods: gimbal block + downward bell
  for (const [x, y, z] of JETS) {
    part(PLATE, 0.75, x, y - 1, z, 20, 7, 30, 1.6);
    b.paint(STEEL, 0, 0.6).cyl(x, y - 9, z, y - 4, 5.2, 7, 14, false);
    b.paint(DARK).cyl(x, y - 9, z, y - 8.4, 4.8, 4.8, 14);
    proxy.push([x - 7, x + 7, y - 9, y - 4, z - 7, z + 7]);
  }
  // antenna booms and drain masts (all stop above the ram's keel line)
  for (const [x, z] of [[-48, -60], [48, 60], [-34, 190], [30, -120]] as const) {
    b.paint(PALE, 0, 0.5).cyl(x, -48.5, z, -40, 0.35, 0.7, 6);
    proxy.push([x - 1, x + 1, -48.5, -40, z - 1, z + 1]);
  }

  // ---- engine block; bells are cold apart from what the light cards add
  part(HULL, 0.62, 0, -1, 246, 112, 60, 36, 3);
  part(PLATE, 0.7, 0, 30, 244, 80, 6, 30, 1.5);
  for (const [x, y, r] of ENGINES) {
    b.paint(DARK);
    bell(b, x, y, 262, 26, r);
    b.paint(0x2a1408, 0.45).box(x, y, 268, r * 1.2, r * 1.2, 0.4);
  }
  proxy.push([-56, 56, -36, 30, 262, 290]);

  // ---- torn plating peeled back around the two worst wounds
  for (const [cx, cy, cz, n] of [[-60, 6, -128, 16], [66, -10, 30, 11], [-26, -41, 92, 9]] as const) {
    for (let i = 0; i < n; i++) {
      b.push().translate(cx + (rand() - 0.5) * 22, cy + (rand() - 0.5) * 30, cz + (rand() - 0.5) * 64)
        .rotateY(rand() * 6.28).rotateX((rand() - 0.5) * 1.6).rotateZ((rand() - 0.5) * 1.6);
      b.paint(DARK).box(0, 0, 0, 5 + rand() * 16, 0.8, 4 + rand() * 12, { top: [0.5 + rand() * 0.5, 0.4 + rand() * 0.6] });
      b.pop();
    }
  }
  return { geometry: b.build(), proxy, triangles: b.triangleCount };
}

export function buildCarrierLights(rand: () => number, shared: SharedUniforms): LightCardMesh {
  const c = new LightCards();
  const WHITE = 0xdfe8ff, RED = 0xff3020, JET = 0xbfe4ff, EMBER = 0xff7a2a;
  // group 0 — sparse running lights (several dead)
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) if (rand() < 0.6) c.point(sx * 70, 18, -200 + i * 50, 3.2, WHITE, 3.5);
  c.point(45, 153, 128, 4, RED, 6).point(0, RAM_BOTTOM - 1, BOW_Z + 4, 3.5, RED, 5).point(0, -46, 150, 3.5, RED, 5).point(0, 9, BOW_Z - 2, 3, WHITE, 4);
  for (const sx of [-1, 1]) c.point(sx * 131, -10, 228, 3.4, sx < 0 ? RED : 0x40ff90, 4.5);
  // group 1 — ventral maneuvering jets: core + downward plume (relit by setStabilized)
  for (const [x, y, z] of JETS) {
    c.point(x, y - 11, z, 12, JET, 4.2, 1);
    for (let i = 0; i < 7; i++) c.point(x, y - 17 - i * 7, z, 14 - i * 1.2, JET, 1.3 * Math.pow(0.7, i), 1);
  }
  // group 2 — failing main engines
  for (const [x, y] of [[-36, 8], [36, 8], [19, -17]] as const) c.point(x, y, 292, 30, 0xffb060, 3.2, 2);
  // group 3 — venting embers and gas streaming aft from the breaches
  for (const [bx, by, bz] of BREACHES) {
    for (let i = 0; i < 20; i++) {
      c.point(bx + (rand() - 0.5) * 16, by + (rand() - 0.5) * 12, bz + (rand() - 0.5) * 24, 1.6 + rand() * 2.2, EMBER, 2.5 + rand() * 3, 3)
        .loop((rand() - 0.5) * 9, -3 - rand() * 7, 20 + rand() * 26, 3 + rand() * 4, rand());
    }
    for (let i = 0; i < 5; i++) {
      c.point(bx, by, bz, 20 + rand() * 22, 0x9aa6c0, 0.16 + rand() * 0.12, 3).loop((rand() - 0.5) * 5, -2 - rand() * 3, 14 + rand() * 10, 6 + rand() * 4, rand());
    }
    c.point(bx, by, bz, 30, 0xff5a1e, 1.2, 3);
  }
  return c.build(shared, { name: 'sky:carrierLights', minPx: 1.6 });
}

/** Is a local-space point inside the hull proxy grown by `margin` metres? */
export function insideHull(proxy: readonly HullBox[], x: number, y: number, z: number, margin = 0): boolean {
  for (let i = 0; i < proxy.length; i++) {
    const p = proxy[i];
    if (x >= p[0] - margin && x <= p[1] + margin && y >= p[2] - margin && y <= p[3] + margin && z >= p[4] - margin && z <= p[5] + margin) return true;
  }
  return false;
}
