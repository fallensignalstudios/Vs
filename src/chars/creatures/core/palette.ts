/**
 * Paint presets for creature/device parts. Colours mirror PALETTE (api/materials.ts) so creatures sit in the
 * same three visual layers as the world: King-era substrate, the two arriving factions, the Eclipse overlay.
 */
import { PALETTE } from '@/core/api/materials';
import type { Paint } from './rig';

const PAINTS = {
  // Reformation — navy, slate, sterile metal, cold blue-white
  refNavy: { c: PALETTE.refNavy, r: 0.42, m: 0.55, edge: 0.75 },
  refSlate: { c: PALETTE.refSlate, r: 0.5, m: 0.6, edge: 0.6 },
  refSteel: { c: 0x8f98a3, r: 0.46, m: 0.85, edge: 0.25 },
  refPanel: { c: 0xaeb6bf, r: 0.55, m: 0.35, edge: 0.3 },
  refDark: { c: 0x0c1118, r: 0.55, m: 0.4, edge: 0.4 },
  refGlow: { c: PALETTE.refBlue, r: 0.4, m: 0, e: 2.6, edge: 0 },
  refGlowSoft: { c: PALETTE.refBlue, r: 0.4, m: 0, e: 1.3, edge: 0 },
  refHot: { c: 0xe6f4ff, r: 0.4, m: 0, e: 2.4, edge: 0 },
  glass: { c: 0x04070b, r: 0.06, m: 0.85, edge: 0 },
  rubber: { c: 0x08090b, r: 0.8, m: 0.05, edge: 0.1 },

  // Dominion — bronze, oxblood, black, amber
  domBronze: { c: PALETTE.domBronze, r: 0.46, m: 0.85, edge: 0.6 },
  domOxblood: { c: PALETTE.domOxblood, r: 0.5, m: 0.35, edge: 0.6 },
  domBlack: { c: PALETTE.domBlack, r: 0.5, m: 0.6, edge: 0.6 },
  domGlow: { c: PALETTE.domAmber, r: 0.4, m: 0, e: 2.4, edge: 0 },

  // King-era substrate fragments
  whiteGold: { c: 0xcfc8b6, r: 0.56, m: 0.14, edge: 0.3 },
  ivoryWorn: { c: 0xada594, r: 0.66, m: 0.1, edge: 0.45 },
  gold: { c: PALETTE.gold, r: 0.42, m: 1, edge: 0.35 },
  goldDeep: { c: PALETTE.goldDeep, r: 0.4, m: 1, edge: 0.5 },
  blackStone: { c: 0x101218, r: 0.14, m: 0.25, edge: 0.25 },
  goldChannel: { c: 0xffc56b, r: 0.4, m: 0, e: 2.2, edge: 0 },

  // Eclipse overlay
  tissue: { c: 0x120e15, r: 0.42, m: 0.1, edge: 0, seam: 1 },
  tissueWet: { c: 0x0b080e, r: 0.2, m: 0.15, edge: 0, seam: 1 },
  tissuePale: { c: 0x3a2a4a, r: 0.5, m: 0.05, edge: 0, seam: 0.8 },
  sinew: { c: 0x1d1622, r: 0.35, m: 0.1, edge: 0, seam: 0.9 },
  violet: { c: PALETTE.eclipseViolet, r: 0.4, m: 0, e: 2.6, edge: 0, seam: 0.3 },
  violetSoft: { c: PALETTE.eclipseViolet, r: 0.4, m: 0, e: 1.2, edge: 0, seam: 0.3 },
  violetHot: { c: 0xb48cff, r: 0.4, m: 0, e: 4.5, edge: 0, seam: 0.2 },
  violetEye: { c: 0xcbb4ff, r: 0.3, m: 0, e: 3.2, edge: 0 },
  bone: { c: 0x8f8778, r: 0.6, m: 0.05, edge: 0.4, seam: 0.2 },

  // Frost
  ice: { c: 0x8fc4dc, r: 0.22, m: 0, e: 0.07, edge: 0.6 },
  frostGlow: { c: PALETTE.frost, r: 0.4, m: 0, e: 2.2, edge: 0 },
  frostGlowSoft: { c: PALETTE.frost, r: 0.4, m: 0, e: 1.1, edge: 0 },
} satisfies Record<string, Paint>;

/** paint presets by name */
export const P: { readonly [K in keyof typeof PAINTS]: Paint } = PAINTS;

/** a paint with fields overridden (e.g. dirtier, darker, different emissive strength) */
export function tint(p: Paint, over: Partial<Paint>): Paint {
  return { ...p, ...over };
}

/** darken / lighten a colour by multiplying its sRGB channels */
export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}
