/**
 * Armour kit — arms, legs, waist. Same conventions as armor.ts: built on the right side, mirrored for the left;
 * rigid plates over a smooth-skinned undersuit, knee/elbow cops shared between the two bones they cover.
 */
import { MeshBuilder, PART, ZONE, type SkinFn, type Surf } from '../geo/builder';
import { loft, box, prism, tube, type Sec } from '../geo/prims';
import { blendY, blendZ, smooth01, type RigView } from '../rig';
import { armSecs, legSecs, secAt, torsoSecs } from './body';
import { onRing, wrap, type Faction, type Pal } from './armor';

const g = (x: number, c: number, s: number): number => { const d = (x - c) / s; return Math.exp(-d * d); };

function half(a: number, c: number): SkinFn {
  return (_x, _y, _z, o) => { o.i0 = a; o.w0 = 0.5; o.i1 = c; o.w1 = 0.5; };
}

export interface ArmOpts {
  faction: Faction;
  /** 0 light .. 1 heavy */
  heft: number;
  /** upper-arm plate */
  rerebrace?: boolean;
  /** emissive line on the vambrace */
  glowLine?: boolean;
  /** wrist display panel (technician) */
  display?: boolean;
  gauntlet?: boolean;
}

export function armArmor(b: MeshBuilder, rig: RigView, side: number, pal: Pal, o: ArmOpts): void {
  const A = armSecs(rig, 1);
  const dom = o.faction === 'dom';
  const ey = rig.sp('fArm', 1)[1], wy = rig.sp('hand', 1)[1], sy = rig.sp('uArm', 1)[1];
  const off = 0.008 + o.heft * 0.008;
  const trim: Surf = { ...pal.trim, zone: ZONE.arm };
  const tw = dom ? 0.006 : 0.004;
  const n = dom ? undefined : 2.8;
  const uArm = rig.si('uArm', side), fArm = rig.si('fArm', side), hand = rig.si('hand', side), fa = rig.si('fingA', side);
  b.scope(() => {
    if (side < 0) b.mirrorX();
    if (o.rerebrace !== false) {
      b.surf({ ...pal.plate2, zone: ZONE.arm }).skin(uArm);
      wrap(b, A, sy - 0.13, ey + 0.05, { lames: dom ? 2 : 1, alt: pal.plate, rows: 3, seg: 12, arc: [-50, 230], n, inflate: off, thick: 0.01, trim: { w: tw, raise: 0.0025, slot: 1 }, slots: [undefined, trim] });
    }
    // couter: elbow cop shared by both arm bones so it stays over the joint
    b.surf({ ...pal.plate, zone: ZONE.arm }).skin(half(uArm, fArm));
    wrap(b, A, ey + 0.052, ey - 0.052, {
      rows: 4, seg: 10, arc: [58, 302], n, thick: 0.011, inflate: (t) => off + 0.006 + (0.012 + o.heft * 0.012) * Math.sin(Math.PI * t),
      trim: dom ? { w: tw, raise: 0.0025, slot: 1 } : undefined, slots: [undefined, trim],
    });
    // vambrace
    b.surf({ ...pal.plate, zone: ZONE.arm }).skin(fArm);
    wrap(b, A, ey - 0.04, wy + 0.028, {
      rows: 4, seg: 12, n, thick: 0.011, inflate: (t) => off + 0.004 + 0.008 * (1 - t) + (dom ? 0.004 * Math.sin(Math.PI * t) : 0),
      trim: { w: tw, raise: 0.003, slot: 1 }, slots: [undefined, trim],
      fn: dom ? (th) => 1 + 0.1 * g(th, Math.PI / 2, 0.1) + 0.03 * g(th, Math.PI / 2, 0.5) : (th) => 1 + 0.05 * g(th, Math.PI / 2, 0.12),
    });
    if (o.glowLine) {
      b.surf({ ...pal.glow, zone: ZONE.arm, glow: 1.5 });
      const s0 = secAt(A, ey - 0.08, off + 0.014), s1 = secAt(A, wy + 0.06, off + 0.012);
      tube(b, [[(s0.cx ?? 0) + s0.rx, s0.y, s0.cz ?? 0], [(s1.cx ?? 0) + s1.rx, s1.y, s1.cz ?? 0]], 0.0022, { seg: 4 });
    }
    if (o.display) {
      const s = secAt(A, (ey + wy) / 2 - 0.01, off + 0.016);
      b.scope(() => {
        b.at((s.cx ?? 0) + s.rx * 0.6, s.y, (s.cz ?? 0) - s.rz * 0.8, 0, -40, 0);
        b.surf({ ...pal.dark, zone: ZONE.arm });
        box(b, 0.062, 0.1, 0.014, { bevel: 0.004 });
        b.surf({ ...pal.glow, zone: ZONE.arm, glow: 2.2 });
        b.translate(0, 0, -0.008);
        box(b, 0.05, 0.085, 0.004, { bevel: 0.001, edge: 0 });
      });
    }
    if (o.gauntlet !== false) {
      // flared cuff over the wrist
      b.surf({ ...pal.plate, zone: ZONE.arm }).skin(fArm);
      wrap(b, A, wy + 0.085, wy + 0.012, { rows: 2, seg: 10, n, thick: 0.009, inflate: (t) => off + 0.012 + 0.006 * (1 - t), trim: { w: tw * 0.8, raise: 0.002, slot: 1, v1: false }, slots: [undefined, trim] });
      // back-of-hand plate and knuckle bar
      const h = rig.sp('hand', 1), ka = rig.sp('fingA', 1);
      b.surf({ ...pal.plate, zone: ZONE.arm }).skin(hand);
      b.scope(() => { b.at(h[0] + 0.021, (h[1] + ka[1]) / 2 + 0.004, h[2] - 0.004, 0, 0, 3); box(b, 0.012, 0.074, 0.074, { bevel: 0.005, taper: [1, 0.8] }); });
      b.surf({ ...pal.plate2, zone: ZONE.arm }).skin(fa);
      b.scope(() => { b.translate(ka[0] + 0.014, ka[1] - 0.016, ka[2]); box(b, 0.012, 0.036, 0.08, { bevel: 0.004 }); });
      if (dom) { b.surf(trim).skin(hand); b.scope(() => { b.translate(h[0] + 0.029, (h[1] + ka[1]) / 2 + 0.004, h[2] - 0.004); box(b, 0.006, 0.05, 0.016, { bevel: 0.002 }); }); }
    }
  });
}

export interface LegOpts {
  faction: Faction;
  heft: number;
  cuisse?: boolean;
  /** full sabaton (true) or just ankle plates over the boot */
  sabaton?: boolean;
  glowLine?: boolean;
  /** injured: splint instead of a greave on this leg */
  splint?: boolean;
}

export function legArmor(b: MeshBuilder, rig: RigView, side: number, pal: Pal, o: LegOpts): void {
  const Lg = legSecs(rig, 1);
  const dom = o.faction === 'dom';
  const ky = rig.sp('shin', 1)[1], ay = rig.sp('foot', 1)[1];
  const off = 0.009 + o.heft * 0.009;
  const trim: Surf = { ...pal.trim, zone: ZONE.leg };
  const tw = dom ? 0.007 : 0.004;
  const n = dom ? undefined : 2.8;
  const thigh = rig.si('thigh', side), shin = rig.si('shin', side);
  b.scope(() => {
    if (side < 0) b.mirrorX();
    if (o.cuisse !== false) {
      b.surf({ ...pal.plate, zone: ZONE.leg }).skin(thigh);
      wrap(b, Lg, 0.85, ky + 0.065, {
        lames: dom ? 3 : 2, alt: pal.plate2,
        rows: 4, seg: 14, arc: dom ? [-80, 170] : [-55, 150], n, thick: 0.012, inflate: (t) => off + 0.004 * Math.sin(Math.PI * t),
        trim: { w: tw, raise: 0.003, slot: 1 }, slots: [undefined, trim],
        fn: (th) => 1 + (dom ? 0.07 : 0.04) * g(th, 0.35, 0.1) + 0.02 * g(th, 0.35, 0.5),
      });
      // strap round the back of the thigh
      b.surf({ ...pal.leather, zone: ZONE.leg });
      wrap(b, Lg, 0.74, 0.705, { rows: 1, seg: 12, thick: 0.006, inflate: off * 0.5 + 0.002 });
    }
    // poleyn: knee cop shared by thigh and shin
    b.surf({ ...pal.plate, zone: ZONE.leg }).skin(half(thigh, shin));
    wrap(b, Lg, ky + 0.078, ky - 0.07, {
      rows: 4, seg: 10, arc: [-84, 84], n, thick: 0.013, inflate: (t) => off + 0.008 + (0.016 + o.heft * 0.012) * Math.sin(Math.PI * t),
      trim: dom ? { w: tw * 0.8, raise: 0.003, slot: 1 } : undefined, slots: [undefined, trim],
      fn: (th, _v, y) => 1 + 0.08 * g(th, 0, 0.3) * g(y, ky + 0.005, 0.04),
    });
    if (dom) {
      // side wing
      const s = secAt(Lg, ky, off + 0.02);
      b.scope(() => { b.at((s.cx ?? 0) + s.rx + 0.004, ky, s.cz ?? 0, 0, 0, 0); b.rotate(0, 0, 90); loft(b, [{ y: -0.006, rx: 0.045, rz: 0.05 }, { y: 0.012, rx: 0.03, rz: 0.034 }], { seg: 10, capA: 'flat', capB: { dome: 0.008, k: 1 } }); });
    }
    if (o.splint) {
      // field splint: two rods + wraps
      b.surf({ color: 0x8c8676, rough: 0.6, metal: 0.6, zone: ZONE.leg }).skin(shin);
      for (const a of [60, 200]) { const s0 = secAt(Lg, ky - 0.08, 0.012), s1 = secAt(Lg, ay + 0.1, 0.012); const t = (a * Math.PI) / 180; tube(b, [[(s0.cx ?? 0) + Math.sin(t) * s0.rx, s0.y, (s0.cz ?? 0) - Math.cos(t) * s0.rz], [(s1.cx ?? 0) + Math.sin(t) * s1.rx, s1.y, (s1.cz ?? 0) - Math.cos(t) * s1.rz]], 0.007, { seg: 5 }); }
      b.surf({ color: 0xc9c2ae, rough: 0.9, part: PART.cloth, zone: ZONE.leg });
      for (const y of [ky - 0.1, ky - 0.2, ky - 0.3]) wrap(b, Lg, y + 0.022, y - 0.022, { rows: 1, seg: 12, thick: 0.006, inflate: 0.012 });
    } else {
      // greave: front shell + calf plate
      b.surf({ ...pal.plate, zone: ZONE.leg }).skin(shin);
      wrap(b, Lg, ky - 0.058, ay + 0.035, {
        rows: 6, seg: 16, arc: [-118, 118], n, thick: 0.013, inflate: (t) => off + 0.003 + 0.012 * Math.pow(1 - t, 3) + 0.004 * Math.sin(Math.PI * t),
        trim: { w: tw, raise: 0.003, slot: 1 }, slots: [undefined, trim],
        fn: (th) => 1 + (dom ? 0.11 : 0.06) * g(th, 0, 0.09) + 0.03 * g(th, 0, 0.4),
      });
      // strap bands across the greave
      b.surf({ ...pal.plate2, zone: ZONE.leg });
      for (const yy of [ky - 0.15, ay + 0.12]) wrap(b, Lg, yy + 0.014, yy - 0.014, { rows: 1, seg: 14, thick: 0.007, inflate: off + 0.012, trim: dom ? { w: 0.004, raise: 0.0015, slot: 1 } : undefined, slots: [undefined, trim] });
      b.surf({ ...pal.plate, zone: ZONE.leg });
      b.surf({ ...pal.plate2, zone: ZONE.leg });
      wrap(b, Lg, ky - 0.08, ay + 0.06, { rows: 4, seg: 10, arc: [104, 256], n, thick: 0.01, inflate: off - 0.001, trim: dom ? { w: tw * 0.7, raise: 0.002, slot: 1, u0: false, u1: false } : undefined, slots: [undefined, trim] });
      if (o.glowLine) {
        b.surf({ ...pal.glow, zone: ZONE.leg, glow: 1.5 });
        const s0 = secAt(Lg, ky - 0.1, off + 0.016), s1 = secAt(Lg, ay + 0.09, off + 0.014);
        tube(b, [[(s0.cx ?? 0) + s0.rx, s0.y, s0.cz ?? 0], [(s1.cx ?? 0) + s1.rx, s1.y, s1.cz ?? 0]], 0.0022, { seg: 4 });
      }
    }
  });
  sabaton(b, rig, side, pal, o);
}

/** Armoured boot: plated foot with overlapping instep lames and a toe cap that bends with the toes. */
export function sabaton(b: MeshBuilder, rig: RigView, side: number, pal: Pal, o: LegOpts): void {
  const a = rig.sp('foot', 1), t = rig.sp('toe', 1);
  const foot = rig.si('foot', side), toe = rig.si('toe', side), shin = rig.si('shin', side);
  const k = Math.min(1.18, Math.max(0.92, rig.prop.bulk)) * (1 + o.heft * 0.06);
  const dom = o.faction === 'dom';
  const full = o.sabaton !== false;
  const body: Surf = full ? { ...pal.plate, zone: ZONE.leg } : { ...pal.leather, zone: ZONE.leg };
  const trim: Surf = { ...pal.trim, zone: ZONE.leg };
  b.scope(() => {
    if (side < 0) b.mirrorX();
    const S = (y: number, rx: number, hgt: number, n = 3): Sec => ({ y, rx: rx * k, rz: hgt / 2, rzb: hgt / 2, cz: hgt / 2 + 0.014, n });
    b.scope(() => {
      b.at(a[0], 0, a[2], -90, 0, 0);
      b.surf(body).skin(blendZ(foot, toe, t[2] + 0.035, t[2] - 0.015));
      loft(b, [S(-0.082, 0.036, 0.064), S(-0.056, 0.045, 0.104), S(0.0, 0.049, 0.122), S(0.06, 0.052, 0.088), S(0.12, 0.056, 0.064), S(0.17, 0.052, 0.05), S(0.205, 0.04, 0.036)],
        { seg: 12, smooth: 2, capA: { dome: 0.012, k: 1 }, capB: { dome: 0.02, k: 2 } });
      // sole with a heel block
      b.surf({ ...pal.dark, zone: ZONE.leg, part: PART.suit, rough: 0.8 });
      const So = (y: number, rx: number, th = 0.014): Sec => ({ y, rx: rx * k, rz: th / 2, rzb: th / 2, cz: th / 2, n: 4 });
      loft(b, [So(-0.088, 0.038, 0.024), So(-0.05, 0.048, 0.024), So(-0.012, 0.05, 0.024), So(-0.008, 0.05), So(0.12, 0.059), So(0.178, 0.054), So(0.214, 0.04)], { seg: 12, capA: 'flat', capB: 'flat' });
      if (full) {
        // instep lames: half shells over the top of the foot (top = +Z here → 180°)
        const lames: Array<[number, number, number, number]> = [[0.035, 0.092, 0.054, 0.096], [0.082, 0.138, 0.058, 0.072], [0.128, 0.178, 0.056, 0.058]];
        lames.forEach(([y0, y1, rx, hg], i) => {
          b.surf({ ...(i === 1 ? pal.plate : pal.plate2), zone: ZONE.leg }).skin(i === 2 ? blendZ(foot, toe, t[2] + 0.03, t[2] - 0.01) : foot);
          loft(b, [
            { y: y0, rx: (rx + 0.006) * k, rz: hg / 2 + 0.01, rzb: hg / 2 + 0.012, cz: hg / 2 + 0.012, n: 2.6 },
            { y: y1, rx: (rx + 0.004) * k, rz: hg / 2, rzb: hg / 2 + 0.002 - i * 0.004, cz: hg / 2 + 0.006 - i * 0.006, n: 2.6 },
          ], { seg: 12, arc: [86, 274], thick: 0.009, trim: dom ? { w: 0.007, raise: 0.002, slot: 1, u0: false, u1: false, v0: false } : undefined, slots: [undefined, trim] });
        });
        // toe cap
        b.surf({ ...pal.plate, zone: ZONE.leg }).skin(toe);
        loft(b, [S(0.158, 0.056, 0.058, 2.6), S(0.195, 0.05, 0.05, 2.6), S(0.218, 0.036, 0.038, 2.6)], { seg: 12, capB: { dome: 0.016, k: 2 } });
      }
    });
    if (full) {
      // heel guard wraps the back of the heel
      b.surf({ ...pal.plate, zone: ZONE.leg }).skin(foot);
      loft(b, [
        { y: 0.022, rx: 0.046 * k, rz: 0.05, rzb: 0.062, cx: a[0], cz: a[2] + 0.012, n: 2.4 },
        { y: 0.075, rx: 0.05 * k, rz: 0.05, rzb: 0.066, cx: a[0], cz: a[2] + 0.012, n: 2.4 },
        { y: 0.125, rx: 0.048 * k, rz: 0.05, rzb: 0.06, cx: a[0], cz: a[2] + 0.01, n: 2.4 },
      ], { seg: 10, arc: [98, 262], thick: 0.009, trim: dom ? { w: 0.007, raise: 0.002, slot: 1, v0: false } : undefined, slots: [undefined, trim] });
    }
    // ankle shaft
    const Lg = legSecs(rig, 1);
    b.surf(body).skin(blendY(shin, foot, a[1] + 0.05, a[1] - 0.005));
    wrap(b, Lg, a[1] + 0.2, a[1] - 0.02, { rows: 3, seg: 12, thick: 0.01, inflate: (tt) => 0.01 + 0.006 * (1 - tt) + (tt > 0.8 ? 0.006 : 0), n: 2.4 });
    if (!full) {
      // light boots: ankle plate + toe cap only
      b.surf({ ...pal.plate2, zone: ZONE.leg }).skin(shin);
      wrap(b, Lg, a[1] + 0.21, a[1] + 0.07, { rows: 2, seg: 10, arc: [-80, 80], thick: 0.009, inflate: 0.02, n: 2.8, trim: { w: 0.005, raise: 0.002, slot: 1 }, slots: [undefined, trim] });
    }
  });
}

export interface WaistOpts {
  faction: Faction;
  heft: number;
  /** tasset plates hanging over the thighs */
  tassets?: 'none' | 'front' | 'full';
  /** pouch positions (degrees around the belt) */
  pouches?: number[];
  buckle?: 'round' | 'plate' | 'none';
  /** second, slanted utility belt */
  crossBelt?: boolean;
}

/** Belt, buckle, pouches and tassets. */
export function waist(b: MeshBuilder, rig: RigView, pal: Pal, o: WaistOpts): void {
  const T = torsoSecs(rig);
  const hips = rig.i('hips');
  const dom = o.faction === 'dom';
  const off = 0.012 + o.heft * 0.012;
  const trim: Surf = { ...pal.trim, zone: ZONE.body };
  // fauld band under the abdomen
  b.surf({ ...pal.plate2, zone: ZONE.body }).skin(hips);
  wrap(b, T, 1.06, 0.975, { rows: 2, seg: 22, thick: 0.011, inflate: (t) => off + 0.004 + 0.008 * t, n: dom ? undefined : 2.8 });
  // belt
  b.surf({ ...pal.leather, zone: ZONE.body });
  wrap(b, T, 1.052, 0.992, { rows: 1, seg: 24, thick: 0.01, inflate: off + 0.016, trim: { w: 0.006, raise: 0.002, slot: 1 }, slots: [undefined, dom ? trim : { ...pal.plate2, zone: ZONE.body }] });
  const ring = secAt(T, 1.022, off + 0.022);
  if (o.buckle !== 'none') {
    onRing(b, ring, 0, 0.004, () => {
      if ((o.buckle ?? (dom ? 'round' : 'plate')) === 'round') {
        b.surf(trim);
        b.scope(() => { b.rotate(90, 0, 0); loft(b, [{ y: -0.01, rx: 0.046, rz: 0.046 }, { y: 0.004, rx: 0.046, rz: 0.046, hard: true }, { y: 0.012, rx: 0.036, rz: 0.036 }], { seg: 16, capA: 'flat', capB: 'flat' }); });
        b.surf({ ...pal.enamel, zone: ZONE.body });
        b.scope(() => { b.at(0, 0, -0.013, 90, 0, 0); loft(b, [{ y: -0.002, rx: 0.028, rz: 0.028 }, { y: 0.006, rx: 0.02, rz: 0.02 }], { seg: 12, capA: 'flat', capB: { dome: 0.005, k: 1 } }); });
      } else {
        b.surf({ ...pal.plate2, zone: ZONE.body });
        prism(b, [[-0.04, -0.028], [0.04, -0.028], [0.05, 0], [0.04, 0.028], [-0.04, 0.028], [-0.05, 0]], 0.016, { bevel: 0.004 });
        b.surf({ ...pal.glow, zone: ZONE.body, glow: 2 });
        b.scope(() => { b.translate(0, 0, -0.009); box(b, 0.03, 0.008, 0.004, { bevel: 0.001, edge: 0 }); });
      }
    });
  }
  // pouches
  for (const a of o.pouches ?? []) {
    onRing(b, ring, a, 0.03, () => {
      b.surf({ ...pal.leather, zone: ZONE.body });
      b.scope(() => { b.translate(0, -0.035, 0); box(b, 0.07, 0.085, 0.05, { bevel: 0.012, taper: [0.92, 0.9] }); });
      // flap + stud
      b.surf({ ...pal.leather, color: dom ? 0x3a2a1e : 0x1d222b, zone: ZONE.body });
      b.scope(() => { b.translate(0, -0.006, -0.004); box(b, 0.076, 0.04, 0.056, { bevel: 0.01 }); });
      b.surf(trim);
      b.scope(() => { b.translate(0, -0.022, -0.033); box(b, 0.012, 0.012, 0.008, { bevel: 0.003 }); });
    });
  }
  if (o.crossBelt) {
    b.surf({ ...pal.leather, zone: ZONE.body });
    loft(b, [{ ...secAt(T, 0.985, off + 0.02), tilt: 0, roll: 9 }, { ...secAt(T, 0.945, off + 0.022), tilt: 0, roll: 9 }], { seg: 24, thick: 0.008 });
  }
  // tassets
  if (o.tassets && o.tassets !== 'none') {
    const base = secAt(T, 0.975, off + 0.014);
    const plates: Array<{ a: number; w: number; len: number; side: number }> = [{ a: 34, w: 27, len: 0.19, side: 1 }, { a: -34, w: 27, len: 0.19, side: -1 }];
    if (o.tassets === 'full') plates.push({ a: 96, w: 30, len: 0.17, side: 1 }, { a: -96, w: 30, len: 0.17, side: -1 });
    for (const p of plates) {
      const th = rig.si('thigh', p.side);
      const skin: SkinFn = (_x, y, _z, so) => { const t = smooth01(1.0, 0.82, y) * 0.78; so.i0 = hips; so.w0 = 1 - t; so.i1 = th; so.w1 = t; };
      // two overlapping lames per tasset
      for (let i = 1; i >= 0; i--) {
        const y0 = 0.99 - i * p.len * 0.42, y1 = y0 - p.len * 0.62;
        b.surf({ ...(i === 0 ? pal.plate : pal.plate2), zone: ZONE.leg }).skin(skin);
        loft(b, [
          { ...base, y: y0, rx: base.rx + 0.004 - i * 0.004, rz: base.rz + 0.006 - i * 0.004, rzb: (base.rzb ?? base.rz) + 0.004, a0: p.a - p.w, a1: p.a + p.w },
          { ...base, y: (y0 + y1) / 2, rx: base.rx + 0.012 - i * 0.004, rz: base.rz + 0.014 - i * 0.004, rzb: (base.rzb ?? base.rz) + 0.01, a0: p.a - p.w * 0.96, a1: p.a + p.w * 0.96 },
          { ...base, y: y1, rx: base.rx + 0.016 - i * 0.004, rz: base.rz + 0.018 - i * 0.004, rzb: (base.rzb ?? base.rz) + 0.014, a0: p.a - p.w * 0.72, a1: p.a + p.w * 0.72 },
        ], { seg: 8, thick: 0.012, smooth: 2, trim: { w: dom ? 0.007 : 0.004, raise: 0.003, slot: 1, v0: false }, slots: [undefined, { ...pal.trim, zone: ZONE.leg }] });
      }
    }
  }
}
