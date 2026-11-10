/** STUB — replaced by the render-core agent. */
import type { Game, RenderSystem } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createRenderSystem(_game: Game): RenderSystem {
  return nullObject<RenderSystem>('render');
}
