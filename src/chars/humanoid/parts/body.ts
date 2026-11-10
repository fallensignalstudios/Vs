/**
 * Base body: the flexible layer under the armour — torso, neck, arms, legs, hands and boots.
 * It is what shows at every joint, so it is smooth-skinned across hips/spine/chest, elbows, knees and wrists.
 */
import { MeshBuilder, PART, ZONE, type SkinFn, type Surf } from '../geo/builder';
import { loft, type Sec } from '../geo/prims';
import { RigView, blendY, blendZ, chainY, smooth01 } from '../rig';

export interface BodyLook {
  /** undersuit / clothing on torso + limbs */
  suit: Surf;
  /** second fabric for the legs (trousers) — defaults to suit */
  legs?: Surf;
  skin: Surf;
  /** gloves; omit for bare hands */
  glove?: Surf;
  boot: Surf;
  sole?: Surf;
  /** bare forearms (rolled sleeves) */
  bareArms?: boolean;
  /** skip the boots (sabatons replace them) */
  noBoots?: boolean;
}

/** Linear interpolation of the arm centre line through shoulder → elbow → wrist. */
function armLine(rig: RigView, side: number): (y: number) => [number, number] {
  const s = rig.sp('uArm', side), e = rig.sp('fArm', side), w = rig.sp('hand', side);
  return (y) => {
    if (y >= e[1]) { const t = (s[1] - y) / (s[1] - e[1]); return [s[0] + (e[0] - s[0]) * t, s[2] + (e[2] - s[2]) * t]; }
    const t = (e[1] - y) / (e[1] - w[1]);
    return [e[0] + (w[0] - e[0]) * t, e[2] + (w[2] - e[2]) * t];
  };
}

/** Linear interpolation of the leg centre line through hip → knee → ankle. */
export function legLine(rig: RigView, side: number): (y: number) => [number, number] {
  const h = rig.sp('thigh', side), k = rig.sp('shin', side), a = rig.sp('foot', side);
  return (y) => {
    if (y >= k[1]) { const t = Math.min(1, Math.max(-0.2, (h[1] - y) / (h[1] - k[1]))); return [h[0] + (k[0] - h[0]) * t, h[2] + (k[2] - h[2]) * t]; }
    const t = (k[1] - y) / (k[1] - a[1]);
    return [k[0] + (a[0] - k[0]) * t, k[2] + (a[2] - k[2]) * t];
  };
}

export function torsoSkin(rig: RigView): SkinFn {
  return chainY(rig.i('chest'), rig.i('spine'), rig.i('hips'), rig.y('chest'), rig.y('spine'), 0.07, 0.06);
}

export function armSkin(rig: RigView, side: number): SkinFn {
  return chainY(rig.si('uArm', side), rig.si('fArm', side), rig.si('hand', side), rig.sp('fArm', side)[1], rig.sp('hand', side)[1], 0.045, 0.014);
}

export function legSkin(rig: RigView, side: number): SkinFn {
  const hips = rig.i('hips'), th = rig.si('thigh', side), sh = rig.si('shin', side), ft = rig.si('foot', side);
  const ky = rig.sp('shin', side)[1], ay = rig.sp('foot', side)[1];
  return (_x, y, _z, o) => {
    const tHip = smooth01(0.9, 1.0, y) * 0.75;
    const tKnee = smooth01(ky + 0.05, ky - 0.05, y);
    const tAnk = smooth01(ay + 0.03, ay - 0.01, y);
    o.i0 = hips; o.w0 = tHip;
    o.i1 = th; o.w1 = (1 - tHip) * (1 - tKnee);
    o.i2 = sh; o.w2 = tKnee * (1 - tAnk);
    o.i3 = ft; o.w3 = tKnee * tAnk;
  };
}

/** Torso cross-sections shared by the undersuit and (inflated) by cuirasses. */
export function torsoSecs(rig: RigView, inflate = 0, yMin = 0.855, yMax = 1.52): Sec[] {
  const p = rig.prop;
  const k = p.bulk, f = p.fem, sw = p.shoulder;
  const W = (m: number, fm: number): number => (m + (fm - m) * f) * k + inflate;
  const all: Sec[] = [
    { y: 0.855, rx: W(0.09, 0.09), rz: W(0.082, 0.08), rzb: W(0.092, 0.095), n: 2.4 },
    { y: 0.93, rx: W(0.168, 0.176), rz: W(0.1, 0.096), rzb: W(0.116, 0.122), n: 2.5 },
    { y: 1.02, rx: W(0.158, 0.156), rz: W(0.1, 0.094), rzb: W(0.104, 0.104), n: 2.5 },
    { y: 1.11, rx: W(0.142, 0.122), rz: W(0.098, 0.086), rzb: W(0.092, 0.086), n: 2.4 },
    { y: 1.22, rx: W(0.158, 0.136), rz: W(0.112, 0.102), rzb: W(0.1, 0.092), n: 2.4 },
    { y: 1.33, rx: W(0.186, 0.156), rz: W(0.128, 0.126), rzb: W(0.11, 0.1), n: 2.5 },
    { y: 1.42, rx: sw * k + 0.012 + inflate, rz: W(0.116, 0.108), rzb: W(0.114, 0.104), n: 2.6 },
    { y: 1.478, rx: (sw - 0.05) * k + inflate, rz: W(0.086, 0.078), rzb: W(0.098, 0.09), n: 2.3 },
    { y: 1.52, rx: 0.068 * k + inflate, rz: 0.06 * k + inflate, rzb: 0.07 * k + inflate, cz: 0.008 },
  ];
  return all.filter((s) => s.y >= yMin - 1e-6 && s.y <= yMax + 1e-6);
}

/** Arm cross-sections (shoulder → wrist) for one side; shared with the armour so plates conform. */
export function armSecs(rig: RigView, side: number): Sec[] {
  const k = rig.prop.bulk;
  const line = armLine(rig, side);
  const sy = rig.sp('uArm', side)[1], ey = rig.sp('fArm', side)[1], wy = rig.sp('hand', side)[1];
  const A = (y: number, rx: number, rz: number): Sec => {
    const [cx, cz] = line(y);
    return { y, rx: rx * k, rz: rz * k, cx, cz };
  };
  return [
    A(sy + 0.028, 0.046, 0.052), A(sy - 0.01, 0.06, 0.066), A(sy - 0.09, 0.055, 0.06), A(sy - 0.18, 0.05, 0.054),
    A(ey + 0.035, 0.044, 0.046), A(ey, 0.042, 0.044), A(ey - 0.05, 0.047, 0.047), A(ey - 0.14, 0.041, 0.04),
    A(wy + 0.03, 0.029, 0.034), A(wy + 0.004, 0.026, 0.032),
  ];
}

/** Leg cross-sections (hip → ankle) for one side. */
export function legSecs(rig: RigView, side: number): Sec[] {
  const k = rig.prop.bulk;
  const ll = legLine(rig, side);
  const ky = rig.sp('shin', side)[1], ay = rig.sp('foot', side)[1];
  const Lg = (y: number, rx: number, rz: number, rzb: number): Sec => {
    const [cx, cz] = ll(y);
    return { y, rx: rx * k, rz: rz * k, rzb: rzb * k, cx, cz };
  };
  return [
    Lg(0.99, 0.066, 0.07, 0.074), Lg(0.93, 0.086, 0.092, 0.096), Lg(0.8, 0.086, 0.094, 0.094), Lg(0.66, 0.075, 0.08, 0.08),
    Lg(ky + 0.04, 0.06, 0.062, 0.06), Lg(ky, 0.057, 0.06, 0.056), Lg(ky - 0.07, 0.054, 0.05, 0.064), Lg(ky - 0.17, 0.051, 0.047, 0.064),
    Lg(ky - 0.3, 0.042, 0.041, 0.046), Lg(ay + 0.02, 0.037, 0.038, 0.04),
  ];
}

/** Interpolate a section list (descending or ascending y) at height y, grown by `inflate`. */
export function secAt(secs: Sec[], y: number, inflate = 0): Sec {
  const asc = secs[secs.length - 1].y > secs[0].y;
  const S = asc ? secs : [...secs].reverse();
  let i = 0;
  while (i < S.length - 2 && S[i + 1].y < y) i++;
  const a = S[i], c = S[i + 1];
  const t = Math.min(1, Math.max(0, (y - a.y) / (c.y - a.y || 1)));
  const L = (u: number | undefined, v: number | undefined, d: number): number => (u ?? d) + ((v ?? d) - (u ?? d)) * t;
  return {
    y, rx: L(a.rx, c.rx, 0) + inflate, rz: L(a.rz, c.rz, 0) + inflate, rzb: L(a.rzb ?? a.rz, c.rzb ?? c.rz, 0) + inflate,
    cx: L(a.cx, c.cx, 0), cz: L(a.cz, c.cz, 0), n: L(a.n, c.n, 2),
  };
}

export function buildBody(b: MeshBuilder, rig: RigView, look: BodyLook): void {
  const p = rig.prop;
  const k = p.bulk;
  const suit: Surf = { part: PART.suit, rough: 0.72, ...look.suit };
  const legSurf: Surf = { part: PART.suit, rough: 0.72, ...(look.legs ?? look.suit) };
  const skin: Surf = { part: PART.skin, rough: 0.55, ...look.skin };

  // ---- torso ---------------------------------------------------------------------------------------------
  b.surf({ ...suit, zone: ZONE.chest }).skin(torsoSkin(rig));
  loft(b, torsoSecs(rig), { seg: 22, smooth: 3, capA: 'dome' });

  // ---- neck ----------------------------------------------------------------------------------------------
  b.surf({ ...skin, zone: ZONE.head }).skin(chainY(rig.i('head'), rig.i('neck'), rig.i('chest'), rig.y('head') + 0.01, rig.y('neck'), 0.03, 0.03));
  loft(b, [
    { y: 1.485, rx: 0.062 * k, rz: 0.06 * k, cz: 0.012 },
    { y: 1.55, rx: 0.052 * k, rz: 0.054 * k, cz: 0.012 },
    { y: 1.61, rx: 0.05 * k, rz: 0.055 * k, cz: 0.006 },
    { y: 1.655, rx: 0.052 * k, rz: 0.058 * k, cz: 0.004 },
  ], { seg: 12, smooth: 2 });

  for (const side of [-1, 1]) {
    // ---- arm ---------------------------------------------------------------------------------------------
    const arm = armSecs(rig, side);
    b.skin(armSkin(rig, side));
    if (look.bareArms) {
      b.surf({ ...suit, zone: ZONE.arm });
      loft(b, arm.slice(0, 5), { seg: 12, smooth: 2, capA: 'dome' });
      b.surf({ ...skin, zone: ZONE.arm });
      loft(b, arm.slice(4), { seg: 12, smooth: 2, capB: 'flat' });
    } else {
      b.surf({ ...suit, zone: ZONE.arm });
      loft(b, arm, { seg: 12, smooth: 2, capA: 'dome', capB: 'flat' });
    }

    // ---- hand ------------------------------------------------------------------------------------------
    buildHand(b, rig, side, look.glove ? { part: PART.leather, rough: 0.6, ...look.glove } : skin);

    // ---- leg -------------------------------------------------------------------------------------------
    b.surf({ ...legSurf, zone: ZONE.leg }).skin(legSkin(rig, side));
    loft(b, legSecs(rig, side), { seg: 14, smooth: 2, capA: 'dome', capB: 'flat' });

    if (!look.noBoots) buildBoot(b, rig, side, { part: PART.leather, rough: 0.55, ...look.boot }, look.sole ?? { color: 0x0c0c0e, rough: 0.8, part: PART.suit });
  }
}

/** Hand: palm + four two-segment fingers (curl bones) + opposed thumb. */
export function buildHand(b: MeshBuilder, rig: RigView, side: number, surf: Surf): void {
  const k = Math.min(1.12, Math.max(0.92, rig.prop.bulk));
  const hand = rig.si('hand', side), fa = rig.si('fingA', side), fb = rig.si('fingB', side);
  const h = rig.sp('hand', side), ka = rig.sp('fingA', side), kb = rig.sp('fingB', side);
  const inward = -side;
  b.surf({ ...surf, zone: ZONE.arm }).skin(hand);
  // palm: flattened box-ish loft from the wrist to the knuckle line
  loft(b, [
    { y: h[1] + 0.012, rx: 0.02 * k, rz: 0.028 * k, cx: h[0], cz: h[2], n: 2.6 },
    { y: h[1] - 0.03, rx: 0.019 * k, rz: 0.04 * k, cx: h[0] + 0.001 * side, cz: h[2] - 0.004, n: 3 },
    { y: ka[1] + 0.008, rx: 0.017 * k, rz: 0.044 * k, cx: ka[0], cz: ka[2], n: 3 },
    { y: ka[1] - 0.006, rx: 0.014 * k, rz: 0.042 * k, cx: ka[0], cz: ka[2], n: 3 },
  ], { seg: 10, capA: 'flat', capB: 'flat' });
  // fingers
  const zs = [-0.031, -0.0105, 0.0095, 0.028];
  const len = [0.074, 0.084, 0.079, 0.064];
  b.skin(blendY(fa, fb, kb[1] + 0.012, kb[1] - 0.012));
  for (let i = 0; i < 4; i++) {
    const z = ka[2] + zs[i] * k, top = ka[1] + 0.006, bot = ka[1] - len[i] * k;
    const r = (i === 3 ? 0.0088 : 0.0102) * k;
    loft(b, [
      { y: top, rx: r, rz: r, cx: ka[0], cz: z },
      { y: kb[1], rx: r * 1.02, rz: r, cx: ka[0], cz: z },
      { y: bot + 0.012, rx: r * 0.9, rz: r * 0.9, cx: ka[0], cz: z },
    ], { seg: 6, capB: 'dome' });
  }
  // thumb: opposes the fingers from the front edge of the palm
  b.skin(hand);
  b.scope(() => {
    b.at(h[0] + inward * 0.006, h[1] - 0.03, h[2] - 0.036, 28, 0, inward * 34);
    loft(b, [
      { y: 0.012, rx: 0.0125 * k, rz: 0.013 * k },
      { y: -0.03, rx: 0.0115 * k, rz: 0.012 * k },
      { y: -0.06, rx: 0.0095 * k, rz: 0.0098 * k },
    ], { seg: 6, capA: 'dome', capB: 'dome' });
  });
}

/** Plain boot (soldiers, undersuit). Sabatons build on the same footprint. */
export function buildBoot(b: MeshBuilder, rig: RigView, side: number, surf: Surf, sole: Surf): void {
  const a = rig.sp('foot', side), t = rig.sp('toe', side);
  const foot = rig.si('foot', side), toe = rig.si('toe', side), shin = rig.si('shin', side);
  const k = Math.min(1.15, Math.max(0.92, rig.prop.bulk));
  b.surf({ ...surf, zone: ZONE.leg }).skin(blendZ(foot, toe, t[2] + 0.035, t[2] - 0.015));
  b.scope(() => {
    // loft along the foot: local +Y → forward (−Z), local Z → up
    b.at(a[0], 0, a[2], -90, 0, 0);
    const S = (y: number, rx: number, hgt: number, n = 3): Sec => ({ y, rx: rx * k, rz: hgt / 2, rzb: hgt / 2, cz: hgt / 2 + 0.012, n });
    loft(b, [S(-0.078, 0.034, 0.06), S(-0.055, 0.043, 0.1), S(0.0, 0.047, 0.118), S(0.06, 0.05, 0.082), S(0.12, 0.053, 0.058), S(0.168, 0.049, 0.046), S(0.2, 0.038, 0.034)],
      { seg: 12, smooth: 2, capA: { dome: 0.012, k: 1 }, capB: { dome: 0.02, k: 2 } });
    // sole
    b.surf({ ...sole, zone: ZONE.leg });
    const So = (y: number, rx: number): Sec => ({ y, rx: rx * k, rz: 0.009, rzb: 0.009, cz: 0.009, n: 4 });
    loft(b, [So(-0.082, 0.036), So(-0.05, 0.046), So(0.03, 0.05), So(0.12, 0.056), So(0.175, 0.051), So(0.208, 0.038)], { seg: 12, capA: 'flat', capB: 'flat' });
  });
  // shaft around the ankle
  b.surf({ ...surf, zone: ZONE.leg }).skin(blendY(shin, foot, a[1] + 0.05, a[1] - 0.005));
  const ll = legLine(rig, side);
  const Sh = (y: number, r: number): Sec => { const [cx, cz] = ll(y); return { y, rx: r * k, rz: r * k, rzb: r * 1.08 * k, cx, cz }; };
  loft(b, [Sh(a[1] - 0.02, 0.046), Sh(a[1] + 0.06, 0.047), Sh(a[1] + 0.15, 0.052), Sh(a[1] + 0.2, 0.056)], { seg: 12, thick: 0.01 });
}
