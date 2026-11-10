/** Survivors, the Linkbound, and the King-era Witness. */
import type { ArchetypeDef } from '../figure';
import { PART, ZONE, type Surf } from '../geo/builder';
import { ball, box, loft, torus, tube, type Sec, type V3 } from '../geo/prims';
import { armSecs, buildBody, buildHand, legSecs, secAt, torsoSecs, torsoSkin, armSkin } from '../parts/body';
import { buildHead, skullSecs } from '../parts/head';
import { DOM_PAL, REF_PAL, cuirass, gorget, pauldron, strap, wrap, type Pal } from '../parts/armor';
import { armArmor, legArmor, waist } from '../parts/armor-limbs';
import { helmet, hood, mantle, skirt, tissueCord, torsoWrap } from '../parts/gear';
import { GENERIC } from '../clips/generic';
import { LINKBOUND_MOVES } from '../clips/linkbound';
import { WITNESS_MOVES } from '../clips/witness';

const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// ---------------------------------------------------------------------------------------------------------
const TUNICS = [0x4a4238, 0x3d4450, 0x55483a, 0x3a3f36, 0x4c3a3a, 0x424a55] as const;
const TROUSERS = [0x2a2622, 0x23272e, 0x302a24, 0x1f2226] as const;
const HAIR = [0x1a120d, 0x3a2a1c, 0x6a5a48, 0x8c8a86, 0x2a1c12, 0x0f0d0c] as const;
const SKIN = [0xc59a7c, 0xb98a66, 0xa9764e, 0x8a5a3c, 0xd4ad92, 0x6e4630] as const;
const STYLES = ['crop', 'tied', 'bob', 'buzz', 'bun', 'tail'] as const;

export const survivor: ArchetypeDef = {
  proportions: (rng) => {
    const fem = rng() > 0.5 ? 0.9 : 0;
    return { height: (fem ? 1.6 : 1.68) + rng() * 0.16, shoulder: (fem ? 0.164 : 0.178) + rng() * 0.012, hip: 0.094, bulk: 0.86 + rng() * 0.16, fem };
  },
  build(ctx) {
    const { b, rig, draft, rng } = ctx;
    const tunic: Surf = { color: pick(rng, TUNICS), rough: 0.9, part: PART.cloth };
    const skin: Surf = { color: pick(rng, SKIN) };
    const hoodUp = rng() > 0.55;
    buildBody(b, rig, { suit: { ...tunic, color: dust(tunic.color, 0.85) }, legs: { color: pick(rng, TROUSERS), rough: 0.9, part: PART.cloth }, skin, boot: { color: 0x241c16, rough: 0.8 }, bareArms: rng() > 0.6 });
    buildHead(b, rig, { skin, hair: { color: pick(rng, HAIR) }, style: hoodUp ? 'buzz' : pick(rng, STYLES), beard: rig.prop.fem < 0.5 && rng() > 0.6, jaw: rig.prop.fem > 0.5 ? 0.88 : 1 });
    // layered, dusty, improvised: tunic, long over-shirt, wrap or blanket, satchel
    torsoWrap(b, rig, 1.49, 1.0, 0.012, { ...tunic, zone: ZONE.chest }, torsoSkin(rig));
    skirt(b, rig, { arc: [8, 352], top: 1.03, bottom: 0.7 - rng() * 0.12, flare: 0.14, out: 0.022, surf: { ...tunic, zone: ZONE.leg }, follow: 0.6, rows: 4 });
    const wrapCol = dust(pick(rng, TUNICS), 0.9);
    mantle(b, rig, { color: wrapCol, rough: 0.95 }, undefined, 0.14 + rng() * 0.1, 0.035);
    hood(b, rig, { color: wrapCol, rough: 0.95 }, hoodUp);
    const T = torsoSecs(rig);
    const hips = rig.i('hips');
    // rope belt + satchel
    b.skin(hips).surf({ color: 0x5a4a36, rough: 0.9, part: PART.cloth, zone: ZONE.body });
    wrap(b, T, 1.045, 1.015, { rows: 1, seg: 20, thick: 0.008, inflate: 0.03 });
    if (rng() > 0.4) {
      const side = rng() > 0.5 ? 1 : -1;
      b.surf({ color: 0x3a2e22, rough: 0.85, part: PART.leather, zone: ZONE.body });
      const ring = secAt(T, 0.98, 0.05);
      b.scope(() => { b.translate(side * (ring.rx + 0.02), 0.93, 0.02); box(b, 0.07, 0.15, 0.19, { bevel: 0.02 }); });
      strap(b, [[side * (ring.rx + 0.02), 1.0, 0.02], [side * 0.1, 1.3, -0.12], [-side * 0.08, 1.47, -0.07], [-side * 0.1, 1.47, 0.09], [side * 0.06, 1.25, 0.14], [side * (ring.rx + 0.02), 1.0, 0.06]] as V3[], 0.014, { color: 0x3a2e22, rough: 0.85, part: PART.leather, zone: ZONE.chest }, rig.i('chest'));
    }
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = GENERIC;
    draft.rim = { color: 0xc9d4e6, amount: 0.2 };
    draft.breath = 1.2;
    void armSecs; void legSecs; void armSkin; void buildHand; void ball; void tube;
  },
};

function dust(hex: number, k: number): number {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, bl = hex & 255;
  const m = (r + g + bl) / 3;
  const f = (c: number): number => Math.round(Math.min(255, (c * k + m * (1 - k)) * 1.04 + 6));
  return (f(r) << 16) | (f(g) << 8) | f(bl);
}

// ---------------------------------------------------------------------------------------------------------
export const linkbound: ArchetypeDef = {
  proportions: (rng) => ({ height: 1.74 + rng() * 0.1, shoulder: 0.186, hip: 0.096, bulk: 0.98 + rng() * 0.06, fem: 0 }),
  build(ctx) {
    const { b, rig, draft, rng } = ctx;
    // one side keeps Dominion plate, the other Reformation: appropriated, never issued
    const domSide = rng() > 0.5 ? 1 : -1;
    const dom: Pal = { ...DOM_PAL, plate: { color: 0x3c2f28, metal: 0.8, rough: 0.6 }, trim: { color: 0x66543a, metal: 0.9, rough: 0.5 } };
    const ref: Pal = { ...REF_PAL, plate: { color: 0x1a2436, metal: 0.6, rough: 0.5 }, trim: { color: 0x6f7985, metal: 0.9, rough: 0.45 }, glow: { color: 0x120a1c, rough: 0.4, part: PART.glow, emissive: 0x7a3cff, glow: 2.2 } };
    const tissue: Surf = { color: 0x16101e, rough: 0.5, metal: 0.15, part: PART.suit };
    const skin: Surf = { color: 0x5a5560, rough: 0.6 };
    buildBody(b, rig, { suit: tissue, skin, glove: { color: 0x120c1a, rough: 0.45 }, boot: { color: 0x15121a, rough: 0.6 } });
    // head: half a cracked helmet, the rest dark tissue with lit eyes
    buildHead(b, rig, { skin: { color: 0x3a3442, rough: 0.6 }, hair: { color: 0x0c0a10 }, style: 'bald', jaw: 0.94, eyeGlow: { color: 0x9a5cff, glow: 6 } });
    const skull = skullSecs(1);
    const hp = rig.p('head');
    b.scope(() => {
      b.translate(hp[0], hp[1], hp[2]);
      b.skin(rig.i('head')).surf({ ...(domSide > 0 ? ref.plate : dom.plate), zone: ZONE.head });
      // helmet shell covering one side and the crown
      const a0 = domSide > 0 ? -150 : 20, a1 = domSide > 0 ? -20 : 150;
      loft(b, [0.02, 0.07, 0.12, 0.17, 0.205].map((y): Sec => ({ ...secAt(skull, y, 0.02), a0: a0 - (y > 0.15 ? 40 : 0), a1: a1 + (y > 0.15 ? 40 : 0) })), { seg: 14, thick: 0.012, smooth: 2, bevel: 0.004 });
    });
    cuirass(b, rig, domSide > 0 ? ref : dom, { faction: domSide > 0 ? 'ref' : 'dom', heft: 0.018, lames: 2, keel: 0.02 });
    gorget(b, rig, domSide > 0 ? dom : ref, { faction: domSide > 0 ? 'dom' : 'ref', height: 0.045 });
    pauldron(b, rig, domSide, dom, { faction: 'dom', R: 0.112, lames: 2, ridge: true });
    if (rng() > 0.35) pauldron(b, rig, -domSide, ref, { faction: 'ref', R: 0.08, lames: 1 });
    armArmor(b, rig, domSide, dom, { faction: 'dom', heft: 0.6, gauntlet: false });
    armArmor(b, rig, -domSide, ref, { faction: 'ref', heft: 0.3, rerebrace: false, gauntlet: false });
    waist(b, rig, dom, { faction: 'dom', heft: 0.4, tassets: 'none', pouches: [], buckle: 'none' });
    legArmor(b, rig, -domSide, dom, { faction: 'dom', heft: 0.5, sabaton: false });
    legArmor(b, rig, domSide, ref, { faction: 'ref', heft: 0.3, sabaton: false, cuisse: rng() > 0.5 });
    // growth: cords run from the spine over the shoulder and down the stripped arm, into the hip
    const sw = rig.prop.shoulder, s = -domSide;
    b.skin(rig.i('chest'));
    tissueCord(b, [[0.02, 1.2, 0.14], [s * 0.07, 1.36, 0.15], [s * (sw - 0.03), 1.49, 0.07], [s * (sw + 0.02), 1.5, -0.03], [s * (sw - 0.02), 1.4, -0.12]] as V3[], 0.016);
    tissueCord(b, [[-0.03, 1.18, 0.14], [-s * 0.06, 1.3, 0.155], [-s * 0.03, 1.45, 0.13], [0, 1.53, 0.08]] as V3[], 0.013);
    b.skin(rig.i('hips'));
    tissueCord(b, [[s * 0.05, 1.12, 0.13], [s * 0.14, 1.04, 0.1], [s * 0.19, 0.98, 0.02], [s * 0.17, 0.92, -0.07]] as V3[], 0.014);
    b.skin(rig.si('uArm', s));
    const ua = rig.sp('uArm', s), fa = rig.sp('fArm', s);
    tissueCord(b, [[ua[0] + s * 0.05, ua[1] - 0.04, 0.03], [ua[0] + s * 0.065, ua[1] - 0.14, -0.02], [fa[0] + s * 0.05, fa[1] + 0.05, 0.03]] as V3[], 0.012);
    // claws: lit fingertips
    for (const side of [-1, 1]) {
      const kb = rig.sp('fingB', side);
      b.skin(rig.si('fingB', side)).surf({ color: 0x1a0b33, rough: 0.3, part: PART.glow, emissive: 0x8a4cff, glow: 3, zone: ZONE.arm });
      for (const dz of [-0.031, -0.0105, 0.0095, 0.028]) b.scope(() => { b.translate(kb[0], kb[1] - 0.05, kb[2] + dz); loft(b, [{ y: 0.012, rx: 0.008, rz: 0.008 }, { y: -0.03, rx: 0.002, rz: 0.002 }], { seg: 5, capB: 'flat' }); });
    }
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = LINKBOUND_MOVES;
    draft.corruption = 0.38;
    draft.headBias = [10, 0, domSide * 22];
    draft.rim = { color: 0xb58cff, amount: 0.3 };
    draft.breath = 1.6;
    void helmet; void torus;
  },
};

// ---------------------------------------------------------------------------------------------------------
export const kingWitness: ArchetypeDef = {
  proportions: () => ({ height: 2.08, shoulder: 0.186, hip: 0.094, bulk: 0.94, fem: 0.3 }),
  build(ctx) {
    const { b, rig, draft } = ctx;
    const light: Surf = { color: 0xe6dcc4, rough: 0.5, metal: 0.1, part: PART.robe };
    const gold: Surf = { color: 0xc9a45c, rough: 0.35, metal: 0.8, part: PART.robe };
    const core: Surf = { color: 0xfff0cf, rough: 0.4, part: PART.glow, emissive: 0xffe2a8, glow: 3.4 };
    buildBody(b, rig, { suit: light, skin: light, glove: light, boot: light });
    // featureless head: a calm ovoid, no face
    const hp = rig.p('head');
    b.scope(() => {
      b.translate(hp[0], hp[1], hp[2]);
      b.skin(rig.i('head')).surf({ ...light, zone: ZONE.head });
      loft(b, skullSecs(0.92).map((s) => ({ ...s, n: 2 })), { seg: 22, smooth: 4, capB: { dome: 0.014, k: 2 } });
      // five-point crown: not worn, held in the air behind the head
      b.surf({ ...core, zone: ZONE.head });
      b.scope(() => { b.at(0, 0.13, 0.11, 90, 0, 0); torus(b, 0.17, 0.004, { seg: 32, tubeSeg: 4 }); });
      for (let i = 0; i < 5; i++) {
        const a = ((-60 + i * 30) * Math.PI) / 180;
        const len = 0.11 + (i === 2 ? 0.06 : i === 1 || i === 3 ? 0.025 : 0);
        b.scope(() => {
          b.at(Math.sin(a) * 0.19, 0.13 + Math.cos(a) * 0.19, 0.11, 0, 0, (-a * 180) / Math.PI);
          loft(b, [{ y: -0.02, rx: 0.002, rz: 0.002 }, { y: 0.012, rx: 0.013, rz: 0.006 }, { y: len, rx: 0.002, rz: 0.002 }], { seg: 6, capA: 'flat', capB: 'flat' });
        });
      }
    });
    // robes: long closed gown, wide sleeves, a stole with gold edging
    torsoWrap(b, rig, 1.5, 1.0, 0.016, { ...light, zone: ZONE.chest }, torsoSkin(rig));
    skirt(b, rig, { top: 1.05, bottom: 0.03, flare: 0.5, out: 0.03, surf: { ...light, zone: ZONE.leg }, trim: gold, follow: 0.5, rows: 7, thick: 0.01 });
    mantle(b, rig, light, gold, 0.2, 0.04);
    for (const side of [-1, 1]) {
      const A = armSecs(rig, side);
      const ey = rig.sp('fArm', side)[1], wy = rig.sp('hand', side)[1];
      b.skin(armSkin(rig, side)).surf({ ...light, zone: ZONE.arm });
      wrap(b, A, ey + 0.2, wy + 0.01, { rows: 5, seg: 12, thick: 0.008, inner: true, inflate: (t) => 0.012 + 0.07 * t * t, trim: { w: 0.014, raise: 0.001, slot: 1, v0: false }, slots: [undefined, { ...gold, zone: ZONE.arm }] });
    }
    // a single seam of light down the front: information, not ornament
    const T = torsoSecs(rig);
    b.skin(rig.i('chest')).surf({ ...core, zone: ZONE.chest, glow: 2.6 });
    tube(b, [[0, 1.46, -(secAt(T, 1.46, 0.03).rz)], [0, 1.34, -(secAt(T, 1.34, 0.036).rz)], [0, 1.2, -(secAt(T, 1.2, 0.03).rz)]] as V3[], 0.004, { seg: 4 });
    draft.loadout = { melee: false, ranged: false, shield: false, prop: 'none' };
    draft.moveset = WITNESS_MOVES;
    draft.ghost = true;
    draft.luminous = 0.55;
    draft.rim = { color: 0xffe2a8, amount: 0.6 };
    draft.breath = 0.4;
    void ball; void cuirass; void gorget; void pauldron; void armArmor; void legArmor; void waist; void helmet; void buildHead; void buildHand;
  },
};
