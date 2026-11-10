/** Archetype registry. */
import type { HumanoidArchetype } from '@/core/api';
import type { ArchetypeDef } from '../figure';
import { buildBody } from '../parts/body';
import { buildHead } from '../parts/head';

const TEMP: ArchetypeDef = {
  proportions: () => ({ height: 1.85, shoulder: 0.19, hip: 0.095, bulk: 1, fem: 0 }),
  build({ b, rig }) {
    buildBody(b, rig, { suit: { color: 0x23262b }, skin: { color: 0xb98a6a }, boot: { color: 0x1a1512 } });
    buildHead(b, rig, { skin: { color: 0xb98a6a }, hair: { color: 0x1c1410 }, style: 'crop', beard: true });
  },
};

export const ARCHETYPES: Partial<Record<HumanoidArchetype, ArchetypeDef>> = { tarrik: TEMP };
export const FALLBACK_ARCHETYPE: ArchetypeDef = TEMP;
