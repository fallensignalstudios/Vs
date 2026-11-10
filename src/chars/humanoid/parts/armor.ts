/**
 * Armour kit — torso + shoulders. Plates are bevelled shells that conform to the body sections, rigidly bound
 * to single bones and overlapped like real lames so joints can move without opening gaps.
 * Two design languages: 'dom' (Dominion: heavy, rounded, bronze with raised gold trim and oxblood enamel)
 * and 'ref' (Reformation: sleek, angular, navy/slate with sterile steel edges and thin cold light lines).
 */
import { MeshBuilder, PART, ZONE, type Surf } from '../geo/builder';
import { loft, box, torus, tube, type Sec, type Trim, type V3 } from '../geo/prims';
import type { RigView } from '../rig';
import { secAt, torsoSecs } from './body';

export type Faction = 'dom' | 'ref';

export interface Pal {
  /** main plate */
  plate: Surf;
  /** secondary / darker plate (abdomen lames, inner layers) */
  plate2: Surf;
  /** raised edge trim */
  trim: Surf;
  /** lacquered colour panel */
  enamel: Surf;
  /** recesses, mechanisms */
  dark: Surf;
  cloth: Surf;
  cloth2: Surf;
  leather: Surf;
  /** emissive accents */
  glow: Surf;
  suit: Surf;
}

export const DOM_PAL: Pal = {
  plate: { color: 0x4d3828, metal: 0.9, rough: 0.46 },
  plate2: { color: 0x2a2224, metal: 0.85, rough: 0.5 },
  trim: { color: 0x7e6238, metal: 1, rough: 0.4 },
  enamel: { color: 0x4a1214, metal: 0.35, rough: 0.4 },
  dark: { color: 0x151214, metal: 0.5, rough: 0.6 },
  cloth: { color: 0x5e1719, rough: 0.86, part: PART.cloth },
  cloth2: { color: 0x241012, rough: 0.9, part: PART.cloth },
  leather: { color: 0x2b1d15, rough: 0.58, part: PART.leather },
  glow: { color: 0x2a1608, rough: 0.4, part: PART.glow, emissive: 0xffa033, glow: 3.2 },
  suit: { color: 0x18161a, rough: 0.74, part: PART.suit },
};

export const REF_PAL: Pal = {
  plate: { color: 0x1d2c48, metal: 0.62, rough: 0.38 },
  plate2: { color: 0x343f50, metal: 0.72, rough: 0.44 },
  trim: { color: 0x6f7a88, metal: 1, rough: 0.36 },
  enamel: { color: 0x111b2e, metal: 0.5, rough: 0.28 },
  dark: { color: 0x0d1118, metal: 0.4, rough: 0.6 },
  cloth: { color: 0x1b2942, rough: 0.86, part: PART.cloth },
  cloth2: { color: 0x2c3442, rough: 0.9, part: PART.cloth },
  leather: { color: 0x15181f, rough: 0.55, part: PART.leather },
  glow: { color: 0x0a1420, rough: 0.4, part: PART.glow, emissive: 0xa8d8ff, glow: 2.2 },
  suit: { color: 0x11151c, rough: 0.72, part: PART.suit },
};

export interface WrapOpts {
  rows?: number;
  inflate?: number | ((t: number) => number);
  arc?: [number, number] | ((t: number) => [number, number]);
  thick?: number;
  bevel?: number;
  seg?: number;
  trim?: Trim;
  inner?: boolean;
  slots?: Array<Surf | undefined>;
  fn?: (theta: number, v: number, y: number) => number;
  smooth?: number;
  /** superellipse exponent override (boxier plates) */
  n?: number;
  /** per-row centre shift [dx, dz] */
  shift?: (t: number) => [number, number];
  /** per-row surf slot */
  slotAt?: (t: number) => number;
  /**
   * Split the plate into this many overlapping lames (upper over lower), each with its own trimmed lower edge:
   * the segmented look of articulated plate. `alt` is the surf of every second lame.
   */
  lames?: number;
  alt?: Surf;
}

/** Shell that follows a body profile (`secs`) from y0 to y1. Omit `arc` for a closed band. */
export function wrap(b: MeshBuilder, secs: Sec[], y0: number, y1: number, o: WrapOpts = {}): void {
  if (o.lames && o.lames > 1) {
    const n = o.lames;
    const base = b.getSurf();
    const span = (y1 - y0) / n;
    // lowest lame first so each upper lame overlaps the one below it
    for (let k = n - 1; k >= 0; k--) {
      const a = y0 + span * k, c = y0 + span * (k + 1) + (k < n - 1 ? span * 0.24 : 0);
      const t0 = k / n, t1 = Math.min(1, (k + 1.24) / n);
      const sub: WrapOpts = {
        ...o, lames: undefined, rows: Math.max(2, Math.ceil((o.rows ?? 4) / n) + 1),
        inflate: (t) => (typeof o.inflate === 'function' ? o.inflate(t0 + (t1 - t0) * t) : o.inflate ?? 0.012) + (n - 1 - k) * 0.0022 + t * 0.003,
        arc: o.arc ? (typeof o.arc === 'function' ? ((f) => (t: number) => f(t0 + (t1 - t0) * t))(o.arc) : o.arc) : undefined,
        trim: o.trim ? { ...o.trim, v0: k === 0 ? o.trim.v0 : false } : undefined,
      };
      if (o.alt && k % 2 === 1) b.surf({ ...o.alt, zone: base.zone }); else b.surf(base);
      wrap(b, secs, a, c, sub);
    }
    b.surf(base);
    return;
  }
  const rows = o.rows ?? 4;
  const out: Sec[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const inf = typeof o.inflate === 'function' ? o.inflate(t) : o.inflate ?? 0.012;
    const s = secAt(secs, y0 + (y1 - y0) * t, inf);
    if (o.arc) { const a = typeof o.arc === 'function' ? o.arc(t) : o.arc; s.a0 = a[0]; s.a1 = a[1]; }
    if (o.n) s.n = o.n;
    if (o.shift) { const d = o.shift(t); s.cx = (s.cx ?? 0) + d[0]; s.cz = (s.cz ?? 0) + d[1]; }
    if (o.slotAt) s.slot = o.slotAt(t);
    out.push(s);
  }
  loft(b, out, { seg: o.seg ?? 12, thick: o.thick ?? 0.012, bevel: o.bevel, trim: o.trim, inner: o.inner, slots: o.slots, fn: o.fn, smooth: o.smooth });
}

const g = (x: number, c: number, s: number): number => { const d = (x - c) / s; return Math.exp(-d * d); };

/**
 * Position the builder on a ring section's surface at `thetaDeg`, pushed `out` metres along the normal.
 * Local frame: −Z = outward, +X = along the ring (toward increasing theta), +Y = up.
 */
export function onRing(b: MeshBuilder, sec: Sec, thetaDeg: number, out: number, fn: () => void): void {
  const th = (thetaDeg * Math.PI) / 180;
  const n = sec.n ?? 2, ex = 2 / n;
  const s = Math.sin(th), c = Math.cos(th);
  const rz = c >= 0 ? sec.rz : sec.rzb ?? sec.rz;
  const x = (sec.cx ?? 0) + sec.rx * Math.sign(s) * Math.pow(Math.abs(s), ex);
  const z = (sec.cz ?? 0) - rz * Math.sign(c) * Math.pow(Math.abs(c), ex);
  // outward normal of the superellipse
  const en = (2 * (n - 1)) / n;
  let nx = (Math.sign(s) * Math.pow(Math.abs(s), en)) / sec.rx, nz = (-Math.sign(c) * Math.pow(Math.abs(c), en)) / rz;
  const l = Math.hypot(nx, nz) || 1;
  nx /= l; nz /= l;
  const yaw = (Math.atan2(-nx, -nz) * 180) / Math.PI;
  b.scope(() => { b.at(x + nx * out, sec.y, z + nz * out, 0, yaw, 0); fn(); });
}

export interface CuirassOpts {
  faction: Faction;
  /** plate stand-off from the body (0.012 light .. 0.03 heavy) */
  heft: number;
  /** number of abdomen lames */
  lames: number;
  /** central chest ridge strength */
  keel?: number;
  /** enamel centre panel on the chest */
  enamel?: boolean;
}

/** Breastplate, backplate and segmented abdomen. */
export function cuirass(b: MeshBuilder, rig: RigView, pal: Pal, o: CuirassOpts): void {
  const T = torsoSecs(rig);
  const chest = rig.i('chest'), spine = rig.i('spine'), hips = rig.i('hips');
  const dom = o.faction === 'dom';
  const h = o.heft;
  const plate: Surf = { ...pal.plate, zone: ZONE.chest };
  const back: Surf = { ...pal.plate, zone: ZONE.back };
  const trimW = dom ? 0.008 : 0.005;
  const keel = o.keel ?? (dom ? 0.05 : 0.02);

  // ---- abdomen lames (built first: the breastplate overlaps them) -------------------------------------
  for (let i = o.lames - 1; i >= 0; i--) {
    const top = 1.245 - i * 0.062, bot = top - 0.088;
    b.surf({ ...pal.plate2, zone: ZONE.chest }).skin((top + bot) / 2 > 1.085 ? spine : hips);
    wrap(b, T, top, bot, {
      rows: 2, seg: 22, thick: 0.011, inflate: (t) => h * 0.55 + 0.004 + t * 0.008 - i * 0.0015,
      trim: { w: dom ? 0.006 : 0.004, raise: 0.002, v0: false, slot: 1 }, slots: [undefined, { ...pal.trim, zone: ZONE.chest }],
      fn: dom ? undefined : (th) => 1 + 0.012 * g(Math.abs(th), 0, 0.5),
    });
  }

  // ---- backplate ----------------------------------------------------------------------------------------
  b.surf(back).skin(chest);
  wrap(b, T, 1.478, 1.2, {
    lames: dom ? 3 : 2, alt: pal.plate2,
    rows: 5, seg: 16, arc: [78, 282], thick: 0.014, inflate: (t) => h * 0.85 + 0.006 * Math.sin(Math.PI * t),
    trim: { w: trimW, raise: 0.003, slot: 1 }, slots: [undefined, { ...pal.trim, zone: ZONE.back }],
    fn: (th, _v, y) => 1 + 0.03 * g(Math.abs(th), Math.PI, 0.12) * g(y, 1.36, 0.12) + (dom ? 0.02 * g(Math.abs(th), 2.45, 0.3) * g(y, 1.4, 0.07) : 0),
    n: dom ? undefined : 2.9,
  });

  // ---- breastplate --------------------------------------------------------------------------------------
  b.surf(plate).skin(chest);
  if (dom) {
    wrap(b, T, 1.205, 1.482, {
      rows: 6, seg: 20, arc: [-100, 100], thick: 0.016, inflate: (t) => h + 0.014 * Math.sin(Math.PI * Math.min(1, t * 1.15)),
      trim: { w: trimW, raise: 0.004, slot: 1 }, slots: [undefined, { ...pal.trim, zone: ZONE.chest }, { ...pal.enamel, zone: ZONE.chest }],
      // pectoral swell + keel
      fn: (th, _v, y) => 1 + keel * g(th, 0, 0.1) * g(y, 1.33, 0.13) + 0.035 * g(Math.abs(th), 0.62, 0.36) * g(y, 1.36, 0.075),
      slotAt: o.enamel ? (t) => (t > 0.3 && t < 0.72 ? 2 : 0) : undefined,
    });
  } else {
    // two angular panels with a visible technical seam
    wrap(b, T, 1.305, 1.482, {
      rows: 4, seg: 18, arc: [-98, 98], thick: 0.012, n: 3, inflate: (t) => h + 0.008 * Math.sin(Math.PI * Math.min(1, t * 1.2)),
      trim: { w: trimW, raise: 0.002, slot: 1 }, slots: [undefined, { ...pal.trim, zone: ZONE.chest }],
      fn: (th, _v, y) => 1 + keel * g(th, 0, 0.14) * g(y, 1.36, 0.1) + 0.03 * g(Math.abs(th), 0.6, 0.34) * g(y, 1.37, 0.07),
    });
    b.surf({ ...pal.plate2, zone: ZONE.chest });
    wrap(b, T, 1.205, 1.318, {
      rows: 3, seg: 18, arc: [-96, 96], thick: 0.01, n: 3, inflate: (t) => h * 0.8 + 0.003 * t,
      trim: { w: trimW * 0.8, raise: 0.0015, slot: 1, v1: false }, slots: [undefined, { ...pal.trim, zone: ZONE.chest }],
    });
  }
}

export interface GorgetOpts { faction: Faction; height?: number; scarf?: Surf }

/** Collar ring; optionally a rolled cloth scarf inside it. */
export function gorget(b: MeshBuilder, rig: RigView, pal: Pal, o: GorgetOpts): void {
  const k = rig.prop.bulk;
  const dom = o.faction === 'dom';
  const hgt = o.height ?? (dom ? 0.085 : 0.05);
  b.surf({ ...pal.plate, zone: ZONE.chest }).skin(rig.i('chest'));
  loft(b, [
    { y: 1.462, rx: 0.118 * k, rz: 0.098 * k, rzb: 0.105 * k, cz: 0.012, tilt: -8, n: dom ? 2 : 2.8 },
    { y: 1.462 + hgt * 0.5, rx: 0.092 * k, rz: 0.082 * k, rzb: 0.09 * k, cz: 0.014, tilt: -10, n: dom ? 2 : 2.8 },
    { y: 1.462 + hgt, rx: 0.086 * k, rz: 0.08 * k, rzb: 0.088 * k, cz: 0.016, tilt: -13, n: dom ? 2 : 2.8 },
  ], { seg: 18, thick: 0.011, inner: true, innerSlot: 2, trim: { w: dom ? 0.01 : 0.006, raise: 0.003, slot: 1, v0: false }, slots: [undefined, { ...pal.trim, zone: ZONE.chest }, { ...pal.dark, zone: ZONE.chest }] });
  if (o.scarf) {
    b.surf({ part: PART.cloth, rough: 0.9, zone: ZONE.chest, ...o.scarf });
    b.scope(() => { b.at(0, 1.5, 0.014, -9, 0, 0); b.scale(1, 1, 1.02); torus(b, 0.07 * k, 0.026, { seg: 16, tubeSeg: 7 }); });
    b.scope(() => { b.at(0, 1.535, 0.02, -12, 0, 0); torus(b, 0.062 * k, 0.02, { seg: 16, tubeSeg: 6 }); });
  }
}

export interface PauldronOpts {
  faction: Faction;
  /** dome radius */
  R: number;
  /** trailing lames down the upper arm */
  lames: number;
  /** upright neck guard height (0 = none) */
  fin?: number;
  /** raised central ridge */
  ridge?: boolean;
  /** enamel band */
  enamel?: boolean;
}

/** Layered shoulder armour. Built on the right and mirrored for the left. */
export function pauldron(b: MeshBuilder, rig: RigView, side: number, pal: Pal, o: PauldronOpts): void {
  const [sx, sy, sz] = rig.sp('uArm', 1);
  const dom = o.faction === 'dom';
  const R = o.R;
  const n = dom ? 2 : 3.2;
  const trimS: Surf = { ...pal.trim, zone: ZONE.arm };
  const tw = dom ? 0.008 : 0.005;
  b.scope(() => {
    if (side < 0) b.mirrorX();
    const cx = sx + R * 0.16, cy = sy + R * 0.12;
    // trailing lames (lowest first so upper ones overlap)
    for (let kI = o.lames; kI >= 1; kI--) {
      const top = cy - R * 0.22 - (kI - 1) * R * 0.44, bot = top - R * 0.62;
      const r0 = R * (1.02 - kI * 0.075), r1 = R * (1.04 - kI * 0.085);
      b.surf({ ...(kI % 2 ? pal.plate2 : pal.plate), zone: ZONE.arm }).skin(rig.si(kI <= 1 ? 'paul' : 'uArm', side));
      loft(b, [
        { y: top, rx: r0 * 0.9, rz: r0 * 1.02, cx: cx - 0.01 * kI, cz: sz, n, a0: -42, a1: 222 },
        { y: (top + bot) / 2, rx: r1 * 0.96, rz: r1 * 1.06, cx: cx - 0.012 * kI, cz: sz, n, a0: -46, a1: 226 },
        { y: bot, rx: r1 * 0.98, rz: r1 * 1.08, cx: cx - 0.012 * kI, cz: sz, n, a0: -34, a1: 214 },
      ], { seg: 14, thick: 0.012, trim: { w: tw, raise: 0.003, slot: 1, v0: false }, slots: [undefined, trimS] });
    }
    // main cap: a dome open toward the neck
    b.surf({ ...pal.plate, zone: ZONE.arm }).skin(rig.si('paul', side));
    const secs: Sec[] = [];
    const phis = dom ? [1.5, 16, 34, 54, 72, 90, 104] : [1.5, 22, 44, 66, 88, 102];
    for (const ph of phis) {
      const p = (ph * Math.PI) / 180;
      const r = R * Math.sin(p);
      const open = dom ? 44 - ph * 0.12 : 50;
      secs.push({ y: cy + R * 0.8 * Math.cos(p), rx: r * (dom ? 1 : 0.92), rz: r * (dom ? 1.1 : 1.16), cx, cz: sz, n, a0: -open, a1: 180 + open, slot: o.enamel && ph > 40 && ph < 85 ? 2 : 0 });
    }
    loft(b, secs, {
      seg: 16, thick: 0.014, smooth: dom ? 2 : 1,
      trim: { w: tw, raise: 0.004, slot: 1, v0: false }, slots: [undefined, trimS, { ...pal.enamel, zone: ZONE.arm }],
      fn: o.ridge ? (th) => 1 + 0.05 * g(th, Math.PI / 2, 0.14) : undefined,
    });
    // rim roll along the lower edge (heavy pieces)
    if (dom && o.ridge) {
      b.surf(trimS);
      const pts: V3[] = [];
      const rr = R * Math.sin((104 * Math.PI) / 180), yy = cy + R * 0.8 * Math.cos((104 * Math.PI) / 180) - 0.004;
      for (let a = -28; a <= 208; a += 14) { const t = (a * Math.PI) / 180; pts.push([cx + Math.sin(t) * rr * 1.03, yy, sz - Math.cos(t) * rr * 1.13]); }
      tube(b, pts, 0.0085, { seg: 6 });
    }
    // upright neck guard
    if (o.fin && o.fin > 0) {
      b.surf({ ...pal.plate, zone: ZONE.arm });
      const f = o.fin;
      loft(b, [
        { y: cy + R * 0.42, rx: R * 0.78, rz: R * 0.95, cx, cz: sz, a0: 208, a1: 332 },
        { y: cy + R * 0.42 + f * 0.55, rx: R * 0.74, rz: R * 0.9, cx: cx + 0.004, cz: sz, a0: 214, a1: 326 },
        { y: cy + R * 0.42 + f, rx: R * 0.76, rz: R * 0.82, cx: cx + 0.012, cz: sz, a0: 226, a1: 314 },
      ], { seg: 10, thick: 0.012, smooth: 2, inner: true, trim: { w: 0.011, raise: 0.003, slot: 1, v0: false }, slots: [undefined, trimS] });
    }
  });
}

/** Straps that visibly hold a pauldron / pack to the chest. */
export function strap(b: MeshBuilder, pts: V3[], width: number, surf: Surf, bone: number): void {
  b.surf(surf).skin(bone);
  tube(b, pts, width, { seg: 6, flat: 0.32 });
}

export interface PackOpts { faction: Faction; size?: number }

/** Back unit: Dominion power pack with amber slots / Reformation technical pack with antenna and cabling. */
export function backpack(b: MeshBuilder, rig: RigView, pal: Pal, o: PackOpts): void {
  const k = rig.prop.bulk, s = o.size ?? 1;
  const chest = rig.i('chest');
  const T = torsoSecs(rig);
  const zb = (secAt(T, 1.36).rzb ?? 0.11) + 0.03;
  b.skin(chest);
  if (o.faction === 'dom') {
    b.surf({ ...pal.plate2, zone: ZONE.back });
    b.scope(() => { b.translate(0, 1.345, zb + 0.045 * s); box(b, 0.25 * k * s, 0.27 * s, 0.11 * s, { bevel: 0.022, taper: [0.84, 0.8] }); });
    b.surf({ ...pal.plate, zone: ZONE.back });
    b.scope(() => { b.translate(0, 1.47, zb + 0.04 * s); box(b, 0.2 * k * s, 0.05, 0.1 * s, { bevel: 0.014 }); });
    b.scope(() => { b.translate(0, 1.225, zb + 0.04 * s); box(b, 0.19 * k * s, 0.05, 0.085 * s, { bevel: 0.014 }); });
    // amber heat slots
    b.surf({ ...pal.glow, zone: ZONE.back });
    for (const sx of [-1, 1]) b.scope(() => { b.translate(sx * 0.055 * k * s, 1.35, zb + 0.102 * s); box(b, 0.022, 0.15 * s, 0.012, { bevel: 0.004, edge: 0 }); });
    // side canisters
    for (const sx of [-1, 1]) {
      b.surf({ ...pal.plate, zone: ZONE.back });
      b.scope(() => {
        b.translate(sx * 0.152 * k * s, 1.33, zb + 0.03 * s);
        loft(b, [{ y: -0.11 * s, rx: 0.03, rz: 0.03 }, { y: -0.095 * s, rx: 0.036, rz: 0.036, hard: true }, { y: 0.095 * s, rx: 0.036, rz: 0.036, hard: true }, { y: 0.11 * s, rx: 0.028, rz: 0.028 }], { seg: 10, capA: 'flat', capB: 'dome' });
      });
      b.surf({ ...pal.trim, zone: ZONE.back });
      b.scope(() => { b.translate(sx * 0.152 * k * s, 1.33, zb + 0.03 * s); torus(b, 0.037, 0.006, { seg: 12, tubeSeg: 5 }); });
    }
  } else {
    b.surf({ ...pal.plate2, zone: ZONE.back });
    b.scope(() => { b.translate(0, 1.34, zb + 0.035 * s); box(b, 0.2 * k * s, 0.24 * s, 0.075 * s, { bevel: 0.012 }); });
    b.surf({ ...pal.plate, zone: ZONE.back });
    b.scope(() => { b.translate(0, 1.39, zb + 0.078 * s); box(b, 0.15 * k * s, 0.1 * s, 0.03, { bevel: 0.008 }); });
    b.scope(() => { b.translate(-0.05 * k * s, 1.27, zb + 0.078 * s); box(b, 0.07 * s, 0.07 * s, 0.03, { bevel: 0.008 }); });
    // status light bar + antenna
    b.surf({ ...pal.glow, zone: ZONE.back });
    b.scope(() => { b.translate(0.045 * k * s, 1.27, zb + 0.08 * s); box(b, 0.05 * s, 0.012, 0.012, { bevel: 0.003, edge: 0 }); });
    b.scope(() => { b.translate(0.045 * k * s, 1.295, zb + 0.08 * s); box(b, 0.05 * s, 0.006, 0.012, { bevel: 0.002, edge: 0 }); });
    b.surf({ ...pal.trim, zone: ZONE.back });
    tube(b, [[0.085 * k * s, 1.44, zb + 0.05 * s], [0.088 * k * s, 1.6, zb + 0.06 * s], [0.09 * k * s, 1.7, zb + 0.075 * s]], [0.006, 0.004, 0.0025], { seg: 5 });
    // cables to the collar: visible technical connections
    b.surf({ ...pal.dark, zone: ZONE.back, part: PART.suit });
    for (const sx of [-1, 1]) tube(b, [[sx * 0.07 * k, 1.455, zb + 0.03], [sx * 0.085 * k, 1.5, zb - 0.01], [sx * 0.075 * k, 1.515, zb - 0.07], [sx * 0.06 * k, 1.49, zb - 0.1]], 0.0085, { seg: 6 });
  }
}
