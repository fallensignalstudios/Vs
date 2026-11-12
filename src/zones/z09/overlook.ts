/**
 * Z09 — the overlook's foreground, after the wound-overlook painting (polish 4):
 *
 *  - THE PARAPET: the painting's solid waist-high balustrade of dark polished stone — plinth, body, overhanging cap
 *    with fine gold lines, and stout piers every ~3.2 m along the walk, each with a tall lantern slot. It follows the
 *    overlook's true curve (the kit's `rail({ style: 'parapet' })` would put a pier at both ends of each of the 14
 *    short chords the collider is made of). Its colliders are the glass rail's own, registered unchanged — same
 *    boxes, same order — so the walkable footprint is identical.
 *  - THE BUTTRESSES: immense pale marble fins rising out of the depths just beyond the rail on the north-east, curving
 *    over toward the walk, edged with fine gold and carrying gold crowns (the painting's right side). Outside the
 *    walkable footprint, collider-free.
 *
 * Everything is static and merged by material through `b.addStatic` (stone, white-gold and gold join the zone's own
 * merged meshes; the lanterns add one draw call).
 */
import * as THREE from 'three';
import type { ZoneBuilder } from '@/core/api';

type P2 = [number, number];

/** the rail's height (as the glass rail it replaces) and the parapet's section */
const RAIL_H = 1.1;
const CAP = { h: 0.1, w: 0.28 } as const;
const BODY_W = 0.2;
const PLINTH = { h: 0.16, w: 0.26 } as const;
/** piers: spacing along the walk, size, the lantern slot on each face */
const PIER = { every: 3.2, w: 0.42, d: 0.36, h: RAIL_H + 0.16 } as const;
const LANTERN = { w: 0.075, y0: 0.5, y1: 1.02 } as const;

/**
 * The glass rail's colliders, exactly as `b.rail({ from, to, h, height: 1.1, style: 'glass' })` registers them: one box
 * per segment (half extents len/2 × 0.55 × 0.1, centred on the segment, yawed along it), low enough to see and shoot
 * over, tagged 'rail'.
 */
export function railColliders(b: ZoneBuilder, pts: P2[], h: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = b.P(pts[i][0], pts[i][1], h);
    const c = b.P(pts[i + 1][0], pts[i + 1][1], h);
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ry = Math.atan2(-dz, dx);
    b.collider({
      shape: { kind: 'box', hx: len / 2, hy: RAIL_H / 2, hz: 0.1 },
      x: a.x + (len / 2) * Math.cos(ry), y: a.y + RAIL_H / 2, z: a.z - (len / 2) * Math.sin(ry), yaw: ry,
      blocksSight: false, blocksShots: false, tag: 'rail',
    });
  }
}

/**
 * a box of size (sx, sy, sz) centred at local (x, y, z) of a frame turned by `yaw` about +Y at `o` — one shared unit
 * cube, scaled (the static merge bakes each mesh's matrix, normals included)
 */
function box(g: THREE.Group, unit: THREE.BufferGeometry, mat: THREE.Material, o: THREE.Vector3, yaw: number, sx: number, sy: number, sz: number, x: number, y: number, z: number): void {
  const m = new THREE.Mesh(unit, mat);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  m.position.set(o.x + x * c + z * s, o.y + y, o.z - x * s + z * c);
  m.rotation.y = yaw;
  m.scale.set(sx, sy, sz);
  g.add(m);
}

/**
 * The parapet along a smooth plan path (`path`: plan points, sampled finely on the curve), on the floor at `h`.
 * Returns the group handed to `addStatic`.
 */
export function buildParapet(b: ZoneBuilder, path: P2[], h: number): THREE.Group {
  const mats = b.mats;
  const stone = mats.get('blackStone');
  const gold = mats.get('goldTrim');
  const lamp = mats.emissive(0xffd9a6, 2.6);
  const g = new THREE.Group();
  g.name = 'z09-parapet';
  const geo = new THREE.BoxGeometry(1, 1, 1);
  // the run: plinth, body, cap and the two fine gold lines on each face, segment by segment (overlapping a little at
  // the joints of the curve so no seam opens on its outside)
  let total = 0;
  const seg: Array<{ a: THREE.Vector3; yaw: number; len: number; s0: number }> = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = b.P(path[i][0], path[i][1], h);
    const c = b.P(path[i + 1][0], path[i + 1][1], h);
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.01) continue;
    seg.push({ a, yaw: Math.atan2(-(c.z - a.z), c.x - a.x), len, s0: total });
    total += len;
  }
  const capY = RAIL_H - CAP.h;
  for (const { a, yaw, len } of seg) {
    const L = len + 0.03;
    box(g, geo, stone, a, yaw, L, PLINTH.h, PLINTH.w, len / 2, PLINTH.h / 2, 0);
    box(g, geo, stone, a, yaw, L, capY - PLINTH.h, BODY_W, len / 2, (PLINTH.h + capY) / 2, 0);
    box(g, geo, stone, a, yaw, L, CAP.h, CAP.w, len / 2, capY + CAP.h / 2, 0);
    for (const sd of [-1, 1]) {
      box(g, geo, gold, a, yaw, L, 0.018, 0.006, len / 2, capY - 0.06, sd * (BODY_W / 2 + 0.003));
      box(g, geo, gold, a, yaw, L, 0.014, 0.006, len / 2, PLINTH.h + 0.05, sd * (BODY_W / 2 + 0.003));
      box(g, geo, gold, a, yaw, L, 0.012, 0.006, len / 2, capY + 0.02, sd * (CAP.w / 2 + 0.003));
    }
  }
  // the piers, evenly along the walk, each with a tall lantern slot in a gold frame on both faces
  const piers = Math.max(1, Math.round(total / PIER.every));
  for (let k = 0; k <= piers; k++) {
    const s = (total * k) / piers;
    const sg = seg.find((q) => s <= q.s0 + q.len + 1e-6) ?? seg[seg.length - 1];
    const t = s - sg.s0;
    box(g, geo, stone, sg.a, sg.yaw, PIER.w, PIER.h, PIER.d, t, PIER.h / 2, 0);
    box(g, geo, stone, sg.a, sg.yaw, PIER.w + 0.08, 0.07, PIER.d + 0.08, t, PIER.h + 0.035, 0);
    box(g, geo, gold, sg.a, sg.yaw, PIER.w + 0.01, 0.024, PIER.d + 0.01, t, PIER.h - 0.03, 0);
    for (const sd of [-1, 1]) {
      const zf = sd * (PIER.d / 2 + 0.002);
      box(g, geo, lamp, sg.a, sg.yaw, LANTERN.w, LANTERN.y1 - LANTERN.y0, 0.004, t, (LANTERN.y0 + LANTERN.y1) / 2, zf);
      box(g, geo, gold, sg.a, sg.yaw, LANTERN.w + 0.06, 0.014, 0.008, t, LANTERN.y1 + 0.02, zf);
      box(g, geo, gold, sg.a, sg.yaw, LANTERN.w + 0.06, 0.014, 0.008, t, LANTERN.y0 - 0.02, zf);
      for (const sx of [-1, 1]) box(g, geo, gold, sg.a, sg.yaw, 0.012, LANTERN.y1 - LANTERN.y0 + 0.05, 0.008, t + sx * (LANTERN.w / 2 + 0.024), (LANTERN.y0 + LANTERN.y1) / 2, zf);
    }
  }
  b.addStatic(g);
  return g;
}

// =====================================================================================================================
// The buttresses
// =====================================================================================================================

/** one fin: foot (plan), the face's bearing, height above the low floor of its top, the lean of its top */
export interface FinSpec {
  x: number; n: number;
  /** bearing the broad face looks toward (plan degrees) */
  face: number;
  /** foot and top heights (absolute), width at the foot and at the top, thickness, the top's sideways lean */
  h0: number; h1: number; w0: number; w1: number; t: number; lean: number;
  /** the fin rises straight to this height (absolute), then curves over */
  knee: number;
  /** heights (absolute) of the gold crowns on the face */
  crowns: number[];
}

/** the fin's centre line and width up its height (v from the foot) */
function finCurve(f: FinSpec): { cu: (v: number) => number; wd: (v: number) => number } {
  const H = f.h1 - f.h0;
  const k = f.knee - f.h0;
  return {
    cu: (v) => f.lean * Math.pow(Math.max(0, (v - k) / (H - k)), 1.6),
    wd: (v) => f.w0 + (f.w1 - f.w0) * Math.pow(v / H, 0.8),
  };
}

/** the fin's outline in its own plane (u across, v up from the foot): a tapering blade curving over to +u */
function finShape(f: FinSpec): THREE.Shape {
  const H = f.h1 - f.h0;
  const N = 32;
  const { cu, wd } = finCurve(f);
  const sh = new THREE.Shape();
  sh.moveTo(cu(0) - wd(0) / 2, 0);
  for (let i = 1; i <= N; i++) { const v = (i / N) * H; sh.lineTo(cu(v) - wd(v) / 2, v); }
  // a pointed top, leaning on
  sh.lineTo(cu(H) + f.lean * 0.06, H + f.w1 * 1.1);
  for (let i = N; i >= 0; i--) { const v = (i / N) * H; sh.lineTo(cu(v) + wd(v) / 2, v); }
  sh.closePath();
  return sh;
}

/**
 * the gold crown: a narrow band with a tall slender centre spike, two long outer spikes flaring out and two short inner
 * ones, and a stem below (about 2.4 m wide and 4 m tall at scale 1)
 */
function crownShapes(): THREE.Shape[] {
  const right: P2[] = [[0, 0], [0.5, 0], [0.56, 0.12], [1.22, 1.75], [0.5, 0.36], [0.36, 0.95], [0.2, 0.34], [0, 2.5]];
  const pts = [...right, ...right.slice(1, -1).reverse().map(([u, v]) => [-u, v] as P2)];
  const crown = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  const stem = new THREE.Shape([new THREE.Vector2(0, 0.05), new THREE.Vector2(0.16, -0.5), new THREE.Vector2(0, -1.5), new THREE.Vector2(-0.16, -0.5)]);
  return [crown, stem];
}

/** the fins, each turned so its broad face looks along `face`, with gold edges and crowns on that face */
export function buildButtresses(b: ZoneBuilder, fins: FinSpec[]): THREE.Group {
  const mats = b.mats;
  const marble = mats.get('whiteGold');
  const gold = mats.get('goldTrim');
  const g = new THREE.Group();
  g.name = 'z09-buttresses';
  const crown = new THREE.ExtrudeGeometry(crownShapes(), { depth: 0.12, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1 });
  for (const f of fins) {
    const H = f.h1 - f.h0;
    const fin = new THREE.Group();
    fin.position.copy(b.P(f.x, f.n, f.h0));
    fin.rotation.y = b.yaw(f.face);
    const body = new THREE.ExtrudeGeometry(finShape(f), { depth: f.t, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1, curveSegments: 4 });
    body.translate(0, 0, -f.t / 2);
    fin.add(new THREE.Mesh(body, marble));
    // fine gold up both edges of the face (local −Z is the face: `face` is the bearing it looks along)
    const { cu, wd } = finCurve(f);
    for (const sd of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 40; i++) { const v = (i / 40) * H; pts.push(new THREE.Vector3(cu(v) + sd * (wd(v) / 2 - 0.22), v, -f.t / 2 - 0.09)); }
      fin.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05, 5, false), gold));
    }
    for (const hc of f.crowns) {
      const v = hc - f.h0;
      const m = new THREE.Mesh(crown, gold);
      // the extrusion's first cap faces −Z, out of the face; its back stands just clear of the fin's bevel
      const k = Math.max(0.45, wd(v) / 3.2);
      m.scale.setScalar(k);
      m.position.set(cu(v), v, -f.t / 2 - 0.1 - 0.15 * k);
      fin.add(m);
    }
    g.add(fin);
  }
  b.addStatic(g);
  return g;
}
