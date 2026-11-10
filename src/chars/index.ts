/**
 * Character factory dispatcher (FOUNDATION). Humanoids → src/chars/humanoid, creatures + devices → src/chars/creatures.
 * Humanoid archetypes with a generated body (public/models) → src/chars/glb, which wraps the procedural figure
 * as its animation driver and falls back to it whenever a model is missing or not loaded yet.
 */
import type { Archetype, CharacterCreateOpts, CharacterFactory, CharacterVisual, CreatureArchetype, DeviceArchetype, Game, HumanoidArchetype } from '@/core/api';
import { createHumanoid } from './humanoid';
import { createCreature } from './creatures';
import { createGlbCharacters } from './glb';

const CREATURES: ReadonlySet<string> = new Set([
  'secDrone', 'contamDrone', 'wallrunner', 'weaver', 'elite',
  'commandEmitter', 'relayReceiver', 'scanHead', 'weaverAnchor', 'frostAnchor',
]);

export function isCreatureArchetype(a: string): a is CreatureArchetype | DeviceArchetype {
  return CREATURES.has(a);
}

export function createCharacterFactory(game: Game | null): CharacterFactory {
  const glb = createGlbCharacters(game);
  return {
    create(archetype: Archetype, opts?: CharacterCreateOpts): CharacterVisual {
      if (isCreatureArchetype(archetype)) return createCreature(game, archetype, opts);
      return glb.create(archetype as HumanoidArchetype, opts) ?? createHumanoid(game, archetype as HumanoidArchetype, opts);
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
    preload(archetypes: Archetype[]): Promise<void> {
      return glb.preload(Array.isArray(archetypes) ? archetypes : []);
    },
  };
}
