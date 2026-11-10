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
  const fig = getFigure(archetype, def, GENERIC, seed, variant);
  const v = new HumanoidVisualImpl(fig, scale, seed);
  if (opts?.corruption !== undefined) v.setCorruption(opts.corruption);
  return v;
}

export { listActions } from './debug';
