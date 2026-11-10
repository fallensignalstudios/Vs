/**
 * Hero props (OWNER: hero-props) — the objects the camera lingers on in the story's key moments.
 * `createHeroProps(game)` is what `game.props` is. See the "QUICK GUIDE FOR ZONE AUTHORS (hero props)" in
 * `@/core/api/kit` for placement, parameters, sockets and colliders.
 */
import type { Game, HeroProps, HologramKind, MaterialLibrary, NestedRingsOpts } from '@/core/api';
import { isStub } from '@/core/stub';
import { AssentInterface } from './assent';
import { ContainmentCage } from './cage';
import { CrownmarkFive } from './crownmark';
import { Hologram } from './holo';
import { ObservationSet } from './observation';
import { FallenPlate } from './plate';
import { NestedRings } from './rings';
import { DepartureShip } from './ship';
import { Stabilizer } from './stabilizer';
import { RecognitionThreshold } from './threshold';

/**
 * Create the hero-prop factory. `game` may be null (unit tests, tools): props are then built with plain
 * stand-in materials. The material library is looked up when a prop is created, never at construction, so the
 * factory can be built before `game.mats` exists. Unknown kinds warn once and fall back to the first variant.
 */
export function createHeroProps(game: Game | null): HeroProps {
  const lib = (): MaterialLibrary | null => {
    const m = game?.mats;
    return m && !isStub(m) ? m : null;
  };
  return {
    crownmarkFive: () => new CrownmarkFive(lib()),
    nestedRings: (opts?: NestedRingsOpts) => new NestedRings(lib(), opts ?? {}),
    assentInterface: (side) => new AssentInterface(lib(), side === 'selene' ? 'selene' : 'tarrik'),
    stabilizer: () => new Stabilizer(lib()),
    observationSet: () => new ObservationSet(lib()),
    recognitionThreshold: () => new RecognitionThreshold(lib()),
    containmentCage: (kind) => new ContainmentCage(lib(), kind === 'reformation' ? 'reformation' : 'dominion'),
    fallenPlate: () => new FallenPlate(lib()),
    departureShip: (kind) => new DepartureShip(lib(), kind === 'reformationTransport' ? 'reformationTransport' : 'dominionShuttle'),
    hologram: (kind: HologramKind) => new Hologram(lib(), kind),
  };
}
