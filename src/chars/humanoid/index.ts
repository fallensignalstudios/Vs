/**
 * Humanoid figures — public factory. Everything is procedural: sculpted geometry, one shared shader,
 * layered procedural animation, cloth. See src/core/api/chars.ts (HumanoidVisual) for the contract.
 */
import type { CharacterCreateOpts, Game, HumanoidArchetype, HumanoidVisual } from '@/core/api';
import { ARCHETYPES, FALLBACK_ARCHETYPE } from './archetypes';
import { getFigure } from './figure';
import { GENERIC } from './clips/generic';
import { HumanoidVisualImpl } from './visual';

const warned = new Set<string>();

/**
 * Create a humanoid figure. `game` may be null (sandboxes); the figure needs nothing from other subsystems.
 * Unknown archetypes fall back to a generic soldier and warn once — never throws.
 */
export function createHumanoid(_game: Game | null, archetype: HumanoidArchetype, opts?: CharacterCreateOpts): HumanoidVisual {
  let def = ARCHETYPES[archetype];
  if (!def) {
    if (!warned.has(archetype)) { warned.add(archetype); console.warn(`[humanoid] unknown archetype "${String(archetype)}" — using a fallback figure`); }
    def = FALLBACK_ARCHETYPE;
  }
  const seed = Number.isFinite(opts?.seed) ? Math.floor(opts!.seed as number) : 0;
  const variant = Number.isFinite(opts?.variant) ? Math.floor(opts!.variant as number) : 0;
  const scale = opts?.scale && opts.scale > 0 ? opts.scale : 1;
  const mask = opts?.driverOnly ? new Set<string>(Array.isArray(opts.keep) ? opts.keep : []) : null;
  const fig = getFigure(archetype, def, GENERIC, seed, variant, mask);
  const v = new HumanoidVisualImpl(fig, { scale, seed, vary: (def.seedBuckets ?? 1) > 1 });
  if (opts?.corruption !== undefined) v.setCorruption(opts.corruption);
  return v;
}

/**
 * Build the figures for these archetypes (and seeds) ahead of time so spawning them later does not hitch.
 * CharacterFactory.warm() covers seed 0; pass the seeds an encounter will use to cover squad variants too.
 */
export function warmHumanoids(archetypes: readonly HumanoidArchetype[], seeds: readonly number[] = [0]): void {
  for (const a of archetypes) {
    const def = ARCHETYPES[a];
    if (def) for (const s of seeds) getFigure(a, def, GENERIC, Number.isFinite(s) ? Math.floor(s) : 0, 0);
  }
}

export { listActions } from './debug';
/** Free cached figure geometry no live humanoid uses (call when a zone unloads). */
export { releaseUnusedFigures as releaseUnusedHumanoids, figureCacheStats as humanoidCacheStats } from './figure';
