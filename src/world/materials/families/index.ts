/**
 * Texture family registry. A family is one baked set of albedo / normal / ORM maps; several MatIds may share a
 * family and differ only in tint and shader parameters.
 */
import type { PbrLayers } from '../bake';
import { blackStone, ceramic, ceramicFloor, goldAged, polished } from './substrate';
import { bronze, brushed, clothTech, clothTwill, coated, lacquer } from './faction';
import { ice, plate, rime, tissue } from './overlay';
import { hair, leather, rubber, rubble, skin, wood } from './misc';

export type FamilyId =
  | 'ceramic' | 'ceramicFloor' | 'blackStone' | 'polished' | 'goldAged'
  | 'bronze' | 'lacquer' | 'coated' | 'brushed' | 'clothTwill' | 'clothTech'
  | 'ice' | 'rime' | 'tissue' | 'plate'
  | 'wood' | 'leather' | 'rubble' | 'rubber' | 'skin' | 'hair';

/** hero = full `textureSize`; mid = half; small = quarter (never below 256, never above 2048/1024/512). */
export type FamilyTier = 'hero' | 'mid' | 'small';

export interface FamilyDef {
  tier: FamilyTier;
  generate(size: number): PbrLayers;
}

export const FAMILIES: Record<FamilyId, FamilyDef> = {
  ceramic: { tier: 'hero', generate: ceramic },
  ceramicFloor: { tier: 'hero', generate: ceramicFloor },
  blackStone: { tier: 'hero', generate: blackStone },
  polished: { tier: 'mid', generate: polished },
  goldAged: { tier: 'mid', generate: goldAged },
  bronze: { tier: 'mid', generate: bronze },
  lacquer: { tier: 'mid', generate: lacquer },
  coated: { tier: 'mid', generate: coated },
  brushed: { tier: 'mid', generate: brushed },
  clothTwill: { tier: 'small', generate: clothTwill },
  clothTech: { tier: 'small', generate: clothTech },
  ice: { tier: 'mid', generate: ice },
  rime: { tier: 'mid', generate: rime },
  tissue: { tier: 'mid', generate: tissue },
  plate: { tier: 'mid', generate: plate },
  wood: { tier: 'mid', generate: wood },
  leather: { tier: 'small', generate: leather },
  rubble: { tier: 'mid', generate: rubble },
  rubber: { tier: 'small', generate: rubber },
  skin: { tier: 'small', generate: skin },
  hair: { tier: 'small', generate: hair },
};

export const FAMILY_IDS = Object.keys(FAMILIES) as FamilyId[];

/** Resolution a family bakes at for a given quality `textureSize`. */
export function familySize(tier: FamilyTier, textureSize: number): number {
  const s = Math.max(256, Math.min(2048, textureSize));
  if (tier === 'hero') return s;
  if (tier === 'mid') return Math.max(256, Math.min(1024, s / 2));
  return Math.max(256, Math.min(512, s / 4));
}
