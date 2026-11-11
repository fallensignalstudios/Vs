/**
 * Z06 — dressing toward the quarantine painting (pdf/ref-concept-quarantine.png, which sets the Z06–Z08
 * interiors): pairs of gold lines up the white-gold walls between the rib legs, and violet crystal growth round
 * the two breaches (the real sources: violet nowhere else).
 *
 * Visual only: no collider, no nav change, no light. Static, so finalize() merges it by material. The crystal
 * materials are the zone's own and are released with the zone state.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ZoneBuilder } from '@/core/api';
import { GOLD } from '../shared';
import { BREACH_A, BREACH_B, D, W } from './layout';
import { S } from './state';

/** the walls' room faces (0.6 m thick on their plan line) plus a 5 cm stand-off */
const FACE = 0.35;
const WALL_TOP = 12;
/** mid-bays between the rib legs (ribs every 8 m from x 4), clear of the breach in that wall */
const BAYS_N = [8, 16, 24, 32, 48] as const;
const BAYS_S = [8, 16, 24, 32, 40] as const;
/** the end walls, clear of the doors, the exit pylons and the refuge */
const SIDE_W = [14, 29] as const;
const SIDE_E = [8, 14, 31] as const;

/** the growth's own seeded stream: the zone's `b.rand()` also places prop variants and their colliders */
let seed = 0x06b2e1;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function buildDressing(b: ZoneBuilder): void {
  seed = 0x06b2e1;
  const gold: THREE.BufferGeometry[] = [];
  // a vertical bar on an east–west wall (thin side toward the room along world z) or a north–south one (along x)
  const bar = (x: number, n: number, ew: boolean): void => {
    const geo = ew ? new THREE.BoxGeometry(0.09, WALL_TOP - 0.95, 0.04) : new THREE.BoxGeometry(0.04, WALL_TOP - 0.95, 0.09);
    const p = b.P(x, n, (WALL_TOP + 0.45 - 0.5) / 2);
    gold.push(geo.translate(p.x, p.y, p.z));
  };
  for (const x of BAYS_N) for (const s of [-1, 1]) bar(x + s * 0.6, D - FACE, true);
  for (const x of BAYS_S) for (const s of [-1, 1]) bar(x + s * 0.6, FACE, true);
  for (const n of SIDE_W) for (const s of [-1, 1]) bar(FACE, n + s * 0.6, false);
  for (const n of SIDE_E) for (const s of [-1, 1]) bar(W - FACE, n + s * 0.6, false);
  add(b, gold, b.mats.emissive(GOLD, 2.0), 'z06-inlay');

  // violet crystal growth heaped either side of each breach and climbing its jambs
  const out = { dark: [] as THREE.BufferGeometry[], lit: [] as THREE.BufferGeometry[] };
  const south = new THREE.Vector3(0, 0, 1);
  const north = new THREE.Vector3(0, 0, -1);
  const up = new THREE.Vector3(0, 1, 0);
  const a = BREACH_A.x;
  const an = D - 0.32;
  for (const [x, h, c, s] of [[a - 2.7, 0.3, 9, 1.6], [a - 2.9, 2.5, 6, 1.2], [a - 3.4, 4.6, 4, 0.9], [a + 2.7, 0.3, 8, 1.5], [a + 3.0, 2.8, 5, 1.0]] as const) {
    cluster(out, b.P(x, an, h), south, c, s, 0.3, 0.85);
  }
  cluster(out, b.P(a - 2.4, D - 1.0, 0), up.clone().add(new THREE.Vector3(0, 0, 0.35)).normalize(), 6, 1.1, 0.2, 0.7);
  const bx = BREACH_B.x;
  const bn = 0.32;
  for (const [x, h, c, s] of [[bx - 2.7, 0.3, 8, 1.4], [bx - 3.0, 2.6, 5, 1.0], [bx + 2.7, 0.3, 8, 1.5], [bx + 2.9, 2.4, 5, 1.1], [bx + 3.3, 4.4, 3, 0.8]] as const) {
    cluster(out, b.P(x, bn, h), north, c, s, 0.3, 0.85);
  }
  const body = new THREE.MeshStandardMaterial({
    color: 0x241034, emissive: 0x8236e8, emissiveIntensity: 0.22, roughness: 0.14, metalness: 0.4, flatShading: true,
  });
  body.name = 'z06-crystal';
  const core = new THREE.MeshStandardMaterial({
    color: 0x3a1858, emissive: 0x9a4cff, emissiveIntensity: 1.15, roughness: 0.12, metalness: 0.25, flatShading: true,
  });
  core.name = 'z06-crystal-lit';
  S.owned.push(body, core);
  add(b, out.dark, body, 'z06-crystals');
  add(b, out.lit, core, 'z06-crystals-lit');
}

function add(b: ZoneBuilder, geos: THREE.BufferGeometry[], mat: THREE.Material, name: string): void {
  if (!geos.length) return;
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  for (const g of new Set([...geos, ...flat])) g.dispose();
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  b.add(mesh);
}

/** one faceted crystal: a six-sided prism tapering to a point, base at the origin, along +Y */
function crystal(len: number, r: number): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0, -0.05), new THREE.Vector2(r, 0), new THREE.Vector2(r * 0.82, len * 0.72), new THREE.Vector2(0, len)];
  return new THREE.LatheGeometry(pts, 6).toNonIndexed();
}

/** crystals fanned round the surface normal `nrm` from `at`; `lit` = the share drawn with the bright material */
function cluster(
  out: { dark: THREE.BufferGeometry[]; lit: THREE.BufferGeometry[] },
  at: THREE.Vector3, nrm: THREE.Vector3, count: number, size: number, lit: number, spread: number,
): void {
  const yAxis = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(nrm, Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : yAxis).normalize();
  const bit = new THREE.Vector3().crossVectors(nrm, tangent);
  for (let i = 0; i < count; i++) {
    const az = rand() * Math.PI * 2;
    const tilt = Math.pow(rand(), 0.8) * spread;
    const dir = nrm.clone().multiplyScalar(Math.cos(tilt))
      .addScaledVector(tangent, Math.sin(tilt) * Math.cos(az))
      .addScaledVector(bit, Math.sin(tilt) * Math.sin(az))
      .normalize();
    const k = 1 - tilt / (spread + 0.01);
    const len = size * (0.35 + 0.65 * rand()) * (0.55 + 0.45 * k);
    const geo = crystal(len, len * (0.11 + 0.06 * rand()));
    const base = at.clone()
      .addScaledVector(tangent, (rand() - 0.5) * size * 0.55)
      .addScaledVector(bit, (rand() - 0.5) * size * 0.55)
      .addScaledVector(nrm, -0.04);
    const q = new THREE.Quaternion().setFromUnitVectors(yAxis, dir).multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, rand() * Math.PI));
    geo.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
    (rand() < lit ? out.lit : out.dark).push(geo);
  }
}
