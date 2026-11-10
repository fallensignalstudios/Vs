/**
 * Headgear, cloth garments and field dressings: helmets for both factions, hoods, visors, bandages,
 * leg-following skirts / coats / robes, static mantles.
 */
import { MeshBuilder, PART, ZONE, type SkinFn, type Surf } from '../geo/builder';
import { loft, box, tube, torus, ball, type Sec, type V3 } from '../geo/prims';
import { smooth01, type RigView } from '../rig';
import { secAt, torsoSecs } from './body';
import { skullSecs } from './head';
import type { Pal } from './armor';

const g = (x: number, c: number, s: number): number => { const d = (x - c) / s; return Math.exp(-d * d); };
const H: Partial<Surf> = { zone: ZONE.head };

/** Run fn in head space (origin at the head joint), bound to the head bone. */
function inHead(b: MeshBuilder, rig: RigView, fn: () => void): void {
  const [x, y, z] = rig.p('head');
  b.scope(() => { b.translate(x, y, z); b.skin(rig.i('head')); fn(); });
}

function shellAt(skull: Sec[], ys: number[], inflate: number | ((y: number) => number), extra: (y: number) => Partial<Sec> = () => ({})): Sec[] {
  return ys.map((y) => ({ ...secAt(skull, y, typeof inflate === 'function' ? inflate(y) : inflate), ...extra(y) }));
}

export type HelmetKind = 'domSoldier' | 'enforcer' | 'refSoldier' | 'marine' | 'medic';

export function helmet(b: MeshBuilder, rig: RigView, pal: Pal, kind: HelmetKind, crest = true): void {
  const skull = skullSecs(1);
  inHead(b, rig, () => {
    if (kind === 'domSoldier' || kind === 'enforcer') {
      const heavy = kind === 'enforcer';
      const inf = heavy ? 0.03 : 0.022;
      // bowl with a sagittal crest
      b.surf({ ...pal.plate, ...H });
      loft(b, shellAt(skull, [-0.05, -0.01, 0.04, 0.09, 0.14, 0.185, 0.215], (y) => inf + (y < 0 ? 0.012 : 0)), {
        seg: 22, smooth: 2, capB: { dome: 0.02 + inf * 0.3, k: 2 }, capA: 'flat',
        fn: (th, _v, y) => 1 + (crest ? 0.05 : 0.02) * g(Math.sin(th), 0, 0.09) * smooth01(0.06, 0.16, y) - 0.02 * g(Math.abs(th), 0, 0.5) * g(y, 0.1, 0.03),
      });
      // brow band + cheek frame
      b.surf({ ...pal.trim, ...H });
      loft(b, shellAt(skull, [0.118, 0.14], inf + 0.006), { seg: 22, thick: 0.008 });
      b.surf({ ...pal.plate2, ...H });
      loft(b, shellAt(skull, [-0.055, -0.02, 0.03], inf + 0.01, () => ({ a0: 95, a1: 265 })), { seg: 14, thick: 0.01, trim: { w: 0.006, raise: 0.002, slot: 1, v1: false }, slots: [undefined, { ...pal.trim, ...H }] });
      // visor: dark slit with an amber line; the Enforcer's is a single hard bar
      b.surf({ ...pal.dark, ...H, rough: 0.3 });
      const eye = secAt(skull, 0.102, inf + 0.004);
      if (heavy) {
        loft(b, shellAt(skull, [0.086, 0.118], inf + 0.004, () => ({ a0: -62, a1: 62 })), { seg: 12, thick: 0.006 });
        b.surf({ ...pal.glow, ...H, glow: 3.4 });
        loft(b, shellAt(skull, [0.097, 0.107], inf + 0.008, () => ({ a0: -54, a1: 54 })), { seg: 12, thick: 0.003, bevel: 0.001 });
        // breather slots
        b.surf({ ...pal.dark, ...H });
        for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) b.scope(() => { b.at(sx * (0.022 + i * 0.014), 0.03 - i * 0.004, -(eye.rz * 0.97), 0, sx * -(14 + i * 8), 0); box(b, 0.006, 0.04, 0.008, { bevel: 0.002 }); });
      } else {
        loft(b, shellAt(skull, [0.084, 0.118], inf + 0.004, () => ({ a0: -58, a1: 58 })), { seg: 12, thick: 0.006 });
        b.scope(() => { b.translate(0, 0.03, -(eye.rz + 0.002)); box(b, 0.022, 0.11, 0.012, { bevel: 0.004 }); });
        b.surf({ ...pal.glow, ...H, glow: 3 });
        loft(b, shellAt(skull, [0.098, 0.106], inf + 0.008, () => ({ a0: -50, a1: 50 })), { seg: 12, thick: 0.003, bevel: 0.001 });
      }
      if (heavy && crest) {
        // upright crest plate
        b.surf({ ...pal.enamel, ...H });
        b.scope(() => { b.at(0, 0.24, 0.02, 0, 0, 0); box(b, 0.014, 0.075, 0.2, { bevel: 0.005, taper: [1, 0.72] }); });
        b.surf({ ...pal.trim, ...H });
        b.scope(() => { b.at(0, 0.282, 0.02, 0, 0, 0); box(b, 0.018, 0.012, 0.15, { bevel: 0.004 }); });
      }
    } else {
      const marine = kind === 'marine', medic = kind === 'medic';
      const inf = marine ? 0.026 : 0.018;
      b.surf({ ...pal.plate, ...H });
      loft(b, shellAt(skull, medic ? [0.075, 0.11, 0.15, 0.19, 0.215] : [-0.045, 0.0, 0.05, 0.1, 0.15, 0.19, 0.215], inf, (y) => ({ n: 2.7, ...(medic && y < 0.1 ? { tilt: 26 } : {}) })), {
        seg: 22, smooth: 2, capB: { dome: 0.016 + inf * 0.3, k: 2 }, capA: 'flat',
        fn: (th, _v, y) => 1 + 0.025 * g(Math.sin(th), 0, 0.2) * smooth01(0.1, 0.18, y),
      });
      // ear / comm pods
      for (const sx of [-1, 1]) {
        b.surf({ ...pal.plate2, ...H });
        b.scope(() => { b.at(sx * (secAt(skull, 0.085, inf).rx + 0.004), 0.085, 0.012, 0, 0, sx * -90); loft(b, [{ y: -0.004, rx: 0.034, rz: 0.04 }, { y: 0.012, rx: 0.026, rz: 0.032 }], { seg: 10, capA: 'flat', capB: { dome: 0.006, k: 1 } }); });
        b.surf({ ...pal.glow, ...H, glow: 2.4 });
        b.scope(() => { b.translate(sx * (secAt(skull, 0.085, inf).rx + 0.019), 0.085, 0.012); box(b, 0.004, 0.022, 0.006, { bevel: 0.001, edge: 0 }); });
      }
      if (!medic) {
        // wrap-around visor: dark glass with a cold line
        b.surf({ color: 0x0a0f18, rough: 0.12, metal: 0.6, part: PART.glass, ...H });
        loft(b, shellAt(skull, marine ? [0.03, 0.075, 0.125] : [0.072, 0.1, 0.128], inf + 0.005, () => ({ a0: marine ? -70 : -78, a1: marine ? 70 : 78, n: 2.7 })), { seg: 14, thick: 0.006, smooth: 2 });
        b.surf({ ...pal.glow, ...H, glow: 2.8 });
        loft(b, shellAt(skull, marine ? [0.118, 0.124] : [0.097, 0.103], inf + 0.009, () => ({ a0: -60, a1: 60, n: 2.7 })), { seg: 12, thick: 0.003, bevel: 0.001 });
        // chin guard
        b.surf({ ...pal.plate2, ...H });
        loft(b, shellAt(skull, [-0.05, -0.015, marine ? 0.035 : 0.02], inf + 0.008, () => ({ a0: -92, a1: 92, n: 2.7 })), { seg: 14, thick: 0.01, trim: { w: 0.004, raise: 0.002, slot: 1 }, slots: [undefined, { ...pal.trim, ...H }] });
        if (marine) {
          // respirator
          b.surf({ ...pal.dark, ...H, metal: 0.6 });
          b.scope(() => { b.translate(0, 0.0, -(secAt(skull, 0, inf).rz + 0.014)); box(b, 0.07, 0.05, 0.04, { bevel: 0.012 }); });
          b.surf({ ...pal.trim, ...H });
          for (const sx of [-1, 1]) b.scope(() => { b.at(sx * 0.05, -0.008, -(secAt(skull, 0, inf).rz - 0.006), 0, sx * -38, 90); loft(b, [{ y: -0.014, rx: 0.019, rz: 0.019 }, { y: 0.014, rx: 0.019, rz: 0.019 }], { seg: 8, capA: 'flat', capB: 'flat' }); });
        }
      } else {
        // medic: clear half-visor and a pale band
        b.surf({ color: 0x9fd8e8, rough: 0.1, metal: 0.3, part: PART.glass, ...H, emissive: 0xa8d8ff, glow: 0.35 });
        loft(b, shellAt(skull, [0.085, 0.13], 0.02, () => ({ a0: -68, a1: 68 })), { seg: 12, thick: 0.004 });
        b.surf({ color: 0xd8dde2, rough: 0.5, metal: 0.2, ...H });
        loft(b, shellAt(skull, [0.15, 0.172], inf + 0.004, () => ({ n: 2.7 })), { seg: 22, thick: 0.006 });
      }
    }
  });
}

/** Cloth hood, up (framing the face) or down (rolled on the shoulders). */
export function hood(b: MeshBuilder, rig: RigView, surf: Surf, up: boolean): void {
  const s: Surf = { part: PART.cloth, rough: 0.9, ...surf, ...H };
  if (up) {
    inHead(b, rig, () => {
      b.surf(s);
      loft(b, [
        { y: -0.06, rx: 0.1, rz: 0.075, rzb: 0.125, tilt: 6, cz: 0.02 },
        { y: 0.04, rx: 0.108, rz: 0.1, rzb: 0.135, tilt: 30, cz: 0.012 },
        { y: 0.13, rx: 0.104, rz: 0.112, rzb: 0.136, tilt: 26, cz: 0.012 },
        { y: 0.2, rx: 0.088, rz: 0.1, rzb: 0.118, tilt: 12, cz: 0.012 },
        { y: 0.236, rx: 0.06, rz: 0.07, rzb: 0.08, cz: 0.014 },
      ], { seg: 20, smooth: 3, capB: { dome: 0.022, k: 2 }, fn: (th, _v, y) => 1 + 0.02 * Math.sin(th * 5 + y * 30) });
      // the opening: dark inner rim
      b.surf({ ...s, color: 0x0c0c0e });
      b.scope(() => { b.at(0, 0.075, -0.055, 62, 0, 0); b.scale(1, 1, 1.25); torus(b, 0.082, 0.014, { seg: 18, tubeSeg: 6 }); });
    });
  } else {
    b.skin(rig.i('chest')).surf({ ...s, zone: ZONE.back });
    b.scope(() => { b.at(0, 1.5, 0.08, 22, 0, 0); b.scale(1.3, 0.8, 1); torus(b, 0.072, 0.034, { seg: 14, tubeSeg: 7, arc: [60, 300] }); });
  }
}

/** Technician visor band + earpiece. */
export function visorBand(b: MeshBuilder, rig: RigView, pal: Pal): void {
  const skull = skullSecs(1);
  inHead(b, rig, () => {
    b.surf({ color: 0x0b1220, rough: 0.1, metal: 0.5, part: PART.glass, ...H, emissive: 0xa8d8ff, glow: 1.3 });
    loft(b, shellAt(skull, [0.088, 0.122], 0.006, () => ({ a0: -72, a1: 72 })), { seg: 12, thick: 0.008 });
    b.surf({ ...pal.plate2, ...H });
    loft(b, shellAt(skull, [0.094, 0.116], 0.004, () => ({ a0: 60, a1: 300 })), { seg: 16, thick: 0.006 });
    b.scope(() => { b.translate(-0.082, 0.085, 0.01); box(b, 0.018, 0.05, 0.04, { bevel: 0.006 }); });
    b.surf({ ...pal.glow, ...H });
    b.scope(() => { b.translate(-0.092, 0.095, 0.01); box(b, 0.004, 0.012, 0.012, { bevel: 0.001, edge: 0 }); });
  });
}

/** Field dressing around the head with one eye covered. */
export function headBandage(b: MeshBuilder, rig: RigView): void {
  const skull = skullSecs(1);
  const cloth: Surf = { color: 0x9c9682, rough: 0.92, part: PART.cloth, ...H };
  inHead(b, rig, () => {
    b.surf(cloth);
    loft(b, shellAt(skull, [0.128, 0.176], 0.007, () => ({ tilt: -8 })), { seg: 20, thick: 0.006 });
    loft(b, shellAt(skull, [0.082, 0.128], 0.008, () => ({ a0: 8, a1: 150, tilt: 16 })), { seg: 12, thick: 0.006 });
    b.surf({ ...cloth, color: 0x6a2420 });
    b.scope(() => { b.at(0.05, 0.15, -0.084, 0, -30, 0); ball(b, 0.016, 0.012, 0.004, 8, 4); });
  });
}

/** Thin officer's circlet with a comm bead. */
export function circlet(b: MeshBuilder, rig: RigView, pal: Pal): void {
  const skull = skullSecs(1);
  inHead(b, rig, () => {
    b.surf({ ...pal.trim, ...H });
    loft(b, shellAt(skull, [0.148, 0.16], 0.016, () => ({ tilt: -14 })), { seg: 20, thick: 0.005 });
    b.surf({ ...pal.glow, ...H, glow: 2.2 });
    b.scope(() => { b.translate(0.086, 0.09, 0.0); box(b, 0.006, 0.014, 0.014, { bevel: 0.002, edge: 0 }); });
  });
}

export interface SkirtOpts {
  /** open arc (degrees) — omit for a closed robe */
  arc?: [number, number];
  top?: number;
  bottom: number;
  flare?: number;
  out?: number;
  surf: Surf;
  trim?: Surf;
  thick?: number;
  rows?: number;
  /** how strongly the garment follows the legs (0 stiff .. 1 clings) */
  follow?: number;
}

/** Garment hanging from the waist that follows the legs through skin weights (coats, robes, tabards). */
export function skirt(b: MeshBuilder, rig: RigView, o: SkirtOpts): void {
  const T = torsoSecs(rig);
  const top = o.top ?? 1.02, rows = o.rows ?? 5;
  const base = secAt(T, Math.min(1.05, top), o.out ?? 0.03);
  const hips = rig.i('hips'), thL = rig.i('thighL'), thR = rig.i('thighR'), shL = rig.i('shinL'), shR = rig.i('shinR');
  const f = o.follow ?? 0.7;
  const skin: SkinFn = (x, y, _z, so) => {
    const tt = smooth01(top - 0.02, 0.72, y) * f;
    const ts = smooth01(0.52, 0.22, y) * 0.75;
    const wR = smooth01(-0.07, 0.07, x), wL = 1 - wR;
    so.i0 = hips; so.w0 = 1 - tt;
    so.i1 = thL; so.w1 = tt * wL * (1 - ts);
    so.i2 = thR; so.w2 = tt * wR * (1 - ts);
    so.i3 = x < 0 ? shL : shR; so.w3 = tt * ts;
  };
  const secs: Sec[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, y = top + (o.bottom - top) * t;
    const gr = 1 + (o.flare ?? 0.2) * Math.pow(t, 0.9);
    const body = y > 0.86 ? secAt(T, y, o.out ?? 0.03) : base;
    secs.push({ y, rx: Math.max(body.rx, base.rx * (y > 0.9 ? 1 : gr)), rz: Math.max(body.rz, base.rz * gr), rzb: Math.max(body.rzb ?? body.rz, (base.rzb ?? base.rz) * gr), cz: base.cz, n: 2.3, ...(o.arc ? { a0: o.arc[0], a1: o.arc[1] } : {}) });
  }
  b.surf({ part: PART.cloth, rough: 0.86, ...o.surf }).skin(skin);
  loft(b, secs, { seg: o.arc ? 16 : 24, thick: o.thick ?? 0.008, inner: true, innerSlot: 2, smooth: 2,
    trim: o.trim ? { w: 0.018, raise: 0.001, slot: 1, v0: false } : undefined,
    slots: [undefined, o.trim ? { part: PART.cloth, ...o.trim } : undefined, { part: PART.cloth, rough: 0.9, ...o.surf, color: dim(o.surf.color, 0.55) }] });
}

/** Cloth wrap on the torso (jackets, tunics, bandage wraps): a soft-skinned band between two heights. */
export function torsoWrap(b: MeshBuilder, rig: RigView, y0: number, y1: number, out: number, surf: Surf, skin: SkinFn, arc?: [number, number]): void {
  const T = torsoSecs(rig);
  const n = Math.max(2, Math.round(Math.abs(y1 - y0) / 0.06));
  const secs: Sec[] = [];
  for (let i = 0; i <= n; i++) { const y = y0 + ((y1 - y0) * i) / n; secs.push({ ...secAt(T, y, out), ...(arc ? { a0: arc[0], a1: arc[1] } : {}) }); }
  b.surf({ part: PART.cloth, rough: 0.86, ...surf }).skin(skin);
  loft(b, secs, { seg: 22, thick: 0.008, smooth: 2 });
}

/** Static shoulder mantle / stole draped over both shoulders (bound to the chest). */
export function mantle(b: MeshBuilder, rig: RigView, surf: Surf, trim: Surf | undefined, drop = 0.16, out = 0.05): void {
  const T = torsoSecs(rig);
  const k = rig.prop.bulk, sw = rig.prop.shoulder;
  b.skin(rig.i('chest')).surf({ part: PART.cloth, rough: 0.86, zone: ZONE.chest, ...surf });
  const top = secAt(T, 1.5, out * 0.5), mid = secAt(T, 1.44, out);
  loft(b, [
    { ...top, y: 1.515, rx: 0.085 * k, rz: 0.078 * k, rzb: 0.085 * k },
    { ...mid, y: 1.47, rx: (sw + 0.035) * k, rz: mid.rz * 0.96, rzb: (mid.rzb ?? mid.rz) * 1.0, n: 2.2 },
    { ...mid, y: 1.47 - drop * 0.55, rx: (sw + 0.085) * k, rz: mid.rz + 0.02, rzb: (mid.rzb ?? mid.rz) + 0.03, n: 2.2 },
    { ...mid, y: 1.47 - drop, rx: (sw + 0.09) * k, rz: mid.rz + 0.024, rzb: (mid.rzb ?? mid.rz) + 0.034, n: 2.2 },
  ], { seg: 22, thick: 0.01, smooth: 2, inner: true, trim: trim ? { w: 0.014, raise: 0.001, slot: 1, v0: false } : undefined, slots: [undefined, trim ? { part: PART.cloth, ...trim } : undefined] });
}

/** Cloth wraps round a limb section list (bandages, padded sleeves). */
export function limbWraps(b: MeshBuilder, secs: Sec[], ys: number[], surf: Surf, width = 0.03, out = 0.008): void {
  b.surf({ part: PART.cloth, rough: 0.92, ...surf });
  for (const y of ys) loft(b, [secAt(secs, y + width / 2, out), secAt(secs, y - width / 2, out)], { seg: 10, thick: 0.006 });
}

/** Corrupted growth: dark tissue cords with a violet core thread. */
export function tissueCord(b: MeshBuilder, pts: V3[], r: number): void {
  b.surf({ color: 0x120a1c, rough: 0.4, metal: 0.2, part: PART.suit });
  tube(b, pts, r, { seg: 6 });
  b.surf({ color: 0x1a0b33, rough: 0.4, part: PART.glow, emissive: 0x7a3cff, glow: 2.4 });
  tube(b, pts.map((p) => [p[0], p[1] + r * 0.3, p[2]] as V3), r * 0.36, { seg: 4 });
}

function dim(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k), gg = Math.round(((hex >> 8) & 255) * k), bl = Math.round((hex & 255) * k);
  return (r << 16) | (gg << 8) | bl;
}
