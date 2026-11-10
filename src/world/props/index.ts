/**
 * Hero props (OWNER: hero-props) — the objects the camera lingers on in the story's key moments.
 * `createHeroProps(game)` is what `game.props` is. See the "QUICK GUIDE (hero props)" in `@/core/api/kit`.
 */
import type { Game, HeroProp, HeroProps, HologramKind, HologramProp, MaterialLibrary, NestedRingsOpts } from '@/core/api';
import { isStub } from '@/core/stub';
import { CrownmarkFive } from './crownmark';

/**
 * Create the hero-prop factory. `game` may be null (unit tests): props are then built with plain stand-in
 * materials. The material library is looked up when a prop is created, never at construction.
 */
export function createHeroProps(game: Game | null): HeroProps {
  const lib = (): MaterialLibrary | null => {
    const m = game?.mats;
    return m && !isStub(m) ? m : null;
  };
  const todo = (): never => { throw new Error('pending'); };
  return {
    crownmarkFive: () => new CrownmarkFive(lib()),
    nestedRings: (_opts?: NestedRingsOpts) => todo(),
    assentInterface: () => todo(),
    stabilizer: () => todo(),
    observationSet: (): HeroProp<Record<string, number>> => todo(),
    recognitionThreshold: () => todo(),
    containmentCage: () => todo(),
    fallenPlate: () => todo(),
    departureShip: () => todo(),
    hologram: (_kind: HologramKind): HologramProp => todo(),
  };
}
