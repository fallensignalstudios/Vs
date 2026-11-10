/** The two protagonists: Tarrik (Dominion) and Selene (Reformation). */
import type { ArchetypeDef, BuildCtx } from '../figure';
import { PART, ZONE, type Surf } from '../geo/builder';
import { box, tube, torus, type V3 } from '../geo/prims';
import { buildBody, secAt, torsoSecs } from '../parts/body';
import { buildHead } from '../parts/head';
import { DOM_PAL, REF_PAL, backpack, cuirass, gorget, onRing, pauldron, strap, type Pal } from '../parts/armor';
import { armArmor, legArmor, waist } from '../parts/armor-limbs';
import { axiom, cinderline, holster, sealedCase, velkorran, verity } from '../parts/weapons';
import { clothPanel } from '../cloth';
import { skirt } from '../parts/gear';
import { TARRIK_MOVES } from '../clips/tarrik';
import { SELENE_MOVES } from '../clips/selene';

const rad = (d: number): number => (d * Math.PI) / 180;

/**
 * Cloth hanging from the belt: a wrap from angle a0 to a1 (degrees around the waist), `len(u)` long.
 * Returns the panel's rest function for clothPanel.
 */
export function hipWrap(ctx: BuildCtx, a0: number, a1: number, len: (u: number) => number, flare = 0.12, out = 0.035): (u: number, v: number) => [number, number, number] {
  const T = torsoSecs(ctx.rig);
  const ring = secAt(T, 1.0, out);
  return (u, v) => {
    const th = rad(a0 + (a1 - a0) * u);
    const s = Math.sin(th), c = Math.cos(th);
    const L = len(u);
    const grow = 1 + flare * v;
    const rz = c >= 0 ? ring.rz : ring.rzb ?? ring.rz;
    return [ring.rx * s * grow, 1.0 - L * v, (ring.cz ?? 0) - rz * c * grow + 0.02 * v * Math.max(0, -c)];
  };
}

// ---------------------------------------------------------------------------------------------------------
// TARRIK
// ---------------------------------------------------------------------------------------------------------
const TARRIK_PAL: Pal = {
  ...DOM_PAL,
  plate: { color: 0x553c29, metal: 0.9, rough: 0.44 },
  plate2: { color: 0x2c2324, metal: 0.86, rough: 0.48 },
};

export const tarrik: ArchetypeDef = {
  proportions: () => ({ height: 1.95, shoulder: 0.212, hip: 0.1, bulk: 1.1, fem: 0 }),
  build(ctx) {
    const { b, rig, draft, spec } = ctx;
    const pal = TARRIK_PAL;
    const skin: Surf = { color: 0x9a6a46 };
    buildBody(b, rig, { suit: pal.suit, skin, glove: pal.leather, boot: pal.leather, noBoots: true });
    buildHead(b, rig, { skin, hair: { color: 0x1a120d }, style: 'crop', beard: true, jaw: 1.08, eye: 0x3a2413 });

    cuirass(b, rig, pal, { faction: 'dom', heft: 0.026, lames: 3, keel: 0.06 });
    gorget(b, rig, pal, { faction: 'dom', height: 0.07, scarf: pal.cloth });
    backpack(b, rig, pal, { faction: 'dom', size: 0.92 });
    pauldron(b, rig, -1, pal, { faction: 'dom', R: 0.138, lames: 3, fin: 0.115, ridge: true, enamel: true });
    pauldron(b, rig, 1, pal, { faction: 'dom', R: 0.124, lames: 2, ridge: true });
    // chest straps holding the pauldrons
    const chest = rig.i('chest');
    for (const s of [-1, 1]) strap(b, [[s * 0.2, 1.47, -0.06], [s * 0.14, 1.44, -0.125], [s * 0.05, 1.36, -0.168]] as V3[], 0.016, { ...pal.leather, zone: ZONE.chest }, chest);
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'dom', heft: 1 });
    waist(b, rig, pal, { faction: 'dom', heft: 1, tassets: 'full', pouches: [124, -132, -60], buckle: 'round' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'dom', heft: 1 });
    // chest: amber status slots like the concept
    b.skin(chest).surf({ ...pal.glow, zone: ZONE.chest, glow: 2.6 });
    const T = torsoSecs(rig);
    onRing(b, secAt(T, 1.4, 0.045), -34, 0.004, () => box(b, 0.05, 0.012, 0.01, { bevel: 0.003, edge: 0 }));
    onRing(b, secAt(T, 1.375, 0.047), -34, 0.004, () => box(b, 0.035, 0.008, 0.01, { bevel: 0.002, edge: 0 }));

    draft.items.melee = velkorran(b, rig, pal);
    draft.items.ranged = cinderline(b, rig, pal);
    holster(b, rig, pal, 1);
    draft.items.case = sealedCase(b, rig, REF_PAL);

    // hip half-cape: wraps the left hip round the back, longest behind the left leg
    draft.cloth.push(clothPanel(b, spec, {
      name: 'cape', cols: 6, rows: 6, pin: 'hips', sub: 4, shape: 0.04, damping: 0.035, folds: [7, 0.016],
      at: hipWrap(ctx, 296, 118, (u) => 0.5 + 0.2 * Math.sin(Math.PI * Math.min(1, u * 1.25)) - 0.12 * u, 0.2, 0.05),
      surf: { ...pal.cloth, zone: ZONE.back }, lining: { color: 0x2a0c0e }, trim: { color: 0x8a6a36, rough: 0.55, metal: 0.5 }, trimWidth: 0.022,
    }));

    draft.loadout = { melee: true, ranged: false, shield: false, prop: 'none' };
    draft.moveset = TARRIK_MOVES;
    draft.rim = { color: 0xffc890, amount: 0.2 };
    draft.lodDist = [16, 32];
    draft.radius = 0.42;
    draft.girth = 1.25;
  },
};

// ---------------------------------------------------------------------------------------------------------
// SELENE
// ---------------------------------------------------------------------------------------------------------
const SELENE_PAL: Pal = {
  ...REF_PAL,
  plate: { color: 0x1c2a44, metal: 0.66, rough: 0.3 },
  plate2: { color: 0x323e50, metal: 0.72, rough: 0.38 },
  suit: { color: 0x0f131a, rough: 0.7, part: PART.suit },
};

export const selene: ArchetypeDef = {
  proportions: () => ({ height: 1.76, shoulder: 0.172, hip: 0.094, bulk: 0.9, fem: 1 }),
  build(ctx) {
    const { b, rig, draft, spec } = ctx;
    const pal = SELENE_PAL;
    const skin: Surf = { color: 0xc59a7c };
    buildBody(b, rig, { suit: pal.suit, skin, glove: pal.leather, boot: pal.leather, noBoots: true });
    buildHead(b, rig, { skin, hair: { color: 0x15110f }, style: 'bun', jaw: 0.86, eye: 0x2c3a4a, fem: 1 });

    cuirass(b, rig, pal, { faction: 'ref', heft: 0.014, lames: 3, keel: 0.03 });
    gorget(b, rig, pal, { faction: 'ref', height: 0.045 });
    // spine light: thin cold line down the backplate
    const chest = rig.i('chest');
    const T = torsoSecs(rig);
    b.skin(chest).surf({ ...pal.glow, zone: ZONE.back, glow: 1.6 });
    tube(b, [[0, 1.44, (secAt(T, 1.44, 0.03).rzb ?? 0.1) + 0.006], [0, 1.34, (secAt(T, 1.34, 0.032).rzb ?? 0.1) + 0.006], [0, 1.24, (secAt(T, 1.24, 0.03).rzb ?? 0.1) + 0.004]] as V3[], 0.0035, { seg: 4 });
    onRing(b, secAt(T, 1.4, 0.03), 30, 0.003, () => box(b, 0.034, 0.006, 0.008, { bevel: 0.002, edge: 0 }));

    pauldron(b, rig, 1, pal, { faction: 'ref', R: 0.088, lames: 2 });
    pauldron(b, rig, -1, pal, { faction: 'ref', R: 0.08, lames: 1 });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'ref', heft: 0.25, rerebrace: s > 0, glowLine: true });
    waist(b, rig, pal, { faction: 'ref', heft: 0.2, tassets: 'none', pouches: [-140, 150, 62], buckle: 'plate', crossBelt: true });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'ref', heft: 0.25, sabaton: false, glowLine: true, cuisse: true });

    // split coat tail from the belt: a little length and motion behind the legs
    skirt(b, rig, { arc: [112, 248], top: 1.02, bottom: 0.6, flare: 0.16, out: 0.03, surf: { ...pal.cloth, color: 0x18243a, zone: ZONE.leg }, trim: { color: 0x8fa6bd, rough: 0.45, metal: 0.5 }, follow: 0.62, rows: 4 });

    draft.items.melee = verity(b, rig, pal);
    draft.items.ranged = axiom(b, rig, pal);
    holster(b, rig, pal, 1);
    draft.items.case = sealedCase(b, rig, pal);

    // asymmetric cloak over the left shoulder
    const sh = rig.p('uArmL');
    const topPts: V3[] = [[-0.035, 1.49, -0.11], [sh[0] - 0.02, 1.515, -0.07], [sh[0] - 0.06, 1.52, 0.03], [sh[0] + 0.03, 1.515, 0.115], [-0.04, 1.5, 0.135], [0.05, 1.48, 0.13]];
    const botPts: V3[] = [[-0.06, 1.0, -0.2], [sh[0] - 0.1, 0.86, -0.14], [sh[0] - 0.16, 0.7, 0.05], [sh[0] - 0.04, 0.6, 0.24], [-0.06, 0.72, 0.27], [0.1, 1.06, 0.2]];
    const poly = (pts: V3[], u: number): V3 => {
      const f = Math.min(pts.length - 1 - 1e-6, u * (pts.length - 1)), i = Math.floor(f), t = f - i;
      const a = pts[i], c = pts[i + 1];
      return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    };
    draft.cloth.push(clothPanel(b, spec, {
      name: 'cloak', cols: 6, rows: 5, pin: 'chest', sub: 4, shape: 0.035, damping: 0.045, folds: [6, 0.014],
      at: (u, v) => {
        const a = poly(topPts, u), c = poly(botPts, u);
        const w = Math.pow(v, 0.9);
        return [a[0] + (c[0] - a[0]) * w, a[1] + (c[1] - a[1]) * w, a[2] + (c[2] - a[2]) * w];
      },
      surf: { ...pal.cloth, color: 0x18243a, zone: ZONE.back }, lining: { color: 0x0c121d }, trim: { color: 0x8fa6bd, rough: 0.45, metal: 0.5 }, trimWidth: 0.014,
    }));
    // rolled hood at the nape
    b.skin(chest).surf({ ...pal.cloth, color: 0x18243a, zone: ZONE.back });
    b.scope(() => { b.at(0, 1.5, 0.085, 24, 0, 0); b.scale(1.25, 0.8, 1); torus(b, 0.07, 0.03, { seg: 14, tubeSeg: 7, arc: [70, 290] }); });

    draft.loadout = { melee: true, ranged: false, shield: false, prop: 'none' };
    draft.moveset = SELENE_MOVES;
    draft.rim = { color: 0xa9d2ff, amount: 0.3 };
    draft.lodDist = [16, 32];
    draft.radius = 0.38;
    draft.girth = 1.1;
  },
};
