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
function skullSecs(jaw: number): Sec[] {
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
  m -= 0.075 * g(a, 0.4, 0.2) * g(y, 0.103, 0.022);          // eye sockets
  m += 0.045 * g(a, 0.34, 0.42) * g(y, 0.132, 0.016);        // brow ridge
  m += 0.05 * g(a, 0, 0.13) * g(y, 0.085, 0.035);            // nose bridge root
  m += 0.03 * g(a, 0.72, 0.22) * g(y, 0.07, 0.03);           // cheekbones
  m -= 0.03 * g(a, 1.25, 0.3) * g(y, 0.12, 0.04);            // temples
  m += 0.03 * g(a, 0, 0.3) * g(y, 0.018, 0.022);             // mouth mound
  m += 0.035 * g(a, 0, 0.25) * g(y, -0.024, 0.016);          // chin
  m -= 0.025 * g(a, 0.55, 0.25) * g(y, 0.012, 0.03);         // under the cheeks
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
    loft(b, skullSecs(jaw), { seg: 26, smooth: 4, capB: { dome: 0.014, k: 2 }, fn: faceFn });

    // nose
    b.scope(() => {
      b.at(0, 0.062, -0.094, -14, 0, 0);
      loft(b, [
        { y: 0.052, rx: 0.0075, rz: 0.008, rzb: 0.012 },
        { y: 0.02, rx: 0.01, rz: 0.015, rzb: 0.012 },
        { y: -0.004, rx: 0.0145, rz: 0.021, rzb: 0.012 },
        { y: -0.016, rx: 0.0135, rz: 0.015, rzb: 0.012 },
      ], { seg: 8, smooth: 2, capA: 'dome', capB: { dome: 0.006, k: 1 } });
    });
    // lips
    b.surf({ ...skin, color: mixHex(look.skin.color, 0x7a3030, 0.4), rough: 0.42 });
    b.scope(() => { b.translate(0, 0.02, -0.0905); ball(b, 0.021 * (0.6 + 0.4 * jaw), 0.0058, 0.008, 10, 4); });
    // ears
    b.surf(skin);
    for (const s of [-1, 1]) b.scope(() => { b.at(s * 0.0745, 0.082, 0.012, 0, s * -18, s * -6); ball(b, 0.007, 0.026, 0.015, 8, 5); });

    // eyes: sclera + iris, recessed in the sockets
    for (const s of [-1, 1]) {
      b.scope(() => {
        b.translate(s * 0.0315, 0.1035, -0.0795);
        if (look.eyeGlow) {
          b.surf({ color: 0x100818, rough: 0.3, part: PART.glow, zone: ZONE.head, emissive: look.eyeGlow.color, glow: look.eyeGlow.glow });
          ball(b, 0.0125, 0.0075, 0.0075, 8, 4);
        } else {
          b.surf({ color: 0xd9d4cc, rough: 0.22, part: PART.glass, zone: ZONE.head });
          ball(b, 0.0125, 0.0068, 0.007, 8, 4);
          b.surf({ color: look.eye ?? 0x2a1c12, rough: 0.12, part: PART.glass, zone: ZONE.head });
          b.translate(0, 0, -0.0042);
          ball(b, 0.0058, 0.0058, 0.0042, 8, 4);
        }
      });
    }
    // brows
    const hair: Surf = { part: PART.hair, rough: 0.6, zone: ZONE.head, ...look.hair };
    b.surf({ ...hair, color: mixHex(look.hair.color, 0x000000, 0.25) });
    for (const s of [-1, 1]) b.scope(() => { b.at(s * 0.032, 0.1235, -0.0905, 8, s * -20, s * -7); box(b, 0.034, 0.0065, 0.009, { bevel: 0.002, edge: 0 }); });

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
  loft(b, cap, { seg: 22, smooth: 3, capB: { dome: 0.016 + T * 0.4, k: 2 }, fn: (th, v) => 1 + 0.012 * Math.sin(th * 9 + v * 5) * (style === 'buzz' ? 0 : 1) });

  if (style === 'bun' || style === 'tied') {
    // swept-back knot
    const y = style === 'bun' ? 0.17 : 0.085, z = style === 'bun' ? 0.108 : 0.118;
    b.scope(() => { b.translate(0, y, z); ball(b, 0.038, 0.036, 0.034, 12, 6); });
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
    // short textured fringe
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.024;
      const pts: V3[] = [[x, 0.198, -0.062], [x * 1.08, 0.186, -0.09], [x * 1.1, 0.165, -0.1]];
      tube(b, pts, [0.014, 0.012, 0.006], { seg: 5, flat: 0.55 });
    }
  }
}

function buildBeard(b: MeshBuilder, hair: Surf, jaw: number): void {
  b.surf({ ...hair, color: mixHex(hair.color, 0x000000, 0.12) });
  // jaw wrap: open shell across the front half, from the cheeks down under the chin
  const S = (y: number, rx: number, rz: number, a: number): Sec => ({ y, rx: rx * (0.55 + 0.45 * jaw), rz, rzb: rz, a0: -a, a1: a, cz: 0.002 });
  loft(b, [S(0.058, 0.075, 0.097, 112), S(0.03, 0.074, 0.101, 108), S(0.004, 0.068, 0.101, 100), S(-0.022, 0.057, 0.092, 92), S(-0.042, 0.042, 0.072, 84)],
    { seg: 14, smooth: 2, thick: 0.012, bevel: 0.004, fn: (th, _v, y) => 1 - 0.07 * g(Math.abs(th), 0, 0.3) * g(y, 0.022, 0.012) });
  // moustache
  for (const s of [-1, 1]) {
    const pts: V3[] = [[s * 0.003, 0.036, -0.1], [s * 0.016, 0.034, -0.098], [s * 0.03, 0.024, -0.09]];
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
