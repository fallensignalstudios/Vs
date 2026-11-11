/**
 * Departure craft (Z12) at human scale, parked side-on with the boarding door on the front (−Z) side.
 *   dominionShuttle        the generated Dominion shuttle (ship_dominion_shuttle.glb): scored bronze plates, stubby
 *                          wings, four rear crown engines, five lift thrusters; amber light
 *   reformationTransport   the generated Reformation dropship (ship_reformation_dropship.glb) on landing struts:
 *                          navy-and-silver wedge, engine pods on the wing roots, its side hatch is the door; cold
 *                          blue-white light
 * `ramp` lowers the boarding ramp from closed (it is the door) to the ground; `engines` spins the glow up;
 * `escort` (integration wave) brings an escort flight in around the craft once it has left (see EscortFlight).
 * The nose points +X. The zone supplies the walkable ramp surface between `rampBottom` and `rampTop` if wanted.
 *
 * GENERATED vs PROCEDURAL. The generated hull loads asynchronously (`ready`); until then — and for good if the file
 * cannot be had — the original procedural craft stands in (bronze armoured wedge / three-module navy transport),
 * shifted so that ITS doorway lines up with the generated one: sockets, ramp and colliders are fixed at
 * construction and never move.
 *
 * BERTH SCALE. The forge's nominal lengths (shuttle 18 m, dropship 22 m, wingspans 19 / 22 m) do not fit the Z12
 * berths (42 × 24 m hangar: the dropship would stand through the east wall and both would reach over the open
 * edge), so the prop draws them at 14.4 m and 15 m — the footprint of the procedural craft (≈ 14.5 m).
 *
 * Draw calls: procedural — primary hull, secondary, dark parts, ramp, engine light, running lights = 6;
 * generated — hull, engine glow, ramp, door + gear, door lights = 5 (+ 2 per escort).
 */
import * as THREE from 'three';
import type { MaterialLibrary, MatId } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { clamp01 } from '@/core/mathx';
import { PropBase, rate, spring, type Glow } from './base';
import { Parts, prism } from './geo';
import { EscortFlight, type EscortOpts } from './ships/escort';
import { GeneratedShip } from './ships/model';
import type { ShipModelId } from './ships/catalog';

type Params = { engines: number; ramp: number; escort: number };
type Kind = 'dominionShuttle' | 'reformationTransport';

/**
 * Where the generated craft's door is and how it stands on the floor (prop frame: nose +X, door on −Z; metres).
 * Measured from the files (scratchpad ships-int/profile.mjs) at the berth length.
 */
interface Berth {
  model: ShipModelId;
  length: number;
  /** landing-gear height under the hull (0 = it rests on its own lowest part) */
  lift: number;
  /** door: centre along X, hull face depth (−Z), sill height, opening width / height */
  door: { x: number; face: number; sill: number; w: number; h: number };
  ramp: { len: number; w: number };
  /** the procedural fallback hull is moved by this so its doorway lines up with `door` */
  procOffset: readonly [number, number, number];
  /** collider boxes [hx, hy, hz, x, y, z] */
  boxes: ReadonlyArray<readonly [number, number, number, number, number, number]>;
  /** engine socket (x, y) */
  engines: readonly [number, number];
  /** landing struts (x, z) */
  gear: ReadonlyArray<readonly [number, number]>;
}

const BERTHS: Record<Kind, Berth> = {
  // shuttle at 14.4 m: wings at x −3.3…0.9 out to z ±7.7 (1.85–2.65 m up), flat forward flank for the door
  dominionShuttle: {
    model: 'dominionShuttle', length: 14.4, lift: 0,
    door: { x: 2.2, face: 2.2, sill: 1.04, w: 1.6, h: 2.08 }, ramp: { len: 2.1, w: 1.5 },
    procOffset: [2.2, 0.04, 0.3],
    boxes: [[7.2, 2.3, 2.15, 0, 2.3, 0], [2.1, 1.35, 2.75, -1.2, 1.35, 4.9], [2.1, 1.35, 2.75, -1.2, 1.35, -4.9]],
    engines: [-7.2, 2.95], gear: [],
  },
  // dropship at 15 m on 0.95 m struts: the side hatch on the rear-quarter pod (x −5.6…−3.1) is the door; wings
  // 3.7 m up (walkable under), pods on the wing roots
  reformationTransport: {
    model: 'reformationDropship', length: 15, lift: 0.95,
    door: { x: -4.36, face: 2.96, sill: 1.08, w: 2.0, h: 2.4 }, ramp: { len: 2.4, w: 1.9 },
    procOffset: [-4.36, -0.02, -0.66],
    boxes: [[7.5, 2.5, 2.1, 0, 2.5, 0], [1.27, 1.7, 2.95, -4.36, 2.6, 0]],
    engines: [-7.5, 4.2], gear: [[4.6, 1.3], [4.6, -1.3], [-1.6, 1.6], [-1.6, -1.6]],
  },
};

interface Spec {
  primary: MatId; secondary: MatId; dark: MatId;
  light: number; engine: number;
  /** door sill height and hull half width at the procedural doorway */
  sill: number; half: number;
}

const SPECS: Record<Kind, Spec> = {
  dominionShuttle: { primary: 'domBronze', secondary: 'domOxblood', dark: 'domBlack', light: PALETTE.domAmber, engine: 0xff8a3a, sill: 1.0, half: 2.5 },
  reformationTransport: { primary: 'refNavy', secondary: 'refSteel', dark: 'refSlate', light: PALETTE.refBlue, engine: 0xbfe4ff, sill: 1.1, half: 2.3 },
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
function buildRamp(P: Parts, L: number, W: number, dominion: boolean): void {
  P.bevel('ramp', W, L, 0.14, 0.03, { p: [0, L / 2, 0] });
  // outside: armour panel / module panel with a frame; inside: treads and side lips
  P.bevel('ramp', W - 0.36, L - 0.5, 0.05, 0.015, { p: [0, L / 2, -0.085] }, dominion ? 0xa0404a : 0xc8d0da);
  for (const y of dominion ? [0.6, L - 0.6] : [0.5, L / 2, L - 0.5]) P.bevel('ramp', W - 0.2, 0.08, 0.03, 0.008, { p: [0, y, -0.118] }, dominion ? 0xffffff : 0x56626f);
  for (let k = 0; k < 9; k++) P.box('ramp', W - 0.36, 0.05, 0.02, { p: [0, 0.3 + (k * (L - 0.55)) / 8, 0.078] }, 0x3a3a3a);
  for (const sx of [-1, 1]) P.bevel('ramp', 0.08, L - 0.1, 0.12, 0.02, { p: [sx * (W / 2 - 0.04), L / 2, 0.11] }, dominion ? 0xffffff : 0xdfe6ee);
  P.cyl('ramp', 0.09, 0.09, W + 0.16, 10, { p: [0, 0, 0], r: X_AXIS }, 0x3a3a3a);
}

/**
 * ADDED (integration wave): what `game.props.departureShip()` returns — the hero prop plus the generated craft's
 * state and its escort (see `DepartureShipProp` in @/core/api/kit).
 */
export class DepartureShip extends PropBase<Params> {
  /** resolves true once the generated hull is on screen (false: the procedural craft stays) */
  readonly whenLoaded: Promise<boolean>;
  private readonly eng: Glow;
  private readonly lit: Glow;
  private readonly rampPivot = new THREE.Group();
  private readonly openAngle: number;
  private readonly proc = new THREE.Group();
  private readonly gen: GeneratedShip;
  private readonly berth: Berth;
  private readonly spec: Spec;
  private escortFlight: EscortFlight | null = null;
  private escortOpts: EscortOpts = {};
  private extras: THREE.Group | null = null;

  constructor(lib: MaterialLibrary | null, kind: Kind) {
    super(`departureShip.${kind}`, lib, { engines: 0, ramp: 0, escort: 0 }, { engines: spring(2.2, 0.9), ramp: rate(2.8), escort: rate(7) });
    const k: Kind = kind === 'reformationTransport' ? 'reformationTransport' : 'dominionShuttle';
    const s = SPECS[k];
    const b = BERTHS[k];
    this.spec = s;
    this.berth = b;
    const dom = k !== 'reformationTransport';
    const P = new Parts();
    if (dom) buildDominion(P, s); else buildReformation(P, s);
    buildRamp(P, b.ramp.len, b.ramp.w, dom);

    const primary = this.mk.solid(s.primary);
    this.eng = this.mk.glow(s.engine, 0, true);
    this.lit = this.mk.glow(s.light, 2, true);
    const ramp = P.mesh('ramp', primary);
    this.rampPivot.name = 'ramp';
    this.rampPivot.position.set(b.door.x, b.door.sill, -b.door.face - 0.05);
    this.rampPivot.add(ramp);
    this.openAngle = -(Math.PI / 2 + Math.asin(Math.min(0.95, (b.door.sill - 0.07) / b.ramp.len)));
    // the procedural craft: built around its own doorway (x 0, depth s.half), moved onto the berth's
    this.proc.name = 'procedural';
    this.proc.position.set(...b.procOffset);
    this.proc.add(
      P.mesh('pri', primary), P.mesh('sec', this.mk.solid(s.secondary)), P.mesh('dark', this.mk.solid(s.dark)),
      P.mesh('eng', this.eng.material, false), P.mesh('lit', this.lit.material, false),
    );
    this.object.add(this.proc, this.rampPivot);

    // the generated craft (async); on success the procedural one is hidden and the door / gear dressing appears
    this.gen = new GeneratedShip(b.model, { length: b.length, frame: 'plusX', origin: 'ground', lift: b.lift, engines: 0, lights: 1 });
    this.object.add(this.gen.object);
    this.whenLoaded = this.gen.ready.then((ok) => {
      if (ok) this.useGenerated();
      return ok;
    });
    if (this.gen.loaded) this.useGenerated();

    const reach = b.door.face + 0.15 + Math.sqrt(Math.max(0, b.ramp.len * b.ramp.len - b.door.sill * b.door.sill));
    this.addSocket('rampTop', b.door.x, b.door.sill, -b.door.face - 0.2, Math.PI);
    this.addSocket('rampBottom', b.door.x, 0, -reach - 0.35, Math.PI);
    this.addSocket('door', b.door.x, b.door.sill, -b.door.face + 0.6, Math.PI);
    this.addSocket('engines', b.engines[0], b.engines[1], 0, Math.PI / 2);
    for (const [hx, hy, hz, x, y, z] of b.boxes) this.addCollider({ kind: 'box', hx, hy, hz }, x, y, z);
    this.ready();
  }

  /** true once the generated hull is shown */
  get generated(): boolean { return this.gen.loaded; }

  /** hull length in metres */
  get length(): number { return this.berth.length; }

  /** the escort craft (empty until `escort` is first raised) */
  escortCraft(): THREE.Object3D[] { return this.escortFlight?.craft ?? []; }

  /**
   * Shape the escort before it is first raised: count 1…6 (default 4), spread 0.5…3 (default 1), escort length
   * (default the craft's). Ignored once the escort exists.
   */
  configureEscort(opts: EscortOpts): void {
    if (!this.escortFlight && opts && typeof opts === 'object') this.escortOpts = { ...opts };
  }

  override dispose(): void {
    // generated hulls share their template geometry: take them out before the prop disposes its own
    this.escortFlight?.dispose();
    this.escortFlight = null;
    this.gen.dispose();
    super.dispose();
  }

  private useGenerated(): void {
    if (this.extras || !this.gen.loaded) return;
    const b = this.berth, d = b.door;
    const P = new Parts();
    // the open doorway (dark interior), its sill plate and the landing struts
    P.box('gdark', d.w, d.h, 0.12, { p: [d.x, d.sill + d.h / 2, -d.face - 0.03] }, 0x15181c);
    P.bevel('gdark', d.w + 0.3, 0.12, 0.3, 0.03, { p: [d.x, d.sill - 0.04, -d.face - 0.1] });
    for (const [x, z] of b.gear) {
      P.cyl('gdark', 0.11, 0.14, b.lift + 0.5, 8, { p: [x, (b.lift + 0.5) / 2, z] });
      P.bevel('gdark', 0.8, 0.1, 0.6, 0.03, { p: [x, 0.05, z] });
    }
    // light above the door and down both jambs (the running-light material)
    P.box('glit', d.w + 0.1, 0.06, 0.04, { p: [d.x, d.sill + d.h + 0.05, -d.face - 0.1] });
    for (const sx of [-1, 1]) P.box('glit', 0.05, d.h * 0.75, 0.04, { p: [d.x + sx * (d.w / 2 + 0.06), d.sill + d.h * 0.5, -d.face - 0.1] }, 0x8a8a8a);
    const g = new THREE.Group();
    g.name = 'generatedDressing';
    g.add(P.mesh('gdark', this.mk.solid(this.spec.dark)), P.mesh('glit', this.lit.material, false));
    this.extras = g;
    this.object.add(g);
    this.proc.visible = false;
  }

  private ensureEscort(): EscortFlight {
    if (!this.escortFlight) {
      const proc = this.proc;
      this.escortFlight = new EscortFlight(this.berth.model, this.berth.length, this.escortOpts, () => {
        const c = proc.clone(true);
        c.visible = true;
        c.position.set(0, -2.4, 0);
        return c;
      });
      this.object.add(this.escortFlight.object);
    }
    return this.escortFlight;
  }

  protected apply(_dt: number, time: number): void {
    const e = clamp01(this.cur.engines), r = clamp01(this.cur.ramp), k = clamp01(this.cur.escort);
    // the ramp eases down, touches, lifts a hand's width and settles
    const c = r < 0.5 ? 4 * r * r * r : 1 - Math.pow(-2 * r + 2, 3) / 2;
    const kk = clamp01((r - 0.86) / 0.14);
    this.rampPivot.rotation.x = this.openAngle * (c - 0.012 * Math.sin(Math.PI * kk) * (1 - kk) * 4);
    const flutter = 1 + 0.07 * e * Math.sin(time * 31) * Math.sin(time * 12.7);
    this.eng.set((0.08 + 5.6 * e * e) * flutter);
    this.lit.set(1.6 + 0.5 * Math.sin(time * 1.7) + 0.9 * e);
    this.gen.engines = (0.05 + 1.1 * e * e) * flutter;
    if (k > 0.001 || this.escortFlight) this.ensureEscort().set(k, time);
  }
}
