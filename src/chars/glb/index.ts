/**
 * Generated-mesh characters — public entry. `createGlbCharacters(game)` gives the character factory a
 * source of HumanoidVisuals whose body is a generated GLB from public/models driven by the procedural animator
 * (same actions, timings, events and sockets as the procedural figure, which remains the automatic fallback).
 */
import type { Archetype, CharacterCreateOpts, Game, HumanoidArchetype, HumanoidVisual } from '@/core/api';
import { GLB_ARCHETYPES, modelsFor } from './config';
import { ModelLibrary } from './library';
import { GlbHumanoidVisual } from './visual';

export interface GlbCharacters {
  readonly library: ModelLibrary;
  /**
   * A visual for `archetype` that uses its generated body, or null when the archetype has none (or it can never
   * be loaded) — the caller then builds the procedural figure. If the files are still loading the visual starts
   * as the procedural figure and switches by itself.
   */
  create(archetype: HumanoidArchetype, opts?: CharacterCreateOpts): HumanoidVisual | null;
  /** Load the bodies and props these archetypes use. Always resolves. */
  preload(archetypes: readonly Archetype[]): Promise<void>;
}

const warned = new Set<string>();

export function createGlbCharacters(game: Game | null): GlbCharacters {
  const library = new ModelLibrary(game);
  if (library.enabled) void library.loadManifest();
  return {
    library,
    create(archetype, opts) {
      const cfg = GLB_ARCHETYPES[archetype];
      if (!cfg || opts?.driverOnly || !library.enabled || library.unavailable(cfg.model)) return null;
      if (!library.has(cfg.model)) void library.preload(modelsFor(archetype));
      try {
        return new GlbHumanoidVisual(game, archetype, cfg, library, opts);
      } catch (err) {
        if (!warned.has(archetype)) { warned.add(archetype); console.warn(`[glb] ${archetype}: generated body unavailable (${String((err as Error)?.message ?? err)}) — procedural figure`); }
        return null;
      }
    },
    preload(archetypes) {
      const names = new Set<string>();
      for (const a of archetypes) for (const n of modelsFor(a)) names.add(n);
      return library.preload([...names]);
    },
  };
}

export { GLB_ARCHETYPES, modelsFor } from './config';
export { ModelLibrary } from './library';
export { GlbHumanoidVisual } from './visual';
