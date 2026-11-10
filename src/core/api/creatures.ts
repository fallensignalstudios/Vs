/**
 * Creature + device visuals — OWNER: creatures (src/chars/creatures/*).
 * Creatures and devices implement CharacterVisual from ./chars. Add creature-specific extras here.
 */
import type { CharacterVisual, CreatureArchetype, DeviceArchetype, CharacterCreateOpts } from './chars';

export type CreatureCreate = (archetype: CreatureArchetype | DeviceArchetype, opts?: CharacterCreateOpts) => CharacterVisual;

/**
 * Canonical extra sockets creatures/devices expose via CharacterVisual.socket():
 *  - drones: 'muzzle', 'eye', 'vent' (rear weak point), 'core'
 *  - wallrunner: 'head', 'core'
 *  - weaver: 'core' (link origin), 'head'
 *  - elite: 'joint' (regenerating joint / Resonance target), 'core', 'head', 'handL', 'handR'
 *  - commandEmitter / relayReceiver / scanHead / weaverAnchor / frostAnchor: 'core' (beam origin), 'top'
 */
export const CREATURE_SOCKETS = ['muzzle', 'eye', 'vent', 'core', 'joint', 'head', 'top'] as const;
