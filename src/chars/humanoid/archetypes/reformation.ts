/** Reformation figures: Tharne, Lyric, line soldier, marine, medic, Sol. */
import type { ArchetypeDef } from '../figure';
import { PART, ZONE, type Surf } from '../geo/builder';
import { box } from '../geo/prims';
import { armSecs, buildBody, secAt, torsoSecs, torsoSkin } from '../parts/body';
import { buildHead } from '../parts/head';
import { REF_PAL, backpack, cuirass, gorget, onRing, pauldron, type Pal } from '../parts/armor';
import { armArmor, legArmor, waist } from '../parts/armor-limbs';
import { axiom, holster, rifle, sealedCase } from '../parts/weapons';
import { fatigues, helmet, hood, limbWraps, mantle, skirt, torsoWrap, visorBand } from '../parts/gear';
import { RIFLE_MOVES, GENERIC } from '../clips/generic';

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
const SKINS = [0xc59a7c, 0xb98a66, 0xa9764e, 0x8a5a3c, 0xd4ad92] as const;

// ---------------------------------------------------------------------------------------------------------
export const tharne: ArchetypeDef = {
  proportions: () => ({ height: 1.8, shoulder: 0.182, hip: 0.095, bulk: 0.95, fem: 0 }),
  build(ctx) {
    const { b, rig, draft } = ctx;
    const pal: Pal = { ...REF_PAL, suit: { color: 0x2a3340, rough: 0.78, part: PART.suit } };
    const skin: Surf = { color: 0xb98a66 };
    buildBody(b, rig, { suit: pal.suit, legs: { color: 0x1c232d, rough: 0.8, part: PART.suit }, skin, glove: pal.leather, boot: pal.leather });
    buildHead(b, rig, { skin, hair: { color: 0x6a6a6c }, style: 'buzz', jaw: 0.98 });
    visorBand(b, rig, pal);
    // light technical rig rather than battle plate
    cuirass(b, rig, pal, { faction: 'ref', heft: 0.012, lames: 1, keel: 0.01 });
    gorget(b, rig, pal, { faction: 'ref', height: 0.04 });
    backpack(b, rig, pal, { faction: 'ref', size: 1.18 });
    pauldron(b, rig, 1, pal, { faction: 'ref', R: 0.078, lames: 0 });
    armArmor(b, rig, -1, pal, { faction: 'ref', heft: 0.2, rerebrace: false, display: true, glowLine: false });
    armArmor(b, rig, 1, pal, { faction: 'ref', heft: 0.1, rerebrace: false, gauntlet: false });
    waist(b, rig, pal, { faction: 'ref', heft: 0.15, tassets: 'none', pouches: [-150, -112, 112, 150, 58], buckle: 'plate', crossBelt: true });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'ref', heft: 0.2, cuisse: false, sabaton: false });
    // tool roll on the chest and a cable from pack to wrist: visible technical connections
    const chest = rig.i('chest');
    const T = torsoSecs(rig);
    b.skin(chest).surf({ ...pal.leather, zone: ZONE.chest });
    onRing(b, secAt(T, 1.3, 0.036), -30, 0.012, () => box(b, 0.085, 0.07, 0.03, { bevel: 0.008 }));
    b.surf({ ...pal.glow, zone: ZONE.chest, glow: 2 });
    onRing(b, secAt(T, 1.32, 0.036), -30, 0.03, () => box(b, 0.04, 0.008, 0.004, { bevel: 0.001, edge: 0 }));
    fatigues(b, rig, { cloth: { color: 0x27303c }, strap: pal.leather, trim: pal.trim });
    draft.items.case = sealedCase(b, rig, pal);
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = GENERIC;
    draft.rim = { color: 0xa9d2ff, amount: 0.24 };
  },
};

// ---------------------------------------------------------------------------------------------------------
export const lyric: ArchetypeDef = {
  proportions: () => ({ height: 1.69, shoulder: 0.166, hip: 0.092, bulk: 0.86, fem: 1 }),
  build(ctx) {
    const { b, rig, draft } = ctx;
    const pal: Pal = { ...REF_PAL, suit: { color: 0x27303c, rough: 0.8, part: PART.suit } };
    const skin: Surf = { color: 0xd0a68a };
    buildBody(b, rig, { suit: pal.suit, legs: { color: 0x1a2028, rough: 0.8, part: PART.suit }, skin, glove: { color: 0x1a1d24 }, boot: pal.leather });
    buildHead(b, rig, { skin, hair: { color: 0x5a3d28 }, style: 'tail', jaw: 0.86, eye: 0x4a3a5a });
    // padded field jacket with a light chest plate, hood down
    torsoWrap(b, rig, 1.49, 1.04, 0.012, { color: 0x34404e, zone: ZONE.chest }, torsoSkin(rig));
    cuirass(b, rig, pal, { faction: 'ref', heft: 0.02, lames: 0, keel: 0.01 });
    gorget(b, rig, pal, { faction: 'ref', height: 0.035 });
    hood(b, rig, { color: 0x34404e }, false);
    pauldron(b, rig, -1, pal, { faction: 'ref', R: 0.07, lames: 0 });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'ref', heft: 0.1, rerebrace: false, gauntlet: false });
    waist(b, rig, pal, { faction: 'ref', heft: 0.1, tassets: 'none', pouches: [140, -140], buckle: 'plate' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'ref', heft: 0.15, cuisse: false, sabaton: false });
    skirt(b, rig, { arc: [30, 330], top: 1.03, bottom: 0.8, flare: 0.12, out: 0.022, surf: { color: 0x34404e, zone: ZONE.leg }, follow: 0.55, rows: 3 });
    fatigues(b, rig, { cloth: { color: 0x2c3642 }, strap: pal.leather, harness: false });
    // wrist monitor: the one honest violet on her, a reading rather than an ornament
    const A = armSecs(rig, -1);
    const wy = rig.p('handL')[1];
    const s0 = secAt(A, wy + 0.07, 0.022);
    b.skin(rig.i('fArmL')).surf({ ...pal.dark, zone: ZONE.arm });
    b.scope(() => { b.translate((s0.cx ?? 0) - s0.rx, s0.y, s0.cz ?? 0); box(b, 0.014, 0.05, 0.04, { bevel: 0.004 }); });
    b.surf({ color: 0x1a0b33, part: PART.glow, emissive: 0x7a3cff, glow: 1.6, zone: ZONE.arm });
    b.scope(() => { b.translate((s0.cx ?? 0) - s0.rx - 0.008, s0.y + 0.008, s0.cz ?? 0); box(b, 0.003, 0.012, 0.022, { bevel: 0.001, edge: 0 }); });
    b.surf({ ...pal.glow, zone: ZONE.arm, glow: 1.8 });
    b.scope(() => { b.translate((s0.cx ?? 0) - s0.rx - 0.008, s0.y - 0.01, s0.cz ?? 0); box(b, 0.003, 0.008, 0.022, { bevel: 0.001, edge: 0 }); });
    draft.items.case = sealedCase(b, rig, pal);
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'case' };
    draft.moveset = GENERIC;
    draft.rim = { color: 0xa9d2ff, amount: 0.26 };
  },
};

// ---------------------------------------------------------------------------------------------------------
function refTrooper(heavy: boolean): ArchetypeDef {
  return {
    proportions: (rng) => heavy
      ? { height: 1.86 + rng() * 0.06, shoulder: 0.2, hip: 0.098, bulk: 1.08, fem: 0 }
      : { height: 1.76 + rng() * 0.1, shoulder: 0.182 + rng() * 0.01, hip: 0.095, bulk: 0.96 + rng() * 0.06, fem: rng() > 0.6 ? 0.8 : 0 },
    build(ctx) {
      const { b, rig, draft, rng } = ctx;
      const pal: Pal = heavy
        ? { ...REF_PAL, plate: { color: 0x1a2740, metal: 0.66, rough: 0.36 }, plate2: { color: 0x2f3a4c, metal: 0.74, rough: 0.42 } }
        : { ...REF_PAL, plate: { color: rng() > 0.5 ? 0x1d2c48 : 0x22314a, metal: 0.62, rough: 0.38 + rng() * 0.06 } };
      buildBody(b, rig, { suit: pal.suit, skin: { color: pick(rng, SKINS) }, glove: pal.leather, boot: pal.leather, noBoots: heavy });
      helmet(b, rig, pal, heavy ? 'marine' : 'refSoldier');
      cuirass(b, rig, pal, { faction: 'ref', heft: heavy ? 0.022 : 0.014, lames: heavy ? 3 : 2, keel: 0.03 });
      gorget(b, rig, pal, { faction: 'ref', height: heavy ? 0.06 : 0.04 });
      for (const s of [-1, 1]) pauldron(b, rig, s, pal, { faction: 'ref', R: heavy ? 0.108 : 0.086, lames: heavy ? 2 : 1 });
      for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'ref', heft: heavy ? 0.7 : 0.3, glowLine: heavy });
      waist(b, rig, pal, { faction: 'ref', heft: heavy ? 0.7 : 0.3, tassets: heavy ? 'front' : 'none', pouches: rng() > 0.5 ? [130, -140] : [150, -120, 60], buckle: 'plate' });
      for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'ref', heft: heavy ? 0.7 : 0.3, sabaton: heavy, glowLine: heavy });
      if (heavy || rng() > 0.4) backpack(b, rig, pal, { faction: 'ref', size: heavy ? 1.05 : 0.85 });
      // unit light on the chest
      const T = torsoSecs(rig);
      b.skin(rig.i('chest')).surf({ ...pal.glow, zone: ZONE.chest, glow: 2 });
      onRing(b, secAt(T, 1.41, heavy ? 0.04 : 0.03), 28, 0.003, () => box(b, 0.03, 0.007, 0.006, { bevel: 0.002, edge: 0 }));
      draft.items.ranged = rifle(b, rig, pal, false);
      draft.loadout = { melee: false, ranged: true, shield: false, prop: 'none' };
      draft.moveset = RIFLE_MOVES;
      draft.rim = { color: 0xa9d2ff, amount: 0.24 };
      draft.girth = heavy ? 1.2 : 1.1;
    },
  };
}
export const reformationSoldier = refTrooper(false);
export const reformationMarine = refTrooper(true);

// ---------------------------------------------------------------------------------------------------------
export const medic: ArchetypeDef = {
  proportions: (rng) => ({ height: 1.7 + rng() * 0.1, shoulder: 0.172, hip: 0.094, bulk: 0.9, fem: rng() > 0.5 ? 0.8 : 0.1 }),
  build(ctx) {
    const { b, rig, draft, rng } = ctx;
    const pal: Pal = {
      ...REF_PAL,
      plate: { color: 0xa9b2bb, metal: 0.5, rough: 0.42 },
      plate2: { color: 0x596573, metal: 0.6, rough: 0.46 },
      suit: { color: 0x2c3541, rough: 0.8, part: PART.suit },
      glow: { color: 0x0a1a1c, rough: 0.4, part: PART.glow, emissive: 0x9ff0e0, glow: 2.6 },
    };
    const skin: Surf = { color: pick(rng, SKINS) };
    buildBody(b, rig, { suit: pal.suit, legs: { color: 0x202731, rough: 0.8, part: PART.suit }, skin, glove: { color: 0xb8c0c6, rough: 0.5 }, boot: pal.leather });
    buildHead(b, rig, { skin, hair: { color: pick(rng, [0x1a120d, 0x3a2a1c, 0x6a5a48] as const) }, style: rng() > 0.5 ? 'tied' : 'crop', jaw: 0.92 });
    helmet(b, rig, pal, 'medic');
    torsoWrap(b, rig, 1.49, 1.04, 0.012, { color: 0x3c4856, zone: ZONE.chest }, torsoSkin(rig));
    cuirass(b, rig, pal, { faction: 'ref', heft: 0.02, lames: 0, keel: 0.01 });
    gorget(b, rig, pal, { faction: 'ref', height: 0.035 });
    backpack(b, rig, pal, { faction: 'ref', size: 1.05 });
    for (const s of [-1, 1]) armArmor(b, rig, s, pal, { faction: 'ref', heft: 0.1, rerebrace: false, gauntlet: false });
    // pale sleeve band: role marking by shape and placement, not heraldry
    const A = armSecs(rig, -1);
    b.skin(rig.i('uArmL'));
    limbWraps(b, A, [rig.p('uArmL')[1] - 0.13], { color: 0xd8dde2, zone: ZONE.arm }, 0.05, 0.01);
    waist(b, rig, pal, { faction: 'ref', heft: 0.15, tassets: 'none', pouches: [-150, -110, 110, 150, 62, -62], buckle: 'plate' });
    fatigues(b, rig, { cloth: { color: 0x36414e }, strap: { color: 0xb8c0c6 }, trim: pal.trim });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'ref', heft: 0.15, cuisse: false, sabaton: false });
    draft.items.case = sealedCase(b, rig, pal);
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = GENERIC;
    draft.rim = { color: 0xa9d2ff, amount: 0.24 };
  },
};

// ---------------------------------------------------------------------------------------------------------
export const sol: ArchetypeDef = {
  proportions: () => ({ height: 1.77, shoulder: 0.172, hip: 0.094, bulk: 0.9, fem: 1 }),
  build(ctx) {
    const { b, rig, draft } = ctx;
    const pal: Pal = { ...REF_PAL, plate: { color: 0x1a2740, metal: 0.66, rough: 0.3 } };
    const coat: Surf = { color: 0x17233a, rough: 0.82, part: PART.cloth };
    const skin: Surf = { color: 0xcfa88e };
    buildBody(b, rig, { suit: { color: 0x141b28, rough: 0.8, part: PART.suit }, skin, glove: { color: 0x10141c }, boot: pal.leather });
    buildHead(b, rig, { skin, hair: { color: 0xc9c2b4 }, style: 'bob', jaw: 0.88, eye: 0x5a7a9a });
    // long greatcoat: fitted body, high collar, skirt to the calf, open at the front
    torsoWrap(b, rig, 1.5, 1.02, 0.014, { ...coat, zone: ZONE.chest }, torsoSkin(rig));
    skirt(b, rig, { arc: [12, 348], top: 1.04, bottom: 0.34, flare: 0.3, out: 0.03, surf: { ...coat, zone: ZONE.leg }, trim: { color: 0x8e99a6, rough: 0.4, metal: 0.6 }, follow: 0.6, rows: 6 });
    gorget(b, rig, pal, { faction: 'ref', height: 0.075 });
    mantle(b, rig, coat, { color: 0x8e99a6, rough: 0.4, metal: 0.6 }, 0.1, 0.03);
    for (const s of [-1, 1]) pauldron(b, rig, s, pal, { faction: 'ref', R: 0.072, lames: 0 });
    waist(b, rig, pal, { faction: 'ref', heft: 0.1, tassets: 'none', buckle: 'plate' });
    for (const s of [-1, 1]) legArmor(b, rig, s, pal, { faction: 'ref', heft: 0.1, cuisse: false, sabaton: false });
    // double row of fastenings + a single cold rank line
    const T = torsoSecs(rig);
    b.skin(rig.i('chest')).surf({ ...pal.trim, zone: ZONE.chest });
    for (const y of [1.4, 1.33, 1.26]) for (const a of [-14, 14]) onRing(b, secAt(T, y, 0.024), a, 0.002, () => box(b, 0.014, 0.014, 0.008, { bevel: 0.004 }));
    b.surf({ ...pal.glow, zone: ZONE.chest, glow: 2 });
    onRing(b, secAt(T, 1.42, 0.026), 32, 0.002, () => box(b, 0.04, 0.005, 0.006, { bevel: 0.0015, edge: 0 }));
    draft.items.ranged = axiom(b, rig, pal);
    holster(b, rig, pal, 1);
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = GENERIC;
    draft.rim = { color: 0xa9d2ff, amount: 0.26 };
    draft.girth = 1.1;
  },
};
