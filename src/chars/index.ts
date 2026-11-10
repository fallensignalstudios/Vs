/**
 * Character factory dispatcher (FOUNDATION). Humanoids → src/chars/humanoid, creatures + devices → src/chars/creatures.
 */
import type { Archetype, CharacterCreateOpts, CharacterFactory, CharacterVisual, CreatureArchetype, DeviceArchetype, Game, HumanoidArchetype } from '@/core/api';
import { createHumanoid } from './humanoid';
import { createCreature } from './creatures';

const CREATURES: ReadonlySet<string> = new Set([
  'secDrone', 'contamDrone', 'wallrunner', 'weaver', 'elite',
  'commandEmitter', 'relayReceiver', 'scanHead', 'weaverAnchor', 'frostAnchor',
]);

export function isCreatureArchetype(a: string): a is CreatureArchetype | DeviceArchetype {
  return CREATURES.has(a);
}

export function createCharacterFactory(game: Game | null): CharacterFactory {
  return {
    create(archetype: Archetype, opts?: CharacterCreateOpts): CharacterVisual {
      return isCreatureArchetype(archetype)
        ? createCreature(game, archetype, opts)
        : createHumanoid(game, archetype as HumanoidArchetype, opts);
    },
    warm(archetypes: Archetype[]): void {
      for (const a of archetypes) {
        try {
          this.create(a).dispose();
        } catch {
          /* warm-up is best effort */
        }
      }
    },
  };
}
