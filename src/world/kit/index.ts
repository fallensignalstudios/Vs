/**
 * Environment kit (OWNER: kit). `createZoneBuilder` is what `game.createZoneBuilder(root, seed)` calls.
 * Contract + author's guide: src/core/api/kit.ts.
 */
import type * as THREE from 'three';
import type { Game, ZoneBuilder } from '@/core/api';
import { ZoneBuilderImpl } from './builder';

export { PROP_KINDS } from './props';
export { COVER_HIGH, COVER_LOW } from './cover';

export function createZoneBuilder(game: Game, root: THREE.Group, seed: number): ZoneBuilder {
  return new ZoneBuilderImpl(game, root, seed);
}
