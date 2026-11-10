/**
 * Render core — renderer, HDR post chain, looks, quality, polished-floor reflections, environment lighting.
 * Contract: src/core/api/render.ts. Zone authors: `import { LOOKS } from '@/render/looks'`.
 */
import type { Game, RenderSystem } from '@/core/api';
import { RenderSystemImpl } from './system';

export { LOOKS, DEFAULT_LOOK } from './looks';
export { QUALITY_PRESETS } from './quality';

export function createRenderSystem(game: Game): RenderSystem {
  return new RenderSystemImpl(game);
}
