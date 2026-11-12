/**
 * Z11 · the gallery's north side, polish 4 (the wound-overlook painting): the view, unobstructed.
 *
 *  - CLEAR GLASS. The kit's glass (opacity 0.12, env 1.3, rim) veiled the sky; its lattice roof crossed the Wound
 *    with dark, rust-lit beams, and the window's head frame and the lit rib in front of it drew a band through the
 *    Wound from the door. The kit wall and rib stay — hidden — for their colliders, exactly as before; what is seen
 *    is a zone-owned clear pane that runs from the floor up to the roof line and on across the north roof as one
 *    sheet, with no beams and no head band (only a hairline joint where the roof meets the stone ceiling).
 *  - THE PARAPET. Along the foot of the glass, the painting's solid black-stone balustrade: plinth, body, an
 *    overhanging cap with a fine gold line, and stout lantern posts with tall lit slits in gold frames (no post on
 *    the axis: the Wound sits clear between the two leads). It stands inside the glass wall's collider band
 *    (n 31.45…31.95; the collider is n 31.7…32.3): visual only, beyond where anyone can stand.
 *
 * The parapet is merged with `b.addStatic` (shared library materials); the glass is a clone the zone owns
 * (`Z11Space.owned`, disposed on unload). `wetMirror` is shared with Z12.
 */
import * as THREE from 'three';
import type { ZoneBuilder } from '@/core/api';
import { FACE } from '../shared';

/** the parapet's line and size (plan); the glass wall's centre line is n 32 */
const PAR = { n0: 31.45, n1: 31.95, h: 0.8 } as const;
/** lantern posts: x positions (none on the room's axis x 12) */
const POSTS = [0.62, 5.1, 9.7, 14.3, 18.9, 23.38];
/** the lantern light (warm white) */
const LANTERN = 0xffe6c0;

export interface WindowSpec {
  /** the room's x extent (inside faces of the side walls) and the glass line */
  x0: number; x1: number; n: number;
  /** wall height = the roof line; the roof glass runs south to `roofN` */
  h: number; roofN: number;
}

/** a zone-owned clear glass: the kit's glass made nearly invisible (a faint sheen only at grazing angles) */
export function clearGlass(b: ZoneBuilder): THREE.Material {
  const m = b.game.mats.clone('glass', { color: 0xffffff, opacity: 0.035, envMapIntensity: 0.35, rim: 0.18 });
  m.name = 'z11-clear-glass';
  return m;
}

/** the clear window and roof, the hairline joints, and the parapet with its lantern posts */
export function buildWindow(b: ZoneBuilder, o: WindowSpec, glass: THREE.Material): void {
  const mats = b.mats;
  const stone = mats.get('blackStone');
  const gold = mats.get('goldTrim');
  const dark = mats.get('goldDark');
  const g = new THREE.Group();
  g.name = 'z11-window';
  const w = o.x1 - o.x0;
  const cx = (o.x0 + o.x1) / 2;
  const box = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, n: number, h: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.copy(b.P(x, n, h));
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  // the glass: one sheet up the wall, one across the roof (faces into the room)
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, o.h), glass);
  wall.position.copy(b.P(cx, o.n, o.h / 2));
  wall.rotation.y = b.yaw(FACE.south);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, o.n - o.roofN), glass);
  roof.position.copy(b.P(cx, (o.n + o.roofN) / 2, o.h));
  roof.rotation.x = Math.PI / 2;
  for (const m of [wall, roof]) {
    m.renderOrder = 3;
    m.castShadow = false;
    g.add(m);
  }
  // a hairline joint where the roof glass meets the stone ceiling (none where the wall glass turns into the roof:
  // seen from the room it would be a line drawn through the Wound); slim end posts
  box(dark, w, 0.09, 0.12, cx, o.roofN + 0.06, o.h - 0.045);
  for (const x of [o.x0 + 0.06, o.x1 - 0.06]) box(dark, 0.12, o.h, 0.14, x, o.n, o.h / 2);

  // the parapet: plinth, body, overhanging cap, a fine gold line under the cap's lip and along the plinth
  const pd = PAR.n1 - PAR.n0;
  const pn = (PAR.n0 + PAR.n1) / 2;
  box(stone, w, 0.14, pd + 0.08, cx, pn - 0.04, 0.07);
  box(stone, w, PAR.h - 0.22, pd, cx, pn, 0.14 + (PAR.h - 0.22) / 2);
  box(stone, w, 0.09, pd + 0.12, cx, pn - 0.06, PAR.h - 0.035);
  box(gold, w, 0.018, 0.012, cx, PAR.n0 - 0.125, PAR.h - 0.085);
  box(gold, w, 0.014, 0.012, cx, PAR.n0 - 0.085, 0.145);
  // lantern posts: proud of the parapet, a little taller, a tall lit slit in a fine gold frame on the front face
  const lit = mats.emissive(LANTERN, 2.4);
  for (const x of POSTS) {
    const px = Math.min(o.x1 - 0.26, Math.max(o.x0 + 0.26, x));
    box(stone, 0.5, PAR.h + 0.26, pd + 0.16, px, pn - 0.05, (PAR.h + 0.26) / 2);
    box(stone, 0.58, 0.08, pd + 0.24, px, pn - 0.05, PAR.h + 0.3);
    const fn = PAR.n0 - 0.13;
    box(lit, 0.075, 0.56, 0.02, px, fn - 0.004, 0.32 + 0.28);
    for (const s of [-1, 1]) box(gold, 0.016, 0.62, 0.016, px + s * 0.058, fn - 0.006, 0.32 + 0.28);
    for (const hh of [0.29, 0.91]) box(gold, 0.132, 0.016, 0.016, px, fn - 0.006, hh);
  }
  b.addStatic(g);
}

/**
 * The floors read as wet black mirror marble (the painting's terrace): the kit's polished floors re-registered with
 * the renderer at a stronger, crisper reflection. Call after `b.finalize()`. (Z11 and Z12.)
 */
export function wetMirror(b: ZoneBuilder, strength: number, roughness: number): void {
  const render = b.game.render;
  if (typeof render?.registerReflectiveFloor !== 'function') return;
  const base = b.root.getWorldPosition(new THREE.Vector3()).y;
  b.root.traverse((o) => {
    const y = o.userData.kitReflectY;
    if (typeof y === 'number' && (o as THREE.Mesh).isMesh) render.registerReflectiveFloor(o as THREE.Mesh, { y: y + base, strength, roughness });
  });
}
