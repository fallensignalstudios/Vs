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
}

/**
 * Bare heads for helmeted soldiers (CharacterCreateOpts.bareHead). The generated civilian gives the head; the
 * looks re-tint and re-proportion it so two named soldiers and the civilians never share one face.
 */
export const BARE_HEAD_VARO: BareHeadLook = { donor: 'survivor', skin: [0.86, 0.74, 0.64], hair: [0.03, 0.026, 0.024, 1], shape: [1.07, 1.01, 1.04] };
/** default bare head (the Z08 officer and any other `bareHead: true` soldier): older, paler, greying */
export const BARE_HEAD_OFFICER: BareHeadLook = { donor: 'survivor', skin: [1.02, 0.94, 0.9], hair: [0.3, 0.29, 0.28, 1], shape: [0.97, 1.05, 1.0] };

const HERO = { albedoCap: 0.62, env: 0.85, vary: false } as const;
const TROOP = { albedoCap: 0.62, env: 0.8, vary: true } as const;

/** Archetype → generated model. Archetypes missing here (kingWitness) always use the procedural figure. */
export const GLB_ARCHETYPES: Partial<Record<HumanoidArchetype, GlbArchetype>> = {
  tarrik: { ...HERO, model: 'tarrik', props: { melee: 'velkorran', ranged: 'cinderline', case: 'sealed_case' }, mask: MASK_DOMINION },
  selene: { ...HERO, model: 'selene', props: { melee: 'verity', ranged: 'axiom', case: 'sealed_case' }, mask: MASK_REFORMATION, albedoCap: 0.42 },
  lyessa: { ...HERO, model: 'lyessa', props: { ranged: 'rifle_dominion', case: 'sealed_case' }, mask: { ...MASK_DOMINION, sat: 0.5, val: 0.8, gain: 2.0 } },
  tharne: { ...HERO, model: 'tharne', props: { case: 'sealed_case' }, mask: { ...MASK_REFORMATION, gain: 1.8 }, albedoCap: 0.5 },
  lyric: { ...HERO, model: 'lyric', props: { case: 'sealed_case' }, mask: { ...MASK_DOMINION, gain: 1.8 }, albedoCap: 0.4 },
  enforcer: { ...TROOP, model: 'enforcer', props: { shield: 'tower_shield', ranged: 'cinderline' }, mask: MASK_DOMINION },
  linkbound: { ...TROOP, model: 'linkbound', props: {}, mask: MASK_ECLIPSE },
  dominionSoldier: { ...TROOP, model: 'soldier_dominion', props: { ranged: 'rifle_dominion' }, mask: MASK_DOMINION },
  malik: { ...TROOP, vary: false, model: 'soldier_dominion', props: { case: 'sealed_case' }, mask: { ...MASK_DOMINION, gain: 1.2 }, tint: [0.86, 0.8, 0.78], bareHead: BARE_HEAD_VARO },
  cross: { ...TROOP, vary: false, model: 'soldier_dominion', props: { ranged: 'cinderline' }, mask: MASK_DOMINION, tint: [1.08, 0.94, 0.86] },
  reformationSoldier: { ...TROOP, model: 'soldier_reformation', props: {}, mask: MASK_REFORMATION },
  reformationMarine: { ...TROOP, model: 'soldier_reformation', props: {}, mask: MASK_REFORMATION, tint: [0.84, 0.88, 0.96] },
  sol: { ...TROOP, vary: false, model: 'soldier_reformation', props: { ranged: 'axiom' }, mask: MASK_REFORMATION, tint: [1.06, 1.06, 1.1] },
  survivor: { ...TROOP, model: 'survivor', props: {}, mask: MASK_NONE },
  medic: { ...TROOP, model: 'survivor', props: { case: 'sealed_case' }, mask: MASK_NONE, tint: [1.22, 1.24, 1.22], extra: 'satchel' },
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
