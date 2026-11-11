/**
 * The four generated ships (forge wave 5, public/models/ship_*.glb): what each file is, how it is scaled and
 * turned, and where its engines are. OWNER: ships.
 *
 * FILE FRAME. Every file is one mesh in raw units with the origin at its bounding-box centre (the forge report and
 * the `ship_*` entries of public/models/manifest.json). The capital, dropship and shuttle point their nose to +Z;
 * the carrier points it to +X. `yawToPlusX` turns a file so its nose points to +X, the frame of the hero prop
 * (src/world/props/ship.ts); the scenic frame (nose −Z) adds +π/2 to that.
 *
 * SCALE. `nominal` is the forge's target length (capital 600 m, carrier 500 m, dropship 22 m, shuttle 18 m).
 * Callers may ask for another length (the Z12 berths park the small craft at ~14–15 m: see ship.ts).
 *
 * GLOW. The textures carry no emissive map, so the engines are drawn as additive glow elements (glow.ts) at the
 * forge's `engineGlow` points, in raw file units: amber crown rings and hot cores for the Dominion, cold
 * blue-white planes and bars for the Reformation; plus a camera-facing halo per engine so it reads at any angle
 * and distance, and an exhaust plume that grows with the engine level.
 */
import { PALETTE } from '@/core/api/materials';

export type ShipModelId = 'dominionCapital' | 'reformationCarrier' | 'reformationDropship' | 'dominionShuttle';
export type ShipFaction = 'dominion' | 'reformation';
export type V3 = readonly [number, number, number];

/**
 * One additive glow element. Shapes:
 *  - `disc`  flat round core facing `axis` (an engine throat)
 *  - `ring`  flat crown ring facing `axis`: a bright hoop with eight short tines (the Dominion's crown engines)
 *  - `bar`   flat soft rectangle facing `axis`, long along `tan` (the Reformation's light planes)
 *  - `halo`  camera-facing soft sprite (keeps an engine visible edge-on and kilometres away; never under `minPx`)
 *  - `plume` exhaust: a soft flame from `p` along `axis`, turned about the axis to face the camera; its length
 *            scales with the engine level
 */
export type GlowShape = 'disc' | 'ring' | 'bar' | 'halo' | 'plume';

export interface GlowElement {
  shape: GlowShape;
  /** centre in raw file units */
  p: V3;
  /** facing (flat shapes) / exhaust direction (plume), file frame; normalised when built */
  axis: V3;
  /** bar: the long direction (default: perpendicular to `axis`, horizontal) */
  tan?: V3;
  /** raw units: disc / ring / halo = [diameter, diameter]; bar = [length, height]; plume = [length, width] */
  size: readonly [number, number];
  color: number;
  /** HDR intensity at engine level 1 (above ~1 blooms) */
  intensity: number;
  /** 0 = engine (follows the engine level), 1 = running light (always lit, slow pulse) */
  group?: 0 | 1;
  /** also add the element mirrored across x = 0 */
  mirror?: boolean;
}

export interface ShipModelSpec {
  id: ShipModelId;
  faction: ShipFaction;
  /** file in public/models/ */
  file: string;
  /** baked index LODs (scratchpad ships-int/bake-ships.mjs; 'ALOD' v1, two levels); optional */
  lod: string;
  /** length along the long axis in raw units (bbox) */
  rawLength: number;
  /** forge target length in metres */
  nominal: number;
  /** yaw (about +Y) that points the file's nose to +X */
  yawToPlusX: number;
  /** which glowing texels of the colour map the hull's emissive mask lights (see glow.ts `patchHull`) */
  mask: 'amber' | 'blue';
  glow: readonly GlowElement[];
}

const AMBER = PALETTE.domAmber;
const AMBER_HOT = 0xffc070;
const CROWN = 0xff8a2a;
const BLUE = PALETTE.refBlue;
const BLUE_HOT = 0xe4f4ff;

const MZ: V3 = [0, 0, -1];

/** Dominion ring engine at `p` facing −Z: crown ring, hot core, halo, plume. `r` = ring radius (raw). */
function crownEngine(p: V3, r: number, plume: number, mirror = false): GlowElement[] {
  return [
    { shape: 'ring', p, axis: MZ, size: [r * 2.4, r * 2.4], color: CROWN, intensity: 4.2, mirror },
    { shape: 'disc', p: [p[0], p[1], p[2] - r * 0.02], axis: MZ, size: [r * 1.5, r * 1.5], color: AMBER_HOT, intensity: 2.6, mirror },
    { shape: 'halo', p: [p[0], p[1], p[2] - r * 0.3], axis: MZ, size: [r * 3.4, r * 3.4], color: AMBER, intensity: 0.65, mirror },
    { shape: 'plume', p, axis: MZ, size: [plume, r * 1.5], color: AMBER, intensity: 1.4, mirror },
  ];
}

export const SHIP_MODELS: Readonly<Record<ShipModelId, ShipModelSpec>> = {
  dominionCapital: {
    id: 'dominionCapital', faction: 'dominion', file: 'ship_dominion_capital.glb', lod: 'ship_dominion_capital.lod.bin',
    rawLength: 1.0, nominal: 600, yawToPlusX: Math.PI / 2, mask: 'amber',
    // four ring engine crowns in a diamond at the stern, openings facing −Z (disc centres from the manifest)
    glow: [
      ...crownEngine([0, 0, -0.48], 0.03, 0.16),
      ...crownEngine([0.066, -0.043, -0.48], 0.03, 0.16, true),
      ...crownEngine([0, -0.098, -0.48], 0.03, 0.16),
    ],
  },
  reformationCarrier: {
    id: 'reformationCarrier', faction: 'reformation', file: 'ship_reformation_carrier.glb', lod: 'ship_reformation_carrier.lod.bin',
    rawLength: 1.0, nominal: 500, yawToPlusX: 0, mask: 'blue',
    // three stacked light bars on each flank of the stern quarter, facing sideways; the stern itself gets cold
    // exhaust planes at x = −0.5, one per bar height
    glow: [
      ...([[-0.4, -0.005, 0.119], [-0.39, -0.038, 0.104], [-0.39, -0.07, 0.092]] as const).flatMap((p): GlowElement[] => [
        { shape: 'bar', p: [p[0], p[1], p[2] + 0.004], axis: [0, 0, 1], tan: [1, 0, 0], size: [0.13, 0.011], color: BLUE_HOT, intensity: 2.6 },
        { shape: 'bar', p: [p[0], p[1], -p[2] - 0.004], axis: [0, 0, -1], tan: [1, 0, 0], size: [0.13, 0.011], color: BLUE_HOT, intensity: 2.6 },
        { shape: 'bar', p: [-0.502, p[1], p[2] * 0.8], axis: [-1, 0, 0], tan: [0, 0, 1], size: [0.06, 0.016], color: BLUE, intensity: 2.4, mirror: false },
        { shape: 'bar', p: [-0.502, p[1], -p[2] * 0.8], axis: [-1, 0, 0], tan: [0, 0, 1], size: [0.06, 0.016], color: BLUE, intensity: 2.4 },
        { shape: 'plume', p: [-0.5, p[1], p[2] * 0.8], axis: [-1, 0, 0], size: [0.12, 0.03], color: BLUE, intensity: 1.0 },
        { shape: 'plume', p: [-0.5, p[1], -p[2] * 0.8], axis: [-1, 0, 0], size: [0.12, 0.03], color: BLUE, intensity: 1.0 },
      ]),
      { shape: 'halo', p: [-0.5, -0.038, 0.09], axis: [-1, 0, 0], size: [0.07, 0.07], color: BLUE, intensity: 1.0 },
      { shape: 'halo', p: [-0.5, -0.038, -0.09], axis: [-1, 0, 0], size: [0.07, 0.07], color: BLUE, intensity: 1.0 },
      // a white beacon on the bridge tower and at the bow
      { shape: 'halo', p: [-0.07, 0.11, 0], axis: [0, 1, 0], size: [0.012, 0.012], color: 0xf2f8ff, intensity: 2.4, group: 1 },
      { shape: 'halo', p: [0.5, 0.0, 0], axis: [1, 0, 0], size: [0.01, 0.01], color: 0xf2f8ff, intensity: 2.0, group: 1 },
    ],
  },
  reformationDropship: {
    id: 'reformationDropship', faction: 'reformation', file: 'ship_reformation_dropship.glb', lod: 'ship_reformation_dropship.lod.bin',
    rawLength: 1.0, nominal: 22, yawToPlusX: Math.PI / 2, mask: 'blue',
    glow: [
      // the two engine pods on the wing roots: blue slits on their front faces, cold exhaust out of their backs
      { shape: 'bar', p: [0.215, 0.07, 0.032], axis: [0, 0, 1], tan: [1, 0, 0], size: [0.07, 0.016], color: BLUE_HOT, intensity: 2.2, mirror: true },
      { shape: 'disc', p: [0.215, 0.077, -0.358], axis: MZ, size: [0.06, 0.06], color: BLUE_HOT, intensity: 3.0, mirror: true },
      { shape: 'halo', p: [0.215, 0.077, -0.37], axis: MZ, size: [0.1, 0.1], color: BLUE, intensity: 0.6, mirror: true },
      { shape: 'plume', p: [0.215, 0.077, -0.358], axis: MZ, size: [0.22, 0.05], color: BLUE, intensity: 1.2, mirror: true },
      // long slits low on each flank aft
      { shape: 'bar', p: [0.184, -0.045, -0.28], axis: [1, 0, 0], tan: [0, 0, 1], size: [0.12, 0.01], color: BLUE_HOT, intensity: 2.0, mirror: true },
      // running lights: wingtips and nose
      { shape: 'halo', p: [0.49, 0.105, -0.12], axis: [1, 0, 0], size: [0.018, 0.018], color: 0xf2f8ff, intensity: 2.2, group: 1, mirror: true },
      { shape: 'halo', p: [0, -0.03, 0.5], axis: [0, 0, 1], size: [0.014, 0.014], color: 0xf2f8ff, intensity: 1.8, group: 1 },
    ],
  },
  dominionShuttle: {
    id: 'dominionShuttle', faction: 'dominion', file: 'ship_dominion_shuttle.glb', lod: 'ship_dominion_shuttle.lod.bin',
    rawLength: 0.936, nominal: 18, yawToPlusX: Math.PI / 2, mask: 'amber',
    glow: [
      // four rear nozzles in a 2 × 2 block facing −Z
      ...crownEngine([0.088, -0.036, -0.452], 0.036, 0.22, true),
      ...crownEngine([0.066, 0.083, -0.452], 0.036, 0.22, true),
      // five lift thrusters under the hull facing −Y (one under the nose, two pairs)
      ...([[0, -0.15, 0.243], [0.1, -0.15, 0.083], [-0.1, -0.15, 0.083], [0.115, -0.155, -0.104], [-0.115, -0.155, -0.104]] as const).flatMap((p): GlowElement[] => [
        { shape: 'disc', p: [p[0], p[1] - 0.004, p[2]], axis: [0, -1, 0], size: [0.05, 0.05], color: AMBER_HOT, intensity: 2.4 },
        { shape: 'halo', p: [p[0], p[1] - 0.012, p[2]], axis: [0, -1, 0], size: [0.06, 0.06], color: AMBER, intensity: 0.45 },
      ]),
      // running lights: wingtips (red), tail (amber)
      { shape: 'halo', p: [0.49, -0.02, -0.05], axis: [1, 0, 0], size: [0.018, 0.018], color: 0xff5030, intensity: 2.0, group: 1, mirror: true },
    ],
  },
};

export const SHIP_MODEL_IDS = Object.keys(SHIP_MODELS) as ShipModelId[];

/** metres per raw unit for a ship drawn `length` metres long (default: the forge's nominal length) */
export function shipScale(id: ShipModelId, length?: number): number {
  const s = SHIP_MODELS[id];
  const L = typeof length === 'number' && Number.isFinite(length) && length > 0 ? length : s.nominal;
  return L / s.rawLength;
}

/** every glow element of a ship with mirrored copies expanded */
export function expandGlow(spec: ShipModelSpec): GlowElement[] {
  const out: GlowElement[] = [];
  for (const g of spec.glow) {
    out.push(g);
    if (g.mirror) {
      const m = (v: V3): V3 => [-v[0], v[1], v[2]];
      out.push({ ...g, p: m(g.p), axis: m(g.axis), tan: g.tan ? m(g.tan) : undefined, mirror: false });
    }
  }
  return out;
}
