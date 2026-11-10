/**
 * Procedural ship hulls. Each design is written once against a PartSink so it can be emitted either as one
 * vertex-coloured mesh (far-field capitals, fleet impostors, the carrier) or split by material role (near-field
 * shuttle / transport that use the shared PBR material library).
 *
 * Design language: Dominion = heavy ceremonial-functional mass (blade prow, stepped citadel, buttress fins,
 * amber light); Reformation = modular sterile assemblies with visible technical connections (spine truss,
 * habitat rings, radiators, strut-mounted pods, cold blue-white light). Nose toward −Z, +Y up, metres.
 */
import * as THREE from 'three';
import { PALETTE } from '@/core/api';
import { GeoBuilder, type P3 } from './geo';

export type HullRole = 'hull' | 'accent' | 'dark' | 'metal' | 'glow' | 'glass' | 'engine';
export type ShipKind = 'dominionShuttle' | 'reformationTransport' | 'dominionCapital' | 'reformationCapital';
export const HULL_ROLES: readonly HullRole[] = ['hull', 'accent', 'dark', 'metal', 'glow', 'glass', 'engine'];

export interface RoleStyle { hex: number; glow: number; shade?: number }
export type HullPalette = Record<HullRole, RoleStyle>;

export const DOMINION_PALETTE: HullPalette = {
  hull: { hex: PALETTE.domBronze, glow: 0, shade: 0.55 },
  accent: { hex: PALETTE.domOxblood, glow: 0, shade: 0.9 },
  dark: { hex: PALETTE.domBlack, glow: 0 },
  metal: { hex: PALETTE.domBronze, glow: 0, shade: 1.1 },
  glow: { hex: PALETTE.domAmber, glow: 3.2 },
  glass: { hex: 0x1a0f08, glow: 0.25 },
  engine: { hex: PALETTE.cinderHot, glow: 6 },
};

export const REFORMATION_PALETTE: HullPalette = {
  hull: { hex: PALETTE.refSlate, glow: 0, shade: 0.8 },
  accent: { hex: PALETTE.refNavy, glow: 0 },
  dark: { hex: 0x0d1118, glow: 0 },
  metal: { hex: PALETTE.refSteel, glow: 0, shade: 0.55 },
  glow: { hex: PALETTE.refBlue, glow: 3.2 },
  glass: { hex: 0x0a1622, glow: 0.3 },
  engine: { hex: PALETTE.frost, glow: 6 },
};

/** Routes hull parts to builders by role and keeps their transform stacks in step. */
export class PartSink {
  private readonly unique: GeoBuilder[];
  constructor(private readonly builders: Record<HullRole, GeoBuilder>, private readonly palette: HullPalette) {
    this.unique = [...new Set(Object.values(builders))];
  }
  /** One vertex-coloured mesh for everything. */
  static single(palette: HullPalette, into = new GeoBuilder()): PartSink {
    const b = {} as Record<HullRole, GeoBuilder>;
    for (const r of HULL_ROLES) b[r] = into;
    return new PartSink(b, palette);
  }
  /** One builder per role (near-field PBR). */
  static split(palette: HullPalette): PartSink {
    const b = {} as Record<HullRole, GeoBuilder>;
    for (const r of HULL_ROLES) b[r] = new GeoBuilder();
    return new PartSink(b, palette);
  }
  p(role: HullRole, shade = 1): GeoBuilder {
    const s = this.palette[role];
    return this.builders[role].paint(s.hex, s.glow, (s.shade ?? 1) * shade);
  }
  builder(role: HullRole): GeoBuilder { return this.builders[role]; }
  push(): this { for (const b of this.unique) b.push(); return this; }
  pop(): this { for (const b of this.unique) b.pop(); return this; }
  transform(m: THREE.Matrix4): this { for (const b of this.unique) b.transform(m); return this; }
  translate(x: number, y: number, z: number): this { return this.transform(new THREE.Matrix4().makeTranslation(x, y, z)); }
  rotateX(a: number): this { return this.transform(new THREE.Matrix4().makeRotationX(a)); }
  rotateY(a: number): this { return this.transform(new THREE.Matrix4().makeRotationY(a)); }
  rotateZ(a: number): this { return this.transform(new THREE.Matrix4().makeRotationZ(a)); }
  scale(s: number): this { return this.transform(new THREE.Matrix4().makeScale(s, s, s)); }
  mirrorX(): this { return this.transform(new THREE.Matrix4().makeScale(-1, 1, 1)); }
}

/** Closed hull section at z: `shape` is the right half from keel to deck in unit coords, mirrored onto the left. */
function section(z: number, w: number, h: number, y: number, shape: readonly (readonly [number, number])[]): P3[] {
  const pts: P3[] = [];
  for (const [x, v] of shape) pts.push([x * w, y + v * h, z]);
  for (let i = shape.length - 1; i >= 0; i--) {
    const [x, v] = shape[i];
    if (x > 1e-6) pts.push([-x * w, y + v * h, z]);
  }
  return pts;
}

/** n-gon prism lying along +Z from z0 to z1 (nozzles, tanks, barrels). */
function zPrism(b: GeoBuilder, cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, sides: number): void {
  b.push().translate(cx, cy, z0).rotateX(Math.PI / 2).prism(0, 0, 0, z1 - z0, r0, r1, sides).pop();
}

/** Run `fn` twice: as-is and mirrored across the YZ plane. */
function both(s: PartSink, fn: () => void): void {
  fn();
  s.push().mirrorX();
  fn();
  s.pop();
}

// -------------------------------------------------------------------------------------------------------------
// Dominion capital — ≈ 620 m. A blade-prowed mass with a stepped citadel and buttress fins.
// -------------------------------------------------------------------------------------------------------------
const DOM_SHAPE = [[0, -1], [0.55, -0.62], [1, -0.1], [0.82, 0.42], [0.34, 0.78]] as const;

export function buildDominionCapital(s: PartSink): void {
  s.p('hull').loft([
    section(310, 60, 56, 0, DOM_SHAPE), section(250, 70, 64, 0, DOM_SHAPE), section(120, 66, 60, 0, DOM_SHAPE),
    section(0, 52, 50, -2, DOM_SHAPE), section(-140, 34, 40, -6, DOM_SHAPE), section(-250, 15, 30, -10, DOM_SHAPE),
    section(-312, 2.5, 22, -14, DOM_SHAPE),
  ]);
  // blade prow + ram
  s.p('accent').loft([
    [[0, -70, -150], [5, -40, -150], [5, 26, -150], [-5, 26, -150], [-5, -40, -150]],
    [[0, -78, -260], [3.5, -44, -260], [3.5, 34, -260], [-3.5, 34, -260], [-3.5, -44, -260]],
    [[0, -40, -345], [1, -30, -345], [1, 4, -345], [-1, 4, -345], [-1, -30, -345]],
  ]);
  // ventral keel fin
  s.p('dark').box(0, -78, 90, 7, 46, 250);
  s.p('accent').box(0, -104, 110, 10, 8, 200);
  // stepped citadel
  s.p('hull', 0.9).box(0, 62, 160, 86, 30, 210, { top: [0.8, 0.94] });
  s.p('accent').box(0, 92, 176, 58, 32, 136, { top: [0.72, 0.9] });
  s.p('hull', 1.1).box(0, 124, 190, 34, 34, 84, { top: [0.6, 0.8] });
  s.p('dark').box(0, 172, 196, 13, 66, 22, { top: 0.35 });
  both(s, () => {
    // crown prongs + buttress fins leaning into the citadel
    s.p('metal').box(16, 158, 196, 5, 44, 8, { top: 0.2, shift: [5, 0] });
    for (let i = 0; i < 5; i++) {
      const z = 78 + i * 40;
      s.p('dark').box(47, 58, z, 9, 62, 10, { top: [0.4, 0.7], shift: [-16, 0] });
    }
    // weapon sponsons with forward batteries
    for (let i = 0; i < 3; i++) {
      const z = -70 + i * 112, w = 58 - (i === 0 ? 20 : 0);
      s.p('accent').box(w + 6, -4, z, 26, 20, 72, { top: [0.7, 0.86] });
      s.p('dark').box(w + 10, 9, z - 20, 12, 8, 16);
      zPrism(s.p('dark'), w + 10, 10, z - 62, z - 26, 1.6, 2.2, 6);
      zPrism(s.p('dark'), w + 4, 10, z - 54, z - 26, 1.6, 2.2, 6);
    }
    // shoulder light line (amber) + stern lantern
    for (let i = 0; i < 9; i++) s.p('glow').box(55 - i * 3.2, 27 - i * 0.8, 210 - i * 44, 1.2, 2.2, 22);
    s.p('glow').box(22, 96, 110, 1.2, 9, 3);
    // outboard engines
    zPrism(s.p('dark'), 38, -8, 296, 348, 20, 24, 8);
    zPrism(s.p('engine'), 38, -8, 346, 349, 18, 18, 8);
  });
  // centre engine
  zPrism(s.p('dark'), 0, 12, 296, 356, 24, 29, 8);
  zPrism(s.p('engine'), 0, 12, 354, 357, 23, 23, 8);
  // citadel windows
  for (let i = 0; i < 6; i++) s.p('glow').box(0, 86 + (i % 2) * 8, 110 + i * 22, 59, 1.6, 5);
}

// -------------------------------------------------------------------------------------------------------------
// Reformation capital — ≈ 640 m. A spine truss carrying rings, modules and radiators.
// -------------------------------------------------------------------------------------------------------------
export function buildReformationCapital(s: PartSink): void {
  // spine
  zPrism(s.p('hull'), 0, 0, -300, 300, 15, 15, 6);
  for (let z = -280; z <= 280; z += 40) s.p('metal').box(0, 0, z, 36, 36, 3.5);
  // bow sensor head with fork and masts
  s.p('hull', 1.15).box(0, 0, -292, 66, 34, 64, { top: [0.82, 0.8] });
  s.p('accent').box(0, -22, -288, 54, 12, 50);
  both(s, () => {
    s.p('metal').box(24, 4, -344, 9, 9, 60);
    zPrism(s.p('metal'), 24, 4, -398, -372, 0.6, 1.4, 5);
    s.p('glow').box(33.6, 4, -300, 0.8, 2.2, 40);
  });
  s.p('glass').box(0, 12, -322, 40, 7, 6);
  s.p('metal').prism(0, 16, -270, 74, 1.6, 0.4, 5);
  // habitat rings on spokes
  const ringAt = (z: number, R: number, t: number, depth: number): void => {
    s.push().translate(0, 0, z).rotateX(Math.PI / 2);
    s.p('hull').ring(0, 0, R - t, R, -depth / 2, depth / 2, 0, Math.PI * 2, 24);
    s.p('glow').ring(0, 0, R + 0.2, R + 0.9, -depth * 0.16, depth * 0.16, 0, Math.PI * 2, 24);
    s.pop();
    for (let i = 0; i < 4; i++) {
      s.push().translate(0, 0, z).rotateZ((i * Math.PI) / 2 + Math.PI / 4);
      s.p('metal').box((R - t) / 2 + 6, 0, 0, R - t - 12, 4, 4);
      s.pop();
    }
  };
  ringAt(-170, 84, 13, 22);
  ringAt(-96, 62, 10, 16);
  // module blocks on visible connectors
  const mods: Array<[z: number, w: number, h: number, l: number, side: number]> = [
    [-20, 30, 26, 46, 0], [36, 40, 30, 52, 1], [96, 28, 24, 40, 2], [150, 44, 34, 60, 3], [214, 30, 26, 44, 0], [-52, 22, 18, 30, 2],
  ];
  for (const [z, w, h, l, side] of mods) {
    s.push().rotateZ((side * Math.PI) / 2);
    s.p(side % 2 ? 'accent' : 'hull', 1.05).box(0, 15 + 7 + h / 2, z, w, h, l, { top: [0.86, 0.92] });
    s.p('metal').box(-w * 0.28, 15 + 3.5, z - l * 0.28, 4, 7, 4);
    s.p('metal').box(w * 0.28, 15 + 3.5, z + l * 0.28, 4, 7, 4);
    s.p('glow').box(0, 15 + 7 + h * 0.5, z - l / 2 - 0.3, w * 0.6, 1.4, 0.6);
    s.pop();
  }
  // radiators: two swept pairs
  both(s, () => {
    for (const [z, len, y] of [[150, 150, 0], [228, 118, 0]] as const) {
      s.push().translate(19, y, z).rotateZ(0.12);
      s.p('metal').box(len / 2, 0, 0, len, 1.8, 54);
      s.p('accent').box(len / 2, 0, 0, len * 0.94, 2.4, 2.4);
      s.p('glow').box(len - 2, 0, 0, 1.2, 2.6, 30);
      s.pop();
    }
  });
  // engine block
  s.p('hull', 0.9).box(0, 0, 286, 58, 46, 52, { top: [0.9, 0.9] });
  for (const [x, y] of [[-17, 12], [17, 12], [-17, -12], [17, -12]] as const) {
    zPrism(s.p('dark'), x, y, 308, 340, 10, 12, 8);
    zPrism(s.p('engine'), x, y, 338, 341, 9.4, 9.4, 8);
  }
  // dorsal comm mast + dish
  s.p('metal').prism(0, 28, 40, 96, 1.4, 0.5, 5);
  s.push().translate(0, 78, 40).rotateX(-0.9);
  s.p('metal').prism(0, 0, 0, 10, 2, 17, 10);
  s.pop();
}

// -------------------------------------------------------------------------------------------------------------
// Dominion shuttle — ≈ 24 m armoured dropship, parked on y = 0 with the ramp down.
// -------------------------------------------------------------------------------------------------------------
const SHUTTLE_SHAPE = [[0, -1], [0.7, -0.92], [1, -0.2], [0.9, 0.5], [0.42, 1]] as const;

export function buildDominionShuttle(s: PartSink): void {
  const Y = 3.1; // hull centreline above the deck
  s.p('hull').loft([
    section(9.5, 2.6, 1.9, Y + 0.2, SHUTTLE_SHAPE), section(6.5, 3.0, 2.2, Y + 0.1, SHUTTLE_SHAPE),
    section(0, 3.0, 2.15, Y, SHUTTLE_SHAPE), section(-5.5, 2.5, 1.8, Y - 0.15, SHUTTLE_SHAPE),
    section(-9.5, 1.5, 1.2, Y - 0.55, SHUTTLE_SHAPE), section(-12.2, 0.35, 0.5, Y - 1.0, SHUTTLE_SHAPE),
  ]);
  // prow blade + dorsal crest
  s.p('accent').loft([
    [[0, Y - 2.0, -8], [0.22, Y - 1.2, -8], [0.22, Y + 0.3, -8], [-0.22, Y + 0.3, -8], [-0.22, Y - 1.2, -8]],
    [[0, Y - 1.9, -13.4], [0.06, Y - 1.6, -13.4], [0.06, Y - 1.1, -13.4], [-0.06, Y - 1.1, -13.4], [-0.06, Y - 1.6, -13.4]],
  ]);
  s.p('accent').box(0, Y + 2.75, 2.5, 0.3, 1.5, 9, { top: [0.5, 0.45], shift: [0, 2.2] });
  // cockpit slit
  s.p('glass').box(0, Y + 0.72, -8.1, 2.3, 0.5, 2.6, { top: [0.7, 0.8], shift: [0, 0.5] });
  s.p('dark').box(0, Y + 0.45, -8.2, 2.7, 0.16, 3.0);
  both(s, () => {
    // armour skirts
    for (let i = 0; i < 4; i++) s.p('accent').box(3.06, Y - 0.25, 6.2 - i * 3.5, 0.22, 2.3, 3.1, { top: [1, 0.9] });
    s.p('metal').box(3.2, Y + 0.95, 0.8, 0.12, 0.14, 14.5);
    // anhedral stub wings with tip fins
    s.push().translate(2.7, Y + 0.7, 3.2).rotateZ(-0.34);
    s.p('hull', 0.9).box(2.6, 0, 0, 5.2, 0.42, 5.6, { top: [1, 0.8] });
    s.p('dark').box(5.2, -0.5, 0.3, 0.3, 2.4, 4.4, { top: [1, 0.6], shift: [0, 0.6] });
    s.p('glow').box(5.38, -0.4, -1.2, 0.06, 0.5, 0.9);
    s.pop();
    // engine nacelles
    zPrism(s.p('dark'), 2.05, Y + 1.75, 4.4, 11.4, 1.05, 1.3, 8);
    zPrism(s.p('metal'), 2.05, Y + 1.75, 3.6, 4.6, 0.7, 1.08, 8);
    zPrism(s.p('engine'), 2.05, Y + 1.75, 11.3, 11.5, 1.1, 1.1, 8);
    // running lights + intake glow
    s.p('glow').box(3.2, Y - 0.1, -4.6, 0.08, 0.22, 1.5);
    s.p('glow').box(2.05, Y + 1.75, 3.55, 0.9, 0.9, 0.08);
    // landing gear
    s.p('dark').box(2.2, 0.85, 5.6, 0.34, 1.7, 0.34, { shift: [-0.5, 0] });
    s.p('metal').box(2.5, 0.09, 5.6, 1.1, 0.18, 2.2);
  });
  s.p('dark').box(0, 0.8, -6.4, 0.34, 1.6, 0.34);
  s.p('metal').box(0, 0.09, -6.4, 1.0, 0.18, 1.9);
  // ventral plating + lowered rear ramp
  s.p('dark').box(0, Y - 2.25, 0.5, 3.4, 0.3, 14);
  s.push().translate(0, Y - 1.9, 9.4).rotateX(-0.52);
  s.p('metal').box(0, -0.1, 2.3, 3.6, 0.22, 4.9);
  s.p('glow').box(1.72, 0.06, 2.3, 0.07, 0.07, 4.6);
  s.p('glow').box(-1.72, 0.06, 2.3, 0.07, 0.07, 4.6);
  s.pop();
  s.p('dark').box(0, Y + 0.3, 9.62, 3.6, 3.0, 0.2);
  s.p('glow').box(0, Y + 1.72, 9.75, 2.6, 0.12, 0.06);
}

// -------------------------------------------------------------------------------------------------------------
// Reformation transport — ≈ 31 m modular carrier: cockpit pod, neck truss, cargo module, strut-mounted pods.
// -------------------------------------------------------------------------------------------------------------
export function buildReformationTransport(s: PartSink): void {
  const Y = 3.6;
  // cargo module with chamfered roof + panel ribs
  s.p('hull').box(0, Y, 3.5, 6.4, 4.4, 17, { top: [0.78, 0.97] });
  s.p('accent').box(0, Y - 2.35, 3.5, 5.6, 0.5, 16.2);
  for (let i = 0; i < 6; i++) s.p('metal').box(0, Y - 0.15, -3.6 + i * 2.85, 6.56, 4.1, 0.22, { top: [0.79, 1] });
  // neck truss + cockpit pod
  s.p('metal').box(0, Y + 0.1, -6.6, 2.2, 2.0, 3.6);
  both(s, () => {
    s.p('dark').box(1.3, Y + 0.1, -6.6, 0.16, 0.16, 4.2);
    s.p('dark').box(1.3, Y - 0.9, -6.6, 0.16, 0.16, 4.2);
  });
  s.p('hull', 1.1).box(0, Y + 0.2, -11.4, 4.4, 3.2, 6.4, { top: [0.7, 0.72], shift: [0, 0.5] });
  s.p('glass').box(0, Y + 0.95, -13.4, 3.5, 1.05, 2.6, { top: [0.72, 0.5], shift: [0, 0.7] });
  s.p('accent').box(0, Y - 1.25, -11.6, 3.8, 0.5, 6.0);
  s.p('metal').box(0, Y - 0.2, -14.9, 2.4, 1.3, 0.8, { top: [0.7, 0.6] });
  s.p('glow').box(0, Y + 0.28, -14.62, 3.0, 0.1, 0.06);
  both(s, () => {
    // side tanks on struts
    zPrism(s.p('metal'), 4.5, Y - 0.4, -2.2, 8.6, 1.15, 1.15, 10);
    zPrism(s.p('accent'), 4.5, Y - 0.4, -3.1, -2.2, 0.5, 1.15, 10);
    zPrism(s.p('accent'), 4.5, Y - 0.4, 8.6, 9.5, 1.15, 0.5, 10);
    for (const z of [-0.8, 3.2, 7.2]) {
      s.p('dark').box(3.6, Y - 0.4, z, 1.6, 0.22, 0.22);
      s.p('dark').box(3.6, Y + 0.3, z, 1.7, 0.16, 0.16);
    }
    // vector thrusters on outriggers (fore + aft)
    for (const z of [-4.6, 11.2]) {
      s.p('metal').box(4.4, Y + 1.9, z, 3.4, 0.36, 0.7);
      s.push().translate(6.2, Y + 1.5, z);
      zPrism(s.p('dark'), 0, 0, -1.3, 1.5, 0.95, 1.1, 8);
      zPrism(s.p('engine'), 0, 0, 1.45, 1.58, 0.9, 0.9, 8);
      s.p('glow').box(0, 1.12, 0, 0.5, 0.06, 1.2);
      s.pop();
    }
    // light strips, skids on struts
    s.p('glow').box(3.22, Y + 0.9, 3.5, 0.05, 0.1, 15.5);
    s.p('glow').box(2.2, Y + 2.24, 11.9, 0.9, 0.08, 0.06);
    s.p('metal').box(2.3, 0.1, 3.4, 0.5, 0.2, 13.5);
    for (const z of [-1.6, 8.4]) s.p('dark').box(2.3, 0.75, z, 0.22, 1.3, 0.22);
  });
  // main engines + rear door frame
  both(s, () => {
    zPrism(s.p('dark'), 1.7, Y + 0.5, 11.9, 14.0, 1.25, 1.45, 8);
    zPrism(s.p('engine'), 1.7, Y + 0.5, 13.95, 14.08, 1.2, 1.2, 8);
  });
  s.p('dark').box(0, Y - 1.1, 12.1, 3.0, 2.0, 0.25);
  // roof sensor bar + mast
  s.p('metal').box(0, Y + 2.45, -0.5, 4.2, 0.3, 0.9);
  s.p('metal').prism(1.6, Y + 2.5, -0.5, Y + 5.4, 0.09, 0.04, 5);
  s.p('glow').box(1.6, Y + 5.45, -0.5, 0.12, 0.12, 0.12);
}

/** Emit a ship design into a sink. */
export function buildHull(kind: ShipKind, s: PartSink): void {
  if (kind === 'dominionCapital') buildDominionCapital(s);
  else if (kind === 'reformationCapital') buildReformationCapital(s);
  else if (kind === 'dominionShuttle') buildDominionShuttle(s);
  else buildReformationTransport(s);
}

export function paletteFor(kind: ShipKind): HullPalette {
  return kind.startsWith('dominion') ? DOMINION_PALETTE : REFORMATION_PALETTE;
}
