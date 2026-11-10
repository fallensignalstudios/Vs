/**
 * Departure craft (Z12) at human scale, parked side-on with the boarding door on the front (−Z) side.
 *   dominionShuttle        bronze / oxblood: a heavy armoured wedge with a dorsal spine, armour skirts, two big
 *                          nacelles and stub fins; amber light
 *   reformationTransport   navy / steel: three modules joined by collars, external pipe runs, pod engines on
 *                          outriggers, lift fans, skids, a sensor boom; cold blue-white light
 * `ramp` lowers the boarding ramp from closed (it is the door) to the ground; `engines` spins the glow up.
 * The nose points +X. The zone supplies the walkable ramp surface between `rampBottom` and `rampTop` if wanted.
 *
 * Draw calls: primary hull, secondary, dark parts, ramp, engine light, running lights = 6.
 */
import * as THREE from 'three';
import type { MaterialLibrary, MatId } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { clamp01 } from '@/core/mathx';
import { PropBase, rate, spring, type Glow } from './base';
import { Parts, prism } from './geo';

type Params = { engines: number; ramp: number };
type Kind = 'dominionShuttle' | 'reformationTransport';

interface Spec {
  primary: MatId; secondary: MatId; dark: MatId;
  light: number; engine: number;
  /** door sill height, hull half width at the door, ramp length and width */
  sill: number; half: number; rampLen: number; rampW: number;
}

const SPECS: Record<Kind, Spec> = {
  dominionShuttle: { primary: 'domBronze', secondary: 'domOxblood', dark: 'domBlack', light: PALETTE.domAmber, engine: 0xff8a3a, sill: 1.0, half: 2.5, rampLen: 3.0, rampW: 2.3 },
  reformationTransport: { primary: 'refNavy', secondary: 'refSteel', dark: 'refSlate', light: PALETTE.refBlue, engine: 0xbfe4ff, sill: 1.1, half: 2.3, rampLen: 3.2, rampW: 2.1 },
};

const X_AXIS: readonly [number, number, number] = [0, 0, Math.PI / 2];

function buildDominion(P: Parts, s: Spec): void {
  const hw = s.half;
  // armoured wedge: chin, blunt nose, raked windshield, long roof, stepped tail
  P.add('pri', prism([[-6.3, 1.5], [-4.6, 0.95], [4.2, 0.95], [6.2, 1.5], [7.0, 2.3], [6.0, 3.1], [4.6, 3.9], [1.5, 4.35], [-3.8, 4.35], [-6.0, 3.6], [-6.5, 2.6]], hw * 2, 0.16));
  // dorsal spine and its crest
  P.add('sec', prism([[-5.0, 4.25], [2.2, 4.25], [3.8, 3.95], [1.6, 4.85], [-4.3, 4.85]], 1.5, 0.08));
  P.add('pri', prism([[-4.0, 4.8], [1.2, 4.8], [0.6, 5.1], [-3.6, 5.1]], 0.5, 0.05));
  for (const sz of [-1, 1]) {
    // armour skirts (split around the door on the boarding side), shoulder plates, belly keels
    if (sz > 0) P.add('sec', prism([[-5.2, 1.25], [3.8, 1.25], [4.6, 1.9], [3.6, 2.85], [-5.0, 2.85]], 0.24, 0.05), { p: [0, 0, sz * (hw + 0.08)] });
    else {
      P.add('sec', prism([[-5.2, 1.25], [-1.75, 1.25], [-1.75, 2.85], [-5.0, 2.85]], 0.24, 0.05), { p: [0, 0, sz * (hw + 0.08)] });
      P.add('sec', prism([[1.75, 1.25], [3.8, 1.25], [4.6, 1.9], [3.6, 2.85], [1.75, 2.85]], 0.24, 0.05), { p: [0, 0, sz * (hw + 0.08)] });
    }
    P.add('sec', prism([[-3.6, 0], [3.4, 0], [4.3, 0.55], [1.5, 1.0], [-3.4, 1.0]], 0.2, 0.05), { p: [0, 3.2, sz * (hw - 0.02)], r: [sz * -0.42, 0, 0] });
    P.bevel('pri', 8.6, 0.3, 0.5, 0.06, { p: [-0.2, 1.0, sz * 1.5] });
    for (const x of [-4.2, -2.6, 2.6]) P.bevel('pri', 0.16, 1.5, 0.1, 0.02, { p: [x, 2.05, sz * (hw + 0.2)] });
    // nacelle with intake lip, nozzle shroud, pylon, stub fin
    P.cyl('pri', 0.95, 0.95, 3.3, 16, { p: [-5.1, 2.55, sz * (hw + 0.75)], r: X_AXIS });
    P.cyl('sec', 1.03, 1.03, 0.5, 16, { p: [-3.75, 2.55, sz * (hw + 0.75)], r: X_AXIS });
    P.cyl('dark', 0.82, 1.0, 0.55, 16, { p: [-6.95, 2.55, sz * (hw + 0.75)], r: X_AXIS }, 0xffffff, false, true);
    P.cyl('dark', 0.78, 0.78, 0.5, 16, { p: [-6.6, 2.55, sz * (hw + 0.75)], r: X_AXIS });
    P.cyl('dark', 0.7, 0.7, 0.08, 16, { p: [-3.47, 2.55, sz * (hw + 0.75)], r: X_AXIS });
    P.bevel('pri', 2.2, 0.5, 0.9, 0.08, { p: [-5.0, 2.6, sz * (hw + 0.1)] });
    P.add('sec', prism([[-6.4, 0], [-4.2, 0], [-5.0, 1.5], [-6.6, 1.7]], 0.14, 0.03), { p: [0, 3.2, sz * (hw + 0.85)], r: [sz * 0.5, 0, 0] });
    P.cyl('eng', 0.7, 0.7, 0.06, 20, { p: [-6.88, 2.55, sz * (hw + 0.75)], r: X_AXIS }, 0x8a8a8a);
    P.add('eng', new THREE.TorusGeometry(0.5, 0.05, 6, 24), { p: [-6.93, 2.55, sz * (hw + 0.75)], r: [0, Math.PI / 2, 0] });
    P.cyl('eng', 0.16, 0.3, 0.12, 16, { p: [-6.93, 2.55, sz * (hw + 0.75)], r: X_AXIS });
    // running lights under the skirt line, a marker on the nacelle
    P.box('lit', 3.0, 0.05, 0.03, { p: [-3.4, 1.17, sz * (hw + 0.21)] }, 0x9a9a9a);
    if (sz > 0) P.box('lit', 3.0, 0.05, 0.03, { p: [1.6, 1.17, sz * (hw + 0.21)] }, 0x9a9a9a);
    P.box('lit', 0.5, 0.08, 0.03, { p: [-4.6, 3.1, sz * (hw + 1.69)] });
    // rear gear
    P.cyl('dark', 0.13, 0.16, 1.1, 8, { p: [-3.4, 0.6, sz * 1.9] });
    P.cyl('dark', 0.07, 0.07, 1.3, 6, { p: [-2.9, 0.75, sz * 1.9], r: [0, 0, 0.7] });
    P.bevel('dark', 1.0, 0.12, 0.75, 0.03, { p: [-3.4, 0.06, sz * 1.9] });
  }
  // nose gear, windshield, brow, nose lamp
  P.cyl('dark', 0.13, 0.16, 1.1, 8, { p: [4.1, 0.6, 0] });
  P.bevel('dark', 1.0, 0.12, 0.8, 0.03, { p: [4.1, 0.06, 0] });
  P.bevel('dark', 1.55, 0.1, hw * 2 - 1.1, 0.03, { p: [5.3, 3.53, 0], r: [0, 0, -0.52] });
  P.bevel('sec', 0.3, 0.16, hw * 2 - 0.7, 0.04, { p: [4.5, 4.0, 0], r: [0, 0, -0.52] });
  P.box('lit', 0.04, 0.07, 1.6, { p: [7.02, 2.25, 0] });
  // doorway: dark interior, frame, light above it and down both jambs
  P.box('dark', 2.5, 2.35, 0.1, { p: [0, s.sill + 1.175, -hw - 0.02] });
  P.bevel('pri', 2.9, 0.22, 0.22, 0.04, { p: [0, s.sill + 2.46, -hw + 0.03] });
  for (const sx of [-1, 1]) P.bevel('pri', 0.22, 2.5, 0.22, 0.04, { p: [sx * 1.36, s.sill + 1.2, -hw + 0.03] });
  P.box('lit', 2.0, 0.06, 0.04, { p: [0, s.sill + 2.3, -hw - 0.075] });
  for (const sx of [-1, 1]) P.box('lit', 0.05, 1.7, 0.04, { p: [sx * 1.2, s.sill + 1.25, -hw - 0.075] }, 0x8a8a8a);
}

function buildReformation(P: Parts, s: Spec): void {
  const hw = s.half, w = hw * 2;
  // three modules: engine block, cabin, cockpit
  P.add('pri', prism([[-7.0, 1.7], [-6.4, 1.1], [-3.45, 1.1], [-3.45, 4.0], [-6.2, 4.0], [-7.0, 3.3]], w, 0.1));
  P.add('pri', prism([[-3.15, 1.1], [2.55, 1.1], [2.55, 4.0], [-3.15, 4.0]], w, 0.1));
  P.add('pri', prism([[2.85, 1.1], [5.6, 1.1], [7.0, 1.9], [7.0, 2.5], [5.2, 4.0], [2.85, 4.0]], w, 0.1));
  // connector collars and their bolt bands
  for (const x of [-3.3, 2.7]) {
    P.bevel('sec', 0.32, 3.1, w + 0.2, 0.04, { p: [x, 2.55, 0] });
    P.bevel('dark', 0.1, 3.2, w + 0.26, 0.02, { p: [x, 2.55, 0] });
  }
  // roof equipment: spine tray, sensor boom and dish, hatches
  P.bevel('dark', 8.6, 0.14, 1.3, 0.03, { p: [-1.0, 4.06, 0] });
  P.bevel('sec', 1.3, 0.2, 0.9, 0.04, { p: [-0.6, 4.2, 0] });
  P.cyl('sec', 0.05, 0.07, 1.7, 6, { p: [-4.6, 4.9, 0.5] });
  P.cyl('sec', 0.45, 0.1, 0.16, 16, { p: [-4.6, 5.75, 0.5], r: [0.5, 0, 0] });
  P.cyl('sec', 0.03, 0.03, 1.2, 5, { p: [3.4, 4.6, -0.7], r: [0, 0, -0.5] });
  for (const sz of [-1, 1]) {
    // exposed pipe runs along the roof edge with junction boxes; panel seams; module skirts
    P.cyl('sec', 0.09, 0.09, 9.2, 8, { p: [-1.6, 3.86, sz * (hw + 0.1)], r: X_AXIS });
    P.cyl('dark', 0.055, 0.055, 9.2, 6, { p: [-1.6, 3.64, sz * (hw + 0.07)], r: X_AXIS });
    for (const x of [-5.4, -2.2, 1.4]) P.bevel('sec', 0.5, 0.42, 0.22, 0.03, { p: [x, 3.74, sz * (hw + 0.1)] });
    for (const x of [-5.0, -1.95, 1.75, 4.0]) P.bevel('dark', 0.05, 2.2, 0.05, 0.01, { p: [x, 2.35, sz * (hw + 0.01)] });
    P.bevel('dark', 13.0, 0.18, 0.1, 0.03, { p: [-0.4, 1.22, sz * (hw + 0.02)] });
    // cabin windows on the far side, a porthole pair forward
    if (sz > 0) for (const x of [-2.2, -0.9, 0.4, 1.7]) P.bevel('dark', 0.8, 0.5, 0.06, 0.03, { p: [x, 3.0, sz * (hw + 0.01)] });
    P.bevel('dark', 0.7, 0.45, 0.06, 0.03, { p: [3.9, 3.05, sz * (hw + 0.01)] });
    // pod engine on an outrigger: pod, intake ring, nozzle, two struts and a feed pipe
    P.cyl('pri', 0.7, 0.7, 2.5, 14, { p: [-5.2, 2.6, sz * (hw + 1.0)], r: X_AXIS });
    P.cyl('sec', 0.76, 0.76, 0.3, 14, { p: [-4.1, 2.6, sz * (hw + 1.0)], r: X_AXIS });
    P.cyl('sec', 0.6, 0.74, 0.45, 14, { p: [-6.6, 2.6, sz * (hw + 1.0)], r: X_AXIS }, 0xffffff, false, true);
    P.cyl('dark', 0.58, 0.58, 0.3, 14, { p: [-6.52, 2.6, sz * (hw + 1.0)], r: X_AXIS }, 0x30343a);
    for (const x of [-5.9, -4.6]) P.bevel('sec', 0.22, 0.14, 0.6, 0.03, { p: [x, 2.6, sz * (hw + 0.3)] });
    P.cyl('dark', 0.05, 0.05, 0.9, 6, { p: [-5.25, 3.0, sz * (hw + 0.4)], r: [Math.PI / 2 - sz * 0.45, 0, 0] });
    P.cyl('eng', 0.5, 0.5, 0.05, 18, { p: [-6.7, 2.6, sz * (hw + 1.0)], r: X_AXIS }, 0x6a6a6a);
    P.add('eng', new THREE.TorusGeometry(0.42, 0.045, 6, 24), { p: [-6.74, 2.6, sz * (hw + 1.0)], r: [0, Math.PI / 2, 0] });
    P.add('eng', new THREE.TorusGeometry(0.2, 0.035, 6, 20), { p: [-6.74, 2.6, sz * (hw + 1.0)], r: [0, Math.PI / 2, 0] });
    // forward lift fan in a ring housing
    P.cyl('sec', 0.62, 0.62, 0.3, 16, { p: [4.2, 1.45, sz * (hw + 0.45)] });
    P.cyl('dark', 0.5, 0.5, 0.32, 16, { p: [4.2, 1.45, sz * (hw + 0.45)] });
    P.cyl('eng', 0.42, 0.42, 0.03, 16, { p: [4.2, 1.285, sz * (hw + 0.45)] }, 0x5a5a5a);
    P.bevel('sec', 0.5, 0.16, 0.5, 0.03, { p: [4.2, 1.5, sz * (hw + 0.02)] });
    // skid on four struts
    P.bevel('dark', 9.4, 0.12, 0.34, 0.03, { p: [-0.6, 0.06, sz * 1.75] });
    for (const x of [-4.4, -1.6, 1.2, 3.6]) P.cyl('sec', 0.06, 0.07, 1.1, 6, { p: [x, 0.62, sz * 1.75], r: [sz * 0.12, 0, 0] });
    // running lights: one thin line per module, a wingtip marker
    for (const [x, len] of [[-5.1, 2.4], [-0.3, sz > 0 ? 4.8 : 0], [4.2, 2.0]] as const) if (len > 0) P.box('lit', len, 0.045, 0.03, { p: [x, 1.42, sz * (hw + 0.035)] }, 0x9a9a9a);
    P.box('lit', 0.3, 0.07, 0.03, { p: [-5.2, 2.6, sz * (hw + 1.71)] });
  }
  // canopy glass on the cockpit slope, a brow sensor bar, nose lamp
  P.bevel('dark', 2.2, 0.08, w - 0.7, 0.03, { p: [6.05, 3.28, 0], r: [0, 0, -0.695] });
  P.bevel('sec', 0.2, 0.12, w - 0.3, 0.03, { p: [5.15, 4.03, 0] });
  P.box('lit', 0.04, 0.05, 1.8, { p: [7.02, 2.2, 0] });
  // doorway
  P.box('dark', 2.3, 2.3, 0.1, { p: [0, s.sill + 1.15, -hw - 0.02] }, 0x1c2026);
  P.bevel('sec', 2.7, 0.16, 0.2, 0.03, { p: [0, s.sill + 2.4, -hw + 0.02] });
  for (const sx of [-1, 1]) P.bevel('sec', 0.16, 2.45, 0.2, 0.03, { p: [sx * 1.27, s.sill + 1.18, -hw + 0.02] });
  P.box('lit', 1.9, 0.05, 0.04, { p: [0, s.sill + 2.26, -hw - 0.06] });
  for (const sx of [-1, 1]) for (const y of [0.5, 1.2, 1.9]) P.box('lit', 0.05, 0.22, 0.04, { p: [sx * 1.12, s.sill + y, -hw - 0.06] }, 0x8a8a8a);
}

/** Ramp in its hinge frame: hinge along X at the origin, the plate reaching +Y when closed, its outside facing −Z. */
function buildRamp(P: Parts, s: Spec, dominion: boolean): void {
  const L = s.rampLen, W = s.rampW;
  P.bevel('ramp', W, L, 0.14, 0.03, { p: [0, L / 2, 0] });
  // outside: armour panel / module panel with a frame; inside: treads and side lips
  P.bevel('ramp', W - 0.36, L - 0.5, 0.05, 0.015, { p: [0, L / 2, -0.085] }, dominion ? 0xa0404a : 0xc8d0da);
  for (const y of dominion ? [0.6, L - 0.6] : [0.5, L / 2, L - 0.5]) P.bevel('ramp', W - 0.2, 0.08, 0.03, 0.008, { p: [0, y, -0.118] }, dominion ? 0xffffff : 0x56626f);
  for (let k = 0; k < 9; k++) P.box('ramp', W - 0.36, 0.05, 0.02, { p: [0, 0.3 + (k * (L - 0.55)) / 8, 0.078] }, 0x3a3a3a);
  for (const sx of [-1, 1]) P.bevel('ramp', 0.08, L - 0.1, 0.12, 0.02, { p: [sx * (W / 2 - 0.04), L / 2, 0.11] }, dominion ? 0xffffff : 0xdfe6ee);
  P.cyl('ramp', 0.09, 0.09, W + 0.16, 10, { p: [0, 0, 0], r: X_AXIS }, 0x3a3a3a);
}

export class DepartureShip extends PropBase<Params> {
  private readonly eng: Glow;
  private readonly lit: Glow;
  private readonly rampPivot = new THREE.Group();
  private readonly openAngle: number;

  constructor(lib: MaterialLibrary | null, kind: Kind) {
    super(`departureShip.${kind}`, lib, { engines: 0, ramp: 0 }, { engines: spring(2.2, 0.9), ramp: rate(2.8) });
    const s = SPECS[kind] ?? SPECS.dominionShuttle;
    const dom = kind !== 'reformationTransport';
    const P = new Parts();
    if (dom) buildDominion(P, s); else buildReformation(P, s);
    buildRamp(P, s, dom);

    const primary = this.mk.solid(s.primary);
    this.eng = this.mk.glow(s.engine, 0, true);
    this.lit = this.mk.glow(s.light, 2, true);
    const ramp = P.mesh('ramp', primary);
    this.rampPivot.name = 'ramp';
    this.rampPivot.position.set(0, s.sill, -s.half - 0.15);
    this.rampPivot.add(ramp);
    this.openAngle = -(Math.PI / 2 + Math.asin(Math.min(0.95, (s.sill - 0.07) / s.rampLen)));
    this.object.add(
      P.mesh('pri', primary), P.mesh('sec', this.mk.solid(s.secondary)), P.mesh('dark', this.mk.solid(s.dark)),
      this.rampPivot, P.mesh('eng', this.eng.material, false), P.mesh('lit', this.lit.material, false),
    );

    const reach = s.half + 0.15 + Math.sqrt(Math.max(0, s.rampLen * s.rampLen - s.sill * s.sill));
    this.addSocket('rampTop', 0, s.sill, -s.half - 0.2, Math.PI);
    this.addSocket('rampBottom', 0, 0, -reach - 0.35, Math.PI);
    this.addSocket('door', 0, s.sill, -s.half + 0.6, Math.PI);
    this.addSocket('engines', -6.9, 2.55, 0, Math.PI / 2);
    this.addCollider({ kind: 'box', hx: 6.8, hy: 2.3, hz: s.half }, 0.1, 2.3, 0);
    for (const sz of [-1, 1]) this.addCollider({ kind: 'box', hx: 1.8, hy: 1.1, hz: 0.9 }, -5.2, 2.5, sz * (s.half + 0.85));
    this.ready();
  }

  protected apply(_dt: number, time: number): void {
    const e = clamp01(this.cur.engines), r = clamp01(this.cur.ramp);
    // the ramp eases down, touches, lifts a hand's width and settles
    const c = r < 0.5 ? 4 * r * r * r : 1 - Math.pow(-2 * r + 2, 3) / 2;
    const k = clamp01((r - 0.86) / 0.14);
    this.rampPivot.rotation.x = this.openAngle * (c - 0.012 * Math.sin(Math.PI * k) * (1 - k) * 4);
    const flutter = 1 + 0.07 * e * Math.sin(time * 31) * Math.sin(time * 12.7);
    this.eng.set((0.08 + 5.6 * e * e) * flutter);
    this.lit.set(1.6 + 0.5 * Math.sin(time * 1.7) + 0.9 * e);
  }
}
