/** STUB — replaced by the kit agent. */
import type * as THREE from 'three';
import type { Game, ZoneBuilder } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createZoneBuilder(_game: Game, _root: THREE.Group, _seed: number): ZoneBuilder {
  return nullObject<ZoneBuilder>('kit');
}
