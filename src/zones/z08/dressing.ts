/**
 * Z08 — dressing toward the quarantine painting (pdf/ref-concept-quarantine.png): the gold vertical inlay that
 * runs up every white-gold wall, the monumental gold-framed gate round the north doorway (concentric rings over
 * it, a bright line climbing its axis), gold frames on the survivor recesses, and the violet crystal growth that
 * the organism brought through the breach — climbing the north wall and the rib legs either side of the doorway,
 * with dark shards strewn below it (violet only at the real source: the breach and the anchor beside it).
 *
 * All of it is visual: no collider, no nav change, no light. Static, so finalize() merges it by material (three
 * materials in all). The two crystal materials are the zone's own and are released with the zone state.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ZoneBuilder } from '@/core/api';
import { GOLD, IVORY } from '../shared';
import { D, EXIT_X, ENTRY_X, RECESS_E, RECESS_W, W } from './layout';
import { S } from './state';

/** inner wall faces (the walls are 0.6 m thick on their plan line) and the strips' stand-off from them */
const FACE = 0.3 + 0.05;
/** solid wall height (the glass band starts above it) */
const WALL_TOP = 14;
/** the gate round the north doorway: frame half-widths, heights, the medallion over the door */
const GATE = { inner: 2.95, innerH: 5.05, outer: 3.85, outerH: 12.4, ringH: 8.7, rings: [0.95, 1.65, 2.35] } as const;
/** bays between the rib legs (x) where a pair of gold lines runs up the north and south walls */
const BAYS_X = [12, 23.5, 46.5, 58] as const;
/** gold lines up the west and east walls (n) */
const SIDE_N_W = [6, 12, 18, 24, 30] as const;
const SIDE_N_E = [5, 11, 32.5] as const;

type Strip = [x0: number, n0: number, h0: number, x1: number, n1: number, h1: number, w: number];

/**
 * The growth's own seeded stream (mulberry32): the zone's `rand()` stream also places prop variants and their
 * colliders, so the dressing never draws from it.
 */
let seed = 0x08c2a7;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function buildDressing(b: ZoneBuilder): void {
  seed = 0x08c2a7; // the same growth on every load
  buildInlays(b);
  buildCrystals(b);
}

// ---------------------------------------------------------------------------------------------------------------------
// Gold
// ---------------------------------------------------------------------------------------------------------------------

/** a thin lit bar between two plan points (x, n, h), `w` wide and 4 cm deep, standing off its wall */
function bar(b: ZoneBuilder, s: Strip): THREE.BufferGeometry {
  const [x0, n0, h0, x1, n1, h1, w] = s;
  const a = b.P(x0, n0, h0);
  const c = b.P(x1, n1, h1);
  const len = a.distanceTo(c);
  const geo = new THREE.BoxGeometry(w, len, 0.04);
  const dir = c.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  // on an east–west wall every direction in the wall plane turns about z, so the 4 cm depth stays on the normal
  geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return geo;
}

function buildInlays(b: ZoneBuilder): void {
  const gold: THREE.BufferGeometry[] = [];
  const bright: THREE.BufferGeometry[] = [];
  const nN = D - FACE; // north wall, room face
  const nS = FACE; // south wall
  const xW = FACE; // west wall
  const xE = W - FACE; // east wall
  const up = (x: number, n: number, h0: number, h1: number, w = 0.11): Strip => [x, n, h0, x, n, h1, w];

  // the bays of the north and south walls: a pair of lines from the skirting to under the glass
  for (const x of BAYS_X) {
    for (const n of [nN, nS]) for (const s of [-1, 1]) gold.push(bar(b, up(x + s * 0.6, n, 0.45, WALL_TOP - 0.5)));
  }
  // west and east walls (the east one only where the deck and the recess leave it bare): thin side to the room
  for (const n of SIDE_N_W) for (const s of [-1, 1]) gold.push(sideBar(b, xW, n + s * 0.6, 0.45, WALL_TOP - 0.5, 0.11));
  for (const n of SIDE_N_E) for (const s of [-1, 1]) gold.push(sideBar(b, xE, n + s * 0.6, 0.45, WALL_TOP - 0.5, 0.11));

  // the gate: an inner frame round the doorway, a tall outer frame, a lintel, and the medallion over the door
  const gx = EXIT_X;
  for (const s of [-1, 1]) {
    gold.push(bar(b, up(gx + s * GATE.inner, nN, 0, GATE.innerH, 0.12)));
    gold.push(bar(b, up(gx + s * GATE.outer, nN, 0, GATE.outerH, 0.14)));
    gold.push(bar(b, up(gx + s * (GATE.outer + 0.45), nN, 0.3, GATE.outerH - 1.2, 0.07)));
    // the outer frame's shoulders step in toward the axis (the painting's stepped gate head)
    gold.push(bar(b, [gx + s * GATE.outer, nN, GATE.outerH, gx + s * 1.25, nN, GATE.outerH + 0.9, 0.12]));
  }
  gold.push(bar(b, [gx - GATE.inner, nN, GATE.innerH, gx + GATE.inner, nN, GATE.innerH, 0.12]));
  gold.push(bar(b, [gx - GATE.outer, nN, GATE.innerH + 0.6, gx + GATE.outer, nN, GATE.innerH + 0.6, 0.08]));
  gold.push(bar(b, [gx - 1.25, nN, GATE.outerH + 0.9, gx + 1.25, nN, GATE.outerH + 0.9, 0.12]));
  const c = b.P(gx, nN - 0.02, GATE.ringH);
  for (const r of GATE.rings) {
    const t = new THREE.TorusGeometry(r, r > 2 ? 0.06 : 0.045, 4, 72);
    t.translate(c.x, c.y, c.z);
    gold.push(t);
  }
  // the bright line up the gate's axis, from the lintel to the glass (the painting's beam of light)
  bright.push(bar(b, up(gx, nN - 0.03, GATE.innerH + 0.6, WALL_TOP - 0.2, 0.16)));
  // the entry (south wall): a smaller frame
  for (const s of [-1, 1]) gold.push(bar(b, up(ENTRY_X + s * 2.75, nS, 0, 5.2, 0.1)));
  gold.push(bar(b, [ENTRY_X - 2.75, nS, 5.2, ENTRY_X + 2.75, nS, 5.2, 0.1]));

  // gold frames on the survivor recesses (their mouths face south, into the room)
  for (const [r, mx, mw] of [[RECESS_W, 9, 5], [RECESS_E, 66, 4]] as const) {
    const n = r.n0 - FACE;
    for (const s of [-1, 1]) gold.push(bar(b, up(mx + s * (mw / 2 + 0.25), n, 0, 4.0, 0.1)));
    gold.push(bar(b, [mx - mw / 2 - 0.25, n, 4.0, mx + mw / 2 + 0.25, n, 4.0, 0.1]));
    gold.push(bar(b, [r.x0 + 0.4, n, 4.35, r.x1 - 0.4, n, 4.35, 0.06]));
  }

  add(b, gold, b.mats.emissive(GOLD, 2.2), 'z08-inlay');
  add(b, bright, b.mats.emissive(IVORY, 4.5), 'z08-gate-axis');
}

/** a vertical bar on a north–south (west / east) wall: thin side toward the room */
function sideBar(b: ZoneBuilder, x: number, n: number, h0: number, h1: number, w: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.04, h1 - h0, w);
  const p = b.P(x, n, (h0 + h1) / 2);
  geo.translate(p.x, p.y, p.z);
  return geo;
}

function add(b: ZoneBuilder, geos: THREE.BufferGeometry[], mat: THREE.Material, name: string): void {
  if (!geos.length) return;
  for (let i = 0; i < geos.length; i++) {
    const g = geos[i];
    // one attribute layout for the merge (tori and boxes both carry position / normal / uv)
    if (g.index) geos[i] = g.toNonIndexed();
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  b.add(mesh);
}

// ---------------------------------------------------------------------------------------------------------------------
// Violet crystal growth (the organism's breach)
// ---------------------------------------------------------------------------------------------------------------------

/** one faceted crystal: a six-sided prism tapering to a point, its base at the origin, along +Y */
function crystal(len: number, r: number): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0, -0.05), new THREE.Vector2(r, 0), new THREE.Vector2(r * 0.82, len * 0.72), new THREE.Vector2(0, len)];
  return new THREE.LatheGeometry(pts, 6).toNonIndexed();
}

/**
 * A cluster grown from a point on a surface: `count` crystals fanned round the surface normal `nrm` (world), the
 * longest near the middle. `lit` = the share of crystals that carry the bright core material.
 */
function cluster(
  b: ZoneBuilder, out: { dark: THREE.BufferGeometry[]; lit: THREE.BufferGeometry[] },
  at: THREE.Vector3, nrm: THREE.Vector3, count: number, size: number, lit: number, spread = 0.75,
): void {
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const tangent = new THREE.Vector3().crossVectors(nrm, Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const bit = new THREE.Vector3().crossVectors(nrm, tangent);
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const tilt = Math.pow(rand(), 0.8) * spread;
    const dir = nrm.clone().multiplyScalar(Math.cos(tilt))
      .addScaledVector(tangent, Math.sin(tilt) * Math.cos(a))
      .addScaledVector(bit, Math.sin(tilt) * Math.sin(a))
      .normalize();
    const k = 1 - tilt / (spread + 0.01);
    const len = size * (0.35 + 0.65 * rand()) * (0.55 + 0.45 * k);
    const r = len * (0.11 + 0.06 * rand());
    const geo = crystal(len, r);
    const base = at.clone()
      .addScaledVector(tangent, (rand() - 0.5) * size * 0.55)
      .addScaledVector(bit, (rand() - 0.5) * size * 0.55)
      .addScaledVector(nrm, -0.04);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const twist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    m.compose(base, q.multiply(twist), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    (rand() < lit ? out.lit : out.dark).push(geo);
  }
}

function buildCrystals(b: ZoneBuilder): void {
  const out = { dark: [] as THREE.BufferGeometry[], lit: [] as THREE.BufferGeometry[] };
  const south = new THREE.Vector3(0, 0, 1); // the north wall's room face points south (world +z)
  const upV = new THREE.Vector3(0, 1, 0);
  const nN = D - 0.32;
  const onWall = (x: number, h: number, count: number, size: number, lit = 0.18): void =>
    cluster(b, out, b.P(x, nN, h), south, count, size, lit, 0.85);
  const onFloor = (x: number, n: number, count: number, size: number, lit = 0.15): void =>
    cluster(b, out, b.P(x, n, 0), upV.clone().add(new THREE.Vector3(0, 0, 0.35)).normalize(), count, size, lit, 0.7);
  // the breach: heaped either side of the doorway, climbing the wall past the gate frame
  // (between the rib legs: the doorway's bay runs x 30.7–39.3)
  onWall(EXIT_X - 3.5, 0.3, 11, 2.1, 0.2);
  onWall(EXIT_X - 3.4, 2.8, 7, 1.5);
  onWall(EXIT_X - 3.7, 5.0, 5, 1.1);
  onWall(EXIT_X - 3.2, 7.2, 3, 0.8, 0.35);
  onWall(EXIT_X + 3.5, 0.3, 10, 1.9, 0.2);
  onWall(EXIT_X + 3.6, 2.6, 6, 1.3);
  onWall(EXIT_X + 3.4, 5.2, 4, 1.0, 0.35);
  onFloor(EXIT_X - 3.2, D - 1.2, 8, 1.5);
  onFloor(EXIT_X + 2.7, D - 1.1, 7, 1.2);
  // up the rib legs either side of the doorway (their faces toward the doorway and the room)
  for (const [x, s] of [[29.25, 1], [40.75, -1]] as const) {
    const side = new THREE.Vector3(s, 0, 0.6).normalize();
    // (only on the straight foot of the leg: higher up the arch leans in over the room)
    for (const [h, cnt, size] of [[0.4, 7, 1.4], [2.2, 6, 1.1], [3.8, 4, 0.8]] as const) {
      cluster(b, out, b.P(x + s * 1.45, D - 1.25, h), side, cnt, size, 0.18, 0.8);
    }
  }
  // round the Weaver's anchor (the second source) and along the foot of the north wall toward it
  onWall(22.5, 0.2, 6, 1.0);
  onWall(26.5, 1.4, 4, 0.8);
  onFloor(23.6, D - 0.9, 5, 0.8);
  // dark shards strewn on the floor below the breach (no glow: broken growth, the painting's black rubble)
  const shards = { dark: [] as THREE.BufferGeometry[], lit: [] as THREE.BufferGeometry[] };
  for (const [x, n, s] of [[31.6, 45.2, 0.45], [38.4, 45.6, 0.5], [33.6, 43.6, 0.35], [41.8, 44.2, 0.4], [28.2, 46.0, 0.4], [36.9, 44.6, 0.3]] as const) {
    cluster(b, shards, b.P(x, n, 0), new THREE.Vector3(rand() - 0.5, 0.6, rand() - 0.5).normalize(), 3, s, 0, 1.2);
  }

  const body = new THREE.MeshStandardMaterial({
    color: 0x180a26, emissive: 0x7a30e0, emissiveIntensity: 0.12, roughness: 0.12, metalness: 0.55, flatShading: true,
  });
  body.name = 'z08-crystal';
  const core = new THREE.MeshStandardMaterial({
    color: 0x2a1046, emissive: 0x9a4cff, emissiveIntensity: 0.85, roughness: 0.12, metalness: 0.3, flatShading: true,
  });
  core.name = 'z08-crystal-lit';
  const shard = new THREE.MeshStandardMaterial({ color: 0x0c0a12, emissive: 0x2a1060, emissiveIntensity: 0.2, roughness: 0.22, metalness: 0.4, flatShading: true });
  shard.name = 'z08-shard';
  S.owned.push(body, core, shard);
  add(b, out.dark, body, 'z08-crystals');
  add(b, out.lit, core, 'z08-crystals-lit');
  add(b, [...shards.dark, ...shards.lit], shard, 'z08-shards');
}
