/**
 * Weapons and carried equipment. Each is modelled in its own frame — grip at the origin, blade / barrel along
 * −Z, +Y up — and bound rigidly to an equipment bone (weapon / gun / shield / prop) whose mount the visual
 * switches between hand and sheath.
 */
import * as THREE from 'three';
import { MeshBuilder, PART, ZONE, type Surf } from '../geo/builder';
import { loft, box, prism, sweep, torus, tube, lathe, type SweepPoint, type V3 } from '../geo/prims';
import type { RigView } from '../rig';
import type { ItemDef, Mount, OverlayDef } from '../figure';
import type { Pal } from './armor';

const W: Partial<Surf> = { zone: ZONE.weapon };

/** Mount in the right / left palm (the equipment bones rest exactly there). */
export function inHand(rig: RigView, hand: 'R' | 'L', rot: V3 = [0, 0, 0]): Mount {
  const b = hand === 'R' ? 'weapon' : 'prop', h = hand === 'R' ? 'handR' : 'handL';
  const p = rig.p(b), q = rig.p(h);
  return { parent: h, pos: [p[0] - q[0], p[1] - q[1], p[2] - q[2]], rot };
}

/** Run `fn` with the builder positioned at an equipment bone's rest point, bound to that bone. */
function atBone(b: MeshBuilder, rig: RigView, bone: string, fn: () => void): void {
  const p = rig.p(bone);
  b.scope(() => { b.translate(p[0], p[1], p[2]); b.skin(rig.i(bone)); fn(); });
}

interface BladeOpts {
  z0: number; z1: number;
  /** half-width profile along the blade (t 0..1) */
  width: (t: number) => number;
  /** half-thickness profile */
  thick: (t: number) => number;
  /** blade width axis: 'y' (sword: edges up/down) or 'x' (Verity: flat in the ring plane) */
  axis: 'x' | 'y';
  steel: Surf; edge: Surf; fuller: Surf;
  rows?: number;
}

/** Double-edged blade with a recessed fuller; edge and fuller vertices carry the glow. */
function blade(b: MeshBuilder, o: BladeOpts): void {
  const rows = o.rows ?? 14;
  const rings: SweepPoint[][] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const z = o.z0 + (o.z1 - o.z0) * t;
    const w = Math.max(0.0015, o.width(t)), th = Math.max(0.0012, o.thick(t));
    const pts: Array<[number, number, number, number]> = [
      [0, w, 1, 1], [th, w * 0.6, 0, 0.6], [th, w * 0.2, 0, 0], [th * 0.42, 0, 2, 0], [th, -w * 0.2, 0, 0], [th, -w * 0.6, 0, 0.6],
      [0, -w, 1, 1], [-th, -w * 0.6, 0, 0.6], [-th, -w * 0.2, 0, 0], [-th * 0.42, 0, 2, 0], [-th, w * 0.2, 0, 0], [-th, w * 0.6, 0, 0.6],
    ];
    rings.push(pts.map(([a, c, slot, edge]) => (o.axis === 'y' ? { x: a, y: c, z, slot, edge } : { x: c, y: a, z, slot, edge })));
  }
  sweep(b, rings, { slots: [o.steel, o.edge, o.fuller] });
}

// -------------------------------------------------------------------------------------------------------
// Velkorran — Tarrik's greatsword
// -------------------------------------------------------------------------------------------------------
export function velkorran(b: MeshBuilder, rig: RigView, pal: Pal): ItemDef {
  const steel: Surf = { color: 0x2b2725, metal: 0.95, rough: 0.28, part: PART.blade, ...W };
  const edge: Surf = { color: 0x40261a, metal: 0.8, rough: 0.3, part: PART.blade, emissive: 0xff6a1a, glow: 2.6, ...W };
  const fuller: Surf = { color: 0x1a1210, metal: 0.7, rough: 0.5, part: PART.blade, emissive: 0xff5a14, glow: 0.8, ...W };
  atBone(b, rig, 'weapon', () => {
    // blade: 1.22 m, broad, slight leaf, long point
    blade(b, {
      z0: -0.135, z1: -1.36, axis: 'y', steel, edge, fuller, rows: 16,
      width: (t) => (t < 0.06 ? 0.05 + t * 0.2 : t < 0.78 ? 0.062 + 0.007 * Math.sin((t - 0.06) * 3.6) : 0.066 * Math.pow(Math.max(0, (1 - t) / 0.22), 0.72)),
      thick: (t) => 0.0125 * (1 - t * 0.55) * (t > 0.94 ? (1 - t) / 0.06 : 1),
    });
    // ricasso collar
    b.surf({ ...pal.plate, ...W });
    b.scope(() => { b.translate(0, 0, -0.165); box(b, 0.036, 0.094, 0.07, { bevel: 0.01 }); });
    b.surf({ ...pal.trim, ...W });
    b.scope(() => { b.translate(0, 0, -0.205); box(b, 0.03, 0.07, 0.012, { bevel: 0.004 }); });
    // crossguard: swept quillons with a cinder core
    b.surf({ ...pal.plate, ...W });
    b.scope(() => {
      b.translate(0, 0, -0.118);
      // outline authored as (y along the guard, z along the blade); prism X→Y, Y→Z, depth→X
      b.rotate(90, 90, 0);
      prism(b, [[-0.03, -0.2], [0.012, -0.215], [0.03, -0.12], [0.034, -0.05], [0.034, 0.05], [0.03, 0.12], [0.012, 0.215], [-0.03, 0.2], [-0.012, 0.11], [-0.018, 0], [-0.012, -0.11]].map(([z, y]) => [y, z] as [number, number]), 0.04, { bevel: 0.009 });
    });
    b.surf({ ...pal.trim, ...W });
    for (const s of [-1, 1]) b.scope(() => { b.at(0, s * 0.205, -0.112, 0, 0, 0); box(b, 0.046, 0.03, 0.05, { bevel: 0.01 }); });
    b.surf({ color: 0x2a1206, part: PART.glow, emissive: 0xff7a22, glow: 5, ...W });
    b.scope(() => { b.translate(0, 0, -0.118); b.rotate(0, 0, 45); box(b, 0.05, 0.034, 0.034, { bevel: 0.008, edge: 0 }); });
    // grip: leather wrap with bands
    b.surf({ ...pal.leather, ...W });
    b.scope(() => {
      b.rotate(90, 0, 0);
      const prof: Array<[number, number]> = [];
      for (let i = 0; i <= 12; i++) { const y = -0.095 + (0.375 * i) / 12; prof.push([0.0165 + 0.0016 * Math.cos(i * Math.PI) + 0.002 * Math.sin((i / 12) * Math.PI), y]); }
      lathe(b, prof, { seg: 10 });
    });
    b.surf({ ...pal.trim, ...W });
    for (const z of [-0.09, 0.085, 0.262]) b.scope(() => { b.at(0, 0, z, 90, 0, 0); torus(b, 0.0185, 0.0055, { seg: 12, tubeSeg: 5 }); });
    // pommel
    b.surf({ ...pal.plate, ...W });
    b.scope(() => { b.at(0, 0, 0.305, 90, 0, 0); lathe(b, [[0.014, -0.03], [0.03, -0.012], [0.034, 0.008], [0.022, 0.03], [0.006, 0.04]], { seg: 8, capA: 'flat', capB: 'flat' }); });
    b.surf({ color: 0x2a1206, part: PART.glow, emissive: 0xff7a22, glow: 3, ...W });
    b.scope(() => { b.at(0, 0, 0.308, 90, 0, 0); torus(b, 0.034, 0.004, { seg: 8, tubeSeg: 4 }); });
  });
  return {
    bone: 'weapon', held: inHand(rig, 'R'),
    // across the back: hilt over the right shoulder, point toward the left hip, flat against the cape
    sheath: { parent: 'chest', pos: [0.2, 0.32, 0.215], axes: { z: [0.42, 0.9, -0.04], x: [0, 0.05, 1] } },
    grip2: [0, 0, 0.165],
    sockets: { weaponBase: [0, 0, -0.16], weaponMid: [0, 0, -0.78], weaponTip: [0, 0, -1.36] },
  };
}

// -------------------------------------------------------------------------------------------------------
// Verity — Selene's ring-hilted double blade
// -------------------------------------------------------------------------------------------------------
export function verity(b: MeshBuilder, rig: RigView, pal: Pal): ItemDef {
  const ice: Surf = { color: 0x6fa6cc, metal: 0.3, rough: 0.14, part: PART.blade, emissive: 0xbfe8ff, glow: 0.16, ...W };
  const edge: Surf = { color: 0xd8f1ff, metal: 0.1, rough: 0.1, part: PART.blade, emissive: 0xcfeeff, glow: 2.3, ...W };
  const core: Surf = { color: 0x4f8fc0, metal: 0.3, rough: 0.2, part: PART.blade, emissive: 0x8fd4ff, glow: 0.55, ...W };
  atBone(b, rig, 'weapon', () => {
    // hilt ring (lies in the XZ plane: the fist sits inside it like a guard)
    b.surf({ ...pal.plate2, ...W });
    torus(b, 0.094, 0.0125, { seg: 28, tubeSeg: 7, flat: 0.72 });
    b.surf({ ...pal.trim, ...W });
    torus(b, 0.094, 0.0135, { seg: 28, tubeSeg: 5, flat: 0.3 });
    b.surf({ ...pal.glow, ...W, glow: 2.4 });
    torus(b, 0.0815, 0.0034, { seg: 28, tubeSeg: 4 });
    // grip bar across the ring
    b.surf({ ...pal.leather, ...W });
    b.scope(() => { b.rotate(90, 0, 0); lathe(b, [[0.013, -0.082], [0.0155, -0.05], [0.0145, 0], [0.0155, 0.05], [0.013, 0.082]], { seg: 8 }); });
    // emitters where the blades leave the ring
    for (const s of [-1, 1]) {
      b.surf({ ...pal.plate, ...W });
      b.scope(() => { b.translate(0, 0, s * 0.1); box(b, 0.062, 0.03, 0.044, { bevel: 0.008, taper: [1, 1] }); });
      b.surf({ ...pal.trim, ...W });
      b.scope(() => { b.translate(0, 0, s * 0.126); box(b, 0.05, 0.022, 0.012, { bevel: 0.004 }); });
      // ring braces
      for (const sx of [-1, 1]) tube(b, [[sx * 0.03, 0, s * 0.085], [sx * 0.07, 0, s * 0.06]], 0.006, { seg: 5 });
    }
  });
  const mk = (bone: 'bladeA' | 'bladeB', dir: number): void => {
    atBone(b, rig, bone, () => {
      blade(b, {
        z0: dir * -0.128, z1: dir * -0.74, axis: 'x', steel: ice, edge, fuller: core, rows: 12,
        width: (t) => (t < 0.08 ? 0.02 + t * 0.2 : 0.036 * Math.pow(Math.max(0, 1 - (t - 0.08) / 0.92), 0.55) + 0.001),
        thick: (t) => 0.0062 * (1 - t * 0.6),
      });
    });
  };
  mk('bladeA', 1);
  mk('bladeB', -1);
  return {
    bone: 'weapon', held: inHand(rig, 'R'), blades: true,
    // hilt ring flat against the left hip
    sheath: { parent: 'hips', pos: [-(rig.prop.hip + 0.105) * rig.prop.bulk, -0.05, 0.02], axes: { y: [-1, 0.12, 0], z: [0, 0.3, 1] } },
    sockets: { weaponBase: [0, 0, -0.13], weaponMid: [0, 0, -0.43], weaponTip: [0, 0, -0.74], weaponTip2: [0, 0, 0.74] },
  };
}

// -------------------------------------------------------------------------------------------------------
// Sidearms
// -------------------------------------------------------------------------------------------------------
const HOLSTER_AXES = { z: [0.02, 1, 0.12] as V3, y: [0, -0.12, 1] as V3 };

/** Thigh holster body so a sheathed pistol sits in something. */
export function holster(b: MeshBuilder, rig: RigView, pal: Pal, side: number): void {
  const th = rig.sp('thigh', side);
  const k = rig.prop.bulk;
  b.skin(rig.si('thigh', side));
  b.surf({ ...pal.leather, zone: ZONE.leg });
  b.scope(() => { b.at(th[0] + side * 0.1 * k, th[1] - 0.2, 0.012, 6, 0, 0); box(b, 0.036, 0.19, 0.085, { bevel: 0.012, taper: [1.1, 1.1] }); });
  // thigh straps
  for (const y of [th[1] - 0.14, th[1] - 0.25]) b.scope(() => { b.translate(th[0], y, 0); loft(b, [{ y: -0.012, rx: 0.094 * k, rz: 0.1 * k }, { y: 0.012, rx: 0.095 * k, rz: 0.101 * k }], { seg: 12, thick: 0.006 }); });
}

/** Cinderline — Tarrik's heavy sidearm. */
export function cinderline(b: MeshBuilder, rig: RigView, pal: Pal): ItemDef {
  atBone(b, rig, 'gun', () => {
    // grip
    b.surf({ ...pal.leather, ...W });
    b.scope(() => { b.at(0, -0.022, 0.012, -14, 0, 0); box(b, 0.034, 0.125, 0.05, { bevel: 0.01, taper: [0.95, 0.92] }); });
    // frame + slab-sided slide
    b.surf({ ...pal.dark, metal: 0.85, rough: 0.35, ...W });
    b.scope(() => { b.translate(0, 0.048, -0.07); box(b, 0.04, 0.058, 0.23, { bevel: 0.009 }); });
    b.surf({ ...pal.plate, ...W });
    b.scope(() => { b.translate(0, 0.074, -0.06); box(b, 0.044, 0.02, 0.2, { bevel: 0.006 }); });
    // heavy cylinder block ahead of the trigger
    b.surf({ ...pal.plate2, ...W });
    b.scope(() => { b.at(0, 0.02, -0.09, 90, 0, 0); lathe(b, [[0.03, -0.035], [0.034, -0.03], [0.034, -0.03], [0.034, 0.03], [0.034, 0.03], [0.03, 0.035]], { seg: 8, capA: 'flat', capB: 'flat' }); });
    // barrel shroud + muzzle brake with vents
    b.surf({ ...pal.dark, metal: 0.9, rough: 0.3, ...W });
    b.scope(() => { b.at(0, 0.046, -0.235, 90, 0, 0); lathe(b, [[0.019, -0.065], [0.022, -0.055], [0.022, 0.055], [0.026, 0.06], [0.026, 0.06], [0.026, 0.085], [0.026, 0.085], [0.012, 0.088]], { seg: 8, capA: 'flat', capB: 'flat' }); });
    b.surf({ ...pal.glow, ...W, glow: 2.6 });
    for (const sx of [-1, 1]) b.scope(() => { b.translate(sx * 0.0225, 0.046, -0.215); box(b, 0.004, 0.012, 0.07, { bevel: 0.001, edge: 0 }); });
    // sights, hammer, trigger guard
    b.surf({ ...pal.trim, ...W });
    b.scope(() => { b.translate(0, 0.09, 0.03); box(b, 0.022, 0.012, 0.016, { bevel: 0.003 }); });
    b.scope(() => { b.translate(0, 0.09, -0.15); box(b, 0.008, 0.012, 0.014, { bevel: 0.002 }); });
    b.surf({ ...pal.dark, metal: 0.8, ...W });
    tube(b, [[0, 0.02, -0.02], [0, -0.022, -0.03], [0, -0.03, -0.065], [0, 0.0, -0.085]], 0.005, { seg: 5 });
  });
  return {
    bone: 'gun', held: inHand(rig, 'R', [-90, 0, 0]),
    sheath: { parent: 'thighR', pos: [0.1 * rig.prop.bulk + 0.004, -0.135, 0.01], axes: HOLSTER_AXES },
    sockets: { muzzle: [0, 0.046, -0.325] },
  };
}

/** Axiom — Selene's long-slide precision weapon. */
export function axiom(b: MeshBuilder, rig: RigView, pal: Pal): ItemDef {
  atBone(b, rig, 'gun', () => {
    b.surf({ ...pal.leather, ...W });
    b.scope(() => { b.at(0, -0.02, 0.01, -16, 0, 0); box(b, 0.028, 0.115, 0.044, { bevel: 0.008, taper: [0.94, 0.9] }); });
    b.surf({ ...pal.plate, ...W });
    b.scope(() => { b.translate(0, 0.04, -0.1); box(b, 0.03, 0.046, 0.3, { bevel: 0.007 }); });
    b.surf({ ...pal.plate2, ...W });
    b.scope(() => { b.translate(0, 0.018, -0.12); box(b, 0.026, 0.02, 0.2, { bevel: 0.005 }); });
    // long octagonal barrel
    b.surf({ ...pal.trim, ...W });
    b.scope(() => { b.at(0, 0.044, -0.305, 90, 0, 0); lathe(b, [[0.0115, -0.06], [0.0115, 0.06], [0.0115, 0.06], [0.015, 0.064], [0.015, 0.09], [0.015, 0.09], [0.008, 0.092]], { seg: 8, capA: 'flat', capB: 'flat' }); });
    // optic rail with a cold lens
    b.surf({ ...pal.dark, metal: 0.7, ...W });
    b.scope(() => { b.translate(0, 0.07, -0.06); box(b, 0.02, 0.012, 0.16, { bevel: 0.003 }); });
    b.scope(() => { b.translate(0, 0.088, -0.045); box(b, 0.026, 0.026, 0.06, { bevel: 0.006 }); });
    b.surf({ ...pal.glow, ...W, glow: 3 });
    b.scope(() => { b.translate(0, 0.088, -0.077); box(b, 0.016, 0.016, 0.004, { bevel: 0.001, edge: 0 }); });
    for (const sx of [-1, 1]) b.scope(() => { b.translate(sx * 0.0158, 0.044, -0.13); box(b, 0.002, 0.005, 0.15, { bevel: 0.0008, edge: 0 }); });
    b.surf({ ...pal.dark, metal: 0.8, ...W });
    tube(b, [[0, 0.018, -0.015], [0, -0.02, -0.025], [0, -0.026, -0.055], [0, 0.008, -0.07]], 0.0042, { seg: 5 });
  });
  return {
    bone: 'gun', held: inHand(rig, 'R', [-90, 0, 0]),
    sheath: { parent: 'thighR', pos: [0.098 * rig.prop.bulk + 0.004, -0.135, 0.01], axes: HOLSTER_AXES },
    sockets: { muzzle: [0, 0.044, -0.4] },
  };
}

/** Service rifle (two design languages). Bound to the gun bone; the off hand takes the handguard. */
export function rifle(b: MeshBuilder, rig: RigView, pal: Pal, dom: boolean): ItemDef {
  atBone(b, rig, 'gun', () => {
    b.surf({ ...pal.leather, ...W });
    b.scope(() => { b.at(0, -0.02, 0.012, -16, 0, 0); box(b, 0.03, 0.11, 0.044, { bevel: 0.008, taper: [0.94, 0.9] }); });
    // receiver
    b.surf({ ...pal.dark, metal: 0.85, rough: 0.38, ...W });
    b.scope(() => { b.translate(0, 0.048, -0.06); box(b, 0.046, 0.076, 0.34, { bevel: 0.01 }); });
    // stock
    b.surf({ ...(dom ? pal.plate : pal.plate2), ...W });
    b.scope(() => { b.at(0, 0.03, 0.23, 4, 0, 0); box(b, 0.036, 0.09, 0.26, { bevel: 0.014, taper: [0.9, 1] }); });
    b.surf({ ...pal.dark, ...W, part: PART.suit });
    b.scope(() => { b.translate(0, 0.022, 0.365); box(b, 0.04, 0.12, 0.022, { bevel: 0.008 }); });
    // handguard
    b.surf({ ...(dom ? pal.plate : pal.plate), ...W });
    b.scope(() => { b.translate(0, 0.046, -0.36); box(b, dom ? 0.05 : 0.044, dom ? 0.062 : 0.054, 0.28, { bevel: 0.012 }); });
    b.surf({ ...pal.trim, ...W });
    for (const z of [-0.24, -0.48]) b.scope(() => { b.translate(0, 0.046, z); box(b, dom ? 0.054 : 0.047, dom ? 0.066 : 0.057, 0.014, { bevel: 0.004 }); });
    // barrel + muzzle device
    b.surf({ ...pal.dark, metal: 0.9, rough: 0.3, ...W });
    b.scope(() => { b.at(0, 0.052, -0.6, 90, 0, 0); lathe(b, [[0.011, -0.11], [0.011, 0.08], [0.011, 0.08], [0.017, 0.085], [0.017, 0.13], [0.017, 0.13], [0.009, 0.132]], { seg: 8, capA: 'flat', capB: 'flat' }); });
    // magazine
    b.surf({ ...pal.plate2, ...W });
    b.scope(() => { b.at(0, -0.035, -0.115, -8, 0, 0); box(b, 0.03, 0.13, 0.06, { bevel: 0.008 }); });
    // optic
    b.surf({ ...pal.dark, metal: 0.7, ...W });
    b.scope(() => { b.translate(0, 0.104, -0.06); box(b, 0.034, 0.034, 0.12, { bevel: 0.009 }); });
    b.surf({ ...pal.glow, ...W, glow: 2.6 });
    b.scope(() => { b.translate(0, 0.104, -0.123); box(b, 0.022, 0.022, 0.004, { bevel: 0.001, edge: 0 }); });
    for (const sx of [-1, 1]) b.scope(() => { b.translate(sx * (dom ? 0.0262 : 0.0232), 0.05, -0.36); box(b, 0.003, 0.008, 0.2, { bevel: 0.001, edge: 0 }); });
  });
  return {
    bone: 'gun', held: inHand(rig, 'R', [-90, 0, 0]), rifle: true,
    sheath: { parent: 'chest', pos: [-0.06, 0.1, 0.19], axes: { z: [-0.5, -0.86, 0], x: [0, 0, 1] } },
    grip2: [0, 0.03, -0.26], grip2Rot: [0, 78, 0],
    sockets: { muzzle: [0, 0.052, -0.735] },
  };
}

// -------------------------------------------------------------------------------------------------------
// Enforcer: tower shield + shock baton
// -------------------------------------------------------------------------------------------------------
export function towerShield(b: MeshBuilder, rig: RigView, pal: Pal, overlays: OverlayDef[]): ItemDef {
  const S: Partial<Surf> = { zone: ZONE.shield };
  const H = 0.66, R = 0.5;
  // half-arc (degrees) of the face at height t (−1..1): clipped corners
  const arcAt = (t: number): number => 38 * (Math.abs(t) > 0.72 ? 1 - (Math.abs(t) - 0.72) * 1.5 : 1);
  atBone(b, rig, 'shield', () => {
    b.translate(0, -0.1, 0);
    b.surf({ ...pal.plate2, ...S });
    const secs = [-1, -0.86, -0.72, -0.3, 0.3, 0.72, 0.86, 1].map((t) => ({ y: t * H, rx: R, rz: R, cz: R - 0.07, a0: -arcAt(t), a1: arcAt(t), slot: Math.abs(t) < 0.75 ? 2 : 0 }));
    loft(b, secs, { seg: 14, thick: 0.03, inner: true, innerSlot: 3, trim: { w: 0.03, raise: 0.008, slot: 1 }, slots: [undefined, { ...pal.plate, ...S }, { ...pal.enamel, ...S }, { ...pal.dark, ...S }] });
    // vertical spine + boss
    b.surf({ ...pal.plate, ...S });
    b.scope(() => { b.translate(0, 0, -0.082); box(b, 0.07, H * 1.7, 0.03, { bevel: 0.012 }); });
    b.surf({ ...pal.trim, ...S });
    b.scope(() => { b.at(0, 0.06, -0.09, 90, 0, 0); lathe(b, [[0.1, -0.012], [0.1, 0.004], [0.1, 0.004], [0.07, 0.03], [0.03, 0.045], [0.004, 0.048]], { seg: 16, capA: 'flat', capB: 'flat' }); });
    // energy rim: emissive rail around the perimeter
    b.surf({ ...pal.glow, ...S, glow: 2.4 });
    const rail: V3[] = [];
    const ring = (t: number, sgn: number): V3 => { const a = (sgn * (arcAt(t) - 1.2) * Math.PI) / 180; return [Math.sin(a) * (R + 0.012), t * H * 0.985, R - 0.07 - Math.cos(a) * (R + 0.012)]; };
    for (const t of [-1, -0.86, -0.72, -0.3, 0.3, 0.72, 0.86, 1]) rail.push(ring(t, 1));
    for (const t of [1, 0.86, 0.72, 0.3, -0.3, -0.72, -0.86, -1]) rail.push(ring(t, -1));
    tube(b, rail, 0.006, { seg: 5, closed: true });
    // arm straps on the inside
    b.surf({ ...pal.leather, ...S });
    for (const y of [0.16, 0.02]) tube(b, [[-0.07, y, -0.02], [-0.04, y, 0.045], [0.04, y, 0.045], [0.07, y, -0.02]], 0.012, { seg: 5, flat: 0.4 });
  });
  // translucent energy field just proud of the face
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], idx: number[] = [];
  const ts = [-1, -0.86, -0.72, -0.3, 0.3, 0.72, 0.86, 1];
  ts.forEach((t) => { for (const sgn of [-1, -0.5, 0, 0.5, 1]) { const a = (sgn * arcAt(t) * 1.02 * Math.PI) / 180; pos.push(Math.sin(a) * (R + 0.05), t * H * 1.02 - 0.1, R - 0.07 - Math.cos(a) * (R + 0.05)); } });
  for (let i = 0; i < ts.length - 1; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j; idx.push(a, a + 1, a + 6, a, a + 6, a + 5); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  overlays.push({ bone: 'shield', geometry: g, color: 0xffa033, intensity: 1.0, opacity: 0.022, with: 'shield' });
  return {
    bone: 'shield',
    // strapped to the outside of the left forearm; upright when the forearm is held across the body
    held: { parent: 'fArmL', pos: [-0.075, -0.12, 0], axes: { z: [1, 0, 0], y: [0, 0, -1] } },
    sheath: null,
  };
}

export function shockBaton(b: MeshBuilder, rig: RigView, pal: Pal): ItemDef {
  atBone(b, rig, 'weapon', () => {
    b.surf({ ...pal.leather, ...W });
    b.scope(() => { b.rotate(90, 0, 0); lathe(b, [[0.017, -0.11], [0.0185, -0.06], [0.017, 0], [0.0185, 0.07], [0.02, 0.1]], { seg: 8, capA: 'flat' }); });
    b.surf({ ...pal.plate, ...W });
    b.scope(() => { b.at(0, 0, -0.115, 90, 0, 0); lathe(b, [[0.02, -0.014], [0.04, -0.008], [0.04, 0.008], [0.02, 0.014]], { seg: 10, capA: 'flat', capB: 'flat' }); });
    b.scope(() => { b.at(0, 0, 0.11, 90, 0, 0); lathe(b, [[0.02, -0.012], [0.026, 0], [0.012, 0.018]], { seg: 8, capA: 'flat', capB: 'flat' }); });
    // shaft
    b.surf({ ...pal.dark, metal: 0.85, rough: 0.35, ...W });
    b.scope(() => { b.at(0, 0, -0.38, 90, 0, 0); lathe(b, [[0.016, -0.26], [0.016, 0.2], [0.016, 0.2], [0.024, 0.21], [0.026, 0.3], [0.014, 0.33]], { seg: 8, capA: 'flat', capB: 'flat' }); });
    // shock coils
    b.surf({ color: 0x2a1608, part: PART.blade, emissive: 0xffa033, glow: 4, ...W });
    for (const z of [-0.5, -0.56, -0.62, -0.68]) b.scope(() => { b.at(0, 0, z, 90, 0, 0); torus(b, 0.03, 0.0065, { seg: 12, tubeSeg: 5 }); });
    b.surf({ ...pal.trim, ...W });
    for (const a of [0, 120, 240]) { const t = (a * Math.PI) / 180; tube(b, [[Math.cos(t) * 0.03, Math.sin(t) * 0.03, -0.46], [Math.cos(t) * 0.036, Math.sin(t) * 0.036, -0.6], [Math.cos(t) * 0.02, Math.sin(t) * 0.02, -0.74]], 0.005, { seg: 4 }); }
  });
  return {
    bone: 'weapon', held: inHand(rig, 'R'),
    sheath: { parent: 'hips', pos: [(rig.prop.hip + 0.11) * rig.prop.bulk, 0.02, 0.06], axes: { z: [0.06, 1, 0.1], x: [0, -0.1, 1] } },
    sockets: { weaponBase: [0, 0, -0.14], weaponMid: [0, 0, -0.45], weaponTip: [0, 0, -0.74] },
  };
}

/** The sealed case (carried in the left hand by its top handle). */
export function sealedCase(b: MeshBuilder, rig: RigView, pal: Pal): ItemDef {
  const P: Partial<Surf> = { zone: ZONE.body };
  atBone(b, rig, 'prop', () => {
    // handle through the fist
    b.surf({ ...pal.dark, metal: 0.6, ...P });
    tube(b, [[0, -0.05, -0.09], [0, 0, -0.07], [0, 0, 0.07], [0, -0.05, 0.09]], 0.011, { seg: 6 });
    // body
    b.surf({ ...pal.plate2, ...P });
    b.scope(() => { b.translate(0, -0.2, 0); box(b, 0.12, 0.29, 0.44, { bevel: 0.022 }); });
    b.surf({ ...pal.plate, ...P });
    b.scope(() => { b.translate(0, -0.2, 0); box(b, 0.126, 0.2, 0.34, { bevel: 0.016 }); });
    // corner guards
    b.surf({ ...pal.trim, ...P });
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.scope(() => { b.translate(0, -0.2 + sy * 0.125, sz * 0.2); box(b, 0.13, 0.05, 0.05, { bevel: 0.012 }); });
    // seal band with cold lock lights
    b.surf({ ...pal.dark, ...P });
    b.scope(() => { b.translate(0, -0.2, 0); box(b, 0.132, 0.3, 0.05, { bevel: 0.01 }); });
    b.surf({ ...pal.glow, ...P, emissive: 0xcfeeff, glow: 3 });
    for (const sx of [-1, 1]) for (const y of [-0.13, -0.2, -0.27]) b.scope(() => { b.translate(sx * 0.0665, y, 0); box(b, 0.004, 0.03, 0.022, { bevel: 0.001, edge: 0 }); });
  });
  return { bone: 'prop', held: inHand(rig, 'L'), sheath: null };
}
