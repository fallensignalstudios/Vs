/** Dominion figures: Enforcer, Lyessa, Malik (injured), Varo (armed), the Z08 officer, line soldier, Cross. */
import type { ArchetypeDef } from '../figure';
import { PART, ZONE, type Surf } from '../geo/builder';
import { box, type V3 } from '../geo/prims';
import { armSecs, buildBody, secAt, torsoSecs, torsoSkin } from '../parts/body';
import { buildHead } from '../parts/head';
import { DOM_PAL, REF_PAL, backpack, cuirass, gorget, onRing, pauldron, strap, type Pal } from '../parts/armor';
import { armArmor, legArmor, waist } from '../parts/armor-limbs';
import { cinderline, holster, rifle, sealedCase, shockBaton, towerShield } from '../parts/weapons';
import { circlet, fatigues, headBandage, helmet, limbWraps, skirt, torsoWrap } from '../parts/gear';
import { clothPanel } from '../cloth';
import { RIFLE_MOVES, GENERIC } from '../clips/generic';
import { ENFORCER_MOVES } from '../clips/enforcer';

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const SKINS = [0xb98a66, 0xa9764e, 0x8a5a3c, 0xc79c7e, 0x6e4630] as const;

// ---------------------------------------------------------------------------------------------------------
export const enforcer: ArchetypeDef = {
  seedBuckets: 2,
  proportions: (rng) => ({ height: 2.04 + rng() * 0.05, shoulder: 0.226, hip: 0.104, bulk: 1.2, fem: 0 }),
  build(ctx) {
    const { b, rig, draft, rng } = ctx;
    const pal: Pal = {
      ...DOM_PAL,
      plate: { color: 0x4a3324, metal: 0.9, rough: 0.48 },
      plate2: { color: 0x221b1c, metal: 0.86, rough: 0.5 },
      enamel: { color: 0x521315, metal: 0.4, rough: 0.38 },
    };
    buildBody(b, rig, { suit: pal.suit, skin: { color: 0x8a5a3c }, glove: pal.leather, boot: pal.leather, noBoots: true });
    helmet(b, rig, pal, 'enforcer', true);
    cuirass(b, rig, pal, { faction: 'dom', heft: 0.034, lames: 3, keel: 0.07, enamel: true });
    gorget(b, rig, pal, { faction: 'dom', height: 0.1 });
    backpack(b, rig, pal, { faction: 'dom', size: 1 });
    for (const s of [-1, 1]) pauldron(b, rig, s, pal, { faction: 'dom', R: 0.15, lames: 3, ridge: true, enamel: true });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'dom', heft: 1.3 });
    waist(b, rig, pal, { faction: 'dom', heft: 1.3, tassets: 'full', pouches: rng() > 0.5 ? [140] : [-140], buckle: 'round' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'dom', heft: 1.3 });
    // ceremonial tabard between the tassets
    skirt(b, rig, { arc: [-17, 17], top: 1.0, bottom: 0.52, flare: 0.08, out: 0.06, surf: { ...pal.cloth, zone: ZONE.leg }, trim: { color: 0x8a6a36, rough: 0.55, metal: 0.5 }, follow: 0.35 });
    skirt(b, rig, { arc: [150, 210], top: 1.0, bottom: 0.5, flare: 0.1, out: 0.06, surf: { ...pal.cloth, zone: ZONE.leg }, trim: { color: 0x8a6a36, rough: 0.55, metal: 0.5 }, follow: 0.35 });

    draft.items.shield = towerShield(b, rig, pal, draft.overlays);
    draft.items.melee = shockBaton(b, rig, pal);
    draft.items.ranged = cinderline(b, rig, pal);
    holster(b, rig, pal, 1);
    draft.loadout = { melee: true, ranged: false, shield: true, prop: 'none' };
    draft.moveset = ENFORCER_MOVES;
    draft.rim = { color: 0xffb070, amount: 0.3 };
    draft.radius = 0.5;
    draft.girth = 1.3;
  },
};

// ---------------------------------------------------------------------------------------------------------
export const lyessa: ArchetypeDef = {
  proportions: () => ({ height: 1.75, shoulder: 0.176, hip: 0.094, bulk: 0.92, fem: 1 }),
  build(ctx) {
    const { b, rig, draft, spec } = ctx;
    const pal: Pal = { ...DOM_PAL, plate: { color: 0x5a402b, metal: 0.9, rough: 0.42 } };
    const skin: Surf = { color: 0xb98a66 };
    buildBody(b, rig, { suit: pal.suit, skin, glove: pal.leather, boot: pal.leather, noBoots: true });
    buildHead(b, rig, { skin, hair: { color: 0x3a1f14 }, style: 'tied', jaw: 0.88, eye: 0x3a2a1a, fem: 0.9 });
    circlet(b, rig, pal);
    cuirass(b, rig, pal, { faction: 'dom', heft: 0.018, lames: 2, keel: 0.04 });
    gorget(b, rig, pal, { faction: 'dom', height: 0.055, scarf: pal.cloth });
    pauldron(b, rig, 1, pal, { faction: 'dom', R: 0.098, lames: 1, ridge: true });
    pauldron(b, rig, -1, pal, { faction: 'dom', R: 0.09, lames: 0 });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'dom', heft: 0.4, rerebrace: s > 0 });
    waist(b, rig, pal, { faction: 'dom', heft: 0.5, tassets: 'front', pouches: [135, -150], buckle: 'round' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'dom', heft: 0.45 });
    // officer's sash: left shoulder to right hip
    const chest = rig.i('chest');
    strap(b, [[-0.13, 1.47, -0.08], [-0.05, 1.36, -0.135], [0.06, 1.24, -0.125], [0.13, 1.14, -0.1]] as V3[], 0.026, { ...pal.cloth, zone: ZONE.chest }, chest);
    // short mantle over the left shoulder
    const sh = rig.p('uArmL');
    const top: V3[] = [[-0.06, 1.485, -0.105], [sh[0] - 0.03, 1.52, -0.06], [sh[0] - 0.07, 1.525, 0.03], [sh[0] + 0.02, 1.515, 0.11], [0.0, 1.5, 0.135]];
    const bot: V3[] = [[-0.1, 1.2, -0.17], [sh[0] - 0.1, 1.13, -0.11], [sh[0] - 0.15, 1.08, 0.05], [sh[0] - 0.03, 1.05, 0.2], [0.02, 1.1, 0.22]];
    const poly = (pts: V3[], u: number): V3 => { const f = Math.min(pts.length - 1 - 1e-6, u * (pts.length - 1)), i = Math.floor(f), t = f - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t]; };
    draft.cloth.push(clothPanel(b, spec, {
      name: 'mantle', cols: 5, rows: 4, pin: 'chest', sub: 4, shape: 0.08, damping: 0.04, folds: [5, 0.01],
      at: (u, v) => { const a = poly(top, u), c = poly(bot, u); return [a[0] + (c[0] - a[0]) * v, a[1] + (c[1] - a[1]) * v, a[2] + (c[2] - a[2]) * v]; },
      surf: { ...pal.cloth, zone: ZONE.back }, lining: { color: 0x2a0c0e }, trim: { color: 0x8a6a36, rough: 0.55, metal: 0.5 }, trimWidth: 0.016,
    }));
    draft.items.ranged = rifle(b, rig, pal, true);
    draft.items.case = sealedCase(b, rig, REF_PAL);
    draft.loadout = { melee: false, ranged: true, shield: false, prop: 'none' };
    draft.moveset = RIFLE_MOVES;
    draft.rim = { color: 0xffc890, amount: 0.22 };
    draft.girth = 1.12;
  },
};

// ---------------------------------------------------------------------------------------------------------
export const malik: ArchetypeDef = {
  proportions: () => ({ height: 1.84, shoulder: 0.19, hip: 0.096, bulk: 1.0, fem: 0 }),
  build(ctx) {
    const { b, rig, draft } = ctx;
    const pal: Pal = { ...DOM_PAL, plate: { color: 0x4a382a, metal: 0.85, rough: 0.56 }, trim: { color: 0x7a6038, metal: 1, rough: 0.46 } };
    const skin: Surf = { color: 0x8a5a3c };
    const bandage: Surf = { color: 0x9c9682, rough: 0.92, part: PART.cloth };
    buildBody(b, rig, { suit: { ...pal.suit, color: 0x1f1c1e }, skin, boot: pal.leather, bareArms: true });
    buildHead(b, rig, { skin, hair: { color: 0x15100c }, style: 'buzz', jaw: 1.02 });
    headBandage(b, rig);
    // what is left of his armour: cuirass kept, one pauldron, one arm stripped and dressed
    cuirass(b, rig, pal, { faction: 'dom', heft: 0.02, lames: 2 });
    gorget(b, rig, pal, { faction: 'dom', height: 0.05 });
    pauldron(b, rig, 1, pal, { faction: 'dom', R: 0.105, lames: 1 });
    armArmor(b, rig, 1, pal, { faction: 'dom', heft: 0.5, gauntlet: false });
    waist(b, rig, pal, { faction: 'dom', heft: 0.5, tassets: 'none', pouches: [140], buckle: 'round' });
    legArmor(b, rig, -1, pal, { faction: 'dom', heft: 0.5, sabaton: false });
    legArmor(b, rig, 1, pal, { faction: 'dom', heft: 0.5, sabaton: false, cuisse: false, splint: true });
    fatigues(b, rig, { cloth: { color: 0x2a2526 }, strap: pal.leather, harness: false, kneePatches: false });
    // dressings: left arm wrapped, torso bound over the plate with a blood mark
    b.skin(rig.si('uArm', -1));
    const A = armSecs(rig, -1);
    const ey = rig.p('fArmL')[1], wy = rig.p('handL')[1];
    limbWraps(b, A, [ey + 0.16, ey + 0.11, ey + 0.06], { ...bandage, zone: ZONE.arm });
    b.skin(rig.si('fArm', -1));
    limbWraps(b, A, [ey - 0.07, ey - 0.12, ey - 0.17, wy + 0.05], { ...bandage, zone: ZONE.arm });
    torsoWrap(b, rig, 1.17, 1.07, 0.036, { ...bandage, zone: ZONE.chest }, torsoSkin(rig));
    b.skin(rig.i('spine')).surf({ color: 0x5a1a16, rough: 0.8, part: PART.cloth, zone: ZONE.chest });
    onRing(b, secAt(torsoSecs(rig), 1.12, 0.045), 52, 0.001, () => box(b, 0.07, 0.06, 0.006, { bevel: 0.002, edge: 0 }));
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = GENERIC;
    draft.breath = 1.8;
    draft.headBias = [8, 0, 4];
    draft.rim = { color: 0xffc890, amount: 0.2 };
  },
};

// ---------------------------------------------------------------------------------------------------------
export const dominionSoldier: ArchetypeDef = {
  seedBuckets: 4,
  proportions: (rng) => ({ height: 1.8 + rng() * 0.1, shoulder: 0.19 + rng() * 0.012, hip: 0.097, bulk: 1.0 + rng() * 0.08, fem: 0 }),
  build(ctx) {
    const { b, rig, draft, rng } = ctx;
    const tone = rng();
    const pal: Pal = { ...DOM_PAL, plate: { color: tone > 0.5 ? 0x4d3828 : 0x45342a, metal: 0.9, rough: 0.46 + rng() * 0.08 } };
    buildBody(b, rig, { suit: pal.suit, skin: { color: pick(rng, SKINS) }, glove: pal.leather, boot: pal.leather, noBoots: true });
    helmet(b, rig, pal, 'domSoldier', rng() > 0.3);
    cuirass(b, rig, pal, { faction: 'dom', heft: 0.02, lames: 2, keel: 0.04 });
    gorget(b, rig, pal, { faction: 'dom', height: 0.06, scarf: rng() > 0.5 ? pal.cloth : undefined });
    const R = 0.1 + rng() * 0.012;
    for (const s of [-1, 1]) pauldron(b, rig, s, pal, { faction: 'dom', R, lames: 1, ridge: rng() > 0.5 });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'dom', heft: 0.6 });
    waist(b, rig, pal, { faction: 'dom', heft: 0.6, tassets: 'front', pouches: rng() > 0.5 ? [130, -140] : [150, -120, -60], buckle: 'round' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'dom', heft: 0.6 });
    if (rng() > 0.45) backpack(b, rig, pal, { faction: 'dom', size: 0.78 });
    if (rng() > 0.4) skirt(b, rig, { arc: [140, 220], top: 1.0, bottom: 0.6, flare: 0.1, out: 0.05, surf: { ...pal.cloth, zone: ZONE.leg }, follow: 0.4 });
    draft.items.ranged = rifle(b, rig, pal, true);
    draft.loadout = { melee: false, ranged: true, shield: false, prop: 'none' };
    draft.moveset = RIFLE_MOVES;
    draft.rim = { color: 0xffc890, amount: 0.2 };
    draft.girth = 1.15;
  },
};

// ---------------------------------------------------------------------------------------------------------
/**
 * Centurion Malik Varo before his injury (Z00/Z01): a line soldier's kit, bare-headed, the Dominion rifle.
 * (ADDED, integration.) Normally drawn with the generated `varo` body; this figure is its driver and its fallback.
 */
export const varo: ArchetypeDef = {
  proportions: () => ({ height: 1.85, shoulder: 0.196, hip: 0.097, bulk: 1.05, fem: 0 }),
  build(ctx) {
    const { b, rig, draft } = ctx;
    const pal: Pal = { ...DOM_PAL, plate: { color: 0x523b29, metal: 0.9, rough: 0.46 } };
    const skin: Surf = { color: 0xa9764e };
    buildBody(b, rig, { suit: pal.suit, skin, glove: pal.leather, boot: pal.leather, noBoots: true });
    buildHead(b, rig, { skin, hair: { color: 0x15100c }, style: 'buzz', jaw: 1.04 });
    cuirass(b, rig, pal, { faction: 'dom', heft: 0.024, lames: 2, keel: 0.05 });
    gorget(b, rig, pal, { faction: 'dom', height: 0.06 });
    for (const s of [-1, 1]) pauldron(b, rig, s, pal, { faction: 'dom', R: 0.112, lames: 2, ridge: true });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'dom', heft: 0.8 });
    waist(b, rig, pal, { faction: 'dom', heft: 0.7, tassets: 'front', pouches: [130, -140], buckle: 'round' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'dom', heft: 0.7 });
    draft.items.ranged = rifle(b, rig, pal, true);
    draft.items.case = sealedCase(b, rig, REF_PAL);
    draft.loadout = { melee: false, ranged: true, shield: false, prop: 'none' };
    draft.moveset = RIFLE_MOVES;
    draft.rim = { color: 0xffc890, amount: 0.2 };
    draft.girth = 1.15;
  },
};

// ---------------------------------------------------------------------------------------------------------
/**
 * The Z08 Dominion officer the breach organism kept alive inside itself (ADDED, integration): black-bronze officer
 * plate with a high gorget, bare-headed, greying, unarmed. Normally drawn with the generated `officer` body.
 */
export const officer: ArchetypeDef = {
  proportions: () => ({ height: 1.82, shoulder: 0.186, hip: 0.095, bulk: 0.94, fem: 0 }),
  build(ctx) {
    const { b, rig, draft } = ctx;
    const pal: Pal = { ...DOM_PAL, plate: { color: 0x2a2220, metal: 0.9, rough: 0.4 }, trim: { color: 0x9a6a3a, metal: 1, rough: 0.4 } };
    const skin: Surf = { color: 0xc8a48a };
    buildBody(b, rig, { suit: pal.suit, skin, glove: pal.leather, boot: pal.leather, noBoots: true });
    buildHead(b, rig, { skin, hair: { color: 0x3c3834 }, style: 'crop', jaw: 0.96, eye: 0x3a3a40 });
    cuirass(b, rig, pal, { faction: 'dom', heft: 0.02, lames: 2, keel: 0.04 });
    gorget(b, rig, pal, { faction: 'dom', height: 0.11 });
    for (const s of [-1, 1]) pauldron(b, rig, s, pal, { faction: 'dom', R: 0.098, lames: 1 });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'dom', heft: 0.6 });
    waist(b, rig, pal, { faction: 'dom', heft: 0.6, tassets: 'front', buckle: 'round' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'dom', heft: 0.6 });
    skirt(b, rig, { arc: [-150, 150], top: 1.0, bottom: 0.62, flare: 0.08, out: 0.05, surf: { color: 0x5a1416, rough: 0.7, part: PART.cloth, zone: ZONE.leg }, follow: 0.4 });
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = GENERIC;
    draft.rim = { color: 0xffc890, amount: 0.2 };
    draft.girth = 1.1;
  },
};

// ---------------------------------------------------------------------------------------------------------
export const cross: ArchetypeDef = {
  proportions: () => ({ height: 1.9, shoulder: 0.2, hip: 0.098, bulk: 1.06, fem: 0 }),
  build(ctx) {
    const { b, rig, draft, spec } = ctx;
    const pal: Pal = {
      ...DOM_PAL,
      plate: { color: 0x5c432c, metal: 0.92, rough: 0.36 },
      trim: { color: 0xa8843f, metal: 1, rough: 0.3 },
      enamel: { color: 0x5a1416, metal: 0.4, rough: 0.34 },
    };
    const skin: Surf = { color: 0xa9805f };
    buildBody(b, rig, { suit: pal.suit, skin, glove: pal.leather, boot: pal.leather, noBoots: true });
    buildHead(b, rig, { skin, hair: { color: 0x8c8a86 }, style: 'crop', beard: true, jaw: 1.05, eye: 0x4a4a52 });
    cuirass(b, rig, pal, { faction: 'dom', heft: 0.024, lames: 3, keel: 0.06, enamel: true });
    gorget(b, rig, pal, { faction: 'dom', height: 0.1 });
    for (const s of [-1, 1]) pauldron(b, rig, s, pal, { faction: 'dom', R: 0.122, lames: 2, ridge: true, enamel: true, fin: 0.07 });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'dom', heft: 0.8 });
    waist(b, rig, pal, { faction: 'dom', heft: 0.8, tassets: 'full', buckle: 'round' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'dom', heft: 0.8 });
    skirt(b, rig, { arc: [-16, 16], top: 1.0, bottom: 0.45, flare: 0.08, out: 0.055, surf: { ...pal.cloth, zone: ZONE.leg }, trim: { color: 0xa8843f, rough: 0.5, metal: 0.6 }, follow: 0.35 });
    // full cape from both shoulders
    const T = torsoSecs(rig);
    const zb = (secAt(T, 1.4, 0.04).rzb ?? 0.12) + 0.03;
    const sw = rig.prop.shoulder;
    draft.cloth.push(clothPanel(b, spec, {
      name: 'cape', cols: 6, rows: 7, pin: 'chest', sub: 4, shape: 0.03, damping: 0.03, folds: [8, 0.03],
      at: (u, v) => {
        const x = (u - 0.5) * 2;
        const ang = x * 1.05;
        const top: V3 = [Math.sin(ang) * (sw + 0.03), 1.5 - Math.abs(x) * 0.03, zb * Math.cos(ang) - 0.05 * Math.abs(x)];
        const bot: V3 = [Math.sin(ang) * (sw + 0.2), 0.2, zb * Math.cos(ang) + 0.2 - 0.1 * Math.abs(x)];
        const w = v;
        return [top[0] + (bot[0] - top[0]) * w, top[1] + (bot[1] - top[1]) * w, top[2] + (bot[2] - top[2]) * w + 0.04 * Math.sin(Math.PI * v)];
      },
      surf: { ...pal.cloth, zone: ZONE.back }, lining: { color: 0x2a0c0e }, trim: { color: 0xa8843f, rough: 0.5, metal: 0.6 }, trimWidth: 0.03,
    }));
    draft.items.ranged = cinderline(b, rig, pal);
    holster(b, rig, pal, 1);
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = GENERIC;
    draft.rim = { color: 0xffc890, amount: 0.22 };
    draft.girth = 1.25;
  },
};
