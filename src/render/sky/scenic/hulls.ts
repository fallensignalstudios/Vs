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
// Near-field helpers
// -------------------------------------------------------------------------------------------------------------
/** Smooth round frustum lying along +Z (nacelles, tanks, barrels, struts' housings). */
function zCyl(b: GeoBuilder, cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, sides: number, caps = true): void {
  b.push().translate(cx, cy, z0).rotateX(Math.PI / 2).cyl(0, 0, 0, z1 - z0, r0, r1, sides, caps).pop();
}

/** Smooth surface of revolution lying along +Z: profile = [radius, z offset]. */
function zLathe(b: GeoBuilder, cx: number, cy: number, z0: number, profile: readonly (readonly [number, number])[], sides: number): void {
  b.push().translate(cx, cy, z0).rotateX(Math.PI / 2).lathe(0, 0, profile, sides).pop();
}

/** A row of thin slats (vents, radiators): `n` blades across `len` along Z. */
function slats(b: GeoBuilder, x: number, y: number, z: number, len: number, w: number, n: number, tilt: number): void {
  for (let i = 0; i < n; i++) {
    b.push().translate(x, y, z - len / 2 + ((i + 0.5) / n) * len).rotateX(tilt);
    b.box(0, 0, 0, w, 0.03, (len / n) * 0.7);
    b.pop();
  }
}

/** Landing leg: oleo strut, drag brace, hydraulic ram and a chamfered foot pad resting on y = 0. */
function gear(s: PartSink, x: number, z: number, top: number, splay: number): void {
  s.p('metal').tube([[x, top, z], [x + splay * 0.55, top * 0.45, z], [x + splay, 0.34, z]], [0.17, 0.13, 0.1], 8);
  s.p('dark').tube([[x, top * 0.92, z + 1.1], [x + splay * 0.8, 0.5, z + 0.15]], 0.07, 6);
  s.p('dark').tube([[x, top * 0.92, z - 1.1], [x + splay * 0.8, 0.5, z - 0.15]], 0.07, 6);
  s.p('metal', 1.2).tube([[x - splay * 0.3, top * 0.8, z], [x + splay * 0.7, top * 0.36, z]], 0.06, 6);
  s.p('dark').bevelBox(x + splay, 0.2, z, 0.5, 0.3, 0.6, 0.06);
  s.p('metal').bevelBox(x + splay, 0.07, z, 1.25, 0.14, 2.1, 0.05);
  s.p('dark').box(x + splay, 0.155, z, 1.0, 0.03, 1.8);
}

/** A row of bolt heads along Z on a plate whose outer face is at x (hard-surface scale cue at arm's length). */
function bolts(b: GeoBuilder, x: number, y: number, z0: number, z1: number, n: number, r = 0.035): void {
  for (let i = 0; i < n; i++) {
    b.push().translate(x, y, z0 + ((i + 0.5) / n) * (z1 - z0)).rotateZ(-Math.PI / 2).cyl(0, 0, 0, 0.03, r, r * 0.8, 6).pop();
  }
}

const NEAR_SHAPE = [[0, -1], [0.55, -1], [0.92, -0.62], [1.0, -0.1], [0.97, 0.38], [0.74, 0.84], [0.36, 1.0], [0, 1.0]] as const;
/** hard chines of NEAR_SHAPE once mirrored (keel edges, bilge chines, shoulders) */
const NEAR_CREASE = [1, 2, 5, 9, 12, 13] as const;

// -------------------------------------------------------------------------------------------------------------
// Dominion shuttle — ≈ 26 m armoured dropship, parked on y = 0 with the ramp down.
// Heavy and ceremonial-functional: a smooth-skinned bronze fuselage under overlapping oxblood armour skirts,
// a blade prow, a framed canopy blister, shoulder nacelles with real bells, anhedral stub wings with lift
// thrusters, modelled landing legs and an open troop bay behind the ramp.
// -------------------------------------------------------------------------------------------------------------
export function buildDominionShuttle(s: PartSink): void {
  const Y = 3.45; // hull centreline above the deck
  const st: Array<[number, number, number, number]> = [
    [9.8, 2.85, 2.1, Y + 0.15], [7.0, 3.05, 2.25, Y + 0.1], [1.0, 3.1, 2.25, Y], [-4.5, 2.8, 2.05, Y - 0.1],
    [-8.5, 2.1, 1.6, Y - 0.4], [-11.3, 1.2, 1.0, Y - 0.75], [-12.8, 0.5, 0.5, Y - 1.0],
  ];
  s.p('hull').skin(st.map(([z, w, h, y]) => section(z, w, h, y, NEAR_SHAPE)), { crease: NEAR_CREASE });
  s.p('dark').poly([...section(-12.8, 0.5, 0.5, Y - 1.0, NEAR_SHAPE)].reverse());

  // blade prow under the nose, dorsal crest with a gold edge
  s.p('accent').loft([
    [[0, Y - 2.25, -8.4], [0.26, Y - 1.5, -8.4], [0.26, Y - 0.2, -8.4], [-0.26, Y - 0.2, -8.4], [-0.26, Y - 1.5, -8.4]],
    [[0, Y - 2.1, -11.6], [0.14, Y - 1.6, -11.6], [0.14, Y - 0.9, -11.6], [-0.14, Y - 0.9, -11.6], [-0.14, Y - 1.6, -11.6]],
    [[0, Y - 1.75, -14.1], [0.05, Y - 1.6, -14.1], [0.05, Y - 1.25, -14.1], [-0.05, Y - 1.25, -14.1], [-0.05, Y - 1.6, -14.1]],
  ]);
  s.p('accent').loft([
    [[-0.17, Y + 2.2, 8.4], [0.17, Y + 2.2, 8.4], [0.17, Y + 4.1, 8.9], [-0.17, Y + 4.1, 8.9]],
    [[-0.17, Y + 2.15, 3.2], [0.17, Y + 2.15, 3.2], [0.1, Y + 3.55, 5.6], [-0.1, Y + 3.55, 5.6]],
    [[-0.12, Y + 2.1, -2.2], [0.12, Y + 2.1, -2.2], [0.05, Y + 2.3, -1.2], [-0.05, Y + 2.3, -1.2]],
  ]);
  s.p('metal').tube([[0, Y + 4.12, 8.92], [0, Y + 3.57, 5.6], [0, Y + 2.32, -1.2]], 0.05, 5);

  // canopy blister with frame ribs, visor brow
  s.p('glass').ball(0, Y + 0.95, -8.3, 1.25, 0.95, 2.5, 18, 7, 0.02, 1);
  for (const z of [-9.6, -8.3, -7.0]) {
    const pts: P3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      const k = Math.sqrt(Math.max(0, 1 - ((z + 8.3) / 2.5) ** 2));
      pts.push([Math.cos(a) * 1.27 * k, Y + 0.95 + Math.sin(a) * 0.97 * k, z]);
    }
    s.p('dark').tube(pts, 0.045, 5, false);
  }
  s.p('dark').tube([[0, Y + 1.9, -8.3], [0, Y + 1.6, -10.0], [0, Y + 0.98, -10.75]], 0.05, 5, false);
  s.p('accent').bevelBox(0, Y + 0.85, -5.6, 2.9, 0.5, 1.0, 0.1);

  both(s, () => {
    // overlapping armour skirts, each a chamfered plate standing a hand off the hull on gold brackets
    for (let i = 0; i < 5; i++) {
      const z = 7.4 - i * 3.3, k = i === 4 ? 0.86 : 1;
      s.push().translate(3.2 * k + (i === 4 ? 0.1 : 0), Y - 0.35, z).rotateY(i === 4 ? 0.12 : 0).rotateZ(0.05);
      s.p('accent').bevelBox(0, 0, 0, 0.2, 2.5, 3.5, 0.07);
      s.p('metal').box(0.11, 1.1, 0, 0.03, 0.12, 3.3);
      s.p('dark').bevelBox(0.11, -0.2, 0, 0.04, 1.1, 2.3, 0.02);
      bolts(s.p('metal'), 0.1, 0.92, -1.6, 1.6, 9);
      bolts(s.p('metal'), 0.1, -1.08, -1.6, 1.6, 9);
      s.pop();
      s.p('metal').box(3.0 * k, Y + 0.55, z - 1.2, 0.3, 0.12, 0.16).box(3.0 * k, Y - 1.1, z + 1.2, 0.3, 0.12, 0.16);
    }
    s.p('metal').tube([[3.12, Y + 1.0, 8.6], [3.14, Y + 1.0, -4.5], [2.4, Y + 0.72, -8.4]], 0.06, 6);
    // shoulder nacelle: intake lip, smooth body, heat fins, a real bell with the glow deep inside
    const nx = 2.15, ny = Y + 1.95;
    zCyl(s.p('dark'), nx, ny, 2.6, 10.6, 1.0, 1.18, 18, false);
    zLathe(s.p('metal'), nx, ny, 1.9, [[0.72, 0.7], [0.95, 0], [1.08, 0.15], [1.02, 0.75]], 18);
    s.p('dark').box(nx, ny, 2.55, 1.3, 1.3, 0.06);
    zLathe(s.p('dark', 1.3), nx, ny, 10.6, [[1.18, 0], [1.3, 1.5], [1.16, 1.5], [0.8, 0.25]], 18);
    zCyl(s.p('engine'), nx, ny, 10.86, 10.92, 0.8, 0.8, 18);
    for (let i = 0; i < 6; i++) s.p('metal').box(nx + 1.02, ny + 0.2, 5 + i * 0.85, 0.2, 0.9, 0.08);
    s.p('hull', 0.85).bevelBox(nx - 0.2, ny - 0.75, 6.5, 1.5, 0.5, 7.4, 0.12);
    slats(s.p('dark'), nx, ny + 1.06, 7.2, 3.0, 0.9, 9, 0.5);
    for (const z of [3.4, 6.2, 9.4]) zLathe(s.p('metal'), nx, ny, z, [[1.2, 0], [1.24, 0], [1.24, 0.14], [1.2, 0.14]], 18);
    // fuel and coolant lines from the nacelle down into the wing root
    s.p('dark').tube([[nx + 0.7, ny - 0.75, 4.2], [nx + 0.95, ny - 1.25, 4.0], [nx + 0.9, Y + 0.95, 3.6]], 0.055, 6);
    s.p('metal').tube([[nx + 0.6, ny - 0.8, 5.0], [nx + 0.85, ny - 1.3, 5.1], [nx + 0.8, Y + 0.95, 5.3]], 0.04, 6);
    // anhedral stub wing: tapered slab, leading-edge gold strip, tip fin, lift thruster, hardpoint
    s.push().translate(2.8, Y + 0.75, 3.1).rotateZ(-0.34);
    s.p('hull', 0.9).loft([
      [[0, -0.26, 3.0], [0, 0.26, 3.0], [0, 0.26, -3.0], [0, -0.26, -3.0]],
      [[5.3, -0.1, 2.5], [5.3, 0.1, 2.5], [5.3, 0.1, -1.4], [5.3, -0.1, -1.4]],
    ]);
    s.p('metal').tube([[0, 0, -3.0], [5.3, 0, -1.4]], 0.07, 6);
    s.p('accent').bevelBox(2.4, 0.2, 0.3, 3.4, 0.08, 3.2, 0.03);
    const fin: P3[][] = [
      [[5.22, -1.25, 2.2], [5.38, -1.25, 2.2], [5.38, -1.25, 0.2], [5.22, -1.25, 0.2]],
      [[5.22, 0.6, 2.6], [5.38, 0.6, 2.6], [5.38, 0.6, 1.0], [5.22, 0.6, 1.0]],
    ];
    s.p('dark').loft(fin.map((r) => [...r].reverse()));
    s.p('glow').box(5.4, -0.2, -0.3, 0.04, 0.1, 0.5);
    s.p('accent').bevelBox(5.3, -0.9, 1.2, 0.2, 0.5, 1.6, 0.03);
    zCyl(s.p('dark'), 3.3, -0.62, -0.2, 1.4, 0.62, 0.7, 14);
    s.push().translate(3.3, -0.62, 0.6).rotateX(-Math.PI / 2);
    zLathe(s.p('dark', 1.2), 0, 0, 0, [[0.5, 0], [0.74, 0.7], [0.64, 0.7], [0.4, 0.1]], 14);
    zCyl(s.p('engine'), 0, 0, 0.1, 0.14, 0.44, 0.44, 14);
    s.pop();
    zCyl(s.p('metal'), 1.6, -0.5, -1.6, 1.2, 0.2, 0.2, 10);
    s.p('dark').bevelBox(1.6, -0.3, -0.2, 0.2, 0.3, 1.2, 0.03);
    s.pop();
    // running lights + intake glow
    s.p('glow').box(3.33, Y - 0.1, -4.6, 0.05, 0.16, 1.4).box(3.33, Y - 0.1, 2.0, 0.05, 0.16, 1.4);
    s.p('glow').box(nx, ny, 2.6, 0.7, 0.7, 0.04);
    // hull panels, maintenance hatches with handles, a grab rail by the crew door, a row of dorsal vents
    s.p('hull', 1.15).bevelBox(1.7, Y + 2.2, -1.6, 1.3, 0.08, 2.2, 0.03).bevelBox(1.5, Y + 2.2, 1.4, 1.1, 0.08, 1.4, 0.03);
    s.p('dark').bevelBox(2.55, Y + 1.25, -5.3, 0.1, 0.5, 0.9, 0.03);
    s.p('metal').tube([[2.62, Y + 1.38, -5.6], [2.72, Y + 1.38, -5.5], [2.72, Y + 1.38, -5.1], [2.62, Y + 1.38, -5.0]], 0.02, 5, false);
    s.p('metal').tube([[2.5, Y + 0.4, -6.9], [2.66, Y + 0.4, -6.9], [2.74, Y + 1.3, -6.5], [2.6, Y + 1.3, -6.5]], 0.025, 5, false);
    s.p('dark').bevelBox(2.34, Y - 0.2, -6.9, 0.08, 1.7, 0.9, 0.03);
    slats(s.p('dark'), 0.9, Y + 2.27, -3.8, 1.4, 0.7, 6, 0.4);
    for (let i = 0; i < 3; i++) s.p('metal').bevelBox(1.05, Y - 2.2, -4 + i * 3.4, 0.5, 0.1, 0.8, 0.03);
    // main gear under the wing roots
    gear(s, 2.3, 5.3, Y - 2.2, 0.9);
  });
  gear(s, 0, -6.6, Y - 1.5, 0);

  // belly plating with keel strakes, dorsal sensor mast
  s.p('dark').bevelBox(0, Y - 2.33, 0.4, 3.5, 0.22, 14.2, 0.08);
  for (const x of [-1.2, 1.2]) s.p('metal').bevelBox(x, Y - 2.5, 0.4, 0.16, 0.16, 12.6, 0.04);
  for (const x of [-0.5, 0.2, 0.62]) s.p('dark').tube([[x, Y - 2.5, -5.4], [x + 0.06, Y - 2.52, 0.5], [x, Y - 2.5, 6.6]], 0.045, 6);
  for (let i = 0; i < 5; i++) s.p('metal').bevelBox(0.05, Y - 2.47, -4.2 + i * 2.5, 1.6, 0.05, 0.12, 0.015);
  s.p('metal').tube([[0.9, Y + 2.2, -3.4], [0.9, Y + 3.5, -3.1]], [0.05, 0.02], 5);
  s.p('glow').box(0.9, Y + 3.55, -3.1, 0.08, 0.08, 0.08);

  // open troop bay: frame, lit interior, benches; lowered ramp with treads, edge lights and hydraulic rams
  s.p('dark').room(0, Y - 0.05, 6.9, 4.3, 3.5, 6.0);
  s.p('dark').bevelBox(0, Y + 1.95, 9.95, 5.6, 0.55, 0.34, 0.08).bevelBox(0, Y - 1.95, 9.95, 5.2, 0.3, 0.34, 0.06);
  for (const x of [-2.45, 2.45]) s.p('dark').bevelBox(x, Y, 9.95, 0.7, 3.6, 0.34, 0.08);
  s.p('hull', 0.6).box(0, Y - 1.76, 6.9, 4.2, 0.05, 5.9);
  for (const z of [5.0, 6.6, 8.2]) {
    s.p('glow').box(0, Y + 1.66, z, 2.6, 0.05, 0.12);
    s.p('metal').box(0, Y + 1.6, z + 0.8, 4.2, 0.12, 0.12);
    for (const x of [-2.08, 2.08]) s.p('metal').box(x, Y, z + 0.8, 0.1, 3.3, 0.12);
  }
  for (const x of [-1.72, 1.72]) {
    s.p('accent').bevelBox(x, Y - 1.3, 6.9, 0.55, 0.42, 5.2, 0.06);
    s.p('dark').bevelBox(x * 1.14, Y - 0.55, 6.9, 0.12, 1.0, 5.2, 0.03);
    s.p('glow').box(x * 1.3, Y - 0.1, 10.14, 0.07, 2.9, 0.05);
  }
  s.p('glow').box(0, Y + 1.64, 10.14, 3.6, 0.07, 0.05);
  s.push().translate(0, Y - 1.78, 10.0).rotateX(0.345); // hinge at the sill, far edge on the deck
  s.p('metal').bevelBox(0, -0.1, 2.5, 3.9, 0.2, 5.0, 0.06);
  for (let i = 0; i < 12; i++) s.p('dark').box(0, 0.02, 0.4 + i * 0.4, 3.3, 0.03, 0.12);
  for (const x of [-1.86, 1.86]) {
    s.p('glow').box(x, 0.04, 2.5, 0.06, 0.05, 4.7);
    s.p('dark').bevelBox(x * 1.03, 0.1, 2.5, 0.1, 0.28, 5.0, 0.03);
  }
  s.pop();
  for (const x of [-1.95, 1.95]) s.p('metal', 1.2).tube([[x, Y + 0.4, 9.9], [x, Y - 2.55, 12.5]], [0.09, 0.055], 7);
}

// -------------------------------------------------------------------------------------------------------------
// Reformation transport — ≈ 31 m modular carrier. Sterile, modular, every connection visible: a capsule cockpit
// on a tubular neck truss, a chamfered cargo module with ribbed frames, strapped propellant tanks on struts,
// four vectoring thrusters on outriggers, skids, a sensor bar and a dish.
// -------------------------------------------------------------------------------------------------------------
export function buildReformationTransport(s: PartSink): void {
  const Y = 3.7;
  // cargo module: chamfered box, roof cap, ribbed frames, recessed side door panels with blue edge light
  s.p('hull').bevelBox(0, Y, 3.5, 6.4, 4.4, 17, 0.28);
  s.p('hull', 1.1).bevelBox(0, Y + 2.3, 3.5, 5.0, 0.3, 16.2, 0.1);
  s.p('accent').bevelBox(0, Y - 2.3, 3.5, 5.6, 0.36, 16.2, 0.1);
  for (let i = 0; i < 7; i++) {
    const z = -4.6 + i * 2.7;
    s.p('metal').bevelBox(0, Y, z, 6.62, 4.46, 0.2, 0.05);
    for (const sx of [-1, 1]) for (let k = 0; k < 7; k++) {
      s.push().translate(sx * 3.31, Y - 1.8 + k * 0.6, z).rotateZ((-sx * Math.PI) / 2);
      s.p('dark').cyl(0, 0, 0, 0.03, 0.035, 0.028, 6);
      s.pop();
    }
  }
  both(s, () => {
    s.p('accent').bevelBox(3.24, Y - 0.25, 3.5, 0.1, 3.0, 4.6, 0.04);
    s.p('dark').box(3.3, Y - 0.25, 3.5, 0.04, 2.7, 0.06).box(3.3, Y + 1.0, 3.5, 0.04, 0.06, 4.2);
    s.p('glow').box(3.3, Y + 1.36, 3.5, 0.04, 0.06, 4.4);
    s.p('metal').tube([[3.34, Y - 0.9, 1.5], [3.5, Y - 0.9, 1.5], [3.5, Y + 0.3, 1.5], [3.34, Y + 0.3, 1.5]], 0.035, 5, false);
    slats(s.p('dark'), 3.26, Y + 0.8, -2.2, 1.6, 0.06, 6, 0);
    for (let i = 0; i < 4; i++) s.p('metal', 1.2).bevelBox(3.27, Y - 1.6, -3.0 + i * 4.4, 0.08, 0.5, 0.9, 0.02);
  });

  // neck: a tubular space-frame between pod and module (diagonals visible), service lines along it
  const nz0 = -5.0, nz1 = -8.6, r = 0.95;
  const corners: Array<[number, number]> = [[-r, Y + 1.0], [r, Y + 1.0], [r, Y - 0.9], [-r, Y - 0.9]];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
    s.p('metal').tube([[ax, ay, nz0], [ax, ay, nz1]], 0.09, 7);
    s.p('dark').tube([[ax, ay, nz0], [bx, by, nz1]], 0.05, 5);
    s.p('metal').tube([[ax, ay, (nz0 + nz1) / 2], [bx, by, (nz0 + nz1) / 2]], 0.05, 5);
  }
  zCyl(s.p('dark'), 0, Y + 0.05, nz1, nz0, 0.55, 0.55, 12);
  s.p('accent').tube([[0.5, Y + 0.7, nz0], [0.55, Y + 0.85, (nz0 + nz1) / 2], [0.5, Y + 0.7, nz1]], 0.05, 5);
  s.p('accent').tube([[-0.5, Y + 0.7, nz0], [-0.6, Y + 0.5, (nz0 + nz1) / 2], [-0.5, Y + 0.7, nz1]], 0.04, 5);

  // cockpit pod: a smooth capsule with a wraparound glass band, chin sensor, docking collar
  const pod: Array<[number, number, number, number]> = [
    [-8.6, 1.5, 1.25, Y + 0.1], [-9.6, 2.15, 1.6, Y + 0.15], [-11.8, 2.2, 1.65, Y + 0.15], [-13.6, 1.8, 1.4, Y + 0.05], [-14.9, 1.05, 0.85, Y - 0.15], [-15.4, 0.4, 0.35, Y - 0.25],
  ];
  const POD = [[0, -1], [0.6, -0.9], [0.95, -0.45], [1.0, 0.1], [0.86, 0.62], [0.5, 0.95], [0, 1.0]] as const;
  s.p('hull', 1.1).skin(pod.map(([z, w, h, y]) => section(z, w, h, y, POD)), { caps: true });
  s.p('glass').ball(0, Y + 0.72, -13.0, 1.72, 0.92, 2.25, 18, 6, 0.05, 1);
  for (const z of [-14.2, -13.0, -11.8]) {
    const k = Math.sqrt(Math.max(0, 1 - ((z + 13.0) / 2.25) ** 2));
    const pts: P3[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push([Math.cos(a) * 1.74 * k, Y + 0.72 + Math.sin(a) * 0.94 * k, z]); }
    s.p('metal').tube(pts, 0.04, 5, false);
  }
  s.p('accent').bevelBox(0, Y - 1.2, -11.8, 3.4, 0.4, 5.2, 0.12);
  s.p('dark').ball(0, Y - 1.45, -13.9, 0.5, 0.42, 0.6, 12, 5, -1, 0.2);
  s.p('glow').box(0, Y - 1.45, -14.42, 0.3, 0.1, 0.05);
  s.p('glow').box(0, Y + 0.06, -15.52, 1.6, 0.07, 0.05);
  zLathe(s.p('metal'), 0, Y + 0.1, -8.75, [[1.3, 0.3], [1.42, 0.3], [1.42, 0], [1.3, 0]], 16);

  both(s, () => {
    // propellant tank: smooth barrel with domed ends, straps, and the struts that hold it off the module
    const tx = 4.7, ty = Y - 0.5;
    zCyl(s.p('metal'), tx, ty, -2.4, 8.8, 1.15, 1.15, 20, false);
    s.p('metal').ball(tx, ty, -2.4, 1.15, 1.15, 0.9, 20, 5, -1, 1);
    s.p('metal').ball(tx, ty, 8.8, 1.15, 1.15, 0.9, 20, 5, -1, 1);
    for (const z of [-1.2, 3.2, 7.6]) {
      zLathe(s.p('accent'), tx, ty, z - 0.14, [[1.17, 0], [1.22, 0], [1.22, 0.28], [1.17, 0.28]], 20);
      s.p('dark').tube([[3.2, Y - 1.1, z], [tx - 0.9, ty - 0.5, z]], 0.07, 6);
      s.p('dark').tube([[3.2, Y + 0.5, z], [tx - 0.7, ty + 0.75, z]], 0.07, 6);
      s.p('dark').tube([[3.2, Y + 0.5, z], [tx - 0.9, ty - 0.5, z + 1.6]], 0.04, 5);
    }
    s.p('accent').tube([[tx, ty + 1.15, -1.8], [tx - 0.3, ty + 1.5, -3.2], [3.2, Y + 1.6, -4.0]], 0.05, 5);
    // fill valve, pressure line and a service ladder on the tank
    zCyl(s.p('dark'), tx + 0.3, ty + 1.0, 0.6, 0.95, 0.16, 0.16, 10);
    s.p('dark').tube([[tx + 0.3, ty + 1.12, 0.8], [tx + 0.1, ty + 1.3, 2.4], [tx - 0.6, ty + 1.25, 6.0], [3.2, Y + 1.5, 7.4]], 0.035, 5);
    for (let i = 0; i < 6; i++) s.p('metal').tube([[tx + 1.18, ty - 0.5 + i * 0.2, 4.6], [tx + 1.18, ty - 0.5 + i * 0.2, 5.1]], 0.02, 5);
    for (const z of [4.6, 5.1]) s.p('metal').tube([[tx + 1.17, ty - 0.6, z], [tx + 1.19, ty + 0.6, z]], 0.02, 5);
    // vectoring thrusters on outriggers (fore + aft): gimbal ring, smooth nacelle, bell, glow, status strip
    for (const z of [-4.3, 11.0]) {
      s.p('metal').tube([[3.1, Y + 1.9, z], [6.1, Y + 1.7, z]], [0.2, 0.15], 8);
      s.p('dark').tube([[3.1, Y + 0.8, z + 0.5], [5.7, Y + 1.45, z + 0.1]], 0.06, 5);
      s.push().translate(6.5, Y + 1.55, z).rotateX(0.5);
      zLathe(s.p('metal'), 0, 0, -0.16, [[1.04, 0], [1.12, 0], [1.12, 0.32], [1.04, 0.32]], 16);
      zCyl(s.p('dark'), 0, 0, -1.3, 1.2, 0.8, 0.95, 16);
      zLathe(s.p('dark', 1.3), 0, 0, 1.2, [[0.95, 0], [1.1, 0.75], [0.98, 0.75], [0.7, 0.1]], 16);
      zCyl(s.p('engine'), 0, 0, 1.32, 1.37, 0.74, 0.74, 16);
      s.p('hull').ball(0, 0, -1.3, 0.8, 0.8, 0.5, 16, 4, -1, 1);
      s.p('glow').box(0, 0.98, 0, 0.12, 0.03, 0.9);
      s.pop();
    }
    // light strips, skids on struts, RCS quads
    s.p('glow').box(3.26, Y + 1.9, 3.5, 0.04, 0.07, 15.2);
    s.p('glow').box(2.2, Y + 2.48, 11.95, 0.9, 0.06, 0.05);
    s.p('metal').tube([[2.5, 0.12, -3.2], [2.5, 0.1, 9.6], [2.5, 0.42, 10.6]], 0.12, 8);
    s.p('metal').tube([[2.5, 0.12, -3.2], [2.5, 0.5, -4.2]], 0.12, 8);
    for (const z of [-1.6, 3.6, 8.4]) {
      s.p('dark').tube([[2.5, 0.16, z], [2.6, Y - 2.45, z]], 0.09, 7);
      s.p('dark').tube([[2.5, 0.2, z + 0.9], [2.6, Y - 2.4, z + 0.1]], 0.05, 5);
    }
    for (const z of [-3.9, 11.3]) {
      s.p('dark').bevelBox(3.3, Y - 1.5, z, 0.3, 0.4, 0.4, 0.05);
      for (const [dy, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]] as const) zCyl(s.p('metal'), 3.5, Y - 1.5 + dy, z + dz - 0.06, z + dz + 0.06, 0.07, 0.09, 7);
    }
  });
  // main engines + rear cargo door (closed: frame, seam, lock bar), boarding ladder
  both(s, () => {
    zCyl(s.p('dark'), 1.7, Y + 0.5, 11.9, 13.2, 1.15, 1.3, 18);
    zLathe(s.p('dark', 1.3), 1.7, Y + 0.5, 13.2, [[1.3, 0], [1.48, 1.1], [1.34, 1.1], [1.0, 0.15]], 18);
    zCyl(s.p('engine'), 1.7, Y + 0.5, 13.34, 13.4, 1.04, 1.04, 18);
  });
  s.p('dark').bevelBox(0, Y - 1.05, 12.08, 3.2, 2.3, 0.2, 0.06);
  s.p('metal').bevelBox(0, Y - 1.05, 12.2, 2.9, 0.12, 0.08, 0.02).box(0, Y - 1.05, 12.2, 0.06, 2.1, 0.06);
  for (const x of [-0.25, 0.25]) s.p('metal').tube([[x - 2.6, 0.2, 12.4], [x - 2.6, Y - 2.0, 12.25]], 0.035, 5);
  for (let i = 0; i < 5; i++) s.p('metal').tube([[-2.85, 0.4 + i * 0.28, 12.4 - i * 0.03], [-2.35, 0.4 + i * 0.28, 12.4 - i * 0.03]], 0.025, 5);
  // roof: sensor bar, mast, dish on a pedestal, cable trunk
  s.p('metal').bevelBox(0, Y + 2.62, -0.5, 4.2, 0.26, 0.9, 0.06);
  s.p('metal').tube([[1.6, Y + 2.7, -0.5], [1.6, Y + 5.5, -0.5]], [0.09, 0.03], 6);
  s.p('glow').box(1.6, Y + 5.55, -0.5, 0.1, 0.1, 0.1);
  s.p('metal').tube([[-1.3, Y + 2.5, 5.0], [-1.3, Y + 3.4, 5.0]], 0.1, 7);
  s.push().translate(-1.3, Y + 3.55, 5.0).rotateX(-0.8);
  s.p('metal').lathe(0, 0, [[0.12, 0], [0.7, 0.18], [1.25, 0.6], [1.2, 0.6], [0.66, 0.24], [0.08, 0.08]], 18);
  s.p('dark').tube([[0, 0.1, 0], [0, 0.85, 0]], 0.03, 5);
  s.pop();
  s.p('accent').tube([[-2.0, Y + 2.5, -4.2], [-2.0, Y + 2.52, 10.8]], 0.09, 6);
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
