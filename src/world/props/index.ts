/** STUB — replaced by the hero-props agent. */
import type { Game, HeroProps } from '@/core/api';
import { nullObject } from '@/core/stub';

export function createHeroProps(_game: Game | null): HeroProps {
  return nullObject<HeroProps>('props');
}
