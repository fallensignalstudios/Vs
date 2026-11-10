/**
 * Creature + device visual factory. Everything non-human the player fights or shoots:
 * drones, Eclipse bodies, the elite breach organism and the encounter devices.
 * See src/core/api/creatures.ts for sockets, actions and the typed extension interfaces.
 */
import type { CharacterCreateOpts, CharacterVisual, CreatureArchetype, DeviceArchetype, Game } from '@/core/api';
import { warnOnce } from './core/rig';
import { createDrone } from './drone';
import { createElite } from './elite';
import { createWeaver } from './weaver';
import { createWallrunner } from './wallrunner';
import { createFrostAnchor, createWeaverAnchor } from './devices/anchors';
import { createCommandEmitter, createRelayReceiver, createScanHead } from './devices/reformation';

type Maker = (game: Game | null, opts?: CharacterCreateOpts) => CharacterVisual;

const MAKERS: Record<CreatureArchetype | DeviceArchetype, Maker> = {
  secDrone: (g, o) => createDrone(g, false, o),
  contamDrone: (g, o) => createDrone(g, true, o),
  wallrunner: (g, o) => createWallrunner(g, o),
  weaver: (g, o) => createWeaver(g, o),
  elite: (g, o) => createElite(g, o),
  commandEmitter: (g, o) => createCommandEmitter(g, o),
  relayReceiver: (g, o) => createRelayReceiver(g, o),
  scanHead: (g, o) => createScanHead(g, o),
  weaverAnchor: (g, o) => createWeaverAnchor(g, o),
  frostAnchor: (g, o) => createFrostAnchor(g, o),
};

/** All archetypes this factory builds. */
export const CREATURE_ARCHETYPES = Object.keys(MAKERS) as (CreatureArchetype | DeviceArchetype)[];

/**
 * Create a creature or device visual. Never throws: an unknown archetype warns once and yields a security
 * drone so the encounter stays playable.
 */
export function createCreature(game: Game | null, archetype: CreatureArchetype | DeviceArchetype, opts?: CharacterCreateOpts): CharacterVisual {
  const make = MAKERS[archetype];
  if (!make) {
    warnOnce('archetype:' + String(archetype), `[creatures] unknown archetype "${String(archetype)}" — substituting secDrone`);
    return MAKERS.secDrone(game, opts);
  }
  return make(game, opts);
}
