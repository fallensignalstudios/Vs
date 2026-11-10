/**
 * The material table: every MatId → base class, PBR properties, texture family, triplanar parameters and
 * effect patches. Art direction lives here (BRIEF §4): King-era substrate, Dominion, Reformation, frozen
 * atmosphere, Eclipse overlay, misc.
 */
import * as THREE from 'three';
import { PALETTE as P, type MatId } from '@/core/api/materials';
import type { FamilyId } from './families';
import type { TriplanarParams } from './triplanar';
import type { GlowMode, GlowParams, IceParams } from './effects';
import type { BarrierParams, HologramParams, ShieldParams } from './effectsUnlit';

export type EffectSpec =
  | { kind: 'glow'; mode: GlowMode; params?: GlowParams }
  | { kind: 'ice'; params?: IceParams }
  | { kind: 'sparkle'; intensity: number; density: number; color: number }
  | { kind: 'glass'; rim?: number }
  | { kind: 'translucency'; color: number; strength: number }
  | { kind: 'hologram'; params?: HologramParams }
  | { kind: 'shield'; params?: ShieldParams }
  | { kind: 'barrier'; params?: BarrierParams };

export interface MatDef {
  /** three.js base: standard / physical are lit PBR; basic hosts the unlit effect materials */
  base: 'standard' | 'physical' | 'basic';
  /** passed to `material.setValues` */
  props: Record<string, unknown>;
  family?: FamilyId;
  tp?: TriplanarParams;
  /** default mapping space: object-space for things that are worn or carried */
  local?: boolean;
  effects?: EffectSpec[];
}

const GOLD_LEAF = 0xd9ad5a;
const BARE_STEEL = 0xaab3be;

/** Shared look of the upper-terminal ceramic. */
const CERAMIC_TP: TriplanarParams = {
  scale: 4,
  normal: 1,
  roughAmp: 0.34,
  macro: { albedo: 0.1, rough: 0.07, scale: 23, hue: 0.4 },
  detail: { scale: 0.31, normal: 0.1, rough: 0.09, albedo: 0.03 },
};

const emissiveStrip = (base: number, emissive: number, intensity: number, mode: GlowMode, params: GlowParams): MatDef => ({
  base: 'standard',
  props: { color: base, roughness: 0.4, metalness: 0.6, emissive, emissiveIntensity: intensity },
  effects: [{ kind: 'glow', mode, params }],
});

export const MAT_DEFS: Record<MatId, MatDef> = {
  // ------------------------------------------------------------------ King-era substrate — upper
  whiteGold: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.42, metalness: 0.3 },
    family: 'ceramic',
    tp: CERAMIC_TP,
  },
  whiteGoldPanel: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.4, metalness: 0.3 },
    family: 'ceramic',
    tp: {
      ...CERAMIC_TP,
      panel: {
        w: 2.4, h: 3.6, seam: 0.004, bevel: 0.03, depth: 0.55, tint: 0.05, jitter: 1, dark: 0.55,
        wear: { color: GOLD_LEAF, width: 0.07, strength: 0.9, roughness: 0.3, metalness: 1 },
      },
    },
  },
  whiteGoldFloor: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.27, metalness: 0.25 },
    family: 'ceramicFloor',
    tp: {
      scale: 4,
      normal: 1,
      roughAmp: 0.32,
      macro: { albedo: 0.12, rough: 0.08, scale: 27, hue: 0.35 },
      detail: { scale: 0.31, normal: 0.1, rough: 0.1, albedo: 0.03 },
      panel: {
        w: 3, h: 3, seam: 0.004, bevel: 0.025, depth: 0.5, tint: 0.07, jitter: 1, dark: 0.6,
        wear: { color: GOLD_LEAF, width: 0.035, strength: 0.55, roughness: 0.32, metalness: 1 },
      },
    },
  },
  goldTrim: {
    base: 'standard',
    props: { color: 0xf0c574, roughness: 0.22, metalness: 1 },
    family: 'polished',
    tp: { scale: 1.5, normal: 0.8, roughAmp: 0.3, macro: { albedo: 0.06, rough: 0.06, scale: 13, hue: 0.25 }, detail: { scale: 0.23, normal: 0.06, rough: 0.07, albedo: 0.02 } },
  },
  goldDark: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.46, metalness: 1 },
    family: 'goldAged',
    tp: { scale: 2, normal: 1, roughAmp: 0.8, macro: { albedo: 0.12, rough: 0.08, scale: 17, hue: 0.2 }, detail: { scale: 0.27, normal: 0.14, rough: 0.1, albedo: 0.04 } },
  },

  // ------------------------------------------------------------------ King-era substrate — lower
  blackStone: {
    base: 'physical',
    props: { color: 0xffffff, roughness: 0.15, metalness: 0, ior: 1.85 },
    family: 'blackStone',
    tp: {
      scale: 5, normal: 0.7, roughAmp: 0.16,
      macro: { albedo: 0.3, rough: 0.05, scale: 29, hue: 0.1 },
      detail: { scale: 0.37, normal: 0.035, rough: 0.035, albedo: 0.03 },
      mask: { color: GOLD_LEAF, amount: 0.7, roughness: 0.28, metalness: 1 },
    },
  },
  blackStoneFloor: {
    base: 'physical',
    props: { color: 0xffffff, roughness: 0.09, metalness: 0, ior: 1.9 },
    family: 'blackStone',
    tp: {
      scale: 5, normal: 0.55, roughAmp: 0.11,
      macro: { albedo: 0.3, rough: 0.035, scale: 31, hue: 0.1 },
      detail: { scale: 0.37, normal: 0.025, rough: 0.03, albedo: 0.03 },
      panel: { w: 4, h: 4, seam: 0.0025, bevel: 0.012, depth: 0.22, tint: 0.3, jitter: 1, dark: 0.5 },
      mask: { color: GOLD_LEAF, amount: 0.7, roughness: 0.28, metalness: 1 },
    },
  },
  goldChannel: emissiveStrip(0x5c4a22, 0xffc56b, 3, 'channel', { pulse: 0.38, speed: 1.6, wavelength: 7, pattern: 0.12, period: 0.22 }),
  whiteLight: emissiveStrip(0x2a2620, 0xfff0d2, 4, 'panel', { pulse: 0.05 }),

  // ------------------------------------------------------------------ Dominion
  domBronze: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.4, metalness: 1 },
    family: 'bronze',
    tp: { scale: 1.6, normal: 1, roughAmp: 0.8, macro: { albedo: 0.1, rough: 0.07, scale: 11, hue: 0.2 }, detail: { scale: 0.21, normal: 0.12, rough: 0.1, albedo: 0.04 } },
  },
  domOxblood: {
    base: 'physical',
    props: { color: 0x6b1517, roughness: 0.46, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 },
    family: 'lacquer',
    tp: {
      scale: 1.2, normal: 1, roughAmp: 0.3,
      macro: { albedo: 0.14, rough: 0.06, scale: 9, hue: 0.1 },
      detail: { scale: 0.19, normal: 0.05, rough: 0.06, albedo: 0.03 },
      mask: { color: 0x3b2a1b, amount: 1, roughness: 0.5, metalness: 0.85 },
    },
  },
  domBlack: {
    base: 'standard',
    props: { color: 0x1c181a, roughness: 0.48, metalness: 0.75 },
    family: 'coated',
    tp: {
      scale: 1.6, normal: 1, roughAmp: 0.34,
      macro: { albedo: 0.12, rough: 0.07, scale: 11, hue: 0.1 },
      detail: { scale: 0.21, normal: 0.12, rough: 0.08, albedo: 0.04 },
      mask: { color: 0x8f7d68, amount: 0.8, roughness: 0.34, metalness: 1 },
    },
  },
  domAmberGlow: emissiveStrip(0x1c0e05, P.domAmber, 3, 'louvre', { pulse: 0.1, pattern: 0.35, period: 0.03, flicker: 0.05 }),
  domCloth: {
    base: 'physical',
    props: { color: 0x611518, roughness: 0.92, metalness: 0, sheen: 0.7, sheenColor: 0xc0604c, sheenRoughness: 0.5 },
    family: 'clothTwill',
    local: true,
    tp: { scale: 0.18, normal: 1, roughAmp: 0.2, macro: { albedo: 0.16, rough: 0.05, scale: 2.3, hue: 0.15 }, detail: { scale: 0.047, normal: 0.05, rough: 0.05, albedo: 0.04 } },
  },

  // ------------------------------------------------------------------ Reformation
  refNavy: {
    base: 'standard',
    props: { color: 0x22365c, roughness: 0.58, metalness: 0.35 },
    family: 'coated',
    tp: {
      scale: 1.6, normal: 1, roughAmp: 0.3,
      macro: { albedo: 0.1, rough: 0.06, scale: 11, hue: 0.1 },
      detail: { scale: 0.21, normal: 0.1, rough: 0.07, albedo: 0.03 },
      mask: { color: BARE_STEEL, amount: 0.85, roughness: 0.3, metalness: 1 },
    },
  },
  refSlate: {
    base: 'standard',
    props: { color: 0x48566a, roughness: 0.62, metalness: 0.3 },
    family: 'coated',
    tp: {
      scale: 1.9, normal: 0.9, roughAmp: 0.3,
      macro: { albedo: 0.1, rough: 0.06, scale: 13, hue: 0.1 },
      detail: { scale: 0.21, normal: 0.1, rough: 0.07, albedo: 0.03 },
      mask: { color: BARE_STEEL, amount: 0.8, roughness: 0.3, metalness: 1 },
    },
  },
  refSteel: {
    base: 'standard',
    props: { color: 0xd2d8df, roughness: 0.33, metalness: 1 },
    family: 'brushed',
    tp: { scale: 1.2, normal: 1, roughAmp: 0.3, macro: { albedo: 0.06, rough: 0.06, scale: 9, hue: 0.05 }, detail: { scale: 0.17, normal: 0.05, rough: 0.06, albedo: 0.02 } },
  },
  refBlueGlow: emissiveStrip(0x060a10, P.refBlue, 3, 'segment', { pulse: 0.08, pattern: 0.55, period: 0.045 }),
  refCloth: {
    base: 'physical',
    props: { color: 0x1d2c46, roughness: 0.8, metalness: 0, sheen: 0.35, sheenColor: 0x7f9cc8, sheenRoughness: 0.6 },
    family: 'clothTech',
    local: true,
    tp: { scale: 0.16, normal: 1, roughAmp: 0.2, macro: { albedo: 0.12, rough: 0.05, scale: 2.1, hue: 0.05 }, detail: { scale: 0.043, normal: 0.04, rough: 0.05, albedo: 0.03 } },
  },

  // ------------------------------------------------------------------ frozen atmosphere
  frostIce: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.16, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide },
    family: 'ice',
    tp: { scale: 2.5, normal: 1.1, roughAmp: 0.28, macro: { albedo: 0.1, rough: 0.06, scale: 17, hue: 0 }, detail: { scale: 0.29, normal: 0.1, rough: 0.08, albedo: 0.02 } },
    effects: [
      { kind: 'translucency', color: 0xbfe6ff, strength: 1.4 },
      { kind: 'ice' },
    ],
  },
  frostRime: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.7, metalness: 0 },
    family: 'rime',
    tp: { scale: 1.2, normal: 1, roughAmp: 0.3, macro: { albedo: 0.1, rough: 0.08, scale: 9, hue: 0 }, detail: { scale: 0.19, normal: 0.14, rough: 0.1, albedo: 0.04 } },
    effects: [
      { kind: 'translucency', color: 0xbfe6ff, strength: 0.5 },
      { kind: 'sparkle', intensity: 2.2, density: 120, color: P.frost },
    ],
  },

  // ------------------------------------------------------------------ Eclipse overlay
  eclipseTissue: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.3, metalness: 0 },
    family: 'tissue',
    tp: {
      scale: 1.6, normal: 1.25, roughAmp: 0.34,
      macro: { albedo: 0.2, rough: 0.07, scale: 7, hue: 0 },
      detail: { scale: 0.17, normal: 0.12, rough: 0.08, albedo: 0.05 },
      mask: { glow: P.eclipseViolet, glowIntensity: 2.4, pulse: 0.8 },
    },
  },
  eclipseVein: emissiveStrip(0x0c0514, P.eclipseViolet, 3.5, 'vein', { pulse: 0.6, speed: 0.9, wavelength: 2.4, pattern: 0.15 }),
  eclipsePlate: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.5, metalness: 0.45 },
    family: 'plate',
    tp: {
      scale: 1.4, normal: 1.1, roughAmp: 0.4,
      macro: { albedo: 0.14, rough: 0.07, scale: 7, hue: 0.1 },
      detail: { scale: 0.19, normal: 0.12, rough: 0.09, albedo: 0.04 },
      mask: { glow: P.eclipseViolet, glowIntensity: 2.6, pulse: 0.55 },
    },
  },

  // ------------------------------------------------------------------ misc
  glass: {
    base: 'physical',
    props: { color: 0xdcecee, roughness: 0.04, metalness: 0, ior: 1.52, transparent: true, opacity: 0.12, depthWrite: false, envMapIntensity: 1.3 },
    effects: [{ kind: 'glass', rim: 0.75 }],
  },
  hologram: {
    base: 'basic',
    props: { color: P.refBlue, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: true },
    effects: [{ kind: 'hologram' }],
  },
  shieldEnergy: {
    base: 'basic',
    props: { color: P.domAmber, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false },
    local: true,
    effects: [{ kind: 'shield' }],
  },
  quarantineBarrier: {
    base: 'basic',
    props: { color: P.goldLight, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false },
    effects: [{ kind: 'barrier' }],
  },
  darkWood: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.36, metalness: 0 },
    family: 'wood',
    tp: { scale: 1.2, normal: 1, roughAmp: 0.36, macro: { albedo: 0.14, rough: 0.06, scale: 5, hue: 0.2 }, detail: { scale: 0.17, normal: 0.06, rough: 0.07, albedo: 0.04 } },
  },
  agedLeather: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.52, metalness: 0 },
    family: 'leather',
    tp: { scale: 0.5, normal: 1, roughAmp: 0.5, macro: { albedo: 0.16, rough: 0.08, scale: 3.1, hue: 0.2 }, detail: { scale: 0.11, normal: 0.08, rough: 0.07, albedo: 0.04 } },
  },
  rubble: {
    base: 'standard',
    props: { color: 0xffffff, roughness: 0.86, metalness: 0 },
    family: 'rubble',
    tp: { scale: 2, normal: 1.2, roughAmp: 0.3, macro: { albedo: 0.16, rough: 0.06, scale: 9, hue: 0.3 }, detail: { scale: 0.23, normal: 0.2, rough: 0.1, albedo: 0.06 } },
  },
  scorched: {
    base: 'standard',
    props: { color: 0x3a332e, roughness: 0.9, metalness: 0 },
    family: 'rubble',
    tp: {
      scale: 2, normal: 1.2, roughAmp: 0.25,
      macro: { albedo: 0.3, rough: 0.06, scale: 7, hue: 0.2 },
      detail: { scale: 0.23, normal: 0.2, rough: 0.1, albedo: 0.08 },
      mask: { color: 0x050403, amount: 0.9, roughness: 1, metalness: 0, glow: P.cinder, glowIntensity: 0.5, pulse: 0.85 },
    },
  },
  rubber: {
    base: 'standard',
    props: { color: 0x121214, roughness: 0.82, metalness: 0 },
    family: 'rubber',
    local: true,
    tp: { scale: 0.3, normal: 1, roughAmp: 0.3, macro: { albedo: 0.2, rough: 0.06, scale: 2.3, hue: 0 }, detail: { scale: 0.07, normal: 0.08, rough: 0.08, albedo: 0.05 } },
  },
  skin: {
    base: 'standard',
    props: { color: 0xc69478, roughness: 0.55, metalness: 0 },
    family: 'skin',
    local: true,
    tp: { scale: 0.25, normal: 0.8, roughAmp: 0.25, macro: { albedo: 0.08, rough: 0.05, scale: 1.3, hue: 0.2 }, detail: { scale: 0.06, normal: 0.04, rough: 0.05, albedo: 0.02 } },
    effects: [{ kind: 'translucency', color: 0xff5a3c, strength: 0.3 }],
  },
  hair: {
    base: 'standard',
    props: { color: 0x1c130d, roughness: 0.5, metalness: 0 },
    family: 'hair',
    local: true,
    tp: { scale: 0.12, normal: 1, roughAmp: 0.4, macro: { albedo: 0.2, rough: 0.06, scale: 1.1, hue: 0.1 }, detail: { scale: 0.05, normal: 0.04, rough: 0.05, albedo: 0.04 } },
  },
  woundBlack: {
    base: 'basic',
    props: { color: 0x000000, fog: false, toneMapped: false },
  },
};

export const MAT_IDS = Object.keys(MAT_DEFS) as MatId[];
