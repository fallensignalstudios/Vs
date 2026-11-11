/**
 * Generated-mesh characters — static configuration: the manifest shape (public/models/manifest.json), which
 * model and props each humanoid archetype uses, and the per-faction "painted light" masks that turn base-colour
 * lamps into emissive (the files carry no emissive maps).
 *
 * Nothing here is measured from a particular mesh: offsets, grips and proportions are derived at load time from
 * the bones, the skin weights and the manifest (see analyze.ts), so a model file can be replaced without edits.
 */
import type { HumanoidArchetype } from '@/core/api';
import type { BareHeadLook } from './head';

/** One entry of public/models/manifest.json (only the fields the engine reads). */
export interface ManifestEntry {
  file: string;
  kind: 'humanoid' | 'prop' | (string & {});
  /** humanoids: standing height in metres */
  height?: number;
  tris?: number;
  rigged?: boolean;
  /** '+Z' (default) or '-Z': which way the figure faces in its own file */
  facing?: string;
  skeleton?: string;
  /** props: raw size of the file's contents [x, y, z] */
  bbox?: number[];
  longAxis?: 'x' | 'y' | 'z';
  /** props: 'center' = held in the middle (ring hilt, case handle), 'max' = handle at the +axis end */
  handleAt?: string;
  /** props: metres the long axis is scaled to */
  targetLength?: number;
  front?: string;
  up?: string;
  /** props, raw units: where the hand holds it / barrel end / support-hand point */
  grip?: number[];
  muzzle?: number[];
  foregrip?: number[];
  /**
   * Baked levels of detail of the main mesh (index buffers into its own vertices, see lod.ts): `file` next to
   * the model, `tris` per level (level 1 first; informational).
   */
  lod?: { file: string; tris?: number[] };
}
export type Manifest = Record<string, ManifestEntry>;

export type ItemSlot = 'melee' | 'ranged' | 'shield' | 'case';
export const ITEM_SLOTS: readonly ItemSlot[] = ['melee', 'ranged', 'shield', 'case'];

/**
 * Painted-light mask: texels whose base colour has this hue (0..1, ± `width`), at least `sat` saturation and
 * `val` brightness (display-referred) are added to emissive, multiplied by `gain` and CharacterVisual.setGlow().
 */
export interface GlowMask { hue: number; width: number; sat: number; val: number; gain: number }

/** amber / ember slits and seams on bronze — bronze itself is duller and less saturated than its lamps */
export const MASK_DOMINION: GlowMask = { hue: 0.105, width: 0.06, sat: 0.62, val: 0.74, gain: 2.6 };
/** cyan and cold blue-white strips — bright steel and ivory have no saturation and stay out */
export const MASK_REFORMATION: GlowMask = { hue: 0.535, width: 0.075, sat: 0.42, val: 0.6, gain: 2.4 };
/** violet veins in Eclipse tissue */
export const MASK_ECLIPSE: GlowMask = { hue: 0.76, width: 0.07, sat: 0.4, val: 0.42, gain: 2.2 };
export const MASK_NONE: GlowMask = { hue: 0, width: 0.01, sat: 2, val: 2, gain: 0 };

export interface GlbArchetype {
  /** manifest key of the body */
  model: string;
  /** manifest keys of the generated props per equipment slot (a slot without one keeps the procedural item) */
  props: Partial<Record<ItemSlot, string>>;
  mask: GlowMask;
  /** soft ceiling on base-colour luminance (linear) outside the mask: keeps pale plate from blooming white */
  albedoCap: number;
  /** scene.environment contribution (generated skins are glossier than hand-authored ones) */
  env: number;
  /** rank-and-file: `opts.seed` varies height and tint */
  vary: boolean;
  /** constant albedo tint (linear multipliers) */
  tint?: readonly [number, number, number];
  /** small procedural additions that belong to the archetype, not the mesh */
  extra?: 'satchel';
  /** always drawn bare-headed: the helmet is cut and this head grafted on (see head.ts) */
  bareHead?: BareHeadLook;
  /** the body shows its own face (a hero-tier head): CharacterCreateOpts.bareHead never grafts another one on */
  ownFace?: boolean;
  /** a figure in a remembered scene (Witness V): self-light and a warm edge light over the textures — see WitnessLook */
  witness?: WitnessLook;
  /** the King's five-point halo is held behind the head (CharacterCreateOpts.halo, default true) */
  halo?: boolean;
  /** POLISH 4: how the face is shaded (skin, greying, a dressing, hair strands) — see FaceLook */
  face?: FaceLook;
}

/**
 * POLISH 4. The face of a body that shows one (material.ts, on the head only). Every field is an amount 0..1.
 */
export interface FaceLook {
  /** skin shading: light wrapping round the terminator, an oilier T-zone and wet lips, mottling, pores */
  skin?: number;
  /** grey strands at the temples */
  greyTemples?: number;
  /** salt-and-pepper through the beard */
  greyBeard?: number;
  /** strands and locks drawn over a sculpted grey hair mass */
  strands?: number;
  /** the pale strip on the left cheek drawn as a gauze dressing */
  bandage?: number;
  /** irises that meshed grey drawn brown */
  brownEyes?: number;
}
const SKIN: FaceLook = { skin: 1 };

/**
 * How a Witness V figure glows on a generated body — the procedural Witness's light without its translucency (the
 * figures are real people now; they stay solid so nothing sorts wrongly through a robe or a coat).
 */
export interface WitnessLook {
  /** albedo self-illumination (the procedural Witness has 0.26) */
  luminous: number;
  /** the edge light: white at the head, warming to gold toward the hem, strongest at grazing angles */
  edge: number;
}

/**
 * POLISH 4: Varo's engraving — the crowned-flame grooves are painted molten amber (hue ≈ 0.08, saturated, bright) in
 * the base colour; measured on varo.glb, this lights the grooves (about 1.2 % of the atlas) and leaves the bronze,
 * the crimson quilting and the face out. (MASK_DOMINION's 0.105 hue and 0.74 brightness caught 0.2 %.)
 */
export const MASK_VARO: GlowMask = { hue: 0.082, width: 0.045, sat: 0.6, val: 0.5, gain: 1.7 };

/** amber-gold inlay and leaf engraving on ivory plate (the King): saturated gold only — the ivory stays out */
export const MASK_GOLD: GlowMask = { hue: 0.11, width: 0.05, sat: 0.55, val: 0.62, gain: 1.1 };

/**
 * Bare heads for helmeted soldiers (CharacterCreateOpts.bareHead). The generated civilian gives the head; the
 * looks re-tint and re-proportion it so two named soldiers and the civilians never share one face.
 * (Integration: Varo and the Z08 officer now have their own bodies; BARE_HEAD_VARO is kept for tooling only.)
 */
export const BARE_HEAD_VARO: BareHeadLook = { donor: 'survivor', skin: [0.86, 0.74, 0.64], hair: [0.03, 0.026, 0.024, 1], shape: [1.07, 1.01, 1.04] };
/** default bare head (the Z08 officer and any other `bareHead: true` soldier): older, paler, greying */
export const BARE_HEAD_OFFICER: BareHeadLook = { donor: 'survivor', skin: [1.02, 0.94, 0.9], hair: [0.17, 0.165, 0.16, 1], shape: [0.97, 1.05, 1.0] };

const HERO = { albedoCap: 0.62, env: 0.85, vary: false } as const;
const TROOP = { albedoCap: 0.62, env: 0.8, vary: true } as const;

/**
 * Archetype → generated model (every humanoid archetype has one). Integration: Malik Varo (`malik` injured, `varo`
 * armed), the Z08 `officer`, the King (`kingWitness`) and `vesryn` have their own hero-tier bodies with real faces.
 */
export const GLB_ARCHETYPES: Partial<Record<HumanoidArchetype, GlbArchetype>> = {
  tarrik: { ...HERO, model: 'tarrik', props: { melee: 'velkorran', ranged: 'cinderline', case: 'sealed_case' }, mask: MASK_DOMINION, face: SKIN },
  selene: { ...HERO, model: 'selene', props: { melee: 'verity', ranged: 'axiom', case: 'sealed_case' }, mask: MASK_REFORMATION, albedoCap: 0.42, face: SKIN },
  lyessa: { ...HERO, model: 'lyessa', props: { ranged: 'rifle_dominion', case: 'sealed_case' }, mask: { ...MASK_DOMINION, sat: 0.5, val: 0.8, gain: 2.0 }, face: SKIN },
  tharne: { ...HERO, model: 'tharne', props: { case: 'sealed_case' }, mask: { ...MASK_REFORMATION, gain: 1.8 }, albedoCap: 0.5, face: SKIN },
  lyric: { ...HERO, model: 'lyric', props: { case: 'sealed_case' }, mask: { ...MASK_DOMINION, gain: 1.8 }, albedoCap: 0.4, face: SKIN },
  enforcer: { ...TROOP, model: 'enforcer', props: { shield: 'tower_shield', ranged: 'cinderline' }, mask: MASK_DOMINION },
  linkbound: { ...TROOP, model: 'linkbound', props: {}, mask: MASK_ECLIPSE },
  dominionSoldier: { ...TROOP, model: 'soldier_dominion', props: { ranged: 'rifle_dominion' }, mask: MASK_DOMINION },
  // Malik Varo: the generated hero body (bare head, crowned-flame engraving whose amber grooves the mask lights)
  // (polish 4: the grooves glow through MASK_VARO — softer on the injured man)
  malik: { ...HERO, model: 'varo', props: { case: 'sealed_case' }, mask: { ...MASK_VARO, gain: 1.3 }, ownFace: true, face: SKIN },
  varo: { ...HERO, model: 'varo', props: { ranged: 'rifle_dominion', case: 'sealed_case' }, mask: MASK_VARO, ownFace: true, face: SKIN },
  // the officer: black-bronze plate with thin amber trim; his infection is the shader's corruption tint, not the file
  officer: { ...HERO, model: 'officer', props: {}, mask: { ...MASK_DOMINION, gain: 1.4 }, ownFace: true, albedoCap: 0.5, face: { skin: 1, greyTemples: 0.6 } },
  // Witness V: the King in ivory and gold (the plate scaled to 0.85, as the forge report asks for bright rooms), and
  // his chronicler in a charcoal coat — both lit from within, the King more than Vesryn
  // (polish 4: the concept's grey temples and salt-and-pepper beard, and his brown eyes — the mesh came out dark and grey-eyed)
  kingWitness: { ...HERO, model: 'king', props: {}, mask: MASK_GOLD, ownFace: true, albedoCap: 0.55, env: 0.7, tint: [0.85, 0.85, 0.85], witness: { luminous: 0.07, edge: 0.45 }, halo: true, face: { skin: 1, greyTemples: 0.9, greyBeard: 0.6, brownEyes: 0.85 } },
  // (polish 4: loose strands over the sculpted grey hair, and the cheek's white stroke drawn as a gauze dressing)
  vesryn: { ...HERO, model: 'vesryn', props: {}, mask: MASK_NONE, ownFace: true, albedoCap: 0.5, env: 0.7, witness: { luminous: 0.05, edge: 0.28 }, face: { skin: 1, strands: 1, bandage: 1 } },
  cross: { ...TROOP, vary: false, model: 'soldier_dominion', props: { ranged: 'cinderline' }, mask: MASK_DOMINION, tint: [1.08, 0.94, 0.86] },
  reformationSoldier: { ...TROOP, model: 'soldier_reformation', props: {}, mask: MASK_REFORMATION },
  reformationMarine: { ...TROOP, model: 'soldier_reformation', props: {}, mask: MASK_REFORMATION, tint: [0.84, 0.88, 0.96] },
  sol: { ...TROOP, vary: false, model: 'soldier_reformation', props: { ranged: 'axiom' }, mask: MASK_REFORMATION, tint: [1.06, 1.06, 1.1] },
  survivor: { ...TROOP, model: 'survivor', props: {}, mask: MASK_NONE, face: SKIN },
  medic: { ...TROOP, model: 'survivor', props: { case: 'sealed_case' }, mask: MASK_NONE, tint: [1.22, 1.24, 1.22], extra: 'satchel', face: SKIN },
};

/** Per-prop painted-light masks (weapon edge glow). */
export const PROP_MASKS: Record<string, GlowMask> = {
  velkorran: { hue: 0.075, width: 0.075, sat: 0.55, val: 0.6, gain: 3.2 },
  cinderline: { hue: 0.085, width: 0.07, sat: 0.55, val: 0.62, gain: 2.6 },
  rifle_dominion: { hue: 0.095, width: 0.07, sat: 0.55, val: 0.65, gain: 1.3 },
  tower_shield: { hue: 0.1, width: 0.065, sat: 0.6, val: 0.7, gain: 2.4 },
  verity: { hue: 0.57, width: 0.1, sat: 0.3, val: 0.6, gain: 2.6 },
  axiom: { hue: 0.56, width: 0.09, sat: 0.38, val: 0.6, gain: 2.4 },
  sealed_case: { hue: 0.56, width: 0.09, sat: 0.38, val: 0.6, gain: 2.2 },
};

/** The bare head an archetype is drawn with: its own, the default when `bareHead` is asked for, or none. */
export function bareHeadFor(cfg: GlbArchetype, wanted?: boolean): BareHeadLook | null {
  if (cfg.bareHead) return cfg.bareHead;
  if (cfg.ownFace) return null;
  return wanted && cfg.model !== BARE_HEAD_OFFICER.donor ? BARE_HEAD_OFFICER : null;
}

/** Models (body + props, and the donor of a bare head) an archetype needs; [] for archetypes without a generated body. */
export function modelsFor(archetype: string, bareHead?: boolean): string[] {
  const cfg = GLB_ARCHETYPES[archetype as HumanoidArchetype];
  if (!cfg) return [];
  const out = [cfg.model];
  for (const slot of ITEM_SLOTS) { const p = cfg.props[slot]; if (p && !out.includes(p)) out.push(p); }
  const head = bareHeadFor(cfg, bareHead);
  if (head && !out.includes(head.donor)) out.push(head.donor);
  return out;
}
