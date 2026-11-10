/**
 * Heads: a sculpted stylised face (brow, sockets, nose, lips, ears), hair styles and beards.
 * Everything is authored relative to the head joint (base of the skull) and bound rigidly to the head bone.
 */
import { MeshBuilder, PART, ZONE, type Surf } from '../geo/builder';
import { loft, ball, box, tube, type Sec, type V3 } from '../geo/prims';
import type { RigView } from '../rig';

export type HairStyle = 'crop' | 'bun' | 'tail' | 'bob' | 'tied' | 'bald' | 'buzz';

export interface HeadLook {
  skin: Surf;
  hair: Surf;
  style: HairStyle;
  beard?: boolean;
  /** jaw width multiplier (1 = default; <1 finer) */
  jaw?: number;
  /** eye colour (emissive eyes for the Linkbound use `eyeGlow`) */
  eye?: number;
  eyeGlow?: { color: number; glow: number };
  /** grey streaks etc. */
  age?: number;
}

const g = (x: number, c: number, s: number): number => { const d = (x - c) / s; return Math.exp(-d * d); };

/** Skull + face sections (head-joint local y). */
export function skullSecs(jaw = 1): Sec[] {
  return [
    { y: -0.05, rx: 0.046, rz: 0.05, rzb: 0.052, cz: 0.004 },
    { y: -0.028, rx: 0.05 * jaw, rz: 0.078, rzb: 0.056, n: 2.2 },
    { y: 0.0, rx: 0.062 * jaw, rz: 0.091, rzb: 0.07, n: 2.3 },
    { y: 0.035, rx: 0.07 * (0.5 + 0.5 * jaw), rz: 0.096, rzb: 0.086, n: 2.2 },
    { y: 0.075, rx: 0.074, rz: 0.097, rzb: 0.096, n: 2.1 },
    { y: 0.112, rx: 0.076, rz: 0.094, rzb: 0.102, n: 2.1 },
    { y: 0.15, rx: 0.076, rz: 0.096, rzb: 0.103, n: 2.1 },
    { y: 0.19, rx: 0.068, rz: 0.086, rzb: 0.094 },
    { y: 0.215, rx: 0.048, rz: 0.058, rzb: 0.066 },
  ];
}

/** radial sculpt: sockets, brow, nose bridge, cheekbones, temples */
function faceFn(th: number, _v: number, y: number): number {
  const a = Math.abs(th);
  let m = 1;
  m -= 0.095 * g(a, 0.42, 0.21) * g(y, 0.1, 0.021);          // eye sockets
  m += 0.05 * g(a, 0.36, 0.44) * g(y, 0.128, 0.015);         // brow ridge
  m += 0.02 * g(a, 0, 0.14) * g(y, 0.09, 0.03);              // nose root
  m += 0.04 * g(a, 0.78, 0.22) * g(y, 0.068, 0.028);         // cheekbones
  m -= 0.03 * g(a, 1.25, 0.3) * g(y, 0.12, 0.04);            // temples
  m += 0.03 * g(a, 0, 0.32) * g(y, 0.018, 0.022);            // mouth mound
  m += 0.04 * g(a, 0, 0.26) * g(y, -0.024, 0.016);           // chin
  m -= 0.03 * g(a, 0.6, 0.24) * g(y, 0.012, 0.03);           // hollow under the cheeks
  m += 0.025 * g(a, 1.05, 0.2) * g(y, -0.012, 0.022);        // jaw angle
  return m;
}

export function buildHead(b: MeshBuilder, rig: RigView, look: HeadLook): void {
  const head = rig.i('head');
  const [hx, hy, hz] = rig.p('head');
  const skin: Surf = { part: PART.skin, rough: 0.5, zone: ZONE.head, ...look.skin };
  const jaw = look.jaw ?? 1;
  b.skin(head);
  b.scope(() => {
    b.translate(hx, hy, hz);
    b.surf(skin);
    loft(b, skullSecs(jaw), { seg: 28, smooth: 4, capB: { dome: 0.014, k: 2 }, fn: faceFn });

    // nose: a broad wedge that grows out of the brow rather than a stick
    b.scope(() => {
      b.at(0, 0.06, -0.0925, -9, 0, 0);
      loft(b, [
        { y: 0.05, rx: 0.0085, rz: 0.004, rzb: 0.012 },
        { y: 0.022, rx: 0.0105, rz: 0.0125, rzb: 0.012 },
        { y: -0.001, rx: 0.0165, rz: 0.0215, rzb: 0.012 },
        { y: -0.0135, rx: 0.015, rz: 0.014, rzb: 0.012 },
      ], { seg: 8, smooth: 2, capA: 'dome', capB: { dome: 0.005, k: 1 } });
    });
    // mouth: a quiet line, slightly darker than the skin
    b.surf({ ...skin, color: mixHex(look.skin.color, 0x5a2a26, 0.38), rough: 0.45 });
    b.scope(() => { b.translate(0, 0.0205, -0.0915); ball(b, 0.0205 * (0.6 + 0.4 * jaw), 0.0042, 0.0072, 10, 4); });
    b.surf({ ...skin, color: mixHex(look.skin.color, 0x5a2a26, 0.16), rough: 0.5 });
    b.scope(() => { b.translate(0, 0.0125, -0.09); ball(b, 0.0165 * (0.6 + 0.4 * jaw), 0.005, 0.0075, 10, 4); });
    // ears
    b.surf(skin);
    for (const s of [-1, 1]) b.scope(() => { b.at(s * 0.0745, 0.082, 0.012, 0, s * -18, s * -6); ball(b, 0.007, 0.026, 0.015, 8, 5); });

    // eyes: dark almonds set back under the brow (lit eyes for the coerced)
    for (const s of [-1, 1]) {
      b.scope(() => {
        b.at(s * 0.0312, 0.1005, -0.0818, 0, s * -10, s * 4);
        if (look.eyeGlow) {
          b.surf({ color: 0x100818, rough: 0.3, part: PART.glow, zone: ZONE.head, emissive: look.eyeGlow.color, glow: look.eyeGlow.glow });
          ball(b, 0.0125, 0.0072, 0.0072, 8, 4);
        } else {
          b.surf({ color: 0xcfc8be, rough: 0.25, part: PART.glass, zone: ZONE.head });
          ball(b, 0.0128, 0.0056, 0.006, 10, 4);
          b.surf({ color: look.eye ?? 0x2a1c12, rough: 0.1, part: PART.glass, zone: ZONE.head });
          b.translate(-s * 0.0008, 0, -0.0026);
          ball(b, 0.0066, 0.0056, 0.0046, 8, 4);
          // upper lid: a sliver of skin that gives the eye its shape
          b.surf(skin);
          b.translate(s * 0.0008, 0.0046, 0.0012);
          ball(b, 0.0145, 0.0034, 0.0062, 10, 4);
        }
      });
    }
    // brows
    const hair: Surf = { part: PART.hair, rough: 0.6, zone: ZONE.head, ...look.hair };
    b.surf({ ...hair, color: mixHex(look.hair.color, 0x000000, 0.25) });
    for (const s of [-1, 1]) b.scope(() => { b.at(s * 0.032, 0.1195, -0.0895, 12, s * -22, s * -5); box(b, 0.036, 0.0075, 0.01, { bevel: 0.0025, edge: 0 }); });

    if (look.style !== 'bald') buildHair(b, look.style, hair);
    if (look.beard) buildBeard(b, hair, jaw);
  });
}

function buildHair(b: MeshBuilder, style: HairStyle, hair: Surf): void {
  b.surf(hair);
  const T = style === 'buzz' ? 0.004 : style === 'crop' ? 0.011 : 0.013;
  // cap: tilted rings from the hairline plane (high at the forehead, low at the nape) up to the crown
  const low = style === 'bob' ? 0.045 : style === 'buzz' || style === 'crop' ? 0.088 : 0.082;
  const tilt = style === 'bob' ? 44 : 36;
  const cap: Sec[] = [
    { y: low, rx: 0.079 + T, rz: 0.1 + T, rzb: 0.118 + T, tilt, cz: 0.006 },
    { y: low + 0.035, rx: 0.08 + T, rz: 0.094 + T, rzb: 0.112 + T, tilt: tilt * 0.72, cz: 0.006 },
    { y: 0.155, rx: 0.077 + T, rz: 0.09 + T, rzb: 0.104 + T, tilt: tilt * 0.38, cz: 0.005 },
    { y: 0.192, rx: 0.068 + T, rz: 0.083 + T, rzb: 0.094 + T, tilt: tilt * 0.12, cz: 0.004 },
    { y: 0.218, rx: 0.048 + T, rz: 0.058 + T, rzb: 0.066 + T, cz: 0.003 },
  ];
  loft(b, cap, { seg: 22, smooth: 3, capB: { dome: 0.016 + T * 0.4, k: 2 }, fn: (th, v) => 1 + (style === 'buzz' ? 0 : 0.012 * Math.sin(th * 9 + v * 5) + 0.035 * g(th, 0, 0.8) * (1 - v)) });

  if (style === 'bun' || style === 'tied') {
    // swept-back knot
    const y = style === 'bun' ? 0.142 : 0.085, z = style === 'bun' ? 0.122 : 0.118;
    b.scope(() => { b.translate(0, y, z); ball(b, style === 'bun' ? 0.046 : 0.038, style === 'bun' ? 0.044 : 0.036, 0.038, 12, 6); });
    b.scope(() => { b.at(0, y + 0.004, z - 0.028, 90, 0, 0); loft(b, [{ y: -0.01, rx: 0.026, rz: 0.026 }, { y: 0.012, rx: 0.03, rz: 0.03 }], { seg: 10, thick: 0.01 }); });
    // loose side strands frame the face
    for (const s of [-1, 1]) {
      const pts: V3[] = [[s * 0.066, 0.168, -0.062], [s * 0.079, 0.12, -0.058], [s * 0.081, 0.06, -0.05], [s * 0.076, 0.012, -0.046]];
      tube(b, pts, [0.011, 0.01, 0.008, 0.004], { seg: 5, flat: 0.5 });
    }
  } else if (style === 'tail') {
    const pts: V3[] = [[0, 0.17, 0.1], [0, 0.165, 0.135], [0, 0.11, 0.158], [0, 0.03, 0.156], [0, -0.05, 0.14], [0, -0.11, 0.128]];
    tube(b, pts, [0.022, 0.026, 0.027, 0.024, 0.019, 0.008], { seg: 8 });
    b.surf({ ...hair, color: 0x2a2d33, part: PART.plate, metal: 0.8, rough: 0.4 });
    b.scope(() => { b.at(0, 0.167, 0.118, 80, 0, 0); loft(b, [{ y: -0.008, rx: 0.026, rz: 0.026 }, { y: 0.008, rx: 0.026, rz: 0.026 }], { seg: 10, thick: 0.006 }); });
    b.surf(hair);
    for (const s of [-1, 1]) {
      const st: V3[] = [[s * 0.06, 0.176, -0.066], [s * 0.078, 0.13, -0.062], [s * 0.082, 0.075, -0.05]];
      tube(b, st, [0.011, 0.009, 0.004], { seg: 5, flat: 0.5 });
    }
  } else if (style === 'bob') {
    // curtain down to the jaw at sides and back
    loft(b, [
      { y: 0.1, rx: 0.088, rz: 0.03, rzb: 0.118, cz: 0.012 },
      { y: 0.03, rx: 0.09, rz: 0.03, rzb: 0.116, cz: 0.014 },
      { y: -0.035, rx: 0.084, rz: 0.03, rzb: 0.104, cz: 0.014 },
    ], { seg: 16, arc: [62, 298], thick: 0.014, smooth: 2, inner: true });
  } else if (style === 'crop') {
    // a second, shorter layer swept back over the crown: volume without a helmet silhouette
    loft(b, [
      { y: 0.168, rx: 0.073, rz: 0.1, rzb: 0.086, tilt: 20, cz: -0.004 },
      { y: 0.2, rx: 0.07, rz: 0.092, rzb: 0.09, tilt: 10, cz: 0.0 },
      { y: 0.229, rx: 0.05, rz: 0.062, rzb: 0.066, tilt: 2, cz: 0.004 },
    ], { seg: 20, smooth: 3, capB: { dome: 0.016, k: 2 }, fn: (th, v) => 1 + 0.02 * Math.sin(th * 11 + v * 9) + 0.04 * g(th, 0, 0.5) * (1 - v) });
  }
}

function buildBeard(b: MeshBuilder, hair: Surf, jaw: number): void {
  b.surf({ ...hair, color: mixHex(hair.color, 0x000000, 0.12) });
  // jaw wrap: open shell across the front half, from the cheeks down under the chin
  const S = (y: number, rx: number, rz: number): Sec => ({ y, rx: rx * (0.55 + 0.45 * jaw) + 0.003, rz: rz + 0.003, rzb: rz, a0: -106, a1: 106, cz: 0.002 });
  loft(b, [S(0.052, 0.076, 0.098), S(0.03, 0.075, 0.101), S(0.004, 0.069, 0.102), S(-0.022, 0.058, 0.094), S(-0.044, 0.043, 0.074)],
    { seg: 18, smooth: 3, thick: 0.014, bevel: 0.005, fn: (th, _v, y) => 1 - 0.075 * g(Math.abs(th), 0, 0.3) * g(y, 0.021, 0.011) });
  // moustache
  for (const s of [-1, 1]) {
    const pts: V3[] = [[s * 0.003, 0.035, -0.101], [s * 0.016, 0.033, -0.099], [s * 0.03, 0.022, -0.091]];
    tube(b, pts, [0.006, 0.0058, 0.003], { seg: 5 });
  }
}

/** Mix two sRGB hex colours. */
export function mixHex(a: number, c: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (c >> 16) & 255, bg = (c >> 8) & 255, bb = c & 255;
  const r = Math.round(ar + (br - ar) * t), gg = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}
