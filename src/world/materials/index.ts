/** STUB — replaced by the materials agent. */
import type { Game, MaterialLibrary } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createMaterialLibrary(_game: Game | null): MaterialLibrary {
  return nullObject<MaterialLibrary>('mats');
}
